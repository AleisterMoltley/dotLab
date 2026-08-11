#!/usr/bin/env python3
"""
Gamemaster Preference Memory — lernt deinen Geschmack (local, $0).

Speicher:
  Global:  ~/gamemaster/config/user-prefs.json
  Project: <project>/.gamemaster/prefs.json

Merge: global ← project (project wins on conflicts for scalars;
lists of likes/dislikes are unioned).

Usage:
  gamemaster prefs show [-p DIR]
  gamemaster prefs set like "tight jumps"
  gamemaster prefs set dislike "floaty movement"
  gamemaster prefs set feel.jump tight
  gamemaster prefs set tech.mobile_first true
  gamemaster prefs note "Prefer CONFIG at top of files"
  gamemaster prefs forget like "tight jumps"
  gamemaster prefs from-critic -p DIR   # parse last critic report
  gamemaster prefs prompt [-p DIR]     # print prompt block for agents
"""
from __future__ import annotations

import argparse
import json
import re
import sys
from datetime import datetime, timezone
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
GLOBAL_PREFS = ROOT / "config" / "user-prefs.json"


def empty_prefs() -> dict:
    return {
        "version": 1,
        "likes": [],
        "dislikes": [],
        "feel": {},
        "tech": {},
        "notes": [],
        "history": [],
        "updated_at": None,
    }


def load_json(path: Path) -> dict:
    if not path.exists():
        return empty_prefs()
    try:
        data = json.loads(path.read_text(encoding="utf-8"))
        base = empty_prefs()
        base.update({k: data.get(k, base[k]) for k in base})
        # ensure types
        for k in ("likes", "dislikes", "notes", "history"):
            if not isinstance(base[k], list):
                base[k] = []
        for k in ("feel", "tech"):
            if not isinstance(base[k], dict):
                base[k] = {}
        return base
    except Exception:
        return empty_prefs()


def save_json(path: Path, data: dict) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    data["updated_at"] = datetime.now(timezone.utc).isoformat()
    path.write_text(json.dumps(data, indent=2, ensure_ascii=False) + "\n", encoding="utf-8")


def project_prefs_path(project: Path | None) -> Path | None:
    if not project:
        return None
    return project.resolve() / ".gamemaster" / "prefs.json"


def merge_prefs(global_p: dict, project_p: dict | None) -> dict:
    out = empty_prefs()
    out["likes"] = list(dict.fromkeys([*(global_p.get("likes") or []), *(((project_p or {}).get("likes")) or [])]))
    out["dislikes"] = list(
        dict.fromkeys([*(global_p.get("dislikes") or []), *(((project_p or {}).get("dislikes")) or [])])
    )
    out["notes"] = list(
        dict.fromkeys([*(global_p.get("notes") or []), *(((project_p or {}).get("notes")) or [])])
    )
    out["feel"] = {**(global_p.get("feel") or {}), **((project_p or {}).get("feel") or {})}
    out["tech"] = {**(global_p.get("tech") or {}), **((project_p or {}).get("tech") or {})}
    # history: global then project, keep last 40
    hist = [*(global_p.get("history") or []), *(((project_p or {}).get("history")) or [])]
    out["history"] = hist[-40:]
    out["updated_at"] = (project_p or global_p).get("updated_at")
    return out


def load_merged(project: Path | None = None) -> dict:
    g = load_json(GLOBAL_PREFS)
    p = load_json(project_prefs_path(project)) if project else None
    return merge_prefs(g, p)


def add_unique(lst: list, item: str) -> list:
    item = item.strip()
    if not item:
        return lst
    if item not in lst:
        lst.append(item)
    return lst


def remove_item(lst: list, item: str) -> list:
    return [x for x in lst if x != item]


def set_nested(d: dict, dotted: str, value: str) -> None:
    """feel.jump / tech.mobile_first"""
    parts = dotted.split(".")
    cur = d
    for p in parts[:-1]:
        cur = cur.setdefault(p, {})
        if not isinstance(cur, dict):
            raise SystemExit(f"Cannot set: {dotted}")
    key = parts[-1]
    # coerce bools/numbers
    v: object = value
    if value.lower() in ("true", "yes", "1"):
        v = True
    elif value.lower() in ("false", "no", "0"):
        v = False
    else:
        try:
            if "." in value:
                v = float(value)
            else:
                v = int(value)
        except ValueError:
            v = value
    cur[key] = v


def append_history(data: dict, event: str, summary: str) -> None:
    data.setdefault("history", []).append(
        {
            "ts": datetime.now(timezone.utc).isoformat(),
            "event": event,
            "summary": summary[:500],
        }
    )
    data["history"] = data["history"][-40:]


