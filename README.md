# dotLab

**A local AI game studio that ships playable games — not chat logs.**

You describe a game. DotLab scaffolds a real project, fills a vertical slice you can run, and iterates with you while the game stays open. The models run on your machine. The quality bar is enforced by the host, not left to the model’s good intentions.

[![License: MIT](https://img.shields.io/badge/License-MIT-emerald.svg)](LICENSE)

---

## Why this exists

Most AI coding tools optimize for *looking busy*: more files, more tokens, more confidence. Games punish that. A green capsule on a plane is not a game. A plaza with one hoop is not a race. A jump that never lands on a ledge is not a platformer.

DotLab is built around a different bet:

1. **The host owns the floor.** Feel numbers, opposition counts, ledges, gates, doors, and death rules are applied by the studio — not invented in prose.
2. **The model works in a tight loop.** It peeks at the project, patches one system at a time, and stops when the slice passes a real grade.
3. **Local is the default.** [Ollama](https://ollama.com) runs the stack. Paid cloud models exist only if you turn them on.

One prompt can still open a world. The difference is what “done” means: a project you can play, measure, and ship.

---

## Strengths

| Strength | What you feel |
|----------|----------------|
| **Playable first** | Scaffold → `npm run dev` → controls work. No empty repo ceremony. |
| **Host quality floor** | Place, body, verb, opposition, juice. Missing a pillar fails the slice. |
| **Studio that builds** | Director → Architect → recursive coder → Critic. Not a single dump into `game.js`. |
| **Live iteration** | The Play window stays open while files change. Test while the agent works. |
| **Deterministic verify** | `verify` grades structure and genre contracts without calling a model. P0 fail blocks “done”. |
| **Skill routing** | The agent asks the catalog what exists. Unknown tools do not invent themselves. |
| **Worlds from a sentence** | Regions, height field, instances — walkable Three.js you can keep editing. |
| **$0 local path** | Game-tuned models on Ollama. Cloud is opt-in, never ambient. |
| **OpenZoo option** | [openzoo.fun](https://openzoo.fun/) paid floor: leCore in front, x402, no API key. Long trees cheaper than buying the model direct. |
| **Ship path** | Private GitHub repo in one command when you are ready. |

---

## What you can make

- **Web games** — Three.js vertical slices (FPS, platformer, runner, race, adventure, more)
- **Pixel games** — Canvas2D bake path with nearest-filter feel
- **Vintage** — Game Boy ship bar, hard GBA ceiling
- **Open worlds** — prompt → regions → terrain → instances
- **Shader lab** — multipass GLSL, Shadertoy import
- **Solana Seeker** — same game loop + Mobile Wallet Adapter

Engine rule: the game is always a real project (Vite, files, a loop). Seeker adds wallet; it does not replace the game.

---

## Requirements

- macOS or Linux (Apple Silicon recommended)
- **32 GB RAM** for the full model pair · 16 GB can run `--14b` or `--7b`
- [Ollama](https://ollama.com) running
- [Node.js](https://nodejs.org) 18+
- Python 3.10+ (stdlib only in the studio)
- Disk: ~40 GB for `--dual`, less for smaller profiles
- Optional: [GitHub CLI](https://cli.github.com) to ship

---

## Install

```bash
git clone https://github.com/AleisterMoltley/dotLab.git
cd dotLab
chmod +x install.sh start bin/*
./install.sh --dual
```

`install.sh` pulls models, builds the `dotlab` tags from `Modelfile`, and puts `dotlab` on your PATH (`gamemaster` remains a CLI alias).

| Profile | Models | When |
|---------|--------|------|
| `--dual` | 30B MoE + 32B dense + 7B flash | Best quality |
| `--max` | 30B MoE + 7B | Strong coding, lighter critic |
| `--14b` | qwen2.5-coder:14b | 16–24 GB machines |
| `--7b` | qwen2.5-coder:7b | Laptops |

```bash
export PATH="$HOME/.local/bin:$PATH"
dotlab -h
python3 tests/run.py    # cheap suite, no Ollama
./start                 # browser studio (Ollama must be running)
```

Open **Ollama.app** before the first session. Games land in **`~/dotLab/Projects`**.

---

## First game (five minutes)

```bash
# Walkable world from a sentence
dotlab scaffold world-game --name Wilds
cd Wilds
dotlab worlds generate -p . "coastal village, pine ridge, desert canyon"
npm install && npm run dev
```

WASD to walk · click to look · Space to jump.

```bash
# Or a genre slice you can tighten immediately
dotlab scaffold web-game --genre platformer --name Skyjump
cd Skyjump && npm i && npm run dev

dotlab -p . --agent "Add a flag at the last ledge and a restart on death"
dotlab studio build -p . "one fair first death and clearer juice" --live
dotlab verify -p .
```

`--live` keeps the Play window open while the studio works.

---

## How a build works

1. **Compile the brief** into genre, loop, feel, palette, and opposition counts  
2. **Scaffold a real project** — not a chat attachment  
3. **Studio roles** design and structure the slice  
4. **Deep coder** peeks the tree, patches one pillar at a time, does not dump the whole game into context  
5. **Verify** grades the result; P0 fails block “done”  
6. **Playtest** (optional) runs headless metrics and screenshots  
7. **Ship** (optional) pushes a private GitHub repo  

The host applies feel, locks, and events. The model proposes. Invalid ops do not crash the game.

---

## Commands

```bash
# Chat
dotlab "Third-person village: walk, talk, fair first death"

# Studio
dotlab studio plan    -p DIR "brief"
dotlab studio build   -p DIR "brief" --live
dotlab studio council -p DIR "brief" --build --live
dotlab studio review  -p DIR "what is weak"

# Worlds
dotlab worlds generate -p DIR "biomes…"
dotlab worlds generate --offline -p DIR "snow village"

# Scaffolds
dotlab scaffold web-game --genre platformer --name Skyjump
dotlab scaffold world-game --name Wilds
dotlab scaffold pixel-game --name Grove
dotlab scaffold seeker-game --genre idle --name ClaimQuest
dotlab scaffold shader-lab --name NeonFrag

# Agent
dotlab -p ./Skyjump --agent "Add collectibles and a score HUD"

# Measure
dotlab live -p DIR
dotlab playtest -p DIR
dotlab verify -p DIR
dotlab skills route "juice the jump"
dotlab rlm -p DIR "deepen opposition and juice"

# Memory & ship
dotlab prefs set like "tight jumps"
dotlab wiki add -p DIR "Gravity 28" --why "user said floaty"
dotlab github login
dotlab ship -p ./Wilds -m "vertical slice"

# Local speed
dotlab turbo warmup
dotlab update --modelfile

# Optional paid model (off until you opt in)
dotlab cloud on grok
dotlab --cloud claude "Tighten coyote time"
dotlab cloud off

# OpenZoo — official floor at openzoo.fun
dotlab zoo ping
dotlab zoo quote --model x-ai/grok-4.6
dotlab zoo wallet
dotlab zoo wrap              # USDC→yUSDCx or TOKEN→wTOKENx
dotlab zoo spend             # session receipts + cap
dotlab cloud on zoo
dotlab --cloud zoo "Tighten coyote time"
dotlab kit undo -p DIR       # restore last agent step
dotlab kit recap -p DIR
```

`./start` is the same CLI with a browser UI. The header status chip (`local $0` / `zoo · $0.01`) opens the yard: wallet, QR, wrap, model search, spend. Play dashboard only *shows* who is coding — manage money in studio. **More** holds Folder / Term / Zip / Rename.

---

## OpenZoo ([openzoo.fun](https://openzoo.fun/))

OpenZoo is an optional **paid model yard**, not a zoo game. Every floor model has [leCore](https://github.com/AnOversizedMooseWithSocks/leCore) in front: the body is spilled and retrieved so a long game tree costs about a tenth of buying that same body direct. Short pings with nothing to spill are marked up (today ×3). Fail-open: if their sidecar is down they still serve, billed at direct — never extra for their outage.

There is **no API key**. You `POST` a normal OpenAI chat body to the official option:

```
https://openzoo.fun/api/v1/chat/completions
```

You get HTTP **402**. Pick yUSDCx or wTOKENx, sign one Token-2022 transfer, retry the **same URL** with `X-PAYMENT`. That is what the stall on openzoo.fun does; that is what `dotlab cloud on zoo` does.

| You want | Do this |
|----------|---------|
| See that the floor is live | `dotlab zoo ping` or **OpenZoo → Ping** in the UI |
| Price a model | `dotlab zoo quote --model x-ai/grok-4.6` |
| Get a deposit address | `dotlab zoo wallet` or **Create / show wallet** |
| Pay | Send USDC or TOKEN to that address, then wrap at [x402.accrue.fund/start](https://x402.accrue.fund/start) (raw USDC/TOKEN will not settle) |
| Route the studio through it | `dotlab cloud on zoo` or **Use OpenZoo** in the yard |
| Back to $0 local | `dotlab cloud off` or **Use local Ollama** |

Default floor model: `x-ai/grok-4.6`. Featured also: Gemini 2.5 Flash, Claude Sonnet 4, GPT-4o-mini. Hundreds more via `dotlab zoo models`. TOKEN mint: `EVULoNF4DeMBN4dGiZiDfpiiTfNZgoCvXWWgaV3epump`.

When zoo is on, the host sends **more** project, not less. A tiny ping pays markup. A full tree is the cheap path.

Session spend is capped at **$0.50** by default (`ZOO_SPEND_CAP` or `dotlab zoo set`). If a call cannot settle, the studio **falls back to local Ollama** instead of dying mid-build. Fail-open replies (200 with an empty wallet) are labeled in `dotlab zoo spend` — do not treat them as “paid and working”.

Do not use `lecore-front.fly.dev`. Memory is already in front of the floor. Wallet files stay in `config/zoo-wallet.json` (gitignored).

---

## Studio modes

| Mode | Use when |
|------|----------|
| **plan** | Design + architecture only |
| **build** | Full production loop with deep coder (default) |
| **council** | Three pitches, vote, optional build |
| **parallel** | Player / world / UI streams, then merge |
| **review** | Roast an existing project |

Use `--flat` on build only if you want a single-pass coder. Prefer the default.

---

## Quality bar

A cube on a plane is a fail.

A slice needs:

- a **place** you can read in one second  
- a **body** with real feel (accel, friction, coyote — not `pos += speed`)  
- a **verb** obvious by t=8s  
- **opposition** that pushes back  
- **juice** on every meaningful hit  
- a **fair first death** and a restart under three seconds  

Feel lives in `CONFIG` numbers. `dotlab verify -p DIR` grades without an LLM. Skill routing refuses tools the catalog cannot name.

---

## Layout

```
dotLab/
  AGENTS.md           How to patch this repo
  install.sh          Models + PATH
  Modelfile           Game-tuned system prompt
  start               Browser studio launcher
  bin/                CLI and host logic
  knowledge/          Domain packs injected by route
  lib/                Pixel, craft, shared runtime
  templates/          Scaffolds and slices
  tests/              Cheap suite (no Ollama)
  chat/  live/        Browser UIs
  playtest/           Headless runner
```

Working on the repo: read [AGENTS.md](AGENTS.md), then `python3 tests/run.py`.

---

## Models

| Tier | Default | Role |
|------|---------|------|
| **flash** | 7B | Short Q&A |
| **max** | `dotlab` | Coding |
| **dense** | dense critic | Hard refactors / review |

Editor endpoint: `http://127.0.0.1:11434/v1` · key `ollama` · model `dotlab`. See `config/README-editor.md`.

---

## License

MIT — [LICENSE](LICENSE). Copyright 2026 AleisterMoltley.

Runtime: [Ollama](https://ollama.com), Qwen coder weights, [Three.js](https://threejs.org). Optional cloud APIs and the [OpenZoo](https://openzoo.fun/) x402 floor are yours to enable.

---

**Ship the game. Pay $0 unless you choose not to.**
