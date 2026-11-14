/**
 * External validation against independent reference data (architecture doc tests 5 and 6, plus a WAC percent-lit check).
 * All pass thresholds below were fixed before the first run (see data-pipeline/VALIDATION_PROTOCOL.md).
 *
 *  #5  PGDA average Sun / Earth visibility (LOLA team, Mazarico et al. 2011), 60 m, 85-90 S
 *        ours = fraction of 2-hourly steps over 2026-2044 with ANY part of the disc visible (PGDA's own definition), z = 0
 *        pass: |bias| < 2 points and Pearson r > 0.95 (doc thresholds), for both Sun and Earth
 *  #6  LROC WAC polar movie frames at their UTC (12 frames, one per ~30 days, fixed selection rule)
 *        image lit/shadow = per-frame Otsu threshold on 8-bit DN; predicted lit = Sun disc > 50% visible, z = 0
 *        pass: pooled MCC > 0.6, mirrored-azimuth control MCC < 0.3, +7-day-shift control MCC < 0.3
 *  #10 LROC WAC percent-lit map (3807 images, 2010-02-15 .. 2011-02-05, 88-90 S), Float32 percent
 *        ours = % of hourly steps in that span with the Sun disc > 50% visible, z = 0
 *        pass: |bias| < 3 points and r > 0.9 (the imagery and the LOLA model agree with each other at r = 0.944,
 *        so a stricter bar than that would test the reference, not this app)
 * Domain: points within 38 km of the pole (40 m terrain, 'high' quality) plus, for #5, six regions at 85-87 S (20 m terrain).
 */
import { readFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import type { Engine } from '../frontend/src/math/engine';
import { runSeries, newState, evalAt, DEFAULT_CONFIG, type SiteCtx } from '../frontend/src/math/analysis';
import { HorizonProfile } from '../frontend/src/math/visibility';
import { fromStereo, latLonFromN } from '../frontend/src/math/geo';

const RAW = join(import.meta.dirname, 'raw', 'imagery'),
  PREP = join(RAW, 'prepped');
const have = () => existsSync(join(PREP, 'meta.json')) && existsSync(join(RAW, 'AVGVISIB_85S_060M_201608.IMG'));

// helpers
let seed = 20261114;
const rnd = () => (seed = (seed * 1664525 + 1013904223) >>> 0) / 2 ** 32;
const f32 = async (p: string) => {
  const b = await readFile(p);
  return new Float32Array(b.buffer, b.byteOffset, b.byteLength / 4);
};
const i16 = async (p: string) => {
  const b = await readFile(p);
  return new Int16Array(b.buffer, b.byteOffset, b.byteLength / 2);
};
const u8 = async (p: string) => new Uint8Array(await readFile(p));

function stats(ours: number[], ref: number[]) {
  const n = ours.length;
  let sb = 0,
    sq = 0;
  const mo = ours.reduce((a, b) => a + b, 0) / n,
    mr = ref.reduce((a, b) => a + b, 0) / n;
  let sxy = 0,
    sxx = 0,
    syy = 0;
  for (let i = 0; i < n; i++) {
    const d = ours[i] - ref[i];
    sb += d;
    sq += d * d;
    sxy += (ours[i] - mo) * (ref[i] - mr);
    sxx += (ours[i] - mo) ** 2;
    syy += (ref[i] - mr) ** 2;
  }
  const nt = ours.map((o, i) => [o, ref[i]]).filter(([o, r]) => o > 0.5 || r > 0.5); // drop trivially-dark pairs
  const m2o = nt.reduce((a, b) => a + b[0], 0) / nt.length,
    m2r = nt.reduce((a, b) => a + b[1], 0) / nt.length;
  let a = 0,
    b = 0,
    c = 0;
  for (const [o, r] of nt) {
    a += (o - m2o) * (r - m2r);
    b += (o - m2o) ** 2;
    c += (r - m2r) ** 2;
  }
  return {
    n,
    bias: sb / n,
    rmse: Math.sqrt(sq / n),
    r: sxy / Math.sqrt(sxx * syy),
    rLit: a / Math.sqrt(b * c),
    nLit: nt.length,
    meanOurs: mo,
    meanRef: mr,
  };
}
const BINS = [
  [0, 2],
  [2, 10],
  [10, 20],
  [20, 30],
  [30, 45],
  [45, 101],
];
const calib = (ours: number[], ref: number[]) =>
  BINS.map(([lo, hi]) => {
    const idx = ref.map((r, i) => (r >= lo && r < hi ? i : -1)).filter((i) => i >= 0);
    return {
      bin: `${lo}–${Math.min(hi, 100)}%`,
      n: idx.length,
      ref: idx.length ? idx.reduce((a, i) => a + ref[i], 0) / idx.length : null,
      ours: idx.length ? idx.reduce((a, i) => a + ours[i], 0) / idx.length : null,
    };
  });
function mcc(tp: number, fp: number, tn: number, fn: number) {
  const d = Math.sqrt((tp + fp) * (tp + fn) * (tn + fp) * (tn + fn));
  return d === 0 ? 0 : (tp * tn - fp * fn) / d;
}
function otsu(vals: Uint8Array): number {
  const h = new Float64Array(256);
  for (const v of vals) h[v]++;
  const tot = vals.length;
  let sum = 0;
  for (let i = 0; i < 256; i++) sum += i * h[i];
  let wB = 0,
    sB = 0,
    best = 0,
    bt = 0;
  for (let t = 0; t < 256; t++) {
    wB += h[t];
    if (!wB) continue;
    const wF = tot - wB;
    if (!wF) break;
    sB += t * h[t];
    const mB = sB / wB,
      mF = (sum - sB) / wF,
      v = wB * wF * (mB - mF) ** 2;
    if (v > best) {
      best = v;
      bt = t;
    }
  }
  return bt;
}
const TRANSFORMS: Record<string, (r: number, c: number, n: number) => [number, number]> = {
  identity: (r, c) => [r, c],
  flipud: (r, c, n) => [n - 1 - r, c],
  fliplr: (r, c, n) => [r, n - 1 - c],
  rot180: (r, c, n) => [n - 1 - r, n - 1 - c],
  transpose: (r, c) => [c, r],
  'transpose+flipud': (r, c, n) => [c, n - 1 - r],
  'transpose+fliplr': (r, c, n) => [n - 1 - c, r],
  'transpose+rot180': (r, c, n) => [n - 1 - c, n - 1 - r],
};

interface Pt {
  x: number;
  y: number;
  lat: number;
  lon: number;
  rho: number;
  domain: string;
  site?: SiteCtx;
  prof?: HorizonProfile;
}
function makePoint(x: number, y: number, domain: string): Pt {
  const [lat, lon] = latLonFromN(fromStereo(x, y));
  return { x, y, lat, lon, rho: Math.hypot(x, y), domain };
}

export async function runExternal(eng: Engine, quick: boolean) {
  const tests: any[] = [],
    gaps: string[] = [],
    extra: any = {};
  if (!have()) {
    for (const [id, name] of [
      [5, 'PGDA long-term average illumination and Earth visibility'],
      [6, 'LROC WAC polar frames at known UTC'],
    ] as const)
      tests.push({
        id,
        name,
        reference: 'not downloaded',
        threshold: '',
        result: 'NOT RUN: run data-pipeline/fetch_imagery.py and prep_imagery.py',
        pass: null,
      });
    gaps.push('Tests 5, 6 and 10 need the PGDA and LROC data: run make imagery.');
    return { tests, gaps, extra };
  }
  const meta = JSON.parse(await readFile(join(PREP, 'meta.json'), 'utf8'));
  const eph2 = await eng.loadEphemeris('ephemeris_2010');
  const cfg = { ...DEFAULT_CONFIG, z: 0 };
  const nPole = quick ? 80 : 1500,
    nReg = quick ? 8 : 70;

  // sample points
  const pole: Pt[] = [];
  for (let i = 0; i < nPole; i++) {
    const r = 38000 * Math.sqrt(rnd()),
      a = 2 * Math.PI * rnd();
    pole.push(makePoint(r * Math.cos(a), r * Math.sin(a), 'pole 88.7–90°S'));
  }
  const regional: Pt[] = [];
  for (const id of ['MMA', 'HW', 'SP', 'dGR2', 'MMO', 'NR1']) {
    const reg = eng.regions.find((r) => r.id === id)!;
    let k = 0,
      guard = 0;
    while (k < nReg && guard++ < 10000) {
      const p = makePoint(reg.cx + (rnd() * 2 - 1) * 9000, reg.cy + (rnd() * 2 - 1) * 9000, reg.name);
      if (p.rho > 38500 && p.rho < 150000) {
        regional.push(p);
        k++;
      }
    }
  }
  const t0 = performance.now();
  let done = 0;
  for (const p of [...pole, ...regional]) {
    p.site = await eng.site({ id: `v${done++}`, label: 'v', lat: p.lat, lon: p.lon });
    p.prof = eng.profile(p.site, 0);
    if (done % 300 === 0) process.stdout.write(`  horizons ${done}/${pole.length + regional.length}\r`);
  }
  const bad = [...pole, ...regional].filter((p) => p.site!.quality !== 'high').length;
  console.log(
    `  ${pole.length + regional.length} horizons in ${((performance.now() - t0) / 1000).toFixed(0)} s (${bad} not 'high' quality)`,
  );

  // #5 PGDA
  {
    const [sunI, earthI] = await Promise.all([
      i16(join(RAW, 'AVGVISIB_85S_060M_201608.IMG')),
      i16(join(RAW, 'AVGVISIB_85S_060M_201608_EARTH.IMG')),
    ]);
    const NP = 5058,
      at = (a: Int16Array, p: Pt) =>
        a[Math.floor(NP / 2 - p.y / 60) * NP + Math.floor(p.x / 60 + NP / 2)] * 0.00004 * 100;
    const pts = [...pole.slice(0, quick ? 40 : 300), ...regional];
    const stepMs = 2 * 3_600_000,
      n = Math.floor((eng.eph.end - eng.eph.start) / stepMs);
    const oS: number[] = [],
      oE: number[] = [],
      rS: number[] = [],
      rE: number[] = [],
      dom: string[] = [];
    const t1 = performance.now();
    for (const p of pts) {
      const S = runSeries(p.site!, p.prof!, eng.eph, [], cfg, eng.eph.start, n, stepMs, true);
      let s = 0,
        e = 0;
      for (let i = 0; i < n; i++) {
        if (S.fRaw[i] > 0) s++;
        if (S.fEarth[i] > 0) e++;
      }
      oS.push((100 * s) / n);
      oE.push((100 * e) / n);
      rS.push(at(sunI, p));
      rE.push(at(earthI, p));
      dom.push(p.domain);
    }
    console.log(`  PGDA series in ${((performance.now() - t1) / 1000).toFixed(0)} s`);
    const sS = stats(oS, rS),
      sE = stats(oE, rE);
    const byDom = [...new Set(dom)].map((d) => {
      const ix = dom.map((q, i) => (q === d ? i : -1)).filter((i) => i >= 0);
      const a = stats(
          ix.map((i) => oS[i]),
          ix.map((i) => rS[i]),
        ),
        b = stats(
          ix.map((i) => oE[i]),
          ix.map((i) => rE[i]),
        );
      return { domain: d, n: ix.length, sunBias: a.bias, sunR: a.r, earthBias: b.bias, earthR: b.r };
    });
    const pass = Math.abs(sS.bias) < 2 && sS.r > 0.95 && Math.abs(sE.bias) < 2 && sE.r > 0.95;
    tests.push({
      id: 5,
      name: 'Long-term average illumination and Earth visibility',
      reference: `PGDA AVGVISIB_85S_060M_201608 (Sun) and _EARTH, ${pts.length} points at 85–90°S; ours = 2-hourly 2026–2044, any part of the disc visible, z = 0`,
      threshold: '|bias| < 2 points and r > 0.95, Sun and Earth',
      result: `Sun: bias ${sS.bias >= 0 ? '+' : ''}${sS.bias.toFixed(2)} pts, RMSE ${sS.rmse.toFixed(2)}, r = ${sS.r.toFixed(3)} (r = ${sS.rLit.toFixed(3)} excluding permanently-dark pairs, n = ${sS.nLit}). Earth: bias ${sE.bias >= 0 ? '+' : ''}${sE.bias.toFixed(2)} pts, RMSE ${sE.rmse.toFixed(2)}, r = ${sE.r.toFixed(3)} (r = ${sE.rLit.toFixed(3)} excl. dark, n = ${sE.nLit})`,
      pass,
      detail:
        'Not independent of this app’s terrain (same LOLA source) but independent in code and method: PGDA used its own 60 m DEM and horizon code. Differences include 60 m vs 20/40 m terrain, nearest-pixel sampling and a 19- vs 18.6-year span.',
    });
    extra.pgda = {
      sun: sS,
      earth: sE,
      byDomain: byDom,
      calibrationSun: calib(oS, rS),
      calibrationEarth: calib(oE, rE),
    };
    if (!pass)
      gaps.push(
        'Test 5 did not meet its pre-declared threshold (see result); the residual is characterised in the calibration table.',
      );
    const weak = byDom
      .filter((d) => d.sunR < 0.95 || d.earthR < 0.95)
      .map(
        (d) => `${d.domain} (Sun r = ${d.sunR.toFixed(3)}, bias ${d.sunBias >= 0 ? '+' : ''}${d.sunBias.toFixed(1)})`,
      );
    const neg = byDom.filter((d) => d.sunBias < -0.5).length,
      top = extra.pgda.calibrationSun[5];
    gaps.push(
      `Test 5 caveats: the pooled correlation is helped by pooling regions of different brightness; per-domain Sun r is below 0.95 for ${weak.length ? weak.join('; ') : 'none'}. Our Sun average is lower than PGDA's in ${neg} of ${byDom.length} domains${top && top.n ? `, and by ${(top.ref - top.ours).toFixed(1)} points in the brightest bin (PGDA ${top.ref.toFixed(1)}% vs ours ${top.ours.toFixed(1)}%, n = ${top.n})` : ''}. The cause is not isolated (candidates: PGDA’s 60 m DEM and horizon reach, our 300 km reach, nearest-pixel sampling).`,
    );
  }

  // #10 WAC percent-lit map
  {
    const W = await f32(join(PREP, 'wac_pct.f32')),
      N = 1214;
    const start = Date.UTC(2010, 1, 15),
      end = Date.UTC(2011, 1, 5),
      stepMs = 3_600_000,
      n = Math.floor((end - start) / stepMs);
    const pts = pole.slice(0, quick ? 60 : 600),
      ours: Record<string, number[]> = { gt50: [], gt0: [], gt90: [] },
      ref: number[] = [];
    for (const p of pts) {
      const v = W[Math.floor(N / 2 - p.y / 100) * N + Math.floor(p.x / 100 + N / 2)];
      if (!Number.isFinite(v)) continue;
      const S = runSeries(p.site!, p.prof!, eph2, [], cfg, start, n, stepMs, true);
      let a = 0,
        b = 0,
        c = 0;
      for (let i = 0; i < n; i++) {
        const f = S.fRaw[i];
        if (f > 0.5) a++;
        if (f > 0) b++;
        if (f > 0.9) c++;
      }
      ours.gt50.push((100 * a) / n);
      ours.gt0.push((100 * b) / n);
      ours.gt90.push((100 * c) / n);
      ref.push(v);
    }
    const s50 = stats(ours.gt50, ref),
      s0 = stats(ours.gt0, ref),
      s90 = stats(ours.gt90, ref);
    const pass = Math.abs(s50.bias) < 3 && s50.r > 0.9;
    tests.push({
      id: 10,
      name: 'Imagery-derived illumination (LROC WAC percent-lit map)',
      reference: `WAC_POLE_ILL_PCT_SOUTH_100M, 3807 WAC images 2010-02-15 – 2011-02-05, ${ref.length} points at 88.7–90°S; ours = hourly over the same dates (2010 SPICE ephemeris), z = 0`,
      threshold: '|bias| < 3 points and r > 0.9 (fixed before running)',
      result: `Sun disc > 50% visible: bias ${s50.bias >= 0 ? '+' : ''}${s50.bias.toFixed(2)} pts, RMSE ${s50.rmse.toFixed(2)}, r = ${s50.r.toFixed(3)} (excl. dark: ${s50.rLit.toFixed(3)}). Sensitivity: any part visible: bias ${s0.bias >= 0 ? '+' : ''}${s0.bias.toFixed(2)}, r = ${s0.r.toFixed(3)}; > 90% visible: bias ${s90.bias >= 0 ? '+' : ''}${s90.bias.toFixed(2)}, r = ${s90.r.toFixed(3)}`,
      pass,
      detail:
        'Truly independent measurement: the reference is counted from real camera images, not modelled. WAC sampling is not uniform in time (documented bias), and the product thresholds image brightness, so some offset is expected.',
    });
    extra.wacPct = { s50, s0, s90, calibration: calib(ours.gt50, ref) };
    if (!pass) gaps.push('Test 10 did not meet its pre-declared threshold (see result).');
  }

  // #6 WAC movie frames
  {
    const NF = 6080,
      framePts = pole,
      rows: any[] = [];
    const mirror = (p: HorizonProfile) => {
      const d = new Float32Array(p.naz);
      for (let i = 0; i < p.naz; i++) d[i] = p.deg[(p.naz - i) % p.naz];
      return new HorizonProfile(d);
    };
    const mir = framePts.map((p) => mirror(p.prof!)),
      st = newState();
    const pooled = { real: [0, 0, 0, 0], mir: [0, 0, 0, 0], shift: [0, 0, 0, 0], fixed10: [0, 0, 0, 0] };
    const orient: Record<string, number[]> = Object.fromEntries(Object.keys(TRANSFORMS).map((k) => [k, [0, 0, 0, 0]]));
    const add = (c: number[], pred: boolean, truth: boolean) => {
      if (pred && truth) c[0]++;
      else if (pred && !truth) c[1]++;
      else if (!pred && !truth) c[2]++;
      else c[3]++;
    };
    const frames: any[] = meta.frames.slice(0, quick ? 4 : 12);
    for (const fr of frames) {
      const m = /S(\d{4})(\d{2})(\d{2})T(\d{2})(\d{2})/.exec(fr.name)!;
      const t = Date.UTC(+m[1], +m[2] - 1, +m[3], +m[4], +m[5]) + 3.5 * 60_000; // label spans ~6.5 min from the file-name minute
      const img = await u8(join(PREP, fr.name + '.u8')),
        msk = await u8(join(PREP, fr.name + '.mask.u8'));
      // Otsu over every valid pixel of the 38 km polar disc
      const dom: number[] = [];
      for (let r = 0; r < NF; r++) {
        const y = (NF / 2 - (r + 0.5)) * 100;
        if (Math.abs(y) > 38000) continue;
        for (let c = 0; c < NF; c++) {
          const x = (c + 0.5 - NF / 2) * 100;
          if (x * x + y * y < 38000 * 38000 && msk[r * NF + c]) dom.push(img[r * NF + c]);
        }
      }
      const T = otsu(Uint8Array.from(dom)),
        cr = [0, 0, 0, 0],
        cm = [0, 0, 0, 0],
        cs = [0, 0, 0, 0];
      let used = 0,
        litImg = 0,
        litPred = 0;
      for (let i = 0; i < framePts.length; i++) {
        const p = framePts[i],
          r0 = Math.floor(NF / 2 - p.y / 100),
          c0 = Math.floor(p.x / 100 + NF / 2);
        if (!msk[r0 * NF + c0]) continue;
        const truth = img[r0 * NF + c0] > T;
        evalAt(p.site!, p.prof!, eph2, [], cfg, t, st);
        const pred = st.fSunRaw > 0.5;
        evalAt(p.site!, mir[i], eph2, [], cfg, t, st);
        const predM = st.fSunRaw > 0.5;
        evalAt(p.site!, p.prof!, eph2, [], cfg, t + 7 * 86_400_000, st);
        const predS = st.fSunRaw > 0.5;
        add(cr, pred, truth);
        add(cm, predM, truth);
        add(cs, predS, truth);
        add(pooled.fixed10, pred, img[r0 * NF + c0] > 10);
        used++;
        if (truth) litImg++;
        if (pred) litPred++;
        for (const [k, f] of Object.entries(TRANSFORMS)) {
          const [rr, cc] = f(r0, c0, NF);
          if (msk[rr * NF + cc]) add(orient[k], pred, img[rr * NF + cc] > T);
        }
      }
      for (const [k, c] of [
        ['real', cr],
        ['mir', cm],
        ['shift', cs],
      ] as const)
        for (let j = 0; j < 4; j++) pooled[k][j] += c[j];
      rows.push({
        frame: fr.name,
        utc: new Date(t).toISOString().slice(0, 16) + 'Z',
        otsuDN: T,
        points: used,
        litImagePct: (100 * litImg) / Math.max(1, used),
        litPredictedPct: (100 * litPred) / Math.max(1, used),
        mcc: mcc(cr[0], cr[1], cr[2], cr[3]),
        mccMirrored: mcc(cm[0], cm[1], cm[2], cm[3]),
        mccShifted7d: mcc(cs[0], cs[1], cs[2], cs[3]),
      });
      console.log(
        `  ${fr.name}: lit ${rows[rows.length - 1].litImagePct.toFixed(0)}% img / ${rows[rows.length - 1].litPredictedPct.toFixed(0)}% pred, MCC ${rows[rows.length - 1].mcc.toFixed(2)} (mirror ${rows[rows.length - 1].mccMirrored.toFixed(2)}, +7 d ${rows[rows.length - 1].mccShifted7d.toFixed(2)})`,
      );
    }
    const M = (c: number[]) => mcc(c[0], c[1], c[2], c[3]);
    const real = M(pooled.real),
      mi = M(pooled.mir),
      sh = M(pooled.shift),
      fx = M(pooled.fixed10);
    const orientM = Object.fromEntries(Object.entries(orient).map(([k, c]) => [k, M(c)]));
    const bestO = Object.entries(orientM).sort((a, b) => b[1] - a[1])[0];
    const pass = real > 0.6 && mi < 0.3 && sh < 0.3;
    const meanM = rows.reduce((a, r) => a + r.mcc, 0) / rows.length;
    tests.push({
      id: 6,
      name: 'Independent time-specific check (LROC WAC frames)',
      reference: `${rows.length} WAC polar movie frames at their UTC (one per ~30 days, fixed rule), ${framePts.length} points within 38 km of the pole; image lit = per-frame Otsu DN threshold; predicted lit = Sun disc > 50%, z = 0`,
      threshold: 'pooled MCC > 0.6; mirrored-azimuth and +7-day-shift controls each < 0.3',
      result: `pooled MCC = ${real.toFixed(3)} (mean of frames ${meanM.toFixed(3)}); controls: mirrored azimuth ${mi.toFixed(3)}, date +7 d ${sh.toFixed(3)}. With a fixed DN > 10 threshold instead of Otsu: ${fx.toFixed(3)}. Orientation scan best = ${bestO[0]} (${bestO[1].toFixed(3)})`,
      pass,
      detail:
        'Frames are uncontrolled mosaics (geolocation can be off by a few hundred metres) and a few minutes of orbit time long. The image orientation was fixed from the time-averaged maps (see prep_imagery.py), not tuned on these frames.',
    });
    extra.frames = {
      rows,
      pooledMcc: { real, mirrored: mi, shifted7d: sh, fixedThreshold10: fx },
      orientationScan: orientM,
    };
    const ctrl = rows.filter((r) => r.mccMirrored > 0.3 || r.mccShifted7d > 0.3),
      over = rows.filter((r) => r.litPredictedPct > r.litImagePct + 2);
    gaps.push(
      `Test 6 caveats: the controls are low in the pooled data but not in every frame: ${ctrl.length} of ${rows.length} frames have a control MCC above 0.3 (max ${Math.max(...rows.map((r) => Math.max(r.mccMirrored, r.mccShifted7d))).toFixed(2)}), because polar horizons have partly mirror-like structure. We predict more lit area than the thresholded image shows in ${over.length} of ${rows.length} frames (by up to ${Math.max(...rows.map((r) => r.litPredictedPct - r.litImagePct)).toFixed(0)} points), consistent with a conservative image threshold and grazing-incidence pixels that are geometrically lit but dark in the image. The frames are uncontrolled mosaics; no registration correction was applied.`,
    );
    if (bestO[0] !== 'identity')
      gaps.push(
        `Test 6: the frame-orientation scan preferred ${bestO[0]} over the orientation derived from the time-averaged maps; investigate before trusting the MCC.`,
      );
    if (!pass) gaps.push('Test 6 did not meet its pre-declared threshold (see result).');
  }
  return { tests, gaps, extra };
}
