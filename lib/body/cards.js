/** Host body cards. The model picks ids. It does not invent a capsule hero. */
export const BODIES = {
  visor: { id: 'visor', role: 'player' },
  runner: { id: 'runner', role: 'player' },
  drone: { id: 'drone', role: 'enemy' },
  crawler: { id: 'crawler', role: 'enemy' },
  captain: { id: 'captain', role: 'enemy' },
  pulse: { id: 'pulse', role: 'weapon' },
  crate: { id: 'crate', role: 'cover' },
};

export function pickBody(spec) {
  const given = (spec && spec.body) || {};
  const loop = (spec && spec.loop) || '';
  const genre = (spec && spec.genre) || '';
  const shoot = loop === 'shoot' || genre === 'fps' || genre === 'arena';
  return {
    player: given.player || (loop === 'jump' || loop === 'run' ? 'runner' : 'visor'),
    enemy: given.enemy || (loop === 'jump' ? 'crawler' : shoot ? 'drone' : 'drone'),
    weapon: given.weapon || (shoot ? 'pulse' : 'pulse'),
    cover: given.cover || 'crate',
  };
}
