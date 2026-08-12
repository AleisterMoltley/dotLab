// ──────────────────────────────────────────────────────────────────────
// Pixel-art deformation primitives — wiggle, shake, glitch, cracks.
// ──────────────────────────────────────────────────────────────────────
//
// Companion to `draw.js` (static draw vocab)
// (silhouette-level treatments like bloom/outline). These are spatial
// distortions applied to a sub-region of any composition — wrap a
// drawer in `pxWiggle` to wiggle just the tree canopy, leave the
// trunk un-wrapped.
//
// ── API shape ─────────────────────────────────────────────────────────
//   pxWiggle(ctx, x, y, w, h, drawFn, t, opts) — per-row sin displacement
//   pxShake (ctx, x, y, w, h, drawFn, t, opts) — whole-rect jitter
//   pxGlitch(ctx, x, y, w, h, drawFn, t, opts) — random row tears
//   pxCracks(ctx, x, y, w, h, opts)            — fractal crack overlay (no drawer)
//
//   createFxRegistry() → { add, remove, clear, list, draw, has }
//     A stateful list of in-flight effects with world positions and
//     auto-expire lifetimes — the runtime-stamp/clear pattern. Used
//     when you want to *trigger* an effect on a tile (hulk lands →
//     cracks appear, expire 5s later) rather than wrap a drawer each
//     frame.
//
// drawFn signature: `(offCtx, ox, oy) => void` — same contract as
// `effects.js`. The wrap calls it once into a pooled scratch canvas
// per frame (or once at bake time), then blits back distorted.
//
// ── Caching modes ─────────────────────────────────────────────────────
// Same `cacheKey` opt as `effects.js`, but two modes for animated
// distortions:
//
//   • cacheKey alone        — bake the drawFn output once; per-frame
//                             distortion runs cheaply on the cached
//                             silhouette. Static effects (`pxCracks`)
//                             use this — one bake, blit each frame.
//   • cacheKey + frames: N  — pre-render N evenly-spaced phases of the
//                             distortion into a horizontal strip atlas.
//                             Per-frame cost = one drawImage lookup.
//                             Memory cost = N × w × h × 4 bytes per key.
//                             16 frames is usually enough at 60Hz.
//
// Pass `seed` and it gets folded into the internal cache key
// automatically — different seeds always bake separately, so two trees
// next to each other don't accidentally share the same wiggle phase
// just because they share a sprite cacheKey.

import { lightningBolt, LIGHTNING_ARC } from './draw.js';

// ── Pooled scratch offscreen (one shared per width-class) ────────────
const _scratchPool = [];
function _scratch(w, h) {
  for (let i = 0; i < _scratchPool.length; i++) {
    const s = _scratchPool[i];
    if (s.canvas.width >= w && s.canvas.height >= h && !s.busy) {
      s.busy = true;
      s.ctx.imageSmoothingEnabled = false;
      s.ctx.clearRect(0, 0, w, h);
      return s;
    }
  }
  const c = document.createElement('canvas');
  c.width = Math.max(w, 32); c.height = Math.max(h, 32);
  const ctx = c.getContext('2d');
  ctx.imageSmoothingEnabled = false;
  const s = { canvas: c, ctx, busy: true };
  _scratchPool.push(s);
  return s;
}
function _release(s) { s.busy = false; }

// ── Cache stores ─────────────────────────────────────────────────────
const _staticCache = new Map();   // key → canvas (single bake)
const _stripCache  = new Map();   // key → { canvas, frames, w, h }

function _composeKey(cacheKey, seed, frames, extra) {
  if (cacheKey == null) return null;
  return cacheKey + '|' + (seed ?? 0) + '|' + (frames ?? 0) + (extra ? '|' + extra : '');
}

// ── PRNG — xorshift32, deterministic, no Math.random ─────────────────
function _prng(seed) {
  let s = (seed * 2654435761) | 0; if (s === 0) s = 1;
  return () => {
    s ^= s << 13; s ^= s >>> 17; s ^= s << 5;
    return ((s >>> 0) / 0xffffffff);
  };
}

// ── Bake helpers ─────────────────────────────────────────────────────
function _bakeOnce(w, h, drawFn) {
  const c = document.createElement('canvas');
  c.width = w; c.height = h;
  const ctx = c.getContext('2d');
  ctx.imageSmoothingEnabled = false;
  drawFn(ctx, 0, 0);
  return c;
}

function _bakeStrip(w, h, frames, drawFrameFn) {
  // Horizontal strip — frame N at x = N*w. Single canvas = single
  // GPU-uploaded texture, so per-frame lookup is one drawImage with
  // no atlas-switching cost.
  const c = document.createElement('canvas');
  c.width = w * frames; c.height = h;
  const ctx = c.getContext('2d');
  ctx.imageSmoothingEnabled = false;
  for (let i = 0; i < frames; i++) {
    ctx.save();
    ctx.translate(i * w, 0);
    drawFrameFn(ctx, i);
    ctx.restore();
  }
  return c;
}

// ─────────────────────────────────────────────────────────────────────
// pxWiggle — per-row (or per-column) sin displacement.
// ─────────────────────────────────────────────────────────────────────
// Wraps `drawFn` and re-blits it row-by-row with each row shifted by
// `sin(phase + row/waveLen * 2π) * amp`. Reads as gentle swaying for
// foliage, flags, water surfaces.
//
//   opts:
//     amp      — peak displacement in px (default 2)
//     freq     — phase advance rate, rad/ms (default 0.005 ≈ 0.8 Hz)
//     waveLen  — pixels per spatial wave cycle (default 8). Smaller =
//                more bend per pixel = more chaotic.
//     vertical — bool, wave runs along y axis (per-column up/down
//                offset) instead of along x (per-row left/right).
//                Default false. Use vertical for tall grass clumps;
//                horizontal for tree canopies.
//     phase    — additive phase offset rad (default 0). Useful for
//                desynchronizing many wiggles of the same key.
//     cacheKey, frames, seed — see cache notes at top.
export function pxWiggle(ctx, x, y, w, h, drawFn, t, opts = {}) {
  const amp      = opts.amp      != null ? opts.amp      : 2;
  const freq     = opts.freq     != null ? opts.freq     : 0.005;
  const waveLen  = opts.waveLen  != null ? opts.waveLen  : 8;
  const vertical = !!opts.vertical;
  const phase0   = opts.phase    || 0;
  const seed     = opts.seed     || 0;
  const cacheKey = opts.cacheKey;
  const frames   = opts.frames   || 0;

  // Strip-cache mode — pre-baked frames, lookup by phase.
  if (cacheKey && frames > 0) {
    const key = _composeKey(cacheKey, seed, frames, 'wiggle:' + amp + ':' + waveLen + ':' + (vertical ? 'V' : 'H'));
    let entry = _stripCache.get(key);
    if (!entry) {
      const baked = _bakeStrip(w, h, frames, (sctx, idx) => {
        const ph = (idx / frames) * Math.PI * 2;
        const src = _bakeOnce(w, h, drawFn);
        _stampWiggle(sctx, src, 0, 0, w, h, amp, waveLen, vertical, ph);
      });
      entry = { canvas: baked, frames, w, h };
      _stripCache.set(key, entry);
    }
    const ph = (t * freq * 1000 + phase0) / (Math.PI * 2);
    let idx = Math.floor((ph - Math.floor(ph)) * entry.frames);
    if (idx < 0) idx += entry.frames;
    ctx.drawImage(entry.canvas, idx * w, 0, w, h, x, y, w, h);
    return;
  }

  // Static-cache mode — bake drawFn once, distort fresh each frame.
  let src;
  if (cacheKey) {
    const key = _composeKey(cacheKey, seed, 0, 'src');
    src = _staticCache.get(key);
    if (!src) { src = _bakeOnce(w, h, drawFn); _staticCache.set(key, src); }
  } else {
    const s = _scratch(w, h);
    drawFn(s.ctx, 0, 0);
    src = s.canvas;
    _stampWiggle(ctx, src, x, y, w, h, amp, waveLen, vertical, t * freq * 1000 + phase0);
    _release(s);
    return;
  }
  _stampWiggle(ctx, src, x, y, w, h, amp, waveLen, vertical, t * freq * 1000 + phase0);
}

function _stampWiggle(ctx, src, dx, dy, w, h, amp, waveLen, vertical, phase) {
  ctx.imageSmoothingEnabled = false;
  if (vertical) {
    for (let col = 0; col < w; col++) {
      const off = Math.round(Math.sin(phase + (col / waveLen) * Math.PI * 2) * amp);
      ctx.drawImage(src, col, 0, 1, h, dx + col, dy + off, 1, h);
    }
  } else {
    for (let row = 0; row < h; row++) {
      const off = Math.round(Math.sin(phase + (row / waveLen) * Math.PI * 2) * amp);
      ctx.drawImage(src, 0, row, w, 1, dx + off, dy + row, w, 1);
    }
  }
}

// ─────────────────────────────────────────────────────────────────────
// pxShake — whole-rect random jitter.
// ─────────────────────────────────────────────────────────────────────
// Renders drawFn at (x + jx, y + jy) where (jx, jy) flick around a
// circle of radius `amp`. Reads as impact recoil or sustained tension.
//
//   opts:
//     amp       — max pixel offset (default 2)
//     freq      — jitter advance rate, Hz (default 30 — flicker fast)
//     decay     — bool/duration, if true the amp ramps from full →
//                 zero over the effect's lifetime. Set as `decay: ms`
//                 (a number) to drive the ramp, or `decay: { startedAt, ms }`
//                 for one-shot fade from a trigger timestamp.
//     seed      — base seed (default 0)
//     cacheKey  — bake drawFn once, blit per frame (recommended for
//                 expensive drawers)
export function pxShake(ctx, x, y, w, h, drawFn, t, opts = {}) {
  const amp   = opts.amp  != null ? opts.amp  : 2;
  const freq  = opts.freq != null ? opts.freq : 30;
  const seed  = opts.seed || 0;
  const cacheKey = opts.cacheKey;

  let curAmp = amp;
  if (opts.decay && typeof opts.decay === 'object') {
    const elapsed = performance.now() - opts.decay.startedAt;
    const k = Math.max(0, 1 - elapsed / opts.decay.ms);
    curAmp = amp * k;
    if (curAmp <= 0) { drawFn(ctx, x, y); return; }
  } else if (typeof opts.decay === 'number') {
    const k = Math.max(0, 1 - ((t * 1000) % opts.decay) / opts.decay);
    curAmp = amp * k;
  }

  const tick = Math.floor(t * freq) ^ seed;
  const rnd = _prng(tick * 16807);
  const a = rnd() * Math.PI * 2;
  const r = rnd() * curAmp;
  const jx = Math.round(Math.cos(a) * r);
  const jy = Math.round(Math.sin(a) * r);

  if (cacheKey) {
    const key = _composeKey(cacheKey, seed, 0, 'shakeSrc');
    let src = _staticCache.get(key);
    if (!src) { src = _bakeOnce(w, h, drawFn); _staticCache.set(key, src); }
    ctx.imageSmoothingEnabled = false;
    ctx.drawImage(src, x + jx, y + jy);
  } else {
    drawFn(ctx, x + jx, y + jy);
  }
}

// ─────────────────────────────────────────────────────────────────────
// pxGlitch — random row tears (CRT-style horizontal slip).
// ─────────────────────────────────────────────────────────────────────
// Some rows shift sharply left/right by `tearAmp` px; others stay
// put. Reads as digital corruption / damage glitch. Tear positions
// re-roll on each tickRate boundary.
//
//   opts:
//     tearAmp    — max horizontal slip per tear, px (default 4)
//     tearChance — per-row probability of tearing (default 0.15)
//     freq       — tear pattern re-roll rate, Hz (default 8)
//     seed       — base seed (default 0)
//     cacheKey, frames — supports both cache modes
export function pxGlitch(ctx, x, y, w, h, drawFn, t, opts = {}) {
  const tearAmp    = opts.tearAmp    != null ? opts.tearAmp    : 4;
  const tearChance = opts.tearChance != null ? opts.tearChance : 0.15;
  const freq       = opts.freq       != null ? opts.freq       : 8;
  const seed       = opts.seed       || 0;
  const cacheKey   = opts.cacheKey;
  const frames     = opts.frames     || 0;

  if (cacheKey && frames > 0) {
    const key = _composeKey(cacheKey, seed, frames, 'glitch:' + tearAmp + ':' + tearChance);
    let entry = _stripCache.get(key);
    if (!entry) {
      const baked = _bakeStrip(w, h, frames, (sctx, idx) => {
        const src = _bakeOnce(w, h, drawFn);
        _stampGlitch(sctx, src, 0, 0, w, h, tearAmp, tearChance, seed ^ (idx * 2654435761));
      });
      entry = { canvas: baked, frames, w, h };
      _stripCache.set(key, entry);
    }
    const idx = Math.floor(t * freq) % entry.frames;
    const safe = ((idx % entry.frames) + entry.frames) % entry.frames;
    ctx.drawImage(entry.canvas, safe * w, 0, w, h, x, y, w, h);
    return;
  }

  const tick = Math.floor(t * freq) ^ seed;
  let src;
  if (cacheKey) {
    const key = _composeKey(cacheKey, seed, 0, 'glitchSrc');
    src = _staticCache.get(key);
    if (!src) { src = _bakeOnce(w, h, drawFn); _staticCache.set(key, src); }
    _stampGlitch(ctx, src, x, y, w, h, tearAmp, tearChance, tick);
  } else {
    const s = _scratch(w, h);
    drawFn(s.ctx, 0, 0);
    _stampGlitch(ctx, s.canvas, x, y, w, h, tearAmp, tearChance, tick);
    _release(s);
  }
}

