#!/usr/bin/env python3
"""
Gamemaster — MAX Agent
Multi-step tool loop: list/read/write/search/run against a project.
Bridges the biggest gap vs cloud agents (file access + iteration).
"""
from __future__ import annotations

import argparse
import json
import os
import re
import subprocess
import sys
import textwrap
import time
import urllib.error
import urllib.request
from pathlib import Path

OLLAMA = os.environ.get("OLLAMA_HOST", "http://127.0.0.1:11434").rstrip("/")
DEFAULT_MODEL = os.environ.get("GAMEMASTER_MODEL", "gamemaster")
ROOT = Path(__file__).resolve().parent.parent
MAX_STEPS = int(os.environ.get("GAMEMASTER_AGENT_STEPS", "20"))
MAX_FILE = 120_000
MAX_TOOL_OUT = 24_000
# set in main()
MODEL = DEFAULT_MODEL

SYSTEM_EXTRA = """
You are in AGENT MODE with filesystem tools in the project root.
You implement **Three.js games** (Vite + vanilla). Seeker = same game + MWA.

IMPORTANT: Exactly ONE tool block per reply. Then wait for TOOL RESULT.

Format:

```
tool call TOOLNAME
key: value
```

Tools:
- list_dir  → path: .   oder path: src
- read_file → path: src/main.js   (ALWAYS relative path including folders, z.B. src/foo.js)
- write_file → path: src/foo.js   and content: (full file contents)
- search → query: regex
- run → cmd: short safe command
- done → summary: what was done + how to test

Game completeness when writing systems:
- Place (lights, fog=bg, door-scale) · Body (accel/friction + spring camera) · Matter
- Voice (dialogue JSON + overlay, never alert) · optional ragdoll/Rapier · shader accent
- CONFIG from feel tables · juice.hit() on damage · WebAudio blip if no assets
- no `new THREE.Vector3()` in the loop · complete files · protect the verb

Efficiency:
1) One list_dir, then targeted read_file with full path (src/...)
2) Write ALL required files in sequence (write_file), then done immediately
3) Do not loop list_dir. No long prose between tools.
4) Always include subfolders, never just "main.js" if file is under src/.

Never invent file contents. English only in done summary.
"""


def http_json(path: str, payload: dict | None = None, timeout: float = 600.0) -> dict:
    data = None if payload is None else json.dumps(payload).encode()
    req = urllib.request.Request(
        f"{OLLAMA}{path}",
        data=data,
        headers={"Content-Type": "application/json"} if data else {},
        method="POST" if data is not None else "GET",
    )
    with urllib.request.urlopen(req, timeout=timeout) as r:
        return json.loads(r.read().decode())


def chat(messages: list[dict], model: str, temperature: float = 0.2, num_ctx: int | None = None) -> str:
    ctx = num_ctx or int(os.environ.get("GAMEMASTER_NUM_CTX", "32768"))
    payload = {
        "model": model,
        "messages": messages,
        "stream": False,
        "keep_alive": "24h",
        "options": {
            "temperature": temperature,
            "num_ctx": ctx,
            "num_predict": int(os.environ.get("GAMEMASTER_PREDICT", "8192")),
            "num_batch": 512,
        },
    }
    res = http_json("/api/chat", payload)
    return (res.get("message") or {}).get("content") or ""


def ensure_ollama() -> None:
    try:
        http_json("/api/tags")
    except Exception:
        if sys.platform == "darwin":
            os.system("open -a Ollama >/dev/null 2>&1")
            for _ in range(40):
                time.sleep(0.4)
                try:
                    http_json("/api/tags")
                    return
                except Exception:
                    pass
        raise SystemExit("Ollama not reachable. open -a Ollama")


def parse_tool_body(body: str) -> dict:
    """Parse key: value lines; content: eats until next tool call / fence."""
    lines = body.splitlines()
    data: dict[str, str] = {}
    i = 0
    while i < len(lines):
        line = lines[i]
        # stop if another tool starts (when unfenced multi)
        if re.match(r"(?i)^\s*tool call\s+\w+", line):
            break
        if line.strip() == "```":
            break
        if ":" not in line:
            i += 1
            continue
        key, val = line.split(":", 1)
        key = key.strip().lower()
        val = val.lstrip()
        if key == "content":
            rest = [val] if val else []
            i += 1
            while i < len(lines):
                if re.match(r"(?i)^\s*tool call\s+\w+", lines[i]):
                    break
                if lines[i].strip() == "```":
                    break
                rest.append(lines[i])
                i += 1
            content = "\n".join(rest)
            content = re.sub(r"\n```\s*$", "", content)
            data["content"] = content
            break
        data[key] = val.strip()
        i += 1
    return data


