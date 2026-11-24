import type { Map as MLMap } from 'maplibre-gl';

/**
 * Hand-drawn landscape marks for the illustrated "paper" basemap:
 * clustered conifer glyphs for woods, rows of short olive strokes for meadows,
 * and dark furrow dashes for farmland / vineyards / allotments.
 * Drawn once on a canvas (deterministic seed) and registered as seamless fill patterns.
 */
export const PATTERNS = {
  forest: 'illus-forest',
  meadow: 'illus-meadow',
  furrow: 'illus-furrow',
} as const;

export const INK = {
  paper: '#e4e5dc',
  wash: '#b9bf95',
  washDeep: '#a6b07f',
  forest: '#2f4f33',
  forestMid: '#4b6b43',
  meadow: '#7f9a4c',
  meadowLight: '#9fb36a',
  furrow: '#2b3024',
  road: '#fbfbf6',
  water: '#c4d3d2',
  waterEdge: '#9bb3b4',
  waterInk: '#3f7d9c',
};

const PR = 2; // draw at 2× for crisp strokes on hi-dpi screens

function rng(seed: number) {
  let s = seed >>> 0;
  return () => {
    s = (s * 1664525 + 1013904223) >>> 0;
    return s / 4294967296;
  };
}

function canvas(size: number) {
  const c = document.createElement('canvas');
  c.width = c.height = size * PR;
  const ctx = c.getContext('2d')!;
  ctx.scale(PR, PR);
  ctx.lineCap = 'round';
  return { c, ctx };
}

/** Draw `fn` at (x,y) and at its wrapped neighbours so the tile is seamless. */
function wrapped(size: number, x: number, y: number, pad: number, fn: (x: number, y: number) => void) {
  for (const dx of [-size, 0, size]) {
    for (const dy of [-size, 0, size]) {
      const px = x + dx;
      const py = y + dy;
      if (px > -pad && px < size + pad && py > -pad && py < size + pad) fn(px, py);
    }
  }
}

function forest() {
  const size = 96;
  const { c, ctx } = canvas(size);
  const r = rng(7);
  // dense short vertical hatching (the canopy texture)
  for (let i = 0; i < 260; i++) {
    const x = r() * size;
    const y = r() * size;
    const h = 2.2 + r() * 2.2;
    ctx.strokeStyle = r() < 0.55 ? INK.forestMid : INK.forest;
    ctx.globalAlpha = 0.65 + r() * 0.35;
    ctx.lineWidth = 0.9 + r() * 0.5;
    wrapped(size, x, y, 6, (px, py) => {
      ctx.beginPath();
      ctx.moveTo(px, py);
      ctx.lineTo(px + (r() - 0.5) * 0.4, py + h);
      ctx.stroke();
    });
  }
  // conifer glyphs: stem with drooping branch ticks
  for (let i = 0; i < 16; i++) {
    const x = r() * size;
    const y = r() * size;
    const h = 6 + r() * 4;
    ctx.strokeStyle = INK.forest;
    ctx.globalAlpha = 0.9;
    ctx.lineWidth = 1;
    wrapped(size, x, y, 12, (px, py) => {
      ctx.beginPath();
      ctx.moveTo(px, py);
      ctx.lineTo(px, py + h);
      for (let k = 1; k <= 3; k++) {
        const ty = py + (k * h) / 4;
        const w = (k / 3) * (h * 0.36);
        ctx.moveTo(px, ty - 1.2);
        ctx.lineTo(px - w, ty + 0.6);
        ctx.moveTo(px, ty - 1.2);
        ctx.lineTo(px + w, ty + 0.6);
      }
      ctx.stroke();
    });
  }
  return c;
}

function rows(seed: number, size: number, rowGap: number, colors: string[], stroke: [number, number], dash: [number, number], alpha: number) {
  const { c, ctx } = canvas(size);
  const r = rng(seed);
  for (let y = rowGap / 2; y < size; y += rowGap) {
    const drift = (r() - 0.5) * 1.2;
    let x = r() * 3;
    while (x < size) {
      const h = dash[0] + r() * (dash[1] - dash[0]);
      ctx.strokeStyle = colors[Math.floor(r() * colors.length)];
      ctx.globalAlpha = alpha * (0.7 + r() * 0.3);
      ctx.lineWidth = stroke[0] + r() * (stroke[1] - stroke[0]);
      const yy = y + drift + (r() - 0.5) * 0.8;
      wrapped(size, x, yy, 6, (px, py) => {
        ctx.beginPath();
        ctx.moveTo(px, py - h / 2);
        ctx.lineTo(px + (r() - 0.5) * 0.5, py + h / 2);
        ctx.stroke();
      });
      x += 2.1 + r() * 1.6;
    }
  }
  return c;
}

const meadow = () => rows(11, 64, 8, [INK.meadow, INK.meadowLight, INK.forestMid], [0.8, 1.2], [2.4, 4], 0.85);
const furrow = () => rows(23, 64, 6, [INK.furrow, '#454b38'], [0.9, 1.3], [2.6, 3.8], 0.9);

export function installIllustrationPatterns(map: MLMap) {
  const add = (id: string, draw: () => HTMLCanvasElement) => {
    if (map.hasImage(id)) return;
    const c = draw();
    const data = c.getContext('2d')!.getImageData(0, 0, c.width, c.height);
    map.addImage(id, data, { pixelRatio: PR });
  };
  const all = () => {
    add(PATTERNS.forest, forest);
    add(PATTERNS.meadow, meadow);
    add(PATTERNS.furrow, furrow);
  };
  try {
    all();
  } catch {
    /* style not ready yet — the handler below fills them in */
  }
  // patterns are requested while the style parses — answer them on demand too
  map.on('styleimagemissing', (e: { id: string }) => {
    if ((Object.values(PATTERNS) as string[]).includes(e.id)) all();
  });
}
