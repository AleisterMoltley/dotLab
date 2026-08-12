from __future__ import annotations

import unittest

import turbo


class TestRoute(unittest.TestCase):
    def test_hello_is_flash(self) -> None:
        r = turbo.route_task("hello")
        self.assertEqual(r["tier"], "flash")

    def test_game_prompt_is_max(self) -> None:
        r = turbo.route_task("third person village combat")
        self.assertEqual(r["tier"], "max")

    def test_shadertoy_is_max(self) -> None:
        r = turbo.route_task("shadertoy water and toon rim")
        self.assertEqual(r["tier"], "max")

    def test_pixel_art_is_max(self) -> None:
        r = turbo.route_task("pixel art sprite")
        self.assertEqual(r["tier"], "max")

    def test_forced_dense(self) -> None:
        r = turbo.route_task("anything", mode="dense")
        self.assertEqual(r["tier"], "dense")
        self.assertEqual(r["reason"], "forced:dense")


class TestKnowledge(unittest.TestCase):
    def test_core_always_present(self) -> None:
        k = turbo.select_knowledge("hello", max_chars=12000)
        self.assertIn("brain.md", k)
        self.assertIn("game-systems.md", k)
        self.assertIn("t=8s", k)

    def test_combat_pulls_juice(self) -> None:
        k = turbo.select_knowledge("third person village combat", max_chars=28000)
        self.assertIn("combat-juice.md", k)
        self.assertIn("feel-tables.md", k)

    def test_worldclaw_pulls_world(self) -> None:
        k = turbo.select_knowledge("open world terrain biomes worldclaw", max_chars=28000)
        self.assertIn("world-building.md", k)

    def test_pixel_art_pulls_kit(self) -> None:
        k = turbo.select_knowledge("pixel art bakeCanvas layeredRect sprite", max_chars=28000)
        self.assertIn("pixel-kit.md", k)
        self.assertIn("bakeCanvas", k)

    def test_packs_files_exist(self) -> None:
        missing = []
        for names in turbo.PACKS.values():
            for name in names:
                if not (turbo.KNOWLEDGE / name).is_file():
                    missing.append(name)
        self.assertEqual(missing, [])

    def test_index_lists_packs(self) -> None:
        index = (turbo.KNOWLEDGE / "INDEX.md").read_text(encoding="utf-8")
        listed = set()
        for names in turbo.PACKS.values():
            listed.update(names)
        # INDEX uses backtick filenames; live/LATEST.md is auto
        unlisted = [n for n in sorted(listed) if n != "live/LATEST.md" and f"`{n}`" not in index]
        self.assertEqual(unlisted, [])


if __name__ == "__main__":
    unittest.main()
