import { useEffect, useRef } from 'react';

export const fmtDate = (ms: number) => new Date(ms).toISOString().slice(0, 10);
export const fmtDT = (ms: number) => new Date(ms).toISOString().slice(0, 16).replace('T', ' ') + ' UTC';
export const fmtH = (h: number) =>
  h >= 48 ? `${(h / 24).toFixed(1)} d` : h >= 1 ? `${h.toFixed(0)} h` : h > 0 ? `${(h * 60).toFixed(0)} min` : '0';

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

/** Canvas hook: re-draws on dependency change and on resize, handling devicePixelRatio. */
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
    return () => ro.disconnect();
  }, deps);
  return ref;
}
