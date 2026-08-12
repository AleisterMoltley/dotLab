#!/usr/bin/env python3
"""
Gamemaster TURBO — routing + slim knowledge (no quality loss).

PACKS / ROUTES / route_task / select_knowledge are the knobs.
New knowledge file → knowledge/INDEX.md + PACKS + ROUTES.

Philosophy (frontier-inspired, local-adapted):
  1. Prompt processing dominates agents → SLIM context, stable prefixes, keep-alive
  2. Route by task: flash (7b) / max (30b MoE) / dense (32b) — right model, not biggest always
  3. Dynamic num_ctx — 65k only when needed
  4. Domain knowledge packs only (keyword routing) — not dump-all
  5. Prefill warmup so first token isn't cold

Usage:
  gamemaster turbo status
  gamemaster turbo warmup
  gamemaster turbo bench
  gamemaster turbo route "fix jump feel in player.js"
  python3 -c "from turbo import select_knowledge, route_task; ..."
"""
from __future__ import annotations

import argparse
import json
import os
import re
import subprocess
import sys
import time
import urllib.request
from pathlib import Path

from gmcommon import DEFAULT_MODEL, DENSE_MODEL, KNOWLEDGE, OLLAMA, ROOT, ollama_json

# Stable tier names → ollama tags
TIERS = {
    "flash": os.environ.get("GAMEMASTER_FLASH", "qwen2.5-coder:7b"),
    "max": DEFAULT_MODEL,
    "dense": DENSE_MODEL,
}

# Knowledge packs by domain (order = priority, sizes capped in select)
PACKS = {
    "core": ["brain.md", "game-systems.md", "threejs-cheatsheet.md"],
    "three": ["threejs-advanced.md", "threejs-ecosystem.md"],
    "shader": ["shaders-glsl-tsl.md", "multipass.md"],
    "game": ["feel-tables.md", "game-patterns.md", "game-genres.md"],
    "world": ["world-building.md", "readable-spaces.md"],
    "physics": ["physics-ragdoll.md"],
    "combat": ["combat-juice.md", "feel-tables.md"],
    "dialogue": ["dialogue-narrative.md"],
    "anim": ["threejs-animation.md"],
    "art": ["asset-core.md", "tiles-ui.md", "pixel-kit.md"],
    "seeker": ["solana-seeker.md"],
    "agent": ["agent-protocol.md"],
    "playtest": ["playtest-harness.md", "prefs-and-playtest.md", "pair-partner.md"],
    "live": ["live/LATEST.md"],
}

# Keyword → pack ids (first match wins extra packs; all matches accumulate)
ROUTES = [
    (r"shader|glsl|wgsl|tsl|fragcoord|shadertoy|raymarch|sdf|fbm|multipass|fragment|toon|water shader", ["shader", "core", "three"]),
    (r"combat|enemy|melee|dash|knockback|hitstop|arena|boss|projectile|gun|sword", ["combat", "physics", "game", "core"]),
    (r"ragdoll|rapier|cannon|collider|rigid.?body|softbody|cloth|vehicle|suspension|physics|physic", ["physics", "anim", "three", "core"]),
    (r"dialogue|dialog|npc|quest|narrative|bark|conversation|ink |typewriter|story beat", ["dialogue", "world", "game", "core"]),
    (r"worldclaw|open.?world|terrain|biome|heightfield|village|region|landmark|explorable", ["world", "physics", "three", "core"]),
    (r"mixer|gltf|skinned|mixamo|crossfade|root motion|ik\b|animation clip", ["anim", "art", "three", "core"]),
    (r"sprite|tileset|atlas|pixel.?art|pixel kit|bakeCanvas|layeredRect|nearest.?filter|icon set|art-test|texture", ["art", "anim", "core"]),
    (r"seeker|solana|mwa|wallet|seed.?vault|spl-token|anchor|dapp", ["seeker", "core", "game", "three"]),
    (r"playtest|metric|screenshot|critic|feel|coyote|juice|shake|hitstop", ["playtest", "combat", "game", "core"]),
    (r"platformer|runner|fps|tps|racing|rpg|card|idle|tower|genre|arena|horror|stealth|rhythm", ["game", "combat", "core", "three", "physics"]),
    (r"r3f|drei|postprocess|instanced|shadow|webgpu", ["three", "core"]),
    (r"tool call|write_file|agent|refactor", ["agent", "core", "three", "game"]),
    (r"complete game|whole world|from scratch|vertical slice|studio|implement", ["world", "physics", "dialogue", "anim", "shader", "game", "three", "core"]),
]


