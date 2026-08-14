from __future__ import annotations

import json
import os
import tempfile
import unittest
from pathlib import Path

import agent
import host_floor
import play_gate
import rlm


class TestEvaluateReport(unittest.TestCase):
    def test_skipped_without_report(self) -> None:
        r = play_gate.evaluate_report(None)
        self.assertTrue(r["ok"])
        self.assertTrue(r["skipped"])

    def test_runtime_is_p0(self) -> None:
        r = play_gate.evaluate_report(
            {
                "errors": ["TypeError: x is not a function"],
                "pageErrors": ["boom"],
                "metrics": {"hasCanvas": True, "keys": 4, "clicks": 1, "frames": 40},
                "screenshots": [],
            },
            family="platformer",
        )
        self.assertFalse(r["ok"])
        self.assertIn("runtime", r["p0_fail"])

    def test_no_input_is_p0(self) -> None:
        r = play_gate.evaluate_report(
            {
                "errors": [],
                "pageErrors": [],
                "metrics": {"hasCanvas": True, "keys": 0, "clicks": 0, "frames": 40},
                "screenshots": [],
            }
        )
        self.assertIn("no_input", r["p0_fail"])

    def test_slow_restart_is_p0(self) -> None:
        r = play_gate.evaluate_report(
            {
                "errors": [],
                "pageErrors": [],
                "metrics": {
                    "hasCanvas": True,
                    "keys": 8,
                    "deaths": 2,
                    "medianDeathToRestartMs": 4200,
                    "frames": 50,
                },
                "screenshots": [],
            }
        )
        self.assertIn("slow_restart", r["p0_fail"])

    def test_clean_run_passes(self) -> None:
        r = play_gate.evaluate_report(
            {
                "errors": [],
                "pageErrors": [],
                "metrics": {
                    "hasCanvas": True,
                    "keys": 12,
                    "clicks": 3,
                    "jumps": 4,
                    "frames": 80,
                    "avgFps": 55,
                    "maxDt": 20,
                    "deaths": 1,
                    "medianDeathToRestartMs": 800,
                },
                "screenshots": [],
            },
            family="platformer",
        )
        self.assertTrue(r["ok"])
        self.assertEqual(r["p0_fail"], [])

    def test_actions_for_platformer(self) -> None:
        self.assertIn("jump", play_gate.actions_for("platformer"))
        self.assertIn("click", play_gate.actions_for("fps"))

    def test_pointer_lock_noise_is_not_runtime(self) -> None:
        r = play_gate.evaluate_report(
            {
                "errors": [
                    "WrongDocumentError: The root document of this element is not valid for pointer lock."
                ],
                "pageErrors": [
                    "WrongDocumentError: The root document of this element is not valid for pointer lock."
                ],
                "metrics": {
                    "hasCanvas": True,
                    "keys": 8,
                    "clicks": 4,
                    "frames": 80,
                    "avgFps": 90,
                    "maxDt": 20,
                },
                "screenshots": [],
            },
            family="fps",
        )
        self.assertNotIn("runtime", r["p0_fail"], r["report"])

    def test_screenshot_hitch_not_stutter_when_fps_high(self) -> None:
        r = play_gate.evaluate_report(
            {
                "errors": [],
                "pageErrors": [],
                "metrics": {
                    "hasCanvas": True,
                    "keys": 10,
                    "clicks": 4,
                    "frames": 200,
                    "avgFps": 90,
                    "maxDt": 300,
                },
                "screenshots": [],
            },
            family="fps",
        )
        self.assertNotIn("stutter", r["p0_fail"], r["report"])


class TestHostFixes(unittest.TestCase):
    def test_shorten_gap_and_restart(self) -> None:
        with tempfile.TemporaryDirectory() as td:
            root = Path(td)
            src = root / "src"
            src.mkdir()
            (src / "game.js").write_text(
                "const CONFIG = { moveSpeed: 6 };\n"
                "mesh.position.set(0, 0, 0);\n"
                "mesh.position.set(8, 0, 0);\n"
                "function restart() { player.pos.y = 1; }\n"
                "function die() {}\n",
                encoding="utf-8",
            )
            n = play_gate.shorten_gap(root)
            self.assertEqual(n, "gap-shorter")
            js = (src / "game.js").read_text(encoding="utf-8")
            self.assertIn("position.set(5.60", js)
            r = play_gate.apply_metric_fixes(root, {"p0_fail": ["slow_restart"], "p1_fail": []})
            self.assertTrue(any("restart" in a or "floor" in a for a in r["applied"]))


