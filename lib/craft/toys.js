/** One toy per slice. The model picks an id. It does not invent a second verb. */
export const TOYS = {
  ricochet: { id: 'ricochet', verb: 'bounce' },
  'dash-slash': { id: 'dash-slash', verb: 'dash hits' },
  sticky: { id: 'sticky', verb: 'stick then pop' },
  'time-gun': { id: 'time-gun', verb: 'freeze on hit' },
};

export function pickToy(spec) {
  const id = (spec && spec.toy) || '';
  if (TOYS[id]) return id;
  const loop = (spec && spec.loop) || '';
  if (loop === 'shoot') return 'ricochet';
  return 'dash-slash';
}
