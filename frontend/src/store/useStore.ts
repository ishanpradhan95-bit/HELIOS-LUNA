import { create } from 'zustand';
import { EngineClient, AnalyzeResult, Band, Mast, MatrixRow, SolveRow } from '../math/client';
import type { Region, SiteRef } from '../math/engine';
import { buildCatalogue } from '../data/catalogue';
import { ArrayType, Config, DEFAULT_CONFIG, Requirements, Station } from '../math/analysis';
import { stationsFor, type Network } from '../data/networks';

export type Tab = 'pole' | 'compare' | 'sky' | 'map' | 'trust' | 'brief' | 'windows';
export type Mode = 'planner' | 'educator' | 'explorer';
export const DAY = 86_400_000;
export const client = new EngineClient();
export const BASE = new URL(import.meta.env.BASE_URL + 'assets/', location.href).href;

export interface UiState {
  ready: boolean;
  error: string | null;
  regions: Region[];
  stations: Station[];
  ephStart: number;
  ephEnd: number;
  tab: Tab;
  mode: Mode;
  arrival: number;
  matrixStart: number;
  duration: number;
  spanDays: number;
  z: number;
  landerMask: number;
  stationMask: number;
  litThreshold: number;
  hardware: Config['hardware'];
  req: Requirements;
  reqOn: boolean;
  profile: string;
  network: Network;
  customStations: Station[];
  drawer: null | 'profile' | 'learn';
  sites: SiteRef[];
  pinned: string[];
  selected: string;
  analyses: Record<string, AnalyzeResult>;
  analysisKeys: Record<string, string>;
  bandKeys: Record<string, string>;
  notice: string | null;
  busy: number;
  matrix: { rows: MatrixRow[]; ms: number; key: string; quality: Record<string, string> } | null;
  matrixMetric: 'sun' | 'dte' | 'both' | 'dark';
  bands: Record<string, Band>;
  mast: Record<string, Mast>;
  solve: { rows: SolveRow[]; screened: number; feasible: number; ms: number } | null;
  solving: boolean;
  cursor: number; // scrub time (ms)
  set(p: Partial<UiState>): void;
  config(): Config;
  init(): Promise<void>;
  refresh(): Promise<void>;
  runSolve(): Promise<void>;
  addSite(ref: SiteRef): void;
  removeSite(id: string): void;
  togglePin(id: string): void;
}

export const utcDay = (ms: number) => Math.floor(ms / DAY) * DAY;
export const timeOfDay = (ms: number) => ms - utcDay(ms);
export const MAX_STAY = 28;
const clamp = (v: number, lo: number, hi: number) => Math.min(Math.max(v, lo), hi);

/** Keep every window inside the baked ephemeris and keep the arrival visible in the matrix. */
function normalize(s: UiState, p: Partial<UiState>): Partial<UiState> {
  if (!s.ready && !p.ready) return p;
  const start = p.ephStart ?? s.ephStart,
    end = p.ephEnd ?? s.ephEnd;
  const lastDay = utcDay(end) - (MAX_STAY + 1) * DAY;
  const out = { ...p };
  const span = out.spanDays ?? s.spanDays;
  const lastMatrix = Math.max(start, lastDay - (span - 1) * DAY);
  if (out.arrival != null)
    out.arrival = clamp(Math.round(out.arrival / 60_000) * 60_000, utcDay(start + DAY - 1), lastDay);
  const arrival = out.arrival ?? s.arrival;
  let ms = out.matrixStart ?? s.matrixStart;
  if (out.arrival != null && (utcDay(arrival) < ms || utcDay(arrival) >= ms + span * DAY)) ms = arrival - 14 * DAY;
  ms = clamp(utcDay(ms), utcDay(start + DAY - 1), lastMatrix);
  if (ms !== s.matrixStart || out.matrixStart != null) out.matrixStart = ms;
  if (out.cursor != null) out.cursor = clamp(out.cursor, arrival, arrival + MAX_STAY * DAY);
  return out;
}
const key = (s: SiteRef) => `${s.id}@${s.lat.toFixed(4)},${s.lon.toFixed(4)}`;

