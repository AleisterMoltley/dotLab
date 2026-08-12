# SHIP BAR — equal or better than NEON INK vertical slice

Reference product: **NEON INK** (Grok-built skill FPS, zero external assets).
Local Gamemaster must ship slices that clear this bar for the **genre**, not a capsule demo.

## Non-negotiable (any genre)

| Pillar | Bar |
|--------|-----|
| Verb @ t=8s | Obvious without a tutorial paragraph |
| Place | Readable in 1s: fog=bg, threat contrast, landmark/neon |
| Body | Accel/friction or genre-correct feel — never `pos += speed` only |
| Juice | hitstop + flash/shake + WebAudio on every meaningful hit |
| Fair death | Telegraph, commit does not track, **R / restart <3s** |
| Complete files | No holes, P0 verify green |
| Zero assets default | Primitives + Canvas2D + WebAudio (like NEON INK) |

## Skill FPS / shooter bar (NEON INK extract)

Ship **all** of these in the first playable web-game for fps/arena:

1. **FPS camera** — eye ~1.62, FOV ≥70, pointer lock, look + WASD relative to yaw  
2. **Movement** — coyote + jump buffer + cut; **dash** (i-frames optional)  
3. **Fire** — hitscan, muzzle flash, tracer or spark, heat or fire-rate limit  
4. **ADS or precision mode** — RMB tighter spread / FOV kick  
5. **Combat feedback** — hitmarker, damage number or score punch, kill callout  
6. **Time juice** — brief hitstop / kill slow (0.04–0.08s)  
7. **Enemies** — ≥1 personality, telegraph before contact, wave or continuous pressure  
8. **Neon place** — locked palette (void/magenta/cyan/acid), night lights, grid/towers  
9. **HUD** — HP, score/combo, weapon or verb hint, death → one more run  
10. **Audio** — layered synth (shoot, hit, kill, dash, death) — silence = fail  

Score target for a **first chat build**: ≥8/10 on fun for 60s (not full commercial NEON INK).  
Agent expand path toward 9.5: multi-weapon, perks, boss every N waves, cel outline.

## NEON INK palette (lock — no drift)

| Token | Hex | Use |
|-------|-----|-----|
| void | `#0a0612` | sky, fog base |
| indigo | `#1a0a3e` | atmosphere |
| magenta | `#ff2bd6` | primary neon, player |
| cyan | `#00f0ff` | UI, tracers |
| acid | `#b8ff00` | enemy, hits, score |
| ink | `#0d0a14` | outline / silhouette |
| wet | `#1e1440` | street |
| flare | `#ffe066` | bloom / kill flash |

## Architecture fingerprint (expand toward this)

```
main → createGame
  Engine (render, clock, dpr)
  Input (keys + pointer lock)
  World (procedural place)
  Player (move, fire, dash)
  Combat (hitscan/projectiles, pools)
  Juice (time scale, shake, numbers)
  Audio (WebAudio graph)
  HUD
```

## Host vs LLM

| Layer | Owner |
|-------|--------|
| First skill-FPS slice with juice | **slice/patch host** (instant) |
| Multi-weapon, AI personalities, city LOD | agent expand |
| Full commercial content | multi-session studio |

If a local build looks like a green capsule on a plane, it **failed the ship bar**. Rebuild.
