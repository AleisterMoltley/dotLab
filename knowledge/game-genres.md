# Game Genres — Universal Patterns (MAX)

For **every** genre: Core Loop → Feel → Systems → Vertical Slice in <1 Session.

## 1. Action / Arena Shooter
- Loop: spawn → fight → upgrade → next wave
- Systems: projectile pool, hitbox, i-frames, knockback, screen shake
- Feel: aim assist light, hit stop 30–50ms, juice on kill

## 2. Platformer
- Loop: run → jump → hazard → checkpoint
- Feel: coyote time 80–120ms, jump buffer 80–100ms, variable jump height
- Systems: tile collision, moving platforms, one-way, camera lerp

## 3. Third-Person Adventure / Open World
- Loop: explore → interact → combat/puzzle → story beat
- Systems: follow cam, interact prompts, inventory, quest flags, heightfield, NPCs
- World: 2+ biomes, 1 landmark per region, WorldClaw when generated
- Seeker: large interact button, simplified camera orbit

## 4. FPS
- Loop: move → aim → shoot → reload → objective
- Systems: pointer lock (web), touch aim zones (mobile), weapon sway, recoil recovery
- Mobile: virtual stick + fire button, gyro optional

## 5. Racing / Driving
- Loop: accelerate → corner → checkpoint → lap
- Arcade physics: grip lerp, speed-based steer, boost pads
- Camera: chase + look-ahead

## 6. Endless Runner
- Loop: dodge → collect → speed ramp → death → restart
- Systems: object recycle pool, difficulty curve, magnet powerup
- Perfect for Seeker one-thumb

## 7. Tower Defense
- Loop: place → wave → earn → upgrade
- Systems: path following, tower targeting, grid snap
- UI-heavy: big place buttons on mobile

## 8. Strategy / RTS lite
- Loop: gather → build → army → fight
- Mobile: tap select, radial menu; avoid 200-unit micro

## 9. RPG / Loot
- Loop: quest → fight → loot → equip → progress
- Systems: stats, inventory grid, dialogue tree, save slots
- On-chain: optional NFT gear

## 10. Card / Deckbuilder
- Loop: draw → play → resolve → reward
- Systems: deck, discard, hand limit, status effects
- Seeker: full-screen cards, swipe

## 11. Puzzle
- Loop: present → experiment → solve → next
- Juice: perfect snap, undo, hint after N fails

## 12. Idle / Incremental
- Loop: tap/auto → upgrade → prestige
- Offline progress formula; claim button (great for Solana rewards)

## 13. Sports / Physics toys
- Simplified arcade rules > sim realism
- Replay 3s on score

## 14. Horror / Stealth
- Limited light, sound cues, stamina, AI suspicion meter
- Mobile: careful haptics, not jump-scare spam

## 15. Sandbox / Creative
- Tool radial, place/destroy, save schematics
- Performance: chunk/streaming

## 16. Multiplayer (local / online)
- Start: local split or async leaderboard before full netcode
- Netcode later: client pred + server reconcile or lockstep for deterministic

## 17. Rhythm
- Note highway, timing windows, combo multiplier
- Audio clock as source of truth

## 18. Simulation / City / Tycoon
- Tick economy every N seconds, happiness metrics
- UI first; 3D second

## Vertical Slice Template (any genre)
1. One playable character/action
2. One challenge
3. One reward feedback (VFX/SFX/score)
4. Fail + restart < 3 seconds
5. Config object for all feel numbers

## Feel knobs (always expose in CONFIG)
```js
const CONFIG = {
  moveSpeed: 6,
  accel: 40,
  friction: 28,
  jumpForce: 8,
  coyoteMs: 100,
  jumpBufferMs: 90,
  gravity: 22,
  camLag: 8,
};
```

## Genre picker heuristic
- 5 min session mobile → Runner, Idle, Card, Puzzle
- Deep session → RPG, Adventure, Strategy
- Spectator fun → Arena, Racing, Sports
- Crypto-native → Idle claim, NFT collectible, wager arena
