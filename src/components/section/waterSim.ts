import {
  BUILDING,
  DOWNPIPE_X,
  HERO_SLOT,
  INLET_X,
  JOURNEY_STEPS,
  PAVERS,
  PLANTED,
  ROOTS,
  ROOT_NODES,
  SEWER,
  SIDEWALK,
  SLOTS,
  STREET,
  substrateBottom,
  surfaceY,
} from './geometry';

/**
 * Conceptual water particles for the street section, drawn as SVG circles.
 * Behaviours: runoff on sealed surfaces (fast, sideways) → inlet or planted depression →
 * infiltration (slow, through pores) → temporary retention in pores → a few to roots / deeper ground.
 * It is a visual explanation; the proportions are illustrative, not measured.
 */

type Kind = 'pipe' | 'runoff' | 'inlet' | 'collect' | 'infil' | 'held' | 'uptake' | 'deep' | 'dry';

interface P {
  k: Kind;
  x: number;
  y: number;
  tx: number;
  ty: number;
  age: number;
  hold: number;
  slot: number;
  phase: number;
  speed: number;
  fade: number;
}

const SVGNS = 'http://www.w3.org/2000/svg';
const MAX = 260;
/** Water inputs per second at the surface, by intensity. */
const INFLOW_RATE = [9, 20, 38];

const COLOR: Record<Kind, string> = {
  pipe: '#45dcf0',
  runoff: '#45dcf0',
  inlet: '#7d8aa3',
  collect: '#45dcf0',
  infil: '#4fb6ff',
  held: '#5fb8ff',
  uptake: '#4ef0a2',
  deep: '#3b78c4',
  dry: '#5fb8ff',
};
const RADIUS: Record<Kind, number> = {
  pipe: 2,
  runoff: 2.3,
  inlet: 2,
  collect: 2.3,
  infil: 2.1,
  held: 2.3,
  uptake: 2.1,
  deep: 1.9,
  dry: 2.3,
};

export interface SimHandles {
  particles: SVGGElement;
  slots: SVGCircleElement[];
  moisture: SVGElement | null;
  topsoilWet: SVGElement | null;
  hero: SVGGElement;
  heroTrail: SVGPathElement;
  roots: SVGPathElement[];
}

export interface SimCallbacks {
  onStep: (i: number) => void;
  onEnd: () => void;
}

export class WaterSim {
  private h: SimHandles;
  private cb: SimCallbacks;
  private ps: P[] = [];
  private els: SVGCircleElement[] = [];
  /** some pores already hold a little water (soil is rarely bone dry); rain adds to it */
  private base: number[] = SLOTS.map((_, i) => ((i * 7919) % 10 < 3 ? 0.18 + ((i * 31) % 7) * 0.03 : 0));
  private fill: number[] = this.base.slice();
  private rootWet: number[] = ROOTS.map(() => -1);
  private raf = 0;
  private last = 0;
  private acc = 0;
  private reduced: boolean;

  flowing = false;
  intensity = 1;
  paused = false;

  /* guided journey */
  private step = -1;
  private stepT = 0;
  private trail: [number, number][] = [];
  private manual = false;

  constructor(h: SimHandles, cb: SimCallbacks, reduced: boolean) {
    this.h = h;
    this.cb = cb;
    this.reduced = reduced;
    for (let i = 0; i < MAX; i++) {
      const c = document.createElementNS(SVGNS, 'circle');
      c.setAttribute('r', '0');
      h.particles.appendChild(c);
      this.els.push(c);
    }
    if (reduced) {
      // static picture: moisture held in the pores of the root zone, no motion
      this.fill = SLOTS.map((s, i) => Math.max(this.base[i], s.root ? 0.5 : 0.2));
    }
    this.render();
  }

  start() {
    if (this.raf) return;
    this.last = performance.now();
    const tick = (now: number) => {
      // particles use a small capped step (stable motion); the guided drop follows real time
      const raw = Math.min(0.25, (now - this.last) / 1000);
      this.last = now;
      if (!this.paused) {
        this.update(Math.min(0.05, raw));
        this.updateJourney(raw);
      }
      this.render();
      this.raf = requestAnimationFrame(tick);
    };
    this.raf = requestAnimationFrame(tick);
  }

  stop() {
    cancelAnimationFrame(this.raf);
    this.raf = 0;
  }

  destroy() {
    this.stop();
    this.els.forEach((e) => e.remove());
  }

  /* ---------------------------------------------------------------- journey control */
  playJourney() {
    this.step = 0;
    this.stepT = 0;
    this.trail = [];
    this.paused = false;
    this.manual = this.reduced;
    this.cb.onStep(0);
    if (this.reduced) this.stepT = JOURNEY_STEPS[0].ms; // show each step's end state
    this.render();
  }

