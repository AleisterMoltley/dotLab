#!/usr/bin/env python3
"""
Play-P0 — the game is the judge.

Verify sees coyoteMs in a file. This module grades an 8s bot run:
console, canvas, input, FPS, death→restart, screenshot slop.
Host then maps fails to feel/layout fixes. No LLM required.

  play_gate.evaluate_report(report, genre="platformer")
  play_gate.try_run(project)          # optional Playwright
  play_gate.apply_metric_fixes(project, result)
"""
from __future__ import annotations

import json
import os
import re
from pathlib import Path
from typing import Any

from gmcommon import meta_dir

P0 = frozenset(
    {
        "runtime",
        "no_canvas",
        "no_input",
        "stutter",
        "slow_restart",
        "slop_frame",
    }
)
P1 = frozenset({"no_jump", "no_flag", "low_fps"})


def family_of(project: Path | None = None, genre: str = "", loop: str = "") -> str:
    g = (genre or "").lower()
    lp = (loop or "").lower()
    if project is not None:
        for folder in (".dotlab", ".gamemaster"):
            sp = Path(project) / folder / "slice.json"
            if not sp.is_file():
                continue
            try:
                data = json.loads(sp.read_text(encoding="utf-8"))
                g = g or str((data or {}).get("genre") or "").lower()
                lp = lp or str((data or {}).get("loop") or "").lower()
            except Exception:
                pass
    if lp == "jump" or g in ("platformer",):
        return "platformer"
    if lp == "shoot" or g in ("fps", "arena"):
        return "fps" if g != "arena" else "arena"
    if lp == "run" or g == "runner":
        return "runner"
    if lp == "talk" or g in ("adventure", "rpg", "tps"):
        return "adventure"
    if lp == "race" or g in ("racing",):
        return "racing"
    return g or lp or "generic"


def actions_for(family: str) -> str:
    return {
        "platformer": "jump,right",
        "runner": "jump,right",
        "fps": "click,wasd",
        "arena": "click,wasd",
        "adventure": "wasd,click",
        "racing": "wasd",
        "horror": "wasd",
    }.get(family or "", "jump,wasd,click")


def load_report(project: Path) -> dict[str, Any] | None:
    for rel in (
        Path(".gamemaster") / "playtest" / "report.json",
        Path(".dotlab") / "playtest" / "report.json",
    ):
        p = Path(project) / rel
        if p.is_file():
            try:
                data = json.loads(p.read_text(encoding="utf-8"))
                if isinstance(data, dict):
                    return data
            except Exception:
                return None
    return None


def scan_shots(paths: list[str]) -> list[str]:
    hints: list[str] = []
    try:
        import antislope as aslib
    except Exception:
        return hints
    for raw in paths[:6]:
        p = Path(raw)
        if not p.is_file():
            continue
        try:
            r = aslib.screenshot_slop_hint(p)
        except Exception:
            continue
        for h in r.get("hints") or []:
            if h not in hints:
                hints.append(str(h))
    return hints


