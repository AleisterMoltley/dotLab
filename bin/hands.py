#!/usr/bin/env python3
"""
Hands in the game — the prompt shrinks, play writes the floor.

  Your jump solves CONFIG. A ghost fails a patch that breaks it.
  Clicks in Play mark first death / flag / landmark.
  Keep/Tighter/Juice are feel keyframes. Share is a zip, not a repo.

  dotlab hands status|fit|mark|timeline|restore -p DIR
  dotlab share -p DIR
"""
from __future__ import annotations

import argparse
import json
import os
import re
import time
import zipfile
from pathlib import Path
from typing import Any

from gmcommon import CONFIG, meta_dir

CONSTRAINTS = (
    "four colors only, no dash",
    "one moving ledge, no double jump",
    "fog equals background, one landmark taller than the player",
    "side camera, no neon magenta",
    "two ledges only, flag visible from spawn",
    "touch-first: no pointer lock, verb on a 44px button",
)

SAMENESS_FILE = CONFIG / "sameness.jsonl"
MAX_SAMENESS = 24


def _feel_from_spec(project: Path) -> dict[str, float]:
    try:
        import patch as patchlib

        spec = patchlib.load_spec(project) or {}
        feel = dict(spec.get("feel") or {})
        return {str(k): float(v) for k, v in feel.items() if _is_num(v)}
    except Exception:
        return {}


def _is_num(v: Any) -> bool:
    try:
        float(v)
        return True
    except (TypeError, ValueError):
        return False


def _write_json(path: Path, data: Any) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(data, indent=2) + "\n", encoding="utf-8")


def _read_json(path: Path, default: Any) -> Any:
    if not path.is_file():
        return default
    try:
        return json.loads(path.read_text(encoding="utf-8"))
    except Exception:
        return default


def apply_feel(project: Path, feel: dict[str, float]) -> dict[str, Any]:
    """Write feel into slice.json + inject CONFIG keys. No template rewrite."""
    try:
        import patch as patchlib
        import host_floor as floor

        spec = patchlib.load_spec(project)
        if spec is None:
            spec = {"feel": {}}
        spec.setdefault("feel", {}).update(feel)
        patchlib.save_spec(project, spec)
        return floor.apply(project)
    except Exception as e:
        return {"ok": False, "error": str(e)}


def summarize_jumps(samples: list[dict]) -> dict[str, float] | None:
    """samples: {hang, apex} or {t,y,grounded} traces."""
    hangs: list[float] = []
    apexes: list[float] = []
    for s in samples or []:
        if not isinstance(s, dict):
            continue
        if s.get("hang") is not None and s.get("apex") is not None:
            try:
                hangs.append(float(s["hang"]))
                apexes.append(float(s["apex"]))
            except (TypeError, ValueError):
                continue
    if not hangs:
        # derive from y-trace
        air: list[tuple[float, float]] = []
        for s in samples or []:
            if not isinstance(s, dict):
                continue
            try:
                t = float(s.get("t") or 0)
                y = float(s.get("y") or 0)
            except (TypeError, ValueError):
                continue
            grounded = bool(s.get("grounded"))
            if not grounded:
                air.append((t, y))
            elif air:
                t0, y0 = air[0]
                hang = max(t - t0, 0.0)
                apex = max(y for _, y in air) - y0
                if hang >= 0.12 and apex > 0.15:
                    hangs.append(hang)
                    apexes.append(apex)
                air = []
    if not hangs:
        return None
    hangs.sort()
    apexes.sort()
    mid = len(hangs) // 2
    return {"hang": hangs[mid], "apex": apexes[mid], "n": float(len(hangs))}


def fit_jump(
    *,
    hang: float | None = None,
    apex: float | None = None,
    feel: dict | None = None,
) -> dict[str, float]:
    """Arcade ballistic invert. y = j t - 0.5 g t² → g=8H/T², j=4H/T."""
    base = dict(feel or {})
    g0 = float(base.get("gravity") or 24)
    j0 = float(base.get("jumpForce") or 8.2)
    h = None if hang is None else max(0.15, min(1.4, float(hang)))
    a = None if apex is None else max(0.25, min(6.0, float(apex)))
    if h and a:
        g = 8.0 * a / (h * h)
        j = 4.0 * a / h
    elif a:
        g = g0
        j = (2.0 * g * a) ** 0.5
    elif h:
        j = j0
        g = 2.0 * j / h
    else:
        return base
    base["gravity"] = round(max(14.0, min(40.0, g)), 2)
    base["jumpForce"] = round(max(5.0, min(14.0, j)), 2)
    return base


