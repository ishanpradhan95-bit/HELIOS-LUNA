/**
 * Validation suite (architecture doc section 8). Writes frontend/public/assets/validation.json, which the in-app Trust panel renders.
 * Tests without reference data are reported as NOT RUN, never as passed.
 *   tsx data-pipeline/validate.ts            full run (~1-2 min)
 *   tsx data-pipeline/validate.ts --quick    smaller samples
 */
import { readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { Engine } from '../frontend/src/math/engine';
import { DEFAULT_CONFIG } from '../frontend/src/math/analysis';
import type { SiteRef } from '../frontend/src/math/engine';
import { Grid, Pyramid } from '../frontend/src/math/dem';
import { DEFAULT_MARCH, computeEnvelope, stepSchedule } from '../frontend/src/math/horizon';
import { DEG, R_M, R_KM, siteFrame, toStereo, latLonFromN, fromStereo } from '../frontend/src/math/geo';
import { DATA_DIR, nodeSource } from './nodeSource';

const quick = process.argv.includes('--quick');
const eng = new Engine(nodeSource);
await eng.init();
const tests: any[] = [],
  gaps: string[] = [];
const ref = (id: string): SiteRef => {
  for (const r of eng.regions)
    for (const s of r.sites) if (s.id === id) return { id, label: id, lat: s.lat, lon: s.lon };
  throw new Error(id);
};
const sum = (a: number[]) => a.reduce((x, y) => x + y, 0);
const wrap = (d: number) => ((d + 540) % 360) - 180;

// 1. Sun/Earth topocentric az/el vs SPICE (independent, off-grid epochs)
{
  const buf = new Float64Array(10);
  let maxErr = 0,
    n = 0;
  for (const r of eng.eph.meta.referenceSamples) {
    const fr = siteFrame(r.lat, r.lon),
      pos = fr.n.map((c) => c * R_KM);
    eng.eph.at(r.unixMs, buf);
    for (const [body, off] of [
      ['sun', 0],
      ['earth', 3],
    ] as const) {
      const v = [buf[off] - pos[0], buf[off + 1] - pos[1], buf[off + 2] - pos[2]],
        d = Math.hypot(v[0], v[1], v[2]);
      const az =
        (Math.atan2(v[0] * fr.e[0] + v[1] * fr.e[1], v[0] * fr.north[0] + v[1] * fr.north[1] + v[2] * fr.north[2]) /
          DEG +
          360) %
        360;
      const el = Math.asin((v[0] * fr.n[0] + v[1] * fr.n[1] + v[2] * fr.n[2]) / d) / DEG;
      const rf = r[body];
      const err = Math.max(Math.abs(wrap(az - rf.az)) * Math.cos(el * DEG), Math.abs(el - rf.el));
      maxErr = Math.max(maxErr, err);
      n++;
    }
  }
  tests.push({
    id: 1,
    name: 'Sun / Earth topocentric az, el',
    reference: `SPICE (DE440, MOON_ME, LT+S) direct evaluation at ${n / 2} random off-grid epochs × 4 sites`,
    threshold: 'max error < 0.001°',
    result: `max error ${maxErr.toFixed(5)}° (includes hourly linear interpolation and Float32 storage)`,
    pass: maxErr < 0.001,
    detail: 'The reference is SPICE itself at the exact epoch; JPL Horizons cross-check not yet run.',
  });
  gaps.push(
    'Test 1 compares the browser interpolation to SPICE evaluated directly, not to JPL Horizons output; the SPICE kernels are the same source Horizons uses.',
  );
}

// 2. Horizon algorithm vs analytic cases
{
  const res: string[] = [];
  let worst = 0;
  const flat = new Grid('flat', 2, 3e6, -1.5e6, 1.5e6, new Int16Array(4));
  const flatPyr = new Pyramid(null, null, null, flat, flat);
  const lat = -86,
    lon = 20;
  const env = computeEnvelope(flatPyr, lat, lon, { ...DEFAULT_MARCH, naz: 36 });
  for (const z of [0, 2, 10, 50]) {
    const got = env.elevationDeg(z)[5],
      want = -Math.acos(R_M / (R_M + z)) / DEG;
    const e = Math.abs(got - want);
    worst = Math.max(worst, e);
    res.push(`bare sphere z=${z} m: ${got.toFixed(4)}° vs dip ${want.toFixed(4)}°`);
  }
  // Gaussian hill, brute-force reference with a 2 m scan and exact 3D elevation
  const H0 = 1500,
    sig = 2000,
    bearing = 70,
    D = 14_000;
  const fr = siteFrame(lat, lon),
    [ox, oy] = toStereo(fr.n);
  const dest = (d: number) => {
    const s = d / R_M,
      t = [
        Math.cos(bearing * DEG) * fr.north[0] + Math.sin(bearing * DEG) * fr.e[0],
        Math.cos(bearing * DEG) * fr.north[1] + Math.sin(bearing * DEG) * fr.e[1],
        Math.cos(bearing * DEG) * fr.north[2],
      ];
    return [0, 1, 2].map((k) => Math.cos(s) * fr.n[k] + Math.sin(s) * t[k]) as [number, number, number];
  };
  const [hx, hy] = toStereo(dest(D));
  const N = 3201,
    res0 = 10,
    x0 = ox - 16000,
    y0 = oy + 16000,
    data = new Int16Array(N * N);
  for (let j = 0; j < N; j++)
    for (let i = 0; i < N; i++) {
      const x = x0 + i * res0,
        y = y0 - j * res0;
      data[j * N + i] = Math.round(2 * H0 * Math.exp(-((x - hx) ** 2 + (y - hy) ** 2) / (2 * sig * sig)));
    }
  const g = new Grid('gauss', N, res0, x0, y0, data),
    hp = new Pyramid(null, null, null, g, g);
  const e2 = computeEnvelope(hp, lat, lon, { ...DEFAULT_MARCH, naz: 360 }, fr);
  for (const z of [2, 10]) {
    let best = -90;
    const O = fr.n.map((c) => c * (R_M + z));
    for (let d = 5; d < 30000; d += 2) {
      const n = dest(d),
        [x, y] = toStereo(n),
        h = g.height(x, y);
      if (Number.isNaN(h)) continue;
      const P = n.map((c) => c * (R_M + h));
      const v = [P[0] - O[0], P[1] - O[1], P[2] - O[2]];
      best = Math.max(best, Math.asin((v[0] * fr.n[0] + v[1] * fr.n[1] + v[2] * fr.n[2]) / Math.hypot(...v)) / DEG);
    }
    const got = e2.elevationDeg(z)[bearing],
      err = Math.abs(got - best);
    worst = Math.max(worst, err);
    res.push(`Gaussian hill (H=${H0} m, 14 km) z=${z} m: ${got.toFixed(4)}° vs brute ${best.toFixed(4)}°`);
  }
  tests.push({
    id: 2,
    name: 'Horizon algorithm vs analytic cases',
    reference: 'Bare-sphere dip angle (closed form); Gaussian hill vs 2 m brute-force 3-D scan',
    threshold: 'error < 0.01°',
    result: `worst error ${worst.toFixed(5)}°: ${res.join('; ')}`,
    pass: worst < 0.01,
  });
}

// 2b. Mast-height envelope vs exact re-march, and vs a quadratic fit through baked layers
{
  const ids = quick ? ['MMA01', 'HW01'] : ['MMA01', 'HW01', 'dGR201', 'NR101', 'PCB01', 'SP01'],
    heights = [0.5, 1, 2, 3, 5, 8, 10, 15, 20, 35, 50];
  let worstEnv = 0,
    worstLag = 0,
    signedLagMax = -9;
  const sched = stepSchedule(300_000);
  for (const id of ids) {
    const r = ref(id),
      site = await eng.site(r),
      pyr = await eng.pyramid(site.regionId),
      fr = site.frame;
    const [sx, sy] = toStereo(fr.n);
    const hO = pyr.surfaceHeight(sx, sy);
    for (const ia of [0, 97, 311, 500, 777, 901, 1203, 1399]) {
      const az = (ia / 1440) * 360 * DEG,
        t = [
          Math.cos(az) * fr.north[0] + Math.sin(az) * fr.e[0],
          Math.cos(az) * fr.north[1] + Math.sin(az) * fr.e[1],
          Math.cos(az) * fr.north[2] + Math.sin(az) * fr.e[2],
        ];
      const exact = (z: number) => {
        const O = fr.n.map((c) => c * (R_M + hO + z));
        let best = -90;
        for (const d of sched) {
          const s = d / R_M,
            n = [0, 1, 2].map((k) => Math.cos(s) * fr.n[k] + Math.sin(s) * t[k]) as [number, number, number],
            [x, y] = toStereo(n);
          let h = NaN;
          for (const gr of pyr.levels[d < 5000 ? 0 : d < 40000 ? 1 : 2]) {
            h = gr.height(x, y);
            if (h === h) break;
          }
          if (h !== h) continue;
          const P = n.map((c) => c * (R_M + h)),
            v = [P[0] - O[0], P[1] - O[1], P[2] - O[2]];
          best = Math.max(best, Math.asin((v[0] * fr.n[0] + v[1] * fr.n[1] + v[2] * fr.n[2]) / Math.hypot(...v)) / DEG);
        }
        return best;
      };
      const ex = Object.fromEntries([0, 5, 20, ...heights].map((z) => [z, exact(z)]));
      for (const z of heights) {
        const e = site.env.elevationDeg(z)[ia];
        worstEnv = Math.max(worstEnv, Math.abs(e - ex[z]));
      }
      // quadratic Lagrange fit through the 0 / 5 / 20 m layers
      for (const z of [2, 10, 15]) {
        const L =
          (ex[0] * ((z - 5) * (z - 20))) / ((0 - 5) * (0 - 20)) +
          (ex[5] * ((z - 0) * (z - 20))) / ((5 - 0) * (5 - 20)) +
          (ex[20] * ((z - 0) * (z - 5))) / ((20 - 0) * (20 - 5));
        worstLag = Math.max(worstLag, Math.abs(L - ex[z]));
        signedLagMax = Math.max(signedLagMax, ex[z] - L);
      }
    }
  }
  tests.push({
    id: 8,
    name: 'Exact mast height: obstruction envelope',
    reference: 'Full re-march with the observer physically raised to each height (exact 3-D elevation)',
    threshold: 'error < 0.01° at every height 0.5–50 m',
    result: `envelope worst error ${worstEnv.toFixed(5)}°; a quadratic fit through the baked 0/5/20 m layers was off by up to ${worstLag.toFixed(3)}° on the same rays`,
    pass: worstEnv < 0.01,
    detail: `${ids.length} sites × 8 azimuths × ${heights.length} heights.`,
  });
}

// 3. Convergence: azimuths and reach
const conv: any[] = [];
{
  const start = Date.UTC(2027, 0, 8),
    win = { startMs: start, days: 29.5 },
    cfg = { ...DEFAULT_CONFIG, stepMin: 30 };
  for (const id of quick ? ['MMA01'] : ['MMA01', 'HW01', 'NR101', 'PCB01']) {
    const rows: any[] = [],
      r = ref(id);
    for (const [label, opt] of [
      ['180 az, 35 km (coarse)', { naz: 180, maxDistM: 35_000 }],
      ['360 az, 35 km', { naz: 360, maxDistM: 35_000 }],
      ['360 az, 100 km', { naz: 360, maxDistM: 100_000 }],
      ['720 az, 200 km', { naz: 720, maxDistM: 200_000 }],
      ['1440 az, 300 km (this app)', { naz: 1440, maxDistM: 300_000 }],
    ] as const) {
      const site = await eng.site({ ...r, id: id + label }, opt);
      const a = eng.analyze(site, win, cfg);
      rows.push({ label, sunPct: a.summary.sunPct, maxHorizon: Math.max(...a.prof.deg) });
    }
    conv.push({ site: id, rows });
  }
  const spread = Math.max(...conv.map((c) => Math.abs(c.rows[0].sunPct - c.rows[c.rows.length - 1].sunPct)));
  tests.push({
    id: 3,
    name: 'Convergence: azimuth resolution and reach',
    reference: 'Same site and 29.5-day window re-run at 180/360/720/1440 azimuths and 35/100/200/300 km',
    threshold: 'report the curve',
    result: `Coarse settings (180 az, 35 km) change the sunlit % by up to ${spread.toFixed(1)} points vs this app at the largest-effect site`,
    pass: true,
    detail: 'Curves are shown below the table.',
  });
}

// 4. Atlas vs point engine
{
  const nCells = quick ? 40 : 500;
  let seed = 12345;
  const rnd = () => (seed = (seed * 1664525 + 1013904223) >>> 0) / 2 ** 32;
  const outliers: string[] = [];
  let worst = 0,
    over = 0,
    cmp = 0;
  const regs = eng.regions.filter((r) => !r.hidden).map((r) => r.id);
  const cache = new Map<string, { meta: any; buf: Buffer }>();
  for (let k = 0; k < nCells; k++) {
    const rid = regs[Math.floor(rnd() * regs.length)];
    if (!cache.has(rid))
      cache.set(rid, {
        meta: JSON.parse(await readFile(join(DATA_DIR, 'atlas', rid + '.json'), 'utf8')),
        buf: await readFile(join(DATA_DIR, 'atlas', rid + '.bin')),
      });
    const { meta, buf } = cache.get(rid)!,
      C = meta.cells;
    const col = Math.floor(rnd() * C),
      row = Math.floor(rnd() * C),
      x = meta.cx + (col - (C - 1) / 2) * meta.res,
      y = meta.cy + ((C - 1) / 2 - row) * meta.res;
    const [lat, lon] = latLonFromN(fromStereo(x, y)),
      site = await eng.site({ id: `cell${k}`, label: 'cell', lat, lon }, { regionId: rid });
    const hz = site.env.elevationDeg(2),
      [lo, hi] = meta.sunRange,
      step = (hi - lo) / 255;
    for (const a of [0, 45, 133, 200, 271, 340]) {
      const dec = lo + (buf[meta.layout.sun2 + a * C * C + row * C + col] / 255) * (hi - lo),
        exact = Math.min(hi, Math.max(lo, hz[a * 4]));
      const err = Math.abs(dec - exact);
      worst = Math.max(worst, err / step);
      cmp++;
      if (err > step * 0.51 + 0.002) {
        over++;
        outliers.push(
          `${rid} cell(${row},${col}) az ${a}: atlas ${dec.toFixed(4)}° exact ${hz[a * 4].toFixed(4)}° (step ${step.toFixed(4)}°, range ${lo.toFixed(2)}..${hi.toFixed(2)})`,
        );
      }
    }
  }
  if (outliers.length) console.log('atlas outliers:\n  ' + outliers.join('\n  '));
  tests.push({
    id: 4,
    name: 'Atlas vs point engine',
    reference: `${nCells} random cells × 6 azimuths across all ${regs.length} regions (Sun layer, 2 m)`,
    threshold: 'within the 8-bit quantisation step',
    result: `${cmp - over}/${cmp} within ½ step (+0.002°); worst ${worst.toFixed(2)} steps`,
    pass: over === 0,
    detail:
      "Each cell is evaluated against its own region's terrain tiles (overlapping regions can otherwise pick different tiles at their shared edge). Both come from the same march code; this guards the bake pipeline, bit layout and region/cell indexing (the cell latitude and longitude are re-derived independently).",
  });
}

// 5, 6, 10. External references (PGDA, LROC); NOT RUN if the reference data are missing
let extra: any = {};
if (!process.argv.includes('--skip-external')) {
  const { runExternal } = await import('./external');
  const ext = await runExternal(eng, quick);
  tests.push(...ext.tests);
  gaps.push(...ext.gaps);
  extra = ext.extra;
} else {
  tests.push({
    id: 5,
    name: 'Long-term average illumination and Earth visibility',
    reference: 'PGDA',
    threshold: '',
    result: 'skipped (--skip-external)',
    pass: null,
  });
  tests.push({
    id: 6,
    name: 'Independent time-specific check',
    reference: 'LROC',
    threshold: '',
    result: 'skipped (--skip-external)',
    pass: null,
  });
}

// 9. Exploratory: published SunDays
{
  if (!quick) {
    const all = eng.regions.filter((r) => r.artemis3).flatMap((r) => r.sites),
      win29 = (y: number) => ({ startMs: Date.UTC(y, 11, 21) - 15 * 86_400_000, days: 30 });
    const ours: number[] = [],
      ours2: number[] = [],
      theirs: number[] = [];
    const cfg = { ...DEFAULT_CONFIG, litThreshold: 0.5, stepMin: 60 };
    for (const s of all) {
      const site = await eng.site({ id: s.id, label: s.id, lat: s.lat, lon: s.lon });
      for (let y = 2026; y <= 2032; y++) {
        const r = eng.analyze(site, win29(y), cfg),
          pub = s.publishedSunDays?.[String(y)];
        if (pub == null) continue;
        ours.push(r.summary.longestLitH / 24);
        ours2.push((r.summary.litPct / 100) * 30);
        theirs.push(pub);
      }
    }
    const rank = (a: number[]) => {
      const idx = a.map((v, i) => [v, i]).sort((x, y) => x[0] - y[0]);
      const r = new Array(a.length);
      let i = 0;
      while (i < idx.length) {
        let j = i;
        while (j + 1 < idx.length && idx[j + 1][0] === idx[i][0]) j++;
        for (let k = i; k <= j; k++) r[idx[k][1]] = (i + j) / 2;
        i = j + 1;
      }
      return r;
    };
    const pearson = (a: number[], b: number[]) => {
      const ma = sum(a) / a.length,
        mb = sum(b) / b.length;
      let sab = 0,
        saa = 0,
        sbb = 0;
      a.forEach((v, i) => {
        sab += (v - ma) * (b[i] - mb);
        saa += (v - ma) ** 2;
        sbb += (b[i] - mb) ** 2;
      });
      return sab / Math.sqrt(saa * sbb);
    };
    const rho1 = pearson(rank(ours), rank(theirs)),
      rho2 = pearson(rank(ours2), rank(theirs));
    const seqs = new Map<string, number>();
    for (const q of all) {
      const k = JSON.stringify(q.publishedSunDays);
      seqs.set(k, (seqs.get(k) ?? 0) + 1);
    }
    const top = Math.max(...seqs.values());
    tests.push({
      id: 9,
      name: 'Exploratory: published per-site sunlight days (Wueller et al. 2026)',
      reference: `Zenodo 10.5281/zenodo.17084058 SunDays26–32, ${all.length} Artemis III sites × 7 midsummers (n=${theirs.length})`,
      threshold: 'none (inconclusive by construction)',
      result: `INCONCLUSIVE. Spearman ρ = ${rho1.toFixed(2)} / ${rho2.toFixed(2)} against two pre-declared metrics of ours, but ${top} of ${all.length} sites share one identical 7-year sequence (the published counts saturate at a window length) and vary strongly by year while each site's own sunlit % is stable year to year. The published window cannot be reconstructed from the dataset description, so no agreement or disagreement is claimed.`,
      pass: null,
      detail:
        'Our metrics (declared before looking): longest continuous sunlit run and sunlit days within 30 days centred on 21 Dec, disc > 50%, 2 m.',
    });
    gaps.push(
      'Test 9: the published SunDays metric saturates and is tied to a window we cannot reproduce, so it does not validate or invalidate our illumination numbers.',
    );
  }
}

// 7. Performance (measured, this machine)
{
  const times: number[] = [];
  const r = ref('MMA01');
  for (let k = 0; k < 7; k++) {
    const t = performance.now();
    computeEnvelope(await eng.pyramid('MMA'), r.lat + k * 1e-4, r.lon, DEFAULT_MARCH);
    times.push(performance.now() - t);
  }
  times.sort((a, b) => a - b);
  const site = await eng.site(r),
    t1 = performance.now();
  eng.analyze(site, { startMs: Date.UTC(2027, 0, 8), days: 7 }, DEFAULT_CONFIG);
  const tA = performance.now() - t1;
  const t2 = performance.now();
  eng.longTerm(site, DEFAULT_CONFIG);
  const tL = performance.now() - t2;
  const t3 = performance.now();
  site.env.elevationDeg(5);
  const tH = performance.now() - t3;
  tests.push({
    id: 7,
    name: 'Performance budget',
    reference: `Node ${process.version}, ${process.arch}, single thread (browser worker figures will differ; measure on target devices)`,
    threshold: 'horizon < 50 ms; height change < 16 ms',
    result: `horizon median ${times[3].toFixed(0)} ms (1440 az, 300 km); height slider ${tH.toFixed(2)} ms; 7-day analysis ${tA.toFixed(0)} ms; 19-year context ${tL.toFixed(0)} ms`,
    pass: times[3] < 50 && tH < 16,
    detail:
      times[3] >= 50
        ? 'Horizon time is above the 50 ms target; TypeScript is used first per ADR-005 and a Rust/WASM port is the planned remedy.'
        : undefined,
  });
}

tests.sort((a, b) => a.id - b.id);
for (const t of tests)
  console.log(
    `${t.pass === true ? 'PASS   ' : t.pass === false ? 'FAIL   ' : 'NOT-RUN'} #${t.id} ${t.name}\n         ${t.result}`,
  );
await writeFile(
  join(DATA_DIR, 'validation.json'),
  JSON.stringify({ generated: new Date().toISOString(), tests, convergence: conv, gaps, external: extra }, null, 1),
);
process.exit(tests.some((t) => t.pass === false) ? 1 : 0);
