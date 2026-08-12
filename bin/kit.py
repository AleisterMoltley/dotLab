#!/usr/bin/env python3
"""
Grok-style game kit — the tools used to *build* a slice, not just chat.

CLI:
  gamemaster kit todo -p DIR
  gamemaster kit todo -p DIR --add "tune gravity"
  gamemaster kit todo -p DIR --done 1
  gamemaster kit art-test -p DIR
  gamemaster kit feel -p DIR

Agent: tool call kit / action: todo_add|todo_done|todo_list|wiki_add|map|art_test|feel
"""
from __future__ import annotations

import argparse
import json
import re
import sys
from datetime import datetime, timezone
from pathlib import Path

from gmcommon import ROOT  # noqa: F401

TODOS = ".gamemaster/todos.json"
FEEL_KEYS = (
    "moveSpeed",
    "accel",
    "friction",
    "gravity",
    "jumpForce",
    "coyoteMs",
    "jumpBufferMs",
    "camLag",
    "camDist",
)


def _todos_path(project: Path) -> Path:
    return project / TODOS


def load_todos(project: Path) -> list[dict]:
    p = _todos_path(project)
    if not p.is_file():
        return []
    try:
        data = json.loads(p.read_text(encoding="utf-8"))
        return list(data.get("items") or [])
    except Exception:
        return []


def save_todos(project: Path, items: list[dict]) -> None:
    p = _todos_path(project)
    p.parent.mkdir(parents=True, exist_ok=True)
    p.write_text(
        json.dumps({"items": items, "updated_at": datetime.now(timezone.utc).isoformat()}, indent=2)
        + "\n",
        encoding="utf-8",
    )


def todo_list(project: Path) -> str:
    items = load_todos(project)
    if not items:
        return "(no todos — add the verb, first death, and one juice pass)"
    lines = []
    for it in items:
        mark = "x" if it.get("done") else " "
        lines.append(f"- [{mark}] #{it.get('id')} {it.get('text')}")
    open_n = sum(1 for i in items if not i.get("done"))
    return f"{open_n} open\n" + "\n".join(lines)


def todo_add(project: Path, text: str) -> str:
    text = " ".join((text or "").split()).strip()
    if not text:
        return "ERROR: empty todo"
    items = load_todos(project)
    nid = (max((int(i.get("id") or 0) for i in items), default=0) + 1)
    items.append({"id": nid, "text": text, "done": False})
    save_todos(project, items)
    return f"OK added #{nid} {text}\n" + todo_list(project)


def todo_done(project: Path, ident: str) -> str:
    items = load_todos(project)
    try:
        nid = int(str(ident).lstrip("#"))
    except ValueError:
        return "ERROR: id must be a number"
    for it in items:
        if int(it.get("id") or 0) == nid:
            it["done"] = True
            save_todos(project, items)
            return f"OK done #{nid}\n" + todo_list(project)
    return f"ERROR: no todo #{nid}"


def write_art_test(project: Path) -> str:
    """Preview every image in-game context (nearest-neighbor, grid)."""
    roots = ["art", "assets", "public", "public/art"]
    images: list[str] = []
    for folder in roots:
        d = project / folder
        if not d.is_dir():
            continue
        for p in sorted(d.rglob("*")):
            if p.suffix.lower() in {".png", ".webp", ".jpg", ".jpeg", ".gif"}:
                if "node_modules" in p.parts:
                    continue
                images.append(str(p.relative_to(project)).replace("\\", "/"))
    out = project / "art-test.html"
    items = "\n".join(
        f'    <figure><img src="{src}" alt="{src}"><figcaption>{src}</figcaption></figure>'
        for src in images
    ) or "    <p class='empty'>No images in art/ assets/ public/ yet. Drop PNGs there, re-run kit art_test.</p>"
    out.write_text(
        f"""<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <title>Art test — {project.name}</title>
  <style>
    html, body {{ margin: 0; background: #2a2a32; color: #e8eaef; font: 13px/1.4 ui-sans-serif, system-ui; }}
    header {{ padding: 12px 16px; border-bottom: 1px solid #3a3a44; }}
    .grid {{ display: flex; flex-wrap: wrap; gap: 16px; padding: 16px; }}
    figure {{ margin: 0; background: repeating-conic-gradient(#3a3a44 0% 25%, #2a2a32 0% 50%) 0 0 / 16px 16px; padding: 8px; border-radius: 8px; }}
    img {{ image-rendering: pixelated; image-rendering: crisp-edges; display: block; max-width: 256px; height: auto; background: #ff00ff; }}
    figcaption {{ margin-top: 6px; color: #a1a1aa; font-size: 11px; }}
    .empty {{ color: #a1a1aa; }}
  </style>
</head>
<body>
  <header>Art test · {len(images)} file(s) · magenta = keyable hole · checker = transparency</header>
  <div class="grid">
{items}
  </div>
</body>
</html>
""",
        encoding="utf-8",
    )
    return f"OK wrote art-test.html ({len(images)} images). Open it next to the game."


