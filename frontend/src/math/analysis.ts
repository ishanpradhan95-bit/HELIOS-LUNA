import { DEG, Frame, SUN_RADIUS_KM, EARTH_RADIUS_KM, geodeticToEcef, quatRotate, wrap360 } from './geo';
import { Ephemeris } from './ephemeris';
import { HorizonEnvelope } from './horizon';
import { HorizonProfile, discFraction, overlapFraction } from './visibility';

export interface Station {
  id: string;
  name: string;
  lat: number;
  lon: number;
  heightM: number;
}
export interface Hardware {
  arrayKw: number;
  loadKw: number;
  heaterKw: number;
  batteryKwh: number;
}
export interface Config {
  z: number; // mast height, m
  landerMask: number; // deg: station must clear the lander's terrain horizon by this much
  stationMask: number; // deg: Moon must be this high above the station's own horizon
  litThreshold: number; // disc fraction above which a step counts as "sunlit"
  hardware: Hardware;
  stepMin: number; // analysis step inside a mission window
}
export const DEFAULT_CONFIG: Config = {
  z: 2,
  landerMask: 2,
  stationMask: 10,
  litThreshold: 0.1,
  stepMin: 10,
  hardware: { arrayKw: 10, loadKw: 2, heaterKw: 1, batteryKwh: 20 }, // illustrative placeholders, editable in the UI
};

export type Quality = 'high' | 'medium' | 'coarse';
export interface SiteCtx {
  id: string;
  label: string;
  lat: number;
  lon: number;
  frame: Frame;
  posKm: [number, number, number];
  env: HorizonEnvelope;
  groundH: number;
  quality: Quality;
  regionId: string | null;
  slopeDeg: number;
}

interface StationVec {
  st: Station;
  ecef: number[];
  up: number[];
}
export function prepareStations(list: Station[]): StationVec[] {
  return list.map((st) => {
    const g = geodeticToEcef(st.lat, st.lon, st.heightM);
    return { st, ecef: g.pos, up: g.up };
  });
}

export interface StepState {
  sunAz: number;
  sunEl: number;
  sunR: number;
  earthAz: number;
  earthEl: number;
  earthR: number;
  fSun: number;
  fSunRaw: number;
  occ: number;
  fEarth: number;
  earthUp: number;
  mask: number;
}
export const newState = (): StepState => ({
  sunAz: 0,
  sunEl: 0,
  sunR: 0.2665,
  earthAz: 0,
  earthEl: 0,
  earthR: 0.95,
  fSun: 0,
  fSunRaw: 0,
  occ: 0,
  fEarth: 0,
  earthUp: 0,
  mask: 0,
});

const buf = new Float64Array(10),
  quat = buf.subarray(6, 10),
  tmp = new Float64Array(3),
  tmp2 = new Float64Array(3);

