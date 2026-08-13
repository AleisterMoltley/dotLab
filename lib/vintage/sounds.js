/**
 * Vintage 4-channel-ish square blips — host sound bank.
 * Used by optional import; game.js may inline blip() already.
 */
export function createVintageAudio() {
  let ac = null;
  function ctx() {
    if (!ac) ac = new (window.AudioContext || window.webkitAudioContext)();
    return ac;
  }
  function blip(f = 220, dur = 0.05, type = 'square', gain = 0.03) {
    try {
      const a = ctx();
      const o = a.createOscillator();
      const g = a.createGain();
      o.type = type;
      o.frequency.value = f;
      g.gain.value = gain;
      o.connect(g);
      g.connect(a.destination);
      o.start();
      o.stop(a.currentTime + dur);
    } catch (_) {}
  }
  return {
    jump: () => blip(320, 0.04),
    coin: () => blip(660, 0.05),
    hurt: () => blip(110, 0.08),
    hit: () => blip(180, 0.05),
    fanfare: () => {
      blip(262, 0.08);
      setTimeout(() => blip(330, 0.08), 90);
      setTimeout(() => blip(392, 0.12), 180);
    },
    death: () => blip(80, 0.2),
    blip,
  };
}
