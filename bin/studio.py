#!/usr/bin/env python3
"""
Gamemaster STUDIO — Multi-Agent Game Production (local, $0)

Roles (consult + execute), inspired by Cursor/Codex multi-agent + Grok design taste:

  🎬 Director   — fun-first design, pillars, vertical slice
  🏗️ Architect  — modules, files, data flow, tech choices
  💻 Coder      — implements with file tools (reuses agent loop)
  🧪 Critic     — playtest rubric, bugs, feel issues, kills scope creep
  ⚖️ Council    — best-of-N designs → debate → winner

Modes:
  studio plan     — Director + Architect only (docs)
  studio build    — full pipeline plan→code→critique→fix
  studio council  — 3 design pitches + vote + optional build
  studio review   — Critic on existing project
  studio parallel — split workstreams (player / world / ui) then integrate

All Ollama. No cloud credits.
"""
from __future__ import annotations

import argparse
import json
import os
import re
import sys
import time
import urllib.error
import urllib.request
from concurrent.futures import ThreadPoolExecutor, as_completed
from datetime import datetime, timezone
from pathlib import Path

# Reuse agent tools + prefs
sys.path.insert(0, str(Path(__file__).resolve().parent))
import agent as agentlib  # noqa: E402
import prefs as prefslib  # noqa: E402

ROOT = Path(__file__).resolve().parent.parent
OLLAMA = os.environ.get("OLLAMA_HOST", "http://127.0.0.1:11434").rstrip("/")
DEFAULT_MODEL = os.environ.get("GAMEMASTER_MODEL", "gamemaster")
DENSE_MODEL = os.environ.get("GAMEMASTER_DENSE", "gamemaster-dense")
NUM_CTX = int(os.environ.get("GAMEMASTER_NUM_CTX", "65536"))


def pref_block(project: Path | None) -> str:
    try:
        return prefslib.format_prompt_block(prefslib.load_merged(project))
    except Exception:
        return ""


def learn_from_critic(project: Path, critique: str) -> None:
    """Write critic insights into preference memory."""
    try:
        extracted = prefslib.parse_critic_for_prefs(critique)
        path = prefslib.project_prefs_path(project)
        data = prefslib.load_json(path)
        prefslib.apply_extracted(data, extracted)
        prefslib.append_history(data, "studio-critic", "auto-learn")
        prefslib.save_json(path, data)
        g = prefslib.load_json(prefslib.GLOBAL_PREFS)
        for x in extracted.get("likes") or []:
            prefslib.add_unique(g["likes"], x)
        for x in extracted.get("dislikes") or []:
            prefslib.add_unique(g["dislikes"], x)
        g["feel"].update(extracted.get("feel") or {})
        prefslib.append_history(g, "studio-critic-global", "sync")
        prefslib.save_json(prefslib.GLOBAL_PREFS, g)
        print("  🧠 prefs updated from critic")
    except Exception as e:
        print(f"  ⚠ prefs learn failed: {e}")


def run_playtest(project: Path, model: str, with_critic: bool = True) -> None:
    banner("🎮 PLAYTEST (Playwright)")
    cmd = [
        sys.executable,
        str(ROOT / "bin" / "playtest.py"),
        "-p",
        str(project),
        "--duration",
        "15",
    ]
    if with_critic:
        cmd += ["--critic", "-m", model]
    subprocess_run = __import__("subprocess").run
    r = subprocess_run(cmd)
    if r.returncode != 0:
        print(f"  ⚠ playtest exit {r.returncode} (report may still exist)")
    else:
        print("  ✓ playtest finished")


def chat(
    messages: list[dict],
    model: str,
    temperature: float = 0.35,
    num_predict: int = 4096,
    num_ctx: int | None = None,
) -> str:
    # Prefer mid context for studio roles (faster prefill); override via env
    ctx = num_ctx if num_ctx is not None else min(NUM_CTX, 32768)
    payload = {
        "model": model,
        "messages": messages,
        "stream": False,
        "keep_alive": "24h",
        "options": {
            "temperature": temperature,
            "num_ctx": ctx,
            "num_predict": num_predict,
            "num_batch": 512,
        },
    }
    data = json.dumps(payload).encode()
    req = urllib.request.Request(
        f"{OLLAMA}/api/chat",
        data=data,
        headers={"Content-Type": "application/json"},
        method="POST",
    )
    with urllib.request.urlopen(req, timeout=600) as r:
        res = json.loads(r.read().decode())
    return (res.get("message") or {}).get("content") or ""


