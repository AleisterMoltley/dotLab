from __future__ import annotations

import unittest

import golden


class TestGolden(unittest.TestCase):
    def test_suite_passes(self) -> None:
        report = golden.run_all()
        if not report["ok"]:
            fails = [c for c in report["cases"] if not c.get("ok")]
            self.fail(f"golden failed: {fails}")
        self.assertGreaterEqual(report["passed"], 3)


if __name__ == "__main__":
    unittest.main()
