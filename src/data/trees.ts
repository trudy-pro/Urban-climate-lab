import type { FeatureCollection, Point } from 'geojson';
import { TREES_EXPORT } from '../config';

export interface TreeProps {
  ba_baumnr?: string;
  baumart_lateinisch?: string;
  baumart_deutsch?: string;
  ba_baumalter?: number | null;
  ba_standjahr?: number | null;
  ba_schutzstatus?: string | null;
  ba_strasse?: string | null;
  ba_gruppe?: string | null;
  ba_gemeinde?: string | null;
}

export type TreeCollection = FeatureCollection<Point, TreeProps>;

const FIELDS = [
  'ba_baumnr',
  'baumart_lateinisch',
  'baumart_deutsch',
  'ba_baumalter',
  'ba_standjahr',
  'ba_schutzstatus',
  'ba_strasse',
  'ba_gruppe',
  'ba_gemeinde',
  'geo_point_2d',
];

/**
 * Real tree positions from the Basel-Stadt tree cadastre (Open Data Basel-Stadt, dataset 100052),
 * loaded for the area around the camera.
 */
export async function fetchTrees(
  center: [number, number],
  radiusM: number,
  signal?: AbortSignal,
): Promise<TreeCollection> {
  const params = new URLSearchParams({
    select: FIELDS.join(','),
    where: `within_distance(geo_point_2d, geom'POINT(${center[0].toFixed(6)} ${center[1].toFixed(6)})', ${Math.round(
      radiusM,
    )}m)`,
    limit: '-1',
  });
  const res = await fetch(`${TREES_EXPORT}?${params}`, { signal });
  if (!res.ok) throw new Error(`Tree cadastre ${res.status}`);
  const fc = (await res.json()) as TreeCollection;
  fc.features = fc.features.filter((f) => f.geometry?.type === 'Point');
  fc.features.forEach((f, i) => {
    f.id = i + 1;
  });
  return fc;
}
