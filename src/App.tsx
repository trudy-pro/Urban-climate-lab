import { useCallback, useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { useTheme } from './theme';
import { ThemeToggle } from './components/ThemeToggle';
import { CityOverview, CityMapActions } from './components/paper/CityOverview';
import { TherwilerstrasseMarker } from './components/paper/TherwilerstrasseMarker';
import {
  AttributionControl,
  Map as MLMap,
  Marker,
  setWorkerUrl,
  type GeoJSONSource,
  type MapGeoJSONFeature,
  type MapMouseEvent,
  type MapMovementEvent,
  type MapSourceDataEvent,
  type PaddingOptions,
} from 'maplibre-gl';
import 'maplibre-gl/dist/maplibre-gl.css';
import workerUrl from 'maplibre-gl/dist/maplibre-gl-worker.mjs?url';

import {
  ARRIVAL_MIN_ZOOM,
  ARRIVAL_RADIUS_M,
  BS_BOUNDS,
  CLIMATE_LAYERS,
  FELLING_WMS,
  TARGET,
  wmsTileUrl,
  type CameraView,
} from './config';
import {
  BASEL_LABEL_AT,
  PAULUSGASSE,
  STREET_BEARING,
  STUDY_CENTER,
  THERWILERSTRASSE,
  ORBIT_DEG_PER_SEC,
  cityView,
  openingView,
  neighborhoodView,
  prefersReducedMotion,
  stageIndex,
  streetView,
  waterFocusView,
  type JourneyStage,
} from './journey';
import { FlightCaption, JourneyCard, JourneyNav, MapStages, SectionConnector } from './components/Journey';
import { BUILDING_EXTRUSION_COLOR, COLORS, STREET_COLORS, streetPaint } from './map/style';
import { BUILDING_EXTRUSION_COLOR as paperBuildingColor, COLORS as PAPER_COLORS, STREET_COLORS as PAPER_STREETS } from './map/paperStyle';
import { buildThemedStyle, installMapTheme } from './map/themeStyle';
import { installIllustrationPatterns } from './map/illustration';
import { installRiverCurrents } from './map/riverCurrents';
import { cubicBezier, idleOrbit, type FlightHandle } from './map/cinematic';
import { areaM2, centroid, distanceM, inflate, type LngLatTuple } from './map/geo';
import { pickFootprint } from './map/pick';
import { FlowLayer } from './map/flows';
import { SurfaceWaterLayer } from './map/surfaceWater';
import { DrainageLayer } from './map/drainage';
import { fetchOsmBuilding } from './data/osm';
import { fetchGwrBuilding } from './data/gwr';
import { fetchTrees, type TreeCollection, type TreeProps } from './data/trees';
import { fetchStations } from './data/stations';
import { InfoPanel, type Selection } from './components/InfoPanel';
import { CameraControls } from './components/CameraControls';
import { EnvToolbar } from './components/EnvToolbar';
import type { RainLevel } from './components/RainIntensity';
import { ClimatePanel } from './components/ClimatePanel';
import { SurfaceSection } from './components/SurfaceSection';
import { UndergroundView } from './components/UndergroundView';
import { useAmbience } from './components/useAmbience';
import { JOURNEY } from './journey';

setWorkerUrl(workerUrl);

type Phase = 'intro' | 'flying' | 'free';

const EMPTY_FC = { type: 'FeatureCollection' as const, features: [] };
const CITY_FLOW_HINT =
  'City-wide: rain runs downhill towards the Birsig, Birs, Wiese and Rhine. Zoom in to street level to follow it from roofs to trees.';
const smoothOut = cubicBezier(0.3, 0, 0.1, 1);
// long, decelerating tail: the camera slows as it reaches the street (one continuous flyTo)
const approach = cubicBezier(0.42, 0, 0.12, 1);
const settle = cubicBezier(0.25, 0.1, 0.25, 1);
// the dive into the street: slow start, accelerating as the camera reaches the ground
const dive = cubicBezier(0.55, 0, 0.75, 0.25);
const NO_PADDING = { top: 0, bottom: 0, left: 0, right: 0 };

function webglSupported(): boolean {
  try {
    const c = document.createElement('canvas');
    return !!(c.getContext('webgl2') || c.getContext('webgl'));
  } catch {
    return false;
  }
}

type Stage = 'city' | 'neighbourhood' | 'street';

function stageOf(zoom: number, nearTarget: boolean): Stage {
  if (zoom < 13.8) return 'city';
  if (zoom < 15.6 || !nearTarget) return 'neighbourhood';
  return 'street';
}

const STAGE_LABEL: Record<Stage, string> = {
  city: 'Basel · City overview',
  neighbourhood: 'Basel · Neighbourhood',
  street: 'Paulusgasse / Therwilerstrasse',
};

/** Screen room for the journey card (left on desktop, bottom on phones) so the camera frames the free area. */
function journeyPadding(stage: JourneyStage | null): PaddingOptions {
  if (!stage) return { top: 0, bottom: 0, left: 0, right: 0 };
  const w = window.innerWidth;
  const h = window.innerHeight;
  if (w <= 760) {
    if (stage === 'below') return { top: 60, bottom: Math.round(h * 0.55), left: 0, right: 0 };
    if (stage === 'city') return { top: 82, bottom: Math.round(h * 0.48), left: 0, right: 0 };
    return { top: 84, bottom: Math.round(h * 0.38), left: 0, right: 0 };
  }
  if (stage === 'below') return { top: 70, bottom: Math.round(h * 0.7), left: 0, right: 0 };
  // city overview: room for the headline, so Basel and the study area sit beside it
  if (stage === 'city') return { top: 0, bottom: 0, left: Math.round(Math.min(380, w * 0.23)), right: 0 };
  // closer in, the study street stays in the middle of the screen throughout the flight
  return { top: 0, bottom: 0, left: 0, right: 0 };
}

export default function App() {
  const containerRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<MLMap | null>(null);
  const flowRef = useRef<FlowLayer | null>(null);
  const waterRef = useRef<SurfaceWaterLayer | null>(null);
  const drainRef = useRef<DrainageLayer | null>(null);
  const flightRef = useRef<FlightHandle | null>(null);
  const stopOrbitRef = useRef<(() => void) | null>(null);
  const selectedIdRef = useRef<string | number | null>(null);
  const hoverKeyRef = useRef<string | null>(null);
  const osmAbortRef = useRef<AbortController | null>(null);
  const treesRef = useRef<TreeCollection | null>(null);
  const treesCenterRef = useRef<LngLatTuple | null>(null);
  const phaseRef = useRef<Phase>('intro');
  const tokenRef = useRef(0);
  const guidedRef = useRef(true);
  const jStageRef = useRef<JourneyStage>('city');
  const followingRef = useRef(false);
  const baselTagRef = useRef<Marker | null>(null);
  const prevCamRef = useRef<CameraView | null>(null);
  const studyTagRef = useRef<Marker | null>(null);

  /* guided journey */
  const [guided, setGuidedState] = useState(true);
  const [jStage, setJStageState] = useState<JourneyStage>('city');
  const [reached, setReached] = useState(0);
  const [flying, setFlying] = useState(false);
  const [offCourse, setOffCourse] = useState(false);
  const [following, setFollowingState] = useState(false);
  const [arrived, setArrivedState] = useState(false);
  const arrivedRef = useRef(false);
  const setArrived = (a: boolean) => {
    arrivedRef.current = a;
    setArrivedState(a);
  };
  const [heroKind, setHeroKind] = useState<'tree' | 'green' | null>(null);
  const [flowNonce, setFlowNonce] = useState(0);
  const setGuided = (g: boolean) => {
    guidedRef.current = g;
    setGuidedState(g);
  };
  const setJStage = (s: JourneyStage) => {
    jStageRef.current = s;
    setJStageState(s);
  };
  const setFollowing = (f: boolean) => {
    followingRef.current = f;
    setFollowingState(f);
  };

  const [ready, setReady] = useState(false);
  const theme = useTheme();
  const paper = theme === 'light';
  const [basemapVisible, setBasemapVisible] = useState(false);
  const [fatal, setFatal] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [phase, setPhaseState] = useState<Phase>('intro');
  const [unlocked, setUnlocked] = useState(false);
  const [cam, setCam] = useState({ bearing: openingView.bearing, pitch: openingView.pitch, zoom: openingView.zoom, lng: openingView.center[0], lat: openingView.center[1] });
  const [selection, setSelection] = useState<Selection | null>(null);

  const [rain, setRain] = useState(false);
  const [rainIntensity, setRainIntensity] = useState<RainLevel>(1);
  const [sound, setSound] = useState(false);
  useAmbience(sound);
  const [flows, setFlows] = useState(false);
  const toggleFlows = () => setFlows((active) => !active);
  const [surface, setSurface] = useState(false);
  const [underground, setUnderground] = useState(() => typeof location !== 'undefined' && location.hash === '#underground');
  const [flowStats, setFlowStats] = useState<{ lines: number; sinks: number } | null>(null);
  const [flowHint, setFlowHint] = useState<string | null>(null);

  const [climateOpen, setClimateOpen] = useState(false);
  const [climateId, setClimateId] = useState<string | null>(null);
  const [climateYear, setClimateYear] = useState<'today' | '2030'>('today');
  const [climateOpacity, setClimateOpacity] = useState(CLIMATE_LAYERS[0].opacity);
  const [climateLoading, setClimateLoading] = useState(false);
  const [treesOn, setTreesOn] = useState(false);
  const [fellingOn, setFellingOn] = useState(false);
  const [stationsOn, setStationsOn] = useState(false);
  const [stationStatus, setStationStatus] = useState('meteoblue City Climate network · every 15 min');
  const [treeStatus, setTreeStatus] = useState('Tree cadastre · zoom in to load');
  const [treesVersion, setTreesVersion] = useState(0);

  const setPhase = (p: Phase) => {
    phaseRef.current = p;
    setPhaseState(p);
  };

  const flash = useCallback((msg: string, ms = 4200) => {
    setNotice(msg);
    window.clearTimeout((flash as unknown as { t?: number }).t);
    (flash as unknown as { t?: number }).t = window.setTimeout(() => setNotice(null), ms);
  }, []);

  /* ------------------------------------------------------------------ map init (once) */
  useEffect(() => {
    if (!containerRef.current) return;
    if (!webglSupported()) {
      setFatal('This browser cannot display WebGL maps. Please try a recent version of Chrome, Firefox, Safari or Edge.');
      return;
    }
    // a rebuilt map (hot reload) is not ready until its own style has loaded
    setReady(false);
    setBasemapVisible(false);

    const map = new MLMap({
      container: containerRef.current,
      style: buildThemedStyle(),
      center: openingView.center,
      zoom: openingView.zoom,
      pitch: openingView.pitch,
      bearing: openingView.bearing,
      minZoom: 10.5,
      maxZoom: 19.5,
      maxPitch: 78,
      maxBounds: [
        [7.3, 47.4],
        [7.9, 47.72],
      ],
      attributionControl: false,
      canvasContextAttributes: { antialias: true },
      fadeDuration: 250,
    });
    mapRef.current = map;
    const stopTheme = installMapTheme(map);
    installIllustrationPatterns(map);
    let stopRiverCurrents: (() => void) | undefined;
    let lastBasemapCheck = -Infinity;
    const checkBasemap = () => {
      const now = performance.now();
      if (now - lastBasemapCheck < 200 || !map.getLayer('water')) return;
      lastBasemapCheck = now;
      if (!map.queryRenderedFeatures({ layers: ['water', 'landuse-residential', 'roads-minor', 'roads-major'] }).length) return;
      setBasemapVisible(true);
      map.off('render', checkBasemap);
    };
    map.on('render', checkBasemap);
    if (import.meta.env.DEV) (window as unknown as { __map: MLMap }).__map = map;

    map.addControl(
      new AttributionControl({
        compact: true,
        customAttribution: [
          'Climate, tree & building data © <a href="https://www.geo.bs.ch" target="_blank" rel="noopener">Kanton Basel-Stadt</a>',
        ],
      }),
      'bottom-right',
    );

    let rafCam = 0;
    const syncCam = () => {
      if (rafCam) return;
      rafCam = requestAnimationFrame(() => {
        rafCam = 0;
        const c = map.getCenter();
        setCam({ bearing: map.getBearing(), pitch: map.getPitch(), zoom: map.getZoom(), lng: c.lng, lat: c.lat });
      });
    };
    map.on('move', syncCam);

    map.on('error', (e) => {
      const src = (e as unknown as { sourceId?: string }).sourceId;
      if (src === 'climate') flash('Basel climate service (geo.bs.ch) did not answer for some tiles.');
      else if (src === 'omt') flash('Some map tiles could not be loaded — check your connection.');
      // eslint-disable-next-line no-console
      console.warn('[map]', e.error?.message ?? e);
    });

    map.on('load', () => {
      stopRiverCurrents = installRiverCurrents(map);
      // selection highlight
      map.addSource('selected', { type: 'geojson', data: EMPTY_FC });
      map.addLayer(
        {
          id: 'selected-ground',
          type: 'line',
          source: 'selected',
          paint: { 'line-color': '#7fdcff', 'line-width': 6, 'line-blur': 6, 'line-opacity': 0.8 },
        },
        'building-flat',
      );
      map.addSource('hover', { type: 'geojson', data: EMPTY_FC });
      map.addLayer(
        {
          id: 'hover-3d',
          type: 'fill-extrusion',
          source: 'hover',
          paint: {
            'fill-extrusion-color': '#33507c',
            'fill-extrusion-opacity': 0.95,
            'fill-extrusion-height': 0.25,
            'fill-extrusion-base': 0,
          },
        },
        'street-labels',
      );
      map.addLayer(
        {
          id: 'selected-3d',
          type: 'fill-extrusion',
          source: 'selected',
          paint: {
            'fill-extrusion-color': '#7fdcff',
            'fill-extrusion-opacity': 0.9,
            'fill-extrusion-height': 0.4,
            'fill-extrusion-base': 0,
          },
        },
        'street-labels',
      );

      // real trees (Basel tree cadastre) — drawn below the building extrusions so buildings occlude them
      map.addSource('trees', { type: 'geojson', data: EMPTY_FC });
      map.addLayer(
        {
          id: 'trees-glow',
          type: 'circle',
          source: 'trees',
          minzoom: 14.5,
          layout: { visibility: 'none' },
          paint: {
            'circle-pitch-alignment': 'map',
            'circle-radius': ['interpolate', ['exponential', 2], ['zoom'], 15, 4, 19, 30],
            'circle-color': '#3fd68f',
            'circle-opacity': ['interpolate', ['linear'], ['zoom'], 14.5, 0, 15.5, 0.16],
            'circle-blur': 0.9,
          },
        },
        'buildings-3d',
      );
      map.addLayer(
        {
          id: 'trees',
          type: 'circle',
          source: 'trees',
          minzoom: 14.5,
          layout: { visibility: 'none' },
          paint: {
            'circle-pitch-alignment': 'map',
            'circle-radius': ['interpolate', ['exponential', 2], ['zoom'], 15, 1.4, 19, 9],
            'circle-color': [
              'case',
              ['boolean', ['feature-state', 'selected'], false],
              '#d6ffe9',
              '#46e09a',
            ],
            'circle-opacity': ['interpolate', ['linear'], ['zoom'], 14.5, 0, 15.5, 0.85],
            'circle-stroke-color': '#0c3a27',
            'circle-stroke-width': ['interpolate', ['linear'], ['zoom'], 15, 0.3, 19, 1.5],
          },
        },
        'buildings-3d',
      );

      // study area (real OSM geometry of Therwilerstrasse + Paulusgasse): restrained cyan emphasis
      map.addSource('study', {
        type: 'geojson',
        data: {
          type: 'FeatureCollection',
          features: [
            { type: 'Feature', properties: { kind: 'street' }, geometry: { type: 'LineString', coordinates: THERWILERSTRASSE } },
            { type: 'Feature', properties: { kind: 'street' }, geometry: { type: 'LineString', coordinates: PAULUSGASSE } },
            { type: 'Feature', properties: { kind: 'point' }, geometry: { type: 'Point', coordinates: STUDY_CENTER } },
          ],
        },
      });
      const fade = { duration: 1400, delay: 0 };
      map.addLayer(
        {
          id: 'study-glow',
          type: 'line',
          source: 'study',
          filter: ['==', ['get', 'kind'], 'street'],
          layout: { 'line-cap': 'round', 'line-join': 'round' },
          paint: {
            'line-color': streetPaint('#45dcf0', STREET_COLORS.glow),
            'line-width': ['interpolate', ['linear'], ['zoom'], 13, 4, 16, 16, 18, 34],
            'line-blur': ['interpolate', ['linear'], ['zoom'], 13, 4, 18, 22],
            'line-opacity': 0,
            'line-opacity-transition': fade,
          },
        },
        'buildings-3d',
      );
      map.addLayer(
        {
          id: 'study-line',
          type: 'line',
          source: 'study',
          filter: ['==', ['get', 'kind'], 'street'],
          layout: { 'line-cap': 'round', 'line-join': 'round' },
          paint: {
            'line-color': streetPaint('#7fe9ff', STREET_COLORS.line),
            'line-width': ['interpolate', ['linear'], ['zoom'], 13, 1, 16, 2, 18, 3],
            'line-opacity': 0,
            'line-opacity-transition': fade,
          },
        },
        'buildings-3d',
      );
      map.addLayer(
        {
          id: 'study-point',
          type: 'circle',
          source: 'study',
          filter: ['==', ['get', 'kind'], 'point'],
          paint: {
            'circle-pitch-alignment': 'map',
            'circle-radius': ['interpolate', ['linear'], ['zoom'], 11, 7, 13, 12, 15, 26],
            'circle-color': 'rgba(69, 220, 240, 0.12)',
            'circle-stroke-color': '#45dcf0',
            'circle-stroke-width': 1.4,
            'circle-opacity': 0,
            'circle-stroke-opacity': 0,
            'circle-opacity-transition': fade,
            'circle-stroke-opacity-transition': fade,
          },
        },
        'street-labels',
      );
      const tag = (cls: string, html: string) => {
        const el = document.createElement('div');
        el.className = 'map-tag-anchor';
        const inner = document.createElement('div');
        inner.className = `map-tag ${cls}`;
        inner.innerHTML = html;
        el.appendChild(inner);
        return el;
      };
      baselTagRef.current = new Marker({ element: tag('map-tag--city', '<b>Basel</b><span>Switzerland</span>'), anchor: 'bottom', offset: [0, -26] })
        .setLngLat(BASEL_LABEL_AT)
        .addTo(map);
      studyTagRef.current = new Marker({ element: tag('map-tag--study', '<span class="map-tag__ring"><i></i></span><span class="map-tag__lead"></span><span class="map-tag__label"><i></i>Therwilerstrasse</span>'), anchor: 'center' })
        .setLngLat(STUDY_CENTER)
        .addTo(map);

      // start with the attribution collapsed to the (i) button so it never covers the toolbar
      containerRef.current?.querySelector('.maplibregl-ctrl-attrib')?.classList.remove('maplibregl-compact-show');
      flowRef.current = new FlowLayer(map);
      drainRef.current = new DrainageLayer(map);
      waterRef.current = new SurfaceWaterLayer(map);
      setReady(true);
      // front-page opening: drift from a distant, low view into the Basel overview, then turn slowly
      if (prefersReducedMotion()) {
        map.jumpTo({ ...cityView, padding: journeyPadding('city') });
      } else {
        const token = tokenRef.current;
        map.easeTo({ ...cityView, padding: journeyPadding('city'), duration: 3600, easing: settle });
        map.once('moveend', () => {
          // only if nothing else has taken the camera since (Explore Basel, a drag, …)
          if (token === tokenRef.current && guidedRef.current && jStageRef.current === 'city') {
            stopOrbitRef.current = idleOrbit(map, ORBIT_DEG_PER_SEC);
          }
        });
      }
    });

    /* hover */
    let hoverRaf = 0;
    map.getCanvas().addEventListener('mouseleave', () => {
      hoverKeyRef.current = null;
      (map.getSource('hover') as GeoJSONSource | undefined)?.setData(EMPTY_FC);
    });
    map.on('mousemove', (e) => {
      if (hoverRaf) return;
      hoverRaf = requestAnimationFrame(() => {
        hoverRaf = 0;
        if (!map.getLayer('buildings-3d')) return;
        const layers = map.getLayoutProperty('trees', 'visibility') === 'visible' ? ['trees', 'buildings-3d'] : ['buildings-3d'];
        const f = map.queryRenderedFeatures(e.point, { layers })[0];
        map.getCanvas().style.cursor = f ? 'pointer' : '';
        // tiles merge many footprints into one MultiPolygon: hover only the footprint under the cursor
        const pick = f && f.layer.id === 'buildings-3d' && map.getZoom() >= 15 ? pickFootprint(map, e.point, [e.lngLat.lng, e.lngLat.lat]) : null;
        const key = pick ? JSON.stringify(pick.polygon[0][0]) : null;
        if (key === hoverKeyRef.current) return;
        hoverKeyRef.current = key;
        (map.getSource('hover') as GeoJSONSource | undefined)?.setData(
          pick
            ? { type: 'Feature', properties: { h: pick.height, b: pick.base }, geometry: { type: 'Polygon', coordinates: inflate(pick.polygon, 0.15) } }
            : EMPTY_FC,
        );
      });
    });

    return () => {
      stopTheme();
      stopRiverCurrents?.();
      cancelAnimationFrame(rafCam);
      cancelAnimationFrame(hoverRaf);
      flightRef.current?.cancel();
      stopOrbitRef.current?.();
      flowRef.current?.destroy();
      drainRef.current?.destroy();
      osmAbortRef.current?.abort();
      map.remove();
      mapRef.current = null;
    };
  }, [flash]);

  /* ------------------------------------------------------------------ selection */
  const clearSelection = useCallback(() => {
    const map = mapRef.current;
    osmAbortRef.current?.abort();
    if (map) {
      if (selectedIdRef.current != null) {
        const [kind, id] = String(selectedIdRef.current).split(':');
        if (kind === 't') map.setFeatureState({ source: 'trees', id: Number(id) }, { selected: false });
      }
      (map.getSource('selected') as GeoJSONSource | undefined)?.setData(EMPTY_FC);
    }
    selectedIdRef.current = null;
    setSelection(null);
  }, []);

  const panelOffset = (): [number, number] =>
    window.innerWidth > 760 ? [Math.min(190, window.innerWidth * 0.12), 0] : [0, -Math.round(window.innerHeight * 0.18)];

  const selectBuilding = useCallback(
    (point: { x: number; y: number }, click: LngLatTuple) => {
      const map = mapRef.current!;
      // vector tiles merge footprints with identical attributes — isolate the one that was clicked (3D ray test)
      const pick = pickFootprint(map, point, click);
      if (!pick) return;
      clearSelection();
      const part = pick.polygon;
      const geom: GeoJSON.Polygon = { type: 'Polygon', coordinates: part };
      const c = centroid(geom) ?? click;
      const h = pick.height;
      const b = pick.base;

      (map.getSource('hover') as GeoJSONSource).setData(EMPTY_FC);
      (map.getSource('selected') as GeoJSONSource).setData({
        type: 'Feature',
        properties: { h, b },
        geometry: { type: 'Polygon', coordinates: inflate(part, 0.3) },
      });

      map.easeTo({
        center: c,
        zoom: Math.min(19, Math.max(map.getZoom() + 0.6, 16.9)),
        pitch: Math.max(map.getPitch(), 55),
        offset: panelOffset(),
        duration: 1500,
        easing: smoothOut,
      });

      const sel: Selection = {
        kind: 'building',
        lngLat: c,
        renderHeight: h,
        renderMinHeight: b,
        area: areaM2(geom),
        gwr: 'loading',
        osm: 'loading',
      };
      setSelection(sel);
      const ctl = new AbortController();
      osmAbortRef.current = ctl;
      const patch = (p: Partial<Extract<Selection, { kind: 'building' }>>) =>
        setSelection((s) => (s && s.kind === 'building' && s.lngLat === c ? { ...s, ...p } : s));
      // official register (primary) and OpenStreetMap (enrichment) in parallel
      fetchGwrBuilding(part, c, ctl.signal)
        .then((gwr) => patch({ gwr }))
        .catch((err) => (err as Error).name !== 'AbortError' && patch({ gwr: 'error' }));
      const osmTimeout = window.setTimeout(() => ctl.signal.aborted || patch({ osm: 'error' }), 9000);
      fetchOsmBuilding(click, ctl.signal)
        .then((osm) => patch({ osm }))
        .catch((err) => (err as Error).name !== 'AbortError' && patch({ osm: 'error' }))
        .finally(() => window.clearTimeout(osmTimeout));
    },
    [clearSelection],
  );

  const selectTree = useCallback(
    (f: MapGeoJSONFeature) => {
      const map = mapRef.current!;
      clearSelection();
      const pos = (f.geometry as GeoJSON.Point).coordinates as LngLatTuple;
      if (f.id != null) {
        map.setFeatureState({ source: 'trees', id: f.id }, { selected: true });
        selectedIdRef.current = `t:${f.id}`;
      }
      map.easeTo({ center: pos, zoom: Math.min(19, Math.max(map.getZoom() + 0.4, 17.2)), offset: panelOffset(), duration: 1300, easing: smoothOut });
      setSelection({ kind: 'tree', lngLat: pos, props: f.properties as TreeProps });
    },
    [clearSelection],
  );

  useEffect(() => {
    const map = mapRef.current;
    if (!map || !ready) return;
    const onClick = (e: MapMouseEvent) => {
      if (phaseRef.current === 'flying') return;
      // the guided journey keeps the focus on the street: inspection lives in "Explore freely"
      if (guidedRef.current) return;
      const pad = 6;
      const box: [[number, number], [number, number]] = [
        [e.point.x - pad, e.point.y - pad],
        [e.point.x + pad, e.point.y + pad],
      ];
      const tree = map.getLayoutProperty('trees', 'visibility') === 'visible' ? map.queryRenderedFeatures(box, { layers: ['trees'] })[0] : undefined;
      const building = map.queryRenderedFeatures(e.point, { layers: ['buildings-3d'] })[0];
      const ground: LngLatTuple = [e.lngLat.lng, e.lngLat.lat];
      if (tree && !building) return selectTree(tree);
      if (building) return selectBuilding(e.point, ground);
      if (tree) return selectTree(tree);
      clearSelection();
    };
    map.on('click', onClick);
    return () => {
      map.off('click', onClick);
    };
  }, [ready, selectBuilding, selectTree, clearSelection]);

  /* ------------------------------------------------------------------ arrival detection + 3D fallback */
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !ready) return;
    let checked3d = false;
    const onEnd = () => {
      if (phaseRef.current === 'flying') return;
      const c = map.getCenter();
      const near = distanceM([c.lng, c.lat], TARGET.center) < ARRIVAL_RADIUS_M && map.getZoom() >= ARRIVAL_MIN_ZOOM;
      if (near) setUnlocked(true);
      if (!checked3d && map.getZoom() >= 15.5) {
        map.once('idle', () => {
          if (checked3d) return;
          checked3d = true;
          const n = map.queryRenderedFeatures({ layers: ['buildings-3d'] }).length;
          if (n === 0) flash('3D building data is unavailable for this view — showing streets and footprints only.', 6000);
        });
      }
    };
    map.on('moveend', onEnd);
    return () => {
      map.off('moveend', onEnd);
    };
  }, [ready, flash]);

  /* ------------------------------------------------------------------ camera actions */
  /** Stops whatever moves the camera: guided flight, flyTo/easeTo, idle orbit. */
  const stopCamera = useCallback(() => {
    stopOrbitRef.current?.();
    stopOrbitRef.current = null;
    const f = flightRef.current;
    flightRef.current = null;
    f?.cancel();
    mapRef.current?.stop();
  }, []);

  /** A native flyTo / easeTo wrapped as a cancellable flight with a completion callback. */
  const animateTo = useCallback(
    (
      kind: 'fly' | 'ease',
      view: CameraView & { padding?: PaddingOptions },
      ms: number,
      onEnd: () => void,
      easing: (t: number) => number = smoothOut,
    ) => {
      const map = mapRef.current;
      if (!map) return;
      let live = true;
      const end = () => {
        if (!live) return;
        live = false;
        onEnd();
      };
      map.once('moveend', end);
      flightRef.current = {
        cancel: () => {
          if (!live) return;
          live = false;
          map.off('moveend', end);
          map.stop();
        },
      };
      const opts = { ...view, duration: prefersReducedMotion() ? 0 : ms, easing, essential: true };
      if (kind === 'fly') map.flyTo({ ...opts, curve: 1.32 });
      else map.easeTo(opts);
    },
    [],
  );

  /** Camera choreography for each journey stage. Long, gentle moves across scales; short ones on the street. */
  const flyToStage = useCallback(
    (s: JourneyStage, token: number, restore: CameraView | null = null) => {
      const map = mapRef.current;
      if (!map) return;
      const padding = journeyPadding(s);
      const finish = () => {
        if (token !== tokenRef.current) return;
        flightRef.current = null;
        setPhase('free');
        setFlying(false);
        if (stageIndex(s) >= 2) setUnlocked(true);
        if (s === 'water') setFlowNonce((n) => n + 1);
        if (s === 'city' && !prefersReducedMotion()) stopOrbitRef.current = idleOrbit(map, ORBIT_DEG_PER_SEC);
      };
      const c = map.getCenter();
      const away = (v: CameraView) => distanceM([c.lng, c.lat], v.center);
      const z = map.getZoom();

      setPhase('flying');
      setFlying(true);
      switch (s) {
        case 'city':
          animateTo('fly', { ...cityView, padding }, 5600, finish);
          break;
        case 'neighbourhood':
          animateTo('fly', { ...neighborhoodView, padding }, z < 14.2 ? 7200 : 3800, finish, approach);
          break;
        case 'street':
          // from the city this is the full continuous zoom-in; from the neighbourhood a shorter descent
          animateTo('fly', { ...streetView, padding }, z < 14.2 ? 9500 : z < 16.5 ? 5600 : 2600, finish, approach);
          break;
        case 'water':
          // back from the section: return to exactly the view the visitor had before
          if (restore) animateTo('ease', { ...restore, padding }, 1600, finish);
          else if (away(streetView) > 600 || z < 15.5) animateTo('fly', { ...streetView, padding }, 4200, finish);
          else animateTo('ease', { ...streetView, padding }, 1800, finish);
          break;
        case 'below': {
          const hero = flowRef.current?.getHero();
          const v = hero ? waterFocusView(hero.sink) : streetView;
          animateTo(away(v) > 600 ? 'fly' : 'ease', { ...v, zoom: v.zoom - 0.25, padding }, 1800, finish);
          break;
        }
      }
    },
    [animateTo],
  );

  /** Go to a journey stage (forward, back or a visited step). Every call supersedes the previous one. */
  const goStage = useCallback(
    (s: JourneyStage) => {
      const map = mapRef.current;
      if (!map || !ready) return;
      const token = ++tokenRef.current;
      stopCamera();
      clearSelection();
      const idx = stageIndex(s);
      const from = jStageRef.current;
      let restore: CameraView | null = null;
      if (s === 'below' && from !== 'below') {
        const c = map.getCenter();
        prevCamRef.current = { center: [c.lng, c.lat], zoom: map.getZoom(), pitch: map.getPitch(), bearing: map.getBearing() };
      } else if (s === 'water' && from === 'below' && guidedRef.current) {
        restore = prevCamRef.current;
      }
      if (s !== 'below') prevCamRef.current = s === 'water' ? prevCamRef.current : null;
      setGuided(true);
      setJStage(s);
      setReached((r) => Math.max(r, idx));
      setOffCourse(false);
      setClimateOpen(false);
      if (idx < 3) {
        // city → street: no water layers yet; rain stays as the user left it
        setFlows(false);
        setFollowing(false);
        setArrived(false);
        flowRef.current?.resetHero();
      }
      if (idx < 4) setSurface(false);
      if (s === 'water') {
        setRain(true);
        setFlows(true);
      }
      if (s === 'below') {
        setFlows(true);
        setSurface(true);
      }
      flyToStage(s, token, restore);
    },
    [ready, stopCamera, clearSelection, flyToStage],
  );

  /** Stage 4: send one droplet along the featured path, camera eases gently toward it. */
  const followWater = useCallback(() => {
    const map = mapRef.current;
    const fl = flowRef.current;
    const hero = fl?.getHero();
    if (!map || !fl || !hero) {
      flash('Water paths are still being traced. Try again in a moment.');
      return;
    }
    const token = ++tokenRef.current;
    stopCamera();
    setOffCourse(false);
    setFollowing(true);
    const v = waterFocusView(hero.sink);
    const mid = hero.coords[Math.floor(hero.coords.length / 2)];
    setPhase('flying');
    setFlying(true);
    animateTo('ease', { ...v, center: [(mid[0] + hero.sink[0]) / 2, (mid[1] + hero.sink[1]) / 2], padding: journeyPadding('water') }, 2600, () => {
      if (token !== tokenRef.current) return;
      flightRef.current = null;
      setPhase('free');
      setFlying(false);
    });
    fl.follow(() => {
      setFollowing(false);
      setArrived(true);
    });
  }, [stopCamera, animateTo, flash]);

  const pauseCamera = useCallback(() => {
    ++tokenRef.current;
    stopCamera();
    setPhase('free');
    setFlying(false);
    setOffCourse(true);
  }, [stopCamera]);

  const interruptCamera = useCallback(() => {
    if (phaseRef.current === 'flying') pauseCamera();
    else if (phaseRef.current === 'intro' || stopOrbitRef.current) {
      ++tokenRef.current;
      stopCamera();
      setPhase('free');
    }
  }, [pauseCamera, stopCamera]);

  /** Leave the guided journey: full interface, inspection and all layers. */
  const exploreFreely = useCallback(() => {
    ++tokenRef.current;
    stopCamera();
    setGuided(false);
    setPhase('free');
    setFlying(false);
    setFollowing(false);
    setOffCourse(false);
    mapRef.current?.easeTo({ padding: journeyPadding(null), duration: prefersReducedMotion() ? 0 : 900, easing: smoothOut });
  }, [stopCamera]);

  /* explore-mode camera shortcuts (existing controls) */
  const flyTarget = useCallback(() => {
    const map = mapRef.current;
    if (!map) return;
    ++tokenRef.current;
    stopCamera();
    setPhase('free');
    map.flyTo({ ...TARGET, duration: prefersReducedMotion() ? 0 : 6500, curve: 1.25, easing: smoothOut, essential: true });
  }, [stopCamera]);

  const resetView = useCallback(() => {
    const map = mapRef.current;
    if (!map) return;
    ++tokenRef.current;
    stopCamera();
    clearSelection();
    setPhase('free');
    map.flyTo({ ...cityView, duration: prefersReducedMotion() ? 0 : 4200, curve: 1.2, easing: smoothOut, essential: true });
  }, [clearSelection, stopCamera]);

  /* Give manual map gestures and keyboard navigation control immediately. */
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !ready) return;
    const canvas = map.getCanvasContainer();
    const onKey = (e: KeyboardEvent) => {
      if (['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown', '+', '-', '='].includes(e.key)) interruptCamera();
    };
    canvas.addEventListener('pointerdown', interruptCamera, true);
    canvas.addEventListener('wheel', interruptCamera, { capture: true, passive: true });
    canvas.addEventListener('keydown', onKey, true);
    return () => {
      canvas.removeEventListener('pointerdown', interruptCamera, true);
      canvas.removeEventListener('wheel', interruptCamera, true);
      canvas.removeEventListener('keydown', onKey, true);
    };
  }, [ready, interruptCamera]);

  /* keep the framing right when the window changes size */
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !ready) return;
    let t = 0;
    const onResize = () => {
      window.clearTimeout(t);
      t = window.setTimeout(() => {
        if (phaseRef.current === 'flying') return;
        map.setPadding(journeyPadding(guidedRef.current ? jStageRef.current : null));
      }, 200);
    };
    window.addEventListener('resize', onResize);
    return () => {
      window.clearTimeout(t);
      window.removeEventListener('resize', onResize);
    };
  }, [ready]);

  /* study-area emphasis per stage: marker at city scale, outline at neighbourhood scale, quiet at the street */
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !ready || !map.getLayer('study-line')) return;
    const s = guided ? jStage : null;
    // the home page marks the study area with the ring tag (map-tag--study) instead
    const point = 0;
    const line = s === 'neighbourhood' ? 1 : s === 'street' ? 0.32 : s === 'water' || s === 'below' ? 0.14 : 0;
    for (const id of ['city-river-tint', 'city-rhine-glow', 'city-rhine-centre']) {
      if (map.getLayer(id)) map.setLayoutProperty(id, 'visibility', s === 'city' ? 'visible' : 'none');
    }
    map.setPaintProperty('study-point', 'circle-opacity', point);
    map.setPaintProperty('study-point', 'circle-stroke-opacity', point * 0.9);
    map.setPaintProperty('study-line', 'line-opacity', line * 0.9);
    map.setPaintProperty('study-glow', 'line-opacity', line * 0.4);
    baselTagRef.current?.getElement().firstElementChild?.classList.toggle('is-on', s === 'city');
    studyTagRef.current?.getElement().firstElementChild?.classList.toggle('is-on', s === 'city' || s === 'neighbourhood');
  }, [guided, jStage, ready]);

  const adjustCamera = (adjust: (map: MLMap) => { zoom?: number; bearing?: number; pitch?: number }, duration: number) => {
    const map = mapRef.current;
    if (!map) return;
    interruptCamera();
    map.easeTo({ ...adjust(map), duration: prefersReducedMotion() ? 0 : duration, easing: smoothOut });
  };
  const zoomBy = (d: number) => adjustCamera((map) => ({ zoom: map.getZoom() + d }), 600);
  const rotateBy = (d: number) => adjustCamera((map) => ({ bearing: map.getBearing() + d }), 800);
  const north = () => adjustCamera(() => ({ bearing: 0 }), 900);
  const tilt = () => adjustCamera((map) => ({ pitch: map.getPitch() > 20 ? 0 : 60 }), 1000);

  /* ------------------------------------------------------------------ rain: wet-street look */
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !ready) return;
    const wet = rain;
    const colors = paper ? PAPER_COLORS : COLORS;
    const street = paper ? PAPER_STREETS : STREET_COLORS;
    const buildingColor = paper ? paperBuildingColor : BUILDING_EXTRUSION_COLOR;
    const buildingColors = (palette: typeof colors | typeof street) =>
      wet
        ? buildingColor(palette.buildingWetLow, palette.buildingWetHigh)
        : buildingColor(palette.buildingLow, palette.buildingHigh);
    map.setPaintProperty('buildings-3d', 'fill-extrusion-color', streetPaint(buildingColors(colors), buildingColors(street)));
    map.setPaintProperty('roads-minor', 'line-color', wet
      ? streetPaint(paper ? '#e3e8e6' : '#1b2a40', street.roadWetMinor)
      : streetPaint(colors.roadMinor, street.roadMinor));
    map.setPaintProperty('roads-major', 'line-color', wet
      ? streetPaint(paper ? '#e9eeec' : '#223652', street.roadWetMajor)
      : streetPaint(colors.roadMajor, street.roadMajor));
    map.setSky({
      'sky-color': paper ? (wet ? '#dfe3e0' : '#e9eae2') : '#060a12',
      'horizon-color': paper ? (wet ? '#d3d9d6' : '#dfe1d5') : (wet ? '#1c2c47' : '#15233b'),
      'fog-color': paper ? (wet ? '#d8dedb' : '#e4e5dd') : (wet ? '#122038' : '#0a1222'),
      'fog-ground-blend': wet ? 0.35 : 0.55,
      'horizon-fog-blend': wet ? 0.9 : 0.7,
      'sky-horizon-blend': 0.6,
      'atmosphere-blend': 0.5,
    });
  }, [rain, ready, paper]);

  /* ------------------------------------------------------------------ rain: water spreading over the streets */
  useEffect(() => {
    if (!ready) return;
    waterRef.current?.setRain(rain && !underground, rainIntensity);
  }, [rain, rainIntensity, ready, underground]);

  /* ------------------------------------------------------------------ water flows */
  useEffect(() => {
    const map = mapRef.current;
    const fl = flowRef.current;
    if (!map || !ready || !fl) return;
    const greens = ['park', 'landcover-green', 'landuse-green'];
    const drain = drainRef.current;
    if (!flows) {
      fl.stop();
      drain?.stop();
      setFlowStats(null);
      setFlowHint(null);
      setHeroKind(null);
      greens.forEach((id) => map.setPaintProperty(id, 'fill-color', COLORS.green));
      return;
    }
    greens.forEach((id) => map.setPaintProperty(id, 'fill-color', '#0f3328'));
    // city-wide runoff towards the rivers; fades out at street level where the roof → tree paths take over
    drain?.start().then((ok) => {
      if (!ok) flash('City-wide runoff routes could not be loaded.');
    });

    let timer = 0;
    let waitingForStreets = false;
    const rebuild = (event?: MapMovementEvent & { ambientOrbit?: boolean }) => {
      if (event?.ambientOrbit) return;
      window.clearTimeout(timer);
      timer = window.setTimeout(() => {
        const streetZoom = guided ? 15.5 : 15;
        waitingForStreets = map.getZoom() >= streetZoom && !map.isSourceLoaded('omt');
        if (waitingForStreets) return;
        if (guided) {
          // guided: a few paths around the study street + one featured path; keep it stable once followed
          if (followingRef.current || arrivedRef.current) return;
          if (phaseRef.current === 'flying' || map.getZoom() < 15.5) return;
          setFlowHint(null);
          const stats = fl.build(treesRef.current, { max: 14, focus: STUDY_CENTER, hero: true });
          setFlowStats(stats);
          setHeroKind(fl.getHero()?.kind ?? null);
          fl.start();
          return;
        }
        if (map.getZoom() < 15) {
          setFlowHint(CITY_FLOW_HINT);
          fl.build(null);
          fl.stop();
          return;
        }
        setFlowHint(null);
        const stats = fl.build(treesRef.current);
        setFlowStats(stats);
        setHeroKind(null);
        fl.start();
      }, 220);
    };
    const onSourceData = ({ sourceId, isSourceLoaded }: { sourceId: string; isSourceLoaded: boolean }) => {
      if (waitingForStreets && sourceId === 'omt' && isSourceLoaded) rebuild();
    };
    map.on('sourcedata', onSourceData);
    map.on('moveend', rebuild);
    rebuild();
    if (guided && fl.getHero() && (followingRef.current || arrivedRef.current)) fl.start();
    return () => {
      window.clearTimeout(timer);
      map.off('moveend', rebuild);
      map.off('sourcedata', onSourceData);
    };
  }, [flows, ready, treesVersion, guided, flowNonce]);

  /* ------------------------------------------------------------------ trees (Basel tree cadastre) */
  useEffect(() => {
    // trees are the infiltration points for the street-level water paths
    if (unlocked || (flows && !guided)) setTreesOn(true);
  }, [unlocked, flows, guided]);

  useEffect(() => {
    const map = mapRef.current;
    if (!map || !ready) return;
    const vis = treesOn ? 'visible' : 'none';
    map.setLayoutProperty('trees', 'visibility', vis);
    map.setLayoutProperty('trees-glow', 'visibility', vis);
    if (!treesOn) {
      setTreeStatus('Tree cadastre · hidden');
      return;
    }
    let ctl: AbortController | null = null;
    const load = () => {
      if (map.getZoom() < 14.5) {
        setTreeStatus(treesRef.current ? `${treesRef.current.features.length.toLocaleString('de-CH')} trees · zoom in to update` : 'Tree cadastre · zoom in to load');
        return;
      }
      const c = map.getCenter();
      const here: LngLatTuple = [c.lng, c.lat];
      if (treesCenterRef.current && distanceM(here, treesCenterRef.current) < 380) return;
      ctl?.abort();
      ctl = new AbortController();
      setTreeStatus('Loading tree cadastre…');
      fetchTrees(here, 900, ctl.signal)
        .then((fc) => {
          treesRef.current = fc;
          treesCenterRef.current = here;
          (map.getSource('trees') as GeoJSONSource).setData(fc);
          setTreeStatus(`${fc.features.length.toLocaleString('de-CH')} trees within 900 m · Baumkataster`);
          setTreesVersion((v) => v + 1);
        })
        .catch((e) => {
          if ((e as Error).name === 'AbortError') return;
          setTreeStatus('Tree cadastre unavailable right now');
        });
    };
    load();
    map.on('moveend', load);
    return () => {
      ctl?.abort();
      map.off('moveend', load);
    };
  }, [treesOn, ready]);

  /* ------------------------------------------------------------------ climate rasters (WMS geo.bs.ch) */
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !ready) return;
    if (map.getLayer('climate')) map.removeLayer('climate');
    if (map.getSource('climate')) map.removeSource('climate');
    const layer = CLIMATE_LAYERS.find((l) => l.id === climateId);
    if (!layer) {
      setClimateLoading(false);
      return;
    }
    const name = climateYear === '2030' && layer.wms2030 ? layer.wms2030 : layer.wms;
    const onClimateTiles = ({ sourceId, isSourceLoaded }: MapSourceDataEvent) => {
      if (sourceId === 'climate') setClimateLoading(!isSourceLoaded);
    };
    setClimateLoading(true);
    map.on('sourcedata', onClimateTiles);
    map.addSource('climate', {
      type: 'raster',
      tiles: [wmsTileUrl(name)],
      tileSize: 512,
      bounds: BS_BOUNDS,
      minzoom: 11,
      maxzoom: 19,
      attribution: '',
    });
    map.addLayer(
      {
        id: 'climate',
        type: 'raster',
        source: 'climate',
        paint: { 'raster-opacity': climateOpacity, 'raster-fade-duration': 350, 'raster-saturation': -0.05 },
      },
      map.getLayer('surface-water') ? 'surface-water' : 'building-flat',
    );
    return () => {
      map.off('sourcedata', onClimateTiles);
    };
    // opacity is applied separately so dragging the slider doesn't re-request tiles
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [climateId, climateYear, ready]);

  useEffect(() => {
    const map = mapRef.current;
    if (map?.getLayer('climate')) map.setPaintProperty('climate', 'raster-opacity', climateOpacity, { validate: false });
  }, [climateOpacity]);

  /* ------------------------------------------------------------------ live sensors (meteoblue City Climate network) */
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !ready) return;
    const ids = ['stations', 'stations-label'];
    if (!stationsOn) {
      ids.forEach((id) => map.getLayer(id) && map.removeLayer(id));
      if (map.getSource('stations')) map.removeSource('stations');
      setStationStatus('Live sensors · hidden');
      return;
    }
    if (!map.getSource('stations')) {
      map.addSource('stations', { type: 'geojson', data: { type: 'FeatureCollection', features: [] } });
      map.addLayer({
        id: 'stations',
        type: 'circle',
        source: 'stations',
        paint: {
          'circle-radius': ['interpolate', ['linear'], ['zoom'], 11, 4, 16, 9],
          'circle-color': [
            'case',
            ['==', ['get', 'temp'], null],
            '#5d6a82',
            ['interpolate', ['linear'], ['get', 'temp'], -5, '#3b6fd1', 5, '#58b6d6', 15, '#f1e37a', 25, '#f39a3c', 35, '#d9412b'],
          ],
          'circle-stroke-color': '#060a12',
          'circle-stroke-width': 1.5,
          'circle-pitch-alignment': 'map',
        },
      });
      map.addLayer({
        id: 'stations-label',
        type: 'symbol',
        source: 'stations',
        minzoom: 13,
        filter: ['!=', ['get', 'temp'], null],
        layout: {
          'text-field': [
            'format',
            ['concat', ['number-format', ['get', 'temp'], { 'max-fraction-digits': 1 }], '°'],
            {},
            ['step', ['zoom'], '', 15.5, ['concat', '\n', ['get', 'name']]],
            { 'font-scale': 0.8 },
          ],
          'text-font': ['Noto Sans Regular'],
          'text-size': 12,
          'text-offset': [0, 1.3],
          'text-anchor': 'top',
        },
        paint: { 'text-color': '#e6edf8', 'text-halo-color': '#060a12', 'text-halo-width': 1.4 },
      });
    }
    const ctl = new AbortController();
    const load = () => {
      setStationStatus('Loading live sensors…');
      fetchStations(ctl.signal)
        .then((fc) => {
          (map.getSource('stations') as GeoJSONSource | undefined)?.setData(fc);
          const latest = fc.features.reduce((t, f) => (f.properties.time > t ? f.properties.time : t), '');
          const at = latest ? new Date(latest).toLocaleTimeString('de-CH', { hour: '2-digit', minute: '2-digit' }) : '–';
          setStationStatus(`${fc.features.length} sensors reporting · latest ${at}`);
        })
        .catch((e) => {
          if ((e as Error).name === 'AbortError') return;
          setStationStatus('Live sensors unavailable right now');
        });
    };
    load();
    const timer = window.setInterval(load, 5 * 60 * 1000);
    return () => {
      ctl.abort();
      window.clearInterval(timer);
    };
  }, [stationsOn, ready]);

  /* ------------------------------------------------------------------ felling & replacement list (WMS geo.bs.ch) */
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !ready) return;
    if (!fellingOn) {
      if (map.getLayer('felling')) map.removeLayer('felling');
      if (map.getSource('felling')) map.removeSource('felling');
      return;
    }
    if (map.getSource('felling')) return;
    map.addSource('felling', {
      type: 'raster',
      tiles: [wmsTileUrl(FELLING_WMS)],
      tileSize: 512,
      bounds: BS_BOUNDS,
      minzoom: 11,
      maxzoom: 19,
      attribution: '',
    });
    // above the climate raster (which sits below 'building-flat'), below the 3D buildings
    map.addLayer(
      { id: 'felling', type: 'raster', source: 'felling', paint: { 'raster-opacity': 0.95, 'raster-fade-duration': 350 } },
      map.getLayer('buildings-3d') ? 'buildings-3d' : undefined,
    );
  }, [fellingOn, ready]);

  const selectClimate = (id: string | null) => {
    setClimateId(id);
    const l = CLIMATE_LAYERS.find((x) => x.id === id);
    if (l) setClimateOpacity(l.opacity);
    if (id === 'areal') setClimateYear('2030');
  };

  /* ------------------------------------------------------------------ keyboard: Esc closes things */
  const projectHero = useCallback(() => {
    const map = mapRef.current;
    const hero = flowRef.current?.getHero();
    if (!map || !hero) return null;
    const p = map.project(hero.sink);
    return { x: p.x, y: p.y };
  }, []);

  useEffect(() => {
    const updateRoute = () => setUnderground(location.hash === '#underground');
    window.addEventListener('hashchange', updateRoute);
    return () => window.removeEventListener('hashchange', updateRoute);
  }, []);

  /* the 3D underground is entered through the map: the camera dives into Therwilerstrasse,
     the map dims, and the cutaway rises out of the street; leaving reverses it */
  const [ugDiving, setUgDiving] = useState(false);
  const [ugLeaving, setUgLeaving] = useState(false);
  const ugReturnRef = useRef<CameraView | null>(null);

  const openUnderground = () => {
    const map = mapRef.current;
    const show = () => {
      history.replaceState(null, '', '#underground');
      setUgDiving(false);
      setUnderground(true);
    };
    if (surface) setSurface(false);
    if (!map || !ready || prefersReducedMotion()) {
      show();
      return;
    }
    const token = ++tokenRef.current;
    stopCamera();
    const c = map.getCenter();
    ugReturnRef.current = { center: [c.lng, c.lat], zoom: map.getZoom(), pitch: map.getPitch(), bearing: map.getBearing() };
    setUgDiving(true);
    setPhase('flying');
    const descend = () => {
      if (token !== tokenRef.current) return;
      animateTo('ease', { center: STUDY_CENTER, zoom: 19.4, pitch: 74, bearing: STREET_BEARING, padding: NO_PADDING }, 2100, () => {
        if (token !== tokenRef.current) return;
        flightRef.current = null;
        setPhase('free');
        show();
      }, dive);
    };
    const away = distanceM([c.lng, c.lat], STUDY_CENTER);
    // first reach the street (from anywhere in Basel), then go down into it
    if (away > 450 || map.getZoom() < 16) animateTo('fly', { ...streetView, padding: NO_PADDING }, away > 3000 ? 7000 : 4200, descend, approach);
    else descend();
  };

  const leaveUnderground = () => {
    if (location.hash === '#underground') history.replaceState(null, '', location.pathname + location.search);
    setUnderground(false);
  };

  /** sink the cutaway back into the street, then rise the camera to where the visitor came from */
  const riseFromUnderground = (then?: () => void) => {
    if (ugLeaving) return;
    setUgLeaving(true);
    window.setTimeout(() => {
      leaveUnderground();
      setUgLeaving(false);
      if (guidedRef.current && jStageRef.current === 'below') setJStage('water');
      const map = mapRef.current;
      const back = ugReturnRef.current ?? streetView;
      ugReturnRef.current = null;
      if (map) {
        const token = ++tokenRef.current;
        stopCamera();
        setPhase('flying');
        animateTo('ease', { ...back, padding: journeyPadding(guidedRef.current ? jStageRef.current : null) }, 2000, () => {
          if (token !== tokenRef.current) return;
          flightRef.current = null;
          setPhase('free');
        }, settle);
      }
      then?.();
    }, prefersReducedMotion() ? 0 : 750);
  };

  useEffect(() => {
    if (!ready || !underground) return;
    if (guidedRef.current && jStageRef.current === 'city') exploreFreely();
    else {
      ++tokenRef.current;
      stopCamera();
      setPhase('free');
      setFlying(false);
    }
  }, [underground, ready, exploreFreely, stopCamera]);

  const closeSurface = useCallback(() => {
    // in the journey, closing the section steps back up to the water on the street
    if (guidedRef.current && jStageRef.current === 'below') goStage('water');
    else setSurface(false);
  }, [goStage]);

  const closeUnderground = () => riseFromUnderground();

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape' || underground) return;
      if (surface) closeSurface();
      else if (selection) clearSelection();
      else if (climateOpen) setClimateOpen(false);
      else if (flying) pauseCamera();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [underground, surface, selection, climateOpen, clearSelection, closeSurface, flying, pauseCamera]);

  const showIntro = guided && jStage === 'city';
  const nearTarget = distanceM([cam.lng, cam.lat], TARGET.center) < ARRIVAL_RADIUS_M;
  const stage = stageOf(cam.zoom, nearTarget);
  const guidedAtStreet = guided && unlocked && stage === 'street' && (jStage === 'street' || jStage === 'water');

  return (
    <div
      className={`app phase-${phase} ${rain ? 'is-raining' : ''} ${flows ? 'is-flowing' : ''} ${surface ? 'has-surface' : ''} ${guided ? `is-guided j-${jStage}` : 'is-exploring'}`}
    >
      <div inert={underground} className={`ug-host ${ugDiving ? 'is-diving' : ''} ${underground ? 'is-under' : ''}`}>
      <div ref={containerRef} className="map" />
      {paper && !basemapVisible && !fatal && <img className="map-preview" src={`${import.meta.env.BASE_URL}images/basel-entry.webp`} alt="Basel basemap preview" />}
      <div className="vignette" aria-hidden="true" />
      {paper && ready && guided && (jStage === 'city' || jStage === 'neighbourhood') && studyTagRef.current &&
        createPortal(<TherwilerstrasseMarker />, studyTagRef.current.getElement())}

      {fatal && (
        <div className="fatal">
          <h1>Map unavailable</h1>
          <p>{fatal}</p>
        </div>
      )}

      {/* Brand + scale steps */}
      <header className="topbar">
        <div className="brand">
          <span className="brand__mark" aria-hidden="true">
            <svg viewBox="0 0 24 24" width="18" height="18">
              <defs>
                <linearGradient id="brand-drop" x1="0" y1="0" x2="1" y2="1">
                  <stop offset="0" stopColor="#4fb6ff" />
                  <stop offset="1" stopColor="#4ef0a2" />
                </linearGradient>
              </defs>
              <path d="M12 3.5c3.6 4.4 6 7.6 6 10.6a6 6 0 0 1-12 0c0-3 2.4-6.2 6-10.6Z" fill="none" stroke="url(#brand-drop)" strokeWidth="1.8" strokeLinejoin="round" />
            </svg>
          </span>
          <span className="brand__text">
            <b>Urban Climate Lab</b>
            <span>Basel · Beneath the Surface</span>
          </span>
        </div>
        {!fatal && guided && <MapStages stage={stage} ready={ready} onGo={goStage} />}
        {!fatal && !guided && (
          <div className="resume glass">
            <button onClick={() => goStage(jStage)} disabled={!ready}>
              <svg viewBox="0 0 24 24" width="15" height="15"><path d="M8 5l11 7-11 7z" fill="currentColor" /></svg>
              Return to guided journey
            </button>
            <button className="resume__basel" onClick={() => goStage('city')} disabled={!ready}>Back to Basel</button>
          </div>
        )}
        <div className="topbar__actions">
          {!fatal && !surface && !underground && (
            <ClimatePanel
              open={climateOpen}
              onToggleOpen={() => setClimateOpen((o) => !o)}
              activeId={climateId}
              onSelect={selectClimate}
              year={climateYear}
              onYear={setClimateYear}
              opacity={climateOpacity}
              onOpacity={setClimateOpacity}
              trees={treesOn}
              onTrees={() => setTreesOn((t) => !t)}
              treeStatus={treeStatus}
              felling={fellingOn}
              onFelling={() => setFellingOn((f) => !f)}
              stations={stationsOn}
              onStations={() => setStationsOn((s) => !s)}
              stationStatus={stationStatus}
              loadingTiles={climateLoading}
            />
          )}
          <ThemeToggle named />
        </div>
      </header>

      {/* Live camera readout */}
      <aside className="hud glass" aria-label="Live view">
        <div className="hud__loc">
          <strong>{STAGE_LABEL[stage]}</strong>
          <span>
            {cam.lat.toFixed(4)}° N · {cam.lng.toFixed(4)}° E · z{cam.zoom.toFixed(1)} · {Math.round(cam.pitch)}°
          </span>
        </div>
        {showIntro && (
          <div className="hud__live">
            <p className={paper ? "eyebrow" : "hud__title"}><span className={paper ? "hud__live-dot" : "pulse-dot"} aria-hidden="true" /> Live view</p>
            <dl className="hud__metrics">
              <div><dt>Zoom</dt><dd>{cam.zoom.toFixed(1)}</dd></div>
              <div><dt>Pitch</dt><dd>{Math.round(cam.pitch)}°</dd></div>
              <div><dt>Bearing</dt><dd>{(Math.round(cam.bearing) + 360) % 360}°</dd></div>
            </dl>
            <p className="hud__centre">Centre <b>{cam.lat.toFixed(4)}° N · {cam.lng.toFixed(4)}° E</b></p>
          </div>
        )}
      </aside>

      {/* Intro (home page) */}
      {!paper && <section className={`intro ${showIntro ? '' : 'is-leaving'}`} aria-hidden={!showIntro} inert={!showIntro}>
        <div className="intro__card glass">
          <p className="intro__chip">1 / 5 · Basel, Switzerland</p>
          <h1>
            How Does a <em>Sponge-City</em> Street Work?
          </h1>
          <p className="intro__sub">
            Travel from Basel to Therwilerstrasse and discover what happens to rainwater above and beneath the street during heavy rain.
          </p>
          <div className="intro__actions">
            <button className="intro__cta" onClick={() => goStage('street')} disabled={!ready}>
              <span>{ready ? 'Explore Basel' : 'Loading Basel…'}</span>
              <svg viewBox="0 0 24 24" width="16" height="16" aria-hidden="true"><path d="M5 12h14M13 6l6 6-6 6" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" /></svg>
            </button>
            <button
              className={`intro__sound ${sound ? 'is-on' : ''}`}
              onClick={() => setSound((v) => !v)}
              aria-pressed={sound}
              aria-label={sound ? 'Sound on' : 'Sound off'}
              title={sound ? 'Sound on' : 'Sound off'}
            >
              <svg viewBox="0 0 24 24" width="16" height="16" aria-hidden="true">
                <path d="M4 10v4h4l5 4V6L8 10z" fill="currentColor" />
                {sound
                  ? <path d="M16 9a4 4 0 0 1 0 6M18.5 6.5a7.5 7.5 0 0 1 0 11" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" />
                  : <path d="M16.5 9.5l5 5M21.5 9.5l-5 5" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" />}
              </svg>
            </button>
          </div>
          <button className="intro__free" onClick={exploreFreely} disabled={!ready}>Explore Freely</button>
          <div className="intro__chapters">
            <span>Chapter navigation</span>
            <ol aria-label="Chapters">
              {JOURNEY.map((j, i) => (
                <li key={j.key}>
                  <button
                    className={i === 0 ? 'is-on' : ''}
                    aria-current={i === 0 ? 'step' : undefined}
                    aria-label={`Chapter ${i + 1}: ${j.label}`}
                    title={j.label}
                    disabled={!ready || i > Math.max(reached, 2)}
                    onClick={() => goStage(j.key)}
                  />
                </li>
              ))}
            </ol>
          </div>
        </div>
      </section>}
      {paper && !fatal && showIntro && !flying && !underground && (
        <>
          <CityOverview ready={ready} reached={reached} onExplore={exploreFreely} onGo={goStage} />
          <CityMapActions ready={ready} rain={rain} intensity={rainIntensity} onIntensity={setRainIntensity}
            onRain={() => setRain((value) => !value)} flows={flows} onFlows={toggleFlows} onFly={() => goStage('street')} />
        </>
      )}

      <FlightCaption show={guided && flying && stageIndex(jStage) <= 2} stage={stage} />

      {!fatal && guided && (
        <>
          <JourneyCard
            stage={jStage}
            flying={flying}
            offCourse={offCourse}
            raining={rain}
            following={following}
            arrived={arrived}
            heroKind={heroKind}
            pathsReady={heroKind !== null}
            onNext={() => goStage(jStage === 'neighbourhood' ? 'street' : 'water')}
            onFollow={followWater}
            onBelow={openUnderground}
            onRecenter={() => goStage(jStage)}
          />
          <JourneyNav
            stage={jStage}
            reached={reached}
            flying={flying}
            onGo={(st) => (st === 'below' ? openUnderground() : goStage(st))}
            onPause={pauseCamera}
            onBasel={() => goStage('city')}
            onExplore={exploreFreely}
          />
        </>
      )}

      {!fatal && ready && (
        <CameraControls
          bearing={cam.bearing}
          pitch={cam.pitch}
          onZoomIn={() => zoomBy(1)}
          onZoomOut={() => zoomBy(-1)}
          onRotate={rotateBy}
          onNorth={north}
          onTilt={tilt}
          onReset={guided ? () => goStage('city') : resetView}
          onFlyTarget={guided ? () => goStage('street') : flyTarget}
        />
      )}

      {!fatal && (
        <EnvToolbar
          visible={!surface && !flying && ((showIntro && !paper) || guidedAtStreet || !guided)}
          opening={showIntro}
          ready={ready}
          unlocked={guided ? guidedAtStreet : true}
          rain={rain}
          intensity={rainIntensity}
          onIntensity={setRainIntensity}
          flows={flows}
          surface={surface}
          flowStats={flowStats}
          flowHint={flowHint}
          onRain={() => setRain((r) => !r)}
          onFlows={toggleFlows}
          onSurface={() => setSurface((s) => !s)}
          onFlyTarget={guided ? () => goStage('street') : flyTarget}
          onStart={() => goStage('street')}
        />
      )}

      <InfoPanel sel={selection} onClose={clearSelection} />
      <SectionConnector active={guided && jStage === 'below' && surface} project={projectHero} />
      <SurfaceSection
        onUnderground={openUnderground}
        open={surface}
        raining={rain}
        onClose={closeSurface}
        intensity={rainIntensity}
        onIntensity={setRainIntensity}
        onRain={() => setRain((r) => !r)}
        flows={flows}
        onFlows={toggleFlows}
        fromStreet={guided && jStage === 'below' ? { kind: heroKind } : null}
      />

      <div className={`toast glass ${notice ? 'is-on' : ''}`} role="status">
        {notice}
      </div>
      </div>
      {underground && (
        <UndergroundView
          leaving={ugLeaving}
          onSection={() => riseFromUnderground(() => setSurface(true))}
          onClose={closeUnderground}
        />
      )}
    </div>
  );
}
