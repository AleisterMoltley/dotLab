#!/usr/bin/env python3
"""
Brief eval harness — ship-rate per engine.

  gamemaster eval-briefs
  gamemaster eval-briefs --engine vintage
  gamemaster eval-briefs --json
  gamemaster eval-briefs --write-promptfoo
"""
from __future__ import annotations

import argparse
import json
import tempfile
from pathlib import Path

from gmcommon import ROOT
import slice as slicelib
import verify

BRIEFS = ROOT / "evals" / "briefs.json"
PROMPTFOO = ROOT / "evals" / "promptfoo.yaml"


def load_briefs() -> list[dict]:
    if not BRIEFS.is_file():
        return []
    return json.loads(BRIEFS.read_text(encoding="utf-8"))


def run_eval(engine: str | None = None) -> dict:
    briefs = load_briefs()
    # Expand: each brief runs on forced engine if set on brief OR CLI
    engines = [engine] if engine in ("three", "pixel", "vintage") else None
    rows = []
    for b in briefs:
        eng_list = engines or (
            [b["engine"]]
            if b.get("engine") in ("three", "pixel", "vintage")
            else [None]
        )
        for eng in eng_list:
            with tempfile.TemporaryDirectory(prefix="dotlab-eval-") as td:
                dest = Path(td) / str(b.get("id") or "b")
                if eng:
                    dest = Path(td) / f"{b.get('id')}-{eng}"
                spec = slicelib.compile_prompt(
                    str(b.get("brief") or ""),
                    genre=b.get("genre"),
                    engine=eng,
                    vintage_profile=b.get("vintage_profile"),
                )
                slicelib.write_slice(dest, spec)
                vr = verify.evaluate(dest)
                min_s = int(b.get("min_score") or 70)
                ok = (not vr.get("p0_fail")) and int(vr.get("score") or 0) >= min_s
                js = ""
                gp = dest / "src" / "game.js"
                if gp.is_file():
                    js = gp.read_text(encoding="utf-8", errors="ignore")
                if "0x22c55e" in js or (
                    "CapsuleGeometry" in js and "0x00ff00" in js
                ):
                    ok = False
                if eng == "vintage" and "WebGLRenderer" in js:
                    ok = False
                rows.append(
                    {
                        "id": b.get("id"),
                        "engine": spec.get("engine") or eng or "auto",
                        "ok": ok,
                        "score": vr.get("score"),
                        "p0_fail": vr.get("p0_fail"),
                        "min_score": min_s,
                        "genre": spec.get("genre"),
                        "play_skipped": True,
                    }
                )
    # Also run fixed multi-engine matrix (short list)
    matrix = [
        ("mx-three-fps", "neon skill fps dash", "fps", "three", None, 75),
        ("mx-pixel-plat", "pixel art platformer forest", "platformer", "pixel", None, 70),
        ("mx-vintage-gb", "game boy platformer tight jumps", "platformer", "vintage", "gb", 70),
        ("mx-vintage-gba", "gba side scroller short levels", "platformer", "vintage", "gba", 70),
    ]
    if not engine:
        for mid, brief, genre, eng, vprof, mins in matrix:
            with tempfile.TemporaryDirectory(prefix="dotlab-mx-") as td:
                dest = Path(td) / mid
                spec = slicelib.compile_prompt(
                    brief, genre=genre, engine=eng, vintage_profile=vprof
                )
                slicelib.write_slice(dest, spec)
                vr = verify.evaluate(dest)
                ok = (not vr.get("p0_fail")) and int(vr.get("score") or 0) >= mins
                rows.append(
                    {
                        "id": mid,
                        "engine": eng,
                        "ok": ok,
                        "score": vr.get("score"),
                        "p0_fail": vr.get("p0_fail"),
                        "min_score": mins,
                        "genre": genre,
                        "matrix": True,
                        "play_skipped": True,
                    }
                )

    passed = sum(1 for r in rows if r.get("ok"))
    by_eng: dict[str, dict] = {}
    for r in rows:
        e = str(r.get("engine") or "auto")
        by_eng.setdefault(e, {"passed": 0, "total": 0})
        by_eng[e]["total"] += 1
        if r.get("ok"):
            by_eng[e]["passed"] += 1
    for e, v in by_eng.items():
        v["ship_rate"] = (
            round(100 * v["passed"] / v["total"], 1) if v["total"] else 0
        )
    report = {
        "ok": passed == len(rows) and len(rows) > 0,
        "passed": passed,
        "total": len(rows),
        "ship_rate": round(100 * passed / len(rows), 1) if rows else 0,
        "by_engine": by_eng,
        "cases": rows,
        "play_note": "compile-only; pass --play to add Playwright P0 when installed",
    }
    try:
        from gmcommon import CONFIG

        CONFIG.mkdir(parents=True, exist_ok=True)
        (CONFIG / "eval-latest.json").write_text(json.dumps(report, indent=2) + "\n", encoding="utf-8")
    except Exception:
        pass
    return report


