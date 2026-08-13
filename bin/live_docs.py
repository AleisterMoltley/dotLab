#!/usr/bin/env python3
"""
Live docs refresh — pull compact Three.js / Canvas2D notes into knowledge/live.

Offline-first: ships curated stubs; optional network refresh when allowed.

  gamemaster live-docs status
  gamemaster live-docs refresh [--offline]
"""
from __future__ import annotations

import argparse
import json
import time
import urllib.request
from pathlib import Path

from gmcommon import KNOWLEDGE, ROOT

LIVE = KNOWLEDGE / "live"
THREE_MD = LIVE / "three-api.md"
PIXEL_MD = LIVE / "pixel-api.md"
META = LIVE / "docs-meta.json"

# Compact, host-owned API crib sheets (no full library dump)
THREE_STUB = """# Three.js API crib (live pack)

Prefer r170+ ESM from `three` npm. Never `examples/jsm` deep paths in new code without checking package exports.

## Boot
```js
import * as THREE from 'three';
const renderer = new THREE.WebGLRenderer({ antialias: true });
renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
const scene = new THREE.Scene();
const camera = new THREE.PerspectiveCamera(60, w/h, 0.1, 200);
```

## Loop
```js
const clock = new THREE.Clock();
function tick() {
  const dt = Math.min(clock.getDelta(), 0.05);
  // update systems…
  renderer.render(scene, camera);
  requestAnimationFrame(tick);
}
tick();
```

## Feel-critical
- `PerspectiveCamera.fov` + lerp for ADS
- Shadow maps only on key light; `PCFSoftShadowMap`
- `InstancedMesh` for repeated props
- Dispose geometries/materials on room unload

## Avoid (slop)
- Green capsule hero with no silhouette props
- Purple fog + empty floor
- Full scene rewrite for a feel tweak — use game_ops / CONFIG slots

See also: threejs-cheatsheet.md, threejs-recipes.md
"""

PIXEL_STUB = """# Pixel / Canvas2D API crib (live pack)

## Bake pattern
```js
const c = document.createElement('canvas');
c.width = 16; c.height = 16;
const g = c.getContext('2d');
g.imageSmoothingEnabled = false;
// layeredRect / palette fill…
const tex = new THREE.CanvasTexture(c); // if bridging to three
tex.magFilter = THREE.NearestFilter;
tex.minFilter = THREE.NearestFilter;
```

## Pure pixel engine
- Fixed internal res (e.g. 160×144 / 240×160) → CSS upscale nearest
- One palette array; no free-form RGB spam
- Draw order: bg → entities → fx → HUD
- Input: keyboard + optional touch d-pad

## Vintage
- GB: 4 colors, 160×144 logical
- GBC: banked palettes, still low res
- GBA: hard ceiling on enemy/room counts (host vintage_cap)

See also: pixel-kit.md, vintage.md
"""


def ensure_stubs() -> dict:
    LIVE.mkdir(parents=True, exist_ok=True)
    written = []
    if not THREE_MD.is_file() or THREE_MD.stat().st_size < 100:
        THREE_MD.write_text(THREE_STUB, encoding="utf-8")
        written.append("three-api.md")
    if not PIXEL_MD.is_file() or PIXEL_MD.stat().st_size < 100:
        PIXEL_MD.write_text(PIXEL_STUB, encoding="utf-8")
        written.append("pixel-api.md")
    # Keep LATEST pointer
    latest = LIVE / "LATEST.md"
    body = (
        f"# Live knowledge\n\n"
        f"- three-api.md · pixel-api.md (host crib sheets)\n"
        f"- refreshed: {time.strftime('%Y-%m-%d %H:%M')}\n"
        f"- offline-safe stubs; network refresh optional\n"
    )
    latest.write_text(body, encoding="utf-8")
    meta = {"ts": time.time(), "written": written, "mode": "stub"}
    META.write_text(json.dumps(meta, indent=2), encoding="utf-8")
    return meta


def refresh(offline: bool = True) -> dict:
    """Always ensure stubs; optional fetch of npm three version note."""
    meta = ensure_stubs()
    if offline:
        return {**meta, "ok": True, "network": False}
    # Best-effort: three package version from registry (no full docs scrape)
    try:
        req = urllib.request.Request(
            "https://registry.npmjs.org/three/latest",
            headers={"Accept": "application/json", "User-Agent": "dotLab-live-docs"},
        )
        with urllib.request.urlopen(req, timeout=8) as r:
            data = json.loads(r.read().decode())
        ver = data.get("version") or "?"
        note = (
            f"\n\n## npm three@latest\nRegistered version at refresh: **{ver}**\n"
            f"(Confirm package.json engines; prefer locked project version.)\n"
        )
        text = THREE_MD.read_text(encoding="utf-8")
        if "npm three@latest" not in text:
            THREE_MD.write_text(text.rstrip() + note, encoding="utf-8")
        meta["three_npm"] = ver
        meta["network"] = True
        meta["ok"] = True
        META.write_text(json.dumps(meta, indent=2), encoding="utf-8")
    except Exception as e:
        meta["ok"] = True
        meta["network"] = False
        meta["network_error"] = str(e)[:200]
    return meta


def status() -> dict:
    return {
        "three": THREE_MD.is_file(),
        "pixel": PIXEL_MD.is_file(),
        "latest": (LIVE / "LATEST.md").is_file(),
        "meta": json.loads(META.read_text()) if META.is_file() else {},
        "paths": {"three": str(THREE_MD), "pixel": str(PIXEL_MD)},
    }


def main() -> int:
    ap = argparse.ArgumentParser(description="dotLab live docs")
    sub = ap.add_subparsers(dest="cmd")
    sub.add_parser("status")
    p = sub.add_parser("refresh")
    p.add_argument("--offline", action="store_true", default=True)
    p.add_argument("--network", action="store_true", help="allow npm version probe")
    args = ap.parse_args()
    if args.cmd == "status":
        print(json.dumps(status(), indent=2))
        return 0
    if args.cmd == "refresh":
        offline = not getattr(args, "network", False)
        print(json.dumps(refresh(offline=offline), indent=2))
        return 0
    # default: ensure stubs
    print(json.dumps(refresh(offline=True), indent=2))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
