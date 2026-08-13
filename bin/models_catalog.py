#!/usr/bin/env python3
"""
Model matrix + hardware-fit recommendations for local Ollama (llmfit-style).

  gamemaster models list
  gamemaster models recommend
  gamemaster models gate          # refuse silent default upgrades without bench
"""
from __future__ import annotations

import argparse
import json
import os
import platform
import re
import subprocess
import time
from pathlib import Path
from typing import Any

from gmcommon import CONFIG, ROOT, ollama_json

# Curated tags for coding agents — prefer installed; host never auto-pulls paid.
MODEL_MATRIX: list[dict[str, Any]] = [
    {
        "id": "qwen3-coder-next",
        "tier": "max",
        "tags": ("qwen3-coder-next", "qwen3-coder:30b", "qwen3-coder:latest"),
        "role": "Primary agentic coder (Qwen3-Coder family)",
        "min_ram_gb": 24,
        "priority": 10,
    },
    {
        "id": "devstral-2",
        "tier": "max",
        "tags": ("devstral-2", "devstral:latest", "devstral"),
        "role": "Agentic SWE / multi-file edits (Mistral Devstral)",
        "min_ram_gb": 24,
        "priority": 9,
    },
    {
        "id": "qwen3-coder-30b",
        "tier": "max",
        "tags": ("qwen3-coder:30b", "qwen3-coder"),
        "role": "Default max MoE coder on Ollama",
        "min_ram_gb": 18,
        "priority": 8,
    },
    {
        "id": "qwen25-coder-32b",
        "tier": "dense",
        "tags": ("qwen2.5-coder:32b", "qwen2.5-coder:32b-instruct"),
        "role": "Dense critic / hard refactors",
        "min_ram_gb": 24,
        "priority": 7,
    },
    {
        "id": "omnicoder-9b",
        "tier": "flash",
        "tags": ("omnicoder:9b", "omnicoder-9b", "tesslate/omnicoder"),
        "role": "Strong small coder for flash/repair",
        "min_ram_gb": 10,
        "priority": 6,
    },
    {
        "id": "qwen25-coder-14b",
        "tier": "flash",
        "tags": ("qwen2.5-coder:14b",),
        "role": "Mid flash when 7b too weak",
        "min_ram_gb": 12,
        "priority": 5,
    },
    {
        "id": "qwen25-coder-7b",
        "tier": "flash",
        "tags": ("qwen2.5-coder:7b", "dotlab-flash", "gamemaster-flash"),
        "role": "Default flash draft / route",
        "min_ram_gb": 8,
        "priority": 4,
    },
    {
        "id": "nomic-embed",
        "tier": "embed",
        "tags": ("nomic-embed-text", "nomic-embed-text:latest"),
        "role": "Slice RAG embeddings",
        "min_ram_gb": 2,
        "priority": 3,
    },
    {
        "id": "qwen3-embedding",
        "tier": "embed",
        "tags": ("qwen3-embedding", "qwen3-embedding:latest"),
        "role": "Optional stronger embed for RAG",
        "min_ram_gb": 4,
        "priority": 2,
    },
    {
        "id": "qwen3-reranker",
        "tier": "rerank",
        "tags": ("qwen3-reranker", "qwen3-reranker:latest"),
        "role": "Optional RAG reranker (if available via Ollama)",
        "min_ram_gb": 4,
        "priority": 1,
    },
]

BENCH_FILE = CONFIG / "bench-latest.json"
GATE_FILE = CONFIG / "model-gate.json"


def installed_tags() -> set[str]:
    try:
        data = ollama_json("/api/tags", timeout=3.0)
        return {str(m.get("name") or "") for m in data.get("models") or []}
    except Exception:
        return set()


def tag_installed(tags: set[str], cand: str) -> bool:
    cand = (cand or "").strip()
    if not cand:
        return False
    for n in tags:
        if n == cand or n.startswith(cand + ":") or n.split(":")[0] == cand.split(":")[0]:
            return True
    return False


def total_ram_gb() -> float:
    env = os.environ.get("DOTLAB_RAM_GB")
    if env:
        try:
            return float(env)
        except ValueError:
            pass
    try:
        if platform.system() == "Darwin":
            out = subprocess.check_output(["sysctl", "-n", "hw.memsize"], text=True).strip()
            return int(out) / (1024**3)
        if Path("/proc/meminfo").is_file():
            text = Path("/proc/meminfo").read_text(encoding="utf-8", errors="ignore")
            m = re.search(r"MemTotal:\s+(\d+)", text)
            if m:
                return int(m.group(1)) / (1024**2)
    except Exception:
        pass
    return 16.0  # conservative default


