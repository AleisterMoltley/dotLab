from __future__ import annotations

import json
import tempfile
import unittest
from pathlib import Path
from unittest import mock

import host_floor
import intervene
import lora_ops
import quality
import rag
import turbo


class TestFeelMerge(unittest.TestCase):
    def test_platformer_overrides_shared(self) -> None:
        t = host_floor.feel_table("platformer")
        self.assertEqual(t["gravity"], 28)
        self.assertEqual(t["coyoteMs"], 110)
        self.assertIn("accel", t)

    def test_slop_ones_replaced(self) -> None:
        merged = host_floor.merge_feel("fps", {"gravity": 1, "moveSpeed": 1, "jumpForce": 8.0})
        self.assertGreater(merged["gravity"], 8)
        self.assertGreater(merged["moveSpeed"], 2)
        self.assertEqual(merged["jumpForce"], 8.0)

    def test_apply_injects_config_keys(self) -> None:
        with tempfile.TemporaryDirectory() as td:
            root = Path(td)
            src = root / "src"
            src.mkdir()
            (src / "game.js").write_text(
                "const CONFIG = {\n  moveSpeed: 6.2,\n};\nfunction die() {}\n"
                "player.pos.y += player.vy * dt;\n",
                encoding="utf-8",
            )
            meta = root / ".dotlab"
            meta.mkdir()
            (meta / "slice.json").write_text(
                json.dumps({"genre": "platformer", "loop": "jump", "feel": {"gravity": 1}}),
                encoding="utf-8",
            )
            out = host_floor.apply(root)
            self.assertTrue(out["ok"])
            js = (src / "game.js").read_text(encoding="utf-8")
            self.assertIn("coyoteMs", js)
            self.assertIn("pos.y < -24", js)
            spec = json.loads((meta / "slice.json").read_text(encoding="utf-8"))
            self.assertGreater(float(spec["feel"]["gravity"]), 8)


class TestRestoreKits(unittest.TestCase):
    def test_restore_recopies_punch(self) -> None:
        import scaffold

        with tempfile.TemporaryDirectory() as td:
            dest = Path(td) / "pit"
            dest.mkdir()
            scaffold.scaffold_web_game(dest, "Kit Pit", "fps", prompt="neon fps")
            punch = dest / "src" / "craft" / "punch.js"
            self.assertTrue(punch.is_file())
            punch.write_text("// slop\n", encoding="utf-8")
            out = host_floor.restore_kits(dest)
            self.assertTrue(any("craft" in a for a in out))
            self.assertIn("export function punch", punch.read_text(encoding="utf-8"))

    def test_restitch_when_applyLook_deleted(self) -> None:
        import scaffold
        import verify

        with tempfile.TemporaryDirectory() as td:
            dest = Path(td) / "pit"
            dest.mkdir()
            scaffold.scaffold_web_game(dest, "Slop Pit", "fps", prompt="neon fps")
            game = dest / "src" / "game.js"
            game.write_text(
                "import * as THREE from 'three';\n"
                "const renderer = new THREE.WebGLRenderer();\n"
                "new THREE.HemisphereLight(0xffffff, 0x000000, 1);\n"
                "new THREE.CapsuleGeometry(0.4, 1, 4, 8);\n",
                encoding="utf-8",
            )
            out = host_floor.restitch_if_kits_broken(dest)
            self.assertTrue(any("restitch" in a for a in out), out)
            js = game.read_text(encoding="utf-8")
            self.assertIn("applyLook", js)
            self.assertIn("makePlayer", js)
            self.assertNotIn("HemisphereLight", js)
            r = verify.evaluate(dest)
            self.assertEqual(r["p0_fail"], [], r["report"])


