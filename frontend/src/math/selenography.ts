import type { LunarSite } from "../types/mission";
export const MOON_RADIUS_M = 1_737_400;
export const degToRad = (value: number) => value * Math.PI / 180;
export const radToDeg = (value: number) => value * 180 / Math.PI;
const clamp = (value: number, min: number, max: number) => Math.min(max, Math.max(min, value));

export interface Selenographic { latitudeRad: number; longitudeRad: number; }
export interface EnuLook { azimuthRad: number; elevationRad: number; distanceM: number; }

export function stereographicToSelenographic(x: number, y: number): Selenographic {
  const rho = Math.hypot(x, y);
  if (rho === 0) return { latitudeRad: -Math.PI / 2, longitudeRad: 0 };
  const c = 2 * Math.atan(rho / (2 * MOON_RADIUS_M));
  return { latitudeRad: c - Math.PI / 2, longitudeRad: Math.atan2(x, y) };
}

export function selenographicToStereographic(latitudeRad: number, longitudeRad: number): [number, number] {
  const rho = 2 * MOON_RADIUS_M * Math.tan(Math.PI / 4 + latitudeRad / 2);
  return [rho * Math.sin(longitudeRad), rho * Math.cos(longitudeRad)];
}

export function bodyToTopocentric(
  latitudeRad: number,
  longitudeRad: number,
  elevationM: number,
  mastHeightM: number,
  bodyPositionM: [number, number, number],
): EnuLook {
  const radius = MOON_RADIUS_M + elevationM + mastHeightM;
  const site: [number, number, number] = [
    radius * Math.cos(latitudeRad) * Math.cos(longitudeRad),
    radius * Math.cos(latitudeRad) * Math.sin(longitudeRad),
    radius * Math.sin(latitudeRad),
  ];
  const delta: [number, number, number] = [bodyPositionM[0] - site[0], bodyPositionM[1] - site[1], bodyPositionM[2] - site[2]];
  const distanceM = Math.hypot(...delta);
  const unit = delta.map((component) => component / distanceM) as [number, number, number];
  const east: [number, number, number] = [-Math.sin(longitudeRad), Math.cos(longitudeRad), 0];
  const north: [number, number, number] = [-Math.sin(latitudeRad) * Math.cos(longitudeRad), -Math.sin(latitudeRad) * Math.sin(longitudeRad), Math.cos(latitudeRad)];
  const up: [number, number, number] = [Math.cos(latitudeRad) * Math.cos(longitudeRad), Math.cos(latitudeRad) * Math.sin(longitudeRad), Math.sin(latitudeRad)];
  const dot = (a: [number, number, number], b: [number, number, number]) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
  return { azimuthRad: (Math.atan2(dot(unit, east), dot(unit, north)) + Math.PI * 2) % (Math.PI * 2), elevationRad: Math.asin(clamp(dot(unit, up), -1, 1)), distanceM };
}

export const haversineKm = (a: LunarSite, b: LunarSite) => {
  const dLat = degToRad(b.lat - a.lat), dLon = degToRad(b.lon - a.lon);
  const x = Math.sin(dLat / 2) ** 2 + Math.cos(degToRad(a.lat)) * Math.cos(degToRad(b.lat)) * Math.sin(dLon / 2) ** 2;
  return 1737.4 * 2 * Math.atan2(Math.sqrt(x), Math.sqrt(1 - x));
};
export const localSolarElevation = (site: LunarSite, lunarDay: number) =>
  Math.max(-90, Math.min(90, 90 * Math.sin(2 * Math.PI * lunarDay + degToRad(site.lon)) * Math.cos(degToRad(site.lat))));