function _stampGlitch(ctx, src, dx, dy, w, h, tearAmp, tearChance, tickSeed) {
  ctx.imageSmoothingEnabled = false;
  const rnd = _prng(tickSeed * 16807);
  for (let row = 0; row < h; row++) {
    let off = 0;
    if (rnd() < tearChance) off = Math.round((rnd() * 2 - 1) * tearAmp);
    ctx.drawImage(src, 0, row, w, 1, dx + off, dy + row, w, 1);
  }
}

// ─────────────────────────────────────────────────────────────────────
// pxCracks — procedural fractal crack overlay (no drawer).
// ─────────────────────────────────────────────────────────────────────
// Paints jagged crack lines onto ctx within the (x, y, w, h) rect.
// Standalone — does not wrap a drawer; just overlays cracks wherever
// you put it. Caller is responsible for clipping (e.g. ctx.clip with
// a tile path) if cracks should only show on the silhouette.
//
//   opts:
//     branches  — number of primary cracks radiating from origin (default 4)
//     depth     — recursion depth for sub-cracks (default 2)
//     length    — primary crack length px (default = min(w,h) * 0.45)
//     jitter    — fraction of length used as midpoint displacement (default 0.18)
//     color     — crack color (default '#000000')
//     hiColor   — optional brighter highlight color drawn 1px above the
//                 crack for an etched/recessed look (default null)
//     thickness — 1 or 2 (default 1)
//     originX/Y — start point relative to (x, y) (default = center)
//     seed      — deterministic shape (default 0)
//     cacheKey  — static bake mode (recommended for tiles that won't
//                 change). seed is auto-folded into the cache key.
export function pxCracks(ctx, x, y, w, h, opts = {}) {
  const branches  = opts.branches  != null ? opts.branches  : 4;
  const depth     = opts.depth     != null ? opts.depth     : 2;
  const length    = opts.length    != null ? opts.length    : Math.min(w, h) * 0.45;
  const jitter    = opts.jitter    != null ? opts.jitter    : 0.18;
  const color     = opts.color     || '#000000';
  const hiColor   = opts.hiColor   || null;
  const thickness = opts.thickness || 1;
  const originX   = opts.originX   != null ? opts.originX   : w / 2;
  const originY   = opts.originY   != null ? opts.originY   : h / 2;
  const seed      = opts.seed      || 0;
  const cacheKey  = opts.cacheKey;

  // Static-cache: bake once at (0,0)→(w,h), blit per call.
  if (cacheKey) {
    const key = _composeKey(cacheKey, seed, 0,
      'cracks:' + branches + ':' + depth + ':' + Math.round(length) + ':' + color + ':' + (hiColor || '_') + ':' + thickness);
    let baked = _staticCache.get(key);
    if (!baked) {
      baked = _bakeOnce(w, h, (octx) => {
        _paintCracks(octx, originX, originY, branches, depth, length, jitter, color, hiColor, thickness, seed);
      });
      _staticCache.set(key, baked);
    }
    ctx.imageSmoothingEnabled = false;
    ctx.drawImage(baked, x, y);
    return;
  }

  _paintCracks(ctx, x + originX, y + originY, branches, depth, length, jitter, color, hiColor, thickness, seed);
}

function _paintCracks(ctx, ox, oy, branches, depth, length, jitter, color, hiColor, thickness, seed) {
  const rnd = _prng(seed || 1);
  // Each primary crack: random angle around origin, midpoint-displaced
  // jagged segment. Sub-cracks fork off interior nodes with shorter
  // length + half jitter, recursed `depth` times.
  const baseAng = rnd() * Math.PI * 2;
  for (let b = 0; b < branches; b++) {
    const ang = baseAng + (b / branches) * Math.PI * 2 + (rnd() * 0.5 - 0.25);
    const len = length * (0.7 + rnd() * 0.6);
    _crackSegment(ctx, ox, oy,
      ox + Math.cos(ang) * len, oy + Math.sin(ang) * len,
      len * jitter, depth, color, hiColor, thickness, rnd);
  }
}

function _crackSegment(ctx, x0, y0, x1, y1, jit, depth, color, hiColor, thickness, rnd) {
  // Midpoint-displacement polyline. Each pass inserts a perpendicular-
  // offset midpoint between every adjacent pair.
  let pts = [[x0, y0], [x1, y1]];
  const subdivisions = 4;
  let j = jit;
  for (let d = 0; d < subdivisions; d++) {
    const next = [pts[0]];
    for (let i = 0; i < pts.length - 1; i++) {
      const [px, py] = pts[i];
      const [qx, qy] = pts[i + 1];
      const mx = (px + qx) / 2, my = (py + qy) / 2;
      const sl = Math.hypot(qx - px, qy - py) || 1;
      const nx = -(qy - py) / sl, ny = (qx - px) / sl;
      const off = (rnd() * 2 - 1) * j;
      next.push([mx + nx * off, my + ny * off]);
      next.push([qx, qy]);
    }
    pts = next;
    j *= 0.5;
  }

  // Bresenham-rasterize each segment as a 1- or 2-px line.
  for (let i = 0; i < pts.length - 1; i++) {
    _line(ctx, pts[i][0], pts[i][1], pts[i + 1][0], pts[i + 1][1], color, thickness);
    if (hiColor) _line(ctx, pts[i][0], pts[i][1] - 1, pts[i + 1][0], pts[i + 1][1] - 1, hiColor, 1);
  }

  // Fork sub-cracks at random interior nodes.
  if (depth > 0) {
    const forkCount = 1 + Math.floor(rnd() * 2);
    for (let f = 0; f < forkCount; f++) {
      const ni = 1 + Math.floor(rnd() * (pts.length - 2));
      const [fx, fy] = pts[ni];
      const [px, py] = pts[ni - 1];
      const [qx, qy] = pts[ni + 1];
      const tx = qx - px, ty = qy - py;
      const tl = Math.hypot(tx, ty) || 1;
      const ang = Math.atan2(ty, tx) + (rnd() < 0.5 ? -1 : 1) * (0.6 + rnd() * 0.6);
      const childLen = Math.hypot(x1 - x0, y1 - y0) * (0.35 + rnd() * 0.3);
      _crackSegment(ctx, fx, fy,
        fx + Math.cos(ang) * childLen, fy + Math.sin(ang) * childLen,
        jit * 0.5, depth - 1, color, hiColor, thickness, rnd);
    }
  }
}

function _line(ctx, x0, y0, x1, y1, color, thickness) {
  x0 = Math.round(x0); y0 = Math.round(y0); x1 = Math.round(x1); y1 = Math.round(y1);
  ctx.fillStyle = color;
  const dx = Math.abs(x1 - x0), dy = Math.abs(y1 - y0);
  const sx = x0 < x1 ? 1 : -1, sy = y0 < y1 ? 1 : -1;
  let err = dx - dy, x = x0, y = y0;
  const t = thickness;
  while (true) {
    ctx.fillRect(x, y, t, t);
    if (x === x1 && y === y1) break;
    const e2 = err * 2;
    if (e2 > -dy) { err -= dy; x += sx; }
    if (e2 <  dx) { err += dx; y += sy; }
  }
}

// ─────────────────────────────────────────────────────────────────────
// pxStretch — elongate (or compress) drawer along an axis with optional bend.
// ─────────────────────────────────────────────────────────────────────
// Renders drawFn to a scratch, then re-blits row-by-row (or col-by-col)
// onto a destination of `length` px along the chosen axis. `pivot`
// controls which end of the original is anchored to its source
// position — `'start'` keeps the top/left fixed (rubber arm reaches
// outward from the shoulder), `'end'` keeps the bottom/right fixed.
// `bend` adds a perpendicular quadratic offset so the stretch arcs.
//
//   opts:
//     length   — target dimension along axis in px (default = source dim)
//     axis     — 'x' | 'y' (default 'y')
//     pivot    — 'start' | 'end' | 0..1 (default 'start')
//     bend     — peak perpendicular offset px at the midpoint (default 0)
//     volume   — bool, scale the perpendicular dim inversely so the
//                shape preserves visual mass (default false — stretching
//                a hand outward shouldn't make it skinnier unless asked)
//     cacheKey — bake the drawer once and re-blit (recommended)
//     seed     — cache disambiguator
export function pxStretch(ctx, x, y, w, h, drawFn, opts = {}) {
  const axis    = opts.axis    || 'y';
  const isY     = axis === 'y';
  const srcAxis = isY ? h : w;
  const srcPerp = isY ? w : h;
  const length  = opts.length != null ? Math.max(1, Math.round(opts.length)) : srcAxis;
  const pivot   = opts.pivot != null ? opts.pivot : 'start';
  const bend    = opts.bend    || 0;
  const volume  = !!opts.volume;
  const seed    = opts.seed    || 0;
  const cacheKey = opts.cacheKey;

  const pivotNum = pivot === 'start' ? 0 : pivot === 'end' ? 1 : pivot;
  const axisRatio = length / srcAxis;
  const dstPerp = volume ? Math.max(1, Math.round(srcPerp / Math.sqrt(axisRatio))) : srcPerp;
  const axisOffset = (srcAxis - length) * pivotNum;
  const perpOffset = Math.round((srcPerp - dstPerp) / 2);

  let src;
  if (cacheKey) {
    const key = _composeKey(cacheKey, seed, 0, 'stretchSrc');
    src = _staticCache.get(key);
    if (!src) { src = _bakeOnce(w, h, drawFn); _staticCache.set(key, src); }
  } else {
    const s = _scratch(w, h);
    drawFn(s.ctx, 0, 0);
    _stampStretch(ctx, s.canvas, x, y, srcAxis, srcPerp, length, dstPerp, axisOffset, perpOffset, isY, bend);
    _release(s);
    return;
  }
  _stampStretch(ctx, src, x, y, srcAxis, srcPerp, length, dstPerp, axisOffset, perpOffset, isY, bend);
}

function _stampStretch(ctx, src, dx, dy, srcAxis, srcPerp, dstAxis, dstPerp, axisOff, perpOff, isY, bend) {
  ctx.imageSmoothingEnabled = false;
  const denom = Math.max(1, dstAxis - 1);
  for (let i = 0; i < dstAxis; i++) {
    const t = i / denom;                                       // 0..1 along stretched axis
    const srcI = Math.min(srcAxis - 1, Math.floor(t * (srcAxis - 1)));
    const bendOff = bend !== 0 ? Math.round(4 * t * (1 - t) * bend) : 0;
    if (isY) {
      ctx.drawImage(src, 0, srcI, srcPerp, 1,
                    dx + perpOff + bendOff, dy + axisOff + i, dstPerp, 1);
    } else {
      ctx.drawImage(src, srcI, 0, 1, srcPerp,
                    dx + axisOff + i, dy + perpOff + bendOff, 1, dstPerp);
    }
  }
}

// ─────────────────────────────────────────────────────────────────────
// pxSquish — instantaneous non-uniform scale with volume preservation.
// ─────────────────────────────────────────────────────────────────────
// Caller-driven (no `t`). Use directly for poses ("crouched →
// pre-jump squish"), or animate from outside by varying `amount` over
// time. For self-animating bounce-and-rest, use `pxJelly` instead.
//
//   opts:
//     amount  — -1..1. Positive squishes along axis (shorter +
//               wider when volume), negative stretches (longer +
//               narrower when volume). `0.3` is a classic landing
//               squish; `-0.2` a brief stretch on a jump apex.
//     axis    — 'x' | 'y' (default 'y')
//     pivot   — 'start' | 'end' | 0..1 (default 'end' — gravity-style,
//               bottom-anchored squish)
//     volume  — bool, scale perpendicular axis inversely (default true).
//               Off = pure 1D scale.
//     cacheKey, seed — bake the drawer once + reuse.
export function pxSquish(ctx, x, y, w, h, drawFn, opts = {}) {
  const amount  = opts.amount != null ? Math.max(-1, Math.min(1, opts.amount)) : 0;
  const axis    = opts.axis   || 'y';
  const pivot   = opts.pivot != null ? opts.pivot : 'end';
  const volume  = opts.volume !== false;
  const isY     = axis === 'y';
  const srcAxis = isY ? h : w;
  // amount=1 → length=0 → clamp to 1; amount=-1 → length=2*src.
  const length  = Math.max(1, Math.round(srcAxis * (1 - amount)));
  pxStretch(ctx, x, y, w, h, drawFn, {
    axis, pivot, length, volume,
    cacheKey: opts.cacheKey, seed: opts.seed,
  });
}

