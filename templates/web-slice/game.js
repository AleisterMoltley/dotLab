/**
 * Grok craft slice — ship bar = NEON INK vertical quality (skill arcade).
 * Host owns SPEC+CONFIG via slice/patch. Zero external assets.
 */
import * as THREE from 'three';
import { TimeJuice, calloutForStreak, makeShake, pulseShake, decayShake } from './craft/juice.js';
import { sfx } from './craft/audio.js';
import { applyLook } from './look/index.js';
import { SCALE } from './craft/scale.js';
import { springTo, fpsLook, chaseIdeal, applyShake, kickFov } from './craft/camera.js';
import { spinY, bobY, squashLand, unsquash, popOut } from './craft/motion.js';
import { makeTracerPool } from './craft/pool.js';
import { punch } from './craft/punch.js';
import { attachBlob } from './craft/blob.js';
import { PHASE, armBrain, tickBrain, striking } from './craft/brain.js';
import { makeRecoil, kickRecoil, springRecoil } from './craft/recoil.js';
import { makeImpactPool } from './craft/impact.js';
import { makeMarkPool } from './craft/mark.js';
import { attachVignette } from './craft/vignette.js';
import { ENGINE, applyEngine } from './craft/engine.js';
import { tickDirector } from './craft/director.js';
import { pickToy } from './craft/toys.js';
import { pickBody, makePlayer, makeEnemy, makeWeapon, makeCover, tickPose } from './body/index.js';

const SPEC = __SPEC__;
const CONFIG = __CONFIG__;

