# Editor integration

Gamemaster serves through Ollama’s OpenAI-compatible API:

```
Base URL:  http://127.0.0.1:11434/v1
API Key:   ollama
Model:     gamemaster
```

## Continue.dev

Merge `continue-config.snippet.json` into `~/.continue/config.json`.

## Cursor / VS Code

Set OpenAI-compatible base URL to `http://127.0.0.1:11434/v1` and model `gamemaster`.

## curl

```bash
curl http://127.0.0.1:11434/v1/chat/completions \
  -H "Content-Type: application/json" \
  -d '{"model":"gamemaster","messages":[{"role":"user","content":"Write a spinning Three.js box."}]}'
```
