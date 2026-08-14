#!/usr/bin/env python3
"""
Host-owned local quality — numbers, few-shots, verify-anchored repair.

The 30B forgets feel and invents features. After a coder pass the host
applies genre CONFIG, injects missing keys, and constrains repair to
verify P0. No LLM.
"""
from __future__ import annotations

import json
import os
import re
from pathlib import Path
from typing import Any

from gmcommon import CONFIG, meta_dir

# Shared arcade defaults (meters, Y-up) — knowledge/feel-tables.md
SHARED_FEEL: dict[str, float] = {
    "moveSpeed": 6.2,
    "accel": 42,
    "friction": 26,
    "gravity": 24,
    "jumpForce": 8.2,
    "coyoteMs": 100,
    "jumpBufferMs": 90,
    "jumpCut": 0.45,
    "camLag": 8,
    "camDist": 6.4,
    "camHeight": 2.15,
    "hitstopMs": 40,
    "shakeHit": 0.12,
    "fov": 58,
    "hp": 3,
}

GENRE_FEEL: dict[str, dict[str, float]] = {
    "platformer": {
        "moveSpeed": 7.0,
        "gravity": 28,
        "jumpForce": 9.0,
        "coyoteMs": 110,
        "jumpBufferMs": 100,
        "camLag": 10,
        "camDist": 9,
    },
    "fps": {
        "moveSpeed": 6.5,
        "gravity": 26,
        "jumpForce": 7.8,
        "accel": 50,
        "friction": 30,
        "fov": 78,
        "eyeHeight": 1.62,
        "fireRpm": 480,
    },
    "arena": {"moveSpeed": 7.8, "gravity": 22, "fov": 62},
    "runner": {"moveSpeed": 10, "gravity": 26, "jumpForce": 8.5, "camLag": 12},
    "adventure": {"moveSpeed": 5.6, "gravity": 22, "jumpForce": 7.4, "camLag": 7},
    "horror": {"moveSpeed": 3.8, "gravity": 22, "jumpForce": 6.2, "fov": 52, "camLag": 5},
}

# 1/1/1 and other slop — replace from the table
_SLOP_LO = 0.05
_SLOP_HI = {"gravity": 8.0, "moveSpeed": 1.2, "jumpForce": 1.5, "accel": 4.0, "friction": 4.0}

FEATURE_NOISE = re.compile(
    r"(?i)\b(inventory|skill.?tree|map screen|settings menu|multiplayer|"
    r"save system|crafting|quest log|shop|prestige|achievements?)\b"
)

_FEWSHOTS = """# Patch few-shots (copy the shape). Do not rewrite createGame.

@@ file:src/game.js
@@ search
  gravity: 12,
@@ replace
  gravity: 28,
  coyoteMs: 110,
  jumpBufferMs: 100,
@@ end

@@ file:src/game.js
@@ search
    hits += 1;
@@ replace
    hits += 1;
    punch(stack, 'hit');
@@ end

@@ file:src/systems/flag.js
@@ search
export function tick() {}
@@ replace
export function tick(dt, ctx) {
  if (ctx.nearFlag) ctx.setFlag('open');
}
@@ end
"""

TEACHER_DIR = CONFIG / "teacher"
TEACHER_FILE = TEACHER_DIR / "traces.jsonl"
MAX_TEACHER = 80


def genre_of(project: Path) -> str:
    for meta_name in (".dotlab", ".gamemaster"):
        sp = project / meta_name / "slice.json"
        if not sp.is_file():
            continue
        try:
            data = json.loads(sp.read_text(encoding="utf-8"))
            g = str((data or {}).get("genre") or "").lower()
            loop = str((data or {}).get("loop") or "").lower()
            if loop == "jump":
                return "platformer"
            if loop == "shoot" and g != "arena":
                return g or "fps"
            if g:
                return g
        except Exception:
            pass
    js = _game_js(project)
    if re.search(r"coyoteMs|jumpBuffer", js) and re.search(r"platform|ledge", js, re.I):
        return "platformer"
    if re.search(r"fireRpm|pointerlock|adsFov", js, re.I):
        return "fps"
    return ""


