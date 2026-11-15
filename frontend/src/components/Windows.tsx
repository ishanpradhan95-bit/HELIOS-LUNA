import { useEffect, useState } from 'react';
import { useStore, client, DAY, analysisKey } from '../store/useStore';
import type { LandingWindow } from '../math/client';
import { PROFILES } from '../math/analysis';
import { Tip, cssVar, download, fmtDT, siteHue, useCanvas } from './common';
import { fmtSpan } from './OpsClock';

interface Row {
  id: string;
  label: string;
  wins: LandingWindow[];
}
const SPANS = [30, 90, 180];

/** iCalendar text for a list of windows (opens in Outlook, Google Calendar, Apple Calendar). */
function ics(rows: Row[], note: string) {
  const d = (ms: number) => new Date(ms).toISOString().replace(/[-:]/g, '').slice(0, 15) + 'Z';
  const lines = ['BEGIN:VCALENDAR', 'VERSION:2.0', 'PRODID:-//HELIOS-LUNA//Landing windows//EN', 'CALSCALE:GREGORIAN'];
  for (const r of rows)
    for (const w of r.wins)
      lines.push(
        'BEGIN:VEVENT',
        `UID:${r.id.replace(/\W/g, '')}-${w.startMs}@helios-luna`,
        `DTSTAMP:${d(Date.now())}`,
        `DTSTART:${d(w.startMs)}`,
        `DTEND:${d(w.endMs)}`,
        `SUMMARY:Landing window: ${r.id}`,
        `DESCRIPTION:Sun ${w.sunElMin.toFixed(1)}-${w.sunElMax.toFixed(1)} deg at touchdown; stay up to ${w.bestSun.toFixed(0)}% sunlit, ${w.bestDte.toFixed(0)}% Earth link. ${note}`.slice(
          0,
          900,
        ),
        'END:VEVENT',
      );
  lines.push('END:VCALENDAR');
  return lines.join('\r\n') + '\r\n';
}

