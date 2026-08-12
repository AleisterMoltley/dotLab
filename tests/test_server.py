from __future__ import annotations

import unittest
from unittest import mock

import server


class TestHealth(unittest.TestCase):
    def test_has_model_accepts_latest_tag(self) -> None:
        self.assertTrue(server.has_model(["gamemaster:latest"], "gamemaster"))
        self.assertFalse(server.has_model(["qwen2.5-coder:7b"], "gamemaster"))

    def test_health_cloud_short_circuits(self) -> None:
        fake = {
            "enabled": True,
            "provider": "grok",
            "model": "grok-4.5",
            "local": False,
        }
        with mock.patch.object(server.cloudlib, "status_dict", return_value=fake):
            h = server.health_payload()
        self.assertTrue(h["ok"])
        self.assertEqual(h["backend"], "cloud")
        self.assertEqual(h["provider"], "grok")

    def test_health_local_when_tags_ok(self) -> None:
        tags = {"ts": 1, "names": ["gamemaster:latest"], "ok": True, "error": ""}
        with mock.patch.object(server.cloudlib, "status_dict", return_value={"enabled": False}):
            with mock.patch.object(server, "peek_ollama_tags", return_value=tags):
                h = server.health_payload()
        self.assertTrue(h["ok"])
        self.assertEqual(h["backend"], "ollama")
        self.assertTrue(h["has_model"])


if __name__ == "__main__":
    unittest.main()
