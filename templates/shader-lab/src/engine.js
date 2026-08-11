import * as THREE from 'three';
import { convertShadertoyToFragCoord, isShadertoySource } from './shadertoy.js';

const VERT = /* glsl */`
varying vec2 vUv;
void main() {
  vUv = uv;
  gl_Position = vec4(position.xy, 0.0, 1.0);
}
`;

function wrapFragment(userSrc, commonSrc) {
  let body = userSrc.trim();
  if (isShadertoySource(body)) body = convertShadertoyToFragCoord(body);

  // If user already has precision/main ok, still inject uniforms header if missing
  const header = /* glsl */`
precision highp float;
uniform float u_time;
uniform float u_time_delta;
uniform int u_frame;
uniform vec2 u_resolution;
uniform vec4 u_mouse;
uniform vec2 u_drag;
uniform float u_scroll;
uniform vec4 u_date;
uniform float u_refresh_rate;
uniform vec3 u_camera_pos;
uniform vec3 u_camera_dir;
uniform mat4 u_camera_view;
uniform sampler2D u_audio;
uniform sampler2D u_keyboard;
uniform sampler2D u_webcam;
uniform sampler2D u_buffer_a;
uniform sampler2D u_buffer_b;
uniform sampler2D u_buffer_c;
uniform sampler2D u_buffer_d;
uniform int u_passes;
varying vec2 vUv;

${commonSrc || ''}
`;

  if (!/\bvoid\s+main\s*\(/.test(body) && !/\bmainImage\s*\(/.test(body)) {
    body = `void main(){\n${body}\n}`;
  }
  // avoid double precision
  body = body.replace(/^\s*precision\s+\w+\s+float\s*;\s*/m, '');
  return header + '\n' + body;
}

function makeTarget(w, h) {
  const opts = {
    minFilter: THREE.LinearFilter,
    magFilter: THREE.LinearFilter,
    wrapS: THREE.ClampToEdgeWrapping,
    wrapT: THREE.ClampToEdgeWrapping,
    type: THREE.HalfFloatType,
    format: THREE.RGBAFormat,
    depthBuffer: false,
    stencilBuffer: false,
  };
  try {
    return new THREE.WebGLRenderTarget(Math.max(1, w), Math.max(1, h), opts);
  } catch {
    opts.type = THREE.UnsignedByteType;
    return new THREE.WebGLRenderTarget(Math.max(1, w), Math.max(1, h), opts);
  }
}

/**
 * Multipass engine: Common + N buffers + Image
 * Buffer passes ping-pong for self-feedback.
 */
export function createEngine(canvas) {
  const renderer = new THREE.WebGLRenderer({
    canvas,
    antialias: false,
    alpha: false,
    powerPreference: 'high-performance',
  });
  renderer.setPixelRatio(1); // deterministic for shaders; can raise later
  renderer.outputColorSpace = THREE.LinearSRGBColorSpace;

  const camera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);
  const scene = new THREE.Scene();
  const geo = new THREE.PlaneGeometry(2, 2);

  const emptyTex = new THREE.DataTexture(new Uint8Array([0, 0, 0, 255]), 1, 1);
  emptyTex.needsUpdate = true;

  const shared = {
    u_time: { value: 0 },
    u_time_delta: { value: 0 },
    u_frame: { value: 0 },
    u_resolution: { value: new THREE.Vector2(1, 1) },
    u_mouse: { value: new THREE.Vector4(-1, -1, -1, -1) },
    u_drag: { value: new THREE.Vector2() },
    u_scroll: { value: 0 },
    u_date: { value: new THREE.Vector4() },
    u_refresh_rate: { value: 60 },
    u_camera_pos: { value: new THREE.Vector3(0, 0, 3) },
    u_camera_dir: { value: new THREE.Vector3(0, 0, -1) },
    u_camera_view: { value: new THREE.Matrix4() },
    u_audio: { value: emptyTex },
    u_keyboard: { value: emptyTex },
    u_webcam: { value: emptyTex },
    u_buffer_a: { value: emptyTex },
    u_buffer_b: { value: emptyTex },
    u_buffer_c: { value: emptyTex },
    u_buffer_d: { value: emptyTex },
    u_passes: { value: 1 },
  };

  /** @type {{id:string,name:string,kind:'common'|'buffer'|'image',source:string,material?:THREE.ShaderMaterial,rt:[any,any],idx:number}[]} */
  let passes = [];
  let commonSource = '';
  let frame = 0;
  let lastT = performance.now();
  let paused = false;
  let timeOrigin = performance.now();
  let frozenTime = 0;
  let w = 1;
  let h = 1;

  function bufferSlotName(i) {
    return ['u_buffer_a', 'u_buffer_b', 'u_buffer_c', 'u_buffer_d'][i] || 'u_buffer_a';
  }

  function tryBuildMaterial(pass) {
    const fragmentShader = wrapFragment(pass.source, commonSource);
    const uniforms = {};
    for (const k of Object.keys(shared)) uniforms[k] = shared[k];
    const mat = new THREE.ShaderMaterial({
      vertexShader: VERT,
      fragmentShader,
      uniforms,
      depthTest: false,
      depthWrite: false,
    });
    const mesh = new THREE.Mesh(geo, mat);
    scene.clear();
    scene.add(mesh);
    // Render once to force program compile
    const prev = renderer.getRenderTarget();
    const probe = makeTarget(4, 4);
    renderer.setRenderTarget(probe);
    let err = null;
    try {
      renderer.render(scene, camera);
      // check for WebGL shader errors by reading program logs if available
      const pr = renderer.properties.get(mat);
      if (pr?.program?.diagnostics) {
        const d = pr.program.diagnostics;
        if (d?.fragmentShader?.log) err = d.fragmentShader.log;
        else if (d?.programLog) err = d.programLog;
      }
    } catch (e) {
      err = String(e.message || e);
    }
    renderer.setRenderTarget(prev);
    probe.dispose();
    if (err) {
      mat.dispose();
      return { ok: false, error: err };
    }
    pass.material = mat;
    return { ok: true };
  }

  function setPasses(defs) {
    // dispose old
    for (const p of passes) {
      p.material?.dispose();
      if (p.rt) {
        p.rt[0]?.dispose();
        p.rt[1]?.dispose();
      }
    }
    commonSource = defs.find((d) => d.kind === 'common')?.source || '';
    passes = defs.map((d, i) => ({
      id: d.id || `${d.kind}-${i}`,
      name: d.name,
      kind: d.kind,
      source: d.source,
      material: null,
      rt: null,
      flip: 0,
      bufferIndex: d.bufferIndex ?? 0,
    }));

    // assign buffer indices in order for buffer kinds
    let bi = 0;
    for (const p of passes) {
      if (p.kind === 'buffer') {
        p.bufferIndex = bi++;
        p.rt = [makeTarget(w, h), makeTarget(w, h)];
      }
    }
    shared.u_passes.value = passes.filter((p) => p.kind !== 'common').length;

    const errors = [];
    for (const p of passes) {
      if (p.kind === 'common') continue;
      const res = tryBuildMaterial(p);
      if (!res.ok) errors.push({ pass: p.name, error: res.error || 'compile failed' });
    }
    return { ok: errors.length === 0, errors };
  }

  function resize(cssW, cssH, dpr = 1) {
    w = Math.max(1, Math.floor(cssW * dpr));
    h = Math.max(1, Math.floor(cssH * dpr));
    renderer.setSize(cssW, cssH, false);
    canvas.width = w;
    canvas.height = h;
    shared.u_resolution.value.set(w, h);
    for (const p of passes) {
      if (p.rt) {
        p.rt[0].setSize(w, h);
        p.rt[1].setSize(w, h);
      }
    }
  }

  function updateDate() {
    const d = new Date();
    const sod = d.getHours() * 3600 + d.getMinutes() * 60 + d.getSeconds() + d.getMilliseconds() / 1000;
    shared.u_date.value.set(d.getFullYear(), d.getMonth() + 1, d.getDate(), sod);
  }

  function setMouse(x, y, down, clickX, clickY) {
    // bottom-left origin like GLSL fragCoord
    const mx = x;
    const my = h - y;
    const z = down ? clickX : -clickX;
    const ww = down ? clickY : -clickY;
    shared.u_mouse.value.set(mx, my, z, ww);
  }

  function bindBufferTextures() {
    // expose latest completed buffer textures
    for (const p of passes) {
      if (p.kind !== 'buffer' || !p.rt) continue;
      const tex = p.rt[p.flip].texture;
      const name = bufferSlotName(p.bufferIndex);
      shared[name].value = tex;
    }
  }

  function renderFrame() {
    const now = performance.now();
    const dt = Math.min(0.1, (now - lastT) / 1000);
    lastT = now;
    if (!paused) {
      frozenTime = (now - timeOrigin) / 1000;
    }
    shared.u_time.value = frozenTime;
    shared.u_time_delta.value = dt;
    shared.u_frame.value = frame++;
    updateDate();
    bindBufferTextures();

    const mesh = new THREE.Mesh(geo, null);
    scene.clear();
    scene.add(mesh);

    // buffer passes
    for (const p of passes) {
      if (p.kind !== 'buffer' || !p.material || !p.rt) continue;
      // self-feedback: previous flip
      const read = p.rt[p.flip].texture;
      const writeIdx = 1 - p.flip;
      const name = bufferSlotName(p.bufferIndex);
      // temporarily set own buffer uniform to previous
      const prev = shared[name].value;
      shared[name].value = read;
      mesh.material = p.material;
      renderer.setRenderTarget(p.rt[writeIdx]);
      renderer.render(scene, camera);
      p.flip = writeIdx;
      shared[name].value = p.rt[p.flip].texture;
      // keep others
      void prev;
    }

    bindBufferTextures();

    // image pass
    const image = passes.find((p) => p.kind === 'image');
    if (image?.material) {
      mesh.material = image.material;
      renderer.setRenderTarget(null);
      renderer.render(scene, camera);
    }
  }

  function resetTime() {
    timeOrigin = performance.now();
    frozenTime = 0;
    frame = 0;
  }

  return {
    shared,
    setPasses,
    resize,
    renderFrame,
    setMouse,
    resetTime,
    set paused(v) { paused = v; },
    get paused() { return paused; },
    get frame() { return frame; },
    get time() { return frozenTime; },
    dispose() {
      for (const p of passes) {
        p.material?.dispose();
        p.rt?.[0]?.dispose();
        p.rt?.[1]?.dispose();
      }
      geo.dispose();
      renderer.dispose();
    },
  };
}
