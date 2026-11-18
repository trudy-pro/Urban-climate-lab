/**
 * Geometry of the explanatory street section (SVG viewBox 0 0 1000 440).
 * Stylised and not to scale. The arrangement follows the sponge-city concept for Paulusgasse /
 * Therwilerstrasse (Basel-Stadt): sealed street, planted infiltration depression with a street tree,
 * porous tree substrate, permeable parking paving. It is not a site survey.
 */

export const W = 1000;
export const H = 440;
export const GROUND = 176;

/* surface zones (x ranges) */
export const BUILDING = { x0: 20, x1: 170, roof: 36 };
export const DOWNPIPE_X = 176;
export const SIDEWALK = { x0: 170, x1: 300 };
export const STREET = { x0: 300, x1: 612 };
export const INLET_X = 586;
export const PLANTED = { x0: 612, x1: 800, low: 706 };
export const PAVERS = { x0: 800, x1: 1000 };
export const TREE = { x: 706, base: 196 };
export const SEWER = { x: 470, y: 280, r: 18 };
export const FOUNDATION_BOTTOM = 230;

/** Surface height along the section. The street falls gently toward the curb (conceptual slope). */
export function surfaceY(x: number): number {
  if (x < SIDEWALK.x0) return GROUND;
  if (x < SIDEWALK.x1) return 170;
  if (x < STREET.x1) return 174 + ((x - STREET.x0) / (STREET.x1 - STREET.x0)) * 4;
  if (x < PLANTED.x1) return 178 + 16 * Math.sin((Math.PI * (x - PLANTED.x0)) / (PLANTED.x1 - PLANTED.x0));
  return GROUND;
}

/** Top and bottom of the porous tree substrate (below the planted topsoil and the paver bedding). */
export const SUBSTRATE = { x0: 598, x1: 992 };
export function substrateTop(x: number): number {
  if (x < PLANTED.x0) return 204;
  if (x < PLANTED.x1) return surfaceY(x) + 22;
  return 194;
}
export function substrateBottom(x: number): number {
  return 302 + 7 * Math.sin(x / 31) + 4 * Math.sin(x / 13 + 1);
}

/** Root zone (soft ellipse around the tree base, inside the substrate). */
export const ROOTZONE = { cx: 706, cy: 248, rx: 128, ry: 54 };
export const inRootZone = (x: number, y: number) =>
  ((x - ROOTZONE.cx) / ROOTZONE.rx) ** 2 + ((y - ROOTZONE.cy) / ROOTZONE.ry) ** 2 <= 1;

/* deterministic randomness so the drawing is identical on every render */
function rng(seed: number) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export interface Slot {
  x: number;
  y: number;
  root: boolean;
}
export interface Stone {
  x: number;
  y: number;
  rx: number;
  ry: number;
  rot: number;
  shade: number;
}

/** Pore spaces in the substrate where water can be held for a while. */
export const SLOTS: Slot[] = (() => {
  const r = rng(7);
  const out: Slot[] = [];
  for (let y = 210; y < 300; y += 13) {
    for (let x = SUBSTRATE.x0 + 10; x < SUBSTRATE.x1 - 8; x += 17) {
      const px = x + (r() - 0.5) * 8 + ((y / 13) % 2) * 8;
      const py = y + (r() - 0.5) * 6;
      if (py < substrateTop(px) + 5 || py > substrateBottom(px) - 5) continue;
      out.push({ x: px, y: py, root: inRootZone(px, py) });
    }
  }
  return out;
})();

/** Stones of the structural substrate, drawn around the pores (porous, not solid). */
export const STONES: Stone[] = (() => {
  const r = rng(21);
  const out: Stone[] = [];
  for (let y = 206; y < 306; y += 9) {
    for (let x = SUBSTRATE.x0 + 2; x < SUBSTRATE.x1; x += 10) {
      const px = x + (r() - 0.5) * 7;
      const py = y + (r() - 0.5) * 5;
      if (py < substrateTop(px) + 2 || py > substrateBottom(px) - 2) continue;
      if (SLOTS.some((s) => Math.abs(s.x - px) < 5 && Math.abs(s.y - py) < 4)) continue; // keep pores open
      out.push({ x: px, y: py, rx: 2.4 + r() * 2.6, ry: 1.8 + r() * 1.8, rot: r() * 180, shade: r() });
    }
  }
  return out;
})();

