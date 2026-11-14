varying vec2 vUv;
void main() { float ridges = smoothstep(0.35, 0.7, sin(vUv.x * 42.0) * sin(vUv.y * 31.0)); gl_FragColor = vec4(vec3(0.13 + ridges * 0.18), 1.0); }
