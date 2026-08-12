# Open world

Prompt → regions → height field → editable instances. Walk it in the browser.

```bash
gamemaster worlds generate -p . "medieval village with snow mountains and desert"
# no LLM: add --offline

npm install
npm run dev
```

WASD + click to look. `1` appearance · `2` instance colors.

Generated files live in `public/world/`. Regional objects are unique meshes; scatter is instanced.
