import { R_M, DEG, Frame, siteFrame, toStereo } from './geo';
import { Pyramid } from './dem';

/**
 * Exact terrain horizon with a convex "obstruction envelope" for mast height (architecture doc sec. 6.1-6.2).
 *
 * For one azimuth every terrain sample k at horizontal distance h_k (measured perpendicular to the local vertical) gives
 *     tan(theta_k(z)) = a_k - z / h_k           (a_k = tangent seen from the surface, z = mast height)
 * exactly, because raising the observer along the vertical changes only the vertical offset. So the horizon is
 *     tan(theta(z)) = max_k (a_k - m_k z),  m_k = 1/h_k  -- convex, decreasing, piecewise linear in z.
 * We keep only the non-dominated lines over z in [0, zmax]; any mast height is then exact with no re-march.
 */
export interface MarchOptions {
  naz: number;
  zmax: number;
  maxDistM: number;
}
export const DEFAULT_MARCH: MarchOptions = { naz: 1440, zmax: 50, maxDistM: 300_000 };

export class HorizonEnvelope {
  constructor(
    public naz: number,
    public zmax: number,
    public off: Uint32Array,
    public a: Float32Array,
    public m: Float32Array,
    public groundHeight: number,
    public lat: number,
    public lon: number,
    public samples: number,
  ) {}
  /** Horizon elevation (deg) for every azimuth at mast height z (m), written into out[naz]. */
  elevationDeg(z: number, out: Float32Array = new Float32Array(this.naz)): Float32Array {
    for (let i = 0; i < this.naz; i++) {
      let best = -Infinity;
      for (let k = this.off[i]; k < this.off[i + 1]; k++) {
        const v = this.a[k] - this.m[k] * z;
        if (v > best) best = v;
      }
      out[i] = Math.atan(best) / DEG;
    }
    return out;
  }
  /** Smallest mast height (m) at which the horizon at azimuth index i is at or below targetDeg; Infinity if not reachable within zmax. */
  minHeightFor(i: number, targetDeg: number): number {
    const t = Math.tan(targetDeg * DEG);
    let z = 0;
    for (let k = this.off[i]; k < this.off[i + 1]; k++) {
      const need = (this.a[k] - t) / this.m[k];
      if (need > z) z = need;
    }
    return z > this.zmax ? Infinity : z;
  }
  get lineCount() {
    return this.a.length;
  }
}

/** Step schedule: 10 m to 500 m, 20 m to 5 km, 100 m to 40 km, 400 m to maxDist. */
export function stepSchedule(maxDist: number): number[] {
  const d: number[] = [];
  for (let x = 10; x <= 500; x += 10) d.push(x);
  for (let x = 520; x <= 5000; x += 20) d.push(x);
  for (let x = 5100; x <= 40000; x += 100) d.push(x);
  for (let x = 40400; x <= maxDist; x += 400) d.push(x);
  return d;
}

const sched = new Map<
  number,
  { d: Float64Array; cs: Float64Array; sn: Float64Array; cls: Uint8Array; curv: Float64Array; hb: Float64Array }
>();
function getSched(maxDist: number) {
  let s = sched.get(maxDist);
  if (!s) {
    const d = stepSchedule(maxDist),
      n = d.length;
    s = {
      d: Float64Array.from(d),
      cs: new Float64Array(n),
      sn: new Float64Array(n),
      cls: new Uint8Array(n),
      curv: new Float64Array(n),
      hb: new Float64Array(n),
    };
    for (let i = 0; i < n; i++) {
      const sig = d[i] / R_M;
      s.cs[i] = Math.cos(sig);
      s.sn[i] = Math.sin(sig);
      s.cls[i] = d[i] < 5000 ? 0 : d[i] < 40000 ? 1 : 2;
      s.curv[i] = R_M * (1 - s.cs[i]);
      s.hb[i] = R_M * s.sn[i];
    }
    sched.set(maxDist, s);
  }
  return s;
}

