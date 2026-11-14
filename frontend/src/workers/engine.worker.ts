/// <reference lib="webworker" />
import { Engine } from '../math/engine';
import type { SiteRef, Window } from '../math/engine';
import type { Config, Requirements } from '../math/analysis';

let eng: Engine | null = null;
let base = '';

const handlers: Record<string, (a: any) => Promise<any> | any> = {
  async init(a: { base: string }) {
    base = a.base;
    eng = new Engine({
      async json(p) {
        const r = await fetch(base + p);
        if (!r.ok) throw new Error(`${p}: ${r.status}`);
        return r.json();
      },
      async bin(p) {
        const r = await fetch(base + p);
        if (!r.ok) throw new Error(`${p}: ${r.status}`);
        return r.arrayBuffer();
      },
    });
    return eng.init();
  },
  async analyze(a: { ref: SiteRef; win: Window; cfg: Config }) {
    const t0 = performance.now();
    const site = await eng!.site(a.ref);
    const t1 = performance.now();
    const r = eng!.analyze(site, a.win, a.cfg);
    return {
      summary: r.summary,
      series: r.series,
      horizon: r.prof.deg,
      meta: {
        groundH: site.groundH,
        slope: site.slopeDeg,
        quality: site.quality,
        region: site.regionId,
        lines: site.env.lineCount,
        samples: site.env.samples,
      },
      timing: { horizonMs: t1 - t0, analysisMs: performance.now() - t1 },
    };
  },
  async matrix(a: { refs: SiteRef[]; start: number; days: number; dur: number; cfg: Config; req?: Requirements }) {
    const sites = [];
    for (const r of a.refs) sites.push(await eng!.site(r));
    const t = performance.now();
    const m = eng!.matrix(sites, a.start, a.days, a.dur, a.cfg, a.req);
    return { rows: m, ms: performance.now() - t, meta: sites.map((s) => ({ id: s.id, quality: s.quality })) };
  },
  async minMast(a: { ref: SiteRef; win: Window; cfg: Config; req: Requirements }) {
    return eng!.minMast(await eng!.site(a.ref), a.win, a.cfg, a.req);
  },
  async uncertainty(a: { ref: SiteRef; win: Window; cfg: Config }) {
    return eng!.uncertainty(a.ref, a.win, a.cfg);
  },
  async longTerm(a: { ref: SiteRef; cfg: Config }) {
    return eng!.longTerm(await eng!.site(a.ref), a.cfg);
  },
  async solve(a: { refs: SiteRef[]; start: number; days: number; dur: number; cfg: Config; req: Requirements }) {
    const sites = [];
    for (const r of a.refs) sites.push(await eng!.site(r));
    return eng!.solve(sites, a.start, a.days, a.dur, a.cfg, a.req);
  },
  bodies(a: { start: number; n: number; stepMs: number }) {
    return eng!.bodies(a.start, a.n, a.stepMs);
  },
  async envelopeCell(a: { ref: SiteRef; z: number }) {
    const s = await eng!.site(a.ref);
    return { deg: s.env.elevationDeg(a.z) };
  },
};

const ctx = self as unknown as DedicatedWorkerGlobalScope;
ctx.onmessage = async (ev: MessageEvent<{ id: number; method: string; args: any }>) => {
  const { id, method, args } = ev.data;
  try {
    const res = await handlers[method](args);
    ctx.postMessage({ id, ok: true, res });
  } catch (e: any) {
    ctx.postMessage({ id, ok: false, err: String(e?.message ?? e) });
  }
};
