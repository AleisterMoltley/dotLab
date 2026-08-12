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
from gmcommon import (
    CHAT_DIR,
    DEFAULT_MODEL,
    OLLAMA,
    ROOT,
    ensure_ollama,
    free_tcp_port,
    list_game_projects,
    looks_like_game,
    projects_root,
    slugify_project,
)

PORT = int(os.environ.get("GAMEMASTER_PORT", "8765"))
MODEL = os.environ.get("GAMEMASTER_MODEL", DEFAULT_MODEL)
# Prefill dominates wall time — 16k default, not 65k
NUM_CTX = int(os.environ.get("GAMEMASTER_NUM_CTX", "16384"))

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
    log = project / ".gamemaster" / "play.log"
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
    return {"ok": ok, "url": url, "path": key, "reused": False, "log": str(log)}


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
    return any(n == model or n.startswith(model + ":") for n in names)


def status_label(h: dict | None = None) -> tuple[bool, str]:
    h = h or health_payload()
    if h.get("backend") == "cloud" and h.get("ok"):
        return True, f"cloud · {h.get('provider') or ''} · {h.get('model') or ''} · paid"
    if h.get("ok"):
        return True, f"online · {h.get('model') or MODEL} · $0"
    if not h.get("ollama"):
        return False, "Ollama not answering — open Ollama.app"
    return False, "Model missing — ./install.sh"


def index_html() -> bytes:
    raw = (CHAT_DIR / "index.html").read_text(encoding="utf-8")
    ok, label = status_label()
    klass = "ok" if ok else "bad"
    raw = raw.replace(
        '<span class="dot" id="dot"></span>',
        f'<span class="dot {klass}" id="dot"></span>',
        1,
    )
    raw = raw.replace(">starting…</span>", f">{label}</span>", 1)
    return raw.encode()


