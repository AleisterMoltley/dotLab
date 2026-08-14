import * as THREE from 'three';

/**
 * Tracer / spark pool. Never new Mesh per shot.
 */
export function makeTracerPool(scene, n = 28) {
  const geo = new THREE.BoxGeometry(0.04, 0.04, 2.2);
  const _fwd = new THREE.Vector3(0, 0, 1);
  const _n = new THREE.Vector3();
  const items = [];
  for (let i = 0; i < n; i++) {
    const mat = new THREE.MeshBasicMaterial({
      color: 0x00f0ff,
      toneMapped: false,
      transparent: true,
      opacity: 0,
    });
    const mesh = new THREE.Mesh(geo, mat);
    mesh.visible = false;
    scene.add(mesh);
    items.push({ mesh, life: 0 });
  }
  let i = 0;
  return {
    spawn(origin, dir, color) {
      const t = items[i % items.length];
      i += 1;
      t.life = 0.08;
      t.mesh.visible = true;
      t.mesh.material.color.set(color || 0x00f0ff);
      t.mesh.material.opacity = 0.9;
      _n.copy(dir).normalize();
      t.mesh.position.copy(origin).addScaledVector(_n, 1.4);
      t.mesh.quaternion.setFromUnitVectors(_fwd, _n);
    },
    tick(dt) {
      for (const t of items) {
        if (t.life <= 0) {
          t.mesh.visible = false;
          continue;
        }
        t.life -= dt;
        t.mesh.material.opacity = Math.max(0, t.life * 10);
        if (t.life <= 0) t.mesh.visible = false;
      }
    },
  };
}
