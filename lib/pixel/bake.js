// Offscreen-canvas baking primitives.
//
// The mental model: a canvas is the unit of composition. Tile-sized
// sprites are a degenerate case (1×1 tile, 16×16 px), not the primary
// shape. Anything bigger than a tile, anything with continuous position,
// anything with z-order semantics, anything with transparency that
// reveals layers underneath — that all goes through these primitives.
//
// Compositing tier (low → high level):
//
//   bakeCanvas(w, h, drawFn)
//     One canvas, one draw fn. The atom.
//
//   bakePadded(w, h, padding, drawFn)
//     Same, plus a transparent ring so sub-pixel filter taps don't bleed
//     across atlas slot boundaries.
//
//   tintCanvas / rotateCanvas
//     Pure derivations of a source canvas.
//
//   bakeComposite({ width, height, entries })
//     One canvas built from N source canvases at positions/rotations.
//
//   bakeStack({ width, height, layers })
//     One canvas built from N LAYERS, each a source canvas OR an immediate
//     drawFn. Top of the multi-layer flow — "ground + entities + overlay"
//     in one bake call.
//
//   bakeAtlas({ width, height, entries })
//     One canvas with N sub-rects, each a sprite of varying size, with
//     transparent padding between them. For sprite sheets.
//
//   compositeAt / drawSorted / rebakeRegion
//     Per-frame helpers for layered + reactive workflows. compositeAt
//     wraps drawImage with options as a hash; drawSorted handles z-sorted
//     entity rendering; rebakeRegion partial-updates an existing canvas.
//
// Design notes:
//   - Every function is SSR-safe: the DOM check is at call time, not
//     module load, so Node test runners can import this file.
//   - Sources can be any CanvasImageSource (HTMLCanvasElement,
//     HTMLImageElement, ImageBitmap). The pool doesn't care; drawImage
//     accepts them all.
//   - Functions never mutate their inputs. `rebakeRegion` does mutate
//     its target canvas (that's its purpose) — the rest return fresh
//     canvases the caller owns.
//
// Typical use:
//   const bolt = bakeCanvas(16, 16, (sctx) => { ... draw a lightning bolt ... });
//   const shadow = tintCanvas(enemySprite, '#000', { alpha: 0.5 });
//   const planet = bakeStack({
//     width: w, height: h,
//     layers: [
//       { source: groundBake },                     // tile grid (static)
//       { draw: ctx => drawSorted(ctx, trees, { ... }) },  // entities
//       { source: overlayBake, alpha: 0.6 },        // weather scrim
//     ],
//   });

function _requireDOM() {
  if (typeof document === 'undefined') {
    throw new Error('[engine/bake] DOM required (cannot run in Node; guard with typeof document)');
  }
}

/**
 * Allocate an offscreen canvas and run a draw function on its 2D context.
 * The context has imageSmoothingEnabled=false for pixel-art crispness.
 *
 * The 2D context is pinned to `colorSpace: 'srgb'` to match the main
 * game canvas (engine/game.js) and the explicitly-srgb lighting
 * offscreens (tile-lighting.js, masklighting.js). Without this match,
 * draws between an srgb source and a default-colorSpace destination
 * trigger an implicit chromatic conversion that diverges between
 * Chrome (srgb default) and Safari (display-p3 default on wide-gamut
 * monitors). Visible symptom is the Chrome multiply path lifting
 * darks toward grey while Safari keeps them deep black — the same
 * "washed-out Chrome" pattern the tile-lighting opaque-backing fix
 * was supposed to eliminate. The backing fixed the alpha half of the
 * divergence; this fixes the color-space half.
 *
 * getContext is idempotent — the first call's options stick — so this
 * MUST happen on the canvas's first getContext, which is here.
 *
 * @param {number} width
 * @param {number} height
 * @param {(ctx: CanvasRenderingContext2D, width: number, height: number) => void} drawFn
 * @returns {HTMLCanvasElement}
 */
export function bakeCanvas(width, height, drawFn) {
  _requireDOM();
  const c = document.createElement('canvas');
  c.width = Math.max(1, Math.ceil(width));
  c.height = Math.max(1, Math.ceil(height));
  const sctx = c.getContext('2d', { colorSpace: 'srgb' });
  sctx.imageSmoothingEnabled = false;
  drawFn(sctx, c.width, c.height);
  return c;
}

/**
 * Return a tinted copy of a source image.
 *
 * Two compositing modes are useful here:
 *   - 'source-in' (default): recolors every opaque pixel in the source
 *     to the given color. Silhouette is preserved, internal shading is
 *     lost. Good for shadows, silhouette effects, ghost outlines.
 *   - 'multiply': multiplies the source's colors by the tint color.
 *     Internal shading and gradients are preserved. Good for
 *     darkening/desaturating a sprite without flattening it.
 *
 * @param {CanvasImageSource & { width: number, height: number }} source
 * @param {string} color - CSS color
 * @param {{ alpha?: number, composite?: 'source-in' | 'multiply' | 'source-atop' | string }} [opts]
 * @returns {HTMLCanvasElement}
 */
