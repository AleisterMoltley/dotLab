#!/usr/bin/env python3
"""
Gamemaster Playtest — start dev server, run Playwright, collect metrics + screenshots.

Usage:
  gamemaster playtest -p ./my-game
  gamemaster playtest -p ./my-game --url http://127.0.0.1:5173
  gamemaster playtest -p ./my-game --duration 25 --no-server
  gamemaster playtest -p ./my-game --critic   # run Critic LLM on report

Requires: node + npm (installs playwright into LocalLLM/playtest on first run)
"""
from __future__ import annotations

import argparse
import json
import os
import signal
import subprocess
import sys
import time
import urllib.request
from pathlib import Path

from gmcommon import DEFAULT_MODEL, ROOT, free_tcp_port

PLAYTEST_DIR = ROOT / "playtest"


def ensure_playwright() -> None:
    marker = PLAYTEST_DIR / "node_modules" / "playwright"
    if marker.exists():
        return
    print("→ Installing Playwright (once)…")
    PLAYTEST_DIR.mkdir(parents=True, exist_ok=True)
    subprocess.run(["npm", "install"], cwd=str(PLAYTEST_DIR), check=True)
    # browsers
    subprocess.run(
        ["npx", "playwright", "install", "chromium"],
        cwd=str(PLAYTEST_DIR),
        check=True,
    )
    print("✓ Playwright ready")


def detect_dev_command(project: Path) -> tuple[list[str], int]:
    pkg = project / "package.json"
    if not pkg.exists():
        port = free_tcp_port(8080, 20)
        return ([sys.executable, "-m", "http.server", str(port), "--bind", "127.0.0.1"], port)
    data = json.loads(pkg.read_text(encoding="utf-8"))
    scripts = data.get("scripts") or {}
    if "dev" in scripts:
        # Never reuse a busy 5173 — that playtests someone else's game.
        port = free_tcp_port(5190, 40)
        return (
            [
                "npm",
                "run",
                "dev",
                "--",
                "--host",
                "127.0.0.1",
                "--port",
                str(port),
                "--strictPort",
            ],
            port,
        )
    if "start" in scripts:
        return (["npm", "run", "start"], 8081)
    port = free_tcp_port(8080, 20)
    return ([sys.executable, "-m", "http.server", str(port), "--bind", "127.0.0.1"], port)


def wait_http(url: str, timeout: float = 90.0) -> bool:
    end = time.time() + timeout
    while time.time() < end:
        try:
            urllib.request.urlopen(url, timeout=1.5)
            return True
        except Exception:
            time.sleep(0.4)
    return False


def start_server(project: Path, cmd: list[str]) -> subprocess.Popen:
    log = project / ".gamemaster" / "playtest" / "server.log"
    log.parent.mkdir(parents=True, exist_ok=True)
    f = open(log, "w")
    # ensure deps
    if (project / "package.json").exists() and not (project / "node_modules").exists():
        print("→ npm install in project…")
        subprocess.run(["npm", "install"], cwd=str(project), check=False)
    env = os.environ.copy()
    env["BROWSER"] = "none"
    env["CI"] = "1"
    p = subprocess.Popen(
        cmd,
        cwd=str(project),
        stdout=f,
        stderr=subprocess.STDOUT,
        env=env,
        start_new_session=True,
    )
    p._gf_log = f  # type: ignore
    return p


def stop_server(p: subprocess.Popen | None) -> None:
    if not p:
        return
    try:
        os.killpg(p.pid, signal.SIGTERM)
    except Exception:
        try:
            p.terminate()
        except Exception:
            pass
    try:
        p.wait(timeout=5)
    except Exception:
        try:
            os.killpg(p.pid, signal.SIGKILL)
        except Exception:
            pass
    log = getattr(p, "_gf_log", None)
    if log:
        try:
            log.close()
        except Exception:
            pass


def run_runner(url: str, out: Path, duration: int, actions: str, genre: str = "") -> int:
    env = os.environ.copy()
    env["PLAYTEST_URL"] = url
    env["PLAYTEST_OUT"] = str(out)
    env["PLAYTEST_DURATION_MS"] = str(int(duration * 1000))
    env["PLAYTEST_ACTIONS"] = actions
    if genre:
        env["PLAYTEST_GENRE"] = genre
    r = subprocess.run(
        ["node", str(PLAYTEST_DIR / "runner.mjs")],
        cwd=str(PLAYTEST_DIR),
        env=env,
    )
    return r.returncode


