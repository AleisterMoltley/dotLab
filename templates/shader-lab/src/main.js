import * as THREE from 'three';
import { createEngine } from './engine.js';
import { COMMON, BUFFER_A, IMAGE } from './defaults.js';
import { createAudioTexture, createKeyboardTexture } from './audioKeyboard.js';
import { importShadertoyJson, convertShadertoyToFragCoord, isShadertoySource } from './shadertoy.js';

const editor = document.getElementById('editor');
const errorsEl = document.getElementById('errors');
const tabsEl = document.getElementById('pass-tabs');
const fpsEl = document.getElementById('fps');
const statusEl = document.getElementById('status');
const hud = document.getElementById('hud');
const canvas = document.getElementById('c');

/** @type {{id:string,name:string,kind:'common'|'buffer'|'image',source:string,bufferIndex?:number}[]} */
let passes = [
  { id: 'common', name: 'Common', kind: 'common', source: COMMON },
  { id: 'bufA', name: 'Buffer A', kind: 'buffer', source: BUFFER_A, bufferIndex: 0 },
  { id: 'image', name: 'Image', kind: 'image', source: IMAGE },
];
let activeId = 'image';

const engine = createEngine(canvas);
const audio = createAudioTexture();
const keyboard = createKeyboardTexture();
engine.shared.u_audio.value = audio.texture;
engine.shared.u_keyboard.value = keyboard.texture;

let down = false;
let clickX = 0;
let clickY = 0;
const drag = { x: 0, y: 0 };

function canvasPos(e) {
  const r = canvas.getBoundingClientRect();
  const x = ((e.clientX - r.left) / r.width) * canvas.width;
  const y = ((e.clientY - r.top) / r.height) * canvas.height;
  return { x, y };
}

canvas.addEventListener('pointerdown', (e) => {
  canvas.setPointerCapture(e.pointerId);
  down = true;
  const p = canvasPos(e);
  clickX = p.x;
  clickY = p.y;
  engine.setMouse(p.x, p.y, true, clickX, canvas.height - clickY);
});
canvas.addEventListener('pointermove', (e) => {
  const p = canvasPos(e);
  if (down) {
    drag.x += e.movementX;
    drag.y += e.movementY;
    engine.shared.u_drag.value.set(drag.x, drag.y);
  }
  engine.setMouse(p.x, p.y, down, clickX, canvas.height - clickY);
});
canvas.addEventListener('pointerup', (e) => {
  down = false;
  const p = canvasPos(e);
  engine.setMouse(p.x, p.y, false, clickX, canvas.height - clickY);
});
canvas.addEventListener(
  'wheel',
  (e) => {
    engine.shared.u_scroll.value += e.deltaY > 0 ? -0.1 : 0.1;
  },
  { passive: true },
);

const keyState = Object.create(null);
addEventListener('keydown', (e) => {
  keyState[e.code] = true;
});
addEventListener('keyup', (e) => {
  keyState[e.code] = false;
});

const _right = new THREE.Vector3();
const _up = new THREE.Vector3(0, 1, 0);
const _lookTarget = new THREE.Vector3();
function updateCamera(dt) {
  const pos = engine.shared.u_camera_pos.value;
  const dir = engine.shared.u_camera_dir.value;
  const yaw = drag.x * 0.003;
  const pitch = Math.max(-1.2, Math.min(1.2, -drag.y * 0.003));
  dir
    .set(Math.sin(yaw) * Math.cos(pitch), Math.sin(pitch), -Math.cos(yaw) * Math.cos(pitch))
    .normalize();
  _right.crossVectors(dir, _up).normalize();
  const speed = (keyState.ShiftLeft ? 5 : 2) * dt;
  if (keyState.KeyW) pos.addScaledVector(dir, speed);
  if (keyState.KeyS) pos.addScaledVector(dir, -speed);
  if (keyState.KeyA) pos.addScaledVector(_right, -speed);
  if (keyState.KeyD) pos.addScaledVector(_right, speed);
  if (keyState.KeyE) pos.y += speed;
  if (keyState.KeyQ) pos.y -= speed;
  _lookTarget.copy(pos).add(dir);
  engine.shared.u_camera_view.value.lookAt(pos, _lookTarget, _up);
}

function activePass() {
  return passes.find((p) => p.id === activeId) || passes[0];
}

function renderTabs() {
  tabsEl.innerHTML = '';
  for (const p of passes) {
    const b = document.createElement('button');
    b.type = 'button';
    b.className = 'pass-tab' + (p.id === activeId ? ' active' : '');
    b.textContent = p.name;
    b.onclick = () => {
      saveEditorToPass();
      activeId = p.id;
      editor.value = p.source;
      hud.textContent = p.name;
      renderTabs();
    };
    tabsEl.appendChild(b);
  }
}

function saveEditorToPass() {
  const p = activePass();
  if (p) p.source = editor.value;
}

function setStatus(ok, msg) {
  statusEl.textContent = msg;
  statusEl.className = 'pill ' + (ok ? 'ok' : 'err');
}

function showErrors(list) {
  if (!list?.length) {
    errorsEl.classList.add('hidden');
    errorsEl.textContent = '';
    return;
  }
  errorsEl.classList.remove('hidden');
  errorsEl.textContent = list.map((e) => `[${e.pass}]\n${e.error}`).join('\n\n');
}