def parse_tools(text: str) -> list[tuple[str, dict]]:
    """Extract all tool calls from a model reply (fenced or bare)."""
    tools: list[tuple[str, dict]] = []
    # Fenced blocks: ``` ... tool call NAME\n ... ```
    for m in re.finditer(
        r"```(?:tool|)\s*\n?tool call\s+(\w+)\n(.*?)```",
        text,
        re.DOTALL | re.IGNORECASE,
    ):
        tools.append((m.group(1).strip().lower(), parse_tool_body(m.group(2))))
    if tools:
        return tools

    # Bare: split on "tool call NAME"
    parts = re.split(r"(?i)(?=^tool call\s+\w+)", text, flags=re.MULTILINE)
    for part in parts:
        m = re.match(r"(?is)^\s*tool call\s+(\w+)\n(.*)$", part.strip())
        if not m:
            continue
        tools.append((m.group(1).strip().lower(), parse_tool_body(m.group(2))))
    return tools


def safe_path(project: Path, rel: str) -> Path:
    rel = rel.strip().lstrip("./")
    if rel in ("", "."):
        return project
    target = (project / rel).resolve()
    if not str(target).startswith(str(project.resolve())):
        raise ValueError(f"path outside project: {rel}")
    return target


def tool_list_dir(project: Path, path: str = ".") -> str:
    d = safe_path(project, path)
    if not d.is_dir():
        return f"ERROR: not a directory: {path}"
    entries = []
    for p in sorted(d.iterdir(), key=lambda x: (not x.is_dir(), x.name.lower())):
        if p.name.startswith(".") or p.name in ("node_modules", "dist", "build", ".git"):
            continue
        kind = "dir" if p.is_dir() else "file"
        size = "" if p.is_dir() else f" {p.stat().st_size}b"
        entries.append(f"{kind:4} {p.name}{size}")
    return "\n".join(entries[:200]) or "(leer)"


def resolve_existing_file(project: Path, path: str) -> Path | None:
    """Try exact path, then common prefixes, then basename search."""
    path = (path or "").strip().lstrip("./")
    if not path:
        return None
    candidates = [path, f"src/{path}", f"js/{path}", f"lib/{path}"]
    for c in candidates:
        try:
            f = safe_path(project, c)
        except ValueError:
            continue
        if f.is_file():
            return f
    # basename walk (shallow)
    name = Path(path).name
    for dirpath, dirnames, filenames in os.walk(project):
        dirnames[:] = [d for d in dirnames if d not in ("node_modules", ".git", "dist", "build")]
        if name in filenames:
            return Path(dirpath) / name
    return None


def tool_read(project: Path, path: str) -> str:
    f = resolve_existing_file(project, path)
    if f is None:
        return f"ERROR: File missing: {path} — use list_dir and full path z.B. src/{path}"
    raw = f.read_bytes()
    if len(raw) > MAX_FILE:
        return f"ERROR: file too large ({len(raw)} bytes). Pick a more specific slice."
    try:
        text = raw.decode("utf-8")
    except UnicodeDecodeError:
        return "ERROR: binary file"
    rel = f.relative_to(project)
    return f"[path: {rel}]\n{text}"


def tool_write(project: Path, path: str, content: str) -> str:
    f = safe_path(project, path)
    f.parent.mkdir(parents=True, exist_ok=True)
    # backup if exists
    if f.exists() and f.stat().st_size > 0:
        bak = f.with_suffix(f.suffix + ".bak")
        bak.write_bytes(f.read_bytes())
    f.write_text(content, encoding="utf-8")
    try:
        import live as livelib  # type: ignore

        livelib.emit(
            f"Wrote {path} ({len(content)} chars) — game will reload",
            role="file",
            phase="coding",
            headline=f"Updated {path}",
            detail="Play/test on the left panel",
            reload=True,
        )
    except Exception:
        pass
    return f"OK wrote {path} ({len(content)} chars)"