export function tintCanvas(source, color, opts = {}) {
  const { alpha = 1, composite = 'source-in' } = opts;
  return bakeCanvas(source.width, source.height, (sctx, w, h) => {
    sctx.drawImage(source, 0, 0);
    sctx.globalCompositeOperation = composite;
    sctx.globalAlpha = alpha;
    sctx.fillStyle = color;
    sctx.fillRect(0, 0, w, h);
  });
}

/**
 * Composite many sources onto one canvas.
 *
 * This is the "bake a whole room" primitive: hand it a list of entries
 * with their local positions/rotations and get back a single canvas the
 * pool can blit in one drawImage.
 *
 * Each entry: { source, x, y, rotation?, scaleX?, scaleY?, alpha?, anchor?, composite? }
 *   - anchor: 'center' (default) | 'topleft' | { x, y } pixel offset
 *   - rotation: radians
 *   - scaleX/scaleY: independent scaling (negative flips)
 *   - composite: per-entry composite op ('source-over' default)
 *
 * @param {{
 *   width: number,
 *   height: number,
 *   entries: Array<{
 *     source: CanvasImageSource & { width: number, height: number },
 *     x: number,
 *     y: number,
 *     rotation?: number,
 *     scaleX?: number,
 *     scaleY?: number,
 *     alpha?: number,
 *     anchor?: 'center' | 'topleft' | { x: number, y: number },
 *     composite?: string,
 *   }>,
 *   background?: string | null,
 * }} spec
 * @returns {HTMLCanvasElement}
 */
export function bakeComposite({ width, height, entries, background = null }) {
  return bakeCanvas(width, height, (sctx, w, h) => {
    if (background) {
      sctx.fillStyle = background;
      sctx.fillRect(0, 0, w, h);
    }
    for (const e of entries) {
      const {
        source, x, y,
        rotation = 0, scaleX = 1, scaleY = 1,
        alpha = 1, anchor = 'center', composite = 'source-over',
      } = e;

      const ax = anchor === 'center' ? source.width * 0.5
               : anchor === 'topleft' ? 0
               : anchor.x;
      const ay = anchor === 'center' ? source.height * 0.5
               : anchor === 'topleft' ? 0
               : anchor.y;

      const needsTransform = rotation !== 0 || scaleX !== 1 || scaleY !== 1;
      sctx.globalAlpha = alpha;
      sctx.globalCompositeOperation = composite;

      if (needsTransform) {
        sctx.save();
        sctx.translate(x, y);
        if (rotation !== 0) sctx.rotate(rotation);
        if (scaleX !== 1 || scaleY !== 1) sctx.scale(scaleX, scaleY);
        sctx.drawImage(source, -ax, -ay);
        sctx.restore();
      } else {
        sctx.drawImage(source, x - ax, y - ay);
      }
    }
    sctx.globalAlpha = 1;
    sctx.globalCompositeOperation = 'source-over';
  });
}

/**
 * Bake with a transparent padding ring. Returned canvas is
 * (width + 2*padding) × (height + 2*padding); the drawFn runs at
 * `pad`-pixel offset, leaving a fully transparent border.
 *
 * Why: when many sprites of varying sizes share one atlas (proc-pool
 * style shelf packing), `drawImage` with sub-pixel destination coords
 * or any filtering picks up neighboring atlas pixels at the borders
 * (the classic "atlas bleed"). One pixel of transparent padding makes
 * the bleed pull transparent black instead of the next sprite's color.
 *
 * Use `slot.sx + pad`, `slot.sy + pad`, `slot.w - 2*pad`, `slot.h - 2*pad`
 * when blitting from the atlas — the inner rect (the actual content)
 * is preserved while the padding ring absorbs filter taps.
 *
 * @param {number} width
 * @param {number} height
 * @param {number} padding
 * @param {(ctx: CanvasRenderingContext2D, width: number, height: number) => void} drawFn
 * @returns {HTMLCanvasElement & { padding: number, contentX: number, contentY: number, contentW: number, contentH: number }}
 */
export function bakePadded(width, height, padding, drawFn) {
  _requireDOM();
  const pad = Math.max(0, Math.floor(padding));
  const c = document.createElement('canvas');
  c.width  = Math.max(1, Math.ceil(width  + 2 * pad));
  c.height = Math.max(1, Math.ceil(height + 2 * pad));
  // srgb-pinned for the same reason as bakeCanvas — keeps Chrome and
  // Safari in lockstep when this sprite later feeds the lighting/
  // multiply path.
  const sctx = c.getContext('2d', { colorSpace: 'srgb' });
  sctx.imageSmoothingEnabled = false;
  sctx.save();
  sctx.translate(pad, pad);
  drawFn(sctx, Math.max(1, Math.ceil(width)), Math.max(1, Math.ceil(height)));
  sctx.restore();
  // Annotate the canvas so consumers know where the actual content lives.
  c.padding   = pad;
  c.contentX  = pad;
  c.contentY  = pad;
  c.contentW  = Math.max(1, Math.ceil(width));
  c.contentH  = Math.max(1, Math.ceil(height));
  return c;
}

