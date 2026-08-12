#!/usr/bin/env python3
"""
Gamemaster WorldClaw — local Three.js port of Tencent Hunyuan WorldClaw.

Paper (arXiv:2608.05248, project: tencent-hunyuan.github.io/Hunyuan3D-WorldClaw):

    P = F_plan(q)                 # intent analysis + scene planning
    T = F_terrain(P)              # layout map + height field + scatter
    O = F_region(P, T)            # regional plan + place + contact refine
    S = Compose(T, O)

Local adaptation (no Blender / SAM3 / GPT-Image / H20):
  - Intent + plan: Ollama when available, heuristic otherwise.
  - Terrain: semantic layout partition + Eq. 6 height field (stdlib).
  - Scatter: code-native prototypes (paper: scatter via 3D coding).
  - Regional objects: procedural placeholders; optional HTTP mesh endpoint.
  - Refinement: geometric contact + object–terrain co-seat (no render MCP).

Do not store API keys. Copy config/worldclaw.example.json → worldclaw.json.
"""
from __future__ import annotations

import argparse
import hashlib
import json
import math
import os
import random
import re
import sys
import time
import urllib.error
import urllib.request
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

from cloud import active_provider, chat as llm_chat
from gmcommon import DEFAULT_MODEL, OLLAMA, ROOT, ollama_up as gm_ollama_up

CONFIG_PATH = ROOT / "config" / "worldclaw.json"
EXAMPLE_CONFIG = ROOT / "config" / "worldclaw.example.json"
GRID = 128

# Paper §2.2.3 geomorphic operators G_r,j
GEOMORPH = {
    "peak": lambda nx, nz, t: math.exp(-((nx**2 + nz**2) / 0.08)) * 25,
    "dune": lambda nx, nz, t: math.sin(nx * 8 + t) * math.cos(nz * 6 + t * 0.7) * 6,
    "terrace": lambda nx, nz, t: math.floor(nx * 5) * 2 + math.floor(nz * 5) * 1.5,
    "erosion": lambda nx, nz, t: -abs(math.sin(nx * 12)) * 4 - abs(math.cos(nz * 10)) * 3,
    "flat": lambda nx, nz, t: 0.0,
    "cliff": lambda nx, nz, t: max(0.0, nx * 15 - 5),
}

# Prompt lexicon → terrain types (intent extracts; plan completes)
BIOME_LEX: list[tuple[str, tuple[str, ...]]] = [
    ("snow", ("snow", "arctic", "glacier", "tundra", "winter", "ice")),
    ("desert", ("desert", "dune", "sand", "arid")),
    ("water", ("water", "lake", "river", "ocean", "sea", "coast")),
    ("canyon", ("canyon", "gorge", "ravine")),
    ("coast", ("coast", "island", "beach", "shore", "pirate")),
    ("forest", ("forest", "pine", "woods", "jungle", "tropical")),
    ("mountain", ("mountain", "peak", "ridge", "alps")),
    ("village", ("village", "town", "settlement", "hamlet", "medieval")),
    ("plain", ("plain", "grass", "meadow", "field", "battlefield")),
]

REGION_DEFAULTS = {
    "snow": {"terrain_type": "snow", "landform": "peak", "base_elevation": 22, "layout_color": "#e8eef5", "material": {"color": "#d9e4ef", "roughness": 0.85}, "detail_level": "low"},
    "desert": {"terrain_type": "desert", "landform": "dune", "base_elevation": 4, "layout_color": "#c4a574", "material": {"color": "#c4a574", "roughness": 0.95}, "detail_level": "medium"},
    "water": {"terrain_type": "water", "landform": "flat", "base_elevation": -2, "layout_color": "#3a6d8c", "material": {"color": "#2a5a78", "roughness": 0.2}, "detail_level": "low"},
    "canyon": {"terrain_type": "canyon", "landform": "erosion", "base_elevation": 6, "layout_color": "#8a5a3a", "material": {"color": "#8a5a3a", "roughness": 0.92}, "detail_level": "medium"},
    "coast": {"terrain_type": "coast", "landform": "flat", "base_elevation": 1.2, "layout_color": "#c2b280", "material": {"color": "#c2b280", "roughness": 0.9}, "detail_level": "high"},
    "forest": {"terrain_type": "forest", "landform": "flat", "base_elevation": 5, "layout_color": "#2f5d3a", "material": {"color": "#2f5d3a", "roughness": 0.94}, "detail_level": "medium"},
    "mountain": {"terrain_type": "mountain", "landform": "peak", "base_elevation": 28, "layout_color": "#6b7280", "material": {"color": "#6b7280", "roughness": 0.9}, "detail_level": "low"},
    "village": {"terrain_type": "plain", "landform": "flat", "base_elevation": 3, "layout_color": "#5a7a45", "material": {"color": "#4a6b38", "roughness": 0.92}, "detail_level": "high"},
    "plain": {"terrain_type": "plain", "landform": "flat", "base_elevation": 2, "layout_color": "#4d7a3e", "material": {"color": "#3d6a32", "roughness": 0.93}, "detail_level": "low"},
}

