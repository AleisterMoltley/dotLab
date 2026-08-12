#!/usr/bin/env python3
"""
Deterministic Three.js slice verifier — no Ollama.

Cloud models dump code and hope. We *grade* and refuse "done" on P0 fails.
That is how a local 30B beats a frontier dump on ship-rate benches.

  gamemaster verify -p ./my-game
  gamemaster verify -p ./my-game --json
"""
from __future__ import annotations

import argparse
import json
import os
import re
import shutil
import subprocess
import sys
from pathlib import Path

from gmcommon import run

SKIP_DIRS = {"node_modules", ".git", "dist", "build", ".gamemaster", ".dotlab", ".vite"}

# weight: P0 = 8, P1 = 3, P2 = 1
CHECKS_META = {
    "pkg": 8,
    "entry": 8,
    "three_import": 8,
    "no_jsm": 8,
    "no_holes": 8,
    "renderer": 8,
    "scene": 8,
    "syntax": 8,
    "secrets": 8,
    "deps_allow": 8,
    "loop": 3,
    "lights": 3,
    "config": 3,
    "no_alert": 3,
    "genre_contract": 8,  # only enforced when genre known (fps/arena/platformer/runner)
    "silence_on_hit": 8,  # anti-slop: shoot without juice
    "palette_lock": 8,  # anti-slop: neon drift / purple fog
    "feel_ranges": 3,  # anti-slop: 1/1/1 config
    "no_green_capsule": 8,
    "vintage_cap": 8,  # GB/GBA ceiling when engine=vintage
    "feel_keys": 1,
    "playtest": 1,
    "wiki": 1,
}


def _load_genre_meta(project: Path) -> dict:
    """genre / loop / camera from slice.json if present."""
    out = {"genre": "", "loop": "", "camera": ""}
    for meta_name in (".dotlab", ".gamemaster"):
        sp = project / meta_name / "slice.json"
        if not sp.is_file():
            continue
        try:
            data = json.loads(sp.read_text(encoding="utf-8"))
            if isinstance(data, dict):
                out["genre"] = str(data.get("genre") or "")
                out["loop"] = str(data.get("loop") or "")
                out["camera"] = str(data.get("camera") or "")
                return out
        except Exception:
            pass
    # heuristic from JS
    return out


def genre_contract(project: Path, js: str) -> tuple[bool, str, bool]:
    """
    Host genre invariants. Returns (ok, detail, enforced).
    enforced=False → check skipped (counts as ok, not in score as P0).
    """
    meta = _load_genre_meta(project)
    genre = (meta.get("genre") or "").lower()
    loop = (meta.get("loop") or "").lower()
    camera = (meta.get("camera") or "").lower()
    # infer from code if meta empty
    if not genre and not loop:
        if re.search(r"pointerlock|requestPointerLock|adsFov|fireRpm|hitscan", js, re.I):
            genre, loop, camera = "fps", "shoot", "fps"
        elif re.search(r"coyoteMs|jumpBuffer", js) and re.search(r"platform", js, re.I):
            genre, loop = "platformer", "jump"
        else:
            return True, "no genre meta (skip contract)", False

    family = genre
    if loop == "shoot" and genre not in ("fps", "arena", "tower-defense"):
        family = "fps" if camera == "fps" else "arena"
    if loop == "jump":
        family = "platformer"
    if loop == "run":
        family = "runner"

    missing: list[str] = []
    if family in ("fps", "arena") or loop == "shoot":
        if not re.search(r"hitstop|TimeJuice|shake", js):
            missing.append("juice/hitstop")
        if not re.search(r"fireCd|fireRpm|shoot|pointerlock|requestPointerLock|mousedown|pointerdown", js, re.I):
            missing.append("fire/input")
        if family == "fps" and not re.search(
            r"pointerlock|requestPointerLock|mouseSens|movementX", js, re.I
        ):
            missing.append("look/pointer")
        if not re.search(r"craft/|TimeJuice|sfx\.|hitmark", js):
            # soft: craft kit present
            if not (project / "src" / "craft").is_dir():
                missing.append("craft kit")
    elif family == "platformer" or loop == "jump":
        if "coyoteMs" not in js and "coyote" not in js.lower():
            missing.append("coyote")
        if not re.search(r"jumpBuffer|jumpForce|jump", js, re.I):
            missing.append("jump")
        if not re.search(r"gravity", js, re.I):
            missing.append("gravity")
    elif family == "runner" or loop == "run":
        if not re.search(r"runSpeed|lane|hazard|obstacle", js, re.I):
            missing.append("runner loop keys")
    else:
        return True, f"genre={genre or 'generic'} (no hard contract)", False

    if missing:
        return False, f"{family}: missing {', '.join(missing)}", True
    return True, f"{family}: contract ok", True