def feel_audit(project: Path) -> str:
    """Find CONFIG / feel numbers and flag missing knobs."""
    found: dict[str, list[str]] = {k: [] for k in FEEL_KEYS}
    extras: list[str] = []
    rx = re.compile(r"\b(" + "|".join(FEEL_KEYS) + r")\b\s*[:=]\s*([0-9.]+)")
    for dirpath, dirnames, filenames in __import__("os").walk(project):
        dirnames[:] = [d for d in dirnames if d not in ("node_modules", ".git", "dist", "build", ".gamemaster")]
        for name in filenames:
            if not name.endswith((".js", ".ts", ".mjs")):
                continue
            p = Path(dirpath) / name
            try:
                text = p.read_text(encoding="utf-8", errors="ignore")
            except OSError:
                continue
            rel = str(p.relative_to(project))
            for m in rx.finditer(text):
                found[m.group(1)].append(f"{rel}:{m.group(2)}")
            if "CONFIG" in text and rel not in extras:
                extras.append(rel)
    missing = [k for k, v in found.items() if not v]
    lines = ["FEEL AUDIT"]
    for k, hits in found.items():
        if hits:
            lines.append(f"  {k}: " + ", ".join(hits[:4]))
    if missing:
        lines.append("MISSING (add to CONFIG): " + ", ".join(missing))
    else:
        lines.append("All core knobs present.")
    if extras:
        lines.append("CONFIG mentioned in: " + ", ".join(extras[:8]))
    lines.append("Moon jump? raise gravity first. Ice-skate? raise friction / add accel.")
    return "\n".join(lines)


def run_kit(project: Path, action: str, args: dict | None = None) -> str:
    args = args or {}
    a = (action or "").strip().lower().replace("-", "_")
    if a in ("todo", "todo_list", "todos"):
        return todo_list(project)
    if a in ("todo_add", "add_todo"):
        return todo_add(project, args.get("text") or args.get("add") or args.get("item") or "")
    if a in ("todo_done", "done_todo"):
        return todo_done(project, args.get("id") or args.get("done") or "")
    if a in ("wiki", "wiki_add"):
        try:
            import wiki as wikilib

            wikilib.append_fact(project, args.get("fact") or args.get("text") or "", args.get("why") or "")
            return f"OK wiki += {args.get('fact') or args.get('text')}"
        except Exception as e:
            return f"ERROR wiki: {e}"
    if a == "map":
        try:
            import wiki as wikilib

            path = wikilib.refresh_map(project, force=True)
            return f"OK map {path.name} ({path.stat().st_size}b)"
        except Exception as e:
            return f"ERROR map: {e}"
    if a in ("art", "art_test", "arttest"):
        return write_art_test(project)
    if a in ("feel", "feel_audit", "audit"):
        return feel_audit(project)
    if a in ("verify", "score"):
        try:
            import verify as verifylib

            return verifylib.evaluate(project)["report"]
        except Exception as e:
            return f"ERROR verify: {e}"
    return (
        "ERROR: unknown kit action. Use: todo_list, todo_add, todo_done, "
        "wiki_add, map, art_test, feel, verify"
    )


def main() -> int:
    ap = argparse.ArgumentParser(description="Gamemaster game kit (Grok tools)")
    shared = argparse.ArgumentParser(add_help=False)
    shared.add_argument("-p", "--project", default=".", help="Game directory")
    sub = ap.add_subparsers(dest="cmd", required=True)
    p_todo = sub.add_parser("todo", parents=[shared])
    p_todo.add_argument("--add", default="")
    p_todo.add_argument("--done", default="")
    sub.add_parser("art-test", parents=[shared])
    sub.add_parser("feel", parents=[shared])
    sub.add_parser("verify", parents=[shared])
    args = ap.parse_args()
    project = Path(args.project).expanduser().resolve()
    if not project.is_dir():
        print(f"Project not found: {project}", file=sys.stderr)
        return 1
    if args.cmd == "todo":
        if args.add:
            print(todo_add(project, args.add))
        elif args.done:
            print(todo_done(project, args.done))
        else:
            print(todo_list(project))
        return 0
    if args.cmd == "art-test":
        print(write_art_test(project))
        return 0
    if args.cmd == "verify":
        print(run_kit(project, "verify"))
        return 0
    print(feel_audit(project))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
