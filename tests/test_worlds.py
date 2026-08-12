from __future__ import annotations

import tempfile
import unittest
from pathlib import Path

import worlds as wc


PROMPT = "medieval village with snow-capped mountains, a desert, and animals"


class TestIntent(unittest.TestCase):
    def test_extracts_only_stated_biomes(self) -> None:
        intent = wc.extract_intent_heuristic(PROMPT)
        self.assertIn("village", intent["mentioned_terrain"])
        self.assertIn("snow", intent["mentioned_terrain"])
        self.assertIn("desert", intent["mentioned_terrain"])
        self.assertNotIn("canyon", intent["mentioned_terrain"])
        self.assertEqual(intent["style"], "medieval")
        self.assertIn("animal", intent["mentioned_objects"])

    def test_empty_prompt_invents_nothing(self) -> None:
        intent = wc.extract_intent_heuristic("a quiet place")
        self.assertEqual(intent["mentioned_terrain"], [])
        self.assertEqual(intent["style"], "")


class TestPlanAndTerrain(unittest.TestCase):
    def test_heuristic_spec_has_paper_fields(self) -> None:
        intent = wc.extract_intent_heuristic(PROMPT)
        spec = wc.complete_spec_heuristic(PROMPT, intent)
        wc._normalize_spec(spec)
        self.assertGreaterEqual(len(spec["regions"]), 3)
        self.assertIn("terrain", spec)
        self.assertIn("objects", spec)
        self.assertTrue(spec["terrain"]["assets"])
        high = [r for r in spec["regions"] if r["detail_level"] == "high"]
        self.assertTrue(high)
        self.assertTrue(high[0]["objects"])

    def test_layout_is_a_partition(self) -> None:
        intent = wc.extract_intent_heuristic(PROMPT)
        spec = wc.complete_spec_heuristic(PROMPT, intent)
        wc._normalize_spec(spec)
        layout = wc.build_layout_map(spec, n=32)
        self.assertEqual(len(layout["cells"]), 32 * 32)
        ids = {r["id"] for r in spec["regions"]}
        self.assertTrue(set(layout["cells"]) <= ids)
        self.assertTrue(set(layout["legend"]) <= ids)

    def test_heightfield_eq6_size(self) -> None:
        intent = wc.extract_intent_heuristic(PROMPT)
        spec = wc.complete_spec_heuristic(PROMPT, intent)
        wc._normalize_spec(spec)
        layout = wc.build_layout_map(spec, n=32)
        hf = wc.build_heightfield(spec, layout, seed=1)
        self.assertEqual(len(hf["heights"]), 32 * 32)
        self.assertEqual(len(hf["layout"]), 32 * 32)
        self.assertTrue(any(h > 5 for h in hf["heights"]))

    def test_heightfield_deterministic(self) -> None:
        intent = wc.extract_intent_heuristic(PROMPT)
        spec = wc.complete_spec_heuristic(PROMPT, intent)
        wc._normalize_spec(spec)
        layout = wc.build_layout_map(spec, n=16)
        a = wc.build_heightfield(spec, layout, seed=7)
        b = wc.build_heightfield(spec, layout, seed=7)
        self.assertEqual(a["heights"], b["heights"])


class TestRegionAndContact(unittest.TestCase):
    def test_water_scatter_skipped(self) -> None:
        spec = {
            "world_scale": 64,
            "regions": [
                {
                    "id": "water",
                    "terrain_type": "water",
                    "center": {"x": 0.5, "z": 0.5},
                    "radius": 0.6,
                    "base_elevation": -3,
                    "landform": "flat",
                    "material": {"color": "#246"},
                    "layout_color": "#246",
                    "noise": [],
                    "detail_level": "low",
                    "objects": [],
                }
            ],
            "terrain": {"assets": [{"category": "rock", "density": "high", "affinity": []}], "blend_passes": 1},
        }
        wc._normalize_spec(spec)
        layout = wc.build_layout_map(spec, n=16)
        hf = wc.build_heightfield(spec, layout, seed=2)
        scatter = wc.scatter_terrain_assets(spec, hf, seed=2)
        self.assertEqual(scatter, [])

    def test_contact_detects_float_and_seats(self) -> None:
        spec = {
            "world_scale": 64,
            "regions": [
                {
                    "id": "plain",
                    "terrain_type": "plain",
                    "center": {"x": 0.5, "z": 0.5},
                    "radius": 0.5,
                    "base_elevation": 2,
                    "landform": "flat",
                    "material": {"color": "#3a3"},
                    "layout_color": "#3a3",
                    "noise": [],
                    "detail_level": "high",
                    "objects": [],
                }
            ],
        }
        wc._normalize_spec(spec)
        layout = wc.build_layout_map(spec, n=16)
        hf = wc.build_heightfield(spec, layout, seed=3)
        floating = {
            "id": "obj_0",
            "kind": "regional_object",
            "size": [2, 4, 2],
            "scale": 1,
            "position": {"x": 0, "y": 40, "z": 0},
        }
        issues = wc.detect_contact_issues([floating], spec, hf)
        self.assertEqual(issues[0]["type"], "floating")
        wc.seat_instance(floating, spec, hf)
        self.assertEqual(wc.detect_contact_issues([floating], spec, hf), [])

    def test_r_plus_skips_water_and_low(self) -> None:
        spec = {
            "regions": [
                {"id": "w", "terrain_type": "water", "detail_level": "high", "objects": [{"category": "house"}]},
                {"id": "m", "terrain_type": "mountain", "detail_level": "low", "objects": [{"category": "house"}]},
                {"id": "v", "terrain_type": "plain", "detail_level": "high", "objects": [{"category": "house"}]},
            ]
        }
        chosen = wc.select_detail_regions(spec, {"heights": [0], "grid_size": 1})
        self.assertEqual([r["id"] for r in chosen], ["v"])


class TestPipelineOffline(unittest.TestCase):
    def test_offline_generate_emits_compose(self) -> None:
        with tempfile.TemporaryDirectory() as raw:
            dest = Path(raw) / "wilds"
            dest.mkdir()
            out = wc.pipeline(dest, PROMPT, model=None, seed=4, refine=True, name="Wilds")
            self.assertGreaterEqual(len(out["spec"]["regions"]), 3)
            pub = dest / "public" / "world"
            for name in ("spec.json", "layout.json", "heightfield.json", "instances.json", "meta.json"):
                self.assertTrue((pub / name).is_file(), name)
            self.assertTrue((dest / "src" / "world" / "terrain.js").is_file())
            kinds = {i["kind"] for i in out["instances"]}
            self.assertIn("regional_object", kinds)

    def test_mesh_disabled_is_none(self) -> None:
        self.assertIsNone(wc.fetch_mesh("rock", {}))
        self.assertIsNone(wc.fetch_mesh("rock", {"mesh": {"enabled": True, "endpoint": ""}}))


if __name__ == "__main__":
    unittest.main()
