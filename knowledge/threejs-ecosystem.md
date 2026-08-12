# Three.js Developer Sphere (2025–2026) — Gamemaster MUST master

## Core (always)
- three r160–r185+ : WebGLRenderer, ColorManagement, SRGB, ACES
- addons: controls, loaders (GLTF/DRACO/KTX2), postprocessing, utils
- docs: threejs.org/docs · manual · examples
- discourse.threejs.org patterns

## Creative coding / shaders (FragCoord class)
- Fullscreen fragment shaders, multipass FBO
- Shadertoy ports, Book of Shaders concepts
- TSL + WebGPURenderer path
- glslify-style modular thinking (even without glslify)
- Tools peers: FragCoord.xyz, Shadertoy, GLSL Sandbox, TWGL, The Book of Shaders editor

## Scene / product frameworks
| Lib | Use when |
|-----|----------|
| **vanilla three + Vite** | Games, max control, Seeker web |
| **@react-three/fiber (R3F)** | React apps, dashboards, product viz |
| **@react-three/drei** | helpers: controls, env, text, staging |
| **@react-three/postprocessing** | pretty FX in R3F |
| **theatre.js / leva** | design tooling / tweaks |
| **rapier / cannon-es / physics** | games |
| **three-stdlib** | community helpers |
| **troika-three-text** | high quality text |
| **meshopt / DRACO / KTX2 / Basis** | asset pipelines |
| **three-gpu-pathtracer** | offline-quality lighting experiments |
| **lensflare, water, sky examples** | classic demos |

## Rendering techniques to own
- PBR (MeshStandardMaterial / MeshPhysicalMaterial), IBL Environment
- Shadow maps, CSM ideas, contact shadows (drei)
- Instancing, batched meshes, LODs
- Morph targets, skinning, AnimationMixer
- GPU picking, raycasting
- Portals / RenderTarget portals
- Decals, outline passes
- SSR/SSAO approximations, bloom, DOF, godrays
- Custom depth materials, clipping planes

## Animation & interaction
- GSAP + three
- Scroll-driven scenes (scroll → camera)
- Pointer / gesture, XR (WebXR)
- Audio-reactive (AnalyserNode)

## Tooling workflow
- Vite + HMR
- gltfjsx for R3F
- Blender → glTF export checklist
- Spector.js / WebGL insight for debugging
- Lil-gui / leva for params

## Game-specific three patterns
- Fixed/variable timestep
- Object pools
- Spatial hash / simple octree
- Navmesh lite or waypoint AI
- Billboard sprites, particle systems (custom + points)

## Mobile / Seeker
- pixelRatio cap, shadow off, fewer lights
- compressed textures, smaller FBOs for multipass
- pause on visibilitychange

## Export / ship
- Single-file HTML demos for shaders
- Vite SPA for games
- Expo/RN for Seeker native (wallet) + WebView/GL for shaders if needed

## When asked for "modern three.js stack 2026"
Prefer: Vite + three latest + (optional) WebGPU/TSL for new creative, WebGL2 for max compatibility, R3F only if React already in project.
