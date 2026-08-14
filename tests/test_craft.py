from __future__ import annotations

import tempfile
import unittest
from pathlib import Path

import antislope
import scaffold
import slice as slicelib
import verify

ROOT = Path(__file__).resolve().parent.parent
CRAFT = ROOT / "lib" / "craft"


class TestCraftModulesExist(unittest.TestCase):
    def test_kit_files(self) -> None:
        for name in (
            "camera.js",
            "punch.js",
            "pool.js",
            "blob.js",
            "brain.js",
            "scale.js",
            "motion.js",
            "recoil.js",
            "impact.js",
            "mark.js",
            "vignette.js",
            "index.js",
        ):
            self.assertTrue((CRAFT / name).is_file(), name)

    def test_brain_does_not_track_on_strike(self) -> None:
        src = (CRAFT / "brain.js").read_text(encoding="utf-8")
        self.assertIn("lockX", src)
        self.assertIn("PHASE", src)
        self.assertIn("DOES NOT track", src)

    def test_punch_covers_stack(self) -> None:
        src = (CRAFT / "punch.js").read_text(encoding="utf-8")
        for kind in ("shoot", "hit", "kill", "land", "hurt", "death"):
            self.assertIn(f"kind === '{kind}'", src)
        self.assertIn("hitmark", src)

    def test_pool_no_new_mesh_in_spawn(self) -> None:
        src = (CRAFT / "pool.js").read_text(encoding="utf-8")
        spawn = src.split("spawn(")[1].split("tick(")[0]
        self.assertNotIn("new THREE.Mesh", spawn)
        self.assertNotIn("new THREE.BoxGeometry", spawn)


class TestCraftVendored(unittest.TestCase):
    def test_web_slice_uses_craft_kit(self) -> None:
        self.assertTrue((CRAFT / "punch.js").is_file())
        with tempfile.TemporaryDirectory() as raw:
            dest = Path(raw) / "arena"
            dest.mkdir()
            scaffold.scaffold_web_game(dest, "Craft Shot", "arena", prompt="futuristic shooter neon drones")
            self.assertTrue((dest / "src" / "craft" / "punch.js").is_file())
            self.assertTrue((dest / "src" / "craft" / "camera.js").is_file())
            self.assertTrue((dest / "src" / "craft" / "brain.js").is_file())
            game = (dest / "src" / "game.js").read_text(encoding="utf-8")
            self.assertIn("punch(", game)
            self.assertIn("makeTracerPool", game)
            self.assertIn("tickBrain", game)
            self.assertIn("fpsLook", game)
            self.assertIn("attachBlob", game)
            self.assertIn("kickRecoil", game)
            self.assertIn("makeImpactPool", game)
            self.assertIn("makeMarkPool", game)
            self.assertIn("attachVignette", game)
            self.assertNotIn("function spawnTracer", game)
            r = verify.evaluate(dest)
            self.assertEqual(r["p0_fail"], [], r["report"])
            self.assertTrue(r["checks"]["craft_kit"]["ok"], r["report"])

    def test_missing_imports_fail_craft_kit(self) -> None:
        with tempfile.TemporaryDirectory() as raw:
            dest = Path(raw)
            spec = slicelib.compile_prompt("neon fps dash", genre="fps")
            slicelib.write_web_slice(dest, spec)
            game = dest / "src" / "game.js"
            text = game.read_text(encoding="utf-8")
            game.write_text(text.replace("punch(", "juiceHit("), encoding="utf-8")
            r = verify.evaluate(dest)
            self.assertIn("craft_kit", r["p0_fail"], r["report"])


class TestCraftImmutable(unittest.TestCase):
    def test_craft_path_locked(self) -> None:
        self.assertTrue(antislope.is_immutable_path("src/craft/punch.js"))
        self.assertTrue(antislope.is_immutable_path("src/craft/camera.js"))
        self.assertTrue(antislope.is_immutable_path("src/craft/brain.js"))
        self.assertTrue(antislope.is_immutable_path("lib/craft/recoil.js"))


class TestPunchCountsAsJuice(unittest.TestCase):
    def test_punch_is_not_silence(self) -> None:
        js = "function tryFire(){ fireRpm = 400; punch(stack, 'hit'); e.hp -= damage; }"
        ok, _ = antislope.check_silence_on_hit(js)
        self.assertTrue(ok)


if __name__ == "__main__":
    unittest.main()
