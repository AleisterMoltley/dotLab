# Three.js — call the host kit. Do not invent a renderer.

You do **not** write lighting, camera springs, juice, or figures.
Those live in `src/look`, `src/craft`, `src/body`. Immutable.

```js
import { applyLook } from './look/index.js';
import { applyEngine } from './craft/engine.js';
import { punch } from './craft/punch.js';
import { makeTracerPool } from './craft/pool.js';
import { tickBrain, tickDirector } from './craft';
import { makePlayer, makeEnemy, tickPose } from './body/index.js';

applyEngine(camera, scene);
applyLook({ scene, renderer, camera, pal, spec: SPEC });
const player = makePlayer(scene, pal, { kind: 'visor' });
punch(stack, 'hit');
```

## Law

- Vanilla Three + Vite. Metres. Y-up (`applyEngine`).
- `three/addons/…` never `examples/jsm`
- No `new Vector3` in the loop
- No `new HemisphereLight` / `DirectionalLight` in `game.js`
- No lone `CapsuleGeometry` hero, no `IcosahedronGeometry` drone
- Novelty only in `src/systems/*.js`

## Feel CONFIG (host owns numbers)

```js
// mutate CONFIG keys. Do not rewrite createGame.
gravity: 28, coyoteMs: 110, jumpForce: 9, camLag: 8
```

## Forbidden

- `three/examples/jsm`
- `new THREE.Vector3()` inside the frame loop
- `alert()` for dialogue
- Rewriting `src/look/*` `src/craft/*` `src/body/*`