  stopJourney() {
    this.step = -1;
    this.trail = [];
    this.render();
  }

  skip() {
    if (this.step < 0) return;
    this.next();
  }

  get journeyActive() {
    return this.step >= 0;
  }

  private next() {
    if (this.step >= JOURNEY_STEPS.length - 1) {
      this.step = -1;
      this.render();
      this.cb.onEnd();
      return;
    }
    // keep the trail of completed steps
    const done = JOURNEY_STEPS[this.step].path;
    this.trail.push(...done);
    this.step++;
    this.stepT = this.reduced ? JOURNEY_STEPS[this.step].ms : 0;
    if (this.step === 4) this.wetAround(HERO_SLOT.x, HERO_SLOT.y, 0.75);
    this.cb.onStep(this.step);
    this.render();
  }

  private wetAround(x: number, y: number, v: number) {
    SLOTS.forEach((s, i) => {
      const d = Math.hypot(s.x - x, s.y - y);
      if (d < 40) this.fill[i] = Math.max(this.fill[i], v * (1 - d / 48));
    });
  }

  /* ---------------------------------------------------------------- simulation */
  private spawn(p: Omit<P, 'age' | 'hold' | 'slot' | 'phase' | 'fade'> & Partial<P>) {
    if (this.ps.length >= MAX) return;
    this.ps.push({ age: 0, hold: 0, slot: -1, phase: Math.random() * 6.28, fade: 1, ...p });
  }

  private pickSlot(x: number): number {
    // a free pore below, near where the water enters
    let best = -1;
    let bestD = Infinity;
    for (let i = 0; i < SLOTS.length; i++) {
      const s = SLOTS[i];
      if (this.fill[i] > 0.92) continue;
      const d = Math.abs(s.x - x) + Math.random() * 40 + (s.y - 200) * 0.25;
      if (d < bestD && Math.abs(s.x - x) < 90) {
        bestD = d;
        best = i;
      }
    }
    return best;
  }

  private feedSurface(x: number) {
    const r = Math.random();
    if (x > BUILDING.x0 && x < BUILDING.x1) {
      if (r < 0.22) this.spawn({ k: 'pipe', x: DOWNPIPE_X, y: BUILDING.roof + 6, tx: DOWNPIPE_X, ty: 166, speed: 140 });
      return;
    }
    if (x >= SIDEWALK.x0 && x < STREET.x1) {
      if (r < 0.42) this.spawn({ k: 'runoff', x, y: surfaceY(x) - 1.5, tx: 0, ty: 0, speed: 95 + Math.random() * 30 });
      return;
    }
    if (x >= PLANTED.x0 && x < PLANTED.x1) {
      const slot = this.pickSlot(x);
      if (slot >= 0) this.spawn({ k: 'infil', x, y: surfaceY(x), tx: SLOTS[slot].x, ty: SLOTS[slot].y, slot, speed: 20 + Math.random() * 10 });
      return;
    }
    if (x >= PAVERS.x0 && r < 0.4) {
      const slot = this.pickSlot(x);
      if (slot >= 0) this.spawn({ k: 'infil', x, y: surfaceY(x), tx: SLOTS[slot].x, ty: SLOTS[slot].y, slot, speed: 14 + Math.random() * 8 });
    }
  }

