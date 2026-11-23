import type { GeoJSONSource, Map as MLMap } from 'maplibre-gl';
import type { Feature, FeatureCollection, LineString, Point } from 'geojson';
import { along, lineLengths, type LngLatTuple } from './geo';

/**
 * City-wide surface runoff: where rain would run downhill across Basel towards the
 * Birsig, Birs, Wiese and Rhine. Pre-computed from a terrain model by scripts/build-drainage.mjs
 * (terrain only — ignores sewers, buildings and kerbs). Shown at city / neighbourhood zoom;
 * it fades out at street level, where the roof → gutter → tree paths take over.
 */

const SRC = 'drainage';
const SRC_P = 'drainage-particles';
const LAYERS = ['drainage-glow', 'drainage-lines', 'drainage-particles'];
const URL = `${import.meta.env.BASE_URL}data/drainage.geojson`;

interface Channel {
  coords: LngLatTuple[];
  cum: number[];
  total: number;
  offset: number;
  speed: number;
  bbox: [number, number, number, number];
}

type DrainageCollection = FeatureCollection<LineString, { a: number }>;

let cache: Promise<DrainageCollection> | null = null;
const load = () =>
  (cache ??= fetch(URL).then((r) => {
    if (!r.ok) throw new Error(`drainage ${r.status}`);
    return r.json() as Promise<DrainageCollection>;
  }));

/** line width/opacity grow with upstream area (km²) */
const AREA = ['ln', ['+', 1, ['get', 'a']]] as const;

export class DrainageLayer {
  private map: MLMap;
  private channels: Channel[] = [];
  private raf = 0;
  private running = false;
  private t0 = 0;
  private last = 0;

  constructor(map: MLMap) {
    this.map = map;
  }

  private async ensure(): Promise<boolean> {
    const map = this.map;
    if (map.getSource(SRC)) return true;
    const fc = await load();
    if (map.getSource(SRC)) return true;
    map.addSource(SRC, { type: 'geojson', data: fc, lineMetrics: true });
    map.addSource(SRC_P, { type: 'geojson', data: { type: 'FeatureCollection', features: [] } });
    // under the water fill, so channels that follow the Rhine disappear into it
    const before = map.getLayer('water') ? 'water' : undefined;
    const fade = (v: number) =>
      ['interpolate', ['linear'], ['zoom'], 11, v, 14.5, v, 16.2, v * 0.22] as unknown as number;
    map.addLayer(
      {
        id: 'drainage-glow',
        type: 'line',
        source: SRC,
        layout: { 'line-cap': 'round', 'line-join': 'round' },
        paint: {
          'line-color': '#38d4ff',
          'line-blur': 4,
          'line-width': ['interpolate', ['linear'], ['zoom'], 11, ['*', 1.2, AREA], 15, ['*', 3, AREA]] as unknown as number,
          'line-opacity': fade(0.16),
        },
      },
      before,
    );
    map.addLayer(
      {
        id: 'drainage-lines',
        type: 'line',
        source: SRC,
        layout: { 'line-cap': 'round', 'line-join': 'round' },
        paint: {
          'line-width': ['interpolate', ['linear'], ['zoom'], 11, ['+', 0.3, ['*', 0.35, AREA]], 15, ['+', 0.8, ['*', 0.9, AREA]]] as unknown as number,
          'line-gradient': ['interpolate', ['linear'], ['line-progress'], 0, '#2f6fd0', 1, '#38d4ff'],
          'line-opacity': fade(0.75),
        },
      },
      before,
    );
    map.addLayer(
      {
        id: 'drainage-particles',
        type: 'circle',
        source: SRC_P,
        paint: {
          'circle-pitch-alignment': 'map',
          'circle-radius': ['interpolate', ['linear'], ['zoom'], 11, 1, 15, 2.6],
          'circle-color': '#bff4ff',
          'circle-opacity': fade(0.85),
          'circle-blur': 0.3,
        },
      },
      before,
    );

    this.channels = fc.features.map((f: Feature<LineString, { a: number }>) => {
      const coords = f.geometry.coordinates as LngLatTuple[];
      const { cum, total } = lineLengths(coords);
      const xs = coords.map((c) => c[0]);
      const ys = coords.map((c) => c[1]);
      return {
        coords,
        cum,
        total,
        offset: Math.random() * total,
        // bigger channels run a little faster (purely visual)
        speed: 40 + 18 * Math.log1p(f.properties.a),
        bbox: [Math.min(...xs), Math.min(...ys), Math.max(...xs), Math.max(...ys)],
      };
    });
    return true;
  }

  async start() {
    this.running = true;
    try {
      await this.ensure();
    } catch {
      return false;
    }
    if (!this.running) return true;
    this.setVisible(true);
    cancelAnimationFrame(this.raf);
    this.t0 = performance.now();
    const reduced = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
    const tick = (now: number) => {
      if (!this.running) return;
      this.raf = requestAnimationFrame(tick);
      if (reduced || now - this.last < 33) return; // ~30 fps is plenty for drifting droplets
      this.last = now;
      const map = this.map;
      const z = map.getZoom();
      const src = map.getSource(SRC_P) as GeoJSONSource | undefined;
      if (!src) return;
      if (z > 16.5) {
        src.setData({ type: 'FeatureCollection', features: [] });
        return;
      }
      // droplet spacing follows zoom so the density on screen stays similar; only animate what is in view
      const spacing = 70 * 2 ** (14 - Math.min(16, Math.max(11, z)));
      const b = map.getBounds();
      const [w, s, e, n] = [b.getWest(), b.getSouth(), b.getEast(), b.getNorth()];
      const t = (now - this.t0) / 1000;
      const features: Feature<Point>[] = [];
      for (const c of this.channels) {
        if (c.bbox[2] < w || c.bbox[0] > e || c.bbox[3] < s || c.bbox[1] > n) continue;
        const k = Math.max(1, Math.floor(c.total / spacing));
        for (let i = 0; i < k; i++) {
          const d = (t * c.speed + c.offset + i * spacing) % c.total;
          features.push({ type: 'Feature', properties: {}, geometry: { type: 'Point', coordinates: along(c.coords, c.cum, d) } });
        }
        if (features.length > 6000) break;
      }
      src.setData({ type: 'FeatureCollection', features });
    };
    this.raf = requestAnimationFrame(tick);
    return true;
  }

  stop() {
    this.running = false;
    cancelAnimationFrame(this.raf);
    this.setVisible(false);
  }

  private setVisible(v: boolean) {
    for (const id of LAYERS) {
      if (this.map.getLayer(id)) this.map.setLayoutProperty(id, 'visibility', v ? 'visible' : 'none');
    }
  }

  destroy() {
    this.running = false;
    cancelAnimationFrame(this.raf);
  }
}
