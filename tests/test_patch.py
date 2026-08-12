from __future__ import annotations

import tempfile
import unittest
from pathlib import Path

import patch as patchlib
import slice as slicelib
import verify


class TestInstantCraft(unittest.TestCase):
    def setUp(self) -> None:
        self.tmp = tempfile.TemporaryDirectory()
        self.dest = Path(self.tmp.name) / "neon-shot"
        self.dest.mkdir()
        spec = slicelib.compile_prompt("futuristic shooter neon drones")
        spec["title"] = "Neon Shot"
        slicelib.write_web_slice(self.dest, spec)

    def tearDown(self) -> None:
        self.tmp.cleanup()

    def test_floaty_raises_gravity(self) -> None:
        before = patchlib.load_spec(self.dest)["feel"]["gravity"]
        r = patchlib.try_patch(self.dest, "jump feels floaty")
        self.assertIsNotNone(r)
        assert r is not None
        self.assertTrue(r["ok"])
        self.assertEqual(r.get("mode"), "patch")
        after = patchlib.load_spec(self.dest)["feel"]["gravity"]
        self.assertGreater(after, before)
        self.assertEqual(verify.evaluate(self.dest)["p0_fail"], [])

    def test_more_enemies(self) -> None:
        before = int(patchlib.load_spec(self.dest).get("enemyCount") or 0)
        r = patchlib.try_patch(self.dest, "more enemies")
        self.assertIsNotNone(r)
        assert r is not None
        after = int(patchlib.load_spec(self.dest).get("enemyCount") or 0)
        self.assertGreater(after, before)
        game = (self.dest / "src" / "game.js").read_text(encoding="utf-8")
        self.assertIn(f'"enemyCount": {after}', game)

    def test_palette_forest(self) -> None:
        r = patchlib.try_patch(self.dest, "make it a forest")
        self.assertIsNotNone(r)
        assert r is not None
        spec = patchlib.load_spec(self.dest)
        self.assertEqual(spec["props"], "forest")

    def test_genre_platformer(self) -> None:
        r = patchlib.try_patch(self.dest, "make it a platformer")
        self.assertIsNotNone(r)
        assert r is not None
        spec = patchlib.load_spec(self.dest)
        self.assertEqual(spec["genre"], "platformer")
        self.assertEqual(spec["loop"], "jump")

    def test_llm_only_returns_none(self) -> None:
        self.assertIsNone(patchlib.try_patch(self.dest, "add a dialogue tree with quest flags"))
        self.assertIsNone(patchlib.try_patch(self.dest, "implement ragdoll physics"))

    def test_needs_llm(self) -> None:
        self.assertTrue(patchlib.needs_llm("add inventory system"))
        self.assertFalse(patchlib.needs_llm("faster please"))


if __name__ == "__main__":
    unittest.main()
