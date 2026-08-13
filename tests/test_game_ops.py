from __future__ import annotations

import json
import tempfile
import unittest
from pathlib import Path

import game_ops
import scaffold


class TestGameOps(unittest.TestCase):
    def test_extract_ops(self) -> None:
        text = 'Here:\n```json\n[{"type":"set_feel","gravity":30},{"type":"note","text":"x"}]\n```\n'
        ops = game_ops.extract_ops(text)
        self.assertEqual(len(ops), 2)
        self.assertEqual(ops[0]["type"], "set_feel")

    def test_set_feel_and_lock(self) -> None:
        with tempfile.TemporaryDirectory() as raw:
            dest = Path(raw) / "g"
            dest.mkdir()
            scaffold.scaffold_web_game(dest, "T", "platformer", prompt="platformer jump")
            r = game_ops.apply_ops(
                dest,
                [
                    {"type": "set_feel", "gravity": 30, "moveSpeed": 7.0},
                    {"type": "lock", "path": "feel.gravity"},
                    {"type": "set_feel", "gravity": 10},
                ],
            )
            self.assertTrue(r.get("ok"))
            self.assertEqual(r.get("applied"), 2)  # third locked
            results = r.get("results") or []
            self.assertTrue(results[0].get("ok"))
            self.assertTrue(results[1].get("ok"))
            self.assertFalse(results[2].get("ok"))
            # gravity stayed 30
            import patch as patchlib

            sp = patchlib.load_spec(dest)
            self.assertEqual(float(sp["feel"]["gravity"]), 30.0)
            self.assertIn("feel.gravity", r.get("locks") or [])

    def test_set_flag_and_context(self) -> None:
        with tempfile.TemporaryDirectory() as raw:
            dest = Path(raw) / "g"
            dest.mkdir()
            scaffold.scaffold_vintage_game(dest, "V", profile="gb")
            r = game_ops.apply_ops(
                dest,
                [
                    {"type": "set_flag", "flag": "met_npc", "value": True},
                    {"type": "request_context", "topics": ["slice", "locks", "flags"]},
                ],
            )
            self.assertTrue(r.get("ok"))
            flags = game_ops.load_flags(dest)
            self.assertTrue(flags.get("met_npc"))
            self.assertIn("flags", (r.get("context") or "").lower() + "flags")

    def test_add_room_op(self) -> None:
        with tempfile.TemporaryDirectory() as raw:
            dest = Path(raw) / "g"
            dest.mkdir()
            scaffold.scaffold_vintage_game(dest, "V", profile="gb")
            r = game_ops.apply_ops(dest, [{"type": "add_room"}])
            self.assertTrue(r.get("ok"), r)
            import patch as patchlib

            sp = patchlib.load_spec(dest)
            self.assertEqual(int(sp.get("roomCount") or 0), 2)

    def test_schema(self) -> None:
        s = game_ops.schema_doc()
        self.assertIn("set_feel", s["types"])
        self.assertIn("instruction", s)


if __name__ == "__main__":
    unittest.main()
