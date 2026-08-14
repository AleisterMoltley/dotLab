#!/usr/bin/env python3
"""
Anti-slop host layer — reject generic AI game output.

- Format-on-write (Biome → Prettier → basic normalize)
- Palette / silence-on-hit / contrast helpers for verify
- Taste actions: keep | tighter | juice (host patch, no free chat)
- Anti-slop gallery text for RAG
- Optional visual distance stub (histogram) for screenshots
- Slot-JSON-only contract helpers

  gamemaster antislope check -p DIR
  gamemaster antislope format -p DIR
  gamemaster antislope taste -p DIR tighter
"""
from __future__ import annotations

import json
import os
import re
import shutil
import struct
import zlib
from pathlib import Path
from typing import Any

from gmcommon import KNOWLEDGE, ROOT, meta_dir, run

# Immutable host paths — LLM must not full-replace
IMMUTABLE_PREFIXES = (
    "src/craft/",
    "src/look/",
    "src/body/",
    "src/kits/",
    "lib/craft/",
    "lib/look/",
    "lib/body/",
)
IMMUTABLE_FILES = frozenset(
    {
        "src/craft/juice.js",
        "src/craft/audio.js",
        "src/craft/palette.js",
        "src/craft/index.js",
        "src/craft/punch.js",
        "src/craft/camera.js",
        "src/craft/pool.js",
        "src/craft/blob.js",
        "src/craft/brain.js",
        "src/craft/scale.js",
        "src/craft/motion.js",
        "src/craft/recoil.js",
        "src/craft/impact.js",
        "src/craft/mark.js",
        "src/craft/vignette.js",
        "src/look/index.js",
        "src/look/rig.js",
        "src/look/cards.js",
        "src/body/player.js",
        "src/body/enemy.js",
        "src/body/index.js",
        "src/craft/engine.js",
        "src/craft/director.js",
        "src/kits/README.md",
    }
)

# NEON INK locked tokens (must appear for neon ship-bar shoots)
NEON_HEX = {
    "0x0a0612",
    "0xff2bd6",
    "0x00f0ff",
    "0xb8ff00",
    "0x0A0612",
    "0xFF2BD6",
    "0x00F0FF",
    "0xB8FF00",
}
# Classic slop hues (AI purple fog / green capsule)
SLOP_PALETTE_RX = re.compile(
    r"0x87a0b8|0x88c070|0x7c3aed|0xa855f7|0xc084fc|0x22c55e|0x4ade80|"
    r"#87a0b8|#7c3aed|#a855f7|purple haze|default green capsule",
    re.I,
)

ANTI_SLOP_DIR = KNOWLEDGE / "anti-slop"


def is_immutable_path(rel: str) -> bool:
    rel = (rel or "").replace("\\", "/").lstrip("./")
    if rel in IMMUTABLE_FILES:
        return True
    return any(rel.startswith(p) for p in IMMUTABLE_PREFIXES)


def ensure_kits_readme(project: Path) -> None:
    kits = project / "src" / "kits"
    kits.mkdir(parents=True, exist_ok=True)
    readme = kits / "README.md"
    if not readme.is_file():
        readme.write_text(
            "# Host genre kits (immutable)\n\n"
            "Do not rewrite. Novelty goes in `src/systems/` or `src/slots/`.\n"
            "LLM fills slot JSON only; host owns the machine.\n",
            encoding="utf-8",
        )


def format_js_text(text: str) -> str:
    """Cheap normalize if Biome/Prettier unavailable: trim trailing space, ensure newline."""
    lines = [ln.rstrip() for ln in (text or "").splitlines()]
    out = "\n".join(lines)
    if out and not out.endswith("\n"):
        out += "\n"
    return out


