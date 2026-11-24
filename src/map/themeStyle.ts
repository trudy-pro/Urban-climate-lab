import type { LayerSpecification, Map as MLMap, StyleSpecification } from 'maplibre-gl';
import { getTheme, subscribeTheme, type Theme } from '../theme';
import { buildStyle as nightStyle } from './style';
import { buildStyle as paperStyle } from './paperStyle';
import { INK } from './illustration';

type Layer = LayerSpecification & {
  paint?: Record<string, unknown>;
  layout?: Record<string, unknown>;
};

const styles = { dark: nightStyle(), light: paperStyle() };
const layers: Record<Theme, Map<string, Layer>> = {
  dark: new Map(styles.dark.layers.map((layer) => [layer.id, layer as Layer])),
  light: new Map(styles.light.layers.map((layer) => [layer.id, layer as Layer])),
};

const paperColors: Record<string, string> = {
  '#0a111d': INK.wash, '#0f3328': '#9eab78', '#0d2420': '#9eab78',
  '#7fdcff': '#c9774a', '#33507c': '#cfc6a7', '#3a5a86': '#cfc6a6',
  '#45dcf0': '#7fb4cb', '#168baf': '#7fb4cd', '#7fe9ff': '#3f7d9b', '#39a8c6': '#3f7d9d',
  '#3fd68f': '#8fa65a', '#d6ffe9': '#c9774b', '#46e09a': '#3d5e3e', '#0c3a27': '#24391f',
  '#e6edf8': '#2f3527', '#060a12': '#fbfbf7',
  '#2f8cff': '#2a5f8f', '#2f6fd0': '#2a5f8e', '#38d4ff': '#3f86b4', '#4ef0a2': '#4f7a3a',
  '#5aa8ff': '#3a74a3', '#5be1ff': '#4a93b8', '#62f5b0': '#5f8f45',
  '#e8fbff': '#fefefe', '#bff4ff': '#2f6f9a',
  'rgba(69, 220, 240, 0.12)': 'rgba(63, 125, 156, 0.12)',
};
const colorValue = (value: unknown, mode: Theme): unknown => {
  if (mode === 'dark') return value;
  if (typeof value === 'string') return paperColors[value.toLowerCase()] ?? value;
  if (Array.isArray(value)) return value.map((entry) => colorValue(entry, mode));
  return value;
};

export function buildThemedStyle(): StyleSpecification {
  const mode = getTheme();
  const order = [...layers.dark.keys()];
  const paperOrder = [...layers.light.keys()];
  for (const [index, id] of paperOrder.entries()) {
    if (layers.dark.has(id)) continue;
    const next = paperOrder.slice(index + 1).find((candidate) => layers.dark.has(candidate));
    order.splice(next ? order.indexOf(next) : order.length, 0, id);
  }
  return {
    ...styles[mode],
    sources: { ...styles.dark.sources, ...styles.light.sources },
    layers: order.map((id) => {
      const active = layers[mode].get(id);
      const layer = active ?? layers[mode === 'dark' ? 'light' : 'dark'].get(id)!;
      return active ? layer : { ...layer, layout: { ...layer.layout, visibility: 'none' } } as LayerSpecification;
    }),
  };
}

/** Apply theme paint to the same live map. The camera, sources, feature state and custom layers keep their identity. */
export function installMapTheme(map: MLMap) {
  const add = map.addLayer.bind(map);
  // MapLibre's setters are generic by layer type; the style specifications validate the keys here.
  type SetProperty = (id: string, key: string, value: unknown, options?: { validate?: boolean }) => MLMap;
  const paint = map.setPaintProperty.bind(map) as SetProperty;
  const layout = map.setLayoutProperty.bind(map) as SetProperty;
  const paints = new Map<string, Map<string, unknown>>();
  const visibility = new Map<string, string>();
  let applied = getTheme();

  map.addLayer = (layer, before) => {
    if (layer.type === 'custom') return add(layer, before);
    const spec = layer as Layer;
    if (spec.paint) paints.set(spec.id, new Map(Object.entries(spec.paint)));
    return add({
      ...spec,
      ...(spec.paint && { paint: Object.fromEntries(Object.entries(spec.paint).map(([key, value]) => [key, colorValue(value, getTheme())])) }),
    } as LayerSpecification, before);
  };

  map.setPaintProperty = (id, key, value, options) => {
    const overrides = paints.get(id) ?? new Map<string, unknown>();
    overrides.set(key, value);
    paints.set(id, overrides);
    return paint(id, key, colorValue(value, getTheme()), options);
  };

  map.setLayoutProperty = (id, key, value, options) => {
    if (key === 'visibility' && typeof value === 'string') {
      visibility.set(id, value);
      if (layers.light.has(id) && !layers.dark.has(id) && getTheme() === 'dark') {
        return layout(id, key, 'none', options);
      }
    }
    return layout(id, key, value, options);
  };

  const sync = () => {
    const mode = getTheme();
    if (mode === applied || !map.getLayer('background')) return;
    const previous = applied;
    applied = mode;
    for (const id of new Set([...layers.dark.keys(), ...layers.light.keys()])) {
      const next = layers[mode].get(id);
      const old = layers[previous].get(id);
      if (!next) {
        layout(id, 'visibility', 'none');
        continue;
      }
      if (old) {
        for (const key of new Set([...Object.keys(old.paint ?? {}), ...Object.keys(next.paint ?? {})])) {
          if (paints.get(id)?.has(key)) continue;
          paint(id, key, next.paint?.[key] ?? null, { validate: false });
        }
        for (const key of new Set([...Object.keys(old.layout ?? {}), ...Object.keys(next.layout ?? {})])) {
          if (key !== 'visibility') layout(id, key, next.layout?.[key] ?? null, { validate: false });
        }
        if ('filter' in old || 'filter' in next) map.setFilter(id, 'filter' in next ? next.filter ?? null : null, { validate: false });
        map.setLayerZoomRange(id, next.minzoom ?? 0, next.maxzoom ?? 24);
      }
      layout(id, 'visibility', visibility.get(id) ?? next.layout?.visibility ?? 'visible');
    }
    for (const [id, values] of paints) {
      if (!map.getLayer(id)) continue;
      for (const [key, value] of values) paint(id, key, colorValue(value, mode), { validate: false });
    }
    map.setSky(styles[mode].sky!);
    map.setLight(styles[mode].light!);
    map.triggerRepaint();
  };

  map.on('styledata', sync);
  const unsubscribe = subscribeTheme(sync);
  return () => {
    unsubscribe();
    map.off('styledata', sync);
  };
}
