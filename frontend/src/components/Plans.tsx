import { useEffect, useState } from 'react';
import { useStore, analysisKey } from '../store/useStore';
import { grade, type Grade } from '../math/analysis';
import type { SiteRef } from '../math/engine';
import { fmtDT, fmtH } from './common';
import { fmtSpan } from './OpsClock';

interface Plan {
  name: string;
  savedAt: number;
  site: SiteRef;
  arrival: number;
  duration: number;
  z: number;
  profile: string;
  m: Record<string, number | null>;
  grade: Grade;
}
const KEY = 'hl-plans';
const ROWS: { k: string; label: string; better: 'up' | 'down'; fmt: (v: number) => string }[] = [
  { k: 'sun', label: 'Sunlit', better: 'up', fmt: (v) => `${v.toFixed(0)}%` },
  { k: 'dark', label: 'Longest darkness', better: 'down', fmt: fmtH },
  { k: 'dte', label: 'Earth link', better: 'up', fmt: (v) => `${v.toFixed(0)}%` },
  { k: 'outage', label: 'Longest link outage', better: 'down', fmt: fmtH },
  { k: 'both', label: 'Power + link together', better: 'up', fmt: (v) => `${v.toFixed(0)}%` },
  { k: 'sunset', label: 'First sunset after touchdown', better: 'up', fmt: (v) => fmtSpan(v * 3.6e6) },
  { k: 'earthset', label: 'First Earthset after touchdown', better: 'up', fmt: (v) => fmtSpan(v * 3.6e6) },
  { k: 'battery', label: 'Minimum battery', better: 'up', fmt: (v) => `${v.toFixed(0)}%` },
];
const GT = { go: 'GO', check: 'CHECK', nogo: 'NO-GO' };

function load(): Plan[] {
  try {
    return JSON.parse(localStorage.getItem(KEY) || '[]');
  } catch {
    return [];
  }
}

/** Save scenarios as named plans and see, line by line, what a slip or a site change does to them. */
export function Plans({ site }: { site: SiteRef }) {
  const s = useStore();
  const [plans, setPlans] = useState<Plan[]>(load),
    [base, setBase] = useState(0);
  useEffect(() => {
    try {
      localStorage.setItem(KEY, JSON.stringify(plans));
    } catch {
      /* private mode: plans last for this session */
    }
  }, [plans]);
  const a = s.analyses[site.id];
  const fresh = a && s.analysisKeys[site.id] === analysisKey(s, site);
  const metrics = (): Plan['m'] | null => {
    if (!a) return null;
    const m = a.summary,
      e = a.events;
    return {
      sun: m.sunPct,
      dark: m.longestDarkH,
      dte: m.dtePct,
      outage: m.longestOutageH,
      both: m.bothPct,
      sunset: e.sun.up && e.sun.next ? (e.sun.next - e.t) / 3.6e6 : e.sun.up ? null : 0,
      earthset: e.earth.up && e.earth.next ? (e.earth.next - e.t) / 3.6e6 : e.earth.up ? null : 0,
      battery: s.hardware.batteryKwh > 0 ? m.minSocPct : null,
    };
  };
  const cur = fresh ? metrics() : null,
    curGrade = a ? grade(a.summary, s.req).grade : null;
  const save = () => {
    const m = metrics();
    if (!m || !a) return;
    const name = `Plan ${String.fromCharCode(65 + (plans.length % 26))}`;
    setPlans([
      ...plans,
      {
        name,
        savedAt: Date.now(),
        site,
        arrival: s.arrival,
        duration: s.duration,
        z: s.z,
        profile: s.profile,
        m,
        grade: grade(a.summary, s.req).grade,
      },
    ]);
    setBase(plans.length);
  };
  const p = plans[base];
  return (
    <div className="card">
      <h3>
        Plans{' '}
        <span className="faint" style={{ textTransform: 'none', letterSpacing: 0 }}>
          save this scenario, change the date or site, and see exactly what moved
        </span>
      </h3>
      <div className="row" style={{ gap: 6 }}>
        <button className="btn primary" onClick={save} disabled={!fresh}>
          Save current as {`Plan ${String.fromCharCode(65 + (plans.length % 26))}`}
        </button>
        {plans.map((q, i) => (
          <span key={q.savedAt} className={'plantag' + (i === base ? ' on' : '')}>
            <button onClick={() => setBase(i)} title="Compare the current scenario with this plan">
              {q.name}
            </button>
            <button
              title="Restore this plan"
              onClick={() => {
                if (!s.sites.some((x) => x.id === q.site.id)) s.addSite(q.site);
                s.set({
                  selected: q.site.id,
                  arrival: q.arrival,
                  duration: q.duration,
                  z: q.z,
                  cursor: q.arrival + 43_200_000,
                });
              }}
            >
              ↺
            </button>
            <button
              title="Delete this plan"
              onClick={() => {
                setPlans(plans.filter((_, j) => j !== i));
                setBase(0);
              }}
            >
              ×
            </button>
          </span>
        ))}
      </div>
      {p && cur && (
        <table style={{ marginTop: 12 }}>
          <thead>
            <tr>
              <th></th>
              <th>{p.name}</th>
              <th>Current</th>
              <th>Change</th>
            </tr>
          </thead>
          <tbody>
            <tr>
              <td>Site</td>
              <td>{p.site.id}</td>
              <td>{site.id}</td>
              <td className="faint">{p.site.id === site.id ? 'same' : 'changed'}</td>
            </tr>
            <tr>
              <td>Touchdown</td>
              <td>{fmtDT(p.arrival)}</td>
              <td>{fmtDT(s.arrival)}</td>
              <td>
                {s.arrival === p.arrival ? (
                  <span className="faint">same</span>
                ) : (
                  `${s.arrival > p.arrival ? '+' : '−'}${fmtSpan(Math.abs(s.arrival - p.arrival))}`
                )}
              </td>
            </tr>
            <tr>
              <td>Grade</td>
              <td>
                <span className={'grade ' + p.grade}>{GT[p.grade]}</span>
              </td>
              <td>{curGrade && <span className={'grade ' + curGrade}>{GT[curGrade]}</span>}</td>
              <td></td>
            </tr>
            {ROWS.map((r) => {
              const A = p.m[r.k],
                B = cur[r.k];
              const d = A != null && B != null ? B - A : null,
                good = d != null && (r.better === 'up' ? d > 0 : d < 0),
                small =
                  d == null ||
                  Math.abs(d) < (r.k === 'sun' || r.k === 'dte' || r.k === 'both' || r.k === 'battery' ? 0.5 : 0.25);
              const show = (v: number | null) => (v == null ? (r.k === 'battery' ? '–' : 'beyond 40 d') : r.fmt(v));
              return (
                <tr key={r.k}>
                  <td>{r.label}</td>
                  <td>{show(A)}</td>
                  <td>{show(B)}</td>
                  <td style={{ color: small ? 'var(--faint)' : good ? 'var(--ok)' : 'var(--bad)', fontWeight: 600 }}>
                    {small
                      ? 'same'
                      : `${d! > 0 ? '+' : '−'}${r.k === 'sun' || r.k === 'dte' || r.k === 'both' || r.k === 'battery' ? `${Math.abs(d!).toFixed(0)} pts` : r.fmt(Math.abs(d!))}`}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      )}
      {!plans.length && (
        <p className="faint small" style={{ marginTop: 8 }}>
          Typical use: save the baseline, then move the touchdown date by the slip and read the change column.
        </p>
      )}
    </div>
  );
}
