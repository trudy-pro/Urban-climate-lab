import type { FeatureCollection, Point } from 'geojson';
import { STATIONS_EXPORT } from '../config';

export interface StationProps {
  id: string;
  name: string;
  time: string;
  temp: number | null;
}

export type StationCollection = FeatureCollection<Point, StationProps>;

interface Row {
  name_original: string;
  name_custom?: string | null;
  dates_max_date: string;
  meta_airtemp?: number | null;
  coords?: { lon: number; lat: number } | null;
}

/**
 * Latest reading per sensor from the meteoblue City Climate network
 * (Open Data Basel-Stadt, "Smart Climate Luftklima", dataset 100009; updated every 15 min).
 */
export async function fetchStations(signal?: AbortSignal): Promise<StationCollection> {
  const params = new URLSearchParams({
    select: 'name_original,name_custom,dates_max_date,meta_airtemp,coords',
    where: 'dates_max_date >= now(hours=-3)',
    order_by: 'dates_max_date desc',
    limit: '-1',
  });
  const res = await fetch(`${STATIONS_EXPORT}?${params}`, { signal });
  if (!res.ok) throw new Error(`City Climate network ${res.status}`);
  const rows = (await res.json()) as Row[];
  const seen = new Set<string>();
  const fc: StationCollection = { type: 'FeatureCollection', features: [] };
  for (const r of rows) {
    if (seen.has(r.name_original) || !r.coords) continue;
    seen.add(r.name_original);
    fc.features.push({
      type: 'Feature',
      id: fc.features.length + 1,
      geometry: { type: 'Point', coordinates: [r.coords.lon, r.coords.lat] },
      properties: {
        id: r.name_original,
        name: r.name_custom || r.name_original,
        time: r.dates_max_date,
        temp: r.meta_airtemp ?? null,
      },
    });
  }
  return fc;
}
