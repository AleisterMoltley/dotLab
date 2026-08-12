#!/usr/bin/env python3
"""
Per-game wiki + codebase map. Auto-loaded into Studio, Agent, CLI, playtest.

  <game>/WIKI.md   decisions (1–4 lines + **Why:**) — commit this
  <game>/MAP.md    file TOC — regenerated when source is newer

  gamemaster wiki show -p DIR
  gamemaster wiki add -p DIR "Gravity 28" --why "user said floaty"
  gamemaster wiki map -p DIR          # force regenerate MAP.md
  gamemaster wiki prompt -p DIR       # block injected into models
"""
from __future__ import annotations

import argparse
import os
import re
import sys
from datetime import datetime, timezone
from pathlib import Path

from gmcommon import ROOT  # noqa: F401  (keeps import path consistent)

WIKI_NAME = "WIKI.md"
MAP_NAME = "MAP.md"
MAX_MAP_FILES = 50
MAX_WIKI_CHARS = 3500
MAX_MAP_CHARS = 3500
SKIP_DIRS = {
    "node_modules",
    ".git",
    "dist",
    "build",
    ".gamemaster",
    ".vite",
    ".next",
    "__pycache__",
}
CODE_EXTS = {
    ".js",
    ".ts",
    ".mjs",
    ".cjs",
    ".tsx",
    ".jsx",
    ".html",
    ".css",
    ".glsl",
    ".vert",
    ".frag",
    ".json",
    ".md",
}

WIKI_STUB = """# Wiki

Living facts for this game. One bullet + **Why:**. Honor unless the user contradicts.
Keep it short — this file is loaded into every Studio/Agent turn.

- Engine is Three.js (Vite, vanilla). **Why:** Gamemaster invariant.
"""


def wiki_path(project: Path) -> Path:
    return project.resolve() / WIKI_NAME


def map_path(project: Path) -> Path:
    return project.resolve() / MAP_NAME


def ensure_wiki(project: Path) -> Path:
    path = wiki_path(project)
    if not path.exists():
        path.write_text(WIKI_STUB, encoding="utf-8")
    return path


def read_capped(path: Path, limit: int) -> str:
    if not path.is_file():
        return ""
    try:
        text = path.read_text(encoding="utf-8", errors="ignore").strip()
    except OSError:
        return ""
    if len(text) > limit:
        return text[:limit].rstrip() + "\n…"
    return text


def _first_line_hint(path: Path) -> str:
    try:
        raw = path.read_text(encoding="utf-8", errors="ignore")
    except OSError:
        return ""
    for line in raw.splitlines()[:12]:
        s = line.strip()
        if s.startswith("/**") or s.startswith("/*") or s.startswith("*") or s.startswith("//"):
            s = re.sub(r"^(/\*+|\*+|//)\s*", "", s).strip(" */")
        if s.startswith("<!--"):
            s = s.replace("<!--", "").replace("-->", "").strip()
        if 8 <= len(s) <= 80 and not s.startswith("import ") and not s.startswith("{"):
            return s
    return ""


def _role_from_name(rel: str) -> str:
    name = Path(rel).name.lower()
    mapping = {
        "main.js": "boot",
        "main.ts": "boot",
        "game.js": "loop + CONFIG",
        "index.html": "shell / HUD",
        "package.json": "deps + scripts",
        "design.md": "living design",
        "wiki.md": "session wiki",
        "map.md": "file map",
        "readme.md": "how to run",
    }
    if name in mapping:
        return mapping[name]
    parent = Path(rel).parent.name.lower()
    if parent in ("player", "world", "physics", "narrative", "fx", "ui", "ai", "wallet"):
        return f"{parent} system"
    return ""


def iter_project_files(project: Path) -> list[Path]:
    out: list[Path] = []
    root = project.resolve()
    for dirpath, dirnames, filenames in os.walk(root):
        dirnames[:] = [d for d in sorted(dirnames) if d not in SKIP_DIRS and not d.startswith(".")]
        for name in sorted(filenames):
            if name.startswith("."):
                continue
            p = Path(dirpath) / name
            if p.suffix.lower() not in CODE_EXTS:
                continue
            if name in (WIKI_NAME, MAP_NAME) and p.parent == root:
                continue
            out.append(p)
            if len(out) >= MAX_MAP_FILES:
                return out
    return out