// ─────────────────────────────────────────────────────────────────────
// pxJelly — self-animating squish-stretch wobble with optional decay.
// ─────────────────────────────────────────────────────────────────────
// Drives an oscillating `pxSquish` internally so callers don't have
// to manage the bounce envelope. Two modes:
//
//   • Continuous (no `decay`): a steady gentle wobble — jello on a
//     plate, gelatinous slime idle, water balloon.
//   • One-shot (`decay: { startedAt, ms }`): a damped bounce that
//     starts at full amp on `startedAt` and rings down over `ms`,
//     then renders unmodified. Pair with a landing event for the
//     classic "character lands → body jiggles once → settles".
//
//   opts:
//     amp     — peak squish amount (0..1, default 0.18)
//     freq    — bounce frequency in Hz (default 4)
//     axis    — 'x' | 'y' (default 'y')
//     pivot   — 'start' | 'end' | 0..1 (default 'end')
//     phase   — additive phase rad (default 0). Use to desync many
//               jelly entities sharing the same key.
//     decay   — `{ startedAt: ms, ms: ringTime }` for one-shot bounce,
//               or a number `n` for fixed-duration auto-restart cycle.
//     cacheKey, frames — strip-bake the wobble cycle. Strongly
//                        recommended when many entities share the
//                        same jello (whole forest of slimes).
//     seed    — cache disambiguator
export function pxJelly(ctx, x, y, w, h, drawFn, t, opts = {}) {
  const amp   = opts.amp  != null ? opts.amp  : 0.18;
  const freq  = opts.freq != null ? opts.freq : 4;
  const axis  = opts.axis || 'y';
  const pivot = opts.pivot != null ? opts.pivot : 'end';
  const phase0 = opts.phase || 0;
  const seed  = opts.seed || 0;
  const cacheKey = opts.cacheKey;
  const frames   = opts.frames || 0;

  // Decay envelope (one-shot ring-down).
  let envelope = 1;
  if (opts.decay && typeof opts.decay === 'object') {
    const elapsed = performance.now() - opts.decay.startedAt;
    if (elapsed >= opts.decay.ms) { drawFn(ctx, x, y); return; }
    if (elapsed < 0)               { drawFn(ctx, x, y); return; }
    // Cosine ease-out — full amp at start, zero at end.
    envelope = Math.max(0, 1 - elapsed / opts.decay.ms);
    envelope = envelope * envelope;
  }

  // Strip-cached cycle. Note: decay envelope is NOT baked (it varies
  // per trigger), so we apply it on top by scaling the lookup amp via
  // mid-cycle blending. For decaying jelly, drop to procedural — the
  // strip mode is for steady wobbles only.
  if (cacheKey && frames > 0 && envelope === 1) {
    const key = _composeKey(cacheKey, seed, frames, 'jelly:' + amp + ':' + axis + ':' + String(pivot));
    let entry = _stripCache.get(key);
    if (!entry) {
      // Pre-bake one full wobble cycle. Each frame = one phase step.
      const baked = _bakeStrip(w, h, frames, (sctx, idx) => {
        const a = Math.sin((idx / frames) * Math.PI * 2) * amp;
        pxSquish(sctx, 0, 0, w, h, drawFn, { amount: a, axis, pivot });
      });
      entry = { canvas: baked, frames, w, h };
      _stripCache.set(key, entry);
    }
    const ph = (t * freq + phase0 / (Math.PI * 2));
    let idx = Math.floor((ph - Math.floor(ph)) * entry.frames);
    if (idx < 0) idx += entry.frames;
    ctx.imageSmoothingEnabled = false;
    ctx.drawImage(entry.canvas, idx * w, 0, w, h, x, y, w, h);
    return;
  }

  const a = Math.sin(t * freq * Math.PI * 2 + phase0) * amp * envelope;
  pxSquish(ctx, x, y, w, h, drawFn, {
    amount: a, axis, pivot,
    cacheKey: cacheKey, seed,   // share the source bake across phases
  });
}

// ─────────────────────────────────────────────────────────────────────
// pxElectricity — animated electric arcs overlay.
// ─────────────────────────────────────────────────────────────────────
// Standalone (no drawFn) — paints `count` short lightning arcs at
// re-rolled random positions within the bounding rect each `freq`
// ticks. Reads as "this thing is charged / electrified / paralyzed".
// Reuses `lightningBolt` from draw.js so palettes work identically.
//
//   opts:
//     count    — arcs per frame (default 3)
//     freq     — re-roll rate in Hz (default 12 — fast crackle)
//     span     — max bolt length as fraction of min(w,h) (default 0.5)
//     palette  — pixelart palette object (default LIGHTNING_ARC)
//     width    — bolt thickness (default 1)
//     nodes    — bright glow blobs at bend points (default true)
//     glow     — wider halo trail beneath the arc (default true)
//     clip     — bool, clip arcs to (x,y,w,h) bounds (default true).
//                Off if you want the electricity to flicker slightly
//                beyond the edges (aura look).
//     seed     — base seed (default 0)
export function pxElectricity(ctx, x, y, w, h, t, opts = {}) {
  const count   = opts.count   != null ? opts.count   : 3;
  const freq    = opts.freq    != null ? opts.freq    : 12;
  const span    = opts.span    != null ? opts.span    : 0.5;
  const palette = opts.palette || LIGHTNING_ARC;
  const width   = opts.width   != null ? opts.width   : 1;
  const seed    = opts.seed    || 0;
  const clip    = opts.clip    !== false;

  const tick = Math.floor(t * freq) ^ seed;
  const rnd = _prng(tick * 16807 + 1);
  const maxLen = Math.min(w, h) * span;

  if (clip) {
    ctx.save();
    ctx.beginPath();
    ctx.rect(x, y, w, h);
    ctx.clip();
  }
  for (let i = 0; i < count; i++) {
    const sx = x + rnd() * w;
    const sy = y + rnd() * h;
    const ang = rnd() * Math.PI * 2;
    const len = maxLen * (0.4 + rnd() * 0.6);
    const ex = sx + Math.cos(ang) * len;
    const ey = sy + Math.sin(ang) * len;
    lightningBolt(ctx, sx, sy, ex, ey, palette, {
      width, jitter: len * 0.15, subdivisions: 3, forks: 0,
      seed: tick * 31 + i + 1,
      nodes: opts.nodes !== false,
      glow:  opts.glow  !== false,
    });
  }
  if (clip) ctx.restore();
}

// ─────────────────────────────────────────────────────────────────────
// pxRipple — radial wave distortion (water drop, shockwave, sonar ping).
// ─────────────────────────────────────────────────────────────────────
// Per-pixel radial sampling: each output pixel samples the source at
// an offset along its radial vector from `(cx, cy)`, displaced by
// `sin(dist / waveLen * 2π − phase) * amp`. Phase advances with `t`
// so concentric rings expand outward.
//
// Unlike `pxWiggle` (which can fake a 1D wave with per-row blits),
// true radial distortion requires per-pixel sampling — done here via
// a single `getImageData` / `putImageData` round-trip. Cost is O(w*h)
// per frame; strip-cache mode is strongly recommended for entities
// that ripple every frame.
//
//   opts:
//     cx, cy   — ripple center, local to (x, y) (default = w/2, h/2)
//     amp      — peak radial displacement in px (default 2)
//     freq     — phase advance rate, rad/ms (default 0.005)
//     waveLen  — px per radial wave cycle (default 8)
//     cacheKey, frames, seed — strip-bake the cycle (highly advised)
export function pxRipple(ctx, x, y, w, h, drawFn, t, opts = {}) {
  const cx       = opts.cx      != null ? opts.cx      : w / 2;
  const cy       = opts.cy      != null ? opts.cy      : h / 2;
  const amp      = opts.amp     != null ? opts.amp     : 2;
  const freq     = opts.freq    != null ? opts.freq    : 0.005;
  const waveLen  = opts.waveLen != null ? opts.waveLen : 8;
  const seed     = opts.seed    || 0;
  const cacheKey = opts.cacheKey;
  const frames   = opts.frames  || 0;

  // Strip-cache mode — pre-bake N phase frames as a horizontal atlas.
  //
  // Why we can't use `_bakeStrip`: that helper relies on `ctx.translate`
  // to position each frame, but `_stampRipple` uses `putImageData` which
  // is one of the few canvas methods that IGNORES the transformation
  // matrix (spec-defined — putImageData copies raw bytes to absolute
  // pixel coords). So the translate is silently a no-op and every
  // frame overwrites the same `(0, 0)` slot. Inline the strip build
  // here and pass `i * w` straight through as the destination x.
  if (cacheKey && frames > 0) {
    const key = _composeKey(cacheKey, seed, frames,
      'ripple:' + cx + ':' + cy + ':' + amp + ':' + waveLen);
    let entry = _stripCache.get(key);
    if (!entry) {
      const src = _bakeOnce(w, h, drawFn);
      const strip = document.createElement('canvas');
      strip.width = w * frames; strip.height = h;
      const stripCtx = strip.getContext('2d');
      stripCtx.imageSmoothingEnabled = false;
      for (let i = 0; i < frames; i++) {
        const ph = (i / frames) * Math.PI * 2;
        _stampRipple(stripCtx, src, i * w, 0, w, h, cx, cy, amp, waveLen, ph);
      }
      entry = { canvas: strip, frames, w, h };
      _stripCache.set(key, entry);
    }
    const ph = (t * freq * 1000) / (Math.PI * 2);
    let idx = Math.floor((ph - Math.floor(ph)) * entry.frames);
    if (idx < 0) idx += entry.frames;
    ctx.imageSmoothingEnabled = false;
    ctx.drawImage(entry.canvas, idx * w, 0, w, h, x, y, w, h);
    return;
  }

  // Procedural fallback — one round-trip per call. Slow but correct.
  const s = _scratch(w, h);
  drawFn(s.ctx, 0, 0);
  _stampRipple(ctx, s.canvas, x, y, w, h, cx, cy, amp, waveLen, t * freq * 1000);
  _release(s);
}

function _stampRipple(ctx, srcCanvas, dx, dy, w, h, cx, cy, amp, waveLen, phase) {
  // Sample source pixels via imageData (per-pixel drawImage at 1×1
  // would be w*h calls). Out-of-bounds samples leave the destination
  // transparent (zeroed by `new ImageData`).
  const srcCtx = srcCanvas.getContext('2d');
  const srcData = srcCtx.getImageData(0, 0, w, h);
  const dstData = new ImageData(w, h);
  const srcA = srcData.data;
  const dstA = dstData.data;
  const k = (Math.PI * 2) / waveLen;
  for (let py = 0; py < h; py++) {
    for (let px = 0; px < w; px++) {
      const ddx = px - cx, ddy = py - cy;
      const dist = Math.sqrt(ddx * ddx + ddy * ddy);
      let sx = px, sy = py;
      if (dist > 0.5) {
        const off = Math.sin(dist * k - phase) * amp;
        const scale = off / dist;
        sx = Math.round(px - ddx * scale);
        sy = Math.round(py - ddy * scale);
      }
      if (sx < 0 || sx >= w || sy < 0 || sy >= h) continue;
      const si = (sy * w + sx) * 4;
      const di = (py * w + px) * 4;
      dstA[di]     = srcA[si];
      dstA[di + 1] = srcA[si + 1];
      dstA[di + 2] = srcA[si + 2];
      dstA[di + 3] = srcA[si + 3];
    }
  }
  ctx.putImageData(dstData, dx, dy);
}

// ─────────────────────────────────────────────────────────────────────
// pxDissolve — noise-thresholded alpha mask (transporter / vanish).
// ─────────────────────────────────────────────────────────────────────
// Each opaque source pixel gets a deterministic threshold in [0, 1)
// from `hash(px, py, seed)`. As `progress` rises from 0 → 1:
//   • `direction: 'out'` — pixels with `threshold < progress` go
//                          transparent (sprite vanishes pixel-by-pixel)
//   • `direction: 'in'`  — pixels with `threshold > 1 − progress` are
//                          kept (sprite materializes)
//
// Optional `edgeColor` tints pixels near the moving threshold edge —
// the classic "glowing transporter front" look.
//
//   opts:
//     progress   — 0..1 (caller animates this; 0 = fully present)
//     direction  — 'out' (vanish) | 'in' (materialize), default 'out'
//     seed       — per-pixel hash salt (default 0). Same seed → same
//                  dissolve pattern across calls; different seeds give
//                  independent randomness for adjacent sprites.
//     edge       — width of the edge band, in threshold units 0..1
//                  (default 0.05). Pixels within `edge` of the moving
//                  threshold get `edgeColor` tint.
//     edgeColor  — '#rrggbb' string. Null = no edge tint (default).
//
// No strip-cache mode — `progress` is the dominant axis of variation
// and would need N×progress-buckets to bake usefully; not worth it.
export function pxDissolve(ctx, x, y, w, h, drawFn, opts = {}) {
  const progress  = Math.max(0, Math.min(1, opts.progress != null ? opts.progress : 0));
  const direction = opts.direction || 'out';
  const seed      = opts.seed      || 0;
  const edge      = opts.edge      != null ? opts.edge : 0.05;
  const edgeColor = opts.edgeColor || null;

  if (progress <= 0 && direction === 'out') { drawFn(ctx, x, y); return; }
  if (progress >= 1 && direction === 'in')  { drawFn(ctx, x, y); return; }
  if (progress >= 1 && direction === 'out') return;   // fully vanished
  if (progress <= 0 && direction === 'in')  return;   // not yet visible

  const s = _scratch(w, h);
  drawFn(s.ctx, 0, 0);
  const data = s.ctx.getImageData(0, 0, w, h);
  const arr = data.data;

  // Parse edgeColor (if any) into RGB once.
  let er = 0, eg = 0, eb = 0, hasEdge = false;
  if (edgeColor && edge > 0) {
    const m = /^#([0-9a-f]{6})$/i.exec(edgeColor);
    if (m) {
      const n = parseInt(m[1], 16);
      er = (n >> 16) & 0xff; eg = (n >> 8) & 0xff; eb = n & 0xff;
      hasEdge = true;
    }
  }

  const cutoff = direction === 'out' ? progress : 1 - progress;
  for (let py = 0; py < h; py++) {
    for (let px = 0; px < w; px++) {
      const i = (py * w + px) * 4;
      if (arr[i + 3] === 0) continue;                  // already transparent
      // Inline xorshift hash → 0..1.
      let hv = (px * 374761393 + py * 668265263 + seed * 2654435761) | 0;
      hv = (hv ^ (hv >>> 13)) * 1274126177;
      hv = hv ^ (hv >>> 16);
      const thr = (hv >>> 0) / 0xffffffff;
      if (thr < cutoff) {
        arr[i + 3] = 0;
      } else if (hasEdge && thr < cutoff + edge) {
        arr[i]     = er;
        arr[i + 1] = eg;
        arr[i + 2] = eb;
      }
    }
  }
  s.ctx.putImageData(data, 0, 0);
  ctx.imageSmoothingEnabled = false;
  ctx.drawImage(s.canvas, x, y);
  _release(s);
}

