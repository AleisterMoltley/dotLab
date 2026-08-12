/**
 * Vintage host palettes — never exceed Game Boy Advance color budgets.
 *
 * GB  (DMG): 4 shades, green-gray
 * GBC: 4 shades per layer, curated 4-color sets
 * GBA: ≤15 unique colors on screen (practical cap for "one scene")
 *
 * All values are 0xRRGGBB ints for host injection.
 */

/** Original DMG LCD-ish greens (dark → light). */
export const DMG = {
  id: "dmg",
  colors: [0x0f380f, 0x306230, 0x8bac0f, 0x9bbc0f],
  names: ["black", "dark", "light", "white"],
};

/** Pocket gray DMG variant. */
export const DMG_GRAY = {
  id: "dmg-gray",
  colors: [0x1a1c2c, 0x5d576b, 0xa2a0a8, 0xf0f0f0],
  names: ["black", "dark", "light", "white"],
};

/** GBC-style 4-color mood packs (still ≤4). */
export const GBC_PACKS = {
  forest: [0x1b1f1a, 0x3e5c38, 0x8fbf6a, 0xdce8c0],
  ocean: [0x0b1a2a, 0x1e4a6e, 0x5aa9d6, 0xc8e8f8],
  fire: [0x1a0a08, 0x6b2010, 0xd06020, 0xf0d090],
  mono: [0x101018, 0x404050, 0xa0a0b0, 0xf0f0f8],
  candy: [0x201028, 0x703868, 0xe080b0, 0xf8e0f0],
};

/**
 * GBA scene packs — at most 15 unique colors (indices 0..14).
 * Designed for readable platformers / top-down adventures.
 */
export const GBA_SCENES = {
  overworld: [
    0x1a2030, 0x2d4a3e, 0x4a7a50, 0x8cbc70, // ground/grass
    0x3a5068, 0x6080a0, 0xa0c0d8, // sky/water
    0x4a3020, 0x8a6040, 0xc8a070, // wood/dirt
    0x202028, 0xf0e8d0, // ink / paper
    0xc04040, 0xe0c040, 0x60a0e0, // accent enemy/coin/ui
  ],
  dungeon: [
    0x101018, 0x282838, 0x484860, 0x787898,
    0x3a2018, 0x6a4030, 0xa07050,
    0x183028, 0x306050,
    0xc8b898, 0xe8e0d0,
    0xb03030, 0xd0a030, 0x5080c0, 0x80c070,
  ],
  night: [
    0x080818, 0x101830, 0x203050, 0x405878,
    0x182818, 0x304830, 0x608060,
    0x401828, 0x803050,
    0xc0b090, 0xe8e0c8,
    0xe05050, 0xf0d060, 0x60b0f0, 0xa0f080,
  ],
};

export const PROFILES = {
  /** Classic Game Boy — default Vintage ship bar */
  gb: {
    id: "gb",
    label: "Game Boy",
    width: 160,
    height: 144,
    maxColors: 4,
    palette: DMG,
    integerScale: true,
    scanlines: false,
    audio: "square4", // 4 channel square-ish
  },
  gbc: {
    id: "gbc",
    label: "Game Boy Color",
    width: 160,
    height: 144,
    maxColors: 8, // practical on-screen budget (2×4 layers feel)
    packs: GBC_PACKS,
    integerScale: true,
    scanlines: false,
    audio: "square4",
  },
  /** Hard ceiling — never exceed this in Vintage mode */
  gba: {
    id: "gba",
    label: "Game Boy Advance",
    width: 240,
    height: 160,
    maxColors: 15,
    scenes: GBA_SCENES,
    integerScale: true,
    scanlines: false,
    audio: "gba",
  },
};

/** Absolute caps for Vintage mode (GBA is the ceiling). */
export const VINTAGE_CEILING = {
  maxWidth: 240,
  maxHeight: 160,
  maxColors: 15,
  noThree: true,
  noFilter: true, // nearest only
  noPostFx: true, // no bloom/blur/chromatic
};

export function resolveProfile(id) {
  const key = (id || "gb").toLowerCase();
  if (key === "gba" || key === "advance") return PROFILES.gba;
  if (key === "gbc" || key === "color") return PROFILES.gbc;
  return PROFILES.gb;
}

export function toSlicePalette(profile, mood = "forest") {
  const p = resolveProfile(profile);
  if (p.id === "gb") {
    const c = p.palette.colors;
    return {
      bg: c[0],
      ground: c[1],
      grid: c[2],
      player: c[3],
      accent: c[2],
      enemy: c[1],
      building: c[1],
      hemiSky: c[2],
      hemiGround: c[0],
      sun: c[3],
      fogNear: 0,
      fogFar: 0,
    };
  }
  if (p.id === "gbc") {
    const c = (p.packs && p.packs[mood]) || GBC_PACKS.forest;
    return {
      bg: c[0],
      ground: c[1],
      grid: c[2],
      player: c[3],
      accent: c[2],
      enemy: c[1],
      building: c[1],
      hemiSky: c[2],
      hemiGround: c[0],
      sun: c[3],
      fogNear: 0,
      fogFar: 0,
    };
  }
  // gba
  const scene = (p.scenes && (p.scenes[mood] || p.scenes.overworld)) || GBA_SCENES.overworld;
  return {
    bg: scene[0],
    ground: scene[1],
    grid: scene[3],
    player: scene[11],
    accent: scene[13],
    enemy: scene[12],
    building: scene[7],
    hemiSky: scene[5],
    hemiGround: scene[1],
    sun: scene[11],
    fogNear: 0,
    fogFar: 0,
    _all: scene,
  };
}
