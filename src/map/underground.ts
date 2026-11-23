import { MercatorCoordinate, type CustomLayerInterface, type CustomRenderMethodInput, type Map as MLMap } from 'maplibre-gl';
import {
  FOUNDATION_BOTTOM,
  INLET_X,
  PLANTED,
  SEWER,
  ROOTZONE,
  SIDEWALK,
  STREET,
  SUBSTRATE,
  PAVERS,
  substrateBottom,
  substrateTop,
  surfaceY,
  type LayerId,
} from '../components/section/geometry';
import { fromLocal, nearestOnLines, type LngLatTuple } from './geo';
import { STREET_BEARING, STUDY_CENTER, THERWILERSTRASSE } from '../journey';

/**
 * "Underground" mode: the street section drawn as 3D volumes beneath the real Therwilerstrasse.
 *
 * The block reuses the geometry of the explanatory section (components/section/geometry.ts) and is
 * extruded along the street's real axis (OSM). It is stylised, not a survey: widths are approximate
 * and depths are exaggerated so the thin layers stay readable.
 */

export const DEPTH_EXAGGERATION = 2.2;
/** section units → metres across the street */
const SX = 0.024;
/** section units → metres of depth (exaggerated) */
const SY = 0.022 * DEPTH_EXAGGERATION;
/** section x of the street centre line, put on the OSM street axis */
const STREET_MID_X = (STREET.x0 + STREET.x1) / 2;
const GROUND_Y = 176;
const DEEP_BOTTOM = 380;
/** length of the block along the street (m) */
export const BLOCK_LEN = 38;
const U0 = -BLOCK_LEN / 2;
const U1 = BLOCK_LEN / 2;
/** street trees along the planted strip (m along the street) */
const TREE_U = [U0 + 3.2, U0 + 15, U0 + 27];

/** order in which layers separate when the block is pulled apart (0 stays put) */
const DROP_ORDER: Record<LayerId, number> = { surface: 0, planted: 0, foundation: 1, substrate: 2, rootzone: 3, deep: 4 };

const COLORS: Record<LayerId, [number, number, number, number]> = {
  //            r      g      b    grain
  surface: [0.27, 0.3, 0.35, 0.25],
  foundation: [0.36, 0.34, 0.31, 0.75],
  planted: [0.25, 0.36, 0.22, 0.35],
  substrate: [0.42, 0.34, 0.26, 0.9],
  rootzone: [0.62, 0.47, 0.32, 0.55],
  deep: [0.15, 0.12, 0.1, 0.4],
};

/** where each layer's leader line starts on the cut face (section x, y), and which side its label hangs on */
const LABEL_AT: Record<LayerId, { x: number; y: number; side: 'left' | 'right' }> = {
  surface: { x: 250, y: 172, side: 'left' },
  foundation: { x: 400, y: 212, side: 'left' },
  deep: { x: 470, y: 330, side: 'left' },
  planted: { x: 706, y: 186, side: 'right' },
  substrate: { x: 930, y: 236, side: 'right' },
  rootzone: { x: 740, y: 262, side: 'right' },
};

/* ------------------------------------------------------------------ water-flows view */

export interface FlowStep {
  id: string;
  label: string;
  text: string;
  /** layer to highlight when the step is picked */
  layer: LayerId | null;
  color: string;
  dashed?: boolean;
  /** path on the cut face, section coordinates */
  pts: [number, number][];
}

const along = (x0: number, x1: number, f: (x: number) => number, step = 18): [number, number][] => {
  const o: [number, number][] = [];
  for (let x = x0; x < x1; x += step) o.push([x, f(x)]);
  o.push([x1, f(x1)]);
  return o;
};

