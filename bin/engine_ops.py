#!/usr/bin/env python3
"""
Multi-engine host ops: switch, room+, palette, bake budget, stats, ship card.

Used by dashboard + studio_ops. No Ollama required.
"""
from __future__ import annotations

import json
import re
import shutil
import time
from pathlib import Path
from typing import Any

from gmcommon import list_game_projects, meta_dir, projects_root


def load_slice(project: Path) -> dict[str, Any] | None:
    for name in (".dotlab", ".gamemaster"):
        sp = project / name / "slice.json"
        if sp.is_file():
            try:
                data = json.loads(sp.read_text(encoding="utf-8"))
                return data if isinstance(data, dict) else None
            except Exception:
                return None
    return None


def save_slice(project: Path, spec: dict) -> None:
    meta = meta_dir(project)
    meta.mkdir(parents=True, exist_ok=True)
    (meta / "slice.json").write_text(json.dumps(spec, indent=2) + "\n", encoding="utf-8")


def project_engine(project: Path) -> str:
    from gmcommon import _detect_project_engine

    sp = load_slice(project)
    return _detect_project_engine(project, sp)


def ship_card(project: Path) -> dict[str, Any]:
    """One-line ship summary for dashboard after Make / on select."""
    project = Path(project)
    spec = load_slice(project) or {}
    eng = str(spec.get("engine") or project_engine(project))
    vint = spec.get("vintage") if isinstance(spec.get("vintage"), dict) else {}
    card = {
        "ok": True,
        "name": spec.get("title") or project.name,
        "engine": eng,
        "genre": spec.get("genre") or "",
        "verb": spec.get("verb") or "",
        "loop": spec.get("loop") or "",
        "ship_bar": spec.get("shipBar") or "",
        "path": str(project.resolve()),
    }
    if eng == "vintage":
        card["resolution"] = f"{vint.get('width', 160)}×{vint.get('height', 144)}"
        card["colors"] = int(vint.get("maxColors") or len(vint.get("colors") or []) or 4)
        card["profile"] = vint.get("profile") or "gb"
        card["ceiling"] = "gba"
    elif eng == "pixel":
        card["resolution"] = "320×180 (logical)"
        card["stack"] = "pixelart.js + FX"
    else:
        card["resolution"] = "WebGL"
        card["stack"] = "three + craft"
    try:
        import studio_ops as ops

        v = ops.cached_verify(project, force=False)
        card["verify_ok"] = bool(v.get("ok"))
        card["verify_score"] = int(v.get("score") or 0)
        card["p0_fail"] = list(v.get("p0_fail") or [])
    except Exception:
        card["verify_ok"] = None
        card["verify_score"] = 0
        card["p0_fail"] = []
    return card


def switch_engine(
    project: Path,
    engine: str,
    *,
    vintage_profile: str | None = None,
    keep_title: bool = True,
) -> dict[str, Any]:
    """
    Rebuild project for another engine from stored prompt.
    Backs up previous slice.json; rewrites game via write_slice.
    """
    import slice as slicelib

    project = Path(project).expanduser().resolve()
    if engine not in ("three", "pixel", "vintage"):
        return {"ok": False, "error": "engine must be three|pixel|vintage"}
    old = load_slice(project) or {}
    prompt = str(old.get("prompt") or old.get("title") or project.name)
    genre = str(old.get("genre") or "") or None
    title = str(old.get("title") or project.name) if keep_title else None
    # Backup
    meta = meta_dir(project)
    meta.mkdir(parents=True, exist_ok=True)
    bak = meta / f"slice-before-{engine}-{int(time.time())}.json"
    if old:
        bak.write_text(json.dumps(old, indent=2) + "\n", encoding="utf-8")
    # Clear engine-specific trees that would confuse detect
    for rel in ("src/craft", "src/pixelart", "src/pixel", "src/vintage", "src/kits"):
        p = project / rel
        if p.is_dir():
            shutil.rmtree(p, ignore_errors=True)
    for rel in ("src/game.js", "src/main.js", "index.html", "package.json"):
        # write_slice will overwrite
        pass
    vprof = vintage_profile
    if not vprof and isinstance(old.get("vintage"), dict):
        vprof = old["vintage"].get("profile")
    new_spec = slicelib.compile_prompt(
        prompt,
        genre=genre,
        engine=engine,
        vintage_profile=vprof,
    )
    if title:
        new_spec["title"] = title
    # Preserve feel numbers where sensible
    if isinstance(old.get("feel"), dict):
        feel = dict(new_spec.get("feel") or {})
        for k, v in old["feel"].items():
            if k in feel or engine != "vintage":
                feel[k] = v
        if engine == "vintage":
            feel["hp"] = min(int(feel.get("hp") or 3), 5)
        new_spec["feel"] = feel
    written = slicelib.write_slice(project, new_spec)
    card = ship_card(project)
    return {
        "ok": True,
        "engine": engine,
        "written": written,
        "backup": str(bak) if old else "",
        "summary": slicelib.summarize(new_spec),
        "ship_card": card,
        "spec": new_spec,
    }


