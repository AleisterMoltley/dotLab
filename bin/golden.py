#!/usr/bin/env python3
"""
Golden slice CI — regression bar for ship-rate + anti-slop.

Stages:
  1) verify P0 (structure, secrets, genre, silence/palette)
  2) optional Playwright boot screenshot + histogram slop hints
  3) curriculum flags (playtest hooks, craft present for shoot)

  gamemaster golden
  gamemaster golden --json
  gamemaster golden --screenshots   # requires playwright + chromium
"""
from __future__ import annotations

import argparse
import json
import sys
import tempfile
from pathlib import Path

from gmcommon import ROOT, free_tcp_port, run
import slice as slicelib
import verify

FIXTURES = ROOT / "tests" / "fixtures"
MANIFEST = FIXTURES / "golden" / "manifest.json"
SCREEN_DIR = ROOT / "config" / "golden-screens"


def _default_cases() -> list[dict]:
    return [
        {
            "id": "slice-pass",
            "path": str(FIXTURES / "slice-pass"),
            "min_score": 70,
            "require_p0": True,
            "expect_fail": False,
        },
        {
            "id": "slice-fail",
            "path": str(FIXTURES / "slice-fail"),
            "min_score": 0,
            "require_p0": False,
            "expect_fail": True,
        },
        {
            "id": "gen-fps",
            "prompt": "neon skill fps dash ads hitstop",
            "genre": "fps",
            "min_score": 75,
            "require_p0": True,
            "expect_fail": False,
            "ephemeral": True,
            "curriculum": ["craft", "playtest", "shoot_juice"],
        },
        {
            "id": "gen-platformer",
            "prompt": "tight platformer coyote jump dusk",
            "genre": "platformer",
            "min_score": 75,
            "require_p0": True,
            "expect_fail": False,
            "ephemeral": True,
            "curriculum": ["playtest", "coyote"],
        },
        {
            "id": "gen-arena",
            "prompt": "top down arena twin stick waves",
            "genre": "arena",
            "min_score": 75,
            "require_p0": True,
            "expect_fail": False,
            "ephemeral": True,
            "curriculum": ["craft", "playtest", "shoot_juice"],
        },
    ]


def load_cases() -> list[dict]:
    if MANIFEST.is_file():
        try:
            data = json.loads(MANIFEST.read_text(encoding="utf-8"))
            if isinstance(data, list) and data:
                return data
        except Exception:
            pass
    return _default_cases()


def curriculum_check(project: Path, flags: list[str]) -> dict:
    js = ""
    for rel in ("src/game.js", "src/main.js"):
        p = project / rel
        if p.is_file():
            js += p.read_text(encoding="utf-8", errors="ignore")
    failed = []
    for f in flags or []:
        if f == "craft" and not (project / "src" / "craft").is_dir():
            failed.append("craft missing")
        if f == "playtest" and "__GF_PLAYTEST__" not in js:
            failed.append("playtest hooks missing")
        if f == "shoot_juice" and not (
            "TimeJuice" in js or "hitstop" in js or "sfx" in js
        ):
            failed.append("shoot juice missing")
        if f == "coyote" and "coyote" not in js.lower():
            failed.append("coyote missing")
    return {"ok": not failed, "failed": failed}


def try_playwright_frame(project: Path, case_id: str, timeout_s: float = 25.0) -> dict:
    """Boot vite + capture one screenshot if playwright is installed."""
    try:
        from playwright.sync_api import sync_playwright  # type: ignore
    except Exception:
        return {"ok": True, "skipped": True, "reason": "playwright not installed"}

    port = free_tcp_port(5190, 40)
    # ensure deps optional — skip if no node_modules and no npm
    if not (project / "node_modules").is_dir():
        code, _ = run(["npm", "install", "--no-fund", "--no-audit"], cwd=project, timeout=180)
        if code != 0:
            return {"ok": True, "skipped": True, "reason": "npm install failed"}

    import subprocess
    import time
    import urllib.request

    log = project / ".dotlab" / "golden-play.log"
    log.parent.mkdir(parents=True, exist_ok=True)
    proc = subprocess.Popen(
        ["npx", "vite", "--host", "127.0.0.1", "--port", str(port), "--strictPort"],
        cwd=str(project),
        stdout=open(log, "w"),
        stderr=subprocess.STDOUT,
        start_new_session=True,
    )
    url = f"http://127.0.0.1:{port}/"
    try:
        deadline = time.time() + timeout_s
        up = False
        while time.time() < deadline:
            if proc.poll() is not None:
                return {"ok": False, "error": "vite exited early", "log": str(log)}
            try:
                urllib.request.urlopen(url, timeout=0.5)
                up = True
                break
            except Exception:
                time.sleep(0.35)
        if not up:
            return {"ok": False, "error": "vite not ready", "skipped": False}

        SCREEN_DIR.mkdir(parents=True, exist_ok=True)
        out_png = SCREEN_DIR / f"{case_id}.png"
        with sync_playwright() as p:
            browser = p.chromium.launch(headless=True)
            page = browser.new_page(viewport={"width": 960, "height": 540})
            page.goto(url, wait_until="networkidle", timeout=20000)
            page.wait_for_timeout(800)
            page.screenshot(path=str(out_png))
            browser.close()
        hint = {}
        try:
            import antislope as aslib

            hint = aslib.screenshot_slop_hint(out_png)
        except Exception as e:
            hint = {"ok": False, "error": str(e)}
        slop = bool(hint.get("slop_risk"))
        return {
            "ok": not slop,
            "screenshot": str(out_png),
            "hint": hint,
            "slop_risk": slop,
        }
    finally:
        try:
            proc.terminate()
            proc.wait(timeout=3)
        except Exception:
            try:
                proc.kill()
            except Exception:
                pass