PROCEDURAL_SHAPES = {
    "house": {"geometry": "box", "size": [6, 4, 7], "color": "#8b7355"},
    "building": {"geometry": "box", "size": [8, 10, 8], "color": "#6b7280"},
    "tower": {"geometry": "cylinder", "size": [2.2, 14, 2.2], "color": "#78716c"},
    "tree": {"geometry": "cone", "size": [2.2, 8, 2.2], "color": "#166534"},
    "pine": {"geometry": "cone", "size": [1.6, 9, 1.6], "color": "#14532d"},
    "rock": {"geometry": "dodecahedron", "size": [1.4, 1.4, 1.4], "color": "#57534e"},
    "bush": {"geometry": "sphere", "size": [1.6, 1.1, 1.6], "color": "#15803d"},
    "vehicle": {"geometry": "box", "size": [3.2, 1.6, 5.5], "color": "#44403c"},
    "dock": {"geometry": "box", "size": [10, 0.45, 3.2], "color": "#92400e"},
    "ship": {"geometry": "box", "size": [4, 2.4, 12], "color": "#5b3a1a"},
    "animal": {"geometry": "capsule", "size": [0.7, 1.1, 1.4], "color": "#a16207"},
    "facility": {"geometry": "box", "size": [10, 6, 10], "color": "#4b5563"},
    "default": {"geometry": "box", "size": [2, 2, 2], "color": "#64748b"},
}

INTENT_SYSTEM = """You are the WorldClaw INTENT ANALYSIS agent (paper §2.1).
Extract ONLY constraints the user stated. Do not invent biomes, objects, or style.
Reply with one JSON object:
{"theme":"","style":"","atmosphere":"","season":"","mentioned_terrain":[],"mentioned_objects":[],"spatial":"","explicit":[]}
Empty strings / empty lists when not stated. No prose."""

PLAN_SYSTEM = """You are the WorldClaw SCENE PLANNING agent (paper §2.1).
Complete a full scene specification P = {regions, terrain, objects} from the prompt + intent.
Intent listed what the user said; you may complete missing attributes downstream needs.
Rules:
- 3–6 regions. Distinct terrain_type. center/radius in 0–1. layout_color hex.
- terrain = {assets:[{category,density,affinity}], materials note}.
- objects = {categories, densities, relations} plus per-region objects[] on detail_level high.
- landform in peak|dune|terrace|erosion|flat|cliff. world_scale 128–512.
- Do not drop explicit user constraints.
Reply with one ```json block. English keys only."""

REFINE_SYSTEM = """You are the WorldClaw object-refinement agent (paper §2.3.3).
Return JSON adjustments only:
{"instances":[{"id":"...","position":{"x":0,"y":0,"z":0},"rotation_y":0,"scale":1}],"notes":""}
Fix floating (lower y), penetration (raise y), wrong scale, bad facing.
Only include instances that change."""


def ollama_up() -> bool:
    return gm_ollama_up()


def llm_ready() -> bool:
    return bool(active_provider()) or ollama_up()


def chat(messages: list[dict], model: str, temperature: float = 0.25) -> str:
    return llm_chat(
        messages,
        model=model,
        temperature=temperature,
        num_predict=int(os.environ.get("GAMEMASTER_PREDICT", "4096")),
    )


def extract_json_block(text: str) -> dict:
    m = re.search(r"```(?:json)?\s*([\s\S]*?)```", text)
    raw = m.group(1).strip() if m else text.strip()
    start, end = raw.find("{"), raw.rfind("}")
    if start >= 0 and end > start:
        raw = raw[start : end + 1]
    return json.loads(raw)


def load_config() -> dict:
    if CONFIG_PATH.exists():
        return json.loads(CONFIG_PATH.read_text(encoding="utf-8"))
    if EXAMPLE_CONFIG.exists():
        return json.loads(EXAMPLE_CONFIG.read_text(encoding="utf-8"))
    return {}


def banner(msg: str) -> None:
    print(f"\n{'=' * 60}\n  {msg}\n{'=' * 60}")


# --- Stage 1: F_plan(q) = intent + scene plan ---

def extract_intent_heuristic(prompt: str) -> dict:
    """Paper: summarize only what the prompt contains. No invented regions."""
    p = prompt.lower()
    terrain = []
    for key, words in BIOME_LEX:
        if any(w in p for w in words) and key not in terrain:
            terrain.append(key)
    objects: list[str] = []
    pairs = (
        (("village", "town", "settlement", "house"), "house"),
        (("animal", "wildlife", "populated"), "animal"),
        (("dock", "pier"), "dock"),
        (("ship", "pirate", "boat"), "ship"),
        (("tree", "forest", "pine", "jungle"), "tree"),
        (("rock", "canyon", "mountain"), "rock"),
        (("vehicle", "tank", "truck", "battlefield"), "vehicle"),
        (("tower", "facility", "radar", "futuristic"), "facility"),
    )
    for words, cat in pairs:
        if any(w in p for w in words) and cat not in objects:
            objects.append(cat)
    style = ""
    for s in ("medieval", "futuristic", "tribal", "pirate", "arctic", "desert"):
        if s in p:
            style = s
            break
    season = ""
    for s in ("spring", "summer", "autumn", "winter"):
        if s in p:
            season = s
            break
    if "snow" in p or "arctic" in p:
        season = season or "winter"
    return {
        "theme": prompt.strip()[:160],
        "style": style,
        "atmosphere": "",
        "season": season,
        "mentioned_terrain": terrain,
        "mentioned_objects": objects,
        "spatial": "",
        "explicit": [w for w in (*terrain, *objects, style) if w],
    }