class TestFewshotAndRepair(unittest.TestCase):
    def test_fewshot_has_patch_grammar(self) -> None:
        block = host_floor.fewshot_block("tighten coyote jump")
        self.assertIn("@@ search", block)
        self.assertIn("coyoteMs", block)

    def test_filter_drops_inventory_when_p0(self) -> None:
        vr = {"ok": False, "p0_fail": ["silence_on_hit"], "failed": ["silence_on_hit"], "report": "NO"}
        out = host_floor.filter_must_fix(
            ["Add an inventory screen", "Wire hitstop on shoot"], vr
        )
        self.assertTrue(any("silence_on_hit" in x for x in out))
        self.assertFalse(any("inventory" in x.lower() for x in out))

    def test_filter_keeps_code_when_green(self) -> None:
        out = host_floor.filter_must_fix(["Wire restart on pit death now"], {"ok": True, "p0_fail": []})
        self.assertEqual(len(out), 1)

    def test_repair_task_is_verify_only(self) -> None:
        t = host_floor.repair_task(
            {"p0_fail": ["coyote"], "report": "VERIFY score=40\n  [NO] P0 coyote"}
        )
        self.assertIn("VERIFY GATE", t)
        self.assertIn("coyote", t)
        self.assertNotIn("inventory", t)

    def test_slim_console_caps_and_prefers_errors(self) -> None:
        lines = [f"info {i}" for i in range(40)] + ["TypeError: x is not a function"]
        out = host_floor.slim_console("\n".join(lines), n=20)
        self.assertIn("TypeError", out)
        self.assertLessEqual(len(out.splitlines()), 20)


class TestFuzzyPatch(unittest.TestCase):
    def test_find_exact(self) -> None:
        span = quality.find_search_span("const a = 1\nconst b = 2\n", "const a = 1")
        self.assertIsNotNone(span)
        self.assertEqual(span[2], "exact")

    def test_find_line_stripped(self) -> None:
        text = "  gravity: 12,\n  jumpForce: 8,\n"
        search = "gravity: 12,\njumpForce: 8,"
        span = quality.find_search_span(text, search)
        self.assertIsNotNone(span)
        self.assertEqual(span[2], "fuzzy")

    def test_apply_fuzzy(self) -> None:
        with tempfile.TemporaryDirectory() as td:
            root = Path(td)
            f = root / "src" / "game.js"
            f.parent.mkdir(parents=True)
            f.write_text("function tick() {\n  gravity: 12,\n}\n", encoding="utf-8")
            res = quality.apply_search_replace(
                root, "src/game.js", "gravity: 12,", "gravity: 28,"
            )
            self.assertTrue(res.get("ok"), res)
            self.assertIn("28", f.read_text(encoding="utf-8"))


class TestTurboLocal(unittest.TestCase):
    def test_ctx_roles(self) -> None:
        self.assertEqual(turbo.ROLE_CTX["director"], 8192)
        self.assertEqual(turbo.ROLE_CTX["coder"], 16384)
        self.assertLess(turbo.ctx_for_role("critic"), turbo.ctx_for_role("rlm"))

    def test_skip_core_omits_identity(self) -> None:
        slim = turbo.select_knowledge("third person village combat", max_chars=8000, skip_core=True)
        fat = turbo.select_knowledge("third person village combat", max_chars=8000, skip_core=False)
        self.assertIn("identity.md", fat)
        self.assertNotIn("identity.md", slim)

    def test_flash_candidates_prefer_14b(self) -> None:
        with mock.patch("models_catalog.total_ram_gb", return_value=32.0):
            c = turbo._flash_candidates()
        self.assertEqual(c[0], "qwen2.5-coder:14b")
        self.assertIn("qwen2.5-coder:7b", c)
        self.assertLess(c.index("qwen2.5-coder:14b"), c.index("qwen2.5-coder:7b"))


class TestRagP0(unittest.TestCase):
    def test_failing_fixture_not_indexed(self) -> None:
        root = Path(__file__).resolve().parent / "fixtures" / "slice-fail"
        if not root.is_dir():
            self.skipTest("no fail fixture")
        chunks = rag.index_project(root)
        self.assertEqual(chunks, [])


class TestLoraGate(unittest.TestCase):
    def test_stats_not_ready_below_200(self) -> None:
        s = lora_ops.stats()
        self.assertIn("ready", s)
        self.assertEqual(s["min_pairs"], 200)
        if s["count"] < 200:
            self.assertFalse(s["ready"])


class TestInterveneFlash(unittest.TestCase):
    def test_detect_base_prefers_14b_when_ram(self) -> None:
        listing = "qwen3-coder:30b\nqwen2.5-coder:14b\nqwen2.5-coder:7b\n"
        with mock.patch.object(intervene, "run", return_value=(0, listing)):
            with mock.patch.object(intervene, "mem_gb", return_value=32):
                b = intervene.detect_base()
        self.assertEqual(b["flash_base"], "qwen2.5-coder:14b")


if __name__ == "__main__":
    unittest.main()
