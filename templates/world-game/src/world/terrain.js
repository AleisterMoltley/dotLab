import * as THREE from 'three';

/**
 * Height-field terrain. Vertex colors follow the region layout.
 */
export async function loadTerrain(scene) {
  const [hfRes, specRes] = await Promise.all([
    fetch('/world/heightfield.json'),
    fetch('/world/spec.json'),
  ]);
  if (!hfRes.ok) throw new Error('Missing heightfield — run: gamemaster worlds generate');
  const heightfield = await hfRes.json();
  const spec = specRes.ok ? await specRes.json() : { regions: [] };

  const { grid_size: n, world_scale: scale, heights } = heightfield;
  const layout = heightfield.layout || [];
  const geo = new THREE.PlaneGeometry(scale, scale, n - 1, n - 1);
  geo.rotateX(-Math.PI / 2);
  const pos = geo.attributes.position;
  for (let i = 0; i < heights.length && i < pos.count; i++) {
    pos.setY(i, heights[i]);
  }
  pos.needsUpdate = true;
  geo.computeVertexNormals();

  const byId = Object.fromEntries((spec.regions || []).map((r) => [r.id, r]));
  const byType = Object.fromEntries(
    (spec.regions || []).map((r) => [r.terrain_type, r]),
  );
  const colors = new Float32Array(pos.count * 3);
  const c = new THREE.Color();
  for (let i = 0; i < pos.count; i++) {
    const rid = layout[i];
    const ttype = heightfield.region_map?.[i];
    const region = (rid && byId[rid]) || (ttype && byType[ttype]) || null;
    const hex = region?.material?.color || region?.layout_color || '#3d6a32';
    c.set(hex);
    colors[i * 3] = c.r;
    colors[i * 3 + 1] = c.g;
    colors[i * 3 + 2] = c.b;
  }
  geo.setAttribute('color', new THREE.BufferAttribute(colors, 3));

  const mat = new THREE.MeshStandardMaterial({
    vertexColors: true,
    roughness: 0.92,
    metalness: 0.02,
    flatShading: false,
  });
  const mesh = new THREE.Mesh(geo, mat);
  mesh.receiveShadow = true;
  mesh.name = 'Terrain';
  scene.add(mesh);

  const hasWater = (spec.regions || []).some((r) => r.terrain_type === 'water');
  if (hasWater) {
    const water = new THREE.Mesh(
      new THREE.PlaneGeometry(scale, scale),
      new THREE.MeshStandardMaterial({
        color: 0x2a5a78,
        roughness: 0.18,
        metalness: 0.35,
        transparent: true,
        opacity: 0.82,
      }),
    );
    water.rotation.x = -Math.PI / 2;
    water.position.y = 0.35;
    water.name = 'Water';
    scene.add(water);
  }

  return {
    mesh,
    heightfield,
    spec,
    sampleHeight(wx, wz) {
      const half = scale / 2;
      const u = (wx + half) / scale;
      const v = (wz + half) / scale;
      const ix = Math.max(0, Math.min(n - 1, Math.floor(u * (n - 1))));
      const iz = Math.max(0, Math.min(n - 1, Math.floor(v * (n - 1))));
      return heights[iz * n + ix] ?? 0;
    },
    worldScale: scale,
  };
}
