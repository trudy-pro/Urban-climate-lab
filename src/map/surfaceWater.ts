import { getTheme } from '../theme';
import {
  MercatorCoordinate,
  type CustomLayerInterface,
  type CustomRenderMethodInput,
  type FilterSpecification,
  type Map as MLMap,
  type MapMovementEvent,
  type MapSourceDataEvent,
  type GeoJSONFeature,
} from 'maplibre-gl';
import type { Position } from 'geojson';
import { toLocal, type LngLatTuple } from './geo';

/**
 * ILLUSTRATIVE surface runoff for "Stimulate water" (not a flood or hydraulic model).
 *
 * The water is drawn as ground-level ribbons along the real street network (OpenStreetMap):
 *  - which way it runs comes from a terrain model (Terrarium elevation tiles, AWS Open Data),
 *  - how much collects is a simple flow accumulation over the street graph (each street collects
 *    the rain on its own length and passes it to its lowest neighbour), so streams merge downhill,
 *  - it ponds at low points of the street graph and soaks in where streets reach parks and green areas.
 * A GLSL shader turns the ribbons into shallow, translucent, slowly flowing water; buildings are drawn
 * after it, so water always stays on the ground and runs around them.
 */

/** per rain level: Gentle / Moderate / Heavy */
const COVER = [0.42, 0.72, 1];
const SPEED = [0.45, 0.9, 1.7];
const POOL = [0.35, 0.7, 1];

/** half-width (m) of the paved surface each street class can carry water on */
const HALF_WIDTH: Record<string, number> = {
  motorway: 10, trunk: 9, primary: 8, secondary: 7, tertiary: 6, minor: 4.6, service: 3, track: 2, path: 1.3,
};
const CLASSES = Object.keys(HALF_WIDTH);
const STREETS: FilterSpecification = [
  'all',
  ['in', ['geometry-type'], ['literal', ['LineString', 'MultiLineString']]],
  ['in', ['get', 'class'], ['literal', CLASSES]],
  ['!=', ['get', 'brunnel'], 'tunnel'],
];
const GREEN_LAYERS: { sourceLayer: string; filter?: FilterSpecification }[] = [
  { sourceLayer: 'park' },
  { sourceLayer: 'landcover', filter: ['in', ['get', 'class'], ['literal', ['grass', 'wood', 'farmland', 'wetland']]] },
  { sourceLayer: 'landuse', filter: ['in', ['get', 'class'], ['literal', ['cemetery', 'pitch', 'playground', 'garden']]] },
];

/** accumulated street length (m) that counts as a "full" stream */
const ACC_REF = 6000;
const MAX_NODES = 90000;

/* ------------------------------------------------------------------ elevation (Terrarium) */

const DEM_URL = (z: number, x: number, y: number) => `https://s3.amazonaws.com/elevation-tiles-prod/terrarium/${z}/${x}/${y}.png`;
const demCache = new Map<string, Promise<Float32Array | null>>();

function loadDem(z: number, x: number, y: number) {
  const key = `${z}/${x}/${y}`;
  let p = demCache.get(key);
  if (!p) {
    p = fetch(DEM_URL(z, x, y))
      .then((r) => (r.ok ? r.blob() : Promise.reject(new Error(String(r.status)))))
      .then((b) => createImageBitmap(b))
      .then((img) => {
        const c = document.createElement('canvas');
        c.width = c.height = 256;
        const ctx = c.getContext('2d', { willReadFrequently: true })!;
        ctx.drawImage(img, 0, 0);
        const d = ctx.getImageData(0, 0, 256, 256).data;
        const out = new Float32Array(256 * 256);
        for (let i = 0; i < out.length; i++) out[i] = d[i * 4] * 256 + d[i * 4 + 1] + d[i * 4 + 2] / 256 - 32768;
        return out;
      })
      .catch(() => null);
    demCache.set(key, p);
  }
  return p;
}

const tileX = (lng: number, z: number) => ((lng + 180) / 360) * 2 ** z;
const tileY = (lat: number, z: number) => {
  const s = Math.sin((lat * Math.PI) / 180);
  return (0.5 - Math.log((1 + s) / (1 - s)) / (4 * Math.PI)) * 2 ** z;
};
const tileLng = (x: number, z: number) => (x / 2 ** z) * 360 - 180;
const tileLat = (y: number, z: number) => (Math.atan(Math.sinh(Math.PI * (1 - (2 * y) / 2 ** z))) * 180) / Math.PI;

