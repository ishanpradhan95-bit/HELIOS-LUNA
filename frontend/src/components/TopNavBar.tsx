import { Activity, Radio, Settings2 } from "lucide-react";
import { useMissionStore } from "../store/useMissionStore";
export function TopNavBar() {
  const { audience, earthCompare, setAudience, setEarthCompare } = useMissionStore();
  return <nav className="top-nav"><div className="brand"><span className="brand-mark">◒</span> HELIOS-LUNA <small>MISSION DESIGN SYSTEM</small></div><div className="nav-controls"><button className={audience === "PRO" ? "active" : ""} onClick={() => setAudience("PRO")}>MISSION CONTROL</button><button className={audience === "PUBLIC" ? "active" : ""} onClick={() => setAudience("PUBLIC")}>PUBLIC EXPLORER</button><label><input type="checkbox" checked={earthCompare} onChange={(event) => setEarthCompare(event.target.checked)} /> EARTH COMPARE</label><span className="nav-status"><Activity size={14}/> LIVE TELEMETRY</span><span className="nav-status"><Radio size={14}/> DSN LINK NOMINAL</span><Settings2 size={15}/></div></nav>;
}
