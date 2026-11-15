import { useEffect, useRef, useState } from 'react';
import { useStore, client, BASE, DAY } from '../store/useStore';
import { AreaEngine, Atlas } from '../gl/areaEngine';
import { Tip, fmtDate, fmtH, viridis, viridisCss } from './common';
import { fromStereo, latLonFromN, toStereo, siteFrame } from '../math/geo';
import type { AnalyzeResult } from '../math/client';

type Metric = 'sun' | 'link' | 'both' | 'dark';
const LABELS: Record<Metric, string> = {
  sun: 'Sunlit % of stay',
  link: 'Earth above horizon % (simple)',
  both: 'Sun + Earth together %',
  dark: 'Longest darkness',
};
const SCALE = 5,
  CELLS = 128;

export function MapView() {
  const s = useStore();
  const eng = useRef<AreaEngine | null>(null);
  const atlas = useRef<Atlas | null>(null);
  const canvas = useRef<HTMLCanvasElement>(null);
  // follow the selected site's region (catalogue membership first, then the region the engine used for it)
  const selRegion =
    s.regions.find((r) => !r.hidden && r.sites.some((x) => x.id === s.selected))?.id ??
    s.regions.find((r) => !r.hidden && r.id === s.analyses[s.selected]?.meta.region)?.id;
  const [region, setRegion] = useState<string>(selRegion ?? 'MMA');
  useEffect(() => {
    if (selRegion) setRegion(selRegion);
  }, [selRegion]);
  const [metric, setMetric] = useState<Metric>('sun');
  const [data, setData] = useState<Uint8Array | null>(null);
  const [msg, setMsg] = useState('Loading the horizon atlas…'),
    [ms, setMs] = useState<number | null>(null);
  const [pick, setPick] = useState<{
    col: number;
    row: number;
    lat: number;
    lon: number;
    gpu: number[];
    exact?: AnalyzeResult;
    h: number;
  } | null>(null);
  const [hover, setHover] = useState<{ x: number; y: number; t: string } | null>(null);
  const [rev, setRev] = useState(0);
  const reg = s.regions.find((r) => r.id === region);

  useEffect(() => {
    let dead = false;
    setMsg('Loading the horizon atlas…');
    setData(null);
    setPick(null);
    (async () => {
      try {
        if (!AreaEngine.supported()) {
          setMsg('This browser has no WebGL2, so the area map is unavailable. Site analysis still works.');
          return;
        }
        eng.current ??= new AreaEngine();
        const a = await eng.current.load(BASE, region);
        if (dead) return;
        atlas.current = a;
        setMsg('');
        setRev((r) => r + 1);
      } catch (e: any) {
        if (!dead) setMsg(`Atlas for this region is not available (${e.message ?? e}).`);
      }
    })();
    return () => {
      dead = true;
    };
  }, [region]);

  useEffect(() => {
    if (!atlas.current || !eng.current) return;
    let dead = false;
    (async () => {
      const stepMs = (s.duration <= 14 ? 30 : 60) * 60_000,
        n = Math.round((s.duration * DAY) / stepMs);
      const bodies = await client.bodies(s.arrival, n, stepMs);
      if (dead) return;
      const t = performance.now();
      const out = eng.current!.compute(bodies, s.z, s.litThreshold);
      setMs(performance.now() - t);
      setData(out);
    })();
    return () => {
      dead = true;
    };
  }, [rev, s.arrival, s.duration, s.z, s.litThreshold]);

  useEffect(() => {
    const c = canvas.current;
    if (!c || !data || !atlas.current) return;
    const H = atlas.current.heights,
      shade = new Float32Array(CELLS * CELLS);
    for (let r = 1; r < CELLS - 1; r++)
      for (let q = 1; q < CELLS - 1; q++) {
        const dzdx = ((H[r * CELLS + q + 1] - H[r * CELLS + q - 1]) * 0.5) / (2 * 120),
          dzdy = ((H[(r + 1) * CELLS + q] - H[(r - 1) * CELLS + q]) * 0.5) / (2 * 120);
        shade[r * CELLS + q] = Math.min(1, Math.max(0, 0.55 + 1.6 * (-dzdx * 0.7 + dzdy * 0.7))); // light from the upper-left
      }
    const img = new ImageData(CELLS, CELLS);
    for (let i = 0; i < CELLS * CELLS; i++) {
      const v =
        metric === 'sun'
          ? data[i * 4] / 255
          : metric === 'link'
            ? data[i * 4 + 1] / 255
            : metric === 'both'
              ? data[i * 4 + 2] / 255
              : 1 - data[i * 4 + 3] / 255;
      const [R, G, B] = viridis(v),
        k = 0.5 + 0.5 * shade[i];
      img.data[i * 4] = R * k;
      img.data[i * 4 + 1] = G * k;
      img.data[i * 4 + 2] = B * k;
      img.data[i * 4 + 3] = 255;
    }
    const off = document.createElement('canvas');
    off.width = off.height = CELLS;
    off.getContext('2d')!.putImageData(img, 0, 0);
    c.width = c.height = CELLS * SCALE;
    const ctx = c.getContext('2d')!;
    ctx.imageSmoothingEnabled = true;
    ctx.imageSmoothingQuality = 'high';
    ctx.drawImage(off, 0, 0, c.width, c.height);
    const m = atlas.current.meta;
    // catalogue sites, plus any site in the sidebar list that falls inside this region (selected one ringed)
    const pts = new Map<string, { lat: number; lon: number }>();
    for (const st of reg?.sites ?? []) pts.set(st.id, st);
    for (const st of s.sites) pts.set(st.id, st);
    for (const [id, st] of pts) {
      const [x, y] = toStereo(siteFrame(st.lat, st.lon).n),
        col = (x - m.cx) / m.res + (CELLS - 1) / 2 + 0.5,
        row = (m.cy - y) / m.res + (CELLS - 1) / 2 + 0.5;
      if (col < 0 || col > CELLS || row < 0 || row > CELLS) continue;
      const sel = id === s.selected;
      ctx.beginPath();
      ctx.arc(col * SCALE, row * SCALE, sel ? 5 : 3.5, 0, 7);
      ctx.fillStyle = sel ? '#8ab4ff' : '#fff';
      ctx.fill();
      ctx.strokeStyle = '#000';
      ctx.lineWidth = 1;
      ctx.stroke();
      if (sel) {
        ctx.beginPath();
        ctx.arc(col * SCALE, row * SCALE, 10, 0, 7);
        ctx.strokeStyle = '#8ab4ff';
        ctx.lineWidth = 2;
        ctx.stroke();
      }
    }
    // scale bar (5 km) and grid-north marker (image up = toward 0° longitude, the Earth-facing side)
    const px5 = (5000 / m.res) * SCALE,
      bx = 14,
      by = c.height - 18;
    ctx.fillStyle = 'rgba(5,7,13,.7)';
    ctx.beginPath();
    ctx.roundRect(bx - 8, by - 22, px5 + 16, 32, 6);
    ctx.fill();
    ctx.fillStyle = '#e6e9f0';
    ctx.fillRect(bx, by, px5, 3);
    ctx.fillRect(bx, by - 4, 2, 7);
    ctx.fillRect(bx + px5 - 2, by - 4, 2, 7);
    ctx.font = '12px system-ui';
    ctx.textAlign = 'center';
    ctx.fillText('5 km', bx + px5 / 2, by - 7);
    const nx = c.width - 30,
      ny = 18;
    ctx.fillStyle = 'rgba(5,7,13,.7)';
    ctx.beginPath();
    ctx.roundRect(nx - 22, ny - 10, 44, 44, 6);
    ctx.fill();
    ctx.fillStyle = '#e6e9f0';
    ctx.beginPath();
    ctx.moveTo(nx, ny - 4);
    ctx.lineTo(nx - 6, ny + 10);
    ctx.lineTo(nx + 6, ny + 10);
    ctx.closePath();
    ctx.fill();
    ctx.font = '11px system-ui';
    ctx.fillText('0° E', nx, ny + 26);
    if (pick) {
      ctx.strokeStyle = '#ffc83d';
      ctx.lineWidth = 2;
      ctx.strokeRect(pick.col * SCALE - 1, pick.row * SCALE - 1, SCALE + 2, SCALE + 2);
      ctx.beginPath();
      ctx.arc((pick.col + 0.5) * SCALE, (pick.row + 0.5) * SCALE, 9, 0, 7);
      ctx.stroke();
    }
  }, [data, metric, pick, reg, s.sites, s.selected]);

  const cellAt = (e: React.MouseEvent<HTMLCanvasElement>) => {
    const r = e.currentTarget.getBoundingClientRect(),
      col = Math.floor(((e.clientX - r.left) / r.width) * CELLS),
      row = Math.floor(((e.clientY - r.top) / r.height) * CELLS);
    return col >= 0 && col < CELLS && row >= 0 && row < CELLS ? { col, row } : null;
  };
  const gpuVals = (col: number, row: number) => {
    const i = (row * CELLS + col) * 4;
    return [data![i] / 2.55, data![i + 1] / 2.55, data![i + 2] / 2.55, (data![i + 3] / 255) * s.duration * 24];
  };
  const onClick = async (e: React.MouseEvent<HTMLCanvasElement>) => {
    const p = cellAt(e);
    if (!p || !data || !atlas.current) return;
    const m = atlas.current.meta,
      x = m.cx + (p.col - (CELLS - 1) / 2) * m.res,
      y = m.cy + ((CELLS - 1) / 2 - p.row) * m.res;
    const [lat, lon] = latLonFromN(fromStereo(x, y)),
      h = atlas.current.heights[p.row * CELLS + p.col] / 2;
    const entry = { ...p, lat, lon, gpu: gpuVals(p.col, p.row), h };
    setPick(entry);
    const ref = {
      id: `Custom ${lat.toFixed(3)} ${lon.toFixed(3)}`,
      label: `Custom ${lat.toFixed(3)}°, ${lon.toFixed(3)}°`,
      lat,
      lon,
    };
    const exact = await client.analyze(
      ref,
      { startMs: s.arrival, days: s.duration },
      { ...s.config(), z: Math.max(2, s.z), stepMin: 30 },
    );
    setPick((q) => (q && q.col === p.col && q.row === p.row ? { ...q, exact } : q));
  };
  const pickRef = () =>
    pick && {
      id: `Custom ${pick.lat.toFixed(3)} ${pick.lon.toFixed(3)}`,
      label: `Custom ${pick.lat.toFixed(3)}°, ${pick.lon.toFixed(3)}°`,
      lat: pick.lat,
      lon: pick.lon,
    };

  return (
    <div className="split">
      <div className="card">
        <h3>
          Where inside the region?
          <select
            aria-label="Region"
            value={region}
            onChange={(e) => setRegion(e.target.value)}
            style={{
              marginLeft: 'auto',
              background: 'var(--panel2)',
              border: '1px solid var(--line)',
              borderRadius: 6,
              padding: '3px 6px',
            }}
          >
            {s.regions
              .filter((r) => !r.hidden)
              .map((r) => (
                <option key={r.id} value={r.id}>
                  {r.name}
                </option>
              ))}
          </select>
        </h3>
        <div className="row small" style={{ marginBottom: 8 }}>
          {(Object.keys(LABELS) as Metric[]).map((k) => (
            <button key={k} className={'btn' + (metric === k ? ' primary' : '')} onClick={() => setMetric(k)}>
              {LABELS[k]}
            </button>
          ))}
          <span className="legend">
            <i style={{ background: viridisCss() }} />
            {metric === 'dark' ? 'long dark → none' : '0 → 100%'}
          </span>
        </div>
        {msg ? (
          <div className="muted" style={{ padding: 40 }}>
            {msg}
          </div>
        ) : (
          <div style={{ position: 'relative', maxWidth: CELLS * SCALE }}>
            <canvas
              ref={canvas}
              style={{ width: '100%', aspectRatio: '1', imageRendering: 'auto', cursor: 'crosshair', borderRadius: 6 }}
              role="img"
              aria-label={`${LABELS[metric]} across ${reg?.name}`}
              onClick={onClick}
              onMouseLeave={() => setHover(null)}
              onMouseMove={(e) => {
                const p = cellAt(e);
                if (!p || !data) return setHover(null);
                const g = gpuVals(p.col, p.row);
                setHover({
                  x: e.clientX,
                  y: e.clientY,
                  t: `Sunlit ${g[0].toFixed(0)}%\nEarth up ${g[1].toFixed(0)}%\nBoth ${g[2].toFixed(0)}%\nLongest dark ${fmtH(g[3])}`,
                });
              }}
            />
            {hover && (
              <Tip x={hover.x} y={hover.y}>
                {hover.t}
              </Tip>
            )}
          </div>
        )}
        <div className="faint small" style={{ marginTop: 8 }}>
          {fmtDate(s.arrival)} + {s.duration} days · mast {Math.max(2, s.z).toFixed(1)} m (map heights are 2–10 m,
          interpolated in tan θ) · 15.4 km at 120 m cells, polar stereographic, up = toward 0° longitude ·{' '}
          {ms != null ? `integrated on the GPU in ${ms.toFixed(0)} ms` : ''}. White dots are catalogue candidate sites.
          Map “Earth up” = Earth centre above horizon; eclipses and station passes are evaluated by the point engine.
        </div>
      </div>
      <div className="grid">
        <div className="card">
          <h3>Cell inspector</h3>
          {!pick ? (
            <div className="muted small">
              Click any cell. The point engine then re-computes it exactly (1440 azimuths, out to 300 km), so the
              numbers you act on never come from the quantised atlas.
            </div>
          ) : (
            <>
              <div className="small">
                {pick.lat.toFixed(4)}°, {pick.lon.toFixed(4)}° · {pick.h.toFixed(0)} m
              </div>
              <table style={{ marginTop: 6 }}>
                <thead>
                  <tr>
                    <th></th>
                    <th>Map (GPU)</th>
                    <th>Exact</th>
                  </tr>
                </thead>
                <tbody>
                  <tr>
                    <td>Sunlit</td>
                    <td>{pick.gpu[0].toFixed(0)}%</td>
                    <td>{pick.exact ? <b>{pick.exact.summary.sunPct.toFixed(0)}%</b> : '…'}</td>
                  </tr>
                  <tr>
                    <td>Longest dark</td>
                    <td>{fmtH(pick.gpu[3])}</td>
                    <td>{pick.exact ? <b>{fmtH(pick.exact.summary.longestDarkH)}</b> : '…'}</td>
                  </tr>
                  <tr>
                    <td>Earth centre up</td>
                    <td>{pick.gpu[1].toFixed(0)}%</td>
                    <td>{pick.exact ? <b>{pick.exact.summary.earthUpPct.toFixed(0)}%</b> : '…'}</td>
                  </tr>
                  <tr>
                    <td>Station link</td>
                    <td className="faint">n/a</td>
                    <td>{pick.exact ? <b>{pick.exact.summary.dtePct.toFixed(0)}%</b> : '…'}</td>
                  </tr>
                </tbody>
              </table>
              <div className="faint small" style={{ margin: '6px 0' }}>
                Small differences are expected: the map samples 1° azimuth bins, 8-bit horizons, 30–60 min steps and a
                straight-edge Sun disc.
              </div>
              <div className="row">
                <button
                  className="btn primary"
                  onClick={() => {
                    const r = pickRef();
                    if (r) {
                      s.addSite(r);
                      s.set({ tab: 'sky' });
                    }
                  }}
                >
                  Add site &amp; open sky
                </button>
                <button
                  className="btn"
                  onClick={() => {
                    const r = pickRef();
                    if (r) s.addSite(r);
                  }}
                >
                  Add to compare
                </button>
              </div>
            </>
          )}
        </div>
        <div className="card">
          <h3>Reading the map</h3>
          <div className="small muted">
            The shader loops every time step of your stay for every cell, looks up the Sun and Earth horizons baked in a
            3-D texture, and accumulates sunlight, link geometry and the longest dark gap. Change the arrival date or
            mast height and the whole region repaints.
          </div>
        </div>
      </div>
    </div>
  );
}
