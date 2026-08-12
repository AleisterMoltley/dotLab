import { loadTerrain } from './terrain.js';
import { loadInstances } from './instances.js';

/** Compose(T, O) — WorldClaw final world assembly (paper Eq. 2). */
export async function composeWorld(scene) {
  const terrain = await loadTerrain(scene);
  const { group, instances } = await loadInstances(scene, terrain);
  return { terrain, instances, instanceGroup: group };
}
