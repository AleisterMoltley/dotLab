#!/usr/bin/env python3
"""
Deep build — recursive coding loop for games.

A one-shot dump of the whole project into the model produces toys.
Here the project is an environment: the root peeks and greps, then
recursively `sub()`s a narrow task over a narrow snippet. Host applies
tools. Depth bar refuses a plaza with no opposition.

  gamemaster rlm -p DIR "deepen the slice"
  gamemaster studio build -p DIR "…"          # deep coder is the default
  gamemaster studio build -p DIR "…" --flat   # single-pass coder

No free Python eval. REPL verbs are host-parsed (stdlib only).
"""
from __future__ import annotations

import argparse
import json
import os
import re
import time
from pathlib import Path
from typing import Any

from gmcommon import DEFAULT_MODEL, meta_dir

MAX_PEEK = 12_000
MAX_GREP_HITS = 24
MAX_STEPS_ROOT = int(os.environ.get("DOTLAB_RLM_STEPS", "10"))
MAX_STEPS_SUB = int(os.environ.get("DOTLAB_RLM_SUB_STEPS", "6"))
DEFAULT_DEPTH = 1  # root=0 can call LM, not other RLMs (paper default)

# Host-owned decomposition. The model may rename; it may not drop a pillar.
PILLARS = ("place", "body", "verb", "opposition", "juice")

_SYSTEMS: dict[str, list[dict[str, str]]] = {
    "racing": [
        {"id": "track", "pillar": "place", "does": "lanes, gates, lap line, off-track death"},
        {"id": "craft", "pillar": "body", "does": "accel, drift/slide, boost, chase camera"},
        {"id": "gates", "pillar": "verb", "does": "hit gates in order, lap count, finish"},
        {"id": "rivals", "pillar": "opposition", "does": "≥3 AI racers with names and rubber-band"},
        {"id": "juice", "pillar": "juice", "does": "boost flash, gate punch, crash shake, audio"},
    ],
    "fps": [
        {"id": "arena", "pillar": "place", "does": "readable neon place, cover, threat contrast"},
        {"id": "move", "pillar": "body", "does": "WASD+look, coyote, dash, ADS"},
        {"id": "gun", "pillar": "verb", "does": "hitscan, heat, tracer, fire-rate"},
        {"id": "wave", "pillar": "opposition", "does": "≥1 personality, telegraph, wave pressure"},
        {"id": "juice", "pillar": "juice", "does": "hitstop, hitmarker, kill callout, layered sfx"},
    ],
    "arena": [
        {"id": "pit", "pillar": "place", "does": "arena floor, lanes, pickups"},
        {"id": "twin", "pillar": "body", "does": "twin-stick or top-down move + dash"},
        {"id": "blast", "pillar": "verb", "does": "shoot / slam with cooldown"},
        {"id": "horde", "pillar": "opposition", "does": "two spawn lanes, elite every N"},
        {"id": "juice", "pillar": "juice", "does": "hitstop, flash, score punch"},
    ],
    "platformer": [
        {"id": "level", "pillar": "place", "does": "platforms, pits, readable first screen"},
        {"id": "jump", "pillar": "body", "does": "accel, coyote, buffer, jump-cut"},
        {"id": "collect", "pillar": "verb", "does": "gems or flag, t=8s obvious"},
        {"id": "hazards", "pillar": "opposition", "does": "movers, spikes, one fair death"},
        {"id": "juice", "pillar": "juice", "does": "land squash, collect ping, death flash"},
    ],
    "runner": [
        {"id": "lane", "pillar": "place", "does": "three lanes, scrolling set dressing"},
        {"id": "run", "pillar": "body", "does": "auto-run, A/D swap, jump"},
        {"id": "dodge", "pillar": "verb", "does": "near-miss, hold streak"},
        {"id": "obstacles", "pillar": "opposition", "does": "patterned hazards, density ramp"},
        {"id": "juice", "pillar": "juice", "does": "near-miss flash, crash, speed FOV"},
    ],
    "adventure": [
        {"id": "place", "pillar": "place", "does": "readable first room, landmark, door"},
        {"id": "walk", "pillar": "body", "does": "accel/friction walk, interact range"},
        {"id": "talk", "pillar": "verb", "does": "NPC / object at t=8s, a flag flips"},
        {"id": "block", "pillar": "opposition", "does": "locked path or wanderer until the flag"},
        {"id": "juice", "pillar": "juice", "does": "talk blip, flag flash, door open"},
    ],
    "horror": [
        {"id": "dark", "pillar": "place", "does": "tight fog, one safe light, one threat lane"},
        {"id": "creep", "pillar": "body", "does": "slow walk, no sprint-win, listen"},
        {"id": "hide", "pillar": "verb", "does": "reach the door without being seen"},
        {"id": "hunter", "pillar": "opposition", "does": "one hunter, telegraph, commit"},
        {"id": "juice", "pillar": "juice", "does": "heartbeat, spotted sting, door slam"},
    ],
    "rpg": [
        {"id": "town", "pillar": "place", "does": "hub + one threat space"},
        {"id": "party", "pillar": "body", "does": "walk, menu, one combat verb"},
        {"id": "quest", "pillar": "verb", "does": "talk → flag → door / turn"},
        {"id": "foe", "pillar": "opposition", "does": "one encounter with telegraph"},
        {"id": "juice", "pillar": "juice", "does": "hit number, level ding, fanfare"},
    ],
    "puzzle": [
        {"id": "board", "pillar": "place", "does": "readable grid / room, goal marked"},
        {"id": "cursor", "pillar": "body", "does": "move / grab with snap"},
        {"id": "solve", "pillar": "verb", "does": "one rule, first solve <30s"},
        {"id": "trap", "pillar": "opposition", "does": "wrong move costs, reset fair"},
        {"id": "juice", "pillar": "juice", "does": "snap, clear flash, fail thunk"},
    ],
}