def feel_table(genre: str) -> dict[str, float]:
    out = dict(SHARED_FEEL)
    out.update(GENRE_FEEL.get((genre or "").lower()) or {})
    return out


def _in_range(key: str, value: float) -> bool:
    try:
        v = float(value)
    except (TypeError, ValueError):
        return False
    if abs(v) <= _SLOP_LO:
        return False
    cap = _SLOP_HI.get(key)
    if cap is not None and v <= cap:
        return False
    return True


def merge_feel(genre: str, existing: dict | None) -> dict[str, float]:
    table = feel_table(genre)
    for k, v in (existing or {}).items():
        if _in_range(str(k), v):
            try:
                table[str(k)] = float(v)
            except (TypeError, ValueError):
                pass
    return table


def _game_js(project: Path) -> str:
    p = project / "src" / "game.js"
    if not p.is_file():
        return ""
    try:
        return p.read_text(encoding="utf-8")
    except OSError:
        return ""


def _inject_config_keys(js: str, keys: dict[str, float]) -> tuple[str, list[str]]:
    if "__CONFIG__" in js or "const CONFIG" not in js:
        return js, []
    m = re.search(r"const CONFIG\s*=\s*\{", js)
    if not m:
        return js, []
    window = js[m.start() : m.start() + 2800]
    applied: list[str] = []
    insert_at = m.end()
    chunk = ""
    for k, v in keys.items():
        if re.search(rf"\b{re.escape(k)}\s*:", window):
            continue
        if isinstance(v, float) and v == int(v):
            lit = str(int(v))
        else:
            lit = json.dumps(v)
        chunk += f"\n  {k}: {lit},"
        applied.append(f"{k}={lit}")
    if not chunk:
        return js, []
    return js[:insert_at] + chunk + js[insert_at:], applied


def _inject_pit_death(js: str) -> tuple[str, str | None]:
    if re.search(r"pos\.y\s*<\s*-", js):
        return js, None
    if not re.search(r"\bfunction\s+die\s*\(", js):
        return js, None
    if not re.search(r"player\.pos\.y", js):
        return js, None
    m = re.search(r"player\.pos\.y\s*\+=", js)
    if not m:
        return js, None
    nl = js.find("\n", m.end())
    if nl < 0:
        return js, None
    line = "\n    if (player.pos.y < -24) die();"
    return js[:nl] + line + js[nl:], "pit-death"


def apply(project: Path) -> dict[str, Any]:
    """Merge genre feel into slice.json + inject missing CONFIG keys. No full rewrite."""
    project = Path(project)
    applied: list[str] = []
    genre = genre_of(project)
    existing: dict = {}
    spec = None
    try:
        import patch as patchlib

        spec = patchlib.load_spec(project)
        if isinstance(spec, dict):
            existing = dict(spec.get("feel") or {})
    except Exception:
        spec = None
    merged = merge_feel(genre, existing)
    if spec is not None:
        try:
            import patch as patchlib

            patchlib._ensure_counts(spec)
            feel = spec.setdefault("feel", {})
            for k, v in merged.items():
                cur = feel.get(k)
                if cur is None or not _in_range(k, cur):
                    feel[k] = int(v) if k.endswith("Ms") or k == "hp" else v
                    applied.append(f"spec.{k}")
            patchlib.save_spec(project, spec)
        except Exception:
            pass

    js = _game_js(project)
    if js:
        js2, keys = _inject_config_keys(js, merged)
        note = None
        js2, note = _inject_pit_death(js2)
        if keys or note:
            try:
                (project / "src" / "game.js").write_text(js2, encoding="utf-8")
                applied.extend(keys)
                if note:
                    applied.append(note)
            except OSError:
                pass
    applied.extend(restore_kits(project))
    applied.extend(restitch_if_kits_broken(project))
    return {"ok": True, "genre": genre or "generic", "applied": applied}


