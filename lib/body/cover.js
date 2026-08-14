import * as THREE from 'three';

/** Readable cover. Emissive lip so a close wall is not a black slab. */
export function makeCover(scene, pal, { x = 0, z = 0, w = 1.7, h = 1.35, d = 1.15 } = {}) {
  const root = new THREE.Group();
  const body = new THREE.Mesh(
    new THREE.BoxGeometry(w, h, d),
    new THREE.MeshStandardMaterial({
      color: pal.building || 0x2a1848,
      roughness: 0.62,
      metalness: 0.22,
      emissive: pal.building || 0x2a1848,
      emissiveIntensity: 0.18,
    }),
  );
  body.position.y = h * 0.5;
  body.castShadow = true;
  const lip = new THREE.Mesh(
    new THREE.BoxGeometry(w + 0.06, 0.07, d + 0.06),
    new THREE.MeshBasicMaterial({ color: pal.grid || 0x00f0ff, toneMapped: false }),
  );
  lip.position.y = h + 0.02;
  root.add(body, lip);
  root.position.set(x, 0, z);
  scene.add(root);
  return {
    mesh: root,
    x,
    z,
    hw: w * 0.55,
    hd: d * 0.55,
  };
}
