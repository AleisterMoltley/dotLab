from __future__ import annotations

import tempfile
import unittest
from pathlib import Path

import github
from gmcommon import ROOT


class TestGithubGuards(unittest.TestCase):
    def test_refuse_home(self) -> None:
        with self.assertRaises(SystemExit) as ctx:
            github.guard_project(Path.home())
        self.assertIn("refusing", str(ctx.exception))

    def test_refuse_tool_root(self) -> None:
        with self.assertRaises(SystemExit) as ctx:
            github.guard_project(ROOT)
        self.assertIn("itself", str(ctx.exception))

    def test_refuse_empty_dir(self) -> None:
        with tempfile.TemporaryDirectory() as raw:
            with self.assertRaises(SystemExit) as ctx:
                github.guard_project(Path(raw))
            self.assertIn("look like a game", str(ctx.exception))

    def test_http_ship_home_is_400(self) -> None:
        code, data = github.handle_http(
            "POST",
            "/api/github/ship",
            {"project": str(Path.home()), "message": "nope"},
        )
        self.assertEqual(code, 400)
        self.assertFalse(data.get("ok"))
        self.assertIn("refusing", data.get("error") or "")

    def test_http_unknown_route(self) -> None:
        code, data = github.handle_http("GET", "/api/github/nope", {})
        self.assertEqual(code, 404)

    def test_http_commit_requires_project(self) -> None:
        code, data = github.handle_http("POST", "/api/github/commit", {})
        self.assertEqual(code, 400)
        self.assertIn("project", data.get("error") or "")


class TestGithubCommitLocal(unittest.TestCase):
    def test_commit_then_noop(self) -> None:
        with tempfile.TemporaryDirectory() as raw:
            p = Path(raw)
            (p / "package.json").write_text('{"name":"t"}', encoding="utf-8")
            (p / "DESIGN.md").write_text("# Temp Slice\n", encoding="utf-8")
            (p / "src").mkdir()
            (p / "src" / "main.js").write_text("export const n=1\n", encoding="utf-8")
            first = github.commit(p, "feat: first")
            self.assertTrue(first.get("ok"), first)
            self.assertTrue(first.get("committed"))
            second = github.commit(p, "feat: first")
            self.assertTrue(second.get("ok"), second)
            self.assertFalse(second.get("committed"))
            self.assertTrue((p / ".gitignore").is_file())
            self.assertTrue((p / ".git").is_dir())


if __name__ == "__main__":
    unittest.main()