def tool_search(project: Path, query: str, glob_pat: str = "*.{js,ts,mjs,html,css,json,md}") -> str:
    # simple walk + regex
    try:
        rx = re.compile(query)
    except re.error as e:
        return f"ERROR regex: {e}"
    hits: list[str] = []
    exts = {".js", ".ts", ".mjs", ".html", ".css", ".json", ".md", ".tsx", ".jsx"}
    for dirpath, dirnames, filenames in os.walk(project):
        dirnames[:] = [d for d in dirnames if d not in ("node_modules", ".git", "dist", "build", ".next")]
        for name in filenames:
            p = Path(dirpath) / name
            if p.suffix.lower() not in exts:
                continue
            try:
                text = p.read_text(encoding="utf-8", errors="ignore")
            except Exception:
                continue
            for i, line in enumerate(text.splitlines(), 1):
                if rx.search(line):
                    rel = p.relative_to(project)
                    hits.append(f"{rel}:{i}: {line.strip()[:200]}")
                    if len(hits) >= 40:
                        return "\n".join(hits)
    return "\n".join(hits) if hits else "(no matches)"


def tool_run(project: Path, cmd: str) -> str:
    cmd = cmd.strip()
    banned = ["rm -rf", "sudo", "mkfs", "dd if=", ":(){", "shutdown", "reboot", "diskutil erase"]
    low = cmd.lower()
    if any(b in low for b in banned):
        return "ERROR: command blocked (Sicherheitsfilter)"
    if len(cmd) > 400:
        return "ERROR: command too long"
    try:
        r = subprocess.run(
            cmd,
            shell=True,
            cwd=str(project),
            capture_output=True,
            text=True,
            timeout=120,
        )
        out = (r.stdout or "") + (r.stderr or "")
        out = out[-MAX_TOOL_OUT:]
        return f"exit={r.returncode}\n{out}"
    except subprocess.TimeoutExpired:
        return "ERROR: timeout 120s"
    except Exception as e:
        return f"ERROR: {e}"


def run_tool(project: Path, name: str, args: dict) -> str:
    try:
        if name == "list_dir":
            return tool_list_dir(project, args.get("path", "."))
        if name == "read_file":
            return tool_read(project, args.get("path", ""))
        if name == "write_file":
            return tool_write(project, args.get("path", ""), args.get("content", ""))
        if name == "search":
            return tool_search(project, args.get("query", ""), args.get("glob", ""))
        if name == "run":
            return tool_run(project, args.get("cmd", ""))
        if name == "done":
            return args.get("summary", "done")
        return f"ERROR: unknown tool {name}"
    except Exception as e:
        return f"ERROR: {e}"


def load_knowledge(project: Path | None = None, task: str = "") -> str:
    chunks: list[str] = []
    # turbo slim packs by task keywords
    try:
        sys.path.insert(0, str(ROOT / "bin"))
        import turbo as turbolib  # type: ignore

        k = turbolib.select_knowledge(task or "three.js complete game world agent", max_chars=32000)
        if k:
            chunks.append(k)
        # always agent protocol (tools)
        ap = ROOT / "knowledge" / "agent-protocol.md"
        if ap.exists():
            chunks.append(ap.read_text(encoding="utf-8")[:4000])
    except Exception:
        for name in (
            "game-systems.md",
            "threejs-cheatsheet.md",
            "threejs-advanced.md",
            "physics-ragdoll.md",
            "world-building.md",
            "dialogue-narrative.md",
            "game-patterns.md",
            "agent-protocol.md",
            "fun-first-design.md",
        ):
            p = ROOT / "knowledge" / name
            if p.exists():
                chunks.append(p.read_text(encoding="utf-8")[:6000])
    try:
        import prefs as prefslib  # type: ignore

        pb = prefslib.format_prompt_block(prefslib.load_merged(project))
        if pb:
            chunks.insert(0, pb)
    except Exception:
        pass
    return "\n\n".join(chunks)