def http_json(path: str, payload: dict | None = None, timeout: float = 120.0) -> dict:
    return ollama_json(path, payload, timeout=timeout)


def models_available() -> set[str]:
    try:
        tags = http_json("/api/tags")
        return {m.get("name", "") for m in tags.get("models", [])}
    except Exception:
        return set()


def resolve_tier(tier: str) -> str:
    """Pick best available model for tier."""
    want = TIERS.get(tier, TIERS["max"])
    avail = models_available()
    if any(n == want or n.startswith(want + ":") for n in avail):
        return want
    # fallbacks
    fallbacks = {
        "flash": ["qwen2.5-coder:7b", "gamemaster", "qwen2.5-coder:14b"],
        "max": ["gamemaster", "qwen3-coder:30b", "qwen2.5-coder:14b", "qwen2.5-coder:7b"],
        "dense": [
            "gamemaster-dense",
            "qwen2.5-coder:32b",
            "gamemaster",
            "qwen3-coder:30b",
        ],
    }
    for cand in fallbacks.get(tier, []):
        if any(n == cand or n.startswith(cand + ":") for n in avail):
            return cand
    return want


def route_task(prompt: str, mode: str = "auto") -> dict:
    """
    mode: auto | flash | max | dense
    Returns {tier, model, num_ctx, num_predict, temperature, reason}
    """
    p = prompt.lower()
    if mode != "auto":
        tier = mode if mode in TIERS else "max"
        reason = f"forced:{tier}"
    else:
        # dense first — never demote hard work to flash
        if re.search(
            r"\b(refactor|architect|security|hard bug|race condition|review|critic|audit|dense)\b",
            p,
        ):
            tier, reason = "dense", "hard-reasoning"
        elif re.search(
            r"\b(complete game|multi.?agent|studio|vertical slice|from scratch|implement|write|scaffold|build|worldclaw|ragdoll|open.?world)\b",
            p,
        ):
            tier, reason = "max", "coding-build"
        elif re.search(
            r"shader|glsl|wgsl|tsl|seeker|ragdoll|dialogue|npc|physics|three\.?js|gltf|"
            r"combat|village|jump|camera|enemy|arena|runner|platform|feel|juice|"
            r"pixel|sprite|tileset|"
            r"\b(fix|collision|controller|player|game|world|tps|fps)\b",
            p,
        ):
            tier, reason = "max", "default-coding"
        elif len(prompt) < 100 and not re.search(
            r"shader|glsl|game|world|ragdoll|dialogue|pixel|sprite|"
            r"\b(code|function|class|file|bug|error)\b",
            p,
        ):
            tier, reason = "flash", "short-qa"
        else:
            tier, reason = "max", "default-coding"

    # ctx sizing — quality preserved: enough room, not max always
    if re.search(r"\b(whole project|entire codebase|all files|multipass|large|open.?world|worldclaw|complete game)\b", p):
        num_ctx = 65536
    elif tier == "flash":
        num_ctx = 8192
    elif re.search(r"\b(agent|write_file|refactor|implement|ragdoll|dialogue|shader)\b", p):
        num_ctx = 32768
    else:
        num_ctx = 16384

    num_predict = 2048 if tier == "flash" else (8192 if tier == "max" else 6144)
    temperature = 0.15 if tier == "dense" else (0.35 if "design" in p or "pitch" in p else 0.2)

    return {
        "tier": tier,
        "model": resolve_tier(tier),
        "num_ctx": int(os.environ.get("GAMEMASTER_NUM_CTX", num_ctx)),
        "num_predict": num_predict,
        "temperature": temperature,
        "reason": reason,
    }