export function createGame({ genre, title }) {
  const pal = SPEC.palette;
  const bg = pal.bg;
  const isFps = SPEC.camera === 'fps' || SPEC.loop === 'shoot';

  const scene = new THREE.Scene();
  scene.background = new THREE.Color(bg);
  scene.fog = new THREE.Fog(bg, pal.fogNear ?? 8, pal.fogFar ?? 70);

  const camera = new THREE.PerspectiveCamera(
    CONFIG.fov || (isFps ? 78 : 58),
    innerWidth / innerHeight,
    0.05,
    280,
  );
  camera.position.set(0, CONFIG.eyeHeight || SCALE.eye, 8);
  applyEngine(camera, scene);

  const renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: 'high-performance' });
  renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
  renderer.setSize(innerWidth, innerHeight);
  renderer.shadowMap.enabled = !isFps;
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  document.body.appendChild(renderer.domElement);
  scene.add(camera);
  const look = applyLook({ scene, renderer, camera, pal, spec: SPEC });
  const bodySpec = pickBody(SPEC);
  const toy = pickToy(SPEC);
  try {
    window.__GF_RENDERER__ = renderer;
    window.__GF_ENGINE__ = ENGINE;
    window.__GF_TOY__ = toy;
  } catch { /* */ }

  const hud = ensureHud();
  const cross = ensureCrosshair(isFps);
  const hitmark = ensureHitmark();
  const keys = Object.create(null);
  const pointer = { locked: false, mx: 0, my: 0 };
  const timeJuice = new TimeJuice();
  const shake = makeShake();
  const state = {
    hp: CONFIG.hp ?? 100,
    score: 0,
    streak: 0,
    dead: false,
    lastGround: 0,
    jumpBuf: 0,
    dashCd: 0,
    dashT: 0,
    fireCd: 0,
    ads: false,
    now: 0,
    wave: 1,
    callout: '',
    calloutT: 0,
    fovPunch: 0,
  };

  const _fwd = new THREE.Vector3();
  const _right = new THREE.Vector3();
  const _wish = new THREE.Vector3();
  const _look = new THREE.Vector3();
  const _ideal = new THREE.Vector3();
  const _ray = new THREE.Raycaster();
  const _ndc = new THREE.Vector2();
  const _origin = new THREE.Vector3();
  const _dir = new THREE.Vector3();

  const rnd = lcg(SPEC.seed || 1);
  const world = buildWorld(scene, rnd, pal, SPEC) || {};
  const player = buildPlayer(scene, pal, CONFIG);
  const actors = buildActors(scene, rnd, pal, SPEC);
  actors.covers = world.covers || [];
  if (actors.start) player.pos.set(actors.start.x, actors.start.y, actors.start.z);
  for (const e of actors.enemies) armBrain(e);
  if (actors.hunter) {
    const hb = actors.hunter.userData && actors.hunter.userData.body;
    actors.hunterEnt = armBrain({
      mesh: actors.hunter,
      core: hb && hb.core,
      hp: 1,
      speed: 1.6,
      baseY: actors.hunter.position.y,
    });
  }
  const weapon = buildWeapon(camera, pal);
  const tracers = makeTracerPool(scene, 28);
  const impacts = makeImpactPool(scene, 24);
  const marks = makeMarkPool(scene, 12);
  const playerBlob = attachBlob(scene, { radius: SCALE.capsuleR });
  const vignette = attachVignette();
  const recoil = makeRecoil();
  const stack = {
    timeJuice,
    shake,
    sfx,
    juiceMul: SPEC.juice || 1,
    hitmark: () => flashHitmark(),
  };
  let wasGrounded = true;

  bindInput();
  updateHud();

  let last = performance.now();

  function update(rawDt) {
    const dt = rawDt * timeJuice.update(rawDt);
    if (look && look.tick) look.tick(dt);
    if (state.calloutT > 0) state.calloutT -= rawDt;
    if (state.fireCd > 0) state.fireCd -= dt;
    if (state.dashCd > 0) state.dashCd -= dt;
    if (state.dashT > 0) state.dashT -= dt;

    if (state.dead) {
      camera.position.y += rawDt * 0.55;
      vignette.tick(rawDt);
      return;
    }

    const prevY = player.pos.y;
    const eye = CONFIG.eyeHeight || SCALE.eye;
    let grounded = false;
    if (SPEC.loop === 'jump') {
      player.vy -= (CONFIG.gravity || 28) * dt;
      player.pos.y += player.vy * dt;
      const plats = actors.platforms || [];
      let support = -Infinity;
      for (const p of plats) {
        if (Math.abs(player.pos.x - p.x) <= p.hw && Math.abs(player.pos.z - p.z) <= p.hd) {
          if (p.eye > support) support = p.eye;
        }
      }
      if (Number.isFinite(support) && player.vy <= 0.2 && prevY >= support - 0.15 && player.pos.y <= support + 0.12) {
        player.pos.y = support;
        player.vy = 0;
        grounded = true;
      }
      if (player.pos.y < -4) die();
    } else {
      grounded = player.pos.y <= eye + 0.02;
      if (grounded) {
        player.pos.y = eye;
        player.vy = 0;
      } else {
        player.vy -= (CONFIG.gravity || 28) * dt;
        player.pos.y += player.vy * dt;
      }
    }
    if (grounded) state.lastGround = state.now;
    if (grounded && !wasGrounded) {
      if (!isFps) squashLand(player.mesh, 0.16);
      punch(stack, 'land');
    }
    wasGrounded = grounded;
    if (!isFps) unsquash(player.mesh, dt);
    try {
      window.__GF_PLAYTEST__?.recordSample?.({
        x: player.pos.x, y: player.pos.y, z: player.pos.z, grounded,
      });
    } catch { /* */ }

    if (isFps && pointer.locked) {
      player.yaw -= pointer.mx * (CONFIG.mouseSens || 0.002);
      player.pitch = THREE.MathUtils.clamp(
        player.pitch - pointer.my * (CONFIG.mouseSens || 0.002),
        CONFIG.pitchMin ?? -1.2,
        CONFIG.pitchMax ?? 1.2,
      );
    }
    pointer.mx = 0;
    pointer.my = 0;

    wishDir(_wish, _fwd, _right);
    if (SPEC.loop === 'run') {
      _wish.z -= 1;
      if (_wish.lengthSq() > 0) _wish.normalize();
    }

    // Dash
    if (state.dashT > 0) {
      const dspd = CONFIG.dashSpeed || 22;
      player.vx = -Math.sin(player.yaw) * dspd * (isFps ? 1 : 0) + (isFps ? 0 : player.vx);
      player.vz = -Math.cos(player.yaw) * dspd * (isFps ? 1 : 0) + (isFps ? 0 : player.vz);
      if (!isFps) {
        player.vx = _wish.x * dspd;
        player.vz = _wish.z * dspd;
      }
    } else {
      const speed = SPEC.loop === 'run' ? (CONFIG.runSpeed || 12) : (CONFIG.moveSpeed || 7.2);
      const targetX = _wish.x * speed;
      const targetZ = _wish.z * speed;
      const k = (CONFIG.accel || 50) * 0.35;
      player.vx = THREE.MathUtils.damp(player.vx, targetX, k, dt);
      player.vz = THREE.MathUtils.damp(player.vz, targetZ, k, dt);
    }
    player.pos.x += player.vx * dt;
    player.pos.z += player.vz * dt;
    if (SPEC.loop === 'shoot') {
      const rad = 12.0;
      const d2 = Math.hypot(player.pos.x, player.pos.z);
      if (d2 > rad) {
        player.pos.x *= rad / d2;
        player.pos.z *= rad / d2;
        player.vx *= 0.4;
        player.vz *= 0.4;
      }
      for (const c of actors.covers || []) {
        const dx = player.pos.x - c.x;
        const dz = player.pos.z - c.z;
        if (Math.abs(dx) < c.hw && Math.abs(dz) < c.hd) {
          if (Math.abs(dx) * c.hd > Math.abs(dz) * c.hw) {
            player.pos.x = c.x + Math.sign(dx || 1) * c.hw;
            player.vx = 0;
          } else {
            player.pos.z = c.z + Math.sign(dz || 1) * c.hd;
            player.vz = 0;
          }
        }
      }
    }

    const wantJump = state.jumpBuf > 0;
    const coyote = state.now - state.lastGround <= (CONFIG.coyoteMs || 100) / 1000;
    if (wantJump && (grounded || coyote) && player.vy <= 0.05) {
      player.vy = CONFIG.jumpForce || 8.4;
      state.jumpBuf = 0;
      sfx('jump');
      pt('recordJump');
    }
    if (!keys['Space'] && player.vy > 0) player.vy *= CONFIG.jumpCut || 0.42;

    // ADS
    state.ads = !!(keys['MouseRight'] || keys['KeyE']);
    if (state.fovPunch > 0) state.fovPunch = Math.max(0, state.fovPunch - dt * 18);
    const targetFov = (state.ads ? (CONFIG.adsFov || 62) : (CONFIG.fov || (isFps ? 78 : 58))) + state.fovPunch;
    kickFov(camera, targetFov, dt, 10);

    player.mesh.position.set(player.pos.x, player.pos.y - (CONFIG.eyeHeight || SCALE.eye), player.pos.z);
    player.mesh.rotation.y = player.yaw;
    tickPose(player, {
      now: state.now,
      dt,
      moving: Math.hypot(player.vx, player.vz) > 0.4,
      phase: 0,
    });
    if (state.dashT > 0 && toy === 'dash-slash') {
      for (const e of actors.enemies) {
        if (e.hp <= 0 || e.dashHit) continue;
        const dd = Math.hypot(player.pos.x - e.mesh.position.x, player.pos.z - e.mesh.position.z);
        if (dd < 1.6) {
          e.dashHit = true;
          e.hp -= 2;
          punch(stack, e.hp <= 0 ? 'kill' : 'hit');
          if (e.hp <= 0) {
            e.popT = 0;
            state.score += 10;
            updateHud();
          }
        }
      }
    } else if (state.dashT <= 0) {
      for (const e of actors.enemies) e.dashHit = false;
    }
    playerBlob.follow(player.pos.x, player.pos.z);
    if (!grounded && SPEC.loop === 'jump') playerBlob.hide();
    else playerBlob.show();

    placeCamera(dt);
    applyShake(camera, decayShake(shake, dt), state.now);
    springRecoil(recoil, dt);
    weapon.applyRecoil(recoil);
    vignette.tick(dt);

    tickLoop(dt);
    tracers.tick(dt);
    impacts.tick(dt);
    marks.tick(dt, state.now);
    if (isFps && (keys['MouseLeft'] || keys['KeyF'])) tryFire();
  }

  function wishDir(out, fwd, right) {
    out.set(0, 0, 0);
    if (isFps) {
      fwd.set(Math.sin(player.yaw), 0, Math.cos(player.yaw));
      right.set(fwd.z, 0, -fwd.x);
    } else if (SPEC.camera === 'side') {
      fwd.set(0, 0, 0);
      right.set(1, 0, 0);
    } else {
      fwd.set(0, 0, 1);
      right.set(1, 0, 0);
    }
    if (keys['KeyW'] || keys['ArrowUp']) out.addScaledVector(fwd, isFps ? -1 : -1);
    if (keys['KeyS'] || keys['ArrowDown']) out.addScaledVector(fwd, isFps ? 1 : 1);
    if (keys['KeyA'] || keys['ArrowLeft']) out.addScaledVector(right, -1);
    if (keys['KeyD'] || keys['ArrowRight']) out.addScaledVector(right, 1);
    if (SPEC.camera === 'side') {
      out.set(0, 0, 0);
      if (keys['KeyA'] || keys['ArrowLeft']) out.x -= 1;
      if (keys['KeyD'] || keys['ArrowRight']) out.x += 1;
    }
    if (out.lengthSq() > 0) out.normalize();
    return out;
  }

  function placeCamera(dt) {
    if (isFps) {
      fpsLook(camera, player.pos, player.yaw, player.pitch, _look);
      player.mesh.visible = false;
      weapon.visible = true;
      return;
    }
    player.mesh.visible = true;
    weapon.visible = false;
    chaseIdeal(_ideal, player.pos, CONFIG, SPEC.camera);
    springTo(camera, _ideal, dt, CONFIG.camLag || 8);
    camera.lookAt(player.pos.x, player.pos.y - 0.2, player.pos.z);
  }

  function tickLoop(dt) {
    const loop = SPEC.loop;
    if (loop === 'shoot') tickShoot(dt);
    else if (loop === 'jump') tickJump(dt);
    else if (loop === 'run') tickRun(dt);
    else if (loop === 'race') tickRace(dt);
    else if (loop === 'sneak') tickSneak(dt);
    else tickTalk(dt);
    if (loop !== 'shoot' && actors.enemies && actors.enemies.length) tickThreat(dt);
  }

  function tickThreat(dt) {
    tickDirector(actors.enemies, player.pos.x, player.pos.z, { max: 3 });
    for (const e of actors.enemies) {
      if (e.hp <= 0) {
        if (e.popT != null) {
          e.popT += dt;
          popOut(e.mesh, e.popT);
        }
        marks.hide(e.mesh.id);
        continue;
      }
      if (e.stickyT > 0) {
        e.stickyT -= dt;
        if (e.stickyT <= 0) {
          e.hp -= 1;
          punch(stack, e.hp <= 0 ? 'kill' : 'hit');
          if (e.hp <= 0) e.popT = 0;
        }
      }
      tickBrain(e, player.pos.x, player.pos.z, dt, state.now, {
        aggro: e.elite ? 10 : 7,
        windup: e.elite ? 0.48 : 0.32,
      });
      const dx = player.pos.x - e.mesh.position.x;
      const dz = player.pos.z - e.mesh.position.z;
      const d = Math.hypot(dx, dz) || 1;
      if (d < 1.45) {
        e.mesh.position.x -= (dx / d) * (1.45 - d);
        e.mesh.position.z -= (dz / d) * (1.45 - d);
      }
      if (e.phase === PHASE.windup) {
        marks.show(e.lockX, e.lockZ, e.mesh.id, e.elite ? pal.grid : pal.accent);
      } else {
        marks.hide(e.mesh.id);
      }
      tickPose(e, { now: state.now, dt, phase: e.phase, moving: true });
      if (striking(e) && state.dashT <= 0 && d < 1.35) {
        hurt((e.elite ? 18 : 12) * dt * 8);
      }
    }
  }

  function tickShoot(dt) {
    tickThreat(dt);
    let alive = 0;
    for (const e of actors.enemies) if (e.hp > 0) alive++;
    if (alive === 0) {
      state.wave += 1;
      spawnWave(actors, scene, rnd, pal, SPEC, state.wave);
      showBanner(`WAVE ${state.wave}`);
      sfx('kill');
    }
  }

  function tickJump(dt) {
    for (const c of actors.coins) {
      if (c.taken) continue;
      spinY(c.mesh, dt, 0.55);
      if (c.baseY != null) bobY(c.mesh, c.baseY, state.now, 0, 0.12, 1.4);
      const d = Math.hypot(player.pos.x - c.mesh.position.x, player.pos.z - c.mesh.position.z);
      if (d < 1.1) {
        c.taken = true;
        c.mesh.visible = false;
        state.score += 1;
        punch(stack, 'hit');
        updateHud();
      }
    }
    if (player.pos.y < -4) die();
    for (const o of actors.hazards || []) {
      if (Math.hypot(player.pos.x - o.mesh.position.x, player.pos.z - o.mesh.position.z) < 1.05) die();
    }
  }

  function tickRun(dt) {
    for (const o of actors.hazards) {
      o.mesh.position.z += (CONFIG.runSpeed || 12) * dt;
      if (o.mesh.position.z > player.pos.z + 8) {
        o.mesh.position.z -= 48;
        o.mesh.position.x = (Math.floor(rnd() * 3) - 1) * 2.2;
      }
      if (Math.hypot(player.pos.x - o.mesh.position.x, player.pos.z - o.mesh.position.z) < 1.05) die();
    }
    state.score = Math.floor(-player.pos.z);
  }

  function tickRace(dt) {
    const gates = actors.gates || (actors.gate ? [actors.gate] : []);
    for (const gate of gates) {
      if (!gate || gate.taken) continue;
      if (Math.hypot(player.pos.x - gate.position.x, player.pos.z - gate.position.z) < 2.4) {
        gate.taken = true;
        gate.visible = false;
        state.score += 1;
        punch(stack, 'hit');
        updateHud();
      }
    }
    const rivals = actors.rivals || [];
    for (let i = 0; i < rivals.length; i++) {
      const r = rivals[i];
      const lead = (player.pos.z - r.mesh.position.z);
      const rubber = lead > 4 ? 1.25 : lead < -6 ? 0.72 : 1;
      r.mesh.position.z -= r.speed * rubber * dt;
      r.mesh.position.x += Math.sin(state.now * r.wobble + r.phase) * r.sway * dt;
      r.mesh.rotation.y = Math.PI;
      if (Math.hypot(player.pos.x - r.mesh.position.x, player.pos.z - r.mesh.position.z) < 1.15) {
        hurt(8);
        pulseShake(shake, 0.18);
      }
    }
    if (Math.abs(player.pos.x) > 9.5) die();
    if (player.pos.y < -2) die();
    if (gates.length && gates.every((g) => g.taken)) {
      showBanner('LAP');
      for (const g of gates) {
        g.taken = false;
        g.visible = true;
        g.position.z -= 48;
      }
    }
  }

  function tickSneak(dt) {
    const hunter = actors.hunter;
    const h = actors.hunterEnt;
    if (!hunter) return;
    if (h) {
      tickBrain(h, player.pos.x, player.pos.z, dt, state.now, { aggro: 11, windup: 0.4, strike: 0.14 });
      if (h.phase === PHASE.windup) marks.show(h.lockX, h.lockZ, hunter.id, pal.enemy);
      else marks.hide(hunter.id);
      if (striking(h)) {
        const d = Math.hypot(player.pos.x - hunter.position.x, player.pos.z - hunter.position.z);
        if (d < 1.3) die();
      }
    } else {
      const dx = player.pos.x - hunter.position.x;
      const dz = player.pos.z - hunter.position.z;
      const d = Math.hypot(dx, dz) || 1;
      hunter.position.x += (dx / d) * 1.6 * dt;
      hunter.position.z += (dz / d) * 1.6 * dt;
      if (d < 1.3) die();
    }
    const door = actors.door;
    if (door && Math.hypot(player.pos.x - door.position.x, player.pos.z - door.position.z) < 1.6) {
      state.score = 1;
      showBanner('ESCAPED');
    }
  }

  function tickTalk(dt) {
    for (const n of actors.npcs) {
      const d = Math.hypot(player.pos.x - n.mesh.position.x, player.pos.z - n.mesh.position.z);
      if (d < 2.2 && keys['KeyE'] && !n.talked) {
        n.talked = true;
        state.score += 1;
        scene.background = new THREE.Color(pal.accent);
        scene.fog.color.set(pal.accent);
        sfx('hit');
        showBanner('FLAG SET — the door opens');
        if (actors.door) {
          actors.door.userData.open = true;
          if (actors.door.material) actors.door.material.emissiveIntensity = 1.3;
        }
        updateHud();
      }
    }
    if (actors.door && !actors.door.userData.used) {
      const dd = Math.hypot(player.pos.x - actors.door.position.x, player.pos.z - actors.door.position.z);
      if (dd < 1.6) {
        if (actors.door.userData.open) {
          actors.door.userData.used = true;
          state.score += 2;
          showBanner('THROUGH');
          actors.door.position.y = -10;
        } else {
          showBanner('TALK FIRST');
        }
      }
    }
    for (const c of actors.coins) {
      if (c.taken) continue;
      spinY(c.mesh, dt || 0.016, 0.4);
      if (c.baseY != null) bobY(c.mesh, c.baseY, state.now, 0, 0.1, 1.3);
      if (Math.hypot(player.pos.x - c.mesh.position.x, player.pos.z - c.mesh.position.z) < 1.1) {
        c.taken = true;
        c.mesh.visible = false;
        state.score += 1;
        punch(stack, 'hit');
        updateHud();
      }
    }
  }

  function tryFire() {
    if (state.dead || SPEC.loop !== 'shoot') return;
    if (state.fireCd > 0) return;
    const rpm = CONFIG.fireRpm || 480;
    state.fireCd = 60 / rpm;
    weapon.flash();
    punch(stack, 'shoot');
    kickRecoil(recoil, state.ads);
    state.fovPunch = Math.min(10, state.fovPunch + (state.ads ? 2 : 4));

    const spread = state.ads ? (CONFIG.adsSpread ?? 0.004) : (CONFIG.spread ?? 0.014);
    _ndc.set((Math.random() - 0.5) * spread * 40, (Math.random() - 0.5) * spread * 40);
    _ray.setFromCamera(_ndc, camera);
    tracers.spawn(_ray.ray.origin, _ray.ray.direction, pal.grid || 0x00f0ff);

    const live = actors.enemies.filter((e) => e.hp > 0).map((e) => e.core || e.mesh);
    let hits = _ray.intersectObjects(live, true);
    if (!hits[0] && toy === 'ricochet') {
      _dir.copy(_ray.ray.direction);
      _dir.x *= -1;
      _ray.ray.direction.copy(_dir);
      tracers.spawn(_ray.ray.origin, _dir, pal.accent || pal.grid);
      hits = _ray.intersectObjects(live, true);
    }
    if (hits[0]) {
      const hitObj = hits[0].object;
      const e = actors.enemies.find((x) => {
        let o = hitObj;
        while (o) {
          if (o === x.mesh || o === x.core) return true;
          o = o.parent;
        }
        return false;
      });
      if (e) {
        const dmg = CONFIG.damage || 18;
        e.hp -= dmg;
        if (e.core && e.core.material) e.core.material.emissiveIntensity = 2.4;
        if (toy === 'time-gun') e.freezeT = 0.5;
        if (toy === 'sticky') e.stickyT = 0.45;
        impacts.spawn(hits[0].point, pal.accent);
        const nx = e.mesh.position.x - player.pos.x;
        const nz = e.mesh.position.z - player.pos.z;
        const nd = Math.hypot(nx, nz) || 1;
        e.mesh.position.x += (nx / nd) * 0.42;
        e.mesh.position.z += (nz / nd) * 0.42;
        if (e.hp <= 0) {
          e.popT = 0;
          punch(stack, 'kill');
          state.streak += 1;
          state.score += 10 * Math.min(state.streak, 5);
          const co = calloutForStreak(state.streak);
          state.callout = co;
          state.calloutT = 1.1;
          showBanner(co || '+10');
          setTimeout(() => {
            if (state.dead) return;
            e.hp = 1 + Math.floor(state.wave / 2);
            e.popT = null;
            e.mesh.visible = true;
            e.mesh.scale.setScalar(1);
            armBrain(e);
            const a = Math.random() * Math.PI * 2;
            const r = 8 + Math.random() * 12;
            e.mesh.position.set(Math.cos(a) * r, e.baseY, Math.sin(a) * r - 4);
          }, 1600);
        } else {
          punch(stack, 'hit');
        }
        updateHud();
      }
    } else {
      state.streak = 0;
    }
  }

  function hurt(n) {
    if (state.dead || state.dashT > 0) return;
    state.hp -= n;
    punch(stack, 'hurt');
    vignette.flash(0.7);
    updateHud();
    if (state.hp <= 0) die();
  }

  function die() {
    if (state.dead) return;
    state.dead = true;
    state.streak = 0;
    punch(stack, 'death');
    vignette.flash(0.95);
    pt('recordDeath');
    updateHud();
    showBanner('Dead — R for one more run');
  }

  function tryDash() {
    if (state.dashCd > 0 || state.dead) return;
    state.dashT = (CONFIG.dashMs || 140) / 1000;
    state.dashCd = (CONFIG.dashCdMs || 700) / 1000;
    pulseShake(shake, 0.2);
    sfx('dash');
  }

  function restart() {
    state.hp = CONFIG.hp ?? 100;
    state.score = 0;
    state.streak = 0;
    state.dead = false;
    state.wave = 1;
    shake.amount = 0;
    state.fovPunch = 0;
    vignette.clear();
    wasGrounded = true;
    const start = actors.start || { x: 0, y: CONFIG.eyeHeight || SCALE.eye, z: SPEC.loop === 'run' ? 0 : 6 };
    player.pos.set(start.x, start.y, start.z);
    player.vx = player.vz = player.vy = 0;
    player.yaw = 0;
    player.pitch = 0;
    scene.background = new THREE.Color(bg);
    scene.fog.color.set(bg);
    for (const e of actors.enemies) {
      e.hp = 1;
      e.popT = null;
      e.mesh.visible = true;
      e.mesh.scale.setScalar(1);
      e.mesh.position.set(e.sx, e.baseY, e.sz);
      armBrain(e);
      marks.hide(e.mesh.id);
    }
    if (actors.hunterEnt) armBrain(actors.hunterEnt);
    for (const c of actors.coins) {
      c.taken = false;
      c.mesh.visible = true;
    }
    for (const n of actors.npcs) n.talked = false;
    for (const g of actors.gates || []) {
      g.taken = false;
      g.visible = true;
    }
    if (actors.door && actors.door.userData) actors.door.userData.open = false;
    updateHud();
    pt('recordRestart');
  }

  function bindInput() {
    addEventListener('keydown', (e) => {
      keys[e.code] = true;
      if (e.code === 'Space') state.jumpBuf = (CONFIG.jumpBufferMs || 90) / 1000;
      if (e.code === 'KeyR') restart();
      if (e.code === 'ShiftLeft' || e.code === 'ShiftRight') tryDash();
    });
    addEventListener('keyup', (e) => { keys[e.code] = false; });
    addEventListener('mousedown', (e) => {
      if (e.button === 0) keys['MouseLeft'] = true;
      if (e.button === 2) keys['MouseRight'] = true;
    });
    addEventListener('mouseup', (e) => {
      if (e.button === 0) keys['MouseLeft'] = false;
      if (e.button === 2) keys['MouseRight'] = false;
    });
    addEventListener('contextmenu', (e) => e.preventDefault());
    addEventListener('resize', () => {
      camera.aspect = innerWidth / innerHeight;
      camera.updateProjectionMatrix();
      renderer.setSize(innerWidth, innerHeight);
    });
    renderer.domElement.addEventListener('click', () => {
      if (isFps) {
        try {
          const p = renderer.domElement.requestPointerLock?.();
          if (p && typeof p.catch === 'function') p.catch(() => {});
        } catch { /* playtest / iframe */ }
      }
      if (SPEC.loop === 'shoot') tryFire();
    });
    addEventListener('pointerlockchange', () => {
      pointer.locked = document.pointerLockElement === renderer.domElement;
      updateHud();
    });
    addEventListener('mousemove', (e) => {
      if (!pointer.locked) return;
      pointer.mx += e.movementX;
      pointer.my += e.movementY;
    });
  }

  function frame(now) {
    const rawDt = Math.min(0.05, (now - last) / 1000);
    last = now;
    state.now += rawDt;
    if (state.jumpBuf > 0) state.jumpBuf -= rawDt;
    update(rawDt);
    renderer.render(scene, camera);
    requestAnimationFrame(frame);
  }

  function updateHud() {
    const lock = isFps && !pointer.locked ? ' · click to look' : '';
    const dead = state.dead ? ' · R one more run' : '';
    const ads = state.ads ? ' · ADS' : '';
    const co = state.calloutT > 0 && state.callout ? ` · ${state.callout}` : '';
    hud.textContent =
      `${title} · ${SPEC.verb}${lock}${ads}${dead}${co} · hp ${Math.max(0, Math.ceil(state.hp))} · ${state.score}` +
      (SPEC.loop === 'shoot' ? ` · W${state.wave}` : '');
  }

  function showBanner(msg) {
    let el = document.getElementById('gm-banner');
    if (!el) {
      el = document.createElement('div');
      el.id = 'gm-banner';
      el.style.cssText =
        'position:fixed;left:50%;top:40%;transform:translate(-50%,-50%);color:#b8ff00;' +
        'font:800 26px/1.2 system-ui,sans-serif;text-shadow:0 0 12px #ff2bd6,0 2px 8px #000;' +
        'pointer-events:none;z-index:6;text-align:center;max-width:80vw;letter-spacing:0.06em';
      document.body.appendChild(el);
    }
    el.textContent = msg;
    el.style.opacity = '1';
    clearTimeout(el._t);
    el._t = setTimeout(() => { el.style.opacity = '0'; }, 1200);
  }

  function flashHitmark() {
    if (!hitmark) return;
    hitmark.style.opacity = '1';
    clearTimeout(hitmark._t);
    hitmark._t = setTimeout(() => { hitmark.style.opacity = '0'; }, 70);
  }

  function pt(method) {
    try { window.__GF_PLAYTEST__?.[method]?.(); } catch { /* */ }
  }

  return {
    start() {
      console.log(`[dotLab] ${title} · ${genre} · ${SPEC.setting} · ship-bar`);
      requestAnimationFrame(frame);
    },
    die,
    restart,
    jump() { state.jumpBuf = (CONFIG.jumpBufferMs || 90) / 1000; pt('recordJump'); },
    scene,
    player: player.mesh,
    CONFIG,
  };
}

