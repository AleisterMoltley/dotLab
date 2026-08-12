#!/usr/bin/env python3
"""
Gamemaster ↔ GitHub

Users sign in with the GitHub CLI (browser / device code / token),
then commit and push game projects.

  gamemaster github login
  gamemaster github status
  gamemaster github ship -p ./my-game -m "vertical slice"
"""
from __future__ import annotations

import argparse
import json
import os
import re
import shutil
import subprocess
import sys
import threading
import time
from pathlib import Path
from typing import Any

ROOT = Path(__file__).resolve().parent.parent
CONFIG_PATH = ROOT / "config" / "github.json"
SCOPES = "repo,workflow,read:org"

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


# ── process helpers ──────────────────────────────────────────────────


def which(name: str) -> str | None:
    return shutil.which(name)


def run(
    cmd: list[str],
    cwd: Path | None = None,
    timeout: float = 120.0,
    input_text: str | None = None,
    env: dict[str, str] | None = None,
) -> tuple[int, str]:
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


def require_git() -> str:
    g = which("git")
    if not g:
        raise SystemExit("git is not installed")
    return g


def require_gh() -> str:
    g = which("gh")
    if not g:
        raise SystemExit(
            "GitHub CLI (gh) is not installed.\n"
            "  macOS:  brew install gh\n"
            "  Linux:  https://github.com/cli/cli#installation\n"
            "Then:     gamemaster github login"
        )
    return g


# ── config ───────────────────────────────────────────────────────────


def load_cfg() -> dict[str, Any]:
    if CONFIG_PATH.exists():
        try:
            return json.loads(CONFIG_PATH.read_text(encoding="utf-8"))
        except Exception:
            pass
    return {"last_project": "", "default_private": True}


def save_cfg(data: dict[str, Any]) -> None:
    CONFIG_PATH.parent.mkdir(parents=True, exist_ok=True)
    CONFIG_PATH.write_text(json.dumps(data, indent=2) + "\n", encoding="utf-8")


def remember_project(project: Path) -> None:
    cfg = load_cfg()
    cfg["last_project"] = str(project.resolve())
    save_cfg(cfg)


# ── auth ─────────────────────────────────────────────────────────────


def auth_status() -> dict[str, Any]:
    gh = which("gh")
    git = which("git")
    out: dict[str, Any] = {
        "gh": bool(gh),
        "git": bool(git),
        "logged_in": False,
        "user": None,
        "html_url": None,
        "scopes": [],
        "protocol": None,
        "install_hint": None if gh else "brew install gh   # or https://cli.github.com",
    }
    if not gh:
        return out
    code, raw = run([gh, "api", "user"], timeout=20)
    if code != 0:
        return out
    try:
        user = json.loads(raw)
    except json.JSONDecodeError:
        return out
    out["logged_in"] = True
    out["user"] = user.get("login")
    out["html_url"] = user.get("html_url")
    out["name"] = user.get("name") or user.get("login")
    out["avatar"] = user.get("avatar_url")
    code2, st = run([gh, "auth", "status"], timeout=15)
    scopes = re.findall(r"'([a-z0-9:_-]+)'", st, flags=re.I)
    # gh prints: Token scopes: 'gist', 'read:org', 'repo', 'workflow'
    if "scopes:" in st.lower() and scopes:
        out["scopes"] = scopes
    if "https" in st.lower():
        out["protocol"] = "https"
    return out


def setup_git_credential() -> None:
    gh = which("gh")
    if not gh:
        return
    run([gh, "auth", "setup-git"], timeout=20)


def login_token(token: str) -> dict[str, Any]:
    gh = require_gh()
    token = (token or "").strip()
    if not token:
        return {"ok": False, "error": "empty token"}
    # classic PAT (ghp_) or fine-grained; gh accepts both via --with-token
    code, out = run(
        [gh, "auth", "login", "--hostname", "github.com", "--git-protocol", "https", "--with-token"],
        input_text=token + "\n",
        timeout=40,
    )
    if code != 0:
        return {"ok": False, "error": out[-400:] or "token login failed"}
    setup_git_credential()
    st = auth_status()
    st["ok"] = True
    return st


def logout() -> dict[str, Any]:
    gh = which("gh")
    if not gh:
        return {"ok": True, "logged_in": False}
    run([gh, "auth", "logout", "--hostname", "github.com"], timeout=20)
    return {"ok": True, **auth_status()}


# Interactive / device login (CLI + browser UI)

_login_lock = threading.Lock()
_login_state: dict[str, Any] = {
    "active": False,
    "user_code": None,
    "verification_uri": "https://github.com/login/device",
    "done": False,
    "error": None,
    "log": "",
}