def ensure_ollama() -> None:
    try:
        urllib.request.urlopen(f"{OLLAMA}/api/tags", timeout=2)
    except Exception:
        if sys.platform == "darwin":
            os.system("open -a Ollama >/dev/null 2>&1")
            for _ in range(40):
                time.sleep(0.35)
                try:
                    urllib.request.urlopen(f"{OLLAMA}/api/tags", timeout=2)
                    return
                except Exception:
                    pass
        raise SystemExit("Ollama not reachable")


def load_pack(*names: str, limit: int = 6000) -> str:
    chunks = []
    for n in names:
        p = ROOT / "knowledge" / n
        if p.exists():
            chunks.append(f"## {n}\n{p.read_text(encoding='utf-8')[:limit]}")
    return "\n\n".join(chunks)


def banner(title: str) -> None:
    print("\n" + "═" * 56)
    print(title)
    print("═" * 56)
    try:
        import live as livelib  # type: ignore

        livelib.emit(title, role="system", phase="studio", headline=title.strip())
    except Exception:
        pass


def write_session(project: Path, name: str, content: str) -> Path:
    d = project / ".gamemaster" / "studio"
    d.mkdir(parents=True, exist_ok=True)
    path = d / name
    path.write_text(content, encoding="utf-8")
    print(f"  💾 {path.relative_to(project)}")
    return path


def update_design_md(project: Path, section: str, body: str) -> None:
    path = project / "DESIGN.md"
    stamp = datetime.now(timezone.utc).strftime("%Y-%m-%d %H:%M UTC")
    block = f"\n\n## Studio · {section} ({stamp})\n\n{body.strip()}\n"
    if path.exists():
        path.write_text(path.read_text(encoding="utf-8") + block, encoding="utf-8")
    else:
        path.write_text(f"# DESIGN\n{block}", encoding="utf-8")
    print(f"  📝 DESIGN.md += {section}")


# ── Roles ──────────────────────────────────────────────────────────────

def role_director(
    brief: str, model: str, genre_hint: str = "", prefs: str = "", project: Path | None = None
) -> str:
    knowledge = load_pack(
        "craft-taste.md",
        "pair-partner.md",
        "feel-tables.md",
        "game-genres.md",
        "readable-spaces.md",
        limit=3200,
    )
    prefs = prefs or pref_block(project)
    sys_p = (
        "You are DIRECTOR in Gamemaster Studio — pair-partner with elite taste.\n"
        "Engine is Three.js. Worlds have lighting, NPCs, and a reason to walk.\n"
        "Be opinionated: 'The fun is X. We cut Y.' Do not take every feature request.\n"
        "Honor USER PREFERENCE MEMORY when present.\n"
        "Output MUST include:\n"
        "1) Pitch (2 sentences) — sharper than the brief\n"
        "2) Core Verb + what the player does at t=8s\n"
        "3) 3 Design Pillars\n"
        "4) Vertical Slice (playable in one session)\n"
        "5) Feel targets — REAL numbers from the feel tables (grav, coyote, camLag…)\n"
        "6) World beat (place + 1 NPC/dialogue or bark + 1 physical toy + 1 shader accent)\n"
        "7) First room / first death (how it teaches, why it's fair)\n"
        "8) Explicit NON-goals (what we will NOT build)\n"
        "9) Success metric: 'one more run?' test\n"
        "If target is Solana Seeker: same Three.js game + MWA; loop must work offline.\n"
    )
    user = (
        f"Brief:\n{brief}\n\nGenre-Note: {genre_hint or 'auto'}\n\n"
        f"{prefs}\n\n{knowledge}"
    )
    return chat(
        [{"role": "system", "content": sys_p}, {"role": "user", "content": user}],
        model=model,
        temperature=0.55,
        num_predict=3500,
    )