function lcg(seed) {
  let s = (seed >>> 0) || 1;
  return () => {
    s = (Math.imul(s, 1664525) + 1013904223) >>> 0;
    return s / 4294967296;
  };
}

function ensureHud() {
  let el = document.getElementById('hud');
  if (!el) {
    el = document.createElement('div');
    el.id = 'hud';
    document.body.appendChild(el);
  }
  return el;
}

function ensureCrosshair(on) {
  let el = document.getElementById('cross');
  if (!on) {
    if (el) el.style.display = 'none';
    return el;
  }
  if (!el) {
    el = document.createElement('div');
    el.id = 'cross';
    el.style.cssText =
      'position:fixed;left:50%;top:50%;width:12px;height:12px;margin:-6px 0 0 -6px;' +
      'border:2px solid rgba(0,240,255,.9);border-radius:50%;pointer-events:none;' +
      'box-shadow:0 0 8px #ff2bd6;z-index:5';
    document.body.appendChild(el);
  }
  el.style.display = 'block';
  return el;
}

function ensureHitmark() {
  let el = document.getElementById('hitmark');
  if (!el) {
    el = document.createElement('div');
    el.id = 'hitmark';
    el.style.cssText =
      'position:fixed;left:50%;top:50%;width:18px;height:18px;margin:-9px 0 0 -9px;' +
      'border:2px solid #b8ff00;transform:rotate(45deg);opacity:0;pointer-events:none;z-index:5';
    document.body.appendChild(el);
  }
  return el;
}