def one_more_room(project: Path) -> dict[str, Any]:
    """
    Host-only: extend vintage/pixel scroll width or add a second room block.
    No LLM. Appends solids/coins in slice meta + rewrites game with roomCount.
    """
    import slice as slicelib

    project = Path(project)
    spec = load_slice(project)
    if not spec:
        return {"ok": False, "error": "no slice.json"}
    eng = str(spec.get("engine") or project_engine(project))
    rooms = int(spec.get("roomCount") or 1) + 1
    rooms = min(rooms, 6 if eng == "vintage" else 8)
    spec["roomCount"] = rooms
    # Widen world for side / multi-room
    dens = float(spec.get("density") or 1.0)
    spec["density"] = min(2.5, dens + 0.15)
    if eng == "vintage":
        # bump coin/enemy slightly within handheld caps
        spec["coinCount"] = min(12, int(spec.get("coinCount") or 5) + 2)
        spec["enemyCount"] = min(5, int(spec.get("enemyCount") or 2) + 1)
    else:
        spec["coinCount"] = min(16, int(spec.get("coinCount") or 6) + 2)
        spec["enemyCount"] = min(10, int(spec.get("enemyCount") or 4) + 1)
    save_slice(project, spec)
    written = slicelib.write_slice(project, spec)
    # Inject roomCount into game if template supports it — also patch SPEC in game.js
    game = project / "src" / "game.js"
    if game.is_file():
        text = game.read_text(encoding="utf-8")
        # Ensure room multiplier exists in generated world loops
        if "roomCount" not in text and "ROOM_N" not in text:
            text = text.replace(
                "const SPEC = ",
                f"const ROOM_N = {rooms};\nconst SPEC = ",
                1,
            )
            game.write_text(text, encoding="utf-8")
    return {
        "ok": True,
        "roomCount": rooms,
        "written": written,
        "summary": f"Added room/screen #{rooms} (host, no model).",
        "ship_card": ship_card(project),
    }


# Vintage DMG / GBC locked palettes (host only)
VINTAGE_PALETTE_PRESETS = {
    "dmg": [0x0F380F, 0x306230, 0x8BAC0F, 0x9BBC0F],
    "dmg-gray": [0x1A1C2C, 0x5D576B, 0xA2A0A8, 0xF0F0F0],
    "gbc-forest": [0x1B1F1A, 0x3E5C38, 0x8FBF6A, 0xDCE8C0],
    "gbc-ocean": [0x0B1A2A, 0x1E4A6E, 0x5AA9D6, 0xC8E8F8],
    "gbc-fire": [0x1A0A08, 0x6B2010, 0xD06020, 0xF0D090],
    "gbc-candy": [0x201028, 0x703868, 0xE080B0, 0xF8E0F0],
}


def set_vintage_palette(project: Path, palette_id: str) -> dict[str, Any]:
    import slice as slicelib

    project = Path(project)
    spec = load_slice(project)
    if not spec:
        return {"ok": False, "error": "no slice.json"}
    if str(spec.get("engine")) != "vintage":
        return {"ok": False, "error": "project is not vintage"}
    pid = (palette_id or "dmg").lower()
    if pid not in VINTAGE_PALETTE_PRESETS:
        return {
            "ok": False,
            "error": "unknown palette",
            "allowed": list(VINTAGE_PALETTE_PRESETS),
        }
    colors = list(VINTAGE_PALETTE_PRESETS[pid])
    # Never exceed GBA 15 — presets are 4
    colors = colors[:15]
    vint = dict(spec.get("vintage") or {})
    vint["colors"] = colors
    vint["maxColors"] = min(int(vint.get("maxColors") or 4), 15, len(colors))
    vint["paletteId"] = pid
    # Update slice palette dict
    pal = {
        "bg": colors[0],
        "ground": colors[1],
        "grid": colors[2],
        "player": colors[3],
        "accent": colors[2],
        "enemy": colors[1],
        "building": colors[1],
        "hemiSky": colors[2],
        "hemiGround": colors[0],
        "sun": colors[3],
        "fogNear": 0,
        "fogFar": 0,
    }
    vint["palette"] = pal
    spec["vintage"] = vint
    spec["palette"] = pal
    written = slicelib.write_vintage_slice(project, spec)
    return {
        "ok": True,
        "palette_id": pid,
        "colors": colors,
        "written": written,
        "summary": f"Vintage palette → {pid} (locked, ≤{len(colors)} colors).",
        "ship_card": ship_card(project),
    }


def bake_budget(project: Path) -> dict[str, Any]:
    """Heuristic: count makeBakedSprite vs live layeredRect/fillRect in game.js."""
    game = Path(project) / "src" / "game.js"
    if not game.is_file():
        return {"ok": True, "skipped": True, "reason": "no game.js"}
    text = game.read_text(encoding="utf-8", errors="ignore")
    baked = len(re.findall(r"makeBakedSprite\s*\(", text))
    live_draw = len(re.findall(r"layeredRect\s*\(|fillRect\s*\(|disc\s*\(", text))
    # Budget: prefer baked; warn if live_draw high relative to bake
    warn = live_draw > 40 and baked < 2
    return {
        "ok": not warn,
        "baked": baked,
        "live_draws": live_draw,
        "warn": warn,
        "message": (
            "High live fillRect count — bake static parts with makeBakedSprite"
            if warn
            else "bake budget ok"
        ),
    }


