import { useEffect, useMemo, useRef, useState } from 'react';
import { useStore, client, DAY, analysisKey } from '../store/useStore';
import { Range, cssVar, qualityLabel, siteHue, csv, download, fmtDT, fmtH, isoMin, slug, useCanvas } from './common';
import { grade, verdict } from '../math/analysis';
import type { Mast } from '../math/client';
import { OpsClock, useEvents } from './OpsClock';
import { HELP } from './Compare';
import { SlipPanel } from './SlipPanel';
import { ZonePanel } from './ZonePanel';
import { Plans } from './Plans';

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
const DEG = Math.PI / 180;
// a fixed, seeded star field: [azimuth deg, elevation deg, brightness]
const STARS: [number, number, number][] = (() => {
  let seed = 7;
  const rnd = () => ((seed = (seed * 16807) % 2147483647) - 1) / 2147483646;
  return Array.from({ length: 1800 }, () => [rnd() * 360, -4 + rnd() * 50, 0.15 + Math.pow(rnd(), 3) * 0.8]);
})();

export function Sky() {
  const s = useStore();
  const a = s.analyses[s.selected],
    site = s.sites.find((x) => x.id === s.selected);
  const [fov, setFov] = useState(50),
    [follow, setFollow] = useState<'sun' | 'earth' | number>('sun'),
    [playing, setPlaying] = useState(false);
  const [more, setMore] = useState<'numbers' | 'plans' | 'slip' | 'zone' | 'mast' | 'passes' | 'years' | 'export'>(
    'numbers',
  );
  const [mastBusy, setMastBusy] = useState(false),
    [ltBusy, setLtBusy] = useState(false);
  const [mast, setMast] = useState<Mast | null>(null),
    [lt, setLt] = useState<{ year: number; sun: number; dte: number }[] | null>(null);
  const raf = useRef(0);
  const ev = useEvents(site, s.cursor);
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

  const PH = 280;
  // vertical framing: keep the window's whole Sun and Earth tracks and the horizon in view, steady while playing
  const track = useMemo(() => {
    if (!a) return [-2, 8];
    let lo = Infinity,
      hi = -Infinity;
    for (let i = 0; i < a.series.n; i++) {
      lo = Math.min(lo, a.series.sunEl[i], a.series.earthEl[i]);
      hi = Math.max(hi, a.series.sunEl[i], a.series.earthEl[i]);
    }
    return [lo - 1.2, hi + 1.2];
  }, [a]);
  const pano = useCanvas(
    (ctx, W, H) => {
      if (!a) return;
      const S = a.series,
        centre = follow === 'sun' ? S.sunAz[idx] : follow === 'earth' ? S.earthAz[idx] : follow,
        ppd = W / fov;
      let hLo = Infinity,
        hHi = -Infinity;
      for (let x = 0; x <= W; x += 8) {
        const h = hAt(centre + (x - W / 2) / ppd);
        hLo = Math.min(hLo, h);
        hHi = Math.max(hHi, h);
      }
      const span = (H - 28) / ppd,
        lo = Math.min(track[0], hLo - 0.8),
        hi = Math.max(track[1], hHi + 0.8);
      // fits: frame everything; too tall (low latitudes, Sun high): follow the body being looked at, else the ground
      const focus = Math.max(
        hLo + span * 0.3,
        follow === 'sun' ? S.sunEl[idx] : follow === 'earth' ? S.earthEl[idx] : hHi,
      );
      const e0 =
          hi - lo <= span
            ? lo - (span - (hi - lo)) * 0.3
            : Math.max(lo, Math.min(hi - span, focus - span * (typeof follow === 'number' ? 0.25 : 0.5))),
        yOf = (el: number) => H - 28 - (el - e0) * ppd,
        xOf = (az: number) => W / 2 + wrapD(az - centre) * ppd;
      // sky
      const g = ctx.createLinearGradient(0, 0, 0, H);
      g.addColorStop(0, '#010208');
      g.addColorStop(0.7, '#050914');
      g.addColorStop(1, '#0c1428');
      ctx.fillStyle = g;
      ctx.fillRect(0, 0, W, H);
      // stars, fixed in azimuth and elevation (decorative)
      for (const st of STARS) {
        const x = xOf(st[0]),
          y = yOf(st[1]);
        if (x < 0 || x > W || y < 0 || y > H) continue;
        ctx.fillStyle = `rgba(222,232,255,${st[2]})`;
        ctx.fillRect(x, y, st[2] > 0.75 ? 1.7 : 1.1, st[2] > 0.75 ? 1.7 : 1.1);
      }
      ctx.font = '11px Inter, system-ui';
      ctx.fillStyle = '#6f7a96';
      ctx.strokeStyle = 'rgba(150,172,225,.07)';
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
        ctx.fillText(COMPASS[az] ? `${COMPASS[az]} ${az}°` : `${az}°`, x, H - 10);
      }
      ctx.textAlign = 'left';
      for (let el = Math.ceil(e0); el < e0 + H / ppd; el += el < 10 ? 2 : 5) {
        const y = yOf(el);
        ctx.beginPath();
        ctx.moveTo(0, y);
        ctx.lineTo(W, y);
        ctx.stroke();
        ctx.fillText(`${el}°`, 6, y - 3);
      }
      // the stay's tracks
      for (const [az, el, col] of [
        [S.sunAz, S.sunEl, 'rgba(255,201,74,.5)'],
        [S.earthAz, S.earthEl, 'rgba(90,169,255,.5)'],
      ] as const) {
        ctx.fillStyle = col;
        for (let i = 0; i < S.n; i += 4) {
          const x = xOf(az[i]);
          if (x > -4 && x < W + 4) ctx.fillRect(x - 0.8, yOf(el[i]) - 0.8, 1.6, 1.6);
        }
      }
      // Earth at its true size and phase (lit limb toward the Sun)
      {
        const x = xOf(S.earthAz[idx]),
          y = yOf(S.earthEl[idx]),
          r = Math.max(3, S.earthR[idx] * ppd);
        const ps = Math.cos(S.sunEl[idx] * DEG) * Math.cos(S.earthEl[idx] * DEG),
          cpsi =
            Math.sin(S.sunEl[idx] * DEG) * Math.sin(S.earthEl[idx] * DEG) +
            ps * Math.cos((S.sunAz[idx] - S.earthAz[idx]) * DEG); // cos(Sun-Earth separation)
        const cosA = -cpsi; // phase angle at Earth ~ 180° - separation (the Sun is 390x farther)
        const th = Math.atan2(yOf(S.sunEl[idx]) - y, wrapD(S.sunAz[idx] - S.earthAz[idx]) * ppd);
        const halo = ctx.createRadialGradient(x, y, r, x, y, r * 2.6);
        halo.addColorStop(0, 'rgba(90,169,255,.28)');
        halo.addColorStop(1, 'rgba(90,169,255,0)');
        ctx.fillStyle = halo;
        ctx.beginPath();
        ctx.arc(x, y, r * 2.6, 0, 7);
        ctx.fill();
        ctx.save();
        ctx.translate(x, y);
        ctx.rotate(th);
        ctx.fillStyle = '#0b1830';
        ctx.beginPath();
        ctx.arc(0, 0, r, 0, 7);
        ctx.fill();
        const lit = ctx.createLinearGradient(-r, 0, r, 0);
        lit.addColorStop(0, '#4f8fe0');
        lit.addColorStop(1, '#d9ecff');
        ctx.fillStyle = lit;
        ctx.beginPath();
        ctx.arc(0, 0, r, -Math.PI / 2, Math.PI / 2);
        ctx.fill();
        ctx.fillStyle = cosA > 0 ? lit : '#0b1830';
        ctx.beginPath();
        ctx.ellipse(0, 0, r * Math.abs(cosA), r, 0, 0, 7);
        ctx.fill();
        ctx.restore();
      }
      // the Sun with a corona scaled by how much of the disc is visible
      {
        const x = xOf(S.sunAz[idx]),
          y = yOf(S.sunEl[idx]),
          r = Math.max(3, S.sunR[idx] * ppd),
          f = S.fSun[idx];
        const cor = ctx.createRadialGradient(x, y, r * 0.8, x, y, r * 9);
        cor.addColorStop(0, `rgba(255,214,120,${0.25 + 0.5 * f})`);
        cor.addColorStop(0.35, `rgba(255,170,60,${0.08 + 0.18 * f})`);
        cor.addColorStop(1, 'rgba(255,150,40,0)');
        ctx.fillStyle = cor;
        ctx.beginPath();
        ctx.arc(x, y, r * 9, 0, 7);
        ctx.fill();
        const core = ctx.createRadialGradient(x - r * 0.25, y - r * 0.25, 0, x, y, r);
        core.addColorStop(0, '#fffbe8');
        core.addColorStop(1, '#ffd36a');
        ctx.fillStyle = core;
        ctx.beginPath();
        ctx.arc(x, y, r, 0, 7);
        ctx.fill();
      }
      // terrain silhouette, its ridge catching warm light toward the Sun when the Sun is up
      ctx.beginPath();
      ctx.moveTo(0, H);
      for (let x = 0; x <= W; x += 2) ctx.lineTo(x, yOf(hAt(centre + (x - W / 2) / ppd)));
      ctx.lineTo(W, H);
      ctx.closePath();
      const tg = ctx.createLinearGradient(0, H * 0.35, 0, H);
      tg.addColorStop(0, '#2b303d');
      tg.addColorStop(0.5, '#141823');
      tg.addColorStop(1, '#06080d');
      ctx.fillStyle = tg;
      ctx.fill();
      const ridge = () => {
        ctx.beginPath();
        for (let x = 0; x <= W; x += 2) {
          const y = yOf(hAt(centre + (x - W / 2) / ppd));
          x ? ctx.lineTo(x, y) : ctx.moveTo(x, y);
        }
        ctx.stroke();
      };
      ctx.strokeStyle = 'rgba(176,186,208,.75)';
      ctx.lineWidth = 1.2;
      ridge();
      if (S.sunEl[idx] > -2) {
        const xs = xOf(S.sunAz[idx]),
          rg = ctx.createLinearGradient(xs - 260, 0, xs + 260, 0);
        rg.addColorStop(0, 'rgba(255,200,110,0)');
        rg.addColorStop(0.5, `rgba(255,205,120,${0.25 + 0.6 * S.fSun[idx]})`);
        rg.addColorStop(1, 'rgba(255,200,110,0)');
        ctx.strokeStyle = rg;
        ctx.lineWidth = 2.2;
        ridge();
      }
      const cap = `Looking toward ${centre.toFixed(0)}° · horizon at ${s.z} m mast · ${fov}° field`;
      ctx.font = '12px Inter, system-ui';
      const cw = ctx.measureText(cap).width;
      ctx.fillStyle = 'rgba(5,7,13,.72)';
      ctx.beginPath();
      ctx.roundRect(6, 6, cw + 14, 20, 6);
      ctx.fill();
      ctx.fillStyle = '#e6e9f0';
      ctx.textAlign = 'left';
      ctx.fillText(cap, 13, 20);
    },
    [a, idx, fov, follow, s.z, track],
    PH,
  );

  const ovRef = useCanvas(
    (ctx, W, H) => {
      if (!a) return;
      const S = a.series;
      ctx.fillStyle = 'rgba(4,7,14,.9)';
      ctx.fillRect(0, 0, W, H);
      const lo = Math.min(-6, track[0]),
        hi = Math.min(90, Math.max(8, Math.max(...a.horizon) + 2, track[1])),
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
      ctx.fillStyle = cssVar('--faint');
      ctx.font = '10px system-ui';
      for (const d of [0, 90, 180, 270]) ctx.fillText(COMPASS[d], (d / 360) * W + 3, 10);
    },
    [a, idx, s.z, track],
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
        ctx.fillStyle = cssVar('--muted');
        ctx.fillText(l, 4, 26 + r * RH + RH / 2);
      });
      for (let x = 0; x < w; x++) {
        const i = Math.min(n - 1, Math.floor((x / w) * n)),
          f = S.fSun[i],
          m = S.mask[i];
        ctx.fillStyle = `rgba(255,200,61,${0.07 + 0.93 * f})`;
        ctx.fillRect(LAB + x, 26 + 2, 1, RH - 4);
        ctx.fillStyle = m ? cssVar('--earth') : cssVar('--line');
        ctx.fillRect(LAB + x, 26 + RH + 2, 1, RH - 4);
        ctx.fillStyle = m && f > s.litThreshold ? cssVar('--both') : cssVar('--line');
        ctx.fillRect(LAB + x, 26 + 2 * RH + 2, 1, RH - 4);
        for (let k = 0; k < s.stations.length; k++) {
          ctx.fillStyle = (m >> k) & 1 ? cssVar('--earth') : cssVar('--line');
          ctx.fillRect(LAB + x, 26 + (3 + k) * RH + 5, 1, RH - 10);
        }
      }
      ctx.strokeStyle = cssVar('--text');
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
      ctx.fillStyle = cssVar('--faint');
      ctx.textAlign = 'center';
      ctx.textBaseline = 'alphabetic';
      const days = Math.max(1, Math.round(s.duration));
      for (let d = 0; d <= days; d += Math.max(1, Math.round(days / 8)))
        ctx.fillText(new Date(T0 + d * DAY).toISOString().slice(5, 10), LAB + ((d * DAY) / (TN - T0)) * w, 14);
      const cx = LAB + ((s.cursor - T0) / (TN - T0)) * w;
      ctx.strokeStyle = cssVar('--text');
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
    band = s.bandKeys[s.selected] === analysisKey(s, site) ? s.bands[s.selected] : undefined,
    stale = s.analysisKeys[s.selected] !== analysisKey(s, site);
  const t = s.cursor,
    litNow = S.fSun[idx],
    maskNow = S.mask[idx];
  const stationsUp = s.stations.filter((_, k) => (maskNow >> k) & 1).map((x) => x.name);
  const explorer = s.mode === 'explorer';
  const fail = (e: unknown) => s.set({ notice: String((e as Error)?.message ?? e) });
  const findMast = () => {
    setMastBusy(true);
    client
      .minMast(site, { startMs: s.arrival, days: s.duration }, s.config(), s.req)
      .then(setMast, fail)
      .finally(() => setMastBusy(false));
  };
  const loadLt = () => {
    setLtBusy(true);
    client
      .longTerm(site, s.config())
      .then(setLt, fail)
      .finally(() => setLtBusy(false));
  };
  const prov = () => {
    const c = s.config(),
      hw = c.hardware;
    return {
      tool: 'HELIOS-LUNA lunar landing site navigator',
      site: site.label,
      lat_deg: site.lat.toFixed(5),
      lon_deg: site.lon.toFixed(5),
      ground_height_m: a.meta.groundH.toFixed(1) + ' (above 1737.4 km sphere)',
      terrain: `${a.meta.quality} (${a.meta.region ?? 'global'} tiles); LOLA polar stereographic DEMs`,
      mast_m: c.z,
      window_start_utc: isoMin(s.arrival),
      stay_days: s.duration,
      step_min: c.stepMin,
      lander_terrain_mask_deg: c.landerMask,
      station_elevation_mask_deg: c.stationMask,
      lit_threshold_disc_fraction: c.litThreshold,
      hardware: `array ${hw.arrayKw} kW, load ${hw.loadKw} kW, heater ${hw.heaterKw} kW, battery ${hw.batteryKwh} kWh`,
      ephemeris: 'NAIF SPICE DE440, MOON_ME frame, LT+S, baked hourly',
      angles: 'azimuth from local north through east; elevation above the local horizontal plane',
      link: location.href,
      generated_utc: new Date().toISOString(),
    };
  };
  const exportTimeline = () => {
    const S = a.series,
      soc = a.summary.soc;
    const rows: (string | number)[][] = [];
    for (let i = 0; i < S.n; i++) {
      const m = S.mask[i];
      rows.push([
        isoMin(S.t0 + i * S.stepMs),
        S.sunAz[i].toFixed(3),
        S.sunEl[i].toFixed(4),
        S.fSun[i].toFixed(4),
        S.fRaw[i].toFixed(4),
        S.occ[i].toFixed(4),
        S.earthAz[i].toFixed(3),
        S.earthEl[i].toFixed(4),
        S.fEarth[i].toFixed(4),
        S.earthUp[i],
        m ? 1 : 0,
        ...s.stations.map((_, k) => (m >> k) & 1),
        soc[i].toFixed(1),
      ]);
    }
    download(
      `helios-luna_${slug(site.id)}_${isoMin(s.arrival).slice(0, 10)}_timeline.csv`,
      csv(
        prov(),
        [
          'utc',
          'sun_az_deg',
          'sun_el_deg',
          'sun_disc_visible',
          'sun_disc_above_terrain',
          'eclipse_fraction',
          'earth_az_deg',
          'earth_el_deg',
          'earth_disc_visible',
          'earth_centre_up',
          'link_any_station',
          ...s.stations.map((x) => 'link_' + slug(x.id)),
          'battery_soc_pct',
        ],
        rows,
      ),
    );
  };
  const exportHorizon = () => {
    const n = a.horizon.length;
    download(
      `helios-luna_${slug(site.id)}_horizon_${s.z}m.csv`,
      csv(
        { ...prov(), resolution: `${n} azimuths, terrain to 300 km` },
        ['az_deg', 'horizon_el_deg'],
        Array.from(a.horizon, (v, i) => [((i * 360) / n).toFixed(3), v.toFixed(4)]),
      ),
    );
  };
  /** Terrain horizon as an STK azimuth-elevation mask (.aem): import on an STK Place/Facility as its terrain mask. */
  const exportStk = () => {
    const n = a.horizon.length,
      lines = Array.from(a.horizon, (v, i) => `${((i * 360) / n).toFixed(4)} ${v.toFixed(4)}`);
    lines.push(`360.0000 ${a.horizon[0].toFixed(4)}`);
    download(
      `helios-luna_${slug(site.id)}_mask_${s.z}m.aem`,
      [
        'stk.v.11.0',
        `# HELIOS-LUNA terrain horizon for ${site.label} (${site.lat.toFixed(5)}, ${site.lon.toFixed(5)}), mast ${s.z} m`,
        '# LOLA terrain to 300 km on the curved Moon, 1440 azimuths; azimuth from north through east, degrees',
        'BEGIN AzElMask',
        `NumberOfPoints ${lines.length}`,
        'BEGIN AzElMaskData',
        ...lines,
        'END AzElMask',
        '',
      ].join('\n'),
      'text/plain',
    );
  };
  const exportPasses = () =>
    download(
      `helios-luna_${slug(site.id)}_${isoMin(s.arrival).slice(0, 10)}_passes.csv`,
      csv(
        prov(),
        ['station', 'start_utc', 'end_utc', 'duration_h'],
        sm.passes.map((p) => [
          p.station,
          isoMin(p.startMs),
          isoMin(p.endMs),
          ((p.endMs - p.startMs) / 3.6e6).toFixed(2),
        ]),
      ),
    );

  const g = grade(sm, s.req);
  const kv = (label: string, value: React.ReactNode, help?: string) => (
    <div className="kvrow" title={help}>
      <span>{label}</span>
      <b>{value}</b>
    </div>
  );
  const MORE: [typeof more, string][] = [
    ['numbers', 'Numbers'],
    ['plans', 'Plans'],
    ['slip', 'If it slips'],
    ['zone', 'Landing zone'],
    ['mast', 'Mast'],
    ['passes', 'Passes'],
    ['years', '19 years'],
    ['export', 'Export'],
  ];
  return (
    <div className={'page' + (stale ? ' stale' : '')} aria-busy={stale}>
      <header className="pagehead">
        <div>
          <h1>
            <i className="chip" style={{ ['--hue' as string]: siteHue(site.id) }} />
            {site.id.startsWith('Custom') ? 'Custom point' : site.id}
            <span className={'grade ' + g.grade} title={g.reasons.join('; ') || 'Meets the mission profile'}>
              {g.grade === 'go' ? 'GO' : g.grade === 'check' ? 'CHECK' : 'NO-GO'}
            </span>
          </h1>
          <p className="sub">
            {site.id.startsWith('Custom') ? '' : site.label.replace(/ · .*/, '') + ' · '}
            {site.lat.toFixed(3)}°, {site.lon.toFixed(3)}° · {qualityLabel(a.meta.quality)} · ground{' '}
            {a.meta.groundH.toFixed(0)} m, slope {a.meta.slope.toFixed(1)}°
          </p>
        </div>
      </header>
      <p className="lede">
        {verdict(sm, s.duration, band ? { sunLo: band.sun[0], sunHi: band.sun[1] } : undefined, mast?.z)}
      </p>

      <section className="panel sky">
        <canvas ref={ovRef} aria-label="360 degree overview" />
        <canvas ref={pano} role="img" aria-label="Horizon panorama with Sun and Earth" />
        <div className="skybar">
          <span className="segmented small" role="group" aria-label="Look toward">
            {(['sun', 'earth', 0, 90, 180, 270] as const).map((f) => (
              <button key={String(f)} aria-pressed={follow === f} onClick={() => setFollow(f)}>
                {f === 'sun' ? 'Sun' : f === 'earth' ? 'Earth' : COMPASS[f]}
              </button>
            ))}
          </span>
          <label className="fov">
            Field
            <Range min={15} max={120} value={fov} onChange={setFov} aria-label="Field of view" />
          </label>
          <button className="btn primary" onClick={() => setPlaying((p) => !p)}>
            {playing ? 'Pause' : 'Play the stay'}
          </button>
        </div>
      </section>

      <div className="cols">
        <section className="panel">
          <div className="panelhead">
            <h2>Timeline</h2>
            <span className="muted">{fmtDT(t)}</span>
          </div>
          <canvas
            ref={tl}
            style={{ touchAction: 'none', cursor: 'ew-resize' }}
            role="slider"
            tabIndex={0}
            aria-label="Time within the stay. Arrow keys step one hour, Shift+arrow one day, Space plays."
            aria-valuemin={T0}
            aria-valuemax={TN}
            aria-valuenow={Math.round(s.cursor)}
            aria-valuetext={fmtDT(s.cursor)}
            onKeyDown={(e) => {
              const step = (e.shiftKey ? 24 : 1) * 3.6e6;
              if (e.key === 'ArrowRight' || e.key === 'ArrowLeft') {
                e.preventDefault();
                setPlaying(false);
                const c = s.cursor + (e.key === 'ArrowRight' ? step : -step);
                s.set({ cursor: Math.min(TN - 1, Math.max(T0, c)) });
              } else if (e.key === ' ') {
                e.preventDefault();
                setPlaying((p) => !p);
              }
            }}
            onPointerDown={(e) => {
              e.currentTarget.setPointerCapture(e.pointerId);
              scrub(e);
            }}
            onPointerMove={scrub}
          />
          <div className="now">
            <div>
              <span>Sun</span>
              <b>
                {S.sunEl[idx].toFixed(2)}° · {(litNow * 100).toFixed(0)}% visible
              </b>
            </div>
            <div>
              <span>Earth</span>
              <b>{S.earthEl[idx].toFixed(2)}°</b>
            </div>
            <div>
              <span>Link</span>
              <b>{stationsUp.length ? stationsUp.join(', ') : S.earthUp[idx] ? 'no station' : 'Earth down'}</b>
            </div>
          </div>
          {S.occ[idx] > 0.01 && (
            <div className="callout bad" style={{ marginTop: 8 }}>
              Eclipse: Earth covers {(S.occ[idx] * 100).toFixed(0)}% of the Sun
            </div>
          )}
        </section>
        <section className="panel">
          <div className="panelhead">
            <h2>What happens next</h2>
          </div>
          <OpsClock ev={ev} t={s.cursor} stations={s.stations.map((x) => x.name)} />
        </section>
      </div>

      <nav className="segmented tabsbar" role="tablist" aria-label="More analysis">
        {MORE.map(([id, label]) => (
          <button
            key={id}
            role="tab"
            aria-selected={more === id}
            aria-pressed={more === id}
            onClick={() => setMore(id)}
          >
            {label}
          </button>
        ))}
      </nav>

      {more === 'numbers' && (
        <section className="panel">
          <div className="kvgrid">
            {kv(
              'Sunlit',
              `${sm.sunPct.toFixed(1)}%${band ? `  (${band.sun[0].toFixed(0)}–${band.sun[1].toFixed(0)}% nearby)` : ''}`,
              HELP.sun,
            )}
            {kv('Longest darkness', fmtH(sm.longestDarkH), HELP.dark)}
            {kv('Longest continuous sun', fmtH(sm.longestLitH))}
            {kv('Earth link', `${sm.dtePct.toFixed(1)}%`, HELP.link)}
            {kv('Longest link outage', fmtH(sm.longestOutageH), HELP.outage)}
            {kv('Power and link together', `${sm.bothPct.toFixed(1)}%`)}
            {kv(
              'Solar elevation',
              `max ${sm.sunElMax.toFixed(2)}°${Number.isFinite(sm.sunElMeanLit) ? `, mean ${sm.sunElMeanLit.toFixed(2)}°` : ''}`,
            )}
            {kv(
              'Earth elevation',
              `max ${sm.earthElMax.toFixed(2)}°${Number.isFinite(sm.earthElMeanUp) ? `, mean ${sm.earthElMeanUp.toFixed(2)}°` : ', never up'}`,
            )}
            {kv('Array output', `${(sm.powerFactor * 100).toFixed(0)}% of rated · ${sm.energyKwh.toFixed(0)} kWh`)}
            {kv(
              'Minimum battery',
              s.hardware.batteryKwh > 0
                ? `${sm.minSocPct.toFixed(0)}%${sm.blackout ? `, flat at ${fmtDT(sm.flatAtMs ?? 0).slice(5)}` : ''}`
                : 'no battery',
            )}
            {kv('Earth eclipses the Sun', `${sm.eclipseHours.toFixed(1)} h`)}
            {kv('Highest horizon', `${Math.max(...a.horizon).toFixed(2)}° at ${s.z} m mast`)}
          </div>
        </section>
      )}
      {more === 'plans' && <Plans site={site} />}
      {more === 'slip' && <SlipPanel site={site} />}
      {more === 'zone' && <ZonePanel site={site} />}
      {more === 'mast' && (
        <section className="panel">
          <p className="muted">
            The shortest mast that meets the mission profile for this stay, exact from the horizon envelope.
          </p>
          <button className="btn primary" onClick={findMast} disabled={mastBusy}>
            {mastBusy ? 'Searching…' : 'Find minimum mast'}
          </button>
          {mast && (
            <div style={{ marginTop: 12 }}>
              {mast.z == null ? (
                <div className="callout bad">Not achievable even at 50 m: {mast.atMax.failed.join('; ')}.</div>
              ) : mast.z === 0 ? (
                <div className="callout ok">Met with no mast at all.</div>
              ) : (
                <div className="row">
                  <b style={{ fontSize: 22 }}>{mast.z.toFixed(1)} m</b>
                  <span className="muted small">(fails at 0 m: {mast.atZero.failed.join('; ')})</span>
                  <button className="btn" onClick={() => s.set({ z: Math.min(50, Math.ceil(mast.z! * 2) / 2) })}>
                    Use {Math.min(50, Math.ceil(mast.z * 2) / 2)} m
                  </button>
                </div>
              )}
            </div>
          )}
        </section>
      )}
      {more === 'passes' && (
        <section className="panel">
          <p className="muted small">
            {s.stations.map((x) => `${x.name} ${sm.passCounts[x.id] ?? 0}`).join(' · ')} · {s.config().stepMin}-minute
            steps
          </p>
          {sm.passes.length === 0 ? (
            <p className="muted">No station can see this lander during the stay.</p>
          ) : (
            sm.passes.map((p, i) => (
              <div key={i} className="pass">
                <span className="pname">{s.stations.find((x) => x.id === p.station)?.name ?? p.station}</span>
                {fmtDT(p.startMs).slice(5, 16)} → {fmtDT(p.endMs).slice(5, 16)}{' '}
                <span className="faint">{fmtH((p.endMs - p.startMs) / 3.6e6)}</span>
              </div>
            ))
          )}
        </section>
      )}
      {more === 'years' && (
        <section className="panel">
          <div className="row" style={{ justifyContent: 'space-between' }}>
            <p className="muted" style={{ margin: 0 }}>
              Mean sunlit % and link % for each calendar year, 2026–2044.
            </p>
            <button className="btn" onClick={loadLt} disabled={ltBusy}>
              {ltBusy ? 'Computing…' : lt ? 'Recompute' : 'Compute'}
            </button>
          </div>
          {lt && <LongTerm data={lt} />}
        </section>
      )}
      {more === 'export' && (
        <section className="panel">
          <div className="row">
            <button className="btn" onClick={exportTimeline}>
              Timeline (CSV)
            </button>
            <button className="btn" onClick={exportPasses}>
              Station passes (CSV)
            </button>
            <button className="btn" onClick={exportHorizon}>
              Horizon profile (CSV)
            </button>
            <button className="btn" onClick={exportStk}>
              Horizon mask for STK (.aem)
            </button>
          </div>
          <p className="faint small">Each file starts with lines recording the site, settings and data sources.</p>
        </section>
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
        ctx.fillStyle = cssVar('--muted');
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
