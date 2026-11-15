import { useEffect, useRef, useState } from 'react';
import { useStore, stateToHash, DAY, MAX_STAY, timeOfDay, utcDay } from './store/useStore';
import type { Tab } from './store/useStore';
import { Icon, download, fmtDate, siteHue } from './components/common';
import { PROFILES, grade, type ArrayType, type Station } from './math/analysis';
import { NETWORKS, stationsFor, type Network } from './data/networks';
import { PoleView } from './components/PoleView';
import { SitePicker } from './components/SitePicker';
import { Brief } from './components/Brief';
import { Windows } from './components/Windows';
import { Compare } from './components/Compare';
import { Sky } from './components/Sky';
import { MapView } from './components/MapView';
import { Trust } from './components/Trust';
import { Lesson } from './components/Lesson';

const VIEWS: { id: Tab; label: string; also?: Tab[] }[] = [
  { id: 'compare', label: 'Compare' },
  { id: 'windows', label: 'Windows' },
  { id: 'sky', label: 'Site' },
  { id: 'pole', label: 'Map', also: ['map'] },
];
const GRADE_TEXT = { go: 'GO', check: 'CHECK', nogo: 'NO-GO' } as const;

function useTheme() {
  const [theme, setTheme] = useState<'dark' | 'light'>(() => {
    try {
      const saved = localStorage.getItem('hl-theme') as 'dark' | 'light' | null;
      if (saved) return saved;
    } catch {
      /* private mode */
    }
    return window.matchMedia?.('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
  });
  useEffect(() => {
    document.documentElement.dataset.theme = theme;
    window.dispatchEvent(new Event('hl-theme'));
    try {
      localStorage.setItem('hl-theme', theme);
    } catch {
      /* private mode */
    }
  }, [theme]);
  return [theme, setTheme] as const;
}

export function App() {
  const s = useStore();
  const [palette, setPalette] = useState(false),
    [menu, setMenu] = useState(false),
    [more, setMore] = useState(false),
    [copied, setCopied] = useState(false);
  const [theme, setTheme] = useTheme();
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const typing = /INPUT|SELECT|TEXTAREA/.test((e.target as HTMLElement)?.tagName ?? '');
      if ((e.key === 'k' && (e.metaKey || e.ctrlKey)) || (e.key === '/' && !typing)) {
        e.preventDefault();
        setPalette((p) => !p);
      } else if (e.key === 'Escape') {
        setPalette(false);
        setMenu(false);
        setMore(false);
        useStore.getState().set({ drawer: null });
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);
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
    s.stations.map((x) => [x.id, x.lat, x.lon]),
  ]);
  const t = useRef<number>();
  useEffect(() => {
    if (!s.ready) return;
    window.clearTimeout(t.current);
    t.current = window.setTimeout(() => void useStore.getState().refresh(), 90);
    return () => window.clearTimeout(t.current);
  }, [key, s.ready]);
  const hash = s.ready ? stateToHash(s) : '';
  useEffect(() => {
    if (hash) history.replaceState(null, '', '#' + hash);
  }, [hash]);

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
  const isMap = s.tab === 'pole';
  return (
    <div className="app">
      <header className="top">
        <div className="brand" title="HELIOS·LUNA: lunar landing-site navigator">
          <i className="logo" aria-hidden />
          <span className="name">HELIOS·LUNA</span>
        </div>
        <nav className="views" aria-label="Views">
          {VIEWS.map((v) => (
            <button
              key={v.id}
              className="view"
              aria-current={s.tab === v.id || v.also?.includes(s.tab) ? 'page' : undefined}
              onClick={() => s.set({ tab: v.id })}
            >
              {v.label}
            </button>
          ))}
        </nav>
        <div className="actions">
          <button
            className="btn"
            onClick={() => {
              void navigator.clipboard?.writeText(location.href);
              setCopied(true);
              setTimeout(() => setCopied(false), 1600);
            }}
            title="Copy a link that reproduces exactly this analysis"
          >
            {copied ? 'Link copied' : 'Share'}
          </button>
          <div className="menuwrap">
            <button className="btn" onClick={() => setMenu((m) => !m)} aria-expanded={menu}>
              Export
            </button>
            {menu && (
              <div className="menu" role="menu" onClick={() => setMenu(false)}>
                <button role="menuitem" onClick={() => s.set({ tab: 'brief' })}>
                  Mission brief <small>printable PDF for the team</small>
                </button>
                <button
                  role="menuitem"
                  onClick={() =>
                    download(
                      'helios-luna_sites.geojson',
                      JSON.stringify(
                        {
                          type: 'FeatureCollection',
                          name: 'HELIOS-LUNA sites',
                          note: 'Lunar coordinates: planetocentric latitude, east longitude (MOON_ME, 1737.4 km sphere), not WGS84.',
                          features: s.sites.map((x) => {
                            const a = s.analyses[x.id];
                            return {
                              type: 'Feature',
                              geometry: { type: 'Point', coordinates: [x.lon, x.lat] },
                              properties: {
                                id: x.id,
                                label: x.label,
                                touchdown_utc: new Date(s.arrival).toISOString(),
                                stay_days: s.duration,
                                ...(a
                                  ? {
                                      grade: grade(a.summary, s.req).grade,
                                      sunlit_pct: +a.summary.sunPct.toFixed(1),
                                      longest_dark_h: +a.summary.longestDarkH.toFixed(1),
                                      link_pct: +a.summary.dtePct.toFixed(1),
                                      longest_outage_h: +a.summary.longestOutageH.toFixed(1),
                                    }
                                  : {}),
                              },
                            };
                          }),
                        },
                        null,
                        1,
                      ),
                      'application/geo+json',
                    )
                  }
                >
                  Sites <small>GeoJSON for GIS tools</small>
                </button>
                <button role="menuitem" onClick={() => s.set({ tab: 'sky' })}>
                  Horizon mask <small>STK .aem, from Site</small>
                </button>
                <button role="menuitem" onClick={() => s.set({ tab: 'windows' })}>
                  Landing windows <small>calendar (.ics), from Windows</small>
                </button>
                <button role="menuitem" onClick={() => s.set({ tab: 'compare' })}>
                  Date matrix <small>CSV, from Compare</small>
                </button>
                <button role="menuitem" onClick={() => s.set({ tab: 'sky' })}>
                  Timeline, passes, horizon <small>CSV, from Site</small>
                </button>
              </div>
            )}
          </div>
          <div className="menuwrap">
            <button className="btn" aria-label="More" aria-expanded={more} onClick={() => setMore((m) => !m)}>
              ⋯
            </button>
            {more && (
              <div className="menu" role="menu" onClick={() => setMore(false)}>
                <button role="menuitem" onClick={() => s.set({ drawer: 'learn' })}>
                  Learn the basics <small>a 7-step guided lesson</small>
                </button>
                <button role="menuitem" onClick={() => s.set({ tab: 'trust' })}>
                  Methods &amp; validation <small>12 automated tests</small>
                </button>
                <button role="menuitem" onClick={() => s.set({ drawer: 'profile' })}>
                  Mission profile <small>requirements, network, power</small>
                </button>
                <hr />
                <button role="menuitem" onClick={() => setTheme(theme === 'dark' ? 'light' : 'dark')}>
                  {theme === 'dark' ? 'Light appearance' : 'Dark appearance'}
                </button>
              </div>
            )}
          </div>
        </div>
      </header>
      <Sidebar />
      <main className={'main' + (s.ready && isMap ? ' stage' : '')}>
        {s.ready && <ScenarioBar />}
        {!s.ready ? (
          <div className="loading">
            <i className="spin" aria-hidden /> Loading the SPICE ephemeris and LOLA terrain…
          </div>
        ) : (
          <div className={isMap ? 'stagebody' : 'body'}>
            {s.tab === 'pole' && <PoleView />}
            {s.tab === 'map' && <MapView />}
            {s.tab === 'compare' && <Compare />}
            {s.tab === 'sky' && <Sky />}
            {s.tab === 'windows' && <Windows />}
            {s.tab === 'trust' && <Trust />}
            {s.tab === 'brief' && <Brief />}
          </div>
        )}
      </main>
      {s.drawer && (
        <div className="drawer-veil" onClick={() => s.set({ drawer: null })}>
          <aside
            className="drawer"
            role="dialog"
            aria-modal="true"
            onClick={(e) => e.stopPropagation()}
            aria-label={s.drawer === 'learn' ? 'Learn' : 'Mission profile'}
          >
            <button className="iconbtn close" aria-label="Close" onClick={() => s.set({ drawer: null })}>
              ×
            </button>
            {s.drawer === 'learn' ? <Lesson /> : <Profile />}
          </aside>
        </div>
      )}
      {palette && (
        <div className="palette-veil" onClick={() => setPalette(false)}>
          <div className="palette" onClick={(e) => e.stopPropagation()} role="dialog" aria-label="Find a site">
            <SitePicker autoFocus palette onDone={() => setPalette(false)} />
          </div>
        </div>
      )}
      {s.busy > 0 && (
        <div className="busy" role="status">
          <i className="spin" aria-hidden /> Computing
        </div>
      )}
      {s.notice && (
        <div className="notice" role="alert">
          <span>{s.notice}</span>
          <button className="iconbtn" aria-label="Dismiss" onClick={() => s.set({ notice: null })}>
            ×
          </button>
        </div>
      )}
    </div>
  );
}

