import { useMissionStore } from "../store/useMissionStore";
import { mastMassKg } from "../math/solarPhysics";
export function MastTradeoffPanel() {
  const { antennaM, radiatorM2, mastHeightM, setAntenna, setRadiator, setMastHeight } = useMissionStore();
  return <section className="panel tradeoff"><div className="section-title">MAST / THERMAL TRADE SPACE <span>PARAMETRIC</span></div><label>MAST HEIGHT <output>{mastHeightM.toFixed(1)} m</output><input type="range" min="0" max="20" step=".1" value={mastHeightM} onChange={(e) => setMastHeight(Number(e.target.value))}/></label><label>ANTENNA DIAMETER <output>{antennaM.toFixed(1)} m</output><input type="range" min="1" max="5" step=".1" value={antennaM} onChange={(e) => setAntenna(Number(e.target.value))}/></label><label>RADIATOR AREA <output>{radiatorM2.toFixed(0)} m²</output><input type="range" min="12" max="60" step="1" value={radiatorM2} onChange={(e) => setRadiator(Number(e.target.value))}/></label><div className="tradeoff-chart"><span style={{ width: `${mastHeightM * 5}%` }}>MAST MASS {mastMassKg(mastHeightM).toFixed(1)} kg</span><span style={{ width: `${radiatorM2}%` }}>THERMAL REJECTION</span></div></section>;
}
