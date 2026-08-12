#!/usr/bin/env python3
"""
Gamemaster WorldClaw — Agentic 3D open-world generation (local-first)

Reverse-engineered from Tencent Hunyuan WorldClaw (arXiv:2608.05248):
  Stage 1  Intent analysis + scene planning  → structured spec P
  Stage 2  Global terrain generation         → heightfield + scatter T
  Stage 3  Regional object placement         → editable instances O
  Stage 4  Render-guided refinement          → pose/contact fixes

Outputs explorable Three.js worlds with separate, editable instances.
Optional Hunyuan3D API for mesh generation (config/worldclaw.json).
"""
from __future__ import annotations

import argparse
import base64
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

from gmcommon import DEFAULT_MODEL, OLLAMA, ROOT
CONFIG_PATH = ROOT / "config" / "worldclaw.json"
EXAMPLE_CONFIG = ROOT / "config" / "worldclaw.example.json"

# WorldClaw scene-spec schema (paper §2.1)
SCENE_SPEC_SCHEMA = {
    "theme": "string",
    "style": "string",
    "atmosphere": "string",
    "world_scale": "meters, e.g. 256",
    "regions": [
        {
            "id": "slug",
            "name": "human label",
            "terrain_type": "mountain|plain|desert|water|forest|snow|canyon|coast",
            "layout_color": "#hex — semantic layout map color",
            "coverage": "0-1 fraction of world",
            "center": {"x": "0-1", "z": "0-1"},
            "radius": "0-0.5 normalized",
            "base_elevation": "meters",
            "landform": "peak|dune|terrace|erosion|flat|cliff",
            "material": {"color": "#hex", "roughness": 0.9},
            "noise": [{"frequency": 0.02, "amplitude": 8}],
            "detail_level": "low|medium|high",
            "objects": [{"category": "house", "count": 3, "style": "medieval"}],
        }
    ],
    "terrain_scatter": [{"category": "rock|pine|bush", "density": "low|medium|high"}],
}

PLAN_SYSTEM = """You are the WorldClaw planning agent (Intent Analysis + Scene Planning).
Convert the user prompt into a JSON scene specification ONLY — no prose.

Rules (from WorldClaw paper):
- Extract ONLY constraints explicitly in the prompt; do not invent major themes.
- Complete missing attributes downstream modules need (regions, terrain, objects).
- 3–6 regions with distinct terrain_type, spatial center/radius, landform operators.
- Each region with detail_level high gets objects[] with category, count, style.
- world_scale 128–512. Use hex colors for layout_color and material.color.
- terrain_scatter: rocks/vegetation for global terrain (not functional buildings).

Reply with a single ```json block containing the spec. English keys only."""


REFINE_SYSTEM = """You are the WorldClaw refinement agent (object + terrain contact checks).
Given scene spec, instance list, and issues — return JSON adjustments ONLY:

```json
{
  "instances": [{"id": "...", "position": {"x":0,"y":0,"z":0}, "rotation_y": 0, "scale": 1}],
  "terrain_patches": [{"region_id": "...", "base_elevation_delta": 0}],
  "notes": "brief"
}
```

Fix floating (lower y), penetration (raise y), wrong scale, bad orientation.
Only include instances that need changes."""


def http_json(path: str, payload: dict | None = None, timeout: float = 600.0) -> dict:
    data = None if payload is None else json.dumps(payload).encode()
    req = urllib.request.Request(
        f"{OLLAMA}{path}",
        data=data,
        headers={"Content-Type": "application/json"} if data else {},
        method="POST" if data is not None else "GET",
    )
    with urllib.request.urlopen(req, timeout=timeout) as r:
        return json.loads(r.read().decode())


def chat(messages: list[dict], model: str, temperature: float = 0.25) -> str:
    payload = {
        "model": model,
        "messages": messages,
        "stream": False,
        "keep_alive": "24h",
        "options": {
            "temperature": temperature,
            "num_ctx": int(os.environ.get("GAMEMASTER_NUM_CTX", "32768")),
            "num_predict": int(os.environ.get("GAMEMASTER_PREDICT", "8192")),
        },
    }
    return (http_json("/api/chat", payload).get("message") or {}).get("content") or ""


def extract_json_block(text: str) -> dict:
    m = re.search(r"```(?:json)?\s*([\s\S]*?)```", text)
    raw = m.group(1).strip() if m else text.strip()
    # tolerate leading prose
    start = raw.find("{")
    end = raw.rfind("}")
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