def select_knowledge(prompt: str, max_chars: int = 28000) -> str:
    """Pick only relevant knowledge packs — biggest free speedup for agents."""
    p = prompt.lower()
    # Only slim knowledge for true chit-chat (flash tier)
    if route_task(prompt).get("tier") == "flash":
        max_chars = min(max_chars, 8000)
    pack_ids: list[str] = []
    for rx, ids in ROUTES:
        if re.search(rx, p, re.I):
            pack_ids.extend(ids)
    if not pack_ids:
        pack_ids = ["core", "three", "game", "physics"]
    # whole-game briefs get the full systems stack
    if re.search(r"complete game|whole world|from scratch|vertical slice|studio build", p, re.I):
        pack_ids.extend(["world", "physics", "dialogue", "anim", "shader"])
    # always core first, unique preserve order
    ordered: list[str] = []
    for pid in ["core"] + pack_ids + ["live"]:
        if pid not in ordered:
            ordered.append(pid)

    chunks: list[str] = []
    used = 0
    per = max(2000, max_chars // max(1, len(ordered)))
    for pid in ordered:
        for name in PACKS.get(pid, []):
            path = KNOWLEDGE / name
            if not path.exists():
                continue
            text = path.read_text(encoding="utf-8")[:per]
            block = f"## {name}\n{text}"
            if used + len(block) > max_chars:
                remain = max_chars - used
                if remain > 500:
                    chunks.append(block[:remain])
                return "\n\n".join(chunks)
            chunks.append(block)
            used += len(block)
    return "\n\n".join(chunks)


def ollama_env_exports() -> str:
    """Shell exports for max Apple Silicon throughput."""
    return """
# Gamemaster TURBO — source this before sessions
export OLLAMA_FLASH_ATTENTION=1
export OLLAMA_KEEP_ALIVE=24h
export OLLAMA_NUM_PARALLEL=2
export OLLAMA_MAX_LOADED_MODELS=3
export OLLAMA_KV_CACHE_TYPE=q8_0
export OLLAMA_NUM_BATCH=512
# Prefer Metal; avoid CPU thrash
export OLLAMA_SCHED_SPREAD=false
""".strip()


def write_env_file() -> Path:
    path = ROOT / "config" / "ollama-env.sh"
    path.write_text(ollama_env_exports() + "\n", encoding="utf-8")
    return path


def warmup(tiers: list[str] | None = None) -> None:
    tiers = tiers or ["flash", "max"]
    print("🔥 Gamemaster TURBO warmup…")
    for t in tiers:
        model = resolve_tier(t)
        print(f"  → load {model} ({t})")
        try:
            payload = {
                "model": model,
                "messages": [{"role": "user", "content": "Reply with exactly: OK"}],
                "stream": False,
                "keep_alive": "24h",
                "options": {"num_predict": 4, "temperature": 0, "num_ctx": 2048},
            }
            t0 = time.perf_counter()
            res = http_json("/api/chat", payload, timeout=300)
            dt = time.perf_counter() - t0
            text = (res.get("message") or {}).get("content", "")
            eval_c = res.get("eval_count") or 0
            eval_d = (res.get("eval_duration") or 1) / 1e9
            tps = eval_c / eval_d if eval_d > 0 else 0
            print(f"  ✓ {model}: {dt:.2f}s wall · ~{tps:.1f} tok/s gen · «{text.strip()[:40]}»")
        except Exception as e:
            print(f"  ⚠ {model}: {e}")


def bench() -> None:
    """Micro-benchmark for local claims (not cloud apples-to-apples)."""
    print("📊 Gamemaster TURBO bench (local coding)")
    cases = [
        ("flash", "Say hi in 3 words"),
        ("max", "Write a JS function clamp(n,a,b) only code"),
        ("dense", "List 3 causes of z-fighting in three.js, bullets only"),
    ]
    results = []
    for tier, prompt in cases:
        model = resolve_tier(tier)
        route = route_task(prompt, mode=tier)
        payload = {
            "model": model,
            "messages": [
                {"role": "system", "content": "Be concise. Code when asked."},
                {"role": "user", "content": prompt},
            ],
            "stream": False,
            "keep_alive": "24h",
            "options": {
                "temperature": 0.1,
                "num_ctx": route["num_ctx"],
                "num_predict": 256,
            },
        }
        t0 = time.perf_counter()
        try:
            res = http_json("/api/chat", payload, timeout=300)
            wall = time.perf_counter() - t0
            prompt_n = res.get("prompt_eval_count") or 0
            prompt_d = (res.get("prompt_eval_duration") or 1) / 1e9
            eval_n = res.get("eval_count") or 0
            eval_d = (res.get("eval_duration") or 1) / 1e9
            row = {
                "tier": tier,
                "model": model,
                "wall_s": round(wall, 2),
                "prompt_tok": prompt_n,
                "prompt_tps": round(prompt_n / prompt_d, 1) if prompt_d else 0,
                "gen_tok": eval_n,
                "gen_tps": round(eval_n / eval_d, 1) if eval_d else 0,
            }
            results.append(row)
            print(
                f"  {tier:5} {model:28} wall={row['wall_s']:5}s  "
                f"prefill={row['prompt_tps']:6} t/s  gen={row['gen_tps']:5} t/s"
            )
        except Exception as e:
            print(f"  {tier}: FAIL {e}")
    out = ROOT / "config" / "bench-latest.json"
    out.write_text(json.dumps({"ts": time.time(), "results": results}, indent=2), encoding="utf-8")
    print(f"  💾 {out}")
    print("\nNote: Cloud Grok/Kimi benchmarks ≠ local tok/s. Our edge is game domain + $0 + multi-agent.")


def apply_launchd_keepalive() -> None:
    """Optional macOS LaunchAgent to warm models after login."""
    plist = Path.home() / "Library" / "LaunchAgents" / "com.gamemaster.warmup.plist"
    script = ROOT / "bin" / "warmup.py"
    # symlink warmup
    if not script.exists():
        script.write_text(
            "#!/usr/bin/env python3\nfrom turbo import warmup\nwarmup(['flash','max'])\n",
            encoding="utf-8",
        )
        script.chmod(0o755)
    body = f"""<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key><string>com.gamemaster.warmup</string>
  <key>ProgramArguments</key>
  <array>
    <string>{sys.executable}</string>
    <string>{ROOT / "bin" / "turbo.py"}</string>
    <string>warmup</string>
  </array>
  <key>RunAtLoad</key><true/>
  <key>defaultOutPath</key><string>{ROOT / "config" / "warmup.log"}</string>
  <key>defaultErrorPath</key><string>{ROOT / "config" / "warmup.err"}</string>
</dict>
</plist>
"""
    plist.parent.mkdir(parents=True, exist_ok=True)
    plist.write_text(body, encoding="utf-8")
    subprocess.run(["launchctl", "unload", str(plist)], capture_output=True)
    subprocess.run(["launchctl", "load", str(plist)], capture_output=True)
    print(f"✓ LaunchAgent: {plist}")


def status() -> None:
    print("Gamemaster TURBO status")
    write_env_file()
    print(f"  env file: {ROOT / 'config' / 'ollama-env.sh'}")
    for t in ("flash", "max", "dense"):
        print(f"  tier {t:5} → {resolve_tier(t)}")
    print("  OLLAMA_FLASH_ATTENTION=", os.environ.get("OLLAMA_FLASH_ATTENTION", "(unset)"))
    print("  OLLAMA_KEEP_ALIVE=", os.environ.get("OLLAMA_KEEP_ALIVE", "(unset)"))
    try:
        http_json("/api/tags")
        print("  ollama: online")
    except Exception as e:
        print(f"  ollama: offline ({e})")


def main() -> int:
    ap = argparse.ArgumentParser(description="Gamemaster TURBO")
    sub = ap.add_subparsers(dest="cmd", required=True)
    sub.add_parser("status")
    sub.add_parser("warmup")
    sub.add_parser("bench")
    sub.add_parser("env")
    sub.add_parser("install-keepalive")
    p_route = sub.add_parser("route")
    p_route.add_argument("prompt", nargs="+")
    p_route.add_argument("--mode", default="auto")
    p_know = sub.add_parser("knowledge")
    p_know.add_argument("prompt", nargs="+")
    p_know.add_argument("--raw", action="store_true", help="full text only (for injection)")
    p_know.add_argument("--max-chars", type=int, default=28000)
    args = ap.parse_args()

    if args.cmd == "status":
        status()
    elif args.cmd == "warmup":
        write_env_file()
        warmup()
    elif args.cmd == "bench":
        bench()
    elif args.cmd == "env":
        p = write_env_file()
        print(p.read_text())
    elif args.cmd == "install-keepalive":
        apply_launchd_keepalive()
    elif args.cmd == "route":
        print(json.dumps(route_task(" ".join(args.prompt), args.mode), indent=2))
    elif args.cmd == "knowledge":
        k = select_knowledge(" ".join(args.prompt), max_chars=args.max_chars)
        if args.raw:
            print(k)
        else:
            print(f"# {len(k)} chars\n")
            print(k[:2000] + ("…" if len(k) > 2000 else ""))
    return 0


if __name__ == "__main__":
    # allow import as module from same dir
    raise SystemExit(main())
