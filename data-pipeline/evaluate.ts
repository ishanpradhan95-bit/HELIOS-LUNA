/**
 * Batch evaluation from the command line: the same engine as the app, for scripted studies.
 *   npm run evaluate -- sites.csv --start 2027-01-15T06:00 --days 7 --mast 2 [--profile artemis|clps|default] [--network dsn|estrack|both]
 * sites.csv: a header row, then name,lat,lon per line (planetocentric degrees, east longitude). Writes CSV to stdout.
 */
import { readFile } from 'node:fs/promises';
import { Engine } from '../frontend/src/math/engine';
import { DEFAULT_CONFIG, PROFILES, grade } from '../frontend/src/math/analysis';
import { stationsFor, type Network } from '../frontend/src/data/networks';
import { nodeSource } from './nodeSource';

const args = process.argv.slice(2);
const opt = (k: string, d: string) => {
  const i = args.indexOf('--' + k);
  return i >= 0 && args[i + 1] ? args[i + 1] : d;
};
const file = args.find((a) => !a.startsWith('--') && !args[args.indexOf(a) - 1]?.startsWith('--'));
if (!file) {
  console.error('usage: npm run evaluate -- sites.csv --start 2027-01-15T06:00 --days 7 --mast 2 --profile default');
  process.exit(2);
}
const start = Date.parse(opt('start', '2027-01-15T00:00') + 'Z'),
  prof = PROFILES.find((p) => p.id === opt('profile', 'default')) ?? PROFILES[2],
  days = +opt('days', String(prof.duration)),
  z = +opt('mast', '2'),
  net = opt('network', 'dsn') as Network;
if (!isFinite(start)) throw new Error('bad --start');

const eng = new Engine(nodeSource);
await eng.init();
eng.setStations(stationsFor(net, []));
const cfg = { ...DEFAULT_CONFIG, z, stations: stationsFor(net, []) };
const rows = (await readFile(file, 'utf8'))
  .split(/\r?\n/)
  .slice(1)
  .map((l) => l.split(',').map((x) => x.trim()))
  .filter((r) => r.length >= 3 && isFinite(+r[1]) && isFinite(+r[2]));
const head = [
  'name',
  'lat',
  'lon',
  'terrain',
  'grade',
  'sunlit_pct',
  'longest_dark_h',
  'link_pct',
  'longest_outage_h',
  'power_and_link_pct',
  'sun_el_max_deg',
  'earth_el_max_deg',
  'sunset_after_touchdown_h',
  'earthset_after_touchdown_h',
];
console.log(
  `# HELIOS-LUNA batch: touchdown ${new Date(start).toISOString()}, ${days} d, mast ${z} m, profile ${prof.name}, network ${net}`,
);
console.log(head.join(','));
for (const [name, la, lo] of rows) {
  const site = await eng.site({ id: name, label: name, lat: +la, lon: +lo });
  const a = eng.analyze(site, { startMs: start, days }, cfg),
    e = eng.events(site, cfg, start, 40),
    m = a.summary;
  const h = (n: number | null) => (n == null ? '' : ((n - start) / 3.6e6).toFixed(1));
  console.log(
    [
      JSON.stringify(name),
      la,
      lo,
      site.quality,
      grade(m, prof.req).grade,
      m.sunPct.toFixed(1),
      m.longestDarkH.toFixed(1),
      m.dtePct.toFixed(1),
      m.longestOutageH.toFixed(1),
      m.bothPct.toFixed(1),
      m.sunElMax.toFixed(2),
      m.earthElMax.toFixed(2),
      e.sun.up ? h(e.sun.next) : '0',
      e.earth.up ? h(e.earth.next) : '0',
    ].join(','),
  );
}
process.exit(0);