def stage_plan(prompt: str, model: str) -> dict:
    banner("🧭 STAGE 1 — Intent Analysis & Planning")
    print(f"  prompt: {prompt[:120]}…")
    out = chat(
        [
            {"role": "system", "content": PLAN_SYSTEM},
            {
                "role": "user",
                "content": f"User prompt:\n{prompt}\n\nProduce scene spec JSON.",
            },
        ],
        model,
        temperature=0.2,
    )
    spec = extract_json_block(out)
    spec.setdefault("world_scale", 256)
    spec.setdefault("theme", "open world")
    spec.setdefault("terrain_scatter", [{"category": "rock", "density": "medium"}])
    print(f"  ✓ {len(spec.get('regions', []))} regions planned")
    return spec


# --- Stage 2: Global terrain (paper Eq. 6) ---

GRID = 128
GEOMORPH = {
    "peak": lambda nx, nz, t: math.exp(-((nx**2 + nz**2) / 0.08)) * 25,
    "dune": lambda nx, nz, t: math.sin(nx * 8 + t) * math.cos(nz * 6 + t * 0.7) * 6,
    "terrace": lambda nx, nz, t: math.floor(nx * 5) * 2 + math.floor(nz * 5) * 1.5,
    "erosion": lambda nx, nz, t: -abs(math.sin(nx * 12)) * 4 - abs(math.cos(nz * 10)) * 3,
    "flat": lambda nx, nz, t: 0.0,
    "cliff": lambda nx, nz, t: max(0, nx * 15 - 5),
}


def _noise2d(x: float, z: float, seed: int) -> float:
    """Deterministic value noise (no numpy)."""
    ix, iz = int(math.floor(x)), int(math.floor(z))
    fx, fz = x - ix, z - iz
    h = hashlib.sha256(f"{seed}:{ix}:{iz}".encode()).digest()
    v00 = (h[0] / 255.0) * 2 - 1
    h = hashlib.sha256(f"{seed}:{ix+1}:{iz}".encode()).digest()
    v10 = (h[0] / 255.0) * 2 - 1
    h = hashlib.sha256(f"{seed}:{ix}:{iz+1}".encode()).digest()
    v01 = (h[0] / 255.0) * 2 - 1
    h = hashlib.sha256(f"{seed}:{ix+1}:{iz+1}".encode()).digest()
    v11 = (h[0] / 255.0) * 2 - 1
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


def region_weight(gx: float, gz: float, region: dict) -> float:
    cx = float(region.get("center", {}).get("x", 0.5))
    cz = float(region.get("center", {}).get("z", 0.5))
    r = float(region.get("radius", 0.25))
    dx, dz = gx - cx, gz - cz
    dist = math.sqrt(dx * dx + dz * dz)
    if dist >= r:
        return 0.0
    # soft boundary (paper: normalized soft weights m_r)
    t = dist / max(r, 1e-6)
    return max(0.0, 1.0 - t * t * (3 - 2 * t))


def height_at(
    wx: float,
    wz: float,
    spec: dict,
    seed: int,
) -> tuple[float, str]:
    """H(x) = sum_r m_r(x) * [h_r + noise + geomorph]"""
    scale = float(spec.get("world_scale", 256))
    gx, gz = wx / scale + 0.5, wz / scale + 0.5
    h_total = 0.0
    w_total = 0.0
    dominant = "plain"
    for region in spec.get("regions", []):
        w = region_weight(gx, gz, region)
        if w <= 0:
            continue
        h_r = float(region.get("base_elevation", 0))
        landform = region.get("landform", "flat")
        geo_fn = GEOMORPH.get(landform, GEOMORPH["flat"])
        nx = (gx - float(region.get("center", {}).get("x", 0.5))) / max(
            float(region.get("radius", 0.25)), 0.05
        )
        nz = (gz - float(region.get("center", {}).get("z", 0.5))) / max(
            float(region.get("radius", 0.25)), 0.05
        )
        geo = geo_fn(nx, nz, seed)
        noise_sum = 0.0
        for n in region.get("noise", [{"frequency": 0.03, "amplitude": 4}]):
            freq = float(n.get("frequency", 0.03))
            amp = float(n.get("amplitude", 4))
            noise_sum += fbm(wx * freq, wz * freq, seed + hash(region.get("id", "")) % 1000) * amp
        h_total += w * (h_r + noise_sum + geo)
        w_total += w
        if w > 0.3:
            dominant = region.get("terrain_type", "plain")
    if w_total < 1e-6:
        h_total = fbm(wx * 0.02, wz * 0.02, seed) * 3
    else:
        h_total /= w_total
    return h_total, dominant


