# Game Ops — host-owned events (UPF pattern)

**LLM proposes · Host applies.** Invalid ops never crash the engine.

## Why
Free-form code rewrites cause slop. Typed events keep feel, counts, palette,
engine, and flags under host control — same idea as UPF's JSON event bus.

## Apply
```bash
gamemaster game-ops schema
gamemaster game-ops apply -p ./my-game --text '[{"type":"set_feel","gravity":28}]'
gamemaster game-ops context -p ./my-game --topics feel,slice,locks
```

API: `POST /api/projects/game-ops` `{ "path":"…", "events":[…] }`  
Agent tool: `game_ops` with multiline `events:` JSON.

## Types
| type | effect |
|------|--------|
| set_feel | CONFIG feel keys |
| set_counts | enemyCount, coinCount, roomCount, juice… |
| set_palette | three/pixel props id |
| set_vintage_palette | dmg / gbc-* |
| set_engine | three\|pixel\|vintage |
| set_genre | recompile genre tables (keeps engine) |
| set_flag | `.dotlab/flags.json` |
| lock / unlock | `slice.json` locks |
| add_room | host one-more-room |
| craft | instant patch text |
| request_context | targeted knowledge packs |
| note | audit only |

## Locks
```json
{ "locks": ["feel.gravity", "engine", "palette"] }
```
Locked paths reject later ops. Parent `feel` locks all `feel.*`.
