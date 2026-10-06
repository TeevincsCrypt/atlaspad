/**
 * GLSL for the Atlas world. Every world-space position is computed on the GPU from two coordinate systems —
 * the flat map (aPlane) and the globe (aLonLat) — blended by `uMorph` (0 = globe, 1 = map). The scene graph
 * rotates the world group by -90° about X so the map lies on XZ and the globe's north pole points up.
 */

export const MORPH_CHUNK = /* glsl */ `
uniform float uMorph;
uniform float uRadius;

vec3 sphereNormal(vec2 lonLat) {
  float lon = lonLat.x;
  float lat = lonLat.y;
  return vec3(cos(lat) * sin(lon), -cos(lat) * cos(lon), sin(lat));
}

// Returns the surface frame (center, tangent east, tangent north, normal) at a cell for the current morph.
void surfaceFrame(vec2 plane, vec2 lonLat, out vec3 C, out vec3 T, out vec3 B, out vec3 N) {
  vec3 sN = sphereNormal(lonLat);
  vec3 pC = vec3(plane, 0.0);
  vec3 sC = sN * uRadius;
  C = mix(pC, sC, 1.0 - uMorph);
  N = normalize(mix(sN, vec3(0.0, 0.0, 1.0), uMorph));
  vec3 sT = vec3(cos(lonLat.x), sin(lonLat.x), 0.0);
  T = normalize(mix(sT, vec3(1.0, 0.0, 0.0), uMorph));
  B = normalize(cross(N, T));
}
`;

export const HEX_VERTEX = /* glsl */ `
${MORPH_CHUNK}
uniform float uTime;
uniform float uReveal;
uniform sampler2D uNationTex;
uniform float uNationTexSize;

attribute vec2 aPlane;
attribute vec2 aLonLat;
attribute vec3 aColor;
attribute float aLift;
attribute float aGlow;
attribute float aRevealAt;
attribute float aNationIdx;
attribute float aBorder;

varying vec3 vColor;
varying float vGlow;
varying vec3 vNormal;
varying vec2 vLocal;
varying vec4 vNation;
varying float vRevealed;
varying float vBorder;
varying float vIsNation;
varying vec3 vWorld;

void main() {
  vec4 nation = vec4(0.0);
  if (aNationIdx > 0.5) {
    nation = texture2D(uNationTex, vec2((aNationIdx + 0.5) / uNationTexSize, 0.5));
  }
  float revealed = aNationIdx > 0.5 ? smoothstep(aRevealAt, aRevealAt + 0.06, uReveal) : 1.0;
  vec3 C, T, B, N;
  surfaceFrame(aPlane, aLonLat, C, T, B, N);
  float squeeze = mix(cos(aLonLat.y), 1.0, uMorph);
  float lift = (aLift * mix(0.35, 1.0, revealed)) + nation.r * 0.06;
  vec3 pos = C + T * position.x * squeeze * 0.97 + B * position.y * 0.97 + N * lift;
  vColor = aColor;
  vGlow = aGlow * revealed;
  vNormal = normalize(normalMatrix * N);
  vLocal = position.xy;
  vNation = nation;
  vRevealed = revealed;
  vBorder = aBorder;
  vIsNation = step(0.5, aNationIdx);
  vec4 world = modelMatrix * vec4(pos, 1.0);
  vWorld = world.xyz;
  gl_Position = projectionMatrix * viewMatrix * world;
}
`;