/** Representative site per region: the candidate with the most published sunlit days (Wueller et al. 2026); the pick can be changed in the UI. */
function defaultSites(regions: Region[]): SiteRef[] {
  const out: SiteRef[] = [];
  for (const r of regions.filter((q) => !q.hidden)) {
    const best = [...r.sites].sort((a, b) => sum(b.publishedSunDays) - sum(a.publishedSunDays))[0];
    out.push({ id: best.id, label: `${r.name} · ${best.id}`, lat: best.lat, lon: best.lon });
  }
  return out;
}
const sum = (o?: Record<string, number>) => (o ? Object.values(o).reduce((a, b) => a + b, 0) : 0);

function readHash(): Record<string, string> {
  const o: Record<string, string> = {};
  new URLSearchParams(location.hash.slice(1)).forEach((v, k) => (o[k] = v));
  return o;
}

let refreshing = false,
  refreshAgain = false;

/** Identity of one analysis: site, window and every setting that changes its numbers. */
export function analysisKey(s: UiState, ref: SiteRef): string {
  return JSON.stringify([
    key(ref),
    s.arrival,
    s.duration,
    s.z,
    s.landerMask,
    s.stationMask,
    s.litThreshold,
    s.hardware,
    s.stations.map((x) => [x.id, x.lat, x.lon]),
  ]);
}
function matrixKey(s: UiState): string {
  return JSON.stringify([
    s.sites.map(key),
    s.matrixStart + timeOfDay(s.arrival),
    s.spanDays,
    s.duration,
    s.z,
    s.landerMask,
    s.stationMask,
    s.litThreshold,
    s.reqOn ? s.req : null,
    s.stations.map((x) => x.id),
  ]);
}

async function refreshOnce() {
  const get = useStore.getState,
    set = useStore.setState;
  const s = get();
  if (!s.ready) return;
  const cfg = s.config(),
    win = { startMs: s.arrival, days: s.duration };
  const want = new Set([...s.pinned, s.selected]);
  const refs = s.sites.filter((x) => want.has(x.id) && s.analysisKeys[x.id] !== analysisKey(s, x));
  if (refs.length) {
    const res = await Promise.all(refs.map((r) => client.analyze(r, win, cfg)));
    set((x) => {
      const analyses = { ...x.analyses },
        analysisKeys = { ...x.analysisKeys };
      refs.forEach((r, i) => {
        analyses[r.id] = res[i];
        analysisKeys[r.id] = analysisKey(s, r);
      });
      return { analyses, analysisKeys };
    });
  }
  const mkey = matrixKey(s);
  if (get().matrix?.key !== mkey) {
    const m = await client.matrix(
      s.sites,
      s.matrixStart + timeOfDay(s.arrival),
      s.spanDays,
      s.duration,
      cfg,
      s.reqOn ? s.req : undefined,
    );
    set({
      matrix: { rows: m.rows, ms: m.ms, key: mkey, quality: Object.fromEntries(m.meta.map((q) => [q.id, q.quality])) },
    });
  }
  // neighbour-cell band for the selected site (8 extra horizons the first time, cached afterwards)
  const sel = s.sites.find((x) => x.id === s.selected);
  if (sel && s.bandKeys[sel.id] !== analysisKey(s, sel)) {
    const b = await client.uncertainty(sel, win, cfg);
    set((x) => {
      const bands = { ...x.bands };
      if (b.n > 0) bands[sel.id] = b;
      else delete bands[sel.id];
      return { bands, bandKeys: { ...x.bandKeys, [sel.id]: analysisKey(s, sel) } };
    });
  }
}