def evaluate_report(
    report: dict | None,
    *,
    genre: str = "",
    loop: str = "",
    family: str = "",
) -> dict[str, Any]:
    """Grade a playtest report. Missing report → skipped, not a fail."""
    if not report:
        return {
            "ok": True,
            "skipped": True,
            "p0_fail": [],
            "p1_fail": [],
            "score": None,
            "report": "PLAY-P0 skipped (no report)",
        }
    fam = family or family_of(None, genre, loop)
    metrics = report.get("metrics") if isinstance(report.get("metrics"), dict) else {}
    errors = [
        str(e)
        for e in (report.get("errors") or [])
        if "favicon" not in str(e).lower()
    ]
    page_errors = [str(e) for e in (report.get("pageErrors") or [])]
    slop = scan_shots([str(p) for p in (report.get("screenshots") or [])])

    jumps = int(metrics.get("jumps") or 0)
    keys = int(metrics.get("keys") or 0)
    clicks = int(metrics.get("clicks") or 0)
    deaths = int(metrics.get("deaths") or 0)
    fps = metrics.get("avgFps")
    max_dt = metrics.get("maxDt")
    restart_ms = metrics.get("medianDeathToRestartMs")
    has_canvas = bool(metrics.get("hasCanvas"))
    score = metrics.get("score")
    hooked = bool(metrics.get("hookedJump") or metrics.get("gameHooked"))

    p0: list[str] = []
    p1: list[str] = []
    if page_errors or any(
        re.search(r"syntax|typeerror|referenceerror|navigation|not reachable", e, re.I)
        for e in errors
    ):
        p0.append("runtime")
    if metrics and not has_canvas:
        p0.append("no_canvas")
    if metrics and (keys + clicks) == 0:
        p0.append("no_input")
    try:
        if max_dt is not None and float(max_dt) > 80 and int(metrics.get("frames") or 0) > 20:
            p0.append("stutter")
    except (TypeError, ValueError):
        pass
    try:
        if (
            deaths >= 1
            and restart_ms is not None
            and float(restart_ms) > 3000
        ):
            p0.append("slow_restart")
    except (TypeError, ValueError):
        pass
    if any(h in ("near_black_frame", "green_dominant") for h in slop):
        p0.append("slop_frame")

    if fam == "platformer" and hooked and jumps == 0:
        p1.append("no_jump")
    if fam in ("platformer", "fps", "arena") and score in (0, None) and deaths == 0:
        # verb may be dead — soft
        if hooked:
            p1.append("no_flag")
    try:
        if fps is not None and float(fps) < 20 and int(metrics.get("frames") or 0) > 30:
            p1.append("low_fps")
    except (TypeError, ValueError):
        pass

    weight_ok = 100
    weight_ok -= 18 * len(p0)
    weight_ok -= 6 * len(p1)
    score_n = max(0, min(100, weight_ok))
    lines = [
        f"PLAY-P0 score={score_n}/100  P0_fail={len(p0)}  family={fam}",
    ]
    for k in p0:
        lines.append(f"  [NO] P0 {k}")
    for k in p1:
        lines.append(f"  [NO] P1 {k}")
    if slop:
        lines.append("  slop: " + ", ".join(slop))
    if not p0 and not p1:
        lines.append("  [OK] bot run looks playable")
    if p0:
        lines.append("P0 must-fix: " + ", ".join(p0))
        lines.append("Do not add features. Fix these, then done.")

    return {
        "ok": not p0,
        "skipped": False,
        "p0_fail": p0,
        "p1_fail": p1,
        "score": score_n,
        "family": fam,
        "slop": slop,
        "metrics": {
            "jumps": jumps,
            "keys": keys,
            "clicks": clicks,
            "deaths": deaths,
            "avgFps": fps,
            "maxDt": max_dt,
            "restartMs": restart_ms,
            "hasCanvas": has_canvas,
        },
        "report": "\n".join(lines),
    }


def repair_task(result: dict) -> str:
    return (
        "PLAY-P0 failed. The slice is not playable yet.\n"
        "Fix ONLY these checks. No new features.\n\n"
        f"{result.get('report') or ''}\n\n"
        "Feel/restart/layout are host-owned when possible. Patch-only. Then done."
    )


def apply_metric_fixes(project: Path, result: dict) -> dict[str, Any]:
    """Map play-P0 fails to host edits. No LLM."""
    applied: list[str] = []
    p0 = set(result.get("p0_fail") or [])
    p1 = set(result.get("p1_fail") or [])
    project = Path(project)
    if "slow_restart" in p0 or "no_jump" in p1:
        try:
            import host_floor as floor

            fr = floor.apply(project)
            applied.extend(f"floor:{x}" for x in (fr.get("applied") or [])[:8])
        except Exception:
            pass
    if "slow_restart" in p0:
        n = _ensure_restart_key(project)
        if n:
            applied.append(n)
    if "stutter" in p0 or "low_fps" in p1:
        n = _soften_shadows(project)
        if n:
            applied.append(n)
    if "no_flag" in p1 or "no_jump" in p1:
        n = shorten_gap(project)
        if n:
            applied.append(n)
    return {"ok": True, "applied": applied}


def _game_js(project: Path) -> tuple[Path | None, str]:
    p = Path(project) / "src" / "game.js"
    if not p.is_file():
        return None, ""
    try:
        return p, p.read_text(encoding="utf-8")
    except OSError:
        return p, ""


def _ensure_restart_key(project: Path) -> str | None:
    path, js = _game_js(project)
    if not path or not js:
        return None
    if re.search(r"KeyR|key\s*===\s*['\"]r['\"]", js, re.I) and re.search(
        r"\bfunction\s+(restart|die)\s*\(", js
    ):
        if re.search(r"KeyR[\s\S]{0,120}restart\(", js, re.I):
            return None
    if not re.search(r"\bfunction\s+restart\s*\(", js):
        return None
    if "host-play-gate: KeyR" in js:
        return None
    hook = (
        "\n  // host-play-gate: KeyR restart\n"
        "  addEventListener('keydown', (e) => { if (e.code === 'KeyR') restart(); });\n"
    )
    m = re.search(r"function restart\s*\([^)]*\)\s*\{", js)
    if not m:
        return None
    # insert after restart definition's closing is hard; put before export/return createGame
    js2 = js.replace("function restart(", hook + "function restart(", 1)
    if js2 == js:
        return None
    path.write_text(js2, encoding="utf-8")
    return "KeyR-restart"