def run_case(case: dict, *, screenshots: bool = False) -> dict:
    cid = case.get("id") or "case"
    expect_fail = bool(case.get("expect_fail"))
    min_score = int(case.get("min_score") or 0)
    require_p0 = case.get("require_p0", True)
    tmp = None
    try:
        if case.get("ephemeral") or case.get("prompt"):
            tmp = tempfile.TemporaryDirectory(prefix="dotlab-golden-")
            dest = Path(tmp.name) / cid
            spec = slicelib.compile_prompt(
                str(case.get("prompt") or cid), genre=case.get("genre")
            )
            slicelib.write_slice(dest, spec)
            project = dest
        else:
            project = Path(case["path"]).expanduser().resolve()
            if not project.is_dir():
                return {"id": cid, "ok": False, "error": f"missing path {project}"}

        result = verify.evaluate(project)
        p0_ok = not result.get("p0_fail")
        score = int(result.get("score") or 0)
        cur = curriculum_check(project, list(case.get("curriculum") or []))
        screen = {"skipped": True}
        if screenshots and not expect_fail and case.get("ephemeral"):
            screen = try_playwright_frame(project, cid)

        if expect_fail:
            ok = (not p0_ok) or score < 50
        else:
            ok = (p0_ok if require_p0 else True) and score >= min_score and cur.get("ok", True)
            if screenshots and not screen.get("skipped") and screen.get("ok") is False:
                ok = False

        return {
            "id": cid,
            "ok": ok,
            "score": score,
            "p0_fail": result.get("p0_fail") or [],
            "curriculum": cur,
            "screenshot": screen,
            "expect_fail": expect_fail,
            "min_score": min_score,
            "report": (result.get("report") or "")[:800],
        }
    except Exception as e:
        return {"id": cid, "ok": False, "error": str(e)}
    finally:
        if tmp is not None:
            tmp.cleanup()


def run_all(*, screenshots: bool = False) -> dict:
    cases = load_cases()
    rows = [run_case(c, screenshots=screenshots) for c in cases]
    passed = sum(1 for r in rows if r.get("ok"))
    return {
        "ok": passed == len(rows),
        "passed": passed,
        "total": len(rows),
        "screenshots": screenshots,
        "cases": rows,
    }


def main() -> int:
    ap = argparse.ArgumentParser(description="Golden slice CI")
    ap.add_argument("--json", action="store_true")
    ap.add_argument(
        "--screenshots",
        action="store_true",
        help="Playwright boot frames + histogram slop hints (optional)",
    )
    args = ap.parse_args()
    report = run_all(screenshots=bool(args.screenshots))
    if args.json:
        print(json.dumps(report, indent=2))
    else:
        print(
            f"GOLDEN {report['passed']}/{report['total']} "
            + ("OK" if report["ok"] else "FAIL")
            + (" · screenshots" if args.screenshots else "")
        )
        for c in report["cases"]:
            mark = "✓" if c.get("ok") else "✗"
            extra = c.get("error") or f"score={c.get('score')} p0={c.get('p0_fail')}"
            if c.get("curriculum") and not c["curriculum"].get("ok"):
                extra += f" curriculum={c['curriculum'].get('failed')}"
            print(f"  {mark} {c.get('id')}: {extra}")
    return 0 if report["ok"] else 1


if __name__ == "__main__":
    raise SystemExit(main())
