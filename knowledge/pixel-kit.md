# Pixel kit — Canvas2D bake, then Three.js nearest quad

Do **not** replace Three.js with a canvas game. Paint pixels offscreen, upload with `canvasTexture` / `spriteMesh` from `src/pixel/three-bridge.js`.

```js
import { bakeCanvas } from './pixel/bake.js';
import { layeredRect, makeBakedSprite } from './pixel/draw.js';
import { spriteMesh } from './pixel/three-bridge.js';

const PAL = { shadow: '#3a2414', body: '#8b5a2b', hilite: '#d4a574' };
const hero = bakeCanvas(16, 16, (ctx) => {
  layeredRect(ctx, 4, 2, 8, 12, PAL);
});
scene.add(spriteMesh(hero, 16)); // 1m tall
```

## Bake law
- Static silhouette / body / tiles: bake **once** (`bakeCanvas`, `makeBakedSprite`, `BakeScene.draw`).
- Eyes, juice, IK, weather: **live** dynamic layers or per-frame overlay.
- Atlas: `bakeAtlas({ padding: 1, entries })` — blit `contentX/Y/W/H` so filter taps hit transparent pad, not the next sprite.
- Huge worlds: `new BakeScene({ width, height, chunkSize: 256, drawChunk, dynamic })` then `render(ctx, { viewport })`.
- Always `imageSmoothingEnabled = false`. bake.js pins `colorSpace: 'srgb'`.

## Vocab (`draw.js`)
`layeredRect` / `bevelRect` / `disc` / materials (`plankWood`, `metalPanel`, `stone`, `glass`) / tiles + `makeAutotile` / HUD bars / `makeBakedSprite(draw, { size, frames, rows, outline })`.

## FX (`fx.js`)
`pxWiggle` foliage, `pxShake` hit, `pxJelly` land, `pxGlitch` damage, `pxCracks` impact. Pass `cacheKey` + `frames: 16` when many instances share a sprite.

## Three.js
`NearestFilter`, no mipmaps, `transparent` + `alphaTest`. After live 2D draws: `markCanvasDirty(mesh)`.
