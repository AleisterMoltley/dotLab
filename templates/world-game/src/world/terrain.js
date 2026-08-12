import * as THREE from 'three';

/**
 * WorldClaw global terrain — heightfield from semantic layout (paper Eq. 6).
 * Reads public/world/heightfield.json + spec.json for region materials.
 */
export async function loadTerrain(scene) {
  const [hfRes, specRes] = await Promise.all([
    fetch('/world/heightfield.json'),
    fetch('/world/spec.json'),
  ]);
  if (!hfRes.ok) throw new Error('Missing heightfield — run: gamemaster worldclaw generate');
  const heightfield = await hfRes.json();
  const spec = specRes.ok ? await specRes.json() : { regions: [] };

  const { grid_size: n, world_scale: scale, heights } = heightfield;
  const geo = new THREE.PlaneGeometry(scale, scale, n - 1, n - 1);
  geo.rotateX(-Math.PI / 2);
  const pos = geo.attributes.position;
  for (let i = 0; i < heights.length; i++) {
    pos.setY(i, heights[i]);
  }
  pos.needsUpdate = true;
  geo.computeVertexNormals();

  const regionColors = Object.fromEntries(
    (spec.regions || []).map((r) => [r.terrain_type, r.material?.color || '#1a3d2e'])
  );

  const mat = new THREE.MeshStandardMaterial({
    color: 0x1a3d2e,
    roughness: 0.92,
    metalness: 0.02,
    flatShading: false,
  });

  const mesh = new THREE.Mesh(geo, mat);
  mesh.receiveShadow = true;
  mesh.name = 'WorldClawTerrain';
  scene.add(mesh);

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