// ─────────────────────────────────────────────────────────────────────
// pxBlink — alpha strobe with optional tint pulse.
// ─────────────────────────────────────────────────────────────────────
// Self-animated alpha pulse. Cheapest of the effects here — when no
// tint is requested it's just `globalAlpha *= wave; drawFn(...)` with
// no scratch canvas. Use for "selected" markers, low-HP warnings,
// active waypoint indicators, etc.
//
//   opts:
//     freq      — pulses per second (default 4)
//     duty      — square-wave on-fraction 0..1 (default 0.5). Ignored
//                 when `smooth: true`.
//     smooth    — bool, use sin wave instead of square (default false).
//                 sin gives a soft pulse; square gives a hard strobe.
//     minAlpha  — bottom of the alpha range, 0..1 (default 0)
//     phase     — additive phase, rad (default 0)
//     tint      — optional '#rrggbb' applied via source-atop while the
//                 pulse is on. Adds a scratch round-trip; omit for the
//                 fast pure-alpha path.
export function pxBlink(ctx, x, y, w, h, drawFn, t, opts = {}) {
  const freq     = opts.freq     != null ? opts.freq     : 4;
  const duty     = opts.duty     != null ? opts.duty     : 0.5;
  const minAlpha = opts.minAlpha != null ? opts.minAlpha : 0;
  const phase    = opts.phase    || 0;
  const smooth   = !!opts.smooth;
  const tint     = opts.tint     || null;

  const wave = smooth
    ? (0.5 + 0.5 * Math.sin(t * freq * Math.PI * 2 + phase))
    : (((t * freq + phase / (Math.PI * 2)) % 1) < duty ? 1 : 0);
  const alpha = minAlpha + (1 - minAlpha) * wave;
  if (alpha <= 0) return;

  // Fast path — no tint, alpha = 1 → just draw.
  if (alpha >= 1 && !tint) { drawFn(ctx, x, y); return; }

  if (tint) {
    // Source-atop tint requires a scratch round-trip so the tint
    // clips to the sprite silhouette instead of filling the bbox.
    const s = _scratch(w, h);
    drawFn(s.ctx, 0, 0);
    s.ctx.save();
    s.ctx.globalCompositeOperation = 'source-atop';
    s.ctx.fillStyle = tint;
    s.ctx.fillRect(0, 0, w, h);
    s.ctx.restore();
    ctx.save();
    ctx.imageSmoothingEnabled = false;
    ctx.globalAlpha *= alpha;
    ctx.drawImage(s.canvas, x, y);
    ctx.restore();
    _release(s);
  } else {
    ctx.save();
    ctx.globalAlpha *= alpha;
    drawFn(ctx, x, y);
    ctx.restore();
  }
}

// ─────────────────────────────────────────────────────────────────────
// pxAfterimage — motion trail of decaying-alpha ghost copies.
// ─────────────────────────────────────────────────────────────────────
// Stateless: caller owns the position history (push current pos every
// frame, drop the oldest when it exceeds the trail length). Each ghost
// is drawn at an alpha that ramps from `minAlpha` (oldest) up to
// `maxAlpha` (most recent), then the live entity at `x, y` renders on
// top at full alpha.
//
// Optional `tint` applies a source-atop color to the ghosts — useful
// for the classic blue-trail "dashing" look. Tint is baked once per
// call into a shared scratch and reused across all trail copies.
//
//   opts:
//     trail     — Array<[x, y]>, oldest → newest, EXCLUDING current pos.
//                 Empty/missing = no trail (just draws live position).
//     minAlpha  — alpha of the oldest ghost (default 0.15)
//     maxAlpha  — alpha of the newest ghost (default 0.5)
//     tint      — optional '#rrggbb' applied to ghosts via source-atop.
//                 Live entity is NOT tinted.
export function pxAfterimage(ctx, x, y, w, h, drawFn, t, opts = {}) {
  const trail    = opts.trail    || [];
  const minAlpha = opts.minAlpha != null ? opts.minAlpha : 0.15;
  const maxAlpha = opts.maxAlpha != null ? opts.maxAlpha : 0.5;
  const tint     = opts.tint     || null;

  // Pre-bake a tinted silhouette once if needed — reused for every
  // trail position.
  let s = null;
  let stamp = null;
  if (trail.length > 0 && tint) {
    s = _scratch(w, h);
    drawFn(s.ctx, 0, 0);
    s.ctx.save();
    s.ctx.globalCompositeOperation = 'source-atop';
    s.ctx.fillStyle = tint;
    s.ctx.fillRect(0, 0, w, h);
    s.ctx.restore();
    stamp = s.canvas;
  }

  if (trail.length > 0) {
    ctx.save();
    ctx.imageSmoothingEnabled = false;
    for (let i = 0; i < trail.length; i++) {
      const age = trail.length === 1 ? 1 : (i + 1) / (trail.length + 1);
      ctx.globalAlpha = minAlpha + (maxAlpha - minAlpha) * age;
      const [tx, ty] = trail[i];
      if (stamp) ctx.drawImage(stamp, tx, ty);
      else       drawFn(ctx, tx, ty);
    }
    ctx.restore();
  }
  if (s) _release(s);

  // Live entity on top at full alpha (un-tinted).
  drawFn(ctx, x, y);
}

// ─────────────────────────────────────────────────────────────────────
// pxScanline — moving horizontal sweep band (sci-fi scan / hack / heal).
// ─────────────────────────────────────────────────────────────────────
// Draws the base sprite, then overlays a bright horizontal band that
// sweeps top→bottom (or bottom→top) over time. The band is clipped to
// the sprite silhouette via source-atop, so it reads as "light moving
// across the entity" rather than a screen-space stripe.
//
//   opts:
//     freq        — sweeps per second (default 0.5 = one full pass per 2s)
//     direction   — 'down' (default) | 'up'
//     bandHeight  — sweep band thickness in px (default 2)
//     sweepColor  — '#rrggbb' (default '#80c0ff' — cool cyan)
//     trailColor  — optional dimmer trail color behind the sweep
//                   (default null). Set to e.g. 'rgba(128,192,255,0.15)'
//                   for a fading "scanned" wake.
//     trailLen    — trail band height in px (default 6). Only when
//                   `trailColor` is set.
//     phase       — additive phase 0..1 (default 0)
export function pxScanline(ctx, x, y, w, h, drawFn, t, opts = {}) {
  const freq       = opts.freq       != null ? opts.freq       : 0.5;
  const direction  = opts.direction  || 'down';
  const bandHeight = opts.bandHeight != null ? opts.bandHeight : 2;
  const sweepColor = opts.sweepColor || '#80c0ff';
  const trailColor = opts.trailColor || null;
  const trailLen   = opts.trailLen   != null ? opts.trailLen   : 6;
  const phase      = opts.phase      || 0;

  // Draw base sprite first.
  drawFn(ctx, x, y);

  // Compute sweep position. Rendered via source-atop on a scratch so
  // the band clips to the sprite silhouette (not the bbox rect).
  const cycleT = ((t * freq + phase) % 1 + 1) % 1;   // safe mod
  const sweepY = direction === 'up'
    ? Math.round((1 - cycleT) * (h + bandHeight)) - bandHeight
    : Math.round(cycleT * (h + bandHeight)) - bandHeight;

  const s = _scratch(w, h);
  drawFn(s.ctx, 0, 0);
  s.ctx.save();
  s.ctx.globalCompositeOperation = 'source-atop';
  // Optional trailing band behind the sweep — dimmer, taller.
  if (trailColor && trailLen > 0) {
    const trailY = direction === 'up' ? sweepY + bandHeight : sweepY - trailLen;
    s.ctx.fillStyle = trailColor;
    s.ctx.fillRect(0, trailY, w, trailLen);
  }
  // Bright sweep band.
  s.ctx.fillStyle = sweepColor;
  s.ctx.fillRect(0, sweepY, w, bandHeight);
  s.ctx.restore();
  ctx.imageSmoothingEnabled = false;
  ctx.drawImage(s.canvas, x, y);
  _release(s);
}

// ─────────────────────────────────────────────────────────────────────
// pxSlice — bisect a sprite along an arbitrary cut shape, drift apart.
// ─────────────────────────────────────────────────────────────────────
// Renders the sprite, then for each opaque pixel decides which side of
// the cut it's on (via a signed-scalar classifier — sign determines
// the side, magnitude doesn't matter). Pixels on side A displace by
// `+sep*sepDir`; pixels on side B displace by `-sep*sepDir`. A bright
// edge-flash overlay traces the cut at its original (unmoved) shape
// and fades out as the halves drift apart.
//
// Two driving modes (same pattern as `pxJelly`/`pxDissolve`):
//   • Static  — pass `progress` 0..1; caller animates from outside.
//   • Auto    — pass `auto: { startedAt: performance.now(), ms: 600 }`.
//               Progress is computed from wall time.
//
// Cut shape — three layers of control:
//   • Default              — straight line through `(cx, cy)` at `angle`
//   • `cutFn(px, py, w, h)` — arbitrary cut: returns signed scalar; sign
//                             determines which side. Subsumes lines,
//                             waves, jagged noise, arcs, hand-drawn
//                             masks, ANYTHING.
//   • Helper exports        — `sliceCutLine`, `sliceCutWavy`,
//                             `sliceCutJagged`, `sliceCutArc` return
//                             ready-made cutFn values for common shapes.
//
//   opts:
//     progress    — 0..1 (default 0 = intact)
//     auto        — { startedAt, ms } for self-timed progress
//     angle       — cut angle, radians (default 0 = horizontal cut).
//                   Used by the built-in line classifier AND as the
//                   default `sepAngle`.
//     cx, cy      — pivot point the (built-in line) cut passes through.
//                   Default = (w/2, h/2). Ignored when `cutFn` is set.
//     cutFn       — `(px, py, w, h) => number` (default: built-in line).
//                   Sign of return value picks the side. See helpers.
//     sepAngle    — direction (radians) the halves drift apart along.
//                   Default = `angle`. Useful with curved `cutFn` —
//                   the halves can still drift cleanly along a single
//                   chosen axis (e.g. straight up for a tree top).
//     separation  — max px the halves drift (default = min(w,h) * 0.4)
//     edgeColor   — flash color (default '#ffffff')
//     edgeWidth   — flash thickness px (default 1)
//     edgeFlash   — fraction of progress over which the flash decays
//                   from alpha 1 → 0 (default 0.25)
//     fade        — bool shorthand for endAlpha — `true` maps to
//                   endAlpha 0.15 (default classic dissipation),
//                   `false` to endAlpha 1.0 (no fade at all).
//     endAlpha    — explicit target alpha for the moving halves when
//                   `progress=1`. Lerps linearly from 1.0 at the start
//                   to `endAlpha` at the end. Overrides `fade` when
//                   set. Use `0.0` for the dramatic "fully vanish",
//                   `1.0` for "stay opaque", `0.4` for "ghostly".
//                   The locked side from `staySide` is never alpha-
//                   modified, regardless of this setting — it
//                   represents intact mass and stays at full opacity.
//     staySide    — `'positive'` | `'negative'` | null (default null).
//                   When set, the named side STAYS at the origin while
//                   the other side moves by the full `sep` distance.
//                   "Positive" = where `cutFn(px,py) >= 0`. For the
//                   built-in line cut, positive is the side the
//                   `angle`-normal points toward; for the helper cuts:
//                     • sliceCutWavy(y)   → positive = above the wave
//                     • sliceCutJagged(y) → positive = above the teeth
//                     • sliceCutArc(...)  → positive = INSIDE the circle
//                   Canonical use: cut a tree's canopy off with
//                   `sliceCutWavy`, set `staySide: 'negative'` so the
//                   trunk holds still and the canopy alone drifts up.
//
// No strip-cache — `progress` is the dominant axis of variation.
export function pxSlice(ctx, x, y, w, h, drawFn, opts = {}) {
  // Resolve progress — auto-timed OR caller-driven.
  let progress;
  if (opts.auto && typeof opts.auto === 'object') {
    const elapsed = performance.now() - opts.auto.startedAt;
    progress = Math.max(0, Math.min(1, elapsed / Math.max(1, opts.auto.ms)));
  } else {
    progress = Math.max(0, Math.min(1, opts.progress != null ? opts.progress : 0));
  }
  if (progress <= 0) { drawFn(ctx, x, y); return; }

  const angle      = opts.angle      != null ? opts.angle      : 0;
  const separation = opts.separation != null ? opts.separation : Math.min(w, h) * 0.4;
  const edgeColor  = opts.edgeColor  || '#ffffff';
  const edgeWidth  = opts.edgeWidth  != null ? opts.edgeWidth  : 1;
  const edgeFlash  = opts.edgeFlash  != null ? opts.edgeFlash  : 0.25;
  const fade       = opts.fade       !== false;
  const cx         = opts.cx         != null ? opts.cx         : w / 2;
  const cy         = opts.cy         != null ? opts.cy         : h / 2;

  // Cut classifier — caller's `cutFn` OR built-in line. The built-in
  // form is the same math as before: signed perpendicular distance from
  // `(cx, cy)` to `(px, py)` along the line's normal.
  const builtinNX = -Math.sin(angle);
  const builtinNY =  Math.cos(angle);
  const customCut = !!opts.cutFn;
  const cutFn = opts.cutFn ||
    ((px, py) => (px - cx) * builtinNX + (py - cy) * builtinNY);

  // Separation axis — defaults to the angle's normal. Caller may pass
  // `sepAngle` to drift the halves along a DIFFERENT axis from the cut
  // tangent — useful when the cut is curved (chop-tree-top → halves
  // drift along Y regardless of cut wave shape).
  const sepAngle = opts.sepAngle != null ? opts.sepAngle : angle;
  const sepNX    = -Math.sin(sepAngle);
  const sepNY    =  Math.cos(sepAngle);

  // Ease — slow start, accelerates.
  const ease = progress * progress;
  const sep  = separation * ease;
  const offX = Math.round(sepNX * sep);
  const offY = Math.round(sepNY * sep);

  // Render source + read imageData.
  const s = _scratch(w, h);
  drawFn(s.ctx, 0, 0);
  const srcData = s.ctx.getImageData(0, 0, w, h);
  const src = srcData.data;
  const out = new ImageData(w, h);
  const dst = out.data;

  // Alpha curve for the moving halves. `endAlpha` is the target alpha
  // at progress=1; we lerp linearly from 1 (at start) to endAlpha (at
  // end). Resolution order: explicit `endAlpha` opt wins, then `fade`
  // bool maps to the legacy 0.15-vs-1.0 split, default is 0.15 to
  // preserve old behavior.
  let endAlpha;
  if (opts.endAlpha != null) endAlpha = Math.max(0, Math.min(1, opts.endAlpha));
  else if (fade === false)   endAlpha = 1;
  else                       endAlpha = 0.15;
  const halfAlpha = Math.max(0, 1 - (1 - endAlpha) * progress);

  // Pre-compute classifier sign per pixel — reused for displacement
  // AND the generalized edge-detection pass below. Caching avoids
  // calling `cutFn` 2-3× per pixel for arbitrary user functions.
  const signs = new Uint8Array(w * h);   // 0 = side B (neg), 1 = side A (≥0)
  for (let py = 0; py < h; py++) {
    for (let px = 0; px < w; px++) {
      signs[py * w + px] = cutFn(px, py, w, h) >= 0 ? 1 : 0;
    }
  }

  // Resolve which side stays put (if any). Encoded as 0/1 so the
  // displacement loop can pick offsets via a single multiply, no
  // per-pixel branch.
  //   stayPos = 1 → side A (sgn=1) stays;  side B moves by -offset
  //   stayPos = 0 → side B (sgn=0) stays;  side A moves by +offset
  //   stayPos = -1 → symmetric (current default)
  let stayPos = -1;
  if (opts.staySide === 'positive') stayPos = 1;
  else if (opts.staySide === 'negative') stayPos = 0;

  // Displacement pass. Three modes:
  //   • Symmetric — each side moves by ±offset (the default).
  //   • One side locked — only the non-stay side moves, by ±offset
  //     (full magnitude, NOT halved — sep retains its per-side meaning).
  //   • The locked side: writes its pixels at the SAME position they
  //     started (no displacement), so it draws crisply over the cut
  //     while the other side drifts away.
  for (let py = 0; py < h; py++) {
    for (let px = 0; px < w; px++) {
      const si = (py * w + px) * 4;
      if (src[si + 3] === 0) continue;
      const sgn = signs[py * w + px];
      let dpx, dpy;
      if (stayPos === -1) {
        // Symmetric.
        dpx = sgn ? px + offX : px - offX;
        dpy = sgn ? py + offY : py - offY;
      } else if (sgn === stayPos) {
        // This pixel is on the locked side — stays put.
        dpx = px; dpy = py;
      } else {
        // Other side — gets the FULL offset.
        dpx = sgn ? px + offX : px - offX;
        dpy = sgn ? py + offY : py - offY;
      }
      if (dpx < 0 || dpx >= w || dpy < 0 || dpy >= h) continue;
      const di = (dpy * w + dpx) * 4;
      dst[di    ] = src[si    ];
      dst[di + 1] = src[si + 1];
      dst[di + 2] = src[si + 2];
      // Don't fade the locked-stationary side — it represents "what
      // stays intact." Only the moving side gets the dissipation alpha.
      const useAlpha = (stayPos !== -1 && sgn === stayPos) ? 1 : halfAlpha;
      dst[di + 3] = (src[si + 3] * useAlpha) | 0;
    }
  }

  // Composite + blit.
  s.ctx.clearRect(0, 0, w, h);
  s.ctx.putImageData(out, 0, 0);
  ctx.imageSmoothingEnabled = false;
  ctx.drawImage(s.canvas, x, y);
  _release(s);

  // Edge flash — bright marker at the cut's original position, alpha
  // fades over the first `edgeFlash` of progress. Two render paths:
  // fast-rect for the built-in line case (one rotated fillRect),
  // generalized per-pixel scan for arbitrary cutFn.
  const edgeAlpha = Math.max(0, 1 - progress / Math.max(0.001, edgeFlash));
  if (edgeAlpha <= 0) return;
  ctx.save();
  ctx.globalAlpha *= edgeAlpha;
  ctx.fillStyle = edgeColor;
  if (customCut) {
    // Per-pixel sign-change scan — paint where a neighbor has opposite
    // sign. Works for any cut shape. The `signs` matrix is already
    // populated, so this is pure O(w*h) integer comparisons.
    for (let py = 0; py < h; py++) {
      for (let px = 0; px < w; px++) {
        const i = py * w + px;
        const s2 = signs[i];
        const right  = px + 1 < w && signs[i + 1]     !== s2;
        const bottom = py + 1 < h && signs[i + w]     !== s2;
        if (right || bottom) {
          ctx.fillRect(x + px, y + py, edgeWidth, edgeWidth);
        }
      }
    }
  } else {
    // Built-in line: one rotated fillRect spanning the bbox diagonal.
    ctx.translate(x + cx, y + cy);
    ctx.rotate(angle);
    const lineLen = Math.hypot(w, h);
    ctx.fillRect(-lineLen / 2, -edgeWidth / 2, lineLen, edgeWidth);
  }
  ctx.restore();
}

