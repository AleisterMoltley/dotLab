#!/usr/bin/env python3
"""
Gamemaster Live / Play surface

The game runs *inside* Gamemaster — play and test while AI builds.
No separate terminal workflow required.

- Starts the project dev server (Vite) automatically
- Opens a Play window: full game canvas + optional AI activity drawer
- Click-to-play captures keyboard/mouse for shooters etc.
- File writes stream into the UI; updates apply live (or queue while playing)
- Studio/Agent emit progress; agent subprocess POSTs /api/emit

Usage:
  gamemaster live -p ./my-game
  gamemaster studio build -p ./my-game "..." --live   # default on for build
  gamemaster -p ./my-game --agent "..." --live

Env:
  GAMEMASTER_LIVE_PORT=8767
  GAMEMASTER_GAME_PORT=5173
"""
from __future__ import annotations

import argparse
import json
import os
import signal
import subprocess
import sys
import threading
import time
import webbrowser
from datetime import datetime, timezone
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from queue import Empty, Queue
from typing import Any
from urllib.parse import parse_qs, urlparse

ROOT = Path(__file__).resolve().parent.parent
LIVE_DIR = ROOT / "live"
DEFAULT_LIVE_PORT = int(os.environ.get("GAMEMASTER_LIVE_PORT", "8767"))
DEFAULT_GAME_PORT = int(os.environ.get("GAMEMASTER_GAME_PORT", "5173"))

# Global session used by studio/agent when --live is on
_SESSION: "LiveSession | None" = None


def utc_now() -> str:
    return datetime.now(timezone.utc).isoformat()