/** elevation (m) for each lng/lat, bilinear from Terrarium tiles; null if the tiles could not be loaded */
async function sampleElevation(points: LngLatTuple[]): Promise<Float32Array | null> {
  if (!points.length) return new Float32Array(0);
  let w = Infinity, s = Infinity, e = -Infinity, n = -Infinity;
  for (const [x, y] of points) {
    if (x < w) w = x;
    if (x > e) e = x;
    if (y < s) s = y;
    if (y > n) n = y;
  }
  let z = 14;
  while (z > 9 && (Math.floor(tileX(e, z)) - Math.floor(tileX(w, z)) + 1) * (Math.floor(tileY(s, z)) - Math.floor(tileY(n, z)) + 1) > 30) z--;
  const tiles = new Map<string, Float32Array | null>();
  const jobs: Promise<void>[] = [];
  for (let tx = Math.floor(tileX(w, z)); tx <= Math.floor(tileX(e, z)); tx++)
    for (let ty = Math.floor(tileY(n, z)); ty <= Math.floor(tileY(s, z)); ty++)
      jobs.push(loadDem(z, tx, ty).then((d) => void tiles.set(`${tx}/${ty}`, d)));
  await Promise.all(jobs);
  if ([...tiles.values()].every((t) => !t)) return null;

  const at = (px: number, py: number) => {
    const tx = Math.floor(px / 256), ty = Math.floor(py / 256);
    const t = tiles.get(`${tx}/${ty}`);
    return t ? t[(py - ty * 256) * 256 + (px - tx * 256)] : NaN;
  };
  const out = new Float32Array(points.length);
  let last = 0;
  points.forEach(([lng, lat], i) => {
    const fx = tileX(lng, z) * 256 - 0.5, fy = tileY(lat, z) * 256 - 0.5;
    const x0 = Math.floor(fx), y0 = Math.floor(fy), ax = fx - x0, ay = fy - y0;
    const v =
      (at(x0, y0) * (1 - ax) + at(x0 + 1, y0) * ax) * (1 - ay) + (at(x0, y0 + 1) * (1 - ax) + at(x0 + 1, y0 + 1) * ax) * ay;
    out[i] = Number.isFinite(v) ? v : last;
    if (Number.isFinite(v)) last = v;
  });
  return out;
}

/* ------------------------------------------------------------------ geometry helpers */

/** clip a polyline to a lng/lat box (features come cut into vector tiles with a buffer) */
function clipLine(line: Position[], [w, s, e, n]: number[]): Position[][] {
  const parts: Position[][] = [];
  let cur: Position[] = [];
  for (let i = 1; i < line.length; i++) {
    const [x0, y0] = line[i - 1], [x1, y1] = line[i];
    const dx = x1 - x0, dy = y1 - y0;
    let t0 = 0, t1 = 1;
    const p = [-dx, dx, -dy, dy], q = [x0 - w, e - x0, y0 - s, n - y0];
    let inside = true;
    for (let k = 0; k < 4; k++) {
      if (p[k] === 0) {
        if (q[k] < 0) inside = false;
      } else {
        const r = q[k] / p[k];
        if (p[k] < 0) t0 = Math.max(t0, r);
        else t1 = Math.min(t1, r);
      }
    }
    if (!inside || t0 > t1) {
      if (cur.length > 1) parts.push(cur);
      cur = [];
      continue;
    }
    const a = [x0 + dx * t0, y0 + dy * t0], b = [x0 + dx * t1, y0 + dy * t1];
    if (!cur.length) cur.push(a);
    cur.push(b);
    if (t1 < 1) {
      parts.push(cur);
      cur = [];
    }
  }
  if (cur.length > 1) parts.push(cur);
  return parts;
}

function tileBox(f: GeoJSONFeature) {
  const { _x: x, _y: y, _z: z } = f;
  if (z === undefined) return null;
  return [tileLng(x, z), tileLat(y + 1, z), tileLng(x + 1, z), tileLat(y, z)];
}

interface Poly { rings: [number, number][][]; box: [number, number, number, number] }

function insidePoly(px: number, py: number, poly: Poly) {
  const [w, s, e, n] = poly.box;
  if (px < w || px > e || py < s || py > n) return false;
  let inside = false;
  for (const ring of poly.rings)
    for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
      const [xi, yi] = ring[i], [xj, yj] = ring[j];
      if (yi > py !== yj > py && px < ((xj - xi) * (py - yi)) / (yj - yi) + xi) inside = !inside;
    }
  return inside;
}

/** small stable hash → 0..1, so the water pattern does not jump when the view is rebuilt */
const hash = (x: number, y: number) => {
  const v = Math.sin(x * 12.9898 + y * 78.233) * 43758.5453;
  return v - Math.floor(v);
};

/* ------------------------------------------------------------------ shaders */

