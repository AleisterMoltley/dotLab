# AGENTS.md — how to work in this repo

Read this before editing. Goal: **small, testable patches**. Do not rewrite the studio pipeline unless the task is the pipeline.

## What this is

**dotLab** = local Three.js game studio (Ollama). Formerly Gamemaster.  
Engine is **always Three.js** (Vite + vanilla). Solana Seeker = same game + Mobile Wallet Adapter.

Layout:

```
bin/            CLI + Python (one concern per file)
bin/gmcommon.py shared ROOT / OLLAMA / run / gitignore / slugify
knowledge/      LLM packs (injected by turbo, not imported as code)
templates/      copied by scaffold (world-game, pixel-game, shader-lab)
lib/pixel/      Canvas2D bake + Three.js nearest-quad bridge
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
| CLI flags / subcommands | `bin/dotlab` (alias `gamemaster`) then `start` if the same verb exists |
| GitHub login / commit / push | `bin/github.py` + `chat/index.html` + `live/dashboard.html` |
| Knowledge routing | `bin/turbo.py` (`PACKS`, `ROUTES`, `route_task`) |
| Model identity / taste | `knowledge/brain.md` + `Modelfile` then `gamemaster update --modelfile` |
| New domain facts for the LLM | `knowledge/*.md` + add to `knowledge/INDEX.md` + `turbo.PACKS` |
| Studio roles / pipeline | `bin/studio.py` (Director/Architect/Critic/pipelines) |
| Agent tools | `bin/agent.py` (`parse_tools`, `run_tool`) |
| Skill catalog / route-or-abstain | `bin/skills.py` + `knowledge/skills.md` |
| Deep build (peek / sub) | `bin/rlm.py` + `knowledge/rlm.md` |
| New project starter | `bin/scaffold.py` + optional `templates/<name>/` |
| Prompt → playable slice | `bin/slice.py` + `templates/web-slice/game.js` |
| Instant continue (feel/counts/palette) | `bin/patch.py` — no LLM |
| Install Grok into Ollama | `bin/intervene.py` · `gamemaster intervene` |
| **Grok identity (single source)** | `bin/identity.py` + `knowledge/identity.md` |
| Ship bar (NEON INK) | `knowledge/ship-bar.md` + `lib/craft/` |
| Skill FPS recipe | `knowledge/skill-fps.md` |
| Grok decision tree | `knowledge/grok-craft.md` (core pack) |
| Grok toolkit map | `knowledge/grok-toolkit.md` |
| Three.js recipes | `knowledge/threejs-recipes.md` |
| Pixel bake / sprite vocab | `lib/pixel/` + `knowledge/pixel-kit.md` + `templates/pixel-game/` |
| World generation | `bin/worlds.py` + `templates/world-game/` |
| Play-while-build | `bin/live.py` + `live/dashboard.html` |
| Chat server / dashboard APIs | `bin/server.py` + `bin/studio_ops.py` + `chat/` |
| Prefs | `bin/prefs.py` |
| Game wiki + file map (auto-loaded) | `bin/wiki.py` (`WIKI.md`, `MAP.md`) |
| Game kit (todos, feel audit, art-test, pixel vendor) | `bin/kit.py` — also agent tool `kit` |
| Slice verify (P0 gate, no Ollama) | `bin/verify.py` — agent `done` + studio after coder |
| Host feel / few-shots / verify repair | `bin/host_floor.py` |
| Optional paid LLMs (off by default) | `bin/cloud.py` — grok / claude / openai / gemini / zoo |
| OpenZoo x402 floor (leCore) | `bin/zoo.py` (`handle_http`) + `knowledge/openzoo.md` + `chat/` + `live/dashboard.html` |
| Install / PATH | `install.sh` |

## Invariants (do not break)

1. **stdlib-only Python** in `bin/` (no pip). Node only for scaffolds, playtest, Vite games.
2. Scripts live in `bin/` and `import gmcommon` — `sys.path[0]` is already `bin/` when run as `python3 bin/foo.py`.
3. Never commit `node_modules`, `.env`, `config/user-prefs.json`, `config/github.json`, `config/cloud.json`, `config/zoo.json`, `config/zoo-wallet.json`, `.gamemaster/`.
4. **Do not `git init` / ship `$HOME` or this repo** (`github.guard_project`).
5. User-facing text: English. Code identifiers: English. Match the user language only in chat replies.
6. After a behaviour change: `python3 tests/run.py` (must stay green, no Ollama).
7. Per-game `WIKI.md` + `MAP.md` are auto-injected. Update the wiki when you learn a durable fact; do not re-walk the tree if a map exists.

## Cheap verify (always)

```bash
python3 tests/run.py          # ~1s, no Ollama
python3 -m py_compile bin/*.py
./bin/gamemaster -h           # still dispatches
```

Need Ollama only for: studio, agent, chat, `update --modelfile`, worlds generate (unless `--offline` or `--cloud`).

## How to add a knowledge pack

1. Write `knowledge/<name>.md` — **front-load** recipes (turbo truncates).
2. One line in `knowledge/INDEX.md`.
3. Add the filename to `PACKS` in `bin/turbo.py` and a `ROUTES` regex.
4. `python3 tests/run.py` (routing tests).

## How to add a CLI verb

1. Implement `bin/<verb>.py` with `main() -> int`.
2. Add a `case` in `bin/dotlab` (alias `gamemaster`) **and** `start`.
3. One line in the `gamemaster -h` usage block.
4. If an agent or user should be able to *find* it, add a skill in `bin/skills.py` (`catalog()`) with aliases + a runnable example. `python3 bin/skills.py check` must stay green.

## How to add a skill

1. One `_skill(...)` in `bin/skills.py` `catalog()`.
2. Aliases are the phrases a user would actually type (`juice the jump`, not the identifier).
3. If it is an agent tool, handle it in `agent.run_tool` and list it in `skills.AGENT_TOOLS`.
4. `python3 tests/run.py` — route tests must still abstain on nonsense.

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
