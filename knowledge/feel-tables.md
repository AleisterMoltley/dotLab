# Feel tables — start here, then tune with the human

All values: **meters, seconds, Y-up**. Put every number in `CONFIG`.
`dt` clamped to 0.05. Movement: `vel += wish * accel * dt; vel.xz *= exp(-friction * dt)` or damp.

## Shared defaults (3rd person grounded)

```js
const CONFIG = {
  moveSpeed: 6.2,      // m/s walk-run blend target
  runSpeed: 8.4,
  accel: 42,           // how fast you reach target
  airAccel: 14,        // 0.25–0.4 of ground
  friction: 26,        // higher = snappier stop
  gravity: 24,         // 22–28 arcade; 9.81 only with Rapier + real masses
  jumpForce: 8.2,      // vel.y = jumpForce (arcade)
  coyoteMs: 100,
  jumpBufferMs: 90,
  jumpCut: 0.45,       // multiply vel.y if release while rising
  slopeMaxDeg: 50,
  camDist: 6.4,
  camHeight: 2.15,
  camLookY: 1.35,
  camLag: 8,           // exp lerp: 1 - exp(-lag * dt)
  camLookAhead: 1.8,   // meters along velocity
  mouseSens: 0.0022,
  pitchMin: -1.15,
  pitchMax: 1.25,
  hitstopMs: 40,
  shakeHit: 0.12,
  fov: 58,
  fovKick: 6,
};
```

## Per-genre starting points (override the shared table)

| Genre | move | grav | jump | camDist / lag | extra |
|-------|------|------|------|---------------|--------|
| Platformer | 7.0 | 28 | 9.0 | 9 / 10 | coyote 110, buffer 100, variable jump ON |
| TPS adventure | 5.6 | 22 | 7.4 | 6.5 / 7 | interact 2.2 m, soft lock optional |
| Arena twin-stick | 7.8 | 0 or 22 | — | 14 top-down / 14 | aim assist 0.12, dash 12 m/s 0.16s |
| FPS | 6.5 | 26 | 7.8 | eye 1.7 / — | accel 50, friction 30, recoil recover 12 |
| Runner | auto 10→18 | 26 | 8.5 | 8 / 12 | 3-lane lerp 14, speed +0.4 / 10s |
| Racing arcade | 0–28 | — | — | 8.5 / 6 + look-ahead 6 | steer *= 1 - speed*0.018, grip 10 |
| Horror | 3.8 / 5.5 sprint | 22 | 6.2 | 4.2 / 5 | stamina 4s, FOV 52, bob |
| Idle / tap | — | — | — | ortho or 12 | numbers punch scale 1.2→1 |
| Card | — | — | — | — | deal 40ms stagger, snap 0.18s |
| Rhythm | — | — | — | — | windows ±22/45/90ms, audio clock |

## Jump that doesn't feel like trash

```
onGround or (now - lastGrounded) < coyoteMs
OR jump was pressed within jumpBufferMs of landing
vel.y = jumpForce
if (!held && vel.y > 0) vel.y *= jumpCut
```

Moon jump? Raise **gravity** first, not lower jumpForce.
Floaty hang? Raise gravity, keep jumpForce, shorten coyote.
Stiff? Lower friction, raise accel.

## Camera that doesn't nauseate

```js
// ideal = behind yaw, up height; spring toward it
const k = 1 - Math.exp(-CONFIG.camLag * dt);
cam.position.lerp(ideal, k);
// look-ahead
lookAt.copy(target).addScaledVector(flatVel, 0.15);
lookAt.y += CONFIG.camLookY;
// collision: ray target+head → cam; if hit, sit at hit.distance - 0.2
```

Never parent the camera to the player mesh for an action game.

## Input forgiveness (use unless the genre is a precision masocore)

- Coyote + jump buffer (above)
- Stick deadzone 0.18, then remap
- Light aim assist: pull 8–14% toward nearest target in a 12° cone
- Attack buffer 80ms
- Interact: closest in 2.2 m AND 0.65 look-dot — not "E anywhere"

## Reward cadence

Action: a **hit of juice** every 6–12 s (kill, coin, perfect dodge).
Adventure: a **world tell** every 20–40 s (new landmark, bark, flag).
Idle: a **number jump** on every claim / upgrade.

If nothing happens for 20s in an action slice, spawn something or the loop is dead.

## Seeker / thumb feel

- Virtual stick left, action cluster right, all ≥48 px
- camLag +2 vs desktop (phones jitter)
- pixelRatio ≤ 1.5, shadows off or 512
- No hover. No tiny click boxes. No pointer-lock requirement.