function mat(color, extra) {
  return new THREE.MeshStandardMaterial(Object.assign({
    color,
    roughness: 0.55,
    metalness: 0.22,
  }, extra || {}));
}

function buildWorld(scene, rnd, pal, SPEC) {
  // Place / scatter / lights live in src/look (applyLook). Only gameplay volume here.
  if (SPEC.loop === 'shoot') {
    const covers = [];
    const spots = [
      [-3.4, -2.2],
      [3.6, -4.0],
      [0.2, -7.6],
    ];
    for (const [x, z] of spots) {
      covers.push(makeCover(scene, pal, { x, z }));
    }
    return { covers };
  }
  if (SPEC.loop === 'jump') {
    const pit = new THREE.Mesh(
      new THREE.PlaneGeometry(220, 40),
      mat(0x0a0808, { roughness: 1, metalness: 0 }),
    );
    pit.rotation.x = -Math.PI / 2;
    pit.position.set(20, -6, 0);
    scene.add(pit);
    return;
  }
  if (SPEC.loop === 'run') {
    for (let lane = -1; lane <= 1; lane++) {
      const strip = new THREE.Mesh(
        new THREE.BoxGeometry(2.0, 0.08, 80),
        mat(pal.ground, { roughness: 0.9 }),
      );
      strip.position.set(lane * 2.2, 0, -20);
      scene.add(strip);
    }
    return;
  }
}