/**
 * Pack many varying-sized sprites into one atlas canvas with optional
 * inter-cell padding. Shelf-packing places items left-to-right; each
 * shelf's height equals the tallest item in it. Returns the atlas + a
 * `slots` map keyed by `entry.id`.
 *
 * Each entry: `{ id, width, height, draw }` where `draw(ctx, w, h)` is
 * invoked with the slot's local origin already translated.
 *
 * Returns: `{ canvas, slots: Map<id, { sx, sy, w, h, contentX, contentY, contentW, contentH }> }`
 *
 * Use `slot.contentX/Y/W/H` to blit just the content (skipping padding):
 *   ctx.drawImage(atlas, slot.contentX, slot.contentY, slot.contentW, slot.contentH, dx, dy, dw, dh);
 *
 * Why this matters: the proc-pool atlas already shelf-packs, but adding
 * `padding: 1` here gives every entry a transparent border so no two
 * neighboring sprites can bleed into each other across `drawImage`
 * sub-pixel sampling. Critical when mixing 16×16 ground tiles with
 * 32×64 trees on the same atlas page.
 *
 * @param {{
 *   width: number, height: number,
 *   padding?: number,
 *   entries: Array<{ id: string, width: number, height: number, draw: (ctx: CanvasRenderingContext2D, w: number, h: number) => void }>,
 * }} spec
 * @returns {{ canvas: HTMLCanvasElement, slots: Map<string, { sx: number, sy: number, w: number, h: number, contentX: number, contentY: number, contentW: number, contentH: number }> }}
 */
export function bakeAtlas({ width, height, padding = 1, entries }) {
  _requireDOM();
  const c = document.createElement('canvas');
  c.width = Math.max(1, Math.ceil(width));
  c.height = Math.max(1, Math.ceil(height));
  // srgb-pinned — see bakeCanvas. Atlas sprites are sampled by the
  // main game render via drawImage; matching srgb avoids the implicit
  // chromatic conversion that drives Chrome/Safari to diverge.
  const sctx = c.getContext('2d', { colorSpace: 'srgb' });
  sctx.imageSmoothingEnabled = false;
  const pad = Math.max(0, Math.floor(padding));
  const slots = new Map();
  let shelfX = 0, shelfY = 0, shelfH = 0;
  for (const e of entries) {
    const slotW = e.width  + 2 * pad;
    const slotH = e.height + 2 * pad;
    if (slotW > c.width) {
      throw new Error(`[bake/bakeAtlas] entry "${e.id}" (${slotW}×${slotH} with padding) exceeds atlas width ${c.width}`);
    }
    if (shelfX + slotW > c.width) {
      shelfX = 0;
      shelfY += shelfH;
      shelfH = 0;
    }
    if (shelfY + slotH > c.height) {
      throw new Error(`[bake/bakeAtlas] atlas overflow placing "${e.id}" — needs more atlas pages`);
    }
    const sx = shelfX, sy = shelfY;
    sctx.save();
    sctx.translate(sx + pad, sy + pad);
    e.draw(sctx, e.width, e.height);
    sctx.restore();
    slots.set(e.id, {
      sx, sy, w: slotW, h: slotH,
      contentX: sx + pad,
      contentY: sy + pad,
      contentW: e.width,
      contentH: e.height,
    });
    shelfX += slotW;
    if (slotH > shelfH) shelfH = slotH;
  }
  return { canvas: c, slots };
}

/**
 * Bake a vertical stack of layers into one canvas.
 *
 * Each layer is one of:
 *   - { source: Canvas, x?, y?, alpha?, composite? }
 *       Pre-baked sprite blit at (x, y).
 *   - { draw: (ctx, w, h) => void, alpha?, composite? }
 *       Immediate-mode draw fn invoked with the canvas's full extent.
 *
 * Layers compose in the array order (index 0 = bottom, last = top).
 * Useful for "ground + entities + overlay" composition where each layer
 * is independently sized but they blend cleanly into one final image.
 *
 * Why this exists: tile-baking treats the world as a 1×1 grid; bakeStack
 * treats the world as N layered canvases that DON'T have to be tile-
 * aligned. A static ground bake (200×200 tile grid) + a dynamic entity
 * draw layer (sorted trees) + a weather scrim composes to one image
 * via one call — no manual draw-order juggling.
 *
 * @param {{
 *   width: number, height: number,
 *   layers: Array<
 *     | { source: CanvasImageSource & { width: number, height: number }, x?: number, y?: number, alpha?: number, composite?: string }
 *     | { draw: (ctx: CanvasRenderingContext2D, width: number, height: number) => void, alpha?: number, composite?: string }
 *   >,
 *   background?: string | null,
 * }} spec
 * @returns {HTMLCanvasElement}
 */
