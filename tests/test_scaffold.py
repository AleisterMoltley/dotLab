from __future__ import annotations

import tempfile
import unittest
from pathlib import Path

import scaffold
import verify

ROOT = Path(__file__).resolve().parent.parent


class TestPixelScaffold(unittest.TestCase):
    def test_pixel_game_not_shader_lab(self) -> None:
        with tempfile.TemporaryDirectory() as raw:
            dest = Path(raw) / "grove"
            dest.mkdir()
            scaffold.scaffold_pixel_game(dest, "Test Grove")
            self.assertTrue((dest / "src" / "main.js").is_file())
            self.assertTrue((dest / "src" / "pixel" / "three-bridge.js").is_file())
            self.assertTrue((dest / "src" / "pixel" / "bake.js").is_file())
            self.assertTrue((dest / "src" / "pixel" / "draw.js").is_file())
            self.assertTrue((dest / "WIKI.md").is_file())
            self.assertTrue((dest / "DESIGN.md").is_file())
            html = (dest / "index.html").read_text(encoding="utf-8")
            self.assertIn("Test Grove", html)
            self.assertNotIn("shadertoy", html.lower())
            main = (dest / "src" / "main.js").read_text(encoding="utf-8")
            self.assertIn("from 'three'", main)
            self.assertIn("bakeCanvas", main)
            self.assertIn("spriteMesh", main)
            self.assertIn("new THREE.Vector3()", main)
            self.assertNotIn("three/examples/jsm", main)
            r = verify.evaluate(dest)
            self.assertEqual(r["p0_fail"], [], r["report"])
            self.assertTrue(r["ok"], r["report"])

    def test_lib_pixel_is_esm(self) -> None:
        lib = ROOT / "lib" / "pixel"
        self.assertTrue((lib / "index.js").is_file())
        bake = (lib / "bake.js").read_text(encoding="utf-8")
        self.assertIn("export function bakeCanvas", bake)
        bridge = (lib / "three-bridge.js").read_text(encoding="utf-8")
        self.assertIn("NearestFilter", bridge)
        self.assertIn("from 'three'", bridge)


if __name__ == "__main__":
    unittest.main()
