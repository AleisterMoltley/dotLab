import * as THREE from 'three';

/** 512×2 DataTexture: row0 FFT, row1 waveform — FragCoord-like u_audio */
export function createAudioTexture() {
  const w = 512;
  const h = 2;
  const data = new Uint8Array(w * h);
  const tex = new THREE.DataTexture(data, w, h, THREE.RedFormat);
  tex.minFilter = THREE.LinearFilter;
  tex.magFilter = THREE.LinearFilter;
  tex.needsUpdate = true;

  let ctx = null;
  let analyser = null;
  let freq = null;
  let wave = null;
  let source = null;

  async function enableMic() {
    await ensureCtx();
    const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    connect(ctx.createMediaStreamSource(stream));
  }

  async function enableFile(file) {
    await ensureCtx();
    const buf = await file.arrayBuffer();
    const audioBuf = await ctx.decodeAudioData(buf.slice(0));
    const src = ctx.createBufferSource();
    src.buffer = audioBuf;
    src.loop = true;
    connect(src);
    src.start();
  }

  async function ensureCtx() {
    if (!ctx) {
      ctx = new (window.AudioContext || window.webkitAudioContext)();
      analyser = ctx.createAnalyser();
      analyser.fftSize = 1024;
      freq = new Uint8Array(analyser.frequencyBinCount);
      wave = new Uint8Array(analyser.fftSize);
      analyser.connect(ctx.destination);
    }
    if (ctx.state === 'suspended') await ctx.resume();
  }

  function connect(node) {
    if (source) {
      try { source.disconnect(); } catch { /* */ }
    }
    source = node;
    source.connect(analyser);
  }

  function update() {
    if (!analyser) return tex;
    analyser.getByteFrequencyData(freq);
    analyser.getByteTimeDomainData(wave);
    for (let i = 0; i < w; i++) {
      const fi = Math.min(freq.length - 1, (i * freq.length / w) | 0);
      const wi = Math.min(wave.length - 1, (i * wave.length / w) | 0);
      data[i] = freq[fi];
      data[w + i] = wave[wi];
    }
    tex.needsUpdate = true;
    return tex;
  }

  return { texture: tex, enableMic, enableFile, update, get active() { return !!analyser; } };
}

/** 256×3 keyboard state texture — held / press / toggle */
export function createKeyboardTexture() {
  const w = 256;
  const h = 3;
  const data = new Uint8Array(w * h);
  const tex = new THREE.DataTexture(data, w, h, THREE.RedFormat);
  tex.minFilter = THREE.NearestFilter;
  tex.magFilter = THREE.NearestFilter;
  tex.needsUpdate = true;

  const held = new Uint8Array(256);
  const press = new Uint8Array(256);
  const toggle = new Uint8Array(256);

  function codeIndex(e) {
    // map to 0-255-ish from keyCode legacy + code hash
    if (typeof e.keyCode === 'number' && e.keyCode > 0 && e.keyCode < 256) return e.keyCode;
    let hsh = 0;
    for (let i = 0; i < e.code.length; i++) hsh = (hsh * 31 + e.code.charCodeAt(i)) & 255;
    return hsh;
  }

  addEventListener('keydown', (e) => {
    const i = codeIndex(e);
    if (!held[i]) press[i] = 255;
    held[i] = 255;
    if (!e.repeat) toggle[i] = toggle[i] ? 0 : 255;
  });
  addEventListener('keyup', (e) => {
    const i = codeIndex(e);
    held[i] = 0;
  });

  function update() {
    for (let i = 0; i < 256; i++) {
      data[i] = held[i];
      data[256 + i] = press[i];
      data[512 + i] = toggle[i];
      press[i] = 0; // one-frame pulse
    }
    tex.needsUpdate = true;
    return tex;
  }

  return { texture: tex, update };
}
