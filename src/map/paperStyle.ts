import type { ExpressionSpecification, StyleSpecification } from 'maplibre-gl';
import { OPENFREEMAP_GLYPHS, OPENFREEMAP_TILEJSON } from '../config';
import { INK, PATTERNS } from './illustration';

/**
 * Illustrated "paper" style on top of OpenFreeMap's OpenMapTiles-schema vector tiles:
 * pale grey-green ground, sage washes with hand-drawn tree / meadow / furrow marks, white paths.
 * Buildings come from OpenStreetMap; heights from `render_height` (OSM height or levels where tagged).
 */
export const COLORS = {
  bg: INK.paper,
  land: INK.paper,
  green: INK.wash,
  greenWet: '#9eab78',
  water: INK.water,
  waterEdge: INK.waterEdge,
  roadMinor: '#f6f6f0',
  roadMajor: INK.road,
  roadCasing: '#cfd2c2',
  buildingFlat: '#d6d7cb',
  buildingLow: '#eeede6',
  buildingHigh: '#d9d9cf',
  buildingWetLow: '#d9dcd6',
  buildingWetHigh: '#c3c9c6',
  label: '#4f5645',
  labelHalo: '#e4e5db',
};

export const STREET_COLORS = {
  roadMinor: '#f9f9f4',
  roadMajor: '#ffffff',
  roadWetMinor: '#dfe6e6',
  roadWetMajor: '#e6eded',
  buildingLow: '#f2f0e8',
  buildingHigh: '#dedcd2',
  buildingWetLow: '#dde1dc',
  buildingWetHigh: '#c9cfcb',
  glow: '#7fb4cd',
  line: '#3f7d9d',
};

/** Fade the street palette in as the camera reaches building scale. */
export function streetPaint(overview: string | ExpressionSpecification, street: string | ExpressionSpecification): ExpressionSpecification {
  return ['interpolate', ['linear'], ['zoom'], 15.25, overview, 17.3, street];
}

export const BUILDING_EXTRUSION_COLOR = (low: string, high: string): ExpressionSpecification =>
  [
    'case',
    ['boolean', ['feature-state', 'selected'], false],
    '#c9774a',
    ['boolean', ['feature-state', 'hover'], false],
    '#cfc6a6',
    ['interpolate', ['linear'], ['coalesce', ['get', 'render_height'], 8], 0, low, 22, low, 60, high],
  ];

const roadWidth = (base: number, top: number) =>
  ['interpolate', ['exponential', 1.6], ['zoom'], 11, base, 14, base * 3, 18, top] as unknown as number;

