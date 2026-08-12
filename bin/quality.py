#!/usr/bin/env python3
"""
dotLab quality pipeline — host-side speed + ship-rate.

Phases (all local, $0):
  P0  Patch-only coder · Director JSON · stable prefix · dual keep-alive · draft/max
  P1  Best-of-N + verify score · auto-critic one-shot · genre slots (see slots.py)
  P2  Stream-apply · play-error auto-repair · slice RAG (see rag.py)
  P3  Accept-pair logging (LoRA later) · client prefix-cache

No cloud required. Deterministic gates prefer verify over model claims.
"""
from __future__ import annotations

import hashlib
import json
import os
import re
import shutil
import time
from concurrent.futures import ThreadPoolExecutor, as_completed
from pathlib import Path
from typing import Any, Callable, Iterator

from gmcommon import (
    DEFAULT_MODEL,
    DENSE_MODEL,
    FLASH_MODEL,
    ROOT,
    meta_dir,
    ollama_json,
)

# ── Protected paths: coder must not full-replace when large ─────────────

PROTECTED_FULL_REPLACE = frozenset(
    {
        "src/game.js",
        "src/main.js",
        "index.html",
        "package.json",
    }
)
PROTECTED_MIN_LINES = 80  # below this, full replace still ok

ALLOWED_NEW_PREFIXES = (
    "src/systems/",
    "src/player/",
    "src/world/",
    "src/fx/",
    "src/ui/",
    "src/npc/",
    "src/weapons/",
    "src/craft/",
)

# ── Patch grammar ───────────────────────────────────────────────────────

_PATCH_FILE = re.compile(
    r"(?m)^(?:@@\s*file:|//\s*file:|#\s*file:)\s*(\S+)\s*$"
)
_SEARCH_MARK = re.compile(r"(?m)^@@\s*search\s*$")
_REPLACE_MARK = re.compile(r"(?m)^@@\s*replace\s*$")
_END_MARK = re.compile(r"(?m)^@@\s*end\s*$")

DIRECTOR_JSON_SCHEMA = {
    "pitch": str,
    "verb": str,
    "t8s": str,
    "pillars": list,
    "slice": str,
    "genre": str,
    "palette_id": str,
    "feel": dict,
    "non_goals": list,
    "novelty": str,
    "first_death": str,
    "metric": str,
}

DIRECTOR_JSON_INSTRUCTION = """
Output ONLY a single JSON object (no markdown fences, no prose outside JSON) with keys:
{
  "pitch": "2 sentences sharper than the brief",
  "verb": "core verb phrase",
  "t8s": "what player does at t=8s",
  "pillars": ["p1","p2","p3"],
  "slice": "vertical slice scope in one session",
  "genre": "fps|arena|platformer|runner|racing|horror|adventure|rpg|…",
  "palette_id": "neon|forest|desert|ice|dungeon|village|dusk",
  "feel": {"gravity":24,"moveSpeed":6.2,"jumpForce":8.2,"coyoteMs":100},
  "non_goals": ["thing we will not build"],
  "novelty": "ONE unique hook for this slice",
  "first_death": "fair first death + teach beat",
  "metric": "one more run? test"
}
Real numbers only in feel. English keys. Match user language inside string values.
""".strip()

CODER_PATCH_INSTRUCTION = """
PATCH-ONLY CONTRACT (host enforces):
- Prefer surgical patches over full file rewrites.
- Format for each edit:

@@ file:src/systems/foo.js
@@ search
exact existing lines to find
@@ replace
replacement lines
@@ end

- Or write_file only for NEW files under src/systems/|player/|world/|fx/|ui/|npc/|weapons/
- Do NOT full-replace src/game.js / src/main.js / index.html when they already exist and are large.
  Read them and patch with @@ search/replace, or add a small module and import it.
- Host owns feel numbers, juice, audio, palette (src/craft + CONFIG). You own novelty + content.
- done only when P0 verify would pass.
""".strip()


# ── Prefix cache (client-side) ──────────────────────────────────────────

_PREFIX_CACHE: dict[str, dict[str, Any]] = {}