_DEFAULT_SYSTEMS = [
    {"id": "place", "pillar": "place", "does": "readable space, landmark, light=bg"},
    {"id": "body", "pillar": "body", "does": "accel/friction or genre-correct feel"},
    {"id": "verb", "pillar": "verb", "does": "one obvious action at t=8s"},
    {"id": "foes", "pillar": "opposition", "does": "something that pushes back"},
    {"id": "juice", "pillar": "juice", "does": "feedback on every meaningful hit"},
]

_REPL_LINE = re.compile(
    r"^(peek|grep|files|plan|sub|verify|game_ops|done)\s*\((.*)\)\s*$",
    re.I | re.S,
)
_FINAL = re.compile(r"FINAL(?:_VAR)?\s*\((.*)\)\s*$", re.I | re.S)
_FENCE_REPL = re.compile(r"```(?:repl|rlm)?\s*\n(.*?)```", re.S | re.I)


def _spec(project: Path) -> dict[str, Any]:
    for folder in (".dotlab", ".gamemaster"):
        p = project / folder / "slice.json"
        if p.is_file():
            try:
                data = json.loads(p.read_text(encoding="utf-8"))
                if isinstance(data, dict):
                    return data
            except Exception:
                pass
    return {}


_LOOP_FAMILY = {
    "shoot": "fps",
    "race": "racing",
    "jump": "platformer",
    "run": "runner",
    "talk": "adventure",
    "sneak": "horror",
    "collect": "puzzle",
}


