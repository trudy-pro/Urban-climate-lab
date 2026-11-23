import type { GeoJSONSource, Map as MLMap } from 'maplibre-gl';
import type { Feature, FeatureCollection, LineString, Point, Position } from 'geojson';
import {
  along,
  centroid,
  curve,
  distanceM,
  lineLengths,
  nearestOnLines,
  polygonParts,
  type LngLatTuple,
} from './geo';
import type { TreeCollection } from '../data/trees';

/**
 * CONCEPTUAL water-flow illustration (not a hydraulic simulation).
 *
 * Built from what is really on the map: building footprints (OSM), the street network (OSM) and real
 * tree positions (Basel tree cadastre) / green areas. Each flow line reads as:
 *   sealed roof → nearest street gutter → nearest tree pit or green area (infiltration)
 */

const SRC_LINES = 'flow-lines';
const SRC_PARTICLES = 'flow-particles';
const SRC_SINKS = 'flow-sinks';
const SRC_HERO_LINE = 'flow-hero-line';
const SRC_HERO_POINTS = 'flow-hero-points';

const LAYER_IDS = [
  'flow-lines-glow',
  'flow-lines',
  'flow-sinks-pulse',
  'flow-sinks',
  'flow-particles',
  'flow-hero-line-glow',
  'flow-hero-line',
  'flow-hero-sink',
  'flow-hero-drop-glow',
  'flow-hero-drop',
];

interface FlowLine {
  coords: LngLatTuple[];
  cum: number[];
  total: number;
  offset: number;
  sink: { pos: LngLatTuple; kind: 'tree' | 'green' } | null;
}

export interface BuildOptions {
  /** Limit the number of paths (guided mode shows only a few). Default 140. */
  max?: number;
  /** Build around this point instead of the map centre. */
  focus?: LngLatTuple;
  /** Pick one featured path ending at a real tree (or green area) near the focus. */
  hero?: boolean;
}

export interface HeroPath {
  coords: LngLatTuple[];
  sink: LngLatTuple;
  kind: 'tree' | 'green';
}

const empty = (): FeatureCollection => ({ type: 'FeatureCollection', features: [] });

export class FlowLayer {
  private map: MLMap;
  private lines: FlowLine[] = [];
  private raf = 0;
  private running = false;
  private lastSinkPulse = 0;
  private t0 = 0;
  private hero: FlowLine | null = null;
  /** 'loop': droplet repeats slowly · 'follow': one guided run · 'held': droplet rests at the sink */
  private heroMode: 'loop' | 'follow' | 'held' = 'loop';
  private heroStart = 0;
  private onArrive: (() => void) | null = null;

  constructor(map: MLMap) {
    this.map = map;
  }

