/** WebAudio synth bus — silence on hit is a ship-bar fail. */
let ctx;

function ac() {
  if (!ctx) ctx = new (window.AudioContext || window.webkitAudioContext)();
  if (ctx.state === 'suspended') ctx.resume().catch(() => {});
  return ctx;
}

export function blip(freq = 220, dur = 0.06, type = 'square', gain = 0.05) {
  try {
    const c = ac();
    const o = c.createOscillator();
    const g = c.createGain();
    o.type = type;
    o.frequency.value = freq;
    g.gain.value = gain;
    o.connect(g);
    g.connect(c.destination);
    o.start();
    g.gain.exponentialRampToValueAtTime(0.0001, c.currentTime + dur);
    o.stop(c.currentTime + dur + 0.02);
  } catch {
    /* ignore */
  }
}

export function sfx(kind) {
  switch (kind) {
    case 'shoot':
      blip(180 + Math.random() * 40, 0.04, 'sawtooth', 0.04);
      break;
    case 'hit':
      blip(420, 0.05, 'square', 0.06);
      break;
    case 'kill':
      blip(140, 0.09, 'square', 0.07);
      blip(280, 0.12, 'triangle', 0.04);
      break;
    case 'dash':
      blip(90, 0.08, 'sawtooth', 0.05);
      break;
    case 'hurt':
      blip(70, 0.12, 'sawtooth', 0.07);
      break;
    case 'death':
      blip(55, 0.22, 'triangle', 0.08);
      break;
    case 'jump':
      blip(520, 0.05, 'square', 0.035);
      break;
    default:
      blip(220, 0.05, 'square', 0.04);
  }
}
