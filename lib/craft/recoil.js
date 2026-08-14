/**
 * Viewmodel spring. Recoil is a kick + recover, not a random HUD jump.
 * ADS tightens the kick. Apply after camera so the gun sits in view space.
 */
export function makeRecoil() {
  return { x: 0, y: 0, z: 0, pitch: 0 };
}

export function kickRecoil(r, ads) {
  const k = ads ? 0.4 : 1;
  r.z = Math.min(0.16, r.z + 0.06 * k);
  r.y += 0.012 * k;
  r.x += (Math.random() - 0.5) * 0.022 * k;
  r.pitch = Math.min(0.08, r.pitch + 0.03 * k);
  return r;
}

export function springRecoil(r, dt) {
  const t = 1 - Math.exp(-16 * dt);
  r.x += (0 - r.x) * t;
  r.y += (0 - r.y) * t;
  r.z += (0 - r.z) * t;
  r.pitch += (0 - r.pitch) * t;
  return r;
}
