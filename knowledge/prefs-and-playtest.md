# Preference Memory + Playwright Playtest

## Prefs
```bash
gamemaster prefs set like "tight jumps"
gamemaster prefs set feel.jump tight
gamemaster prefs set tech.mobile_first true
gamemaster prefs note "Prefer vanilla three over R3F"
gamemaster prefs show
gamemaster prefs from-critic -p ./project   # learn from last critic report
```

Stores:
- Global: `LocalLLM/config/user-prefs.json`
- Project: `<project>/.gamemaster/prefs.json`

Injected automatically into: Studio roles, agent, chat CLI.

## Playtest
```bash
gamemaster playtest -p ./project
gamemaster playtest -p ./project --critic --duration 20
gamemaster studio build -p ./project "…" --playtest
```

Does:
1. `npm run dev` (or static server)
2. Playwright Chromium, phone viewport
3. Injects `window.__GF_PLAYTEST__` harness
4. Simulates jump/wasd/click
5. Screenshots: start / mid / end
6. Writes `.gamemaster/playtest/report.json` + `report.md`
7. Optional Critic LLM + prefs learning

Games can call:
```js
window.__GF_PLAYTEST__?.recordDeath()
window.__GF_PLAYTEST__?.recordRestart()
window.__GF_PLAYTEST__?.recordJump()
```