def login_state() -> dict[str, Any]:
    with _login_lock:
        snap = dict(_login_state)
    if snap.get("done") and not snap.get("error"):
        st = auth_status()
        snap.update(st)
        snap["ok"] = st.get("logged_in")
    return snap


def start_web_login() -> dict[str, Any]:
    """Start `gh auth login --web` in the background; parse the device code."""
    st = auth_status()
    if st.get("logged_in"):
        return {"ok": True, "already": True, **st}

    gh = which("gh")
    if not gh:
        return {"ok": False, "error": "gh not installed", "install_hint": st.get("install_hint")}

    with _login_lock:
        if _login_state["active"] and not _login_state["done"]:
            return login_state()
        _login_state.update(
            {
                "active": True,
                "user_code": None,
                "verification_uri": "https://github.com/login/device",
                "done": False,
                "error": None,
                "log": "",
            }
        )

    env = os.environ.copy()
    env["GH_FORCE_TTY"] = "1"
    env["CLICOLOR"] = "0"
    env["NO_COLOR"] = "1"

    def worker() -> None:
        try:
            proc = subprocess.Popen(
                [
                    gh,
                    "auth",
                    "login",
                    "--hostname",
                    "github.com",
                    "--git-protocol",
                    "https",
                    "--web",
                    "--scopes",
                    SCOPES,
                ],
                stdout=subprocess.PIPE,
                stderr=subprocess.STDOUT,
                text=True,
                env=env,
                bufsize=1,
            )
            assert proc.stdout
            for line in proc.stdout:
                with _login_lock:
                    _login_state["log"] += line
                m = re.search(r"\b([A-Z0-9]{4}-[A-Z0-9]{4})\b", line)
                if m:
                    with _login_lock:
                        _login_state["user_code"] = m.group(1)
                um = re.search(r"https://github.com/login/device\S*", line)
                if um:
                    with _login_lock:
                        _login_state["verification_uri"] = um.group(0).rstrip(".)")
            code = proc.wait()
            with _login_lock:
                _login_state["done"] = True
                _login_state["active"] = False
                if code != 0:
                    _login_state["error"] = (_login_state.get("log") or "login failed")[-500:]
        except Exception as e:
            with _login_lock:
                _login_state["done"] = True
                _login_state["active"] = False
                _login_state["error"] = str(e)

    threading.Thread(target=worker, daemon=True).start()
    # give gh a moment to print the code
    for _ in range(20):
        time.sleep(0.15)
        with _login_lock:
            if _login_state.get("user_code") or _login_state.get("done"):
                break
    return login_state()


def login_cli() -> int:
    st = auth_status()
    if st.get("logged_in"):
        print(f"✓ already signed in as @{st['user']}")
        setup_git_credential()
        return 0
    if not which("gh"):
        print(st.get("install_hint") or "install gh")
        if sys.platform == "darwin" and which("brew"):
            print("\nTrying: brew install gh")
            code, out = run(["brew", "install", "gh"], timeout=300)
            print(out[-400:])
            if code != 0 or not which("gh"):
                return 1
        else:
            return 1
    print("→ Opening GitHub in your browser…")
    print("  (A one-time code may appear — paste it on github.com/login/device)")
    env = os.environ.copy()
    env["GH_FORCE_TTY"] = "1"
    r = subprocess.run(
        [
            require_gh(),
            "auth",
            "login",
            "--hostname",
            "github.com",
            "--git-protocol",
            "https",
            "--web",
            "--scopes",
            SCOPES,
        ],
        env=env,
    )
    if r.returncode != 0:
        print("Login failed. You can also paste a token:")
        print("  gh auth login --with-token   # then paste a PAT with repo scope")
        return r.returncode
    setup_git_credential()
    st = auth_status()
    print(f"✓ signed in as @{st.get('user')}")
    return 0


# ── git / repo ───────────────────────────────────────────────────────


def slugify(name: str) -> str:
    s = re.sub(r"[^a-zA-Z0-9._-]+", "-", (name or "").strip().lower()).strip("-.")
    return s or "game"


def looks_like_game(project: Path) -> bool:
    markers = ("package.json", "DESIGN.md", "index.html", "src", "App.tsx", "vite.config.js", "vite.config.ts")
    return any((project / m).exists() for m in markers)