export function bakeStack({ width, height, layers, background = null }) {
  return bakeCanvas(width, height, (ctx, w, h) => {
    if (background) {
      ctx.fillStyle = background;
      ctx.fillRect(0, 0, w, h);
    }
    for (let i = 0; i < layers.length; i++) {
      const layer = layers[i];
      const prevA = ctx.globalAlpha;
      const prevC = ctx.globalCompositeOperation;
      ctx.globalAlpha = layer.alpha != null ? layer.alpha : 1;
      ctx.globalCompositeOperation = layer.composite || 'source-over';
      if (layer.source) {
        ctx.drawImage(layer.source, layer.x || 0, layer.y || 0);
      } else if (typeof layer.draw === 'function') {
        layer.draw(ctx, w, h);
      }
      ctx.globalAlpha = prevA;
      ctx.globalCompositeOperation = prevC;
    }
  });
}

/**
 * Composite a source onto a target context with options as a hash.
 * Wraps the drawImage 9-arg form so layer code reads cleanly:
 *
 *   compositeAt(ctx, sprite, dx, dy, { alpha: 0.5, composite: 'multiply' });
 *   compositeAt(ctx, atlas, dx, dy, { sx, sy, sw, sh });
 *
 * Restores the previous globalAlpha + globalCompositeOperation after the
 * draw, so callers don't have to.
 *
 * @param {CanvasRenderingContext2D} targetCtx
 * @param {CanvasImageSource & { width: number, height: number }} source
 * @param {number} x
 * @param {number} y
 * @param {{
 *   alpha?: number,
 *   composite?: string,
 *   sx?: number, sy?: number, sw?: number, sh?: number,
 *   dw?: number, dh?: number,
 * }} [opts]
 */
export function compositeAt(targetCtx, source, x, y, opts = {}) {
  const prevA = targetCtx.globalAlpha;
  const prevC = targetCtx.globalCompositeOperation;
  if (opts.alpha != null) targetCtx.globalAlpha = opts.alpha;
  if (opts.composite)     targetCtx.globalCompositeOperation = opts.composite;
  if (opts.sx != null) {
    const dw = opts.dw != null ? opts.dw : opts.sw;
    const dh = opts.dh != null ? opts.dh : opts.sh;
    targetCtx.drawImage(source, opts.sx, opts.sy, opts.sw, opts.sh, x, y, dw, dh);
  } else if (opts.dw != null || opts.dh != null) {
    const dw = opts.dw != null ? opts.dw : source.width;
    const dh = opts.dh != null ? opts.dh : source.height;
    targetCtx.drawImage(source, x, y, dw, dh);
  } else {
    targetCtx.drawImage(source, x, y);
  }
  targetCtx.globalAlpha = prevA;
  targetCtx.globalCompositeOperation = prevC;
}

/**
 * Render a list of items in z-order. Pure helper for the entity-overlay
 * pattern (back-to-front by world-y for pseudo-depth):
 *
 *   drawSorted(ctx, planet.trees, {
 *     sortBy: (a, b) => a.y - b.y,
 *     cull:   t => t.x > camLX && t.x < camRX,
 *     draw:   (ctx, t) => naturePool.draw(ctx, treeKey(t), t.x*16-16, t.y*16-48),
 *   });
 *
 * Allocates one sorted slice per call — caller can pass a pre-sorted
 * array via `sortBy: null` if hot-path allocation matters.
 *
 * @param {CanvasRenderingContext2D} ctx
 * @param {Array<any>} items
 * @param {{
 *   sortBy?: ((a: any, b: any) => number) | null,
 *   cull?: (item: any, idx: number) => boolean,
 *   draw: (ctx: CanvasRenderingContext2D, item: any, idx: number) => void,
 * }} opts
 */
export function drawSorted(ctx, items, opts) {
  if (!opts || typeof opts.draw !== 'function') {
    throw new Error('[engine/bake] drawSorted requires opts.draw');
  }
  const list = opts.sortBy === null
    ? items
    : items.slice().sort(opts.sortBy || ((a, b) => a.y - b.y));
  const cull = opts.cull || null;
  for (let i = 0; i < list.length; i++) {
    if (cull && !cull(list[i], i)) continue;
    opts.draw(ctx, list[i], i);
  }
}

/**
 * Re-bake a sub-region of an existing canvas. The targeted rect is
 * cleared and the drawFn runs with the rect's local origin translated
 * to (0, 0) — same shape as bakeCanvas' drawFn, but the canvas itself
 * persists and only the dirty region changes.
 *
 * Use for reactive bakes: a static base bake that occasionally needs
 * a chunk re-rendered (e.g., a tree gets chopped, a path gets carved
 * after gen, a tile transitions seasonally) without re-baking the
 * whole canvas.
 *
 * Mutates `canvas`; returns it for chaining.
 *
 * @param {HTMLCanvasElement} canvas
 * @param {number} x
 * @param {number} y
 * @param {number} w
 * @param {number} h
 * @param {(ctx: CanvasRenderingContext2D, width: number, height: number) => void} drawFn
 * @returns {HTMLCanvasElement}
 */
