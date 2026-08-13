/**
 * Vintage slice — Game Boy ship bar, hard cap = Game Boy Advance.
 * Pure Canvas2D. Integer scale. Locked palette. No Three.js / no modern FX.
 *
 * Host injects SPEC + CONFIG + VINTAGE profile.
 */
const SPEC = __SPEC__;
const CONFIG = __CONFIG__;
const VINTAGE = __VINTAGE__;

// GBA ceiling enforced — never exceed these even if SPEC is wrong
const VW = Math.min(VINTAGE.width || 160, 240);
const VH = Math.min(VINTAGE.height || 144, 160);
const MAX_COLORS = Math.min(VINTAGE.maxColors || 4, 15);
// Feel tables still carry coyoteMs / jumpBufferMs for host verify + patch
const _COYOTE = CONFIG.coyoteMs ?? 100;
const _JUMP_BUF = CONFIG.jumpBufferMs ?? 90;
void _COYOTE;
void _JUMP_BUF;

function hex(n) {
  return '#' + ((n >>> 0) & 0xffffff).toString(16).padStart(6, '0');
}

/** Quantize any hex to nearest locked palette color (GBA ceiling). */
function lockColor(hexStr, paletteHex) {
  if (!paletteHex || !paletteHex.length) return hexStr;
  const parse = (h) => {
    const s = h.replace('#', '');
    return [parseInt(s.slice(0, 2), 16), parseInt(s.slice(2, 4), 16), parseInt(s.slice(4, 6), 16)];
  };
  const [tr, tg, tb] = parse(hexStr);
  let best = paletteHex[0];
  let bestD = 1e9;
  for (const p of paletteHex) {
    const [r, g, b] = parse(p);
    const d = (r - tr) ** 2 + (g - tg) ** 2 + (b - tb) ** 2;
    if (d < bestD) {
      bestD = d;
      best = p;
    }
  }
  return best;
}

