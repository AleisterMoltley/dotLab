from __future__ import annotations

import struct
import tempfile
import unittest
import zlib
from pathlib import Path

import antislope
import scaffold
import slice as slicelib
import verify

ROOT = Path(__file__).resolve().parent.parent


def _png(path: Path, w: int, h: int, pix: list[tuple[int, int, int]]) -> None:
    raw = b""
    for y in range(h):
        raw += b"\x00"
        for x in range(w):
            r, g, b = pix[y * w + x]
            raw += bytes((r & 255, g & 255, b & 255))

    def chunk(tag: bytes, data: bytes) -> bytes:
        crc = zlib.crc32(tag + data) & 0xFFFFFFFF
        return struct.pack(">I", len(data)) + tag + data + struct.pack(">I", crc)

    ihdr = struct.pack(">IIBBBBB", w, h, 8, 2, 0, 0, 0)
    path.write_bytes(
        b"\x89PNG\r\n\x1a\n" + chunk(b"IHDR", ihdr) + chunk(b"IDAT", zlib.compress(raw)) + chunk(b"IEND", b"")
    )


class TestPickLook(unittest.TestCase):
    def test_fps_is_neon(self) -> None:
        self.assertEqual(slicelib.pick_look("fps", "shoot", "neon", "drones"), "neon-night")

    def test_platformer_forest(self) -> None:
        self.assertEqual(slicelib.pick_look("platformer", "jump", "forest", ""), "pine-ridge")


class TestLookVendored(unittest.TestCase):
    def test_web_slice_has_look_kit(self) -> None:
        self.assertTrue((ROOT / "lib" / "look" / "rig.js").is_file())
        self.assertIn("InstancedMesh", (ROOT / "lib" / "look" / "scatter.js").read_text(encoding="utf-8"))
        with tempfile.TemporaryDirectory() as raw:
            dest = Path(raw) / "neon"
            dest.mkdir()
            scaffold.scaffold_web_game(dest, "Neon Shot", "arena", prompt="futuristic shooter neon drones")
            self.assertTrue((dest / "src" / "look" / "index.js").is_file())
            game = (dest / "src" / "game.js").read_text(encoding="utf-8")
            self.assertIn("applyLook", game)
            self.assertIn("from './look/index.js'", game)
            self.assertNotIn("for (let i = 0; i < 22; i++)", game)
            self.assertTrue((dest / "src" / "look" / "volume.js").is_file())
            self.assertIn("makeSky", (dest / "src" / "look" / "shaders.js").read_text(encoding="utf-8"))
            r = verify.evaluate(dest)
            self.assertEqual(r["p0_fail"], [], r["report"])
            self.assertTrue(r["checks"]["look_kit"]["ok"], r["report"])
            self.assertTrue(r["checks"]["instanced"]["ok"], r["report"])
            self.assertTrue(r["checks"]["no_alloc_loop"]["ok"], r["report"])


class TestAnalyzeFrame(unittest.TestCase):
    def test_flat_vs_varied(self) -> None:
        with tempfile.TemporaryDirectory() as td:
            flat = Path(td) / "flat.png"
            varied = Path(td) / "varied.png"
            _png(flat, 16, 16, [(8, 8, 8)] * 256)
            pix = []
            for y in range(16):
                for x in range(16):
                    if x < 5:
                        pix.append((20, 20, 80))
                    elif x < 11:
                        pix.append((40, 90, 30))
                    else:
                        pix.append((200, 60, 40))
            _png(varied, 16, 16, pix)
            a = antislope.analyze_frame(flat)
            b = antislope.analyze_frame(varied)
            self.assertTrue(a["ok"] and b["ok"])
            self.assertIn("flat_frame", a["hints"])
            self.assertGreater(b["hue_clusters"], a["hue_clusters"])

    def test_playwright_png_unfilters(self) -> None:
        shot = Path("/Users/pmr/dotLab/Projects/razor-pit/.gamemaster/playtest/00-start.png")
        if not shot.is_file():
            self.skipTest("razor-pit playtest shot not on disk")
        h = antislope.screenshot_slop_hint(shot)
        # Void-sky start frames sit dark on purpose; unfiltered rows still beat 0.
        self.assertGreater(h["luminance"], 4, h)
        self.assertNotIn("near_black_frame", h["hints"])


class TestLookImmutable(unittest.TestCase):
    def test_look_path_locked(self) -> None:
        self.assertTrue(antislope.is_immutable_path("src/look/rig.js"))
        self.assertTrue(antislope.is_immutable_path("src/look/cards.js"))


if __name__ == "__main__":
    unittest.main()
