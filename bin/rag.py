#!/usr/bin/env python3
"""
Slice RAG — retrieve successful project snippets for coder context.

Uses Ollama /api/embeddings when available; falls back to keyword TF scoring.
Index lives under config/slice-rag/ (product-level, not secrets).
"""
from __future__ import annotations

import hashlib
import json
import math
import os
import re
import time
from pathlib import Path
from typing import Any

from gmcommon import CONFIG, ROOT, list_game_projects, meta_dir, ollama_json

INDEX_DIR = CONFIG / "slice-rag"
INDEX_FILE = INDEX_DIR / "index.json"
EMBED_MODEL = (
    os.environ.get("DOTLAB_EMBED")
    or os.environ.get("GAMEMASTER_EMBED")
    or "nomic-embed-text"
)
# Optional Ollama reranker tag (Qwen3-Reranker etc.). Empty = local lexical rerank only.
RERANK_MODEL = (os.environ.get("DOTLAB_RERANK") or os.environ.get("GAMEMASTER_RERANK") or "").strip()
RERANK_CANDIDATES = int(os.environ.get("DOTLAB_RERANK_CANDIDATES", "12"))

SKIP = frozenset(
    {"node_modules", ".git", "dist", "build", ".vite", ".dotlab", ".gamemaster", "craft"}
)
SNIPPET_MAX = 1200
MAX_CHUNKS_PER_PROJECT = 8


def _tokenize(text: str) -> list[str]:
    return re.findall(r"[a-zA-Z_][a-zA-Z0-9_]{2,}", (text or "").lower())


def _bow(text: str) -> dict[str, float]:
    counts: dict[str, float] = {}
    for t in _tokenize(text):
        counts[t] = counts.get(t, 0.0) + 1.0
    # tf log
    return {k: 1.0 + math.log(v) for k, v in counts.items()}


def _cos(a: dict[str, float], b: dict[str, float]) -> float:
    if not a or not b:
        return 0.0
    keys = set(a) & set(b)
    if not keys:
        return 0.0
    dot = sum(a[k] * b[k] for k in keys)
    na = math.sqrt(sum(v * v for v in a.values())) or 1.0
    nb = math.sqrt(sum(v * v for v in b.values())) or 1.0
    return dot / (na * nb)


def embed(text: str) -> list[float] | None:
    """Ollama embeddings; None if model/API missing."""
    text = (text or "")[:8000]
    if not text.strip():
        return None
    try:
        res = ollama_json(
            "/api/embeddings",
            {"model": EMBED_MODEL, "prompt": text},
            timeout=60,
        )
        vec = res.get("embedding")
        if isinstance(vec, list) and vec:
            return [float(x) for x in vec]
    except Exception:
        return None
    return None


def _cos_vec(a: list[float], b: list[float]) -> float:
    if not a or not b or len(a) != len(b):
        return 0.0
    dot = sum(x * y for x, y in zip(a, b))
    na = math.sqrt(sum(x * x for x in a)) or 1.0
    nb = math.sqrt(sum(x * x for x in b)) or 1.0
    return dot / (na * nb)


def _chunk_file(rel: str, text: str, genre: str, score: int) -> list[dict[str, Any]]:
    chunks: list[dict[str, Any]] = []
    # Prefer function-sized chunks
    parts = re.split(r"(?m)(?=^export\s+|^function\s+|^const\s+\w+\s*=\s*(?:function|\())", text)
    if len(parts) < 2:
        parts = [text[i : i + SNIPPET_MAX] for i in range(0, min(len(text), SNIPPET_MAX * 3), SNIPPET_MAX)]
    for i, part in enumerate(parts[:MAX_CHUNKS_PER_PROJECT]):
        body = part.strip()
        if len(body) < 80:
            continue
        body = body[:SNIPPET_MAX]
        hid = hashlib.sha1(f"{rel}:{i}:{body[:80]}".encode()).hexdigest()[:12]
        chunks.append(
            {
                "id": hid,
                "path": rel,
                "text": body,
                "genre": genre,
                "verify_score": score,
                "bow": _bow(body + " " + rel + " " + genre),
            }
        )
    return chunks


