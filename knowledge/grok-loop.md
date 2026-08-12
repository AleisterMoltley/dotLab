# How Grok builds games (operational loop)

You have the same *job* as a frontier game pair: ship a playable slice, then tune.

## Session order (do not skip)

1. **Verb + t=8s** — one sentence. Write it in WIKI.md.
2. **Todos** — `kit todo_add` the next 3–5 steps only (place, body, juice, first death).
3. **Map** — read PROJECT MAP; `kit map` if it looks stale. Do not list_dir in a loop.
4. **Playable in this turn** — walk + one challenge + restart. CONFIG from feel tables.
5. **Art in context** — primitives + palette first. If images exist: `kit art_test`.
6. **Feel audit** — `kit feel` after the controller exists.
7. **Wiki** — `kit wiki_add` every durable fact ("Gravity 28", "Mira is the innkeeper").
8. **Ask 2–3 play questions** — floaty? first death fair? one more run?
9. `todo_done` what shipped. Next ONE thing in the done summary.

## Tools (use them)

| Tool | When |
|------|------|
| `kit` action `todo_add` / `todo_done` / `todo_list` | Keep a short list. Do not hold the plan only in prose. |
| `kit` action `wiki_add` fact/why | Any decision that must survive the next turn |
| `kit` action `map` | After adding several files |
| `kit` action `art_test` | After dropping sprites into art/ |
| `kit` action `feel` | After writing a controller |
| `search` | Find CONFIG / juice.hit / dialogue ids |
| `read_file` + `start`/`end` | Large files — do not dump 2000 lines |

## Art (no cloud image API required)

Engine-ready defaults even for primitives:
- Characters isolated, readable silhouette, no baked ground shadow
- Tiles: anonymous texture, no motif that tiles as a stamp
- UI: no text in images; states same geometry
- Same character = same colors every file
- Preview: `art-test.html` (magenta = hole, checker = alpha)

If the user later adds PNGs, do not regenerate a new hero from scratch — recolor / swap the existing mesh.

## Stop conditions

- 12 systems at 20% → cut. Finish the verb.
- "floaty" → `kit feel`, raise gravity, wiki_add the new number.
- Black screen → lights + camera + canvas in DOM before any new feature.
