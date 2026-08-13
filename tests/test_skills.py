from __future__ import annotations

import json
import unittest

import agent
import game_ops
import skills
import turbo


class TestCatalog(unittest.TestCase):
    def test_check_is_clean(self) -> None:
        r = skills.check()
        self.assertTrue(r["ok"], r.get("errors"))
        self.assertGreaterEqual(r["n"], 20)

    def test_unique_names(self) -> None:
        names = [s["name"] for s in skills.catalog()]
        self.assertEqual(len(names), len(set(names)))

    def test_covers_agent_tools(self) -> None:
        names = {s["name"] for s in skills.catalog()}
        missing = [t for t in skills.AGENT_TOOLS if t not in names]
        self.assertEqual(missing, [])

    def test_covers_game_ops(self) -> None:
        names = {s["name"] for s in skills.catalog()}
        missing = [t for t in game_ops.OP_TYPES if t not in names]
        self.assertEqual(missing, [])

    def test_dump_schema(self) -> None:
        data = skills.dump()
        self.assertEqual(data["schema_version"], 1)
        self.assertTrue(data["capabilities"])
        raw = json.dumps(data)
        self.assertIn("set_feel", raw)


class TestRoute(unittest.TestCase):
    def test_juice_the_jump_acts(self) -> None:
        r = skills.route("juice the jump")
        self.assertEqual(r["decision"], "act", r)
        self.assertIn(r["skill"]["name"], ("set_feel", "craft"))

    def test_add_a_room_acts(self) -> None:
        r = skills.route("add a room")
        self.assertEqual(r["decision"], "act", r)
        self.assertEqual(r["skill"]["name"], "add_room")

    def test_verify_slice_acts(self) -> None:
        r = skills.route("verify this slice")
        self.assertEqual(r["decision"], "act", r)
        self.assertEqual(r["skill"]["name"], "verify")

    def test_change_palette_hits_palette(self) -> None:
        r = skills.route("change the color palette")
        self.assertIn(r["decision"], ("act", "choose"), r)
        names = [h["name"] for h in r.get("hits") or []]
        if r["decision"] == "act":
            names = [r["skill"]["name"]]
        self.assertTrue(any("palette" in n for n in names), r)

    def test_swallow_abstains(self) -> None:
        r = skills.route("airspeed velocity of an unladen swallow")
        self.assertEqual(r["decision"], "abstain", r)

    def test_sky_blue_abstains(self) -> None:
        r = skills.route("why is the sky blue")
        self.assertEqual(r["decision"], "abstain", r)

    def test_counter_traders_abstains(self) -> None:
        r = skills.route("counter traders")
        self.assertEqual(r["decision"], "abstain", r)

    def test_empty_abstains(self) -> None:
        r = skills.route("   ")
        self.assertEqual(r["decision"], "abstain")

    def test_suggest_ranks_feel_first(self) -> None:
        hits = skills.suggest("juice the jump", k=5)
        self.assertTrue(hits)
        self.assertIn(hits[0]["name"], ("set_feel", "craft"))

    def test_card_unknown_offers_hits(self) -> None:
        c = skills.card("teleport_moon")
        self.assertFalse(c["ok"])
        self.assertIn("hits", c)


class TestAgentFace(unittest.TestCase):
    def test_run_skills_route(self) -> None:
        out = skills.run_skills("route", {"task": "juice the jump"})
        self.assertIn("act", out)
        self.assertTrue("set_feel" in out or "craft" in out)

    def test_run_skills_abstain(self) -> None:
        out = skills.run_skills("route", {"task": "airspeed velocity of an unladen swallow"})
        self.assertIn("abstain", out)

    def test_run_skills_needs_task(self) -> None:
        out = skills.run_skills("suggest", {})
        self.assertTrue(out.startswith("ERROR"))

    def test_agent_parses_skills_tool(self) -> None:
        text = "tool call skills\naction: route\ntask: juice the jump\n"
        tools = agent.parse_tools(text)
        self.assertEqual(tools[0][0], "skills")
        self.assertEqual(tools[0][1].get("action"), "route")
        self.assertEqual(tools[0][1].get("task"), "juice the jump")

    def test_agent_run_tool_skills(self) -> None:
        import tempfile
        from pathlib import Path

        with tempfile.TemporaryDirectory() as raw:
            out = agent.run_tool(
                Path(raw),
                "skills",
                {"action": "route", "task": "add a room"},
            )
        self.assertIn("add_room", out)

    def test_unknown_tool_hints(self) -> None:
        import tempfile
        from pathlib import Path

        with tempfile.TemporaryDirectory() as raw:
            out = agent.run_tool(Path(raw), "teleport", {})
        self.assertIn("unknown tool", out)

    def test_prompt_block_mentions_decision(self) -> None:
        block = skills.prompt_block("juice the jump")
        self.assertIn("ROUTE:", block)
        self.assertIn("act", block)


class TestHttp(unittest.TestCase):
    def test_get_list(self) -> None:
        code, data = skills.handle_http("GET", "/api/skills", {})
        self.assertEqual(code, 200)
        self.assertTrue(data["ok"])
        self.assertGreaterEqual(len(data["capabilities"]), 20)

    def test_post_route(self) -> None:
        code, data = skills.handle_http(
            "POST", "/api/skills/route", {"task": "juice the jump"}
        )
        self.assertEqual(code, 200)
        self.assertEqual(data["decision"], "act")

    def test_post_missing_task(self) -> None:
        code, data = skills.handle_http("POST", "/api/skills/suggest", {})
        self.assertEqual(code, 400)
        self.assertFalse(data["ok"])


class TestTurboPack(unittest.TestCase):
    def test_skills_pack_exists(self) -> None:
        self.assertIn("skills", turbo.PACKS)
        for name in turbo.PACKS["skills"]:
            self.assertTrue((turbo.KNOWLEDGE / name).is_file(), name)

    def test_index_lists_skills(self) -> None:
        index = (turbo.KNOWLEDGE / "INDEX.md").read_text(encoding="utf-8")
        self.assertIn("`skills.md`", index)


if __name__ == "__main__":
    unittest.main()
