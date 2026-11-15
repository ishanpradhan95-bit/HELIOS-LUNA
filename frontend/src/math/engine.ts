import {
  Config,
  DEFAULT_CONFIG,
  MS_DAY,
  Requirements,
  SiteCtx,
  Station,
  Summary,
  checkRequirements,
  prepareStations,
  runSeries,
  siteSlope,
  summarize,
  newState,
  evalAt,
  Quality,
} from './analysis';
import { Grid, DemMeta, GlobalGrid, Pyramid } from './dem';
import { Ephemeris, EphemerisMeta } from './ephemeris';
import { DEFAULT_MARCH, computeEnvelope } from './horizon';
import { HorizonProfile } from './visibility';
import { fromStereo, latLonFromN, siteFrame, toStereo, R_M } from './geo';
import stationsJson from '../data/stations.json';

/** Slope (deg) from the global grid, central differences one cell (~1.9 km) apart in latitude and longitude. */
function globalSlope(pyr: Pyramid, lat: number, lon: number) {
  const g = pyr.global!,
    d = 1 / g.ppd,
    m = (d * Math.PI * 1737400) / 180,
    cl = Math.max(0.02, Math.cos((lat * Math.PI) / 180));
  const zx = (g.heightLL(lat, lon + d) - g.heightLL(lat, lon - d)) / (2 * m * cl),
    zy = (g.heightLL(lat + d, lon) - g.heightLL(lat - d, lon)) / (2 * m);
  return (Math.atan(Math.hypot(zx, zy)) * 180) / Math.PI;
}

export interface DataSource {
  json(path: string): Promise<any>;
  bin(path: string): Promise<ArrayBuffer>;
}
export interface CatalogSite {
  id: string;
  region: string;
  lat: number;
  lon: number;
  psrAreaM2?: number;
  publishedSunDays?: Record<string, number>;
  publishedSunEarthDays?: Record<string, number>;
}
export interface Region {
  id: string;
  name: string;
  lat: number;
  lon: number;
  cx: number;
  cy: number;
  artemis3: boolean;
  hidden?: boolean;
  sites: CatalogSite[];
}
export interface SiteRef {
  id: string;
  label: string;
  lat: number;
  lon: number;
}
export interface Window {
  startMs: number;
  days: number;
}

/** Everything numeric in the app comes from this class: point engine + analyses. Runs in a Web Worker or in Node. */
export class Engine {
  eph!: Ephemeris;
  dem!: DemMeta;
  regions: Region[] = [];
  stations: Station[] = stationsJson.stations;
  private far!: Grid;
  private midGlobal!: Grid;
  private globalGrid: Promise<GlobalGrid> | null = null;
  private pyr = new Map<string, Pyramid>();
  private ctxCache = new Map<string, SiteCtx>();
  private stVec = prepareStations(this.stations);
  private stKey = '';
  /** Switch the ground network (DSN, Estrack, custom); up to 8 stations. */
  setStations(list: Station[]) {
    const k = JSON.stringify(list);
    if (k === this.stKey || !list.length) return;
    this.stKey = k;
    this.stations = list.slice(0, 8);
    this.stVec = prepareStations(this.stations);
  }
  constructor(private src: DataSource) {}

  async init() {
    const [eMeta, dem, sites] = await Promise.all([
      this.src.json('ephemeris.json'),
      this.src.json('dem/dem.json'),
      this.src.json('sites.json'),
    ]);
    this.dem = dem;
    this.regions = sites.regions;
    const [eb, fb, mb] = await Promise.all([
      this.src.bin('ephemeris.bin'),
      this.src.bin(dem.grids.far.file),
      this.src.bin(dem.grids.mid_global.file),
    ]);
    this.eph = new Ephemeris(eMeta as EphemerisMeta, new Float32Array(eb));
    this.far = this.grid('far', fb);
    this.midGlobal = this.grid('mid_global', mb);
    return { regions: this.regions, stations: this.stations, ephStart: this.eph.start, ephEnd: this.eph.end };
  }
  /** Load an alternative baked ephemeris (e.g. 2010, for comparison with LROC imagery taken then). */
  async loadEphemeris(prefix: string): Promise<Ephemeris> {
    const [m, b] = await Promise.all([this.src.json(prefix + '.json'), this.src.bin(prefix + '.bin')]);
    return new Ephemeris(m as EphemerisMeta, new Float32Array(b));
  }
  private grid(name: string, b: ArrayBuffer) {
    const g = this.dem.grids[name];
    return new Grid(name, g.n, g.res, g.x0, g.y0, new Int16Array(b));
  }

