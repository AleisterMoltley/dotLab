#!/usr/bin/env python3
"""Studio dashboard helpers: verify cache, session, play status, zip, agent jobs."""
from __future__ import annotations

import json
import os
import subprocess
import sys
import time
import zipfile
from pathlib import Path
from typing import Any

from gmcommon import ROOT, meta_dir, project_search_roots, run, slugify_project

_AGENTS: dict[str, dict[str, Any]] = {}


def under_projects(target: Path) -> bool:
    target = target.expanduser().resolve()
    for root in project_search_roots():
        try:
            target.relative_to(root.resolve())
            return True
        except ValueError:
            continue
    return False


def session_path(project: Path) -> Path:
    return meta_dir(project) / "session.json"


def load_session(project: Path) -> dict[str, Any]:
    path = session_path(project)
    if not path.is_file():
        return {"crafts": [], "notes": [], "last_play": "", "last_play_at": 0, "agent": {}}
    try:
        data = json.loads(path.read_text(encoding="utf-8"))
        if not isinstance(data, dict):
            return {"crafts": [], "notes": [], "last_play": "", "last_play_at": 0, "agent": {}}
        data.setdefault("crafts", [])
        data.setdefault("notes", [])
        data.setdefault("last_play", "")
        data.setdefault("last_play_at", 0)
        data.setdefault("agent", {})
        return data
    except Exception:
        return {"crafts": [], "notes": [], "last_play": "", "last_play_at": 0, "agent": {}}


def save_session(project: Path, data: dict[str, Any]) -> None:
    meta = meta_dir(project)
    meta.mkdir(parents=True, exist_ok=True)
    data["updated_at"] = time.time()
    session_path(project).write_text(json.dumps(data, indent=2) + "\n", encoding="utf-8")


def session_note(project: Path, kind: str, text: str, extra: dict | None = None) -> dict[str, Any]:
    data = load_session(project)
    entry = {"t": time.time(), "kind": kind, "text": (text or "")[:400]}
    if extra:
        entry.update(extra)
    if kind == "craft":
        crafts = list(data.get("crafts") or [])
        crafts.insert(0, entry)
        data["crafts"] = crafts[:30]
    else:
        notes = list(data.get("notes") or [])
        notes.insert(0, entry)
        data["notes"] = notes[:40]
    save_session(project, data)
    return data


def session_set_play(project: Path, url: str) -> None:
    data = load_session(project)
    data["last_play"] = url
    data["last_play_at"] = time.time()
    save_session(project, data)


def src_mtime(project: Path) -> float:
    best = 0.0
    for rel in ("src/game.js", "src/main.js", "package.json", "WIKI.md"):
        p = project / rel
        if p.is_file():
            try:
                best = max(best, p.stat().st_mtime)
            except OSError:
                pass
    return best


def cached_verify(project: Path, force: bool = False) -> dict[str, Any]:
    """P0/score with cache keyed to source mtime."""
    project = project.expanduser().resolve()
    meta = meta_dir(project)
    cache = meta / "verify.json"
    mtime = src_mtime(project)
    if not force and cache.is_file():
        try:
            data = json.loads(cache.read_text(encoding="utf-8"))
            if data.get("src_mtime") == mtime:
                return data
        except Exception:
            pass
    import verify as verifylib

    r = verifylib.evaluate(project)
    out = {
        "ok": bool(r.get("ok")),
        "score": int(r.get("score") or 0),
        "p0_fail": list(r.get("p0_fail") or []),
        "src_mtime": mtime,
        "ts": time.time(),
        "report": (r.get("report") or "")[:1200],
    }
    try:
        meta.mkdir(parents=True, exist_ok=True)
        cache.write_text(json.dumps(out, indent=2) + "\n", encoding="utf-8")
    except OSError:
        pass
    return out


def enrich_projects(projects: list[dict[str, Any]], with_verify: bool = True) -> list[dict[str, Any]]:
    out = []
    for p in projects:
        row = dict(p)
        path = Path(p["path"])
        sess = load_session(path) if path.is_dir() else {}
        row["last_play"] = sess.get("last_play") or ""
        row["last_play_at"] = int(sess.get("last_play_at") or 0)
        row["craft_count"] = len(sess.get("crafts") or [])
        if with_verify and path.is_dir():
            try:
                v = cached_verify(path, force=False)
                row["verify_ok"] = bool(v.get("ok"))
                row["verify_score"] = int(v.get("score") or 0)
                row["p0_fail"] = list(v.get("p0_fail") or [])
            except Exception:
                row["verify_ok"] = None
                row["verify_score"] = 0
                row["p0_fail"] = []
        else:
            row["verify_ok"] = None
            row["verify_score"] = 0
            row["p0_fail"] = []
        out.append(row)
    return out