def stable_prefix_hash(text: str) -> str:
    """SHA256 of normalized system prefix (no timestamps / host paths)."""
    norm = re.sub(r"\r\n", "\n", text or "")
    # strip accidental absolute paths that would bust cache
    norm = re.sub(r"/Users/[^\s]+", "<HOME>", norm)
    norm = re.sub(r"/home/[^\s]+", "<HOME>", norm)
    return hashlib.sha256(norm.encode("utf-8")).hexdigest()[:16]


def prefix_cache_get(key: str) -> dict[str, Any] | None:
    ent = _PREFIX_CACHE.get(key)
    if not ent:
        return None
    if time.time() - float(ent.get("ts") or 0) > 6 * 3600:
        _PREFIX_CACHE.pop(key, None)
        return None
    return ent


def prefix_cache_put(key: str, system: str, meta: dict | None = None) -> None:
    _PREFIX_CACHE[key] = {
        "ts": time.time(),
        "system_len": len(system or ""),
        "hash": key,
        **(meta or {}),
    }


def strip_volatile_system(system: str) -> str:
    """Remove lines that change every call (busts Ollama prompt cache)."""
    lines = []
    for line in (system or "").splitlines():
        if re.search(r"\b(20\d{2}-\d{2}-\d{2}|UTC|session id|pid=)\b", line, re.I):
            continue
        lines.append(line)
    return "\n".join(lines)


# ── Ollama options: keep-alive, draft, batch ────────────────────────────


def draft_model_tag() -> str:
    return (
        os.environ.get("DOTLAB_DRAFT")
        or os.environ.get("GAMEMASTER_DRAFT")
        or FLASH_MODEL
    )


def use_speculative() -> bool:
    """Host draft/max pipeline (and optional Ollama draft field if supported)."""
    v = os.environ.get("DOTLAB_SPECULATIVE", os.environ.get("GAMEMASTER_SPECULATIVE", "1"))
    return str(v).strip().lower() not in ("0", "false", "off", "no")


def ollama_chat_options(
    *,
    temperature: float = 0.18,
    num_ctx: int = 12288,
    num_predict: int = 4096,
    tier: str = "max",
    speculative: bool | None = None,
) -> dict[str, Any]:
    """Build options + top-level fields for /api/chat."""
    opts: dict[str, Any] = {
        "temperature": temperature,
        "num_ctx": int(num_ctx),
        "num_predict": int(num_predict),
        "num_batch": int(os.environ.get("OLLAMA_NUM_BATCH", "512")),
    }
    payload_extra: dict[str, Any] = {
        "keep_alive": os.environ.get("OLLAMA_KEEP_ALIVE", "24h"),
        "options": opts,
    }
    # Ollama may ignore unknown fields; draft is best-effort if runner supports it
    do_spec = use_speculative() if speculative is None else speculative
    if do_spec and tier in ("max", "dense", "coder"):
        draft = draft_model_tag()
        if draft and draft != opts.get("model"):
            # Common experimental keys — harmless if ignored
            payload_extra["draft"] = draft
            opts["draft"] = draft
    return payload_extra


def ensure_dual_warmup(force: bool = False) -> dict[str, Any]:
    """Load flash + max into RAM with long keep_alive. Idempotent."""
    flag = ROOT / "config" / ".warmup-ok"
    if not force and flag.is_file():
        age = time.time() - flag.stat().st_mtime
        if age < 3600:
            return {"ok": True, "cached": True, "age_s": int(age)}
    try:
        import turbo as turbolib

        turbolib.warmup(["flash", "max"])
        flag.parent.mkdir(parents=True, exist_ok=True)
        flag.write_text(str(int(time.time())), encoding="utf-8")
        return {"ok": True, "cached": False}
    except Exception as e:
        return {"ok": False, "error": str(e)}


# ── Director JSON ───────────────────────────────────────────────────────

_JSON_OBJ = re.compile(r"\{[\s\S]*\}")


def extract_json_object(text: str) -> dict | None:
    raw = (text or "").strip()
    if not raw:
        return None
    # strip fences
    raw = re.sub(r"^```(?:json)?\s*", "", raw)
    raw = re.sub(r"\s*```$", "", raw)
    try:
        data = json.loads(raw)
        return data if isinstance(data, dict) else None
    except Exception:
        pass
    m = _JSON_OBJ.search(text or "")
    if not m:
        return None
    try:
        data = json.loads(m.group(0))
        return data if isinstance(data, dict) else None
    except Exception:
        return None


