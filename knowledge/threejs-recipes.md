# Three.js recipes — paste-ready patterns (Gamemaster)

Front-load these when writing or repairing `src/game.js`.

## Boot (always)

```js
import * as THREE from 'three';
// fog color === background
scene.background = new THREE.Color(bg);
scene.fog = new THREE.Fog(bg, near, far);
renderer.outputColorSpace = THREE.SRGBColorSpace;
renderer.toneMapping = THREE.ACESFilmicToneMapping;
// 1 shadow map max for mobile
```

## Feel CONFIG

```js
const CONFIG = {
  moveSpeed: 6.2, accel: 42, friction: 26, gravity: 24,
  jumpForce: 8.2, coyoteMs: 100, jumpBufferMs: 90, jumpCut: 0.45,
  camLag: 8, camDist: 6.4, camHeight: 2.15, eyeHeight: 1.55,
  hitstopMs: 40, shakeHit: 0.12, mouseSens: 0.0022, fov: 58, hp: 3,
};
```

## Grounded jump

```js
const grounded = onGround || (now - lastGround) < CONFIG.coyoteMs / 1000;
if (jumpBuf > 0 && grounded && vy <= 0.05) { vy = CONFIG.jumpForce; jumpBuf = 0; }
if (!held && vy > 0) vy *= CONFIG.jumpCut;
```

## Spring camera (never parent to player for action)

```js
import { springTo, fpsLook, chaseIdeal, applyShake, kickFov } from './craft/camera.js';
fpsLook(camera, player.pos, yaw, pitch, _look);
chaseIdeal(_ideal, player.pos, CONFIG, spec.camera);
springTo(camera, _ideal, dt, CONFIG.camLag);
```

## FPS look + move

```js
// yaw/pitch from pointer lock; forward = (-sin yaw, 0, -cos yaw) if look is -Z
// wish dir from WASD relative to yaw; damp vx/vz toward wish * moveSpeed
```

## Hitscan shoot

```js
import { makeTracerPool } from './craft/pool.js';
import { punch } from './craft/punch.js';
tracers.spawn(origin, dir, color);
if (hits[0]) punch(stack, e.hp <= 0 ? 'kill' : 'hit');
```

## Juice minimum

```js
punch(stack, 'hit'); // TimeJuice → shake → sfx → hitmark. Do not split.
```

## WebAudio blip

```js
const o = ctx.createOscillator(), g = ctx.createGain();
o.frequency.value = freq; g.gain.value = 0.05;
o.connect(g); g.connect(ctx.destination);
o.start(); g.gain.exponentialRampToValueAtTime(0.0001, ctx.currentTime + dur);
```

## Forbidden

- `three/examples/jsm`
- `new THREE.Vector3()` inside the frame loop
- `alert()` for dialogue
- incomplete files / `// ...` holes
- inventory before the verb is fun
