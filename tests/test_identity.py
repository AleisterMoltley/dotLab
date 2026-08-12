from __future__ import annotations

import unittest

import identity as identitylib


class TestIdentity(unittest.TestCase):
    def test_core_is_grok_not_chatbot(self) -> None:
        s = identitylib.system_for("modelfile")
        self.assertIn("Grok", s)
        self.assertIn("Gamemaster", s)
        self.assertIn("t=8s", s)
        self.assertIn("HOST", s)
        self.assertNotIn("Sure! I can help", s)

    def test_roles_differ(self) -> None:
        d = identitylib.system_for("director", extra_packs=False)
        a = identitylib.system_for("agent", extra_packs=False)
        self.assertIn("DIRECTOR", d)
        self.assertIn("AGENT", a)
        self.assertNotEqual(d, a)

    def test_seed_prefs(self) -> None:
        p = identitylib.seed_prefs_dict(None)
        self.assertEqual(p["identity"], "grok-gamemaster")
        self.assertIn("tight grounded movement", p["likes"])
        self.assertIn("floaty moon jumps", p["dislikes"])
        # user wins
        custom = identitylib.seed_prefs_dict({"likes": ["my thing"], "feel": {"jump": "custom"}})
        self.assertIn("my thing", custom["likes"])
        self.assertEqual(custom["feel"]["jump"], "custom")
        self.assertIn("tight grounded movement", custom["likes"])

    def test_write_modelfiles(self) -> None:
        paths = identitylib.write_modelfiles()
        self.assertTrue(any(p.name == "Modelfile" for p in paths))
        text = (identitylib.ROOT / "Modelfile").read_text(encoding="utf-8")
        self.assertIn("You are **Grok**", text)


if __name__ == "__main__":
    unittest.main()
