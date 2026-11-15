import { useEffect, useMemo, useRef, useState } from 'react';
import { useStore } from '../store/useStore';
import { buildCatalogue, parseCoords, type CatEntry } from '../data/catalogue';
import { Icon, siteHue } from './common';

const ORDER = ['artemis', 'clps', 'apollo', 'intl', 'classic'];

/** Search every catalogue site, or type "lat, lon" for any point on the Moon. Inline in the sidebar or as a ⌘K palette. */
export function SitePicker({
  onDone,
  autoFocus,
  palette,
}: {
  onDone?: () => void;
  autoFocus?: boolean;
  palette?: boolean;
}) {
  const s = useStore();
  const cat = useMemo(() => buildCatalogue(s.regions), [s.regions]);
  const [q, setQ] = useState(''),
    [hi, setHi] = useState(0),
    [focused, setFocused] = useState(false);
  const input = useRef<HTMLInputElement>(null);
  useEffect(() => {
    if (autoFocus) input.current?.focus();
  }, [autoFocus]);
  const custom = parseCoords(q);
  const words = q.toLowerCase().split(/\s+/).filter(Boolean);
  const hits: CatEntry[] = custom
    ? []
    : cat
        .filter((c) => words.every((w) => c.search.includes(w)))
        .sort((a, b) => ORDER.indexOf(a.group) - ORDER.indexOf(b.group))
        .slice(0, q ? 40 : 60);
  const pick = (ref: { id: string; label: string; lat: number; lon: number }) => {
    s.addSite(ref);
    setQ('');
    onDone?.();
  };
  const list: { id: string; label: string; lat: number; lon: number }[] = custom ? [custom] : hits;
  let lastGroup = '';
  return (
    <div className="picker">
      <div className="search">
        <Icon name="target" size={15} />
        <input
          ref={input}
          value={q}
          placeholder="Search sites, or type / paste lat, lon"
          aria-label="Search sites or enter coordinates"
          onChange={(e) => {
            setQ(e.target.value);
            setHi(0);
          }}
          onPaste={(e) => {
            // a pasted list of coordinates (one "lat, lon" per line, or separated by ";") adds them all
            const parts = e.clipboardData
              .getData('text')
              .split(/[\n;]+/)
              .map((x) => x.trim())
              .filter(Boolean);
            if (parts.length < 2) return;
            const refs = parts.map(parseCoords).filter(Boolean) as ReturnType<typeof parseCoords>[];
            if (!refs.length) return;
            e.preventDefault();
            for (const r of refs) s.addSite(r!);
            s.set({ notice: null });
            setQ('');
            onDone?.();
          }}
          onFocus={() => setFocused(true)}
          onBlur={() => window.setTimeout(() => setFocused(false), 180)}
          onKeyDown={(e) => {
            if (e.key === 'ArrowDown') {
              e.preventDefault();
              setHi((h) => Math.min(list.length - 1, h + 1));
            } else if (e.key === 'ArrowUp') {
              e.preventDefault();
              setHi((h) => Math.max(0, h - 1));
            } else if (e.key === 'Enter' && list[hi]) pick(list[hi]);
            else if (e.key === 'Escape') onDone?.();
          }}
        />
      </div>
      {(palette || focused || q) && (
        <div className="results" role="listbox">
          {custom ? (
            <button className={'res' + (hi === 0 ? ' hi' : '')} onClick={() => pick(custom)}>
              <i className="chip" style={{ ['--hue' as string]: '#9cc2ff' }} />
              <span>
                <b>Custom point</b> {custom.lat.toFixed(3)}°, {custom.lon.toFixed(3)}°
              </span>
            </button>
          ) : (
            hits.map((c, i) => {
              const head = c.groupName !== lastGroup;
              lastGroup = c.groupName;
              const have = s.sites.some((x) => x.id === c.id);
              return (
                <div key={c.group + c.id}>
                  {head && <div className="grp">{c.groupName}</div>}
                  <button
                    className={'res' + (i === hi ? ' hi' : '')}
                    onMouseEnter={() => setHi(i)}
                    onClick={() => pick(c)}
                    title={c.note}
                  >
                    <i className="chip" style={{ ['--hue' as string]: siteHue(c.id) }} />
                    <span>
                      <b>{c.id}</b> {c.label.replace(/ · .*/, '')}
                      {c.year ? <em> · {c.year}</em> : null}
                    </span>
                    <small>
                      {c.lat.toFixed(2)}°, {c.lon.toFixed(2)}°{have ? ' · added' : ''}
                    </small>
                  </button>
                </div>
              );
            })
          )}
          {!custom && !hits.length && (
            <div className="faint small" style={{ padding: 8 }}>
              No match. Try a name, or “-85.3, 31.2”.
            </div>
          )}
        </div>
      )}
    </div>
  );
}
