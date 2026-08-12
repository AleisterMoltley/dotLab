#!/usr/bin/env python3
"""
Golden slice CI — regression bar for ship-rate.

Runs verify (+ genre contracts + secrets + deps) against fixtures and optional
live projects listed in tests/fixtures/golden/manifest.json.

  gamemaster golden
  python3 bin/golden.py
  python3 bin/golden.py --json
"""
from __future__ import annotations

import argparse
import json
import sys
import tempfile
from pathlib import Path

from gmcommon import ROOT
import slice as slicelib
import verify

FIXTURES = ROOT / "tests" / "fixtures"
MANIFEST = FIXTURES / "golden" / "manifest.json"


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
        },
        {
            "id": "gen-platformer",
            "prompt": "tight platformer coyote jump dusk",
            "genre": "platformer",
            "min_score": 75,
            "require_p0": True,
            "expect_fail": False,
            "ephemeral": True,
        },
        {
            "id": "gen-arena",
            "prompt": "top down arena twin stick waves",
            "genre": "arena",
            "min_score": 75,
            "require_p0": True,
            "expect_fail": False,
            "ephemeral": True,
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


def run_case(case: dict) -> dict:
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
            slicelib.write_web_slice(dest, spec)
            project = dest
        else:
            project = Path(case["path"]).expanduser().resolve()
            if not project.is_dir():
                return {
                    "id": cid,
                    "ok": False,
                    "error": f"missing path {project}",
                }

        result = verify.evaluate(project)
        p0_ok = not result.get("p0_fail")
        score = int(result.get("score") or 0)
        if expect_fail:
            ok = (not p0_ok) or score < 50
        else:
            ok = (p0_ok if require_p0 else True) and score >= min_score
        return {
            "id": cid,
            "ok": ok,
            "score": score,
            "p0_fail": result.get("p0_fail") or [],
            "expect_fail": expect_fail,
            "min_score": min_score,
            "report": (result.get("report") or "")[:800],
        }
    except Exception as e:
        return {"id": cid, "ok": False, "error": str(e)}
    finally:
        if tmp is not None:
            tmp.cleanup()


def run_all() -> dict:
    cases = load_cases()
    rows = [run_case(c) for c in cases]
    passed = sum(1 for r in rows if r.get("ok"))
    return {
        "ok": passed == len(rows),
        "passed": passed,
        "total": len(rows),
        "cases": rows,
    }


def main() -> int:
    ap = argparse.ArgumentParser(description="Golden slice CI")
    ap.add_argument("--json", action="store_true")
    args = ap.parse_args()
    report = run_all()
    if args.json:
        print(json.dumps(report, indent=2))
    else:
        print(f"GOLDEN {report['passed']}/{report['total']} " + ("OK" if report["ok"] else "FAIL"))
        for c in report["cases"]:
            mark = "✓" if c.get("ok") else "✗"
            extra = c.get("error") or f"score={c.get('score')} p0={c.get('p0_fail')}"
            print(f"  {mark} {c.get('id')}: {extra}")
    return 0 if report["ok"] else 1


if __name__ == "__main__":
    raise SystemExit(main())
