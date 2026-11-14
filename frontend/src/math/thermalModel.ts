export interface ThermalResult { equilibriumK: number; marginK: number; safe: boolean; }
export function thermalModel(illumination: number, radiatorM2: number, powerKw: number): ThermalResult {
  const input = (1 - 0.12) * 1361 * Math.max(0, illumination) * Math.sin(Math.max(0.035, 0.12)) + 0.018 + 0.14 + powerKw * 1000 / Math.max(1, radiatorM2);
  const equilibriumK = Math.pow(input / (0.96 * 5.670374e-8), 0.25);
  const marginK = 390 - equilibriumK;
  return { equilibriumK, marginK, safe: marginK > 0 };
}

export function shadowTemperature(initialK: number, hours: number): number {
  return Math.max(38, (initialK ** -3 + 1.85e-7 * Math.max(0, hours) ** 0.55) ** (-1 / 3));
}

export function heaterPower(surfaceK: number, maxPowerW = 900): number {
  return surfaceK >= 180 ? 0 : maxPowerW * ((180 - surfaceK) / 140) ** 1.3;
}
