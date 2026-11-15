export interface GridMeta {
  file: string;
  n: number;
  res: number;
  x0: number;
  y0: number;
  type?: 'cylindrical';
  ppd?: number;
  nLon?: number;
  nLat?: number;
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
  private _max: number | null = null;
  /** Highest valid height in the grid (m). */
  get maxHeight(): number {
    if (this._max == null) {
      let mx = -32768;
      const d = this.data;
      for (let i = 0; i < d.length; i++) if (d[i] > mx) mx = d[i];
      this._max = mx * 0.5;
    }
    return this._max;
  }
}

/** Global simple-cylindrical LOLA grid (LDEM_16: 1/16 deg, ~1.9 km), Int16 @ 0.5 m relative to 1737.4 km.
 *  Row 0 is centred on latitude 90 - 1/(2 ppd), column 0 on east longitude 1/(2 ppd). Serves sites anywhere on the Moon. */
export class GlobalGrid {
  readonly res: number;
  constructor(
    public ppd: number,
    public nLon: number,
    public nLat: number,
    public data: Int16Array,
  ) {
    this.res = (Math.PI * 1737400) / 180 / ppd;
  }
  /** Bilinear height (m) at planetocentric lat, east lon (degrees). */
  heightLL(lat: number, lon: number): number {
    const p = this.ppd,
      r = Math.min(this.nLat - 1.0001, Math.max(0, (90 - lat) * p - 0.5)),
      cRaw = (((lon % 360) + 360) % 360) * p - 0.5,
      c = cRaw < 0 ? cRaw + this.nLon : cRaw;
    const i = Math.floor(c),
      j = Math.floor(r),
      fx = c - i,
      fy = r - j,
      i1 = i + 1 === this.nLon ? 0 : i + 1,
      d = this.data,
      n = this.nLon;
    return (
      0.5 *
      (d[j * n + i] * (1 - fx) * (1 - fy) +
        d[j * n + i1] * fx * (1 - fy) +
        d[(j + 1) * n + i] * (1 - fx) * fy +
        d[(j + 1) * n + i1] * fx * fy)
    );
  }
  /** Height at a unit vector in MOON_ME. */
  heightN(x: number, y: number, z: number): number {
    return this.heightLL((Math.asin(Math.max(-1, Math.min(1, z))) * 180) / Math.PI, (Math.atan2(y, x) * 180) / Math.PI);
  }
  private _max: number | null = null;
  get maxHeight(): number {
    if (this._max == null) {
      let mx = -32768;
      for (let i = 0; i < this.data.length; i++) if (this.data[i] > mx) mx = this.data[i];
      this._max = mx * 0.5;
    }
    return this._max;
  }
}

/** The DEM pyramid for one observer region: near 20 m (<5 km), mid 120 m (5-40 km), global-mid 240 m, far 480 m (>40 km, to 70 S). */
export class Pyramid {
  levels: [Grid[], Grid[], Grid[]]; // by distance class: <5 km, 5-40 km, >40 km
  all: Grid[];
  /** Upper bound on terrain height in any grid the march can sample (m); the march's early exit relies on it. */
  hmax: number;
  constructor(
    public regionId: string | null,
    public near: Grid | null,
    public mid: Grid | null,
    public midGlobal: Grid,
    public far: Grid,
    /** whole-Moon fallback, attached only for observers whose 300 km reach leaves the polar grids */
    public global: GlobalGrid | null = null,
  ) {
    const f = (a: (Grid | null)[]) => a.filter(Boolean) as Grid[];
    this.levels = [f([near, mid, midGlobal, far]), f([mid, midGlobal, far]), f([far])];
    this.all = f([near, mid, midGlobal, far]);
    this.hmax = Math.max(...this.all.map((g) => g.maxHeight), global ? global.maxHeight : -Infinity) + 1;
  }
  surfaceHeight(x: number, y: number): number {
    for (const g of this.all) {
      const h = g.height(x, y);
      if (!Number.isNaN(h)) return h;
    }
    return NaN;
  }
  /** Height at a unit vector: polar grids first, then the global grid. */
  surfaceAtN(n: ArrayLike<number>, x: number, y: number): number {
    const h = this.surfaceHeight(x, y);
    return Number.isNaN(h) && this.global ? this.global.heightN(n[0], n[1], n[2]) : h;
  }
  /** Which grid a point is best served by (for provenance / the "approximate" warning). */
  finestAt(x: number, y: number): Grid | null {
    for (const g of this.all) if (!Number.isNaN(g.height(x, y))) return g;
    return null;
  }
}
