# GROK CRAFT — how a frontier pair ships a game (compressed)

This is not chat personality. It is the decision tree that beats dump-and-pray.

## First 30 seconds (always)

1. Name the **verb** in one sentence. If you cannot, ask one question — not five.
2. Name **t=8s**: what the player does after eight seconds of control.
3. Name **one novelty**. Everything else is kill list or DESIGN.md Future.
4. Pick a **place palette** (8 hex) and **feel row** from feel-tables. Numbers first, systems later.
5. Ship a **complete loop**: place · body · challenge · juice · fail · restart <3s.

Never start with inventory, skill tree, UI shell, or netcode.

## Decision tree (player complains)

| They say | You do (numbers, not features) |
|----------|--------------------------------|
| floaty / schwammig | gravity ↑ 10–20%, keep jumpForce |
| sticky / stiff | friction ↓, accel ↑ |
| icy / slippery | accel ↓, friction ↓ |
| camera sick | camLag 6–8, never parent cam to mesh |
| boring | one novelty + juice stack, not 3 systems |
| too hard | telegraph longer, less simultaneous attackers, +1 hp |
| too easy | enemy speed ↑, count ↑, telegraph shorter |
| dark / unreadable | fog=bg, threat contrast, door 2.1m |
| slow to restart | R / click restart <3s, no menus |

## Genre → minimum systems (do not invent extra)

| Genre | Must ship | Cut |
|-------|-----------|-----|
| FPS / shooter | look, move, fire, 1 enemy type, die, R | inventory, ADS polish |
| Platformer | coyote+buffer+cut, 1 hazard, coin, pit death | double-jump until jump is good |
| Adventure | walk, 1 NPC talk→flag, 1 world change | quest log UI |
| Runner | auto-run, 3 lanes or strafe, 1 hazard, speed ramp | story |
| Racing | accel, steer damp, 1 gate lap, restart | sim suspension |
| Horror | slow move, limited light, 1 hunter, door win | jump scares spam |

## Continue path (local tool law)

Most continues are **spec edits**, not full rewrites:

- feel keys → mutate CONFIG, re-render slice
- more/fewer enemies → mutate counts, re-render
- palette words (neon/forest/…) → swap palette, re-render
- "make it a platformer" → recompile genre, keep title
- only open features (dialogue tree, ragdoll, shader, inventory) need the LLM agent

If the model would only change numbers, **do not call the model**.

## Code shape (Three.js)

```
src/main.js     boot only
src/game.js     createGame + CONFIG + loop
WIKI.md         durable facts (palette, feel, verb)
DESIGN.md       future / kill list
```

Rules: fog=background · no `new Vector3` in loop · `three/addons` never `examples/jsm` · complete files · `__GF_PLAYTEST__` hooks · WebAudio blip on hit.

## Taste voice

"The fun is X. We cut Y."  
Mushy pitch → three options → pick one.  
Arcade unless the joke is the sim.  
Silence = broken. Juice: hitstop → flash → shake → blip.

## Stop conditions

- Cube on a plane = FAIL
- 12 systems at 20% = cut to 3 at 100%
- Black screen = lights/camera/DOM first
- P0 verify fail = repair only, no features
