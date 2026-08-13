#!/usr/bin/env python3
"""Compile a player prompt into a playable Three.js slice.

Chat "Make this game" must not wait on the local LLM. The LLM may refine later.
A cube on a plane is a FAIL — this module writes a themed verb+place+juice slice.
"""
from __future__ import annotations

import hashlib
import json
import re
from pathlib import Path

import verify
from gmcommon import GAME_GITIGNORE, KNOWLEDGE, ROOT, TEMPLATES, slugify_project

CRAFT_LIB = ROOT / "lib" / "craft"
PIXELART_LIB = ROOT / "lib" / "pixelart"
VINTAGE_LIB = ROOT / "lib" / "vintage"

ENGINES = ("three", "pixel", "vintage")
# Vintage profiles: gb (default ship bar) ≤ gbc ≤ gba (hard ceiling)
VINTAGE_PROFILES = ("gb", "gbc", "gba")

_FENCE = re.compile(
    r"```(?:javascript|js|html|css|ts|mjs)?[ \t]*([a-zA-Z0-9_./-]+\.(?:js|mjs|html|css|ts))?[ \t]*\n(.*?)```",
    re.S,
)
_FILE_LINE = re.compile(r"(?m)^(?://|#)\s*file:\s*(\S+)\s*$")
_PATH_HEAD = re.compile(r"(?im)^\s*(?:file:\s*)?((?:src/)?[a-z0-9_./-]+\.(?:js|mjs|html|css|ts))\s*$")

GENRES = (
    "arena",
    "platformer",
    "fps",
    "tps",
    "adventure",
    "open-world",
    "racing",
    "runner",
    "tower-defense",
    "rpg",
    "card",
    "puzzle",
    "idle",
    "sports",
    "horror",
    "sandbox",
    "rhythm",
    "tycoon",
)

# First matching keyword wins. German + English.
_GENRE_RX: list[tuple[str, str]] = [
    (r"fps|first[- ]person|hitscan|aim.?down|ego.?shoot", "fps"),
    (r"shooter|shoot|blaster|gun|drone|baller|schie(ss|ß)", "fps"),
    (r"twin[- ]stick|wave.?shoot|arena", "arena"),
    (r"platform|jump|jumper|plattform|springen", "platformer"),
    (r"race|racing|drive|fahren|auto|car |kart", "racing"),
    (r"runner|endless|lane|dodge|rennen|ausweichen", "runner"),
    (r"horror|stealth|sneak|grusel|creepy|dunk(el|le)", "horror"),
    (r"tower|defend|verteidig", "tower-defense"),
    (r"rpg|quest|loot|level.?up", "rpg"),
    (r"card|deck|deckbuilder|karte", "card"),
    (r"puzzle|sokoban|match.?3|r[aä]tsel", "puzzle"),
    (r"idle|incremental|clicker|tapper", "idle"),
    (r"tycoon|sim|stadt|city[- ]build", "tycoon"),
    (r"sport|ball|soccer|skate", "sports"),
    (r"rhythm|beat|music.?game", "rhythm"),
    (r"open.?world|sandbox|erkund", "open-world"),
    (r"adventure|abenteuer|dorf|village|npc|talk|sprechen", "adventure"),
    (r"tps|third[- ]person", "tps"),
]

_SETTING_RX: list[tuple[str, str, str]] = [
    (r"neon|cyber|synth|futur|sci-?fi|space|tron|tokyo|blade|cyberpunk", "neon city", "neon"),
    (r"forest|grove|woods|jungle|tree|wald|hain", "pine grove", "forest"),
    (r"desert|dune|sand|canyon|wüste", "sun dunes", "desert"),
    (r"ice|snow|arctic|frost|eis|schnee", "ice field", "ice"),
    (r"dungeon|castle|crypt|ruin|kerker|burg", "stone keep", "dungeon"),
    (r"village|town|markt|dorf", "dusk village", "village"),
    (r"horror|night|dark|nacht", "black street", "dungeon"),
    (r"ocean|sea|beach|coast|meer|küste", "tide flats", "desert"),
]

