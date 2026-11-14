export interface ParetoPoint {
  antennaM: number;
  radiatorM2: number;
  margin: number;
  mass: number;
}

export function calculatePareto(): ParetoPoint[] {
  const points: ParetoPoint[] = [];
  for (let antennaM = 1; antennaM <= 5; antennaM += 0.25) {
    for (let radiatorM2 = 12; radiatorM2 <= 60; radiatorM2 += 4) {
      points.push({
        antennaM,
        radiatorM2,
        margin: 8 + antennaM * 5 + radiatorM2 * 0.08,
        mass: antennaM * 34 + radiatorM2 * 2.2,
      });
    }
  }
  return points.filter((point) => !points.some((candidate) =>
    candidate.mass <= point.mass &&
    candidate.margin >= point.margin &&
    (candidate.mass < point.mass || candidate.margin > point.margin),
  ));
}
