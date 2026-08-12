#!/usr/bin/env python3
"""
Shared constants + tiny helpers for every `bin/*.py`.

Import from the same folder (sys.path[0] is bin/ when a script runs):

    from gmcommon import ROOT, OLLAMA, DEFAULT_MODEL, run, ensure_ollama

Do not put CLI `main()` here. Do not import studio/agent/github from here
(circular). Keep this file stdlib-only and cheap to import.
"""
from __future__ import annotations

import json
import os
import re
import shutil
import subprocess
import sys
import time
import urllib.request
from pathlib import Path
from typing import Any

ROOT = Path(__file__).resolve().parent.parent
BIN = ROOT / "bin"
KNOWLEDGE = ROOT / "knowledge"
TEMPLATES = ROOT / "templates"
CONFIG = ROOT / "config"
CHAT_DIR = ROOT / "chat"
LIVE_DIR = ROOT / "live"

OLLAMA = os.environ.get("OLLAMA_HOST", "http://127.0.0.1:11434").rstrip("/")
DEFAULT_MODEL = os.environ.get("GAMEMASTER_MODEL", "gamemaster")
DENSE_MODEL = os.environ.get("GAMEMASTER_DENSE", "gamemaster-dense")

GAME_GITIGNORE = """# Gamemaster game
node_modules/
dist/
build/
.vite/
.DS_Store
.gamemaster/
.env
.env.*
*.pem
*.key
__pycache__/
*.pyc
.idea/
.vscode/
"""

GAME_MARKERS = (
    "package.json",
    "DESIGN.md",
    "index.html",
    "src",
    "App.tsx",
    "vite.config.js",
    "vite.config.ts",
)


def which(name: str) -> str | None:
    return shutil.which(name)


def run(
    cmd: list[str],
    cwd: Path | None = None,
    timeout: float = 120.0,
    input_text: str | None = None,
    env: dict[str, str] | None = None,
) -> tuple[int, str]:
    """Return (exit_code, stdout+stderr stripped). Never raises for the child."""
    try:
        p = subprocess.run(
            cmd,
            cwd=str(cwd) if cwd else None,
            capture_output=True,
            text=True,
            timeout=timeout,
            input=input_text,
            env=env,
        )
        out = (p.stdout or "") + (("\n" + p.stderr) if p.stderr else "")
        return p.returncode, out.strip()
    except subprocess.TimeoutExpired:
        return 124, "timeout"
    except FileNotFoundError:
        return 127, f"not found: {cmd[0]}"
    except Exception as e:
        return 1, str(e)


def slugify_project(name: str) -> str:
    """Folder / npm name: kebab, no dots."""
    s = re.sub(r"[^a-zA-Z0-9]+", "-", (name or "").strip().lower()).strip("-")
    return s or "gamemaster-project"


def slugify_repo(name: str) -> str:
    """GitHub repo name: allows . _ -"""
    s = re.sub(r"[^a-zA-Z0-9._-]+", "-", (name or "").strip().lower()).strip("-.")
    return s or "game"


def looks_like_game(project: Path) -> bool:
    return any((project / m).exists() for m in GAME_MARKERS)


def ensure_game_gitignore(project: Path) -> None:
    gi = project / ".gitignore"
    if not gi.exists():
        gi.write_text(GAME_GITIGNORE, encoding="utf-8")
        return
    text = gi.read_text(encoding="utf-8", errors="ignore")
    extra = [line for line in ("node_modules/", ".gamemaster/", ".env", "dist/") if line not in text]
    if extra:
        gi.write_text(text.rstrip() + "\n" + "\n".join(extra) + "\n", encoding="utf-8")


def ollama_up() -> bool:
    try:
        with urllib.request.urlopen(f"{OLLAMA}/api/tags", timeout=1.5) as r:
            return r.status == 200
    except Exception:
        return False


def ensure_ollama(timeout: float = 25.0, fatal: bool = True) -> bool:
    if ollama_up():
        return True
    if sys.platform == "darwin":
        os.system("open -a Ollama >/dev/null 2>&1")
    deadline = time.time() + timeout
    while time.time() < deadline:
        if ollama_up():
            return True
        time.sleep(0.35)
    if fatal:
        raise SystemExit("Ollama not reachable. Open Ollama.app — https://ollama.com")
    return False


def ollama_json(path: str, payload: dict[str, Any] | None = None, timeout: float = 120.0) -> dict[str, Any]:
    data = None if payload is None else json.dumps(payload).encode()
    req = urllib.request.Request(
        f"{OLLAMA}{path}",
        data=data,
        headers={"Content-Type": "application/json"} if data else {},
        method="POST" if data is not None else "GET",
    )
    with urllib.request.urlopen(req, timeout=timeout) as r:
        return json.loads(r.read().decode())