def guard_project(project: Path) -> None:
    home = Path.home().resolve()
    if project == home or project == Path("/"):
        raise SystemExit(f"refusing to ship {project} — pass -p ./your-game")
    if project == ROOT:
        raise SystemExit("refusing to ship the Gamemaster tool itself — pass -p ./your-game")
    if not looks_like_game(project):
        raise SystemExit(
            f"{project} does not look like a game (no package.json / DESIGN.md / src).\n"
            "  Pass -p to the game folder."
        )


def resolve_project(path: str | Path | None) -> Path:
    if path:
        p = Path(path).expanduser().resolve()
    else:
        last = load_cfg().get("last_project")
        p = Path(last).expanduser().resolve() if last else Path.cwd().resolve()
    if not p.is_dir():
        raise SystemExit(f"Project not found: {p}")
    return p


def git_dir(project: Path) -> Path | None:
    code, out = run([require_git(), "-C", str(project), "rev-parse", "--show-toplevel"], timeout=10)
    if code != 0:
        return None
    return Path(out.splitlines()[0])


def ensure_gitignore(project: Path) -> None:
    gi = project / ".gitignore"
    if gi.exists():
        text = gi.read_text(encoding="utf-8", errors="ignore")
        extra = []
        for line in ("node_modules/", ".gamemaster/", ".env", "dist/"):
            if line not in text:
                extra.append(line)
        if extra:
            gi.write_text(text.rstrip() + "\n" + "\n".join(extra) + "\n", encoding="utf-8")
        return
    gi.write_text(GAME_GITIGNORE, encoding="utf-8")


def ensure_identity(project: Path) -> None:
    git = require_git()
    code, name = run([git, "-C", str(project), "config", "--get", "user.name"], timeout=8)
    if code == 0 and name:
        return
    st = auth_status()
    login = st.get("user") or os.environ.get("USER") or "gamemaster"
    display = st.get("name") or login
    run([git, "-C", str(project), "config", "user.name", str(display)], timeout=8)
    run(
        [git, "-C", str(project), "config", "user.email", f"{login}@users.noreply.github.com"],
        timeout=8,
    )


def ensure_repo(project: Path) -> None:
    """Init a repo *in this folder*. Nested repo if a parent already has git."""
    guard_project(project)
    git = require_git()
    root = git_dir(project)
    if root is None or root.resolve() != project.resolve():
        run([git, "-C", str(project), "init", "-b", "main"], timeout=15)
        run([git, "-C", str(project), "branch", "-M", "main"], timeout=8)
    ensure_gitignore(project)
    ensure_identity(project)


def repo_status(project: Path) -> dict[str, Any]:
    git = require_git()
    root = git_dir(project)
    info: dict[str, Any] = {
        "project": str(project),
        "is_repo": root is not None,
        "branch": None,
        "remote": None,
        "remote_url": None,
        "dirty": False,
        "ahead": 0,
        "behind": 0,
        "files": [],
        "last_commit": None,
    }
    if root is None:
        return info
    info["branch"] = (
        run([git, "-C", str(project), "rev-parse", "--abbrev-ref", "HEAD"], timeout=8)[1] or "main"
    )
    code, url = run([git, "-C", str(project), "remote", "get-url", "origin"], timeout=8)
    if code == 0 and url:
        info["remote"] = "origin"
        info["remote_url"] = url
        m = re.search(r"github\.com[:/](.+?)(?:\.git)?$", url)
        if m:
            info["full_name"] = m.group(1)
            info["html_url"] = f"https://github.com/{m.group(1)}"
    code, st = run([git, "-C", str(project), "status", "--porcelain"], timeout=15)
    if code == 0:
        files = [ln[3:] for ln in st.splitlines() if len(ln) > 3]
        info["files"] = files[:80]
        info["dirty"] = bool(files)
    code, log = run(
        [git, "-C", str(project), "log", "-1", "--pretty=%h %s"],
        timeout=8,
    )
    if code == 0 and log:
        info["last_commit"] = log
    code, ab = run(
        [git, "-C", str(project), "rev-list", "--left-right", "--count", "@{u}...HEAD"],
        timeout=8,
    )
    if code == 0 and ab:
        parts = ab.split()
        if len(parts) == 2:
            info["behind"], info["ahead"] = int(parts[0]), int(parts[1])
    return info


def default_message(project: Path) -> str:
    design = project / "DESIGN.md"
    if design.exists():
        for line in design.read_text(encoding="utf-8", errors="ignore").splitlines():
            line = line.strip()
            if line.startswith("# "):
                return f"feat: {line[2:].strip()}"
    return f"feat: {project.name} snapshot"