def _family(spec: dict[str, Any], query: str = "") -> str:
    g = str(spec.get("genre") or "").lower()
    loop = str(spec.get("loop") or "").lower()
    if g in _SYSTEMS:
        return g
    if g in ("tps", "open-world", "sandbox"):
        return "adventure"
    if g in ("card", "idle", "tycoon", "sports", "rhythm"):
        return "puzzle"
    if g == "tower-defense":
        return "arena"
    if loop in _LOOP_FAMILY:
        return _LOOP_FAMILY[loop]
    blob = f"{g} {loop} {query}".lower()
    for key, fam in (
        ("race", "racing"),
        ("fps", "fps"),
        ("shoot", "fps"),
        ("arena", "arena"),
        ("platform", "platformer"),
        ("runner", "runner"),
        ("horror", "horror"),
        ("sneak", "horror"),
        ("npc", "adventure"),
        ("village", "adventure"),
        ("talk", "adventure"),
        ("quest", "rpg"),
        ("puzzle", "puzzle"),
    ):
        if key in blob:
            return fam
    return g or "default"


def decompose_spec(spec: dict[str, Any], query: str = "") -> list[dict[str, str]]:
    """Host plan from a slice spec. Five pillars. The model may not drop one."""
    fam = _family(spec or {}, query)
    rows = [dict(s) for s in _SYSTEMS.get(fam, _DEFAULT_SYSTEMS)]
    for s in rows:
        s.setdefault("file", f"src/systems/{s['id']}.js")
        s.setdefault("family", fam)
    return rows


def decompose(project: Path, query: str = "") -> list[dict[str, str]]:
    return decompose_spec(_spec(project), query)


def stamp_spec(spec: dict[str, Any], query: str = "") -> dict[str, Any]:
    """Attach the host pillar plan so every new slice carries the floor."""
    out = dict(spec or {})
    out["pillars"] = decompose_spec(out, query or str(out.get("prompt") or ""))
    out["floor"] = "v1"
    return out


def prompt_block(project: Path | None, task: str = "", max_chars: int = 900) -> str:
    """Injected into agent/studio so every coder sees the five pillars."""
    spec = _spec(project) if project else {}
    rows = decompose_spec(spec, task)
    fam = rows[0].get("family") if rows else "default"
    lines = [
        "PILLARS (host-owned). A slice missing one is a toy — do not ship it.",
        f"family={fam}",
    ]
    for s in rows:
        lines.append(f"- {s['pillar']}: {s['does']}")
    lines.append("Deepen opposition first. Feel numbers via game_ops. Code via apply_patch.")
    return "\n".join(lines)[:max_chars]


def list_files(project: Path) -> list[dict[str, Any]]:
    skip = {"node_modules", ".git", "dist", "build", ".vite"}
    out: list[dict[str, Any]] = []
    for dirpath, dirnames, filenames in os.walk(project):
        dirnames[:] = [d for d in dirnames if d not in skip and not d.startswith(".")]
        for name in filenames:
            if name.startswith("."):
                continue
            p = Path(dirpath) / name
            rel = str(p.relative_to(project))
            if p.suffix.lower() not in {".js", ".mjs", ".html", ".css", ".md", ".json"}:
                continue
            if rel.startswith("src/pixelart/") or rel.startswith("src/craft/"):
                continue
            try:
                n = p.stat().st_size
            except OSError:
                continue
            out.append({"path": rel, "bytes": n})
    out.sort(key=lambda x: x["path"])
    return out


def peek(project: Path, path: str, start: int = 1, end: int = 80) -> str:
    rel = (path or "").strip().lstrip("./")
    f = (project / rel).resolve()
    if not str(f).startswith(str(project.resolve())):
        return "ERROR: path outside project"
    if not f.is_file():
        return f"ERROR: missing {rel}"
    lines = f.read_text(encoding="utf-8", errors="replace").splitlines()
    a = max(1, int(start or 1))
    b = min(len(lines), int(end or a + 79))
    chunk = "\n".join(f"{i}|{lines[i - 1]}" for i in range(a, b + 1))
    if len(chunk) > MAX_PEEK:
        chunk = chunk[:MAX_PEEK] + "\n…[truncated]"
    return f"{rel} lines {a}-{b}/{len(lines)}\n{chunk}"


