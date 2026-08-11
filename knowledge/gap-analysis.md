# Gap Analysis — Gamemaster vs Cloud (Grok / Cursor / Claude / Codex)

## What cloud AIs often do better
| Capability | Cloud | Unser Gap | Local Fix |
|------------|-------|-----------|-----------|
| Multi-agent parallel | Codex, Cursor 3 | Single agent | **Studio multi-agent** |
| Best-of-N designs | Cursor `/best-of-n` | 1 answer | **best-of-n + council vote** |
| Plan → execute | Claude Code | Weak planning | **Director + Architect phases** |
| Peer review | Human + multi-agent | No critic | **Critic / Playtest agent** |
| Huge context / repo map | Claude 1M | 65k | Repo map + focused reads |
| Vision / Art | Grok Imagine | None local | Hybrid: Grok for art |
| Fresh web knowledge | Online | Offline | `gamemaster update` |
| Overnight async | Codex cloud | Manual | Launchd + queue (future) |
| Tab autocomplete polish | Cursor 72% | 7b ok | Keep 7b for FIM |
| Fun / design taste | Grok strong | Code-biased | **Director (fun-first)** |

## What we can do BETTER (game focus)
1. **Genre-spezifische Feel-Bibliothek** (coyote, juice, wave curves) — generalists ignore
2. **Vertical-slice pipeline** enforced every task
3. **Playtest rubric** (death→retry time, clarity, juice checklist)
4. **Shader + Game + Seeker** in one stack
5. **$0 forever**, private, offline
6. **Council of specialists** tuned only for games (not general software)

## Missing → Priority
P0: Multi-agent studio (director/architect/coder/critic)
P0: Best-of-N design pitches + synthesis
P1: Auto DESIGN.md / session memory
P1: Playtest harness + metrics comments in code
P2: Parallel file workers (player vs world vs ui)
P2: Repo map generator
P3: Browser playtest headless (playwright screenshot loop)
P3: Local LoRA / preference memory ("user likes tight jumps")
