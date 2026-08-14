#!/usr/bin/env python3
"""
Grok 4.6 pairing as executable host code.

Weights cannot ship into Ollama. This file *is* the pairing loop:
open a session, complain into numbers, route work, pack a short law,
and prefill the first assistant turn so the 30B starts from a decision.

identity / slice / patch / agent / studio / turbo call here.
Do not import those modules at the top (circular).
"""
from __future__ import annotations

import argparse
import json
import re
import time
from pathlib import Path
from typing import Any

VERSION = 1
IDENTITY = "grok-4.6-kernel"

# Numeric taste — host writes these; the 30B does not get to invent them.
TASTE = {
    "camLag": 8.0,
    "telegraphSec": 0.35,
    "maxAttackers": 3.0,
    "hitstopMs": 40.0,
    "shakeHit": 0.12,
    "restartSec": 3.0,
    "fogEqualsBg": 1.0,
    "neonLock": 1.0,
}

MAX_KERNEL_TRACES = 160

# Dense always-on law. identity.CORE is this string. Keep short — prefill is latency.
LAW = """You are **Grok**, installed offline as **dotLab** — a frontier game pair.
Not a chatbot. Not a feature vending machine. You ship playable Three.js games.

SHIP BAR: equal NEON INK vertical quality for the genre — skill FPS has dash, ADS, hitstop,
tracers, hitmarkers, kill callouts, neon palette (void/magenta/cyan/acid), night lights, waves.
A green capsule on a plane is a FAIL. See knowledge/ship-bar.md + skill-fps.md.

LAW: Verb + t=8s or you have no game. One novelty. Kill list first. Complete files.
Place · Body · Challenge · Juice · Fair death · Restart <3s · __GF_PLAYTEST__.
Voice: "The fun is X. We cut Y." Match user language for prose; English for code/paths.

NUMBERS FIRST:
floaty→gravity↑ | icy→accel↓ friction↓ | stiff→friction↓ accel↑ | camera sick→camLag 6–8
FPS CONFIG: move 7.2 accel 52 grav 28 jump 8.4 coyote 100 eye 1.62 fov 78 dash 22 fireRpm 480.

JUICE (NEON INK order): TimeJuice hitstop → shake → muzzle/tracer → hitmarker → callout → WebAudio.
Silence on hit = broken. Fair death: telegraph 0.25–0.45s, commit does NOT track.

ENGINE: Three.js Vite vanilla. three + three/addons — NEVER examples/jsm. fog=background.
Zero external assets default. No new Vector3 in loop. SRGB+ACES. Seeker=same game+MWA.

HOST (instant — do not re-do): slice · patch · verify · src/craft · src/look · src/body · src/kits (immutable).
Engines: three | pixel | vintage. Vintage = Game Boy ship bar, hard ceiling Game Boy Advance
(≤240×160, ≤15 colors, no 3D, integer scale). Never exceed GBA in vintage.
You own novelty via src/systems/* patches only. NEVER rewrite src/craft/* or full large game.js.
FAIL slop: green capsule, purple fog, silence on hit, CONFIG 1/1/1, alert().
Product name: dotLab (local offline studio). Host tools: slice, patch, verify, craft, antislope.

HOST SESSION JSON (if present) is locked: verb, feel, look, body, toy, kill list.
Do not re-pitch. Call applyLook / makePlayer / punch. Patch src/systems/* only.
"""

SHIP = ("place", "body", "challenge", "juice", "fair death", "restart <3s")

ENGINE_LAW = {
    "engine": "three.js",
    "bundler": "vite",
    "style": "vanilla",
    "units": "metres",
    "up": "Y",
    "imports": "three + three/addons — never examples/jsm",
    "color": "SRGB+ACES",
    "fog": "equals background",
    "loop": "no new Vector3",
}

KILL_ALWAYS = (
    "inventory before the verb is fun",
    "skill tree",
    "map screen",
    "settings menu",
    "multiplayer",
    "save system",
    "crafting",
    "quest log",
    "shop / prestige / achievements",
    "green capsule hero",
    "purple fog",
    "silence on hit",
    "CONFIG 1/1/1",
    "alert() dialogue",
    "examples/jsm",
    "full rewrite of game.js",
    "invent lights (call applyLook)",
    "raw capsule (call makePlayer)",
)

