import * as THREE from 'three';

const GEometries = {
  box: () => new THREE.BoxGeometry(1, 1, 1),
  sphere: () => new THREE.SphereGeometry(0.5, 8, 6),
  cylinder: () => new THREE.CylinderGeometry(0.5, 0.5, 1, 8),
  cone: () => new THREE.ConeGeometry(0.5, 1, 8),
  capsule: () => new THREE.CapsuleGeometry(0.35, 0.5, 4, 8),
  dodecahedron: () => new THREE.DodecahedronGeometry(0.5),
};

/**
 * Load editable instance-level assets (WorldClaw §2.3).
 * Each instance is a separate mesh — individually editable in engine.
 */
export async function loadInstances(scene, terrain) {
  const res = await fetch('/world/instances.json');
  if (!res.ok) return { group: new THREE.Group(), instances: [] };
  const data = await res.json();
  const group = new THREE.Group();
  group.name = 'WorldClawInstances';
  const built = [];

  for (const inst of data) {
    const geoType = inst.geometry || 'box';
    const factory = GEometries[geoType] || GEometries.box;
    const geo = factory();
    const [sx, sy, sz] = inst.size || [2, 2, 2];
    geo.scale(sx, sy, sz);

    const color = inst.color || '#64748b';
    const mat = new THREE.MeshStandardMaterial({
      color: new THREE.Color(color),
      roughness: inst.kind === 'terrain_asset' ? 0.95 : 0.75,
      metalness: 0.05,
    });

    const mesh = new THREE.Mesh(geo, mat);
    mesh.name = inst.id;
    mesh.userData.worldclaw = { ...inst, editable: inst.editable !== false };
    mesh.position.set(inst.position.x, inst.position.y, inst.position.z);
    mesh.rotation.y = inst.rotation_y || 0;
    const sc = inst.scale || 1;
    mesh.scale.set(sc, sc, sc);
    mesh.castShadow = true;
    mesh.receiveShadow = inst.kind === 'terrain_asset';
    group.add(mesh);
    built.push(mesh);
  }

  scene.add(group);
  return { group, instances: built };
}