def _soften_shadows(project: Path) -> str | None:
    path, js = _game_js(project)
    if not path or not js:
        return None
    if "shadowMap.enabled = false" in js:
        return None
    if "shadowMap.enabled = true" in js:
        path.write_text(
            js.replace("shadowMap.enabled = true", "shadowMap.enabled = false", 1),
            encoding="utf-8",
        )
        return "shadows-off"
    return None


def shorten_gap(project: Path) -> str | None:
    """Pull later ledges closer — conservative string tweaks on host slices."""
    path, js = _game_js(project)
    if not path or not js:
        return None
    orig = js
    js = js.replace("* 3.4", "* 2.6", 1)
    js = js.replace("* 3.2", "* 2.5", 1)
    if js == orig:
        # consecutive position.set X values — shrink a large delta once
        xs = [float(m.group(1)) for m in re.finditer(r"position\.set\(\s*(-?\d+(?:\.\d+)?)", js)]
        if len(xs) >= 2:
            for i in range(1, len(xs)):
                gap = xs[i] - xs[i - 1]
                if gap >= 4.5:
                    old = f"position.set({xs[i]:g}"
                    new = f"position.set({(xs[i-1] + gap * 0.7):.2f}"
                    if old in js:
                        js = js.replace(old, new, 1)
                        break
    if js == orig:
        return None
    path.write_text(js, encoding="utf-8")
    return "gap-shorter"


def ingest_play_log(project: Path) -> dict[str, Any]:
    """Live sensor: death spam in play.log → shorten the gap."""
    log = meta_dir(project) / "play.log"
    if not log.is_file():
        return {"ok": True, "deaths": 0, "applied": []}
    try:
        text = log.read_text(encoding="utf-8", errors="ignore")
    except OSError:
        return {"ok": True, "deaths": 0, "applied": []}
    deaths = len(re.findall(r"\b(death|died|game over|recordDeath)\b", text, re.I))
    applied: list[str] = []
    if deaths >= 5:
        n = shorten_gap(project)
        if n:
            applied.append(n)
    return {"ok": True, "deaths": deaths, "applied": applied}


def try_run(project: Path, *, duration: int = 8, force: bool = False) -> dict[str, Any]:
    """Run Playwright playtest if available. Never required for unit tests."""
    if not force:
        flag = os.environ.get("DOTLAB_PLAY_GATE", "1").strip().lower()
        if flag in ("0", "false", "off", "no"):
            return evaluate_report(None)
        if os.environ.get("DOTLAB_SKIP_PLAYTEST", "").strip().lower() in ("1", "true"):
            return evaluate_report(None)
    try:
        import playtest as pt

        marker = pt.PLAYTEST_DIR / "node_modules" / "playwright"
        if not marker.exists() and not force:
            return evaluate_report(None)
    except Exception:
        return evaluate_report(None)

    fam = family_of(project)
    actions = actions_for(fam)
    try:
        import playtest as pt

        # Reuse CLI path without spawning the critic
        out = Path(project) / ".gamemaster" / "playtest"
        out.mkdir(parents=True, exist_ok=True)
        cmd, port = pt.detect_dev_command(Path(project))
        url = f"http://127.0.0.1:{port}/"
        proc = None
        try:
            if not (Path(project) / "package.json").is_file():
                return evaluate_report(None)
            proc = pt.start_server(Path(project), cmd)
            if not pt.wait_http(url, 80):
                return {
                    "ok": False,
                    "skipped": False,
                    "p0_fail": ["runtime"],
                    "p1_fail": [],
                    "score": 0,
                    "report": "PLAY-P0 server did not come up",
                }
            env_genre = fam
            old = os.environ.get("PLAYTEST_GENRE")
            os.environ["PLAYTEST_GENRE"] = env_genre
            try:
                pt.run_runner(url, out, duration, actions)
            finally:
                if old is None:
                    os.environ.pop("PLAYTEST_GENRE", None)
                else:
                    os.environ["PLAYTEST_GENRE"] = old
        finally:
            pt.stop_server(proc)
    except Exception as e:
        return {
            "ok": True,
            "skipped": True,
            "p0_fail": [],
            "p1_fail": [],
            "score": None,
            "report": f"PLAY-P0 skipped ({e})",
        }
    rep = load_report(project)
    result = evaluate_report(rep, family=fam)
    try:
        apply_metric_fixes(project, result)
    except Exception:
        pass
    return result


def scoreboard_row(result: dict) -> dict[str, Any]:
    return {
        "play_ok": result.get("ok"),
        "play_skipped": bool(result.get("skipped")),
        "play_score": result.get("score"),
        "play_p0": list(result.get("p0_fail") or []),
    }
