import * as THREE from 'three';

const CONFIG = { moveSpeed: 6.2, gravity: 24, jumpForce: 8.2, coyoteMs: 100, camLag: 8 };

const scene = new THREE.Scene();
scene.background = new THREE.Color(0x87a0b8);
const camera = new THREE.PerspectiveCamera(58, 1, 0.1, 200);
const renderer = new THREE.WebGLRenderer({ antialias: true });
renderer.outputColorSpace = THREE.SRGBColorSpace;
document.body.appendChild(renderer.domElement);

const sun = new THREE.DirectionalLight(0xfff1d0, 1.2);
scene.add(sun, new THREE.HemisphereLight(0xcfe8ff, 0x3a2a18, 0.5));

function frame() {
  renderer.render(scene, camera);
  requestAnimationFrame(frame);
}
requestAnimationFrame(frame);
window.__GF_PLAYTEST__ = { recordDeath() {}, recordRestart() {}, recordJump() {} };