  /** Region whose tiles serve this point best: the one whose 20 m near tile covers the observer with the most margin
   *  (regions overlap: Mons Mouton / Nobile Rim 1 are ~15 km apart, so nearest-centre is not good enough). */
  regionFor(lat: number, lon: number): { region: Region | null; quality: Quality } {
    const [x, y] = toStereo(siteFrame(lat, lon).n);
    const cand = this.regions.map((r) => {
      const g = this.dem.grids[r.id + '_near'],
        half = (((g?.n ?? 0) - 1) * (g?.res ?? 0)) / 2;
      return { r, res: g?.res ?? 1e9, m: half - Math.max(Math.abs(x - r.cx), Math.abs(y - r.cy)) };
    });
    // prefer the finest terrain that gives >= 2 km of margin around the observer; ties (overlapping regions) go to the larger margin
    const good = cand.filter((c) => c.m >= 2000).sort((a, b) => a.res - b.res || b.m - a.m);
    if (good.length) return { region: good[0].r, quality: 'high' };
    const med = cand.sort((a, b) => b.m - a.m)[0];
    if (med && med.m > -39000) return { region: med.r, quality: 'medium' }; // inside the 100 km, 120 m tile
    const half = (g: { n: number; res: number }) => ((g.n - 1) * g.res) / 2,
      inMid = Math.max(Math.abs(x), Math.abs(y)) < half(this.dem.grids.mid_global) - 2000;
    return { region: null, quality: inMid ? 'coarse' : 'global' };
  }
  /** True when a 300 km horizon march from (lat, lon) would leave the polar grids, so the global LOLA grid is needed. */
  needsGlobal(lat: number, lon: number) {
    const [x, y] = toStereo(siteFrame(lat, lon).n),
      far = this.dem.grids.far,
      half = ((far.n - 1) * far.res) / 2;
    return lat > 0 || Math.max(Math.abs(x), Math.abs(y)) + 310_000 > half;
  }
  private loadGlobal(): Promise<GlobalGrid> {
    const g = this.dem.grids.global;
    if (!g) return Promise.reject(new Error('global grid missing from dem.json; run npm run setup'));
    this.globalGrid ??= this.src.bin(g.file).then((b) => new GlobalGrid(g.ppd!, g.nLon!, g.nLat!, new Int16Array(b)));
    return this.globalGrid;
  }

  async pyramid(regionId: string | null, withGlobal = false): Promise<Pyramid> {
    const key = (regionId ?? '_polar') + (withGlobal ? '+global' : '');
    let p = this.pyr.get(key);
    if (p) return p;
    let near: Grid | null = null,
      mid: Grid | null = null;
    if (regionId) {
      const [nb, mb] = await Promise.all([
        this.src.bin(this.dem.grids[regionId + '_near'].file),
        this.src.bin(this.dem.grids[regionId + '_mid'].file),
      ]);
      near = this.grid(regionId + '_near', nb);
      mid = this.grid(regionId + '_mid', mb);
    }
    p = new Pyramid(regionId, near, mid, this.midGlobal, this.far, withGlobal ? await this.loadGlobal() : null);
    this.pyr.set(key, p);
    return p;
  }

  /** Build (or fetch) the site context: exact horizon envelope for 1440 azimuths out to 300 km. */
  async site(ref: SiteRef, opts: { naz?: number; maxDistM?: number; regionId?: string } = {}): Promise<SiteCtx> {
    const key = `${ref.lat.toFixed(5)},${ref.lon.toFixed(5)},${opts.naz ?? 1440},${opts.maxDistM ?? 300000},${opts.regionId ?? ''}`;
    const hit = this.ctxCache.get(key);
    if (hit) return { ...hit, id: ref.id, label: ref.label };
    const auto = this.regionFor(ref.lat, ref.lon);
    const region = opts.regionId ? (this.regions.find((r) => r.id === opts.regionId) ?? auto.region) : auto.region,
      quality = auto.quality;
    const pyr = await this.pyramid(region?.id ?? null, this.needsGlobal(ref.lat, ref.lon));
    const frame = siteFrame(ref.lat, ref.lon);
    const env = computeEnvelope(
      pyr,
      ref.lat,
      ref.lon,
      { ...DEFAULT_MARCH, naz: opts.naz ?? 1440, maxDistM: opts.maxDistM ?? 300_000 },
      frame,
    );
    const [x, y] = toStereo(frame.n);
    const r = (R_M + env.groundHeight) / 1000;
    const ctx: SiteCtx = {
      id: ref.id,
      label: ref.label,
      lat: ref.lat,
      lon: ref.lon,
      frame,
      posKm: [frame.n[0] * r, frame.n[1] * r, frame.n[2] * r],
      env,
      groundH: env.groundHeight,
      quality,
      regionId: region?.id ?? null,
      slopeDeg:
        quality === 'global' ? globalSlope(pyr, ref.lat, ref.lon) : siteSlope((a, b) => pyr.surfaceHeight(a, b), x, y),
    };
    this.ctxCache.set(key, ctx);
    return ctx;
  }