_PALETTES: dict[str, dict] = {
    # NEON INK locked tokens — ship bar palette (no drift)
    "neon": {
        "bg": 0x0A0612,
        "ground": 0x12101C,
        "grid": 0x00F0FF,
        "player": 0xFF2BD6,
        "accent": 0xFF2BD6,
        "enemy": 0xB8FF00,
        "building": 0x1C1235,
        "hemiSky": 0xA8B8FF,
        "hemiGround": 0x1A0A3E,
        "sun": 0xFFE066,
        "fogNear": 8,
        "fogFar": 70,
    },
    "forest": {
        "bg": 0x0d1a12,
        "ground": 0x1d3a24,
        "grid": 0x3d6b45,
        "player": 0xe8c27a,
        "accent": 0x4cae5a,
        "enemy": 0xc45c38,
        "building": 0x3a2a18,
        "hemiSky": 0xb7e0c0,
        "hemiGround": 0x243018,
        "sun": 0xffe0a3,
        "fogNear": 14,
        "fogFar": 70,
    },
    "desert": {
        "bg": 0x24180c,
        "ground": 0xc4a06a,
        "grid": 0xe8c888,
        "player": 0xfff1c8,
        "accent": 0xe07a2f,
        "enemy": 0x8b2e1c,
        "building": 0x8a6a3c,
        "hemiSky": 0xffd7a0,
        "hemiGround": 0x5a3a18,
        "sun": 0xffc878,
        "fogNear": 16,
        "fogFar": 80,
    },
    "ice": {
        "bg": 0x0b1622,
        "ground": 0xc8d8e8,
        "grid": 0x8ec8ff,
        "player": 0xe8f4ff,
        "accent": 0x5ec8ff,
        "enemy": 0x3a5080,
        "building": 0x9bb4c8,
        "hemiSky": 0xd0e8ff,
        "hemiGround": 0x203040,
        "sun": 0xffffff,
        "fogNear": 12,
        "fogFar": 64,
    },
    "dungeon": {
        "bg": 0x0a080c,
        "ground": 0x1a1618,
        "grid": 0x3a3034,
        "player": 0xe8d8c0,
        "accent": 0xff6a3c,
        "enemy": 0x8b2040,
        "building": 0x2a2428,
        "hemiSky": 0x6a5058,
        "hemiGround": 0x121014,
        "sun": 0xff8844,
        "fogNear": 6,
        "fogFar": 36,
    },
    "village": {
        "bg": 0x151018,
        "ground": 0x3a3228,
        "grid": 0x6a5a40,
        "player": 0xf0d0a0,
        "accent": 0xe8a040,
        "enemy": 0x804030,
        "building": 0x5a4030,
        "hemiSky": 0xffc8a0,
        "hemiGround": 0x2a2018,
        "sun": 0xffb070,
        "fogNear": 16,
        "fogFar": 72,
    },
    "dusk": {
        "bg": 0x101018,
        "ground": 0x242432,
        "grid": 0x5a6080,
        "player": 0x8ec8ff,
        "accent": 0xffc86a,
        "enemy": 0xff6a6a,
        "building": 0x2c3040,
        "hemiSky": 0xa8c0e0,
        "hemiGround": 0x181820,
        "sun": 0xffd0a0,
        "fogNear": 14,
        "fogFar": 68,
    },
}

_LOOP = {
    "fps": "shoot",
    "arena": "shoot",
    "tower-defense": "shoot",
    "platformer": "jump",
    "runner": "run",
    "racing": "race",
    "horror": "sneak",
    "adventure": "talk",
    "rpg": "talk",
    "open-world": "talk",
    "tps": "talk",
    "sandbox": "talk",
    "puzzle": "collect",
    "card": "collect",
    "idle": "collect",
    "sports": "collect",
    "rhythm": "collect",
    "tycoon": "talk",
}

_CAMERA = {
    "fps": "fps",
    "arena": "top",
    "tower-defense": "top",
    "platformer": "side",
    "runner": "chase",
    "racing": "chase",
    "horror": "fps",
    "adventure": "tps",
    "rpg": "tps",
    "open-world": "tps",
    "tps": "tps",
    "sandbox": "tps",
    "puzzle": "tps",
    "card": "tps",
    "idle": "tps",
    "sports": "chase",
    "rhythm": "tps",
    "tycoon": "top",
}

_FEEL = {
    # Skill-FPS bar (NEON INK feel extract)
    "fps": dict(
        moveSpeed=7.2, accel=52, friction=28, gravity=28, jumpForce=8.4,
        coyoteMs=100, jumpBufferMs=90, jumpCut=0.42,
        dashSpeed=22, dashMs=140, dashCdMs=700,
        camLag=10, camDist=0.1, camHeight=1.62, eyeHeight=1.62,
        fov=78, adsFov=62, mouseSens=0.002, fireRpm=480, damage=18,
        spread=0.014, adsSpread=0.004, hitstopMs=40, shakeHit=0.14, hp=100,
    ),
    "arena": dict(
        moveSpeed=7.8, accel=48, friction=26, gravity=24, jumpForce=8.0,
        coyoteMs=90, jumpBufferMs=80, jumpCut=0.45,
        dashSpeed=20, dashMs=120, dashCdMs=650,
        camLag=14, camDist=16, camHeight=16, eyeHeight=1.2, fov=55, hp=100,
        fireRpm=420, damage=16, spread=0.02, adsSpread=0.01,
    ),
    "platformer": dict(moveSpeed=7.0, accel=48, friction=28, gravity=28, jumpForce=9.0, coyoteMs=110, jumpBufferMs=100, jumpCut=0.42, camLag=10, camDist=11, camHeight=3.2, eyeHeight=1.2, fov=58, hp=3),
    "runner": dict(moveSpeed=6.0, runSpeed=12, accel=40, friction=22, gravity=26, jumpForce=8.5, coyoteMs=100, jumpBufferMs=90, jumpCut=0.45, camLag=12, camDist=8, camHeight=3.4, eyeHeight=1.4, fov=60, hp=1),
    "racing": dict(moveSpeed=14, accel=28, friction=12, gravity=22, jumpForce=6.0, coyoteMs=80, jumpBufferMs=70, jumpCut=0.5, camLag=6, camDist=8.5, camHeight=3.2, eyeHeight=1.2, fov=62, hp=1),
    "horror": dict(moveSpeed=3.8, accel=32, friction=22, gravity=22, jumpForce=6.2, coyoteMs=80, jumpBufferMs=70, jumpCut=0.5, camLag=5, camDist=4.2, camHeight=1.6, eyeHeight=1.6, fov=52, hp=1),
    "adventure": dict(moveSpeed=5.6, accel=36, friction=22, gravity=22, jumpForce=7.4, coyoteMs=100, jumpBufferMs=90, jumpCut=0.45, camLag=7, camDist=6.5, camHeight=2.4, eyeHeight=1.5, fov=58, hp=3),
}

_FEEL_DEFAULT = dict(
    moveSpeed=6.2,
    runSpeed=8.4,
    accel=42,
    friction=26,
    gravity=24,
    jumpForce=8.2,
    coyoteMs=100,
    jumpBufferMs=90,
    jumpCut=0.45,
    camLag=8,
    camDist=6.4,
    camHeight=2.15,
    eyeHeight=1.55,
    fov=58,
    hp=3,
    hitstopMs=40,
    mouseSens=0.0022,
    pitchMin=-1.15,
    pitchMax=1.25,
)


