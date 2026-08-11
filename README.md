# Gamemaster

**Local, free, game-specialized multi-agent coding studio.**  
Three.js games · Solana Seeker apps · FragCoord-class shaders · $0 forever.

[![License: MIT](https://img.shields.io/badge/License-MIT-emerald.svg)](LICENSE)

Gamemaster is an open-source local AI toolchain for **shipping playable games**, not generic chat. It runs on [Ollama](https://ollama.com) (no cloud credits), with multi-agent production, playtesting, preference memory, and speed routing.

> Inspired by workflows from cloud agents (plan → implement → review) and game-first design — fully offline on your machine.

## Features

| Area | What you get |
|------|----------------|
| **Models** | `gamemaster` (Qwen3-Coder 30B MoE) + `gamemaster-dense` (32B) + 7B flash tier |
| **Studio** | Director · Architect · Coder · Critic · Council (best-of-N) |
| **Agent** | File tools: list / read / write / search / run |
| **Scaffolds** | Web game, Solana Seeker app/game, Shader Lab |
| **Playtest** | Playwright headless run + screenshots + metrics |
| **Prefs** | Learns your feel (tight jumps, mobile-first, …) |
| **Turbo** | Model routing, slim knowledge packs, warmup, bench |
| **Update** | Self-update models + live package versions |

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
gamemaster "Third-person controller with coyote time"

# Multi-agent studio
gamemaster studio plan -p ./my-game "one-thumb juiciness runner"
gamemaster studio build -p ./my-game "platformer vertical slice" --live
gamemaster studio council -p ./my-game "tight arena shooter" --build --live

# Live window only (play + watch file changes)
gamemaster live -p ./my-game

# Scaffolds
gamemaster scaffold web-game --genre platformer --name Skyjump
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

Add `--playtest` to run Playwright after build/review/parallel.  
Add **`--live`** to open a **Live dashboard window**: game on the left (play anytime), AI progress log on the right, auto-reload when files change.

## Architecture

```
gamemaster/
  Modelfile              System prompt (game + Seeker + shaders)
  install.sh             Pull models + create gamemaster / gamemaster-dense
  bin/gamemaster         Main CLI
  bin/studio.py          Multi-agent production
  bin/agent.py           Tool-using implementer
  bin/scaffold.py        Project generators
  bin/playtest.py        Dev server + Playwright
  bin/prefs.py           Preference memory
  bin/turbo.py           Routing + warmup + bench
  bin/self-update.py     Keep models/docs fresh
  bin/server.py + chat/  Local browser chat UI
  knowledge/             Domain packs (three.js, genres, Seeker, shaders)
  templates/shader-lab/  FragCoord-class multipass editor
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
2. **Fun-first design** — core verb, feel numbers, non-goals  
3. **Measure** — Playwright metrics + critic, not vibes alone  
4. **Remember** — preference memory across sessions  
5. **Fast without dumbing down** — route models + slim knowledge, keep max quality on code  

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