  private ensureLayers() {
    const map = this.map;
    if (map.getSource(SRC_LINES)) return;
    map.addSource(SRC_LINES, { type: 'geojson', data: empty(), lineMetrics: true });
    map.addSource(SRC_PARTICLES, { type: 'geojson', data: empty() });
    map.addSource(SRC_SINKS, { type: 'geojson', data: empty() });
    const before = map.getLayer('street-labels') ? 'street-labels' : undefined;

    map.addLayer(
      {
        id: 'flow-lines-glow',
        type: 'line',
        source: SRC_LINES,
        layout: { 'line-cap': 'round', 'line-join': 'round' },
        paint: {
          'line-width': ['interpolate', ['linear'], ['zoom'], 15, 4, 18, 12],
          'line-blur': 6,
          'line-opacity': 0.22,
          'line-gradient': ['interpolate', ['linear'], ['line-progress'], 0, '#2f8cff', 0.55, '#38d4ff', 1, '#4ef0a2'],
        },
      },
      before,
    );
    map.addLayer(
      {
        id: 'flow-lines',
        type: 'line',
        source: SRC_LINES,
        layout: { 'line-cap': 'round', 'line-join': 'round' },
        paint: {
          'line-width': ['interpolate', ['linear'], ['zoom'], 15, 0.9, 18, 1.9],
          'line-opacity': 0.7,
          'line-gradient': ['interpolate', ['linear'], ['line-progress'], 0, '#2f8cff', 0.55, '#38d4ff', 1, '#4ef0a2'],
        },
      },
      before,
    );
    map.addLayer(
      {
        id: 'flow-sinks-pulse',
        type: 'circle',
        source: SRC_SINKS,
        paint: {
          'circle-pitch-alignment': 'map',
          'circle-radius': 10,
          'circle-color': 'rgba(0,0,0,0)',
          'circle-stroke-color': '#4ef0a2',
          'circle-stroke-width': 1.4,
          'circle-stroke-opacity': 0.6,
        },
      },
      before,
    );
    map.addLayer(
      {
        id: 'flow-sinks',
        type: 'circle',
        source: SRC_SINKS,
        paint: {
          'circle-pitch-alignment': 'map',
          'circle-radius': ['interpolate', ['linear'], ['zoom'], 15, 3, 18, ['+', 6, ['*', 1.5, ['min', 6, ['get', 'n']]]]],
          'circle-color': '#4ef0a2',
          'circle-opacity': 0.42,
          'circle-blur': 0.6,
          'circle-stroke-color': '#4ef0a2',
          'circle-stroke-width': 1,
          'circle-stroke-opacity': 0.55,
        },
      },
      before,
    );
    // featured path (guided journey): one clearly readable route + its infiltration point
    map.addSource(SRC_HERO_LINE, { type: 'geojson', data: empty(), lineMetrics: true });
    map.addSource(SRC_HERO_POINTS, { type: 'geojson', data: empty() });
    map.addLayer(
      {
        id: 'flow-hero-line-glow',
        type: 'line',
        source: SRC_HERO_LINE,
        layout: { 'line-cap': 'round', 'line-join': 'round' },
        paint: {
          'line-width': ['interpolate', ['linear'], ['zoom'], 15, 8, 19, 26],
          'line-blur': 10,
          'line-opacity': 0.35,
          'line-gradient': ['interpolate', ['linear'], ['line-progress'], 0, '#2f8cff', 0.6, '#38d4ff', 1, '#4ef0a2'],
        },
      },
      before,
    );
    map.addLayer(
      {
        id: 'flow-hero-line',
        type: 'line',
        source: SRC_HERO_LINE,
        layout: { 'line-cap': 'round', 'line-join': 'round' },
        paint: {
          'line-width': ['interpolate', ['linear'], ['zoom'], 15, 1.8, 19, 4.5],
          'line-opacity': 0.95,
          'line-gradient': ['interpolate', ['linear'], ['line-progress'], 0, '#5aa8ff', 0.6, '#5be1ff', 1, '#62f5b0'],
        },
      },
      before,
    );
    map.addLayer(
      {
        id: 'flow-hero-sink',
        type: 'circle',
        source: SRC_HERO_POINTS,
        filter: ['==', ['get', 'role'], 'sink'],
        paint: {
          'circle-pitch-alignment': 'map',
          'circle-radius': ['interpolate', ['linear'], ['zoom'], 15, 6, 19, 26],
          'circle-color': 'rgba(78, 240, 162, 0.16)',
          'circle-stroke-color': '#4ef0a2',
          'circle-stroke-width': 2,
          'circle-stroke-opacity': 0.95,
        },
      },
      before,
    );
    map.addLayer(
      {
        id: 'flow-hero-drop-glow',
        type: 'circle',
        source: SRC_HERO_POINTS,
        filter: ['==', ['get', 'role'], 'drop'],
        paint: {
          'circle-pitch-alignment': 'map',
          'circle-radius': ['interpolate', ['linear'], ['zoom'], 15, 6, 19, 22],
          'circle-color': '#7fe9ff',
          'circle-opacity': 0.35,
          'circle-blur': 0.9,
        },
      },
      before,
    );
    map.addLayer(
      {
        id: 'flow-hero-drop',
        type: 'circle',
        source: SRC_HERO_POINTS,
        filter: ['==', ['get', 'role'], 'drop'],
        paint: {
          'circle-pitch-alignment': 'map',
          'circle-radius': ['interpolate', ['linear'], ['zoom'], 15, 2.4, 19, 7],
          'circle-color': '#e8fbff',
          'circle-stroke-color': '#5be1ff',
          'circle-stroke-width': 1.5,
        },
      },
      before,
    );

    map.addLayer(
      {
        id: 'flow-particles',
        type: 'circle',
        source: SRC_PARTICLES,
        paint: {
          'circle-pitch-alignment': 'map',
          'circle-radius': ['interpolate', ['linear'], ['zoom'], 15, 1.4, 18, 3.6],
          'circle-color': ['interpolate', ['linear'], ['get', 'p'], 0, '#5aa8ff', 0.5, '#5be1ff', 1, '#62f5b0'],
          'circle-opacity': ['interpolate', ['linear'], ['get', 'p'], 0, 0, 0.08, 0.95, 0.92, 0.95, 1, 0],
          'circle-blur': 0.25,
        },
      },
      before,
    );
  }

