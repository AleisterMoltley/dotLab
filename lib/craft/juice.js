/**
 * NEON INK-style combat juice: time scale + shake + callouts.
 * Keep alloc out of the hot path — mutate fields only.
 */
export class TimeJuice {
  constructor() {
    this.scale = 1;
    this._target = 1;
    this._hold = 0;
  }

  hit(slow = 0.55, duration = 0.04) {
    this._target = Math.max(0.35, slow);
    this._hold = Math.min(0.12, duration);
  }

  body() {
    this.hit(0.72, 0.035);
  }

  kill() {
    this.hit(0.4, 0.075);
  }

  /** @returns scaled dt multiplier */
  update(dt) {
    if (this._hold > 0) {
      this._hold -= dt;
      this.scale += (this._target - this.scale) * Math.min(1, 30 * dt);
    } else {
      this.scale += (1 - this.scale) * Math.min(1, 12 * dt);
    }
    return Math.max(0.15, this.scale);
  }
}

const CALLOUTS = ['', 'KILL', 'DOUBLE', 'TRIPLE', 'MULTI', 'RAMPAGE'];

export function calloutForStreak(n) {
  if (n <= 0) return '';
  if (n >= 5) return 'RAMPAGE';
  return CALLOUTS[n] || 'RAMPAGE';
}

export function makeShake() {
  return { amount: 0 };
}

export function pulseShake(shake, amount) {
  shake.amount = Math.min(1.4, shake.amount + amount);
}

export function decayShake(shake, dt) {
  shake.amount = Math.max(0, shake.amount - dt * 4);
  return shake.amount;
}