def infer_engine(prompt: str, explicit: str | None = None) -> str:
    """three | pixel | vintage (GB ship bar, GBA ceiling)."""
    if explicit in ENGINES:
        return explicit
    p = (prompt or "").lower()
    if re.search(
        r"\bvintage\b|game\s*boy|\bgba\b|\bgbc\b|\bdmg\b|handheld retro|"
        r"gameboy|gb style|8.?bit handheld|link.?s awakening",
        p,
    ):
        return "vintage"
    if re.search(
        r"\bpixel\b|pixel.?art|pixelart|sprite.?kit|2d canvas|canvas2d|bakeCanvas|tileset",
        p,
    ):
        return "pixel"
    if re.search(r"\bthree\.?js\b|webgl|3d |fps|first.?person", p):
        return "three"
    return "three"


def infer_vintage_profile(prompt: str, explicit: str | None = None) -> str:
    """gb (default) | gbc | gba — never above gba."""
    if explicit in VINTAGE_PROFILES:
        return explicit
    p = (prompt or "").lower()
    if re.search(r"\bgba\b|game\s*boy\s*advance|advance", p):
        return "gba"
    if re.search(r"\bgbc\b|game\s*boy\s*color|color", p):
        return "gbc"
    return "gb"


def infer_kind(prompt: str, engine: str | None = None) -> str:
    eng = engine or infer_engine(prompt)
    if eng == "vintage":
        return "vintage-game"
    if eng == "pixel":
        return "pixel-game"
    p = (prompt or "").lower()
    if re.search(r"vintage|game\s*boy|\bgba\b|\bgbc\b", p):
        return "vintage-game"
    if re.search(r"pixel|sprite|tileset|bakeCanvas|pixelart", p):
        return "pixel-game"
    if re.search(r"open.?world|whole world|heightfield|biome|worldclaw", p):
        return "world-game"
    if re.search(r"shader|shadertoy|raymarch", p):
        return "shader-lab"
    return "web-game"


def _vintage_mood(props: str, genre: str) -> str:
    p = (props or "").lower()
    if p in ("forest",):
        return "forest"
    if p in ("ice", "desert"):
        return "ocean" if p == "ice" else "fire"
    if p in ("dungeon", "horror") or genre == "horror":
        return "dungeon"
    if p == "neon":
        return "night"
    return "forest"


def vintage_config(profile: str, props: str = "forest", genre: str = "adventure") -> dict:
    """Host vintage runtime + palette. Hard-capped at GBA."""
    profile = profile if profile in VINTAGE_PROFILES else "gb"
    mood = _vintage_mood(props, genre)
    # Pure-Python mirror of lib/vintage/palettes.js (no JS import)
    dmg = [0x0F380F, 0x306230, 0x8BAC0F, 0x9BBC0F]
    gbc_packs = {
        "forest": [0x1B1F1A, 0x3E5C38, 0x8FBF6A, 0xDCE8C0],
        "ocean": [0x0B1A2A, 0x1E4A6E, 0x5AA9D6, 0xC8E8F8],
        "fire": [0x1A0A08, 0x6B2010, 0xD06020, 0xF0D090],
        "mono": [0x101018, 0x404050, 0xA0A0B0, 0xF0F0F8],
        "candy": [0x201028, 0x703868, 0xE080B0, 0xF8E0F0],
        "dungeon": [0x101018, 0x282838, 0x606878, 0xC8C0A8],
        "night": [0x080818, 0x203050, 0x608060, 0xE8E0C8],
    }
    gba_overworld = [
        0x1A2030, 0x2D4A3E, 0x4A7A50, 0x8CBC70,
        0x3A5068, 0x6080A0, 0xA0C0D8,
        0x4A3020, 0x8A6040, 0xC8A070,
        0x202028, 0xF0E8D0,
        0xC04040, 0xE0C040, 0x60A0E0,
    ]
    if profile == "gb":
        colors = dmg
        w, h, max_c = 160, 144, 4
    elif profile == "gbc":
        colors = gbc_packs.get(mood) or gbc_packs["forest"]
        w, h, max_c = 160, 144, 8
    else:
        colors = gba_overworld[:15]
        w, h, max_c = 240, 160, 15
    # Ceiling enforcement
    w = min(w, 240)
    h = min(h, 160)
    max_c = min(max_c, 15)
    colors = colors[:max_c]
    # Slice palette dict for WIKI/spec
    palette = {
        "bg": colors[0],
        "ground": colors[1] if len(colors) > 1 else colors[0],
        "grid": colors[2] if len(colors) > 2 else colors[-1],
        "player": colors[3] if len(colors) > 3 else colors[-1],
        "accent": colors[2] if len(colors) > 2 else colors[-1],
        "enemy": colors[1] if len(colors) > 1 else colors[0],
        "building": colors[1] if len(colors) > 1 else colors[0],
        "hemiSky": colors[2] if len(colors) > 2 else colors[-1],
        "hemiGround": colors[0],
        "sun": colors[-1],
        "fogNear": 0,
        "fogFar": 0,
    }
    return {
        "profile": profile,
        "width": w,
        "height": h,
        "maxColors": max_c,
        "colors": colors,
        "mood": mood,
        "ceiling": "gba",
        "integerScale": True,
        "noThree": True,
        "noPostFx": True,
        "palette": palette,
    }


def infer_genre(prompt: str) -> str:
    p = (prompt or "").lower()
    for rx, genre in _GENRE_RX:
        if re.search(rx, p):
            return genre
    return "adventure"


