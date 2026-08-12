import * as THREE from 'three';
import { composeWorld } from './world/loader.js';

/** Explorable WorldClaw world — free-viewpoint walk (WASD + mouse). */
export function createWorldGame() {
  const scene = new THREE.Scene();
  scene.background = new THREE.Color(0x87a8c4);
  scene.fog = new THREE.Fog(0x87a8c4, 40, 220);

  const camera = new THREE.PerspectiveCamera(60, innerWidth / innerHeight, 0.1, 500);
  camera.position.set(0, 8, 16);

  const renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: 'high-performance' });
  renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
  renderer.setSize(innerWidth, innerHeight);
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFSoftShadowMap;
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  document.body.appendChild(renderer.domElement);

  const hemi = new THREE.HemisphereLight(0xb1e1ff, 0x3d4a3a, 0.55);
  const sun = new THREE.DirectionalLight(0xfff5e6, 1.15);
  sun.position.set(60, 80, 40);
  sun.castShadow = true;
  sun.shadow.camera.left = -80;
  sun.shadow.camera.right = 80;
  sun.shadow.camera.top = 80;
  sun.shadow.camera.bottom = -80;
  sun.shadow.mapSize.set(2048, 2048);
  scene.add(hemi, sun);

  let terrainApi = null;
  let yaw = 0;
  let pitch = -0.25;
  const player = { x: 0, y: 5, z: 0, vy: 0, onGround: false };
  const keys = Object.create(null);
  const CONFIG = { moveSpeed: 14, gravity: 28, jumpForce: 9, mouseSens: 0.002 };

  addEventListener('keydown', (e) => { keys[e.code] = true; });
  addEventListener('keyup', (e) => { keys[e.code] = false; });
  addEventListener('resize', () => {
    camera.aspect = innerWidth / innerHeight;
    camera.updateProjectionMatrix();
    renderer.setSize(innerWidth, innerHeight);
  });

  let pointerLocked = false;
  renderer.domElement.addEventListener('click', () => {
    renderer.domElement.requestPointerLock?.();
  });
  addEventListener('pointerlockchange', () => {
    pointerLocked = document.pointerLockElement === renderer.domElement;
  });
  addEventListener('mousemove', (e) => {
    if (!pointerLocked) return;
    yaw -= e.movementX * CONFIG.mouseSens;
    pitch = THREE.MathUtils.clamp(pitch - e.movementY * CONFIG.mouseSens, -1.2, 0.6);
  });

  function updateCamera() {
    const dist = 0.1;
    camera.position.set(
      player.x + Math.sin(yaw) * Math.cos(pitch) * -8,
      player.y + 3.5 - pitch * 4,
      player.z + Math.cos(yaw) * Math.cos(pitch) * -8
    );
    camera.lookAt(player.x, player.y + 1.2, player.z);
  }

  function update(dt) {
    if (!terrainApi) return;
    const fwd = new THREE.Vector3(-Math.sin(yaw), 0, -Math.cos(yaw));
    const right = new THREE.Vector3(Math.cos(yaw), 0, -Math.sin(yaw));
    let mx = 0, mz = 0;
    if (keys['KeyW'] || keys['ArrowUp']) { mx += fwd.x; mz += fwd.z; }
    if (keys['KeyS'] || keys['ArrowDown']) { mx -= fwd.x; mz -= fwd.z; }
    if (keys['KeyA'] || keys['ArrowLeft']) { mx -= right.x; mz -= right.z; }
    if (keys['KeyD'] || keys['ArrowRight']) { mx += right.x; mz += right.z; }
    const len = Math.hypot(mx, mz);
    if (len > 0) { mx = (mx / len) * CONFIG.moveSpeed * dt; mz = (mz / len) * CONFIG.moveSpeed * dt; }
    player.x += mx;
    player.z += mz;

    const ground = terrainApi.sampleHeight(player.x, player.z) + 1.6;
    player.vy -= CONFIG.gravity * dt;
    player.y += player.vy * dt;
    if (player.y <= ground) {
      player.y = ground;
      player.vy = 0;
      player.onGround = true;
    } else {
      player.onGround = false;
    }
    if (player.onGround && keys['Space']) {
      player.vy = CONFIG.jumpForce;
    }
    updateCamera();
  }

  let last = performance.now();
  function frame(now) {
    const dt = Math.min(0.05, (now - last) / 1000);
    last = now;
    update(dt);
    renderer.render(scene, camera);
    requestAnimationFrame(frame);
  }

  async function boot() {
    const hud = document.getElementById('hud');
    try {
      const metaRes = await fetch('/world/meta.json');
      const meta = metaRes.ok ? await metaRes.json() : {};
      const world = await composeWorld(scene);
      terrainApi = world.terrain;
      player.y = terrainApi.sampleHeight(0, 0) + 2;
      hud.innerHTML = `<strong>${meta.theme || 'WorldClaw World'}</strong><br><small>${meta.instance_count ?? '?'} instances · WASD move · click to look · Space jump</small>`;
      requestAnimationFrame(frame);
    } catch (err) {
      hud.textContent = `WorldClaw: ${err.message}`;
      console.error(err);
    }
  }

  window.__GF_PLAYTEST__ = window.__GF_PLAYTEST__ || {};

  return {
    start() { boot(); },
    scene,
    get player() { return player; },
  };
}