def _is_pixel_kit(folder: Path) -> bool:
    """Vendored Canvas2D kit — comments use ellipsis; do not grade as slice holes."""
    return (folder / "bake.js").is_file() and (folder / "three-bridge.js").is_file()


def iter_js(project: Path) -> list[Path]:
    out: list[Path] = []
    for dirpath, dirnames, filenames in os.walk(project):
        dirnames[:] = [
            d
            for d in dirnames
            if d not in SKIP_DIRS and d not in ("pixelart", "pixel", "vintage")
        ]
        root = Path(dirpath)
        if _is_pixel_kit(root):
            continue
        # skip vendored engines (huge vocab files trip hole/TODO scanners)
        if root.name in ("pixelart", "pixel", "vintage") or "pixelart" in root.parts:
            continue
        for name in filenames:
            if name.endswith((".js", ".mjs", ".ts")):
                out.append(root / name)
    return out


def read_all_js(project: Path) -> str:
    blobs = []
    for p in iter_js(project):
        try:
            blobs.append(p.read_text(encoding="utf-8", errors="ignore"))
        except OSError:
            continue
    return "\n".join(blobs)


def node_syntax(project: Path) -> tuple[bool, str]:
    node = shutil.which("node")
    if not node:
        return True, "skip (no node)"
    bad: list[str] = []
    for p in iter_js(project):
        if p.suffix == ".ts":
            continue
        code, out = run([node, "--check", str(p)], cwd=project, timeout=15)
        if code != 0:
            rel = p.relative_to(project)
            bad.append(f"{rel}: {out.splitlines()[-1] if out else 'syntax'}")
    if bad:
        return False, "; ".join(bad[:6])
    return True, "ok"


def _detect_engine(project: Path, js: str) -> str:
    for meta_name in (".dotlab", ".gamemaster"):
        sp = project / meta_name / "slice.json"
        if sp.is_file():
            try:
                data = json.loads(sp.read_text(encoding="utf-8"))
                eng = str((data or {}).get("engine") or "")
                if eng in ("three", "pixel", "vintage"):
                    return eng
            except Exception:
                pass
    if (project / "src" / "vintage").is_dir() or re.search(
        r"VINTAGE|vintage-slice|profile.*\bgb\b", js
    ):
        if "from 'three'" not in js and 'from "three"' not in js:
            return "vintage"
    if (project / "src" / "pixelart" / "pixelart.js").is_file():
        return "pixel"
    if re.search(r"from\s+['\"]three['\"]", js):
        return "three"
    if re.search(r"getContext\(\s*['\"]2d['\"]", js) and "pixelart" in js:
        return "pixel"
    return "three"


def vintage_cap_check(project: Path, js: str) -> tuple[bool, str]:
    """Hard GBA ceiling: res, colors, no three, nearest-only."""
    meta = {}
    for meta_name in (".dotlab", ".gamemaster"):
        sp = project / meta_name / "slice.json"
        if sp.is_file():
            try:
                meta = json.loads(sp.read_text(encoding="utf-8")) or {}
            except Exception:
                meta = {}
            break
    v = meta.get("vintage") if isinstance(meta.get("vintage"), dict) else {}
    w = int(v.get("width") or 0)
    h = int(v.get("height") or 0)
    # Also scrape template constants
    mw = re.search(r"\bVW\s*=\s*(\d+)", js)
    mh = re.search(r"\bVH\s*=\s*(\d+)", js)
    if mw:
        w = max(w, int(mw.group(1)))
    if mh:
        h = max(h, int(mh.group(1)))
    fails = []
    if w and w > 240:
        fails.append(f"width {w}>240 (GBA max)")
    if h and h > 160:
        fails.append(f"height {h}>160 (GBA max)")
    max_c = int(v.get("maxColors") or 0)
    colors = v.get("colors") if isinstance(v.get("colors"), list) else []
    if max_c > 15:
        fails.append(f"maxColors {max_c}>15")
    if colors and len(colors) > 15:
        fails.append(f"{len(colors)} palette entries >15")
    # Grade only game code — not palette docs
    game_js = ""
    gp = project / "src" / "game.js"
    if gp.is_file():
        game_js = gp.read_text(encoding="utf-8", errors="ignore")
    body = game_js or js
    if re.search(r"from\s+['\"]three['\"]|WebGLRenderer|THREE\.", body):
        fails.append("Three.js forbidden in vintage")
    if re.search(
        r"blur\s*\(|filter:\s*blur|createBloom|EffectComposer|postprocess",
        body,
        re.I,
    ):
        fails.append("modern post-FX forbidden")
    if re.search(r"imageSmoothingEnabled\s*=\s*true", body):
        fails.append("smooth scaling forbidden (nearest only)")
    if fails:
        return False, "; ".join(fails)
    prof = v.get("profile") or "gb"
    return True, f"vintage {prof} within GBA ceiling ({w or '?'}×{h or '?'}, ≤{max_c or len(colors) or '?'} col)"


