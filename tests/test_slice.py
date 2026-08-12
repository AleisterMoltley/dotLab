from __future__ import annotations

import tempfile
import unittest
from pathlib import Path

import slice as slicelib
import verify


class TestCompilePrompt(unittest.TestCase):
    def test_futuristic_shooter(self) -> None:
        spec = slicelib.compile_prompt("shooter futuristic")
        self.assertEqual(spec["genre"], "fps")
        self.assertEqual(spec["loop"], "shoot")
        self.assertEqual(spec["camera"], "fps")
        self.assertEqual(spec["props"], "neon")
        self.assertIn("neon", spec["setting"])
        self.assertIn("shoot", spec["verb"])
        self.assertEqual(spec["kind"], "web-game")

    def test_german_shooter(self) -> None:
        spec = slicelib.compile_prompt("futuristischer Shooter mit Drohnen")
        self.assertEqual(spec["genre"], "fps")
        self.assertEqual(spec["props"], "neon")

    def test_platformer_and_pixel(self) -> None:
        plat = slicelib.compile_prompt("The player jumps between platforms")
        self.assertEqual(plat["genre"], "platformer")
        self.assertEqual(plat["loop"], "jump")
        self.assertEqual(slicelib.infer_kind("A tiny pixel forest"), "pixel-game")

    def test_stable_seed(self) -> None:
        a = slicelib.compile_prompt("neon city runner")
        b = slicelib.compile_prompt("neon city runner")
        self.assertEqual(a["seed"], b["seed"])


class TestExtract(unittest.TestCase):
    def test_untitled_js_becomes_game(self) -> None:
        text = "```javascript\nimport * as THREE from 'three';\nexport function createGame() {}\n```\n"
        files = slicelib.extract_code_files(text)
        self.assertEqual(files[0][0], "src/game.js")
        self.assertIn("createGame", files[0][1])

    def test_pathed_fence_still_works(self) -> None:
        text = "```js src/game.js\nexport const X = 1;\n```\n"
        files = slicelib.extract_code_files(text)
        self.assertEqual(files[0][0], "src/game.js")


class TestWriteSlice(unittest.TestCase):
    def test_not_a_green_capsule_plane(self) -> None:
        with tempfile.TemporaryDirectory() as raw:
            dest = Path(raw) / "shooter-futuristic"
            spec = slicelib.compile_prompt("shooter futuristic")
            spec["title"] = "Shooter Futuristic"
            slicelib.write_web_slice(dest, spec)
            game = (dest / "src" / "game.js").read_text(encoding="utf-8")
            self.assertNotIn("0x1a3d2e", game)
            self.assertNotIn("__SPEC__", game)
            self.assertIn("createGame", game)
            self.assertIn("from 'three'", game)
            self.assertIn("IcosahedronGeometry", game)
            self.assertIn("requestPointerLock", game)
            self.assertIn("shoot drones", game)
            wiki = (dest / "WIKI.md").read_text(encoding="utf-8")
            self.assertIn("shooter futuristic", wiki)
            result = verify.evaluate(dest)
            self.assertEqual(result["p0_fail"], [], result["report"])
            self.assertTrue(result["ok"], result["report"])

    def test_bad_model_does_not_clobber_slice(self) -> None:
        with tempfile.TemporaryDirectory() as raw:
            dest = Path(raw) / "keep"
            spec = slicelib.compile_prompt("jumper platforms")
            slicelib.write_web_slice(dest, spec)
            before = (dest / "src" / "game.js").read_text(encoding="utf-8")
            junk = "```js src/game.js\nexport const X = 1;\n```\n"
            applied = slicelib.apply_model_files(dest, junk)
            self.assertTrue(applied["rejected"])
            self.assertEqual(applied["written"], [])
            self.assertEqual((dest / "src" / "game.js").read_text(encoding="utf-8"), before)


if __name__ == "__main__":
    unittest.main()
