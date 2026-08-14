import * as THREE from 'three';

/** Cheap contact shadow. Reads as grounded; cheaper than a second shadow map. */
export function attachBlob(scene, { radius = 0.42, color = 0x000000 } = {}) {
  const mesh = new THREE.Mesh(
    new THREE.CircleGeometry(radius, 14),
    new THREE.MeshBasicMaterial({
      color,
      transparent: true,
      opacity: 0.32,
      depthWrite: false,
    }),
  );
  mesh.rotation.x = -Math.PI / 2;
  mesh.position.y = 0.03;
  scene.add(mesh);
  return {
    mesh,
    follow(x, z, groundY = 0.03) {
      mesh.position.set(x, groundY + 0.03, z);
    },
    hide() {
      mesh.visible = false;
    },
    show() {
      mesh.visible = true;
    },
  };
}
