from __future__ import annotations

import tempfile
import unittest
from pathlib import Path

import antislope
import slice as slicelib
import verify


class TestAntiSlope(unittest.TestCase):
    def test_silence_detects_shoot_without_juice(self) -> None:
        js = "function onHit(){ hp -= damage; fireCd = 1; fireRpm = 400; }"
        ok, _ = antislope.check_silence_on_hit(js)
        self.assertFalse(ok)

    def test_silence_ok_with_juice(self) -> None:
        js = "TimeJuice; hitstop; sfx.hit(); fireRpm = 400; damage -= 1;"
        ok, _ = antislope.check_silence_on_hit(js)
        self.assertTrue(ok)

    def test_immutable_craft(self) -> None:
        self.assertTrue(antislope.is_immutable_path("src/craft/palette.js"))
        self.assertFalse(antislope.is_immutable_path("src/systems/x.js"))

    def test_taste_tighter(self) -> None:
        with tempfile.TemporaryDirectory() as td:
            dest = Path(td)
            spec = slicelib.compile_prompt("neon fps dash", genre="fps")
            slicelib.write_web_slice(dest, spec)
            r = antislope.taste_action(dest, "tighter")
            self.assertTrue(r.get("ok"), r)

    def test_gallery_nonempty(self) -> None:
        g = antislope.gallery_prompt_block("capsule purple")
        self.assertIn("FAIL", g)
        self.assertIn("capsule", g.lower())

    def test_fps_slice_passes_antislope_p0(self) -> None:
        with tempfile.TemporaryDirectory() as td:
            dest = Path(td)
            spec = slicelib.compile_prompt("neon skill fps", genre="fps")
            slicelib.write_web_slice(dest, spec)
            r = verify.evaluate(dest)
            self.assertEqual(r["p0_fail"], [], r["report"])
            self.assertGreaterEqual(r["score"], 75)

    def test_format_normalize(self) -> None:
        with tempfile.TemporaryDirectory() as td:
            p = Path(td) / "a.js"
            p.write_text("const x = 1;   \n", encoding="utf-8")
            r = antislope.format_file(p)
            self.assertTrue(r.get("ok"))
            self.assertFalse(p.read_text(encoding="utf-8").endswith("   \n"))


if __name__ == "__main__":
    unittest.main()
