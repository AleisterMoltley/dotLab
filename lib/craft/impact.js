import * as THREE from 'three';

/**
 * Hit sparks. Four cubes per spawn, pooled. Never new Mesh on a hit.
 */
export function makeImpactPool(scene, n = 24) {
  const geo = new THREE.BoxGeometry(0.07, 0.07, 0.07);
  const items = [];
  for (let i = 0; i < n; i++) {
    const mat = new THREE.MeshBasicMaterial({
      color: 0xb8ff00,
      toneMapped: false,
      transparent: true,
      opacity: 0,
    });
    const mesh = new THREE.Mesh(geo, mat);
    mesh.visible = false;
    scene.add(mesh);
    items.push({ mesh, life: 0, vx: 0, vy: 0, vz: 0 });
  }
  let i = 0;
  return {
    spawn(point, color) {
      if (!point) return;
      for (let k = 0; k < 4; k++) {
        const t = items[i % items.length];
        i += 1;
        t.life = 0.22;
        t.mesh.visible = true;
        t.mesh.position.copy(point);
        t.mesh.material.color.set(color || 0xb8ff00);
        t.mesh.material.opacity = 1;
        t.vx = (Math.random() - 0.5) * 7;
        t.vy = 2.2 + Math.random() * 4;
        t.vz = (Math.random() - 0.5) * 7;
      }
    },
    tick(dt) {
      for (const t of items) {
        if (t.life <= 0) {
          t.mesh.visible = false;
          continue;
        }
        t.life -= dt;
        t.vy -= 18 * dt;
        t.mesh.position.x += t.vx * dt;
        t.mesh.position.y += t.vy * dt;
        t.mesh.position.z += t.vz * dt;
        t.mesh.material.opacity = Math.max(0, t.life * 5);
        if (t.life <= 0) t.mesh.visible = false;
      }
    },
  };
}