/** Evaluate Sun/Earth geometry, visibility and station passes at one instant. */
export function evalAt(
  site: SiteCtx,
  prof: HorizonProfile,
  eph: Ephemeris,
  sts: StationVec[],
  cfg: Config,
  t: number,
  o: StepState,
) {
  eph.at(t, buf);
  const O = site.posKm,
    { n, e, north } = site.frame;
  let vx = buf[0] - O[0],
    vy = buf[1] - O[1],
    vz = buf[2] - O[2],
    d = Math.hypot(vx, vy, vz);
  o.sunAz = wrap360(Math.atan2(vx * e[0] + vy * e[1] + vz * e[2], vx * north[0] + vy * north[1] + vz * north[2]) / DEG);
  o.sunEl = Math.asin((vx * n[0] + vy * n[1] + vz * n[2]) / d) / DEG;
  o.sunR = Math.asin(SUN_RADIUS_KM / d) / DEG;
  const sx = vx / d,
    sy = vy / d,
    sz = vz / d;
  o.fSunRaw = discFraction(prof, o.sunAz, o.sunEl, o.sunR, 9);
  vx = buf[3] - O[0];
  vy = buf[4] - O[1];
  vz = buf[5] - O[2];
  d = Math.hypot(vx, vy, vz);
  o.earthAz = wrap360(
    Math.atan2(vx * e[0] + vy * e[1] + vz * e[2], vx * north[0] + vy * north[1] + vz * north[2]) / DEG,
  );
  o.earthEl = Math.asin((vx * n[0] + vy * n[1] + vz * n[2]) / d) / DEG;
  o.earthR = Math.asin(EARTH_RADIUS_KM / d) / DEG;
  const ex = vx / d,
    ey = vy / d,
    ez = vz / d;
  o.fEarth = discFraction(prof, o.earthAz, o.earthEl, o.earthR, 17);
  o.earthUp = o.earthEl > prof.at(o.earthAz) ? 1 : 0;
  // Eclipse: Earth's disc covering the Sun
  const sep = Math.acos(Math.max(-1, Math.min(1, sx * ex + sy * ey + sz * ez))) / DEG;
  o.occ = sep < o.sunR + o.earthR ? overlapFraction(o.sunR, o.earthR, sep) : 0;
  o.fSun = o.fSunRaw * (1 - o.occ);
  // Station-resolved link: lander sees station above its terrain horizon by landerMask, station sees the Moon above stationMask.
  let mask = 0;
  if (o.earthEl + 2.5 > prof.min) {
    for (let i = 0; i < sts.length; i++) {
      const s = sts[i];
      quatRotate(quat, s.ecef, tmp);
      const px = buf[3] + tmp[0],
        py = buf[4] + tmp[1],
        pz = buf[5] + tmp[2]; // station position from Moon centre
      const wx = px - O[0],
        wy = py - O[1],
        wz = pz - O[2],
        wd = Math.hypot(wx, wy, wz);
      const az = wrap360(
        Math.atan2(wx * e[0] + wy * e[1] + wz * e[2], wx * north[0] + wy * north[1] + wz * north[2]) / DEG,
      );
      const el = Math.asin((wx * n[0] + wy * n[1] + wz * n[2]) / wd) / DEG;
      if (el - prof.at(az) < cfg.landerMask) continue;
      quatRotate(quat, s.up, tmp2);
      const sinEl = -(tmp2[0] * wx + tmp2[1] * wy + tmp2[2] * wz) / wd; // direction station -> site is -w
      if (Math.asin(sinEl) / DEG >= cfg.stationMask) mask |= 1 << i;
    }
  }
  o.mask = mask;
}

export interface Series {
  t0: number;
  stepMs: number;
  n: number;
  nStations: number;
  fSun: Float32Array;
  fRaw: Float32Array;
  fEarth: Float32Array;
  earthUp: Uint8Array;
  mask: Uint8Array;
  occ: Float32Array;
  sunAz: Float32Array;
  sunEl: Float32Array;
  earthAz: Float32Array;
  earthEl: Float32Array;
}

export function runSeries(
  site: SiteCtx,
  prof: HorizonProfile,
  eph: Ephemeris,
  sts: StationVec[],
  cfg: Config,
  t0: number,
  n: number,
  stepMs: number,
  light = false,
): Series {
  const S: Series = {
    t0,
    stepMs,
    n,
    nStations: sts.length,
    fSun: new Float32Array(n),
    fRaw: new Float32Array(n),
    fEarth: new Float32Array(n),
    earthUp: new Uint8Array(n),
    mask: new Uint8Array(n),
    occ: new Float32Array(n),
    sunAz: new Float32Array(light ? 0 : n),
    sunEl: new Float32Array(light ? 0 : n),
    earthAz: new Float32Array(light ? 0 : n),
    earthEl: new Float32Array(light ? 0 : n),
  };
  const st = newState();
  for (let i = 0; i < n; i++) {
    evalAt(site, prof, eph, sts, cfg, t0 + i * stepMs, st);
    S.fSun[i] = st.fSun;
    S.fRaw[i] = st.fSunRaw;
    S.fEarth[i] = st.fEarth;
    S.earthUp[i] = st.earthUp;
    S.mask[i] = st.mask;
    S.occ[i] = st.occ;
    if (!light) {
      S.sunAz[i] = st.sunAz;
      S.sunEl[i] = st.sunEl;
      S.earthAz[i] = st.earthAz;
      S.earthEl[i] = st.earthEl;
    }
  }
  return S;
}

