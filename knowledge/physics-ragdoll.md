# Physics & Ragdoll — Three.js games

Pick **one** physics path per project and stick to it.

| Path | Use |
|------|-----|
| **Arcade** | Platformer, runner, twin-stick — capsule + rays, no lib |
| **Rapier** (`@dimforge/rapier3d-compat`) | Worlds, ragdoll, vehicles, crates — default 3D |
| **cannon-es** | Only if project already uses it |

Never mix Rapier + Cannon. Never allocate bodies every frame.

## Fixed step (always)

```js
const STEP = 1 / 60;
let acc = 0;
function tick(dt) {
  acc += Math.min(dt, 0.05);
  while (acc >= STEP) { world.step(); /* or arcade integrate */ acc -= STEP; }
}
```

## Arcade capsule (no lib)

```js
// hoist: _origin _dir _ray _hit
function moveCapsule(pos, vel, dt, solids) {
  vel.y -= CONFIG.gravity * dt;
  // X then Z (slide)
  pos.x += vel.x * dt;
  resolveAxis(pos, vel, 'x', solids);
  pos.z += vel.z * dt;
  resolveAxis(pos, vel, 'z', solids);
  // ground
  _origin.copy(pos).y += 0.9;
  _ray.set(_origin, _dir.set(0, -1, 0));
  const hit = _ray.intersectObjects(solids, true)[0];
  const grounded = hit && hit.distance <= 0.95;
  if (grounded) { pos.y = hit.point.y + 0.9; if (vel.y < 0) vel.y = 0; }
  else pos.y += vel.y * dt;
  return grounded;
}
```

Feel: `gravity 22–28`, `jumpForce 7.5–9`, `coyoteMs 80–120`, `jumpBufferMs 80–100`.  
Walls: ray at chest height in move dir, slide along `hit.normal`.

## Rapier boot

```js
import RAPIER from '@dimforge/rapier3d-compat';
await RAPIER.init();
const world = new RAPIER.World({ x: 0, y: -9.81, z: 0 });
world.timestep = 1 / 60;

const body = world.createRigidBody(
  RAPIER.RigidBodyDesc.dynamic().setTranslation(0, 2, 0).setCanSleep(true)
);
world.createCollider(RAPIER.ColliderDesc.capsule(0.5, 0.35).setFriction(0.8), body);

// static trimesh from THREE BufferGeometry
const verts = new Float32Array(geo.attributes.position.array);
const idx = new Uint32Array(geo.index.array);
const tbody = world.createRigidBody(RAPIER.RigidBodyDesc.fixed());
world.createCollider(RAPIER.ColliderDesc.trimesh(verts, idx), tbody);

// sync
const t = body.translation();
mesh.position.set(t.x, t.y, t.z);
const r = body.rotation();
mesh.quaternion.set(r.x, r.y, r.z, r.w);
```

Character: `KinematicPositionBased` capsule + `world.castShape` or character controller (`world.createCharacterController(0.01)`).

## Ragdoll (skinned GLTF)

Recipe:
1. Load GLTF, keep `SkeletonUtils.clone` per instance.
2. Map bones → Rapier bodies (capsule/box) at bind pose.
3. Connect with `Revolute` / `Spherical` joints, limited angles.
4. **Alive:** animation mixer drives bones; ragdoll bodies kinematic, following bones.
5. **Dead / hit:** set bodies dynamic, copy current bone world matrices → body poses, stop mixer (or fade).
6. Each frame ragdoll-active: write body transforms back onto bones (`bone.matrixWorld` or position/quat in bind space).

Bone groups (minimum 11): hips, spine, head, upper/lower arm L/R, upper/lower leg L/R.  
Skip fingers. Head = sphere. Limbs = capsules along bone.

```js
// activate
function enableRagdoll(puppet) {
  puppet.mixer.stopAllAction();
  puppet.alive = false;
  for (const p of puppet.parts) {
    p.body.setBodyType(RAPIER.RigidBodyType.Dynamic, true);
    p.body.setLinvel(puppet.impact.clone().multiplyScalar(4), true);
  }
}
```

Hit react (not full death): 200–400ms partial ragdoll on spine + arms, then blend back to anim with `slerp`.

## Vehicles (arcade)

- Raycast suspension 4 corners, spring+damper, accel along facing, steer front, grip lerp.
- Camera chase + look-ahead. Do not start with a full sim.

## Cloth / soft (cheap)

- Flag: grid of verts + verlet constraints, pin top row, collide vs ground Y.
- Or shader-only wind on a plane (`u_time` vertex offset). Prefer shader unless gameplay needs collision.

## Projectiles

Pool. Rapier: kinematic ball, `world.castRay` for hits. Arcade: integrate + sphere vs AABB.

## Debug

Draw colliders as wire `THREE.CapsuleGeometry` / box helpers behind a `CONFIG.debugPhysics` flag. Never ship without being able to toggle this.

## Perf
- Sleeping bodies on. CCD only on fast bullets.
- Don't trimesh-dynamic vs trimesh-dynamic. Dynamics = primitives.
- Seeker: Rapier ok if < 80 dynamic bodies; else arcade.