function buildPlayer(scene, pal, CONFIG) {
  const spec = pickBody(SPEC);
  const body = makePlayer(scene, pal, { kind: spec.player });
  return {
    ...body,
    pos: new THREE.Vector3(0, CONFIG.eyeHeight || SCALE.eye, 6),
    vx: 0, vy: 0, vz: 0,
    yaw: 0, pitch: 0,
  };
}

function buildActors(scene, rnd, pal, SPEC) {
  const enemies = [];
  const coins = [];
  const npcs = [];
  const hazards = [];
  let gate = null;
  const gates = [];
  const rivals = [];
  const platforms = [];
  let start = null;
  let hunter = null;
  let door = null;

  const enemyN = Math.max(0, SPEC.enemyCount | 0) || (SPEC.loop === 'shoot' ? 8 : 0);
  const coinN = Math.max(0, SPEC.coinCount | 0) || (['jump', 'talk', 'collect', 'sneak'].includes(SPEC.loop) ? 6 : 0);
  const hazardN = Math.max(0, SPEC.hazardCount | 0) || (SPEC.loop === 'run' ? 8 : 0);
  const eye = 1.2;

  if (SPEC.loop === 'jump') {
    for (let i = 0; i < 10; i++) {
      if (i > 0 && i % 4 === 3) continue;
      const x = i * 4.5;
      const y = 0.4 + (i % 3) * 0.65;
      const mesh = new THREE.Mesh(new THREE.BoxGeometry(3.5, 0.4, 2.4), mat(pal.building));
      mesh.position.set(x, y, 0);
      scene.add(mesh);
      const top = y + 0.2;
      const p = { x, z: 0, hw: 1.75, hd: 1.2, top, eye: top + eye, mesh };
      platforms.push(p);
      if (!start) start = { x, y: p.eye, z: 0 };
    }
    for (let i = 1; i < Math.min((coinN || 6) + 1, platforms.length); i++) {
      const p = platforms[i];
      const coin = new THREE.Mesh(
        new THREE.TorusGeometry(SCALE.coinR, 0.1, 8, 14),
        mat(pal.accent, { emissive: pal.accent, emissiveIntensity: 0.95 }),
      );
      coin.position.set(p.x, p.top + 0.9, p.z);
      scene.add(coin);
      coins.push({ mesh: coin, taken: false, baseY: coin.position.y });
    }
    for (let i = 0; i < hazardN && i + 2 < platforms.length; i++) {
      const p = platforms[i + 2];
      const h = new THREE.Mesh(
        new THREE.ConeGeometry(0.32, 0.7, 5),
        mat(pal.enemy, { emissive: pal.enemy, emissiveIntensity: 0.7 }),
      );
      h.position.set(p.x + 0.9, p.top + 0.35, p.z);
      scene.add(h);
      hazards.push({ mesh: h });
    }
  }

  const bodyKind = pickBody(SPEC);
  if (SPEC.loop !== 'race' && SPEC.loop !== 'jump' && enemyN > 0) {
    for (let i = 0; i < enemyN; i++) {
      const elite = i === enemyN - 1 && enemyN >= 4;
      const kind = elite ? 'captain' : bodyKind.enemy;
      const built = makeEnemy(scene, pal, { kind, elite });
      const a = -1.05 + (i / Math.max(1, enemyN - 1)) * 2.1;
      const r = 8.5 + (i % 3) * 1.8 + rnd() * 1.2;
      const sx = Math.sin(a) * r;
      const sz = -Math.abs(Math.cos(a) * r) - 1.4;
      const baseY = elite ? 0.15 : (kind === 'crawler' ? 0 : 1.05);
      built.mesh.position.set(sx, baseY, sz);
      enemies.push({
        ...built,
        hp: elite ? 3 : 1,
        speed: elite ? 1.15 : 1.5 + rnd() * 1.1,
        baseY,
        phase: rnd() * 6,
        sx,
        sz,
        elite,
      });
    }
  }

  if (SPEC.loop === 'jump' && enemyN > 0) {
    for (let i = 0; i < enemyN && i < platforms.length; i++) {
      const p = platforms[Math.min(platforms.length - 1, 3 + i * 2)];
      const built = makeEnemy(scene, pal, { kind: 'crawler' });
      built.mesh.position.set(p.x - 0.6, p.top, p.z);
      enemies.push({
        ...built, hp: 1, speed: 1.1 + i * 0.2,
        baseY: p.top, phase: i, sx: p.x - 0.6, sz: p.z,
      });
    }
  }

  if (SPEC.loop !== 'race' && SPEC.loop !== 'jump' && coinN > 0) {
    for (let i = 0; i < Math.max(coinN, 1); i++) {
      const plat = new THREE.Mesh(new THREE.BoxGeometry(3.2, 0.4, 3.2), mat(pal.building));
      plat.position.set((i - 2) * 3.4, i * 0.35, -4 - i * 2.2);
      scene.add(plat);
      const coin = new THREE.Mesh(
        new THREE.TorusGeometry(SCALE.coinR, 0.1, 8, 14),
        mat(pal.accent, { emissive: pal.accent, emissiveIntensity: 0.95 }),
      );
      coin.position.set(plat.position.x, plat.position.y + 1.1, plat.position.z);
      scene.add(coin);
      coins.push({ mesh: coin, taken: false, baseY: coin.position.y });
    }
  }

  if (SPEC.loop === 'talk') {
    const npc = makePlayer(scene, { ...pal, player: pal.accent }, { kind: 'visor' });
    npc.mesh.position.set(3.2, 0, -2);
    npcs.push({ mesh: npc.mesh, talked: false, ...npc });
    door = new THREE.Mesh(
      new THREE.BoxGeometry(SCALE.doorW, SCALE.doorH, 0.3),
      mat(pal.grid, { emissive: pal.grid, emissiveIntensity: 0.25 }),
    );
    door.position.set(9.5, 1.2, -2);
    door.userData.open = false;
    scene.add(door);
  }

  if (SPEC.loop !== 'race' && SPEC.loop !== 'jump' && hazardN > 0) {
    for (let i = 0; i < hazardN; i++) {
      const h = new THREE.Mesh(new THREE.BoxGeometry(1.1, 1.4, 1.1), mat(pal.enemy, { emissive: pal.enemy, emissiveIntensity: 0.35 }));
      h.position.set((i % 3 - 1) * 2.2, 0.7, -8 - i * 6);
      scene.add(h);
      hazards.push({ mesh: h });
    }
  }

  if (SPEC.loop === 'race') {
    const nGates = Math.max(4, SPEC.coinCount | 0, SPEC.roomCount | 0);
    for (let i = 0; i < nGates; i++) {
      const g = new THREE.Mesh(
        new THREE.TorusGeometry(1.6, 0.12, 8, 20),
        mat(pal.accent, { emissive: pal.accent, emissiveIntensity: 1 }),
      );
      g.position.set((i % 2 === 0 ? -1.6 : 1.6), 1.6, -10 - i * 14);
      g.taken = false;
      scene.add(g);
      gates.push(g);
    }
    gate = gates[0] || null;
    const nRivals = Math.max(3, SPEC.enemyCount | 0);
    const names = ['VIN', 'REA', 'KAI', 'NYX', 'SOL'];
    for (let i = 0; i < nRivals; i++) {
      const body = new THREE.Mesh(
        new THREE.ConeGeometry(0.45, 1.1, 5),
        mat(pal.enemy, { emissive: pal.enemy, emissiveIntensity: 0.55 }),
      );
      body.rotation.x = Math.PI / 2;
      body.position.set((i - (nRivals - 1) / 2) * 2.1, 0.7, -4 - i * 3);
      scene.add(body);
      rivals.push({
        mesh: body,
        name: names[i % names.length],
        speed: 9 + i * 1.4,
        wobble: 1.4 + i * 0.35,
        sway: 1.8,
        phase: i * 1.7,
      });
    }
  }

  if (SPEC.loop === 'sneak') {
    const hun = makeEnemy(scene, pal, { kind: 'captain' });
    hun.mesh.position.set(-10, 0, -10);
    hunter = hun.mesh;
    hunter.userData.body = hun;
    door = new THREE.Mesh(new THREE.BoxGeometry(SCALE.doorW, SCALE.doorH, 0.25), mat(pal.accent, { emissive: pal.accent, emissiveIntensity: 0.85 }));
    door.position.set(10, 1.2, -14);
    scene.add(door);
  }

  return { enemies, coins, npcs, hazards, gate, gates, rivals, hunter, door, platforms, start };
}

