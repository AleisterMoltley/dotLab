from __future__ import annotations

import tempfile
import unittest
from pathlib import Path

import playtest


class TestPlaytestPort(unittest.TestCase):
    def test_vite_uses_free_strict_port(self) -> None:
        with tempfile.TemporaryDirectory() as raw:
            dest = Path(raw)
            (dest / "package.json").write_text(
                '{"scripts":{"dev":"vite"}}', encoding="utf-8"
            )
            cmd, port = playtest.detect_dev_command(dest)
        self.assertNotEqual(port, 5173)
        self.assertGreaterEqual(port, 5190)
        self.assertIn("--strictPort", cmd)
        self.assertIn(str(port), cmd)


if __name__ == "__main__":
    unittest.main()