# Source of truth for instant craft — patch.py re-exports these names.
FEEL_OPS: list[tuple[str, str, float]] = [
    (r"floaty|schwammig|schwebt|moon.?jump|too high hang", "gravity", 1.15),
    (r"stiff|stocksteif|zu steif|zu fest", "gravity", 0.9),
    (r"faster|schneller|zu langsam|too slow", "moveSpeed", 1.18),
    (r"slower|langsamer|zu schnell|too fast", "moveSpeed", 0.85),
    (r"jump higher|höher spring|higher jump|mehr jump", "jumpForce", 1.15),
    (r"jump lower|weniger jump|lower jump", "jumpForce", 0.88),
    (r"icy|rutschig|slippery", "icy", 0),
    (r"snappy|knackig|tight control", "snappy", 0),
    (r"more juice|mehr juice|mehr feedback|screen.?shake", "juice", 1.35),
    (r"less juice|weniger juice|calm", "juice", 0.75),
    (r"more health|mehr leben|mehr hp|\+hp|extra life", "hp", 1),
    (r"less health|weniger leben|glass.?cannon", "hp", -1),
    (r"harder|schwerer|schwieriger|more difficult", "harder", 0),
    (r"easier|leichter|einfacher", "easier", 0),
    (r"more enem|mehr gegner|mehr drohnen|more drone|mehr feinde", "enemies", 3),
    (r"fewer enem|weniger gegner|less enem|weniger drohnen", "enemies", -2),
    (r"more coin|mehr münz|mehr collect", "coins", 2),
    (r"fov wider|wider fov|mehr fov", "fov", 1.08),
    (r"fov narrower|less fov|cinematic fov", "fov", 0.92),
    (r"mouse sens|empfindlichkeit|sens higher|höhere sens", "mouseSens", 1.2),
    (r"lower sens|weniger sens|sens lower", "mouseSens", 0.85),
]

PALETTE_WORDS = {
    "neon": (r"neon|cyber|synth|futur|sci-?fi|cyberpunk|tron", "neon city", "neon"),
    "forest": (r"forest|grove|woods|wald|jungle|trees?", "pine grove", "forest"),
    "desert": (r"desert|dune|sand|wüste", "sun dunes", "desert"),
    "ice": (r"ice|snow|frost|eis|schnee|arctic", "ice field", "ice"),
    "dungeon": (r"dungeon|castle|crypt|horror.?dark|kerker|burg", "stone keep", "dungeon"),
    "village": (r"village|dorf|town|markt", "dusk village", "village"),
}

GENRE_FORCE = [
    (r"\b(fps|ego.?shooter|first[- ]person)\b", "fps"),
    (r"\b(shooter|baller|schie(ss|ß))\b", "fps"),
    (r"\b(platformer?|jump.?game|plattform)\b", "platformer"),
    (r"\b(runner|endless)\b", "runner"),
    (r"\b(racing|racer|fahr.?spiel)\b", "racing"),
    (r"\b(horror|stealth|grusel)\b", "horror"),
    (r"\b(adventure|abenteuer|dorf.?spiel)\b", "adventure"),
    (r"\b(arena|twin.?stick)\b", "arena"),
    (r"\b(rpg)\b", "rpg"),
]

LLM_ONLY = re.compile(
    r"(?i)\b("
    r"inventory|invent|skill.?tree|dialogue tree|dialog.?baum|quest.?log|"
    r"ragdoll|rapier|shader|glsl|raymarch|multiplayer|netcode|save.?system|"
    r"refactor|rewrite all|architecture|bug|crash|error|stack.?trace|"
    r"gltf|mixamo|animation.?mixer|particle system|postprocess|"
    r"wallet|solana|seeker"
    r")\b"
)

REBUILD = re.compile(
    r"(?i)\b(rebuild|from scratch|neu bauen|komplett neu|start over|nochmal neu)\b"
)

