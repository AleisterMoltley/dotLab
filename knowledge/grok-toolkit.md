# GROK TOOLKIT — reverse-engineered pair kit (local)

This is the operational toolbox a frontier game pair uses. The host
(`patch`, `slice`, `kit`, `verify`) implements the fast path; the LLM
implements only what the host cannot.

## Session tools (always)

| Tool | Local equivalent | When |
|------|------------------|------|
| Verb + t=8s | slice compile / WIKI | first message |
| Feel knobs | `patch` / `kit feel` | floaty, icy, stiff, speed |
| Place palette | `patch` palette words | neon, forest, ice… |
| Genre swap | `patch` / recompile | "make it a platformer" |
| Completeness gate | `verify` P0 | before done |
| File agent | `agent` | dialogue, ragdoll, shader, inventory |
| Multi-agent | `studio` | big vertical slice |
| Play while build | `live` | continuous playtest |
| Worlds offline | `worlds generate --offline` | open world geometry |

## Mental tools (decision engines)

1. **Kill list** — every feature not the verb goes to DESIGN.md Future.
2. **Numbers before systems** — floaty is gravity, not double-jump.
3. **One novelty** — if two novelties compete, ship one.
4. **Couple or dead** — talk→flag→world; hit→camera or hitstop.
5. **Fair first death** — telegraph 0.25–0.45s, commit does not track.
6. **Restart <3s** — R or click; no menus in the slice.
7. **Readable space** — fog=bg, door 2.1m, threat contrast.
8. **Silence = broken** — WebAudio blip minimum.

## Code toolkit (Three.js always)

```
src/main.js          boot only
src/game.js          createGame + CONFIG + loop
src/craft/*          IMMUTABLE — Grok feel stack (do not rewrite)
src/look/*           IMMUTABLE — place card (do not rewrite)
src/body/*           IMMUTABLE — figures + weapon + cover
WIKI.md              durable facts
DESIGN.md            future / kill list
.gamemaster/slice.json   host-owned spec (patch mutates this)
```

Call these. Do not reinvent them:

| File | Call | Why the 30B must not write this |
|------|------|----------------------------------|
| `camera.js` | `fpsLook` / `springTo` / `chaseIdeal` / `applyShake` / `kickFov` | Cam parented to mesh = sick |
| `punch.js` | `punch(stack, kind)` | Split sfx/shake/hitstop → silence |
| `pool.js` | `makeTracerPool` | `new Mesh` per shot = hitch |
| `impact.js` | `makeImpactPool` | Hits vanish with no confirm |
| `brain.js` | `tickBrain` | Strike that tracks = unfair |
| `mark.js` | `makeMarkPool` | Windup with no floor ring = cheap |
| `blob.js` | `attachBlob` | Floating capsule |
| `recoil.js` | `kickRecoil` / `springRecoil` | Random HUD kick |
| `vignette.js` | `attachVignette` | Hurt with no flash |
| `engine.js` | `applyEngine` | Unity / Z-up / no metres |
| `director.js` | `tickDirector` | Five enemies strike at once |
| `src/body/*` | `makePlayer` / `makeEnemy` / `tickPose` | Green capsule, icosahedron drone |
| `motion.js` | `spinY` / `bobY` / `squashLand` / `popOut` | Dead pickups, pop-off kills |
| `scale.js` | `SCALE.*` | Door 0.5m, eye 3m |

Patterns:
- Preallocate Vector3 outside the loop
- Coyote + jump buffer + cut-on-release
- `three/addons/…` never `examples/jsm`
- `__GF_PLAYTEST__` hooks on die/restart/jump
- Verify `craft_kit` fails a slice that vendors punch.js and does not import it

## Art toolkit (no cloud required)

Primitives + locked 8-hex palette beat missing GLBs.
Pixel path: bakeCanvas → nearest spriteMesh (kit pixel).
Base mesh first; variants recolor — never reroll the hero.

## Continue routing (host law)

| User says | Host | LLM |
|-----------|------|-----|
| floaty / faster / more enemies / neon | patch ms | no |
| make it platformer / rebuild | recompile | no |
| add dialogue / ragdoll / shader / inventory | — | agent |
| whole new world biomes | worlds offline | optional polish |

## Voice

"The fun is X. We cut Y."
Match user language for prose; English for code.
After code: 2 play questions + next ONE thing.