const NOISE = /* glsl */ `
float hash21(vec2 p) { p = fract(p * vec2(123.34, 456.21)); p += dot(p, p + 45.32); return fract(p.x * p.y); }
float vnoise(vec2 p) {
  vec2 i = floor(p), f = fract(p);
  vec2 u = f * f * (3.0 - 2.0 * f);
  return mix(mix(hash21(i), hash21(i + vec2(1.0, 0.0)), u.x), mix(hash21(i + vec2(0.0, 1.0)), hash21(i + vec2(1.0, 1.0)), u.x), u.y);
}
float fbm(vec2 p) { return vnoise(p) * 0.55 + vnoise(p * 2.03 + 7.1) * 0.3 + vnoise(p * 4.11 + 3.7) * 0.15; }
const vec3 ICY = vec3(0.553, 0.847, 0.973);
const vec3 CYAN = vec3(0.220, 0.741, 0.973);
const vec3 DEEP = vec3(0.086, 0.471, 0.722);
const vec3 PAPER_BLUE = vec3(0.09, 0.45, 0.67);
`;

const RIBBON_VS = /* glsl */ `
precision highp float;
attribute vec2 a_pos;
attribute vec2 a_normal;
attribute float a_side;
attribute float a_along;
attribute float a_acc;
attribute float a_hw;
attribute float a_speed;
attribute float a_seed;
uniform mat4 u_matrix;
uniform float u_mpp;
uniform float u_spread;
varying float v_across;
varying float v_along;
varying float v_acc;
varying float v_speed;
varying float v_seed;
varying float v_thin;
varying float v_perm;
void main() {
  // heavier rain and bigger streams spill over the pavements (buildings, drawn later, mask it)
  float acc = abs(a_acc);
  v_perm = a_acc < 0.0 ? 1.0 : 0.0;
  float hw = max(a_hw * (u_spread + 0.7 * acc), u_mpp * 1.7);
  // zoomed out, streets are only a pixel or two wide: keep them quiet rather than neon
  v_thin = clamp(a_hw * u_spread / (u_mpp * 4.0), 0.0, 1.0);
  gl_Position = u_matrix * vec4(a_pos + a_normal * a_side * hw, 0.0, 1.0);
  v_across = a_side;
  v_along = a_along;
  v_acc = acc;
  v_speed = a_speed;
  v_seed = a_seed;
}`;

const RIBBON_FS = /* glsl */ `
precision highp float;
${NOISE}
uniform float u_time;
uniform float u_wet;    // 0 dry → 1 fully wet (rises while it rains, recedes after)
uniform float u_paper;
uniform float u_cover;  // how much of the street width carries water (rain level)
uniform float u_heavy;  // 0 gentle → 1 heavy
uniform float u_speed;
uniform float u_nscale; // noise frequency per metre (coarser when zoomed out)
varying float v_thin;
varying float v_perm;
varying float v_across;
varying float v_along;
varying float v_acc;
varying float v_speed;
varying float v_seed;
void main() {
  float d = abs(v_across);
  float fromCurb = 1.0 - d;
  float along = v_along * u_nscale;

  // water first gathers along both kerbs, then widens across the street where more has collected
  // on permeable ground most of it soaks away
  float cover = clamp(u_cover * (0.5 + 0.9 * v_acc) * (0.45 + 0.55 * u_wet) * (1.0 - 0.75 * v_perm), 0.0, 1.05);
  float n = fbm(vec2(along * 0.11 + v_seed * 17.0, v_across * 1.4));
  float edge = cover + (n - 0.5) * 0.38;
  float band = 1.0 - smoothstep(edge - 0.1, edge + 0.04, fromCurb);
  // a ragged outer shoreline where water spills over the pavement
  float shore = 0.8 + (fbm(vec2(along * 0.2 + 11.0, v_across * 0.7 + v_seed * 9.0)) - 0.5) * 0.42;
  band *= 1.0 - smoothstep(shore - 0.12, min(shore + 0.06, 1.0), d);

  // small wet patches appear first (most where water collects) and join up into streams
  float patchN = fbm(vec2(along * 0.035 + v_seed * 31.0, v_across * 0.35 + 3.0));
  float grow = u_wet * (0.55 + 0.85 * v_acc) * 1.3 - 0.12;
  float appear = smoothstep(patchN - 0.07, patchN + 0.07, grow);

  float m = band * appear;
  if (m < 0.01) discard;

  // deeper where more water has collected and towards the middle of the wet band
  float depth = clamp(v_acc * 0.75 + u_heavy * 0.2 + (cover - fromCurb) * 0.5, 0.0, 1.0);
  vec3 col = mix(ICY, CYAN, smoothstep(0.15, 0.8, depth));
  col = mix(col, DEEP, smoothstep(0.7, 1.0, depth) * 0.6);

  // slow flowing texture downhill; faster where it is steeper and with heavier rain
  float t = u_time * u_speed * v_speed;
  float flow = fbm(vec2(along * 0.24 - t * (0.55 + 0.6 * v_acc), v_across * 2.3 + v_seed * 5.0));
  col += smoothstep(0.56, 0.86, flow) * 0.16 * vec3(0.85, 0.95, 1.0);
  // gentle ripples catching the light
  float rip = sin(along * 1.6 - t * 2.2 + n * 6.0) * 0.5 + 0.5;
  col += pow(rip, 14.0) * 0.07;
  // a soft bright rim where the water meets the dry street
  float rim = smoothstep(0.75, 1.0, band) * (1.0 - smoothstep(edge - 0.16, edge - 0.02, fromCurb));
  col = mix(col, ICY, (1.0 - rim) * 0.25 * step(0.08, cover));

  float alpha = m * (0.36 + 0.4 * depth) * mix(0.45, 1.0, v_thin) * (1.0 - 0.45 * v_perm);
  col = mix(col, mix(PAPER_BLUE, CYAN, 0.16 + 0.35 * flow + 0.12 * pow(rip, 14.0)), u_paper);
  alpha *= mix(1.0, 1.24, u_paper);
  gl_FragColor = vec4(col * alpha, alpha);
}`;

