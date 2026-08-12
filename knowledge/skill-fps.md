# Skill FPS recipe — compressed from NEON INK

Zero-asset, cel-neon, arcade skill shooter. Use for fps / arena / shooter prompts.

## CONFIG (start here)

```js
moveSpeed: 7.2, accel: 52, friction: 28, gravity: 28,
jumpForce: 8.4, coyoteMs: 100, jumpBufferMs: 90, jumpCut: 0.42,
dashSpeed: 22, dashMs: 140, dashCdMs: 700,
eyeHeight: 1.62, fov: 78, adsFov: 62, mouseSens: 0.002,
fireRpm: 480, spread: 18, spread: 0.014, adsSpread: 0.004,
hitstopMs: 40, killSlow: 0.42, killSlowMs: 75, hp: 100,
```

## Player loop (order)

1. Pointer lock → yaw/pitch  
2. Wish dir from WASD × yaw  
3. Ground accel/friction; air reduced accel  
4. Jump: coyote + buffer + cut  
5. Dash: impulse + optional i-frame window  
6. Fire: rate limit, spread (ADS tighter), raycast from eye  
7. Recoil punch on pitch + FOV kick recover  

## Combat

- Hitscan primary; pool tracers as thin boxes / lines  
- Head zone y > eye-0.15 for bonus damage (optional)  
- On body hit: TimeJuice.body + damage number + hitmarker  
- On kill: TimeJuice.kill + callout + score + acid flash  
- Enemies: rush when far, strafe/telegraph when near; max simultaneous attackers  

## Juice stack (NEON INK order)

1. Hitstop / time scale  
2. Camera shake  
3. Muzzle + tracer  
4. Hitmarker / damage number  
5. Kill callout (DOUBLE → RAMPAGE)  
6. WebAudio (shoot/hit/kill/dash)  
7. Optional speed lines on dash  

## Place

- FogExp2 or dense Fog matching void  
- Moon cool + magenta fill + cyan rim (night, not daylight hemi)  
- Towers with emissive bands; street grid  
- No pure black façades — indigo wet street  

## Files (when expanding beyond one game.js)

```
src/main.js
src/game.js          // or game/Game.js orchestrator
src/core/Palette.js
src/craft/juice.js   // TimeJuice, shake, numbers
src/craft/audio.js
src/player/…         // when agent expands
src/combat/…
src/world/…
```

## Explicit non-goals for first slice

Inventory UI, multiplayer, photoreal PBR, skill tree before movement is god-tier.