KIT_P0 = ("look_kit", "craft_kit", "body_kit", "engine_law")


def restore_kits(project: Path) -> list[str]:
    """Re-vendor immutable kits. The 30B must not drift punch/look/body."""
    try:
        from gmcommon import ROOT
    except Exception:
        return []
    import shutil

    applied: list[str] = []
    for name in ("craft", "look", "body"):
        src = ROOT / "lib" / name
        dest = Path(project) / "src" / name
        if not src.is_dir() or not dest.is_dir():
            continue
        try:
            shutil.rmtree(dest)
            shutil.copytree(src, dest)
            applied.append(f"vendor:{name}")
        except OSError:
            continue
    return applied


def restitch_game(project: Path) -> list[str]:
    """Rewrite src/game.js from the host template + current spec. Systems stay."""
    try:
        import slice as slicelib
        import patch as patchlib
    except Exception:
        return []
    try:
        spec = patchlib.load_spec(project)
    except Exception:
        return []
    if not isinstance(spec, dict):
        return []
    eng = str(spec.get("engine") or "three")
    if eng not in ("", "three"):
        return []
    try:
        js = slicelib.render_game_js(spec)
        (Path(project) / "src" / "game.js").write_text(js, encoding="utf-8")
        return ["restitch:game.js"]
    except Exception:
        return []


def restitch_if_kits_broken(project: Path) -> list[str]:
    """If the model deleted applyLook / punch / makePlayer, put the slice back."""
    project = Path(project)
    if not (project / "src" / "look").is_dir() and not (project / "src" / "craft" / "punch.js").is_file():
        return []
    try:
        import verify

        vr = verify.evaluate(project)
    except Exception:
        return []
    failed = set(vr.get("p0_fail") or [])
    if not any(k in failed for k in KIT_P0):
        return []
    out = restore_kits(project)
    out.extend(restitch_game(project))
    return out


def fewshot_block(task: str = "") -> str:
    p = (task or "").lower()
    if re.search(r"shader|dialogue|wallet|seeker", p) and not re.search(
        r"jump|feel|coyote|juice|hit|platform", p
    ):
        return ""
    return _FEWSHOTS


def filter_must_fix(lines: list[str], verify_result: dict | None = None) -> list[str]:
    """Drop feature-vending. When verify failed, P0 checks are the only must-fix."""
    vr = verify_result or {}
    p0 = [str(x) for x in (vr.get("p0_fail") or [])]
    failed = {str(x) for x in (vr.get("failed") or [])}
    if p0:
        out = [f"VERIFY P0: {x}" for x in p0]
        for line in lines:
            text = (line or "").strip()
            if len(text) < 8 or FEATURE_NOISE.search(text):
                continue
            if any(c.lower() in text.lower() for c in failed):
                out.append(text[:200])
            if len(out) >= 6:
                break
        return out
    kept = []
    for line in lines:
        text = (line or "").strip()
        if len(text) < 12 or FEATURE_NOISE.search(text):
            continue
        kept.append(text[:200])
        if len(kept) >= 3:
            break
    return kept


def repair_task(verify_result: dict) -> str:
    report = str(verify_result.get("report") or "")
    p0 = ", ".join(str(x) for x in (verify_result.get("p0_fail") or []))
    return (
        "VERIFY GATE failed. Fix ONLY these P0/P1 checks. Do not add features.\n"
        f"P0: {p0 or '(see report)'}\n\n"
        f"{report}\n\n"
        "Feel numbers are host-owned. Patch-only. Then done."
    )


def slim_console(text: str, n: int = 20) -> str:
    """Keep the last n non-empty console/error lines for a local repair prompt."""
    lines = [ln.rstrip() for ln in (text or "").splitlines() if ln.strip()]
    if not lines:
        return ""
    # Prefer error/exception lines, then tail
    hot = [ln for ln in lines if re.search(r"error|exception|typeerror|syntax|failed", ln, re.I)]
    pick = (hot[-n:] if hot else []) + lines[-n:]
    # unique, preserve order, cap n
    seen: set[str] = set()
    out: list[str] = []
    for ln in pick:
        if ln in seen:
            continue
        seen.add(ln)
        out.append(ln[:240])
        if len(out) >= n:
            break
    return "\n".join(out)


