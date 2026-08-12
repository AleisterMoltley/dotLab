#!/usr/bin/env python3
"""Tiny local server: Chat-UI + Proxy zu Ollama. Kein pip, nur Stdlib."""
from __future__ import annotations

import json
import os
import sys
import threading
import time
import urllib.error
import urllib.request
import webbrowser
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from urllib.parse import parse_qs, urlparse

import github as githublib  # noqa: E402
from gmcommon import CHAT_DIR, DEFAULT_MODEL, OLLAMA, ROOT, ensure_ollama

PORT = int(os.environ.get("GAMEMASTER_PORT", "8765"))
MODEL = os.environ.get("GAMEMASTER_MODEL", DEFAULT_MODEL)
NUM_CTX = int(os.environ.get("GAMEMASTER_NUM_CTX", "65536"))


class Handler(SimpleHTTPRequestHandler):
    def __init__(self, *args, **kwargs):
        super().__init__(*args, directory=str(CHAT_DIR), **kwargs)

    def log_message(self, fmt: str, *args) -> None:
        # quiet
        if args and str(args[0]).startswith('"GET /api'):
            return
        sys.stderr.write("[chat] " + (fmt % args) + "\n")

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

    def _json(self, status: int, data: dict) -> None:
        raw = json.dumps(data).encode()
        self.send_response(status)
        self.send_header("Content-Type", "application/json")
        self.send_header("Cache-Control", "no-store")
        self.send_header("Access-Control-Allow-Origin", "*")
        self.send_header("Content-Length", str(len(raw)))
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
        if self.path.startswith("/api/tags"):
            return self._proxy("/api/tags")
        if self.path in ("/", "/index.html"):
            self.path = "/index.html"
        return super().do_GET()

    def do_POST(self) -> None:
        if urlparse(self.path).path.startswith("/api/github"):
            self._github("POST")
            return
        length = int(self.headers.get("Content-Length", 0))
        body = self.rfile.read(length) if length else b"{}"
        if self.path.startswith("/api/chat"):
            # force stream true for UI
            try:
                payload = json.loads(body.decode() or "{}")
            except json.JSONDecodeError:
                payload = {}
            payload.setdefault("model", MODEL)
            payload["stream"] = True
            opts = payload.get("options") or {}
            opts.setdefault("temperature", 0.2)
            opts.setdefault("num_ctx", NUM_CTX)
            opts.setdefault("num_predict", 16384)
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

    if not ensure_ollama(fatal=False):
        print("❌ Ollama not reachable. Open Ollama.app and try again.")
        print("   Download: https://ollama.com")
        return 1
    print("✓ Ollama online")

    # model check
    try:
        with urllib.request.urlopen(f"{OLLAMA}/api/tags", timeout=5) as r:
            names = [m.get("name", "") for m in json.loads(r.read()).get("models", [])]
        if not any(n == MODEL or n.startswith(MODEL + ":") for n in names):
            print(f"❌ Model '{MODEL}' missing.")
            print(f"   Einmalig:  cd {ROOT} && ./install.sh")
            return 1
    except Exception as e:
        print("⚠ Could not list models:", e)

    httpd = ThreadingHTTPServer(("127.0.0.1", PORT), Handler)
    url = f"http://127.0.0.1:{PORT}/"
    print(f"✓ Chat: {url}")
    print("  Browser will open. Fenster offen lassen. Beenden: Ctrl+C")
    print("")

    def open_browser() -> None:
        time.sleep(0.35)
        webbrowser.open(url)

    threading.Thread(target=open_browser, daemon=True).start()

    try:
        httpd.serve_forever()
    except KeyboardInterrupt:
        print("\nbye.")
    finally:
        httpd.server_close()
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