_LONG_BRIEF = re.compile(
    r"(?i)\b(player|spieler|shoot|jump|walk|game|spiel|world|welt)\b"
)
_GENRE_SWAP = re.compile(
    r"(?i)\b(make it|mach es|change to|umwandeln|als |into a|zu einem)\b"
)


def force_genre(text: str) -> str | None:
    for rx, g in GENRE_FORCE:
        if re.search(rx, text):
            return g
    return None


def force_palette(text: str) -> tuple[str, str] | None:
    for _key, (rx, setting, props) in PALETTE_WORDS.items():
        if re.search(rx, text, re.I):
            return setting, props
    return None


def needs_llm(text: str) -> bool:
    t = (text or "").strip()
    if not t:
        return False
    if LLM_ONLY.search(t):
        if len(t) < 60 and any(re.search(rx, t, re.I) for rx, _, _ in FEEL_OPS):
            return False
        return True
    return False


def refuse_reason(text: str) -> str | None:
    """Host refuses — do not send these to the 30B to 'try anyway'."""
    t = text or ""
    if re.search(r"(?i)rewrite.{0,48}(game\.js|the whole game|from scratch lighting)", t):
        return "do not rewrite game.js — host kits + src/systems/*"
    if re.search(r"(?i)(use |switch to |port to )(unity|godot|unreal|r3f|react three)", t):
        return "engine is Three.js vanilla Vite metres Y-up"
    if re.search(r"(?i)examples/jsm", t):
        return "imports are three + three/addons, never examples/jsm"
    if re.search(r"(?i)parent(ed)? (the )?(camera|cam) to (the )?(mesh|player)", t):
        return "camera is spring/fpsLook — never parented 1:1"
    return None


def route(text: str, spec: dict | None = None) -> dict[str, Any]:
    """
    Decide who owns this continue.

    kind: patch | rebuild | llm | refuse | abstain
    skip_llm: True when the host must not call Ollama.
    """
    del spec  # reserved: future spec-aware routing
    t = (text or "").strip()
    if not t:
        return {"kind": "abstain", "reason": "empty", "skip_llm": False}
    refused = refuse_reason(t)
    if refused:
        return {"kind": "refuse", "reason": refused, "skip_llm": True}
    if needs_llm(t):
        return {"kind": "llm", "reason": "feature-or-bug", "skip_llm": False}
    genre_hit = force_genre(t)
    palette_hit = force_palette(t)
    rebuild = bool(REBUILD.search(t))
    long_brief = len(t) >= 90 and bool(_LONG_BRIEF.search(t))
    if rebuild or (long_brief and (genre_hit or palette_hit)) or (
        genre_hit and _GENRE_SWAP.search(t)
    ):
        return {"kind": "rebuild", "reason": "genre-or-rebuild", "skip_llm": True}
    if any(re.search(rx, t, re.I) for rx, _, _ in FEEL_OPS) or palette_hit or genre_hit:
        return {"kind": "patch", "reason": "feel-or-palette", "skip_llm": True}
    return {"kind": "llm", "reason": "unclear-open", "skip_llm": False}


def complain(text: str) -> list[dict[str, Any]]:
    """Translate a player complaint into host ops. Empty = not a feel complaint."""
    t = text or ""
    out: list[dict[str, Any]] = []
    for rx, op, amount in FEEL_OPS:
        if re.search(rx, t, re.I):
            out.append({"op": op, "amount": amount})
    pal = force_palette(t)
    if pal:
        out.append({"op": "palette", "amount": 0, "note": pal[1]})
    g = force_genre(t)
    if g:
        out.append({"op": "genre", "amount": 0, "note": g})
    return out


def _t8s(spec: dict) -> str:
    verb = spec.get("verb") or "play"
    loop = spec.get("loop") or "talk"
    if loop == "shoot":
        return f"By t=8s the player has locked on and fired. Fun is: {verb}."
    if loop == "jump":
        return f"By t=8s the player has cleared one gap. Fun is: {verb}."
    if loop == "run":
        return f"By t=8s the player has dodged one hazard. Fun is: {verb}."
    if loop == "race":
        return f"By t=8s the player has hit the first gate. Fun is: {verb}."
    return f"By t=8s the player has done the verb. Fun is: {verb}."


