import { useEffect, useState } from 'react';
import { useStore, BASE } from '../store/useStore';
import { verdict } from '../math/analysis';
import type { AnalyzeResult } from '../math/client';
import type { SiteRef } from '../math/engine';
import { Icon, download, fmtDT, fmtH, qualityLabel, siteHue } from './common';
import { fmtSpan } from './OpsClock';

/** Small print-friendly horizon plot: terrain profile with the stay's Sun and Earth tracks. */
function HorizonSvg({ a }: { a: AnalyzeResult }) {
  const W = 560,
    H = 120,
    S = a.series;
  let lo = -3,
    hi = 6;
  for (const v of a.horizon) hi = Math.max(hi, v + 1);
  for (let i = 0; i < S.n; i += 6) {
    hi = Math.max(hi, S.sunEl[i] + 1, S.earthEl[i] + 1);
    lo = Math.min(lo, S.sunEl[i] - 1, S.earthEl[i] - 1);
  }
  hi = Math.min(hi, 90);
  lo = Math.max(lo, -15);
  const x = (az: number) => (az / 360) * W,
    y = (el: number) => H - ((el - lo) / (hi - lo)) * H;
  let d = `M0 ${H}`;
  for (let i = 0; i < a.horizon.length; i += 4)
    d += ` L${x((i * 360) / a.horizon.length).toFixed(1)} ${y(a.horizon[i]).toFixed(1)}`;
  d += ` L${W} ${H} Z`;
  const pts = (az: Float32Array, el: Float32Array) =>
    Array.from({ length: Math.ceil(S.n / 6) }, (_, k) => k * 6)
      .filter((i) => el[i] >= lo && el[i] <= hi)
      .map((i) => `${x(az[i]).toFixed(1)},${y(el[i]).toFixed(1)}`);
  return (
    <svg viewBox={`0 0 ${W} ${H + 14}`} className="hsvg" role="img" aria-label="Horizon with Sun and Earth tracks">
      <rect x="0" y="0" width={W} height={H} className="hsky" />
      {[0, 90, 180, 270].map((az) => (
        <g key={az}>
          <line x1={x(az)} x2={x(az)} y1={0} y2={H} className="hgrid" />
          <text x={x(az) + 3} y={H + 11} className="hlab">
            {['N', 'E', 'S', 'W'][az / 90]}
          </text>
        </g>
      ))}
      <line x1={0} x2={W} y1={y(0)} y2={y(0)} className="hgrid" />
      {pts(S.sunAz, S.sunEl).map((p, i) => {
        const [cx, cy] = p.split(',');
        return <circle key={'s' + i} cx={cx} cy={cy} r="1.3" className="hsun" />;
      })}
      {pts(S.earthAz, S.earthEl).map((p, i) => {
        const [cx, cy] = p.split(',');
        return <circle key={'e' + i} cx={cx} cy={cy} r="1.3" className="hearth" />;
      })}
      <path d={d} className="hground" />
      <text x={W - 4} y={11} textAnchor="end" className="hlab">
        {hi.toFixed(0)}°
      </text>
      <text x={W - 4} y={H - 3} textAnchor="end" className="hlab">
        {lo.toFixed(0)}°
      </text>
    </svg>
  );
}

interface Val {
  generated: string;
  tests: { id: number; name: string; pass: boolean | null; result: string }[];
}

