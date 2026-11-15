import { useEffect, useRef } from 'react';

export const fmtDate = (ms: number) => new Date(ms).toISOString().slice(0, 10);
export const fmtDT = (ms: number) => new Date(ms).toISOString().slice(0, 16).replace('T', ' ') + ' UTC';
export const fmtH = (h: number) =>
  h >= 48 ? `${(h / 24).toFixed(1)} d` : h >= 1 ? `${h.toFixed(0)} h` : h > 0 ? `${(h * 60).toFixed(0)} min` : '0';

/** Human label for the terrain that resolves a site's near field. */
export const qualityLabel = (q?: string) =>
  q === 'high'
    ? '20 m terrain'
    : q === 'medium'
      ? '120 m terrain'
      : q === 'coarse'
        ? '240 m terrain'
        : '1.9 km global terrain';

/** Stable colour per site id, shared by the sidebar, matrix, cards and the pole view. */
const HUES = [
  '#ffc94a',
  '#5aa9ff',
  '#6ee7a8',
  '#ff8fa3',
  '#c7a6ff',
  '#ffa25c',
  '#62d6e8',
  '#f2e27a',
  '#9fb4ff',
  '#e79bf2',
];
export function siteHue(id: string): string {
  let h = 2166136261;
  for (let i = 0; i < id.length; i++) h = Math.imul(h ^ id.charCodeAt(i), 16777619);
  return HUES[(h >>> 0) % HUES.length];
}

/** Range input whose track fills up to the thumb. */
export function Range({
  value,
  min,
  max,
  step = 1,
  onChange,
  className,
  ...rest
}: {
  value: number;
  min: number;
  max: number;
  step?: number;
  onChange: (v: number) => void;
  className?: string;
  id?: string;
  'aria-label'?: string;
  style?: React.CSSProperties;
}) {
  const p = ((value - min) / (max - min || 1)) * 100;
  return (
    <input
      type="range"
      min={min}
      max={max}
      step={step}
      value={value}
      className={className}
      onChange={(e) => onChange(+e.target.value)}
      {...rest}
      style={{ ...rest.style, ['--p' as string]: `${p}%` }}
    />
  );
}

const PATHS: Record<string, string> = {
  pole: 'M12 3a9 9 0 1 0 0 18 9 9 0 0 0 0-18Zm0 4a5 5 0 1 0 0 10 5 5 0 0 0 0-10Zm0 4.2a.8.8 0 1 0 0 1.6.8.8 0 0 0 0-1.6Z',
  compare: 'M4 5h16M4 12h16M4 19h16M9 3v18M15 3v18',
  sky: 'M3 18h18M6 18a6 6 0 0 1 12 0M12 6V4M5.6 9.6 4.2 8.2M18.4 9.6l1.4-1.4M3 22h18',
  map: 'M9 4 3 6v14l6-2 6 2 6-2V4l-6 2-6-2Zm0 0v14m6-12v14',
  trust: 'M12 3 4 6v6c0 4.5 3.4 8.1 8 9 4.6-.9 8-4.5 8-9V6l-8-3Zm-3.5 9 2.5 2.5 4.5-5',
  sun: 'M12 8a4 4 0 1 0 0 8 4 4 0 0 0 0-8ZM12 2v2m0 16v2M4.9 4.9l1.4 1.4m11.4 11.4 1.4 1.4M2 12h2m16 0h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4',
  dark: 'M20 14.5A8 8 0 0 1 9.5 4a8 8 0 1 0 10.5 10.5Z',
  link: 'M5 19a10 10 0 0 1 0-14M8.5 15.5a5 5 0 0 1 0-7M19 5a10 10 0 0 1 0 14M15.5 8.5a5 5 0 0 1 0 7M12 12h.01',
  gap: 'M4 12h4m8 0h4M10 8l-2 8m8-8-2 8',
  both: 'M13 2 4 14h7l-1 8 9-12h-7l1-8Z',
  battery: 'M3 8h15v8H3zM21 11v2M6 11v2',
  play: 'M7 4v16l13-8L7 4Z',
  pause: 'M7 4h4v16H7zM13 4h4v16h-4z',
  plus: 'M12 5v14M5 12h14',
  minus: 'M5 12h14',
  reset: 'M4 12a8 8 0 1 0 2.3-5.6M4 4v4h4',
  download: 'M12 4v11m0 0-4-4m4 4 4-4M5 20h14',
  link2: 'M10 14a4 4 0 0 0 5.7 0l3-3a4 4 0 0 0-5.7-5.7l-1 1M14 10a4 4 0 0 0-5.7 0l-3 3a4 4 0 0 0 5.7 5.7l1-1',
  target: 'M12 2v4m0 12v4M2 12h4m12 0h4M12 8a4 4 0 1 0 0 8 4 4 0 0 0 0-8Z',
  earth:
    'M12 3a9 9 0 1 0 0 18 9 9 0 0 0 0-18ZM3.5 9h17M3.5 15h17M12 3c-2.5 2.6-3.8 5.6-3.8 9s1.3 6.4 3.8 9c2.5-2.6 3.8-5.6 3.8-9S14.5 5.6 12 3Z',
};
export function Icon({ name, size = 16, fill = false }: { name: keyof typeof PATHS; size?: number; fill?: boolean }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill={fill ? 'currentColor' : 'none'}
      stroke={fill ? 'none' : 'currentColor'}
      strokeWidth={1.8}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden
    >
      <path d={PATHS[name]} />
    </svg>
  );
}

