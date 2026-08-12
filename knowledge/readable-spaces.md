# Readable spaces — first rooms, landmarks, camera, light

A world the player cannot read is not content. It is fog.

## Scale (put a door in every scene)

| Thing | Size |
|-------|------|
| Eye / cam look-at | 1.5–1.7 m |
| Door | 1.0 × 2.1 |
| Crate | 0.8–1.1 |
| NPC | ~1.7 |
| Tree | 8–14 |
| Street | 4–6 wide |
| Landmark | readable at 40–80 m |

If the player looks like an ant or a giant, **the numbers are wrong**, not the art.

## Light recipe that always reads

```js
scene.background = new THREE.Color(0x8aa3b5); // pick a mood, then...
scene.fog = new THREE.FogExp2(scene.background.getHex(), 0.014);
hemi = HemisphereLight(sky 0xcfe8ff, ground 0x3a2a18, 0.5)
sun  = DirectionalLight(0xfff1d0, 1.25)  // slightly warm
sun.position.set(35, 55, 18)
// 1 shadow, map 1024, ortho bounds tight around play space
```

Night: hemi 0.15, moon cool dir 0.4, **emissive windows** so silhouette lives.
Interactables: emissive 0x222 or a pulsing point light r < 2.

## Color story (lock 8 hex, reuse)

```
bg/fog     #8aa3b5
ground     #3d4a3a
safe       #6ee7b7
threat     #e85d4c
gold/item  #f0c14b
npc        #f3d2b3
shadow     #1a1c22
ui         #e8eaef
```

Threats never share the safe/item hue. Color-blind: shape + motion, not hue only.

## Landmark rule

Every region has **one** thing you can steer by: a tower, a red tree, a cliff tooth, a neon sign.
If the player turns 180° they should still know which way they came.

## First 30 seconds of space

1. Spawn looking at the verb (gap to jump, NPC to talk, lane to run) — not a wall
2. A pickup or bark within 8 seconds
3. The first threat is **alone** and **telegraphed**
4. A hard edge (fence, cliff, fog wall) so they cannot wander into emptiness
5. Restart returns them to the same shot, not a loading screen

## Camera as narrator

- Nudge yaw 8–12° toward the next goal when the player idles 2.5s
- Dialogue: lerp to a talking shot (3-quarter, both faces), lock move, restore
- Death: hold, then snap. Don't cut mid-ragdoll on frame 1
- Interior: pull cam in (dist 3.2), raise FOV slightly so walls don't eat the hero

## Stealth / horror spaces

Light **is** the mechanic. Darkness hides, but the player needs a readable safe blob.
Audio stingers on suspicion ticks. Never a jumpscare as the first beat.

## Open world without getting lost

- 2 biomes max in a slice, **hard color change** at the seam
- Paths 20% lighter than off-path
- One NPC who **points** (dialogue + a world marker)
- Climb/obstacle that frames the second biome as a reveal (camera up, then down)

## Props

Instanced scatter is background. **Unique** meshes are nouns (the well, the cart, the shrine).
Raycast interact only against nouns, not every pine needle.
