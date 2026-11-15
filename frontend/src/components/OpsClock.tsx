import { useEffect, useRef, useState } from 'react';
import { useStore, client, analysisKey } from '../store/useStore';
import type { Events } from '../math/client';
import type { SiteRef } from '../math/engine';
import { Icon, fmtDT } from './common';

/** "3 d 04 h", "5 h 20 min", "12 min". */
export function fmtSpan(ms: number) {
  const m = Math.max(0, Math.round(ms / 60_000)),
    d = Math.floor(m / 1440),
    h = Math.floor((m % 1440) / 60),
    mm = m % 60;
  if (d >= 1) return `${d} d ${String(h).padStart(2, '0')} h`;
  if (h >= 1) return `${h} h ${String(mm).padStart(2, '0')} min`;
  return `${mm} min`;
}

/**
 * Events (next sunset / Earthset / link change) for a site at time t. Fetched once and then counted down locally,
 * so playback stays smooth; re-fetched only when t passes a transition, moves backwards, or a setting changes.
 */
export function useEvents(ref: SiteRef | undefined, t: number): Events | null {
  const s = useStore();
  const [ev, setEv] = useState<Events | null>(null);
  const cfgKey = ref ? analysisKey(s, ref) : '';
  const busy = useRef(false);
  const stale =
    !ev || t < ev.t || [ev.sun.next, ev.earth.next, ev.link.next].some((n) => n != null && t >= n) || t > ev.searchedTo;
  useEffect(() => {
    setEv(null);
  }, [cfgKey]);
  useEffect(() => {
    if (!ref || !stale || busy.current) return;
    busy.current = true;
    const to = window.setTimeout(() => {
      client
        .events(ref, s.config(), t)
        .then(setEv, () => {})
        .finally(() => (busy.current = false));
    }, 60);
    return () => {
      clearTimeout(to);
      busy.current = false;
    };
  }, [ref?.id, stale, cfgKey, Math.round(t / 600_000)]);
  return ev;
}

function Row({
  icon,
  color,
  name,
  up,
  upWord,
  downWord,
  next,
  t,
  horizon,
  extra,
}: {
  icon: 'sun' | 'earth' | 'link';
  color: string;
  name: string;
  up: boolean;
  upWord: string;
  downWord: string;
  next: number | null;
  t: number;
  horizon: number;
  extra?: string;
}) {
  return (
    <div className={'ops-row' + (up ? ' up' : '')} style={{ ['--c' as string]: color }}>
      <span className="ops-ic">
        <Icon name={icon} size={15} />
      </span>
      <span className="ops-name">
        {name}
        <small>{up ? 'up' : 'down'}</small>
      </span>
      <span className="ops-val">
        {next != null ? (
          <>
            <span>
              <b>{fmtSpan(next - t)}</b> <span className="muted">{up ? upWord : downWord}</span>
            </span>
            <small>at {fmtDT(next).slice(5)}</small>
          </>
        ) : (
          <>
            <span>
              <b>{up ? 'Stays up' : 'Stays down'}</b>
            </span>
            <small>through the next {Math.round(horizon / 86_400_000)} days</small>
          </>
        )}
        {extra && <small className="faint">{extra}</small>}
      </span>
    </div>
  );
}

/** Time to the next sunset/sunrise, Earthset/Earthrise and link loss/acquisition at time t (terrain-aware). */
export function OpsClock({ ev, t, stations }: { ev: Events | null; t: number; stations: string[] }) {
  if (!ev) return <div className="muted small">Finding the next transitions…</div>;
  const span = ev.searchedTo - ev.t;
  const linkNames = stations.filter((_, k) => (ev.at.mask >> k) & 1);
  return (
    <div className="ops">
      <Row
        icon="sun"
        color="var(--sun)"
        name="Sun"
        up={ev.sun.up}
        upWord="to sunset"
        downWord="to sunrise"
        next={ev.sun.next}
        t={t}
        horizon={span}
        extra={`elevation ${ev.at.sunEl.toFixed(2)}° · az ${ev.at.sunAz.toFixed(0)}°`}
      />
      <Row
        icon="earth"
        color="var(--earth)"
        name="Earth"
        up={ev.earth.up}
        upWord="to Earthset"
        downWord="to Earthrise"
        next={ev.earth.next}
        t={t}
        horizon={span}
        extra={`elevation ${ev.at.earthEl.toFixed(2)}° · az ${ev.at.earthAz.toFixed(0)}°`}
      />
      <Row
        icon="link"
        color="var(--both)"
        name="Link"
        up={ev.link.up}
        upWord="to loss of signal"
        downWord="to next contact"
        next={ev.link.next}
        t={t}
        horizon={span}
        extra={linkNames.length ? `via ${linkNames.join(', ')}` : undefined}
      />
    </div>
  );
}

/** One-line version for the comparison cards: what happens next after arrival. */
export function OpsLine({ ev }: { ev: Events }) {
  const part = (name: string, tr: Events['sun'], upW: string, downW: string) =>
    tr.next != null
      ? `${name} ${tr.up ? 'up' : 'down'}, ${tr.up ? upW : downW} in ${fmtSpan(tr.next - ev.t)}`
      : `${name} ${tr.up ? 'up' : 'down'} for 40+ days`;
  return (
    <div className="opsline">
      <span style={{ color: ev.sun.up ? 'var(--sun)' : 'var(--faint)' }}>●</span> {part('Sun', ev.sun, 'sets', 'rises')}
      <br />
      <span style={{ color: ev.earth.up ? 'var(--earth)' : 'var(--faint)' }}>●</span>{' '}
      {part('Earth', ev.earth, 'sets', 'rises')}
    </div>
  );
}
