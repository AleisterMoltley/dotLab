import { PHASE } from '../craft/brain.js';

/**
 * Procedural pose. No mixer. Idle breath, walk bob, windup lean, strike lunge.
 */
export function tickPose(body, st) {
  if (!body) return;
  const now = st.now || 0;
  const dt = st.dt || 0.016;
  const phase = st.phase;
  const moving = !!st.moving;
  const torso = body.torso;
  const visor = body.visor;
  const ring = body.mesh && body.mesh.userData && body.mesh.userData.ring;
  const base = body.kind === 'runner' ? 0.86 : 0.92;

  if (torso) {
    const breath = Math.sin(now * 2.1) * 0.012;
    const step = moving ? Math.sin(now * 11) * 0.045 : 0;
    torso.position.y = base + breath + step;
    torso.rotation.z = moving ? Math.sin(now * 11) * 0.05 : 0;
  }
  if (visor) {
    visor.scale.setScalar(phase === PHASE.windup ? 1.18 : 1);
  }
  if (ring) {
    ring.rotation.z += dt * (phase === PHASE.strike ? 8 : 2.2);
  }
  if (body.core && body.core.material && body.core.material.emissiveIntensity != null) {
    if (phase === PHASE.windup) {
      body.core.material.emissiveIntensity = 1.15 + Math.sin(now * 18) * 0.45;
    } else if (phase === PHASE.strike) {
      body.core.material.emissiveIntensity = 1.6;
    }
  }
}
