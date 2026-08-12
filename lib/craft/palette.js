/** NEON INK locked palette — do not drift. Zero-asset NPR neon. */
export const Palette = {
  void: 0x0a0612,
  indigo: 0x1a0a3e,
  magenta: 0xff2bd6,
  cyan: 0x00f0ff,
  acid: 0xb8ff00,
  ink: 0x0d0a14,
  wet: 0x1e1440,
  flare: 0xffe066,
  white: 0xffffff,
  mid: 0x3a2a6a,
  street: 0x12101c,
  buildingA: 0x1c1235,
  buildingB: 0x140e28,
  buildingC: 0x22184a,
};

export function toThreePalette(P = Palette) {
  return {
    bg: P.void,
    ground: P.street,
    grid: P.cyan,
    player: P.magenta,
    accent: P.magenta,
    enemy: P.acid,
    building: P.buildingA,
    hemiSky: 0xa8b8ff,
    hemiGround: P.indigo,
    sun: P.flare,
    fogNear: 8,
    fogFar: 70,
  };
}
