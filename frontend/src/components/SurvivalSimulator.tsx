import { useMissionStore } from "../store/useMissionStore";
export function SurvivalSimulator({ days }: { days: number }) {
  const { simulationRunning, toggleSimulation } = useMissionStore();
  return <section className="panel survival"><div className="section-title">SURVIVAL SIMULATOR <span>{simulationRunning ? "RUNNING" : "PAUSED"}</span></div><div className="survival-score"><strong>{days}</strong><small>EARTH DAYS AUTONOMOUS</small></div><button onClick={toggleSimulation}>{simulationRunning ? "PAUSE SIMULATION" : "RESUME SIMULATION"}</button><div className="progress"><i style={{ width: `${Math.min(100, days / 2)}%` }}/></div></section>;
}
