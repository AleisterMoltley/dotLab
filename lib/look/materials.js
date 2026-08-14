import * as THREE from 'three';

const PRESETS = {
  asphalt: { roughness: 0.92, metalness: 0.08 },
  moss: { roughness: 0.95, metalness: 0.02 },
  sand: { roughness: 0.98, metalness: 0.0 },
  wet: { roughness: 0.28, metalness: 0.35 },
  wood: { roughness: 0.85, metalness: 0.04 },
  neon: { roughness: 0.35, metalness: 0.45, emissiveIntensity: 0.55 },
  bark: { roughness: 0.9, metalness: 0.02 },
  rust: { roughness: 0.7, metalness: 0.4 },
};

export function makeMat(preset, color, extra = {}) {
  const p = PRESETS[preset] || PRESETS.asphalt;
  const opts = {
    color,
    roughness: p.roughness,
    metalness: p.metalness,
    ...extra,
  };
  if (p.emissiveIntensity && extra.emissive == null) {
    opts.emissive = color;
    opts.emissiveIntensity = p.emissiveIntensity;
  }
  return new THREE.MeshStandardMaterial(opts);
}

export function presetNames() {
  return Object.keys(PRESETS);
}
