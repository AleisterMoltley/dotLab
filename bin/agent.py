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

from cloud import chat as llm_chat, require_backend
from gmcommon import DEFAULT_MODEL, OLLAMA, ROOT, ollama_json
import identity as identitylib

MAX_STEPS = int(os.environ.get("GAMEMASTER_AGENT_STEPS", "20"))
MAX_FILE = 120_000
MAX_TOOL_OUT = 24_000
# set in main()
MODEL = DEFAULT_MODEL

SYSTEM_EXTRA = """
Format — exactly ONE tool block per reply, then wait for TOOL RESULT:

```
tool call TOOLNAME
key: value
```

Tools:
- list_dir → path: .
- read_file → path: src/main.js  optional start: N end: M
- apply_patch → path: src/game.js  search: exact lines  replace: new lines
- write_file → path: src/systems/foo.js  content: full file (NEW modules preferred; large game.js full replace is blocked)
- game_ops → events: JSON array of host events (preferred for feel/counts/palette/flags/engine)
- search → query: regex
- run → cmd: short safe command
- kit → action: todo_add|todo_done|todo_list|wiki_add|map|art_test|feel|verify|pixel
- done → summary: what + how to test

Efficiency: Prefer game_ops for feel/counts/palette/room/flags. MAP/WIKI first · surgical apply_patch for code.
Host owns craft/juice — do not rewrite CONFIG wholesale; use set_feel ops.
"""


def http_json(path: str, payload: dict | None = None, timeout: float = 600.0) -> dict:
    return ollama_json(path, payload, timeout=timeout)


def chat(messages: list[dict], model: str, temperature: float = 0.2, num_ctx: int | None = None) -> str:
    return llm_chat(
        messages,
        model=model,
        temperature=temperature,
        num_predict=int(os.environ.get("GAMEMASTER_PREDICT", "8192")),
        num_ctx=num_ctx,
    )


def parse_tool_body(body: str) -> dict:
    """Parse key: value lines; content/search/replace eat until next key / tool / fence."""
    lines = body.splitlines()
    data: dict[str, str] = {}
    i = 0
    multiline_keys = {"content", "search", "replace", "body", "patch", "events", "ops", "json"}
    key_line = re.compile(r"^([A-Za-z_][A-Za-z0-9_]*)\s*:\s*(.*)$")

    def is_new_key(s: str) -> bool:
        m = key_line.match(s)
        if not m:
            return False
        k = m.group(1).strip().lower()
        # path/query/cmd are single-line; don't treat indented code "foo: bar" inside body as keys
        # only known tool keys start a new field
        return k in {
            "path",
            "content",
            "search",
            "replace",
            "query",
            "cmd",
            "action",
            "summary",
            "start",
            "end",
            "glob",
            "body",
            "patch",
            "events",
            "ops",
            "json",
        }

    while i < len(lines):
        line = lines[i]
        if re.match(r"(?i)^\s*tool call\s+\w+", line):
            break
        if line.strip() == "```":
            break
        m = key_line.match(line)
        if not m:
            i += 1
            continue
        key = m.group(1).strip().lower()
        val = m.group(2)
        if key in multiline_keys:
            rest = [val] if val else []
            i += 1
            while i < len(lines):
                if re.match(r"(?i)^\s*tool call\s+\w+", lines[i]):
                    break
                if lines[i].strip() == "```":
                    break
                if is_new_key(lines[i]) and key_line.match(lines[i]).group(1).strip().lower() != key:
                    break
                rest.append(lines[i])
                i += 1
            blob = "\n".join(rest)
            blob = re.sub(r"\n```\s*$", "", blob)
            # strip one leading newline if value was empty on key line
            if blob.startswith("\n"):
                blob = blob[1:]
            data[key] = blob
            continue
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


def _slice_lines(text: str, start: str | None, end: str | None) -> str:
    lines = text.splitlines()
    try:
        a = max(1, int(start)) if start else 1
    except ValueError:
        a = 1
    try:
        b = int(end) if end else len(lines)
    except ValueError:
        b = len(lines)
    b = min(len(lines), max(a, b))
    chunk = "\n".join(lines[a - 1 : b])
    return f"lines {a}-{b} / {len(lines)}\n{chunk}"


def tool_read(project: Path, path: str, start: str | None = None, end: str | None = None) -> str:
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
    root = project.resolve()
    try:
        rel = f.resolve().relative_to(root)
    except ValueError:
        rel = f.name
    body = _slice_lines(text, start, end) if (start or end) else text
    return f"[path: {rel}]\n{body}"


