# Three.js Game Systems — ship a complete playable world

**Engine is always Three.js** (Vite + vanilla ES modules, r160+).  
Seeker = the same Three.js game + Mobile Wallet Adapter. Never switch engines.

## File tree (default vertical slice)

```
src/
  main.js          boot, resize, visibility pause
  game.js          loop, CONFIG, scene graph root
  player/
    controller.js  input → wish vel → move
    camera.js      follow / fps / orbit feel
    animation.js   mixer + state → clip
  world/
    scene.js       lights, fog, sky, ground
    terrain.js     height / tiles / streaming
    props.js       InstancedMesh scatter
    interact.js    E / tap prompts, triggers
  physics/
    world.js       arcade OR Rapier
    ragdoll.js     optional death / hit react
  ai/
    npc.js         wander / combat / schedule
  narrative/
    dialogue.js    tree + state flags
    quests.js      flags → world changes
  fx/
    juice.js       shake, hitstop, particles
    shaders.js     sky / water / toon / fullscreen
  ui/
    hud.js         score / hp / prompts
    dialogueBox.js typewriter + choices
  audio.js
  save.js
CONFIG.js          ALL feel numbers
```

## Game loop (non-negotiable)

```js
const STEP = 1 / 60;
let acc = 0, last = performance.now();
const _clock = new THREE.Clock();
function frame(now) {
  let dt = Math.min(0.05, (now - last) / 1000);
  last = now;
  acc += dt;
  input.poll();
  while (acc >= STEP) { fixedUpdate(STEP); acc -= STEP; }
  const alpha = acc / STEP;
  mixer?.update(dt);
  render(alpha);
  requestAnimationFrame(frame);
}
document.addEventListener('visibilitychange', () => {
  if (document.hidden) { /* pause rAF / audio */ }
});
```

- No `new THREE.Vector3()` in hot loops — hoist `_v _q _m _ray`.
- `renderer.outputColorSpace = THREE.SRGBColorSpace`
- `renderer.toneMapping = THREE.ACESFilmicToneMapping`
- `setPixelRatio(Math.min(devicePixelRatio, 2))` (Seeker: 1.5)
- Dispose geometry/material/textures on unload.

## Completeness bar (a "world" is not a plane + cube)

A shipped slice must include:
1. **Place** — readable lighting, fog, sky, ground material, scale
2. **Body** — controller with CONFIG feel (accel, coyote, cam lag)
3. **Matter** — collision (arcade capsule or Rapier) + gravity
4. **Life** — at least one NPC or interactable with feedback
5. **Voice** — one dialogue or bark on interact / death / pickup
6. **Juice** — hitstop or shake or shader flash
7. **Retry** — death → restart < 3s
8. **Hooks** — `window.__GF_PLAYTEST__` recordDeath/Restart/Jump

## When the user asks for a whole world

Do **not** dump a feature list. Build in this order:
1. Terrain + lighting + walk
2. One region landmark + collide
3. One NPC + dialogue tree (3 nodes)
4. One physical toy (ragdoll death OR crate OR water shader)
5. Save flags so the conversation changes once

Use `gamemaster worlds generate` when they want generated open worlds.

## Anti-patterns
- R3F unless the project is already React
- Unity / Godot / Phaser / Cannon-only tutorials
- `// ... rest of code` holes
- Allocating in `update`
- Dialogue as `alert()`
- Ragdoll as "TODO later"
- Black scene (missing lights / camera inside mesh)
