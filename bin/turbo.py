#!/usr/bin/env python3
"""
dotLab TURBO — routing + slim knowledge (no quality loss).

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
    # Prefer baked flash model (game system prompt); fall back to raw 7b
    "flash": os.environ.get("DOTLAB_FLASH")
    or os.environ.get("GAMEMASTER_FLASH")
    or "dotlab-flash",
    "max": DEFAULT_MODEL,
    "dense": DENSE_MODEL,
}

# Knowledge packs by domain (order = priority, sizes capped in select)
PACKS = {
    # Keep core short so domain packs (skill-fps, combat…) still fit prefill budget
    "core": [
        "identity.md",
        "ship-bar.md",
        "grok-craft.md",
        "grok-toolkit.md",
        "brain.md",
        "quality-pipeline.md",
    ],
    "antislope": [
        "anti-slop/fail-green-capsule.md",
        "anti-slop/fail-purple-fog.md",
        "anti-slop/fail-silence-hit.md",
        "anti-slop/fail-config-ones.md",
    ],
    "vintage": ["vintage.md", "pixel-kit.md"],
    "ops": ["game-ops.md", "quality-pipeline.md", "skills.md"],
    "skills": ["skills.md", "agent-protocol.md", "game-ops.md"],
    "rlm": ["rlm.md", "skills.md", "quality-pipeline.md"],
    "local_llm": ["local-llm-stack.md", "speed-without-quality-loss.md"],
    "systems": ["game-systems.md", "threejs-cheatsheet.md", "grok-toolkit.md", "live/three-api.md"],
    "three": ["grok-toolkit.md", "threejs-recipes.md", "live/three-api.md"],
    "shader": ["shaders-glsl-tsl.md", "multipass.md"],
    "game": ["feel-tables.md", "game-patterns.md", "grok-toolkit.md", "threejs-recipes.md", "ship-bar.md"],
    "fps": ["feel-tables.md", "skill-fps.md", "ship-bar.md", "combat-juice.md"],
    "world": ["world-building.md", "readable-spaces.md"],
    "physics": ["physics-ragdoll.md"],
    "combat": ["feel-tables.md", "combat-juice.md"],
    "dialogue": ["dialogue-narrative.md"],
    "anim": ["threejs-animation.md"],
    "art": ["asset-core.md", "tiles-ui.md", "pixel-kit.md", "live/pixel-api.md"],
    "seeker": ["solana-seeker.md"],
    "zoo": ["openzoo.md", "solana-seeker.md"],
    "agent": ["agent-protocol.md"],
    "playtest": ["playtest-harness.md", "prefs-and-playtest.md", "pair-partner.md"],
    "live": ["live/LATEST.md", "live/three-api.md", "live/pixel-api.md"],
}

# Cache /api/tags — resolve_tier used to hit Ollama every route call
_TAGS_CACHE: dict = {"ts": 0.0, "names": set()}

# Keyword → pack ids (first match wins extra packs; all matches accumulate)
ROUTES = [
    (r"shader|glsl|wgsl|tsl|fragcoord|shadertoy|raymarch|sdf|fbm|multipass|fragment|toon|water shader", ["shader", "core", "three"]),
    (r"combat|enemy|melee|dash|knockback|hitstop|arena|boss|projectile|gun|sword|shooter|fps|neon.?ink|hitscan|ads", ["fps", "combat", "physics", "game", "core"]),
    (r"ragdoll|rapier|cannon|collider|rigid.?body|softbody|cloth|vehicle|suspension|physics|physic", ["physics", "anim", "three", "core"]),
    (r"dialogue|dialog|npc|quest|narrative|bark|conversation|ink |typewriter|story beat", ["dialogue", "world", "game", "core"]),
    (r"worldclaw|open.?world|terrain|biome|heightfield|village|region|landmark|explorable", ["world", "physics", "three", "core"]),
    (r"mixer|gltf|skinned|mixamo|crossfade|root motion|ik\b|animation clip", ["anim", "art", "three", "core"]),
    (r"sprite|tileset|atlas|pixel.?art|pixel kit|bakeCanvas|layeredRect|nearest.?filter|icon set|art-test|texture", ["art", "anim", "core"]),
    (r"openzoo|open.?zoo|x402|lecore|yusdcx|wtokenx|zoo stall", ["zoo", "seeker", "core"]),
    (r"seeker|solana|mwa|wallet|seed.?vault|spl-token|anchor|dapp", ["seeker", "core", "game", "three"]),
    (r"playtest|metric|screenshot|critic|feel|coyote|juice|shake|hitstop", ["playtest", "combat", "game", "core"]),
    (r"slop|capsule|purple fog|silence on hit|generic|ai style", ["antislope", "core", "game"]),
    (r"vintage|game\s*boy|\bgba\b|\bgbc\b|\bdmg\b|handheld", ["vintage", "core", "game"]),
    (r"game.?ops|set_feel|set_flag|request_context|event protocol", ["ops", "core"]),
    (r"skill.?catalog|find.?capability|route or abstain|which tool|what can you do", ["skills", "ops", "core"]),
    (r"\brlm\b|recursive.?language|peek\(|sub\(|context rot", ["rlm", "skills", "core"]),
    (r"ollama|local.?llm|model.?tier|turbo|warmup|bench|mlx|lora|quant", ["local_llm", "core"]),
    (r"platformer|runner|fps|tps|racing|rpg|card|idle|tower|genre|arena|horror|stealth|rhythm", ["game", "combat", "core", "three", "physics"]),
    (r"r3f|drei|postprocess|instanced|shadow|webgpu", ["three", "core"]),
    (r"tool call|write_file|agent|refactor", ["agent", "core", "three", "game"]),
    (r"complete game|whole world|from scratch|vertical slice|studio|implement", ["world", "physics", "dialogue", "anim", "shader", "game", "three", "core"]),
]


def http_json(path: str, payload: dict | None = None, timeout: float = 120.0) -> dict:
    return ollama_json(path, payload, timeout=timeout)


def models_available(force: bool = False) -> set[str]:
    now = time.time()
    if not force and _TAGS_CACHE["names"] and now - float(_TAGS_CACHE["ts"]) < 90.0:
        return set(_TAGS_CACHE["names"])
    try:
        tags = http_json("/api/tags", timeout=3.0)
        names = {m.get("name", "") for m in tags.get("models", [])}
        _TAGS_CACHE["ts"] = now
        _TAGS_CACHE["names"] = names
        return set(names)
    except Exception:
        return set(_TAGS_CACHE["names"] or set())


ROLE_CTX = {
    "director": 8192,
    "architect": 12288,
    "critic": 8192,
    "coder": 16384,
    "agent": 16384,
    "flash": 4096,
    "rlm": 32768,
}


def ctx_for_role(role: str) -> int:
    env = os.environ.get("GAMEMASTER_NUM_CTX")
    if env:
        try:
            return int(env)
        except ValueError:
            pass
    return int(ROLE_CTX.get((role or "").lower(), 16384))


def _flash_candidates() -> list[str]:
    """On ≥16 GB prefer 14B/OmniCoder drafts over baked 7B flash."""
    ram = 16.0
    try:
        import models_catalog as mc

        ram = float(mc.total_ram_gb())
    except Exception:
        pass
    strong = ["qwen2.5-coder:14b", "omnicoder:9b"]
    baked = ["dotlab-flash", "gamemaster-flash"]
    weak = ["qwen2.5-coder:7b", "dotlab", "gamemaster"]
    if ram >= 16:
        return strong + baked + weak
    return baked + weak + strong


def resolve_tier(tier: str) -> str:
    """Pick best available model for tier. Never blocks long on tags."""
    want = TIERS.get(tier, TIERS["max"])
    avail = models_available()
    if not avail:
        # Offline / cold — return configured tag; Ollama will load it
        return want
    if tier == "flash":
        for cand in _flash_candidates():
            if any(n == cand or n.startswith(cand + ":") for n in avail):
                return cand
        return want
    if any(n == want or n.startswith(want + ":") for n in avail):
        return want
    fallbacks = {
        "flash": _flash_candidates(),
        "max": [
            "dotlab",
            "gamemaster",
            "qwen3-coder-next",
            "qwen3-coder:30b",
            "devstral-2",
            "devstral",
            "qwen2.5-coder:14b",
            "qwen2.5-coder:7b",
        ],
        "dense": [
            "dotlab-dense",
            "gamemaster-dense",
            "qwen2.5-coder:32b",
            "dotlab",
            "gamemaster",
            "qwen3-coder:30b",
        ],
    }
    for cand in fallbacks.get(tier, []):
        if any(n == cand or n.startswith(cand + ":") for n in avail):
            return cand
    return want


def _rules_route(prompt: str) -> tuple[str, str]:
    """Keyword tier routing (default). Returns (tier, reason)."""
    p = prompt.lower()
    if re.search(
        r"\b(refactor|architect|security|hard bug|race condition|review|critic|audit|dense)\b",
        p,
    ):
        return "dense", "hard-reasoning"
    if re.search(
        r"\b(complete game|multi.?agent|studio|vertical slice|from scratch|implement|write|scaffold|build|worldclaw|ragdoll|open.?world)\b",
        p,
    ):
        return "max", "coding-build"
    if re.search(
        r"shader|glsl|wgsl|tsl|seeker|ragdoll|dialogue|npc|physics|three\.?js|gltf|"
        r"combat|village|jump|camera|enemy|arena|runner|platform|feel|juice|"
        r"pixel|sprite|tileset|"
        r"\b(fix|collision|controller|player|game|world|tps|fps)\b",
        p,
    ):
        return "max", "default-coding"
    if len(prompt) < 100 and not re.search(
        r"shader|glsl|game|world|ragdoll|dialogue|pixel|sprite|"
        r"\b(code|function|class|file|bug|error)\b",
        p,
    ):
        return "flash", "short-qa"
    return "max", "default-coding"


def _llm_route_tier(prompt: str) -> tuple[str, str] | None:
    """
    Optional tiny router (Arch-Router-style): flash model returns one of flash|max|dense.
    Enable: DOTLAB_ROUTER=llm  (default remains rules-only).
    """
    if os.environ.get("DOTLAB_ROUTER", "rules").lower() not in ("llm", "1", "true", "on"):
        return None
    model = resolve_tier("flash")
    try:
        res = http_json(
            "/api/chat",
            {
                "model": model,
                "messages": [
                    {
                        "role": "system",
                        "content": (
                            "You route coding tasks. Reply with ONLY one word: flash, max, or dense. "
                            "flash=short QA; max=game code; dense=hard refactor/security."
                        ),
                    },
                    {"role": "user", "content": (prompt or "")[:800]},
                ],
                "stream": False,
                "format": "json",
                "options": {"temperature": 0, "num_predict": 24, "num_ctx": 1024},
            },
            timeout=8.0,
        )
        text = ((res.get("message") or {}).get("content") or "").lower()
        for tier in ("dense", "flash", "max"):
            if tier in text:
                return tier, f"llm-router:{model}"
    except Exception:
        return None
    return None


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
        tier, reason = _rules_route(prompt)
        # Optional LLM router only when rules said flash (avoid demoting hard work)
        if tier == "flash":
            llm = _llm_route_tier(prompt)
            if llm and llm[0] in TIERS:
                tier, reason = llm

    # ctx sizing — prefill is the wall-clock killer on local 30B
    if re.search(r"\b(whole project|entire codebase|all files|multipass|large|open.?world|worldclaw|complete game)\b", p):
        num_ctx = 32768
    elif tier == "flash":
        num_ctx = 4096
    elif re.search(r"\b(agent|write_file|refactor|implement|ragdoll|dialogue|shader)\b", p):
        num_ctx = 24576
    else:
        num_ctx = 12288

    # short continue-style asks: fewer tokens out
    short = len(prompt) < 180
    if tier == "flash":
        num_predict = 1024
    elif short and re.search(r"\b(fix|tweak|floaty|faster|slower|feel|enemy|jump)\b", p):
        num_predict = 3072
    elif tier == "max":
        num_predict = 6144
    else:
        num_predict = 5120
    temperature = 0.15 if tier == "dense" else (0.35 if "design" in p or "pitch" in p else 0.18)

    # GAMEMASTER_NUM_CTX overrides only if explicitly set
    env_ctx = os.environ.get("GAMEMASTER_NUM_CTX")
    return {
        "tier": tier,
        "model": resolve_tier(tier),
        "num_ctx": int(env_ctx) if env_ctx else num_ctx,
        "num_predict": num_predict,
        "temperature": temperature,
        "reason": reason,
    }


def select_knowledge(prompt: str, max_chars: int = 14000, skip_core: bool = False) -> str:
    """Pick only relevant knowledge packs — biggest free speedup for agents.

    skip_core: omit identity/brain/ship-bar when the system prompt already has CORE.
    """
    p = prompt.lower()
    # Only slim knowledge for true chit-chat (flash tier)
    if route_task(prompt).get("tier") == "flash":
        max_chars = min(max_chars, 5500)
    # continue / feel tweaks: tiny pack
    if re.search(r"\b(floaty|faster|slower|feel|enemy|enemies|gegner|jump|juice|hp)\b", p) and len(prompt) < 120:
        max_chars = min(max_chars, 3500)
    pack_ids: list[str] = []
    for rx, ids in ROUTES:
        if re.search(rx, p, re.I):
            pack_ids.extend(ids)
    if not pack_ids:
        pack_ids = ["core", "systems", "three", "game", "physics"]
    # whole-game briefs get the full systems stack
    if re.search(r"complete game|whole world|from scratch|vertical slice|studio build", p, re.I):
        pack_ids.extend(["world", "physics", "dialogue", "anim", "shader", "systems"])
    # always core first, then high-signal packs (ops/local_llm), then routed domain, then systems/live
    ordered: list[str] = []
    priority = [p for p in ("ops", "local_llm", "antislope", "vintage", "zoo") if p in pack_ids]
    head = [] if skip_core else ["core"]
    for pid in head + priority + pack_ids + ["systems", "live"]:
        if pid == "core" and skip_core:
            continue
        if pid not in ordered:
            ordered.append(pid)

    chunks: list[str] = []
    used = 0
    seen_files: set[str] = set()
    per = max(1200, max_chars // max(1, len(ordered) + 1))

    def _add_file(name: str, hard_cap: int | None = None) -> bool:
        nonlocal used
        if name in seen_files:
            return True
        path = KNOWLEDGE / name
        if not path.exists():
            return True
        # Front-load craft packs; trim the rest harder
        cap = hard_cap if hard_cap is not None else min(
            per, 2800 if name in ("grok-craft.md", "brain.md", "feel-tables.md") else per
        )
        text = path.read_text(encoding="utf-8")[:cap]
        block = f"## {name}\n{text}"
        if used + len(block) > max_chars:
            remain = max_chars - used
            if remain > 400:
                chunks.append(block[:remain])
                seen_files.add(name)
            return False
        chunks.append(block)
        seen_files.add(name)
        used += len(block)
        return True

    # Guaranteed early inject for small high-signal packs (before fat core fills budget)
    early: list[tuple[str, int]] = []
    if "local_llm" in pack_ids:
        early.append(("local-llm-stack.md", 2200))
    if "ops" in pack_ids:
        early.append(("game-ops.md", 1800))
    if "zoo" in pack_ids:
        early.append(("openzoo.md", 1800))
    # Lead with identity + ship-bar unless the system prompt already has CORE
    lead = [] if skip_core else [("identity.md", 1600), ("ship-bar.md", 1600)]
    for name, cap in (*lead, *early):
        if not _add_file(name, hard_cap=cap):
            return "\n\n".join(chunks)

    for pid in ordered:
        for name in PACKS.get(pid, []):
            if not _add_file(name):
                return "\n\n".join(chunks)
    return "\n\n".join(chunks)


def ollama_env_exports() -> str:
    """Shell exports for max Apple Silicon throughput (game coding)."""
    return """
