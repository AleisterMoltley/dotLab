# Pixel kit (Canvas2D → Three.js)

Paint integer pixels onto offscreen canvases. `three-bridge.js` uploads them as `NearestFilter` textures. Three.js stays the game engine.

## Files
- `bake.js` — `bakeCanvas`, `bakeAtlas`, `bakeStack`, `BakeScene`
- `draw.js` — bevels, materials, tiles, autotile, HUD, creatures, VFX, `makeBakedSprite`
- `fx.js` — wiggle / shake / glitch / jelly / ripple / dissolve
- `three-bridge.js` — `canvasTexture`, `spriteMesh`

## Law
**Bake static shapes once. Draw animated bits live.**

```bash
gamemaster scaffold pixel-game --name Grove
```
