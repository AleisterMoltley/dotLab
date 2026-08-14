/**
 * The juice stack, in order. One call per meaningful hit.
 * TimeJuice → shake → sfx → optional hitmarker.
 * Silence on hit is a fail — this function exists so you cannot forget a layer.
 */
export function punch(stack, kind = 'hit') {
  const juice = stack.timeJuice;
  const shake = stack.shake;
  const sfx = stack.sfx;
  const j = stack.juiceMul == null ? 1 : stack.juiceMul;
  if (kind === 'shoot') {
    if (shake) shake.amount = Math.min(1.4, shake.amount + 0.16 * j);
    if (typeof sfx === 'function') sfx('shoot');
    return;
  }
  if (kind === 'hit') {
    if (juice && juice.body) juice.body();
    if (shake) shake.amount = Math.min(1.4, shake.amount + 0.25 * j);
    if (typeof sfx === 'function') sfx('hit');
    if (typeof stack.hitmark === 'function') stack.hitmark();
    return;
  }
  if (kind === 'kill') {
    if (juice && juice.kill) juice.kill();
    if (shake) shake.amount = Math.min(1.4, shake.amount + 0.35 * j);
    if (typeof sfx === 'function') sfx('kill');
    if (typeof stack.hitmark === 'function') stack.hitmark();
    return;
  }
  if (kind === 'land') {
    if (shake) shake.amount = Math.min(1.4, shake.amount + 0.08 * j);
    if (typeof sfx === 'function') sfx('land');
    return;
  }
  if (kind === 'hurt') {
    if (shake) shake.amount = Math.min(1.4, shake.amount + 0.55 * j);
    if (typeof sfx === 'function') sfx('hurt');
    return;
  }
  if (kind === 'death') {
    if (shake) shake.amount = Math.min(1.4, shake.amount + 1.05 * j);
    if (typeof sfx === 'function') sfx('death');
  }
}
