export interface EphemerisMeta {
  startUnixMs: number;
  stepSeconds: number;
  count: number;
  frame: string;
  aberration: string;
  kernels: string[];
  spiceToolkit: string;
  referenceSamples: {
    unixMs: number;
    lat: number;
    lon: number;
    sun: { az: number; el: number };
    earth: { az: number; el: number };
  }[];
}

/** SPICE-baked hourly ephemeris (Float32 x 10): sun[3] km, earth[3] km (MOON_ME, from Moon centre), quaternion ITRF93 -> MOON_ME. */
export class Ephemeris {
  readonly start: number;
  readonly step: number;
  readonly count: number;
  constructor(
    public meta: EphemerisMeta,
    public data: Float32Array,
  ) {
    this.start = meta.startUnixMs;
    this.step = meta.stepSeconds * 1000;
    this.count = meta.count;
  }
  get end() {
    return this.start + (this.count - 1) * this.step;
  }
  inRange(t: number) {
    return t >= this.start && t <= this.end;
  }
  /** Interpolated state at unix-ms t into out[10]: linear on vectors, slerp on the quaternion. */
  at(t: number, out: Float64Array | number[]) {
    let u = (t - this.start) / this.step;
    if (u < 0) u = 0;
    else if (u > this.count - 1.000001) u = this.count - 1.000001;
    const i = Math.floor(u),
      f = u - i,
      d = this.data,
      a = i * 10,
      b = a + 10,
      g = 1 - f;
    for (let k = 0; k < 6; k++) out[k] = d[a + k] * g + d[b + k] * f;
    let dp = d[a + 6] * d[b + 6] + d[a + 7] * d[b + 7] + d[a + 8] * d[b + 8] + d[a + 9] * d[b + 9],
      sg = 1;
    if (dp < 0) {
      dp = -dp;
      sg = -1;
    }
    let w0 = g,
      w1 = f;
    if (dp < 0.9995) {
      const th = Math.acos(dp),
        s = Math.sin(th);
      w0 = Math.sin(g * th) / s;
      w1 = Math.sin(f * th) / s;
    }
    let n = 0;
    for (let k = 0; k < 4; k++) {
      const q = w0 * d[a + 6 + k] + sg * w1 * d[b + 6 + k];
      out[6 + k] = q;
      n += q * q;
    }
    n = 1 / Math.sqrt(n);
    for (let k = 6; k < 10; k++) out[k] *= n;
  }
}
