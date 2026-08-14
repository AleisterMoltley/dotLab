/**
 * Hurt flash. CSS overlay — zero draw calls, reads as "I got hit".
 * Silence on damage is a fail; this is the layer models forget.
 */
export function attachVignette() {
  let el = document.getElementById('gm-hurt');
  if (!el) {
    el = document.createElement('div');
    el.id = 'gm-hurt';
    el.style.cssText =
      'position:fixed;inset:0;pointer-events:none;z-index:4;' +
      'background:radial-gradient(ellipse at center,transparent 42%,rgba(150,0,22,.74) 100%);' +
      'opacity:0';
    document.body.appendChild(el);
  }
  return {
    amount: 0,
    flash(a = 0.7) {
      this.amount = Math.min(1, Math.max(this.amount, a));
    },
    tick(dt) {
      this.amount = Math.max(0, this.amount - dt * 2.4);
      el.style.opacity = String(this.amount);
    },
    clear() {
      this.amount = 0;
      el.style.opacity = '0';
    },
  };
}