def _place_seeds(keys: list[str]) -> list[dict]:
    """Non-overlapping region centers (coverage-aware ring)."""
    n = max(1, len(keys))
    seeds = []
    if n == 1:
        return [{"id": keys[0], "center": {"x": 0.5, "z": 0.5}, "radius": 0.42, "coverage": 1.0}]
    for i, key in enumerate(keys):
        ang = (i / n) * math.tau - math.pi / 2
        r = 0.28
        seeds.append(
            {
                "id": f"{key}-{i+1}" if keys.count(key) > 1 else key,
                "kind": key,
                "center": {"x": round(0.5 + math.cos(ang) * r, 3), "z": round(0.5 + math.sin(ang) * r, 3)},
                "radius": 0.26,
                "coverage": round(1 / n, 3),
            }
        )
    return seeds


def complete_spec_heuristic(prompt: str, intent: dict) -> dict:
    """Scene planning: fill P = (R, C_terrain, C_object) from intent."""
    keys = list(intent.get("mentioned_terrain") or [])
    if "village" in (intent.get("mentioned_objects") or []) and "village" not in keys:
        keys.insert(0, "village")
    if not keys:
        keys = ["village", "forest", "plain"]
    if len(keys) == 1:
        keys = keys + ["plain", "forest"]
    keys = keys[:6]
    style = intent.get("style") or "natural"
    objects_wanted = list(intent.get("mentioned_objects") or [])
    if "village" in keys and "house" not in objects_wanted:
        objects_wanted.append("house")
    seeds = _place_seeds(keys)
    regions = []
    for seed in seeds:
        kind = seed.get("kind", seed["id"].split("-")[0])
        base = dict(REGION_DEFAULTS.get(kind, REGION_DEFAULTS["plain"]))
        region = {
            "id": seed["id"],
            "name": kind.replace("-", " ").title(),
            "terrain_type": base["terrain_type"],
            "layout_color": base["layout_color"],
            "coverage": seed["coverage"],
            "center": seed["center"],
            "radius": seed["radius"],
            "base_elevation": base["base_elevation"],
            "landform": base["landform"],
            "material": dict(base["material"]),
            "noise": [{"frequency": 0.025, "amplitude": 5, "weight": 1.0}],
            "detail_level": base["detail_level"],
            "objects": [],
        }
        if region["detail_level"] == "high":
            for cat in objects_wanted:
                count = 8 if cat == "house" else (12 if cat in ("tree", "animal") else 4)
                relation = "cluster" if cat in ("house", "facility", "building") else "scatter"
                if cat in ("dock", "ship"):
                    relation = "waterfront"
                region["objects"].append(
                    {"category": cat, "count": count, "style": style, "relation": relation}
                )
            if not region["objects"]:
                region["objects"] = [
                    {"category": "house", "count": 6, "style": style, "relation": "cluster"}
                ]
        regions.append(region)
    scatter = []
    for cat, dens, aff in (
        ("rock", "medium", ["mountain", "canyon", "desert", "snow"]),
        ("pine", "medium", ["forest", "mountain", "snow"]),
        ("bush", "low", ["plain", "forest", "village", "coast"]),
    ):
        scatter.append({"category": cat, "density": dens, "affinity": aff})
    return {
        "theme": intent.get("theme") or prompt[:80],
        "style": style,
        "atmosphere": intent.get("atmosphere") or "",
        "season": intent.get("season") or "",
        "world_scale": 256,
        "regions": regions,
        "terrain": {"assets": scatter, "blend_passes": 4},
        "objects": {
            "categories": objects_wanted,
            "relations": "cluster settlements; scatter flora/fauna; waterfront docks",
        },
        "terrain_scatter": scatter,
    }


def stage_intent(prompt: str, model: str | None) -> dict:
    banner("🧭 STAGE 1a — Intent Analysis  F_plan")
    if model:
        try:
            out = chat(
                [
                    {"role": "system", "content": INTENT_SYSTEM},
                    {"role": "user", "content": prompt},
                ],
                model,
                temperature=0.05,
            )
            intent = extract_json_block(out)
            print(f"  ✓ LLM intent · terrain={intent.get('mentioned_terrain')}")
            return intent
        except Exception as e:
            print(f"  ⚠ intent LLM failed ({e}); heuristic")
    intent = extract_intent_heuristic(prompt)
    print(f"  ✓ heuristic intent · terrain={intent.get('mentioned_terrain')}")
    return intent


def stage_scene_plan(prompt: str, intent: dict, model: str | None) -> dict:
    banner("🗺️  STAGE 1b — Scene Planning  P = (R, C_terrain, C_object)")
    spec = complete_spec_heuristic(prompt, intent)
    if model:
        try:
            out = chat(
                [
                    {"role": "system", "content": PLAN_SYSTEM},
                    {
                        "role": "user",
                        "content": json.dumps({"prompt": prompt, "intent": intent, "schema_hint": spec}, indent=2)[:14000],
                    },
                ],
                model,
                temperature=0.2,
            )
            llm = extract_json_block(out)
            if llm.get("regions"):
                spec.update({k: llm[k] for k in llm if k != "regions"})
                spec["regions"] = llm["regions"]
                print(f"  ✓ LLM plan · {len(spec['regions'])} regions")
                _normalize_spec(spec)
                return spec
        except Exception as e:
            print(f"  ⚠ plan LLM failed ({e}); heuristic spec")
    print(f"  ✓ heuristic plan · {len(spec['regions'])} regions")
    _normalize_spec(spec)
    return spec


