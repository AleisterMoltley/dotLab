# Gamemaster Studio Playbook

## When to use which mode

| Mode | Command | Use when |
|------|---------|----------|
| **council** | `studio council -p DIR "…"` | Unclear idea — need 3 pitches + vote |
| **council+build** | `… --build` | From zero idea to playable |
| **plan** | `studio plan -p DIR "…"` | Design+architecture only |
| **build** | `studio build -p DIR "…"` | Full Director→Architect→Coder→Critic→Fix |
| **parallel** | `studio parallel -p DIR "…"` | Bigger slice: player/world/ui parallel |
| **review** | `studio review -p DIR "…"` | Existing project roast |

## Agent roles (local free clone of Cursor/Codex patterns)
- **Director** ≈ Grok design taste / fun-first
- **Architect** ≈ Claude plan mode
- **Coder** ≈ Codex implementer + tools
- **Critic** ≈ multi-agent peer review (Luden-style)
- **Council** ≈ Cursor best-of-N

## Artifacts
```
project/
  DESIGN.md                 living doc (auto-appended)
  .gamemaster/studio/        all agent transcripts
```

## Tips for best games
1. Start with `council` for originality
2. Then `build` or `parallel` for code
3. Human play 2 minutes → `review` → `agent` fix
4. Keep vertical slice sacred — Critic will kill scope

## Parallelism note
Ollama on one GPU serializes inference; ThreadPool still overlaps prompt prep.
Set `GAMEMASTER_PARALLEL=1` if RAM pressure; `=2` default on 48GB.
