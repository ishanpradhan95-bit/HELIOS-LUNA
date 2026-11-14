const SOLAR_CONSTANT = 1361;
export const sunAngularRadiusRad = (distanceM: number) => Math.asin(6.957e8 / distanceM);
export const solarDiskFraction = (u: number) => u <= -1 ? 0 : u >= 1 ? 1 : 0.5 + (u * Math.sqrt(1 - u * u) + Math.asin(u)) / Math.PI;
export const mastHorizonInterpolation = (z: number, theta0: number, theta5: number, theta20: number) => {
  const l0 = (z - 5) * (z - 20) / 100;
  const l1 = -z * (z - 20) / 75;
  const l2 = z * (z - 5) / 300;
  return l0 * theta0 + l1 * theta5 + l2 * theta20;
};
export const mastMassKg = (z: number) => 12.5 + 3.2 * z + 0.085 * z * z;
export function solarFlux(astronomicalUnits = 1): number { return SOLAR_CONSTANT / (astronomicalUnits * astronomicalUnits); }
export function absorbedPower(area: number, efficiency: number, illumination: number): number { return solarFlux() * area * efficiency * illumination / 1000; }
export function generatedPower(areaM2: number, distanceM: number, surfaceK: number, sunElevationDeg: number, fraction: number): number {
  const etaTemp = 0.32 * (1 - 0.0022 * (Math.min(380, Math.max(120, surfaceK)) - 298.15));
  const etaShade = fraction * (0.35 + 0.65 * Math.sqrt(Math.max(0, fraction)));
  return areaM2 * SOLAR_CONSTANT * (1.4959787e11 / distanceM) ** 2 * etaTemp * etaShade * Math.cos(sunElevationDeg * Math.PI / 180);
}
export function blackBodyTemperature(powerW: number, areaM2: number, emissivity = 0.9): number {
  return Math.pow(Math.max(1, powerW / (5.670374419e-8 * Math.max(0.1, areaM2) * emissivity)), 0.25);
}
