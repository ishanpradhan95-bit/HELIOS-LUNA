export const freeSpaceLoss = (distanceM: number, frequencyHz: number) => 20 * Math.log10(distanceM) + 20 * Math.log10(frequencyHz) - 147.55;
export interface LinkBudget { blocked: boolean; terrainLossDb: number; kaMbps: number; sKbps: number; cn0DbHz: number; }
export function terrainLoss(clearanceDeg: number): number {
  if (clearanceDeg <= -0.15) return Infinity;
  if (clearanceDeg <= 0) return 22 + 180 * Math.abs(clearanceDeg);
  if (clearanceDeg < 2.2) {
    const psi = clearanceDeg * Math.PI / 180;
    const er = 3;
    const gamma = Math.abs((Math.sin(psi) - Math.sqrt(er - Math.cos(psi) ** 2)) / (Math.sin(psi) + Math.sqrt(er - Math.cos(psi) ** 2)));
    return 16.5 * gamma * Math.exp(-1.35 * clearanceDeg);
  }
  return 0.8 * Math.exp(-0.5 * clearanceDeg);
}
export function linkBudget(distanceM: number, earthElevationDeg: number, horizonDeg: number): LinkBudget {
  const clearance = earthElevationDeg - horizonDeg;
  const loss = terrainLoss(clearance);
  if (!Number.isFinite(loss) || clearance <= 0) return { blocked: true, terrainLossDb: loss, kaMbps: 0, sKbps: clearance > -0.15 && clearance < 1.5 ? 10 : 0, cn0DbHz: -Infinity };
  const cn0 = 48 - freeSpaceLoss(distanceM, 26e9) - loss + 66.5 - (-228.6);
  const kaMbps = Math.min(150, 10 ** ((cn0 - 6.5 - 60) / 10));
  const sKbps = clearance < 1.5 ? Math.max(10, Math.min(250, kaMbps * 1000 * 0.02)) : 0;
  return { blocked: false, terrainLossDb: loss, kaMbps, sKbps, cn0DbHz: cn0 };
}
export function linkMargin(antennaM: number, siteElevationM: number, weatherLoss = 2.5): number {
  const gain = 10 * Math.log10(Math.max(0.1, antennaM) ** 2 * 0.65);
  return 30 + gain + Math.log10(Math.max(1, siteElevationM)) - freeSpaceLoss(384400000, 26e9) - weatherLoss;
}