def _setting(prompt: str) -> tuple[str, str]:
    p = (prompt or "").lower()
    for rx, name, props in _SETTING_RX:
        if re.search(rx, p):
            return name, props
    genre = infer_genre(prompt)
    if genre == "fps":
        return "neon city", "neon"
    if genre == "horror":
        return "black street", "dungeon"
    if genre == "platformer":
        return "dusk platforms", "dusk"
    if genre in ("adventure", "rpg", "open-world"):
        return "dusk village", "village"
    return "dusk plaza", "dusk"


def _verb(genre: str, setting: str) -> str:
    return {
        "fps": f"shoot drones in the {setting}",
        "arena": f"clear waves in the {setting}",
        "platformer": f"jump the ledges of the {setting}",
        "runner": f"dodge through the {setting}",
        "racing": f"hit gates in the {setting}",
        "horror": f"reach the door without being caught in the {setting}",
        "adventure": f"walk, talk, and change the {setting}",
        "rpg": f"talk and collect in the {setting}",
        "tower-defense": f"hold the {setting}",
        "open-world": f"explore the {setting}",
    }.get(genre, f"play in the {setting}")


def _title(prompt: str) -> str:
    words = re.findall(r"[A-Za-zÄÖÜäöüß0-9]+", prompt or "")
    if not words:
        return "New Game"
    return " ".join(w.capitalize() for w in words[:5])


def compile_prompt(
    prompt: str,
    genre: str | None = None,
    engine: str | None = None,
    vintage_profile: str | None = None,
) -> dict:
    text = (prompt or "").strip() or "small adventure"
    eng = infer_engine(text, engine)
    g = genre if genre in GENRES else infer_genre(text)
    # Pixel / Vintage: no free-look 3D FPS
    if eng in ("pixel", "vintage") and g == "fps":
        g = "arena"
    # Vintage: open-world → short adventure (handheld)
    if eng == "vintage" and g in ("open-world", "sandbox", "tycoon"):
        g = "adventure"
    setting, props = _setting(text)
    seed = int(hashlib.md5(text.encode("utf-8")).hexdigest()[:8], 16)
    feel = dict(_FEEL_DEFAULT)
    feel.update(_FEEL.get(g, {}))
    feel.setdefault("runSpeed", 8.4)
    feel.setdefault("hitstopMs", 40)
    feel.setdefault("mouseSens", 0.0022)
    feel.setdefault("pitchMin", -1.15)
    feel.setdefault("pitchMax", 1.25)
    # Vintage feel: snappier, lower HP budget
    if eng == "vintage":
        feel["hp"] = min(int(feel.get("hp") or 3), 5)
        feel["accel"] = min(70, float(feel.get("accel") or 42) * 1.15)
        feel["camLag"] = min(10, float(feel.get("camLag") or 8))
    loop = _LOOP.get(g, "talk")
    cam = _CAMERA.get(g, "tps")
    if eng in ("pixel", "vintage") and cam == "fps":
        cam = "top" if loop == "shoot" else ("side" if loop in ("jump", "run") else "top")
    kind = infer_kind(text, eng)
    palette = dict(_PALETTES.get(props, _PALETTES["dusk"]))
    vcfg = None
    if eng == "vintage":
        vprof = infer_vintage_profile(text, vintage_profile)
        vcfg = vintage_config(vprof, props, g)
        palette = dict(vcfg["palette"])
    ship = "vertical-slice"
    if eng == "vintage":
        ship = f"vintage-{(vcfg or {}).get('profile') or 'gb'}"
    elif loop == "shoot" or g in ("fps", "arena"):
        ship = "neon-ink"
    spec = {
        "prompt": text,
        "title": _title(text),
        "slug": slugify_project(text[:48]),
        "genre": g,
        "engine": eng,
        "setting": setting,
        "props": props,
        "loop": loop,
        "camera": cam,
        "verb": _verb(g, setting),
        "palette": palette,
        "feel": feel,
        "seed": seed,
        "kind": kind,
        "enemyCount": (
            min(4, 8 if loop == "shoot" else 0)
            if eng == "vintage"
            else (8 if loop == "shoot" else (1 if loop == "sneak" else 0))
        ),
        "coinCount": min(8, 6 if loop in ("jump", "talk", "collect") else 0) if eng == "vintage" else (6 if loop in ("jump", "talk", "collect") else 0),
        "hazardCount": 8 if loop == "run" else 0,
        "density": 1.0,
        "juice": 0.85 if eng == "vintage" else 1.0,
        "shipBar": ship,
    }
    if vcfg:
        spec["vintage"] = vcfg
    return spec


def summarize(spec: dict) -> str:
    eng = spec.get("engine") or "three"
    if eng == "vintage":
        vp = (spec.get("vintage") or {}).get("profile") or "gb"
        eng_line = (
            f"Engine: **Vintage** · profile **{vp.upper()}** "
            f"(ship bar Game Boy, ceiling GBA 240×160 / ≤15 colors)."
        )
    elif eng == "pixel":
        eng_line = "Engine: **Pixel** (Canvas2D · pixelart.js + FX)."
    else:
        eng_line = "Engine: **Three.js** (WebGL)."
    cam = {
        "fps": "Click the game to look. WASD move, mouse look, click fire, Space jump, R restart.",
        "side": "A/D move, Space jump, R restart.",
        "top": "WASD move, click fire, R restart.",
        "chase": "WASD move, Space jump, R restart.",
        "tps": "WASD move, Space jump, E talk when close, R restart.",
    }.get(spec.get("camera") or "tps", "WASD move, R restart.")
    return (
        f"The fun is: {spec['verb']}.\n"
        f"{eng_line}\n"
        f"{spec['title']} · {spec['genre']} · {spec['setting']} · loop {spec['loop']}.\n"
        f"{cam}\n"
        "Play it. Then tweak with words like floaty / more enemies / neon — instant, no model wait.\n"
        "For dialogue, ragdoll, shaders: Continue with that system."
    )