def record_teacher(project: Path, verify_result: dict) -> Path | None:
    """Store a CONFIG snippet from a P0-pass slice for later few-shot use."""
    if not verify_result.get("ok"):
        return None
    js = _game_js(project)
    if not js:
        return None
    m = re.search(r"const CONFIG\s*=\s*\{.{0,1800}?\}", js, re.S)
    snippet = m.group(0) if m else js[:600]
    entry = {
        "project": Path(project).name,
        "genre": genre_of(project),
        "score": int(verify_result.get("score") or 0),
        "snippet": snippet[:1800],
    }
    try:
        TEACHER_DIR.mkdir(parents=True, exist_ok=True)
        with TEACHER_FILE.open("a", encoding="utf-8") as f:
            f.write(json.dumps(entry, ensure_ascii=False) + "\n")
        _trim_teacher()
        dest = meta_dir(project) / "teacher-last.json"
        dest.write_text(json.dumps(entry, indent=2) + "\n", encoding="utf-8")
        return dest
    except OSError:
        return None


def _trim_teacher() -> None:
    try:
        lines = TEACHER_FILE.read_text(encoding="utf-8").splitlines()
        if len(lines) > MAX_TEACHER:
            TEACHER_FILE.write_text("\n".join(lines[-MAX_TEACHER:]) + "\n", encoding="utf-8")
    except OSError:
        pass


def jail_on() -> bool:
    # Default ON. Local 30B rewriting game.js is the slop path.
    v = os.environ.get("DOTLAB_NOVELTY_JAIL", "1").strip().lower()
    return v not in ("0", "false", "off", "no")


JAIL_WRITE_PREFIXES = ("src/systems/",)
_SMALL_PATCH = 800


def jail_write_ok(rel: str, *, kind: str = "write", search: str = "", replace: str = "") -> tuple[bool, str]:
    """When the novelty jail is on, the model only writes systems + small wires."""
    if not jail_on():
        return True, ""
    rel = (rel or "").strip().lstrip("./")
    if rel.startswith(JAIL_WRITE_PREFIXES):
        return True, ""
    if kind in ("game_ops", "kit", "run"):
        return True, ""
    if kind == "patch" and rel in ("src/game.js", "src/main.js"):
        blob = (replace or "") + "\n" + (search or "")
        if "systems/" in blob or "src/systems" in blob:
            return True, ""
        if len(search or "") <= _SMALL_PATCH and len(replace or "") <= _SMALL_PATCH:
            return True, ""
        return (
            False,
            "novelty jail: large game.js patches blocked — write src/systems/<name>.js "
            "or a small wire-up import",
        )
    if kind == "write":
        return (
            False,
            "novelty jail: write_file only under src/systems/ — apply_patch a small wire or game_ops",
        )
    return True, ""


