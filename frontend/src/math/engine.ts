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
import { Grid, DemMeta, Pyramid } from './dem';
import { Ephemeris, EphemerisMeta } from './ephemeris';
import { DEFAULT_MARCH, computeEnvelope } from './horizon';
import { HorizonProfile } from './visibility';
import { fromStereo, latLonFromN, siteFrame, toStereo, R_M } from './geo';
import stationsJson from '../data/stations.json';

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
  private pyr = new Map<string, Pyramid>();
  private ctxCache = new Map<string, SiteCtx>();
  private stVec = prepareStations(this.stations);
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
    return { region: null, quality: 'coarse' };
  }

  async pyramid(regionId: string | null): Promise<Pyramid> {
    const key = regionId ?? '_global';
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
    p = new Pyramid(regionId, near, mid, this.midGlobal, this.far);
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
    const pyr = await this.pyramid(region?.id ?? null);
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
      slopeDeg: siteSlope((a, b) => pyr.surfaceHeight(a, b), x, y),
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
  matrix(sites: SiteCtx[], startMs: number, days: number, durationDays: number, cfg: Config, req?: Requirements) {
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
    const [x, y] = toStereo(siteFrame(ref.lat, ref.lon).n),
      step = 120;
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

  /** Station-by-station detail of a single instant (used by the Sky view scrubber). */
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
