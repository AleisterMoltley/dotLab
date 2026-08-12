from __future__ import annotations

import tempfile
import unittest
from pathlib import Path

import agent
import kit


class TestKit(unittest.TestCase):
    def test_todos(self) -> None:
        with tempfile.TemporaryDirectory() as raw:
            p = Path(raw)
            self.assertIn("no todos", kit.todo_list(p))
            kit.todo_add(p, "tune gravity")
            kit.todo_add(p, "add juice")
            listed = kit.todo_list(p)
            self.assertIn("#1", listed)
            self.assertIn("#2", listed)
            self.assertIn("2 open", listed)
            kit.todo_done(p, "1")
            self.assertIn("1 open", kit.todo_list(p))

    def test_feel_audit(self) -> None:
        with tempfile.TemporaryDirectory() as raw:
            p = Path(raw)
            (p / "src").mkdir()
            (p / "src" / "game.js").write_text(
                "const CONFIG = { moveSpeed: 6, gravity: 22, jumpForce: 8 };\n",
                encoding="utf-8",
            )
            out = kit.feel_audit(p)
            self.assertIn("gravity: src/game.js:22", out)
            self.assertIn("MISSING", out)
            self.assertIn("coyoteMs", out)

    def test_art_test(self) -> None:
        with tempfile.TemporaryDirectory() as raw:
            p = Path(raw)
            (p / "art").mkdir()
            (p / "art" / "hero.png").write_bytes(b"\x89PNG\r\n\x1a\nnot-a-real-png")
            msg = kit.write_art_test(p)
            self.assertIn("1 images", msg)
            html = (p / "art-test.html").read_text(encoding="utf-8")
            self.assertIn("art/hero.png", html)
            self.assertIn("pixelated", html)

    def test_kit_router(self) -> None:
        with tempfile.TemporaryDirectory() as raw:
            p = Path(raw)
            out = kit.run_kit(p, "nope", {})
            self.assertTrue(out.startswith("ERROR"))
            kit.run_kit(p, "todo_add", {"text": "place"})
            self.assertIn("place", kit.run_kit(p, "todo_list", {}))

    def test_agent_dispatches_kit(self) -> None:
        with tempfile.TemporaryDirectory() as raw:
            p = Path(raw)
            out = agent.run_tool(p, "kit", {"action": "todo_add", "text": "body"})
            self.assertIn("OK added", out)

    def test_vendor_pixel(self) -> None:
        with tempfile.TemporaryDirectory() as raw:
            p = Path(raw)
            out = kit.vendor_pixel(p)
            self.assertIn("OK vendored", out)
            self.assertTrue((p / "src" / "pixel" / "three-bridge.js").is_file())
            again = kit.run_kit(p, "pixel", {})
            self.assertIn("already", again)

    def test_read_file_range(self) -> None:
        with tempfile.TemporaryDirectory() as raw:
            p = Path(raw)
            (p / "src").mkdir()
            (p / "src" / "g.js").write_text("a\nb\nc\nd\n", encoding="utf-8")
            out = agent.tool_read(p, "src/g.js", start="2", end="3")
            self.assertIn("lines 2-3", out)
            self.assertIn("b", out)
            self.assertNotIn("\nd", out)


if __name__ == "__main__":
    unittest.main()