def format_file(path: Path) -> dict[str, Any]:
    """Format one file with biome/prettier if installed, else normalize."""
    if not path.is_file():
        return {"ok": False, "error": "missing"}
    suffix = path.suffix.lower()
    if suffix not in (".js", ".mjs", ".ts", ".tsx", ".json", ".css", ".html"):
        return {"ok": True, "skipped": True}
    raw = path.read_text(encoding="utf-8", errors="ignore")
    # Prefer biome
    biome = shutil.which("biome")
    if biome and suffix in (".js", ".mjs", ".ts", ".tsx", ".json"):
        code, out = run([biome, "format", "--write", str(path)], timeout=30)
        if code == 0:
            return {"ok": True, "tool": "biome", "path": str(path)}
    prettier = shutil.which("prettier")
    if prettier:
        code, out = run(
            [prettier, "--write", str(path)],
            timeout=30,
        )
        if code == 0:
            return {"ok": True, "tool": "prettier", "path": str(path)}
    # fallback normalize
    path.write_text(format_js_text(raw), encoding="utf-8")
    return {"ok": True, "tool": "normalize", "path": str(path)}


def format_project(project: Path, rels: list[str] | None = None) -> dict[str, Any]:
    project = Path(project)
    done = []
    if rels:
        paths = [project / r for r in rels]
    else:
        paths = []
        for name in ("src/game.js", "src/main.js", "src/slots/runtime.js"):
            p = project / name
            if p.is_file():
                paths.append(p)
    for p in paths:
        try:
            r = format_file(p)
            if r.get("ok") and not r.get("skipped"):
                done.append(r)
        except Exception:
            continue
    return {"ok": True, "formatted": done}


def check_silence_on_hit(js: str) -> tuple[bool, str]:
    """Shoot loops must call juice/sfx on damage path."""
    if not re.search(r"shoot|fireCd|fireRpm|damage|hitstop", js, re.I):
        return True, "n/a (not a shoot loop)"
    has_juice = bool(
        re.search(
            r"TimeJuice|hitstop|timeJuice\.|sfx\.|pulseShake|makeShake|pxShake|blip\(|shakeT|punch\(",
            js,
        )
    )
    has_damage_path = bool(re.search(r"damage|onHit|hitEnemy|applyDamage|hp\s*[-=]", js))
    if has_damage_path and not has_juice:
        return False, "silence on hit — missing juice/sfx on damage path"
    if re.search(r"shoot|fire", js, re.I) and not has_juice:
        return False, "shoot loop without juice stack"
    return True, "juice present" if has_juice else "ok"


def check_palette_lock(project: Path, js: str, meta: dict | None = None) -> tuple[bool, str]:
    """Neon ship-bar must not drift into slop purples/greens; craft palette preferred."""
    meta = meta or {}
    props = str(meta.get("props") or meta.get("palette_id") or "").lower()
    ship = str(meta.get("shipBar") or "").lower()
    if SLOP_PALETTE_RX.search(js):
        # allow fixture slice-pass which uses 0x87a0b8 deliberately? Fail for real projects with craft
        if (project / "src" / "craft" / "palette.js").is_file() or ship == "neon-ink" or props == "neon":
            return False, "slop palette hues (purple/green fog) — use craft/palette NEON INK"
    if props == "neon" or ship == "neon-ink" or re.search(r"neon|shipBar.*neon", js, re.I):
        hits = sum(1 for h in ("0x0a0612", "0xff2bd6", "0x00f0ff", "0xb8ff00") if h in js.lower() or h.upper().replace("0X", "0x") in js)
        # also accept imported palette
        if (project / "src" / "craft" / "palette.js").is_file() or "craft/palette" in js or "toThreePalette" in js:
            return True, "neon craft palette"
        if hits < 2 and re.search(r"0x[0-9a-f]{6}", js, re.I):
            # has hard-coded colors but not neon tokens
            if SLOP_PALETTE_RX.search(js):
                return False, "neon ship-bar with slop colors"
    return True, "palette ok"