def diagnose_play_log(text: str) -> dict[str, Any]:
    """Map Vite/npm log noise to one actionable line."""
    t = text or ""
    low = t.lower()
    issues: list[dict[str, str]] = []

    def add(code: str, message: str) -> None:
        issues.append({"code": code, "message": message})

    if re_search(r"enoent|cannot find module|err! missing|npm err! code elsp", low):
        add("npm_missing", "Dependencies missing — run npm install in the project folder")
    if re_search(r"eaddrinuse|address already in use|port \d+ is already", low):
        add("port_busy", "Port busy — stop the other Vite/dev server or Play again")
    if re_search(r"syntaxerror|unexpected token|failed to parse|esbuild.*error", low):
        add("syntax", "JS syntax error — open Editor and check src/game.js")
    if re_search(r"failed to resolve import|does not provide an export", low):
        add("import", "Import failed — craft modules missing? Rebuild slice or re-vendor src/craft")
    if re_search(r"error when starting|error:|err!", low) and not issues:
        add("dev_error", "Dev server error — see log tail below")
    if re_search(r"ready in|local:\s*http", low) and not issues:
        add("ready", "Vite ready")

    primary = issues[0]["message"] if issues else ""
    # Prefer real problems over "ready"
    for it in issues:
        if it["code"] != "ready":
            primary = it["message"]
            break
    return {"issues": issues, "primary": primary, "ok": not any(i["code"] not in ("ready",) for i in issues)}


def re_search(pattern: str, text: str) -> bool:
    import re

    return bool(re.search(pattern, text, re.I))


def preview_status(project: Path, previews: dict) -> dict[str, Any]:
    key = str(project.resolve())
    prev = previews.get(key) or {}
    proc = prev.get("proc")
    running = bool(proc is not None and proc.poll() is None)
    url = prev.get("url") or ""
    log_path = meta_dir(project) / "play.log"
    tail = ""
    full = ""
    if log_path.is_file():
        try:
            full = log_path.read_text(encoding="utf-8", errors="ignore")
            tail = "\n".join(full.splitlines()[-40:])
        except Exception:
            tail = ""
    up = False
    if running and url:
        try:
            import urllib.request

            urllib.request.urlopen(url, timeout=0.8)
            up = True
        except Exception:
            up = False
    diag = diagnose_play_log(full or tail)
    return {
        "ok": True,
        "running": running,
        "up": up,
        "url": url if running else (url if up else ""),
        "port": prev.get("port"),
        "log_tail": tail[-4000:],
        "path": key,
        "error_line": diag.get("primary") or "",
        "diagnose": diag,
    }


def trash_root() -> Path:
    root = projects_root_safe() / ".Trash"
    root.mkdir(parents=True, exist_ok=True)
    return root


def projects_root_safe() -> Path:
    from gmcommon import projects_root

    return projects_root()


def soft_delete(project: Path) -> dict[str, Any]:
    """Move project into Projects/.Trash/<name>-<ts> instead of hard delete."""
    project = project.expanduser().resolve()
    if not under_projects(project):
        return {"ok": False, "error": "not under projects root"}
    if project.resolve() in (Path.home().resolve(), ROOT.resolve()):
        return {"ok": False, "error": "refused"}
    if project.name.startswith("."):
        return {"ok": False, "error": "refused hidden"}
    trash = trash_root()
    stamp = time.strftime("%Y%m%d-%H%M%S")
    dest = trash / f"{project.name}-{stamp}"
    n = 1
    while dest.exists():
        dest = trash / f"{project.name}-{stamp}-{n}"
        n += 1
    project.rename(dest)
    manifest = {
        "original_name": project.name,
        "original_path": str(project),
        "trash_path": str(dest),
        "deleted_at": time.time(),
    }
    try:
        (dest / ".dotlab-trash.json").write_text(json.dumps(manifest, indent=2) + "\n", encoding="utf-8")
    except Exception:
        pass
    return {
        "ok": True,
        "soft": True,
        "path": str(project),
        "trash_path": str(dest),
        "message": f"Moved to Trash. Restore within Projects/.Trash if needed.",
    }


def list_trash() -> list[dict[str, Any]]:
    trash = trash_root()
    out: list[dict[str, Any]] = []
    try:
        for child in sorted(trash.iterdir(), key=lambda p: p.stat().st_mtime, reverse=True):
            if not child.is_dir():
                continue
            meta = {}
            mp = child / ".dotlab-trash.json"
            if mp.is_file():
                try:
                    meta = json.loads(mp.read_text(encoding="utf-8"))
                except Exception:
                    meta = {}
            out.append(
                {
                    "name": child.name,
                    "path": str(child.resolve()),
                    "original_name": meta.get("original_name") or child.name.rsplit("-", 2)[0],
                    "deleted_at": int(meta.get("deleted_at") or child.stat().st_mtime),
                }
            )
    except OSError:
        pass
    return out


