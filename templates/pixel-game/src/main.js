import * as THREE from 'three';
import { bakeCanvas } from './pixel/bake.js';
import { layeredRect, disc } from './pixel/pixelart.js';
import { spriteMesh, markCanvasDirty } from './pixel/three-bridge.js';

const CONFIG = {
  moveSpeed: 4.2,
  accel: 36,
  friction: 22,
  gravity: 26,
  jumpForce: 7.4,
  coyoteMs: 100,
  camLag: 10,
};

const WOOD = { shadow: '#3a2414', body: '#8b5a2b', hilite: '#d4a574' };
const LEAF = { shadow: '#1a4a28', body: '#2f7a3e', hilite: '#6bc56b' };
const SKIN = { shadow: '#5a3020', body: '#c47a48', hilite: '#f0c090' };

const heroCanvas = bakeCanvas(16, 20, (ctx) => {
  layeredRect(ctx, 5, 8, 6, 8, WOOD); // tunic
  disc(ctx, 8, 6, 3, SKIN);
  ctx.fillStyle = '#1a1020';
  ctx.fillRect(6, 18, 2, 2);
  ctx.fillRect(9, 18, 2, 2);
});

const treeCanvas = bakeCanvas(24, 32, (ctx) => {
  layeredRect(ctx, 10, 16, 4, 16, WOOD);
  disc(ctx, 12, 12, 9, LEAF);
});

const scene = new THREE.Scene();
scene.background = new THREE.Color(0x1a1520);
scene.fog = new THREE.Fog(0x1a1520, 12, 28);

const camera = new THREE.PerspectiveCamera(50, innerWidth / innerHeight, 0.1, 80);
const renderer = new THREE.WebGLRenderer({ antialias: false });
renderer.setPixelRatio(1);
renderer.setSize(innerWidth, innerHeight);
renderer.outputColorSpace = THREE.SRGBColorSpace;
document.body.appendChild(renderer.domElement);

scene.add(new THREE.HemisphereLight(0xcfe8ff, 0x2a1820, 0.9));
const sun = new THREE.DirectionalLight(0xffe6c0, 0.6);
sun.position.set(4, 10, 6);
scene.add(sun);

const ground = new THREE.Mesh(
  new THREE.PlaneGeometry(40, 40),
  new THREE.MeshStandardMaterial({ color: 0x2a3d28, roughness: 1 }),
);
ground.rotation.x = -Math.PI / 2;
scene.add(ground);

const player = spriteMesh(heroCanvas, 16);
player.position.set(0, 0, 0);
scene.add(player);

for (let i = 0; i < 8; i++) {
  const t = spriteMesh(treeCanvas, 16);
  t.position.set((i - 3.5) * 2.2, 0, -2 - (i % 3));
  scene.add(t);
}

const keys = Object.create(null);
addEventListener('keydown', (e) => { keys[e.code] = true; });
addEventListener('keyup', (e) => { keys[e.code] = false; });
addEventListener('resize', () => {
  camera.aspect = innerWidth / innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(innerWidth, innerHeight);
});

const vel = new THREE.Vector3();
const _wish = new THREE.Vector3();
const _ideal = new THREE.Vector3();
let last = performance.now();

function frame(now) {
  const dt = Math.min(0.05, (now - last) / 1000);
  last = now;
  _wish.set(0, 0, 0);
  if (keys.KeyW || keys.ArrowUp) _wish.z -= 1;
  if (keys.KeyS || keys.ArrowDown) _wish.z += 1;
  if (keys.KeyA || keys.ArrowLeft) _wish.x -= 1;
  if (keys.KeyD || keys.ArrowRight) _wish.x += 1;
  if (_wish.lengthSq() > 0) _wish.normalize().multiplyScalar(CONFIG.moveSpeed);
  vel.x += (_wish.x - vel.x) * Math.min(1, CONFIG.accel * dt * 0.15);
  vel.z += (_wish.z - vel.z) * Math.min(1, CONFIG.accel * dt * 0.15);
  player.position.x += vel.x * dt;
  player.position.z += vel.z * dt;

  _ideal.set(player.position.x, 4.2, player.position.z + 7);
  camera.position.lerp(_ideal, 1 - Math.exp(-CONFIG.camLag * dt));
  camera.lookAt(player.position.x, 1.2, player.position.z);

  markCanvasDirty(player);
  renderer.render(scene, camera);
  requestAnimationFrame(frame);
}
requestAnimationFrame(frame);

window.__GF_PLAYTEST__ = { recordDeath() {}, recordRestart() {}, recordJump() {} };