export const FLOW_STEPS: FlowStep[] = [
  {
    id: 'runoff',
    label: 'Runs off the sealed street',
    text: 'Rain cannot soak into asphalt. It runs along the street\u2019s slight cross-fall towards the curb.',
    layer: 'surface',
    color: '#5aa8ff',
    pts: [...along(320, 604, (x) => surfaceY(x) - 2), [618, 182], [640, 188]],
  },
  {
    id: 'sewer',
    label: 'Some still goes to the sewer',
    text: 'In heavy rain, part of the runoff reaches the street inlet and the combined sewer, as on a conventional street.',
    layer: null,
    color: '#8d99ad',
    pts: [[INLET_X, 179], [INLET_X, 206], [570, 236], [530, 262], [SEWER.x + 14, SEWER.y - 6]],
  },
  {
    id: 'infiltrate',
    label: 'Soaks into the planted strip',
    text: 'The planted depression collects runoff from the street, so water can soak into the topsoil instead of the drain.',
    layer: 'planted',
    color: '#45dcf0',
    pts: [[652, 190], [672, 194], [690, 200], [694, 212], [690, 226]],
  },
  {
    id: 'pavers',
    label: 'Seeps through permeable paving',
    text: 'In the parking strip, open joints let rain seep through the paving into the substrate below.',
    layer: 'surface',
    color: '#45dcf0',
    pts: [[900, 173], [903, 186], [899, 198], [904, 214]],
  },
  {
    id: 'retain',
    label: 'Is held in the tree substrate',
    text: 'The porous substrate stores water in its pore spaces for a while and releases it slowly.',
    layer: 'substrate',
    color: '#4fb6ff',
    pts: [[700, 236], [748, 244], [800, 238], [852, 246], [906, 236], [950, 244]],
  },
  {
    id: 'roots',
    label: 'Is taken up by roots',
    text: 'Roots draw part of the stored water up into the tree, which cools the street when it evaporates through the leaves.',
    layer: 'rootzone',
    color: '#4ef0a2',
    pts: [[760, 272], [740, 258], [722, 240], [712, 220], [706, 198]],
  },
  {
    id: 'deeper',
    label: 'A little seeps deeper',
    text: 'Where the ground allows, some water seeps further down. How much, and how deep, is uncertain and varies by site.',
    layer: 'deep',
    color: '#b39cff',
    dashed: true,
    pts: [[820, 296], [826, 318], [818, 340], [824, 362]],
  },
];

const LAYER_IDS: LayerId[] = ['surface', 'foundation', 'planted', 'substrate', 'rootzone', 'deep'];

const deepTop = (x: number) => (x < SUBSTRATE.x0 ? FOUNDATION_BOTTOM : x > SUBSTRATE.x1 ? 196 : substrateBottom(x));
const foundationBottom = (x: number) => (x < SUBSTRATE.x0 ? FOUNDATION_BOTTOM : substrateTop(x));
const rootHalf = (x: number) => Math.sqrt(Math.max(0, 1 - ((x - ROOTZONE.cx) / ROOTZONE.rx) ** 2));

const VS = `
attribute vec3 a_pos;
attribute vec3 a_normal;
attribute vec4 a_color;
uniform mat4 u_matrix;
uniform float u_drop;
varying vec3 v_pos;
varying vec3 v_normal;
varying vec4 v_color;
void main() {
  vec3 p = a_pos - vec3(0.0, 0.0, u_drop);
  v_pos = a_pos;
  v_normal = a_normal;
  v_color = a_color;
  gl_Position = u_matrix * vec4(p, 1.0);
}`;

const FS = `
precision mediump float;
varying vec3 v_pos;
varying vec3 v_normal;
varying vec4 v_color;
uniform float u_alpha;
uniform float u_glow;
float hash(vec3 p) { return fract(sin(dot(p, vec3(12.9898, 78.233, 37.719))) * 43758.5453); }
void main() {
  vec3 L = normalize(vec3(-0.35, -0.55, 0.75));
  float d = abs(dot(normalize(v_normal), L));
  float light = 0.42 + 0.58 * d;
  // stony grain on every face: coarse cells, a few bright stones
  float g = hash(floor(v_pos * 3.2));
  float grain = mix(1.0, 0.72 + 0.5 * g, v_color.a);
  vec3 c = v_color.rgb * light * grain;
  c += u_glow * vec3(0.18, 0.55, 0.65);
  gl_FragColor = vec4(c * u_alpha, u_alpha);
}`;

const VS_P = `
attribute vec3 a_pos;
uniform mat4 u_matrix;
uniform float u_size;
void main() {
  gl_Position = u_matrix * vec4(a_pos, 1.0);
  gl_PointSize = u_size;
}`;
const FS_P = `
precision mediump float;
uniform float u_alpha;
void main() {
  vec2 q = gl_PointCoord - 0.5;
  float r = length(q);
  if (r > 0.5) discard;
  float a = smoothstep(0.5, 0.15, r) * u_alpha;
  gl_FragColor = vec4(vec3(0.55, 0.85, 1.0) * a, a);
}`;

