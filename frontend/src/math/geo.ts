// Shared geometry. MOON_ME body-fixed frame, +Z = north pole, lon 0 toward +X. Distances in metres unless noted.
export const R_M = 1_737_400;
export const R_KM = 1737.4;
export const DEG = Math.PI / 180;
export const SUN_RADIUS_KM = 695_700;
export const EARTH_RADIUS_KM = 6371;

export interface Frame {
  n: [number, number, number];
  e: [number, number, number];
  north: [number, number, number];
  lat: number;
  lon: number;
}

/** Local up / east / north unit vectors at planetocentric lat, lon (degrees). */
export function siteFrame(latDeg: number, lonDeg: number): Frame {
  const la = latDeg * DEG,
    lo = lonDeg * DEG;
  const cl = Math.cos(la),
    sl = Math.sin(la),
    co = Math.cos(lo),
    so = Math.sin(lo);
  return { n: [cl * co, cl * so, sl], e: [-so, co, 0], north: [-sl * co, -sl * so, cl], lat: latDeg, lon: lonDeg };
}

/** South-polar stereographic (LOLA, true at the pole): x = 2R n_y/(1-n_z), y = 2R n_x/(1-n_z)  [PDS: x=rho sin(lon), y=rho cos(lon)]. */
export function toStereo(n: [number, number, number]): [number, number] {
  const s = (2 * R_M) / (1 - n[2]);
  return [s * n[1], s * n[0]];
}
export function fromStereo(x: number, y: number): [number, number, number] {
  const rho = Math.hypot(x, y);
  if (rho < 1e-9) return [0, 0, -1];
  const g = 2 * Math.atan(rho / (2 * R_M));
  const sg = Math.sin(g);
  return [(sg * y) / rho, (sg * x) / rho, -Math.cos(g)];
}
export function latLonFromN(n: [number, number, number]): [number, number] {
  return [Math.asin(Math.max(-1, Math.min(1, n[2]))) / DEG, Math.atan2(n[1], n[0]) / DEG];
}

export const dot = (a: ArrayLike<number>, b: ArrayLike<number>) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
export const wrap360 = (a: number) => ((a % 360) + 360) % 360;

/** Rotate v by unit quaternion q = (w,x,y,z) into out. */
export function quatRotate(q: ArrayLike<number>, v: ArrayLike<number>, out: number[] | Float64Array, o = 0) {
  const w = q[0],
    x = q[1],
    y = q[2],
    z = q[3];
  const vx = v[0],
    vy = v[1],
    vz = v[2];
  const tx = 2 * (y * vz - z * vy),
    ty = 2 * (z * vx - x * vz),
    tz = 2 * (x * vy - y * vx);
  out[o] = vx + w * tx + (y * tz - z * ty);
  out[o + 1] = vy + w * ty + (z * tx - x * tz);
  out[o + 2] = vz + w * tz + (x * ty - y * tx);
}

/** WGS84 geodetic -> ECEF (km) and local up unit vector. */
export function geodeticToEcef(latDeg: number, lonDeg: number, hM: number) {
  const a = 6378137.0,
    f = 1 / 298.257223563,
    e2 = f * (2 - f);
  const la = latDeg * DEG,
    lo = lonDeg * DEG;
  const N = a / Math.sqrt(1 - e2 * Math.sin(la) ** 2);
  const pos: [number, number, number] = [
    ((N + hM) * Math.cos(la) * Math.cos(lo)) / 1000,
    ((N + hM) * Math.cos(la) * Math.sin(lo)) / 1000,
    ((N * (1 - e2) + hM) * Math.sin(la)) / 1000,
  ];
  const up: [number, number, number] = [Math.cos(la) * Math.cos(lo), Math.cos(la) * Math.sin(lo), Math.sin(la)];
  return { pos, up };
}
