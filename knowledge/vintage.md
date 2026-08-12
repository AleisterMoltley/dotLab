# Vintage mode — Game Boy ship bar, GBA ceiling

When the user selects **Vintage**, every slice is a handheld-era game.

## Ship bar (default quality target)
**Original Game Boy / GBC feel** — not “retro filter on a modern game”.

- Internal resolution **160×144** (GB/GBC)
- **≤4 colors** on GB profile (DMG greens or gray)
- Integer scale only (1×, 2×, 3×…) — never blurry upscale
- Square pixels, no bloom / chromatic / modern post
- Snappy feel, low HP, short rooms, readable silhouettes
- Square-wave blips (4-channel vibe), no cinematic audio

## Hard ceiling (never exceed)
**Game Boy Advance** is the maximum when Vintage is on:

| Limit | Cap |
|-------|-----|
| Resolution | **240×160** max |
| On-screen colors | **≤15** unique |
| 3D / Three.js | **Forbidden** |
| Smooth scaling / filters | **Forbidden** |
| Modern FX (bloom, particles HD) | **Forbidden** |
| Open-world streaming | **Forbidden** — single screens / short scrolls |

Profiles inside Vintage:

1. **gb** (default) — DMG 160×144 · 4 colors · best “classic”
2. **gbc** — 160×144 · up to 8 practical colors · mood packs
3. **gba** — 240×160 · ≤15 colors · only if brief needs more room

Host never picks above **gba**. User asking for “4K retro” still gets GBA max.

## Host responsibilities
- `engine: vintage` → `write_vintage_slice`
- Locked palettes from `lib/vintage/palettes.js`
- Verify P0: `vintage_cap` (res, colors, no three, nearest)
- FPS → top-down or side arena (no free-look 3D)

## PASS / FAIL
- PASS: Link’s Awakening density, Kirby feel, tight jump, 4-shade readability  
- FAIL: neon cyber bloom, 60-color rainbow, 3D capsule, 320p+ internal buffer
