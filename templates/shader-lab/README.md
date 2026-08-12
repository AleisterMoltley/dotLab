# Gamemaster Shader Lab

Local multipass GLSL editor:

- Live-Preview, hot reload (Ctrl/Cmd+Enter)
- **Common + Buffer A–D + Image** multipass (ping-pong feedback)
- Built-ins: `u_time`, `u_resolution`, `u_mouse`, `u_drag`, `u_scroll`, `u_date`, `u_camera_*`, `u_audio`, `u_keyboard`, `u_buffer_a..d`
- **Shadertoy**-Import (JSON) + `#shadertoy` / `mainImage` Auto-Convert
- Audio file / Mic → `u_audio` texture
- Keyboard texture `u_keyboard`
- FPS, Pause, Reset time, Export JSON
- Compile error panel

## Run

```bash
npm install
npm run dev
```

## Extend with Gamemaster

```bash
gamemaster -p . --agent "Add Buffer B reaction-diffusion and composite in Image"
gamemaster "Port this Shadertoy mainImage to our lab uniforms"
```

## Stack
Vite + three.js WebGL2 fullscreen passes. Kein Cloud, $0.