def wire_systems(project: Path) -> list[str]:
    """Import src/systems/*.js from game.js and call tick if the loop exists."""
    project = Path(project)
    sysdir = project / "src" / "systems"
    game = project / "src" / "game.js"
    if not sysdir.is_dir() or not game.is_file():
        return []
    try:
        js = game.read_text(encoding="utf-8")
    except OSError:
        return []
    mods = sorted(p.stem for p in sysdir.glob("*.js") if p.stem != "index")
    applied: list[str] = []
    orig = js
    for name in mods[:8]:
        if f"systems/{name}" in js:
            continue
        ident = re.sub(r"[^A-Za-z0-9_]", "_", name)
        line = f"import * as sys_{ident} from './systems/{name}.js';\n"
        im = list(re.finditer(r"^import .+$", js, re.M))
        if im:
            at = im[-1].end()
            js = js[:at] + "\n" + line + js[at:]
        else:
            js = line + js
        applied.append(f"import:{name}")
    if applied and "host-systems-tick" not in js:
        m = re.search(r"function\s+(tick|loop|update)\s*\(([^)]*)\)\s*\{", js)
        if m:
            args = m.group(2) or "dt"
            first = (args.split(",")[0] or "dt").strip() or "dt"
            calls = " ".join(
                f"try {{ sys_{re.sub(r'[^A-Za-z0-9_]', '_', n)}.tick?.({first}, state); }} catch {{}}"
                for n in mods[:8]
            )
            insert = f"\n    // host-systems-tick\n    {calls}\n"
            js = js[: m.end()] + insert + js[m.end() :]
            applied.append("tick-wire")
    if js != orig:
        try:
            game.write_text(js, encoding="utf-8")
        except OSError:
            return []
    return applied


def score_pitch(text: str) -> dict[str, Any]:
    """Host vote for council — play-shaped briefs beat laundry lists."""
    t = text or ""
    s = 0
    why: list[str] = []
    if re.search(r"\bverb\b|t\s*=\s*8|t=8s", t, re.I):
        s += 3
        why.append("verb/t8")
    if re.search(r"gravity|coyote|feel|jumpForce|hitstop", t, re.I):
        s += 2
        why.append("feel")
    if re.search(r"non[- ]goal|kill list|we cut", t, re.I):
        s += 2
        why.append("cut")
    if re.search(r"first death|restart|fair", t, re.I):
        s += 1
        why.append("fair")
    if re.search(r"one novelty|single novelty|the fun is", t, re.I):
        s += 2
        why.append("novelty")
    ands = len(re.findall(r"\band\b", t, re.I))
    if ands > 14:
        s -= 2
        why.append("laundry")
    if len(t) < 80:
        s -= 1
    return {"score": s, "why": why}


def pick_pitch(pitches: list[str]) -> dict[str, Any]:
    scored = [(score_pitch(p), i, p) for i, p in enumerate(pitches)]
    scored.sort(key=lambda x: x[0]["score"], reverse=True)
    best = scored[0]
    tied = [x for x in scored if x[0]["score"] == best[0]["score"]]
    return {
        "winner": best[1],
        "score": best[0]["score"],
        "why": best[0]["why"],
        "tie": len(tied) > 1,
        "ranks": [{"i": i, "score": sc["score"], "why": sc["why"]} for sc, i, _ in scored],
    }


def teacher_block(query: str = "", k: int = 2, max_chars: int = 1600) -> str:
    if not TEACHER_FILE.is_file():
        return ""
    try:
        rows = [
            json.loads(ln)
            for ln in TEACHER_FILE.read_text(encoding="utf-8").splitlines()
            if ln.strip()
        ]
    except Exception:
        return ""
    if not rows:
        return ""
    q = (query or "").lower()
    scored: list[tuple[int, dict]] = []
    for row in rows:
        blob = (str(row.get("genre") or "") + " " + str(row.get("snippet") or "")).lower()
        s = sum(1 for tok in q.split() if len(tok) > 3 and tok in blob)
        s += int(row.get("score") or 0) // 40
        scored.append((s, row))
    scored.sort(key=lambda x: x[0], reverse=True)
    parts = ["# Teacher traces (P0-pass CONFIG — adapt numbers to this genre)"]
    used = 0
    for _, row in scored[:k]:
        block = f"\n## {row.get('project')} · {row.get('genre')}\n```js\n{row.get('snippet')}\n```\n"
        if used + len(block) > max_chars:
            break
        parts.append(block)
        used += len(block)
    body = "\n".join(parts) if len(parts) > 1 else ""
    try:
        import grok as groklib

        extra = groklib.kernel_block(query, k=1, max_chars=max(400, max_chars // 3))
        if extra:
            body = (body + "\n\n" + extra) if body else extra
    except Exception:
        pass
    return body