// ── pxSlice cutFn helpers ────────────────────────────────────────────
// Each returns a `cutFn(px, py, w, h) → signed scalar` suitable for
// `pxSlice`'s `cutFn` opt. Compose into your own cuts by combining
// (sum of cutFns gives intersection-ish blends; abs gives bands; etc).

// Straight line through (cx, cy) perpendicular to `angle`. Same math
// as pxSlice's built-in default, exported so callers can build one
// explicitly when they want to compose it with other cuts.
export function sliceCutLine(angle, cx, cy) {
  const nx = -Math.sin(angle), ny = Math.cos(angle);
  return (px, py) => (px - cx) * nx + (py - cy) * ny;
}

// Horizontal wave at baseline y. Positive sd above the wave (smaller
// py), negative below. Use `sepAngle: 0` (vertical drift) to lift the
// part above the wave straight up — the canonical "cut the top off
// with a wavy boundary" recipe.
//   opts:
//     freq  — radians per px along x (default 0.35 — gentle bumps)
//     amp   — wave amplitude px (default 3)
//     phase — phase offset rad (default 0). Vary per call to dodge a
//             cut that lands exactly on a wave crest.
export function sliceCutWavy(baseY, opts = {}) {
  const freq  = opts.freq  != null ? opts.freq  : 0.35;
  const amp   = opts.amp   != null ? opts.amp   : 3;
  const phase = opts.phase || 0;
  return (px, py) => (baseY + Math.sin(px * freq + phase) * amp) - py;
}

// Jagged "chainsaw teeth" cut at baseline y. Step-binned PRNG noise so
// adjacent pixels in the same bin share an offset — gives crisp teeth
// rather than per-pixel static.
//   opts:
//     amp  — peak tooth height px (default 2)
//     step — px per tooth (default 3 — small saw teeth)
//     seed — deterministic shape (default 1)
export function sliceCutJagged(baseY, opts = {}) {
  const amp  = opts.amp  != null ? opts.amp  : 2;
  const step = Math.max(1, opts.step != null ? opts.step : 3);
  const seed = (opts.seed != null ? opts.seed : 1) | 0;
  return (px, py) => {
    const bin = Math.floor(px / step);
    let hv = (bin * 374761393 + seed * 668265263) | 0;
    hv = (hv ^ (hv >>> 13)) * 1274126177;
    hv = hv ^ (hv >>> 16);
    const off = ((hv >>> 0) / 0xffffffff - 0.5) * 2 * amp;
    return (baseY + off) - py;
  };
}

// Circular cut centered at (cx, cy) with given radius. Positive sd
// INSIDE the circle, negative outside. Useful for "cut a chunk out"
// effects — apple core, donut hole, projectile passing through.
export function sliceCutArc(cx, cy, radius) {
  return (px, py) => {
    const dx = px - cx, dy = py - cy;
    return radius - Math.sqrt(dx * dx + dy * dy);
  };
}

// Arbitrary silhouette cut driven by a canvas's alpha channel. Reads
// the mask's imageData ONCE at creation time and returns a `cutFn`
// that classifies each pixel as inside/outside the opaque region.
//
// The same mask can drive multiple slice calls (different sprites,
// different `sepAngle`, different `progress`) at no extra cost —
// per-frame slice work stays O(w·h) integer comparisons.
//
//   maskCanvas — any HTMLCanvasElement. Alpha > threshold = side A
//                (positive sd, the "stencil piece"), else side B.
//   opts:
//     threshold — alpha cutoff 0..255 (default 128 — mid-opaque)
//     invert    — bool, swap which side is positive (default false)
//     ox, oy    — pixel offset added to (px, py) before sampling the
//                 mask. Lets the cut shape be positioned anywhere
//                 inside the slice region without re-baking the mask.
//                 Default 0,0 (mask top-left aligns with slice origin).
//
// Cross-origin gotcha: if `maskCanvas` was drawn from a cross-origin
// image without CORS, `getImageData` throws a SecurityError. Mask
// canvases built locally via `bakeCanvas` / `document.createElement`
// are always safe.
export function sliceCutMask(maskCanvas, opts = {}) {
  const threshold = opts.threshold != null ? opts.threshold : 128;
  const invert    = !!opts.invert;
  const ox        = opts.ox || 0;
  const oy        = opts.oy || 0;
  const mw = maskCanvas.width, mh = maskCanvas.height;
  const mctx = maskCanvas.getContext('2d');
  const data = mctx.getImageData(0, 0, mw, mh).data;
  const inside  = invert ? -1 : 1;
  const outside = invert ?  1 : -1;
  return (px, py) => {
    const mx = px - ox, my = py - oy;
    if (mx < 0 || mx >= mw || my < 0 || my >= mh) return outside;
    return data[(my * mw + mx) * 4 + 3] >= threshold ? inside : outside;
  };
}

// ─────────────────────────────────────────────────────────────────────
// pxPixelate — re-quantize to a chunkier pixel grid.
// ─────────────────────────────────────────────────────────────────────
// Downsample the drawer's output to (w/factor × h/factor) with nearest-
// neighbor, then up-sample back to (w × h) with smoothing OFF. Each
// `factor×factor` block becomes one source-sampled color. Uses for the
// "low-res / broken sensor / hacking / demake transition" looks.
//
//   opts:
//     factor — integer downsample factor ≥ 1 (default 2 → 2×2 blocks).
//              factor=1 is a no-op fast path.
//     cacheKey — bake the drawFn once, reuse the downsample (recommended
//                when the source is expensive and `factor` is fixed).
//     seed   — cache disambiguator.
export function pxPixelate(ctx, x, y, w, h, drawFn, opts = {}) {
  const factor = Math.max(1, Math.floor(opts.factor != null ? opts.factor : 2));
  if (factor === 1) { drawFn(ctx, x, y); return; }
  const cacheKey = opts.cacheKey;
  const seed     = opts.seed || 0;

  // Get the source canvas (either freshly drawn or from cache).
  let src;
  if (cacheKey) {
    const key = _composeKey(cacheKey, seed, 0, 'pixelateSrc');
    src = _staticCache.get(key);
    if (!src) { src = _bakeOnce(w, h, drawFn); _staticCache.set(key, src); }
  } else {
    const s = _scratch(w, h);
    drawFn(s.ctx, 0, 0);
    src = s.canvas;
    _pixelateBlit(ctx, src, x, y, w, h, factor);
    _release(s);
    return;
  }
  _pixelateBlit(ctx, src, x, y, w, h, factor);
}

function _pixelateBlit(ctx, src, dx, dy, w, h, factor) {
  // Downsample-then-upsample. The intermediate small canvas is the
  // chunky-pixel representation; up-sampling with smoothing off gives
  // crisp 1:N blocks.
  const smallW = Math.max(1, Math.floor(w / factor));
  const smallH = Math.max(1, Math.floor(h / factor));
  const small = _scratch(smallW, smallH);
  small.ctx.clearRect(0, 0, smallW, smallH);
  small.ctx.imageSmoothingEnabled = false;
  small.ctx.drawImage(src, 0, 0, w, h, 0, 0, smallW, smallH);
  ctx.imageSmoothingEnabled = false;
  ctx.drawImage(small.canvas, 0, 0, smallW, smallH,
                dx, dy, smallW * factor, smallH * factor);
  _release(small);
}

