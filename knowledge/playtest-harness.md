# Playtest Harness (inject into games)

## Minimal in-game overlay
```js
// src/playtest.js — press P to dump metrics
export function createPlaytest() {
  const m = {
    deaths: 0,
    starts: 1,
    timeAlive: 0,
    firstDeathAt: null,
    runs: 0,
  };
  let alive = 0;
  return {
    tick(dt, playerAlive) {
      if (playerAlive) alive += dt;
      else if (alive > 0) {
        m.timeAlive += alive;
        if (m.firstDeathAt == null) m.firstDeathAt = performance.now() / 1000;
        m.deaths++;
        alive = 0;
      }
    },
    onRestart() { m.runs++; },
    dump() {
      console.table(m);
      return m;
    },
  };
}
```

## Rubric scores (Critic / human)
| Score | Question |
|-------|----------|
| Controls | Understood <10s? |
| Fairness | First death felt fair? |
| Juice | Feedback on hit/jump/score? |
| Clarity | Next goal obvious? |
| Hook | One more run? |

## Studio Critic maps findings → coder fix pass automatically.
