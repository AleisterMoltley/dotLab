import * as THREE from 'three';

/**
 * Ground telegraph disc. Windup shows where the strike will land.
 * Fair first death is a ring the player can read — not a surprise chase.
 */
export function makeMarkPool(scene, n = 12) {
  const geo = new THREE.RingGeometry(0.62, 1.12, 24);
  const items = [];
  for (let i = 0; i < n; i++) {
    const mat = new THREE.MeshBasicMaterial({
      color: 0xff2bd6,
      transparent: true,
      opacity: 0,
      side: THREE.DoubleSide,
      depthWrite: false,
      toneMapped: false,
    });
    const mesh = new THREE.Mesh(geo, mat);
    mesh.rotation.x = -Math.PI / 2;
    mesh.position.y = 0.05;
    mesh.visible = false;
    scene.add(mesh);
    items.push({ mesh, id: -1, pulse: 0 });
  }
  return {
    show(x, z, id, color) {
      let t = items.find((it) => it.id === id);
      if (!t) t = items.find((it) => it.id === -1) || items[0];
      t.id = id;
      t.mesh.visible = true;
      t.mesh.position.x = x;
      t.mesh.position.z = z;
      t.mesh.material.opacity = 0.82;
      if (color != null) t.mesh.material.color.set(color);
    },
    hide(id) {
      for (const t of items) {
        if (t.id === id) {
          t.id = -1;
          t.mesh.visible = false;
          t.mesh.material.opacity = 0;
        }
      }
    },
    tick(dt, now) {
      const wobble = 0.72 + Math.sin((now || 0) * 14) * 0.16;
      for (const t of items) {
        if (t.id < 0) continue;
        t.mesh.material.opacity = wobble;
        t.mesh.scale.setScalar(0.94 + Math.sin((now || 0) * 10) * 0.08);
        t.pulse += dt;
      }
    },
  };
}
