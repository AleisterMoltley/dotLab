# Gamemaster

**Local, free, Three.js game-world studio.**  
Whole worlds · physics / ragdoll · dialogue · shaders · Solana Seeker games · $0 forever.

[![License: MIT](https://img.shields.io/badge/License-MIT-emerald.svg)](LICENSE)

Gamemaster is an open-source local AI toolchain for **shipping playable Three.js games**, not generic chat. The local model is trained-in-prompt as a game-world engineer: places, bodies, physics, ragdoll, dialogue trees, and shaders. Solana Seeker games are the **same Three.js game** plus Mobile Wallet Adapter. Runs on [Ollama](https://ollama.com) (no cloud credits).

> Inspired by workflows from cloud agents (plan → implement → review) and game-first design — fully offline on your machine.

## Features

| Area | What you get |
|------|----------------|
| **Models** | `gamemaster` (Qwen3-Coder 30B MoE) + `gamemaster-dense` (32B) + 7B flash — **Three.js game-tuned system prompt** |
| **Studio** | Director · Architect · Coder · Critic · Council (best-of-N) |
| **Agent** | File tools: list / read / write / search / run |
| **Worlds** | WorldClaw: prompt → regions → heightfield → editable instances |
| **Systems** | Physics (arcade / Rapier), ragdoll, dialogue trees, animation, shaders |
| **Scaffolds** | Web game, open world, Solana Seeker app/game, Shader Lab |
| **Playtest** | Playwright headless run + screenshots + metrics |
| **Prefs** | Learns your feel (tight jumps, mobile-first, …) |
| **Turbo** | Routes knowledge packs (world / physics / dialogue / shader / Seeker) |
| **Update** | Self-update models + live package versions |
| **GitHub** | Browser login · commit · create repo · push (`gamemaster ship`) |
| **Wiki + map** | `WIKI.md` / `MAP.md` auto-loaded into Studio, Agent, and CLI |
| **Kit** | Grok build tools: todos, feel audit, art-test, wiki_add (agent + CLI) |
| **Verify** | Deterministic slice grade (no LLM). P0 fail blocks `done` and forces repair |

## For humans and AIs working in this repo

Read **[AGENTS.md](AGENTS.md)** first (where to edit, invariants, cheap tests).

```bash
python3 tests/run.py        # ~1s, no Ollama — run after every patch
```

## Requirements

- macOS or Linux (Apple Silicon recommended, 32GB+ RAM ideal)
- [Ollama](https://ollama.com)
- Node.js 18+ (scaffolds + playtest)
- Python 3.10+
- ~40GB disk for dual models (optional smaller profiles)

## Install

```bash
git clone https://github.com/AleisterMoltley/gamemaster.git
cd gamemaster
chmod +x install.sh start bin/*
./install.sh --dual    # MoE 30B + dense 32B (best on 48GB)
# ./install.sh --max   # MoE only
# ./install.sh --14b   # lighter
```

Add CLI to PATH (install does this if possible):

```bash
export PATH="$HOME/.local/bin:$PATH"
# or always:
alias gamemaster="$PWD/bin/gamemaster"
```

## Quick start

```bash
# One-shot chat
gamemaster "Third-person village slice: walk, talk to an NPC, ragdoll on death"

# Multi-agent studio
gamemaster studio plan -p ./my-game "one-thumb juiciness runner"
gamemaster studio build -p ./my-game "open-world village vertical slice" --live
gamemaster studio council -p ./my-game "tight arena shooter" --build --live

# Generated open world
gamemaster scaffold world-game --name Wilds
gamemaster worldclaw generate -p ./Wilds "coastal village, pine ridge, desert canyon"

# Live window only (play + watch file changes)
gamemaster live -p ./my-game

# Scaffolds
gamemaster scaffold web-game --genre platformer --name Skyjump
gamemaster scaffold world-game --name Wilds
gamemaster scaffold seeker-game --genre idle --name ClaimQuest
gamemaster scaffold shader-lab --name NeonFrag

# Agent edits your project
gamemaster -p ./Skyjump --agent "Add collectibles and score HUD"

# Playtest + prefs
gamemaster playtest -p ./Skyjump --critic
gamemaster prefs set like "tight jumps"
gamemaster prefs set feel.jump tight
gamemaster prefs show

# Speed
gamemaster turbo warmup
gamemaster turbo bench
source ./config/ollama-env.sh

# GitHub — sign in once, then ship any game
gamemaster github login
gamemaster ship -p ./Wilds -m "open-world village slice"

# Browser UI
./start
```

## Studio modes

| Mode | Command | Use when |
|------|---------|----------|
| **plan** | `studio plan -p DIR "…"` | Design + architecture only |
| **build** | `studio build -p DIR "…"` | Full Director→Architect→Coder→Critic→Fix |
| **council** | `studio council -p DIR "…" --build` | 3 pitches → vote → optional build |
| **parallel** | `studio parallel -p DIR "…"` | player / world / ui streams |
| **review** | `studio review -p DIR "…"` | Roast existing project |

### Play while it builds (built-in)

**You do not start the game separately.** Studio **build/parallel** open a **Play window** by default:

- Full game canvas inside Gamemaster (click to capture keyboard/mouse — shooters, WASD, etc.)
- AI activity log in a side drawer
- File updates apply live (or queue while you play if you turn Auto-update off)
- Stays open after the build so you can keep testing

```bash
gamemaster studio build -p ./my-shooter "arena shooter vertical slice"
# Play window opens automatically

gamemaster live -p ./my-shooter          # play surface only
gamemaster studio build -p ./x "…" --no-live   # disable if needed
```

Add `--playtest` for headless Playwright metrics after build (separate from human play).

## GitHub (login · commit · push)

Sign in once with the [GitHub CLI](https://cli.github.com) (`brew install gh`). Gamemaster opens the browser, then can create a repo and push the game.

```bash
gamemaster github login          # browser / device code
gamemaster github status
gamemaster github commit -p ./Wilds -m "first walk"
gamemaster github push -p ./Wilds
gamemaster ship -p ./Wilds -m "vertical slice"   # commit + create private repo + push
gamemaster github logout

# Wiki + map (auto-injected into studio/agent)
gamemaster wiki add -p ./Wilds "Gravity 28" --why "user said floaty"
gamemaster wiki map -p ./Wilds
gamemaster kit todo -p ./Wilds --add "first fair death"
gamemaster kit feel -p ./Wilds
gamemaster kit art-test -p ./Wilds
```

- Default new repos are **private**. Pass `--public` to publish.
- New games get a `.gitignore` (no `node_modules`, `.env`, `.gamemaster`).
- Chat UI and the Play window have a **GitHub / Ship** button that uses the same flow.
- Tokens stay in the `gh` keyring — Gamemaster never writes a PAT to disk.

## Architecture

```
gamemaster/
  AGENTS.md              Map for humans + AIs (read first)
  Modelfile              Three.js game-world system prompt
  install.sh             Pull models + create gamemaster / gamemaster-dense
  bin/gmcommon.py        Shared ROOT / Ollama / gitignore / slugify
  bin/gamemaster         Main CLI
  bin/studio.py          Multi-agent production
  bin/agent.py           Tool-using implementer
  bin/scaffold.py        Project generators
  bin/worldclaw.py       Open-world generator (spec → terrain → instances)
  bin/github.py          Login / commit / push / ship
  bin/playtest.py        Dev server + Playwright
  bin/prefs.py           Preference memory
  bin/turbo.py           Routing + warmup + bench
  bin/self-update.py     Keep models/docs fresh
  tests/                 Cheap suite (no Ollama)
  bin/server.py + chat/  Local browser chat UI
  knowledge/             Three.js game packs (worlds, physics, ragdoll, dialogue, shaders, Seeker)
  templates/shader-lab/  FragCoord-class multipass editor
  templates/world-game/  Explorable WorldClaw world
  playtest/              Playwright runner
  config/                Ollama env, Continue snippet
```

## Model tiers (Turbo)

| Tier | Default model | Role |
|------|---------------|------|
| **flash** | `qwen2.5-coder:7b` | Short Q&A, low latency |
| **max** | `gamemaster` | Default coding (MoE) |
| **dense** | `gamemaster-dense` | Hard refactors / critique |

Override:

```bash
gamemaster --tier dense "refactor entity system"
gamemaster -m gamemaster-dense "security review"
```

## Editor integration

Ollama OpenAI-compatible API:

```
Base URL:  http://127.0.0.1:11434/v1
API Key:   ollama
Model:     gamemaster
```

See `config/README-editor.md` and `config/continue-config.snippet.json`.

## Philosophy

1. **Playable first** — vertical slices, not feature laundry lists  
2. **Three.js only** — worlds, physics, ragdoll, dialogue, shaders in one engine  
3. **Fun-first design** — core verb, feel numbers, non-goals  
4. **Seeker is the same game** — MWA on top, loop works offline  
5. **Measure** — Playwright metrics + critic, not vibes alone  
6. **Remember** — preference memory across sessions  
7. **Fast without dumbing down** — route models + slim knowledge, keep max quality on code  

## Benchmarks (honest)

Cloud frontier models (Grok / Kimi K3) win raw scale. Gamemaster optimizes for:

- Local latency (prefill + routing)
- Game ship rate (studio + playtest)
- Zero cost / privacy

```bash
gamemaster turbo bench   # writes config/bench-latest.json
```

## License

MIT — see [LICENSE](LICENSE).

## Credits

Built for local game makers. Uses open weights via Ollama (Qwen coder family). Not affiliated with xAI, Moonshot, or Alibaba.

---

**Ship games. Pay $0. Stay offline when you want.**
