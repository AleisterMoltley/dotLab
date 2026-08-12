# Contributing

PRs welcome. **Read `AGENTS.md` first** — that is the map every human and AI should follow.

## Dev setup

```bash
./install.sh --max          # models (once)
python3 tests/run.py        # cheap suite, no Ollama
```

## Before you push

```bash
python3 tests/run.py
python3 -m py_compile bin/*.py
```

Do not commit `node_modules`, user prefs, `config/github.json`, `config/cloud.json`, or bench logs.

## Style

- User-facing text: English
- Code identifiers: English
- Shared helpers go in `bin/gmcommon.py`, not a third copy
- New LLM facts: `knowledge/` + `knowledge/INDEX.md` + `bin/turbo.py` PACKS/ROUTES
- Prefer a 20-line fix over a new abstraction