def _normalize_spec(spec: dict) -> None:
    spec.setdefault("world_scale", 256)
    spec.setdefault("theme", "open world")
    spec.setdefault("terrain_scatter", spec.get("terrain", {}).get("assets") or [{"category": "rock", "density": "medium", "affinity": []}])
    spec.setdefault("terrain", {"assets": spec["terrain_scatter"], "blend_passes": 4})
    spec.setdefault("objects", {"categories": [], "relations": ""})
    for r in spec.get("regions") or []:
        r.setdefault("center", {"x": 0.5, "z": 0.5})
        r.setdefault("radius", 0.25)
        r.setdefault("base_elevation", 2)
        r.setdefault("landform", "flat")
        r.setdefault("material", {"color": "#3d6a32", "roughness": 0.92})
        r.setdefault("layout_color", r["material"].get("color", "#3d6a32"))
        r.setdefault("noise", [{"frequency": 0.03, "amplitude": 4, "weight": 1.0}])
        r.setdefault("detail_level", "medium")
        r.setdefault("objects", [])
        r.setdefault("id", r.get("name", "region").lower().replace(" ", "-"))


def stage_plan(prompt: str, model: str | None) -> dict:
    intent = stage_intent(prompt, model)
    return stage_scene_plan(prompt, intent, model)


# --- Stage 2: F_terrain(P) ---

def _noise2d(x: float, z: float, seed: int) -> float:
    ix, iz = int(math.floor(x)), int(math.floor(z))
    fx, fz = x - ix, z - iz
    def v(a: int, b: int) -> float:
        h = hashlib.sha256(f"{seed}:{a}:{b}".encode()).digest()
        return (h[0] / 255.0) * 2 - 1
    v00, v10, v01, v11 = v(ix, iz), v(ix + 1, iz), v(ix, iz + 1), v(ix + 1, iz + 1)
    ux = fx * fx * (3 - 2 * fx)
    uz = fz * fz * (3 - 2 * fz)
    return (v00 * (1 - ux) + v10 * ux) * (1 - uz) + (v01 * (1 - ux) + v11 * ux) * uz


def fbm(x: float, z: float, seed: int, octaves: int = 4) -> float:
    total, amp, freq = 0.0, 1.0, 1.0
    for i in range(octaves):
        total += _noise2d(x * freq, z * freq, seed + i * 17) * amp
        amp *= 0.5
        freq *= 2.1
    return total


def build_layout_map(spec: dict, n: int = GRID) -> dict:
    """I_layout — color-coded partition (paper §2.2.2). Voronoi weighted by radius."""
    regions = spec.get("regions") or []
    if not regions:
        regions = [{"id": "plain", "center": {"x": 0.5, "z": 0.5}, "radius": 0.5, "layout_color": "#3d6a32"}]
    cells: list[str] = []
    for iz in range(n):
        for ix in range(n):
            gx, gz = ix / (n - 1), iz / (n - 1)
            best_id, best_d = regions[0]["id"], 1e9
            for r in regions:
                cx = float(r.get("center", {}).get("x", 0.5))
                cz = float(r.get("center", {}).get("z", 0.5))
                rad = max(float(r.get("radius", 0.25)), 0.05)
                d = ((gx - cx) ** 2 + (gz - cz) ** 2) / (rad * rad)
                if d < best_d:
                    best_d, best_id = d, r["id"]
            cells.append(best_id)
    legend = {r["id"]: r.get("layout_color") or r.get("material", {}).get("color", "#3d6a32") for r in regions}
    return {"size": n, "cells": cells, "legend": legend}


def _soft_masks(layout: dict, spec: dict, passes: int = 4) -> dict[str, list[float]]:
    """Boundary-smoothed normalized weights m̃_r (paper Eq. 6)."""
    n = layout["size"]
    ids = [r["id"] for r in spec.get("regions") or []]
    if not ids:
        ids = ["plain"]
    masks = {rid: [1.0 if c == rid else 0.0 for c in layout["cells"]] for rid in ids}
    for _ in range(max(1, passes)):
        nxt = {rid: [0.0] * (n * n) for rid in ids}
        for iz in range(n):
            for ix in range(n):
                i = iz * n + ix
                for rid in ids:
                    s = 0.0
                    c = 0
                    for dz in (-1, 0, 1):
                        for dx in (-1, 0, 1):
                            jx, jz = ix + dx, iz + dz
                            if 0 <= jx < n and 0 <= jz < n:
                                s += masks[rid][jz * n + jx]
                                c += 1
                    nxt[rid][i] = s / max(c, 1)
        masks = nxt
    for i in range(n * n):
        tot = sum(masks[rid][i] for rid in ids) or 1.0
        for rid in ids:
            masks[rid][i] /= tot
    return masks


