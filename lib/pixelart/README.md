# Pixel engine (Canvas2D)

Vendored from the hand-coded pixel vocabulary:

- `pixelart.js` — layered solids, materials, props, UI, bake (`makeBakedSprite`)
- `pixelart-fx.js` — wiggle/shake/glitch/slice deformations + `createFxRegistry`

**Engine mode `pixel`:** pure 2D Canvas game (no Three.js).  
**Engine mode `three`:** default WebGL Three.js slice (`lib/craft`).

Do not hand-edit these files in game projects — re-vendor from product `lib/pixelart/`.