def apply_fit(project: Path, samples: list[dict] | None = None, **kwargs: float) -> dict[str, Any]:
    summary = summarize_jumps(samples or []) if samples else None
    hang = kwargs.get("hang") if kwargs.get("hang") is not None else (summary or {}).get("hang")
    apex = kwargs.get("apex") if kwargs.get("apex") is not None else (summary or {}).get("apex")
    if hang is None and apex is None:
        return {"ok": False, "error": "need hang and/or apex (or jump samples)"}
    feel = fit_jump(hang=hang, apex=apex, feel=_feel_from_spec(project))
    applied = apply_feel(project, feel)
    return {
        "ok": True,
        "hang": hang,
        "apex": apex,
        "feel": {"gravity": feel.get("gravity"), "jumpForce": feel.get("jumpForce")},
        "applied": applied.get("applied") or [],
    }


def ghost_path(project: Path) -> Path:
    return meta_dir(project) / "ghost.json"


def save_ghost(project: Path, metrics: dict | None = None) -> dict[str, Any]:
    feel = _feel_from_spec(project)
    metrics = metrics or {}
    summary = summarize_jumps(metrics.get("jumpSamples") or [])
    apex = (summary or {}).get("apex")
    hang = (summary or {}).get("hang")
    if apex is None:
        # synthesize from current feel so later patches can break it
        g = float(feel.get("gravity") or 24)
        j = float(feel.get("jumpForce") or 8.2)
        apex = (j * j) / (2.0 * max(g, 1.0))
        hang = 2.0 * j / max(g, 1.0)
    entry = {
        "t": time.time(),
        "feel": feel,
        "apex": apex,
        "hang": hang,
        "reach_x": float(metrics.get("reach_x") or metrics.get("maxX") or 0),
        "family": str(metrics.get("family") or ""),
    }
    _write_json(ghost_path(project), entry)
    return {"ok": True, "ghost": entry}


def check_ghost(project: Path, feel: dict | None = None) -> dict[str, Any]:
    data = _read_json(ghost_path(project), None)
    if not isinstance(data, dict) or not data.get("apex"):
        return {"ok": True, "skipped": True}
    feel = feel or _feel_from_spec(project)
    g = float(feel.get("gravity") or 24)
    j = float(feel.get("jumpForce") or 8.2)
    new_apex = (j * j) / (2.0 * max(g, 1.0))
    old_apex = float(data["apex"])
    if old_apex > 0.2 and new_apex < old_apex * 0.88:
        return {
            "ok": False,
            "reason": "ghost_broke",
            "old_apex": round(old_apex, 3),
            "new_apex": round(new_apex, 3),
        }
    old_x = float(data.get("reach_x") or 0)
    hang = 2.0 * j / max(g, 1.0)
    speed = float(feel.get("moveSpeed") or 6.2)
    if old_x > 3 and speed * hang < old_x * 0.75:
        return {"ok": False, "reason": "ghost_gap", "old_x": old_x, "reach": round(speed * hang, 2)}
    return {"ok": True, "skipped": False, "old_apex": old_apex, "new_apex": new_apex}


def spatial_path(project: Path) -> Path:
    return meta_dir(project) / "spatial.json"


def mark(project: Path, kind: str, pos: dict | None = None, note: str = "") -> dict[str, Any]:
    kind = (kind or "").strip().lower()
    aliases = {
        "death": "first_death",
        "first-death": "first_death",
        "first_death": "first_death",
        "flag": "flag",
        "goal": "flag",
        "landmark": "landmark",
        "place": "landmark",
    }
    key = aliases.get(kind)
    if not key:
        return {"ok": False, "error": "kind first_death|flag|landmark"}
    data = _read_json(spatial_path(project), {})
    if not isinstance(data, dict):
        data = {}
    entry = {"note": (note or "")[:120]}
    if isinstance(pos, dict):
        for k in ("x", "y", "z"):
            if _is_num(pos.get(k)):
                entry[k] = round(float(pos[k]), 3)
    data[key] = entry
    _write_json(spatial_path(project), data)
    return {"ok": True, "spatial": data}