export function rebakeRegion(canvas, x, y, w, h, drawFn) {
  const ctx = canvas.getContext('2d');
  ctx.save();
  ctx.beginPath();
  ctx.rect(x, y, w, h);
  ctx.clip();
  ctx.clearRect(x, y, w, h);
  ctx.translate(x, y);
  drawFn(ctx, w, h);
  ctx.restore();
  return canvas;
}

// ──────────────────────────────────────────────────────────────────────
// BakeScene — the Valdosta game-engine SCENE primitive.
// ──────────────────────────────────────────────────────────────────────
//
// THE going-forward unification for how regions/strata structure their
// rendering. Same role at the rendering layer that TileLighting plays
// at the lighting layer: one universal primitive every region opts
// into. New code should reach for BakeScene; existing region renders
// can migrate incrementally.
//
// ── Why BakeScene ──
//
// A scene's content has a spectrum of lifecycle needs:
//   • Truly static (walls, floors, decorations, baked-in lighting)
//   • Periodically animated (torches, water, blinking machinery)
//   • Per-frame dynamic (NPCs, player, projectiles)
//
// Without a unified primitive, every region invents its own split —
// one bakes everything (frozen), another draws everything live
// (slow), a third manages a custom static-canvas-plus-live-layers
// pattern. BakeScene formalizes the right split: one static bake
// (cached) + N dynamic layers (called per frame). Same shape every
// region uses → same perf model, same mental model, same debug story.
//
// ── Two modes ──
//
//   UNIFIED MODE (small/medium scenes that fit in one bake)
//     constructor({ width, height, draw, dynamic? })
//     `draw(ctx, w, h)` runs once at construction; result cached as
//     a single staticBake canvas. render() = drawImage(bake) + dynamic.
//     Memory: width × height × 4 bytes, allocated once.
//
//   CHUNKED MODE (huge scenes, streamed by viewport)
//     constructor({ width, height, drawChunk, chunkSize, dynamic? })
//     `drawChunk(ctx, worldX, worldY, size)` runs LAZILY — on first
//     visit to a chunk. Each chunk is its own bake canvas, cached
//     in a Map keyed by `${cx},${cy}`. render() determines visible
//     chunks from viewport, blits them. Memory grows with VISITED
//     area, not declared world size. A 10k×10k world with 256-px
//     chunks bakes ~6-12 visible chunks at a time (~6×256² = 400KB).
//
// The render() API is identical across modes — pass a viewport (rect
// `{x, y, w, h}` in opts.viewport, OR as second arg) for chunked
// mode. Unified mode ignores viewport. So consumers can swap chunked
// vs unified without changing call sites.
//
// ── Dynamic layer shape ──
//
// Each dynamic layer is `{ fn, alpha?, composite? }` (or just `fn`
// for the shorthand). `fn(ctx, opts)` runs once per frame. opts is
// caller-supplied — common pattern is `{ time: performance.now() }`.
// Per-layer alpha + composite are save/restored so layers can't
// leak state into each other.
//
// ── Where this fits among the bake primitives ──
//
//   bakeCanvas       — one canvas, one draw (the atom)
//   bakeStack        — N layers baked once into one canvas (snapshot)
//   BakeScene        — N layers, mixed lifecycle (static + dynamic)
//   bakeComposite    — N sprites at positions, baked once
//   bakeAtlas        — N varying-size sprites packed into one canvas
//
// Pick BakeScene when you have BOTH baked content AND animated
// content in the same scene. bakeStack is for "bake once, never
// touch again." BakeScene adds "and also run these N callbacks
// per frame on top of the bake."
//
// ── Architectural role ──
//
// BakeScene is THE LEAF SCENE NODE in the Valdosta scene-graph
// pattern. Multi-stratum regions compose multiple BakeScenes via
// z-compositor. Single-stratum regions ARE a BakeScene. Boot
// dispatches between regions but doesn't reach into them — each
// region knows how to render itself via BakeScene.
//
// Migration target: every region's render fn should eventually be
// `bakeScene.render(ctx, viewport, opts)`. Same call, same shape,
// per-region differences encapsulated inside the scene's draw fn
// and dynamic layers.
//
// ── Common use cases ──
//
// • Backdrop strata in a z-compositor: static = geometry + lit
//   mask; dynamic = drawTorches(t). Bake stays cheap; torches
//   animate on every backdrop.
//
// • Machinery rooms: static = walls, floor tiles, pipes; dynamic
//   = pump animations, blinking lights, monitor screens.
//
// • Bustling cities (chunked): static = chunk's geometry; dynamic
//   = NPCs walking, weather particles. Visited chunks bake on
//   first visit; never-visited chunks cost nothing.
//
// • Outdoor scenes with weather: static = ground; dynamic =
//   falling particles, animated water surface, drifting fog
//   patches.
//
// ── Example: unified mode (existing usage) ──
//
//   const room = new BakeScene({
//     width:  AREA_W * TILE,
//     height: AREA_H * TILE,
//     draw: (ctx) => {
//       ctx.drawImage(geometryBake, 0, 0);
//       applyLightMask(ctx, lightingPlane);
//     },
//     dynamic: [
//       (ctx, opts) => drawTorches(ctx, opts.time),
//     ],
//   });
//   // Per frame:
//   room.render(targetCtx, { time: performance.now() });
//
// ── Example: chunked mode (huge world) ──
//
//   const city = new BakeScene({
//     width:  5000, height: 5000,
//     chunkSize: 256,
//     drawChunk: (ctx, wx, wy, size) => {
//       drawCityChunk(ctx, wx, wy, size, biomeMap);
//     },
//     dynamic: [
//       (ctx, opts) => drawWalkingNpcs(ctx, opts.npcs, opts.viewport),
//     ],
//   });
//   // Per frame:
//   city.render(targetCtx, {
//     viewport: { x: camera.x, y: camera.y, w: canvas.width, h: canvas.height },
//     time: performance.now(),
//     npcs: allNpcs,
//   });
//
// ── Split-control rendering ──
//
// Some renderers (z-compositor, layered compositors) want to BLIT
// the static at a graded copy, then run dynamic AT a different
// alpha. Use `drawStatic()` and `drawDynamic()` separately:
//
//   const graded = gradeForDepth(scene.getStatic(), d);
//   ctx.drawImage(graded, x, y);
//   ctx.save();
//   ctx.translate(x, y);
//   ctx.globalAlpha = gradeAlpha;
//   scene.drawDynamic(ctx, { time });
//   ctx.restore();
//
// Chunked scenes don't have a single static canvas (use
// `drawStatic(ctx, x, y, viewport)` which blits visible chunks at
// offset (x, y) — same chunked culling as render).
//
// ── Non-goals ──
//
// BakeScene does NOT manage:
//   • Animation timing — caller supplies `time` via opts.
//   • Dynamic-layer culling — layer fns check visibility themselves.
//     The viewport in opts is the affordance for them to do so.
//   • LRU eviction of chunks — grow-only by default. Call
//     invalidateAllChunks() or invalidateRegion(...) for explicit
//     drops. Add eviction later if memory becomes an issue.
//   • Multiple parallel static layers — collapse them into one
//     drawFn or compose via bakeStack first, then pass as `draw`.
export class BakeScene {
  /**
   * @param {{
   *   width: number,
   *   height: number,
   *
   *   // UNIFIED MODE — pass `draw`. The static bake is allocated +
   *   //   filled at construction; render() blits the whole thing.
   *   draw?: (ctx: CanvasRenderingContext2D, width: number, height: number) => void,
   *
   *   // CHUNKED MODE — pass `drawChunk` + `chunkSize`. Chunks are
   *   //   lazily baked on first visit (no upfront allocation per
   *   //   chunk). drawChunk receives the chunk's WORLD coords +
   *   //   the chunk size; render against an unrotated chunkSize×
   *   //   chunkSize ctx (translate the world coords back to local
   *   //   inside drawChunk if needed). chunkSize default 256.
   *   drawChunk?: (ctx: CanvasRenderingContext2D, worldX: number, worldY: number, size: number) => void,
   *   chunkSize?: number,
   *
   *   dynamic?: Array<
   *     | ((ctx: CanvasRenderingContext2D, opts?: any) => void)
   *     | { fn: (ctx: CanvasRenderingContext2D, opts?: any) => void, alpha?: number, composite?: string }
   *   >,
   * }} spec
   */
  constructor({ width, height, draw, drawChunk, chunkSize, dynamic = [] }) {
    this.width = Math.max(1, Math.ceil(width));
    this.height = Math.max(1, Math.ceil(height));
    this.dynamicLayers = dynamic.map(_normalizeLayer);

    if (typeof drawChunk === 'function') {
      // Chunked mode — lazy bake per chunk on first visit.
      this.chunked = true;
      this.chunkSize = Math.max(16, chunkSize || 256);
      this.drawChunkFn = (ctx, wx, wy, size) => {
        drawChunk(ctx, wx, wy, size);
      };
      this.chunks = new Map();          // 'cx,cy' → HTMLCanvasElement
      this.staticBake = null;           // not used in chunked mode
    } else if (typeof draw === 'function') {
      // Unified mode — one static bake at construction.
      this.chunked = false;
      this.chunkSize = 0;
      this.drawChunkFn = null;
      this.chunks = null;
      this.staticBake = bakeCanvas(this.width, this.height, (ctx) => {
        draw(ctx, this.width, this.height);
      });
    } else {
      throw new Error('[engine/bake] BakeScene requires `draw` (unified) or `drawChunk` (chunked)');
    }
  }

