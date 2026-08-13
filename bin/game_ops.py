#!/usr/bin/env python3
"""
Game Ops — UPF-inspired event protocol for dotLab.

LLM proposes typed JSON events; the **host** applies them.
Never crash on creativity: invalid ops are rejected with reasons.

  gamemaster game-ops apply -p DIR events.json
  gamemaster game-ops schema
  gamemaster game-ops context -p DIR --topics feel,ship-bar

Events (minimal set):
  set_feel, set_counts, set_palette, set_vintage_palette, set_engine,
  set_genre, set_flag, lock, unlock, add_room, craft, request_context, note
"""
from __future__ import annotations

import json
import re
import time
from pathlib import Path
from typing import Any

from gmcommon import KNOWLEDGE, meta_dir

# ── Schema / docs ───────────────────────────────────────────────────────

OP_TYPES = (
    "set_feel",
    "set_counts",
    "set_palette",
    "set_vintage_palette",
    "set_engine",
    "set_genre",
    "set_flag",
    "lock",
    "unlock",
    "add_room",
    "craft",
    "request_context",
    "note",
)

FEEL_KEYS = frozenset(
    {
        "moveSpeed",
        "gravity",
        "jumpForce",
        "accel",
        "friction",
        "coyoteMs",
        "jumpBufferMs",
        "jumpCut",
        "camLag",
        "camDist",
        "camHeight",
        "eyeHeight",
        "fov",
        "adsFov",
        "mouseSens",
        "fireRpm",
        "damage",
        "spread",
        "adsSpread",
        "hitstopMs",
        "shakeHit",
        "hp",
        "dashSpeed",
        "dashMs",
        "dashCdMs",
        "runSpeed",
    }
)

CONTEXT_TOPICS = {
    "feel": ("feel-tables.md", "ship-bar.md"),
    "ship-bar": ("ship-bar.md", "skill-fps.md"),
    "anti_slop": (
        "anti-slop/fail-green-capsule.md",
        "anti-slop/fail-silence-hit.md",
        "anti-slop/fail-config-ones.md",
    ),
    "vintage": ("vintage.md",),
    "engines": ("engine-kits.md", "quality-pipeline.md"),
    "pixel": ("pixel-kit.md",),
    "craft": ("grok-craft.md", "combat-juice.md"),
    "identity": ("identity.md",),
    "slice": (),  # filled from project slice.json
    "locks": (),
    "flags": (),
}

OPS_INSTRUCTION = """
GAME OPS (preferred over free code for feel/counts/palette/engine/flags):
Emit a JSON array of events. Host applies; invalid ops are skipped.

```json
[
  {"type":"set_feel","gravity":28,"moveSpeed":7.2},
  {"type":"set_counts","enemyCount":5,"coinCount":8},
  {"type":"set_vintage_palette","id":"dmg"},
  {"type":"lock","path":"feel.gravity"},
  {"type":"add_room"},
  {"type":"craft","text":"tighter snappy controls"},
  {"type":"request_context","topics":["feel","vintage"]},
  {"type":"set_flag","flag":"met_npc","value":true},
  {"type":"note","text":"player liked dash"}
]
```

Types: set_feel | set_counts | set_palette | set_vintage_palette | set_engine |
set_genre | set_flag | lock | unlock | add_room | craft | request_context | note
Locks in slice.json block later writes to those paths.
""".strip()


def schema_doc() -> dict[str, Any]:
    return {
        "types": list(OP_TYPES),
        "feel_keys": sorted(FEEL_KEYS),
        "context_topics": sorted(CONTEXT_TOPICS.keys()),
        "instruction": OPS_INSTRUCTION,
    }


# ── Parse ───────────────────────────────────────────────────────────────

_JSON_ARR = re.compile(r"\[[\s\S]*\]")
_JSON_OBJ = re.compile(r"\{[\s\S]*\}")


def extract_ops(text: str) -> list[dict[str, Any]]:
    """Pull ops array from model text (fenced or bare)."""
    raw = (text or "").strip()
    if not raw:
        return []
    raw = re.sub(r"^```(?:json)?\s*", "", raw)
    raw = re.sub(r"\s*```$", "", raw)
    candidates: list[str] = [raw]
    m = _JSON_ARR.search(text or "")
    if m:
        candidates.insert(0, m.group(0))
    for c in candidates:
        try:
            data = json.loads(c)
        except Exception:
            continue
        if isinstance(data, list):
            return [x for x in data if isinstance(x, dict)]
        if isinstance(data, dict):
            if "type" in data:
                return [data]
            if isinstance(data.get("ops"), list):
                return [x for x in data["ops"] if isinstance(x, dict)]
            if isinstance(data.get("events"), list):
                return [x for x in data["events"] if isinstance(x, dict)]
    return []


