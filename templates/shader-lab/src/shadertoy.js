/**
 * Shadertoy → FragCoord/Gamemaster GLSL converter
 */
export function isShadertoySource(src) {
  return (
    /^\s*#shadertoy\b/m.test(src) ||
    /\bvoid\s+mainImage\s*\(/.test(src) ||
    /\biTime\b/.test(src) ||
    /\biResolution\b/.test(src)
  );
}

export function convertShadertoyToFragCoord(src) {
  let s = src.replace(/^\s*#shadertoy\b[^\n]*\n?/m, '');

  // classic renames
  const map = [
    [/\biTimeDelta\b/g, 'u_time_delta'],
    [/\biFrameRate\b/g, 'u_refresh_rate'],
    [/\biTime\b/g, 'u_time'],
    [/\biFrame\b/g, 'u_frame'],
    [/\biMouse\b/g, 'u_mouse'],
    [/\biDate\b/g, 'u_date'],
    [/\biSampleRate\b/g, '44100.0'],
    [/\biChannel0\b/g, 'u_buffer_a'],
    [/\biChannel1\b/g, 'u_buffer_b'],
    [/\biChannel2\b/g, 'u_buffer_c'],
    [/\biChannel3\b/g, 'u_buffer_d'],
  ];
  for (const [re, to] of map) s = s.replace(re, to);

  // iResolution.xy / iResolution → u_resolution
  s = s.replace(/\biResolution\.xy\b/g, 'u_resolution');
  s = s.replace(/\biResolution\b/g, 'vec3(u_resolution, 1.0)');

  // If mainImage exists but no main, wrap
  if (/\bvoid\s+mainImage\s*\(/.test(s) && !/\bvoid\s+main\s*\(/.test(s)) {
    s += `

void main() {
  vec4 col;
  mainImage(col, gl_FragCoord.xy);
  gl_FragColor = col;
}
`;
  }
  return s;
}

/**
 * Import Shadertoy export JSON (unofficial/common shapes)
 */
export function importShadertoyJson(json) {
  const passes = [];
  // Official-ish: Shader.renderpass[]
  const renderpass =
    json?.Shader?.renderpass ||
    json?.renderpass ||
    json?.passes ||
    null;

  if (Array.isArray(renderpass)) {
    for (const rp of renderpass) {
      const type = String(rp.type || rp.name || 'image').toLowerCase();
      const code = rp.code || rp.source || '';
      let name = 'Image';
      if (type.includes('common')) name = 'Common';
      else if (type.includes('buffer')) {
        const letter = (rp.name || rp.inputs?.[0]?.channel || 'A').toString().slice(-1).toUpperCase();
        name = `Buffer ${letter}`;
      } else if (type.includes('sound')) name = 'Sound';
      else name = 'Image';
      passes.push({ name, source: code, kind: type.includes('common') ? 'common' : type.includes('buffer') ? 'buffer' : 'image' });
    }
  } else if (typeof json?.code === 'string') {
    passes.push({ name: 'Image', source: json.code, kind: 'image' });
  }

  return passes.map((p) => ({
    ...p,
    source: p.kind === 'common' ? p.source : convertShadertoyToFragCoord(p.source),
  }));
}