def build_heightfield(spec: dict, seed: int = 42) -> dict:
    scale = float(spec.get("world_scale", 256))
    half = scale / 2
    heights: list[float] = []
    region_map: list[str] = []
    for iz in range(GRID):
        for ix in range(GRID):
            wx = (ix / (GRID - 1)) * scale - half
            wz = (iz / (GRID - 1)) * scale - half
            h, dom = height_at(wx, wz, spec, seed)
            heights.append(round(h, 3))
            region_map.append(dom)
    return {
        "grid_size": GRID,
        "world_scale": scale,
        "heights": heights,
        "region_map": region_map,
        "seed": seed,
    }


def scatter_terrain_assets(spec: dict, heightfield: dict, seed: int) -> list[dict]:
    """Global terrain asset scattering (paper §2.2.3)."""
    scatter_cfg = spec.get("terrain_scatter") or []
    density_map = {"low": 0.0008, "medium": 0.002, "high": 0.005}
    instances: list[dict] = []
    scale = heightfield["world_scale"]
    half = scale / 2
    rng = random.Random(seed + 99)
    idx = 0
    for item in scatter_cfg:
        cat = item.get("category", "rock")
        dens = density_map.get(str(item.get("density", "medium")).lower(), 0.002)
        count = int(scale * scale * dens)
        for _ in range(count):
            wx = rng.uniform(-half, half)
            wz = rng.uniform(-half, half)
            h, dom = height_at(wx, wz, spec, seed)
            if dom == "water" and h < 1:
                continue
            slope = abs(
                height_at(wx + 2, wz, spec, seed)[0] - height_at(wx - 2, wz, spec, seed)[0]
            )
            if slope > 12:
                continue
            instances.append(
                {
                    "id": f"scatter_{idx}",
                    "category": cat,
                    "kind": "terrain_asset",
                    "position": {"x": round(wx, 2), "y": round(h, 2), "z": round(wz, 2)},
                    "rotation_y": round(rng.uniform(0, math.tau), 3),
                    "scale": round(rng.uniform(0.6, 1.4), 2),
                    "region": dom,
                }
            )
            idx += 1
    return instances


def stage_terrain(spec: dict, seed: int = 42) -> tuple[dict, list[dict]]:
    banner("🏔️  STAGE 2 — Global Terrain Generation")
    hf = build_heightfield(spec, seed)
    scatter = scatter_terrain_assets(spec, hf, seed)
    print(f"  ✓ heightfield {GRID}×{GRID}, {len(scatter)} terrain scatter instances")
    return hf, scatter


# --- Stage 3: Regional objects ---

PROCEDURAL_SHAPES = {
    "house": {"geometry": "box", "size": [4, 3, 4], "color": "#8b7355"},
    "building": {"geometry": "box", "size": [6, 8, 6], "color": "#6b7280"},
    "tower": {"geometry": "cylinder", "size": [2, 12, 2], "color": "#78716c"},
    "tree": {"geometry": "cone", "size": [2, 6, 2], "color": "#166534"},
    "pine": {"geometry": "cone", "size": [1.5, 5, 1.5], "color": "#14532d"},
    "rock": {"geometry": "dodecahedron", "size": [1.2, 1.2, 1.2], "color": "#57534e"},
    "bush": {"geometry": "sphere", "size": [1.5, 1, 1.5], "color": "#15803d"},
    "vehicle": {"geometry": "box", "size": [3, 1.5, 5], "color": "#44403c"},
    "dock": {"geometry": "box", "size": [8, 0.5, 3], "color": "#92400e"},
    "animal": {"geometry": "capsule", "size": [0.8, 1.2, 0.8], "color": "#a16207"},
    "default": {"geometry": "box", "size": [2, 2, 2], "color": "#64748b"},
}


def _pick_shape(category: str) -> dict:
    cat = category.lower()
    for key, shape in PROCEDURAL_SHAPES.items():
        if key in cat:
            return shape
    return PROCEDURAL_SHAPES["default"]