def grep(project: Path, pattern: str) -> str:
    try:
        rx = re.compile(pattern)
    except re.error as e:
        return f"ERROR regex: {e}"
    hits: list[str] = []
    for info in list_files(project):
        p = project / info["path"]
        try:
            text = p.read_text(encoding="utf-8", errors="replace")
        except Exception:
            continue
        for i, line in enumerate(text.splitlines(), 1):
            if rx.search(line):
                hits.append(f"{info['path']}:{i}: {line.strip()[:180]}")
                if len(hits) >= MAX_GREP_HITS:
                    return "\n".join(hits)
    return "\n".join(hits) if hits else "(no matches)"


def _gameplay_js(js: str) -> str:
    """Drop SPEC/CONFIG JSON so counts in the blob cannot fake depth."""
    js = re.sub(r"const SPEC = \{.*?\};", "", js, flags=re.S)
    js = re.sub(r"const CONFIG = \{.*?\};", "", js, flags=re.S)
    return js


def _js_blob(project: Path) -> str:
    parts: list[str] = []
    for info in list_files(project):
        if not info["path"].endswith((".js", ".mjs")):
            continue
        try:
            parts.append((project / info["path"]).read_text(encoding="utf-8", errors="replace"))
        except Exception:
            pass
    return "\n".join(parts)


def depth_report(project: Path) -> dict[str, Any]:
    """Toy vs real. Not a P0 verify — this is the 'games are simple' gate."""
    spec = _spec(project)
    js = _gameplay_js(_js_blob(project))
    fam = _family(spec)
    systems = (
        [p for p in (project / "src" / "systems").glob("*.js")]
        if (project / "src" / "systems").is_dir()
        else []
    )
    enemies = int(spec.get("enemyCount") or 0)
    coins = int(spec.get("coinCount") or 0)
    hazards = int(spec.get("hazardCount") or 0)
    rooms = int(spec.get("roomCount") or 1)
    has_opp = bool(
        re.search(
            r"rivals?|foes?|enem(?:y|ies)|hazard|gate|hunter|npc|obstacle|wave",
            js,
            re.I,
        )
    )
    fails: list[str] = []
    if enemies + coins + hazards == 0 and not has_opp:
        fails.append("no opposition")
    if not re.search(r"sfx\(|TimeJuice|pxShake|shake|hitstop|blip\(", js):
        fails.append("no juice")
    if fam == "racing" and not re.search(r"rival|gate|lap", js, re.I):
        fails.append("race field empty")
    if fam in ("fps", "arena") and not re.search(r"wave|hitstop|hitscan|fireCd", js, re.I):
        fails.append("shooter: no combat loop")
    if fam == "platformer" and not re.search(r"coyote|jumpForce|jump", js, re.I):
        fails.append("platformer: no jump feel")
    if fam == "adventure" and not re.search(r"npc|talk|interact|KeyE", js, re.I):
        fails.append("adventure: no interact")
    if fam == "horror" and not re.search(r"hunter|sneak|door", js, re.I):
        fails.append("horror: no hunter")
    if rooms < 2 and fam not in ("puzzle",) and len(systems) < 2:
        if not re.search(r"lap|wave|roomCount", js):
            fails.append("one empty room")
    if len(js) < 2500 and not systems:
        fails.append("thin single file")
    score = max(0, 100 - 18 * len(fails))
    return {
        "ok": not fails,
        "score": score,
        "fails": fails,
        "family": fam,
        "systems": [p.name for p in systems],
        "counts": {"enemy": enemies, "coin": coins, "hazard": hazards, "room": rooms},
    }