def validate_director_json(data: dict | None) -> tuple[bool, list[str], dict]:
    """Return (ok, errors, normalized)."""
    errs: list[str] = []
    if not isinstance(data, dict):
        return False, ["not an object"], {}
    out: dict[str, Any] = {}
    for key in ("pitch", "verb", "t8s", "slice", "genre", "novelty"):
        val = data.get(key)
        if not isinstance(val, str) or not val.strip():
            errs.append(f"missing string:{key}")
        else:
            out[key] = val.strip()[:800]
    pillars = data.get("pillars")
    if not isinstance(pillars, list) or len(pillars) < 1:
        errs.append("pillars must be non-empty list")
        out["pillars"] = []
    else:
        out["pillars"] = [str(p)[:120] for p in pillars[:5]]
    non_goals = data.get("non_goals")
    out["non_goals"] = (
        [str(x)[:120] for x in non_goals[:8]] if isinstance(non_goals, list) else []
    )
    feel = data.get("feel") if isinstance(data.get("feel"), dict) else {}
    out["feel"] = {}
    for k, v in feel.items():
        try:
            out["feel"][str(k)[:40]] = float(v) if not isinstance(v, bool) else v
        except (TypeError, ValueError):
            continue
    out["palette_id"] = str(data.get("palette_id") or "dusk")[:40]
    out["first_death"] = str(data.get("first_death") or "")[:400]
    out["metric"] = str(data.get("metric") or "one more run?")[:200]
    return (len(errs) == 0, errs, out)


def director_json_to_markdown(d: dict) -> str:
    """Human-readable DESIGN block from validated director JSON."""
    pillars = "\n".join(f"- {p}" for p in (d.get("pillars") or []))
    non = "\n".join(f"- {n}" for n in (d.get("non_goals") or [])) or "- (none)"
    feel = d.get("feel") or {}
    feel_lines = ", ".join(f"{k}={v}" for k, v in list(feel.items())[:12]) or "(host defaults)"
    return (
        f"**Pitch:** {d.get('pitch','')}\n\n"
        f"**Verb:** {d.get('verb','')}\n\n"
        f"**t=8s:** {d.get('t8s','')}\n\n"
        f"**Genre:** {d.get('genre','')} · **Palette:** {d.get('palette_id','')}\n\n"
        f"**Pillars:**\n{pillars}\n\n"
        f"**Vertical slice:** {d.get('slice','')}\n\n"
        f"**Novelty:** {d.get('novelty','')}\n\n"
        f"**Feel:** {feel_lines}\n\n"
        f"**First death:** {d.get('first_death','')}\n\n"
        f"**NON-goals:**\n{non}\n\n"
        f"**Metric:** {d.get('metric','')}\n"
    )


# ── Search/replace patches ──────────────────────────────────────────────


def parse_patches(text: str) -> list[dict[str, str]]:
    """
    Parse @@ file / @@ search / @@ replace / @@ end blocks.
    Also accepts // file: path then whole-body as full replace when no search.
    """
    text = text or ""
    patches: list[dict[str, str]] = []
    # Primary grammar
    parts = re.split(r"(?m)^(?=@@\s*file:)", text)
    for part in parts:
        m = re.match(r"(?ms)^@@\s*file:\s*(\S+)\s*\n(.*)$", part)
        if not m:
            continue
        path = m.group(1).strip().lstrip("./")
        body = m.group(2)
        sm = _SEARCH_MARK.search(body)
        rm = _REPLACE_MARK.search(body)
        if sm and rm and sm.start() < rm.start():
            search = body[sm.end() : rm.start()]
            rest = body[rm.end() :]
            em = _END_MARK.search(rest)
            replace = rest[: em.start()] if em else rest
            patches.append(
                {
                    "path": path,
                    "mode": "search_replace",
                    "search": search.strip("\n"),
                    "replace": replace.strip("\n"),
                }
            )
        else:
            # full body after file line (until next @@ file or end)
            em = _END_MARK.search(body)
            content = body[: em.start()] if em else body
            content = re.sub(r"(?m)^@@\s*(search|replace)\s*$", "", content)
            patches.append(
                {
                    "path": path,
                    "mode": "full",
                    "content": content.strip("\n") + ("\n" if content.strip() else ""),
                }
            )
    return patches