// ─────────────────────────────────────────────────────────────────────
// pxMelt — vertical column-shift with optional drip trails.
// ─────────────────────────────────────────────────────────────────────
// Each column shifts downward by a per-column amount that grows with
// `progress`. PRNG-seeded per-column speed means some columns drip fast
// (long streaks) while others barely move — reads as candle wax / acid
// damage / ghost dissolving downward.
//
// With `trail: true` (default), the vacated rows above each column's
// shifted top are filled with the topmost-source-pixel color, fading
// upward — gives the iconic "wax stalactite" streak between original
// position and current melted-down position.
//
//   opts:
//     progress   — 0..1 (caller-driven)
//     auto       — { startedAt, ms } for self-timed progress
//     seed       — per-column speed pattern (default 1)
//     maxShift   — px the FASTEST column can sink at progress=1
//                  (default = h * 0.7)
//     speedRange — [min, max] multipliers; per-column speed is
//                  PRNG-picked in this range, then scales `maxShift`
//                  (default [0.3, 1.2])
//     trail      — bool, draw drip trails above each shifted column
//                  (default true)
//     trailAlpha — peak alpha of the trail (default 0.6)
export function pxMelt(ctx, x, y, w, h, drawFn, opts = {}) {
  let progress;
  if (opts.auto && typeof opts.auto === 'object') {
    const elapsed = performance.now() - opts.auto.startedAt;
    progress = Math.max(0, Math.min(1, elapsed / Math.max(1, opts.auto.ms)));
  } else {
    progress = Math.max(0, Math.min(1, opts.progress != null ? opts.progress : 0));
  }
  if (progress <= 0) { drawFn(ctx, x, y); return; }

  const seed       = opts.seed       || 1;
  const maxShift   = opts.maxShift   != null ? opts.maxShift   : h * 0.7;
  const range      = opts.speedRange || [0.3, 1.2];
  const trail      = opts.trail      !== false;
  const trailAlpha = opts.trailAlpha != null ? opts.trailAlpha : 0.6;

  // Per-column shift amount (px).
  const rnd = _prng(seed);
  const shift = new Int32Array(w);
  for (let i = 0; i < w; i++) {
    const speed = range[0] + rnd() * (range[1] - range[0]);
    shift[i] = Math.floor(progress * maxShift * speed);
  }

  const s = _scratch(w, h);
  drawFn(s.ctx, 0, 0);
  const srcData = s.ctx.getImageData(0, 0, w, h);
  const src = srcData.data;
  const out = new ImageData(w, h);
  const dst = out.data;

  // Find topmost opaque source row per column (for trail).
  const tops = new Int32Array(w);
  for (let px = 0; px < w; px++) {
    tops[px] = -1;
    for (let py = 0; py < h; py++) {
      if (src[(py * w + px) * 4 + 3] !== 0) { tops[px] = py; break; }
    }
  }

  // Shift each source pixel downward.
  for (let py = 0; py < h; py++) {
    for (let px = 0; px < w; px++) {
      const si = (py * w + px) * 4;
      if (src[si + 3] === 0) continue;
      const dy = py + shift[px];
      if (dy >= h) continue;
      const di = (dy * w + px) * 4;
      dst[di    ] = src[si    ];
      dst[di + 1] = src[si + 1];
      dst[di + 2] = src[si + 2];
      dst[di + 3] = src[si + 3];
    }
  }

  // Drip trails — fill vacated rows above each column's shifted top
  // with the topmost-source-pixel color, fading toward original position.
  if (trail) {
    const trailMul = trailAlpha;
    for (let px = 0; px < w; px++) {
      if (tops[px] < 0 || shift[px] === 0) continue;
      const topSrcY = tops[px];
      const topDstY = topSrcY + shift[px];
      const ti = (topSrcY * w + px) * 4;
      const r = src[ti], g = src[ti + 1], b = src[ti + 2];
      for (let py = topSrcY; py < topDstY && py < h; py++) {
        const di = (py * w + px) * 4;
        if (dst[di + 3] !== 0) continue;   // shifted pixel already there
        // Alpha = trailMul, fading slightly upward (peak near shifted top).
        const tFade = (py - topSrcY) / Math.max(1, shift[px]);   // 0 top → 1 just above shifted
        dst[di    ] = r;
        dst[di + 1] = g;
        dst[di + 2] = b;
        dst[di + 3] = Math.round(255 * trailMul * (0.35 + 0.65 * tFade));
      }
    }
  }

  s.ctx.clearRect(0, 0, w, h);
  s.ctx.putImageData(out, 0, 0);
  ctx.imageSmoothingEnabled = false;
  ctx.drawImage(s.canvas, x, y);
  _release(s);
}

// ─────────────────────────────────────────────────────────────────────
// pxBurn — char from the edges inward with a glowing rim.
// ─────────────────────────────────────────────────────────────────────
// Computes each opaque pixel's Manhattan distance to the nearest
// transparent neighbor (BFS from the silhouette boundary inward).
// Then for `threshold = progress * maxDist`:
//   • d ≤ threshold − charWidth  → gone (transparent)
//   • d ≤ threshold              → char color (dark band, recently burned)
//   • d ≤ threshold + emberWidth → ember color (glowing burn frontier)
//   • d  > threshold + emberWidth → original
//
// The result is a sprite that erodes from its silhouette inward with a
// glowing edge advancing through it. Fundamentally different from
// `pxDissolve` (uniform random per-pixel) — burn is structured and
// directional.
//
//   opts:
//     progress    — 0..1 (caller-driven)
//     auto        — { startedAt, ms }
//     charColor   — '#rrggbb' band color just inside the burn front
//                   (default '#1a1208' — dark char)
//     emberColor  — '#rrggbb' glowing burn front (default '#ff8030')
//     charWidth   — px width of the char band (default 1)
//     emberWidth  — px width of the ember band (default 2)
//     extend      — extra burn-distance units beyond the silhouette's
//                   actual max distance so progress=1 fully consumes
//                   even pixels deep inside large shapes (default 2)
export function pxBurn(ctx, x, y, w, h, drawFn, opts = {}) {
  let progress;
  if (opts.auto && typeof opts.auto === 'object') {
    const elapsed = performance.now() - opts.auto.startedAt;
    progress = Math.max(0, Math.min(1, elapsed / Math.max(1, opts.auto.ms)));
  } else {
    progress = Math.max(0, Math.min(1, opts.progress != null ? opts.progress : 0));
  }
  if (progress <= 0) { drawFn(ctx, x, y); return; }

  const charColor  = opts.charColor  || '#1a1208';
  const emberColor = opts.emberColor || '#ff8030';
  const charWidth  = opts.charWidth  != null ? opts.charWidth  : 1;
  const emberWidth = opts.emberWidth != null ? opts.emberWidth : 2;
  const extend     = opts.extend     != null ? opts.extend     : 2;

  // Parse colors once.
  const cChar  = _parseHex(charColor);
  const cEmber = _parseHex(emberColor);

  const s = _scratch(w, h);
  drawFn(s.ctx, 0, 0);
  const srcData = s.ctx.getImageData(0, 0, w, h);
  const src = srcData.data;

  // BFS edge-distance per opaque pixel — distance to nearest transparent
  // neighbor (or out-of-bounds). Stored as Manhattan-distance in cells.
  // Single Int32Array for fast access; Infinity sentinel via large int.
  const dist = new Int32Array(w * h);
  const INF = 0x7fffffff;
  const queue = [];
  for (let i = 0; i < w * h; i++) {
    if (src[i * 4 + 3] === 0) {
      dist[i] = 0;
      queue.push(i);
    } else {
      dist[i] = INF;
    }
  }
  // Treat out-of-bounds as transparent — pixels at the bbox edge get
  // distance 1 even if their off-bbox neighbor doesn't exist.
  for (let py = 0; py < h; py++) {
    const left = py * w, right = py * w + w - 1;
    if (dist[left]  > 1) { dist[left]  = 1; queue.push(left); }
    if (dist[right] > 1) { dist[right] = 1; queue.push(right); }
  }
  for (let px = 0; px < w; px++) {
    const top = px, bot = (h - 1) * w + px;
    if (dist[top] > 1) { dist[top] = 1; queue.push(top); }
    if (dist[bot] > 1) { dist[bot] = 1; queue.push(bot); }
  }

  // BFS propagation. queue.shift() is O(n) but the queue stays small
  // for typical sprite sizes (32×32 → ~1000 pixels max in queue).
  let head = 0;
  while (head < queue.length) {
    const i = queue[head++];
    const py = (i / w) | 0;
    const px = i - py * w;
    const d = dist[i];
    if (px + 1 < w) {
      const ni = i + 1;
      if (dist[ni] > d + 1) { dist[ni] = d + 1; queue.push(ni); }
    }
    if (px > 0) {
      const ni = i - 1;
      if (dist[ni] > d + 1) { dist[ni] = d + 1; queue.push(ni); }
    }
    if (py + 1 < h) {
      const ni = i + w;
      if (dist[ni] > d + 1) { dist[ni] = d + 1; queue.push(ni); }
    }
    if (py > 0) {
      const ni = i - w;
      if (dist[ni] > d + 1) { dist[ni] = d + 1; queue.push(ni); }
    }
  }

  // Find max distance (still INF for unreachable opaque pixels — those
  // never get burned, but in well-formed sprites everything is reachable).
  let maxD = 0;
  for (let i = 0; i < w * h; i++) {
    if (dist[i] !== INF && dist[i] > maxD) maxD = dist[i];
  }
  // Threshold sweeps from 0 to (maxD + extend) — extending past actual
  // max guarantees progress=1 consumes the whole shape.
  const threshold = progress * (maxD + extend);

  const out = new ImageData(w, h);
  const dst = out.data;
  for (let i = 0; i < w * h; i++) {
    const si = i * 4;
    const a = src[si + 3];
    if (a === 0) continue;
    const d = dist[i];
    if (d === INF) {
      // Unreachable — leave original.
      dst[si]     = src[si];
      dst[si + 1] = src[si + 1];
      dst[si + 2] = src[si + 2];
      dst[si + 3] = a;
      continue;
    }
    if (d <= threshold - charWidth) {
      // Gone.
      continue;
    }
    if (d <= threshold) {
      // Char band.
      dst[si]     = cChar[0];
      dst[si + 1] = cChar[1];
      dst[si + 2] = cChar[2];
      dst[si + 3] = a;
      continue;
    }
    if (d <= threshold + emberWidth) {
      // Ember band.
      dst[si]     = cEmber[0];
      dst[si + 1] = cEmber[1];
      dst[si + 2] = cEmber[2];
      dst[si + 3] = a;
      continue;
    }
    // Untouched.
    dst[si]     = src[si];
    dst[si + 1] = src[si + 1];
    dst[si + 2] = src[si + 2];
    dst[si + 3] = a;
  }
  s.ctx.clearRect(0, 0, w, h);
  s.ctx.putImageData(out, 0, 0);
  ctx.imageSmoothingEnabled = false;
  ctx.drawImage(s.canvas, x, y);
  _release(s);
}

function _parseHex(hex) {
  const m = /^#([0-9a-f]{6})$/i.exec(hex);
  if (!m) return [255, 255, 255];
  const n = parseInt(m[1], 16);
  return [(n >> 16) & 0xff, (n >> 8) & 0xff, n & 0xff];
}

// ─────────────────────────────────────────────────────────────────────
// pxHologram — sci-fi projected character (scanlines + chroma + flicker).
// ─────────────────────────────────────────────────────────────────────
// Composition primitive: applies a tint, additive chromatic R/B offset,
// horizontal scanlines that scroll vertically, and a translucent flicker.
// Shipping as one primitive (vs callers composing the parts) so the
// timing is internally coherent — chroma offset and scanline scroll
// share `t`, flicker dropouts are tied to the same time base.
//
//   opts:
//     tint        — base color the silhouette is recolored to via
//                   source-atop (default '#80c8ff' — sci-fi cyan)
//     baseAlpha   — minimum translucency (default 0.7)
//     chroma      — RGB-offset distance in px (default 1). 0 disables.
//     lineFreq    — scanline spacing in px (default 3 — every 3rd row dark)
//     scrollFreq  — scanline scroll rate in screens/sec (default 0.6)
//     flickerFreq — alpha flicker frequency in Hz (default 8)
//     dropouts    — bool, occasional brief alpha drops (default true)
export function pxHologram(ctx, x, y, w, h, drawFn, t, opts = {}) {
  const tint        = opts.tint        || '#80c8ff';
  const baseAlpha   = opts.baseAlpha   != null ? opts.baseAlpha   : 0.7;
  const chroma      = opts.chroma      != null ? opts.chroma      : 1;
  const lineFreq    = Math.max(1, opts.lineFreq != null ? opts.lineFreq : 3);
  const scrollFreq  = opts.scrollFreq  != null ? opts.scrollFreq  : 0.6;
  const flickerFreq = opts.flickerFreq != null ? opts.flickerFreq : 8;
  const dropouts    = opts.dropouts    !== false;

  // Render tinted silhouette to scratch (single source for the chroma
  // and base passes — drawing drawFn three times would be wasteful).
  const s = _scratch(w, h);
  drawFn(s.ctx, 0, 0);
  s.ctx.save();
  s.ctx.globalCompositeOperation = 'source-atop';
  s.ctx.fillStyle = tint;
  s.ctx.fillRect(0, 0, w, h);
  s.ctx.restore();

  // Compute flicker.
  let alpha = baseAlpha;
  if (flickerFreq > 0) {
    const f = 0.85 + 0.15 * Math.sin(t * flickerFreq * Math.PI * 2);
    alpha *= f;
  }
  if (dropouts) {
    // Occasional ~50ms dropouts at irregular intervals.
    const dropPhase = Math.sin(t * 1.37 * Math.PI * 2) + Math.sin(t * 3.11 * Math.PI * 2);
    if (dropPhase > 1.85) alpha *= 0.25;
  }

  ctx.save();
  ctx.imageSmoothingEnabled = false;

  // Chromatic R/B split — two ghost copies at low alpha, offset
  // horizontally. Use 'lighter' so the overlap creates the tint
  // brightening rather than overwriting.
  if (chroma > 0) {
    ctx.globalCompositeOperation = 'lighter';
    ctx.globalAlpha = alpha * 0.45;
    ctx.drawImage(s.canvas, x - chroma, y);
    ctx.drawImage(s.canvas, x + chroma, y);
    ctx.globalCompositeOperation = 'source-over';
  }

  // Base tinted pass at the computed flicker alpha.
  ctx.globalAlpha = alpha;
  ctx.drawImage(s.canvas, x, y);

  // Scanlines — horizontal dark stripes scrolling vertically. Wraps
  // mod lineFreq so the band density is constant.
  const scrollPx = Math.floor(t * scrollFreq * h * lineFreq);
  const offset = ((scrollPx % lineFreq) + lineFreq) % lineFreq;
  ctx.globalAlpha = alpha * 0.45;
  ctx.fillStyle = '#000000';
  for (let py = offset; py < h; py += lineFreq) {
    ctx.fillRect(x, y + py, w, 1);
  }
  ctx.restore();
  _release(s);
}

