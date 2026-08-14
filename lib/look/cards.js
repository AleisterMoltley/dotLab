/** Host look cards — the 30B picks an id, never invents a lighting rig. */
export const CARDS = {
  'neon-night': {
    id: 'neon-night',
    hemiSky: 0x2a2060,
    hemiGround: 0x1a0a3e,
    skyTop: 0x140820,
    hemi: 0.42,
    key: 0xffe066,
    keyInt: 0.55,
    keyPos: [22, 48, 14],
    rim: 0x00f0ff,
    rimInt: 0.5,
    rimPos: [8, 10, -40],
    fill: 0xff2bd6,
    fillInt: 0.28,
    fillPos: [-28, 14, -20],
    fogNear: 8,
    fogFar: 52,
    shadow: false,
    scatter: { kind: 'neon-window', count: 42, radius: 26 },
    shader: 'grid',
    landmark: 'tower',
    ground: 'asphalt',
  },
  'pine-ridge': {
    id: 'pine-ridge',
    hemiSky: 0xc8d8c0,
    hemiGround: 0x2a3320,
    hemi: 0.55,
    key: 0xffe0a8,
    keyInt: 1.05,
    keyPos: [18, 36, 16],
    rim: 0x88a070,
    rimInt: 0.25,
    rimPos: [-20, 12, -30],
    fill: 0x4a6030,
    fillInt: 0.12,
    fillPos: [10, 6, 20],
    fogNear: 12,
    fogFar: 64,
    shadow: true,
    scatter: { kind: 'pine', count: 36, radius: 30 },
    shader: 'toon',
    landmark: 'ridge',
    ground: 'moss',
  },
  'dusk-coast': {
    id: 'dusk-coast',
    hemiSky: 0xffc8a0,
    hemiGround: 0x2a2030,
    hemi: 0.5,
    key: 0xff9960,
    keyInt: 0.9,
    keyPos: [-24, 20, 8],
    rim: 0x6080c0,
    rimInt: 0.35,
    rimPos: [20, 8, -24],
    fill: 0xc07050,
    fillInt: 0.18,
    fillPos: [0, 10, 16],
    fogNear: 14,
    fogFar: 70,
    shadow: true,
    scatter: { kind: 'rock', count: 28, radius: 24 },
    shader: 'water',
    landmark: 'spire',
    ground: 'sand',
  },
  'desert-gold': {
    id: 'desert-gold',
    hemiSky: 0xffe8b0,
    hemiGround: 0x6a4820,
    hemi: 0.6,
    key: 0xfff0c0,
    keyInt: 1.2,
    keyPos: [10, 50, 4],
    rim: 0xc08040,
    rimInt: 0.2,
    rimPos: [-30, 8, -10],
    fill: 0xe0a050,
    fillInt: 0.15,
    fillPos: [16, 6, 20],
    fogNear: 16,
    fogFar: 80,
    shadow: true,
    scatter: { kind: 'dune-rock', count: 22, radius: 32 },
    shader: 'heat',
    landmark: 'arch',
    ground: 'sand',
  },
  'rain-alley': {
    id: 'rain-alley',
    hemiSky: 0x405060,
    hemiGround: 0x101018,
    hemi: 0.35,
    key: 0x88a0c0,
    keyInt: 0.4,
    keyPos: [8, 30, 6],
    rim: 0x204060,
    rimInt: 0.3,
    rimPos: [-12, 6, -18],
    fill: 0x304050,
    fillInt: 0.2,
    fillPos: [0, 8, 10],
    fogNear: 6,
    fogFar: 36,
    shadow: false,
    scatter: { kind: 'alley', count: 20, radius: 16 },
    shader: 'rain',
    landmark: 'door',
    ground: 'wet',
  },
  'interior-warm': {
    id: 'interior-warm',
    hemiSky: 0xffd8a8,
    hemiGround: 0x3a2818,
    hemi: 0.45,
    key: 0xffc070,
    keyInt: 0.7,
    keyPos: [4, 8, 2],
    rim: 0x806040,
    rimInt: 0.2,
    rimPos: [-6, 3, -8],
    fill: 0xc09050,
    fillInt: 0.15,
    fillPos: [6, 2, 6],
    fogNear: 4,
    fogFar: 22,
    shadow: false,
    scatter: { kind: 'lamp', count: 10, radius: 10 },
    shader: 'toon',
    landmark: 'hearth',
    ground: 'wood',
  },
};

export function pickCard(spec = {}) {
  const forced = spec.look || spec.lookId;
  if (forced && CARDS[forced]) return CARDS[forced];
  const g = String(spec.genre || '').toLowerCase();
  const loop = String(spec.loop || '').toLowerCase();
  const props = String(spec.props || spec.setting || '').toLowerCase();
  if (/neon|cyber|void/.test(props) || loop === 'shoot' || g === 'fps' || g === 'arena') {
    return CARDS['neon-night'];
  }
  if (/desert|dune|sand/.test(props) || g === 'racing') return CARDS['desert-gold'];
  if (/horror|sneak|rain|alley/.test(props) || g === 'horror' || loop === 'sneak') {
    return CARDS['rain-alley'];
  }
  if (/village|town|interior|inn/.test(props) || g === 'rpg') return CARDS['interior-warm'];
  if (/coast|sea|dusk|harbor/.test(props) || g === 'adventure') return CARDS['dusk-coast'];
  if (loop === 'jump' || g === 'platformer' || /forest|pine|grove/.test(props)) {
    return CARDS['pine-ridge'];
  }
  if (loop === 'run') return CARDS['neon-night'];
  return CARDS['dusk-coast'];
}
