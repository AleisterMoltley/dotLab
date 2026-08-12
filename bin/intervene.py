#!/usr/bin/env python3
"""
Grok → local intervention.

Applies the full local stack so Gamemaster behaves like a game pair:
  - Ollama env (Metal-friendly)
  - gamemaster / gamemaster-flash / gamemaster-dense Modelfiles
  - active profile, warmup, smoke

  gamemaster intervene
  gamemaster intervene --modelfile-only
  gamemaster intervene --warmup
  gamemaster intervene --status
"""
from __future__ import annotations

import argparse
import json
import os
import platform
import subprocess
import sys
import time
from datetime import datetime, timezone
from pathlib import Path

from gmcommon import CONFIG, DEFAULT_MODEL, DENSE_MODEL, ROOT, ensure_ollama, run

FLASH_MODEL = os.environ.get("GAMEMASTER_FLASH", "gamemaster-flash")
ENV_PATH = CONFIG / "ollama-env.sh"
PROFILE_PATH = CONFIG / "active-profile.json"

OLLAMA_ENV = """# Gamemaster TURBO — game-coding defaults (Apple Silicon friendly)
# Source from start / gamemaster CLI. Do not put secrets here.
export OLLAMA_FLASH_ATTENTION=1
export OLLAMA_KEEP_ALIVE=24h
# One heavy model at a time beats thrashing two 30Bs
export OLLAMA_NUM_PARALLEL=1
export OLLAMA_MAX_LOADED_MODELS=2
export OLLAMA_KV_CACHE_TYPE=q8_0
export OLLAMA_NUM_BATCH=512
export OLLAMA_SCHED_SPREAD=false
# Prefer Metal; leave runner free to pick
export OLLAMA_LLM_LIBRARY="${OLLAMA_LLM_LIBRARY:-}"
"""


def mem_gb() -> int:
    try:
        if platform.system() == "Darwin":
            out = subprocess.check_output(["sysctl", "-n", "hw.memsize"], text=True).strip()
            return int(int(out) / (1024**3))
    except Exception:
        pass
    return 16


def write_env() -> Path:
    CONFIG.mkdir(parents=True, exist_ok=True)
    ENV_PATH.write_text(OLLAMA_ENV.strip() + "\n", encoding="utf-8")
    return ENV_PATH


def detect_base() -> dict:
    """Pick bases from what is already installed."""
    code, out = run(["ollama", "list"], timeout=30)
    lines = out.lower() if out else ""
    max_base = "qwen3-coder:30b"
    dense_base = "qwen2.5-coder:32b"
    flash_base = "qwen2.5-coder:7b"
    if "qwen3-coder:30b" not in lines and "qwen2.5-coder:14b" in lines:
        max_base = "qwen2.5-coder:14b"
    if "qwen2.5-coder:32b" not in lines:
        dense_base = max_base
    if "qwen2.5-coder:7b" not in lines and "qwen2.5-coder:14b" in lines:
        flash_base = "qwen2.5-coder:14b"
    # RAM gate
    m = mem_gb()
    ctx = 16384
    if m < 24:
        ctx = 12288
        if max_base.startswith("qwen3"):
            # keep 30b if already installed; ctx already lower
            pass
    if m < 18 and "qwen2.5-coder:14b" in lines:
        max_base = "qwen2.5-coder:14b"
        ctx = 12288
    return {
        "max_base": max_base,
        "dense_base": dense_base,
        "flash_base": flash_base,
        "num_ctx": ctx,
        "mem_gb": m,
    }


def ollama_create(name: str, body: str) -> tuple[int, str]:
    tmp = CONFIG / f".Modelfile.{name.replace(':', '_')}"
    CONFIG.mkdir(parents=True, exist_ok=True)
    tmp.write_text(body, encoding="utf-8")
    code, out = run(["ollama", "create", name, "-f", str(tmp)], timeout=900)
    try:
        tmp.unlink()
    except OSError:
        pass
    return code, out