def hardware_snapshot() -> dict[str, Any]:
    ram = total_ram_gb()
    cpu = platform.processor() or platform.machine()
    sysname = platform.system()
    machine = platform.machine()
    apple = sysname == "Darwin" and machine.lower() in ("arm64", "aarch64")
    # Rough free heuristic via vm_stat / meminfo not required — recommend by total
    loaded: list[str] = []
    try:
        data = ollama_json("/api/ps", timeout=2.0)
        for m in data.get("models") or []:
            loaded.append(str(m.get("name") or m.get("model") or ""))
    except Exception:
        pass
    tags = sorted(installed_tags())
    return {
        "os": sysname,
        "machine": machine,
        "cpu": cpu,
        "ram_gb": round(ram, 1),
        "apple_silicon": apple,
        "ollama_loaded": [x for x in loaded if x],
        "installed_count": len(tags),
        "installed_sample": tags[:20],
        "kv_cache": os.environ.get("OLLAMA_KV_CACHE_TYPE", "q8_0"),
        "keep_alive": os.environ.get("OLLAMA_KEEP_ALIVE", "24h"),
        "max_loaded": os.environ.get("OLLAMA_MAX_LOADED_MODELS", "2"),
    }


def recommend(ram_gb: float | None = None) -> dict[str, Any]:
    ram = float(ram_gb if ram_gb is not None else total_ram_gb())
    tags = installed_tags()
    by_tier: dict[str, list[dict]] = {"flash": [], "max": [], "dense": [], "embed": [], "rerank": []}
    missing: list[dict] = []
    for row in sorted(MODEL_MATRIX, key=lambda r: -int(r.get("priority") or 0)):
        fits = ram + 0.5 >= float(row.get("min_ram_gb") or 0)
        present = any(tag_installed(tags, t) for t in row.get("tags") or ())
        entry = {
            "id": row["id"],
            "tier": row["tier"],
            "role": row["role"],
            "min_ram_gb": row["min_ram_gb"],
            "fits_ram": fits,
            "installed": present,
            "tags": list(row.get("tags") or ()),
        }
        if present and fits:
            by_tier.setdefault(str(row["tier"]), []).append(entry)
        elif fits and not present:
            missing.append(entry)
        elif present and not fits:
            entry["note"] = "installed but may thrash (low RAM)"
            by_tier.setdefault(str(row["tier"]), []).append(entry)

    picks = {
        "flash": (by_tier.get("flash") or [{}])[0].get("tags", ["qwen2.5-coder:7b"])[0]
        if by_tier.get("flash")
        else "qwen2.5-coder:7b",
        "max": (by_tier.get("max") or [{}])[0].get("tags", ["qwen3-coder:30b"])[0]
        if by_tier.get("max")
        else "qwen3-coder:30b",
        "dense": (by_tier.get("dense") or by_tier.get("max") or [{}])[0].get(
            "tags", ["qwen2.5-coder:32b"]
        )[0]
        if (by_tier.get("dense") or by_tier.get("max"))
        else "qwen2.5-coder:32b",
        "embed": (by_tier.get("embed") or [{}])[0].get("tags", ["nomic-embed-text"])[0]
        if by_tier.get("embed")
        else "nomic-embed-text",
    }
    # pick first installed tag from each tier list
    for tier in ("flash", "max", "dense", "embed"):
        for ent in by_tier.get(tier) or []:
            for t in ent.get("tags") or []:
                if tag_installed(tags, t):
                    picks[tier] = t
                    break
            else:
                continue
            break

    advice: list[str] = []
    if ram < 12:
        advice.append("RAM <12GB: keep flash 7b only; avoid 30b max (will page hard).")
    elif ram < 24:
        advice.append("RAM 12–24GB: qwen3-coder:30b MoE OK if q8_0 KV + keep_alive; skip 32b dense.")
    else:
        advice.append("RAM ≥24GB: dual-resident flash+max OK; dense critic optional.")
    if hardware_snapshot().get("apple_silicon"):
        advice.append(
            "Apple Silicon: stay on Ollama; consider omlx/mlx-lm only if tok/s plateaus "
            "(see knowledge/local-llm-stack.md)."
        )
    if missing:
        advice.append(
            "Optional pulls: " + ", ".join(m["id"] for m in missing[:5]) + " (manual ollama pull)."
        )
    return {
        "ram_gb": round(ram, 1),
        "picks": picks,
        "by_tier": {k: v[:4] for k, v in by_tier.items()},
        "missing_fits": missing[:8],
        "advice": advice,
        "matrix": [
            {
                "id": r["id"],
                "tier": r["tier"],
                "min_ram_gb": r["min_ram_gb"],
                "role": r["role"],
                "tags": list(r["tags"]),
            }
            for r in MODEL_MATRIX
        ],
    }