def _allowed_write_path(rel: str, *, is_new: bool) -> tuple[bool, str]:
    rel = (rel or "").strip().lstrip("./")
    if ".." in rel or rel.startswith("/"):
        return False, "path traversal"
    if rel in PROTECTED_FULL_REPLACE or rel.startswith("src/"):
        if rel in PROTECTED_FULL_REPLACE and is_new is False:
            return True, ""  # may patch; full checked separately
        if any(rel.startswith(p) for p in ALLOWED_NEW_PREFIXES) or rel.startswith("src/"):
            return True, ""
    if rel in ("WIKI.md", "DESIGN.md", "MAP.md"):
        return True, ""
    if rel.startswith("src/"):
        return True, ""
    return False, f"path not allowed: {rel}"


def apply_search_replace(project: Path, path: str, search: str, replace: str) -> dict[str, Any]:
    rel = path.strip().lstrip("./")
    dest = (project / rel).resolve()
    try:
        dest.relative_to(project.resolve())
    except ValueError:
        return {"ok": False, "path": rel, "error": "outside project"}
    if not dest.is_file():
        return {"ok": False, "path": rel, "error": "file missing"}
    text = dest.read_text(encoding="utf-8")
    if search not in text:
        # try relaxed whitespace
        rx = re.escape(search)
        rx = re.sub(r"(\\ )+", r"\\s+", rx)
        m = re.search(rx, text)
        if not m:
            return {"ok": False, "path": rel, "error": "search block not found"}
        text = text[: m.start()] + replace + text[m.end() :]
    else:
        text = text.replace(search, replace, 1)
    dest.write_text(text, encoding="utf-8")
    return {"ok": True, "path": rel, "mode": "search_replace"}


def apply_full_write(
    project: Path, path: str, content: str, *, force: bool = False
) -> dict[str, Any]:
    rel = path.strip().lstrip("./")
    dest = project / rel
    exists = dest.is_file()
    ok, err = _allowed_write_path(rel, is_new=not exists)
    if not ok:
        return {"ok": False, "path": rel, "error": err}
    if exists and rel in PROTECTED_FULL_REPLACE and not force:
        try:
            lines = dest.read_text(encoding="utf-8").count("\n") + 1
        except OSError:
            lines = 0
        if lines >= PROTECTED_MIN_LINES:
            return {
                "ok": False,
                "path": rel,
                "error": (
                    f"full replace blocked on {rel} ({lines} lines). "
                    "Use @@ search/@@ replace or a new src/systems/* module."
                ),
            }
    dest.parent.mkdir(parents=True, exist_ok=True)
    if exists and dest.stat().st_size > 0:
        bak = dest.with_suffix(dest.suffix + ".bak")
        try:
            bak.write_bytes(dest.read_bytes())
        except OSError:
            pass
    dest.write_text(content if content.endswith("\n") else content + "\n", encoding="utf-8")
    return {"ok": True, "path": rel, "mode": "full"}


def apply_patches(project: Path, text: str, *, force_full: bool = False) -> dict[str, Any]:
    """Apply all patches from model text. Returns written/rejected/errors."""
    project = Path(project)
    patches = parse_patches(text)
    written: list[str] = []
    rejected: list[dict[str, Any]] = []
    for p in patches:
        if p.get("mode") == "search_replace":
            r = apply_search_replace(project, p["path"], p["search"], p["replace"])
        else:
            r = apply_full_write(
                project, p["path"], p.get("content") or "", force=force_full
            )
        if r.get("ok"):
            written.append(r["path"])
        else:
            rejected.append(r)
    return {
        "written": written,
        "rejected": rejected,
        "patch_count": len(patches),
        "ok": bool(written) and not rejected,
    }


