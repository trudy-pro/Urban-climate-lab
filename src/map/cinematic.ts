import type { Map as MLMap, PaddingOptions } from 'maplibre-gl';
import type { CameraView } from '../config';

/**
 * Cinematic, continuous camera flight through a list of keyframes (city → neighbourhood → street).
 *
 * MapLibre's flyTo() is used for single hops (Reset, "Fly to Therwilerstrasse"). For the multi-stage
 * intro we drive the camera ourselves so the flight never stops between stages:
 *  - one global easing (slow start, long decelerating tail) across all stages
 *  - zoom / pitch / bearing follow a smooth Hermite spline through the keyframes
 *  - the centre moves in Web-Mercator space, coupled to the zoom level so the destination stays
 *    visually anchored while the camera dives in (avoids the "whip" of linear centre interpolation)
 */

const mercX = (lng: number) => (lng + 180) / 360;
const mercY = (lat: number) => {
  const s = Math.sin((lat * Math.PI) / 180);
  return 0.5 - (0.25 * Math.log((1 + s) / (1 - s))) / Math.PI;
};
const lngFromX = (x: number) => x * 360 - 180;
const latFromY = (y: number) => {
  const y2 = 180 - y * 360;
  return (360 / Math.PI) * Math.atan(Math.exp((y2 * Math.PI) / 180)) - 90;
};

/** cubic-bezier(x1,y1,x2,y2) easing, solved numerically like CSS */
export function cubicBezier(x1: number, y1: number, x2: number, y2: number) {
  const bx = (t: number) => 3 * x1 * (1 - t) ** 2 * t + 3 * x2 * (1 - t) * t * t + t ** 3;
  const by = (t: number) => 3 * y1 * (1 - t) ** 2 * t + 3 * y2 * (1 - t) * t * t + t ** 3;
  return (x: number) => {
    if (x <= 0) return 0;
    if (x >= 1) return 1;
    let lo = 0;
    let hi = 1;
    let t = x;
    for (let i = 0; i < 24; i++) {
      t = (lo + hi) / 2;
      if (bx(t) < x) lo = t;
      else hi = t;
    }
    return by(t);
  };
}

function hermite(values: number[], knots: number[], g: number): number {
  const n = values.length;
  let i = 0;
  while (i < n - 2 && g > knots[i + 1]) i++;
  const t0 = knots[i];
  const t1 = knots[i + 1];
  const h = t1 - t0;
  const u = Math.max(0, Math.min(1, (g - t0) / h));
  const slope = (k: number) => {
    if (k === 0) return (values[1] - values[0]) / (knots[1] - knots[0]);
    if (k === n - 1) return (values[n - 1] - values[n - 2]) / (knots[n - 1] - knots[n - 2]);
    return (values[k + 1] - values[k - 1]) / (knots[k + 1] - knots[k - 1]);
  };
  const m0 = slope(i) * h;
  const m1 = slope(i + 1) * h;
  const u2 = u * u;
  const u3 = u2 * u;
  return (
    (2 * u3 - 3 * u2 + 1) * values[i] +
    (u3 - 2 * u2 + u) * m0 +
    (-2 * u3 + 3 * u2) * values[i + 1] +
    (u3 - u2) * m1
  );
}

export interface FlightHandle {
  cancel: () => void;
}