def brief_block(project: Path | None, max_chars: int = 700) -> str:
    if not project:
        return ""
    data = _read_json(spatial_path(project), {})
    if not data:
        return ""
    lines = ["SPATIAL BRIEF (from Play clicks — honor these, do not invent a new layout):"]
    for key in ("first_death", "flag", "landmark"):
        row = data.get(key)
        if not isinstance(row, dict):
            continue
        xyz = ", ".join(f"{k}={row[k]}" for k in ("x", "y", "z") if k in row)
        note = row.get("note") or ""
        lines.append(f"- {key}: {xyz} {note}".strip())
    c = data.get("constraint") or ""
    if c:
        lines.append(f"- constraint: {c}")
    return "\n".join(lines)[:max_chars]


def callout_from(play: dict | None, report: dict | None = None) -> str:
    play = play or {}
    p0 = set(play.get("p0_fail") or [])
    p1 = set(play.get("p1_fail") or [])
    metrics = (play.get("metrics") or {}) if isinstance(play.get("metrics"), dict) else {}
    if "ghost_broke" in p0 or "ghost_gap" in p0:
        return "You broke my jump."
    if "runtime" in p0:
        return "I crashed. Fix the parse, then play."
    if "slop_frame" in p0:
        return "A cube on a plane. Make a place."
    if "slow_restart" in p0:
        return "Dead too long. Restart under three seconds."
    if "no_input" in p0 or "no_canvas" in p0:
        return "I couldn't play. Click the game."
    deaths = int(metrics.get("deaths") or 0)
    first = None
    if report and isinstance(report.get("metrics"), dict):
        first = report["metrics"].get("firstDeathAt")
    try:
        if first is not None and float(first) < 400 and deaths:
            return "Unfair. No telegraph."
    except (TypeError, ValueError):
        pass
    if "no_flag" in p1 or "no_jump" in p1:
        return "I didn't know where to go."
    if play.get("ok") and not play.get("skipped"):
        return "One more run?"
    return ""


def write_callout(project: Path, text: str) -> Path:
    path = meta_dir(project) / "callout.txt"
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text((text or "").strip() + "\n", encoding="utf-8")
    return path


def read_callout(project: Path) -> str:
    p = meta_dir(project) / "callout.txt"
    if not p.is_file():
        return ""
    try:
        return p.read_text(encoding="utf-8").strip()
    except OSError:
        return ""


def timeline_path(project: Path) -> Path:
    return meta_dir(project) / "feel-timeline.json"


def timeline_add(project: Path, action: str) -> dict[str, Any]:
    feel = _feel_from_spec(project)
    data = _read_json(timeline_path(project), {"frames": []})
    frames = list(data.get("frames") or [])
    frames.append({"t": time.time(), "action": (action or "keep")[:32], "feel": feel})
    data["frames"] = frames[-40:]
    _write_json(timeline_path(project), data)
    return {"ok": True, "n": len(data["frames"]), "action": action}


def timeline_list(project: Path) -> list[dict[str, Any]]:
    data = _read_json(timeline_path(project), {"frames": []})
    return list(data.get("frames") or [])


def timeline_restore(project: Path, index: int = -1) -> dict[str, Any]:
    frames = timeline_list(project)
    if not frames:
        return {"ok": False, "error": "no feel keyframes"}
    if index < 0:
        index = len(frames) + index
    if index < 0 or index >= len(frames):
        return {"ok": False, "error": "bad index"}
    feel = dict(frames[index].get("feel") or {})
    applied = apply_feel(project, feel)
    return {"ok": True, "index": index, "action": frames[index].get("action"), "applied": applied}


