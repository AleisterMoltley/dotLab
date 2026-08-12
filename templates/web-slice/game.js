import * as THREE from 'three';

const SPEC = __SPEC__;
const CONFIG = __CONFIG__;

export function createGame({ genre, title }) {
  const pal = SPEC.palette;
  const bg = pal.bg;

  const scene = new THREE.Scene();
  scene.background = new THREE.Color(bg);
  scene.fog = new THREE.Fog(bg, pal.fogNear, pal.fogFar);

  const camera = new THREE.PerspectiveCamera(CONFIG.fov, innerWidth / innerHeight, 0.08, 240);
  camera.position.set(0, CONFIG.eyeHeight, 8);

  const renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: 'high-performance' });
  renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
  renderer.setSize(innerWidth, innerHeight);
  renderer.shadowMap.enabled = true;
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  document.body.appendChild(renderer.domElement);
  scene.add(camera);

  const hemi = new THREE.HemisphereLight(pal.hemiSky, pal.hemiGround, 0.7);
  const sun = new THREE.DirectionalLight(pal.sun, 1.05);
  sun.position.set(18, 34, 12);
  sun.castShadow = true;
  sun.shadow.mapSize.set(1024, 1024);
  scene.add(hemi, sun);

  const accent = new THREE.PointLight(pal.accent, 1.4, 28, 2);
  accent.position.set(-6, 5, 4);
  const fill = new THREE.PointLight(pal.grid, 1.1, 26, 2);
  fill.position.set(7, 4, -3);
  scene.add(accent, fill);

  const hud = ensureHud();
  const cross = ensureCrosshair(SPEC.camera === 'fps');
  const keys = Object.create(null);
  const pointer = { locked: false, mx: 0, my: 0 };
  const state = {
    hp: CONFIG.hp,
    score: 0,
    dead: false,
    shake: 0,
    hitstop: 0,
    lastGround: 0,
    jumpBuf: 0,
    now: 0,
  };

  const _fwd = new THREE.Vector3();
  const _right = new THREE.Vector3();
  const _wish = new THREE.Vector3();
  const _look = new THREE.Vector3();
  const _ideal = new THREE.Vector3();
  const _ray = new THREE.Raycaster();
  const _ndc = new THREE.Vector2();

  const rnd = lcg(SPEC.seed);
  const world = buildWorld(scene, rnd);
  const player = buildPlayer(scene);
  const actors = buildActors(scene, rnd);
  const weapon = buildWeapon(camera);

  bindInput();
  updateHud();

  let last = performance.now();

  function update(dt) {
    if (state.hitstop > 0) {
      state.hitstop -= dt;
      return;
    }
    if (state.dead) return;

    const grounded = player.pos.y <= CONFIG.eyeHeight + 0.02;
    if (grounded) {
      player.pos.y = CONFIG.eyeHeight;
      player.vy = 0;
      state.lastGround = state.now;
    } else {
      player.vy -= CONFIG.gravity * dt;
      player.pos.y += player.vy * dt;
    }

    if (SPEC.camera === 'fps' && pointer.locked) {
      player.yaw -= pointer.mx * CONFIG.mouseSens;
      player.pitch = THREE.MathUtils.clamp(player.pitch - pointer.my * CONFIG.mouseSens, CONFIG.pitchMin, CONFIG.pitchMax);
    }
    pointer.mx = 0;
    pointer.my = 0;

    wishDir(_wish, _fwd, _right);
    if (SPEC.loop === 'run') {
      _wish.z -= 1;
      if (_wish.lengthSq() > 0) _wish.normalize();
    }

    const speed = SPEC.loop === 'run' ? CONFIG.runSpeed : CONFIG.moveSpeed;
    const targetX = _wish.x * speed;
    const targetZ = _wish.z * speed;
    player.vx = THREE.MathUtils.damp(player.vx, targetX, CONFIG.accel * 0.35, dt);
    player.vz = THREE.MathUtils.damp(player.vz, targetZ, CONFIG.accel * 0.35, dt);
    player.pos.x += player.vx * dt;
    player.pos.z += player.vz * dt;

    const wantJump = state.jumpBuf > 0;
    const coyote = state.now - state.lastGround <= CONFIG.coyoteMs / 1000;
    if (wantJump && (grounded || coyote) && player.vy <= 0.05) {
      player.vy = CONFIG.jumpForce;
      state.jumpBuf = 0;
      blip(520, 0.05, 'square');
      pt('recordJump');
    }
    if (!keys['Space'] && player.vy > 0) player.vy *= CONFIG.jumpCut;

    player.mesh.position.set(player.pos.x, player.pos.y - CONFIG.eyeHeight + 0.9, player.pos.z);
    player.mesh.rotation.y = player.yaw;

    placeCamera(dt);
    tickLoop(dt);
    if (state.shake > 0) state.shake = Math.max(0, state.shake - dt * 4);
    camera.position.x += Math.sin(state.now * 58) * state.shake * 0.12;
    camera.position.y += Math.cos(state.now * 47) * state.shake * 0.08;
  }

  function wishDir(out, fwd, right) {
    out.set(0, 0, 0);
    if (SPEC.camera === 'fps') {
      fwd.set(Math.sin(player.yaw), 0, Math.cos(player.yaw));
      right.set(fwd.z, 0, -fwd.x);
    } else if (SPEC.camera === 'side') {
      fwd.set(0, 0, 0);
      right.set(1, 0, 0);
    } else {
      fwd.set(0, 0, 1);
      right.set(1, 0, 0);
    }
    if (keys['KeyW'] || keys['ArrowUp']) out.addScaledVector(fwd, SPEC.camera === 'fps' ? -1 : -1);
    if (keys['KeyS'] || keys['ArrowDown']) out.addScaledVector(fwd, SPEC.camera === 'fps' ? 1 : 1);
    if (keys['KeyA'] || keys['ArrowLeft']) out.addScaledVector(right, -1);
    if (keys['KeyD'] || keys['ArrowRight']) out.addScaledVector(right, 1);
    if (SPEC.camera === 'side') {
      out.set(0, 0, 0);
      if (keys['KeyA'] || keys['ArrowLeft']) out.x -= 1;
      if (keys['KeyD'] || keys['ArrowRight']) out.x += 1;
      if (keys['KeyW'] || keys['ArrowUp']) out.z -= 0.15;
    }
    if (out.lengthSq() > 0) out.normalize();
    return out;
  }

  function placeCamera(dt) {
    if (SPEC.camera === 'fps') {
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
    if (SPEC.camera === 'top') {
      _ideal.set(player.pos.x, CONFIG.camDist, player.pos.z + 0.1);
    } else if (SPEC.camera === 'side') {
      _ideal.set(player.pos.x, player.pos.y + 2.2, player.pos.z + CONFIG.camDist);
    } else if (SPEC.camera === 'chase') {
      _ideal.set(player.pos.x, player.pos.y + CONFIG.camHeight, player.pos.z + CONFIG.camDist);
    } else {
      _ideal.set(player.pos.x, player.pos.y + CONFIG.camHeight, player.pos.z + CONFIG.camDist);
    }
    const k = 1 - Math.exp(-CONFIG.camLag * dt);
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
    for (const e of actors.enemies) {
      if (e.hp <= 0) continue;
      const dx = player.pos.x - e.mesh.position.x;
      const dz = player.pos.z - e.mesh.position.z;
      const d = Math.hypot(dx, dz) || 1;
      e.mesh.position.x += (dx / d) * e.speed * dt;
      e.mesh.position.z += (dz / d) * e.speed * dt;
      e.mesh.position.y = e.baseY + Math.sin(state.now * 3 + e.phase) * 0.25;
      e.mesh.rotation.y += 0.02;
      if (d < 1.15) hurt(1);
    }
  }

  function tickJump() {
    for (const c of actors.coins) {
      if (c.taken) continue;
      c.mesh.rotation.y += 0.04;
      const d = Math.hypot(player.pos.x - c.mesh.position.x, player.pos.z - c.mesh.position.z);
      if (d < 1.1 && Math.abs(player.pos.y - CONFIG.eyeHeight - (c.mesh.position.y - 1)) < 1.4) {
        c.taken = true;
        c.mesh.visible = false;
        state.score += 1;
        blip(880, 0.07, 'triangle');
        updateHud();
      }
    }
    if (player.pos.y < -4) die();
    if (state.score >= actors.coins.length && actors.coins.length) winPulse();
  }

  function tickRun(dt) {
    for (const o of actors.hazards) {
      o.mesh.position.z += CONFIG.runSpeed * dt;
      if (o.mesh.position.z > player.pos.z + 8) {
        o.mesh.position.z -= 48;
        o.mesh.position.x = (Math.floor(rnd() * 3) - 1) * 2.2;
      }
      const d = Math.hypot(player.pos.x - o.mesh.position.x, player.pos.z - o.mesh.position.z);
      if (d < 1.05) die();
    }
    state.score = Math.floor(-player.pos.z);
    if (Math.floor(state.now * 4) !== Math.floor((state.now - 0.016) * 4)) updateHud();
  }

  function tickRace() {
    const gate = actors.gate;
    if (!gate) return;
    const d = Math.hypot(player.pos.x - gate.position.x, player.pos.z - gate.position.z);
    if (d < 2.4) {
      state.score += 1;
      gate.position.x = (rnd() - 0.5) * 16;
      gate.position.z -= 18;
      blip(640, 0.06, 'sine');
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
    hunter.lookAt(player.pos.x, 1, player.pos.z);
    if (d < 1.3) die();
    const door = actors.door;
    if (door && Math.hypot(player.pos.x - door.position.x, player.pos.z - door.position.z) < 1.6) {
      state.score = 1;
      winPulse();
    }
  }

  function tickTalk() {
    for (const n of actors.npcs) {
      const d = Math.hypot(player.pos.x - n.mesh.position.x, player.pos.z - n.mesh.position.z);
      n.near = d < 2.2;
      if (n.near && keys['KeyE'] && !n.talked) {
        n.talked = true;
        state.score += 1;
        scene.background = new THREE.Color(pal.accent);
        scene.fog.color.set(pal.accent);
        blip(420, 0.12, 'sine');
        updateHud();
      }
    }
    for (const c of actors.coins) {
      if (c.taken) continue;
      c.mesh.rotation.y += 0.03;
      const d = Math.hypot(player.pos.x - c.mesh.position.x, player.pos.z - c.mesh.position.z);
      if (d < 1.1) {
        c.taken = true;
        c.mesh.visible = false;
        state.score += 1;
        blip(760, 0.06, 'triangle');
        updateHud();
      }
    }
  }

  function shoot() {
    if (state.dead || SPEC.loop !== 'shoot') return;
    weapon.flash();
    state.shake = 0.28 * (SPEC.juice || 1);
    blip(180, 0.04, 'sawtooth');
    _ndc.set(0, 0);
    _ray.setFromCamera(_ndc, camera);
    const hits = _ray.intersectObjects(actors.enemies.filter((e) => e.hp > 0).map((e) => e.mesh), false);
    if (hits[0]) {
      const e = actors.enemies.find((x) => x.mesh === hits[0].object);
      if (e) {
        e.hp -= 1;
        e.mesh.material.emissiveIntensity = 2.2;
        const j = SPEC.juice || 1;
        state.hitstop = (CONFIG.hitstopMs / 1000) * j;
        state.shake = Math.min(1.2, 0.35 * j + (CONFIG.shakeHit || 0.12));
        state.score += 10;
        if (e.hp <= 0) {
          e.mesh.visible = false;
          blip(140, 0.08, 'square');
          // respawn after a beat so the arena stays alive
          setTimeout(() => {
            if (state.dead) return;
            e.hp = 1;
            e.mesh.visible = true;
            const a = Math.random() * Math.PI * 2;
            const r = 8 + Math.random() * 10;
            e.mesh.position.set(Math.cos(a) * r, e.baseY, Math.sin(a) * r - 4);
          }, 1800);
        }
        updateHud();
      }
    }
  }

  function hurt(n) {
    if (state.dead) return;
    state.hp -= n;
    state.shake = 0.7;
    state.hitstop = 0.05;
    blip(90, 0.09, 'sawtooth');
    updateHud();
    if (state.hp <= 0) die();
  }

  function die() {
    if (state.dead) return;
    state.dead = true;
    pt('recordDeath');
    updateHud();
    blip(70, 0.2, 'triangle');
  }

  function winPulse() {
    fill.intensity = 2.4;
    updateHud();
  }

  function restart() {
    state.hp = CONFIG.hp;
    state.score = 0;
    state.dead = false;
    state.shake = 0;
    player.pos.set(0, CONFIG.eyeHeight, SPEC.loop === 'run' ? 0 : 6);
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
      if (e.code === 'Space') state.jumpBuf = CONFIG.jumpBufferMs / 1000;
      if (e.code === 'KeyR') restart();
    });
    addEventListener('keyup', (e) => { keys[e.code] = false; });
    addEventListener('resize', () => {
      camera.aspect = innerWidth / innerHeight;
      camera.updateProjectionMatrix();
      renderer.setSize(innerWidth, innerHeight);
    });
    renderer.domElement.addEventListener('click', () => {
      if (SPEC.camera === 'fps') renderer.domElement.requestPointerLock?.();
      shoot();
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
    const dt = Math.min(0.05, (now - last) / 1000);
    last = now;
    state.now += dt;
    if (state.jumpBuf > 0) state.jumpBuf -= dt;
    update(dt);
    renderer.render(scene, camera);
    requestAnimationFrame(frame);
  }

  function updateHud() {
    const lock = SPEC.camera === 'fps' && !pointer.locked ? ' · click to look' : '';
    const dead = state.dead ? ' · dead — R restart' : '';
    hud.textContent = `${title} · ${SPEC.verb}${lock}${dead} · hp ${Math.max(0, state.hp)} · ${state.score}`;
  }

  function pt(method) {
    try { window.__GF_PLAYTEST__?.[method]?.(); } catch {}
  }

  return {
    start() {
      console.log(`[Gamemaster] ${title} · ${genre} · ${SPEC.setting}`);
      requestAnimationFrame(frame);
    },
    die,
    restart,
    jump() { state.jumpBuf = CONFIG.jumpBufferMs / 1000; pt('recordJump'); },
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
    el.style.cssText = 'position:fixed;left:50%;top:50%;width:10px;height:10px;margin:-5px 0 0 -5px;border:2px solid rgba(255,255,255,.85);border-radius:50%;pointer-events:none;box-shadow:0 0 6px #000;z-index:5';
    document.body.appendChild(el);
  }
  el.style.display = 'block';
  return el;
}

function mat(color, extra) {
  return new THREE.MeshStandardMaterial(Object.assign({
    color,
    roughness: 0.62,
    metalness: 0.18,
  }, extra || {}));
}

function buildWorld(scene, rnd) {
  const pal = SPEC.palette;
  const ground = new THREE.Mesh(
    new THREE.PlaneGeometry(90, 90),
    mat(pal.ground, { roughness: 0.92, metalness: 0.04 }),
  );
  ground.rotation.x = -Math.PI / 2;
  ground.receiveShadow = true;
  scene.add(ground);

  const grid = new THREE.GridHelper(80, 40, pal.grid, pal.ground);
  grid.position.y = 0.02;
  scene.add(grid);

  const kind = SPEC.props;
  const group = new THREE.Group();
  scene.add(group);

  const dens = Math.max(0.5, Math.min(2, SPEC.density || 1));
  if (kind === 'neon') {
    for (let i = 0; i < Math.floor(14 * dens); i++) {
      const h = 4 + rnd() * 14;
      const box = new THREE.Mesh(
        new THREE.BoxGeometry(2.2 + rnd() * 1.4, h, 2.2 + rnd() * 1.2),
        mat(pal.building, { metalness: 0.55, roughness: 0.28, emissive: pal.grid, emissiveIntensity: 0.08 }),
      );
      const a = rnd() * Math.PI * 2;
      const r = 8 + rnd() * 22;
      box.position.set(Math.cos(a) * r, h / 2, Math.sin(a) * r);
      box.castShadow = true;
      group.add(box);
      const band = new THREE.Mesh(
        new THREE.BoxGeometry(box.geometry.parameters.width + 0.05, 0.12, box.geometry.parameters.depth + 0.05),
        mat(pal.accent, { emissive: pal.accent, emissiveIntensity: 1.3, roughness: 0.2 }),
      );
      band.position.set(box.position.x, 1.4 + rnd() * (h - 2), box.position.z);
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
      trunk.castShadow = leaves.castShadow = true;
      group.add(trunk, leaves);
    }
  } else if (kind === 'desert') {
    for (let i = 0; i < 10; i++) {
      const dune = new THREE.Mesh(new THREE.SphereGeometry(3 + rnd() * 3, 8, 6), mat(pal.ground, { roughness: 1 }));
      dune.scale.y = 0.35;
      dune.position.set((rnd() - 0.5) * 50, 0.2, (rnd() - 0.5) * 50);
      group.add(dune);
    }
  } else if (kind === 'ice') {
    for (let i = 0; i < 12; i++) {
      const spire = new THREE.Mesh(
        new THREE.ConeGeometry(0.5 + rnd() * 0.5, 2 + rnd() * 4, 5),
        mat(pal.player, { metalness: 0.4, roughness: 0.2, emissive: pal.grid, emissiveIntensity: 0.15 }),
      );
      spire.position.set((rnd() - 0.5) * 36, 1.4, (rnd() - 0.5) * 36);
      group.add(spire);
    }
  } else if (kind === 'dungeon') {
    for (let i = 0; i < 8; i++) {
      const wall = new THREE.Mesh(new THREE.BoxGeometry(8, 3.2, 0.5), mat(pal.building));
      const a = (i / 8) * Math.PI * 2;
      wall.position.set(Math.cos(a) * 12, 1.6, Math.sin(a) * 12);
      wall.lookAt(0, 1.6, 0);
      group.add(wall);
    }
  } else {
    for (let i = 0; i < 10; i++) {
      const crate = new THREE.Mesh(
        new THREE.BoxGeometry(1.1, 1.1, 1.1),
        mat(pal.building, { roughness: 0.8 }),
      );
      crate.position.set((rnd() - 0.5) * 22, 0.55, (rnd() - 0.5) * 22);
      crate.castShadow = true;
      group.add(crate);
    }
  }
  return { ground, group };
}

function buildPlayer(scene) {
  const pal = SPEC.palette;
  const mesh = new THREE.Mesh(
    new THREE.CapsuleGeometry(0.38, 0.9, 4, 8),
    mat(pal.player, { emissive: pal.player, emissiveIntensity: 0.18 }),
  );
  mesh.position.set(0, 1.2, 6);
  mesh.castShadow = true;
  scene.add(mesh);
  return {
    mesh,
    pos: new THREE.Vector3(0, CONFIG.eyeHeight, 6),
    vx: 0,
    vy: 0,
    vz: 0,
    yaw: 0,
    pitch: 0,
  };
}

function buildActors(scene, rnd) {
  const pal = SPEC.palette;
  const enemies = [];
  const coins = [];
  const npcs = [];
  const hazards = [];
  let gate = null;
  let hunter = null;
  let door = null;

  const enemyN = Math.max(0, SPEC.enemyCount | 0) || (SPEC.loop === 'shoot' ? 7 : 0);
  const coinN = Math.max(0, SPEC.coinCount | 0) || (SPEC.loop === 'jump' || SPEC.loop === 'talk' || SPEC.loop === 'collect' ? 6 : 0);
  const hazardN = Math.max(0, SPEC.hazardCount | 0) || (SPEC.loop === 'run' ? 8 : 0);

  if (SPEC.loop === 'shoot') {
    for (let i = 0; i < enemyN; i++) {
      const mesh = new THREE.Mesh(
        new THREE.IcosahedronGeometry(0.55, 0),
        mat(pal.enemy, { emissive: pal.enemy, emissiveIntensity: 0.7, metalness: 0.4 }),
      );
      const a = rnd() * Math.PI * 2;
      const r = 8 + rnd() * 10;
      const sx = Math.cos(a) * r;
      const sz = Math.sin(a) * r - 4;
      mesh.position.set(sx, 1.6, sz);
      scene.add(mesh);
      enemies.push({ mesh, hp: 1, speed: 1.4 + rnd() * 1.2, baseY: 1.5 + rnd() * 0.8, phase: rnd() * 6, sx, sz });
    }
  }

  if (SPEC.loop === 'jump' || SPEC.loop === 'talk' || SPEC.loop === 'collect') {
    for (let i = 0; i < Math.max(coinN, 1); i++) {
      const plat = new THREE.Mesh(
        new THREE.BoxGeometry(3.2, 0.4, 3.2),
        mat(pal.building, { metalness: 0.2 }),
      );
      plat.position.set((i - 2) * 3.4, i * 0.35, -4 - i * 2.2);
      plat.receiveShadow = true;
      scene.add(plat);
      const coin = new THREE.Mesh(
        new THREE.TorusGeometry(0.28, 0.1, 8, 14),
        mat(pal.accent, { emissive: pal.accent, emissiveIntensity: 0.9 }),
      );
      coin.position.set(plat.position.x, plat.position.y + 1.1, plat.position.z);
      scene.add(coin);
      coins.push({ mesh: coin, taken: false });
    }
  }

  if (SPEC.loop === 'talk') {
    const body = new THREE.Mesh(
      new THREE.CapsuleGeometry(0.35, 0.7, 4, 8),
      mat(pal.accent, { emissive: pal.accent, emissiveIntensity: 0.25 }),
    );
    body.position.set(3.2, 1.05, -2);
    scene.add(body);
    npcs.push({ mesh: body, talked: false, near: false });
  }

  if (SPEC.loop === 'run') {
    for (let i = 0; i < hazardN; i++) {
      const h = new THREE.Mesh(new THREE.BoxGeometry(1.1, 1.4, 1.1), mat(pal.enemy, { emissive: pal.enemy, emissiveIntensity: 0.3 }));
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
    const carTint = new THREE.Mesh(new THREE.BoxGeometry(1.1, 0.4, 2), mat(pal.player));
    carTint.position.set(0, 0.4, 6);
    scene.add(carTint);
  }

  if (SPEC.loop === 'sneak') {
    hunter = new THREE.Mesh(
      new THREE.ConeGeometry(0.6, 1.8, 5),
      mat(pal.enemy, { emissive: pal.enemy, emissiveIntensity: 0.55 }),
    );
    hunter.position.set(-10, 0.9, -10);
    scene.add(hunter);
    door = new THREE.Mesh(
      new THREE.BoxGeometry(1.6, 2.4, 0.25),
      mat(pal.accent, { emissive: pal.accent, emissiveIntensity: 0.8 }),
    );
    door.position.set(10, 1.2, -14);
    scene.add(door);
  }

  return { enemies, coins, npcs, hazards, gate, hunter, door };
}

function buildWeapon(camera) {
  const pal = SPEC.palette;
  const root = new THREE.Group();
  const body = new THREE.Mesh(
    new THREE.BoxGeometry(0.12, 0.14, 0.7),
    mat(0x1a1f2a, { metalness: 0.7, roughness: 0.3 }),
  );
  body.position.set(0.28, -0.28, -0.55);
  const glow = new THREE.Mesh(
    new THREE.BoxGeometry(0.05, 0.05, 0.2),
    mat(pal.grid, { emissive: pal.grid, emissiveIntensity: 0.9 }),
  );
  glow.position.set(0.28, -0.22, -0.9);
  root.add(body, glow);
  root.visible = false;
  camera.add(root);
  // camera is not yet in a scene graph parent that renders children unless we add camera to scene
  return {
    get visible() { return root.visible; },
    set visible(v) { root.visible = v; },
    flash() {
      glow.material.emissiveIntensity = 3;
      setTimeout(() => { glow.material.emissiveIntensity = 0.9; }, 40);
    },
  };
}

let _audio;
function blip(freq, dur, type) {
  try {
    _audio = _audio || new AudioContext();
    const o = _audio.createOscillator();
    const g = _audio.createGain();
    o.type = type || 'square';
    o.frequency.value = freq;
    g.gain.value = 0.05;
    o.connect(g);
    g.connect(_audio.destination);
    o.start();
    g.gain.exponentialRampToValueAtTime(0.0001, _audio.currentTime + dur);
    o.stop(_audio.currentTime + dur + 0.02);
  } catch {}
}
