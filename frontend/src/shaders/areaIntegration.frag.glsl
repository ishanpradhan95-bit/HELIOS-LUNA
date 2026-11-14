#version 300 es
precision highp float; precision highp sampler3D;
uniform sampler3D uSun2, uSun10, uE2, uE10; uniform sampler2D uEarthAz0, uTime;
uniform int uN; uniform vec2 uCenter; uniform float uRes, uCells, uZ, uLit, uEarthStep, uBins;
uniform vec2 uSunRange, uEarthRange;
out vec4 outc;
const float R = 1737400.0; const float D2R = 0.017453292519943295;
float horizon(sampler3D a, sampler3D b, vec3 uv, vec2 range, float w){
  float h2 = mix(range.x, range.y, texture(a, uv).r), h10 = mix(range.x, range.y, texture(b, uv).r);
  return atan(mix(tan(h2*D2R), tan(h10*D2R), w)) / D2R;       // linear in tan(theta) between baked heights: exact-or-pessimistic
}
void main(){
  vec2 fc = gl_FragCoord.xy;
  float x = uCenter.x + (fc.x - uCells*0.5) * uRes, y = uCenter.y + (uCells*0.5 - fc.y) * uRes;
  float rho = max(length(vec2(x,y)), 1.0), g = 2.0*atan(rho/(2.0*R)), sg = sin(g), cg = cos(g);
  float sl = x/rho, cl = y/rho;
  vec3 n = vec3(sg*cl, sg*sl, -cg), e = vec3(-sl, cl, 0.0), nn = vec3(cg*cl, cg*sl, sg);   // up, east, north
  vec3 pos = n * 1737.4;
  vec2 cuv = (floor(fc) + 0.5) / uCells;
  float azC = texture(uEarthAz0, cuv).r;
  float w = clamp((uZ - 2.0)/8.0, 0.0, 1.0);
  float sun = 0.0, earth = 0.0, both = 0.0, cur = 0.0, best = 0.0;
  for (int i = 0; i < 4096; i++) {
    if (i >= uN) break;
    int k = i*2; ivec2 t0 = ivec2(k % 2048, k / 2048), t1 = ivec2((k+1) % 2048, (k+1) / 2048);
    vec4 s = texelFetch(uTime, t0, 0), ep = texelFetch(uTime, t1, 0);
    float saz = mod(atan(dot(s.xyz,e), dot(s.xyz,nn))/D2R, 360.0), sel = asin(clamp(dot(s.xyz,n),-1.0,1.0))/D2R;
    float hs = horizon(uSun2, uSun10, vec3(cuv, (saz+0.5)/360.0), uSunRange, w);
    float f = clamp((sel - hs)/(2.0*s.w) + 0.5, 0.0, 1.0);
    vec3 v = ep.xyz - pos; float d = length(v); v /= d;
    float eaz = atan(dot(v,e), dot(v,nn))/D2R, eel = asin(clamp(dot(v,n),-1.0,1.0))/D2R;
    float b = (mod(eaz - azC + 540.0, 360.0) - 180.0)/uEarthStep + (uBins-1.0)*0.5;
    float he = horizon(uE2, uE10, vec3(cuv, (clamp(b, 0.0, uBins-1.0)+0.5)/uBins), uEarthRange, w);
    float up = eel > he ? 1.0 : 0.0;
    bool lit = f > uLit;
    sun += f; earth += up; if (lit) { both += up; cur = 0.0; } else { cur += 1.0; best = max(best, cur); }
  }
  float inv = 1.0/float(max(uN,1));
  outc = vec4(sun*inv, earth*inv, both*inv, best*inv);
}