/** Fine grains for topsoil and deeper ground. */
export function grains(seed: number, x0: number, x1: number, top: (x: number) => number, bottom: (x: number) => number, step: number) {
  const r = rng(seed);
  const out: { x: number; y: number; s: number }[] = [];
  for (let x = x0; x < x1; x += step) {
    for (let y = top(x); y < bottom(x); y += step) {
      out.push({ x: x + r() * step, y: y + r() * step, s: r() });
    }
  }
  return out;
}

/** Aggregate of the road foundation: compacted gravel, grey-brown, varied sizes. */
export const AGGREGATE: Stone[] = (() => {
  const r = rng(33);
  const out: Stone[] = [];
  for (let y = 186; y < FOUNDATION_BOTTOM; y += 6) {
    for (let x = SIDEWALK.x0 + 2; x < SUBSTRATE.x0; x += 7) {
      const px = x + (r() - 0.5) * 6;
      const py = y + (r() - 0.5) * 4;
      if (py < surfaceY(px) + 9 || py > FOUNDATION_BOTTOM - 2) continue;
      if (Math.abs(px - INLET_X) < 7) continue; // inlet shaft
      out.push({ x: px, y: py, rx: 1.4 + r() * 2.2, ry: 1.1 + r() * 1.5, rot: r() * 180, shade: r() });
    }
  }
  return out;
})();

/* roots: several large roots that taper and branch into fine rootlets */
export interface RootSeg {
  d: string;
  w: number;
  /** branching level: 0 = main root … 3 = fine rootlet */
  level: number;
  /** pores next to this root (their moisture makes the root light up) */
  slots: number[];
}
export const ROOT_NODES: [number, number][] = [];
export const ROOTS: RootSeg[] = (() => {
  const r = rng(3);
  const segs: RootSeg[] = [];
  const clampX = (x: number) => Math.max(SUBSTRATE.x0 + 6, Math.min(SUBSTRATE.x1 - 6, x));
  const grow = (x: number, y: number, ang: number, len: number, level: number, w: number) => {
    const x2 = clampX(x + Math.cos(ang) * len);
    const y2 = Math.min(y + Math.sin(ang) * len, substrateBottom(x2) - 6);
    const bend = (r() - 0.5) * len * 0.45;
    const cx = (x + x2) / 2 + Math.cos(ang + Math.PI / 2) * bend;
    const cy = (y + y2) / 2 + Math.sin(ang + Math.PI / 2) * bend;
    const mx = (x + 2 * cx + x2) / 4;
    const my = (y + 2 * cy + y2) / 4;
    const near: number[] = [];
    SLOTS.forEach((s, i) => {
      if (Math.min(Math.hypot(s.x - mx, s.y - my), Math.hypot(s.x - x2, s.y - y2)) < 15) near.push(i);
    });
    segs.push({ d: `M${x.toFixed(1)} ${y.toFixed(1)} Q${cx.toFixed(1)} ${cy.toFixed(1)} ${x2.toFixed(1)} ${y2.toFixed(1)}`, w, level, slots: near });
    ROOT_NODES.push([x2, y2]);
    ROOT_NODES.push([mx, my]);
    if (level < 3) {
      grow(x2, y2, ang - 0.36 - r() * 0.3, len * (0.55 + r() * 0.15), level + 1, w * 0.58);
      grow(x2, y2, ang + 0.3 + r() * 0.3, len * (0.5 + r() * 0.15), level + 1, w * 0.55);
      // side rootlets from the middle of larger roots
      if (level < 2) grow(mx, my, ang + (r() > 0.5 ? 1 : -1) * (0.9 + r() * 0.3), len * 0.38, 3, 0.7);
    }
  };
  const mains: [number, number, number][] = [
    [0.06, 70, 4.6],
    [0.22, 62, 5],
    [0.4, 48, 5.4],
    [0.6, 50, 5.2],
    [0.78, 62, 5],
    [0.94, 72, 4.6],
  ];
  for (const [a, l, w] of mains) grow(TREE.x, TREE.base + 4, a * Math.PI, l, 0, w);
  return segs;
})();

/** Short "uncertain" seepage cues in the deeper ground (schematic, no groundwater level implied). */
export const SEEPAGE: [number, number][] = [
  [668, 316],
  [742, 322],
  [846, 314],
  [930, 318],
];

/* ------------------------------------------------------------------ layers (for exploration) */

export type LayerId = 'surface' | 'foundation' | 'planted' | 'substrate' | 'rootzone' | 'deep';

