/**
 * Area engine (architecture doc 6.7): one fragment-shader pass over a region's 128x128 cell grid. For every pixel it loops the
 * mission window's time steps, looks up the Sun and Earth horizons in 3D textures (the baked atlas), and accumulates
 *   R = mean sunlit fraction   G = mean Earth-centre-visible fraction   B = mean (lit AND Earth visible)   A = longest dark run / window
 * into an RGBA8 target (1/255 quantisation). Eclipses and station-resolved passes are point-engine-only (maps use "Earth centre above horizon").
 */

import VS from '../shaders/areaFullscreen.vert.glsl?raw';
import FS from '../shaders/areaIntegration.frag.glsl?raw';
export interface AtlasMeta {
  region: string;
  cells: number;
  res: number;
  cx: number;
  cy: number;
  heights: number[];
  nAz: number;
  nBins: number;
  earthStep: number;
  sunRange: [number, number];
  earthRange: [number, number];
  bytes: number;
  layout: { sun2: number; sun10: number; earth2: number; earth10: number; earthAz0: number; height: number };
}
export interface Atlas {
  meta: AtlasMeta;
  heights: Int16Array;
}

export class AreaEngine {
  private gl: WebGL2RenderingContext;
  private prog: WebGLProgram;
  private fbo: WebGLFramebuffer;
  private target: WebGLTexture;
  private tex: WebGLTexture[] = [];
  private timeTex: WebGLTexture;
  private meta: AtlasMeta | null = null;
  readonly canvas: HTMLCanvasElement;
  private u: Record<string, WebGLUniformLocation | null> = {};
  static supported() {
    try {
      return !!document.createElement('canvas').getContext('webgl2');
    } catch {
      return false;
    }
  }

  constructor() {
    this.canvas = document.createElement('canvas');
    this.canvas.width = this.canvas.height = 128;
    const gl = this.canvas.getContext('webgl2', { antialias: false, preserveDrawingBuffer: true });
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
      'uSun2',
      'uSun10',
      'uE2',
      'uE10',
      'uEarthAz0',
      'uTime',
      'uN',
      'uCenter',
      'uRes',
      'uCells',
      'uZ',
      'uLit',
      'uEarthStep',
      'uBins',
      'uSunRange',
      'uEarthRange',
    ])
      this.u[n] = gl.getUniformLocation(this.prog, n);
    this.target = gl.createTexture()!;
    gl.bindTexture(gl.TEXTURE_2D, this.target);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA8, 128, 128, 0, gl.RGBA, gl.UNSIGNED_BYTE, null);
    this.fbo = gl.createFramebuffer()!;
    gl.bindFramebuffer(gl.FRAMEBUFFER, this.fbo);
    gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, this.target, 0);
    this.timeTex = gl.createTexture()!;
  }

  private tex3d(data: Uint8Array, w: number, h: number, d: number, azWrap: boolean) {
    const gl = this.gl,
      t = gl.createTexture()!;
    gl.bindTexture(gl.TEXTURE_3D, t);
    gl.pixelStorei(gl.UNPACK_ALIGNMENT, 1);
    gl.texImage3D(gl.TEXTURE_3D, 0, gl.R8, w, h, d, 0, gl.RED, gl.UNSIGNED_BYTE, data);
    gl.texParameteri(gl.TEXTURE_3D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_3D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_3D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_3D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_3D, gl.TEXTURE_WRAP_R, azWrap ? gl.REPEAT : gl.CLAMP_TO_EDGE);
    return t;
  }

  /** Upload one region's atlas to the GPU. */
  async load(base: string, regionId: string): Promise<Atlas> {
    const [meta, buf] = await Promise.all([
      fetch(`${base}atlas/${regionId}.json`).then((r) => r.json() as Promise<AtlasMeta>),
      fetch(`${base}atlas/${regionId}.bin`).then((r) => r.arrayBuffer()),
    ]);
    const gl = this.gl,
      C = meta.cells,
      L = meta.layout,
      all = new Uint8Array(buf);
    for (const t of this.tex) gl.deleteTexture(t);
    const sunLen = meta.nAz * C * C,
      eLen = meta.nBins * C * C;
    this.tex = [
      this.tex3d(all.subarray(L.sun2, L.sun2 + sunLen), C, C, meta.nAz, true),
      this.tex3d(all.subarray(L.sun10, L.sun10 + sunLen), C, C, meta.nAz, true),
      this.tex3d(all.subarray(L.earth2, L.earth2 + eLen), C, C, meta.nBins, false),
      this.tex3d(all.subarray(L.earth10, L.earth10 + eLen), C, C, meta.nBins, false),
    ];
    const az = new Float32Array(buf.slice(L.earthAz0, L.earthAz0 + C * C * 4));
    const t = gl.createTexture()!;
    gl.bindTexture(gl.TEXTURE_2D, t);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.R32F, C, C, 0, gl.RED, gl.FLOAT, az);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
    this.tex.push(t);
    this.meta = meta;
    return { meta, heights: new Int16Array(buf.slice(L.height, L.height + C * C * 2)) };
  }

  /** Integrate the window. bodies = Float32 x 8 per step from Engine.bodies(). Returns RGBA8 [row][col] (row 0 = +y edge). */
  compute(bodies: Float32Array, z: number, litThreshold: number): Uint8Array {
    const m = this.meta!,
      gl = this.gl,
      n = Math.min(bodies.length / 8, 4096);
    const tex = new Float32Array(2048 * 4 * 4); // 2048 wide x 4 rows x RGBA
    tex.set(bodies.subarray(0, n * 8));
    gl.bindTexture(gl.TEXTURE_2D, this.timeTex);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA32F, 2048, 4, 0, gl.RGBA, gl.FLOAT, tex);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
    gl.bindFramebuffer(gl.FRAMEBUFFER, this.fbo);
    gl.viewport(0, 0, 128, 128);
    gl.useProgram(this.prog);
    [this.tex[0], this.tex[1], this.tex[2], this.tex[3]].forEach((t, i) => {
      gl.activeTexture(gl.TEXTURE0 + i);
      gl.bindTexture(gl.TEXTURE_3D, t);
    });
    gl.activeTexture(gl.TEXTURE4);
    gl.bindTexture(gl.TEXTURE_2D, this.tex[4]);
    gl.activeTexture(gl.TEXTURE5);
    gl.bindTexture(gl.TEXTURE_2D, this.timeTex);
    const U = this.u;
    gl.uniform1i(U.uSun2, 0);
    gl.uniform1i(U.uSun10, 1);
    gl.uniform1i(U.uE2, 2);
    gl.uniform1i(U.uE10, 3);
    gl.uniform1i(U.uEarthAz0, 4);
    gl.uniform1i(U.uTime, 5);
    gl.uniform1i(U.uN, n);
    gl.uniform2f(U.uCenter, m.cx, m.cy);
    gl.uniform1f(U.uRes, m.res);
    gl.uniform1f(U.uCells, m.cells);
    gl.uniform1f(U.uZ, z);
    gl.uniform1f(U.uLit, litThreshold);
    gl.uniform1f(U.uEarthStep, m.earthStep);
    gl.uniform1f(U.uBins, m.nBins);
    gl.uniform2f(U.uSunRange, m.sunRange[0], m.sunRange[1]);
    gl.uniform2f(U.uEarthRange, m.earthRange[0], m.earthRange[1]);
    gl.drawArrays(gl.TRIANGLES, 0, 3);
    const out = new Uint8Array(128 * 128 * 4);
    gl.readPixels(0, 0, 128, 128, gl.RGBA, gl.UNSIGNED_BYTE, out);
    return out;
  }
}