def check_feel_ranges(js: str) -> tuple[bool, str]:
    """Reject CONFIG all-ones / absurd floats."""
    bad = []
    # all 1s smell
    if re.search(r"gravity\s*:\s*1\b", js) and re.search(r"moveSpeed\s*:\s*1\b", js):
        bad.append("CONFIG looks like 1/1/1 placeholder")
    m = re.search(r"gravity\s*:\s*([0-9.]+)", js)
    if m:
        g = float(m.group(1))
        if g < 8 or g > 50:
            bad.append(f"gravity {g} out of range")
    m = re.search(r"coyoteMs\s*:\s*([0-9.]+)", js)
    if m:
        c = float(m.group(1))
        if c < 40 or c > 200:
            bad.append(f"coyoteMs {c} out of range")
    if bad:
        return False, "; ".join(bad)
    return True, "feel ranges ok"


def check_no_green_capsule(js: str) -> tuple[bool, str]:
    if re.search(r"CapsuleGeometry|capsule", js, re.I) and re.search(
        r"0x00ff00|0x22c55e|0x4ade80",
        js,
        re.I,
    ):
        return False, "green capsule slop"
    return True, "ok"


def evaluate_antislope(project: Path, js: str = "", meta: dict | None = None) -> dict[str, Any]:
    project = Path(project)
    if not js:
        for rel in ("src/game.js", "src/main.js"):
            p = project / rel
            if p.is_file():
                js += p.read_text(encoding="utf-8", errors="ignore") + "\n"
    if meta is None:
        meta = {}
        for name in (".dotlab", ".gamemaster"):
            sp = project / name / "slice.json"
            if sp.is_file():
                try:
                    meta = json.loads(sp.read_text(encoding="utf-8"))
                except Exception:
                    pass
                break
    checks = {}
    for key, fn in (
        ("silence_on_hit", lambda: check_silence_on_hit(js)),
        ("palette_lock", lambda: check_palette_lock(project, js, meta)),
        ("feel_ranges", lambda: check_feel_ranges(js)),
        ("no_green_capsule", lambda: check_no_green_capsule(js)),
    ):
        ok, detail = fn()
        checks[key] = {"ok": ok, "detail": detail}
    failed = [k for k, v in checks.items() if not v["ok"]]
    return {
        "ok": not failed,
        "failed": failed,
        "checks": checks,
        "p0_fail": failed,  # all anti-slop treated as P0 when enforced
    }


# ── Taste buttons (host only) ───────────────────────────────────────────


def taste_action(project: Path, action: str) -> dict[str, Any]:
    """
    keep → log accept pair + prefs like
    tighter → gravity↑ friction↑ (host patch)
    juice → juice multiplier (host patch)
    """
    import patch as patchlib
    import quality as qualitylib

    project = Path(project).expanduser().resolve()
    action = (action or "").strip().lower()

    def _stamp(act: str) -> None:
        try:
            import hands as handslib

            handslib.timeline_add(project, act)
        except Exception:
            pass
    if action in ("keep", "accept"):
        try:
            qualitylib.log_accept_pair(
                project,
                instruction="user: keep",
                before="",
                after="accepted",
                kind="taste_keep",
            )
        except Exception:
            pass
        try:
            import prefs as prefslib

            path = prefslib.project_prefs_path(project)
            data = prefslib.load_json(path)
            prefslib.add_unique(data.setdefault("likes", []), "keep this feel")
            prefslib.append_history(data, "taste-keep", "dashboard")
            prefslib.save_json(path, data)
        except Exception:
            pass
        try:
            import hands as handslib

            handslib.timeline_add(project, "keep")
        except Exception:
            pass
        return {"ok": True, "action": "keep", "summary": "Kept — logged as accept pair."}

    if action in ("tighter", "tight", "snappy"):
        r = patchlib.try_patch(project, "snappy tighter controls less floaty")
        if r and r.get("ok"):
            _stamp("tighter")
            return {"ok": True, "action": "tighter", "summary": r.get("summary"), "written": r.get("written")}
        # force feel
        spec = patchlib.load_spec(project)
        if not spec:
            return {"ok": False, "error": "no slice to tighten"}
        patchlib._ensure_counts(spec)
        feel = spec["feel"]
        feel["gravity"] = min(40.0, float(feel.get("gravity", 24)) * 1.12)
        feel["friction"] = min(40.0, float(feel.get("friction", 26)) * 1.15)
        feel["accel"] = min(70.0, float(feel.get("accel", 42)) * 1.1)
        patchlib.save_spec(project, spec)
        import slice as slicelib

        written = slicelib.write_slice(project, spec)
        _stamp("tighter")
        return {"ok": True, "action": "tighter", "summary": "Host tightened gravity/friction/accel.", "written": written}

    if action in ("juice", "more-juice", "juicier"):
        r = patchlib.try_patch(project, "more juice screen shake hitstop")
        if r and r.get("ok"):
            _stamp("juice")
            return {"ok": True, "action": "juice", "summary": r.get("summary"), "written": r.get("written")}
        spec = patchlib.load_spec(project)
        if not spec:
            return {"ok": False, "error": "no slice"}
        patchlib._ensure_counts(spec)
        spec["juice"] = min(2.5, float(spec.get("juice", 1.0)) * 1.35)
        feel = spec["feel"]
        feel["hitstopMs"] = int(min(80, float(feel.get("hitstopMs", 40)) * 1.2))
        feel["shakeHit"] = min(0.35, float(feel.get("shakeHit", 0.12)) * 1.25)
        patchlib.save_spec(project, spec)
        import slice as slicelib

        written = slicelib.write_slice(project, spec)
        _stamp("juice")
        return {"ok": True, "action": "juice", "summary": "Host boosted juice/hitstop/shake.", "written": written}

    return {"ok": False, "error": f"unknown action {action} (keep|tighter|juice)"}