def extract_code_files(text: str) -> list[tuple[str, str]]:
    """Pull path + body out of markdown fences. Prefer an explicit path."""
    out: list[tuple[str, str]] = []
    untitled: list[str] = []
    for m in _FENCE.finditer(text or ""):
        path = (m.group(1) or "").strip()
        body = m.group(2) or ""
        head = _FILE_LINE.search(body) or _PATH_HEAD.match(body.split("\n", 1)[0] if body else "")
        if head:
            path = head.group(1).strip()
            if _FILE_LINE.search(body) or _PATH_HEAD.match(body.split("\n", 1)[0]):
                body = body.split("\n", 1)[1] if "\n" in body else ""
        if not path:
            untitled.append(body)
            continue
        path = path.lstrip("./")
        if _allowed(path):
            out.append((path, body.rstrip() + "\n"))
    if not out:
        for body in untitled:
            guessed = _guess_path(body)
            if guessed:
                out.append((guessed, body.rstrip() + "\n"))
    if not out and text and "```" not in text:
        guessed = _guess_path(text)
        if guessed:
            out.append((guessed, text.rstrip() + "\n"))
    return out


def _allowed(path: str) -> bool:
    if ".." in path or path.startswith("/"):
        return False
    return path.startswith("src/") or path in {
        "index.html",
        "package.json",
        "WIKI.md",
        "DESIGN.md",
    }


def _guess_path(body: str) -> str | None:
    if re.search(r"export\s+function\s+createGame|from\s+['\"]three['\"]", body):
        return "src/game.js"
    if re.search(r"<!DOCTYPE|<html", body, re.I):
        return "index.html"
    if re.search(r"createGame\s*\(|from\s+['\"]\./game", body):
        return "src/main.js"
    return None


def write_reply_files(project: Path, text: str) -> list[str]:
    written: list[str] = []
    for rel, body in extract_code_files(text):
        dest = (project / rel).resolve()
        try:
            dest.relative_to(project.resolve())
        except ValueError:
            continue
        dest.parent.mkdir(parents=True, exist_ok=True)
        dest.write_text(body, encoding="utf-8")
        written.append(rel)
    return written


def apply_model_files(project: Path, text: str) -> dict:
    """Prefer surgical @@ patches; else fenced files. Roll back on P0 fail."""
    # 1) Patch grammar first (does not full-replace protected large files)
    try:
        import quality as qualitylib

        if qualitylib.parse_patches(text or ""):
            res = qualitylib.apply_patches(project, text or "")
            if res.get("written"):
                result = verify.evaluate(project)
                if result.get("p0_fail"):
                    # best-effort: no full backup tree; leave files but report
                    return {
                        "written": res.get("written") or [],
                        "rejected": True,
                        "reason": "verify P0 after patch: " + ", ".join(result["p0_fail"]),
                        "mode": "patch",
                    }
                return {
                    "written": res.get("written") or [],
                    "rejected": False,
                    "reason": "",
                    "mode": "patch",
                    "patch_rejected": res.get("rejected") or [],
                }
    except Exception:
        pass

    files = extract_code_files(text)
    if not files:
        return {"written": [], "rejected": True, "reason": "no files"}
    backups: dict[str, str | None] = {}
    written: list[str] = []
    blocked: list[str] = []
    for rel, body in files:
        dest = project / rel
        try:
            dest.resolve().relative_to(project.resolve())
        except ValueError:
            continue
        backups[rel] = dest.read_text(encoding="utf-8") if dest.is_file() else None
        # Enforce quality full-write gate for large protected files
        try:
            import quality as qualitylib

            gate = qualitylib.apply_full_write(project, rel, body, force=False)
            if not gate.get("ok"):
                blocked.append(f"{rel}: {gate.get('error')}")
                backups.pop(rel, None)
                continue
            written.append(rel)
            continue
        except Exception:
            pass
        dest.parent.mkdir(parents=True, exist_ok=True)
        dest.write_text(body, encoding="utf-8")
        written.append(rel)
    if not written and blocked:
        return {
            "written": [],
            "rejected": True,
            "reason": "; ".join(blocked[:4]),
            "mode": "blocked",
        }
    result = verify.evaluate(project)
    if result.get("p0_fail"):
        for rel, old in backups.items():
            dest = project / rel
            if old is None:
                if dest.is_file():
                    dest.unlink()
            else:
                dest.write_text(old, encoding="utf-8")
        return {
            "written": [],
            "rejected": True,
            "reason": "verify P0: " + ", ".join(result["p0_fail"]),
        }
    return {"written": written, "rejected": False, "reason": "", "mode": "files"}


def _template() -> str:
    path = TEMPLATES / "web-slice" / "game.js"
    return path.read_text(encoding="utf-8")


def _slim_spec(spec: dict) -> dict:
    return {
        "title": spec["title"],
        "genre": spec["genre"],
        "engine": spec.get("engine") or "three",
        "setting": spec["setting"],
        "props": spec["props"],
        "loop": spec["loop"],
        "camera": spec["camera"],
        "verb": spec["verb"],
        "palette": spec["palette"],
        "seed": spec["seed"],
        "enemyCount": int(spec.get("enemyCount") or 0),
        "coinCount": int(spec.get("coinCount") or 0),
        "hazardCount": int(spec.get("hazardCount") or 0),
        "density": float(spec.get("density") or 1.0),
        "juice": float(spec.get("juice") or 1.0),
        "roomCount": int(spec.get("roomCount") or 1),
    }


