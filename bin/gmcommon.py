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

# Product brand (user-facing). Legacy env names GAMEMASTER_* still work.
PRODUCT = "dotLab"
PRODUCT_SLUG = "dotlab"

OLLAMA = os.environ.get("OLLAMA_HOST", "http://127.0.0.1:11434").rstrip("/")
DEFAULT_MODEL = (
    os.environ.get("DOTLAB_MODEL")
    or os.environ.get("GAMEMASTER_MODEL")
    or "dotlab"
)
DENSE_MODEL = (
    os.environ.get("DOTLAB_DENSE")
    or os.environ.get("GAMEMASTER_DENSE")
    or "dotlab-dense"
)
FLASH_MODEL = (
    os.environ.get("DOTLAB_FLASH")
    or os.environ.get("GAMEMASTER_FLASH")
    or "dotlab-flash"
)

# After rebrand: prefer new tags, accept legacy weights already on disk
MODEL_FALLBACKS = (
    "dotlab",
    "gamemaster",
    "qwen3-coder:30b",
    "qwen2.5-coder:32b",
    "qwen2.5-coder:14b",
    "qwen2.5-coder:7b",
)
DENSE_FALLBACKS = ("dotlab-dense", "gamemaster-dense", "qwen2.5-coder:32b", "gamemaster", "dotlab")
FLASH_FALLBACKS = ("dotlab-flash", "gamemaster-flash", "qwen2.5-coder:7b", "qwen2.5-coder:14b")

