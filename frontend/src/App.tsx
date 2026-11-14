import { useEffect, useRef, useState } from 'react';
import { useStore, stateToHash, DAY } from './store/useStore';
import type { Tab } from './store/useStore';
import { fmtDate } from './components/common';
import { Compare } from './components/Compare';
import { Sky } from './components/Sky';
import { MapView } from './components/MapView';
import { Trust } from './components/Trust';
import { Lesson } from './components/Lesson';

const TABS: [Tab, string][] = [
  ['compare', 'Compare'],
  ['sky', 'Sky'],
  ['map', 'Map'],
  ['trust', 'Trust'],
];

export function App() {
  const s = useStore();
  useEffect(() => {
    void useStore.getState().init();
  }, []);
  // debounce engine refresh on any input change
  const key = JSON.stringify([
    s.arrival,
    s.matrixStart,
    s.duration,
    s.z,
    s.spanDays,
    s.landerMask,
    s.stationMask,
    s.litThreshold,
    s.hardware,
    s.sites.map((x) => x.id),
    s.pinned,
    s.selected,
    s.reqOn ? s.req : null,
  ]);
  const t = useRef<number>();
  useEffect(() => {
    if (!s.ready) return;
    window.clearTimeout(t.current);
    t.current = window.setTimeout(() => void useStore.getState().refresh(), 90);
    return () => window.clearTimeout(t.current);
  }, [key, s.ready]);
  useEffect(() => {
    if (s.ready) history.replaceState(null, '', '#' + stateToHash(useStore.getState()));
  }, [s.ready, s.tab, s.mode, s.arrival, s.duration, s.z, s.sites, s.pinned]);

  if (s.error)
    return (
      <div style={{ padding: 24 }}>
        <div className="err">
          <b>Something went wrong.</b>
          <div className="small" style={{ marginTop: 6 }}>
            {s.error}
          </div>
        </div>
      </div>
    );
  return (
    <div className="app">
      <header className="top">
        <div className="brand">
          <div className="logo" aria-hidden />
          <div>
            HELIOS·LUNA<small>Where is the Sun and Earth, at the real horizon</small>
          </div>
        </div>
        <nav className="tabs" role="tablist">
          {TABS.map(([id, label]) => (
            <button key={id} role="tab" className="tab" aria-selected={s.tab === id} onClick={() => s.set({ tab: id })}>
              {label}
            </button>
          ))}
        </nav>
        <div className="seg" role="group" aria-label="Mode">
          {(['planner', 'educator', 'explorer'] as const).map((m) => (
            <button
              key={m}
              aria-pressed={s.mode === m}
              onClick={() => s.set({ mode: m, tab: m === 'explorer' ? 'sky' : s.tab })}
            >
              {m[0].toUpperCase() + m.slice(1)}
            </button>
          ))}
        </div>
      </header>
      <Sidebar />
      <main className="main">
        {!s.ready ? (
          <div className="card">
            <h3>Loading</h3>
            <div className="muted">Reading the SPICE ephemeris and the 480 m far-field terrain…</div>
          </div>
        ) : (
          <>
            {s.mode === 'educator' && <Lesson />}
            {s.tab === 'compare' && <Compare />}
            {s.tab === 'sky' && <Sky />}
            {s.tab === 'map' && <MapView />}
            {s.tab === 'trust' && <Trust />}
          </>
        )}
      </main>
      {s.busy > 0 && (
        <div className="busy" role="status">
          Computing…
        </div>
      )}
    </div>
  );
}

function Num({
  label,
  v,
  set,
  min,
  max,
  step = 1,
  unit = '',
}: {
  label: string;
  v: number | undefined;
  set: (n: number | undefined) => void;
  min: number;
  max: number;
  step?: number;
  unit?: string;
}) {
  return (
    <div className="field">
      <label>
        {label}
        <span>{unit}</span>
      </label>
      <input
        type="number"
        value={v ?? ''}
        min={min}
        max={max}
        step={step}
        placeholder="off"
        onChange={(e) => set(e.target.value === '' ? undefined : +e.target.value)}
      />
    </div>
  );
}