  private update(dt: number) {
    if (this.reduced) return;

    if (this.flowing) {
      this.acc += INFLOW_RATE[this.intensity] * dt;
      while (this.acc >= 1) {
        this.acc -= 1;
        this.feedSurface(Math.random() * 1000);
      }
    }

    const keep: P[] = [];
    for (const p of this.ps) {
      p.age += dt;
      let alive = true;
      switch (p.k) {
        case 'pipe':
          p.y += p.speed * dt;
          if (p.y >= p.ty) {
            p.k = 'runoff';
            p.x = DOWNPIPE_X + 4;
            p.speed = 100;
          }
          break;
        case 'runoff': {
          // sideways along the conceptual slope toward the curb
          p.x += p.speed * dt;
          p.y = surfaceY(p.x) - 1.5;
          if (p.x >= INLET_X && p.slot === -1) {
            p.slot = -2; // decided
            if (Math.random() < 0.3) {
              p.k = 'inlet';
              p.tx = SEWER.x + SEWER.r * 0.6;
              p.ty = SEWER.y - SEWER.r * 0.4;
              p.speed = 60;
            }
          }
          if (p.k === 'runoff' && p.x >= PLANTED.x0) {
            p.k = 'collect';
            p.tx = PLANTED.x0 + 30 + Math.random() * 140;
            p.speed = 55 + Math.random() * 15;
          }
          break;
        }
        case 'inlet': {
          // down through the inlet shaft, then into the existing sewer
          if (p.y < 236) {
            p.y += p.speed * dt;
            p.x = INLET_X;
          } else {
            const dx = p.tx - p.x;
            const dy = p.ty - p.y;
            const d = Math.hypot(dx, dy);
            if (d < 3) alive = false;
            else {
              p.x += (dx / d) * p.speed * dt;
              p.y += (dy / d) * p.speed * dt;
            }
          }
          break;
        }
        case 'collect':
          p.x += p.speed * dt;
          p.y = surfaceY(p.x) - 1;
          if (p.x >= p.tx) {
            const slot = this.pickSlot(p.x);
            if (slot < 0) {
              p.k = 'dry';
              p.fade = 1;
            } else {
              p.k = 'infil';
              p.slot = slot;
              p.tx = SLOTS[slot].x;
              p.ty = SLOTS[slot].y;
              p.speed = 18 + Math.random() * 10;
            }
          }
          break;
        case 'infil': {
          // slow, weaving descent through connected pore spaces
          p.y += p.speed * dt;
          p.x += (p.tx - p.x) * Math.min(1, dt * 0.9) + Math.sin(p.age * 3 + p.phase) * 6 * dt;
          if (p.y >= p.ty) {
            p.y = p.ty;
            p.x = p.tx;
            p.k = 'held';
            p.hold = 2.5 + Math.random() * 4;
            this.fill[p.slot] = Math.min(1, this.fill[p.slot] + 0.3);
          }
          break;
        }
        case 'held': {
          p.hold -= dt;
          if (p.hold <= 0) {
            const s = SLOTS[p.slot];
            const r = Math.random();
            const node = s.root ? this.nearestRoot(s.x, s.y) : null;
            if (node && r < 0.2) {
              p.k = 'uptake';
              p.tx = node[0];
              p.ty = node[1];
              p.speed = 16;
            } else if (r < 0.28 && s.y > 250) {
              p.k = 'deep';
              p.fade = 1;
              p.speed = 9 + Math.random() * 5;
            } else {
              p.k = 'dry';
              p.fade = 1;
            }
          }
          break;
        }
        case 'uptake': {
          const dx = p.tx - p.x;
          const dy = p.ty - p.y;
          const d = Math.hypot(dx, dy);
          p.x += (dx / Math.max(d, 1)) * p.speed * dt;
          p.y += (dy / Math.max(d, 1)) * p.speed * dt;
          p.fade = Math.min(1, d / 14);
          if (d < 1.5) alive = false;
          break;
        }
        case 'deep':
          p.y += p.speed * dt;
          if (p.y > substrateBottom(p.x)) p.fade -= dt * 0.35;
          if (p.fade <= 0) alive = false;
          break;
        case 'dry':
          p.fade -= dt * 0.5;
          if (p.fade <= 0) alive = false;
          break;
      }
      if (alive) keep.push(p);
    }
    this.ps = keep;

    // Retained moisture fades faster after inflow stops.
    const decay = this.flowing ? 0.006 : 0.02;
    for (let i = 0; i < this.fill.length; i++) this.fill[i] = Math.max(this.base[i], this.fill[i] - decay * dt);

  }

  private updateJourney(dt: number) {
    if (this.step >= 0 && !this.manual) {
      this.stepT += dt * 1000;
      if (this.step === 4) this.wetAround(HERO_SLOT.x, HERO_SLOT.y, Math.min(0.8, this.stepT / JOURNEY_STEPS[4].ms));
      if (this.stepT >= JOURNEY_STEPS[this.step].ms + 500) this.next();
    }
  }

  private nearestRoot(x: number, y: number): [number, number] | null {
    let best: [number, number] | null = null;
    let bd = 60;
    for (const n of ROOT_NODES) {
      const d = Math.hypot(n[0] - x, n[1] - y);
      if (d < bd && d > 6) {
        bd = d;
        best = n;
      }
    }
    return best;
  }