def load_bench() -> dict[str, Any]:
    if not BENCH_FILE.is_file():
        return {}
    try:
        return json.loads(BENCH_FILE.read_text(encoding="utf-8"))
    except Exception:
        return {}


def gate_default_switch(proposed_max: str, *, force: bool = False) -> dict[str, Any]:
    """
    Refuse promoting a new max default without a fresh local bench.
    Env DOTLAB_MODEL_GATE=0 disables. force=True records approval.
    """
    if os.environ.get("DOTLAB_MODEL_GATE", "1") in ("0", "false", "off"):
        return {"ok": True, "skipped": True, "reason": "gate_disabled"}
    proposed = (proposed_max or "").strip()
    if not proposed:
        return {"ok": False, "error": "empty model"}
    bench = load_bench()
    age = time.time() - float(bench.get("ts") or 0)
    results = bench.get("results") or []
    max_row = next((r for r in results if r.get("tier") == "max"), None)
    if force:
        GATE_FILE.parent.mkdir(parents=True, exist_ok=True)
        GATE_FILE.write_text(
            json.dumps({"approved": proposed, "ts": time.time(), "bench": max_row}, indent=2),
            encoding="utf-8",
        )
        return {"ok": True, "approved": proposed, "forced": True}

    if not max_row or age > 7 * 86400:
        return {
            "ok": False,
            "error": "no fresh bench (run: gamemaster turbo bench)",
            "age_s": int(age) if bench else None,
            "hint": f"After bench: gamemaster models gate --approve {proposed}",
        }
    gen = float(max_row.get("gen_tps") or 0)
    if gen < 2.0:
        return {
            "ok": False,
            "error": f"max gen_tps too low ({gen}); model may thrash",
            "bench": max_row,
        }
    # already approved?
    try:
        g = json.loads(GATE_FILE.read_text(encoding="utf-8")) if GATE_FILE.is_file() else {}
        if g.get("approved") == proposed:
            return {"ok": True, "approved": proposed, "cached": True}
    except Exception:
        pass
    return {
        "ok": False,
        "error": "default switch needs explicit approve after bench",
        "bench_max": max_row,
        "hint": f"gamemaster models gate --approve {proposed}",
    }


def format_status_block() -> str:
    hw = hardware_snapshot()
    rec = recommend(hw["ram_gb"])
    lines = [
        "hardware-fit:",
        f"  ram={hw['ram_gb']}GB  machine={hw['machine']}  apple_silicon={hw['apple_silicon']}",
        f"  ollama_loaded={', '.join(hw['ollama_loaded']) or '(none)'}",
        f"  installed_models={hw['installed_count']}",
        f"  recommend flash={rec['picks'].get('flash')}  max={rec['picks'].get('max')}  "
        f"dense={rec['picks'].get('dense')}",
    ]
    for a in rec.get("advice") or []:
        lines.append(f"  · {a}")
    return "\n".join(lines)


def main() -> int:
    ap = argparse.ArgumentParser(description="dotLab model matrix")
    sub = ap.add_subparsers(dest="cmd")
    sub.add_parser("list")
    sub.add_parser("recommend")
    sub.add_parser("hardware")
    g = sub.add_parser("gate")
    g.add_argument("--approve", default="", help="approve model as default after bench")
    g.add_argument("model", nargs="?", default="")
    args = ap.parse_args()
    if args.cmd == "list":
        print(json.dumps({"matrix": MODEL_MATRIX}, indent=2, default=str)[:12000])
        return 0
    if args.cmd == "recommend":
        print(json.dumps(recommend(), indent=2)[:12000])
        return 0
    if args.cmd == "hardware":
        print(json.dumps(hardware_snapshot(), indent=2))
        return 0
    if args.cmd == "gate":
        m = args.approve or args.model or os.environ.get("DOTLAB_MODEL") or "dotlab"
        if args.approve:
            print(json.dumps(gate_default_switch(m, force=True), indent=2))
        else:
            print(json.dumps(gate_default_switch(m, force=False), indent=2))
        return 0
    ap.print_help()
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