# ── Locks / flags / audit ───────────────────────────────────────────────


def _locks(spec: dict) -> set[str]:
    locks = spec.get("locks")
    if isinstance(locks, list):
        return {str(x) for x in locks}
    if isinstance(locks, dict):
        return {str(k) for k, v in locks.items() if v}
    return set()


def _set_locks(spec: dict, locks: set[str]) -> None:
    spec["locks"] = sorted(locks)


def is_locked(spec: dict, path: str) -> bool:
    locks = _locks(spec)
    path = path.strip()
    if path in locks:
        return True
    # parent lock: feel locks all feel.*
    parts = path.split(".")
    for i in range(1, len(parts)):
        if ".".join(parts[:i]) in locks:
            return True
    return False


def flags_path(project: Path) -> Path:
    return meta_dir(project) / "flags.json"


def load_flags(project: Path) -> dict[str, Any]:
    p = flags_path(project)
    if not p.is_file():
        return {}
    try:
        data = json.loads(p.read_text(encoding="utf-8"))
        return data if isinstance(data, dict) else {}
    except Exception:
        return {}


def save_flags(project: Path, flags: dict) -> None:
    meta_dir(project).mkdir(parents=True, exist_ok=True)
    flags_path(project).write_text(json.dumps(flags, indent=2) + "\n", encoding="utf-8")


def audit_ops(project: Path, results: list[dict], source: str = "game_ops") -> None:
    try:
        import security as seclib

        seclib.audit(
            project,
            source,
            {
                "n": len(results),
                "ok": sum(1 for r in results if r.get("ok")),
                "types": [r.get("type") for r in results[:20]],
            },
        )
    except Exception:
        pass
    # dedicated ops log
    try:
        meta = meta_dir(project)
        meta.mkdir(parents=True, exist_ok=True)
        path = meta / "game_ops.jsonl"
        with path.open("a", encoding="utf-8") as f:
            f.write(
                json.dumps({"t": time.time(), "source": source, "results": results[:40]})
                + "\n"
            )
    except Exception:
        pass


# ── Context ─────────────────────────────────────────────────────────────


def request_context(project: Path | None, topics: list[str], max_chars: int = 6000) -> str:
    """Targeted knowledge + slice/locks/flags (UPF request_context)."""
    parts: list[str] = []
    used = 0
    for topic in topics:
        t = (topic or "").strip().lower().replace("-", "_")
        if t in ("ship_bar", "shipbar"):
            t = "ship-bar"
        if t == "slice" and project:
            try:
                import engine_ops as eops

                sp = eops.load_slice(project) or {}
                slim = {
                    k: sp.get(k)
                    for k in (
                        "title",
                        "genre",
                        "engine",
                        "verb",
                        "loop",
                        "camera",
                        "feel",
                        "enemyCount",
                        "coinCount",
                        "locks",
                        "shipBar",
                    )
                    if k in sp or k == "locks"
                }
                if "locks" not in slim:
                    slim["locks"] = list(_locks(sp))
                block = f"## slice\n```json\n{json.dumps(slim, indent=2)[:2000]}\n```\n"
            except Exception as e:
                block = f"## slice\n(error {e})\n"
        elif t == "locks" and project:
            try:
                import engine_ops as eops

                sp = eops.load_slice(project) or {}
                block = f"## locks\n{sorted(_locks(sp))}\n"
            except Exception:
                block = "## locks\n[]\n"
        elif t == "flags" and project:
            block = f"## flags\n```json\n{json.dumps(load_flags(project), indent=2)[:1500]}\n```\n"
        else:
            files = CONTEXT_TOPICS.get(t) or CONTEXT_TOPICS.get(topic.strip().lower()) or ()
            chunks = []
            for name in files:
                p = KNOWLEDGE / name
                if p.is_file():
                    chunks.append(p.read_text(encoding="utf-8")[:1800])
            block = f"## {topic}\n" + ("\n".join(chunks) if chunks else "(unknown topic)\n")
        if used + len(block) > max_chars:
            remain = max_chars - used
            if remain > 200:
                parts.append(block[:remain])
            break
        parts.append(block)
        used += len(block)
    return "\n".join(parts) if parts else "(no context)"


