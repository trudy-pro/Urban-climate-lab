export interface CameraView {
  center: [number, number];
  zoom: number;
  pitch: number;
  bearing: number;
}

/** Stage 1 — Basel city overview (Grossbasel / Kleinbasel, Rhine bend). */
export const OVERVIEW: CameraView = {
  center: [7.5935, 47.5605],
  zoom: 12.85,
  pitch: 50,
  bearing: -22,
};

/** Stage 2 — neighbourhood approach over Steinenvorstadt / Schützenmatt. */
export const NEIGHBORHOOD: CameraView = {
  center: [7.5838, 47.5537],
  zoom: 15.0,
  pitch: 57,
  bearing: -4,
};

/**
 * Stage 3 — Paulusgasse / Therwilerstrasse (Bachletten, Basel).
 * Geocoded from OpenStreetMap (Nominatim); MapBS reference point LV95 2611618 / 1267718.
 */
export const TARGET: CameraView = {
  center: [7.5776, 47.5514],
  zoom: 17.45,
  pitch: 64,
  bearing: 28,
};

/** Radius around TARGET (m) inside which the environmental tools unlock. */
export const ARRIVAL_RADIUS_M = 1400;
export const ARRIVAL_MIN_ZOOM = 15.3;

export const OPENFREEMAP_TILEJSON = 'https://tiles.openfreemap.org/planet';
export const OPENFREEMAP_GLYPHS = 'https://tiles.openfreemap.org/fonts/{fontstack}/{range}.pbf';

/** Kanton Basel-Stadt geodata (MapBS / geo.bs.ch) */
export const BS_WMS = 'https://wms.geo.bs.ch/';
export const BS_BOUNDS: [number, number, number, number] = [7.55, 47.515, 7.70, 47.605];
export const MAPBS_LINK =
  'https://map.geo.bs.ch/?lang=de&baselayer_ref=Grundkarte%20farbig&map_x=2611618&map_y=1267718&map_zoom=4&tree_groups=Stadtklima%20Basel-Stadt%2CBaumkataster';

/** Open Data Basel-Stadt — Baumkataster (dataset 100052) */
export const TREES_EXPORT =
  'https://data.bs.ch/api/explore/v2.1/catalog/datasets/100052/exports/geojson';

export interface ClimateLayer {
  id: string;
  /** WMS layer name for today's analysis */
  wms: string;
  /** WMS layer name for the 2030 scenario, if published */
  wms2030?: string;
  label: string;
  unit?: string;
  time: string;
  description: string;
  /** Gradient used for the relative legend (raster legends are not published as values). */
  ramp?: string[];
  opacity: number;
}

export const CLIMATE_LAYERS: ClimateLayer[] = [
  {
    id: 'heat',
    wms: 'KL_Waermeinseleffekt',
    wms2030: 'KL_Waermeinseleffekt_2030',
    label: 'Urban heat island',
    unit: 'K',
    time: 'Night, 04:00',
    description:
      'Temperature difference compared to the cooler surroundings — Klimaanalyse Basel-Stadt.',
    ramp: ['#fffbd0', '#ffe066', '#ffb347', '#f47c3c', '#d9412b'],
    opacity: 0.62,
  },
  {
    id: 'pet',
    wms: 'KL_HumanbioklimaSituation',
    wms2030: 'KL_HumanbioklimaSituation_2030',
    label: 'Daytime heat stress (PET)',
    unit: 'PET',
    time: 'Day, 14:00',
    description: 'Physiologically equivalent temperature — how hot the street feels to people.',
    opacity: 0.62,
  },
  {
    id: 'air',
    wms: 'KL_Lufttemperatur',
    wms2030: 'KL_Lufttemperatur_2030',
    label: 'Air temperature',
    unit: '°C',
    time: 'Night, 04:00',
    description: 'Modelled near-ground air temperature during a summer night.',
    opacity: 0.6,
  },
  {
    id: 'coldair',
    wms: 'KL_Kaltluftvolumenstrom',
    wms2030: 'KL_Kaltluftvolumenstrom_2030',
    label: 'Cold-air flow',
    unit: 'm³/s·m',
    time: 'Night, 04:00',
    description: 'Volume of cool night air moving through streets and green corridors.',
    opacity: 0.66,
  },
  {
    id: 'wind',
    wms: 'KL_Windstroemungsfeld',
    wms2030: 'KL_Windstroemungsfeld_2030',
    label: 'Wind flow field',
    unit: 'm/s',
    time: 'Night, 04:00',
    description: 'Direction and speed of the night-time flow field.',
    opacity: 0.85,
  },
  {
    id: 'focus',
    wms: 'ch.bs.fokusgebiet_hitzeentwicklung_fgsk',
    label: 'Focus areas (Stadtklimakonzept)',
    time: 'Climate analysis 2019',
    description:
      'Areas most affected by urban heat islands, and where the situation should be kept or improved.',
    opacity: 0.55,
  },
  {
    id: 'areal',
    wms: 'KL_Arealentwicklung_2030',
    label: 'Area development 2030',
    time: 'Scenario 2030',
    description: 'Development sites assumed in the 2030 climate scenario.',
    opacity: 0.6,
  },
];

export function wmsTileUrl(layer: string): string {
  return (
    `${BS_WMS}?SERVICE=WMS&VERSION=1.3.0&REQUEST=GetMap&LAYERS=${encodeURIComponent(layer)}` +
    `&STYLES=&CRS=EPSG:3857&BBOX={bbox-epsg-3857}&WIDTH=512&HEIGHT=512&FORMAT=image/png&TRANSPARENT=true`
  );
}

export function wmsLegendJsonUrl(layer: string): string {
  return `${BS_WMS}?SERVICE=WMS&VERSION=1.3.0&REQUEST=GetLegendGraphic&LAYER=${encodeURIComponent(
    layer,
  )}&FORMAT=application/json&STYLE=default`;
}
