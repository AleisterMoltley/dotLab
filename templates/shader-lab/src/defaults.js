/** Default multipass sources — FragCoord-compatible uniforms */

export const COMMON = `// Common helpers (prepended to every pass)
vec3 palette(float t) {
  vec3 a = vec3(0.5);
  vec3 b = vec3(0.5);
  vec3 c = vec3(1.0);
  vec3 d = vec3(0.263, 0.416, 0.557);
  return a + b * cos(6.28318 * (c * t + d));
}

float hash(vec2 p) {
  return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453);
}
`;

export const BUFFER_A = `// Buffer A — feedback plasma field
void main() {
  vec2 uv = gl_FragCoord.xy / u_resolution.xy;
  vec2 p = uv * 2.0 - 1.0;
  p.x *= u_resolution.x / u_resolution.y;

  vec4 prev = texture2D(u_buffer_a, uv);
  float n = hash(uv * 40.0 + u_time);
  float v = sin(p.x * 3.0 + u_time) * cos(p.y * 3.5 - u_time * 0.7);
  v = 0.5 + 0.5 * v;
  vec3 col = palette(v + n * 0.05 + u_time * 0.05);
  // light feedback trail
  col = mix(prev.rgb * 0.92, col, 0.35);
  gl_FragColor = vec4(col, 1.0);
}
`;

export const IMAGE = `// Image — final composite + mouse glow + optional audio pulse
void main() {
  vec2 uv = gl_FragCoord.xy / u_resolution.xy;
  vec3 base = texture2D(u_buffer_a, uv).rgb;

  // mouse light
  vec2 m = u_mouse.xy / u_resolution.xy;
  float d = length(uv - m);
  float glow = exp(-d * 12.0) * (u_mouse.z > 0.0 ? 0.55 : 0.2);

  // audio: average low bins from row 0 of u_audio (if bound)
  float a = texture2D(u_audio, vec2(0.05, 0.25)).r;
  float pulse = 0.15 + a * 0.6;

  vec3 col = base * (0.85 + pulse * 0.35) + glow * palette(u_time * 0.1);
  // vignette
  col *= smoothstep(1.2, 0.2, length(uv - 0.5));
  gl_FragColor = vec4(col, 1.0);
}
`;

export const SHADERTOY_STARTER = `#shadertoy
void mainImage(out vec4 fragColor, in vec2 fragCoord) {
  vec2 uv = fragCoord / iResolution.xy;
  vec3 col = 0.5 + 0.5 * cos(iTime + uv.xyx + vec3(0, 2, 4));
  fragColor = vec4(col, 1.0);
}
`;