  /** Builds conceptual flow paths from features currently rendered in the viewport. */
  build(trees: TreeCollection | null, opts: BuildOptions = {}): { lines: number; sinks: number } {
    const map = this.map;
    this.ensureLayers();
    const c = map.getCenter();
    const center: LngLatTuple = opts.focus ?? [c.lng, c.lat];
    const maxLines = opts.max ?? 140;
    const maxR = opts.max ? 160 : map.getZoom() > 17 ? 260 : 420;

    // 1. buildings (dedupe tile-split pieces by rounded centroid)
    const seen = new Set<string>();
    const buildings: LngLatTuple[] = [];
    for (const f of map.queryRenderedFeatures({ layers: ['buildings-3d'] })) {
      // tiles merge many footprints into one MultiPolygon — treat each footprint as its own roof
      for (const poly of polygonParts(f.geometry)) {
        const cc = centroid({ type: 'Polygon', coordinates: poly });
        if (!cc) continue;
        const key = `${cc[0].toFixed(5)},${cc[1].toFixed(5)}`;
        if (seen.has(key)) continue;
        seen.add(key);
        if (distanceM(cc, center) < maxR) buildings.push(cc);
      }
    }
    buildings.sort((a, b) => distanceM(a, center) - distanceM(b, center));
    const sources = buildings.slice(0, maxLines);

    // 2. street network
    const roads: Position[][] = [];
    for (const f of map.queryRenderedFeatures({ layers: ['roads-minor', 'roads-major'] })) {
      if (f.properties?.class === 'path') continue;
      if (f.geometry.type === 'LineString') roads.push(f.geometry.coordinates);
      else if (f.geometry.type === 'MultiLineString') roads.push(...f.geometry.coordinates);
    }

    // 3. infiltration candidates: real trees + green areas
    const sinks: { pos: LngLatTuple; kind: 'tree' | 'green'; n: number }[] = [];
    if (trees) {
      for (const t of trees.features) {
        const p = t.geometry.coordinates as LngLatTuple;
        if (distanceM(p, center) < maxR + 150) sinks.push({ pos: p, kind: 'tree', n: 0 });
      }
    }
    const greenSeen = new Set<string>();
    for (const f of map.queryRenderedFeatures({ layers: ['park', 'landcover-green', 'landuse-green'] })) {
      for (const poly of polygonParts(f.geometry)) {
        const cc = centroid({ type: 'Polygon', coordinates: poly });
        if (!cc) continue;
        const key = `${cc[0].toFixed(4)},${cc[1].toFixed(4)}`;
        if (greenSeen.has(key)) continue;
        greenSeen.add(key);
        sinks.push({ pos: cc, kind: 'green', n: 0 });
      }
    }

    const lines: FlowLine[] = [];
    for (const b of sources) {
      const gutter = roads.length ? nearestOnLines(b, roads) : null;
      const via = gutter && gutter.dist < 60 ? gutter.point : b;
      let best: (typeof sinks)[number] | null = null;
      let bestD = Infinity;
      for (const s of sinks) {
        const d = distanceM(via, s.pos) * (s.kind === 'green' ? 1.4 : 1);
        if (d < bestD) {
          bestD = d;
          best = s;
        }
      }
      const coords: LngLatTuple[] = [b];
      if (via !== b) coords.push(...curve(b, via, 0.04, 6).slice(1));
      let sink: FlowLine['sink'] = null;
      if (best && bestD < 140) {
        best.n++;
        sink = { pos: best.pos, kind: best.kind };
        const bow = (Math.random() - 0.5) * 0.4;
        coords.push(...curve(via, best.pos, bow, 14).slice(1));
      }
      if (coords.length < 2) continue;
      const { cum, total } = lineLengths(coords);
      if (total < 6) continue;
      lines.push({ coords, cum, total, offset: Math.random() * total, sink });
    }

    // featured path: prefer a real tree (cadastre) close to the focus, with a readable length
    this.hero = null;
    if (opts.hero) {
      const score = (l: FlowLine) =>
        distanceM(l.sink!.pos, center) + (l.sink!.kind === 'green' ? 120 : 0) + (l.total < 25 ? 80 : 0) + (l.total > 110 ? 40 : 0);
      const candidates = lines.filter((l) => l.sink);
      candidates.sort((a, b) => score(a) - score(b));
      this.hero = candidates[0] ?? null;
      this.heroMode = 'loop';
      this.heroStart = performance.now();
    }
    if (this.hero) {
      const others = lines.filter((l) => l !== this.hero);
      this.lines = [this.hero, ...others];
    } else {
      this.lines = lines;
    }
    (map.getSource(SRC_HERO_LINE) as GeoJSONSource).setData(
      this.hero
        ? { type: 'Feature', properties: {}, geometry: { type: 'LineString', coordinates: this.hero.coords } }
        : empty(),
    );
    this.writeHeroPoints(this.hero ? this.hero.coords[0] : null);

    const usedSinks = sinks.filter((s) => s.n > 0);
    (map.getSource(SRC_LINES) as GeoJSONSource).setData({
      type: 'FeatureCollection',
      features: lines.map(
        (l): Feature<LineString> => ({ type: 'Feature', properties: {}, geometry: { type: 'LineString', coordinates: l.coords } }),
      ),
    });
    (map.getSource(SRC_SINKS) as GeoJSONSource).setData({
      type: 'FeatureCollection',
      features: usedSinks.map(
        (s): Feature<Point> => ({
          type: 'Feature',
          properties: { kind: s.kind, n: s.n },
          geometry: { type: 'Point', coordinates: s.pos },
        }),
      ),
    });
    return { lines: lines.length, sinks: usedSinks.length };
  }