def tool_write(project: Path, path: str, content: str) -> str:
    import security as seclib

    rel = (path or "").strip().lstrip("./")
    ok, err = seclib.write_allowed(project, rel)
    if not ok:
        seclib.audit(project, "write_denied", {"path": rel, "error": err})
        return f"ERROR: {err}"
    try:
        import engine_ops as eops

        eok, eerr = eops.engine_write_allowed(project, rel)
        if not eok:
            seclib.audit(project, "engine_write_denied", {"path": rel, "error": eerr})
            return f"ERROR: {eerr}"
    except Exception:
        pass
    # Secrets + package allowlist
    hits = seclib.scan_secrets(content or "", path=rel)
    if hits:
        seclib.audit(project, "secret_blocked", {"path": rel, "kind": hits[0].get("kind")})
        return f"ERROR: secret-like content blocked ({hits[0].get('kind')}) — remove keys before write"
    if rel == "package.json" or rel.endswith("/package.json"):
        pok, perr = seclib.validate_package_write(content or "")
        if not pok:
            return f"ERROR: {perr}"
        try:
            import engine_ops as eops
            import json as _json

            eng = eops.project_engine(project)
            data = _json.loads(content or "{}")
            deps = {
                **(data.get("dependencies") or {}),
                **(data.get("devDependencies") or {}),
            }
            if eng in ("pixel", "vintage") and "three" in deps:
                return f"ERROR: engine={eng} forbids three dependency"
        except Exception:
            pass
    # Patch-only gate: block full replace of large protected files
    try:
        import quality as qualitylib

        res = qualitylib.apply_full_write(project, rel, content or "", force=False)
        if not res.get("ok"):
            return (
                f"ERROR: {res.get('error')} — use tool call apply_patch with search/replace, "
                "or write a new file under src/systems/."
            )
        path = res.get("path") or rel
    except Exception:
        f = safe_path(project, path)
        f.parent.mkdir(parents=True, exist_ok=True)
        if f.exists() and f.stat().st_size > 0:
            bak = f.with_suffix(f.suffix + ".bak")
            bak.write_bytes(f.read_bytes())
        f.write_text(content, encoding="utf-8")
    seclib.audit(
        project,
        "write_file",
        {"path": path, "hash": seclib.content_hash(content or ""), "n": len(content or "")},
    )
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
    try:
        import quality as qualitylib

        qualitylib.log_accept_pair(
            project,
            instruction=f"write_file {path}",
            before="",
            after=(content or "")[:40_000],
            kind="write_file",
        )
    except Exception:
        pass
    return f"OK wrote {path} ({len(content)} chars)"


def tool_apply_patch(project: Path, path: str, search: str, replace: str) -> str:
    """Surgical search/replace — preferred over full write_file. AST-safe when possible."""
    import security as seclib

    rel = (path or "").strip().lstrip("./")
    ok, err = seclib.write_allowed(project, rel)
    if not ok:
        return f"ERROR: {err}"
    hits = seclib.scan_secrets(replace or "", path=rel)
    if hits:
        return f"ERROR: secret-like content blocked ({hits[0].get('kind')})"
    try:
        import quality as qualitylib

        before = qualitylib.snapshot_file(project, path)
        # Prefer AST-safe replace for .js
        if rel.endswith((".js", ".mjs")):
            res = qualitylib.ast_safe_replace(project, rel, search or "", replace or "")
        else:
            res = qualitylib.apply_search_replace(project, path, search or "", replace or "")
        if not res.get("ok"):
            return f"ERROR: {res.get('error')}"
        after = qualitylib.snapshot_file(project, path)
        seclib.audit(
            project,
            "apply_patch",
            {"path": rel, "mode": res.get("mode"), "hash": seclib.content_hash(after)},
        )
        try:
            qualitylib.log_accept_pair(
                project,
                instruction=f"apply_patch {path}",
                before=before[:40_000],
                after=after[:40_000],
                kind="apply_patch",
            )
        except Exception:
            pass
    except Exception as e:
        return f"ERROR: {e}"
    try:
        import live as livelib  # type: ignore

        livelib.emit(
            f"Patched {path}",
            role="file",
            phase="coding",
            headline=f"Patched {path}",
            reload=True,
        )
    except Exception:
        pass
    return f"OK patched {path} ({len(search or '')}→{len(replace or '')} chars)"


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


def tool_game_ops(project: Path, events_raw: str) -> str:
    """Host applies typed game ops (UPF-style)."""
    try:
        import game_ops as golib

        result = golib.apply_ops(project, events_raw or "[]", source="agent")
        # compact response for agent loop
        lines = [
            f"game_ops applied={result.get('applied')}/{result.get('total')} ok={result.get('ok')}",
        ]
        for r in result.get("results") or []:
            if r.get("ok"):
                extra = r.get("applied") or r.get("path") or r.get("id") or r.get("engine") or r.get("summary") or ""
                lines.append(f"  OK {r.get('type')}: {extra}"[:200])
            else:
                lines.append(f"  NO {r.get('type')}: {r.get('error')}"[:200])
        if result.get("locks"):
            lines.append("locks: " + ", ".join(result["locks"][:12]))
        if result.get("context"):
            lines.append("CONTEXT:\n" + str(result["context"])[:4000])
        if result.get("written"):
            lines.append("written: " + ", ".join(result["written"][:12]))
        return "\n".join(lines)
    except Exception as e:
        return f"ERROR game_ops: {e}"


