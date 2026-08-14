# Combat, AI, juice — the conversation of turns

The player must feel: *I hit them. They almost hit me. I had a turn.*

## Melee / close (TPS, arena, adventure)

```
TELEGRAPH  220ms   pose + flash + sting     (readable, tracks)
ACTIVE      80ms   hurtbox on               (does NOT track)
RECOVER    280ms   vulnerable               (player's turn)
```

Player dodge: 200ms i-frames, 7–9 m/s burst, recover 120ms.
Player attack: same 3-phase. Whiff punish is the skill.

Hit reaction on victim:
- `vel += hitNormal * knockback` (4–7 m/s light, 10–14 heavy)
- hitstop 40ms both sides
- flash + grunt
- optional 200ms spine lean (not full ragdoll)

Death:
- hitstop 90ms → ragdoll enable + impulse 6–10 along shot
- cam linger 0.45s on corpse → restart fade 0.2s
- total death→control < 2.5s unless it's a story death

## Ranged

- Projectile **radius 0.18–0.28** (readable), speed 18–34 m/s
- Pool 32–64. Never `new Mesh` per shot
- Hitscan only if you draw a tracer for 50–80ms
- Spread: first shot tight, grows with fire, recovers
- Recoil is camera pitch + recover spring, not random HUD

## Enemy AI (slice, not a thesis)

```js
// one file, one brain
states: idle | chase | windup | strike | recover | dead
idle:   wait, then if dist < aggro → chase
chase:  walk XZ at player, stop at strikeRange
windup: play clip, face player ONCE at start, start active timer
strike: hurtbox on, no retarget
recover: walk away or idle
```

Groups: max **3** attackers, others circle. More is noise.
Boss: same machine, longer telegraphs, 2 moves max in a slice.

Unfair (do not ship):
- tracking during active frames
- invisible hits
- spawn on top of the player
- 100% accuracy hitscan with no tell

## Juice implementation (do this, not a VFX novel)

Host owns this. Import `punch` from `src/craft/punch.js`. Do not rewrite.

```js
import { punch } from './craft/punch.js';
punch(stack, 'hit');   // TimeJuice.body + shake + sfx + hitmark
punch(stack, 'kill');
punch(stack, 'shoot');
// Windup ring: makeMarkPool.show(lockX, lockZ, id)
// Strike: tickBrain — commit uses lockX/lockZ, does NOT track
```

Legacy sketch (do not paste into game.js):

```js
// src/fx/juice.js — one module the whole game calls
export const juice = {
  freeze: 0, shake: 0, punch: new THREE.Vector3(), fovAdd: 0,
  hit(kind = 'light') {
    const t = kind === 'kill' ? 0.09 : 0.04;
    this.freeze = Math.max(this.freeze, t);
    this.shake = Math.max(this.shake, kind === 'kill' ? 0.18 : 0.1);
    this.punch.set(0, 0.04, 0.12);
    this.fovAdd = kind === 'kill' ? 8 : 4;
    blip(kind); // WebAudio oscillator, 80ms
  },
  apply(cam, baseFov, dt) {
    if (this.freeze > 0) { this.freeze -= dt; return false; } // skip sim
    cam.position.add(this.punch);
    this.punch.multiplyScalar(1 - Math.min(1, 14 * dt));
    this.shake *= 1 - Math.min(1, 8 * dt);
    if (this.shake > 0.002) {
      cam.position.x += (Math.random() - 0.5) * this.shake;
      cam.position.y += (Math.random() - 0.5) * this.shake;
    }
    cam.fov = baseFov + this.fovAdd;
    this.fovAdd += (0 - this.fovAdd) * (1 - Math.exp(-8 * dt));
    cam.updateProjectionMatrix();
    return true;
  },
};
```

Call `juice.hit()` from damage. Apply after camera follow, before render.

## Audio without assets (always)

```js
function blip(kind) {
  const ctx = blip.ctx || (blip.ctx = new AudioContext());
  const o = ctx.createOscillator(), g = ctx.createGain();
  o.type = 'square';
  o.frequency.value = kind === 'kill' ? 180 : kind === 'jump' ? 420 : 260;
  g.gain.value = 0.05;
  g.gain.exponentialRampToValueAtTime(0.0001, ctx.currentTime + 0.09);
  o.connect(g).connect(ctx.destination);
  o.start(); o.stop(ctx.currentTime + 0.1);
}
```

Jump, hit, pickup, death, UI confirm. Five beeps. Then replace with files later.

## Health & honesty

- Player 3 pips > 100 HP bar for a slice
- i-frames 0.5s after a hit, **visible** (blink or rim)
- Enemy HP readable (chunks, not 847/900)
- Chip damage that can't be seen is a bug