  /* ---------------------------------------------------------------- drawing */
  private render() {
    const journey = this.step >= 0;
    const dim = journey ? 0.35 : 1;
    for (let i = 0; i < this.els.length; i++) {
      const el = this.els[i];
      const p = this.ps[i];
      if (!p) {
        if (el.getAttribute('r') !== '0') el.setAttribute('r', '0');
        continue;
      }
      el.setAttribute('cx', p.x.toFixed(1));
      el.setAttribute('cy', p.y.toFixed(1));
      el.setAttribute('r', String(RADIUS[p.k]));
      if (p.k === 'deep') {
        // deeper movement is schematic and uncertain: hollow drops that fade
        el.setAttribute('fill', 'none');
        el.setAttribute('stroke', '#7fa9dc');
        el.setAttribute('stroke-width', '1');
      } else {
        el.setAttribute('fill', COLOR[p.k]);
        el.setAttribute('stroke', 'none');
      }
      const base = p.k === 'held' ? 0.8 : p.k === 'deep' ? 0.6 : 0.9;
      el.setAttribute('opacity', (base * p.fade * dim).toFixed(2));
    }

    // moisture in pores
    let sum = 0;
    let rootSum = 0;
    let rootN = 0;
    for (let i = 0; i < this.h.slots.length; i++) {
      const f = this.fill[i];
      sum += f;
      if (SLOTS[i].root) {
        rootSum += f;
        rootN++;
      }
      this.h.slots[i].setAttribute('opacity', (0.12 + f * 0.8).toFixed(2));
      this.h.slots[i].setAttribute('r', (1.2 + f * 1.8).toFixed(2));
    }
    // roots light up softly where the pores next to them hold water
    for (let i = 0; i < this.h.roots.length; i++) {
      const seg = ROOTS[i];
      let w = 0;
      for (const k of seg.slots) w = Math.max(w, this.fill[k]);
      const t = Math.max(0, Math.min(1, (w - 0.3) / 0.6));
      if (Math.abs(t - this.rootWet[i]) < 0.03) continue;
      this.rootWet[i] = t;
      const mix = (a: number, b: number) => Math.round(a + (b - a) * t);
      this.h.roots[i].style.stroke = `rgb(${mix(154, 150)},${mix(118, 222)},${mix(86, 160)})`;
      this.h.roots[i].style.filter = t > 0.4 ? `drop-shadow(0 0 ${(t * 3).toFixed(1)}px rgba(78,240,162,${(t * 0.5).toFixed(2)}))` : '';
    }
    this.h.moisture?.setAttribute('opacity', Math.min(0.75, (rootSum / Math.max(1, rootN)) * 1.4).toFixed(2));
    this.h.topsoilWet?.setAttribute('opacity', Math.min(0.6, (sum / this.fill.length) * 2.2 + (this.flowing ? 0.12 : 0)).toFixed(2));

    // guided drop
    const hero = this.h.hero;
    if (!journey) {
      hero.setAttribute('opacity', '0');
      this.h.heroTrail.setAttribute('d', '');
      return;
    }
    const st = JOURNEY_STEPS[this.step];
    const t = Math.min(1, this.stepT / st.ms);
    const e = t < 0.5 ? 2 * t * t : 1 - Math.pow(-2 * t + 2, 2) / 2;
    const pos = pointAlong(st.path, this.step === 0 ? t * t : e);
    const fadeOut = this.step === JOURNEY_STEPS.length - 1 ? Math.max(0, 1 - Math.max(0, t - 0.75) * 4) : 1;
    hero.setAttribute('opacity', fadeOut.toFixed(2));
    hero.setAttribute('transform', `translate(${pos[0].toFixed(1)} ${pos[1].toFixed(1)})`);
    const travelled = [...this.trail, ...partial(st.path, this.step === 0 ? t * t : e), pos];
    this.h.heroTrail.setAttribute('d', travelled.length > 1 ? 'M' + travelled.map((q) => `${q[0].toFixed(1)} ${q[1].toFixed(1)}`).join(' L') : '');
  }
}

function lengths(path: [number, number][]) {
  const cum = [0];
  for (let i = 1; i < path.length; i++) cum.push(cum[i - 1] + Math.hypot(path[i][0] - path[i - 1][0], path[i][1] - path[i - 1][1]));
  return cum;
}
function pointAlong(path: [number, number][], t: number): [number, number] {
  const cum = lengths(path);
  const total = cum[cum.length - 1];
  if (total === 0) return path[0];
  const d = t * total;
  let i = 1;
  while (i < cum.length - 1 && cum[i] < d) i++;
  const seg = cum[i] - cum[i - 1] || 1;
  const u = (d - cum[i - 1]) / seg;
  return [path[i - 1][0] + (path[i][0] - path[i - 1][0]) * u, path[i - 1][1] + (path[i][1] - path[i - 1][1]) * u];
}
function partial(path: [number, number][], t: number): [number, number][] {
  const cum = lengths(path);
  const d = t * cum[cum.length - 1];
  return path.filter((_, i) => cum[i] <= d);
}