def run_critic_on_report(project: Path, model: str) -> str:
    sys.path.insert(0, str(ROOT / "bin"))
    import studio as studio  # type: ignore
    import prefs as prefs  # type: ignore

    report_md = project / ".gamemaster" / "playtest" / "report.md"
    report_json = project / ".gamemaster" / "playtest" / "report.json"
    body = report_md.read_text(encoding="utf-8") if report_md.exists() else ""
    if report_json.exists():
        body += "\n\n```json\n" + report_json.read_text(encoding="utf-8")[:8000] + "\n```\n"
    pref_block = prefs.format_prompt_block(prefs.load_merged(project))
    design = ""
    if (project / "DESIGN.md").exists():
        design = (project / "DESIGN.md").read_text(encoding="utf-8")[:6000]
    prompt_extra = f"{pref_block}\n\nPLAYTEST REPORT:\n{body}"
    critique = studio.role_critic(
        "Playtest-based review of this game",
        design,
        "See playtest metrics",
        prompt_extra,
        model,
        project=project,
    )
    out = project / ".gamemaster" / "playtest" / "critic.md"
    out.write_text(critique, encoding="utf-8")
    studio.write_session(project, "playtest-critic.md", critique)
    studio.update_design_md(project, "Playtest Critic", critique)
    extracted = prefs.parse_critic_for_prefs(critique)
    ppath = prefs.project_prefs_path(project)
    data = prefs.load_json(ppath)
    prefs.apply_extracted(data, extracted)
    prefs.append_history(data, "playtest-critic", "auto from playtest")
    prefs.save_json(ppath, data)
    g = prefs.load_json(prefs.GLOBAL_PREFS)
    for x in extracted.get("likes") or []:
        prefs.add_unique(g["likes"], x)
    for x in extracted.get("dislikes") or []:
        prefs.add_unique(g["dislikes"], x)
    g["feel"].update(extracted.get("feel") or {})
    prefs.save_json(prefs.GLOBAL_PREFS, g)
    return critique


def main() -> int:
    ap = argparse.ArgumentParser(description="Gamemaster Playwright playtest")
    ap.add_argument("-p", "--project", required=True)
    ap.add_argument("--url", default=None, help="Skip auto URL detection")
    ap.add_argument("--duration", type=int, default=18, help="Seconds to play")
    ap.add_argument("--actions", default="jump,wasd,click")
    ap.add_argument("--no-server", action="store_true", help="Server already running")
    ap.add_argument("--critic", action="store_true", help="LLM critic on report")
    ap.add_argument("-m", "--model", default=DEFAULT_MODEL)
    args = ap.parse_args()

    project = Path(args.project).expanduser().resolve()
    if not project.is_dir():
        print(f"❌ project missing: {project}", file=sys.stderr)
        return 1

    out = project / ".gamemaster" / "playtest"
    out.mkdir(parents=True, exist_ok=True)

    ensure_playwright()

    proc = None
    url = args.url
    try:
        if not args.no_server:
            cmd, port = detect_dev_command(project)
            if not url:
                url = f"http://127.0.0.1:{port}/"
            print(f"→ server: {' '.join(cmd)}")
            print(f"→ url: {url}")
            proc = start_server(project, cmd)
            if not wait_http(url, 100):
                print("❌ Dev server did not become ready. See .gamemaster/playtest/server.log")
                return 2
            print("✓ server up")
        else:
            url = url or "http://127.0.0.1:5173/"
            print(f"→ using existing server {url}")

        print(f"→ playtest {args.duration}s…")
        fam = ""
        try:
            import play_gate as pgl

            fam = pgl.family_of(project)
            if args.actions == "jump,wasd,click":
                args.actions = pgl.actions_for(fam)
        except Exception:
            pass
        code = run_runner(url, out, args.duration, args.actions, genre=fam)
        report_path = out / "report.json"
        if report_path.exists():
            rep = json.loads(report_path.read_text())
            print(f"✓ report → {report_path}")
            print(f"  ok={rep.get('ok')} shots={len(rep.get('screenshots') or [])}")
            print(f"  rubric={json.dumps(rep.get('rubricHints'), ensure_ascii=False)}")
            if rep.get("metrics"):
                print(f"  metrics keys={list(rep['metrics'].keys())[:12]}")
            try:
                import play_gate as pgl

                pr = pgl.evaluate_report(rep, family=pgl.family_of(project))
                print(pr.get("report") or "")
                (out / "play-p0.txt").write_text(pr.get("report") or "", encoding="utf-8")
                if pr.get("p0_fail"):
                    pgl.apply_metric_fixes(project, pr)
            except Exception as e:
                print(f"  ⚠ play-p0: {e}")
        else:
            print("⚠ no report.json")

        if args.critic:
            print("→ critic on playtest…")
            try:
                from pathlib import Path as P

                sys.path.insert(0, str(ROOT / "bin"))
                critique = run_critic_on_report(project, args.model)
                print(critique[:2000])
            except Exception as e:
                print(f"⚠ critic failed: {e}")

        return 0 if code == 0 else code
    finally:
        stop_server(proc)


if __name__ == "__main__":
    raise SystemExit(main())