def _region_by_id(spec: dict) -> dict[str, dict]:
    return {r["id"]: r for r in spec.get("regions") or []}


def build_heightfield(spec: dict, layout: dict, seed: int = 42) -> dict:
    """H(x) = Σ_r m̃_r(x) [h_r + Σ w N + Σ α G]  (paper Eq. 6)."""
    scale = float(spec.get("world_scale", 256))
    n = layout["size"]
    passes = int((spec.get("terrain") or {}).get("blend_passes") or 4)
    masks = _soft_masks(layout, spec, passes=passes)
    by_id = _region_by_id(spec)
    half = scale / 2
    heights: list[float] = []
    region_map: list[str] = []
    for iz in range(n):
        for ix in range(n):
            i = iz * n + ix
            wx = (ix / (n - 1)) * scale - half
            wz = (iz / (n - 1)) * scale - half
            h = 0.0
            dom, dom_w = "plain", -1.0
            for rid, mask in masks.items():
                w = mask[i]
                if w <= 1e-6:
                    continue
                r = by_id.get(rid, {})
                h_r = float(r.get("base_elevation", 0))
                landform = r.get("landform", "flat")
                geo_fn = GEOMORPH.get(landform, GEOMORPH["flat"])
                cx = float(r.get("center", {}).get("x", 0.5))
                cz = float(r.get("center", {}).get("z", 0.5))
                rad = max(float(r.get("radius", 0.25)), 0.05)
                nx = (ix / (n - 1) - cx) / rad
                nz = (iz / (n - 1) - cz) / rad
                geo = geo_fn(nx, nz, seed * 0.01)
                noise_sum = 0.0
                for band in r.get("noise") or [{"frequency": 0.03, "amplitude": 4, "weight": 1}]:
                    freq = float(band.get("frequency", 0.03))
                    amp = float(band.get("amplitude", 4))
                    wt = float(band.get("weight", 1))
                    rid_seed = seed + int.from_bytes(hashlib.sha256(rid.encode()).digest()[:2], "little")
                    noise_sum += wt * fbm(wx * freq, wz * freq, rid_seed) * amp
                h += w * (h_r + noise_sum + geo)
                if w > dom_w:
                    dom_w = w
                    dom = r.get("terrain_type") or rid
            heights.append(round(h, 3))
            region_map.append(dom)
    return {
        "grid_size": n,
        "world_scale": scale,
        "heights": heights,
        "region_map": region_map,
        "layout": layout["cells"],
        "seed": seed,
    }


def height_at(wx: float, wz: float, spec: dict, heightfield: dict) -> tuple[float, str]:
    scale = float(heightfield.get("world_scale") or spec.get("world_scale", 256))
    n = int(heightfield.get("grid_size") or GRID)
    half = scale / 2
    u = (wx + half) / scale
    v = (wz + half) / scale
    ix = max(0, min(n - 1, int(u * (n - 1))))
    iz = max(0, min(n - 1, int(v * (n - 1))))
    i = iz * n + ix
    h = heightfield["heights"][i] if i < len(heightfield["heights"]) else 0.0
    dom = heightfield["region_map"][i] if i < len(heightfield["region_map"]) else "plain"
    return float(h), dom


def scatter_terrain_assets(spec: dict, heightfield: dict, seed: int) -> list[dict]:
    """Global terrain assets only — rocks / vegetation / attachments (paper §2.2.3)."""
    scatter_cfg = (spec.get("terrain") or {}).get("assets") or spec.get("terrain_scatter") or []
    density_map = {"low": 0.0007, "medium": 0.0018, "high": 0.004}
    instances: list[dict] = []
    scale = heightfield["world_scale"]
    half = scale / 2
    rng = random.Random(seed + 99)
    idx = 0
    for item in scatter_cfg:
        cat = item.get("category", "rock")
        dens = density_map.get(str(item.get("density", "medium")).lower(), 0.0018)
        affinity = {str(a).lower() for a in (item.get("affinity") or [])}
        count = int(scale * scale * dens)
        for _ in range(count):
            wx = rng.uniform(-half, half)
            wz = rng.uniform(-half, half)
            h, dom = height_at(wx, wz, spec, heightfield)
            if affinity and dom.lower() not in affinity and not any(a in dom.lower() for a in affinity):
                if rng.random() > 0.15:
                    continue
            if dom == "water" and h < 1:
                continue
            slope = abs(height_at(wx + 2, wz, spec, heightfield)[0] - height_at(wx - 2, wz, spec, heightfield)[0])
            if slope > 12:
                continue
            instances.append(
                {
                    "id": f"scatter_{idx}",
                    "category": cat,
                    "kind": "terrain_asset",
                    "geometry": _pick_shape(cat)["geometry"],
                    "size": _pick_shape(cat)["size"],
                    "color": _pick_shape(cat)["color"],
                    "position": {"x": round(wx, 2), "y": round(h, 2), "z": round(wz, 2)},
                    "rotation_y": round(rng.uniform(0, math.tau), 3),
                    "scale": round(rng.uniform(0.6, 1.4), 2),
                    "region": dom,
                    "editable": False,
                }
            )
            idx += 1
    return instances


