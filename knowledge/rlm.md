# RLM — Recursive Language Models for games

Vanilla LLM: dump the whole game + every knowledge pack into one prompt.
The local 30B then writes a plaza with one hoop. That is context rot.

**RLM** (Zhang & Khattab 2025): the project is an *environment*. The root model never sees the files. It peeks, greps, and recursively `sub()`s a narrow task over a narrow snippet.

```
gamemaster rlm -p ./my-game "deepen the slice"
gamemaster studio build -p ./my-game "one quest"        # RLM coder is default
gamemaster studio build -p ./my-game "one quest" --flat # old one-shot
```

## Rules

- Root sees **sizes + query**, not source.
- Each `sub()` is **one pillar**: place, body, verb, opposition, juice.
- Opposition is mandatory. One torus is a toy. Depth report fails it.
- Feel numbers go through `game_ops`. Code goes through `apply_patch`.
- No free Python eval. REPL verbs are host-parsed.

## Why games were simple

One coder step + 8k of design/arch + 12k of packs. The model ships the minimum that still has a renderer. RLM removes that dump. Host slices spawn opposition from counts for every loop (foes, coins, hazards, NPC, rivals) before the LLM runs. Studio build uses RLM by default (`--flat` for the old dump).
