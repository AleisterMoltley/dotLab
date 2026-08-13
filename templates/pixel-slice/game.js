/**
 * Pure Canvas2D pixel slice — engine = pixelart.js + pixelart-fx.js
 * Host injects SPEC + CONFIG. Zero Three.js.
 */
import {
  layeredRect,
  disc,
  makeBakedSprite,
  dirt,
} from './pixelart/pixelart.js';
import { pxShake } from './pixelart/pixelart-fx.js';

const SPEC = __SPEC__;
const CONFIG = __CONFIG__;

const SCALE = 3; // CSS pixels per game pixel
const VW = 320;
const VH = 180;

function hex(n) {
  const h = (n >>> 0).toString(16).padStart(6, '0');
  return '#' + h.slice(-6);
}

function pal3(body, shadow, hilite) {
  return {
    shadow: shadow || body,
    body,
    hilite: hilite || body,
  };
}

export function createGame({ genre, title }) {
  const pal = SPEC.palette || {};
  const bg = hex(pal.bg ?? 0x0a0612);
  const groundC = hex(pal.ground ?? 0x12101c);
  const accent = hex(pal.accent ?? 0xff2bd6);
  const enemyC = hex(pal.enemy ?? 0xb8ff00);
  const playerC = hex(pal.player ?? 0xff2bd6);
  const gridC = hex(pal.grid ?? 0x00f0ff);

  const PLAYER = pal3(playerC, '#3a1028', '#ffb0f0');
  const ENEMY = pal3(enemyC, '#2a4010', '#e8ff90');
  const GROUND = pal3(groundC, '#08060c', accent);
  const BLOCK = pal3(gridC, '#0a2030', '#a0ffff');

  const canvas = document.createElement('canvas');
  canvas.width = VW;
  canvas.height = VH;
  canvas.style.width = '100%';
  canvas.style.height = '100%';
  canvas.style.imageRendering = 'pixelated';
  canvas.style.imageRendering = 'crisp-edges';
  document.body.appendChild(canvas);
  const ctx = canvas.getContext('2d');
  ctx.imageSmoothingEnabled = false;

  const isSide = SPEC.camera === 'side' || SPEC.loop === 'jump' || SPEC.loop === 'run';

  // frames:0 → blit(ctx, x, y) static bake
  const heroBake = makeBakedSprite(
    (c) => {
      layeredRect(c, 5, 8, 6, 8, PLAYER);
      disc(c, 8, 6, 3, PLAYER);
      c.fillStyle = '#1a1020';
      c.fillRect(6, 18, 2, 2);
      c.fillRect(9, 18, 2, 2);
    },
    { size: 20, frames: 0, outline: null },
  );

  const foeBake = makeBakedSprite(
    (c) => {
      layeredRect(c, 3, 4, 10, 10, ENEMY);
      disc(c, 6, 7, 1.5, { shadow: '#000', body: '#1a1020', hilite: '#1a1020' });
      disc(c, 11, 7, 1.5, { shadow: '#000', body: '#1a1020', hilite: '#1a1020' });
    },
    { size: 16, frames: 0, outline: null },
  );

  const keys = Object.create(null);
  const state = {
    x: 40,
    y: isSide ? 100 : 90,
    vx: 0,
    vy: 0,
    onGround: false,
    hp: CONFIG.hp ?? 3,
    score: 0,
    dead: false,
    camX: 0,
    camY: 0,
    t: 0,
    hitFlash: 0,
    shakeT: 0,
  };

  const solids = [];
  const coins = [];
  const foes = [];
  const seed = (SPEC.seed || 1) >>> 0;
  function rnd(i) {
    let x = (seed + i * 9973) >>> 0;
    x ^= x << 13;
    x ^= x >>> 17;
    x ^= x << 5;
    return (x >>> 0) / 4294967296;
  }

  // Build a small level
  if (isSide) {
    solids.push({ x: 0, y: 140, w: 640, h: 40 });
    for (let i = 0; i < 8; i++) {
      const px = 60 + i * 70;
      const py = 100 - Math.floor(rnd(i) * 40);
      solids.push({ x: px, y: py, w: 48, h: 12 });
    }
    for (let i = 0; i < (SPEC.coinCount || 5); i++) {
      coins.push({ x: 80 + i * 55, y: 60 + rnd(i + 20) * 40, got: false });
    }
    for (let i = 0; i < Math.min(SPEC.enemyCount || 3, 6); i++) {
      foes.push({
        x: 120 + i * 80,
        y: 120,
        vx: 30 * (rnd(i) > 0.5 ? 1 : -1),
        hp: 1,
      });
    }
  } else if (SPEC.loop === 'run') {
    solids.push({ x: 0, y: 0, w: 16, h: 720 }, { x: 304, y: 0, w: 16, h: 720 });
    for (let i = 0; i < Math.max(8, SPEC.hazardCount || 8); i++) {
      const lane = i % 3;
      foes.push({
        x: 48 + lane * 88,
        y: 40 + i * 70,
        vx: 0,
        vy: 70,
        hp: 1,
        hazard: true,
      });
    }
    for (let i = 0; i < 4; i++) {
      coins.push({ x: 80 + (i % 3) * 70, y: 90 + i * 80, got: false });
    }
  } else if (SPEC.loop === 'race') {
    // vertical track + rivals (not a plaza)
    solids.push({ x: 0, y: 0, w: 16, h: 720 }, { x: 304, y: 0, w: 16, h: 720 });
    solids.push({ x: 0, y: 0, w: 320, h: 10 }, { x: 0, y: 700, w: 320, h: 20 });
    for (let i = 0; i < Math.max(4, SPEC.coinCount || 4); i++) {
      coins.push({ x: 40 + (i % 2) * 180, y: 80 + i * 90, got: false, gate: true });
    }
    for (let i = 0; i < Math.max(3, SPEC.enemyCount || 3); i++) {
      foes.push({
        x: 50 + i * 70,
        y: 140 + i * 40,
        vx: 0,
        vy: -28 - i * 6,
        hp: 1,
        rival: true,
      });
    }
  } else {
    // top-down room
    solids.push({ x: 0, y: 0, w: 400, h: 16 }, { x: 0, y: 200, w: 400, h: 16 });
    solids.push({ x: 0, y: 0, w: 16, h: 216 }, { x: 384, y: 0, w: 16, h: 216 });
    for (let i = 0; i < 6; i++) {
      solids.push({
        x: 40 + Math.floor(rnd(i) * 300),
        y: 40 + Math.floor(rnd(i + 3) * 140),
        w: 24,
        h: 24,
      });
    }
    for (let i = 0; i < (SPEC.coinCount || 5); i++) {
      coins.push({
        x: 40 + rnd(i + 9) * 300,
        y: 40 + rnd(i + 11) * 140,
        got: false,
      });
    }
    for (let i = 0; i < Math.min(SPEC.enemyCount || 4, 8); i++) {
      foes.push({
        x: 80 + rnd(i + 30) * 250,
        y: 60 + rnd(i + 40) * 100,
        vx: 20 * (rnd(i) > 0.5 ? 1 : -1),
        vy: 20 * (rnd(i + 1) > 0.5 ? 1 : -1),
        hp: 1,
      });
    }
  }

  const hud = document.getElementById('hud');
  function setHud() {
    if (!hud) return;
    hud.textContent = `${title || SPEC.title} · ${SPEC.verb} · HP ${state.hp} · ${state.score}${state.dead ? ' · R restart' : ''}`;
  }

  function rectHit(ax, ay, aw, ah, b) {
    return ax < b.x + b.w && ax + aw > b.x && ay < b.y + b.h && ay + ah > b.y;
  }

  function moveAABB(ent, dt) {
    const w = 10;
    const h = 14;
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

  function damage(n) {
    if (state.dead || state.hitFlash > 0) return;
    state.hp -= n;
    state.hitFlash = 0.4;
    state.shakeT = 0.25;
    if (window.__GF_PLAYTEST__?.recordHit) window.__GF_PLAYTEST__.recordHit();
    if (state.hp <= 0) {
      state.dead = true;
      if (window.__GF_PLAYTEST__?.recordDeath) window.__GF_PLAYTEST__.recordDeath();
    }
    setHud();
  }

  function restart() {
    state.x = 40;
    state.y = isSide ? 100 : 90;
    state.vx = state.vy = 0;
    state.hp = CONFIG.hp ?? 3;
    state.score = 0;
    state.dead = false;
    state.hitFlash = 0;
    coins.forEach((c) => {
      c.got = false;
    });
    if (window.__GF_PLAYTEST__?.recordRestart) window.__GF_PLAYTEST__.recordRestart();
    setHud();
  }

  addEventListener('keydown', (e) => {
    keys[e.code] = true;
    if (e.code === 'KeyR') restart();
  });
  addEventListener('keyup', (e) => {
    keys[e.code] = false;
  });

  // Simple blip via WebAudio (no three craft dependency)
  let ac;
  function blip(f = 440, dur = 0.05) {
    try {
      ac = ac || new (window.AudioContext || window.webkitAudioContext)();
      const o = ac.createOscillator();
      const g = ac.createGain();
      o.frequency.value = f;
      g.gain.value = 0.04;
      o.connect(g);
      g.connect(ac.destination);
      o.start();
      o.stop(ac.currentTime + dur);
    } catch (_) {}
  }

  let last = performance.now();
  function frame(now) {
    const dt = Math.min(0.05, (now - last) / 1000);
    last = now;
    state.t += dt;
    if (state.hitFlash > 0) state.hitFlash -= dt;
    if (state.shakeT > 0) state.shakeT -= dt;

    if (!state.dead) {
      const speed = CONFIG.moveSpeed ?? 6;
      const accel = CONFIG.accel ?? 40;
      const fric = CONFIG.friction ?? 24;
      let ix = 0;
      let iy = 0;
      if (keys.KeyA || keys.ArrowLeft) ix -= 1;
      if (keys.KeyD || keys.ArrowRight) ix += 1;
      if (!isSide) {
        if (keys.KeyW || keys.ArrowUp) iy -= 1;
        if (keys.KeyS || keys.ArrowDown) iy += 1;
      }
      if (isSide) {
        state.vx += (ix * speed - state.vx) * Math.min(1, accel * dt * 0.12);
        state.vy += (CONFIG.gravity ?? 28) * dt * 10;
        if ((keys.Space || keys.KeyW || keys.ArrowUp) && state.onGround) {
          state.vy = -(CONFIG.jumpForce ?? 9) * 12;
          state.onGround = false;
          if (window.__GF_PLAYTEST__?.recordJump) window.__GF_PLAYTEST__.recordJump();
          blip(520, 0.04);
        }
        if (!(keys.Space || keys.KeyW || keys.ArrowUp) && state.vy < 0) {
          state.vy *= CONFIG.jumpCut ?? 0.45;
        }
      } else {
        const len = Math.hypot(ix, iy) || 1;
        const tx = (ix / len) * speed * 20;
        const ty = (iy / len) * speed * 20;
        state.vx += (tx - state.vx) * Math.min(1, accel * dt * 0.15);
        state.vy += (ty - state.vy) * Math.min(1, accel * dt * 0.15);
        if (!ix && !iy) {
          state.vx *= Math.max(0, 1 - fric * dt * 0.15);
          state.vy *= Math.max(0, 1 - fric * dt * 0.15);
        }
      }
      moveAABB(state, dt);

      for (const c of coins) {
        if (!c.got && Math.hypot(c.x - state.x, c.y - state.y) < 12) {
          c.got = true;
          state.score += 1;
          blip(880, 0.06);
          setHud();
        }
      }
      for (const f of foes) {
        if (f.hp <= 0) continue;
        f.x += f.vx * dt;
        if (!isSide) f.y += (f.vy || 0) * dt;
        if (f.x < 20 || f.x > 360) f.vx *= -1;
        if (Math.hypot(f.x - state.x, f.y - state.y) < 12) damage(1);
      }
      // click / attack for shoot-ish genres
      if ((SPEC.loop === 'shoot' || keys.KeyJ || keys.KeyK) && keys.KeyJ) {
        for (const f of foes) {
          if (f.hp > 0 && Math.hypot(f.x - state.x, f.y - state.y) < 28) {
            f.hp = 0;
            state.score += 2;
            state.shakeT = 0.12;
            blip(200, 0.05);
            setHud();
          }
        }
      }
    }

    // camera
    state.camX += (state.x - VW / 2 - state.camX) * Math.min(1, (CONFIG.camLag ?? 10) * dt);
    state.camY += (state.y - VH / 2 - state.camY) * Math.min(1, (CONFIG.camLag ?? 10) * dt);
    let shx = 0;
    let shy = 0;
    if (state.shakeT > 0) {
      shx = (Math.random() - 0.5) * 4 * state.shakeT * 8;
      shy = (Math.random() - 0.5) * 4 * state.shakeT * 8;
    }

    // draw
    ctx.save();
    ctx.imageSmoothingEnabled = false;
    ctx.fillStyle = bg;
    ctx.fillRect(0, 0, VW, VH);
    ctx.translate(Math.round(-state.camX + shx), Math.round(-state.camY + shy));

    for (const s of solids) {
      try {
        if (typeof dirt === 'function') dirt(ctx, s.x, s.y, s.w, s.h, GROUND, { seed: seed });
        else layeredRect(ctx, s.x, s.y, s.w, s.h, GROUND);
      } catch (_) {
        layeredRect(ctx, s.x, s.y, s.w, s.h, BLOCK);
      }
    }
    for (const c of coins) {
      if (c.got) continue;
      disc(ctx, c.x + 4, c.y + 4, 4, pal3(accent, '#402010', '#fff0a0'));
    }
    for (const f of foes) {
      if (f.hp <= 0) continue;
      foeBake(ctx, Math.round(f.x), Math.round(f.y));
    }

    const hx = Math.round(state.x) - 2;
    const hy = Math.round(state.y) - 2;
    if (state.hitFlash > 0 && state.hitFlash % 0.08 < 0.04) {
      /* flash skip */
    } else if (state.shakeT > 0.1) {
      pxShake(
        ctx,
        hx,
        hy,
        20,
        22,
        (oc, ox, oy) => {
          heroBake(oc, ox, oy);
        },
        state.t,
        { amp: 1 },
      );
    } else {
      heroBake(ctx, hx, hy);
    }

    ctx.restore();
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
