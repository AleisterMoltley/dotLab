# Multipass shader lab

Browser GLSL editor: write, debug, multi-pass preview, import Shadertoy, share.

## Core product surface
| Feature | Gamemaster capability |
|---------|----------------------|
| Live fragment preview | `scaffold shader-lab` + ShaderMaterial full-screen quad |
| Monaco-class editing | textarea/Monaco optional; always emit clean GLSL |
| Compile errors with line map | parse WebGL getShaderInfoLog, show line |
| Built-in uniforms | u_time, u_time_delta, u_frame, u_resolution, u_mouse, u_drag, u_scroll, u_date, u_camera_*, u_audio, u_keyboard, u_webcam |
| Custom uniforms + tuners | UI sliders from `uniform float x; // 0.0-1.0` comments |
| Multi-pass | Common + BufferA/B/C/D + Image (ping-pong FBOs) |
| Buffer types | 2D, 1D line, cubemap, 3D volume (WebGL2 where possible) |
| MRT | EXT_draw_buffers / WebGL2 drawBuffers |
| Shadertoy import | map iTime→u_time, iResolution→u_resolution, iMouse→u_mouse, iChannel0-3→textures, mainImage wrapper |
| Language convert | GLSL ↔ WGSL (via concepts/TSL), HLSL/MSL/Slang awareness |
| WebGPU path | WebGPURenderer + TSL nodes when user asks modern stack |
| Audio input | AnalyserNode → 512×N texture (FFT + waveform) like u_audio |
| Keyboard texture | 256×3 held/press/toggle |
| Webcam / video texture | getUserMedia → VideoTexture |
| Camera 3D (WASD + look) | u_camera_pos/dir/view for raymarch scenes |
| Explore/gallery | not cloud social — generate showcase HTML + export stills |
| Fork/share | export single-file HTML / gist-ready |
| Tutorials | emit step-by-step GLSL lessons |
| Pro compute passes | WGSL compute via WebGPU when requested |

## Canonical built-in uniforms (FragCoord-compatible)
```glsl
uniform float u_time;        // seconds
uniform float u_time_delta;  // frame delta
uniform int   u_frame;
uniform vec2  u_resolution;  // pixels
uniform vec4  u_mouse;       // xy pos, zw click (neg if up)
uniform vec2  u_drag;
uniform float u_scroll;
uniform vec4  u_date;        // y, m, d, seconds-of-day
uniform float u_refresh_rate;
uniform vec3  u_camera_pos;
uniform vec3  u_camera_dir;
uniform mat4  u_camera_view;
uniform sampler2D u_audio;     // R weighted FFT, G waveform, B raw FFT
uniform sampler2D u_keyboard;  // 256×3
uniform sampler2D u_webcam;
// multipass:
uniform sampler2D u_buffer_a; // previous pass / ping-pong
uniform sampler2D u_buffer_b;
uniform sampler2D u_buffer_c;
uniform sampler2D u_buffer_d;
uniform int u_passes;
```

## Shadertoy → FragCoord/Gamemaster mapping
| Shadertoy | Ours |
|-----------|------|
| iTime | u_time |
| iTimeDelta | u_time_delta |
| iFrame | u_frame |
| iResolution | vec3(u_resolution, 1.0) or u_resolution.xy |
| iMouse | u_mouse |
| iDate | u_date |
| iChannel0..3 | u_buffer_* / custom samplers |
| mainImage(out fragColor, in fragCoord) | wrap: call from main with gl_FragCoord.xy |
| Buffer A/B/C/D + Image | multi-pass FBO graph |

## Multipass architecture (must implement correctly)
1. **Common** tab: shared functions included into each pass
2. Each buffer pass renders to RGBA float/half FBO
3. Image pass composites final screen
4. Self-feedback: read previous frame of same buffer (ping-pong two textures)
5. Order: A → B → C → D → Image each frame (configurable)

## Pass kinds FragCoord supports
- **Image** (2D final)
- **Buffer** 2D
- **1D buffer** (width×1)
- **Cubemap** (6 faces)
- **3D buffer** (volume)
- **Compute** (WebGPU only)
- **MRT** multiple color attachments

## Error UX bar
- Show full info log
- Map to source line
- Common fixes: precision, missing `;`, type mismatch, texture lod, WebGL1 vs 2

## When user says "like fragcoord" / "shader explore"
→ Scaffold `shader-lab` or emit full multipass playground + starter raymarch/plasma.
→ Prefer GLSL ES 3.00 (`#version 300 es`) with WebGL2; fallback 100 es if needed.

## Quality bar = FragCoord top niche
- 60fps stable
- Hot-reload on keystroke (debounce 150–300ms)
- No full page reload
- FPS counter + GPU time estimate optional
- Export PNG / copy GLSL / download project