export const HEX_FRAGMENT = /* glsl */ `
uniform float uTime;
uniform float uHexRadius;
uniform float uHover;
uniform float uSelected;
uniform float uDimOthers;

varying vec3 vColor;
varying float vGlow;
varying vec3 vNormal;
varying vec2 vLocal;
varying vec4 vNation;
varying float vRevealed;
varying float vBorder;
varying float vIsNation;
varying vec3 vWorld;

float hash(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }

void main() {
  float d = length(vLocal) / uHexRadius;
  float bevel = smoothstep(0.78, 1.0, d);
  vec3 L = normalize(vec3(0.35, 0.8, 0.45));
  float diffuse = 0.62 + 0.38 * max(dot(normalize(vNormal), L), 0.0);
  vec3 col = vColor * diffuse;
  col = mix(col, col * 0.55, bevel);

  if (vIsNation > 0.5) {
    // nation.r: pulse, nation.g: pulse polarity (1 buy, 0 sell), nation.b: status code, nation.a: highlight
    float highlight = vNation.a;
    float sv = vNation.b * 10.0;
    float status = floor(sv + 0.01);
    float atWar = step(0.45, sv - status);
    col = mix(col * 0.22, col, highlight);
    col *= mix(0.35, 1.0, vRevealed);
    // borders glow in the national color
    col += vColor * vBorder * 0.55 * highlight * vRevealed;
    col += vColor * vGlow * 0.9 * highlight;
    // market pulse
    vec3 pulseColor = mix(vec3(1.0, 0.25, 0.3), vec3(1.0, 0.85, 0.45), vNation.g);
    col += pulseColor * vNation.r * (1.2 - d * 0.6) * 1.6;
    // statuses
    if (status == 1.0) {
      // golden age
      float shimmer = 0.5 + 0.5 * sin(uTime * 2.4 + vWorld.x * 3.0 + vWorld.z * 2.0);
      col = mix(col, vec3(1.0, 0.82, 0.42) * 1.6, 0.35 + 0.2 * shimmer);
    } else if (status == 2.0) {
      // economic crisis: dimmed power and red warning flicker
      float flicker = step(0.92, hash(vec2(floor(uTime * 6.0), vWorld.x)));
      col *= 0.45;
      col += vec3(0.9, 0.08, 0.12) * (0.25 + 0.35 * flicker) * (0.6 + 0.4 * sin(uTime * 3.0));
    } else if (status == 3.0) {
      // boom: brighter lights
      col *= 1.35;
    } else if (status == 4.0) {
      // crash: dimmed
      col *= 0.6;
    }
    // at war: red pulsing borders
    if (atWar > 0.5) {
      col += vec3(1.0, 0.12, 0.18) * vBorder * (0.5 + 0.5 * sin(uTime * 5.0));
    }
  }
  gl_FragColor = vec4(col, 1.0);
}
`;

export const LIGHTS_VERTEX = /* glsl */ `
${MORPH_CHUNK}
uniform float uTime;
uniform float uReveal;
uniform float uPixelRatio;
uniform sampler2D uNationTex;
uniform float uNationTexSize;
attribute vec2 aPlane;
attribute vec2 aLonLat;
attribute vec2 aOffset;
attribute float aSize;
attribute float aPhase;
attribute float aRevealAt;
attribute float aNationIdx;
attribute vec3 aColor;
varying vec3 vColor;
varying float vAlpha;
void main() {
  vec4 nation = texture2D(uNationTex, vec2((aNationIdx + 0.5) / uNationTexSize, 0.5));
  vec3 C, T, B, N;
  surfaceFrame(aPlane, aLonLat, C, T, B, N);
  vec3 pos = C + T * aOffset.x + B * aOffset.y + N * (0.08 + aSize * 0.02);
  vec4 mv = viewMatrix * modelMatrix * vec4(pos, 1.0);
  float revealed = smoothstep(aRevealAt, aRevealAt + 0.05, uReveal);
  float twinkle = 0.65 + 0.35 * sin(uTime * (1.2 + aPhase) + aPhase * 12.0);
  float status = floor(nation.b * 10.0 + 0.01);
  float power = status == 2.0 ? step(0.5, fract(sin(aPhase * 91.0 + floor(uTime * 4.0)) * 43758.5)) * 0.6 : 1.0;
  vColor = status == 1.0 ? vec3(1.0, 0.8, 0.4) : aColor;
  vAlpha = revealed * twinkle * power * mix(0.35, 1.0, nation.a) + nation.r * 0.8;
  gl_PointSize = aSize * uPixelRatio * (34.0 / -mv.z) * (1.0 + nation.r * 1.5);
  gl_Position = projectionMatrix * mv;
}
`;

export const LIGHTS_FRAGMENT = /* glsl */ `
varying vec3 vColor;
varying float vAlpha;
void main() {
  vec2 c = gl_PointCoord - 0.5;
  float d = length(c);
  float core = smoothstep(0.5, 0.0, d);
  float glow = pow(core, 2.2);
  gl_FragColor = vec4(vColor * (0.6 + glow * 1.8), glow * vAlpha);
  if (gl_FragColor.a < 0.01) discard;
}
`;

export const ROUTE_VERTEX = /* glsl */ `
${MORPH_CHUNK}
attribute vec2 aPlaneA;
attribute vec2 aPlaneB;
attribute vec2 aLonLatA;
attribute vec2 aLonLatB;
attribute float aT;
attribute vec3 aColor;
attribute float aKind;
varying float vT;
varying vec3 vColor;
varying float vKind;

vec3 slerpDir(vec3 a, vec3 b, float t) {
  float d = clamp(dot(a, b), -0.999, 0.999);
  float th = acos(d);
  if (th < 0.001) return a;
  return (sin((1.0 - t) * th) * a + sin(t * th) * b) / sin(th);
}

void main() {
  float t = aT;
  // flat map: lifted quadratic arc
  vec2 p = mix(aPlaneA, aPlaneB, t);
  float span = length(aPlaneB - aPlaneA);
  vec3 planePos = vec3(p, 0.12 + sin(t * 3.14159) * span * 0.12);
  // globe: great-circle arc with altitude
  vec3 da = sphereNormal(aLonLatA);
  vec3 db = sphereNormal(aLonLatB);
  vec3 dir = slerpDir(da, db, t);
  float h = 1.0 + 0.05 + sin(t * 3.14159) * 0.18 * acos(clamp(dot(da, db), -1.0, 1.0));
  vec3 spherePos = dir * uRadius * h;
  vec3 pos = mix(spherePos, planePos, uMorph);
  vT = t;
  vColor = aColor;
  vKind = aKind;
  gl_Position = projectionMatrix * viewMatrix * modelMatrix * vec4(pos, 1.0);
}
`;