def place_regional_objects(
    spec: dict, heightfield: dict, seed: int = 42
) -> list[dict]:
    banner("🏘️  STAGE 3 — Regional Object Generation & Placement")
    instances: list[dict] = []
    rng = random.Random(seed + 7)
    idx = 0
    scale = float(spec.get("world_scale", 256))
    for region in spec.get("regions", []):
        if str(region.get("detail_level", "medium")).lower() == "low":
            continue
        cx = float(region.get("center", {}).get("x", 0.5)) * scale - scale / 2
        cz = float(region.get("center", {}).get("z", 0.5)) * scale - scale / 2
        rad = float(region.get("radius", 0.25)) * scale * 0.85
        for obj_spec in region.get("objects") or []:
            cat = obj_spec.get("category", "building")
            count = int(obj_spec.get("count", 1))
            shape = _pick_shape(cat)
            for _ in range(count):
                for attempt in range(12):
                    ang = rng.uniform(0, math.tau)
                    dist = rng.uniform(0, rad)
                    wx = cx + math.cos(ang) * dist
                    wz = cz + math.sin(ang) * dist
                    h, _ = height_at(wx, wz, spec, seed)
                    if h < -2:
                        continue
                    sy = shape["size"][1] if len(shape["size"]) > 1 else 2
                    instances.append(
                        {
                            "id": f"obj_{idx}",
                            "category": cat,
                            "kind": "regional_object",
                            "region_id": region.get("id", "unknown"),
                            "style": obj_spec.get("style", spec.get("style", "")),
                            "geometry": shape["geometry"],
                            "size": shape["size"],
                            "color": shape["color"],
                            "position": {
                                "x": round(wx, 2),
                                "y": round(h + sy / 2, 2),
                                "z": round(wz, 2),
                            },
                            "rotation_y": round(rng.uniform(0, math.tau), 3),
                            "scale": round(rng.uniform(0.85, 1.15), 2),
                            "editable": True,
                        }
                    )
                    idx += 1
                    break
    print(f"  ✓ {len(instances)} regional objects placed")
    return instances


def sample_height(heightfield: dict, spec: dict, wx: float, wz: float) -> float:
    return height_at(wx, wz, spec, heightfield.get("seed", 42))[0]


def detect_contact_issues(
    instances: list[dict], spec: dict, heightfield: dict
) -> list[dict]:
    """Heuristic contact check (paper §2.3.3 terrain refinement)."""
    issues: list[dict] = []
    for inst in instances:
        if inst.get("kind") != "regional_object":
            continue
        p = inst["position"]
        ground = sample_height(heightfield, spec, p["x"], p["z"])
        sy = inst.get("size", [2, 2, 2])[1]
        bottom = p["y"] - sy / 2 * inst.get("scale", 1)
        gap = bottom - ground
        if gap > 1.5:
            issues.append({"id": inst["id"], "type": "floating", "gap": round(gap, 2)})
        elif gap < -0.8:
            issues.append({"id": inst["id"], "type": "penetration", "gap": round(gap, 2)})
    return issues