def stream_extract_and_apply(
    project: Path,
    chunks: Iterator[str],
    *,
    on_file: Callable[[str], None] | None = None,
) -> dict[str, Any]:
    """
    Accumulate stream tokens; whenever a complete @@ end or fenced file closes, apply.
    """
    buf = ""
    applied: list[str] = []
    last_count = 0
    for chunk in chunks:
        buf += chunk
        # apply when we see @@ end
        if "@@ end" in buf or re.search(r"```\s*$", buf):
            res = apply_patches(project, buf)
            for w in res.get("written") or []:
                if w not in applied:
                    applied.append(w)
                    if on_file:
                        try:
                            on_file(w)
                        except Exception:
                            pass
            # keep tail after last complete patch to avoid re-applying wrong
            if res.get("written"):
                last_count = len(applied)
                # retain incomplete trailing part
                parts = re.split(r"(?m)^@@\s*end\s*$", buf)
                buf = parts[-1] if len(parts) > 1 else ""
    # final pass
    if buf.strip():
        res = apply_patches(project, buf)
        for w in res.get("written") or []:
            if w not in applied:
                applied.append(w)
                if on_file:
                    try:
                        on_file(w)
                    except Exception:
                        pass
    return {"written": applied, "ok": bool(applied), "passes": last_count}


# ── Verify score + Best-of-N ────────────────────────────────────────────


def score_project(project: Path) -> dict[str, Any]:
    import verify as verifylib

    vr = verifylib.evaluate(project)
    score = int(vr.get("score") or 0)
    p0 = list(vr.get("p0_fail") or [])
    # bonus for craft + playtest hooks
    js = ""
    try:
        for name in ("src/game.js", "src/main.js"):
            p = project / name
            if p.is_file():
                js += p.read_text(encoding="utf-8", errors="ignore")
    except OSError:
        pass
    bonus = 0
    if "TimeJuice" in js or "src/craft" in js or (project / "src" / "craft").is_dir():
        bonus += 3
    if "__GF_PLAYTEST__" in js:
        bonus += 2
    if "hitstop" in js or "shake" in js:
        bonus += 2
    final = min(100, score + bonus)
    return {
        "score": final,
        "base": score,
        "bonus": bonus,
        "p0_fail": p0,
        "p0_ok": not p0,
        "report": vr.get("report") or "",
    }


def _snapshot_tree(project: Path) -> dict[str, str]:
    snap: dict[str, str] = {}
    for dirpath, dirnames, filenames in os.walk(project):
        dirnames[:] = [
            d
            for d in dirnames
            if d not in ("node_modules", ".git", "dist", "build", ".dotlab", ".gamemaster", ".vite")
        ]
        for name in filenames:
            if not name.endswith((".js", ".mjs", ".ts", ".html", ".css", ".json", ".md")):
                continue
            p = Path(dirpath) / name
            try:
                rel = str(p.relative_to(project))
                if p.stat().st_size > 400_000:
                    continue
                snap[rel] = p.read_text(encoding="utf-8", errors="ignore")
            except OSError:
                continue
    return snap


def _restore_tree(project: Path, snap: dict[str, str], written_extra: list[str] | None = None) -> None:
    # restore known files
    for rel, body in snap.items():
        dest = project / rel
        dest.parent.mkdir(parents=True, exist_ok=True)
        dest.write_text(body, encoding="utf-8")
    # remove files that appeared after snapshot if listed
    if written_extra:
        for rel in written_extra:
            if rel not in snap:
                p = project / rel
                if p.is_file():
                    try:
                        p.unlink()
                    except OSError:
                        pass


