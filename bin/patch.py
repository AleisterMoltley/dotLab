#!/usr/bin/env python3
"""Instant craft patches — Grok decisions as code, no LLM wait.

Most "Continue" messages are feel numbers, counts, palette, or genre.
Apply them from slice.json in <50ms. Fall through to the model only for
open features (dialogue trees, shaders, inventory, hard bugs).
"""
from __future__ import annotations

import json
import re
from pathlib import Path
from typing import Any

import slice as slicelib

# (regex, handler name) — first match wins for multi; we accumulate simple tweaks
_FEEL_OPS: list[tuple[str, str, float]] = [
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

_PALETTE_WORDS = {
    "neon": (r"neon|cyber|synth|futur|sci-?fi|cyberpunk|tron", "neon city", "neon"),
    "forest": (r"forest|grove|woods|wald|jungle|trees?", "pine grove", "forest"),
    "desert": (r"desert|dune|sand|wüste", "sun dunes", "desert"),
    "ice": (r"ice|snow|frost|eis|schnee|arctic", "ice field", "ice"),
    "dungeon": (r"dungeon|castle|crypt|horror.?dark|kerker|burg", "stone keep", "dungeon"),
    "village": (r"village|dorf|town|markt", "dusk village", "village"),
}

_GENRE_FORCE = [
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

_LLM_ONLY = re.compile(
    r"(?i)\b("
    r"inventory|invent|skill.?tree|dialogue tree|dialog.?baum|quest.?log|"
    r"ragdoll|rapier|shader|glsl|raymarch|multiplayer|netcode|save.?system|"
    r"refactor|rewrite all|architecture|bug|crash|error|stack.?trace|"
    r"gltf|mixamo|animation.?mixer|particle system|postprocess|"
    r"wallet|solana|seeker"
    r")\b"
)

_REBUILD = re.compile(
    r"(?i)\b(rebuild|from scratch|neu bauen|komplett neu|start over|nochmal neu)\b"
)


def load_spec(project: Path) -> dict | None:
    from gmcommon import meta_dir

    path = meta_dir(project) / "slice.json"
    if not path.is_file():
        # one more try legacy only if meta_dir pointed elsewhere empty
        legacy = project / ".gamemaster" / "slice.json"
        path = legacy if legacy.is_file() else path
    if not path.is_file():
        return None
    try:
        data = json.loads(path.read_text(encoding="utf-8"))
    except Exception:
        return None
    return data if isinstance(data, dict) else None


def save_spec(project: Path, spec: dict) -> None:
    from gmcommon import meta_dir

    meta = meta_dir(project)
    meta.mkdir(parents=True, exist_ok=True)
    (meta / "slice.json").write_text(json.dumps(spec, indent=2) + "\n", encoding="utf-8")


def _ensure_counts(spec: dict) -> None:
    feel = spec.setdefault("feel", {})
    feel.setdefault("moveSpeed", 6.2)
    feel.setdefault("gravity", 24)
    feel.setdefault("jumpForce", 8.2)
    feel.setdefault("accel", 42)
    feel.setdefault("friction", 26)
    feel.setdefault("hp", 3)
    feel.setdefault("fov", 58)
    feel.setdefault("mouseSens", 0.0022)
    feel.setdefault("hitstopMs", 40)
    feel.setdefault("shakeHit", 0.12)
    spec.setdefault("enemyCount", 7 if spec.get("loop") == "shoot" else 0)
    spec.setdefault("coinCount", 6)
    spec.setdefault("hazardCount", 8)
    spec.setdefault("density", 1.0)
    spec.setdefault("juice", 1.0)


def _apply_feel(spec: dict, op: str, amount: float) -> str:
    feel = spec["feel"]
    if op == "icy":
        feel["accel"] = max(12.0, float(feel.get("accel", 42)) * 0.7)
        feel["friction"] = max(8.0, float(feel.get("friction", 26)) * 0.55)
        return "icy: lower accel/friction"
    if op == "snappy":
        feel["accel"] = min(70.0, float(feel.get("accel", 42)) * 1.2)
        feel["friction"] = min(40.0, float(feel.get("friction", 26)) * 1.25)
        return "snappy: higher accel/friction"
    if op == "juice":
        spec["juice"] = max(0.4, min(2.5, float(spec.get("juice", 1.0)) * amount))
        feel["hitstopMs"] = int(max(20, min(80, float(feel.get("hitstopMs", 40)) * amount)))
        feel["shakeHit"] = max(0.05, min(0.35, float(feel.get("shakeHit", 0.12)) * amount))
        return f"juice ×{amount:.2f}"
    if op == "harder":
        spec["enemyCount"] = int(spec.get("enemyCount", 7)) + 3
        feel["moveSpeed"] = float(feel.get("moveSpeed", 6.2)) * 0.95
        feel["hp"] = max(1, int(feel.get("hp", 3)) - 1)
        return "harder: +enemies, −hp"
    if op == "easier":
        spec["enemyCount"] = max(2, int(spec.get("enemyCount", 7)) - 2)
        feel["hp"] = int(feel.get("hp", 3)) + 1
        return "easier: −enemies, +hp"
    if op == "enemies":
        cur = int(spec.get("enemyCount", 7))
        spec["enemyCount"] = max(1, min(24, cur + int(amount)))
        return f"enemies → {spec['enemyCount']}"
    if op == "coins":
        cur = int(spec.get("coinCount", 6))
        spec["coinCount"] = max(1, min(20, cur + int(amount)))
        return f"coins → {spec['coinCount']}"
    if op == "hp":
        feel["hp"] = max(1, min(9, int(feel.get("hp", 3)) + int(amount)))
        return f"hp → {feel['hp']}"
    # scale a numeric feel key
    cur = float(feel.get(op, 1.0))
    if op == "mouseSens":
        feel[op] = max(0.0008, min(0.006, cur * amount))
    elif op in ("moveSpeed", "jumpForce", "gravity", "fov", "accel", "friction"):
        feel[op] = round(max(0.5, cur * amount), 3)
    else:
        feel[op] = cur * amount
    return f"{op} → {feel[op]}"


def _force_genre(text: str) -> str | None:
    for rx, g in _GENRE_FORCE:
        if re.search(rx, text):
            return g
    return None


def _force_palette(text: str) -> tuple[str, str] | None:
    for _key, (rx, setting, props) in _PALETTE_WORDS.items():
        if re.search(rx, text, re.I):
            return setting, props
    return None


def needs_llm(text: str) -> bool:
    t = (text or "").strip()
    if not t:
        return False
    if _LLM_ONLY.search(t):
        # still allow pure feel if short and mixed
        if len(t) < 60 and any(re.search(rx, t, re.I) for rx, _, _ in _FEEL_OPS):
            return False
        return True
    return False


def try_patch(project: Path, text: str) -> dict[str, Any] | None:
    """
    Apply an instant craft change. Returns:
      {ok, summary, written, mode: patch|rebuild}
    or None if the message should go to the LLM.
    """
    project = project.expanduser().resolve()
    if not project.is_dir():
        return None
    t = (text or "").strip()
    if not t:
        return None
    if needs_llm(t):
        return None

    spec = load_spec(project)
    notes: list[str] = []

    # Full rebuild / long redesign brief without LLM-only keywords
    genre_hit = _force_genre(t)
    palette_hit = _force_palette(t)
    rebuild = bool(_REBUILD.search(t))
    long_brief = len(t) >= 90 and bool(
        re.search(r"(?i)\b(player|spieler|shoot|jump|walk|game|spiel|world|welt)\b", t)
    )

    if rebuild or (long_brief and (genre_hit or palette_hit)) or (
        genre_hit and re.search(r"(?i)\b(make it|mach es|change to|umwandeln|als |into a|zu einem)\b", t)
    ):
        base_prompt = t
        if spec and spec.get("prompt") and not rebuild and len(t) < 140:
            base_prompt = f"{spec.get('prompt')} · {t}"
        new_spec = slicelib.compile_prompt(base_prompt, genre=genre_hit)
        if spec and spec.get("title"):
            new_spec["title"] = spec["title"]
        _ensure_counts(new_spec)
        written = slicelib.write_slice(project, new_spec)
        return {
            "ok": True,
            "mode": "rebuild",
            "summary": (
                f"Rebuilt slice (instant, no model wait).\n"
                f"{slicelib.summarize(new_spec)}"
            ),
            "written": written,
            "spec": new_spec,
        }

    if spec is None:
        # No slice metadata — only rebuild from text if it looks like a design brief
        if long_brief or genre_hit:
            new_spec = slicelib.compile_prompt(t, genre=genre_hit)
            written = slicelib.write_slice(project, new_spec)
            return {
                "ok": True,
                "mode": "rebuild",
                "summary": slicelib.summarize(new_spec),
                "written": written,
                "spec": new_spec,
            }
        return None

    _ensure_counts(spec)
    changed = False

    if palette_hit:
        setting, props = palette_hit
        spec["setting"] = setting
        spec["props"] = props
        spec["palette"] = dict(slicelib._PALETTES.get(props, slicelib._PALETTES["dusk"]))
        notes.append(f"palette → {props}")
        changed = True

    if genre_hit and genre_hit != spec.get("genre"):
        # light genre swap keeping title/prompt memory
        merged = slicelib.compile_prompt(f"{spec.get('prompt', '')} {t}", genre=genre_hit)
        for k in ("genre", "loop", "camera", "verb", "feel"):
            spec[k] = merged[k]
        if not palette_hit:
            spec["setting"] = merged["setting"]
            spec["props"] = merged["props"]
            spec["palette"] = merged["palette"]
        notes.append(f"genre → {genre_hit}")
        changed = True
        _ensure_counts(spec)

    for rx, op, amount in _FEEL_OPS:
        if re.search(rx, t, re.I):
            notes.append(_apply_feel(spec, op, amount))
            changed = True

    if not changed:
        return None

    # keep verb in sync with setting
    if "palette" in "".join(notes) or "genre" in "".join(notes):
        spec["verb"] = slicelib._verb(spec.get("genre") or "adventure", spec.get("setting") or "place")

    written = slicelib.write_slice(project, spec)
    summary = (
        "Instant craft (no model wait):\n- "
        + "\n- ".join(notes)
        + f"\n\nStill: {spec.get('verb')}. Click Play — Vite reloads."
    )
    return {
        "ok": True,
        "mode": "patch",
        "summary": summary,
        "written": written,
        "spec": spec,
        "notes": notes,
    }


def diagnose(project: Path) -> str:
    """Grok completeness read of a project (no LLM)."""
    import verify

    project = project.expanduser().resolve()
    lines = [f"# Craft diagnose · {project.name}", ""]
    spec = load_spec(project)
    if spec:
        lines.append(f"- verb: {spec.get('verb')}")
        lines.append(f"- genre/loop/camera: {spec.get('genre')} / {spec.get('loop')} / {spec.get('camera')}")
        lines.append(f"- setting: {spec.get('setting')} ({spec.get('props')})")
        feel = spec.get("feel") or {}
        lines.append(
            f"- feel: move {feel.get('moveSpeed')} grav {feel.get('gravity')} "
            f"jump {feel.get('jumpForce')} hp {feel.get('hp')}"
        )
        lines.append(f"- counts: enemies {spec.get('enemyCount')} coins {spec.get('coinCount')}")
    else:
        lines.append("- no .dotlab/slice.json (scaffold/patch not used yet)")
    vr = verify.evaluate(project)
    lines.append("")
    lines.append(vr["report"])
    if vr.get("ok"):
        lines.append("")
        lines.append("P0 OK. Next: play 30s, then tweak feel with patch (floaty / more enemies / neon).")
    else:
        lines.append("")
        lines.append("Fix P0 only. Do not add features.")
    return "\n".join(lines)


def main() -> int:
    import argparse

    ap = argparse.ArgumentParser(description="Instant craft patch / diagnose")
    ap.add_argument("-p", "--project", required=True)
    ap.add_argument("text", nargs="*", help="Craft instruction, or 'diagnose'")
    args = ap.parse_args()
    project = Path(args.project)
    text = " ".join(args.text).strip()
    if not text or text.lower() in ("diagnose", "audit", "status"):
        print(diagnose(project))
        return 0
    result = try_patch(project, text)
    if not result:
        print("NO_PATCH — needs LLM or unclear")
        print("Try: floaty | faster | more enemies | neon | make it a platformer")
        print("Or: gamemaster -p DIR --agent \"…\" for systems the host cannot patch")
        return 2
    print(result["summary"])
    print("written:", ", ".join(result.get("written") or []))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
