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
| P1 Best-of-N | Verify-rescue flash patches if P0 still fails | `studio.pipeline_build` when `DOTLAB_BEST_OF≥2` (default 2) |
| P0 Play gate | 8s bot: runtime, canvas, restart, slop | `play_gate.evaluate_report` |
| P1 Host floor | Genre CONFIG + pit death, no LLM | `host_floor.apply` after coder |
| P1 Novelty jail | Studio/RLM writes `src/systems/*` only | `host_floor.jail_write_ok` |
| P1 Few-shots | Golden @@ patches instead of 4k law | `host_floor.fewshot_block` |
| P0 Fuzzy patch | Whitespace / line-stripped search rescue | `quality.find_search_span` |
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
export DOTLAB_BEST_OF=2          # verify-rescue flash patches if P0 still fails
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

## Priority stack (quality · tempo · security)

| # | Feature | Module |
|---|---------|--------|
| 1 | Genre contracts (fps/platformer/arena/runner) | `verify.genre_contract` |
| 2 | Run allowlist + write jail | `security.py` + `agent` |
| 3 | Critic feel → host patch only | `quality.extract_critic_feel` / `apply_feel_tweaks` |
| 4 | Secrets + package allowlist | `security` + verify P0 |
| 5 | Step caps + flash non-code | `agent`, `studio` architect/critic |
| 6 | Patch-level best-of-N | `quality.patch_level_best_of` |
| 7 | Golden slice CI | `bin/golden.py` |
| 8 | Stream-apply on ask | `server` `/api/ask` `stream:true` |
| 9 | Prompt-injection isolation | `security.isolate_untrusted` |
| 10 | AST-safe patch (`node --check`) | `quality.ast_safe_replace` |

```bash
gamemaster golden
gamemaster golden --json
gamemaster golden --screenshots   # optional Playwright
gamemaster eval-briefs            # 20 fixed briefs → host slice ship-rate
gamemaster antislope check -p DIR
gamemaster antislope taste -p DIR tighter|juice|keep
```

## Anti-slop layer

| Gate | Mechanism |
|------|-----------|
| Immutable craft/kits | write blocked on `src/craft/*`, `src/kits/*` |
| Silence on hit | verify P0 for shoot loops |
| Palette lock | reject purple/green fog on neon ship-bar |
| Feel ranges | reject CONFIG 1/1/1 |
| Format-on-write | Biome → Prettier → normalize |
| Gallery RAG | `knowledge/anti-slop/*` injected into agent |
| Taste buttons | Keep / Tighter / Juice (host, no LLM) |
| Brief eval | `evals/briefs.json` + `eval-briefs` |
| Screenshots | golden `--screenshots` + RGB histogram slop hints |

## Scoreboard (not tok/s)

1. Time-to-playable (prompt → P0 green)
2. verify score + P0 fail rate
3. Human accept rate (prefs / keep)
4. Prefill size per agent turn
5. `gamemaster golden` green
