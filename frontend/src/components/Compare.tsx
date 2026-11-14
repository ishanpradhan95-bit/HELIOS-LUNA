import { useState } from 'react';
import { useStore, DAY } from '../store/useStore';
import { fmtDate, fmtDT, fmtH, useCanvas, viridis, viridisCss } from './common';
import { verdict } from '../math/analysis';
import type { AnalyzeResult } from '../math/client';

export function MiniTimeline({ a, h = 34 }: { a: AnalyzeResult; h?: number }) {
  const ref = useCanvas(
    (ctx, w) => {
      const n = a.series.n;
      for (let x = 0; x < w; x++) {
        const i = Math.min(n - 1, Math.floor((x / w) * n));
        const f = a.series.fSun[i],
          link = a.series.mask[i] !== 0;
        ctx.fillStyle = `rgba(255,200,61,${0.08 + 0.92 * f})`;
        ctx.fillRect(x, 0, 1, h * 0.46);
        ctx.fillStyle = link ? '#4aa3ff' : '#1b2335';
        ctx.fillRect(x, h * 0.54, 1, h * 0.46);
        if (link && f > 0.1) {
          ctx.fillStyle = '#6be3a2';
          ctx.fillRect(x, h * 0.54, 1, 3);
        }
      }
    },
    [a],
    h,
  );
  return (
    <div role="img" aria-label="Sunlight (top) and Earth link (bottom) across the stay">
      <canvas ref={ref} />
    </div>
  );
}

function Card({ id }: { id: string }) {
  const s = useStore(),
    a = s.analyses[id],
    site = s.sites.find((x) => x.id === id),
    band = s.bands[id];
  if (!site) return null;
  const q = a?.meta.quality;
  const pm = (b?: [number, number]) => (b && b[1] - b[0] >= 1 ? ` ${b[0].toFixed(0)}–${b[1].toFixed(0)}` : '');
  return (
    <div
      className="card"
      style={s.selected === id ? { borderColor: 'var(--accent)' } : undefined}
      onClick={() => s.set({ selected: id })}
    >
      <h3 style={{ marginBottom: 4 }}>
        <span style={{ color: 'var(--text)', textTransform: 'none', fontSize: 14, letterSpacing: 0 }}>
          {site.label}
        </span>
        {q && (
          <span className={'badge ' + (q === 'high' ? 'ok' : 'warn')} title="Terrain data resolving the near field">
            {q === 'high' ? '20 m terrain' : q === 'medium' ? '120 m terrain' : 'coarse terrain'}
          </span>
        )}
      </h3>
      <div className="faint small">
        {site.lat.toFixed(3)}°, {site.lon.toFixed(3)}°
        {a ? ` · ${a.meta.groundH.toFixed(0)} m · slope ${a.meta.slope.toFixed(1)}°` : ''}
      </div>
      {!a ? (
        <div className="muted" style={{ padding: 20 }}>
          Computing…
        </div>
      ) : (
        <>
          <div style={{ margin: '10px 0 4px' }}>
            <MiniTimeline a={a} />
          </div>
          <div className="faint small row" style={{ justifyContent: 'space-between' }}>
            <span>{fmtDate(s.arrival)}</span>
            <span>
              <span style={{ color: 'var(--sun)' }}>■</span> sun &nbsp;<span style={{ color: 'var(--earth)' }}>■</span>{' '}
              Earth link &nbsp;<span style={{ color: 'var(--both)' }}>■</span> both
            </span>
            <span>{fmtDate(s.arrival + s.duration * DAY)}</span>
          </div>
          <div className="kv">
            <div>
              <span>Sunlit</span>
              <b>
                {a.summary.sunPct.toFixed(0)}%
                <span className="pm">{pm(s.selected === id ? band?.sun : undefined)}</span>
              </b>
            </div>
            <div>
              <span>Longest darkness</span>
              <b>{fmtH(a.summary.longestDarkH)}</b>
            </div>
            <div>
              <span>Earth link (any station)</span>
              <b>
                {a.summary.dtePct.toFixed(0)}%
                <span className="pm">{pm(s.selected === id ? band?.dte : undefined)}</span>
              </b>
            </div>
            <div>
              <span>Longest link outage</span>
              <b>{fmtH(a.summary.longestOutageH)}</b>
            </div>
            <div>
              <span>Power + link together</span>
              <b>{a.summary.bothPct.toFixed(0)}%</b>
            </div>
            <div>
              <span>Min battery</span>
              <b style={{ color: a.summary.blackout ? 'var(--bad)' : undefined }}>{a.summary.minSocPct.toFixed(0)}%</b>
            </div>
          </div>
          <div className="verdict">
            {verdict(
              a.summary,
              s.duration,
              s.selected === id && band ? { sunLo: band.sun[0], sunHi: band.sun[1] } : undefined,
            )}
          </div>
          <div className="row" style={{ marginTop: 10 }}>
            <button
              className="btn"
              onClick={(e) => {
                e.stopPropagation();
                s.set({ selected: id, tab: 'sky', cursor: s.arrival + DAY / 2 });
              }}
            >
              Open sky
            </button>
          </div>
        </>
      )}
    </div>
  );
}