export interface Pass {
  station: string;
  startMs: number;
  endMs: number;
}
export interface Summary {
  hours: number;
  sunPct: number;
  litPct: number;
  longestDarkH: number;
  longestLitH: number;
  darkStartMs: number | null;
  dtePct: number;
  longestOutageH: number;
  outageStartMs: number | null;
  earthUpPct: number;
  bothPct: number;
  passes: Pass[];
  passCounts: Record<string, number>;
  eclipseHours: number;
  soc: Float32Array;
  minSocPct: number;
  blackout: boolean;
  energyKwh: number;
}

function longestRun(flags: ArrayLike<number>, n: number, want: number): { len: number; start: number } {
  let best = 0,
    bs = -1,
    cur = 0,
    cs = 0;
  for (let i = 0; i < n; i++) {
    if (flags[i] === want) {
      if (cur === 0) cs = i;
      cur++;
      if (cur > best) {
        best = cur;
        bs = cs;
      }
    } else cur = 0;
  }
  return { len: best, start: bs };
}

export function summarize(S: Series, cfg: Config, stationIds: string[], from = 0, to = S.n): Summary {
  const n = to - from,
    dtH = S.stepMs / 3.6e6;
  const lit = new Uint8Array(n),
    link = new Uint8Array(n),
    soc = new Float32Array(n);
  let sun = 0,
    litN = 0,
    linkN = 0,
    up = 0,
    both = 0,
    ecl = 0;
  const hw = cfg.hardware;
  let e = hw.batteryKwh,
    minE = e,
    black = false,
    energy = 0;
  for (let i = 0; i < n; i++) {
    const f = S.fSun[from + i];
    sun += f;
    lit[i] = f > cfg.litThreshold ? 1 : 0;
    litN += lit[i];
    link[i] = S.mask[from + i] ? 1 : 0;
    linkN += link[i];
    up += S.earthUp[from + i];
    if (lit[i] && link[i]) both++;
    if (S.occ[from + i] > 0.01) ecl++;
    const p = hw.arrayKw * f - hw.loadKw - (f < 0.05 ? hw.heaterKw : 0);
    e = Math.min(hw.batteryKwh, e + p * dtH);
    if (e <= 0) {
      e = 0;
      black = true;
    }
    if (e < minE) minE = e;
    soc[i] = hw.batteryKwh > 0 ? (100 * e) / hw.batteryKwh : 0;
    energy += hw.arrayKw * f * dtH;
  }
  const dark = longestRun(lit, n, 0),
    sunny = longestRun(lit, n, 1),
    out = longestRun(link, n, 0);
  const passes: Pass[] = [],
    counts: Record<string, number> = {};
  for (let k = 0; k < S.nStations; k++) {
    counts[stationIds[k]] = 0;
    let start = -1;
    for (let i = 0; i <= n; i++) {
      const on = i < n && ((S.mask[from + i] >> k) & 1) === 1;
      if (on && start < 0) start = i;
      if (!on && start >= 0) {
        passes.push({
          station: stationIds[k],
          startMs: S.t0 + (from + start) * S.stepMs,
          endMs: S.t0 + (from + i) * S.stepMs,
        });
        counts[stationIds[k]]++;
        start = -1;
      }
    }
  }
  passes.sort((a, b) => a.startMs - b.startMs);
  return {
    hours: n * dtH,
    sunPct: (100 * sun) / n,
    litPct: (100 * litN) / n,
    longestDarkH: dark.len * dtH,
    longestLitH: sunny.len * dtH,
    darkStartMs: dark.start >= 0 ? S.t0 + (from + dark.start) * S.stepMs : null,
    dtePct: (100 * linkN) / n,
    longestOutageH: out.len * dtH,
    outageStartMs: out.start >= 0 ? S.t0 + (from + out.start) * S.stepMs : null,
    earthUpPct: (100 * up) / n,
    bothPct: (100 * both) / n,
    passes,
    passCounts: counts,
    eclipseHours: ecl * dtH,
    soc,
    minSocPct: hw.batteryKwh > 0 ? (100 * minE) / hw.batteryKwh : 0,
    blackout: black,
    energyKwh: energy,
  };
}