def parse_repl(text: str) -> list[tuple[str, dict[str, str]]]:
    """Host-parsed REPL. Never eval. Agent-style tools also accepted."""
    import agent as agentlib

    tools = agentlib.parse_tools(text)
    if tools:
        return [(n, {str(k): str(v) for k, v in a.items()}) for n, a in tools]
    out: list[tuple[str, dict[str, str]]] = []
    mfin = _FINAL.search(text or "")
    if mfin:
        out.append(("done", {"summary": mfin.group(1).strip().strip("'\"")}))
        return out
    bodies: list[str] = []
    for m in _FENCE_REPL.finditer(text or ""):
        bodies.append(m.group(1))
    if not bodies:
        bodies = [text or ""]
    for body in bodies:
        for raw in body.splitlines():
            line = raw.strip()
            if not line or line.startswith("#"):
                continue
            mm = _REPL_LINE.match(line)
            if not mm:
                continue
            name = mm.group(1).lower()
            arg = (mm.group(2) or "").strip()
            out.append((name, _parse_args(name, arg)))
    return out


def _parse_args(name: str, arg: str) -> dict[str, str]:
    arg = arg.strip()
    if name == "files":
        return {}
    if name == "plan":
        return {}
    if name == "verify":
        return {}
    if name == "done":
        return {"summary": arg.strip("'\"")}
    if name == "grep":
        return {"query": arg.strip("'\"")}
    if name == "peek":
        parts = [p.strip().strip("'\"") for p in arg.split(",")]
        d = {"path": parts[0] if parts else ""}
        if len(parts) > 1:
            d["start"] = parts[1]
        if len(parts) > 2:
            d["end"] = parts[2]
        return d
    if name == "sub":
        # sub("task", files=["a.js","b.js"])  or  sub("task")
        task = arg
        files = ""
        fm = re.search(r"files\s*=\s*\[([^\]]*)\]", arg)
        if fm:
            files = ",".join(x.strip().strip("'\"") for x in fm.group(1).split(",") if x.strip())
            task = arg[: fm.start()].rstrip().rstrip(",").strip()
        task = task.strip().strip("'\"")
        return {"task": task, "files": files}
    if name == "game_ops":
        return {"events": arg}
    return {"text": arg}


def run_tool(project: Path, name: str, args: dict[str, str], *, query: str = "") -> str:
    if name == "files":
        rows = list_files(project)
        return "\n".join(f"{r['bytes']:6}  {r['path']}" for r in rows) or "(empty)"
    if name == "peek":
        try:
            start = int(args.get("start") or 1)
        except ValueError:
            start = 1
        try:
            end = int(args.get("end") or start + 79)
        except ValueError:
            end = start + 79
        return peek(project, args.get("path") or args.get("text") or "", start, end)
    if name == "grep":
        return grep(project, args.get("query") or args.get("text") or "")
    if name == "plan":
        rows = decompose(project, query)
        return json.dumps(rows, indent=2)
    if name == "verify":
        import verify as verifylib

        vr = verifylib.evaluate(project)
        dr = depth_report(project)
        return vr["report"] + "\nDEPTH " + json.dumps(dr)
    if name == "game_ops":
        import game_ops as golib

        r = golib.apply_ops(project, args.get("events") or "[]", source="rlm")
        return json.dumps({k: r.get(k) for k in ("ok", "applied", "total")})
    if name == "done":
        return args.get("summary") or "done"
    return f"ERROR: unknown repl verb {name}"


def _root_system(query: str, files: list[dict[str, Any]], systems: list[dict[str, str]]) -> str:
    listing = "\n".join(f"  {r['bytes']:6}  {r['path']}" for r in files[:40])
    plan = "\n".join(f"  - {s['id']} [{s['pillar']}]: {s['does']}" for s in systems)
    return f"""You are the ROOT of a Recursive Language Model building a game.
You do NOT see the source. The project lives in a REPL. Peek, then sub().

Query: {query}

Files (sizes only):
{listing}

Host plan (do not drop a pillar):
{plan}

Verbs — emit ONE ```repl block, then wait:
  files()
  peek("src/game.js", 1, 80)
  grep("tickRace")
  plan()
  sub("narrow task", files=["src/game.js"])
  verify()
  game_ops([{{"type":"set_feel","gravity":28}}])
  done("what shipped")

Rules:
- First peek the loop (tickShoot / tickJump / tickRace / createGame). Never guess file contents.
- Each sub() is ONE pillar. Context for that sub is ONLY the files you name.
- Opposition is mandatory. A plaza with one hoop is a fail.
- Prefer game_ops for feel numbers. Prefer apply_patch-shaped subs for code.
- When depth+verify are green, FINAL(summary) or done("…").
"""