  profile(site: SiteCtx, z: number) {
    return new HorizonProfile(site.env.elevationDeg(Math.min(Math.max(z, 0), site.env.zmax)));
  }

  /** Full-detail analysis of one site over a mission window. */
  analyze(site: SiteCtx, win: Window, cfg: Config = DEFAULT_CONFIG) {
    const prof = this.profile(site, cfg.z);
    const stepMs = cfg.stepMin * 60_000,
      n = Math.round((win.days * MS_DAY) / stepMs);
    const series = runSeries(site, prof, this.eph, this.stVec, cfg, win.startMs, n, stepMs);
    const summary = summarize(
      series,
      cfg,
      this.stations.map((s) => s.id),
    );
    return { prof, series, summary };
  }

  /** Smallest mast height (m) at which the window meets the requirements. null = not achievable within the envelope range. */
  minMast(
    site: SiteCtx,
    win: Window,
    cfg: Config,
    req: Requirements,
  ): { z: number | null; atZero: ReturnType<typeof checkRequirements>; atMax: ReturnType<typeof checkRequirements> } {
    const coarse = { ...cfg, stepMin: Math.max(cfg.stepMin, 20) };
    const test = (z: number) => checkRequirements(this.analyze(site, win, { ...coarse, z }).summary, req);
    const atZero = test(0),
      atMax = test(site.env.zmax);
    if (atZero.ok) return { z: 0, atZero, atMax };
    if (!atMax.ok) return { z: null, atZero, atMax };
    let lo = 0,
      hi = site.env.zmax;
    for (let i = 0; i < 9; i++) {
      const mid = (lo + hi) / 2;
      if (test(mid).ok) hi = mid;
      else lo = mid;
    }
    return { z: hi, atZero, atMax };
  }

  /** Site x arrival-date matrix: per site, per arrival day, the window stats (hourly series reused across all days). */
  /** Number of whole arrival days from startMs whose stay of durationDays still ends inside the ephemeris. */
  fitDays(startMs: number, days: number, durationDays: number) {
    return Math.max(0, Math.min(days, Math.floor((this.eph.end - startMs) / MS_DAY) - durationDays));
  }

  matrix(sites: SiteCtx[], startMs: number, days: number, durationDays: number, cfg: Config, req?: Requirements) {
    days = this.fitDays(startMs, days, durationDays);
    const stepMs = 3_600_000,
      total = Math.round(((days + durationDays) * MS_DAY) / stepMs),
      w = Math.round((durationDays * MS_DAY) / stepMs);
    const ids = this.stations.map((s) => s.id);
    return sites.map((site) => {
      const prof = this.profile(site, cfg.z);
      const S = runSeries(site, prof, this.eph, this.stVec, cfg, startMs, total, stepMs, true);
      const sun = new Float32Array(days),
        dte = new Float32Array(days),
        both = new Float32Array(days),
        dark = new Float32Array(days),
        outage = new Float32Array(days),
        ok = new Uint8Array(days);
      for (let d = 0; d < days; d++) {
        const s = summarize(S, cfg, ids, d * 24, d * 24 + w);
        sun[d] = s.sunPct;
        dte[d] = s.dtePct;
        both[d] = s.bothPct;
        dark[d] = s.longestDarkH;
        outage[d] = s.longestOutageH;
        ok[d] = req ? (checkRequirements(s, req).ok ? 1 : 0) : 1;
      }
      return { id: site.id, sun, dte, both, dark, outage, ok };
    });
  }