def commit(project: Path, message: str | None = None) -> dict[str, Any]:
    git = require_git()
    guard_project(project)
    ensure_repo(project)
    remember_project(project)
    msg = (message or default_message(project)).strip() or default_message(project)
    run([git, "-C", str(project), "add", "-A"], timeout=60)
    code, st = run([git, "-C", str(project), "status", "--porcelain"], timeout=15)
    if code == 0 and not st:
        rs = repo_status(project)
        rs["ok"] = True
        rs["committed"] = False
        rs["message"] = "nothing to commit"
        return rs
    code, out = run([git, "-C", str(project), "commit", "-m", msg], timeout=60)
    if code != 0:
        return {"ok": False, "error": out[-500:] or "commit failed"}
    rs = repo_status(project)
    rs["ok"] = True
    rs["committed"] = True
    rs["message"] = msg
    return rs


def create_remote(
    project: Path,
    name: str | None = None,
    private: bool = True,
    description: str = "",
) -> dict[str, Any]:
    gh = require_gh()
    st = auth_status()
    if not st.get("logged_in"):
        return {"ok": False, "error": "not signed in — run: gamemaster github login"}
    guard_project(project)
    ensure_repo(project)
    remember_project(project)
    repo_name = slugify(name or project.name)
    desc = description or f"{project.name} — made with Gamemaster"
    cmd = [
        gh,
        "repo",
        "create",
        repo_name,
        "--source",
        str(project),
        "--remote",
        "origin",
        "--description",
        desc,
    ]
    cmd.append("--private" if private else "--public")
    # do not --push here; caller pushes after a commit exists
    code, out = run(cmd, cwd=project, timeout=90)
    if code != 0:
        return {"ok": False, "error": out[-600:] or "repo create failed", "name": repo_name}
    rs = repo_status(project)
    rs["ok"] = True
    rs["created"] = True
    rs["name"] = repo_name
    return rs


def push(
    project: Path,
    create_if_missing: bool = True,
    private: bool = True,
    name: str | None = None,
) -> dict[str, Any]:
    git = require_git()
    guard_project(project)
    ensure_repo(project)
    remember_project(project)
    rs = repo_status(project)
    if not rs.get("last_commit"):
        return {"ok": False, "error": "no commits yet — commit first"}
    if not rs.get("remote"):
        if not create_if_missing:
            return {"ok": False, "error": "no origin remote"}
        cr = create_remote(project, name=name, private=private)
        if not cr.get("ok"):
            return cr
    code, out = run(
        [git, "-C", str(project), "push", "-u", "origin", "HEAD"],
        timeout=180,
    )
    if code != 0:
        return {"ok": False, "error": out[-600:] or "push failed"}
    rs = repo_status(project)
    rs["ok"] = True
    rs["pushed"] = True
    return rs


def ship(
    project: Path,
    message: str | None = None,
    private: bool = True,
    name: str | None = None,
) -> dict[str, Any]:
    """Commit (if dirty) + create GitHub repo if needed + push."""
    st = auth_status()
    if not st.get("logged_in"):
        return {"ok": False, "error": "not signed in — run: gamemaster github login", **st}
    guard_project(project)
    c = commit(project, message)
    if not c.get("ok"):
        return c
    p = push(project, create_if_missing=True, private=private, name=name)
    p["committed"] = c.get("committed")
    p["commit_message"] = c.get("message")
    return p


# ── HTTP (chat + live servers) ───────────────────────────────────────


def handle_http(
    method: str,
    path: str,
    body: dict[str, Any] | None = None,
    default_project: Path | None = None,
) -> tuple[int, dict[str, Any]]:
    body = body or {}
    method = method.upper()
    path = path.split("?", 1)[0]

    if path in ("/api/github/status", "/api/github") and method == "GET":
        st = auth_status()
        proj = body.get("project") or (str(default_project) if default_project else None)
        if proj:
            try:
                st["repo"] = repo_status(Path(proj).expanduser())
            except Exception as e:
                st["repo_error"] = str(e)
        elif default_project:
            st["repo"] = repo_status(default_project)
        st["ok"] = True
        return 200, st

    if path == "/api/github/login" and method == "POST":
        token = (body.get("token") or "").strip()
        if token:
            return 200, login_token(token)
        return 200, start_web_login()

    if path == "/api/github/login" and method == "GET":
        return 200, login_state()

    if path == "/api/github/logout" and method == "POST":
        return 200, logout()

    if path in ("/api/github/commit", "/api/github/push", "/api/github/ship", "/api/github/create"):
        raw = body.get("project") or (str(default_project) if default_project else None)
        if not raw:
            return 400, {"ok": False, "error": "project path required"}
        project = Path(raw).expanduser().resolve()
        if not project.is_dir():
            return 400, {"ok": False, "error": f"not a directory: {project}"}
        private = bool(body.get("private", load_cfg().get("default_private", True)))
        name = body.get("name")
        msg = body.get("message")
        try:
            if path.endswith("/commit"):
                return 200, commit(project, msg)
            if path.endswith("/create"):
                return 200, create_remote(project, name=name, private=private)
            if path.endswith("/push"):
                return 200, push(project, create_if_missing=True, private=private, name=name)
            return 200, ship(project, message=msg, private=private, name=name)
        except SystemExit as e:
            return 400, {"ok": False, "error": str(e)}
        except Exception as e:
            return 500, {"ok": False, "error": str(e)}

    return 404, {"ok": False, "error": "unknown github route"}