def _sub_system(task: str, snippets: str) -> str:
    return f"""You are a recursive SUB-call. You see ONLY the snippet below.
Implement this ONE task. Do not rewrite the whole game. Do not add new genres.

Task: {task}

Context (this is all you get):
{snippets}

Use exactly one tool:
```
tool call apply_patch
path: src/game.js
search:
exact lines
replace:
new lines
```
or tool call write_file for a NEW src/systems/*.js.
Then stop. The root will verify.
"""


def _chat(messages: list[dict], model: str) -> str:
    from cloud import chat as llm_chat

    return llm_chat(
        messages,
        model=model,
        temperature=0.15,
        num_predict=int(os.environ.get("GAMEMASTER_PREDICT", "4096")),
        num_ctx=int(os.environ.get("GAMEMASTER_NUM_CTX", "8192")),
    )


def _load_snippets(project: Path, files_csv: str, fallback: str = "src/game.js") -> str:
    paths = [p.strip() for p in (files_csv or fallback).split(",") if p.strip()]
    chunks: list[str] = []
    for rel in paths[:4]:
        chunks.append(peek(project, rel, 1, 220))
    return "\n\n".join(chunks)[:16_000]


def run_sub(
    project: Path,
    task: str,
    files_csv: str,
    model: str,
    *,
    depth: int,
    max_depth: int,
) -> str:
    """Isolated LM call. Context = named files only. No knowledge dump."""
    if depth > max_depth:
        return "ERROR: max RLM depth — implement here or done"
    snippets = _load_snippets(project, files_csv)
    messages = [
        {"role": "system", "content": _sub_system(task, snippets)},
        {"role": "user", "content": task},
    ]
    import agent as agentlib

    logs: list[str] = []
    for step in range(1, MAX_STEPS_SUB + 1):
        try:
            reply = _chat(messages, model)
        except Exception as e:
            return f"ERROR sub chat: {e}"
        messages.append({"role": "assistant", "content": reply})
        tools = agentlib.parse_tools(reply)
        if not tools:
            logs.append(reply[:400])
            break
        chunks: list[str] = []
        for name, targs in tools:
            if name == "done":
                logs.append(targs.get("summary") or "sub done")
                return "\n".join(logs)
            if name == "sub":
                chunks.append("ERROR: nested sub blocked at this depth")
                continue
            result = agentlib.run_tool(project, name, targs)
            chunks.append(f"TOOL [{name}]: {result[:1500]}")
            logs.append(f"sub:{name} → {result[:200]}")
        messages.append({"role": "user", "content": "\n".join(chunks) + "\nStop after this if the task is in."})
        if step >= 3:
            break
    return "\n".join(logs) or "sub: no tool"


