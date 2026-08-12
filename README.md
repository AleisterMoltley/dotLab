# dotLab

> Formerly *Gamemaster* — same stack, new name.


Local Three.js game studio. One prompt → a playable slice. Worlds, physics, dialogue, shaders, Solana Seeker. **$0** on [Ollama](https://ollama.com). Paid cloud models are optional and off until you turn them on.

[![License: MIT](https://img.shields.io/badge/License-MIT-emerald.svg)](LICENSE)

dotLab is not a generic chatbot. It is a toolchain that **ships games**: a game-tuned local model, a four-role studio, file agents, a world generator, scaffolds, playtest, and `ship` to GitHub.

## What you get

| Piece | What it does |
|-------|----------------|
| **Models** | `dotlab` (Qwen3-Coder 30B MoE) and `gamemaster-dense` (32B), plus a 7B flash tier |
| **Studio** | Director → Architect → Coder → Critic. Council votes on pitches |
| **Agent** | Reads and writes files in your game (`list` / `read` / `write` / `search` / `run`) |
| **Worlds** | Prompt → regions → height field → editable instances you can walk |
| **Pixel** | Bake sprites on Canvas2D, stamp them as nearest-filter quads in Three.js |
| **Shaders** | Multipass GLSL lab, Shadertoy import |
| **Seeker** | Same Three.js game + Mobile Wallet Adapter |
| **Playtest** | Playwright headless run, screenshots, metrics |
| **Kit** | Todos, feel audit, art-test, wiki, verify |
| **Verify** | Deterministic slice grade. P0 fail blocks `done` |
| **GitHub** | Login, commit, private repo, push (`gamemaster ship`) |
| **Cloud** | Grok / Claude / OpenAI / Gemini — **opt-in only** |

## Requirements

- macOS or Linux (Apple Silicon recommended)
- **32 GB RAM** for the 30B + 32B pair. 16 GB can run `--14b` or `--7b`
- [Ollama](https://ollama.com) (install the app, leave it running)
- [Node.js](https://nodejs.org) 18+ (scaffolds and playtest)
- Python 3.10+ (stdlib only — no `pip install`)
- Disk: ~40 GB for `--dual`, ~20 GB for `--max`, much less for `--14b` / `--7b`
- Optional: [GitHub CLI](https://cli.github.com) (`brew install gh`) to ship games

## Install

```bash
git clone https://github.com/AleisterMoltley/gamemaster.git
cd gamemaster
chmod +x install.sh start bin/*
./install.sh --dual
```

`install.sh` pulls the Ollama models, builds the `dotlab` / `gamemaster-dense` tags from `Modelfile`, and puts `dotlab` on `~/.local/bin`.

### Profiles

| Flag | Models | When |
|------|--------|------|
| `--dual` | 30B MoE + 32B dense + 7B flash | Best quality. 48 GB unified memory is comfortable |
| `--max` | 30B MoE + 7B | Default coding, no dense critic |
| `--14b` | qwen2.5-coder:14b | 16–24 GB machines |
| `--7b` | qwen2.5-coder:7b | Laptops, flash-only |

If `~/.local/bin` is not on your PATH:

```bash
export PATH="$HOME/.local/bin:$PATH"
# or:
alias gamemaster="$PWD/bin/gamemaster"
```

Check:

```bash
gamemaster -h
python3 tests/run.py      # ~2s, no Ollama
./start                   # browser chat (needs Ollama running)
```

Open **Ollama.app** before the first chat. On Apple Silicon, `install.sh` already writes Metal-friendly env into `config/ollama-env.sh`. You can `source` it in a long session:

```bash
source ./config/ollama-env.sh
gamemaster turbo warmup
```

Games you scaffold or start from the chat live in **`~/dotLab/Projects`**. Open that folder in Finder, or use **Your games** on the start screen.

## First game (five minutes)

```bash
# 1. Empty Three.js world you can walk
gamemaster scaffold world-game --name Wilds
cd Wilds

# 2. Fill it from a sentence (no LLM: add --offline)
gamemaster worlds generate -p . "coastal village, pine ridge, desert canyon"

# 3. Play
npm install
npm run dev
```

WASD to walk, click to look, Space to jump. `1` / `2` toggle appearance vs instance colors.

Then iterate:

```bash
gamemaster -p . --agent "Add an NPC with a three-node dialogue tree"
gamemaster studio build -p . "one quest: talk, flip a flag, the dock lights up" --live
```

`--live` opens the Play window. The game stays up while files change.

## Commands

```bash
# Chat (one shot)
gamemaster "Third-person village: walk, talk, ragdoll on death"

# Studio
gamemaster studio plan    -p DIR "brief"
gamemaster studio build   -p DIR "brief" --live
gamemaster studio council -p DIR "brief" --build --live
gamemaster studio review  -p DIR "what is weak"
gamemaster studio parallel -p DIR "brief"

# Worlds
gamemaster worlds generate -p DIR "biomes…"
gamemaster worlds generate --offline -p DIR "snow village"
gamemaster worlds plan "canyon settlement" -o spec.json

# Scaffolds
gamemaster scaffold web-game --genre platformer --name Skyjump
gamemaster scaffold world-game --name Wilds
gamemaster scaffold pixel-game --name Grove
gamemaster scaffold seeker-game --genre idle --name ClaimQuest
gamemaster scaffold shader-lab --name NeonFrag

# Agent (needs -p)
gamemaster -p ./Skyjump --agent "Add collectibles and a score HUD"

# Play / measure
gamemaster live -p DIR
gamemaster playtest -p DIR --critic
gamemaster verify -p DIR

# Memory
gamemaster prefs set like "tight jumps"
gamemaster wiki add -p DIR "Gravity 28" --why "user said floaty"
gamemaster kit todo -p DIR --add "first fair death"
gamemaster kit feel -p DIR
gamemaster kit pixel -p DIR      # copy lib/pixel into src/pixel

# GitHub
gamemaster github login
gamemaster ship -p ./Wilds -m "vertical slice"

# Speed / updates
gamemaster turbo warmup
gamemaster turbo bench
gamemaster update --modelfile

# Optional paid model (does nothing until you opt in)
gamemaster cloud status
gamemaster cloud on grok
gamemaster --cloud claude "Tighten coyote time"
gamemaster cloud off
```

`./start` is the same CLI plus a browser chat UI. `./start studio build -p DIR "brief"` works.

## Studio

| Mode | Use when |
|------|----------|
| **plan** | Design + architecture only |
| **build** | Full Director → Architect → Coder → Critic → fix |
| **council** | Three pitches, vote, optional build |
| **parallel** | Player / world / UI streams, then merge |
| **review** | Roast an existing project |

Build and parallel open the Play window by default (`--no-live` to skip). `--playtest` adds a headless Playwright pass after the build.

## Worlds

`gamemaster worlds generate` turns a sentence into a walkable Three.js scene.

1. **Intent** — only what you said (no invented biomes)
2. **Plan** — 3–6 regions, landforms, materials, object lists
3. **Terrain** — layout map, composite height field, rock/tree scatter
4. **Populate** — houses, docks, animals; seat them on the ground
5. **Compose** — writes `public/world/{spec,layout,heightfield,instances,meta}.json`

`--offline` skips the LLM and uses the built-in planner. Output is always the same file layout, so `npm run dev` just works.

## Pixel games

Three.js stays the engine. Sprites are baked on Canvas2D, then uploaded as nearest-filter quads.

```bash
gamemaster scaffold pixel-game --name Grove
cd Grove && npm i && npm run dev
```

Vocab lives in `lib/pixel/` (`bake.js`, `draw.js`, `fx.js`, `three-bridge.js`). `gamemaster kit pixel -p DIR` copies that kit into an existing game.

## Shader lab

```bash
gamemaster scaffold shader-lab --name NeonFrag
cd NeonFrag && npm i && npm run dev
```

Multipass fragment buffers, Shadertoy import, no cloud.

## Solana Seeker

A Seeker game is the **same Three.js loop** plus Mobile Wallet Adapter. Scaffold `seeker-app` (wallet shell) or `seeker-game` (wallet + game slot). The loop must work with the wallet disconnected.

## GitHub

```bash
brew install gh
gamemaster github login
gamemaster ship -p ./Wilds -m "vertical slice"
```

New repos are **private** unless you pass `--public`. Tokens stay in the `gh` keyring. `config/github.json` is gitignored.

## Optional paid models

Default is local Ollama. A key in your environment does **not** switch you over.

```bash
export XAI_API_KEY=…          # or ANTHROPIC_API_KEY / OPENAI_API_KEY / GEMINI_API_KEY
gamemaster cloud on grok      # persist until cloud off
gamemaster --cloud grok "…"   # one shot, no persist
gamemaster cloud off
```

Keys prefer the env var. `cloud set grok --key …` writes `config/cloud.json` (gitignored, mode 0600). Custom OpenAI-compatible endpoints are supported (`--base`).

## Layout

```
gamemaster/
  AGENTS.md              How to patch this repo (humans + AIs)
  install.sh             Models + PATH
  Modelfile              Game-tuned system prompt
  start                  Browser chat / command dispatcher
  bin/gamemaster         CLI
  bin/gmcommon.py        Shared paths, Ollama helpers
  bin/studio.py          Multi-agent production
  bin/agent.py           File agent
  bin/worlds.py          Open-world generator
  bin/scaffold.py        Starters
  bin/cloud.py           Optional paid providers
  bin/github.py          Login / commit / ship
  bin/kit.py             Todos, feel, art-test, pixel
  bin/verify.py          Deterministic slice grade
  knowledge/             Domain packs the model sees
  lib/pixel/             Canvas2D → Three.js textures
  templates/             world-game, pixel-game, shader-lab
  tests/                 Cheap suite (no Ollama, no network)
  chat/  live/           Browser UIs
```

Working on the repo itself: read **[AGENTS.md](AGENTS.md)**, then `python3 tests/run.py`.

## Model tiers

| Tier | Default | Role |
|------|---------|------|
| **flash** | `qwen2.5-coder:7b` | Short Q&A |
| **max** | `dotlab` | Coding |
| **dense** | `gamemaster-dense` | Hard refactors / critique |

```bash
gamemaster --tier dense "refactor the entity system"
```

Editor (Continue, etc.): `http://127.0.0.1:11434/v1` · key `ollama` · model `dotlab`. See `config/README-editor.md`.

## Feel and completeness

A cube on a plane is a fail. A slice needs a place (light, fog = background), a body (accel/friction + spring camera), a verb at t=8s, and a fair first death. Feel lives in `CONFIG` numbers, not in comments. `gamemaster verify -p DIR` grades the slice without an LLM.

## License

MIT — [LICENSE](LICENSE). Copyright 2026 AleisterMoltley.

Runtime: [Ollama](https://ollama.com) + Qwen coder weights, [Three.js](https://threejs.org). Optional cloud APIs are yours to enable.

---

**Ship the game. Pay $0 unless you choose not to.**
