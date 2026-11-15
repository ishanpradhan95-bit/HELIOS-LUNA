import { useEffect, useState } from 'react';
import { useStore, client, analysisKey } from '../store/useStore';
import type { Zone } from '../math/client';
import type { SiteRef } from '../math/engine';
import { fmtH } from './common';

const SIZES = [100, 500, 1000, 2000];
const RES: Record<string, number> = { high: 20, medium: 120, coarse: 240, global: 1900 };
const pct = (a: number, n: number) => (n ? Math.round((100 * a) / n) : 0);
const q = (v: number[], f: number) => {
  const s = [...v].sort((a, b) => a - b);
  return s[Math.min(s.length - 1, Math.max(0, Math.round(f * (s.length - 1))))];
};

/**
 * Landing-zone analysis: a lander does not touch down on a point. Each point of a grid inside the landing zone gets
 * its own slope and its own horizon, so the spread across the zone, not just the centre, is what is judged.
 */
export function ZonePanel({ site }: { site: SiteRef }) {
  const s = useStore();
  const [d, setD] = useState(100),
    [z, setZ] = useState<Zone | null>(null),
    [busy, setBusy] = useState(false);
  const key = analysisKey(s, site) + d + JSON.stringify(s.req);
  useEffect(() => setZ(null), [key]);
  const run = () => {
    setBusy(true);
    client
      .zone(site, { startMs: s.arrival, days: s.duration }, s.config(), s.req, d)
      .then(setZ, (e) => s.set({ notice: String(e.message) }))
      .finally(() => setBusy(false));
  };
  const res = z ? (RES[z.quality] ?? 240) : 0;
  const n = z?.points.length ?? 0,
    flat = z ? z.points.filter((p) => p.slope < 10).length : 0,
    ok = z ? z.points.filter((p) => p.ok).length : 0,
    both = z ? z.points.filter((p) => p.ok && p.slope < 10).length : 0;
  const S = 150;
  return (
    <div className="card">
      <h3>
        Landing zone{' '}
        <span className="faint" style={{ textTransform: 'none', letterSpacing: 0 }}>
          the spread across where you might actually touch down
        </span>
      </h3>
      <div className="row small" style={{ gap: 10 }}>
        <span className="muted">Zone diameter</span>
        <span className="mapmode" style={{ marginLeft: 0 }}>
          {SIZES.map((m) => (
            <button key={m} aria-pressed={d === m} onClick={() => setD(m)}>
              {m < 1000 ? `${m} m` : `${m / 1000} km`}
            </button>
          ))}
        </span>
        <button className="btn primary" onClick={run} disabled={busy}>
          {busy ? 'Analysing…' : z ? 'Re-analyse' : 'Analyse zone'}
        </button>
        <span className="faint">Artemis III plans a 100 m landing area; CLPS zones are larger.</span>
      </div>
      {z && (
        <div className="zone">
          <svg
            viewBox={`${-S / 2 - 8} ${-S / 2 - 8} ${S + 16} ${S + 16}`}
            className="zplot"
            role="img"
            aria-label="Zone points"
          >
            <circle cx={0} cy={0} r={S / 2} className="zring" />
            {z.points.map((p, i) => (
              <circle
                key={i}
                cx={(p.dx / z.diameterM) * S}
                cy={(-p.dy / z.diameterM) * S}
                r={5}
                className={'zpt ' + (p.ok && p.slope < 10 ? 'go' : p.slope >= 10 ? 'steep' : 'nogo')}
              >
                <title>{`${p.lat.toFixed(4)}°, ${p.lon.toFixed(4)}° · slope ${p.slope.toFixed(1)}° · sunlit ${p.sun.toFixed(0)}% · link ${p.dte.toFixed(0)}%`}</title>
              </circle>
            ))}
          </svg>
          <div className="zstats">
            <div>
              <b>{pct(both, n)}%</b> of the zone is landable and meets the profile
            </div>
            <div>
              <b>{pct(flat, n)}%</b> has slope under 10° <span className="faint">(Artemis landing criterion)</span>
            </div>
            <div>
              <b>{pct(ok, n)}%</b> meets the mission profile for this stay
            </div>
            <table>
              <thead>
                <tr>
                  <th></th>
                  <th>Worst</th>
                  <th>Median</th>
                  <th>Best</th>
                </tr>
              </thead>
              <tbody>
                <tr>
                  <td>Sunlit</td>
                  <td>
                    {q(
                      z.points.map((p) => p.sun),
                      0,
                    ).toFixed(0)}
                    %
                  </td>
                  <td>
                    {q(
                      z.points.map((p) => p.sun),
                      0.5,
                    ).toFixed(0)}
                    %
                  </td>
                  <td>
                    {q(
                      z.points.map((p) => p.sun),
                      1,
                    ).toFixed(0)}
                    %
                  </td>
                </tr>
                <tr>
                  <td>Longest dark</td>
                  <td>
                    {fmtH(
                      q(
                        z.points.map((p) => p.dark),
                        1,
                      ),
                    )}
                  </td>
                  <td>
                    {fmtH(
                      q(
                        z.points.map((p) => p.dark),
                        0.5,
                      ),
                    )}
                  </td>
                  <td>
                    {fmtH(
                      q(
                        z.points.map((p) => p.dark),
                        0,
                      ),
                    )}
                  </td>
                </tr>
                <tr>
                  <td>Earth link</td>
                  <td>
                    {q(
                      z.points.map((p) => p.dte),
                      0,
                    ).toFixed(0)}
                    %
                  </td>
                  <td>
                    {q(
                      z.points.map((p) => p.dte),
                      0.5,
                    ).toFixed(0)}
                    %
                  </td>
                  <td>
                    {q(
                      z.points.map((p) => p.dte),
                      1,
                    ).toFixed(0)}
                    %
                  </td>
                </tr>
                <tr>
                  <td>Slope</td>
                  <td>
                    {q(
                      z.points.map((p) => p.slope),
                      1,
                    ).toFixed(1)}
                    °
                  </td>
                  <td>
                    {q(
                      z.points.map((p) => p.slope),
                      0.5,
                    ).toFixed(1)}
                    °
                  </td>
                  <td>
                    {q(
                      z.points.map((p) => p.slope),
                      0,
                    ).toFixed(1)}
                    °
                  </td>
                </tr>
              </tbody>
            </table>
            <div className="faint small">
              <span className="zkey go" /> landable and meets profile <span className="zkey nogo" /> fails profile{' '}
              <span className="zkey steep" /> slope ≥ 10° · {n} points, terrain {res < 1000 ? `${res} m` : '1.9 km'}
              {res * 2 > d && (
                <b style={{ color: 'var(--warn)' }}>
                  {' '}
                  · the terrain here is coarser than this zone, so the points barely differ; choose a larger zone or an
                  Artemis region site
                </b>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