/** Floating tooltip that stays inside the viewport. */
export function Tip({ x, y, children }: { x: number; y: number; children: React.ReactNode }) {
  const left = Math.max(8, Math.min(x + 14, window.innerWidth - 296)),
    top = y + 14 + 120 > window.innerHeight ? y - 14 - 110 : y + 14;
  return (
    <div className="tip" style={{ left, top, whiteSpace: 'pre' }}>
      {children}
    </div>
  );
}

/** Save text as a file in the browser. */
export function download(name: string, text: string, type = 'text/csv') {
  const url = URL.createObjectURL(new Blob([text], { type: type + ';charset=utf-8' }));
  const a = document.createElement('a');
  a.href = url;
  a.download = name;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
/** CSV with leading '# key: value' provenance lines (read with pandas.read_csv(f, comment='#')). */
export function csv(meta: Record<string, string | number>, header: string[], rows: (string | number)[][]): string {
  const q = (v: string | number) => {
    const t = String(v);
    return /[",\n]/.test(t) ? '"' + t.replace(/"/g, '""') + '"' : t;
  };
  const lines = Object.entries(meta).map(([k, v]) => `# ${k}: ${v}`);
  lines.push(header.map(q).join(','));
  for (const r of rows) lines.push(r.map(q).join(','));
  return lines.join('\n') + '\n';
}
export const isoMin = (ms: number) => new Date(ms).toISOString().slice(0, 16) + 'Z';
export const slug = (t: string) => t.replace(/[^A-Za-z0-9.-]+/g, '_').replace(/^_|_$/g, '');

// Viridis (colour-blind safe, perceptually uniform), 9 stops.
const VIR = [
  [68, 1, 84],
  [72, 40, 120],
  [62, 74, 137],
  [49, 104, 142],
  [38, 130, 142],
  [31, 158, 137],
  [53, 183, 121],
  [109, 205, 89],
  [253, 231, 37],
];
export function viridis(t: number): [number, number, number] {
  t = Math.min(1, Math.max(0, t)) * (VIR.length - 1);
  const i = Math.min(VIR.length - 2, Math.floor(t)),
    f = t - i;
  return [0, 1, 2].map((k) => Math.round(VIR[i][k] * (1 - f) + VIR[i + 1][k] * f)) as [number, number, number];
}
export const viridisCss = () => `linear-gradient(90deg, ${VIR.map((c, i) => `rgb(${c}) ${(i / 8) * 100}%`).join(',')})`;

/** Current value of a CSS colour token (follows the light/dark theme). */
export const cssVar = (name: string) =>
  getComputedStyle(document.documentElement).getPropertyValue(name).trim() || '#888';

/** Canvas hook: re-draws on dependency change, on resize and on theme change, handling devicePixelRatio. */
export function useCanvas(
  draw: (ctx: CanvasRenderingContext2D, w: number, h: number) => void,
  deps: unknown[],
  height: number,
) {
  const ref = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    const c = ref.current;
    if (!c) return;
    const go = () => {
      const w = c.parentElement!.clientWidth,
        dpr = window.devicePixelRatio || 1;
      c.style.width = w + 'px';
      c.style.height = height + 'px';
      c.width = Math.round(w * dpr);
      c.height = Math.round(height * dpr);
      const ctx = c.getContext('2d')!;
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      ctx.clearRect(0, 0, w, height);
      draw(ctx, w, height);
    };
    go();
    const ro = new ResizeObserver(go);
    ro.observe(c.parentElement!);
    window.addEventListener('hl-theme', go);
    return () => {
      ro.disconnect();
      window.removeEventListener('hl-theme', go);
    };
  }, deps);
  return ref;
}