/** One-page mission brief for the scenario on screen: print it or save it as PDF from the browser. */
export function Brief() {
  const s = useStore();
  const [val, setVal] = useState<Val | null>(null);
  useEffect(() => {
    fetch(BASE + 'validation.json')
      .then((r) => r.json())
      .then(setVal, () => {});
  }, []);
  const ids = [...new Set([...s.pinned, s.selected])].filter((id) => s.sites.some((x) => x.id === id));
  const rows = ids
    .map((id) => ({ ref: s.sites.find((x) => x.id === id)!, a: s.analyses[id] }))
    .filter((r): r is { ref: SiteRef; a: AnalyzeResult } => !!r.a);
  const c = s.config(),
    hw = c.hardware,
    rq = s.req;
  const arrayName =
    hw.array === 'horizontal'
      ? 'horizontal, fixed'
      : hw.array === 'track2'
        ? 'two-axis tracking'
        : 'vertical, Sun-tracking';
  const json = () =>
    download(
      `helios-luna_brief_${new Date(s.arrival).toISOString().slice(0, 16).replace(':', '')}.json`,
      JSON.stringify(
        {
          scenario: {
            arrivalUtc: new Date(s.arrival).toISOString(),
            stayDays: s.duration,
            mastM: c.z,
            landerMaskDeg: c.landerMask,
            stationMaskDeg: c.stationMask,
            litThreshold: c.litThreshold,
            hardware: hw,
            requirements: s.reqOn ? rq : null,
            link: location.href,
          },
          sites: rows.map(({ ref, a }) => ({
            site: ref,
            terrain: a.meta,
            summary: { ...a.summary, soc: undefined },
            events: a.events,
          })),
          generated: new Date().toISOString(),
        },
        null,
        1,
      ),
      'application/json',
    );
  const pass = val?.tests.filter((t) => t.pass === true).length ?? 0;
  return (
    <div className="page brief">
      <header className="pagehead noprint">
        <div>
          <h1>Mission brief</h1>
          <p className="sub">One page for science and engineering teams, built from the scenario on screen.</p>
        </div>
        <div className="row">
          <button className="btn" onClick={json}>
            Data (JSON)
          </button>
          <button className="btn primary" onClick={() => window.print()}>
            <Icon name="download" size={15} /> Print or save PDF
          </button>
        </div>
      </header>
      <article className="paper">
        <header className="paper-head">
          <div>
            <div className="eyebrow">HELIOS·LUNA · Landing site brief</div>
            <h1>
              Touchdown {fmtDT(s.arrival)} · {s.duration}-day stay
            </h1>
          </div>
          <div className="small muted" style={{ textAlign: 'right' }}>
            Generated {fmtDT(Date.now())}
            <br />
            SPICE DE440 · LOLA terrain · {s.stations.map((x) => x.name).join(', ')}
          </div>
        </header>
        <section className="assume">
          <span>
            <b>Mast</b> {c.z} m
          </span>
          <span>
            <b>Lander terrain mask</b> {c.landerMask}°
          </span>
          <span>
            <b>Station mask</b> {c.stationMask}°
          </span>
          <span>
            <b>Array</b> {hw.arrayKw} kW, {arrayName}
          </span>
          <span>
            <b>Load</b> {hw.loadKw} kW + heater {hw.heaterKw} kW
          </span>
          <span>
            <b>Battery</b> {hw.batteryKwh} kWh
          </span>
          {s.reqOn && (
            <span>
              <b>Requirements</b> sunlit ≥ {rq.minSunPct ?? '–'}%, dark ≤ {rq.maxDarkH ?? '–'} h, link ≥{' '}
              {rq.minDtePct ?? '–'}%, outage ≤ {rq.maxOutageH ?? '–'} h
            </span>
          )}
        </section>
        {rows.length === 0 ? (
          <p className="muted">Pin sites (★) in the sidebar to include them.</p>
        ) : (
          <>
            <table className="cmp">
              <thead>
                <tr>
                  <th>Site</th>
                  <th>Terrain</th>
                  <th>Sunlit</th>
                  <th>Longest dark</th>
                  <th>DTE link</th>
                  <th>Longest outage</th>
                  <th>Power + link</th>
                  <th>Sun el. max</th>
                  <th>Earth el. max</th>
                  <th>Array output</th>
                  <th>Min battery</th>
                  <th>At touchdown</th>
                </tr>
              </thead>
              <tbody>
                {rows.map(({ ref, a }) => {
                  const m = a.summary,
                    e = a.events;
                  return (
                    <tr key={ref.id}>
                      <td>
                        <i className="chip" style={{ ['--hue' as string]: siteHue(ref.id) }} /> <b>{ref.id}</b>
                        <div className="faint small">
                          {ref.lat.toFixed(3)}°, {ref.lon.toFixed(3)}°
                        </div>
                      </td>
                      <td className="small">{qualityLabel(a.meta.quality)}</td>
                      <td>{m.sunPct.toFixed(0)}%</td>
                      <td>{fmtH(m.longestDarkH)}</td>
                      <td>{m.dtePct.toFixed(0)}%</td>
                      <td>{fmtH(m.longestOutageH)}</td>
                      <td>{m.bothPct.toFixed(0)}%</td>
                      <td>{m.sunElMax.toFixed(1)}°</td>
                      <td>{m.earthElMax.toFixed(1)}°</td>
                      <td>{(m.powerFactor * 100).toFixed(0)}%</td>
                      <td style={{ color: m.blackout ? 'var(--bad)' : undefined }}>
                        {hw.batteryKwh > 0 ? `${m.minSocPct.toFixed(0)}%` : '–'}
                      </td>
                      <td className="small">
                        Sun {e.sun.up ? 'up' : 'down'}
                        {e.sun.next ? `, ${e.sun.up ? 'sets' : 'rises'} in ${fmtSpan(e.sun.next - e.t)}` : ''}
                        <br />
                        Earth {e.earth.up ? 'up' : 'down'}
                        {e.earth.next ? `, ${e.earth.up ? 'sets' : 'rises'} in ${fmtSpan(e.earth.next - e.t)}` : ''}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
            <div className="sites">
              {rows.map(({ ref, a }) => (
                <section key={ref.id} className="site">
                  <h2>
                    <i className="chip" style={{ ['--hue' as string]: siteHue(ref.id) }} /> {ref.label}
                  </h2>
                  <p>{verdict(a.summary, s.duration)}</p>
                  <HorizonSvg a={a} />
                  <p className="small muted">
                    Station passes:{' '}
                    {s.stations.map((st) => `${st.name} ${a.summary.passCounts[st.id] ?? 0}`).join(', ')}. Ground{' '}
                    {a.meta.groundH.toFixed(0)} m, slope {a.meta.slope.toFixed(1)}°, horizon max{' '}
                    {Math.max(...a.horizon).toFixed(2)}° at {c.z} m.
                  </p>
                </section>
              ))}
            </div>
          </>
        )}
        <footer className="paper-foot small">
          <div>
            <b>Method.</b> Sun and Earth from NAIF SPICE DE440 (MOON_ME, light time and aberration), interpolated
            hourly; horizons from LOLA terrain (20 m to 480 m at the pole, 1.9 km elsewhere) by a 3-D great-circle march
            to 300 km on the airless, curved Moon; disc-resolved visibility; a link needs a Deep Space Network station
            above its mask and above the lander's terrain horizon. Power = rated array × visible Sun disc ×
            cos(incidence).
          </div>
          <div>
            <b>Validation.</b>{' '}
            {val
              ? `${pass} of ${val.tests.length} automated tests pass (regenerated ${val.generated.slice(0, 10)}), including SPICE, JPL Horizons, PGDA illumination maps and LROC imagery.`
              : 'see Methods & validation.'}{' '}
            Reproduce this brief: {location.href.length > 160 ? location.href.slice(0, 160) + '…' : location.href}
          </div>
        </footer>
      </article>
    </div>
  );
}
