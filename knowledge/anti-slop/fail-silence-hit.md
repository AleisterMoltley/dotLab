# FAIL: silence on hit

```js
function onHit(e) {
  e.hp -= 10;
  // no hitstop, no shake, no sfx, no hitmarker
}
```

**Why:** combat without feedback is not a game feel.  
**PASS:** TimeJuice hitstop → shake → sfx.blip/hit → hitmarker → callout.
