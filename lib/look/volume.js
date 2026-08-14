import * as THREE from 'three';
import { makeMat } from './materials.js';

/**
 * Gameplay volume that reads as a place. Shoot loops get a ring + pit lip.
 * Scatter is dressing. This is the room.
 */
export function addVolume(scene, spec, pal) {
  const loop = (spec && spec.loop) || '';
  const genre = (spec && spec.genre) || '';
  if (loop !== 'shoot' && genre !== 'fps' && genre !== 'arena') return null;

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

  return { slab, lip, pit, radius: 14.4 };
}