  // ── Static layer ──────────────────────────────────────────────

  /** The inner static canvas (unified mode only) — for callers that
   *  want it directly (z-compositor grade caches key off canvas
   *  identity). Throws in chunked mode (use getChunk instead). */
  getStatic() {
    if (this.chunked) {
      throw new Error('[engine/bake] BakeScene.getStatic() not valid in chunked mode; use getChunk(cx, cy)');
    }
    return this.staticBake;
  }

  /**
   * Get (or lazily bake) the chunk at integer chunk-coords (cx, cy).
   * Chunked mode only. Bakes on first call; cached thereafter.
   *
   * @param {number} cx
   * @param {number} cy
   * @returns {HTMLCanvasElement}
   */
  getChunk(cx, cy) {
    if (!this.chunked) {
      throw new Error('[engine/bake] BakeScene.getChunk() not valid in unified mode');
    }
    const key = cx + ',' + cy;
    let chunk = this.chunks.get(key);
    if (chunk) return chunk;
    const cs = this.chunkSize;
    chunk = bakeCanvas(cs, cs, (ctx) => {
      this.drawChunkFn(ctx, cx * cs, cy * cs, cs);
    });
    this.chunks.set(key, chunk);
    return chunk;
  }

  /**
   * Re-run the static draw (unified mode) or drop+re-bake all chunks
   * (chunked mode would just call invalidateAllChunks — use that
   * directly). Use for occasional rebuilds (season change, structural
   * edit); not for per-frame updates — at that point the layer should
   * be DYNAMIC instead.
   */
  rebakeStatic(draw) {
    if (this.chunked) {
      throw new Error('[engine/bake] BakeScene.rebakeStatic() not valid in chunked mode; use invalidateAllChunks + a new drawChunk');
    }
    return rebakeRegion(this.staticBake, 0, 0, this.width, this.height, draw);
  }