def fingerprint(spec: dict) -> str:
    pal = spec.get("palette_id") or spec.get("props") or ""
    palette = spec.get("palette")
    if isinstance(palette, dict):
        pal = palette.get("bg") or pal
    return "|".join(
        str(x or "")
        for x in (spec.get("genre"), spec.get("loop"), spec.get("camera"), pal)
    )


def apply_sameness(spec: dict) -> dict[str, Any]:
    """If the last slices look the same, stamp a constraint and rotate the joke."""
    fp = fingerprint(spec)
    recent: list[str] = []
    if SAMENESS_FILE.is_file():
        try:
            recent = [ln.strip() for ln in SAMENESS_FILE.read_text(encoding="utf-8").splitlines() if ln.strip()]
        except OSError:
            recent = []
    same = sum(1 for r in recent[-8:] if r == fp)
    if same >= 2:
        spec["constraint"] = CONSTRAINTS[abs(hash(fp)) % len(CONSTRAINTS)]
        # nudge setting so the next compile isn't a clone
        if not spec.get("sameness_nudge"):
            spec["sameness_nudge"] = True
    try:
        CONFIG.mkdir(parents=True, exist_ok=True)
        with SAMENESS_FILE.open("a", encoding="utf-8") as f:
            f.write(fp + "\n")
        lines = SAMENESS_FILE.read_text(encoding="utf-8").splitlines()
        if len(lines) > MAX_SAMENESS:
            SAMENESS_FILE.write_text("\n".join(lines[-MAX_SAMENESS:]) + "\n", encoding="utf-8")
    except OSError:
        pass
    return spec


def share(project: Path, dest: Path | None = None) -> dict[str, Any]:
    """Zip a playable project. Friend runs npm i && npm run dev. Not a git remote."""
    project = Path(project).expanduser().resolve()
    if not project.is_dir():
        return {"ok": False, "error": "not a folder"}
    try:
        import studio_ops as ops

        if ops.under_projects(project):
            z = ops.export_zip(project)
            if z.get("ok"):
                _write_share_note(project, z.get("path") or "")
                return {**z, "how": "unzip && npm i && npm run dev"}
    except Exception:
        pass
    out = dest or (meta_dir(project) / f"{project.name}-share.zip")
    out.parent.mkdir(parents=True, exist_ok=True)
    skip = {"node_modules", ".git", "dist", "build", ".vite"}
    with zipfile.ZipFile(out, "w", compression=zipfile.ZIP_DEFLATED) as zf:
        zf.writestr(
            "SHARE.md",
            "# Play this slice\n\nnpm install && npm run dev\n\nWASD · Space · click · R restart\n",
        )
        for dirpath, dirnames, filenames in os.walk(project):
            dirnames[:] = [d for d in dirnames if d not in skip and not d.startswith(".")]
            for name in filenames:
                fp = Path(dirpath) / name
                if name.endswith(".zip"):
                    continue
                try:
                    rel = fp.relative_to(project).as_posix()
                    zf.write(fp, rel)
                except OSError:
                    continue
    _write_share_note(project, str(out))
    return {
        "ok": True,
        "path": str(out),
        "bytes": out.stat().st_size,
        "how": "unzip && npm i && npm run dev",
    }


def _write_share_note(project: Path, zip_path: str) -> None:
    try:
        (project / "SHARE.md").write_text(
            "# Share\n\nThis is the jump, not a repo.\n\n"
            f"Zip: `{zip_path}`\n\n```\nunzip && npm install && npm run dev\n```\n",
            encoding="utf-8",
        )
    except OSError:
        pass


def status(project: Path) -> dict[str, Any]:
    ghost = _read_json(ghost_path(project), None)
    gc = check_ghost(project)
    return {
        "ok": True,
        "feel": _feel_from_spec(project),
        "spatial": _read_json(spatial_path(project), {}),
        "callout": read_callout(project),
        "ghost": ghost,
        "ghost_ok": gc.get("ok"),
        "ghost_check": gc,
        "timeline": timeline_list(project)[-8:],
        "brief": brief_block(project),
    }


