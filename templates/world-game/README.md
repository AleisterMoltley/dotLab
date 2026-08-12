# WorldClaw World (Gamemaster)

Local Three.js port of Tencent Hunyuan WorldClaw (arXiv:2608.05248):

`P = F_plan(q)` → `T = F_terrain(P)` → `O = F_region(P, T)` → `S = Compose(T, O)`

```bash
gamemaster worldclaw generate -p . "medieval village with snow mountains and desert"
# no Ollama: add --offline (heuristic plan)

npm install
npm run dev
```

Walk: WASD + click to look. `1` appearance · `2` instance masks.

Assets in `public/world/` — regional objects are separately editable; scatter is instanced.
