import type { LunarSite } from "../types/mission";
import { localSolarElevation } from "../math/selenography";
import { useMissionStore } from "../store/useMissionStore";
export function HorizonPanorama({ site }: { site: LunarSite }) {
  const { mastHeightM, earthCompare } = useMissionStore();
  const solarElevation = localSolarElevation(site, site.illumination * 0.1);
  const horizon = 2.8 - mastHeightM * 0.12 + 1.4 * Math.sin(site.lon * Math.PI / 180);
  const earthElevation = 4.2 + 0.8 * Math.cos(site.lon * Math.PI / 180);
  return <section className="panel panorama"><div className="section-title">HORIZON PANORAMA <span>AZIMUTH 0°-360° · MAST {mastHeightM.toFixed(1)} m</span></div><div className="panorama-art"><div className="sun" style={{ left: `${Math.min(92, Math.max(8, site.illumination * 80 + 10))}%` }}/><div className="ridge ridge-back"/><div className="ridge ridge-front" style={{ transform: `skewY(${horizon * -1}deg)` }}/><div className="panorama-readout">SOLAR ELEVATION <strong>{solarElevation.toFixed(1)}°</strong>{earthCompare && <span> · EARTH {earthElevation.toFixed(1)}°</span>}</div></div></section>;
}