export function createGame({ genre, title }) {
  const pal = SPEC.palette || {};
  const colors = (VINTAGE.colors || []).map(hex);
  // Ensure ≤ MAX_COLORS unique
  const locked = colors.slice(0, MAX_COLORS);
  while (locked.length < 4) locked.push(locked[locked.length - 1] || '#0f380f');

  const C0 = locked[0]; // darkest
  const C1 = locked[1] || locked[0];
  const C2 = locked[2] || locked[1];
  const C3 = locked[3] || locked[2];

  // Offscreen at native GB/GBA res, then integer-scale blit to display
  const game = document.createElement('canvas');
  game.width = VW;
  game.height = VH;
  const gctx = game.getContext('2d', { alpha: false });
  gctx.imageSmoothingEnabled = false;

  const display = document.createElement('canvas');
  display.style.display = 'block';
  display.style.margin = '0 auto';
  display.style.imageRendering = 'pixelated';
  display.style.imageRendering = 'crisp-edges';
  display.style.background = C0;
  document.body.style.margin = '0';
  document.body.style.background = C0;
  document.body.style.overflow = 'hidden';
  document.body.appendChild(display);
  const dctx = display.getContext('2d', { alpha: false });
  dctx.imageSmoothingEnabled = false;

  function fit() {
    const maxS = Math.max(1, Math.floor(Math.min(innerWidth / VW, innerHeight / VH)));
    const s = Math.max(1, maxS); // integer scale only — never fractional
    display.width = VW * s;
    display.height = VH * s;
    display.style.width = VW * s + 'px';
    display.style.height = VH * s + 'px';
    dctx.imageSmoothingEnabled = false;
  }
  addEventListener('resize', fit);
  fit();

  const isSide = SPEC.camera === 'side' || SPEC.loop === 'jump' || SPEC.loop === 'run';
  const keys = Object.create(null);

  // Tiny baked sprites as pure rects (no modern pixelart FX stack)
  function drawHero(ctx, x, y, flip) {
    ctx.fillStyle = C3;
    // 8×12 body — classic handheld silhouette
    ctx.fillRect(x + 2, y + 3, 4, 5);
    ctx.fillRect(x + 2, y + 1, 4, 3); // head
    ctx.fillStyle = C0;
    ctx.fillRect(x + (flip ? 2 : 4), y + 2, 1, 1); // eye
    ctx.fillStyle = C2;
    ctx.fillRect(x + 2, y + 8, 2, 3);
    ctx.fillRect(x + 4, y + 8, 2, 3);
  }

  function drawFoe(ctx, x, y) {
    ctx.fillStyle = C1;
    ctx.fillRect(x + 1, y + 2, 6, 6);
    ctx.fillStyle = C3;
    ctx.fillRect(x + 2, y + 3, 1, 1);
    ctx.fillRect(x + 5, y + 3, 1, 1);
  }

  function drawCoin(ctx, x, y, t) {
    const on = ((t * 6) | 0) % 2 === 0;
    ctx.fillStyle = on ? C3 : C2;
    ctx.fillRect(x + 1, y + 1, 4, 4);
    ctx.fillStyle = C0;
    ctx.fillRect(x + 2, y + 2, 2, 2);
  }

  const seed = (SPEC.seed || 1) >>> 0;
  function rnd(i) {
    let x = (seed + i * 9973) >>> 0;
    x ^= x << 13;
    x ^= x >>> 17;
    x ^= x << 5;
    return (x >>> 0) / 4294967296;
  }

  const solids = [];
  const coins = [];
  const foes = [];

  const ROOM_N = Math.min(Number(SPEC.roomCount) || 1, 6);
  const worldW = isSide ? VW * (1 + ROOM_N) : VW;

  if (isSide) {
    // Multi-screen scroll — handheld density (one more room = wider world)
    solids.push({ x: 0, y: VH - 16, w: worldW, h: 16 });
    for (let i = 0; i < 5 + ROOM_N * 2; i++) {
      solids.push({
        x: 24 + i * 40,
        y: VH - 40 - Math.floor(rnd(i) * 24),
        w: 24,
        h: 8,
      });
    }
    for (let i = 0; i < Math.min(SPEC.coinCount || 5, 8 + ROOM_N); i++) {
      coins.push({ x: 32 + i * 36, y: 40 + rnd(i + 2) * 40, got: false });
    }
    for (let i = 0; i < Math.min(SPEC.enemyCount || 2, 4 + Math.min(ROOM_N, 2)); i++) {
      foes.push({
        x: 60 + i * 50,
        y: VH - 28,
        vx: 20 * (rnd(i) > 0.5 ? 1 : -1),
        hp: 1,
      });
    }
  } else {
    // Top-down room — GB Link-to-the-Past density (still GBA-safe)
    solids.push({ x: 0, y: 0, w: VW, h: 8 }, { x: 0, y: VH - 8, w: VW, h: 8 });
    solids.push({ x: 0, y: 0, w: 8, h: VH }, { x: VW - 8, y: 0, w: 8, h: VH });
    for (let i = 0; i < 5; i++) {
      solids.push({
        x: 16 + Math.floor(rnd(i) * (VW - 40)),
        y: 16 + Math.floor(rnd(i + 4) * (VH - 40)),
        w: 12,
        h: 12,
      });
    }
    for (let i = 0; i < Math.min(SPEC.coinCount || 5, 8); i++) {
      coins.push({
        x: 20 + rnd(i + 8) * (VW - 40),
        y: 20 + rnd(i + 9) * (VH - 40),
        got: false,
      });
    }
    for (let i = 0; i < Math.min(SPEC.enemyCount || 3, 5); i++) {
      foes.push({
        x: 30 + rnd(i + 20) * (VW - 50),
        y: 30 + rnd(i + 21) * (VH - 50),
        vx: 16 * (rnd(i) > 0.5 ? 1 : -1),
        vy: 16 * (rnd(i + 1) > 0.5 ? 1 : -1),
        hp: 1,
      });
    }
  }

  const state = {
    x: 20,
    y: isSide ? VH - 40 : VH / 2,
    vx: 0,
    vy: 0,
    onGround: false,
    lastGround: 0,
    jumpBuf: 0,
    hp: Math.min(CONFIG.hp ?? 3, 5), // handheld: low HP
    score: 0,
    dead: false,
    camX: 0,
    camY: 0,
    t: 0,
    inv: 0,
    facing: 1,
  };

  const hud = document.getElementById('hud');
  function setHud() {
    if (!hud) return;
    const prof = VINTAGE.profile || 'gb';
    hud.textContent = `${title || SPEC.title} · ${prof.toUpperCase()} · HP${state.hp} · ${state.score}${state.dead ? ' · START(R)' : ''}`;
    hud.style.color = C3;
    hud.style.font = '12px/1.2 ui-monospace, monospace';
    hud.style.imageRendering = 'pixelated';
  }

  function rectHit(ax, ay, aw, ah, b) {
    return ax < b.x + b.w && ax + aw > b.x && ay < b.y + b.h && ay + ah > b.y;
  }

  function moveAABB(ent, dt) {
    const w = 8;
    const h = 12;
    ent.x += ent.vx * dt;
    for (const s of solids) {
      if (rectHit(ent.x, ent.y, w, h, s)) {
        if (ent.vx > 0) ent.x = s.x - w;
        else if (ent.vx < 0) ent.x = s.x + s.w;
        ent.vx = 0;
      }
    }
    ent.y += ent.vy * dt;
    ent.onGround = false;
    for (const s of solids) {
      if (rectHit(ent.x, ent.y, w, h, s)) {
        if (ent.vy > 0) {
          ent.y = s.y - h;
          ent.onGround = true;
        } else if (ent.vy < 0) {
          ent.y = s.y + s.h;
        }
        ent.vy = 0;
      }
    }
  }

  // 4-channel-ish square blips (GB APU vibe) — no complex SFX graphs
  let ac;
  function blip(f = 220, dur = 0.05, type = 'square') {
    try {
      ac = ac || new (window.AudioContext || window.webkitAudioContext)();
      const o = ac.createOscillator();
      const g = ac.createGain();
      o.type = type;
      o.frequency.value = f;
      g.gain.value = 0.03;
      o.connect(g);
      g.connect(ac.destination);
      o.start();
      o.stop(ac.currentTime + dur);
    } catch (_) {}
  }

  function damage(n) {
    if (state.dead || state.inv > 0) return;
    state.hp -= n;
    state.inv = 0.8;
    blip(110, 0.08);
    if (window.__GF_PLAYTEST__?.recordHit) window.__GF_PLAYTEST__.recordHit();
    if (state.hp <= 0) {
      state.dead = true;
      blip(80, 0.2);
      if (window.__GF_PLAYTEST__?.recordDeath) window.__GF_PLAYTEST__.recordDeath();
    }
    setHud();
  }

  function restart() {
    state.x = 20;
    state.y = isSide ? VH - 40 : VH / 2;
    state.vx = state.vy = 0;
    state.hp = Math.min(CONFIG.hp ?? 3, 5);
    state.score = 0;
    state.dead = false;
    state.inv = 0;
    coins.forEach((c) => {
      c.got = false;
    });
    if (window.__GF_PLAYTEST__?.recordRestart) window.__GF_PLAYTEST__.recordRestart();
    setHud();
  }

  addEventListener('keydown', (e) => {
    keys[e.code] = true;
    if (e.code === 'KeyR' || e.code === 'Enter') restart();
  });
  addEventListener('keyup', (e) => {
    keys[e.code] = false;
  });

  let last = performance.now();
  // Fixed ~60 but GB feel uses discrete pixel positions
  function frame(now) {
    const dt = Math.min(0.05, (now - last) / 1000);
    last = now;
    state.t += dt;
    if (state.inv > 0) state.inv -= dt;

    if (!state.dead) {
      // Snappy handheld feel — slightly higher accel than modern floaty defaults
      const speed = Math.min(CONFIG.moveSpeed ?? 5.5, 7);
      const accel = Math.min(CONFIG.accel ?? 55, 70);
      let ix = 0;
      let iy = 0;
      if (keys.KeyA || keys.ArrowLeft) ix -= 1;
      if (keys.KeyD || keys.ArrowRight) ix += 1;
      if (!isSide) {
        if (keys.KeyW || keys.ArrowUp) iy -= 1;
        if (keys.KeyS || keys.ArrowDown) iy += 1;
      }
      if (ix) state.facing = ix;

      if (isSide) {
        state.vx += (ix * speed * 16 - state.vx) * Math.min(1, accel * dt * 0.15);
        // GB gravity feel
        state.vy += Math.min(CONFIG.gravity ?? 26, 32) * dt * 9;
        if (state.onGround) state.lastGround = state.t;
        const wantJump = keys.Space || keys.KeyW || keys.ArrowUp || keys.KeyZ;
        if (wantJump) state.jumpBuf = state.t;
        const coyoteOk = state.t - state.lastGround <= (_COYOTE / 1000);
        const bufOk = state.t - state.jumpBuf <= (_JUMP_BUF / 1000);
        if (wantJump && (state.onGround || coyoteOk) && bufOk) {
          state.vy = -(Math.min(CONFIG.jumpForce ?? 8.5, 10)) * 11;
          state.onGround = false;
          state.lastGround = -1;
          state.jumpBuf = -1;
          blip(320, 0.04);
          if (window.__GF_PLAYTEST__?.recordJump) window.__GF_PLAYTEST__.recordJump();
        }
        if (!wantJump && state.vy < 0) {
          state.vy *= CONFIG.jumpCut ?? 0.45;
        }
      } else {
        const len = Math.hypot(ix, iy) || 1;
        state.vx += ((ix / len) * speed * 18 - state.vx) * Math.min(1, accel * dt * 0.18);
        state.vy += ((iy / len) * speed * 18 - state.vy) * Math.min(1, accel * dt * 0.18);
        if (!ix && !iy) {
          state.vx *= 0.7;
          state.vy *= 0.7;
        }
      }
      moveAABB(state, dt);

      for (const c of coins) {
        if (!c.got && Math.hypot(c.x - state.x, c.y - state.y) < 10) {
          c.got = true;
          state.score += 1;
          blip(660, 0.05);
          setHud();
        }
      }
      for (const f of foes) {
        if (f.hp <= 0) continue;
        f.x += f.vx * dt;
        if (!isSide) f.y += (f.vy || 0) * dt;
        if (f.x < 12 || f.x > VW * 2) f.vx *= -1;
        if (Math.hypot(f.x - state.x, f.y - state.y) < 10) damage(1);
      }
      // Attack: B / J / K — short melee (handheld)
      if (keys.KeyJ || keys.KeyK || keys.KeyX) {
        for (const f of foes) {
          if (f.hp > 0 && Math.hypot(f.x - state.x, f.y - state.y) < 16) {
            f.hp = 0;
            state.score += 2;
            blip(180, 0.05);
            setHud();
          }
        }
      }
    }

    // Camera — snap to pixels, limited scroll
    const targetCX = Math.max(0, state.x - VW / 2);
    const targetCY = Math.max(0, state.y - VH / 2);
    state.camX += (targetCX - state.camX) * Math.min(1, 10 * dt);
    state.camY += (targetCY - state.camY) * Math.min(1, 10 * dt);
    const camX = Math.round(state.camX);
    const camY = Math.round(state.camY);

    // Draw at native res only
    gctx.fillStyle = C0;
    gctx.fillRect(0, 0, VW, VH);
    gctx.save();
    gctx.translate(-camX, -camY);

    // Ground / solids
    for (const s of solids) {
      gctx.fillStyle = C1;
      gctx.fillRect(s.x, s.y, s.w, s.h);
      gctx.fillStyle = C2;
      gctx.fillRect(s.x, s.y, s.w, 1); // 1px highlight — classic handheld
    }
    for (const c of coins) {
      if (!c.got) drawCoin(gctx, Math.round(c.x), Math.round(c.y), state.t);
    }
    for (const f of foes) {
      if (f.hp > 0) drawFoe(gctx, Math.round(f.x), Math.round(f.y));
    }
    if (!(state.inv > 0 && ((state.t * 20) | 0) % 2 === 0)) {
      drawHero(gctx, Math.round(state.x), Math.round(state.y), state.facing < 0);
    }
    gctx.restore();

    // HUD pips in-canvas (authentic)
    gctx.fillStyle = C3;
    for (let i = 0; i < state.hp; i++) {
      gctx.fillRect(4 + i * 6, 4, 4, 4);
    }
    gctx.fillStyle = C2;
    // score as dots
    for (let i = 0; i < Math.min(state.score, 12); i++) {
      gctx.fillRect(VW - 6 - i * 4, 4, 2, 2);
    }
    if (state.dead) {
      gctx.fillStyle = C0;
      gctx.fillRect(VW / 2 - 30, VH / 2 - 8, 60, 16);
      gctx.fillStyle = C3;
      gctx.fillRect(VW / 2 - 28, VH / 2 - 6, 56, 12);
    }

    // Integer scale blit to display
    dctx.imageSmoothingEnabled = false;
    dctx.clearRect(0, 0, display.width, display.height);
    dctx.drawImage(game, 0, 0, VW, VH, 0, 0, display.width, display.height);

    requestAnimationFrame(frame);
  }

  window.__GF_PLAYTEST__ = window.__GF_PLAYTEST__ || {
    recordDeath() {},
    recordRestart() {},
    recordJump() {},
    recordHit() {},
  };

  return {
    start() {
      setHud();
      last = performance.now();
      requestAnimationFrame(frame);
    },
  };
}
