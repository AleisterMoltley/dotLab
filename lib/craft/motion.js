/** Cheap motion that reads as life. No mixer required on a slice. */
export function spinY(obj, dt, rpm = 0.4) {
  obj.rotation.y += dt * rpm * Math.PI * 2;
}

export function bobY(obj, baseY, now, phase = 0, amp = 0.18, hz = 1.6) {
  obj.position.y = baseY + Math.sin(now * hz * Math.PI * 2 + phase) * amp;
}

export function squashLand(obj, amount) {
  const s = Math.max(0.72, 1 - amount);
  obj.scale.set(1 / s, s, 1 / s);
}

export function unsquash(obj, dt) {
  const t = Math.min(1, 10 * dt);
  obj.scale.x += (1 - obj.scale.x) * t;
  obj.scale.y += (1 - obj.scale.y) * t;
  obj.scale.z += (1 - obj.scale.z) * t;
}

/** Windup pulse — readable telegraph. */
export function telegraphScale(obj, now, on) {
  obj.scale.setScalar(on ? 1 + Math.sin(now * 14) * 0.12 : 1);
}

/** Kill confirm: swell then vanish. t is seconds since death. */
export function popOut(obj, t) {
  const k = Math.max(0, 1 - t * 5);
  obj.scale.setScalar(0.35 + k * 0.95);
  if (t > 0.2) {
    obj.visible = false;
    return true;
  }
  return false;
}
