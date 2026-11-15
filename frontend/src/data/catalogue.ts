import missions from './missions.json';
import type { Region, SiteRef } from '../math/engine';

export interface CatEntry extends SiteRef {
  group: string;
  groupName: string;
  note?: string;
  year?: number | null;
  search: string;
}

/** Every pickable site: the Artemis III candidate sites (Wueller et al. 2026) plus the curated mission list. */
export function buildCatalogue(regions: Region[]): CatEntry[] {
  const out: CatEntry[] = [];
  for (const r of regions)
    for (const s of r.sites) {
      const group = r.artemis3 ? 'artemis' : 'classic';
      out.push({
        id: s.id,
        label: `${r.name} · ${s.id}`,
        lat: s.lat,
        lon: s.lon,
        group,
        groupName: r.artemis3 ? 'Artemis III candidate sites' : 'Teaching sites',
        note: r.artemis3 ? `${r.name} region (NASA, 2024); site from Wueller et al. 2026` : r.name,
        search: `${s.id} ${r.name} ${r.artemis3 ? 'artemis' : ''}`.toLowerCase(),
      });
    }
  for (const g of missions.groups)
    for (const s of g.sites)
      out.push({
        id: s.id,
        label: `${s.place} · ${s.id}`,
        lat: s.lat,
        lon: s.lon,
        group: g.id,
        groupName: g.name,
        note: s.note,
        year: s.year,
        search: `${s.id} ${s.place} ${s.note} ${g.name} ${s.year ?? ''}`.toLowerCase(),
      });
  return out;
}

/** "lat, lon" (or "lat lon"; S/W letters allowed) to a custom site, or null. */
export function parseCoords(q: string): SiteRef | null {
  const m = q.trim().match(/^(-?\d+(?:\.\d+)?)\s*°?\s*([NS])?[\s,;]+(-?\d+(?:\.\d+)?)\s*°?\s*([EW])?$/i);
  if (!m) return null;
  let lat = +m[1],
    lon = +m[3];
  if (m[2]?.toUpperCase() === 'S') lat = -Math.abs(lat);
  if (m[4]?.toUpperCase() === 'W') lon = -Math.abs(lon);
  if (Math.abs(lat) > 90 || Math.abs(lon) > 360) return null;
  if (lon > 180) lon -= 360;
  return customRef(lat, lon);
}
export const customRef = (lat: number, lon: number): SiteRef => ({
  id: `Custom ${lat.toFixed(3)} ${lon.toFixed(3)}`,
  label: `Custom ${lat.toFixed(3)}°, ${lon.toFixed(3)}°`,
  lat,
  lon,
});