def main() -> int:
    ap = argparse.ArgumentParser(description="Gamemaster MAX Agent")
    ap.add_argument("-p", "--project", required=True, help="Project root")
    ap.add_argument("prompt", nargs="+", help="Aufgabe")
    ap.add_argument("-m", "--model", default=DEFAULT_MODEL)
    ap.add_argument("--steps", type=int, default=MAX_STEPS)
    ap.add_argument("--no-knowledge", action="store_true")
    ap.add_argument(
        "--live",
        action="store_true",
        help="Open Live window to play/test while the agent works",
    )
    args = ap.parse_args()

    model = args.model
    project = Path(args.project).expanduser().resolve()
    if not project.is_dir():
        print(f"❌ Project not found: {project}", file=sys.stderr)
        return 1

    # attach or start live session
    live_flag = args.live or os.environ.get("GAMEMASTER_LIVE") == "1"
    if live_flag:
        try:
            import live as livelib  # type: ignore

            if livelib.get_session() is None:
                # if parent studio already set GAMEMASTER_LIVE_PROJECT, still need a session
                # Agent as subprocess cannot share Python global — reconnect via files only
                # Start a full live session if --live on agent CLI
                if args.live:
                    livelib.start_live(project, open_browser=True)
                    livelib.emit(
                        f"Agent task: {' '.join(args.prompt)[:200]}",
                        role="agent",
                        phase="coding",
                        headline="Agent working…",
                        detail="Play the game while files are written",
                    )
                else:
                    # file-based emit for studio child: append events so dashboard polls them
                    os.environ["GAMEMASTER_LIVE_FILE_ONLY"] = "1"
        except Exception as e:
            print(f"  ⚠ live: {e}")

    ensure_ollama()
    task = " ".join(args.prompt)

    knowledge = "" if args.no_knowledge else load_knowledge(project, task)
    # Stable system prefix first for cache; knowledge second
    system = (
        "You are Gamemaster agent — Three.js game implementer. File tools only as specified. "
        "Honor USER PREFERENCE MEMORY. Complete runnable Three.js game code (worlds, physics, dialogue, shaders).\n"
        + SYSTEM_EXTRA
        + ("\n\n# Knowledge\n" + knowledge if knowledge else "")
    )

    # dynamic ctx: shorter after first steps when history grows... keep 32k default
    num_ctx = int(os.environ.get("GAMEMASTER_NUM_CTX", "32768"))

    messages = [
        {"role": "system", "content": system},
        {
            "role": "user",
            "content": (
                f"Project root: {project}\n\nTask:\n{task}\n\n"
                "Starting mit list_dir path: . — dann read/write mit vollen Pfaden (src/...), "
                "complete the ENTIRE task, dann tool call done."
            ),
        },
    ]

    print(f"🤖 MAX Agent · model={model} · ctx={num_ctx} · turbo knowledge")
    print(f"📁 {project}")
    print(f"🎯 {task}")
    print("─" * 48)

    for step in range(1, args.steps + 1):
        print(f"\n──  {step}/{args.steps} ──")
        try:
            reply = chat(messages, model=model, num_ctx=num_ctx)
        except urllib.error.HTTPError as e:
            print(f"❌ Ollama HTTP {e.code}: {e.read()[:300]}")
            return 1
        except Exception as e:
            print(f"❌ Chat-Error: {e}")
            return 1

        print(reply[:2000] + ("…" if len(reply) > 2000 else ""))
        messages.append({"role": "assistant", "content": reply})

        tools = parse_tools(reply)
        if not tools:
            if step >= 2:
                print("\n✅ Agent finished (finale Antwort ohne Tool).")
                return 0
            messages.append(
                {
                    "role": "user",
                    "content": "Please use tools (list_dir/read_file/write_file) or finish with tool call done.",
                }
            )
            continue

        result_chunks: list[str] = []
        finished = False
        for name, targs in tools:
            if name == "done":
                summary = targs.get("summary") or reply
                print("\n" + "═" * 48)
                print("✅ DONE")
                print(summary)
                finished = True
                break

            preview = {
                k: (v[:60] + "…" if k == "content" and len(v) > 60 else v)
                for k, v in targs.items()
            }
            print(f"🔧 {name} {preview}")
            result = run_tool(project, name, targs)
            if len(result) > MAX_TOOL_OUT:
                result = result[:MAX_TOOL_OUT] + "\n…[truncated]"
            print(f"↳ {result[:500]}{'…' if len(result) > 500 else ''}")
            result_chunks.append(f"TOOL RESULT [{name}]:\n{result}")

        if finished:
            return 0

        messages.append(
            {
                "role": "user",
                "content": "\n\n".join(result_chunks)
                + "\n\nContinue (more tools or done). Task must be complete.",
            }
        )

    print("\n⚠ Max steps reached. Check last state.")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