def index_project(project: Path) -> list[dict[str, Any]]:
    project = Path(project)
    genre = ""
    score = 0
    for meta_name in (".dotlab", ".gamemaster"):
        sp = project / meta_name / "slice.json"
        if sp.is_file():
            try:
                data = json.loads(sp.read_text(encoding="utf-8"))
                genre = str((data or {}).get("genre") or "")
            except Exception:
                pass
        vp = project / meta_name / "verify.json"
        if vp.is_file():
            try:
                v = json.loads(vp.read_text(encoding="utf-8"))
                score = int((v or {}).get("score") or 0)
            except Exception:
                pass
    p0_ok = False
    try:
        import verify as verifylib

        vr = verifylib.evaluate(project)
        score = int(vr.get("score") or score or 0)
        p0_ok = bool(vr.get("ok"))
    except Exception:
        p0_ok = score >= 80
    if not p0_ok:
        return []  # only index P0-pass slices

    chunks: list[dict[str, Any]] = []
    for rel in ("src/game.js", "src/main.js", "src/systems", "src/player", "src/fx"):
        path = project / rel
        if path.is_file() and path.suffix in (".js", ".mjs", ".ts"):
            try:
                text = path.read_text(encoding="utf-8", errors="ignore")
            except OSError:
                continue
            chunks.extend(_chunk_file(rel, text, genre, score))
        elif path.is_dir():
            for p in sorted(path.rglob("*.js"))[:6]:
                try:
                    text = p.read_text(encoding="utf-8", errors="ignore")
                    r = str(p.relative_to(project))
                    chunks.extend(_chunk_file(r, text, genre, score))
                except OSError:
                    continue
    # attach embeddings if possible
    for ch in chunks:
        ch["project"] = str(project)
        ch["name"] = project.name
        vec = embed(ch["text"][:1500])
        if vec:
            ch["vec"] = vec
        # drop heavy bow in file store? keep for fallback
    return chunks


def rebuild_index(limit_projects: int = 40) -> dict[str, Any]:
    INDEX_DIR.mkdir(parents=True, exist_ok=True)
    all_chunks: list[dict[str, Any]] = []
    projects = list_game_projects()
    # newest first
    projects = sorted(projects, key=lambda p: p.get("mtime") or 0, reverse=True)[
        :limit_projects
    ]
    for info in projects:
        path = Path(info.get("path") or "")
        if not path.is_dir():
            continue
        try:
            all_chunks.extend(index_project(path))
        except Exception:
            continue
    # serialize (truncate vec for size if huge)
    store = {
        "updated_at": time.time(),
        "embed_model": EMBED_MODEL,
        "count": len(all_chunks),
        "chunks": all_chunks,
    }
    INDEX_FILE.write_text(json.dumps(store), encoding="utf-8")
    return {"ok": True, "count": len(all_chunks), "projects": len(projects)}


def load_index() -> dict[str, Any]:
    if not INDEX_FILE.is_file():
        return {"chunks": [], "count": 0}
    try:
        return json.loads(INDEX_FILE.read_text(encoding="utf-8"))
    except Exception:
        return {"chunks": [], "count": 0}


def _lexical_rerank(query: str, candidates: list[tuple[float, dict]]) -> list[tuple[float, dict]]:
    """Cross-score query tokens against candidate text (cheap local rerank)."""
    q_bow = _bow(query)
    if not q_bow:
        return candidates
    out: list[tuple[float, dict]] = []
    for base, ch in candidates:
        text_bow = ch.get("bow") or _bow(str(ch.get("text") or "")[:1500])
        # overlap density
        overlap = _cos(q_bow, text_bow)
        # exact path/name boosts
        blob = f"{ch.get('path')} {ch.get('name')} {ch.get('genre')}".lower()
        boost = 0.0
        for tok in list(q_bow.keys())[:20]:
            if tok in blob:
                boost += 0.02
        out.append((base * 0.55 + overlap * 0.4 + boost, ch))
    out.sort(key=lambda x: x[0], reverse=True)
    return out


