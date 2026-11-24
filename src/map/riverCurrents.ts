import type { Map as MLMap, StyleImageInterface } from 'maplibre-gl';
import { getTheme } from '../theme';

const SURFACE = 'river-ripples';
const CHANNEL = 'river-channel-current';
const FRAME_MS = 1000 / 24;
const TAU = Math.PI * 2;

type Pixel = [red: number, green: number, blue: number, alpha: number];

/** Scroll a seamless pattern in map space, with subpixel interpolation between frames. */
function pattern(
  width: number,
  height: number,
  color: (x: number, y: number, dark: boolean) => Pixel,
  velocity: [number, number],
  time: () => number,
): StyleImageInterface {
  const textures = [false, true].map((dark) => {
    const t = new Uint8Array(width * height * 4);
    for (let y = 0; y < height; y++) {
      for (let x = 0; x < width; x++) {
        t.set(color(x / width, y / height, dark), (y * width + x) * 4);
      }
    }
    return t;
  });
  let texture = textures[getTheme() === 'dark' ? 1 : 0];
  const data = new Uint8Array(texture.length);
  data.set(texture);
  let renderedAt = 0;

  return {
    width, height, data,
    render() {
      const now = time();
      const current = textures[getTheme() === 'dark' ? 1 : 0];
      if (now === renderedAt && current === texture) return false;
      texture = current;
      renderedAt = now;
      const xShift = (now * velocity[0] % width + width) % width;
      const yShift = (now * velocity[1] % height + height) % height;
      const dx = Math.floor(xShift);
      const dy = Math.floor(yShift);
      const fx = xShift - dx;
      const fy = yShift - dy;
      for (let y = 0; y < height; y++) {
        const top = ((y + dy) % height) * width;
        const bottom = ((y + dy + 1) % height) * width;
        for (let x = 0; x < width; x++) {
          const left = (x + dx) % width;
          const right = (left + 1) % width;
          const a = (top + left) * 4;
          const b = (top + right) * 4;
          const c = (bottom + left) * 4;
          const d = (bottom + right) * 4;
          const out = (y * width + x) * 4;
          for (let channel = 0; channel < 4; channel++) {
            const upper = texture[a + channel] * (1 - fx) + texture[b + channel] * fx;
            const lower = texture[c + channel] * (1 - fx) + texture[d + channel] * fx;
            data[out + channel] = Math.round(upper * (1 - fy) + lower * fy);
          }
        }
      }
      return true;
    },
  };
}

export function installRiverCurrents(map: MLMap): () => void {
  const motion = window.matchMedia('(prefers-reduced-motion: reduce)');
  let timer = 0;
  const repaint = () => map.triggerRepaint();
  const time = () => {
    if (motion.matches) return 0;
    if (!timer) {
      timer = window.setTimeout(() => {
        timer = 0;
        repaint();
      }, FRAME_MS);
    }
    return Math.floor(performance.now() / FRAME_MS) * FRAME_MS;
  };
  motion.addEventListener('change', repaint);

  map.addImage(SURFACE, pattern(64, 64, (x, y, dark) => {
    const bend = Math.sin(TAU * (x + y)) + Math.sin(TAU * (x * 2 - y)) * 0.55;
    const swell = Math.sin(TAU * (x + y * 3) + bend);
    const ripples = Math.sin(TAU * (x * 3 + y * 7) + bend * 1.7);
    const sheen = (0.5 + 0.5 * (swell * 0.82 + ripples * 0.18)) ** 1.8;
    return dark
      ? [16 + 22 * sheen, 64 + 55 * sheen, 99 + 57 * sheen, 120 + 65 * sheen]
      : [150 + 70 * sheen, 178 + 55 * sheen, 184 + 50 * sheen, 70 + 80 * sheen];
  }, [0.008, -0.012], time));

  map.addImage(CHANNEL, pattern(64, 8, (x, y, dark) => {
    const ripple = 0.5 + 0.5 * Math.sin(TAU * x + Math.sin(TAU * x * 2) * 0.5);
    const bank = Math.sin(Math.PI * y) ** 2;
    return dark
      ? [37, 127 + 33 * ripple, 172 + 37 * ripple, (65 + 106 * ripple ** 1.8) * bank]
      : [70, 125 + 30 * ripple, 150 + 30 * ripple, (65 + 106 * ripple ** 1.8) * bank];
  }, [-0.015, 0], time));

  // Tile polygons clip broad surfaces to the banks. Centerline currents underneath the fill
  // keep narrow, line-only channels animated without adding a stripe to the middle of wide rivers.
  map.addLayer({
    id: CHANNEL,
    type: 'line',
    source: 'omt',
    'source-layer': 'waterway',
    filter: [
      'all',
      ['in', ['get', 'class'], ['literal', ['river', 'stream']]],
      ['!=', ['get', 'brunnel'], 'tunnel'],
    ],
    layout: { 'line-cap': 'round', 'line-join': 'round' },
    paint: {
      'line-pattern': CHANNEL,
      'line-width': ['interpolate', ['linear'], ['zoom'], 11, 1, 14, 1.6, 17, 3.4],
      'line-opacity': 0.84,
    },
  }, 'water');

  map.addLayer({
    id: SURFACE,
    type: 'fill',
    source: 'omt',
    'source-layer': 'water',
    filter: ['==', ['get', 'class'], 'river'],
    paint: { 'fill-pattern': SURFACE, 'fill-opacity': 0.78 },
  }, 'water-edge');

  return () => {
    window.clearTimeout(timer);
    motion.removeEventListener('change', repaint);
  };
}
