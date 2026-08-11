# Self-Update Protocol (Gamemaster)

Keep models and live knowledge current via `bin/self-update.py` / `gamemaster update`.

## What gets updated
1. **Ollama base models** — `ollama pull` for configured bases
2. **Custom models** — rebuild `gamemaster` + dense from Modelfile
3. **Knowledge pack** — online: snip fresh docs into `knowledge/live/`
4. **VERSION** — `config/version.json`
5. **Health check** — smoke prompt

## Offline behavior
If offline: local rebuild + integrity check only. Non-fatal.

## User commands
```bash
gamemaster update           # full self-update
gamemaster update --quick   # models only
gamemaster update --knowledge
./install.sh --dual
```

## When knowledge goes stale
Agents should say: run `gamemaster update` if APIs look outdated.
