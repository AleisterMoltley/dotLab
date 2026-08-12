# Asset core — engine-ready without being asked

Apply even when the user only said "a slime" or "a grass tile".

| Ask | Deliver |
|-----|---------|
| Sprite / character | Isolated, flat keyable bg, clean silhouette, **no** baked ground or cast shadow |
| Animation | A **looping sequence**, not one pose. Same feet plant / cell origin every frame |
| Sheet | Implicit grid, **no** divider lines, subject locked in the cell |
| Ground / water / wall | Seamless. No landmark motif. Lighting non-directional if it may rotate |
| UI panel / button | 9-slice safe (ornament in corners, even edges). **No text** |
| Same character again | Edit the existing base — never a new roll |
| Icon set | One contract: stroke, fill, padding, palette, weight. Must read at 32px |

Names: `player-idle.png`, `player-run-1.png`… Manifest in `art/README.md` if you invent counts.

Palette: lock 8 hex in WIKI.md and reuse.

Preview every new image in `art-test.html` (`kit art_test`).
