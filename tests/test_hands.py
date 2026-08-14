from __future__ import annotations

import json
import tempfile
import unittest
from pathlib import Path
from unittest import mock

import hands
import play_gate


class TestFitJump(unittest.TestCase):
    def test_hang_and_apex(self) -> None:
        feel = hands.fit_jump(hang=0.5, apex=1.0, feel={"gravity": 24, "jumpForce": 8})
        self.assertAlmostEqual(feel["gravity"], 32.0, places=1)
        self.assertAlmostEqual(feel["jumpForce"], 8.0, places=1)

    def test_summarize_samples(self) -> None:
        s = hands.summarize_jumps(
            [{"hang": 0.4, "apex": 0.9}, {"hang": 0.5, "apex": 1.1}, {"hang": 0.6, "apex": 1.2}]
        )
        self.assertIsNotNone(s)
        self.assertAlmostEqual(s["hang"], 0.5, places=2)

    def test_apply_fit_writes_spec(self) -> None:
        with tempfile.TemporaryDirectory() as td:
            root = Path(td)
            (root / ".dotlab").mkdir()
            (root / ".dotlab" / "slice.json").write_text(
                json.dumps({"genre": "platformer", "loop": "jump", "feel": {"gravity": 20, "jumpForce": 7}}),
                encoding="utf-8",
            )
            (root / "src").mkdir()
            (root / "src" / "game.js").write_text("const CONFIG = { gravity: 20 };\n", encoding="utf-8")
            r = hands.apply_fit(root, hang=0.5, apex=1.0)
            self.assertTrue(r["ok"], r)
            spec = json.loads((root / ".dotlab" / "slice.json").read_text(encoding="utf-8"))
            self.assertGreater(float(spec["feel"]["gravity"]), 20)


class TestGhost(unittest.TestCase):
    def test_broken_jump_fails(self) -> None:
        with tempfile.TemporaryDirectory() as td:
            root = Path(td)
            (root / ".dotlab").mkdir()
            (root / ".dotlab" / "slice.json").write_text(
                json.dumps({"feel": {"gravity": 22, "jumpForce": 9.0, "moveSpeed": 7}}),
                encoding="utf-8",
            )
            hands.save_ghost(root, {"jumpSamples": [{"hang": 0.7, "apex": 2.4}]})
            (root / ".dotlab" / "slice.json").write_text(
                json.dumps({"feel": {"gravity": 40, "jumpForce": 5.5, "moveSpeed": 7}}),
                encoding="utf-8",
            )
            chk = hands.check_ghost(root)
            self.assertFalse(chk["ok"])
            self.assertEqual(chk["reason"], "ghost_broke")

    def test_play_gate_adds_ghost_p0(self) -> None:
        with tempfile.TemporaryDirectory() as td:
            root = Path(td)
            (root / ".dotlab").mkdir()
            (root / ".dotlab" / "slice.json").write_text(
                json.dumps({"feel": {"gravity": 40, "jumpForce": 5.0, "moveSpeed": 6}}),
                encoding="utf-8",
            )
            hands.save_ghost(root, {"jumpSamples": [{"hang": 0.8, "apex": 3.0}]})
            r = play_gate.evaluate_report(
                {
                    "errors": [],
                    "pageErrors": [],
                    "metrics": {
                        "hasCanvas": True,
                        "keys": 10,
                        "clicks": 1,
                        "frames": 40,
                        "avgFps": 50,
                        "maxDt": 20,
                    },
                    "screenshots": [],
                },
                family="platformer",
                project=root,
            )
            self.assertFalse(r["ok"])
            self.assertTrue(any("ghost" in x for x in r["p0_fail"]))


class TestSpatialAndCallout(unittest.TestCase):
    def test_mark_and_brief(self) -> None:
        with tempfile.TemporaryDirectory() as td:
            root = Path(td)
            hands.mark(root, "flag", {"x": 12, "y": 2, "z": 0}, "last ledge")
            block = hands.brief_block(root)
            self.assertIn("flag", block)
            self.assertIn("12", block)

    def test_callout_ghost(self) -> None:
        t = hands.callout_from({"ok": False, "p0_fail": ["ghost_broke"], "metrics": {}})
        self.assertIn("broke my jump", t.lower())

    def test_callout_win(self) -> None:
        t = hands.callout_from({"ok": True, "skipped": False, "p0_fail": [], "p1_fail": [], "metrics": {}})
        self.assertIn("One more run", t)


class TestTimelineSamenessShare(unittest.TestCase):
    def test_timeline_restore(self) -> None:
        with tempfile.TemporaryDirectory() as td:
            root = Path(td)
            (root / ".dotlab").mkdir()
            (root / ".dotlab" / "slice.json").write_text(
                json.dumps({"feel": {"gravity": 20, "jumpForce": 7}}),
                encoding="utf-8",
            )
            hands.timeline_add(root, "keep")
            (root / ".dotlab" / "slice.json").write_text(
                json.dumps({"feel": {"gravity": 30, "jumpForce": 9}}),
                encoding="utf-8",
            )
            hands.timeline_add(root, "tighter")
            r = hands.timeline_restore(root, 0)
            self.assertTrue(r["ok"])
            spec = json.loads((root / ".dotlab" / "slice.json").read_text(encoding="utf-8"))
            self.assertEqual(float(spec["feel"]["gravity"]), 20)

    def test_sameness_stamps_constraint(self) -> None:
        spec = {"genre": "fps", "loop": "shoot", "camera": "fps", "props": "neon"}
        with mock.patch.object(hands, "SAMENESS_FILE", Path(tempfile.mkdtemp()) / "s.jsonl"):
            hands.apply_sameness(dict(spec))
            hands.apply_sameness(dict(spec))
            out = hands.apply_sameness(dict(spec))
        self.assertIn("constraint", out)

    def test_share_zip(self) -> None:
        with tempfile.TemporaryDirectory() as td:
            root = Path(td) / "Skyjump"
            root.mkdir()
            (root / "package.json").write_text("{}", encoding="utf-8")
            (root / "src").mkdir()
            (root / "src" / "game.js").write_text("export const x=1\n", encoding="utf-8")
            r = hands.share(root)
            self.assertTrue(r["ok"], r)
            self.assertTrue(Path(r["path"]).is_file())
            self.assertGreater(r["bytes"], 20)


if __name__ == "__main__":
    unittest.main()
