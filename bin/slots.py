#!/usr/bin/env python3
"""
Host-owned genre slot modules.

Director/JSON fills slots (novelty, weapon, enemy personality…).
Host injects deterministic systems so the LLM cannot break the machine.

Slots are written into src/slots/*.js and wired from game.js via a small
import block + SPEC.slots keys. If template has no hook, we patch once.
"""
from __future__ import annotations

import json
import re
from pathlib import Path
from typing import Any

# novelty templates keyed by loop/genre family
NOVELTY_LIBRARY = {
    "fps": [
        {
            "id": "wave_elite",
            "title": "Elite wave captain",
            "desc": "Every 3rd wave spawns a glowing elite with telegraphed charge",
        },
        {
            "id": "ads_weakpoint",
            "title": "Weak-point ADS",
            "desc": "ADS reveals enemy cores; hipfire only chips armor",
        },
        {
            "id": "dash_reload",
            "title": "Dash-reload",
            "desc": "Successful dash through fire refills 2 shots",
        },
    ],
    "arena": [
        {
            "id": "lane_pressure",
            "title": "Lane pressure",
            "desc": "Two spawn lanes; clearing one boosts the other",
        },
        {
            "id": "pickup_overheat",
            "title": "Overheat pickup",
            "desc": "Score pickups overheat weapon for 1.5s of rapid fire",
        },
    ],
    "platformer": [
        {
            "id": "coyote_gem",
            "title": "Coyote gems",
            "desc": "Gems only collectable during coyote frames — reward tight jumps",
        },
        {
            "id": "bounce_pads",
            "title": "Spring pads",
            "desc": "Colored pads multiply jumpForce for one jump",
        },
        {
            "id": "ghost_platform",
            "title": "Ghost platforms",
            "desc": "Platforms solid only while moving; stand still and fall",
        },
    ],
    "runner": [
        {
            "id": "lane_swap",
            "title": "Hard lane swap",
            "desc": "Obstacles force A/D swaps with 120ms grace",
        },
        {
            "id": "speed_debt",
            "title": "Speed debt",
            "desc": "Near-misses grant speed; hits tax speed for 2s",
        },
    ],
    "default": [
        {
            "id": "talk_relic",
            "title": "Talk relic",
            "desc": "One NPC grants a temporary ability after short bark",
        },
        {
            "id": "hidden_door",
            "title": "Hidden door",
            "desc": "One wall is fake; proximity bark hints it",
        },
    ],
}

WEAPON_ARCHETYPES = {
    "pulse": {"rpm": 480, "damage": 18, "spread": 0.014, "adsSpread": 0.004, "name": "Pulse"},
    "slug": {"rpm": 90, "damage": 55, "spread": 0.008, "adsSpread": 0.002, "name": "Slug"},
    "spray": {"rpm": 720, "damage": 10, "spread": 0.028, "adsSpread": 0.012, "name": "Spray"},
}

ENEMY_PERSONALITIES = {
    "drone": {"speed": 1.0, "aggro": 1.0, "telegraph": 0.35},
    "rusher": {"speed": 1.45, "aggro": 1.3, "telegraph": 0.25},
    "sniper": {"speed": 0.55, "aggro": 0.8, "telegraph": 0.5},
}


def _family(genre: str, loop: str) -> str:
    g = (genre or "").lower()
    if g in NOVELTY_LIBRARY:
        return g
    if loop == "shoot":
        return "fps" if g == "fps" else "arena"
    if loop == "jump":
        return "platformer"
    if loop == "run":
        return "runner"
    return "default"


def pick_novelty(spec: dict, director: dict | None = None) -> dict[str, str]:
    """Choose one novelty from director hint or seeded library."""
    director = director or {}
    family = _family(str(spec.get("genre") or ""), str(spec.get("loop") or ""))
    lib = NOVELTY_LIBRARY.get(family) or NOVELTY_LIBRARY["default"]
    hint = (director.get("novelty") or spec.get("novelty") or "").lower()
    seed = int(spec.get("seed") or 0)
    if hint:
        for item in lib:
            if item["id"] in hint or any(
                w in hint for w in item["title"].lower().split() if len(w) > 3
            ):
                return dict(item)
        # custom novelty from director
        return {
            "id": "custom",
            "title": (director.get("novelty") or "Custom hook")[:80],
            "desc": (director.get("novelty") or "")[:200],
        }
    return dict(lib[seed % len(lib)])