def role_architect(
    brief: str,
    design: str,
    model: str,
    project_tree: str,
    prefs: str = "",
    project: Path | None = None,
) -> str:
    knowledge = load_pack(
        "game-systems.md",
        "feel-tables.md",
        "threejs-cheatsheet.md",
        "physics-ragdoll.md",
        "readable-spaces.md",
        "solana-seeker.md",
        limit=3000,
    )
    prefs = prefs or pref_block(project)
    sys_p = (
        "You are ARCHITECT in Gamemaster Studio.\n"
        "ENGINE IS THREE.JS (Vite + vanilla ES modules). Never Unity/Godot/Phaser/R3F unless user named them.\n"
        "Seeker = same Three.js game + Mobile Wallet Adapter (wallet is not the product).\n"
        "Plan modules, files, data flow. No code except signatures/sketches.\n"
        "Honor USER PREFERENCE MEMORY (tech/feel).\n"
        "A complete slice needs: loop, input, camera, world/lighting, physics path (arcade OR Rapier),\n"
        "plus at least one of {dialogue tree, ragdoll, shader FX}.\n"
        "Output:\n"
        "1) Tech stack (Three.js + optional Rapier / MWA) + why\n"
        "2) File tree (exact paths under src/)\n"
        "3) Module responsibilities (player, world, physics, narrative, fx, ui)\n"
        "4) Data flow (input→fixedUpdate→mixer→render)\n"
        "5) Implementation order (checklist, max 8 steps)\n"
        "6) Risks / perf notes (no alloc in loop, instance props, shadow budget)\n"
        "English, precise.\n"
    )
    user = (
        f"Brief:\n{brief}\n\nDesign (Director):\n{design}\n\n"
        f"Existing project tree:\n{project_tree or '(empty)'}\n\n{prefs}\n\n{knowledge}"
    )
    return chat(
        [{"role": "system", "content": sys_p}, {"role": "user", "content": user}],
        model=model,
        temperature=0.25,
        num_predict=4000,
    )


def role_critic(
    brief: str,
    design: str,
    architecture: str,
    code_summary: str,
    model: str,
    prefs: str = "",
    project: Path | None = None,
) -> str:
    knowledge = load_pack(
        "craft-taste.md",
        "pair-partner.md",
        "playtest-harness.md",
        "game-systems.md",
        limit=3500,
    )
    prefs = prefs or pref_block(project)
    sys_p = (
        "You are CRITIC / PLAYTESTER in Gamemaster Studio — strict but constructive.\n"
        "Judge fun, fairness, clarity, scope, feel. Find bugs and boredom.\n"
        "A gray plane + cube is a FAIL. Worlds need light, collision, and a living beat.\n"
        "If they added systems instead of tuning CONFIG, say so. Protect the verb.\n"
        "Ask: controls <10s? first death fair? juice on hit? next goal obvious? one more run?\n"
        "If PLAYTEST METRICS exist: prioritize empirical data (FPS, errors, death→retry).\n"
        "Output:\n"
        "1) Severity list (P0/P1/P2) — max 8 findings\n"
        "2) Feel verdict (1–10) + why\n"
        "3) Must-fix now (top 3)\n"
        "4) Kill list (what to cut)\n"
        "5) One golden tweak that would 2x fun\n"
        "English.\n"
    )
    user = (
        f"Brief:\n{brief}\n\nDesign:\n{design}\n\nArchitecture:\n{architecture}\n\n"
        f"Code/Implementation/Playtest summary:\n{code_summary}\n\n{prefs}\n\n{knowledge}"
    )
    return chat(
        [{"role": "system", "content": sys_p}, {"role": "user", "content": user}],
        model=model,
        temperature=0.4,
        num_predict=3000,
    )