def _novelty(spec: dict) -> str:
    toy = spec.get("toy")
    if toy:
        return f"toy:{toy}"
    look = spec.get("look")
    if look:
        return f"place:{look}"
    return "one readable room that teaches the verb"


def taste_for(spec: dict | None = None) -> dict[str, float]:
    out = dict(TASTE)
    feel = (spec or {}).get("feel") if isinstance(spec, dict) else None
    if isinstance(feel, dict):
        for key in ("camLag", "hitstopMs", "shakeHit"):
            if key not in feel:
                continue
            try:
                out[key] = float(feel[key])
            except (TypeError, ValueError):
                pass
    return out


def session_from_spec(spec: dict) -> dict[str, Any]:
    feel = dict(spec.get("feel") or {})
    taste = taste_for(spec)
    for key in ("camLag", "hitstopMs", "shakeHit"):
        feel.setdefault(key, taste[key])
    return {
        "version": VERSION,
        "identity": IDENTITY,
        "prompt": spec.get("prompt") or "",
        "title": spec.get("title") or "",
        "verb": spec.get("verb") or "play",
        "t8s": _t8s(spec),
        "genre": spec.get("genre") or "adventure",
        "engine": spec.get("engine") or "three",
        "loop": spec.get("loop") or "talk",
        "camera": spec.get("camera") or "tps",
        "setting": spec.get("setting") or "",
        "props": spec.get("props") or "",
        "look": spec.get("look"),
        "body": spec.get("body"),
        "toy": spec.get("toy"),
        "feel": feel,
        "taste": taste,
        "novelty": _novelty(spec),
        "kill": list(KILL_ALWAYS),
        "ship": list(SHIP),
        "law": dict(ENGINE_LAW),
        "next": "play 8s then complain in feel words (floaty / faster / more enemies / neon)",
        "metric": "one more run?",
    }


def stamp_spec(spec: dict) -> dict:
    out = dict(spec)
    out["grok"] = session_from_spec(out)
    return out


def session_open(
    brief: str,
    *,
    genre: str | None = None,
    engine: str | None = None,
    vintage_profile: str | None = None,
    spec: dict | None = None,
) -> dict[str, Any]:
    """Open a pairing session from a brief (compiles a slice spec, no LLM)."""
    if spec is None:
        import slice as slicelib

        spec = slicelib.compile_prompt(
            brief, genre=genre, engine=engine, vintage_profile=vintage_profile
        )
    grok = spec.get("grok")
    if isinstance(grok, dict) and grok.get("verb"):
        return grok
    return session_from_spec(spec)


def ephemeral_project(project: Path | None) -> bool:
    if project is None:
        return True
    try:
        text = str(project.expanduser().resolve())
    except OSError:
        text = str(project)
    lowered = text.replace("\\", "/").lower()
    return any(
        token in lowered
        for token in ("/tmp/", "/var/folders/", "/temp/", "/pytest-", "/private/var/folders/")
    )


def kernel_trace_path() -> Path:
    from gmcommon import CONFIG

    return CONFIG / "teacher" / "kernel.jsonl"


def _append_jsonl(path: Path, row: dict, cap: int = MAX_KERNEL_TRACES) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    with path.open("a", encoding="utf-8") as handle:
        handle.write(json.dumps(row, ensure_ascii=False) + "\n")
    try:
        lines = path.read_text(encoding="utf-8").splitlines()
        if len(lines) > cap:
            path.write_text("\n".join(lines[-cap:]) + "\n", encoding="utf-8")
    except OSError:
        pass


