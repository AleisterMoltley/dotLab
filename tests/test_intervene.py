from __future__ import annotations

import tempfile
import unittest
from pathlib import Path
from unittest import mock

import intervene
import patch as patchlib
import slice as slicelib


class TestIntervene(unittest.TestCase):
    def test_env_exports(self) -> None:
        text = intervene.OLLAMA_ENV
        self.assertIn("OLLAMA_FLASH_ATTENTION=1", text)
        self.assertIn("OLLAMA_NUM_PARALLEL=1", text)
        self.assertIn("OLLAMA_KEEP_ALIVE=24h", text)

    def test_render_modelfile_swaps_from_and_ctx(self) -> None:
        src = Path(intervene.ROOT) / "Modelfile"
        body = intervene.render_modelfile("qwen2.5-coder:14b", src, 12288)
        self.assertIn("FROM qwen2.5-coder:14b", body)
        self.assertIn("PARAMETER num_ctx 12288", body)
        self.assertIn("Gamemaster", body)

    def test_detect_base_shape(self) -> None:
        with mock.patch.object(intervene, "run", return_value=(0, "qwen3-coder:30b\nqwen2.5-coder:7b\n")):
            with mock.patch.object(intervene, "mem_gb", return_value=64):
                b = intervene.detect_base()
        self.assertEqual(b["max_base"], "qwen3-coder:30b")
        self.assertEqual(b["flash_base"], "qwen2.5-coder:7b")
        self.assertLessEqual(b["num_ctx"], 16384)

    def test_diagnose_on_slice(self) -> None:
        with tempfile.TemporaryDirectory() as raw:
            dest = Path(raw) / "g"
            dest.mkdir()
            spec = slicelib.compile_prompt("neon shooter")
            slicelib.write_web_slice(dest, spec)
            report = patchlib.diagnose(dest)
            self.assertIn("Craft diagnose", report)
            self.assertIn("P0", report)
            self.assertIn("shoot", report.lower())


if __name__ == "__main__":
    unittest.main()
