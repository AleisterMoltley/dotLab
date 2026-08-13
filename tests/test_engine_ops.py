from __future__ import annotations

import tempfile
import unittest
from pathlib import Path

import engine_ops
import scaffold
import verify


class TestEngineOps(unittest.TestCase):
    def test_ship_card_and_switch(self) -> None:
        with tempfile.TemporaryDirectory() as raw:
            dest = Path(raw) / "g"
            dest.mkdir()
            scaffold.scaffold_vintage_game(dest, "Hand", profile="gb")
            card = engine_ops.ship_card(dest)
            self.assertTrue(card.get("ok"))
            self.assertEqual(card.get("engine"), "vintage")
            self.assertIn("×", card.get("resolution") or "")
            r = engine_ops.switch_engine(dest, "pixel")
            self.assertTrue(r.get("ok"), r)
            self.assertEqual(engine_ops.project_engine(dest), "pixel")
            vr = verify.evaluate(dest)
            self.assertEqual(vr.get("p0_fail"), [], vr.get("report"))

    def test_one_more_room(self) -> None:
        with tempfile.TemporaryDirectory() as raw:
            dest = Path(raw) / "g"
            dest.mkdir()
            scaffold.scaffold_vintage_game(dest, "Hand", profile="gb")
            r = engine_ops.one_more_room(dest)
            self.assertTrue(r.get("ok"), r)
            self.assertEqual(r.get("roomCount"), 2)
            sp = engine_ops.load_slice(dest)
            self.assertEqual(sp.get("roomCount"), 2)

    def test_vintage_palette(self) -> None:
        with tempfile.TemporaryDirectory() as raw:
            dest = Path(raw) / "g"
            dest.mkdir()
            scaffold.scaffold_vintage_game(dest, "Hand", profile="gb")
            r = engine_ops.set_vintage_palette(dest, "gbc-ocean")
            self.assertTrue(r.get("ok"), r)
            sp = engine_ops.load_slice(dest)
            self.assertEqual(sp["vintage"].get("paletteId"), "gbc-ocean")

    def test_stats(self) -> None:
        st = engine_ops.dashboard_stats()
        self.assertTrue(st.get("ok"))
        self.assertIn("engines", st)


if __name__ == "__main__":
    unittest.main()
