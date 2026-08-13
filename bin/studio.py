#!/usr/bin/env python3
"""
Gamemaster STUDIO — Multi-agent production (local, $0).

Roles + pipelines live here. Coder is bin/agent.py. Play window is bin/live.py.
Do not add a second orchestrator.

Roles (consult + execute):

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

Local Ollama by default. Optional paid cloud only if the user enables it.
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
import agent as agentlib  # noqa: E402
import prefs as prefslib  # noqa: E402
import wiki as wikilib  # noqa: E402
from cloud import chat as llm_chat, require_backend
from gmcommon import DEFAULT_MODEL, DENSE_MODEL, KNOWLEDGE, OLLAMA, ROOT

NUM_CTX = int(os.environ.get("GAMEMASTER_NUM_CTX", "65536"))


def pref_block(project: Path | None) -> str:
    parts: list[str] = []
    try:
        pb = prefslib.format_prompt_block(prefslib.load_merged(project))
        if pb:
            parts.append(pb)
    except Exception:
        pass
    try:
        wb = wikilib.prompt_block(project) if project else ""
        if wb:
            parts.append(wb)
    except Exception:
        pass
    return "\n\n".join(parts)


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
    tier: str = "max",
) -> str:
    ctx = num_ctx if num_ctx is not None else min(NUM_CTX, 32768)
    return llm_chat(
        messages,
        model=model,
        temperature=temperature,
        num_predict=num_predict,
        num_ctx=ctx,
        tier=tier,
    )


def load_pack(*names: str, limit: int = 6000) -> str:
    chunks = []
    for n in names:
        p = KNOWLEDGE / n
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
    from gmcommon import meta_dir

    d = meta_dir(project) / "studio"
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
    """Director: structured JSON first (host slots), markdown fallback."""
    import identity as identitylib
    import quality as qualitylib

    knowledge = load_pack(
        "identity.md",
        "craft-taste.md",
        "pair-partner.md",
        "feel-tables.md",
        "game-genres.md",
        "readable-spaces.md",
        limit=2800,
    )
    prefs = prefs or pref_block(project)
    sys_p = (
        identitylib.system_for("director", extra_packs=False)
        + "\nHonor USER PREFERENCE MEMORY when present.\n"
        + qualitylib.DIRECTOR_JSON_INSTRUCTION
        + "\nIf Solana Seeker: same Three.js game + MWA; loop offline.\n"
    )
    user = (
        f"Brief:\n{brief}\n\nGenre-Note: {genre_hint or 'auto'}\n\n"
        f"{prefs}\n\n{knowledge}"
    )
    messages = [{"role": "system", "content": sys_p}, {"role": "user", "content": user}]
    # Host speculative: flash drafts JSON, max refines when needed
    try:
        raw = qualitylib.draft_then_max(
            messages,
            max_model=model,
            temperature=0.45,
            num_predict=2200,
            num_ctx=12288,
            mode="json",
        )
    except Exception:
        raw = chat(messages, model=model, temperature=0.45, num_predict=2200)

    data = qualitylib.extract_json_object(raw)
    ok, errs, norm = qualitylib.validate_director_json(data)
    if ok:
        md = qualitylib.director_json_to_markdown(norm)
        # persist machine-readable next to markdown
        if project is not None:
            try:
                write_session(project, "01-director.json", json.dumps(norm, indent=2) + "\n")
            except Exception:
                pass
            try:
                import slots as slotslib

                slotslib.apply_director_to_project(project, norm)
            except Exception as e:
                print(f"  ⚠ slots: {e}")
            # Apply engine from director JSON if project exists
            try:
                eng = (norm.get("engine") or "").lower()
                if eng in ("three", "pixel", "vintage"):
                    import engine_ops as eops

                    cur = eops.project_engine(project)
                    if cur != eng:
                        r = eops.switch_engine(
                            project,
                            eng,
                            vintage_profile=norm.get("vintage_profile") or "gb",
                        )
                        print(f"  ⚙ engine → {eng} ({r.get('ok')})")
                    elif eng == "vintage" and norm.get("palette_id"):
                        import engine_ops as eops

                        pid = str(norm.get("palette_id") or "dmg")
                        if pid.startswith("gbc") or pid.startswith("dmg"):
                            eops.set_vintage_palette(project, pid)
            except Exception as e:
                print(f"  ⚠ engine apply: {e}")
        return md + "\n\n<!-- director_json_ok -->\n"

    # One repair pass: ask model to fix JSON only
    repair = chat(
        [
            {"role": "system", "content": "Return ONLY valid Director JSON. No markdown."},
            {
                "role": "user",
                "content": f"Fix this into valid schema. Errors: {errs}\n\n{raw[:4000]}",
            },
        ],
        model=model,
        temperature=0.15,
        num_predict=1800,
    )
    data2 = qualitylib.extract_json_object(repair)
    ok2, errs2, norm2 = qualitylib.validate_director_json(data2)
    if ok2:
        if project is not None:
            try:
                write_session(project, "01-director.json", json.dumps(norm2, indent=2) + "\n")
                import slots as slotslib

                slotslib.apply_director_to_project(project, norm2)
            except Exception:
                pass
        return qualitylib.director_json_to_markdown(norm2) + "\n\n<!-- director_json_ok -->\n"

    # Fallback: freeform director (legacy) so pipeline never blocks
    sys_legacy = (
        identitylib.system_for("director", extra_packs=False)
        + "\nOutput MUST include: Pitch, Verb+t=8s, 3 pillars, slice, feel numbers, "
        "first death, NON-goals, metric.\n"
    )
    return chat(
        [
            {"role": "system", "content": sys_legacy},
            {"role": "user", "content": user},
        ],
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
    import identity as identitylib

    knowledge = load_pack(
        "identity.md",
        "game-systems.md",
        "feel-tables.md",
        "threejs-cheatsheet.md",
        "threejs-recipes.md",
        "physics-ragdoll.md",
        "readable-spaces.md",
        "solana-seeker.md",
        limit=2600,
    )
    prefs = prefs or pref_block(project)
    sys_p = (
        identitylib.system_for("architect", extra_packs=False)
        + "\nHonor USER PREFERENCE MEMORY (tech/feel).\n"
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
    # Architect is structure-only (non-code body) — flash is enough when available
    arch_model = model
    try:
        import turbo as turbolib

        arch_model = turbolib.resolve_tier("flash")
    except Exception:
        pass
    return chat(
        [{"role": "system", "content": sys_p}, {"role": "user", "content": user}],
        model=arch_model,
        temperature=0.25,
        num_predict=3000,
        tier="flash",
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
    import identity as identitylib

    knowledge = load_pack(
        "identity.md",
        "craft-taste.md",
        "pair-partner.md",
        "playtest-harness.md",
        "game-systems.md",
        limit=3000,
    )
    prefs = prefs or pref_block(project)
    sys_p = (
        identitylib.system_for("critic", extra_packs=False)
        + "\nIf PLAYTEST METRICS exist: prioritize empirical data (FPS, errors, death→retry).\n"
        "End with a JSON block (fenced or bare) including:\n"
        '{"feel_tweaks":{"gravity":28,"moveSpeed":7.2},"p0":["..."],"must_fix":["..."],'
        '"kill":["..."],"feel_score":7,"golden":"one number tweak"}\n'
        "Also write short prose:\n"
        "1) Severity list (P0/P1/P2) — max 8\n"
        "2) Feel verdict (1–10)\n"
        "3) Must-fix top 3 (code only — feel goes in feel_tweaks)\n"
        "4) Kill list\n"
        "English.\n"
    )
    user = (
        f"Brief:\n{brief}\n\nDesign:\n{design}\n\nArchitecture:\n{architecture}\n\n"
        f"Code/Implementation/Playtest summary:\n{code_summary}\n\n{prefs}\n\n{knowledge}"
    )
    return chat(
        [{"role": "system", "content": sys_p}, {"role": "user", "content": user}],
        model=model,
        temperature=0.35,
        num_predict=2200,
        tier="flash",
    )


def role_pitch_variant(
    brief: str, model: str, seed: int, prefs: str = "", project: Path | None = None
) -> str:
    import identity as identitylib

    # Slim packs only — council is latency-bound (3× parallel)
    knowledge = load_pack("identity.md", "craft-taste.md", "feel-tables.md", "game-genres.md", limit=1800)
    prefs = prefs or pref_block(project)
    sys_p = (
        identitylib.system_for("director", extra_packs=False)
        + f"\nYou are DIRECTOR variant #{seed}. Create ONE sharp, unique game pitch.\n"
        "Differentiate strongly. 1 core verb. Vertical slice only. Honor prefs.\n"
        "Format: PITCH / VERB / t=8s / PILLARS (3) / SLICE / FEEL NUMBERS / FIRST DEATH / HOOK\n"
        "English. Max 400 words.\n"
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
    import quality as qualitylib
    from gmcommon import meta_dir

    # P0: dual keep-alive before long studio run
    try:
        w = qualitylib.ensure_dual_warmup(force=False)
        if w.get("ok") and not w.get("cached"):
            print("  🔥 models warmed (flash+max)")
    except Exception as e:
        print(f"  ⚠ warmup: {e}")

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

    studio_dir = meta_dir(project) / "studio"
    legacy_dir = project / ".gamemaster" / "studio"

    def _read_art(name: str) -> str:
        for d in (studio_dir, legacy_dir):
            p = d / name
            if p.is_file():
                return p.read_text(encoding="utf-8")
        return ""

    if skip_plan:
        design = _read_art("01-director.md") or brief
        arch = _read_art("02-architect.md")
        if not arch:
            data = pipeline_plan(project, brief, model)
            design, arch = data["design"], data["architecture"]
    else:
        data = pipeline_plan(project, brief, model)
        design, arch = data["design"], data["architecture"]

    banner("💻 CODER")
    # RAG context
    rag_block = ""
    try:
        import rag as raglib

        rag_block = raglib.prompt_block(brief + "\n" + design[:500], k=3, max_chars=2500)
    except Exception:
        pass

    task = (
        f"Implement the vertical slice ONLY.\n\nUSER BRIEF:\n{brief}\n\n"
        f"DESIGN:\n{design[:4000]}\n\nARCHITECTURE:\n{arch[:4000]}\n\n"
        f"{rag_block}\n\n"
        f"{qualitylib.CODER_PATCH_INSTRUCTION}\n\n"
        "ENGINE: Vite + three.js always. Host already shipped craft/slots/feel — extend, don't destroy. "
        "Ship place · body · challenge · juice. "
        "No Vector3 allocs in the loop. End with done."
    )

    # Patch-level best-of (cheap flash patches) when DOTLAB_BEST_OF>=2
    best_n = int(os.environ.get("DOTLAB_BEST_OF", os.environ.get("GAMEMASTER_BEST_OF", "1")))
    game_js = project / "src" / "game.js"
    has_game = game_js.is_file() and game_js.stat().st_size > 500
    code_out = ""
    if best_n >= 2 and has_game:
        banner("⚖️ PATCH BEST-OF-N (flash drafts · verify pick)")
        bo = qualitylib.patch_level_best_of(project, brief + "\n" + design[:800], n=best_n, model=model)
        write_session(project, "03-best-of-n.json", json.dumps(bo, indent=2)[:12000] + "\n")
        print(f"  ✓ patch best-of winner={bo.get('winner')} score={(bo.get('score') or {}).get('score')}")
        code_out = json.dumps(bo.get("candidates") or [])[:4000]
        # still run a short coder for novelty wiring if P0 ok but thin novelty
        if bo.get("ok"):
            code_out += "\n" + run_coder_agent(
                project,
                task + "\nHost already applied best patch candidate — only wire novelty if missing.",
                model,
                steps=8,
            )
        else:
            code_out += "\n" + run_coder_agent(project, task, model, steps=12)
    else:
        code_out = run_coder_agent(project, task, model, steps=12)

    write_session(project, "03-coder-log.txt", code_out)
    print(code_out[-2000:])

    try:
        import verify as verifylib

        vr = verifylib.evaluate(project)
        write_session(project, "03b-verify.txt", vr["report"])
        print(vr["report"])
        if vr.get("p0_fail"):
            banner("🔧 VERIFY REPAIR (P0)")
            repair_out = run_coder_agent(
                project,
                verifylib.repair_prompt(vr) + "\n" + qualitylib.CODER_PATCH_INSTRUCTION,
                model,
                steps=10,
            )
            write_session(project, "03c-verify-repair.txt", repair_out)
    except Exception as e:
        print(f"  ⚠ verify: {e}")

    banner("🧪 CRITIC + single repair (auto)")
    try:
        auto = qualitylib.auto_critic_and_repair(
            project,
            brief,
            design,
            arch,
            code_out[-6000:],
            model,
            run_coder=run_coder_agent,
        )
        critique = auto.get("critique") or ""
        print(critique[:2500])
        write_session(project, "04-critic.md", critique)
        update_design_md(project, "Critic", critique)
        if auto.get("repaired"):
            write_session(project, "05-fix-log.txt", "auto repair ran — see 05-repair-auto.txt")
            print("  ✓ single auto-repair pass")
        sc = auto.get("score_after") or {}
        print(f"  score after critic gate: {sc.get('score')} p0_ok={sc.get('p0_ok')}")
    except Exception as e:
        print(f"  ⚠ auto critic: {e}")
        # legacy fallback
        critique = role_critic(brief, design, arch, code_out[-6000:], model, project=project)
        write_session(project, "04-critic.md", critique)
        update_design_md(project, "Critic", critique)
        learn_from_critic(project, critique)

    # Index successful slices for RAG
    try:
        import rag as raglib
        import quality as q2

        if q2.score_project(project).get("score", 0) >= 60:
            raglib.index_project(project)
            # merge into global index opportunistically
            raglib.rebuild_index(limit_projects=25)
    except Exception:
        pass

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
    print("Artifacts: .dotlab/studio/ (or .gamemaster/studio/) + DESIGN.md + prefs")
    if do_playtest:
        print("Playtest: meta playtest/")
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
    ap.add_argument("--cloud", default="", help="Optional paid provider: grok|claude|openai|gemini")
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

    if args.cloud:
        os.environ["GAMEMASTER_CLOUD"] = args.cloud
    require_backend()
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
