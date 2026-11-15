import { useEffect, useMemo, useRef, useState } from 'react';
import { useStore, client, BASE, DAY } from '../store/useStore';
import {
  PoleRenderer,
  loadPoleGrids,
  localTilesAt,
  type HeightGrid,
  type Layer,
  type PoleView as View,
} from '../gl/poleRenderer';
import { Icon, Range, fmtDT, siteHue } from './common';
import { fmtSpan, useEvents } from './OpsClock';
import { DEG, R_M, fromStereo, latLonFromN, siteFrame, toStereo } from '../math/geo';

const STEP = 10 * 60_000;
const LAYERS: { id: Layer; label: string; sw: string; note: string }[] = [
  { id: 0, label: 'Sunlight', sw: 'linear-gradient(135deg,#fff3d6,#ffc94a)', note: 'cast shadows and penumbrae' },
  { id: 1, label: 'Earth in view', sw: 'linear-gradient(135deg,#9cc8ff,#2f7fff)', note: 'ground that can see Earth' },
  {
    id: 2,
    label: 'Sun + Earth',
    sw: 'linear-gradient(135deg,#ffc94a 45%,#6ee7a8 50%,#2f7fff 55%)',
    note: 'green = both',
  },
];

interface Bodies {
  t0: number;
  n: number;
  data: Float32Array;
}
/** Sun unit vector, Sun radius (rad), Earth unit vector, Earth radius (rad), Earth distance (km) at time t. */
function bodyAt(b: Bodies, t: number) {
  const u = Math.min(b.n - 1.0001, Math.max(0, (t - b.t0) / STEP)),
    i = Math.floor(u),
    f = u - i,
    d = b.data,
    v = (k: number) => d[i * 8 + k] * (1 - f) + d[(i + 1) * 8 + k] * f;
  const s = [v(0), v(1), v(2)],
    sl = Math.hypot(s[0], s[1], s[2]);
  const e = [v(4), v(5), v(6)],
    el = Math.hypot(e[0], e[1], e[2]);
  return {
    sun: s.map((x) => x / sl),
    sunR: v(3) * DEG,
    earth: e.map((x) => x / el),
    earthKm: e,
    earthR: v(7) * DEG,
  };
}
function sampleHeight(g: HeightGrid, x: number, y: number) {
  const c = (x - g.x0) / g.res,
    r = (g.y0 - y) / g.res,
    i = Math.floor(c),
    j = Math.floor(r);
  if (i < 0 || j < 0 || i >= g.n - 1 || j >= g.n - 1) return NaN;
  const fx = c - i,
    fy = r - j,
    k = j * g.n + i,
    d = g.data;
  const v =
    d[k] * (1 - fx) * (1 - fy) + d[k + 1] * fx * (1 - fy) + d[k + g.n] * (1 - fx) * fy + d[k + g.n + 1] * fx * fy;
  return v < -2e4 ? NaN : v;
}