  /**
   * Drop a chunk's cache so it re-bakes on next access. Chunked mode.
   * No-op if not chunked or chunk not yet baked.
   */
  invalidateChunk(cx, cy) {
    if (!this.chunked) return;
    this.chunks.delete(cx + ',' + cy);
  }

  /**
   * Drop all chunks overlapping a world-coord rect. Chunked mode.
   * Useful when a feature changes a region (a wall placed, a road
   * carved) — chunks touching the change re-bake on next visit.
   */
  invalidateRegion(x, y, w, h) {
    if (!this.chunked) return;
    const cs = this.chunkSize;
    const x0 = Math.floor(x / cs);
    const y0 = Math.floor(y / cs);
    const x1 = Math.ceil((x + w) / cs);
    const y1 = Math.ceil((y + h) / cs);
    for (let cy = y0; cy < y1; cy++) {
      for (let cx = x0; cx < x1; cx++) {
        this.chunks.delete(cx + ',' + cy);
      }
    }
  }

  /** Drop every chunk cache. Chunked mode. Next render lazy-rebakes
   *  the visible chunks fresh. */
  invalidateAllChunks() {
    if (!this.chunked) return;
    this.chunks.clear();
  }

  // ── Dynamic layers ────────────────────────────────────────────

  /**
   * Add a dynamic layer. Layers compose in insertion order (later
   * layers draw on top). Pass a bare function or a `{fn, alpha?,
   * composite?}` record.
   */
  addDynamic(layer) {
    this.dynamicLayers.push(_normalizeLayer(layer));
    return this;
  }

  /**
   * Remove a dynamic layer by fn reference (the same fn passed to
   * addDynamic). No-op if not found. Returns true if removed.
   */
  removeDynamic(fn) {
    const i = this.dynamicLayers.findIndex(l => l.fn === fn);
    if (i < 0) return false;
    this.dynamicLayers.splice(i, 1);
    return true;
  }

  /** Drop every dynamic layer. Static survives. */
  clearDynamic() {
    this.dynamicLayers.length = 0;
    return this;
  }

  // ── Render ────────────────────────────────────────────────────

  /**
   * Full render — blit the static (chunked: visible chunks; unified:
   * single bake) at (0,0) then run all dynamic layers on top.
   *
   * Chunked mode requires `opts.viewport` (or a `viewport` arg) for
   * the chunk cull; the viewport is `{x, y, w, h}` in world coords.
   * Unified mode ignores viewport.
   *
   * `opts` is forwarded to every dynamic layer's fn — dynamic layers
   * can read viewport from there too if they need to cull.
   *
   * @param {CanvasRenderingContext2D} ctx
   * @param {any} [opts] - dynamic-layer opts; must include `viewport` in chunked mode
   */
  render(ctx, opts) {
    if (this.chunked) {
      const viewport = opts && opts.viewport;
      if (!viewport) {
        throw new Error('[engine/bake] BakeScene.render() requires opts.viewport in chunked mode');
      }
      this._renderChunks(ctx, viewport, 0, 0);
    } else {
      ctx.drawImage(this.staticBake, 0, 0);
    }
    this._runDynamic(ctx, opts);
  }