def apply_modelfiles(bases: dict | None = None) -> dict:
    import identity as identitylib

    bases = bases or detect_base()
    results: dict = {"ok": True, "created": [], "errors": []}

    # Sync repo Modelfiles from identity (single source of Grok)
    for p in identitylib.write_modelfiles():
        print(f"  ✓ sync {p.name}")

    # max — full Grok identity
    body = identitylib.modelfile_body(bases["max_base"], bases["num_ctx"])
    print(f"  → create {DEFAULT_MODEL} FROM {bases['max_base']} ctx={bases['num_ctx']} (Grok identity)")
    code, out = ollama_create(DEFAULT_MODEL, body)
    if code == 0:
        results["created"].append(DEFAULT_MODEL)
        print(f"  ✓ {DEFAULT_MODEL}")
    else:
        results["ok"] = False
        results["errors"].append(out[-400:])
        print(f"  ⚠ {DEFAULT_MODEL}: {out[-300:]}")

    # flash
    flash_ctx = min(4096, bases["num_ctx"])
    body_f = identitylib.flash_modelfile_body(bases["flash_base"], flash_ctx)
    print(f"  → create {FLASH_MODEL} FROM {bases['flash_base']} ctx={flash_ctx}")
    code, out = ollama_create(FLASH_MODEL, body_f)
    if code == 0:
        results["created"].append(FLASH_MODEL)
        print(f"  ✓ {FLASH_MODEL}")
    else:
        print(f"  ⚠ {FLASH_MODEL}: {out[-200:]}")

    # dense (optional)
    code, tags = run(["ollama", "list"], timeout=20)
    if bases["dense_base"] in (tags or "") or DENSE_MODEL in (tags or ""):
        body_d = identitylib.modelfile_body(bases["dense_base"], bases["num_ctx"])
        print(f"  → create {DENSE_MODEL} FROM {bases['dense_base']}")
        code, out = ollama_create(DENSE_MODEL, body_d)
        if code == 0:
            results["created"].append(DENSE_MODEL)
            print(f"  ✓ {DENSE_MODEL}")
        else:
            print(f"  ⚠ {DENSE_MODEL}: {out[-200:]}")

    # Seed global prefs with Grok taste if missing/thin
    try:
        import prefs as prefslib

        gpath = prefslib.GLOBAL_PREFS
        g = prefslib.load_json(gpath)
        if not g.get("identity"):
            prefslib.save_json(gpath, g)
            print(f"  ✓ prefs seeded with Grok taste → {gpath.name}")
    except Exception as e:
        print(f"  ⚠ prefs seed: {e}")

    profile = {
        "profile": "intervene",
        "identity": "grok-gamemaster",
        "base_model": bases["max_base"],
        "custom_model": DEFAULT_MODEL,
        "flash_model": FLASH_MODEL,
        "dense_model": DENSE_MODEL,
        "num_ctx": bases["num_ctx"],
        "mem_gb": bases["mem_gb"],
        "updated": datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ"),
        "craft": [
            "identity",
            "slice",
            "patch",
            "verify",
            "kit",
            "grok-craft",
            "grok-toolkit",
            "threejs-recipes",
        ],
    }
    PROFILE_PATH.write_text(json.dumps(profile, indent=2) + "\n", encoding="utf-8")
    results["profile"] = profile
    return results


def warmup(models: list[str] | None = None) -> None:
    models = models or [DEFAULT_MODEL, FLASH_MODEL]
    for model in models:
        print(f"  → warm {model}")
        payload = {
            "model": model,
            "messages": [{"role": "user", "content": "Reply OK"}],
            "stream": False,
            "keep_alive": "24h",
            "options": {"num_predict": 2, "temperature": 0, "num_ctx": 2048},
        }
        t0 = time.perf_counter()
        code, out = run(
            [
                sys.executable,
                "-c",
                "import json,urllib.request,sys;"
                f"p=json.loads(sys.argv[1]);"
                "r=urllib.request.Request('http://127.0.0.1:11434/api/chat',data=json.dumps(p).encode(),"
                "headers={'Content-Type':'application/json'},method='POST');"
                "print(urllib.request.urlopen(r,timeout=300).read().decode()[:200])",
                json.dumps(payload),
            ],
            timeout=320,
        )
        dt = time.perf_counter() - t0
        if code == 0:
            print(f"  ✓ {model} warm in {dt:.1f}s")
        else:
            print(f"  ⚠ {model} warm failed ({dt:.1f}s)")


