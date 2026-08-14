import * as THREE from 'three';
import { makeMat } from './materials.js';

/**
 * Genre room. Scatter is dressing. This is the volume the verb happens in.
 */
export function addVolume(scene, spec, pal) {
  const loop = (spec && spec.loop) || '';
  const genre = (spec && spec.genre) || '';
  if (loop === 'jump') return canyon(scene, pal);
  if (loop === 'run') return tunnel(scene, pal);
  if (loop === 'sneak') return corridor(scene, pal);
  if (loop === 'talk') return room(scene, pal);
  if (loop === 'race') return track(scene, pal);
  if (loop === 'shoot' || genre === 'fps' || genre === 'arena') return pitRing(scene, pal);
  return pitRing(scene, pal);
}

function pitRing(scene, pal) {
  const slab = new THREE.InstancedMesh(
    new THREE.BoxGeometry(4.4, 7.2, 1.6),
    makeMat('wet', pal.building || 0x2a1848, { emissive: pal.building || 0x2a1848, emissiveIntensity: 0.12 }),
    10,
  );
  const dummy = new THREE.Object3D();
  for (let i = 0; i < 10; i++) {
    const a = (i / 10) * Math.PI * 2 + 0.2;
    dummy.position.set(Math.cos(a) * 16.5, 3.5, Math.sin(a) * 16.5);
    dummy.lookAt(0, 3.5, 0);
    dummy.updateMatrix();
    slab.setMatrixAt(i, dummy.matrix);
  }
  slab.instanceMatrix.needsUpdate = true;
  slab.castShadow = true;
  scene.add(slab);

  const lip = new THREE.Mesh(
    new THREE.TorusGeometry(15.2, 0.22, 8, 32),
    makeMat('neon', pal.grid || 0x00f0ff, {
      emissive: pal.grid || 0x00f0ff,
      emissiveIntensity: 0.55,
    }),
  );
  lip.rotation.x = -Math.PI / 2;
  lip.position.y = 0.12;
  scene.add(lip);

  const pit = new THREE.Mesh(
    new THREE.CircleGeometry(4.2, 20),
    makeMat('asphalt', 0x07040c, { roughness: 1, metalness: 0 }),
  );
  pit.rotation.x = -Math.PI / 2;
  pit.position.y = -0.04;
  scene.add(pit);

  return { kind: 'pit', slab, lip, pit, radius: 14.4 };
}

function canyon(scene, pal) {
  const wall = new THREE.InstancedMesh(
    new THREE.BoxGeometry(80, 8, 2.2),
    makeMat('moss', pal.building || 0x3a4a30),
    2,
  );
  const dummy = new THREE.Object3D();
  dummy.position.set(22, 3.6, -6);
  dummy.updateMatrix();
  wall.setMatrixAt(0, dummy.matrix);
  dummy.position.set(22, 3.6, 6);
  dummy.updateMatrix();
  wall.setMatrixAt(1, dummy.matrix);
  wall.instanceMatrix.needsUpdate = true;
  scene.add(wall);
  return { kind: 'canyon', wall };
}

function tunnel(scene, pal) {
  const wall = new THREE.InstancedMesh(
    new THREE.BoxGeometry(1.4, 4.2, 70),
    makeMat('wet', pal.building || 0x1c1235, { emissive: pal.grid || 0x00f0ff, emissiveIntensity: 0.08 }),
    2,
  );
  const dummy = new THREE.Object3D();
  dummy.position.set(-4.4, 2.1, -18);
  dummy.updateMatrix();
  wall.setMatrixAt(0, dummy.matrix);
  dummy.position.set(4.4, 2.1, -18);
  dummy.updateMatrix();
  wall.setMatrixAt(1, dummy.matrix);
  wall.instanceMatrix.needsUpdate = true;
  scene.add(wall);
  return { kind: 'tunnel', wall };
}

function corridor(scene, pal) {
  const wall = new THREE.InstancedMesh(
    new THREE.BoxGeometry(1.8, 4.4, 8),
    makeMat('wet', pal.building || 0x1a1a22),
    6,
  );
  const dummy = new THREE.Object3D();
  for (let i = 0; i < 6; i++) {
    const side = i < 3 ? -3.6 : 3.6;
    dummy.position.set(side, 2.2, -4 - (i % 3) * 7);
    dummy.updateMatrix();
    wall.setMatrixAt(i, dummy.matrix);
  }
  wall.instanceMatrix.needsUpdate = true;
  scene.add(wall);
  return { kind: 'corridor', wall };
}

function room(scene, pal) {
  const mat = makeMat('wood', pal.building || 0x3a2a20);
  const back = new THREE.Mesh(new THREE.BoxGeometry(14, 4.2, 0.4), mat);
  back.position.set(4, 2.1, -8);
  const left = new THREE.Mesh(new THREE.BoxGeometry(0.4, 4.2, 12), mat);
  left.position.set(-3.2, 2.1, -2);
  const right = new THREE.Mesh(new THREE.BoxGeometry(0.4, 4.2, 12), mat);
  right.position.set(11.2, 2.1, -2);
  scene.add(back, left, right);
  return { kind: 'room', back, left, right };
}

function track(scene, pal) {
  const rail = new THREE.InstancedMesh(
    new THREE.BoxGeometry(0.25, 0.35, 80),
    makeMat('neon', pal.accent || 0xff2bd6, { emissive: pal.accent || 0xff2bd6, emissiveIntensity: 0.7 }),
    2,
  );
  const dummy = new THREE.Object3D();
  dummy.position.set(-8.4, 0.2, -28);
  dummy.updateMatrix();
  rail.setMatrixAt(0, dummy.matrix);
  dummy.position.set(8.4, 0.2, -28);
  dummy.updateMatrix();
  rail.setMatrixAt(1, dummy.matrix);
  rail.instanceMatrix.needsUpdate = true;
  scene.add(rail);
  return { kind: 'track', rail };
}
