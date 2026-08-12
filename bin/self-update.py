#!/usr/bin/env python3
"""
Gamemaster — Self-Update Engine
Keeps models, knowledge (live docs), and custom Modelfile up to date.
Cost: $0. Optional internet for live knowledge + ollama pull.
"""
from __future__ import annotations

import argparse
import json
import os
import re
import subprocess
import sys
import time
import urllib.error
import urllib.request
from datetime import datetime, timezone
from pathlib import Path

from gmcommon import CONFIG, ROOT, ensure_ollama

LIVE = ROOT / "knowledge" / "live"
VERSION_PATH = CONFIG / "version.json"

# Sources (best-effort; failures are non-fatal)
SOURCES = {
    "solana_mobile_llms": "https://docs.solanamobile.com/llms.txt",
    "three_package": "https://registry.npmjs.org/three/latest",
    "mwa_web3_npm": "https://registry.npmjs.org/@solana-mobile/mobile-wallet-adapter-protocol-web3js/latest",
    "three_manual": "https://threejs.org/manual/en/fundamentals.html",
    "fragcoord": "https://fragcoord.xyz/",
}


def run(cmd: list[str] | str, timeout: int = 600) -> tuple[int, str]:
    if isinstance(cmd, str):
        shell = True
        args = cmd
    else:
        shell = False
        args = cmd
    try:
        p = subprocess.run(
            args,
            shell=shell,
            cwd=str(ROOT),
            capture_output=True,
            text=True,
            timeout=timeout,
        )
        out = (p.stdout or "") + (p.stderr or "")
        return p.returncode, out
    except subprocess.TimeoutExpired:
        return 124, "timeout"
    except Exception as e:
        return 1, str(e)


def fetch(url: str, timeout: float = 20.0) -> str | None:
    try:
        req = urllib.request.Request(
            url,
            headers={"User-Agent": "GamemasterMAX-SelfUpdate/1.0"},
        )
        with urllib.request.urlopen(req, timeout=timeout) as r:
            return r.read().decode("utf-8", errors="replace")
    except Exception as e:
        print(f"  ⚠ fetch fail {url}: {e}")
        return None


def ensure_dirs() -> None:
    LIVE.mkdir(parents=True, exist_ok=True)
    CONFIG.mkdir(parents=True, exist_ok=True)