def pick_weapon(spec: dict, director: dict | None = None) -> dict[str, Any]:
    director = director or {}
    text = " ".join(
        str(director.get(k) or "")
        for k in ("pitch", "verb", "novelty", "slice")
    ).lower()
    if "slug" in text or "sniper" in text or "bolt" in text:
        key = "slug"
    elif "spray" in text or "smg" in text or "chaingun" in text:
        key = "spray"
    else:
        key = ("pulse", "slug", "spray")[int(spec.get("seed") or 0) % 3]
    return {"id": key, **WEAPON_ARCHETYPES[key]}


def pick_enemy(spec: dict, director: dict | None = None) -> dict[str, Any]:
    director = director or {}
    text = " ".join(str(director.get(k) or "") for k in ("pitch", "novelty")).lower()
    if "rush" in text or "swarm" in text:
        key = "rusher"
    elif "snipe" in text or "range" in text:
        key = "sniper"
    else:
        key = ("drone", "rusher", "sniper")[int(spec.get("seed") or 0) % 3]
    return {"id": key, **ENEMY_PERSONALITIES[key]}


def fill_slots(spec: dict, director: dict | None = None) -> dict:
    """Mutate/return spec with slots filled. Host-owned."""
    director = director or {}
    novelty = pick_novelty(spec, director)
    weapon = pick_weapon(spec, director)
    enemy = pick_enemy(spec, director)
    # merge director feel numbers (clamped)
    feel = dict(spec.get("feel") or {})
    for k, v in (director.get("feel") or {}).items():
        try:
            feel[str(k)] = float(v)
        except (TypeError, ValueError):
            continue
    # weapon into feel when shoot loop
    if spec.get("loop") == "shoot":
        feel["fireRpm"] = weapon["rpm"]
        feel["damage"] = weapon["damage"]
        feel["spread"] = weapon["spread"]
        feel["adsSpread"] = weapon["adsSpread"]
    if director.get("palette_id"):
        # palette id resolved by slice if known
        spec["props"] = str(director["palette_id"])
    if director.get("genre") and not spec.get("_genre_locked"):
        # only soft-set; slice already inferred
        pass
    if director.get("verb"):
        spec["verb"] = str(director["verb"])[:120]
    slots = {
        "novelty": novelty,
        "weapon": weapon,
        "enemy": enemy,
        "pillars": list(director.get("pillars") or [])[:3],
        "non_goals": list(director.get("non_goals") or [])[:6],
    }
    spec["feel"] = feel
    spec["slots"] = slots
    spec["novelty"] = novelty.get("title") or novelty.get("id")
    return spec


def _novelty_js(slots: dict) -> str:
    """Small runtime module for novelty hooks."""
    nov = slots.get("novelty") or {}
    weapon = slots.get("weapon") or {}
    enemy = slots.get("enemy") or {}
    return f"""/** Host slot runtime — do not hand-edit feel; use patch/slice */
export const SLOTS = {json.dumps({"novelty": nov, "weapon": weapon, "enemy": enemy}, indent=2)};

export function slotLabel() {{
  const n = SLOTS.novelty || {{}};
  return (n.title || n.id || 'slot') + (n.desc ? ' — ' + n.desc : '');
}}

/** Optional hooks game.js may call */
export function onWave(state, wave) {{
  const id = (SLOTS.novelty && SLOTS.novelty.id) || '';
  if (id === 'wave_elite' && wave > 0 && wave % 3 === 0) {{
    state.eliteWave = true;
    state.callout = 'ELITE';
    state.calloutT = 1.2;
  }}
}}

export function enemySpeedMul() {{
  return (SLOTS.enemy && SLOTS.enemy.speed) || 1;
}}

export function enemyTelegraph() {{
  return (SLOTS.enemy && SLOTS.enemy.telegraph) || 0.35;
}}
"""