  start() {
    this.ensureLayers();
    if (this.running) return;
    this.running = true;
    this.t0 = performance.now();
    this.setVisible(true);
    const SPEED = 11; // m/s, purely visual
    const SPACING = 13; // m between droplets
    const tick = (now: number) => {
      if (!this.running) return;
      const t = (now - this.t0) / 1000;
      const features: Feature<Point>[] = [];
      this.tickHero(now);
      for (const l of this.lines) {
        if (l === this.hero) continue;
        const n = Math.max(1, Math.floor(l.total / SPACING));
        for (let k = 0; k < n; k++) {
          const d = (t * SPEED + l.offset + k * SPACING) % l.total;
          features.push({
            type: 'Feature',
            properties: { p: d / l.total },
            geometry: { type: 'Point', coordinates: along(l.coords, l.cum, d) },
          });
        }
      }
      (this.map.getSource(SRC_PARTICLES) as GeoJSONSource | undefined)?.setData({
        type: 'FeatureCollection',
        features,
      });
      if (now - this.lastSinkPulse > 40 && this.map.getLayer('flow-sinks-pulse')) {
        this.lastSinkPulse = now;
        const ph = (t % 2.2) / 2.2;
        this.map.setPaintProperty('flow-sinks-pulse', 'circle-radius', 4 + ph * 22);
        this.map.setPaintProperty('flow-sinks-pulse', 'circle-stroke-opacity', 0.7 * (1 - ph));
      }
      this.raf = requestAnimationFrame(tick);
    };
    this.raf = requestAnimationFrame(tick);
  }

  stop() {
    this.running = false;
    cancelAnimationFrame(this.raf);
    this.setVisible(false);
  }

  /** The featured path, if one was built. */
  getHero(): HeroPath | null {
    const h = this.hero;
    if (!h || !h.sink) return null;
    return { coords: h.coords, sink: h.sink.pos, kind: h.sink.kind };
  }

  /** Send one droplet along the featured path; calls onArrive when it reaches the infiltration point. */
  follow(onArrive: () => void) {
    if (!this.hero) return;
    this.heroMode = 'follow';
    this.heroStart = performance.now();
    this.onArrive = onArrive;
  }

  /** Back to the gentle repeating droplet (e.g. when the journey steps back). */
  resetHero() {
    this.heroMode = 'loop';
    this.heroStart = performance.now();
    this.onArrive = null;
  }

  private writeHeroPoints(drop: LngLatTuple | null) {
    const src = this.map.getSource(SRC_HERO_POINTS) as GeoJSONSource | undefined;
    if (!src) return;
    const features: Feature<Point>[] = [];
    if (this.hero?.sink) {
      features.push({ type: 'Feature', properties: { role: 'sink' }, geometry: { type: 'Point', coordinates: this.hero.sink.pos } });
    }
    if (drop) features.push({ type: 'Feature', properties: { role: 'drop' }, geometry: { type: 'Point', coordinates: drop } });
    src.setData({ type: 'FeatureCollection', features });
  }

  private tickHero(now: number) {
    const h = this.hero;
    if (!h) return;
    const reduced = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
    // a walking-pace droplet that is easy to follow with the eye
    const runMs = reduced ? 1 : Math.max(3800, Math.min(7000, h.total * 70));
    const t = (now - this.heroStart) / runMs;
    if (this.heroMode === 'held') {
      this.writeHeroPoints(h.coords[h.coords.length - 1]);
      return;
    }
    if (this.heroMode === 'follow' && t >= 1) {
      this.heroMode = 'held';
      const cb = this.onArrive;
      this.onArrive = null;
      this.writeHeroPoints(h.coords[h.coords.length - 1]);
      cb?.();
      return;
    }
    // loop: travel, then pause briefly at the sink before starting again
    const p = this.heroMode === 'follow' ? t : t % 1.35;
    const e = Math.min(1, p);
    const eased = e < 0.5 ? 2 * e * e : 1 - Math.pow(-2 * e + 2, 2) / 2;
    this.writeHeroPoints(along(h.coords, h.cum, eased * h.total));
  }

  private setVisible(v: boolean) {
    for (const id of LAYER_IDS) {
      if (this.map.getLayer(id)) this.map.setLayoutProperty(id, 'visibility', v ? 'visible' : 'none');
    }
  }

  destroy() {
    this.running = false;
    cancelAnimationFrame(this.raf);
  }
}