def role_pitch_variant(
    brief: str, model: str, seed: int, prefs: str = "", project: Path | None = None
) -> str:
    # Slim packs only — council is latency-bound (3× parallel)
    knowledge = load_pack("craft-taste.md", "feel-tables.md", "game-genres.md", limit=2200)
    prefs = prefs or pref_block(project)
    sys_p = (
        f"You are DIRECTOR variant #{seed}. Create ONE sharp, unique game pitch.\n"
        "Differentiate strongly from generic ideas. 1 core verb. Vertical slice only.\n"
        "Honor USER PREFERENCE MEMORY.\n"
        "Format: PITCH / VERB / t=8s / PILLARS (3) / SLICE / FEEL NUMBERS / FIRST DEATH / HOOK\n"
        "English. Max 400 words. Be opinionated.\n"
    )
    # Prefer max MoE for quality; flash only if max unavailable
    pitch_model = model
    try:
        import turbo as turbolib  # type: ignore

        pitch_model = turbolib.resolve_tier("max")
    except Exception:
        pass
    return chat(
        [
            {"role": "system", "content": sys_p},
            {"role": "user", "content": f"Brief: {brief}\n\n{prefs}\n\n{knowledge}"},
        ],
        model=pitch_model,
        temperature=0.7 + seed * 0.05,
        num_predict=1200,
    )


def role_council_vote(brief: str, pitches: list[str], model: str) -> str:
    joined = "\n\n---\n\n".join(f"### Option {i+1}\n{p}" for i, p in enumerate(pitches))
    sys_p = (
        "You are STUDIO HEAD. Pick the best option for maximum fun + shippability.\n"
        "Output:\n"
        "WINNER: N\n"
        "WHY: ...\n"
        "MERGED IMPROVEMENTS: was von Verlierern stehlen\n"
        "FINAL BRIEF: one paragraph execution brief for Architect+Coder\n"
    )
    return chat(
        [
            {"role": "system", "content": sys_p},
            {"role": "user", "content": f"User brief: {brief}\n\n{joined}"},
        ],
        model=model,
        temperature=0.3,
        num_predict=2500,
    )


def project_tree_summary(project: Path, max_files: int = 80) -> str:
    lines = []
    count = 0
    for dirpath, dirnames, filenames in os.walk(project):
        dirnames[:] = [
            d
            for d in dirnames
            if d not in ("node_modules", ".git", "dist", "build", ".gamemaster")
        ]
        rel = Path(dirpath).relative_to(project)
        for name in sorted(filenames):
            if name.startswith("."):
                continue
            lines.append(str(rel / name) if str(rel) != "." else name)
            count += 1
            if count >= max_files:
                return "\n".join(lines) + "\n…"
    return "\n".join(lines) if lines else "(empty project)"


def run_coder_agent(project: Path, task: str, model: str, steps: int = 16) -> str:
    """Invoke implementer via agent.py subprocess for isolation."""
    import subprocess

    pb = pref_block(project)
    if pb:
        task = f"{pb}\n\n{task}"
    cmd = [
        sys.executable,
        str(ROOT / "bin" / "agent.py"),
        "-p",
        str(project),
        "-m",
        model,
        "--steps",
        str(steps),
        task,
    ]
    # inherit live session via env so agent can emit + share dashboard
    env = os.environ.copy()
    env["GAMEMASTER_LIVE"] = "1"
    env["GAMEMASTER_LIVE_PROJECT"] = str(project)
    print(f"  💻 Coder agent starting…")
    try:
        import live as livelib  # type: ignore

        livelib.emit(
            "Coder agent starting — watch the game panel for reloads as files are written.",
            role="coder",
            phase="coding",
            headline="Coder at work",
            detail="Play on the left while files are written.",
        )
    except Exception:
        pass
    p = subprocess.run(cmd, capture_output=True, text=True, env=env)
    out = (p.stdout or "") + (p.stderr or "")
    # stream key lines to live
    try:
        import live as livelib  # type: ignore

        for line in out.splitlines():
            if any(
                k in line
                for k in (
                    "write_file",
                    "OK wrote",
                    "DONE",
                    "Schritt",
                    "ERROR",
                    "Schritt",
                    "wrote",
                )
            ):
                livelib.emit(line.strip()[:300], role="coder", phase="coding")
    except Exception:
        pass
    return out[-12000:]


