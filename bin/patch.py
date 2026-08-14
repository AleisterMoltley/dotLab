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

import grok as groklib
import slice as slicelib

# Kernel owns the tables — keep the private aliases so callers/tests stay put.
_FEEL_OPS = groklib.FEEL_OPS
_PALETTE_WORDS = groklib.PALETTE_WORDS
_GENRE_FORCE = groklib.GENRE_FORCE
_LLM_ONLY = groklib.LLM_ONLY
_REBUILD = groklib.REBUILD


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
    return groklib.needs_llm(text)


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
    decision = groklib.route(t)
    if decision.get("kind") == "refuse":
        try:
            groklib.record_decision(
                kind="refuse",
                instruction=t,
                session=groklib.load(project),
                decision=decision,
                project=project,
            )
        except Exception:
            pass
        return {
            "ok": True,
            "mode": "refuse",
            "summary": decision.get("reason") or "refused by grok kernel",
            "written": [],
            "notes": [decision.get("reason") or "refuse"],
        }
    if decision.get("kind") == "llm":
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
        eng = (spec or {}).get("engine")
        vprof = None
        if isinstance((spec or {}).get("vintage"), dict):
            vprof = (spec or {}).get("vintage", {}).get("profile")
        new_spec = slicelib.compile_prompt(
            base_prompt, genre=genre_hit, engine=eng, vintage_profile=vprof
        )
        if spec and spec.get("title"):
            new_spec["title"] = spec["title"]
        if spec and spec.get("engine"):
            new_spec["engine"] = spec["engine"]
            if spec.get("vintage"):
                new_spec["vintage"] = spec["vintage"]
        _ensure_counts(new_spec)
        written = slicelib.write_slice(project, new_spec)
        try:
            groklib.persist(project, groklib.session_from_spec(new_spec))
        except Exception:
            pass
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
        # light genre swap keeping title/prompt memory + engine
        vprof = None
        if isinstance(spec.get("vintage"), dict):
            vprof = spec["vintage"].get("profile")
        merged = slicelib.compile_prompt(
            f"{spec.get('prompt', '')} {t}",
            genre=genre_hit,
            engine=spec.get("engine"),
            vintage_profile=vprof,
        )
        for k in ("genre", "loop", "camera", "verb", "feel"):
            spec[k] = merged[k]
        if not palette_hit and spec.get("engine") != "vintage":
            spec["setting"] = merged["setting"]
            spec["props"] = merged["props"]
            spec["palette"] = merged["palette"]
        notes.append(f"genre → {genre_hit}")
        changed = True
        _ensure_counts(spec)

    # Vintage: refuse modern neon palette force — map to gbc packs
    if palette_hit and spec.get("engine") == "vintage":
        _, props = palette_hit
        try:
            import engine_ops as eops

            map_id = {
                "neon": "gbc-candy",
                "forest": "gbc-forest",
                "desert": "gbc-fire",
                "ice": "gbc-ocean",
                "dungeon": "dmg-gray",
                "village": "gbc-forest",
            }.get(props, "dmg")
            r = eops.set_vintage_palette(project, map_id)
            if r.get("ok"):
                return {
                    "ok": True,
                    "mode": "patch",
                    "summary": f"Instant craft (vintage palette):\n- {r.get('summary')}",
                    "written": r.get("written") or [],
                    "spec": load_spec(project),
                    "notes": [r.get("summary") or map_id],
                }
        except Exception:
            pass
        notes.append(f"palette mood → {props} (vintage-safe)")
        changed = True
        palette_hit = None  # don't apply three palettes below

    for rx, op, amount in _FEEL_OPS:
        if re.search(rx, t, re.I):
            notes.append(_apply_feel(spec, op, amount))
            changed = True

    if not changed:
        return None

    # keep verb in sync with setting
    if "palette" in "".join(notes) or "genre" in "".join(notes):
        spec["verb"] = slicelib._verb(spec.get("genre") or "adventure", spec.get("setting") or "place")

    # Always preserve engine on rewrite
    written = slicelib.write_slice(project, spec)
    try:
        sess = groklib.session_from_spec(spec)
        groklib.persist(project, sess, record=False)
        groklib.record_decision(
            kind="complain",
            instruction=t,
            session=sess,
            decision={"notes": notes, "route": decision, "feel": sess.get("feel")},
            project=project,
        )
    except Exception:
        pass
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
