import { useEffect, useRef, useState } from 'react';
import { useStore, client, DAY } from '../store/useStore';
import { fmtDT, fmtH, useCanvas } from './common';
import { verdict } from '../math/analysis';
import type { Mast } from '../math/client';

const COMPASS: Record<number, string> = {
  0: 'N',
  45: 'NE',
  90: 'E',
  135: 'SE',
  180: 'S',
  225: 'SW',
  270: 'W',
  315: 'NW',
};
const wrapD = (d: number) => ((d + 540) % 360) - 180;

export function Sky() {
  const s = useStore();
  const a = s.analyses[s.selected],
    site = s.sites.find((x) => x.id === s.selected);
  const [fov, setFov] = useState(50),
    [follow, setFollow] = useState<'sun' | 'earth' | number>('sun'),
    [playing, setPlaying] = useState(false);
  const [mast, setMast] = useState<Mast | null>(null),
    [lt, setLt] = useState<{ year: number; sun: number; dte: number }[] | null>(null);
  const raf = useRef(0);
  const T0 = a?.series.t0 ?? 0,
    TN = a ? a.series.t0 + a.series.n * a.series.stepMs : 1;
  const idx = a ? Math.min(a.series.n - 1, Math.max(0, Math.round((s.cursor - T0) / a.series.stepMs))) : 0;

  useEffect(() => {
    setMast(null);
    setLt(null);
  }, [s.selected, s.arrival, s.duration, s.z]);
  useEffect(() => {
    if (!playing || !a) return;
    let last = performance.now();
    const tick = (now: number) => {
      const dt = now - last;
      last = now;
      let c = useStore.getState().cursor + (dt / 1000) * ((TN - T0) / 22);
      if (c >= TN) c = T0;
      useStore.setState({ cursor: c });
      raf.current = requestAnimationFrame(tick);
    };
    raf.current = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf.current);
  }, [playing, a, T0, TN]);
  useEffect(() => {
    if (a && (s.cursor < T0 || s.cursor > TN)) s.set({ cursor: T0 + DAY / 2 });
  }, [a, T0, TN]);

  const hAt = (az: number) => {
    const u = ((((az % 360) + 360) % 360) / 360) * 1440,
      i = Math.floor(u),
      f = u - i;
    return a!.horizon[i % 1440] * (1 - f) + a!.horizon[(i + 1) % 1440] * f;
  };

  const PH = 240;
  const pano = useCanvas(
    (ctx, W, H) => {
      if (!a) return;
      const S = a.series,
        centre = follow === 'sun' ? S.sunAz[idx] : follow === 'earth' ? S.earthAz[idx] : follow,
        ppd = W / fov;
      const e0 = Math.min(-2, Math.min(S.sunEl[idx], S.earthEl[idx], -2)),
        yOf = (el: number) => H - 28 - (el - e0) * ppd,
        xOf = (az: number) => W / 2 + wrapD(az - centre) * ppd;
      const g = ctx.createLinearGradient(0, 0, 0, H);
      g.addColorStop(0, '#05070d');
      g.addColorStop(1, '#141c33');
      ctx.fillStyle = g;
      ctx.fillRect(0, 0, W, H);
      ctx.font = '11px system-ui';
      ctx.fillStyle = '#6b7590';
      ctx.strokeStyle = '#1e2740';
      ctx.lineWidth = 1;
      ctx.textAlign = 'center';
      const step = fov > 70 ? 15 : fov > 30 ? 10 : 5;
      for (let d = Math.ceil((centre - fov / 2) / step) * step; d <= centre + fov / 2; d += step) {
        const az = ((d % 360) + 360) % 360,
          x = xOf(az);
        ctx.beginPath();
        ctx.moveTo(x, 0);
        ctx.lineTo(x, H - 28);
        ctx.stroke();
        ctx.fillText(COMPASS[az] ? `${COMPASS[az]} ${az}°` : `${az}°`, x, H - 12);
      }
      ctx.textAlign = 'left';
      for (let el = Math.ceil(e0); el < e0 + H / ppd; el += el < 10 ? 2 : 5) {
        const y = yOf(el);
        ctx.beginPath();
        ctx.moveTo(0, y);
        ctx.lineTo(W, y);
        ctx.stroke();
        ctx.fillText(`${el}°`, 4, y - 3);
      }
      for (const [az, el, col] of [
        [S.sunAz, S.sunEl, 'rgba(255,200,61,.55)'],
        [S.earthAz, S.earthEl, 'rgba(74,163,255,.55)'],
      ] as const) {
        ctx.fillStyle = col;
        for (let i = 0; i < S.n; i += 6) {
          const x = xOf(az[i]);
          if (x > -4 && x < W + 4) {
            ctx.beginPath();
            ctx.arc(x, yOf(el[i]), 1.8, 0, 7);
            ctx.fill();
          }
        }
      }
      // discs at cursor (true angular size)
      const disc = (az: number, el: number, r: number, col: string, glow: string) => {
        const x = xOf(az),
          y = yOf(el);
        const gr = ctx.createRadialGradient(x, y, r * 0.6, x, y, r * 3);
        gr.addColorStop(0, glow);
        gr.addColorStop(1, 'rgba(0,0,0,0)');
        ctx.fillStyle = gr;
        ctx.beginPath();
        ctx.arc(x, y, r * 3, 0, 7);
        ctx.fill();
        ctx.fillStyle = col;
        ctx.beginPath();
        ctx.arc(x, y, r, 0, 7);
        ctx.fill();
      };
      disc(S.earthAz[idx], S.earthEl[idx], 0.95 * ppd, '#3d8bd8', 'rgba(74,163,255,.25)');
      disc(S.sunAz[idx], S.sunEl[idx], Math.max(2.5, 0.2665 * ppd), '#ffd75e', 'rgba(255,200,61,.45)');
      ctx.beginPath();
      ctx.moveTo(0, H);
      for (let x = 0; x <= W; x += 2) {
        const az = centre + (x - W / 2) / ppd;
        ctx.lineTo(x, yOf(hAt(az)));
      }
      ctx.lineTo(W, H);
      ctx.closePath();
      const tg = ctx.createLinearGradient(0, H * 0.4, 0, H);
      tg.addColorStop(0, '#2a2f3c');
      tg.addColorStop(1, '#0c0e14');
      ctx.fillStyle = tg;
      ctx.fill();
      ctx.strokeStyle = '#8b93a8';
      ctx.lineWidth = 1.5;
      ctx.beginPath();
      for (let x = 0; x <= W; x += 2) {
        const y = yOf(hAt(centre + (x - W / 2) / ppd));
        x ? ctx.lineTo(x, y) : ctx.moveTo(x, y);
      }
      ctx.stroke();
      ctx.fillStyle = '#e6e9f0';
      ctx.font = '12px system-ui';
      ctx.fillText(`Looking toward ${centre.toFixed(0)}° · terrain horizon at ${s.z} m mast · ${fov}° field`, 8, 16);
    },
    [a, idx, fov, follow, s.z],
    PH,
  );

  const ovRef = useCanvas(
    (ctx, W, H) => {
      if (!a) return;
      const S = a.series;
      ctx.fillStyle = '#0d1220';
      ctx.fillRect(0, 0, W, H);
      const lo = -6,
        hi = Math.max(8, Math.max(...a.horizon) + 2),
        y = (el: number) => H - 4 - ((el - lo) / (hi - lo)) * (H - 8);
      ctx.beginPath();
      ctx.moveTo(0, H);
      for (let x = 0; x <= W; x++) ctx.lineTo(x, y(hAt((x / W) * 360)));
      ctx.lineTo(W, H);
      ctx.fillStyle = '#2a2f3c';
      ctx.fill();
      ctx.fillStyle = 'rgba(255,200,61,.6)';
      for (let i = 0; i < S.n; i += 6) ctx.fillRect((S.sunAz[i] / 360) * W, y(S.sunEl[i]), 1.5, 1.5);
      ctx.fillStyle = 'rgba(74,163,255,.6)';
      for (let i = 0; i < S.n; i += 6) ctx.fillRect((S.earthAz[i] / 360) * W, y(S.earthEl[i]), 1.5, 1.5);
      ctx.fillStyle = '#ffd75e';
      ctx.beginPath();
      ctx.arc((S.sunAz[idx] / 360) * W, y(S.sunEl[idx]), 4, 0, 7);
      ctx.fill();
      ctx.fillStyle = '#4aa3ff';
      ctx.beginPath();
      ctx.arc((S.earthAz[idx] / 360) * W, y(S.earthEl[idx]), 4, 0, 7);
      ctx.fill();
      ctx.fillStyle = '#6b7590';
      ctx.font = '10px system-ui';
      for (const d of [0, 90, 180, 270]) ctx.fillText(COMPASS[d], (d / 360) * W + 3, 10);
    },
    [a, idx, s.z],
    56,
  );

  const LAB = 86,
    rowsN = 3 + s.stations.length + 1,
    RH = 20,
    TH = rowsN * RH + 26;
  const tl = useCanvas(
    (ctx, W) => {
      if (!a) return;
      const S = a.series,
        w = W - LAB,
        n = S.n;
      ctx.font = '11px system-ui';
      ctx.textBaseline = 'middle';
      ctx.textAlign = 'left';
      const labels = ['Sun', 'Earth link', 'Both', ...s.stations.map((x) => x.name), 'Battery'];
      labels.forEach((l, r) => {
        ctx.fillStyle = '#98a2b8';
        ctx.fillText(l, 4, 26 + r * RH + RH / 2);
      });
      for (let x = 0; x < w; x++) {
        const i = Math.min(n - 1, Math.floor((x / w) * n)),
          f = S.fSun[i],
          m = S.mask[i];
        ctx.fillStyle = `rgba(255,200,61,${0.07 + 0.93 * f})`;
        ctx.fillRect(LAB + x, 26 + 2, 1, RH - 4);
        ctx.fillStyle = m ? '#4aa3ff' : '#161d2e';
        ctx.fillRect(LAB + x, 26 + RH + 2, 1, RH - 4);
        ctx.fillStyle = m && f > s.litThreshold ? '#6be3a2' : '#161d2e';
        ctx.fillRect(LAB + x, 26 + 2 * RH + 2, 1, RH - 4);
        for (let k = 0; k < s.stations.length; k++) {
          ctx.fillStyle = (m >> k) & 1 ? '#4aa3ff' : '#161d2e';
          ctx.fillRect(LAB + x, 26 + (3 + k) * RH + 5, 1, RH - 10);
        }
      }
      ctx.strokeStyle = '#e6e9f0';
      ctx.lineWidth = 1.5;
      ctx.beginPath();
      const soc = a.summary.soc;
      const by = 26 + (rowsN - 1) * RH;
      for (let x = 0; x < w; x++) {
        const v = soc[Math.min(n - 1, Math.floor((x / w) * n))] / 100,
          y = by + RH - 2 - v * (RH - 4);
        x ? ctx.lineTo(LAB + x, y) : ctx.moveTo(LAB + x, y);
      }
      ctx.stroke();
      ctx.fillStyle = '#6b7590';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'alphabetic';
      const days = Math.max(1, Math.round(s.duration));
      for (let d = 0; d <= days; d += Math.max(1, Math.round(days / 8)))
        ctx.fillText(new Date(T0 + d * DAY).toISOString().slice(5, 10), LAB + ((d * DAY) / (TN - T0)) * w, 14);
      const cx = LAB + ((s.cursor - T0) / (TN - T0)) * w;
      ctx.strokeStyle = '#fff';
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.moveTo(cx, 20);
      ctx.lineTo(cx, TH);
      ctx.stroke();
    },
    [a, s.cursor, s.stations, s.litThreshold],
    TH,
  );
  const scrub = (e: React.PointerEvent<HTMLCanvasElement>) => {
    if (!a || (e.type === 'pointermove' && e.buttons !== 1)) return;
    const r = e.currentTarget.getBoundingClientRect(),
      f = Math.min(1, Math.max(0, (e.clientX - r.left - LAB) / (r.width - LAB)));
    s.set({ cursor: T0 + f * (TN - T0) });
    setPlaying(false);
  };

  if (!site) return <div className="card">Pick a site in the sidebar.</div>;
  if (!a)
    return (
      <div className="card">
        <h3>{site.label}</h3>
        <div className="muted">Computing the exact horizon (1440 azimuths out to 300 km)…</div>
      </div>
    );
  const S = a.series,
    sm = a.summary,
    band = s.bands[s.selected];
  const t = s.cursor,
    litNow = S.fSun[idx],
    maskNow = S.mask[idx];
  const stationsUp = s.stations.filter((_, k) => (maskNow >> k) & 1).map((x) => x.name);
  const explorer = s.mode === 'explorer';
  const findMast = async () =>
    setMast(await client.minMast(site, { startMs: s.arrival, days: s.duration }, s.config(), s.req));
  const loadLt = async () => setLt(await client.longTerm(site, s.config()));

  return (
    <div className="grid">
      <div className="split">
        <div className="grid">
          <div className="card">
            <h3>
              {site.label}
              <span className={'badge ' + (a.meta.quality === 'high' ? 'ok' : 'warn')}>
                {a.meta.quality === 'high'
                  ? '20 m terrain'
                  : a.meta.quality === 'medium'
                    ? '120 m terrain'
                    : 'coarse terrain'}
              </span>
            </h3>
            <div className="verdict big" style={{ marginBottom: 10 }}>
              {verdict(sm, s.duration, band ? { sunLo: band.sun[0], sunHi: band.sun[1] } : undefined, mast?.z)}
            </div>
            <canvas ref={ovRef} aria-label="360 degree overview" />
            <div style={{ height: 6 }} />
            <div>
              <canvas ref={pano} role="img" aria-label="Horizon panorama with Sun and Earth" />
            </div>
            <div className="row small" style={{ marginTop: 8 }}>
              <span className="muted">Field of view</span>
              <input
                type="range"
                min={15}
                max={120}
                value={fov}
                onChange={(e) => setFov(+e.target.value)}
                style={{ width: 120 }}
                aria-label="Field of view"
              />
              <span className="muted">Look toward</span>
              <select
                value={String(follow)}
                onChange={(e) =>
                  setFollow(e.target.value === 'sun' || e.target.value === 'earth' ? e.target.value : +e.target.value)
                }
                style={{
                  background: 'var(--panel2)',
                  border: '1px solid var(--line)',
                  borderRadius: 6,
                  padding: '3px 6px',
                }}
              >
                <option value="sun">the Sun</option>
                <option value="earth">the Earth</option>
                {[0, 90, 180, 270].map((d) => (
                  <option key={d} value={d}>
                    {COMPASS[d]} ({d}°)
                  </option>
                ))}
              </select>
              <button className="btn primary" onClick={() => setPlaying((p) => !p)}>
                {playing ? 'Pause' : 'Play the stay'}
              </button>
            </div>
          </div>
          <div className="card">
            <h3>
              Timeline{' '}
              <span className="faint" style={{ textTransform: 'none', letterSpacing: 0 }}>
                drag to scrub · {fmtDT(t)}
              </span>
            </h3>
            <canvas
              ref={tl}
              style={{ touchAction: 'none', cursor: 'ew-resize' }}
              role="img"
              aria-label="Sun, link and battery timeline"
              onPointerDown={(e) => {
                e.currentTarget.setPointerCapture(e.pointerId);
                scrub(e);
              }}
              onPointerMove={scrub}
            />
            <div className="kv" style={{ gridTemplateColumns: 'repeat(4,1fr)' }}>
              <div>
                <span>Sun</span>
                <b>
                  {S.sunEl[idx].toFixed(2)}° @ {S.sunAz[idx].toFixed(0)}°
                </b>
              </div>
              <div>
                <span>Disc visible</span>
                <b style={{ color: litNow > 0.5 ? 'var(--sun)' : litNow > 0.02 ? 'var(--warn)' : 'var(--muted)' }}>
                  {(litNow * 100).toFixed(0)}%
                </b>
              </div>
              <div>
                <span>Earth</span>
                <b>
                  {S.earthEl[idx].toFixed(2)}° @ {S.earthAz[idx].toFixed(0)}°
                </b>
              </div>
              <div>
                <span>Link now</span>
                <b style={{ color: maskNow ? 'var(--earth)' : 'var(--muted)' }}>
                  {stationsUp.length
                    ? stationsUp.join(', ')
                    : S.earthUp[idx]
                      ? 'Earth up, no station'
                      : 'Earth below horizon'}
                </b>
              </div>
            </div>
            {S.occ[idx] > 0.01 && (
              <div className="badge warn">Lunar eclipse: Earth covers {(S.occ[idx] * 100).toFixed(0)}% of the Sun</div>
            )}
          </div>
        </div>
        <div className="grid">
          <div className="card">
            <h3>Scorecard</h3>
            <table>
              <tbody>
                <tr>
                  <td>Sunlit (disc-weighted)</td>
                  <td>
                    <b>{sm.sunPct.toFixed(1)}%</b>
                    {band && (
                      <span className="muted">
                        {' '}
                        {band.sun[0].toFixed(0)}–{band.sun[1].toFixed(0)}%
                      </span>
                    )}
                  </td>
                </tr>
                <tr>
                  <td>Longest darkness</td>
                  <td>
                    <b>{fmtH(sm.longestDarkH)}</b>
                  </td>
                </tr>
                <tr>
                  <td>Longest continuous sun</td>
                  <td>
                    <b>{fmtH(sm.longestLitH)}</b>
                  </td>
                </tr>
                <tr>
                  <td>Link, any station</td>
                  <td>
                    <b>{sm.dtePct.toFixed(1)}%</b>
                    {band && (
                      <span className="muted">
                        {' '}
                        {band.dte[0].toFixed(0)}–{band.dte[1].toFixed(0)}%
                      </span>
                    )}
                  </td>
                </tr>
                <tr>
                  <td>Longest link outage</td>
                  <td>
                    <b>{fmtH(sm.longestOutageH)}</b>
                  </td>
                </tr>
                <tr>
                  <td>Earth centre above horizon</td>
                  <td>
                    {sm.earthUpPct.toFixed(1)}% <span className="faint small">(simple definition)</span>
                  </td>
                </tr>
                <tr>
                  <td>Power + link together</td>
                  <td>
                    <b>{sm.bothPct.toFixed(1)}%</b>
                  </td>
                </tr>
                <tr>
                  <td>Min battery</td>
                  <td>
                    <b style={{ color: sm.blackout ? 'var(--bad)' : 'var(--ok)' }}>
                      {sm.minSocPct.toFixed(0)}% {sm.blackout ? '· exhausted' : '· OK'}
                    </b>
                  </td>
                </tr>
                <tr>
                  <td>Energy harvested</td>
                  <td>{sm.energyKwh.toFixed(0)} kWh</td>
                </tr>
                <tr>
                  <td>Eclipse time</td>
                  <td>{sm.eclipseHours.toFixed(1)} h</td>
                </tr>
                <tr>
                  <td>Ground elevation · slope</td>
                  <td>
                    {a.meta.groundH.toFixed(0)} m · {a.meta.slope.toFixed(1)}°
                  </td>
                </tr>
                <tr>
                  <td>Horizon max</td>
                  <td>
                    {Math.max(...a.horizon).toFixed(2)}° (at {s.z} m)
                  </td>
                </tr>
              </tbody>
            </table>
            <div className="faint small" style={{ marginTop: 6 }}>
              Grey range = neighbouring cells ±120 m ({band ? `${band.n} points` : 'computing…'}). Horizon:{' '}
              {a.meta.samples.toLocaleString()} DEM samples in {a.timing.horizonMs.toFixed(0)} ms.
            </div>
          </div>
          {!explorer && (
            <div className="card">
              <h3>How tall must the mast be?</h3>
              <div className="small muted" style={{ marginBottom: 8 }}>
                Exact, from the horizon envelope: the shortest mast that meets the requirements in the sidebar for this
                window.
              </div>
              <button className="btn primary" onClick={() => void findMast()}>
                Find minimum mast
              </button>
              {mast && (
                <div style={{ marginTop: 8 }}>
                  {mast.z == null ? (
                    <span className="badge bad">Not achievable at 50 m: {mast.atMax.failed.join('; ')}</span>
                  ) : mast.z === 0 ? (
                    <span className="badge ok">Met even at 0 m</span>
                  ) : (
                    <div>
                      <b style={{ fontSize: 22 }}>{mast.z.toFixed(1)} m</b>{' '}
                      <span className="muted small">fails at 0 m: {mast.atZero.failed.join('; ')}</span>
                    </div>
                  )}
                  {mast.z != null && mast.z > 0 && (
                    <button
                      className="btn"
                      style={{ marginTop: 6 }}
                      onClick={() => s.set({ z: Math.min(50, Math.ceil(mast.z! * 2) / 2) })}
                    >
                      Set mast to {Math.min(50, Math.ceil(mast.z * 2) / 2)} m
                    </button>
                  )}
                </div>
              )}
            </div>
          )}
          {!explorer && (
            <div className="card">
              <h3>Station passes</h3>
              <div className="small muted">
                {Object.entries(sm.passCounts)
                  .map(([k, v]) => `${k}: ${v}`)
                  .join(' · ')}{' '}
                (step {10} min)
              </div>
              <div style={{ maxHeight: 190, overflow: 'auto', marginTop: 6 }}>
                {sm.passes.length === 0 ? (
                  <div className="muted small">No station can see this lander in the window.</div>
                ) : (
                  sm.passes.map((p, i) => (
                    <div key={i} className="pass">
                      {p.station} {fmtDT(p.startMs).slice(5)} → {fmtDT(p.endMs).slice(11)}{' '}
                      <span className="faint">({fmtH((p.endMs - p.startMs) / 3.6e6)})</span>
                    </div>
                  ))
                )}
              </div>
            </div>
          )}
        </div>
      </div>
      {!explorer && (
        <div className="card">
          <h3>
            19-year context{' '}
            <button className="btn" onClick={() => void loadLt()} style={{ marginLeft: 'auto' }}>
              {lt ? 'Recompute' : 'Compute'}
            </button>
          </h3>
          {lt ? (
            <LongTerm data={lt} />
          ) : (
            <div className="muted small">
              Mean sunlit % and link % per calendar year, 2026–2044, from the same engine (3-hourly). Shows whether your
              year is a good one.
            </div>
          )}
        </div>
      )}
    </div>
  );
}

