import { PHASE } from './brain.js';

/**
 * Max N attackers. The rest orbit. Fair first death is a turn, not a pile-on.
 */
export function tickDirector(enemies, px, pz, { max = 3 } = {}) {
  const live = [];
  for (const e of enemies || []) {
    if (e && e.hp > 0 && e.mesh) live.push(e);
  }
  const busy = live.filter(
    (e) => e.phase === PHASE.windup || e.phase === PHASE.strike,
  );
  const idle = live.filter((e) => !busy.includes(e));
  idle.sort((a, b) => {
    const da = Math.hypot(px - a.mesh.position.x, pz - a.mesh.position.z);
    const db = Math.hypot(px - b.mesh.position.x, pz - b.mesh.position.z);
    return da - db;
  });
  const slots = Math.max(0, max - busy.length);
  for (let i = 0; i < idle.length; i++) idle[i].hold = i >= slots;
  return slots;
}
