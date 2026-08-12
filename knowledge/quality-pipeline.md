# Quality pipeline (dotLab)

Host-side ship-rate system. Goal: **faster wall-clock** and **higher P0 pass rate** without a bigger model.

## Layers

| Phase | What | Where |
|-------|------|--------|
| P0 Patch-only | `@@ file` / search-replace; block full replace of large `src/game.js` | `quality.py`, `agent.py`, `slice.apply_model_files` |
| P0 Director JSON | Machine-readable design → host slots | `studio.role_director`, `slots.py` |
| P0 Stable prefix | Strip volatile system lines; keep_alive 24h | `cloud.ollama_chat`, `quality.strip_volatile_system` |
| P0 Dual warm | flash + max resident | `turbo.warmup`, `start`, `quality.ensure_dual_warmup` |
| P0 Draft→max | Host speculative: flash drafts, max refines | `quality.draft_then_max` (+ optional Ollama `draft` field) |
| P1 Best-of-N | N coder runs, verify score picks winner | `studio.pipeline_build` when `DOTLAB_BEST_OF≥2` |
| P1 Auto-critic | One critic + one repair max | `quality.auto_critic_and_repair` |
| P1 Genre slots | Host novelty/weapon/enemy modules | `slots.py` → `src/slots/runtime.js` |
| P2 Stream-apply | Apply patches as `@@ end` closes | `quality.stream_extract_and_apply` |
| P2 Play auto-repair | play.log → diagnose → one repair | `quality.play_error_auto_repair`, `POST …/repair` |
| P2 Slice RAG | Embeddings/keyword over successful projects | `rag.py` |
| P3 Accept pairs | Log patches for future LoRA | `.dotlab/lora-pairs/`, `config/lora-pairs/` |
| P3 Prefix cache | Client hash of system prefix | `quality.prefix_cache_*` |

## Env knobs

```bash
export DOTLAB_SPECULATIVE=1      # host draft→max (default on)
export DOTLAB_BEST_OF=1          # set 2 for dual coder + verify pick
export DOTLAB_DRAFT=dotlab-flash # draft model tag
export DOTLAB_EMBED=nomic-embed-text
export OLLAMA_KEEP_ALIVE=24h
export OLLAMA_MAX_LOADED_MODELS=2
export OLLAMA_NUM_PARALLEL=2
```

## CLI

```bash
gamemaster quality warmup
gamemaster quality score -p ./game
gamemaster rag rebuild
gamemaster rag query "fps dash hitstop"
gamemaster slots -p ./game --director-json path.json
```

## Scoreboard (not tok/s)

1. Time-to-playable (prompt → P0 green)
2. verify score + P0 fail rate
3. Human accept rate (prefs / keep)
4. Prefill size per agent turn