const POOL_VS = /* glsl */ `
precision highp float;
attribute vec2 a_center;
attribute vec2 a_corner;
attribute float a_r;
attribute float a_acc;
attribute float a_kind;
uniform mat4 u_matrix;
uniform float u_pool;
uniform float u_mpp;
varying vec2 v_corner;
varying float v_acc;
varying float v_kind;
varying float v_seed;
void main() {
  float r = max(a_r * (0.3 + 0.7 * u_pool), u_mpp * 2.0);
  gl_Position = u_matrix * vec4(a_center + a_corner * r, 0.0, 1.0);
  v_corner = a_corner;
  v_acc = a_acc;
  v_kind = a_kind;
  v_seed = fract(a_center.x * 0.137 + a_center.y * 0.071);
}`;

const POOL_FS = /* glsl */ `
precision highp float;
${NOISE}
uniform float u_time;
uniform float u_pool;
uniform float u_paper;
varying vec2 v_corner;
varying float v_acc;
varying float v_kind;
varying float v_seed;
void main() {
  float r = length(v_corner);
  float n = fbm(v_corner * 1.7 + v_seed * 40.0);
  float edge = 0.78 + (n - 0.5) * 0.55;
  float m = (1.0 - smoothstep(edge - 0.16, edge, r)) * u_pool;
  if (m < 0.01) discard;
  float depth = clamp(1.0 - r / edge, 0.0, 1.0);
  vec3 col;
  float ring;
  if (v_kind < 0.5) {
    // ponding at a low point: deepest in the middle
    col = mix(CYAN, DEEP, smoothstep(0.1, 0.9, depth * (0.6 + 0.5 * v_acc)));
    ring = sin(r * 16.0 - u_time * 1.4 + n * 4.0) * 0.5 + 0.5;
  } else {
    // soaking into a green area: lighter, fading into the ground, rings drawing inwards
    col = mix(ICY, vec3(0.32, 0.74, 0.70), depth * 0.6);
    ring = sin(r * 14.0 + u_time * 1.1 + n * 4.0) * 0.5 + 0.5;
  }
  col += pow(ring, 10.0) * 0.08;
  col = mix(col, ICY, smoothstep(edge - 0.2, edge, r) * 0.35);
  float alpha = m * (v_kind < 0.5 ? 0.34 + 0.4 * depth : 0.22 + 0.3 * depth);
  col = mix(col, mix(PAPER_BLUE, CYAN, 0.48 - 0.35 * depth + 0.16 * ring), u_paper);
  alpha *= mix(1.0, 1.22, u_paper);
  gl_FragColor = vec4(col * alpha, alpha);
}`;

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

interface Program {
  prog: WebGLProgram;
  attrs: { loc: number; size: number }[];
  stride: number;
  u: Record<string, WebGLUniformLocation | null>;
}

function program(gl: WebGLRenderingContext, vs: string, fs: string, attrs: [string, number][], uniforms: string[]): Program {
  const prog = compile(gl, vs, fs);
  return {
    prog,
    attrs: attrs.map(([name, size]) => ({ loc: gl.getAttribLocation(prog, name), size })),
    stride: attrs.reduce((s, [, n]) => s + n, 0) * 4,
    u: Object.fromEntries(uniforms.map((n) => [n, gl.getUniformLocation(prog, n)])),
  };
}

interface Mesh {
  origin: LngLatTuple;
  ribbon: Float32Array;
  ribbonIndex: Uint32Array;
  pools: Float32Array;
  poolIndex: Uint32Array;
}

/* ------------------------------------------------------------------ build the water network */