def render_game_js(spec: dict) -> str:
    slim = _slim_spec(spec)
    feel = dict(spec.get("feel") or {})
    feel.setdefault("shakeHit", 0.12)
    feel.setdefault("hitstopMs", 40)
    src = _template()
    src = src.replace("__SPEC__", json.dumps(slim, ensure_ascii=False))
    src = src.replace("__CONFIG__", json.dumps(feel, ensure_ascii=False))
    return src


def render_pixel_game_js(spec: dict) -> str:
    slim = _slim_spec(spec)
    feel = dict(spec.get("feel") or {})
    feel.setdefault("shakeHit", 0.12)
    feel.setdefault("hitstopMs", 40)
    path = TEMPLATES / "pixel-slice" / "game.js"
    src = path.read_text(encoding="utf-8")
    src = src.replace("__SPEC__", json.dumps(slim, ensure_ascii=False))
    src = src.replace("__CONFIG__", json.dumps(feel, ensure_ascii=False))
    return src


def write_slice(dest: Path, spec: dict) -> list[str]:
    """Dispatch by engine: three | pixel | vintage."""
    eng = spec.get("engine") or "three"
    if eng == "vintage" or spec.get("kind") == "vintage-game":
        spec = dict(spec)
        spec["engine"] = "vintage"
        if not spec.get("vintage"):
            spec["vintage"] = vintage_config(
                "gb", str(spec.get("props") or "forest"), str(spec.get("genre") or "adventure")
            )
            spec["palette"] = dict(spec["vintage"]["palette"])
        return write_vintage_slice(dest, spec)
    if eng == "pixel" or spec.get("kind") == "pixel-game":
        spec = dict(spec)
        spec["engine"] = "pixel"
        return write_pixel_slice(dest, spec)
    return write_web_slice(dest, spec)


def write_vintage_slice(dest: Path, spec: dict) -> list[str]:
    """
    Handheld-era slice: GB ship bar, hard GBA ceiling.
    Pure Canvas2D — no Three.js, no modern post-FX.
    """
    dest.mkdir(parents=True, exist_ok=True)
    name = spec.get("title") or dest.name
    genre = spec["genre"]
    vcfg = dict(spec.get("vintage") or vintage_config("gb"))
    # Enforce ceiling again at write time
    vcfg["width"] = min(int(vcfg.get("width") or 160), 240)
    vcfg["height"] = min(int(vcfg.get("height") or 144), 160)
    vcfg["maxColors"] = min(int(vcfg.get("maxColors") or 4), 15)
    colors = list(vcfg.get("colors") or [])[: vcfg["maxColors"]]
    vcfg["colors"] = colors
    written: list[str] = []

    def put(rel: str, content: str) -> None:
        path = dest / rel
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_text(content, encoding="utf-8")
        written.append(rel)

    put(
        "package.json",
        json.dumps(
            {
                "name": slugify_project(name),
                "private": True,
                "version": "0.1.0",
                "type": "module",
                "scripts": {
                    "dev": "vite",
                    "build": "vite build",
                    "preview": "vite preview",
                },
                "devDependencies": {"vite": "^6.0.0"},
            },
            indent=2,
        )
        + "\n",
    )
    bg = f"#{int(colors[0] if colors else 0x0F380F):06x}"
    put(
        "index.html",
        f"""<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover" />
  <title>{name}</title>
  <style>
    html, body {{ margin: 0; height: 100%; overflow: hidden; background: {bg}; }}
    canvas {{ display: block; image-rendering: pixelated; image-rendering: crisp-edges; }}
    #hud {{
      position: fixed; left: 8px; top: 8px; color: {bg};
      mix-blend-mode: difference;
      font: 12px/1.2 ui-monospace, Menlo, monospace;
      pointer-events: none; letter-spacing: 0.02em;
    }}
  </style>
</head>
<body>
  <div id="hud">{name} · vintage</div>
  <script type="module" src="/src/main.js"></script>
</body>
</html>
""",
    )
    put(
        "src/main.js",
        f"""import {{ createGame }} from './game.js';

const game = createGame({{
  genre: {genre!r},
  title: {name!r},
}});
game.start();
""",
    )
    slim = _slim_spec(spec)
    slim["engine"] = "vintage"
    feel = dict(spec.get("feel") or {})
    feel["hp"] = min(int(feel.get("hp") or 3), 5)
    path = TEMPLATES / "vintage-slice" / "game.js"
    src = path.read_text(encoding="utf-8")
    src = src.replace("__SPEC__", json.dumps(slim, ensure_ascii=False))
    src = src.replace("__CONFIG__", json.dumps(feel, ensure_ascii=False))
    src = src.replace("__VINTAGE__", json.dumps(vcfg, ensure_ascii=False))
    put("src/game.js", src)

    # Optional tiny palettes module for LLM expansion (immutable ceiling docs)
    if VINTAGE_LIB.is_dir():
        import shutil

        dest_v = dest / "src" / "vintage"
        if dest_v.exists():
            shutil.rmtree(dest_v)
        shutil.copytree(VINTAGE_LIB, dest_v)
        for p in dest_v.rglob("*"):
            if p.is_file():
                written.append(str(p.relative_to(dest)))

    from gmcommon import meta_dir

    meta = meta_dir(dest)
    meta.mkdir(parents=True, exist_ok=True)
    spec_out = dict(spec)
    spec_out["engine"] = "vintage"
    spec_out["vintage"] = vcfg
    spec_out["palette"] = dict(vcfg.get("palette") or spec.get("palette") or {})
    (meta / "slice.json").write_text(json.dumps(spec_out, indent=2) + "\n", encoding="utf-8")
    written.append(str((meta / "slice.json").relative_to(dest)))

    prof = vcfg.get("profile") or "gb"
    put(
        "WIKI.md",
        f"""# {name}

* Engine: **vintage** · profile **{prof}** (ceiling: GBA)
* Resolution: {vcfg['width']}×{vcfg['height']} · max colors: {vcfg['maxColors']}
* Genre: {spec.get("genre")}
* Verb at t=8s: {spec.get("verb")}
* Setting: {spec.get("setting")}

## Controls
D-pad / WASD · A=Z/Space jump · B=X/J attack · Start=R restart

## Law
Never exceed Game Boy Advance (240×160, ≤15 colors, no 3D, integer scale).
""",
    )
    put(
        "DESIGN.md",
        f"""# {name}

## Engine
Vintage handheld — profile `{prof}` · **GBA is the hard ceiling**

## Core loop
{spec.get("verb")}

## Constraints
- Internal res ≤ 240×160 (this slice: {vcfg['width']}×{vcfg['height']})
- Colors ≤ 15 (this slice: {vcfg['maxColors']})
- No Three.js, no bloom, no smooth scale

## Backlog
- [ ] One more screen / room
- [ ] Tune jump / HP
- [ ] Extra enemy pattern (still ≤4 on screen)
""",
    )
    gi = dest / ".gitignore"
    if not gi.is_file():
        put(".gitignore", GAME_GITIGNORE)
    return written