function Sidebar() {
  const s = useStore();
  const [reg, setReg] = useState('MMA'),
    [copied, setCopied] = useState(false);
  const region = s.regions.find((r) => r.id === reg) ?? s.regions.find((r) => !r.hidden);
  const inRange = (ms: number) => Math.min(Math.max(ms, s.ephStart), s.ephEnd - 40 * DAY);
  return (
    <aside className="side" aria-label="Mission settings">
      <div className="field">
        <label htmlFor="arr">
          Arrival date (UTC)<span>{s.ready ? '' : ''}</span>
        </label>
        <input
          id="arr"
          type="date"
          value={fmtDate(s.arrival)}
          min={s.ready ? fmtDate(s.ephStart) : undefined}
          max={s.ready ? fmtDate(s.ephEnd - 40 * DAY) : undefined}
          onChange={(e) => {
            const ms = Date.parse(e.target.value);
            if (isFinite(ms)) s.set({ arrival: inRange(ms), cursor: inRange(ms) + DAY });
          }}
        />
      </div>
      <div className="field">
        <label htmlFor="dur">
          Stay
          <span>
            {s.duration} day{s.duration === 1 ? '' : 's'}
          </span>
        </label>
        <input
          id="dur"
          type="range"
          min={1}
          max={28}
          value={s.duration}
          onChange={(e) => s.set({ duration: +e.target.value })}
        />
      </div>
      <div className="field">
        <label htmlFor="mast">
          Mast / array height<span>{s.z.toFixed(1)} m</span>
        </label>
        <input
          id="mast"
          type="range"
          min={0}
          max={50}
          step={0.5}
          value={s.z}
          onChange={(e) => s.set({ z: +e.target.value })}
        />
        <span className="faint small">Exact for every height (convex horizon envelope), not interpolated.</span>
      </div>

      <div>
        <div className="lbl" style={{ marginBottom: 6 }}>
          <span>Sites · ★ = shown in cards</span>
          <span>{s.sites.length}</span>
        </div>
        <div className="sitelist">
          {s.sites.map((x) => (
            <div
              key={x.id}
              className={'siteitem' + (s.selected === x.id ? ' sel' : '')}
              onClick={() => s.set({ selected: x.id })}
            >
              <button
                className={'iconbtn' + (s.pinned.includes(x.id) ? ' pinned' : '')}
                title="Show as scorecard"
                aria-label={`Pin ${x.label}`}
                onClick={(e) => {
                  e.stopPropagation();
                  s.togglePin(x.id);
                }}
              >
                ★
              </button>
              <span className="name" title={x.label}>
                {x.label}
              </span>
              <button
                className="iconbtn"
                aria-label={`Remove ${x.label}`}
                title="Remove"
                onClick={(e) => {
                  e.stopPropagation();
                  s.removeSite(x.id);
                }}
              >
                ×
              </button>
            </div>
          ))}
        </div>
      </div>
      {s.ready && region && (
        <div className="field">
          <label>
            Add a candidate site<span>130 in catalogue</span>
          </label>
          <select aria-label="Region" value={reg} onChange={(e) => setReg(e.target.value)}>
            {s.regions
              .filter((r) => !r.hidden)
              .map((r) => (
                <option key={r.id} value={r.id}>
                  {r.name}
                  {r.artemis3 ? '' : ' (classic)'}
                </option>
              ))}
          </select>
          <select
            aria-label="Site"
            value=""
            onChange={(e) => {
              const c = region.sites.find((q) => q.id === e.target.value);
              if (c) s.addSite({ id: c.id, label: `${region.name} · ${c.id}`, lat: c.lat, lon: c.lon });
            }}
          >
            <option value="">Choose a site in {region.name}…</option>
            {region.sites.map((c) => (
              <option key={c.id} value={c.id}>
                {c.id} ({c.lat.toFixed(2)}°, {c.lon.toFixed(2)}°)
              </option>
            ))}
          </select>
          <span className="faint small">Or click any cell on the Map tab to add a custom point.</span>
        </div>
      )}

      <details open={s.reqOn}>
        <summary>Requirements</summary>
        <label className="row small" style={{ margin: '8px 0' }}>
          <input type="checkbox" checked={s.reqOn} onChange={(e) => s.set({ reqOn: e.target.checked })} /> Mark cells
          that fail these
        </label>
        <div className="grid" style={{ gap: 8 }}>
          <Num
            label="Sunlit ≥"
            unit="%"
            v={s.req.minSunPct}
            min={0}
            max={100}
            set={(n) => s.set({ req: { ...s.req, minSunPct: n } })}
          />
          <Num
            label="Darkness ≤"
            unit="h"
            v={s.req.maxDarkH}
            min={0}
            max={700}
            set={(n) => s.set({ req: { ...s.req, maxDarkH: n } })}
          />
          <Num
            label="Earth link ≥"
            unit="%"
            v={s.req.minDtePct}
            min={0}
            max={100}
            set={(n) => s.set({ req: { ...s.req, minDtePct: n } })}
          />
          <Num
            label="Link outage ≤"
            unit="h"
            v={s.req.maxOutageH}
            min={0}
            max={700}
            set={(n) => s.set({ req: { ...s.req, maxOutageH: n } })}
          />
          <Num
            label="Power + link ≥"
            unit="%"
            v={s.req.minBothPct}
            min={0}
            max={100}
            set={(n) => s.set({ req: { ...s.req, minBothPct: n } })}
          />
        </div>
      </details>
      <details>
        <summary>Link &amp; power assumptions</summary>
        <div className="grid" style={{ gap: 8, marginTop: 8 }}>
          <Num
            label="Lander terrain mask"
            unit="°"
            v={s.landerMask}
            min={0}
            max={10}
            step={0.5}
            set={(n) => s.set({ landerMask: n ?? 2 })}
          />
          <Num
            label="Station elevation mask"
            unit="°"
            v={s.stationMask}
            min={0}
            max={30}
            step={1}
            set={(n) => s.set({ stationMask: n ?? 10 })}
          />
          <Num
            label="“Sunlit” if disc visible >"
            unit="fraction"
            v={s.litThreshold}
            min={0}
            max={0.95}
            step={0.05}
            set={(n) => s.set({ litThreshold: n ?? 0.1 })}
          />
          <Num
            label="Array (rated)"
            unit="kW"
            v={s.hardware.arrayKw}
            min={0}
            max={200}
            step={0.5}
            set={(n) => s.set({ hardware: { ...s.hardware, arrayKw: n ?? 0 } })}
          />
          <Num
            label="Load"
            unit="kW"
            v={s.hardware.loadKw}
            min={0}
            max={100}
            step={0.1}
            set={(n) => s.set({ hardware: { ...s.hardware, loadKw: n ?? 0 } })}
          />
          <Num
            label="Heater when dark"
            unit="kW"
            v={s.hardware.heaterKw}
            min={0}
            max={50}
            step={0.1}
            set={(n) => s.set({ hardware: { ...s.hardware, heaterKw: n ?? 0 } })}
          />
          <Num
            label="Battery"
            unit="kWh"
            v={s.hardware.batteryKwh}
            min={0}
            max={500}
            step={1}
            set={(n) => s.set({ hardware: { ...s.hardware, batteryKwh: n ?? 0 } })}
          />
          <span className="faint small">
            Hardware values are illustrative placeholders; edit them. Array assumed vertical and tracking the Sun in
            azimuth.
          </span>
        </div>
      </details>
      <button
        className="btn"
        onClick={() => {
          void navigator.clipboard?.writeText(location.href);
          setCopied(true);
          setTimeout(() => setCopied(false), 1600);
        }}
      >
        {copied ? 'Link copied' : 'Copy shareable link'}
      </button>
    </aside>
  );
}