async function buildMesh(map: MLMap): Promise<Mesh | null> {
  const c = map.getCenter();
  const origin: LngLatTuple = [c.lng, c.lat];

  // streets, clipped to their own tile so neighbouring tiles do not draw the same street twice
  const lines: { pts: Position[]; hw: number }[] = [];
  for (const f of map.querySourceFeatures('omt', { sourceLayer: 'transportation', filter: STREETS })) {
    const hw = HALF_WIDTH[f.properties.class as string] ?? 3;
    const g = f.geometry;
    const parts = g.type === 'LineString' ? [g.coordinates] : g.type === 'MultiLineString' ? g.coordinates : [];
    const box = tileBox(f);
    for (const part of parts) for (const pts of box ? clipLine(part, box) : [part]) lines.push({ pts, hw });
  }
  if (!lines.length) return null;

  // green, permeable areas, where water soaks in
  const greens: Poly[] = [];
  for (const { sourceLayer, filter } of GREEN_LAYERS)
    for (const f of map.querySourceFeatures('omt', { sourceLayer, filter })) {
      const g = f.geometry;
      const polys = g.type === 'Polygon' ? [g.coordinates] : g.type === 'MultiPolygon' ? g.coordinates : [];
      for (const rings of polys) {
        const local = rings.map((ring) => ring.map((p) => toLocal(p, origin)));
        const xs = local[0].map((p) => p[0]), ys = local[0].map((p) => p[1]);
        greens.push({ rings: local, box: [Math.min(...xs), Math.min(...ys), Math.max(...xs), Math.max(...ys)] });
      }
    }

  // street graph: one node per vertex, snapped so streets that meet share a node
  const nodeOf = new Map<string, number>();
  const nodeLL: LngLatTuple[] = [];
  const nodeXY: [number, number][] = [];
  const graph: { nodes: number[]; xy: [number, number][]; hw: number }[] = [];
  for (const { pts, hw } of lines) {
    const nodes: number[] = [];
    const xy: [number, number][] = [];
    for (const p of pts) {
      const q = toLocal(p, origin);
      const key = `${Math.round(q[0] / 1.2)},${Math.round(q[1] / 1.2)}`;
      let id = nodeOf.get(key);
      if (id === undefined) {
        id = nodeLL.length;
        nodeOf.set(key, id);
        nodeLL.push([p[0], p[1]]);
        nodeXY.push(q);
      }
      if (nodes[nodes.length - 1] !== id) {
        nodes.push(id);
        xy.push(q);
      }
    }
    if (nodes.length > 1) graph.push({ nodes, xy, hw });
    if (nodeLL.length > MAX_NODES) break;
  }
  const N = nodeLL.length;

  const elev = (await sampleElevation(nodeLL)) ?? new Float32Array(N);
  const hasTerrain = elev.some((v) => v !== 0);

  const green = new Uint8Array(N);
  if (greens.length) nodeXY.forEach(([x, y], i) => { if (greens.some((g) => insidePoly(x, y, g))) green[i] = 1; });

  // rain falling on each street, and which nodes are connected
  const rain = new Float32Array(N);
  const nbrs: number[][] = Array.from({ length: N }, () => []);
  for (const { nodes, xy } of graph)
    for (let i = 1; i < nodes.length; i++) {
      const a = nodes[i - 1], b = nodes[i];
      const len = Math.hypot(xy[i][0] - xy[i - 1][0], xy[i][1] - xy[i - 1][1]);
      if (!green[a]) rain[a] += len / 2;
      if (!green[b]) rain[b] += len / 2;
      nbrs[a].push(b);
      nbrs[b].push(a);
    }

  // flow accumulation: from high to low, each node hands its water to its lowest neighbour
  const h = Float32Array.from(elev, (v, i) => v + i * 1e-7);
  const order = Array.from({ length: N }, (_, i) => i).sort((a, b) => h[b] - h[a]);
  const acc = Float32Array.from(rain);
  const inflow = new Float32Array(N);
  const isSink = new Uint8Array(N);
  for (const i of order) {
    let low = -1;
    for (const j of nbrs[i]) if (h[j] < h[i] && (low < 0 || h[j] < h[low])) low = j;
    if (low < 0) {
      isSink[i] = 1;
      continue;
    }
    // green ground takes most of what reaches it
    const pass = green[i] ? acc[i] * 0.15 : acc[i];
    acc[low] += pass;
    if (green[low] && !green[i]) inflow[low] += acc[i];
  }
  const norm = (v: number) => Math.min(1, Math.log1p(v / 60) / Math.log1p(ACC_REF / 60));
  const accN = Float32Array.from(acc, (v, i) => (green[i] ? norm(v) * 0.3 : norm(v)));

  // ribbons: two vertices per street vertex, 10 floats each
  const STRIDE = 10;
  let vcount = 0, icount = 0;
  for (const g of graph) {
    vcount += g.nodes.length * 2;
    icount += (g.nodes.length - 1) * 6;
  }
  const ribbon = new Float32Array(vcount * STRIDE);
  const ribbonIndex = new Uint32Array(icount);
  let v = 0, k = 0;
  for (const { nodes, xy, hw } of graph) {
    const m = nodes.length;
    // run the flow texture downhill
    const downhill = !hasTerrain || h[nodes[0]] >= h[nodes[m - 1]];
    const cum = [0];
    for (let i = 1; i < m; i++) cum.push(cum[i - 1] + Math.hypot(xy[i][0] - xy[i - 1][0], xy[i][1] - xy[i - 1][1]));
    const total = cum[m - 1] || 1;
    const slope = hasTerrain ? Math.abs(elev[nodes[0]] - elev[nodes[m - 1]]) / total : 0.02;
    const speed = 0.6 + Math.min(1.6, slope * 35);
    const seed = hash(Math.round(xy[0][0]), Math.round(xy[0][1]));
    const base = v / STRIDE;
    for (let i = 0; i < m; i++) {
      const p = xy[i];
      const a = xy[Math.max(0, i - 1)], b = xy[Math.min(m - 1, i + 1)];
      let tx = b[0] - a[0], ty = b[1] - a[1];
      const tl = Math.hypot(tx, ty) || 1;
      tx /= tl;
      ty /= tl;
      let nx = -ty, ny = tx;
      // mitre at bends (clamped so sharp corners do not spike)
      if (i > 0 && i < m - 1) {
        const sx = p[0] - xy[i - 1][0], sy = p[1] - xy[i - 1][1];
        const sl = Math.hypot(sx, sy) || 1;
        const dot = Math.max(0.5, nx * (-sy / sl) + ny * (sx / sl));
        nx /= dot;
        ny /= dot;
      }
      const along = downhill ? cum[i] : total - cum[i];
      for (const side of [-1, 1]) {
        // permeable ground (parks, green areas) is passed as a negative accumulation
        const a = accN[nodes[i]];
        ribbon.set([p[0], p[1], nx, ny, side, along, green[nodes[i]] ? -0.01 - a : a, hw, speed, seed], v);
        v += STRIDE;
      }
      if (i > 0) {
        const q = base + i * 2;
        ribbonIndex.set([q - 2, q - 1, q, q - 1, q + 1, q], k);
        k += 6;
      }
    }
  }

  // ponds at the lowest points of the street network, and soak-in spots where streets reach green areas
  const pick = (candidates: number[], score: Float32Array, max: number, spacing: number) => {
    const out: number[] = [];
    for (const i of candidates.sort((a, b) => score[b] - score[a])) {
      if (out.length >= max) break;
      if (out.every((j) => Math.hypot(nodeXY[i][0] - nodeXY[j][0], nodeXY[i][1] - nodeXY[j][1]) > spacing)) out.push(i);
    }
    return out;
  };
  const ponds = hasTerrain ? pick([...Array(N).keys()].filter((i) => isSink[i] && !green[i] && acc[i] > 250), acc, 40, 45) : [];
  const soaks = pick([...Array(N).keys()].filter((i) => inflow[i] > 120), inflow, 30, 35);
  const POOL_STRIDE = 7;
  const pools = new Float32Array((ponds.length + soaks.length) * 4 * POOL_STRIDE);
  const poolIndex = new Uint32Array((ponds.length + soaks.length) * 6);
  let pv = 0, pk = 0;
  const addPool = (i: number, kind: number, r: number, a: number) => {
    const base = pv / POOL_STRIDE;
    for (const [cx, cy] of [[-1, -1], [1, -1], [1, 1], [-1, 1]]) {
      pools.set([nodeXY[i][0], nodeXY[i][1], cx, cy, r, a, kind], pv);
      pv += POOL_STRIDE;
    }
    poolIndex.set([base, base + 1, base + 2, base, base + 2, base + 3], pk);
    pk += 6;
  };
  for (const i of ponds) addPool(i, 0, 5 + 14 * norm(acc[i]), norm(acc[i]));
  for (const i of soaks) addPool(i, 1, 5 + 10 * norm(inflow[i]), norm(inflow[i]));

  return { origin, ribbon, ribbonIndex, pools, poolIndex };
}