def run(
    project: Path,
    query: str,
    *,
    model: str = "",
    max_depth: int = DEFAULT_DEPTH,
    steps: int = MAX_STEPS_ROOT,
) -> dict[str, Any]:
    """RLM(q, C) → str, with C = the project environment."""
    model = model or os.environ.get("GAMEMASTER_MODEL") or DEFAULT_MODEL
    systems = decompose(project, query)
    files = list_files(project)
    log: list[dict[str, Any]] = []
    print(f"🔁 RLM · depth≤{max_depth} · {len(systems)} pillars · {len(files)} files")
    print(f"🎯 {query}")
    for s in systems:
        print(f"   · {s['id']}: {s['does']}")

    # Host bootstrap: if the slice is a toy, tell the root explicitly.
    toy = depth_report(project)
    hint = ""
    if not toy.get("ok"):
        hint = "DEPTH FAIL: " + ", ".join(toy.get("fails") or []) + ". sub() each missing pillar."

    messages = [
        {"role": "system", "content": _root_system(query, files, systems)},
        {
            "role": "user",
            "content": (
                f"{hint}\nStart: peek the main loop, then sub() opposition first."
                if hint
                else "Start: files() then peek the main loop. Opposition first."
            ),
        },
    ]

    summary = ""
    for step in range(1, steps + 1):
        print(f"\n── rlm {step}/{steps} ──")
        try:
            reply = _chat(messages, model)
        except Exception as e:
            print(f"❌ {e}")
            return {"ok": False, "error": str(e), "log": log, "depth": depth_report(project)}
        print(reply[:1600] + ("…" if len(reply) > 1600 else ""))
        messages.append({"role": "assistant", "content": reply})
        calls = parse_repl(reply)
        if not calls:
            messages.append(
                {
                    "role": "user",
                    "content": "Use a ```repl block (peek/sub/verify/done). Do not write the whole game in prose.",
                }
            )
            continue
        chunks: list[str] = []
        stop = False
        for name, args in calls:
            print(f"🔧 {name} { {k: (v[:50] + '…' if len(v) > 50 else v) for k, v in args.items()} }")
            if name == "sub":
                result = run_sub(
                    project,
                    args.get("task") or args.get("text") or query,
                    args.get("files") or "src/game.js",
                    model,
                    depth=1,
                    max_depth=max_depth,
                )
            elif name == "done":
                summary = args.get("summary") or reply
                result = run_tool(project, "verify", {}, query=query)
                stop = True
            else:
                result = run_tool(project, name, args, query=query)
            log.append({"t": time.time(), "verb": name, "args": args, "out": result[:2000]})
            print(f"↳ {result[:400]}{'…' if len(result) > 400 else ''}")
            chunks.append(f"REPL [{name}]:\n{result[:4000]}")
        if stop:
            break
        messages.append(
            {
                "role": "user",
                "content": "\n\n".join(chunks) + "\n\nNext peek/sub/verify, or done when depth is green.",
            }
        )

    final = depth_report(project)
    session = meta_dir(project) / "rlm"
    session.mkdir(parents=True, exist_ok=True)
    (session / "last.json").write_text(
        json.dumps({"query": query, "summary": summary, "depth": final, "log": log[-20:]}, indent=2)
        + "\n",
        encoding="utf-8",
    )
    print("\n" + ("✅" if final.get("ok") else "⚠") + f" depth {final.get('score')} {final.get('fails')}")
    return {"ok": bool(final.get("ok")), "summary": summary, "depth": final, "log": log}


def main() -> int:
    ap = argparse.ArgumentParser(description="dotLab deep build — recursive game coder")
    ap.add_argument("-p", "--project", required=True)
    ap.add_argument("query", nargs="+")
    ap.add_argument("-m", "--model", default="")
    ap.add_argument("--depth", type=int, default=DEFAULT_DEPTH)
    ap.add_argument("--steps", type=int, default=MAX_STEPS_ROOT)
    ap.add_argument("--plan", action="store_true", help="print host plan, no LLM")
    ap.add_argument("--report", action="store_true", help="depth report only")
    args = ap.parse_args()
    project = Path(args.project).expanduser().resolve()
    if not project.is_dir():
        print(f"Project not found: {project}")
        return 1
    q = " ".join(args.query)
    if args.plan:
        print(json.dumps(decompose(project, q), indent=2))
        return 0
    if args.report:
        print(json.dumps(depth_report(project), indent=2))
        return 0 if depth_report(project).get("ok") else 2
    from cloud import require_backend

    require_backend()
    r = run(project, q, model=args.model, max_depth=args.depth, steps=args.steps)
    return 0 if r.get("ok") else 1


if __name__ == "__main__":
    raise SystemExit(main())
