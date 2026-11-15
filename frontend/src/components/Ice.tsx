import { useEffect, useRef } from 'react';
import { PATCH, compass, type PsrResult } from '../math/psr';

const TIP =
  'Permanently shadowed regions never see the Sun, so they stay cold enough (below about 110 K) to trap water ice. ' +
  'Map: NASA PGDA average-illumination data (LOLA, Mazarico et al. 2011) at 120 m, 85–90°S. North is up.';

function closeness(km: number) {
  return km < 1 ? 'Very close' : km < 3 ? 'Close' : km < 10 ? 'Within reach' : 'Far';
}

/** Small north-up map of permanent shadow within 5 km of the site, with the route to the nearest one. */
function IceMap({ psr, size }: { psr: Exclude<PsrResult, null | 'none'>; size: number }) {
  const ref = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    const c = ref.current;
    if (!c) return;
    const dpr = window.devicePixelRatio || 1;
    c.width = c.height = size * dpr;
    const ctx = c.getContext('2d')!;
    ctx.scale(dpr, dpr);
    const r = size / 2,
      px = size / PATCH;
    ctx.clearRect(0, 0, size, size);
    ctx.save();
    ctx.beginPath();
    ctx.arc(r, r, r - 1, 0, 7);
    ctx.clip();
    const bg = ctx.createRadialGradient(r, r, 0, r, r, r);
    bg.addColorStop(0, '#1b2638');
    bg.addColorStop(1, '#0b1220');
    ctx.fillStyle = bg;
    ctx.fillRect(0, 0, size, size);
    ctx.fillStyle = '#64d2ff';
    ctx.shadowColor = '#64d2ff';
    ctx.shadowBlur = 6;
    for (let j = 0; j < PATCH; j++)
      for (let i = 0; i < PATCH; i++) if (psr.patch[j * PATCH + i]) ctx.fillRect(i * px, j * px, px + 0.6, px + 0.6);
    ctx.shadowBlur = 0;
    ctx.strokeStyle = 'rgba(255,255,255,0.14)';
    ctx.lineWidth = 1;
    for (const km of [1, 2.5, 5]) {
      ctx.beginPath();
      ctx.arc(r, r, (km / 5) * (r - 1), 0, 7);
      ctx.stroke();
    }
    if (psr.km > 0.12 && psr.km <= 5) {
      const a = (psr.az * Math.PI) / 180,
        d = (psr.km / 5) * (r - 1);
      ctx.strokeStyle = '#ffffff';
      ctx.setLineDash([3, 3]);
      ctx.beginPath();
      ctx.moveTo(r, r);
      ctx.lineTo(r + Math.sin(a) * d, r - Math.cos(a) * d);
      ctx.stroke();
      ctx.setLineDash([]);
    }
    ctx.restore();
    ctx.fillStyle = '#ffd60a';
    ctx.strokeStyle = '#0b1220';
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.arc(r, r, Math.max(3, size / 28), 0, 7);
    ctx.fill();
    ctx.stroke();
    ctx.fillStyle = 'rgba(255,255,255,0.75)';
    ctx.font = `600 ${Math.max(9, size / 12)}px system-ui, -apple-system, sans-serif`;
    ctx.textAlign = 'center';
    ctx.fillText('N', r, Math.max(11, size / 9));
  }, [psr, size]);
  return (
    <canvas
      ref={ref}
      className="icemap"
      style={{ width: size, height: size }}
      role="img"
      aria-label={`Permanent shadow within 5 km: ${psr.areaKm2.toFixed(1)} square km; nearest ${psr.km.toFixed(1)} km ${compass(psr.az)}`}
    />
  );
}

/** "Water ice nearby" panel: distance to the nearest permanently shadowed region and a map of them around the site. */
export function IcePanel({ psr, compact }: { psr: PsrResult; compact?: boolean }) {
  if (psr === null) return null;
  if (psr === 'none')
    return compact ? (
      <div className="icepanel none" title={TIP}>
        Water-ice map covers 85–90°S only
      </div>
    ) : null;
  const on = psr.km < 0.12;
  return (
    <div className={'icepanel' + (compact ? ' compact' : '')} title={TIP}>
      <IceMap psr={psr} size={compact ? 76 : 132} />
      <div className="icetext">
        <div className="iceeyebrow">
          ❄︎ Water ice nearby <span className="icetag">{on ? 'On site' : closeness(psr.km)}</span>
        </div>
        <div className="icebig">
          {on ? 'In permanent shadow' : `${psr.km < 10 ? psr.km.toFixed(1) : psr.km.toFixed(0)} km ${compass(psr.az)}`}
        </div>
        <div className="icesub">
          to the nearest permanently shadowed region · <b>{psr.areaKm2.toFixed(1)} km²</b> of it within 5 km
          {!compact && (
            <>
              <br />
              These craters never see the Sun, so water ice can survive there: a science and resource target a crew or
              rover could reach from this site.
            </>
          )}
        </div>
      </div>
    </div>
  );
}