/* ------------------------------------------------------------------ the map layer */

export class SurfaceWaterLayer implements CustomLayerInterface {
  id = 'surface-water';
  type = 'custom' as const;
  renderingMode = '2d' as const;

  private map: MLMap;
  private gl: WebGLRenderingContext | null = null;
  private ribbonProg: Program | null = null;
  private poolProg: Program | null = null;
  private buffers: { ribbon: WebGLBuffer; ribbonIdx: WebGLBuffer; pool: WebGLBuffer; poolIdx: WebGLBuffer } | null = null;
  private counts = { ribbon: 0, pool: 0 };
  private origin: LngLatTuple = [0, 0];
  private pending: Mesh | null = null;

  private raining = false;
  private level = 1;
  /** animated state, eased every frame */
  private wet = 0;
  private pool = 0;
  private cover = COVER[1];
  private speed = SPEED[1];
  private poolMax = POOL[1];
  private heavy = 0.5;
  private time = 0;
  private last = 0;
  private reduced = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches ?? false;

  private generation = 0;
  private rebuildTimer = 0;
  private waitingForStreets = false;

  constructor(map: MLMap) {
    this.map = map;
  }

  /** turn the rain on or off; water spreads in gradually and recedes slowly */
  setRain(on: boolean, level: 0 | 1 | 2) {
    this.level = level;
    if (on === this.raining) {
      this.map.triggerRepaint();
      return;
    }
    this.raining = on;
    const map = this.map;
    if (on) {
      if (!map.getLayer(this.id)) map.addLayer(this, map.getLayer('building-flat') ? 'building-flat' : undefined);
      map.on('moveend', this.scheduleBuild);
      map.on('sourcedata', this.onSourceData);
      this.scheduleBuild();
    } else {
      this.cancelBuild();
    }
    this.last = performance.now();
    map.triggerRepaint();
  }

