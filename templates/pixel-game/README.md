# Pixel Grove

Three.js + pixel kit: bake sprites on Canvas2D, stamp them as nearest-filter quads. **Do not replace Three.js with a canvas game.**

```bash
npm install
npm run dev
```

- Draw in `src/main.js` with `bakeCanvas` + `layeredRect` / `disc`
- Upload with `spriteMesh` from `src/pixel/three-bridge.js`
- Static silhouette once; eyes / juice / FX live (`fx.js`)

```bash
gamemaster kit feel -p .
gamemaster kit pixel -p .    # re-vendor lib/pixel → src/pixel
gamemaster verify -p .
```