/** Touchdown, stay, mast and the mission profile: everything that defines the scenario, in one row. */
function ScenarioBar() {
  const s = useStore();
  const lastArrival = Math.floor(s.ephEnd / DAY) * DAY - (MAX_STAY + 1) * DAY;
  const prof = PROFILES.find((p) => p.id === s.profile);
  return (
    <div className="scenario" role="group" aria-label="Scenario">
      <label className="sc">
        <span>Touchdown (UTC)</span>
        <span className="sc-row">
          <input
            type="date"
            value={fmtDate(s.arrival)}
            min={fmtDate(s.ephStart)}
            max={fmtDate(lastArrival)}
            onChange={(e) => {
              const ms = Date.parse(e.target.value);
              if (isFinite(ms))
                s.set({ arrival: ms + timeOfDay(s.arrival), cursor: ms + timeOfDay(s.arrival) + DAY / 2 });
            }}
          />
          <input
            type="time"
            step={60}
            value={new Date(s.arrival).toISOString().slice(11, 16)}
            onChange={(e) => {
              const [h, m] = e.target.value.split(':').map(Number);
              if (isFinite(h) && isFinite(m)) {
                const t = utcDay(s.arrival) + (h * 60 + m) * 60_000;
                s.set({ arrival: t, cursor: t + DAY / 2 });
              }
            }}
          />
        </span>
      </label>
      <label className="sc">
        <span>Surface stay</span>
        <span className="stepper">
          <button onClick={() => s.set({ duration: Math.max(1, s.duration - 1) })} aria-label="Shorter stay">
            −
          </button>
          <b>{s.duration} d</b>
          <button onClick={() => s.set({ duration: Math.min(MAX_STAY, s.duration + 1) })} aria-label="Longer stay">
            +
          </button>
        </span>
      </label>
      <label
        className="sc"
        title="Height of the solar array or antenna above the ground. Raising it lowers the horizon."
      >
        <span>Mast height</span>
        <span className="stepper">
          <button onClick={() => s.set({ z: Math.max(0, s.z - 1) })} aria-label="Lower mast">
            −
          </button>
          <b>{s.z} m</b>
          <button onClick={() => s.set({ z: Math.min(50, s.z + 1) })} aria-label="Raise mast">
            +
          </button>
        </span>
      </label>
      {(s.tab === 'pole' || s.tab === 'map') && (
        <span className="mapmode" role="group" aria-label="Map mode">
          <button
            aria-pressed={s.tab === 'pole'}
            onClick={() => s.set({ tab: 'pole' })}
            title="Light and shadow at one instant"
          >
            At a moment
          </button>
          <button
            aria-pressed={s.tab === 'map'}
            onClick={() => s.set({ tab: 'map' })}
            title="Totals over the whole stay, per 120 m cell"
          >
            Over the stay
          </button>
        </span>
      )}
      <button
        className="sc profile"
        onClick={() => s.set({ drawer: 'profile' })}
        title="Requirements and hardware used to grade every site"
      >
        <span>Mission profile</span>
        <b>
          {prof ? prof.name : 'Custom'} <Icon name="plus" size={12} />
        </b>
      </button>
    </div>
  );
}

