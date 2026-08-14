import * as THREE from 'three';
import { SCALE } from '../craft/scale.js';

function cloth(color, extra) {
  return new THREE.MeshStandardMaterial(Object.assign({
    color,
    roughness: 0.5,
    metalness: 0.18,
  }, extra || {}));
}

/**
 * Designed player. Feet at y=0. Metres. Not a lone capsule.
 */
export function makePlayer(scene, pal, { kind = 'visor' } = {}) {
  const root = new THREE.Group();
  const accent = pal.grid || 0x00f0ff;
  const skin = pal.player || 0xff2bd6;
  const slim = kind === 'runner';

  const torso = new THREE.Mesh(
    new THREE.CapsuleGeometry(slim ? 0.24 : 0.28, slim ? 0.48 : 0.55, 4, 8),
    cloth(skin, { emissive: skin, emissiveIntensity: 0.16 }),
  );
  torso.position.y = slim ? 0.86 : 0.92;
  torso.castShadow = true;

  const head = new THREE.Mesh(
    new THREE.SphereGeometry(slim ? 0.16 : 0.18, 8, 6),
    cloth(skin, { roughness: 0.35 }),
  );
  head.position.y = slim ? 1.38 : 1.48;
  head.castShadow = true;

  const visor = new THREE.Mesh(
    new THREE.BoxGeometry(0.22, 0.07, 0.05),
    new THREE.MeshBasicMaterial({ color: accent, toneMapped: false }),
  );
  visor.position.set(0, head.position.y, 0.15);

  const padL = new THREE.Mesh(
    new THREE.BoxGeometry(0.12, 0.1, 0.16),
    cloth(0x1a1228, { metalness: 0.4 }),
  );
  padL.position.set(-0.3, torso.position.y + 0.18, 0);
  const padR = padL.clone();
  padR.position.x = 0.3;

  root.add(torso, head, visor, padL, padR);
  root.position.set(0, 0, 6);
  scene.add(root);
  return {
    mesh: root,
    torso,
    head,
    visor,
    kind,
    height: SCALE.eye,
  };
}