def write_pixel_slice(dest: Path, spec: dict) -> list[str]:
    """Vite + pure Canvas2D using vendored pixelart.js / pixelart-fx.js."""
    import shutil

    dest.mkdir(parents=True, exist_ok=True)
    name = spec.get("title") or dest.name
    genre = spec["genre"]
    written: list[str] = []

    def put(rel: str, content: str) -> None:
        path = dest / rel
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_text(content, encoding="utf-8")
        written.append(rel)

    put(
        "package.json",
        json.dumps(
            {
                "name": slugify_project(name),
                "private": True,
                "version": "0.1.0",
                "type": "module",
                "scripts": {
                    "dev": "vite",
                    "build": "vite build",
                    "preview": "vite preview",
                },
                "devDependencies": {"vite": "^6.0.0"},
            },
            indent=2,
        )
        + "\n",
    )
    pal = spec["palette"]
    bg = f"#{pal['bg']:06x}"
    put(
        "index.html",
        f"""<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover" />
  <title>{name}</title>
  <style>
    html, body {{ margin: 0; height: 100%; overflow: hidden; background: {bg}; }}
    canvas {{ display: block; width: 100%; height: 100%; image-rendering: pixelated; image-rendering: crisp-edges; }}
    #hud {{
      position: fixed; left: 12px; top: 12px; color: #e8eaef;
      font: 600 14px/1.4 system-ui, sans-serif; text-shadow: 0 1px 2px #000;
      pointer-events: none; max-width: 70vw;
    }}
  </style>
</head>
<body>
  <div id="hud">{name} · {spec["verb"]} · pixel</div>
  <script type="module" src="/src/main.js"></script>
</body>
</html>
""",
    )
    put(
        "src/main.js",
        f"""import {{ createGame }} from './game.js';

const game = createGame({{
  genre: {genre!r},
  title: {name!r},
}});
game.start();
""",
    )
    if not PIXELART_LIB.is_dir():
        raise FileNotFoundError(f"pixelart lib missing: {PIXELART_LIB}")
    dest_px = dest / "src" / "pixelart"
    if dest_px.exists():
        shutil.rmtree(dest_px)
    shutil.copytree(PIXELART_LIB, dest_px)
    for p in dest_px.rglob("*"):
        if p.is_file():
            written.append(str(p.relative_to(dest)))
    put("src/game.js", render_pixel_game_js(spec))
    from gmcommon import meta_dir

    meta = meta_dir(dest)
    meta.mkdir(parents=True, exist_ok=True)
    (meta / "slice.json").write_text(json.dumps(spec, indent=2) + "\n", encoding="utf-8")
    written.append(str((meta / "slice.json").relative_to(dest)))
    put(
        "WIKI.md",
        f"""# {name}

* Engine: **pixel** (Canvas2D · pixelart.js + pixelart-fx.js)
* Genre: {spec.get("genre")}
* Verb at t=8s: {spec.get("verb")}
* Setting: {spec.get("setting")}

## Controls
WASD / arrows · Space jump (side) · J attack · R restart
""",
    )
    put(
        "DESIGN.md",
        f"""# {name}

## Engine
Pixel (Canvas2D) — `src/pixelart/pixelart.js` + `pixelart-fx.js`

## Core loop
{spec.get("verb")}

## Backlog
- [ ] More baked props via layeredRect / makeBakedSprite
- [ ] One FX (pxJelly / pxShake) on land
- [ ] Tune CONFIG feel
""",
    )
    gi = dest / ".gitignore"
    if not gi.is_file():
        put(".gitignore", GAME_GITIGNORE)
    return written