export function PoleView() {
  const s = useStore();
  const wrap = useRef<HTMLDivElement>(null),
    glc = useRef<HTMLCanvasElement>(null),
    ovc = useRef<HTMLCanvasElement>(null);
  const rend = useRef<PoleRenderer | null>(null),
    grids = useRef<{ mid: HeightGrid; far: HeightGrid } | null>(null);
  const [ready, setReady] = useState(false),
    [progress, setProgress] = useState(0),
    [err, setErr] = useState('');
  const [layer, setLayer] = useState<Layer>(0),
    [labels, setLabels] = useState(true),
    [exposure, setExposure] = useState(3.5),
    [detail, setDetail] = useState<{ key: string; res: number } | null>(null);
  const [size, setSize] = useState({ w: 0, h: 0 });
  const [view, setView] = useState<View | null>(null);
  const [playing, setPlaying] = useState(false),
    [moving, setMoving] = useState(false);
  const [bodies, setBodies] = useState<Bodies | null>(null);
  const [pick, setPick] = useState<{ x: number; y: number; lat: number; lon: number; h: number } | null>(null);
  const T0 = s.arrival,
    TN = s.arrival + s.duration * DAY,
    t = Math.min(TN, Math.max(T0, s.cursor));

  // GPU + terrain. A lost WebGL context (GPU switch, sleep, too many tabs) is rebuilt on a fresh canvas.
  const [gen, setGen] = useState(0),
    retries = useRef(0);
  useEffect(() => {
    if (!PoleRenderer.supported()) {
      setErr('This browser has no WebGL2, so the live pole view is unavailable. Every other view still works.');
      return;
    }
    let dead = false;
    const canvas = glc.current!;
    const rebuild = () => {
      if (dead || retries.current >= 4) return;
      retries.current++;
      setReady(false);
      window.setTimeout(() => !dead && setGen((g) => g + 1), 350);
    };
    const onLost = (e: Event) => {
      e.preventDefault();
      rebuild();
    };
    canvas.addEventListener('webglcontextlost', onLost);
    try {
      rend.current = new PoleRenderer(canvas);
    } catch (e) {
      const gl = canvas.getContext('webgl2');
      if (gl?.isContextLost()) rebuild();
      else setErr(String((e as Error).message));
      return () => {
        dead = true;
        canvas.removeEventListener('webglcontextlost', onLost);
      };
    }
    loadPoleGrids(BASE, setProgress)
      .then((g) => {
        if (dead || !rend.current) return;
        grids.current = g;
        rend.current.upload(g.mid, g.far);
        retries.current = 0;
        setReady(true);
      })
      .catch((e) => !dead && setErr(`Terrain could not be loaded (${e.message}). Run npm run setup.`));
    return () => {
      dead = true;
      canvas.removeEventListener('webglcontextlost', onLost);
      rend.current?.dispose();
      rend.current = null;
    };
  }, [gen]);

  // size + initial framing of the nine Artemis III regions
  useEffect(() => {
    const el = wrap.current!;
    const fit = () => {
      const w = el.clientWidth,
        h = el.clientHeight;
      if (!w || !h) return;
      setSize({ w, h });
      setView((v) => v ?? { cx: -12000, cy: 46000, mpp: Math.max(400000 / w, 330000 / h) });
    };
    fit();
    const ro = new ResizeObserver(fit);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  // Sun / Earth for the whole stay, 10-minute steps, interpolated per frame
  useEffect(() => {
    let dead = false;
    client
      .bodies(T0, s.duration * 144 + 1, STEP)
      .then((d) => !dead && setBodies({ t0: T0, n: s.duration * 144 + 1, data: d }));
    return () => {
      dead = true;
    };
  }, [T0, s.duration]);
  useEffect(() => {
    if (s.cursor < T0 || s.cursor > TN) s.set({ cursor: T0 + DAY / 2 });
  }, [T0, TN]);

  // play
  useEffect(() => {
    if (!playing) return;
    let last = performance.now(),
      raf = 0;
    const tick = (now: number) => {
      const dt = Math.min(100, now - last);
      last = now;
      let c = useStore.getState().cursor + (dt / 1000) * ((TN - T0) / 24);
      if (c >= TN) c = T0;
      useStore.setState({ cursor: c });
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [playing, T0, TN]);

  const body = useMemo(() => (bodies ? bodyAt(bodies, t) : null), [bodies, t]);

  // render
  useEffect(() => {
    if (!ready || !view || !body || !size.w) return;
    const raf = requestAnimationFrame(() => {
      const r = rend.current,
        c = glc.current;
      if (!r || !c) return;
      const dpr = window.devicePixelRatio || 1,
        fast = playing || moving,
        full = Math.min(dpr, 2, Math.sqrt(4.5e6 / (size.w * size.h))), // full device resolution, capped at ~4.5 Mpx
        scale = fast ? Math.min(full, 1) * 0.6 : full;
      const W = Math.round(size.w * scale),
        H = Math.round(size.h * scale);
      if (c.width !== W || c.height !== H) {
        c.width = W;
        c.height = H;
      }
      r.render(view, scale, body.sun, body.sunR, body.earth, body.earthR, layer, fast ? 120 : 280, exposure);
    });
    if (import.meta.env.DEV)
      // dev-only probe for checking the shader against the point engine: render at 1:1, then read the pixel at CSS (x, y)
      (window as unknown as { poleProbe: (x: number, y: number, l?: number) => Uint8Array }).poleProbe = (x, y, l) => {
        const r = rend.current!,
          c = glc.current!;
        c.width = size.w;
        c.height = size.h;
        r.render(view, 1, body.sun, body.sunR, body.earth, body.earthR, (l ?? layer) as Layer, 280, exposure);
        return r.readPixel(x, size.h - y);
      };
    return () => cancelAnimationFrame(raf);
  }, [ready, view, size, body, layer, playing, moving, exposure, detail]);

  // stream the 20 m (or 40 m pole) tile under the view centre when zoomed in
  useEffect(() => {
    if (!ready || !view) return;
    const r = rend.current;
    if (!r) return;
    if (view.mpp > 160) {
      if (r.local) {
        r.setLocal(null);
        setDetail(null);
      }
      return;
    }
    let dead = false;
    const to = window.setTimeout(() => {
      localTilesAt(BASE, view.cx, view.cy)
        .then((t) => {
          if (dead || !rend.current) return;
          if (!t) {
            rend.current.setLocal(null);
            setDetail(null);
            return;
          }
          rend.current.setLocal(t.key, t.fine, t.mid);
          setDetail({ key: t.key, res: t.fine.res });
        })
        .catch(() => {});
    }, 120);
    return () => {
      dead = true;
      clearTimeout(to);
    };
  }, [ready, view, gen]);

  // overlay: graticule, region names, Sun/Earth beacons, scale bar
  useEffect(() => {
    const c = ovc.current;
    if (!c || !view || !size.w) return;
    const dpr = window.devicePixelRatio || 1;
    c.width = Math.round(size.w * dpr);
    c.height = Math.round(size.h * dpr);
    const ctx = c.getContext('2d')!;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, size.w, size.h);
    const W = size.w,
      H = size.h,
      sx = (x: number) => W / 2 + (x - view.cx) / view.mpp,
      sy = (y: number) => H / 2 - (y - view.cy) / view.mpp;
    // graticule, fading out as you zoom in so it never streaks across fine terrain
    ctx.globalAlpha = Math.min(1, Math.max(0.2, (view.mpp - 15) / 160));
    ctx.lineWidth = 1;
    ctx.font = '10.5px Inter, system-ui';
    ctx.textAlign = 'center';
    for (const lat of [-89, -88, -87, -86, -85, -84, -83, -82, -81, -80]) {
      const g = (90 + lat) * DEG,
        rho = 2 * R_M * Math.tan(g / 2);
      ctx.strokeStyle = lat % 2 === 0 ? 'rgba(160,185,240,.16)' : 'rgba(160,185,240,.08)';
      ctx.beginPath();
      ctx.arc(sx(0), sy(0), rho / view.mpp, 0, 7);
      ctx.stroke();
      if (labels && lat % 2 === 0) {
        ctx.fillStyle = 'rgba(190,205,240,.5)';
        ctx.fillText(`${-lat}°S`, sx(0), sy(-rho) - 4);
      }
    }
    for (let lon = 0; lon < 360; lon += 30) {
      const a = lon * DEG,
        rho = 2 * R_M * Math.tan((10 * DEG) / 2);
      ctx.strokeStyle = lon === 0 ? 'rgba(90,169,255,.28)' : 'rgba(160,185,240,.07)';
      ctx.beginPath();
      ctx.moveTo(sx(0), sy(0));
      ctx.lineTo(sx(rho * Math.sin(a)), sy(rho * Math.cos(a)));
      ctx.stroke();
      if (labels) {
        const r2 = 2 * R_M * Math.tan((5.5 * DEG) / 2),
          lx = sx(r2 * Math.sin(a)),
          ly = sy(r2 * Math.cos(a));
        if (lx > 20 && lx < W - 20 && ly > 20 && ly < H - 20) {
          ctx.fillStyle = lon === 0 ? 'rgba(120,180,255,.7)' : 'rgba(190,205,240,.42)';
          ctx.fillText(lon === 0 ? '0° · Earth side' : lon <= 180 ? `${lon}°E` : `${360 - lon}°W`, lx, ly);
        }
      }
    }
    ctx.globalAlpha = 1;
    // pole marker
    ctx.fillStyle = 'rgba(255,255,255,.75)';
    ctx.beginPath();
    ctx.arc(sx(0), sy(0), 2.5, 0, 7);
    ctx.fill();
    if (labels) {
      ctx.fillStyle = 'rgba(255,255,255,.65)';
      ctx.fillText('South Pole', sx(0), sy(0) + 16);
      ctx.font = '600 10.5px "Space Grotesk", Inter, system-ui';
      for (const r of s.regions.filter((q) => !q.hidden)) {
        const x = sx(r.cx),
          y = sy(r.cy) - 26;
        if (x < 0 || x > W || y < 0 || y > H || view.mpp > 1400) continue;
        ctx.fillStyle = 'rgba(225,232,248,.55)';
        ctx.fillText(r.name.replace(/ \(.*\)/, '').toUpperCase(), x, y);
      }
    }
    // beacons toward the Sun and the Earth at the edge of the view (direction of the sub-solar / sub-Earth meridian)
    if (body) {
      const beacon = (v: number[], col: string, glow: string, label: string) => {
        let dx = v[1],
          dy = -v[0];
        const L = Math.hypot(dx, dy) || 1;
        dx /= L;
        dy /= L;
        const m = 34,
          k = Math.min((W / 2 - m) / Math.abs(dx || 1e-9), (H / 2 - m) / Math.abs(dy || 1e-9));
        const x = W / 2 + dx * k,
          y = H / 2 + dy * k;
        const gr = ctx.createRadialGradient(x, y, 2, x, y, 30);
        gr.addColorStop(0, glow);
        gr.addColorStop(1, 'rgba(0,0,0,0)');
        ctx.fillStyle = gr;
        ctx.beginPath();
        ctx.arc(x, y, 30, 0, 7);
        ctx.fill();
        ctx.fillStyle = col;
        ctx.beginPath();
        ctx.arc(x, y, 7, 0, 7);
        ctx.fill();
        ctx.font = '600 11px Inter, system-ui';
        ctx.fillStyle = '#eef1f7';
        ctx.textAlign = dx > 0.3 ? 'right' : dx < -0.3 ? 'left' : 'center';
        const tx = x - dx * 16,
          ty = y - dy * 16 + (Math.abs(dy) > 0.7 ? (dy > 0 ? -4 : 12) : 4);
        ctx.fillText(label, tx, ty);
      };
      const sunEl = Math.asin(-body.sun[2]) / DEG,
        earthEl = Math.asin(-body.earth[2]) / DEG;
      beacon(body.earth, '#5aa9ff', 'rgba(90,169,255,.55)', `Earth ${earthEl >= 0 ? '+' : ''}${earthEl.toFixed(1)}°`);
      beacon(body.sun, '#ffd36a', 'rgba(255,200,80,.75)', `Sun ${sunEl >= 0 ? '+' : ''}${sunEl.toFixed(1)}°`);
    }
    // scale bar
    const nice = [1, 2, 5, 10, 20, 50, 100].find((k) => (k * 1000) / view.mpp > 70) ?? 100,
      px = (nice * 1000) / view.mpp,
      bx = 20,
      by = H - 92;
    ctx.fillStyle = 'rgba(238,241,247,.85)';
    ctx.fillRect(bx, by, px, 2);
    ctx.fillRect(bx, by - 4, 1.5, 6);
    ctx.fillRect(bx + px - 1.5, by - 4, 1.5, 6);
    ctx.font = '11px Inter, system-ui';
    ctx.textAlign = 'left';
    ctx.fillText(`${nice} km`, bx, by - 8);
  }, [view, size, body, labels, s.regions]);

  // wheel zoom about the cursor (non-passive listener so the page does not scroll)
  useEffect(() => {
    const c = glc.current;
    if (!c) return;
    let to = 0;
    const onWheel = (e: WheelEvent) => {
      e.preventDefault();
      const r = c.getBoundingClientRect(),
        px = e.clientX - r.left,
        py = e.clientY - r.top;
      setView((v) => {
        if (!v) return v;
        const mpp = Math.min(1600, Math.max(6, v.mpp * Math.exp(e.deltaY * 0.0016)));
        const x = v.cx + (px - r.width / 2) * v.mpp,
          y = v.cy - (py - r.height / 2) * v.mpp;
        return { mpp, cx: x - (px - r.width / 2) * mpp, cy: y + (py - r.height / 2) * mpp };
      });
      setMoving(true);
      clearTimeout(to);
      to = window.setTimeout(() => setMoving(false), 200);
    };
    c.addEventListener('wheel', onWheel, { passive: false });
    return () => c.removeEventListener('wheel', onWheel);
  }, [gen]);

  const drag = useRef<{ x: number; y: number; v: View; moved: boolean } | null>(null);
  const toWorld = (px: number, py: number) =>
    view ? [view.cx + (px - size.w / 2) * view.mpp, view.cy - (py - size.h / 2) * view.mpp] : [0, 0];
  const toScreen = (x: number, y: number) =>
    view ? [size.w / 2 + (x - view.cx) / view.mpp, size.h / 2 - (y - view.cy) / view.mpp] : [0, 0];
  const zoom = (f: number) => {
    setView((v) => v && { ...v, mpp: Math.min(1600, Math.max(6, v.mpp * f)) });
    setMoving(true);
    window.setTimeout(() => setMoving(false), 220);
  };

  const sel = s.sites.find((x) => x.id === s.selected),
    a = sel ? s.analyses[sel.id] : undefined;
  const ev = useEvents(sel, t);
  const idx = a ? Math.min(a.series.n - 1, Math.max(0, Math.round((t - a.series.t0) / a.series.stepMs))) : -1;
  const linkNow =
    a && idx >= 0 ? s.stations.filter((_, k) => (a.series.mask[idx] >> k) & 1).map((x) => x.name) : ([] as string[]);
  // Earth's phase seen from the Moon: angle at Earth between the Sun and the Moon
  const earthLit = useMemo(() => {
    if (!body) return null;
    const E = body.earthKm,
      dS = 695700 / Math.sin(body.sunR),
      S = body.sun.map((x) => x * dS),
      es = [S[0] - E[0], S[1] - E[1], S[2] - E[2]],
      em = [-E[0], -E[1], -E[2]];
    const c =
      (es[0] * em[0] + es[1] * em[1] + es[2] * em[2]) /
      (Math.hypot(es[0], es[1], es[2]) * Math.hypot(em[0], em[1], em[2]));
    return (1 + c) / 2;
  }, [body]);

  return (
    <div className="stagewrap" ref={wrap}>
      <canvas
        key={gen}
        className="gl"
        ref={glc}
        tabIndex={0}
        aria-label="Live map of the lunar south pole with ray-traced shadows. Drag to pan, scroll to zoom, click a point to analyse it."
        onPointerDown={(e) => {
          if (!view) return;
          e.currentTarget.setPointerCapture(e.pointerId);
          drag.current = { x: e.clientX, y: e.clientY, v: view, moved: false };
        }}
        onPointerMove={(e) => {
          const d = drag.current;
          if (!d) return;
          const dx = e.clientX - d.x,
            dy = e.clientY - d.y;
          if (!d.moved && Math.hypot(dx, dy) < 4) return;
          d.moved = true;
          setMoving(true);
          setPick(null);
          setView({ ...d.v, cx: d.v.cx - dx * d.v.mpp, cy: d.v.cy + dy * d.v.mpp });
        }}
        onPointerUp={(e) => {
          const d = drag.current;
          drag.current = null;
          setMoving(false);
          if (!d || d.moved || !grids.current) return;
          const r = e.currentTarget.getBoundingClientRect(),
            px = e.clientX - r.left,
            py = e.clientY - r.top,
            [x, y] = toWorld(px, py);
          const [lat, lon] = latLonFromN(fromStereo(x, y));
          if (lat > -80) return setPick(null);
          setPick({ x, y, lat, lon, h: sampleHeight(grids.current.mid, x, y) });
        }}
        onKeyDown={(e) => {
          if (e.key === ' ') {
            e.preventDefault();
            setPlaying((p) => !p);
          } else if (e.key === 'ArrowRight' || e.key === 'ArrowLeft') {
            e.preventDefault();
            const step = (e.shiftKey ? 24 : 1) * 3.6e6;
            s.set({ cursor: Math.min(TN, Math.max(T0, t + (e.key === 'ArrowRight' ? step : -step))) });
          } else if (e.key === '+' || e.key === '=') zoom(0.8);
          else if (e.key === '-') zoom(1.25);
        }}
      />
      <canvas className="ov" ref={ovc} />

      {view &&
        (() => {
          // place labels by priority (selected, then pinned, then the rest) and drop any that would overlap
          const placed: [number, number, number, number][] = [];
          const items = s.sites
            .map((x) => {
              const [X, Y] = toStereo(siteFrame(x.lat, x.lon).n),
                [px, py] = toScreen(X, Y);
              const rank = x.id === s.selected ? 0 : s.pinned.includes(x.id) ? 1 : 2;
              return { x, px, py, rank };
            })
            .filter((m) => m.px > -40 && m.py > -40 && m.px < size.w + 40 && m.py < size.h + 40)
            .sort((a, b) => a.rank - b.rank);
          return items.map(({ x, px, py, rank }) => {
            const an = s.analyses[x.id],
              text =
                (x.id.startsWith('Custom') ? 'Custom' : x.id) + (an ? ` ${an.summary.sunPct.toFixed(0)}% sun` : ''),
              box: [number, number, number, number] = [px + 10, py - 12, px + 26 + text.length * 6.6, py + 12];
            const free = !placed.some((b) => box[0] < b[2] && box[2] > b[0] && box[1] < b[3] && box[3] > b[1]);
            const show = (labels || rank === 0) && (free || rank === 0);
            if (show) placed.push(box);
            return (
              <div
                key={x.id}
                className={'marker' + (x.id === s.selected ? ' sel' : '')}
                style={{ left: px, top: py, ['--hue' as string]: siteHue(x.id) }}
                onClick={() => s.set({ selected: x.id })}
                onDoubleClick={() => s.set({ selected: x.id, tab: 'sky' })}
                title={`${x.label}: click to select, double-click to open its sky`}
              >
                <i className="dot" />
                {show && (
                  <span className="lab">
                    {x.id.startsWith('Custom') ? 'Custom' : x.id}
                    {an && <small>{an.summary.sunPct.toFixed(0)}% sun</small>}
                  </span>
                )}
              </div>
            );
          });
        })()}

      {pick &&
        view &&
        (() => {
          const [px, py] = toScreen(pick.x, pick.y);
          const ref = {
            id: `Custom ${pick.lat.toFixed(3)} ${pick.lon.toFixed(3)}`,
            label: `Custom ${pick.lat.toFixed(3)}°, ${pick.lon.toFixed(3)}°`,
            lat: pick.lat,
            lon: pick.lon,
          };
          return (
            <div className="popover hud" style={{ left: px, top: py }}>
              <div className="eyebrow" style={{ color: 'var(--accent)' }}>
                Point
              </div>
              <div style={{ fontFamily: 'var(--display)', fontSize: 16, fontWeight: 600 }}>
                {pick.lat.toFixed(3)}°, {pick.lon.toFixed(3)}°
              </div>
              <div className="small muted">
                {Number.isFinite(pick.h) ? `${pick.h.toFixed(0)} m above the 1737.4 km sphere` : 'no terrain data'}
              </div>
              <div className="row" style={{ marginTop: 10 }}>
                <button
                  className="btn primary"
                  onClick={() => {
                    s.addSite(ref);
                    s.set({ tab: 'sky' });
                  }}
                >
                  Analyse here
                </button>
                <button
                  className="btn"
                  onClick={() => {
                    s.addSite(ref);
                    setPick(null);
                  }}
                >
                  Add to list
                </button>
                <button className="iconbtn" aria-label="Close" onClick={() => setPick(null)}>
                  ×
                </button>
              </div>
            </div>
          );
        })()}

      <div className="hud tl">
        <div className="eyebrow">Live · Lunar south pole</div>
        <h2>{fmtDT(t).replace(' UTC', '')} UTC</h2>
        <div className="readout">
          <span>Sun at the pole</span>
          <b>{body ? `${(Math.asin(-body.sun[2]) / DEG).toFixed(2)}° · toward ${lonOf(body.sun)}` : '…'}</b>
          <span>Earth at the pole</span>
          <b>
            {body
              ? `${(Math.asin(-body.earth[2]) / DEG).toFixed(2)}° · ${earthLit != null ? Math.round(earthLit * 100) : '–'}% lit`
              : '…'}
          </b>
          {sel && (
            <>
              <span style={{ color: siteHue(sel.id) }}>● {sel.id.startsWith('Custom') ? 'Custom point' : sel.id}</span>
              <b>
                {a && idx >= 0
                  ? `${a.series.fSun[idx] > 0.5 ? 'In sunlight' : a.series.fSun[idx] > 0.02 ? 'Sun partly hidden' : 'In shadow'} · ${
                      linkNow.length ? 'link via ' + linkNow.join(', ') : 'no link'
                    }`
                  : 'computing…'}
              </b>
              {ev && (
                <>
                  <span>{ev.sun.up ? 'Sunset in' : 'Sunrise in'}</span>
                  <b style={{ color: ev.sun.up ? 'var(--sun)' : undefined }}>
                    {ev.sun.next != null ? fmtSpan(ev.sun.next - t) : ev.sun.up ? '40+ days' : 'not within 45 days'}
                  </b>
                  <span>{ev.earth.up ? 'Earthset in' : 'Earthrise in'}</span>
                  <b style={{ color: ev.earth.up ? 'var(--earth)' : undefined }}>
                    {ev.earth.next != null
                      ? fmtSpan(ev.earth.next - t)
                      : ev.earth.up
                        ? '40+ days'
                        : 'not within 45 days'}
                  </b>
                </>
              )}
            </>
          )}
        </div>
        {sel && sel.lat > -78 && (
          <div className="small" style={{ marginTop: 8, color: 'var(--warn)' }}>
            {sel.id} is outside this south-polar map; its countdowns above still apply. Open its sky for the full view.
          </div>
        )}
        <div className="small faint" style={{ marginTop: 10, lineHeight: 1.5 }}>
          Every pixel traces a ray through LOLA terrain to the SPICE Sun and Earth, on the curved Moon. Drag to pan,
          scroll to zoom, click the ground to analyse a point.
        </div>
        {sel && (
          <div className="row" style={{ marginTop: 10 }}>
            <button className="btn primary" onClick={() => s.set({ tab: 'sky' })}>
              <Icon name="sky" size={15} /> Open {sel.id.startsWith('Custom') ? 'its' : sel.id} sky
            </button>
            <button className="btn" onClick={() => s.set({ tab: 'compare' })}>
              <Icon name="compare" size={15} /> Compare
            </button>
          </div>
        )}
      </div>

      <div className="hud tr">
        <div className="eyebrow" style={{ color: 'var(--muted)', marginBottom: 6 }}>
          Layer
        </div>
        <div className="layers">
          {LAYERS.map((l) => (
            <button key={l.id} aria-pressed={layer === l.id} onClick={() => setLayer(l.id)} title={l.note}>
              <i className="sw" style={{ background: l.sw }} />
              {l.label}
            </button>
          ))}
        </div>
        <div className="zoomers">
          <button className="btn" aria-label="Zoom in" onClick={() => zoom(0.75)}>
            <Icon name="plus" size={14} />
          </button>
          <button className="btn" aria-label="Zoom out" onClick={() => zoom(1.33)}>
            <Icon name="minus" size={14} />
          </button>
          <button
            className="btn"
            aria-label="Reset view"
            onClick={() =>
              size.w && setView({ cx: -12000, cy: 46000, mpp: Math.max(400000 / size.w, 330000 / size.h) })
            }
          >
            <Icon name="reset" size={14} />
          </button>
          <button
            className="btn"
            aria-label="Centre on the selected site"
            disabled={!sel}
            onClick={() => {
              if (!sel) return;
              const [X, Y] = toStereo(siteFrame(sel.lat, sel.lon).n);
              setView((v) => v && { cx: X, cy: Y, mpp: Math.min(v.mpp, 30) });
            }}
          >
            <Icon name="target" size={14} />
          </button>
        </div>
        <div className="field" style={{ marginTop: 10 }}>
          <label className="small">
            Exposure<span>{exposure.toFixed(2)}</span>
          </label>
          <Range
            min={1}
            max={10}
            step={0.25}
            value={exposure}
            onChange={setExposure}
            aria-label="Exposure"
            className="sun"
          />
        </div>
        <label className="row small muted" style={{ marginTop: 6, gap: 6 }}>
          <input type="checkbox" checked={labels} onChange={(e) => setLabels(e.target.checked)} /> Labels &amp; grid
        </label>
        <div className="small faint" style={{ marginTop: 6 }}>
          Terrain{' '}
          {detail
            ? `${detail.res} m · ${s.regions.find((r) => r.id === detail.key)?.name.replace(/ \(.*\)/, '') ?? detail.key}`
            : view && view.mpp <= 160
              ? '240 m'
              : '240 / 480 m'}
          {view && view.mpp > 160 ? ' · zoom in for 20 m' : ''}
        </div>
      </div>

      <div className="hud bl">
        <button
          className="playbtn"
          aria-label={playing ? 'Pause' : 'Play the stay'}
          onClick={() => setPlaying((p) => !p)}
        >
          <Icon name={playing ? 'pause' : 'play'} size={18} fill />
        </button>
        <div className="scrub">
          <div className="when">
            <span>{fmtDT(T0).slice(5, 16)}</span>
            <b>{fmtDT(t)}</b>
            <span>{fmtDT(TN).slice(5, 16)}</span>
          </div>
          <Range
            className="sun"
            min={T0}
            max={TN}
            step={STEP}
            value={t}
            aria-label="Time within the stay"
            onChange={(v) => {
              setPlaying(false);
              s.set({ cursor: v });
            }}
          />
        </div>
      </div>

      {(!ready || err) && (
        <div className="loadveil">
          <div style={{ textAlign: 'center', maxWidth: 420, padding: 20 }}>
            {err ? (
              <span className="muted">{err}</span>
            ) : (
              <>
                <div className="eyebrow">Loading terrain</div>
                <div style={{ marginTop: 6 }}>LOLA 240 m and 480 m polar grids</div>
                <div className="bar" style={{ margin: '12px auto 0' }}>
                  <i style={{ width: `${Math.max(8, progress * 100)}%` }} />
                </div>
              </>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

/** Longitude of the sub-body point, as the direction a viewer at the pole looks. */
function lonOf(v: number[]) {
  const lon = Math.atan2(v[1], v[0]) / DEG;
  return Math.abs(lon) < 0.5 ? '0°' : lon > 0 ? `${lon.toFixed(0)}°E` : `${(-lon).toFixed(0)}°W`;
}