def dashboard_stats() -> dict[str, Any]:
    """Aggregate engine counts + verify ship-rate for sidebar."""
    projects = list_game_projects()
    counts = {"three": 0, "pixel": 0, "vintage": 0, "other": 0}
    verified = 0
    p0_ok = 0
    scores = []
    for p in projects:
        eng = (p.get("engine") or "three").lower()
        if eng in counts:
            counts[eng] += 1
        else:
            counts["other"] += 1
        path = Path(p["path"])
        try:
            import studio_ops as ops

            v = ops.cached_verify(path, force=False)
            verified += 1
            if v.get("ok"):
                p0_ok += 1
            scores.append(int(v.get("score") or 0))
        except Exception:
            pass
    avg = int(round(sum(scores) / len(scores))) if scores else 0
    rate = round(100 * p0_ok / verified, 1) if verified else 0.0
    return {
        "ok": True,
        "total": len(projects),
        "engines": counts,
        "verify_n": verified,
        "p0_ok": p0_ok,
        "ship_rate": rate,
        "avg_score": avg,
        "projects_root": str(projects_root()),
    }


def engine_write_allowed(project: Path, rel: str) -> tuple[bool, str]:
    """Agent write gate: engine-specific immutable paths."""
    rel = (rel or "").replace("\\", "/").lstrip("./")
    eng = project_engine(project)
    if eng == "vintage":
        if rel.startswith("src/craft/") or rel.startswith("src/pixelart/"):
            return False, "vintage forbids craft/pixelart paths"
        if rel == "package.json":
            # will be checked for three dep elsewhere
            pass
    if eng == "pixel":
        if rel.startswith("src/pixelart/") and rel.endswith((".js",)):
            # allow only if new under systems — block full vendor replace of core files
            base = Path(rel).name
            if base in ("pixelart.js", "pixelart-fx.js"):
                return False, "immutable vendored pixelart engine"
        if rel.startswith("src/craft/"):
            return False, "pixel engine: use pixel juice, not three craft"
    if eng == "three":
        if rel.startswith("src/pixelart/") or rel.startswith("src/vintage/"):
            return False, "three engine: do not add pixelart/vintage trees via agent"
    try:
        import antislope as aslib

        if aslib.is_immutable_path(rel):
            return False, f"immutable host path {rel}"
    except Exception:
        pass
    return True, ""


def preserve_engine_in_compile(
    project: Path | None,
    prompt: str,
    *,
    genre: str | None = None,
    engine: str | None = None,
) -> dict:
    """compile_prompt that keeps existing project engine if not overridden."""
    import slice as slicelib

    eng = engine
    vprof = None
    if project and eng is None:
        old = load_slice(project)
        if old:
            eng = old.get("engine")
            if isinstance(old.get("vintage"), dict):
                vprof = old["vintage"].get("profile")
    return slicelib.compile_prompt(
        prompt, genre=genre, engine=eng, vintage_profile=vprof
    )


def main() -> int:
    import argparse

    ap = argparse.ArgumentParser(description="Multi-engine host ops")
    sub = ap.add_subparsers(dest="cmd")
    p = sub.add_parser("ship-card")
    p.add_argument("-p", "--project", required=True)
    p = sub.add_parser("switch")
    p.add_argument("-p", "--project", required=True)
    p.add_argument("engine", choices=["three", "pixel", "vintage"])
    p.add_argument("--profile", default="gb")
    p = sub.add_parser("room")
    p.add_argument("-p", "--project", required=True)
    p = sub.add_parser("palette")
    p.add_argument("-p", "--project", required=True)
    p.add_argument("id", nargs="?", default="dmg")
    p = sub.add_parser("stats")
    p = sub.add_parser("bake-budget")
    p.add_argument("-p", "--project", required=True)
    args = ap.parse_args()
    if args.cmd == "ship-card":
        print(json.dumps(ship_card(Path(args.project)), indent=2))
        return 0
    if args.cmd == "switch":
        print(
            json.dumps(
                switch_engine(
                    Path(args.project), args.engine, vintage_profile=args.profile
                ),
                indent=2,
            )[:4000]
        )
        return 0
    if args.cmd == "room":
        print(json.dumps(one_more_room(Path(args.project)), indent=2))
        return 0
    if args.cmd == "palette":
        print(json.dumps(set_vintage_palette(Path(args.project), args.id), indent=2))
        return 0
    if args.cmd == "stats":
        print(json.dumps(dashboard_stats(), indent=2))
        return 0
    if args.cmd == "bake-budget":
        print(json.dumps(bake_budget(Path(args.project)), indent=2))
        return 0
    ap.print_help()
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
