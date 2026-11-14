import { useEffect, useMemo } from "react";
import { TopNavBar } from "./components/TopNavBar";
import { Viewport3D } from "./components/Viewport3D";
import { HorizonPanorama } from "./components/HorizonPanorama";
import { GoldenWindowMatrix } from "./components/GoldenWindowMatrix";
import { MastTradeoffPanel } from "./components/MastTradeoffPanel";
import { SurvivalSimulator } from "./components/SurvivalSimulator";
import { ParetoExplorerModal } from "./components/ParetoExplorerModal";
import { SITES } from "./types/mission";
import { useMissionStore } from "./store/useMissionStore";
import { linkMargin } from "./math/linkBudget";
import { thermalModel } from "./math/thermalModel";

export function App() {
  const { selectedSite, date, powerKw, antennaM, radiatorM2, setPower, selectSite } = useMissionStore();
  const site = SITES.find((item) => item.id === selectedSite) ?? SITES[0];
  const thermal = useMemo(() => thermalModel(site.illumination, radiatorM2, powerKw), [site.illumination, radiatorM2, powerKw]);
  const margin = useMemo(() => linkMargin(antennaM, site.elevation), [antennaM, site.elevation]);

  useEffect(() => {
    const timer = window.setInterval(() => useMissionStore.setState({ date: new Date().toISOString() }), 1000);
    return () => window.clearInterval(timer);
  }, []);

  return (
    <main className="mission-shell">
      <TopNavBar />
      <header className="hero">
        <div>
          <p className="kicker">HELIOS-LUNA / LUNAR SOUTH POLE</p>
          <h1>Find the <em>golden hour.</em></h1>
          <p className="lede">A deterministic mission design instrument for permanent-light infrastructure, communications and survival at the lunar poles.</p>
        </div>
        <div className="mission-clock">
          <span>MISSION CLOCK</span>
          <strong>{new Date(date).toISOString().slice(0, 19).replace("T", " ")}</strong>
          <small>UTC · SIMULATION EPOCH 2026.11.13</small>
        </div>
      </header>
      <section className="site-tabs">
        {SITES.map((item) => (
          <button className={item.id === selectedSite ? "selected" : ""} key={item.id} onClick={() => selectSite(item.id)}>
            <b>{item.name}</b>
            <small>{item.lat.toFixed(2)}° LAT · {item.illumination > 0.75 ? "HIGH LIGHT" : "VARIABLE LIGHT"}</small>
          </button>
        ))}
      </section>
      <div className="main-grid">
        <Viewport3D site={site} />
        <aside className="metrics panel">
          <div className="section-title">LIVE SITE TELEMETRY <span>● NOMINAL</span></div>
          <div className="metric-big"><strong>{Math.round(site.illumination * 100)}%</strong><small>ILLUMINATION ACCESS</small></div>
          <dl>
            <div><dt>LINK MARGIN</dt><dd className={margin > 0 ? "good" : "warn"}>{margin.toFixed(1)} dB</dd></div>
            <div><dt>THERMAL EQUILIBRIUM</dt><dd>{thermal.equilibriumK.toFixed(0)} K</dd></div>
            <div><dt>POWER BALANCE</dt><dd>{(site.illumination * 31 - powerKw).toFixed(1)} kW</dd></div>
            <div><dt>ELEVATION / RELIEF</dt><dd>{site.elevation.toLocaleString()} m</dd></div>
          </dl>
          <label className="power-control">BASELOAD <output>{powerKw} kW</output><input type="range" min="8" max="30" step="1" value={powerKw} onChange={(event) => setPower(Number(event.target.value))} /></label>
        </aside>
      </div>
      <div className="lower-grid">
        <HorizonPanorama site={site} />
        <MastTradeoffPanel />
        <SurvivalSimulator days={Math.round(120 * site.illumination + thermal.marginK / 3)} />
        <ParetoExplorerModal />
      </div>
      <GoldenWindowMatrix sites={SITES} selected={selectedSite} />
      <footer><span>HLN // MISSION DESIGN SYSTEM v1.0</span><span>DETERMINISTIC FALLBACK DATA · NASA SPICE / HORIZONS READY</span></footer>
    </main>
  );
}

export default App;
