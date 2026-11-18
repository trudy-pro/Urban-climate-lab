import type { Geometry, Position } from 'geojson';

export type LngLatTuple = [number, number];

const R = 6371008.8;
const rad = (d: number) => (d * Math.PI) / 180;

export function distanceM(a: LngLatTuple, b: LngLatTuple): number {
  const dLat = rad(b[1] - a[1]);
  const dLng = rad(b[0] - a[0]);
  const h =
    Math.sin(dLat / 2) ** 2 + Math.cos(rad(a[1])) * Math.cos(rad(b[1])) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.min(1, Math.sqrt(h)));
}

/** Local equirectangular projection around a reference latitude (metres). */
export function toLocal(p: Position, ref: LngLatTuple): [number, number] {
  const k = Math.cos(rad(ref[1]));
  return [rad(p[0] - ref[0]) * R * k, rad(p[1] - ref[1]) * R];
}

export function fromLocal(xy: [number, number], ref: LngLatTuple): LngLatTuple {
  const k = Math.cos(rad(ref[1]));
  return [ref[0] + (xy[0] / (R * k)) * (180 / Math.PI), ref[1] + (xy[1] / R) * (180 / Math.PI)];
}

function ringAreaLocal(ring: Position[], ref: LngLatTuple): number {
  let a = 0;
  for (let i = 0, n = ring.length; i < n; i++) {
    const [x1, y1] = toLocal(ring[i], ref);
    const [x2, y2] = toLocal(ring[(i + 1) % n], ref);
    a += x1 * y2 - x2 * y1;
  }
  return a / 2;
}

function polygons(g: Geometry): Position[][][] {
  if (g.type === 'Polygon') return [g.coordinates];
  if (g.type === 'MultiPolygon') return g.coordinates;
  return [];
}

/** Footprint area in m² (outer rings minus holes). */
export function areaM2(g: Geometry): number {
  const polys = polygons(g);
  if (!polys.length || !polys[0][0]?.length) return 0;
  const ref = polys[0][0][0] as LngLatTuple;
  let total = 0;
  for (const poly of polys) {
    poly.forEach((ring, i) => {
      const a = Math.abs(ringAreaLocal(ring, ref));
      total += i === 0 ? a : -a;
    });
  }
  return Math.max(0, total);
}

/** Area-weighted centroid of polygonal geometry; falls back to first coordinate. */
export function centroid(g: Geometry): LngLatTuple | null {
  if (g.type === 'Point') return g.coordinates as LngLatTuple;
  const polys = polygons(g);
  if (!polys.length || !polys[0][0]?.length) return null;
  const ref = polys[0][0][0] as LngLatTuple;
  let cx = 0;
  let cy = 0;
  let A = 0;
  for (const poly of polys) {
    const ring = poly[0];
    for (let i = 0, n = ring.length; i < n; i++) {
      const [x1, y1] = toLocal(ring[i], ref);
      const [x2, y2] = toLocal(ring[(i + 1) % n], ref);
      const f = x1 * y2 - x2 * y1;
      cx += (x1 + x2) * f;
      cy += (y1 + y2) * f;
      A += f;
    }
  }
  if (Math.abs(A) < 1e-6) return ref;
  A /= 2;
  return fromLocal([cx / (6 * A), cy / (6 * A)], ref);
}

export function pointInRing(pt: Position, ring: Position[]): boolean {
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const [xi, yi] = ring[i];
    const [xj, yj] = ring[j];
    if (yi > pt[1] !== yj > pt[1] && pt[0] < ((xj - xi) * (pt[1] - yi)) / (yj - yi) + xi) {
      inside = !inside;
    }
  }
  return inside;
}

/** Nearest point on a polyline set, returned with its distance (m). */
export function nearestOnLines(
  p: LngLatTuple,
  lines: Position[][],
): { point: LngLatTuple; dist: number } | null {
  let best: { point: LngLatTuple; dist: number } | null = null;
  const P = [0, 0];
  for (const line of lines) {
    for (let i = 0; i < line.length - 1; i++) {
      const A = toLocal(line[i], p);
      const B = toLocal(line[i + 1], p);
      const dx = B[0] - A[0];
      const dy = B[1] - A[1];
      const len2 = dx * dx + dy * dy;
      let t = len2 ? ((P[0] - A[0]) * dx + (P[1] - A[1]) * dy) / len2 : 0;
      t = Math.max(0, Math.min(1, t));
      const x = A[0] + t * dx;
      const y = A[1] + t * dy;
      const d = Math.hypot(x, y);
      if (!best || d < best.dist) best = { point: fromLocal([x, y], p), dist: d };
    }
  }
  return best;
}

/** Quadratic bezier between a and b, bowed sideways by `bow` (fraction of length). */
export function curve(a: LngLatTuple, b: LngLatTuple, bow = 0.18, steps = 16): LngLatTuple[] {
  const B = toLocal(b, a);
  const mid: [number, number] = [B[0] / 2 - B[1] * bow, B[1] / 2 + B[0] * bow];
  const out: LngLatTuple[] = [];
  for (let i = 0; i <= steps; i++) {
    const t = i / steps;
    const x = 2 * (1 - t) * t * mid[0] + t * t * B[0];
    const y = 2 * (1 - t) * t * mid[1] + t * t * B[1];
    out.push(fromLocal([x, y], a));
  }
  return out;
}

export function lineLengths(line: LngLatTuple[]): { cum: number[]; total: number } {
  const cum = [0];
  for (let i = 1; i < line.length; i++) cum.push(cum[i - 1] + distanceM(line[i - 1], line[i]));
  return { cum, total: cum[cum.length - 1] };
}

export function along(line: LngLatTuple[], cum: number[], d: number): LngLatTuple {
  if (d <= 0) return line[0];
  const total = cum[cum.length - 1];
  if (d >= total) return line[line.length - 1];
  let i = 1;
  while (cum[i] < d) i++;
  const t = (d - cum[i - 1]) / (cum[i] - cum[i - 1] || 1);
  const a = line[i - 1];
  const b = line[i];
  return [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t];
}

/** Splits (Multi)Polygon geometry into its individual polygons (one per building footprint). */
export function polygonParts(g: Geometry): Position[][][] {
  return polygons(g);
}

/** The single footprint polygon of a (merged) MultiPolygon that contains the given point. */
export function polygonAt(g: Geometry, p: Position): Position[][] | null {
  const parts = polygons(g);
  for (const poly of parts) {
    if (poly[0] && pointInRing(p, poly[0]) && !poly.slice(1).some((hole) => pointInRing(p, hole))) return poly;
  }
  // fall back to nearest part by centroid
  let best: Position[][] | null = null;
  let bestD = Infinity;
  for (const poly of parts) {
    const c = centroid({ type: 'Polygon', coordinates: poly });
    if (!c) continue;
    const d = distanceM(c, p as LngLatTuple);
    if (d < bestD) {
      bestD = d;
      best = poly;
    }
  }
  return bestD < 25 ? best : null;
}

/** Grows a polygon slightly (metres) around its centroid — avoids z-fighting for highlight overlays. */
export function inflate(poly: Position[][], metres: number): Position[][] {
  const c = centroid({ type: 'Polygon', coordinates: poly });
  if (!c) return poly;
  return poly.map((ring) =>
    ring.map((pt) => {
      const [x, y] = toLocal(pt, c);
      const r = Math.hypot(x, y) || 1;
      const k = (r + metres) / r;
      return fromLocal([x * k, y * k], c);
    }),
  );
}