/** Requirements, link masks and power hardware, with presets drawn from NASA documents where they exist. */
function Profile() {
  const s = useStore();
  const prof = PROFILES.find((p) => p.id === s.profile);
  const setReq = (r: Partial<typeof s.req>) => s.set({ req: { ...s.req, ...r }, profile: 'custom' });
  return (
    <div className="grid" style={{ gap: 18 }}>
      <div>
        <h2 className="dh">Mission profile</h2>
        <p className="muted small">Sites are graded GO, CHECK or NO-GO against these requirements.</p>
      </div>
      <div className="presets">
        {PROFILES.map((p) => (
          <button
            key={p.id}
            className={'preset' + (s.profile === p.id ? ' on' : '')}
            onClick={() => s.set({ profile: p.id, req: { ...p.req }, duration: p.duration, reqOn: true })}
          >
            <b>{p.name}</b>
            <small>{p.source}</small>
          </button>
        ))}
      </div>
      {!prof && <p className="small muted">Custom requirements (edited below).</p>}
      <div className="sect">Requirements</div>
      <div className="grid two">
        <Num
          label="Sunlit at least"
          unit="%"
          v={s.req.minSunPct}
          min={0}
          max={100}
          set={(n) => setReq({ minSunPct: n })}
        />
        <Num
          label="Darkness at most"
          unit="h"
          v={s.req.maxDarkH}
          min={0}
          max={700}
          set={(n) => setReq({ maxDarkH: n })}
        />
        <Num
          label="Earth link at least"
          unit="%"
          v={s.req.minDtePct}
          min={0}
          max={100}
          set={(n) => setReq({ minDtePct: n })}
        />
        <Num
          label="Link outage at most"
          unit="h"
          v={s.req.maxOutageH}
          min={0}
          max={700}
          set={(n) => setReq({ maxOutageH: n })}
        />
        <Num
          label="Power + link at least"
          unit="%"
          v={s.req.minBothPct}
          min={0}
          max={100}
          set={(n) => setReq({ minBothPct: n })}
        />
      </div>
      <label className="row small muted">
        <input type="checkbox" checked={s.reqOn} onChange={(e) => s.set({ reqOn: e.target.checked })} /> Dim dates that
        fail in the Compare matrix
      </label>
      <div className="sect">Communication</div>
      <div className="field">
        <label htmlFor="net">Ground network</label>
        <select
          id="net"
          value={s.network}
          onChange={(e) => {
            const n = e.target.value as Network;
            s.set({ network: n, stations: stationsFor(n, s.customStations) });
          }}
        >
          {NETWORKS.map((n) => (
            <option key={n.id} value={n.id}>
              {n.name}
            </option>
          ))}
        </select>
        <span className="faint small">{s.stations.map((x) => x.name).join(' · ')}</span>
      </div>
      {s.network === 'custom' && <CustomStations />}
      <div className="grid two">
        <Num
          label="Clearance above terrain"
          unit="°"
          v={s.landerMask}
          min={0}
          max={10}
          step={0.5}
          set={(n) => s.set({ landerMask: n ?? 2 })}
        />
        <Num
          label="Station minimum elevation"
          unit="°"
          v={s.stationMask}
          min={0}
          max={30}
          set={(n) => s.set({ stationMask: n ?? 10 })}
        />
      </div>
      <p className="faint small">
        A link needs a ground station at least this far above the lander's terrain horizon, and the lander at least this
        high in the station's sky. Commercial CLPS providers often use their own networks: choose Custom stations.
      </p>
      <div className="sect">Power</div>
      <div className="field">
        <label htmlFor="arraytype">Solar array</label>
        <select
          id="arraytype"
          value={s.hardware.array ?? 'vtrack'}
          onChange={(e) => s.set({ hardware: { ...s.hardware, array: e.target.value as ArrayType } })}
        >
          <option value="vtrack">Vertical, turns to the Sun (polar landers)</option>
          <option value="horizontal">Horizontal, fixed (low-latitude landers)</option>
          <option value="track2">Two-axis tracking</option>
        </select>
      </div>
      <div className="grid two">
        <Num
          label="Array rated power"
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
          set={(n) => s.set({ hardware: { ...s.hardware, batteryKwh: n ?? 0 } })}
        />
      </div>
      <Num
        label="Counts as sunlit when this much of the Sun's disc is visible"
        unit="fraction"
        v={s.litThreshold}
        min={0}
        max={0.95}
        step={0.05}
        set={(n) => s.set({ litThreshold: n ?? 0.1 })}
      />
      <p className="faint small">Hardware values are placeholders; set them to your lander's.</p>
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
  return (
    <aside className="side" aria-label="Sites">
      {s.ready && (
        <>
          <SitePicker />
          <div className="sect">
            Your sites <span className="faint">{s.sites.length}</span>
          </div>
          <div className="sitelist">
            {s.sites.map((x) => {
              const a = s.analyses[x.id],
                g = a ? grade(a.summary, s.req).grade : null;
              return (
                <div
                  key={x.id}
                  className={'siteitem' + (s.selected === x.id ? ' sel' : '')}
                  onClick={() => s.set({ selected: x.id })}
                >
                  <button
                    className={'iconbtn' + (s.pinned.includes(x.id) ? ' pinned' : '')}
                    title={s.pinned.includes(x.id) ? 'Shown in Compare' : 'Show in Compare'}
                    aria-label={`Compare ${x.label}`}
                    onClick={(e) => {
                      e.stopPropagation();
                      s.togglePin(x.id);
                    }}
                  >
                    {s.pinned.includes(x.id) ? '★' : '☆'}
                  </button>
                  <i className="chip" style={{ ['--hue' as string]: siteHue(x.id) }} />
                  <span className="name" title={x.label}>
                    {x.id.startsWith('Custom') ? (
                      <b>{x.label}</b>
                    ) : (
                      <>
                        <b>{x.id}</b> <span>{x.label.replace(/ · .*/, '')}</span>
                      </>
                    )}
                  </span>
                  {g && <span className={'gdot ' + g} title={GRADE_TEXT[g]} />}
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
              );
            })}
          </div>
          <p className="faint small">
            Search 100+ sites or type coordinates above ({navigator.platform.includes('Mac') ? '⌘' : 'Ctrl'}K). ★ adds a
            site to Compare; click the ground in Map to add any point.
          </p>
        </>
      )}
    </aside>
  );
}

/** Up to 8 user stations (name, geodetic lat, lon), e.g. a commercial network's antennas. */
function CustomStations() {
  const s = useStore();
  const [name, setName] = useState(''),
    [lat, setLat] = useState(''),
    [lon, setLon] = useState('');
  const apply = (cs: Station[]) => s.set({ customStations: cs, stations: stationsFor('custom', cs) });
  return (
    <div className="grid" style={{ gap: 6 }}>
      {s.customStations.map((x, i) => (
        <div key={x.id} className="row small" style={{ justifyContent: 'space-between' }}>
          <span>
            <b>{x.name}</b> {x.lat.toFixed(3)}°, {x.lon.toFixed(3)}°
          </span>
          <button
            className="iconbtn"
            aria-label={`Remove ${x.name}`}
            onClick={() => apply(s.customStations.filter((_, j) => j !== i))}
          >
            ×
          </button>
        </div>
      ))}
      {s.customStations.length < 8 && (
        <div className="row" style={{ gap: 6, flexWrap: 'nowrap' }}>
          <input className="mini" placeholder="Name" value={name} onChange={(e) => setName(e.target.value)} />
          <input className="mini" placeholder="Lat °" value={lat} onChange={(e) => setLat(e.target.value)} />
          <input className="mini" placeholder="Lon °E" value={lon} onChange={(e) => setLon(e.target.value)} />
          <button
            className="btn"
            disabled={!isFinite(parseFloat(lat)) || !isFinite(parseFloat(lon)) || Math.abs(parseFloat(lat)) > 90}
            onClick={() => {
              apply([
                ...s.customStations,
                {
                  id: `C-${s.customStations.length + 1}`,
                  name: name || `Station ${s.customStations.length + 1}`,
                  lat: +lat,
                  lon: +lon,
                  heightM: 0,
                },
              ]);
              setName('');
              setLat('');
              setLon('');
            }}
          >
            Add
          </button>
        </div>
      )}
      {!s.customStations.length && <span className="faint small">No stations yet: DSN is used until you add one.</span>}
    </div>
  );
}
