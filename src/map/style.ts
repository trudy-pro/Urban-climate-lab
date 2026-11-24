import type { ExpressionSpecification, StyleSpecification } from 'maplibre-gl';
import { OPENFREEMAP_GLYPHS, OPENFREEMAP_TILEJSON } from '../config';

/**
 * Custom dark "navy / charcoal" style on top of OpenFreeMap's OpenMapTiles-schema vector tiles.
 * Buildings come from OpenStreetMap; heights from `render_height` (OSM height or levels where tagged).
 */
export const COLORS = {
  bg: '#060a12',
  land: '#080d17',
  green: '#0a111d',
  greenWet: '#0d2420',
  water: '#5a87b9',
  waterEdge: '#8fadc8',
  waterShallow: '#6b98c3',
  roadMinor: '#141d2c',
  roadMajor: '#1b2639',
  roadCasing: '#0a0f19',
  buildingFlat: '#101827',
  buildingLow: '#141e30',
  buildingHigh: '#26395a',
  buildingWetLow: '#14233a',
  buildingWetHigh: '#2a4670',
  label: '#7d8aa3',
  labelHalo: '#060a12',
};

export const STREET_COLORS = {
  roadMinor: '#19263a',
  roadMajor: '#223149',
  roadWetMinor: '#1b2c42',
  roadWetMajor: '#253a54',
  buildingLow: '#1d2c44',
  buildingHigh: '#2b4264',
  buildingWetLow: '#1c2f48',
  buildingWetHigh: '#2d496e',
  glow: '#168baf',
  line: '#39a8c6',
};

/** Fade the street palette in as the camera reaches building scale. */
export function streetPaint(overview: string | ExpressionSpecification, street: string | ExpressionSpecification): ExpressionSpecification {
  return ['interpolate', ['linear'], ['zoom'], 15.25, overview, 17.3, street];
}

export const BUILDING_EXTRUSION_COLOR = (low: string, high: string): ExpressionSpecification =>
  [
    'case',
    ['boolean', ['feature-state', 'selected'], false],
    '#7fdcff',
    ['boolean', ['feature-state', 'hover'], false],
    '#3a5a86',
    ['interpolate', ['linear'], ['coalesce', ['get', 'render_height'], 8], 0, low, 22, low, 60, high],
  ];

const roadWidth = (base: number, top: number) =>
  ['interpolate', ['exponential', 1.6], ['zoom'], 11, base, 14, base * 3, 18, top] as unknown as number;