def update_knowledge_live() -> dict:
    """Pull high-signal live snippets into knowledge/live/."""
    ensure_dirs()
    meta: dict = {"fetched_at": datetime.now(timezone.utc).isoformat(), "files": []}

    # Solana Mobile docs index
    llms = fetch(SOURCES["solana_mobile_llms"])
    if llms:
        # keep first ~80KB + extract interesting paths
        text = llms[:80000]
        paths = re.findall(r"(?m)^[\-\*]?\s*\[?([^\]]+)\]?\(?([^\)]*solanamobile[^\)]*)\)?", llms)
        summary = [
            "# Live: Solana Mobile docs index (auto)",
            f"# fetched: {meta['fetched_at']}",
            "",
            "Use these paths as hints; prefer stable MWA + Expo patterns in solana-seeker.md.",
            "",
            "```",
            text[:15000],
            "```",
            "",
            "## Extracted link hints",
        ]
        for a, b in paths[:40]:
            summary.append(f"- {a} {b}".strip())
        out = LIVE / "solana-mobile-llms.md"
        out.write_text("\n".join(summary), encoding="utf-8")
        meta["files"].append(str(out.name))
        print(f"  ✓ {out.name}")

    # three.js latest version
    three = fetch(SOURCES["three_package"])
    if three:
        try:
            data = json.loads(three)
            ver = data.get("version", "?")
        except json.JSONDecodeError:
            ver = "?"
        out = LIVE / "three-version.md"
        out.write_text(
            f"# Live: three npm\n\nlatest: `{ver}`\n\nfetched: {meta['fetched_at']}\n"
            f"\nPrefer `three` ^{ver.split('.')[0] if ver != '?' else '0.170'} in new scaffolds; "
            f"APIs r152+ ColorManagement/SRGB still apply.\n",
            encoding="utf-8",
        )
        meta["files"].append(out.name)
        meta["three_version"] = ver
        print(f"  ✓ three@{ver}")

    # MWA package version
    mwa = fetch(SOURCES["mwa_web3_npm"])
    if mwa:
        try:
            ver = json.loads(mwa).get("version", "?")
        except json.JSONDecodeError:
            ver = "?"
        out = LIVE / "mwa-web3js-version.md"
        out.write_text(
            f"# Live: @solana-mobile/mobile-wallet-adapter-protocol-web3js\n\n"
            f"latest: `{ver}`\n\nfetched: {meta['fetched_at']}\n"
            f"\nDefault import style still: `transact` + `authorize` + sign helpers. "
            f"Verify changelog if authorize options differ (`cluster` vs `chain`).\n",
            encoding="utf-8",
        )
        meta["files"].append(out.name)
        meta["mwa_version"] = ver
        print(f"  ✓ mwa-web3js@{ver}")

    # Write consolidated cheat for model injection
    # FragCoord / creative coding pulse
    fc = fetch(SOURCES["fragcoord"])
    if fc:
        out = LIVE / "fragcoord-pulse.md"
        out.write_text(
            f"# Live: FragCoord.xyz pulse\n\nfetched: {meta['fetched_at']}\n\n"
            "FragCoord remains the reference for multipass GLSL editors "
            "(uniforms, buffers, audio/keyboard, Shadertoy import, language convert).\n"
            "Gamemaster implements multipass via `scaffold shader-lab` + knowledge/multipass.md.\n",
            encoding="utf-8",
        )
        meta["files"].append(out.name)
        print(f"  ✓ {out.name}")

    cheat = LIVE / "LATEST.md"
    lines = [
        "# LIVE KNOWLEDGE (auto-updated)",
        f"Updated: {meta['fetched_at']}",
        "",
        "When scaffolding, prefer these package versions if present:",
    ]
    if "three_version" in meta:
        lines.append(f"- three@{meta['three_version']}")
    if "mwa_version" in meta:
        lines.append(f"- @solana-mobile/mobile-wallet-adapter-protocol-web3js@{meta['mwa_version']}")
    lines.append("")
    lines.append("Domains: three.js games, multipass shaders, Solana Seeker, all genres.")
    lines.append("Full offline patterns: solana-seeker.md, shaders-glsl-tsl.md, multipass.md, threejs-*.md.")
    cheat.write_text("\n".join(lines) + "\n", encoding="utf-8")
    meta["files"].append("LATEST.md")

    (LIVE / "meta.json").write_text(json.dumps(meta, indent=2), encoding="utf-8")
    return meta


def pull_models(profile: str = "dual") -> None:
    bases = {
        "max": ["qwen3-coder:30b"],
        "dense": ["qwen2.5-coder:32b"],
        "dual": ["qwen3-coder:30b", "qwen2.5-coder:32b"],
        "balanced": ["qwen2.5-coder:14b"],
    }.get(profile, ["qwen3-coder:30b"])
    for m in bases:
        print(f"  → ollama pull {m}")
        code, out = run(["ollama", "pull", m], timeout=3600)
        if code != 0:
            print(f"  ⚠ pull {m} failed: {out[-400:]}")
        else:
            print(f"  ✓ {m}")
    # always refresh tiny embed + 7b if present policy
    run(["ollama", "pull", "qwen2.5-coder:7b"], timeout=1800)
    run(["ollama", "pull", "nomic-embed-text"], timeout=600)


