/** WebAudio synth bus — silence on hit is a ship-bar fail. */
let ctx;

function ac() {
  if (!ctx) ctx = new (window.AudioContext || window.webkitAudioContext)();
  if (ctx.state === 'suspended') ctx.resume().catch(() => {});
  return ctx;
}

export function blip(freq = 220, dur = 0.06, type = 'square', gain = 0.05, pan = 0) {
  try {
    const c = ac();
    const o = c.createOscillator();
    const g = c.createGain();
    o.type = type;
    o.frequency.value = freq;
    g.gain.value = gain;
    o.connect(g);
    const p = Math.max(-1, Math.min(1, pan || 0));
    if (p !== 0 && c.createStereoPanner) {
      const panNode = c.createStereoPanner();
      panNode.pan.value = p;
      g.connect(panNode);
      panNode.connect(c.destination);
    } else {
      g.connect(c.destination);
    }
    o.start();
    g.gain.exponentialRampToValueAtTime(0.0001, c.currentTime + dur);
    o.stop(c.currentTime + dur + 0.02);
  } catch {
    /* ignore */
  }
}

export function sfx(kind, pan = 0) {
  switch (kind) {
    case 'shoot':
      blip(180 + Math.random() * 40, 0.04, 'sawtooth', 0.04, pan);
      blip(880 + Math.random() * 180, 0.018, 'square', 0.018, pan);
      break;
    case 'hit':
      blip(420, 0.05, 'square', 0.06, pan);
      break;
    case 'kill':
      blip(140, 0.09, 'square', 0.07, pan);
      blip(280, 0.12, 'triangle', 0.04, pan);
      break;
    case 'dash':
      blip(90, 0.08, 'sawtooth', 0.05, pan);
      break;
    case 'hurt':
      blip(70, 0.12, 'sawtooth', 0.07, pan);
      break;
    case 'death':
      blip(55, 0.22, 'triangle', 0.08, pan);
      break;
    case 'jump':
      blip(520, 0.05, 'square', 0.035, pan);
      break;
    case 'land':
      blip(170, 0.045, 'triangle', 0.03, pan);
      break;
    default:
      blip(220, 0.05, 'square', 0.04, pan);
  }
}
