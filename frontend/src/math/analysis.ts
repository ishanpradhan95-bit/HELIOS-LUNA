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
/** Solar-array geometry: 'vtrack' vertical array turning to face the Sun's azimuth (typical for polar landers),
 *  'horizontal' fixed flat array (typical at low latitudes), 'track2' two-axis tracking (always normal to the Sun). */
export type ArrayType = 'vtrack' | 'horizontal' | 'track2';
export interface Hardware {
  array?: ArrayType;
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
  stations?: Station[]; // ground network; the engine's default (DSN) when absent
}
export const DEFAULT_CONFIG: Config = {
  z: 2,
  landerMask: 2,
  stationMask: 10,
  litThreshold: 0.1,
  stepMin: 10,
  // illustrative placeholders, editable in the UI: the battery carries the night load (load + heater) for 50 h
  hardware: { array: 'vtrack', arrayKw: 3, loadKw: 0.6, heaterKw: 0.4, batteryKwh: 50 },
};

export type Quality = 'high' | 'medium' | 'coarse' | 'global';
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

export interface StationVec {
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
  tmp = new Float64Array(3),
  tmp2 = new Float64Array(3);

export interface Look {
  landerAz: number; // station azimuth seen from the lander, deg from north through east
  landerEl: number; // station elevation above the lander's horizontal plane, deg
  stationEl: number; // lander elevation above the station's geodetic horizontal plane, deg
}
const look: Look = { landerAz: 0, landerEl: 0, stationEl: 0 },
  qb = new Float64Array(4);

/** Station <-> lander geometry from one ephemeris record (rec = eph.at output: Earth vector at 3..5, ITRF93->MOON_ME quaternion at 6..9). */
export function stationLook(
  s: StationVec,
  rec: ArrayLike<number>,
  site: Pick<SiteCtx, 'posKm' | 'frame'>,
  out: Look = { landerAz: 0, landerEl: 0, stationEl: 0 },
): Look {
  const O = site.posKm,
    { n, e, north } = site.frame,
    q = qb;
  q[0] = rec[6];
  q[1] = rec[7];
  q[2] = rec[8];
  q[3] = rec[9];
  quatRotate(q, s.ecef, tmp);
  // station position from the lander = (Earth centre + station offset, both from the Moon centre) - lander position
  const wx = rec[3] + tmp[0] - O[0],
    wy = rec[4] + tmp[1] - O[1],
    wz = rec[5] + tmp[2] - O[2],
    wd = Math.hypot(wx, wy, wz);
  out.landerAz = wrap360(
    Math.atan2(wx * e[0] + wy * e[1] + wz * e[2], wx * north[0] + wy * north[1] + wz * north[2]) / DEG,
  );
  out.landerEl = Math.asin((wx * n[0] + wy * n[1] + wz * n[2]) / wd) / DEG;
  quatRotate(q, s.up, tmp2);
  out.stationEl = Math.asin(-(tmp2[0] * wx + tmp2[1] * wy + tmp2[2] * wz) / wd) / DEG; // station -> lander is -w
  return out;
}

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
  // Every station lies within the Earth's angular radius of the Earth's centre, so skip when even the limb cannot clear the mask.
  let mask = 0;
  if (o.earthEl + o.earthR + 0.01 >= prof.min + cfg.landerMask) {
    for (let i = 0; i < sts.length; i++) {
      stationLook(sts[i], buf, site, look);
      if (look.landerEl - prof.at(look.landerAz) < cfg.landerMask) continue;
      if (look.stationEl >= cfg.stationMask) mask |= 1 << i;
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
  sunR: Float32Array;
  earthR: Float32Array;
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
    sunEl: new Float32Array(n),
    earthAz: new Float32Array(light ? 0 : n),
    earthEl: new Float32Array(n),
    sunR: new Float32Array(light ? 0 : n),
    earthR: new Float32Array(light ? 0 : n),
  };
  if (n > 0 && (t0 < eph.start || t0 + (n - 1) * stepMs > eph.end))
    throw new RangeError(
      `Window ${new Date(t0).toISOString()} + ${(((n - 1) * stepMs) / MS_DAY).toFixed(1)} d is outside the ephemeris ` +
        `(${new Date(eph.start).toISOString().slice(0, 10)} to ${new Date(eph.end).toISOString().slice(0, 10)})`,
    );
  const st = newState();
  for (let i = 0; i < n; i++) {
    evalAt(site, prof, eph, sts, cfg, t0 + i * stepMs, st);
    S.fSun[i] = st.fSun;
    S.fRaw[i] = st.fSunRaw;
    S.fEarth[i] = st.fEarth;
    S.earthUp[i] = st.earthUp;
    S.mask[i] = st.mask;
    S.occ[i] = st.occ;
    S.sunEl[i] = st.sunEl;
    S.earthEl[i] = st.earthEl;
    if (!light) {
      S.sunAz[i] = st.sunAz;
      S.earthAz[i] = st.earthAz;
      S.sunR[i] = st.sunR;
      S.earthR[i] = st.earthR;
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
  flatAtMs: number | null;
  energyKwh: number;
  /** solar elevation (deg): maximum over the stay, and mean while the Sun is usable */
  sunElMax: number;
  sunElMeanLit: number;
  /** Earth elevation (deg): maximum, and mean while Earth's centre is above the terrain */
  earthElMax: number;
  earthElMeanUp: number;
  /** mean array output as a fraction of rated (geometry x visible disc), the power-generation potential */
  powerFactor: number;
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

/** Output of a unit array for a Sun at elevation el (deg), before terrain: cosine of the incidence angle. */
export function arrayGain(type: ArrayType, el: number): number {
  const e = Math.max(-1, Math.min(90, el)) * DEG;
  return type === 'horizontal' ? Math.max(0, Math.sin(e)) : type === 'track2' ? 1 : Math.cos(e);
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
    flatAt: number | null = null,
    energy = 0,
    pf = 0,
    elMax = -90,
    eMax = -90,
    elLit = 0,
    nLit = 0,
    eUp = 0,
    nUp = 0;
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
    const el = S.sunEl[from + i],
      ee = S.earthEl[from + i];
    const g = arrayGain(hw.array ?? 'vtrack', el),
      out = f * g;
    pf += out;
    if (el > elMax) elMax = el;
    if (ee > eMax) eMax = ee;
    if (lit[i]) {
      elLit += el;
      nLit++;
    }
    if (S.earthUp[from + i]) {
      eUp += ee;
      nUp++;
    }
    const p = hw.arrayKw * out - hw.loadKw - (f < 0.05 ? hw.heaterKw : 0);
    e = Math.min(hw.batteryKwh, e + p * dtH);
    if (e < -1e-9) {
      // demand this step could not be met from array + battery
      e = 0;
      if (!black) flatAt = S.t0 + (from + i) * S.stepMs;
      black = true;
    } else if (e < 0) e = 0;
    if (e < minE) minE = e;
    soc[i] = hw.batteryKwh > 0 ? (100 * e) / hw.batteryKwh : 0;
    energy += hw.arrayKw * out * dtH;
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
    flatAtMs: flatAt,
    energyKwh: energy,
    sunElMax: elMax,
    sunElMeanLit: nLit ? elLit / nLit : NaN,
    earthElMax: eMax,
    earthElMeanUp: nUp ? eUp / nUp : NaN,
    powerFactor: n ? pf / n : 0,
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
const dur = (h: number) =>
  h >= 48 ? `${(h / 24).toFixed(1)} days` : h >= 1 ? `${h.toFixed(0)} h` : `${Math.round(h * 60)} min`;
export function verdict(
  s: Summary,
  days: number,
  band?: { sunLo: number; sunHi: number },
  mast?: number | null,
): string {
  const stay = `${days} day${days === 1 ? '' : 's'}`;
  const rng =
    band && band.sunHi - band.sunLo >= 1
      ? ` (${Math.min(band.sunLo, s.sunPct).toFixed(0)}–${Math.max(band.sunHi, s.sunPct).toFixed(0)}% across neighbouring cells)`
      : '';
  const allDark = s.litPct === 0;
  let t = allDark
    ? `No usable sunlight during your ${stay}${rng ? rng.replace(' across', ' sunlit across') : ''}.`
    : `Sunlit ${s.sunPct.toFixed(0)}%${rng} of your ${stay}.`;
  if (!allDark) {
    if (s.longestDarkH >= 1)
      t += ` Longest darkness ${dur(s.longestDarkH)}${s.darkStartMs ? ' from ' + fmtUtc(s.darkStartMs) : ''}.`;
    else t += ' No darkness longer than an hour.';
  }
  if (s.dtePct >= 99.5) t += ' Direct-to-Earth link available throughout.';
  else if (s.dtePct === 0) t += ' No Deep Space Network station can reach this spot during the stay.';
  else
    t += ` Direct-to-Earth link ${s.dtePct.toFixed(0)}% of the time; longest outage ${dur(s.longestOutageH)}${s.outageStartMs ? ' from ' + fmtUtc(s.outageStartMs) : ''}.`;
  if (s.blackout)
    t += ` With the mission profile's power assumptions, the battery runs flat${s.flatAtMs ? ' at ' + fmtUtc(s.flatAtMs) : ''}.`;
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

export type Grade = 'go' | 'check' | 'nogo';
/**
 * GO: every requirement met with margin. CHECK: met, but within ~10% of a limit (5 points for percentages).
 * NO-GO: at least one requirement fails. Reasons are plain-language strings for the UI.
 */
export function grade(s: Summary, r: Requirements): { grade: Grade; reasons: string[] } {
  const fail = checkRequirements(s, r);
  if (!fail.ok) return { grade: 'nogo', reasons: fail.failed };
  const close: string[] = [];
  if (r.minSunPct != null && s.sunPct < r.minSunPct + 5)
    close.push(`sunlit ${s.sunPct.toFixed(0)}% is near the ${r.minSunPct}% limit`);
  if (r.maxDarkH != null && r.maxDarkH > 0 && s.longestDarkH > r.maxDarkH * 0.9)
    close.push(`${s.longestDarkH.toFixed(0)} h dark is near the ${r.maxDarkH} h limit`);
  if (r.minDtePct != null && s.dtePct < r.minDtePct + 5)
    close.push(`link ${s.dtePct.toFixed(0)}% is near the ${r.minDtePct}% limit`);
  if (r.maxOutageH != null && r.maxOutageH > 0 && s.longestOutageH > r.maxOutageH * 0.9)
    close.push(`${s.longestOutageH.toFixed(0)} h outage is near the ${r.maxOutageH} h limit`);
  if (r.minBothPct != null && s.bothPct < r.minBothPct + 5)
    close.push(`power + link ${s.bothPct.toFixed(0)}% is near the limit`);
  return close.length ? { grade: 'check', reasons: close } : { grade: 'go', reasons: [] };
}

/** Mission profiles: requirements + stay length. Sources are stated so presets are never mistaken for official limits. */
export const PROFILES: {
  id: string;
  name: string;
  source: string;
  duration: number;
  req: Requirements;
}[] = [
  {
    id: 'artemis',
    name: 'Artemis III-like crew stay',
    source:
      'NASA site criteria: continuous sunlight for a ~6.5-day surface stay and Earth visible for direct-to-Earth links (link thresholds here are illustrative).',
    duration: 7,
    req: { maxDarkH: 0, minSunPct: 90, minDtePct: 25 },
  },
  {
    id: 'clps',
    name: 'Small CLPS lander, 14 days',
    source: 'Illustrative: a solar-powered lander that must ride out short dark spells and keep regular contact.',
    duration: 14,
    req: { minSunPct: 60, maxDarkH: 48, minDtePct: 30, maxOutageH: 72 },
  },
  {
    id: 'default',
    name: 'General first look',
    source: 'The tool’s defaults: mostly sunlit, short darkness, some contact.',
    duration: 7,
    req: { minSunPct: 80, maxDarkH: 48, minDtePct: 30, maxOutageH: 120 },
  },
];
