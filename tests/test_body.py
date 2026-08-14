from __future__ import annotations

import tempfile
import unittest
from pathlib import Path

import antislope
import scaffold
import slice as slicelib
import verify

ROOT = Path(__file__).resolve().parent.parent
BODY = ROOT / "lib" / "body"


class TestBodyModules(unittest.TestCase):
    def test_files(self) -> None:
        for name in ("player.js", "enemy.js", "weapon.js", "cover.js", "pose.js", "cards.js", "index.js"):
            self.assertTrue((BODY / name).is_file(), name)

    def test_player_not_lone_capsule(self) -> None:
        src = (BODY / "player.js").read_text(encoding="utf-8")
        self.assertIn("visor", src)
        self.assertIn("torso", src)

    def test_enemies_named(self) -> None:
        src = (BODY / "enemy.js").read_text(encoding="utf-8")
        self.assertIn("drone", src)
        self.assertIn("crawler", src)
        self.assertIn("captain", src)


class TestBodyVendored(unittest.TestCase):
    def test_web_slice_uses_body_and_engine(self) -> None:
        with tempfile.TemporaryDirectory() as raw:
            dest = Path(raw) / "pit"
            dest.mkdir()
            scaffold.scaffold_web_game(dest, "Body Pit", "fps", prompt="neon fps drones")
            self.assertTrue((dest / "src" / "body" / "player.js").is_file())
            self.assertTrue((dest / "src" / "craft" / "engine.js").is_file())
            self.assertTrue((dest / "src" / "craft" / "director.js").is_file())
            game = (dest / "src" / "game.js").read_text(encoding="utf-8")
            self.assertIn("makePlayer", game)
            self.assertIn("makeEnemy", game)
            self.assertIn("tickPose", game)
            self.assertIn("applyEngine", game)
            self.assertIn("tickDirector", game)
            self.assertNotIn("IcosahedronGeometry", game)
            r = verify.evaluate(dest)
            self.assertEqual(r["p0_fail"], [], r["report"])
            self.assertTrue(r["checks"]["body_kit"]["ok"], r["report"])
            self.assertTrue(r["checks"]["engine_law"]["ok"], r["report"])

    def test_pick_toy_and_body(self) -> None:
        self.assertEqual(slicelib.pick_toy("fps", "shoot", "neon"), "ricochet")
        self.assertEqual(slicelib.pick_toy("platformer", "jump", "forest"), "dash-slash")
        b = slicelib.pick_body("fps", "shoot", "neon")
        self.assertEqual(b["player"], "visor")
        self.assertEqual(b["enemy"], "drone")


class TestBodyImmutable(unittest.TestCase):
    def test_locked(self) -> None:
        self.assertTrue(antislope.is_immutable_path("src/body/player.js"))
        self.assertTrue(antislope.is_immutable_path("lib/body/enemy.js"))


if __name__ == "__main__":
    unittest.main()