# ── Anti-slop gallery for RAG ───────────────────────────────────────────


def gallery_prompt_block(query: str = "", max_chars: int = 2200) -> str:
    if not ANTI_SLOP_DIR.is_dir():
        return ""
    parts = [
        "# Anti-slop gallery (FAIL patterns — do not reproduce)\n"
        "These are rejected outputs. Match PASS ship bar instead.\n"
    ]
    used = len(parts[0])
    files = sorted(ANTI_SLOP_DIR.glob("*.md"))
    q = (query or "").lower()
    # prefer keyword overlap
    scored = []
    for f in files:
        text = f.read_text(encoding="utf-8", errors="ignore")[:800]
        score = sum(1 for w in q.split() if len(w) > 3 and w in text.lower())
        scored.append((score, f, text))
    scored.sort(key=lambda x: -x[0])
    for _, f, text in scored:
        block = f"\n## {f.name}\n{text}\n"
        if used + len(block) > max_chars:
            break
        parts.append(block)
        used += len(block)
    return "".join(parts) if len(parts) > 1 else ""


# ── Visual distance stub (PNG histogram, no ML deps) ────────────────────


def _paeth(a: int, b: int, c: int) -> int:
    p = a + b - c
    pa, pb, pc = abs(p - a), abs(p - b), abs(p - c)
    if pa <= pb and pa <= pc:
        return a
    if pb <= pc:
        return b
    return c


