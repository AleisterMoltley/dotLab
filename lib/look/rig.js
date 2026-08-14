import * as THREE from 'three';
import { pickCard } from './cards.js';
import { makeMat } from './materials.js';
import { addScatter } from './scatter.js';
import { makeAccent, makeSky } from './shaders.js';
import { addVolume } from './volume.js';

function lcg(seed) {
  let s = (seed >>> 0) || 1;
  return () => {
    s = (Math.imul(s, 1664525) + 1013904223) >>> 0;
    return s / 4294967296;
  };
}

function addLandmark(scene, kind, pal) {
  if (kind === 'tower') {
    const m = new THREE.Mesh(
      new THREE.BoxGeometry(1.6, 9, 1.6),
      makeMat('neon', pal.building || 0x1c1235, { emissive: pal.grid || 0x00f0ff, emissiveIntensity: 0.2 }),
    );
    m.position.set(0, 4.5, -17.5);
    scene.add(m);
    return m;
  }
  if (kind === 'ridge') {
    const m = new THREE.Mesh(
      new THREE.ConeGeometry(4.5, 7, 5),
      makeMat('moss', pal.building || 0x4a5a38),
    );
    m.position.set(-14, 3.4, -22);
    scene.add(m);
    return m;
  }
  if (kind === 'spire') {
    const m = new THREE.Mesh(
      new THREE.CylinderGeometry(0.25, 0.7, 8, 6),
      makeMat('rust', pal.accent || 0xc4784a),
    );
    m.position.set(12, 4, -16);
    scene.add(m);
    return m;
  }
  if (kind === 'arch') {
    const m = new THREE.Mesh(
      new THREE.TorusGeometry(3.2, 0.45, 8, 16, Math.PI),
      makeMat('sand', pal.building || 0xc4a574),
    );
    m.rotation.z = Math.PI;
    m.position.set(0, 3.2, -20);
    scene.add(m);
    return m;
  }
  if (kind === 'door') {
    const m = new THREE.Mesh(
      new THREE.BoxGeometry(1.4, 2.2, 0.18),
      makeMat('wet', pal.accent || 0x304050, { emissive: pal.accent || 0x304050, emissiveIntensity: 0.15 }),
    );
    m.position.set(0, 1.15, -9);
    scene.add(m);
    return m;
  }
  const m = new THREE.Mesh(
    new THREE.BoxGeometry(1.8, 1.2, 1.8),
    makeMat('wood', pal.sun || 0xffc070, { emissive: pal.sun || 0xffc070, emissiveIntensity: 0.35 }),
  );
  m.position.set(0, 0.6, -6);
  scene.add(m);
  return m;
}

/**
 * Host lighting + place + scatter + one shader. Immutable.
 */
export function applyLook({ scene, renderer, camera, pal, spec }) {
  const card = pickCard(spec || {});
  const rnd = lcg((spec && spec.seed) || 1);

  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.05;
  renderer.shadowMap.enabled = !!card.shadow;
  if (card.shadow) renderer.shadowMap.type = THREE.PCFSoftShadowMap;
  try {
    renderer.setPixelRatio(Math.min(typeof devicePixelRatio === 'number' ? devicePixelRatio : 1, 1.5));
  } catch { /* */ }

  const bg = pal.bg ?? 0x0a0612;
  scene.background = new THREE.Color(bg);
  scene.fog = new THREE.Fog(bg, card.fogNear, card.fogFar);

  const hemi = new THREE.HemisphereLight(card.hemiSky, card.hemiGround, card.hemi);
  const key = new THREE.DirectionalLight(card.key, card.keyInt);
  key.position.fromArray(card.keyPos);
  if (card.shadow) {
    key.castShadow = true;
    key.shadow.mapSize.set(512, 512);
  }
  const rim = new THREE.DirectionalLight(card.rim, card.rimInt);
  rim.position.fromArray(card.rimPos);
  const fill = new THREE.DirectionalLight(card.fill, card.fillInt);
  fill.position.fromArray(card.fillPos);
  scene.add(hemi, key, rim, fill);

  const sky = makeSky(pal, card);
  scene.add(sky.mesh);

  const ground = new THREE.Mesh(
    new THREE.CircleGeometry(42, 28),
    makeMat(card.ground, pal.ground || 0x2a2a28),
  );
  ground.rotation.x = -Math.PI / 2;
  ground.receiveShadow = !!card.shadow;
  scene.add(ground);

  addVolume(scene, spec || {}, pal);
  addLandmark(scene, card.landmark, pal);
  const density = (spec && spec.density) || 1;
  const sc = card.scatter || { kind: 'rock', count: 16, radius: 20 };
  addScatter(scene, sc.kind, Math.round(sc.count * density), sc.radius, rnd, pal);

  const accent = makeAccent(card.shader, pal);
  scene.add(accent.mesh);

  if (typeof window !== 'undefined') {
    window.__GF_RENDERER__ = renderer;
    window.__GF_LOOK__ = card.id;
  }

  return {
    card,
    tick(dt) {
      if (accent.tick) accent.tick(dt);
    },
  };
}