def smoke() -> bool:
    code, out = run(
        ["ollama", "run", DEFAULT_MODEL, "Reply with exactly: GAMEMASTER_OK"],
        timeout=180,
    )
    ok = "GAMEMASTER_OK" in (out or "").upper() or "OK" in (out or "")
    print("  smoke:", (out or "").strip()[:180])
    return ok


def status() -> int:
    print("Gamemaster intervene status")
    print(f"  root: {ROOT}")
    print(f"  env:  {ENV_PATH} {'✓' if ENV_PATH.is_file() else 'missing'}")
    if PROFILE_PATH.is_file():
        try:
            print("  profile:", PROFILE_PATH.read_text(encoding="utf-8").strip())
        except Exception:
            pass
    bases = detect_base()
    print(f"  mem ~{bases['mem_gb']}GB · prefer ctx={bases['num_ctx']} · max_base={bases['max_base']}")
    code, out = run(["ollama", "list"], timeout=20)
    for name in (DEFAULT_MODEL, FLASH_MODEL, DENSE_MODEL, "qwen3-coder:30b", "qwen2.5-coder:7b"):
        mark = "✓" if name in (out or "") else "·"
        print(f"  {mark} {name}")
    # toolkit files
    for rel in (
        "knowledge/grok-craft.md",
        "knowledge/grok-toolkit.md",
        "knowledge/threejs-recipes.md",
        "bin/patch.py",
        "bin/slice.py",
        "Modelfile",
        "Modelfile.flash",
    ):
        p = ROOT / rel
        print(f"  {'✓' if p.is_file() else '✗'} {rel}")
    return 0


def main() -> int:
    ap = argparse.ArgumentParser(description="Install Grok craft into local Ollama + host tools")
    ap.add_argument("--modelfile-only", action="store_true", help="Only rebuild custom models")
    ap.add_argument("--warmup", action="store_true", help="Only warm models")
    ap.add_argument("--status", action="store_true")
    ap.add_argument("--no-smoke", action="store_true")
    ap.add_argument("--no-warmup", action="store_true")
    args = ap.parse_args()

    if args.status:
        return status()

    print("╔══════════════════════════════════════════╗")
    print("║  Gamemaster INTERVENE — local Grok       ║")
    print("╚══════════════════════════════════════════╝")

    if args.warmup:
        if not ensure_ollama(fatal=False):
            print("❌ Ollama offline")
            return 1
        warmup()
        return 0

    write_env()
    print(f"✓ env → {ENV_PATH}")

    if not ensure_ollama(fatal=False):
        print("❌ Ollama offline — open Ollama.app")
        return 1
    print("✓ Ollama online")

    bases = detect_base()
    print(f"✓ hardware ~{bases['mem_gb']}GB · ctx={bases['num_ctx']} · base={bases['max_base']}")

    results = apply_modelfiles(bases)
    if not results.get("ok"):
        print("⚠ some models failed — see above")

    if not args.no_warmup:
        warmup([DEFAULT_MODEL, FLASH_MODEL])

    if not args.no_smoke:
        smoke()

    print("")
    print("Local Grok stack ready:")
    print("  · Instant craft: patch feel/enemies/palette (no LLM)")
    print("  · First game: chat Make this game → slice")
    print("  · Model: gamemaster (game system) + gamemaster-flash (tiny)")
    print("  · Restart chat: ./start")
    print(f"  · Profile: {PROFILE_PATH}")
    return 0 if results.get("ok") else 1


if __name__ == "__main__":
    raise SystemExit(main())