class LiveSession:
    def __init__(self, project: Path, live_port: int = DEFAULT_LIVE_PORT, game_port: int = DEFAULT_GAME_PORT):
        self.project = project.resolve()
        self.live_port = live_port
        self.game_port = game_port
        self.state_dir = self.project / ".gamemaster" / "live"
        self.state_dir.mkdir(parents=True, exist_ok=True)
        self.events_path = self.state_dir / "events.jsonl"
        self.status_path = self.state_dir / "status.json"
        self.events: list[dict[str, Any]] = []
        self._id = 0
        self._lock = threading.Lock()
        self._sse_queues: list[Queue] = []
        self.reload_seq = 0
        self.phase = "starting"
        self.headline = "Starting live session…"
        self.detail = "Booting preview server and dashboard"
        self.game_url = f"http://127.0.0.1:{self.game_port}/"
        self.dashboard_url = f"http://127.0.0.1:{self.live_port}/?game={self.game_url}"
        self._game_proc: subprocess.Popen | None = None
        self._http: ThreadingHTTPServer | None = None
        self._http_thread: threading.Thread | None = None
        self._watcher_stop = threading.Event()
        self._watcher: threading.Thread | None = None
        self._last_mtimes: dict[str, float] = {}

    def emit(
        self,
        message: str,
        role: str = "system",
        phase: str | None = None,
        headline: str | None = None,
        detail: str | None = None,
        reload: bool = False,
    ) -> None:
        with self._lock:
            self._id += 1
            ev = {
                "id": self._id,
                "ts": utc_now(),
                "role": role,
                "message": message,
                "phase": phase or self.phase,
                "headline": headline,
                "detail": detail,
                "reload": reload,
            }
            self.events.append(ev)
            if len(self.events) > 500:
                self.events = self.events[-500:]
            if phase:
                self.phase = phase
            if headline:
                self.headline = headline
            if detail:
                self.detail = detail
            if reload:
                self.reload_seq += 1
            try:
                with open(self.events_path, "a", encoding="utf-8") as f:
                    f.write(json.dumps(ev, ensure_ascii=False) + "\n")
            except Exception:
                pass
            self._write_status()
            for q in list(self._sse_queues):
                try:
                    q.put_nowait(ev)
                except Exception:
                    pass
        print(f"  🔴 live[{role}] {message}")

    def _write_status(self) -> None:
        data = {
            "project": str(self.project),
            "phase": self.phase,
            "headline": self.headline,
            "detail": self.detail,
            "game_url": self.game_url,
            "dashboard_url": self.dashboard_url,
            "last_event_id": self._id,
            "reload_seq": self.reload_seq,
            "foot": f"Game: {self.game_url} · Live: {self.dashboard_url}",
            "updated_at": utc_now(),
        }
        try:
            self.status_path.write_text(json.dumps(data, indent=2), encoding="utf-8")
        except Exception:
            pass

    def events_after(self, after_id: int) -> list[dict]:
        with self._lock:
            return [e for e in self.events if (e.get("id") or 0) > after_id]

    def status_dict(self) -> dict:
        with self._lock:
            return {
                "project": str(self.project),
                "phase": self.phase,
                "headline": self.headline,
                "detail": self.detail,
                "game_url": self.game_url,
                "dashboard_url": self.dashboard_url,
                "last_event_id": self._id,
                "reload_seq": self.reload_seq,
                "foot": f"Game: {self.game_url} · keep this window open to play while AI works",
            }

    def subscribe(self) -> Queue:
        q: Queue = Queue()
        with self._lock:
            self._sse_queues.append(q)
        return q

    def unsubscribe(self, q: Queue) -> None:
        with self._lock:
            if q in self._sse_queues:
                self._sse_queues.remove(q)

    def _wait_http(self, url: str, timeout: float = 90.0) -> bool:
        import urllib.request

        end = time.time() + timeout
        while time.time() < end:
            try:
                urllib.request.urlopen(url, timeout=1.2)
                return True
            except Exception:
                time.sleep(0.35)
        return False

    def start_game_server(self) -> None:
        pkg = self.project / "package.json"
        log = self.state_dir / "game-server.log"
        log.parent.mkdir(parents=True, exist_ok=True)
        if pkg.exists():
            if not (self.project / "node_modules").exists():
                self.emit("Installing npm dependencies…", role="system", phase="boot")
                subprocess.run(["npm", "install"], cwd=str(self.project), check=False)
            # prefer vite
            data = json.loads(pkg.read_text(encoding="utf-8"))
            scripts = data.get("scripts") or {}
            if "dev" in scripts:
                cmd = [
                    "npm",
                    "run",
                    "dev",
                    "--",
                    "--host",
                    "127.0.0.1",
                    "--port",
                    str(self.game_port),
                    "--strictPort",
                ]
            else:
                cmd = ["npx", "--yes", "vite", "--host", "127.0.0.1", "--port", str(self.game_port)]
            self.game_url = f"http://127.0.0.1:{self.game_port}/"
        else:
            # static
            self.game_port = int(os.environ.get("GAMEMASTER_GAME_PORT", "8080"))
            cmd = [sys.executable, "-m", "http.server", str(self.game_port), "--bind", "127.0.0.1"]
            self.game_url = f"http://127.0.0.1:{self.game_port}/"

        # if already up, reuse
        if self._wait_http(self.game_url, timeout=1.5):
            self.emit(f"Game server already running at {self.game_url}", role="system", phase="ready")
            return

        f = open(log, "w")
        env = os.environ.copy()
        env["BROWSER"] = "none"
        env["CI"] = "1"
        self._game_proc = subprocess.Popen(
            cmd,
            cwd=str(self.project),
            stdout=f,
            stderr=subprocess.STDOUT,
            env=env,
            start_new_session=True,
        )
        self._game_proc._log = f  # type: ignore
        self.emit(f"Starting game server: {' '.join(cmd)}", role="system", phase="boot")
        if self._wait_http(self.game_url, timeout=100):
            self.emit(f"Game ready — play at {self.game_url}", role="system", phase="ready", reload=True)
        else:
            self.emit(
                f"Game server slow/unavailable ({self.game_url}). Check .gamemaster/live/game-server.log",
                role="system",
                phase="waiting",
            )

    def start_dashboard(self) -> None:
        session = self

        class Handler(BaseHTTPRequestHandler):
            def log_message(self, fmt: str, *args) -> None:
                return

            def _cors(self) -> None:
                self.send_header("Access-Control-Allow-Origin", "*")
                self.send_header("Cache-Control", "no-store")

            def do_OPTIONS(self) -> None:  # noqa: N802
                self.send_response(204)
                self._cors()
                self.end_headers()

            def do_POST(self) -> None:  # noqa: N802
                parsed = urlparse(self.path)
                if parsed.path == "/api/emit":
                    length = int(self.headers.get("Content-Length", 0))
                    raw = self.rfile.read(length) if length else b"{}"
                    try:
                        data = json.loads(raw.decode() or "{}")
                    except json.JSONDecodeError:
                        data = {}
                    session.emit(
                        str(data.get("message") or ""),
                        role=str(data.get("role") or "agent"),
                        phase=data.get("phase"),
                        headline=data.get("headline"),
                        detail=data.get("detail"),
                        reload=bool(data.get("reload")),
                    )
                    body = b'{"ok":true}'
                    self.send_response(200)
                    self.send_header("Content-Type", "application/json")
                    self._cors()
                    self.send_header("Content-Length", str(len(body)))
                    self.end_headers()
                    self.wfile.write(body)
                    return
                self.send_error(404)

            def do_GET(self) -> None:  # noqa: N802
                parsed = urlparse(self.path)
                path = parsed.path
                if path in ("/", "/index.html", "/dashboard"):
                    body = (LIVE_DIR / "dashboard.html").read_bytes()
                    self.send_response(200)
                    self.send_header("Content-Type", "text/html; charset=utf-8")
                    self._cors()
                    self.send_header("Content-Length", str(len(body)))
                    self.end_headers()
                    self.wfile.write(body)
                    return
                if path == "/api/status":
                    data = json.dumps(session.status_dict()).encode()
                    self.send_response(200)
                    self.send_header("Content-Type", "application/json")
                    self._cors()
                    self.send_header("Content-Length", str(len(data)))
                    self.end_headers()
                    self.wfile.write(data)
                    return
                if path == "/api/events":
                    qs = parse_qs(parsed.query)
                    after = int((qs.get("after") or ["0"])[0])
                    data = json.dumps(session.events_after(after)).encode()
                    self.send_response(200)
                    self.send_header("Content-Type", "application/json")
                    self._cors()
                    self.send_header("Content-Length", str(len(data)))
                    self.end_headers()
                    self.wfile.write(data)
                    return
                if path == "/api/stream":
                    self.send_response(200)
                    self.send_header("Content-Type", "text/event-stream")
                    self.send_header("Connection", "keep-alive")
                    self._cors()
                    self.end_headers()
                    q = session.subscribe()
                    try:
                        # send backlog
                        for ev in session.events_after(0)[-50:]:
                            payload = f"data: {json.dumps(ev)}\n\n".encode()
                            self.wfile.write(payload)
                            self.wfile.flush()
                        while True:
                            try:
                                ev = q.get(timeout=15)
                                payload = f"data: {json.dumps(ev)}\n\n".encode()
                                self.wfile.write(payload)
                                self.wfile.flush()
                            except Empty:
                                self.wfile.write(b": keepalive\n\n")
                                self.wfile.flush()
                    except Exception:
                        pass
                    finally:
                        session.unsubscribe(q)
                    return
                self.send_error(404)

        # find free port if busy
        port = self.live_port
        for _ in range(10):
            try:
                self._http = ThreadingHTTPServer(("127.0.0.1", port), Handler)
                self.live_port = port
                break
            except OSError:
                port += 1
        else:
            raise RuntimeError("Could not bind live dashboard port")

        self.dashboard_url = f"http://127.0.0.1:{self.live_port}/?game={self.game_url}"
        os.environ["GAMEMASTER_LIVE_PORT"] = str(self.live_port)
        os.environ["GAMEMASTER_LIVE"] = "1"
        os.environ["GAMEMASTER_LIVE_PROJECT"] = str(self.project)
        self._write_status()

        def serve() -> None:
            assert self._http
            self._http.serve_forever(poll_interval=0.3)

        # non-daemon so session can outlive short main work when joined
        self._http_thread = threading.Thread(target=serve, daemon=True)
        self._http_thread.start()
        self.emit(f"Live dashboard on {self.dashboard_url}", role="system", phase="ready")

    def start_file_watcher(self) -> None:
        def watch() -> None:
            while not self._watcher_stop.is_set():
                changed = []
                for dirpath, dirnames, filenames in os.walk(self.project):
                    dirnames[:] = [
                        d
                        for d in dirnames
                        if d
                        not in (
                            "node_modules",
                            ".git",
                            "dist",
                            "build",
                            ".gamemaster",
                        )
                    ]
                    for name in filenames:
                        if not name.endswith(
                            (".js", ".ts", ".tsx", ".jsx", ".html", ".css", ".json", ".glsl", ".vue")
                        ):
                            continue
                        p = Path(dirpath) / name
                        try:
                            m = p.stat().st_mtime
                        except OSError:
                            continue
                        key = str(p)
                        prev = self._last_mtimes.get(key)
                        if prev is None:
                            self._last_mtimes[key] = m
                        elif m > prev:
                            self._last_mtimes[key] = m
                            try:
                                rel = str(p.relative_to(self.project))
                            except ValueError:
                                rel = key
                            changed.append(rel)
                if changed:
                    # batch
                    shown = ", ".join(changed[:5])
                    more = f" (+{len(changed)-5} more)" if len(changed) > 5 else ""
                    self.emit(
                        f"Files changed: {shown}{more}",
                        role="file",
                        phase=self.phase,
                        reload=True,
                    )
                self._watcher_stop.wait(0.7)

        self._watcher = threading.Thread(target=watch, daemon=True)
        self._watcher.start()

    def open_browser(self) -> None:
        # Prefer a real app window on macOS (brings to front)
        if sys.platform == "darwin":
            try:
                subprocess.run(
                    ["open", self.dashboard_url],
                    check=False,
                    capture_output=True,
                )
                return
            except Exception:
                pass
        webbrowser.open(self.dashboard_url)

    def start(self, open_browser: bool = True) -> None:
        global _SESSION
        _SESSION = self
        # clear old events file for this session
        try:
            self.events_path.write_text("", encoding="utf-8")
        except Exception:
            pass
        self.start_game_server()
        self.start_dashboard()
        self.start_file_watcher()
        self.emit(
            "PLAY SURFACE READY — click the game to capture keyboard/mouse and test immediately. "
            "AI updates apply live (or queue while you play if Auto-update is off).",
            role="system",
            phase="ready",
            headline="Click the game to play",
            detail="No separate start needed — this is your playable build.",
            reload=True,
        )
        if open_browser:
            self.open_browser()
        print(f"\n🎮 PLAY in Gamemaster: {self.dashboard_url}")
        print(f"   (game server: {self.game_url})")
        print("   Click the game panel to play. AI progress is in the side log.\n")

    def stop(self) -> None:
        self.emit("Live session stopping…", role="system", phase="done")
        self._watcher_stop.set()
        if self._http:
            try:
                self._http.shutdown()
            except Exception:
                pass
        if self._game_proc:
            try:
                os.killpg(self._game_proc.pid, signal.SIGTERM)
            except Exception:
                try:
                    self._game_proc.terminate()
                except Exception:
                    pass
            log = getattr(self._game_proc, "_log", None)
            if log:
                try:
                    log.close()
                except Exception:
                    pass
        global _SESSION
        if _SESSION is self:
            _SESSION = None