def health_payload() -> dict:
    """Instant. Never talks to Ollama — tags are cached at process start."""
    cloud = cloudlib.status_dict()
    if cloud.get("enabled"):
        return {
            "ok": True,
            "backend": "cloud",
            "provider": cloud.get("provider") or "",
            "model": cloud.get("model") or "",
            "ollama": False,
            "has_model": True,
            "local": False,
            "error": "",
        }
    names = list(_TAGS.get("names") or [])
    found = has_model(names, MODEL)
    ollama_ok = bool(_TAGS.get("ok")) or bool(names)
    return {
        "ok": bool(found),
        "backend": "ollama",
        "provider": "",
        "model": MODEL,
        "ollama": ollama_ok,
        "has_model": found,
        "local": True,
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
            return self._json(200, {"root": str(projects_root()), "projects": list_game_projects()})
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
            result = start_preview(target)
            if result.get("ok") and result.get("url"):
                if sys.platform == "darwin":
                    subprocess.run(["open", result["url"]], check=False)
                else:
                    webbrowser.open(result["url"])
            return self._json(200, result)
        if path.endswith("/new"):
            prompt = str(body.get("prompt") or body.get("name") or "new game").strip()
            name = slugify_project(str(body.get("name") or prompt[:48] or "new-game"))
            dest = projects_root() / name
            dest.mkdir(parents=True, exist_ok=True)
            if any(dest.iterdir()) and not looks_like_game(dest):
                return self._json(409, {"ok": False, "error": "folder exists", "path": str(dest)})
            import scaffold as scaffoldlib

            spec = slicelib.compile_prompt(prompt)
            kind = str(body.get("kind") or "auto")
            if kind in ("", "auto"):
                kind = spec["kind"]
            if kind == "pixel-game":
                scaffoldlib.scaffold_pixel_game(dest, spec["title"])
            elif kind == "world-game":
                scaffoldlib.scaffold_world_game(dest, spec["title"])
            elif kind == "shader-lab":
                scaffoldlib.scaffold_shader_lab(dest, spec["title"])
            else:
                genre = str(body.get("genre") or spec["genre"])
                scaffoldlib.scaffold_web_game(dest, spec["title"], genre, prompt=prompt)
            return self._json(
                200,
                {
                    "ok": True,
                    "name": dest.name,
                    "path": str(dest),
                    "genre": spec.get("genre"),
                    "setting": spec.get("setting"),
                    "verb": spec.get("verb"),
                    "kind": kind,
                    "summary": slicelib.summarize(spec),
                },
            )
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
                try:
                    patched = patchlib.try_patch(pdir, user_txt)
                except Exception:
                    patched = None
                if patched and patched.get("ok"):
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
                        },
                    )
            route = {"model": MODEL, "num_predict": 4096, "temperature": 0.18, "num_ctx": NUM_CTX}
            try:
                import turbo as turbolib

                route = turbolib.route_task(user_txt or "game continue")
            except Exception:
                pass
            sys_msg = slicelib.ask_system(pdir if pdir and pdir.is_dir() else None, user_txt)
            if not messages or messages[0].get("role") != "system":
                messages = [{"role": "system", "content": sys_msg}] + list(messages)
            else:
                messages = [{"role": "system", "content": sys_msg}] + list(messages[1:])
            try:
                text = cloudlib.chat(
                    messages,
                    model=payload.get("model") or route.get("model") or MODEL,
                    temperature=float(
                        (payload.get("options") or {}).get("temperature", route.get("temperature", 0.18))
                    ),
                    num_predict=int(
                        (payload.get("options") or {}).get("num_predict", route.get("num_predict", 4096))
                    ),
                    num_ctx=int((payload.get("options") or {}).get("num_ctx", route.get("num_ctx", NUM_CTX))),
                )
                written: list[str] = []
                rejected = ""
                if pdir and pdir.is_dir():
                    applied = slicelib.apply_model_files(pdir, text)
                    written = list(applied.get("written") or [])
                    if applied.get("rejected") and applied.get("reason") != "no files":
                        rejected = str(applied.get("reason") or "")
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
    if not CHAT_DIR.is_dir():
        print(f"Chat-UI missing: {CHAT_DIR}", file=sys.stderr)
        return 1

    print("╔══════════════════════════════════════════╗")
    print("║   Gamemaster — startet…        ║")
    print("╚══════════════════════════════════════════╝")

    if cloudlib.active_provider():
        try:
            cloudlib.require_backend()
        except SystemExit as e:
            print(f"❌ {e}")
            return 1
        st = cloudlib.status_dict()
        print(f"✓ Cloud LLM: {st['provider']} · {st['model']}  (paid — `gamemaster cloud off` to go local)")
    else:
        if not ensure_ollama(fatal=False):
            print("❌ Ollama not reachable. Open Ollama.app and try again.")
            print("   Download: https://ollama.com")
            print("   Or opt in to a paid model: gamemaster cloud on grok")
            return 1
        print("✓ Ollama online")
        try:
            with urllib.request.urlopen(f"{OLLAMA}/api/tags", timeout=5) as r:
                names = [m.get("name", "") for m in json.loads(r.read()).get("models", [])]
            remember_tags(names, ok=True)
            if not has_model(names, MODEL):
                print(f"❌ Model '{MODEL}' missing.")
                print(f"   Einmalig:  cd {ROOT} && ./install.sh")
                return 1
        except Exception as e:
            print("⚠ Could not list models:", e)
            remember_tags([], ok=False, error=str(e)[:160])

    httpd = ThreadingHTTPServer(("127.0.0.1", PORT), Handler)
    url = f"http://127.0.0.1:{PORT}/?t={int(time.time())}"
    print(f"✓ Chat: {url}")
    print("  Instant craft: feel/enemies/palette — no model wait")
    print("  Browser will open. Fenster offen lassen. Beenden: Ctrl+C")
    print("")

    def open_browser() -> None:
        time.sleep(0.35)
        webbrowser.open(url)

    def bg_warmup() -> None:
        """Keep max model hot so first LLM continue is not a cold load."""
        if cloudlib.active_provider():
            return
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