  /** Tier-A uncertainty: the 8 neighbours one atlas cell (120 m) away; min-max of the headline numbers. */
  async uncertainty(ref: SiteRef, win: Window, cfg: Config) {
    const q = this.regionFor(ref.lat, ref.lon).quality;
    if (q === 'global')
      return {
        sun: [NaN, NaN],
        dte: [NaN, NaN],
        both: [NaN, NaN],
        dark: [NaN, NaN],
        outage: [NaN, NaN],
        n: 0,
      } as const;
    const [x, y] = toStereo(siteFrame(ref.lat, ref.lon).n),
      step = q === 'coarse' ? 240 : 120;
    const vals: Summary[] = [];
    for (let i = -1; i <= 1; i++)
      for (let j = -1; j <= 1; j++) {
        if (!i && !j) continue;
        const [la, lo] = latLonFromN(fromStereo(x + i * step, y + j * step));
        const s = await this.site({ id: ref.id + `~${i}${j}`, label: ref.label, lat: la, lon: lo });
        vals.push(this.analyze(s, win, { ...cfg, stepMin: Math.max(cfg.stepMin, 20) }).summary);
      }
    const mm = (f: (s: Summary) => number) => [Math.min(...vals.map(f)), Math.max(...vals.map(f))] as [number, number];
    return {
      sun: mm((s) => s.sunPct),
      dte: mm((s) => s.dtePct),
      both: mm((s) => s.bothPct),
      dark: mm((s) => s.longestDarkH),
      outage: mm((s) => s.longestOutageH),
      n: vals.length,
    };
  }

  /** 19-year context: mean sunlit % and link % by calendar year (3-hourly sampling). */
  longTerm(site: SiteCtx, cfg: Config) {
    const prof = this.profile(site, cfg.z),
      stepMs = 3 * 3_600_000,
      n = Math.floor((this.eph.end - this.eph.start) / stepMs);
    const S = runSeries(site, prof, this.eph, this.stVec, cfg, this.eph.start, n, stepMs, true);
    const y0 = new Date(this.eph.start).getUTCFullYear(),
      years: { year: number; sun: number; dte: number }[] = [];
    const ids = this.stations.map((s) => s.id);
    for (let y = y0; y < y0 + 19; y++) {
      const a = Math.max(0, Math.floor((Date.UTC(y, 0, 1) - this.eph.start) / stepMs)),
        b = Math.min(n, Math.floor((Date.UTC(y + 1, 0, 1) - this.eph.start) / stepMs));
      if (b - a < 10) continue;
      const s = summarize(S, cfg, ids, a, b);
      years.push({ year: y, sun: s.sunPct, dte: s.dtePct });
    }
    return years;
  }

  /** Requirements-first solver: screens at the tallest mast, then finds the exact minimum mast for the best candidates. */
  solve(
    sites: SiteCtx[],
    startMs: number,
    days: number,
    durationDays: number,
    cfg: Config,
    req: Requirements,
    maxResults = 12,
  ) {
    days = this.fitDays(startMs, days, durationDays);
    const cands: { site: SiteCtx; day: number; slack: number }[] = [];
    const ids = this.stations.map((s) => s.id);
    const stepMs = 3_600_000,
      total = Math.round(((days + durationDays) * MS_DAY) / stepMs),
      w = Math.round((durationDays * MS_DAY) / stepMs);
    for (const site of sites) {
      const best = { ...cfg, z: site.env.zmax };
      const S = runSeries(site, this.profile(site, best.z), this.eph, this.stVec, best, startMs, total, stepMs, true);
      for (let d = 0; d < days; d++) {
        const s = summarize(S, best, ids, d * 24, d * 24 + w);
        if (checkRequirements(s, req).ok)
          cands.push({ site, day: d, slack: s.sunPct + s.dtePct - s.longestDarkH - s.longestOutageH });
      }
    }
    cands.sort((a, b) => b.slack - a.slack);
    // keep the best arrival per site first so the list is diverse, then fill
    const seen = new Set<string>(),
      pick: typeof cands = [];
    for (const c of cands)
      if (!seen.has(c.site.id)) {
        seen.add(c.site.id);
        pick.push(c);
      }
    for (const c of cands) if (pick.length < maxResults * 2 && !pick.includes(c)) pick.push(c);
    const out = pick
      .slice(0, maxResults * 2)
      .map((c) => {
        const win = { startMs: startMs + c.day * MS_DAY, days: durationDays };
        const m = this.minMast(c.site, win, cfg, req);
        const at = this.analyze(c.site, win, {
          ...cfg,
          z: m.z ?? c.site.env.zmax,
          stepMin: Math.max(cfg.stepMin, 20),
        }).summary;
        return {
          siteId: c.site.id,
          label: c.site.label,
          arrivalMs: win.startMs,
          minMastM: m.z,
          sunPct: at.sunPct,
          dtePct: at.dtePct,
          darkH: at.longestDarkH,
          outageH: at.longestOutageH,
        };
      })
      .filter((r) => r.minMastM != null);
    out.sort((a, b) => a.minMastM! - b.minMastM! || b.sunPct - a.sunPct);
    return { results: out.slice(0, maxResults), screened: sites.length * days, feasibleAtMaxMast: cands.length };
  }