def write_web_slice(dest: Path, spec: dict) -> list[str]:
    """Write a themed Vite + Three.js slice. Does not touch node_modules."""
    dest.mkdir(parents=True, exist_ok=True)
    name = spec.get("title") or dest.name
    genre = spec["genre"]
    written: list[str] = []
    if "engine" not in spec:
        spec = dict(spec)
        spec["engine"] = "three"

    def put(rel: str, content: str) -> None:
        path = dest / rel
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_text(content, encoding="utf-8")
        written.append(rel)

    pkg = dest / "package.json"
    if not pkg.is_file():
        put(
            "package.json",
            json.dumps(
                {
                    "name": slugify_project(name),
                    "private": True,
                    "version": "0.1.0",
                    "type": "module",
                    "scripts": {
                        "dev": "vite",
                        "build": "vite build",
                        "preview": "vite preview",
                    },
                    "dependencies": {"three": "^0.170.0"},
                    "devDependencies": {"vite": "^6.0.0"},
                },
                indent=2,
            )
            + "\n",
        )

    pal = spec["palette"]
    bg = f"#{pal['bg']:06x}"
    put(
        "index.html",
        f"""<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover" />
  <title>{name}</title>
  <style>
    html, body {{ margin: 0; height: 100%; overflow: hidden; background: {bg}; }}
    canvas {{ display: block; }}
    #hud {{
      position: fixed; left: 12px; top: 12px; color: #e8eaef;
      font: 600 14px/1.4 system-ui, sans-serif; text-shadow: 0 1px 2px #000;
      pointer-events: none; max-width: 70vw;
    }}
  </style>
</head>
<body>
  <div id="hud">{name} · {spec["verb"]}</div>
  <script type="module" src="/src/main.js"></script>
</body>
</html>
""",
    )
    put(
        "src/main.js",
        f"""import {{ createGame }} from './game.js';

const game = createGame({{
  genre: {genre!r},
  title: {name!r},
}});
game.start();
""",
    )
    # Vendor Grok craft kit (NEON INK juice/audio/palette) into the project
    if CRAFT_LIB.is_dir():
        import shutil

        dest_craft = dest / "src" / "craft"
        if dest_craft.exists():
            shutil.rmtree(dest_craft)
        shutil.copytree(CRAFT_LIB, dest_craft)
        for p in dest_craft.rglob("*"):
            if p.is_file():
                written.append(str(p.relative_to(dest)))

    # Host genre slots (novelty / weapon / enemy) — LLM fills later; host owns machine
    try:
        import slots as slotslib

        slotslib.fill_slots(spec)
    except Exception:
        pass
    put("src/game.js", render_game_js(spec))
    try:
        import slots as slotslib

        for rel in slotslib.write_slot_module(dest, spec):
            if rel not in written:
                written.append(rel)
    except Exception:
        pass
    try:
        import antislope as aslib

        aslib.ensure_kits_readme(dest)
        aslib.format_project(dest)
        written.append("src/kits/README.md")
    except Exception:
        pass
    hexes = " ".join(
        f"{k}=#{v:06x}" for k, v in pal.items() if k not in ("fogNear", "fogFar")
    )
    put(
        "WIKI.md",
        f"""# Wiki

Living facts for this game. One bullet + **Why:**. Loaded into every Studio/Agent turn.

- Engine is Three.js (Vite, vanilla). **Why:** engine=three default.
- Genre: {genre}. **Why:** compiled from the player prompt.
- Setting: {spec["setting"]}. **Why:** the place the prompt asked for.
- Verb at t=8s: {spec["verb"]}. **Why:** completeness law.
- Loop: {spec["loop"]} · camera: {spec["camera"]}. **Why:** genre table.
- Palette: {hexes}. **Why:** locked hexes, do not reroll.
- Prompt: {spec["prompt"]}. **Why:** source of truth.
- Ship bar: {spec.get("shipBar", "vertical-slice")} (NEON INK quality target for skill FPS). **Why:** local Grok must match pair-built games.
- Craft modules: src/craft (palette, juice TimeJuice, audio sfx). **Why:** zero-asset juice stack.
""",
    )
    put(
        "DESIGN.md",
        f"""# {name}

## Genre
{genre}

## Core loop
{spec["verb"]}

## Place
{spec["setting"]} ({spec["props"]})

## Prompt
{spec["prompt"]}

## Target
Web / Desktop browser first. Mobile polish optional.

## Backlog
- [x] Vertical slice fun for 60s
- [ ] Juice pass
- [ ] Audio variety
""",
    )
    put(
        "README.md",
        f"""# {name}

{spec["verb"]}

Genre: **{genre}** · Slice by **Gamemaster**

```bash
npm install
npm run dev
```
""",
    )
    gi = dest / ".gitignore"
    if not gi.exists():
        put(".gitignore", GAME_GITIGNORE)

    from gmcommon import meta_dir

    meta = meta_dir(dest)
    meta.mkdir(parents=True, exist_ok=True)
    (meta / "slice.json").write_text(json.dumps(spec, indent=2) + "\n", encoding="utf-8")
    return written


def ask_system(project: Path | None, user_text: str) -> str:
    """Grok identity + slim context — prefill is the main local latency cost."""
    import identity as identitylib

    craft = identitylib.system_for("ask", extra_packs=True)
    wiki = ""
    spec_txt = ""
    if project:
        wp = project / "WIKI.md"
        if wp.is_file():
            wiki = wp.read_text(encoding="utf-8")[:900]
        from gmcommon import meta_dir

        sp = meta_dir(project) / "slice.json"
        if not sp.is_file():
            sp = project / ".gamemaster" / "slice.json"
        if sp.is_file():
            spec_txt = sp.read_text(encoding="utf-8")[:900]
    packs = ""
    try:
        import turbo

        packs = turbo.select_knowledge(user_text, max_chars=1400)
    except Exception:
        packs = ""
    return (
        f"{craft}\n\n"
        f"PLAYER: {user_text}\n\n"
        f"SLICE:\n{spec_txt}\n\n"
        f"WIKI:\n{wiki}\n\n"
        f"{packs}\n"
    )


# Imported by tests via server re-export; keep ROOT referenced for sanity.
assert ROOT.is_dir()
