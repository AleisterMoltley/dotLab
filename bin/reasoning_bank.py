#!/usr/bin/env python3
"""
Reasoning bank (light) — store successful and failed agent/verify trajectories.

Inspired by google-research/reasoning-bank: learn from failures, not only wins.
Host-owned JSONL under project meta + optional global config bank.

  gamemaster bank record -p DIR --kind verify_fail --summary "..."
  gamemaster bank show -p DIR
  gamemaster bank prompt -p DIR --query "repair jump"
"""
from __future__ import annotations

import argparse
import json
import time
from pathlib import Path
from typing import Any

from gmcommon import CONFIG, meta_dir

GLOBAL_BANK = CONFIG / "reasoning-bank" / "global.jsonl"
MAX_PROJECT = 80
MAX_GLOBAL = 400
PROMPT_MAX = 2800


def bank_path(project: Path | None) -> Path:
    if project and Path(project).is_dir():
        return meta_dir(Path(project)) / "reasoning-bank.jsonl"
    return GLOBAL_BANK


def record(
    project: Path | None,
    *,
    kind: str,
    summary: str,
    detail: str = "",
    tags: list[str] | None = None,
    ok: bool = False,
    meta: dict | None = None,
) -> dict[str, Any]:
    entry = {
        "t": time.time(),
        "kind": (kind or "note")[:64],
        "ok": bool(ok),
        "summary": (summary or "")[:500],
        "detail": (detail or "")[:4000],
        "tags": [str(t)[:40] for t in (tags or [])[:12]],
        "meta": meta or {},
    }
    paths = []
    if project and Path(project).is_dir():
        paths.append(bank_path(project))
    paths.append(GLOBAL_BANK)
    for path in paths:
        try:
            path.parent.mkdir(parents=True, exist_ok=True)
            with path.open("a", encoding="utf-8") as f:
                f.write(json.dumps(entry, ensure_ascii=False) + "\n")
            # trim
            _trim(path, MAX_PROJECT if path != GLOBAL_BANK else MAX_GLOBAL)
        except OSError:
            continue
    return {"ok": True, "entry": entry}


def _trim(path: Path, max_lines: int) -> None:
    try:
        lines = path.read_text(encoding="utf-8", errors="ignore").splitlines()
        if len(lines) <= max_lines:
            return
        path.write_text("\n".join(lines[-max_lines:]) + "\n", encoding="utf-8")
    except OSError:
        pass


def load_entries(project: Path | None, *, limit: int = 40) -> list[dict[str, Any]]:
    out: list[dict[str, Any]] = []
    for path in (bank_path(project), GLOBAL_BANK):
        if not path.is_file():
            continue
        try:
            for line in path.read_text(encoding="utf-8", errors="ignore").splitlines():
                line = line.strip()
                if not line:
                    continue
                try:
                    out.append(json.loads(line))
                except Exception:
                    continue
        except OSError:
            continue
    out.sort(key=lambda e: float(e.get("t") or 0), reverse=True)
    # de-dupe by summary
    seen: set[str] = set()
    deduped: list[dict] = []
    for e in out:
        k = str(e.get("summary") or "")[:120]
        if k in seen:
            continue
        seen.add(k)
        deduped.append(e)
        if len(deduped) >= limit:
            break
    return deduped


def _score(entry: dict, query: str) -> float:
    q = (query or "").lower()
    if not q:
        return 1.0 if not entry.get("ok") else 0.3
    blob = " ".join(
        [
            str(entry.get("kind") or ""),
            str(entry.get("summary") or ""),
            str(entry.get("detail") or "")[:800],
            " ".join(entry.get("tags") or []),
        ]
    ).lower()
    s = 0.0
    for tok in re_tokens(q):
        if tok in blob:
            s += 1.0
    if not entry.get("ok"):
        s += 0.5  # prefer failures for repair
    return s


def re_tokens(text: str) -> list[str]:
    import re

    return re.findall(r"[a-zA-Z_][a-zA-Z0-9_]{2,}", (text or "").lower())


def retrieve(project: Path | None, query: str = "", *, k: int = 5) -> list[dict[str, Any]]:
    entries = load_entries(project, limit=60)
    scored = [(_score(e, query), e) for e in entries]
    scored.sort(key=lambda x: x[0], reverse=True)
    return [e for s, e in scored[:k] if s > 0 or not query]


def prompt_block(project: Path | None, query: str = "", *, k: int = 4, max_chars: int = PROMPT_MAX) -> str:
    hits = retrieve(project, query, k=k)
    if not hits:
        return ""
    parts = [
        "# Reasoning bank (past successes/failures — fix root causes, do not repeat)",
    ]
    used = 0
    for h in hits:
        mark = "OK" if h.get("ok") else "FAIL"
        block = (
            f"\n## [{mark}] {h.get('kind')}: {h.get('summary')}\n"
            f"{(h.get('detail') or '')[:600]}\n"
        )
        if used + len(block) > max_chars:
            break
        parts.append(block)
        used += len(block)
    return "\n".join(parts)


def record_verify(project: Path, vr: dict[str, Any]) -> dict[str, Any]:
    """Helper from agent/studio after verify."""
    p0 = list(vr.get("p0_fail") or [])
    ok = bool(vr.get("ok")) and not p0
    summary = "verify pass" if ok else "verify P0: " + ", ".join(str(x) for x in p0[:8])
    detail = (vr.get("report") or "")[:3500]
    return record(
        project,
        kind="verify_pass" if ok else "verify_fail",
        summary=summary,
        detail=detail,
        tags=p0[:8],
        ok=ok,
        meta={"score": vr.get("score")},
    )


def main() -> int:
    ap = argparse.ArgumentParser(description="dotLab reasoning bank")
    sub = ap.add_subparsers(dest="cmd")
    r = sub.add_parser("record")
    r.add_argument("-p", "--project", default="")
    r.add_argument("--kind", default="note")
    r.add_argument("--summary", required=True)
    r.add_argument("--detail", default="")
    r.add_argument("--ok", action="store_true")
    s = sub.add_parser("show")
    s.add_argument("-p", "--project", default="")
    s.add_argument("-n", type=int, default=15)
    p = sub.add_parser("prompt")
    p.add_argument("-p", "--project", default="")
    p.add_argument("--query", default="")
    args = ap.parse_args()
    proj = Path(args.project).expanduser() if getattr(args, "project", None) and args.project else None
    if args.cmd == "record":
        print(json.dumps(record(proj, kind=args.kind, summary=args.summary, detail=args.detail, ok=args.ok), indent=2))
        return 0
    if args.cmd == "show":
        print(json.dumps(load_entries(proj, limit=args.n), indent=2)[:12000])
        return 0
    if args.cmd == "prompt":
        print(prompt_block(proj, args.query))
        return 0
    ap.print_help()
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