export const LAYERS: { id: LayerId; label: string; text: string }[] = [
  {
    id: 'surface',
    label: 'Street surface',
    text: 'Asphalt and paving are sealed: rain cannot soak in, so it runs toward lower edges and drainage points. The parking strip uses permeable paving with open joints.',
  },
  {
    id: 'foundation',
    label: 'Road foundation',
    text: 'Compacted gravel under the street carries traffic loads. Little water passes through it, and it is not meant to hold water.',
  },
  {
    id: 'planted',
    label: 'Planted infiltration area',
    text: 'A shallow planted depression (Versickerungsmulde) beside the curb collects runoff so that some of it can soak in instead of going straight to the sewer.',
  },
  {
    id: 'substrate',
    label: 'Tree substrate',
    text: 'A porous soil-and-stone mix around the tree, as used in tree trenches (Baumrigolen). Water can be held for a while in its connected pore spaces.',
  },
  {
    id: 'rootzone',
    label: 'Root zone',
    text: 'Roots grow through the substrate and can take up part of the water held there, not all of it.',
  },
  {
    id: 'deep',
    label: 'Deeper ground',
    text: 'Natural ground below the root zone. Where conditions allow, some water may seep further down. How much, and how deep, is uncertain and varies by site; no groundwater level is shown.',
  },
];

/* ------------------------------------------------------------------ guided journey: one raindrop */

export interface JourneyStep {
  text: string;
  layer: LayerId | null;
  /** path the drop follows during this step */
  path: [number, number][];
  ms: number;
}

const HERO_X = 430;
const along = (x0: number, x1: number, n: number, dy = -1.5): [number, number][] =>
  Array.from({ length: n + 1 }, (_, i) => {
    const x = x0 + ((x1 - x0) * i) / n;
    return [x, surfaceY(x) + dy];
  });

/** the pore the followed drop settles in: inside the root zone, below the depression */
export const HERO_SLOT: Slot = SLOTS.filter((s) => s.root).sort(
  (a, b) => Math.hypot(a.x - 712, a.y - 258) - Math.hypot(b.x - 712, b.y - 258),
)[0] ?? { x: 712, y: 258, root: true };

const heroRoot: [number, number] = ROOT_NODES.filter(([x, y]) => y > HERO_SLOT.y - 30 && Math.hypot(x - HERO_SLOT.x, y - HERO_SLOT.y) > 16).sort(
  (a, b) => Math.hypot(a[0] - HERO_SLOT.x, a[1] - HERO_SLOT.y) - Math.hypot(b[0] - HERO_SLOT.x, b[1] - HERO_SLOT.y),
)[0] ?? [HERO_SLOT.x + 26, HERO_SLOT.y - 8];

export const HERO_ROOT = heroRoot;

export const JOURNEY_STEPS: JourneyStep[] = [
  {
    text: 'Rain falls on paved and planted surfaces.',
    layer: null,
    path: [
      [HERO_X - 26, -12],
      [HERO_X, surfaceY(HERO_X) - 1.5],
    ],
    ms: 2600,
  },
  {
    text: 'On sealed surfaces, water runs toward lower areas and drainage points.',
    layer: 'surface',
    path: along(HERO_X, PLANTED.x0 - 2, 24),
    ms: 3600,
  },
  {
    text: 'Some runoff can be directed into planted areas instead of immediately entering the sewer.',
    layer: 'planted',
    path: along(PLANTED.x0 - 2, PLANTED.low - 4, 16, -1),
    ms: 3000,
  },
  {
    text: 'Water moves through connected spaces in the soil.',
    layer: 'substrate',
    path: [
      [PLANTED.low - 4, surfaceY(PLANTED.low - 4)],
      [PLANTED.low - 8, 200],
      [PLANTED.low + 2, 212],
      [PLANTED.low - 3, 226],
      [PLANTED.low + 6, 238],
      [HERO_SLOT.x - 3, HERO_SLOT.y - 9],
      [HERO_SLOT.x, HERO_SLOT.y],
    ],
    ms: 5200,
  },
  {
    text: 'Porous substrate can temporarily retain water within the growing area.',
    layer: 'substrate',
    path: [
      [HERO_SLOT.x, HERO_SLOT.y],
      [HERO_SLOT.x, HERO_SLOT.y],
    ],
    ms: 4200,
  },
  {
    text: 'Tree roots can access some of the water retained in the soil.',
    layer: 'rootzone',
    path: [
      [HERO_SLOT.x, HERO_SLOT.y],
      [(HERO_SLOT.x + heroRoot[0]) / 2, (HERO_SLOT.y + heroRoot[1]) / 2 + 3],
      heroRoot,
    ],
    ms: 3800,
  },
];

export const SECTION_DISCLAIMER =
  'Conceptual visualization of sponge-city water movement. Underground geometry, water pathways and behaviour are simplified and are not site-specific engineering predictions.';