def _ollama_rerank(query: str, candidates: list[tuple[float, dict]], k: int) -> list[tuple[float, dict]] | None:
    """Best-effort model rerank if DOTLAB_RERANK is set (many tags won't support it)."""
    if not RERANK_MODEL or not candidates:
        return None
    # Ask model to order indices — fragile; fall back on failure
    snippets = []
    for i, (_, ch) in enumerate(candidates[:RERANK_CANDIDATES]):
        snippets.append(f"[{i}] {(ch.get('text') or '')[:280]}")
    prompt = (
        f"Query: {query[:400]}\n\nPassages:\n"
        + "\n".join(snippets)
        + "\n\nReturn JSON {\"order\":[best_index,...]} with the best passages first."
    )
    try:
        res = ollama_json(
            "/api/chat",
            {
                "model": RERANK_MODEL,
                "messages": [{"role": "user", "content": prompt}],
                "stream": False,
                "format": "json",
                "options": {"temperature": 0, "num_predict": 120, "num_ctx": 4096},
            },
            timeout=30,
        )
        text = (res.get("message") or {}).get("content") or "{}"
        data = json.loads(text) if isinstance(text, str) else {}
        order = data.get("order") if isinstance(data, dict) else None
        if not isinstance(order, list):
            return None
        remapped: list[tuple[float, dict]] = []
        seen: set[int] = set()
        for rank, idx in enumerate(order):
            try:
                i = int(idx)
            except (TypeError, ValueError):
                continue
            if i < 0 or i >= len(candidates) or i in seen:
                continue
            seen.add(i)
            base, ch = candidates[i]
            remapped.append((base + (len(order) - rank) * 0.01, ch))
        for i, pair in enumerate(candidates):
            if i not in seen:
                remapped.append(pair)
        return remapped[:k] if remapped else None
    except Exception:
        return None


def retrieve(query: str, *, k: int = 3, genre: str = "") -> list[dict[str, Any]]:
    data = load_index()
    chunks = list(data.get("chunks") or [])
    if not chunks:
        # opportunistic small rebuild
        try:
            rebuild_index(limit_projects=15)
            data = load_index()
            chunks = list(data.get("chunks") or [])
        except Exception:
            pass
    if not chunks:
        return []

    q_vec = embed(query)
    q_bow = _bow(query + " " + genre)
    scored: list[tuple[float, dict]] = []
    for ch in chunks:
        if genre and ch.get("genre") and genre not in str(ch.get("genre")):
            # soft prefer same genre
            genre_boost = 0.0
        else:
            genre_boost = 0.08 if genre and genre in str(ch.get("genre") or "") else 0.0
        s = 0.0
        if q_vec and ch.get("vec"):
            s = _cos_vec(q_vec, ch["vec"])
        else:
            s = _cos(q_bow, ch.get("bow") or {})
        s += genre_boost
        s += min(0.1, (int(ch.get("verify_score") or 0) / 1000.0))
        scored.append((s, ch))
    scored.sort(key=lambda x: x[0], reverse=True)
    # two-stage: take top-N then rerank
    pool = scored[: max(k * 4, RERANK_CANDIDATES)]
    reranked = _ollama_rerank(query, pool, k=max(k * 2, 6))
    if reranked is None:
        pool = _lexical_rerank(query, pool)
    else:
        pool = reranked
    out = []
    for s, ch in pool[:k]:
        out.append(
            {
                "score": round(s, 4),
                "path": ch.get("path"),
                "project": ch.get("name") or ch.get("project"),
                "genre": ch.get("genre"),
                "text": ch.get("text"),
                "rerank": bool(RERANK_MODEL) or True,
            }
        )
    return out


def prompt_block(query: str, *, k: int = 3, genre: str = "", max_chars: int = 3500) -> str:
    hits = retrieve(query, k=k, genre=genre)
    if not hits:
        return ""
    parts = ["# Retrieved successful slice snippets (style reference — adapt, do not copy blindly)"]
    used = 0
    for h in hits:
        block = (
            f"\n## from {h.get('project')} · {h.get('path')} (sim={h.get('score')})\n"
            f"```js\n{(h.get('text') or '')[:900]}\n```\n"
        )
        if used + len(block) > max_chars:
            break
        parts.append(block)
        used += len(block)
    return "\n".join(parts)


def main() -> int:
    import argparse

    ap = argparse.ArgumentParser(description="dotLab slice RAG")
    sub = ap.add_subparsers(dest="cmd")
    sub.add_parser("rebuild")
    p = sub.add_parser("query")
    p.add_argument("text")
    p.add_argument("-k", type=int, default=3)
    p.add_argument("--genre", default="")
    args = ap.parse_args()
    if args.cmd == "rebuild":
        print(json.dumps(rebuild_index(), indent=2))
        return 0
    if args.cmd == "query":
        print(json.dumps(retrieve(args.text, k=args.k, genre=args.genre), indent=2)[:8000])
        return 0
    ap.print_help()
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