# ── CLI ──────────────────────────────────────────────────────────────


def _print(data: dict[str, Any]) -> None:
    if data.get("error"):
        print(f"❌ {data['error']}")
    if data.get("user"):
        print(f"👤 @{data['user']}  {data.get('html_url') or ''}")
    if data.get("html_url") and data.get("pushed"):
        print(f"🚀 {data['html_url']}")
    elif data.get("html_url") and data.get("created"):
        print(f"📦 {data['html_url']}")
    if data.get("message") and data.get("committed") is not None:
        print(f"💾 {data['message']}")
    if data.get("last_commit"):
        print(f"   last: {data['last_commit']}")
    if data.get("branch"):
        dirty = "dirty" if data.get("dirty") else "clean"
        print(f"   {data['branch']} · {dirty} · {len(data.get('files') or [])} files")
    if data.get("install_hint") and not data.get("gh"):
        print(f"   {data['install_hint']}")


def main() -> int:
    ap = argparse.ArgumentParser(description="Gamemaster GitHub — login, commit, push")
    sub = ap.add_subparsers(dest="cmd", required=True)

    p_st = sub.add_parser("status", help="Auth + repo status")
    p_st.add_argument("-p", "--project", default=None, help="Game directory")
    sub.add_parser("login", help="Sign in via browser")
    p_tok = sub.add_parser("token", help="Sign in with a personal access token")
    p_tok.add_argument("token", nargs="?", help="PAT (or read stdin)")
    sub.add_parser("logout", help="Sign out")

    def add_proj(p: argparse.ArgumentParser) -> None:
        p.add_argument("-p", "--project", default=None, help="Game directory")
        p.add_argument("-m", "--message", default=None, help="Commit message")
        p.add_argument("--name", default=None, help="GitHub repo name")
        p.add_argument("--public", action="store_true", help="Create a public repo")
        p.add_argument("--private", action="store_true", help="Create a private repo (default)")

    add_proj(sub.add_parser("commit", help="git add + commit"))
    add_proj(sub.add_parser("push", help="push (create GitHub repo if needed)"))
    add_proj(sub.add_parser("ship", help="commit + create repo + push"))
    add_proj(sub.add_parser("create", help="create GitHub repo from this folder"))

    args = ap.parse_args()

    if args.cmd == "status":
        st = auth_status()
        _print(st)
        try:
            proj = resolve_project(getattr(args, "project", None))
            print(f"📁 {proj}")
            rs = repo_status(proj)
            _print(rs)
            if rs.get("html_url"):
                print(f"🔗 {rs['html_url']}")
        except SystemExit as e:
            if str(e):
                print(f"📁 {e}")
        return 0 if st.get("logged_in") else 1

    if args.cmd == "login":
        return login_cli()

    if args.cmd == "token":
        tok = args.token
        if not tok:
            print("Paste a GitHub PAT (repo scope), then Enter:")
            tok = sys.stdin.readline()
        res = login_token(tok)
        _print(res)
        return 0 if res.get("ok") else 1

    if args.cmd == "logout":
        _print(logout())
        print("✓ signed out")
        return 0

    project = resolve_project(args.project)
    private = not bool(getattr(args, "public", False))
    if getattr(args, "private", False):
        private = True

    if args.cmd == "commit":
        res = commit(project, args.message)
    elif args.cmd == "create":
        res = create_remote(project, name=args.name, private=private)
    elif args.cmd == "push":
        res = push(project, create_if_missing=True, private=private, name=args.name)
    else:
        res = ship(project, message=args.message, private=private, name=args.name)

    _print(res)
    if res.get("ok") and res.get("html_url"):
        print(f"\n✓ {res['html_url']}")
    return 0 if res.get("ok") else 1


if __name__ == "__main__":
    raise SystemExit(main())