// Requirements
export interface Requirements {
  minSunPct?: number;
  maxDarkH?: number;
  minDtePct?: number;
  maxOutageH?: number;
  minBothPct?: number;
  noBlackout?: boolean;
}
export function checkRequirements(s: Summary, r: Requirements): { ok: boolean; failed: string[] } {
  const failed: string[] = [];
  if (r.minSunPct != null && s.sunPct < r.minSunPct) failed.push(`sunlit ${s.sunPct.toFixed(0)}% < ${r.minSunPct}%`);
  if (r.maxDarkH != null && s.longestDarkH > r.maxDarkH)
    failed.push(`${s.longestDarkH.toFixed(0)} h continuous darkness > ${r.maxDarkH} h`);
  if (r.minDtePct != null && s.dtePct < r.minDtePct)
    failed.push(`Earth link ${s.dtePct.toFixed(0)}% < ${r.minDtePct}%`);
  if (r.maxOutageH != null && s.longestOutageH > r.maxOutageH)
    failed.push(`${s.longestOutageH.toFixed(0)} h link outage > ${r.maxOutageH} h`);
  if (r.minBothPct != null && s.bothPct < r.minBothPct)
    failed.push(`power+link ${s.bothPct.toFixed(0)}% < ${r.minBothPct}%`);
  if (r.noBlackout && s.blackout) failed.push('battery is exhausted');
  return { ok: failed.length === 0, failed };
}

// Plain-language verdict, built from templates
const fmtUtc = (ms: number) => new Date(ms).toISOString().slice(5, 16).replace('T', ' ') + ' UTC';
export function verdict(
  s: Summary,
  days: number,
  band?: { sunLo: number; sunHi: number },
  mast?: number | null,
): string {
  const rng =
    band && band.sunHi - band.sunLo >= 1
      ? ` (${Math.min(band.sunLo, s.sunPct).toFixed(0)}–${Math.max(band.sunHi, s.sunPct).toFixed(0)}% across neighbouring cells)`
      : '';
  let t = `Sunlit ${s.sunPct.toFixed(0)}%${rng} of your ${days} day${days === 1 ? '' : 's'}.`;
  if (s.longestDarkH >= 1)
    t += ` Longest darkness ${s.longestDarkH.toFixed(0)} h${s.darkStartMs ? ' from ' + fmtUtc(s.darkStartMs) : ''}.`;
  else t += ' No significant darkness.';
  if (s.dtePct >= 99.5) t += ' Direct-to-Earth link available throughout.';
  else
    t += ` Direct-to-Earth link ${s.dtePct.toFixed(0)}% of the time; longest outage ${s.longestOutageH.toFixed(0)} h${s.outageStartMs ? ' from ' + fmtUtc(s.outageStartMs) : ''}.`;
  if (s.blackout) t += ' The default battery profile is exhausted.';
  if (mast != null && mast > 0) t += ` A ${mast.toFixed(1)} m mast meets your requirements.`;
  return t;
}

export function siteSlope(surface: (x: number, y: number) => number, x: number, y: number): number {
  const b = 30,
    zx = (surface(x + b, y) - surface(x - b, y)) / (2 * b),
    zy = (surface(x, y + b) - surface(x, y - b)) / (2 * b);
  return Math.atan(Math.hypot(zx, zy)) / DEG;
}

export const MS_DAY = 86_400_000;
