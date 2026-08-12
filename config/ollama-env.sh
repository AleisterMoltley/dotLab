# Gamemaster TURBO — game-coding defaults (Apple Silicon friendly)
# Source from start / gamemaster CLI. Do not put secrets here.
export OLLAMA_FLASH_ATTENTION=1
export OLLAMA_KEEP_ALIVE=24h
# One heavy model at a time beats thrashing two 30Bs
export OLLAMA_NUM_PARALLEL=1
export OLLAMA_MAX_LOADED_MODELS=2
export OLLAMA_KV_CACHE_TYPE=q8_0
export OLLAMA_NUM_BATCH=512
export OLLAMA_SCHED_SPREAD=false
# Prefer Metal; leave runner free to pick
export OLLAMA_LLM_LIBRARY="${OLLAMA_LLM_LIBRARY:-}"
