# Wiki

- Engine is Three.js (Vite). World from WorldClaw `Compose(T, O)`. **Why:** paper Eq. 2.
- Terrain vertex colors come from `I_layout` + region materials. **Why:** semantic layout is the shared partition.
- Press 1 RGB / 2 instance masks. **Why:** paper diagnostic channels, local.
- Generate: `gamemaster worldclaw generate -p . "prompt"` (`--offline` if no Ollama).
