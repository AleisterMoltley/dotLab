#!/usr/bin/env python3
"""Tiny local server: Chat-UI + Proxy zu Ollama. Kein pip, nur Stdlib."""
from __future__ import annotations

import json
import os
import subprocess
import sys
import threading
import time
import urllib.error
import urllib.request
import webbrowser
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from urllib.parse import parse_qs, urlparse

import cloud as cloudlib  # noqa: E402
import github as githublib  # noqa: E402
import patch as patchlib  # noqa: E402
import slice as slicelib  # noqa: E402
import studio_ops as ops  # noqa: E402
from gmcommon import (
    CHAT_DIR,
    DEFAULT_MODEL,
    MODEL_FALLBACKS,
    OLLAMA,
    PRODUCT,
    ROOT,
    ensure_ollama,
    ensure_product_models,
    free_tcp_port,
    list_game_projects,
    looks_like_game,
    meta_dir,
    model_name_matches,
    projects_root,
    resolve_model_name,
    slugify_project,
)

PORT = int(os.environ.get("DOTLAB_PORT") or os.environ.get("GAMEMASTER_PORT", "8765"))
MODEL = os.environ.get("DOTLAB_MODEL") or os.environ.get("GAMEMASTER_MODEL", DEFAULT_MODEL)
# Prefill dominates wall time — 16k default, not 65k
NUM_CTX = int(os.environ.get("DOTLAB_NUM_CTX") or os.environ.get("GAMEMASTER_NUM_CTX", "16384"))

_TAGS: dict = {"ts": 0.0, "names": [], "ok": False, "error": ""}
_PREVIEWS: dict[str, dict] = {}

extract_code_files = slicelib.extract_code_files
write_reply_files = slicelib.write_reply_files


def http_up(url: str, timeout: float = 20.0) -> bool:
    end = time.time() + timeout
    while time.time() < end:
        try:
            urllib.request.urlopen(url, timeout=1.0)
            return True
        except Exception:
            time.sleep(0.25)
    return False


def start_preview(project: Path) -> dict:
    """Vite (or static server) for THIS folder on a free port. Open the game, not a wrapper."""
    key = str(project.resolve())
    prev = _PREVIEWS.get(key)
    if prev and prev.get("proc") and prev["proc"].poll() is None:
        if http_up(prev["url"], timeout=1.5):
            return {"ok": True, "url": prev["url"], "reused": True, "path": key}

    pkg = project / "package.json"
    log = meta_dir(project) / "play.log"
    log.parent.mkdir(parents=True, exist_ok=True)
    port = free_tcp_port(5173)
    if pkg.is_file():
        if not (project / "node_modules").is_dir():
            subprocess.run(["npm", "install"], cwd=str(project), check=False, timeout=180)
        cmd = [
            "npm",
            "run",
            "dev",
            "--",
            "--host",
            "127.0.0.1",
            "--port",
            str(port),
            "--strictPort",
        ]
    else:
        cmd = [sys.executable, "-m", "http.server", str(port), "--bind", "127.0.0.1"]
    url = f"http://127.0.0.1:{port}/"
    handle = open(log, "w", encoding="utf-8")
    env = os.environ.copy()
    env["BROWSER"] = "none"
    env["CI"] = "1"
    proc = subprocess.Popen(
        cmd,
        cwd=str(project),
        stdout=handle,
        stderr=subprocess.STDOUT,
        env=env,
        start_new_session=True,
    )
    _PREVIEWS[key] = {"proc": proc, "url": url, "port": port, "log": handle}
    ok = http_up(url, timeout=40.0)
    try:
        ops.session_set_play(project, url)
    except Exception:
        pass
    st = ops.preview_status(project, _PREVIEWS)
    return {
        "ok": ok,
        "url": url,
        "path": key,
        "reused": False,
        "log": str(log),
        "up": st.get("up"),
        "running": st.get("running"),
        "log_tail": st.get("log_tail"),
        "error_line": st.get("error_line") or "",
        "diagnose": st.get("diagnose") or {},
    }


def remember_tags(names: list[str], ok: bool = True, error: str = "") -> None:
    global _TAGS
    _TAGS = {"ts": time.time(), "names": list(names), "ok": ok, "error": error}


def peek_ollama_tags(timeout: float = 2.0) -> dict:
    """Optional background refresh. The UI health path must not call this."""
    try:
        with urllib.request.urlopen(f"{OLLAMA}/api/tags", timeout=timeout) as r:
            data = json.loads(r.read().decode())
        names = [m.get("name") or "" for m in data.get("models") or []]
        remember_tags(names, ok=True)
    except Exception as e:
        remember_tags(list(_TAGS.get("names") or []), ok=False, error=str(e)[:160])
    return _TAGS


def has_model(names: list[str], model: str) -> bool:
    return model_name_matches(names, model)


def status_label(h: dict | None = None) -> tuple[bool, str]:
    h = h or health_payload()
    if h.get("backend") == "cloud" and h.get("ok"):
        return True, f"cloud · {h.get('provider') or ''} · {h.get('model') or ''} · paid"
    if h.get("ok"):
        return True, f"online · {h.get('model') or MODEL} · $0"
    if not h.get("ollama"):
        return False, "Ollama offline — open Ollama.app"
    return False, "Model missing — ./install.sh or dotlab intervene"