  private cancelBuild() {
    this.map.off('moveend', this.scheduleBuild);
    this.map.off('sourcedata', this.onSourceData);
    this.waitingForStreets = false;
    window.clearTimeout(this.rebuildTimer);
    this.generation++;
  }

  private onSourceData = ({ sourceId, isSourceLoaded }: MapSourceDataEvent) => {
    if (this.waitingForStreets && sourceId === 'omt' && isSourceLoaded) this.scheduleBuild();
  };

  private scheduleBuild = (event?: MapMovementEvent & { ambientOrbit?: boolean }) => {
    if (event?.ambientOrbit) return;
    window.clearTimeout(this.rebuildTimer);
    const gen = ++this.generation;
    this.rebuildTimer = window.setTimeout(() => {
      const map = this.map;
      this.waitingForStreets = this.raining && map.getZoom() >= 12 && !map.isSourceLoaded('omt');
      if (!this.raining || map.getZoom() < 12 || this.waitingForStreets) return;
      buildMesh(map)
        .then((mesh) => {
          if (gen !== this.generation || !mesh) return;
          this.pending = mesh;
          map.triggerRepaint();
        })
        .catch((err) => console.warn('surface water', err));
    }, 250);
  };

  onAdd(_map: MLMap, gl: WebGLRenderingContext | WebGL2RenderingContext) {
    this.gl = gl;
    if (!(gl instanceof WebGL2RenderingContext)) gl.getExtension('OES_element_index_uint');
    const common = ['u_matrix', 'u_time', 'u_mpp', 'u_paper'];
    this.ribbonProg = program(
      gl, RIBBON_VS, RIBBON_FS,
      [['a_pos', 2], ['a_normal', 2], ['a_side', 1], ['a_along', 1], ['a_acc', 1], ['a_hw', 1], ['a_speed', 1], ['a_seed', 1]],
      [...common, 'u_wet', 'u_cover', 'u_heavy', 'u_speed', 'u_nscale', 'u_spread'],
    );
    this.poolProg = program(
      gl, POOL_VS, POOL_FS,
      [['a_center', 2], ['a_corner', 2], ['a_r', 1], ['a_acc', 1], ['a_kind', 1]],
      [...common, 'u_pool'],
    );
    this.buffers = { ribbon: gl.createBuffer()!, ribbonIdx: gl.createBuffer()!, pool: gl.createBuffer()!, poolIdx: gl.createBuffer()! };
  }

  onRemove(_map: MLMap, gl: WebGLRenderingContext | WebGL2RenderingContext) {
    this.cancelBuild();
    if (this.buffers) Object.values(this.buffers).forEach((b) => gl.deleteBuffer(b));
    if (this.ribbonProg) gl.deleteProgram(this.ribbonProg.prog);
    if (this.poolProg) gl.deleteProgram(this.poolProg.prog);
    this.buffers = null;
  }

