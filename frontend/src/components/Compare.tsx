import { useState } from 'react';
import { useStore, DAY, analysisKey, timeOfDay, utcDay } from '../store/useStore';
import {
  Icon,
  Tip,
  cssVar,
  qualityLabel,
  csv,
  download,
  fmtDate,
  fmtDT,
  fmtH,
  siteHue,
  useCanvas,
  viridis,
  viridisCss,
} from './common';
import { grade } from '../math/analysis';
import { OpsLine } from './OpsClock';
import { usePsr } from '../math/psr';
import { IcePanel } from './Ice';
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
        ctx.fillStyle = link ? cssVar('--earth') : cssVar('--line');
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

function Kpi({
  icon,
  label,
  value,
  sub,
  pct,
  color,
  bad,
  wide,
  help,
}: {
  icon: 'sun' | 'dark' | 'link' | 'gap' | 'both' | 'battery' | 'earth';
  label: string;
  value: string;
  sub?: string;
  pct?: number;
  color: string;
  bad?: boolean;
  wide?: boolean;
  help?: string;
}) {
  return (
    <div className="kpi" style={wide ? { gridColumn: '1 / -1' } : undefined} title={help}>
      <div className="k" style={{ color }}>
        <Icon name={icon} size={13} />
        <span style={{ color: 'var(--muted)' }}>{label}</span>
      </div>
      <div className="v" style={bad ? { color: 'var(--bad)' } : undefined}>
        {value}
        {sub && <small>{sub}</small>}
      </div>
      {pct != null && (
        <div className="meter">
          <i style={{ width: `${Math.max(0, Math.min(100, pct))}%`, background: color }} />
        </div>
      )}
    </div>
  );
}

function Card({ id }: { id: string }) {
  const s = useStore(),
    a = s.analyses[id],
    site = s.sites.find((x) => x.id === id),
    band = site && s.bandKeys[id] === analysisKey(s, site) ? s.bands[id] : undefined;
  const psr = usePsr(site?.lat, site?.lon);
  if (!site) return null;
  const stale = !!a && s.analysisKeys[id] !== analysisKey(s, site);
  const q = a?.meta.quality;
  const rng = (b?: [number, number]) => (b && b[1] - b[0] >= 1 ? `${b[0].toFixed(0)}–${b[1].toFixed(0)}` : undefined);
  const hrs = s.duration * 24;
  const name = site.id.startsWith('Custom') ? 'Custom point' : site.label.replace(/ · .*/, '');
  const g = a ? grade(a.summary, s.req) : null;
  return (
    <div
      className={'card sitecard' + (s.selected === id ? ' sel' : '') + (stale ? ' stale' : '')}
      onClick={() => s.set({ selected: id })}
      aria-busy={stale || !a}
    >
      <div className="row" style={{ justifyContent: 'space-between', alignItems: 'flex-start', flexWrap: 'nowrap' }}>
        <div style={{ minWidth: 0 }}>
          <div
            style={{ fontSize: 16, fontWeight: 650, lineHeight: 1.25, display: 'flex', alignItems: 'center', gap: 8 }}
          >
            {site.id.startsWith('Custom') ? 'Custom point' : site.id}
          </div>
          <div className="coords">
            {site.id.startsWith('Custom') ? '' : name + ' · '}
            {site.lat.toFixed(3)}°, {site.lon.toFixed(3)}°{q ? ` · ${qualityLabel(q)}` : ''}
          </div>
        </div>
        {g && (
          <span className={'grade ' + g.grade} title="Against the mission profile (top bar)">
            {g.grade === 'go' ? 'GO' : g.grade === 'check' ? 'CHECK' : 'NO-GO'}
          </span>
        )}
      </div>
      {!a ? (
        <div className="row muted small" style={{ padding: '26px 4px' }}>
          <i className="spin" aria-hidden /> Tracing the horizon…
        </div>
      ) : (
        <>
          <div style={{ margin: '12px 0 4px' }}>
            <MiniTimeline a={a} />
          </div>
          <div className="faint small row" style={{ justifyContent: 'space-between' }}>
            <span>{fmtDate(s.arrival).slice(5)}</span>
            <span>
              <span style={{ color: 'var(--sun)' }}>●</span> sunlight <span style={{ color: 'var(--earth)' }}>●</span>{' '}
              Earth link
            </span>
            <span>{fmtDate(s.arrival + s.duration * DAY).slice(5)}</span>
          </div>
          <div className="kpis">
            <Kpi
              icon="sun"
              label="Sunlit"
              help={HELP.sun}
              value={`${a.summary.sunPct.toFixed(0)}%`}
              sub={s.selected === id ? rng(band?.sun) : undefined}
              pct={a.summary.sunPct}
              color="var(--sun)"
            />
            <Kpi
              icon="dark"
              label="Longest darkness"
              help={HELP.dark}
              value={fmtH(a.summary.longestDarkH)}
              pct={(100 * a.summary.longestDarkH) / hrs}
              color="var(--faint)"
            />
            <Kpi
              icon="link"
              label="Earth link"
              help={HELP.link}
              value={`${a.summary.dtePct.toFixed(0)}%`}
              sub={s.selected === id ? rng(band?.dte) : undefined}
              pct={a.summary.dtePct}
              color="var(--earth)"
            />
            <Kpi
              icon="gap"
              label="Longest outage"
              help={HELP.outage}
              value={fmtH(a.summary.longestOutageH)}
              pct={(100 * a.summary.longestOutageH) / hrs}
              color="var(--faint)"
            />
          </div>
          <IcePanel psr={psr} compact />
          {g && g.reasons.length > 0 && (
            <ul className="reasons">
              {g.reasons.map((r) => (
                <li key={r}>{r}</li>
              ))}
            </ul>
          )}
          {a.events && <OpsLine ev={a.events} />}
          <div className="row" style={{ marginTop: 4 }}>
            <button
              className="btn"
              onClick={(e) => {
                e.stopPropagation();
                s.set({ selected: id, tab: 'sky', cursor: s.arrival + DAY / 2 });
              }}
            >
              Details
            </button>
            <button
              className="btn quiet"
              onClick={(e) => {
                e.stopPropagation();
                s.set({ selected: id, tab: 'pole' });
              }}
            >
              On the map
            </button>
          </div>
        </>
      )}
    </div>
  );
}

