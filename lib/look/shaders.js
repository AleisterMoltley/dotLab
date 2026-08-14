import * as THREE from 'three';

/** One hero shader per card. Locked GLSL — the model only picks the id. */
export function makeAccent(kind, pal) {
  if (kind === 'grid') return gridFloor(pal);
  if (kind === 'water') return waterPlane(pal);
  if (kind === 'heat') return heatPlane(pal);
  if (kind === 'rain') return rainSheet(pal);
  if (kind === 'toon') return toonGround(pal);
  return gridFloor(pal);
}

function gridFloor(pal) {
  const mat = new THREE.ShaderMaterial({
    transparent: true,
    depthWrite: false,
    uniforms: {
      uTime: { value: 0 },
      uColor: { value: new THREE.Color(pal.grid || 0x00f0ff) },
    },
    vertexShader: `
      varying vec2 vUv;
      void main() {
        vUv = uv;
        gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
      }
    `,
    fragmentShader: `
      uniform float uTime;
      uniform vec3 uColor;
      varying vec2 vUv;
      void main() {
        vec2 gv = abs(fract(vUv * 24.0) - 0.5);
        float line = smoothstep(0.46, 0.5, max(gv.x, gv.y));
        float pulse = 0.35 + 0.25 * sin(uTime * 1.4);
        gl_FragColor = vec4(uColor, line * pulse);
      }
    `,
  });
  const mesh = new THREE.Mesh(new THREE.PlaneGeometry(40, 40), mat);
  mesh.rotation.x = -Math.PI / 2;
  mesh.position.y = 0.03;
  return { mesh, tick(dt) { mat.uniforms.uTime.value += dt; } };
}

function waterPlane(pal) {
  const mat = new THREE.ShaderMaterial({
    transparent: true,
    uniforms: {
      uTime: { value: 0 },
      uColor: { value: new THREE.Color(pal.grid || 0x306090) },
    },
    vertexShader: `
      varying vec2 vUv;
      void main() {
        vUv = uv;
        gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
      }
    `,
    fragmentShader: `
      uniform float uTime;
      uniform vec3 uColor;
      varying vec2 vUv;
      void main() {
        float w = sin(vUv.x * 18.0 + uTime) * 0.5 + sin(vUv.y * 14.0 - uTime * 0.8) * 0.5;
        gl_FragColor = vec4(uColor * (0.55 + 0.25 * w), 0.55);
      }
    `,
  });
  const mesh = new THREE.Mesh(new THREE.PlaneGeometry(28, 18), mat);
  mesh.rotation.x = -Math.PI / 2;
  mesh.position.set(0, 0.02, -8);
  return { mesh, tick(dt) { mat.uniforms.uTime.value += dt; } };
}

function heatPlane(pal) {
  const mat = new THREE.ShaderMaterial({
    transparent: true,
    depthWrite: false,
    uniforms: {
      uTime: { value: 0 },
      uColor: { value: new THREE.Color(pal.sun || 0xffc070) },
    },
    vertexShader: `
      varying vec2 vUv;
      void main() {
        vUv = uv;
        gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
      }
    `,
    fragmentShader: `
      uniform float uTime;
      uniform vec3 uColor;
      varying vec2 vUv;
      void main() {
        float h = sin(vUv.x * 30.0 + uTime * 3.0) * 0.04;
        gl_FragColor = vec4(uColor, 0.12 + abs(h));
      }
    `,
  });
  const mesh = new THREE.Mesh(new THREE.PlaneGeometry(36, 20), mat);
  mesh.position.set(0, 4, -12);
  return { mesh, tick(dt) { mat.uniforms.uTime.value += dt; } };
}

function rainSheet(pal) {
  const mat = new THREE.ShaderMaterial({
    transparent: true,
    depthWrite: false,
    uniforms: {
      uTime: { value: 0 },
      uColor: { value: new THREE.Color(pal.grid || 0x88a0c0) },
    },
    vertexShader: `
      varying vec2 vUv;
      void main() {
        vUv = uv;
        gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
      }
    `,
    fragmentShader: `
      uniform float uTime;
      uniform vec3 uColor;
      varying vec2 vUv;
      float streak(vec2 uv) {
        float x = fract(uv.x * 40.0);
        float y = fract(uv.y * 12.0 - uTime * 2.4);
        return smoothstep(0.92, 1.0, y) * smoothstep(0.08, 0.0, abs(x - 0.5));
      }
      void main() {
        gl_FragColor = vec4(uColor, streak(vUv) * 0.45);
      }
    `,
  });
  const mesh = new THREE.Mesh(new THREE.PlaneGeometry(20, 12), mat);
  mesh.position.set(0, 4, -6);
  return { mesh, tick(dt) { mat.uniforms.uTime.value += dt; } };
}

function toonGround(pal) {
  const mat = new THREE.ShaderMaterial({
    uniforms: {
      uColor: { value: new THREE.Color(pal.ground || 0x3a4a28) },
      uLight: { value: new THREE.Vector3(0.4, 1.0, 0.3).normalize() },
    },
    vertexShader: `
      varying vec3 vN;
      void main() {
        vN = normalize(normalMatrix * normal);
        gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
      }
    `,
    fragmentShader: `
      uniform vec3 uColor;
      uniform vec3 uLight;
      varying vec3 vN;
      void main() {
        float d = max(dot(normalize(vN), uLight), 0.0);
        float band = d > 0.66 ? 1.0 : d > 0.33 ? 0.6 : 0.35;
        gl_FragColor = vec4(uColor * band, 1.0);
      }
    `,
  });
  const mesh = new THREE.Mesh(new THREE.CircleGeometry(18, 24), mat);
  mesh.rotation.x = -Math.PI / 2;
  mesh.position.y = 0.01;
  return { mesh, tick() {} };
}
