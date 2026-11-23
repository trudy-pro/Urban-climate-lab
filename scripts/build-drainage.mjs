#!/usr/bin/env node
/**
 * Builds public/data/drainage.geojson — city-wide surface-runoff routes for Basel.
 *
 * Source: Terrarium elevation tiles (Mapzen / AWS Open Data, no key), zoom 13 (~13 m cells).
 * Method: priority-flood depression filling → D8 flow directions → flow accumulation →
 *         cells draining more than MIN_AREA_KM2 become channels, split at confluences.
 *
 * It is a terrain-only model: it ignores sewers, buildings and kerbs, so it shows where rain
 * would run downhill across the landscape, not the actual drainage network.
 *
 *   node scripts/build-drainage.mjs
 */
import { inflateSync } from 'node:zlib';
import { writeFileSync, mkdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const Z = 13;
const BBOX = [7.5, 47.48, 7.74, 47.62]; // a little larger than the canton so streams enter with their upstream area
const CLIP = [7.53, 47.505, 7.715, 47.61]; // what is written out
const MIN_AREA_KM2 = 0.12;
const OUT = resolve(dirname(fileURLToPath(import.meta.url)), '../public/data/drainage.geojson');

/* ---------------------------------------------------------------- tiles */
const lon2x = (lon, z) => ((lon + 180) / 360) * 2 ** z;
const lat2y = (lat, z) => {
  const r = (lat * Math.PI) / 180;
  return ((1 - Math.log(Math.tan(r) + 1 / Math.cos(r)) / Math.PI) / 2) * 2 ** z;
};
const x2lon = (x, z) => (x / 2 ** z) * 360 - 180;
const y2lat = (y, z) => (Math.atan(Math.sinh(Math.PI * (1 - (2 * y) / 2 ** z))) * 180) / Math.PI;

function decodePng(buf) {
  if (buf.readUInt32BE(0) !== 0x89504e47) throw new Error('not a PNG');
  let off = 8;
  let w = 0, h = 0, ct = 0;
  const idat = [];
  while (off < buf.length) {
    const len = buf.readUInt32BE(off);
    const type = buf.toString('ascii', off + 4, off + 8);
    const data = buf.subarray(off + 8, off + 8 + len);
    if (type === 'IHDR') {
      w = data.readUInt32BE(0);
      h = data.readUInt32BE(4);
      if (data[8] !== 8 || data[12] !== 0) throw new Error('unsupported PNG');
      ct = data[9];
    } else if (type === 'IDAT') idat.push(data);
    else if (type === 'IEND') break;
    off += 12 + len;
  }
  const bpp = ct === 6 ? 4 : ct === 2 ? 3 : 0;
  if (!bpp) throw new Error(`unsupported colour type ${ct}`);
  const raw = inflateSync(Buffer.concat(idat));
  const stride = w * bpp;
  const out = Buffer.alloc(h * stride);
  for (let y = 0; y < h; y++) {
    const f = raw[y * (stride + 1)];
    const src = raw.subarray(y * (stride + 1) + 1, (y + 1) * (stride + 1));
    const row = out.subarray(y * stride, (y + 1) * stride);
    const prev = y ? out.subarray((y - 1) * stride, y * stride) : Buffer.alloc(stride);
    for (let i = 0; i < stride; i++) {
      const a = i >= bpp ? row[i - bpp] : 0;
      const b = prev[i];
      const c = i >= bpp ? prev[i - bpp] : 0;
      let v = src[i];
      if (f === 1) v += a;
      else if (f === 2) v += b;
      else if (f === 3) v += (a + b) >> 1;
      else if (f === 4) {
        const p = a + b - c, pa = Math.abs(p - a), pb = Math.abs(p - b), pc = Math.abs(p - c);
        v += pa <= pb && pa <= pc ? a : pb <= pc ? b : c;
      }
      row[i] = v & 255;
    }
  }
  return { w, h, bpp, px: out };
}

const tx0 = Math.floor(lon2x(BBOX[0], Z)), tx1 = Math.floor(lon2x(BBOX[2], Z));
const ty0 = Math.floor(lat2y(BBOX[3], Z)), ty1 = Math.floor(lat2y(BBOX[1], Z));
const T = 256;
const W = (tx1 - tx0 + 1) * T, H = (ty1 - ty0 + 1) * T;
const dem = new Float32Array(W * H);

console.log(`Fetching ${(tx1 - tx0 + 1) * (ty1 - ty0 + 1)} Terrarium tiles (z${Z}) → ${W}×${H} grid`);
const jobs = [];
for (let ty = ty0; ty <= ty1; ty++)
  for (let tx = tx0; tx <= tx1; tx++)
    jobs.push(
      (async () => {
        const url = `https://s3.amazonaws.com/elevation-tiles-prod/terrarium/${Z}/${tx}/${ty}.png`;
        const res = await fetch(url);
        if (!res.ok) throw new Error(`${url} → ${res.status}`);
        const { w, h, bpp, px } = decodePng(Buffer.from(await res.arrayBuffer()));
        for (let y = 0; y < h; y++)
          for (let x = 0; x < w; x++) {
            const i = (y * w + x) * bpp;
            const e = px[i] * 256 + px[i + 1] + px[i + 2] / 256 - 32768;
            dem[((ty - ty0) * T + y) * W + (tx - tx0) * T + x] = e;
          }
      })(),
    );
await Promise.all(jobs);

/* ---------------------------------------------------------------- priority-flood (Barnes et al. 2014, +ε) */
const N = W * H;
const filled = Float32Array.from(dem);
const done = new Uint8Array(N);
// binary min-heap of cell indices keyed by filled elevation
const heap = new Int32Array(N);
let hn = 0;
const less = (a, b) => filled[a] < filled[b];
function push(i) {
  let k = hn++;
  heap[k] = i;
  while (k) {
    const p = (k - 1) >> 1;
    if (!less(heap[k], heap[p])) break;
    [heap[k], heap[p]] = [heap[p], heap[k]];
    k = p;
  }
}
function pop() {
  const top = heap[0];
  heap[0] = heap[--hn];
  let k = 0;
  for (;;) {
    const l = 2 * k + 1, r = l + 1;
    let m = k;
    if (l < hn && less(heap[l], heap[m])) m = l;
    if (r < hn && less(heap[r], heap[m])) m = r;
    if (m === k) break;
    [heap[k], heap[m]] = [heap[m], heap[k]];
    k = m;
  }
  return top;
}
const DX = [1, 1, 0, -1, -1, -1, 0, 1];
const DY = [0, 1, 1, 1, 0, -1, -1, -1];
const DD = DX.map((dx, k) => Math.hypot(dx, DY[k]));
for (let x = 0; x < W; x++) for (const y of [0, H - 1]) { const i = y * W + x; if (!done[i]) { done[i] = 1; push(i); } }
for (let y = 0; y < H; y++) for (const x of [0, W - 1]) { const i = y * W + x; if (!done[i]) { done[i] = 1; push(i); } }
const EPS = 1e-3;
while (hn) {
  const c = pop();
  const cx = c % W, cy = (c / W) | 0;
  for (let k = 0; k < 8; k++) {
    const nx = cx + DX[k], ny = cy + DY[k];
    if (nx < 0 || ny < 0 || nx >= W || ny >= H) continue;
    const n = ny * W + nx;
    if (done[n]) continue;
    done[n] = 1;
    if (filled[n] <= filled[c]) filled[n] = filled[c] + EPS;
    push(n);
  }
}

/* ---------------------------------------------------------------- D8 + accumulation */
const dir = new Int8Array(N).fill(-1);
for (let y = 0; y < H; y++)
  for (let x = 0; x < W; x++) {
    const i = y * W + x;
    let best = -1, bs = 0;
    for (let k = 0; k < 8; k++) {
      const nx = x + DX[k], ny = y + DY[k];
      if (nx < 0 || ny < 0 || nx >= W || ny >= H) continue;
      const s = (filled[i] - filled[ny * W + nx]) / DD[k];
      if (s > bs) { bs = s; best = k; }
    }
    dir[i] = best; // -1 → drains off the grid
  }
const down = (i) => {
  const k = dir[i];
  if (k < 0) return -1;
  return (((i / W) | 0) + DY[k]) * W + (i % W) + DX[k];
};
const indeg = new Uint8Array(N);
for (let i = 0; i < N; i++) { const d = down(i); if (d >= 0) indeg[d]++; }
const acc = new Float32Array(N).fill(1);
const queue = new Int32Array(N);
let qh = 0, qt = 0;
for (let i = 0; i < N; i++) if (!indeg[i]) queue[qt++] = i;
while (qh < qt) {
  const i = queue[qh++];
  const d = down(i);
  if (d < 0) continue;
  acc[d] += acc[i];
  if (--indeg[d] === 0) queue[qt++] = d;
}

/* ---------------------------------------------------------------- channels → line segments */
const cellLon = (i) => x2lon(tx0 + ((i % W) + 0.5) / T, Z);
const cellLat = (i) => y2lat(ty0 + (((i / W) | 0) + 0.5) / T, Z);
const midLat = (BBOX[1] + BBOX[3]) / 2;
const cellM = (40075016.686 * Math.cos((midLat * Math.PI) / 180)) / (T * 2 ** Z);
const cellKm2 = (cellM * cellM) / 1e6;
const minCells = MIN_AREA_KM2 / cellKm2;
const isCh = (i) => acc[i] >= minCells;
const upCh = new Uint8Array(N);
for (let i = 0; i < N; i++) if (isCh(i)) { const d = down(i); if (d >= 0) upCh[d]++; }

const inClip = (lon, lat) => lon >= CLIP[0] && lon <= CLIP[2] && lat >= CLIP[1] && lat <= CLIP[3];
const features = [];
for (let s = 0; s < N; s++) {
  if (!isCh(s) || upCh[s] === 1) continue; // segments start at heads (0) or confluences (≥2)
  const cells = [s];
  let c = s;
  for (;;) {
    const d = down(c);
    if (d < 0) break;
    cells.push(d);
    if (upCh[d] >= 2) break;
    c = d;
  }
  if (cells.length < 2) continue;
  let pts = cells.map((i) => [cellLon(i), cellLat(i)]);
  // keep only the part inside the clip box
  pts = pts.filter(([lon, lat]) => inClip(lon, lat));
  if (pts.length < 2) continue;
  pts = chaikin(simplify(pts, cellM * 0.9 / 111320), 2).map(([a, b]) => [+a.toFixed(5), +b.toFixed(5)]);
  const area = acc[cells[cells.length - 1]] * cellKm2;
  features.push({
    type: 'Feature',
    properties: { a: +area.toFixed(2) },
    geometry: { type: 'LineString', coordinates: pts },
  });
}

function simplify(pts, tol) {
  if (pts.length < 3) return pts;
  const keep = new Uint8Array(pts.length);
  keep[0] = keep[pts.length - 1] = 1;
  const st = [[0, pts.length - 1]];
  while (st.length) {
    const [a, b] = st.pop();
    let md = 0, mi = -1;
    const [x1, y1] = pts[a], [x2, y2] = pts[b];
    const L = Math.hypot(x2 - x1, y2 - y1) || 1e-12;
    for (let i = a + 1; i < b; i++) {
      const d = Math.abs((x2 - x1) * (y1 - pts[i][1]) - (x1 - pts[i][0]) * (y2 - y1)) / L;
      if (d > md) { md = d; mi = i; }
    }
    if (md > tol) { keep[mi] = 1; st.push([a, mi], [mi, b]); }
  }
  return pts.filter((_, i) => keep[i]);
}

function chaikin(pts, n) {
  for (let r = 0; r < n; r++) {
    if (pts.length < 3) return pts;
    const o = [pts[0]];
    for (let i = 0; i < pts.length - 1; i++) {
      const [ax, ay] = pts[i], [bx, by] = pts[i + 1];
      o.push([ax * 0.75 + bx * 0.25, ay * 0.75 + by * 0.25], [ax * 0.25 + bx * 0.75, ay * 0.25 + by * 0.75]);
    }
    o.push(pts[pts.length - 1]);
    pts = o;
  }
  return pts;
}

mkdirSync(dirname(OUT), { recursive: true });
const fc = {
  type: 'FeatureCollection',
  properties: {
    source: 'Terrarium elevation tiles (Mapzen / AWS Open Data), z13',
    method: 'priority-flood + D8 flow accumulation; a = upstream area in km²',
    minAreaKm2: MIN_AREA_KM2,
  },
  features,
};
writeFileSync(OUT, JSON.stringify(fc));
const maxA = features.reduce((m, f) => Math.max(m, f.properties.a), 0);
console.log(`${features.length} channel segments · max upstream area ${maxA.toFixed(0)} km² → ${OUT}`);
