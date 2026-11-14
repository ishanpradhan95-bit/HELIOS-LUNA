import { useMemo } from "react";
import { calculatePareto } from "../math/pareto";
export function ParetoExplorerModal() {
  const points = useMemo(calculatePareto, []);
  return <section className="panel pareto"><div className="section-title">PARETO EXPLORER <span>{points.length} NON-DOMINATED DESIGNS</span></div><div className="pareto-chart">{points.slice(0, 24).map((p) => <i key={`${p.antennaM}-${p.radiatorM2}`} style={{ left: `${p.mass / 2}%`, bottom: `${p.margin * 2}%` }} title={`${p.antennaM.toFixed(1)}m / ${p.radiatorM2}m²`}/>)}</div><small>Mass ↓ / link margin ↑ · select a point to pin a design</small></section>;
}