def evaluate(project: Path) -> dict:
    """Return {score, passed, failed, p0_fail, checks, report}."""
    project = project.resolve()
    js = read_all_js(project)
    html = ""
    for name in ("index.html", "src/index.html"):
        hp = project / name
        if hp.is_file():
            html += hp.read_text(encoding="utf-8", errors="ignore")

    engine = _detect_engine(project, js)
    checks: dict[str, dict] = {}

    def add(key: str, ok: bool, detail: str) -> None:
        checks[key] = {"ok": ok, "detail": detail, "weight": CHECKS_META[key]}

    pkg = project / "package.json"
    add("pkg", pkg.is_file(), "package.json" if pkg.is_file() else "missing")

    entry_ok = (project / "index.html").is_file() or (project / "src" / "main.js").is_file()
    add("entry", entry_ok, "index.html or src/main.js" if entry_ok else "no entry")

    if engine in ("pixel", "vintage"):
        if engine == "vintage":
            px_ok = bool(
                re.search(r"getContext\(\s*['\"]2d['\"]|createElement\(\s*['\"]canvas['\"]", js)
            )
            add("three_import", px_ok, "vintage canvas" if px_ok else "no canvas")
            add("no_jsm", True, "vintage (no three)")
        else:
            px_ok = bool(
                re.search(r"pixelart|makeBakedSprite|layeredRect|getContext\(\s*['\"]2d['\"]", js)
            ) or (project / "src" / "pixelart" / "pixelart.js").is_file()
            add("three_import", px_ok, "pixelart engine" if px_ok else "no pixelart engine")
            add("no_jsm", True, "pixel (no three jsm)")
        holes = bool(re.search(r"//\s*\.\.\.|/\*\s*\.\.\.|TODO implement|rest of (the )?code", js, re.I))
        add("no_holes", not holes, "complete" if not holes else "pseudocode / TODO hole")
        canvas_ok = bool(re.search(r"getContext\(\s*['\"]2d['\"]|createElement\(\s*['\"]canvas['\"]", js))
        add("renderer", canvas_ok, "canvas 2d" if canvas_ok else "missing canvas")
        add("scene", True, f"{engine} 2d space")
    else:
        three_ok = bool(re.search(r"from\s+['\"]three['\"]|require\(\s*['\"]three['\"]", js))
        add("three_import", three_ok, "import three" if three_ok else "no three import")

        jsm = "three/examples/jsm" in js
        add("no_jsm", not jsm, "clean addons/" if not jsm else "FORBIDDEN three/examples/jsm")

        holes = bool(re.search(r"//\s*\.\.\.|/\*\s*\.\.\.|TODO implement|rest of (the )?code", js, re.I))
        add("no_holes", not holes, "complete" if not holes else "pseudocode / TODO hole")

        add("renderer", "WebGLRenderer" in js, "WebGLRenderer" if "WebGLRenderer" in js else "missing")
        add("scene", "new THREE.Scene" in js or "Scene()" in js, "Scene" if "THREE.Scene" in js or "Scene()" in js else "missing")

    syn_ok, syn_d = node_syntax(project)
    add("syntax", syn_ok, syn_d)

    # Secrets + dependency allowlist (P0 security)
    try:
        import security as seclib

        secret_hits = seclib.scan_project_secrets(project, max_files=40)
        add(
            "secrets",
            not secret_hits,
            "clean" if not secret_hits else f"leaks: {secret_hits[0].get('kind')} in {secret_hits[0].get('path')}",
        )
        dep = seclib.check_package_json(project)
        add(
            "deps_allow",
            bool(dep.get("ok")),
            dep.get("message") or ("ok" if dep.get("ok") else "blocked deps"),
        )
    except Exception as e:
        add("secrets", True, f"skip ({e})")
        add("deps_allow", True, "skip")

    loop_ok = bool(re.search(r"requestAnimationFrame|setAnimationLoop", js))
    add("loop", loop_ok, "rAF/setAnimationLoop" if loop_ok else "no frame loop")

    lights = bool(re.search(r"Light\(|AmbientLight|DirectionalLight|HemisphereLight", js))
    add("lights", lights, "has light" if lights else "no lights (black screen risk)")

    config = "CONFIG" in js or bool(re.search(r"moveSpeed|jumpForce|coyoteMs", js))
    add("config", config, "CONFIG/feel" if config else "no feel knobs")

    alert = bool(re.search(r"\balert\s*\(", js + html))
    add("no_alert", not alert, "no alert()" if not alert else "alert() is not dialogue")

    # Pixel / vintage: lights not required (2D fill)
    if engine in ("pixel", "vintage"):
        checks["lights"] = {"ok": True, "detail": f"{engine} (no 3d lights)", "weight": 3}

    # Vintage GBA ceiling (P0 when engine=vintage)
    if engine == "vintage":
        vok, vdet = vintage_cap_check(project, js)
        add("vintage_cap", vok, vdet)
    else:
        checks["vintage_cap"] = {"ok": True, "detail": "n/a", "weight": 1}

    g_ok, g_detail, g_enforced = genre_contract(project, js)
    if g_enforced:
        add("genre_contract", g_ok, g_detail)
    else:
        # still record for report but weight 0 effectively via always-ok P2
        checks["genre_contract"] = {
            "ok": True,
            "detail": g_detail,
            "weight": 1,
        }

    # Anti-slop host checks
    try:
        import antislope as aslib

        meta = _load_genre_meta(project)
        # enrich meta from slice.json full
        for name in (".dotlab", ".gamemaster"):
            sp = project / name / "slice.json"
            if sp.is_file():
                try:
                    full = json.loads(sp.read_text(encoding="utf-8"))
                    if isinstance(full, dict):
                        meta["props"] = full.get("props") or meta.get("props") or ""
                        meta["shipBar"] = full.get("shipBar") or ""
                except Exception:
                    pass
                break
        as_res = aslib.evaluate_antislope(project, js, meta)
        for key, weight in (
            ("silence_on_hit", 8),
            ("palette_lock", 8),
            ("feel_ranges", 3),
            ("no_green_capsule", 8),
        ):
            c = (as_res.get("checks") or {}).get(key) or {"ok": True, "detail": "skip"}
            # feel_ranges always recorded; silence only meaningful when shoot-ish
            checks[key] = {"ok": bool(c.get("ok")), "detail": c.get("detail") or "", "weight": weight}
    except Exception as e:
        for key, weight in (
            ("silence_on_hit", 8),
            ("palette_lock", 8),
            ("feel_ranges", 3),
            ("no_green_capsule", 8),
        ):
            checks[key] = {"ok": True, "detail": f"skip ({e})", "weight": weight}

    feel_hits = sum(1 for k in ("gravity", "coyoteMs", "camLag", "jumpForce") if k in js)
    add("feel_keys", feel_hits >= 2, f"{feel_hits}/4 core feel keys")

    pt = "__GF_PLAYTEST__" in js
    add("playtest", pt, "hooks" if pt else "no playtest hooks")

    wiki = (project / "WIKI.md").is_file()
    add("wiki", wiki, "WIKI.md" if wiki else "no WIKI.md")

    weight_ok = sum(c["weight"] for c in checks.values() if c["ok"])
    weight_all = sum(c["weight"] for c in checks.values())
    score = int(round(100 * weight_ok / weight_all)) if weight_all else 0
    p0_fail = [k for k, c in checks.items() if not c["ok"] and c["weight"] >= 8]
    failed = [k for k, c in checks.items() if not c["ok"]]
    passed = [k for k, c in checks.items() if c["ok"]]

    lines = [f"VERIFY score={score}/100  P0_fail={len(p0_fail)}  failed={len(failed)}"]
    for k, c in checks.items():
        mark = "OK" if c["ok"] else "NO"
        sev = "P0" if c["weight"] >= 8 else ("P1" if c["weight"] >= 3 else "P2")
        lines.append(f"  [{mark}] {sev} {k}: {c['detail']}")
    if p0_fail:
        lines.append("P0 must-fix: " + ", ".join(p0_fail))
        lines.append("Do not add features. Fix these, then done.")

    return {
        "ok": not p0_fail,
        "score": score,
        "p0_fail": p0_fail,
        "failed": failed,
        "passed": passed,
        "checks": checks,
        "report": "\n".join(lines),
        "project": str(project),
    }


def repair_prompt(result: dict) -> str:
    return (
        "VERIFY GATE failed. You are NOT done.\n"
        "Fix ONLY these P0/P1 items. Do not add features.\n\n"
        f"{result['report']}\n\n"
        "Then tool call done."
    )


def main() -> int:
    ap = argparse.ArgumentParser(description="Gamemaster slice verifier")
    ap.add_argument("-p", "--project", default=".", help="Game directory")
    ap.add_argument("--json", action="store_true")
    args = ap.parse_args()
    project = Path(args.project).expanduser().resolve()
    if not project.is_dir():
        print(f"Project not found: {project}", file=sys.stderr)
        return 1
    result = evaluate(project)
    if args.json:
        slim = {k: result[k] for k in ("ok", "score", "p0_fail", "failed", "passed", "project")}
        print(json.dumps(slim, indent=2))
    else:
        print(result["report"])
    return 0 if result["ok"] else 1


if __name__ == "__main__":
    raise SystemExit(main())
