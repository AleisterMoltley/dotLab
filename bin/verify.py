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
    "loop": 3,
    "lights": 3,
    "config": 3,
    "no_alert": 3,
    "feel_keys": 1,
    "playtest": 1,
    "wiki": 1,
}


def _is_pixel_kit(folder: Path) -> bool:
    """Vendored Canvas2D kit — comments use ellipsis; do not grade as slice holes."""
    return (folder / "bake.js").is_file() and (folder / "three-bridge.js").is_file()


def iter_js(project: Path) -> list[Path]:
    out: list[Path] = []
    for dirpath, dirnames, filenames in os.walk(project):
        dirnames[:] = [d for d in dirnames if d not in SKIP_DIRS]
        root = Path(dirpath)
        if _is_pixel_kit(root):
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


def evaluate(project: Path) -> dict:
    """Return {score, passed, failed, p0_fail, checks, report}."""
    project = project.resolve()
    js = read_all_js(project)
    html = ""
    for name in ("index.html", "src/index.html"):
        hp = project / name
        if hp.is_file():
            html += hp.read_text(encoding="utf-8", errors="ignore")

    checks: dict[str, dict] = {}

    def add(key: str, ok: bool, detail: str) -> None:
        checks[key] = {"ok": ok, "detail": detail, "weight": CHECKS_META[key]}

    pkg = project / "package.json"
    add("pkg", pkg.is_file(), "package.json" if pkg.is_file() else "missing")

    entry_ok = (project / "index.html").is_file() or (project / "src" / "main.js").is_file()
    add("entry", entry_ok, "index.html or src/main.js" if entry_ok else "no entry")

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

    loop_ok = bool(re.search(r"requestAnimationFrame|setAnimationLoop", js))
    add("loop", loop_ok, "rAF/setAnimationLoop" if loop_ok else "no frame loop")

    lights = bool(re.search(r"Light\(|AmbientLight|DirectionalLight|HemisphereLight", js))
    add("lights", lights, "has light" if lights else "no lights (black screen risk)")

    config = "CONFIG" in js or bool(re.search(r"moveSpeed|jumpForce|coyoteMs", js))
    add("config", config, "CONFIG/feel" if config else "no feel knobs")

    alert = bool(re.search(r"\balert\s*\(", js + html))
    add("no_alert", not alert, "no alert()" if not alert else "alert() is not dialogue")

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