  /**
   * Operations clock at time t: for the Sun (disc above the lit threshold), the Earth (centre above the terrain) and the
   * link (any station), the current state and the next two transitions, searched at 10-minute steps up to `lookaheadDays`
   * ahead and refined by bisection to under a minute. Terrain-aware, mast height as configured.
   */
  events(site: SiteCtx, cfg: Config, t: number, lookaheadDays = 45) {
    const prof = this.profile(site, cfg.z),
      st = newState();
    const look = (tt: number) => {
      evalAt(site, prof, this.eph, this.stVec, cfg, tt, st);
      return [st.fSun > cfg.litThreshold, st.earthUp === 1, st.mask !== 0] as const;
    };
    const end = Math.min(this.eph.end, t + lookaheadDays * MS_DAY),
      step = 10 * 60_000;
    const now = look(t);
    evalAt(site, prof, this.eph, this.stVec, cfg, t, st);
    const at = {
      sunEl: st.sunEl,
      sunAz: st.sunAz,
      earthEl: st.earthEl,
      earthAz: st.earthAz,
      fSun: st.fSun,
      mask: st.mask,
    };
    const next: (number | null)[][] = [[], [], []];
    let prev = now.slice() as boolean[],
      tp = t;
    for (let tt = t + step; tt <= end && next.some((n) => n.length < 2); tt += step) {
      const cur = look(tt);
      for (let k = 0; k < 3; k++)
        if (cur[k] !== prev[k] && next[k].length < 2) {
          let a = tp,
            b = tt;
          while (b - a > 30_000) {
            const m = (a + b) / 2;
            if (look(m)[k] === prev[k]) a = m;
            else b = m;
          }
          next[k].push(Math.round((a + b) / 2));
        }
      prev = cur.slice() as boolean[];
      tp = tt;
    }
    const ch = (k: number) => ({ up: now[k], next: next[k][0] ?? null, then: next[k][1] ?? null });
    return { t, searchedTo: end, sun: ch(0), earth: ch(1), link: ch(2), at };
  }