/** One-line meanings shown on hover for the headline numbers. */
export const HELP = {
  sun: 'Share of the stay with the Sun above the real terrain horizon, weighted by how much of its disc shows. From SPICE DE440 and LOLA terrain; validated against NASA PGDA maps and LROC images.',
  dark: 'Longest continuous stretch with (almost) no Sun: what the battery must survive.',
  link: 'Share of the stay with at least one ground station (DSN by default) able to talk to the lander, both elevation masks met.',
  outage: 'Longest continuous stretch without any station link.',
};

function rowLabel(label: string, id: string, lat?: number, lon?: number) {
  if (id.startsWith('Custom') && lat != null && lon != null) return `Custom ${lat.toFixed(2)}°, ${lon.toFixed(2)}°`;
  return `${id} · ${label.replace(/ · .*/, '')}`;
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
  const [tip, setTip] = useState<{ x: number; y: number; t: string } | null>(null),
    [hov, setHov] = useState<{ d: number; i: number } | null>(null);
  const LABEL = 196,
    ROW = 26,
    TOP = 34;
  const rows = m?.rows ?? [];
  const maxDark = Math.max(24, s.duration * 24);
  const val = (r: (typeof rows)[0], d: number) =>
    s.matrixMetric === 'dark' ? 1 - r.dark[d] / maxDark : r[s.matrixMetric][d] / 100;
  const H = TOP + rows.length * ROW + 6;
  const ref = useCanvas(
    (ctx, w) => {
      ctx.font = '12px Inter, system-ui';
      ctx.textBaseline = 'middle';
      const cw = (w - LABEL) / s.spanDays;
      rows.forEach((r, i) => {
        const site = s.sites.find((x) => x.id === r.id);
        const y = TOP + i * ROW;
        ctx.fillStyle = s.selected === r.id || hov?.i === i ? cssVar('--text') : cssVar('--muted');
        ctx.textAlign = 'left';
        let lab = rowLabel(site?.label ?? r.id, r.id, site?.lat, site?.lon);
        while (lab.length > 4 && ctx.measureText(lab).width > LABEL - 28) lab = lab.slice(0, -2) + '…';
        ctx.fillStyle = siteHue(r.id);
        ctx.beginPath();
        ctx.arc(8, y + ROW / 2, 3.5, 0, 7);
        ctx.fill();
        ctx.fillStyle = s.selected === r.id || hov?.i === i ? cssVar('--text') : cssVar('--muted');
        ctx.fillText(lab, 18, y + ROW / 2);
        for (let d = 0; d < r.sun.length; d++) {
          const [R, G, B] = viridis(val(r, d));
          ctx.fillStyle = `rgb(${R},${G},${B})`;
          ctx.fillRect(LABEL + d * cw, y + 1, Math.ceil(cw), ROW - 2);
          if (s.reqOn && !r.ok[d]) {
            ctx.globalAlpha = 0.72;
            ctx.fillStyle = cssVar('--surface');
            ctx.fillRect(LABEL + d * cw, y + 1, Math.ceil(cw), ROW - 2);
            ctx.globalAlpha = 1;
          }
        }
      });
      // ticks at the first of each month (every second month on long spans), year shown in January
      ctx.textAlign = 'left';
      const every = s.spanDays > 200 ? 2 : 1;
      for (let d = 0; d < s.spanDays; d++) {
        const dt = new Date(s.matrixStart + d * DAY);
        if (dt.getUTCDate() !== 1 || dt.getUTCMonth() % every) continue;
        const x = LABEL + d * cw,
          mon = dt.toLocaleString('en', { month: 'short', timeZone: 'UTC' });
        ctx.fillStyle = cssVar('--line2');
        ctx.fillRect(x, 16, 1, TOP - 16 + rows.length * ROW);
        ctx.fillStyle = cssVar('--muted');
        ctx.fillText(dt.getUTCMonth() === 0 ? `${mon} ${dt.getUTCFullYear()}` : mon, x + 3, 10);
      }
      if (hov && rows[hov.i]) {
        ctx.strokeStyle = 'rgba(255,255,255,.85)';
        ctx.lineWidth = 1.5;
        ctx.strokeRect(LABEL + hov.d * cw + 0.5, TOP + hov.i * ROW + 0.5, Math.max(2, cw) - 1, ROW - 1);
        ctx.fillStyle = 'rgba(255,255,255,.06)';
        ctx.fillRect(0, TOP + hov.i * ROW, LABEL - 4, ROW);
      }
      const ad = (utcDay(s.arrival) - s.matrixStart) / DAY;
      if (ad >= 0 && ad < s.spanDays) {
        ctx.strokeStyle = '#ffc83d';
        ctx.lineWidth = 2;
        ctx.strokeRect(LABEL + ad * cw - 1, TOP - 2, s.duration * cw + 2, rows.length * ROW + 3);
        ctx.fillStyle = '#ffc83d';
        ctx.textAlign = 'left';
        ctx.fillText('arrival', LABEL + ad * cw + 2, 26);
      }
    },
    [m, s.matrixMetric, s.arrival, s.duration, s.selected, s.reqOn, s.sites, hov],
    H,
  );
  const exportCsv = () => {
    if (!m) return;
    const c = s.config(),
      hw = c.hardware,
      rq = s.req;
    const out: (string | number)[][] = [];
    for (const r of rows) {
      const site = s.sites.find((x) => x.id === r.id);
      for (let d = 0; d < r.sun.length; d++)
        out.push([
          r.id,
          site?.label ?? r.id,
          site?.lat.toFixed(5) ?? '',
          site?.lon.toFixed(5) ?? '',
          m.quality[r.id] ?? '',
          new Date(s.matrixStart + d * DAY + timeOfDay(s.arrival)).toISOString().slice(0, 16) + 'Z',
          r.sun[d].toFixed(2),
          r.dte[d].toFixed(2),
          r.both[d].toFixed(2),
          r.dark[d].toFixed(1),
          r.outage[d].toFixed(1),
          s.reqOn ? r.ok[d] : '',
        ]);
    }
    download(
      `helios-luna_matrix_${fmtDate(s.matrixStart)}_${s.spanDays}d_stay${s.duration}d.csv`,
      csv(
        {
          tool: 'HELIOS-LUNA lunar landing site navigator',
          meaning: `each row = a ${s.duration}-day stay starting at 00:00 UTC on arrival_date, hourly sampling`,
          mast_m: c.z,
          lander_terrain_mask_deg: c.landerMask,
          station_elevation_mask_deg: c.stationMask,
          lit_threshold_disc_fraction: c.litThreshold,
          hardware: `array ${hw.arrayKw} kW, load ${hw.loadKw} kW, heater ${hw.heaterKw} kW, battery ${hw.batteryKwh} kWh`,
          requirements: s.reqOn
            ? `sunlit>=${rq.minSunPct ?? '-'}% dark<=${rq.maxDarkH ?? '-'}h link>=${rq.minDtePct ?? '-'}% outage<=${rq.maxOutageH ?? '-'}h both>=${rq.minBothPct ?? '-'}%`
            : 'off',
          ephemeris: 'NAIF SPICE DE440, MOON_ME frame, LT+S, baked hourly',
          link: location.href,
          generated_utc: new Date().toISOString(),
        },
        [
          'site_id',
          'label',
          'lat_deg',
          'lon_deg',
          'terrain_quality',
          'arrival_utc',
          'sunlit_pct',
          'link_pct',
          'power_and_link_pct',
          'longest_dark_h',
          'longest_outage_h',
          'meets_requirements',
        ],
        out,
      ),
    );
  };
  const locate = (e: React.MouseEvent<HTMLCanvasElement>) => {
    const r = e.currentTarget.getBoundingClientRect(),
      x = e.clientX - r.left,
      y = e.clientY - r.top,
      cw = (r.width - LABEL) / s.spanDays;
    const d = Math.floor((x - LABEL) / cw),
      i = Math.floor((y - TOP) / ROW);
    return i >= 0 && i < rows.length && d >= 0 && d < rows[i].sun.length ? { d, i } : null;
  };
  return (
    <div className="card">
      <h3>
        Arrival dates
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
        {s.reqOn && <span>dimmed = fails the mission profile</span>}
        {m && s.mode !== 'explorer' && (
          <button className="btn" style={{ marginLeft: 'auto' }} onClick={exportCsv} title="Every site × arrival day">
            CSV
          </button>
        )}
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
              if (!p) {
                setHov(null);
                return setTip(null);
              }
              if (!hov || hov.d !== p.d || hov.i !== p.i) setHov(p);
              const r = rows[p.i],
                d = p.d;
              setTip({
                x: e.clientX,
                y: e.clientY,
                t: `${r.id} · arrive ${fmtDate(s.matrixStart + d * DAY)}\nSunlit ${r.sun[d].toFixed(0)}% · dark ${fmtH(r.dark[d])}\nLink ${r.dte[d].toFixed(0)}% · outage ${fmtH(r.outage[d])}\nBoth ${r.both[d].toFixed(0)}%${s.reqOn ? (r.ok[d] ? ' · meets requirements' : ' · fails requirements') : ''}`,
              });
            }}
            onMouseLeave={() => {
              setTip(null);
              setHov(null);
            }}
            onClick={(e) => {
              const p = locate(e);
              if (p)
                s.set({
                  arrival: s.matrixStart + p.d * DAY + timeOfDay(s.arrival),
                  selected: rows[p.i].id,
                  cursor: s.matrixStart + p.d * DAY + timeOfDay(s.arrival) + DAY / 2,
                });
            }}
          />
          {tip && (
            <Tip x={tip.x} y={tip.y}>
              {tip.t}
            </Tip>
          )}
        </div>
      )}
      <div className="faint small" style={{ marginTop: 6 }}>
        Click a cell to arrive then. The matrix samples hourly; scorecards and the Sky view use 10-minute steps, so they
        can differ by a point or two. {m && `Computed in ${m.ms.toFixed(0)} ms.`}{' '}
        {Object.values(m?.quality ?? {}).some((q) => q === 'coarse' || q === 'global') &&
          'Sites outside the Artemis regions use 240 m (polar) or 1.9 km (global LOLA) terrain.'}
      </div>
    </div>
  );
}

export function Compare() {
  const s = useStore();
  const ids = s.pinned.filter((id) => s.sites.some((x) => x.id === id));
  const go = ids.filter((id) => s.analyses[id] && grade(s.analyses[id].summary, s.req).grade === 'go').length;
  return (
    <div className="page">
      <header className="pagehead">
        <div>
          <h1>Compare sites</h1>
          <p className="sub">
            Touchdown {fmtDT(s.arrival)} · {s.duration}-day stay · {go} of {ids.length} sites GO
          </p>
        </div>
      </header>
      {ids.length === 0 ? (
        <section className="panel empty">
          <p>
            Star (☆) up to four sites in the sidebar, or search for one with <kbd>⌘</kbd>
            <kbd>K</kbd>.
          </p>
        </section>
      ) : (
        <div className="cards">
          {ids.map((id) => (
            <Card key={id} id={id} />
          ))}
        </div>
      )}
      <Matrix />
    </div>
  );
}
