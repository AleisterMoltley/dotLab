import * as THREE from 'three';

const GEOMETRIES = {
  box: () => new THREE.BoxGeometry(1, 1, 1),
  sphere: () => new THREE.SphereGeometry(0.5, 8, 6),
  cylinder: () => new THREE.CylinderGeometry(0.5, 0.5, 1, 8),
  cone: () => new THREE.ConeGeometry(0.5, 1, 8),
  capsule: () => new THREE.CapsuleGeometry(0.35, 0.5, 4, 8),
  dodecahedron: () => new THREE.DodecahedronGeometry(0.5),
};

function makeMesh(inst) {
  const factory = GEOMETRIES[inst.geometry] || GEOMETRIES.box;
  const geo = factory();
  const [sx, sy, sz] = inst.size || [2, 2, 2];
  geo.scale(sx, sy, sz);
  const mat = new THREE.MeshStandardMaterial({
    color: new THREE.Color(inst.color || '#64748b'),
    roughness: inst.kind === 'terrain_asset' ? 0.95 : 0.75,
    metalness: 0.05,
  });
  const mesh = new THREE.Mesh(geo, mat);
  mesh.name = inst.id;
  mesh.userData.world = { ...inst, editable: inst.editable !== false };
  mesh.userData.baseColor = inst.color || '#64748b';
  mesh.position.set(inst.position.x, inst.position.y, inst.position.z);
  mesh.rotation.y = inst.rotation_y || 0;
  const sc = inst.scale || 1;
  mesh.scale.set(sc, sc, sc);
  mesh.castShadow = true;
  mesh.receiveShadow = inst.kind === 'terrain_asset';
  return mesh;
}

/**
 * Load instances. Scatter is InstancedMesh; regional objects stay unique.
 */
export async function loadInstances(scene, _terrain) {
  const res = await fetch('/world/instances.json');
  if (!res.ok) return { group: new THREE.Group(), instances: [] };
  const data = await res.json();
  const group = new THREE.Group();
  group.name = 'Instances';
  const built = [];

  const scatter = data.filter((i) => i.kind === 'terrain_asset');
  const regional = data.filter((i) => i.kind !== 'terrain_asset');

  const batches = new Map();
  for (const inst of scatter) {
    const key = `${inst.category}|${inst.geometry || 'box'}`;
    if (!batches.has(key)) batches.set(key, []);
    batches.get(key).push(inst);
  }
  const dummy = new THREE.Object3D();
  for (const [, list] of batches) {
    const proto = list[0];
    const factory = GEOMETRIES[proto.geometry] || GEOMETRIES.box;
    const geo = factory();
    const [sx, sy, sz] = proto.size || [1.4, 1.4, 1.4];
    geo.scale(sx, sy, sz);
    const mat = new THREE.MeshStandardMaterial({
      color: new THREE.Color(proto.color || '#57534e'),
      roughness: 0.95,
      metalness: 0.04,
    });
    const im = new THREE.InstancedMesh(geo, mat, list.length);
    im.castShadow = true;
    im.receiveShadow = true;
    im.name = `scatter:${proto.category}`;
    im.userData.world = { kind: 'terrain_asset', category: proto.category, count: list.length };
    list.forEach((inst, i) => {
      dummy.position.set(inst.position.x, inst.position.y, inst.position.z);
      dummy.rotation.set(0, inst.rotation_y || 0, 0);
      const sc = inst.scale || 1;
      dummy.scale.set(sc, sc, sc);
      dummy.updateMatrix();
      im.setMatrixAt(i, dummy.matrix);
    });
    im.instanceMatrix.needsUpdate = true;
    group.add(im);
    built.push(im);
  }

  for (const inst of regional) {
    const mesh = makeMesh(inst);
    group.add(mesh);
    built.push(mesh);
  }

  scene.add(group);
  return { group, instances: built };
}

/** Paper diagnostic: instance-id false color (key 2). */
export function setInstanceDebug(group, on) {
  if (!group) return;
  group.traverse((obj) => {
    if (!obj.isMesh || !obj.material) return;
    if (obj.isInstancedMesh) {
      obj.material.color.set(on ? '#f472b6' : (obj.userData.world?.category === 'pine' ? '#14532d' : '#57534e'));
      return;
    }
    const base = obj.userData.baseColor;
    if (on) {
      const h = Math.abs(hashHue(obj.name)) % 360;
      obj.material.color.setHSL(h / 360, 0.75, 0.52);
    } else if (base) {
      obj.material.color.set(base);
    }
  });
}

function hashHue(s) {
  let h = 0;
  for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) | 0;
  return h;
}