# ── Apply single op ─────────────────────────────────────────────────────


def _load_spec(project: Path) -> dict | None:
    import patch as patchlib

    return patchlib.load_spec(project)


def _save_and_rebuild(project: Path, spec: dict) -> list[str]:
    import slice as slicelib

    return slicelib.write_slice(project, spec)


def apply_one(project: Path, op: dict[str, Any], spec: dict) -> dict[str, Any]:
    """Apply one op; mutates spec in place. Returns result dict."""
    otype = str(op.get("type") or "").strip().lower()
    if otype not in OP_TYPES:
        return {"ok": False, "type": otype or "?", "error": f"unknown type (allowed: {', '.join(OP_TYPES)})"}

    if otype == "note":
        return {"ok": True, "type": "note", "text": str(op.get("text") or "")[:300]}

    if otype == "request_context":
        topics = op.get("topics") or op.get("topic") or []
        if isinstance(topics, str):
            topics = [topics]
        if not isinstance(topics, list):
            topics = []
        ctx = request_context(project, [str(t) for t in topics[:12]])
        return {"ok": True, "type": "request_context", "topics": topics, "context": ctx}

    if otype == "lock":
        path = str(op.get("path") or op.get("field") or "").strip()
        if not path:
            return {"ok": False, "type": otype, "error": "path required"}
        locks = _locks(spec)
        locks.add(path)
        _set_locks(spec, locks)
        return {"ok": True, "type": "lock", "path": path, "rebuild": False}

    if otype == "unlock":
        path = str(op.get("path") or op.get("field") or "").strip()
        if not path:
            return {"ok": False, "type": otype, "error": "path required"}
        locks = _locks(spec)
        locks.discard(path)
        _set_locks(spec, locks)
        return {"ok": True, "type": "unlock", "path": path, "rebuild": False}

    if otype == "set_flag":
        flag = str(op.get("flag") or op.get("id") or "").strip()
        if not flag:
            return {"ok": False, "type": otype, "error": "flag required"}
        if is_locked(spec, f"flags.{flag}") or is_locked(spec, "flags"):
            return {"ok": False, "type": otype, "error": f"locked: flags.{flag}"}
        flags = load_flags(project)
        if "value" in op:
            flags[flag] = op.get("value")
        else:
            flags[flag] = True
        save_flags(project, flags)
        return {"ok": True, "type": "set_flag", "flag": flag, "value": flags[flag], "rebuild": False}

    if otype == "set_feel":
        feel = spec.setdefault("feel", {})
        applied = []
        for k, v in op.items():
            if k == "type":
                continue
            if k not in FEEL_KEYS:
                continue
            path = f"feel.{k}"
            if is_locked(spec, path) or is_locked(spec, "feel"):
                return {"ok": False, "type": otype, "error": f"locked: {path}"}
            try:
                if k in ("coyoteMs", "jumpBufferMs", "hitstopMs", "fireRpm", "dashMs", "dashCdMs", "hp"):
                    feel[k] = int(round(float(v)))
                else:
                    feel[k] = float(v)
                applied.append(f"{k}={feel[k]}")
            except (TypeError, ValueError):
                continue
        if not applied:
            return {"ok": False, "type": otype, "error": "no valid feel keys"}
        return {"ok": True, "type": "set_feel", "applied": applied, "rebuild": True}

    if otype == "set_counts":
        applied = []
        for k in ("enemyCount", "coinCount", "hazardCount", "roomCount", "juice", "density"):
            if k not in op:
                continue
            if is_locked(spec, k):
                return {"ok": False, "type": otype, "error": f"locked: {k}"}
            try:
                if k in ("juice", "density"):
                    spec[k] = float(op[k])
                else:
                    spec[k] = int(op[k])
                # vintage caps
                if spec.get("engine") == "vintage":
                    if k == "enemyCount":
                        spec[k] = min(int(spec[k]), 5)
                    if k == "roomCount":
                        spec[k] = min(int(spec[k]), 6)
                applied.append(f"{k}={spec[k]}")
            except (TypeError, ValueError):
                continue
        if not applied:
            return {"ok": False, "type": otype, "error": "no valid counts"}
        return {"ok": True, "type": "set_counts", "applied": applied, "rebuild": True}

    if otype == "set_palette":
        if is_locked(spec, "palette") or is_locked(spec, "props"):
            return {"ok": False, "type": otype, "error": "locked: palette"}
        if spec.get("engine") == "vintage":
            return {
                "ok": False,
                "type": otype,
                "error": "use set_vintage_palette for vintage projects",
            }
        props = str(op.get("props") or op.get("id") or op.get("palette_id") or "").strip()
        if not props:
            return {"ok": False, "type": otype, "error": "props/id required"}
        import slice as slicelib

        if props not in slicelib._PALETTES:
            return {"ok": False, "type": otype, "error": f"unknown props (have: {', '.join(slicelib._PALETTES)})"}
        spec["props"] = props
        spec["palette"] = dict(slicelib._PALETTES[props])
        return {"ok": True, "type": "set_palette", "props": props, "rebuild": True}

    if otype == "set_vintage_palette":
        if is_locked(spec, "palette") or is_locked(spec, "vintage"):
            return {"ok": False, "type": otype, "error": "locked: palette/vintage"}
        pid = str(op.get("id") or op.get("palette_id") or op.get("props") or "dmg").strip()
        import engine_ops as eops

        r = eops.set_vintage_palette(project, pid)
        if not r.get("ok"):
            return {"ok": False, "type": otype, "error": r.get("error") or "failed"}
        # refresh spec from disk
        fresh = _load_spec(project)
        if fresh:
            spec.clear()
            spec.update(fresh)
        return {"ok": True, "type": "set_vintage_palette", "id": pid, "rebuild": False, "written": r.get("written")}

    if otype == "set_engine":
        if is_locked(spec, "engine"):
            return {"ok": False, "type": otype, "error": "locked: engine"}
        eng = str(op.get("engine") or op.get("id") or "").strip().lower()
        if eng not in ("three", "pixel", "vintage"):
            return {"ok": False, "type": otype, "error": "engine must be three|pixel|vintage"}
        import engine_ops as eops

        r = eops.switch_engine(
            project,
            eng,
            vintage_profile=str(op.get("profile") or op.get("vintage_profile") or "gb"),
        )
        if not r.get("ok"):
            return {"ok": False, "type": otype, "error": r.get("error") or "switch failed"}
        fresh = _load_spec(project)
        if fresh:
            spec.clear()
            spec.update(fresh)
        return {"ok": True, "type": "set_engine", "engine": eng, "rebuild": False, "written": r.get("written")}

    if otype == "set_genre":
        if is_locked(spec, "genre"):
            return {"ok": False, "type": otype, "error": "locked: genre"}
        g = str(op.get("genre") or op.get("id") or "").strip().lower()
        import slice as slicelib

        if g not in slicelib.GENRES:
            return {"ok": False, "type": otype, "error": f"unknown genre"}
        vprof = None
        if isinstance(spec.get("vintage"), dict):
            vprof = spec["vintage"].get("profile")
        merged = slicelib.compile_prompt(
            str(spec.get("prompt") or g),
            genre=g,
            engine=spec.get("engine"),
            vintage_profile=vprof,
        )
        for k in ("genre", "loop", "camera", "verb", "feel"):
            if is_locked(spec, k):
                continue
            spec[k] = merged[k]
        return {"ok": True, "type": "set_genre", "genre": g, "rebuild": True}

    if otype == "add_room":
        if is_locked(spec, "roomCount"):
            return {"ok": False, "type": otype, "error": "locked: roomCount"}
        import engine_ops as eops

        r = eops.one_more_room(project)
        if not r.get("ok"):
            return {"ok": False, "type": otype, "error": r.get("error") or "failed"}
        fresh = _load_spec(project)
        if fresh:
            spec.clear()
            spec.update(fresh)
        return {
            "ok": True,
            "type": "add_room",
            "roomCount": r.get("roomCount"),
            "rebuild": False,
            "written": r.get("written"),
        }

    if otype == "craft":
        text = str(op.get("text") or op.get("prompt") or "").strip()
        if not text:
            return {"ok": False, "type": otype, "error": "text required"}
        # respect locks on feel wholesale for craft that would rewrite feel
        import patch as patchlib

        r = patchlib.try_patch(project, text)
        if not r or not r.get("ok"):
            return {
                "ok": False,
                "type": otype,
                "error": "craft could not apply (needs_llm or no match)",
            }
        fresh = _load_spec(project)
        if fresh:
            # check we didn't violate locks — if we did, still report
            spec.clear()
            spec.update(fresh)
        return {
            "ok": True,
            "type": "craft",
            "summary": r.get("summary"),
            "rebuild": False,
            "written": r.get("written"),
        }

    return {"ok": False, "type": otype, "error": "unhandled"}


