/**
 * Slice AI: idle → windup (tracks) → strike (DOES NOT track) → recover.
 * Fair first death lives here. Commit that follows the player is a fail.
 */
export const PHASE = { idle: 0, windup: 1, strike: 2, recover: 3, dead: 4 };

export function armBrain(e) {
  e.phase = PHASE.idle;
  e.phaseT = 0.4 + Math.random() * 0.8;
  e.lockX = 0;
  e.lockZ = 0;
  return e;
}

export function tickBrain(e, px, pz, dt, now, cfg = {}) {
  if (e.hp <= 0) {
    e.phase = PHASE.dead;
    return 'dead';
  }
  const wind = cfg.windup ?? 0.32;
  const strike = cfg.strike ?? 0.11;
  const rec = cfg.recover ?? 0.28;
  const aggro = cfg.aggro ?? 7;
  const mesh = e.mesh;
  const dx = px - mesh.position.x;
  const dz = pz - mesh.position.z;
  const d = Math.hypot(dx, dz) || 1;
  e.phaseT -= dt;

  if (e.phase === PHASE.idle) {
    if (d < aggro && e.phaseT <= 0) {
      e.phase = PHASE.windup;
      e.phaseT = wind;
    } else {
      const spd = (e.speed || 1.4) * 0.35;
      mesh.position.x += (dx / d) * spd * dt;
      mesh.position.z += (dz / d) * spd * dt;
    }
  } else if (e.phase === PHASE.windup) {
    const spd = (e.speed || 1.4) * 0.55;
    mesh.position.x += (dx / d) * spd * dt;
    mesh.position.z += (dz / d) * spd * dt;
    e.lockX = px;
    e.lockZ = pz;
    if (mesh.scale) mesh.scale.setScalar(1 + Math.sin(now * 16) * 0.14);
    if (mesh.material && mesh.material.emissiveIntensity != null) {
      mesh.material.emissiveIntensity = 1.1 + Math.sin(now * 18) * 0.5;
    }
    if (e.phaseT <= 0) {
      e.phase = PHASE.strike;
      e.phaseT = strike;
    }
  } else if (e.phase === PHASE.strike) {
    const lx = e.lockX - mesh.position.x;
    const lz = e.lockZ - mesh.position.z;
    const ld = Math.hypot(lx, lz) || 1;
    const spd = (e.speed || 1.4) * 2.4;
    mesh.position.x += (lx / ld) * spd * dt;
    mesh.position.z += (lz / ld) * spd * dt;
    if (mesh.scale) mesh.scale.setScalar(1.08);
    if (e.phaseT <= 0) {
      e.phase = PHASE.recover;
      e.phaseT = rec;
    }
  } else if (e.phase === PHASE.recover) {
    if (mesh.scale) mesh.scale.setScalar(1);
    if (e.phaseT <= 0) {
      e.phase = PHASE.idle;
      e.phaseT = 0.25;
    }
  }
  if (e.baseY != null) {
    mesh.position.y = e.baseY + Math.sin(now * 3 + (e.phase || 0)) * 0.12;
  }
  return e.phase;
}

export function striking(e) {
  return e.phase === PHASE.strike;
}
