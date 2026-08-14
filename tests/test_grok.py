from __future__ import annotations

import json
import tempfile
import unittest
from pathlib import Path

import grok as groklib
import identity as identitylib
import patch as patchlib
import slice as slicelib
import quality


class TestGrokKernel(unittest.TestCase):
    def test_law_is_identity_core(self) -> None:
        self.assertEqual(identitylib.CORE, groklib.LAW)
        self.assertIn("You are **Grok**", groklib.LAW)
        self.assertIn("t=8s", groklib.LAW)
        self.assertIn("HOST", groklib.LAW)
        self.assertIn("HOST SESSION", groklib.LAW)
        self.assertNotIn("Sure! I can help", groklib.LAW)

    def test_session_open_shooter(self) -> None:
        sess = groklib.session_open("futuristic neon shooter drones")
        self.assertEqual(sess["identity"], "grok-4.6-kernel")
        self.assertEqual(sess["genre"], "fps")
        self.assertEqual(sess["loop"], "shoot")
        self.assertIn("shoot", sess["verb"])
        self.assertTrue(sess.get("look"))
        self.assertTrue(sess.get("body"))
        self.assertIn("toy:", sess["novelty"])
        self.assertIn("metres", sess["law"]["units"])
        self.assertEqual(sess["law"]["up"], "Y")
        self.assertIn("green capsule hero", sess["kill"])
        self.assertEqual(sess["taste"]["maxAttackers"], 3)
        self.assertEqual(sess["taste"]["fogEqualsBg"], 1)

    def test_compile_prompt_stamps_grok(self) -> None:
        spec = slicelib.compile_prompt("skill fps neon city")
        self.assertIn("grok", spec)
        self.assertEqual(spec["grok"]["genre"], spec["genre"])
        self.assertEqual(spec["grok"]["look"], spec.get("look"))

    def test_complain_floaty(self) -> None:
        ops = groklib.complain("jump feels floaty")
        self.assertTrue(any(o["op"] == "gravity" and o["amount"] > 1 for o in ops))
        self.assertEqual(groklib.complain("implement ragdoll physics"), [])

    def test_route_feel_skips_llm(self) -> None:
        r = groklib.route("jump feels floaty")
        self.assertEqual(r["kind"], "patch")
        self.assertTrue(r["skip_llm"])

    def test_route_feature_needs_llm(self) -> None:
        r = groklib.route("add a dialogue tree with quest flags")
        self.assertEqual(r["kind"], "llm")
        self.assertFalse(r["skip_llm"])

    def test_route_refuse_engine(self) -> None:
        r = groklib.route("switch to Unity for this slice")
        self.assertEqual(r["kind"], "refuse")
        self.assertTrue(r["skip_llm"])
        self.assertIn("Three.js", r["reason"])

    def test_patch_refuse_does_not_call_rebuild(self) -> None:
        with tempfile.TemporaryDirectory() as raw:
            dest = Path(raw) / "neon-shot"
            dest.mkdir()
            spec = slicelib.compile_prompt("futuristic shooter neon drones")
            slicelib.write_web_slice(dest, spec)
            out = patchlib.try_patch(dest, "port to godot please")
            self.assertIsNotNone(out)
            assert out is not None
            self.assertEqual(out.get("mode"), "refuse")
            self.assertTrue(out.get("ok"))
            self.assertEqual(out.get("written") or [], [])

    def test_persist_and_load(self) -> None:
        with tempfile.TemporaryDirectory() as raw:
            dest = Path(raw) / "pit"
            dest.mkdir()
            spec = slicelib.compile_prompt("neon pit shooter")
            slicelib.write_web_slice(dest, spec)
            loaded = groklib.load(dest)
            self.assertIsNotNone(loaded)
            assert loaded is not None
            self.assertEqual(loaded["genre"], spec["genre"])
            self.assertTrue((dest / ".dotlab" / "grok.json").is_file())

    def test_prefill_and_pack(self) -> None:
        sess = groklib.session_open("neon city runner")
        pack = groklib.pack_for_ollama(sess)
        self.assertIn("You are **Grok**", pack)
        self.assertIn("HOST SESSION", pack)
        self.assertIn(sess["verb"], pack)
        seed = groklib.prefill(sess, role="coder")
        self.assertIn("Host session locked", seed)
        self.assertIn("src/systems", seed)
        director = groklib.prefill(sess, role="director")
        data = json.loads(director)
        ok, errs, _norm = quality.validate_director_json(data)
        self.assertTrue(ok, errs)

    def test_director_seed_valid(self) -> None:
        sess = groklib.session_from_spec(slicelib.compile_prompt("forest platformer"))
        ok, errs, norm = quality.validate_director_json(groklib.director_seed(sess))
        self.assertTrue(ok, errs)
        self.assertEqual(norm["genre"], "platformer")

    def test_decide_next_p0(self) -> None:
        msg = groklib.decide_next(None, verify={"ok": False, "p0_fail": ["look_kit"]})
        self.assertIn("look_kit", msg)
        self.assertIn("Fix P0", msg)

    def test_record_and_harvest_local(self) -> None:
        with tempfile.TemporaryDirectory() as raw:
            dest = Path(raw) / "pit"
            dest.mkdir()
            sess = groklib.session_open("neon pit shooter")
            groklib.persist(dest, sess)
            groklib.record_decision(
                kind="complain",
                instruction="jump feels floaty",
                session=sess,
                decision={"op": "gravity", "amount": 1.15},
                project=dest,
            )
            traces = groklib.load_kernel_traces(dest)
            kinds = {str(t.get("kind")) for t in traces}
            self.assertIn("grok-open", kinds)
            self.assertIn("grok-complain", kinds)
            block = groklib.kernel_block("floaty", project=dest)
            self.assertIn("Kernel traces", block)
            self.assertIn("floaty", block)
            self.assertTrue(any(t.get("instruction") == "jump feels floaty" for t in traces))
            harvested = [
                {
                    "instruction": str(t.get("instruction") or ""),
                    "output": json.dumps(t.get("decision") or {}),
                    "kind": str(t.get("kind") or ""),
                }
                for t in traces
                if t.get("decision")
            ]
            self.assertTrue(any(h["kind"] == "grok-complain" for h in harvested))

    def test_draft_then_max_uses_kernel_seed(self) -> None:
        from unittest import mock

        sess = groklib.session_open("forest platformer")
        seed = groklib.prefill(sess, role="director")
        messages = [
            {"role": "system", "content": "director"},
            {"role": "user", "content": "brief"},
            {"role": "assistant", "content": seed},
            {"role": "user", "content": "refine"},
        ]
        with mock.patch("quality.use_speculative", return_value=False):
            out = quality.draft_then_max(messages, mode="json")
        data = json.loads(out)
        self.assertEqual(data["genre"], "platformer")
        self.assertIn("verb", data)

    def test_attach_prefill(self) -> None:
        sess = groklib.session_open("arena waves")
        msgs = groklib.attach_prefill(
            [{"role": "system", "content": "x"}, {"role": "user", "content": "y"}],
            sess,
            role="coder",
        )
        self.assertEqual(msgs[-2]["role"], "assistant")
        self.assertEqual(msgs[-1]["role"], "user")
        self.assertIn("locked", msgs[-1]["content"].lower())


if __name__ == "__main__":
    unittest.main()
