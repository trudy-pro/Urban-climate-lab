import { pointInRing, distanceM, type LngLatTuple } from '../map/geo';

export interface OsmBuilding {
  id: number;
  type: 'way' | 'relation';
  tags: Record<string, string>;
}

const ENDPOINTS = ['https://overpass-api.de/api/interpreter', 'https://overpass.kumi.systems/api/interpreter'];

/**
 * Looks up the real OpenStreetMap building (tags only) that contains the clicked point.
 * Returns null when nothing is found — callers show "Data unavailable".
 */
export async function fetchOsmBuilding(
  lngLat: LngLatTuple,
  signal?: AbortSignal,
): Promise<OsmBuilding | null> {
  const [lng, lat] = lngLat;
  const q = `[out:json][timeout:12];way["building"](around:30,${lat},${lng});out tags geom;`;
  let lastErr: unknown;
  for (const url of ENDPOINTS) {
    try {
      const res = await fetch(url, {
        method: 'POST',
        body: 'data=' + encodeURIComponent(q),
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        signal,
      });
      if (!res.ok) throw new Error(`Overpass ${res.status}`);
      const json = (await res.json()) as {
        elements: { id: number; type: 'way'; tags?: Record<string, string>; geometry?: { lat: number; lon: number }[] }[];
      };
      let best: OsmBuilding | null = null;
      let bestD = Infinity;
      for (const el of json.elements) {
        if (!el.geometry?.length) continue;
        const ring = el.geometry.map((g) => [g.lon, g.lat]);
        if (pointInRing([lng, lat], ring)) return { id: el.id, type: 'way', tags: el.tags ?? {} };
        const c = ring.reduce((a, p) => [a[0] + p[0] / ring.length, a[1] + p[1] / ring.length], [0, 0]);
        const d = distanceM(lngLat, c as LngLatTuple);
        if (d < bestD && d < 12) {
          bestD = d;
          best = { id: el.id, type: 'way', tags: el.tags ?? {} };
        }
      }
      return best;
    } catch (e) {
      if ((e as Error).name === 'AbortError') throw e;
      lastErr = e;
    }
  }
  throw lastErr ?? new Error('Overpass unavailable');
}

const BUILDING_TYPES: Record<string, string> = {
  yes: '',
  residential: 'Residential',
  apartments: 'Apartments',
  house: 'House',
  detached: 'Detached house',
  semidetached_house: 'Semi-detached house',
  terrace: 'Terraced house',
  commercial: 'Commercial',
  retail: 'Retail',
  office: 'Office',
  industrial: 'Industrial',
  church: 'Church',
  school: 'School',
  university: 'University',
  hospital: 'Hospital',
  public: 'Public building',
  civic: 'Civic',
  garage: 'Garage',
  garages: 'Garages',
  shed: 'Shed',
  roof: 'Roof structure',
  hotel: 'Hotel',
  kindergarten: 'Kindergarten',
};

export function describeBuildingType(v?: string): string | null {
  if (!v) return null;
  if (v in BUILDING_TYPES) return BUILDING_TYPES[v] || null;
  return v.charAt(0).toUpperCase() + v.slice(1).replace(/_/g, ' ');
}
