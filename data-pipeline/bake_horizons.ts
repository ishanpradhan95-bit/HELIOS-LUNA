/**
 * Horizon atlas bake (architecture doc 5.3): per region, 128 x 128 cells at 120 m (15.4 km), observer heights 2 m and 10 m.
 *   Sun atlas   [az 360 @ 1 deg][row][col] Uint8, quantised over the Sun's ephemeris-bounded elevation range (+-0.6 deg pad)
 *   Earth atlas [bin 48][row][col] Uint8, per-cell azimuth window (centre + step stored), quantised over Earth's elevation range
 * Uses the same march + envelope code as the browser point engine.
 * usage: tsx data-pipeline/bake_horizons.ts [REGION_ID ...]
 */
import { Worker } from 'node:worker_threads';
import { availableParallelism } from 'node:os';
import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { Engine } from '../frontend/src/math/engine';
import { DEG, R_KM, fromStereo, latLonFromN, siteFrame } from '../frontend/src/math/geo';
import { DATA_DIR, nodeSource } from './nodeSource';

const CELLS = 128,
  RES = 120,
  NBINS = 48;
const eng = new Engine(nodeSource);
await eng.init();
const want = process.argv.slice(2);
const regions = eng.regions.filter((r) => !r.hidden && (!want.length || want.includes(r.id)));
await mkdir(join(DATA_DIR, 'atlas'), { recursive: true });

const buf = new Float64Array(10);
function azEl(frame: ReturnType<typeof siteFrame>, pos: number[], v: ArrayLike<number>) {
  const x = v[0] - pos[0],
    y = v[1] - pos[1],
    z = v[2] - pos[2],
    d = Math.hypot(x, y, z);
  const { n, e, north } = frame;
  return [
    Math.atan2(x * e[0] + y * e[1] + z * e[2], x * north[0] + y * north[1] + z * north[2]) / DEG,
    Math.asin((x * n[0] + y * n[1] + z * n[2]) / d) / DEG,
  ];
}

