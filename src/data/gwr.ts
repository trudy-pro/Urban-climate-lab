import type { Position } from 'geojson';
import { distanceM, pointInRing, type LngLatTuple } from '../map/geo';

/**
 * Official Swiss Federal Register of Buildings and Dwellings (GWR) for Basel-Stadt,
 * published on Open Data Basel-Stadt (dataset 100230 buildings, 100231 entrances / addresses).
 * Coordinates are Swiss LV95; converted with swisstopo's approximate formulas (~1 m accuracy).
 */
const BASE = 'https://data.bs.ch/api/explore/v2.1/catalog/datasets';

export interface GwrBuilding {
  egid: number;
  gbauj: number | null;
  gbaup_decoded: string | null;
  gastw: number | null;
  garea: number | null;
  ganzwhg: number | null;
  gkat_decoded: string | null;
  gklas_decoded: string | null;
  gstat_decoded: string | null;
  gwaerzh1_decoded: string | null;
  genh1_decoded: string | null;
  genw1_decoded: string | null;
  gkode: number;
  gkodn: number;
  address?: string | null;
}

export function wgsToLv95(lng: number, lat: number): [number, number] {
  const p = (lat * 3600 - 169028.66) / 10000;
  const l = (lng * 3600 - 26782.5) / 10000;
  const E = 2600072.37 + 211455.93 * l - 10938.51 * l * p - 0.36 * l * p * p - 44.54 * l ** 3;
  const N = 1200147.07 + 308807.95 * p + 3745.25 * l * l + 76.63 * p * p - 194.56 * l * l * p + 119.79 * p ** 3;
  return [E, N];
}

export function lv95ToWgs(E: number, N: number): LngLatTuple {
  const y = (E - 2600000) / 1e6;
  const x = (N - 1200000) / 1e6;
  const lng = 2.6779094 + 4.728982 * y + 0.791484 * y * x + 0.1306 * y * x * x - 0.0436 * y ** 3;
  const lat = 16.9023892 + 3.238272 * x - 0.270978 * y * y - 0.002528 * x * x - 0.0447 * y * y * x - 0.014 * x ** 3;
  return [(lng * 100) / 36, (lat * 100) / 36];
}

const FIELDS =
  'egid,gkode,gkodn,gbauj,gbaup_decoded,gastw,garea,ganzwhg,gkat_decoded,gklas_decoded,gstat_decoded,gwaerzh1_decoded,genh1_decoded,genw1_decoded';

/** Finds the registered building whose reference point lies inside the clicked footprint. */
export async function fetchGwrBuilding(
  footprint: Position[][] | null,
  click: LngLatTuple,
  signal?: AbortSignal,
): Promise<GwrBuilding | null> {
  const [E, N] = wgsToLv95(click[0], click[1]);
  const r = 45;
  const where = `gkode>=${(E - r).toFixed(0)} and gkode<=${(E + r).toFixed(0)} and gkodn>=${(N - r).toFixed(0)} and gkodn<=${(N + r).toFixed(0)}`;
  const qs = new URLSearchParams({ where, select: FIELDS, limit: '100' });
  const res = await fetch(`${BASE}/100230/records?${qs}`, { signal });
  if (!res.ok) throw new Error(`GWR ${res.status}`);
  const json = (await res.json()) as { results: GwrBuilding[] };
  const existing = json.results.filter((b) => !/abgebrochen/i.test(b.gstat_decoded ?? ''));

  let match: GwrBuilding | null = null;
  if (footprint?.[0]) {
    match = existing.find((b) => pointInRing(lv95ToWgs(b.gkode, b.gkodn), footprint[0])) ?? null;
  }
  if (!match) {
    let best = Infinity;
    for (const b of existing) {
      const d = distanceM(lv95ToWgs(b.gkode, b.gkodn), click);
      if (d < best && d < 14) {
        best = d;
        match = b;
      }
    }
  }
  if (!match) return null;

  try {
    const aq = new URLSearchParams({ where: `egid=${match.egid}`, select: 'strname,deinr,dplz4,dplzname', limit: '5' });
    const ar = await fetch(`${BASE}/100231/records?${aq}`, { signal });
    const aj = (await ar.json()) as { results: { strname?: string; deinr?: string; dplz4?: number; dplzname?: string }[] };
    const a = aj.results[0];
    match.address = a?.strname ? `${a.strname} ${a.deinr ?? ''}`.trim() + (a.dplz4 ? `, ${a.dplz4} ${a.dplzname ?? ''}` : '') : null;
  } catch (e) {
    if ((e as Error).name === 'AbortError') throw e;
    match.address = null;
  }
  return match;
}
