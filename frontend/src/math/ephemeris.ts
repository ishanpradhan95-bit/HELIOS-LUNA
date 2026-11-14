import { degToRad } from "./selenography";
export interface EphemerisSample { jd: number; x: number; y: number; z: number; phase: number; }
export interface LunarEphemeris { jd: number; earth: [number, number, number]; sun: [number, number, number]; earthLongitudeRad: number; earthLatitudeRad: number; }
export const julianDate = (date: Date | number) => (typeof date === "number" ? date : date.getTime()) / 86400000 + 2440587.5;
const wrap = (value: number, period: number) => ((value % period) + period) % period;
const vec = (distance: number, latitude: number, longitude: number): [number, number, number] => [distance * Math.cos(latitude) * Math.cos(longitude), distance * Math.cos(latitude) * Math.sin(longitude), distance * Math.sin(latitude)];

export function preciseLunarEphemeris(timestampMs: number): LunarEphemeris {
  const jd = julianDate(timestampMs);
  const T = (jd - 2451545) / 36525;
  const Lp = degToRad(wrap(218.3164477 + 481267.88123421 * T, 360));
  const D = degToRad(wrap(297.8501921 + 445267.1114034 * T, 360));
  const M = degToRad(wrap(357.5291092 + 35999.0502909 * T, 360));
  const Mp = degToRad(wrap(134.9633964 + 477198.8675055 * T, 360));
  const F = degToRad(wrap(93.272095 + 483202.0175233 * T, 360));
  const Omega = degToRad(wrap(125.0445479 - 1934.1362891 * T, 360));
  const inclination = degToRad(1.54242);
  const dl = degToRad(-6.2888 * Math.sin(Mp) - 1.274 * Math.sin(2 * D - Mp) - 0.6583 * Math.sin(2 * D) - 0.2136 * Math.sin(2 * Mp) + 0.1851 * Math.sin(M) + 0.1143 * Math.sin(2 * F));
  const beta = degToRad(-5.1282 * Math.sin(F) - 0.2806 * Math.sin(Mp + F) - 0.2777 * Math.sin(Mp - F) - 0.1732 * Math.sin(2 * D - F));
  const W = dl - degToRad(0.0048 * Math.sin(Omega));
  const earthLongitudeRad = Math.atan2(Math.sin(W) * Math.cos(beta) * Math.cos(inclination) - Math.sin(beta) * Math.sin(inclination), Math.cos(W) * Math.cos(beta));
  const earthLatitudeRad = Math.asin(-Math.sin(W) * Math.cos(beta) * Math.sin(inclination) - Math.sin(beta) * Math.cos(inclination));
  const earthDistance = (385000.56 - 20905.355 * Math.cos(Mp) - 3699.111 * Math.cos(2 * D - Mp) - 2955.968 * Math.cos(2 * D) - 569.925 * Math.cos(2 * Mp)) * 1000;
  const solarLongitude = wrap(earthLongitudeRad + Math.PI - D + degToRad(0.185 * Math.sin(Mp) - 0.032 * Math.sin(M)), 2 * Math.PI) - Math.PI;
  const correctedOmega = degToRad(0.012 * Math.sin(2 * F));
  const solarLatitude = degToRad(1.54242 * Math.sin(F - D + correctedOmega));
  const solarDistance = 1.495978707e11 * (1.00014 - 0.01671 * Math.cos(M) - 0.00014 * Math.cos(2 * M));
  return { jd, earth: vec(earthDistance, earthLatitudeRad, earthLongitudeRad), sun: vec(solarDistance, solarLatitude, solarLongitude), earthLongitudeRad, earthLatitudeRad };
}

export function lunarEphemeris(jd: number): EphemerisSample {
  const sample = preciseLunarEphemeris((jd - 2440587.5) * 86400000);
  return { jd, x: sample.earth[0] / 1000, y: sample.earth[1] / 1000, z: sample.earth[2] / 1000, phase: (1 + Math.cos(sample.earthLongitudeRad)) / 2 };
}