def parallel_streams(
    project: Path,
    design: str,
    architecture: str,
    model: str,
    streams: list[tuple[str, str]],
) -> dict[str, str]:
    """
    streams: list of (name, task_prompt)
    Run coder agents sequentially if only one model GPU, or parallel threads
    (Ollama queues; parallel still helps overlapping IO).
    """
    results: dict[str, str] = {}

    def work(item: tuple[str, str]) -> tuple[str, str]:
        name, task = item
        full = (
            f"CONTEXT DESIGN:\n{design[:3000]}\n\nARCHITECTURE:\n{architecture[:3000]}\n\n"
            f"YOUR STREAM ONLY: {name}\n"
            f"Do not rewrite unrelated files. Task:\n{task}"
        )
        return name, run_coder_agent(project, full, model, steps=12)

    # On unified memory, parallel ollama can thrash — default 2 workers
    workers = int(os.environ.get("GAMEMASTER_PARALLEL", "2"))
    with ThreadPoolExecutor(max_workers=max(1, workers)) as ex:
        futs = [ex.submit(work, s) for s in streams]
        for fut in as_completed(futs):
            name, out = fut.result()
            results[name] = out
            print(f"  ✓ stream done: {name}")
    return results


# ── Pipelines ─────────────────────────────────────────────────────────

def pipeline_plan(project: Path, brief: str, model: str) -> dict:
    pb = pref_block(project)
    if pb:
        print("  🧠 preference memory active")
    banner("🎬 DIRECTOR")
    try:
        import live as livelib

        livelib.emit(
            f"Director designing: {brief[:160]}",
            role="director",
            phase="design",
            headline="Director designing…",
            detail="Fun-first pitch, pillars, feel numbers",
        )
    except Exception:
        pass
    design = role_director(brief, model, project=project, prefs=pb)
    print(design[:2500] + ("…" if len(design) > 2500 else ""))
    write_session(project, "01-director.md", design)
    update_design_md(project, "Director", design)
    try:
        import live as livelib

        livelib.emit("Director finished — design saved to DESIGN.md", role="director", phase="design")
    except Exception:
        pass

    banner("🏗️ ARCHITECT")
    try:
        import live as livelib

        livelib.emit(
            "Architect planning modules and file tree…",
            role="architect",
            phase="architecture",
            headline="Architect planning…",
            detail="Tech stack + implementation order",
        )
    except Exception:
        pass
    tree = project_tree_summary(project)
    arch = role_architect(brief, design, model, tree, project=project, prefs=pb)
    print(arch[:2500] + ("…" if len(arch) > 2500 else ""))
    write_session(project, "02-architect.md", arch)
    update_design_md(project, "Architect", arch)
    try:
        import live as livelib

        livelib.emit("Architect finished — ready to code", role="architect", phase="architecture")
    except Exception:
        pass
    return {"design": design, "architecture": arch}