def _png_rows(path: Path) -> tuple[int, int, int, list[bytes]] | None:
    """Decode 8-bit RGB/RGBA PNG rows with filters applied."""
    try:
        data = path.read_bytes()
    except OSError:
        return None
    if data[:8] != b"\x89PNG\r\n\x1a\n":
        return None
    pos = 8
    width = height = 0
    bit_depth = color_type = 0
    idat = b""
    while pos + 8 <= len(data):
        length = struct.unpack(">I", data[pos : pos + 4])[0]
        ctype = data[pos + 4 : pos + 8]
        chunk = data[pos + 8 : pos + 8 + length]
        pos += 12 + length
        if ctype == b"IHDR":
            width, height, bit_depth, color_type = struct.unpack(">IIBB", chunk[:10])
        elif ctype == b"IDAT":
            idat += chunk
        elif ctype == b"IEND":
            break
    if not width or not idat:
        return None
    try:
        raw = zlib.decompress(idat)
    except Exception:
        return None
    bpp = {2: 3, 6: 4}.get(color_type, 0)
    if bit_depth != 8 or bpp == 0:
        return None
    stride = width * bpp
    prev = bytearray(stride)
    rows: list[bytes] = []
    pos = 0
    for _y in range(height):
        if pos + 1 + stride > len(raw):
            break
        ftype = raw[pos]
        pos += 1
        filt = raw[pos : pos + stride]
        pos += stride
        recon = bytearray(stride)
        for i in range(stride):
            left = recon[i - bpp] if i >= bpp else 0
            up = prev[i]
            ul = prev[i - bpp] if i >= bpp else 0
            x = filt[i]
            if ftype == 1:
                x = (x + left) & 255
            elif ftype == 2:
                x = (x + up) & 255
            elif ftype == 3:
                x = (x + ((left + up) >> 1)) & 255
            elif ftype == 4:
                x = (x + _paeth(left, up, ul)) & 255
            recon[i] = x
        rows.append(bytes(recon))
        prev = recon
    if not rows:
        return None
    return width, height, bpp, rows


def _png_mean_rgb(path: Path) -> tuple[float, float, float] | None:
    """Minimal PNG reader for 8-bit RGB/RGBA — mean color."""
    decoded = _png_rows(Path(path))
    if not decoded:
        return None
    width, height, bpp, rows = decoded
    rs = gs = bs = n = 0
    for y in range(0, height, 8):
        row = rows[y]
        for x in range(0, width, 8):
            i = x * bpp
            if i + 2 >= len(row):
                break
            rs += row[i]
            gs += row[i + 1]
            bs += row[i + 2]
            n += 1
    if not n:
        return None
    return rs / n, gs / n, bs / n


def visual_distance(path_a: Path, path_b: Path) -> dict[str, Any]:
    """Cheap RGB mean L2 distance in 0–441 range (max sqrt(3*255^2))."""
    a = _png_mean_rgb(Path(path_a))
    b = _png_mean_rgb(Path(path_b))
    if not a or not b:
        return {"ok": False, "error": "need two readable 8-bit RGB PNGs"}
    dist = ((a[0] - b[0]) ** 2 + (a[1] - b[1]) ** 2 + (a[2] - b[2]) ** 2) ** 0.5
    # heuristic: very green/purple mean flags slop vs neon void
    return {
        "ok": True,
        "distance": round(dist, 2),
        "mean_a": [round(x, 1) for x in a],
        "mean_b": [round(x, 1) for x in b],
        "far": dist > 80,
    }


def analyze_frame(path: Path) -> dict[str, Any]:
    """Variance, hue clusters, edge density — does the place read in one second?"""
    samples = _png_samples(Path(path))
    if not samples:
        return {"ok": False, "error": "unreadable png"}
    n = len(samples)
    mean_r = sum(s[0] for s in samples) / n
    mean_g = sum(s[1] for s in samples) / n
    mean_b = sum(s[2] for s in samples) / n
    var = sum((s[0] - mean_r) ** 2 + (s[1] - mean_g) ** 2 + (s[2] - mean_b) ** 2 for s in samples) / n
    hues: dict[int, int] = {}
    for r, g, b in samples:
        mx = max(r, g, b)
        mn = min(r, g, b)
        if mx - mn < 12:
            bucket = -1
        elif mx == r:
            bucket = int(((g - b) / (mx - mn + 1e-6)) % 6)
        elif mx == g:
            bucket = int((2 + (b - r) / (mx - mn + 1e-6)) % 6)
        else:
            bucket = int((4 + (r - g) / (mx - mn + 1e-6)) % 6)
        hues[bucket] = hues.get(bucket, 0) + 1
    clusters = sum(1 for c, k in hues.items() if c >= 0 and k > n * 0.035)
    edges = 0
    # neighbor contrast along the sample stream
    for i in range(1, n):
        a, b = samples[i - 1], samples[i]
        if abs(a[0] - b[0]) + abs(a[1] - b[1]) + abs(a[2] - b[2]) > 48:
            edges += 1
    edge_ratio = edges / max(1, n - 1)
    hints: list[str] = []
    if var < 180:
        hints.append("flat_frame")
    if clusters < 2:
        hints.append("few_hues")
    if edge_ratio < 0.04:
        hints.append("no_silhouette")
    return {
        "ok": True,
        "variance": round(var, 1),
        "hue_clusters": clusters,
        "edge_ratio": round(edge_ratio, 3),
        "mean": [round(mean_r, 1), round(mean_g, 1), round(mean_b, 1)],
        "hints": hints,
        "readable": not hints,
    }