const VS_Q = `
attribute vec2 a_pos;
void main() { gl_Position = vec4(a_pos, 0.0, 1.0); }`;
const FS_Q = `
precision mediump float;
uniform float u_alpha;
void main() { gl_FragColor = vec4(vec3(0.016, 0.027, 0.05) * u_alpha, u_alpha); }`;

interface Range {
  first: number;
  count: number;
}

interface Drop {
  x: number; // section x
  y: number; // section y
  u: number; // metres along the street
  stopY: number;
  run: boolean; // still running over the sealed street toward the curb
}

function compile(gl: WebGLRenderingContext, vs: string, fs: string) {
  const sh = (type: number, src: string) => {
    const s = gl.createShader(type)!;
    gl.shaderSource(s, src);
    gl.compileShader(s);
    if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) throw new Error(gl.getShaderInfoLog(s) ?? 'shader');
    return s;
  };
  const p = gl.createProgram()!;
  gl.attachShader(p, sh(gl.VERTEX_SHADER, vs));
  gl.attachShader(p, sh(gl.FRAGMENT_SHADER, fs));
  gl.linkProgram(p);
  if (!gl.getProgramParameter(p, gl.LINK_STATUS)) throw new Error(gl.getProgramInfoLog(p) ?? 'link');
  return p;
}

/** column-major 4×4 multiply in float64 (keeps precision before handing a float32 matrix to the GPU) */
function mul(a: ArrayLike<number>, b: ArrayLike<number>): Float64Array {
  const o = new Float64Array(16);
  for (let c = 0; c < 4; c++)
    for (let r = 0; r < 4; r++) {
      let s = 0;
      for (let k = 0; k < 4; k++) s += a[k * 4 + r] * b[c * 4 + k];
      o[c * 4 + r] = s;
    }
  return o;
}

export interface UndergroundOptions {
  /** container for HTML labels; one child per layer with data-layer="<id>" */
  labels?: HTMLElement | null;
}

export class UndergroundLayer implements CustomLayerInterface {
  id = 'underground';
  type = 'custom' as const;
  renderingMode = '3d' as const;

  /** block origin on the real street axis */
  readonly origin: LngLatTuple;
  private ux: number;
  private uy: number;
  private map!: MLMap;
  private gl!: WebGLRenderingContext;
  private prog!: WebGLProgram;
  private progP!: WebGLProgram;
  private buf!: WebGLBuffer;
  private bufP!: WebGLBuffer;
  private progQ!: WebGLProgram;
  private bufQ!: WebGLBuffer;
  private ranges = new Map<LayerId, Range>();
  private pipe: Range = { first: 0, count: 0 };
  /** 'map': the block in its street · 'flows': map dimmed, layers see-through, water paths drawn */
  view: 'map' | 'flows' = 'map';
  private dim = 0;
  flowSvg: SVGSVGElement | null = null;
  private drops: Drop[] = [];
  private last = 0;

  focus: LayerId | null = null;
  /** 0 = layers together, 1 = pulled apart */
  explodeTarget = 0;
  private explode = 0;
  water = true;
  labels: HTMLElement | null = null;

  constructor(opts: UndergroundOptions = {}) {
    this.labels = opts.labels ?? null;
    const near = nearestOnLines(STUDY_CENTER, [THERWILERSTRASSE]);
    this.origin = near ? near.point : STUDY_CENTER;
    const b = (STREET_BEARING * Math.PI) / 180;
    this.ux = Math.sin(b); // along the street, east component
    this.uy = Math.cos(b); // along the street, north component
  }

  /** section (x, y) + metres along the street → local metres (east, north, up) */
  private local(x: number, y: number, u: number): [number, number, number] {
    const v = (x - STREET_MID_X) * SX;
    // across-street axis is the along-street axis turned 90° clockwise
    return [u * this.ux + v * this.uy, u * this.uy - v * this.ux, -(y - GROUND_Y) * SY];
  }

