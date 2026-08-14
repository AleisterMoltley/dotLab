# dotLab TURBO — game-coding defaults (Apple Silicon friendly)
export OLLAMA_FLASH_ATTENTION=1
export OLLAMA_KEEP_ALIVE=24h
# Dual resident models: flash draft + max coder (prefix reuse + host speculative)
export OLLAMA_NUM_PARALLEL=2
export OLLAMA_MAX_LOADED_MODELS=2
export OLLAMA_KV_CACHE_TYPE=q8_0
export OLLAMA_NUM_BATCH=512
export OLLAMA_SCHED_SPREAD=false
# Quality pipeline defaults
export DOTLAB_SPECULATIVE=1
# Verify-rescue: cheap flash patches if P0 still fails after the coder
export DOTLAB_BEST_OF=2