def tool_run(project: Path, cmd: str) -> str:
    import security as seclib

    cmd = (cmd or "").strip()
    ok, reason = seclib.run_allowed(cmd)
    if not ok:
        seclib.audit(project, "run_denied", {"cmd": cmd[:200], "reason": reason})
        return f"ERROR: {reason}"
    # scrub env: do not pass cloud keys into child processes
    env = os.environ.copy()
    for k in list(env.keys()):
        if re.search(r"(?i)(API_KEY|SECRET|TOKEN|PASSWORD|PRIVATE)", k) and k not in (
            "PATH",
            "HOME",
            "USER",
            "LANG",
            "TERM",
        ):
            # keep PATH etc; drop secret-looking vars
            if k in (
                "XAI_API_KEY",
                "OPENAI_API_KEY",
                "ANTHROPIC_API_KEY",
                "GEMINI_API_KEY",
                "GITHUB_TOKEN",
                "GH_TOKEN",
            ):
                env.pop(k, None)
    try:
        r = subprocess.run(
            cmd,
            shell=True,
            cwd=str(project.resolve()),
            capture_output=True,
            text=True,
            timeout=120,
            env=env,
        )
        out = (r.stdout or "") + (r.stderr or "")
        out = out[-MAX_TOOL_OUT:]
        seclib.audit(project, "run", {"cmd": cmd[:200], "exit": r.returncode})
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
            return tool_read(
                project,
                args.get("path", ""),
                start=args.get("start"),
                end=args.get("end"),
            )
        if name == "write_file":
            return tool_write(project, args.get("path", ""), args.get("content", ""))
        if name in ("apply_patch", "patch"):
            return tool_apply_patch(
                project,
                args.get("path", ""),
                args.get("search", ""),
                args.get("replace", ""),
            )
        if name in ("game_ops", "ops", "events"):
            return tool_game_ops(
                project,
                args.get("events")
                or args.get("ops")
                or args.get("content")
                or args.get("json")
                or "",
            )
        if name == "search":
            return tool_search(project, args.get("query", ""), args.get("glob", ""))
        if name == "run":
            return tool_run(project, args.get("cmd", ""))
        if name == "kit":
            import kit as kitlib

            return kitlib.run_kit(project, args.get("action", ""), args)
        if name == "done":
            return args.get("summary", "done")
        return f"ERROR: unknown tool {name}"
    except Exception as e:
        return f"ERROR: {e}"


def load_knowledge(project: Path | None = None, task: str = "") -> str:
    chunks: list[str] = []
    # turbo slim packs by task keywords — prefill is the latency budget
    try:
        sys.path.insert(0, str(ROOT / "bin"))
        import turbo as turbolib  # type: ignore

        k = turbolib.select_knowledge(task or "three.js game agent", max_chars=12000)
        if k:
            chunks.append(k)
        ap = ROOT / "knowledge" / "agent-protocol.md"
        if ap.exists():
            chunks.append(ap.read_text(encoding="utf-8")[:2500])
    except Exception:
        for name in (
            "identity.md",
            "grok-craft.md",
            "brain.md",
            "game-systems.md",
            "threejs-cheatsheet.md",
            "threejs-recipes.md",
            "feel-tables.md",
            "agent-protocol.md",
        ):
            p = ROOT / "knowledge" / name
            if p.exists():
                chunks.append(p.read_text(encoding="utf-8")[:3500])
    try:
        import prefs as prefslib  # type: ignore

        pb = prefslib.format_prompt_block(prefslib.load_merged(project))
        if pb:
            chunks.insert(0, pb)
    except Exception:
        pass
    try:
        import wiki as wikilib  # type: ignore
        import security as seclib

        wb = wikilib.prompt_block(project) if project else ""
        if wb:
            # Untrusted project wiki — isolate from system instructions
            chunks.insert(0, seclib.isolate_untrusted(wb, source="wiki", max_chars=4000))
    except Exception:
        pass
    return "\n\n".join(chunks)