  /**
   * Just the static blit at world offset (x, y). For callers that
   * want to grade/filter/position the static layer separately from
   * the dynamic.
   *
   * In chunked mode, requires `viewport` (world coords) for the chunk
   * cull. Blits each visible chunk at `x + cx*size, y + cy*size`.
   *
   * @param {CanvasRenderingContext2D} ctx
   * @param {number} [x=0]
   * @param {number} [y=0]
   * @param {{x:number,y:number,w:number,h:number}} [viewport]
   */
  drawStatic(ctx, x = 0, y = 0, viewport) {
    if (this.chunked) {
      if (!viewport) {
        throw new Error('[engine/bake] BakeScene.drawStatic() requires viewport in chunked mode');
      }
      this._renderChunks(ctx, viewport, x, y);
    } else {
      ctx.drawImage(this.staticBake, x, y);
    }
  }

  /**
   * Just the dynamic layers — no static blit. For the z-compositor
   * backdrop pattern: caller blits a graded copy of the static
   * first (via its own cache), then calls drawDynamic to run the
   * live layers on top of that grade.
   */
  drawDynamic(ctx, opts) {
    this._runDynamic(ctx, opts);
  }

  // ── Diagnostics ───────────────────────────────────────────────

  /** Number of cached chunks (chunked mode) or 1 (unified). */
  get chunkCount() {
    return this.chunked ? this.chunks.size : 1;
  }

  /** Approximate memory footprint in bytes (canvas pixels × 4). */
  get memoryBytes() {
    if (this.chunked) {
      return this.chunks.size * this.chunkSize * this.chunkSize * 4;
    }
    return this.width * this.height * 4;
  }

  // ── Internal ──────────────────────────────────────────────────

  // Chunked render — blits visible chunks at offset (ox, oy).
  // Clamps to world bounds (only chunks intersecting the world rect
  // 0..width × 0..height get drawn; out-of-bounds viewport areas are
  // just empty). Lazy-bakes via getChunk.
  _renderChunks(ctx, viewport, ox, oy) {
    const cs = this.chunkSize;
    const x0 = Math.max(0, Math.floor(viewport.x / cs));
    const y0 = Math.max(0, Math.floor(viewport.y / cs));
    const x1 = Math.min(Math.ceil(this.width  / cs), Math.ceil((viewport.x + viewport.w) / cs));
    const y1 = Math.min(Math.ceil(this.height / cs), Math.ceil((viewport.y + viewport.h) / cs));
    for (let cy = y0; cy < y1; cy++) {
      for (let cx = x0; cx < x1; cx++) {
        const chunk = this.getChunk(cx, cy);
        ctx.drawImage(chunk, ox + cx * cs, oy + cy * cs);
      }
    }
  }

  // Run dynamic layers with per-layer alpha/composite wrapping.
  // save/restore done explicitly (not via ctx.save) because we want
  // to only touch alpha + composite, not the whole state.
  _runDynamic(ctx, opts) {
    for (let i = 0; i < this.dynamicLayers.length; i++) {
      const layer = this.dynamicLayers[i];
      const prevA = ctx.globalAlpha;
      const prevC = ctx.globalCompositeOperation;
      if (layer.alpha != null) ctx.globalAlpha = layer.alpha;
      if (layer.composite)     ctx.globalCompositeOperation = layer.composite;
      layer.fn(ctx, opts);
      ctx.globalAlpha = prevA;
      ctx.globalCompositeOperation = prevC;
    }
  }
}

// Normalize a dynamic-layer entry: bare fn → {fn}, otherwise pass-thru
// after shallow-copying so the caller can keep mutating their original.
function _normalizeLayer(layer) {
  if (typeof layer === 'function') return { fn: layer };
  if (layer && typeof layer.fn === 'function') {
    return { fn: layer.fn, alpha: layer.alpha, composite: layer.composite };
  }
  throw new Error('[engine/bake] BakeScene dynamic layer must be a function or {fn, alpha?, composite?}');
}

/**
 * Rotate a source and return a new canvas sized to the rotated bounds.
 * Useful when you want a pre-rotated sprite so the hot render path can
 * avoid save/rotate/restore.
 *
 * @param {CanvasImageSource & { width: number, height: number }} source
 * @param {number} radians
 * @returns {HTMLCanvasElement}
 */
export function rotateCanvas(source, radians) {
  const sw = source.width, sh = source.height;
  const cos = Math.abs(Math.cos(radians));
  const sin = Math.abs(Math.sin(radians));
  const w = Math.ceil(sw * cos + sh * sin);
  const h = Math.ceil(sw * sin + sh * cos);
  return bakeCanvas(w, h, (sctx) => {
    sctx.translate(w / 2, h / 2);
    sctx.rotate(radians);
    sctx.drawImage(source, -sw / 2, -sh / 2);
  });
}