function spawnWave(actors, scene, rnd, pal, SPEC, wave) {
  const n = Math.min(16, 4 + wave * 2);
  while (actors.enemies.length < n) {
    const built = makeEnemy(scene, pal, { kind: pickBody(SPEC).enemy });
    actors.enemies.push(armBrain({
      ...built, hp: 1, speed: 1.4, baseY: 1.05, phase: rnd() * 6, sx: 0, sz: 0, elite: false,
    }));
  }
  const eliteIdx = wave % 3 === 0 ? actors.enemies.length - 1 : -1;
  for (let i = 0; i < actors.enemies.length; i++) {
    const e = actors.enemies[i];
    const elite = i === eliteIdx;
    e.elite = elite;
    e.hp = (elite ? 3 : 1) + Math.floor(wave / 2);
    e.speed = (elite ? 1.1 : 1.4) + wave * 0.12 + rnd() * 0.6;
    e.mesh.visible = true;
    e.mesh.scale.setScalar(elite ? 1.35 : 1);
    if (e.mesh.material && e.mesh.material.emissiveIntensity != null) {
      e.mesh.material.emissiveIntensity = elite ? 1.35 : 1.05;
    }
    const a = -1.05 + (i / Math.max(1, actors.enemies.length - 1)) * 2.1;
    const r = 9 + (i % 3) * 1.6 + rnd();
    e.sx = Math.sin(a) * r;
    e.sz = -Math.abs(Math.cos(a) * r) - 1.4;
    e.baseY = elite ? 1.75 : 1.5;
    e.mesh.position.set(e.sx, e.baseY, e.sz);
    e.popT = null;
    armBrain(e);
  }
}

function buildWeapon(camera, pal) {
  return makeWeapon(camera, pal);
}