def pipeline_build(
    project: Path,
    brief: str,
    model: str,
    skip_plan: bool = False,
    do_playtest: bool = False,
    do_live: bool = False,
) -> None:
    live_session = None
    if do_live:
        try:
            import live as livelib

            live_session = livelib.start_live(project, open_browser=True)
            live_session.emit(
                f"Studio BUILD started: {brief[:200]} — click the game to play/test anytime.",
                role="system",
                phase="boot",
                headline="Build running — play when ready",
                detail="Click the game canvas for keyboard/mouse. Updates apply live.",
            )
        except Exception as e:
            print(f"  ⚠ live preview failed to start: {e}")

    if skip_plan:
        design = (project / ".gamemaster" / "studio" / "01-director.md").read_text() if (
            project / ".gamemaster" / "studio" / "01-director.md"
        ).exists() else brief
        arch = (project / ".gamemaster" / "studio" / "02-architect.md").read_text() if (
            project / ".gamemaster" / "studio" / "02-architect.md"
        ).exists() else ""
        if not arch:
            data = pipeline_plan(project, brief, model)
            design, arch = data["design"], data["architecture"]
    else:
        data = pipeline_plan(project, brief, model)
        design, arch = data["design"], data["architecture"]

    banner("💻 CODER")
    task = (
        f"Implement the vertical slice ONLY.\n\nUSER BRIEF:\n{brief}\n\n"
        f"DESIGN:\n{design[:4000]}\n\nARCHITECTURE:\n{arch[:4000]}\n\n"
        "Write complete runnable files. ENGINE: Vite + three.js always. "
        "If Seeker: same Three.js game + MWA module — do not replace the engine. "
        "Ship a place (lights/fog/ground), a body (controller+camera), collision, "
        "and at least one of: dialogue tree, ragdoll/physics toy, shader accent. "
        "No Vector3 allocs in the loop. CONFIG from feel tables (real numbers, not 1/1/1). "
        "src/fx/juice.js with hitstop+punch+blip; call it from damage. "
        "Include optional window.__GF_PLAYTEST__ hooks: recordDeath/recordRestart/recordJump if easy. "
        "Update DESIGN.md backlog checkboxes if present. End with done."
    )
    code_out = run_coder_agent(project, task, model, steps=18)
    write_session(project, "03-coder-log.txt", code_out)
    print(code_out[-2000:])

    banner("🧪 CRITIC")
    critic_model = model
    try:
        tags = json.loads(
            urllib.request.urlopen(f"{OLLAMA}/api/tags", timeout=5).read().decode()
        )
        names = [m.get("name", "") for m in tags.get("models", [])]
        if any(n == DENSE_MODEL or n.startswith(DENSE_MODEL + ":") for n in names):
            critic_model = DENSE_MODEL
    except Exception:
        pass

    critique = role_critic(
        brief, design, arch, code_out[-6000:], critic_model, project=project
    )
    print(critique[:2500])
    write_session(project, "04-critic.md", critique)
    update_design_md(project, "Critic", critique)
    learn_from_critic(project, critique)

    banner("🔧 FIX PASS (from Critic top items)")
    fix_task = (
        f"Apply ONLY the Critic's top must-fix items. Do not add features.\n\n"
        f"CRITIC REPORT:\n{critique}\n\nKeep the game runnable."
    )
    fix_out = run_coder_agent(project, fix_task, model, steps=12)
    write_session(project, "05-fix-log.txt", fix_out)
    print(fix_out[-1500:])

    if do_playtest:
        run_playtest(project, model, with_critic=True)

    banner("✅ STUDIO BUILD COMPLETE")
    try:
        import live as livelib

        livelib.emit(
            "Build complete — click the game and play the full slice (movement, shoot, restart…).",
            role="system",
            phase="done",
            headline="Ready to play-test",
            detail="No separate start. Stay in this window.",
            reload=True,
        )
    except Exception:
        pass
    print(f"Project: {project}")
    print("Artifacts: .gamemaster/studio/ + DESIGN.md + prefs")
    if do_playtest:
        print("Playtest: .gamemaster/playtest/")
    if do_live:
        print("Live: dashboard still open — play anytime. Ctrl+C in terminal if you started with watch.")
    print("Next: npm i && npm run dev  — or: gamemaster playtest -p . --critic")
    print(f'Ship:  gamemaster ship -p "{project}" -m "vertical slice"')