export const ROUTE_FRAGMENT = /* glsl */ `
uniform float uTime;
uniform float uOpacity;
varying float vT;
varying vec3 vColor;
varying float vKind;
void main() {
  float speed = vKind > 0.5 ? 1.6 : 0.45;
  float dash = fract(vT * 14.0 - uTime * speed);
  float on = smoothstep(0.0, 0.15, dash) * (1.0 - smoothstep(0.55, 0.7, dash));
  float ends = smoothstep(0.0, 0.06, vT) * smoothstep(1.0, 0.94, vT);
  float pulse = vKind > 0.5 ? 0.6 + 0.4 * sin(uTime * 6.0) : 1.0;
  gl_FragColor = vec4(vColor * 1.6, on * ends * uOpacity * pulse);
}
`;

export const STRUCTURE_VERTEX = /* glsl */ `
${MORPH_CHUNK}
uniform float uReveal;
attribute vec2 aPlane;
attribute vec2 aLonLat;
attribute vec2 aOffset;
attribute vec3 aSize;
attribute vec3 aColor;
attribute float aRevealAt;
varying vec3 vColor;
varying float vShade;
varying float vTop;
void main() {
  vec3 C, T, B, N;
  surfaceFrame(aPlane, aLonLat, C, T, B, N);
  float revealed = smoothstep(aRevealAt, aRevealAt + 0.08, uReveal);
  // unit box centered at origin: x,y in [-0.5,0.5], z in [-0.5,0.5] → base at z = -0.5
  vec3 local = position;
  vec3 pos = C + T * (aOffset.x + local.x * aSize.x) + B * (aOffset.y + local.y * aSize.y) + N * (0.06 + (local.z + 0.5) * aSize.z * revealed);
  vColor = aColor;
  vShade = 0.55 + 0.45 * abs(normal.x * 0.6 + normal.y * 0.4 + normal.z);
  vTop = step(0.49, local.z);
  gl_Position = projectionMatrix * viewMatrix * modelMatrix * vec4(pos, 1.0);
}
`;

export const STRUCTURE_FRAGMENT = /* glsl */ `
varying vec3 vColor;
varying float vShade;
varying float vTop;
void main() {
  vec3 col = vColor * vShade;
  col += vColor * vTop * 0.6;
  gl_FragColor = vec4(col, 1.0);
}
`;

export const STARS_VERTEX = /* glsl */ `
uniform float uTime;
uniform float uPixelRatio;
attribute float aSize;
attribute float aPhase;
varying float vAlpha;
void main() {
  vec4 mv = modelViewMatrix * vec4(position, 1.0);
  vAlpha = 0.45 + 0.55 * sin(uTime * 0.6 + aPhase * 20.0);
  gl_PointSize = aSize * uPixelRatio;
  gl_Position = projectionMatrix * mv;
}
`;

export const STARS_FRAGMENT = /* glsl */ `
varying float vAlpha;
void main() {
  float d = length(gl_PointCoord - 0.5);
  float a = smoothstep(0.5, 0.0, d) * vAlpha;
  gl_FragColor = vec4(vec3(0.85, 0.9, 1.0), a);
}
`;

export const ATMOSPHERE_VERTEX = /* glsl */ `
varying vec3 vNormal;
varying vec3 vView;
void main() {
  vNormal = normalize(normalMatrix * normal);
  vec4 mv = modelViewMatrix * vec4(position, 1.0);
  vView = normalize(-mv.xyz);
  gl_Position = projectionMatrix * mv;
}
`;

export const ATMOSPHERE_FRAGMENT = /* glsl */ `
uniform float uOpacity;
varying vec3 vNormal;
varying vec3 vView;
void main() {
  float rim = pow(1.0 - max(dot(vNormal, vView), 0.0), 3.0);
  gl_FragColor = vec4(vec3(0.45, 0.62, 1.0) * 1.2, rim * uOpacity);
}
`;