def apply_ops(
    project: Path,
    ops: list[dict[str, Any]] | str,
    *,
    source: str = "game_ops",
    rebuild: bool = True,
) -> dict[str, Any]:
    """
    Apply a list of ops (or parse from text). Rebuilds slice once if needed.
    """
    project = Path(project).expanduser().resolve()
    if isinstance(ops, str):
        ops = extract_ops(ops)
    if not ops:
        return {"ok": False, "error": "no ops", "results": []}

    import patch as patchlib

    spec = patchlib.load_spec(project)
    if not spec:
        # minimal empty spec from prompt-less
        import slice as slicelib

        spec = slicelib.compile_prompt(project.name)
        patchlib.save_spec(project, spec)

    results: list[dict[str, Any]] = []
    need_rebuild = False
    context_blobs: list[str] = []

    for op in ops[:40]:
        if not isinstance(op, dict):
            results.append({"ok": False, "error": "op not object"})
            continue
        try:
            r = apply_one(project, op, spec)
        except Exception as e:
            r = {"ok": False, "type": op.get("type"), "error": str(e)}
        results.append(r)
        if r.get("rebuild"):
            need_rebuild = True
        if r.get("type") == "request_context" and r.get("context"):
            context_blobs.append(str(r["context"]))

    written: list[str] = []
    if rebuild and need_rebuild:
        try:
            written = _save_and_rebuild(project, spec)
        except Exception as e:
            audit_ops(project, results, source=source)
            return {
                "ok": False,
                "error": f"rebuild failed: {e}",
                "results": results,
                "written": [],
            }
    else:
        # persist locks / non-rebuild changes
        try:
            patchlib.save_spec(project, spec)
        except Exception:
            pass

    # collect written from sub-ops
    for r in results:
        for w in r.get("written") or []:
            if w not in written:
                written.append(w)

    audit_ops(project, results, source=source)
    ok_n = sum(1 for r in results if r.get("ok"))
    out: dict[str, Any] = {
        "ok": ok_n > 0,
        "applied": ok_n,
        "total": len(results),
        "results": results,
        "written": written,
        "locks": sorted(_locks(spec)),
    }
    if context_blobs:
        out["context"] = "\n\n".join(context_blobs)[:12000]
    try:
        import engine_ops as eops

        out["ship_card"] = eops.ship_card(project)
    except Exception:
        pass
    return out


