# AGENTS.md — how to work in this repo

Read this before editing. Goal: **small, testable patches**. Do not rewrite the studio pipeline unless the task is the pipeline.

## What this is

**Gamemaster** = local Three.js game studio (Ollama).  
Engine is **always Three.js** (Vite + vanilla). Solana Seeker = same game + Mobile Wallet Adapter.

Layout:

```
bin/            CLI + Python (one concern per file)
bin/gmcommon.py shared ROOT / OLLAMA / run / gitignore / slugify
knowledge/      LLM packs (injected by turbo, not imported as code)
templates/      copied by scaffold (shader-lab, world-game)
chat/           browser chat UI (served by bin/server.py)
live/           Play window (served by bin/live.py)
playtest/       Playwright runner
tests/          cheap, no Ollama — run first
Modelfile       baked Ollama system prompt
```

## Where to change what

| You want to… | Touch |
|--------------|--------|
| Shared paths / process / game `.gitignore` | `bin/gmcommon.py` |
| CLI flags / subcommands | `bin/gamemaster` then `start` if the same verb exists |
| GitHub login / commit / push | `bin/github.py` + `chat/index.html` + `live/dashboard.html` |
| Knowledge routing | `bin/turbo.py` (`PACKS`, `ROUTES`, `route_task`) |
| Model identity / taste | `Modelfile` then `gamemaster update --modelfile` |
| New domain facts for the LLM | `knowledge/*.md` + add to `knowledge/INDEX.md` + `turbo.PACKS` |
| Studio roles / pipeline | `bin/studio.py` (Director/Architect/Critic/pipelines) |
| Agent tools | `bin/agent.py` (`parse_tools`, `run_tool`) |
| New project starter | `bin/scaffold.py` + optional `templates/<name>/` |
| World generation | `bin/worldclaw.py` + `templates/world-game/` |
| Play-while-build | `bin/live.py` + `live/dashboard.html` |
| Chat server | `bin/server.py` + `chat/index.html` |
| Prefs | `bin/prefs.py` |
| Install / PATH | `install.sh` |

## Invariants (do not break)

1. **stdlib-only Python** in `bin/` (no pip). Node only for scaffolds, playtest, Vite games.
2. Scripts live in `bin/` and `import gmcommon` — `sys.path[0]` is already `bin/` when run as `python3 bin/foo.py`.
3. Never commit `node_modules`, `.env`, `config/user-prefs.json`, `config/github.json`, `.gamemaster/`.
4. **Do not `git init` / ship `$HOME` or this repo** (`github.guard_project`).
5. User-facing text: English. Code identifiers: English. Match the user language only in chat replies.
6. After a behaviour change: `python3 tests/run.py` (must stay green, no Ollama).

## Cheap verify (always)

```bash
python3 tests/run.py          # ~1s, no Ollama
python3 -m py_compile bin/*.py
./bin/gamemaster -h           # still dispatches
```

Need Ollama only for: studio, agent, chat, `update --modelfile`, worldclaw generate.

## How to add a knowledge pack

1. Write `knowledge/<name>.md` — **front-load** recipes (turbo truncates).
2. One line in `knowledge/INDEX.md`.
3. Add the filename to `PACKS` in `bin/turbo.py` and a `ROUTES` regex.
4. `python3 tests/run.py` (routing tests).

## How to add a CLI verb

1. Implement `bin/<verb>.py` with `main() -> int`.
2. Add a `case` in `bin/gamemaster` **and** `start`.
3. One line in the `gamemaster -h` usage block.

## Style

- Small functions, no framework.
- `handle_http` in `github.py` is the single API used by chat + live — do not fork it.
- Prefer editing an existing file over a new layer.
- Do not translate identifiers to German.
- Do not bake absolute machine paths into committed files.

## After Modelfile edits

```bash
python3 bin/self-update.py --modelfile --no-smoke
```

That re-applies the system prompt without re-pulling weights.
