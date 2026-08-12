# Tiles + UI (local, Three.js)

## Tiles
- Job: **invisibility in repetition**. If you can point at a clump twice, the tile failed.
- Seamless: texture continues off every edge; no directional shadow.
- Platformer / side view: gravity is encoded — do **not** rotate a grass-top to make a left wall.
- Top-down + neutral light: 1 fill + 1 edge + 1 outer corner + 1 inner; rotate in engine; spend leftover budget on **fill variants**.
- Transitions (grass→dirt): paint as one flowing image, then slice. Center = pure, edges face out.
- In Three.js: `RepeatWrapping`, tile size in meters (1m grass), InstancedMesh for scatter — unique meshes only for nouns (well, shrine).

## UI
- System > piece. Same stroke/fill/padding across the set.
- States: normal → hover (bright/glow) → pressed (darker inset). **Same geometry.**
- Panels: empty, 9-slice, no lettering (engines localize).
- HUD: HTML overlay on the Three.js canvas (dialogue, HP pips). Don't texture-atlas body copy.
- Touch/Seeker: hit targets ≥48px, thumb zone bottom.
