# Animation — Three.js characters (mixer, IK-lite, ragdoll blend)

## Load + clone skinned

```js
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { SkeletonUtils } from 'three/addons/utils/SkeletonUtils.js';

const gltf = await loader.loadAsync('/models/hero.glb');
const root = SkeletonUtils.clone(gltf.scene);
const mixer = new THREE.AnimationMixer(root);
const actions = Object.fromEntries(
  gltf.animations.map((c) => [c.name.toLowerCase(), mixer.clipAction(c)])
);
```

Never `gltf.scene.clone()` for skinned meshes.

## Crossfade state machine

```js
let current;
function play(name, fade = 0.15) {
  const next = actions[name];
  if (!next || current === next) return;
  next.reset().setEffectiveWeight(1).fadeIn(fade).play();
  current?.fadeOut(fade);
  current = next;
}
// loop: mixer.update(dt)  // seconds, not ms
```

Map locomotion:
- speed < 0.1 → `idle`
- speed walk band → `walk` (timeScale = speed / walkRef)
- run / jump / air / land / attack / hit / death

`action.clampWhenFinished = true` for one-shots (attack, land). Listen `mixer.addEventListener('finished', ...)`.

## Root motion vs in-place
Prefer **in-place** clips + code locomotion (capsule / Rapier).  
If clip has root translation, strip: `THREE.AnimationUtils.subclip` / zero the hips XZ tracks, keep code move.

## Procedural add-ons (cheap IK-lite)
- **Look-at:** slerp head/spine toward target, clamp yaw/pitch.
- **Foot plant:** two rays from hips, offset foot bones to hit.y; only while grounded and speed < jog.
- **Weapon aim:** rotate clavicle/spine toward aim point.
- **Hit lean:** impulse on spine bone for 120ms, then slerp back.

Do not build a full FABRIK solver unless the user asks. 1–2 bones is enough for juice.

## Ragdoll blend
Alive: mixer owns bones.  
Ragdoll: mixer stopped, physics owns bones (see `physics-ragdoll.md`).  
Get-up: sample stand pose, slerp bones 0.4s, then `play('getup')` or `idle`.

## Mixamo / Blender export
- FBX/GLB, **Y-up**, applied scale 1, -Z forward or retarget.
- Name clips: `Idle Walk Run Jump Attack Hit Death`.
- One skeleton. Texture: color SRGB, roughness/normal linear.
- Draco + KTX2 if assets are large.

## Particles as animation
Hits: pooled `Points` or small quads, not new meshes.  
Slash arc: ribbon or additive plane that scales then dies.

## Perf
- 1 mixer per character, not per mesh.
- `root.traverse`: `frustumCulled = true`, shadows only on hero + nearby.
- Seeker: bake 30fps clips, skip foot IK, max ~8 skinned characters.