def pipeline_council(
    project: Path,
    brief: str,
    model: str,
    build: bool,
    do_playtest: bool = False,
    do_live: bool = False,
) -> None:
    pb = pref_block(project)
    banner("⚖️ COUNCIL — Best-of-N design (3 variants in parallel)")
    pitches: list[str] = ["", "", ""]

    def gen(i: int) -> tuple[int, str]:
        return i, role_pitch_variant(brief, model, seed=i, project=project, prefs=pb)

    with ThreadPoolExecutor(max_workers=3) as ex:
        futs = [ex.submit(gen, i) for i in range(3)]
        for fut in as_completed(futs):
            i, text = fut.result()
            pitches[i] = text
            print(f"\n--- Pitch {i+1} ---\n{text[:1200]}\n")

    for i, p in enumerate(pitches):
        write_session(project, f"council-pitch-{i+1}.md", p)

    banner("🗳️ VOTE")
    vote = role_council_vote(brief, pitches, model)
    print(vote)
    write_session(project, "council-vote.md", vote)
    update_design_md(project, "Council Winner", vote)

    final = vote
    m = re.search(r"FINAL BRIEF:\s*(.+)$", vote, re.I | re.S)
    if m:
        final = m.group(1).strip()
    if build:
        pipeline_build(
            project, final, model, skip_plan=False, do_playtest=do_playtest, do_live=do_live
        )
    elif do_live:
        try:
            import live as livelib

            livelib.start_live(project, open_browser=True)
            livelib.emit("Council finished (no --build). Open Studio build next.", role="system")
        except Exception:
            pass


def pipeline_review(
    project: Path, brief: str, model: str, do_playtest: bool = False, do_live: bool = False
) -> None:
    if do_live:
        try:
            import live as livelib

            livelib.start_live(project, open_browser=True)
            livelib.emit("Review mode — play while critic runs", role="critic", phase="review")
        except Exception as e:
            print(f"  ⚠ live: {e}")
    banner("🧪 REVIEW ONLY")
    if do_playtest:
        run_playtest(project, model, with_critic=False)
        pt = project / ".gamemaster" / "playtest" / "report.md"
        pt_extra = pt.read_text(encoding="utf-8") if pt.exists() else ""
    else:
        pt_extra = ""
    tree = project_tree_summary(project)
    snippets = []
    for dirpath, dirnames, filenames in os.walk(project):
        dirnames[:] = [d for d in dirnames if d not in ("node_modules", ".git", "dist")]
        for name in filenames:
            if name.endswith((".js", ".ts", ".tsx", ".html", ".glsl")):
                p = Path(dirpath) / name
                try:
                    if p.stat().st_size < 40000:
                        rel = p.relative_to(project)
                        snippets.append(f"// {rel}\n{p.read_text(encoding='utf-8')[:4000]}")
                except Exception:
                    pass
        if len(snippets) > 12:
            break
    code = "\n\n".join(snippets)[:20000]
    if pt_extra:
        code = pt_extra[:6000] + "\n\n" + code
    design = ""
    if (project / "DESIGN.md").exists():
        design = (project / "DESIGN.md").read_text(encoding="utf-8")[:8000]
    critique = role_critic(
        brief or "Review this game project", design, tree, code, model, project=project
    )
    print(critique)
    write_session(project, "review-critic.md", critique)
    update_design_md(project, "Review", critique)
    learn_from_critic(project, critique)


def pipeline_parallel(
    project: Path, brief: str, model: str, do_playtest: bool = False, do_live: bool = False
) -> None:
    if do_live:
        try:
            import live as livelib

            livelib.start_live(project, open_browser=True)
            livelib.emit(
                f"Parallel studio: {brief[:160]}",
                role="system",
                phase="boot",
                headline="Parallel streams starting",
                detail="player / world / ui — play on the left",
            )
        except Exception as e:
            print(f"  ⚠ live: {e}")
    data = pipeline_plan(project, brief, model)
    design, arch = data["design"], data["architecture"]
    banner("🔀 PARALLEL STREAMS (player / world / ui)")
    streams = [
        (
            "player",
            "Implement player controller + input + camera + animation state from design feel numbers. "
            "src/player/*. Arcade capsule or Rapier character. Files under src/player* .",
        ),
        (
            "world",
            "Implement a real place: lighting, fog, ground/terrain, props (InstancedMesh), "
            "one NPC or interactable, collision meshes. src/world* . Not a gray plane.",
        ),
        (
            "ui",
            "Implement HUD + restart + dialogue box (typewriter + choices) if the slice has talk. "
            "HTML overlay or src/ui*. Touch-friendly, pause move while dialogue is open.",
        ),
    ]
    results = parallel_streams(project, design, arch, model, streams)
    for name, out in results.items():
        write_session(project, f"parallel-{name}.txt", out)

    banner("🔗 INTEGRATE")
    integ = (
        f"Integrate player/world/ui into a single runnable vertical slice.\n"
        f"Brief: {brief}\nDesign:\n{design[:2500]}\nArch:\n{arch[:2500]}\n"
        "Fix imports, wire game loop, ensure npm run dev works. "
        "Hook window.__GF_PLAYTEST__.recordDeath/recordRestart if applicable."
    )
    out = run_coder_agent(project, integ, model, steps=14)
    write_session(project, "parallel-integrate.txt", out)

    banner("🧪 CRITIC")
    critique = role_critic(brief, design, arch, out[-5000:], model, project=project)
    print(critique[:2000])
    write_session(project, "parallel-critic.md", critique)
    update_design_md(project, "Parallel Critic", critique)
    learn_from_critic(project, critique)

    if do_playtest:
        run_playtest(project, model, with_critic=True)