def stage_terrain(spec: dict, seed: int = 42) -> tuple[dict, dict, list[dict]]:
    banner("🏔️  STAGE 2 — Global Terrain  T = F_terrain(P)")
    layout = build_layout_map(spec)
    hf = build_heightfield(spec, layout, seed)
    scatter = scatter_terrain_assets(spec, hf, seed)
    print(f"  ✓ I_layout {layout['size']}² · heightfield · {len(scatter)} scatter (code-native)")
    return layout, hf, scatter


# --- Stage 3: F_region(P, T) ---

def _pick_shape(category: str) -> dict:
    cat = category.lower()
    for key, shape in PROCEDURAL_SHAPES.items():
        if key in cat:
            return shape
    return PROCEDURAL_SHAPES["default"]


def select_detail_regions(spec: dict, heightfield: dict) -> list[dict]:
    """R+ — regions whose terrain can support requested functions (paper §2.3.1)."""
    chosen = []
    for region in spec.get("regions") or []:
        level = str(region.get("detail_level", "medium")).lower()
        if level == "low":
            continue
        if not region.get("objects"):
            continue
        t = str(region.get("terrain_type", "")).lower()
        if t == "water":
            continue
        chosen.append(region)
    print(f"  ✓ R+ = {len(chosen)} / {len(spec.get('regions') or [])} regions")
    return chosen


def _sample_xz(region: dict, spec: dict, heightfield: dict, rng: random.Random, relation: str) -> tuple[float, float] | None:
    scale = float(spec.get("world_scale", 256))
    cx = float(region.get("center", {}).get("x", 0.5)) * scale - scale / 2
    cz = float(region.get("center", {}).get("z", 0.5)) * scale - scale / 2
    rad = float(region.get("radius", 0.25)) * scale * 0.85
    if relation == "cluster":
        ang = rng.uniform(0, math.tau)
        dist = abs(rng.gauss(0, rad * 0.28))
        return cx + math.cos(ang) * dist, cz + math.sin(ang) * dist
    if relation == "compound":
        step = max(8.0, rad / 4)
        gx = rng.randint(-2, 2) * step
        gz = rng.randint(-2, 2) * step
        return cx + gx, cz + gz
    if relation == "waterfront":
        best = None
        best_d = 1e9
        for _ in range(24):
            ang = rng.uniform(0, math.tau)
            dist = rng.uniform(rad * 0.4, rad)
            wx, wz = cx + math.cos(ang) * dist, cz + math.sin(ang) * dist
            _h, dom = height_at(wx, wz, spec, heightfield)
            # prefer cells next to water
            near_water = any(
                height_at(wx + dx, wz + dz, spec, heightfield)[1] == "water"
                for dx, dz in ((6, 0), (-6, 0), (0, 6), (0, -6))
            )
            score = 0 if near_water else 40
            if dom == "water":
                score += 20
            if score < best_d:
                best_d, best = score, (wx, wz)
        return best
    if relation == "ridge":
        best, bh = (cx, cz), -1e9
        for _ in range(16):
            ang = rng.uniform(0, math.tau)
            dist = rng.uniform(0, rad)
            wx, wz = cx + math.cos(ang) * dist, cz + math.sin(ang) * dist
            h, _ = height_at(wx, wz, spec, heightfield)
            if h > bh:
                bh, best = h, (wx, wz)
        return best
    ang = rng.uniform(0, math.tau)
    dist = rng.uniform(0, rad)
    return cx + math.cos(ang) * dist, cz + math.sin(ang) * dist


def place_regional_objects(spec: dict, heightfield: dict, chosen: list[dict], seed: int = 42) -> list[dict]:
    instances: list[dict] = []
    rng = random.Random(seed + 7)
    idx = 0
    occupied: list[tuple[float, float, float]] = []
    for region in chosen:
        for obj_spec in region.get("objects") or []:
            cat = obj_spec.get("category", "building")
            count = int(obj_spec.get("count", 1))
            relation = str(obj_spec.get("relation") or "scatter")
            shape = _pick_shape(cat)
            for _ in range(count):
                placed = False
                for _attempt in range(16):
                    xz = _sample_xz(region, spec, heightfield, rng, relation)
                    if not xz:
                        continue
                    wx, wz = xz
                    h, dom = height_at(wx, wz, spec, heightfield)
                    if dom == "water" and cat not in ("dock", "ship"):
                        continue
                    if h < -2 and cat not in ("dock", "ship"):
                        continue
                    slope = abs(height_at(wx + 2, wz, spec, heightfield)[0] - height_at(wx - 2, wz, spec, heightfield)[0])
                    if slope > 10 and cat in ("house", "building", "facility", "vehicle"):
                        continue
                    footprint = max(shape["size"][0], shape["size"][2]) * 0.7
                    if any((wx - ox) ** 2 + (wz - oz) ** 2 < (footprint + gap) ** 2 for ox, oz, gap in occupied):
                        continue
                    sy = shape["size"][1]
                    y = h + sy / 2
                    if cat == "dock":
                        y = max(h, 0.4) + sy / 2
                    instances.append(
                        {
                            "id": f"obj_{idx}",
                            "category": cat,
                            "kind": "regional_object",
                            "region_id": region.get("id", "unknown"),
                            "style": obj_spec.get("style", spec.get("style", "")),
                            "relation": relation,
                            "geometry": shape["geometry"],
                            "size": shape["size"],
                            "color": shape["color"],
                            "position": {"x": round(wx, 2), "y": round(y, 2), "z": round(wz, 2)},
                            "rotation_y": round(rng.uniform(0, math.tau), 3),
                            "scale": round(rng.uniform(0.9, 1.12), 2),
                            "editable": True,
                        }
                    )
                    occupied.append((wx, wz, footprint))
                    idx += 1
                    placed = True
                    break
                if not placed:
                    continue
    print(f"  ✓ {len(instances)} regional objects (editable instances)")
    return instances