def write_slot_module(project: Path, spec: dict) -> list[str]:
    """Write src/slots/runtime.js from spec.slots."""
    project = Path(project)
    slots = spec.get("slots") or {}
    if not slots:
        fill_slots(spec)
        slots = spec.get("slots") or {}
    dest = project / "src" / "slots" / "runtime.js"
    dest.parent.mkdir(parents=True, exist_ok=True)
    dest.write_text(_novelty_js(slots), encoding="utf-8")
    written = ["src/slots/runtime.js"]
    # ensure game.js imports if missing
    game = project / "src" / "game.js"
    if game.is_file():
        text = game.read_text(encoding="utf-8")
        if "slots/runtime" not in text and "./slots/" not in text:
            # inject import after craft imports if possible
            inject = "import { slotLabel, onWave, enemySpeedMul } from './slots/runtime.js';\n"
            if "from './craft/" in text or 'from "./craft/' in text:
                text = re.sub(
                    r"(import[^\n]+craft/[^\n]+\n)",
                    r"\1" + inject,
                    text,
                    count=1,
                )
            else:
                text = inject + text
            # soft HUD line once
            if "slotLabel" in text and "slotLabel()" not in text.replace(inject, ""):
                # try to append to ensureHud or start
                if "hud.textContent" in text and "slotLabel()" not in text:
                    text = text.replace(
                        "hud.textContent",
                        "try { if (hud && !hud.dataset.slot) { hud.dataset.slot = '1'; /* slot: */ } } catch (_) {}\nhud.textContent",
                        1,
                    )
            game.write_text(text, encoding="utf-8")
            written.append("src/game.js")
    # persist slots into slice.json
    try:
        from gmcommon import meta_dir

        meta = meta_dir(project)
        meta.mkdir(parents=True, exist_ok=True)
        sp = meta / "slice.json"
        if sp.is_file():
            data = json.loads(sp.read_text(encoding="utf-8"))
            if isinstance(data, dict):
                data["slots"] = slots
                data["novelty"] = spec.get("novelty")
                sp.write_text(json.dumps(data, indent=2) + "\n", encoding="utf-8")
    except Exception:
        pass
    return written


def apply_director_to_project(project: Path, director: dict) -> dict[str, Any]:
    """Load slice spec, fill slots from director JSON, rewrite slot module."""
    from gmcommon import meta_dir

    project = Path(project)
    sp = meta_dir(project) / "slice.json"
    if not sp.is_file():
        sp = project / ".gamemaster" / "slice.json"
    if sp.is_file():
        spec = json.loads(sp.read_text(encoding="utf-8"))
    else:
        import slice as slicelib

        brief = str(director.get("pitch") or director.get("verb") or "game")
        spec = slicelib.compile_prompt(brief, genre=director.get("genre"))
    if not isinstance(spec, dict):
        return {"ok": False, "error": "no spec"}
    fill_slots(spec, director)
    written = write_slot_module(project, spec)
    # save spec
    try:
        from patch import save_spec

        save_spec(project, spec)
    except Exception:
        meta = meta_dir(project)
        meta.mkdir(parents=True, exist_ok=True)
        (meta / "slice.json").write_text(json.dumps(spec, indent=2) + "\n", encoding="utf-8")
    return {"ok": True, "slots": spec.get("slots"), "written": written}


def main() -> int:
    import argparse
    import sys

    ap = argparse.ArgumentParser(description="Host genre slots")
    ap.add_argument("-p", "--project", required=True)
    ap.add_argument("--director-json", default="", help="path to director JSON")
    args = ap.parse_args()
    director = {}
    if args.director_json:
        director = json.loads(Path(args.director_json).read_text(encoding="utf-8"))
    print(json.dumps(apply_director_to_project(Path(args.project), director), indent=2))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