# dotLab TURBO — game-coding defaults (Apple Silicon friendly)
export OLLAMA_FLASH_ATTENTION=1
export OLLAMA_KEEP_ALIVE=24h
# Dual resident models: flash draft + max coder (prefix reuse + host speculative)
export OLLAMA_NUM_PARALLEL=2
export OLLAMA_MAX_LOADED_MODELS=2
export OLLAMA_KV_CACHE_TYPE=q8_0
export OLLAMA_NUM_BATCH=512
export OLLAMA_SCHED_SPREAD=false
# Quality pipeline defaults
export DOTLAB_SPECULATIVE=1
# Verify-rescue: cheap flash patches if P0 still fails after the coder
export DOTLAB_BEST_OF=2
""".strip()


def write_env_file() -> Path:
    path = ROOT / "config" / "ollama-env.sh"
    path.write_text(ollama_env_exports() + "\n", encoding="utf-8")
    return path


def warmup(tiers: list[str] | None = None) -> None:
    tiers = tiers or ["flash", "max"]
    # Always ensure product env file exists with dual-slot defaults
    try:
        write_env_file()
    except Exception:
        pass
    print("🔥 dotLab TURBO warmup (dual keep-alive)…")
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
    # Mark warmup for quality.ensure_dual_warmup cache
    try:
        flag = ROOT / "config" / ".warmup-ok"
        flag.parent.mkdir(parents=True, exist_ok=True)
        flag.write_text(str(int(time.time())), encoding="utf-8")
    except Exception:
        pass


def bench() -> None:
    """Micro-benchmark for local claims (not cloud apples-to-apples)."""
    print("📊 dotLab TURBO bench (local coding)")
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
    print("dotLab TURBO status")
    write_env_file()
    print(f"  env file: {ROOT / 'config' / 'ollama-env.sh'}")
    for t in ("flash", "max", "dense"):
        print(f"  tier {t:5} → {resolve_tier(t)}")
    print("  OLLAMA_FLASH_ATTENTION=", os.environ.get("OLLAMA_FLASH_ATTENTION", "(unset)"))
    print("  OLLAMA_KEEP_ALIVE=", os.environ.get("OLLAMA_KEEP_ALIVE", "(unset)"))
    print("  DOTLAB_ROUTER=", os.environ.get("DOTLAB_ROUTER", "rules"))
    print("  DOTLAB_BULLSHIT=", os.environ.get("DOTLAB_BULLSHIT", "1"))
    print("  DOTLAB_SANDBOX=", os.environ.get("DOTLAB_SANDBOX", "0"))
    try:
        http_json("/api/tags")
        print("  ollama: online")
    except Exception as e:
        print(f"  ollama: offline ({e})")
    # llmfit-style hardware + model matrix
    try:
        import models_catalog as mcat

        print(mcat.format_status_block())
    except Exception as e:
        print(f"  hardware-fit: ({e})")
    # bench age
    bench = ROOT / "config" / "bench-latest.json"
    if bench.is_file():
        try:
            data = json.loads(bench.read_text(encoding="utf-8"))
            age_h = (time.time() - float(data.get("ts") or 0)) / 3600
            print(f"  bench-latest: {age_h:.1f}h ago · {bench}")
        except Exception:
            print(f"  bench-latest: present")
    else:
        print("  bench-latest: missing (run: gamemaster turbo bench)")
    # live docs
    try:
        import live_docs as ld

        st = ld.status()
        print(f"  live-docs: three={st.get('three')} pixel={st.get('pixel')}")
    except Exception:
        pass


def main() -> int:
    ap = argparse.ArgumentParser(description="dotLab TURBO")
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
