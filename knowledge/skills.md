# Studio skills — route or abstain

A skill this catalog cannot name **does not exist**. Guessing a tool is a fail.

## Ask first

```
gamemaster skills suggest "juice the jump"
gamemaster skills route "make it gold"
```

Agent:

```
tool call skills
action: route
task: juice the jump
```

Decisions:
- **act** — one skill is clearly right. Call it.
- **choose** — a short list. Pick one. Do not invent a fourth.
- **abstain** — below the noise floor. Use `read_file` / `apply_patch` / `game_ops` / `done`. Do not claim a dedicated skill.

## Host owns feel

Juice, gravity, jump, palette, room count → `game_ops` (`set_feel`, `craft`, `set_palette`, `add_room`). Do not rewrite CONFIG.

## Gaps stay gaps

Unknown verbs return `ERROR: unknown tool` plus nearby catalog names. That is honesty, not a missing feature.
