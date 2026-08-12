from __future__ import annotations

import tempfile
import unittest
from pathlib import Path

import gmcommon as g


class TestGmcommon(unittest.TestCase):
    def test_root_is_repo(self) -> None:
        self.assertTrue((g.ROOT / "Modelfile").is_file())
        self.assertTrue((g.ROOT / "bin" / "gamemaster").is_file())
        self.assertEqual(g.BIN, g.ROOT / "bin")
        self.assertEqual(g.KNOWLEDGE, g.ROOT / "knowledge")

    def test_slugify_project(self) -> None:
        self.assertEqual(g.slugify_project("Wild Coast!!"), "wild-coast")
        self.assertEqual(g.slugify_project(""), "gamemaster-project")

    def test_slugify_repo(self) -> None:
        self.assertEqual(g.slugify_repo("My Game v2"), "my-game-v2")
        self.assertIn(".", g.slugify_repo("foo.bar"))

    def test_looks_like_game(self) -> None:
        with tempfile.TemporaryDirectory() as raw:
            p = Path(raw)
            self.assertFalse(g.looks_like_game(p))
            (p / "package.json").write_text("{}", encoding="utf-8")
            self.assertTrue(g.looks_like_game(p))

    def test_ensure_gitignore_creates_and_patches(self) -> None:
        with tempfile.TemporaryDirectory() as raw:
            p = Path(raw)
            g.ensure_game_gitignore(p)
            text = (p / ".gitignore").read_text(encoding="utf-8")
            self.assertIn("node_modules/", text)
            (p / ".gitignore").write_text("*.log\n", encoding="utf-8")
            g.ensure_game_gitignore(p)
            text2 = (p / ".gitignore").read_text(encoding="utf-8")
            self.assertIn("*.log", text2)
            self.assertIn("node_modules/", text2)


if __name__ == "__main__":
    unittest.main()
