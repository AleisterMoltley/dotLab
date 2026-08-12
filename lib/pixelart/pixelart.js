// Pixel-art techniques distilled from the upgraded tools, EVA gear,
// guns, crates, and vine sprites. This module is the "vocabulary" the
// hand-coded drawers use — not a renderer that owns canvases. Every
// helper takes a `ctx` and stamps pixels at integer coords; you compose
// them inside any `bakeCanvas` drawFn.
//
// Why a vocabulary, not a renderer:
//   - The procgen2 PixelPainter is a coherent painting pipeline that
//     classifies pixels and re-colors via a palette. It's expensive
//     and atomic — you give it a silhouette, it gives you a finished
//     sprite. Great quality, heavy runtime cost.
//   - The hand-coded tool/gun/crate drawers use a different idiom:
//     small composable techniques (1-pixel highlight strip, bevel
//     frame, plank seams, glass-dot, etc.) layered onto a fillRect
//     base. Each technique is tens of microseconds. Aggregate cost
//     is a fraction of one painter call.
//   - This module is the second idiom, packaged as building blocks
//     for new sprites without rebuilding the painter cost model.
//
// ── BEST PRACTICE: bake static-shape parts, render animated parts live
// ───────────────────────────────────────────────────────────────────────
//
// Every primitive in this file is fast individually (tens of µs), but
// per-frame fillRect counts add up on integrated GPUs. A complex
// creature like the spider in ik-character.html runs ~400 fillRects per
// frame per instance — at 3 onscreen that's enough to hit the
// integrated-GPU rendering wall (~20fps at scale).
//
// THE PATTERN: split the drawer into static-shape parts (the abdomen,
// head, shell, body silhouette) and animated parts (eye color cycles,
// fang chomp, drool drips, aura strength, IK-driven appendages). Bake
// the static-shape parts ONCE via `makeBakedSprite` with `rows: N`
// matching the entity's rotation quantization (16 rows for TAU/16
// movement = 22.5° steps, etc). Render the animated parts on top
// each frame using the live state.
//
// Recipe:
//
//   const ENT_BAKE_SIZE = 40;
//   const ENT_BAKE_ROWS = 16;
//   const _entBodyBake = makeBakedSprite((ctx, _t, rowIdx) => {
//     const angle = (rowIdx / ENT_BAKE_ROWS) * Math.PI * 2;
//     const fx = Math.cos(angle), fy = Math.sin(angle);
//     const cx = ENT_BAKE_SIZE / 2, cy = ENT_BAKE_SIZE / 2;
//     // ... draw the static body parts at this rotation, centered ...
//     softBlob(ctx, cx - fx * 7, cy - fy * 7, 8, 6, palette);
//     // (eyes/fangs/animated bits NOT drawn here)
//   }, { size: ENT_BAKE_SIZE, frames: 1, rows: ENT_BAKE_ROWS, outline: null });
//
// Per-frame draw:
//
//   let rowIdx = Math.round(this.angle / (Math.PI * 2 / ENT_BAKE_ROWS));
//   rowIdx = ((rowIdx % ENT_BAKE_ROWS) + ENT_BAKE_ROWS) % ENT_BAKE_ROWS;
//   _entBodyBake(ctx, Math.round(x - SIZE/2), Math.round(y - SIZE/2), 0, rowIdx);
//   // ...then draw eyes/fangs/aura/drool/legs live...
//
// Rules of thumb:
//   • The bake is module-level — shared across all instances. Adding
//     more entities is free at bake time; only per-frame draw cost
//     grows (one drawImage per instance).
//   • Match the bake's row count to the entity's *movement* angle
//     quantization. If the entity rotates continuously, 32 rows ~=
//     11° steps gives smooth visual rotation; 16 is "feels arcade-y"
//     and saves half the memory.
//   • DO NOT bake animated state. Eye-color cycles, chomping fangs,
//     state-driven aura intensity, IK-driven legs — all stay live.
//     Baking them freezes the animation; the static-rotated/animated-
//     overlaid split is the cost boundary.
//   • `outline: null` on creature bodies that already use softBlob's
//     internal shadow ring; otherwise outlinePass duplicates the rim.
//
// Concrete impact on the spider in ik-character.html: ~400 fillRects/frame
// dropped to ~150, taking the integrated-GPU 20fps wall back to 60fps.
// See the `_spiderBodyBake` definition above `class Spider` for the
// canonical example.
//
// Table of Contents:
//
//   1. Layered solids        — layeredRect, layeredRectV, bevelRect, insetRect
//   2. Single-pixel accents  — glint, stud, led
//   3. Pixel-art primitives  — pxLine, disc
//   4. Material techniques   — plankWood, metalPanel, fabricPatch, gemCell
//   4b. Substrate materials  — stone, glass, leather, bone, ice, concrete, dirt
//   4c. Decay overlays       — rust, moss, crack, scratch, bloodSplatter, bloodSplatterExtreme
//   5b. Tool components      — shaft, pickaxeHead, shovelHead, axeHead,
//                              hammerHead, swordBlade, swordHilt,
//                              spearTip, maceHead, pommel
//   5c. VFX primitives       — sparkBurst, fire, explosion, shockwave,
//                              shockwaveSoft, debris, lightning,
//                              healSparkle, dustPuff, slash, ripple
//                              (all animated via opts.t)
//   8b. HUD primitives       — barH, barV, barSegments, barCylinder,
//                              barRadial, cooldownPie, pixelText,
//                              hudText, iconSlot, crosshair, keyHint,
//                              damageVignette, compassMarker
//   8c. Rounded shapes       — pxRoundedRect, pxRoundedRectFilled,
//                              roundedBevelRect
//   8d. Panels + buttons     — panel, dialog, button, listItem,
//                              inventoryGrid
//   8e. Input icons          — kbdKey, gamepadButton, gamepadDpad,
//                              gamepadStick, gamepadShoulder
//   8f. Easing helpers       — easeOutCubic, easeOutBack,
//                              easeOutBounce, easeInOutQuad
//   8g. Reveal / lootbox     — revealRays, revealSpotlight,
//                              revealBanner, revealStars, revealAura,
//                              revealItem, revealCounter, confetti,
//                              confettiBurst, numberPop, screenShake,
//                              lootbox (chest open animation)
//   8h. Slot machine reels   — slotReel (single), slotRow (multi-
//                              with staggered stops), slotWinFlash
//                              (jackpot-match overlay), slotWheel
//                              (minimal single wheel with arrows +
//                              result pop scale), arrow (cardinal
//                              triangle pointer)
//   5. Compound shapes       — gunBarrel, vineSpine
//   6. Bilateral symmetry    — bilateral
//   7. Outline post-pass     — outlinePass
//   8. Bake-and-cache        — makeBakedSprite
//   9. Palette factories     — paletteFromBody
//  10. Organic creatures     — pxEllipse, softBlob, eye, mouth, tentacle, limb,
//                              furEdge, scaleSpots, horn, membraneWing, creatureFace
//  10b. Ambient creatures    — bird, birdSide, dragonfly, butterfly
//  11. Tile primitives       — tileBase, tileChecker, tileSpeckle, tilePlanks,
//                              tileBrick, tileGrass, tileGrassBlobs
//      Crystal-style trees   — treeCrystal, bushCrystal, treePine, treeDead, treeWeeping
//      Grass + flora         — grassBlade, grassClump, flower, bush, tree, treeTopDown,
//                              fernFrond, bigLeaf, colorBlob, blobField
//      Tile surfaces         — tileDirt, tileGravel, tileLava, tileIce,
//                              tileMetalPanel, leafSprite, tileGrassOverhead,
//                              tileGrassDetailed, tileWater, tileStone, tileSand,
//                              tileDebug, tileDebugLabel, tileSnow
//  12. Autotiler             — neighborMask4/8, tileEdgeOverlay, tileCornerChamfer,
//                              tileSolidEdgeOverlay, tileNatureEdgeOverlay,
//                              makeAutotile, makeBorderedAutotile, makeSolidAutotile,
//                              makeNatureAutotile
//  13. Top-down character    — generateTopDownCharacter, generateTopDownParty,
//                              metalPalette
//
// Conventions:
//   - All coords are integers (pixel-art has no sub-pixels).
//   - All colors are CSS strings.
//   - `palette` arguments are usually shape-of {shadow, body, hilite}
//     or {shadow, body, hilite, accent} — three or four stops only.
//     Build them by hand or pull from a procgen2 palette ramp.
//   - Functions never read pixels; they only stamp. The exception is
//     `outlinePass` which does one read+write at the end of a bake.
//   - Pair with `bakeCanvas(w, h, ctx => ...)` from `bake.js` for the
//     atom-canvas pattern; nothing here allocates canvases.

// ─── 1. Layered solids ─────────────────────────────────────────────
// The single most common technique in the hand-coded drawers: a flat
// rect, a 1-px lighter top edge, and a 1-px darker bottom edge. Reads
// as a 3D bevel without taking 3 fillRects per side.
//
//   palette = { shadow, body, hilite }
export function layeredRect(ctx, x, y, w, h, palette) {
  ctx.fillStyle = palette.body;
  ctx.fillRect(x, y, w, h);
  // Top highlight + bottom shadow.
  ctx.fillStyle = palette.hilite;
  ctx.fillRect(x, y, w, 1);
  ctx.fillStyle = palette.shadow;
  ctx.fillRect(x, y + h - 1, w, 1);
  // Corner depth pixels — bright top-left, dark bottom-right.
  if (w >= 2 && h >= 2) {
    ctx.fillStyle = palette.hilite;
    ctx.fillRect(x, y + 1, 1, 1);              // left inner highlight
    ctx.fillStyle = palette.shadow;
    ctx.fillRect(x + w - 1, y + h - 2, 1, 1);  // right inner shadow
  }
}

export function layeredRectV(ctx, x, y, w, h, palette) {
  ctx.fillStyle = palette.body;
  ctx.fillRect(x, y, w, h);
  ctx.fillStyle = palette.hilite;
  ctx.fillRect(x, y, 1, h);
  ctx.fillStyle = palette.shadow;
  ctx.fillRect(x + w - 1, y, 1, h);
  if (w >= 2 && h >= 2) {
    ctx.fillStyle = palette.hilite;
    ctx.fillRect(x + 1, y, 1, 1);              // top inner highlight
    ctx.fillStyle = palette.shadow;
    ctx.fillRect(x + w - 2, y + h - 1, 1, 1);   // bottom inner shadow
  }
}

// 4-edge bevel with corner depth pixels for 3D reading.
export function bevelRect(ctx, x, y, w, h, palette) {
  ctx.fillStyle = palette.body;
  ctx.fillRect(x, y, w, h);
  ctx.fillStyle = palette.hilite;
  ctx.fillRect(x, y, w, 1);
  ctx.fillRect(x, y, 1, h);
  ctx.fillStyle = palette.shadow;
  ctx.fillRect(x, y + h - 1, w, 1);
  ctx.fillRect(x + w - 1, y, 1, h);
  // Corner pixels — bright NW, dark SE sell the 3D raise.
  if (w >= 2 && h >= 2) {
    if (palette.hilite) { ctx.fillStyle = palette.hilite; ctx.fillRect(x, y, 1, 1); }
    if (palette.shadow) { ctx.fillStyle = palette.shadow; ctx.fillRect(x + w - 1, y + h - 1, 1, 1); }
  }
}

// Inset bevel — recessed panel with corner depth.
export function insetRect(ctx, x, y, w, h, palette) {
  ctx.fillStyle = palette.body;
  ctx.fillRect(x, y, w, h);
  ctx.fillStyle = palette.shadow;
  ctx.fillRect(x, y, w, 1);
  ctx.fillRect(x, y, 1, h);
  ctx.fillStyle = palette.hilite;
  ctx.fillRect(x, y + h - 1, w, 1);
  ctx.fillRect(x + w - 1, y, 1, h);
  if (w >= 2 && h >= 2) {
    if (palette.shadow) { ctx.fillStyle = palette.shadow; ctx.fillRect(x, y, 1, 1); }
    if (palette.hilite) { ctx.fillStyle = palette.hilite; ctx.fillRect(x + w - 1, y + h - 1, 1, 1); }
  }
}

// ─── 1b. Stairs / steps / ladders ──────────────────────────────────
// Constructed climbable structures (top-down). Each tread is a band
// with a bright leading NOSING + a dark RISER/AO behind it, and the
// whole flight is value-ramped so it reads as going up into light /
// down into shade. Side STRINGERS frame it as built, not a gradient.
// palette: { shadow, body, hilite, rail? }

// Stair flight filling (x,y,w,h).
//   opts: { steps=7, dir='up'|'down'|'left'|'right', rail=true }
export function stairs(ctx, x, y, w, h, palette, opts = {}) {
  // Classic JRPG framed staircase. UNIFORM-width treads — NO perspective
  // taper, every step the exact same footprint. The direction reads from
  // the prominent side RAILS (the dominant cue) + which edge the thin
  // dark RISER line sits on + a TERMINATOR (a lit LANDING at the head
  // when ascending, a dark OPENING when descending). Up & down occupy
  // an identical rect.
  //   palette { shadow, body(=tread), hilite, rail? }
  //   opts    { steps=7, dir='up'|'down'|'left'|'right', rail=true }
  const n = Math.max(2, Math.min(24, opts.steps || 7));
  const dir = opts.dir || 'up';
  const horiz = dir === 'left' || dir === 'right';
  const headAtStart = dir === 'up' || dir === 'left'; // head at x/y origin
  const sh = palette.shadow, bd = palette.body, hi = palette.hilite;
  const railC = palette.rail || sh;
  const span = horiz ? w : h;                         // along the flight
  // rail:false ⇒ no stringers AND no inset (treads span the FULL width,
  // no dead margin where the rail would have been).
  const railW = opts.rail === false
    ? 0 : Math.max(2, Math.round((horiz ? h : w) * 0.13));
  const iOff = railW;
  const iLen = Math.max(2, (horiz ? h : w) - railW * 2); // span between rails
  for (let s = 0; s < n; s++) {
    const a0  = Math.round(s * span / n);
    const len = Math.max(2, Math.round((s + 1) * span / n) - a0);
    const riser = Math.max(1, Math.min(2, Math.round(len * 0.22)));
    if (horiz) {
      const tx = x + a0, ty = y + iOff;
      ctx.fillStyle = bd; ctx.fillRect(tx, ty, len, iLen);
      ctx.fillStyle = sh;                              // riser → head edge
      ctx.fillRect(headAtStart ? tx : tx + len - riser, ty, riser, iLen);
      ctx.fillStyle = hi;                              // nosing → foot edge
      ctx.fillRect(headAtStart ? tx + len - 1 : tx, ty, 1, iLen);
    } else {
      const tx = x + iOff, ty = y + a0;
      ctx.fillStyle = bd; ctx.fillRect(tx, ty, iLen, len);
      ctx.fillStyle = sh;
      ctx.fillRect(tx, headAtStart ? ty : ty + len - riser, iLen, riser);
      ctx.fillStyle = hi;
      ctx.fillRect(tx, headAtStart ? ty + len - 1 : ty, iLen, 1);
    }
  }
  // Terminator at the head — same width as the steps (the direction
  // cue): ascending arrives at a flat lit LANDING; descending drops
  // into a dark OPENING.
  const capT = Math.max(3, Math.round(span * 0.11));
  if (horiz) {
    if (headAtStart) { ctx.fillStyle = bd; ctx.fillRect(x, y + iOff, capT, iLen);
                       ctx.fillStyle = hi; ctx.fillRect(x, y + iOff, 1, iLen); }
    else             { ctx.fillStyle = sh; ctx.fillRect(x + w - capT, y + iOff, capT, iLen); }
  } else {
    if (headAtStart) { ctx.fillStyle = bd; ctx.fillRect(x + iOff, y, iLen, capT);
                       ctx.fillStyle = hi; ctx.fillRect(x + iOff, y, iLen, 1); }
    else             { ctx.fillStyle = sh; ctx.fillRect(x + iOff, y + h - capT, iLen, capT); }
  }
  // Side rails / stringers — the dominant "this is a staircase" read:
  // a beam with dark edges, an inner highlight, and peg studs.
  if (opts.rail !== false) {
    // `inner` = which edge of THIS rail faces the treads. The bright
    // highlight goes there for BOTH rails so the frame hugs the steps
    // symmetrically (the old fixed `rx+1` put the LEFT rail's highlight
    // on its OUTER edge → it read as a bar floating off in the dark).
    const rail = (rx, ry, rw, rh, vert, inner) => {
      ctx.fillStyle = railC; ctx.fillRect(rx, ry, rw, rh);
      ctx.fillStyle = sh;                               // dark outline, both edges
      if (vert) { ctx.fillRect(rx, ry, 1, rh); ctx.fillRect(rx + rw - 1, ry, 1, rh); }
      else      { ctx.fillRect(rx, ry, rw, 1); ctx.fillRect(rx, ry + rh - 1, rw, 1); }
      ctx.fillStyle = hi;                               // highlight on INNER edge
      if (vert) ctx.fillRect(inner === 'l' ? rx + 1 : rx + rw - 2, ry, 1, rh);
      else      ctx.fillRect(rx, inner === 't' ? ry + 1 : ry + rh - 2, rw, 1);
      ctx.fillStyle = sh;
      const L = vert ? rh : rw;
      for (let p = 4; p < L - 3; p += 7) {
        if (vert) ctx.fillRect(rx + Math.floor(rw / 2) - 1, ry + p, 2, 1);
        else      ctx.fillRect(rx + p, ry + Math.floor(rh / 2) - 1, 1, 2);
      }
    };
    if (horiz) { rail(x, y, w, railW, false, 'b'); rail(x, y + h - railW, w, railW, false, 't'); }
    else       { rail(x, y, railW, h, true, 'r');  rail(x + w - railW, y, railW, h, true, 'l'); }
  }
}

// Chunky receding stone stoop — a few deep beveled blocks (entrances,
// raised platforms). opts: { steps=3, dir='up'|'down' }
export function steps(ctx, x, y, w, h, palette, opts = {}) {
  const n = Math.max(2, Math.min(8, opts.steps || 3));
  const dir = opts.dir || 'up';
  const stepH = Math.max(2, Math.floor(h / n));
  const taper = Math.max(1, Math.floor((w * 0.18) / n));
  for (let s = 0; s < n; s++) {
    const inset = s * taper;
    const rx = x + inset, rw = Math.max(2, w - inset * 2);
    const ry = dir === 'down' ? y + s * stepH : y + h - (s + 1) * stepH;
    bevelRect(ctx, rx, ry, rw, stepH + 1, palette);
    ctx.fillStyle = palette.shadow;                // contact AO under the lip
    ctx.fillRect(rx, ry + stepH, rw, 1);
  }
}

// Ladder — two rails + cylindrical-shaded rungs. Orientation auto
// from aspect (or opts.orient 'v'|'h'). opts: { rungs, broken:[i…] }
export function ladder(ctx, x, y, w, h, palette, opts = {}) {
  const sh = palette.shadow, bd = palette.body, hi = palette.hilite;
  const horiz = (opts.orient || (w > h ? 'h' : 'v')) === 'h';
  const len = horiz ? w : h;
  const railW = Math.max(2, Math.round((horiz ? h : w) * 0.16));
  const rungs = opts.rungs || Math.max(2, Math.round(len / 6));
  const broken = new Set(opts.broken || []);
  if (horiz) {
    bevelRect(ctx, x, y, w, railW, palette);
    bevelRect(ctx, x, y + h - railW, w, railW, palette);
  } else {
    bevelRect(ctx, x, y, railW, h, palette);
    bevelRect(ctx, x + w - railW, y, railW, h, palette);
  }
  for (let r = 0; r < rungs; r++) {
    if (broken.has(r)) continue;
    const p = Math.round((r + 0.5) * len / rungs) - 1;
    if (horiz) {
      ctx.fillStyle = bd; ctx.fillRect(x + p, y + railW, 2, h - railW * 2);
      ctx.fillStyle = hi; ctx.fillRect(x + p, y + railW, 1, h - railW * 2);
      ctx.fillStyle = sh; ctx.fillRect(x + p + 1, y + railW, 1, h - railW * 2);
    } else {
      ctx.fillStyle = bd; ctx.fillRect(x + railW, y + p, w - railW * 2, 2);
      ctx.fillStyle = hi; ctx.fillRect(x + railW, y + p, w - railW * 2, 1);
      ctx.fillStyle = sh; ctx.fillRect(x + railW, y + p + 1, w - railW * 2, 1);
    }
  }
}

// ─── 2. Single-pixel accents ───────────────────────────────────────

export function glint(ctx, x, y, color = '#ffffff') {
  ctx.fillStyle = color;
  ctx.fillRect(x, y, 1, 1);
}

// 2×2 stud with optional shadow pixel for depth.
export function stud(ctx, x, y, color, shadow) {
  ctx.fillStyle = color;
  ctx.fillRect(x, y, 2, 2);
  if (shadow) {
    ctx.fillStyle = shadow;
    ctx.fillRect(x, y + 2, 2, 1);
    ctx.fillRect(x + 2, y, 1, 2);
  }
}

// Status LED — center pixel + optional 4-way halo cross.
export function led(ctx, x, y, color, halo = null) {
  if (halo) {
    ctx.fillStyle = halo;
    ctx.fillRect(x - 1, y, 1, 1);
    ctx.fillRect(x + 1, y, 1, 1);
    ctx.fillRect(x, y - 1, 1, 1);
    ctx.fillRect(x, y + 1, 1, 1);
  }
  ctx.fillStyle = color;
  ctx.fillRect(x, y, 1, 1);
}

// ─── 3. Pixel-art primitives ───────────────────────────────────────

// Bresenham 1-px line with optional thickness and shadow offset.
export function pxLine(ctx, x0, y0, x1, y1, color) {
  ctx.fillStyle = color;
  let dx = Math.abs(x1 - x0), dy = -Math.abs(y1 - y0);
  let sx = x0 < x1 ? 1 : -1, sy = y0 < y1 ? 1 : -1;
  let err = dx + dy;
  let x = x0, y = y0;
  while (true) {
    ctx.fillRect(x, y, 1, 1);
    if (x === x1 && y === y1) break;
    const e2 = err * 2;
    if (e2 >= dy) { err += dy; x += sx; }
    if (e2 <= dx) { err += dx; y += sy; }
  }
}

function _discMaxDx(r, dy, rr = r * r) {
  const dy2 = dy * dy;
  const rem = rr - dy2;
  if (rem < 0) return -1;
  let dx = Math.min(r, Math.floor(Math.sqrt(rem)));
  while (dx < r && (dx + 1) * (dx + 1) + dy2 <= rr) dx++;
  while (dx > 0 && dx * dx + dy2 > rr) dx--;
  return dx;
}

const _discSpanCache = new Map();
const _discRingSpanCache = new Map();
const _ellipseSpanCache = new Map();

function _discSpans(r) {
  if (r < 0) return [];
  const cached = _discSpanCache.get(r);
  if (cached) return cached;
  const rr = r * r;
  const spans = [];
  for (let dy = -r; dy <= r; dy++) {
    const dx = _discMaxDx(r, dy, rr);
    if (dx >= 0) spans.push([dy, dx]);
  }
  _discSpanCache.set(r, spans);
  return spans;
}

function _fillDiscRows(ctx, cx, cy, r) {
  const spans = _discSpans(r);
  for (let i = 0; i < spans.length; i++) {
    const dy = spans[i][0], dx = spans[i][1];
    ctx.fillRect(cx - dx, cy + dy, dx * 2 + 1, 1);
  }
}

function _fillDiscRingRows(ctx, cx, cy, innerR, outerR) {
  if (outerR < 0) return;
  const key = innerR + '|' + outerR;
  let spans = _discRingSpanCache.get(key);
  if (!spans) {
    spans = [];
    const outer2 = outerR * outerR;
    const inner2 = innerR * innerR;
    for (let dy = -outerR; dy <= outerR; dy++) {
      const outerDx = _discMaxDx(outerR, dy, outer2);
      if (outerDx < 0) continue;
      if (dy * dy > inner2 || innerR < 0) {
        spans.push([dy, -outerDx, outerDx * 2 + 1]);
        continue;
      }
      const innerDx = _discMaxDx(innerR, dy, inner2);
      const width = outerDx - innerDx;
      if (width > 0) {
        spans.push([dy, -outerDx, width]);
        spans.push([dy, innerDx + 1, width]);
      }
    }
    _discRingSpanCache.set(key, spans);
  }
  for (let i = 0; i < spans.length; i++) {
    const span = spans[i];
    ctx.fillRect(cx + span[1], cy + span[0], span[2], 1);
  }
}

function _ellipseMaxDx(rx, ry, dy, rx2 = rx * rx, ry2 = ry * ry) {
  const dy2 = dy * dy;
  const limit = 1 - dy2 / ry2;
  if (limit < 0) return -1;
  let dx = Math.min(rx, Math.floor(Math.sqrt(limit * rx2)));
  while (dx < rx && ((dx + 1) * (dx + 1)) / rx2 + dy2 / ry2 <= 1) dx++;
  while (dx > 0 && (dx * dx) / rx2 + dy2 / ry2 > 1) dx--;
  return dx;
}

function _ellipseSpans(rx, ry) {
  if (rx === 0 && ry === 0) return [[0, 0]];
  if (rx <= 0 || ry <= 0) return [];
  const key = rx + '|' + ry;
  const cached = _ellipseSpanCache.get(key);
  if (cached) return cached;
  const rx2 = rx * rx, ry2 = ry * ry;
  const spans = [];
  for (let dy = -ry; dy <= ry; dy++) {
    const dx = _ellipseMaxDx(rx, ry, dy, rx2, ry2);
    if (dx >= 0) spans.push([dy, dx]);
  }
  _ellipseSpanCache.set(key, spans);
  return spans;
}

function _fillEllipseRows(ctx, cx, cy, rx, ry) {
  const spans = _ellipseSpans(rx, ry);
  for (let i = 0; i < spans.length; i++) {
    const dy = spans[i][0], dx = spans[i][1];
    ctx.fillRect(cx - dx, cy + dy, dx * 2 + 1, 1);
  }
}

function _fillEllipseRowRange(ctx, cx, cy, rx, ry, fromDy, toDy) {
  const spans = _ellipseSpans(rx, ry);
  const start = Math.max(-ry, fromDy);
  const end = Math.min(ry, toDy);
  for (let i = 0; i < spans.length; i++) {
    const dy = spans[i][0];
    if (dy < start || dy > end) continue;
    const dx = spans[i][1];
    ctx.fillRect(cx - dx, cy + dy, dx * 2 + 1, 1);
  }
}

// Filled disc with optional inner highlight and rim ring.
export function disc(ctx, cx, cy, r, palette) {
  const body = palette.body || palette;
  // Rim ring (1px wider than body).
  if (palette.rim) {
    ctx.fillStyle = palette.rim;
    _fillDiscRingRows(ctx, cx, cy, r, r + 1);
  }
  // Body fill.
  ctx.fillStyle = body;
  _fillDiscRows(ctx, cx, cy, r);
  // Inner highlight — upper-left crescent.
  if (palette.hilite && r >= 2) {
    ctx.fillStyle = palette.hilite;
    const ir = r - 1;
    const spans = _discSpans(ir);
    for (let i = 0; i < spans.length; i++) {
      const dy = spans[i][0];
      if (dy > 0) break;
      const dx = spans[i][1];
      ctx.fillRect(cx - dx, cy + dy, dx + 1, 1);
    }
  }
  // Ground shadow pixel.
  if (palette.shadow) {
    ctx.fillStyle = palette.shadow;
    ctx.fillRect(cx, cy + r, 1, 1);
  }
}

// ─── 4. Composed material techniques ───────────────────────────────

// Plank wood — body + seams + deterministic grain arcs + optional knot.
export function plankWood(ctx, x, y, w, h, palette, opts = {}) {
  const plankW = opts.plankW != null ? opts.plankW : 4;
  const seed   = opts.seed   != null ? opts.seed   : 0;
  layeredRect(ctx, x, y, w, h, palette);
  // Plank seams with adjacent highlight for 3D groove.
  for (let dx = plankW; dx < w; dx += plankW) {
    ctx.fillStyle = palette.seam;
    ctx.fillRect(x + dx, y, 1, h);
    ctx.fillStyle = palette.hilite;
    ctx.fillRect(x + dx + 1, y, 1, h);
  }
  // Grain arcs — short horizontal stretches with subtle curve per plank.
  for (let plank = 0; plank < w; plank += plankW) {
    const pw = Math.min(plankW, w - plank);
    if (pw < 3) continue;
    const h = _tileHash(seed + plank, 0, 0);
    const gy = y + 2 + ((h >>> 8) % Math.max(1, h - 4));
    ctx.fillStyle = palette.shadow;
    for (let dx = 1; dx < pw - 1; dx++) {
      const grainY = gy + (((dx + (h & 1)) & 3) < 2 ? 0 : 1);
      if (grainY < y + h && ((dx + (h >>> 4)) & 3) < 2) {
        ctx.fillRect(x + plank + dx, grainY, 1, 1);
      }
    }
  }
  // Optional knot.
  if (opts.knot && (_tileHash(seed, 9, 9) & 3) < 2) {
    const kh = _tileHash(seed + 4111, 0, 0);
    const planks = Math.max(1, Math.floor(w / plankW));
    const pi = (kh & 0xff) % planks;
    const kx = x + pi * plankW + 2;
    const ky = y + 2 + ((kh >>> 16) % Math.max(1, h - 4));
    if (kx + 1 < x + w && ky + 1 < y + h) {
      ctx.fillStyle = palette.seam;
      ctx.fillRect(kx, ky, 2, 2);
      ctx.fillStyle = palette.shadow;
      ctx.fillRect(kx, ky, 1, 1);
      ctx.fillRect(kx + 1, ky + 1, 1, 1);
    }
  }
}

// Metal panel — bevel + optional seam + optional rivets.
export function metalPanel(ctx, x, y, w, h, palette, opts = {}) {
  bevelRect(ctx, x, y, w, h, palette);
  // Horizontal seam line.
  if (opts.seamY != null && opts.seamY > 0 && opts.seamY < h - 1) {
    ctx.fillStyle = palette.shadow;
    ctx.fillRect(x, y + opts.seamY, w, 1);
    ctx.fillStyle = palette.hilite;
    ctx.fillRect(x, y + opts.seamY + 1, w, 1);
  }
  // Label strip.
  if (opts.label) {
    ctx.fillStyle = palette.hilite;
    const ly = opts.label.y != null ? opts.label.y : Math.floor(h / 3);
    const lw = opts.label.w != null ? opts.label.w : Math.floor(w * 0.6);
    const lx = opts.label.x != null ? opts.label.x : Math.floor((w - lw) / 2);
    ctx.fillRect(x + lx, y + ly, lw, 1);
  }
  // Corner rivets — 4 corners if panel is large enough.
  if (opts.rivets && w >= 6 && h >= 6) {
    const margin = 2;
    for (const [rx, ry] of [[margin, margin], [w - margin - 1, margin],
                             [margin, h - margin - 1], [w - margin - 1, h - margin - 1]]) {
      ctx.fillStyle = palette.hilite;
      ctx.fillRect(x + rx, y + ry, 1, 1);
      ctx.fillStyle = palette.shadow;
      ctx.fillRect(x + rx + 1, y + ry, 1, 1);
      ctx.fillRect(x + rx, y + ry + 1, 1, 1);
    }
  }
}

// Fabric patch — cross-hatch stitch pattern with optional quilted diamonds.
export function fabricPatch(ctx, x, y, w, h, palette, opts = {}) {
  const stitch = opts.stitch != null ? opts.stitch : 4;
  layeredRect(ctx, x, y, w, h, palette);
  // Cross-hatch: both diagonal directions for quilted fabric look.
  ctx.fillStyle = palette.shadow;
  for (let dy = 1; dy < h - 1; dy++) {
    for (let dx = 1; dx < w - 1; dx++) {
      // Both diagonals.
      if ((dx + dy) % stitch === 0 || (dx - dy) % stitch === 0) {
        ctx.fillRect(x + dx, y + dy, 1, 1);
      }
    }
  }
  // Quilted diamond centers — bright pixel where diagonals cross.
  if (stitch >= 4) {
    ctx.fillStyle = palette.hilite;
    for (let dy = stitch; dy < h - stitch; dy += stitch) {
      for (let dx = stitch; dx < w - stitch; dx += stitch) {
        ctx.fillRect(x + dx, y + dy, 1, 1);
      }
    }
  }
}

// Glass cell / gem — layered discs with rim, body, core, and glint.
export function gemCell(ctx, cx, cy, r, palette) {
  // Optional outer rim.
  if (palette.rim && r >= 2) {
    ctx.fillStyle = palette.rim;
    _fillDiscRingRows(ctx, cx, cy, r - 1, r + 1);
  }
  // Outer shadow disc.
  ctx.fillStyle = palette.shadow;
  _fillDiscRows(ctx, cx, cy, r);
  // Inner body disc.
  const ir = Math.max(0, r - 1);
  ctx.fillStyle = palette.body;
  _fillDiscRows(ctx, cx, cy, ir);
  // Hot core.
  if (palette.core) {
    ctx.fillStyle = palette.core;
    const cr = Math.max(0, r - 3);
    _fillDiscRows(ctx, cx, cy, cr);
  }
  // Glint.
  if (palette.glint && r >= 2) {
    ctx.fillStyle = palette.glint;
    ctx.fillRect(cx - 1, cy - 1, 1, 1);
  }
}

// ─── 4b. Substrate materials ───────────────────────────────────────
// Arbitrary-rect material fills that supplant `bevelRect` when you
// want material-specific texture. Each takes a (ctx, x, y, w, h,
// palette, opts = {}) signature uniform with §4 above. `opts.seed`
// drives deterministic randomness; omit for a position-derived hash.

function _matSeed(seed, x, y) {
  return (seed != null ? seed | 0 : 0) ^ ((x | 0) * 73856093) ^ ((y | 0) * 19349663);
}

// Stone — weathered rock with cracks and chipped highlights. Best for
// boulders, ruins, isolated stone blocks. (For tiled stone floors use
// `tileStone`.)
//   palette: { shadow, body, hilite, crack? }
//   opts:    { seed, cracks=2, specks=true }
export function stone(ctx, x, y, w, h, palette, opts = {}) {
  const seed = _matSeed(opts.seed, x, y);
  const crackCol = palette.crack || palette.shadow;
  // Body.
  ctx.fillStyle = palette.body;
  ctx.fillRect(x, y, w, h);
  // Top + left highlight.
  ctx.fillStyle = palette.hilite;
  ctx.fillRect(x, y, w, 1);
  ctx.fillRect(x, y, 1, h);
  // Bottom + right shadow.
  ctx.fillStyle = palette.shadow;
  ctx.fillRect(x, y + h - 1, w, 1);
  ctx.fillRect(x + w - 1, y, 1, h);
  // Speckle texture for grain.
  if (opts.specks !== false) {
    ctx.fillStyle = palette.shadow;
    for (let dy = 1; dy < h - 1; dy++) {
      for (let dx = 1; dx < w - 1; dx++) {
        if ((_tileHash(seed, dx, dy) % 23) < 2) ctx.fillRect(x + dx, y + dy, 1, 1);
      }
    }
    ctx.fillStyle = palette.hilite;
    for (let dy = 1; dy < h - 1; dy += 2) {
      for (let dx = 1; dx < w - 1; dx += 2) {
        if ((_tileHash(seed + 113, dx, dy) % 41) < 1) ctx.fillRect(x + dx, y + dy, 1, 1);
      }
    }
  }
  // Cracks — short jagged lines walking from one random edge inward.
  const cracks = opts.cracks != null ? opts.cracks : 2;
  ctx.fillStyle = crackCol;
  for (let c = 0; c < cracks; c++) {
    const ch = _tileHash(seed + c * 9173, 0, 0);
    let cx = x + 1 + (ch & 0xff) % Math.max(1, w - 2);
    let cy = y + 1 + ((ch >>> 8) & 0xff) % Math.max(1, h - 2);
    const len = 3 + ((ch >>> 16) & 7);
    let dx = ((ch >>> 20) & 1) ? 1 : -1;
    let dy = ((ch >>> 24) & 1) ? 1 : 0;
    for (let s = 0; s < len; s++) {
      if (cx <= x || cx >= x + w - 1 || cy <= y || cy >= y + h - 1) break;
      ctx.fillRect(cx, cy, 1, 1);
      const turn = _tileHash(seed + c * 211 + s, 0, 0) & 7;
      if (turn === 0) dx = -dx;
      if (turn === 1) dy = (dy + 1) & 1;
      cx += dx; cy += dy;
    }
  }
}

// Glass — translucent panel with the canonical pixel-art "L-glint"
// reflection in the upper-left corner. Total rewrite from the previous
// edge-bevel + diagonal-stripe version, which read as either a metal
// panel (the bevels) or a scratched/cracked surface (the diagonal).
//
// What real pixel-art glass conventions look like:
//   1. Translucent tint (caller draws backdrop FIRST, glass overlays)
//   2. Slightly darker bottom half — "depth" through the pane
//   3. SMALL L-shaped bright reflection in upper-left (the universal
//      "I am glass" cue — every Stardew/Minecraft/SS13 pane has this)
//   4. Optional metal frame (opt-in via opts.frame, NOT a default rim)
//
//   palette: { tint, reflection?, frameLight?, frameDark? }
//   opts:    { alpha=0.35, reflection=true, depth=true, frame=false,
//              insetX=2, insetY=2 }
//     insetX/Y — how far from the upper-left corner the L-glint sits
//
// Conscious omissions from the old version:
//   - NO diagonal "refraction" stripe. It always reads as a crack.
//   - NO automatic 4-side bevel. That makes glass look like a panel.
//     If you want a frame, opt in explicitly via { frame: true }.
//   - NO `edge` palette field. Use `frameLight` / `frameDark` if framing.
export function glass(ctx, x, y, w, h, palette, opts = {}) {
  const alpha = opts.alpha != null ? opts.alpha : 0.35;
  const tintHex = palette.tint || '#a0d8ff';
  const r = parseInt(tintHex.slice(1, 3), 16);
  const g = parseInt(tintHex.slice(3, 5), 16);
  const b = parseInt(tintHex.slice(5, 7), 16);
  // 1. Translucent tinted body.
  ctx.fillStyle = `rgba(${r},${g},${b},${alpha.toFixed(3)})`;
  ctx.fillRect(x, y, w, h);
  // 2. Bottom-half "depth" — slightly darker translucent overlay
  //    suggesting the glass is thicker / further-back at the bottom.
  //    Skipped on tiny rects.
  if (opts.depth !== false && h >= 4) {
    const depthY = y + Math.floor(h * 0.55);
    const depthH = h - Math.floor(h * 0.55);
    const dr = (r * 0.65) | 0, dg = (g * 0.65) | 0, db = (b * 0.85) | 0;
    ctx.fillStyle = `rgba(${dr},${dg},${db},${(alpha * 0.5).toFixed(3)})`;
    ctx.fillRect(x, depthY, w, depthH);
  }
  // 3. L-shaped reflection glint in the upper-left.
  //    Two short perpendicular 1px lines — vertical drop + horizontal
  //    span. Scaled to the rect so a 8×8 pane and a 64×64 pane both
  //    look proportionally right.
  if (opts.reflection !== false && Math.min(w, h) >= 5) {
    const reflCol = palette.reflection || '#ffffff';
    ctx.fillStyle = reflCol;
    const insetX = opts.insetX != null ? opts.insetX : Math.max(1, Math.floor(w * 0.15));
    const insetY = opts.insetY != null ? opts.insetY : Math.max(1, Math.floor(h * 0.15));
    // L-shape size scales with rect (capped so it doesn't dominate).
    const armLen = Math.max(1, Math.min(3, Math.floor(Math.min(w, h) * 0.18)));
    // Vertical arm of the L (drops down from corner).
    ctx.fillRect(x + insetX, y + insetY, 1, armLen);
    // Horizontal arm of the L (extends right from corner).
    ctx.fillRect(x + insetX, y + insetY, armLen, 1);
    // Optional second tiny glint — a single pixel further inside,
    // suggests a secondary reflection (light source has slight extent).
    if (Math.min(w, h) >= 10) {
      ctx.fillRect(x + insetX + armLen + 1, y + insetY + armLen + 1, 1, 1);
    }
  }
  // 4. Optional metal frame — opt in via { frame: true } when the
  //    glass is set in a window/door/panel. Without this opt, the
  //    glass renders rim-less (the typical use case for goo vials,
  //    crystal balls, free-floating panes).
  if (opts.frame) {
    ctx.fillStyle = palette.frameLight || '#a0a8b0';
    ctx.fillRect(x, y, w, 1);
    ctx.fillRect(x, y, 1, h);
    ctx.fillStyle = palette.frameDark || '#3a4048';
    ctx.fillRect(x, y + h - 1, w, 1);
    ctx.fillRect(x + w - 1, y, 1, h);
  }
}

// Leather — supple material with pebbly grain, subtle creases, and
// stitched edges. Rewritten from the original cross-hatch speckle
// (which read as a regular checker pattern) to use clustered pebble
// dots + 1-2 horizontal creases — the visual cues that say "leather"
// rather than "cross-stitched fabric."
//   palette: { shadow, body, hilite, stitch? }
//   opts:    { seed, stitch=true, stitchInset=2, creases=true, pebbles=true }
export function leather(ctx, x, y, w, h, palette, opts = {}) {
  const seed = _matSeed(opts.seed, x, y);
  layeredRect(ctx, x, y, w, h, palette);
  // Pebble grain — clusters of 1-3 dark dots, scattered. Fewer total
  // marks than the old uniform speckle but each cluster reads as a
  // distinct grain feature.
  if (opts.pebbles !== false) {
    const pebbles = Math.max(2, Math.floor((w * h) / 28));
    for (let p = 0; p < pebbles; p++) {
      const ph = _tileHash(seed + p * 1117, 0, 0);
      const pcx = 1 + (ph & 0xff) % Math.max(1, w - 2);
      const pcy = 1 + ((ph >>> 8) & 0xff) % Math.max(1, h - 2);
      const pSize = 1 + ((ph >>> 16) & 1);
      ctx.fillStyle = palette.shadow;
      ctx.fillRect(x + pcx, y + pcy, 1, 1);
      // Adjacent satellite dots for cluster feel.
      if (pSize > 1) {
        const off = ((ph >>> 17) & 3);
        const ax = pcx + (off & 1 ? 1 : -1);
        const ay = pcy + (off & 2 ? 1 : -1);
        if (ax > 0 && ax < w - 1 && ay > 0 && ay < h - 1) {
          ctx.fillRect(x + ax, y + ay, 1, 1);
        }
      }
    }
    // A few bright micro-glints for the supple sheen.
    ctx.fillStyle = palette.hilite;
    const glints = Math.max(1, Math.floor(pebbles * 0.3));
    for (let g = 0; g < glints; g++) {
      const gh = _tileHash(seed + g * 4421, 0, 0);
      const gx = 1 + (gh & 0xff) % Math.max(1, w - 2);
      const gy = 1 + ((gh >>> 8) & 0xff) % Math.max(1, h - 2);
      ctx.fillRect(x + gx, y + gy, 1, 1);
    }
  }
  // Subtle horizontal creases — 1-2 dithered lines suggesting natural
  // folds. Skipped on small rects where they'd dominate.
  if (opts.creases !== false && h >= 8) {
    const creases = 1 + ((seed >>> 4) & 1);
    ctx.fillStyle = palette.shadow;
    for (let c = 0; c < creases; c++) {
      const cy = 2 + ((_tileHash(seed + c * 2741, 0, 0) >>> 0) % Math.max(1, h - 4));
      for (let dx = 1; dx < w - 1; dx++) {
        if ((dx & 1) === 0) ctx.fillRect(x + dx, y + cy, 1, 1);
      }
    }
  }
  // Stitching — dashed line just inside each edge.
  if (opts.stitch !== false && Math.min(w, h) >= 6) {
    const inset = opts.stitchInset != null ? opts.stitchInset : 2;
    ctx.fillStyle = palette.stitch || palette.hilite;
    for (let dx = inset; dx < w - inset; dx++) {
      if ((dx & 1) === 0) {
        ctx.fillRect(x + dx, y + inset, 1, 1);
        ctx.fillRect(x + dx, y + h - inset - 1, 1, 1);
      }
    }
    for (let dy = inset; dy < h - inset; dy++) {
      if ((dy & 1) === 0) {
        ctx.fillRect(x + inset, y + dy, 1, 1);
        ctx.fillRect(x + w - inset - 1, y + dy, 1, 1);
      }
    }
  }
}

// Dirt — packed earth with embedded pebbles and small roots. Companion
// to `tileDirt` but for arbitrary rects (wells, dug holes, exposed
// ground patches).
//   palette: { shadow, body, hilite, pebble?, root? }
//   opts:    { seed, pebbles=true, roots=true, striations=true }
export function dirt(ctx, x, y, w, h, palette, opts = {}) {
  const seed = _matSeed(opts.seed, x, y);
  // Body.
  ctx.fillStyle = palette.body;
  ctx.fillRect(x, y, w, h);
  // Subtle horizontal striations (sediment layers). Dithered dark
  // bands every 3-4 rows, each row picks ~half the pixels.
  if (opts.striations !== false) {
    ctx.fillStyle = palette.shadow;
    for (let dy = 1; dy < h - 1; dy++) {
      const onBand = (dy + (seed & 3)) % 4 === 0;
      if (!onBand) continue;
      for (let dx = 0; dx < w; dx++) {
        if ((_tileHash(seed + dy * 79, dx, 0) & 3) < 2) {
          ctx.fillRect(x + dx, y + dy, 1, 1);
        }
      }
    }
  }
  // Pebbles — small 2×1 or 1×2 inclusions in pebble color (or shadow).
  if (opts.pebbles !== false) {
    const pebbleCol = palette.pebble || palette.hilite;
    const count = Math.max(2, Math.floor((w * h) / 22));
    for (let p = 0; p < count; p++) {
      const ph = _tileHash(seed + p * 6011, 0, 0);
      const pcx = (ph & 0xff) % Math.max(1, w - 1);
      const pcy = ((ph >>> 8) & 0xff) % Math.max(1, h - 1);
      const horiz = (ph >>> 16) & 1;
      ctx.fillStyle = pebbleCol;
      if (horiz) ctx.fillRect(x + pcx, y + pcy, 2, 1);
      else       ctx.fillRect(x + pcx, y + pcy, 1, 2);
      // Single-pixel highlight on top edge of the pebble.
      ctx.fillStyle = palette.hilite;
      ctx.fillRect(x + pcx, y + pcy, 1, 1);
    }
  }
  // Roots — 2-3 thin dark lines wandering upward. Adds organic feel.
  if (opts.roots !== false && h >= 6) {
    const rootCol = palette.root || palette.shadow;
    const roots = 1 + ((seed >>> 8) & 1);
    ctx.fillStyle = rootCol;
    for (let r = 0; r < roots; r++) {
      const rh = _tileHash(seed + r * 8081, 0, 0);
      let rx = (rh & 0xff) % w;
      let ry = h - 1 - ((rh >>> 8) & 3);
      const len = 3 + ((rh >>> 16) & 3);
      let dirX = ((rh >>> 20) & 1) ? 1 : -1;
      for (let s = 0; s < len; s++) {
        if (rx <= 0 || rx >= w - 1 || ry <= 0) break;
        ctx.fillRect(x + rx, y + ry, 1, 1);
        if ((_tileHash(seed + r * 211 + s, 0, 0) & 3) === 0) dirX = -dirX;
        rx += dirX;
        ry -= 1;
      }
    }
  }
}

// Bone — porous off-white with directional grain and a central ridge.
// Rewritten: grain is now CONTINUOUS streaks (one full-length line per
// stripe) rather than scattered pixels per row, plus a bright central
// ridge highlight along the long axis. Pores cluster instead of
// scattering — bone porosity is patchy, not uniformly random.
//   palette: { shadow, body, hilite }
//   opts:    { seed, grain=true, pores=true, ridge=true }
export function bone(ctx, x, y, w, h, palette, opts = {}) {
  const seed = _matSeed(opts.seed, x, y);
  const horizontal = w >= h;
  // Body.
  ctx.fillStyle = palette.body;
  ctx.fillRect(x, y, w, h);
  // Soft top + left highlight, deeper bottom + right shadow.
  ctx.fillStyle = palette.hilite;
  ctx.fillRect(x, y, w, 1);
  ctx.fillStyle = palette.shadow;
  ctx.fillRect(x, y + h - 1, w, 1);
  // Central ridge — bright line running along the long axis, slightly
  // off-center for visual interest. Reads as the natural curve of a
  // bone's anterior face.
  if (opts.ridge !== false && Math.min(w, h) >= 4) {
    ctx.fillStyle = palette.hilite;
    if (horizontal) {
      const ry = Math.floor(h * 0.4);
      for (let dx = 2; dx < w - 2; dx++) {
        if ((_tileHash(seed + 909, dx, 0) & 7) !== 0) {
          ctx.fillRect(x + dx, y + ry, 1, 1);
        }
      }
    } else {
      const rx = Math.floor(w * 0.4);
      for (let dy = 2; dy < h - 2; dy++) {
        if ((_tileHash(seed + 909, 0, dy) & 7) !== 0) {
          ctx.fillRect(x + rx, y + dy, 1, 1);
        }
      }
    }
  }
  // Longitudinal grain — continuous parallel streaks along the long
  // axis. Each streak is a full-length 1px line in shadow color, with
  // ~30% gaps for natural break-up.
  if (opts.grain !== false) {
    ctx.fillStyle = palette.shadow;
    if (horizontal) {
      const stripes = Math.max(2, Math.floor(h / 3));
      for (let s = 0; s < stripes; s++) {
        const sy = 2 + Math.floor((s + 0.5) * (h - 4) / stripes);
        for (let dx = 1; dx < w - 1; dx++) {
          if ((_tileHash(seed + s * 41, dx, 0) & 7) > 1) {
            ctx.fillRect(x + dx, y + sy, 1, 1);
          }
        }
      }
    } else {
      const stripes = Math.max(2, Math.floor(w / 3));
      for (let s = 0; s < stripes; s++) {
        const sx = 2 + Math.floor((s + 0.5) * (w - 4) / stripes);
        for (let dy = 1; dy < h - 1; dy++) {
          if ((_tileHash(seed + s * 41, 0, dy) & 7) > 1) {
            ctx.fillRect(x + sx, y + dy, 1, 1);
          }
        }
      }
    }
  }
  // Pores — clustered tiny dark dots in 2-3 patches.
  if (opts.pores !== false) {
    ctx.fillStyle = palette.shadow;
    const clusters = 2 + ((seed >>> 12) & 1);
    for (let c = 0; c < clusters; c++) {
      const ch = _tileHash(seed + c * 5021, 0, 0);
      const ccx = 1 + (ch & 0xff) % Math.max(1, w - 2);
      const ccy = 1 + ((ch >>> 8) & 0xff) % Math.max(1, h - 2);
      const dotsPerCluster = 3 + ((ch >>> 16) & 3);
      for (let d = 0; d < dotsPerCluster; d++) {
        const dh = _tileHash(seed + c * 211 + d * 7, 0, 0);
        const ox = (dh & 3) - 1;       // -1, 0, 1, 2
        const oy = ((dh >>> 4) & 3) - 1;
        const px = ccx + ox, py = ccy + oy;
        if (px > 0 && px < w - 1 && py > 0 && py < h - 1) {
          ctx.fillRect(x + px, y + py, 1, 1);
        }
      }
    }
  }
}

// Ice — pale crystalline body. Rewritten for stronger visual cues:
//   - sharp 1-2px specular at the very top (light reflecting off the
//     surface), brighter than the gradient hilite
//   - branching/Y-shaped cracks (real ice fractures fork) instead of
//     straight line fragments
//   - clustered crystalline glints (3-4 pixels in a small group)
//     rather than uniformly scattered single pixels
//   - cool blue dithered shadow at the bottom for the "translucent
//     depth" feel
//   palette: { shadow, body, hilite, crack? }
//   opts:    { seed, cracks=2, glints=true, specular=true }
export function ice(ctx, x, y, w, h, palette, opts = {}) {
  const seed = _matSeed(opts.seed, x, y);
  // Vertical gradient: top hilite → body → bottom shadow band.
  for (let dy = 0; dy < h; dy++) {
    const t = dy / Math.max(1, h - 1);
    ctx.fillStyle = t < 0.25 ? palette.hilite
                  : t > 0.75 ? palette.shadow
                  :            palette.body;
    ctx.fillRect(x, y + dy, w, 1);
  }
  // Specular highlight — sharp bright 1-2px band right at the top
  // edge. This is what reads as "smooth glassy ice surface."
  if (opts.specular !== false) {
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(x + 1, y, w - 2, 1);
    if (h >= 6) {
      // Second softer band 2px below — implies the light source has
      // slight extent, not a single point.
      ctx.fillStyle = palette.hilite;
      for (let dx = 1; dx < w - 1; dx++) {
        if ((dx & 1) === 0) ctx.fillRect(x + dx, y + 2, 1, 1);
      }
    }
  }
  // Bottom shadow dither — deeper translucent feel.
  ctx.fillStyle = palette.shadow;
  if (h >= 6) {
    for (let dx = 0; dx < w; dx++) {
      if (((dx + seed) & 1) === 0) ctx.fillRect(x + dx, y + h - 2, 1, 1);
    }
  }
  // Branching cracks — Y-shaped fractures. Each crack walks from a
  // start point in some direction, then forks once mid-way.
  const cracks = opts.cracks != null ? opts.cracks : 2;
  const crackCol = palette.crack || '#e0f0ff';
  ctx.fillStyle = crackCol;
  for (let c = 0; c < cracks; c++) {
    const ch = _tileHash(seed + c * 7919, 0, 0);
    const cx0 = 2 + (ch & 0xff) % Math.max(1, w - 4);
    const cy0 = 2 + ((ch >>> 8) & 0xff) % Math.max(1, h - 4);
    const mainLen = 3 + ((ch >>> 16) & 4);
    const ang = ((ch >>> 24) & 7) * (Math.PI / 4);
    let lastX = cx0, lastY = cy0;
    for (let s = 0; s < mainLen; s++) {
      const px = Math.round(cx0 + Math.cos(ang) * s);
      const py = Math.round(cy0 + Math.sin(ang) * s);
      if (px <= 0 || px >= w - 1 || py <= 0 || py >= h - 1) break;
      ctx.fillRect(x + px, y + py, 1, 1);
      lastX = px; lastY = py;
    }
    // Fork — branch from mid-crack at ~45° in the opposite side.
    const branchStart = Math.floor(mainLen / 2);
    const bx = Math.round(cx0 + Math.cos(ang) * branchStart);
    const by = Math.round(cy0 + Math.sin(ang) * branchStart);
    const forkAng = ang + ((ch & 1) ? 0.7 : -0.7);
    const forkLen = 2 + ((ch >>> 28) & 2);
    for (let s = 1; s < forkLen; s++) {
      const px = Math.round(bx + Math.cos(forkAng) * s);
      const py = Math.round(by + Math.sin(forkAng) * s);
      if (px <= 0 || px >= w - 1 || py <= 0 || py >= h - 1) break;
      ctx.fillRect(x + px, y + py, 1, 1);
    }
  }
  // Crystalline glints — clustered (3-4 pixels in a small group)
  // rather than uniformly scattered. Reads as "facet sparkle."
  if (opts.glints !== false) {
    ctx.fillStyle = '#ffffff';
    const clusters = Math.max(1, Math.floor((w * h) / 60));
    for (let c = 0; c < clusters; c++) {
      const gh = _tileHash(seed + c * 9001, 0, 0);
      const gx = 1 + (gh & 0xff) % Math.max(1, w - 2);
      const gy = 1 + ((gh >>> 8) & 0xff) % Math.max(1, h - 2);
      ctx.fillRect(x + gx, y + gy, 1, 1);
      // Adjacent half-bright satellites for the cluster sparkle.
      const off = (gh >>> 16) & 3;
      const sx = gx + (off & 1 ? 1 : -1);
      const sy = gy + (off & 2 ? 1 : -1);
      if (sx > 0 && sx < w - 1 && sy > 0 && sy < h - 1) {
        ctx.fillRect(x + sx, y + sy, 1, 1);
      }
    }
  }
}

// Concrete — rough granular surface with embedded aggregates and
// chip damage. Rewritten to vary speckle density across the rect
// (real concrete has uneven roughness, not uniform noise) and add
// small angular chip marks. Pebbles are larger and asymmetric so
// they read as embedded aggregate.
//   palette: { shadow, body, hilite, pebble? }
//   opts:    { seed, pebbles=true, chips=true }
export function concrete(ctx, x, y, w, h, palette, opts = {}) {
  const seed = _matSeed(opts.seed, x, y);
  // Body.
  ctx.fillStyle = palette.body;
  ctx.fillRect(x, y, w, h);
  // Two roughness zones — split the rect by a wandering boundary so
  // half is rougher than the other. Reads as "two slightly different
  // pours" or "weathering varies." Pure-uniform speckle was too
  // mechanical-looking.
  const zoneSplit = Math.floor(h * 0.5) + ((seed >>> 4) & 1);
  for (let dy = 0; dy < h; dy++) {
    const wobble = ((_tileHash(seed + 17, dy, 0) & 1) - 0.5) * 2;
    const isRough = dy + wobble > zoneSplit;
    const darkChance = isRough ? 3 : 1;       // out of ~11
    const liteChance = isRough ? 1 : 1;
    for (let dx = 0; dx < w; dx++) {
      if ((_tileHash(seed, dx, dy) % 11) < darkChance) {
        ctx.fillStyle = palette.shadow;
        ctx.fillRect(x + dx, y + dy, 1, 1);
      } else if ((_tileHash(seed + 211, dx, dy) % 23) < liteChance) {
        ctx.fillStyle = palette.hilite;
        ctx.fillRect(x + dx, y + dy, 1, 1);
      }
    }
  }
  // Embedded pebbles — bigger than the speckle, irregular shape.
  if (opts.pebbles !== false && Math.min(w, h) >= 5) {
    const pebbleCol = palette.pebble || palette.shadow;
    const count = Math.max(1, Math.floor((w * h) / 36));
    for (let i = 0; i < count; i++) {
      const ph = _tileHash(seed + 4001, i, 0);
      const px = (ph & 0xff) % Math.max(1, w - 2);
      const py = ((ph >>> 8) & 0xff) % Math.max(1, h - 2);
      const shape = (ph >>> 16) & 3;
      ctx.fillStyle = pebbleCol;
      // Four 3-pixel pebble shapes, picked from a hash bit.
      if (shape === 0) {
        ctx.fillRect(x + px, y + py, 2, 1);
        ctx.fillRect(x + px, y + py + 1, 1, 1);
      } else if (shape === 1) {
        ctx.fillRect(x + px, y + py, 1, 2);
        ctx.fillRect(x + px + 1, y + py, 1, 1);
      } else if (shape === 2) {
        ctx.fillRect(x + px, y + py, 2, 1);
        ctx.fillRect(x + px + 1, y + py + 1, 1, 1);
      } else {
        ctx.fillRect(x + px, y + py + 1, 2, 1);
        ctx.fillRect(x + px + 1, y + py, 1, 1);
      }
      // Top-edge highlight on the pebble.
      ctx.fillStyle = palette.hilite;
      ctx.fillRect(x + px, y + py, 1, 1);
    }
  }
  // Chip marks — small angular triangles where concrete chipped off,
  // showing the dark interior. 0-2 per call.
  if (opts.chips !== false && Math.min(w, h) >= 6) {
    const chips = (seed >>> 8) & 1 ? 1 : 2;
    ctx.fillStyle = palette.shadow;
    for (let c = 0; c < chips; c++) {
      const ch = _tileHash(seed + c * 6151, 0, 0);
      const cx = 1 + (ch & 0xff) % Math.max(1, w - 3);
      const cy = 1 + ((ch >>> 8) & 0xff) % Math.max(1, h - 3);
      // Triangle of 3 pixels.
      ctx.fillRect(x + cx,     y + cy,     1, 1);
      ctx.fillRect(x + cx + 1, y + cy,     1, 1);
      ctx.fillRect(x + cx,     y + cy + 1, 1, 1);
    }
  }
  // Dither bottom-edge shadow line.
  ctx.fillStyle = palette.shadow;
  for (let dx = 0; dx < w; dx++) {
    if ((dx & 1) === 0) ctx.fillRect(x + dx, y + h - 1, 1, 1);
  }
}

// ─── 4c. Decay overlays ────────────────────────────────────────────
// Composable on top of any base material. Don't fill the rect — just
// stamp scattered pixels in the decay color so the underlying texture
// shows through. Use globalAlpha or composite mode if you want the
// decay to multiply the base instead of replacing pixels.

// Rust — orange-brown patchy decay. Generates 2-N corrosion *centers*
// (edge-biased — water pools at edges and dripped streaks) then fills
// irregular blobs around each, with darker pitting at the core fading
// to lighter color at the rim. Reads as actual oxidation patches, not
// salt-and-pepper noise.
//   opts: { seed, intensity=0.5, color='#a04018', dark='#3a1808',
//           rim='#c08040'?, streaks=true }
//
// Recipe used internally:
//   1. Pick N=`3 + intensity*5` patch centers, weighted toward edges.
//   2. Each patch has a hash-derived radius (~2-5px) and irregular
//      shape via per-pixel distance + jitter threshold.
//   3. Inside the patch: pitting ring (dark) at radius < r*0.4,
//      body (color) at r*0.4..0.85, rim (light orange) at the edge.
//   4. Optionally drip streaks: 1-3px tall vertical extension below
//      a patch, simulating water-runoff staining.
export function rust(ctx, x, y, w, h, opts = {}) {
  const seed = _matSeed(opts.seed, x, y);
  const intensity = opts.intensity != null ? opts.intensity : 0.5;
  const color = opts.color || '#a04018';
  const dark  = opts.dark  || '#3a1808';
  const rim   = opts.rim   || '#c06030';
  const drawStreaks = opts.streaks !== false;
  // Patch count scales with intensity; each patch covers ~10-30px area.
  const patches = Math.max(2, Math.round(3 + intensity * 5));
  for (let p = 0; p < patches; p++) {
    const ph = _tileHash(seed + p * 9173, 0, 0);
    // Edge-biased center: bias toward x/y near 0 or w-1/h-1.
    const edgeBias = (ph & 1) ? 0 : 1;       // 0 = edge, 1 = anywhere
    let cx, cy;
    if (edgeBias === 0) {
      // Pick which edge.
      const side = (ph >>> 1) & 3;
      if (side === 0) { cx = ((ph >>> 8) & 0xff) % w; cy = (((ph >>> 16) & 7)); }
      else if (side === 1) { cx = w - 1 - ((ph >>> 16) & 7); cy = ((ph >>> 8) & 0xff) % h; }
      else if (side === 2) { cx = ((ph >>> 8) & 0xff) % w; cy = h - 1 - ((ph >>> 16) & 7); }
      else { cx = ((ph >>> 16) & 7); cy = ((ph >>> 8) & 0xff) % h; }
    } else {
      cx = ((ph >>> 8) & 0xff) % w;
      cy = ((ph >>> 16) & 0xff) % h;
    }
    const r = 2 + ((ph >>> 24) & 3);          // 2..5 px patch radius
    // Irregular blob: per-pixel jittered distance threshold.
    for (let dy = -r - 1; dy <= r + 1; dy++) {
      for (let dx = -r - 1; dx <= r + 1; dx++) {
        const px = cx + dx, py = cy + dy;
        if (px < 0 || px >= w || py < 0 || py >= h) continue;
        const d = Math.sqrt(dx * dx + dy * dy);
        // Jitter the effective radius per pixel to break the circle.
        const jitter = ((_tileHash(seed + p * 313, dx, dy) & 0xff) / 0xff) * 1.4 - 0.7;
        const dEff = d + jitter;
        if (dEff > r) continue;
        // Color zones: dark pitting → body → rim.
        const t = dEff / r;
        if      (t < 0.35) ctx.fillStyle = dark;
        else if (t < 0.85) ctx.fillStyle = color;
        else               ctx.fillStyle = rim;
        ctx.fillRect(x + px, y + py, 1, 1);
      }
    }
    // Drip streak — vertical column below the patch on some patches.
    if (drawStreaks && ((ph >>> 28) & 1)) {
      const dripLen = 1 + ((ph >>> 29) & 3);
      ctx.fillStyle = dark;
      for (let s = 1; s <= dripLen; s++) {
        const py = cy + r + s;
        if (py >= h) break;
        ctx.fillRect(x + cx, y + py, 1, 1);
        // Sometimes the streak is 2px wide.
        if (s === 1 && cx + 1 < w) ctx.fillRect(x + cx + 1, y + py, 1, 1);
      }
    }
  }
}

// Moss — green organic growth, clumpy and bottom-biased. Generates
// patch centers along the bottom edge (gravity + moisture pooling),
// fills irregular blobs around each, then adds 1-2px tuft "spikes"
// growing UP from the top of each clump. Reads as creeping organic
// growth instead of green pixel scatter.
//   opts: { seed, density=0.35, base='#3a6028', mid='#5a8030',
//           tip='#80c040', tufts=true }
//
// Recipe:
//   1. Patch count scales with density. Centers concentrate along the
//      bottom 60% of the rect, with X spread roughly evenly.
//   2. Each clump has a radius 2-4 plus per-pixel jitter for irregular
//      edge. Color zones: base (deep green) at center, mid at body,
//      tip (bright green) at the rim.
//   3. Tufts: 1-2 single-pixel "blades" growing from the top edge of
//      each clump in the bright tip color — the visual cue that says
//      "this is moss, not paint splatter."
export function moss(ctx, x, y, w, h, opts = {}) {
  const seed = _matSeed(opts.seed, x, y);
  const density = opts.density != null ? opts.density : 0.35;
  const base = opts.base || '#3a6028';
  const mid  = opts.mid  || '#5a8030';
  const tip  = opts.tip  || '#80c040';
  const drawTufts = opts.tufts !== false;
  // Clump count: density × area / (avg clump area). 1 clump ~10px²,
  // so density 0.35 over 24×24 → ~20 clumps.
  const clumps = Math.max(1, Math.round(density * (w * h) / 12));
  for (let p = 0; p < clumps; p++) {
    const ph = _tileHash(seed + p * 7919, 0, 0);
    // Bottom-bias: pick y in [h*0.3, h-1], heavier toward h-1.
    const yRand = ((ph >>> 8) & 0xff) / 0xff;
    const cy = Math.floor(h * 0.3 + yRand * yRand * (h * 0.7 - 1));
    const cx = (ph & 0xff) % w;
    // Side-edges also get clumps regardless of y (vines climbing).
    const sideClump = ((ph >>> 16) & 7) === 0;
    const cxFinal = sideClump
      ? (((ph >>> 17) & 1) ? ((ph >>> 18) & 3) : w - 1 - ((ph >>> 18) & 3))
      : cx;
    const r = 1 + ((ph >>> 20) & 2);          // 1..3 px clump radius
    // Irregular blob.
    for (let dy = -r - 1; dy <= r + 1; dy++) {
      for (let dx = -r - 1; dx <= r + 1; dx++) {
        const px = cxFinal + dx, py = cy + dy;
        if (px < 0 || px >= w || py < 0 || py >= h) continue;
        const d = Math.sqrt(dx * dx + dy * dy);
        const jitter = ((_tileHash(seed + p * 211, dx, dy) & 0xff) / 0xff) * 1.2 - 0.6;
        const dEff = d + jitter;
        if (dEff > r) continue;
        const t = dEff / r;
        if      (t < 0.4) ctx.fillStyle = base;
        else if (t < 0.85) ctx.fillStyle = mid;
        else               ctx.fillStyle = tip;
        ctx.fillRect(x + px, y + py, 1, 1);
      }
    }
    // Tufts — 1-2 blades growing up from the top of the clump.
    if (drawTufts && r >= 2) {
      ctx.fillStyle = tip;
      const tufts = 1 + ((ph >>> 24) & 1);
      for (let t = 0; t < tufts; t++) {
        const tx = cxFinal + ((_tileHash(seed + p * 53, t, 0) & 1) ? -1 : 1);
        const ty = cy - r;
        if (tx >= 0 && tx < w && ty >= 0 && ty < h) {
          ctx.fillRect(x + tx, y + ty, 1, 1);
        }
      }
    }
  }
}

// Single linear crack with optional branch. Bresenham line from
// (x0,y0) to (x1,y1). Useful for damage indicators on glass, ice,
// stone, bone.
//   opts: { color='#1a0a08', branch=true, branchAt=0.5 }
export function crack(ctx, x0, y0, x1, y1, opts = {}) {
  const color = opts.color || '#1a0a08';
  pxLine(ctx, x0, y0, x1, y1, color);
  if (opts.branch !== false) {
    const t = opts.branchAt != null ? opts.branchAt : 0.5;
    const bx = Math.round(x0 + (x1 - x0) * t);
    const by = Math.round(y0 + (y1 - y0) * t);
    const dx = x1 - x0, dy = y1 - y0;
    const len = Math.hypot(dx, dy) || 1;
    const ang = Math.atan2(dy, dx) + (Math.random() < 0.5 ? -0.7 : 0.7);
    const blen = Math.max(2, Math.round(len * 0.4));
    const bx2 = Math.round(bx + Math.cos(ang) * blen);
    const by2 = Math.round(by + Math.sin(ang) * blen);
    pxLine(ctx, bx, by, bx2, by2, color);
  }
}

// Single scratch — thin lighter (or darker) line, slight wobble.
// Best on metal, leather, painted surfaces.
//   opts: { color='#ffffff', alpha=0.5 }
export function scratch(ctx, x0, y0, x1, y1, opts = {}) {
  const hex   = opts.color || '#ffffff';
  const alpha = opts.alpha != null ? opts.alpha : 0.5;
  const r = parseInt(hex.slice(1, 3), 16);
  const g = parseInt(hex.slice(3, 5), 16);
  const b = parseInt(hex.slice(5, 7), 16);
  ctx.fillStyle = `rgba(${r},${g},${b},${alpha.toFixed(3)})`;
  // Bresenham line — thin, no halo. Subtle by design.
  const dx = Math.abs(x1 - x0);
  const dy = Math.abs(y1 - y0);
  const sx = x0 < x1 ? 1 : -1;
  const sy = y0 < y1 ? 1 : -1;
  let err = dx - dy;
  let cx = x0, cy = y0;
  while (true) {
    ctx.fillRect(cx, cy, 1, 1);
    if (cx === x1 && cy === y1) break;
    const e2 = err * 2;
    if (e2 > -dy) { err -= dy; cx += sx; }
    if (e2 < dx)  { err += dx; cy += sy; }
  }
}

// Extreme blood splatter — multi-impact, larger pool, longer streaks,
// and trailing drips. Use for arterial/heavy-trauma scenes. Same call
// shape as bloodSplatter; pass `opts.size` higher for bigger splats.
//   opts: { seed, size=6, color='#a01818', dark='#5a0808',
//           impacts=3, streakLen=6 }
export function bloodSplatterExtreme(ctx, cx, cy, opts = {}) {
  const seed = _matSeed(opts.seed, cx, cy);
  const size = opts.size != null ? opts.size : 6;
  const main = opts.color || '#a01818';
  const dark = opts.dark  || '#5a0808';
  const impacts = opts.impacts != null ? opts.impacts : 3;
  const streakLen = opts.streakLen != null ? opts.streakLen : 6;
  // Multiple impact pools — main one at (cx, cy), others offset.
  for (let p = 0; p < impacts; p++) {
    const ph = _tileHash(seed + p * 4099, 0, 0);
    const offX = p === 0 ? 0 : ((ph & 0xff) / 0xff - 0.5) * size * 2.5 | 0;
    const offY = p === 0 ? 0 : (((ph >>> 8) & 0xff) / 0xff - 0.5) * size * 2.5 | 0;
    const pcx = cx + offX, pcy = cy + offY;
    const r = Math.max(1, size - p * 2);
    // Solid central pool.
    for (let dy = -r; dy <= r; dy++) {
      for (let dx = -r; dx <= r; dx++) {
        const d = Math.sqrt(dx * dx + dy * dy);
        const jitter = ((_tileHash(seed + p * 211, dx, dy) & 0xff) / 0xff) * 1.4 - 0.7;
        if (d + jitter > r) continue;
        const t = d / r;
        ctx.fillStyle = (t < 0.5) ? dark : main;
        ctx.fillRect(pcx + dx, pcy + dy, 1, 1);
      }
    }
    // Long streaks radiating from this impact — 4-8 directions.
    const streaks = 4 + ((ph >>> 16) & 3);
    for (let s = 0; s < streaks; s++) {
      const sh = _tileHash(seed + p * 311 + s * 17, 0, 0);
      const ang = ((sh & 0xff) / 0xff) * Math.PI * 2;
      const len = streakLen + ((sh >>> 8) & 3);
      const wobble = ((sh >>> 12) & 7) / 7 - 0.5;
      for (let i = 1; i <= len; i++) {
        const t = i / len;
        const px = Math.round(pcx + Math.cos(ang) * i + Math.sin(t * Math.PI * 2) * wobble);
        const py = Math.round(pcy + Math.sin(ang) * i + Math.cos(t * Math.PI * 2) * wobble);
        // Streak fades — denser near pool, sparser at tip.
        if (t > 0.3 && (sh >>> (i & 7)) % 5 === 0) continue;
        ctx.fillStyle = t < 0.4 ? main : ((sh >>> i) & 3 === 0 ? dark : main);
        ctx.fillRect(px, py, 1, 1);
      }
      // Terminal droplet at the streak tip.
      const tipX = Math.round(pcx + Math.cos(ang) * (len + 1));
      const tipY = Math.round(pcy + Math.sin(ang) * (len + 1));
      ctx.fillStyle = main;
      ctx.fillRect(tipX, tipY, 1, 1);
    }
    // Drip — vertical streak below the pool with terminal droplet,
    // simulating gravity pull. ~half of impacts get one.
    if (((ph >>> 24) & 1) && p < 2) {
      const dripLen = 2 + ((ph >>> 25) & 3);
      ctx.fillStyle = dark;
      for (let d = 1; d <= dripLen; d++) {
        ctx.fillRect(pcx, pcy + r + d, 1, 1);
      }
      // Bigger drop at the bottom.
      ctx.fillStyle = main;
      ctx.fillRect(pcx, pcy + r + dripLen, 1, 1);
      ctx.fillRect(pcx - 1, pcy + r + dripLen + 1, 1, 1);
      ctx.fillRect(pcx, pcy + r + dripLen + 1, 1, 1);
      ctx.fillRect(pcx + 1, pcy + r + dripLen + 1, 1, 1);
      ctx.fillRect(pcx, pcy + r + dripLen + 2, 1, 1);
    }
  }
  // Scattered droplets — small random dots in the surrounding zone.
  ctx.fillStyle = main;
  const drops = 12 + (size & 7);
  for (let i = 0; i < drops; i++) {
    const dh = _tileHash(seed + 8081, i, 0);
    const ang = ((dh & 0xff) / 0xff) * Math.PI * 2;
    const dist = size * 1.5 + ((dh >>> 8) & 0xff) / 0xff * size * 2;
    const dx = Math.round(Math.cos(ang) * dist);
    const dy = Math.round(Math.sin(ang) * dist);
    ctx.fillStyle = ((dh >>> 16) & 3) === 0 ? dark : main;
    ctx.fillRect(cx + dx, cy + dy, 1, 1);
    // Some droplets are slightly bigger.
    if (((dh >>> 18) & 7) === 0) {
      ctx.fillRect(cx + dx + 1, cy + dy, 1, 1);
    }
  }
}

// Smoke puff — single rising blob shaded as dark/body/hilite zones.
// `t` (0..1) drives both growth and fade — t=0 is small/dark/dense,
// t=1 is big/translucent. Compose multiple puffs at staggered t values
// in a per-frame loop to make a continuous column rising from a chimney.
//   palette: { dark, body, hilite }
//   opts:    { t=0, size=3 }
export function smokePuff(ctx, cx, cy, palette, opts = {}) {
  const t = opts.t != null ? opts.t : 0;
  const baseSize = opts.size != null ? opts.size : 3;
  const size = Math.max(1, baseSize + Math.round(t * 4));
  const alpha = Math.max(0.06, 1 - t * 0.88);
  const dark = palette.dark || '#2a2828';
  const body = palette.body || '#5a5858';
  const hilite = palette.hilite || '#8a8888';
  ctx.save();
  ctx.globalAlpha = alpha;
  for (let dy = -size; dy <= size; dy++) {
    for (let dx = -size; dx <= size; dx++) {
      const d2 = dx * dx + dy * dy;
      if (d2 > size * size) continue;
      // Soft jitter so the silhouette isn't a clean circle.
      const dEff = Math.sqrt(d2);
      const tt = dEff / size;
      ctx.fillStyle = tt < 0.4 ? hilite : tt < 0.8 ? body : dark;
      ctx.fillRect(cx + dx, cy + dy, 1, 1);
    }
  }
  ctx.restore();
}

// Darkness overlay — paints a tinted dark layer over the rect with
// optional "holes" at given light source points. Use after rendering
// a scene to add nighttime atmosphere; pass lights for window glow,
// torches, etc.
//   opts: { color='#0a0810', alpha=0.7, lights=[{x, y, r, intensity}] }
//     lights — array of light sources. Each one carves a soft circular
//              hole in the overlay where alpha falls off radially.
export function darknessOverlay(ctx, x, y, w, h, opts = {}) {
  const hex = opts.color || '#0a0810';
  const alpha = opts.alpha != null ? opts.alpha : 0.7;
  const lights = opts.lights || [];
  const r = parseInt(hex.slice(1, 3), 16);
  const g = parseInt(hex.slice(3, 5), 16);
  const b = parseInt(hex.slice(5, 7), 16);
  // Per-pixel — each pixel's alpha = base * (1 - sum-of-light-pulls)
  // clamped to [0, base]. This gives soft round halos where the
  // lights subtract from the darkness.
  for (let dy = 0; dy < h; dy++) {
    for (let dx = 0; dx < w; dx++) {
      const px = x + dx, py = y + dy;
      let pull = 0;
      for (let i = 0; i < lights.length; i++) {
        const L = lights[i];
        const ldx = px - L.x, ldy = py - L.y;
        const d = Math.sqrt(ldx * ldx + ldy * ldy);
        if (d > L.r) continue;
        const inten = L.intensity != null ? L.intensity : 1;
        pull += (1 - d / L.r) * inten;
      }
      const finalA = Math.max(0, alpha * (1 - Math.min(1, pull)));
      if (finalA < 0.02) continue;
      ctx.fillStyle = `rgba(${r},${g},${b},${finalA.toFixed(3)})`;
      ctx.fillRect(px, py, 1, 1);
    }
  }
}

// Blood splatter — central impact blob plus radiating droplets and
// streaks. Random per call unless seeded.
//   opts: { seed, size=4, color='#a01818', dark='#5a0808' }
export function bloodSplatter(ctx, cx, cy, opts = {}) {
  const seed = _matSeed(opts.seed, cx, cy);
  const size = opts.size != null ? opts.size : 4;
  const main = opts.color || '#a01818';
  const dark = opts.dark  || '#5a0808';
  // Central impact blob — small irregular cluster.
  ctx.fillStyle = main;
  ctx.fillRect(cx, cy, 1, 1);
  ctx.fillRect(cx - 1, cy, 1, 1);
  ctx.fillRect(cx + 1, cy, 1, 1);
  ctx.fillRect(cx, cy - 1, 1, 1);
  ctx.fillRect(cx, cy + 1, 1, 1);
  ctx.fillStyle = dark;
  ctx.fillRect(cx, cy, 1, 1);
  // Radial droplets — fewer, smaller, farther out.
  const drops = 6 + (size & 7);
  for (let i = 0; i < drops; i++) {
    const hsh = _tileHash(seed, i, 0);
    const ang = ((hsh & 0xff) / 0xff) * Math.PI * 2;
    const dist = 2 + ((hsh >>> 8) & 0xff) / 0xff * size * 1.5;
    const dx = Math.round(Math.cos(ang) * dist);
    const dy = Math.round(Math.sin(ang) * dist);
    ctx.fillStyle = ((hsh >>> 16) & 1) ? main : dark;
    ctx.fillRect(cx + dx, cy + dy, 1, 1);
    // Some droplets get a small trailing streak back toward center.
    if (((hsh >>> 17) & 3) === 0) {
      const tx = Math.round(cx + Math.cos(ang) * (dist - 1));
      const ty = Math.round(cy + Math.sin(ang) * (dist - 1));
      ctx.fillRect(tx, ty, 1, 1);
    }
  }
}

// ─── 5. Compound shapes ────────────────────────────────────────────

// Gun barrel — receiver + barrel with vent detail and muzzle highlight.
export function gunBarrel(ctx, x, y, h, palette, opts = {}) {
  const recW    = opts.receiverW  != null ? opts.receiverW  : 6;
  const barW    = opts.barrelW    != null ? opts.barrelW    : 4;
  const barDrop = opts.barrelDrop != null ? opts.barrelDrop : 0;
  const barTrim = opts.barrelTrim != null ? opts.barrelTrim : 0;
  // Receiver.
  layeredRect(ctx, x, y, recW, h, palette);
  // Barrel.
  const barX = x + recW;
  const barY = y + barDrop;
  const barH = h - barDrop - barTrim;
  layeredRect(ctx, barX, barY, barW, barH, palette);
  // Joint line — dark seam where barrel meets receiver.
  ctx.fillStyle = palette.shadow;
  ctx.fillRect(barX, barY, 1, barH);
  // Muzzle highlight — bright pixel at the barrel tip.
  if (barW >= 2 && barH >= 2) {
    ctx.fillStyle = palette.hilite;
    ctx.fillRect(barX + barW - 1, barY, 1, 1);
  }
  // Vent hole on receiver — small dark pixel for heat vent.
  if (recW >= 4 && h >= 4) {
    ctx.fillStyle = palette.shadow;
    ctx.fillRect(x + recW - 2, y + Math.floor(h / 2), 1, 1);
  }
}

// Vine spine — path-following core with alternating leaf clusters.
export function vineSpine(ctx, path, palette, opts = {}) {
  const leafEvery = opts.leafEvery != null ? opts.leafEvery : 4;
  const fixedSide = opts.leafSide;
  // Spine — core + shadow beneath + highlight above for 3D volume.
  for (let i = 0; i < path.length; i++) {
    const p = path[i];
    const px = Math.round(p.x), py = Math.round(p.y);
    if (palette.shadow) {
      ctx.fillStyle = palette.shadow;
      ctx.fillRect(px, py + 1, 1, 1);
    }
    ctx.fillStyle = palette.core;
    ctx.fillRect(px, py, 1, 1);
    if (palette.hilite) {
      ctx.fillStyle = palette.hilite;
      ctx.fillRect(px, py - 1, 1, 1);
    }
  }
  // Leaves — alternating sides, with 2-px leaf cluster per site.
  for (let i = 1; i < path.length - 1; i += leafEvery) {
    const p = path[i];
    const next = path[i + 1] || p;
    const dx = next.x - p.x, dy = next.y - p.y;
    const len = Math.max(0.0001, Math.hypot(dx, dy));
    const tx = -dy / len, ty = dx / len;
    const side = fixedSide != null ? fixedSide : ((i & 2) ? 1 : -1);
    const lx = Math.round(p.x + tx * side);
    const ly = Math.round(p.y + ty * side);
    // Leaf base + outward highlight for 2-px leaf shape.
    ctx.fillStyle = palette.leaf || palette.core;
    ctx.fillRect(lx, ly, 1, 1);
    ctx.fillRect(lx + (side > 0 ? 1 : -1), ly, 1, 1);
    if (palette.leafHilite) {
      ctx.fillStyle = palette.leafHilite;
      ctx.fillRect(lx + (side > 0 ? 1 : -1), ly - 1, 1, 1);
    }
  }
}

// ─── 5b. Tool components ───────────────────────────────────────────
// Composable pieces for crafted hand tools and weapons. Each piece is
// drawn axis-aligned at a given anchor; the caller composes a full
// tool by stacking pieces (e.g., shaft + axeHead = axe). This is the
// same composition pattern as creatures (softBlob + appendages) but
// for tools.
//
// Convention: the anchor (x, y) is the PIVOT POINT — for heads it's
// the socket where the shaft meets the head; for shafts it's the butt
// end. Direction defaults to up (heads point upward, shafts go down).
// Use ctx.translate / rotate at the call site for non-axis-aligned
// orientations.

// Shaft / handle — straight pole with optional grip wrap segment.
//   palette: { dark, body, hilite, grip? }
//   opts:    { length=12, width=2, gripStart=0, gripEnd=4, gripCol? }
//     gripStart/End — measured from the BUTT end (y direction). 0/0
//                     means no grip wrap. Wrap drawn in `grip` color
//                     (or a dark default), in 1-px-tall horizontal
//                     bands every other row.
export function shaft(ctx, x, y, palette, opts = {}) {
  const len   = opts.length || 12;
  const w     = opts.width  || 2;
  const gripS = opts.gripStart || 0;
  const gripE = opts.gripEnd   || 0;
  const gripCol = opts.gripCol || palette.grip || '#3a2010';
  // Pole — vertical bar with shading.
  for (let dy = 0; dy < len; dy++) {
    ctx.fillStyle = palette.body;
    ctx.fillRect(x, y - dy, w, 1);
    // Left highlight, right shadow.
    ctx.fillStyle = palette.hilite;
    ctx.fillRect(x, y - dy, 1, 1);
    if (w >= 3) {
      ctx.fillStyle = palette.dark;
      ctx.fillRect(x + w - 1, y - dy, 1, 1);
    }
  }
  // Grip wrap — horizontal stripes in grip color over part of the shaft.
  if (gripE > gripS) {
    ctx.fillStyle = gripCol;
    for (let dy = gripS; dy < gripE && dy < len; dy++) {
      if ((dy & 1) === 0) ctx.fillRect(x, y - dy, w, 1);
      else                ctx.fillRect(x, y - dy, w, 1);
    }
    // Subtle stitching line at top of grip.
    if (gripE < len) {
      ctx.fillStyle = palette.hilite;
      ctx.fillRect(x, y - gripE, w, 1);
    }
  }
}

// Pickaxe head — double-pointed metal piece, pointing left + right
// with a central socket where the shaft meets it.
//   palette: { dark, body, hilite }
//   opts:    { width=11, height=4 }
//     width — total horizontal span (point to point, must be odd-ish)
//     height — vertical thickness at the socket
export function pickaxeHead(ctx, x, y, palette, opts = {}) {
  const w = opts.width  || 11;
  const h = opts.height || 4;
  const half = (w - 1) >> 1;
  // Tapered body — widest at center, narrowing to a point at each end.
  for (let dx = -half; dx <= half; dx++) {
    const t = Math.abs(dx) / half;
    const hh = Math.max(1, Math.round(h * (1 - t * 0.85)));
    const yTop = y - Math.floor(hh / 2);
    for (let dy = 0; dy < hh; dy++) {
      ctx.fillStyle = palette.body;
      ctx.fillRect(x + dx, yTop + dy, 1, 1);
    }
    // Top highlight strip.
    ctx.fillStyle = palette.hilite;
    ctx.fillRect(x + dx, yTop, 1, 1);
    // Bottom shadow.
    ctx.fillStyle = palette.dark;
    ctx.fillRect(x + dx, yTop + hh - 1, 1, 1);
  }
  // Tip pixels — extra-bright single dots at each end.
  ctx.fillStyle = palette.hilite;
  ctx.fillRect(x - half, y, 1, 1);
  ctx.fillRect(x + half, y, 1, 1);
  // Central socket — slightly darker band where shaft attaches.
  ctx.fillStyle = palette.dark;
  ctx.fillRect(x - 1, y - 1, 3, 1);
}

// Shovel head — flat scoop with rounded bottom edge, shaft socket
// at top center.
//   palette: { dark, body, hilite }
//   opts:    { width=7, height=8 }
export function shovelHead(ctx, x, y, palette, opts = {}) {
  const w = opts.width  || 7;
  const h = opts.height || 8;
  const half = (w - 1) >> 1;
  // Trapezoid body — slightly narrower at top, full width below
  // socket band, rounded bottom corners.
  for (let dy = 0; dy < h; dy++) {
    const t = dy / Math.max(1, h - 1);
    // Width tapers slightly at top and bottom.
    const sideTrim = (dy === 0 || dy === h - 1) ? 1 : 0;
    const halfRow = half - sideTrim;
    for (let dx = -halfRow; dx <= halfRow; dx++) {
      ctx.fillStyle = palette.body;
      ctx.fillRect(x + dx, y + dy, 1, 1);
    }
    // Right-side shadow column.
    ctx.fillStyle = palette.dark;
    ctx.fillRect(x + halfRow, y + dy, 1, 1);
    // Left-side highlight column.
    ctx.fillStyle = palette.hilite;
    ctx.fillRect(x - halfRow, y + dy, 1, 1);
  }
  // Top "socket" band — darker, where shaft attaches.
  ctx.fillStyle = palette.dark;
  ctx.fillRect(x - 1, y, 3, 1);
  // Bottom edge — bright "wear line" suggesting the dig surface.
  ctx.fillStyle = palette.hilite;
  ctx.fillRect(x - half + 1, y + h - 1, w - 2, 1);
}

// Axe head — wedge blade with sharp leading edge and a small back
// counterweight. Anchor is the socket center.
//   palette: { dark, body, hilite, edge? }
//   opts:    { length=8, height=6, side='right' }
//     side — which way the blade faces ('left' or 'right')
export function axeHead(ctx, x, y, palette, opts = {}) {
  const len = opts.length || 8;
  const h   = opts.height || 6;
  const side = opts.side === 'left' ? -1 : 1;
  const edgeCol = palette.edge || palette.hilite;
  // Wedge body — width tapers from full at the back to a point at
  // the leading edge.
  for (let dx = 0; dx < len; dx++) {
    const t = dx / Math.max(1, len - 1);
    const hh = Math.max(1, Math.round(h * (1 - t * 0.6)));
    const yTop = y - Math.floor(hh / 2);
    for (let dy = 0; dy < hh; dy++) {
      ctx.fillStyle = palette.body;
      ctx.fillRect(x + dx * side, yTop + dy, 1, 1);
    }
    // Top + bottom rim.
    ctx.fillStyle = palette.hilite;
    ctx.fillRect(x + dx * side, yTop, 1, 1);
    ctx.fillStyle = palette.dark;
    ctx.fillRect(x + dx * side, yTop + hh - 1, 1, 1);
  }
  // Leading edge — bright "sharpened" line at the wide end.
  ctx.fillStyle = edgeCol;
  ctx.fillRect(x + (len - 1) * side, y - 1, 1, 3);
  // Back counterweight — single dark stub on the opposite side of socket.
  ctx.fillStyle = palette.dark;
  ctx.fillRect(x - side, y - 1, 1, 3);
}

// Hammer head — rectangular metal block. Anchor is socket center.
//   palette: { dark, body, hilite }
//   opts:    { width=8, height=4, twin=false }
//     twin — if true, draws two heads (one each side of socket) for
//            a dual-faced hammer
export function hammerHead(ctx, x, y, palette, opts = {}) {
  const w = opts.width  || 8;
  const h = opts.height || 4;
  const twin = !!opts.twin;
  const halfW = (w - 1) >> 1;
  const halfH = (h - 1) >> 1;
  if (twin) {
    // Two blocks straddling the socket.
    const blockW = Math.floor(w / 2 - 1);
    bevelRect(ctx, x - halfW, y - halfH, blockW, h, palette);
    bevelRect(ctx, x + halfW - blockW + 1, y - halfH, blockW, h, palette);
    // Socket spacer.
    ctx.fillStyle = palette.dark;
    ctx.fillRect(x - 1, y - halfH, 3, h);
  } else {
    bevelRect(ctx, x - halfW, y - halfH, w, h, palette);
    // Bright striking face on the right.
    ctx.fillStyle = palette.hilite;
    ctx.fillRect(x + halfW, y - halfH + 1, 1, h - 2);
  }
}

// Sword blade — long pointed blade tapering to a tip. Anchor is the
// blade root (where it meets the hilt). Default points up.
//   palette: { dark, body, hilite, edge? }
//   opts:    { length=14, width=3, fuller=true, dir='up' }
//     fuller — central 1px groove (the canonical sword "blood groove")
//     dir    — 'up' (default), 'down', 'left', 'right'
export function swordBlade(ctx, x, y, palette, opts = {}) {
  const len = opts.length || 14;
  const w   = opts.width  || 3;
  const fuller = opts.fuller !== false;
  const dir = opts.dir || 'up';
  const edgeCol = palette.edge || palette.hilite;
  const half = (w - 1) >> 1;
  // Build the blade as a straight bar that tapers in the last 25%
  // toward a single-pixel tip. Coordinate system: walk distance d from
  // root (0) to tip (len-1).
  for (let d = 0; d < len; d++) {
    const t = d / Math.max(1, len - 1);
    const taper = t < 0.75 ? w : Math.max(1, Math.round(w * (1 - (t - 0.75) * 4)));
    const taperHalf = (taper - 1) >> 1;
    for (let off = -taperHalf; off <= taperHalf; off++) {
      let px, py;
      if (dir === 'up')        { px = x + off; py = y - d; }
      else if (dir === 'down') { px = x + off; py = y + d; }
      else if (dir === 'left') { px = x - d; py = y + off; }
      else                     { px = x + d; py = y + off; }
      // Color zones across the blade's width: edges are bright (sharpened),
      // center is body, fuller (if enabled) is darker.
      const isEdge = Math.abs(off) === taperHalf;
      const isFuller = fuller && taper >= 3 && off === 0;
      ctx.fillStyle = isEdge ? edgeCol
                     : isFuller ? palette.dark
                     :            palette.body;
      ctx.fillRect(px, py, 1, 1);
    }
  }
  // Bright tip pixel.
  ctx.fillStyle = '#ffffff';
  if (dir === 'up')        ctx.fillRect(x, y - len + 1, 1, 1);
  else if (dir === 'down') ctx.fillRect(x, y + len - 1, 1, 1);
  else if (dir === 'left') ctx.fillRect(x - len + 1, y, 1, 1);
  else                     ctx.fillRect(x + len - 1, y, 1, 1);
}

// Sword hilt — guard (crossbar) + grip + pommel. Anchor is where the
// blade root meets the hilt (the top of the guard).
//   palette: { dark, body, hilite, grip?, pommel? }
//   opts:    { guardWidth=7, guardHeight=2, gripLen=4, pommelR=2 }
export function swordHilt(ctx, x, y, palette, opts = {}) {
  const gW = opts.guardWidth  || 7;
  const gH = opts.guardHeight || 2;
  const gripLen = opts.gripLen || 4;
  const pomR = opts.pommelR || 2;
  const halfG = (gW - 1) >> 1;
  // Guard / crossbar.
  bevelRect(ctx, x - halfG, y, gW, gH, palette);
  // Grip shaft below guard — narrower than guard, in grip color.
  const gripCol = opts.gripCol || palette.grip || '#3a2010';
  const gripW = Math.max(1, Math.floor(gW / 3));
  const gripHalf = (gripW - 1) >> 1;
  ctx.fillStyle = gripCol;
  ctx.fillRect(x - gripHalf, y + gH, gripW, gripLen);
  // Wrap stripes on the grip.
  ctx.fillStyle = palette.dark;
  for (let dy = 0; dy < gripLen; dy += 2) {
    ctx.fillRect(x - gripHalf, y + gH + dy, gripW, 1);
  }
  // Pommel — round disc at the bottom of the grip.
  const pommelCol = opts.pommelCol || palette.pommel || palette.body;
  const pomCx = x;
  const pomCy = y + gH + gripLen + pomR;
  for (let dy = -pomR; dy <= pomR; dy++) {
    for (let dx = -pomR; dx <= pomR; dx++) {
      const d2 = dx * dx + dy * dy;
      if (d2 > pomR * pomR + 1) continue;
      const isEdge = d2 > (pomR - 1) * (pomR - 1);
      ctx.fillStyle = isEdge ? palette.dark : pommelCol;
      ctx.fillRect(pomCx + dx, pomCy + dy, 1, 1);
    }
  }
  // Pommel highlight.
  ctx.fillStyle = palette.hilite;
  ctx.fillRect(pomCx - 1, pomCy - 1, 1, 1);
}

// Spear tip — leaf/diamond shaped point with central spine. Anchor is
// the socket where shaft meets tip (the wide end of the leaf shape).
//   palette: { dark, body, hilite, edge? }
//   opts:    { length=8, width=4, dir='up' }
export function spearTip(ctx, x, y, palette, opts = {}) {
  const len = opts.length || 8;
  const w   = opts.width  || 4;
  const dir = opts.dir || 'up';
  const edgeCol = palette.edge || palette.hilite;
  const halfW = (w - 1) >> 1;
  // Leaf shape — taper at both ends, widest at 30%.
  for (let d = 0; d < len; d++) {
    const t = d / Math.max(1, len - 1);
    let widthFrac;
    if (t < 0.3) widthFrac = t / 0.3;                  // grow
    else         widthFrac = 1 - (t - 0.3) / 0.7;     // taper
    const ww = Math.max(1, Math.round(w * widthFrac));
    const halfThis = (ww - 1) >> 1;
    for (let off = -halfThis; off <= halfThis; off++) {
      let px, py;
      if (dir === 'up')        { px = x + off; py = y - d; }
      else if (dir === 'down') { px = x + off; py = y + d; }
      else if (dir === 'left') { px = x - d; py = y + off; }
      else                     { px = x + d; py = y + off; }
      const isEdge = Math.abs(off) === halfThis;
      const isSpine = off === 0 && ww >= 3;
      ctx.fillStyle = isEdge ? edgeCol
                     : isSpine ? palette.hilite
                     :           palette.body;
      ctx.fillRect(px, py, 1, 1);
    }
  }
  // Bright tip.
  ctx.fillStyle = '#ffffff';
  if (dir === 'up')        ctx.fillRect(x, y - len + 1, 1, 1);
  else if (dir === 'down') ctx.fillRect(x, y + len - 1, 1, 1);
  else if (dir === 'left') ctx.fillRect(x - len + 1, y, 1, 1);
  else                     ctx.fillRect(x + len - 1, y, 1, 1);
}

// Mace head — spiked iron ball. Anchor is the socket center.
//   palette: { dark, body, hilite, spike? }
//   opts:    { radius=3, spikes=8 }
export function maceHead(ctx, x, y, palette, opts = {}) {
  const r = opts.radius || 3;
  const spikes = opts.spikes || 8;
  const spikeCol = palette.spike || palette.hilite;
  // Solid iron sphere.
  for (let dy = -r; dy <= r; dy++) {
    for (let dx = -r; dx <= r; dx++) {
      const d2 = dx * dx + dy * dy;
      if (d2 > r * r + 1) continue;
      const isEdge = d2 > (r - 1) * (r - 1);
      ctx.fillStyle = isEdge ? palette.dark : palette.body;
      ctx.fillRect(x + dx, y + dy, 1, 1);
    }
  }
  // Top-left highlight pixel for the iron sheen.
  ctx.fillStyle = palette.hilite;
  ctx.fillRect(x - 1, y - 1, 1, 1);
  // Radial spikes — single bright pixels protruding 2 steps outward.
  ctx.fillStyle = spikeCol;
  for (let i = 0; i < spikes; i++) {
    const ang = (i / spikes) * Math.PI * 2;
    const sx = Math.round(Math.cos(ang) * (r + 2));
    const sy = Math.round(Math.sin(ang) * (r + 2));
    ctx.fillRect(x + sx, y + sy, 1, 1);
    // Mid-spike pixel for the connecting "shaft."
    const mx = Math.round(Math.cos(ang) * (r + 1));
    const my = Math.round(Math.sin(ang) * (r + 1));
    ctx.fillStyle = palette.body;
    ctx.fillRect(x + mx, y + my, 1, 1);
    ctx.fillStyle = spikeCol;
  }
}

// Pommel — round metal end-cap. Useful as a standalone or compose
// onto a shaft for blunt staves / hammers.
//   palette: { dark, body, hilite }
//   opts:    { radius=2 }
export function pommel(ctx, x, y, palette, opts = {}) {
  const r = opts.radius || 2;
  for (let dy = -r; dy <= r; dy++) {
    for (let dx = -r; dx <= r; dx++) {
      const d2 = dx * dx + dy * dy;
      if (d2 > r * r + 1) continue;
      const isEdge = d2 > (r - 1) * (r - 1);
      ctx.fillStyle = isEdge ? palette.dark : palette.body;
      ctx.fillRect(x + dx, y + dy, 1, 1);
    }
  }
  ctx.fillStyle = palette.hilite;
  ctx.fillRect(x - 1, y - 1, 1, 1);
}

// ─── 5c. VFX primitives ────────────────────────────────────────────
// Animated effects parameterized by `opts.t` ∈ [0, 1) — caller drives
// the time via `(performance.now() / cycleMs) % 1` (loops) or via a
// per-instance "elapsed / lifetime" for one-shots. Each primitive is
// pure ctx draws — no internal state — so multiple instances coexist
// trivially: spawn an array of `{ x, y, t, born, ... }` objects, tick
// `t = (now - born) / lifetime`, blit each via the primitive.

// Spark burst — radial dot-and-trail explosion. N sparks fly outward
// from origin at varied angles + speeds. t=0 sparks at center, t=1
// sparks at max distance and faded. Use for impacts, item-pickup
// flashes, magic cast effects.
//   palette: { core, trail }
//   opts:    { t=0, seed, count=12, range=14 }
export function sparkBurst(ctx, cx, cy, palette, opts = {}) {
  const t = opts.t != null ? opts.t : 0;
  const seed = opts.seed != null ? opts.seed : 0;
  const count = opts.count != null ? opts.count : 12;
  const range = opts.range != null ? opts.range : 14;
  const core  = palette.core  || '#ffe080';
  const trail = palette.trail || '#ff8030';
  const fadeAlpha = Math.max(0.05, 1 - t * 0.85);
  ctx.save();
  ctx.globalAlpha = fadeAlpha;
  for (let i = 0; i < count; i++) {
    const h = _tileHash(seed + i * 41, 0, 0);
    // Each spark gets a slightly jittered angle + speed so the burst
    // doesn't read as a clean N-ray pattern.
    const ang = (i / count) * Math.PI * 2 + ((h & 0xff) / 0xff - 0.5) * 0.7;
    const speed = 0.7 + ((h >>> 8) & 0xff) / 0xff * 0.6;
    const dist = t * range * speed;
    const px = Math.round(cx + Math.cos(ang) * dist);
    const py = Math.round(cy + Math.sin(ang) * dist);
    // Trail — single pixel one step back along the spark's direction.
    if (dist > 1) {
      ctx.fillStyle = trail;
      ctx.fillRect(
        Math.round(cx + Math.cos(ang) * (dist - 1.5)),
        Math.round(cy + Math.sin(ang) * (dist - 1.5)),
        1, 1
      );
    }
    ctx.fillStyle = core;
    ctx.fillRect(px, py, 1, 1);
  }
  ctx.restore();
}

// Fire — flickering flame shape. Continuous animation: `t` is a phase
// 0..1 that loops, NOT a life parameter. Wider/taller flames pass a
// larger `size`. The flame body is a tapered tongue with color zones
// from outer red → mid orange → hot yellow → white-hot core.
//
// Smoothness fix: the previous implementation hashed `Math.floor(t*100)`
// per-frame, which produced a global y-jitter flicker (whole flame
// jumping up 1 pixel between frames). New version uses smooth per-row
// width modulation tied to position + phase, so each row breathes
// independently and there's no whole-flame snap.
//
//   palette: { outer, body, hot, core }
//   opts:    { t=0, size=6, seed, wobble=true }
export function fire(ctx, cx, cy, palette, opts = {}) {
  const t = opts.t != null ? opts.t : 0;
  const size = opts.size != null ? opts.size : 6;
  const seed = opts.seed != null ? opts.seed : 0;
  const wobble = opts.wobble !== false;
  const outer = palette.outer || '#a01818';
  const body  = palette.body  || '#ff5028';
  const hot   = palette.hot   || '#ffd060';
  const core  = palette.core  || '#fff8c0';
  const flameH = Math.round(size * 1.6);
  // Smooth phase-driven sway — no abrupt frame-to-frame snaps.
  const wb1 = wobble ? Math.sin(t * Math.PI * 2 + seed) * 0.8 : 0;
  const wb2 = wobble ? Math.sin(t * Math.PI * 2 * 1.7 + seed * 2) * 1.2 : 0;
  for (let dy = 0; dy < flameH; dy++) {
    const fromBase = dy / flameH;
    const sway = wb1 * fromBase + wb2 * fromBase * fromBase;
    // Per-row width breath — sin of (phase + row offset). Each row
    // independently widens/narrows, but smoothly across frames since
    // phase advances continuously. No global flicker.
    const widthMod = Math.sin(t * Math.PI * 4 + dy * 0.7 + seed * 0.5) * 0.4;
    const wHalf = Math.max(1, Math.round(size * (1 - fromBase * 0.85) + widthMod));
    for (let dx = -wHalf; dx <= wHalf; dx++) {
      const xPx = Math.round(cx + dx + sway);
      const yPx = cy - dy;
      const distFromCenter = Math.abs(dx) / wHalf;
      const colorT = distFromCenter * 0.55 + fromBase * 0.45;
      ctx.fillStyle = colorT < 0.25 ? core
                     : colorT < 0.5  ? hot
                     : colorT < 0.85 ? body
                     :                  outer;
      ctx.fillRect(xPx, yPx, 1, 1);
    }
  }
  // Embers drifting up — 1-2 bright pixels above tip. Slower bin
  // (`floor(t*8)` not `t*12`) so embers don't strobe.
  const embers = 2;
  for (let i = 0; i < embers; i++) {
    const eh = _tileHash(seed + i * 313 + Math.floor(t * 8), 0, 0);
    if ((eh >>> 16) & 1) continue;
    const ex = Math.round(cx + ((eh & 7) - 3) + wb2);
    const ey = Math.round(cy - flameH - 1 - ((eh >>> 4) & 3));
    ctx.fillStyle = (eh & 1) ? core : hot;
    ctx.fillRect(ex, ey, 1, 1);
  }
}

// ── Fire family ───────────────────────────────────────────────────────
// `fire` (above) is a wide CAMPFIRE blaze (half-width ≈ size, height ≈
// 1.6·size) — wrong for a torch. For thin licking flames compose from
// `flameTongue`. All share `fire`'s conventions: ctx-first, palette
// { outer, body, hot, core }, opts { t, size, seed }, 1px pixel-snapped,
// `_tileHash` for non-strobing flicker.
const _FLAME_DEF = { outer:'#7a2f10', body:'#e8731f', hot:'#ffc24a', core:'#fff2c0' };

// Internal: one slim tapered flame, base-centred at (cx,cy), growing
// up. h=height px, w0=base half-width px, `lean`=steady x offset (wall
// torches), `swayAmp` scales the idle flicker.
function _slimFlame(ctx, cx, cy, h, w0, t, seed, pal, lean, swayAmp) {
  const TAU = Math.PI * 2;
  const wb1 = Math.sin(t * TAU       + seed)     * 0.7 * swayAmp;
  const wb2 = Math.sin(t * TAU * 1.7 + seed * 2) * 1.0 * swayAmp;
  for (let dy = 0; dy < h; dy++) {
    const fromBase = dy / h;
    const taper = Math.pow(1 - fromBase, 0.7);
    const breath = Math.sin(t * TAU * 3 + dy * 0.9 + seed * 0.5) * 0.35;
    let wHalf = Math.round(w0 * taper + breath * (1 - fromBase));
    if (wHalf < 0) wHalf = 0;
    const sway = lean * fromBase + wb1 * fromBase + wb2 * fromBase * fromBase;
    for (let dx = -wHalf; dx <= wHalf; dx++) {
      const d = wHalf > 0 ? Math.abs(dx) / wHalf : 0;
      const ct = d * 0.6 + fromBase * 0.4;
      ctx.fillStyle = ct < 0.28 ? pal.core : ct < 0.55 ? pal.hot
                    : ct < 0.85 ? pal.body : pal.outer;
      ctx.fillRect(Math.round(cx + dx + sway), cy - dy, 1, 1);
    }
  }
  ctx.fillStyle = pal.core;
  ctx.fillRect(Math.round(cx + wb1 * 0.5), cy - Math.max(1, (h * 0.3) | 0), 1, 1);
  const eh = _tileHash(seed + Math.floor(t * 7), 0, 0);
  if (!((eh >>> 16) & 1)) {
    ctx.fillStyle = (eh & 1) ? pal.core : pal.hot;
    ctx.fillRect(Math.round(cx + ((eh & 3) - 1) + wb2), cy - h - 1 - ((eh >> 3) & 2), 1, 1);
  }
}

// Optional soft warm halo. Subtle by design; pass opts.glow=false when
// a real TileLighting light already covers the source (e.g. the town).
function _glow(ctx, cx, cy, r, color) {
  ctx.save();
  ctx.globalCompositeOperation = 'lighter';
  for (let k = 3; k >= 1; k--) {
    ctx.globalAlpha = 0.05 + 0.05 * (3 - k);
    ctx.fillStyle = color;
    ctx.beginPath();
    ctx.arc(cx, cy, (r * k) / 3, 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.restore();
}

// Slim licking flame — the atom. Base-centred at (cx,cy). Much thinner
// and more pointed than `fire`; use for any small flame.
//   palette: { outer, body, hot, core }
//   opts:    { t=0, size=4, seed=0, lean=0, sway=1 }
export function flameTongue(ctx, cx, cy, palette = {}, opts = {}) {
  const p = { ..._FLAME_DEF, ...palette };
  const size = opts.size != null ? opts.size : 4;
  _slimFlame(ctx, cx, cy,
    Math.max(3, Math.round(size * 2.4)),
    Math.max(1, Math.round(size * 0.55)),
    opts.t || 0, opts.seed || 0, p,
    opts.lean || 0, opts.sway != null ? opts.sway : 1);
}

// Torch — wood handle + soaked binding + charred head + flame + glow.
// (x,y) = top of the handle / flame base, so it drops in where `fire`
// was mis-used for wall torches but reads slim.
//   palette: { outer, body, hot, core, wood?, woodDark? }
//   opts:    { t=0, size=4, seed=0, len=11, lean=0, glow=true }
export function torch(ctx, x, y, palette = {}, opts = {}) {
  const p = { ..._FLAME_DEF, ...palette };
  const wood = palette.wood || '#5a3c20';
  const woodDk = palette.woodDark || '#2c1c10';
  const size = opts.size != null ? opts.size : 4;
  const len  = opts.len  != null ? opts.len  : 11;
  ctx.fillStyle = woodDk; ctx.fillRect(x - 1, y, 2, len);
  ctx.fillStyle = wood;   ctx.fillRect(x,     y, 1, len);
  ctx.fillStyle = '#241a12'; ctx.fillRect(x - 1, y - 1, 3, 2);   // binding
  ctx.fillStyle = '#120c08'; ctx.fillRect(x - 1, y - 3, 3, 2);   // charred head
  if (opts.glow !== false) _glow(ctx, x, y - size, size * 2.4, p.hot);
  flameTongue(ctx, x, y - 3, p, { t: opts.t, size, seed: opts.seed, lean: opts.lean || 0 });
}

// Candle — wax stub + a tiny teardrop flame + faint glow + a drip.
//   palette: { outer, body, hot, core, wax? }
//   opts:    { t=0, seed=0, h=8, glow=true }
export function candle(ctx, cx, cy, palette = {}, opts = {}) {
  const p = { ..._FLAME_DEF, ...palette };
  const wax = palette.wax || '#e8e0c8';
  const h = opts.h != null ? opts.h : 8;
  ctx.fillStyle = '#b8b098'; ctx.fillRect(cx - 2, cy - h, 4, h);
  ctx.fillStyle = wax;       ctx.fillRect(cx - 2, cy - h, 1, h);
  ctx.fillStyle = '#fff4d8'; ctx.fillRect(cx - 1, cy - h - 1, 3, 1);
  ctx.fillStyle = '#cabf9e'; ctx.fillRect(cx + 1, cy - h + 2, 1, 4);
  if (opts.glow !== false) _glow(ctx, cx, cy - h - 2, 5, p.hot);
  flameTongue(ctx, cx, cy - h - 1, p, { t: opts.t, size: 1.6, seed: opts.seed, sway: 0.6 });
}

// Pulsing coal/ember bed — no tall flame. Dim base with brighter coals
// that breathe with t (deterministic per-coal phase).
//   palette: { coalDim?, coal?, coalHot?, ash? }
//   opts:    { t=0, size=5, seed=0 }
export function emberGlow(ctx, cx, cy, palette = {}, opts = {}) {
  const dim = palette.coalDim || '#601808';
  const mid = palette.coal    || '#c23010';
  const hot = palette.coalHot || '#ff7a20';
  const ash = palette.ash     || '#2e2622';
  const size = opts.size != null ? opts.size : 5;
  const t = opts.t || 0, seed = opts.seed || 0;
  for (let dx = -size; dx <= size; dx++) {
    const col = Math.abs(dx) / size;
    const top = cy - Math.round((1 - col) * 2);
    for (let dy = 0; dy <= (((1 - col) * 2) | 0); dy++) {
      ctx.fillStyle = ash;
      ctx.fillRect(cx + dx, cy - dy, 1, 1);
    }
    if (col > 0.92) continue;
    const ph = _tileHash(seed, dx + 64, 0) & 1023;
    const beat = 0.5 + 0.5 * Math.sin(t * Math.PI * 2 + ph * 0.0123);
    ctx.fillStyle = beat > 0.72 ? hot : beat > 0.4 ? mid : dim;
    ctx.fillRect(cx + dx, top, 1, 1);
  }
}

// Brazier — metal bowl on legs + a coal bed + 2–3 short flame tongues.
//   palette: { outer, body, hot, core, metal?, metalDark?, ...ember }
//   opts:    { t=0, size=5, seed=0, glow=true }
export function brazier(ctx, cx, cy, palette = {}, opts = {}) {
  const p = { ..._FLAME_DEF, ...palette };
  const metal = palette.metal || '#5a5e68';
  const metalDk = palette.metalDark || '#2e3138';
  const size = opts.size != null ? opts.size : 5;
  const t = opts.t || 0, seed = opts.seed || 0;
  const r = size + 2;
  ctx.fillStyle = metalDk;
  ctx.fillRect(cx - r + 1, cy + 1, 2, 5);
  ctx.fillRect(cx - 1,     cy + 2, 2, 5);
  ctx.fillRect(cx + r - 2, cy + 1, 2, 5);
  for (let yy = 0; yy < 4; yy++) {
    const w = r - yy;
    ctx.fillStyle = yy === 0 ? metal : metalDk;
    ctx.fillRect(cx - w, cy + yy, w * 2, 1);
  }
  ctx.fillStyle = metal; ctx.fillRect(cx - r, cy, r * 2, 1);
  if (opts.glow !== false) _glow(ctx, cx, cy - size, size * 2.6, p.hot);
  emberGlow(ctx, cx, cy - 1, palette, { t, size: size - 1, seed });
  _slimFlame(ctx, cx,            cy - 1, Math.round(size * 1.9), size - 1, t,       seed,     p, -0.4, 1);
  _slimFlame(ctx, cx - size + 2, cy,     Math.round(size * 1.2), size - 3, t * 1.3, seed + 9, p,  0.3, 1.2);
  _slimFlame(ctx, cx + size - 2, cy,     Math.round(size * 1.3), size - 3, t * 0.8, seed + 4, p,  0.5, 1.2);
}

// Campfire — stacked logs + ember bed + the wide `fire` blaze. The
// proper big fire (what `fire` alone should be reserved for).
//   palette: { outer, body, hot, core, wood?, woodDark?, ...ember }
//   opts:    { t=0, size=6, seed=0, glow=true }
export function campfire(ctx, cx, cy, palette = {}, opts = {}) {
  const p = { ..._FLAME_DEF, ...palette };
  const wood = palette.wood || '#5a3c20';
  const woodDk = palette.woodDark || '#2c1c10';
  const size = opts.size != null ? opts.size : 6;
  const t = opts.t || 0, seed = opts.seed || 0;
  for (let i = 0; i < 3; i++) {                       // stacked logs
    const ly = cy + 1 + i, lw = size + 4 - i;
    ctx.fillStyle = woodDk;    ctx.fillRect(cx - lw, ly, lw * 2, 3);
    ctx.fillStyle = wood;      ctx.fillRect(cx - lw, ly, lw * 2, 1);
    ctx.fillStyle = '#3a2614'; ctx.fillRect(cx - lw, ly + 2, lw * 2, 1);
    ctx.fillStyle = '#7a5a30';                         // log-end rings
    ctx.fillRect(cx - lw, ly, 2, 3); ctx.fillRect(cx + lw - 2, ly, 2, 3);
  }
  if (opts.glow !== false) _glow(ctx, cx, cy - size, size * 3, p.hot);
  emberGlow(ctx, cx, cy + 1, palette, { t, size, seed });
  fire(ctx, cx, cy, p, { t, size, seed, wobble: true });
}

// Explosion — expanding bright disc with irregular edge and color
// zones. t=0 invisible, t=0.4 peak brightness/size, t=1 faded out.
// The disc grows fast then fades — non-linear time mapping inside.
//   palette: { outer, body, hot, core }
//   opts:    { t=0, size=10, seed }
export function explosion(ctx, cx, cy, palette, opts = {}) {
  const t = opts.t != null ? opts.t : 0;
  const maxR = opts.size != null ? opts.size : 10;
  const seed = opts.seed != null ? opts.seed : 0;
  // Radius grows fast (sqrt) then plateaus; alpha fades in second half.
  const r = Math.round(Math.sqrt(t) * maxR);
  if (r < 1) return;
  const outer = palette.outer || '#601018';
  const body  = palette.body  || '#ff5028';
  const hot   = palette.hot   || '#ffd060';
  const core  = palette.core  || '#fff8c0';
  // Fade — opaque until t=0.5, then linear fade.
  const fade = t < 0.5 ? 1 : 1 - (t - 0.5) * 2;
  ctx.save();
  ctx.globalAlpha = Math.max(0, fade);
  for (let dy = -r - 1; dy <= r + 1; dy++) {
    for (let dx = -r - 1; dx <= r + 1; dx++) {
      const d = Math.sqrt(dx * dx + dy * dy);
      // Jittered edge for irregular fireball silhouette.
      const jitter = ((_tileHash(seed, dx, dy) & 0xff) / 0xff) * 1.6 - 0.8;
      const dEff = d + jitter;
      if (dEff > r) continue;
      // Color zones — center hot, edge dark. As t grows, the zones
      // shift outward (the explosion "cools" toward the edges first).
      const ringT = dEff / r + t * 0.4;
      ctx.fillStyle = ringT < 0.25 ? core
                     : ringT < 0.55 ? hot
                     : ringT < 0.85 ? body
                     :                 outer;
      ctx.fillRect(cx + dx, cy + dy, 1, 1);
    }
  }
  ctx.restore();
}

// Shockwave — expanding ring outline that fades. Use immediately after
// an explosion or impact to emphasize the force-radius. Works great
// stacked: 2-3 shockwaves at staggered t values give the multi-pulse
// "compounding boom" feel.
//   palette: { color }
//   opts:    { t=0, size=18, thickness=1 }
export function shockwave(ctx, cx, cy, palette, opts = {}) {
  const t = opts.t != null ? opts.t : 0;
  const maxR = opts.size != null ? opts.size : 18;
  const thickness = opts.thickness != null ? opts.thickness : 1;
  const r = Math.round(t * maxR);
  if (r < 1) return;
  const color = palette.color || '#ffe080';
  ctx.save();
  // Fade — full alpha at t=0, gone at t=1.
  ctx.globalAlpha = Math.max(0.05, 1 - t);
  ctx.fillStyle = color;
  const innerR2 = (r - thickness) * (r - thickness);
  const outerR2 = (r + 0.5) * (r + 0.5);
  for (let dy = -r - 1; dy <= r + 1; dy++) {
    for (let dx = -r - 1; dx <= r + 1; dx++) {
      const d2 = dx * dx + dy * dy;
      if (d2 < innerR2 || d2 > outerR2) continue;
      ctx.fillRect(cx + dx, cy + dy, 1, 1);
    }
  }
  ctx.restore();
}

// Debris — chunky 2×2 pixel chunks flying outward with gravity.
// Use after an explosion, wall break, or heavy impact. Each chunk
// follows a parabolic arc (initial radial velocity + downward
// acceleration over t).
//   palette: { colors[] } — array of chunk colors, picked per chunk.
//   opts:    { t=0, seed, count=8, range=14, gravity=0.7 }
export function debris(ctx, cx, cy, palette, opts = {}) {
  const t = opts.t != null ? opts.t : 0;
  const seed = opts.seed != null ? opts.seed : 0;
  const count = opts.count != null ? opts.count : 8;
  const range = opts.range != null ? opts.range : 14;
  const gravity = opts.gravity != null ? opts.gravity : 0.7;
  const colors = palette.colors && palette.colors.length
    ? palette.colors
    : ['#5a3818', '#3a2010', '#7a4828', '#9a6840'];
  ctx.save();
  ctx.globalAlpha = Math.max(0.1, 1 - t * 0.6);
  for (let i = 0; i < count; i++) {
    const h = _tileHash(seed + i * 41, 0, 0);
    const ang = (i / count) * Math.PI * 2 + ((h & 0xff) / 0xff) * 0.6;
    const speed = 0.6 + ((h >>> 8) & 0xff) / 0xff * 0.7;
    const horizDist = t * range * speed;
    // Parabolic — chunks rise/spread, then gravity pulls them down.
    const vertDist  = Math.sin(ang) * horizDist + (t * t) * range * gravity;
    const px = Math.round(cx + Math.cos(ang) * horizDist);
    const py = Math.round(cy + vertDist);
    ctx.fillStyle = colors[(h >>> 16) % colors.length];
    ctx.fillRect(px, py, 2, 2);
  }
  ctx.restore();
}

// Soft shockwave — bright ring at the wave front + translucent disc
// fill behind it. Reads as "energy pulse" rather than the crisp
// `shockwave`'s "ring of force." Use for telekinetic shoves, spell
// nova bursts, or any wave where the pressure radius itself should
// feel "there" rather than just outlined.
//   palette: { color }   default '#ffffff'
//   opts:    { t=0, size=18, fillAlpha=0.18 }
export function shockwaveSoft(ctx, cx, cy, palette, opts = {}) {
  const t = opts.t != null ? opts.t : 0;
  const maxR = opts.size != null ? opts.size : 18;
  const fillAlpha = opts.fillAlpha != null ? opts.fillAlpha : 0.18;
  const r = Math.round(t * maxR);
  if (r < 1) return;
  const color = palette.color || '#ffffff';
  const cR = parseInt(color.slice(1, 3), 16);
  const cG = parseInt(color.slice(3, 5), 16);
  const cB = parseInt(color.slice(5, 7), 16);
  const fade = Math.max(0, 1 - t);
  // 1. Translucent disc fill — softer "energy field" inside the ring.
  ctx.fillStyle = `rgba(${cR},${cG},${cB},${(fade * fillAlpha).toFixed(3)})`;
  for (let dy = -r; dy <= r; dy++) {
    for (let dx = -r; dx <= r; dx++) {
      if (dx * dx + dy * dy > r * r) continue;
      ctx.fillRect(cx + dx, cy + dy, 1, 1);
    }
  }
  // 2. Bright ring at the wave front (1-2 px thick).
  ctx.fillStyle = `rgba(${cR},${cG},${cB},${fade.toFixed(3)})`;
  const innerR2 = (r - 1) * (r - 1);
  const outerR2 = (r + 0.5) * (r + 0.5);
  for (let dy = -r - 1; dy <= r + 1; dy++) {
    for (let dx = -r - 1; dx <= r + 1; dx++) {
      const d2 = dx * dx + dy * dy;
      if (d2 < innerR2 || d2 > outerR2) continue;
      ctx.fillRect(cx + dx, cy + dy, 1, 1);
    }
  }
}

// Lightning — jagged Bresenham bolt with halo and small fork branches.
// `t` is a brief life parameter — bolts flash and vanish quickly.
// Best stacked: spawn 2-3 bolts at staggered phases for sustained
// "electrical arc" feel.
//   palette: { core, halo }
//   opts:    { t=0, seed, segments=6, jitter=3, branches=2 }
export function lightning(ctx, x0, y0, x1, y1, palette, opts = {}) {
  const t = opts.t != null ? opts.t : 0;
  // Lightning is BRIEF — hold full alpha until t=0.3, then snap fade.
  const fade = t < 0.3 ? 1 : Math.max(0, 1 - (t - 0.3) / 0.7);
  if (fade < 0.05) return;
  const seed = opts.seed != null ? opts.seed : 0;
  const segments = opts.segments != null ? opts.segments : 6;
  const jitter = opts.jitter != null ? opts.jitter : 3;
  const branches = opts.branches != null ? opts.branches : 2;
  const core = palette.core || '#ffffff';
  const halo = palette.halo || '#a0c0ff';
  const dx = x1 - x0, dy = y1 - y0;
  const len = Math.hypot(dx, dy) || 1;
  const px = -dy / len, py = dx / len;     // perpendicular
  // Build jagged path.
  const points = [{ x: x0, y: y0 }];
  for (let i = 1; i < segments; i++) {
    const segT = i / segments;
    const baseX = x0 + dx * segT;
    const baseY = y0 + dy * segT;
    const h = _tileHash(seed + i * 41, 0, 0);
    const off = (((h & 0xff) / 0xff) - 0.5) * 2 * jitter;
    points.push({
      x: Math.round(baseX + px * off),
      y: Math.round(baseY + py * off),
    });
  }
  points.push({ x: x1, y: y1 });
  ctx.save();
  ctx.globalAlpha = fade;
  // Halo pass — wider in the halo color (3-pixel-wide path).
  for (let i = 0; i < points.length - 1; i++) {
    const a = points[i], b = points[i + 1];
    pxLine(ctx, a.x, a.y, b.x, b.y, halo);
    pxLine(ctx, a.x + 1, a.y, b.x + 1, b.y, halo);
    pxLine(ctx, a.x, a.y + 1, b.x, b.y + 1, halo);
  }
  // Core pass — bright center line.
  for (let i = 0; i < points.length - 1; i++) {
    pxLine(ctx, points[i].x, points[i].y, points[i + 1].x, points[i + 1].y, core);
  }
  // Forks — small branches off mid-path.
  for (let b = 0; b < branches; b++) {
    const bh = _tileHash(seed + b * 313, 0, 0);
    const startIdx = 1 + (bh & 0xff) % Math.max(1, points.length - 2);
    const baseAng = Math.atan2(dy, dx);
    const branchAng = baseAng + (((bh >>> 8) & 1) ? 0.7 : -0.7);
    const branchLen = 3 + ((bh >>> 16) & 3);
    const sp = points[startIdx];
    const bx = Math.round(sp.x + Math.cos(branchAng) * branchLen);
    const by = Math.round(sp.y + Math.sin(branchAng) * branchLen);
    pxLine(ctx, sp.x, sp.y, bx, by, halo);
    pxLine(ctx, sp.x, sp.y, bx, by, core);
  }
  ctx.restore();
}

// Heal sparkle — gentle upward-floating sparkle pixels with halos.
// Unlike `sparkBurst` (radial impact), these drift upward in a soft
// column. Use for healing, level-up, item-pickup auras. `t` cycles —
// sparkles continuously spawn and fade.
//   palette: { core, halo }
//   opts:    { t=0, seed, count=8 }
//     w, h — bounding rect: sparkles spawn within (x..x+w) and rise
//            from y+h to y.
export function healSparkle(ctx, x, y, w, h, palette, opts = {}) {
  const t = opts.t != null ? opts.t : 0;
  const seed = opts.seed != null ? opts.seed : 0;
  const count = opts.count != null ? opts.count : 8;
  const core = palette.core || '#ffffff';
  const halo = palette.halo || '#80ffa0';
  for (let i = 0; i < count; i++) {
    const ph = _tileHash(seed + i * 313, 0, 0);
    // Each sparkle has its own phase, offset by index so they stagger.
    const myT = (t + (ph & 0xff) / 0xff) % 1;
    if (myT < 0.05) continue;
    const px = x + (ph & 0xff) % w;
    const py = y + h - Math.round(myT * h);
    const alpha = (1 - myT) * 0.95;
    if (alpha < 0.08) continue;
    ctx.save();
    ctx.globalAlpha = alpha;
    ctx.fillStyle = halo;
    ctx.fillRect(px - 1, py, 1, 1);
    ctx.fillRect(px + 1, py, 1, 1);
    ctx.fillRect(px, py - 1, 1, 1);
    ctx.fillRect(px, py + 1, 1, 1);
    ctx.fillStyle = core;
    ctx.fillRect(px, py, 1, 1);
    ctx.restore();
  }
}

// Dust puff — quick brown dust cloud expanding outward + drifting up.
// Use for footstep impacts, landing thuds, hammer strikes. One-shot:
// t=0 dense, t=1 dispersed.
//   palette: { dark, body }
//   opts:    { t=0, seed, range=8 }
export function dustPuff(ctx, cx, cy, palette, opts = {}) {
  const t = opts.t != null ? opts.t : 0;
  const seed = opts.seed != null ? opts.seed : 0;
  const range = opts.range != null ? opts.range : 8;
  const dark = palette.dark || '#5a4828';
  const body = palette.body || '#9a7848';
  ctx.save();
  ctx.globalAlpha = Math.max(0, 1 - t * 1.2);
  // 5 small puff blobs spread in upper hemisphere, rising slightly.
  const puffs = 5;
  for (let i = 0; i < puffs; i++) {
    const ph = _tileHash(seed + i * 211, 0, 0);
    const ang = (i / (puffs - 1)) * Math.PI - Math.PI;     // top half
    const dist = t * range * (0.7 + ((ph & 0xff) / 0xff) * 0.5);
    const px = Math.round(cx + Math.cos(ang) * dist);
    const py = Math.round(cy + Math.sin(ang) * dist - t * 2);
    const r = Math.max(1, 2 - Math.round(t * 2));
    for (let dy = -r; dy <= r; dy++) {
      for (let dx = -r; dx <= r; dx++) {
        const d2 = dx * dx + dy * dy;
        if (d2 > r * r) continue;
        ctx.fillStyle = (d2 > (r - 1) * (r - 1)) ? dark : body;
        ctx.fillRect(px + dx, py + dy, 1, 1);
      }
    }
  }
  ctx.restore();
}

// Slash — fast arc of bright pixels sweeping across `t`. Use for
// sword swings, claw slashes, fast attacks.
//   palette: { color }
//   opts:    { t=0, angle=0, arc=PI*0.6, radius=12, segments=8 }
//     angle — center direction of the slash (radians).
//     arc   — total angular sweep (~PI*0.6 = 108° default).
export function slash(ctx, cx, cy, palette, opts = {}) {
  const t = opts.t != null ? opts.t : 0;
  // Brief — full alpha until t=0.4, then linear fade.
  const fade = t < 0.4 ? 1 : Math.max(0, 1 - (t - 0.4) / 0.6);
  if (fade < 0.05) return;
  const angle = opts.angle != null ? opts.angle : 0;
  const arc = opts.arc != null ? opts.arc : Math.PI * 0.6;
  const radius = opts.radius != null ? opts.radius : 12;
  const segments = opts.segments != null ? opts.segments : 8;
  const color = palette.color || '#ffffff';
  ctx.save();
  ctx.globalAlpha = fade;
  ctx.fillStyle = color;
  // Sweep — current arc-tip position at t. The slash "draws itself in"
  // up to t*2 of the arc, then holds while fading.
  const startAng = angle - arc / 2;
  const sweepT = Math.min(1, t * 2.2);
  for (let s = 0; s <= segments; s++) {
    const segT = s / segments;
    if (segT > sweepT) break;
    const ang = startAng + arc * segT;
    // Width tapers — fattest in middle of arc, thin at ends.
    const widthMul = Math.max(0, 1 - Math.abs(segT - 0.5) * 1.8);
    const r1 = radius * (0.7 - widthMul * 0.1);
    const r2 = radius * (0.7 + widthMul * 0.35);
    pxLine(ctx,
      Math.round(cx + Math.cos(ang) * r1),
      Math.round(cy + Math.sin(ang) * r1),
      Math.round(cx + Math.cos(ang) * r2),
      Math.round(cy + Math.sin(ang) * r2),
      color);
  }
  ctx.restore();
}

// Ripple — concentric expanding rings (water-drop style). Continuous
// loop: rings spawn at center, expand to maxR, fade out, while new
// rings keep spawning behind them.
//   palette: { color }
//   opts:    { t=0, size=14, rings=3 }
export function ripple(ctx, cx, cy, palette, opts = {}) {
  const t = opts.t != null ? opts.t : 0;
  const maxR = opts.size != null ? opts.size : 14;
  const rings = opts.rings != null ? opts.rings : 3;
  const color = palette.color || '#a0d8ff';
  const cR = parseInt(color.slice(1, 3), 16);
  const cG = parseInt(color.slice(3, 5), 16);
  const cB = parseInt(color.slice(5, 7), 16);
  for (let ring = 0; ring < rings; ring++) {
    // Each ring is offset by 1/rings so they stagger.
    const ringT = (t + ring / rings) % 1;
    const r = Math.round(ringT * maxR);
    if (r < 1) continue;
    const fade = Math.max(0, 1 - ringT);
    if (fade < 0.05) continue;
    ctx.fillStyle = `rgba(${cR},${cG},${cB},${fade.toFixed(3)})`;
    const innerR2 = (r - 1) * (r - 1);
    const outerR2 = (r + 0.5) * (r + 0.5);
    for (let dy = -r - 1; dy <= r + 1; dy++) {
      for (let dx = -r - 1; dx <= r + 1; dx++) {
        const d2 = dx * dx + dy * dy;
        if (d2 < innerR2 || d2 > outerR2) continue;
        ctx.fillRect(cx + dx, cy + dy, 1, 1);
      }
    }
  }
}

// ─── 5d. Volumetric fog cloud ──────────────────────────────────────
//
// `fogCloud` — a thick, internally-textured cumulus body that reads
// like real volumetric fog rather than a flat gradient. Designed to
// match the Graveyard-Keeper / Stardew-Valley fog look: many small
// dense LUMPS clustered inside a soft outer body, so where multiple
// clouds overlap you get near-opaque patches and where they thin you
// get clear visibility. Internal lumps drift slowly with `t` so the
// cloud breathes without distractingly fast motion.
//
// ── Why not just a single radial gradient? ───────────────────────────
// A single radial gradient looks like a SPRAYED CIRCLE — uniform,
// even, mechanical. Real fog has texture: pockets of dense vapor
// pierced by thinner channels. The reference images in the project
// brief show this clearly — clouds are puffy, lumpy, asymmetric. Two
// nested gradients (outer body + N inner lumps) match that look at
// ~10× the visual quality for ~3× the per-cloud cost (still cheap
// enough to render dozens per frame).
//
// ── Composition ──────────────────────────────────────────────────────
// 1. Outer body — large radial gradient defining the silhouette.
//    Soft alpha at the edge so the cloud blends seamlessly into the
//    background or neighbouring clouds.
// 2. Internal lumps — N smaller radial-gradient discs at offset
//    positions around the center. Each has its own dense core and
//    soft halo. The aggregate is a puffy cumulus shape with visible
//    "lobes" rather than a smooth bell.
// 3. Optional dense core — a tiny VERY DENSE circle at the very
//    middle for the thickest patch. Use when `opts.coreDensity > 0`.
//
// ── Performance notes ────────────────────────────────────────────────
// Each cloud is 1 outer gradient + N lumps + optional core =
// (1 + N + 0|1) `fill()` calls. With default `lumps: 9`, a single
// cloud is 10 fills. Eight clouds (typical fog scene) = 80 fills per
// frame, which on integrated GPU is sub-millisecond. If you need
// more clouds, drop `lumps` to 5-6 — the look degrades gracefully
// (less internal texture, still thick and puffy).
//
// ── Animation ────────────────────────────────────────────────────────
// `t` is a free-running time scalar (seconds, typically). Internal
// lumps rotate slowly around the cloud center proportional to t,
// creating subtle "the fog is alive" motion. Multiply outside by
// 0.05-0.1 for natural drift speed. Don't pass `t` (or pass 0) for
// a static cloud.
//
// ── Color contract ───────────────────────────────────────────────────
// `color` is an RGB triple as a STRING like `'120, 180, 80'` —
// matches the inline rgba() pattern. NOT a hex string. This avoids
// per-call parsing inside the inner loop. The function appends the
// alpha component.
//
// ── Usage ────────────────────────────────────────────────────────────
//   import { fogCloud } from '../engine/pixelart.js';
//
//   // Sewer miasma — toxic green
//   fogCloud(ctx, 200, 150, {
//     radius: 180, density: 0.55,
//     color: '110, 165, 75',
//     seed: i * 7, t: now * 0.05,
//   });
//
//   // Cemetery dust — warm sepia
//   fogCloud(ctx, 400, 280, {
//     radius: 220, density: 0.65,
//     color: '210, 195, 165',
//     seed: i * 13, t: now * 0.04,
//   });
//
//   // For wide coverage, place multiple overlapping clouds at
//   // different positions/sizes/seeds:
//   for (let i = 0; i < 8; i++) {
//     const cx = areaX + (i / 8) * areaW + drift;
//     const cy = areaY + Math.sin(now * 0.03 + i) * 40;
//     fogCloud(ctx, cx, cy, { radius: 180 + (i % 3) * 30, ... });
//   }
//
//   opts: {
//     radius=80,         outer body radius (px)
//     density=0.5,       0..1 alpha at the thickest part
//     color='180,200,160', RGB triplet as string (no alpha)
//     seed=0,            deterministic shape variation
//     lumps=9,           internal lumps (6-12 is the sweet spot)
//     t=0,               time for slow drift
//     coreDensity=0,     0 = no dense core; >0 = extra-dense center
//   }
export function fogCloud(ctx, cx, cy, opts = {}) {
  const radius      = opts.radius      != null ? opts.radius      : 80;
  const density     = opts.density     != null ? opts.density     : 0.5;
  const color       = opts.color       || '180, 200, 160';
  const seed        = opts.seed        != null ? opts.seed        : 0;
  const lumps       = opts.lumps       != null ? opts.lumps       : 9;
  const t           = opts.t           != null ? opts.t           : 0;
  const coreDensity = opts.coreDensity != null ? opts.coreDensity : 0;

  // (1) Outer body — large soft gradient defining the silhouette.
  //     Inner stop at density*0.55 (not full density) so the lumps
  //     drawn on top can still pop denser regions.
  const outer = ctx.createRadialGradient(cx, cy, 0, cx, cy, radius);
  outer.addColorStop(0.00, `rgba(${color}, ${density * 0.55})`);
  outer.addColorStop(0.55, `rgba(${color}, ${density * 0.35})`);
  outer.addColorStop(0.85, `rgba(${color}, ${density * 0.10})`);
  outer.addColorStop(1.00, `rgba(${color}, 0)`);
  ctx.fillStyle = outer;
  ctx.beginPath();
  ctx.arc(cx, cy, radius, 0, Math.PI * 2);
  ctx.fill();

  // (2) Internal lumps — N smaller dense discs distributed around
  //     the cloud body. The dispatch radius (how far from center)
  //     and lump radius are both modulated by deterministic hash
  //     functions of (seed, i), so each cloud has a unique but
  //     stable shape. `t` rotates the whole lump field slowly,
  //     giving the cloud subtle internal motion.
  //
  //     Trig spread: distributing lumps in 2π / lumps angular slots
  //     guarantees full coverage of the cloud body. Random radial
  //     offset stops the result looking like a perfect ring of
  //     blobs.
  for (let i = 0; i < lumps; i++) {
    const hash    = ((seed * 73 + i * 41) | 0);
    const radHash = ((seed * 31 + i * 53) | 0);
    const sizHash = ((seed * 17 + i * 67) | 0);
    const angle   = (i / lumps) * Math.PI * 2 + (hash % 7) * 0.09 + t * 0.05;
    const dist    = radius * (0.20 + 0.50 * ((radHash % 11) / 11));
    const lr      = radius * (0.28 + 0.16 * ((sizHash % 7) / 7));
    const lx      = cx + Math.cos(angle) * dist;
    const ly      = cy + Math.sin(angle) * dist;
    const lDens   = density * (0.75 + 0.18 * ((hash % 5) / 5));

    const lumpGrad = ctx.createRadialGradient(lx, ly, 0, lx, ly, lr);
    lumpGrad.addColorStop(0.00, `rgba(${color}, ${lDens})`);
    lumpGrad.addColorStop(0.45, `rgba(${color}, ${lDens * 0.55})`);
    lumpGrad.addColorStop(0.85, `rgba(${color}, ${lDens * 0.15})`);
    lumpGrad.addColorStop(1.00, `rgba(${color}, 0)`);
    ctx.fillStyle = lumpGrad;
    ctx.beginPath();
    ctx.arc(lx, ly, lr, 0, Math.PI * 2);
    ctx.fill();
  }

  // (3) Optional dense core — for the thickest fog patches where
  //     the user wants near-opacity at the very center. Caller
  //     opts in via `coreDensity` (typically 0.7-0.9). Small radius
  //     (~25% of body) so it reads as "the heart of the cloud."
  if (coreDensity > 0) {
    const coreR = radius * 0.25;
    const coreGrad = ctx.createRadialGradient(cx, cy, 0, cx, cy, coreR);
    coreGrad.addColorStop(0.00, `rgba(${color}, ${coreDensity})`);
    coreGrad.addColorStop(0.50, `rgba(${color}, ${coreDensity * 0.5})`);
    coreGrad.addColorStop(1.00, `rgba(${color}, 0)`);
    ctx.fillStyle = coreGrad;
    ctx.beginPath();
    ctx.arc(cx, cy, coreR, 0, Math.PI * 2);
    ctx.fill();
  }
}

// ─── 6. Bilateral symmetry ─────────────────────────────────────────
// Run a draw fn on the LEFT half of a sprite and auto-mirror it to
// the right. The locker uses this so the sprite is centered and the
// drawer only thinks about one half.
//
// drawFn(lctx, halfWidth, height) is invoked with the standard ctx
// API; bilateral allocates a temp canvas, draws, then mirror-blits.
export function bilateral(ctx, w, h, drawFn) {
  const half = Math.floor(w / 2);
  // Stamp the left half directly.
  drawFn(ctx, half, h);
  // Mirror via getImageData/putImageData on the same canvas. We can't
  // use ctx.scale(-1, 1) + drawImage because ctx might be an arbitrary
  // 2D context (not necessarily a canvas reachable via ctx.canvas in
  // every embedding). getImageData is universal.
  if (typeof ctx.getImageData !== 'function') return;
  const img = ctx.getImageData(0, 0, half, h);
  const out = ctx.createImageData(half, h);
  for (let yy = 0; yy < h; yy++) {
    for (let xx = 0; xx < half; xx++) {
      const src = (yy * half + xx) * 4;
      const dst = (yy * half + (half - 1 - xx)) * 4;
      out.data[dst    ] = img.data[src    ];
      out.data[dst + 1] = img.data[src + 1];
      out.data[dst + 2] = img.data[src + 2];
      out.data[dst + 3] = img.data[src + 3];
    }
  }
  ctx.putImageData(out, half, 0);
}

// ─── 7. Outline post-pass ─────────────────────────────────────────
// 1-pixel border of `color` around all opaque pixels. Goes INTO the
// transparent area only — never overwrites existing sprite pixels.
// The same trick the tool autobake uses to give every icon a
// consistent crisp pixel-art border.
export function outlinePass(canvas, color = '#0a0e16') {
  const ctx = canvas.getContext('2d');
  const w = canvas.width, h = canvas.height;
  if (w === 0 || h === 0) return;
  const src = ctx.getImageData(0, 0, w, h);
  const dst = ctx.createImageData(w, h);
  const srcData = src.data;
  const dstData = dst.data;
  dstData.set(srcData);
  const cr = parseInt(color.slice(1, 3), 16);
  const cg = parseInt(color.slice(3, 5), 16);
  const cb = parseInt(color.slice(5, 7), 16);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const i = (y * w + x) * 4;
      if (srcData[i + 3] !== 0) continue;
      let touch = false;
      if (x > 0     && srcData[(y * w + x - 1) * 4 + 3] > 0) touch = true;
      if (!touch && x < w - 1 && srcData[(y * w + x + 1) * 4 + 3] > 0) touch = true;
      if (!touch && y > 0     && srcData[((y - 1) * w + x) * 4 + 3] > 0) touch = true;
      if (!touch && y < h - 1 && srcData[((y + 1) * w + x) * 4 + 3] > 0) touch = true;
      if (touch) {
        dstData[i] = cr;
        dstData[i + 1] = cg;
        dstData[i + 2] = cb;
        dstData[i + 3] = 255;
      }
    }
  }
  ctx.putImageData(dst, 0, 0);
}

// SSAO post-pass — screen-space ambient occlusion. For each non-
// transparent pixel, samples N neighbors in a circle of `radius`. The
// fraction that ARE transparent (or out-of-bounds) maps to occlusion:
// pixels near edges get darkened, interior pixels stay bright. Reads
// as soft inner shadow at all sprite edges — adds depth to flat
// 2-tone shapes without redrawing.
//
// Mutates the canvas in place; bake-friendly. Run AFTER `outlinePass`
// (so the outline doesn't get AO'd into mush) — `makeBakedSprite`'s
// `ssao: true` opt does this automatically in the right order.
//
//   opts: { radius=2, samples=8, alpha=0.5, color='#000000',
//           skipAlpha=null }
//     skipAlpha — if set, pixels with alpha < this value are treated
//                 as transparent for the neighbor check. Useful when
//                 you have a translucent sprite (glass) that shouldn't
//                 be AO'd at its translucent regions.
export function ssaoPass(canvas, opts = {}) {
  const radius  = opts.radius  != null ? opts.radius  : 2;
  const samples = opts.samples != null ? opts.samples : 8;
  const alpha   = opts.alpha   != null ? opts.alpha   : 0.5;
  const skipA   = opts.skipAlpha != null ? opts.skipAlpha : 0;
  const w = canvas.width, h = canvas.height;
  if (w === 0 || h === 0) return;
  const ctx = canvas.getContext('2d');
  const src = ctx.getImageData(0, 0, w, h);
  const dst = ctx.createImageData(w, h);
  const sd = src.data, dd = dst.data;
  dd.set(sd);
  // Pre-compute integer-rounded sample offsets at the given radius.
  // Using a fixed ring of samples is cheaper than per-pixel random.
  const offsets = [];
  for (let i = 0; i < samples; i++) {
    const ang = (i / samples) * Math.PI * 2;
    offsets.push([
      Math.round(Math.cos(ang) * radius),
      Math.round(Math.sin(ang) * radius),
    ]);
  }
  // Tint color (multiplied with the existing pixel rather than
  // additive — AO darkens, doesn't tint hue).
  const cr = parseInt((opts.color || '#000000').slice(1, 3), 16) / 255;
  const cg = parseInt((opts.color || '#000000').slice(3, 5), 16) / 255;
  const cb = parseInt((opts.color || '#000000').slice(5, 7), 16) / 255;
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const i = (y * w + x) * 4;
      if (sd[i + 3] <= skipA) continue;
      // Count transparent / OOB neighbors.
      let trans = 0;
      for (let s = 0; s < offsets.length; s++) {
        const nx = x + offsets[s][0];
        const ny = y + offsets[s][1];
        if (nx < 0 || nx >= w || ny < 0 || ny >= h) {
          trans++;
          continue;
        }
        if (sd[(ny * w + nx) * 4 + 3] <= skipA) trans++;
      }
      if (trans === 0) continue;
      const occlude = (trans / samples) * alpha;
      if (occlude < 0.01) continue;
      // Multiplicative darken — interpolate each channel toward AO color.
      dd[i]     = sd[i]     * (1 - occlude) + cr * 255 * occlude;
      dd[i + 1] = sd[i + 1] * (1 - occlude) + cg * 255 * occlude;
      dd[i + 2] = sd[i + 2] * (1 - occlude) + cb * 255 * occlude;
    }
  }
  ctx.putImageData(dst, 0, 0);
}

// Directional AO post-pass — like `ssaoPass` but only counts neighbors
// in a directional cone. Use to bake fake-3D top-shading: pass
// `dir = -PI/2` (up) to darken pixels that have transparent neighbors
// ABOVE them, faking "this is the bottom-of-an-overhang." Pairs nicely
// with regular ssaoPass for layered depth.
//
//   opts: { radius=2, samples=5, alpha=0.5, dir=-PI/2, fov=PI/2,
//           color='#000000' }
//     dir — angle in radians. Up=-PI/2, down=PI/2, right=0, left=PI.
//     fov — total cone width in radians. PI/2 = 90° wedge.
export function directionalAOPass(canvas, opts = {}) {
  const radius  = opts.radius  != null ? opts.radius  : 2;
  const samples = opts.samples != null ? opts.samples : 5;
  const alpha   = opts.alpha   != null ? opts.alpha   : 0.5;
  const dir     = opts.dir     != null ? opts.dir     : -Math.PI / 2;
  const fov     = opts.fov     != null ? opts.fov     : Math.PI / 2;
  const w = canvas.width, h = canvas.height;
  if (w === 0 || h === 0) return;
  const ctx = canvas.getContext('2d');
  const src = ctx.getImageData(0, 0, w, h);
  const dst = ctx.createImageData(w, h);
  const sd = src.data, dd = dst.data;
  dd.set(sd);
  // Sample offsets within the cone.
  const offsets = [];
  for (let i = 0; i < samples; i++) {
    const a = dir + (i / (samples - 1) - 0.5) * fov;
    offsets.push([
      Math.round(Math.cos(a) * radius),
      Math.round(Math.sin(a) * radius),
    ]);
  }
  const cr = parseInt((opts.color || '#000000').slice(1, 3), 16) / 255;
  const cg = parseInt((opts.color || '#000000').slice(3, 5), 16) / 255;
  const cb = parseInt((opts.color || '#000000').slice(5, 7), 16) / 255;
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const i = (y * w + x) * 4;
      if (sd[i + 3] === 0) continue;
      let trans = 0;
      for (let s = 0; s < offsets.length; s++) {
        const nx = x + offsets[s][0];
        const ny = y + offsets[s][1];
        if (nx < 0 || nx >= w || ny < 0 || ny >= h) {
          trans++;
          continue;
        }
        if (sd[(ny * w + nx) * 4 + 3] === 0) trans++;
      }
      if (trans === 0) continue;
      const occlude = (trans / samples) * alpha;
      if (occlude < 0.01) continue;
      dd[i]     = sd[i]     * (1 - occlude) + cr * 255 * occlude;
      dd[i + 1] = sd[i + 1] * (1 - occlude) + cg * 255 * occlude;
      dd[i + 2] = sd[i + 2] * (1 - occlude) + cb * 255 * occlude;
    }
  }
  ctx.putImageData(dst, 0, 0);
}

// ─── 8. Bake-and-cache helper ─────────────────────────────────────
// Wrap a per-sprite drawer so the first call paints the pixels onto
// an internal canvas and every subsequent call is a single drawImage.
// Adds an automatic 1-px outline post-pass — same pattern the tool
// autobake uses, packaged for any drawer.
//
//   drawFn(ctx)   — draws at integer coords (0, 0) on a w×h canvas.
//   opts.size     — sprite dimensions, default 16×16
//   opts.outline  — outline color, default '#0a0e16'. Pass null to skip.
//
// Returns a function `(targetCtx, x, y) => void` that blits the cached
// sprite. Cache is one-per-call-of-makeBakedSprite; for atlas-style
// caching, hold the returned function in a Map keyed by your own id.
// makeBakedSprite — bake-once, blit-forever sprite cache.
//
// Two modes:
//
//   STATIC (default): omit `frames`. drawFn signature is `(ctx)`. The
//   sprite bakes once on first blit. Per-frame cost is one drawImage.
//   Returned function: `blit(ctx, x, y)`.
//
//   ANIMATED: pass `frames: N`. drawFn signature is `(ctx, t)` where
//   `t` is in [0, 1). All N frames bake side-by-side into a single
//   strip canvas at construction (well, on first blit). At call time,
//   pick a frame index from the caller-supplied `time` parameter and
//   blit that sub-rect. Per-frame cost is still one drawImage — the
//   strip is one texture, blits are sub-rect reads.
//   Returned function: `blit(ctx, x, y, time)` where `time` is treated
//   modulo 1 so callers can pass `(performance.now() / cycleMs) % 1`
//   or anything in seconds — both work.
//
// The strip layout (one wide canvas with N frames in a row) is the
// classic spritesheet trick. All N frames share the outline pass so
// the outline color is consistent across the animation.
//
// Pixel art note: the drawer is responsible for snapping its
// per-frame interpolations to integer pixels. Tween a center point
// with `Math.round(cx + Math.sin(t * TAU) * 2)` rather than letting
// the canvas anti-alias — otherwise frames look "fuzzy" against
// adjacent ones.
//
//   const slime = makeBakedSprite((ctx, t) => {
//     const wobble = Math.round(Math.sin(t * Math.PI * 2) * 1);
//     softBlob(ctx, 16, 16 + wobble, 9, 6, slimePal);
//     ...
//   }, { size: 32, frames: 8 });
//
//   // per frame:
//   slime(ctx, x, y, (performance.now() / 1000) % 1);
// Three modes:
//
//   STATIC:    omit both frames and rows. drawFn is `(ctx)`.
//              blit:  `(ctx, x, y)`
//
//   ANIMATED:  pass `frames: N`. drawFn is `(ctx, t)` with t ∈ [0,1).
//              blit:  `(ctx, x, y, time)` — time normalized via mod 1.
//
//   GRID:      pass `frames: N, rows: R`. drawFn is `(ctx, t, rowIdx)`.
//              blit:  `(ctx, x, y, time, rowIdx)`. The strip is laid
//              out as N frames wide × R rows tall — one row per
//              direction (4-way, 8-way) or per state ('walk', 'run',
//              'idle' as parallel strips). `rows` has no upper limit.
//
// The returned blit fn exposes `_frames` and `_rows` so external
// systems (Animator) can pick valid (idx, rowIdx) without re-parsing
// opts.
// makeBakedSprite — bakes a drawer into a sprite-sheet canvas.
//
// `opts.pins` — declares attachment points (head, rightHand, holster,
// etc.) on the sprite. Accepts either:
//   • A `createPinSet`-style spec object (`{ static, pin, frames, rows }`)
//   • A pre-built pin set returned from `createPinSet(...)`
// The returned blit fn carries the pin set as `.pins` and exposes
// shortcut methods `.pinAt(name, frameIdx, rowIdx)` /
// `.resolvePin(name, frameIdx, rowIdx, drawX, drawY)`. Code that
// mounts onto the sprite (held weapon, helmet, particle emitter)
// looks up the location via the sprite instead of carrying its own
// per-direction offset table.
export function makeBakedSprite(drawFn, opts = {}) {
  const w = opts.w || opts.size || 16;
  const h = opts.h || opts.size || 16;
  const frames = Math.max(0, opts.frames | 0);
  const rows   = Math.max(1, opts.rows   | 0 || 1);
  const outlineColor = opts.outline === null ? null
                     : (opts.outline || '#0a0e16');
  // SSAO bake — when truthy, runs ssaoPass after the drawer (and
  // after outlinePass). Pass `true` for default settings or an opts
  // object passed through to ssaoPass: `{ radius, samples, alpha }`.
  const ssaoOpts = opts.ssao;
  // Directional AO bake — adds a top-shadow gradient by AO-ing only
  // pixels with transparent neighbors above. Same shape as `ssao`.
  const dirAOOpts = opts.directionalAO;
  let baked = null;
  // Internal helper: apply post-passes in correct order. Outline FIRST
  // (so outline pixels exist for AO to occlude against), then SSAO/
  // directional AO on the result.
  function applyPostPasses(c) {
    if (outlineColor) outlinePass(c, outlineColor);
    if (ssaoOpts) {
      const o = (typeof ssaoOpts === 'object') ? ssaoOpts : {};
      ssaoPass(c, o);
    }
    if (dirAOOpts) {
      const o = (typeof dirAOOpts === 'object') ? dirAOOpts : {};
      directionalAOPass(c, o);
    }
  }
  if (frames === 0) {
    const blit = function (targetCtx, x, y) {
      if (!baked) {
        baked = document.createElement('canvas');
        baked.width = w; baked.height = h;
        const sctx = baked.getContext('2d');
        sctx.imageSmoothingEnabled = false;
        drawFn(sctx);
        applyPostPasses(baked);
      }
      targetCtx.drawImage(baked, x, y);
    };
    blit._frames = 0;
    blit._rows = 1;
    blit._w = w; blit._h = h;
    _attachPins(blit, opts.pins);
    return blit;
  }
  // Animated / grid path.
  const blit = function (targetCtx, x, y, time, rowIdx) {
    if (!baked) {
      baked = document.createElement('canvas');
      baked.width = w * frames; baked.height = h * rows;
      const sctx = baked.getContext('2d');
      sctx.imageSmoothingEnabled = false;
      for (let r = 0; r < rows; r++) {
        for (let i = 0; i < frames; i++) {
          sctx.save();
          sctx.translate(i * w, r * h);
          sctx.beginPath();
          sctx.rect(0, 0, w, h);
          sctx.clip();
          drawFn(sctx, i / frames, r);
          sctx.restore();
        }
      }
      applyPostPasses(baked);
    }
    const t = time != null ? time - Math.floor(time) : 0;
    const idx = Math.min(frames - 1, (t * frames) | 0);
    const r   = Math.min(rows - 1, Math.max(0, rowIdx | 0));
    targetCtx.drawImage(baked,
      idx * w, r * h, w, h,
      x, y, w, h);
  };
  blit._frames = frames;
  blit._rows = rows;
  blit._w = w; blit._h = h;
  _attachPins(blit, opts.pins);
  return blit;
}

// Internal — attach a pin set to the bake fn. Accepts a pre-built
// PinSet (object with `.get` and `.resolve` methods, as returned
// from `createPinSet` in engine/sprite-pins.js). Pixelart.js
// deliberately doesn't import sprite-pins.js to stay dependency-
// free; callers who want pins import sprite-pins themselves and
// pass the built set in.
function _attachPins(blit, pinSet) {
  if (!pinSet || typeof pinSet.get !== 'function') return;
  blit.pins = pinSet;
  blit.pinAt = (name, frameIdx, rowIdx) =>
    pinSet.get(name, frameIdx, rowIdx);
  blit.resolvePin = (name, frameIdx, rowIdx, dx, dy) =>
    pinSet.resolve(name, frameIdx, rowIdx, dx, dy);
}

// ─── 8b. HUD primitives ───────────────────────────────────────────
// In-game UI — bars, text, icons, indicators. All draw to a ctx in
// SCREEN-SPACE pixel coords (not world). Bake-friendly via the same
// makeBakedSprite pattern as creatures + props, but most HUD elements
// change every frame (HP value, cooldown progress) so callers usually
// re-blit per frame.

// Horizontal bar with frame + filled portion + optional labels and
// threshold-color shifts (red/yellow/green).
//   palette: { frame, bg, fill, fillLow?, fillCrit? }
//   opts:    { lowAt=0.4, critAt=0.2, segments=0 }
//     segments — if > 0, draw N divider lines for "stamina pip" feel.
export function barH(ctx, x, y, w, h, fillT, palette, opts = {}) {
  const lowAt  = opts.lowAt  != null ? opts.lowAt  : 0.4;
  const critAt = opts.critAt != null ? opts.critAt : 0.2;
  const segments = opts.segments | 0;
  const t = Math.max(0, Math.min(1, fillT));
  // Frame.
  ctx.fillStyle = palette.frame || '#1a2030';
  ctx.fillRect(x, y, w, h);
  // Bg.
  ctx.fillStyle = palette.bg || '#0a0e18';
  ctx.fillRect(x + 1, y + 1, w - 2, h - 2);
  // Fill — color picks based on threshold.
  const fillCol = t < critAt ? (palette.fillCrit || '#e04040')
                : t < lowAt  ? (palette.fillLow  || '#e0a030')
                :              (palette.fill     || '#60ff7a');
  const fillW = Math.round((w - 2) * t);
  if (fillW > 0) {
    ctx.fillStyle = fillCol;
    ctx.fillRect(x + 1, y + 1, fillW, h - 2);
    // 1px top hilite for the "wet" look.
    ctx.fillStyle = palette.fillHilite || '#ffffff';
    ctx.globalAlpha = 0.25;
    ctx.fillRect(x + 1, y + 1, fillW, 1);
    ctx.globalAlpha = 1;
  }
  // Optional segment dividers.
  if (segments > 1) {
    ctx.fillStyle = palette.frame || '#1a2030';
    for (let i = 1; i < segments; i++) {
      const sx = x + 1 + Math.round(((w - 2) * i) / segments);
      ctx.fillRect(sx, y + 1, 1, h - 2);
    }
  }
}

// Lagging / "chip-damage" horizontal bar — the classic Smash/MOBA
// health visualization where the bar drops fast on damage and a
// white trailing band shows what you just lost, slowly retracting
// to catch up with the new value. Stateless: caller passes BOTH
// `value` (current) and `lagValue` (trailing, ≥ value). For an
// auto-decaying version, use `ui.lagBar(id, ...)` in UIScene —
// that wrapper tracks `lastValue` + animates `lagValue` for you.
//
//   value    — current fraction, 0..1 (painted with `fill`)
//   lagValue — trailing fraction, must be ≥ value (painted with
//              `lag` between `value` and `lagValue`)
//
//   palette: { frame, bg, fill, fillHi?, lag, text }
//   opts:    { label,        // string OR true (auto-percent) OR null
//              segments=0 }  // optional vertical tick marks
export function lagBar(ctx, x, y, w, h, value, lagValue, palette, opts = {}) {
  value = Math.max(0, Math.min(1, value));
  lagValue = Math.max(value, Math.min(1, lagValue));
  const frame = palette.frame || '#0a0e18';
  const bg    = palette.bg    || '#1a2030';
  const fill  = palette.fill  || '#ff5050';
  const lag   = palette.lag   || '#ffffff';
  const text  = palette.text  || '#fff';
  // Outer frame.
  ctx.fillStyle = frame;
  ctx.fillRect(x, y, w, h);
  // Body bg.
  ctx.fillStyle = bg;
  ctx.fillRect(x + 1, y + 1, w - 2, h - 2);
  const innerW = w - 2;
  const valuePx = Math.round(innerW * value);
  const lagPx   = Math.round(innerW * lagValue);
  // Trailing chip band — painted BETWEEN value and lagValue. Drawn
  // before the main fill so the fill's top-highlight strip can lay
  // over its leading edge cleanly. `opts.lagAlpha` ∈ [0, 1] fades
  // the whole band out as it retracts (UIScene's wrapper computes
  // this from peakDelta so a freshly-bumped band starts fully
  // opaque and eases to invisible right as it catches up).
  if (lagPx > valuePx) {
    const lagAlpha = opts.lagAlpha != null ? opts.lagAlpha : 1;
    if (lagAlpha > 0) {
      ctx.save();
      ctx.globalAlpha = Math.max(0, Math.min(1, lagAlpha));
      ctx.fillStyle = lag;
      ctx.fillRect(x + 1 + valuePx, y + 1, lagPx - valuePx, h - 2);
      // 1px shadow band along the bottom of the lag band for a
      // subtle "raised energy" feel matching the main fill.
      if (h >= 4) {
        ctx.fillStyle = palette.lagSh || 'rgba(0,0,0,0.2)';
        ctx.fillRect(x + 1 + valuePx, y + h - 2, lagPx - valuePx, 1);
      }
      ctx.restore();
    }
  }
  // Main fill.
  if (valuePx > 0) {
    ctx.fillStyle = fill;
    ctx.fillRect(x + 1, y + 1, valuePx, h - 2);
    if (h >= 4) {
      ctx.fillStyle = palette.fillHi || 'rgba(255,255,255,0.25)';
      ctx.fillRect(x + 1, y + 1, valuePx, 1);
      ctx.fillStyle = palette.fillSh || 'rgba(0,0,0,0.25)';
      ctx.fillRect(x + 1, y + h - 2, valuePx, 1);
    }
  }
  // Optional segment ticks (same convention as barH).
  const segments = opts.segments | 0;
  if (segments > 1) {
    ctx.fillStyle = palette.tick || 'rgba(0,0,0,0.4)';
    for (let i = 1; i < segments; i++) {
      const sx = x + 1 + Math.round(((w - 2) * i) / segments);
      ctx.fillRect(sx, y + 1, 1, h - 2);
    }
  }
  // Centered label — string verbatim, or `true` for auto-percent.
  if (opts.label != null && opts.label !== false) {
    const lbl = opts.label === true
      ? Math.round(value * 100) + '%'
      : String(opts.label);
    const lw = lbl.length * 4 - 1;
    pixelText(ctx, Math.round(x + (w - lw) / 2),
                   Math.round(y + (h - 5) / 2),
                   lbl, { color: text });
  }
}

// Vertical bar — fills bottom-up. Same opts/palette as barH.
export function barV(ctx, x, y, w, h, fillT, palette, opts = {}) {
  const lowAt  = opts.lowAt  != null ? opts.lowAt  : 0.4;
  const critAt = opts.critAt != null ? opts.critAt : 0.2;
  const segments = opts.segments | 0;
  const t = Math.max(0, Math.min(1, fillT));
  ctx.fillStyle = palette.frame || '#1a2030';
  ctx.fillRect(x, y, w, h);
  ctx.fillStyle = palette.bg || '#0a0e18';
  ctx.fillRect(x + 1, y + 1, w - 2, h - 2);
  const fillCol = t < critAt ? (palette.fillCrit || '#e04040')
                : t < lowAt  ? (palette.fillLow  || '#e0a030')
                :              (palette.fill     || '#60ff7a');
  const fillH = Math.round((h - 2) * t);
  if (fillH > 0) {
    ctx.fillStyle = fillCol;
    ctx.fillRect(x + 1, y + h - 1 - fillH, w - 2, fillH);
    // Bright top edge of the fill.
    ctx.fillStyle = palette.fillHilite || '#ffffff';
    ctx.globalAlpha = 0.25;
    ctx.fillRect(x + 1, y + h - 1 - fillH, w - 2, 1);
    ctx.globalAlpha = 1;
  }
  if (segments > 1) {
    ctx.fillStyle = palette.frame || '#1a2030';
    for (let i = 1; i < segments; i++) {
      const sy = y + 1 + Math.round(((h - 2) * i) / segments);
      ctx.fillRect(x + 1, sy, w - 2, 1);
    }
  }
}

// Segmented pip bar — discrete slots (heart-style HP). Each pip is
// `segW × segH` with `gap` between them.
//   palette: { full, empty, frame? }
//   opts:    { segW=4, segH=6, gap=1, vertical=false }
export function barSegments(ctx, x, y, count, currentFrac, palette, opts = {}) {
  const segW = opts.segW != null ? opts.segW : 4;
  const segH = opts.segH != null ? opts.segH : 6;
  const gap  = opts.gap  != null ? opts.gap  : 1;
  const vertical = !!opts.vertical;
  const filled = Math.round(currentFrac * count);
  const full = palette.full || '#60ff7a';
  const empty = palette.empty || '#1a2030';
  const frame = palette.frame;
  for (let i = 0; i < count; i++) {
    const off = i * (vertical ? (segH + gap) : (segW + gap));
    const sx = vertical ? x : x + off;
    const sy = vertical ? y + (count - 1 - i) * (segH + gap) : y;
    if (frame) {
      ctx.fillStyle = frame;
      ctx.fillRect(sx - 1, sy - 1, segW + 2, segH + 2);
    }
    ctx.fillStyle = i < filled ? full : empty;
    ctx.fillRect(sx, sy, segW, segH);
  }
}

// Cylinder bar — chunky 3D-look vertical column with rounded ends.
// Reads as "fluid in a glass" (mana, fuel, plasma). Use for prominent
// resource displays where flat bars feel too plain.
//   palette: { frame, body, hilite, bg }
//   opts:    { capH=2 }   roundness of the ends
export function barCylinder(ctx, x, y, w, h, fillT, palette, opts = {}) {
  const capH = opts.capH != null ? opts.capH : 2;
  const t = Math.max(0, Math.min(1, fillT));
  const frame = palette.frame || '#1a2030';
  const body = palette.body || '#3aa0e0';
  const hilite = palette.hilite || '#80d0ff';
  const bg = palette.bg || '#0a1828';
  // Frame outline — pinch top/bottom corners for a capsule feel.
  ctx.fillStyle = frame;
  ctx.fillRect(x, y + capH, w, h - capH * 2);                 // sides
  ctx.fillRect(x + 1, y, w - 2, capH);                        // top
  ctx.fillRect(x + 1, y + h - capH, w - 2, capH);             // bottom
  // Bg interior.
  ctx.fillStyle = bg;
  ctx.fillRect(x + 1, y + capH + 1, w - 2, h - capH * 2 - 2);
  ctx.fillRect(x + 2, y + 1, w - 4, capH);
  ctx.fillRect(x + 2, y + h - capH - 1, w - 4, capH);
  // Fill body — bottom-up.
  const innerH = h - 2 - capH * 2;
  const fillH = Math.round(innerH * t);
  if (fillH > 0) {
    ctx.fillStyle = body;
    ctx.fillRect(x + 1, y + h - capH - 1 - fillH, w - 2, fillH);
    // Cap at the bottom.
    if (t > 0.05) {
      ctx.fillRect(x + 2, y + h - capH - 1, w - 4, capH);
    }
  }
  // Bright sheen — vertical highlight strip on the left side, only
  // over the filled portion.
  if (fillH > 0) {
    ctx.fillStyle = hilite;
    ctx.fillRect(x + 1, y + h - capH - 1 - fillH, 1, fillH);
  }
  // Top liquid surface — bright pixel band at the fill top.
  if (fillH > 0 && fillH < innerH) {
    ctx.fillStyle = hilite;
    ctx.fillRect(x + 1, y + h - capH - 1 - fillH, w - 2, 1);
  }
}

// Radial gauge — circular fill sweeping clockwise from 12 o'clock.
// Use for cooldowns, charge meters, directional indicators.
//   palette: { frame, fill, bg }
//   opts:    { innerR=0, outerR=8 }
export function barRadial(ctx, cx, cy, fillT, palette, opts = {}) {
  const innerR = opts.innerR != null ? opts.innerR : 4;
  const outerR = opts.outerR != null ? opts.outerR : 8;
  const t = Math.max(0, Math.min(1, fillT));
  const frame = palette.frame || '#1a2030';
  const fill  = palette.fill  || '#60ff7a';
  const bg    = palette.bg    || '#0a0e18';
  const sweepEnd = -Math.PI / 2 + t * Math.PI * 2;
  // Bg disc + frame.
  for (let dy = -outerR - 1; dy <= outerR + 1; dy++) {
    for (let dx = -outerR - 1; dx <= outerR + 1; dx++) {
      const d2 = dx * dx + dy * dy;
      if (d2 > outerR * outerR + 1) continue;
      const isEdge = d2 > (outerR - 1) * (outerR - 1);
      const isInner = d2 < innerR * innerR;
      if (isInner) continue;
      // Sweep test — angle from center, normalized to [-PI, PI].
      const ang = Math.atan2(dy, dx);
      // Map sweep range from [start=-PI/2] CW to [end=sweepEnd].
      // A pixel at angle `ang` is inside the sweep if its angle delta
      // from start (CW direction) is < t * 2PI.
      const delta = (ang + Math.PI / 2 + Math.PI * 4) % (Math.PI * 2);
      const inSweep = t > 0 && delta < t * Math.PI * 2;
      ctx.fillStyle = isEdge ? frame : (inSweep ? fill : bg);
      ctx.fillRect(cx + dx, cy + dy, 1, 1);
    }
  }
}

// Cooldown pie — clock-face wedge sweeping clockwise. Draws a darker
// translucent wedge over an icon to show "this ability is recharging."
// `t` ∈ [0, 1] — t=0 full pie (just used), t=1 empty (ready).
//   color    — translucent overlay color, default 'rgba(0,0,0,0.6)'
//   opts:    { radius=10 }
export function cooldownPie(ctx, cx, cy, t, color, opts = {}) {
  const r = opts.radius != null ? opts.radius : 10;
  const remaining = Math.max(0, Math.min(1, 1 - t));    // 1 at start, 0 at ready
  if (remaining <= 0.001) return;
  const fill = color || 'rgba(0,0,0,0.6)';
  const sweepRad = remaining * Math.PI * 2;
  const startAng = -Math.PI / 2;
  const endAng = startAng + sweepRad;
  ctx.save();
  ctx.fillStyle = fill;
  // Filled wedge using arc + lineTo back to center.
  ctx.beginPath();
  ctx.moveTo(cx, cy);
  ctx.arc(cx, cy, r, startAng, endAng, false);
  ctx.closePath();
  ctx.fill();
  ctx.restore();
}

// Tiny 3×5 monospace bitmap font — no anti-aliasing, no fractional
// pixels, every glyph stays crisp regardless of scale. Letters A-Z,
// digits 0-9, and a few common symbols. Lowercase letters fall back
// to uppercase glyphs.
const _FONT_3x5 = {
  '0': ['###','#.#','#.#','#.#','###'],
  '1': ['.#.','##.','.#.','.#.','###'],
  '2': ['##.','..#','.#.','#..','###'],
  '3': ['##.','..#','.#.','..#','##.'],
  '4': ['#.#','#.#','###','..#','..#'],
  '5': ['###','#..','##.','..#','##.'],
  '6': ['.##','#..','##.','#.#','.#.'],
  '7': ['###','..#','.#.','#..','#..'],
  '8': ['.#.','#.#','.#.','#.#','.#.'],
  '9': ['.#.','#.#','.##','..#','##.'],
  'A': ['.#.','#.#','###','#.#','#.#'],
  'B': ['##.','#.#','##.','#.#','##.'],
  'C': ['.##','#..','#..','#..','.##'],
  'D': ['##.','#.#','#.#','#.#','##.'],
  'E': ['###','#..','##.','#..','###'],
  'F': ['###','#..','##.','#..','#..'],
  'G': ['.##','#..','#.#','#.#','.##'],
  'H': ['#.#','#.#','###','#.#','#.#'],
  'I': ['###','.#.','.#.','.#.','###'],
  'J': ['..#','..#','..#','#.#','.#.'],
  'K': ['#.#','#.#','##.','#.#','#.#'],
  'L': ['#..','#..','#..','#..','###'],
  'M': ['#.#','###','###','#.#','#.#'],
  'N': ['#.#','###','###','###','#.#'],
  'O': ['.#.','#.#','#.#','#.#','.#.'],
  'P': ['##.','#.#','##.','#..','#..'],
  'Q': ['.#.','#.#','#.#','##.','.##'],
  'R': ['##.','#.#','##.','#.#','#.#'],
  'S': ['.##','#..','.#.','..#','##.'],
  'T': ['###','.#.','.#.','.#.','.#.'],
  'U': ['#.#','#.#','#.#','#.#','.#.'],
  'V': ['#.#','#.#','#.#','#.#','.#.'],
  'W': ['#.#','#.#','###','###','#.#'],
  'X': ['#.#','#.#','.#.','#.#','#.#'],
  'Y': ['#.#','#.#','.#.','.#.','.#.'],
  'Z': ['###','..#','.#.','#..','###'],
  ' ': ['...','...','...','...','...'],
  '.': ['...','...','...','...','.#.'],
  ',': ['...','...','...','.#.','.#.'],
  ':': ['...','.#.','...','.#.','...'],
  '!': ['.#.','.#.','.#.','...','.#.'],
  '?': ['##.','..#','.#.','...','.#.'],
  '/': ['..#','..#','.#.','#..','#..'],
  '-': ['...','...','###','...','...'],
  '+': ['...','.#.','###','.#.','...'],
  '=': ['...','###','...','###','...'],
  '%': ['#.#','..#','.#.','#..','#.#'],
  '#': ['#.#','###','#.#','###','#.#'],
};

// Draw a string in 3×5 pixel font. Each glyph is 1px-spaced. Returns
// the total width drawn so callers can chain or right-align.
//   opts: { scale=1, spacing=1, color='#fff' }
export function pixelText(ctx, x, y, str, opts = {}) {
  const scale = opts.scale != null ? opts.scale : 1;
  const spacing = opts.spacing != null ? opts.spacing : 1;
  const color = opts.color || '#fff';
  ctx.fillStyle = color;
  let cursor = 0;
  for (let i = 0; i < str.length; i++) {
    const ch = str[i];
    let glyph = _FONT_3x5[ch] || _FONT_3x5[ch.toUpperCase()];
    if (!glyph) glyph = _FONT_3x5[' '];
    for (let row = 0; row < 5; row++) {
      const r = glyph[row];
      for (let col = 0; col < 3; col++) {
        if (r[col] === '#') {
          ctx.fillRect(x + (cursor + col) * scale, y + row * scale, scale, scale);
        }
      }
    }
    cursor += 3 + spacing;
  }
  return cursor * scale;
}

// HD scalable text via ctx.font. Bypasses the pixel font for crisp
// resolution-independent labels — useful for menus, tooltips, debug.
//   opts: { font='12px ui-monospace, monospace', baseline='top',
//           align='left', stroke=null, color='#fff' }
export function hudText(ctx, x, y, str, opts = {}) {
  ctx.save();
  ctx.font = opts.font || '12px ui-monospace, monospace';
  ctx.textBaseline = opts.baseline || 'top';
  ctx.textAlign = opts.align || 'left';
  ctx.fillStyle = opts.color || '#fff';
  if (opts.stroke) {
    ctx.strokeStyle = opts.stroke;
    ctx.lineWidth = opts.strokeWidth || 2;
    ctx.lineJoin = 'round';
    ctx.strokeText(str, x, y);
  }
  ctx.fillText(str, x, y);
  ctx.restore();
}

// Built-in rarity tier palette → border color. Caller can pass
// `opts.rarity` as one of the keys to get a tinted slot border.
const _SLOT_RARITY_COLORS = {
  common:    '#7a8aa0',
  uncommon:  '#60ff7a',
  rare:      '#60a8ff',
  epic:      '#c060ff',
  legendary: '#ffd060',
  mythic:    '#ff5050',
};

// Inventory icon slot — bordered square with bevel + selection
// highlight + cooldown overlay + count badge + rarity-tinted border
// + equipped indicator + locked indicator.
//
// State flags (opts):
//   selected   — bright yellow border (or `palette.selected`)
//   hover      — slight bg lift (subtle highlight ring)
//   rarity     — string key (common/uncommon/rare/epic/legendary/mythic)
//                colors the inner-bevel border with the tier tint;
//                also applies to the count badge bg if `count` set.
//   equipped   — small "E" badge in top-right corner
//   locked     — diagonal hatch overlay + lock icon, dimmer text
//   cooldownT  — 0..1 progress; renders pie wedge over the icon
//   count      — number for stack count badge bottom-right
//   badge      — string like "NEW" or "+3" rendered as a small chip
//                in the top-left corner
//
//   palette: { frameOuter, frameInner, bg, hilite, selected,
//              bgHover, badgeBg, badgeText, lockColor }
export function iconSlot(ctx, x, y, palette, opts = {}) {
  const size = opts.size != null ? opts.size : 14;
  const selected = !!opts.selected;
  const hover = !!opts.hover && !selected;
  const equipped = !!opts.equipped;
  const locked = !!opts.locked;
  const rarity = opts.rarity;
  const fOuter = palette.frameOuter || '#0a0e18';
  const fInner = (rarity && _SLOT_RARITY_COLORS[rarity])
                 || palette.frameInner || '#3a4458';
  const bg = hover ? (palette.bgHover || '#2a3458') : (palette.bg || '#1a2030');
  const hilite = palette.hilite || '#7a8aa0';
  // Outer border.
  ctx.fillStyle = fOuter;
  ctx.fillRect(x, y, size, size);
  // Inner frame bevel — selected wins over rarity tint.
  ctx.fillStyle = selected ? (palette.selected || '#fff080') : fInner;
  ctx.fillRect(x + 1, y + 1, size - 2, size - 2);
  // Bg.
  ctx.fillStyle = bg;
  ctx.fillRect(x + 2, y + 2, size - 4, size - 4);
  // Hilite — top-left bevel pixels for the "raised" look.
  ctx.fillStyle = hilite;
  ctx.fillRect(x + 2, y + 2, size - 4, 1);
  ctx.fillRect(x + 2, y + 2, 1, size - 4);
  // Locked: diagonal-stripe overlay + dim everything visible.
  if (locked) {
    ctx.fillStyle = 'rgba(0,0,0,0.4)';
    for (let dy = 2; dy < size - 2; dy++) {
      for (let dx = 2; dx < size - 2; dx++) {
        if ((dx + dy) % 3 === 0) ctx.fillRect(x + dx, y + dy, 1, 1);
      }
    }
    // Lock icon — small padlock at center.
    const lockCol = palette.lockColor || '#cfd8e4';
    const lcx = x + Math.floor(size / 2), lcy = y + Math.floor(size / 2);
    // Body.
    ctx.fillStyle = lockCol;
    ctx.fillRect(lcx - 2, lcy, 5, 3);
    // Shackle.
    ctx.fillRect(lcx - 1, lcy - 2, 1, 2);
    ctx.fillRect(lcx + 1, lcy - 2, 1, 2);
    ctx.fillRect(lcx, lcy - 3, 1, 1);
    // Keyhole.
    ctx.fillStyle = '#0a0e18';
    ctx.fillRect(lcx, lcy + 1, 1, 1);
  }
  // Cooldown overlay.
  if (opts.cooldownT != null && opts.cooldownT > 0 && opts.cooldownT < 1) {
    cooldownPie(ctx, x + size / 2, y + size / 2, 1 - opts.cooldownT,
      'rgba(0,0,0,0.65)', { radius: Math.floor(size / 2) - 1 });
  }
  // Equipped indicator — green "E" chip in the top-right corner.
  if (equipped) {
    ctx.fillStyle = '#3a8030';
    ctx.fillRect(x + size - 5, y + 1, 4, 5);
    ctx.fillStyle = '#80ff80';
    ctx.fillRect(x + size - 4, y + 2, 2, 1);
    ctx.fillRect(x + size - 4, y + 4, 2, 1);
    ctx.fillRect(x + size - 4, y + 3, 1, 1);
  }
  // Count badge — small 2-3 digit number bottom-right. Tinted to
  // rarity if specified.
  if (opts.count != null) {
    const txt = String(opts.count);
    const tw = txt.length * 4;
    // Optional badge bg.
    if (palette.badgeBg) {
      ctx.fillStyle = palette.badgeBg;
      ctx.fillRect(x + size - tw - 2, y + size - 7, tw + 1, 6);
    }
    pixelText(ctx, x + size - tw - 1, y + size - 6, txt,
      { color: palette.badgeText || '#fff' });
  }
  // Top-left chip badge ("NEW", "+3", etc.).
  if (opts.badge) {
    const bw = opts.badge.length * 4 + 1;
    ctx.fillStyle = palette.badgeBg || '#a04050';
    ctx.fillRect(x, y, bw + 2, 7);
    pixelText(ctx, x + 1, y + 1, opts.badge,
      { color: palette.badgeText || '#fff' });
  }
}

// Crosshair / aim reticle — 4 short line segments forming a + with
// a center gap. Use for aimable weapons, cursor in pointer-mode UI.
//   opts: { size=6, gap=2, color='#fff', dot=true, dotColor='#ff4040' }
export function crosshair(ctx, cx, cy, opts = {}) {
  const size = opts.size != null ? opts.size : 6;
  const gap  = opts.gap  != null ? opts.gap  : 2;
  const color = opts.color || '#fff';
  ctx.fillStyle = color;
  // 4 arms.
  ctx.fillRect(cx - size, cy, size - gap, 1);
  ctx.fillRect(cx + gap + 1, cy, size - gap, 1);
  ctx.fillRect(cx, cy - size, 1, size - gap);
  ctx.fillRect(cx, cy + gap + 1, 1, size - gap);
  // Center dot.
  if (opts.dot !== false) {
    ctx.fillStyle = opts.dotColor || '#ff4040';
    ctx.fillRect(cx, cy, 1, 1);
  }
}

// Key prompt — small "[E] Open" / "[SPACE] Jump" pill. Renders a
// rounded background rect + key glyph + label.
//   palette: { keyFrame, keyBg, label }
//   opts:    { padX=2, padY=1 }
export function keyHint(ctx, x, y, key, label, palette, opts = {}) {
  const padX = opts.padX != null ? opts.padX : 2;
  const padY = opts.padY != null ? opts.padY : 1;
  const keyFrame = palette.keyFrame || '#fff';
  const keyBg = palette.keyBg || '#1a2030';
  const labelCol = palette.label || '#fff';
  // Key cell — fixed 7×7 (3 wide font + 2 padding each side + 1 each top/bottom).
  const keyW = 3 * key.length + 2 * (key.length - 1) + padX * 2;
  const keyH = 5 + padY * 2;
  // Frame.
  ctx.fillStyle = keyFrame;
  ctx.fillRect(x, y, keyW, keyH);
  // Bg.
  ctx.fillStyle = keyBg;
  ctx.fillRect(x + 1, y + 1, keyW - 2, keyH - 2);
  // Key character.
  pixelText(ctx, x + padX, y + padY, key, { color: keyFrame });
  // Label after key.
  if (label) {
    pixelText(ctx, x + keyW + 3, y + padY, label, { color: labelCol });
  }
  // Return total width for chaining.
  return keyW + 3 + (label ? (3 * label.length + 2 * (label.length - 1)) : 0);
}

// Damage vignette — red gradient at the canvas edges, fading inward.
// Strength scales with `intensity` (0..1). Use as a "low health" or
// "took damage" hud overlay; persist for a fade.
//   opts: { intensity=0.7, color='#a01818', depth=12 }
export function damageVignette(ctx, x, y, w, h, opts = {}) {
  const intensity = opts.intensity != null ? opts.intensity : 0.7;
  const depth = opts.depth != null ? opts.depth : 12;
  const hex = opts.color || '#a01818';
  const r = parseInt(hex.slice(1, 3), 16);
  const g = parseInt(hex.slice(3, 5), 16);
  const b = parseInt(hex.slice(5, 7), 16);
  // Each ring of pixels at edge gets less alpha as we go inward.
  for (let d = 0; d < depth; d++) {
    const a = intensity * Math.pow(1 - d / depth, 2);
    if (a < 0.02) break;
    ctx.fillStyle = `rgba(${r},${g},${b},${a.toFixed(3)})`;
    // Top + bottom strips (1 row each, offset by d).
    ctx.fillRect(x + d, y + d, w - d * 2, 1);
    ctx.fillRect(x + d, y + h - d - 1, w - d * 2, 1);
    // Left + right strips.
    ctx.fillRect(x + d, y + d, 1, h - d * 2);
    ctx.fillRect(x + w - d - 1, y + d, 1, h - d * 2);
  }
}

// Compass marker — small directional dot/arrow at the edge of a
// reference rect, positioned along an angle. Use for off-screen
// objective indicators ("the boss is that way").
//   opts: { angle, color='#ff4040', size=2 }
export function compassMarker(ctx, cx, cy, radius, palette, opts = {}) {
  const angle = opts.angle != null ? opts.angle : 0;
  const size = opts.size != null ? opts.size : 2;
  const color = palette.color || '#ff4040';
  const px = Math.round(cx + Math.cos(angle) * radius);
  const py = Math.round(cy + Math.sin(angle) * radius);
  ctx.fillStyle = color;
  // Filled small triangle pointing in `angle` direction.
  for (let dy = -size; dy <= size; dy++) {
    for (let dx = -size; dx <= size; dx++) {
      if (dx * dx + dy * dy > size * size) continue;
      ctx.fillRect(px + dx, py + dy, 1, 1);
    }
  }
  // Tip pixel — extra-bright in halo color or white.
  ctx.fillStyle = palette.tip || '#fff';
  ctx.fillRect(
    Math.round(cx + Math.cos(angle) * (radius + size + 1)),
    Math.round(cy + Math.sin(angle) * (radius + size + 1)),
    1, 1);
}

// ─── 8c. Rounded shape primitives ─────────────────────────────────
// Curved rectangles + squares for soft UI panels and buttons. The
// corner radius is in pixels — at r=1 you get a simple 1-pixel
// chamfer, at r=2 a softer 2-pixel curve, etc. All four corners share
// the radius (no per-corner override; if you need that, draw two
// rects with different radii and overlay).

// Outlined rounded rect — single-pixel border, transparent inside.
export function pxRoundedRect(ctx, x, y, w, h, r, color) {
  if (r < 1 || w < r * 2 || h < r * 2) {
    // Degenerate: draw normal rect outline.
    ctx.strokeStyle = color;
    ctx.strokeRect(x + 0.5, y + 0.5, w - 1, h - 1);
    return;
  }
  ctx.fillStyle = color;
  // Border pixel test: pixel is on border if it's inside the rect's
  // outline but is the FIRST inside pixel from outside (or the LAST).
  // Implemented as: draw 4 sides + 4 corner-arc strips.
  // Top + bottom horizontal sides (excluding corner zones).
  ctx.fillRect(x + r, y, w - r * 2, 1);
  ctx.fillRect(x + r, y + h - 1, w - r * 2, 1);
  // Left + right vertical sides.
  ctx.fillRect(x, y + r, 1, h - r * 2);
  ctx.fillRect(x + w - 1, y + r, 1, h - r * 2);
  // 4 corner arcs — pixels at distance ≈ r-0.5 from corner-center.
  for (let dy = 0; dy < r; dy++) {
    for (let dx = 0; dx < r; dx++) {
      const ddx = r - 1 - dx, ddy = r - 1 - dy;
      const d2 = ddx * ddx + ddy * ddy;
      // Border test: in the ring around radius r-0.5.
      if (d2 >= (r - 1) * (r - 1) && d2 < r * r) {
        ctx.fillRect(x + dx, y + dy, 1, 1);
        ctx.fillRect(x + w - 1 - dx, y + dy, 1, 1);
        ctx.fillRect(x + dx, y + h - 1 - dy, 1, 1);
        ctx.fillRect(x + w - 1 - dx, y + h - 1 - dy, 1, 1);
      }
    }
  }
}

// Filled rounded rect — solid interior with curved corners.
export function pxRoundedRectFilled(ctx, x, y, w, h, r, color) {
  if (r < 1 || w < r * 2 || h < r * 2) {
    ctx.fillStyle = color;
    ctx.fillRect(x, y, w, h);
    return;
  }
  ctx.fillStyle = color;
  // Middle horizontal strip — full width, no corner clipping.
  ctx.fillRect(x, y + r, w, h - r * 2);
  // Top + bottom strips — corner-clipped via per-pixel circle test.
  for (let dy = 0; dy < r; dy++) {
    for (let dx = 0; dx < w; dx++) {
      // Skip pixels inside corner-circle exclusion zones.
      if (dx < r) {
        const ddx = r - 1 - dx, ddy = r - 1 - dy;
        if (ddx * ddx + ddy * ddy >= r * r) continue;
      } else if (dx >= w - r) {
        const ddx = dx - (w - r), ddy = r - 1 - dy;
        if (ddx * ddx + ddy * ddy >= r * r) continue;
      }
      ctx.fillRect(x + dx, y + dy, 1, 1);
      ctx.fillRect(x + dx, y + h - 1 - dy, 1, 1);
    }
  }
}

// Beveled rounded rect — pxRoundedRectFilled with top+left light edge
// and bottom+right shadow edge. Use for buttons and interactive panels
// where you want the "raised" feel without per-corner manual work.
//   palette: { shadow, body, hilite }
export function roundedBevelRect(ctx, x, y, w, h, r, palette) {
  // Body fill.
  pxRoundedRectFilled(ctx, x, y, w, h, r, palette.body);
  // Top + left highlight ring (1px in from edge, on the light side).
  if (r >= 1) {
    pxRoundedRect(ctx, x, y, w, h, r, palette.hilite);
    // Bottom + right shadow — overdraw by stamping shadow pixels in
    // the bottom-right corners of the outline.
    ctx.fillStyle = palette.shadow;
    for (let dx = 0; dx < w; dx++) {
      // Bottom edge.
      let isCorner = false;
      if (dx < r) {
        const ddx = r - 1 - dx;
        if (ddx * ddx + (r - 1) * (r - 1) >= r * r) isCorner = true;
      } else if (dx >= w - r) {
        const ddx = dx - (w - r);
        if (ddx * ddx + (r - 1) * (r - 1) >= r * r) isCorner = true;
      }
      if (!isCorner) ctx.fillRect(x + dx, y + h - 1, 1, 1);
    }
    for (let dy = 0; dy < h; dy++) {
      let isCorner = false;
      if (dy < r) {
        const ddy = r - 1 - dy;
        if ((r - 1) * (r - 1) + ddy * ddy >= r * r) isCorner = true;
      } else if (dy >= h - r) {
        const ddy = dy - (h - r);
        if ((r - 1) * (r - 1) + ddy * ddy >= r * r) isCorner = true;
      }
      if (!isCorner) ctx.fillRect(x + w - 1, y + dy, 1, 1);
    }
  }
}

// ─── 8d. Panel + button + list primitives ─────────────────────────

// Modal panel — bordered container with optional title bar.
//   palette: { frame, body, titleBar?, titleText? }
//   opts:    { title?, titleH=8, padding=2, rounded=2 }
export function panel(ctx, x, y, w, h, palette, opts = {}) {
  const titleH = opts.titleH != null ? opts.titleH : 8;
  const radius = opts.rounded != null ? opts.rounded : 2;
  const title = opts.title;
  const frame = palette.frame || '#0a0e18';
  const body = palette.body || '#1a2030';
  const titleBar = palette.titleBar || '#3a4458';
  const titleText = palette.titleText || '#fff';
  // Outer frame.
  pxRoundedRectFilled(ctx, x, y, w, h, radius, frame);
  // Inner body.
  pxRoundedRectFilled(ctx, x + 1, y + 1, w - 2, h - 2, Math.max(0, radius - 1), body);
  // Title bar.
  if (title) {
    ctx.fillStyle = titleBar;
    ctx.fillRect(x + 1, y + 1, w - 2, titleH);
    pxRoundedRectFilled(ctx, x + 1, y + 1, w - 2, titleH, Math.max(0, radius - 1), titleBar);
    // Title text — centered in title bar.
    const labelW = title.length * 4;     // 3-px char + 1 spacing
    pixelText(ctx, x + Math.floor((w - labelW) / 2),
              y + 1 + Math.floor((titleH - 5) / 2), title, { color: titleText });
    // Divider under title.
    ctx.fillStyle = frame;
    ctx.fillRect(x + 1, y + 1 + titleH, w - 2, 1);
  }
}

// Modal dialog — panel with drop-shadow and slightly larger inset.
//   palette: { shadow?, ...panel palette }
//   opts:    { ...panel opts, shadowOff=2 }
export function dialog(ctx, x, y, w, h, palette, opts = {}) {
  const off = opts.shadowOff != null ? opts.shadowOff : 2;
  const shadowCol = palette.shadow || 'rgba(0,0,0,0.5)';
  // Drop shadow.
  ctx.fillStyle = shadowCol;
  pxRoundedRectFilled(ctx, x + off, y + off, w, h,
    opts.rounded != null ? opts.rounded : 2, shadowCol);
  // Then the panel itself.
  panel(ctx, x, y, w, h, palette, opts);
}

// Button — interactive bordered cell with `label` + state + variant.
//
// State drives visual: idle → flat body, hover → bright body + glow
// ring, pressed → inset pushed-down look + bottom shadow gone,
// disabled → muted gray + dithered texture.
//
// Variants (via opts.variant) set sensible default palettes:
//   primary  — accent blue. Confirm/buy/proceed actions.
//   secondary — neutral gray. Cancel/back.
//   danger   — red. Destructive actions (delete, abandon).
//   success  — green. Positive confirmations.
//   ghost    — transparent body, frame only. Subtle/tertiary.
//
// Optional `icon` opt is a `(ctx, x, y, scale)` drawer rendered to
// the LEFT of the label. Scale is fixed at 1; caller can ignore.
//
//   palette: { frame, body, bodyHover, bodyPressed, bodyDisabled,
//              bodyHilite, text, textDisabled, glow }
//   opts:    { state='idle', rounded=2, variant?, icon?,
//              iconWidth=8 }
export function button(ctx, x, y, w, h, label, palette, opts = {}) {
  const state = opts.state || 'idle';
  const radius = opts.rounded != null ? opts.rounded : 2;
  const variant = opts.variant;
  const icon = opts.icon;
  const iconWidth = opts.iconWidth != null ? opts.iconWidth : 8;
  // Variant palette presets — palette overrides win when present.
  const variants = {
    primary:   { body: '#3060a0', hi: '#5090d8', pr: '#1a3868',
                 glow: '#80c0ff', text: '#fff' },
    secondary: { body: '#3a4458', hi: '#5a6478', pr: '#2a3040',
                 glow: '#7a8aa0', text: '#fff' },
    danger:    { body: '#a04050', hi: '#d06070', pr: '#702030',
                 glow: '#ff8090', text: '#fff' },
    success:   { body: '#3a8030', hi: '#5aa040', pr: '#1a5018',
                 glow: '#80ff80', text: '#fff' },
    ghost:     { body: 'rgba(0,0,0,0)', hi: '#3a4458', pr: '#1a2030',
                 glow: '#a0b0c0', text: '#cfd8e4' },
  };
  const v = variants[variant] || variants.secondary;
  const frame = palette.frame || '#0a0e18';
  const idleBody = palette.body || v.body;
  const hoverBody = palette.bodyHover || v.hi;
  const pressedBody = palette.bodyPressed || v.pr;
  const disabledBody = palette.bodyDisabled || '#2a2a2a';
  const glow = palette.glow || v.glow;
  const text = (state === 'disabled' ? (palette.textDisabled || '#666')
                                     : (palette.text || v.text));
  const body = state === 'disabled' ? disabledBody
             : state === 'pressed'  ? pressedBody
             : state === 'hover'    ? hoverBody
             :                         idleBody;
  // Hover glow ring — soft halo around the button.
  if (state === 'hover') {
    const gR = parseInt(glow.slice(1, 3), 16);
    const gG = parseInt(glow.slice(3, 5), 16);
    const gB = parseInt(glow.slice(5, 7), 16);
    ctx.fillStyle = `rgba(${gR},${gG},${gB},0.35)`;
    pxRoundedRectFilled(ctx, x - 1, y - 1, w + 2, h + 2, radius + 1, ctx.fillStyle);
  }
  // Frame.
  pxRoundedRectFilled(ctx, x, y, w, h, radius, frame);
  // Body — for ghost variant, allow transparent body.
  if (body !== 'rgba(0,0,0,0)') {
    pxRoundedRectFilled(ctx, x + 1, y + 1, w - 2, h - 2,
      Math.max(0, radius - 1), body);
  }
  // Top hilite for raised feel (skip when pressed/disabled).
  if (state !== 'pressed' && state !== 'disabled' && body !== 'rgba(0,0,0,0)') {
    const hilite = palette.bodyHilite || v.hi;
    ctx.fillStyle = hilite;
    ctx.fillRect(x + 1 + radius, y + 1, w - 2 - radius * 2, 1);
  }
  // Bottom shadow strip for raised feel — vanishes on press to feel
  // "pushed in." Adds depth on idle/hover.
  if (state === 'idle' || state === 'hover') {
    ctx.fillStyle = palette.bottomShadow || frame;
    ctx.fillRect(x + 1 + radius, y + h - 2, w - 2 - radius * 2, 1);
  }
  // Disabled overlay — diagonal hatching for "unavailable" feel.
  if (state === 'disabled') {
    ctx.fillStyle = 'rgba(0,0,0,0.25)';
    for (let dy = 1; dy < h - 1; dy++) {
      for (let dx = 1; dx < w - 1; dx++) {
        if ((dx + dy) % 3 === 0) ctx.fillRect(x + dx, y + dy, 1, 1);
      }
    }
  }
  // Compute label + icon layout. Icon goes left of label; both
  // groups centered within the button.
  if (label || icon) {
    const labelW = label ? label.length * 4 - 1 : 0;
    const iconSpace = icon ? iconWidth + 2 : 0;
    const totalW = labelW + iconSpace;
    const startX = x + Math.floor((w - totalW) / 2);
    const cy = y + Math.floor(h / 2);
    const dropY = state === 'pressed' ? 1 : 0;
    if (icon) {
      icon(ctx, startX + iconWidth / 2, cy + dropY, 1);
    }
    if (label) {
      const lx = startX + iconSpace;
      const ly = y + Math.floor((h - 5) / 2) + dropY;
      pixelText(ctx, lx, ly, label, { color: text });
    }
  }
}

// List item — single row in a vertical list. Now supports hover +
// disabled states, optional subtitle below label, optional right-
// aligned content (price, key shortcut, count badge), and optional
// icon drawer to the left.
//
// State flags (opts):
//   selected  — bright bg + left accent bar + bold text color
//   hover     — slightly bright bg + subtle accent on left
//   disabled  — muted text, dithered overlay, no interaction
//   alt       — alternating row tint (caller passes for even rows)
//
// Optional content (opts):
//   subtitle  — second line below label (small dimmer text)
//   right     — string or drawer fn rendered right-aligned in the row
//   icon      — drawer fn for left-side icon
//   iconW     — left padding to leave for icon (default 0 = no icon)
//
//   palette: { bg, bgAlt, bgHover, bgSelected, frame?, text,
//              textAlt, textSelected, textDisabled, textSubtitle,
//              accent, accentHover }
export function listItem(ctx, x, y, w, h, label, palette, opts = {}) {
  const selected = !!opts.selected;
  const hover = !!opts.hover && !selected;
  const disabled = !!opts.disabled;
  const alt = !!opts.alt;
  const iconW = opts.iconW || 0;
  const subtitle = opts.subtitle;
  const right = opts.right;
  const icon = opts.icon;
  // Background.
  const bg = disabled ? (palette.bgDisabled || palette.bg || '#0a0e18')
           : selected ? (palette.bgSelected || '#3a4870')
           : hover    ? (palette.bgHover || '#2a3458')
           : alt      ? (palette.bgAlt || '#1a2030')
           :            (palette.bg || '#0a0e18');
  // Text colors.
  const text = disabled ? (palette.textDisabled || '#5a6478')
            : selected ? (palette.textSelected || '#fff')
            : hover    ? (palette.textHover || '#fff')
            : alt      ? (palette.textAlt || '#cfd8e4')
            :            (palette.text || '#a0b0c0');
  const subText = palette.textSubtitle || '#7a8aa0';
  ctx.fillStyle = bg;
  ctx.fillRect(x, y, w, h);
  // Selection accent — bright left vertical bar.
  if (selected) {
    ctx.fillStyle = palette.accent || '#80c0ff';
    ctx.fillRect(x, y, 2, h);
  } else if (hover) {
    ctx.fillStyle = palette.accentHover || palette.accent || '#5a7898';
    ctx.fillRect(x, y, 1, h);
  }
  // Disabled diagonal hatching overlay.
  if (disabled) {
    ctx.fillStyle = 'rgba(0,0,0,0.2)';
    for (let dy = 0; dy < h; dy++) {
      for (let dx = 0; dx < w; dx++) {
        if ((dx + dy) % 4 === 0) ctx.fillRect(x + dx, y + dy, 1, 1);
      }
    }
  }
  // Layout: icon | label/subtitle | right
  const leftPad = (selected || hover ? 4 : 4);
  const labelX = x + leftPad + iconW;
  // Render icon to the left if drawer provided.
  if (icon) {
    const iconCY = y + Math.floor(h / 2);
    icon(ctx, x + leftPad + iconW / 2, iconCY, 1);
  }
  // Label position — vertically centered if no subtitle, otherwise
  // upper half.
  if (label) {
    const ly = subtitle ? y + 2 : y + Math.floor((h - 5) / 2);
    pixelText(ctx, labelX, ly, label, { color: text });
  }
  if (subtitle) {
    const sly = y + h - 7;
    pixelText(ctx, labelX, sly, subtitle, { color: subText });
  }
  // Right-aligned content — string or drawer.
  if (right) {
    if (typeof right === 'string') {
      const rw = right.length * 4 - 1;
      pixelText(ctx, x + w - rw - 4, y + Math.floor((h - 5) / 2),
        right, { color: text });
    } else if (typeof right === 'function') {
      right(ctx, x + w - 4, y + Math.floor(h / 2), 1);
    }
  }
}

// Inventory grid — N×M array of icon slots with consistent spacing.
// Single-call render of an empty grid; callers can layer iconSlot
// items on top for actual contents.
//   palette: { ...iconSlot palette, gridFrame? }
//   opts:    { cols=4, rows=2, slotSize=14, gap=2, itemSize=10 }
export function inventoryGrid(ctx, x, y, palette, opts = {}) {
  const cols = opts.cols != null ? opts.cols : 4;
  const rows = opts.rows != null ? opts.rows : 2;
  const slot = opts.slotSize != null ? opts.slotSize : 14;
  const gap  = opts.gap != null ? opts.gap : 2;
  const totalW = cols * slot + (cols - 1) * gap + 4;
  const totalH = rows * slot + (rows - 1) * gap + 4;
  // Optional surrounding panel.
  if (palette.gridFrame) {
    pxRoundedRectFilled(ctx, x, y, totalW, totalH, 2, palette.gridFrame);
  }
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      const sx = x + 2 + c * (slot + gap);
      const sy = y + 2 + r * (slot + gap);
      iconSlot(ctx, sx, sy, palette, { size: slot });
    }
  }
}

// ─── 8e. Keyboard + gamepad icon primitives ───────────────────────

// Keyboard key — beveled chunky cap with letter centered. More
// substantial than `keyHint`; use this when the key is a UI element
// (settings binding) rather than an inline prompt.
//   palette: { frame, body, hilite, shadow, text }
//   opts:    { rounded=1, pressed=false }
export function kbdKey(ctx, x, y, w, h, label, palette, opts = {}) {
  const radius = opts.rounded != null ? opts.rounded : 1;
  const pressed = !!opts.pressed;
  const frame = palette.frame || '#0a0e18';
  const body = palette.body || '#cfd8e4';
  const hilite = palette.hilite || '#fff';
  const shadow = palette.shadow || '#7a8aa0';
  const text = palette.text || '#0a0e18';
  // Outer frame.
  pxRoundedRectFilled(ctx, x, y, w, h, radius, frame);
  // Body — pressed gets pushed down 1px.
  const bodyY = pressed ? y + 2 : y + 1;
  const bodyH = pressed ? h - 2 : h - 3;
  pxRoundedRectFilled(ctx, x + 1, bodyY, w - 2, bodyH, Math.max(0, radius - 1), body);
  // Top highlight strip (skip when pressed).
  if (!pressed) {
    ctx.fillStyle = hilite;
    ctx.fillRect(x + radius + 1, y + 1, w - 2 - radius * 2, 1);
    // Bottom shadow band gives the "key cap" depth.
    ctx.fillStyle = shadow;
    ctx.fillRect(x + 1, y + h - 2, w - 2, 1);
  }
  // Label centered.
  if (label) {
    const labelW = label.length * 4 - 1;
    const lx = x + Math.floor((w - labelW) / 2);
    const ly = bodyY + Math.floor((bodyH - 5) / 2);
    pixelText(ctx, lx, ly, label, { color: text });
  }
}

// Gamepad face button — circular A/B/X/Y style with colored body,
// dark inner ring, and centered letter.
//   palette: { body, ring, text }
//   opts:    { radius=6, pressed=false }
export function gamepadButton(ctx, cx, cy, label, palette, opts = {}) {
  const r = opts.radius != null ? opts.radius : 6;
  const pressed = !!opts.pressed;
  const body = palette.body || '#60a8ff';
  const ring = palette.ring || '#0a0e18';
  const text = palette.text || '#fff';
  // Outer ring (frame).
  for (let dy = -r - 1; dy <= r + 1; dy++) {
    for (let dx = -r - 1; dx <= r + 1; dx++) {
      const d2 = dx * dx + dy * dy;
      if (d2 > (r + 0.5) * (r + 0.5)) continue;
      ctx.fillStyle = (d2 > (r - 0.5) * (r - 0.5)) ? ring : body;
      ctx.fillRect(cx + dx, cy + dy + (pressed ? 1 : 0), 1, 1);
    }
  }
  // Top hilite — single bright pixel near top-left interior.
  if (!pressed) {
    ctx.fillStyle = palette.hilite || '#fff';
    ctx.fillRect(cx - Math.floor(r / 2), cy - Math.floor(r / 2), 1, 1);
  }
  // Letter.
  if (label && label.length === 1) {
    pixelText(ctx, cx - 1, cy - 2 + (pressed ? 1 : 0), label, { color: text });
  }
}

// Gamepad D-pad — 4-directional cross. Highlighted direction shows
// the "pressed" state.
//   palette: { body, ring, hilite }
//   opts:    { size=8, pressed='none'|'up'|'down'|'left'|'right' }
export function gamepadDpad(ctx, cx, cy, palette, opts = {}) {
  const size = opts.size != null ? opts.size : 8;
  const pressed = opts.pressed || 'none';
  const body = palette.body || '#3a4458';
  const ring = palette.ring || '#0a0e18';
  const hilite = palette.hilite || '#80c0ff';
  // Cross shape: vertical bar + horizontal bar.
  const half = Math.floor(size / 2);
  const arm = Math.floor(size / 3);
  // Vertical bar.
  ctx.fillStyle = ring;
  ctx.fillRect(cx - arm, cy - half, arm * 2, size);
  ctx.fillStyle = pressed === 'up' || pressed === 'down' ? hilite : body;
  ctx.fillRect(cx - arm + 1, cy - half + 1, arm * 2 - 2, size - 2);
  // Horizontal bar.
  ctx.fillStyle = ring;
  ctx.fillRect(cx - half, cy - arm, size, arm * 2);
  ctx.fillStyle = pressed === 'left' || pressed === 'right' ? hilite : body;
  ctx.fillRect(cx - half + 1, cy - arm + 1, size - 2, arm * 2 - 2);
  // Highlight only the pressed direction (overdraw half the bar).
  if (pressed === 'up') {
    ctx.fillStyle = hilite;
    ctx.fillRect(cx - arm + 1, cy - half + 1, arm * 2 - 2, half);
  } else if (pressed === 'down') {
    ctx.fillStyle = hilite;
    ctx.fillRect(cx - arm + 1, cy + 1, arm * 2 - 2, half);
  } else if (pressed === 'left') {
    ctx.fillStyle = hilite;
    ctx.fillRect(cx - half + 1, cy - arm + 1, half, arm * 2 - 2);
  } else if (pressed === 'right') {
    ctx.fillStyle = hilite;
    ctx.fillRect(cx + 1, cy - arm + 1, half, arm * 2 - 2);
  }
  // Center dot.
  ctx.fillStyle = ring;
  ctx.fillRect(cx, cy, 1, 1);
}

// Gamepad analog stick — disc base + smaller stick top, with
// directional offset based on input vector.
//   palette: { base, stick, ring }
//   opts:    { baseR=8, stickR=4, dirX=0, dirY=0, maxOff=2, pressed }
export function gamepadStick(ctx, cx, cy, palette, opts = {}) {
  const baseR = opts.baseR != null ? opts.baseR : 8;
  const stickR = opts.stickR != null ? opts.stickR : 4;
  const dirX = opts.dirX != null ? opts.dirX : 0;
  const dirY = opts.dirY != null ? opts.dirY : 0;
  const maxOff = opts.maxOff != null ? opts.maxOff : 2;
  const base = palette.base || '#1a2030';
  const stick = palette.stick || (opts.pressed ? '#a0c8e0' : '#80a8c8');
  const ring = palette.ring || '#0a0e18';
  // Base disc.
  for (let dy = -baseR - 1; dy <= baseR + 1; dy++) {
    for (let dx = -baseR - 1; dx <= baseR + 1; dx++) {
      const d2 = dx * dx + dy * dy;
      if (d2 > (baseR + 0.5) * (baseR + 0.5)) continue;
      ctx.fillStyle = (d2 > (baseR - 0.5) * (baseR - 0.5)) ? ring : base;
      ctx.fillRect(cx + dx, cy + dy, 1, 1);
    }
  }
  // Stick top — offset by direction vector.
  const sx = cx + Math.round(dirX * maxOff);
  const sy = cy + Math.round(dirY * maxOff);
  for (let dy = -stickR - 1; dy <= stickR + 1; dy++) {
    for (let dx = -stickR - 1; dx <= stickR + 1; dx++) {
      const d2 = dx * dx + dy * dy;
      if (d2 > (stickR + 0.5) * (stickR + 0.5)) continue;
      ctx.fillStyle = (d2 > (stickR - 0.5) * (stickR - 0.5)) ? ring : stick;
      ctx.fillRect(sx + dx, sy + dy, 1, 1);
    }
  }
  // Top hilite on the stick.
  if (!opts.pressed) {
    ctx.fillStyle = palette.hilite || '#fff';
    ctx.fillRect(sx - 1, sy - 1, 1, 1);
  }
}

// Gamepad shoulder/trigger — long rounded pill with label (LB, RB,
// LT, RT). The bumper variant is wider; trigger is taller.
//   palette: { frame, body, hilite, text }
//   opts:    { w=18, h=6, rounded=2, pressed=false, label }
export function gamepadShoulder(ctx, x, y, label, palette, opts = {}) {
  const w = opts.w != null ? opts.w : 18;
  const h = opts.h != null ? opts.h : 6;
  const radius = opts.rounded != null ? opts.rounded : 2;
  const pressed = !!opts.pressed;
  const frame = palette.frame || '#0a0e18';
  const body = palette.body || (pressed ? '#3a4870' : '#3a4458');
  const hilite = palette.hilite || '#7a8aa0';
  const text = palette.text || '#fff';
  pxRoundedRectFilled(ctx, x, y, w, h, radius, frame);
  pxRoundedRectFilled(ctx, x + 1, y + 1, w - 2, h - 2,
    Math.max(0, radius - 1), body);
  if (!pressed) {
    ctx.fillStyle = hilite;
    ctx.fillRect(x + radius + 1, y + 1, w - 2 - radius * 2, 1);
  }
  if (label) {
    const labelW = label.length * 4 - 1;
    pixelText(ctx, x + Math.floor((w - labelW) / 2),
      y + Math.floor((h - 5) / 2) + (pressed ? 1 : 0),
      label, { color: text });
  }
}

// ─── 8e². Form widgets ─────────────────────────────────────────────
// Common menu/settings widgets that pair with `panel`, `listItem`,
// and `button`. Each is one primitive call; state lives in caller code
// (e.g. `settings.musicEnabled`).

// Toggle switch — sliding circle in a pill track. `on` is a boolean
// (or 0..1 for an animated transition). Reads as iOS/Android toggle.
//   palette: { trackOff, trackOn, knob, knobShadow }
//   opts:    { w=18, h=10, animT=null }
//     animT — pass a 0..1 transition value to animate the knob slide;
//             omit for instant snap based on `on` boolean.
export function toggle(ctx, x, y, on, palette, opts = {}) {
  const w = opts.w != null ? opts.w : 18;
  const h = opts.h != null ? opts.h : 10;
  const trackOff = palette.trackOff || '#3a4458';
  const trackOn = palette.trackOn || '#3a8030';
  const knob = palette.knob || '#fff';
  const knobShadow = palette.knobShadow || '#a0a8b0';
  const frame = palette.frame || '#0a0e18';
  // Track — pill-shape rounded rect.
  const r = Math.floor(h / 2);
  pxRoundedRectFilled(ctx, x, y, w, h, r, frame);
  const onAmount = opts.animT != null ? opts.animT : (on ? 1 : 0);
  // Lerp track color between off and on.
  const offRGB = [
    parseInt(trackOff.slice(1, 3), 16),
    parseInt(trackOff.slice(3, 5), 16),
    parseInt(trackOff.slice(5, 7), 16),
  ];
  const onRGB = [
    parseInt(trackOn.slice(1, 3), 16),
    parseInt(trackOn.slice(3, 5), 16),
    parseInt(trackOn.slice(5, 7), 16),
  ];
  const trackR = offRGB[0] * (1 - onAmount) + onRGB[0] * onAmount;
  const trackG = offRGB[1] * (1 - onAmount) + onRGB[1] * onAmount;
  const trackB = offRGB[2] * (1 - onAmount) + onRGB[2] * onAmount;
  ctx.fillStyle = `rgb(${trackR|0},${trackG|0},${trackB|0})`;
  pxRoundedRectFilled(ctx, x + 1, y + 1, w - 2, h - 2,
    Math.max(0, r - 1), ctx.fillStyle);
  // Knob — slides from left to right based on onAmount.
  const knobR = r - 1;
  const knobX = Math.round(x + 1 + knobR + onAmount * (w - 2 - knobR * 2));
  const knobY = y + h / 2;
  // Knob shadow ring.
  for (let dy = -knobR; dy <= knobR; dy++) {
    for (let dx = -knobR; dx <= knobR; dx++) {
      const d2 = dx * dx + dy * dy;
      if (d2 > knobR * knobR + 0.5) continue;
      const isEdge = d2 > (knobR - 1) * (knobR - 1);
      ctx.fillStyle = isEdge ? knobShadow : knob;
      ctx.fillRect(knobX + dx, Math.round(knobY) + dy, 1, 1);
    }
  }
}

// Checkbox — small square with an optional check mark. `checked` is
// boolean. Use in settings menus, list filters, etc.
//   palette: { frame, bg, bgChecked, check }
//   opts:    { size=10 }
export function checkbox(ctx, x, y, checked, palette, opts = {}) {
  const size = opts.size != null ? opts.size : 10;
  const frame = palette.frame || '#0a0e18';
  const bg = palette.bg || '#1a2030';
  const bgChecked = palette.bgChecked || '#3a8030';
  const check = palette.check || '#fff';
  pxRoundedRectFilled(ctx, x, y, size, size, 1, frame);
  pxRoundedRectFilled(ctx, x + 1, y + 1, size - 2, size - 2, 0,
    checked ? bgChecked : bg);
  // Check mark — diagonal "✓" when checked.
  if (checked) {
    ctx.fillStyle = check;
    // Pixel-art checkmark: short diagonal then long diagonal up-right.
    const cx = x + Math.floor(size / 2) - 1;
    const cy = y + Math.floor(size / 2);
    ctx.fillRect(cx,     cy + 1, 1, 1);
    ctx.fillRect(cx + 1, cy + 2, 1, 1);
    ctx.fillRect(cx + 2, cy + 1, 1, 1);
    ctx.fillRect(cx + 3, cy,     1, 1);
    ctx.fillRect(cx + 4, cy - 1, 1, 1);
    ctx.fillRect(cx + 5, cy - 2, 1, 1);
  }
}

// Radio button — circular selection indicator. `selected` is boolean.
// Use in mutually-exclusive choice groups.
//   palette: { frame, bg, dot }
//   opts:    { size=10 }
export function radioButton(ctx, x, y, selected, palette, opts = {}) {
  const size = opts.size != null ? opts.size : 10;
  const frame = palette.frame || '#0a0e18';
  const bg = palette.bg || '#1a2030';
  const dot = palette.dot || '#80c0ff';
  const r = Math.floor(size / 2);
  const cx = x + r, cy = y + r;
  // Outer ring + bg disc.
  for (let dy = -r; dy <= r; dy++) {
    for (let dx = -r; dx <= r; dx++) {
      const d2 = dx * dx + dy * dy;
      if (d2 > r * r + 0.5) continue;
      const isEdge = d2 > (r - 1) * (r - 1);
      ctx.fillStyle = isEdge ? frame : bg;
      ctx.fillRect(cx + dx, cy + dy, 1, 1);
    }
  }
  // Inner selected dot.
  if (selected) {
    const innerR = r - 2;
    ctx.fillStyle = dot;
    for (let dy = -innerR; dy <= innerR; dy++) {
      for (let dx = -innerR; dx <= innerR; dx++) {
        if (dx * dx + dy * dy > innerR * innerR + 0.2) continue;
        ctx.fillRect(cx + dx, cy + dy, 1, 1);
      }
    }
  }
}

// Slider — horizontal value slider with a knob. `value` is 0..1.
//   palette: { track, fill, knob, knobShadow, frame }
//   opts:    { knobR=4, trackH=2 }
export function slider(ctx, x, y, w, value, palette, opts = {}) {
  const knobR = opts.knobR != null ? opts.knobR : 4;
  const trackH = opts.trackH != null ? opts.trackH : 2;
  const track = palette.track || '#3a4458';
  const fill = palette.fill || '#80c0ff';
  const knob = palette.knob || '#fff';
  const knobShadow = palette.knobShadow || '#a0a8b0';
  const frame = palette.frame || '#0a0e18';
  const v = Math.max(0, Math.min(1, value));
  const trackY = y + Math.floor((knobR * 2 - trackH) / 2);
  // Track frame.
  ctx.fillStyle = frame;
  ctx.fillRect(x, trackY - 1, w, trackH + 2);
  // Track bg.
  ctx.fillStyle = track;
  ctx.fillRect(x + 1, trackY, w - 2, trackH);
  // Filled portion.
  ctx.fillStyle = fill;
  const fillW = Math.round((w - 2) * v);
  if (fillW > 0) ctx.fillRect(x + 1, trackY, fillW, trackH);
  // Knob — circular, positioned at v.
  const knobX = Math.round(x + knobR + v * (w - knobR * 2));
  const knobY = y + knobR;
  for (let dy = -knobR; dy <= knobR; dy++) {
    for (let dx = -knobR; dx <= knobR; dx++) {
      const d2 = dx * dx + dy * dy;
      if (d2 > knobR * knobR + 0.5) continue;
      const isEdge = d2 > (knobR - 1) * (knobR - 1);
      ctx.fillStyle = isEdge ? knobShadow : knob;
      ctx.fillRect(knobX + dx, knobY + dy, 1, 1);
    }
  }
}

// Progress bar with optional animated diagonal stripes. Different from
// `barH`: progress bars are for "task is N% done" with optional
// indeterminate stripes; `barH` is for stat readouts (HP/MP).
//   palette: { frame, bg, fill, stripe? }
//   opts:    { value=0..1, indeterminate=false, t=0, animSpeed=1 }
//     indeterminate — if true, fill fakes a sliding loading bar.
//     t             — animation phase 0..1 for stripe motion.
export function progressBar(ctx, x, y, w, h, palette, opts = {}) {
  const value = opts.value != null ? opts.value : 0;
  const indeterminate = !!opts.indeterminate;
  const t = opts.t != null ? opts.t : 0;
  const frame = palette.frame || '#0a0e18';
  const bg = palette.bg || '#1a2030';
  const fill = palette.fill || '#80c0ff';
  const stripe = palette.stripe || '#a0d8ff';
  pxRoundedRectFilled(ctx, x, y, w, h, 1, frame);
  pxRoundedRectFilled(ctx, x + 1, y + 1, w - 2, h - 2, 0, bg);
  if (indeterminate) {
    // Indeterminate: a sliding rectangle that wraps around the bar.
    const barW = Math.floor(w * 0.35);
    const slide = Math.floor((t * (w + barW)) - barW);
    const sx = Math.max(x + 1, x + slide);
    const ex = Math.min(x + w - 1, x + slide + barW);
    if (ex > sx) {
      ctx.fillStyle = fill;
      ctx.fillRect(sx, y + 1, ex - sx, h - 2);
    }
  } else {
    const v = Math.max(0, Math.min(1, value));
    const fillW = Math.round((w - 2) * v);
    if (fillW > 0) {
      ctx.fillStyle = fill;
      ctx.fillRect(x + 1, y + 1, fillW, h - 2);
    }
  }
  // Diagonal stripes — animated. Skip when h < 4 (too short).
  if (h >= 4) {
    ctx.fillStyle = stripe;
    const stripeOff = Math.floor(t * 8) % 4;
    for (let dx = 0; dx < (indeterminate ? w : Math.round((w - 2) * Math.max(0, Math.min(1, value)))); dx++) {
      for (let dy = 0; dy < h - 2; dy++) {
        if ((dx + dy + stripeOff) % 4 === 0) {
          ctx.fillRect(x + 1 + dx, y + 1 + dy, 1, 1);
        }
      }
    }
  }
}

// Tab bar — horizontal row of clickable tabs with one active. Active
// tab gets a brighter body + bottom-border accent.
//   tabs:    array of { label, disabled? }
//   palette: { bg, body, bodyActive, frame, text, textActive,
//              accent, textDisabled? }
//   opts:    { activeIdx=0, tabW=auto }
export function tabBar(ctx, x, y, w, h, tabs, palette, opts = {}) {
  if (!tabs || tabs.length === 0) return;
  const activeIdx = opts.activeIdx != null ? opts.activeIdx : 0;
  const tabW = opts.tabW != null ? opts.tabW : Math.floor(w / tabs.length);
  const bg = palette.bg || '#0a0e18';
  const body = palette.body || '#1a2030';
  const bodyActive = palette.bodyActive || '#3a4870';
  const frame = palette.frame || '#0a0e18';
  const text = palette.text || '#7a8aa0';
  const textActive = palette.textActive || '#fff';
  const accent = palette.accent || '#80c0ff';
  const textDisabled = palette.textDisabled || '#3a4458';
  // Background strip.
  ctx.fillStyle = bg;
  ctx.fillRect(x, y, w, h);
  for (let i = 0; i < tabs.length; i++) {
    const tab = tabs[i];
    const tx = x + i * tabW;
    const isActive = i === activeIdx;
    const tabBody = isActive ? bodyActive : body;
    const tabText = tab.disabled ? textDisabled
                  : isActive     ? textActive
                  :                text;
    // Tab body — rounded top corners only.
    ctx.fillStyle = tabBody;
    ctx.fillRect(tx + 1, y + 1, tabW - 2, h - 2);
    // Top hilite for active.
    if (isActive) {
      ctx.fillStyle = accent;
      ctx.fillRect(tx + 1, y + h - 1, tabW - 2, 1);
    }
    // Separator between tabs.
    if (i > 0) {
      ctx.fillStyle = frame;
      ctx.fillRect(tx, y + 1, 1, h - 2);
    }
    // Label centered.
    if (tab.label) {
      const lw = tab.label.length * 4 - 1;
      pixelText(ctx, tx + Math.floor((tabW - lw) / 2),
        y + Math.floor((h - 5) / 2), tab.label, { color: tabText });
    }
  }
}

// Tooltip — floating label/info bubble with a tail pointing at an anchor.
// Backwards compatible with single-string usage. Now supports
// multi-line + per-line color + an optional image at the top, so the
// same primitive covers everything from a 1-word hover hint to a
// rich item-card with thumbnail + title + stats.
//
//   palette: { bg, frame, text }            // text is default line color
//   opts:    { tail, padding, image, lines, align, title, body }
//
// ── Three calling conventions, in order of richness ──────────────
// 1. Plain string (legacy):
//      tooltip(ctx, x, y, 'HEAL +50', palette);
//
// 2. Newline-separated string → multi-line:
//      tooltip(ctx, x, y, 'IRON SWORD\nCommon · Lv 1\n+12 attack', palette);
//
// 3. Structured (full control over per-line color, image, etc):
//      tooltip(ctx, x, y, null, palette, {
//        image: rarityIconCanvas,         // any drawable: Image, Canvas,
//                                          // or { draw(ctx,x,y) } object
//        lines: [
//          { text: 'IRON SWORD', color: '#ffd060' },
//          { text: 'Common · Lv 1', color: '#7a8aa0' },
//          { text: '+12 attack', color: '#80ff80' },
//        ],
//      });
//
// ── Sizing ────────────────────────────────────────────────────────
// Width = max(image.width, longest line) + padX*2 + 2. Height stacks
// image on top, then lines (5px font + 1px gap). Whole bubble is
// centered horizontally on the anchor x. The tail is drawn the same
// as before (down = bubble above anchor, up = bubble below).
//
// ── Image source ──────────────────────────────────────────────────
// `image` accepts:
//   • An `HTMLImageElement` (loaded or loading — drawImage is no-op
//     until the image's `complete` flips true). Use `imageRef(src)`
//     below to lazy-create + cache one.
//   • An `HTMLCanvasElement` — useful for procedurally drawn icons
//     (rarity blob, item silhouette, etc). Render once at app boot,
//     pass the canvas every frame.
//   • An `OffscreenCanvas` (drawImage accepts those too).
//   • Any object with a `.draw(ctx, x, y)` method — for callers who
//     want full control of how the icon is painted.
export function tooltip(ctx, x, y, label, palette, opts = {}) {
  // Normalize `label` + `opts.lines` → unified array of
  // { text, color, align? } line objects.
  const tail = opts.tail || 'down';
  const padding = opts.padding != null ? opts.padding : 2;
  const bg = palette.bg || '#1a2030';
  const frame = palette.frame || '#0a0e18';
  const defaultText = palette.text || '#fff';
  const image = opts.image || null;

  let lines;
  if (Array.isArray(opts.lines) && opts.lines.length) {
    lines = opts.lines.map(l =>
      typeof l === 'string' ? { text: l } : l);
  } else if (typeof label === 'string' && label.length) {
    lines = label.split('\n').map(t => ({ text: t }));
  } else {
    lines = [];
  }
  if (!lines.length && !image) return;

  // Image dimensions — accept w/h, width/height, or raw element dims.
  const imgW = image
    ? (image.w || image.width || (image.draw ? (image.dw || 16) : 0))
    : 0;
  const imgH = image
    ? (image.h || image.height || (image.draw ? (image.dh || 16) : 0))
    : 0;

  // Text dimensions — 3px glyph + 1px spacing per char, 5px line height
  // + 1px gap between lines. Last line gets no trailing gap.
  const charW = 4;
  const lineH = 6;
  const longestLineW = lines.length
    ? Math.max(...lines.map(l => Math.max(0, (l.text || '').length * charW - 1)))
    : 0;
  const linesH = lines.length ? lines.length * lineH - 1 : 0;
  const gapBetweenImgAndLines = (imgH > 0 && lines.length) ? 2 : 0;

  const innerW = Math.max(imgW, longestLineW);
  const innerH = imgH + gapBetweenImgAndLines + linesH;
  const w = innerW + padding * 2 + 2;
  const h = innerH + padding * 2 + 2;

  // Position so anchor (x, y) is at the tail tip.
  const dx = Math.round(x - w / 2);
  const dy = tail === 'down' ? y - h - 3 : y + 3;

  // Body.
  pxRoundedRectFilled(ctx, dx, dy, w, h, 1, frame);
  pxRoundedRectFilled(ctx, dx + 1, dy + 1, w - 2, h - 2, 0, bg);

  // Tail (matches legacy positioning).
  ctx.fillStyle = frame;
  if (tail === 'down') {
    ctx.fillRect(x - 2, y - 3, 5, 1);
    ctx.fillRect(x - 1, y - 2, 3, 1);
    ctx.fillRect(x, y - 1, 1, 1);
    ctx.fillStyle = bg;
    ctx.fillRect(x - 1, y - 3, 3, 1);
    ctx.fillRect(x, y - 2, 1, 1);
  } else {
    ctx.fillRect(x - 2, y + 3, 5, 1);
    ctx.fillRect(x - 1, y + 4, 3, 1);
    ctx.fillRect(x, y + 5, 1, 1);
    ctx.fillStyle = bg;
    ctx.fillRect(x - 1, y + 3, 3, 1);
    ctx.fillRect(x, y + 4, 1, 1);
  }

  // Image (centered horizontally) at the top of the inner area.
  let cy = dy + 1 + padding;
  if (image && imgW > 0 && imgH > 0) {
    const ix = dx + 1 + padding + Math.round((innerW - imgW) / 2);
    if (typeof image.draw === 'function') {
      image.draw(ctx, ix, cy);
    } else {
      // HTMLImageElement / HTMLCanvasElement / OffscreenCanvas all
      // accept `drawImage(image, dx, dy)` w/ no source rect.
      try { ctx.drawImage(image, ix, cy); } catch (_) {}
    }
    cy += imgH + gapBetweenImgAndLines;
  }

  // Lines.
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const text = line.text || '';
    const color = line.color || defaultText;
    const align = line.align || opts.align || 'center';
    const tw = Math.max(0, text.length * charW - 1);
    let tx;
    if (align === 'left')       tx = dx + 1 + padding;
    else if (align === 'right') tx = dx + w - 1 - padding - tw;
    else                        tx = dx + 1 + padding + Math.round((innerW - tw) / 2);
    pixelText(ctx, tx, cy, text, { color });
    cy += lineH;
  }
}

// Lazy-create + cache an HTMLImageElement for a URL. Returns the
// element synchronously — render code can hand it directly to
// `tooltip({ image: imageRef('icon.png') })`. The first call kicks
// off the fetch; subsequent calls reuse the same element. A
// not-yet-loaded image makes `drawImage` a no-op (no crash, blank
// space in the bubble until load completes).
const _IMG_CACHE = new Map();
export function imageRef(src) {
  if (_IMG_CACHE.has(src)) return _IMG_CACHE.get(src);
  if (typeof Image === 'undefined') return null;
  const img = new Image();
  img.src = src;
  _IMG_CACHE.set(src, img);
  return img;
}

// Badge — small inline label for counts, tags, status chips.
//   palette: { bg, text, frame? }
//   opts:    { label, padding=1, rounded=2 }
export function badge(ctx, x, y, label, palette, opts = {}) {
  const padding = opts.padding != null ? opts.padding : 1;
  const radius = opts.rounded != null ? opts.rounded : 2;
  const bg = palette.bg || '#a04050';
  const text = palette.text || '#fff';
  const frame = palette.frame;
  if (!label) return;
  const labelW = label.length * 4 - 1;
  const w = labelW + padding * 2 + 2;
  const h = 5 + padding * 2 + 2;
  if (frame) {
    pxRoundedRectFilled(ctx, x, y, w, h, radius, frame);
    pxRoundedRectFilled(ctx, x + 1, y + 1, w - 2, h - 2,
      Math.max(0, radius - 1), bg);
  } else {
    pxRoundedRectFilled(ctx, x, y, w, h, radius, bg);
  }
  pixelText(ctx, x + padding + 1, y + padding + 1, label, { color: text });
  return w;
}

// Section divider — horizontal line with optional centered label
// ("STATS", "SETTINGS"). Use to visually separate panel sections.
//   palette: { line, label }
//   opts:    { label?, lineColor }
export function divider(ctx, x, y, w, palette, opts = {}) {
  const lineCol = palette.line || '#3a4458';
  const labelCol = palette.label || '#7a8aa0';
  const label = opts.label;
  ctx.fillStyle = lineCol;
  if (label) {
    const labelW = label.length * 4 - 1;
    const lineSegW = Math.floor((w - labelW - 8) / 2);
    ctx.fillRect(x, y, lineSegW, 1);
    ctx.fillRect(x + w - lineSegW, y, lineSegW, 1);
    pixelText(ctx, x + lineSegW + 4, y - 2, label, { color: labelCol });
  } else {
    ctx.fillRect(x, y, w, 1);
  }
}

// Input field — placeholder for a text-input box. Renders frame +
// focused state + caret + value text. Caller is responsible for the
// actual input handling (this is just the visual).
//   palette: { frame, bg, bgFocused, text, placeholder, caret }
//   opts:    { value='', placeholder, focused=false, caretBlink=true,
//              t=0, w=auto, padding=2 }
export function inputField(ctx, x, y, w, h, palette, opts = {}) {
  const value = opts.value || '';
  const placeholder = opts.placeholder || '';
  const focused = !!opts.focused;
  const caretBlink = opts.caretBlink !== false;
  const t = opts.t != null ? opts.t : 0;
  const padding = opts.padding != null ? opts.padding : 2;
  const frame = palette.frame || '#0a0e18';
  const bg = focused ? (palette.bgFocused || '#1a2840') : (palette.bg || '#0a1018');
  const text = palette.text || '#fff';
  const phCol = palette.placeholder || '#5a6478';
  const caret = palette.caret || '#80c0ff';
  // Frame + bg.
  pxRoundedRectFilled(ctx, x, y, w, h, 1, frame);
  pxRoundedRectFilled(ctx, x + 1, y + 1, w - 2, h - 2, 0, bg);
  // Focus ring — outer glow.
  if (focused) {
    ctx.fillStyle = caret;
    ctx.fillRect(x, y - 1, w, 1);
    ctx.fillRect(x, y + h, w, 1);
  }
  // Text content.
  const ty = y + Math.floor((h - 5) / 2);
  if (value) {
    pixelText(ctx, x + padding + 1, ty, value, { color: text });
  } else if (placeholder) {
    pixelText(ctx, x + padding + 1, ty, placeholder, { color: phCol });
  }
  // Caret — blinking 1px line at the end of value.
  if (focused && (!caretBlink || (Math.floor(t * 2) & 1) === 0)) {
    const cursorX = x + padding + 1 + (value.length * 4);
    ctx.fillStyle = caret;
    ctx.fillRect(cursorX, ty - 1, 1, 7);
  }
}

// Notification toast — popup label that slides in from the top with
// optional icon and dismiss styling. Caller passes `t` for the slide
// animation (0..1: slide in; 1+: held; near-1-end: slide out).
//   palette: { bg, frame, text, accent? }
//   opts:    { t, label, kind='info'|'success'|'warn'|'error',
//              w=auto, h=14 }
export function notificationToast(ctx, x, y, label, palette, opts = {}) {
  const t = opts.t != null ? opts.t : 0.5;
  const kind = opts.kind || 'info';
  const h = opts.h != null ? opts.h : 14;
  if (!label) return;
  const labelW = label.length * 4 - 1;
  const w = opts.w != null ? opts.w : labelW + 16;
  // Slide animation — from y - h (above) to y (visible).
  let slideY;
  if (t < 0.2) {
    slideY = y - h * (1 - easeOutBack(t / 0.2, 1.8));
  } else if (t < 0.85) {
    slideY = y;
  } else {
    slideY = y - h * easeOutCubic((t - 0.85) / 0.15);
  }
  const dy = Math.round(slideY);
  // Kind-based accent color.
  const accents = {
    info:    '#80c0ff',
    success: '#60ff7a',
    warn:    '#ffd060',
    error:   '#ff5050',
  };
  const accent = palette.accent || accents[kind] || accents.info;
  const bg = palette.bg || '#1a2030';
  const frame = palette.frame || '#0a0e18';
  const text = palette.text || '#fff';
  pxRoundedRectFilled(ctx, x, dy, w, h, 2, frame);
  pxRoundedRectFilled(ctx, x + 1, dy + 1, w - 2, h - 2, 1, bg);
  // Left accent bar — colored stripe.
  ctx.fillStyle = accent;
  ctx.fillRect(x + 1, dy + 1, 2, h - 2);
  // Icon dot — small bright pixel beside the bar.
  ctx.fillRect(x + 5, dy + Math.floor(h / 2) - 1, 2, 2);
  // Label.
  pixelText(ctx, x + 10, dy + Math.floor((h - 5) / 2), label, { color: text });
}

// ─── 8f. Easing helpers ──────────────────────────────────────────
// Pure math — given t ∈ [0, 1], return eased t. Use these to drive
// non-linear motion in any animated primitive.

// Cubic ease-out — fast start, soft landing. Good for slide-in.
export function easeOutCubic(t) {
  const u = 1 - t;
  return 1 - u * u * u;
}

// Back ease-out with overshoot. Pops past 1 then settles. Use for
// pop-in animations (score numbers, lootbox reveals).
export function easeOutBack(t, overshoot) {
  const c1 = overshoot != null ? overshoot : 1.70158;
  const c3 = c1 + 1;
  const u = t - 1;
  return 1 + c3 * u * u * u + c1 * u * u;
}

// Bounce ease-out — landing thump. Use for falling reveals.
export function easeOutBounce(t) {
  const n1 = 7.5625, d1 = 2.75;
  if (t < 1 / d1) return n1 * t * t;
  if (t < 2 / d1) { const u = t - 1.5 / d1; return n1 * u * u + 0.75; }
  if (t < 2.5 / d1) { const u = t - 2.25 / d1; return n1 * u * u + 0.9375; }
  const u = t - 2.625 / d1; return n1 * u * u + 0.984375;
}

// Quadratic ease-in-out — smooth ramp. Use for crossfades.
export function easeInOutQuad(t) {
  return t < 0.5 ? 2 * t * t : 1 - Math.pow(-2 * t + 2, 2) / 2;
}

// ─── 8g. Lootbox / reveal primitives ─────────────────────────────
// Juicy animation building blocks for slot-machine-style reveals.
// Compose them in sequence (rays → spotlight → banner pop → item
// scale-in → stars → counter → confetti) to build the canonical
// "what did I get?!" moment.

// Radial rays — soft, wide, lootbox-style glow rays. Total rewrite
// modeled on the reference: filled circular region with a 3-color
// radial gradient (background red → ray pink → white-yellow center),
// modulated by an angular sin wave that gives the visible "rays."
// No hard wedge boundaries — the rays are smooth angular modulation
// on top of a radial bloom.
//
// Composition:
//   - `palette.bg`     darkest, fills the angular valleys between rays
//   - `palette.color`  mid-tone, fills the ray peaks
//   - `palette.hot`    brightest, used for the center bloom
//
// At any pixel:
//   brightness = radialFalloff * (valleyMin + rayWave * (1 - valleyMin))
//   color = lerp(bg → color → hot) by brightness
//
//   palette: { bg, color, hot }
//   opts:    { t=0, count=12, length=32, innerR=0, spinSpeed=1,
//              valleyMin=0.35, intensity=1, fillBg=true,
//              centerBloom=8 }
//     count       — number of bright rays around the circle.
//     valleyMin   — brightness floor between rays (0 = full dark gaps,
//                   1 = no rays). 0.35 default = soft visible rays.
//     fillBg      — if true, fills the entire circle with bg color
//                   first (so valleys are fully solid). If false,
//                   alpha fades to transparent at edges.
//     centerBloom — radius (px) of the extra-bright hot core in the
//                   middle of the burst.
export function revealRays(ctx, cx, cy, palette, opts = {}) {
  const t = opts.t != null ? opts.t : 0;
  const count = opts.count != null ? opts.count : 12;
  const length = opts.length != null ? opts.length : 32;
  const innerR = opts.innerR != null ? opts.innerR : 0;
  const spinSpeed = opts.spinSpeed != null ? opts.spinSpeed : 1;
  const valleyMin = opts.valleyMin != null ? opts.valleyMin : 0.35;
  const intensity = opts.intensity != null ? opts.intensity : 1;
  const fillBg = opts.fillBg !== false;
  const centerBloom = opts.centerBloom != null ? opts.centerBloom : 8;
  const colorHex = palette.color || '#ff5050';
  const hotHex = palette.hot || '#ffe8a0';
  const parse = (hex) => [
    parseInt(hex.slice(1, 3), 16),
    parseInt(hex.slice(3, 5), 16),
    parseInt(hex.slice(5, 7), 16),
  ];
  const [cR, cG, cB] = parse(colorHex);
  const [hR, hG, hB] = parse(hotHex);
  // bg defaults to a darkened version of `color` (~40% brightness) so
  // callers who pass only `color` + `hot` get a coherent valley tone
  // without having to hand-tune a third color.
  let bR, bG, bB;
  if (palette.bg) {
    [bR, bG, bB] = parse(palette.bg);
  } else {
    bR = Math.round(cR * 0.4);
    bG = Math.round(cG * 0.4);
    bB = Math.round(cB * 0.4);
  }
  const baseAng = t * Math.PI * 2 * spinSpeed;
  const outerR = innerR + length;
  for (let dy = -outerR; dy <= outerR; dy++) {
    for (let dx = -outerR; dx <= outerR; dx++) {
      const d2 = dx * dx + dy * dy;
      if (d2 > outerR * outerR) continue;
      if (innerR > 0 && d2 < innerR * innerR) continue;
      const d = Math.sqrt(d2);
      // Radial falloff — full at center, eased to 0 at outer.
      // Pow 1.0 = linear; the soft visual look comes from the COLOR
      // lerp rather than a steep alpha curve.
      const radialT = Math.min(1, (d - innerR) / length);
      const radial = Math.pow(1 - radialT, 1.1);
      // Angular wave — sin gives smooth peaks/valleys with `count`
      // visible rays. Phase rotates over time via baseAng.
      const ang = Math.atan2(dy, dx);
      const rayWave = Math.sin(ang * count + baseAng) * 0.5 + 0.5; // 0..1
      // Brightness combines radial + ray wave.
      // valleys = radial * valleyMin
      // peaks   = radial * 1.0
      let brightness = radial * (valleyMin + rayWave * (1 - valleyMin));
      brightness *= intensity;
      // Center bloom — extra-bright hot core via a separate radial
      // boost, NOT modulated by the ray wave. So the very middle is
      // smoothly bright (no ray pattern) before the rays take over.
      if (centerBloom > 0 && d < centerBloom) {
        const bloomT = 1 - d / centerBloom;
        const bloomA = Math.pow(bloomT, 1.5) * intensity;
        brightness = Math.max(brightness, bloomA + 0.3);
      }
      // Clamp.
      const b = Math.min(1.6, Math.max(0, brightness));
      // Color: 3-stop lerp.
      //   b in [0, 0.7]   → bg → color
      //   b in [0.7, 1.0] → color → hot
      //   b > 1.0         → all-hot (over-bright cap)
      let r0, g0, b0_;
      if (b >= 1.0) {
        r0 = hR; g0 = hG; b0_ = hB;
      } else if (b >= 0.7) {
        const m = (b - 0.7) / 0.3;
        r0 = cR * (1 - m) + hR * m;
        g0 = cG * (1 - m) + hG * m;
        b0_ = cB * (1 - m) + hB * m;
      } else {
        const m = b / 0.7;
        r0 = bR * (1 - m) + cR * m;
        g0 = bG * (1 - m) + cG * m;
        b0_ = bB * (1 - m) + cB * m;
      }
      // Alpha: full when fillBg, brightness-driven otherwise.
      const a = fillBg ? 1 : Math.min(1, b * 1.5);
      if (a < 0.04) continue;
      ctx.fillStyle = `rgba(${r0|0},${g0|0},${b0_|0},${a.toFixed(3)})`;
      ctx.fillRect(cx + dx, cy + dy, 1, 1);
    }
  }
}

// Spotlight overlay — paints a darkening tint over an entire rect
// EXCEPT inside a circular hot zone at (cx, cy) where alpha falls
// to 0. Use under reveals to draw focus to the prize.
//   opts: { color='#000', alpha=0.7, edgeBlur=3 }
export function revealSpotlight(ctx, x, y, w, h, cx, cy, r, opts = {}) {
  const hex = opts.color || '#000';
  const peakAlpha = opts.alpha != null ? opts.alpha : 0.7;
  const edgeBlur = opts.edgeBlur != null ? opts.edgeBlur : 3;
  const cR = parseInt(hex.slice(1, 3), 16);
  const cG = parseInt(hex.slice(3, 5), 16);
  const cB = parseInt(hex.slice(5, 7), 16);
  // Per-pixel alpha falls off near the spotlight edge.
  for (let dy = 0; dy < h; dy++) {
    for (let dx = 0; dx < w; dx++) {
      const px = x + dx, py = y + dy;
      const ddx = px - cx, ddy = py - cy;
      const d = Math.sqrt(ddx * ddx + ddy * ddy);
      let a;
      if (d < r) a = 0;
      else if (d < r + edgeBlur) a = peakAlpha * ((d - r) / edgeBlur);
      else a = peakAlpha;
      if (a < 0.02) continue;
      ctx.fillStyle = `rgba(${cR},${cG},${cB},${a.toFixed(3)})`;
      ctx.fillRect(px, py, 1, 1);
    }
  }
}

// Reveal banner — chunky 3D scroll-style ribbon with side pennants.
// Bouncy pop-in via easeOutBack, then idle hover with vertical bob.
// Looks like the "BONUS!" / "RARE!" / "JACKPOT!" callouts in the
// reference screenshots — three-tone shaded body, dark frame, optional
// triangular pennant tails on the left/right sides.
//
//   palette: { bg, bgHilite?, bgShadow?, frame, text, glow? }
//   opts:    { t, w=64, h=16, pennants=true, scale=2 (label) }
export function revealBanner(ctx, cx, cy, label, palette, opts = {}) {
  const t = opts.t != null ? opts.t : 0;
  const w = opts.w != null ? opts.w : 64;
  const h = opts.h != null ? opts.h : 16;
  const showPennants = opts.pennants !== false;
  const labelScale = opts.scale != null ? opts.scale : 2;
  const bg = palette.bg || '#ff3030';
  const bgHilite = palette.bgHilite || '#ff8060';
  const bgShadow = palette.bgShadow || '#a01018';
  const frame = palette.frame || '#1a0408';
  const text = palette.text || '#fff8c0';
  const glow = palette.glow;
  // Pop-in scale curve: easeOutBack overshoot, settle by t=0.45.
  let scale;
  if (t < 0.45) {
    scale = easeOutBack(Math.min(1, t / 0.45), 2.4);
  } else {
    // Held — subtle 1.0 ± 0.04 wobble.
    scale = 1 + Math.sin((t - 0.45) * Math.PI * 5) * 0.04;
  }
  if (scale < 0.05) return;
  // Vertical bob while held.
  const bobY = t > 0.45 ? Math.sin((t - 0.45) * Math.PI * 3) * 0.5 : 0;
  const dw = Math.max(8, Math.round(w * scale));
  const dh = Math.max(4, Math.round(h * scale));
  const dx = Math.round(cx - dw / 2);
  const dy = Math.round(cy - dh / 2 + bobY);
  // Outer glow halo.
  if (glow) {
    const gR = parseInt(glow.slice(1, 3), 16);
    const gG = parseInt(glow.slice(3, 5), 16);
    const gB = parseInt(glow.slice(5, 7), 16);
    ctx.fillStyle = `rgba(${gR},${gG},${gB},0.45)`;
    pxRoundedRectFilled(ctx, dx - 3, dy - 3, dw + 6, dh + 6, 4, ctx.fillStyle);
  }
  // Side pennants — triangular tails extending past the main rect.
  if (showPennants && scale > 0.6) {
    const pennLen = Math.round(dh * 0.4);
    ctx.fillStyle = bgShadow;
    // Left pennant — triangle pointing into the body.
    for (let k = 0; k < pennLen; k++) {
      const tipY = dy + Math.floor(dh / 2);
      ctx.fillRect(dx - pennLen + k, tipY - k, 1, k * 2 + 1);
    }
    // Right pennant.
    for (let k = 0; k < pennLen; k++) {
      const tipY = dy + Math.floor(dh / 2);
      ctx.fillRect(dx + dw - 1 + (pennLen - k), tipY - k, 1, k * 2 + 1);
    }
  }
  // Frame (outer dark ring).
  pxRoundedRectFilled(ctx, dx, dy, dw, dh, 2, frame);
  // Body fill.
  pxRoundedRectFilled(ctx, dx + 1, dy + 1, dw - 2, dh - 2, 1, bg);
  // Top hilite strip — bright row across the upper third.
  ctx.fillStyle = bgHilite;
  pxRoundedRectFilled(ctx, dx + 2, dy + 2, dw - 4, Math.max(1, Math.floor(dh / 4)), 0, bgHilite);
  // Bottom shadow band — darker row across the lower third.
  ctx.fillStyle = bgShadow;
  ctx.fillRect(dx + 2, dy + dh - 3, dw - 4, 1);
  // Label centered.
  if (scale > 0.5 && label) {
    const labelW = label.length * 4 * labelScale - labelScale;
    const lx = dx + Math.floor((dw - labelW) / 2);
    const ly = dy + Math.floor((dh - 5 * labelScale) / 2);
    // Drop shadow for the label — 1px down-right in dark color.
    pixelText(ctx, lx + 1, ly + 1, label, { color: frame, scale: labelScale });
    pixelText(ctx, lx, ly, label, { color: text, scale: labelScale });
  }
}

// Star burst — proper 4-point/8-point pixel-art star sprites that
// scatter outward from a center. Each star is a 5×5 (small) or 7×7
// (large) sprite with a bright core, mid halo, and outer accent —
// not just a single pixel + cross.
//
// Star sizes alternate: half are large (7×7 4-point stars with
// extended arms), half are small (3×3 plus-shape twinkles). Sizes
// AND positions seeded so the burst looks varied.
//
//   palette: { core, halo, accent? }
//   opts:    { t, seed=0, count=10, range=22, sizeMix=0.5 }
//     sizeMix — fraction (0..1) of stars rendered as large
export function revealStars(ctx, cx, cy, palette, opts = {}) {
  const t = opts.t != null ? opts.t : 0;
  const seed = opts.seed != null ? opts.seed : 0;
  const count = opts.count != null ? opts.count : 10;
  const range = opts.range != null ? opts.range : 22;
  const sizeMix = opts.sizeMix != null ? opts.sizeMix : 0.5;
  const core = palette.core || '#ffffff';
  const halo = palette.halo || '#ffe080';
  const accent = palette.accent || halo;
  const fade = Math.max(0, 1 - t * 0.8);
  if (fade < 0.05) return;
  ctx.save();
  ctx.globalAlpha = fade;
  for (let i = 0; i < count; i++) {
    const h = _tileHash(seed + i * 41, 0, 0);
    const ang = (i / count) * Math.PI * 2 + ((h & 0xff) / 0xff - 0.5) * 0.6;
    const speed = 0.7 + ((h >>> 8) & 0xff) / 0xff * 0.6;
    const dist = easeOutCubic(t) * range * speed;
    const px = Math.round(cx + Math.cos(ang) * dist);
    const py = Math.round(cy + Math.sin(ang) * dist);
    const isLarge = ((h >>> 16) & 0xff) / 0xff < sizeMix;
    if (isLarge) {
      // 7×7 4-point star: long arms, halo + accent layers, bright core.
      // Outer arm accents (single pixels at length 3).
      ctx.fillStyle = accent;
      ctx.fillRect(px - 3, py, 1, 1);
      ctx.fillRect(px + 3, py, 1, 1);
      ctx.fillRect(px, py - 3, 1, 1);
      ctx.fillRect(px, py + 3, 1, 1);
      // Halo arms (length 2).
      ctx.fillStyle = halo;
      ctx.fillRect(px - 2, py, 1, 1);
      ctx.fillRect(px + 2, py, 1, 1);
      ctx.fillRect(px, py - 2, 1, 1);
      ctx.fillRect(px, py + 2, 1, 1);
      // Inner cross.
      ctx.fillRect(px - 1, py, 1, 1);
      ctx.fillRect(px + 1, py, 1, 1);
      ctx.fillRect(px, py - 1, 1, 1);
      ctx.fillRect(px, py + 1, 1, 1);
      // Bright core.
      ctx.fillStyle = core;
      ctx.fillRect(px, py, 1, 1);
    } else {
      // Small 3-pixel plus + center.
      ctx.fillStyle = halo;
      ctx.fillRect(px - 1, py, 1, 1);
      ctx.fillRect(px + 1, py, 1, 1);
      ctx.fillRect(px, py - 1, 1, 1);
      ctx.fillRect(px, py + 1, 1, 1);
      ctx.fillStyle = core;
      ctx.fillRect(px, py, 1, 1);
    }
  }
  ctx.restore();
}

// Pulsing aura — concentric radial rings behind a reveal subject.
// Rewritten from the per-pixel rgba blend version (which was slow
// and looked muddy). Now: 3-4 distinct rings with hardcoded alpha
// stops, drawn as clean ellipses. Cleaner look, ~10× faster.
//
//   palette: { core, mid?, halo, outer? }
//   opts:    { t, r=18, intensity=1 }
export function revealAura(ctx, cx, cy, palette, opts = {}) {
  const t = opts.t != null ? opts.t : 0;
  const r = opts.r != null ? opts.r : 18;
  const intensity = opts.intensity != null ? opts.intensity : 1;
  const core = palette.core || '#fff8c0';
  const mid = palette.mid || palette.halo || '#ffd060';
  const halo = palette.halo || '#ff8030';
  const outer = palette.outer || halo;
  // Pulse via outer radius — peaks at +20% size every 1.5s.
  const pulse = 1 + Math.sin(t * Math.PI * 3) * 0.2;
  const peakAlpha = intensity * (0.55 + Math.sin(t * Math.PI * 3) * 0.15);
  // Helper: parse hex to rgb.
  const rgb = (hex) => [
    parseInt(hex.slice(1, 3), 16),
    parseInt(hex.slice(3, 5), 16),
    parseInt(hex.slice(5, 7), 16),
  ];
  const [oR, oG, oB] = rgb(outer);
  const [hR, hG, hB] = rgb(halo);
  const [mR, mG, mB] = rgb(mid);
  const [cR, cG, cB] = rgb(core);
  // 4 rings drawn outer-to-inner, decreasing alpha and radius.
  const rings = [
    { r: r * pulse,        a: peakAlpha * 0.20, c: [oR, oG, oB] },
    { r: r * 0.75 * pulse, a: peakAlpha * 0.45, c: [hR, hG, hB] },
    { r: r * 0.5  * pulse, a: peakAlpha * 0.65, c: [mR, mG, mB] },
    { r: r * 0.25 * pulse, a: peakAlpha * 0.90, c: [cR, cG, cB] },
  ];
  for (const ring of rings) {
    if (ring.a < 0.02) continue;
    const rr = Math.round(ring.r);
    if (rr < 1) continue;
    ctx.fillStyle = `rgba(${ring.c[0]},${ring.c[1]},${ring.c[2]},${ring.a.toFixed(3)})`;
    // Filled disc via row-by-row scan.
    for (let dy = -rr; dy <= rr; dy++) {
      const w = Math.round(Math.sqrt(rr * rr - dy * dy));
      if (w < 1) continue;
      ctx.fillRect(cx - w, cy + dy, w * 2 + 1, 1);
    }
  }
}

// Reveal item wrapper — calls a `drawer(ctx, cx, cy, scale)` with an
// animated scale based on `t`. Anticipation (squash) → overshoot pop
// (1.2× then settle to 1.0). Use to wrap any creature/sprite drawer
// for the "pop in" reveal effect.
//   opts: { t=0, drawer, scale=1, holdScale=1 }
//     drawer — fn(ctx, cx, cy, scale)
export function revealItem(ctx, cx, cy, drawer, opts = {}) {
  if (typeof drawer !== 'function') return;
  const t = opts.t != null ? opts.t : 0;
  const finalScale = opts.scale != null ? opts.scale : 1;
  const holdScale = opts.holdScale != null ? opts.holdScale : finalScale;
  let scale;
  if (t < 0.5) {
    // Pop in with overshoot — peaks at 1.25× at t=0.5.
    scale = easeOutBack(t / 0.5, 1.8) * finalScale;
  } else if (t < 0.8) {
    // Settle from overshoot back to hold scale.
    const u = (t - 0.5) / 0.3;
    scale = finalScale + (holdScale - finalScale) * u;
  } else {
    // Hold — gentle bob.
    scale = holdScale + Math.sin((t - 0.8) * Math.PI * 8) * 0.04;
  }
  drawer(ctx, cx, cy, scale);
}

// Reveal counter badge — "1/5" / "RARE" / "x2" small label that pops
// in via easeOutBack and floats slightly when held.
//   palette: { bg, frame, text }
//   opts:    { t, w=22, h=8, label='1/5' }
export function revealCounter(ctx, cx, cy, label, palette, opts = {}) {
  const t = opts.t != null ? opts.t : 0;
  const w = opts.w != null ? opts.w : 22;
  const h = opts.h != null ? opts.h : 8;
  const bg = palette.bg || '#3a4870';
  const frame = palette.frame || '#0a0e18';
  const text = palette.text || '#fff';
  const scale = t < 0.5 ? easeOutBack(t / 0.5, 2.2) : 1;
  if (scale < 0.05) return;
  const dw = Math.max(2, Math.round(w * scale));
  const dh = Math.max(2, Math.round(h * scale));
  const dx = Math.round(cx - dw / 2);
  const dy = Math.round(cy - dh / 2);
  pxRoundedRectFilled(ctx, dx, dy, dw, dh, 1, frame);
  pxRoundedRectFilled(ctx, dx + 1, dy + 1, dw - 2, dh - 2, 0, bg);
  if (scale > 0.7 && label) {
    const labelW = label.length * 4 - 1;
    pixelText(ctx, dx + Math.floor((dw - labelW) / 2),
      dy + Math.floor((dh - 5) / 2), label, { color: text });
  }
}

// Confetti burst — radial party-popper from a single origin. Each
// piece flies outward at a random angle + speed, falls under gravity,
// fading out. Use immediately after a reveal pop for the "celebration"
// moment. Pairs with the falling `confetti` for sustained celebration.
//   palette: { colors: [...] }
//   opts:    { t=0, count=24, seed=0, range=24, gravity=0.7 }
export function confettiBurst(ctx, cx, cy, palette, opts = {}) {
  const t = opts.t != null ? opts.t : 0;
  const count = opts.count != null ? opts.count : 24;
  const seed = opts.seed != null ? opts.seed : 0;
  const range = opts.range != null ? opts.range : 24;
  const gravity = opts.gravity != null ? opts.gravity : 0.7;
  const colors = palette.colors && palette.colors.length
    ? palette.colors
    : ['#ff5050', '#60ff7a', '#60a8ff', '#ffd060', '#ff80c0', '#fff'];
  ctx.save();
  ctx.globalAlpha = Math.max(0.05, 1 - t * 0.7);
  for (let i = 0; i < count; i++) {
    const h = _tileHash(seed + i * 91, 0, 0);
    // Bias upward — most particles fly up + slightly outward.
    const ang = -Math.PI / 2 + ((h & 0xff) / 0xff - 0.5) * Math.PI * 1.2;
    const speed = 0.7 + ((h >>> 8) & 0xff) / 0xff * 0.6;
    const horizDist = t * range * speed;
    const vertDist = Math.sin(ang) * horizDist + (t * t) * range * gravity;
    const px = Math.round(cx + Math.cos(ang) * horizDist);
    const py = Math.round(cy + vertDist);
    ctx.fillStyle = colors[(h >>> 16) % colors.length];
    const sz = 1 + ((h >>> 24) & 1);
    ctx.fillRect(px, py, sz, sz);
    // Streak trail back along velocity for fast-moving pieces.
    if (t < 0.4 && (h >>> 25) & 1) {
      ctx.fillRect(Math.round(px - Math.cos(ang) * 1),
                   Math.round(py - Math.sin(ang) * 1), 1, 1);
    }
  }
  ctx.restore();
}

// Screen shake — apply a small translate offset to ctx based on t.
// Caller must save/restore around the shaken content. Decay shake
// intensity over the lifetime so it tapers to zero by t=1.
//   opts: { t=0, intensity=2, freq=18 }
export function screenShake(ctx, opts = {}) {
  const t = opts.t != null ? opts.t : 0;
  const intensity = opts.intensity != null ? opts.intensity : 2;
  const freq = opts.freq != null ? opts.freq : 18;
  if (t >= 1) return;
  const decay = 1 - t;
  // Two summed sines at different frequencies for organic shake.
  const dx = Math.round(Math.sin(t * Math.PI * freq) * intensity * decay);
  const dy = Math.round(Math.sin(t * Math.PI * freq * 1.3 + 1) * intensity * decay);
  ctx.translate(dx, dy);
}

// Lootbox / chest — animated chest that idles, then shakes with
// anticipation, then bursts open. Driven by `t ∈ [0, 1)`:
//   t < 0.1   — idle (lid closed, just sits there)
//   t < 0.5   — shake (jiggle x/y, light leaks from cracks)
//   t < 0.6   — burst (lid pops up + tilted, bright flash inside)
//   t >= 0.6  — open (lid floats off, light beam emerges from inside)
//
// Caller composes the *contents* (the revealed item) at the chest's
// open mouth using `revealItem` over the same t curve. This primitive
// only renders the chest and the burst light — the prize is the
// caller's job.
//
//   palette: { wood, woodHilite, woodShadow, metal, metalShadow,
//              lock, light }
//   opts:    { t, w=24, h=18 }
export function lootbox(ctx, cx, cy, palette, opts = {}) {
  const t = opts.t != null ? opts.t : 0;
  const w = opts.w != null ? opts.w : 24;
  const h = opts.h != null ? opts.h : 18;
  const wood = palette.wood || '#7a4818';
  const woodH = palette.woodHilite || '#a06830';
  const woodS = palette.woodShadow || '#3a2008';
  const metal = palette.metal || '#d8a040';
  const metalS = palette.metalShadow || '#603a08';
  const lock = palette.lock || '#603a08';
  const light = palette.light || '#fff8c0';
  // Phase + per-phase animation.
  const halfW = Math.floor(w / 2);
  const halfH = Math.floor(h / 2);
  let shakeX = 0, shakeY = 0;
  let lidLift = 0;     // pixels lid is raised
  let lidTilt = 0;     // -1..1
  let crackGlow = 0;   // 0..1 intensity of inner glow leaking out
  let innerFlash = 0;  // 0..1 white flash inside chest
  if (t < 0.1) {
    // Idle.
  } else if (t < 0.5) {
    // Shake — increasing intensity as t approaches 0.5.
    const shakeT = (t - 0.1) / 0.4;
    const decay = shakeT;
    shakeX = Math.round(Math.sin(t * Math.PI * 36) * 1.5 * decay);
    shakeY = Math.round(Math.sin(t * Math.PI * 30 + 1) * 0.7 * decay);
    crackGlow = shakeT * 0.7;
  } else if (t < 0.6) {
    // Burst — lid pops up, bright flash.
    const burstT = (t - 0.5) / 0.1;
    lidLift = Math.round(easeOutBack(burstT, 2) * 4);
    lidTilt = burstT * 0.6;
    crackGlow = 1;
    innerFlash = burstT;
  } else {
    // Open — lid floats away, beam emerges.
    const openT = (t - 0.6) / 0.4;
    lidLift = 4 + Math.round(easeOutCubic(openT) * (h * 0.8));
    lidTilt = 0.6 - openT * 0.3;
    crackGlow = 1 - openT * 0.5;
    innerFlash = 1 - openT * 0.6;
  }
  // Body — shake-offset, bottom 60% of the chest.
  const bx = cx - halfW + shakeX;
  const by = cy - halfH + shakeY;
  const bodyH = Math.floor(h * 0.6);
  const bodyY = by + (h - bodyH);
  ctx.fillStyle = wood;
  ctx.fillRect(bx, bodyY, w, bodyH);
  // Wood plank seams.
  ctx.fillStyle = woodS;
  for (let dx = 4; dx < w; dx += 4) ctx.fillRect(bx + dx, bodyY + 1, 1, bodyH - 2);
  // Top + bottom highlights/shadows.
  ctx.fillStyle = woodH;
  ctx.fillRect(bx, bodyY, w, 1);
  ctx.fillStyle = woodS;
  ctx.fillRect(bx, bodyY + bodyH - 1, w, 1);
  // Metal banding.
  ctx.fillStyle = metal;
  ctx.fillRect(bx + 2, bodyY + 2, w - 4, 2);
  ctx.fillRect(bx + 2, bodyY + bodyH - 4, w - 4, 2);
  ctx.fillStyle = metalS;
  ctx.fillRect(bx + 2, bodyY + 4, w - 4, 1);
  ctx.fillRect(bx + 2, bodyY + bodyH - 2, w - 4, 1);
  // Inner flash — bright glow inside the chest mouth (visible as the
  // lid lifts).
  if (innerFlash > 0.05 && lidLift > 1) {
    const flashA = innerFlash;
    const fR = parseInt(light.slice(1, 3), 16);
    const fG = parseInt(light.slice(3, 5), 16);
    const fB = parseInt(light.slice(5, 7), 16);
    ctx.fillStyle = `rgba(${fR},${fG},${fB},${flashA.toFixed(3)})`;
    ctx.fillRect(bx + 1, bodyY - lidLift + 2, w - 2, lidLift);
    // Bright vertical beam shooting up.
    if (t > 0.55) {
      const beamH = Math.round((t - 0.55) / 0.45 * h * 1.5);
      ctx.fillStyle = `rgba(${fR},${fG},${fB},${(flashA * 0.5).toFixed(3)})`;
      ctx.fillRect(bx + halfW - 2, bodyY - lidLift - beamH, 4, beamH);
      ctx.fillStyle = light;
      ctx.fillRect(bx + halfW, bodyY - lidLift - beamH, 1, beamH);
    }
  }
  // Crack glow — light leaking through the lid seam during shake.
  if (crackGlow > 0.05 && lidLift < 2) {
    const cR = parseInt(light.slice(1, 3), 16);
    const cG = parseInt(light.slice(3, 5), 16);
    const cB = parseInt(light.slice(5, 7), 16);
    const a = crackGlow * (0.5 + Math.sin(t * Math.PI * 24) * 0.2);
    ctx.fillStyle = `rgba(${cR},${cG},${cB},${a.toFixed(3)})`;
    ctx.fillRect(bx + 1, bodyY - 1, w - 2, 1);
  }
  // Lid — top 40% of the chest, with lift + tilt.
  const lidH = h - bodyH;
  const lidY = by - lidLift;
  const tiltOffset = Math.round(lidTilt * lidH);
  ctx.fillStyle = wood;
  ctx.fillRect(bx, lidY, w, lidH);
  // Lid plank seams.
  ctx.fillStyle = woodS;
  for (let dx = 4; dx < w; dx += 4) ctx.fillRect(bx + dx, lidY + 1, 1, lidH - 2);
  // Lid top hilite + bottom shadow.
  ctx.fillStyle = woodH;
  ctx.fillRect(bx + 1 + tiltOffset, lidY, w - 2 - tiltOffset * 2, 1);
  ctx.fillStyle = woodS;
  ctx.fillRect(bx, lidY + lidH - 1, w, 1);
  // Lock plate — center of lid.
  ctx.fillStyle = metal;
  ctx.fillRect(bx + halfW - 2, lidY + Math.floor(lidH / 2), 4, 3);
  ctx.fillStyle = lock;
  ctx.fillRect(bx + halfW - 1, lidY + Math.floor(lidH / 2) + 1, 2, 1);
}

// Confetti — falling colored squares from the top of a rect. Each
// piece has its own phase, color, and slight horizontal drift.
//   palette: { colors: [...] }
//   opts:    { t=0, count=20, seed=0 }
export function confetti(ctx, x, y, w, h, palette, opts = {}) {
  const t = opts.t != null ? opts.t : 0;
  const count = opts.count != null ? opts.count : 20;
  const seed = opts.seed != null ? opts.seed : 0;
  const colors = palette.colors && palette.colors.length
    ? palette.colors
    : ['#ff5050', '#60ff7a', '#60a8ff', '#ffd060', '#ff80c0'];
  for (let i = 0; i < count; i++) {
    const ph = _tileHash(seed + i * 91, 0, 0);
    // Each piece has its own phase offset, so they fall staggered.
    const myT = (t + (ph & 0xff) / 0xff) % 1;
    const px = x + ((ph >>> 8) & 0xff) % w
              + Math.round(Math.sin(myT * Math.PI * 2 + i) * 3);
    const py = y + Math.round(myT * h);
    if (py > y + h - 1) continue;
    ctx.fillStyle = colors[(ph >>> 16) % colors.length];
    // Squares vary 1-2 px size.
    const sz = 1 + ((ph >>> 24) & 1);
    ctx.fillRect(px, py, sz, sz);
  }
}

// Number popup — large pixel-text number that pops in at scale 0
// with overshoot, holds, then drifts upward + fades. Use for damage
// numbers, score increments, gold gained.
//   palette: { color, stroke?, glow? }
//   opts:    { t=0, value, scale=2 }
export function numberPop(ctx, cx, cy, value, palette, opts = {}) {
  const t = opts.t != null ? opts.t : 0;
  const baseScale = opts.scale != null ? opts.scale : 2;
  const color = palette.color || '#ffd060';
  const stroke = palette.stroke;
  const str = String(value);
  // Scale: pop in 0..0.3, hold + drift 0.3..0.7, fade 0.7..1.
  let scale, alpha, yOff;
  if (t < 0.3) {
    scale = easeOutBack(t / 0.3, 2.5) * baseScale;
    alpha = 1;
    yOff = 0;
  } else if (t < 0.7) {
    scale = baseScale;
    alpha = 1;
    yOff = -((t - 0.3) / 0.4) * 4;
  } else {
    scale = baseScale * (1 - (t - 0.7) * 0.3);
    alpha = 1 - (t - 0.7) / 0.3;
    yOff = -4 - ((t - 0.7) / 0.3) * 6;
  }
  if (alpha <= 0 || scale <= 0) return;
  const labelW = str.length * 4 * scale;
  const lx = Math.round(cx - labelW / 2);
  const ly = Math.round(cy + yOff);
  ctx.save();
  ctx.globalAlpha = alpha;
  // Optional 1-px stroke outline.
  if (stroke) {
    pixelText(ctx, lx - 1, ly,     str, { color: stroke, scale });
    pixelText(ctx, lx + 1, ly,     str, { color: stroke, scale });
    pixelText(ctx, lx,     ly - 1, str, { color: stroke, scale });
    pixelText(ctx, lx,     ly + 1, str, { color: stroke, scale });
  }
  pixelText(ctx, lx, ly, str, { color, scale });
  ctx.restore();
}

// ─── 8h. Slot machine spinning ───────────────────────────────────
//
// Animation contract for slot primitives:
// - `t` ∈ [0, 1) drives the entire spin (caller derives from elapsed/duration).
// - `opts.spinUntil` (default 0.85) splits spin (0..spinUntil) from
//   reveal (spinUntil..1).
// - Internal eased curve is `1 - (1-spinT)^4` (easeOutQuart).
//
// Phase reporting — `slotPhase(t, opts)` returns the current named
// phase. Use this to trigger sound effects or game events on
// transition (poll it each frame, compare to last frame's value):
//
//   const phase = slotPhase(t, { spinUntil: 0.85 });
//   if (phase !== reel._lastPhase) {
//     if (phase === 'decel')    playSound('slot-friction');
//     if (phase === 'landing')  playSound('slot-click');
//     if (phase === 'reveal')   playSound('slot-fanfare');
//     reel._lastPhase = phase;
//   }
//
// Phases (in order):
//   'idle'      — t <= 0
//   'spin'      — fast scroll, full velocity
//   'decel'     — eased deceleration, slowing visibly
//   'landing'   — within ~10% of spinUntil; the "click" moment
//   'reveal'    — past spinUntil; pop animation playing
//   'held'      — t >= 1 (or near it); pop has settled
//
// ── Per-tick events (UIScene wrapper only) ──
// Phase transitions fire ~3-4 times per spin (broad strokes). For
// finer-grained "click as each item rolls past" sound, route
// through UIScene's `slotReel/slotRow/slotWheel` wrappers, which
// expose `tick` (one-frame per item-cell crossing) + `velocity`
// (0..1, decays with the eased curve) on the returned state. That
// gives ~10-30 ticks per spin scaling with item count + passes,
// letting you pitch-shift a single short sample down as the reel
// lands. Pure-pixelart callers (no UIScene) can compute the same
// from `scrollPx = (1 - (1-t)^4) * itemCount * passes * itemH`
// and watching `floor(scrollPx / itemH)` cross integers.
export function slotPhase(t, opts = {}) {
  const spinUntil = opts.spinUntil != null ? opts.spinUntil : 0.85;
  if (t <= 0) return 'idle';
  // Within the spin window (0..spinUntil), split spin / decel.
  if (t < spinUntil) {
    const spinT = t / spinUntil;
    if (spinT < 0.5) return 'spin';
    if (spinT < 0.9) return 'decel';
    return 'landing';
  }
  // After spinUntil — reveal pop, then held.
  const settleT = (t - spinUntil) / (1 - spinUntil);
  if (settleT < 0.6) return 'reveal';
  return 'held';
}

// Internal helper: motion-blur ghost rendering. Draws `n` ghost copies
// of `drawer` above the current position with decreasing alpha, then
// the crisp item at the actual position.
//   `velocity` 0..1 — drives ghost count and offset strength.
function _slotMotionBlur(ctx, drawer, cx, cy, scale, velocity) {
  if (velocity < 0.05) {
    drawer(ctx, cx, cy, scale);
    return;
  }
  const ghosts = Math.max(1, Math.round(velocity * 4));
  ctx.save();
  for (let g = ghosts; g >= 1; g--) {
    const offY = Math.round(g * velocity * 3);
    ctx.globalAlpha = 0.35 * (1 - g / (ghosts + 1));
    drawer(ctx, cx, cy + offY, scale);
  }
  ctx.restore();
  drawer(ctx, cx, cy, scale);
}
// Vertical-scrolling slot reels with caller-injected items. Each
// item is a small object the reel cycles through; the reel
// decelerates over `t ∈ [0, 1]` and settles on a target item at
// t=1. `slotRow` composes multiple reels with staggered stops for
// the canonical "BAR-BAR-BAR" pull.

// Single slot reel — vertical scrolling list of items in a fixed
// window. Items are caller-supplied:
//
//   const items = [
//     { drawer: (c, cx, cy, s) => softBlob(c, cx, cy, 5*s, 4*s, slimePal),
//       color: '#3a8030', label: 'SLIME' },
//     { drawer: drawCoral, color: '#a04050', label: 'CORAL' },
//     ...
//   ];
//   slotReel(ctx, x, y, w, h, items, t, palette, { targetIdx: 2 });
//
// Behavior: at t=0 the reel sits on items[0]; over t=0..1 it scrolls
// past `passes` full cycles, decelerating via easeOutQuart, then
// lands centered on items[targetIdx] at t=1. Caller is responsible
// for animating `t` (e.g., `(elapsed / spinDurationMs)`).
//
// ── Easing curves (load-bearing — UIScene mirrors these) ──
// scroll position:  scrollPx = (1 - (1-t)^4) * (items.length * passes + targetIdx) * itemH
// instantaneous velocity (peaks 4 at t=0, 0 at t=1):  4 * (1-t)^3
// Anyone reading scroll position out-of-band — UIScene's
// `_detectSlotTicks` uses these formulas to fire per-item-cell
// crossing events ("click sound as items roll past") and to expose
// a 0..1 normalized `velocity` for audio pitch/volume modulation.
// If you change the easing here, update UIScene's detector to match.
//
//   palette: { bg, frame, text, highlight? }
//   opts:    { itemH=h, targetIdx=last, passes=3, highlightCenter=true,
//              showLabels=true }
export function slotReel(ctx, x, y, w, h, items, t, palette, opts = {}) {
  if (!items || items.length === 0) return;
  const itemH = opts.itemH != null ? opts.itemH : h;
  const targetIdx = opts.targetIdx != null
    ? ((opts.targetIdx % items.length) + items.length) % items.length
    : items.length - 1;
  const passes = opts.passes != null ? opts.passes : 3;
  const showLabels = opts.showLabels !== false;
  const blurEnabled = opts.motionBlur !== false;
  const bg = palette.bg || '#0a0e18';
  const frame = palette.frame || '#3a4458';
  const text = palette.text || '#fff';
  const highlight = palette.highlight || '#fff080';
  // Eased scroll position + velocity (derivative of eased curve).
  // velocity peaks at 4 at t=0, decays to 0 at t=1 → drives motion blur.
  const tt = Math.max(0, Math.min(1, t));
  const eased = 1 - Math.pow(1 - tt, 4);
  const velocity = 4 * Math.pow(1 - tt, 3);   // 4 at t=0, 0 at t=1
  const totalScroll = (items.length * passes + targetIdx) * itemH;
  const scrollPx = eased * totalScroll;
  // Normalized blur strength 0..1 — used to scale ghost-copy offsets.
  const blurStrength = blurEnabled ? Math.min(1, velocity / 4) : 0;
  ctx.save();
  ctx.beginPath();
  ctx.rect(x, y, w, h);
  ctx.clip();
  ctx.fillStyle = bg;
  ctx.fillRect(x, y, w, h);
  const centerY = y + Math.floor(h / 2);
  const offsetWithinItem = scrollPx % itemH;
  const firstVisibleIdxFloat = scrollPx / itemH;
  const firstVisibleIdx = Math.floor(firstVisibleIdxFloat);
  for (let off = -2; off <= 2; off++) {
    const idx = ((firstVisibleIdx + off) % items.length + items.length) % items.length;
    const item = items[idx];
    // Center the target item exactly on the highlight row at t=1.
    // The previous formula added `+ itemH/2`, which shifted every
    // item down by half a cell — the targetIdx item ended up
    // straddling the bottom edge of the highlight row instead of
    // sitting inside it, so its label rendered half-clipped below.
    const itemCY = centerY + off * itemH - offsetWithinItem;
    if (itemCY + itemH / 2 < y || itemCY - itemH / 2 > y + h) continue;
    if (item.color) {
      ctx.fillStyle = item.color;
      ctx.fillRect(x + 1, Math.round(itemCY - itemH / 2) + 1,
                   w - 2, itemH - 2);
    }
    if (item.drawer) {
      _slotMotionBlur(ctx, item.drawer,
        x + w / 2, Math.round(itemCY) - 1, 1, blurStrength);
    }
    if (showLabels && item.label && itemH >= 14 && blurStrength < 0.3) {
      const lbl = item.label;
      const lw = lbl.length * 4 - 1;
      pixelText(ctx, Math.round(x + (w - lw) / 2),
                Math.round(itemCY + itemH / 2 - 7),
                lbl, { color: item.labelColor || text });
    }
  }
  // Lock flash — bright white pulse at the moment of landing
  // (transition from spin to settle). Brief, fades over 8% of t.
  const phase = slotPhase(t, opts);
  if (phase === 'landing') {
    const flashT = (t - 0.9 * (opts.spinUntil != null ? opts.spinUntil : 0.85)) /
                   (0.1 * (opts.spinUntil != null ? opts.spinUntil : 0.85));
    const flashAlpha = Math.max(0, 1 - flashT) * 0.6;
    if (flashAlpha > 0.05) {
      ctx.fillStyle = `rgba(255,255,255,${flashAlpha.toFixed(3)})`;
      ctx.fillRect(x, y, w, h);
    }
  }
  ctx.restore();
  // Frame.
  ctx.fillStyle = frame;
  ctx.fillRect(x, y, w, 1);
  ctx.fillRect(x, y + h - 1, w, 1);
  ctx.fillRect(x, y, 1, h);
  ctx.fillRect(x + w - 1, y, 1, h);
  // Center-row highlight.
  if (opts.highlightCenter !== false) {
    const hY1 = y + Math.floor(h / 2) - Math.floor(itemH / 2);
    const hY2 = hY1 + itemH;
    ctx.fillStyle = highlight;
    ctx.fillRect(x, hY1, w, 1);
    ctx.fillRect(x, hY2 - 1, w, 1);
  }
  // Vertical motion lines on the side frames during fast spin —
  // implies blurred motion of the items inside.
  if (blurStrength > 0.3) {
    ctx.fillStyle = palette.motionLine || '#7a8aa0';
    const lineCount = Math.round(blurStrength * 4);
    for (let i = 0; i < lineCount; i++) {
      const ly = y + 2 + ((scrollPx + i * 7) % (h - 4));
      // Left side.
      ctx.fillRect(x + 1, Math.round(ly), 1, 2);
      // Right side.
      ctx.fillRect(x + w - 2, Math.round(ly), 1, 2);
    }
  }
}

// Multi-reel row — composes N `slotReel`s side-by-side with staggered
// stops. Each reel's local progress is gated by its index: reel 0
// stops at t=stopAt[0], reel 1 stops at stopAt[1], etc. Use for the
// canonical "click-click-click" 3-reel pull where each reel locks in
// sequence.
//
//   reels: array of { items, targetIdx } objects (one per reel)
//   palette: same as slotReel + opts pass-through
//   opts:    { gap=2, reelW, reelH, itemH, stopAt? }
//     stopAt — array of t values (0..1) when each reel stops.
//              Default: evenly spaced (0.4, 0.7, 1.0 for 3 reels).
//              Each reel's local t runs from 0..1 over its stop window.
export function slotRow(ctx, x, y, reels, t, palette, opts = {}) {
  if (!reels || reels.length === 0) return;
  const gap = opts.gap != null ? opts.gap : 2;
  const reelW = opts.reelW != null ? opts.reelW : 24;
  const reelH = opts.reelH != null ? opts.reelH : 48;
  const itemH = opts.itemH != null ? opts.itemH : 16;
  // Default stopAt — evenly-spaced final stops, e.g. 3 reels: 0.6, 0.8, 1.0.
  // First reel stops earliest (snappier feel); subsequent reels delay
  // to add suspense.
  const stopAt = opts.stopAt || reels.map((_, i) =>
    0.4 + (i + 1) * (0.6 / reels.length));
  for (let i = 0; i < reels.length; i++) {
    const reel = reels[i];
    const localStop = stopAt[i];
    // Local t — global t mapped to this reel's stop window.
    const localT = Math.min(1, t / localStop);
    slotReel(ctx,
      x + i * (reelW + gap), y, reelW, reelH,
      reel.items, localT, palette,
      {
        targetIdx: reel.targetIdx,
        itemH,
        passes: opts.passes,
        highlightCenter: opts.highlightCenter,
        showLabels: opts.showLabels,
      });
  }
}

// Slot result — checks if all reels landed on the same item index
// and, if so, draws a winning flash effect over the reel row. Caller
// is responsible for figuring out target indices BEFORE calling
// slotRow; this is just a visual-feedback overlay.
//
//   reels: same array passed to slotRow (uses targetIdx fields)
//   opts:  { x, y, w, h (the reel-row bbox), t (0..1 post-spin
//            elapsed), palette: { winColor, winBg } }
export function slotWinFlash(ctx, x, y, w, h, reels, t, palette, opts = {}) {
  if (t <= 0 || t >= 1) return;
  if (!reels || reels.length === 0) return;
  // All same target index = win.
  const target = reels[0].targetIdx;
  const isWin = reels.every(r => r.targetIdx === target);
  if (!isWin) return;
  const winColor = palette.winColor || '#fff080';
  const winBg = palette.winBg || '#ffd060';
  // Pulsing yellow flash — opacity drops from 0.6 to 0 over the
  // animation, with a fast 6Hz strobe overlay.
  const fade = 1 - t;
  const strobe = (Math.sin(t * Math.PI * 12) + 1) / 2;
  const fillA = fade * 0.4 + strobe * 0.2;
  const wR = parseInt(winBg.slice(1, 3), 16);
  const wG = parseInt(winBg.slice(3, 5), 16);
  const wB = parseInt(winBg.slice(5, 7), 16);
  ctx.fillStyle = `rgba(${wR},${wG},${wB},${fillA.toFixed(3)})`;
  ctx.fillRect(x, y, w, h);
  // Bright outline frame.
  ctx.fillStyle = winColor;
  ctx.fillRect(x - 1, y - 1, w + 2, 1);
  ctx.fillRect(x - 1, y + h, w + 2, 1);
  ctx.fillRect(x - 1, y - 1, 1, h + 2);
  ctx.fillRect(x + w, y - 1, 1, h + 2);
  // "WIN!" label that pops in via easeOutBack — call inside the post-
  // spin window only.
  if (t > 0.05) {
    const labelT = Math.min(1, (t - 0.05) / 0.4);
    revealBanner(ctx, x + w / 2, y - 8, 'WIN!',
      { bg: winBg, frame: '#1a0408', text: '#fff', glow: winColor },
      { t: labelT, w: 28, h: 9, pennants: false, scale: 1 });
  }
}

// Arrow primitive — single-color triangle pointing in a cardinal
// direction. Used by slotWheel + can be reused for any other UI
// indicator that wants a chevron / pointer.
//   dir: 'L' | 'R' | 'U' | 'D'
//   opts: { size=4 }
export function arrow(ctx, tipX, tipY, dir, color, opts = {}) {
  const size = opts.size != null ? opts.size : 4;
  ctx.fillStyle = color;
  for (let col = 0; col < size; col++) {
    const halfH = col;
    if (dir === 'R') {
      // Tip on right; columns extend LEFT, growing taller.
      ctx.fillRect(tipX - col, tipY - halfH, 1, halfH * 2 + 1);
    } else if (dir === 'L') {
      // Tip on left; columns extend RIGHT, growing taller.
      ctx.fillRect(tipX + col, tipY - halfH, 1, halfH * 2 + 1);
    } else if (dir === 'D') {
      ctx.fillRect(tipX - halfH, tipY - col, halfH * 2 + 1, 1);
    } else { /* 'U' */
      ctx.fillRect(tipX - halfH, tipY + col, halfH * 2 + 1, 1);
    }
  }
}

// Slot wheel — minimalist single-reel variant. Differences from
// `slotReel`:
//   • NO per-item color backgrounds (items render on the wheel's
//     single bg, with the drawer alone defining the silhouette)
//   • Animated arrows pointing inward from both sides at the center
//     row, bobbing during spin
//   • When the wheel settles on the target, the centered item is
//     redrawn at `popScale` (default 1.6×) for a "this is your prize"
//     emphasis
//
//   palette: { bg, frame, arrow }
//   opts:    { itemH, targetIdx, passes=3, spinUntil=0.85,
//              popScale=1.6, arrowSize=4, arrowBob=2 }
//     spinUntil — t value at which the spin completes; t > spinUntil
//                 enters the "settle pop" phase where the target is
//                 drawn enlarged.
//
// ── Easing curves (shared with slotReel) ──
// Same scroll math as `slotReel`: `scrollPx = (1 - (1-t)^4) * (items.length * passes + targetIdx) * itemH`
// during the spin window (`t < spinUntil`), then the settled-pop
// branch takes over. UIScene's `_detectSlotTicks` uses this curve
// to fire per-cell tick events + a 0..1 velocity that's piped into
// audio rate/pitch for the classic decelerating-clicks sound.
// Pop reveal (settle phase) is a separate animation — when the
// caller wants a sound at the moment of pop, gate on the slot
// state's `landed` (one-frame trigger when t crosses 1).
export function slotWheel(ctx, x, y, w, h, items, t, palette, opts = {}) {
  if (!items || items.length === 0) return;
  const itemH = opts.itemH != null ? opts.itemH : Math.floor(h / 3);
  const targetIdx = opts.targetIdx != null
    ? ((opts.targetIdx % items.length) + items.length) % items.length
    : 0;
  const passes = opts.passes != null ? opts.passes : 3;
  const spinUntil = opts.spinUntil != null ? opts.spinUntil : 0.85;
  const popScale = opts.popScale != null ? opts.popScale : 1.6;
  const arrowSize = opts.arrowSize != null ? opts.arrowSize : 4;
  const arrowBobMax = opts.arrowBob != null ? opts.arrowBob : 2;
  const blurEnabled = opts.motionBlur !== false;
  // bg / frame respect explicit `null` as "skip this layer entirely",
  // so callers can render a transparent wheel that overlays game
  // content. `palette.bg === null` skips the backdrop fill;
  // `palette.frame === null` skips the 1px outline.
  const bg = palette.bg === null ? null : (palette.bg || '#0a0e18');
  const frame = palette.frame === null ? null : (palette.frame || '#3a4458');
  const arrowCol = palette.arrow || '#fff080';
  const cy = y + Math.floor(h / 2);
  // Spin progress + velocity (drives motion blur intensity).
  const spinT = Math.min(1, t / spinUntil);
  const eased = 1 - Math.pow(1 - spinT, 4);
  const velocity = 4 * Math.pow(1 - spinT, 3);
  const totalScroll = (items.length * passes + targetIdx) * itemH;
  const scrollPx = eased * totalScroll;
  const isSettled = t >= spinUntil;
  const blurStrength = blurEnabled && !isSettled ? Math.min(1, velocity / 4) : 0;
  ctx.save();
  ctx.beginPath();
  ctx.rect(x, y, w, h);
  ctx.clip();
  if (bg !== null) {
    ctx.fillStyle = bg;
    ctx.fillRect(x, y, w, h);
  }
  if (!isSettled) {
    const offsetWithinItem = scrollPx % itemH;
    const firstVisibleIdx = Math.floor(scrollPx / itemH);
    for (let off = -2; off <= 2; off++) {
      const idx = ((firstVisibleIdx + off) % items.length + items.length) % items.length;
      const item = items[idx];
      // Same centering fix as slotReel — drop the `+ itemH/2` so
      // items pass through the viewport center instead of being
      // shifted half a cell down. The earlier formula left the
      // landing item half-clipped below the wheel's middle line.
      const itemCY = cy + off * itemH - offsetWithinItem;
      if (itemCY + itemH / 2 < y || itemCY - itemH / 2 > y + h) continue;
      if (item.drawer) {
        _slotMotionBlur(ctx, item.drawer,
          x + w / 2, Math.round(itemCY) - 1, 1, blurStrength);
      }
    }
  } else {
    // Settled — pop animation with bounce + slight shake.
    const settleT = (t - spinUntil) / (1 - spinUntil);
    let scaleNow;
    if (settleT < 0.5) {
      const popT = easeOutBack(settleT / 0.5, 2.5);
      scaleNow = 1 + (popScale - 1) * popT;
    } else {
      scaleNow = popScale + Math.sin((settleT - 0.5) * Math.PI * 4) * 0.07;
    }
    // Pop shake — small horizontal jitter only on the early pop frames.
    const shakeMag = settleT < 0.3 ? Math.sin(settleT * Math.PI * 16) * (1 - settleT / 0.3) * 1.5 : 0;
    const shakeX = Math.round(shakeMag);
    const target = items[targetIdx];
    if (target.drawer) {
      target.drawer(ctx, x + w / 2 + shakeX, cy, scaleNow);
    }
    if (target.label) {
      const lw = target.label.length * 4 - 1;
      pixelText(ctx, Math.round(x + (w - lw) / 2),
                y + h - 7, target.label,
                { color: target.labelColor || '#fff' });
    }
  }
  // Lock flash on landing — bright white pulse during the
  // 'landing' phase, fading out as we cross into 'reveal'.
  const phase = slotPhase(t, opts);
  if (phase === 'landing' || (phase === 'reveal' && t < spinUntil + 0.05)) {
    let flashAlpha;
    if (phase === 'landing') {
      const lt = (t / spinUntil - 0.9) / 0.1;
      flashAlpha = lt * 0.7;
    } else {
      // Brief overshoot fade after spin ends.
      const ot = (t - spinUntil) / 0.05;
      flashAlpha = (1 - ot) * 0.7;
    }
    if (flashAlpha > 0.05) {
      ctx.fillStyle = `rgba(255,255,200,${flashAlpha.toFixed(3)})`;
      ctx.fillRect(x, y, w, h);
    }
  }
  ctx.restore();
  // Frame — skipped when `palette.frame === null`, useful for
  // transparent overlays that don't want a hard outline.
  if (frame !== null) {
    ctx.fillStyle = frame;
    ctx.fillRect(x, y, w, 1);
    ctx.fillRect(x, y + h - 1, w, 1);
    ctx.fillRect(x, y, 1, h);
    ctx.fillRect(x + w - 1, y, 1, h);
  }
  // Center-row faint highlight bands.
  if (!isSettled) {
    const hY1 = cy - Math.floor(itemH / 2);
    const hY2 = cy + Math.floor(itemH / 2);
    ctx.fillStyle = arrowCol;
    ctx.fillRect(x + 1, hY1, w - 2, 1);
    ctx.fillRect(x + 1, hY2 - 1, w - 2, 1);
  }
  // Side motion lines during fast spin — extra blur cue.
  if (blurStrength > 0.3) {
    ctx.fillStyle = palette.motionLine || '#7a8aa0';
    const lineCount = Math.round(blurStrength * 4);
    for (let i = 0; i < lineCount; i++) {
      const ly = y + 2 + ((scrollPx + i * 7) % (h - 4));
      ctx.fillRect(x + 1, Math.round(ly), 1, 2);
      ctx.fillRect(x + w - 2, Math.round(ly), 1, 2);
    }
  }
  // Animated arrows — bob during spin, retreat-and-settle on lock.
  let bob;
  if (!isSettled) {
    // Bob frequency scales with velocity — fast at start, slow at end.
    const bobFreq = 6 + velocity * 6;
    bob = (Math.sin(t * Math.PI * bobFreq) + 1) / 2 * arrowBobMax;
  } else {
    const settleT = (t - spinUntil) / (1 - spinUntil);
    bob = Math.max(0, Math.sin(settleT * Math.PI) * arrowBobMax * 1.5);
  }
  // Arrows brighten + grow slightly on lock (subtle juice).
  const arrowSizeNow = isSettled ? arrowSize + 1 : arrowSize;
  arrow(ctx, x - 2 - Math.round(bob), cy, 'R', arrowCol, { size: arrowSizeNow });
  arrow(ctx, x + w + 1 + Math.round(bob), cy, 'L', arrowCol, { size: arrowSizeNow });
  // Reveal sparkles — small star pixels around the popped item during
  // the early reveal phase. Adds a final layer of juice.
  if (phase === 'reveal') {
    const settleT = (t - spinUntil) / (1 - spinUntil);
    if (settleT < 0.7) {
      const sparkT = Math.min(1, settleT / 0.4);
      revealStars(ctx, x + w / 2, cy,
        { core: '#fff', halo: arrowCol },
        { t: sparkT, count: 8, range: Math.floor(w * 0.7), seed: targetIdx });
    }
  }
}

// ─── 9. Palette factories ─────────────────────────────────────────
// Three-stop palette from a body color — auto-derives shadow + hilite.
// `darken/lighten` = 0..1 fraction toward black/white. Useful when you
// don't want to hand-pick all three stops for a quick layer.
export function paletteFromBody(body, opts = {}) {
  const darken  = opts.darken  != null ? opts.darken  : 0.35;
  const lighten = opts.lighten != null ? opts.lighten : 0.35;
  const r = parseInt(body.slice(1, 3), 16);
  const g = parseInt(body.slice(3, 5), 16);
  const b = parseInt(body.slice(5, 7), 16);
  const hex = (n) => Math.max(0, Math.min(255, Math.round(n)))
                       .toString(16).padStart(2, '0');
  const shadow = '#' +
    hex(r * (1 - darken)) + hex(g * (1 - darken)) + hex(b * (1 - darken));
  const hilite = '#' +
    hex(r + (255 - r) * lighten) + hex(g + (255 - g) * lighten) +
    hex(b + (255 - b) * lighten);
  return { shadow, body, hilite };
}

// ─── 10. Organic creature primitives ──────────────────────────────
// Pixel-art creatures need shapes that DON'T read as rectangles. The
// rect-based vocabulary above is for hardware (lockers, guns, crates);
// the helpers below are for soft bodies (slimes, beasts, spores). Key
// techniques: filled ellipses with bottom-belly highlight, eyes with
// proper sclera/pupil/glint stack, ragged-edge fur, tapered tentacles
// with curve, segmented limbs, mood-bearing mouths.

// Filled ellipse — pixel-perfect, no AA. The atom for soft bodies.
// Use directly for one-color blobs; layer two with different rx/ry
// for cheap volumetric shading.
// Shadow — drop shadow under objects.
//   palette = { color? }   — hex shadow color (default '#000')
//   opts.shape  — 'oval' (default), 'tight', 'long', 'square'
//   opts.width  — horizontal span in px (default 8)
//   opts.height — vertical span in px (default 3)
//   opts.alpha  — peak opacity 0..1 (default 0.45)
//   opts.gradient — soft falloff (default true)
//   opts.angle  — cast direction for 'long' shape (default π/4)
//   opts.length — cast distance for 'long' shape (default 16)
export function shadow(ctx, cx, cy, palette = {}, opts = {}) {
  const shape    = opts.shape    || 'oval';
  const sw       = opts.width   != null ? opts.width   : 8;
  const sh       = opts.height  != null ? opts.height  : 3;
  const alpha    = opts.alpha   != null ? opts.alpha   : 0.45;
  const gradient = opts.gradient !== false;
  const hex      = palette.color || '#000';
  const angle    = opts.angle   != null ? opts.angle   : Math.PI / 4;
  const len      = opts.length  != null ? opts.length  : 16;

  // Build rgba from hex color + alpha.
  const rgba = (a) => {
    const r = parseInt(hex.slice(1, 3), 16);
    const g = parseInt(hex.slice(3, 5), 16);
    const b = parseInt(hex.slice(5, 7), 16);
    return 'rgba(' + r + ',' + g + ',' + b + ',' + a.toFixed(3) + ')';
  };

  if (shape === 'tight') {
    // Thin 1px line with soft edge falloff — wider faint line under a
    // crisp dark line so it reads as contact shadow, not a hard stroke.
    const hw = Math.floor(sw / 2);
    ctx.fillStyle = rgba(alpha * 0.35);
    ctx.fillRect(cx - hw - 1, cy, sw + 2, 1);
    ctx.fillStyle = rgba(alpha * 0.7);
    ctx.fillRect(cx - hw, cy, sw, 1);
    return;
  }

  if (shape === 'square') {
    const hw = Math.floor(sw / 2), hh = Math.floor(sh / 2);
    if (gradient) {
      for (let r = 0; r < 4; r++) {
        const a = alpha * (1 - r * 0.25);
        const ew = sw - r * 2, eh = sh - r * 2;
        if (ew < 1 || eh < 1) break;
        ctx.fillStyle = rgba(a);
        ctx.fillRect(cx - Math.floor(ew / 2), cy - Math.floor(eh / 2), ew, eh);
      }
    } else {
      ctx.fillStyle = rgba(alpha);
      ctx.fillRect(cx - hw, cy - hh, sw, sh);
    }
    return;
  }

  if (shape === 'long') {
    // Cast shadow — overlapping soft ovals along the cast ray.
    // Ovals taper in width and alpha toward the tip for a natural
    // light-occlusion falloff instead of hard-edged geometry.
    const steps = Math.max(5, Math.ceil(len / 2.5));
    for (let i = 0; i < steps; i++) {
      const t = i / (steps - 1);
      const px = Math.round(cx + Math.cos(angle) * len * t);
      const py = Math.round(cy + Math.sin(angle) * len * t);
      const w  = Math.max(1, sw * (1 - t * 0.55) + 1);
      const h  = Math.max(1, sh * (1 - t * 0.45) + 1);
      const a  = alpha * (1 - t * 0.75);
      if (a < 0.01) continue;
      ctx.fillStyle = rgba(a);
      pxEllipse(ctx, px, py, Math.round(w / 2), Math.round(h / 2), ctx.fillStyle);
    }
    return;
  }

  // Default: oval — 4-ring concentric falloff for soft radial gradient.
  const rx = Math.floor(sw / 2), ry = Math.floor(sh / 2);
  if (gradient) {
    for (let r = 0; r < 4; r++) {
      const a = alpha * (1 - r * 0.23);
      const erx = rx - r, ery = Math.max(1, ry - r);
      if (erx < 1 || ery < 1) continue;
      ctx.fillStyle = rgba(a);
      pxEllipse(ctx, cx, cy, erx, ery, ctx.fillStyle);
    }
  } else {
    ctx.fillStyle = rgba(alpha);
    pxEllipse(ctx, cx, cy, rx, ry, ctx.fillStyle);
  }
}

// ─── Environmental shadow helpers ─────────────────────────────────────

// wallShadow — shadow wedge cast by a wall.
// Draws a dark strip extending away from the wall edge, fading with
// dither. Now supports all 4 cardinal sides (was 2) and a color tint
// option (was hardcoded to black) so caves/lit-rooms can use a different
// shadow color than vacuum-black.
//   side    — 'north' | 'south' | 'east' | 'west'
//             ('north' = wall is the SOUTH face of a tile to the north,
//              shadow extends SOUTH from y).
//   length  — how many px the shadow extends (default 4)
//   alpha   — peak alpha at the wall edge (default 0.35)
//   color   — base color (default '#000')
//   dither  — checker mask granularity, 1 = every-other (default), 2 = denser
export function wallShadow(ctx, x, y, wallLen, opts = {}) {
  const side   = opts.side   || 'north';
  const length = opts.length != null ? opts.length : 4;
  const alpha  = opts.alpha  != null ? opts.alpha  : 0.35;
  const dither = opts.dither != null ? opts.dither : 1;
  const hex    = opts.color  || '#000';
  const r = parseInt(hex.slice(1, 3), 16);
  const g = parseInt(hex.slice(3, 5), 16);
  const b = parseInt(hex.slice(5, 7), 16);
  const rgba = (a) => 'rgba(' + r + ',' + g + ',' + b + ',' + a.toFixed(3) + ')';

  // Calling convention preserved: `x, y` is the start corner of the
  // shadow strip, `wallLen` is the along-wall length. For 'north' the
  // shadow extends down from (x, y); for 'south' it extends up; for
  // 'west' it extends right; for 'east' it extends left.
  for (let s = 0; s < length; s++) {
    const t = 1 - s / length;
    const a = alpha * t * t;
    if (a < 0.01) continue;
    ctx.fillStyle = rgba(a);
    for (let i = 0; i < wallLen; i++) {
      if (dither === 1 && ((i + s) & 1)) continue;
      if (dither === 2 && (((i + s) & 1) === 0 && (i & 3) === 0)) continue;
      let px, py;
      if (side === 'north')      { px = x + i; py = y + s; }
      else if (side === 'south') { px = x + i; py = y - 1 - s; }
      else if (side === 'west')  { px = x + s; py = y + i; }
      else /* east */            { px = x - 1 - s; py = y + i; }
      ctx.fillRect(px, py, 1, 1);
    }
  }
}

// 4×4 Bayer matrix for ordered dithering. Values 0..15 / 16; pixels
// "pass" the dither when (target_intensity * 16) > matrix[y%4][x%4].
const _BAYER4 = [
  [ 0,  8,  2, 10],
  [12,  4, 14,  6],
  [ 3, 11,  1,  9],
  [15,  7, 13,  5],
];

// cornerAO — ambient occlusion wedge in an inside corner. Now uses
// ordered Bayer dithering instead of pure radial alpha falloff: at low
// alpha we get a stippled gradient that reads more "pixel-art" than the
// previous semi-transparent fill, and the falloff edge is no longer
// banded. The geometry (quarter-circle radius, corner direction) is
// unchanged so existing callers don't move.
//   corner — 'nw' (shadow extends SE), 'ne', 'sw', 'se'
export function cornerAO(ctx, x, y, opts = {}) {
  const corner = opts.corner || 'nw';
  const radius = opts.radius != null ? opts.radius : 4;
  const alpha  = opts.alpha  != null ? opts.alpha  : 0.3;
  const dx = corner.includes('e') ? 1 : -1;
  const dy = corner.includes('s') ? 1 : -1;
  const cx = corner.includes('e') ? x + radius - 1 : x - radius + 1;
  const cy = corner.includes('s') ? y + radius - 1 : y - radius + 1;
  const baseRgba = 'rgba(0,0,0,' + Math.min(1, alpha * 1.6).toFixed(3) + ')';
  ctx.fillStyle = baseRgba;
  for (let row = 0; row < radius; row++) {
    for (let col = 0; col < radius; col++) {
      const dist = Math.sqrt(row * row + col * col) / radius;
      if (dist > 1) continue;
      const intensity = (1 - dist);              // 0..1, peak at corner
      // Bayer threshold — "pass" if intensity * 16 > matrix value.
      const px = cx + col * dx;
      const py = cy + row * dy;
      const m = _BAYER4[((py % 4) + 4) % 4][((px % 4) + 4) % 4];
      if (intensity * 16 > m) ctx.fillRect(px, py, 1, 1);
    }
  }
}

// ditherGradient — checker-dithered gradient strip.
// Transitions from full alpha to transparent over `length` px in
// the given direction. Use for shadow falloff on large surfaces.
//   dir — 's' (south), 'e' (east), 'se' (southeast, default)
export function ditherGradient(ctx, x, y, w, h, opts = {}) {
  const dir    = opts.dir    || 'se';
  const length = opts.length != null ? opts.length : 6;
  const alpha  = opts.alpha  != null ? opts.alpha  : 0.3;
  const rgba = (a) => 'rgba(0,0,0,' + a.toFixed(3) + ')';

  const dx = dir.includes('e') ? 1 : 0;
  const dy = dir.includes('s') ? 1 : 0;
  const steps = Math.max(1, dir.includes('e') ? Math.min(length, w) : dir.includes('s') ? Math.min(length, h) : Math.min(length, Math.max(w, h)));

  for (let s = 0; s < steps; s++) {
    const t = s / steps;
    const a = alpha * (1 - t) * (1 - t);
    ctx.fillStyle = rgba(a);
    const px = x + s * dx;
    const py = y + s * dy;
    for (let i = 0; i < (dir.includes('e') ? h : w); i++) {
      const qx = dir.includes('e') ? px : x + i;
      const qy = dir.includes('s') ? py : y + i;
      if ((i + s) & 1) continue;
      ctx.fillRect(qx, qy, 1, 1);
    }
  }
}

// contactShadow — tight ground shadow under an object resting on the
// surface. Thinner and darker than a drop shadow — reads as the object
// actually touching the ground, not floating above it.
export function contactShadow(ctx, cx, cy, w, opts = {}) {
  const alpha = opts.alpha != null ? opts.alpha : 0.5;
  const rgba = (a) => 'rgba(0,0,0,' + a.toFixed(3) + ')';
  const hw = Math.floor(w / 2);
  // Dark core line.
  ctx.fillStyle = rgba(alpha);
  ctx.fillRect(cx - hw, cy, w, 1);
  // Soft edge — fainter pixels on each side.
  ctx.fillStyle = rgba(alpha * 0.4);
  ctx.fillRect(cx - hw + 1, cy - 1, w - 2, 1);
  ctx.fillRect(cx - hw - 1, cy, 1, 1);
  ctx.fillRect(cx + hw, cy, 1, 1);
}

// canopyDapple — scattered shadow dots under a tree canopy.
// Simulates light filtering through leaves in a circular area.
export function canopyDapple(ctx, cx, cy, radius, opts = {}) {
  const seed  = opts.seed  != null ? opts.seed  : 0;
  const alpha = opts.alpha != null ? opts.alpha : 0.25;
  const count = opts.count != null ? opts.count : Math.floor(radius * radius * 0.3);
  const rgba = (a) => 'rgba(0,0,0,' + a.toFixed(3) + ')';

  for (let i = 0; i < count; i++) {
    const h = _tileHash(seed + 6000, i, 0);
    const angle = (h & 0xffff) / 0xffff * Math.PI * 2;
    const dist  = ((h >>> 16) & 0xff) / 0xff * radius;
    const px = Math.round(cx + Math.cos(angle) * dist);
    const py = Math.round(cy + Math.sin(angle) * dist * 0.7);
    const sz = 1 + ((h >>> 24) & 1); // 1-2 px dapple
    const a  = alpha * (0.5 + ((h >>> 8) & 0x7f) / 0xff * 0.5);
    ctx.fillStyle = rgba(a);
    ctx.fillRect(px, py, sz, 1);
    if (sz > 1 && ((h >>> 24) & 2)) ctx.fillRect(px, py + 1, 1, 1);
  }
}

// waterCaustics — wavy light-net pattern cast on surfaces under water.
// Draws interconnected curving bright lines suggesting refracted light,
// plus scattered bright specks. Reads as underwater caustics / heat shimmer.
//   rect = { x, y, w, h }
//   opts.alpha  — peak brightness (default 0.2)
//   opts.scale  — wave density (default 12 — smaller = tighter waves)
//   opts.seed   — integer
export function waterCaustics(ctx, rect, opts = {}) {
  const alpha = opts.alpha != null ? opts.alpha : 0.2;
  const scale = opts.scale != null ? opts.scale : 12;
  const seed  = opts.seed  != null ? opts.seed  : 0;
  const rgba  = (a) => 'rgba(255,255,255,' + a.toFixed(3) + ')';

  // Layer 1: faint overall darkening (the "shadow" underneath).
  ctx.fillStyle = 'rgba(0,0,40,' + (alpha * 0.3).toFixed(3) + ')';
  ctx.fillRect(rect.x, rect.y, rect.w, rect.h);

  // Layer 2: wavy caustic lines — sine-based curves running horizontally.
  const h = _tileHash(seed, 0, 0);
  const lines = 3 + ((h & 3));
  for (let li = 0; li < lines; li++) {
    const lh = _tileHash(seed + li * 313, 0, 0);
    const baseY = rect.y + ((lh & 0xff) / 0xff) * rect.h;
    const amp   = 2 + ((lh >>> 8) & 3);           // vertical wobble amplitude
    const freq  = 1.5 + ((lh >>> 12) & 0xff) / 0xff * 2.5;  // cycles across rect
    const phase = ((lh >>> 20) & 0xff) / 0xff * Math.PI * 2;
    const a     = alpha * (0.5 + ((lh >>> 28) & 1) * 0.3);

    ctx.fillStyle = rgba(a);
    for (let dx = 0; dx < rect.w; dx++) {
      const t = dx / rect.w;
      const wy = Math.round(baseY + Math.sin(t * Math.PI * 2 * freq + phase) * amp
                           + Math.sin(t * Math.PI * 5 + phase * 1.7) * (amp * 0.4));
      if (wy >= rect.y && wy < rect.y + rect.h) {
        ctx.fillRect(rect.x + dx, wy, 1, 1);
        // Thicker in bright spots.
        if ((lh >>> (dx & 7)) & 1) {
          if (wy + 1 < rect.y + rect.h) ctx.fillRect(rect.x + dx, wy + 1, 1, 1);
        }
      }
    }
  }

  // Layer 3: bright caustic specks — scattered along the same wave lines.
  const specks = Math.floor(rect.w * rect.h * 0.015);
  for (let i = 0; i < specks; i++) {
    const sh = _tileHash(seed + 5000, i, 0);
    const sx = rect.x + (sh & 0xffff) % rect.w;
    const sy = rect.y + ((sh >>> 16) & 0xffff) % rect.h;
    ctx.fillStyle = rgba(alpha * 1.2);
    ctx.fillRect(sx, sy, 1, 1);
  }
}

// shadowCaustics — small dark wavy shadow pattern. Like waterCaustics
// but inverted: dark lines instead of bright, smaller and denser.
// Reads as heat-shimmer shadows, underwater floor shadows, or dappled
// shade under moving leaves.
//   rect = { x, y, w, h }
//   opts.alpha  — peak darkness (default 0.18)
//   opts.seed   — integer
export function shadowCaustics(ctx, rect, opts = {}) {
  const alpha = opts.alpha != null ? opts.alpha : 0.18;
  const seed  = opts.seed  != null ? opts.seed  : 0;
  const rgba  = (a) => 'rgba(0,0,0,' + a.toFixed(3) + ')';

  // Layer 1: wavy dark lines — smaller, tighter waves than waterCaustics.
  const h = _tileHash(seed, 0, 0);
  const lines = 5 + ((h & 7));
  for (let li = 0; li < lines; li++) {
    const lh = _tileHash(seed + li * 313, 0, 0);
    const baseY = rect.y + ((lh & 0xff) / 0xff) * rect.h;
    const amp   = 1 + ((lh >>> 8) & 2);            // smaller amplitude
    const freq  = 3 + ((lh >>> 12) & 0xff) / 0xff * 4;  // higher frequency
    const phase = ((lh >>> 20) & 0xff) / 0xff * Math.PI * 2;
    const a     = alpha * (0.4 + ((lh >>> 28) & 3) * 0.15);

    ctx.fillStyle = rgba(a);
    for (let dx = 0; dx < rect.w; dx++) {
      const t = dx / rect.w;
      const wy = Math.round(baseY + Math.sin(t * Math.PI * 2 * freq + phase) * amp
                           + Math.sin(t * Math.PI * 7 + phase * 2.1) * (amp * 0.5));
      // Skip some pixels for a broken/dappled look.
      if ((lh >>> (dx & 15)) & 1) continue;
      if (wy >= rect.y && wy < rect.y + rect.h) {
        ctx.fillRect(rect.x + dx, wy, 1, 1);
      }
    }
  }

  // Layer 2: small dark specks scattered densely.
  const specks = Math.floor(rect.w * rect.h * 0.03);
  for (let i = 0; i < specks; i++) {
    const sh = _tileHash(seed + 7000, i, 0);
    const sx = rect.x + (sh & 0xffff) % rect.w;
    const sy = rect.y + ((sh >>> 16) & 0xffff) % rect.h;
    const a  = alpha * (0.3 + ((sh >>> 24) & 0x7f) / 0xff * 0.4);
    ctx.fillStyle = rgba(a);
    ctx.fillRect(sx, sy, 1, 1);
  }
}

// castShadow — full directional drop-shadow for an object resting on
// the ground. Combines a tight contact ellipse at the base with a
// softer cast wedge in the sun-direction. Replaces the typical
// "two shadow() calls" recipe with one call that's tuned for the
// usual case (object is upright, sun is offscreen).
//   cx, cy — base of the object on the ground (centerline at floor)
//   w, h   — the object's footprint (w wide, h tall)
//   palette: { color }   default '#000'
//   opts:    { sunAngle = -2*PI/3, alpha = 0.45, fade = 0.7 }
//     sunAngle — direction the shadow casts from the object (radians).
//                Default = back-and-right (sun is upper-left).
//     fade     — how quickly the cast tapers away (0..1). 1 = sharp,
//                0 = no cast (just contact).
export function castShadow(ctx, cx, cy, w, h, palette = {}, opts = {}) {
  const hex   = palette.color || '#000';
  const alpha = opts.alpha    != null ? opts.alpha    : 0.45;
  const sun   = opts.sunAngle != null ? opts.sunAngle : -2 * Math.PI / 3;
  const fade  = opts.fade     != null ? opts.fade     : 0.7;
  const r = parseInt(hex.slice(1, 3), 16);
  const g = parseInt(hex.slice(3, 5), 16);
  const b = parseInt(hex.slice(5, 7), 16);
  const rgba = (a) => 'rgba(' + r + ',' + g + ',' + b + ',' + a.toFixed(3) + ')';
  // 1) Tight contact ellipse — anchors the object to the floor.
  const cw = Math.max(2, Math.round(w * 0.9));
  const ch = Math.max(1, Math.round(h * 0.18));
  for (let ring = 0; ring < 3; ring++) {
    const ew = cw - ring * 2, eh = Math.max(1, ch - ring);
    if (ew < 1) break;
    ctx.fillStyle = rgba(alpha * (1 - ring * 0.22));
    pxEllipse(ctx, cx, cy, Math.floor(ew / 2), Math.floor(eh / 2), ctx.fillStyle);
  }
  // 2) Cast wedge — overlapping ellipses along the sun direction,
  //    tapering width and alpha. Length scales with `h` so taller
  //    objects throw longer shadows.
  const length = Math.max(2, Math.round(h * 0.85));
  const steps  = Math.max(3, Math.ceil(length / 2));
  for (let i = 1; i <= steps; i++) {
    const t = i / steps;
    const px = Math.round(cx + Math.cos(sun) * length * t);
    const py = Math.round(cy + Math.sin(sun) * length * t * 0.5);
    const ew = Math.max(1, Math.round(cw * (1 - t * fade)));
    const eh = Math.max(1, Math.round(ch * (1 - t * fade * 0.6)));
    const a  = alpha * (1 - t) * 0.85;
    if (a < 0.02) continue;
    ctx.fillStyle = rgba(a);
    pxEllipse(ctx, px, py, Math.floor(ew / 2), Math.floor(eh / 2), ctx.fillStyle);
  }
}

// lightShaft — diagonal bright wedge of light, e.g. from a window or
// gap. Renders as a parallelogram with luminance falling off along the
// shaft length, dithered for a beam-of-light feel. Composes with
// `lighter` blend mode at the call site if you want it to actually
// brighten what's underneath.
//   x, y — start corner (where the shaft enters)
//   w, h — shaft footprint (width along entry edge, height along axis)
//   opts: { angle=PI/4, color='#ffe8a0', alpha=0.25, axis='vertical' }
//     axis — 'vertical' shaft falls down-and-skewed; 'horizontal'
//            shaft enters from the side. Use 'vertical' for window
//            light, 'horizontal' for door spill.
export function lightShaft(ctx, x, y, w, h, opts = {}) {
  const angle = opts.angle != null ? opts.angle : Math.PI / 4;
  const hex   = opts.color || '#ffe8a0';
  const alpha = opts.alpha != null ? opts.alpha : 0.25;
  const axis  = opts.axis  || 'vertical';
  const r = parseInt(hex.slice(1, 3), 16);
  const g = parseInt(hex.slice(3, 5), 16);
  const b = parseInt(hex.slice(5, 7), 16);
  const rgba = (a) => 'rgba(' + r + ',' + g + ',' + b + ',' + a.toFixed(3) + ')';
  const skew = Math.tan(angle);
  if (axis === 'vertical') {
    // For each row down, shift right by `skew` * row, fill `w` wide.
    for (let row = 0; row < h; row++) {
      const t  = row / h;
      const a  = alpha * (1 - t) * (1 - t);
      if (a < 0.02) continue;
      // Bayer dither so the beam reads as light, not a flat overlay.
      ctx.fillStyle = rgba(a);
      const dx = Math.round(skew * row);
      for (let col = 0; col < w; col++) {
        const px = x + col + dx;
        const py = y + row;
        const m = _BAYER4[((py % 4) + 4) % 4][((px % 4) + 4) % 4];
        if ((1 - t * 0.5) * 16 > m) ctx.fillRect(px, py, 1, 1);
      }
    }
  } else {
    for (let col = 0; col < w; col++) {
      const t  = col / w;
      const a  = alpha * (1 - t) * (1 - t);
      if (a < 0.02) continue;
      ctx.fillStyle = rgba(a);
      const dy = Math.round(skew * col);
      for (let row = 0; row < h; row++) {
        const px = x + col;
        const py = y + row + dy;
        const m = _BAYER4[((py % 4) + 4) % 4][((px % 4) + 4) % 4];
        if ((1 - t * 0.5) * 16 > m) ctx.fillRect(px, py, 1, 1);
      }
    }
  }
}

export function pxEllipse(ctx, cx, cy, rx, ry, color) {
  ctx.fillStyle = color;

  // ── r ≤ 2: hardcoded patterns (zero divisions) ────────────────────
  if (rx === 0 && ry === 0) {
    ctx.fillRect(cx, cy, 1, 1);
    return;
  }
  if (rx === 1 && ry === 1) {
    ctx.fillRect(cx,     cy,     1, 1);  // center
    ctx.fillRect(cx - 1, cy,     1, 1);  // left
    ctx.fillRect(cx + 1, cy,     1, 1);  // right
    ctx.fillRect(cx,     cy - 1, 1, 1);  // up
    ctx.fillRect(cx,     cy + 1, 1, 1);  // down
    return;
  }
  if (rx === 2 && ry === 2) {
    // Center cross
    ctx.fillRect(cx,     cy,     1, 1);
    ctx.fillRect(cx - 1, cy,     1, 1);
    ctx.fillRect(cx + 1, cy,     1, 1);
    ctx.fillRect(cx - 2, cy,     1, 1);
    ctx.fillRect(cx + 2, cy,     1, 1);
    ctx.fillRect(cx,     cy - 1, 1, 1);
    ctx.fillRect(cx,     cy + 1, 1, 1);
    ctx.fillRect(cx,     cy - 2, 1, 1);
    ctx.fillRect(cx,     cy + 2, 1, 1);
    // Corner nubs
    ctx.fillRect(cx - 1, cy - 1, 1, 1);
    ctx.fillRect(cx + 1, cy - 1, 1, 1);
    ctx.fillRect(cx - 1, cy + 1, 1, 1);
    ctx.fillRect(cx + 1, cy + 1, 1, 1);
    return;
  }
  if (rx <= 2 && ry <= 2) {
    // Asymmetric small ellipse — still cheap but hardcode common cases.
    if (rx === 2 && ry === 1) {
      ctx.fillRect(cx,     cy,     1, 1);
      ctx.fillRect(cx - 1, cy,     1, 1);
      ctx.fillRect(cx + 1, cy,     1, 1);
      ctx.fillRect(cx - 2, cy,     1, 1);
      ctx.fillRect(cx + 2, cy,     1, 1);
      ctx.fillRect(cx,     cy - 1, 1, 1);
      ctx.fillRect(cx,     cy + 1, 1, 1);
      return;
    }
    if (rx === 1 && ry === 2) {
      ctx.fillRect(cx,     cy,     1, 1);
      ctx.fillRect(cx,     cy - 1, 1, 1);
      ctx.fillRect(cx,     cy + 1, 1, 1);
      ctx.fillRect(cx,     cy - 2, 1, 1);
      ctx.fillRect(cx,     cy + 2, 1, 1);
      ctx.fillRect(cx - 1, cy,     1, 1);
      ctx.fillRect(cx + 1, cy,     1, 1);
      return;
    }
    // Rare shapes: 2×0, 0×2, etc. — the loop is tiny.
    _fillEllipseRows(ctx, cx, cy, rx, ry);
    return;
  }

  // ── r ≥ 3: general case with precomputed denominators ─────────────
  _fillEllipseRows(ctx, cx, cy, rx, ry);
}

// Soft blob — filled ellipse with belly-up shading: the lower half
// renders in `body`, the upper half in `hilite`, plus a 1-px shadow
// stripe directly under the equator for grounded volume. Reads as a
// soft creature body without going to the full painter pipeline.
//
//   palette = { shadow, body, hilite, belly? }
//
// `belly` (optional) is an even lighter stop for the underside —
// useful for amphibious / pale-bellied creatures. Without it the
// lower half just uses `body`.
export function softBlob(ctx, cx, cy, rx, ry, palette) {
  // Fill body color (full ellipse).
  pxEllipse(ctx, cx, cy, rx, ry, palette.body);
  // Top dome — recolor pixels above the equator.
  ctx.fillStyle = palette.hilite;
  // Only the upper-most ~40% reads as highlight.
  _fillEllipseRowRange(ctx, cx, cy, rx, ry, -ry, Math.ceil(-ry * 0.35) - 1);
  // Belly — bottom 20% gets the optional belly stop.
  if (palette.belly) {
    ctx.fillStyle = palette.belly;
    _fillEllipseRowRange(ctx, cx, cy, rx, ry, Math.floor(ry * 0.55), ry);
  }
  // Shadow stripe under the south pole — 1 row at cy + ry, single
  // pixel wide (or a short arc on bigger blobs).
  if (palette.shadow) {
    ctx.fillStyle = palette.shadow;
    const sw = Math.max(1, Math.floor(rx * 0.7));
    ctx.fillRect(cx - Math.floor(sw / 2), cy + ry, sw, 1);
  }
}

// Eye — sclera ring + sclera fill + pupil + optional glint. The
// 3-stop pixel-art eye that sells "this is alive" with 3-7 pixels.
//
//   palette = { ring, sclera, pupil, glint? }
//   opts.size — 'tiny' (1px pupil only), 'small' (3×3), 'big' (5×5)
//   opts.lookAt — { dx, dy } — pupil offset by (-1, 0, +1) per axis
export function eye(ctx, cx, cy, palette, opts = {}) {
  const size = opts.size || 'small';
  const lookAt = opts.lookAt || { dx: 0, dy: 0 };
  if (size === 'tiny') {
    // Single pixel — for distant or background creatures.
    ctx.fillStyle = palette.pupil || '#000';
    ctx.fillRect(cx, cy, 1, 1);
    return;
  }
  if (size === 'small') {
    // 3×3 with pupil. Sclera ring at 4 corners + cross of sclera fill.
    if (palette.ring) {
      ctx.fillStyle = palette.ring;
      ctx.fillRect(cx - 1, cy - 1, 3, 3);
    }
    ctx.fillStyle = palette.sclera || '#ffffff';
    ctx.fillRect(cx - 1, cy, 3, 1);
    ctx.fillRect(cx, cy - 1, 1, 3);
    const px = cx + Math.sign(lookAt.dx);
    const py = cy + Math.sign(lookAt.dy);
    ctx.fillStyle = palette.pupil || '#000';
    ctx.fillRect(px, py, 1, 1);
    if (palette.glint) {
      ctx.fillStyle = palette.glint;
      ctx.fillRect(cx + 1, cy - 1, 1, 1);
    }
    return;
  }
  // 'big' — 5×5 oval eye with proper pupil + glint.
  if (palette.ring) {
    pxEllipse(ctx, cx, cy, 2, 2, palette.ring);
  }
  pxEllipse(ctx, cx, cy, 2, 1, palette.sclera || '#ffffff');
  ctx.fillStyle = palette.pupil || '#000';
  const px = cx + Math.max(-1, Math.min(1, lookAt.dx));
  const py = cy + Math.max(-1, Math.min(1, lookAt.dy));
  ctx.fillRect(px, py, 1, 1);
  if (palette.glint) {
    ctx.fillStyle = palette.glint;
    ctx.fillRect(cx + 1, cy - 1, 1, 1);
  }
}

// Mouth — single-pixel curve carved into a creature face. Mood is one
// of: 'flat' | 'smile' | 'frown' | 'snarl' | 'open' | 'fanged'.
//
//   palette = { line, fang? } — fang only used for 'fanged'/'snarl'.
//   w        — total mouth width in pixels (3..9 typical)
export function mouth(ctx, cx, cy, w, mood, palette) {
  const half = Math.floor(w / 2);
  const line = palette.line || '#000';
  ctx.fillStyle = line;
  switch (mood) {
    case 'flat':
      ctx.fillRect(cx - half, cy, w, 1);
      break;
    case 'smile':
      // Center row + 2 corners pulled up — :)
      ctx.fillRect(cx - half + 1, cy + 1, w - 2, 1);
      ctx.fillRect(cx - half, cy, 1, 1);
      ctx.fillRect(cx + half, cy, 1, 1);
      break;
    case 'frown':
      // Inverse of smile — :(
      ctx.fillRect(cx - half + 1, cy, w - 2, 1);
      ctx.fillRect(cx - half, cy + 1, 1, 1);
      ctx.fillRect(cx + half, cy + 1, 1, 1);
      break;
    case 'snarl':
      // Zig-zag — three pixels alternating high/low.
      for (let i = 0; i < w; i++) {
        ctx.fillRect(cx - half + i, cy + (i & 1), 1, 1);
      }
      if (palette.fang) {
        ctx.fillStyle = palette.fang;
        ctx.fillRect(cx - half + 1, cy + 2, 1, 1);
        ctx.fillRect(cx + half - 1, cy + 2, 1, 1);
      }
      break;
    case 'open':
      // Hollow rect — open maw.
      ctx.fillRect(cx - half, cy, w, 1);
      ctx.fillRect(cx - half, cy + 2, w, 1);
      ctx.fillRect(cx - half, cy, 1, 3);
      ctx.fillRect(cx + half, cy, 1, 3);
      break;
    case 'fanged': {
      ctx.fillRect(cx - half, cy, w, 1);
      if (palette.fang) {
        ctx.fillStyle = palette.fang;
        ctx.fillRect(cx - half + 1, cy + 1, 1, 1);
        ctx.fillRect(cx + half - 1, cy + 1, 1, 1);
      }
      break;
    }
    default: ctx.fillRect(cx - half, cy, w, 1);
  }
}

// Tapered tentacle / tail — walks a path of points and stamps a disc
// at each whose radius shrinks toward the tip. Optional 1-px ridge
// of `hilite` along one side for volume.
//
//   path     — array of { x, y } samples (root → tip ordering)
//   palette  — { shadow, body, hilite }
//   opts.startR — radius at root (default 2)
//   opts.endR   — radius at tip (default 0)
//   opts.ridge  — +1, -1, or undefined (no ridge). Side of hilite stripe.
export function tentacle(ctx, path, palette, opts = {}) {
  const startR = opts.startR != null ? opts.startR : 2;
  const endR   = opts.endR   != null ? opts.endR   : 0;
  const ridge  = opts.ridge;
  for (let i = 0; i < path.length; i++) {
    const t = i / Math.max(1, path.length - 1);
    const r = Math.round(startR + (endR - startR) * t);
    const p = path[i];
    pxEllipse(ctx, Math.round(p.x), Math.round(p.y),
              Math.max(0, r), Math.max(0, r), palette.body);
  }
  if (palette.shadow) {
    // Single-pixel shadow seam under the tentacle.
    ctx.fillStyle = palette.shadow;
    for (let i = 0; i < path.length; i++) {
      const t = i / Math.max(1, path.length - 1);
      const r = Math.round(startR + (endR - startR) * t);
      const p = path[i];
      if (r >= 1) {
        ctx.fillRect(Math.round(p.x), Math.round(p.y) + r, 1, 1);
      }
    }
  }
  if (ridge != null && palette.hilite) {
    ctx.fillStyle = palette.hilite;
    for (let i = 1; i < path.length - 1; i++) {
      const a = path[i - 1], b = path[i + 1];
      const dx = b.x - a.x, dy = b.y - a.y;
      const len = Math.max(0.0001, Math.hypot(dx, dy));
      const nx = -dy / len, ny = dx / len;
      const t = i / Math.max(1, path.length - 1);
      const r = Math.max(0, Math.round(startR + (endR - startR) * t) - 1);
      const p = path[i];
      const rx = Math.round(p.x + nx * ridge * r);
      const ry = Math.round(p.y + ny * ridge * r);
      ctx.fillRect(rx, ry, 1, 1);
    }
  }
}

// Segmented limb — root + 2-3 joints + tip. Each segment is a tapered
// soft rectangle. Used for legs, arms, antennae. Auto-aligned along
// the (root → tip) line, with width tapering toward the tip.
//
//   palette = { shadow, body, hilite }
export function limb(ctx, rootX, rootY, tipX, tipY, palette, opts = {}) {
  const segments = opts.segments || 2;
  const startW   = opts.startW != null ? opts.startW : 2;
  const endW     = opts.endW   != null ? opts.endW   : 1;
  for (let s = 0; s < segments; s++) {
    const t0 = s / segments;
    const t1 = (s + 1) / segments;
    const x0 = rootX + (tipX - rootX) * t0;
    const y0 = rootY + (tipY - rootY) * t0;
    const x1 = rootX + (tipX - rootX) * t1;
    const y1 = rootY + (tipY - rootY) * t1;
    const w0 = startW + (endW - startW) * t0;
    const w1 = startW + (endW - startW) * t1;
    // Stamp a disc at each end + a few interior steps.
    const steps = Math.max(2, Math.round(Math.hypot(x1 - x0, y1 - y0)));
    for (let i = 0; i <= steps; i++) {
      const u = i / steps;
      const px = Math.round(x0 + (x1 - x0) * u);
      const py = Math.round(y0 + (y1 - y0) * u);
      const r = Math.max(0, Math.round((w0 + (w1 - w0) * u) - 1));
      pxEllipse(ctx, px, py, r, r, palette.body);
    }
    // Joint nub between segments — one shadow pixel.
    if (palette.shadow && s < segments - 1) {
      ctx.fillStyle = palette.shadow;
      ctx.fillRect(Math.round(x1), Math.round(y1), 1, 1);
    }
  }
  // Foot/hand cap at the tip.
  if (opts.cap) {
    pxEllipse(ctx, Math.round(tipX), Math.round(tipY),
              opts.cap, opts.cap, palette.shadow || palette.body);
  }
}

// Ragged fur edge — for each opaque pixel on the silhouette boundary
// of a region (cx,cy,rx,ry ellipse approx), occasionally stamp a 1-px
// fur strand sticking outward. Deterministic via integer hash, so
// shapes don't shimmer between rebakes.
//
//   palette = { tip, base }   (tip = outermost color, base = inner)
//   opts.density  — 0..1 fraction of edge pixels that grow strands
//   opts.length   — strand length in pixels (1..3)
export function furEdge(ctx, cx, cy, rx, ry, palette, opts = {}) {
  const density = opts.density != null ? opts.density : 0.5;
  const length  = opts.length  != null ? opts.length  : 1;
  // Walk the ellipse boundary at regular angle steps.
  const steps = Math.max(8, Math.round((rx + ry) * 2));
  for (let i = 0; i < steps; i++) {
    const a = (i / steps) * Math.PI * 2;
    // Hash for deterministic "random."
    const h = ((i * 73856093) >>> 0) & 0xffff;
    if ((h / 0xffff) > density) continue;
    const dx = Math.cos(a), dy = Math.sin(a);
    const baseX = cx + Math.round(dx * rx);
    const baseY = cy + Math.round(dy * ry);
    ctx.fillStyle = palette.base;
    ctx.fillRect(baseX, baseY, 1, 1);
    for (let s = 1; s <= length; s++) {
      const tx = cx + Math.round(dx * (rx + s));
      const ty = cy + Math.round(dy * (ry + s));
      ctx.fillStyle = (s === length) ? palette.tip : palette.base;
      ctx.fillRect(tx, ty, 1, 1);
    }
  }
}

// Scale / spot scatter — distribute small darker ovals deterministi-
// cally inside an ellipse for reptile/amphibian patterning.
//
//   palette = { spot }
//   opts.count   — number of spots
//   opts.size    — radius of each spot (1 or 2)
//   opts.seed    — integer for deterministic placement
export function scaleSpots(ctx, cx, cy, rx, ry, palette, opts = {}) {
  const count = opts.count != null ? opts.count : 6;
  const size  = opts.size  != null ? opts.size  : 1;
  let seed = (opts.seed != null ? opts.seed : 1) >>> 0;
  function next() {
    seed = (seed * 1664525 + 1013904223) >>> 0;
    return seed / 0xffffffff;
  }
  ctx.fillStyle = palette.spot;
  for (let i = 0; i < count; i++) {
    const a = next() * Math.PI * 2;
    const r = Math.sqrt(next()) * 0.85;     // bias toward center
    const x = cx + Math.round(Math.cos(a) * r * rx);
    const y = cy + Math.round(Math.sin(a) * r * ry);
    pxEllipse(ctx, x, y, size, size, palette.spot);
  }
}

// Horn / spike — single curving segment from base outward. Uses a
// quadratic-ish curve via 3 control points. Tapered radius toward tip.
//
//   palette = { shadow, body, hilite }
//   opts.length   — segments (default 6)
//   opts.curve    — bend amount perpendicular to (base→tip) (default 0)
//   opts.startR   — base radius (default 2)
//   opts.endR     — tip radius (default 0)
export function horn(ctx, baseX, baseY, tipX, tipY, palette, opts = {}) {
  const length = opts.length != null ? opts.length : 6;
  const curve  = opts.curve  != null ? opts.curve  : 0;
  const startR = opts.startR != null ? opts.startR : 2;
  const endR   = opts.endR   != null ? opts.endR   : 0;
  const dx = tipX - baseX, dy = tipY - baseY;
  const len = Math.max(0.0001, Math.hypot(dx, dy));
  const nx = -dy / len, ny = dx / len;        // perpendicular
  const path = [];
  for (let i = 0; i <= length; i++) {
    const t = i / length;
    // Quadratic bend: 4*t*(1-t) peaks at t=0.5.
    const bend = 4 * t * (1 - t) * curve;
    path.push({
      x: baseX + dx * t + nx * bend,
      y: baseY + dy * t + ny * bend,
    });
  }
  // Use tentacle for the tapered draw.
  tentacle(ctx, path, palette, { startR, endR, ridge: 1 });
}

// Membrane wing — triangular wedge stamped pixel-by-pixel from a base
// edge to a tip. Horizontal "rib" lines suggest membrane structure.
//
//   palette = { shadow, body, hilite, rib? }
//   baseX, baseY     — wing root (attached to body)
//   span             — horizontal extent
//   height           — vertical extent
//   side             — +1 (right wing) or -1 (left wing)
export function membraneWing(ctx, baseX, baseY, span, height, side, palette) {
  // Triangle: base at (baseX, baseY..baseY+height), tip at (baseX + side*span, baseY + height/2).
  const tipX = baseX + side * span;
  const tipY = baseY + Math.round(height / 2);
  for (let dy = 0; dy <= height; dy++) {
    const t = dy / height;
    // Width of the wing at this row narrows as we move away from base.
    const tBase = Math.abs(t - 0.5) * 2;     // 0 at center, 1 at edges
    const reach = Math.round(span * (1 - tBase));
    const y = baseY + dy;
    for (let s = 0; s <= reach; s++) {
      const x = baseX + side * s;
      // Edge gets shadow, interior body, body-near-base highlight.
      let col = palette.body;
      if (s === reach) col = palette.shadow || palette.body;
      else if (s < 2) col = palette.hilite || palette.body;
      ctx.fillStyle = col;
      ctx.fillRect(x, y, 1, 1);
    }
  }
  // Membrane ribs — 2-3 horizontal lines fanning from base to tip.
  if (palette.rib) {
    ctx.fillStyle = palette.rib;
    const ribs = 3;
    for (let r = 1; r <= ribs; r++) {
      const yStart = baseY + Math.round((r * height) / (ribs + 1));
      // Walk from base toward tip, stopping at the wing edge.
      const tEdge = Math.abs((yStart - baseY) / height - 0.5) * 2;
      const reach = Math.round(span * (1 - tEdge));
      pxLine(ctx, baseX, yStart,
             baseX + side * Math.max(0, reach - 1), tipY, palette.rib);
    }
  }
}

// Compound creature face — eye(s) + mouth + optional nose dot, all
// positioned relative to a face center. Convenience wrapper for
// the most common combinations.
//
//   palette = { eye: {ring, sclera, pupil, glint?},
//               mouth: {line, fang?},
//               nose? }
//   opts.eyes   — 1 | 2 (default 2)
//   opts.spread — px between eye centers (default 4)
//   opts.mouthMood — passed to mouth()
//   opts.lookAt    — {dx, dy} for eye pupils
export function creatureFace(ctx, cx, cy, palette, opts = {}) {
  const eyes  = opts.eyes  != null ? opts.eyes  : 2;
  const spread = opts.spread != null ? opts.spread : 4;
  const mouthMood = opts.mouthMood || 'flat';
  if (eyes === 1) {
    eye(ctx, cx, cy - 1, palette.eye, { size: opts.eyeSize || 'small', lookAt: opts.lookAt });
  } else {
    const halfSpread = Math.floor(spread / 2);
    eye(ctx, cx - halfSpread, cy - 1, palette.eye, { size: opts.eyeSize || 'small', lookAt: opts.lookAt });
    eye(ctx, cx + halfSpread, cy - 1, palette.eye, { size: opts.eyeSize || 'small', lookAt: opts.lookAt });
  }
  if (palette.nose) {
    ctx.fillStyle = palette.nose;
    ctx.fillRect(cx, cy + 1, 1, 1);
  }
  if (palette.mouth) {
    mouth(ctx, cx, cy + (opts.mouthOffset != null ? opts.mouthOffset : 3),
          opts.mouthW || 5, mouthMood, palette.mouth);
  }
}

// ─── 7c. Energy beam primitive ─────────────────────────────────────
// Layered laser/plasma beam from (x0, y0) to (x1, y1). Renders three
// concentric stripes — outer halo, mid sheath, bright core — so the
// beam reads as "energy weapon" instead of a flat line. Uses the same
// Bresenham walk three times at increasing widths; cheap and crisp.
//
// Palette presets — each carries { halo, sheath, core, surge } for
// `beam()`. Mix-and-match: pass `LASER_RED` for a default look or build
// your own. Surge defaults to the brightest tint so pulses pop.

export const LASER_RED = {
  halo:   '#3a0805',
  sheath: '#c83020',
  core:   '#ffeae0',
  surge:  '#ffffff',
};
export const LASER_BLUE = {
  halo:   '#082040',
  sheath: '#3080ff',
  core:   '#e8f4ff',
  surge:  '#ffffff',
};
export const LASER_GREEN = {
  halo:   '#082810',
  sheath: '#30c060',
  core:   '#e8ffe8',
  surge:  '#ffffff',
};
export const PLASMA_VIOLET = {
  halo:   '#180828',
  sheath: '#a040ff',
  core:   '#f4e0ff',
  surge:  '#ffd0ff',
};
export const PLASMA_TOXIC = {
  halo:   '#142008',
  sheath: '#8cff20',
  core:   '#fdffd8',
  surge:  '#ffffff',
};
export const ION_GOLD = {
  halo:   '#3a2008',
  sheath: '#ffb030',
  core:   '#fff4d0',
  surge:  '#ffffff',
};
export const LIGHTNING = {
  halo:   '#0a1830',
  sheath: '#80c0ff',
  core:   '#ffffff',
  surge:  '#ffffff',
};
// "Cutting" laser — narrow, very intense, almost-white. For surgical /
// industrial cutting beams (thinner sheath, white core, no halo).
export const LASER_CUTTING = {
  halo:   '#400808',
  sheath: '#ff8060',
  core:   '#ffffff',
  surge:  '#ffffff',
};
// "Nova" — fat capsule cannon beam. Explicit band stack: deep violet
// outer haze → pink halo → bright pink → cream → bone-white core.
// Designed for big-width usage (12–24px) with rounded caps + spray.
// Matches the reference nova-cannon screenshot.
export const BEAM_NOVA_PINK = {
  halo:   '#3a0a40',
  sheath: '#ff70c0',
  core:   '#ffffff',
  surge:  '#ffffff',
  bands: [
    '#3a0a40',  // outer violet haze (r=width)
    '#7a1a80',  // violet halo
    '#c040b0',  // magenta
    '#ff70c0',  // hot pink
    '#ffb0d8',  // pale pink
    '#ffe0f0',  // cream
    '#ffffff',  // bone-white core
  ],
};
// "Arc" — bright cyan-white electrical lightning. Higher-contrast
// halo→core spread than LIGHTNING; tuned for `lightningBolt`.
export const LIGHTNING_ARC = {
  halo:   '#081830',
  sheath: '#4080ff',
  core:   '#e8f4ff',
  surge:  '#ffffff',
  bands: [
    '#081830',
    '#1840a0',
    '#4080ff',
    '#80c0ff',
    '#e8f4ff',
  ],
};
//
//   palette:
//     core    — bright center color (white/cyan)
//     sheath  — main beam color (red, green, etc.)
//     halo    — outer glow color (usually a darker version of sheath)
//     surge?  — optional bright color for traveling pulse waves
//                (defaults to `core`)
//   opts:
//     width    — total beam thickness in px (default 3)
//     halo     — boolean, draw outer halo stripe (default true)
//     hotTips  — boolean, brighten endpoints with a glow blob (default true)
//     pulse    — number 0..1, position of a single bright surge wave
//                traveling from emitter (0) to target (1). Pass
//                `(performance.now() / cycleMs) % 1` from caller.
//                Omit for a static beam.
//     pulseLen — surge band length in px along the beam axis (default 4)
//     pulses   — alternate to `pulse`: pass an array of 0..1 values to
//                draw multiple surge waves at once (e.g. `[0.2, 0.5, 0.8]`)
//
// Pairs naturally with `glowSpot` for charge-up indicators or impact
// flares at the endpoints. Draw the beam first, then add muzzle/impact
// effects on top.
// ── beam internals ─────────────────────────────────────────────────
// Tiny hex helpers — kept local; intermediate band colors are derived
// by lerping the palette's halo→sheath→core stops so a 3-color preset
// can drive any number of bands without the caller specifying them.
function _hexToRgb(h) {
  const n = parseInt(h.slice(1), 16);
  if (h.length === 4) {
    const r = (n >> 8) & 0xf, g = (n >> 4) & 0xf, b = n & 0xf;
    return [r * 17, g * 17, b * 17];
  }
  return [(n >> 16) & 0xff, (n >> 8) & 0xff, n & 0xff];
}
function _rgbToHex(r, g, b) {
  const c = (r << 16) | (g << 8) | b;
  return '#' + c.toString(16).padStart(6, '0');
}
function _hexLerp(a, b, t) {
  const A = _hexToRgb(a), B = _hexToRgb(b);
  return _rgbToHex(
    Math.round(A[0] + (B[0] - A[0]) * t),
    Math.round(A[1] + (B[1] - A[1]) * t),
    Math.round(A[2] + (B[2] - A[2]) * t),
  );
}
// Build a band list { color, r } from outer→inner. If the palette
// supplies an explicit `bands` array, use that verbatim (each entry is
// either a color string or `{color, r?}`). Otherwise generate
// `count` rings by lerping halo→sheath→core across the radius. The
// outermost ring is `palette.halo`; the inner two rings are core/surge.
function _buildBands(palette, width, drawHalo, count) {
  // Explicit palette-defined band stack wins.
  if (Array.isArray(palette.bands) && palette.bands.length > 0) {
    return palette.bands.map((b, i, arr) => {
      if (typeof b === 'string') {
        const t = arr.length === 1 ? 0 : i / (arr.length - 1);
        return { color: b, r: Math.max(0, Math.round(width * (1 - t))) };
      }
      return { color: b.color, r: b.r != null ? b.r : Math.max(0, Math.round(width * (1 - i / Math.max(1, arr.length - 1)))) };
    });
  }
  // Derive from halo/sheath/core.
  const halo   = palette.halo;
  const sheath = palette.sheath;
  const core   = palette.core;
  const n = Math.max(3, count);
  const bands = [];
  for (let i = 0; i < n; i++) {
    const t = i / (n - 1);              // 0 = outer, 1 = inner core
    // Lerp halo→sheath for outer half, sheath→core for inner half.
    let color;
    if (t < 0.5) color = _hexLerp(halo, sheath, t * 2);
    else         color = _hexLerp(sheath, core, (t - 0.5) * 2);
    // Radius taper: outer ring at `width`, innermost at 0.
    const r = Math.round(width * (1 - t));
    if (i === 0 && !drawHalo) continue;   // drop outer halo if disabled
    // Skip a ring whose radius collapses onto the previous ring — keeps
    // the stack visually distinct for small widths.
    if (bands.length > 0 && bands[bands.length - 1].r === r) {
      bands[bands.length - 1].color = color;   // upgrade to brighter color
      continue;
    }
    bands.push({ color, r });
  }
  return bands;
}

// `beam(ctx, x0, y0, x1, y1, palette, opts)` — multi-band glowing beam
// with a capsule body and optional rounded caps, surge pulses, and
// muzzle/impact spray. Designed to read well at any width from 1px
// hairlines (LASER_CUTTING) up to 30px nova cannons.
//
//   palette:
//     halo    — outermost dim glow color
//     sheath  — main beam color
//     core    — bright center color (usually white/cream)
//     surge?  — bright color for traveling pulse waves (defaults to core)
//     bands?  — optional explicit color stack, outer→inner. Each entry
//               is either a color string OR `{ color, r }`. If present,
//               overrides the derived halo→sheath→core gradient.
//
//   opts:
//     width      — beam half-thickness in px (default 3). The full
//                  visible body is `width*2 + 1`. Caps add another
//                  `width` of length at each end (capsule shape).
//     halo       — boolean, draw outer halo stripe (default true)
//     hotTips    — boolean, brighten endpoints with extra core flare
//                  (default true). Has no effect when `roundCaps`.
//     roundCaps  — boolean, render filled semicircle caps at both
//                  endpoints so the body reads as a capsule rather
//                  than a flat-ended rectangle (default true)
//     bandCount  — number of concentric stripes when deriving from
//                  halo/sheath/core (default = max(3, width+1)). Bigger
//                  beams want more bands for a smooth gradient.
//     pulse      — number 0..1, position of one surge wave traveling
//                  from emitter (0) to target (1). Pass
//                  `(performance.now() / cycleMs) % 1` from caller.
//     pulses     — array of 0..1 positions for multiple simultaneous
//                  surge waves (e.g. `[0.2, 0.5, 0.8]`)
//     pulseLen   — surge band length in px along the axis (default 4)
//     spray      — boolean, scatter pixel sparks at both endpoints
//                  (default false). Reads as muzzle blast + impact
//                  splatter; pairs with rounded caps for the nova
//                  look (see paste_1779654997830 reference)
//     sprayLen   — px reach of the spray plume (default = width*2)
//     sprayDensity — sparks per endpoint (default = width*6)
//     seed       — integer seed for deterministic spray pattern
//                  (default 0). Pass `Math.floor(t*4)` for animated
//                  flicker.
//
// Pairs naturally with `glowSpot` for charge-up indicators or impact
// flares. For jagged forked bolts use `lightningBolt()` instead.
export function beam(ctx, x0, y0, x1, y1, palette, opts = {}) {
  // Bresenham walks by integer ±1 and terminates on x===x1 && y===y1 —
  // float endpoints (e.g. cos(a)*r) make the step value skip past the
  // target forever. Snap endpoints to integers up front.
  x0 = Math.round(x0); y0 = Math.round(y0);
  x1 = Math.round(x1); y1 = Math.round(y1);
  const width     = opts.width != null ? opts.width : 3;
  const drawHalo  = opts.halo !== false;
  const drawTips  = opts.hotTips !== false;
  const roundCaps = opts.roundCaps !== false;
  const pulseLen  = opts.pulseLen != null ? opts.pulseLen : 4;
  const surgeColor = palette.surge || palette.core;
  const bandCount = opts.bandCount != null ? opts.bandCount : Math.max(3, width + 1);

  // Collect any active surge wave positions. Single `pulse` opt → one
  // entry; `pulses` array → many entries. Empty list = static beam.
  const surges = [];
  if (opts.pulse != null)  surges.push(opts.pulse - Math.floor(opts.pulse));
  if (Array.isArray(opts.pulses)) {
    for (const p of opts.pulses) surges.push(p - Math.floor(p));
  }

  // Axis vectors. `ux`/`uy` along the beam, `nx`/`ny` perpendicular.
  const len = Math.hypot(x1 - x0, y1 - y0) || 1;
  const ux  =  (x1 - x0) / len;
  const uy  =  (y1 - y0) / len;
  const nx  = -uy;
  const ny  =  ux;

  // Multi-band stripe stack, outer (widest, dimmest) → inner (smallest,
  // brightest). Drawing outer→inner means each ring overwrites the
  // previous one's center pixel, leaving concentric rings of color —
  // that's where the gradient comes from.
  const bands = _buildBands(palette, width, drawHalo, bandCount);

  // Per-step perpendicular stamp. For each band radius we draw two
  // single pixels at +k and -k offsets along the perpendicular. With
  // Bresenham step=1 this paints a continuous stripe of that color.
  // The innermost (r=0) band draws a single center pixel.
  const stripe = (cx, cy) => {
    for (let b = 0; b < bands.length; b++) {
      const band = bands[b];
      ctx.fillStyle = band.color;
      const r = band.r;
      if (r === 0) {
        ctx.fillRect(cx, cy, 1, 1);
      } else {
        const ox = Math.round(nx * r);
        const oy = Math.round(ny * r);
        ctx.fillRect(cx + ox, cy + oy, 1, 1);
        ctx.fillRect(cx - ox, cy - oy, 1, 1);
      }
    }
  };

  // Walk Bresenham. Each step paints one perpendicular stripe stack.
  // The surge pass overlays a brighter swelling band wherever the
  // step's beam-axis fraction lies inside an active surge wave.
  const dx = Math.abs(x1 - x0);
  const dy = Math.abs(y1 - y0);
  const sx = x0 < x1 ? 1 : -1;
  const sy = y0 < y1 ? 1 : -1;
  let err = dx - dy;
  let x = x0, y = y0;
  const totalSteps = Math.max(dx, dy);
  let step = 0;
  const pulseHalfFrac = (pulseLen * 0.5) / Math.max(1, totalSteps);
  while (true) {
    stripe(x, y);
    if (surges.length > 0 && totalSteps > 0) {
      const frac = step / totalSteps;
      let inSurge = false, surgeBoost = 0;
      for (const sp of surges) {
        let d = Math.abs(frac - sp);
        if (d > 0.5) d = 1 - d;
        if (d <= pulseHalfFrac) {
          inSurge = true;
          const k = 1 - (d / pulseHalfFrac);
          if (k > surgeBoost) surgeBoost = k;
        }
      }
      if (inSurge) {
        // Swell band: a brighter stripe at sheath-width+1, plus a hot
        // core stripe at the next inner radius. Reads as a peaked wave
        // riding along the beam rather than just a recolor.
        const surgeR = Math.min(width, Math.max(1, width - 1) + 1);
        ctx.fillStyle = surgeColor;
        for (let k = -surgeR; k <= surgeR; k++) {
          ctx.fillRect(x + Math.round(nx * k), y + Math.round(ny * k), 1, 1);
        }
        // Peak hot pixel at center (extra punch).
        ctx.fillStyle = '#ffffff';
        ctx.fillRect(x, y, 1, 1);
      }
    }
    if (x === x1 && y === y1) break;
    const e2 = err * 2;
    if (e2 > -dy) { err -= dy; x += sx; }
    if (e2 < dx)  { err += dx; y += sy; }
    step++;
  }

  // Rounded caps — filled half-disks at each endpoint, banded the same
  // way as the body so the cap reads as a smooth continuation of the
  // capsule rather than a flat butt. Drawn outer→inner so inner
  // brighter rings overwrite the outer ones. The half-disk extends
  // *outward* along the beam axis (axial offset `a` from 0 → width),
  // with radius shrinking as `a` increases — that's the rounded cap.
  if (roundCaps && width >= 1) {
    const drawCap = (cx, cy, axisSign) => {
      for (let b = 0; b < bands.length; b++) {
        const band = bands[b];
        const R = band.r;
        if (R <= 0) {
          // Innermost stripe — single axial pixel just past the endpoint.
          ctx.fillStyle = band.color;
          ctx.fillRect(cx + Math.round(ux * axisSign), cy + Math.round(uy * axisSign), 1, 1);
          continue;
        }
        ctx.fillStyle = band.color;
        // Sweep axial offset a=0..R; perpendicular extent shrinks as
        // sqrt(R*R - a*a) to give a circle outline filled inward.
        for (let a = 0; a <= R; a++) {
          const perp = Math.floor(Math.sqrt(R * R - a * a));
          for (let k = -perp; k <= perp; k++) {
            const px = cx + Math.round(ux * a * axisSign + nx * k);
            const py = cy + Math.round(uy * a * axisSign + ny * k);
            ctx.fillRect(px, py, 1, 1);
          }
        }
      }
    };
    drawCap(x0, y0, -1);   // emitter cap extends backward
    drawCap(x1, y1, +1);   // impact cap extends forward
  } else if (drawTips) {
    // Legacy flat-end hot-tip behavior (kept for tiny hairline beams
    // where a full cap would just look like a bump).
    ctx.fillStyle = palette.core;
    ctx.fillRect(x0, y0, 1, 1);
    ctx.fillRect(x0 + Math.round(nx), y0 + Math.round(ny), 1, 1);
    ctx.fillRect(x0 - Math.round(nx), y0 - Math.round(ny), 1, 1);
    ctx.fillRect(x1, y1, 1, 1);
    ctx.fillRect(x1 + Math.round(nx), y1 + Math.round(ny), 1, 1);
    ctx.fillRect(x1 - Math.round(nx), y1 - Math.round(ny), 1, 1);
  }

  // Spray plumes at both endpoints — deterministic scatter of single
  // pixels in a cone, fading from sheath color near the cap to halo
  // color at the plume tip. Density and reach scale with width so
  // big nova beams get fat splatter; thin beams get a faint sparkle.
  if (opts.spray) {
    const sprayLen     = opts.sprayLen != null ? opts.sprayLen : width * 2;
    const sprayDensity = opts.sprayDensity != null ? opts.sprayDensity : width * 6;
    const seed         = (opts.seed != null ? opts.seed : 0) | 0;
    // xorshift32 — fast, deterministic, no Math.random calls so the
    // pattern is stable across frames when seed is held.
    let s = (seed * 2654435761) | 0; if (s === 0) s = 1;
    const rnd = () => {
      s ^= s << 13; s ^= s >>> 17; s ^= s << 5;
      return ((s >>> 0) / 0xffffffff);
    };
    const sprayAt = (cx, cy, axisSign) => {
      for (let i = 0; i < sprayDensity; i++) {
        // Axial reach: biased outward but with some pull back so the
        // plume hugs the cap rather than floating away from it.
        const a = Math.pow(rnd(), 0.6) * sprayLen;
        // Perpendicular spread fans wider near the cap, narrower at
        // the tip — that's the cone shape from the reference.
        const spread = (width + 1) + a * 0.7;
        const k = (rnd() * 2 - 1) * spread;
        const px = Math.round(cx + ux * a * axisSign + nx * k);
        const py = Math.round(cy + uy * a * axisSign + ny * k);
        // Color graduation: bright near cap → sheath → halo at tip.
        const t = a / sprayLen;
        let color;
        if (t < 0.25)      color = surgeColor;
        else if (t < 0.6)  color = palette.sheath;
        else               color = palette.halo;
        ctx.fillStyle = color;
        ctx.fillRect(px, py, 1, 1);
      }
    };
    sprayAt(x0, y0, -1);
    sprayAt(x1, y1, +1);
  }
}

// ── lightningBolt ───────────────────────────────────────────────────
// Jagged forked electrical arc — rewritten v2.
//
// Two big departures from the previous (midpoint-displacement) version:
//
//   1. **Step-walker path generation.** From `(x0,y0)` we walk one
//      `step` px at a time toward `(x1,y1)`, deviating each step by
//      up to `wobble` radians. This produces natural *directional*
//      jaggies — the bolt drifts and zigs the way a real arc does —
//      instead of symmetric midpoint splits that read as uniform
//      zigzag noise. The walker always reaches the target endpoint
//      via a final snap-to.
//
//   2. **Concentric overwriting render passes** instead of N beam
//      calls per segment. We walk every Bresenham pixel of every
//      segment three times in source-over mode: widest-and-dimmest
//      first (halo box), narrower (sheath box), then 1px core. Each
//      pass overwrites the previous one's centermost pixels, so the
//      halo → sheath → core gradient falls out automatically with
//      no compositing tricks.
//
// Sparks are now stamped ONLY at endpoints + fork origins/tips —
// not at every bend. The old "node per bend" looked like a beaded
// necklace; real bolts have continuous brightness with hot spots
// only where the path branches or terminates.
//
//   palette: { halo, sheath, core } — `beam`-style palette object.
//            Use `LIGHTNING_ARC` (defined earlier) or roll your own.
//   opts:
//     width      — radial thickness; halo R = width+1, sheath R = width.
//                  1 → 5px total bolt (default). 2 → 7px. Higher = wider.
//     forks      — max secondary branches off the main path (default 2)
//     forkChance — per-attempt probability a fork actually spawns
//                  (default 0.6). Lower = sparser forks.
//     step       — px per walker step (default 4). Smaller = jaggier.
//     wobble     — max angular deviation per step, in radians
//                  (default 0.55 ≈ 31°). Higher = more chaotic.
//     seed       — integer; deterministic shape. Pass `Math.floor(t*N)`
//                  to flicker between shapes per N-th of a second.
//     glow       — bool, draw the outer halo pass (default true).
//                  false = no halo, sharper "raw arc" silhouette.
//     nodes      — bool, draw sparks at endpoints + fork origins/tips
//                  (default true). The `nodes` name is kept for backward
//                  compatibility with callers; the meaning is now
//                  "endpoint sparks" not "bend beads."
//
// Backward compat: callers passing `jitter` and `subdivisions` (from
// the midpoint-displacement era) silently get the new defaults — those
// opts no longer have an effect. The new tuning knobs are `wobble`
// and `step`.
export function lightningBolt(ctx, x0, y0, x1, y1, palette, opts = {}) {
  const width      = Math.max(1, opts.width      != null ? opts.width      : 1);
  const forks      = opts.forks      != null ? opts.forks      : 2;
  const forkChance = opts.forkChance != null ? opts.forkChance : 0.6;
  const step       = Math.max(1, opts.step       != null ? opts.step       : 4);
  const wobble     = opts.wobble     != null ? opts.wobble     : 0.55;
  const drawGlow   = opts.glow  !== false;
  const drawSparks = opts.nodes !== false;
  const seed       = (opts.seed != null ? opts.seed : 1) | 0;

  // xorshift32 PRNG — same seed → same pattern.
  let s = (seed * 2654435761) | 0; if (s === 0) s = 1;
  const rnd = () => {
    s ^= s << 13; s ^= s >>> 17; s ^= s << 5;
    return ((s >>> 0) / 0xffffffff);
  };

  // Step-walker: from (sx,sy) toward (ex,ey), each step takes a small
  // angular deviation from the heading. We always re-aim at the target
  // each step (rather than carrying momentum from prior wobbles), so
  // accumulated drift can't carry us off course. The final snap-to ensures
  // the bolt visibly reaches the requested endpoint.
  const walk = (sx, sy, ex, ey, stepSize, wob) => {
    const pts = [[sx, sy]];
    let cx = sx, cy = sy;
    const safety = Math.max(8, Math.ceil(Math.hypot(ex - sx, ey - sy) / stepSize * 2));
    for (let i = 0; i < safety; i++) {
      const dx = ex - cx, dy = ey - cy;
      const dist = Math.hypot(dx, dy);
      if (dist < stepSize) break;
      const hx = dx / dist, hy = dy / dist;
      const ang = (rnd() * 2 - 1) * wob;
      const c = Math.cos(ang), si = Math.sin(ang);
      cx += (hx * c - hy * si) * stepSize;
      cy += (hx * si + hy * c) * stepSize;
      pts.push([cx, cy]);
    }
    pts.push([ex, ey]);
    return pts;
  };

  // Generate main path + collect spark anchor points (endpoints first).
  const mainPath = walk(x0, y0, x1, y1, step, wobble);
  const allPaths = [mainPath];
  const sparkPoints = [[x0, y0], [x1, y1]];

  // Forks — spawn from random interior nodes of the main path, walking
  // off at a steep angle to a randomly-chosen tip. Each fork has its own
  // wobble (slightly higher than main) so the secondaries read as
  // "more chaotic than the trunk."
  if (forks > 0 && mainPath.length > 2) {
    const totalLen = Math.hypot(x1 - x0, y1 - y0) || 1;
    for (let f = 0; f < forks; f++) {
      if (rnd() > forkChance) continue;
      const ni = 1 + Math.floor(rnd() * (mainPath.length - 2));
      const [fx, fy] = mainPath[ni];
      // Tangent at the fork node.
      const [pxA, pyA] = mainPath[ni - 1];
      const [pxB, pyB] = mainPath[Math.min(mainPath.length - 1, ni + 1)];
      let dx = pxB - pxA, dy = pyB - pyA;
      const dl = Math.hypot(dx, dy) || 1;
      dx /= dl; dy /= dl;
      // Rotate ±30..75° off the tangent for the fork heading.
      const ang = (rnd() < 0.5 ? -1 : 1) * (Math.PI / 6 + rnd() * Math.PI / 4);
      const c = Math.cos(ang), si = Math.sin(ang);
      const fdx = dx * c - dy * si;
      const fdy = dx * si + dy * c;
      const flen = totalLen * (0.22 + rnd() * 0.35);
      const ex = fx + fdx * flen;
      const ey = fy + fdy * flen;
      allPaths.push(walk(fx, fy, ex, ey, step, wobble * 1.25));
      sparkPoints.push([ex, ey]);
    }
  }

  // ── Render passes (back → front, each overwrites the previous's
  //    centermost pixels in source-over mode) ──────────────────────
  //
  // For each Bresenham pixel of every path segment, stamp a centered
  // square of the appropriate color. Drawing widest first means the
  // sheath square overwrites the halo's center, and the core pixel
  // overwrites the sheath's center → automatic concentric gradient.

  const haloR   = drawGlow ? width + 1 : 0;
  const sheathR = width;

  // Pass 1: halo (widest, dimmest).
  if (haloR > 0) {
    ctx.fillStyle = palette.halo;
    const d = haloR * 2 + 1;
    for (let pi = 0; pi < allPaths.length; pi++) {
      _bresenhamWalk(allPaths[pi], (x, y) => ctx.fillRect(x - haloR, y - haloR, d, d));
    }
  }
  // Pass 2: sheath (mid-radius).
  ctx.fillStyle = palette.sheath;
  if (sheathR >= 1) {
    const d = sheathR * 2 + 1;
    for (let pi = 0; pi < allPaths.length; pi++) {
      _bresenhamWalk(allPaths[pi], (x, y) => ctx.fillRect(x - sheathR, y - sheathR, d, d));
    }
  }
  // Pass 3: 1px white-hot core (always sharp, regardless of width).
  ctx.fillStyle = palette.core;
  for (let pi = 0; pi < allPaths.length; pi++) {
    _bresenhamWalk(allPaths[pi], (x, y) => ctx.fillRect(x, y, 1, 1));
  }

  // Pass 4: sparks at endpoints + fork tips. Brighter, slightly larger
  // than the bolt itself so they pop as "the lightning lands here."
  if (drawSparks) {
    for (let i = 0; i < sparkPoints.length; i++) {
      _lightningSpark(ctx, sparkPoints[i][0], sparkPoints[i][1], palette, width);
    }
  }
}

// Bresenham line walk — calls `cb(x, y)` for every pixel along the
// polyline. Endpoints are rounded to integers so the line stays
// pixel-snapped regardless of fractional input coords.
function _bresenhamWalk(path, cb) {
  for (let i = 0; i < path.length - 1; i++) {
    let x0 = Math.round(path[i][0]),     y0 = Math.round(path[i][1]);
    const x1 = Math.round(path[i + 1][0]), y1 = Math.round(path[i + 1][1]);
    const dx = Math.abs(x1 - x0), dy = Math.abs(y1 - y0);
    const sx = x0 < x1 ? 1 : -1,  sy = y0 < y1 ? 1 : -1;
    let err = dx - dy;
    while (true) {
      cb(x0, y0);
      if (x0 === x1 && y0 === y1) break;
      const e2 = err * 2;
      if (e2 > -dy) { err -= dy; x0 += sx; }
      if (e2 <  dx) { err += dx; y0 += sy; }
    }
  }
}

// Bright bead at a bolt endpoint / fork tip. Concentric stamps so the
// hottest center is white and falloff is cyan → blue. Size scales with
// the bolt's `width` so thicker bolts get thicker sparks.
function _lightningSpark(ctx, x, y, palette, width) {
  x = Math.round(x); y = Math.round(y);
  const r = width + 1;
  // Halo ring — 4 cardinal dots one step out from the sheath square.
  ctx.fillStyle = palette.halo;
  ctx.fillRect(x - r - 1, y, 1, 1);
  ctx.fillRect(x + r + 1, y, 1, 1);
  ctx.fillRect(x, y - r - 1, 1, 1);
  ctx.fillRect(x, y + r + 1, 1, 1);
  // Sheath square — solid block sized to bolt width.
  ctx.fillStyle = palette.sheath;
  ctx.fillRect(x - r, y - r, r * 2 + 1, r * 2 + 1);
  // Inner core cross — bright plus shape inside the sheath.
  ctx.fillStyle = palette.core;
  ctx.fillRect(x - 1, y, 3, 1);
  ctx.fillRect(x, y - 1, 1, 3);
  // Center white-hot pixel.
  ctx.fillStyle = '#ffffff';
  ctx.fillRect(x, y, 1, 1);
}

// ─── 8b. Extended creature primitives ─────────────────────────────
// Composable parts that pair with softBlob/eye/mouth/limb to build a
// wider menagerie (fish, birds, undead, slime, beetles). Each takes a
// position + palette + opts and stays within a small bounding box so
// the assembling artist controls layout.

// Curving tail tapering to a tip. Path is parametrized by base→tip
// vector and a curve amount; useful for cats, lizards, dragons,
// rats — anything with a swept rear appendage.
//   palette: { shadow, body, hilite }
//   opts:    { startW=2, endW=1, curve=0, scaled=false }
//     scaled — if true, draws scale notches every other pixel
export function tail(ctx, baseX, baseY, tipX, tipY, palette, opts = {}) {
  const startW = opts.startW != null ? opts.startW : 2;
  const endW   = opts.endW   != null ? opts.endW   : 1;
  const curve  = opts.curve  != null ? opts.curve  : 0;
  const scaled = !!opts.scaled;
  const dx = tipX - baseX, dy = tipY - baseY;
  const len = Math.max(1, Math.round(Math.sqrt(dx * dx + dy * dy)));
  for (let i = 0; i <= len; i++) {
    const t = i / len;
    // Quadratic curve perpendicular to direction.
    const bend = Math.sin(t * Math.PI) * curve;
    const ux = dx / len, uy = dy / len;
    const px = -uy, py = ux;
    const cx = Math.round(baseX + ux * i + px * bend);
    const cy = Math.round(baseY + uy * i + py * bend);
    const w = Math.max(endW, Math.round(startW - (startW - endW) * t));
    for (let k = -Math.floor(w / 2); k <= Math.floor(w / 2); k++) {
      ctx.fillStyle = (k === 0) ? palette.body
                    : (k > 0)    ? palette.shadow
                    :              palette.hilite;
      ctx.fillRect(cx + Math.round(px * k), cy + Math.round(py * k), 1, 1);
    }
    if (scaled && (i & 1) === 0) {
      ctx.fillStyle = palette.shadow;
      ctx.fillRect(cx, cy, 1, 1);
    }
  }
}

// 3-toed paw / footprint. Centered at (cx, cy), facing direction
// `dir` ('S','N','E','W'). Renders the meaty heel pad + 3 toe blobs.
//   palette: { pad, claw? }
export function paw(ctx, cx, cy, palette, opts = {}) {
  const dir = opts.dir || 'S';
  const heelOff = { S: [0,  1], N: [0, -1], E: [ 1, 0], W: [-1, 0] }[dir];
  const toeOff  = { S: [0, -1], N: [0,  1], E: [-1, 0], W: [ 1, 0] }[dir];
  const perp    = { S: [1,  0], N: [1,  0], E: [ 0, 1], W: [ 0, 1] }[dir];
  // Heel
  ctx.fillStyle = palette.pad;
  ctx.fillRect(cx + heelOff[0] - 1, cy + heelOff[1] - 1, 3, 1);
  ctx.fillRect(cx + heelOff[0],     cy + heelOff[1],     1, 1);
  // 3 toes — center, +perp, -perp
  for (let k = -1; k <= 1; k++) {
    ctx.fillRect(cx + toeOff[0] + perp[0] * k, cy + toeOff[1] + perp[1] * k, 1, 1);
  }
  if (palette.claw) {
    ctx.fillStyle = palette.claw;
    for (let k = -1; k <= 1; k++) {
      ctx.fillRect(cx + toeOff[0] * 2 + perp[0] * k, cy + toeOff[1] * 2 + perp[1] * k, 1, 1);
    }
  }
}

// Vertical / dorsal fin. Triangular shape with internal ribs.
// Anchor (baseX, baseY) is the back edge centerline; fin extends "up"
// (negative Y) by `height`, with `length` along baseline.
//   palette: { membrane, rib }
export function fin(ctx, baseX, baseY, length, height, palette, opts = {}) {
  const ribs = opts.ribs != null ? opts.ribs : 3;
  // Membrane — triangular fill.
  for (let i = 0; i < length; i++) {
    const t = Math.abs(i - length / 2) / (length / 2);  // 0 at center, 1 at edges
    const h = Math.max(1, Math.round(height * (1 - t)));
    ctx.fillStyle = palette.membrane;
    for (let k = 0; k < h; k++) {
      ctx.fillRect(baseX + i, baseY - k, 1, 1);
    }
  }
  // Ribs — vertical lines spaced through the membrane.
  ctx.fillStyle = palette.rib;
  for (let r = 1; r <= ribs; r++) {
    const px = baseX + Math.round((length - 1) * r / (ribs + 1));
    const t = Math.abs(px - (baseX + length / 2)) / (length / 2);
    const h = Math.max(1, Math.round(height * (1 - t)) - 1);
    for (let k = 0; k <= h; k++) {
      ctx.fillRect(px, baseY - k, 1, 1);
    }
  }
}

// Spiky head/back crest — row of triangular spikes along a line.
//   palette: { base, tip }
//   opts:    { count=5, spike=2 }
export function crest(ctx, x0, y0, x1, y1, palette, opts = {}) {
  const count = opts.count != null ? opts.count : 5;
  const spike = opts.spike != null ? opts.spike : 2;
  const dx = x1 - x0, dy = y1 - y0;
  const ux = dx / count, uy = dy / count;
  const len = Math.sqrt(dx * dx + dy * dy) || 1;
  const px = -dy / len, py = dx / len;
  for (let i = 0; i < count; i++) {
    const sx = Math.round(x0 + ux * (i + 0.5));
    const sy = Math.round(y0 + uy * (i + 0.5));
    for (let k = 0; k < spike; k++) {
      ctx.fillStyle = (k === spike - 1) ? palette.tip : palette.base;
      const w = spike - k;
      for (let j = -Math.floor(w / 2); j <= Math.floor(w / 2); j++) {
        ctx.fillRect(Math.round(sx + Math.round(px * (k + 1)) + j),
                     Math.round(sy + Math.round(py * (k + 1))), 1, 1);
      }
    }
  }
}

// Segmented carapace shell — dome with banding lines. Useful for
// turtles, beetles, crustacean abdomens.
//   palette: { dark, body, light }
//   opts:    { rx, ry, bands=3 }
export function shell(ctx, cx, cy, palette, opts = {}) {
  const rx = opts.rx != null ? opts.rx : 6;
  const ry = opts.ry != null ? opts.ry : 4;
  const bands = opts.bands != null ? opts.bands : 3;
  // Filled ellipse (top half) via pxEllipse-style scan.
  for (let dy = -ry; dy <= 0; dy++) {
    const r = Math.sqrt(Math.max(0, 1 - (dy * dy) / (ry * ry))) * rx;
    const w = Math.round(r);
    for (let dx = -w; dx <= w; dx++) {
      const t = -dy / ry;       // 0 at base, 1 at top
      const edge = Math.abs(dx) >= w - 1;
      ctx.fillStyle = edge        ? palette.dark
                    : t > 0.7     ? palette.light
                    :               palette.body;
      ctx.fillRect(cx + dx, cy + dy, 1, 1);
    }
  }
  // Banding lines — radial from base center.
  ctx.fillStyle = palette.dark;
  for (let b = 1; b < bands; b++) {
    const a = -Math.PI + (Math.PI * b) / bands;
    for (let s = 1; s <= rx - 1; s++) {
      const px = Math.round(Math.cos(a) * s);
      const py = Math.round(Math.sin(a) * s * (ry / rx));
      if (py > 0) continue;
      ctx.fillRect(cx + px, cy + py, 1, 1);
    }
  }
}

// Bioluminescent spot — bright center + soft halo cross. Good for
// jellyfish lights, deep-sea creature lures, alien bug eyes.
//   palette: { core, halo }
export function glowSpot(ctx, cx, cy, palette, opts = {}) {
  const haloLen = opts.haloLen != null ? opts.haloLen : 2;
  ctx.fillStyle = palette.core;
  ctx.fillRect(cx, cy, 1, 1);
  ctx.fillStyle = palette.halo;
  for (let k = 1; k <= haloLen; k++) {
    ctx.fillRect(cx - k, cy, 1, 1);
    ctx.fillRect(cx + k, cy, 1, 1);
    ctx.fillRect(cx, cy - k, 1, 1);
    ctx.fillRect(cx, cy + k, 1, 1);
  }
}

// Slime/ooze pseudopod — wobbly thick tendril with bumpy edge.
// Differs from `tentacle` in that it has visible drips and bulges
// rather than a smooth ridge.
//   palette: { shadow, body, hilite, drip? }
export function pseudopod(ctx, baseX, baseY, tipX, tipY, palette, opts = {}) {
  const startR = opts.startR != null ? opts.startR : 3;
  const endR   = opts.endR   != null ? opts.endR   : 1;
  const dx = tipX - baseX, dy = tipY - baseY;
  const len = Math.max(1, Math.round(Math.sqrt(dx * dx + dy * dy)));
  for (let i = 0; i <= len; i++) {
    const t = i / len;
    const ux = dx / len, uy = dy / len;
    const cx = Math.round(baseX + ux * i);
    const cy = Math.round(baseY + uy * i);
    // Bumpy radius — sinusoidal jitter on top of the linear taper.
    const baseR = startR + (endR - startR) * t;
    const bump = Math.sin(t * Math.PI * 4) * 0.4;
    const r = Math.max(1, Math.round(baseR + bump));
    const px = -uy, py = ux;
    for (let k = -r; k <= r; k++) {
      const dxx = Math.round(px * k), dyy = Math.round(py * k);
      ctx.fillStyle = (Math.abs(k) === r) ? palette.shadow
                    : (k === 0)            ? palette.hilite
                    :                         palette.body;
      ctx.fillRect(cx + dxx, cy + dyy, 1, 1);
    }
  }
  // Drip at tip
  if (palette.drip) {
    ctx.fillStyle = palette.drip;
    ctx.fillRect(tipX, tipY + 1, 1, 1);
  }
}

// ─── 11. Tile primitives ──────────────────────────────────────────
// Tile-sized stamps designed to tile seamlessly. Each takes a ctx +
// tile origin (x, y) + size + palette. They never read pixels (cheap
// to bake) and never paint outside the (size × size) box. Composable:
// stack a base + a pattern + edges for full tile sprites.
//
// Convention: deterministic noise comes from a seed integer + tile
// position so the same (x, y) renders the same pattern across rebakes.

function _tileHash(seed, x, y) {
  let h = ((seed | 0) ^ ((x | 0) * 73856093) ^ ((y | 0) * 19349663)) >>> 0;
  h = (h ^ (h >>> 13)) * 0xc2b2ae35 >>> 0;
  return h ^ (h >>> 16);
}

// ─── 10b. Ambient creatures — birds + insects ────────────────────────
// Tiny winged silhouettes for overhead/ambient life. All draw in
// bake-local coords (fit Scene's `dynamic` entries). Every palette
// follows the 5-stop pixel-art convention:
//
//   glare      — brightest accent (wing tips, eye glints, rim light)
//   highlight  — lightest plane (top surface, leading edge)
//   neutral    — base shade (mid-tone body, wing surface)
//   halfShadow — transitional dark (underside, inner wing, belly)
//   shadow     — darkest areas (outline, deepest crevice, far leg)

// ── Default palettes — one per creature type ───────────────────────
// Hue-shifted chiaroscuro: highlights shift warm (toward yellow),
// shadows shift cool (toward blue/purple). Each palette has distinct
// hue character so the creature reads as a cohesive coloured object
// rather than a flat monochrome silhouette.

export const BIRD_PALETTE = {
  glare:      '#a08060',   // rich warm tan (same hue family, not white)
  highlight:  '#7a6050',   // warm golden tan
  neutral:    '#4a3830',   // warm mid-brown
  halfShadow: '#2a2428',   // cool dark brown
  shadow:     '#1a1e2a',   // cool deep blue-grey (blue-shifted)
};

export const BIRDSIDE_PALETTE = {
  glare:      '#a06840',   // rich warm copper (same hue family, not white)
  highlight:  '#7a5030',   // warm golden brown
  neutral:    '#4e3424',   // warm earth brown
  halfShadow: '#2e201a',   // cool muted brown
  shadow:     '#1a1420',   // cool purple-brown (purple-shifted)
};

export const DRAGONFLY_PALETTE = {
  glare:      '#b8e0a0',   // pale yellow-green (yellow-shifted)
  highlight:  '#4a8030',   // vibrant yellow-green
  neutral:    '#1e4a2e',   // rich emerald green
  halfShadow: '#142e20',   // cool deep green
  shadow:     '#0a1a18',   // cool teal-dark (blue-shifted)
  wing:       'rgba(140,190,230,0.45)',  // cool translucent blue (contrasts warm body)
};

export const BUTTERFLY_PALETTE = {
  glare:      '#f0b858',   // bright warm orange (same hue family, not white)
  highlight:  '#e89838',   // vivid yellow-orange
  neutral:    '#c06028',   // vibrant orange
  halfShadow: '#4a1810',   // warm deep red-brown
  shadow:     '#1a0a14',   // cool deep burgundy (purple-shifted)
  spot:       '#f8d898',   // warm cream spot (same warmth as wing)
};

// Firefly — tiny insect with a bioluminescent abdomen. 4-stop palette:
// body (dark), glow-core (bright), and a translucent halo for the
// ambient bloom rendered around the glow center.
export const FIREFLY_PALETTE = {
  body:    '#1a1408',   // very dark warm brown — body silhouette
  bodyLit: '#3a2810',   // slightly lit body edge (catches glow reflection)
  glow:    '#f8e890',   // warm yellow-green core
  glare:   '#ffffd8',   // near-white glow center (the focal "spark")
  halo:    'rgba(248,232,144,0.35)', // translucent bloom around the glow
};

// Bug / beetle — small armored insect. 5-stop palette like the other
// creatures so it matches dragonfly/butterfly shading conventions.
export const BUG_PALETTE = {
  glare:      '#a8b870',   // brightest carapace highlight (warm green)
  highlight:  '#788840',   // upper-shell lit area
  neutral:    '#485828',   // body core (mossy green)
  halfShadow: '#202810',   // underside / leg shadow
  shadow:     '#0a1408',   // deepest shadow / outline
};

// Fly — tiny black insect.  Body is just 1-2 dark pixels; identifying
// features are the translucent wing-blur halo on each side (the visual
// shorthand for "fast-flapping wings") and the chaotic small-amplitude
// motion when used in swarms.
export const FLY_PALETTE = {
  body:    '#0a0a0a',                 // near-black body
  bodyLit: '#1c1a18',                 // top-lit body edge (medium size)
  wing:    'rgba(40,40,48,0.50)',     // translucent wing-blur
  haze:    'rgba(0,0,0,0.18)',        // optional dark dust halo
};

// ── Dead-wood palette (5-stop, hue-shifted cool) ─────────────────────
// Default palette for treeDead. Flat (single section, no trunk/foliage
// split) because dead trees have no foliage to differentiate.
export const DEAD_WOOD_PALETTE = {
  shadow:    '#0c1018',
  midtone:   '#1e2028',
  neutral:   '#2e3038',
  light:     '#484a50',
  highlight: '#606268',
};




// Top-down / from-below bird — TRUE bird silhouette seen from below
// (looking up at a circling bird).  The body is a vertical line of
// dark shadow (chest+head pointing up, tail pointing down), and the
// wings sweep LATERALLY out from the shoulders with tapered triangular
// shapes.  Wing tips curve up or down based on flapT, creating the
// classic flap-cycle silhouette.
//
// Wing thickness tapers from 2 px near the body (where the feathers
// are broad) to 1 px at the tip (the wingtip primaries).  Wings also
// have a slight backward sweep — the tips trail behind the leading
// edge — so the bird reads as moving FORWARD rather than just floating.
//
//   palette = { shadow, halfShadow, neutral, highlight, glare }
//     (defaults to BIRD_PALETTE)
//   opts.wingspan — total tip-to-tip wing width (default 7)
//   opts.flapT    — 0..1 wing phase (0 = wings up, 0.5 = level,
//                   1 = wings down)
export function bird(ctx, cx, cy, palette, opts = {}) {
  const p     = palette || BIRD_PALETTE;
  const span  = opts.wingspan != null ? opts.wingspan : 7;
  const flapT = opts.flapT    != null ? opts.flapT    : 0.5;
  const half  = Math.max(1, Math.round(span / 2));

  // Wing tip vertical offset — flapT 0..1 maps to tips above..below body.
  // Scaled by `half` so larger birds get proportionally bigger flaps.
  const tipDy = Math.round((flapT - 0.5) * (half + 1) * 0.9);

  // ── Wings (drawn before body so body paints over the seam) ───────
  for (let side = -1; side <= 1; side += 2) {
    for (let i = 1; i <= half; i++) {
      const t = i / half;  // 0 = body, 1 = tip
      // Wing y curve — sin makes it arc rather than straight, so the
      // wing looks like a real bird's curved wing rather than a stick.
      const arc = Math.sin(t * Math.PI / 2);  // 0 → 1 (faster near tip)
      const wy = cy - 1 + Math.round(arc * tipDy);
      const x  = cx + side * i;

      // Leading-edge color band (the visible wing surface from below):
      //   tip       → glare      (brightest, rim-lit by sky)
      //   near-tip  → highlight  (lit primaries)
      //   mid       → neutral    (mid-wing feathers)
      //   near-body → halfShadow (shoulder/coverts in shade)
      let col;
      if (i === half)                            col = p.glare;
      else if (i >= half - 1)                    col = p.highlight;
      else if (t >= 0.4)                         col = p.neutral;
      else                                       col = p.halfShadow;
      ctx.fillStyle = col;
      ctx.fillRect(x, wy, 1, 1);

      // Wing thickness — inner ~60% gets a 2nd pixel below for the
      // trailing edge.  Tip stays 1-px thin (the primary feathers).
      if (t < 0.65) {
        ctx.fillStyle = (t < 0.30) ? p.shadow : p.halfShadow;
        ctx.fillRect(x, wy + 1, 1, 1);
      }
    }
  }

  // ── Body — vertical 5-row silhouette ─────────────────────────────
  //
  // Head (cy-2) at top → shoulders → mid body → lower body → tail (cy+2).
  // Wing roots attach at cy-1 (shoulders).  Body is mostly shadow with
  // a halfShadow highlight in the middle so it reads as a chest-up
  // silhouette against the bright sky.
  ctx.fillStyle = p.shadow;
  ctx.fillRect(cx, cy - 2, 1, 1);  // head
  ctx.fillRect(cx, cy - 1, 1, 1);  // shoulders / wing root
  ctx.fillRect(cx, cy,     1, 1);  // mid body
  ctx.fillRect(cx, cy + 1, 1, 1);  // lower body
  ctx.fillRect(cx, cy + 2, 1, 1);  // tail base
  ctx.fillStyle = p.halfShadow;
  ctx.fillRect(cx, cy,     1, 1);  // mid-body highlight

  // Tail fan — small forked-tail extension visible on larger birds.
  if (span >= 7) {
    ctx.fillStyle = p.shadow;
    ctx.fillRect(cx - 1, cy + 2, 1, 1);
    ctx.fillRect(cx + 1, cy + 2, 1, 1);
    ctx.fillRect(cx,     cy + 3, 1, 1);  // tail tip
  }
}

// Side-view bird — recognizable side-profile body (tapered oval with
// distinct head + beak + tail) and ONE visible wing that swings
// through the flap cycle via angle interpolation.  The far wing is
// hidden behind the body (correct from-side perspective).
//
// Wing pivots from a shoulder point on the upper back.  flapT 0..1
// maps the wing tip through a 180° arc:
//   flapT = 0    → wing straight UP (top of flap)
//   flapT = 0.5  → wing swept BACK along the body (mid-cycle)
//   flapT = 1    → wing straight DOWN (bottom of flap)
//
//   palette = { shadow, halfShadow, neutral, highlight, glare }
//   opts.facing — 1 (right, default) or -1 (left)
//   opts.flapT  — 0..1 wing phase
//   opts.size   — body length in px (default 5)
export function birdSide(ctx, cx, cy, palette, opts = {}) {
  const p      = palette || BIRDSIDE_PALETTE;
  const dir    = (opts.facing != null ? opts.facing : 1) >= 0 ? 1 : -1;
  const flapT  = opts.flapT != null ? opts.flapT : 0.5;
  const size   = opts.size  != null ? opts.size  : 5;
  const bodyHalf = Math.max(1, Math.floor(size / 2));

  // ── Body: tapered horizontal oval centered at (cx, cy) ───────────
  //
  // Per column: full body (3 rows tall) near center, taper to 1 row
  // at the ends.  Top row = highlight (back lit by sky), mid =
  // neutral, bottom row = shadow (belly in shade from above-lighting).
  for (let dx = -bodyHalf; dx <= bodyHalf; dx++) {
    const t = Math.abs(dx) / (bodyHalf + 0.001);
    const x = cx + dx;
    // Mid row always
    ctx.fillStyle = (t < 0.4) ? p.neutral : p.halfShadow;
    ctx.fillRect(x, cy, 1, 1);
    // Top + bottom rows only for the wider central portion
    if (t < 0.75) {
      ctx.fillStyle = p.highlight;
      ctx.fillRect(x, cy - 1, 1, 1);
      ctx.fillStyle = p.shadow;
      ctx.fillRect(x, cy + 1, 1, 1);
    }
  }

  // ── Head: 2×2 block at the front of the body, with eye + crown ──
  const headX = cx + (bodyHalf + 1) * dir;
  ctx.fillStyle = p.neutral;
  ctx.fillRect(headX, cy - 1, 1, 1);
  ctx.fillRect(headX, cy,     1, 1);
  ctx.fillStyle = p.highlight;
  ctx.fillRect(headX, cy - 1, 1, 1);  // crown highlight (overpaint)
  ctx.fillStyle = p.glare;
  ctx.fillRect(headX, cy,     1, 1);  // eye — bright dot on neutral

  // Beak — small triangle protruding forward of the head.
  ctx.fillStyle = p.halfShadow;
  ctx.fillRect(headX + dir, cy, 1, 1);
  if (size >= 6) {
    ctx.fillStyle = p.shadow;
    ctx.fillRect(headX + 2 * dir, cy, 1, 1);  // long beak on larger birds
  }

  // ── Tail: tapered fork behind the body ──────────────────────────
  const tailX = cx - (bodyHalf + 1) * dir;
  ctx.fillStyle = p.halfShadow;
  ctx.fillRect(tailX, cy - 1, 1, 1);
  ctx.fillRect(tailX, cy,     1, 1);
  ctx.fillStyle = p.shadow;
  ctx.fillRect(tailX - dir, cy,     1, 1);  // tail tip
  ctx.fillRect(tailX,       cy + 1, 1, 1);  // lower tail feather

  // ── Wing: swung through flap arc via angle interpolation ────────
  //
  // Shoulder pivot sits on the upper-back of the body (slightly behind
  // center).  Wing length scales with body size.  Drawn as a Bresenham
  // line from shoulder to tip, with the tip getting a bright glare
  // pixel (catches sky-light on the upstroke peak).
  const shoulderX = cx + Math.round(bodyHalf * 0.2) * -dir;
  const shoulderY = cy - 1;
  const wingLen   = 2 + Math.floor(size / 2);
  // flapT 0 → angle = -π/2 (straight up); flapT 1 → +π/2 (straight down).
  // The wing also has a slight backward sweep so it doesn't extend
  // forward of the bird at mid-flap.
  const angle = (flapT - 0.5) * Math.PI;
  const tipX  = Math.round(shoulderX + Math.cos(angle) * wingLen * -dir * 0.6);
  const tipY  = Math.round(shoulderY + Math.sin(angle) * wingLen);
  // Wing body
  pxLine(ctx, shoulderX, shoulderY, tipX, tipY, p.neutral);
  // Leading edge highlight (one pixel offset toward leading direction)
  const leadDx = (flapT < 0.5) ? -dir : dir;  // depends on flap direction
  if (wingLen >= 3) {
    pxLine(ctx, shoulderX, shoulderY, tipX + leadDx, tipY, p.highlight);
  }
  // Tip glare
  ctx.fillStyle = p.glare;
  ctx.fillRect(tipX, tipY, 1, 1);
}

// Top-down dragonfly — long body + 4 translucent wings, 5-stop shading.
// Thorax has a highlight top-plane; tail segments alternate neutral/
// halfShadow; wings are thin translucent diagonals with glare veins.
//
//   palette = { shadow, halfShadow, neutral, highlight, glare, wing? }
//   opts.length     — body length (default 10)
//   opts.wingPhase  — 0..1 wing animation phase (default 0)
export function dragonfly(ctx, cx, cy, palette, opts = {}) {
  const p         = palette || DRAGONFLY_PALETTE;
  const len       = opts.length     != null ? opts.length     : 10;
  const wingPhase = opts.wingPhase  != null ? opts.wingPhase  : 0;
  const half      = Math.round(len / 2);

  // Tail — tapering segmented body behind the thorax
  for (let i = 1; i <= half; i++) {
    const segW = Math.max(1, 3 - Math.floor(i / 3));
    ctx.fillStyle = i % 2 === 0 ? p.neutral : p.halfShadow;
    for (let j = 0; j < segW; j++) {
      ctx.fillRect(cx + j - Math.round((segW - 1) / 2), cy + i, 1, 1);
    }
    // Segment divide — thin shadow line
    if (i > 1 && i < half) {
      ctx.fillStyle = p.shadow;
      ctx.fillRect(cx - 1, cy + i, 1, 1);
      ctx.fillRect(cx + 1, cy + i, 1, 1);
    }
    // Tail tip — glare point
    if (i === half) {
      ctx.fillStyle = p.glare;
      ctx.fillRect(cx, cy + i + 1, 1, 1);
    }
  }
  // Thorax — 3×2 oval with highlight top
  ctx.fillStyle = p.shadow;
  ctx.fillRect(cx - 2, cy, 3, 2);        // underside shadow
  ctx.fillStyle = p.neutral;
  ctx.fillRect(cx - 1, cy - 1, 3, 2);    // body core
  ctx.fillStyle = p.highlight;
  ctx.fillRect(cx, cy - 2, 1, 1);        // top highlight
  ctx.fillRect(cx - 1, cy - 1, 1, 1);
  ctx.fillRect(cx + 1, cy - 1, 1, 1);
  // Head — neutral with glare eyes
  ctx.fillStyle = p.neutral;
  ctx.fillRect(cx, cy - 2, 1, 1);
  ctx.fillStyle = p.glare;
  ctx.fillRect(cx - 1, cy - 2, 1, 1);
  ctx.fillRect(cx + 1, cy - 2, 1, 1);

  // Four wings — thin diagonal translucent strokes. Wing angle pulses
  // with wingPhase for a subtle shimmer.
  const wingLen = 4 + Math.round(Math.sin(wingPhase * Math.PI * 2) * 1);
  for (let side = -1; side <= 1; side += 2) {
    // Upper wing pair
    for (let w = 0; w < wingLen; w++) {
      if (w === 0) continue;
      const wx = cx + side * (1 + w);
      const wy = cy - 2 - w;
      // Glare edge at wing tip, translucent wingCol mid, shadow at base
      ctx.fillStyle = w >= wingLen - 1 ? p.glare : p.wing || 'rgba(160,200,220,0.45)';
      ctx.fillRect(wx, wy, 1, 1);
      // Wing vein — single pixel highlight
      if (w === Math.round(wingLen / 2)) {
        ctx.fillStyle = p.glare;
        ctx.fillRect(wx, wy - 1, 1, 1);
      }
    }
    // Lower wing pair (slightly shorter, slightly back)
    for (let w = 0; w < wingLen - 1; w++) {
      if (w === 0) continue;
      const wx = cx + side * (1 + w);
      const wy = cy + 1 - w;
      ctx.fillStyle = w >= wingLen - 2 ? p.glare : p.wing || 'rgba(160,200,220,0.45)';
      ctx.fillRect(wx, wy, 1, 1);
    }
  }
}

// Top-down MONARCH-style butterfly — kite-shaped forewings sweeping
// up-and-outward with the iconic dark tip patches + cream spots,
// rounded hindwings with pearl-spot trailing edges, internal color
// zones (yellow inner cells → bright orange mid → dark red edge band
// → black outline), slender 1-px body, and clubbed antennae.
//
// Wings are rasterized COLUMN-BY-COLUMN rather than as ellipses, so
// the silhouette can have the proper monarch kite shape (forewing
// top edge rises monotonically from body to outer-upper tip, instead
// of the symmetric oval an ellipse would produce).  Each pixel inside
// the wing picks a color based on its (column-fraction, vertical-
// fraction) position, producing the visible color-zone bands without
// requiring per-tier ellipse passes.
//
//   palette = { shadow, halfShadow, neutral, highlight, glare, spot? }
//   opts.wingspan — total tip-to-tip width when fully open (default 13)
//   opts.flapT    — 0..1 wing openness (default 0.8).  At 0 wings are
//                   small folded silhouettes; at 1 fully extended.
export function butterfly(ctx, cx, cy, palette, opts = {}) {
  const p     = palette || BUTTERFLY_PALETTE;
  const span  = opts.wingspan != null ? opts.wingspan : 13;
  const flapT = opts.flapT    != null ? opts.flapT    : 0.8;

  // Wing reach scales with span and flapT.  Slightly more aggressive
  // scaling (0.55 base + 0.45 flap-driven) than before so the wings
  // stay readable at the small wingspans typical for scene use (8-12).
  const reach = Math.max(3, Math.round((span / 2) * (0.55 + 0.45 * flapT)));
  const fwW   = reach;
  const fwH   = Math.max(2, Math.round(reach * 0.85));
  const hwW   = Math.max(2, Math.round(reach * 0.75));
  const hwH   = Math.max(2, Math.round(reach * 0.70));

  // Body + antennae dimensions scale with wing reach so the silhouette
  // stays balanced — without this, small wingspans (~8) get a fixed
  // 12-px body+antennae towering over tiny 3-px wings (looks broken).
  const bodyTop = Math.max(2, Math.round(reach * 0.50));    // body extends -bodyTop above cy
  const bodyBot = Math.max(1, Math.round(reach * 0.35));    // body extends +bodyBot below cy
  const antLen  = Math.max(2, Math.round(reach * 0.40));    // antenna segments above body top

  for (let side = -1; side <= 1; side += 2) {
    // ── FOREWING: kite shape, top edge rises to outer-upper tip ──
    //
    // Per column: topY uses cf^0.65 (steep rise near body, slow near
    // tip) so the wing tip is the HIGHEST point — characteristic
    // monarch silhouette.  botY tapers up slightly toward the tip
    // (the wing narrows toward the outer corner).
    for (let c = 1; c <= fwW; c++) {
      const cf   = (c - 0.5) / fwW;            // 0..1 from body to tip
      // topY/botY are ABSOLUTE canvas y coords (include cy).
      const topY = cy - 1 - Math.round(fwH * Math.pow(cf, 0.65));
      const botY = cy + 1 - Math.round(cf * cf * 2);
      const x    = cx + side * c;

      const colHeight = botY - topY;
      for (let y = topY; y <= botY; y++) {
        const dyT = y - topY;                  // 0 at top edge
        const dyB = botY - y;                  // 0 at bottom edge
        const distEdge = Math.min(dyT, dyB);
        const vf  = dyT / Math.max(1, colHeight);

        let col;
        // 1) Hard outline at the very edges
        if (distEdge === 0 || c === fwW) {
          col = p.shadow;
        }
        // 2) Forewing TIP PATCH — dark monarch-corner at outer-upper
        else if (cf > 0.55 && vf < 0.40 && fwH >= 3) {
          col = p.halfShadow;
        }
        // 3) Edge band (1 px inside outline) — ONLY when the column
        //    is tall enough to leave room for a colorful interior.
        //    Without this guard, narrow wings paint entirely in
        //    outline + edge-band, with no room for the bright colors.
        else if (distEdge === 1 && colHeight >= 4) {
          col = p.halfShadow;
        }
        // 4) Inner cell near body — yellow innermost zone
        else if (cf < 0.32) {
          col = p.glare;
        }
        // 5) Mid wing body — bright orange
        else if (cf < 0.68) {
          col = p.highlight;
        }
        // 6) Default — orange
        else {
          col = p.neutral;
        }
        ctx.fillStyle = col;
        ctx.fillRect(x, y, 1, 1);
      }
    }

    // Forewing CREAM SPOTS inside the dark tip patch — the iconic
    // monarch wing markings.  Placed at decreasing y from outer tip
    // so they form a small cluster of 2-3 dots in the dark corner.
    if (fwW >= 4 && p.spot) {
      ctx.fillStyle = p.spot;
      ctx.fillRect(cx + side * (fwW - 1), cy - fwH + 1, 1, 1);
      if (fwW >= 5) ctx.fillRect(cx + side * (fwW - 2), cy - fwH + 2, 1, 1);
      if (fwW >= 6) ctx.fillRect(cx + side * (fwW - 1), cy - fwH + 3, 1, 1);
    }

    // ── HINDWING: rounded scoop below body ─────────────────────────
    for (let c = 1; c <= hwW; c++) {
      const cf   = (c - 0.5) / hwW;
      // topY/botY are ABSOLUTE canvas y coords (include cy).
      const topY = cy + 2 - Math.round(cf * cf * 0.5);
      const botY = cy + 2 + Math.max(1, Math.round(hwH * Math.sin(cf * Math.PI * 0.7 + Math.PI * 0.15)));
      const x    = cx + side * c;

      const colHeight = botY - topY;
      for (let y = topY; y <= botY; y++) {
        const dyT = y - topY;
        const dyB = botY - y;
        const distEdge = Math.min(dyT, dyB);

        let col;
        if (distEdge === 0 || c === hwW) {
          col = p.shadow;
        } else if (distEdge === 1 && colHeight >= 4) {
          col = p.halfShadow;
        } else if (cf < 0.40) {
          col = p.glare;
        } else if (cf < 0.75) {
          col = p.highlight;
        } else {
          col = p.neutral;
        }
        ctx.fillStyle = col;
        ctx.fillRect(x, y, 1, 1);
      }
    }

    // Hindwing TRAILING-EDGE PEARL SPOTS — cream dots placed 1 px
    // inside the bottom outline at every-other column (matches the
    // pearl-row pattern on real monarch hindwings).
    if (hwW >= 3 && p.spot) {
      ctx.fillStyle = p.spot;
      for (let i = 1; i < hwW - 1; i++) {
        if (i % 2 === 0) continue;
        const cf   = (i - 0.5) / hwW;
        const botY = cy + 2 + Math.max(1, Math.round(hwH * Math.sin(cf * Math.PI * 0.7 + Math.PI * 0.15)));
        ctx.fillRect(cx + side * i, botY - 1, 1, 1);
      }
    }
  }

  // ── Body: slender 1-px vertical line, sized to wing reach ───────
  //
  // Body height scales with `bodyTop + bodyBot` (derived from `reach`
  // above), so the body stays proportional to the wing area at all
  // wingspans.  Drawn LAST so it overpaints wing pixels at x=cx.
  // Alternating halfShadow stripes give the segmented chitin look.
  ctx.fillStyle = p.shadow;
  for (let dy = -bodyTop; dy <= bodyBot; dy++) ctx.fillRect(cx, cy + dy, 1, 1);
  ctx.fillStyle = p.halfShadow;
  // Highlight every-other row from the top (thorax → abdomen segments)
  for (let dy = -bodyTop + 1; dy <= bodyBot - 1; dy += 2) {
    ctx.fillRect(cx, cy + dy, 1, 1);
  }

  // ── Antennae: thin diagonals with clubbed tips ─────────────────
  //
  // Two segments per side, length scales with `antLen`.  The shaft
  // tilts outward at 1 px per segment; the final segment ("club") is
  // the same color as the shaft (subtle thickening would need 2 px,
  // which doesn't fit small species).  This is the distinguishing
  // feature vs moths (feathered antennae).
  const antBaseY = cy - bodyTop;
  ctx.fillStyle = p.shadow;
  for (let s = 1; s <= antLen; s++) {
    const ax = Math.min(s, 2);  // angle tapers — stops at 2 px outward
    const ay = antBaseY - s;
    ctx.fillRect(cx - ax, ay, 1, 1);
    ctx.fillRect(cx + ax, ay, 1, 1);
  }
}

// Firefly — tiny bioluminescent dot with a bright core and soft halo.
// The body is just 1-2 dark pixels; the visual identity comes from
// the GLOW + HALO ring rendered around it.  Designed to read as
// "spark in the air" even at 1×1 scale in ambient/scene use.
//
//   palette = { body, bodyLit, glow, glare, halo }
//     (defaults to FIREFLY_PALETTE)
//   opts.brightness — 0..1 glow intensity (default 0.7).  At 0 only
//                     the body shows (firefly resting); at 1 the
//                     full halo ring is visible (peak pulse).
//   opts.size       — 'small' | 'medium' (default 'small').  Medium
//                     adds an extra halo ring for nearby fireflies.
export function firefly(ctx, cx, cy, palette, opts = {}) {
  const p     = palette || FIREFLY_PALETTE;
  const b     = opts.brightness != null ? opts.brightness : 0.7;
  const size  = opts.size || 'small';

  // Halo ring — translucent bloom (only at moderate brightness +).
  // Drawn first so the bright core paints over it.
  if (b > 0.25) {
    ctx.fillStyle = p.halo;
    // 4-direction cardinal halo (1 px each)
    ctx.fillRect(cx - 1, cy,     1, 1);
    ctx.fillRect(cx + 1, cy,     1, 1);
    ctx.fillRect(cx,     cy - 1, 1, 1);
    ctx.fillRect(cx,     cy + 1, 1, 1);
  }
  if (b > 0.6 || size === 'medium') {
    ctx.fillStyle = p.halo;
    // Diagonal halo extensions (corners) at peak brightness.
    ctx.fillRect(cx - 1, cy - 1, 1, 1);
    ctx.fillRect(cx + 1, cy - 1, 1, 1);
    ctx.fillRect(cx - 1, cy + 1, 1, 1);
    ctx.fillRect(cx + 1, cy + 1, 1, 1);
  }
  if (size === 'medium' && b > 0.7) {
    ctx.fillStyle = p.halo;
    // Outer halo ring for medium fireflies at peak.
    ctx.fillRect(cx - 2, cy,     1, 1);
    ctx.fillRect(cx + 2, cy,     1, 1);
    ctx.fillRect(cx,     cy - 2, 1, 1);
    ctx.fillRect(cx,     cy + 2, 1, 1);
  }

  // Body — 1-2 dark pixels just below the glow (the actual insect).
  ctx.fillStyle = p.body;
  ctx.fillRect(cx, cy + (size === 'medium' ? 1 : 0), 1, 1);
  if (size === 'medium') {
    ctx.fillStyle = p.bodyLit;
    ctx.fillRect(cx, cy + 2, 1, 1);
  }

  // Glow core — bright single pixel at the center.  Always drawn last
  // so it overpaints any halo at the exact center pixel.
  if (b > 0.1) {
    ctx.fillStyle = b > 0.7 ? p.glare : p.glow;
    ctx.fillRect(cx, cy, 1, 1);
  }
}

// Bug / beetle — top-down compact insect with armored shell, head,
// antennae, and visible side legs.  5-stop shading on the carapace
// reads as a 3D oval body.  Optional `walk` phase animates the leg
// positions for a crawling cycle.
//
//   palette = { shadow, halfShadow, neutral, highlight, glare }
//     (defaults to BUG_PALETTE)
//   opts.size  — body length in px (default 5).  Bug ~ size+2 long.
//   opts.walk  — 0..1 leg-cycle phase (default 0).  Legs alternate
//                forward/back as walk advances.
//   opts.facing — direction the bug is heading. 1 = up (head at top),
//                 -1 = down. Default 1.
export function bug(ctx, cx, cy, palette, opts = {}) {
  const p      = palette || BUG_PALETTE;
  const size   = opts.size != null ? opts.size : 5;
  const walk   = opts.walk != null ? opts.walk : 0;
  const facing = opts.facing != null ? opts.facing : 1;
  const half   = Math.floor(size / 2);

  // ── Carapace: vertical oval shaded top-light, side-shadow ────────
  //
  // Rows go from -half (head end) to +half (tail end).  At each row,
  // width tapers: full width at center, narrow at head + tail.
  for (let r = -half; r <= half; r++) {
    const rowFrac = Math.abs(r) / (half + 0.5);
    const rowHalfW = Math.max(0, Math.round((1 - rowFrac * rowFrac) * 2));
    const y = cy + r * facing;

    // Shadow outline edges
    ctx.fillStyle = p.shadow;
    ctx.fillRect(cx - rowHalfW,     y, 1, 1);
    ctx.fillRect(cx + rowHalfW,     y, 1, 1);

    // Interior columns: graduated 5-stop across the row width
    for (let dx = -(rowHalfW - 1); dx <= (rowHalfW - 1); dx++) {
      const cFrac = (dx + rowHalfW - 1) / Math.max(1, (rowHalfW - 1) * 2);
      let col;
      // Top half (head end, -r) is lit; bottom half (tail) is shadowed
      const lengthFrac = (r * facing + half) / (half * 2);
      if (lengthFrac < 0.3) {
        col = (cFrac > 0.4 && cFrac < 0.8) ? p.highlight : p.neutral;
      } else if (lengthFrac < 0.7) {
        col = (cFrac > 0.55) ? p.highlight : (cFrac > 0.25 ? p.neutral : p.halfShadow);
      } else {
        col = (cFrac > 0.5) ? p.neutral : p.halfShadow;
      }
      ctx.fillStyle = col;
      ctx.fillRect(cx + dx, y, 1, 1);
    }
  }

  // Head highlight: a glare pixel just above the carapace (at head end)
  ctx.fillStyle = p.glare;
  ctx.fillRect(cx, cy - half * facing, 1, 1);

  // Center carapace seam (split between elytra) — 1-px shadow stripe
  ctx.fillStyle = p.shadow;
  for (let r = -half + 1; r <= half - 1; r++) {
    ctx.fillRect(cx, cy + r * facing, 1, 1);
  }

  // ── Antennae: 2 thin lines extending from the head ───────────────
  const headY = cy - (half + 1) * facing;
  ctx.fillStyle = p.halfShadow;
  ctx.fillRect(cx - 1, headY,                 1, 1);
  ctx.fillRect(cx + 1, headY,                 1, 1);
  ctx.fillRect(cx - 2, headY - 1 * facing,    1, 1);
  ctx.fillRect(cx + 2, headY - 1 * facing,    1, 1);

  // ── Legs: 3 pairs along the body sides ───────────────────────────
  // walk = 0: all legs forward.  walk = 1: all legs back.
  // Each pair animates with a phase offset for a crawling cycle.
  const legY1 = cy - Math.round(half * 0.6) * facing;
  const legY2 = cy;
  const legY3 = cy + Math.round(half * 0.6) * facing;
  const legOff1 = Math.round(Math.sin(walk * Math.PI * 2)        * 1);
  const legOff2 = Math.round(Math.sin(walk * Math.PI * 2 + 2.1)  * 1);
  const legOff3 = Math.round(Math.sin(walk * Math.PI * 2 + 4.2)  * 1);
  ctx.fillStyle = p.shadow;
  // Pair 1
  ctx.fillRect(cx - 3, legY1 + legOff1 * facing, 1, 1);
  ctx.fillRect(cx + 3, legY1 - legOff1 * facing, 1, 1);
  // Pair 2
  ctx.fillRect(cx - 3, legY2 + legOff2 * facing, 1, 1);
  ctx.fillRect(cx + 3, legY2 - legOff2 * facing, 1, 1);
  // Pair 3
  ctx.fillRect(cx - 3, legY3 + legOff3 * facing, 1, 1);
  ctx.fillRect(cx + 3, legY3 - legOff3 * facing, 1, 1);
}

// Fly — tiny dark insect with subtle wing-blur halo.  Designed as a
// counterpart to `firefly`: same minimal pixel footprint, but DARK
// instead of glowing.  Reads as a moving speck at distance; best
// used in swarms (clusters with chaotic per-fly motion) over carrion,
// food, ambient summer scenes.
//
//   palette = { body, bodyLit, wing, haze }
//     (defaults to FLY_PALETTE)
//   opts.buzz — 0..1 wing-blur intensity (default 0.6).  At 0 the
//               fly reads as a tiny still dot; at 1 the side wings
//               extend further for a "fast buzzing" silhouette.
//   opts.size — 'small' (1-px body) | 'medium' (2-px body, wider blur)
export function fly(ctx, cx, cy, palette, opts = {}) {
  const p    = palette || FLY_PALETTE;
  const buzz = opts.buzz != null ? opts.buzz : 0.6;
  const size = opts.size || 'small';

  // Wing motion-blur — semi-transparent pixels on each side of the
  // body.  Drawn first so the body pixel overpaints any wing halo
  // that overlaps the center.
  if (buzz > 0.25) {
    ctx.fillStyle = p.wing;
    ctx.fillRect(cx - 1, cy, 1, 1);
    ctx.fillRect(cx + 1, cy, 1, 1);
  }
  if (buzz > 0.65) {
    // Wider blur at peak buzz — wings extend further during fast flap.
    ctx.fillStyle = p.wing;
    ctx.fillRect(cx - 2, cy, 1, 1);
    ctx.fillRect(cx + 2, cy, 1, 1);
  }
  if (size === 'medium' && buzz > 0.4) {
    // Vertical wing-blur smear for medium-sized flies (closer to viewer)
    ctx.fillStyle = p.wing;
    ctx.fillRect(cx - 1, cy - 1, 1, 1);
    ctx.fillRect(cx + 1, cy - 1, 1, 1);
  }

  // Body — 1 or 2 dark pixels.
  ctx.fillStyle = p.body;
  ctx.fillRect(cx, cy, 1, 1);
  if (size === 'medium') {
    ctx.fillStyle = p.bodyLit;
    ctx.fillRect(cx, cy - 1, 1, 1);
  }
}

// Solid base — single fillRect. Useful as the underlay for any other
// tile primitive.
export function tileBase(ctx, x, y, size, color) {
  ctx.fillStyle = color;
  ctx.fillRect(x, y, size, size);
}

// Checkerboard tile — alternating 2-stop fill on a `cell`-sized grid.
// Reads as deck plate without seams.
//
//   palette = { body, alt }
//   opts.cell — checker cell size in px (default 4)
export function tileChecker(ctx, x, y, size, palette, opts = {}) {
  const cell = opts.cell != null ? opts.cell : 4;
  ctx.fillStyle = palette.body;
  ctx.fillRect(x, y, size, size);
  ctx.fillStyle = palette.alt;
  for (let dy = 0; dy < size; dy++) {
    for (let dx = 0; dx < size; dx++) {
      if (((Math.floor(dx / cell) + Math.floor(dy / cell)) & 1) === 1) {
        ctx.fillRect(x + dx, y + dy, 1, 1);
      }
    }
  }
}

// Speckle tile — solid base + deterministic accent-pixel scatter.
//
//   palette = { body, accent }
//   opts.density — 0..1 fraction (default 0.07)
//   opts.seed    — integer (default 0)
export function tileSpeckle(ctx, x, y, size, palette, opts = {}) {
  const density = opts.density != null ? opts.density : 0.07;
  const seed = opts.seed != null ? opts.seed : 0;
  ctx.fillStyle = palette.body;
  ctx.fillRect(x, y, size, size);
  ctx.fillStyle = palette.accent;
  for (let dy = 0; dy < size; dy++) {
    for (let dx = 0; dx < size; dx++) {
      const h = _tileHash(seed, dx, dy);
      if ((h & 0xffff) / 0xffff < density) {
        ctx.fillRect(x + dx, y + dy, 1, 1);
      }
    }
  }
}
// tileGrass — chunky textured green tile with multi-feature detail.
// Layers:
//   1. Base body fill.
//   2. Dense per-pixel noise (~30% dark, ~25% light) for grain.
//   3. Grass blade clusters — 2-3 short vertical 3-pixel strips with
//      dark bottom + body mid + bright tip, scattered as recognizable
//      "tufts" peeking up.
//   4. + shaped sun glints — bright cross sparkles for the "sun
//      catching dew" effect (mirrors tileSand's glint pattern).
//   palette: { body, shadow, hilite, spark? }
export function tileGrass(ctx, x, y, size, palette, opts = {}) {
  const seed  = opts.seed != null ? opts.seed : 0;
  const body  = palette.body   || '#3a8030';
  const dark  = palette.shadow || '#1a4810';
  const light = palette.hilite || '#80c040';
  const spark = palette.spark  || palette.tuft || '#a0e060';
  ctx.fillStyle = body;
  ctx.fillRect(x, y, size, size);
  // Dense per-pixel noise.
  for (let dy = 0; dy < size; dy++) {
    for (let dx = 0; dx < size; dx++) {
      const h = _tileHash(seed + 1, x + dx, y + dy);
      const r = h % 100;
      if (r < 30) { ctx.fillStyle = dark;  ctx.fillRect(x + dx, y + dy, 1, 1); }
      else if (r < 55) { ctx.fillStyle = light; ctx.fillRect(x + dx, y + dy, 1, 1); }
    }
  }
  // Grass blade clusters — 3 distinct tufts, each a 3px vertical
  // shaded blade. Reads as individual blades, not just noise.
  for (let i = 0; i < 3; i++) {
    const h = _tileHash(seed + 7919, i, 0);
    const bx = (h & 0xff) % size;
    const by = ((h >>> 8) & 0xff) % Math.max(1, size - 3);
    // Dark base.
    ctx.fillStyle = dark;
    ctx.fillRect(x + bx, y + by + 2, 1, 1);
    // Body middle.
    ctx.fillStyle = body;
    ctx.fillRect(x + bx, y + by + 1, 1, 1);
    // Bright tip.
    ctx.fillStyle = spark;
    ctx.fillRect(x + bx, y + by, 1, 1);
    // Adjacent shorter blade for the cluster feel.
    if ((h >>> 16) & 1) {
      const offX = (h >>> 17) & 1 ? 1 : -1;
      const ax = ((bx + offX) % size + size) % size;
      ctx.fillStyle = light;
      ctx.fillRect(x + ax, y + by + 1, 1, 1);
      ctx.fillStyle = spark;
      ctx.fillRect(x + ax, y + by, 1, 1);
    }
  }
  // + shaped dew sparkles — same pattern as tileSand's sun glints.
  for (let i = 0; i < 2; i++) {
    const h = _tileHash(seed + 5555, i, 0);
    if ((h >>> 16) & 3) continue;     // 1 in 4 tiles get a sparkle
    const sx = x + 2 + (h % Math.max(1, size - 4));
    const sy = y + 2 + ((h >>> 8) % Math.max(1, size - 4));
    ctx.fillStyle = spark;
    ctx.fillRect(sx, sy, 1, 1);
    ctx.fillRect(sx - 1, sy, 1, 1);
    ctx.fillRect(sx + 1, sy, 1, 1);
    ctx.fillRect(sx, sy - 1, 1, 1);
    ctx.fillRect(sx, sy + 1, 1, 1);
  }
}

// tileDirt — chunky pebbly earth with multi-feature detail.
// Layers:
//   1. Base body fill.
//   2. Dense per-pixel noise (~25% dark, ~20% light) for granularity.
//   3. Embedded pebbles — 3-4 small 2×1 stones with shadow + bright
//      top edge, scattered position-hashed.
//   4. Damp soil patches — small clustered dark dots, like wet spots.
//   5. + shaped highlight sparkles — bright cross marks where pebbles
//      catch the light, same pattern as tileSand's sun glints.
//   palette: { body, shadow, hilite, pebble? }
export function tileDirt(ctx, x, y, size, palette, opts = {}) {
  const seed   = opts.seed   != null ? opts.seed   : 0;
  const body   = palette.body   || '#6a3818';
  const dark   = palette.shadow || '#3a1808';
  const light  = palette.hilite || '#a06030';
  const pebble = palette.pebble || palette.spark || '#8a6040';
  ctx.fillStyle = body;
  ctx.fillRect(x, y, size, size);
  // Dense granular noise — position-hashed.
  for (let dy = 0; dy < size; dy++) {
    for (let dx = 0; dx < size; dx++) {
      const h = _tileHash(seed + 7, x + dx, y + dy);
      const r = h % 100;
      if (r < 25) { ctx.fillStyle = dark;  ctx.fillRect(x + dx, y + dy, 1, 1); }
      else if (r < 45) { ctx.fillStyle = light; ctx.fillRect(x + dx, y + dy, 1, 1); }
    }
  }
  // Embedded pebbles — 2×1 stones with shadow + bright top edge.
  const pebbleCount = 3 + (seed & 1);
  for (let i = 0; i < pebbleCount; i++) {
    const h = _tileHash(seed + 197, i, 0);
    const px = (h & 0xff) % Math.max(1, size - 2);
    const py = ((h >>> 8) & 0xff) % Math.max(1, size - 2);
    ctx.fillStyle = dark;
    ctx.fillRect(x + px, y + py + 1, 2, 1);
    ctx.fillStyle = pebble;
    ctx.fillRect(x + px, y + py, 2, 1);
    ctx.fillStyle = light;
    ctx.fillRect(x + px, y + py, 1, 1);
  }
  // Damp patches — 1-2 small 2-pixel clusters of extra-dark soil.
  for (let i = 0; i < 2; i++) {
    const h = _tileHash(seed + 1789, i, 0);
    if ((h >>> 16) & 1) continue;
    const px = 1 + (h & 0xff) % Math.max(1, size - 3);
    const py = 1 + ((h >>> 8) & 0xff) % Math.max(1, size - 3);
    ctx.fillStyle = dark;
    ctx.fillRect(x + px, y + py, 1, 1);
    ctx.fillRect(x + px + 1, y + py, 1, 1);
    if ((h >>> 17) & 1) ctx.fillRect(x + px, y + py + 1, 1, 1);
  }
  // + shaped highlight sparkles — pebbles catching light. Same pattern
  // as tileSand. ~25% of tiles get one for variety without uniformity.
  for (let i = 0; i < 2; i++) {
    const h = _tileHash(seed + 3333, i, 0);
    if ((h >>> 16) & 3) continue;
    const sx = x + 2 + (h % Math.max(1, size - 4));
    const sy = y + 2 + ((h >>> 8) % Math.max(1, size - 4));
    ctx.fillStyle = light;
    ctx.fillRect(sx, sy, 1, 1);
    ctx.fillRect(sx - 1, sy, 1, 1);
    ctx.fillRect(sx + 1, sy, 1, 1);
    ctx.fillRect(sx, sy - 1, 1, 1);
    ctx.fillRect(sx, sy + 1, 1, 1);
  }
}

export function tileSand(ctx, x, y, size, palette, opts = {}) {
  const seed  = opts.seed  != null ? opts.seed  : 0;
  const body  = palette.body   || '#e0b070';
  const dark  = palette.shadow || '#9a7038';
  const light = palette.hilite;
  const spark = palette.spark  || light || '#f0d898';
  // Base fill.
  ctx.fillStyle = body;
  ctx.fillRect(x, y, size, size);
  // Clustered dune shadows — short horizontal dark strips.
  for (let i = 0; i < 3; i++) {
    const h = _tileHash(seed + 211, i, 0);
    const ry = y + 3 + ((h >>> 8) % Math.max(1, size - 6));
    const rx = x + (h % Math.max(1, size - 7));
    const len = 3 + ((h >>> 16) & 3);
    ctx.fillStyle = dark;
    for (let s = 0; s < len; s++) {
      const wy = ry + (((s + i) & 2) ? 0 : 1);
      if (wy < y + size) ctx.fillRect(rx + s, wy, 1, 1);
    }
  }
  // + shaped sun glints.
  if (spark) {
    for (let i = 0; i < 2; i++) {
      const h = _tileHash(seed + 733, i, 0);
      const sx = x + 2 + (h % Math.max(1, size - 4));
      const sy = y + 2 + ((h >>> 8) % Math.max(1, size - 4));
      ctx.fillStyle = spark;
      ctx.fillRect(sx, sy, 1, 1);
      ctx.fillRect(sx - 1, sy, 1, 1);
      ctx.fillRect(sx + 1, sy, 1, 1);
      ctx.fillRect(sx, sy - 1, 1, 1);
      ctx.fillRect(sx, sy + 1, 1, 1);
    }
  }
}

export function tileSnow(ctx, x, y, size, palette, opts = {}) {
  const seed  = opts.seed  != null ? opts.seed  : 0;
  const body  = palette.body   || '#e8eef8';
  const dark  = palette.shadow || '#a0b0c8';
  const spark = palette.spark  || palette.hilite || '#ffffff';
  // Pristine base.
  ctx.fillStyle = body;
  ctx.fillRect(x, y, size, size);
  // Clustered shadow drifts — 2-3px blue-white clusters.
  for (let i = 0; i < 3; i++) {
    const h = _tileHash(seed + 1, i, 0);
    const px = x + 2 + (h % Math.max(1, size - 5));
    const py = y + 2 + ((h >>> 8) % Math.max(1, size - 4));
    ctx.fillStyle = dark;
    ctx.fillRect(px, py, 2, 1);
    if ((h >>> 16) & 1) ctx.fillRect(px + 1, py + 1, 1, 1);
  }
  // + shaped sparkles — bright white.
  for (let i = 0; i < 2; i++) {
    const h = _tileHash(seed + 89, i, 0);
    const sx = x + 2 + (h % Math.max(1, size - 4));
    const sy = y + 2 + ((h >>> 8) % Math.max(1, size - 4));
    ctx.fillStyle = spark;
    ctx.fillRect(sx, sy, 1, 1);
    ctx.fillRect(sx - 1, sy, 1, 1);
    ctx.fillRect(sx + 1, sy, 1, 1);
    ctx.fillRect(sx, sy - 1, 1, 1);
    ctx.fillRect(sx, sy + 1, 1, 1);
  }
}

// tileWater — JRPG-style top-down water with horizontal wave bands,
// scattered depth specks, and hot sparkle pixels. Replaces the earlier
// caustic-blob approach (which jittered too aggressively and produced
// messy clumps). Wave bands use a sine of WORLD x-position so adjacent
// tiles continue seamlessly — no modulo-wrap artifacts.
//
// Visual breakdown:
//   1. Mid-blue body fill.
//   2. Lighter horizontal wavy bands (2-3 across the tile), 1px tall,
//      with ~25% random pixel breaks for foamy/broken edges. Sine wave
//      input is `(x + dx) * frequency` — phase continues across tiles.
//   3. Dark "depth" specks — 4-6 single dark pixels scattered, half
//      with a horizontal partner pixel for 2-pixel depth clusters.
//   4. 1-2 hot white sparkle pixels for the surface-glint catch.
//
//   palette: { body, shadow|deep, hilite, spark? }
//   opts:    { seed, bands=3, freq=0.5 }
export function tileWater(ctx, x, y, size, palette, opts = {}) {
  const seed = opts.seed != null ? opts.seed : 0;
  const body  = palette.body   || '#5098d0';
  const dark  = palette.shadow || palette.deep || '#3070c0';
  const light = palette.hilite || '#a0d8e8';
  const foam  = palette.spark  || '#ffffff';
  const bands = opts.bands != null ? opts.bands : 3;
  const freq  = opts.freq  != null ? opts.freq  : 0.5;
  // 1. Base fill.
  ctx.fillStyle = body;
  ctx.fillRect(x, y, size, size);
  // 2. Wave bands — horizontal lines that wobble via sine of world-x.
  //    Each band has its own y baseline + phase offset; pixel breaks
  //    happen via a per-pixel hash check (~25% skipped).
  ctx.fillStyle = light;
  for (let b = 0; b < bands; b++) {
    const bh = _tileHash(seed + b * 313, 0, 0);
    const baseY = Math.floor((b + 0.5) * size / bands);
    const phase = ((bh & 0xff) / 0xff) * Math.PI * 2;
    const amp = 1;
    for (let dx = 0; dx < size; dx++) {
      // Sine input is world-x — continuous across tile boundaries.
      const wave = Math.sin((x + dx) * freq + phase) * amp;
      const wy = Math.round(baseY + wave);
      if (wy < 0 || wy >= size) continue;
      // Dither: skip ~25% for natural breaks.
      if ((_tileHash(seed + b * 41, x + dx, 0) & 7) < 2) continue;
      ctx.fillRect(x + dx, y + wy, 1, 1);
    }
  }
  // 3. Depth specks — scattered dark dots, sometimes paired.
  ctx.fillStyle = dark;
  const speckCount = 4 + (seed & 1);
  for (let i = 0; i < speckCount; i++) {
    const h = _tileHash(seed + 1117, i, 0);
    const px = (h & 0xff) % size;
    const py = ((h >>> 8) & 0xff) % size;
    ctx.fillRect(x + px, y + py, 1, 1);
    // 50% chance of 2-pixel cluster for natural irregularity.
    if ((h >>> 16) & 1) {
      const offX = (h >>> 17) & 1 ? 1 : -1;
      const px2 = ((px + offX) % size + size) % size;
      ctx.fillRect(x + px2, y + py, 1, 1);
    }
  }
  // 4. Sparkle pixels — 1-2 bright white dots for the surface glint.
  ctx.fillStyle = foam;
  for (let i = 0; i < 2; i++) {
    const h = _tileHash(seed + 7331, i, 0);
    if ((h >>> 16) & 1) continue;     // ~50% of tiles get no sparkle
    const sx = (h & 0xff) % size;
    const sy = ((h >>> 8) & 0xff) % size;
    ctx.fillRect(x + sx, y + sy, 1, 1);
  }
}

export function tileStone(ctx, x, y, size, palette, opts = {}) {
  const seed   = opts.seed   != null ? opts.seed   : 0;
  const mortar = palette.mortar || palette.shadow || '#3a3a40';
  const body   = palette.body   || '#6a6a78';
  const light  = palette.hilite || '#a0a0b0';
  const dark   = palette.shadow || '#4a4a58';
  // Mortar fill.
  ctx.fillStyle = mortar;
  ctx.fillRect(x, y, size, size);
  // Cobble clusters — 2×2 grid of stones with bevel.
  const cols = size >= 20 ? 3 : 2;
  const rows = 2;
  const cw = Math.floor((size - 3) / cols);
  const rh = Math.floor((size - 3) / rows);
  for (let cy = 0; cy < rows; cy++) {
    for (let cx = 0; cx < cols; cx++) {
      const h = _tileHash(seed + cx * 7 + cy * 13, 0, 0);
      const sx = x + 1 + cx * (cw + 1) + ((h & 1) ? 0 : 0);
      const sy = y + 1 + cy * (rh + 1) + (((h >>> 1) & 1) ? 0 : 0);
      const sw = Math.max(3, cw - 1 + ((h >>> 2) & 1));
      const sh = Math.max(3, rh - 1 + ((h >>> 3) & 1));
      if (sx + sw > x + size || sy + sh > y + size) continue;
      // Stone body.
      ctx.fillStyle = body;
      ctx.fillRect(sx, sy, sw, sh);
      // Interior surface noise — chunky pebbly speckle so each cobble
      // doesn't read as flat gray. Per-stone seed + per-pixel hash.
      for (let py = 1; py < sh - 1; py++) {
        for (let px = 1; px < sw - 1; px++) {
          const ph = _tileHash(h + 511, px, py);
          const r = ph % 100;
          if (r < 20) { ctx.fillStyle = dark;  ctx.fillRect(sx + px, sy + py, 1, 1); }
          else if (r < 35) { ctx.fillStyle = light; ctx.fillRect(sx + px, sy + py, 1, 1); }
        }
      }
      // Top + left highlight (raised cobble face).
      ctx.fillStyle = light;
      ctx.fillRect(sx, sy, sw - 1, 1);
      ctx.fillRect(sx, sy, 1, sh - 1);
      // Bottom + right shadow.
      ctx.fillStyle = dark;
      ctx.fillRect(sx, sy + sh - 1, sw, 1);
      ctx.fillRect(sx + sw - 1, sy, 1, sh);
      // Crack — thin dark line from a random edge inward, for damaged
      // stone look. ~25% of stones get one.
      if ((h >>> 5) & 3 === 0 && sw >= 5 && sh >= 4) {
        ctx.fillStyle = dark;
        const startEdge = (h >>> 7) & 3;
        let crX, crY, dirX, dirY;
        if      (startEdge === 0) { crX = sx + 1 + ((h >>> 9) & 3); crY = sy + 1; dirX = 0; dirY = 1; }
        else if (startEdge === 1) { crX = sx + sw - 2; crY = sy + 1 + ((h >>> 9) & 3); dirX = -1; dirY = 0; }
        else if (startEdge === 2) { crX = sx + 1 + ((h >>> 9) & 3); crY = sy + sh - 2; dirX = 0; dirY = -1; }
        else                       { crX = sx + 1; crY = sy + 1 + ((h >>> 9) & 3); dirX = 1; dirY = 0; }
        const crLen = 2 + ((h >>> 11) & 2);
        for (let s = 0; s < crLen; s++) {
          if (crX > sx && crX < sx + sw - 1 && crY > sy && crY < sy + sh - 1) {
            ctx.fillRect(crX, crY, 1, 1);
          }
          crX += dirX; crY += dirY;
        }
      }
    }
  }
}

// ─── 4d. Faceted rocks ────────────────────────────────────────────
// `rockChunk` / `rockPile` / `boulder` / `craggyWall` — stylized
// low-poly 3D rocks. The visual style is FACETED: irregular polygonal
// silhouette, flat-shaded faces (LIT top + BODY mid + SHADOW base)
// split by a jagged crease line, dark outline, sharp glint pixel on
// the top edge. Optional cast shadow under the base. This is the
// "stylized boulder" look from production 2D games (Dreamstime/
// vector-rock packs + the dark pixel-art rocks in the reference).

// `rockChunk` — single FREE-STANDING rock anchored at (cx, cy) CENTER.
// Built from the same 3-ellipse cascade pattern as `bush` (which is
// the canonical "organic chunky form" technique in this library):
//   1. SHADOW ellipse — widest, sits low → reads as the silhouette
//      outline + base shadow band
//   2. BODY ellipse — slightly smaller, asymmetric x-offset → mid tone
//   3. HILITE ellipse — smallest, sits up + offset → lit top face
// 1px ACCENT PIXELS around the silhouette break the perfect-ellipse
// look (top half = darker body specks suggesting bumps, bottom half
// = shadow specks suggesting pits). Sharp 1-2px glint pixel on the
// hilite ellipse for the catchlight. Optional cast shadow + pebbles
// + moss.
//   palette: { shadow, body, hilite, glint?, cast?, moss? }
//   opts:    { seed, size=6, aspect=1.0, cast=true, pebbles=false,
//              moss=false, glints=1, lumps=true }
export function rockChunk(ctx, cx, cy, palette, opts = {}) {
  const seed   = opts.seed != null ? opts.seed : 0;
  const size   = Math.max(3, opts.size != null ? opts.size : 6);
  const aspect = opts.aspect != null ? opts.aspect : 1.0;
  const doCast    = opts.cast    !== false;
  const doPebbles = opts.pebbles || false;
  const doMoss    = opts.moss    || false;
  const doLumps   = opts.lumps   !== false;
  const glints    = opts.glints != null ? opts.glints : 1;

  const shadow = palette.shadow || '#1a1c22';
  const body   = palette.body   || '#3a3c44';
  const hilite = palette.hilite || '#86899a';
  const glint  = palette.glint  || palette.hilite || '#b0b4c0';
  const castC  = palette.cast   || 'rgba(0,0,0,0.40)';
  const mossC  = palette.moss   || '#3a5a28';

  cx = Math.round(cx);
  cy = Math.round(cy);

  // Asymmetric offsets so the three ellipses don't read as concentric.
  // o1 jitters the BODY ellipse left/right; o2 jitters the HILITE.
  const o1 = ((_tileHash(seed, 1, 0) & 1) ? -1 : 1);
  const o2 = ((_tileHash(seed, 2, 0) & 1) ? -1 : 1);

  // Slight horizontal squash by default — rocks tend to be wider than
  // tall. `aspect` opt overrides for taller boulders / flatter slabs.
  const rx = size;
  const ry = Math.max(2, Math.round(size * aspect * 0.85));

  // 0. Cast shadow under the rock — drawn FIRST so the rock paints on top.
  if (doCast) {
    ctx.fillStyle = castC;
    const sR = Math.max(2, Math.round(rx * 1.05));
    const sH = Math.max(1, Math.round(rx * 0.20));
    for (let dx = -sR; dx <= sR; dx++) {
      const t = 1 - (dx * dx) / (sR * sR);
      if (t <= 0) continue;
      const hh = Math.max(1, Math.round(sH * Math.sqrt(t)));
      ctx.fillRect(cx + dx, cy + ry + 1, 1, hh);
    }
  }

  // 1. SHADOW ellipse — widest, sits +1px low. Doubles as the dark
  //    silhouette outline (since later ellipses are smaller and don't
  //    cover its edge pixels).
  pxEllipse(ctx, cx, cy + 1, rx, ry, shadow);

  // 2. BODY ellipse — slightly smaller, asymmetric x-offset for chunky
  //    silhouette. Covers most of the shadow except the bottom rim +
  //    the offset side, which stays as the base shadow band.
  pxEllipse(ctx, cx + o1, cy, Math.max(1, rx - 1),
            Math.max(1, ry - 1), body);

  // 3. HILITE ellipse — smallest, sits up + offset. Top-left lit face.
  pxEllipse(ctx, cx + o2 - 1, cy - Math.max(1, Math.round(ry * 0.35)),
            Math.max(1, rx - 2), Math.max(1, ry - 3), hilite);

  // 4. Lump accents — 1px protrusions around the silhouette. Top half
  //    in body color (small bumps), bottom half in shadow color (pits/
  //    weathering). 6 candidate positions, ~50% skipped per seed for
  //    a natural sparse look.
  if (doLumps) {
    const lumps = 6;
    for (let i = 0; i < lumps; i++) {
      const h = _tileHash(seed + 7331, i, 0);
      if ((h >>> 8) & 1) continue;
      const a = (h & 0xff) / 0xff * Math.PI * 2;
      const lx = cx + Math.round(Math.cos(a) * (rx + 1));
      const ly = cy + Math.round(Math.sin(a) * (ry + 0));
      ctx.fillStyle = a < Math.PI ? body : shadow;
      ctx.fillRect(lx, ly, 1, 1);
    }
  }

  // 5. Sharp glint pixels on the brightest part of the hilite ellipse.
  if (glints > 0 && size >= 4 && !opts.snow) {
    ctx.fillStyle = glint;
    const ghx = cx + o2 - 1;
    const ghy = cy - Math.max(1, Math.round(ry * 0.35))
                   - Math.max(0, Math.round(ry * 0.5) - 1);
    ctx.fillRect(ghx, ghy + 1, 1, 1);
    if (glints >= 2) ctx.fillRect(ghx + 1, ghy + 2, 1, 1);
  }

  // 5b. Snow cap — small 2-tone ellipse integrated into the hilite zone.
  //     NOT a floating disc — the snow follows the rock silhouette and
  //     sits on the upper-left lit face. Two ellipses: a darker shade
  //     ring + a bright core, mimicking the natural snow look on the
  //     reference rocks.
  if (opts.snow && size >= 4) {
    const snowCol  = palette.snow      || '#eef0f5';
    const snowShCol = palette.snowShade || '#a8acb8';
    const hCx = cx + o2 - 1;
    const hCy = cy - Math.max(1, Math.round(ry * 0.35));
    const hRy = Math.max(1, ry - 3);
    // Snow ellipse sits at the top of the hilite ellipse.
    const sCx = hCx;
    const sCy = hCy - Math.max(1, Math.round(hRy * 0.4));
    const sRx = Math.max(1, Math.round((rx - 2) * 0.55));
    const sRy = Math.max(1, Math.round(hRy * 0.5));
    pxEllipse(ctx, sCx, sCy + 1, sRx, sRy, snowShCol);
    pxEllipse(ctx, sCx, sCy, Math.max(1, sRx - 1), Math.max(1, sRy - 1), snowCol);
    // Crystal glint
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(sCx - 1, sCy - Math.max(0, sRy - 2), 1, 1);
  }

  // 6. Moss tufts — small green specks on the lower (shadow) zone.
  if (doMoss) {
    const mCount = 1 + (_tileHash(seed, 0, 31) % 2);
    ctx.fillStyle = mossC;
    for (let m = 0; m < mCount; m++) {
      const mh = _tileHash(seed, m, 41);
      const mxF = (((mh % 200) - 100) / 100) * 0.6;
      const mx = cx + Math.round(mxF * rx);
      const myF = 0.4 + ((mh >>> 7) % 40) / 100;
      const my = cy + Math.round(myF * ry);
      ctx.fillRect(mx, my, 2, 1);
      ctx.fillRect(mx, my + 1, 1, 1);
    }
  }

  // 7. Small pebbles around the base.
  if (doPebbles) {
    const pC = 2 + (_tileHash(seed, 0, 51) % 3);
    for (let p = 0; p < pC; p++) {
      const ph = _tileHash(seed, p, 67);
      const side = (ph & 1) ? 1 : -1;
      const px = cx + side * (rx + 1 + ((ph >>> 1) % 3));
      const py = cy + ry + 1 + ((ph >>> 4) % 2);
      ctx.fillStyle = body;   ctx.fillRect(px - 1, py, 2, 1);
      ctx.fillStyle = hilite; ctx.fillRect(px - 1, py, 1, 1);
      ctx.fillStyle = shadow; ctx.fillRect(px - 1, py + 1, 2, 1);
    }
  }
}

// `rockPeak` — tall TAPERED mountain peak built from a stack of
// progressively-smaller rockChunks. Anchor (baseX, baseY) is the
// BOTTOM-CENTER (the ground line). Wider at the base, narrows to a
// near-point at the tip. Optional snow on the topmost chunk (uses
// rockChunk's `snow` opt for an integrated cap, NOT a floating disc).
// Use for single mountain peaks, spires, towering crags.
//   palette: { shadow, body, hilite, glint?, cast?, snow?, snowShade? }
//   opts:    { seed, width=24, height=36, layers=auto, snow=false,
//              cast=true, grass=false }
export function rockPeak(ctx, baseX, baseY, palette, opts = {}) {
  const seed   = opts.seed   != null ? opts.seed   : 0;
  const width  = opts.width  != null ? opts.width  : 24;
  const height = opts.height != null ? opts.height : 36;
  const doSnow = opts.snow   || false;
  const doGrass = opts.grass || false;
  const doCast  = opts.cast  !== false;
  const layers = opts.layers != null
                 ? opts.layers
                 : Math.max(3, Math.round(height / 7));

  baseX = Math.round(baseX);
  baseY = Math.round(baseY);

  // 1. Cast shadow at the base — single oval for the whole peak.
  if (doCast) {
    ctx.fillStyle = palette.cast || 'rgba(0,0,0,0.40)';
    const sW = Math.max(2, Math.round(width * 0.45));
    const sH = Math.max(1, Math.round(width * 0.08));
    for (let dx = -sW; dx <= sW; dx++) {
      const t = 1 - (dx * dx) / (sW * sW);
      if (t <= 0) continue;
      const hh = Math.max(1, Math.round(sH * Math.sqrt(t)));
      ctx.fillRect(baseX + dx, baseY + 1, 1, hh);
    }
  }

  // 2. Stack rockChunks from base to tip, progressively smaller.
  //    Each chunk's size tapers from ~width/2 down to ~2 (the tip).
  for (let i = 0; i < layers; i++) {
    const t = i / Math.max(1, layers - 1);             // 0=base, 1=tip
    const sz = Math.max(2, Math.round((width * 0.5) * (1 - t * 0.82)));
    const yPos = baseY - Math.round(height * t);
    // X jitter — base layer stays centered; upper layers drift slightly
    // for organic stacking. Bias the tip toward one side per seed.
    const tipBias = ((_tileHash(seed, 0, 0) & 1) ? -1 : 1);
    const xOff = i === 0
                 ? 0
                 : (((_tileHash(seed, i, 0) & 3) - 1) + (i === layers - 1 ? tipBias : 0));
    const isPeak = i === layers - 1;
    rockChunk(ctx, baseX + xOff, yPos, palette, {
      seed:    seed + i * 17,
      size:    sz,
      aspect:  1.0,
      cast:    false,                  // single base shadow already drawn
      lumps:   i > 0,                  // base layer no lumps (cleaner ground line)
      glints:  isPeak ? 2 : (i % 2 === 0 ? 1 : 0),
      snow:    isPeak && doSnow,
    });
  }

  // 3. Grass tufts at the base (optional) — small dark blades poking out
  //    from either side. Same look as the bush grass tuft accent.
  if (doGrass) {
    const grassCol = palette.grass || '#3a5a28';
    ctx.fillStyle = grassCol;
    const halfBase = Math.round(width * 0.4);
    for (let i = -2; i <= 2; i++) {
      const h = _tileHash(seed, i + 5, 71);
      if ((h & 3) === 0) continue;
      const gx = baseX + i * Math.max(2, Math.round(halfBase / 3));
      const gy = baseY + ((h >>> 4) & 1);
      ctx.fillRect(gx, gy - 1, 1, 1);
      ctx.fillRect(gx, gy, 1, 1);
      if ((h >>> 8) & 1) ctx.fillRect(gx - 1, gy, 1, 1);
    }
  }
}

// `rockMountain` — large composed mountain FORMATION (~96×96 default).
// Anchor (cx, baseY) is the BOTTOM-CENTER. Composes 3-5 rockPeaks at
// varying heights + positions. Background peaks are drawn first so
// foreground peaks occlude them. Tallest peak typically gets the snow
// cap. ONE cast shadow under the whole formation. Use for big scenic
// mountain ranges, distant peaks, mountainous backdrops.
//   palette: { shadow, body, hilite, glint?, cast?, snow?, snowShade? }
//   opts:    { seed, width=96, height=64, peaks=3, snow=true, cast=true,
//              grass=false }
export function rockMountain(ctx, cx, baseY, palette, opts = {}) {
  const seed   = opts.seed   != null ? opts.seed   : 0;
  const width  = opts.width  != null ? opts.width  : 96;
  const height = opts.height != null ? opts.height : 64;
  const peakCount = opts.peaks != null ? opts.peaks : 3;
  const doSnow = opts.snow !== false;
  const doCast = opts.cast !== false;
  const doGrass = opts.grass || false;

  cx = Math.round(cx);
  baseY = Math.round(baseY);

  // 1. Cast shadow under the whole formation — wide low oval.
  if (doCast) {
    ctx.fillStyle = palette.cast || 'rgba(0,0,0,0.45)';
    const sW = Math.max(2, Math.round(width * 0.42));
    const sH = Math.max(2, Math.round(width * 0.05));
    for (let dx = -sW; dx <= sW; dx++) {
      const t = 1 - (dx * dx) / (sW * sW);
      if (t <= 0) continue;
      const hh = Math.max(1, Math.round(sH * Math.sqrt(t)));
      ctx.fillRect(cx + dx, baseY + 1, 1, hh);
    }
  }

  // 2. Plan peaks — varied positions/heights across the width. The
  //    TALLEST peak gets the snow cap (if snow opt is set). Each peak
  //    gets a slight y-offset for parallax depth between adjacent peaks.
  const peaks = [];
  for (let i = 0; i < peakCount; i++) {
    const t = (i + 0.5) / peakCount;
    const peakXSpread = (t - 0.5) * width * 0.75;
    const peakXJitter = ((_tileHash(seed, i, 11) & 3) - 1) * 2;
    const peakX = cx + Math.round(peakXSpread + peakXJitter);
    // Height variation 60-100% of mountain height
    const peakH = Math.round(height *
                  (0.6 + ((_tileHash(seed, i, 13) % 100) / 100) * 0.4));
    // Width per peak — slim spires to chunky outcrops
    const peakW = Math.round(width * 0.22
                  + ((_tileHash(seed, i, 17) % 100) / 100) * width * 0.12);
    // Background peaks set slightly back (slightly higher y in scene =
    // lower on the bake; we offset BACK by subtracting from baseY).
    const yShift = ((_tileHash(seed, i, 19) % 5));
    peaks.push({
      cx: peakX,
      baseY: baseY - yShift,
      width: peakW,
      height: peakH,
      seed: seed + i * 31,
    });
  }
  // Tallest peak gets snow.
  let tallestIdx = 0;
  for (let i = 1; i < peaks.length; i++) {
    if (peaks[i].height > peaks[tallestIdx].height) tallestIdx = i;
  }
  peaks[tallestIdx].snow = doSnow;
  // Second-tallest also gets snow if mountain is wide enough.
  if (peakCount >= 3 && doSnow) {
    let secondIdx = -1;
    for (let i = 0; i < peaks.length; i++) {
      if (i === tallestIdx) continue;
      if (secondIdx === -1 || peaks[i].height > peaks[secondIdx].height) secondIdx = i;
    }
    if (secondIdx >= 0 && peaks[secondIdx].height >= height * 0.75) {
      peaks[secondIdx].snow = true;
    }
  }

  // 3. Sort peaks by BASE-Y ascending so back peaks draw first, front
  //    peaks last (proper depth ordering).
  peaks.sort((a, b) => a.baseY - b.baseY);

  for (const p of peaks) {
    rockPeak(ctx, p.cx, p.baseY, palette, {
      seed:   p.seed,
      width:  p.width,
      height: p.height,
      cast:   false,
      snow:   !!p.snow,
      grass:  doGrass && p.baseY === baseY,    // grass only on frontmost
    });
  }
}

// `rockPile` — heap of 3-6 overlapping rockChunks. Bigger rocks at
// the base/back, smaller in front. Anchor (cx, baseY) is the BOTTOM-
// CENTER of the pile (the ground line). Use for boulder piles, debris
// fields, mountain bases.
//   palette + opts: same as rockChunk, plus:
//   opts:    { count=4, width=20, pebbles=true }
export function rockPile(ctx, cx, baseY, palette, opts = {}) {
  const seed   = opts.seed   != null ? opts.seed   : 0;
  const count  = opts.count  != null ? opts.count  : 4;
  const width  = opts.width  != null ? opts.width  : 20;
  const baseSize = opts.size != null ? opts.size : 7;
  cx = Math.round(cx);
  baseY = Math.round(baseY);

  // ONE big cast shadow for the whole pile (drawn first).
  if (opts.cast !== false) {
    ctx.fillStyle = palette.cast || 'rgba(0,0,0,0.40)';
    const sW = Math.round(width * 0.55);
    const sH = 2;
    for (let dx = -sW; dx <= sW; dx++) {
      const t = 1 - (dx * dx) / (sW * sW);
      if (t <= 0) continue;
      const hh = Math.max(1, Math.round(sH * Math.sqrt(t)));
      ctx.fillRect(cx + dx, baseY + 1, 1, hh);
    }
  }

  // Build list of chunks: bigger at back/base, smaller toward front/top.
  const chunks = [];
  for (let i = 0; i < count; i++) {
    const h = _tileHash(seed, i, 1);
    const t = i / Math.max(1, count - 1);
    const xSpread = (((h % 200) - 100) / 100) * (width * 0.42);
    const sz = Math.max(2, baseSize - i + ((h >>> 7) % 3) - 1);
    const yOff = -Math.round(i * sz * 0.6) - ((h >>> 11) % 2);
    chunks.push({
      cx: cx + Math.round(xSpread),
      cy: baseY - Math.round(sz * 0.9) + yOff,
      size: sz,
      seed: (h ^ 0xA53F) >>> 0,
    });
  }
  // Sort by base-y ascending so back rocks draw first, front rocks last.
  chunks.sort((a, b) => (a.cy + a.size) - (b.cy + b.size));
  for (const r of chunks) {
    rockChunk(ctx, r.cx, r.cy, palette, {
      ...opts, seed: r.seed, size: r.size, cast: false, pebbles: false,
    });
  }
  // Pebble accents around the pile base.
  if (opts.pebbles !== false) {
    const pC = 3 + (_tileHash(seed, 0, 71) % 3);
    const edge   = palette.edge   || palette.shadow;
    const hilite = palette.hilite;
    const body   = palette.body;
    for (let p = 0; p < pC; p++) {
      const ph = _tileHash(seed, p, 89);
      const side = (ph & 1) ? 1 : -1;
      const px = cx + side * ((width >> 1) + 1 + ((ph >>> 1) % 3));
      const py = baseY + 1 + ((ph >>> 4) % 2);
      ctx.fillStyle = body;   ctx.fillRect(px - 1, py, 2, 1);
      ctx.fillStyle = hilite; ctx.fillRect(px - 1, py, 1, 1);
      ctx.fillStyle = edge;   ctx.fillRect(px - 1, py + 1, 2, 1);
    }
  }
}

// `boulder` — tile-anchored rock (drop-in replacement for the old
// speckle-textured boulder). Internally one rockChunk centered in
// the tile, sized to fill it, with cast shadow + lumps OFF by default
// for clean tiling (adjacent tile shadows/lumps would otherwise
// collide). For the free-standing single-rock look call rockChunk
// directly.
//   palette: { shadow, body, hilite, glint?, cast?, moss? }
//   opts:    { seed, moss=false, cast=false, lumps=false }
export function boulder(ctx, x, y, size, palette, opts = {}) {
  const seed = _matSeed(opts.seed, x, y);
  rockChunk(ctx, x + (size >> 1), y + (size >> 1) + 1, palette, {
    seed,
    size: Math.max(3, Math.floor(size * 0.48)),
    aspect: 1.0,
    cast:    opts.cast    === true,    // off by default for tiled use
    lumps:   opts.lumps   === true,    // off by default for tiled use
    moss:    opts.moss    || false,
    glints:  opts.glints  != null ? opts.glints : 1,
    pebbles: opts.pebbles || false,
  });
}

// `craggyWall` — tile-anchored CLUSTER of 2-3 rocks in a dark mortar
// bed. Reads as hewn masonry / cliff face. One bigger rock + smaller
// siblings, deterministic per-tile so adjacent tiles tile without
// visible repeats.
//   palette: { shadow, body, hilite, mortar?, glint?, moss? }
//   opts:    { seed, mossChance=0, rocks=3 }
export function craggyWall(ctx, x, y, size, palette, opts = {}) {
  const seed   = _matSeed(opts.seed, x, y);
  const mortar = palette.mortar || palette.shadow || '#1a1c22';
  // Mortar bed (dark recessed seam; rocks paint on top).
  ctx.fillStyle = mortar;
  ctx.fillRect(x, y, size, size);
  // Big central rock + 2 smaller satellites in opposite corners.
  const half = size >> 1;
  const cells = [
    { cx: x + half,     cy: y + half,     size: Math.max(3, Math.floor(size * 0.42)), salt: 0 },
    { cx: x + 4,        cy: y + size - 4, size: Math.max(3, Math.floor(size * 0.28)), salt: 1 },
    { cx: x + size - 4, cy: y + 4,        size: Math.max(3, Math.floor(size * 0.26)), salt: 2 },
  ];
  const nRocks = opts.rocks != null ? opts.rocks : 3;
  const mossChance = opts.mossChance != null ? opts.mossChance : 0;
  for (let i = 0; i < Math.min(nRocks, cells.length); i++) {
    const c = cells[i];
    const h = _tileHash(seed + c.salt * 5081, 0, 0);
    const jx = ((h & 3) - 1);
    const jy = (((h >>> 2) & 3) - 1);
    const wantsMoss = mossChance > 0 &&
                      (_tileHash(h + 0xCD3, 0, 0) % 100) < mossChance;
    rockChunk(ctx, c.cx + jx, c.cy + jy, palette, {
      seed:    (h ^ 0xB73F) >>> 0,
      size:    c.size,
      aspect:  1.0,
      cast:    false,
      lumps:   false,
      moss:    wantsMoss,
      glints:  i === 0 ? 1 : 0,   // glint only on the dominant rock
    });
  }
}

export function tileBrick(ctx, x, y, size, palette, opts = {}) {
  const seed   = opts.seed   != null ? opts.seed   : 0;
  const mortar = palette.mortar || '#3a2818';
  const body   = palette.body   || '#a04830';
  const light  = palette.hilite || '#c86040';
  const dark   = palette.shadow || mortar;
  // Mortar fill.
  ctx.fillStyle = mortar;
  ctx.fillRect(x, y, size, size);
  // Staggered brick rows.
  const bW = Math.max(3, Math.floor(size / 2));
  const bH = Math.max(3, Math.floor(size / 4));
  for (let row = 0; row * bH < size; row++) {
    const offset = (row & 1) ? Math.floor(bW / 2) : 0;
    for (let col = -1; col * bW <= size; col++) {
      const bx = x + col * bW + offset + 1;
      const by = y + row * bH + 1;
      const bw = bW - 1, bh = bH - 1;
      if (bx + bw <= x || bx >= x + size) continue;
      const cx = Math.max(x, bx), cy = Math.max(y, by);
      const cw = Math.min(x + size, bx + bw) - cx;
      const ch = Math.min(y + size, by + bh) - cy;
      if (cw <= 1 || ch <= 1) continue;
      ctx.fillStyle = body;
      ctx.fillRect(cx, cy, cw, ch);
      ctx.fillStyle = light;
      ctx.fillRect(cx, cy, cw, 1);
      ctx.fillRect(cx, cy, 1, ch);
      ctx.fillStyle = dark;
      ctx.fillRect(cx, cy + ch - 1, cw, 1);
      ctx.fillRect(cx + cw - 1, cy, 1, ch);
      // + shaped sparkle on a few bricks.
      const h = _tileHash(seed + row * 13 + col * 7, 0, 0);
      if ((h & 7) === 0 && cw >= 5 && ch >= 4) {
        ctx.fillStyle = light;
        ctx.fillRect(cx + 2, cy + 2, 1, 1);
        ctx.fillRect(cx + 1, cy + 2, 1, 1);
        ctx.fillRect(cx + 3, cy + 2, 1, 1);
      }
    }
  }
}

export function tilePlanks(ctx, x, y, size, palette, opts = {}) {
  const seed   = opts.seed   != null ? opts.seed   : 0;
  const body   = palette.body   || '#8a5828';
  const dark   = palette.shadow || '#4a2810';
  const light  = palette.hilite || '#a87038';
  const seam   = palette.seam   || '#3a1810';
  const spark  = palette.spark  || light;
  const plankW = opts.plankW != null ? opts.plankW : Math.max(3, Math.floor(size / 4));
  // Body fill.
  ctx.fillStyle = body;
  ctx.fillRect(x, y, size, size);
  // Grain clusters — short horizontal dark dashes.
  for (let plank = 0; plank < size; plank += plankW) {
    const pw = Math.min(plankW, size - plank);
    if (pw < 3) continue;
    const h = _tileHash(seed + plank, 0, 0);
    ctx.fillStyle = dark;
    for (let j = 0; j < 3; j++) {
      const gx = x + plank + 1 + ((h >>> (j * 3)) % Math.max(1, pw - 2));
      const gy = y + 2 + (((h >>> (8 + j)) & 3));
      if (gy < y + size - 1) ctx.fillRect(gx, gy, 2, 1);
    }
  }
  // Seams.
  for (let dx = plankW; dx < size; dx += plankW) {
    ctx.fillStyle = seam;
    ctx.fillRect(x + dx, y, 1, size);
    ctx.fillStyle = light;
    ctx.fillRect(x + dx + 1, y, 1, size);
  }
  // Top/bottom edges.
  ctx.fillStyle = light;
  ctx.fillRect(x, y, size, 1);
  ctx.fillStyle = dark;
  ctx.fillRect(x, y + size - 1, size, 1);
  // + shaped sparkle on a knot.
  if ((_tileHash(seed, 9, 9) & 3) < 2) {
    const h = _tileHash(seed + 4111, 0, 0);
    const pi = (h & 0xff) % Math.max(1, Math.floor(size / plankW));
    const kx = x + pi * plankW + 2;
    const ky = y + 3 + ((h >>> 16) % Math.max(1, size - 6));
    if (kx + 1 < x + size) {
      ctx.fillStyle = seam;
      ctx.fillRect(kx, ky, 2, 2);
      ctx.fillStyle = spark;
      ctx.fillRect(kx, ky, 1, 1);
    }
  }
}

export function tileGravel(ctx, x, y, size, palette, opts = {}) {
  const seed   = opts.seed   != null ? opts.seed   : 0;
  const mortar = palette.mortar || palette.dark || '#2a2820';
  const dark   = palette.dark   || '#5a5040';
  const body   = palette.body   || '#7a7060';
  const light  = palette.hilite || '#a0907a';
  const spark  = palette.spark  || light;
  // Mortar fill.
  ctx.fillStyle = mortar;
  ctx.fillRect(x, y, size, size);
  // Small stone clusters — 1-2px stones with highlight.
  for (let i = 0; i < 10; i++) {
    const h = _tileHash(seed + 701, i, 0);
    const sx = x + 1 + (h % Math.max(1, size - 3));
    const sy = y + 1 + ((h >>> 8) % Math.max(1, size - 3));
    const shade = (h >>> 16) & 0xff;
    const col = shade < 80 ? dark : shade < 220 ? body : light;
    const w = 1 + ((h >>> 24) & 1);
    ctx.fillStyle = col;
    ctx.fillRect(sx, sy, w, 1);
    if (w > 1 && sy + 1 < y + size) ctx.fillRect(sx, sy + 1, 1, 1);
  }
  // + shaped sparkle on a bright stone.
  const h = _tileHash(seed + 999, 0, 0);
  const sx = x + 2 + (h % Math.max(1, size - 4));
  const sy = y + 2 + ((h >>> 8) % Math.max(1, size - 4));
  ctx.fillStyle = spark;
  ctx.fillRect(sx, sy, 1, 1);
  ctx.fillRect(sx - 1, sy, 1, 1);
  ctx.fillRect(sx + 1, sy, 1, 1);
}

export function tileLava(ctx, x, y, size, palette, opts = {}) {
  const seed  = opts.seed  != null ? opts.seed  : 0;
  const body  = palette.body  || '#e85020';
  const crust = palette.crust || '#3a0a0a';
  const hot   = palette.hot   || '#ffd060';
  const glow  = palette.glow  || '#ffffff';
  // Molten base.
  ctx.fillStyle = body;
  ctx.fillRect(x, y, size, size);
  // Dark flow patches — clustered 2-3px orange-red clusters.
  if (palette.shadow) {
    for (let i = 0; i < 3; i++) {
      const h = _tileHash(seed + 701, i, 0);
      ctx.fillStyle = palette.shadow;
      ctx.fillRect(x + 1 + (h % Math.max(1, size - 4)),
                   y + 1 + ((h >>> 8) % Math.max(1, size - 4)), 2, 1);
      if ((h >>> 16) & 1) ctx.fillRect(x + 2 + (h % Math.max(1, size - 5)),
                   y + 2 + ((h >>> 10) % Math.max(1, size - 4)), 2, 1);
    }
  }
  // Crust plates — irregular dark blobs.
  for (let i = 0; i < 2; i++) {
    const h = _tileHash(seed + 311, i, 0);
    const cx = x + 3 + (h % Math.max(1, size - 6));
    const cy = y + 3 + ((h >>> 8) % Math.max(1, size - 6));
    const cr = 2 + ((h >>> 16) & 2);
    colorBlob(ctx, cx, cy, { body: crust },
      { size: cr, lobes: 4, irregularity: 0.55, seed: h });
  }
  // Hot veins — bright yellow lines.
  for (let i = 0; i < 2; i++) {
    const h = _tileHash(seed + 461, i, 0);
    pxLine(ctx, x + 1 + (h % Math.max(1, size - 2)), y + 1 + ((h >>> 8) % Math.max(1, size - 2)),
           x + 1 + ((h >>> 16) % Math.max(1, size - 2)), y + 1 + ((h >>> 24) % Math.max(1, size - 2)), hot);
  }
  // + shaped glow sparkles.
  for (let i = 0; i < 2; i++) {
    const h = _tileHash(seed + 1009, i, 0);
    const sx = x + 2 + (h % Math.max(1, size - 4));
    const sy = y + 2 + ((h >>> 8) % Math.max(1, size - 4));
    ctx.fillStyle = glow;
    ctx.fillRect(sx, sy, 1, 1);
    ctx.fillRect(sx - 1, sy, 1, 1);
    ctx.fillRect(sx + 1, sy, 1, 1);
    ctx.fillRect(sx, sy - 1, 1, 1);
    ctx.fillRect(sx, sy + 1, 1, 1);
  }
}

export function tileIce(ctx, x, y, size, palette, opts = {}) {
  const seed  = opts.seed  != null ? opts.seed  : 0;
  const body  = palette.body   || '#b8d0e8';
  const dark  = palette.shadow || '#7090c0';
  const light = palette.hilite || '#ffffff';
  const crack = palette.crack  || dark;
  // Body.
  ctx.fillStyle = body;
  ctx.fillRect(x, y, size, size);
  // Frost clusters — 2×1 dark shadow patches.
  for (let i = 0; i < 3; i++) {
    const h = _tileHash(seed + 201, i, 0);
    ctx.fillStyle = dark;
    ctx.fillRect(x + 2 + (h % Math.max(1, size - 5)),
                 y + 2 + ((h >>> 8) % Math.max(1, size - 4)), 2, 1);
  }
  // Crack lines.
  if (crack && (_tileHash(seed, 5, 5) & 3) < 2) {
    const h = _tileHash(seed + 401, 0, 0);
    const cx = x + 3 + (h % Math.max(1, size - 6));
    const cy = y + 3 + ((h >>> 8) % Math.max(1, size - 6));
    for (let i = 0; i < 2; i++) {
      const a = (i / 2) * Math.PI * 2 + ((h >>> (20 + i)) & 3) * 0.5;
      const len = 2 + ((h >>> (i * 3)) & 3);
      pxLine(ctx, cx, cy, cx + Math.round(Math.cos(a) * len), cy + Math.round(Math.sin(a) * len), crack);
    }
  }
  // + shaped glint sparkles.
  for (let i = 0; i < 2; i++) {
    const h = _tileHash(seed + 137, i, 0);
    const sx = x + 2 + (h % Math.max(1, size - 4));
    const sy = y + 2 + ((h >>> 8) % Math.max(1, size - 4));
    ctx.fillStyle = light;
    ctx.fillRect(sx, sy, 1, 1);
    ctx.fillRect(sx - 1, sy, 1, 1);
    ctx.fillRect(sx + 1, sy, 1, 1);
    ctx.fillRect(sx, sy - 1, 1, 1);
    ctx.fillRect(sx, sy + 1, 1, 1);
  }
}

export function tileMetalPanel(ctx, x, y, size, palette, opts = {}) {
  const body   = palette.body   || '#3a4458';
  const dark   = palette.shadow || '#1a2030';
  const light  = palette.hilite || '#7a8aa0';
  const rivet  = palette.rivet  || light;
  const spark  = palette.spark  || '#c0d0f0';
  // Base fill with subtle grain clusters.
  ctx.fillStyle = body;
  ctx.fillRect(x, y, size, size);
  for (let i = 0; i < 2; i++) {
    const h = _tileHash((opts.seed || 0) + 1, i, 0);
    ctx.fillStyle = dark;
    ctx.fillRect(x + 3 + (h % Math.max(1, size - 6)),
                 y + 3 + ((h >>> 8) % Math.max(1, size - 6)), 2, 1);
  }
  // Bevel border. Set `opts.bevel = false` to skip — useful when the
  // tile is a free-standing prop (e.g., a pillar over grass) where
  // the top/left highlight reads as a "random white stripe" rather
  // than panel shading. Default true preserves the original look for
  // wall/ceiling tiling where the bevel implies lighting.
  if (opts.bevel !== false) {
    ctx.fillStyle = light;
    ctx.fillRect(x, y, size, 1);
    ctx.fillRect(x, y, 1, size);
    ctx.fillStyle = dark;
    ctx.fillRect(x, y + size - 1, size, 1);
    ctx.fillRect(x + size - 1, y, 1, size);
  }
  // Corner rivets with + sparkle.
  const m = Math.max(2, size >> 3);
  for (const [rx, ry] of [[m, m], [size - m - 1, m],
                           [m, size - m - 1], [size - m - 1, size - m - 1]]) {
    ctx.fillStyle = rivet;
    ctx.fillRect(x + rx, y + ry, 1, 1);
    ctx.fillStyle = dark;
    ctx.fillRect(x + rx + 1, y + ry, 1, 1);
    ctx.fillRect(x + rx, y + ry + 1, 1, 1);
    if ((rx + ry) & 1) {
      ctx.fillStyle = spark;
      ctx.fillRect(x + rx, y + ry, 1, 1);
    }
  }
  // Optional seam.
  if (opts.seamY != null && opts.seamY > 0 && opts.seamY < size) {
    ctx.fillStyle = dark;
    ctx.fillRect(x, y + opts.seamY, size, 1);
    ctx.fillStyle = light;
    ctx.fillRect(x, y + opts.seamY + 1, size, 1);
  }
}
// ─── Tile-able substrate materials ───────────────────────────────────
// Tileable counterparts to the §4b arbitrary-rect substrates. Same
// visual vocabulary (clusters, zones, streaks) but adapted for the
// tile contract:
//   - NO edge bevels (top/left highlight, bottom/right shadow). Those
//     create visible seams when tiles repeat.
//   - Position-based `_tileHash(seed, x+dx, y+dy)` for noise so the
//     pattern is continuous across tile boundaries.
//   - Decorations (ridges, stitching, refraction sliver) that would
//     break seamless tiling are dropped. Use the §4b arbitrary-rect
//     versions when you want those.
// Use these for FLOORS / WALLS where the same material covers multiple
// adjacent tiles. Use §4b arbitrary-rect versions for free-standing
// props (a single bone, a glass vial).

// tileGlass — translucent panel suitable for glass-tile floors,
// skylights, etc. Renders body fill + scattered glints, no refraction
// sliver (which wouldn't tile). Caller should draw whatever's behind
// the glass first.
export function tileGlass(ctx, x, y, size, palette, opts = {}) {
  const tintHex = palette.tint || '#a0d8ff';
  const alpha = opts.alpha != null ? opts.alpha : 0.35;
  const seed = (opts.seed | 0) ^ ((x | 0) * 73856093) ^ ((y | 0) * 19349663);
  const r = parseInt(tintHex.slice(1, 3), 16);
  const g = parseInt(tintHex.slice(3, 5), 16);
  const b = parseInt(tintHex.slice(5, 7), 16);
  ctx.fillStyle = `rgba(${r},${g},${b},${alpha.toFixed(3)})`;
  ctx.fillRect(x, y, size, size);
  // Scattered glints — bright single pixels, density scales with seed.
  ctx.fillStyle = palette.glint || '#ffffff';
  const count = Math.max(1, Math.floor((size * size) / 60));
  for (let i = 0; i < count; i++) {
    const h = _tileHash(seed + 9001, i, 0);
    const gx = (h & 0xff) % size;
    const gy = ((h >>> 8) & 0xff) % size;
    ctx.fillRect(x + gx, y + gy, 1, 1);
  }
}

// tileLeather — supple pebble grain + light micro-glints. No
// stitching or creases (edge decorations would seam).
//   palette: { shadow, body, hilite }
export function tileLeather(ctx, x, y, size, palette, opts = {}) {
  const seed = (opts.seed | 0) ^ ((x | 0) * 73856093) ^ ((y | 0) * 19349663);
  ctx.fillStyle = palette.body;
  ctx.fillRect(x, y, size, size);
  // Pebble grain — clusters of 1-2 dark dots.
  const pebbles = Math.max(2, Math.floor((size * size) / 22));
  for (let p = 0; p < pebbles; p++) {
    const ph = _tileHash(seed + p * 1117, 0, 0);
    const pcx = (ph & 0xff) % size;
    const pcy = ((ph >>> 8) & 0xff) % size;
    const sat = (ph >>> 16) & 1;
    ctx.fillStyle = palette.shadow;
    ctx.fillRect(x + pcx, y + pcy, 1, 1);
    if (sat) {
      // Adjacent satellite — wraps modulo size for tile seamlessness.
      const ax = (pcx + ((ph >>> 17) & 1 ? 1 : -1) + size) % size;
      const ay = (pcy + ((ph >>> 18) & 1 ? 1 : -1) + size) % size;
      ctx.fillRect(x + ax, y + ay, 1, 1);
    }
  }
  // Micro-glints.
  ctx.fillStyle = palette.hilite;
  const glints = Math.max(1, Math.floor(pebbles * 0.3));
  for (let g = 0; g < glints; g++) {
    const gh = _tileHash(seed + g * 4421, 0, 0);
    const gx = (gh & 0xff) % size;
    const gy = ((gh >>> 8) & 0xff) % size;
    ctx.fillRect(x + gx, y + gy, 1, 1);
  }
}

// tileBone — porous off-white with continuous longitudinal grain. No
// central ridge or top/bottom edge highlights (would seam). Grain
// direction is fixed horizontal so adjacent tiles line up.
//   palette: { shadow, body, hilite }
export function tileBone(ctx, x, y, size, palette, opts = {}) {
  const seed = (opts.seed | 0) ^ ((x | 0) * 73856093) ^ ((y | 0) * 19349663);
  ctx.fillStyle = palette.body;
  ctx.fillRect(x, y, size, size);
  // Horizontal grain — full-width streaks at every 3rd row, 1-pixel
  // hits with 30% gaps. Position-hashed so streaks continue across
  // tile boundaries.
  ctx.fillStyle = palette.shadow;
  const stripes = Math.max(2, Math.floor(size / 3));
  for (let s = 0; s < stripes; s++) {
    const sy = 1 + Math.floor((s + 0.5) * (size - 2) / stripes);
    for (let dx = 0; dx < size; dx++) {
      // Hash on absolute position so two adjacent tiles produce a
      // continuous broken streak, not a hard seam.
      if ((_tileHash(seed + s * 41, x + dx, 0) & 7) > 1) {
        ctx.fillRect(x + dx, y + sy, 1, 1);
      }
    }
  }
  // Pore clusters.
  const clusters = 1 + ((seed >>> 12) & 1);
  for (let c = 0; c < clusters; c++) {
    const ch = _tileHash(seed + c * 5021, 0, 0);
    const ccx = (ch & 0xff) % size;
    const ccy = ((ch >>> 8) & 0xff) % size;
    const dotsPerCluster = 2 + ((ch >>> 16) & 2);
    for (let d = 0; d < dotsPerCluster; d++) {
      const dh = _tileHash(seed + c * 211 + d * 7, 0, 0);
      const ox = (dh & 3) - 1;
      const oy = ((dh >>> 4) & 3) - 1;
      const px = ((ccx + ox) % size + size) % size;
      const py = ((ccy + oy) % size + size) % size;
      ctx.fillRect(x + px, y + py, 1, 1);
    }
  }
}

// tileConcrete — granular surface with embedded aggregates and the
// occasional chip mark. Drops the edge dither line that the §4b
// version uses (would create a horizontal seam).
//   palette: { shadow, body, hilite, pebble? }
export function tileConcrete(ctx, x, y, size, palette, opts = {}) {
  const seed = (opts.seed | 0) ^ ((x | 0) * 73856093) ^ ((y | 0) * 19349663);
  ctx.fillStyle = palette.body;
  ctx.fillRect(x, y, size, size);
  // Granular speckle — uniform across the tile (no zoning, since
  // zones break tile-to-tile continuity).
  ctx.fillStyle = palette.shadow;
  for (let dy = 0; dy < size; dy++) {
    for (let dx = 0; dx < size; dx++) {
      if ((_tileHash(seed, x + dx, y + dy) % 11) < 2) {
        ctx.fillRect(x + dx, y + dy, 1, 1);
      }
    }
  }
  ctx.fillStyle = palette.hilite;
  for (let dy = 0; dy < size; dy++) {
    for (let dx = 0; dx < size; dx++) {
      if ((_tileHash(seed + 211, x + dx, y + dy) % 23) < 1) {
        ctx.fillRect(x + dx, y + dy, 1, 1);
      }
    }
  }
  // Aggregate pebbles — irregular 3-pixel shapes.
  const pebbleCol = palette.pebble || palette.shadow;
  const count = Math.max(1, Math.floor((size * size) / 36));
  for (let i = 0; i < count; i++) {
    const ph = _tileHash(seed + 4001, i, 0);
    const px = (ph & 0xff) % Math.max(1, size - 2);
    const py = ((ph >>> 8) & 0xff) % Math.max(1, size - 2);
    const shape = (ph >>> 16) & 3;
    ctx.fillStyle = pebbleCol;
    if (shape === 0) {
      ctx.fillRect(x + px, y + py, 2, 1);
      ctx.fillRect(x + px, y + py + 1, 1, 1);
    } else if (shape === 1) {
      ctx.fillRect(x + px, y + py, 1, 2);
      ctx.fillRect(x + px + 1, y + py, 1, 1);
    } else if (shape === 2) {
      ctx.fillRect(x + px, y + py, 2, 1);
      ctx.fillRect(x + px + 1, y + py + 1, 1, 1);
    } else {
      ctx.fillRect(x + px, y + py + 1, 2, 1);
      ctx.fillRect(x + px + 1, y + py, 1, 1);
    }
    ctx.fillStyle = palette.hilite;
    ctx.fillRect(x + px, y + py, 1, 1);
  }
  // Occasional chip — small angular triangle, 50% chance per tile.
  if ((seed >>> 8) & 1) {
    const ch = _tileHash(seed + 6151, 0, 0);
    const cx = 1 + (ch & 0xff) % Math.max(1, size - 3);
    const cy = 1 + ((ch >>> 8) & 0xff) % Math.max(1, size - 3);
    ctx.fillStyle = palette.shadow;
    ctx.fillRect(x + cx,     y + cy,     1, 1);
    ctx.fillRect(x + cx + 1, y + cy,     1, 1);
    ctx.fillRect(x + cx,     y + cy + 1, 1, 1);
  }
}

// ─── Flora primitives ──────────────────────────────────────────────────

// Single grass blade — 3-pixel-wide "M" shape with optional height.
//   palette = { dark, body, tip }
export function grassBlade(ctx, x, y, palette, opts = {}) {
  const size = opts.size != null ? opts.size : 1;
  const seed = opts.seed != null ? opts.seed : 0;
  const h    = _tileHash(seed, 0, 0);
  // Seed controls: which tips are bright, slight lean direction.
  const lean = ((h & 1) ? 1 : 0);  // lean right or left
  if (size === 1) {
    ctx.fillStyle = palette.body;
    ctx.fillRect(x, y + 1, 3, 1);
    ctx.fillStyle = palette.tip || palette.body;
    ctx.fillRect(x + lean, y, 1, 1);
    ctx.fillRect(x + 2 - lean, y, 1, 1);
    return;
  }
  if (size === 2) {
    ctx.fillStyle = palette.tip || palette.body;
    ctx.fillRect(x + 1 + (lean ? 1 : -1), y, 1, 1);
    ctx.fillStyle = palette.body;
    ctx.fillRect(x, y + 1, 3, 1);
    ctx.fillStyle = palette.dark || palette.body;
    ctx.fillRect(x, y + 2, 1, 1);
    ctx.fillRect(x + 2, y + 2, 1, 1);
    return;
  }
  // size 3 — tallest blade, seed varies tip width.
  const wideTip = (h >>> 1) & 1;
  ctx.fillStyle = palette.tip || palette.body;
  ctx.fillRect(x + 1, y, 1, 1 + wideTip);
  ctx.fillStyle = palette.body;
  ctx.fillRect(x, y + 1 + wideTip, 3, 1);
  ctx.fillStyle = palette.dark || palette.body;
  ctx.fillRect(x + lean, y + 2 + wideTip, 1, 1);
  ctx.fillRect(x + 2 - lean, y + 2 + wideTip, 1, 1);
}

// Grass clump — multiple blades radiating from a center.
export function grassClump(ctx, cx, cy, palette, opts = {}) {
  const count  = opts.count  != null ? opts.count  : 5;
  const spread = opts.spread != null ? opts.spread : 5;
  const seed   = opts.seed   != null ? opts.seed   : 0;
  for (let i = 0; i < count; i++) {
    const h = _tileHash(seed + 1907, i, 0);
    const bx = cx + ((h & 0xff) - 128) / 128 * spread;
    const by = cy + (((h >>> 8) & 0xff) - 128) / 128 * (spread * 0.4);
    grassBlade(ctx, Math.round(bx), Math.round(by), palette, { size: 1 + ((h >>> 16) & 1) });
  }
}

// Flower — stem + bloom at top. Kinds: simple, daisy, sunflower, bell, tulip.
export function flower(ctx, baseX, baseY, palette, opts = {}) {
  const kind  = opts.kind || 'simple';
  const stemH = opts.height != null ? opts.height : 5;
  const seed  = opts.seed  != null ? opts.seed  : 0;
  const h     = _tileHash(seed, 0, 0);
  // Seed varies: leaf side, slight stem height jitter, petal accent placement.
  const leafSide = (h & 1) ? -1 : 1;  // which side the upper leaf goes
  const stemJit  = ((h >>> 1) & 1) ? 0 : -1;  // stem slightly shorter sometimes
  const stemH2   = Math.max(2, stemH + stemJit);
  ctx.fillStyle = palette.stem;
  for (let i = 0; i < stemH2; i++) ctx.fillRect(baseX, baseY - i, 1, 1);
  if (palette.leaf) {
    ctx.fillStyle = palette.leaf;
    ctx.fillRect(baseX - 1, baseY - 1, 1, 1);
    ctx.fillRect(baseX + leafSide, baseY - 2, 1, 1);
  }
  const bx = baseX, by = baseY - stemH2;
  switch (kind) {
    case 'simple':
      ctx.fillStyle = palette.petal;
      ctx.fillRect(bx, by, 1, 1);
      if (palette.accent) {
        ctx.fillStyle = palette.accent;
        ctx.fillRect(bx + ((h >>> 2) & 1 ? 0 : 1), by - 1, 1, 1);
      }
      break;
    case 'daisy':
      ctx.fillStyle = palette.petal;
      ctx.fillRect(bx - 1, by, 1, 1); ctx.fillRect(bx + 1, by, 1, 1);
      ctx.fillRect(bx, by - 1, 1, 1); ctx.fillRect(bx, by + 1, 1, 1);
      // Seed: sometimes add diagonal petals for 6-petal variant.
      if ((h >>> 2) & 1) {
        ctx.fillRect(bx - 1, by - 1, 1, 1); ctx.fillRect(bx + 1, by + 1, 1, 1);
      }
      ctx.fillStyle = palette.center; ctx.fillRect(bx, by, 1, 1);
      break;
    case 'sunflower':
      ctx.fillStyle = palette.petal;
      ctx.fillRect(bx - 1, by - 1, 3, 3);
      ctx.fillRect(bx, by - 2, 1, 1); ctx.fillRect(bx, by + 2, 1, 1);
      ctx.fillRect(bx - 2, by, 1, 1); ctx.fillRect(bx + 2, by, 1, 1);
      // Seed: vary outer petal count (4 vs 8).
      if ((h >>> 3) & 1) {
        ctx.fillRect(bx - 1, by - 2, 1, 1); ctx.fillRect(bx + 1, by + 2, 1, 1);
        ctx.fillRect(bx - 2, by - 1, 1, 1); ctx.fillRect(bx + 2, by + 1, 1, 1);
      }
      ctx.fillStyle = palette.center; ctx.fillRect(bx, by, 1, 1);
      if (palette.accent) { ctx.fillStyle = palette.accent; ctx.fillRect(bx - 1, by, 1, 1); }
      break;
    case 'bell':
      ctx.fillStyle = palette.petal;
      ctx.fillRect(bx - 1, by, 3, 1);
      ctx.fillRect(bx + ((h >>> 2) & 1 ? 0 : 1), by + 1, 1, 1);  // seed varies bell lean
      if (palette.accent) { ctx.fillStyle = palette.accent; ctx.fillRect(bx, by, 1, 1); }
      break;
    case 'tulip':
      ctx.fillStyle = palette.petal;
      ctx.fillRect(bx, by, 1, 1); ctx.fillRect(bx - 1, by, 1, 1); ctx.fillRect(bx + 1, by, 1, 1);
      ctx.fillRect(bx, by - 1, 1, 1);
      // Seed: vary accent placement.
      if (palette.accent) {
        ctx.fillStyle = palette.accent;
        ctx.fillRect(bx + ((h >>> 2) & 1 ? 0 : -1), by - 1, 1, 1);
      }
      break;
  }
}

// Bush — compact leaf clump with layered ellipses and leaf-tip protrusions.
// Bush — multi-tone foliage blob with hairy edges, optional flowers,
// and grass tufts at the base. Rewritten for richer reference-style
// look: 3-tier shading with deliberate asymmetry per layer, single-
// pixel "leaf" protrusions around the silhouette (concentrated on top
// in the bright tip color), small flower/berry dots scattered across
// the upper hemisphere, and short grass blades poking down at the base.
//   palette: { dark, body, hilite, tip?, flower?, flowerAlt? }
//   opts:    { size=4, seed, flowers=3, grass=true, flowerCol, asym=true }
export function bush(ctx, cx, cy, palette, opts = {}) {
  const size = opts.size != null ? opts.size : 4;
  const seed = opts.seed != null ? opts.seed : 0;
  const flowers = opts.flowers != null ? opts.flowers : 3;
  const flowerCol = opts.flowerCol || palette.flower || '#ff6080';
  const flowerAlt = palette.flowerAlt || '#ffe080';
  const tipCol = palette.tip || palette.hilite;
  // Asymmetric layer offsets so the silhouette doesn't read as a clean
  // stack of concentric ellipses.
  const o1 = opts.asym !== false ? ((_tileHash(seed, 1, 0) & 1) ? -1 : 1) : 0;
  const o2 = opts.asym !== false ? ((_tileHash(seed, 2, 0) & 1) ? -1 : 1) : 0;
  // Bottom shadow (dark, widest, sits low).
  pxEllipse(ctx, cx, cy + 1, size, Math.max(1, size - 1), palette.dark);
  // Mid body — body color, slightly smaller, x-offset for asymmetry.
  pxEllipse(ctx, cx + o1, cy, size - 1, Math.max(1, size - 1), palette.body);
  // Top hilite — bright crown sitting up + offset.
  pxEllipse(ctx, cx + o2, cy - 2, Math.max(1, size - 2), Math.max(1, size - 3), palette.hilite);
  // Hairy edges — 1px protrusions around the silhouette. Top-half
  // protrusions in the bright tip color (lit leaves); bottom-half in
  // body color (shaded foliage).
  const protrusions = 8;
  for (let i = 0; i < protrusions; i++) {
    const h = _tileHash(seed + 7331, i, 0);
    if ((h >>> 8) & 1) continue;                 // 50% skip for natural gaps
    const a = (h & 0xff) / 0xff * Math.PI * 2;
    const r = size + 1;
    const tx = cx + Math.round(Math.cos(a) * r);
    const ty = cy + Math.round(Math.sin(a) * (r - 1)) - 1;
    ctx.fillStyle = a > Math.PI ? tipCol : palette.body;
    ctx.fillRect(tx, ty, 1, 1);
  }
  // Grass tufts at base — short 1px blades poking out from the
  // bottom hemisphere, in the dark color so they read as roots/grass.
  if (opts.grass !== false) {
    ctx.fillStyle = palette.dark;
    for (let i = 0; i < 5; i++) {
      const t = i / 4;
      const a = Math.PI * 0.15 + t * Math.PI * 0.7;     // bottom arc
      const tx = cx + Math.round(Math.cos(a) * size);
      const ty = cy + Math.round(Math.sin(a) * (size - 1)) + 1;
      ctx.fillRect(tx, ty, 1, 1);
    }
  }
  // Flowers/berries — small colored dots in the upper hemisphere.
  // Alternating two colors gives more visual variety than one.
  for (let f = 0; f < flowers; f++) {
    const fh = _tileHash(seed + 13 + f * 41, 0, 0);
    const a = -Math.PI * 0.85 + ((fh & 0xff) / 0xff) * Math.PI * 0.7;
    const r = Math.max(1, size - 2);
    const fx = cx + Math.round(Math.cos(a) * r);
    const fy = cy - 2 + Math.round(Math.sin(a) * Math.max(1, r - 1));
    ctx.fillStyle = ((fh >>> 16) & 1) ? flowerCol : flowerAlt;
    ctx.fillRect(fx, fy, 1, 1);
  }
}

// Fern frond — paired leaflets along a spine. Seed jitters leaflet
// placement and length for natural variation between fronds.
export function fernFrond(ctx, baseX, baseY, tipX, tipY, palette, opts = {}) {
  const every = opts.leafletEvery != null ? opts.leafletEvery : 2;
  const llen  = opts.leafletLen   != null ? opts.leafletLen   : 2;
  const seed  = opts.seed  != null ? opts.seed  : 0;
  const dx = tipX - baseX, dy = tipY - baseY;
  const len = Math.max(1, Math.round(Math.hypot(dx, dy)));
  const ux = dx / len, uy = dy / len;
  const nx = -uy, ny = ux;
  ctx.fillStyle = palette.spine;
  for (let s = 0; s <= len; s++) {
    const px = Math.round(baseX + ux * s), py = Math.round(baseY + uy * s);
    ctx.fillRect(px, py, 1, 1);
  }
  for (let s = every; s <= len - every; s += every) {
    const h = _tileHash(seed + s, 0, 0);
    const jit = ((h & 1) ? 0 : 1);  // seed: skip some leaflets for sparse variant
    if (jit) continue;
    const px = Math.round(baseX + ux * s), py = Math.round(baseY + uy * s);
    const llenJit = llen + ((h >>> 1) & 1);  // seed: vary leaflet length
    ctx.fillStyle = palette.leaf;
    for (let l = 1; l <= llenJit; l++) {
      ctx.fillRect(px + Math.round(nx * l), py + Math.round(ny * l), 1, 1);
      ctx.fillRect(px - Math.round(nx * l), py - Math.round(ny * l), 1, 1);
    }
    ctx.fillStyle = palette.hilite;
    ctx.fillRect(px + Math.round(nx * llenJit), py + Math.round(ny * llenJit), 1, 1);
  }
}

// Big leaf — single large curved leaf. Seed varies curve intensity.
export function bigLeaf(ctx, baseX, baseY, palette, opts = {}) {
  const length = opts.length != null ? opts.length : 7;
  const angle  = opts.angle  != null ? opts.angle  : -Math.PI / 3;
  const curve  = opts.curve  != null ? opts.curve  : 1.5;
  const seed   = opts.seed   != null ? opts.seed   : 0;
  const h      = _tileHash(seed, 0, 0);
  const curveJit = curve + ((h & 3) - 1.5) * 0.4;  // seed: ±0.6 curve variation
  const darkExt  = ((h >>> 2) & 1);  // seed: sometimes extend dark base further
  for (let s = 0; s <= length; s++) {
    const t = s / length;
    const sx = baseX + Math.cos(angle) * s + Math.sin(angle) * Math.sin(t * Math.PI) * curveJit;
    const sy = baseY + Math.sin(angle) * s - Math.cos(angle) * Math.sin(t * Math.PI) * curveJit * 0.5;
    const w = Math.max(1, Math.round((1 - t) * 1.5 + 1));
    ctx.fillStyle = t > 0.6 ? palette.hilite : palette.body;
    ctx.fillRect(Math.round(sx), Math.round(sy), w, 1);
    if (t < (darkExt ? 0.4 : 0.3)) {
      ctx.fillStyle = palette.dark;
      ctx.fillRect(Math.round(sx), Math.round(sy) + 1, w, 1);
    }
  }
}

// Leaf sprite — small decorative leaf at rotation 0-3.
export function leafSprite(ctx, x, y, color, rot = 0) {
  ctx.fillStyle = color;
  if (rot === 0) { ctx.fillRect(x, y, 2, 1); ctx.fillRect(x + 1, y - 1, 1, 1); }
  else if (rot === 1) { ctx.fillRect(x, y, 1, 2); ctx.fillRect(x - 1, y + 1, 1, 1); }
  else if (rot === 2) { ctx.fillRect(x, y, 2, 1); ctx.fillRect(x, y + 1, 1, 1); }
  else { ctx.fillRect(x, y, 1, 2); ctx.fillRect(x + 1, y, 1, 1); }
}

// ─── Organic blob primitives ────────────────────────────────────────────

// colorBlob — irregular blob from overlapping jittered circles.
export function colorBlob(ctx, cx, cy, palette, opts = {}) {
  const baseR = opts.size != null ? opts.size : 5;
  const lobes = opts.lobes != null ? opts.lobes : 4;
  const irreg = opts.irregularity != null ? opts.irregularity : 0.55;
  const seed  = opts.seed  != null ? opts.seed  : 0;
  const lobesArr = [];
  for (let i = 0; i < lobes; i++) {
    const h = _tileHash(seed, i, 0);
    const angle = (i / lobes) * Math.PI * 2 + ((h & 0xff) / 0xff - 0.5) * irreg * 1.5;
    const dist = baseR * irreg * (((h >>> 8) & 0xff) / 0xff);
    const r = Math.max(1, baseR * (0.7 + irreg * (((h >>> 16) & 0xff) / 0xff - 0.5)));
    lobesArr.push({ x: Math.round(cx + Math.cos(angle) * dist), y: Math.round(cy + Math.sin(angle) * dist), r });
  }
  const totalR = Math.ceil(baseR * 1.6);
  function isInside(px, py, expand = 0) {
    for (const l of lobesArr) {
      const ddx = px - l.x, ddy = py - l.y;
      const rr = l.r + expand;
      if (ddx * ddx + ddy * ddy <= rr * rr) return true;
    }
    return false;
  }
  if (palette.rim) {
    ctx.fillStyle = palette.rim;
    for (let dy = -totalR; dy <= totalR; dy++)
      for (let dx = -totalR; dx <= totalR; dx++)
        if (isInside(Math.round(cx + dx), Math.round(cy + dy), 1))
          ctx.fillRect(Math.round(cx + dx), Math.round(cy + dy), 1, 1);
  }
  ctx.fillStyle = palette.body;
  for (let dy = -totalR; dy <= totalR; dy++)
    for (let dx = -totalR; dx <= totalR; dx++)
      if (isInside(Math.round(cx + dx), Math.round(cy + dy), 0))
        ctx.fillRect(Math.round(cx + dx), Math.round(cy + dy), 1, 1);
  if (palette.hilite) {
    ctx.fillStyle = palette.hilite;
    for (let dy = -totalR; dy <= totalR; dy++)
      for (let dx = -totalR; dx <= totalR; dx++)
        if (isInside(Math.round(cx + dx), Math.round(cy + dy), -2))
          ctx.fillRect(Math.round(cx + dx), Math.round(cy + dy), 1, 1);
  }
}

// tileGrassBlobs — solid base + darker blob patches per tile.
export function tileGrassBlobs(ctx, x, y, size, palette, opts = {}) {
  const patches = opts.patches != null ? opts.patches : 1;
  const psize   = opts.patchSize != null ? opts.patchSize : Math.max(3, Math.floor(size / 3));
  const lobes   = opts.lobes != null ? opts.lobes : 4;
  const irreg   = opts.irregularity != null ? opts.irregularity : 0.55;
  const seed    = opts.seed != null ? opts.seed : 0;
  ctx.fillStyle = palette.base;
  ctx.fillRect(x, y, size, size);
  const margin = psize;
  for (let i = 0; i < patches; i++) {
    const h = _tileHash(seed + 4093, i, 0);
    const cx = x + margin + (h % Math.max(1, size - margin * 2));
    const cy = y + margin + ((h >>> 8) % Math.max(1, size - margin * 2));
    colorBlob(ctx, cx, cy, { body: palette.patchBody },
      { size: psize, lobes, irregularity: irreg, seed: seed + i * 17 });
  }
}

// blobField — free-floating blobs across an arbitrary rect. No rim by default.
export function blobField(ctx, rect, palette, opts = {}) {
  const count  = opts.count  != null ? opts.count  : 6;
  const size   = opts.size   != null ? opts.size   : 5;
  const jitter = opts.sizeJitter != null ? opts.sizeJitter : 3;
  const lobes  = opts.lobes  != null ? opts.lobes  : 4;
  const irreg  = opts.irregularity != null ? opts.irregularity : 0.55;
  const seed   = opts.seed   != null ? opts.seed   : 0;
  for (let i = 0; i < count; i++) {
    const h = _tileHash(seed + 7703, i, 0);
    const cx = rect.x + Math.round(((h & 0xffff) / 0xffff) * rect.w);
    const cy = rect.y + Math.round((((h >>> 16) & 0xffff) / 0xffff) * rect.h);
    const r  = size + Math.round((((h >>> 8) & 0xff) / 0xff - 0.5) * jitter * 2);
    colorBlob(ctx, Math.round(cx), Math.round(cy), palette,
      { size: Math.max(1, r), lobes, irregularity: irreg, seed: h });
  }
}

// blobEdgeGrass — small grass tufts along blob perimeters.
// Uses the same seed/positioning as blobField so tufts align with blob
// edges. Each tuft is a tiny cluster of 2-3 blades pointing outward.
//   rect = { x, y, w, h }
//   palette = { dark, body, tip }  — matches the blob palette
//   opts — same position params as blobField + tuftsPerBlob, bladesPerTuft
export function blobEdgeGrass(ctx, rect, palette, opts = {}) {
  const count  = opts.count  != null ? opts.count  : 6;
  const size   = opts.size   != null ? opts.size   : 5;
  const jitter = opts.sizeJitter != null ? opts.sizeJitter : 3;
  const seed   = opts.seed   != null ? opts.seed   : 0;
  const tuftsPerBlob = opts.tuftsPerBlob != null ? opts.tuftsPerBlob : 3;
  const bladesPerTuft = opts.bladesPerTuft != null ? opts.bladesPerTuft : 2;

  for (let i = 0; i < count; i++) {
    const h = _tileHash(seed + 7703, i, 0);
    const cx = rect.x + Math.round(((h & 0xffff) / 0xffff) * rect.w);
    const cy = rect.y + Math.round((((h >>> 16) & 0xffff) / 0xffff) * rect.h);
    const r  = size + Math.round((((h >>> 8) & 0xff) / 0xff - 0.5) * jitter * 2);

    // Place tufts around the perimeter of this blob.
    for (let t = 0; t < tuftsPerBlob; t++) {
      const th = _tileHash(seed + 8800 + i * 19, t, 0);
      // Angle around the blob edge.
      const angle = (th & 0xff) / 0xff * Math.PI * 2;
      // Position at the edge radius, with slight jitter.
      const er = Math.max(1, r) + ((th >>> 8) & 1);
      const ex = Math.round(cx + Math.cos(angle) * er);
      const ey = Math.round(cy + Math.sin(angle) * er);
      // Skip if out of bounds.
      if (ex < rect.x || ex >= rect.x + rect.w || ey < rect.y || ey >= rect.y + rect.h) continue;
      if ((th >>> 9) & 1) continue; // sparse ~50%

      // Draw a small tuft of 1-3 blades radiating outward from the edge.
      for (let b = 0; b < bladesPerTuft; b++) {
        const bh = _tileHash(seed + 9900 + i * 19 + t * 7, b, 0);
        const ba = angle + ((bh & 0xff) / 0xff - 0.5) * 0.8; // slight spread
        const bLen = 1 + ((bh >>> 8) & 1);                   // 1-2 px tall
        // Blade: dark base at the edge pixel, body middle, bright tip.
        for (let s = 0; s < bLen; s++) {
          const bx = Math.round(ex + Math.cos(ba) * (s + 1));
          const by = Math.round(ey + Math.sin(ba) * (s + 1));
          if (bx < rect.x || bx >= rect.x + rect.w || by < rect.y || by >= rect.y + rect.h) continue;
          ctx.fillStyle = s === bLen - 1 ? palette.tip
                        : s === 0          ? palette.dark
                        :                    palette.body;
          ctx.fillRect(bx, by, 1, 1);
        }
      }
    }
  }
}

// ─── Top-down grass tiles ───────────────────────────────────────────────

export function leafSpriteBush(ctx, x, y, color, rot) {
  // Alias — leafSprite covers both names.
  leafSprite(ctx, x, y, color, rot);
}

export function tileGrassOverhead(ctx, x, y, size, palette, opts = {}) {
  const seed = opts.seed != null ? opts.seed : 0;
  const density = opts.density != null ? opts.density : 0.07;
  ctx.fillStyle = palette.body;
  ctx.fillRect(x, y, size, size);
  ctx.fillStyle = palette.dark;
  blobField(ctx, { x, y, w: size, h: size }, { body: palette.dark }, {
    count: Math.floor(size * size * density * 0.6), size: 1, sizeJitter: 1,
    lobes: 2, irregularity: 0.5, seed: seed });
  ctx.fillStyle = palette.mid || palette.body;
  blobField(ctx, { x, y, w: size, h: size }, { body: palette.mid || palette.body }, {
    count: Math.floor(size * size * density * 0.3), size: 1, sizeJitter: 0,
    lobes: 2, irregularity: 0.5, seed: seed + 100 });
  ctx.fillStyle = palette.hilite;
  for (let i = 0; i < Math.floor(size * size * density * 0.1); i++) {
    const h = _tileHash(seed + 200 + i, 0, 0);
    ctx.fillRect(x + (h % size), y + ((h >>> 8) % size), 1, 1);
  }
}

export function tileGrassDetailed(ctx, x, y, size, palette, opts = {}) {
  const seed = opts.seed != null ? opts.seed : 0;
  const tufts = opts.tufts != null ? opts.tufts : 3;
  const bladesPerTuft = opts.bladesPerTuft != null ? opts.bladesPerTuft : 3;
  ctx.fillStyle = palette.shadow;
  ctx.fillRect(x, y, size, size);
  blobField(ctx, { x, y, w: size, h: size }, { body: palette.body }, {
    count: 6, size: Math.max(2, size >> 2), sizeJitter: 1,
    lobes: 4, irregularity: 0.5, seed: seed });
  for (let ti = 0; ti < tufts; ti++) {
    const h = _tileHash(seed + 3100 + ti, 0, 0);
    const tx = x + 2 + (h % Math.max(1, size - 4));
    const ty = y + 2 + ((h >>> 8) % Math.max(1, size - 4));
    grassClump(ctx, tx, ty, { dark: palette.dark, body: palette.body, tip: palette.tip || palette.hilite },
      { count: bladesPerTuft, spread: 3, seed: h });
  }
}

// ─── 3/4 perspective tree ───────────────────────────────────────────────

// Tree — 3/4 perspective with organic blob-canopy.
export function tree(ctx, baseX, baseY, palette, opts = {}) {
  const height = opts.height != null ? opts.height : 20;
  const size   = opts.size   != null ? opts.size   : 8;
  const seed   = opts.seed   != null ? opts.seed   : 0;
  const tipColor = palette.tip || palette.hilite;

  const trunkW = Math.max(2, Math.round(size * 0.25));
  const trunkH = Math.round(size * 0.8);
  const shadowY = baseY;
  const trunkBaseY = shadowY - 2;
  const trunkTopY = trunkBaseY - trunkH;

  pxEllipse(ctx, baseX, shadowY, Math.round(size * 0.7), 2, 'rgba(0,0,0,0.3)');

  const trunkX = baseX - Math.floor(trunkW / 2);
  ctx.fillStyle = palette.trunk;
  ctx.fillRect(trunkX, trunkTopY, trunkW, trunkH);
  ctx.fillStyle = palette.trunkShade;
  ctx.fillRect(trunkX, trunkTopY, 1, trunkH);
  for (let r = 1; r < trunkH - 1; r += 3) {
    const h = _tileHash(seed + 9001, r, 0);
    if ((h & 3) === 0) {
      ctx.fillStyle = palette.trunkShade;
      ctx.fillRect(trunkX + 1, trunkTopY + r, trunkW - 2, 1);
    }
  }

  if (trunkH >= 3) {
    const rootW = trunkW + 2;
    const rootX = baseX - Math.floor(rootW / 2);
    const rootY = trunkBaseY - 1;
    ctx.fillStyle = palette.trunkShade;
    ctx.fillRect(rootX, rootY, rootW, 1);
    if (rootW >= 4) {
      ctx.fillRect(rootX - 1, rootY, 1, 1);
      ctx.fillRect(rootX + rootW, rootY, 1, 1);
    }
  }

  const canopyCX = baseX;
  const canopyCY = trunkTopY - Math.round(size * 0.7);
  const bh = (layer, idx) => _tileHash(seed + layer * 7919, idx, 0);

  // Dark shadow blobs
  const darkCount = 3 + (seed & 3);
  for (let i = 0; i < darkCount; i++) {
    const h = bh(0, i);
    const ox = Math.round(((h & 0xff) / 0xff - 0.35) * size * 1.1);
    const oy = Math.round(size * 0.1 + ((h >>> 8) & 0xff) / 0xff * size * 0.25);
    const r  = Math.max(3, Math.round(size * (0.55 + ((h >>> 16) & 0xff) / 0xff * 0.3)));
    colorBlob(ctx, canopyCX + ox, canopyCY + oy, { body: palette.dark },
      { size: r, lobes: 4 + (i & 1), irregularity: 0.5, seed: h });
  }

  // Mid body blobs
  const bodyCount = 4 + ((seed >>> 2) & 3);
  for (let i = 0; i < bodyCount; i++) {
    const h = bh(1, i);
    const ox = Math.round(((h & 0xff) / 0xff - 0.45) * size * 0.9);
    const oy = Math.round(((h >>> 8) & 0xff) / 0xff * size * 0.15 - size * 0.15);
    const r  = Math.max(3, Math.round(size * (0.45 + ((h >>> 16) & 0xff) / 0xff * 0.3)));
    colorBlob(ctx, canopyCX + ox, canopyCY + oy, { body: palette.body },
      { size: r, lobes: 3 + (i & 1), irregularity: 0.5, seed: h });
  }

  // Highlight blobs
  const hiliteCount = 3 + ((seed >>> 4) & 1);
  for (let i = 0; i < hiliteCount; i++) {
    const h = bh(2, i);
    const ox = Math.round(((h & 0xff) / 0xff - 0.5) * size * 0.5);
    const oy = Math.round(-size * 0.4 - ((h >>> 8) & 0xff) / 0xff * size * 0.25);
    const r  = Math.max(2, Math.round(size * (0.28 + ((h >>> 16) & 0xff) / 0xff * 0.22)));
    colorBlob(ctx, canopyCX + ox, canopyCY + oy, { body: palette.hilite },
      { size: r, lobes: 3, irregularity: 0.5, seed: h });
  }

  // Crown cap
  if (tipColor) {
    const h = bh(3, 0);
    const crownCX = canopyCX + Math.round(((h & 0xff) / 0xff - 0.5) * size * 0.2);
    const crownCY = canopyCY - Math.round(size * 0.48);
    const crownR  = Math.max(2, Math.round(size * 0.25));
    colorBlob(ctx, crownCX, crownCY, { body: tipColor, rim: palette.hilite },
      { size: crownR, lobes: 3, irregularity: 0.55, seed: h });
    const h2b = bh(3, 1);
    colorBlob(ctx,
      crownCX + Math.round(((h2b & 0xff) / 0xff - 0.6) * size * 0.15),
      crownCY + Math.round(((h2b >>> 8) & 0xff) / 0xff * size * 0.1),
      { body: tipColor },
      { size: Math.max(1, crownR - 1), lobes: 2, irregularity: 0.5, seed: h2b });
    for (let i = 0; i < 8; i++) {
      const h2 = bh(3, i + 10);
      const sx = crownCX + Math.round(((h2 & 0xff) / 0xff - 0.5) * size * 0.6);
      const sy = crownCY - Math.round(((h2 >>> 8) & 0xff) / 0xff * size * 0.2);
      if ((h2 >>> 16) & 3) continue;
      ctx.fillStyle = tipColor;
      ctx.fillRect(sx, sy, 1, 1);
    }
  }

  // Edge leaf protrusions
  const leafCount = 8 + (seed & 7);
  for (let i = 0; i < leafCount; i++) {
    const h = _tileHash(seed + 7331, i, 0);
    const angle = Math.PI * 0.15 + (h & 0xff) / 0xff * Math.PI * 1.7;
    const dist = size + 1 + ((h >>> 8) & 3);
    if ((h >>> 11) & 1) continue;
    const lx = canopyCX + Math.round(Math.cos(angle) * dist);
    const ly = canopyCY + Math.round(size * 0.15) + Math.round(Math.sin(angle) * (dist * 0.7));
    ctx.fillStyle = (angle > Math.PI * 0.3 && angle < Math.PI * 1.3) ? palette.body : palette.dark;
    ctx.fillRect(lx, ly, 1, 1);
  }
}

// ─── Crystal-style flora (3/4 perspective, 5-stop shading) ────────────
//
// New tree + bush primitives built to `engine/crystal-stylegyude.md` —
// the CrystallEdge/SS14 pixel-art spec. They sit alongside the existing
// `tree` / `bush` (which use big `colorBlob` masses); these are the
// "form-first" style: stacked spheres + a cylindrical trunk, each shaded
// with the styleguide's 5 stops (shadow → midtone → neutral → light →
// highlight) and a single 1-px outline drawn in the `shadow` stop
// rather than pure black.
//
// Contract notes — keep this in mind when writing palettes:
//
//   • Light is treated as perpendicular-down (the styleguide's spec).
//     The drawing pulls every brighter stop UP by 1 px on the canvas,
//     so the lower rim of each sphere naturally falls back through
//     midtone → shadow and the top dome reads as the lit cap. Don't
//     try to "fix" that with a left-light palette — bake the warmth
//     into the highlight + light stops, the coolness into shadow.
//
//   • The outline IS `palette.shadow`. The styleguide is explicit that
//     outlines must contrast with adjacent pixels toward the darker
//     side and must NOT be pure black. So `shadow` should be a deep,
//     blue-shifted cool tone — dark enough to contrast `midtone`, but
//     hue-shifted, not just black.
//
//   • Hue-shift the palette per styleguide: shadow → cool/blue,
//     highlight → warm/yellow. The function does no hue shifting on
//     its own — the caller bakes it into the palette stops.
//
//   • Forms are deliberately stacked oblate spheres (ry < rx, set by
//     `opts.squash`), matching 3/4 perspective. Don't pass squash:1
//     unless you want a flat top-down look.
//
//   • These primitives use `pxEllipse` (row-fill), not `colorBlob`
//     (per-pixel JS loop), so they're ~10× cheaper than the existing
//     `tree`. Safe to use in per-frame paths if needed.

/**
 * 3/4-perspective tree — a cylindrical trunk with an overlapping
 * cluster of shaded foliage spheres on top.
 *
 * `(baseX, baseY)` is the ground anchor (center bottom of the trunk).
 *
 * `palette = { trunk: <stops>, foliage: <stops> }` where each `<stops>`
 * object has `{ shadow, midtone, neutral, light, highlight }`.
 *
 * Example palette (temperate green, hue-shifted: blue-leaning shadows,
 * yellow-leaning highlights):
 *
 *   {
 *     trunk: {
 *       shadow:    '#1a0e06',
 *       midtone:   '#3a2110',
 *       neutral:   '#553420',
 *       light:     '#7a4f30',
 *       highlight: '#a06840',
 *     },
 *     foliage: {
 *       shadow:    '#0e2818',
 *       midtone:   '#1d4222',
 *       neutral:   '#356b2e',
 *       light:     '#5fa53a',
 *       highlight: '#a8d850',
 *     },
 *   }
 *
 * `opts`:
 *   `size`     — foliage radius in px (drives every other dimension).
 *                Default 12 → tree ≈ 30 px tall (fits 32×32 sprite).
 *   `trunkH`   — trunk height. Default `size * 1.4`.
 *   `trunkW`   — trunk width.  Default `max(3, round(size * 0.35))`.
 *   `clusters` — number of overlapping foliage spheres, 1-6. Default 3.
 *   `squash`   — vertical squash on every foliage ellipse (3/4 oblate
 *                spheroid). Default 0.85.
 *   `seed`     — deterministic jitter seed.
 */
export function treeCrystal(ctx, baseX, baseY, palette, opts = {}) {
  const size     = opts.size     != null ? opts.size     : 12;
  const trunkH   = opts.trunkH   != null ? opts.trunkH   : Math.round(size * 1.4);
  const trunkW   = opts.trunkW   != null ? opts.trunkW   : Math.max(3, Math.round(size * 0.35));
  const clusters = opts.clusters != null ? opts.clusters : 3;
  const squash   = opts.squash   != null ? opts.squash   : 0.85;
  const seed     = opts.seed     != null ? opts.seed     : 0;
  const tpal = palette.trunk;
  const fpal = palette.foliage;

  // Trunk geometry.
  const trX     = Math.round(baseX - trunkW / 2);
  const trBaseY = Math.round(baseY);
  const trTopY  = trBaseY - trunkH;

  // ── Trunk: front face of a vertical cylinder ──────────────────────
  //
  // The 1-px outline is the whole rect filled in `shadow`; the inside
  // gets overpainted in vertical bands. Light is perpendicular-down,
  // so the lateral cylinder face is dim by spec — the top is `light`
  // (closer to a normal pointing at the sky), the middle is `neutral`,
  // the lower third is `midtone` (deeper under-canopy shadow), and
  // the rightmost column rolls back to `midtone` for curvature.
  ctx.fillStyle = tpal.shadow;
  ctx.fillRect(trX, trTopY, trunkW, trunkH);
  if (trunkW >= 3 && trunkH >= 4) {
    const innerW = trunkW - 2;
    const innerX = trX + 1;
    const topH = Math.max(1, Math.floor(trunkH * 0.15));
    const botH = Math.max(1, Math.floor(trunkH * 0.32));
    const midH = Math.max(0, trunkH - 2 - topH - botH);
    let y = trTopY + 1;
    ctx.fillStyle = tpal.light;   ctx.fillRect(innerX, y, innerW, topH); y += topH;
    ctx.fillStyle = tpal.neutral; ctx.fillRect(innerX, y, innerW, midH); y += midH;
    ctx.fillStyle = tpal.midtone; ctx.fillRect(innerX, y, innerW, botH);
    // Curvature column on the right — the cylinder rolling away.
    if (innerW >= 3) {
      ctx.fillStyle = tpal.midtone;
      ctx.fillRect(innerX + innerW - 1, trTopY + 1, 1, trunkH - 2);
    }
    // A short bark scratch — pseudo-random off the seed, optional.
    const hh = ((seed * 17) | 0);
    if ((hh & 3) === 0 && innerW >= 2 && trunkH >= 6) {
      const sy = trTopY + 2 + (hh & 0xff) % Math.max(1, trunkH - 4);
      ctx.fillStyle = tpal.shadow;
      ctx.fillRect(innerX + ((hh >> 4) & 1), sy, Math.max(1, innerW - 1), 1);
    }
  }

  // ── Foliage cluster ───────────────────────────────────────────────
  //
  // Layout: a central sphere + up to 5 satellites placed around the
  // UPPER hemisphere (the styleguide's "form: stacked simple shapes"
  // workflow). Each layer of the 5-stop sphere is then painted in a
  // single pass over ALL spheres so the cluster reads as one bumpy
  // silhouette rather than 3-6 overlapping outlined balls.
  const ccx = baseX;
  const ccy = trTopY - Math.round(size * 0.5);
  const layout = [
    { ang:               0,    dist: 0,           rScale: 1.00 },
    { ang: -Math.PI * 0.75,    dist: size * 0.70, rScale: 0.78 },
    { ang: -Math.PI * 0.25,    dist: size * 0.70, rScale: 0.78 },
    { ang: -Math.PI * 0.50,    dist: size * 0.95, rScale: 0.70 },
    { ang:  Math.PI * 0.10,    dist: size * 0.55, rScale: 0.62 },
    { ang: -Math.PI * 0.90,    dist: size * 0.55, rScale: 0.62 },
  ];
  const N = Math.max(1, Math.min(layout.length, clusters));
  const spheres = [];
  for (let i = 0; i < N; i++) {
    const h = (seed + i * 263) | 0;
    const jitterA = ((h & 0xff) / 0xff - 0.5) * 0.25;
    const jitterD = ((h >> 8) & 0xff) / 0xff * 0.10;
    const ang  = layout[i].ang  + jitterA;
    const dist = layout[i].dist * (1 + jitterD);
    const rx   = Math.max(2, Math.round(size * layout[i].rScale));
    spheres.push({
      x:  Math.round(ccx + Math.cos(ang) * dist),
      y:  Math.round(ccy + Math.sin(ang) * dist * squash),
      rx, ry: Math.max(1, Math.round(rx * squash)),
    });
  }
  // Unified-silhouette passes (each brighter stop pulled UP by 1 px so
  // the bottom rim of every sphere stays in the darker stops).
  for (const s of spheres) pxEllipse(ctx, s.x, s.y, s.rx, s.ry, fpal.shadow);
  for (const s of spheres) if (s.rx >= 2)
    pxEllipse(ctx, s.x, s.y, s.rx - 1, Math.max(1, s.ry - 1), fpal.midtone);
  for (const s of spheres) if (s.rx >= 3)
    pxEllipse(ctx, s.x, s.y - 1, s.rx - 2, Math.max(1, s.ry - 2), fpal.neutral);
  for (const s of spheres) if (s.rx >= 4)
    pxEllipse(ctx, s.x, s.y - 2, s.rx - 3, Math.max(1, s.ry - 3), fpal.light);
  // Highlight — small warm patch near the top of each sphere. Offset
  // 1 px to the right so it doesn't sit dead-center (avoids the
  // styleguide's "banding" by breaking pixel-grid symmetry).
  for (const s of spheres) {
    if (s.rx < 5) continue;
    const hr = Math.max(1, Math.floor(s.rx * 0.28));
    pxEllipse(ctx,
      s.x + 1,
      s.y - s.ry + Math.max(1, Math.floor(s.ry * 0.40)),
      hr, Math.max(1, hr - 1), fpal.highlight);
  }
}

/**
 * 3/4-perspective bush — a squat shaded sphere cluster sitting on the
 * ground, with a half-alpha contact shadow underneath.
 *
 * `(cx, cy)` is the ground contact point (center of the shadow row).
 *
 * `palette = { shadow, midtone, neutral, light, highlight }` — same
 * 5-stop contract as the foliage half of `treeCrystal`.
 *
 * `opts`:
 *   `size`     — bush radius in px. Default 6.
 *   `clusters` — 1-3 overlapping spheres. Default 2.
 *   `squash`   — vertical squash (oblate). Default 0.75 (bushier than
 *                tree-foliage's 0.85 — bushes hug the ground).
 *   `seed`     — deterministic jitter seed.
 */
export function bushCrystal(ctx, cx, cy, palette, opts = {}) {
  const size     = opts.size     != null ? opts.size     : 6;
  const clusters = opts.clusters != null ? opts.clusters : 2;
  const squash   = opts.squash   != null ? opts.squash   : 0.75;
  const seed     = opts.seed     != null ? opts.seed     : 0;

  // Contact shadow — a flat half-alpha row tucking the bush onto the
  // ground (no shadow = the bush floats).
  ctx.fillStyle = 'rgba(0,0,0,0.28)';
  const shW = Math.max(2, Math.round(size * 1.4));
  ctx.fillRect(Math.round(cx - shW / 2), Math.round(cy), shW, 1);

  // Sphere centers sit roughly `size * 0.7` above the ground, so the
  // bottom rim rests on the contact line.
  const ccy = Math.round(cy - Math.max(1, size * 0.7));
  const layout = [
    { dx: 0,                       rScale: 1.00 },
    { dx:  Math.round(size * 0.6), rScale: 0.70 },
    { dx: -Math.round(size * 0.6), rScale: 0.70 },
  ];
  const N = Math.max(1, Math.min(layout.length, clusters));
  const spheres = [];
  for (let i = 0; i < N; i++) {
    const h = (seed + i * 311) | 0;
    const rx = Math.max(2, Math.round(size * layout[i].rScale));
    // A small vertical jitter so the cluster doesn't read as 3 spheres
    // on a single y line.
    const dy = ((h & 1) ? -1 : 0);
    spheres.push({
      x:  Math.round(cx + layout[i].dx),
      y:  ccy + dy,
      rx,
      ry: Math.max(1, Math.round(rx * squash)),
    });
  }
  // Same unified 5-stop passes as `treeCrystal`'s foliage.
  for (const s of spheres) pxEllipse(ctx, s.x, s.y, s.rx, s.ry, palette.shadow);
  for (const s of spheres) if (s.rx >= 2)
    pxEllipse(ctx, s.x, s.y, s.rx - 1, Math.max(1, s.ry - 1), palette.midtone);
  for (const s of spheres) if (s.rx >= 3)
    pxEllipse(ctx, s.x, s.y - 1, s.rx - 2, Math.max(1, s.ry - 2), palette.neutral);
  for (const s of spheres) if (s.rx >= 4)
    pxEllipse(ctx, s.x, s.y - 2, s.rx - 3, Math.max(1, s.ry - 3), palette.light);
  for (const s of spheres) {
    if (s.rx < 4) continue;
    const hr = Math.max(1, Math.floor(s.rx * 0.30));
    pxEllipse(ctx,
      s.x + 1,
      s.y - s.ry + Math.max(1, Math.floor(s.ry * 0.35)),
      hr, Math.max(1, hr - 1), palette.highlight);
  }
}

// ─── Crystal-style tree variants ─────────────────────────────────────
//
// treeDead — gnarled leafless trunk + branches (cylinder primitive +
// recursive forking limbs).  5-stop shading, hash-based wobble for
// gnarled silhouette, root flare via _drawRootFlare helper.

// Shared root-flare helper — multi-prong outward fanning roots + a
// soft ground-shadow ellipse.  Reference: jungletreesmall.dmi shows
// 3-5 short prongs of varying length fanning outward from the trunk
// base, with a tapered translucent shadow oval beneath.  This is
// significantly more "planted-looking" than a single 1-px wider
// shadow row.
//
//   shadowCol — palette stop for the wood-color prongs (use trunk
//               shadow stop or palette.shadow for flat palettes).
function _drawRootFlare(ctx, baseX, trBaseY, trunkW, shadowCol) {
  const cx     = Math.round(baseX);
  const halfW  = Math.floor(trunkW / 2);
  const innerR = halfW + 1;  // first prong sits 1 px past the trunk edge
  const outerR = halfW + 2;  // second prong, further out
  const farR   = halfW + 3;  // third (only on wider trunks)

  ctx.fillStyle = shadowCol;
  // Base row — 1-px wider on each side than the trunk (the actual
  // flare row where the wood meets the ground).
  ctx.fillRect(cx - halfW - 1, trBaseY, trunkW + 2, 1);
  // Inner prongs (always): 1 px outward, 1 px deeper.
  ctx.fillRect(cx + innerR, trBaseY,     1, 1);
  ctx.fillRect(cx - innerR, trBaseY,     1, 1);
  ctx.fillRect(cx + innerR, trBaseY + 1, 1, 1);
  ctx.fillRect(cx - innerR, trBaseY + 1, 1, 1);
  // Outer prongs (medium+ trunks): 1 row down, further out.
  if (trunkW >= 4) {
    ctx.fillRect(cx + outerR, trBaseY + 1, 1, 1);
    ctx.fillRect(cx - outerR, trBaseY + 1, 1, 1);
  }
  // Far prongs (big trunks): even further, 2 rows down.
  if (trunkW >= 6) {
    ctx.fillRect(cx + farR, trBaseY + 2, 1, 1);
    ctx.fillRect(cx - farR, trBaseY + 2, 1, 1);
  }

  // Soft ground-shadow ellipse — semi-transparent, tapered.
  ctx.fillStyle = 'rgba(0,0,0,0.22)';
  const gw = trunkW + 5;
  const gx = cx - Math.floor(gw / 2);
  ctx.fillRect(gx,     trBaseY + 1, gw,     1);
  ctx.fillRect(gx + 1, trBaseY + 2, gw - 2, 1);
}


/**
 * Dead / spooky tree — a gnarled, leafless trunk with twisted branching
 * limbs. Uses the styleguide's "cylinder" geometric primitive for the
 * trunk, with pxLine-based branches that Y-fork at irregular angles.
 *
 * The trunk is a vertical trapezoid (wider at the base, narrower at the
 * top) shaded with the 5-stop pass. Bark texture is added as hash-based
 * horizontal scratches. Branches fork off the upper third of the trunk
 * and may sub-fork.
 *
 * `(baseX, baseY)` is the ground anchor (center bottom of the trunk).
 *
 * `palette = { shadow, midtone, neutral, light, highlight }` — 5 stops
 * for the wood (no separate foliage palette).
 *
 * Example palette (grey-brown dead wood, hue-shifted cool shadows):
 *
 *   {
 *     shadow:'#0e1018', midtone:'#1e2028', neutral:'#2e3038',
 *     light:'#484a50',   highlight:'#585a60',
 *   }
 *
 * `opts`:
 *   `size`     — half the trunk height in px. Default 14 → tree ≈ 34 px
 *                tall (fits 48×48 sprite).
 *   `trunkW`   — base trunk width. Default `max(2, round(size * 0.25))`.
 *   `branches` — number of primary branches (2-5). Default 3.
 *   `twist`    — 0-1 how twisted the trunk appears. Default 0.45.
 *                Higher = more lateral wobble per row.
 *   `seed`     — deterministic jitter seed.
 */
export function treeDead(ctx, baseX, baseY, palette, opts = {}) {
  const size     = opts.size     != null ? opts.size     : 14;
  const baseW    = opts.trunkW   != null ? opts.trunkW   : Math.max(4, Math.round(size * 0.32));
  const branchN  = opts.branches != null ? opts.branches : 4;
  const twist    = opts.twist    != null ? opts.twist    : 0.45;
  const seed     = opts.seed     != null ? opts.seed     : 0;

  const trBaseY = Math.round(baseY);
  const trTopY  = trBaseY - size * 2;
  const trH     = trBaseY - trTopY;

  // ── 1. Trunk: tapered cylinder, COLUMN-banded ────────────────────
  //
  // Per styleguide §Form ("trunk = cylinder primitive"): each row is
  // shaded as a horizontal slice of the cylinder — column position
  // within the row picks the stop. Edge columns in shadow (outline),
  // interior shaded midtone→neutral→light→midtone from left to right
  // (light on the upper-right per styleguide hue convention). The
  // lateral wobble (twist) is an absolute offset per row — it shifts
  // the whole slice without breaking the column-banded curvature.
  for (let row = 0; row < trH; row++) {
    const y      = trTopY + row;
    // frac = 0 at the BASE (full width), 1 at the TOP (~18% of base).
    // row=0 is at trTopY (top of trunk in canvas coords), so we invert
    // the row index when computing frac.  Without this inversion the
    // trunk would taper backwards — wide at the top, narrow at the base.
    const frac   = (trH - 1 - row) / Math.max(1, trH - 1);
    const taper  = 1 - frac * 0.82;
    const rowW   = Math.max(1, Math.round(baseW * taper));
    const rowH   = (seed * 7919 + row * 131) | 0;
    const wobble = Math.round(Math.sin(row * 0.55 + seed * 0.37) * twist * 1.8);
    const cx     = baseX + wobble;
    const left   = cx - Math.floor(rowW / 2);

    // Edge columns = shadow outline.
    ctx.fillStyle = palette.shadow;
    ctx.fillRect(left, y, 1, 1);
    if (rowW >= 2) ctx.fillRect(left + rowW - 1, y, 1, 1);

    // Interior cylinder banding.
    if (rowW >= 3) {
      const innerW = rowW - 2;
      for (let c = 0; c < innerW; c++) {
        const cFrac = innerW > 1 ? c / (innerW - 1) : 0.5;
        let col;
        if (cFrac < 0.20)      col = palette.midtone;  // shadow-side curve
        else if (cFrac < 0.55) col = palette.neutral;  // front face
        else if (cFrac < 0.85) col = palette.light;    // lit side
        else                   col = palette.midtone;  // right-side curve roll-off
        ctx.fillStyle = col;
        ctx.fillRect(left + 1 + c, y, 1, 1);
      }
    }

    // Bark scratches (hash-driven horizontal marks).
    if ((rowH & 7) === 0 && rowW >= 4) {
      ctx.fillStyle = palette.shadow;
      const sx = left + 1 + ((rowH >> 4) & 1);
      ctx.fillRect(sx, y, Math.max(1, rowW - 3), 1);
    }
  }

  // Top-plane cap on the trunk crown.
  {
    const taperT = 1 - 1 * 0.82;
    const topW   = Math.max(1, Math.round(baseW * taperT));
    const wobble = Math.round(Math.sin(seed * 0.37) * twist * 1.8);
    const cx     = baseX + wobble;
    const left   = cx - Math.floor(topW / 2);
    if (topW >= 2) {
      ctx.fillStyle = palette.light;
      ctx.fillRect(left, trTopY, topW, 1);
      ctx.fillStyle = palette.highlight;
      ctx.fillRect(left + topW - 1, trTopY, 1, 1);
    }
  }

  // Multi-prong root flare + ground-shadow ellipse.
  _drawRootFlare(ctx, baseX, trBaseY, baseW, palette.shadow);

  // ── 2. Branches — Y-forks from upper third ───────────────────────
  //
  // Each branch is a 2-px-thick stroke: SHADOW underline + LIGHT main
  // line (instead of midtone+neutral).  Using `light` for the main
  // body makes the branch silhouette pop against the dark night
  // backdrop typical for dead-tree compositions.  The 1-px shadow
  // beneath every branch creates a consistent 2-px stroke weight
  // along the entire branch, not just near the attachment.  Every
  // branch sub-forks (always — not random) for denser canopy.  Tip
  // terminates in a HIGHLIGHT pixel — one focal point per branch.
  const branchStartY = trTopY + Math.round(trH * 0.18);
  const branchZoneH  = Math.round(trH * 0.35);

  function drawStroke(x0, y0, x1, y1) {
    pxLine(ctx, x0, y0 + 1, x1, y1 + 1, palette.shadow);  // shadow underline
    pxLine(ctx, x0, y0,     x1, y1,     palette.light);   // lit main body
  }

  for (let b = 0; b < branchN; b++) {
    const bh     = (seed * 631 + b * 199) | 0;
    const startY = Math.round(branchStartY + ((bh & 0xff) / 0xff) * branchZoneH);
    const startX = baseX + Math.round((((bh >> 8) & 0xff) / 0xff - 0.5) * baseW * 0.7);
    const baseAng = -Math.PI * 0.35 + ((bh >> 16) & 0xff) / 0xff * Math.PI * 0.3;
    const bLen   = Math.round(size * (0.55 + ((bh >> 24) & 3) * 0.12));
    const endX   = Math.round(startX + Math.cos(baseAng) * bLen);
    const endY   = Math.round(startY + Math.sin(baseAng) * bLen);

    drawStroke(startX, startY, endX, endY);
    // Tip highlight focal.
    ctx.fillStyle = palette.highlight;
    ctx.fillRect(endX, endY, 1, 1);

    // Sub-fork — always (not gated) for denser canopy silhouette.
    const forkT   = 0.45 + ((bh >> 10) & 0xff) / 0xff * 0.30;
    const forkX   = Math.round(startX + (endX - startX) * forkT);
    const forkY   = Math.round(startY + (endY - startY) * forkT);
    const forkAng = baseAng + (((bh >> 12) & 1) ? 0.55 : -0.55);
    const forkLen = Math.round(bLen * 0.55);
    const fEndX   = Math.round(forkX + Math.cos(forkAng) * forkLen);
    const fEndY   = Math.round(forkY + Math.sin(forkAng) * forkLen);
    drawStroke(forkX, forkY, fEndX, fEndY);
    ctx.fillStyle = palette.highlight;
    ctx.fillRect(fEndX, fEndY, 1, 1);

    // Twig stub — small offshoot at the branch endpoint (always).
    const twigAng = baseAng + (((bh >> 3) & 1) ? -0.8 : 0.8);
    const twigLen = Math.max(2, Math.round(bLen * 0.30));
    const twigX   = Math.round(endX + Math.cos(twigAng) * twigLen);
    const twigY   = Math.round(endY + Math.sin(twigAng) * twigLen);
    drawStroke(endX, endY, twigX, twigY);
    ctx.fillStyle = palette.highlight;
    ctx.fillRect(twigX, twigY, 1, 1);
  }
}



// ─── More flora primitives ─────────────────────────────────────────────

// Mushroom — stem + cap in various shapes.
//   palette = { stem, cap, capLight, spot? }
//   opts.kind — 'round' | 'flat' | 'tall' | 'cluster'
//   opts.height — stem height (default 5)
//   opts.capSize — cap radius (default 3)
export function mushroom(ctx, baseX, baseY, palette, opts = {}) {
  const kind    = opts.kind    || 'round';
  const stemH   = opts.height  != null ? opts.height  : 5;
  const capR    = opts.capSize != null ? opts.capSize : 3;
  const seed    = opts.seed    != null ? opts.seed    : 0;
  const spot    = palette.spot || palette.capLight;
  // Stem.
  ctx.fillStyle = palette.stem;
  for (let r = 0; r < stemH; r++) {
    const stemW = kind === 'tall' ? 1 : (r > stemH - 3 ? 2 : 1);
    const sx = baseX - Math.floor(stemW / 2);
    ctx.fillRect(sx, baseY - stemH + r, stemW, 1);
  }
  const capY = baseY - stemH;
  if (kind === 'flat') {
    // Wide flat cap — wide top row, narrow bottom.
    ctx.fillStyle = palette.cap;
    ctx.fillRect(baseX - capR, capY, capR * 2 + 1, 1);
    ctx.fillRect(baseX - capR + 1, capY - 1, capR * 2 - 1, 1);
    ctx.fillStyle = palette.capLight;
    ctx.fillRect(baseX - capR + 1, capY, capR * 2 - 1, 1);
  } else if (kind === 'tall') {
    // Tall pointed cap.
    for (let r = 0; r < capR + 1; r++) {
      const w = Math.max(1, capR + 1 - r);
      ctx.fillStyle = r === 0 ? palette.capLight : palette.cap;
      ctx.fillRect(baseX - Math.floor(w / 2), capY - r, w, 1);
    }
  } else if (kind === 'cluster') {
    // Two small caps side by side.
    for (let ci = 0; ci < 2; ci++) {
      const cx = baseX + (ci ? 2 : -2);
      const cr = capR - 1;
      ctx.fillStyle = palette.cap;
      for (let dy = -cr; dy <= 0; dy++) {
        const w = Math.max(1, Math.round(cr + dy * 0.5) * 2 + 1);
        ctx.fillRect(cx - Math.floor(w / 2), capY + dy, w, 1);
      }
      ctx.fillStyle = palette.capLight;
      ctx.fillRect(cx - 1, capY - cr, 2, 1);
    }
  } else {
    // Round cap (default) — rounded dome.
    ctx.fillStyle = palette.cap;
    for (let dy = -capR; dy <= 0; dy++) {
      const w = Math.max(1, Math.round(Math.sqrt(capR * capR - dy * dy)) * 2 + 1);
      ctx.fillRect(baseX - Math.floor(w / 2), capY + dy, w, 1);
    }
    ctx.fillStyle = palette.capLight;
    const hiliteW = Math.max(1, capR);
    ctx.fillRect(baseX - Math.floor(hiliteW / 2), capY - capR + 1, hiliteW, 1);
    // Spots on the cap.
    if (spot) {
      for (let i = 0; i < 3; i++) {
        const h = _tileHash(seed + 417, i, 0);
        const sx = baseX + ((h & 0xff) - 128) / 128 * (capR - 1);
        const sy = capY - Math.floor(capR * 0.4) + ((h >>> 8) & 1);
        ctx.fillStyle = spot;
        ctx.fillRect(Math.round(sx), Math.round(sy), 1, 1);
      }
    }
  }
}

// Cattail / reed — tall thin stem with brown sausage-shaped head.
//   palette = { stem, head, headLight }
//   opts.height — total height (default 14)
export function cattail(ctx, baseX, baseY, palette, opts = {}) {
  const height = opts.height != null ? opts.height : 14;
  const seed   = opts.seed   != null ? opts.seed   : 0;
  const h      = _tileHash(seed, 0, 0);
  const headH  = Math.max(3, Math.floor(height * 0.3) + ((h & 1) ? 1 : -1));  // seed: head height ±1
  const lean   = ((h >>> 1) & 1) ? 1 : 0;  // seed: slight head lean
  // Stem.
  ctx.fillStyle = palette.stem;
  for (let r = 0; r < height - headH - 1; r++) {
    ctx.fillRect(baseX, baseY - r, 1, 1);
  }
  // Brown head — slightly offset by lean seed.
  const headY = baseY - height + headH;
  ctx.fillStyle = palette.head;
  ctx.fillRect(baseX - 1 + lean, headY, 3, headH);
  ctx.fillStyle = palette.headLight || palette.head;
  ctx.fillRect(baseX + lean, headY, 1, headH);
  // Top tip.
  ctx.fillStyle = palette.head;
  ctx.fillRect(baseX + lean, headY - 1, 1, 1);
  // Seed: sometimes add a second smaller head.
  if ((h >>> 2) & 1) {
    const h2 = _tileHash(seed + 1, 0, 0);
    const h2Y = headY + 2 + ((h2 & 1) ? 1 : 0);
    const h2H = Math.max(2, headH - 2);
    ctx.fillStyle = palette.head;
    ctx.fillRect(baseX - 1 + ((h2 & 1) ? 0 : 1), h2Y, 2, h2H);
    ctx.fillStyle = palette.headLight || palette.head;
    ctx.fillRect(baseX + ((h2 & 1) ? 0 : 1), h2Y, 1, h2H);
  }
}

// Small rock / boulder — rounded shape with highlight and shadow.
//   palette = { dark, body, light }
//   opts.size — radius (default 3)
// Rock — 3/4 perspective via three stacked oblate ellipses (same
// recipe as `bush`): dark bottom shadow widest + sits low, mid body
// 1-shrink + asymmetric x-offset, light top highlight 2-shrink + sits
// up + asymmetric x-offset.  Plus a soft `shadow` primitive sized to
// the rock's footprint for a proper gradient ground contact.  The
// asymmetric offsets break the concentric-stack look so the rock
// reads as an organic boulder rather than a target/bullseye.
//
//   palette = { dark, body, light }
//   opts.size   — horizontal radius in px (default 3)
//   opts.seed   — deterministic asymmetry seed
//   opts.shadow — set false to skip the ground contact shadow (default true)
export function rock(ctx, cx, cy, palette, opts = {}) {
  const size = opts.size != null ? opts.size : 3;
  const seed = opts.seed != null ? opts.seed : 0;
  // Asymmetric per-layer offsets so the three ellipses don't read as
  // a clean concentric stack (same trick as `bush`).
  const o1 = ((_tileHash(seed, 1, 0) & 1) ? -1 : 1);
  const o2 = ((_tileHash(seed, 2, 0) & 1) ? -1 : 1);
  // Ground contact shadow — soft falloff oval sized to the rock's
  // bottom footprint, drawn FIRST so the rock ellipses paint over its
  // upper edge (only the part extending past the rock is visible).
  // High-opacity black so the shadow reads as BLACK on bright
  // backgrounds — at 0.85 the shadow composites to ~85% darkening,
  // which reads as "shadow" rather than "muted grey patch."
  if (opts.shadow !== false) {
    shadow(ctx, cx, cy + size, { color: '#000' }, {
      shape:    'oval',
      width:    2 * size + 3,
      height:   Math.max(3, Math.round(size * 0.85)),
      alpha:    0.85,
      gradient: false,
    });
  }
  // Bottom shadow — widest, sits 1 px below center.  Forms the dark
  // rim where the rock meets the ground.
  pxEllipse(ctx, cx, cy + 1, size, Math.max(1, size - 1), palette.dark);
  // Mid body — main rock mass, 1 shrink, asymmetric x-offset.
  pxEllipse(ctx, cx + o1, cy, size - 1, Math.max(1, size - 1), palette.body);
  // Top highlight — sunlit top face, sits 2 px up + offset.
  pxEllipse(ctx, cx + o2, cy - 2,
            Math.max(1, size - 2), Math.max(1, size - 3),
            palette.light);
}

// Clover / small ground plant — 3-4 tiny leaves radiating from center.
//   palette = { leaf, light }
//   opts.leaves — number of leaves (default 3)
export function clover(ctx, cx, cy, palette, opts = {}) {
  const leaves = opts.leaves != null ? opts.leaves : 3;
  const seed   = opts.seed   != null ? opts.seed   : 0;
  for (let i = 0; i < leaves; i++) {
    const angle = (i / leaves) * Math.PI * 2 + ((_tileHash(seed, i, 0) & 3) - 1) * 0.3;
    const lx = Math.round(cx + Math.cos(angle) * 2);
    const ly = Math.round(cy + Math.sin(angle) * 1.5);
    // Heart-shaped leaf — 2×2 body + tip.
    ctx.fillStyle = palette.leaf;
    ctx.fillRect(lx, ly, 2, 2);
    ctx.fillStyle = palette.light || palette.leaf;
    ctx.fillRect(lx, ly - 1, 1, 1);
  }
  // Center dot.
  ctx.fillStyle = palette.light || palette.leaf;
  ctx.fillRect(cx, cy, 1, 1);
}

// Berry cluster — 2-4 small colored dots on a short stem.
//   palette = { stem, berry, light }
export function berryCluster(ctx, baseX, baseY, palette, opts = {}) {
  const count = opts.count != null ? opts.count : 3;
  const seed  = opts.seed  != null ? opts.seed  : 0;
  // Short stem.
  ctx.fillStyle = palette.stem;
  ctx.fillRect(baseX, baseY - 3, 1, 3);
  // Berries.
  for (let i = 0; i < count; i++) {
    const h = _tileHash(seed + i * 73, 0, 0);
    const bx = baseX + ((h & 1) ? 1 : -1) * (1 + ((h >>> 1) & 1));
    const by = baseY - 3 - ((h >>> 2) & 1);
    ctx.fillStyle = palette.berry;
    ctx.fillRect(bx, by, 1, 1);
    if ((h >>> 3) & 1) {
      ctx.fillStyle = palette.light || palette.berry;
      ctx.fillRect(bx, by - 1, 1, 1);
    }
  }
}

// Lily pad — flat green disc with a wedge cutout for water surfaces.
//   palette = { body, light, dark }
//   opts.size — radius (default 4)
export function lilyPad(ctx, cx, cy, palette, opts = {}) {
  const size = opts.size != null ? opts.size : 4;
  const seed = opts.seed != null ? opts.seed : 0;
  // Cutout wedge angle.
  const wedgeAngle = ((_tileHash(seed, 0, 0) & 0xff) / 0xff) * Math.PI * 0.6 + Math.PI * 0.2;
  // Body ellipse.
  ctx.fillStyle = palette.body;
  for (let dy = -size; dy <= size; dy++) {
    for (let dx = -size; dx <= size; dx++) {
      const t = (dx * dx) / (size * size) + (dy * dy) / ((size * 0.6) * (size * 0.6));
      if (t > 1) continue;
      // Skip pixels in the wedge cutout.
      const angle = Math.atan2(dy, dx);
      if (Math.abs(angle - wedgeAngle) < 0.4 && t > 0.5) continue;
      ctx.fillRect(cx + dx, cy + dy, 1, 1);
    }
  }
  // Highlight on top edge.
  ctx.fillStyle = palette.light || palette.body;
  for (let dx = -size + 1; dx < size; dx++) {
    const dy = -Math.round(Math.sqrt(Math.max(0, 1 - (dx * dx) / (size * size))) * size * 0.6);
    ctx.fillRect(cx + dx, cy + dy, 1, 1);
  }
  // Center vein lines.
  ctx.fillStyle = palette.dark || palette.body;
  for (let i = 0; i < 3; i++) {
    const a = (i / 3) * Math.PI * 2;
    pxLine(ctx, cx, cy, cx + Math.round(Math.cos(a) * size * 0.7),
           cy + Math.round(Math.sin(a) * size * 0.4), palette.dark || palette.body);
  }
}

// ─── 13b. Extended flora primitives ────────────────────────────────
// Biome-flexible plant pieces. Same composition pattern as the
// existing tree/mushroom/fern set: each takes a base anchor + palette
// + opts and stays within a small bbox so callers control layout.

// Single fern/palm frond with side leaflets stepping along a spine.
// `baseX, baseY` is the stem root; `tipX, tipY` is the frond tip.
//   palette: { spine, leaf, hilite }
//   opts:    { spacing=2, len=2 }
export function frond(ctx, baseX, baseY, tipX, tipY, palette, opts = {}) {
  const spacing = opts.spacing != null ? opts.spacing : 2;
  const lmax    = opts.len     != null ? opts.len     : 2;
  const dx = tipX - baseX, dy = tipY - baseY;
  const len = Math.max(1, Math.round(Math.sqrt(dx * dx + dy * dy)));
  const ux = dx / len, uy = dy / len;
  const px = -uy, py = ux;
  pxLine(ctx, baseX, baseY, tipX, tipY, palette.spine);
  for (let s = 1; s < len - 1; s += spacing) {
    const sx = Math.round(baseX + ux * s);
    const sy = Math.round(baseY + uy * s);
    const taper = 1 - s / len;
    const ll = Math.max(1, Math.round(lmax * taper));
    for (let k = 1; k <= ll; k++) {
      ctx.fillStyle = (k === ll) ? palette.hilite : palette.leaf;
      ctx.fillRect(Math.round(sx + px * k), Math.round(sy + py * k), 1, 1);
      ctx.fillRect(Math.round(sx - px * k), Math.round(sy - py * k), 1, 1);
    }
  }
}

// Rosette of fleshy leaves spiraling from center. Agave/aloe/desert
// succulent silhouette.
//   palette: { body, hilite }
//   opts:    { layers=3, radius=5 }
export function succulent(ctx, cx, cy, palette, opts = {}) {
  const layers = opts.layers != null ? opts.layers : 3;
  const radius = opts.radius != null ? opts.radius : 5;
  for (let layer = 0; layer < layers; layer++) {
    const r = radius * (1 - layer / (layers + 1));
    const count = 6 + layer * 2;
    const phase = layer * 0.45;
    for (let i = 0; i < count; i++) {
      const a    = (i / count) * Math.PI * 2 + phase;
      const tipX = cx + Math.round(Math.cos(a) * r);
      const tipY = cy + Math.round(Math.sin(a) * r);
      const baseX = cx + Math.round(Math.cos(a) * 1);
      const baseY = cy + Math.round(Math.sin(a) * 1);
      pxLine(ctx, baseX, baseY, tipX, tipY,
             layer === 0 ? palette.body : palette.hilite);
      glint(ctx, tipX, tipY, palette.hilite);
    }
  }
  ctx.fillStyle = palette.hilite;
  ctx.fillRect(cx, cy, 1, 1);
}

// Vertical ribbed cactus body with optional side arm(s) and spines.
//   palette: { shadow, body, hilite, spine? }
//   opts:    { height=18, width=5, arms=0 }   arms ∈ {0, 1, 2}
export function cactus(ctx, baseX, baseY, palette, opts = {}) {
  const h    = opts.height != null ? opts.height : 18;
  const w    = opts.width  != null ? opts.width  : 5;
  const arms = opts.arms   != null ? opts.arms   : 0;
  const spineCol = palette.spine || '#fff8c0';
  for (let i = 0; i < h; i++) {
    const y = baseY - i;
    ctx.fillStyle = palette.shadow;
    ctx.fillRect(baseX,         y, 1, 1);
    ctx.fillRect(baseX + w - 1, y, 1, 1);
    ctx.fillStyle = palette.body;
    for (let k = 1; k < w - 1; k++) ctx.fillRect(baseX + k, y, 1, 1);
    ctx.fillStyle = palette.hilite;
    ctx.fillRect(baseX + 1, y, 1, 1);
    if ((i & 1) === 0) {
      ctx.fillStyle = spineCol;
      ctx.fillRect(baseX + w, y, 1, 1);
      if (i > 0) ctx.fillRect(baseX - 1, y, 1, 1);
    }
  }
  // Rounded top
  ctx.fillStyle = palette.body;
  ctx.fillRect(baseX + 1, baseY - h, w - 2, 1);
  // Side arms — angled up from mid-trunk.
  if (arms >= 1) {
    const armY = baseY - Math.floor(h * 0.45);
    const armH = Math.floor(h * 0.4);
    ctx.fillStyle = palette.body;
    for (let k = 1; k <= 2; k++) ctx.fillRect(baseX + w - 1 + k, armY, 1, 1);
    for (let i = 0; i < armH; i++) {
      ctx.fillStyle = palette.body;
      ctx.fillRect(baseX + w + 1, armY - i, 1, 1);
      ctx.fillStyle = palette.shadow;
      ctx.fillRect(baseX + w + 2, armY - i, 1, 1);
    }
  }
  if (arms >= 2) {
    const armY = baseY - Math.floor(h * 0.6);
    const armH = Math.floor(h * 0.35);
    ctx.fillStyle = palette.body;
    for (let k = 1; k <= 2; k++) ctx.fillRect(baseX - k, armY, 1, 1);
    for (let i = 0; i < armH; i++) {
      ctx.fillStyle = palette.body;
      ctx.fillRect(baseX - 2, armY - i, 1, 1);
      ctx.fillStyle = palette.shadow;
      ctx.fillRect(baseX - 3, armY - i, 1, 1);
    }
  }
}

// Branching coral / alien growth. Recursive Y-fork with tapering
// length per generation. Tip glints in `tip` color (or `hilite`).
//   palette: { shadow, body, hilite, tip? }
//   opts:    { segments=4, branches=2, segLen=4, spread=Math.PI/6 }
export function coral(ctx, baseX, baseY, palette, opts = {}) {
  const segments = opts.segments != null ? opts.segments : 4;
  const branches = opts.branches != null ? opts.branches : 2;
  const segLen   = opts.segLen   != null ? opts.segLen   : 4;
  const spread   = opts.spread   != null ? opts.spread   : Math.PI / 6;
  function drawBranch(x, y, dirAngle, len, depth) {
    if (depth === 0 || len < 1) {
      glint(ctx, x, y, palette.tip || palette.hilite);
      return;
    }
    const tipX = Math.round(x + Math.cos(dirAngle) * len);
    const tipY = Math.round(y + Math.sin(dirAngle) * len);
    pxLine(ctx, x, y, tipX, tipY,
           depth === segments ? palette.shadow : palette.body);
    glint(ctx, ((x + tipX) / 2) | 0, ((y + tipY) / 2) | 0, palette.hilite);
    for (let b = 0; b < branches; b++) {
      const a = dirAngle + (b - (branches - 1) / 2) * spread;
      drawBranch(tipX, tipY, a, Math.max(1, len - 1), depth - 1);
    }
  }
  drawBranch(baseX, baseY, -Math.PI / 2, segLen, segments);
}

// Gnarly twisting branch with thorns. `path` is an array of {x, y}
// points along the vine; thorns stick out perpendicular every few
// steps, alternating sides.
//   palette: { shadow, body, thorn? }
//   opts:    { thornEvery=3, thornLen=2 }
export function thornyVine(ctx, path, palette, opts = {}) {
  const every = opts.thornEvery != null ? opts.thornEvery : 3;
  const tlen  = opts.thornLen   != null ? opts.thornLen   : 2;
  const thornCol = palette.thorn || palette.shadow;
  for (let i = 0; i < path.length; i++) {
    const p = path[i];
    ctx.fillStyle = (i & 1) ? palette.body : palette.shadow;
    ctx.fillRect(Math.round(p.x), Math.round(p.y), 1, 1);
    if (i > 0 && i % every === 0 && i < path.length - 1) {
      const prev = path[i - 1], next = path[i + 1];
      const tx = next.x - prev.x, ty = next.y - prev.y;
      const len = Math.sqrt(tx * tx + ty * ty) || 1;
      const px = -ty / len, py = tx / len;
      const side = ((i / every) | 0) & 1 ? 1 : -1;
      pxLine(ctx,
             Math.round(p.x), Math.round(p.y),
             Math.round(p.x + px * tlen * side),
             Math.round(p.y + py * tlen * side),
             thornCol);
    }
  }
}

// ─── 12. Autotiler ────────────────────────────────────────────────
// Bitmask-driven tile picker. The 4-bit cardinal model: each tile
// looks at its 4 neighbors and produces a 4-bit mask (N | E | S | W).
// 16 unique sprites cover every combination. The 8-bit blob model
// adds 4 corner bits for the full 47-tile blob set.
//
// Mask bits:
//   N=1  E=2  S=4  W=8
//   NE=16 SE=32 SW=64 NW=128

export const NEIGHBOR_N  = 1;
export const NEIGHBOR_E  = 2;
export const NEIGHBOR_S  = 4;
export const NEIGHBOR_W  = 8;
export const NEIGHBOR_NE = 16;
export const NEIGHBOR_SE = 32;
export const NEIGHBOR_SW = 64;
export const NEIGHBOR_NW = 128;

// 4-bit cardinal mask. `sameFn(x, y)` returns true when (x, y) is the
// same tile type. Out-of-bounds defaults to "not matching."
export function neighborMask4(sameFn, x, y) {
  let mask = 0;
  if (sameFn(x,     y - 1)) mask |= NEIGHBOR_N;
  if (sameFn(x + 1, y    )) mask |= NEIGHBOR_E;
  if (sameFn(x,     y + 1)) mask |= NEIGHBOR_S;
  if (sameFn(x - 1, y    )) mask |= NEIGHBOR_W;
  return mask;
}

// 8-bit blob mask. Cardinal bits + corner bits ONLY when both adjacent
// cardinals also match (avoids spurious stair-fill on isolated diagonals).
export function neighborMask8(sameFn, x, y) {
  const m = neighborMask4(sameFn, x, y);
  let blob = m;
  if ((m & NEIGHBOR_N) && (m & NEIGHBOR_E) && sameFn(x + 1, y - 1)) blob |= NEIGHBOR_NE;
  if ((m & NEIGHBOR_S) && (m & NEIGHBOR_E) && sameFn(x + 1, y + 1)) blob |= NEIGHBOR_SE;
  if ((m & NEIGHBOR_S) && (m & NEIGHBOR_W) && sameFn(x - 1, y + 1)) blob |= NEIGHBOR_SW;
  if ((m & NEIGHBOR_N) && (m & NEIGHBOR_W) && sameFn(x - 1, y - 1)) blob |= NEIGHBOR_NW;
  return blob;
}

// Edge overlay — paint a 1-px border on sides where there's no
// matching neighbor. Pair with any tile primitive for auto-borders.
// Debug tile — pink/red checkerboard for unmapped regions.
export function tileDebug(ctx, x, y, size, palette, opts = {}) {
  const cell = opts.cell != null ? opts.cell : 4;
  const body = (palette && palette.body) || '#f0a0a0';
  const alt  = (palette && palette.alt)  || '#d88080';
  ctx.fillStyle = body;
  ctx.fillRect(x, y, size, size);
  ctx.fillStyle = alt;
  for (let dy = 0; dy < size; dy++) {
    for (let dx = 0; dx < size; dx++) {
      if (((Math.floor(dx / cell) + Math.floor(dy / cell)) & 1) === 1) {
        ctx.fillRect(x + dx, y + dy, 1, 1);
      }
    }
  }
}

// Debug tile with label — hex index rendered in corner.
export function tileDebugLabel(ctx, x, y, size, palette = {}, opts = {}) {
  tileDebug(ctx, x, y, size, palette, opts);
  const text = opts.text != null ? opts.text : '0';
  const glyph = palette.glyph || '#000';
  const outline = palette.glyphOutline || '#fff';
  // Simple 3x5 pixel font for hex digits 0-F.
  const glyphs = {
    '0': [0x7,0x5,0x5,0x5,0x7], '1': [0x2,0x6,0x2,0x2,0x7],
    '2': [0x7,0x1,0x7,0x4,0x7], '3': [0x7,0x1,0x7,0x1,0x7],
    '4': [0x5,0x5,0x7,0x1,0x1], '5': [0x7,0x4,0x7,0x1,0x7],
    '6': [0x7,0x4,0x7,0x5,0x7], '7': [0x7,0x1,0x1,0x1,0x1],
    '8': [0x7,0x5,0x7,0x5,0x7], '9': [0x7,0x5,0x7,0x1,0x7],
    'A': [0x7,0x5,0x7,0x5,0x5], 'B': [0x6,0x5,0x6,0x5,0x6],
    'C': [0x7,0x4,0x4,0x4,0x7], 'D': [0x6,0x5,0x5,0x5,0x6],
    'E': [0x7,0x4,0x7,0x4,0x7], 'F': [0x7,0x4,0x7,0x4,0x4],
  };
  const g = glyphs[text.charAt(0)] || glyphs['0'];
  const ox = x + 2, oy = y + 2;
  for (let row = 0; row < 5; row++) {
    for (let col = 0; col < 3; col++) {
      if (g[row] & (1 << (2 - col))) {
        ctx.fillStyle = outline;
        ctx.fillRect(ox + col - 1, oy + row - 1, 3, 3);
        ctx.fillStyle = glyph;
        ctx.fillRect(ox + col, oy + row, 1, 1);
      }
    }
  }
}

export function tileEdgeOverlay(ctx, x, y, size, mask, palette) {
  ctx.fillStyle = palette.edge;
  if (!(mask & NEIGHBOR_N)) ctx.fillRect(x, y, size, 1);
  if (!(mask & NEIGHBOR_E)) ctx.fillRect(x + size - 1, y, 1, size);
  if (!(mask & NEIGHBOR_S)) ctx.fillRect(x, y + size - 1, size, 1);
  if (!(mask & NEIGHBOR_W)) ctx.fillRect(x, y, 1, size);
}

// Inner-corner chamfer — for blob 47-tile autotiling. When two
// cardinal neighbors are present but the diagonal between them ISN'T,
// the inner corner is a stair-step that benefits from a chamfer pass.
export function tileCornerChamfer(ctx, x, y, size, mask8, palette) {
  if (!palette.chamfer) return;
  ctx.fillStyle = palette.chamfer;
  if ((mask8 & NEIGHBOR_N) && (mask8 & NEIGHBOR_E) && !(mask8 & NEIGHBOR_NE)) {
    ctx.fillRect(x + size - 2, y, 2, 1);
    ctx.fillRect(x + size - 1, y + 1, 1, 1);
  }
  if ((mask8 & NEIGHBOR_S) && (mask8 & NEIGHBOR_E) && !(mask8 & NEIGHBOR_SE)) {
    ctx.fillRect(x + size - 2, y + size - 1, 2, 1);
    ctx.fillRect(x + size - 1, y + size - 2, 1, 1);
  }
  if ((mask8 & NEIGHBOR_S) && (mask8 & NEIGHBOR_W) && !(mask8 & NEIGHBOR_SW)) {
    ctx.fillRect(x, y + size - 1, 2, 1);
    ctx.fillRect(x, y + size - 2, 1, 1);
  }
  if ((mask8 & NEIGHBOR_N) && (mask8 & NEIGHBOR_W) && !(mask8 & NEIGHBOR_NW)) {
    ctx.fillRect(x, y, 2, 1);
    ctx.fillRect(x, y + 1, 1, 1);
  }
}

// "Solid" edge overlay — alias for tileEdgeOverlay. Crisp 1-px borders
// on each side without a matching neighbor. The default for hardware,
// dungeons, sci-fi tiles.
export function tileSolidEdgeOverlay(ctx, x, y, size, mask, palette) {
  return tileEdgeOverlay(ctx, x, y, size, mask, palette);
}

// "Nature" edge overlay — ragged organic border with deterministic
// 1–2 pixel bumps inward, plus a softer shadow band one pixel deeper.
// Reads as "grass meeting dirt" or any organic boundary. Same 4-bit
// mask as the solid overlay; the trick is just the pixel profile.
//
//   palette = { rim, shadow? }
//     rim     — outer dark border color (the brown around grass).
//                Ignored when opts.transparentEdges is true.
//     shadow  — optional inner-darker color one pixel deeper
//   opts.maxDepth         — depth of the ragged edge (1..3, default 3)
//   opts.seed             — integer for deterministic bump pattern
//   opts.transparentEdges — if true, edge pixels are CLEARED (clearRect)
//                           instead of painted with rim/light.  Use this
//                           when the autotile sprite is blitted over a
//                           full-canvas underlay (e.g. one tile painted
//                           everywhere) so the underlying tile shows
//                           through the ragged bumps — no dark border.
export function tileNatureEdgeOverlay(ctx, x, y, size, mask, palette, opts = {}) {
  const seed = opts.seed != null ? opts.seed : 0;
  const rim   = palette.rim;
  const light = palette.light || rim;
  const transparent = !!opts.transparentEdges;

  // Build a smooth, wavy depth profile along one edge using layered
  // sine waves + hash noise. Returns array of [0..maxDepth] per pixel.
  function waveProfile(side, maxDepth) {
    const arr = new Array(size);
    // 2-3 sine waves at different frequencies for organic flow.
    const h0 = _tileHash(seed + side * 999331, 0, 0);
    const freq1 = 1.5 + (h0 & 0xff) / 0xff * 1.5;    // 1.5–3.0 cycles
    const freq2 = 0.4 + ((h0 >>> 8) & 0xff) / 0xff * 0.8; // 0.4–1.2 cycles
    const phase1 = ((h0 >>> 16) & 0xff) / 0xff * Math.PI * 2;
    const phase2 = ((h0 >>> 24) & 0xff) / 0xff * Math.PI * 2;
    for (let i = 0; i < size; i++) {
      const t = i / (size - 1);
      // Two overlapping sine waves create a flowing, non-repeating shape.
      let v = Math.sin(t * Math.PI * 2 * freq1 + phase1) * 0.6
            + Math.sin(t * Math.PI * 2 * freq2 + phase2) * 0.4;
      // Small hash perturbation per pixel — organic micro-variation.
      const h = _tileHash(seed + side * 999331, i, 0);
      v += ((h & 3) - 1.5) * 0.15;
      // Map [-1, 1] → [0, maxDepth].
      arr[i] = Math.max(0, Math.min(maxDepth, Math.round((v + 1) * 0.5 * (maxDepth + 1))));
    }
    return arr;
  }

  function drawEdge(ox, oy, stepX, stepY, pushX, pushY, depths) {
    for (let i = 0; i < size; i++) {
      const px = ox + stepX * i;
      const py = oy + stepY * i;
      const d = depths[i];
      if (transparent) {
        // Edge pixel cleared — underlying canvas shows through.
        ctx.clearRect(px, py, 1, 1);
        for (let k = 1; k < d; k++) {
          ctx.clearRect(px + pushX * k, py + pushY * k, 1, 1);
        }
      } else {
        // Painted edge pixel: rim at the boundary, optional `light`
        // inner band one pixel deeper.
        ctx.fillStyle = rim;
        ctx.fillRect(px, py, 1, 1);
        for (let k = 1; k < d; k++) {
          const tx = px + pushX * k;
          const ty = py + pushY * k;
          ctx.fillStyle = k === d - 1 ? light : rim;
          ctx.fillRect(tx, ty, 1, 1);
        }
      }
    }
  }

  const maxD = 3;
  if (!(mask & NEIGHBOR_N)) drawEdge(x,         y,               1, 0,  0,  1, waveProfile(0, maxD));
  if (!(mask & NEIGHBOR_S)) drawEdge(x,         y + size - 1,    1, 0,  0, -1, waveProfile(2, maxD));
  if (!(mask & NEIGHBOR_W)) drawEdge(x,         y,               0, 1,  1,  0, waveProfile(3, maxD));
  if (!(mask & NEIGHBOR_E)) drawEdge(x + size - 1, y,            0, 1, -1,  0, waveProfile(1, maxD));
}

// Build an autotile set — bakes 16 sprites (one per 4-bit mask). Each
// is `drawBase(ctx, size)` plus `drawEdges(ctx, size, mask)`.
//
// Returns:
//   .get(mask)               → cached HTMLCanvasElement for that mask
//   .blit(ctx, dx, dy, mask)  → drawImage shortcut
//   .stamp(ctx, grid, sameFn, opts) → render a whole grid at (ox, oy)
//   .size                    → tile size in px
export function makeAutotile({ size = 16, drawBase, drawEdges }) {
  if (typeof drawBase  !== 'function') throw new Error('makeAutotile: drawBase required');
  if (typeof drawEdges !== 'function') throw new Error('makeAutotile: drawEdges required');
  let _base = null;
  function ensureBase() {
    if (_base) return _base;
    _base = document.createElement('canvas');
    _base.width = size; _base.height = size;
    const sctx = _base.getContext('2d');
    sctx.imageSmoothingEnabled = false;
    drawBase(sctx, size);
    return _base;
  }
  const sprites = new Array(16).fill(null);
  function get(mask) {
    mask = mask & 0xf;
    if (sprites[mask]) return sprites[mask];
    const c = document.createElement('canvas');
    c.width = size; c.height = size;
    const sctx = c.getContext('2d');
    sctx.imageSmoothingEnabled = false;
    sctx.drawImage(ensureBase(), 0, 0);
    drawEdges(sctx, size, mask);
    sprites[mask] = c;
    return c;
  }
  function blit(ctx, dx, dy, mask) { ctx.drawImage(get(mask), dx, dy); }
  function stamp(ctx, grid, sameFn, opts = {}) {
    const tileSize = opts.tileSize != null ? opts.tileSize : size;
    const ox = opts.x != null ? opts.x : 0;
    const oy = opts.y != null ? opts.y : 0;
    const w = grid[0].length, h = grid.length;
    for (let gy = 0; gy < h; gy++) {
      for (let gx = 0; gx < w; gx++) {
        if (!sameFn(gx, gy)) continue;
        const mask = neighborMask4(sameFn, gx, gy);
        ctx.drawImage(get(mask), ox + gx * tileSize, oy + gy * tileSize);
      }
    }
  }
  return { get, blit, stamp, size };
}

// Convenience — make a tile that auto-borders itself with a 1-px edge
// + optional inner chamfer. drawBase paints the body; the outline +
// chamfer are derived from the mask.
export function makeBorderedAutotile({
  size = 16, drawBase, edgeColor, chamferColor, blob = false,
}) {
  return makeAutotile({
    size,
    drawBase,
    drawEdges(ctx, sz, mask) {
      tileEdgeOverlay(ctx, 0, 0, sz, mask, { edge: edgeColor });
      if (blob && chamferColor) {
        tileCornerChamfer(ctx, 0, 0, sz, mask, { chamfer: chamferColor });
      }
    },
  });
}

// "Solid" autotile — explicit alias for makeBorderedAutotile. Crisp
// 1-px borders, hard 90° corners, optional chamfer fill. Use for
// hardware, dungeon walls, sci-fi tile sets, anything man-made.
//
//   { size, drawBase, edgeColor, chamferColor?, blob? }
export function makeSolidAutotile(opts) {
  return makeBorderedAutotile(opts);
}

// "Nature" autotile — ragged organic borders with deterministic 1–2 px
// bumps inward, plus inside-corner curls. Use for grass, dirt, moss,
// foliage, water-meets-shore, anything organic.
//
//   { size, drawBase, rimColor, lightColor?, seed?, transparentEdges? }
//     rimColor         — outer dark border (e.g., dark brown for grass).
//                        Ignored when transparentEdges is true.
//     lightColor       — slightly darker still, paints the inner-deeper
//                        layer.  Defaults to rimColor.
//     seed             — integer for deterministic bump placement
//     transparentEdges — if true, the ragged bumps CLEAR the tile
//                        sprite instead of painting rim/light over it.
//                        Pair with painting another tile underneath
//                        the stamp so the cleared bumps show that tile
//                        through — no dark border.
export function makeNatureAutotile({
  size = 16, drawBase, rimColor, lightColor, seed = 0,
  transparentEdges = false,
}) {
  return makeAutotile({
    size,
    drawBase,
    drawEdges(ctx, sz, mask) {
      tileNatureEdgeOverlay(ctx, 0, 0, sz, mask,
        { rim: rimColor, light: lightColor || rimColor },
        { seed: seed ^ mask, transparentEdges });
    },
  });
}

// ─── 13. Top-down 3/4 character generator ─────────────────────────
// Produces a baked canvas of a 3/4-perspective top-down character —
// the classic Slynyrd-style RPG sprite. Three conventional sizes +
// four facing directions:
//   - 'down'  (front view, default — face + chest visible)
//   - 'up'    (back view — hair covers head, no face features)
//   - 'right' (side profile — single eye, one arm visible)
//   - 'left'  (mirror of right via horizontal flip)
//
//   opts.size       — '1x1' | '1x2' | '2x2'      (default '1x2')
//   opts.direction  — 'down' | 'up' | 'left' | 'right' (default 'down')
//   opts.skin       — base skin hex             (default '#f0c0a0')
//   opts.skinShade  — skin shadow hex           (auto from skin)
//   opts.hair       — hair color hex            (default '#a02030')
//   opts.hairShade  — hair shadow hex           (auto)
//   opts.hairStyle  — 'short' | 'long' | 'bun' | 'mohawk' | 'bald'
//   opts.shirt      — shirt hex (null = bare)   (default null)
//   opts.shirtShade — shirt shadow hex          (auto)
//   opts.pants      — pants/shorts hex          (default '#5a2030')
//   opts.pantsShade — pants shadow hex          (auto)
//   opts.eyes       — eye dot color             (default '#2a0a04')
//   opts.outline    — silhouette outline color  (default '#3a1a04')
//   opts.shadow     — draw ground shadow        (default true)
//
// Returns an HTMLCanvasElement of the chosen size.
export function generateTopDownCharacter(opts = {}) {
  const size = opts.size || '1x2';
  const direction = opts.direction || 'down';
  // Left = horizontal flip of right.
  if (direction === 'left') {
    const right = generateTopDownCharacter({ ...opts, direction: 'right' });
    return _flipHorizontalCanvas(right);
  }
  const W = (size === '2x2') ? 32 : 16;
  const H = (size === '1x1') ? 16 : ((size === '2x2') ? 32 : 32);
  const skin       = opts.skin       || '#f0c0a0';
  const skinShade  = opts.skinShade  || _shade(skin, 0.32);
  const hair       = opts.hair       || '#a02030';
  const hairShade  = opts.hairShade  || _shade(hair, 0.4);
  const hairStyle  = opts.hairStyle  || 'short';
  const shirt      = opts.shirt      != null ? opts.shirt : null;
  const shirtShade = shirt ? (opts.shirtShade || _shade(shirt, 0.35)) : null;
  const pants      = opts.pants      || '#5a2030';
  const pantsShade = opts.pantsShade || _shade(pants, 0.4);
  const eyes       = opts.eyes       || '#2a0a04';
  const outline    = opts.outline    || '#3a1a04';
  const drawShadow = opts.shadow !== false;
  // arms === false skips the baked arm/fist/sleeve pixels entirely.
  // Use this when you plan to drive arms with an external rig (e.g. IK).
  // Currently honored by the '1x2 down' branch (the default view).
  const drawArms   = opts.arms !== false;

  const c = document.createElement('canvas');
  c.width = W; c.height = H;
  const ctx = c.getContext('2d');
  ctx.imageSmoothingEnabled = false;

  const params = {
    skin, skinShade, hair, hairShade, hairStyle, shirt, shirtShade,
    pants, pantsShade, eyes, outline, drawShadow, drawArms,
  };
  if (size === '1x1') return _bakeChibiChar(ctx, params, c);
  if (size === '2x2') return _bakeBigChar(ctx, params, c);
  // 1x2 — direction-specific bake.
  if (direction === 'up')    return _bakeStandardCharUp(ctx,    params, c);
  if (direction === 'right') return _bakeStandardCharSide(ctx,  params, c);
  return _bakeStandardChar(ctx, params, c);     // 'down'
}

// Internal — return a horizontally-flipped copy of a canvas.
function _flipHorizontalCanvas(src) {
  const c = document.createElement('canvas');
  c.width = src.width; c.height = src.height;
  const ctx = c.getContext('2d');
  ctx.imageSmoothingEnabled = false;
  ctx.translate(c.width, 0);
  ctx.scale(-1, 1);
  ctx.drawImage(src, 0, 0);
  return c;
}

// Internal — darken a hex by `t` fraction toward black.
function _shade(hex, t) {
  const r = parseInt(hex.slice(1, 3), 16);
  const g = parseInt(hex.slice(3, 5), 16);
  const b = parseInt(hex.slice(5, 7), 16);
  const h = (n) => Math.max(0, Math.min(255, Math.round(n * (1 - t))))
                     .toString(16).padStart(2, '0');
  return '#' + h(r) + h(g) + h(b);
}

// Standard 1×2 (16×32) character — Slynyrd-style 3/4 top-down.
// Build order:
//   1. Pear-shaped torso (wide shoulders → narrow waist).
//   2. Arms hanging at the sides w/ hands at hip level.
//   3. Round head + neck on top.
//   4. Hair cap + tall hair tuft (iconic feature).
//   5. Skin shading: left-side shadow + arm/torso seam + chest band.
//   6. Eyes — single dark pixels.
//   7. Short-shorts on upper thighs only.
//   8. Optional shirt + sleeves.
//   9. Outline pass + ground shadow.
function _bakeStandardChar(ctx, p, canvas) {
  // ─── Head (rounded, 8 wide max × 8 tall) ───
  ctx.fillStyle = p.skin;
  ctx.fillRect(6, 3, 4, 1);            // top thin (4 wide)
  ctx.fillRect(5, 4, 6, 1);            // (6 wide)
  ctx.fillRect(4, 5, 8, 4);            // main (8 wide × 4 tall)
  ctx.fillRect(5, 9, 6, 1);            // (6 wide)
  ctx.fillRect(6, 10, 4, 1);           // chin (4 wide)
  ctx.fillRect(6, 11, 4, 1);           // neck
  ctx.fillRect(6, 12, 4, 1);           // neck → shoulders
  // ─── Shoulders (solid 8-wide, full-width row 13-14) ───
  // The shoulders flare wider than the torso — arms attach here. This
  // 2-row solid block becomes the "shoulder cap" when you read the
  // silhouette top-down.
  ctx.fillRect(4, 13, 8, 2);
  if (p.drawArms) {
    // Arm tops extending beyond shoulders — 1 px on each side.
    ctx.fillRect(3, 13, 1, 2);           // left arm shoulder
    ctx.fillRect(12, 13, 1, 2);          // right arm shoulder
  }
  // ─── Below shoulders: torso narrows + GAP between arm + torso ───
  // Torso 6 wide (cols 5-10), arms at col 3 (L) and col 12 (R),
  // GAP at cols 4 and 11. The transparent column is what makes the
  // arms read as separate limbs.
  ctx.fillRect(5, 15, 6, 5);           // torso (rows 15-19, 6 wide)
  if (p.drawArms) {
    ctx.fillRect(3, 15, 1, 4);           // left arm (rows 15-18)
    ctx.fillRect(12, 15, 1, 4);          // right arm
    // Hands — 2-px wide fists hanging outward at hip level (rows 19-20).
    ctx.fillRect(2, 19, 2, 2);           // left fist (extends col 2-3)
    ctx.fillRect(12, 19, 2, 2);          // right fist (cols 12-13)
  }
  // ─── Hip (solid 6 wide cols 5-10, rows 20-22) ───
  ctx.fillRect(5, 20, 6, 3);
  // ─── Legs split with GAP at cols 7-8 ───
  ctx.fillRect(5, 23, 2, 5);           // left leg cols 5-6
  ctx.fillRect(9, 23, 2, 5);           // right leg cols 9-10
  // ─── Hair cap + tuft ───
  _drawHair(ctx, 4, 2, 8, 8, p.hair, p.hairShade, p.hairStyle, '1x2');
  // ─── Skin shading (3/4 perspective, light from upper-right) ───
  ctx.fillStyle = p.skinShade;
  // Left edge of face — 1-px shadow stripe.
  ctx.fillRect(4, 5, 1, 4);
  // Cheek/jaw shadow — gives the face structure under the eyes.
  ctx.fillRect(5, 9, 1, 1);
  ctx.fillRect(10, 9, 1, 1);
  if (p.drawArms) {
    // Left shoulder cap shaded.
    ctx.fillRect(3, 13, 1, 2);
    // Left arm shaded entirely.
    ctx.fillRect(3, 15, 1, 4);
    // Left fist shaded.
    ctx.fillRect(2, 19, 1, 2);
  }
  // Left edge of torso — slight shadow under the left shoulder.
  ctx.fillRect(5, 15, 1, 5);
  // Horizontal chest shading band — gives torso its volume.
  ctx.fillRect(5, 17, 6, 1);
  // Pectoral muscle hint.
  ctx.fillRect(6, 16, 1, 1);
  ctx.fillRect(9, 16, 1, 1);
  // Left hip shaded.
  ctx.fillRect(5, 20, 1, 3);
  // Inner-leg shadow (1-px stripe on the gap-side of each leg).
  ctx.fillRect(6, 23, 1, 5);           // right side of left leg
  ctx.fillRect(9, 23, 1, 5);           // left side of right leg
  // ─── Eyes (1-px dots, close together) ───
  ctx.fillStyle = p.eyes;
  ctx.fillRect(6, 8, 1, 1);
  ctx.fillRect(9, 8, 1, 1);
  // ─── Shorts (cover hips + upper thighs only) ───
  // Match the body silhouette — hip is 6 wide (cols 5-10), legs 2 wide.
  ctx.fillStyle = p.pants;
  ctx.fillRect(5, 20, 6, 3);           // hip waistband (matches hip)
  ctx.fillRect(5, 23, 2, 2);           // upper thigh L
  ctx.fillRect(9, 23, 2, 2);           // upper thigh R
  ctx.fillStyle = p.pantsShade;
  ctx.fillRect(5, 22, 6, 1);           // hem shadow
  ctx.fillRect(5, 23, 1, 2);
  ctx.fillRect(9, 23, 1, 2);
  // Belt line — 1 px darker line at the top of the shorts.
  ctx.fillStyle = p.outline;
  ctx.fillRect(5, 20, 6, 1);
  // ─── Feet (shoe blocks at the bottom of each leg) ───
  ctx.fillStyle = p.outline;
  ctx.fillRect(4, 28, 3, 1);           // left shoe (overhang outward)
  ctx.fillRect(9, 28, 3, 1);           // right shoe
  // ─── Shirt (optional) — matches torso silhouette WITH gaps ───
  if (p.shirt) {
    ctx.fillStyle = p.shirt;
    // Shoulder cap (full 8 wide).
    ctx.fillRect(4, 13, 8, 2);
    // Torso below shoulders (narrower, with gaps to arms).
    ctx.fillRect(5, 15, 6, 5);
    if (p.drawArms) {
      // Sleeves — covering the upper arms (rows 13-16, including
      // shoulder cap + a couple rows below).
      ctx.fillRect(3, 13, 1, 4);
      ctx.fillRect(12, 13, 1, 4);
    }
    ctx.fillStyle = p.shirtShade;
    if (p.drawArms) ctx.fillRect(3, 13, 1, 4);  // left sleeve shade
    ctx.fillRect(5, 15, 1, 5);                  // left torso shade
    ctx.fillRect(5, 19, 6, 1);                  // hem shadow
    // Collar dent.
    ctx.fillStyle = p.outline;
    ctx.fillRect(7, 13, 2, 1);
  }
  // ─── Outline pass ───
  outlinePass(canvas, p.outline);
  // ─── Ground shadow (oval under feet) ───
  if (p.drawShadow) {
    ctx.fillStyle = 'rgba(0,0,0,0.35)';
    ctx.fillRect(4, 30, 8, 1);
    ctx.fillRect(5, 31, 6, 1);
  }
  return canvas;
}

// Standard 1×2 BACK view — facing away from camera.
// Same body silhouette as down view, but the hair covers the whole
// head (no face features) and the chest band shading is gone (the
// back is smoother). A center spine line gives the back its volume.
function _bakeStandardCharUp(ctx, p, canvas) {
  // ─── Same body silhouette as down view ───
  ctx.fillStyle = p.skin;
  ctx.fillRect(6, 3, 4, 1);
  ctx.fillRect(5, 4, 6, 1);
  ctx.fillRect(4, 5, 8, 4);
  ctx.fillRect(5, 9, 6, 1);
  ctx.fillRect(6, 10, 4, 1);
  ctx.fillRect(6, 11, 4, 1);
  ctx.fillRect(6, 12, 4, 1);
  ctx.fillRect(4, 13, 8, 2);
  if (p.drawArms) {
    ctx.fillRect(3, 13, 1, 2);
    ctx.fillRect(12, 13, 1, 2);
  }
  ctx.fillRect(5, 15, 6, 5);
  if (p.drawArms) {
    ctx.fillRect(3, 15, 1, 4);
    ctx.fillRect(12, 15, 1, 4);
    ctx.fillRect(2, 19, 2, 2);
    ctx.fillRect(12, 19, 2, 2);
  }
  ctx.fillRect(5, 20, 6, 3);
  ctx.fillRect(5, 23, 2, 5);
  ctx.fillRect(9, 23, 2, 5);
  // ─── Hair COVERS the entire head (back-of-head view) ───
  ctx.fillStyle = p.hair;
  // Tuft on top — straight up, slightly leaned to the right (matching
  // the asymmetric reference image).
  ctx.fillRect(8, 0, 1, 1);
  ctx.fillRect(7, 1, 2, 1);
  ctx.fillRect(7, 2, 2, 1);
  // Cover the entire head silhouette.
  ctx.fillRect(6, 3, 4, 1);
  ctx.fillRect(5, 4, 6, 1);
  ctx.fillRect(4, 5, 8, 4);
  ctx.fillRect(5, 9, 6, 1);
  // Hair extends to the chin row too (back of head + neck nape).
  ctx.fillRect(6, 10, 4, 1);
  // Hair shading on the left side (3/4 perspective).
  ctx.fillStyle = p.hairShade;
  ctx.fillRect(4, 5, 1, 4);
  ctx.fillRect(7, 1, 1, 1);            // tuft left side
  ctx.fillRect(5, 9, 6, 1);            // 1-px shadow at the bottom of the cap
  // ─── Skin shading (back) ───
  ctx.fillStyle = p.skinShade;
  // Spine line — vertical 1-px stripe down the center back.
  ctx.fillRect(7, 16, 1, 4);
  if (p.drawArms) {
    // Left arm + body shadow.
    ctx.fillRect(3, 13, 1, 2);
    ctx.fillRect(3, 15, 1, 4);
    ctx.fillRect(2, 19, 1, 2);
  }
  // Left edge of torso.
  ctx.fillRect(5, 15, 1, 5);
  // Left hip shadow.
  ctx.fillRect(5, 20, 1, 3);
  // Inside-leg shadows.
  ctx.fillRect(6, 23, 1, 5);
  ctx.fillRect(9, 23, 1, 5);
  // ─── No eyes (back of head) ───
  // ─── Shorts ───
  ctx.fillStyle = p.pants;
  ctx.fillRect(5, 20, 6, 3);
  ctx.fillRect(5, 23, 2, 2);
  ctx.fillRect(9, 23, 2, 2);
  ctx.fillStyle = p.pantsShade;
  ctx.fillRect(5, 22, 6, 1);
  ctx.fillRect(5, 23, 1, 2);
  ctx.fillRect(9, 23, 1, 2);
  ctx.fillStyle = p.outline;
  ctx.fillRect(5, 20, 6, 1);
  // ─── Feet ───
  ctx.fillStyle = p.outline;
  ctx.fillRect(4, 28, 3, 1);
  ctx.fillRect(9, 28, 3, 1);
  // ─── Shirt (no collar dent — back view shows the back of the neck) ───
  if (p.shirt) {
    ctx.fillStyle = p.shirt;
    ctx.fillRect(4, 13, 8, 2);
    ctx.fillRect(5, 15, 6, 5);
    if (p.drawArms) {
      ctx.fillRect(3, 13, 1, 4);
      ctx.fillRect(12, 13, 1, 4);
    }
    ctx.fillStyle = p.shirtShade;
    if (p.drawArms) ctx.fillRect(3, 13, 1, 4);
    ctx.fillRect(5, 15, 1, 5);
    ctx.fillRect(5, 19, 6, 1);
    // Spine of shirt — 1-px shadow stripe down the center.
    ctx.fillRect(7, 16, 1, 4);
  }
  outlinePass(canvas, p.outline);
  if (p.drawShadow) {
    ctx.fillStyle = 'rgba(0,0,0,0.35)';
    ctx.fillRect(4, 30, 8, 1);
    ctx.fillRect(5, 31, 6, 1);
  }
  return canvas;
}

// Standard 1×2 SIDE view — facing right.
// Profile: head + body narrower (~5 wide) with a slight forward
// "nose" bump on the right side. Hair covers the back + top of the
// head. One eye visible. One arm in front of the body. Two legs
// slightly offset to suggest depth.
function _bakeStandardCharSide(ctx, p, canvas) {
  // ─── Head profile (cols 5-10, with a 1-px nose bump on right) ───
  ctx.fillStyle = p.skin;
  ctx.fillRect(6, 3, 4, 1);            // top
  ctx.fillRect(5, 4, 6, 1);
  ctx.fillRect(5, 5, 6, 4);            // main head
  ctx.fillRect(11, 6, 1, 2);           // nose bump (forward)
  ctx.fillRect(5, 9, 6, 1);
  ctx.fillRect(6, 10, 4, 1);           // chin
  ctx.fillRect(7, 11, 3, 1);           // neck
  ctx.fillRect(7, 12, 3, 1);
  // ─── Body profile + ARM BUMP forward ───
  // Torso is 5 wide (cols 5-9). The arm bumps OUT to col 10 from the
  // shoulder down to the hip, giving the silhouette a clear protrusion
  // that reads as "arm in front of chest." Without this bump, the arm
  // melts into the torso silhouette.
  ctx.fillRect(5, 13, 5, 2);           // shoulder cap (cols 5-9)
  ctx.fillRect(5, 15, 5, 5);           // torso (cols 5-9)
  if (p.drawArms) {
    ctx.fillRect(9, 13, 1, 1);         // shoulder peak (drops to arm)
    ctx.fillRect(9, 15, 1, 4);         // arm (col 9, in front of body)
    ctx.fillRect(10, 15, 1, 4);        // arm front (col 10, the bump)
    ctx.fillRect(9, 19, 3, 2);         // hand/fist (cols 9-11)
  }
  ctx.fillRect(5, 20, 5, 3);           // hip
  // ─── Legs — slightly offset to suggest stride/depth ───
  ctx.fillRect(5, 23, 2, 5);           // back leg (cols 5-6)
  ctx.fillRect(8, 23, 2, 5);           // front leg (cols 8-9, offset forward)
  // ─── Hair: covers back + top of head, leans forward on the tuft ───
  ctx.fillStyle = p.hair;
  // Tuft — forward-leaning (toward facing direction).
  ctx.fillRect(8, 0, 1, 1);
  ctx.fillRect(8, 1, 2, 1);
  ctx.fillRect(7, 2, 2, 1);
  // Cap covering top + back of head.
  ctx.fillRect(6, 3, 4, 1);
  ctx.fillRect(5, 4, 6, 1);
  ctx.fillRect(5, 5, 4, 3);            // back-of-head (cols 5-8)
  ctx.fillRect(5, 8, 5, 1);
  // Sideburn at jawline.
  ctx.fillRect(5, 9, 1, 1);
  // Hair shading.
  ctx.fillStyle = p.hairShade;
  ctx.fillRect(5, 5, 1, 3);
  ctx.fillRect(5, 8, 5, 1);
  // ─── Skin shading ───
  ctx.fillStyle = p.skinShade;
  // Cheek under eye + jawline.
  ctx.fillRect(10, 8, 1, 2);
  // Back of body — left edge in shadow.
  ctx.fillRect(5, 13, 1, 7);
  ctx.fillRect(5, 20, 1, 3);
  if (p.drawArms) {
    // Arm/torso seam — 1-px shadow stripe so the arm reads as a
    // separate limb in front of the chest rather than melting into it.
    ctx.fillRect(8, 15, 1, 4);
    // Front edge of arm slightly shaded.
    ctx.fillRect(10, 18, 1, 1);
    // Hand back-edge shadow.
    ctx.fillRect(9, 19, 1, 2);
  }
  // Inner side of back leg (the side facing front leg).
  ctx.fillRect(6, 23, 1, 5);
  // Back side of front leg (facing back leg).
  ctx.fillRect(8, 23, 1, 5);
  // ─── Eye — single dark pixel on the front-facing side ───
  ctx.fillStyle = p.eyes;
  ctx.fillRect(10, 7, 1, 1);
  // ─── Shorts (match hip + leg silhouette) ───
  ctx.fillStyle = p.pants;
  ctx.fillRect(5, 20, 5, 3);           // hip waistband
  ctx.fillRect(5, 23, 2, 2);           // back leg shorts
  ctx.fillRect(8, 23, 2, 2);           // front leg shorts
  ctx.fillStyle = p.pantsShade;
  ctx.fillRect(5, 22, 5, 1);
  ctx.fillRect(5, 23, 1, 2);
  ctx.fillRect(8, 23, 1, 2);
  ctx.fillStyle = p.outline;
  ctx.fillRect(5, 20, 5, 1);           // belt line
  // ─── Feet (one in front of the other) ───
  ctx.fillStyle = p.outline;
  ctx.fillRect(4, 28, 3, 1);           // back foot
  ctx.fillRect(7, 28, 3, 1);           // front foot
  // ─── Shirt — covers torso + arm bump ───
  if (p.shirt) {
    ctx.fillStyle = p.shirt;
    ctx.fillRect(5, 13, 5, 7);            // torso (cols 5-9)
    if (p.drawArms) {
      ctx.fillRect(9, 13, 1, 1);          // shoulder peak
      // Sleeve over the front arm.
      ctx.fillRect(9, 15, 1, 4);
      ctx.fillRect(10, 15, 1, 4);
    }
    ctx.fillStyle = p.shirtShade;
    ctx.fillRect(5, 13, 1, 7);            // back edge shadow
    ctx.fillRect(5, 19, 5, 1);            // hem shadow
    if (p.drawArms) ctx.fillRect(8, 15, 1, 4);  // arm/sleeve seam
  }
  outlinePass(canvas, p.outline);
  if (p.drawShadow) {
    ctx.fillStyle = 'rgba(0,0,0,0.35)';
    ctx.fillRect(4, 30, 8, 1);
    ctx.fillRect(5, 31, 6, 1);
  }
  return canvas;
}

// Chibi 1×1 (16×16) character — head dominant, compact pear body.
function _bakeChibiChar(ctx, p, canvas) {
  // ─── Big rounded head ───
  ctx.fillStyle = p.skin;
  ctx.fillRect(5, 2, 6, 1);            // top
  ctx.fillRect(4, 3, 8, 5);            // main head
  ctx.fillRect(5, 8, 6, 1);            // chin
  // ─── Shoulders (solid 6 wide cols 5-10) ───
  ctx.fillRect(5, 9, 6, 1);
  // ─── Below shoulders: torso 4 wide + arms separate (gap at cols 5, 10) ───
  ctx.fillRect(6, 10, 4, 2);           // torso (rows 10-11, 4 wide cols 6-9)
  ctx.fillRect(4, 10, 1, 1);           // left arm (top)
  ctx.fillRect(11, 10, 1, 1);          // right arm (top)
  // Hands — 2-px wide fists at hip level (row 11).
  ctx.fillRect(3, 11, 2, 1);           // left fist (extends out)
  ctx.fillRect(11, 11, 2, 1);          // right fist
  // ─── Hip (rows 12, 4 wide cols 6-9) ───
  ctx.fillRect(6, 12, 4, 1);
  // ─── Legs split with gap at col 8 ───
  ctx.fillRect(6, 13, 2, 2);           // left leg cols 6-7
  ctx.fillRect(9, 13, 2, 2);           // right leg cols 9-10
  // ─── Hair ───
  _drawHair(ctx, 4, 1, 8, 7, p.hair, p.hairShade, p.hairStyle, '1x1');
  // ─── Skin shading ───
  ctx.fillStyle = p.skinShade;
  // Left side of face.
  ctx.fillRect(4, 4, 1, 4);
  // Cheek shadow.
  ctx.fillRect(5, 8, 1, 1);
  // Left arm + fist shaded (light from upper-right).
  ctx.fillRect(4, 10, 1, 1);
  ctx.fillRect(3, 11, 1, 1);
  // Left torso edge.
  ctx.fillRect(6, 10, 1, 2);
  // Left hip edge.
  ctx.fillRect(6, 12, 1, 1);
  // Inside-leg shadow.
  ctx.fillRect(7, 13, 1, 2);           // right side of left leg
  ctx.fillRect(9, 13, 1, 2);           // left side of right leg
  // ─── Eyes ───
  ctx.fillStyle = p.eyes;
  ctx.fillRect(6, 6, 1, 1);
  ctx.fillRect(9, 6, 1, 1);
  // ─── Shorts (cover hip + upper thighs) ───
  ctx.fillStyle = p.pants;
  ctx.fillRect(6, 12, 4, 1);           // hip waistband
  ctx.fillRect(6, 13, 2, 1);           // upper thigh L
  ctx.fillRect(9, 13, 2, 1);           // upper thigh R
  ctx.fillStyle = p.outline;
  ctx.fillRect(6, 12, 4, 1);           // belt line
  // ─── Feet ───
  ctx.fillStyle = p.outline;
  ctx.fillRect(5, 15, 3, 1);
  ctx.fillRect(8, 15, 3, 1);
  // ─── Optional shirt ───
  if (p.shirt) {
    ctx.fillStyle = p.shirt;
    ctx.fillRect(5, 9, 6, 1);            // shoulder cap
    ctx.fillRect(6, 10, 4, 2);           // torso
    ctx.fillRect(4, 10, 1, 1);           // left sleeve
    ctx.fillRect(11, 10, 1, 1);          // right sleeve
    ctx.fillStyle = p.shirtShade;
    ctx.fillRect(6, 11, 4, 1);           // hem
    ctx.fillRect(6, 10, 1, 2);           // left shade
  }
  outlinePass(canvas, p.outline);
  if (p.drawShadow) {
    ctx.fillStyle = 'rgba(0,0,0,0.35)';
    ctx.fillRect(5, 15, 6, 1);
  }
  return canvas;
}

// Big 2×2 (32×32) character — bulky pear-shape with arms hanging at
// the sides (hands at hip level).
function _bakeBigChar(ctx, p, canvas) {
  ctx.fillStyle = p.skin;
  // ─── Shoulder cap (solid 12 wide) ───
  ctx.fillRect(10, 13, 12, 3);
  // Arm shoulder caps (extend 2 px each side).
  ctx.fillRect(8, 13, 2, 3);            // left arm shoulder
  ctx.fillRect(22, 13, 2, 3);           // right arm shoulder
  // ─── Below shoulders: torso narrows + GAP between arms + torso ───
  // Torso 8 wide (cols 11-18 → wait that's 8). Let me center: cols 12-19 (8 wide).
  // Actually for symmetry: torso at cols 12-19 (8 wide), arms at cols 8-9 and 22-23,
  // gaps at cols 10-11 and 20-21.
  ctx.fillRect(12, 16, 8, 6);           // torso (rows 16-21, 8 wide)
  ctx.fillRect(8, 16, 2, 6);            // left arm (rows 16-21)
  ctx.fillRect(22, 16, 2, 6);           // right arm
  // Hands — 3-wide fists at hip level (rows 22-23), extending outward.
  ctx.fillRect(7, 22, 3, 2);            // left fist (cols 7-9)
  ctx.fillRect(22, 22, 3, 2);           // right fist (cols 22-24)
  // ─── Hip (rows 22-24, 8 wide) ───
  ctx.fillRect(12, 22, 8, 3);
  // ─── Legs split with GAP at cols 15-16 ───
  ctx.fillRect(12, 25, 3, 6);           // left leg cols 12-14
  ctx.fillRect(17, 25, 3, 6);           // right leg cols 17-19
  // ─── Head — 10 wide × 8 tall on top ───
  ctx.fillRect(12, 3, 8, 1);
  ctx.fillRect(11, 4, 10, 7);
  ctx.fillRect(12, 11, 8, 1);
  ctx.fillRect(13, 12, 6, 1);          // neck
  // ─── Hair ───
  _drawHair(ctx, 11, 1, 10, 9, p.hair, p.hairShade, p.hairStyle, '2x2');
  // ─── Skin shading ───
  ctx.fillStyle = p.skinShade;
  // Left side of face shaded.
  ctx.fillRect(11, 5, 2, 6);
  // Left shoulder cap shaded.
  ctx.fillRect(8, 13, 2, 3);
  // Left arm shaded entirely (3/4 light from R).
  ctx.fillRect(8, 16, 2, 6);
  // Left fist shaded.
  ctx.fillRect(7, 22, 1, 2);
  // Left edge of torso.
  ctx.fillRect(12, 16, 1, 6);
  // Left edge of hip.
  ctx.fillRect(12, 22, 1, 3);
  // Inside of legs (gap-side of each).
  ctx.fillRect(14, 25, 1, 6);          // right side of left leg
  ctx.fillRect(17, 25, 1, 6);          // left side of right leg
  // Chest band — horizontal shading line.
  ctx.fillRect(12, 19, 8, 1);
  // Pectoral hint — 2 darker pixels.
  ctx.fillRect(13, 17, 1, 1);
  ctx.fillRect(18, 17, 1, 1);
  // ─── Eyes — slightly bigger on the 2×2 (1×2 px each) ───
  ctx.fillStyle = p.eyes;
  ctx.fillRect(13, 8, 1, 2);
  ctx.fillRect(18, 8, 1, 2);
  // Tiny mouth hint — 1 dark pixel.
  ctx.fillRect(15, 10, 1, 1);
  // ─── Shorts (cover hip + upper thighs) ───
  ctx.fillStyle = p.pants;
  ctx.fillRect(12, 22, 8, 3);          // hip waistband (8 wide, matches torso)
  ctx.fillRect(12, 25, 3, 2);          // upper thigh L
  ctx.fillRect(17, 25, 3, 2);          // upper thigh R
  ctx.fillStyle = p.pantsShade;
  ctx.fillRect(12, 24, 8, 1);           // hem shadow
  ctx.fillRect(12, 25, 1, 2);           // shorts left side
  ctx.fillRect(17, 25, 1, 2);
  // Belt line.
  ctx.fillStyle = p.outline;
  ctx.fillRect(12, 22, 8, 1);
  // ─── Feet (4-px wide shoe blocks) ───
  ctx.fillStyle = p.outline;
  ctx.fillRect(11, 30, 4, 1);
  ctx.fillRect(17, 30, 4, 1);
  // ─── Optional shirt — matches body silhouette WITH gaps ───
  if (p.shirt) {
    ctx.fillStyle = p.shirt;
    // Shoulder cap.
    ctx.fillRect(10, 13, 12, 3);
    // Torso below shoulders (8 wide, matches body).
    ctx.fillRect(12, 16, 8, 6);
    // Sleeves over upper arms (rows 13-18, 2 wide).
    ctx.fillRect(8, 13, 2, 6);
    ctx.fillRect(22, 13, 2, 6);
    ctx.fillStyle = p.shirtShade;
    ctx.fillRect(8, 13, 2, 6);            // left sleeve shade
    ctx.fillRect(12, 16, 1, 6);           // left torso shade
    ctx.fillRect(12, 21, 8, 1);           // hem shadow
  }
  outlinePass(canvas, p.outline);
  if (p.drawShadow) {
    ctx.fillStyle = 'rgba(0,0,0,0.35)';
    ctx.fillRect(10, 31, 12, 1);
  }
  return canvas;
}

// Hair drawer — covers the top of the head with a style-specific
// shape. `headRect` = (hx, hy, hw, hh) of the head silhouette.
// All styles include the iconic Slynyrd-style tall tuft sticking up
// from the center, except 'bald' (no hair) and 'long' (replaces tuft
// with hair flowing down).
function _drawHair(ctx, hx, hy, hw, hh, hair, hairShade, style, size) {
  if (style === 'bald') return;
  const cx = hx + Math.floor(hw / 2);  // center column
  const tuftCol = cx;                   // tuft is one column wide

  if (style === 'short') {
    // Cap — covers top of head + sides (sideburns).
    ctx.fillStyle = hair;
    // Tuft — distinctive spike. 3 px tall, 1-2 px wide at base, tapering.
    ctx.fillRect(tuftCol,     hy - 3, 1, 1);   // tip
    ctx.fillRect(tuftCol - 1, hy - 2, 2, 1);   // upper
    ctx.fillRect(tuftCol - 1, hy - 1, 2, 1);   // base of tuft
    // Hairline — across the top of the head.
    ctx.fillRect(hx + 1, hy,     hw - 2, 1);   // top row
    ctx.fillRect(hx,     hy + 1, hw,     2);   // main cap
    // Side bangs running down past temples.
    ctx.fillRect(hx,         hy + 3, 1, 2);
    ctx.fillRect(hx + hw - 1, hy + 3, 1, 2);
    // Forehead bangs — fringe poking onto forehead between the eyes.
    ctx.fillRect(hx + 2, hy + 3, 1, 1);
    ctx.fillRect(hx + hw - 3, hy + 3, 1, 1);
    // Asymmetric forehead bang — one extra pixel right-of-center for
    // hair "personality" instead of perfect symmetry.
    ctx.fillRect(hx + Math.floor(hw / 2), hy + 3, 1, 1);
    // ── Hair shading ──
    ctx.fillStyle = hairShade;
    // Left edge in shadow.
    ctx.fillRect(hx, hy + 1, 1, 4);
    // Forehead shadow — 1-px line along the bottom of the cap, gives
    // the hair depth and separates it from the face.
    ctx.fillRect(hx + 1, hy + 2, hw - 2, 1);
    // Tuft shadow — left side of the tuft is in shadow.
    ctx.fillRect(tuftCol - 1, hy - 2, 1, 1);
  } else if (style === 'long') {
    // Long flowing hair — covers head + extends onto shoulders.
    ctx.fillStyle = hair;
    ctx.fillRect(tuftCol, hy - 1, 1, 1);       // small top tuft
    ctx.fillRect(hx + 1, hy,     hw - 2, 1);
    ctx.fillRect(hx,     hy + 1, hw,     hh - 1);  // long mass extending
    // Side strands going down past chin.
    ctx.fillRect(hx, hy + hh, 1, 2);
    ctx.fillRect(hx + hw - 1, hy + hh, 1, 2);
    ctx.fillStyle = hairShade;
    ctx.fillRect(hx, hy + 1, 1, hh);
    ctx.fillRect(hx + hw - 1, hy + 1, 1, hh);
    ctx.fillRect(hx + 1, hy + hh - 1, hw - 2, 1);
  } else if (style === 'bun') {
    // Top-knot bun — round bun above the head + cap.
    ctx.fillStyle = hair;
    // Bun — 3×3 ball offset above the head.
    ctx.fillRect(cx - 1, hy - 3, 3, 1);
    ctx.fillRect(cx - 1, hy - 2, 3, 2);
    ctx.fillRect(cx,     hy - 1, 1, 1);        // pin holding bun
    // Cap on top of head.
    ctx.fillRect(hx + 1, hy,     hw - 2, 1);
    ctx.fillRect(hx,     hy + 1, hw,     2);
    ctx.fillRect(hx,     hy + 3, 1, 2);
    ctx.fillRect(hx + hw - 1, hy + 3, 1, 2);
    ctx.fillStyle = hairShade;
    ctx.fillRect(cx - 1, hy - 1, 1, 1);
    ctx.fillRect(hx, hy + 1, 1, 4);
  } else if (style === 'mohawk') {
    // Vertical strip from above the head down the center, bright.
    ctx.fillStyle = hair;
    ctx.fillRect(cx,     hy - 3, 1, 1);
    ctx.fillRect(cx - 1, hy - 2, 3, 1);
    ctx.fillRect(cx - 1, hy - 1, 3, 2);
    ctx.fillRect(cx - 1, hy + 1, 3, 2);
    // Side hair shaved (just a thin band of darker hair on sides).
    ctx.fillStyle = hairShade;
    ctx.fillRect(hx + 1, hy + 1, 1, 2);
    ctx.fillRect(hx + hw - 2, hy + 1, 1, 2);
  }
}

// Convenience — build a "party" of N random characters from a seed.
// Useful for quick test scenes / NPC populations. Returns array of
// canvases.
export function generateTopDownParty(count, opts = {}) {
  const seed = opts.seed != null ? opts.seed : 0;
  const skinTones = opts.skinTones || [
    '#f0c0a0', '#e8a880', '#c89060', '#a87050', '#806040',
  ];
  const hairColors = opts.hairColors || [
    '#3a1a04', '#a02030', '#604020', '#d0a040', '#202830', '#a04060',
  ];
  const shirtColors = opts.shirtColors || [
    '#5a8030', '#3a6080', '#806040', '#a04030', null, '#604070', '#80a040',
  ];
  const pantsColors = opts.pantsColors || [
    '#5a2030', '#2a4060', '#3a3030', '#604030', '#1a1a20',
  ];
  const styles = ['short', 'long', 'bun', 'mohawk', 'bald'];
  const sizes = opts.sizes || ['1x2'];
  const out = [];
  for (let i = 0; i < count; i++) {
    const h = _tileHash(seed, i, 0);
    out.push(generateTopDownCharacter({
      size:      sizes[(h >>> 0) % sizes.length],
      skin:      skinTones[(h >>> 4)  % skinTones.length],
      hair:      hairColors[(h >>> 8)  % hairColors.length],
      hairStyle: styles[(h >>> 12) % styles.length],
      shirt:     shirtColors[(h >>> 16) % shirtColors.length],
      pants:     pantsColors[(h >>> 20) % pantsColors.length],
    }));
  }
  return out;
}

// Four-stop "metal panel" palette — shadow / body / hilite / seam.
// Seam is a darker desaturated body, useful for plank/door seams.
export function metalPalette(body, opts = {}) {
  const p = paletteFromBody(body, opts);
  // Seam = halfway between shadow and pure black.
  const r = parseInt(p.shadow.slice(1, 3), 16);
  const g = parseInt(p.shadow.slice(3, 5), 16);
  const b = parseInt(p.shadow.slice(5, 7), 16);
  const hex = (n) => Math.max(0, Math.min(255, Math.round(n)))
                       .toString(16).padStart(2, '0');
  p.seam = '#' + hex(r * 0.6) + hex(g * 0.6) + hex(b * 0.6);
  return p;
}

// ──────────────────────────────────────────────────────────────────────
// §28. Extended UI / HUD vocabulary — promoted from inline patterns
// in canvas7. Each one factors out a hand-rolled shape that recurred
// across demos. All are state-pure: pass current values, get a frame.
// ──────────────────────────────────────────────────────────────────────

// Drop zone — dashed-border drop target for drag-and-drop UIs.
// Replaces the inline `strokeRect` + label pattern used for trash
// zones, equip slots, drag-to-delete, etc. The hover state shifts
// border + label color; an optional `valid` flag tints to green/red
// to indicate whether a drop here is allowed.
//
//   palette: { border, borderHover, borderValid, borderInvalid,
//              bgHover, label, labelHover }
//   opts:    { label, hover=false, valid=null, dashed=true,
//              dashLen=3, gapLen=2 }
export function dropZone(ctx, x, y, w, h, palette, opts = {}) {
  const hover = !!opts.hover;
  const valid = opts.valid;     // null/undefined → neutral; true/false → tint
  const dashed = opts.dashed !== false;
  const dashLen = opts.dashLen != null ? opts.dashLen : 3;
  const gapLen  = opts.gapLen  != null ? opts.gapLen  : 2;
  const border = valid === false ? (palette.borderInvalid || '#a04050')
               : valid === true  ? (palette.borderValid   || '#3a8030')
               : hover           ? (palette.borderHover   || '#80c0ff')
               :                   (palette.border        || '#3a4458');
  const labelCol = hover ? (palette.labelHover || '#fff')
                         : (palette.label      || '#7a8aa0');
  // Hover bg fill — subtle transparent tint behind the border.
  if (hover && palette.bgHover) {
    ctx.fillStyle = palette.bgHover;
    ctx.fillRect(x + 1, y + 1, w - 2, h - 2);
  }
  // Border — dashed marching pattern OR solid 1px outline. The
  // dashed pattern can be animated via `opts.marchT` (0..1, typically
  // `(performance.now() / 250) % 1`) so the dashes scroll around the
  // perimeter — gives the zone a "live drop target" feel during a
  // drag, similar to the marching-ants selection in graphics editors.
  ctx.fillStyle = border;
  if (dashed) {
    const period = dashLen + gapLen;
    const marchT = opts.marchT != null ? opts.marchT : 0;
    const phase = Math.round(marchT * period) % period;
    // Top + bottom edges — offset by phase so dashes shift right.
    for (let i = -period; i < w + period; i += period) {
      const start = i + phase;
      const lo = Math.max(0, start);
      const hi = Math.min(w, start + dashLen);
      if (hi > lo) {
        ctx.fillRect(x + lo, y, hi - lo, 1);
        ctx.fillRect(x + lo, y + h - 1, hi - lo, 1);
      }
    }
    // Left + right edges — offset OPPOSITE direction so the whole
    // border reads as marching clockwise around the rect.
    const phaseV = (period - phase) % period;
    for (let i = -period; i < h + period; i += period) {
      const start = i + phaseV;
      const lo = Math.max(0, start);
      const hi = Math.min(h, start + dashLen);
      if (hi > lo) {
        ctx.fillRect(x, y + lo, 1, hi - lo);
        ctx.fillRect(x + w - 1, y + lo, 1, hi - lo);
      }
    }
  } else {
    ctx.fillRect(x,           y,           w, 1);
    ctx.fillRect(x,           y + h - 1,   w, 1);
    ctx.fillRect(x,           y,           1, h);
    ctx.fillRect(x + w - 1,   y,           1, h);
  }
  // Centered label.
  if (opts.label) {
    const lw = opts.label.length * 4 - 1;
    pixelText(ctx, Math.round(x + (w - lw) / 2),
                   Math.round(y + (h - 5) / 2),
                   opts.label, { color: labelCol });
  }
}

// Segmented control — pill-shaped horizontal toggle cluster, smaller
// than `tabBar`. Active option gets the accent color; inactive sit
// in the body. Use for filter strips, view-mode togglers (LIST/GRID),
// and the slot variant cycler in canvas7's SLT tab.
//
//   palette: { bg, bgActive, frame, text, textActive }
//   opts:    { activeIdx=0, rounded=1, gap=0 }
export function segmentedControl(ctx, x, y, w, h, options, palette, opts = {}) {
  if (!options || options.length === 0) return;
  const activeIdx = opts.activeIdx != null ? opts.activeIdx : 0;
  const rounded = opts.rounded != null ? opts.rounded : 1;
  const gap = opts.gap | 0;
  const bg = palette.bg || '#1a2030';
  const bgActive = palette.bgActive || '#3a8efa';
  const frame = palette.frame || '#0a0e18';
  const text = palette.text || '#cfd8e4';
  const textActive = palette.textActive || '#fff';
  // Outer frame (pill).
  pxRoundedRectFilled(ctx, x, y, w, h, rounded, frame);
  pxRoundedRectFilled(ctx, x + 1, y + 1, w - 2, h - 2,
    Math.max(0, rounded - 1), bg);
  // Per-segment.
  const segW = (w - gap * (options.length - 1)) / options.length;
  for (let i = 0; i < options.length; i++) {
    const sx = Math.round(x + i * (segW + gap));
    const sw = Math.round(segW);
    const isActive = i === activeIdx;
    if (isActive) {
      // Active segment fills with accent color + a 1px highlight
      // along the top edge for a subtly raised feel (matches the
      // bevel idiom used by `button` / `toggle` etc).
      const innerX = sx + (i === 0 ? 1 : 0);
      const innerW = sw - (i === 0 ? 1 : 0) - (i === options.length - 1 ? 1 : 0);
      ctx.fillStyle = bgActive;
      ctx.fillRect(innerX, y + 1, innerW, h - 2);
      // Top highlight (skip when the segment is too short).
      if (innerW >= 4) {
        ctx.fillStyle = palette.bgActiveHi || 'rgba(255,255,255,0.18)';
        ctx.fillRect(innerX, y + 1, innerW, 1);
      }
      // Bottom shadow band.
      if (innerW >= 4 && h >= 5) {
        ctx.fillStyle = palette.bgActiveSh || 'rgba(0,0,0,0.25)';
        ctx.fillRect(innerX, y + h - 2, innerW, 1);
      }
    }
    const label = options[i].label || options[i];
    const lw = label.length * 4 - 1;
    pixelText(ctx, Math.round(sx + (sw - lw) / 2),
                   Math.round(y + (h - 5) / 2),
                   label,
                   { color: isActive ? textActive : text });
    // Divider between segments (skip after last).
    if (i < options.length - 1 && gap === 0) {
      ctx.fillStyle = frame;
      ctx.fillRect(sx + sw - 1, y + 1, 1, h - 2);
    }
  }
}

// Cast bar — channel/cast progress with optional perfect-timing tick.
// Distinct from `progressBar` because it has the moving cursor + the
// "perfect zone" band used in WoW-style cast UIs and parry-window
// fighting games.
//
//   palette: { frame, bg, fill, perfect, cursor, success, failure, label }
//   opts:    { perfectAt=null, perfectWidth=0.06, label, status=null }
//     perfectAt — fraction (0..1) where the perfect window centers.
//     status    — 'success' | 'failure' | null. Tints the fill color.
export function castBar(ctx, x, y, w, h, t, palette, opts = {}) {
  t = Math.max(0, Math.min(1, t));
  const perfectAt = opts.perfectAt;
  const perfectW = opts.perfectWidth != null ? opts.perfectWidth : 0.06;
  const status = opts.status;
  const frame = palette.frame || '#0a0e18';
  const bg = palette.bg || '#1a2030';
  const fillCol = status === 'success' ? (palette.success || '#60ff7a')
                : status === 'failure' ? (palette.failure || '#ff5050')
                :                        (palette.fill    || '#5aa0ff');
  const perfectCol = palette.perfect || '#ffd060';
  const cursorCol = palette.cursor || '#fff';
  // Frame.
  ctx.fillStyle = frame;
  ctx.fillRect(x, y, w, h);
  // Body.
  ctx.fillStyle = bg;
  ctx.fillRect(x + 1, y + 1, w - 2, h - 2);
  // Perfect-zone band — drawn under the fill so the fill paints over it.
  if (perfectAt != null) {
    const px = Math.round(x + 1 + (w - 2) * (perfectAt - perfectW / 2));
    const pw = Math.max(1, Math.round((w - 2) * perfectW));
    ctx.fillStyle = perfectCol;
    ctx.fillRect(px, y + 1, pw, h - 2);
  }
  // Fill up to t — solid body + 1px highlight along the top + 1px
  // darker shadow along the bottom for a subtle gradient feel.
  const fw = Math.round((w - 2) * t);
  if (fw > 0) {
    ctx.fillStyle = fillCol;
    ctx.fillRect(x + 1, y + 1, fw, h - 2);
    if (h >= 4) {
      ctx.fillStyle = palette.fillHi || 'rgba(255,255,255,0.25)';
      ctx.fillRect(x + 1, y + 1, fw, 1);
      ctx.fillStyle = palette.fillSh || 'rgba(0,0,0,0.25)';
      ctx.fillRect(x + 1, y + h - 2, fw, 1);
    }
  }
  // Cursor — 1px tall vertical line at the leading edge, with a
  // subtle 1px-wide glow trail (lighter pixel just to the left)
  // so it reads as energy bleeding off the leading edge.
  if (t > 0 && t < 1) {
    const cx = x + 1 + fw;
    if (fw >= 2) {
      ctx.fillStyle = palette.cursorTrail || 'rgba(255,255,255,0.4)';
      ctx.fillRect(cx - 1, y + 1, 1, h - 2);
    }
    ctx.fillStyle = cursorCol;
    ctx.fillRect(cx, y, 1, h);
    // Tip caps — 1px brighter pixels at the cursor's top + bottom.
    ctx.fillStyle = palette.cursorTip || cursorCol;
    ctx.fillRect(cx, y, 1, 1);
    ctx.fillRect(cx, y + h - 1, 1, 1);
  }
  // Optional label centered.
  if (opts.label) {
    const lw = opts.label.length * 4 - 1;
    pixelText(ctx, Math.round(x + (w - lw) / 2),
                   Math.round(y + (h - 5) / 2),
                   opts.label, { color: palette.label || '#fff' });
  }
}

// Combo counter — animated "×N" badge that scales in on update + has
// an optional glow halo. Different from `numberPop` (which is one-
// shot floating text); this is a persistent on-screen counter that
// pulses each time N changes.
//
//   palette: { text, glow, frame, bg }
//   opts:    { t=0, prefix='×', scale=2, animateScale=1.5 }
//     t — 0..1 phase since last increment. 0 = freshly bumped (big),
//         1 = settled. Caller drives this from their own timer.
export function comboCounter(ctx, x, y, count, palette, opts = {}) {
  const tAnim = Math.max(0, Math.min(1, opts.t != null ? opts.t : 0));
  const prefix = opts.prefix != null ? opts.prefix : '×';
  const scale = opts.scale != null ? opts.scale : 2;
  const animateScale = opts.animateScale != null ? opts.animateScale : 1.5;
  const text = palette.text || '#ffd060';
  const glow = palette.glow || '#ff8a40';
  const str = prefix + count;
  // Animation: scale eases from animateScale → 1 over t∈[0,1].
  const eased = 1 - Math.pow(1 - tAnim, 3);
  const sNow = scale * (animateScale - (animateScale - 1) * eased);
  const charW = 4 * sNow;
  const labelW = str.length * charW - 1 * sNow;
  const labelH = 5 * sNow;
  const cx = Math.round(x - labelW / 2);
  const cy = Math.round(y - labelH / 2);
  // Tier color — combo counters get hotter as N climbs. Caller can
  // override via palette.text but the default escalates: yellow
  // (1-9), orange (10-49), red-pink (50+).
  const tierText = palette.text != null ? palette.text
    : count >= 50 ? '#ff5070' : count >= 10 ? '#ff8a40' : '#ffd060';
  const tierGlow = palette.glow != null ? palette.glow
    : count >= 50 ? '#ff5070' : count >= 10 ? '#ff8a40' : '#ff8a40';
  // Glow — radial soft-falloff disc behind the label, only on
  // the early bump frames. Approximated with concentric rings of
  // decreasing alpha (cheaper than a per-pixel distance test).
  if (tAnim < 0.6) {
    const burstStrength = 1 - tAnim / 0.6;
    const baseR = Math.max(labelW, labelH) / 2 + 2;
    const rings = 4;
    for (let i = rings; i > 0; i--) {
      const ringR = Math.round(baseR + i * 2);
      const ringA = (burstStrength * (1 - i / (rings + 1)) * 0.6).toFixed(3);
      ctx.fillStyle = `rgba(${_glowToRGB(tierGlow)},${ringA})`;
      // Diamond-shape ring (cheap radial proxy at pixel scale).
      const cxC = Math.round(x);
      const cyC = Math.round(y);
      ctx.fillRect(cxC - ringR, cyC,           ringR * 2, 1);
      ctx.fillRect(cxC,         cyC - ringR,   1,         ringR * 2);
    }
  }
  pixelText(ctx, cx, cy, str, { color: tierText, scale: sNow });
}

// Internal — convert "#rrggbb" to "r,g,b" string for rgba() fillStyles.
function _glowToRGB(hex) {
  if (typeof hex !== 'string' || hex[0] !== '#' || hex.length < 7) return '255,200,80';
  const r = parseInt(hex.slice(1, 3), 16);
  const g = parseInt(hex.slice(3, 5), 16);
  const b = parseInt(hex.slice(5, 7), 16);
  return r + ',' + g + ',' + b;
}

// Page dots — N circular dots, current index is filled larger.
// Used in tutorial pagers, character carousels, image galleries.
//
//   palette: { dot, dotActive, frame? }
//   opts:    { size=2, activeSize=3, spacing=4 }
export function pageDots(ctx, x, y, total, current, palette, opts = {}) {
  if (total <= 0) return;
  const size = opts.size != null ? opts.size : 2;
  const activeSize = opts.activeSize != null ? opts.activeSize : 3;
  const spacing = opts.spacing != null ? opts.spacing : 4;
  const dot = palette.dot || '#3a4458';
  const dotActive = palette.dotActive || '#5aa0ff';
  const totalW = total * size + (total - 1) * spacing;
  const ring = palette.ring || palette.frame || '#0a0e18';
  const ringOn = palette.ringActive != null ? palette.ringActive : null;
  let cx = Math.round(x - totalW / 2);
  for (let i = 0; i < total; i++) {
    const isActive = i === current;
    const s = isActive ? activeSize : size;
    const offset = isActive ? Math.floor((activeSize - size) / 2) : 0;
    const dx = cx - offset;
    const dy = y - offset;
    // Inactive dots get a subtle 1px ring frame so they read as
    // hollow circles vs. the filled active. Skipped when size <= 2
    // (no room for a frame).
    if (!isActive && size > 2 && palette.ring !== null) {
      ctx.fillStyle = ring;
      ctx.fillRect(dx - 1, dy, s + 2, 1);
      ctx.fillRect(dx - 1, dy + s - 1, s + 2, 1);
      ctx.fillRect(dx - 1, dy, 1, s);
      ctx.fillRect(dx + s, dy, 1, s);
    }
    ctx.fillStyle = isActive ? dotActive : dot;
    ctx.fillRect(dx, dy, s, s);
    // Active dot gets an optional outer ring for emphasis.
    if (isActive && ringOn) {
      ctx.fillStyle = ringOn;
      ctx.fillRect(dx - 1, dy - 1, s + 2, 1);
      ctx.fillRect(dx - 1, dy + s, s + 2, 1);
      ctx.fillRect(dx - 1, dy - 1, 1, s + 2);
      ctx.fillRect(dx + s, dy - 1, 1, s + 2);
    }
    cx += size + spacing;
  }
}

// Star rating — N filled + (max-N) empty stars in a row. Used for
// dungeon-clear ratings, score tiers, item quality.
//
//   palette: { star, starEmpty, starFrame? }
//   opts:    { size=5, gap=1, max=5 }
export function starRating(ctx, x, y, value, palette, opts = {}) {
  const max = opts.max != null ? opts.max : 5;
  const size = opts.size != null ? opts.size : 5;
  const gap = opts.gap != null ? opts.gap : 1;
  const filled = palette.star || '#ffd060';
  const empty = palette.starEmpty || '#3a4458';
  const frameCol = palette.starFrame || '#0a0e18';
  // 5x5 star bitmap — recognizable five-point shape with foot-gap.
  const starBits = [
    [2,0],
    [1,1],[2,1],[3,1],
    [0,2],[1,2],[2,2],[3,2],[4,2],
    [1,3],[2,3],[3,3],
    [0,4],[1,4],[3,4],[4,4],
  ];
  const starSize = 5;
  const px = Math.max(1, Math.round(size / starSize));
  const drawW = starSize * px;
  for (let i = 0; i < max; i++) {
    const sx = x + i * (drawW + gap);
    // Per-star fill ratio — supports half / partial stars when
    // `value` is fractional. fillRatio ∈ [0, 1] tells us how much
    // of THIS star is colored gold vs. gray.
    const fillRatio = Math.max(0, Math.min(1, value - i));
    // 1px outer frame around the star silhouette so the empty
    // stars don't disappear into the bg. Painted FIRST so the
    // fill covers it on the gold pixels.
    if (frameCol && palette.starFrame !== null) {
      ctx.fillStyle = frameCol;
      // Outline = silhouette pixels offset by ±1 in each cardinal direction.
      for (let b = 0; b < starBits.length; b++) {
        const bx = sx + starBits[b][0] * px;
        const by = y + starBits[b][1] * px;
        ctx.fillRect(bx - 1, by, px, px);
        ctx.fillRect(bx + 1, by, px, px);
        ctx.fillRect(bx, by - 1, px, px);
        ctx.fillRect(bx, by + 1, px, px);
      }
    }
    // Fill — paint empty first then partial-fill gold over it from
    // the left to the fillRatio fraction of the star's width.
    ctx.fillStyle = empty;
    for (let b = 0; b < starBits.length; b++) {
      ctx.fillRect(sx + starBits[b][0] * px, y + starBits[b][1] * px, px, px);
    }
    if (fillRatio > 0) {
      const goldW = Math.round(drawW * fillRatio);
      ctx.fillStyle = filled;
      for (let b = 0; b < starBits.length; b++) {
        const bxRel = starBits[b][0] * px;
        if (bxRel < goldW) {
          // Clip the pixel block to goldW so half-stars get a clean
          // vertical cut down their middle.
          const w2 = Math.min(px, goldW - bxRel);
          ctx.fillRect(sx + bxRel, y + starBits[b][1] * px, w2, px);
        }
      }
      // 1px highlight pip inside filled stars — gives them a subtle
      // shimmer relative to empty ones.
      if (fillRatio >= 0.5 && size >= 5) {
        ctx.fillStyle = palette.starHi || '#ffffaa';
        ctx.fillRect(sx + 1 * px, y + 1 * px, px, px);
      }
    }
  }
}

// Compass band — horizontal compass strip (FPS-style top-of-screen).
// `headingRad` is the player's current heading in radians; the band
// scrolls to keep the heading at center. Markers (waypoints, NPCs)
// can be passed as `{ angle, label?, color? }`.
//
//   palette: { frame, bg, tick, north, marker }
//   opts:    { range=Math.PI, markers=[], showTicks=true,
//              tickInterval=Math.PI/4, drawNorth=true }
export function compassBand(ctx, cx, y, w, h, headingRad, palette, opts = {}) {
  const range = opts.range != null ? opts.range : Math.PI;   // ±range visible
  const markers = opts.markers || [];
  const showTicks = opts.showTicks !== false;
  const tickInterval = opts.tickInterval != null ? opts.tickInterval : Math.PI / 4;
  const drawNorth = opts.drawNorth !== false;
  const frame = palette.frame || '#0a0e18';
  const bg = palette.bg || '#1a2030';
  const tick = palette.tick || '#7a8aa0';
  const northCol = palette.north || '#fff';
  const markerCol = palette.marker || '#ffd060';
  const x = Math.round(cx - w / 2);
  // Frame + bg.
  ctx.fillStyle = frame;
  ctx.fillRect(x, y, w, h);
  ctx.fillStyle = bg;
  ctx.fillRect(x + 1, y + 1, w - 2, h - 2);
  // Helper: angle relative to heading → x position on band.
  const angleToX = (angle) => {
    let delta = angle - headingRad;
    while (delta >  Math.PI) delta -= 2 * Math.PI;
    while (delta < -Math.PI) delta += 2 * Math.PI;
    if (Math.abs(delta) > range) return null;
    return Math.round(cx + (delta / range) * (w / 2 - 2));
  };
  // Cardinal ticks (every tickInterval radians).
  if (showTicks) {
    for (let a = -Math.PI; a <= Math.PI; a += tickInterval) {
      const tx = angleToX(a);
      if (tx == null) continue;
      ctx.fillStyle = tick;
      ctx.fillRect(tx, y + 1, 1, Math.max(2, Math.floor(h / 3)));
    }
  }
  // North marker.
  if (drawNorth) {
    const nx = angleToX(0);
    if (nx != null) {
      ctx.fillStyle = northCol;
      ctx.fillRect(nx - 1, y + 1, 3, Math.max(3, Math.floor(h / 2)));
      pixelText(ctx, nx - 1, y + h - 6, 'N', { color: northCol });
    }
  }
  // Edge-fade bands — a few darkened columns at each side of the
  // band so markers sliding off the edge fade out instead of pop
  // out. Only painted if the bg is opaque (so it works as a true
  // "darken" overlay).
  const fadeCols = Math.min(8, Math.floor(w / 8));
  for (let i = 0; i < fadeCols; i++) {
    const a = ((1 - i / fadeCols) * 0.5).toFixed(3);
    ctx.fillStyle = `rgba(0,0,0,${a})`;
    ctx.fillRect(x + 1 + i, y + 1, 1, h - 2);
    ctx.fillRect(x + w - 2 - i, y + 1, 1, h - 2);
  }
  // Custom markers — fade their alpha as they approach band edges.
  for (const m of markers) {
    const mx = angleToX(m.angle);
    if (mx == null) continue;
    // Edge fade: pip alpha drops from 1 → 0 over the last 10% of
    // the band on each side.
    const distFromCenter = Math.abs(mx - cx);
    const halfBand = w / 2 - 2;
    const fadeStart = halfBand * 0.85;
    const alpha = distFromCenter > fadeStart
      ? Math.max(0, 1 - (distFromCenter - fadeStart) / (halfBand - fadeStart))
      : 1;
    if (alpha < 0.1) continue;
    const baseCol = m.color || markerCol;
    ctx.fillStyle = alpha < 1
      ? `rgba(${_glowToRGB(baseCol)},${alpha.toFixed(3)})`
      : baseCol;
    // Pip — small triangle pointing down at the bottom of the band.
    ctx.fillRect(mx - 1, y + h - 3, 3, 1);
    ctx.fillRect(mx,     y + h - 4, 1, 1);
    if (m.label) {
      pixelText(ctx, mx - (m.label.length * 4 - 1) / 2 | 0,
                     y + 2, m.label,
                     { color: alpha < 1
                         ? `rgba(${_glowToRGB(baseCol)},${alpha.toFixed(3)})`
                         : baseCol });
    }
  }
  // Center tick — current heading indicator. Brighter top/bottom
  // pixels for a "this is the active heading" feel.
  ctx.fillStyle = palette.heading || '#fff';
  ctx.fillRect(cx, y, 1, h);
  ctx.fillStyle = palette.headingTip || '#ffd060';
  ctx.fillRect(cx, y, 1, 1);
  ctx.fillRect(cx, y + h - 1, 1, 1);
}

// Currency display — icon + formatted number ("🪙 1,234"). The icon
// can be a built-in coin SVG-ish glyph, an HTMLCanvas, or a custom
// drawer. Numbers are auto-comma-formatted.
//
//   palette: { text, icon }
//   opts:    { icon=null, drawer=null, iconSize=6, prefix='', suffix='',
//              align='left', spacing=2 }
//     icon   — image / canvas / { draw(ctx,x,y,size) } object.
//     drawer — alt to icon: function (ctx, x, y, size).
export function currency(ctx, x, y, amount, palette, opts = {}) {
  const text = palette.text || '#ffd060';
  const iconCol = palette.icon || '#ffd060';
  const iconSize = opts.iconSize != null ? opts.iconSize : 6;
  const spacing = opts.spacing != null ? opts.spacing : 2;
  const prefix = opts.prefix || '';
  const suffix = opts.suffix || '';
  // Format amount with thousands commas.
  const formatted = prefix + (typeof amount === 'number'
    ? amount.toLocaleString('en-US') : String(amount)) + suffix;
  // Render icon at left.
  let cursorX = x;
  if (opts.drawer) {
    opts.drawer(ctx, cursorX, y, iconSize);
    cursorX += iconSize + spacing;
  } else if (opts.icon) {
    if (typeof opts.icon.draw === 'function') {
      opts.icon.draw(ctx, cursorX, y, iconSize);
    } else {
      try { ctx.drawImage(opts.icon, cursorX, y, iconSize, iconSize); }
      catch (_) {}
    }
    cursorX += iconSize + spacing;
  } else {
    // Default: tiny coin — filled circle with a dark rim + bright
    // highlight pip + bottom-right shadow for a 3-D pinball feel.
    const r = Math.floor(iconSize / 2);
    const cxC = cursorX + r;
    const cyC = y + r;
    // Dark outer rim (1px outside the coin radius).
    ctx.fillStyle = palette.iconRim || '#604010';
    for (let dy = -r - 1; dy <= r + 1; dy++) {
      for (let dx = -r - 1; dx <= r + 1; dx++) {
        const d2 = dx * dx + dy * dy;
        if (d2 <= (r + 1) * (r + 1) && d2 > r * r) {
          ctx.fillRect(cxC + dx, cyC + dy, 1, 1);
        }
      }
    }
    // Body.
    ctx.fillStyle = iconCol;
    for (let dy = -r; dy <= r; dy++) {
      for (let dx = -r; dx <= r; dx++) {
        if (dx * dx + dy * dy <= r * r) {
          ctx.fillRect(cxC + dx, cyC + dy, 1, 1);
        }
      }
    }
    // Bottom-right shadow band — a 1px arc at the lower edge.
    ctx.fillStyle = palette.iconShadow || 'rgba(0,0,0,0.35)';
    for (let dy = 0; dy <= r; dy++) {
      for (let dx = 0; dx <= r; dx++) {
        const d2 = dx * dx + dy * dy;
        if (d2 <= r * r && d2 > (r - 1) * (r - 1)) {
          ctx.fillRect(cxC + dx, cyC + dy, 1, 1);
        }
      }
    }
    // Top-left highlight pip.
    ctx.fillStyle = palette.iconHi || '#ffffaa';
    ctx.fillRect(cxC - r + 1, cyC - r + 1, 1, 1);
    if (iconSize >= 6) {
      ctx.fillRect(cxC - r + 2, cyC - r + 1, 1, 1);
    }
    cursorX += iconSize + spacing;
  }
  pixelText(ctx, cursorX, y + Math.max(0, (iconSize - 5) / 2 | 0),
            formatted, { color: text });
}

// Loading dots — three small dots with one pulsing/highlighting at
// a time. `t` ∈ [0, 1) drives the cycle.
//
//   palette: { dot, dotActive }
//   opts:    { count=3, size=2, spacing=3, bounce=1 }
export function loadingDots(ctx, x, y, t, palette, opts = {}) {
  const count = opts.count != null ? opts.count : 3;
  const size = opts.size != null ? opts.size : 2;
  const spacing = opts.spacing != null ? opts.spacing : 3;
  const bounce = opts.bounce != null ? opts.bounce : 1;
  const dot = palette.dot || '#5a6480';
  const dotActive = palette.dotActive || '#fff';
  const tt = ((t % 1) + 1) % 1;
  const dotR = _glowToRGB(dot);
  const activeR = _glowToRGB(dotActive);
  // Smooth wave — each dot's brightness/bounce comes from a phase-
  // shifted sine, so dots crossfade instead of snapping. The peak
  // travels left → right at constant speed.
  for (let i = 0; i < count; i++) {
    const phase = (tt - i / count + 1) % 1;
    // Bell-curve: 1 at phase 0, falling to 0 at the half-cycle.
    const bell = Math.max(0, Math.cos(phase * Math.PI * 2)) ** 2;
    const yOff = -Math.round(bell * bounce);
    // Mix dot color → dotActive by `bell`.
    const r = parseInt(dotR.split(',')[0]) * (1 - bell) + parseInt(activeR.split(',')[0]) * bell;
    const g = parseInt(dotR.split(',')[1]) * (1 - bell) + parseInt(activeR.split(',')[1]) * bell;
    const b = parseInt(dotR.split(',')[2]) * (1 - bell) + parseInt(activeR.split(',')[2]) * bell;
    ctx.fillStyle = `rgb(${r | 0},${g | 0},${b | 0})`;
    ctx.fillRect(x + i * (size + spacing), y + yOff, size, size);
  }
}

// Drag ghost — small visual rendered at the pointer during in-flight
// drag-and-drop. Pairs naturally with UIScene's `dragPayload()`.
// If a `drawer` is supplied (e.g. a sprite), it's used; otherwise
// renders a colored square + 1px frame.
//
//   palette: { fill, frame, shadow }
//   opts:    { size=8, drawer=null, alpha=0.85 }
export function dragGhost(ctx, x, y, palette, opts = {}) {
  const size = opts.size != null ? opts.size : 8;
  const alpha = opts.alpha != null ? opts.alpha : 0.85;
  const lift = opts.lift != null ? opts.lift : 2;
  const fill = palette.fill || '#5aa0ff';
  const frame = palette.frame || '#0a0e18';
  const hi = palette.hi || 'rgba(255,255,255,0.3)';
  ctx.save();
  // Multi-layer soft shadow — three concentric shadow rects with
  // decreasing alpha gives a softer falloff than a single hard
  // offset rect. Lift controls how high the ghost "floats" above
  // the surface (bigger lift = bigger softer shadow).
  for (let i = lift + 2; i >= 1; i--) {
    const a = (0.18 * (1 - (lift + 2 - i) / (lift + 2))).toFixed(3);
    ctx.fillStyle = `rgba(0,0,0,${a})`;
    const sx = Math.round(x - size / 2 - i + lift);
    const sy = Math.round(y - size / 2 - i + lift + 1);
    ctx.fillRect(sx, sy, size + i * 2, size + i * 2);
  }
  // Slight alpha pulse (subtle bob in opacity tied to time so the
  // ghost feels "alive" rather than glued to the cursor).
  const pulse = opts.t != null
    ? 0.92 + Math.sin(opts.t * Math.PI * 2) * 0.08 : 1;
  ctx.globalAlpha = alpha * pulse;
  if (opts.drawer) {
    opts.drawer(ctx, x, y, size);
  } else {
    // Frame + fill + 1px highlight band on top edge.
    const dx = Math.round(x - size / 2);
    const dy = Math.round(y - size / 2);
    ctx.fillStyle = frame;
    ctx.fillRect(dx, dy, size, size);
    ctx.fillStyle = fill;
    ctx.fillRect(dx + 1, dy + 1, size - 2, size - 2);
    ctx.fillStyle = hi;
    ctx.fillRect(dx + 1, dy + 1, size - 2, 1);
  }
  ctx.restore();
}

// Skill-tree node — circular state-tinted node for skill/talent
// trees. `state`: 'locked' (gray), 'unlocked' (accent), 'ranked'
// (gold). `rank` (optional 0..N) draws small pips around the rim.
// Connections between nodes are the caller's responsibility (use
// `pixelLine` for the trunk + branches).
//
//   palette: { frame, bgLocked, bgUnlocked, bgRanked, pip, accent }
//   opts:    { size=10, state='locked', rank=0, maxRank=5, drawer }
export function skillNode(ctx, cx, cy, palette, opts = {}) {
  const size = opts.size != null ? opts.size : 10;
  const state = opts.state || 'locked';
  const rank = opts.rank | 0;
  const maxRank = opts.maxRank != null ? opts.maxRank : 5;
  const frame = palette.frame || '#0a0e18';
  const bgLocked = palette.bgLocked || '#1a2030';
  const bgUnlocked = palette.bgUnlocked || '#3a4870';
  const bgRanked = palette.bgRanked || '#a06030';
  const pipCol = palette.pip || '#ffd060';
  const accent = palette.accent || '#fff';
  const r = Math.floor(size / 2);
  // Pick the body color per state.
  const body = state === 'ranked' ? bgRanked
             : state === 'unlocked' ? bgUnlocked : bgLocked;
  // Outer glow halo for unlocked/ranked nodes — concentric rings
  // of decreasing alpha tinted with the body color.
  if (state !== 'locked') {
    const haloCol = state === 'ranked' ? bgRanked : bgUnlocked;
    const haloRGB = _glowToRGB(haloCol);
    for (let glowR = r + 4; glowR > r + 1; glowR--) {
      const a = ((glowR - (r + 1)) / 3 * 0.25).toFixed(3);
      ctx.fillStyle = `rgba(${haloRGB},${a})`;
      // Cardinal cross-shape halo (cheap radial proxy at pixel scale).
      ctx.fillRect(cx - glowR, cy, glowR * 2 + 1, 1);
      ctx.fillRect(cx, cy - glowR, 1, glowR * 2 + 1);
    }
  }
  // Filled circle frame + body.
  for (let dy = -r - 1; dy <= r + 1; dy++) {
    for (let dx = -r - 1; dx <= r + 1; dx++) {
      const d2 = dx * dx + dy * dy;
      if (d2 <= (r + 1) * (r + 1) && d2 > r * r) {
        ctx.fillStyle = frame;
        ctx.fillRect(cx + dx, cy + dy, 1, 1);
      } else if (d2 <= r * r) {
        ctx.fillStyle = body;
        ctx.fillRect(cx + dx, cy + dy, 1, 1);
      }
    }
  }
  // Locked state — small padlock icon (4x5 pixel art) at center.
  if (state === 'locked') {
    ctx.fillStyle = palette.lockIcon || '#5a6480';
    // Shackle (top arch).
    ctx.fillRect(cx - 1, cy - 3, 1, 1);
    ctx.fillRect(cx + 1, cy - 3, 1, 1);
    ctx.fillRect(cx - 1, cy - 2, 1, 1);
    ctx.fillRect(cx + 1, cy - 2, 1, 1);
    // Body.
    ctx.fillRect(cx - 2, cy - 1, 5, 3);
    // Keyhole (1 dark pixel).
    ctx.fillStyle = body;
    ctx.fillRect(cx, cy, 1, 1);
  } else {
    // Inner sparkle for unlocked/ranked.
    ctx.fillStyle = accent;
    ctx.fillRect(cx - 1, cy - 1, 1, 1);
    ctx.fillRect(cx, cy - 2, 1, 1);
    ctx.fillRect(cx - 2, cy, 1, 1);
  }
  // Drawer (icon) overrides the auto-sparkle/lock.
  if (opts.drawer) opts.drawer(ctx, cx, cy, size);
  // Rank pips around the rim.
  if (rank > 0 && maxRank > 0) {
    for (let i = 0; i < Math.min(rank, maxRank); i++) {
      const a = -Math.PI / 2 + (i / maxRank) * Math.PI * 2;
      const px = Math.round(cx + Math.cos(a) * (r + 2));
      const py = Math.round(cy + Math.sin(a) * (r + 2));
      ctx.fillStyle = pipCol;
      ctx.fillRect(px, py, 1, 1);
    }
  }
}

// Quest entry — rich list row: title + progress bar + optional
// reward icon at right. Composes `barH`-style rendering inline so
// callers don't have to chain primitives.
//
//   palette: { bg, bgComplete, text, textDim, frame, fill, accent }
//   opts:    { progress=0..1, complete=false, reward, icon, subtitle }
export function questEntry(ctx, x, y, w, h, title, palette, opts = {}) {
  const progress = Math.max(0, Math.min(1, opts.progress || 0));
  const complete = !!opts.complete;
  const bg       = complete ? (palette.bgComplete || '#0e2618')
                            : (palette.bg         || '#0e1320');
  const bgHi     = complete ? (palette.bgHiComplete || '#1c4828')
                            : (palette.bgHi         || '#1a2030');
  const frame    = palette.frame    || '#0a0e18';
  const text     = palette.text     || '#e6ecf5';
  const textDim  = palette.textDim  || '#7a8aa0';
  const fill     = palette.fill     || '#5aa0ff';
  const fillBg   = palette.fillBg   || '#0a0e18';
  const fillHi   = palette.fillHi   || '#80c0ff';
  const accent   = palette.accent   || '#ffd060';
  const stripe   = palette.stripe   || (complete ? '#46d27a' : '#5aa0ff');
  const cat      = opts.category    || (complete ? 'done' : 'main');

  // ── Frame + beveled body. The body uses a 2-tone gradient
  // approximation (top brighter, bottom standard) which gives the
  // entry depth without leaving it flat.
  ctx.fillStyle = frame;
  ctx.fillRect(x, y, w, h);
  // Top half slightly brighter for a soft top-light feel.
  ctx.fillStyle = bgHi;
  ctx.fillRect(x + 1, y + 1, w - 2, Math.max(1, Math.floor((h - 2) / 2)));
  ctx.fillStyle = bg;
  ctx.fillRect(x + 1, y + 1 + Math.floor((h - 2) / 2),
               w - 2, Math.ceil((h - 2) / 2));

  // ── Left category stripe — a 3px-wide vertical band that color-
  // codes the quest type at a glance (main / side / daily / done).
  // Caller can override via palette.stripe; we pick a sensible
  // default per `category`.
  const CAT_COL = {
    main:  '#ffd060',
    side:  '#5aa0ff',
    daily: '#46d27a',
    boss:  '#ff5050',
    done:  '#46d27a',
  };
  const stripeCol = palette.stripe ? stripe : (CAT_COL[cat] || stripe);
  ctx.fillStyle = stripeCol;
  ctx.fillRect(x + 1, y + 1, 3, h - 2);

  // ── Reward chip on the right — actual icon (coin / gem / box)
  // rendered as small pixel art instead of a 2-letter cropped chip.
  // Layout:  [coin] 100  with the chip taking ~28-36px.
  let rewardW = 0;
  if (opts.reward != null) {
    const r = opts.reward;
    const isObj = typeof r === 'object' && r !== null;
    const amount = isObj ? r.amount : (typeof r === 'number' ? r : null);
    const kind   = isObj ? (r.kind || 'coin') : (amount != null ? 'coin' : 'star');
    const labelStr = amount != null ? amount.toLocaleString('en-US')
                  : (typeof r === 'string' ? r : '');
    const labelW = labelStr.length * 4 - 1;
    const iconSize = 6;
    rewardW = iconSize + 2 + labelW + 6;
    const rx = x + w - rewardW;
    const ry = y + Math.round((h - iconSize) / 2);
    // Icon palette per kind.
    const iconCol = kind === 'gem'   ? '#80c0ff'
                  : kind === 'xp'    ? '#46d27a'
                  : kind === 'box'   ? '#a06030'
                  : kind === 'star'  ? '#ffd060'
                  :                    '#ffd060'; // coin default
    ctx.fillStyle = iconCol;
    if (kind === 'gem') {
      // Diamond: 1 at top, 3 middle, 1 bottom (5x5).
      ctx.fillRect(rx + 2, ry,     2, 1);
      ctx.fillRect(rx + 1, ry + 1, 4, 1);
      ctx.fillRect(rx,     ry + 2, 6, 1);
      ctx.fillRect(rx + 1, ry + 3, 4, 1);
      ctx.fillRect(rx + 2, ry + 4, 2, 1);
      ctx.fillStyle = '#fff';
      ctx.fillRect(rx + 2, ry + 1, 1, 1);   // sparkle
    } else if (kind === 'box') {
      // Loot box: 6x6 with band.
      ctx.fillRect(rx, ry, 6, 6);
      ctx.fillStyle = '#ffd060';
      ctx.fillRect(rx, ry + 2, 6, 1);  // gold band
      ctx.fillRect(rx + 2, ry, 2, 1);  // top latch
    } else if (kind === 'xp') {
      // Star — stylized by 5x5 plus shape.
      ctx.fillRect(rx + 2, ry,     1, 1);
      ctx.fillRect(rx,     ry + 2, 5, 1);
      ctx.fillRect(rx + 2, ry + 4, 1, 1);
      ctx.fillRect(rx + 1, ry + 1, 3, 3);
    } else if (kind === 'star') {
      // Tiny 5x5 star.
      ctx.fillRect(rx + 2, ry,     1, 1);
      ctx.fillRect(rx + 1, ry + 1, 3, 1);
      ctx.fillRect(rx,     ry + 2, 5, 1);
      ctx.fillRect(rx + 1, ry + 3, 3, 1);
      ctx.fillRect(rx,     ry + 4, 1, 1);
      ctx.fillRect(rx + 4, ry + 4, 1, 1);
    } else {
      // Default: coin (filled circle 6x6).
      const r2 = 3;
      for (let dy = -r2; dy < r2; dy++) {
        for (let dx = -r2; dx < r2; dx++) {
          if (dx * dx + dy * dy < r2 * r2) {
            ctx.fillRect(rx + r2 + dx, ry + r2 + dy, 1, 1);
          }
        }
      }
      ctx.fillStyle = '#fff';
      ctx.fillRect(rx + 1, ry + 1, 1, 1); // glint
    }
    // Amount text.
    if (labelStr) {
      pixelText(ctx, rx + iconSize + 2,
                Math.round(ry + (iconSize - 5) / 2), labelStr,
                { color: complete ? '#fff' : accent });
    }
  }

  // ── Text region — title and subtitle, sized to leave room for
  // the left stripe + right reward chip.
  const textX = x + 8;
  const textRight = x + w - rewardW - 4;
  const textW = Math.max(0, textRight - textX);
  // Truncate title to fit (3px char + 1px space ~= 4px per char).
  const titleMax = Math.max(0, Math.floor(textW / 4));
  const titleStr = title.length > titleMax
    ? title.slice(0, Math.max(0, titleMax - 1)) + '…'
    : title;
  // Layout decisions — driven by available height. Three states:
  //   h < 14  → title-only (single-line entry)
  //   h <= 21 → title + bar OR title + subtitle (no bar) — caller's
  //             intent decides via `complete`.
  //   h >= 22 → title + subtitle + bar (full layout).
  // Tight heights used to bleed subtitle text into the bar; this
  // gates each row on whether there's vertical room for it.
  const showBar = !complete && h >= 16;
  const showSubtitle = !!opts.subtitle && (h >= 22 || (h >= 14 && !showBar));
  // Title sits at y+2 in tight layouts, y+3 when there's room below.
  const titleY = h >= 22 ? y + 3 : y + Math.max(2, Math.floor((h - 5) / 2));
  pixelText(ctx, textX, titleY, titleStr,
    { color: complete ? '#fff' : text });
  if (showSubtitle) {
    pixelText(ctx, textX, y + 10, opts.subtitle, { color: textDim });
  }

  // ── Progress bar — taller (5px) for legibility, with frame + a
  // 1px highlight on top of the fill so it reads as raised energy
  // instead of a flat strip. Hidden when complete (replaced by the
  // checkmark badge).
  if (showBar) {
    const barX = textX;
    // Bar bottom is always 2px above the entry's bottom frame so
    // it never paints into the 1px outline; height adapts to room
    // remaining below the text rows.
    const barH = 5;
    const barY = y + h - 2 - barH;
    const barW = textW;
    // Frame.
    ctx.fillStyle = frame;
    ctx.fillRect(barX, barY, barW, barH);
    // Body.
    ctx.fillStyle = fillBg;
    ctx.fillRect(barX + 1, barY + 1, barW - 2, barH - 2);
    // Fill.
    const fillW = Math.round((barW - 2) * progress);
    if (fillW > 0) {
      ctx.fillStyle = fill;
      ctx.fillRect(barX + 1, barY + 1, fillW, barH - 2);
      // 1px highlight along top of fill.
      ctx.fillStyle = fillHi;
      ctx.fillRect(barX + 1, barY + 1, fillW, 1);
    }
    // Percent label — only when the entry is tall enough that the
    // label has its OWN row above the bar (h ≥ 22). For shorter
    // entries the bar speaks for itself; cramming "67%" next to
    // the title was the artifact you saw.
    if (h >= 22 && barW >= 30) {
      const pct = Math.round(progress * 100) + '%';
      const pw = pct.length * 4 - 1;
      const pctY = barY - 7;
      pixelText(ctx, x + w - rewardW - 4 - pw, pctY, pct,
        { color: textDim });
    }
  }

  // ── Complete badge — actual filled circle with a hand-drawn pixel
  // checkmark instead of a unicode glyph (bitmap font has no ✓).
  if (complete) {
    const bx = x + w - rewardW - 12;
    const by = y + (h - 9) / 2;
    // Filled circle.
    const r = 4;
    ctx.fillStyle = '#46d27a';
    for (let dy = -r; dy < r; dy++) {
      for (let dx = -r; dx < r; dx++) {
        if (dx * dx + dy * dy < r * r) {
          ctx.fillRect(bx + r + dx, by + r + dy, 1, 1);
        }
      }
    }
    // Pixel checkmark — 3 strokes, drawn in dark on the green badge.
    ctx.fillStyle = '#0a1c11';
    ctx.fillRect(bx + 1, by + 4, 1, 1);
    ctx.fillRect(bx + 2, by + 5, 1, 1);
    ctx.fillRect(bx + 3, by + 4, 1, 1);
    ctx.fillRect(bx + 4, by + 3, 1, 1);
    ctx.fillRect(bx + 5, by + 2, 1, 1);
  }
}

// Dialogue bubble — speech-style box with optional speaker portrait,
// name banner, body text (multi-line via \n), and a paginated
// typewriter-cursor effect (`pageT` ∈ [0,1] reveals chars). Different
// from `dialog` (which is a modal panel).
//
//   palette: { frame, bg, name, nameBg, text, page }
//   opts:    { speaker, portrait, text, pageT=1, page=null,
//              totalPages=null, tail='down' }
export function dialogueBubble(ctx, x, y, w, h, palette, opts = {}) {
  const tail = opts.tail || 'down';
  const frame = palette.frame || '#0a0e18';
  const bg = palette.bg || '#1a2030';
  const nameBg = palette.nameBg || '#3a4458';
  const nameCol = palette.name || '#ffd060';
  const textCol = palette.text || '#fff';
  const pageCol = palette.page || '#7a8aa0';
  // Frame + body.
  ctx.fillStyle = frame;
  ctx.fillRect(x, y, w, h);
  ctx.fillStyle = bg;
  ctx.fillRect(x + 1, y + 1, w - 2, h - 2);
  // Tail (anchored at the bottom-center if 'down').
  if (tail === 'down') {
    ctx.fillStyle = frame;
    ctx.fillRect(x + w / 2 - 2, y + h, 5, 1);
    ctx.fillRect(x + w / 2 - 1, y + h + 1, 3, 1);
    ctx.fillRect(x + w / 2,     y + h + 2, 1, 1);
    ctx.fillStyle = bg;
    ctx.fillRect(x + w / 2 - 1, y + h, 3, 1);
    ctx.fillRect(x + w / 2,     y + h + 1, 1, 1);
  }
  // Portrait at left.
  let cursorX = x + 3;
  if (opts.portrait) {
    const psize = Math.min(h - 6, 24);
    if (typeof opts.portrait.draw === 'function') {
      opts.portrait.draw(ctx, cursorX, y + 3, psize);
    } else {
      try { ctx.drawImage(opts.portrait, cursorX, y + 3, psize, psize); }
      catch (_) {}
    }
    ctx.fillStyle = frame;
    ctx.strokeStyle = frame;
    ctx.fillRect(cursorX, y + 3, psize, 1);
    ctx.fillRect(cursorX, y + 3 + psize - 1, psize, 1);
    ctx.fillRect(cursorX, y + 3, 1, psize);
    ctx.fillRect(cursorX + psize - 1, y + 3, 1, psize);
    cursorX += psize + 3;
  }
  // Speaker name banner.
  if (opts.speaker) {
    const nameW = opts.speaker.length * 4 + 4;
    ctx.fillStyle = nameBg;
    ctx.fillRect(cursorX, y + 3, nameW, 7);
    pixelText(ctx, cursorX + 2, y + 4, opts.speaker, { color: nameCol });
  }
  // Body text — typewriter via slicing + auto-word-wrap to the
  // available width. The typewriter reveals N chars of the raw
  // string; THEN we wrap that visible substring at word boundaries
  // so the bubble fills horizontally regardless of how the caller
  // shaped the input. Explicit `\n` in the source is preserved as
  // a hard break (overrides wrap). 4px per char (3px glyph + 1px
  // spacing) is the budget; available width subtracts the cursorX
  // offset (which includes any portrait + margin) and a 3px right
  // padding so wrapped text doesn't kiss the bubble's right edge.
  if (opts.text) {
    const fullText = opts.text;
    const pageT = opts.pageT != null ? opts.pageT : 1;
    const chars = Math.floor(fullText.length * pageT);
    const visible = fullText.slice(0, chars);
    const lineH = 7;
    const availW = (x + w - 3) - cursorX;
    const charsPerLine = Math.max(1, Math.floor(availW / 4));
    const rawLines = visible.split('\n');
    const lines = [];
    for (const raw of rawLines) {
      if (raw.length <= charsPerLine) {
        lines.push(raw);
        continue;
      }
      // Greedy word-wrap. Walks word-by-word, packs as many as fit
      // the line budget, breaks. Single words longer than a line
      // are hard-broken at the budget (rare in dialogue).
      const words = raw.split(' ');
      let line = '';
      for (const word of words) {
        if (!line) {
          if (word.length > charsPerLine) {
            // Long single word — chunk into multiple lines.
            for (let i = 0; i < word.length; i += charsPerLine) {
              lines.push(word.slice(i, i + charsPerLine));
            }
            line = '';
          } else {
            line = word;
          }
        } else if (line.length + 1 + word.length <= charsPerLine) {
          line += ' ' + word;
        } else {
          lines.push(line);
          line = word;
        }
      }
      if (line) lines.push(line);
    }
    const startY = y + (opts.speaker ? 12 : 3);
    // Clip lines that would overflow the bubble's bottom — better
    // to truncate than paint outside the rect.
    const maxLines = Math.max(1, Math.floor((y + h - startY - 2) / lineH));
    const renderLines = lines.slice(0, maxLines);
    for (let i = 0; i < renderLines.length; i++) {
      pixelText(ctx, cursorX, startY + i * lineH, renderLines[i], { color: textCol });
    }
    // Blinking caret at end of revealed text — block instead of
    // a 1px line, more legible at small sizes. Uses the WRAPPED
    // line set (renderLines) so the caret follows the visible
    // last-line position even when wrap re-flows the text.
    if (pageT < 1) {
      const lastLine = renderLines[renderLines.length - 1] || '';
      const caretX = cursorX + lastLine.length * 4;
      const caretY = startY + (renderLines.length - 1) * lineH;
      if ((Math.floor(performance.now() / 200) % 2) === 0) {
        ctx.fillStyle = textCol;
        ctx.fillRect(caretX, caretY, 2, 5);
      }
    } else {
      // Fully revealed → show a bobbing "▼ press to continue" arrow
      // at the bottom-right. Gives the player a clear next-action cue.
      const arrowBob = Math.round(Math.sin(performance.now() / 200) * 1);
      const ax = x + w - 8;
      const ay = y + h - 6 + arrowBob;
      ctx.fillStyle = palette.advance || '#ffd060';
      ctx.fillRect(ax,     ay,     5, 1);
      ctx.fillRect(ax + 1, ay + 1, 3, 1);
      ctx.fillRect(ax + 2, ay + 2, 1, 1);
    }
  }
  // Page indicator (e.g. "1/3") bottom-right — left of the advance
  // arrow so they don't overlap.
  if (opts.page != null && opts.totalPages != null) {
    const lbl = opts.page + '/' + opts.totalPages;
    const lw = lbl.length * 4 - 1;
    const px2 = x + w - lw - 14;  // leave room for arrow
    pixelText(ctx, px2, y + h - 7, lbl, { color: pageCol });
  }
}

// Reticle — lock-on aim ring with 4 corner brackets that snap inward
// when locked. Distinct from `crosshair` (passive aiming dot). Used
// for boss-target indicators, twin-stick lock-on UIs, racing-style
// camera-target reticles.
//
//   palette: { ring, lock, bracket }
//   opts:    { size=10, locked=false, t=0, brackets=4 }
//     t — 0..1 lock-in animation phase (0 = brackets at outer
//         radius, 1 = brackets snapped in flush).
export function reticle(ctx, cx, cy, palette, opts = {}) {
  const size = opts.size != null ? opts.size : 10;
  const locked = !!opts.locked;
  const t = Math.max(0, Math.min(1, opts.t != null ? opts.t : (locked ? 1 : 0)));
  const scanT = opts.scanT != null ? opts.scanT : (performance.now() / 800);
  const ring = palette.ring || '#fff';
  const lockCol = palette.lock || '#ff5050';
  const bracket = palette.bracket || (locked ? lockCol : ring);
  const r = size;
  // Outer ring — dotted circle. Scan-active (during acquisition)
  // rotates the dot pattern; settled (locked) leaves a static ring.
  const dotCount = 12;
  const phase = locked ? 0 : (scanT % 1) * (Math.PI * 2 / dotCount);
  for (let i = 0; i < dotCount; i++) {
    const a = phase + (i / dotCount) * Math.PI * 2;
    const px = Math.round(cx + Math.cos(a) * r);
    const py = Math.round(cy + Math.sin(a) * r);
    // Brighter "leading" dots during scan to imply rotation; dim
    // otherwise.
    const alpha = locked
      ? 0.7
      : (i < 3 ? 1 - i * 0.25 : 0.25);
    ctx.fillStyle = `rgba(${_glowToRGB(ring)},${alpha.toFixed(2)})`;
    ctx.fillRect(px, py, 1, 1);
  }
  // 4 corner brackets — collapse from outer (size+3) → inner (size-2)
  // as t goes 0→1. Locked state pulses the bracket length slightly.
  const lockPulse = locked
    ? Math.sin(performance.now() / 150) * 0.5 : 0;
  const offset = Math.round(size + 3 - 5 * t);
  const brackLen = Math.round(3 + lockPulse);
  ctx.fillStyle = bracket;
  // Top-left
  ctx.fillRect(cx - offset, cy - offset, brackLen, 1);
  ctx.fillRect(cx - offset, cy - offset, 1, brackLen);
  // Top-right
  ctx.fillRect(cx + offset - brackLen + 1, cy - offset, brackLen, 1);
  ctx.fillRect(cx + offset, cy - offset, 1, brackLen);
  // Bottom-left
  ctx.fillRect(cx - offset, cy + offset, brackLen, 1);
  ctx.fillRect(cx - offset, cy + offset - brackLen + 1, 1, brackLen);
  // Bottom-right
  ctx.fillRect(cx + offset - brackLen + 1, cy + offset, brackLen, 1);
  ctx.fillRect(cx + offset, cy + offset - brackLen + 1, 1, brackLen);
  // Center marker — single pixel cross when locked, single dot mid-scan.
  if (locked) {
    ctx.fillStyle = lockCol;
    ctx.fillRect(cx - 1, cy, 3, 1);
    ctx.fillRect(cx, cy - 1, 1, 3);
  } else if (t > 0.2) {
    ctx.fillStyle = ring;
    ctx.fillRect(cx, cy, 1, 1);
  }
}

// Waypoint pip — directional arrow at the edge of the viewport
// pointing toward an off-screen objective. `dx, dy` = vector from
// the camera center to the target. If the target is on-screen the
// pip is drawn at its position; if off-screen it's clamped to the
// viewport edge with an arrow rotated toward the target.
//
//   palette: { arrow, ring, distance }
//   opts:    { vw, vh, distance=null, label, margin=8, size=4 }
export function waypointPip(ctx, cx, cy, dx, dy, palette, opts = {}) {
  const vw = opts.vw;   // viewport width
  const vh = opts.vh;   // viewport height
  if (vw == null || vh == null) return;
  const arrowCol = palette.arrow || '#ffd060';
  const distCol = palette.distance || '#fff';
  const margin = opts.margin != null ? opts.margin : 8;
  const size = opts.size != null ? opts.size : 4;
  // Target screen position.
  const tx = cx + dx;
  const ty = cy + dy;
  const onScreen = tx >= margin && tx <= vw - margin
                && ty >= margin && ty <= vh - margin;
  if (onScreen) {
    // On-screen — small ring + dot at the target.
    const tcx = Math.round(tx), tcy = Math.round(ty);
    ctx.fillStyle = arrowCol;
    ctx.fillRect(tcx - 2, tcy, 1, 1);
    ctx.fillRect(tcx + 2, tcy, 1, 1);
    ctx.fillRect(tcx, tcy - 2, 1, 1);
    ctx.fillRect(tcx, tcy + 2, 1, 1);
    ctx.fillStyle = palette.dot || '#fff';
    ctx.fillRect(tcx, tcy, 1, 1);
    return;
  }
  // Off-screen — clamp the pip's position to the rect edge along
  // the heading direction, then draw a clean triangular arrow.
  const angle = Math.atan2(dy, dx);
  const halfW = vw / 2 - margin;
  const halfH = vh / 2 - margin;
  const cosA = Math.cos(angle), sinA = Math.sin(angle);
  let scale;
  if (Math.abs(cosA * halfH) >= Math.abs(sinA * halfW)) {
    scale = halfW / Math.abs(cosA);
  } else {
    scale = halfH / Math.abs(sinA);
  }
  const px = Math.round(cx + cosA * scale);
  const py = Math.round(cy + sinA * scale);
  // Triangle arrow — sweep through every pixel in the bounding
  // box and test if it falls inside a triangle pointing along
  // angle. Tip at (px, py); base at (px - cosA*size, py - sinA*size)
  // with width `size` perpendicular to the heading.
  const tipX = px;
  const tipY = py;
  const baseCx = px - cosA * size;
  const baseCy = py - sinA * size;
  const halfBase = size * 0.7;
  // Perpendicular direction.
  const perpX = -sinA;
  const perpY = cosA;
  const baseLX = baseCx + perpX * halfBase;
  const baseLY = baseCy + perpY * halfBase;
  const baseRX = baseCx - perpX * halfBase;
  const baseRY = baseCy - perpY * halfBase;
  // Frame outline first (1px darker behind triangle).
  const frameCol = palette.frame || '#0a0e18';
  ctx.fillStyle = frameCol;
  _fillTriangle(ctx, tipX, tipY, baseLX, baseLY, baseRX, baseRY, 1);
  // Body fill.
  ctx.fillStyle = arrowCol;
  _fillTriangle(ctx, tipX, tipY, baseLX, baseLY, baseRX, baseRY, 0);
  // Distance label — framed for legibility against any backdrop.
  if (opts.distance != null) {
    const lbl = Math.round(opts.distance) + (opts.unit || 'm');
    const lw = lbl.length * 4 - 1;
    // Position the label OPPOSITE the tip (toward the screen
    // center) so it doesn't fall off-screen.
    const lblX = Math.round(px - cosA * (size + 4) - lw / 2);
    const lblY = Math.round(py - sinA * (size + 4) - 2);
    // Frame.
    ctx.fillStyle = frameCol;
    ctx.fillRect(lblX - 2, lblY - 1, lw + 4, 7);
    ctx.fillStyle = palette.distanceBg || '#1a2030';
    ctx.fillRect(lblX - 1, lblY, lw + 2, 5);
    pixelText(ctx, lblX, lblY, lbl, { color: distCol });
  }
}

// Internal — triangle rasterizer. `pad` inflates the triangle by
// pad pixels in each direction (used for drawing a 1px outline
// before the fill).
function _fillTriangle(ctx, x1, y1, x2, y2, x3, y3, pad) {
  const minX = Math.floor(Math.min(x1, x2, x3) - pad);
  const maxX = Math.ceil(Math.max(x1, x2, x3) + pad);
  const minY = Math.floor(Math.min(y1, y2, y3) - pad);
  const maxY = Math.ceil(Math.max(y1, y2, y3) + pad);
  // Half-plane edge tests via cross product.
  const sign = (ax, ay, bx, by, cx, cy) =>
    (ax - cx) * (by - cy) - (bx - cx) * (ay - cy);
  for (let py = minY; py <= maxY; py++) {
    for (let px = minX; px <= maxX; px++) {
      const d1 = sign(px, py, x1, y1, x2, y2);
      const d2 = sign(px, py, x2, y2, x3, y3);
      const d3 = sign(px, py, x3, y3, x1, y1);
      const hasNeg = (d1 < -pad) || (d2 < -pad) || (d3 < -pad);
      const hasPos = (d1 >  pad) || (d2 >  pad) || (d3 >  pad);
      if (!(hasNeg && hasPos)) {
        ctx.fillRect(px, py, 1, 1);
      }
    }
  }
}

// ── Cursor primitives ──────────────────────────────────────────────────
//
// Classic outlined pixel-art cursors — black 1-px outline + white fill,
// the canonical OS cursor style. Proportions adapted from the tilemap
// reference sheet (a multi-cursor sprite set at `src/tilemap.png`).
//
// Outlined cursors are the universal-readability format: the black
// outline keeps the silhouette legible on white/light surfaces, the
// white fill keeps it legible on black/dark ones. Single-color
// silhouettes fail one of those two cases.
//
// Palette: { outline, fill }
//   outline — the dark stroke color (default '#000000')
//   fill    — the bright interior  (default '#ffffff')
//
// Both functions return the sprite's hotspot { x, y } relative to the
// draw origin so callers know where the "click point" is.
//
// Grid notation:
//   'X' = outline pixel
//   'w' = fill pixel
//   '.' = transparent

// NW-pointing classic arrow cursor with diagonal tail.
//
//   Rows 0-7:  body widens to 8 cells along the NW→SE hypotenuse.
//   Rows 8-9:  body tapers back toward the left edge.
//   Row 10:    bottom-left foot (cols 0-1) + tail emerges at cols 3-4.
//   Rows 11-14: 2-px-wide tail descends SE one column per row.
//
// Solid silhouette, no internal lines. Hotspot at the tip (0, 0).
// Classic NW-pointing arrow cursor. 1-pixel black outline + white
// interior + diagonal SE tail. Adapted from the tilemap reference.
const _CURSOR_ARROW = [
  '............',
  '.X..........',
  '.XX.........',
  '.XwX........',
  '.XwwX.......',
  '.XwwwX......',
  '.XwwwwX.....',
  '.XwwwwwX....',
  '.XwwwwwwX...',
  '.XwwwXXXX...',
  '.XwwXwX.....',
  '.XwXwX......',
  '.XX.XwX.....',
  '....XwX.....',
  '.....XX.....',
  '............',
];

// Pointing hand cursor — outlined. Extended index finger up,
// knuckle bumps right, thumb stub left, closed fist + wrist below.
const _CURSOR_POINTER = [
  '............',
  '....XX......',
  '....XwX.....',
  '....XwX.....',
  '....XwXX....',
  '....XwwwX...',
  '....XwwwwX..',
  '.XX.XwwwwX..',
  'XwwXXwwwwX..',
  'XwwwwwwwwX..',
  '.XwwwwwwwX..',
  '.XwwwwwwwX..',
  '..XwwwwwwX..',
  '..XXXXXXXX..',
  '............',
  '............',
];

function _bakeCursor(ctx, x, y, grid, palette) {
  const outline = palette.outline || '#000000';
  const fill    = palette.fill    || '#ffffff';
  for (let py = 0; py < grid.length; py++) {
    const row = grid[py];
    for (let px = 0; px < row.length; px++) {
      const ch = row[px];
      if (ch === 'X')      ctx.fillStyle = outline;
      else if (ch === 'w') ctx.fillStyle = fill;
      else continue;
      ctx.fillRect(x + px, y + py, 1, 1);
    }
  }
}

// Classic NW-pointing arrow cursor — outlined, with diagonal SE tail.
// Size: 12 × 16. Hotspot: (1, 1) — the tip.
export function cursorArrow(ctx, x, y, palette = {}) {
  _bakeCursor(ctx, x, y, _CURSOR_ARROW, palette);
  return { x: 1, y: 1 };
}

// Outlined pointing hand — extended index finger up, knuckle bumps
// right, thumb stub left, closed fist + wrist below.
// Size: 12 × 16. Hotspot: (4, 1) — the fingertip.
export function cursorPointer(ctx, x, y, palette = {}) {
  _bakeCursor(ctx, x, y, _CURSOR_POINTER, palette);
  return { x: 4, y: 1 };
}