def get_session() -> LiveSession | None:
    return _SESSION


def emit(*args, **kwargs) -> None:
    """Emit to in-process session, or HTTP POST if agent is a subprocess."""
    s = _SESSION
    if s:
        s.emit(*args, **kwargs)
        return
    # subprocess / external: POST to live dashboard
    message = args[0] if args else kwargs.get("message", "")
    role = args[1] if len(args) > 1 else kwargs.get("role", "agent")
    # support emit(msg, role=...)
    if "role" in kwargs:
        role = kwargs["role"]
    payload = {
        "message": message,
        "role": role,
        "phase": kwargs.get("phase"),
        "headline": kwargs.get("headline"),
        "detail": kwargs.get("detail"),
        "reload": kwargs.get("reload", False),
    }
    port = int(os.environ.get("GAMEMASTER_LIVE_PORT", DEFAULT_LIVE_PORT))
    # try a few ports
    import urllib.error
    import urllib.request

    body = json.dumps(payload).encode()
    for p in range(port, port + 8):
        try:
            req = urllib.request.Request(
                f"http://127.0.0.1:{p}/api/emit",
                data=body,
                headers={"Content-Type": "application/json"},
                method="POST",
            )
            urllib.request.urlopen(req, timeout=1.0)
            return
        except Exception:
            continue


