from __future__ import annotations

import tempfile
import time
import unittest
from pathlib import Path

import wiki


class TestWiki(unittest.TestCase):
    def test_ensure_and_prompt(self) -> None:
        with tempfile.TemporaryDirectory() as raw:
            p = Path(raw)
            (p / "src").mkdir()
            (p / "src" / "main.js").write_text(
                "// boot the renderer\nexport const n = 1\n", encoding="utf-8"
            )
            (p / "package.json").write_text('{"name":"t"}', encoding="utf-8")
            block = wiki.prompt_block(p)
            self.assertIn("PROJECT WIKI", block)
            self.assertIn("Three.js", block)
            self.assertIn("PROJECT MAP", block)
            self.assertIn("src/main.js", block)
            self.assertTrue((p / "WIKI.md").is_file())
            self.assertTrue((p / "MAP.md").is_file())

    def test_append_fact_dedup(self) -> None:
        with tempfile.TemporaryDirectory() as raw:
            p = Path(raw)
            wiki.append_fact(p, "Gravity 28", "user said floaty")
            wiki.append_fact(p, "Gravity 28", "again")
            text = (p / "WIKI.md").read_text(encoding="utf-8")
            self.assertEqual(text.count("Gravity 28"), 1)
            self.assertIn("**Why:** user said floaty", text)

    def test_map_stale_after_new_file(self) -> None:
        with tempfile.TemporaryDirectory() as raw:
            p = Path(raw)
            (p / "src").mkdir()
            (p / "src" / "main.js").write_text("export const a=1\n", encoding="utf-8")
            wiki.refresh_map(p, force=True)
            first = (p / "MAP.md").read_text(encoding="utf-8")
            time.sleep(0.05)
            (p / "src" / "game.js").write_text("// loop + CONFIG\nexport const b=2\n", encoding="utf-8")
            self.assertTrue(wiki.map_stale(p))
            wiki.refresh_map(p, force=False)
            second = (p / "MAP.md").read_text(encoding="utf-8")
            self.assertNotEqual(first, second)
            self.assertIn("src/game.js", second)

    def test_studio_pref_block_includes_wiki(self) -> None:
        import studio

        with tempfile.TemporaryDirectory() as raw:
            p = Path(raw)
            (p / "src").mkdir()
            (p / "src" / "player.js").write_text("export const p=1\n", encoding="utf-8")
            block = studio.pref_block(p)
            self.assertIn("PROJECT WIKI", block)
            self.assertIn("PROJECT MAP", block)


if __name__ == "__main__":
    unittest.main()
