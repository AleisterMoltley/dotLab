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
const k = 1 - Math.exp(-CONFIG.camLag * dt);
camera.position.lerp(ideal, k);
camera.lookAt(look);
```

## FPS look + move

```js
// yaw/pitch from pointer lock; forward = (-sin yaw, 0, -cos yaw) if look is -Z
// wish dir from WASD relative to yaw; damp vx/vz toward wish * moveSpeed
```

## Hitscan shoot

```js
_ray.setFromCamera(_ndc.set(0, 0), camera);
const hits = _ray.intersectObjects(enemyMeshes, false);
// hitstop + shake + blip; pool enemies; do not alloc meshes on kill
```

## Juice minimum

```js
// hitstop: skip update for hitstopMs
// shake: offset cam by sin(t)*shake, decay shake
// blip: AudioContext oscillator 40–80ms, gain ramp to 0
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