def format_prompt_block(prefs: dict) -> str:
    """Block injected into Director/Architect/Coder/Critic prompts."""
    if not any(
        [
            prefs.get("likes"),
            prefs.get("dislikes"),
            prefs.get("feel"),
            prefs.get("tech"),
            prefs.get("notes"),
        ]
    ):
        return ""
    lines = [
        "# USER PREFERENCE MEMORY (honor these unless brief contradicts)",
        "These are learned likes from previous sessions. Bias design & code toward them.",
    ]
    if prefs.get("likes"):
        lines.append("LIKES: " + "; ".join(prefs["likes"]))
    if prefs.get("dislikes"):
        lines.append("DISLIKES / AVOID: " + "; ".join(prefs["dislikes"]))
    if prefs.get("feel"):
        lines.append("FEEL: " + json.dumps(prefs["feel"], ensure_ascii=False))
    if prefs.get("tech"):
        lines.append("TECH: " + json.dumps(prefs["tech"], ensure_ascii=False))
    if prefs.get("notes"):
        lines.append("NOTES:")
        for n in prefs["notes"][-8:]:
            lines.append(f"  - {n}")
    return "\n".join(lines)


def parse_critic_for_prefs(text: str) -> dict:
    """Heuristic extract likes/dislikes/feel from critic reports."""
    found = {"likes": [], "dislikes": [], "feel": {}, "notes": []}
    low = text.lower()
    # golden tweak / positive
    for m in re.finditer(
        r"(?:golden tweak|gut|keep|beibehalten|strong)[:\s]+(.+)", text, re.I
    ):
        found["likes"].append(m.group(1).strip()[:120])
    # kill / avoid
    for m in re.finditer(
        r"(?:kill list|streichen|avoid|vermeiden|too floaty|too sluggish|zu floaty)[:\s]+(.+)",
        text,
        re.I,
    ):
        found["dislikes"].append(m.group(1).strip()[:120])
    if "floaty" in low or "sluggish" in low or "träge" in low:
        found["dislikes"].append("floaty movement")
        found["feel"]["jump"] = "tight"
    if "coyote" in low:
        found["likes"].append("coyote time / jump buffer")
    if "juice" in low or "shake" in low or "hitstop" in low:
        found["likes"].append("juicy feedback (shake/hitstop)")
    if "mobile" in low or "touch" in low or "one-thumb" in low:
        found["feel"]["input"] = "mobile-first"
    # must-fix as notes
    for m in re.finditer(r"(?:must-fix|P0)[^\n]*\n(?:[-*]\s*.+\n?){1,5}", text, re.I):
        found["notes"].append("From critic: " + m.group(0).replace("\n", " ")[:200])
    return found


def apply_extracted(target: dict, extracted: dict) -> dict:
    for x in extracted.get("likes") or []:
        add_unique(target["likes"], x)
    for x in extracted.get("dislikes") or []:
        add_unique(target["dislikes"], x)
    target["feel"].update(extracted.get("feel") or {})
    for n in extracted.get("notes") or []:
        add_unique(target["notes"], n)
    return target


def resolve_target(project: Path | None, scope: str) -> Path:
    if scope == "project":
        if not project:
            raise SystemExit("--project required for scope=project")
        return project_prefs_path(project)  # type: ignore
    return GLOBAL_PREFS


def cmd_show(project: Path | None, scope: str) -> None:
    if scope == "merged":
        data = load_merged(project)
        print(json.dumps(data, indent=2, ensure_ascii=False))
        print("\n--- PROMPT BLOCK ---\n")
        print(format_prompt_block(data) or "(empty)")
        return
    path = resolve_target(project, scope)
    print(f"# {path}")
    print(json.dumps(load_json(path), indent=2, ensure_ascii=False))


def cmd_set(project: Path | None, scope: str, kind: str, values: list[str]) -> None:
    path = resolve_target(project, "project" if project and scope != "global" else scope)
    if scope == "merged":
        path = resolve_target(project, "project" if project else "global")
    data = load_json(path)
    if kind == "like":
        for v in values:
            add_unique(data["likes"], v)
            append_history(data, "like", v)
    elif kind == "dislike":
        for v in values:
            add_unique(data["dislikes"], v)
            append_history(data, "dislike", v)
    elif kind == "note":
        note = " ".join(values)
        add_unique(data["notes"], note)
        append_history(data, "note", note)
    elif kind.startswith("feel.") or kind.startswith("tech.") or kind in ("feel", "tech"):
        if len(values) < 1:
            raise SystemExit("Wert missing")
        key = kind if "." in kind else f"{kind}.{values[0]}"
        val = values[0] if "." in kind else values[1]
        if "." not in kind:
            key = f"{kind}.{values[0]}"
            val = " ".join(values[1:])
        set_nested(data, key if "." in kind else key, val if "." in kind else val)
        # fix: handle feel.jump tight
        if kind.startswith("feel.") or kind.startswith("tech."):
            set_nested(data, kind, " ".join(values))
        append_history(data, "set", f"{kind}={values}")
    else:
        # treat as dotted set: gamemaster prefs set feel.jump tight
        set_nested(data, kind, " ".join(values))
        append_history(data, "set", f"{kind}={' '.join(values)}")
    save_json(path, data)
    print(f"✓ saved → {path}")