  /** Station-by-station detail of a single instant (used by the Sky view scrubber). */
  /**
   * Landing windows: every touchdown hour in [startMs, startMs + days) at which
   *  - the Sun is visible (> half the disc) at an elevation in [sunElMin, sunElMax] (lighting for landing cameras),
   *  - a ground station has the lander in view for the whole descent (descentH hours before touchdown, and at it),
   *  - the surface stay that follows meets the requirements,
   * grouped into contiguous windows. Hourly sampling; window edges are good to the hour.
   */
  windows(
    site: SiteCtx,
    cfg: Config,
    req: Requirements,
    startMs: number,
    days: number,
    durationDays: number,
    opt: { sunElMin: number; sunElMax: number; descentH: number },
  ) {
    const step = 3_600_000,
      pre = Math.max(0, Math.ceil(opt.descentH)),
      t0 = Math.max(this.eph.start, startMs - pre * step);
    days = this.fitDays(t0, days, durationDays);
    const total = Math.round(((days + durationDays) * MS_DAY) / step) + pre,
      w = Math.round((durationDays * MS_DAY) / step);
    const S = runSeries(site, this.profile(site, cfg.z), this.eph, this.stVec, cfg, t0, total, step, true);
    const ids = this.stations.map((x) => x.id);
    const hours = Math.round((days * MS_DAY) / step);
    const out: {
      startMs: number;
      endMs: number;
      sunElMin: number;
      sunElMax: number;
      bestSun: number;
      bestDte: number;
    }[] = [];
    let cur: (typeof out)[number] | null = null;
    for (let h = pre; h < pre + hours && h + w <= S.n; h++) {
      let ok = S.fSun[h] > 0.5 && S.sunEl[h] >= opt.sunElMin && S.sunEl[h] <= opt.sunElMax;
      for (let k = h - pre; ok && k <= h; k++) if (!S.mask[k]) ok = false;
      let sm: Summary | null = null;
      if (ok) {
        sm = summarize(S, cfg, ids, h, h + w);
        ok = checkRequirements(sm, req).ok;
      }
      const t = S.t0 + h * step;
      if (ok && sm) {
        if (!cur)
          out.push(
            (cur = { startMs: t, endMs: t + step, sunElMin: S.sunEl[h], sunElMax: S.sunEl[h], bestSun: 0, bestDte: 0 }),
          );
        cur.endMs = t + step;
        cur.sunElMin = Math.min(cur.sunElMin, S.sunEl[h]);
        cur.sunElMax = Math.max(cur.sunElMax, S.sunEl[h]);
        cur.bestSun = Math.max(cur.bestSun, sm.sunPct);
        cur.bestDte = Math.max(cur.bestDte, sm.dtePct);
      } else cur = null;
    }
    return { windows: out, searchedFrom: S.t0 + pre * step, searchedTo: S.t0 + (pre + hours) * step };
  }

  /**
   * Landing-zone analysis: points on a grid inside a circle of diameter `diameterM` around the site, each with its
   * own slope (from the finest terrain, ±30 m) and its own horizon (360 azimuths to 300 km) and stay summary.
   */
  async zone(ref: SiteRef, win: Window, cfg: Config, req: Requirements, diameterM: number, perSide = 7) {
    const R = R_M,
      lat0 = ref.lat * (Math.PI / 180);
    const pts: {
      dx: number;
      dy: number;
      lat: number;
      lon: number;
      slope: number;
      sun: number;
      dte: number;
      dark: number;
      outage: number;
      ok: boolean;
    }[] = [];
    const half = diameterM / 2,
      stepM = diameterM / (perSide - 1 || 1);
    for (let i = 0; i < perSide; i++)
      for (let j = 0; j < perSide; j++) {
        const dx = -half + i * stepM,
          dy = -half + j * stepM;
        if (Math.hypot(dx, dy) > half + 1e-6) continue;
        const lat = ref.lat + (dy / R) * (180 / Math.PI),
          lon = ref.lon + (dx / (R * Math.max(0.02, Math.cos(lat0)))) * (180 / Math.PI);
        const site = await this.site({ id: `${ref.id}~z${i}${j}`, label: ref.label, lat, lon }, { naz: 360 });
        const s = this.analyze(site, win, { ...cfg, stepMin: Math.max(cfg.stepMin, 30) }).summary;
        pts.push({
          dx,
          dy,
          lat,
          lon,
          slope: site.slopeDeg,
          sun: s.sunPct,
          dte: s.dtePct,
          dark: s.longestDarkH,
          outage: s.longestOutageH,
          ok: checkRequirements(s, req).ok,
        });
      }
    const q = this.regionFor(ref.lat, ref.lon).quality;
    return { points: pts, diameterM, quality: q };
  }

  instant(site: SiteCtx, cfg: Config, t: number) {
    const st = newState();
    evalAt(site, this.profile(site, cfg.z), this.eph, this.stVec, cfg, t, st);
    return st;
  }
  /** Per-step Sun unit vector + radius and Earth position (km) + radius, for the GPU area engine. Float32 x 8 per step. */
  bodies(startMs: number, n: number, stepMs: number): Float32Array {
    const out = new Float32Array(n * 8),
      b = new Float64Array(10);
    for (let i = 0; i < n; i++) {
      this.eph.at(startMs + i * stepMs, b);
      const ds = Math.hypot(b[0], b[1], b[2]),
        de = Math.hypot(b[3], b[4], b[5]);
      out.set(
        [
          b[0] / ds,
          b[1] / ds,
          b[2] / ds,
          (Math.asin(695700 / ds) * 180) / Math.PI,
          b[3],
          b[4],
          b[5],
          (Math.asin(6371 / de) * 180) / Math.PI,
        ],
        i * 8,
      );
    }
    return out;
  }
}
