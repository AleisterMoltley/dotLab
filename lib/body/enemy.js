import * as THREE from 'three';
import { SCALE } from '../craft/scale.js';

function std(color, extra) {
  return new THREE.MeshStandardMaterial(Object.assign({
    color,
    roughness: 0.42,
    metalness: 0.35,
    emissive: color,
    emissiveIntensity: 0.85,
  }, extra || {}));
}

function drone(pal, elite) {
  const root = new THREE.Group();
  const col = elite ? (pal.grid || 0x00f0ff) : (pal.enemy || 0xb8ff00);
  const core = new THREE.Mesh(
    new THREE.OctahedronGeometry(elite ? 0.42 : 0.34, 0),
    std(col, { emissiveIntensity: elite ? 1.35 : 0.95 }),
  );
  core.position.y = 0.02;
  const ring = new THREE.Mesh(
    new THREE.TorusGeometry(elite ? 0.48 : 0.38, 0.035, 6, 14),
    new THREE.MeshBasicMaterial({ color: pal.accent || 0xff2bd6, toneMapped: false }),
  );
  ring.rotation.x = Math.PI / 2;
  root.add(core, ring);
  root.userData.ring = ring;
  return { root, core };
}

function crawler(pal) {
  const root = new THREE.Group();
  const col = pal.enemy || 0xb8ff00;
  const core = new THREE.Mesh(
    new THREE.BoxGeometry(0.7, 0.28, 0.55),
    std(col, { emissiveIntensity: 0.7 }),
  );
  core.position.y = 0.2;
  root.add(core);
  for (const [x, z] of [[-0.28, 0.2], [0.28, 0.2], [-0.28, -0.2], [0.28, -0.2]]) {
    const leg = new THREE.Mesh(
      new THREE.BoxGeometry(0.1, 0.18, 0.1),
      std(0x1a1408, { emissiveIntensity: 0.1 }),
    );
    leg.position.set(x, 0.08, z);
    root.add(leg);
  }
  return { root, core };
}

function captain(pal) {
  const root = new THREE.Group();
  const col = pal.grid || 0x00f0ff;
  const core = new THREE.Mesh(
    new THREE.CapsuleGeometry(0.32, 0.7, 4, 8),
    std(col, { emissiveIntensity: 1.2 }),
  );
  core.position.y = 0.85;
  const helm = new THREE.Mesh(
    new THREE.BoxGeometry(0.28, 0.1, 0.08),
    new THREE.MeshBasicMaterial({ color: pal.accent || 0xff2bd6, toneMapped: false }),
  );
  helm.position.set(0, 1.42, 0.2);
  const fin = new THREE.Mesh(
    new THREE.ConeGeometry(0.18, 0.55, 4),
    std(pal.accent || 0xff2bd6, { emissiveIntensity: 0.6 }),
  );
  fin.position.set(0, 1.55, -0.12);
  root.add(core, helm, fin);
  return { root, core };
}

export function makeEnemy(scene, pal, { kind = 'drone', elite = false } = {}) {
  const type = elite || kind === 'captain' ? 'captain' : kind;
  const built = type === 'crawler' ? crawler(pal)
    : type === 'captain' ? captain(pal)
      : drone(pal, elite);
  built.root.castShadow = true;
  scene.add(built.root);
  return {
    mesh: built.root,
    core: built.core,
    kind: type,
    elite: !!elite || type === 'captain',
    height: type === 'crawler' ? 0.35 : type === 'captain' ? 1.5 : SCALE.threatR,
  };
}