def index_html() -> bytes:
    raw = (CHAT_DIR / "index.html").read_text(encoding="utf-8")
    ok, label = status_label()
    klass = "ok" if ok else "bad"
    raw = raw.replace(
        '<span class="led" id="dot"></span>',
        f'<span class="led {klass}" id="dot"></span>',
        1,
    )
    raw = raw.replace(
        '<span class="dot" id="dot"></span>',
        f'<span class="dot {klass}" id="dot"></span>',
        1,
    )
    raw = raw.replace(
        '<span id="statusText">…</span>',
        f'<span id="statusText">{label}</span>',
        1,
    )
    raw = raw.replace(
        '<span id="statusText">starting…</span>',
        f'<span id="statusText">{label}</span>',
        1,
    )
    return raw.encode()


def health_payload() -> dict:
    """Instant. Never talks to Ollama — tags are cached at process start."""
    cloud = cloudlib.status_dict()
    if cloud.get("enabled"):
        return {
            "ok": True,
            "product": PRODUCT,
            "backend": "cloud",
            "provider": cloud.get("provider") or "",
            "model": cloud.get("model") or "",
            "ollama": False,
            "has_model": True,
            "cloud": cloud,
            "projects_root": str(projects_root()),
            "local": False,
            "error": "",
        }
    names = list(_TAGS.get("names") or [])
    model = resolve_model_name(names, MODEL, MODEL_FALLBACKS) or MODEL
    found = has_model(names, model) if model else False
    ollama_ok = bool(_TAGS.get("ok")) or bool(names)
    return {
        "ok": bool(found),
        "product": PRODUCT,
        "backend": "ollama",
        "provider": "",
        "model": model if found else MODEL,
        "ollama": ollama_ok,
        "has_model": found,
        "local": True,
        "cloud": cloudlib.status_dict(),
        "models": list(_TAGS.get("names") or [])[:40],
        "projects_root": str(projects_root()),
        "error": "" if found else (_TAGS.get("error") or "model missing"),
    }