function compile() {
  saveEditorToPass();
  for (const p of passes) {
    if (p.kind !== 'common' && isShadertoySource(p.source)) {
      p.source = convertShadertoyToFragCoord(p.source);
    }
  }
  editor.value = activePass().source;
  const result = engine.setPasses(passes);
  if (result.ok) {
    showErrors([]);
    setStatus(true, 'compiled');
  } else {
    showErrors(result.errors);
    setStatus(false, 'errors');
  }
  return result.ok;
}

function resize() {
  const wrap = canvas.parentElement;
  const r = wrap.getBoundingClientRect();
  engine.resize(r.width, r.height, 1);
}

let frames = 0;
let fpsT = performance.now();
let lastCam = performance.now();

function loop() {
  const now = performance.now();
  const dt = Math.min(0.05, (now - lastCam) / 1000);
  lastCam = now;
  keyboard.update();
  if (audio.active) audio.update();
  updateCamera(dt);
  engine.renderFrame();
  frames++;
  if (now - fpsT > 500) {
    const fps = (frames * 1000) / (now - fpsT);
    fpsEl.textContent = `${fps.toFixed(0)} fps`;
    frames = 0;
    fpsT = now;
  }
  requestAnimationFrame(loop);
}

document.getElementById('btn-run').onclick = () => compile();
document.getElementById('btn-pause').onclick = () => {
  engine.paused = !engine.paused;
  document.getElementById('btn-pause').textContent = engine.paused ? 'Resume' : 'Pause';
};
document.getElementById('btn-reset-time').onclick = () => engine.resetTime();
document.getElementById('btn-add-pass').onclick = () => {
  saveEditorToPass();
  const n = passes.filter((p) => p.kind === 'buffer').length;
  if (n >= 4) {
    setStatus(false, 'max 4 buffers');
    return;
  }
  const letter = String.fromCharCode(65 + n);
  const id = `buf${letter}`;
  passes.splice(passes.length - 1, 0, {
    id,
    name: `Buffer ${letter}`,
    kind: 'buffer',
    bufferIndex: n,
    source:
      `// Buffer ${letter}\nvoid main() {\n  vec2 uv = gl_FragCoord.xy / u_resolution.xy;\n` +
      `  gl_FragColor = vec4(uv, 0.5, 1.0);\n}\n`,
  });
  activeId = id;
  editor.value = passes.find((p) => p.id === id).source;
  renderTabs();
  compile();
};

document.getElementById('btn-audio').onclick = async () => {
  const input = document.createElement('input');
  input.type = 'file';
  input.accept = 'audio/*';
  input.onchange = async () => {
    if (input.files?.[0]) {
      await audio.enableFile(input.files[0]);
      engine.shared.u_audio.value = audio.texture;
      setStatus(true, 'audio file');
    }
  };
  input.click();
};
document.getElementById('btn-mic').onclick = async () => {
  try {
    await audio.enableMic();
    engine.shared.u_audio.value = audio.texture;
    setStatus(true, 'mic on');
  } catch {
    setStatus(false, 'mic blocked');
  }
};

document.getElementById('import-st').onchange = async (e) => {
  const file = e.target.files?.[0];
  if (!file) return;
  try {
    const json = JSON.parse(await file.text());
    const imported = importShadertoyJson(json);
    if (!imported.length) throw new Error('No passes in JSON');
    let bi = 0;
    passes = imported.map((p, i) => {
      let kind = 'image';
      if (/common/i.test(p.name) || p.kind === 'common') kind = 'common';
      else if (/buffer/i.test(p.name) || p.kind === 'buffer') kind = 'buffer';
      const item = {
        id: `${kind}-${i}`,
        name: p.name,
        kind,
        source: p.source,
        bufferIndex: kind === 'buffer' ? bi++ : 0,
      };
      return item;
    });
    if (!passes.some((p) => p.kind === 'image')) {
      passes.push({ id: 'image', name: 'Image', kind: 'image', source: IMAGE });
    }
    if (!passes.some((p) => p.kind === 'common')) {
      passes.unshift({ id: 'common', name: 'Common', kind: 'common', source: '// common\n' });
    }
    activeId = passes.find((p) => p.kind === 'image')?.id || passes[0].id;
    editor.value = activePass().source;
    renderTabs();
    compile();
    setStatus(true, 'shadertoy imported');
  } catch (err) {
    setStatus(false, 'import failed');
    showErrors([{ pass: 'import', error: String(err.message || err) }]);
  }
};

document.getElementById('btn-export').onclick = () => {
  saveEditorToPass();
  const payload = {
    tool: 'Gamemaster Shader Lab',
    passes: passes.map(({ name, kind, source }) => ({ name, kind, source })),
  };
  const blob = new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = 'shader-lab-export.json';
  a.click();
  URL.revokeObjectURL(a.href);
};

editor.addEventListener('keydown', (e) => {
  if ((e.metaKey || e.ctrlKey) && e.key === 'Enter') {
    e.preventDefault();
    compile();
  }
  if (e.key === 'Tab') {
    e.preventDefault();
    const s = editor.selectionStart;
    editor.value = editor.value.slice(0, s) + '  ' + editor.value.slice(editor.selectionEnd);
    editor.selectionStart = editor.selectionEnd = s + 2;
  }
});

let debounce = 0;
editor.addEventListener('input', () => {
  clearTimeout(debounce);
  debounce = setTimeout(() => compile(), 400);
});

addEventListener('resize', resize);

editor.value = activePass().source;
renderTabs();
resize();
compile();
requestAnimationFrame(loop);

console.info('[Gamemaster Shader Lab] FragCoord-class multipass ready');
