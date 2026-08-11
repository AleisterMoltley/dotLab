# Shaders: GLSL · Shadertoy · Multipass · TSL · WebGPU (MAX)

## Fullscreen triangle/quad (Three.js)
```js
import * as THREE from 'three';
const cam = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);
const scene = new THREE.Scene();
const geo = new THREE.PlaneGeometry(2, 2);
const mat = new THREE.ShaderMaterial({
  uniforms: {
    u_time: { value: 0 },
    u_resolution: { value: new THREE.Vector2(1, 1) },
    u_mouse: { value: new THREE.Vector4() },
  },
  vertexShader: /* glsl */`
    varying vec2 vUv;
    void main() {
      vUv = uv;
      gl_Position = vec4(position.xy, 0.0, 1.0);
    }`,
  fragmentShader: /* glsl */`
    precision highp float;
    uniform float u_time;
    uniform vec2 u_resolution;
    varying vec2 vUv;
    void main() {
      vec2 uv = gl_FragCoord.xy / u_resolution.xy;
      gl_FragColor = vec4(uv, 0.5 + 0.5*sin(u_time), 1.0);
    }`,
});
scene.add(new THREE.Mesh(geo, mat));
```

## GLSL ES 300 (WebGL2) fragment shell
```glsl
#version 300 es
precision highp float;
out vec4 fragColor;
uniform float u_time;
uniform vec2 u_resolution;
void main() {
  vec2 uv = gl_FragCoord.xy / u_resolution;
  fragColor = vec4(uv, 0.5, 1.0);
}
```

## Shadertoy wrapper
```glsl
// paste Shadertoy body as mainImage, then:
void main() {
  vec4 col;
  mainImage(col, gl_FragCoord.xy);
  gl_FragColor = col; // or fragColor in 300 es
}
// replace iTime→u_time, iResolution.xy→u_resolution, iMouse→u_mouse
```

## Classic techniques checklist
- UV / aspect-correct: `uv.x *= resolution.x/resolution.y`
- Palette: Inigo Quilez cos palettes
- Noise: value, perlin-ish, simplex, fbm, domain warp
- SDF 2D/3D + soft min
- Raymarching: scene SDF, normals via tetrahedron, soft shadows, AO
- Fresnel, refraction, chromatic aberration
- Feedback / trail buffers
- Reaction-diffusion (multipass)
- Water/height FFT (advanced)
- Volumetric raymarch (fog, clouds)
- Path-tracer lite (accumulate frames)

## Multipass FBO (ping-pong)
```js
function makeTarget(w, h) {
  return new THREE.WebGLRenderTarget(w, h, {
    minFilter: THREE.LinearFilter,
    magFilter: THREE.LinearFilter,
    type: THREE.HalfFloatType, // or UnsignedByteType
    depthBuffer: false,
    stencilBuffer: false,
  });
}
// each pass: set material.uniforms.u_buffer_a = prev.texture; renderer.setRenderTarget(next); renderer.render(scene, cam);
// final: renderer.setRenderTarget(null); imagePass
```

## Audio texture (FragCoord-style)
```js
const analyser = audioCtx.createAnalyser();
analyser.fftSize = 1024;
const data = new Uint8Array(analyser.frequencyBinCount);
// pack into DataTexture 512x2: row0 FFT, row1 waveform
analyser.getByteFrequencyData(freq);
analyser.getByteTimeDomainData(wave);
```

## Keyboard texture 256×3
- row 0: held
- row 1: pressed this frame
- row 2: toggle
Update DataTexture each frame from keydown/keyup maps.

## TSL (Three.js Shading Language) — modern
```js
import { Fn, uv, time, sin, float, vec3, vec4 } from 'three/tsl';
import { MeshBasicNodeMaterial } from 'three/webgpu';
const material = new MeshBasicNodeMaterial();
material.colorNode = Fn(() => {
  const u = uv();
  return vec4(u, sin(time).mul(0.5).add(0.5), 1.0);
})();
// Requires WebGPURenderer when using webgpu path
```

## WebGPURenderer sketch
```js
import { WebGPURenderer } from 'three/webgpu';
const renderer = new WebGPURenderer({ antialias: true });
await renderer.init();
```

## Postprocessing (games + creative)
- EffectComposer: RenderPass, UnrealBloomPass, FilmPass, SMAA
- Or `postprocessing` npm (pmndrs) with R3F
- Custom ShaderPass for screen FX

## R3F + drei (ecosystem defaults)
```jsx
import { Canvas } from '@react-three/fiber'
import { OrbitControls, Environment, useTexture, MeshTransmissionMaterial } from '@drei'
```
Use when user wants React; pure three for jams/FragCoord-style labs.

## Debug shaders
- Show normals / UV / depth as colors
- Step through raymarch with false color
- Clamp HDR for display `col / (1.0 + col)` or ACES approx

## Performance
- Avoid dependent texture reads in loops when possible
- Cap raymarch steps; early exit
- Half float buffers
- On mobile/Seeker: lower res render then upscale
