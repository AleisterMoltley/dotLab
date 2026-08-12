from __future__ import annotations

import json
import tempfile
import unittest
from pathlib import Path

import quality
import slots


class TestDirectorJson(unittest.TestCase):
    def test_extract_and_validate(self) -> None:
        raw = """
        Here you go:
        {
          "pitch": "Neon drones hunt you in rain alleys.",
          "verb": "dash and shoot",
          "t8s": "first kill with hitstop",
          "pillars": ["readability", "juice", "fair death"],
          "slice": "one block, three waves",
          "genre": "fps",
          "palette_id": "neon",
          "feel": {"gravity": 28, "moveSpeed": 7.2},
          "non_goals": ["open world"],
          "novelty": "dash-reload",
          "first_death": "telegraphed rush",
          "metric": "one more run?"
        }
        """
        data = quality.extract_json_object(raw)
        ok, errs, norm = quality.validate_director_json(data)
        self.assertTrue(ok, errs)
        self.assertEqual(norm["genre"], "fps")
        self.assertIn("gravity", norm["feel"])
        md = quality.director_json_to_markdown(norm)
        self.assertIn("Pitch", md)
        self.assertIn("dash and shoot", md)

    def test_invalid_missing_verb(self) -> None:
        ok, errs, _ = quality.validate_director_json({"pitch": "x"})
        self.assertFalse(ok)
        self.assertTrue(any("verb" in e for e in errs))


class TestPatches(unittest.TestCase):
    def test_parse_search_replace(self) -> None:
        text = """
@@ file:src/foo.js
@@ search
const a = 1
@@ replace
const a = 2
@@ end
"""
        patches = quality.parse_patches(text)
        self.assertEqual(len(patches), 1)
        self.assertEqual(patches[0]["mode"], "search_replace")
        self.assertIn("const a = 1", patches[0]["search"])
        self.assertIn("const a = 2", patches[0]["replace"])

    def test_apply_and_block_protected(self) -> None:
        with tempfile.TemporaryDirectory() as td:
            root = Path(td)
            game = root / "src" / "game.js"
            game.parent.mkdir(parents=True)
            # large protected file
            body = "\n".join(f"// line {i}" for i in range(100))
            game.write_text(body + "\n", encoding="utf-8")
            # full replace blocked
            res = quality.apply_full_write(root, "src/game.js", "export const x = 1\n")
            self.assertFalse(res.get("ok"))
            self.assertIn("blocked", (res.get("error") or "").lower())
            # search replace works
            r2 = quality.apply_search_replace(
                root, "src/game.js", "// line 5", "// line 5 patched"
            )
            self.assertTrue(r2.get("ok"))
            self.assertIn("patched", game.read_text(encoding="utf-8"))

    def test_new_module_allowed(self) -> None:
        with tempfile.TemporaryDirectory() as td:
            root = Path(td)
            res = quality.apply_full_write(
                root, "src/systems/nov.js", "export const n = 1\n"
            )
            self.assertTrue(res.get("ok"), res)
            self.assertTrue((root / "src/systems/nov.js").is_file())


class TestPrefix(unittest.TestCase):
    def test_stable_hash(self) -> None:
        a = quality.stable_prefix_hash("hello\nworld")
        b = quality.stable_prefix_hash("hello\nworld")
        c = quality.stable_prefix_hash("hello\nworld!")
        self.assertEqual(a, b)
        self.assertNotEqual(a, c)

    def test_strip_volatile(self) -> None:
        s = "You are Grok\nSession 2026-08-13 UTC\nKeep craft"
        out = quality.strip_volatile_system(s)
        self.assertIn("Grok", out)
        self.assertNotIn("2026-08-13", out)


class TestSlots(unittest.TestCase):
    def test_fill_and_write(self) -> None:
        with tempfile.TemporaryDirectory() as td:
            root = Path(td)
            (root / "src").mkdir()
            (root / "src" / "game.js").write_text(
                "import { TimeJuice } from './craft/juice.js';\nexport const x=1\n",
                encoding="utf-8",
            )
            spec = {
                "genre": "fps",
                "loop": "shoot",
                "seed": 3,
                "feel": {"gravity": 28},
            }
            director = {
                "novelty": "wave elite captain",
                "pillars": ["a", "b", "c"],
                "feel": {"moveSpeed": 7.5},
            }
            slots.fill_slots(spec, director)
            self.assertIn("slots", spec)
            written = slots.write_slot_module(root, spec)
            self.assertIn("src/slots/runtime.js", written)
            rt = (root / "src/slots/runtime.js").read_text(encoding="utf-8")
            self.assertIn("SLOTS", rt)
            self.assertIn("export function onWave", rt)


class TestScoreHeuristic(unittest.TestCase):
    def test_score_fixture_pass(self) -> None:
        root = Path(__file__).resolve().parent / "fixtures" / "slice-pass"
        if not root.is_dir():
            self.skipTest("no fixture")
        sc = quality.score_project(root)
        self.assertIn("score", sc)
        self.assertIsInstance(sc["score"], int)


class TestAcceptPair(unittest.TestCase):
    def test_log_pair(self) -> None:
        with tempfile.TemporaryDirectory() as td:
            root = Path(td)
            (root / ".dotlab").mkdir()
            p = quality.log_accept_pair(
                root,
                instruction="tighten jump",
                before="jumpForce: 8",
                after="jumpForce: 9",
                kind="test",
            )
            self.assertTrue(p.is_file())
            data = json.loads(p.read_text(encoding="utf-8"))
            self.assertEqual(data["kind"], "test")


class TestOllamaOptions(unittest.TestCase):
    def test_options_shape(self) -> None:
        extra = quality.ollama_chat_options(
            temperature=0.1, num_ctx=4096, num_predict=512, tier="max"
        )
        self.assertIn("keep_alive", extra)
        self.assertIn("options", extra)
        self.assertEqual(extra["options"]["num_ctx"], 4096)


if __name__ == "__main__":
    unittest.main()
