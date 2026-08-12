import { loadTerrain } from './terrain.js';
import { loadInstances } from './instances.js';

/** Assemble terrain + instances into one scene. */
export async function composeWorld(scene) {
  const terrain = await loadTerrain(scene);
  const { group, instances } = await loadInstances(scene, terrain);
  return { terrain, instances, instanceGroup: group };
}