def restore_trash(trash_path: Path) -> dict[str, Any]:
    trash_path = trash_path.expanduser().resolve()
    trash = trash_root().resolve()
    try:
        trash_path.relative_to(trash)
    except ValueError:
        return {"ok": False, "error": "not in trash"}
    if not trash_path.is_dir():
        return {"ok": False, "error": "not a folder"}
    meta = {}
    mp = trash_path / ".dotlab-trash.json"
    if mp.is_file():
        try:
            meta = json.loads(mp.read_text(encoding="utf-8"))
        except Exception:
            meta = {}
    name = slugify_project(str(meta.get("original_name") or trash_path.name))
    dest = projects_root_safe() / name
    n = 2
    while dest.exists():
        dest = projects_root_safe() / f"{name}-{n}"
        n += 1
    trash_path.rename(dest)
    try:
        (dest / ".dotlab-trash.json").unlink(missing_ok=True)  # type: ignore[call-arg]
    except TypeError:
        try:
            p = dest / ".dotlab-trash.json"
            if p.exists():
                p.unlink()
        except OSError:
            pass
    except OSError:
        pass
    return {"ok": True, "name": dest.name, "path": str(dest.resolve())}


def open_terminal(project: Path) -> dict[str, Any]:
    project = project.expanduser().resolve()
    if not project.is_dir():
        return {"ok": False, "error": "not a folder"}
    if sys.platform == "darwin":
        # AppleScript: new Terminal window cd's into project
        script = (
            f'tell application "Terminal"\n'
            f'  activate\n'
            f'  do script "cd {shell_quote(str(project))} && clear && pwd"\n'
            f"end tell\n"
        )
        code, out = run(["osascript", "-e", script], timeout=10)
        if code == 0:
            return {"ok": True, "cmd": "Terminal", "path": str(project)}
        # fallback iTerm
        code2, _ = run(
            [
                "osascript",
                "-e",
                f'tell application "iTerm" to create window with default profile command "cd {shell_quote(str(project))}"',
            ],
            timeout=10,
        )
        if code2 == 0:
            return {"ok": True, "cmd": "iTerm", "path": str(project)}
        return {"ok": False, "error": out or "Terminal failed"}
    # Linux
    for term in (
        ["x-terminal-emulator", "-e", f"bash -lc 'cd {shell_quote(str(project))}; exec bash'"],
        ["gnome-terminal", "--working-directory", str(project)],
        ["konsole", "--workdir", str(project)],
    ):
        code, _ = run(term, timeout=8)
        if code == 0:
            return {"ok": True, "cmd": term[0], "path": str(project)}
    return {"ok": False, "error": "no terminal found"}


def shell_quote(s: str) -> str:
    return "'" + s.replace("'", "'\\''") + "'"


def rename_project(target: Path, new_name: str) -> dict[str, Any]:
    if not under_projects(target):
        return {"ok": False, "error": "not under projects root"}
    slug = slugify_project(new_name)
    dest = target.parent / slug
    if dest.exists():
        return {"ok": False, "error": "name exists"}
    target.rename(dest)
    return {"ok": True, "name": dest.name, "path": str(dest.resolve())}


def export_zip(project: Path) -> dict[str, Any]:
    if not under_projects(project):
        return {"ok": False, "error": "not under projects root"}
    meta = meta_dir(project)
    meta.mkdir(parents=True, exist_ok=True)
    out = meta / f"{project.name}-export.zip"
    skip_dirs = {"node_modules", ".git", "dist", "build", ".vite"}
    with zipfile.ZipFile(out, "w", compression=zipfile.ZIP_DEFLATED) as zf:
        for dirpath, dirnames, filenames in os.walk(project):
            dirnames[:] = [d for d in dirnames if d not in skip_dirs]
            root = Path(dirpath)
            for name in filenames:
                if name.endswith(".zip") and root == meta:
                    continue
                fp = root / name
                try:
                    zf.write(fp, fp.relative_to(project).as_posix())
                except OSError:
                    continue
    return {"ok": True, "path": str(out), "bytes": out.stat().st_size}


def open_editor(project: Path) -> dict[str, Any]:
    project = project.expanduser().resolve()
    if not project.is_dir():
        return {"ok": False, "error": "not a folder"}
    # Prefer Cursor, then VS Code, then Finder/xdg
    attempts: list[list[str]] = []
    if sys.platform == "darwin":
        attempts = [
            ["cursor", str(project)],
            ["code", str(project)],
            ["open", "-a", "Cursor", str(project)],
            ["open", "-a", "Visual Studio Code", str(project)],
            ["open", str(project)],
        ]
    else:
        attempts = [
            ["cursor", str(project)],
            ["code", str(project)],
            ["xdg-open", str(project)],
        ]
    for cmd in attempts:
        code, _ = run(cmd, timeout=8)
        if code == 0:
            return {"ok": True, "cmd": cmd[0], "path": str(project)}
        # FileNotFound is code 127 from run helper
        if code == 127:
            continue
    return {"ok": False, "error": "no editor found (cursor/code)"}


