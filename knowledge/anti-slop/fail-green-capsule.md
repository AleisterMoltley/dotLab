# FAIL: green capsule on a plane

```js
// SLOP — never ship this
const geo = new THREE.CapsuleGeometry(0.4, 1, 4, 8);
const mat = new THREE.MeshStandardMaterial({ color: 0x22c55e });
scene.add(new THREE.Mesh(geo, mat));
scene.add(new THREE.Mesh(new THREE.PlaneGeometry(40, 40), new THREE.MeshBasicMaterial({ color: 0x444444 })));
```

**Why:** zero place, zero juice, zero identity.  
**PASS:** NEON INK palette, fog=background, craft juice, themed props, fair death.