def write_promptfoo_yaml() -> Path:
    briefs = load_briefs()
    tests = []
    for b in briefs:
        tests.append(
            {
                "vars": {
                    "brief": b.get("brief"),
                    "genre": b.get("genre") or "",
                    "engine": b.get("engine") or "",
                },
                "assert": [{"type": "javascript", "value": "output.length > 20"}],
            }
        )
    lines = [
        "# Generated by gamemaster eval-briefs --write-promptfoo",
        "# Host scoring: gamemaster eval-briefs [--engine three|pixel|vintage]",
        "description: dotLab host slice ship-rate by engine",
        "prompts:",
        '  - "Create a playable vertical slice (engine={{engine}}): {{brief}}"',
        "providers:",
        "  - id: echo",
        "    config:",
        '      text: "host-slice"',
        "tests:",
    ]
    for b in briefs:
        lines.append("  - vars:")
        lines.append(f"      brief: {json.dumps(b.get('brief'))}")
        lines.append(f"      genre: {json.dumps(b.get('genre') or '')}")
        lines.append(f"      engine: {json.dumps(b.get('engine') or '')}")
        lines.append(f"      min_score: {int(b.get('min_score') or 70)}")
    PROMPTFOO.parent.mkdir(parents=True, exist_ok=True)
    PROMPTFOO.write_text("\n".join(lines) + "\n", encoding="utf-8")
    (PROMPTFOO.parent / "promptfoo.tests.json").write_text(
        json.dumps(tests, indent=2) + "\n", encoding="utf-8"
    )
    return PROMPTFOO


def main() -> int:
    ap = argparse.ArgumentParser(description="dotLab brief eval harness")
    ap.add_argument("--json", action="store_true")
    ap.add_argument("--write-promptfoo", action="store_true")
    ap.add_argument(
        "--engine",
        choices=["three", "pixel", "vintage"],
        default=None,
        help="Force all briefs onto this engine",
    )
    args = ap.parse_args()
    if args.write_promptfoo:
        p = write_promptfoo_yaml()
        print(f"wrote {p}")
    report = run_eval(engine=args.engine)
    if args.json:
        print(json.dumps(report, indent=2))
    else:
        print(
            f"EVAL {report['passed']}/{report['total']} "
            f"ship_rate={report['ship_rate']}% "
            + ("OK" if report["ok"] else "FAIL")
        )
        if report.get("by_engine"):
            for e, v in sorted(report["by_engine"].items()):
                print(
                    f"  engine {e}: {v['passed']}/{v['total']} "
                    f"({v['ship_rate']}%)"
                )
        for c in report["cases"]:
            mark = "✓" if c.get("ok") else "✗"
            print(
                f"  {mark} {c.get('id')} [{c.get('engine')}]: "
                f"score={c.get('score')} p0={c.get('p0_fail')}"
            )
    return 0 if report["ok"] else 1


if __name__ == "__main__":
    raise SystemExit(main())