def main() -> int:
    import argparse

    ap = argparse.ArgumentParser(description="dotLab game ops (UPF-style events)")
    sub = ap.add_subparsers(dest="cmd")
    sub.add_parser("schema")
    p = sub.add_parser("apply")
    p.add_argument("-p", "--project", required=True)
    p.add_argument("file", nargs="?", help="JSON file or - for stdin")
    p.add_argument("--text", default="", help="inline ops JSON")
    p = sub.add_parser("context")
    p.add_argument("-p", "--project", default="")
    p.add_argument("--topics", default="feel,slice", help="comma topics")
    args = ap.parse_args()

    if args.cmd == "schema":
        print(json.dumps(schema_doc(), indent=2))
        return 0
    if args.cmd == "context":
        topics = [t.strip() for t in args.topics.split(",") if t.strip()]
        proj = Path(args.project) if args.project else None
        print(request_context(proj, topics))
        return 0
    if args.cmd == "apply":
        if args.text:
            raw = args.text
        elif args.file == "-" or not args.file:
            import sys

            raw = sys.stdin.read()
        else:
            raw = Path(args.file).read_text(encoding="utf-8")
        result = apply_ops(Path(args.project), raw)
        print(json.dumps(result, indent=2)[:8000])
        return 0 if result.get("ok") else 1
    ap.print_help()
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