def best_of_n(
    project: Path,
    generators: list[Callable[[], str]],
    *,
    n: int | None = None,
    apply_fn: Callable[[Path, str], dict] | None = None,
) -> dict[str, Any]:
    """
    Run N generators, apply each candidate in isolation, pick highest verify score.
    generators: zero-arg callables returning model text (patch or full files).
    """
    n = n or int(os.environ.get("DOTLAB_BEST_OF", os.environ.get("GAMEMASTER_BEST_OF", "2")))
    n = max(1, min(4, n))
    gens = generators[:n]
    if not gens:
        return {"ok": False, "error": "no generators"}
    if n == 1:
        text = gens[0]()
        apply = apply_fn or (lambda proj, t: apply_patches(proj, t))
        res = apply(project, text)
        sc = score_project(project)
        return {
            "ok": sc["p0_ok"],
            "winner": 0,
            "score": sc,
            "apply": res,
            "candidates": [{"i": 0, "score": sc, "text_len": len(text)}],
        }

    base = _snapshot_tree(project)
    cand_dir = meta_dir(project) / "candidates"
    cand_dir.mkdir(parents=True, exist_ok=True)
    results: list[dict[str, Any]] = []
    apply = apply_fn or (lambda proj, t: apply_patches(proj, t))

    for i, gen in enumerate(gens):
        _restore_tree(project, base)
        try:
            text = gen()
        except Exception as e:
            results.append({"i": i, "error": str(e), "score": {"score": -1, "p0_ok": False}})
            continue
        applied = apply(project, text)
        sc = score_project(project)
        # stash candidate text
        (cand_dir / f"cand-{i}.txt").write_text(text[:200_000], encoding="utf-8")
        (cand_dir / f"cand-{i}.json").write_text(
            json.dumps({"score": sc, "apply": applied}, indent=2) + "\n", encoding="utf-8"
        )
        results.append(
            {
                "i": i,
                "score": sc,
                "apply": applied,
                "text_len": len(text),
                "text": text,
            }
        )

    def rank_key(r: dict) -> tuple:
        sc = r.get("score") or {}
        return (
            1 if sc.get("p0_ok") else 0,
            int(sc.get("score") or -1),
            -len(r.get("apply", {}).get("rejected") or []),
        )

    results_sorted = sorted(results, key=rank_key, reverse=True)
    winner = results_sorted[0] if results_sorted else None
    if not winner or winner.get("error"):
        _restore_tree(project, base)
        return {"ok": False, "error": "all candidates failed", "candidates": results}

    # re-apply winner
    _restore_tree(project, base)
    wtext = winner.get("text") or ""
    if not wtext:
        p = cand_dir / f"cand-{winner['i']}.txt"
        wtext = p.read_text(encoding="utf-8") if p.is_file() else ""
    applied = apply(project, wtext)
    final_sc = score_project(project)
    # drop huge text from return
    slim = []
    for r in results:
        slim.append(
            {
                "i": r["i"],
                "score": r.get("score"),
                "error": r.get("error"),
                "text_len": r.get("text_len"),
            }
        )
    return {
        "ok": bool(final_sc.get("p0_ok")),
        "winner": winner["i"],
        "score": final_sc,
        "apply": applied,
        "candidates": slim,
    }


# ── Auto-critic one-shot + single repair ────────────────────────────────


def auto_critic_and_repair(
    project: Path,
    brief: str,
    design: str,
    architecture: str,
    code_summary: str,
    model: str,
    *,
    run_coder: Callable[[Path, str, str, int], str] | None = None,
) -> dict[str, Any]:
    """
    One critic call + at most one repair agent pass + verify.
    """
    import studio as studiolib

    critic_model = model
    try:
        import turbo as turbolib

        critic_model = turbolib.resolve_tier("dense")
    except Exception:
        critic_model = DENSE_MODEL or model

    critique = studiolib.role_critic(
        brief, design, architecture, code_summary, critic_model, project=project
    )
    meta = meta_dir(project) / "studio"
    meta.mkdir(parents=True, exist_ok=True)
    (meta / "04-critic-auto.md").write_text(critique, encoding="utf-8")

    # extract must-fix
    must = []
    for m in re.finditer(
        r"(?im)^(?:\d+\.|[-*]|P0[:\s]|Must[- ]fix[:\s]+)(.+)$", critique
    ):
        line = m.group(1).strip()
        if len(line) > 12:
            must.append(line[:200])
        if len(must) >= 3:
            break
    if not must:
        must = ["Apply critic top feel/clarity fixes only; no new features."]

    sc_before = score_project(project)
    repair_out = ""
    if run_coder is None:
        run_coder = studiolib.run_coder_agent

    # only repair if critic found real issues or p0 fail
    needs = (not sc_before["p0_ok"]) or bool(
        re.search(r"\bP0\b|must[- ]fix|broken|unfair|boring", critique, re.I)
    )
    if needs:
        fix_task = (
            "Apply ONLY these must-fix items. Patch-only. No new features.\n\n"
            + "\n".join(f"- {x}" for x in must)
            + f"\n\nCRITIC (full):\n{critique[:3500]}\n\n"
            + CODER_PATCH_INSTRUCTION
        )
        repair_out = run_coder(project, fix_task, model, 8)
        (meta / "05-repair-auto.txt").write_text(repair_out[-20000:], encoding="utf-8")

    sc_after = score_project(project)
    try:
        studiolib.learn_from_critic(project, critique)
    except Exception:
        pass

    return {
        "critique": critique,
        "must_fix": must,
        "repaired": bool(repair_out),
        "score_before": sc_before,
        "score_after": sc_after,
        "ok": sc_after.get("p0_ok", False),
    }