/** Landing window finder: when can we touch down at each site so that landing and the stay both work? */
export function Windows() {
  const s = useStore();
  const [span, setSpan] = useState(90),
    [elMin, setElMin] = useState(1),
    [elMax, setElMax] = useState(15),
    [descent, setDescent] = useState(1),
    [scope, setScope] = useState<'pinned' | 'all'>('pinned');
  const [rows, setRows] = useState<Row[] | null>(null),
    [busy, setBusy] = useState(0);
  const [tip, setTip] = useState<{ x: number; y: number; t: string } | null>(null);
  const sites = scope === 'all' ? s.sites : s.sites.filter((x) => s.pinned.includes(x.id) || x.id === s.selected);
  const start = Math.floor(s.arrival / DAY) * DAY;
  const key = JSON.stringify([
    sites.map((x) => x.id),
    start,
    span,
    elMin,
    elMax,
    descent,
    sites[0] && analysisKey(s, sites[0]),
    s.req,
  ]);
  useEffect(() => {
    let dead = false;
    setRows(null);
    const to = window.setTimeout(async () => {
      const out: Row[] = [];
      for (const ref of sites) {
        if (dead) return;
        setBusy(out.length + 1);
        try {
          const r = await client.windows(ref, s.config(), s.req, start, span, s.duration, {
            sunElMin: elMin,
            sunElMax: elMax,
            descentH: descent,
          });
          out.push({ id: ref.id, label: ref.label, wins: r.windows });
        } catch (e) {
          s.set({ notice: String((e as Error).message) });
        }
      }
      if (!dead) {
        setRows(out);
        setBusy(0);
      }
    }, 250);
    return () => {
      dead = true;
      clearTimeout(to);
    };
  }, [key]);

  const ROW = 30,
    LAB = 170,
    TOP = 24;
  const H = TOP + (rows?.length ?? 0) * ROW + 8;
  const ref = useCanvas(
    (ctx, W) => {
      if (!rows) return;
      const x = (t: number) => LAB + ((t - start) / (span * DAY)) * (W - LAB - 4);
      ctx.font = '12px Inter, system-ui';
      ctx.textBaseline = 'middle';
      // month ticks
      for (let d = 0; d <= span; d++) {
        const dt = new Date(start + d * DAY);
        if (dt.getUTCDate() !== 1) continue;
        ctx.fillStyle = cssVar('--line');
        ctx.fillRect(x(+dt), TOP - 6, 1, rows.length * ROW + 6);
        ctx.fillStyle = cssVar('--faint');
        ctx.textAlign = 'left';
        ctx.fillText(dt.toLocaleString('en', { month: 'short', timeZone: 'UTC' }), x(+dt) + 3, 10);
      }
      rows.forEach((r, i) => {
        const y = TOP + i * ROW;
        ctx.fillStyle = siteHue(r.id);
        ctx.beginPath();
        ctx.arc(8, y + ROW / 2, 3.5, 0, 7);
        ctx.fill();
        ctx.fillStyle = cssVar('--text');
        ctx.textAlign = 'left';
        ctx.fillText(r.id.startsWith('Custom') ? 'Custom' : r.id, 18, y + ROW / 2);
        ctx.fillStyle = cssVar('--panel2');
        ctx.fillRect(LAB, y + 6, W - LAB - 4, ROW - 12);
        ctx.fillStyle = cssVar('--ok');
        for (const w of r.wins) ctx.fillRect(x(w.startMs), y + 6, Math.max(2, x(w.endMs) - x(w.startMs)), ROW - 12);
      });
      ctx.fillStyle = cssVar('--accent');
      ctx.fillRect(x(s.arrival), TOP - 6, 1.5, rows.length * ROW + 6);
    },
    [rows, s.arrival],
    H,
  );
  const hit = (e: React.MouseEvent<HTMLCanvasElement>) => {
    if (!rows) return null;
    const r = e.currentTarget.getBoundingClientRect(),
      W = r.width,
      i = Math.floor((e.clientY - r.top - TOP) / ROW);
    if (i < 0 || i >= rows.length) return null;
    const t = start + ((e.clientX - r.left - LAB) / (W - LAB - 4)) * span * DAY;
    const w = rows[i].wins.find((w) => t >= w.startMs - 3 * 3.6e6 && t <= w.endMs + 3 * 3.6e6);
    return w ? { row: rows[i], w } : null;
  };
  const use = (id: string, w: LandingWindow) =>
    s.set({ selected: id, arrival: w.startMs, cursor: w.startMs + DAY / 2, tab: 'sky' });

  const all = (rows ?? []).flatMap((r) => r.wins.map((w) => ({ r, w }))).sort((a, b) => a.w.startMs - b.w.startMs);
  const prof = PROFILES.find((p) => p.id === s.profile);
  const note = `Profile: ${prof?.name ?? 'custom'}; ${s.duration}-day stay; ${descent} h station contact before touchdown; HELIOS-LUNA ${location.href}`;
  const summary = !rows
    ? `Checking every touchdown hour at ${busy || 1} of ${sites.length} sites…`
    : all.length
      ? `${all.length} window${all.length === 1 ? '' : 's'} at ${rows.filter((r) => r.wins.length).length} of ${rows.length} sites · earliest ${all[0].r.id}, ${fmtDT(all[0].w.startMs)}`
      : 'No window in this span';
  return (
    <div className="page">
      <header className="pagehead">
        <div>
          <h1>Landing windows</h1>
          <p className="sub">{summary}</p>
        </div>
        {rows && all.length > 0 && (
          <button
            className="btn"
            onClick={() => download('helios-luna_landing-windows.ics', ics(rows, note), 'text/calendar')}
            title="Add every window to Outlook, Google or Apple Calendar"
          >
            Add to calendar
          </button>
        )}
      </header>
      <p className="lede">
        Touchdown times when the Sun is at a usable angle for the landing cameras, a ground station sees the lander
        through descent, and the {s.duration}-day stay that follows meets the {prof?.name ?? 'custom'} profile.
      </p>
      <section className="panel">
        <div className="row wctl">
          <label>
            Search
            <select className="ctl" value={span} onChange={(e) => setSpan(+e.target.value)}>
              {SPANS.map((d) => (
                <option key={d} value={d}>
                  {d} days from {new Date(start).toISOString().slice(0, 10)}
                </option>
              ))}
            </select>
          </label>
          <label title="Sun elevation at touchdown, degrees above the local horizontal">
            Sun at touchdown
            <input
              type="number"
              value={elMin}
              min={-1}
              max={89}
              step={0.5}
              onChange={(e) => setElMin(+e.target.value)}
            />
            to
            <input
              type="number"
              value={elMax}
              min={0}
              max={90}
              step={0.5}
              onChange={(e) => setElMax(+e.target.value)}
            />
            °
          </label>
          <label title="Hours before touchdown during which a Deep Space Network station must see the lander">
            Station contact through descent
            <select className="ctl" value={descent} onChange={(e) => setDescent(+e.target.value)}>
              {[0, 1, 2, 4].map((h) => (
                <option key={h} value={h}>
                  {h ? `${h} h before` : 'at touchdown'}
                </option>
              ))}
            </select>
          </label>
          <label>
            Sites
            <select className="ctl" value={scope} onChange={(e) => setScope(e.target.value as 'pinned' | 'all')}>
              <option value="pinned">compared (★)</option>
              <option value="all">all in your list ({s.sites.length})</option>
            </select>
          </label>
        </div>
        {!rows ? (
          <div className="row muted small" style={{ padding: '18px 0' }}>
            <i className="spin" aria-hidden /> Searching…
          </div>
        ) : all.length === 0 ? (
          <p className="muted small" style={{ padding: '14px 0 2px' }}>
            Nothing qualifies. Widen the Sun angles, shorten the descent contact, or relax the profile.
          </p>
        ) : (
          <>
            <div style={{ position: 'relative' }}>
              <canvas
                ref={ref}
                style={{ cursor: 'pointer' }}
                role="img"
                aria-label="Landing windows by site over the search span"
                onMouseMove={(e) => {
                  const h = hit(e);
                  setTip(
                    h
                      ? {
                          x: e.clientX,
                          y: e.clientY,
                          t: `${h.row.id}\n${fmtDT(h.w.startMs)} → ${fmtDT(h.w.endMs).slice(5)}\nSun ${h.w.sunElMin.toFixed(1)}–${h.w.sunElMax.toFixed(1)}° at touchdown\nClick to plan this landing`,
                        }
                      : null,
                  );
                }}
                onMouseLeave={() => setTip(null)}
                onClick={(e) => {
                  const h = hit(e);
                  if (h) use(h.row.id, h.w);
                }}
              />
              {tip && (
                <Tip x={tip.x} y={tip.y}>
                  {tip.t}
                </Tip>
              )}
            </div>
          </>
        )}
      </section>
      {rows && all.length > 0 && (
        <section className="panel">
          <div className="panelhead">
            <h2>All windows, earliest first</h2>
          </div>
          <table>
            <thead>
              <tr>
                <th>Site</th>
                <th>Opens (UTC)</th>
                <th>Closes</th>
                <th>Length</th>
                <th title="Sun elevation range at touchdown">Sun at touchdown</th>
                <th title="Best stay over the window">Stay sunlit</th>
                <th>Stay link</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {all.slice(0, 40).map(({ r, w }) => (
                <tr key={r.id + w.startMs}>
                  <td>
                    <i className="chip" style={{ ['--hue' as string]: siteHue(r.id) }} /> {r.id}
                  </td>
                  <td>{fmtDT(w.startMs).slice(0, 16)}</td>
                  <td>{fmtDT(w.endMs).slice(5, 16)}</td>
                  <td>{fmtSpan(w.endMs - w.startMs)}</td>
                  <td>
                    {w.sunElMin.toFixed(1)}–{w.sunElMax.toFixed(1)}°
                  </td>
                  <td>up to {w.bestSun.toFixed(0)}%</td>
                  <td>up to {w.bestDte.toFixed(0)}%</td>
                  <td>
                    <button className="btn quiet" onClick={() => use(r.id, w)}>
                      Plan this
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          <p className="faint small">
            Hourly search; window edges are good to the hour. Details opens the Site view at the window's first hour.
          </p>
        </section>
      )}
    </div>
  );
}
