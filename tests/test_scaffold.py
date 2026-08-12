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
            self.assertTrue((dest / "src" / "game.js").is_file())
            self.assertTrue((dest / "src" / "pixelart" / "pixelart.js").is_file())
            self.assertTrue((dest / "src" / "pixelart" / "pixelart-fx.js").is_file())
            self.assertTrue((dest / "WIKI.md").is_file())
            self.assertTrue((dest / "DESIGN.md").is_file())
            html = (dest / "index.html").read_text(encoding="utf-8")
            self.assertIn("Test Grove", html)
            self.assertNotIn("shadertoy", html.lower())
            pkg = (dest / "package.json").read_text(encoding="utf-8")
            self.assertNotIn("three", pkg)
            game = (dest / "src" / "game.js").read_text(encoding="utf-8")
            self.assertIn("pixelart", game)
            self.assertIn("makeBakedSprite", game)
            self.assertIn("getContext", game)
            self.assertNotIn("from 'three'", game)
            r = verify.evaluate(dest)
            self.assertEqual(r["p0_fail"], [], r["report"])
            self.assertTrue(r["ok"], r["report"])

    def test_web_game_from_prompt_is_themed(self) -> None:
        with tempfile.TemporaryDirectory() as raw:
            dest = Path(raw) / "neon"
            dest.mkdir()
            scaffold.scaffold_web_game(dest, "Neon Shot", "arena", prompt="futuristic shooter neon drones")
            game = (dest / "src" / "game.js").read_text(encoding="utf-8")
            self.assertIn("createGame", game)
            self.assertNotIn("Genre: arena — vertical slice", game)
            self.assertIn("IcosahedronGeometry", game)
            r = verify.evaluate(dest)
            self.assertEqual(r["p0_fail"], [], r["report"])

    def test_vintage_game_gba_ceiling(self) -> None:
        with tempfile.TemporaryDirectory() as raw:
            dest = Path(raw) / "hand"
            dest.mkdir()
            scaffold.scaffold_vintage_game(dest, "Hand Quest", profile="gb")
            self.assertTrue((dest / "src" / "game.js").is_file())
            self.assertTrue((dest / "src" / "vintage" / "palettes.js").is_file())
            pkg = (dest / "package.json").read_text(encoding="utf-8")
            self.assertNotIn("three", pkg)
            game = (dest / "src" / "game.js").read_text(encoding="utf-8")
            self.assertIn("VINTAGE", game)
            self.assertNotIn("from 'three'", game)
            self.assertIn("240", game)  # ceiling constant in template
            r = verify.evaluate(dest)
            self.assertEqual(r["p0_fail"], [], r["report"])
            self.assertTrue(r["ok"], r["report"])
            self.assertIn("vintage_cap", r["checks"])
            self.assertTrue(r["checks"]["vintage_cap"]["ok"])

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
