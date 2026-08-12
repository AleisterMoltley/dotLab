/**
 * Stamp a 2D bake onto a Three.js mesh (nearest-neighbor, sRGB).
 * Import only from Vite + three games.
 */
import * as THREE from 'three';

export function canvasTexture(canvas) {
  const t = new THREE.CanvasTexture(canvas);
  t.magFilter = THREE.NearestFilter;
  t.minFilter = THREE.NearestFilter;
  t.generateMipmaps = false;
  t.colorSpace = THREE.SRGBColorSpace;
  t.needsUpdate = true;
  return t;
}

/** 1 world-unit quad, pixel sprite facing camera-ish (XY plane, Y-up). */
export function spriteMesh(canvas, pixelsPerUnit = 16) {
  const w = canvas.width / pixelsPerUnit;
  const h = canvas.height / pixelsPerUnit;
  const geo = new THREE.PlaneGeometry(w, h);
  const mat = new THREE.MeshBasicMaterial({
    map: canvasTexture(canvas),
    transparent: true,
    alphaTest: 0.1,
    depthWrite: false,
  });
  const mesh = new THREE.Mesh(geo, mat);
  mesh.position.y = h * 0.5;
  return mesh;
}

export function markCanvasDirty(mesh) {
  const map = mesh?.material?.map;
  if (map) map.needsUpdate = true;
}