  private build(): Float32Array {
    const out: number[] = [];
    const push = (p: [number, number, number][], n: [number, number, number], c: [number, number, number, number]) => {
      for (const v of p) out.push(v[0], v[1], v[2], n[0], n[1], n[2], c[0], c[1], c[2], c[3]);
    };
    const tri = (a: [number, number, number], b: [number, number, number], c: [number, number, number], col: [number, number, number, number]) => {
      const e1 = [b[0] - a[0], b[1] - a[1], b[2] - a[2]];
      const e2 = [c[0] - a[0], c[1] - a[1], c[2] - a[2]];
      const n: [number, number, number] = [e1[1] * e2[2] - e1[2] * e2[1], e1[2] * e2[0] - e1[0] * e2[2], e1[0] * e2[1] - e1[1] * e2[0]];
      const l = Math.hypot(...n) || 1;
      push([a, b, c], [n[0] / l, n[1] / l, n[2] / l], col);
    };
    const quad = (a: [number, number, number], b: [number, number, number], c: [number, number, number], d: [number, number, number], col: [number, number, number, number]) => {
      tri(a, b, c, col);
      tri(a, c, d, col);
    };
    /** a section band between top(x) and bottom(x), extruded from u0 to u1 */
    const prism = (x0: number, x1: number, top: (x: number) => number, bot: (x: number) => number, u0: number, u1: number, col: [number, number, number, number]) => {
      const xs: number[] = [];
      for (let x = x0; x < x1; x += 8) xs.push(x);
      xs.push(x1);
      for (let i = 0; i < xs.length - 1; i++) {
        const a = xs[i], b = xs[i + 1];
        const [ta, tb, ba, bb] = [top(a), top(b), bot(a), bot(b)];
        if (ba - ta < 0.2 && bb - tb < 0.2) continue;
        quad(this.local(a, ta, u0), this.local(b, tb, u0), this.local(b, tb, u1), this.local(a, ta, u1), col); // top
        quad(this.local(a, ba, u0), this.local(b, bb, u0), this.local(b, bb, u1), this.local(a, ba, u1), col); // bottom
        quad(this.local(a, ta, u0), this.local(b, tb, u0), this.local(b, bb, u0), this.local(a, ba, u0), col); // front cut face
        quad(this.local(a, ta, u1), this.local(b, tb, u1), this.local(b, bb, u1), this.local(a, ba, u1), col); // back cut face
      }
      for (const x of [x0, x1]) quad(this.local(x, top(x), u0), this.local(x, top(x), u1), this.local(x, bot(x), u1), this.local(x, bot(x), u0), col);
    };
    const box = (x: number, halfX: number, u: number, halfU: number, y0: number, y1: number, col: [number, number, number, number]) =>
      prism(x - halfX, x + halfX, () => y0, () => y1, u - halfU, u + halfU, col);

    const start = (id: LayerId) => {
      const first = out.length / 10;
      return () => this.ranges.set(id, { first, count: out.length / 10 - first });
    };

    let end = start('surface');
    prism(SIDEWALK.x0, STREET.x1, surfaceY, (x) => surfaceY(x) + 5, U0, U1, COLORS.surface);
    prism(PAVERS.x0, PAVERS.x1, () => GROUND_Y, () => 194, U0, U1, [0.38, 0.38, 0.4, 0.55]);
    end();

    end = start('foundation');
    prism(SIDEWALK.x0, PLANTED.x0, (x) => surfaceY(x) + 5, foundationBottom, U0, U1, COLORS.foundation);
    end();

    end = start('planted');
    prism(PLANTED.x0, PLANTED.x1, surfaceY, (x) => surfaceY(x) + 22, U0, U1, COLORS.planted);
    // short trunk stubs, so the roots below have something to belong to
    for (const u of TREE_U) {
      const base = surfaceY(PLANTED.low);
      box(PLANTED.low, 7, u, 0.22, base - 38, base, [0.34, 0.24, 0.15, 0.2]);
    }
    end();

    end = start('substrate');
    prism(SUBSTRATE.x0, SUBSTRATE.x1, substrateTop, substrateBottom, U0, U1, COLORS.substrate);
    end();

    end = start('rootzone');
    for (const [i, u] of TREE_U.entries()) {
      // the first tree's roots reach the front cut face so they can be seen without pulling the block apart
      const u0 = i === 0 ? U0 - 0.06 : u - 3.6;
      prism(
        ROOTZONE.cx - ROOTZONE.rx,
        ROOTZONE.cx + ROOTZONE.rx,
        (x) => Math.max(ROOTZONE.cy - ROOTZONE.ry * rootHalf(x), substrateTop(x) + 1),
        (x) => Math.min(ROOTZONE.cy + ROOTZONE.ry * rootHalf(x), substrateBottom(x) - 1),
        u0,
        u + 3.6,
        COLORS.rootzone,
      );
    }
    end();

    end = start('deep');
    prism(SIDEWALK.x0, PAVERS.x1, deepTop, () => DEEP_BOTTOM, U0, U1, COLORS.deep);
    end();

    // combined sewer under the street + the inlet shaft (shown in the water-flows view)
    const pf = out.length / 10;
    const half = (x: number) => Math.sqrt(Math.max(0, 1 - ((x - SEWER.x) / SEWER.r) ** 2)) * SEWER.r;
    prism(SEWER.x - SEWER.r, SEWER.x + SEWER.r, (x) => SEWER.y - half(x), (x) => SEWER.y + half(x), U0 - 0.08, U1, [0.5, 0.55, 0.62, 0.15]);
    box(INLET_X, 6, U0 + 1.2, 0.3, 178, 214, [0.45, 0.5, 0.56, 0.15]);
    this.pipe = { first: pf, count: out.length / 10 - pf };

    return new Float32Array(out);
  }

