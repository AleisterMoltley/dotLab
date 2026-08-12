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


def infer_kind(prompt: str) -> str:
    p = (prompt or "").lower()
    if re.search(r"pixel|sprite|tileset|bakeCanvas|pixelart", p):
        return "pixel-game"
    if re.search(r"open.?world|whole world|heightfield|biome|worldclaw", p):
        return "world-game"
    if re.search(r"shader|shadertoy|raymarch", p):
        return "shader-lab"
    return "web-game"


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


def compile_prompt(prompt: str, genre: str | None = None) -> dict:
    text = (prompt or "").strip() or "small adventure"
    g = genre if genre in GENRES else infer_genre(text)
    setting, props = _setting(text)
    seed = int(hashlib.md5(text.encode("utf-8")).hexdigest()[:8], 16)
    feel = dict(_FEEL_DEFAULT)
    feel.update(_FEEL.get(g, {}))
    feel.setdefault("runSpeed", 8.4)
    feel.setdefault("hitstopMs", 40)
    feel.setdefault("mouseSens", 0.0022)
    feel.setdefault("pitchMin", -1.15)
    feel.setdefault("pitchMax", 1.25)
    loop = _LOOP.get(g, "talk")
    spec = {
        "prompt": text,
        "title": _title(text),
        "slug": slugify_project(text[:48]),
        "genre": g,
        "setting": setting,
        "props": props,
        "loop": loop,
        "camera": _CAMERA.get(g, "tps"),
        "verb": _verb(g, setting),
        "palette": dict(_PALETTES.get(props, _PALETTES["dusk"])),
        "feel": feel,
        "seed": seed,
        "kind": infer_kind(text),
        "enemyCount": 8 if loop == "shoot" else (1 if loop == "sneak" else 0),
        "coinCount": 6 if loop in ("jump", "talk", "collect") else 0,
        "hazardCount": 8 if loop == "run" else 0,
        "density": 1.0,
        "juice": 1.0,
        "shipBar": "neon-ink" if loop == "shoot" or g in ("fps", "arena") else "vertical-slice",
    }
    return spec


def summarize(spec: dict) -> str:
    cam = {
        "fps": "Click the game to look. WASD move, mouse look, click fire, Space jump, R restart.",
        "side": "A/D move, Space jump, R restart.",
        "top": "WASD move, click fire, R restart.",
        "chase": "WASD move, Space jump, R restart.",
        "tps": "WASD move, Space jump, E talk when close, R restart.",
    }.get(spec.get("camera") or "tps", "WASD move, R restart.")
    return (
        f"The fun is: {spec['verb']}.\n"
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
    """Write fenced files only if the project still passes P0 verify."""
    files = extract_code_files(text)
    if not files:
        return {"written": [], "rejected": True, "reason": "no files"}
    backups: dict[str, str | None] = {}
    written: list[str] = []
    for rel, body in files:
        dest = project / rel
        try:
            dest.resolve().relative_to(project.resolve())
        except ValueError:
            continue
        backups[rel] = dest.read_text(encoding="utf-8") if dest.is_file() else None
        dest.parent.mkdir(parents=True, exist_ok=True)
        dest.write_text(body, encoding="utf-8")
        written.append(rel)
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
    return {"written": written, "rejected": False, "reason": ""}


def _template() -> str:
    path = TEMPLATES / "web-slice" / "game.js"
    return path.read_text(encoding="utf-8")


def render_game_js(spec: dict) -> str:
    slim = {
        "title": spec["title"],
        "genre": spec["genre"],
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
    }
    feel = dict(spec.get("feel") or {})
    feel.setdefault("shakeHit", 0.12)
    feel.setdefault("hitstopMs", 40)
    src = _template()
    src = src.replace("__SPEC__", json.dumps(slim, ensure_ascii=False))
    src = src.replace("__CONFIG__", json.dumps(feel, ensure_ascii=False))
    return src


def write_web_slice(dest: Path, spec: dict) -> list[str]:
    """Write a themed Vite + Three.js slice. Does not touch node_modules."""
    dest.mkdir(parents=True, exist_ok=True)
    name = spec.get("title") or dest.name
    genre = spec["genre"]
    written: list[str] = []

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

    put("src/game.js", render_game_js(spec))
    hexes = " ".join(
        f"{k}=#{v:06x}" for k, v in pal.items() if k not in ("fogNear", "fogFar")
    )
    put(
        "WIKI.md",
        f"""# Wiki

Living facts for this game. One bullet + **Why:**. Loaded into every Studio/Agent turn.

- Engine is Three.js (Vite, vanilla). **Why:** Gamemaster invariant.
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

    meta = dest / ".gamemaster"
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