export function buildStyle(): StyleSpecification {
  return {
    version: 8,
    name: 'Basel Paper',
    glyphs: OPENFREEMAP_GLYPHS,
    transition: { duration: 900, delay: 0 },
    sources: {
      omt: {
        type: 'vector',
        url: OPENFREEMAP_TILEJSON,
        attribution:
          '<a href="https://openfreemap.org" target="_blank" rel="noopener">OpenFreeMap</a> · <a href="https://www.openmaptiles.org/" target="_blank" rel="noopener">© OpenMapTiles</a> · Data © <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noopener">OpenStreetMap contributors</a>',
      },
    },
    sky: {
      'sky-color': '#e9eae2',
      'horizon-color': '#dfe1d5',
      'fog-color': '#e4e5dd',
      'fog-ground-blend': 0.55,
      'horizon-fog-blend': 0.7,
      'sky-horizon-blend': 0.6,
      'atmosphere-blend': 0.5,
    },
    light: { anchor: 'viewport', color: '#fffaf0', intensity: 0.38, position: [1.4, 205, 35] },
    layers: [
      { id: 'background', type: 'background', paint: { 'background-color': COLORS.land } },
      {
        id: 'landuse-residential',
        type: 'fill',
        source: 'omt',
        'source-layer': 'landuse',
        filter: ['in', ['get', 'class'], ['literal', ['residential', 'commercial', 'industrial', 'retail']]],
        paint: { 'fill-color': '#dddfd3', 'fill-opacity': 0.7 },
      },
      // soft watercolour bleed around every green mass
      ...([
        ['landcover', ['grass', 'wood', 'farmland', 'wetland']],
        ['park', null],
      ] as const).map(([layer, classes]) => ({
        id: `green-bleed-${layer}`,
        type: 'line' as const,
        source: 'omt',
        'source-layer': layer,
        ...(classes ? { filter: ['in', ['get', 'class'], ['literal', classes]] as unknown as boolean } : {}),
        paint: {
          'line-color': INK.wash,
          'line-width': ['interpolate', ['linear'], ['zoom'], 11, 3, 15, 10, 18, 22] as unknown as number,
          'line-blur': ['interpolate', ['linear'], ['zoom'], 11, 3, 15, 10, 18, 22] as unknown as number,
          'line-opacity': 0.55,
        },
      })),
      {
        id: 'landcover-green',
        type: 'fill',
        source: 'omt',
        'source-layer': 'landcover',
        filter: ['in', ['get', 'class'], ['literal', ['grass', 'wood', 'farmland', 'wetland']]],
        paint: { 'fill-color': COLORS.green, 'fill-opacity': 0.85, 'fill-color-transition': { duration: 1200 } },
      },
      {
        id: 'park',
        type: 'fill',
        source: 'omt',
        'source-layer': 'park',
        paint: { 'fill-color': COLORS.green, 'fill-opacity': 0.85, 'fill-color-transition': { duration: 1200 } },
      },
      {
        id: 'landuse-green',
        type: 'fill',
        source: 'omt',
        'source-layer': 'landuse',
        filter: ['in', ['get', 'class'], ['literal', ['cemetery', 'pitch', 'playground', 'garden', 'stadium']]],
        paint: { 'fill-color': COLORS.green, 'fill-opacity': 0.7, 'fill-color-transition': { duration: 1200 } },
      },
      // hand-drawn marks: conifers in woods, olive strokes in meadows & parks, dark furrows in fields
      {
        id: 'marks-forest',
        type: 'fill',
        source: 'omt',
        'source-layer': 'landcover',
        filter: ['==', ['get', 'class'], 'wood'],
        paint: { 'fill-pattern': PATTERNS.forest, 'fill-opacity': ['interpolate', ['linear'], ['zoom'], 10, 0.55, 13, 0.95] },
      },
      {
        id: 'marks-meadow',
        type: 'fill',
        source: 'omt',
        'source-layer': 'landcover',
        filter: ['in', ['get', 'class'], ['literal', ['grass', 'wetland']]],
        paint: { 'fill-pattern': PATTERNS.meadow, 'fill-opacity': ['interpolate', ['linear'], ['zoom'], 10, 0.5, 13, 0.9] },
      },
      {
        id: 'marks-park',
        type: 'fill',
        source: 'omt',
        'source-layer': 'park',
        paint: { 'fill-pattern': PATTERNS.meadow, 'fill-opacity': 0.8 },
      },
      {
        id: 'marks-furrow',
        type: 'fill',
        source: 'omt',
        'source-layer': 'landcover',
        filter: ['==', ['get', 'class'], 'farmland'],
        paint: { 'fill-pattern': PATTERNS.furrow, 'fill-opacity': 0.8 },
      },
      {
        id: 'marks-garden',
        type: 'fill',
        source: 'omt',
        'source-layer': 'landuse',
        filter: ['in', ['get', 'class'], ['literal', ['cemetery', 'garden', 'allotments']]],
        paint: { 'fill-pattern': PATTERNS.furrow, 'fill-opacity': 0.55 },
      },
      {
        id: 'water',
        type: 'fill',
        source: 'omt',
        'source-layer': 'water',
        paint: { 'fill-color': COLORS.water },
      },
      {
        id: 'water-edge',
        type: 'line',
        source: 'omt',
        'source-layer': 'water',
        paint: {
          'line-color': COLORS.waterEdge,
          'line-width': ['interpolate', ['linear'], ['zoom'], 11, 0.6, 16, 1.6],
          'line-blur': 1.2,
          'line-opacity': 0.6,
        },
      },
      {
        id: 'city-river-tint',
        type: 'fill',
        source: 'omt',
        'source-layer': 'water',
        filter: ['==', ['get', 'class'], 'river'],
        layout: { visibility: 'none' },
        paint: { 'fill-color': '#6fa3bb', 'fill-opacity': 0.25 },
      },
      ...(['glow', 'centre'] as const).map((kind) => ({
        id: `city-rhine-${kind}`,
        type: 'line' as const,
        source: 'omt',
        'source-layer': 'waterway',
        filter: ['in', ['get', 'name'], ['literal', ['Rhein', 'Rhine']]] as unknown as boolean,
        layout: { 'visibility': 'none' as const, 'line-cap': 'round' as const, 'line-join': 'round' as const },
        paint: kind === 'glow' ? {
          'line-color': '#7fb4cc', 'line-opacity': 0.55, 'line-width': 10, 'line-blur': 9,
        } : {
          'line-color': '#3f7d9c', 'line-opacity': 0.7, 'line-width': 1.6, 'line-dasharray': [2.2, 4.6],
        },
      })),
      {
        id: 'waterway',
        type: 'line',
        source: 'omt',
        'source-layer': 'waterway',
        paint: { 'line-color': COLORS.waterEdge, 'line-opacity': 0.5, 'line-width': 1 },
      },
      {
        id: 'rail',
        type: 'line',
        source: 'omt',
        'source-layer': 'transportation',
        filter: ['in', ['get', 'class'], ['literal', ['rail', 'transit']]],
        paint: { 'line-color': '#9a9e8c', 'line-width': 1, 'line-dasharray': [3, 2] },
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
        paint: { 'line-color': COLORS.roadCasing, 'line-width': roadWidth(1.6, 30), 'line-blur': roadWidth(1, 8), 'line-opacity': 0.45 },
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
          'line-opacity': ['interpolate', ['linear'], ['zoom'], 11, 0.6, 14, 1],
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
          'fill-outline-color': '#c4c6b8',
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
          'fill-extrusion-height': [
            'interpolate',
            ['linear'],
            ['zoom'],
            13.2,
            0,
            15.4,
            ['coalesce', ['get', 'render_height'], 0],
          ],
          'fill-extrusion-base': [
            'interpolate',
            ['linear'],
            ['zoom'],
            13.2,
            0,
            15.4,
            ['coalesce', ['get', 'render_min_height'], 0],
          ],
          'fill-extrusion-opacity': ['interpolate', ['linear'], ['zoom'], 13, 0, 14.2, 0.95],
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
        paint: { 'text-color': '#3f7d9a', 'text-halo-color': COLORS.labelHalo, 'text-halo-width': 1 },
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
          'text-color': ['match', ['get', 'class'], 'city', '#3b4232', '#6a705c'],
          'text-halo-color': COLORS.labelHalo,
          'text-halo-width': 1.2,
          'text-opacity': ['interpolate', ['linear'], ['zoom'], 11, 0.9, 15, 0.6, 16, 0],
        },
      },
    ],
  };
}
