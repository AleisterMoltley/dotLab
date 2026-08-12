from __future__ import annotations

import unittest
from pathlib import Path

import verify

ROOT = Path(__file__).resolve().parent.parent
PASS = ROOT / "tests" / "fixtures" / "slice-pass"
FAIL = ROOT / "tests" / "fixtures" / "slice-fail"


class TestVerify(unittest.TestCase):
    def test_gold_slice_passes_p0(self) -> None:
        r = verify.evaluate(PASS)
        self.assertTrue(r["ok"], r["report"])
        self.assertGreaterEqual(r["score"], 80)
        self.assertEqual(r["p0_fail"], [])

    def test_broken_slice_fails(self) -> None:
        r = verify.evaluate(FAIL)
        self.assertFalse(r["ok"], r["report"])
        self.assertIn("no_jsm", r["failed"])
        self.assertIn("no_holes", r["failed"])
        self.assertLess(r["score"], 50)

    def test_repair_prompt_lists_p0(self) -> None:
        r = verify.evaluate(FAIL)
        prompt = verify.repair_prompt(r)
        self.assertIn("VERIFY GATE", prompt)
        self.assertIn("P0", prompt)


if __name__ == "__main__":
    unittest.main()
