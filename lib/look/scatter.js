import * as THREE from 'three';
import { makeMat } from './materials.js';

/**
 * One InstancedMesh per kind. Never 22 separate tree Meshes.
 */
export function addScatter(scene, kind, count, radius, rnd, pal) {
  const n = Math.max(4, Math.min(80, count | 0));
  const r = radius || 24;
  if (kind === 'pine') return pine(scene, n, r, rnd, pal);
  if (kind === 'neon-window') return windows(scene, n, r, rnd, pal);
  if (kind === 'rock' || kind === 'dune-rock') return rocks(scene, n, r, rnd, pal);
  if (kind === 'alley') return alley(scene, n, r, rnd, pal);
  if (kind === 'lamp') return lamps(scene, n, r, rnd, pal);
  return rocks(scene, n, r, rnd, pal);
}

function pine(scene, n, r, rnd, pal) {
  const trunk = new THREE.InstancedMesh(
    new THREE.CylinderGeometry(0.14, 0.2, 1.5, 5),
    makeMat('bark', 0x4a3422),
    n,
  );
  const leaves = new THREE.InstancedMesh(
    new THREE.ConeGeometry(1.05, 2.5, 6),
    makeMat('moss', pal.accent || 0x3a6a32),
    n,
  );
  const dummy = new THREE.Object3D();
  for (let i = 0; i < n; i++) {
    const a = rnd() * Math.PI * 2;
    const d = 6 + rnd() * r;
    dummy.position.set(Math.cos(a) * d, 0.75, Math.sin(a) * d - 4);
    dummy.rotation.y = rnd() * 6;
    dummy.updateMatrix();
    trunk.setMatrixAt(i, dummy.matrix);
    dummy.position.y = 2.5;
    dummy.updateMatrix();
    leaves.setMatrixAt(i, dummy.matrix);
  }
  trunk.instanceMatrix.needsUpdate = true;
  leaves.instanceMatrix.needsUpdate = true;
  scene.add(trunk, leaves);
  return [trunk, leaves];
}

function windows(scene, n, r, rnd, pal) {
  const cyan = new THREE.InstancedMesh(
    new THREE.BoxGeometry(0.42, 0.62, 0.08),
    makeMat('neon', pal.grid || 0x00f0ff, {
      emissive: pal.grid || 0x00f0ff,
      emissiveIntensity: 1.15,
    }),
    n,
  );
  const mag = new THREE.InstancedMesh(
    new THREE.BoxGeometry(0.38, 0.5, 0.08),
    makeMat('neon', pal.accent || 0xff2bd6, {
      emissive: pal.accent || 0xff2bd6,
      emissiveIntensity: 0.95,
    }),
    Math.max(8, Math.floor(n * 0.45)),
  );
  const dummy = new THREE.Object3D();
  const slabs = 10;
  for (let i = 0; i < n; i++) {
    const a = ((i % slabs) / slabs) * Math.PI * 2 + 0.2;
    const rad = 15.4;
    const faceX = Math.cos(a) * rad;
    const faceZ = Math.sin(a) * rad;
    const side = ((i / slabs) | 0) % 3;
    const up = 1.1 + (i % 5) * 1.05;
    dummy.position.set(
      faceX + Math.sin(a) * (side - 1) * 1.15,
      up,
      faceZ - Math.cos(a) * (side - 1) * 1.15,
    );
    dummy.lookAt(0, up, 0);
    dummy.updateMatrix();
    cyan.setMatrixAt(i, dummy.matrix);
  }
  for (let i = 0; i < mag.count; i++) {
    const a = ((i % slabs) / slabs) * Math.PI * 2 + 0.35;
    const rad = 15.35;
    dummy.position.set(Math.cos(a) * rad, 2.2 + (i % 4) * 1.2, Math.sin(a) * rad);
    dummy.lookAt(0, dummy.position.y, 0);
    dummy.updateMatrix();
    mag.setMatrixAt(i, dummy.matrix);
  }
  cyan.instanceMatrix.needsUpdate = true;
  mag.instanceMatrix.needsUpdate = true;
  scene.add(cyan, mag);
  return [cyan, mag];
}

function rocks(scene, n, r, rnd, pal) {
  const mesh = new THREE.InstancedMesh(
    new THREE.DodecahedronGeometry(0.45, 0),
    makeMat('rust', pal.building || 0x6a5a48),
    n,
  );
  const dummy = new THREE.Object3D();
  for (let i = 0; i < n; i++) {
    const a = rnd() * Math.PI * 2;
    const d = 4 + rnd() * r;
    dummy.position.set(Math.cos(a) * d, 0.25 + rnd() * 0.2, Math.sin(a) * d);
    dummy.scale.setScalar(0.6 + rnd() * 1.4);
    dummy.rotation.set(rnd(), rnd(), rnd());
    dummy.updateMatrix();
    mesh.setMatrixAt(i, dummy.matrix);
  }
  mesh.instanceMatrix.needsUpdate = true;
  scene.add(mesh);
  return [mesh];
}

function alley(scene, n, r, rnd, pal) {
  const mesh = new THREE.InstancedMesh(
    new THREE.BoxGeometry(1.6, 5.5, 1.2),
    makeMat('wet', pal.building || 0x1a1a22),
    n,
  );
  const dummy = new THREE.Object3D();
  for (let i = 0; i < n; i++) {
    const side = i % 2 === 0 ? -4.2 : 4.2;
    dummy.position.set(side, 2.7, -2 - i * 2.1);
    dummy.updateMatrix();
    mesh.setMatrixAt(i, dummy.matrix);
  }
  mesh.instanceMatrix.needsUpdate = true;
  scene.add(mesh);
  return [mesh];
}

function lamps(scene, n, r, rnd, pal) {
  const mesh = new THREE.InstancedMesh(
    new THREE.SphereGeometry(0.18, 6, 6),
    makeMat('neon', pal.sun || 0xffc070, { emissive: pal.sun || 0xffc070, emissiveIntensity: 1.1 }),
    n,
  );
  const dummy = new THREE.Object3D();
  for (let i = 0; i < n; i++) {
    dummy.position.set((rnd() - 0.5) * r, 2.4, (rnd() - 0.5) * r);
    dummy.updateMatrix();
    mesh.setMatrixAt(i, dummy.matrix);
  }
  mesh.instanceMatrix.needsUpdate = true;
  scene.add(mesh);
  return [mesh];
}
