# Three.js Advanced (MAX Knowledge)

## Color & Lighting (modern)
```js
renderer.outputColorSpace = THREE.SRGBColorSpace;
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 1.0;
// textures from files:
map.colorSpace = THREE.SRGBColorSpace; // color maps
// data maps (normal, roughness): leave Linear / default
```

## Shadow budget
- 1 DirectionalLight castShadow reicht oft
- mapSize 1024–2048 (mobile 512)
- shadow.camera bounds eng um Spielwelt
- `renderer.shadowMap.autoUpdate = false` + manuell wenn statische Szene

## Animation crossfade
```js
function play(name, fade = 0.2) {
  const next = actions[name];
  if (!next || current === next) return;
  next.reset().setEffectiveTimeScale(1).setEffectiveWeight(1).fadeIn(fade).play();
  current?.fadeOut(fade);
  current = next;
}
```

## Capsule player (ohne Physics)
```js
// horizontal move on XZ, integrate velocity, gravity, ground ray from center+up
// wall: cast rays in move direction at torso height, slide along normal
function slide(pos, vel, dt, obstacles) {
  const next = pos.clone().addScaledVector(vel, dt);
  // resolve X then Z separately (common arcade approach)
}
```

## Fixed timestep (Physik)
```js
const STEP = 1/60;
let acc = 0;
function tick(now) {
  let dt = Math.min(0.05, (now - last) / 1000); last = now;
  acc += dt;
  while (acc >= STEP) { fixedUpdate(STEP); acc -= STEP; }
  render(acc / STEP);
  requestAnimationFrame(tick);
}
```

## Object pool
```js
function pool(create, n=64) {
  const free = Array.from({length:n}, create);
  return {
    get() { const o = free.pop() || create(); o.visible = true; return o; },
    release(o) { o.visible = false; free.push(o); }
  };
}
```

## Rapier quick (dynamic player)
```js
import RAPIER from '@dimforge/rapier3d-compat';
await RAPIER.init();
const world = new RAPIER.World({ x:0, y:-9.81, z:0 });
const body = world.createRigidBody(RAPIER.RigidBodyDesc.dynamic().setTranslation(0,2,0));
world.createCollider(RAPIER.ColliderDesc.capsule(0.5, 0.35), body);
// loop: world.timestep = dt; world.step(); sync mesh from body.translation()
```

## GLTF clone skinned
```js
import { SkeletonUtils } from 'three/addons/utils/SkeletonUtils.js';
const clone = SkeletonUtils.clone(gltf.scene);
```

## CSS2D labels
```js
import { CSS2DRenderer, CSS2DObject } from 'three/addons/renderers/CSS2DRenderer.js';
```

## Performance checklist
- [ ] no alloc in loop
- [ ] frustumCulled true (default)
- [ ] merge static geos or instancing
- [ ] texture sizes power-of-two, compressed if possible
- [ ] pixelRatio capped at 2
- [ ] lights count low
- [ ] dispose on unload

## Common API footguns
- `mesh.position` is Vector3 — mutate with set/copy/add, don't replace with plain object
- Fog color should match background for soft horizon
- LookAt on camera every frame after position update
- AnimationMixer.update(dt) in seconds not ms
- Raycaster needs normalized mouse NDC if screen picking