def main() -> int:
    ap = argparse.ArgumentParser(description="Gamemaster MAX Agent")
    ap.add_argument("-p", "--project", required=True, help="Project root")
    ap.add_argument("prompt", nargs="+", help="Aufgabe")
    ap.add_argument("-m", "--model", default=DEFAULT_MODEL)
    ap.add_argument("--cloud", default="", help="Optional paid provider: grok|claude|openai|gemini")
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

    if args.cloud:
        os.environ["GAMEMASTER_CLOUD"] = args.cloud
    require_backend()
    task = " ".join(args.prompt)

    # Instant craft first — many agent tasks are feel/count/palette
    try:
        import patch as patchlib

        patched = patchlib.try_patch(project, task)
        if patched and patched.get("ok"):
            print(patched.get("summary") or "patched")
            print("  (instant craft — skipped LLM agent loop)")
            return 0
    except Exception:
        pass

    knowledge = "" if args.no_knowledge else load_knowledge(project, task)
    # Slice RAG + anti-slop gallery
    try:
        import rag as raglib
        import security as seclib
        import antislope as aslib
        import quality as qualitylib

        rb = raglib.prompt_block(task, k=3, max_chars=2200)
        if rb:
            knowledge = (
                knowledge + "\n\n" + seclib.isolate_untrusted(rb, source="rag", max_chars=2200)
            ) if knowledge else seclib.isolate_untrusted(rb, source="rag", max_chars=2200)
        gal = aslib.gallery_prompt_block(task, max_chars=1600)
        if gal:
            knowledge = (knowledge + "\n\n" + gal) if knowledge else gal
        knowledge = (knowledge or "") + "\n\n" + aslib.SLOT_JSON_ONLY + "\n" + qualitylib.CODER_PATCH_INSTRUCTION
        try:
            import game_ops as golib

            knowledge += "\n\n" + golib.OPS_INSTRUCTION
        except Exception:
            pass
    except Exception:
        pass
    route = {"model": model, "num_ctx": 16384, "num_predict": 6144, "temperature": 0.18, "tier": "max"}
    try:
        import turbo as turbolib

        route = turbolib.route_task(task)
        if args.model == DEFAULT_MODEL:
            model = route.get("model") or model
    except Exception:
        pass
    # Dual keep-alive (flash+max) — non-blocking if already warm
    try:
        import quality as qualitylib

        qualitylib.ensure_dual_warmup(force=False)
    except Exception:
        pass

    # Step budget: continue-style short, full feature longer
    step_budget = args.steps
    if args.steps == MAX_STEPS:
        if re.search(r"(?i)\b(fix|tweak|floaty|faster|slower|feel|jump|enemy|hp|juice)\b", task) and len(task) < 160:
            step_budget = int(os.environ.get("DOTLAB_STEPS_CONTINUE", "4"))
        elif re.search(r"(?i)\b(add|implement|feature|weapon|dialogue|boss)\b", task):
            step_budget = int(os.environ.get("DOTLAB_STEPS_FEATURE", "8"))
        else:
            step_budget = min(args.steps, int(os.environ.get("DOTLAB_STEPS_DEFAULT", "10")))

    system = (
        identitylib.system_for("agent", extra_packs=False)
        + "\nHonor USER PREFERENCE MEMORY. Prefer apply_patch over full rewrites.\n"
        + "First tool should be read_file or apply_patch — avoid list_dir loops.\n"
        + SYSTEM_EXTRA
        + ("\n\n# Knowledge\n" + knowledge if knowledge else "")
    )

    num_ctx = int(os.environ.get("GAMEMASTER_NUM_CTX", str(route.get("num_ctx") or 16384)))
    has_map = (project / "MAP.md").is_file() or (project / "WIKI.md").is_file()
    start_hint = (
        "read_file path: src/game.js start: 1 end: 80 — then apply_patch. done when P0-safe."
        if has_map
        else "read_file path: src/game.js — then apply_patch. Avoid list_dir. done when P0-safe."
    )

    messages = [
        {"role": "system", "content": system},
        {
            "role": "user",
            "content": (
                f"Project: (root hidden — use relative paths)\n\nTask:\n{task}\n\n"
                f"{start_hint}"
            ),
        },
    ]

    print(f"🤖 MAX Agent · model={model} · ctx={num_ctx} · steps≤{step_budget} · turbo knowledge")
    print(f"📁 {project}")
    print(f"🎯 {task}")
    print("─" * 48)

    verify_repair_used = False
    list_dir_count = 0
    for step in range(1, step_budget + 1):
        print(f"\n──  {step}/{step_budget} ──")
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
                try:
                    import verify as verifylib

                    vr = verifylib.evaluate(project)
                    print(vr["report"])
                    if vr.get("p0_fail") and not verify_repair_used:
                        verify_repair_used = True
                        print("  ⚠ verify P0 — one repair pass")
                        result_chunks.append(verifylib.repair_prompt(vr))
                        break
                except Exception as e:
                    print(f"  ⚠ verify skipped: {e}")
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
            if name == "list_dir":
                list_dir_count += 1
                if list_dir_count > 2:
                    result = "ERROR: list_dir budget exhausted — read_file or apply_patch instead"
                else:
                    result = run_tool(project, name, targs)
            else:
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