  private upload(mesh: Mesh) {
    const gl = this.gl!, b = this.buffers!;
    gl.bindBuffer(gl.ARRAY_BUFFER, b.ribbon);
    gl.bufferData(gl.ARRAY_BUFFER, mesh.ribbon, gl.STATIC_DRAW);
    gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, b.ribbonIdx);
    gl.bufferData(gl.ELEMENT_ARRAY_BUFFER, mesh.ribbonIndex, gl.STATIC_DRAW);
    gl.bindBuffer(gl.ARRAY_BUFFER, b.pool);
    gl.bufferData(gl.ARRAY_BUFFER, mesh.pools, gl.STATIC_DRAW);
    gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, b.poolIdx);
    gl.bufferData(gl.ELEMENT_ARRAY_BUFFER, mesh.poolIndex, gl.STATIC_DRAW);
    this.counts = { ribbon: mesh.ribbonIndex.length, pool: mesh.poolIndex.length };
    this.origin = mesh.origin;
  }

  private step() {
    const now = performance.now();
    const dt = Math.min(0.1, (now - this.last) / 1000);
    this.last = now;
    const fast = this.reduced ? 4 : 1;
    // spread in over ~8 s while it rains; recede, drain and soak away over ~14 s afterwards
    this.wet = this.raining ? Math.min(1, this.wet + (dt * fast) / 8) : Math.max(0, this.wet - (dt * fast) / 14);
    // ponds fill later than the streams and stay a little longer
    const poolTarget = this.raining ? Math.max(0, (this.wet - 0.35) / 0.65) : Math.min(this.pool, this.wet * 1.6);
    this.pool += (poolTarget - this.pool) * Math.min(1, dt * fast * (this.raining ? 0.45 : 0.3));
    // smooth changes between rain levels
    const ease = Math.min(1, dt * fast * 0.6);
    this.cover += (COVER[this.level] - this.cover) * ease;
    this.speed += (SPEED[this.level] - this.speed) * ease;
    this.poolMax += (POOL[this.level] - this.poolMax) * ease;
    this.heavy += (this.level / 2 - this.heavy) * ease;
    if (!this.reduced) this.time += dt;
  }

  render(gl: WebGLRenderingContext | WebGL2RenderingContext, args: CustomRenderMethodInput) {
    if (this.pending) {
      this.upload(this.pending);
      this.pending = null;
    }
    this.step();
    const visible = this.wet > 0.001 || this.pool > 0.002;
    if (visible || this.raining) this.map.triggerRepaint();
    if (!visible || !this.counts.ribbon || !this.ribbonProg || !this.poolProg || !this.buffers) return;

    const mc = MercatorCoordinate.fromLngLat(this.origin, 0);
    const s = mc.meterInMercatorCoordinateUnits();
    // local metres (east, north) → mercator (x right, y down)
    const model = [s, 0, 0, 0, 0, -s, 0, 0, 0, 0, s, 0, mc.x, mc.y, 0, 1];
    const matrix = new Float32Array(mul(args.defaultProjectionData.mainMatrix as ArrayLike<number>, model));
    const lat = this.map.getCenter().lat;
    const mpp = (78271.517 * Math.cos((lat * Math.PI) / 180)) / 2 ** this.map.getZoom();
    const paper = Number(getTheme() === 'light');

    gl.disable(gl.DEPTH_TEST);
    gl.disable(gl.CULL_FACE);
    gl.enable(gl.BLEND);
    gl.blendFunc(gl.ONE, gl.ONE_MINUS_SRC_ALPHA);

    const draw = (p: Program, vbo: WebGLBuffer, ibo: WebGLBuffer, count: number, set: () => void) => {
      gl.useProgram(p.prog);
      gl.uniformMatrix4fv(p.u.u_matrix, false, matrix);
      gl.uniform1f(p.u.u_time, this.time);
      gl.uniform1f(p.u.u_mpp, mpp);
      gl.uniform1f(p.u.u_paper, paper);
      set();
      gl.bindBuffer(gl.ARRAY_BUFFER, vbo);
      gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, ibo);
      let off = 0;
      for (const a of p.attrs) {
        if (a.loc >= 0) {
          gl.enableVertexAttribArray(a.loc);
          gl.vertexAttribPointer(a.loc, a.size, gl.FLOAT, false, p.stride, off);
        }
        off += a.size * 4;
      }
      gl.drawElements(gl.TRIANGLES, count, gl.UNSIGNED_INT, 0);
      for (const a of p.attrs) if (a.loc >= 0) gl.disableVertexAttribArray(a.loc);
    };

    const rp = this.ribbonProg;
    draw(rp, this.buffers.ribbon, this.buffers.ribbonIdx, this.counts.ribbon, () => {
      gl.uniform1f(rp.u.u_wet, this.wet);
      gl.uniform1f(rp.u.u_cover, this.cover);
      gl.uniform1f(rp.u.u_heavy, this.heavy);
      gl.uniform1f(rp.u.u_speed, this.speed);
      gl.uniform1f(rp.u.u_nscale, 1 / Math.max(1, mpp / 0.9));
      gl.uniform1f(rp.u.u_spread, 1.05 + 0.45 * this.heavy);
    });
    if (this.counts.pool) {
      const pp = this.poolProg;
      draw(pp, this.buffers.pool, this.buffers.poolIdx, this.counts.pool, () => {
        gl.uniform1f(pp.u.u_pool, this.pool * this.poolMax);
      });
    }
  }
}
