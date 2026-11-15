#version 300 es
// Live south-pole view: every pixel marches a ray through the LOLA terrain toward the Sun (and/or Earth) on the
// curved Moon, so shadows, penumbrae and Earth visibility are computed, not painted. Terrain comes from up to four
// nested grids (local 20/40 m and 120 m when zoomed in, then 240 m and 480 m), finest first.
precision highp float;
uniform sampler2D uL0, uL1, uMid, uFar;
uniform vec4 uL0Geo, uL1Geo, uMidGeo, uFarGeo; // x0, y0, res, n   (polar stereographic metres, row 0 at y0)
uniform int uLocal;
uniform vec2 uCenter, uSize;
uniform float uMpp, uExposure;
uniform vec3 uSun, uEarth; // unit vectors, MOON_ME
uniform float uSunR, uEarthR; // angular radii, rad
uniform int uLayer, uSteps;
out vec4 outc;
const float R = 1737400.0;

float grid(sampler2D t, vec4 g, vec2 p, out bool ok) {
  vec2 c = vec2((p.x - g.x) / g.z, (g.y - p.y) / g.z);
  ok = c.x >= 0.0 && c.y >= 0.0 && c.x <= g.w - 1.0 && c.y <= g.w - 1.0;
  return textureLod(t, (c + 0.5) / g.w, 0.0).r;
}
// height (m) at p, finest grid first; res = that grid's spacing
float hAt(vec2 p, out bool ok, out float res) {
  float h;
  if (uLocal == 1) {
    h = grid(uL0, uL0Geo, p, ok);
    res = uL0Geo.z;
    if (ok && h > -2e4) return h;
    h = grid(uL1, uL1Geo, p, ok);
    res = uL1Geo.z;
    if (ok && h > -2e4) return h;
  }
  h = grid(uMid, uMidGeo, p, ok);
  res = uMidGeo.z;
  if (ok && h > -2e4) return h;
  res = uFarGeo.z;
  return grid(uFar, uFarGeo, p, ok);
}
float hAt(vec2 p, out bool ok) {
  float r;
  return hAt(p, ok, r);
}
vec3 fromStereo(vec2 p) {
  float rho = max(length(p), 1e-3), g = 2.0 * atan(rho / (2.0 * R)), sg = sin(g);
  return vec3(sg * p.y / rho, sg * p.x / rho, -cos(g));
}
// visible fraction of a disc of angular radius r in direction d, seen from P (metres from the Moon's centre)
float vis(vec3 P, vec3 d, float r, float t0) {
  float t = t0, clear = 1.0;
  for (int i = 0; i < 300; i++) {
    if (i >= uSteps) break;
    vec3 Q = P + d * t;
    float L = length(Q);
    vec3 q = Q / L;
    if (q.z > -0.2) break;
    float k = 2.0 * R / (1.0 - q.z);
    bool ok;
    float h = hAt(vec2(k * q.y, k * q.x), ok);
    if (!ok) break;
    clear = min(clear, (L - R - h) / t);
    if (clear < -1.2 * r) break;
    t *= 1.042;
    if (t > 4.0e5) break;
  }
  return clamp(0.5 + clear / (2.0 * r), 0.0, 1.0);
}
// ACES filmic curve (Narkowicz fit): soft highlight roll-off, deep but not crushed shadows
vec3 aces(vec3 x) {
  return clamp((x * (2.51 * x + 0.03)) / (x * (2.43 * x + 0.59) + 0.14), 0.0, 1.0);
}
void main() {
  vec2 px = gl_FragCoord.xy - 0.5 * uSize;
  vec2 p = uCenter + px * uMpp;
  bool ok;
  float res;
  float h = hAt(p, ok, res);
  if (!ok || h < -2e4) {
    outc = vec4(0.008, 0.011, 0.02, 1.0);
    return;
  }
  vec3 n = fromStereo(p);
  // central differences at the data spacing (or the pixel size when zoomed out), so slopes stay crisp
  float e = max(res, uMpp);
  bool o;
  float hx = (hAt(p + vec2(e, 0.0), o) - hAt(p - vec2(e, 0.0), o)) / (2.0 * e);
  float hy = (hAt(p + vec2(0.0, e), o) - hAt(p - vec2(0.0, e), o)) / (2.0 * e);
  // stereographic +x runs along MOON_ME +Y and +y along +X near the pole
  vec3 tY = normalize(vec3(0.0, 1.0, 0.0) - n.y * n), tX = normalize(vec3(1.0, 0.0, 0.0) - n.x * n);
  vec3 N = normalize(n - hx * tY - hy * tX);
  vec3 P = n * (R + h + 2.0);
  float t0 = max(0.5 * res, 10.0);

  float sunUp = dot(n, uSun), earthUp = dot(n, uEarth);
  float sv = sunUp > -0.08 ? vis(P, uSun, uSunR, t0) : 0.0;
  if (uLayer == 3) {
    outc = vec4(sv, 0.0, 0.0, 1.0); // diagnostic: raw Sun-disc visibility for a 2 m observer
    return;
  }
  // lunar-Lambert photometry (Lommel-Seeliger blended with Lambert), viewed from straight above
  float ci = max(dot(N, uSun), 0.0), ce = max(dot(N, n), 0.05);
  float radiance = ci * (1.2 / (ci + ce) + 0.4) * sv;
  vec3 regolith = vec3(0.96, 0.93, 0.88);
  // faint earthshine and sky term so ground in shadow still shows its relief
  float amb = 0.004 + 0.022 * max(dot(N, uEarth), 0.0) * step(0.0, earthUp + 0.02) + 0.003 * ce;
  vec3 lin = regolith * radiance + vec3(0.42, 0.52, 0.78) * amb;
  vec3 col = aces(lin * uExposure);

  if (uLayer > 0) {
    float ev = earthUp > -0.08 ? vis(P, uEarth, uEarthR, t0) : 0.0;
    vec3 base = aces(regolith * radiance * uExposure * 0.7 + vec3(0.42, 0.52, 0.78) * amb * uExposure);
    if (uLayer == 1) {
      col = mix(base * 0.85, vec3(0.18, 0.5, 1.0), ev * 0.55) + ev * 0.04;
    } else {
      float s = smoothstep(0.05, 0.4, sv * step(0.0, sunUp));
      vec3 both = vec3(0.3, 0.92, 0.58), sunOnly = vec3(1.0, 0.75, 0.28), earthOnly = vec3(0.2, 0.48, 1.0);
      vec3 tint = s * ev * both + s * (1.0 - ev) * sunOnly + (1.0 - s) * ev * earthOnly;
      col = mix(base * 0.75, tint, 0.5 * max(s, ev)) + base * 0.22;
    }
  }
  // gentle vignette, then sRGB
  vec2 v = gl_FragCoord.xy / uSize - 0.5;
  col *= 1.0 - 0.3 * dot(v, v);
  outc = vec4(pow(col, vec3(1.0 / 2.2)), 1.0);
}
