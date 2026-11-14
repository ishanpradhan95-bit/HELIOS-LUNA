import type { Config, Requirements, Series, Summary } from './analysis';
import type { Region, SiteRef, Window } from './engine';
import type { Station } from './analysis';

export interface InitInfo {
  regions: Region[];
  stations: Station[];
  ephStart: number;
  ephEnd: number;
}
export interface AnalyzeResult {
  summary: Summary;
  series: Series;
  horizon: Float32Array;
  meta: {
    groundH: number;
    slope: number;
    quality: 'high' | 'medium' | 'coarse';
    region: string | null;
    lines: number;
    samples: number;
  };
  timing: { horizonMs: number; analysisMs: number };
}
export interface MatrixRow {
  id: string;
  sun: Float32Array;
  dte: Float32Array;
  both: Float32Array;
  dark: Float32Array;
  outage: Float32Array;
  ok: Uint8Array;
}
export interface Mast {
  z: number | null;
  atZero: { ok: boolean; failed: string[] };
  atMax: { ok: boolean; failed: string[] };
}
export interface Band {
  sun: [number, number];
  dte: [number, number];
  both: [number, number];
  dark: [number, number];
  outage: [number, number];
  n: number;
}
export interface SolveRow {
  siteId: string;
  label: string;
  arrivalMs: number;
  minMastM: number;
  sunPct: number;
  dtePct: number;
  darkH: number;
  outageH: number;
}

/** Promise RPC to the engine Web Worker. */
export class EngineClient {
  private w: Worker;
  private seq = 0;
  private pending = new Map<number, [(v: any) => void, (e: Error) => void]>();
  constructor() {
    this.w = new Worker(new URL('../workers/engine.worker.ts', import.meta.url), { type: 'module' });
    this.w.onmessage = (ev) => {
      const { id, ok, res, err } = ev.data,
        p = this.pending.get(id);
      if (!p) return;
      this.pending.delete(id);
      ok ? p[0](res) : p[1](new Error(err));
    };
    this.w.onerror = (e) => {
      for (const [, p] of this.pending) p[1](new Error(e.message));
      this.pending.clear();
    };
  }
  private call<T>(method: string, args: any): Promise<T> {
    const id = ++this.seq;
    return new Promise((a, b) => {
      this.pending.set(id, [a, b]);
      this.w.postMessage({ id, method, args });
    });
  }
  init(base: string) {
    return this.call<InitInfo>('init', { base });
  }
  analyze(ref: SiteRef, win: Window, cfg: Config) {
    return this.call<AnalyzeResult>('analyze', { ref, win, cfg });
  }
  matrix(refs: SiteRef[], start: number, days: number, dur: number, cfg: Config, req?: Requirements) {
    return this.call<{ rows: MatrixRow[]; ms: number; meta: { id: string; quality: string }[] }>('matrix', {
      refs,
      start,
      days,
      dur,
      cfg,
      req,
    });
  }
  minMast(ref: SiteRef, win: Window, cfg: Config, req: Requirements) {
    return this.call<Mast>('minMast', { ref, win, cfg, req });
  }
  uncertainty(ref: SiteRef, win: Window, cfg: Config) {
    return this.call<Band>('uncertainty', { ref, win, cfg });
  }
  longTerm(ref: SiteRef, cfg: Config) {
    return this.call<{ year: number; sun: number; dte: number }[]>('longTerm', { ref, cfg });
  }
  solve(refs: SiteRef[], start: number, days: number, dur: number, cfg: Config, req: Requirements) {
    return this.call<{ results: SolveRow[]; screened: number; feasibleAtMaxMast: number }>('solve', {
      refs,
      start,
      days,
      dur,
      cfg,
      req,
    });
  }
  bodies(start: number, n: number, stepMs: number) {
    return this.call<Float32Array>('bodies', { start, n, stepMs });
  }
}