# ── Play-error auto-repair ──────────────────────────────────────────────

_STACK_FILE = re.compile(
    r"(?:at\s+)?(?:file://)?(?:[^\s(]+/)?((?:src/)?[a-zA-Z0-9_./-]+\.(?:js|mjs|ts|html)):(\d+)"
)


def play_error_auto_repair(
    project: Path,
    log_text: str,
    *,
    model: str | None = None,
    run_coder: Callable[[Path, str, str, int], str] | None = None,
) -> dict[str, Any]:
    """Diagnose play.log / console dump → host fix or one coder repair."""
    import studio_ops as ops

    diag = ops.diagnose_play_log(log_text or "")
    issues = diag.get("issues") or []
    actions: list[str] = []

    # Host-side npm missing: cannot npm install silently without network policy — report only
    codes = {i.get("code") for i in issues}
    if "syntax" in codes or "import" in codes:
        # try extract file from stack
        files = _STACK_FILE.findall(log_text or "")
        targets = []
        for path, line in files[:5]:
            if "node_modules" in path:
                continue
            targets.append((path, line))
        # common: game.js
        if not targets and (project / "src" / "game.js").is_file():
            targets.append(("src/game.js", "1"))

        if run_coder is None:
            import studio as studiolib

            run_coder = studiolib.run_coder_agent
        model = model or DEFAULT_MODEL
        snippet = (log_text or "")[-2500:]
        task = (
            "Runtime/dev error repair ONLY. Fix the syntax/import error. Patch-only.\n\n"
            f"LOG:\n{snippet}\n\n"
            f"Likely files: {', '.join(t[0] for t in targets) or 'src/game.js'}\n"
            + CODER_PATCH_INSTRUCTION
            + "\nAfter fix, game must parse (node --check)."
        )
        out = run_coder(project, task, model, 6)
        actions.append("coder_repair")
        sc = score_project(project)
        meta_dir(project).mkdir(parents=True, exist_ok=True)
        (meta_dir(project) / "auto-repair.txt").write_text(out[-15000:], encoding="utf-8")
        return {
            "ok": sc.get("p0_ok", False),
            "diagnose": diag,
            "actions": actions,
            "score": sc,
            "out_tail": out[-1500:],
        }

    if "npm_missing" in codes:
        return {
            "ok": False,
            "diagnose": diag,
            "actions": ["need_npm_install"],
            "message": "Run npm install in the project folder",
        }
    if "port_busy" in codes:
        return {
            "ok": False,
            "diagnose": diag,
            "actions": ["port_busy"],
            "message": "Stop other Vite or pick a free port",
        }
    if diag.get("ok"):
        return {"ok": True, "diagnose": diag, "actions": [], "message": "no repair needed"}
    return {"ok": False, "diagnose": diag, "actions": [], "message": diag.get("primary") or "unknown"}


# ── Accept pairs (LoRA dataset later) ───────────────────────────────────


def log_accept_pair(
    project: Path,
    *,
    instruction: str,
    before: str,
    after: str,
    kind: str = "patch",
    meta: dict | None = None,
) -> Path:
    """Append a training pair under .dotlab/lora-pairs/ (or product meta)."""
    root = meta_dir(project) / "lora-pairs"
    root.mkdir(parents=True, exist_ok=True)
    # also global corpus under product config (not secrets)
    global_root = ROOT / "config" / "lora-pairs"
    global_root.mkdir(parents=True, exist_ok=True)
    entry = {
        "t": time.time(),
        "project": str(project),
        "kind": kind,
        "instruction": (instruction or "")[:2000],
        "before": (before or "")[:80_000],
        "after": (after or "")[:80_000],
        "meta": meta or {},
    }
    name = f"pair-{int(time.time() * 1000)}.json"
    path = root / name
    path.write_text(json.dumps(entry, indent=2) + "\n", encoding="utf-8")
    try:
        shutil.copy(path, global_root / name)
    except OSError:
        pass
    # index
    idx = global_root / "index.jsonl"
    with idx.open("a", encoding="utf-8") as f:
        f.write(
            json.dumps(
                {
                    "file": name,
                    "t": entry["t"],
                    "kind": kind,
                    "instruction": entry["instruction"][:200],
                }
            )
            + "\n"
        )
    return path