for (const reg of regions) {
  const t0 = performance.now();
  const centre = siteFrame(...latLonFromN(fromStereo(reg.cx, reg.cy)));
  const cpos = centre.n.map((c) => c * R_KM);
  // Sun elevation bounds (3-hourly over 19 years), Earth elevation bounds + daily Earth vectors
  let sMin = 90,
    sMax = -90,
    eMin = 90,
    eMax = -90;
  for (let t = eng.eph.start; t < eng.eph.end; t += 3 * 3.6e6) {
    eng.eph.at(t, buf);
    const s = azEl(centre, cpos, buf.subarray(0, 3));
    sMin = Math.min(sMin, s[1]);
    sMax = Math.max(sMax, s[1]);
    const e = azEl(centre, cpos, buf.subarray(3, 6));
    eMin = Math.min(eMin, e[1]);
    eMax = Math.max(eMax, e[1]);
  }
  const sLo = sMin - 0.6,
    sHi = sMax + 0.6,
    eLo = eMin - 1.5,
    eHi = eMax + 1.5;
  const days: Float64Array[] = [];
  for (let t = eng.eph.start; t < eng.eph.end; t += 86400000) {
    eng.eph.at(t, buf);
    days.push(Float64Array.from(buf.subarray(3, 6)));
  }
  const azC = new Float32Array(CELLS * CELLS),
    span = new Float32Array(CELLS * CELLS);
  for (let row = 0; row < CELLS; row++)
    for (let col = 0; col < CELLS; col++) {
      const x = reg.cx + (col - (CELLS - 1) / 2) * RES,
        y = reg.cy + ((CELLS - 1) / 2 - row) * RES;
      const n = fromStereo(x, y),
        fr = siteFrame(...latLonFromN(n)),
        pos = n.map((c) => c * R_KM);
      let a0 = 0,
        lo = 1e9,
        hi = -1e9;
      for (let d = 0; d < days.length; d++) {
        let a = azEl(fr, pos, days[d])[0];
        if (d === 0) a0 = a;
        a = ((a - a0 + 540) % 360) - 180;
        if (a < lo) lo = a;
        if (a > hi) hi = a;
      }
      azC[row * CELLS + col] = (((a0 + (lo + hi) / 2) % 360) + 360) % 360;
      span[row * CELLS + col] = hi - lo;
    }
  const maxSpan = Math.max(...span),
    step = Math.max(0.5, Math.ceil(((maxSpan + 3) / NBINS) * 20) / 20);
  console.log(
    `${reg.id}: sun el ${sMin.toFixed(2)}..${sMax.toFixed(2)}  earth el ${eMin.toFixed(2)}..${eMax.toFixed(2)}  earth az span max ${maxSpan.toFixed(1)} deg -> bin ${step} deg`,
  );

  const RAYS = 360 + NBINS;
  const raw = new Float32Array(CELLS * CELLS * 2 * RAYS),
    heights = new Float32Array(CELLS * CELLS);
  const nw = Math.max(1, availableParallelism() - 1);
  await new Promise<void>((resolve, reject) => {
    let next = 0,
      done = 0;
    const workers: Worker[] = [];
    const feed = (w: Worker) => {
      if (next >= CELLS) {
        w.postMessage('exit');
        return;
      }
      const row = next++;
      w.postMessage({ row, azC: azC.subarray(row * CELLS, (row + 1) * CELLS), step });
    };
    for (let i = 0; i < nw; i++) {
      const w = new Worker(new URL('./atlasWorker.ts', import.meta.url), {
        workerData: { regionId: reg.id, cx: reg.cx, cy: reg.cy, cells: CELLS, res: RES, nBins: NBINS },
      });
      w.on('message', (m: { row: number; out: Float32Array; hts: Float32Array }) => {
        raw.set(m.out, m.row * CELLS * 2 * RAYS);
        heights.set(m.hts, m.row * CELLS);
        if (++done % 16 === 0) process.stdout.write(`  rows ${done}/${CELLS}\r`);
        if (done === CELLS) {
          workers.forEach((x) => x.terminate());
          resolve();
        } else feed(w);
      });
      w.on('error', reject);
      workers.push(w);
      feed(w);
    }
  });

  // quantise into GPU-friendly layers: [layer][ray][row][col]
  const q = (v: number, lo: number, hi: number) => Math.max(0, Math.min(255, Math.round((255 * (v - lo)) / (hi - lo))));
  const sun = [new Uint8Array(360 * CELLS * CELLS), new Uint8Array(360 * CELLS * CELLS)];
  const earth = [new Uint8Array(NBINS * CELLS * CELLS), new Uint8Array(NBINS * CELLS * CELLS)];
  for (let c = 0; c < CELLS * CELLS; c++)
    for (let h = 0; h < 2; h++) {
      const base = (c * 2 + h) * RAYS;
      for (let a = 0; a < 360; a++) sun[h][a * CELLS * CELLS + c] = q(raw[base + a], sLo, sHi);
      for (let b = 0; b < NBINS; b++) earth[h][b * CELLS * CELLS + c] = q(raw[base + 360 + b], eLo, eHi);
    }
  const hts = new Int16Array(CELLS * CELLS);
  for (let i = 0; i < hts.length; i++) hts[i] = Math.round(heights[i] * 2);
  const parts = [sun[0], sun[1], earth[0], earth[1], new Uint8Array(azC.buffer), new Uint8Array(hts.buffer)];
  const sizes = parts.map((p) => p.byteLength),
    offs = sizes.map((_, i) => sizes.slice(0, i).reduce((a, b) => a + b, 0));
  const total = new Uint8Array(sizes.reduce((a, b) => a + b, 0));
  parts.forEach((p, i) => total.set(p, offs[i]));
  await writeFile(join(DATA_DIR, 'atlas', reg.id + '.bin'), total);
  await writeFile(
    join(DATA_DIR, 'atlas', reg.id + '.json'),
    JSON.stringify({
      region: reg.id,
      cells: CELLS,
      res: RES,
      cx: reg.cx,
      cy: reg.cy,
      heights: [2, 10],
      nAz: 360,
      nBins: NBINS,
      earthStep: step,
      sunRange: [sLo, sHi],
      earthRange: [eLo, eHi],
      earthAzSpanMax: maxSpan,
      layout: { sun2: offs[0], sun10: offs[1], earth2: offs[2], earth10: offs[3], earthAz0: offs[4], height: offs[5] },
      bytes: total.length,
      note: 'Layers [ray][row][col] Uint8; Sun az = ray deg (1 deg), Earth az = earthAz0[cell] + (bin-23.5)*earthStep; height Int16 @ 0.5 m; earthAz0 Float32 deg.',
    }),
  );
  console.log(
    `  ${reg.id} done in ${((performance.now() - t0) / 1000).toFixed(0)} s, ${(total.length / 1e6).toFixed(1)} MB`,
  );
}
process.exit(0);