GAME_GITIGNORE = """# dotLab game
node_modules/
dist/
build/
.vite/
.DS_Store
.dotlab/
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


def free_tcp_port(start: int = 5173, span: int = 40) -> int:
    """First free 127.0.0.1 port at or after `start`."""
    import socket

    for port in range(int(start), int(start) + int(span)):
        with socket.socket(socket.AF_INET, socket.SOCK_STREAM) as sock:
            sock.setsockopt(socket.SOL_SOCKET, socket.SO_REUSEADDR, 1)
            try:
                sock.bind(("127.0.0.1", port))
            except OSError:
                continue
            return port
    raise RuntimeError(f"no free port in {start}–{start + span}")


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
    return s or "dotlab-project"


def meta_dir(project: Path) -> Path:
    """Per-game meta folder (.dotlab preferred; legacy .gamemaster accepted)."""
    project = Path(project)
    for name in (".dotlab", ".gamemaster"):
        p = project / name
        if p.is_dir():
            return p
    return project / ".dotlab"


def slugify_repo(name: str) -> str:
    """GitHub repo name: allows . _ -"""
    s = re.sub(r"[^a-zA-Z0-9._-]+", "-", (name or "").strip().lower()).strip("-.")
    return s or "game"


def looks_like_game(project: Path) -> bool:
    return any((project / m).exists() for m in GAME_MARKERS)


def projects_root() -> Path:
    """Default place new games are written. Created on first use."""
    raw = os.environ.get("DOTLAB_PROJECTS") or os.environ.get("GAMEMASTER_PROJECTS")
    if raw:
        root = Path(raw).expanduser()
    else:
        root = Path.home() / "dotLab" / "Projects"
        # Migrate path preference: keep writing to legacy if already in use
        legacy_gm = Path.home() / "Gamemaster" / "Projects"
        if not root.is_dir() and legacy_gm.is_dir() and any(legacy_gm.iterdir()):
            root = legacy_gm
    root.mkdir(parents=True, exist_ok=True)
    return root


def project_search_roots() -> list[Path]:
    roots = [projects_root()]
    if os.environ.get("DOTLAB_PROJECTS") or os.environ.get("GAMEMASTER_PROJECTS"):
        return roots
    for legacy in (
        Path.home() / "Gamemaster" / "Projects",
        Path.home() / "GrokGameStudio" / "Projects",
    ):
        if legacy.is_dir() and legacy.resolve() not in {r.resolve() for r in roots}:
            roots.append(legacy)
    return roots


def list_game_projects() -> list[dict[str, Any]]:
    seen: set[Path] = set()
    found: list[dict[str, Any]] = []
    for root in project_search_roots():
        try:
            children = list(root.iterdir())
        except OSError:
            continue
        for child in children:
            try:
                if not child.is_dir() or child.name.startswith("."):
                    continue
                key = child.resolve()
                if key in seen or not looks_like_game(child):
                    continue
                seen.add(key)
                st = child.stat()
                found.append(
                    {
                        "name": child.name,
                        "path": str(key),
                        "mtime": int(st.st_mtime),
                    }
                )
            except OSError:
                continue
    found.sort(key=lambda r: r["mtime"], reverse=True)
    return found


def ensure_game_gitignore(project: Path) -> None:
    gi = project / ".gitignore"
    if not gi.exists():
        gi.write_text(GAME_GITIGNORE, encoding="utf-8")
        return
    text = gi.read_text(encoding="utf-8", errors="ignore")
    extra = [line for line in ("node_modules/", ".dotlab/", ".gamemaster/", ".env", "dist/") if line not in text]
    if extra:
        gi.write_text(text.rstrip() + "\n" + "\n".join(extra) + "\n", encoding="utf-8")


def ollama_up() -> bool:
    try:
        with urllib.request.urlopen(f"{OLLAMA}/api/tags", timeout=1.5) as r:
            return r.status == 200
    except Exception:
        return False


def model_name_matches(names: list[str] | set[str], model: str) -> bool:
    """True if tags list includes model or model:tag."""
    model = (model or "").strip()
    if not model:
        return False
    for n in names:
        if n == model or n.startswith(model + ":"):
            return True
    return False


def resolve_model_name(
    names: list[str] | set[str] | None = None,
    preferred: str | None = None,
    fallbacks: tuple[str, ...] | None = None,
) -> str | None:
    """Pick first installed model from preferred + fallbacks (return bare tag base)."""
    if names is None:
        try:
            data = ollama_json("/api/tags", timeout=3.0)
            names = [m.get("name") or "" for m in data.get("models") or []]
        except Exception:
            names = []
    chain: list[str] = []
    for m in (preferred, *(fallbacks or MODEL_FALLBACKS)):
        if m and m not in chain:
            chain.append(m)
    for m in chain:
        if model_name_matches(names, m):
            return m.split(":")[0]
    return None


def ensure_model_alias(target: str, source: str) -> bool:
    """Create a free Ollama tag `target` pointing at existing `source` weights."""
    if not target or not source or target == source:
        return False
    tmp = CONFIG / f".Modelfile.alias.{target.replace(':', '_')}"
    try:
        CONFIG.mkdir(parents=True, exist_ok=True)
        tmp.write_text(f"FROM {source}\n", encoding="utf-8")
        code, _ = run(["ollama", "create", target, "-f", str(tmp)], timeout=300)
        return code == 0
    except Exception:
        return False
    finally:
        try:
            tmp.unlink(missing_ok=True)  # type: ignore[call-arg]
        except TypeError:
            try:
                if tmp.exists():
                    tmp.unlink()
            except OSError:
                pass
        except OSError:
            pass


def ensure_product_models() -> dict[str, str]:
    """
    After rebrand, create dotlab* tags from gamemaster* / base weights if needed.
    Returns {max, dense, flash} resolved names.
    """
    try:
        data = ollama_json("/api/tags", timeout=5.0)
        names = [m.get("name") or "" for m in data.get("models") or []]
    except Exception:
        names = []

    resolved: dict[str, str] = {}
    plans = (
        ("max", DEFAULT_MODEL, MODEL_FALLBACKS),
        ("dense", DENSE_MODEL, DENSE_FALLBACKS),
        ("flash", FLASH_MODEL, FLASH_FALLBACKS),
    )
    for key, preferred, falls in plans:
        have = resolve_model_name(names, preferred, falls)
        if have and model_name_matches(names, preferred):
            resolved[key] = preferred
            continue
        if have and preferred and not model_name_matches(names, preferred):
            # Point new brand tag at whatever is installed (fast, no re-pull)
            if ensure_model_alias(preferred, have):
                names.append(preferred + ":latest")
                resolved[key] = preferred
                print(f"  ✓ alias {preferred} → {have}")
            else:
                resolved[key] = have
                print(f"  ↻ using legacy model {have} (alias {preferred} failed)")
        elif have:
            resolved[key] = have
        else:
            resolved[key] = preferred
    return resolved


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