def detect_contact_issues(instances: list[dict], spec: dict, heightfield: dict) -> list[dict]:
    issues: list[dict] = []
    for inst in instances:
        if inst.get("kind") != "regional_object":
            continue
        p = inst["position"]
        ground, _ = height_at(p["x"], p["z"], spec, heightfield)
        sy = inst.get("size", [2, 2, 2])[1]
        bottom = p["y"] - sy / 2 * inst.get("scale", 1)
        gap = bottom - ground
        if gap > 1.5:
            issues.append({"id": inst["id"], "type": "floating", "gap": round(gap, 2)})
        elif gap < -0.8:
            issues.append({"id": inst["id"], "type": "penetration", "gap": round(gap, 2)})
    return issues


def seat_instance(inst: dict, spec: dict, heightfield: dict) -> None:
    """Object–terrain co-seat (paper §2.3.3 terrain refine, local only)."""
    p = inst["position"]
    ground, _ = height_at(p["x"], p["z"], spec, heightfield)
    sy = inst.get("size", [2, 2, 2])[1] * inst.get("scale", 1)
    inst["position"]["y"] = round(ground + sy / 2, 2)


def stage_region(spec: dict, heightfield: dict, model: str | None, seed: int, refine: bool) -> list[dict]:
    banner("🏘️  STAGE 3 — Regional Objects  O = F_region(P, T)")
    chosen = select_detail_regions(spec, heightfield)
    instances = place_regional_objects(spec, heightfield, chosen, seed)
    if not refine:
        return instances
    inst_map = {i["id"]: i for i in instances}
    for iteration in range(2):
        issues = detect_contact_issues(instances, spec, heightfield)
        if not issues:
            print(f"  ✓ contact clean (iter {iteration})")
            break
        print(f"  refine iter {iteration + 1}: {len(issues)} contact issues")
        for issue in issues:
            inst = inst_map.get(issue["id"])
            if inst:
                seat_instance(inst, spec, heightfield)
        if iteration == 1 and model and issues:
            try:
                adj = extract_json_block(
                    chat(
                        [
                            {"role": "system", "content": REFINE_SYSTEM},
                            {
                                "role": "user",
                                "content": json.dumps({"issues": issues[:20], "instances": instances[:24]}, indent=2)[:12000],
                            },
                        ],
                        model,
                        temperature=0.1,
                    )
                )
                for patch in adj.get("instances") or []:
                    inst = inst_map.get(patch.get("id", ""))
                    if not inst:
                        continue
                    if "position" in patch:
                        inst["position"].update(patch["position"])
                    for k in ("rotation_y", "scale"):
                        if k in patch:
                            inst[k] = patch[k]
            except Exception as e:
                print(f"  ⚠ LLM refine skipped: {e}")
    return instances


# --- Optional mesh endpoint (no secrets) ---

def hunyuan_generate(prompt: str, config: dict) -> bytes | None:
    """Optional user HTTP endpoint. POST {prompt} → GLB bytes. Never reads API keys."""
    api = config.get("hunyuan3d") or {}
    if not api.get("enabled"):
        return None
    endpoint = str(api.get("endpoint") or "").strip()
    if not endpoint:
        print("  ℹ hunyuan3d.enabled but no endpoint — procedural placeholders")
        return None
    req = urllib.request.Request(
        endpoint,
        data=json.dumps({"prompt": prompt}).encode(),
        headers={"Content-Type": "application/json"},
        method="POST",
    )
    try:
        with urllib.request.urlopen(req, timeout=60) as r:
            return r.read()
    except Exception as e:
        print(f"  ⚠ mesh endpoint failed: {e}")
        return None


# --- Compose(T, O) ---

def write_json(path: Path, data: Any) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(data, indent=2) + "\n", encoding="utf-8")
    print(f"  + {path}")


def ensure_world_scaffold(project: Path, name: str) -> None:
    template = ROOT / "templates" / "world-game"
    if not template.is_dir():
        return
    markers = [project / "src" / "world" / "terrain.js", project / "package.json"]
    if all(m.exists() for m in markers):
        return
    import shutil

    print(f"  → scaffolding world-game template into {project}")
    for item in template.iterdir():
        target = project / item.name
        if item.is_dir():
            shutil.copytree(item, target, dirs_exist_ok=True)
        elif not target.exists():
            shutil.copy2(item, target)
    pkg = project / "package.json"
    if pkg.exists():
        data = json.loads(pkg.read_text(encoding="utf-8"))
        data["name"] = re.sub(r"[^a-z0-9-]+", "-", name.lower()).strip("-") or "world"
        pkg.write_text(json.dumps(data, indent=2) + "\n", encoding="utf-8")