export const useStore = create<UiState>((set, get) => ({
  ready: false,
  error: null,
  regions: [],
  stations: [],
  ephStart: 0,
  ephEnd: 0,
  tab: 'compare',
  mode: 'planner',
  arrival: utcDay(Date.now() + 30 * DAY),
  matrixStart: 0,
  duration: 7,
  spanDays: 120,
  z: 2,
  landerMask: DEFAULT_CONFIG.landerMask,
  stationMask: DEFAULT_CONFIG.stationMask,
  litThreshold: DEFAULT_CONFIG.litThreshold,
  hardware: DEFAULT_CONFIG.hardware,
  req: { minSunPct: 80, maxDarkH: 48, minDtePct: 30, maxOutageH: 120 },
  reqOn: true,
  profile: 'default',
  network: 'dsn',
  customStations: [],
  drawer: null,
  sites: [],
  pinned: [],
  selected: '',
  analyses: {},
  analysisKeys: {},
  bandKeys: {},
  notice: null,
  busy: 0,
  matrix: null,
  matrixMetric: 'sun',
  bands: {},
  mast: {},
  solve: null,
  solving: false,
  cursor: 0,
  set: (p) => {
    set((s) => normalize(s, p));
  },
  config: () => {
    const s = get();
    return {
      ...DEFAULT_CONFIG,
      z: s.z,
      landerMask: s.landerMask,
      stationMask: s.stationMask,
      litThreshold: s.litThreshold,
      hardware: s.hardware,
      stations: s.stations,
    };
  },
  async init() {
    try {
      const info = await client.init(BASE);
      const defs = defaultSites(info.regions),
        h = readHash();
      let sites = defs;
      if (h.s) {
        const cat = new Map<string, SiteRef>();
        for (const c of buildCatalogue(info.regions))
          cat.set(c.id, { id: c.id, label: c.label, lat: c.lat, lon: c.lon });
        const parsed: SiteRef[] = [];
        for (const tok of h.s.split(',')) {
          if (tok.startsWith('c_')) {
            const [la, lo] = tok.slice(2).split('_').map(Number);
            if (isFinite(la) && isFinite(lo))
              parsed.push({
                id: `Custom ${la.toFixed(3)} ${lo.toFixed(3)}`,
                label: `Custom ${la.toFixed(3)}°, ${lo.toFixed(3)}°`,
                lat: la,
                lon: lo,
              });
          } else if (cat.has(tok)) parsed.push(cat.get(tok)!);
        }
        if (parsed.length) sites = parsed;
      }
      const pa = h.a ? Date.parse(h.a.length > 10 ? h.a + 'Z' : h.a) : NaN,
        arrival = isFinite(pa) ? pa : get().arrival;
      const num = (k: string, lo: number, hi: number, dflt: number) =>
        h[k] != null && h[k] !== '' && isFinite(+h[k]) ? clamp(+h[k], lo, hi) : dflt;
      const optNum = (v: string | undefined, lo: number, hi: number) =>
        v == null || v === '' || !isFinite(+v) ? undefined : clamp(+v, lo, hi);
      const hw = (h.hw ?? '').split('_');
      const rq = h.rq != null ? h.rq.split('_') : null;
      const net = (['dsn', 'estrack', 'both', 'custom'].includes(h.net) ? h.net : 'dsn') as Network;
      const cs: Station[] = (h.cs ?? '')
        .split('~')
        .filter(Boolean)
        .map((t, i) => {
          const [name, la, lo] = t.split('_');
          return { id: `C-${i + 1}`, name: name || `Station ${i + 1}`, lat: +la, lon: +lo, heightM: 0 };
        })
        .filter((x) => isFinite(x.lat) && isFinite(x.lon));
      const selected = h.sel && sites.some((x) => x.id === h.sel) ? h.sel : sites[0].id;
      set((st) =>
        normalize(st, {
          ready: true,
          regions: info.regions,
          stations: stationsFor(net, cs),
          ephStart: info.ephStart,
          ephEnd: info.ephEnd,
          sites,
          arrival,
          matrixStart: h.ms && isFinite(Date.parse(h.ms)) ? Date.parse(h.ms) : arrival - 14 * DAY,
          spanDays: [60, 120, 180, 365].includes(+h.sp) ? +h.sp : 120,
          duration: Math.round(num('d', 1, MAX_STAY, 7)),
          z: num('z', 0, 50, 2),
          landerMask: num('lm', 0, 10, DEFAULT_CONFIG.landerMask),
          stationMask: num('sm', 0, 30, DEFAULT_CONFIG.stationMask),
          litThreshold: num('lt', 0, 0.95, DEFAULT_CONFIG.litThreshold),
          hardware:
            hw.length >= 4 && hw.slice(0, 4).every((x) => x !== '' && isFinite(+x))
              ? {
                  arrayKw: +hw[0],
                  loadKw: +hw[1],
                  heaterKw: +hw[2],
                  batteryKwh: +hw[3],
                  array: (['vtrack', 'horizontal', 'track2'].includes(hw[4]) ? hw[4] : 'vtrack') as ArrayType,
                }
              : DEFAULT_CONFIG.hardware,
          req:
            rq && rq.length === 5
              ? {
                  minSunPct: optNum(rq[0], 0, 100),
                  maxDarkH: optNum(rq[1], 0, 700),
                  minDtePct: optNum(rq[2], 0, 100),
                  maxOutageH: optNum(rq[3], 0, 700),
                  minBothPct: optNum(rq[4], 0, 100),
                }
              : get().req,
          reqOn: h.ro !== '0',
          matrixMetric: (['sun', 'dte', 'both', 'dark'].includes(h.mm) ? h.mm : 'sun') as UiState['matrixMetric'],
          tab: (['pole', 'compare', 'sky', 'map', 'trust', 'brief', 'windows'].includes(h.v) ? h.v : 'compare') as Tab,
          profile: h.pf ?? (h.rq != null ? 'custom' : 'default'),
          network: net,
          customStations: cs,
          mode: 'planner' as Mode,
          pinned: (h.p ? h.p.split(',') : sites.slice(0, 3).map((s) => s.id)).filter((id) =>
            sites.some((s) => s.id === id),
          ),
          selected,
          cursor: arrival + DAY,
        }),
      );
      await get().refresh();
    } catch (e: any) {
      set({ error: String(e?.message ?? e) });
    }
  },
  async refresh() {
    // latest wins: while a refresh is running, further requests collapse into one follow-up run
    if (refreshing) {
      refreshAgain = true;
      return;
    }
    refreshing = true;
    set((x) => ({ busy: x.busy + 1 }));
    try {
      do {
        refreshAgain = false;
        await refreshOnce();
      } while (refreshAgain);
    } catch (e: any) {
      set({ notice: String(e?.message ?? e) });
    } finally {
      refreshing = false;
      set((x) => ({ busy: x.busy - 1 }));
    }
  },
  async runSolve() {
    const s = get();
    set({ solving: true });
    try {
      const t = performance.now();
      const r = await client.solve(
        s.sites,
        s.matrixStart + timeOfDay(s.arrival),
        s.spanDays,
        s.duration,
        s.config(),
        s.req,
      );
      set({
        solve: { rows: r.results, screened: r.screened, feasible: r.feasibleAtMaxMast, ms: performance.now() - t },
      });
    } catch (e: any) {
      set({ notice: String(e?.message ?? e) });
    } finally {
      set({ solving: false });
    }
  },
  addSite(ref) {
    set((s) =>
      s.sites.some((x) => x.id === ref.id)
        ? { selected: ref.id }
        : { sites: [...s.sites, ref], selected: ref.id, pinned: [...s.pinned.slice(-3), ref.id] },
    );
  },
  removeSite(id) {
    set((s) => ({
      sites: s.sites.filter((x) => x.id !== id),
      pinned: s.pinned.filter((x) => x !== id),
      selected: s.selected === id ? (s.sites.find((x) => x.id !== id)?.id ?? '') : s.selected,
    }));
  },
  togglePin(id) {
    set((s) => ({ pinned: s.pinned.includes(id) ? s.pinned.filter((x) => x !== id) : [...s.pinned.slice(-3), id] }));
  },
}));