def rebuild_modelfile_only() -> None:
    """Re-apply Modelfile onto existing weights (no pull)."""
    mf = ROOT / "Modelfile"
    tmp = ROOT / "config" / ".Modelfile.apply"
    text = mf.read_text(encoding="utf-8")
    # keep FROM as-is; install.sh is what rebases the FROM line
    tmp.write_text(text, encoding="utf-8")
    print("  → ollama create gamemaster (Modelfile only)")
    code, out = run(["ollama", "create", "gamemaster", "-f", str(tmp)], timeout=600)
    print(out[-800:] if len(out) > 800 else out)
    if code != 0:
        print("  ⚠ ollama create gamemaster failed")
    # dense if present
    code2, tags = run(["ollama", "list"], timeout=20)
    if "gamemaster-dense" in tags or "qwen2.5-coder:32b" in tags:
        print("  → ollama create gamemaster-dense (Modelfile only)")
        dense = text.replace("FROM qwen3-coder:30b", "FROM qwen2.5-coder:32b")
        tmp.write_text(dense, encoding="utf-8")
        run(["ollama", "create", "gamemaster-dense", "-f", str(tmp)], timeout=600)
    try:
        tmp.unlink()
    except OSError:
        pass


def rebuild_custom(profile: str = "dual") -> None:
    """Invoke install.sh profile rebuild."""
    flag = {
        "max": "--max",
        "dense": "--dense",
        "dual": "--dual",
        "balanced": "--14b",
        "fast": "--7b",
    }.get(profile, "--dual")
    print(f"  → ./install.sh {flag}")
    code, out = run(["bash", str(ROOT / "install.sh"), flag], timeout=3600)
    print(out[-1500:] if len(out) > 1500 else out)
    if code != 0:
        print("  ⚠ install.sh exit", code)


def smoke() -> bool:
    code, out = run(
        [
            "ollama",
            "run",
            "gamemaster",
            "Reply with exactly: GAMEMASTER_MAX_OK",
        ],
        timeout=180,
    )
    ok = "GAMEMASTER_MAX_OK" in out or "GAMEFORGE" in out.upper()
    print("  smoke:", out.strip()[:200])
    return ok


def write_version(extra: dict) -> None:
    data = {
        "product": "Gamemaster",
        "updated_at": datetime.now(timezone.utc).isoformat(),
        "root": str(ROOT),
        **extra,
    }
    if VERSION_PATH.exists():
        try:
            prev = json.loads(VERSION_PATH.read_text())
            data["previous"] = prev.get("updated_at")
        except Exception:
            pass
    VERSION_PATH.write_text(json.dumps(data, indent=2), encoding="utf-8")
    print(f"  ✓ version → {VERSION_PATH}")


def main() -> int:
    ap = argparse.ArgumentParser(description="Gamemaster self-update")
    ap.add_argument("--quick", action="store_true", help="Skip web knowledge scrape")
    ap.add_argument("--knowledge", action="store_true", help="Only knowledge live fetch")
    ap.add_argument("--models", action="store_true", help="Only pull+rebuild models")
    ap.add_argument(
        "--modelfile",
        action="store_true",
        help="Only re-apply Modelfile (no pull) — use after prompt/knowledge identity changes",
    )
    ap.add_argument("--profile", default="dual", choices=["max", "dense", "dual", "balanced", "fast"])
    ap.add_argument("--no-smoke", action="store_true")
    args = ap.parse_args()

    print("╔══════════════════════════════════════════════╗")
    print("║  Gamemaster — Self-Update                 ║")
    print("╚══════════════════════════════════════════════╝")

    ensure_dirs()
    meta: dict = {}

    if args.modelfile:
        print("→ Re-apply Modelfile…")
        ensure_ollama()
        rebuild_modelfile_only()
        if not args.no_smoke:
            print("→ Smoke…")
            meta["smoke_ok"] = smoke()
        write_version(meta)
        print("\n✅ Modelfile applied. New system prompt is live.")
        return 0

    only_k = args.knowledge
    only_m = args.models
    do_k = only_k or (not only_m and not args.quick)
    do_m = only_m or (not only_k)

    if args.quick and not only_k:
        do_k = False
        do_m = True

    if do_k:
        print("→ Live knowledge…")
        meta["knowledge"] = update_knowledge_live()

    if do_m:
        print("→ Models…")
        ensure_ollama()
        pull_models(args.profile)
        rebuild_custom(args.profile)
        meta["profile"] = args.profile

    if not args.no_smoke and do_m:
        print("→ Smoke…")
        meta["smoke_ok"] = smoke()

    write_version(meta)
    print("\n✅ Self-update done. New prompt is live: gamemaster \"…\"")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
