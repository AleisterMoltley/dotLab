# Local LLM stack (dotLab)

Host-owned guidance from the awesome-local-llm survey. **Ollama remains default.**

## Tiers
| Tier | Role | Typical tags |
|------|------|----------------|
| flash | route, draft JSON, short QA | `qwen2.5-coder:14b` (≥16 GB), else `dotlab-flash` / 7B |
| max | agent / game code | `dotlab`, `qwen3-coder:30b`, `qwen3-coder-next`, `devstral-2` |
| dense | critic / hard refactor | `dotlab-dense`, `qwen2.5-coder:32b` |
| embed | slice RAG | `nomic-embed-text`, optional `qwen3-embedding` |
| rerank | optional | `DOTLAB_RERANK=<tag>` |

## Commands
```bash
gamemaster models recommend          # llmfit-style picks for this machine
gamemaster models list
gamemaster models gate --approve TAG # after turbo bench
gamemaster turbo status              # hardware-fit + loaded models
gamemaster turbo bench
gamemaster redteam                   # garak-light host probes
gamemaster bank show -p ./game
gamemaster lora export               # SFT JSONL for Unsloth/Kiln (offline train)
gamemaster live-docs refresh
```

## Env knobs
| Env | Default | Effect |
|-----|---------|--------|
| `DOTLAB_ROUTER` | `rules` | `llm` = optional flash tier router |
| `DOTLAB_BULLSHIT` | `1` | nonsense / injection gate on ask |
| `DOTLAB_SANDBOX` | `0` | strip secrets from agent `run` env |
| `DOTLAB_RERANK` | empty | Ollama tag for RAG rerank |
| `DOTLAB_EMBED` | `nomic-embed-text` | embeddings model |
| `DOTLAB_MODEL_GATE` | `1` | require bench before default switch |
| `DOTLAB_RAM_GB` | auto | override RAM for recommend |

## When to leave Ollama
- **Apple Silicon plateaus** → try [omlx](https://github.com/jundot/omlx) / mlx-lm as a *side* server; keep OpenAI-compatible proxy if needed.
- **True speculative decoding** → SpecForge + sglang (Linux GPU); our host already does flash→max.
- **VRAM thrash on large models** → krasis hybrid runtime (research).

## Structured outputs
Director + game_ops prefer `format=json` on Ollama. Host still validates with `validate_director_json` / `game_ops.validate_op`.

## Do not pull in
LangChain, Open WebUI, CrewAI, full MCP zoo — we own the agent loop and dashboard.
