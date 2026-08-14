# Speed without quality loss (dotLab TURBO)

## The real bottleneck (not “bigger model”)
Agent sessions spend most wall-time on **prompt re-processing** (system + knowledge + files every tool step), not generation.
Kimi K3 cloud wins with speculative decoding on huge MoE clusters — we cannot clone 2.8T locally, but we **can** clone their *systems* ideas:

| Frontier idea | Local free equivalent |
|---------------|----------------------|
| Speculative decoding (draft+verify) | **Tiered models**: flash drafts structure, max/dense final code |
| MoE sparsity (few active params) | **qwen3-coder:30b MoE** as default max |
| Prefix / snapshot cache | **Stable system prefix + KEEP_ALIVE 24h + warmup** |
| Right-size context | **Dynamic num_ctx** (8k–65k by task) |
| Domain specialization | **Keyword knowledge packs** (not dump-all) |
| Multi-agent orchestration | **Studio** (already) with parallel council |

## Rules we enforce
1. Never drop to a weak model for final game code (max/dense only).
2. Flash only for routing, short QA, cheap drafts. Architect + critic use max/dense.
3. Critic may use dense; implementer uses max MoE (fast active params).
4. Knowledge: route packs (shader vs seeker vs genre) — often **2–4× less prefill**.
5. Flash Attention + KV q8_0 + keep-alive always on.

## Commands
```bash
gamemaster turbo status
gamemaster turbo warmup      # load flash+max into RAM
gamemaster turbo bench       # local tok/s snapshot
gamemaster turbo route "fix wall collision"
source ~/gamemaster/config/ollama-env.sh
```

## Honest benchmark framing
- **Cloud Grok 4.5 / Kimi K3**: different hardware class; compare *task success* on games, not raw tok/s.
- **Our scoreboard**: vertical-slice ship rate, playtest error rate, prefs hit-rate, local latency p50.
- Run `gamemaster turbo bench` after upgrades; store `config/bench-latest.json`.

## Quality guardrails
- Studio Critic + Playwright still gate releases.
- Dense model for hard refactors / security-ish reviews.
- Prefs memory prevents re-learning “tight jumps” every session (saves tokens *and* quality).