def handle_http(method: str, path: str, body: dict | None, project: Path) -> tuple[int, dict]:
    body = body or {}
    if method == "GET":
        return 200, status(project)
    action = str(body.get("action") or "").lower()
    if action == "mark":
        return 200, mark(project, str(body.get("kind") or ""), body.get("pos"), str(body.get("note") or ""))
    if action == "fit":
        samples = body.get("samples") if isinstance(body.get("samples"), list) else None
        hang = body.get("hang")
        apex = body.get("apex")
        return 200, apply_fit(
            project,
            samples,
            hang=float(hang) if hang is not None else None,  # type: ignore[arg-type]
            apex=float(apex) if apex is not None else None,  # type: ignore[arg-type]
        )
    if action == "ghost-save":
        return 200, save_ghost(project, body.get("metrics") if isinstance(body.get("metrics"), dict) else {})
    if action == "restore":
        return 200, timeline_restore(project, int(body.get("index") or -1))
    return 400, {"ok": False, "error": "action mark|fit|ghost-save|restore"}


def after_play(project: Path, play: dict, report: dict | None = None) -> dict[str, Any]:
    """Called from play_gate: fit jump, save/check ghost, write callout."""
    out: dict[str, Any] = {}
    metrics = {}
    if report and isinstance(report.get("metrics"), dict):
        metrics = report["metrics"]
    metrics.update(play.get("metrics") or {})
    chk = check_ghost(project)
    out["ghost_before"] = chk
    samples = metrics.get("jumpSamples")
    if chk.get("ok") is False:
        text = "You broke my jump."
        play.setdefault("p0_fail", []).append(chk.get("reason") or "ghost_broke")
        play["ok"] = False
        extra = f"  [NO] P0 {chk.get('reason')} old_apex={chk.get('old_apex')} new_apex={chk.get('new_apex')}"
        play["report"] = (play.get("report") or "") + "\n" + extra
    else:
        if isinstance(samples, list) and samples:
            try:
                out["fit"] = apply_fit(project, samples)
            except Exception as e:
                out["fit_error"] = str(e)
        text = callout_from(play, report)
        if play.get("ok") and not play.get("skipped"):
            out["ghost"] = save_ghost(project, metrics)
    if text:
        write_callout(project, text)
    out["callout"] = text
    return out


def main() -> int:
    ap = argparse.ArgumentParser(description="Hands in the game")
    ap.add_argument("-p", "--project", default=".")
    sub = ap.add_subparsers(dest="cmd", required=True)
    sub.add_parser("status")
    p_fit = sub.add_parser("fit")
    p_fit.add_argument("--hang", type=float, default=None)
    p_fit.add_argument("--apex", type=float, default=None)
    p_m = sub.add_parser("mark")
    p_m.add_argument("--kind", required=True)
    p_m.add_argument("--x", type=float, default=None)
    p_m.add_argument("--y", type=float, default=None)
    p_m.add_argument("--z", type=float, default=None)
    p_m.add_argument("--note", default="")
    sub.add_parser("timeline")
    p_r = sub.add_parser("restore")
    p_r.add_argument("--i", type=int, default=-1)
    sub.add_parser("share")
    args = ap.parse_args()
    project = Path(args.project).expanduser().resolve()
    if args.cmd == "status":
        print(json.dumps(status(project), indent=2)[:8000])
        return 0
    if args.cmd == "fit":
        print(json.dumps(apply_fit(project, hang=args.hang, apex=args.apex), indent=2))
        return 0
    if args.cmd == "mark":
        pos = {}
        if args.x is not None:
            pos["x"] = args.x
        if args.y is not None:
            pos["y"] = args.y
        if args.z is not None:
            pos["z"] = args.z
        print(json.dumps(mark(project, args.kind, pos or None, args.note), indent=2))
        return 0
    if args.cmd == "timeline":
        frames = timeline_list(project)
        for i, f in enumerate(frames):
            feel = f.get("feel") or {}
            print(f"{i:2} {f.get('action')}  g={feel.get('gravity')} j={feel.get('jumpForce')}")
        return 0
    if args.cmd == "restore":
        print(json.dumps(timeline_restore(project, args.i), indent=2))
        return 0
    if args.cmd == "share":
        print(json.dumps(share(project), indent=2))
        return 0
    return 1


if __name__ == "__main__":
    raise SystemExit(main())
