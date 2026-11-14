import { create } from 'zustand';
import { EngineClient, AnalyzeResult, Band, Mast, MatrixRow, SolveRow } from '../math/client';
import type { Region, SiteRef } from '../math/engine';
import { Config, DEFAULT_CONFIG, Requirements, Station } from '../math/analysis';

export type Tab = 'compare' | 'sky' | 'map' | 'trust';
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
  sites: SiteRef[];
  pinned: string[];
  selected: string;
  analyses: Record<string, AnalyzeResult>;
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

const utcDay = (ms: number) => Math.floor(ms / DAY) * DAY;
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
  reqOn: false,
  sites: [],
  pinned: [],
  selected: '',
  analyses: {},
  busy: 0,
  matrix: null,
  matrixMetric: 'sun',
  bands: {},
  mast: {},
  solve: null,
  solving: false,
  cursor: 0,
  set: (p) => {
    set(p);
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
        for (const r of info.regions)
          for (const s of r.sites) cat.set(s.id, { id: s.id, label: `${r.name} · ${s.id}`, lat: s.lat, lon: s.lon });
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
      const arrival = h.a && isFinite(Date.parse(h.a)) ? utcDay(Date.parse(h.a)) : get().arrival;
      const clamped = Math.min(Math.max(arrival, info.ephStart), info.ephEnd - 200 * DAY);
      set({
        ready: true,
        regions: info.regions,
        stations: info.stations,
        ephStart: info.ephStart,
        ephEnd: info.ephEnd,
        sites,
        arrival: clamped,
        matrixStart: clamped,
        duration: h.d ? Math.min(28, Math.max(1, +h.d)) : 7,
        z: h.z ? Math.min(50, Math.max(0, +h.z)) : 2,
        tab: (['compare', 'sky', 'map', 'trust'].includes(h.v) ? h.v : 'compare') as Tab,
        mode: (['planner', 'educator', 'explorer'].includes(h.m) ? h.m : 'planner') as Mode,
        pinned: (h.p ? h.p.split(',') : sites.slice(0, 3).map((s) => s.id)).filter((id) =>
          sites.some((s) => s.id === id),
        ),
        selected: sites[0].id,
        cursor: clamped + 1 * DAY,
      });
      await get().refresh();
    } catch (e: any) {
      set({ error: String(e?.message ?? e) });
    }
  },
  async refresh() {
    const s = get();
    if (!s.ready) return;
    const cfg = s.config(),
      win = { startMs: s.arrival, days: s.duration };
    const mkey = JSON.stringify([
      s.sites.map(key),
      s.matrixStart,
      s.spanDays,
      s.duration,
      cfg.z,
      cfg.landerMask,
      cfg.stationMask,
      cfg.litThreshold,
      s.reqOn ? s.req : null,
    ]);
    set((x) => ({ busy: x.busy + 1 }));
    try {
      const want = new Set([...s.pinned, s.selected]);
      const refs = s.sites.filter((x) => want.has(x.id));
      const res = await Promise.all(refs.map((r) => client.analyze(r, win, cfg)));
      const analyses = { ...get().analyses };
      refs.forEach((r, i) => (analyses[r.id] = res[i]));
      set({ analyses });
      if (get().matrix?.key !== mkey) {
        const m = await client.matrix(s.sites, s.matrixStart, s.spanDays, s.duration, cfg, s.reqOn ? s.req : undefined);
        if (
          JSON.stringify([
            get().sites.map(key),
            get().matrixStart,
            get().spanDays,
            get().duration,
            get().z,
            get().landerMask,
            get().stationMask,
            get().litThreshold,
            get().reqOn ? get().req : null,
          ]) === mkey
        )
          set({
            matrix: {
              rows: m.rows,
              ms: m.ms,
              key: mkey,
              quality: Object.fromEntries(m.meta.map((q) => [q.id, q.quality])),
            },
          });
      }
      // background extras for the selected site
      const sel = get().sites.find((x) => x.id === get().selected);
      if (sel) {
        client
          .uncertainty(sel, win, cfg)
          .then((b) => set((x) => ({ bands: { ...x.bands, [sel.id]: b } })))
          .catch(() => {});
      }
    } catch (e: any) {
      set({ error: String(e?.message ?? e) });
    } finally {
      set((x) => ({ busy: x.busy - 1 }));
    }
  },
  async runSolve() {
    const s = get();
    set({ solving: true });
    try {
      const t = performance.now();
      const r = await client.solve(s.sites, s.matrixStart, s.spanDays, s.duration, s.config(), s.req);
      set({
        solve: { rows: r.results, screened: r.screened, feasible: r.feasibleAtMaxMast, ms: performance.now() - t },
      });
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

// URL hash <-> state
export function stateToHash(s: UiState): string {
  const p = new URLSearchParams();
  p.set('v', s.tab);
  p.set('m', s.mode);
  p.set('a', new Date(s.arrival).toISOString().slice(0, 10));
  p.set('d', String(s.duration));
  p.set('z', String(s.z));
  p.set(
    's',
    s.sites.map((x) => (x.id.startsWith('Custom') ? `c_${x.lat.toFixed(4)}_${x.lon.toFixed(4)}` : x.id)).join(','),
  );
  p.set('p', s.pinned.join(','));
  return p.toString();
}
