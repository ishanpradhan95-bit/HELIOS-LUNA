// Permanently shadowed regions (possible water ice) from the PGDA average-illumination map, baked by
// data-pipeline/bake_psr.py into a 120 m bit mask covering 85–90°S.
import { useEffect, useState } from 'react';
import { BASE } from '../store/useStore';
import { siteFrame, toStereo, wrap360 } from './geo';

interface Grid {
  n: number;
  cell: number;
  half: number;
  bits: Uint8Array;
}
let grid: Promise<Grid | null> | null = null;
function load() {
  grid ??= Promise.all([
    fetch(BASE + 'psr_120.json').then((r) => (r.ok ? r.json() : Promise.reject())),
    fetch(BASE + 'psr_120.bin').then((r) => (r.ok ? r.arrayBuffer() : Promise.reject())),
  ]).then(
    ([m, b]) => ({ n: m.n, cell: m.cell_m, half: m.half_extent_m, bits: new Uint8Array(b) }),
    () => null,
  );
  return grid;
}

export interface Psr {
  /** Distance to the nearest permanently shadowed 120 m cell, km (0 if the site itself is in one). */
  km: number;
  /** Direction to it, degrees clockwise from local north. */
  az: number;
  /** Area of permanent shadow within 5 km, km². */
  areaKm2: number;
  /** North-up PATCH×PATCH raster of permanent shadow (1) around the site, ±5 km, 120 m pixels. */
  patch: Uint8Array;
}
export const PATCH = 84;
/** null while loading; 'none' outside 85–90°S coverage or no shadow within the search radius. */
export type PsrResult = Psr | 'none' | null;

const MAX_KM = 40;
function nearest(g: Grid, lat: number, lon: number): Psr | 'none' {
  const [x, y] = toStereo(siteFrame(lat, lon).n);
  const c0 = Math.floor((x + g.half) / g.cell),
    r0 = Math.floor((g.half - y) / g.cell);
  if (c0 < 0 || r0 < 0 || c0 >= g.n || r0 >= g.n) return 'none';
  const at = (r: number, c: number) => {
    if (r < 0 || c < 0 || r >= g.n || c >= g.n) return false;
    const i = r * g.n + c;
    return (g.bits[i >> 3] >> (7 - (i & 7))) & 1;
  };
  const R = Math.ceil((MAX_KM * 1000) / g.cell),
    A = Math.ceil(5000 / g.cell);
  let best = Infinity,
    bdx = 0,
    bdy = 0,
    area = 0;
  for (let k = 0; k <= R; k++) {
    if ((k - 1) * g.cell > best && k > A) break;
    for (let dr = -k; dr <= k; dr++)
      for (let dc = -k; dc <= k; dc++) {
        if (Math.max(Math.abs(dr), Math.abs(dc)) !== k || !at(r0 + dr, c0 + dc)) continue;
        // cell centre in stereographic metres, relative to the site
        const dx = (c0 + dc + 0.5) * g.cell - g.half - x,
          dy = g.half - (r0 + dr + 0.5) * g.cell - y,
          d = k === 0 ? 0 : Math.hypot(dx, dy);
        if (d <= 5000) area += (g.cell * g.cell) / 1e6;
        if (d < best) [best, bdx, bdy] = [d, dx, dy];
      }
  }
  if (!isFinite(best)) return 'none';
  // local north points away from the south pole in this projection; east is (y, -x)
  const rho = Math.hypot(x, y) || 1;
  const nComp = (bdx * x + bdy * y) / rho,
    eComp = (bdx * y - bdy * x) / rho;
  const patch = new Uint8Array(PATCH * PATCH),
    h = PATCH / 2,
    ux = x / rho,
    uy = y / rho;
  for (let j = 0; j < PATCH; j++)
    for (let i = 0; i < PATCH; i++) {
      const E = (i + 0.5 - h) * g.cell,
        N = (h - j - 0.5) * g.cell;
      const px = x + N * ux + E * uy,
        py = y + N * uy - E * ux;
      patch[j * PATCH + i] = at(Math.floor((g.half - py) / g.cell), Math.floor((px + g.half) / g.cell)) ? 1 : 0;
    }
  return { km: best / 1000, az: wrap360((Math.atan2(eComp, nComp) * 180) / Math.PI), areaKm2: area, patch };
}

export function usePsr(lat: number | undefined, lon: number | undefined): PsrResult {
  const [v, setV] = useState<PsrResult>(null);
  useEffect(() => {
    if (lat === undefined || lon === undefined) return;
    if (lat > -84.9) return setV('none');
    let live = true;
    setV(null);
    load().then((g) => live && setV(g ? nearest(g, lat, lon) : 'none'));
    return () => {
      live = false;
    };
  }, [lat, lon]);
  return v;
}

const DIRS = ['N', 'NE', 'E', 'SE', 'S', 'SW', 'W', 'NW'];
export const compass = (az: number) => DIRS[Math.round(az / 45) % 8];
/** Short label, e.g. "1.4 km SE" or "on site". */
export function psrLabel(p: Psr) {
  return p.km < 0.12 ? 'on site' : `${p.km < 10 ? p.km.toFixed(1) : p.km.toFixed(0)} km ${compass(p.az)}`;
}