function LongTerm({ data }: { data: { year: number; sun: number; dte: number }[] }) {
  const ref = useCanvas(
    (ctx, W, H) => {
      const bw = W / data.length;
      data.forEach((d, i) => {
        ctx.fillStyle = '#c9a233';
        ctx.fillRect(i * bw + 4, H - 22 - (d.sun / 100) * (H - 40), bw - 8, (d.sun / 100) * (H - 40));
        ctx.fillStyle = '#98a2b8';
        ctx.font = '10px system-ui';
        ctx.textAlign = 'center';
        ctx.fillText(String(d.year).slice(2), i * bw + bw / 2, H - 8);
        ctx.fillText(d.sun.toFixed(0), i * bw + bw / 2, H - 26 - (d.sun / 100) * (H - 40));
      });
      ctx.strokeStyle = '#4aa3ff';
      ctx.lineWidth = 2;
      ctx.beginPath();
      data.forEach((d, i) => {
        const x = i * bw + bw / 2,
          y = H - 22 - (d.dte / 100) * (H - 40);
        i ? ctx.lineTo(x, y) : ctx.moveTo(x, y);
      });
      ctx.stroke();
    },
    [data],
    170,
  );
  return (
    <div>
      <canvas ref={ref} role="img" aria-label="Sunlit percent by year" />
      <div className="faint small">
        <span style={{ color: '#c9a233' }}>■</span> sunlit % · <span style={{ color: 'var(--earth)' }}>—</span>{' '}
        Earth-link % (mast height as set)
      </div>
    </div>
  );
}