class Handler(SimpleHTTPRequestHandler):
    protocol_version = "HTTP/1.0"

    def __init__(self, *args, **kwargs):
        super().__init__(*args, directory=str(CHAT_DIR), **kwargs)

    def log_message(self, fmt: str, *args) -> None:
        line = fmt % args if args else str(fmt)
        if '"GET /api/github' in line or '"GET /favicon' in line:
            return
        sys.stderr.write("[chat] " + line + "\n")

    def _proxy(self, path: str, method: str = "GET", body: bytes | None = None) -> None:
        url = f"{OLLAMA}{path}"
        headers = {"Content-Type": "application/json"}
        req = urllib.request.Request(url, data=body, headers=headers, method=method)
        try:
            with urllib.request.urlopen(req, timeout=600) as resp:
                data = resp.read()
                self.send_response(resp.status)
                self.send_header("Content-Type", resp.headers.get("Content-Type", "application/json"))
                self.send_header("Cache-Control", "no-store")
                self.end_headers()
                self.wfile.write(data)
        except urllib.error.HTTPError as e:
            err = e.read()
            self.send_response(e.code)
            self.send_header("Content-Type", "application/json")
            self.end_headers()
            self.wfile.write(err or json.dumps({"error": str(e)}).encode())
        except Exception as e:
            self.send_response(502)
            self.send_header("Content-Type", "application/json")
            self.end_headers()
            self.wfile.write(json.dumps({"error": str(e)}).encode())

    def _proxy_stream(self, path: str, body: bytes) -> None:
        url = f"{OLLAMA}{path}"
        req = urllib.request.Request(
            url, data=body, headers={"Content-Type": "application/json"}, method="POST"
        )
        try:
            with urllib.request.urlopen(req, timeout=600) as resp:
                self.send_response(200)
                self.send_header("Content-Type", "application/x-ndjson")
                self.send_header("Cache-Control", "no-store")
                self.send_header("Connection", "close")
                self.end_headers()
                while True:
                    chunk = resp.read(512)
                    if not chunk:
                        break
                    self.wfile.write(chunk)
                    self.wfile.flush()
        except Exception as e:
            try:
                msg = (json.dumps({"message": {"content": f"\n\n[Proxy-Error: {e}]"}, "done": True}) + "\n").encode()
                if not getattr(self, "_headers_buffer", None) and not self.wfile.closed:
                    self.send_response(200)
                    self.send_header("Content-Type", "application/x-ndjson")
                    self.send_header("Connection", "close")
                    self.end_headers()
                    self.wfile.write(msg)
            except Exception:
                pass

    def _cloud_chat(self, payload: dict) -> None:
        messages = payload.get("messages") or []
        opts = payload.get("options") or {}
        try:
            text = cloudlib.chat(
                messages,
                model=payload.get("model") or "",
                temperature=float(opts.get("temperature", 0.2)),
                num_predict=int(opts.get("num_predict", 8192)),
            )
        except Exception as e:
            return self._json(502, {"error": str(e)})
        self.send_response(200)
        self.send_header("Content-Type", "application/x-ndjson")
        self.send_header("Cache-Control", "no-store")
        self.send_header("Connection", "close")
        self.end_headers()
        # Word-split so the existing stream UI still ticks.
        words = text.split(" ")
        for i, w in enumerate(words):
            piece = w if i == 0 else " " + w
            line = json.dumps({"message": {"role": "assistant", "content": piece}, "done": False}) + "\n"
            self.wfile.write(line.encode())
            self.wfile.flush()
        self.wfile.write(json.dumps({"message": {"content": ""}, "done": True}).encode() + b"\n")

    def end_headers(self) -> None:
        path = urlparse(getattr(self, "path", "") or "").path
        if path in ("/", "/index.html") or path.endswith(".html"):
            self.send_header("Cache-Control", "no-store, max-age=0")
        super().end_headers()

    def _bytes(self, status: int, body: bytes, content_type: str) -> None:
        self.send_response(status)
        self.send_header("Content-Type", content_type)
        self.send_header("Cache-Control", "no-store, max-age=0")
        self.send_header("Content-Length", str(len(body)))
        self.send_header("Connection", "close")
        self.end_headers()
        self.wfile.write(body)

    def _json(self, status: int, data: dict) -> None:
        raw = json.dumps(data).encode()
        self.send_response(status)
        self.send_header("Content-Type", "application/json")
        self.send_header("Cache-Control", "no-store")
        self.send_header("Access-Control-Allow-Origin", "*")
        self.send_header("Content-Length", str(len(raw)))
        self.send_header("Connection", "close")
        self.end_headers()
        self.wfile.write(raw)

    def _github(self, method: str) -> bool:
        parsed = urlparse(self.path)
        if not parsed.path.startswith("/api/github"):
            return False
        body: dict = {}
        if method == "POST":
            length = int(self.headers.get("Content-Length", 0))
            raw = self.rfile.read(length) if length else b"{}"
            try:
                body = json.loads(raw.decode() or "{}")
            except json.JSONDecodeError:
                body = {}
        qs = parse_qs(parsed.query)
        if qs.get("project") and not body.get("project"):
            body["project"] = qs["project"][0]
        code, data = githublib.handle_http(method, parsed.path, body)
        self._json(code, data)
        return True

    def do_OPTIONS(self) -> None:  # noqa: N802
        self.send_response(204)
        self.send_header("Access-Control-Allow-Origin", "*")
        self.send_header("Access-Control-Allow-Methods", "GET, POST, OPTIONS")
        self.send_header("Access-Control-Allow-Headers", "Content-Type")
        self.end_headers()

    def do_GET(self) -> None:
        if self._github("GET"):
            return
        path = urlparse(self.path).path
        if path == "/favicon.ico":
            self.send_response(204)
            self.end_headers()
            return
        if path == "/api/projects":
            projects = ops.enrich_projects(list_game_projects(), with_verify=True)
            stats = {}
            try:
                import engine_ops as eops

                stats = eops.dashboard_stats()
            except Exception:
                stats = {}
            return self._json(
                200,
                {
                    "root": str(projects_root()),
                    "projects": projects,
                    "trash": ops.list_trash(),
                    "stats": stats,
                },
            )
        if path == "/api/stats" or path == "/api/projects/stats":
            try:
                import engine_ops as eops

                return self._json(200, eops.dashboard_stats())
            except Exception as e:
                return self._json(500, {"ok": False, "error": str(e)})
        if path == "/api/projects/ship-card":
            qs = parse_qs(urlparse(self.path).query)
            raw_p = (qs.get("path") or [""])[0]
            pdir = Path(raw_p).expanduser()
            if not pdir.is_dir():
                return self._json(400, {"ok": False, "error": "not a folder"})
            try:
                import engine_ops as eops

                return self._json(200, eops.ship_card(pdir))
            except Exception as e:
                return self._json(500, {"ok": False, "error": str(e)})
        if path == "/api/projects/trash":
            return self._json(200, {"ok": True, "trash": ops.list_trash()})
        if path == "/api/projects/session":
            qs = parse_qs(urlparse(self.path).query)
            raw_p = (qs.get("path") or [""])[0]
            pdir = Path(raw_p).expanduser()
            if not pdir.is_dir():
                return self._json(400, {"ok": False, "error": "not a folder"})
            return self._json(200, {"ok": True, "session": ops.load_session(pdir), "path": str(pdir)})
        if path == "/api/projects/play-status":
            qs = parse_qs(urlparse(self.path).query)
            raw_p = (qs.get("path") or [""])[0]
            pdir = Path(raw_p).expanduser()
            if not pdir.is_dir():
                return self._json(400, {"ok": False, "error": "not a folder"})
            return self._json(200, ops.preview_status(pdir, _PREVIEWS))
        if path == "/api/projects/verify":
            qs = parse_qs(urlparse(self.path).query)
            raw_p = (qs.get("path") or [""])[0]
            pdir = Path(raw_p).expanduser()
            if not pdir.is_dir():
                return self._json(400, {"ok": False, "error": "not a folder"})
            force = (qs.get("force") or [""])[0] in ("1", "true", "yes")
            return self._json(200, {"ok": True, "verify": ops.cached_verify(pdir, force=force)})
        if path == "/api/projects/agent":
            qs = parse_qs(urlparse(self.path).query)
            raw_p = (qs.get("path") or [""])[0]
            pdir = Path(raw_p).expanduser()
            if not pdir.is_dir():
                return self._json(400, {"ok": False, "error": "not a folder"})
            return self._json(200, ops.agent_status(pdir))
        if path in ("/api/health", "/api/cloud"):
            if path == "/api/health":
                return self._json(200, health_payload())
            return self._json(200, cloudlib.status_dict())
        if path.startswith("/api/tags"):
            if cloudlib.active_provider():
                st = cloudlib.status_dict()
                name = st.get("model") or st.get("provider") or "cloud"
                return self._json(200, {"models": [{"name": name, "cloud": True}]})
            models = [{"name": n} for n in (_TAGS.get("names") or [])]
            return self._json(200, {"models": models, "error": _TAGS.get("error") or ""})
        if path == "/app.js":
            p = CHAT_DIR / "app.js"
            if p.is_file():
                return self._bytes(200, p.read_bytes(), "application/javascript; charset=utf-8")
        if path in ("/", "/index.html"):
            return self._bytes(200, index_html(), "text/html; charset=utf-8")
        return super().do_GET()

    def _projects_post(self, path: str, raw: bytes) -> None:
        try:
            body = json.loads(raw.decode() or "{}")
        except json.JSONDecodeError:
            body = {}
        target = Path(str(body.get("path") or "")).expanduser()
        if path.endswith("/reveal"):
            if not target.is_dir():
                return self._json(400, {"ok": False, "error": "not a folder"})
            cmd = ["open", str(target)] if sys.platform == "darwin" else ["xdg-open", str(target)]
            from gmcommon import run

            run(cmd, timeout=8)
            return self._json(200, {"ok": True, "path": str(target)})
        if path.endswith("/play"):
            if not target.is_dir() or not looks_like_game(target):
                return self._json(400, {"ok": False, "error": "not a game folder"})
            # Default: start server but do not force external tab (dashboard embeds)
            open_tab = bool(body.get("open", False))
            result = start_preview(target)
            if open_tab and result.get("ok") and result.get("url"):
                if sys.platform == "darwin":
                    subprocess.run(["open", result["url"]], check=False)
                else:
                    webbrowser.open(result["url"])
            st = ops.preview_status(target, _PREVIEWS)
            result.update(
                {
                    "up": st.get("up"),
                    "running": st.get("running"),
                    "log_tail": st.get("log_tail"),
                    "error_line": st.get("error_line") or "",
                    "diagnose": st.get("diagnose") or {},
                }
            )
            return self._json(200, result)
        if path.endswith("/terminal"):
            if not target.is_dir():
                return self._json(400, {"ok": False, "error": "not a folder"})
            return self._json(200, ops.open_terminal(target))
        if path.endswith("/restore"):
            return self._json(200, ops.restore_trash(target))
        if path.endswith("/play-status"):
            if not target.is_dir():
                return self._json(400, {"ok": False, "error": "not a folder"})
            return self._json(200, ops.preview_status(target, _PREVIEWS))
        if path.endswith("/verify"):
            if not target.is_dir():
                return self._json(400, {"ok": False, "error": "not a folder"})
            return self._json(200, {"ok": True, "verify": ops.cached_verify(target, force=bool(body.get("force")))})
        if path.endswith("/rename"):
            if not target.is_dir() or not looks_like_game(target):
                return self._json(400, {"ok": False, "error": "not a game folder"})
            new_name = str(body.get("name") or "").strip()
            if not new_name:
                return self._json(400, {"ok": False, "error": "name required"})
            return self._json(200, ops.rename_project(target, new_name))
        if path.endswith("/export"):
            if not target.is_dir() or not looks_like_game(target):
                return self._json(400, {"ok": False, "error": "not a game folder"})
            return self._json(200, ops.export_zip(target))
        if path.endswith("/editor"):
            if not target.is_dir():
                return self._json(400, {"ok": False, "error": "not a folder"})
            return self._json(200, ops.open_editor(target))
        if path.endswith("/session"):
            if not target.is_dir():
                return self._json(400, {"ok": False, "error": "not a folder"})
            if body.get("note"):
                data = ops.session_note(target, str(body.get("kind") or "note"), str(body.get("note")))
                return self._json(200, {"ok": True, "session": data})
            return self._json(200, {"ok": True, "session": ops.load_session(target)})
        if path.endswith("/agent"):
            if not target.is_dir() or not looks_like_game(target):
                return self._json(400, {"ok": False, "error": "not a game folder"})
            prompt = str(body.get("prompt") or body.get("q") or "").strip()
            if not prompt:
                return self._json(400, {"ok": False, "error": "prompt required"})
            return self._json(200, ops.start_agent(target, prompt, model=str(body.get("model") or "")))
        if path.endswith("/repair") or path.endswith("/auto-repair"):
            if not target.is_dir() or not looks_like_game(target):
                return self._json(400, {"ok": False, "error": "not a game folder"})
            return self._json(
                200, ops.auto_repair_play(target, model=str(body.get("model") or ""))
            )
        if path.endswith("/quality-score"):
            if not target.is_dir():
                return self._json(400, {"ok": False, "error": "not a folder"})
            return self._json(200, ops.quality_score(target))
        if path.endswith("/taste"):
            if not target.is_dir() or not looks_like_game(target):
                return self._json(400, {"ok": False, "error": "not a game folder"})
            action = str(body.get("action") or body.get("taste") or "").strip()
            if action not in ("keep", "tighter", "juice", "accept", "tight", "more-juice"):
                return self._json(400, {"ok": False, "error": "action keep|tighter|juice"})
            return self._json(200, ops.taste(target, action))
        if path.endswith("/engine-switch") or path.endswith("/switch-engine"):
            if not target.is_dir() or not looks_like_game(target):
                return self._json(400, {"ok": False, "error": "not a game folder"})
            eng = str(body.get("engine") or "").strip().lower()
            try:
                import engine_ops as eops

                return self._json(
                    200,
                    eops.switch_engine(
                        target,
                        eng,
                        vintage_profile=str(body.get("vintageProfile") or body.get("profile") or "")
                        or None,
                    ),
                )
            except Exception as e:
                return self._json(500, {"ok": False, "error": str(e)})
        if path.endswith("/room") or path.endswith("/one-more-room"):
            if not target.is_dir() or not looks_like_game(target):
                return self._json(400, {"ok": False, "error": "not a game folder"})
            try:
                import engine_ops as eops

                return self._json(200, eops.one_more_room(target))
            except Exception as e:
                return self._json(500, {"ok": False, "error": str(e)})
        if path.endswith("/palette") or path.endswith("/vintage-palette"):
            if not target.is_dir() or not looks_like_game(target):
                return self._json(400, {"ok": False, "error": "not a game folder"})
            try:
                import engine_ops as eops

                return self._json(
                    200,
                    eops.set_vintage_palette(
                        target, str(body.get("palette") or body.get("id") or "dmg")
                    ),
                )
            except Exception as e:
                return self._json(500, {"ok": False, "error": str(e)})
        if path.endswith("/ship-card"):
            if not target.is_dir():
                return self._json(400, {"ok": False, "error": "not a folder"})
            try:
                import engine_ops as eops

                return self._json(200, eops.ship_card(target))
            except Exception as e:
                return self._json(500, {"ok": False, "error": str(e)})
        if path.endswith("/game-ops") or path.endswith("/ops"):
            if not target.is_dir() or not looks_like_game(target):
                return self._json(400, {"ok": False, "error": "not a game folder"})
            try:
                import game_ops as golib

                events = body.get("events") or body.get("ops") or body.get("text") or ""
                if isinstance(events, list):
                    result = golib.apply_ops(target, events, source="api")
                else:
                    result = golib.apply_ops(target, str(events), source="api")
                return self._json(200, result)
            except Exception as e:
                return self._json(500, {"ok": False, "error": str(e)})
        if path.endswith("/new"):
            prompt = str(body.get("prompt") or body.get("name") or "new game").strip()
            name = slugify_project(str(body.get("name") or prompt[:48] or "new-game"))
            dest = projects_root() / name
            dest.mkdir(parents=True, exist_ok=True)
            if any(dest.iterdir()) and not looks_like_game(dest):
                return self._json(409, {"ok": False, "error": "folder exists", "path": str(dest)})
            import scaffold as scaffoldlib

            engine_raw = str(body.get("engine") or "").strip().lower()
            kind = str(body.get("kind") or "auto")
            vprof = str(body.get("vintageProfile") or body.get("vintage_profile") or "").strip().lower() or None
            if vprof and vprof not in ("gb", "gbc", "gba"):
                vprof = None
            # Map UI kind → engine
            if kind == "vintage-game" or engine_raw == "vintage":
                engine = "vintage"
            elif kind == "pixel-game" or engine_raw == "pixel":
                engine = "pixel"
            elif kind == "web-game" or engine_raw == "three":
                engine = "three"
            elif engine_raw in ("three", "pixel", "vintage"):
                engine = engine_raw
            else:
                engine = None  # auto from prompt
            genre_opt = str(body.get("genre") or "").strip() or None
            spec = slicelib.compile_prompt(
                prompt, genre=genre_opt, engine=engine, vintage_profile=vprof
            )
            if kind in ("", "auto"):
                kind = spec["kind"]
            if kind == "vintage-game" or spec.get("engine") == "vintage":
                scaffoldlib.scaffold_vintage_game(
                    dest,
                    spec["title"],
                    prompt=prompt,
                    genre=spec.get("genre"),
                    profile=(spec.get("vintage") or {}).get("profile") or vprof,
                )
                kind = "vintage-game"
            elif kind == "pixel-game" or spec.get("engine") == "pixel":
                scaffoldlib.scaffold_pixel_game(
                    dest, spec["title"], prompt=prompt, genre=spec.get("genre")
                )
                kind = "pixel-game"
            elif kind == "world-game":
                scaffoldlib.scaffold_world_game(dest, spec["title"])
            elif kind == "shader-lab":
                scaffoldlib.scaffold_shader_lab(dest, spec["title"])
            else:
                genre = str(body.get("genre") or spec["genre"])
                scaffoldlib.scaffold_web_game(
                    dest, spec["title"], genre, prompt=prompt, engine="three"
                )
                kind = "web-game"
            try:
                v = ops.cached_verify(dest, force=True)
            except Exception:
                v = {}
            return self._json(
                200,
                {
                    "ok": True,
                    "name": dest.name,
                    "path": str(dest),
                    "genre": spec.get("genre"),
                    "engine": spec.get("engine") or "three",
                    "vintage": spec.get("vintage"),
                    "setting": spec.get("setting"),
                    "verb": spec.get("verb"),
                    "kind": kind,
                    "summary": slicelib.summarize(spec),
                    "verify": v,
                    "iterate": True,
                },
            )
        if path.endswith("/duplicate"):
            if not target.is_dir() or not looks_like_game(target):
                return self._json(400, {"ok": False, "error": "not a game folder"})
            # safety: only under known project roots
            try:
                ok_root = False
                for root in __import__("gmcommon", fromlist=["project_search_roots"]).project_search_roots():
                    try:
                        target.resolve().relative_to(root.resolve())
                        ok_root = True
                        break
                    except ValueError:
                        continue
                if not ok_root:
                    return self._json(400, {"ok": False, "error": "folder not under projects root"})
            except Exception:
                return self._json(400, {"ok": False, "error": "invalid project root"})
            base = slugify_project(target.name + "-copy")
            dest = projects_root() / base
            n = 2
            while dest.exists():
                dest = projects_root() / f"{base}-{n}"
                n += 1
            import shutil

            def _ignore(dirpath: str, names: list[str]) -> set[str]:
                skip = {"node_modules", ".git", "dist", "build", ".vite"}
                return {x for x in names if x in skip}

            shutil.copytree(target, dest, ignore=_ignore)
            return self._json(200, {"ok": True, "name": dest.name, "path": str(dest)})
        if path.endswith("/delete"):
            if not target.is_dir() or not looks_like_game(target):
                return self._json(400, {"ok": False, "error": "not a game folder"})
            hard = bool(body.get("hard"))
            if hard:
                if not ops.under_projects(target):
                    return self._json(403, {"ok": False, "error": "refusing delete outside projects"})
                if target.resolve() in (Path.home().resolve(), ROOT.resolve()):
                    return self._json(403, {"ok": False, "error": "refused"})
                import shutil

                shutil.rmtree(target)
                return self._json(200, {"ok": True, "soft": False, "path": str(target)})
            return self._json(200, ops.soft_delete(target))
        return self._json(404, {"ok": False, "error": "unknown project action"})

    def do_POST(self) -> None:
        path = urlparse(self.path).path
        if path.startswith("/api/github"):
            self._github("POST")
            return
        length = int(self.headers.get("Content-Length", 0))
        body = self.rfile.read(length) if length else b"{}"
        if path.startswith("/api/projects"):
            return self._projects_post(path, body)
        if path == "/api/cloud":
            try:
                payload = json.loads(body.decode() or "{}")
            except json.JSONDecodeError:
                payload = {}
            action = str(payload.get("action") or "").lower()
            try:
                if action == "off":
                    cloudlib.cmd_off()
                elif action == "on":
                    name = str(payload.get("provider") or "grok")
                    code = cloudlib.cmd_on(name)
                    if code != 0:
                        return self._json(400, {"ok": False, "error": f"cloud on {name} failed (key?)"})
                else:
                    return self._json(400, {"ok": False, "error": "action on|off"})
                return self._json(200, {"ok": True, **cloudlib.status_dict()})
            except Exception as e:
                return self._json(500, {"ok": False, "error": str(e)})
        if path == "/api/ask":
            try:
                payload = json.loads(body.decode() or "{}")
            except json.JSONDecodeError:
                payload = {}
            messages = payload.get("messages") or []
            if isinstance(payload.get("q"), str) and payload["q"].strip():
                messages = messages or [{"role": "user", "content": payload["q"]}]
            proj = str(payload.get("project") or "").strip()
            pdir = Path(proj).expanduser() if proj else None
            user_txt = ""
            for m in reversed(messages):
                if m.get("role") == "user":
                    user_txt = str(m.get("content") or "")
                    break
            # Instant craft path — most continues never touch the 30B
            if pdir and pdir.is_dir() and user_txt.strip():
                # Game ops JSON array → host apply (UPF-style)
                if "[" in user_txt and ("set_feel" in user_txt or '"type"' in user_txt):
                    try:
                        import game_ops as golib

                        gops = golib.extract_ops(user_txt)
                        if gops:
                            go = golib.apply_ops(pdir, gops, source="ask")
                            if go.get("ok") or go.get("applied"):
                                try:
                                    ops.session_note(
                                        pdir, "game_ops", user_txt[:200], {"n": go.get("applied")}
                                    )
                                    ops.cached_verify(pdir, force=True)
                                except Exception:
                                    pass
                                lines = [
                                    f"Game ops: {go.get('applied')}/{go.get('total')} applied.",
                                ]
                                for r in go.get("results") or []:
                                    if r.get("ok"):
                                        lines.append(f"· {r.get('type')}: ok")
                                    else:
                                        lines.append(f"· {r.get('type')}: {r.get('error')}")
                                if go.get("context"):
                                    lines.append("\n" + str(go["context"])[:3000])
                                return self._json(
                                    200,
                                    {
                                        "ok": True,
                                        "text": "\n".join(lines),
                                        "written": go.get("written") or [],
                                        "project": proj,
                                        "mode": "game_ops",
                                        "instant": True,
                                        "iterate": True,
                                        "game_ops": go,
                                    },
                                )
                    except Exception:
                        pass
                try:
                    patched = patchlib.try_patch(pdir, user_txt)
                except Exception:
                    patched = None
                if patched and patched.get("ok"):
                    try:
                        ops.session_note(pdir, "craft", user_txt, {"mode": patched.get("mode")})
                        ops.cached_verify(pdir, force=True)
                    except Exception:
                        pass
                    return self._json(
                        200,
                        {
                            "ok": True,
                            "text": patched.get("summary") or "Patched.",
                            "written": patched.get("written") or [],
                            "project": proj,
                            "rejected": "",
                            "mode": patched.get("mode") or "patch",
                            "instant": True,
                            "iterate": True,
                        },
                    )
            route = {"model": MODEL, "num_predict": 4096, "temperature": 0.18, "num_ctx": NUM_CTX}
            try:
                import turbo as turbolib

                route = turbolib.route_task(user_txt or "game continue")
            except Exception:
                pass
            sys_msg = slicelib.ask_system(pdir if pdir and pdir.is_dir() else None, user_txt)
            # Isolate any project blobs already in history
            try:
                import security as seclib

                # keep system clean; user content from wiki-like dumps marked if huge
                cleaned = []
                for m in messages:
                    if m.get("role") == "system":
                        cleaned.append(m)
                        continue
                    c = str(m.get("content") or "")
                    if len(c) > 4000 and "<<<UNTRUSTED" not in c:
                        cleaned.append(
                            {
                                **m,
                                "content": seclib.isolate_untrusted(c, source="chat", max_chars=8000),
                            }
                        )
                    else:
                        cleaned.append(m)
                messages = cleaned
            except Exception:
                pass
            if not messages or messages[0].get("role") != "system":
                messages = [{"role": "system", "content": sys_msg}] + list(messages)
            else:
                messages = [{"role": "system", "content": sys_msg}] + list(messages[1:])
            want_stream = bool(payload.get("stream")) and pdir and pdir.is_dir()
            model_name = payload.get("model") or route.get("model") or MODEL
            temp = float(
                (payload.get("options") or {}).get("temperature", route.get("temperature", 0.18))
            )
            npred = int(
                (payload.get("options") or {}).get("num_predict", route.get("num_predict", 4096))
            )
            nctx = int((payload.get("options") or {}).get("num_ctx", route.get("num_ctx", NUM_CTX)))
            try:
                # Streaming apply: patch as @@ end arrives (perceived latency)
                if want_stream and not cloudlib.active_provider():
                    try:
                        import quality as qualitylib

                        chunks_acc: list[str] = []
                        written_stream: list[str] = []

                        def _on_file(rel: str) -> None:
                            if rel not in written_stream:
                                written_stream.append(rel)

                        def _gen():
                            for piece in cloudlib.ollama_chat_stream(
                                messages,
                                model=model_name,
                                temperature=temp,
                                num_predict=npred,
                                num_ctx=nctx,
                            ):
                                chunks_acc.append(piece)
                                yield piece

                        applied = qualitylib.stream_extract_and_apply(
                            pdir, _gen(), on_file=_on_file
                        )
                        text = "".join(chunks_acc)
                        written = list(applied.get("written") or written_stream)
                        rejected = ""
                        if not written:
                            applied2 = slicelib.apply_model_files(pdir, text)
                            written = list(applied2.get("written") or [])
                            if applied2.get("rejected") and applied2.get("reason") != "no files":
                                rejected = str(applied2.get("reason") or "")
                        note = ""
                        if written:
                            note = "\n\nSaved " + ", ".join(written) + " in " + proj
                        elif proj and rejected:
                            note = "\n\nKept the playable slice (" + rejected + ")."
                        elif proj:
                            note = "\n\nPlayable slice is already in " + proj + ". Click Play."
                        return self._json(
                            200,
                            {
                                "ok": True,
                                "text": text + note,
                                "written": written,
                                "project": proj,
                                "rejected": rejected,
                                "mode": "llm_stream_apply",
                                "instant": False,
                                "streamed": True,
                            },
                        )
                    except Exception:
                        pass  # fall through to non-stream

                text = cloudlib.chat(
                    messages,
                    model=model_name,
                    temperature=temp,
                    num_predict=npred,
                    num_ctx=nctx,
                )
                written: list[str] = []
                rejected = ""
                if pdir and pdir.is_dir():
                    applied = slicelib.apply_model_files(pdir, text)
                    written = list(applied.get("written") or [])
                    if applied.get("rejected") and applied.get("reason") != "no files":
                        rejected = str(applied.get("reason") or "")
                    if written:
                        try:
                            import quality as qualitylib

                            qualitylib.log_accept_pair(
                                pdir,
                                instruction=user_txt[:500],
                                before="",
                                after=text[:40_000],
                                kind="ask_apply",
                                meta={"written": written},
                            )
                        except Exception:
                            pass
                note = ""
                if written:
                    note = "\n\nSaved " + ", ".join(written) + " in " + proj
                elif proj and rejected:
                    note = "\n\nKept the playable slice (" + rejected + "). Ask again, or click Play."
                elif proj:
                    note = "\n\nPlayable slice is already in " + proj + ". Click Play."
                return self._json(
                    200,
                    {
                        "ok": True,
                        "text": text + note,
                        "written": written,
                        "project": proj,
                        "rejected": rejected,
                        "mode": "llm",
                        "instant": False,
                    },
                )
            except Exception as e:
                return self._json(502, {"ok": False, "error": str(e)})
        if path.startswith("/api/chat"):
            try:
                payload = json.loads(body.decode() or "{}")
            except json.JSONDecodeError:
                payload = {}
            if cloudlib.active_provider():
                return self._cloud_chat(payload)
            # Route + slim defaults for streamed chat too
            user_bits = " ".join(
                str(m.get("content") or "") for m in (payload.get("messages") or []) if m.get("role") == "user"
            )
            route = {"model": MODEL, "num_ctx": NUM_CTX, "num_predict": 6144, "temperature": 0.2}
            try:
                import turbo as turbolib

                route = turbolib.route_task(user_bits or "game")
            except Exception:
                pass
            payload.setdefault("model", route.get("model") or MODEL)
            payload["stream"] = True
            opts = payload.get("options") or {}
            opts.setdefault("temperature", route.get("temperature", 0.2))
            opts.setdefault("num_ctx", route.get("num_ctx", NUM_CTX))
            opts.setdefault("num_predict", route.get("num_predict", 6144))
            payload["options"] = opts
            return self._proxy_stream("/api/chat", json.dumps(payload).encode())
        self.send_error(404)


