import * as THREE from 'three';
import { composeWorld } from './world/loader.js';
import { setInstanceDebug } from './world/instances.js';

/** Explorable open world — free-viewpoint walk (WASD + mouse). */
export function createWorldGame() {
  const scene = new THREE.Scene();
  const bg = 0x87a8c4;
  scene.background = new THREE.Color(bg);
  scene.fog = new THREE.Fog(bg, 40, 220);

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
  sun.shadow.mapSize.set(1024, 1024);
  scene.add(hemi, sun);

  const CONFIG = {
    moveSpeed: 14,
    accel: 28,
    friction: 18,
    gravity: 28,
    jumpForce: 9,
    coyoteMs: 100,
    camLag: 8,
    mouseSens: 0.002,
  };

  let terrainApi = null;
  let instanceGroup = null;
  let yaw = 0;
  let pitch = -0.25;
  const player = { x: 0, y: 5, z: 0, vy: 0, onGround: false };
  const keys = Object.create(null);
  const _fwd = new THREE.Vector3();
  const _right = new THREE.Vector3();
  const _ideal = new THREE.Vector3();

  addEventListener('keydown', (e) => {
    keys[e.code] = true;
    if (e.code === 'Digit1') setInstanceDebug(instanceGroup, false);
    if (e.code === 'Digit2') setInstanceDebug(instanceGroup, true);
  });
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

  function update(dt) {
    if (!terrainApi) return;
    _fwd.set(-Math.sin(yaw), 0, -Math.cos(yaw));
    _right.set(Math.cos(yaw), 0, -Math.sin(yaw));
    let mx = 0;
    let mz = 0;
    if (keys.KeyW || keys.ArrowUp) { mx += _fwd.x; mz += _fwd.z; }
    if (keys.KeyS || keys.ArrowDown) { mx -= _fwd.x; mz -= _fwd.z; }
    if (keys.KeyA || keys.ArrowLeft) { mx -= _right.x; mz -= _right.z; }
    if (keys.KeyD || keys.ArrowRight) { mx += _right.x; mz += _right.z; }
    const len = Math.hypot(mx, mz);
    if (len > 0) {
      mx = (mx / len) * CONFIG.moveSpeed * dt;
      mz = (mz / len) * CONFIG.moveSpeed * dt;
    }
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
    if (player.onGround && keys.Space) player.vy = CONFIG.jumpForce;

    _ideal.set(
      player.x + Math.sin(yaw) * Math.cos(pitch) * -8,
      player.y + 3.5 - pitch * 4,
      player.z + Math.cos(yaw) * Math.cos(pitch) * -8,
    );
    camera.position.lerp(_ideal, 1 - Math.exp(-CONFIG.camLag * dt));
    camera.lookAt(player.x, player.y + 1.2, player.z);
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
      instanceGroup = world.instanceGroup;
      player.y = terrainApi.sampleHeight(0, 0) + 2;
      hud.innerHTML = `<strong>${meta.theme || 'Open world'}</strong><br><small>${meta.instance_count ?? '?'} instances · WASD · click look · Space jump · 1 RGB / 2 instance</small>`;
      requestAnimationFrame(frame);
    } catch (err) {
      hud.textContent = `World: ${err.message}`;
      console.error(err);
    }
  }

  window.__GF_PLAYTEST__ = {
    recordDeath() {},
    recordRestart() {},
    recordJump() {},
  };

  return {
    start() { boot(); },
    scene,
    CONFIG,
    get player() { return player; },
  };
}