// ─────────────────────────────────────────────────────────────────────
// pxShatter — break into N pieces with rotation + gravity.
// ─────────────────────────────────────────────────────────────────────
// Generates `pieces` random seed points in the sprite bbox, assigns
// each opaque pixel to its nearest seed (Voronoi-style), bakes each
// piece into its own canvas, then per-frame draws each piece with a
// transform: outward translation from the sprite center + per-piece
// rotation + optional gravity.
//
// The piece GEOMETRY is fully determined by (seed, pieces, w, h), so
// `cacheKey` caches it across frames — without it, each frame rebuilds
// all pieces (slow). Strongly recommended for any persistent shatter.
//
//   opts:
//     progress  — 0..1 (caller-driven)
//     auto      — { startedAt, ms }
//     pieces    — number of fragments (default 8)
//     seed      — deterministic piece shapes (default 1)
//     speed     — px the average piece travels by progress=1
//                 (default = w * 0.6)
//     gravity   — px downward acceleration applied as `gravity * t²`
//                 (default 0 — no gravity). Positive values drop pieces.
//     rotation  — max per-piece rotation at progress=1 in radians
//                 (default π/2). Each piece's rotation direction is
//                 PRNG-signed so neighbors spin opposite ways.
//     fade      — bool, pieces fade as they fly apart (default true)
//     cacheKey  — bake piece geometry once + reuse (recommended)
export function pxShatter(ctx, x, y, w, h, drawFn, opts = {}) {
  let progress;
  if (opts.auto && typeof opts.auto === 'object') {
    const elapsed = performance.now() - opts.auto.startedAt;
    progress = Math.max(0, Math.min(1, elapsed / Math.max(1, opts.auto.ms)));
  } else {
    progress = Math.max(0, Math.min(1, opts.progress != null ? opts.progress : 0));
  }
  if (progress <= 0) { drawFn(ctx, x, y); return; }

  const pieces   = Math.max(2, opts.pieces   != null ? opts.pieces   : 8);
  const seed     = opts.seed     || 1;
  const speed    = opts.speed    != null ? opts.speed    : w * 0.6;
  const gravity  = opts.gravity  || 0;
  const rotation = opts.rotation != null ? opts.rotation : Math.PI / 2;
  const fade     = opts.fade     !== false;
  const cacheKey = opts.cacheKey;

  // Piece geometry — cache when requested. Key folds in (pieces, w, h)
  // so swapping any of those forces a rebake.
  const geomKey = cacheKey
    ? _composeKey(cacheKey, seed, 0, 'shatter:' + pieces + ':' + w + 'x' + h)
    : null;
  let geom = geomKey ? _staticCache.get(geomKey) : null;

  if (!geom) {
    geom = _buildShatterPieces(w, h, drawFn, pieces, seed);
    if (geomKey) _staticCache.set(geomKey, geom);
  }

  // Render each piece at its current transform.
  ctx.save();
  ctx.imageSmoothingEnabled = false;
  const cx = w / 2, cy = h / 2;
  const tSpeed = progress * speed;
  const tGrav  = gravity * progress * progress;
  const baseAlpha = fade ? Math.max(0, 1 - progress * 0.7) : 1;

  for (let p = 0; p < geom.count; p++) {
    if (geom.areas[p] === 0) continue;
    const pcx = geom.cx[p];
    const pcy = geom.cy[p];
    const dx = pcx - cx;
    const dy = pcy - cy;
    const dist = Math.hypot(dx, dy) || 1;
    const vx = dx / dist;
    const vy = dy / dist;
    const dstX = pcx + vx * tSpeed;
    const dstY = pcy + vy * tSpeed + tGrav;
    const rot  = geom.rotDir[p] * rotation * progress;

    ctx.save();
    ctx.translate(x + dstX, y + dstY);
    ctx.rotate(rot);
    ctx.translate(-pcx, -pcy);
    ctx.globalAlpha = baseAlpha;
    ctx.drawImage(geom.canvases[p], 0, 0);
    ctx.restore();
  }
  ctx.restore();
}

function _buildShatterPieces(w, h, drawFn, pieces, seed) {
  const rnd = _prng(seed);

  // Seed points in the sprite bbox (with a small inset so seeds aren't
  // exactly on the edge — keeps Voronoi pieces from being slivers).
  const sxs = new Float32Array(pieces);
  const sys = new Float32Array(pieces);
  for (let p = 0; p < pieces; p++) {
    sxs[p] = 2 + rnd() * (w - 4);
    sys[p] = 2 + rnd() * (h - 4);
  }

  // Render source + read imageData.
  const tmp = document.createElement('canvas');
  tmp.width = w; tmp.height = h;
  const tctx = tmp.getContext('2d');
  tctx.imageSmoothingEnabled = false;
  drawFn(tctx, 0, 0);
  const srcData = tctx.getImageData(0, 0, w, h);
  const src = srcData.data;

  // Per-piece accumulators.
  const pixels   = new Array(pieces);   // Array<ImageData>
  const cx       = new Float32Array(pieces);
  const cy       = new Float32Array(pieces);
  const areas    = new Int32Array(pieces);
  const rotDir   = new Float32Array(pieces);
  for (let p = 0; p < pieces; p++) {
    pixels[p] = new ImageData(w, h);
    rotDir[p] = rnd() * 2 - 1;          // -1..+1 spin direction × magnitude
  }

  // Voronoi assignment: each opaque pixel → nearest seed.
  for (let py = 0; py < h; py++) {
    for (let px = 0; px < w; px++) {
      const si = (py * w + px) * 4;
      if (src[si + 3] === 0) continue;
      let bestP = 0, bestD = Infinity;
      for (let p = 0; p < pieces; p++) {
        const ddx = px - sxs[p], ddy = py - sys[p];
        const d = ddx * ddx + ddy * ddy;
        if (d < bestD) { bestD = d; bestP = p; }
      }
      const arr = pixels[bestP].data;
      arr[si    ] = src[si    ];
      arr[si + 1] = src[si + 1];
      arr[si + 2] = src[si + 2];
      arr[si + 3] = src[si + 3];
      cx[bestP] += px;
      cy[bestP] += py;
      areas[bestP]++;
    }
  }

  // Finalize centroids + bake per-piece canvases.
  const canvases = new Array(pieces);
  for (let p = 0; p < pieces; p++) {
    if (areas[p] === 0) { canvases[p] = null; continue; }
    cx[p] /= areas[p];
    cy[p] /= areas[p];
    const pc = document.createElement('canvas');
    pc.width = w; pc.height = h;
    pc.getContext('2d').putImageData(pixels[p], 0, 0);
    canvases[p] = pc;
  }

  return { count: pieces, canvases, cx, cy, areas, rotDir };
}

// ─────────────────────────────────────────────────────────────────────
// pxScrape — pixels stream off the silhouette in a direction.
// ─────────────────────────────────────────────────────────────────────
// Each opaque pixel has a "stream start" threshold based on its position
// along the scrape direction from `(impactX, impactY)`. Pixels closer
// to the impact (small along-axis distance) stream off first; pixels
// further back wait until progress catches up. Once started, each pixel
// travels along the scrape direction with optional perpendicular jitter
// (`spread`), fading as it goes.
//
// Reads as: impact lands at `(impactX, impactY)`, debris sprays outward
// in `angle` direction. Use for sword-scrape damage, surface erosion
// from a hit, ammo casings flying out, anything where pixels are
// physically REMOVED from the silhouette in a direction.
//
//   opts:
//     progress  — 0..1 (caller-driven)
//     auto      — { startedAt, ms }
//     angle     — scrape direction in radians (default 0 = right)
//     impactX/Y — origin of scrape, local to (x, y). Default (0, h/2).
//                 Pixels closest along the scrape axis stream first.
//     speed     — px the most-advanced pixel travels at progress=1
//                 (default = w * 1.5)
//     spread    — perpendicular jitter as fraction of travel distance
//                 (default 0.3 — moderate fan-out)
//     seed      — deterministic jitter pattern (default 1)
export function pxScrape(ctx, x, y, w, h, drawFn, opts = {}) {
  let progress;
  if (opts.auto && typeof opts.auto === 'object') {
    const elapsed = performance.now() - opts.auto.startedAt;
    progress = Math.max(0, Math.min(1, elapsed / Math.max(1, opts.auto.ms)));
  } else {
    progress = Math.max(0, Math.min(1, opts.progress != null ? opts.progress : 0));
  }
  if (progress <= 0) { drawFn(ctx, x, y); return; }

  const angle    = opts.angle    != null ? opts.angle    : 0;
  const impactX  = opts.impactX  != null ? opts.impactX  : 0;
  const impactY  = opts.impactY  != null ? opts.impactY  : h / 2;
  const speed    = opts.speed    != null ? opts.speed    : w * 1.5;
  const spread   = opts.spread   != null ? opts.spread   : 0.3;
  const seed     = opts.seed     || 1;

  const ax = Math.cos(angle);
  const ay = Math.sin(angle);
  const perpX = -ay, perpY = ax;

  const s = _scratch(w, h);
  drawFn(s.ctx, 0, 0);
  const srcData = s.ctx.getImageData(0, 0, w, h);
  const src = srcData.data;
  const out = new ImageData(w, h);
  const dst = out.data;

  const rnd = _prng(seed);
  // Pre-compute per-pixel perpendicular jitter so the same pixel always
  // sprays the same direction across frames (otherwise it would jitter
  // around frame-to-frame).
  const jitter = new Float32Array(w * h);
  for (let i = 0; i < w * h; i++) jitter[i] = (rnd() * 2 - 1) * spread;

  const maxAxisDist = Math.max(1, w);
  const fadeRange = w * 0.7;

  for (let py = 0; py < h; py++) {
    for (let px = 0; px < w; px++) {
      const si = (py * w + px) * 4;
      if (src[si + 3] === 0) continue;

      // Distance from impact along scrape axis (signed; closer = smaller).
      const axisDist = (px - impactX) * ax + (py - impactY) * ay;
      // Start-progress = 0 at impact, ramps to 1 at far end.
      const startProg = Math.max(0, axisDist) / maxAxisDist;
      const streamAmt = Math.max(0, progress - startProg) * speed;

      let dpx, dpy, dAlpha;
      if (streamAmt === 0) {
        // Hasn't started streaming yet — render in place at full alpha.
        dpx = px; dpy = py; dAlpha = src[si + 3];
      } else {
        // Travel along scrape axis + perpendicular jitter scaled by travel.
        const j = jitter[py * w + px] * streamAmt;
        dpx = Math.round(px + ax * streamAmt + perpX * j);
        dpy = Math.round(py + ay * streamAmt + perpY * j);
        if (dpx < 0 || dpx >= w || dpy < 0 || dpy >= h) continue;
        const fade = Math.max(0, 1 - streamAmt / fadeRange);
        dAlpha = (src[si + 3] * fade) | 0;
      }
      if (dAlpha === 0) continue;

      const di = (dpy * w + dpx) * 4;
      dst[di    ] = src[si    ];
      dst[di + 1] = src[si + 1];
      dst[di + 2] = src[si + 2];
      dst[di + 3] = dAlpha;
    }
  }

  s.ctx.clearRect(0, 0, w, h);
  s.ctx.putImageData(out, 0, 0);
  ctx.imageSmoothingEnabled = false;
  ctx.drawImage(s.canvas, x, y);
  _release(s);
}

// ─────────────────────────────────────────────────────────────────────
// pxRoot — silhouette grows from a base point outward.
// ─────────────────────────────────────────────────────────────────────
// Opaque pixels appear if their distance from `(originX, originY)` is
// ≤ `progress * maxDist`. As progress rises 0 → 1, the silhouette
// reveals from the origin outward — radially, vertically, or
// horizontally depending on `reveal`. An optional `edgeColor` tints
// pixels within `edgeWidth` of the current threshold, giving a glowing
// growth front.
//
// Use for: vine/root spreading, teleport-in materialize, plant
// growing from a seed, healing surge across a sprite.
//
//   opts:
//     progress   — 0..1 (caller-driven)
//     auto       — { startedAt, ms }
//     originX/Y  — growth origin, local to (x, y). Default (w/2, h)
//                  (bottom-center — right for "growing from the ground").
//     reveal     — 'dist' (radial, default) | 'y' (vertical band) |
//                  'x' (horizontal band)
//     edgeColor  — '#rrggbb' growth-frontier tint (default null = no edge)
//     edgeWidth  — px width of the growth front band (default 2)
export function pxRoot(ctx, x, y, w, h, drawFn, opts = {}) {
  let progress;
  if (opts.auto && typeof opts.auto === 'object') {
    const elapsed = performance.now() - opts.auto.startedAt;
    progress = Math.max(0, Math.min(1, elapsed / Math.max(1, opts.auto.ms)));
  } else {
    progress = Math.max(0, Math.min(1, opts.progress != null ? opts.progress : 0));
  }
  if (progress >= 1) { drawFn(ctx, x, y); return; }
  if (progress <= 0) return;          // not yet revealed

  const originX  = opts.originX  != null ? opts.originX  : w / 2;
  const originY  = opts.originY  != null ? opts.originY  : h;
  const reveal   = opts.reveal   || 'dist';
  const edgeColor = opts.edgeColor || null;
  const edgeWidth = opts.edgeWidth != null ? opts.edgeWidth : 2;

  // Compute max distance based on reveal mode + origin position.
  let maxDist;
  if (reveal === 'y') {
    maxDist = Math.max(originY, h - originY);
  } else if (reveal === 'x') {
    maxDist = Math.max(originX, w - originX);
  } else {
    const cornerX = Math.max(originX, w - originX);
    const cornerY = Math.max(originY, h - originY);
    maxDist = Math.sqrt(cornerX * cornerX + cornerY * cornerY);
  }
  const threshold = progress * maxDist;

  const cEdge = edgeColor ? _parseHex(edgeColor) : null;

  const s = _scratch(w, h);
  drawFn(s.ctx, 0, 0);
  const srcData = s.ctx.getImageData(0, 0, w, h);
  const src = srcData.data;
  const out = new ImageData(w, h);
  const dst = out.data;

  for (let py = 0; py < h; py++) {
    for (let px = 0; px < w; px++) {
      const si = (py * w + px) * 4;
      if (src[si + 3] === 0) continue;

      let d;
      if (reveal === 'y') d = Math.abs(py - originY);
      else if (reveal === 'x') d = Math.abs(px - originX);
      else { const ddx = px - originX, ddy = py - originY; d = Math.sqrt(ddx * ddx + ddy * ddy); }

      if (d > threshold) continue;       // not revealed yet

      if (cEdge && d > threshold - edgeWidth) {
        // Growth-front edge tint.
        dst[si    ] = cEdge[0];
        dst[si + 1] = cEdge[1];
        dst[si + 2] = cEdge[2];
        dst[si + 3] = src[si + 3];
      } else {
        // Fully revealed — original pixel.
        dst[si    ] = src[si    ];
        dst[si + 1] = src[si + 1];
        dst[si + 2] = src[si + 2];
        dst[si + 3] = src[si + 3];
      }
    }
  }
  s.ctx.clearRect(0, 0, w, h);
  s.ctx.putImageData(out, 0, 0);
  ctx.imageSmoothingEnabled = false;
  ctx.drawImage(s.canvas, x, y);
  _release(s);
}