export function buildStyle(): StyleSpecification {
  return {
    version: 8,
    name: 'Basel Night',
    glyphs: OPENFREEMAP_GLYPHS,
    transition: { duration: 900, delay: 0 },
    sources: {
      omt: {
        type: 'vector',
        url: OPENFREEMAP_TILEJSON,
        attribution:
          '<a href="https://openfreemap.org" target="_blank" rel="noopener">OpenFreeMap</a> · <a href="https://www.openmaptiles.org/" target="_blank" rel="noopener">© OpenMapTiles</a> · Data © <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noopener">OpenStreetMap contributors</a>',
      },
      dem: {
        type: 'raster-dem',
        tiles: ['https://s3.amazonaws.com/elevation-tiles-prod/terrarium/{z}/{x}/{y}.png'],
        encoding: 'terrarium',
        tileSize: 256,
        maxzoom: 15,
        attribution: 'Terrain: <a href="https://registry.opendata.aws/terrain-tiles/" target="_blank" rel="noopener">AWS Terrain Tiles</a>',
      },
    },
    sky: {
      'sky-color': '#060a12',
      'horizon-color': '#15233b',
      'fog-color': '#0a1222',
      'fog-ground-blend': 0.55,
      'horizon-fog-blend': 0.7,
      'sky-horizon-blend': 0.6,
      'atmosphere-blend': 0.5,
    },
    light: { anchor: 'viewport', color: '#d4e3ff', intensity: 0.45, position: [1.3, 215, 45] },
    layers: [
      { id: 'background', type: 'background', paint: { 'background-color': COLORS.land } },
      {
        id: 'landuse-residential',
        type: 'fill',
        source: 'omt',
        'source-layer': 'landuse',
        filter: ['in', ['get', 'class'], ['literal', ['residential', 'commercial', 'industrial', 'retail']]],
        paint: { 'fill-color': '#090f1a', 'fill-opacity': 0.8 },
      },
      {
        id: 'landcover-green',
        type: 'fill',
        source: 'omt',
        'source-layer': 'landcover',
        filter: ['in', ['get', 'class'], ['literal', ['grass', 'wood', 'farmland', 'wetland']]],
        paint: { 'fill-color': COLORS.green, 'fill-opacity': 0.9, 'fill-color-transition': { duration: 1200 } },
      },
      {
        id: 'park',
        type: 'fill',
        source: 'omt',
        'source-layer': 'park',
        paint: { 'fill-color': COLORS.green, 'fill-opacity': 0.9, 'fill-color-transition': { duration: 1200 } },
      },
      {
        id: 'landuse-green',
        type: 'fill',
        source: 'omt',
        'source-layer': 'landuse',
        filter: ['in', ['get', 'class'], ['literal', ['cemetery', 'pitch', 'playground', 'garden', 'stadium']]],
        paint: { 'fill-color': COLORS.green, 'fill-opacity': 0.7, 'fill-color-transition': { duration: 1200 } },
      },
      {
        // dark relief shading: hills and valleys shown by light and shadow only, in one navy tone
        id: 'hillshade',
        type: 'hillshade',
        source: 'dem',
        paint: {
          'hillshade-exaggeration': 0.75,
          'hillshade-shadow-color': '#020409',
          'hillshade-highlight-color': '#1f2d44',
          'hillshade-accent-color': '#070c16',
          'hillshade-illumination-direction': 315,
        },
      },
      {
        id: 'water',
        type: 'fill',
        source: 'omt',
        'source-layer': 'water',
        paint: { 'fill-color': COLORS.water, 'fill-antialias': true },
      },
      {
        // lighter, shallower water along the shores
        id: 'water-shallow',
        type: 'line',
        source: 'omt',
        'source-layer': 'water',
        paint: {
          'line-color': COLORS.waterShallow,
          'line-width': ['interpolate', ['exponential', 1.6], ['zoom'], 11, 2, 14, 6, 18, 26],
          'line-offset': ['interpolate', ['exponential', 1.6], ['zoom'], 11, 1, 14, 3, 18, 13],
          'line-blur': ['interpolate', ['exponential', 1.6], ['zoom'], 11, 2, 14, 5, 18, 20],
          'line-opacity': 0.85,
        },
      },
      {
        id: 'water-edge',
        type: 'line',
        source: 'omt',
        'source-layer': 'water',
        paint: {
          'line-color': COLORS.waterEdge,
          'line-width': ['interpolate', ['linear'], ['zoom'], 11, 0.8, 16, 2],
          'line-blur': 0.6,
          'line-opacity': 0.9,
        },
      },
      {
        id: 'waterway',
        type: 'line',
        source: 'omt',
        'source-layer': 'waterway',
        paint: {
          'line-color': COLORS.water,
          'line-opacity': 0.95,
          'line-width': ['interpolate', ['exponential', 1.6], ['zoom'], 11, 1, 14, 2.5, 18, 9],
        },
      },
      {
        id: 'rail',
        type: 'line',
        source: 'omt',
        'source-layer': 'transportation',
        filter: ['in', ['get', 'class'], ['literal', ['rail', 'transit']]],
        paint: { 'line-color': '#1a2232', 'line-width': 1, 'line-dasharray': [3, 2] },
      },
      {
        id: 'roads-casing',
        type: 'line',
        source: 'omt',
        'source-layer': 'transportation',
        minzoom: 14,
        filter: [
          'all',
          ['==', ['geometry-type'], 'LineString'],
          ['in', ['get', 'class'], ['literal', ['motorway', 'trunk', 'primary', 'secondary', 'tertiary', 'minor']]],
          ['!=', ['get', 'brunnel'], 'tunnel'],
        ],
        layout: { 'line-cap': 'round', 'line-join': 'round' },
        paint: { 'line-color': COLORS.roadCasing, 'line-width': roadWidth(1.2, 26), 'line-opacity': 0.9 },
      },
      {
        id: 'roads-minor',
        type: 'line',
        source: 'omt',
        'source-layer': 'transportation',
        filter: [
          'all',
          ['==', ['geometry-type'], 'LineString'],
          ['in', ['get', 'class'], ['literal', ['minor', 'service', 'track', 'path']]],
        ],
        layout: { 'line-cap': 'round', 'line-join': 'round' },
        paint: {
          'line-color': COLORS.roadMinor,
          'line-width': [
            'interpolate',
            ['exponential', 1.6],
            ['zoom'],
            12,
            ['match', ['get', 'class'], 'path', 0.2, 0.4],
            14,
            ['match', ['get', 'class'], 'path', 0.4, 1.2],
            18,
            ['match', ['get', 'class'], 'path', 2, 14],
          ],
          'line-opacity': ['interpolate', ['linear'], ['zoom'], 11, 0.35, 14, 1],
          'line-color-transition': { duration: 1200 },
        },
      },
      {
        id: 'roads-major',
        type: 'line',
        source: 'omt',
        'source-layer': 'transportation',
        filter: [
          'all',
          ['==', ['geometry-type'], 'LineString'],
          ['in', ['get', 'class'], ['literal', ['motorway', 'trunk', 'primary', 'secondary', 'tertiary']]],
        ],
        layout: { 'line-cap': 'round', 'line-join': 'round' },
        paint: {
          'line-color': COLORS.roadMajor,
          'line-width': roadWidth(0.8, 22),
          'line-opacity': ['case', ['==', ['get', 'brunnel'], 'tunnel'], 0.35, 1],
          'line-color-transition': { duration: 1200 },
        },
      },
      {
        id: 'building-flat',
        type: 'fill',
        source: 'omt',
        'source-layer': 'building',
        maxzoom: 15.5,
        paint: {
          'fill-color': COLORS.buildingFlat,
          'fill-outline-color': '#18233a',
          'fill-opacity': ['interpolate', ['linear'], ['zoom'], 11, 0.35, 13.5, 0.9, 15, 0],
        },
      },
      {
        id: 'buildings-3d',
        type: 'fill-extrusion',
        source: 'omt',
        'source-layer': 'building',
        minzoom: 13,
        filter: ['!=', ['get', 'hide_3d'], true],
        paint: {
          'fill-extrusion-color': BUILDING_EXTRUSION_COLOR(COLORS.buildingLow, COLORS.buildingHigh),
          // abstract map: buildings lie flat as footprints instead of 3D boxes
          'fill-extrusion-height': 0,
          'fill-extrusion-base': 0,
          'fill-extrusion-opacity': ['interpolate', ['linear'], ['zoom'], 13, 0, 14.2, 0.62],
          'fill-extrusion-vertical-gradient': true,
        },
      },
      {
        id: 'street-labels',
        type: 'symbol',
        source: 'omt',
        'source-layer': 'transportation_name',
        minzoom: 15.2,
        layout: {
          'symbol-placement': 'line',
          'text-field': ['coalesce', ['get', 'name:de'], ['get', 'name']],
          'text-font': ['Noto Sans Regular'],
          'text-size': ['interpolate', ['linear'], ['zoom'], 15, 10, 18, 13],
          'text-letter-spacing': 0.06,
          'text-max-angle': 30,
        },
        paint: {
          'text-color': COLORS.label,
          'text-halo-color': COLORS.labelHalo,
          'text-halo-width': 1.4,
          'text-opacity': 0.85,
        },
      },
      ...(['line', 'point'] as const).map((placement) => ({
        id: `water-labels-${placement}`,
        type: 'symbol' as const,
        source: 'omt',
        'source-layer': 'water_name',
        filter: ['==', ['geometry-type'], placement === 'line' ? 'LineString' : 'Point'] as unknown as boolean,
        layout: {
          'text-field': ['coalesce', ['get', 'name:de'], ['get', 'name']] as unknown as string,
          'text-font': ['Noto Sans Italic'],
          'text-size': 12,
          'text-letter-spacing': 0.25,
          'symbol-placement': placement,
        },
        paint: { 'text-color': '#eef7ff', 'text-halo-color': '#3f86c8', 'text-halo-width': 1.2 },
      })),
      {
        id: 'place-labels',
        type: 'symbol',
        source: 'omt',
        'source-layer': 'place',
        minzoom: 11,
        maxzoom: 16,
        filter: ['in', ['get', 'class'], ['literal', ['city', 'town', 'suburb', 'quarter', 'neighbourhood']]],
        layout: {
          'text-field': ['coalesce', ['get', 'name:de'], ['get', 'name']],
          'text-font': ['Noto Sans Regular'],
          'text-size': ['match', ['get', 'class'], 'city', 15, 'town', 13, 11],
          'text-transform': 'uppercase',
          'text-letter-spacing': 0.18,
          'text-max-width': 8,
        },
        paint: {
          'text-color': ['match', ['get', 'class'], 'city', '#a9b6cf', '#5d6a82'],
          'text-halo-color': COLORS.labelHalo,
          'text-halo-width': 1.2,
          'text-opacity': ['interpolate', ['linear'], ['zoom'], 11, 0.9, 15, 0.6, 16, 0],
        },
      },
    ],
  };
}
