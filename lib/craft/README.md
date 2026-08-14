# Craft kit (immutable)

Host-owned Three.js feel. The model does not rewrite these files.
It calls them. Novelty lives in `src/systems/`.

| Module | Job |
|--------|-----|
| `camera.js` | spring / fps look / chase / shake / FOV kick |
| `punch.js` | one call = hitstop + shake + sfx + hitmark |
| `pool.js` | tracer pool — never `new Mesh` per shot |
| `impact.js` | spark pool at the hit point |
| `brain.js` | idle → windup (tracks) → strike (lock) → recover |
| `mark.js` | ground ring during windup |
| `blob.js` | contact shadow under the body |
| `recoil.js` | viewmodel kick + spring |
| `vignette.js` | hurt flash, zero draw calls |
| `motion.js` | spin / bob / land squash / kill pop |
| `scale.js` | 1 unit = 1 meter |
| `juice.js` / `audio.js` / `palette.js` | time scale, WebAudio, locked hex |

`punch(stack, kind)` is the juice stack. Split sfx/shake/hitstop across
three ifs and a local 30B will forget a layer.
