export interface GridMeta {
  file: string;
  n: number;
  res: number;
  x0: number;
  y0: number;
}
export interface DemMeta {
  R: number;
  scale: number;
  orientation: string;
  grids: Record<string, GridMeta>;
}

/** Regular polar-stereographic height grid, Int16 @ 0.5 m, heights relative to R = 1737.4 km. -32768 = no data. */
export class Grid {
  constructor(
    public name: string,
    public n: number,
    public res: number,
    public x0: number,
    public y0: number,
    public data: Int16Array,
  ) {}
  /** Bilinear height in metres; NaN outside the grid or on no-data. */
  height(x: number, y: number): number {
    const c = (x - this.x0) / this.res,
      r = (this.y0 - y) / this.res;
    const i = Math.floor(c),
      j = Math.floor(r);
    if (i < 0 || j < 0 || i >= this.n - 1 || j >= this.n - 1) return NaN;
    const fx = c - i,
      fy = r - j,
      d = this.data,
      n = this.n,
      k = j * n + i;
    const a = d[k],
      b = d[k + 1],
      cc = d[k + n],
      dd = d[k + n + 1];
    if (a === -32768 || b === -32768 || cc === -32768 || dd === -32768) return NaN;
    return 0.5 * (a * (1 - fx) * (1 - fy) + b * fx * (1 - fy) + cc * (1 - fx) * fy + dd * fx * fy);
  }
  get halfExtent() {
    return ((this.n - 1) * this.res) / 2;
  }
}

/** The DEM pyramid for one observer region: near 20 m (<5 km), mid 120 m (5-40 km), global-mid 240 m, far 480 m (>40 km, to 70 S). */
export class Pyramid {
  levels: [Grid[], Grid[], Grid[]]; // by distance class: <5 km, 5-40 km, >40 km
  all: Grid[];
  hmax = 7200; // highest terrain anywhere in the far grid (m); used for early exit
  constructor(
    public regionId: string | null,
    public near: Grid | null,
    public mid: Grid | null,
    public midGlobal: Grid,
    public far: Grid,
  ) {
    const f = (a: (Grid | null)[]) => a.filter(Boolean) as Grid[];
    this.levels = [f([near, mid, midGlobal, far]), f([mid, midGlobal, far]), f([far])];
    this.all = f([near, mid, midGlobal, far]);
    let mx = -1e9;
    for (let i = 0; i < far.data.length; i += 7) if (far.data[i] > mx && far.data[i] !== -32768) mx = far.data[i];
    this.hmax = mx * 0.5 + 300;
  }
  surfaceHeight(x: number, y: number): number {
    for (const g of this.all) {
      const h = g.height(x, y);
      if (!Number.isNaN(h)) return h;
    }
    return NaN;
  }
  /** Which grid a point is best served by (for provenance / the "approximate" warning). */
  finestAt(x: number, y: number): Grid | null {
    for (const g of this.all) if (!Number.isNaN(g.height(x, y))) return g;
    return null;
  }
}
