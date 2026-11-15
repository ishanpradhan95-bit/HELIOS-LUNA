import VS from '../shaders/areaFullscreen.vert.glsl?raw';
import FS from '../shaders/poleShade.frag.glsl?raw';

export interface HeightGrid {
  n: number;
  res: number;
  x0: number;
  y0: number;
  data: Float32Array; // metres, row 0 at y0; no-data = -1e5
}
export interface PoleView {
  cx: number;
  cy: number;
  mpp: number; // metres per CSS pixel
}
export type Layer = 0 | 1 | 2; // sunlight, Earth in view, both

interface DemMetaJson {
  scale: number;
  grids: Record<string, { file: string; n: number; res: number; x0: number; y0: number }>;
}
let meta: Promise<DemMetaJson> | null = null;
let cache: Promise<{ mid: HeightGrid; far: HeightGrid }> | null = null;
const local = new Map<string, Promise<HeightGrid>>();

const demMeta = (base: string): Promise<DemMetaJson> =>
  (meta ??= fetch(base + 'dem/dem.json').then((r) => r.json() as Promise<DemMetaJson>));
async function fetchGrid(base: string, key: string): Promise<HeightGrid> {
  const m = await demMeta(base),
    g = m.grids[key];
  const buf = await fetch(base + g.file).then((r) => {
    if (!r.ok) throw new Error(`${g.file}: ${r.status}`);
    return r.arrayBuffer();
  });
  const i16 = new Int16Array(buf),
    f = new Float32Array(i16.length);
  for (let i = 0; i < i16.length; i++) f[i] = i16[i] === -32768 ? -1e5 : i16[i] * m.scale;
  return { n: g.n, res: g.res, x0: g.x0, y0: g.y0, data: f };
}

/** Fetch the 240 m and 480 m polar grids once per page (the browser cache usually already has them). */
export function loadPoleGrids(base: string, onProgress?: (f: number) => void) {
  cache ??= (async () => {
    let done = 0;
    const [mid, far] = await Promise.all(
      ['mid_global', 'far'].map((k) =>
        fetchGrid(base, k).then((g) => {
          onProgress?.(++done / 2);
          return g;
        }),
      ),
    );
    return { mid, far };
  })();
  cache.catch(() => (cache = null));
  return cache;
}

/** Local detail tiles: the finest grid (20 m region tile, or the 40 m pole tile) whose square holds (x, y) with margin. */
export async function localTilesAt(
  base: string,
  x: number,
  y: number,
): Promise<{ key: string; fine: HeightGrid; mid: HeightGrid } | null> {
  const m = await demMeta(base);
  let best: { id: string; res: number; margin: number } | null = null;
  for (const [k, g] of Object.entries(m.grids)) {
    if (!k.endsWith('_near')) continue;
    const half = ((g.n - 1) * g.res) / 2,
      cx = g.x0 + half,
      cy = g.y0 - half,
      margin = half - Math.max(Math.abs(x - cx), Math.abs(y - cy));
    if (margin < 1500) continue;
    if (!best || g.res < best.res || (g.res === best.res && margin > best.margin))
      best = { id: k.slice(0, -5), res: g.res, margin };
  }
  if (!best) return null;
  const get = (k: string) => {
    let p = local.get(k);
    if (!p) {
      p = fetchGrid(base, k);
      p.catch(() => local.delete(k));
      local.set(k, p);
    }
    return p;
  };
  const [fine, mid] = await Promise.all([get(best.id + '_near'), get(best.id + '_mid')]);
  return { key: best.id, fine, mid };
}

function toHalf(f: Float32Array): Uint16Array {
  const out = new Uint16Array(f.length),
    fb = new Float32Array(1),
    ib = new Uint32Array(fb.buffer);
  for (let i = 0; i < f.length; i++) {
    fb[0] = f[i];
    const x = ib[0],
      s = (x >>> 16) & 0x8000,
      e = ((x >>> 23) & 0xff) - 112,
      m = (x >>> 13) & 0x3ff;
    out[i] = e <= 0 ? s : e >= 31 ? s | 0x7bff : s | (e << 10) | m;
  }
  return out;
}

/** WebGL2 renderer for the live south-pole view (ray-marched shadows and Earth visibility on the real terrain). */
export class PoleRenderer {
  private gl: WebGL2RenderingContext;
  private prog: WebGLProgram;
  private tex: WebGLTexture[] = [];
  private u: Record<string, WebGLUniformLocation | null> = {};
  private geo: [number, number, number, number][] = [];

  static supported() {
    try {
      return !!document.createElement('canvas').getContext('webgl2');
    } catch {
      return false;
    }
  }

