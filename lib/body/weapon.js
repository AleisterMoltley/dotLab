import * as THREE from 'three';

/** Pulse viewmodel. Muzzle is a real point, not a floating box. */
export function makeWeapon(camera, pal) {
  const root = new THREE.Group();
  const body = new THREE.Mesh(
    new THREE.BoxGeometry(0.1, 0.12, 0.62),
    new THREE.MeshStandardMaterial({ color: 0x161820, metalness: 0.78, roughness: 0.26 }),
  );
  body.position.set(0.28, -0.26, -0.52);
  const stock = new THREE.Mesh(
    new THREE.BoxGeometry(0.08, 0.16, 0.18),
    new THREE.MeshStandardMaterial({ color: 0x0e1016, metalness: 0.4, roughness: 0.5 }),
  );
  stock.position.set(0.28, -0.34, -0.22);
  const glow = new THREE.Mesh(
    new THREE.BoxGeometry(0.045, 0.045, 0.16),
    new THREE.MeshStandardMaterial({
      color: pal.grid || 0x00f0ff,
      emissive: pal.grid || 0x00f0ff,
      emissiveIntensity: 1.2,
    }),
  );
  glow.position.set(0.28, -0.22, -0.88);
  const sight = new THREE.Mesh(
    new THREE.BoxGeometry(0.02, 0.06, 0.02),
    new THREE.MeshBasicMaterial({ color: pal.accent || 0xff2bd6, toneMapped: false }),
  );
  sight.position.set(0.28, -0.16, -0.48);
  root.add(body, stock, glow, sight);
  root.visible = false;
  camera.add(root);
  return {
    get visible() { return root.visible; },
    set visible(v) { root.visible = v; },
    applyRecoil(r) {
      root.position.set(r.x, r.y, r.z);
      root.rotation.x = r.pitch;
    },
    flash() {
      glow.material.emissiveIntensity = 3.6;
      setTimeout(() => { glow.material.emissiveIntensity = 1.2; }, 40);
    },
  };
}