def start_live(project: Path, open_browser: bool = True) -> LiveSession:
    session = LiveSession(project)
    session.start(open_browser=open_browser)
    return session


def main() -> int:
    ap = argparse.ArgumentParser(description="Gamemaster Live preview window")
    ap.add_argument("-p", "--project", required=True, help="Game project directory")
    ap.add_argument("--no-open", action="store_true", help="Do not open browser")
    ap.add_argument("--port", type=int, default=DEFAULT_LIVE_PORT)
    ap.add_argument("--game-port", type=int, default=DEFAULT_GAME_PORT)
    ap.add_argument(
        "--watch",
        action="store_true",
        help="Keep running until Ctrl+C (default)",
    )
    args = ap.parse_args()
    project = Path(args.project).expanduser().resolve()
    if not project.is_dir():
        print(f"❌ Project not found: {project}")
        return 1

    os.environ["GAMEMASTER_LIVE_PORT"] = str(args.port)
    os.environ["GAMEMASTER_GAME_PORT"] = str(args.game_port)

    session = LiveSession(project, live_port=args.port, game_port=args.game_port)
    session.start(open_browser=not args.no_open)
    print("Live running. Press Ctrl+C to stop.")
    try:
        while True:
            time.sleep(1)
    except KeyboardInterrupt:
        print("\nStopping…")
        session.stop()
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
