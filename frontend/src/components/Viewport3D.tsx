import { useMemo } from "react";
import type { LunarSite } from "../types/mission";
export function Viewport3D({ site }: { site: LunarSite }) {
  const stars = useMemo(
    () => Array.from({ length: 42 }, (_, index) => ({ left: `${(index * 37) % 100}%`, top: `${(index * 61) % 100}%` })),
    [],
  );
  return (
    <section className="viewport panel">
      <div className="viewport-label">LUNAR SOUTH POLE / TERRAIN SYNTHESIS <span>DETERMINISTIC DEM</span></div>
      <div className="terrain">
        <div className="stars">{stars.map((star, index) => <i key={index} style={star} />)}</div>
        <div className="moon-horizon" />
        <div className="site-beacon">
          <b>+</b>
          <label>{site.name.toUpperCase()}<small>{site.lat.toFixed(2)}° / {site.lon.toFixed(2)}°</small></label>
        </div>
        <div className="grid-lines" />
      </div>
      <div className="viewport-footer"><span>CAM 01 · TERRAIN RECONSTRUCTION</span><span>ALT 2.4 KM · FOV 62°</span></div>
    </section>
  );
}