def stage_refine(
    spec: dict,
    heightfield: dict,
    instances: list[dict],
    model: str,
    max_iter: int = 2,
) -> list[dict]:
    banner("🔍 STAGE 4 — Render-Guided Refinement")
    inst_map = {i["id"]: i for i in instances}
    for iteration in range(max_iter):
        issues = detect_contact_issues(instances, spec, heightfield)
        if not issues:
            print(f"  ✓ no contact issues (iter {iteration})")
            break
        print(f"  iter {iteration + 1}: {len(issues)} contact issues")
        # Heuristic fix first (fast, local)
        for issue in issues:
            inst = inst_map.get(issue["id"])
            if not inst:
                continue
            p = inst["position"]
            ground = sample_height(heightfield, spec, p["x"], p["z"])
            sy = inst.get("size", [2, 2, 2])[1] * inst.get("scale", 1)
            if issue["type"] == "floating":
                inst["position"]["y"] = round(ground + sy / 2, 2)
            elif issue["type"] == "penetration":
                inst["position"]["y"] = round(ground + sy / 2 + 0.1, 2)
        # LLM refinement for remaining semantic issues (optional)
        if iteration == max_iter - 1 and len(issues) > 0:
            try:
                adj = extract_json_block(
                    chat(
                        [
                            {"role": "system", "content": REFINE_SYSTEM},
                            {
                                "role": "user",
                                "content": json.dumps(
                                    {"issues": issues[:20], "instances": instances[:30]},
                                    indent=2,
                                )[:12000],
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


# --- Optional Hunyuan3D API ---

def hunyuan_generate(prompt: str, config: dict) -> bytes | None:
    """Optional Tencent Hunyuan3D cloud API (Text-to-3D → GLB)."""
    api = config.get("hunyuan3d") or {}
    if not api.get("enabled"):
        return None
    secret = api.get("secret_id", "")
    key = api.get("secret_key", "")
    if not secret or not key:
        print("  ⚠ Hunyuan3D enabled but no credentials in config/worldclaw.json")
        return None
    # Simplified: user can plug TC3 signing; document in example config
    print("  ℹ Hunyuan3D: configure TC3 credentials — using procedural fallback")
    return None


# --- Emit project files ---

def write_json(path: Path, data: Any) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(data, indent=2) + "\n", encoding="utf-8")
    print(f"  + {path}")


def ensure_world_scaffold(project: Path, name: str) -> None:
    """Copy world-game template if project is empty/minimal."""
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
            if target.exists():
                shutil.copytree(item, target, dirs_exist_ok=True)
            else:
                shutil.copytree(item, target)
        elif not target.exists():
            shutil.copy2(item, target)
    pkg = project / "package.json"
    if pkg.exists():
        data = json.loads(pkg.read_text(encoding="utf-8"))
        data["name"] = re.sub(r"[^a-z0-9-]+", "-", name.lower()).strip("-") or "world"
        pkg.write_text(json.dumps(data, indent=2) + "\n", encoding="utf-8")


def emit_world(project: Path, prompt: str, spec: dict, hf: dict, instances: list[dict]) -> None:
    meta = {
        "prompt": prompt,
        "generated_at": datetime.now(timezone.utc).isoformat(),
        "engine": "gamemaster-worldclaw",
        "paper": "arXiv:2608.05248",
        "theme": spec.get("theme"),
        "style": spec.get("style"),
        "world_scale": spec.get("world_scale"),
        "region_count": len(spec.get("regions", [])),
        "instance_count": len(instances),
    }
    wc = project / ".gamemaster" / "worldclaw"
    write_json(wc / "spec.json", spec)
    write_json(wc / "heightfield.json", hf)
    write_json(wc / "instances.json", instances)
    write_json(wc / "meta.json", meta)
    write_json(project / "public" / "world" / "spec.json", spec)
    write_json(project / "public" / "world" / "heightfield.json", hf)
    write_json(project / "public" / "world" / "instances.json", instances)
    write_json(project / "public" / "world" / "meta.json", meta)


def pipeline(
    project: Path,
    prompt: str,
    model: str,
    seed: int = 42,
    refine: bool = True,
    name: str = "World",
) -> dict:
    ensure_world_scaffold(project, name)
    spec = stage_plan(prompt, model)
    hf, scatter = stage_terrain(spec, seed)
    regional = place_regional_objects(spec, hf, seed)
    all_instances = scatter + regional
    if refine:
        all_instances = stage_refine(spec, hf, all_instances, model)
    emit_world(project, prompt, spec, hf, all_instances)
    banner("✅ WorldClaw complete")
    print(f"  📁 {project}")
    print(f"  🌍 {len(spec.get('regions', []))} regions · {len(all_instances)} instances")
    print("  → npm install && npm run dev")
    return {"spec": spec, "heightfield": hf, "instances": all_instances}


def cmd_plan(args: argparse.Namespace) -> int:
    spec = stage_plan(args.prompt, args.model)
    out = Path(args.out) if args.out else Path.cwd() / "worldclaw-spec.json"
    write_json(out, spec)
    return 0


def cmd_generate(args: argparse.Namespace) -> int:
    project = Path(args.project).expanduser().resolve()
    project.mkdir(parents=True, exist_ok=True)
    prompt = " ".join(args.prompt)
    pipeline(
        project,
        prompt,
        args.model,
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
    ap = argparse.ArgumentParser(
        description="Gamemaster WorldClaw — agentic open-world generation"
    )
    sub = ap.add_subparsers(dest="cmd", required=True)

    p_gen = sub.add_parser("generate", help="Full pipeline → Three.js world")
    p_gen.add_argument("-p", "--project", required=True)
    p_gen.add_argument("prompt", nargs="+")
    p_gen.add_argument("-m", "--model", default=DEFAULT_MODEL)
    p_gen.add_argument("--seed", type=int, default=42)
    p_gen.add_argument("--name", default=None)
    p_gen.add_argument("--no-refine", action="store_true")
    p_gen.add_argument("--live", action="store_true")
    p_gen.set_defaults(func=cmd_generate)

    p_plan = sub.add_parser("plan", help="Stage 1 only — scene spec JSON")
    p_plan.add_argument("prompt")
    p_plan.add_argument("-m", "--model", default=DEFAULT_MODEL)
    p_plan.add_argument("-o", "--out", default=None)
    p_plan.set_defaults(func=cmd_plan)

    args = ap.parse_args()
    try:
        http_json("/api/tags")
    except Exception:
        print("❌ Ollama not reachable", file=sys.stderr)
        return 1
    return args.func(args)


if __name__ == "__main__":
    raise SystemExit(main())