const METRICS = {
  sun: 'Sunlit % of stay',
  dte: 'Earth link % of stay',
  both: 'Power + link % of stay',
  dark: 'Longest darkness (h)',
} as const;

function Matrix() {
  const s = useStore(),
    m = s.matrix;
  const [tip, setTip] = useState<{ x: number; y: number; t: string } | null>(null);
  const LABEL = 150,
    ROW = 26,
    TOP = 34;
  const rows = m?.rows ?? [];
  const maxDark = Math.max(24, s.duration * 24);
  const val = (r: (typeof rows)[0], d: number) =>
    s.matrixMetric === 'dark' ? 1 - r.dark[d] / maxDark : r[s.matrixMetric][d] / 100;
  const H = TOP + rows.length * ROW + 6;
  const ref = useCanvas(
    (ctx, w) => {
      ctx.font = '12px system-ui';
      ctx.textBaseline = 'middle';
      const cw = (w - LABEL) / s.spanDays;
      rows.forEach((r, i) => {
        const site = s.sites.find((x) => x.id === r.id);
        const y = TOP + i * ROW;
        ctx.fillStyle = s.selected === r.id ? '#fff' : '#98a2b8';
        ctx.textAlign = 'left';
        ctx.fillText((site?.label ?? r.id).replace(/ · .*/, '').slice(0, 22) + ' ' + r.id.slice(0, 8), 4, y + ROW / 2);
        for (let d = 0; d < s.spanDays; d++) {
          const [R, G, B] = viridis(val(r, d));
          ctx.fillStyle = `rgb(${R},${G},${B})`;
          ctx.fillRect(LABEL + d * cw, y + 1, Math.ceil(cw), ROW - 2);
          if (s.reqOn && !r.ok[d]) {
            ctx.fillStyle = 'rgba(8,10,16,.72)';
            ctx.fillRect(LABEL + d * cw, y + 1, Math.ceil(cw), ROW - 2);
            ctx.strokeStyle = 'rgba(255,255,255,.5)';
            ctx.lineWidth = 1;
            ctx.beginPath();
            ctx.moveTo(LABEL + d * cw, y + ROW - 1);
            ctx.lineTo(LABEL + (d + 1) * cw, y + 1);
            ctx.stroke();
          }
        }
      });
      ctx.textAlign = 'center';
      ctx.fillStyle = '#98a2b8';
      for (let d = 0; d < s.spanDays; d += Math.max(1, Math.round(s.spanDays / 8))) {
        ctx.fillText(fmtDate(s.matrixStart + d * DAY).slice(5), LABEL + (d + 0.5) * cw, 10);
        ctx.fillRect(LABEL + (d + 0.5) * cw, 20, 1, 6);
      }
      const ad = (s.arrival - s.matrixStart) / DAY;
      if (ad >= 0 && ad < s.spanDays) {
        ctx.strokeStyle = '#ffc83d';
        ctx.lineWidth = 2;
        ctx.strokeRect(LABEL + ad * cw - 1, TOP - 2, s.duration * cw + 2, rows.length * ROW + 3);
        ctx.fillStyle = '#ffc83d';
        ctx.fillText('arrival', LABEL + ad * cw + 20, 26);
      }
    },
    [m, s.matrixMetric, s.arrival, s.duration, s.selected, s.reqOn, s.sites],
    H,
  );
  const locate = (e: React.MouseEvent<HTMLCanvasElement>) => {
    const r = e.currentTarget.getBoundingClientRect(),
      x = e.clientX - r.left,
      y = e.clientY - r.top,
      cw = (r.width - LABEL) / s.spanDays;
    const d = Math.floor((x - LABEL) / cw),
      i = Math.floor((y - TOP) / ROW);
    return d >= 0 && d < s.spanDays && i >= 0 && i < rows.length ? { d, i } : null;
  };
  return (
    <div className="card">
      <h3>
        Which site, which date?
        <select
          value={s.matrixMetric}
          aria-label="Metric"
          onChange={(e) => s.set({ matrixMetric: e.target.value as keyof typeof METRICS })}
          style={{
            marginLeft: 'auto',
            background: 'var(--panel2)',
            border: '1px solid var(--line)',
            borderRadius: 6,
            padding: '3px 6px',
          }}
        >
          {Object.entries(METRICS).map(([k, v]) => (
            <option key={k} value={k}>
              {v}
            </option>
          ))}
        </select>
      </h3>
      <div className="row small muted" style={{ marginBottom: 8 }}>
        Each cell = your {s.duration}-day stay if you arrive on that date.
        <button className="btn" onClick={() => s.set({ matrixStart: s.matrixStart - 30 * DAY })} aria-label="Earlier">
          ←
        </button>
        <button className="btn" onClick={() => s.set({ matrixStart: s.matrixStart + 30 * DAY })} aria-label="Later">
          →
        </button>
        <select
          value={s.spanDays}
          aria-label="Span"
          onChange={(e) => s.set({ spanDays: +e.target.value })}
          style={{ background: 'var(--panel2)', border: '1px solid var(--line)', borderRadius: 6, padding: '3px 6px' }}
        >
          {[60, 120, 180, 365].map((n) => (
            <option key={n} value={n}>
              {n} days
            </option>
          ))}
        </select>
        <span className="legend">
          <i style={{ background: viridisCss() }} />
          {s.matrixMetric === 'dark' ? 'long dark → none' : 'low → high'}
        </span>
        {s.reqOn && <span>▨ = fails your requirements</span>}
      </div>
      {!m ? (
        <div className="muted" style={{ padding: 30 }}>
          Computing the matrix…
        </div>
      ) : (
        <div style={{ position: 'relative' }}>
          <canvas
            ref={ref}
            style={{ cursor: 'pointer' }}
            role="img"
            aria-label="Site by arrival date matrix"
            onMouseMove={(e) => {
              const p = locate(e);
              if (!p) return setTip(null);
              const r = rows[p.i],
                d = p.d;
              setTip({
                x: e.clientX + 12,
                y: e.clientY + 12,
                t: `${r.id} · arrive ${fmtDate(s.matrixStart + d * DAY)}\nSunlit ${r.sun[d].toFixed(0)}% · dark ${fmtH(r.dark[d])}\nLink ${r.dte[d].toFixed(0)}% · outage ${fmtH(r.outage[d])}\nBoth ${r.both[d].toFixed(0)}%${s.reqOn ? (r.ok[d] ? ' · meets requirements' : ' · fails requirements') : ''}`,
              });
            }}
            onMouseLeave={() => setTip(null)}
            onClick={(e) => {
              const p = locate(e);
              if (p)
                s.set({
                  arrival: s.matrixStart + p.d * DAY,
                  selected: rows[p.i].id,
                  cursor: s.matrixStart + p.d * DAY + DAY,
                });
            }}
          />
          {tip && (
            <div className="tip" style={{ left: tip.x, top: tip.y, whiteSpace: 'pre' }}>
              {tip.t}
            </div>
          )}
        </div>
      )}
      <div className="faint small" style={{ marginTop: 6 }}>
        Click a cell to arrive then. {m && `Computed in ${m.ms.toFixed(0)} ms.`}{' '}
        {Object.values(m?.quality ?? {}).includes('coarse') && 'Sites marked coarse use 240–480 m terrain only.'}
      </div>
    </div>
  );
}

