import { useEffect, useState } from 'react';
import { useStore, client, DAY, analysisKey, timeOfDay } from '../store/useStore';
import type { MatrixRow } from '../math/client';
import type { SiteRef } from '../math/engine';
import { fmtDate, fmtH, useCanvas } from './common';

const BEFORE = 14,
  AFTER = 60;

/** "What if the landing slips?": the same site, the same stay, arriving up to 2 weeks earlier or 2 months later. */
export function SlipPanel({ site }: { site: SiteRef }) {
  const s = useStore();
  const [row, setRow] = useState<{ r: MatrixRow; start: number } | null>(null);
  const key = analysisKey(s, site) + JSON.stringify(s.req);
  useEffect(() => {
    let dead = false;
    setRow(null);
    const day0 = Math.floor(s.arrival / DAY) * DAY - BEFORE * DAY,
      start = Math.max(Math.floor(s.ephStart / DAY) * DAY, day0) + timeOfDay(s.arrival);
    const to = window.setTimeout(() => {
      client.matrix([site], start, BEFORE + AFTER + 1, s.duration, s.config(), s.req).then(
        (m) => !dead && m.rows[0] && setRow({ r: m.rows[0], start }),
        () => {},
      );
    }, 150);
    return () => {
      dead = true;
      clearTimeout(to);
    };
  }, [key]);

  const n = row?.r.sun.length ?? 0,
    arrIdx = row ? Math.round((s.arrival - row.start) / DAY) : -1;
  const ok = (d: number) => !!row && row.r.ok[d] === 1;
  const H = 150;
  const ref = useCanvas(
    (ctx, W) => {
      if (!row) return;
      const L = 34,
        B = 22,
        w = (W - L - 6) / n,
        y = (v: number) => H - B - (v / 100) * (H - B - 10);
      ctx.font = '10.5px Inter, system-ui';
      ctx.fillStyle = '#6f7a96';
      ctx.textAlign = 'right';
      for (const v of [0, 50, 100]) {
        ctx.fillText(`${v}%`, L - 6, y(v) + 3);
        ctx.fillStyle = 'rgba(150,172,225,.08)';
        ctx.fillRect(L, y(v), W - L, 1);
        ctx.fillStyle = '#6f7a96';
      }
      for (let d = 0; d < n; d++) {
        const x = L + d * w,
          good = ok(d);
        ctx.fillStyle = good ? 'rgba(110,231,168,.10)' : 'rgba(0,0,0,0)';
        ctx.fillRect(x, 6, w, H - B - 6);
        ctx.fillStyle = `rgba(255,201,74,${good ? 0.95 : 0.55})`;
        ctx.fillRect(x + w * 0.15, y(row.r.sun[d]), w * 0.7, H - B - y(row.r.sun[d]));
      }
      ctx.strokeStyle = '#5aa9ff';
      ctx.lineWidth = 1.8;
      ctx.beginPath();
      for (let d = 0; d < n; d++) {
        const x = L + (d + 0.5) * w;
        d ? ctx.lineTo(x, y(row.r.dte[d])) : ctx.moveTo(x, y(row.r.dte[d]));
      }
      ctx.stroke();
      if (arrIdx >= 0 && arrIdx < n) {
        ctx.strokeStyle = '#fff';
        ctx.lineWidth = 1.5;
        ctx.strokeRect(L + arrIdx * w, 5, w, H - B - 4);
      }
      ctx.textAlign = 'center';
      ctx.fillStyle = '#a3adc4';
      for (let d = 0; d < n; d += 7) {
        const off = d - BEFORE;
        ctx.fillText(off === 0 ? 'planned' : `${off > 0 ? '+' : ''}${off} d`, L + (d + 0.5) * w, H - 6);
      }
    },
    [row, s.arrival, JSON.stringify(s.req)],
    H,
  );

  let best = -1,
    earlier: number | null = null,
    later: number | null = null;
  if (row) {
    for (let d = 0; d < n; d++) if (best < 0 || row.r.both[d] > row.r.both[best]) best = d;
    for (let d = arrIdx - 1; d >= 0; d--)
      if (ok(d)) {
        earlier = d;
        break;
      }
    for (let d = arrIdx + 1; d < n; d++)
      if (ok(d)) {
        later = d;
        break;
      }
  }
  const go = (d: number) => row && s.set({ arrival: row.start + d * DAY, cursor: row.start + d * DAY + DAY / 2 });
  const lab = (d: number) => `${fmtDate(row!.start + d * DAY).slice(5)} (${d - arrIdx > 0 ? '+' : ''}${d - arrIdx} d)`;
  return (
    <div className="card">
      <h3>
        If the landing slips{' '}
        <span className="faint" style={{ textTransform: 'none', letterSpacing: 0 }}>
          same site, same {s.duration}-day stay, arriving {BEFORE} days earlier to {AFTER} days later
        </span>
      </h3>
      {!row ? (
        <div className="row muted small">
          <i className="spin" aria-hidden /> Re-running {BEFORE + AFTER + 1} arrival dates…
        </div>
      ) : (
        <>
          <canvas ref={ref} role="img" aria-label="Sunlit and link percentage by arrival date" />
          <div className="small muted row" style={{ marginTop: 6, gap: 14 }}>
            <span>
              <span style={{ color: 'var(--sun)' }}>▮</span> sunlit %
            </span>
            <span>
              <span style={{ color: 'var(--earth)' }}>—</span> Earth link %
            </span>
            <span>
              <span style={{ color: 'var(--both)' }}>▮</span> meets your requirements
            </span>
          </div>
          <div className="row" style={{ marginTop: 10, gap: 8 }}>
            {earlier != null && (
              <button className="btn" onClick={() => go(earlier!)}>
                ← Nearest earlier OK date: {lab(earlier)}
              </button>
            )}
            {later != null && (
              <button className="btn" onClick={() => go(later!)}>
                Nearest later OK date: {lab(later)} →
              </button>
            )}
            {earlier == null && later == null && (
              <span className="small muted">
                No arrival in this range meets all requirements; relax one or raise the mast.
              </span>
            )}
            {best >= 0 && (
              <button className="btn" onClick={() => go(best)}>
                Best power + link: {lab(best)} · {row.r.both[best].toFixed(0)}% · dark {fmtH(row.r.dark[best])}
              </button>
            )}
          </div>
        </>
      )}
    </div>
  );
}
