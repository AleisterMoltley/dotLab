from __future__ import annotations

import json
import tempfile
import unittest
from pathlib import Path

import rlm
import slice as slicelib


class TestDecompose(unittest.TestCase):
    def test_racing_has_five_pillars(self) -> None:
        with tempfile.TemporaryDirectory() as raw:
            dest = Path(raw)
            (dest / ".dotlab").mkdir()
            (dest / ".dotlab" / "slice.json").write_text(
                json.dumps({"genre": "racing", "loop": "race"}), encoding="utf-8"
            )
            plan = rlm.decompose(dest, "ufo racer")
        pillars = {s["pillar"] for s in plan}
        self.assertEqual(pillars, set(rlm.PILLARS))
        ids = [s["id"] for s in plan]
        self.assertIn("rivals", ids)
        self.assertIn("track", ids)

    def test_fps_from_query(self) -> None:
        with tempfile.TemporaryDirectory() as raw:
            plan = rlm.decompose(Path(raw), "neon skill fps")
        self.assertEqual(plan[0]["family"], "fps")
        self.assertIn("wave", [s["id"] for s in plan])


class TestRepl(unittest.TestCase):
    def test_parse_repl_fence(self) -> None:
        text = '```repl\npeek("src/game.js", 1, 40)\nsub("add rivals", files=["src/game.js"])\n```'
        calls = rlm.parse_repl(text)
        names = [n for n, _ in calls]
        self.assertEqual(names, ["peek", "sub"])
        self.assertEqual(calls[0][1]["path"], "src/game.js")
        self.assertEqual(calls[1][1]["task"], "add rivals")
        self.assertEqual(calls[1][1]["files"], "src/game.js")

    def test_parse_final(self) -> None:
        calls = rlm.parse_repl("all good\nFINAL(rivals + 4 gates)\n")
        self.assertEqual(calls[0][0], "done")
        self.assertIn("rivals", calls[0][1]["summary"])

    def test_peek_does_not_leave_project(self) -> None:
        with tempfile.TemporaryDirectory() as raw:
            dest = Path(raw)
            (dest / "src").mkdir()
            (dest / "src" / "game.js").write_text("const X = 1\nconst Y = 2\n", encoding="utf-8")
            out = rlm.peek(dest, "src/game.js", 1, 2)
            self.assertIn("const X", out)
            jail = rlm.peek(dest, "../secret", 1, 10)
            self.assertIn("ERROR", jail)


class TestDepth(unittest.TestCase):
    def test_empty_is_toy(self) -> None:
        with tempfile.TemporaryDirectory() as raw:
            dest = Path(raw)
            (dest / "src").mkdir()
            (dest / "src" / "game.js").write_text("renderer.render(scene, camera)\n", encoding="utf-8")
            (dest / ".dotlab").mkdir()
            (dest / ".dotlab" / "slice.json").write_text(
                json.dumps({"genre": "racing", "loop": "race", "enemyCount": 0, "roomCount": 1}),
                encoding="utf-8",
            )
            r = rlm.depth_report(dest)
        self.assertFalse(r["ok"])
        self.assertTrue(r["fails"])

    def test_rivals_and_gates_pass_race(self) -> None:
        with tempfile.TemporaryDirectory() as raw:
            dest = Path(raw)
            (dest / "src").mkdir()
            (dest / "src" / "game.js").write_text(
                "const rivals = []; const gates = []; function tickRace(){ lap += 1; sfx('hit'); }\n" * 80,
                encoding="utf-8",
            )
            (dest / ".dotlab").mkdir()
            (dest / ".dotlab" / "slice.json").write_text(
                json.dumps(
                    {
                        "genre": "racing",
                        "loop": "race",
                        "enemyCount": 3,
                        "coinCount": 4,
                        "roomCount": 4,
                    }
                ),
                encoding="utf-8",
            )
            r = rlm.depth_report(dest)
        self.assertTrue(r["ok"], r)


class TestSliceCounts(unittest.TestCase):
    def test_no_loop_ships_empty_pressure(self) -> None:
        prompts = (
            "skill fps neon city",
            "forest platformer jumps",
            "endless runner dodge",
            "horror sneak in the dark",
            "village adventure talk to the baker",
            "kart race on a desert track",
            "match-3 puzzle board",
        )
        for prompt in prompts:
            spec = slicelib.compile_prompt(prompt)
            pressure = int(spec["enemyCount"]) + int(spec["coinCount"]) + int(spec["hazardCount"])
            self.assertGreater(pressure, 0, prompt)
            self.assertIn("pillars", spec, prompt)
            self.assertEqual(len(spec["pillars"]), 5, prompt)

    def test_adventure_family(self) -> None:
        with tempfile.TemporaryDirectory() as raw:
            dest = Path(raw)
            plan = rlm.decompose(dest, "village npc quest")
        self.assertEqual(plan[0]["family"], "adventure")
        self.assertEqual({s["pillar"] for s in plan}, set(rlm.PILLARS))


if __name__ == "__main__":
    unittest.main()
