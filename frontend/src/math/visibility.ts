import { DEG } from './geo';

/** Horizon elevation (deg) sampled on a uniform azimuth grid, with global min/max for early-outs. */
export class HorizonProfile {
  readonly naz: number;
  min = Infinity;
  max = -Infinity;
  constructor(public deg: Float32Array) {
    this.naz = deg.length;
    for (let i = 0; i < deg.length; i++) {
      const v = deg[i];
      if (v < this.min) this.min = v;
      if (v > this.max) this.max = v;
    }
  }
  at(azDeg: number): number {
    let u = (azDeg / 360) * this.naz;
    u -= Math.floor(u / this.naz) * this.naz;
    const i = Math.floor(u),
      f = u - i,
      j = i + 1 === this.naz ? 0 : i + 1;
    return this.deg[i] * (1 - f) + this.deg[j] * f;
  }
}

/** Visible fraction of a disc (centre az/el, angular radius r, all degrees) above a horizon, by vertical strips each clipped at its own azimuth. */
export function discFraction(p: HorizonProfile, az: number, el: number, r: number, strips: number): number {
  if (el - r >= p.max) return 1;
  if (el + r <= p.min) return 0;
  const sc = 1 / Math.max(Math.cos(el * DEG), 0.05);
  let sw = 0,
    sv = 0;
  for (let j = 0; j < strips; j++) {
    const x = (((j + 0.5) / strips) * 2 - 1) * r;
    const c = Math.sqrt(Math.max(0, r * r - x * x));
    if (c <= 0) continue;
    const h = p.at(az + x * sc);
    let vis = (el + c - h) / (2 * c);
    vis = vis < 0 ? 0 : vis > 1 ? 1 : vis;
    sw += c;
    sv += c * vis;
  }
  return sw > 0 ? sv / sw : 0;
}

/** Overlap area of two discs (radii r1, r2 deg, centre separation d deg) divided by the area of disc 1. */
export function overlapFraction(r1: number, r2: number, d: number): number {
  if (d >= r1 + r2) return 0;
  if (d <= Math.abs(r1 - r2)) return r2 >= r1 ? 1 : (r2 * r2) / (r1 * r1);
  const a1 = Math.acos((d * d + r1 * r1 - r2 * r2) / (2 * d * r1)),
    a2 = Math.acos((d * d + r2 * r2 - r1 * r1) / (2 * d * r2));
  const area = r1 * r1 * (a1 - Math.sin(2 * a1) / 2) + r2 * r2 * (a2 - Math.sin(2 * a2) / 2);
  return area / (Math.PI * r1 * r1);
}
