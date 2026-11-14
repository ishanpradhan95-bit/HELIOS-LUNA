import type { LunarSite } from "../types/mission";
export function GoldenWindowMatrix({ sites, selected }: { sites: LunarSite[]; selected: string }) {
  return <section className="panel matrix"><div className="section-title">GOLDEN WINDOW MATRIX <span>NEXT 30 DAYS</span></div><div className="matrix-grid"><div className="matrix-head">SITE / UTC</div>{Array.from({ length: 12 }, (_, i) => <div className="matrix-head" key={i}>{String(i * 3).padStart(2, "0")}Z</div>)}{sites.map((site) => <div className="matrix-row" key={site.id}><b className={selected === site.id ? "active" : ""}>{site.name}</b>{Array.from({ length: 12 }, (_, i) => <i key={i} className={(Math.sin(i + site.lat) > -0.15 ? "lit " : "") + (i % 5 === 0 ? "gold" : "")}/>)}</div>)}</div></section>;
}