/** Compute the horizon envelope for an observer at (lat, lon) on the surface using the pyramid. */
export function computeEnvelope(
  pyr: Pyramid,
  latDeg: number,
  lonDeg: number,
  opt: MarchOptions = DEFAULT_MARCH,
  frame?: Frame,
  azList?: ArrayLike<number>,
): HorizonEnvelope {
  const fr = frame ?? siteFrame(latDeg, lonDeg);
  const [nx0, ny0, nz0] = fr.n,
    [Ex, Ey, Ez] = fr.e,
    [Nx, Ny, Nz] = fr.north;
  const [sx, sy] = toStereo(fr.n);
  let hO = pyr.surfaceAtN(fr.n, sx, sy);
  if (Number.isNaN(hO)) hO = 0;
  const rO = R_M + hO,
    Ox = rO * nx0,
    Oy = rO * ny0,
    Oz = rO * nz0;
  const S = getSched(opt.maxDistM),
    ns = S.d.length;
  const zmax = opt.zmax,
    twoR = 2 * R_M,
    hmax = pyr.hmax;
  const lv = pyr.levels,
    glob = pyr.global;
  const naz = azList ? azList.length : opt.naz;
  const offs = new Uint32Array(naz + 1);
  const A: number[] = [],
    M: number[] = [];
  const hullA = new Float64Array(2048),
    hullM = new Float64Array(2048); // >= number of samples per ray, so no line is ever evicted
  let samples = 0;
  for (let ia = 0; ia < naz; ia++) {
    const az = azList ? azList[ia] * DEG : (2 * Math.PI * ia) / opt.naz,
      ca = Math.cos(az),
      sa = Math.sin(az);
    const tx = ca * Nx + sa * Ex,
      ty = ca * Ny + sa * Ey,
      tz = ca * Nz + sa * Ez;
    let bestV = -Infinity,
      hs = 0,
      prevM = Infinity;
    for (let s = 0; s < ns; s++) {
      if ((hmax - hO - S.curv[s]) / S.hb[s] <= bestV) break; // nothing further away can matter
      const cs = S.cs[s],
        sn = S.sn[s];
      const px = cs * nx0 + sn * tx,
        py = cs * ny0 + sn * ty,
        pz = cs * nz0 + sn * tz;
      const k = twoR / (1 - pz),
        X = k * py,
        Y = k * px;
      let H = NaN;
      const list = lv[S.cls[s]];
      for (let g = 0; g < list.length; g++) {
        H = list[g].height(X, Y);
        if (H === H) break;
      }
      if (H !== H && glob) H = glob.heightN(px, py, pz);
      samples++;
      if (H !== H) continue;
      const r = R_M + H,
        dx = r * px - Ox,
        dy = r * py - Oy,
        dz = r * pz - Oz;
      const u = dx * nx0 + dy * ny0 + dz * nz0,
        h2 = dx * dx + dy * dy + dz * dz - u * u;
      if (h2 <= 1) continue;
      const h = Math.sqrt(h2),
        a = u / h,
        m = 1 / h;
      if (m >= prevM) continue;
      const v = a - zmax * m;
      if (v <= bestV) continue;
      bestV = v;
      prevM = m;
      // upper-envelope hull: lines arrive with increasing slope (-m increases)
      while (hs >= 2) {
        const a1 = hullA[hs - 2],
          m1 = hullM[hs - 2],
          a2 = hullA[hs - 1],
          m2 = hullM[hs - 1];
        const z12 = (a1 - a2) / (m1 - m2),
          z13 = (a1 - a) / (m1 - m);
        if (z13 <= z12) hs--;
        else break;
      }
      hullA[hs] = a;
      hullM[hs] = m;
      hs++;
    }
    // clip to z in [0, zmax]
    let lo = 0;
    while (hs - lo >= 2 && (hullA[lo] - hullA[lo + 1]) / (hullM[lo] - hullM[lo + 1]) <= 0) lo++;
    for (let q = lo; q < hs; q++) {
      A.push(hullA[q]);
      M.push(hullM[q]);
    }
    if (hs === 0) {
      A.push(-1);
      M.push(1e-3);
    }
    offs[ia + 1] = A.length;
  }
  return new HorizonEnvelope(naz, zmax, offs, Float32Array.from(A), Float32Array.from(M), hO, latDeg, lonDeg, samples);
}