  constructor(readonly canvas: HTMLCanvasElement) {
    const gl = canvas.getContext('webgl2', { antialias: false, premultipliedAlpha: false });
    if (!gl) throw new Error('WebGL2 is not available');
    this.gl = gl;
    const mk = (type: number, src: string) => {
      const s = gl.createShader(type)!;
      gl.shaderSource(s, src);
      gl.compileShader(s);
      if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) throw new Error(gl.getShaderInfoLog(s) ?? 'shader');
      return s;
    };
    this.prog = gl.createProgram()!;
    gl.attachShader(this.prog, mk(gl.VERTEX_SHADER, VS));
    gl.attachShader(this.prog, mk(gl.FRAGMENT_SHADER, FS));
    gl.linkProgram(this.prog);
    if (!gl.getProgramParameter(this.prog, gl.LINK_STATUS)) throw new Error(gl.getProgramInfoLog(this.prog) ?? 'link');
    for (const n of [
      'uL0',
      'uL1',
      'uL0Geo',
      'uL1Geo',
      'uLocal',
      'uExposure',
      'uMid',
      'uFar',
      'uMidGeo',
      'uFarGeo',
      'uCenter',
      'uSize',
      'uMpp',
      'uSun',
      'uEarth',
      'uSunR',
      'uEarthR',
      'uLayer',
      'uSteps',
    ])
      this.u[n] = gl.getUniformLocation(this.prog, n);
  }

  private makeTex(g: HeightGrid) {
    const gl = this.gl,
      linear = !!gl.getExtension('OES_texture_float_linear'),
      t = gl.createTexture()!;
    gl.bindTexture(gl.TEXTURE_2D, t);
    gl.pixelStorei(gl.UNPACK_ALIGNMENT, 1);
    if (linear) gl.texImage2D(gl.TEXTURE_2D, 0, gl.R32F, g.n, g.n, 0, gl.RED, gl.FLOAT, g.data);
    else gl.texImage2D(gl.TEXTURE_2D, 0, gl.R16F, g.n, g.n, 0, gl.RED, gl.HALF_FLOAT, toHalf(g.data));
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    return t;
  }
  private localKey: string | null = null;
  private localTex: WebGLTexture[] = [];
  private localGeo: [number, number, number, number][] = [];

  upload(mid: HeightGrid, far: HeightGrid) {
    for (const t of this.tex) this.gl.deleteTexture(t);
    this.tex = [mid, far].map((g) => this.makeTex(g));
    this.geo = [mid, far].map((g) => [g.x0, g.y0, g.res, g.n]);
  }
  /** Swap in (or drop, with null) the local high-resolution pair. */
  setLocal(key: string | null, fine?: HeightGrid, mid?: HeightGrid) {
    if (key === this.localKey) return;
    for (const t of this.localTex) this.gl.deleteTexture(t);
    this.localTex = [];
    this.localKey = key;
    if (key && fine && mid) {
      this.localTex = [fine, mid].map((g) => this.makeTex(g));
      this.localGeo = [fine, mid].map((g) => [g.x0, g.y0, g.res, g.n]);
    }
  }
  get local() {
    return this.localKey;
  }

  /** Draw at the canvas's current pixel size. view.mpp is metres per CSS pixel; scale = device pixels per CSS pixel. */
  render(
    view: PoleView,
    scale: number,
    sun: ArrayLike<number>,
    sunR: number,
    earth: ArrayLike<number>,
    earthR: number,
    layer: Layer,
    steps: number,
    exposure = 3.5,
  ) {
    const gl = this.gl,
      U = this.u,
      W = this.canvas.width,
      H = this.canvas.height;
    gl.viewport(0, 0, W, H);
    gl.useProgram(this.prog);
    const hasLocal = this.localTex.length === 2;
    const units = [
      this.tex[0],
      this.tex[1],
      hasLocal ? this.localTex[0] : this.tex[0],
      hasLocal ? this.localTex[1] : this.tex[0],
    ];
    units.forEach((t, i) => {
      gl.activeTexture(gl.TEXTURE0 + i);
      gl.bindTexture(gl.TEXTURE_2D, t);
    });
    gl.uniform1i(U.uMid, 0);
    gl.uniform1i(U.uFar, 1);
    gl.uniform1i(U.uL0, 2);
    gl.uniform1i(U.uL1, 3);
    gl.uniform4f(U.uMidGeo, ...this.geo[0]);
    gl.uniform4f(U.uFarGeo, ...this.geo[1]);
    gl.uniform4f(U.uL0Geo, ...(hasLocal ? this.localGeo[0] : this.geo[0]));
    gl.uniform4f(U.uL1Geo, ...(hasLocal ? this.localGeo[1] : this.geo[0]));
    gl.uniform1i(U.uLocal, hasLocal ? 1 : 0);
    gl.uniform1f(U.uExposure, exposure);
    gl.uniform2f(U.uCenter, view.cx, view.cy);
    gl.uniform2f(U.uSize, W, H);
    gl.uniform1f(U.uMpp, view.mpp / scale);
    gl.uniform3f(U.uSun, sun[0], sun[1], sun[2]);
    gl.uniform3f(U.uEarth, earth[0], earth[1], earth[2]);
    gl.uniform1f(U.uSunR, sunR);
    gl.uniform1f(U.uEarthR, earthR);
    gl.uniform1i(U.uLayer, layer);
    gl.uniform1i(U.uSteps, steps);
    gl.drawArrays(gl.TRIANGLES, 0, 3);
  }

  /** Read one rendered pixel (device coordinates, origin bottom-left); call right after render(). */
  readPixel(x: number, y: number): Uint8Array {
    const px = new Uint8Array(4);
    this.gl.readPixels(Math.round(x), Math.round(y), 1, 1, this.gl.RGBA, this.gl.UNSIGNED_BYTE, px);
    return px;
  }

  dispose() {
    for (const t of [...this.tex, ...this.localTex]) this.gl.deleteTexture(t);
    this.gl.getExtension('WEBGL_lose_context')?.loseContext();
  }
}