class TestJailAndPitch(unittest.TestCase):
    def test_jail_off_by_default(self) -> None:
        os.environ.pop("DOTLAB_NOVELTY_JAIL", None)
        ok, _ = host_floor.jail_write_ok("src/game.js", kind="write")
        self.assertTrue(ok)

    def test_jail_blocks_game_write(self) -> None:
        os.environ["DOTLAB_NOVELTY_JAIL"] = "1"
        try:
            ok, err = host_floor.jail_write_ok("src/game.js", kind="write")
            self.assertFalse(ok)
            self.assertIn("systems", err)
            ok2, _ = host_floor.jail_write_ok("src/systems/flag.js", kind="write")
            self.assertTrue(ok2)
            ok3, _ = host_floor.jail_write_ok(
                "src/game.js",
                kind="patch",
                search="import x",
                replace="import { tick } from './systems/flag.js';",
            )
            self.assertTrue(ok3)
        finally:
            os.environ.pop("DOTLAB_NOVELTY_JAIL", None)

    def test_pick_pitch_prefers_verb(self) -> None:
        pitches = [
            "We should add inventory and a shop and a skill tree and a map and a journal and more.",
            "VERB: reach the flag. t=8s first jump. gravity 28 coyote. One novelty. We cut the shop. Fair first death.",
            "maybe a game",
        ]
        pick = host_floor.pick_pitch(pitches)
        self.assertEqual(pick["winner"], 1)
        self.assertFalse(pick["tie"])


class TestAgentJsonAndCompact(unittest.TestCase):
    def test_parse_json_tool(self) -> None:
        tools = agent.parse_tools(
            '{"tool":"apply_patch","path":"src/systems/a.js","search":"x","replace":"y"}'
        )
        self.assertEqual(len(tools), 1)
        self.assertEqual(tools[0][0], "apply_patch")
        self.assertEqual(tools[0][1]["path"], "src/systems/a.js")

    def test_parse_json_fence(self) -> None:
        tools = agent.parse_tools('```json\n{"tool":"done","summary":"shipped"}\n```')
        self.assertEqual(tools[0][0], "done")

    def test_legacy_still_wins(self) -> None:
        text = """```
tool call read_file
path: src/game.js
```"""
        tools = agent.parse_tools(text)
        self.assertEqual(tools[0][0], "read_file")

    def test_compact_read_file(self) -> None:
        body = agent.compact_tool_result(
            "read_file", "[path: src/game.js]\nlines 1-80 / 200\n" + ("x" * 4000)
        )
        self.assertIn("hash=", body)
        self.assertNotIn("xxxx", body)
        msgs = [
            {"role": "system", "content": "sys"},
            {"role": "user", "content": "task"},
            {"role": "assistant", "content": "a1"},
            {"role": "user", "content": "TOOL RESULT [read_file]:\n" + ("z" * 3000)},
            {"role": "assistant", "content": "a2"},
            {"role": "user", "content": "TOOL RESULT [apply_patch]: ok"},
            {"role": "assistant", "content": "a3"},
            {"role": "user", "content": "continue"},
        ]
        slim = agent.compact_messages(msgs, keep_tail=4)
        self.assertEqual(slim[0]["role"], "system")
        self.assertIn("compacted", slim[3]["content"])


class TestRlmSystemsTarget(unittest.TestCase):
    def test_creates_stub(self) -> None:
        with tempfile.TemporaryDirectory() as td:
            root = Path(td)
            rel = rlm._systems_target(root, "add a flag at the last ledge", "src/game.js")
            self.assertTrue(rel.startswith("src/systems/"))
            self.assertTrue((root / rel).is_file())


if __name__ == "__main__":
    unittest.main()