def emit_world(
    project: Path,
    prompt: str,
    spec: dict,
    layout: dict,
    hf: dict,
    instances: list[dict],
) -> None:
    meta = {
        "prompt": prompt,
        "generated_at": datetime.now(timezone.utc).isoformat(),
        "engine": "gamemaster-worldclaw",
        "paper": "arXiv:2608.05248",
        "stages": ["F_plan", "F_terrain", "F_region", "Compose"],
        "theme": spec.get("theme"),
        "style": spec.get("style"),
        "season": spec.get("season"),
        "world_scale": spec.get("world_scale"),
        "region_count": len(spec.get("regions", [])),
        "instance_count": len(instances),
        "has_water": any(r.get("terrain_type") == "water" for r in spec.get("regions") or []),
    }
    wc = project / ".gamemaster" / "worldclaw"
    write_json(wc / "spec.json", spec)
    write_json(wc / "layout.json", layout)
    write_json(wc / "heightfield.json", hf)
    write_json(wc / "instances.json", instances)
    write_json(wc / "meta.json", meta)
    pub = project / "public" / "world"
    write_json(pub / "spec.json", spec)
    write_json(pub / "layout.json", layout)
    write_json(pub / "heightfield.json", hf)
    write_json(pub / "instances.json", instances)
    write_json(pub / "meta.json", meta)


def pipeline(
    project: Path,
    prompt: str,
    model: str | None,
    seed: int = 42,
    refine: bool = True,
    name: str = "World",
) -> dict:
    ensure_world_scaffold(project, name)
    spec = stage_plan(prompt, model)
    layout, hf, scatter = stage_terrain(spec, seed)
    regional = stage_region(spec, hf, model, seed, refine)
    all_instances = scatter + regional
    emit_world(project, prompt, spec, layout, hf, all_instances)
    banner("✅ Compose(T, O)")
    print(f"  📁 {project}")
    print(f"  🌍 {len(spec.get('regions', []))} regions · {len(all_instances)} instances")
    print("  → npm install && npm run dev   ·  1 RGB  2 instance masks")
    return {"spec": spec, "layout": layout, "heightfield": hf, "instances": all_instances}


def cmd_plan(args: argparse.Namespace) -> int:
    if getattr(args, "cloud", ""):
        os.environ["GAMEMASTER_CLOUD"] = args.cloud
    model = None if args.offline or not llm_ready() else args.model
    spec = stage_plan(args.prompt, model)
    out = Path(args.out) if args.out else Path.cwd() / "worldclaw-spec.json"
    write_json(out, spec)
    return 0


def cmd_generate(args: argparse.Namespace) -> int:
    project = Path(args.project).expanduser().resolve()
    project.mkdir(parents=True, exist_ok=True)
    prompt = " ".join(args.prompt)
    if args.cloud:
        os.environ["GAMEMASTER_CLOUD"] = args.cloud
    online = (not args.offline) and llm_ready()
    if not online:
        print("  ℹ offline / no LLM — heuristic F_plan")
    elif active_provider():
        print(f"  ☁ cloud {active_provider()} (paid)")
    pipeline(
        project,
        prompt,
        args.model if online else None,
        seed=args.seed,
        refine=not args.no_refine,
        name=args.name or project.name,
    )
    if args.live:
        try:
            sys.path.insert(0, str(ROOT / "bin"))
            import live as livelib

            livelib.start_live(project, open_browser=True)
            livelib.emit(
                f"WorldClaw: {prompt[:120]}",
                role="system",
                phase="world",
                headline="World generated",
                detail="Explore the terrain",
            )
            print("\n🔴 Live window open — Ctrl+C to stop.")
            while True:
                time.sleep(3600)
        except KeyboardInterrupt:
            pass
    return 0


def main() -> int:
    ap = argparse.ArgumentParser(description="Gamemaster WorldClaw — paper pipeline, local Three.js")
    sub = ap.add_subparsers(dest="cmd", required=True)

    p_gen = sub.add_parser("generate", help="P → T → O → Compose into a Three.js world")
    p_gen.add_argument("-p", "--project", required=True)
    p_gen.add_argument("prompt", nargs="+")
    p_gen.add_argument("-m", "--model", default=DEFAULT_MODEL)
    p_gen.add_argument("--seed", type=int, default=42)
    p_gen.add_argument("--name", default=None)
    p_gen.add_argument("--no-refine", action="store_true")
    p_gen.add_argument("--live", action="store_true")
    p_gen.add_argument("--offline", action="store_true", help="heuristic plan (no LLM)")
    p_gen.add_argument("--cloud", default="", help="Optional paid provider: grok|claude|openai|gemini")
    p_gen.set_defaults(func=cmd_generate)

    p_plan = sub.add_parser("plan", help="F_plan only — write spec JSON")
    p_plan.add_argument("prompt")
    p_plan.add_argument("-m", "--model", default=DEFAULT_MODEL)
    p_plan.add_argument("-o", "--out", default=None)
    p_plan.add_argument("--offline", action="store_true")
    p_plan.add_argument("--cloud", default="", help="Optional paid provider")
    p_plan.set_defaults(func=cmd_plan)

    args = ap.parse_args()
    return args.func(args)


if __name__ == "__main__":
    raise SystemExit(main())
