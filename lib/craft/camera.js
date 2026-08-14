/**
 * Camera is half of feel. Never parent to the player mesh for action.
 * Spring: 1 - exp(-lag * dt). FPS is eye + look vector, not a child.
 */
export function springTo(camera, ideal, dt, lag = 8) {
  const k = 1 - Math.exp(-(lag || 8) * dt);
  camera.position.lerp(ideal, k);
  return k;
}

export function fpsLook(camera, pos, yaw, pitch, lookOut) {
  camera.position.set(pos.x, pos.y, pos.z);
  const cp = Math.cos(pitch);
  lookOut.set(
    pos.x - Math.sin(yaw) * cp,
    pos.y + Math.sin(pitch),
    pos.z - Math.cos(yaw) * cp,
  );
  camera.lookAt(lookOut);
}

export function chaseIdeal(out, pos, cfg, mode) {
  if (mode === 'top') {
    out.set(pos.x, cfg.camDist || 16, pos.z + 0.1);
  } else if (mode === 'side') {
    out.set(pos.x, pos.y + 2.2, pos.z + (cfg.camDist || 11));
  } else {
    const ahead = cfg.camLookAhead || 0;
    out.set(
      pos.x,
      pos.y + (cfg.camHeight || 2.4),
      pos.z + (cfg.camDist || 6.5) + ahead,
    );
  }
  return out;
}

export function applyShake(camera, amount, now) {
  if (!(amount > 0)) return;
  camera.position.x += Math.sin(now * 58) * amount * 0.12;
  camera.position.y += Math.cos(now * 47) * amount * 0.08;
}

export function kickFov(camera, target, dt, rate = 10) {
  camera.fov += (target - camera.fov) * Math.min(1, rate * dt);
  camera.updateProjectionMatrix();
}