def snapshot_file(project: Path, rel: str) -> str:
    p = project / rel
    if not p.is_file():
        return ""
    try:
        return p.read_text(encoding="utf-8", errors="ignore")
    except OSError:
        return ""


# ── Draft → Max host speculative ────────────────────────────────────────


def draft_then_max(
    messages: list[dict],
    *,
    flash_model: str | None = None,
    max_model: str | None = None,
    temperature: float = 0.18,
    num_predict: int = 4096,
    num_ctx: int = 12288,
    mode: str = "code",
) -> str:
    """
    Host speculative: flash drafts, max refines (or accepts short draft if already complete).
    mode: code|json|text
    """
    from cloud import chat as llm_chat

    flash = flash_model or draft_model_tag()
    target = max_model or DEFAULT_MODEL
    if not use_speculative() or flash == target:
        return llm_chat(
            messages,
            model=target,
            temperature=temperature,
            num_predict=num_predict,
            num_ctx=num_ctx,
        )

    draft_msgs = list(messages)
    if mode == "json":
        draft_msgs = messages + [
            {
                "role": "user",
                "content": "Draft the JSON only. Be complete.",
            }
        ]
    draft = llm_chat(
        draft_msgs,
        model=flash,
        temperature=min(0.35, temperature + 0.1),
        num_predict=min(num_predict, 2048 if mode == "json" else 3072),
        num_ctx=min(num_ctx, 8192),
    )
    # Accept draft early for clean JSON
    if mode == "json":
        data = extract_json_object(draft)
        ok, _, _ = validate_director_json(data)
        if ok:
            return draft

    refine = [
        *messages,
        {"role": "assistant", "content": draft},
        {
            "role": "user",
            "content": (
                "Improve the draft above. Keep structure. Fix bugs/holes. "
                "Output the FINAL answer only"
                + (" (valid JSON object only)." if mode == "json" else ".")
            ),
        },
    ]
    return llm_chat(
        refine,
        model=target,
        temperature=temperature,
        num_predict=num_predict,
        num_ctx=num_ctx,
    )


# ── CLI smoke ───────────────────────────────────────────────────────────


def main() -> int:
    import argparse

    ap = argparse.ArgumentParser(description="dotLab quality pipeline tools")
    sub = ap.add_subparsers(dest="cmd")
    sub.add_parser("warmup")
    p = sub.add_parser("score")
    p.add_argument("-p", "--project", required=True)
    p = sub.add_parser("parse-patches")
    p.add_argument("file", nargs="?", help="file or stdin")
    p = sub.add_parser("apply-patches")
    p.add_argument("-p", "--project", required=True)
    p.add_argument("file")
    p = sub.add_parser("director-json")
    p.add_argument("file", nargs="?")
    p = sub.add_parser("repair-log")
    p.add_argument("-p", "--project", required=True)
    p.add_argument("--log", default="")
    args = ap.parse_args()

    if args.cmd == "warmup":
        print(json.dumps(ensure_dual_warmup(force=True), indent=2))
        return 0
    if args.cmd == "score":
        print(json.dumps(score_project(Path(args.project)), indent=2))
        return 0
    if args.cmd == "parse-patches":
        text = Path(args.file).read_text(encoding="utf-8") if args.file else ""
        print(json.dumps(parse_patches(text), indent=2))
        return 0
    if args.cmd == "apply-patches":
        text = Path(args.file).read_text(encoding="utf-8")
        print(json.dumps(apply_patches(Path(args.project), text), indent=2))
        return 0
    if args.cmd == "director-json":
        text = Path(args.file).read_text(encoding="utf-8") if args.file else ""
        data = extract_json_object(text)
        ok, errs, norm = validate_director_json(data)
        print(json.dumps({"ok": ok, "errors": errs, "data": norm}, indent=2))
        return 0 if ok else 1
    if args.cmd == "repair-log":
        log = (
            Path(args.log).read_text(encoding="utf-8")
            if args.log
            else (meta_dir(Path(args.project)) / "play.log").read_text(encoding="utf-8")
        )
        print(json.dumps(play_error_auto_repair(Path(args.project), log), indent=2)[:4000])
        return 0
    ap.print_help()
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