// ─────────────────────────────────────────────────────────────────────
// pxAssemble — inverse of pxShatter, pieces fly IN and assemble.
// ─────────────────────────────────────────────────────────────────────
// Time-reversed view of pxShatter. At `progress=0` the pieces are at
// max distance (scattered + rotated); at `progress=1` they're locked
// into the original silhouette. Same piece geometry as pxShatter —
// shares the cache if both are given the same `cacheKey`.
//
// Use for: teleport-in, spawn FX, "summoning the artifact" reveals.
//
// All opts forward straight to pxShatter (pieces, seed, speed,
// gravity, rotation, fade, endAlpha, cacheKey, progress/auto). The
// progress is internally inverted before forwarding.
export function pxAssemble(ctx, x, y, w, h, drawFn, opts = {}) {
  let progress;
  if (opts.auto && typeof opts.auto === 'object') {
    const elapsed = performance.now() - opts.auto.startedAt;
    progress = Math.max(0, Math.min(1, elapsed / Math.max(1, opts.auto.ms)));
  } else {
    progress = Math.max(0, Math.min(1, opts.progress != null ? opts.progress : 0));
  }
  // Forward to pxShatter with inverted progress — and importantly DROP
  // the `auto` opt (pxShatter would re-compute progress from it).
  const fwd = Object.assign({}, opts);
  delete fwd.auto;
  delete fwd.progress;
  fwd.progress = 1 - progress;
  pxShatter(ctx, x, y, w, h, drawFn, fwd);
}

// ─────────────────────────────────────────────────────────────────────
// pxCharge — particles spiral inward toward a focus point.
// ─────────────────────────────────────────────────────────────────────
// Overlay primitive (doesn't manipulate the drawer's pixels — draws
// the drawer normally then paints particles ON TOP). Each particle has
// a per-instance phase offset that spreads them around the cycle, so
// you see them at every stage of the spiral simultaneously: some at
// the outer ring just starting, some mid-spiral, some at the center
// peaking.
//
// Reads as: charging up a special move, building energy, channeling.
// Pair with `pxBlink` or `pxHologram` on the entity itself for full
// "powering up" composite.
//
//   opts:
//     focusX/Y     — convergence point, local to (x, y). Default (w/2, h/2)
//     radius       — outer ring radius px (default w * 0.8)
//     particles    — particle count (default 8)
//     speed        — full-cycle rate in Hz (default 1.5)
//     color        — '#rrggbb' (default '#80c8ff')
//     trailLen     — fading trail dots behind each particle (default 4)
//     intensity    — global alpha multiplier 0..1 (default 1)
//     focusPulse   — bool, draw a pulsing bright cross at the focus
//                    (default true — sells the "charging up" climax)
export function pxCharge(ctx, x, y, w, h, drawFn, t, opts = {}) {
  const focusX     = opts.focusX     != null ? opts.focusX     : w / 2;
  const focusY     = opts.focusY     != null ? opts.focusY     : h / 2;
  const radius     = opts.radius     != null ? opts.radius     : w * 0.8;
  const particles  = opts.particles  != null ? opts.particles  : 8;
  const speed      = opts.speed      != null ? opts.speed      : 1.5;
  const color      = opts.color      || '#80c8ff';
  const trailLen   = opts.trailLen   != null ? opts.trailLen   : 4;
  const intensity  = opts.intensity  != null ? opts.intensity  : 1;
  const focusPulse = opts.focusPulse !== false;

  // Draw entity first — particles overlay on top.
  drawFn(ctx, x, y);

  ctx.save();
  ctx.imageSmoothingEnabled = false;
  ctx.fillStyle = color;

  const baseT = t * speed;
  for (let i = 0; i < particles; i++) {
    const phaseOffset = i / particles;            // 0..1, even spread

    // Each particle's cycle position — wraps mod 1. As cycle goes 0→1,
    // particle moves from outer ring to focus.
    const cycle = (baseT + phaseOffset) % 1;
    const r = radius * (1 - cycle);
    // Spiral: angle accumulates over the cycle.
    const ang = phaseOffset * Math.PI * 2 + cycle * Math.PI * 2;
    const pxPos = focusX + Math.cos(ang) * r;
    const pyPos = focusY + Math.sin(ang) * r;
    const dpx = x + Math.round(pxPos);
    const dpy = y + Math.round(pyPos);

    // Particle brightness ramps as it approaches focus.
    ctx.globalAlpha = intensity * (0.4 + 0.6 * cycle);
    ctx.fillRect(dpx, dpy, 1, 1);

    // Trailing fading dots behind it.
    for (let k = 1; k <= trailLen; k++) {
      const tc = cycle - k * 0.04;
      if (tc < 0) continue;
      const tr = radius * (1 - tc);
      const tang = phaseOffset * Math.PI * 2 + tc * Math.PI * 2;
      const tx = x + Math.round(focusX + Math.cos(tang) * tr);
      const ty = y + Math.round(focusY + Math.sin(tang) * tr);
      ctx.globalAlpha = intensity * (1 - k / trailLen) * 0.4;
      ctx.fillRect(tx, ty, 1, 1);
    }
  }

  if (focusPulse) {
    // Bright cross at the focus point, pulsing on the cycle.
    const pulseA = 0.5 + 0.5 * Math.sin(t * speed * Math.PI * 2);
    ctx.globalAlpha = intensity * pulseA;
    const fx = x + focusX, fy = y + focusY;
    ctx.fillRect(fx - 1, fy, 3, 1);
    ctx.fillRect(fx, fy - 1, 1, 3);
    ctx.fillStyle = '#ffffff';
    ctx.globalAlpha = intensity * pulseA * 0.9;
    ctx.fillRect(fx, fy, 1, 1);
  }
  ctx.restore();
}

// ─────────────────────────────────────────────────────────────────────
// Cache management
// ─────────────────────────────────────────────────────────────────────
export function invalidateFx(cacheKey) {
  if (cacheKey == null) return;
  const prefix = cacheKey + '|';
  for (const k of _staticCache.keys()) if (k.startsWith(prefix)) _staticCache.delete(k);
  for (const k of _stripCache.keys())  if (k.startsWith(prefix)) _stripCache.delete(k);
}
export function clearFxCaches() {
  _staticCache.clear();
  _stripCache.clear();
}

// ─────────────────────────────────────────────────────────────────────
// createFxRegistry — runtime apply/clear lifecycle.
// ─────────────────────────────────────────────────────────────────────
// Holds a list of in-flight effects with world positions and
// auto-expire lifetimes. Used for the "trigger an effect on a tile
// and let it fade" pattern — hulk lands on a tile → add a cracks
// effect at that tile's bounds, expire 5s later.
//
// Each entry shape:
//   {
//     id,                          // returned from add()
//     kind: 'cracks' | 'wiggle' | 'shake' | 'glitch',
//     x, y, w, h,                  // world bounds
//     drawFn,                      // required for wiggle/shake/glitch
//     opts,                        // forwarded to the primitive
//     createdAt,                   // ms
//     duration,                    // optional auto-expire ms
//     fadeOut,                     // optional, ms before expire when
//                                  //   alpha ramps 1→0
//   }
//
// Methods:
//   add(entry) → id              insert; duration is optional
//   remove(id)                   drop by id
//   clear()                      drop everything
//   clearWhere(predicate)        drop entries matching predicate(e)
//   list() → array               current entries (read-only)
//   has(id) → bool
//   draw(ctx, t)                 render all (call once per frame after
//                                base layer is drawn). Optionally pass
//                                `{ cull: (e) => bool }` to skip
//                                offscreen entries.
const RENDERERS = {
  wiggle:      (ctx, e, t) => e.drawFn && pxWiggle     (ctx, e.x, e.y, e.w, e.h, e.drawFn, t, e.opts || {}),
  shake:       (ctx, e, t) => e.drawFn && pxShake      (ctx, e.x, e.y, e.w, e.h, e.drawFn, t, e.opts || {}),
  glitch:      (ctx, e, t) => e.drawFn && pxGlitch     (ctx, e.x, e.y, e.w, e.h, e.drawFn, t, e.opts || {}),
  stretch:     (ctx, e, t) => e.drawFn && pxStretch    (ctx, e.x, e.y, e.w, e.h, e.drawFn,    e.opts || {}),
  squish:      (ctx, e, t) => e.drawFn && pxSquish     (ctx, e.x, e.y, e.w, e.h, e.drawFn,    e.opts || {}),
  jelly:       (ctx, e, t) => e.drawFn && pxJelly      (ctx, e.x, e.y, e.w, e.h, e.drawFn, t, e.opts || {}),
  ripple:      (ctx, e, t) => e.drawFn && pxRipple     (ctx, e.x, e.y, e.w, e.h, e.drawFn, t, e.opts || {}),
  dissolve:    (ctx, e, t) => e.drawFn && pxDissolve   (ctx, e.x, e.y, e.w, e.h, e.drawFn,    e.opts || {}),
  blink:       (ctx, e, t) => e.drawFn && pxBlink      (ctx, e.x, e.y, e.w, e.h, e.drawFn, t, e.opts || {}),
  afterimage:  (ctx, e, t) => e.drawFn && pxAfterimage (ctx, e.x, e.y, e.w, e.h, e.drawFn, t, e.opts || {}),
  scanline:    (ctx, e, t) => e.drawFn && pxScanline   (ctx, e.x, e.y, e.w, e.h, e.drawFn, t, e.opts || {}),
  slice:       (ctx, e, t) => e.drawFn && pxSlice      (ctx, e.x, e.y, e.w, e.h, e.drawFn,    e.opts || {}),
  shatter:     (ctx, e, t) => e.drawFn && pxShatter    (ctx, e.x, e.y, e.w, e.h, e.drawFn,    e.opts || {}),
  burn:        (ctx, e, t) => e.drawFn && pxBurn       (ctx, e.x, e.y, e.w, e.h, e.drawFn,    e.opts || {}),
  melt:        (ctx, e, t) => e.drawFn && pxMelt       (ctx, e.x, e.y, e.w, e.h, e.drawFn,    e.opts || {}),
  pixelate:    (ctx, e, t) => e.drawFn && pxPixelate   (ctx, e.x, e.y, e.w, e.h, e.drawFn,    e.opts || {}),
  hologram:    (ctx, e, t) => e.drawFn && pxHologram   (ctx, e.x, e.y, e.w, e.h, e.drawFn, t, e.opts || {}),
  scrape:      (ctx, e, t) => e.drawFn && pxScrape     (ctx, e.x, e.y, e.w, e.h, e.drawFn,    e.opts || {}),
  root:        (ctx, e, t) => e.drawFn && pxRoot       (ctx, e.x, e.y, e.w, e.h, e.drawFn,    e.opts || {}),
  assemble:    (ctx, e, t) => e.drawFn && pxAssemble   (ctx, e.x, e.y, e.w, e.h, e.drawFn,    e.opts || {}),
  charge:      (ctx, e, t) => e.drawFn && pxCharge     (ctx, e.x, e.y, e.w, e.h, e.drawFn, t, e.opts || {}),
  cracks:      (ctx, e, t) => pxCracks                 (ctx, e.x, e.y, e.w, e.h, e.opts || {}),
  electricity: (ctx, e, t) => pxElectricity            (ctx, e.x, e.y, e.w, e.h, t, e.opts || {}),
};

export function createFxRegistry() {
  const entries = [];
  let nextId = 1;

  const add = (entry) => {
    if (!RENDERERS[entry.kind]) throw new Error('Unknown fx kind: ' + entry.kind);
    const e = { ...entry, id: nextId++, createdAt: performance.now() };
    entries.push(e);
    return e.id;
  };

  const remove = (id) => {
    const i = entries.findIndex((e) => e.id === id);
    if (i >= 0) entries.splice(i, 1);
  };

  const clear = () => { entries.length = 0; };

  const clearWhere = (pred) => {
    for (let i = entries.length - 1; i >= 0; i--) if (pred(entries[i])) entries.splice(i, 1);
  };

  const has = (id) => entries.some((e) => e.id === id);
  const list = () => entries.slice();

  const draw = (ctx, t, drawOpts = {}) => {
    const now = performance.now();
    const cull = drawOpts.cull;
    // Iterate descending so we can splice out expired entries inline.
    for (let i = entries.length - 1; i >= 0; i--) {
      const e = entries[i];
      if (e.duration != null) {
        const elapsed = now - e.createdAt;
        if (elapsed >= e.duration) { entries.splice(i, 1); continue; }
        if (e.fadeOut != null && elapsed > e.duration - e.fadeOut) {
          const k = (e.duration - elapsed) / e.fadeOut;
          ctx.save();
          ctx.globalAlpha *= Math.max(0, k);
          if (!cull || !cull(e)) RENDERERS[e.kind](ctx, e, t);
          ctx.restore();
          continue;
        }
      }
      if (!cull || !cull(e)) RENDERERS[e.kind](ctx, e, t);
    }
  };

  return { add, remove, clear, clearWhere, has, list, draw };
}