export function cinematicFlight(
  map: MLMap,
  stops: CameraView[],
  opts: {
    duration: number;
    knots?: number[];
    onDone?: () => void;
    onCancel?: () => void;
    onProgress?: (t: number) => void;
    /** Screen padding to arrive with (eased in during the flight), e.g. room for a side panel. */
    padding?: PaddingOptions;
  },
): FlightHandle {
  const c = map.getCenter();
  const start: CameraView = {
    center: [c.lng, c.lat],
    zoom: map.getZoom(),
    pitch: map.getPitch(),
    bearing: map.getBearing(),
  };
  const keys = [start, ...stops];
  const knots = opts.knots ?? keys.map((_, i) => i / (keys.length - 1));

  // unwrap bearings so we always rotate the short way
  const bearings = [keys[0].bearing];
  for (let i = 1; i < keys.length; i++) {
    let b = keys[i].bearing;
    while (b - bearings[i - 1] > 180) b -= 360;
    while (b - bearings[i - 1] < -180) b += 360;
    bearings.push(b);
  }
  const zooms = keys.map((k) => k.zoom);
  const pitches = keys.map((k) => k.pitch);
  const xs = keys.map((k) => mercX(k.center[0]));
  const ys = keys.map((k) => mercY(k.center[1]));
  const p = map.getPadding();
  const pad0 = { top: p.top ?? 0, bottom: p.bottom ?? 0, left: p.left ?? 0, right: p.right ?? 0 };
  const q = opts.padding ?? pad0;
  const pad1 = { top: q.top ?? 0, bottom: q.bottom ?? 0, left: q.left ?? 0, right: q.right ?? 0 };
  const padAt = (g: number): PaddingOptions => ({
    top: pad0.top + (pad1.top - pad0.top) * g,
    bottom: pad0.bottom + (pad1.bottom - pad0.bottom) * g,
    left: pad0.left + (pad1.left - pad0.left) * g,
    right: pad0.right + (pad1.right - pad0.right) * g,
  });

  // slow, graceful start; long decelerating approach into the street
  const ease = cubicBezier(0.42, 0, 0.12, 1);

  let raf = 0;
  let done = false;
  const t0 = performance.now();

  const stopInteraction = () => cancel();
  const container = map.getCanvasContainer();
  const events = ['mousedown', 'touchstart', 'wheel'] as const;
  events.forEach((e) => container.addEventListener(e, stopInteraction, { passive: true }));

  const cleanup = () => {
    cancelAnimationFrame(raf);
    events.forEach((e) => container.removeEventListener(e, stopInteraction));
  };

  function cancel() {
    if (done) return;
    done = true;
    cleanup();
    opts.onCancel?.();
  }

  const frame = (now: number) => {
    if (done) return;
    const t = Math.min(1, (now - t0) / opts.duration);
    const g = ease(t);

    const zoom = hermite(zooms, knots, g);
    const pitch = Math.max(0, Math.min(85, hermite(pitches, knots, g)));
    const bearing = hermite(bearings, knots, g);

    // segment-local centre interpolation coupled to zoom (scale-space interpolation)
    let i = 0;
    while (i < keys.length - 2 && g > knots[i + 1]) i++;
    const za = zooms[i];
    const zb = zooms[i + 1];
    const local = (g - knots[i]) / (knots[i + 1] - knots[i]);
    let u: number;
    if (Math.abs(zb - za) > 0.05) {
      u = (1 - Math.pow(2, za - zoom)) / (1 - Math.pow(2, za - zb));
      // blend toward time-based progress so the motion never stalls
      u = 0.75 * u + 0.25 * local;
    } else {
      u = local;
    }
    u = Math.max(0, Math.min(1, u));
    const x = xs[i] + (xs[i + 1] - xs[i]) * u;
    const y = ys[i] + (ys[i + 1] - ys[i]) * u;

    map.jumpTo({ center: [lngFromX(x), latFromY(y)], zoom, pitch, bearing, padding: padAt(g) });
    opts.onProgress?.(t);

    if (t < 1) {
      raf = requestAnimationFrame(frame);
    } else {
      done = true;
      cleanup();
      opts.onDone?.();
    }
  };
  raf = requestAnimationFrame(frame);

  return { cancel };
}

/** Very slow idle orbit used behind the intro screen. Stops on any user input. */
export function idleOrbit(map: MLMap, degPerSec = 1.4): () => void {
  let raf = 0;
  let last = performance.now();
  let stopped = false;
  const container = map.getCanvasContainer();
  const stop = () => {
    if (stopped) return;
    stopped = true;
    cancelAnimationFrame(raf);
    (['mousedown', 'touchstart', 'wheel'] as const).forEach((e) =>
      container.removeEventListener(e, stop),
    );
  };
  (['mousedown', 'touchstart', 'wheel'] as const).forEach((e) =>
    container.addEventListener(e, stop, { passive: true }),
  );
  const tick = (now: number) => {
    if (stopped) return;
    const dt = Math.min(0.05, (now - last) / 1000);
    last = now;
    if (!map.isMoving()) map.setBearing(map.getBearing() + degPerSec * dt, { ambientOrbit: true });
    raf = requestAnimationFrame(tick);
  };
  raf = requestAnimationFrame(tick);
  return stop;
}