def _png_samples(path: Path) -> list[tuple[float, float, float]]:
    decoded = _png_rows(Path(path))
    if not decoded:
        return []
    width, _height, bpp, rows = decoded
    out: list[tuple[float, float, float]] = []
    step = 6
    for y in range(0, len(rows), step):
        row = rows[y]
        for x in range(0, width, step):
            i = x * bpp
            if i + 2 >= len(row):
                break
            out.append((float(row[i]), float(row[i + 1]), float(row[i + 2])))
    return out


def screenshot_slop_hint(path: Path) -> dict[str, Any]:
    """Single-frame heuristic: near-black = empty, neon-green dominant = capsule."""
    m = _png_mean_rgb(Path(path))
    if not m:
        return {"ok": False, "error": "unreadable png"}
    r, g, b = m
    lum = 0.2126 * r + 0.7152 * g + 0.0722 * b
    hints = []
    if lum < 8:
        hints.append("near_black_frame")
    if g > r + 40 and g > b + 40 and g > 100:
        hints.append("green_dominant")
    if b > 120 and r > 80 and g < 80:
        hints.append("purple_fog_like")
    look = analyze_frame(path)
    if look.get("ok"):
        for h in look.get("hints") or []:
            if h not in hints:
                hints.append(h)
    return {
        "ok": True,
        "mean": [round(r, 1), round(g, 1), round(b, 1)],
        "luminance": round(lum, 1),
        "variance": look.get("variance"),
        "hue_clusters": look.get("hue_clusters"),
        "edge_ratio": look.get("edge_ratio"),
        "hints": hints,
        "slop_risk": bool(hints),
        "readable": look.get("readable", not hints),
    }


# ── Slot-JSON only contract text ────────────────────────────────────────

SLOT_JSON_ONLY = """
SLOT-JSON CONTRACT (anti-slop):
- Do NOT rewrite src/craft/* or host kits.
- Prefer emit JSON only for content:
  {"novelty_id":"…","bark_lines":["…"],"enemy_count":8,"room_notes":"…"}
- Novelty implementation: only src/systems/* or src/slots/* via apply_patch.
- Host owns feel, juice, palette, camera, loop machine.
""".strip()


def main() -> int:
    import argparse

    ap = argparse.ArgumentParser(description="Anti-slop host tools")
    sub = ap.add_subparsers(dest="cmd")
    p = sub.add_parser("check")
    p.add_argument("-p", "--project", required=True)
    p = sub.add_parser("format")
    p.add_argument("-p", "--project", required=True)
    p = sub.add_parser("taste")
    p.add_argument("-p", "--project", required=True)
    p.add_argument("action", choices=["keep", "tighter", "juice"])
    p = sub.add_parser("gallery")
    p.add_argument("query", nargs="?", default="")
    args = ap.parse_args()
    if args.cmd == "check":
        print(json.dumps(evaluate_antislope(Path(args.project)), indent=2))
        return 0
    if args.cmd == "format":
        print(json.dumps(format_project(Path(args.project)), indent=2))
        return 0
    if args.cmd == "taste":
        print(json.dumps(taste_action(Path(args.project), args.action), indent=2))
        return 0
    if args.cmd == "gallery":
        print(gallery_prompt_block(args.query))
        return 0
    ap.print_help()
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