function Solver() {
  const s = useStore();
  return (
    <div className="card">
      <h3>Tell it what the mission needs</h3>
      <div className="muted small" style={{ marginBottom: 8 }}>
        Uses the requirements in the sidebar (sunlit ≥ {s.req.minSunPct ?? '–'}%, darkness ≤ {s.req.maxDarkH ?? '–'} h,
        link ≥ {s.req.minDtePct ?? '–'}%, outage ≤ {s.req.maxOutageH ?? '–'} h…). It screens every site × arrival day in
        the matrix span with the tallest mast, then finds the <b>minimum mast height</b> for the best candidates with
        the exact envelope.
      </div>
      <button className="btn primary" disabled={s.solving || !s.sites.length} onClick={() => void s.runSolve()}>
        {s.solving ? 'Searching…' : 'Find where, when and how tall'}
      </button>
      {s.solve &&
        (s.solve.rows.length === 0 ? (
          <p className="muted">
            No site and arrival date in this {s.spanDays}-day span meets all of those, even with a 50 m mast (
            {s.solve.screened} combinations screened). Relax a requirement or widen the span.
          </p>
        ) : (
          <table style={{ marginTop: 10 }}>
            <thead>
              <tr>
                <th>Site</th>
                <th>Arrive</th>
                <th>Min mast</th>
                <th>Sunlit</th>
                <th>Link</th>
                <th>Longest dark</th>
                <th>Longest outage</th>
              </tr>
            </thead>
            <tbody>
              {s.solve.rows.map((r, i) => (
                <tr
                  key={i}
                  style={{ cursor: 'pointer' }}
                  onClick={() =>
                    s.set({ selected: r.siteId, arrival: r.arrivalMs, tab: 'sky', cursor: r.arrivalMs + DAY })
                  }
                >
                  <td>{r.label}</td>
                  <td>{fmtDate(r.arrivalMs)}</td>
                  <td>
                    <b>{r.minMastM.toFixed(1)} m</b>
                  </td>
                  <td>{r.sunPct.toFixed(0)}%</td>
                  <td>{r.dtePct.toFixed(0)}%</td>
                  <td>{fmtH(r.darkH)}</td>
                  <td>{fmtH(r.outageH)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        ))}
      {s.solve && (
        <div className="faint small" style={{ marginTop: 6 }}>
          {s.solve.feasible} of {s.solve.screened} site-date combinations are feasible at 50 m · {s.solve.ms.toFixed(0)}{' '}
          ms
        </div>
      )}
    </div>
  );
}

export function Compare() {
  const s = useStore();
  const ids = s.pinned.filter((id) => s.sites.some((x) => x.id === id));
  return (
    <div className="grid">
      <Matrix />
      <div className="grid cards">
        {ids.map((id) => (
          <Card key={id} id={id} />
        ))}
      </div>
      {s.mode !== 'explorer' && <Solver />}
      <div className="faint small">
        Arrival {fmtDT(s.arrival)} · {s.duration}-day stay · mast {s.z} m. “Link” = a Deep Space Network station is ≥{' '}
        {s.stationMask}° above its horizon and ≥ {s.landerMask}° above the lander’s terrain horizon.
      </div>
    </div>
  );
}
