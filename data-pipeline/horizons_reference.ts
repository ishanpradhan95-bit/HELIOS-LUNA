/**
 * Reference Sun and Earth positions from NASA/JPL Horizons (https://ssd.jpl.nasa.gov/api/horizons.api) for observers on
 * the lunar surface, for validate.ts test 12. Horizons is queried with CENTER='coord@301' (MEAN_ME frame, 1737.4 km
 * sphere, airless) and QUANTITIES='4' (apparent azimuth and elevation), at off-grid UTC epochs 2026-2044.
 * Output: data-pipeline/reference/horizons_reference.json (small, committed, so validation runs offline).
 * usage: tsx data-pipeline/horizons_reference.ts
 */
import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';

const SITES: [string, number, number][] = [
  ['South pole, Shackleton rim', -89.54, 129.0],
  ['Malapert Massif', -85.99, 0.15],
  ['Mons Mouton', -84.79, 29.2],
  ['Chandrayaan-3', -69.3733, 32.3191],
  ['Apollo 15', 26.13222, 3.63386],
  ["Chang'e 4 (far side)", -45.4446, 177.5991],
];
const BODIES: [string, string][] = [
  ['sun', '10'],
  ['earth', '399'],
];

// deterministic off-grid epochs (not on the hourly bake nodes)
let seed = 12;
const rnd = () => ((seed = (seed * 16807) % 2147483647) - 1) / 2147483646;
const t0 = Date.UTC(2026, 0, 2),
  t1 = Date.UTC(2044, 11, 30);

const out: {
  site: string;
  lat: number;
  lon: number;
  unixMs: number;
  sun?: [number, number];
  earth?: [number, number];
}[] = [];
for (const [name, lat, lon] of SITES) {
  const times = Array.from({ length: 12 }, () => Math.round((t0 + rnd() * (t1 - t0)) / 1000) * 1000).sort(
    (a, b) => a - b,
  );
  const rows = times.map((unixMs) => ({ site: name, lat, lon, unixMs }) as (typeof out)[number]);
  for (const [key, code] of BODIES) {
    const q = new URLSearchParams({
      format: 'json',
      COMMAND: `'${code}'`,
      EPHEM_TYPE: "'OBSERVER'",
      CENTER: "'coord@301'",
      COORD_TYPE: "'GEODETIC'",
      SITE_COORD: `'${lon},${lat},0'`,
      TLIST: `'${times.map((t) => (t / 86400000 + 2440587.5).toFixed(9)).join(' ')}'`,
      TLIST_TYPE: "'JD'",
      TIME_TYPE: "'UT'",
      QUANTITIES: "'4'",
      ANG_FORMAT: "'DEG'",
      CSV_FORMAT: "'YES'",
      EXTRA_PREC: "'YES'",
    });
    const res = await fetch('https://ssd.jpl.nasa.gov/api/horizons.api?' + q.toString());
    if (!res.ok) throw new Error(`Horizons HTTP ${res.status}`);
    const txt: string = (await res.json()).result;
    const body = txt.split('$$SOE')[1]?.split('$$EOE')[0];
    if (!body) throw new Error(`no ephemeris in Horizons reply for ${name} ${key}:\n${txt.slice(0, 1500)}`);
    const lines = body.trim().split('\n');
    if (lines.length !== times.length) throw new Error(`expected ${times.length} rows, got ${lines.length}`);
    lines.forEach((ln, i) => {
      const f = ln.split(',').map((x) => x.trim());
      const nums = f.filter((x) => x !== '' && isFinite(+x)).map(Number);
      const [az, el] = nums.slice(-2);
      rows[i][key as 'sun' | 'earth'] = [az, el];
    });
    console.log(`${name} ${key}: ${lines.length} epochs`);
  }
  out.push(...rows);
}
const dir = join(import.meta.dirname, 'reference');
await mkdir(dir, { recursive: true });
await writeFile(
  join(dir, 'horizons_reference.json'),
  JSON.stringify(
    {
      source: 'NASA/JPL Horizons API (DE441), CENTER=coord@301, QUANTITIES=4 (apparent AZ/EL, airless)',
      retrieved: new Date().toISOString(),
      samples: out,
    },
    null,
    1,
  ),
);
console.log('wrote', out.length, 'samples');