def main() -> int:
    ap = argparse.ArgumentParser(
        description="Gamemaster Studio — multi-agent local game production"
    )
    ap.add_argument(
        "mode",
        choices=["plan", "build", "council", "review", "parallel"],
        help="Studio mode",
    )
    ap.add_argument("-p", "--project", required=True, help="Project directory")
    ap.add_argument("brief", nargs="+", help="What to make / improve")
    ap.add_argument("-m", "--model", default=DEFAULT_MODEL)
    ap.add_argument(
        "--build",
        action="store_true",
        help="With council: continue to full build after vote",
    )
    ap.add_argument(
        "--playtest",
        action="store_true",
        help="After build/review/parallel: Playwright playtest (+ critic)",
    )
    ap.add_argument(
        "--live",
        action="store_true",
        default=None,
        help="Open Play window (game + AI log). Default ON for build/parallel.",
    )
    ap.add_argument(
        "--no-live",
        action="store_true",
        help="Do not open the Play window",
    )
    args = ap.parse_args()

    project = Path(args.project).expanduser().resolve()
    project.mkdir(parents=True, exist_ok=True)
    brief = " ".join(args.brief)
    model = args.model
    pt = args.playtest
    # Play surface default ON for modes that produce a runnable game
    if args.no_live:
        live = False
    elif args.live:
        live = True
    else:
        live = args.mode in ("build", "parallel") or (
            args.mode == "council" and args.build
        )

    ensure_ollama()
    print(f"🎮 Gamemaster STUDIO · mode={args.mode} · model={model}")
    print(f"📁 {project}")
    print(f"🎯 {brief}")
    if pt:
        print("🎮 automated playtest enabled")
    if live:
        print("🕹️  PLAY window enabled — game opens for you to test live")

    if args.mode == "plan":
        if live:
            try:
                import live as livelib

                livelib.start_live(project, open_browser=True)
            except Exception as e:
                print(f"  ⚠ live: {e}")
        pipeline_plan(project, brief, model)
    elif args.mode == "build":
        pipeline_build(project, brief, model, do_playtest=pt, do_live=live)
    elif args.mode == "council":
        pipeline_council(
            project, brief, model, build=args.build, do_playtest=pt, do_live=live
        )
    elif args.mode == "review":
        pipeline_review(project, brief, model, do_playtest=pt, do_live=live)
    elif args.mode == "parallel":
        pipeline_parallel(project, brief, model, do_playtest=pt, do_live=live)

    # Keep live servers up so the user can keep playing after AI finishes
    if live:
        try:
            import live as livelib

            if livelib.get_session() is not None:
                print(
                    "\n🔴 Live window stays open so you can keep playing.\n"
                    "   Press Ctrl+C here when you are done testing.\n"
                )
                try:
                    while True:
                        time.sleep(3600)
                except KeyboardInterrupt:
                    print("\nStopping live session…")
                    s = livelib.get_session()
                    if s:
                        s.stop()
        except Exception:
            pass

    return 0


if __name__ == "__main__":
    raise SystemExit(main())