// URL hash <-> state: everything that changes a number is in the link, so a shared link reproduces the analysis.
export function stateToHash(s: UiState): string {
  const p = new URLSearchParams();
  const o = (v: number | undefined) => (v == null ? '' : String(v));
  p.set('v', s.tab);
  p.set('a', new Date(s.arrival).toISOString().slice(0, 16));
  p.set('d', String(s.duration));
  p.set('z', String(s.z));
  p.set(
    's',
    s.sites.map((x) => (x.id.startsWith('Custom') ? `c_${x.lat.toFixed(5)}_${x.lon.toFixed(5)}` : x.id)).join(','),
  );
  p.set('p', s.pinned.join(','));
  p.set('sel', s.selected);
  p.set('ms', new Date(s.matrixStart).toISOString().slice(0, 10));
  p.set('sp', String(s.spanDays));
  p.set('mm', s.matrixMetric);
  p.set('lm', String(s.landerMask));
  p.set('sm', String(s.stationMask));
  p.set('lt', String(s.litThreshold));
  const hw = s.hardware;
  p.set('hw', [hw.arrayKw, hw.loadKw, hw.heaterKw, hw.batteryKwh, hw.array ?? 'vtrack'].join('_'));
  const r = s.req;
  p.set('rq', [o(r.minSunPct), o(r.maxDarkH), o(r.minDtePct), o(r.maxOutageH), o(r.minBothPct)].join('_'));
  p.set('ro', s.reqOn ? '1' : '0');
  p.set('pf', s.profile);
  p.set('net', s.network);
  if (s.network === 'custom')
    p.set('cs', s.customStations.map((x) => `${x.name.replace(/[_~]/g, ' ')}_${x.lat}_${x.lon}`).join('~'));
  return p.toString();
}
