#!/usr/bin/env python3
"""
LoRA export helpers — turn accept-pairs into Unsloth/Kiln-friendly JSONL.

Does not train; prepares data for external fine-tune (Unsloth / TRL / Kiln).

  gamemaster lora export
  gamemaster lora export --out /tmp/pairs.jsonl
  gamemaster lora stats
"""
from __future__ import annotations

import argparse
import json
from pathlib import Path
from typing import Any

from gmcommon import CONFIG

PAIRS = CONFIG / "lora-pairs"
DEFAULT_OUT = CONFIG / "lora-pairs" / "export-sft.jsonl"
MIN_TRAIN_PAIRS = 200


def iter_pairs(limit: int = 500) -> list[dict[str, Any]]:
    if not PAIRS.is_dir():
        return []
    files = sorted(PAIRS.glob("pair-*.json"), key=lambda p: p.stat().st_mtime, reverse=True)
    out: list[dict] = []
    for p in files[:limit]:
        try:
            data = json.loads(p.read_text(encoding="utf-8"))
            if isinstance(data, dict):
                data["_file"] = p.name
                out.append(data)
        except Exception:
            continue
    return out


def to_sft_row(pair: dict) -> dict[str, str] | None:
    """Map host pair → chat SFT row {instruction, input, output}."""
    instruction = str(
        pair.get("instruction")
        or pair.get("prompt")
        or pair.get("task")
        or pair.get("kind")
        or "Improve this game slice"
    )[:2000]
    inp = str(pair.get("before") or pair.get("input") or pair.get("context") or "")[:6000]
    out = str(pair.get("after") or pair.get("output") or pair.get("patch") or "")[:8000]
    if not out and pair.get("accepted"):
        out = str(pair.get("accepted"))[:8000]
    if not out:
        return None
    return {
        "instruction": instruction,
        "input": inp,
        "output": out,
        "engine": str(pair.get("engine") or ""),
        "kind": str(pair.get("kind") or ""),
    }


def export_sft(out_path: Path | None = None, limit: int = 500) -> dict[str, Any]:
    dest = Path(out_path or DEFAULT_OUT)
    dest.parent.mkdir(parents=True, exist_ok=True)
    rows = []
    for p in iter_pairs(limit=limit):
        row = to_sft_row(p)
        if row:
            rows.append(row)
    with dest.open("w", encoding="utf-8") as f:
        for r in rows:
            f.write(json.dumps(r, ensure_ascii=False) + "\n")
    # kiln/unsloth hint file
    hint = dest.with_suffix(".README.txt")
    hint.write_text(
        "dotLab LoRA export\n"
        "==================\n"
        "This JSONL is for external fine-tunes (Unsloth / TRL / Kiln).\n"
        "Host does not auto-train. Typical flow:\n"
        "  1) Ship games → accept pairs accumulate in config/lora-pairs/\n"
        "  2) gamemaster lora export\n"
        "  3) Fine-tune offline; ollama create custom tag\n"
        "  4) gamemaster models gate --approve <tag> after turbo bench\n",
        encoding="utf-8",
    )
    ready = len(rows) >= MIN_TRAIN_PAIRS
    msg = None
    if not ready:
        msg = (
            f"Need {MIN_TRAIN_PAIRS}+ clean pairs before a LoRA (have {len(rows)}). "
            "Collect verify-green accept pairs first — training now would make flash worse."
        )
        print(f"  ⚠ {msg}")
    return {
        "ok": True,
        "path": str(dest),
        "rows": len(rows),
        "ready": ready,
        "min_pairs": MIN_TRAIN_PAIRS,
        "message": msg,
    }


def harvest_kernel(limit: int = 500) -> dict[str, Any]:
    """Write SFT rows from the Grok kernel trace log (no model, no train)."""
    try:
        import grok as groklib
    except Exception as exc:
        return {"ok": False, "error": str(exc), "rows": 0}
    rows = groklib.harvest_pairs(limit=limit)
    dest = PAIRS / "export-kernel.jsonl"
    dest.parent.mkdir(parents=True, exist_ok=True)
    with dest.open("w", encoding="utf-8") as handle:
        for row in rows:
            handle.write(json.dumps(row, ensure_ascii=False) + "\n")
    return {
        "ok": True,
        "path": str(dest),
        "rows": len(rows),
        "ready": len(rows) >= MIN_TRAIN_PAIRS,
        "min_pairs": MIN_TRAIN_PAIRS,
        "source": "grok-kernel",
    }


def stats() -> dict[str, Any]:
    pairs = iter_pairs()
    kinds: dict[str, int] = {}
    for p in pairs:
        k = str(p.get("kind") or "unknown")
        kinds[k] = kinds.get(k, 0) + 1
    kernel_n = 0
    try:
        import grok as groklib

        traces = groklib.load_kernel_traces()
        kernel_n = len(traces)
        for row in traces:
            k = str(row.get("kind") or "grok")
            kinds[k] = kinds.get(k, 0) + 1
    except Exception:
        kernel_n = 0
    n = len(pairs)
    return {
        "count": n,
        "kernel_traces": kernel_n,
        "kinds": kinds,
        "dir": str(PAIRS),
        "ready": n >= MIN_TRAIN_PAIRS,
        "min_pairs": MIN_TRAIN_PAIRS,
    }


def main() -> int:
    ap = argparse.ArgumentParser(description="dotLab LoRA export")
    sub = ap.add_subparsers(dest="cmd")
    sub.add_parser("stats")
    e = sub.add_parser("export")
    e.add_argument("--out", default="")
    e.add_argument("--limit", type=int, default=500)
    h = sub.add_parser("harvest")
    h.add_argument("--limit", type=int, default=500)
    args = ap.parse_args()
    if args.cmd == "stats":
        print(json.dumps(stats(), indent=2))
        return 0
    if args.cmd == "export":
        print(json.dumps(export_sft(Path(args.out) if args.out else None, limit=args.limit), indent=2))
        return 0
    if args.cmd == "harvest":
        print(json.dumps(harvest_kernel(limit=getattr(args, "limit", 500) or 500), indent=2))
        return 0
    ap.print_help()
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
