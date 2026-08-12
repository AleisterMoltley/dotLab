# Dialogue & Narrative — Three.js games

Dialogue is a **system**, not `alert()`. It lives in data, drives flags, and has a visible UI.

## Data (JSON, English keys)

```js
export const LINES = {
  innkeeper_intro: {
    speaker: 'Mira',
    text: 'Storm’s coming. You still heading up the pass?',
    portrait: 'mira',
    tags: ['inn'],
    choices: [
      { text: 'I need a room.', next: 'innkeeper_room', set: { has_room: true } },
      { text: 'What pass?', next: 'innkeeper_pass' },
      { text: 'Not now.', next: null },
    ],
  },
  innkeeper_pass: {
    speaker: 'Mira',
    text: 'Old quarry road. Wolves after dark.',
    choices: [{ text: 'Thanks.', next: null, set: { heard_wolves: true } }],
  },
};
```

Runtime:

```js
export function startDialogue(id, state, ui) {
  const node = LINES[id];
  if (!node) return;
  state.dialogue = id;
  ui.show(node);
}
export function choose(index, state, ui) {
  const node = LINES[state.dialogue];
  const c = node.choices[index];
  if (c.set) Object.assign(state.flags, c.set);
  if (!c.next) { state.dialogue = null; ui.hide(); return; }
  startDialogue(c.next, state, ui);
}
```

## UI (HTML overlay — best for text)

```html
<div id="dlg" hidden>
  <div class="who"></div>
  <p class="line"></p>
  <div class="choices"></div>
</div>
```

- Typewriter 18–28 ms/char, skip on click / Space / tap.
- Choices: 1–4, keyboard 1–4 + click, touch ≥44px.
- Pause player move while `state.dialogue`.
- Portrait optional (2D img or CSS). World-space `CSS2DObject` only for barks.

## Barks (combat / world)

Short lines, no choices, 1.4s fade. Cooldown per NPC.  
Examples: "Hey!", "Over here!", "I'm hit!". Pool 3 variants to avoid repetition.

```js
function bark(npc, text) {
  if (now < npc.nextBark) return;
  npc.nextBark = now + 4;
  showWorldLabel(npc.object, text, 1.4);
}
```

## Quests = flags + world reactions

```js
state.flags = { heard_wolves: false, wolf_dead: false, mira_reward: false };
// after kill
state.flags.wolf_dead = true;
// innkeeper node gate
if (state.flags.wolf_dead && !state.flags.mira_reward) startDialogue('mira_thanks');
```

World reacts: remove blocker mesh, open door, change NPC clip `Idle` → `Cheer`, spawn pickup.

## Ink-like features you actually need
- `set` / `unset` flags
- `if` on choices (`when: 'has_room'`)
- speaker + optional voice id
- `once: true` nodes
- locale table later (`en` / `de`) — keep keys stable

Skip a full Ink compiler unless the user asks.

## Triggering in 3D
- Proximity (`distanceTo(player) < 2.2`) + prompt "E / Tap"
- Look-at cone (dot > 0.65) so you don't talk through walls
- Cutscene: lerp camera to talking shot, lock input, restore

## Writing rules (Director + Coder)
- 1 NPC in a vertical slice, 6–12 lines max
- Subtext > lore dump
- Every conversation changes a flag or gives an item / direction
- Death / restart must not soft-lock; persist flags in `localStorage` only after a checkpoint

## Seeker
- Full-width choice buttons, thumb zone bottom
- No hover-only. Large type (16–18px).
- Don't block wallet connect behind dialogue.

## Anti-patterns
- Hardcoded `if (npc === 1) text = "..."` in the render loop
- Unskippable long crawl
- Quest without a world tell (marker, bark, or door)