def record_decision(
    *,
    kind: str,
    instruction: str,
    session: dict | None = None,
    decision: dict | None = None,
    project: Path | None = None,
) -> Path | None:
    """Store a kernel move as a teacher trace and, for real projects, a LoRA pair."""
    row = {
        "t": time.time(),
        "kind": f"grok-{kind}",
        "identity": IDENTITY,
        "instruction": (instruction or "")[:800],
        "decision": decision or {},
        "genre": (session or {}).get("genre"),
        "verb": (session or {}).get("verb"),
        "taste": (session or {}).get("taste") or dict(TASTE),
        "snippet": json.dumps(decision or {}, ensure_ascii=False)[:1800],
        "project": project.name if project else "",
    }
    written: Path | None = None
    if project is not None:
        try:
            from gmcommon import meta_dir

            local = meta_dir(project) / "kernel.jsonl"
            _append_jsonl(local, row)
            written = local
        except OSError:
            pass
    if not ephemeral_project(project):
        try:
            _append_jsonl(kernel_trace_path(), row)
            written = written or kernel_trace_path()
        except OSError:
            pass
        if project is not None:
            try:
                import quality as qualitylib

                qualitylib.log_accept_pair(
                    project,
                    instruction=instruction,
                    before=host_block(session, max_chars=1200) if session else "",
                    after=json.dumps(decision or row, indent=2, ensure_ascii=False),
                    kind=f"grok-{kind}",
                    meta={"identity": IDENTITY, "genre": row.get("genre")},
                )
            except Exception:
                pass
    return written


def load_kernel_traces(project: Path | None = None, limit: int = MAX_KERNEL_TRACES) -> list[dict]:
    paths: list[Path] = []
    if project is not None:
        try:
            from gmcommon import meta_dir

            paths.append(meta_dir(project) / "kernel.jsonl")
        except Exception:
            pass
    paths.append(kernel_trace_path())
    rows: list[dict] = []
    seen: set[str] = set()
    for path in paths:
        if not path.is_file():
            continue
        try:
            lines = path.read_text(encoding="utf-8").splitlines()
        except OSError:
            continue
        for line in lines:
            if not line.strip():
                continue
            try:
                data = json.loads(line)
            except Exception:
                continue
            if not isinstance(data, dict):
                continue
            key = f"{data.get('t')}|{data.get('instruction')}|{data.get('kind')}"
            if key in seen:
                continue
            seen.add(key)
            rows.append(data)
    rows.sort(key=lambda r: float(r.get("t") or 0), reverse=True)
    return rows[:limit]


def kernel_block(query: str = "", k: int = 2, max_chars: int = 1200, project: Path | None = None) -> str:
    """Few-shot of recent kernel decisions for the local coder."""
    rows = load_kernel_traces(project)
    if not rows:
        return ""
    q = (query or "").lower()
    scored: list[tuple[int, dict]] = []
    for row in rows:
        blob = " ".join(
            str(row.get(key) or "")
            for key in ("instruction", "genre", "verb", "kind", "snippet")
        ).lower()
        score = sum(1 for tok in q.split() if len(tok) > 3 and tok in blob)
        if str(row.get("kind") or "").startswith("grok-"):
            score += 1
        scored.append((score, row))
    scored.sort(key=lambda x: x[0], reverse=True)
    parts = ["# Kernel traces (Grok decisions — copy the shape, not the numbers blindly)"]
    used = 0
    for _, row in scored[:k]:
        decision = row.get("decision") or {}
        block = (
            f"\n## {row.get('kind')} · {row.get('genre') or '?'}\n"
            f"Player: {row.get('instruction')}\n"
            f"```json\n{json.dumps(decision, ensure_ascii=False)[:700]}\n```\n"
        )
        if used + len(block) > max_chars:
            break
        parts.append(block)
        used += len(block)
    return "\n".join(parts) if len(parts) > 1 else ""


def harvest_pairs(limit: int = 200) -> list[dict[str, str]]:
    """Turn kernel traces into SFT rows (instruction / input / output)."""
    rows = []
    for trace in load_kernel_traces(limit=limit):
        decision = trace.get("decision") or {}
        output = json.dumps(decision, ensure_ascii=False)
        if not output or output == "{}":
            continue
        rows.append(
            {
                "instruction": str(trace.get("instruction") or "open a slice")[:2000],
                "input": f"genre={trace.get('genre') or ''} verb={trace.get('verb') or ''}",
                "output": output[:8000],
                "engine": "three",
                "kind": str(trace.get("kind") or "grok-open"),
            }
        )
    return rows


