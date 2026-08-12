# Game Design Patterns for Three.js (local context)

## World slice add-ons (any genre)
- One **place** with lighting/fog (not a gray plane)
- One **NPC or vendor** with a 3-node dialogue tree
- One **physical toy** (crate, ragdoll death, bounce pad)
- One **shader** accent (sky, water, hit flash, toon rim)

## Core Loop Templates

### Arena Shooter / Twin-Stick
- Player move WASD, aim mouse, shoot projectiles pool
- Wave spawner, score, hit feedback (flash + knockback)
- Enemy types: chaser, shooter, tank

### Third-Person Adventure
- Explore, interact (E), collectibles, simple NPC dialogue HTML
- Quest flags in plain object state
- Zones load/unload props by distance

### Racing / Vehicle
- Arcade: accelerate, steer, grip lerp, no full sim
- Checkpoint order, lap timer
- Camera chase with look-ahead

### Tower Defense (3D)
- Path following enemies (waypoints)
- Tower place on grid, projectiles seek
- Economy: gold per kill

### Endless Runner
- World scroll or player fixed + world moves
- Obstacle pool recycle
- Speed ramp + coin magnet

## Entity component (lightweight)
```js
const entities = [];
function spawn(components) {
  const e = { id: crypto.randomUUID(), ...components };
  entities.push(e);
  return e;
}
function system(name, fn) {
  return (dt) => { for (const e of entities) if (e[name] !== undefined) fn(e, dt); };
}
```

## Projectile pool
```js
function makePool(create, size = 64) {
  const free = Array.from({ length: size }, create);
  return {
    acquire() { return free.pop() || create(); },
    release(o) { free.push(o); },
  };
}
```

## Damage + i-frames
```js
function tryDamage(entity, amount, now) {
  if (now < (entity.invulnUntil || 0)) return false;
  entity.hp -= amount;
  entity.invulnUntil = now + 0.5;
  return true;
}
```

## Screen shake
```js
let shake = 0;
function addShake(a) { shake = Math.max(shake, a); }
function applyShake(camera, basePos) {
  if (shake > 0.001) {
    camera.position.x = basePos.x + (Math.random()-0.5) * shake;
    camera.position.y = basePos.y + (Math.random()-0.5) * shake;
    shake *= 0.9;
  } else camera.position.copy(basePos);
}
```

## Save/Load localStorage
```js
const save = () => localStorage.setItem('game', JSON.stringify(state));
const load = () => Object.assign(state, JSON.parse(localStorage.getItem('game') || '{}'));
```
