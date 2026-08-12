# Pixel kit (Canvas2D → Three.js)

Vendored bake / pixel-art vocab / FX. **Three.js stays the game engine.** These modules paint integer pixels onto offscreen canvases; `three-bridge.js` uploads them as `NearestFilter` textures.

## Files
- `bake.js` — `bakeCanvas`, `bakeAtlas` (padding vs bleed), `bakeStack`, `BakeScene` (static + dynamic, optional 256px chunks)
- `pixelart.js` — bevels, materials, tiles, autotile, HUD, creatures, VFX, `makeBakedSprite`
- `pixelart-fx.js` — wiggle / shake / glitch / jelly / ripple / dissolve / blink / afterimage
- `three-bridge.js` — `canvasTexture`, `spriteMesh`

## Law
**Bake static shapes once. Draw animated bits live.**  
A full creature drawer every frame will tank iGPU. `makeBakedSprite(..., { rows: 16 })` for rotations; eyes/juice stay live.

## Scaffold
```bash
gamemaster scaffold pixel-game --name Grove
```