def persist(project: Path, session: dict, *, record: bool = True) -> Path | None:
    from gmcommon import meta_dir

    try:
        meta = meta_dir(project)
        meta.mkdir(parents=True, exist_ok=True)
        path = meta / "grok.json"
        path.write_text(json.dumps(session, indent=2, ensure_ascii=False) + "\n", encoding="utf-8")
    except OSError:
        return None
    if not record:
        return path
    record_decision(
        kind="open",
        instruction=str(session.get("prompt") or session.get("verb") or "open"),
        session=session,
        decision={
            "verb": session.get("verb"),
            "genre": session.get("genre"),
            "look": session.get("look"),
            "body": session.get("body"),
            "toy": session.get("toy"),
            "feel": session.get("feel"),
            "taste": session.get("taste"),
            "novelty": session.get("novelty"),
        },
        project=project,
    )
    return path


def load(project: Path) -> dict | None:
    from gmcommon import meta_dir

    candidates = [
        meta_dir(project) / "grok.json",
        project / ".dotlab" / "grok.json",
        project / ".gamemaster" / "grok.json",
    ]
    for path in candidates:
        if not path.is_file():
            continue
        try:
            data = json.loads(path.read_text(encoding="utf-8"))
        except Exception:
            continue
        if isinstance(data, dict) and data.get("verb"):
            return data
    return None


def session_for(project: Path | None, brief: str = "") -> dict | None:
    if project is not None:
        existing = load(project)
        if existing:
            return existing
        try:
            import patch as patchlib

            spec = patchlib.load_spec(project)
            if isinstance(spec, dict):
                return session_from_spec(spec)
        except Exception:
            pass
    if brief.strip():
        return session_open(brief)
    return None


def host_block(session: dict | None, max_chars: int = 1600) -> str:
    if not session:
        return ""
    keys = (
        "identity",
        "verb",
        "t8s",
        "genre",
        "engine",
        "loop",
        "camera",
        "look",
        "body",
        "toy",
        "feel",
        "novelty",
        "next",
    )
    slim = {k: session[k] for k in keys if k in session}
    slim["taste"] = session.get("taste") or dict(TASTE)
    slim["kill"] = list(session.get("kill") or [])[:8]
    slim["law"] = session.get("law")
    blob = json.dumps(slim, indent=2, ensure_ascii=False)
    if len(blob) > max_chars:
        blob = blob[: max_chars - 1] + "…"
    return f"HOST SESSION (locked — do not re-pitch)\n{blob}"


def pack_for_ollama(session: dict | None = None, role: str = "core") -> str:
    """Short law the 30B cannot ignore because the host also enforces it."""
    del role
    parts = [LAW.strip()]
    block = host_block(session, max_chars=900) if session else ""
    if block:
        parts.append(block)
    return "\n\n".join(parts)


def director_seed(session: dict) -> dict[str, Any]:
    feel = session.get("feel") or {}
    return {
        "pitch": f"The fun is {session.get('verb')}. We cut inventory and UI chrome.",
        "verb": session.get("verb") or "play",
        "t8s": session.get("t8s") or "",
        "pillars": ["place", "body", "challenge"],
        "slice": (
            f"{session.get('setting') or 'one room'} · "
            f"{session.get('loop') or 'play'} loop · restart <3s"
        ),
        "genre": session.get("genre") or "adventure",
        "engine": session.get("engine") or "three",
        "palette_id": session.get("props") or "dusk",
        "feel": {
            "gravity": feel.get("gravity", 24),
            "moveSpeed": feel.get("moveSpeed", 6.2),
            "jumpForce": feel.get("jumpForce", 8.2),
            "coyoteMs": feel.get("coyoteMs", 100),
        },
        "non_goals": list(KILL_ALWAYS[:6]),
        "novelty": session.get("novelty") or "one hook",
        "first_death": (
            f"telegraph {float((session.get('taste') or TASTE).get('telegraphSec', 0.35)):.2f}s "
            "then commit lock; R restarts <3s"
        ),
        "metric": session.get("metric") or "one more run?",
        "taste": session.get("taste") or dict(TASTE),
    }