def cmd_forget(project: Path | None, scope: str, kind: str, values: list[str]) -> None:
    path = resolve_target(project, "project" if project and scope != "global" else scope)
    data = load_json(path)
    if kind == "like":
        for v in values:
            data["likes"] = remove_item(data["likes"], v)
    elif kind == "dislike":
        for v in values:
            data["dislikes"] = remove_item(data["dislikes"], v)
    elif kind == "note":
        for v in values:
            data["notes"] = remove_item(data["notes"], v)
    save_json(path, data)
    print(f"✓ updated → {path}")


def cmd_from_critic(project: Path) -> None:
    studio = project / ".gamemaster" / "studio"
    candidates = [
        studio / "04-critic.md",
        studio / "review-critic.md",
        studio / "parallel-critic.md",
    ]
    text = ""
    for c in candidates:
        if c.exists():
            text = c.read_text(encoding="utf-8")
            break
    if not text:
        # latest *critic*
        if studio.exists():
            files = sorted(studio.glob("*critic*"), key=lambda p: p.stat().st_mtime, reverse=True)
            if files:
                text = files[0].read_text(encoding="utf-8")
    if not text:
        raise SystemExit("Kein Critic-Report in .gamemaster/studio/ gefunden")
    extracted = parse_critic_for_prefs(text)
    path = project_prefs_path(project)
    assert path
    data = load_json(path)
    apply_extracted(data, extracted)
    append_history(data, "from-critic", json.dumps(extracted, ensure_ascii=False)[:300])
    save_json(path, data)
    # also merge key feel into global lightly
    gpath = GLOBAL_PREFS
    g = load_json(gpath)
    for x in extracted.get("likes") or []:
        add_unique(g["likes"], x)
    for x in extracted.get("dislikes") or []:
        add_unique(g["dislikes"], x)
    g["feel"].update(extracted.get("feel") or {})
    append_history(g, "from-critic-global", "synced from project")
    save_json(gpath, g)
    print(f"✓ prefs from critic → {path}")
    print(json.dumps(extracted, indent=2, ensure_ascii=False))


def main() -> int:
    ap = argparse.ArgumentParser(description="Gamemaster preference memory")
    ap.add_argument("-p", "--project", default=None, help="Project dir for project-scoped prefs")
    ap.add_argument(
        "--scope",
        choices=["merged", "global", "project"],
        default="merged",
        help="Which store (default merged for show; writes default project if -p else global)",
    )
    sub = ap.add_subparsers(dest="cmd", required=True)

    sub.add_parser("show")
    sub.add_parser("prompt")

    p_set = sub.add_parser("set")
    p_set.add_argument("kind", help="like|dislike|note|feel.jump|tech.mobile_first|...")
    p_set.add_argument("values", nargs="+")

    p_for = sub.add_parser("forget")
    p_for.add_argument("kind", choices=["like", "dislike", "note"])
    p_for.add_argument("values", nargs="+")

    sub.add_parser("from-critic")

    args = ap.parse_args()
    project = Path(args.project).expanduser().resolve() if args.project else None

    if args.cmd == "show":
        cmd_show(project, args.scope)
    elif args.cmd == "prompt":
        print(format_prompt_block(load_merged(project)) or "(empty prefs)")
    elif args.cmd == "set":
        scope = args.scope if args.scope != "merged" else ("project" if project else "global")
        # special-case: prefs set like "x" 
        kind = args.kind
        vals = args.values
        if kind in ("like", "dislike", "note"):
            cmd_set(project, scope, kind, vals)
        else:
            # dotted key
            path = resolve_target(project, scope)
            data = load_json(path)
            set_nested(data, kind, " ".join(vals))
            append_history(data, "set", f"{kind}={' '.join(vals)}")
            save_json(path, data)
            print(f"✓ saved → {path}")
    elif args.cmd == "forget":
        scope = args.scope if args.scope != "merged" else ("project" if project else "global")
        cmd_forget(project, scope, args.kind, args.values)
    elif args.cmd == "from-critic":
        if not project:
            raise SystemExit("from-critic requires -p PROJECT")
        cmd_from_critic(project)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
