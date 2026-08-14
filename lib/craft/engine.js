/**
 * Host engine law. Three.js vanilla, Vite, metres, Y-up.
 * The 30B does not pick Unity, Z-up, or a second renderer.
 */
export const ENGINE = {
  renderer: 'three',
  style: 'vanilla',
  bundler: 'vite',
  unit: 'meter',
  up: 'y',
};

export function applyEngine(camera, scene) {
  if (camera && camera.up) camera.up.set(0, 1, 0);
  if (scene && scene.up) scene.up.set(0, 1, 0);
  try {
    if (typeof window !== 'undefined') window.__GF_ENGINE__ = ENGINE;
  } catch { /* */ }
  return ENGINE;
}
