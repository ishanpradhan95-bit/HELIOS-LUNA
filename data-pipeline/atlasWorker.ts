import { parentPort, workerData } from 'node:worker_threads';
import { Engine } from '../frontend/src/math/engine';
import { computeEnvelope } from '../frontend/src/math/horizon';
import { fromStereo, latLonFromN, siteFrame } from '../frontend/src/math/geo';
import { nodeSource } from './nodeSource';

const { regionId, cx, cy, cells, res, nBins } = workerData as {
  regionId: string;
  cx: number;
  cy: number;
  cells: number;
  res: number;
  nBins: number;
};
const eng = new Engine(nodeSource);
await eng.init();
const pyr = await eng.pyramid(regionId);
const NAZ = 360,
  RAYS = NAZ + nBins;
const azList = new Float64Array(RAYS);
for (let i = 0; i < NAZ; i++) azList[i] = i;

parentPort!.on('message', (m: { row: number; azC: Float32Array; step: number } | 'exit') => {
  if (m === 'exit') process.exit(0);
  const { row, azC, step } = m;
  const out = new Float32Array(cells * 2 * RAYS),
    hts = new Float32Array(cells);
  const y = cy + ((cells - 1) / 2 - row) * res;
  for (let col = 0; col < cells; col++) {
    const x = cx + (col - (cells - 1) / 2) * res;
    const n = fromStereo(x, y),
      [lat, lon] = latLonFromN(n);
    for (let b = 0; b < nBins; b++) azList[NAZ + b] = (azC[col] + (b - (nBins - 1) / 2) * step + 720) % 360;
    const env = computeEnvelope(pyr, lat, lon, { naz: RAYS, zmax: 50, maxDistM: 300_000 }, siteFrame(lat, lon), azList);
    env.elevationDeg(2, out.subarray(col * 2 * RAYS, (col * 2 + 1) * RAYS) as Float32Array);
    env.elevationDeg(10, out.subarray((col * 2 + 1) * RAYS, (col * 2 + 2) * RAYS) as Float32Array);
    hts[col] = env.groundHeight;
  }
  parentPort!.postMessage({ row, out, hts });
});