def prefill(session: dict | None, role: str = "coder") -> str:
    """First assistant turn. Local models continue from a decision, not a blank page."""
    if role == "director":
        seed = director_seed(session or {})
        return json.dumps(seed, indent=2, ensure_ascii=False)
    if not session:
        return (
            "Host already opened. I will not re-pitch. "
            "Novelty goes in src/systems/*. Feel is CONFIG. First tool now."
        )
    verb = session.get("verb") or "the verb"
    novelty = session.get("novelty") or "one hook"
    look = session.get("look") or "look card"
    body = session.get("body") or "body card"
    toy = session.get("toy") or "none"
    return (
        f"Host session locked. The fun is {verb}. "
        f"Look {look} · body {body} · toy {toy}. "
        f"One novelty: {novelty}. "
        "I will not rewrite src/craft, src/look, src/body, or large game.js. "
        "Feel is host CONFIG. First tool: read_file or apply_patch under src/systems/."
    )


def attach_prefill(
    messages: list[dict],
    session: dict | None,
    *,
    role: str = "coder",
) -> list[dict]:
    """Append a locked assistant seed + a 'continue' user turn."""
    out = list(messages)
    out.append({"role": "assistant", "content": prefill(session, role=role)})
    if role == "director":
        follow = "Refine the host seed. Output ONLY the JSON object. Do not reopen the pitch."
    else:
        follow = "Host session is locked. Continue from it. First tool now. Do not restate the session."
    out.append({"role": "user", "content": follow})
    return out


def decide_next(
    session: dict | None,
    *,
    verify: dict | None = None,
    play: dict | None = None,
) -> str:
    if verify and not verify.get("ok"):
        p0 = ", ".join(str(x) for x in (verify.get("p0_fail") or []))
        return f"Fix P0 only: {p0 or 'see verify'}. Do not add features."
    if play and play.get("p0_fail"):
        fails = ", ".join(str(x) for x in (play.get("p0_fail") or []))
        return f"Play-P0: {fails}. Numbers or kits, not new systems."
    if session:
        return str(session.get("next") or "play 8s then complain in feel words")
    return "play 8s then complain in feel words"


def main() -> int:
    ap = argparse.ArgumentParser(
        description="Grok 4.6 pairing kernel (host code, not model weights)"
    )
    ap.add_argument(
        "cmd",
        nargs="?",
        default="pack",
        choices=["pack", "open", "route", "complain", "whoami", "prefill", "harvest", "traces"],
    )
    ap.add_argument("text", nargs="*")
    ap.add_argument("-p", "--project", default="")
    args = ap.parse_args()
    text = " ".join(args.text).strip()
    project = Path(args.project).expanduser() if args.project else None
    if args.cmd == "whoami":
        print("Grok 4.6 pairing kernel — executable host code, not model weights.")
        print(f"identity={IDENTITY} law_chars={len(LAW)}")
        return 0
    if args.cmd == "pack":
        sess = session_for(project, text)
        print(pack_for_ollama(sess))
        return 0
    if args.cmd == "open":
        sess = session_open(text or "small adventure")
        if project and project.exists():
            persist(project, sess)
        print(json.dumps(sess, indent=2, ensure_ascii=False))
        return 0
    if args.cmd == "route":
        spec = None
        if project:
            try:
                import patch as patchlib

                spec = patchlib.load_spec(project)
            except Exception:
                spec = None
        print(json.dumps(route(text, spec), indent=2))
        return 0
    if args.cmd == "complain":
        print(json.dumps(complain(text), indent=2))
        return 0
    if args.cmd == "prefill":
        sess = session_for(project, text)
        print(prefill(sess))
        return 0
    if args.cmd == "traces":
        print(kernel_block(text, k=5, max_chars=4000, project=project))
        return 0
    if args.cmd == "harvest":
        rows = harvest_pairs()
        print(json.dumps({"ok": True, "rows": len(rows), "sample": rows[:3]}, indent=2, ensure_ascii=False))
        return 0
    return 2


if __name__ == "__main__":
    raise SystemExit(main())
