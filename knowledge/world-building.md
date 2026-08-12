# World Building — Three.js open worlds (WorldClaw + hand-authored)

Generate **explorable places**, not empty planes. Y-up, meters, 1 unit = 1 m.

## WorldClaw pipeline (local)

```
prompt → spec P (regions, colors, landforms)
      → heightfield T + scatter
      → regional instances O (houses, NPCs, props) — separately editable
      → contact refine (sink / float / overlap)
assets: public/world/{spec,heightfield,instances,meta}.json
run:    gamemaster worldclaw generate -p DIR "medieval village, snow peaks, desert"
```

Spec rules: 3–6 regions, distinct `terrain_type`, `center`/`radius` 0–1, `layout_color`, `material.color`, objects only on `detail_level: high`. Do not invent themes the prompt did not imply.

## Terrain

```js
// heightfield → PlaneGeometry displaced on Y, computeVertexNormals()
const geo = new THREE.PlaneGeometry(size, size, segs, segs);
geo.rotateX(-Math.PI / 2);
const pos = geo.attributes.position;
for (let i = 0; i < pos.count; i++) {
  const x = pos.getX(i), z = pos.getZ(i);
  pos.setY(i, sampleHeight(x, z)); // bilinear from hf.grid
}
geo.computeVertexNormals();
const mesh = new THREE.Mesh(geo, new THREE.MeshStandardMaterial({
  vertexColors: true, roughness: 0.92, metalness: 0.02,
}));
```

- Multi-biome: vertex colors from region layout map, or texture splatting in a custom shader (sand / grass / rock / snow by slope + height).
- Water: second plane at sea level + fragment shader (fresnel + noise). Never a flat unlit blue box.
- Sky: `THREE.Sky` addon or gradient hemisphere + directional sun matching fog color.

## Streaming / LOD (keep 60)

- Chunk world into N×N tiles; load neighbors, dispose far (`disposeObject`).
- InstancedMesh for trees/rocks/grass (one draw per type).
- `mesh.frustumCulled = true`. Shadow: 1 dir light, map 1024, tight `shadow.camera`.
- Billboard distant trees; high-detail only in player radius.

## Lighting recipe (readable worlds)

```js
scene.background = new THREE.Color(0x87a0b8);
scene.fog = new THREE.FogExp2(0x87a0b8, 0.012);
const hemi = new THREE.HemisphereLight(0xcfe8ff, 0x3a2a18, 0.55);
const sun = new THREE.DirectionalLight(0xfff1d0, 1.35);
sun.position.set(40, 60, 20);
sun.castShadow = true;
sun.shadow.mapSize.set(1024, 1024);
sun.shadow.camera.left = sun.shadow.camera.bottom = -60;
sun.shadow.camera.right = sun.shadow.camera.top = 60;
```

Night: low hemi, moon dir, emissive windows (`mesh.material.emissive`).

## Instances (editable)

Each instance: `{ id, category, region, position, rotation, scale, editable }`.  
Pick with raycaster → gizmo (translate). Persist back to `instances.json`.  
Houses, NPCs, pickups are **unique meshes**; scatter is **instanced**.

## NPC presence

- Idle + wander on nav waypoints or flattened height.
- Interact trigger: distance < 2.2 or raycast center-screen.
- Schedule: `{ dawn: 'market', dusk: 'home' }` — cheap, readable life.
- One landmark per region so the player can navigate by sight.

## Player in a world

- Capsule move on XZ, gravity, ground ray (or Rapier capsule).
- Slope limit ~50°. Snap to heightfield Y.
- Third-person: dist 5–8, height 2.2, lag 6–10, collision-aware spring (ray cam→player).
- Fast travel later; first slice is walk + one quest.

## Scale cheatsheet

| Thing | Size (m) |
|-------|----------|
| Player capsule | r 0.35, h 1.7 |
| Door | 1.0 × 2.1 |
| Tree | 6–14 |
| House | 8–16 footprint |
| Region | 80–200 across |
| World | 128–512 |

## World is done when
Player can walk a loop that hits 2 biomes, 1 NPC conversation, 1 climb/obstacle, and a reason to go back.
