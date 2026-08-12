from __future__ import annotations

import json
import os
import tempfile
import unittest
from pathlib import Path
from unittest import mock

import cloud


class TestCloudDefaultOff(unittest.TestCase):
    def setUp(self) -> None:
        self.tmp = tempfile.TemporaryDirectory()
        self.cfg = Path(self.tmp.name) / "cloud.json"
        self.env = mock.patch.dict(
            os.environ,
            {
                "GAMEMASTER_CLOUD_CONFIG": str(self.cfg),
                "XAI_API_KEY": "xai-test-secret-1234",
                "ANTHROPIC_API_KEY": "sk-ant-test",
            },
            clear=False,
        )
        self.env.start()
        os.environ.pop("GAMEMASTER_CLOUD", None)
        os.environ.pop("GAMEMASTER_CLOUD_MODEL", None)

    def tearDown(self) -> None:
        self.env.stop()
        self.tmp.cleanup()

    def test_key_in_env_does_not_enable(self) -> None:
        self.assertEqual(cloud.active_provider(), "")
        st = cloud.status_dict()
        self.assertTrue(st["local"])
        self.assertFalse(st["enabled"])
        self.assertTrue(st["providers"]["grok"]["has_key"])

    def test_env_oneshot_opts_in(self) -> None:
        os.environ["GAMEMASTER_CLOUD"] = "grok"
        self.assertEqual(cloud.active_provider(), "grok")

    def test_env_off_overrides_config(self) -> None:
        cloud.save_config({"enabled": True, "default": "claude", "providers": {}})
        os.environ["GAMEMASTER_CLOUD"] = "off"
        self.assertEqual(cloud.active_provider(), "")

    def test_persist_on_off(self) -> None:
        self.assertEqual(cloud.cmd_on("grok"), 0)
        self.assertEqual(cloud.active_provider(), "grok")
        self.assertTrue(self.cfg.is_file())
        raw = json.loads(self.cfg.read_text(encoding="utf-8"))
        self.assertTrue(raw["enabled"])
        self.assertNotIn("key", json.dumps(raw.get("providers") or {}))
        self.assertEqual(cloud.cmd_off(), 0)
        os.environ.pop("GAMEMASTER_CLOUD", None)
        self.assertEqual(cloud.active_provider(), "")

    def test_on_without_key_fails(self) -> None:
        os.environ.pop("XAI_API_KEY", None)
        self.assertEqual(cloud.cmd_on("grok"), 1)
        self.assertEqual(cloud.active_provider(), "")

    def test_mask_key(self) -> None:
        self.assertEqual(cloud.mask_key(""), "(none)")
        self.assertTrue(cloud.mask_key("xai-test-secret-1234").endswith("1234"))
        self.assertNotIn("secret", cloud.mask_key("xai-test-secret-1234"))

    def test_openai_and_anthropic_payloads(self) -> None:
        msgs = [
            {"role": "system", "content": "You are Gamemaster"},
            {"role": "user", "content": "jump"},
        ]
        oai = cloud.openai_payload(msgs, "grok-4.5", 0.2, 512)
        self.assertEqual(oai["model"], "grok-4.5")
        self.assertEqual(len(oai["messages"]), 2)
        ant = cloud.anthropic_payload(msgs, "claude-sonnet-4-5", 0.2, 512)
        self.assertEqual(ant["system"], "You are Gamemaster")
        self.assertEqual(ant["messages"][0]["role"], "user")
        self.assertNotIn("system", {m["role"] for m in ant["messages"]})

    def test_unknown_provider_on(self) -> None:
        self.assertEqual(cloud.cmd_on("nope"), 1)


if __name__ == "__main__":
    unittest.main()
