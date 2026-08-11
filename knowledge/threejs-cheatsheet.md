# Three.js Game Cheatsheet (for local LLM context)

## Imports (r160+)
```js
import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { DRACOLoader } from 'three/addons/loaders/DRACOLoader.js';
import { SkeletonUtils } from 'three/addons/utils/SkeletonUtils.js';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
```

## Vite package.json snippet
```json
{
  "type": "module",
  "scripts": { "dev": "vite", "build": "vite build", "preview": "vite preview" },
  "dependencies": { "three": "^0.170.0" },
  "devDependencies": { "vite": "^6.0.0" }
}
```

## Temp vectors (kein new im Loop)
```js
const _v = new THREE.Vector3();
const _q = new THREE.Quaternion();
const _m = new THREE.Matrix4();
```

## Ground raycast
```js
const down = new THREE.Raycaster();
const origin = player.position.clone();
origin.y += 1;
down.set(origin, new THREE.Vector3(0, -1, 0));
const hits = down.intersectObjects(groundMeshes, true);
if (hits[0] && hits[0].distance < 1.1) {
  player.position.y = hits[0].point.y;
  velocity.y = 0;
  grounded = true;
}
```

## Keyboard map
```js
const keys = Object.create(null);
addEventListener('keydown', e => { keys[e.code] = true; });
addEventListener('keyup', e => { keys[e.code] = false; });
// keys['KeyW'], keys['Space'], keys['ShiftLeft']
```

## Pointer lock look
```js
renderer.domElement.addEventListener('click', () => renderer.domElement.requestPointerLock());
let yaw = 0, pitch = 0;
addEventListener('mousemove', e => {
  if (document.pointerLockElement !== renderer.domElement) return;
  yaw -= e.movementX * 0.002;
  pitch -= e.movementY * 0.002;
  pitch = Math.max(-1.4, Math.min(1.4, pitch));
});
```

## Third-person follow cam
```js
function updateCamera(target, yaw, dt) {
  const dist = 6, height = 2.5;
  const ideal = new THREE.Vector3(
    target.position.x + Math.sin(yaw) * dist,
    target.position.y + height,
    target.position.z + Math.cos(yaw) * dist
  );
  camera.position.lerp(ideal, 1 - Math.exp(-8 * dt));
  camera.lookAt(target.position.x, target.position.y + 1.4, target.position.z);
}
```

## GLTF + mixer
```js
const loader = new GLTFLoader();
const gltf = await loader.loadAsync('/models/hero.glb');
const model = gltf.scene;
model.traverse(o => { if (o.isMesh) { o.castShadow = true; o.receiveShadow = true; } });
const mixer = new THREE.AnimationMixer(model);
const actions = Object.fromEntries(
  gltf.animations.map(c => [c.name, mixer.clipAction(c)])
);
actions['Idle']?.play();
// loop: mixer.update(dt);
```

## InstancedMesh (many trees/rocks)
```js
const mesh = new THREE.InstancedMesh(geo, mat, count);
const dummy = new THREE.Object3D();
for (let i = 0; i < count; i++) {
  dummy.position.set(Math.random()*100-50, 0, Math.random()*100-50);
  dummy.rotation.y = Math.random() * Math.PI * 2;
  dummy.scale.setScalar(0.8 + Math.random()*0.6);
  dummy.updateMatrix();
  mesh.setMatrixAt(i, dummy.matrix);
}
mesh.instanceMatrix.needsUpdate = true;
scene.add(mesh);
```

## Dispose helper
```js
function disposeObject(obj) {
  obj.traverse(o => {
    if (o.geometry) o.geometry.dispose();
    if (o.material) {
      const mats = Array.isArray(o.material) ? o.material : [o.material];
      for (const m of mats) {
        for (const k of Object.keys(m)) if (m[k]?.isTexture) m[k].dispose();
        m.dispose();
      }
    }
  });
}
```

## AABB overlap
```js
function aabbOverlap(a, b) {
  return a.min.x <= b.max.x && a.max.x >= b.min.x
    && a.min.y <= b.max.y && a.max.y >= b.min.y
    && a.min.z <= b.max.z && a.max.z >= b.min.z;
}
```

## Simple state machine
```js
const fsm = {
  state: 'idle',
  set(s) { if (this.state !== s) { this.onExit?.(this.state); this.state = s; this.onEnter?.(s); } },
};
```

## Audio (Howler-style pattern mit WebAudio)
```js
const ctx = new AudioContext();
async function playSfx(url, vol = 0.5) {
  const buf = await fetch(url).then(r => r.arrayBuffer()).then(b => ctx.decodeAudioData(b));
  const src = ctx.createBufferSource();
  const g = ctx.createGain();
  g.gain.value = vol;
  src.buffer = buf;
  src.connect(g).connect(ctx.destination);
  src.start();
}
```

## Common bugs
- Schwarzer Screen: camera in Mesh, lights missing, renderer.domElement not in the DOM
- Mesh unsichtbar: scale 0, material side, far plane zu nah, layer mismatch
- Z-fighting: coplanar surfaces → polygonOffset oder leichte y-offset
- Lag: lights.castShadow auf zu vielen Meshes, zu hohe shadow map, new im Loop
- Texture black: colorSpace LinearSRGB vs SRGB, flipY bei GLTF