  onAdd(map: MLMap, gl: WebGLRenderingContext | WebGL2RenderingContext) {
    this.map = map;
    this.gl = gl as WebGLRenderingContext;
    this.prog = compile(this.gl, VS, FS);
    this.progP = compile(this.gl, VS_P, FS_P);
    this.buf = gl.createBuffer()!;
    gl.bindBuffer(gl.ARRAY_BUFFER, this.buf);
    gl.bufferData(gl.ARRAY_BUFFER, this.build(), gl.STATIC_DRAW);
    this.bufP = gl.createBuffer()!;
    this.progQ = compile(this.gl, VS_Q, FS_Q);
    this.bufQ = gl.createBuffer()!;
    gl.bindBuffer(gl.ARRAY_BUFFER, this.bufQ);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 1, -1, 1, 1, -1, -1, 1, 1, -1, 1]), gl.STATIC_DRAW);
    this.last = performance.now();
  }

  onRemove() {
    const gl = this.gl;
    gl.deleteBuffer(this.buf);
    gl.deleteBuffer(this.bufP);
    gl.deleteBuffer(this.bufQ);
    gl.deleteProgram(this.progQ);
    gl.deleteProgram(this.prog);
    gl.deleteProgram(this.progP);
  }

  /** extra depth (m) a layer is lowered by when the block is pulled apart */
  private dropOf(id: LayerId) {
    return DROP_ORDER[id] * 3.2 * this.explode;
  }

  /** which layer a section point is in (for the water drops) */
  private layerAt(x: number, y: number): LayerId {
    if (x >= PLANTED.x0 && x <= PLANTED.x1 && y < surfaceY(x) + 22) return 'planted';
    if (x >= SUBSTRATE.x0 && x <= SUBSTRATE.x1 && y >= substrateTop(x) && y <= substrateBottom(x)) return 'substrate';
    if (x >= PAVERS.x0 && y < 194) return 'surface';
    if (y < GROUND_Y + 6) return 'surface';
    return 'deep';
  }

  private stepWater(dt: number) {
    const target = 240;
    while (this.drops.length < target) this.drops.push(this.spawn());
    for (let i = 0; i < this.drops.length; i++) {
      const d = this.drops[i];
      if (d.run) {
        // runoff over the sealed street towards the curb, then into the planted depression
        d.x += 95 * dt;
        d.y = surfaceY(d.x) - 1;
        if (d.x >= PLANTED.x0 + 6) d.run = false;
        continue;
      }
      const layer = this.layerAt(d.x, d.y);
      const speed = layer === 'planted' ? 40 : layer === 'substrate' ? 16 : layer === 'surface' ? 30 : 6;
      d.y += speed * dt;
      d.x += Math.sin(d.y * 0.21 + d.u) * 6 * dt;
      if (d.y > d.stopY) this.drops[i] = this.spawn();
    }
  }

  private spawn(): Drop {
    const r = Math.random();
    const u = U0 + 0.3 + Math.random() * (BLOCK_LEN - 0.6);
    if (r < 0.3) return { x: STREET.x0 + Math.random() * (STREET.x1 - STREET.x0), y: 0, u, run: true, ...this.stop(PLANTED.low) };
    const x = r < 0.75 ? PLANTED.x0 + 8 + Math.random() * (PLANTED.x1 - PLANTED.x0 - 16) : PAVERS.x0 + 6 + Math.random() * (SUBSTRATE.x1 - PAVERS.x0 - 12);
    return { x, y: surfaceY(x) - 2, u, run: false, ...this.stop(x) };
  }

  /** most water is held in the substrate; a little seeps deeper */
  private stop(x: number) {
    const deep = Math.random() < 0.18;
    const bottom = substrateBottom(x);
    return { stopY: deep ? bottom + 15 + Math.random() * 45 : substrateTop(x) + Math.random() * (bottom - substrateTop(x)) };
  }

  render(gl: WebGLRenderingContext | WebGL2RenderingContext, args: CustomRenderMethodInput) {
    const now = performance.now();
    const dt = Math.min(0.05, (now - this.last) / 1000);
    this.last = now;
    this.explode += (this.explodeTarget - this.explode) * Math.min(1, dt * 4);

    const mc = MercatorCoordinate.fromLngLat(this.origin, 0);
    const s = mc.meterInMercatorCoordinateUnits();
    // local metres (east, north, up) → mercator (x right, y down, z up)
    const model = [s, 0, 0, 0, 0, -s, 0, 0, 0, 0, s, 0, mc.x, mc.y, 0, 1];
    const m64 = mul(args.defaultProjectionData.mainMatrix as ArrayLike<number>, model);
    const matrix = new Float32Array(m64);

    gl.enable(gl.DEPTH_TEST);
    gl.depthFunc(gl.LEQUAL);
    gl.enable(gl.BLEND);
    gl.blendFunc(gl.ONE, gl.ONE_MINUS_SRC_ALPHA);
    gl.disable(gl.CULL_FACE);

    // water-flows view: darken the city behind the block
    this.dim += ((this.view === 'flows' ? 0.62 : 0) - this.dim) * Math.min(1, dt * 4);
    if (this.dim > 0.01) {
      gl.useProgram(this.progQ);
      gl.bindBuffer(gl.ARRAY_BUFFER, this.bufQ);
      const aq = gl.getAttribLocation(this.progQ, 'a_pos');
      gl.enableVertexAttribArray(aq);
      gl.vertexAttribPointer(aq, 2, gl.FLOAT, false, 8, 0);
      gl.uniform1f(gl.getUniformLocation(this.progQ, 'u_alpha'), this.dim);
      gl.disable(gl.DEPTH_TEST);
      gl.depthMask(false);
      gl.drawArrays(gl.TRIANGLES, 0, 6);
      gl.enable(gl.DEPTH_TEST);
      gl.depthMask(true);
    }

    gl.useProgram(this.prog);
    gl.bindBuffer(gl.ARRAY_BUFFER, this.buf);
    const loc = (n: string) => gl.getAttribLocation(this.prog, n);
    const stride = 10 * 4;
    const aPos = loc('a_pos'), aN = loc('a_normal'), aC = loc('a_color');
    gl.enableVertexAttribArray(aPos);
    gl.vertexAttribPointer(aPos, 3, gl.FLOAT, false, stride, 0);
    gl.enableVertexAttribArray(aN);
    gl.vertexAttribPointer(aN, 3, gl.FLOAT, false, stride, 12);
    gl.enableVertexAttribArray(aC);
    gl.vertexAttribPointer(aC, 4, gl.FLOAT, false, stride, 24);
    gl.uniformMatrix4fv(gl.getUniformLocation(this.prog, 'u_matrix'), false, matrix);
    const uDrop = gl.getUniformLocation(this.prog, 'u_drop');
    const uAlpha = gl.getUniformLocation(this.prog, 'u_alpha');
    const uGlow = gl.getUniformLocation(this.prog, 'u_glow');
    const pulse = 0.5 + 0.5 * Math.sin(now / 420);

    const draw = (id: LayerId, alpha: number, glow: number) => {
      const r = this.ranges.get(id);
      if (!r) return;
      gl.uniform1f(uDrop, this.dropOf(id));
      gl.uniform1f(uAlpha, alpha);
      gl.uniform1f(uGlow, glow);
      gl.drawArrays(gl.TRIANGLES, r.first, r.count);
    };
    // the sewer is solid; it only shows in the flows view (elsewhere it is hidden inside the ground)
    const flows = this.view === 'flows';
    if (flows) {
      gl.uniform1f(uDrop, 0);
      gl.uniform1f(uAlpha, 1);
      gl.uniform1f(uGlow, 0);
      gl.depthMask(true);
      gl.drawArrays(gl.TRIANGLES, this.pipe.first, this.pipe.count);
    }
    // opaque first (with depth), then see-through layers without writing depth
    const solid = flows ? [] : LAYER_IDS.filter((id) => !this.focus || id === this.focus);
    const ghost = LAYER_IDS.filter((id) => !solid.includes(id));
    gl.depthMask(true);
    for (const id of solid) draw(id, 1, id === this.focus ? 0.12 + 0.12 * pulse : 0);
    gl.depthMask(false);
    for (const id of ghost) {
      const a = flows ? (this.focus ? (id === this.focus ? 0.55 : 0.12) : 0.26) : 0.16;
      draw(id, a, flows && id === this.focus ? 0.1 + 0.1 * pulse : 0);
    }
    gl.disableVertexAttribArray(aN);
    gl.disableVertexAttribArray(aC);

    // water drops
    if (this.water) {
      this.stepWater(dt);
      const pts = new Float32Array(this.drops.length * 3);
      this.drops.forEach((d, i) => {
        const p = this.local(d.x, d.y, d.u);
        pts[i * 3] = p[0];
        pts[i * 3 + 1] = p[1];
        pts[i * 3 + 2] = p[2] - this.dropOf(d.run ? 'surface' : this.layerAt(d.x, d.y)) + 0.05;
      });
      gl.useProgram(this.progP);
      gl.bindBuffer(gl.ARRAY_BUFFER, this.bufP);
      gl.bufferData(gl.ARRAY_BUFFER, pts, gl.DYNAMIC_DRAW);
      const ap = gl.getAttribLocation(this.progP, 'a_pos');
      gl.enableVertexAttribArray(ap);
      gl.vertexAttribPointer(ap, 3, gl.FLOAT, false, 12, 0);
      gl.uniformMatrix4fv(gl.getUniformLocation(this.progP, 'u_matrix'), false, matrix);
      gl.uniform1f(gl.getUniformLocation(this.progP, 'u_size'), Math.max(2, 5.5 * window.devicePixelRatio * 2 ** (this.map.getZoom() - 19.5)));
      gl.uniform1f(gl.getUniformLocation(this.progP, 'u_alpha'), 0.9);
      // drops show through the soil they are moving in
      gl.disable(gl.DEPTH_TEST);
      gl.drawArrays(gl.POINTS, 0, this.drops.length);
      gl.enable(gl.DEPTH_TEST);
    }
    gl.depthMask(true);

    this.placeLabels(m64);
    this.placeFlows(m64);
    this.map.triggerRepaint();
  }

  /** section point on the front cut face → screen pixels (follows the pulled-apart layers) */
  private screenOf(m: Float64Array, x: number, y: number, drop: number): [number, number] | null {
    const canvas = this.map.getCanvas();
    const p = this.local(x, y, U0 - 0.1);
    p[2] -= drop;
    const cx = m[0] * p[0] + m[4] * p[1] + m[8] * p[2] + m[12];
    const cy = m[1] * p[0] + m[5] * p[1] + m[9] * p[2] + m[13];
    const cw = m[3] * p[0] + m[7] * p[1] + m[11] * p[2] + m[15];
    if (cw <= 0) return null;
    return [(cx / cw * 0.5 + 0.5) * canvas.clientWidth, (1 - (cy / cw * 0.5 + 0.5)) * canvas.clientHeight];
  }

  /** draw the water paths of the flows view onto the cut face */
  private placeFlows(m: Float64Array) {
    const svg = this.flowSvg;
    if (!svg || this.view !== 'flows') return;
    for (const step of FLOW_STEPS) {
      const g = svg.querySelector<SVGGElement>(`[data-flow="${step.id}"]`);
      if (!g) continue;
      const pts = step.pts.map(([x, y]) => this.screenOf(m, x, y, this.dropOf(step.id === 'runoff' || step.id === 'sewer' ? 'surface' : this.layerAt(x, y))));
      if (pts.some((p) => !p)) {
        g.style.visibility = 'hidden';
        continue;
      }
      g.style.visibility = 'visible';
      const d = 'M' + (pts as [number, number][]).map((p) => `${p[0].toFixed(1)} ${p[1].toFixed(1)}`).join(' L');
      g.querySelectorAll('path').forEach((path) => path.setAttribute('d', d));
      const mid = pts[Math.floor(pts.length / 2)] as [number, number];
      g.querySelector('.ug__badge')?.setAttribute('transform', `translate(${mid[0].toFixed(1)} ${mid[1].toFixed(1)})`);
    }
  }

  /** keep the HTML labels next to the cut face, with leader lines to their layer */
  private placeLabels(m: Float64Array) {
    if (!this.labels) return;
    const canvas = this.map.getCanvas();
    const w = canvas.clientWidth, h = canvas.clientHeight;
    const project = (x: number, y: number, drop: number): [number, number] | null => {
      const p = this.local(x, y, U0);
      p[2] -= drop;
      const cx = m[0] * p[0] + m[4] * p[1] + m[8] * p[2] + m[12];
      const cy = m[1] * p[0] + m[5] * p[1] + m[9] * p[2] + m[13];
      const cw = m[3] * p[0] + m[7] * p[1] + m[11] * p[2] + m[15];
      if (cw <= 0) return null;
      return [(cx / cw * 0.5 + 0.5) * w, (1 - (cy / cw * 0.5 + 0.5)) * h];
    };
    const placed: { id: LayerId; side: 'left' | 'right'; a: [number, number]; l: [number, number] }[] = [];
    for (const id of LAYER_IDS) {
      const at = LABEL_AT[id];
      const drop = this.dropOf(id);
      const a = project(at.x, at.y, drop);
      const e = project(at.side === 'left' ? SIDEWALK.x0 : PAVERS.x1, at.y, drop);
      if (!a || !e) continue;
      placed.push({ id, side: at.side, a, l: [e[0] + (at.side === 'left' ? -22 : 22), e[1]] });
    }
    // keep labels on each side at least one tag-height apart
    for (const side of ['left', 'right'] as const) {
      const col = placed.filter((p) => p.side === side).sort((a, b) => a.l[1] - b.l[1]);
      for (let i = 1; i < col.length; i++) col[i].l[1] = Math.max(col[i].l[1], col[i - 1].l[1] + 30);
      const xs = col.map((p) => p.l[0]);
      for (const p of col) p.l[0] = side === 'left' ? Math.min(...xs) : Math.max(...xs);
    }
    const byId = new Map(placed.map((p) => [p.id, p]));
    for (const el of Array.from(this.labels.querySelectorAll<HTMLElement | SVGElement>('[data-layer]'))) {
      const p = byId.get(el.dataset.layer as LayerId);
      if (!p) {
        el.style.visibility = 'hidden';
        continue;
      }
      el.style.visibility = 'visible';
      if (el instanceof SVGElement) {
        const [line, dot] = Array.from(el.children) as SVGElement[];
        line.setAttribute('x1', p.a[0].toFixed(1));
        line.setAttribute('y1', p.a[1].toFixed(1));
        line.setAttribute('x2', p.l[0].toFixed(1));
        line.setAttribute('y2', p.l[1].toFixed(1));
        dot.setAttribute('cx', p.a[0].toFixed(1));
        dot.setAttribute('cy', p.a[1].toFixed(1));
      } else {
        el.style.transform = `translate(${p.l[0].toFixed(1)}px, ${p.l[1].toFixed(1)}px) translate(${p.side === 'left' ? '-100%' : '0'}, -50%)`;
      }
    }
  }

  /** the point the camera should look at: a little in front of the block's centre */
  /** for the water-flows view: a ground point just in front of the cut face, so the face sits mid-screen */
  lookAtFace(): LngLatTuple {
    const [e, n] = this.local(STREET_MID_X + 190, GROUND_Y, U0 - 9);
    return fromLocal([e, n], this.origin);
  }

  lookAt(): LngLatTuple {
    const [e, n] = this.local(STREET_MID_X + 150, GROUND_Y + 60, U0 + 6);
    return fromLocal([e, n], this.origin);
  }
}