def map_stale(project: Path) -> bool:
    mp = map_path(project)
    if not mp.is_file():
        return True
    try:
        map_m = mp.stat().st_mtime
    except OSError:
        return True
    for p in iter_project_files(project):
        try:
            if p.stat().st_mtime > map_m + 0.01:
                return True
        except OSError:
            continue
    return False


def generate_map(project: Path) -> str:
    root = project.resolve()
    lines = [
        "# Map",
        "",
        f"Auto-generated {datetime.now(timezone.utc).strftime('%Y-%m-%d %H:%M UTC')}. "
        "Do not re-derive the tree — read this, then open only the files you need.",
        "",
    ]
    files = iter_project_files(project)
    if not files:
        lines.append("(empty project)")
        return "\n".join(lines) + "\n"
    for p in files:
        try:
            rel = str(p.relative_to(root)).replace("\\", "/")
        except ValueError:
            continue
        hint = _role_from_name(rel) or _first_line_hint(p)
        if hint:
            lines.append(f"- `{rel}` — {hint}")
        else:
            lines.append(f"- `{rel}`")
    return "\n".join(lines) + "\n"


def refresh_map(project: Path, force: bool = False) -> Path:
    path = map_path(project)
    if force or map_stale(project):
        path.write_text(generate_map(project), encoding="utf-8")
    return path


def prompt_block(project: Path | None, refresh: bool = True) -> str:
    """Block injected into every Studio / Agent / CLI turn. Cheap. No Ollama."""
    if project is None or not project.is_dir():
        return ""
    ensure_wiki(project)
    if refresh:
        try:
            refresh_map(project, force=False)
        except OSError:
            pass
    parts: list[str] = []
    wiki = read_capped(wiki_path(project), MAX_WIKI_CHARS)
    if wiki:
        parts.append(
            "# PROJECT WIKI (honor unless the user contradicts)\n"
            "Durable decisions for this game. Prefer these over generic knowledge.\n\n"
            + wiki
        )
    mp = read_capped(map_path(project), MAX_MAP_CHARS)
    if mp:
        parts.append("# PROJECT MAP (do not re-walk the tree)\n" + mp)
    return "\n\n".join(parts)


def append_fact(project: Path, fact: str, why: str = "") -> None:
    ensure_wiki(project)
    fact = " ".join((fact or "").split()).strip()
    if not fact:
        raise SystemExit("empty wiki fact")
    why = " ".join((why or "").split()).strip()
    line = f"- {fact}"
    if why:
        line += f" **Why:** {why}"
    path = wiki_path(project)
    text = path.read_text(encoding="utf-8")
    if fact.lower() in text.lower():
        return
    if not text.endswith("\n"):
        text += "\n"
    path.write_text(text + line + "\n", encoding="utf-8")


def main() -> int:
    ap = argparse.ArgumentParser(description="Gamemaster project wiki + map")
    shared = argparse.ArgumentParser(add_help=False)
    shared.add_argument("-p", "--project", default=".", help="Game directory")
    sub = ap.add_subparsers(dest="cmd", required=True)
    sub.add_parser("show", parents=[shared])
    sub.add_parser("map", parents=[shared])
    sub.add_parser("prompt", parents=[shared])
    p_add = sub.add_parser("add", parents=[shared])
    p_add.add_argument("fact", nargs="+")
    p_add.add_argument("--why", default="")
    args = ap.parse_args()

    project = Path(args.project).expanduser().resolve()
    if not project.is_dir():
        print(f"Project not found: {project}", file=sys.stderr)
        return 1

    if args.cmd == "show":
        ensure_wiki(project)
        print(wiki_path(project).read_text(encoding="utf-8"))
        return 0
    if args.cmd == "map":
        path = refresh_map(project, force=True)
        print(path.read_text(encoding="utf-8"))
        print(f"💾 {path}", file=sys.stderr)
        return 0
    if args.cmd == "prompt":
        print(prompt_block(project) or "(empty wiki/map)")
        return 0
    append_fact(project, " ".join(args.fact), args.why)
    print(f"✓ {wiki_path(project)}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
