import type { Map as MLMap, PointLike } from 'maplibre-gl';
import type { Position } from 'geojson';
import { centroid, distanceM, fromLocal, pointInRing, polygonParts, type LngLatTuple } from './geo';

/**
 * 3D-aware footprint picking.
 *
 * The vector tiles merge many building footprints into one MultiPolygon feature, so MapLibre's hit test
 * only tells us *which merged feature* was hit. On a tilted view the cursor usually sits on a roof or wall,
 * while the ground point under the cursor lies *behind* the building. We therefore walk down the camera ray
 * from roof height to the ground and return the first individual footprint the ray enters.
 */

export interface PickedFootprint {
  polygon: Position[][];
  height: number | null;
  base: number | null;
}

const EARTH_CIRC = 2 * Math.PI * 6378137;

/** Approximate camera position (ground lng/lat + altitude in metres) from public camera state. */
export function cameraPosition(map: MLMap): { lngLat: LngLatTuple; alt: number } {
  const c = map.getCenter();
  const pitch = (map.getPitch() * Math.PI) / 180;
  const bearing = (map.getBearing() * Math.PI) / 180;
  const fov = (map.getVerticalFieldOfView() * Math.PI) / 180;
  const h = map.getCanvas().clientHeight || 800;
  const camToCenterPx = (0.5 * h) / Math.tan(fov / 2);
  const metresPerPx = (EARTH_CIRC * Math.cos((c.lat * Math.PI) / 180)) / (512 * Math.pow(2, map.getZoom()));
  const D = camToCenterPx * metresPerPx;
  const alt = Math.max(1, D * Math.cos(pitch));
  const back = D * Math.sin(pitch);
  // camera sits "behind" the centre, opposite to the viewing direction
  const dx = -Math.sin(bearing) * back;
  const dy = -Math.cos(bearing) * back;
  return { lngLat: fromLocal([dx, dy], [c.lng, c.lat]), alt };
}

/** Fraction of the real height currently drawn (buildings grow in between zoom 13.2 and 15.4). */
function heightFactor(zoom: number) {
  return Math.max(0, Math.min(1, (zoom - 13.2) / 2.2));
}

interface Part {
  ring: Position[];
  poly: Position[][];
  h: number;
  b: number;
  minX: number;
  minY: number;
  maxX: number;
  maxY: number;
}

export function pickFootprint(map: MLMap, point: { x: number; y: number }, ground: LngLatTuple): PickedFootprint | null {
  const pad = 4;
  const box: [PointLike, PointLike] = [
    [point.x - pad, point.y - pad],
    [point.x + pad, point.y + pad],
  ];
  const feats = map.queryRenderedFeatures(box, { layers: ['buildings-3d'] });
  if (!feats.length) return null;

  const k = heightFactor(map.getZoom());
  const cam = cameraPosition(map);
  let hMax = 0;
  for (const f of feats) hMax = Math.max(hMax, (Number(f.properties?.render_height) || 0) * k);

  // segment of the ray between ground point and roof height — used to pre-filter footprints by bbox
  const t = Math.min(1, hMax / cam.alt);
  const top: LngLatTuple = [ground[0] + (cam.lngLat[0] - ground[0]) * t, ground[1] + (cam.lngLat[1] - ground[1]) * t];
  const sMinX = Math.min(ground[0], top[0]);
  const sMaxX = Math.max(ground[0], top[0]);
  const sMinY = Math.min(ground[1], top[1]);
  const sMaxY = Math.max(ground[1], top[1]);

  const parts: Part[] = [];
  for (const f of feats) {
    const h = (Number(f.properties?.render_height) || 0) * k;
    const b = (Number(f.properties?.render_min_height) || 0) * k;
    for (const poly of polygonParts(f.geometry)) {
      const ring = poly[0];
      if (!ring?.length) continue;
      let minX = Infinity;
      let minY = Infinity;
      let maxX = -Infinity;
      let maxY = -Infinity;
      for (const p of ring) {
        if (p[0] < minX) minX = p[0];
        if (p[0] > maxX) maxX = p[0];
        if (p[1] < minY) minY = p[1];
        if (p[1] > maxY) maxY = p[1];
      }
      if (maxX < sMinX || minX > sMaxX || maxY < sMinY || minY > sMaxY) continue;
      parts.push({ ring, poly, h, b, minX, minY, maxX, maxY });
    }
  }
  if (!parts.length) return null;

  const step = Math.max(0.4, hMax / 80);
  for (let z = hMax; z >= 0; z -= step) {
    const f = z / cam.alt;
    const P: LngLatTuple = [ground[0] + (cam.lngLat[0] - ground[0]) * f, ground[1] + (cam.lngLat[1] - ground[1]) * f];
    for (const part of parts) {
      if (part.h < z || part.b > z) continue;
      if (P[0] < part.minX || P[0] > part.maxX || P[1] < part.minY || P[1] > part.maxY) continue;
      if (pointInRing(P, part.ring)) {
        return { polygon: part.poly, height: part.h / (k || 1), base: part.b / (k || 1) };
      }
    }
  }

  // fallback: the footprint closest to the ground point
  let best: Part | null = null;
  let bestD = Infinity;
  for (const part of parts) {
    const c = centroid({ type: 'Polygon', coordinates: part.poly });
    if (!c) continue;
    const d = distanceM(c, ground);
    if (d < bestD) {
      bestD = d;
      best = part;
    }
  }
  return best && bestD < 40 ? { polygon: best.poly, height: best.h / (k || 1), base: best.b / (k || 1) } : null;
}