def main() -> int:
    global MODEL
    if not CHAT_DIR.is_dir():
        print(f"Chat-UI missing: {CHAT_DIR}", file=sys.stderr)
        return 1

    print("╔══════════════════════════════════════════╗")
    print(f"║   {PRODUCT} — starting…                    ║")
    print("╚══════════════════════════════════════════╝")

    if cloudlib.active_provider():
        try:
            cloudlib.require_backend()
        except SystemExit as e:
            print(f"❌ {e}")
            return 1
        st = cloudlib.status_dict()
        print(f"✓ Cloud LLM: {st['provider']} · {st['model']}  (paid — `dotlab cloud off` to go local)")
    else:
        if not ensure_ollama(fatal=False):
            print("❌ Ollama not reachable. Open Ollama.app and try again.")
            print("   Download: https://ollama.com")
            print("   Or opt in to a paid model: dotlab cloud on grok")
            return 1
        print("✓ Ollama online")
        try:
            # Rebrand safety: create dotlab* tags from gamemaster* if needed (no re-pull)
            resolved = ensure_product_models()
            if resolved.get("max"):
                MODEL = resolved["max"]
            with urllib.request.urlopen(f"{OLLAMA}/api/tags", timeout=5) as r:
                names = [m.get("name", "") for m in json.loads(r.read()).get("models", [])]
            remember_tags(names, ok=True)
            if not has_model(names, MODEL):
                alt = resolve_model_name(names, MODEL, MODEL_FALLBACKS)
                if alt:
                    MODEL = alt
                    print(f"↻ Using installed model: {MODEL}")
                else:
                    print(f"❌ No local coding model found (wanted '{DEFAULT_MODEL}').")
                    print(f"   Once:  cd {ROOT} && ./install.sh")
                    print(f"   Or:    cd {ROOT} && python3 bin/intervene.py")
                    return 1
            else:
                print(f"✓ Model: {MODEL}")
        except Exception as e:
            print("⚠ Could not list models:", e)
            remember_tags([], ok=False, error=str(e)[:160])

    httpd = ThreadingHTTPServer(("127.0.0.1", PORT), Handler)
    url = f"http://127.0.0.1:{PORT}/?t={int(time.time())}"
    print(f"✓ Dashboard: {url}")
    print("  Instant craft · Play · Projects")
    print("  Leave this terminal open. Stop: Ctrl+C")
    print("")

    def open_browser() -> None:
        time.sleep(0.35)
        webbrowser.open(url)

    def bg_warmup() -> None:
        """Keep flash+max hot (dual keep-alive) so first continue is not cold."""
        if cloudlib.active_provider():
            return
        try:
            import quality as qualitylib

            qualitylib.ensure_dual_warmup(force=False)
            return
        except Exception:
            pass
        try:
            import turbo as turbolib

            model = turbolib.resolve_tier("max")
            turbolib.http_json(
                "/api/chat",
                {
                    "model": model,
                    "messages": [{"role": "user", "content": "OK"}],
                    "stream": False,
                    "keep_alive": "24h",
                    "options": {"num_predict": 2, "temperature": 0, "num_ctx": 2048},
                },
                timeout=180.0,
            )
            print(f"✓ Warm {model} (keep_alive 24h)")
        except Exception as e:
            print(f"  ⚠ warmup: {e}")

    threading.Thread(target=open_browser, daemon=True).start()
    threading.Thread(target=bg_warmup, daemon=True).start()

    try:
        httpd.serve_forever()
    except KeyboardInterrupt:
        print("\nbye.")
    finally:
        httpd.server_close()
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
