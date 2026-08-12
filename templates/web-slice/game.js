/**
 * Grok craft slice — ship bar = NEON INK vertical quality (skill arcade).
 * Host owns SPEC+CONFIG via slice/patch. Zero external assets.
 */
import * as THREE from 'three';
import { TimeJuice, calloutForStreak, makeShake, pulseShake, decayShake } from './craft/juice.js';
import { sfx } from './craft/audio.js';

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
  camera.position.set(0, CONFIG.eyeHeight || 1.62, 8);

  const renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: 'high-performance' });
  renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
  renderer.setSize(innerWidth, innerHeight);
  renderer.shadowMap.enabled = !isFps;
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  document.body.appendChild(renderer.domElement);
  scene.add(camera);

  // Night neon lighting (NEON INK fingerprint) when shooting; softer hemi otherwise
  if (isFps) {
    scene.add(new THREE.AmbientLight(0x140a28, 0.32));
    const moon = new THREE.DirectionalLight(0xa8b8ff, 0.45);
    moon.position.set(35, 90, 15);
    const fill = new THREE.DirectionalLight(pal.accent || 0xff2bd6, 0.55);
    fill.position.set(-30, 18, -40);
    const rim = new THREE.DirectionalLight(pal.grid || 0x00f0ff, 0.5);
    rim.position.set(10, 12, -50);
    scene.add(moon, fill, rim);
  } else {
    const hemi = new THREE.HemisphereLight(pal.hemiSky, pal.hemiGround, 0.7);
    const sun = new THREE.DirectionalLight(pal.sun, 1.05);
    sun.position.set(18, 34, 12);
    sun.castShadow = true;
    sun.shadow.mapSize.set(1024, 1024);
    scene.add(hemi, sun);
    scene.add(new THREE.PointLight(pal.accent, 1.3, 28, 2).translateX(-6).translateY(5));
    scene.add(new THREE.PointLight(pal.grid, 1.0, 26, 2).translateX(7).translateY(4));
  }

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
  buildWorld(scene, rnd, pal, SPEC);
  const player = buildPlayer(scene, pal, CONFIG);
  const actors = buildActors(scene, rnd, pal, SPEC);
  const weapon = buildWeapon(camera, pal);
  const tracers = [];

  bindInput();
  updateHud();

  let last = performance.now();

  function update(rawDt) {
    const dt = rawDt * timeJuice.update(rawDt);
    if (state.calloutT > 0) state.calloutT -= rawDt;
    if (state.fireCd > 0) state.fireCd -= dt;
    if (state.dashCd > 0) state.dashCd -= dt;
    if (state.dashT > 0) state.dashT -= dt;

    if (state.dead) return;

    const grounded = player.pos.y <= (CONFIG.eyeHeight || 1.62) + 0.02;
    if (grounded) {
      player.pos.y = CONFIG.eyeHeight || 1.62;
      player.vy = 0;
      state.lastGround = state.now;
    } else {
      player.vy -= (CONFIG.gravity || 28) * dt;
      player.pos.y += player.vy * dt;
    }

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
    const targetFov = state.ads ? (CONFIG.adsFov || 62) : (CONFIG.fov || (isFps ? 78 : 58));
    camera.fov += (targetFov - camera.fov) * Math.min(1, 10 * dt);
    camera.updateProjectionMatrix();

    player.mesh.position.set(player.pos.x, player.pos.y - (CONFIG.eyeHeight || 1.62) + 0.9, player.pos.z);
    player.mesh.rotation.y = player.yaw;

    placeCamera(dt);
    const sh = decayShake(shake, dt);
    if (sh > 0) {
      camera.position.x += Math.sin(state.now * 58) * sh * 0.12;
      camera.position.y += Math.cos(state.now * 47) * sh * 0.08;
    }

    tickLoop(dt);
    tickTracers(dt);
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
      camera.position.set(player.pos.x, player.pos.y, player.pos.z);
      _look.set(
        player.pos.x - Math.sin(player.yaw) * Math.cos(player.pitch),
        player.pos.y + Math.sin(player.pitch),
        player.pos.z - Math.cos(player.yaw) * Math.cos(player.pitch),
      );
      camera.lookAt(_look);
      player.mesh.visible = false;
      weapon.visible = true;
      return;
    }
    player.mesh.visible = true;
    weapon.visible = false;
    if (SPEC.camera === 'top') _ideal.set(player.pos.x, CONFIG.camDist || 16, player.pos.z + 0.1);
    else if (SPEC.camera === 'side') _ideal.set(player.pos.x, player.pos.y + 2.2, player.pos.z + (CONFIG.camDist || 11));
    else _ideal.set(player.pos.x, player.pos.y + (CONFIG.camHeight || 2.4), player.pos.z + (CONFIG.camDist || 6.5));
    const k = 1 - Math.exp(-(CONFIG.camLag || 8) * dt);
    camera.position.lerp(_ideal, k);
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
  }

  function tickShoot(dt) {
    let alive = 0;
    for (const e of actors.enemies) {
      if (e.hp <= 0) continue;
      alive++;
      const dx = player.pos.x - e.mesh.position.x;
      const dz = player.pos.z - e.mesh.position.z;
      const d = Math.hypot(dx, dz) || 1;
      const threat = d < 5;
      // telegraph: pulse before contact — commit does not retarget mid-frame beyond velocity
      const speed = (threat ? e.speed * 1.2 : e.speed * 0.5);
      if (threat) {
        e.mesh.material.emissiveIntensity = 0.75 + Math.sin(state.now * 14) * 0.55;
        e.mesh.scale.setScalar(1 + Math.sin(state.now * 12) * 0.09);
      } else {
        e.mesh.material.emissiveIntensity = 0.55;
        e.mesh.scale.setScalar(1);
      }
      e.mesh.position.x += (dx / d) * speed * dt;
      e.mesh.position.z += (dz / d) * speed * dt;
      e.mesh.position.y = e.baseY + Math.sin(state.now * 3 + e.phase) * 0.22;
      e.mesh.rotation.y += 0.03;
      if (d < 1.2 && state.dashT <= 0) hurt(12 * dt * 8);
    }
    if (alive === 0) {
      state.wave += 1;
      spawnWave(actors, scene, rnd, pal, SPEC, state.wave);
      showBanner(`WAVE ${state.wave}`);
      sfx('kill');
    }
  }

  function tickJump() {
    for (const c of actors.coins) {
      if (c.taken) continue;
      c.mesh.rotation.y += 0.04;
      const d = Math.hypot(player.pos.x - c.mesh.position.x, player.pos.z - c.mesh.position.z);
      if (d < 1.1) {
        c.taken = true;
        c.mesh.visible = false;
        state.score += 1;
        sfx('hit');
        updateHud();
      }
    }
    if (player.pos.y < -4) die();
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

  function tickRace() {
    const gate = actors.gate;
    if (!gate) return;
    if (Math.hypot(player.pos.x - gate.position.x, player.pos.z - gate.position.z) < 2.4) {
      state.score += 1;
      gate.position.x = (rnd() - 0.5) * 16;
      gate.position.z -= 18;
      sfx('hit');
      updateHud();
    }
    if (player.pos.y < -2) die();
  }

  function tickSneak(dt) {
    const hunter = actors.hunter;
    if (!hunter) return;
    const dx = player.pos.x - hunter.position.x;
    const dz = player.pos.z - hunter.position.z;
    const d = Math.hypot(dx, dz) || 1;
    hunter.position.x += (dx / d) * 1.6 * dt;
    hunter.position.z += (dz / d) * 1.6 * dt;
    if (d < 1.3) die();
    const door = actors.door;
    if (door && Math.hypot(player.pos.x - door.position.x, player.pos.z - door.position.z) < 1.6) {
      state.score = 1;
      showBanner('ESCAPED');
    }
  }

  function tickTalk() {
    for (const n of actors.npcs) {
      const d = Math.hypot(player.pos.x - n.mesh.position.x, player.pos.z - n.mesh.position.z);
      if (d < 2.2 && keys['KeyE'] && !n.talked) {
        n.talked = true;
        state.score += 1;
        scene.background = new THREE.Color(pal.accent);
        scene.fog.color.set(pal.accent);
        sfx('hit');
        showBanner('FLAG SET — world moves');
        updateHud();
      }
    }
    for (const c of actors.coins) {
      if (c.taken) continue;
      c.mesh.rotation.y += 0.03;
      if (Math.hypot(player.pos.x - c.mesh.position.x, player.pos.z - c.mesh.position.z) < 1.1) {
        c.taken = true;
        c.mesh.visible = false;
        state.score += 1;
        sfx('hit');
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
    pulseShake(shake, 0.18 * (SPEC.juice || 1));
    sfx('shoot');

    const spread = state.ads ? (CONFIG.adsSpread ?? 0.004) : (CONFIG.spread ?? 0.014);
    _ndc.set((Math.random() - 0.5) * spread * 40, (Math.random() - 0.5) * spread * 40);
    _ray.setFromCamera(_ndc, camera);
    spawnTracer(_ray.ray.origin, _ray.ray.direction, pal.grid || 0x00f0ff);

    const live = actors.enemies.filter((e) => e.hp > 0).map((e) => e.mesh);
    const hits = _ray.intersectObjects(live, false);
    if (hits[0]) {
      const e = actors.enemies.find((x) => x.mesh === hits[0].object);
      if (e) {
        const dmg = CONFIG.damage || 18;
        e.hp -= dmg;
        e.mesh.material.emissiveIntensity = 2.4;
        timeJuice.body();
        pulseShake(shake, 0.25 * (SPEC.juice || 1));
        flashHitmark();
        sfx('hit');
        if (e.hp <= 0) {
          e.mesh.visible = false;
          state.streak += 1;
          state.score += 10 * Math.min(state.streak, 5);
          timeJuice.kill();
          sfx('kill');
          const co = calloutForStreak(state.streak);
          state.callout = co;
          state.calloutT = 1.1;
          showBanner(co || '+10');
          setTimeout(() => {
            if (state.dead) return;
            e.hp = 1 + Math.floor(state.wave / 2);
            e.mesh.visible = true;
            e.mesh.scale.setScalar(1);
            const a = Math.random() * Math.PI * 2;
            const r = 8 + Math.random() * 12;
            e.mesh.position.set(Math.cos(a) * r, e.baseY, Math.sin(a) * r - 4);
          }, 1600);
        }
        updateHud();
      }
    } else {
      state.streak = 0;
    }
  }

  function spawnTracer(origin, dir, color) {
    const mesh = new THREE.Mesh(
      new THREE.BoxGeometry(0.04, 0.04, 2.2),
      new THREE.MeshBasicMaterial({ color, toneMapped: false, transparent: true, opacity: 0.9 }),
    );
    mesh.position.copy(origin).addScaledVector(dir, 1.4);
    mesh.quaternion.setFromUnitVectors(new THREE.Vector3(0, 0, 1), dir.clone().normalize());
    scene.add(mesh);
    tracers.push({ mesh, life: 0.08 });
  }

  function tickTracers(dt) {
    for (let i = tracers.length - 1; i >= 0; i--) {
      const t = tracers[i];
      t.life -= dt;
      t.mesh.material.opacity = Math.max(0, t.life * 10);
      if (t.life <= 0) {
        scene.remove(t.mesh);
        t.mesh.geometry.dispose();
        t.mesh.material.dispose();
        tracers.splice(i, 1);
      }
    }
  }

  function hurt(n) {
    if (state.dead || state.dashT > 0) return;
    state.hp -= n;
    pulseShake(shake, 0.55);
    sfx('hurt');
    updateHud();
    if (state.hp <= 0) die();
  }

  function die() {
    if (state.dead) return;
    state.dead = true;
    state.streak = 0;
    pulseShake(shake, 1.1);
    pt('recordDeath');
    updateHud();
    sfx('death');
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
    player.pos.set(0, CONFIG.eyeHeight || 1.62, SPEC.loop === 'run' ? 0 : 6);
    player.vx = player.vz = player.vy = 0;
    player.yaw = 0;
    player.pitch = 0;
    scene.background = new THREE.Color(bg);
    scene.fog.color.set(bg);
    for (const e of actors.enemies) {
      e.hp = 1;
      e.mesh.visible = true;
      e.mesh.position.set(e.sx, e.baseY, e.sz);
    }
    for (const c of actors.coins) {
      c.taken = false;
      c.mesh.visible = true;
    }
    for (const n of actors.npcs) n.talked = false;
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
      if (isFps) renderer.domElement.requestPointerLock?.();
      if (!isFps && SPEC.loop === 'shoot') tryFire();
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
      console.log(`[Gamemaster/Grok] ${title} · ${genre} · ${SPEC.setting} · ship-bar`);
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
  const ground = new THREE.Mesh(
    new THREE.PlaneGeometry(100, 100),
    mat(pal.ground, { roughness: 0.95, metalness: 0.05 }),
  );
  ground.rotation.x = -Math.PI / 2;
  ground.receiveShadow = true;
  scene.add(ground);

  const grid = new THREE.GridHelper(90, 45, pal.grid, pal.ground);
  grid.position.y = 0.02;
  scene.add(grid);

  const dens = Math.max(0.5, Math.min(2, SPEC.density || 1));
  const kind = SPEC.props;
  const group = new THREE.Group();
  scene.add(group);

  if (kind === 'neon' || SPEC.loop === 'shoot') {
    for (let i = 0; i < Math.floor(16 * dens); i++) {
      const h = 5 + rnd() * 16;
      const box = new THREE.Mesh(
        new THREE.BoxGeometry(2.4 + rnd() * 1.6, h, 2.4 + rnd() * 1.4),
        mat(pal.building, { metalness: 0.55, roughness: 0.3, emissive: pal.grid, emissiveIntensity: 0.06 }),
      );
      const a = rnd() * Math.PI * 2;
      const r = 10 + rnd() * 28;
      box.position.set(Math.cos(a) * r, h / 2, Math.sin(a) * r);
      box.castShadow = true;
      group.add(box);
      const band = new THREE.Mesh(
        new THREE.BoxGeometry(box.geometry.parameters.width + 0.06, 0.14, box.geometry.parameters.depth + 0.06),
        mat(pal.accent, { emissive: pal.accent, emissiveIntensity: 1.4, roughness: 0.2 }),
      );
      band.position.set(box.position.x, 1.6 + rnd() * (h - 2.5), box.position.z);
      group.add(band);
    }
  } else if (kind === 'forest') {
    for (let i = 0; i < 22; i++) {
      const trunk = new THREE.Mesh(new THREE.CylinderGeometry(0.16, 0.22, 1.6, 6), mat(0x4a3422));
      const leaves = new THREE.Mesh(new THREE.ConeGeometry(1.1, 2.6, 7), mat(pal.accent, { roughness: 0.85 }));
      const a = rnd() * Math.PI * 2;
      const r = 5 + rnd() * 24;
      trunk.position.set(Math.cos(a) * r, 0.8, Math.sin(a) * r);
      leaves.position.set(trunk.position.x, 2.6, trunk.position.z);
      group.add(trunk, leaves);
    }
  } else {
    for (let i = 0; i < 12; i++) {
      const crate = new THREE.Mesh(new THREE.BoxGeometry(1.2, 1.2, 1.2), mat(pal.building));
      crate.position.set((rnd() - 0.5) * 24, 0.6, (rnd() - 0.5) * 24);
      group.add(crate);
    }
  }
}

function buildPlayer(scene, pal, CONFIG) {
  const mesh = new THREE.Mesh(
    new THREE.CapsuleGeometry(0.38, 0.9, 4, 8),
    mat(pal.player, { emissive: pal.player, emissiveIntensity: 0.22 }),
  );
  mesh.position.set(0, 1.2, 6);
  mesh.castShadow = true;
  scene.add(mesh);
  return {
    mesh,
    pos: new THREE.Vector3(0, CONFIG.eyeHeight || 1.62, 6),
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
  let hunter = null;
  let door = null;

  const enemyN = Math.max(0, SPEC.enemyCount | 0) || (SPEC.loop === 'shoot' ? 8 : 0);
  const coinN = Math.max(0, SPEC.coinCount | 0) || (['jump', 'talk', 'collect'].includes(SPEC.loop) ? 6 : 0);
  const hazardN = Math.max(0, SPEC.hazardCount | 0) || (SPEC.loop === 'run' ? 8 : 0);

  if (SPEC.loop === 'shoot') {
    for (let i = 0; i < enemyN; i++) {
      const mesh = new THREE.Mesh(
        new THREE.IcosahedronGeometry(0.55, 0),
        mat(pal.enemy, { emissive: pal.enemy, emissiveIntensity: 0.75, metalness: 0.45 }),
      );
      const a = rnd() * Math.PI * 2;
      const r = 9 + rnd() * 11;
      const sx = Math.cos(a) * r;
      const sz = Math.sin(a) * r - 4;
      mesh.position.set(sx, 1.6, sz);
      scene.add(mesh);
      enemies.push({
        mesh, hp: 1, speed: 1.5 + rnd() * 1.3,
        baseY: 1.5 + rnd() * 0.7, phase: rnd() * 6, sx, sz,
      });
    }
  }

  if (SPEC.loop === 'jump' || SPEC.loop === 'talk' || SPEC.loop === 'collect') {
    for (let i = 0; i < Math.max(coinN, 1); i++) {
      const plat = new THREE.Mesh(new THREE.BoxGeometry(3.2, 0.4, 3.2), mat(pal.building));
      plat.position.set((i - 2) * 3.4, i * 0.35, -4 - i * 2.2);
      scene.add(plat);
      const coin = new THREE.Mesh(
        new THREE.TorusGeometry(0.28, 0.1, 8, 14),
        mat(pal.accent, { emissive: pal.accent, emissiveIntensity: 0.95 }),
      );
      coin.position.set(plat.position.x, plat.position.y + 1.1, plat.position.z);
      scene.add(coin);
      coins.push({ mesh: coin, taken: false });
    }
  }

  if (SPEC.loop === 'talk') {
    const body = new THREE.Mesh(
      new THREE.CapsuleGeometry(0.35, 0.7, 4, 8),
      mat(pal.accent, { emissive: pal.accent, emissiveIntensity: 0.3 }),
    );
    body.position.set(3.2, 1.05, -2);
    scene.add(body);
    npcs.push({ mesh: body, talked: false });
  }

  if (SPEC.loop === 'run') {
    for (let i = 0; i < hazardN; i++) {
      const h = new THREE.Mesh(new THREE.BoxGeometry(1.1, 1.4, 1.1), mat(pal.enemy, { emissive: pal.enemy, emissiveIntensity: 0.35 }));
      h.position.set((i % 3 - 1) * 2.2, 0.7, -8 - i * 6);
      scene.add(h);
      hazards.push({ mesh: h });
    }
  }

  if (SPEC.loop === 'race') {
    gate = new THREE.Mesh(
      new THREE.TorusGeometry(1.6, 0.12, 8, 20),
      mat(pal.accent, { emissive: pal.accent, emissiveIntensity: 1 }),
    );
    gate.position.set(0, 1.6, -12);
    scene.add(gate);
  }

  if (SPEC.loop === 'sneak') {
    hunter = new THREE.Mesh(new THREE.ConeGeometry(0.6, 1.8, 5), mat(pal.enemy, { emissive: pal.enemy, emissiveIntensity: 0.55 }));
    hunter.position.set(-10, 0.9, -10);
    scene.add(hunter);
    door = new THREE.Mesh(new THREE.BoxGeometry(1.6, 2.4, 0.25), mat(pal.accent, { emissive: pal.accent, emissiveIntensity: 0.85 }));
    door.position.set(10, 1.2, -14);
    scene.add(door);
  }

  return { enemies, coins, npcs, hazards, gate, hunter, door };
}

function spawnWave(actors, scene, rnd, pal, SPEC, wave) {
  const n = Math.min(16, 4 + wave * 2);
  while (actors.enemies.length < n) {
    const mesh = new THREE.Mesh(
      new THREE.IcosahedronGeometry(0.55, 0),
      mat(pal.enemy, { emissive: pal.enemy, emissiveIntensity: 0.75, metalness: 0.45 }),
    );
    scene.add(mesh);
    actors.enemies.push({
      mesh, hp: 1, speed: 1.4, baseY: 1.6, phase: rnd() * 6, sx: 0, sz: 0,
    });
  }
  for (const e of actors.enemies) {
    e.hp = 1 + Math.floor(wave / 2);
    e.speed = 1.4 + wave * 0.12 + rnd() * 0.8;
    e.mesh.visible = true;
    const a = rnd() * Math.PI * 2;
    const r = 10 + rnd() * 14;
    e.sx = Math.cos(a) * r;
    e.sz = Math.sin(a) * r - 4;
    e.mesh.position.set(e.sx, e.baseY, e.sz);
  }
}

function buildWeapon(camera, pal) {
  const root = new THREE.Group();
  const body = new THREE.Mesh(
    new THREE.BoxGeometry(0.12, 0.14, 0.75),
    mat(0x1a1f2a, { metalness: 0.75, roughness: 0.28 }),
  );
  body.position.set(0.28, -0.28, -0.55);
  const glow = new THREE.Mesh(
    new THREE.BoxGeometry(0.05, 0.05, 0.22),
    mat(pal.grid, { emissive: pal.grid, emissiveIntensity: 1.1 }),
  );
  glow.position.set(0.28, -0.22, -0.95);
  root.add(body, glow);
  root.visible = false;
  camera.add(root);
  return {
    get visible() { return root.visible; },
    set visible(v) { root.visible = v; },
    flash() {
      glow.material.emissiveIntensity = 3.5;
      setTimeout(() => { glow.material.emissiveIntensity = 1.1; }, 40);
    },
  };
}
