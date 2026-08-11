# Gamemaster TURBO — source this before sessions
export OLLAMA_FLASH_ATTENTION=1
export OLLAMA_KEEP_ALIVE=24h
export OLLAMA_NUM_PARALLEL=2
export OLLAMA_MAX_LOADED_MODELS=3
export OLLAMA_KV_CACHE_TYPE=q8_0
export OLLAMA_NUM_BATCH=512
# Prefer Metal; avoid CPU thrash
export OLLAMA_SCHED_SPREAD=false
