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
        server.remember_tags(["gamemaster:latest"], ok=True)
        with mock.patch.object(server.cloudlib, "status_dict", return_value={"enabled": False}):
            h = server.health_payload()
        self.assertTrue(h["ok"])
        self.assertEqual(h["backend"], "ollama")
        self.assertTrue(h["has_model"])

    def test_index_html_bakes_status(self) -> None:
        server.remember_tags(["gamemaster:latest"], ok=True)
        with mock.patch.object(server.cloudlib, "status_dict", return_value={"enabled": False}):
            html = server.index_html().decode()
        self.assertIn("online · gamemaster · $0", html)
        self.assertIn('class="dot ok"', html)
        self.assertNotIn("starting…", html)
        self.assertIn('id="composer"', html)
        self.assertIn("GM.bootSend", html)
        self.assertTrue((server.CHAT_DIR / "app.js").is_file())

    def test_projects_root_in_payload(self) -> None:
        import os
        import tempfile
        from pathlib import Path

        with tempfile.TemporaryDirectory() as raw:
            os.environ["GAMEMASTER_PROJECTS"] = raw
            self.addCleanup(lambda: os.environ.pop("GAMEMASTER_PROJECTS", None))
            (Path(raw) / "demo").mkdir()
            (Path(raw) / "demo" / "package.json").write_text("{}", encoding="utf-8")
            listed = server.list_game_projects()
            self.assertEqual(listed[0]["name"], "demo")
            self.assertEqual(server.projects_root(), Path(raw))

    def test_health_does_not_call_ollama(self) -> None:
        server.remember_tags(["gamemaster:latest"], ok=True)
        with mock.patch.object(server.cloudlib, "status_dict", return_value={"enabled": False}):
            with mock.patch.object(server, "peek_ollama_tags", side_effect=AssertionError("must not probe")):
                h = server.health_payload()
        self.assertTrue(h["ok"])


if __name__ == "__main__":
    unittest.main()
