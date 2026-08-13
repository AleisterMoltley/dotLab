# Deep build — recursive coding

A one-shot dump of the whole project into the model is a fail. DotLab’s deep coder treats the game as an environment: peek, grep, then `sub()` one pillar at a time.

```
dotlab rlm -p ./my-game "deepen the slice"
dotlab studio build -p ./my-game "one quest"        # deep coder is default
dotlab studio build -p ./my-game "one quest" --flat  # single-pass coder
```

## Rules

- Root sees file sizes and the brief — not the full tree.
- Each `sub()` is one pillar: place, body, verb, opposition, juice.
- Opposition is mandatory. A plaza with one hoop is a toy.
- Feel numbers go through `game_ops`. Code goes through `apply_patch`.
- REPL verbs are host-parsed. No free Python eval.

## Host floor

Every new slice stamps the five pillars and ships opposition counts for the loop. Studio build uses deep coding by default.