def start_agent(project: Path, prompt: str, model: str = "") -> dict[str, Any]:
    project = project.expanduser().resolve()
    if not under_projects(project):
        return {"ok": False, "error": "not under projects root"}
    key = str(project)
    prev = _AGENTS.get(key)
    if prev and prev.get("proc") and prev["proc"].poll() is None:
        return {"ok": False, "error": "agent already running", "running": True}

    meta = meta_dir(project)
    meta.mkdir(parents=True, exist_ok=True)
    log = meta / "agent.log"
    status_path = meta / "agent.json"
    status = {
        "running": True,
        "prompt": prompt[:500],
        "started": time.time(),
        "exit": None,
        "model": model or "",
        "log": str(log),
    }
    status_path.write_text(json.dumps(status, indent=2) + "\n", encoding="utf-8")
    handle = open(log, "w", encoding="utf-8")
    cmd = [sys.executable, str(ROOT / "bin" / "agent.py"), "-p", str(project)]
    if model:
        cmd += ["-m", model]
    cmd.append(prompt)
    env = os.environ.copy()
    proc = subprocess.Popen(
        cmd,
        cwd=str(project),
        stdout=handle,
        stderr=subprocess.STDOUT,
        env=env,
        start_new_session=True,
    )
    _AGENTS[key] = {"proc": proc, "log": str(log), "status": str(status_path), "handle": handle}

    def _watch() -> None:
        code = proc.wait()
        try:
            handle.close()
        except Exception:
            pass
        st = {
            "running": False,
            "prompt": prompt[:500],
            "started": status["started"],
            "ended": time.time(),
            "exit": code,
            "model": model or "",
            "log": str(log),
        }
        try:
            status_path.write_text(json.dumps(st, indent=2) + "\n", encoding="utf-8")
        except Exception:
            pass
        # refresh verify cache after agent
        try:
            cached_verify(project, force=True)
        except Exception:
            pass
        session_note(project, "agent", prompt[:200], {"exit": code})

    threading = __import__("threading")
    threading.Thread(target=_watch, daemon=True).start()
    session_note(project, "agent_start", prompt[:200])
    return {"ok": True, "running": True, "log": str(log), "path": key}


def agent_status(project: Path) -> dict[str, Any]:
    key = str(project.resolve())
    meta = meta_dir(project)
    status_path = meta / "agent.json"
    log_path = meta / "agent.log"
    st: dict[str, Any] = {}
    if status_path.is_file():
        try:
            st = json.loads(status_path.read_text(encoding="utf-8"))
        except Exception:
            st = {}
    live = _AGENTS.get(key)
    if live and live.get("proc") is not None:
        code = live["proc"].poll()
        st["running"] = code is None
        if code is not None:
            st["exit"] = code
    tail = ""
    if log_path.is_file():
        try:
            tail = "\n".join(log_path.read_text(encoding="utf-8", errors="ignore").splitlines()[-60:])
        except Exception:
            tail = ""
    st["log_tail"] = tail[-6000:]
    st["path"] = key
    st["ok"] = True
    return st


def auto_repair_play(project: Path, model: str = "") -> dict[str, Any]:
    """Run quality.play_error_auto_repair from play.log (dashboard button / API)."""
    project = project.expanduser().resolve()
    if not under_projects(project):
        return {"ok": False, "error": "not under projects root"}
    log_path = meta_dir(project) / "play.log"
    text = ""
    if log_path.is_file():
        try:
            text = log_path.read_text(encoding="utf-8", errors="ignore")
        except OSError:
            text = ""
    if not text.strip():
        return {"ok": False, "error": "empty play.log — start Play first"}
    try:
        import quality as qualitylib

        result = qualitylib.play_error_auto_repair(
            project, text, model=model or None
        )
        try:
            cached_verify(project, force=True)
        except Exception:
            pass
        session_note(
            project,
            "auto_repair",
            result.get("message") or result.get("actions") and str(result["actions"]) or "repair",
            {"ok": result.get("ok")},
        )
        return {"ok": bool(result.get("ok")), **result}
    except Exception as e:
        return {"ok": False, "error": str(e)}


def quality_score(project: Path) -> dict[str, Any]:
    try:
        import quality as qualitylib

        return {"ok": True, **qualitylib.score_project(project)}
    except Exception as e:
        return {"ok": False, "error": str(e)}
