import { useLayoutEffect, useMemo, useRef } from 'react';
import { useFrame, useThree } from '@react-three/fiber';
import {
  BufferAttribute, BufferGeometry, CanvasTexture, Color, DoubleSide, DynamicDrawUsage, MeshStandardMaterial,
  NearestFilter, Points, RepeatWrapping, SRGBColorSpace,
} from 'three';
import {
  FOUNDATION_BOTTOM, INLET_X, PAVERS, PLANTED, ROOTZONE, SEWER, SIDEWALK, STREET, SUBSTRATE,
  substrateBottom, substrateTop, surfaceY,
} from '../section/geometry';
import { LENGTH, WIDTH, type ModelState, type SlabKey } from './data';

/**
 * The street block: the layers of the sponge-city street section (components/section/geometry.ts),
 * extruded along the street. Stylised, not a survey; depths are exaggerated.
 *
 * Scene units: x across the street, y up (0 = street level), z along the street.
 */

const GROUND_Y = 176;
const DEEP_BOTTOM = 380;
const X0 = SIDEWALK.x0;
const X1 = PAVERS.x1;
const MID_X = (X0 + X1) / 2;
const SX = WIDTH / (X1 - X0);
export const BLOCK_DEPTH = 6.42;
const SY = BLOCK_DEPTH / (DEEP_BOTTOM - GROUND_Y);
const Z0 = -LENGTH / 2;
const Z1 = LENGTH / 2;
/** street trees along the planted strip (z) */
const TREE_Z = [Z1 - 2.6, 0.4, Z0 + 2.8];

export const sx = (x: number) => (x - MID_X) * SX;
export const sy = (y: number) => -(y - GROUND_Y) * SY;

const deepTop = (x: number) => (x < SUBSTRATE.x0 ? FOUNDATION_BOTTOM : x > SUBSTRATE.x1 ? 196 : substrateBottom(x));
const foundationBottom = (x: number) => (x < SUBSTRATE.x0 ? FOUNDATION_BOTTOM : substrateTop(x));
const rootHalf = (x: number) => Math.sqrt(Math.max(0, 1 - ((x - ROOTZONE.cx) / ROOTZONE.rx) ** 2));

/** vertical extent of each layer in scene units: [top, bottom] (used for growing, labels and outlines) */
export const BLOCK_BAND: Record<SlabKey, [number, number]> = {
  surface: [0, sy(surfaceY(PLANTED.low) + 22)],
  foundation: [sy(181), sy(FOUNDATION_BOTTOM)],
  substrate: [sy(194), sy(312)],
  roots: [sy(ROOTZONE.cy - ROOTZONE.ry), sy(ROOTZONE.cy + ROOTZONE.ry)],
  deep: [sy(FOUNDATION_BOTTOM), sy(DEEP_BOTTOM)],
};

/** where each layer's label sits (scene y), spread so the labels never overlap */
export const LABEL_Y: Record<SlabKey, number> = {
  surface: sy(178),
  foundation: sy(206),
  substrate: sy(232),
  roots: sy(282),
  deep: sy(345),
};

/* ------------------------------------------------------------------ geometry */
type V3 = [number, number, number];

class Builder {
  pos: number[] = [];
  nor: number[] = [];
  uv: number[] = [];
  private tri(a: V3, b: V3, c: V3) {
    const e1 = [b[0] - a[0], b[1] - a[1], b[2] - a[2]];
    const e2 = [c[0] - a[0], c[1] - a[1], c[2] - a[2]];
    const n = [e1[1] * e2[2] - e1[2] * e2[1], e1[2] * e2[0] - e1[0] * e2[2], e1[0] * e2[1] - e1[1] * e2[0]];
    const l = Math.hypot(n[0], n[1], n[2]) || 1;
    const [nx, ny, nz] = [n[0] / l, n[1] / l, n[2] / l];
    // project texture coordinates onto the face's main plane, ~1 grain tile per scene unit
    const ax = Math.abs(nx), ay = Math.abs(ny), az = Math.abs(nz);
    for (const p of [a, b, c]) {
      this.pos.push(p[0], p[1], p[2]);
      this.nor.push(nx, ny, nz);
      if (ay >= ax && ay >= az) this.uv.push(p[0] * 0.9, p[2] * 0.9);
      else if (az >= ax) this.uv.push(p[0] * 0.9, p[1] * 0.9);
      else this.uv.push(p[2] * 0.9, p[1] * 0.9);
    }
  }
  quad(a: V3, b: V3, c: V3, d: V3) {
    this.tri(a, b, c);
    this.tri(a, c, d);
  }
  /** a section band between top(x) and bot(x), extruded from z0 to z1 */
  prism(x0: number, x1: number, top: (x: number) => number, bot: (x: number) => number, z0: number, z1: number) {
    const P = (x: number, y: number, z: number): V3 => [sx(x), sy(y), z];
    const xs: number[] = [];
    for (let x = x0; x < x1; x += 8) xs.push(x);
    xs.push(x1);
    for (let i = 0; i < xs.length - 1; i++) {
      const a = xs[i], b = xs[i + 1];
      const [ta, tb, ba, bb] = [top(a), top(b), bot(a), bot(b)];
      if (ba - ta < 0.2 && bb - tb < 0.2) continue;
      this.quad(P(a, ta, z0), P(a, ta, z1), P(b, tb, z1), P(b, tb, z0)); // top
      this.quad(P(a, ba, z0), P(b, bb, z0), P(b, bb, z1), P(a, ba, z1)); // bottom
      this.quad(P(a, ta, z1), P(a, ba, z1), P(b, bb, z1), P(b, tb, z1)); // cut face (front)
      this.quad(P(a, ta, z0), P(b, tb, z0), P(b, bb, z0), P(a, ba, z0)); // cut face (back)
    }
    this.quad(P(x0, top(x0), z0), P(x0, bot(x0), z0), P(x0, bot(x0), z1), P(x0, top(x0), z1));
    this.quad(P(x1, top(x1), z0), P(x1, top(x1), z1), P(x1, bot(x1), z1), P(x1, bot(x1), z0));
  }
  box(x: number, halfX: number, z: number, halfZ: number, y0: number, y1: number) {
    this.prism(x - halfX, x + halfX, () => y0, () => y1, z - halfZ, z + halfZ);
  }
  /** a pipe along the street (section centre cx, cy; radius r in section units) */
  pipe(cx: number, cy: number, r: number, z0: number, z1: number) {
    const n = 20;
    for (let i = 0; i < n; i++) {
      const a0 = (i / n) * Math.PI * 2, a1 = ((i + 1) / n) * Math.PI * 2;
      const p = (a: number, z: number): V3 => [sx(cx + Math.cos(a) * r), sy(cy + Math.sin(a) * r), z];
      this.quad(p(a0, z0), p(a1, z0), p(a1, z1), p(a0, z1));
    }
  }
  geometry() {
    const g = new BufferGeometry();
    g.setAttribute('position', new BufferAttribute(new Float32Array(this.pos), 3));
    g.setAttribute('normal', new BufferAttribute(new Float32Array(this.nor), 3));
    g.setAttribute('uv', new BufferAttribute(new Float32Array(this.uv), 2));
    g.computeBoundingSphere();
    return g;
  }
}

function build(fn: (b: Builder) => void) {
  const b = new Builder();
  fn(b);
  return b.geometry();
}

/* ------------------------------------------------------------------ materials: muted colours with a stony grain */
function grainTexture(seed: number, coarse: number) {
  const size = 64;
  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = size;
  const ctx = canvas.getContext('2d')!;
  let s = seed;
  const rnd = () => ((s = (Math.imul(s, 1664525) + 1013904223) >>> 0) / 4294967296);
  const cell = Math.max(1, Math.round(2 + coarse * 3));
  for (let y = 0; y < size; y += cell) {
    for (let x = 0; x < size; x += cell) {
      const v = 1 - coarse * 0.45 * rnd() + (rnd() < 0.05 * coarse ? 0.35 : 0);
      const c = Math.max(0, Math.min(255, Math.round(238 * v)));
      ctx.fillStyle = `rgb(${c},${c},${c})`;
      ctx.fillRect(x, y, cell, cell);
    }
  }
  const t = new CanvasTexture(canvas);
  t.wrapS = t.wrapT = RepeatWrapping;
  t.magFilter = NearestFilter;
  t.colorSpace = SRGBColorSpace;
  return t;
}

function material(color: string, grain: number, seed: number) {
  return new MeshStandardMaterial({ color: new Color(color), map: grainTexture(seed, grain), roughness: 0.96, metalness: 0, flatShading: true, side: DoubleSide });
}

interface Part {
  geometry: BufferGeometry;
  material: MeshStandardMaterial;
}

function useLayerParts(layer: SlabKey): Part[] {
  const parts = useMemo<Part[]>(() => {
    switch (layer) {
      case 'surface':
        return [
          { geometry: build((b) => b.prism(SIDEWALK.x0, STREET.x1, surfaceY, (x) => surfaceY(x) + 5, Z0, Z1)), material: material('#68717f', 0.35, 11) },
          { geometry: build((b) => b.prism(PAVERS.x0, PAVERS.x1, () => GROUND_Y, () => 194, Z0, Z1)), material: material('#868891', 0.7, 12) },
          { geometry: build((b) => b.prism(PLANTED.x0, PLANTED.x1, surfaceY, (x) => surfaceY(x) + 22, Z0, Z1)), material: material('#5a8049', 0.55, 13) },
          {
            // short trunk stubs, so the roots below belong to something
            geometry: build((b) => { for (const z of TREE_Z) b.box(PLANTED.low, 7, z, 0.24, surfaceY(PLANTED.low) - 42, surfaceY(PLANTED.low)); }),
            material: material('#6b4c33', 0.3, 14),
          },
        ];
      case 'foundation':
        return [
          { geometry: build((b) => b.prism(SIDEWALK.x0, PLANTED.x0, (x) => surfaceY(x) + 5, foundationBottom, Z0, Z1)), material: material('#8f887c', 0.95, 21) },
        ];
      case 'substrate':
        return [
          { geometry: build((b) => b.prism(SUBSTRATE.x0, SUBSTRATE.x1, substrateTop, substrateBottom, Z0, Z1)), material: material('#a5845f', 1, 31) },
        ];
      case 'roots':
        return [
          {
            geometry: build((b) => {
              TREE_Z.forEach((z, i) => {
                // the front tree's root zone reaches the cut face, so it shows without pulling the block apart
                const z1 = i === 0 ? Z1 + 0.03 : z + 2.2;
                b.prism(
                  ROOTZONE.cx - ROOTZONE.rx,
                  ROOTZONE.cx + ROOTZONE.rx,
                  (x) => Math.max(ROOTZONE.cy - ROOTZONE.ry * rootHalf(x), substrateTop(x) + 1),
                  (x) => Math.min(ROOTZONE.cy + ROOTZONE.ry * rootHalf(x), substrateBottom(x) - 1),
                  z - 2.2,
                  z1,
                );
              });
            }),
            material: material('#d09a66', 0.6, 41),
          },
        ];
      case 'deep':
        return [
          { geometry: build((b) => b.prism(X0, X1, deepTop, () => DEEP_BOTTOM, Z0, Z1)), material: material('#54443a', 0.5, 51) },
          { geometry: build((b) => b.pipe(SEWER.x, SEWER.y, SEWER.r, Z0 - 0.04, Z1)), material: material('#8e98a6', 0.2, 52) },
          { geometry: build((b) => b.box(INLET_X, 5, Z1 - 1.4, 0.18, 178, 236)), material: material('#5d6672', 0.2, 53) },
        ];
    }
  }, [layer]);
  useLayoutEffect(() => () => parts.forEach((p) => { p.geometry.dispose(); p.material.map?.dispose(); p.material.dispose(); }), [parts]);
  return parts;
}

export function BlockBody({ layer }: { layer: SlabKey }) {
  const parts = useLayerParts(layer);
  return (
    <>
      {parts.map((p, i) => (
        <mesh key={i} geometry={p.geometry} material={p.material} castShadow receiveShadow />
      ))}
    </>
  );
}

/* ------------------------------------------------------------------ water: drops through the block (conceptual) */
interface Drop {
  x: number;
  y: number;
  z: number;
  run: boolean;
  stopY: number;
}

function layerAt(x: number, y: number): SlabKey {
  if (x >= PLANTED.x0 && x <= PLANTED.x1 && y < surfaceY(x) + 22) return 'surface';
  if (x >= SUBSTRATE.x0 && x <= SUBSTRATE.x1 && y >= substrateTop(x) && y <= substrateBottom(x)) return 'substrate';
  if (x >= PAVERS.x0 && y < 194) return 'surface';
  if (y < GROUND_Y + 6) return 'surface';
  if (x < SUBSTRATE.x0 && y < FOUNDATION_BOTTOM) return 'foundation';
  return 'deep';
}

/** most water is held in the substrate; a little seeps deeper */
function stopFor(x: number) {
  const deep = Math.random() < 0.18;
  const bottom = substrateBottom(x);
  return deep ? bottom + 15 + Math.random() * 45 : substrateTop(x) + Math.random() * (bottom - substrateTop(x));
}

function spawn(): Drop {
  const r = Math.random();
  const z = Z0 + 0.2 + Math.random() * (LENGTH - 0.4);
  if (r < 0.3) {
    // rain on the sealed street runs off toward the curb, then into the planted strip
    return { x: STREET.x0 + Math.random() * (STREET.x1 - STREET.x0), y: 0, z, run: true, stopY: stopFor(PLANTED.low) };
  }
  const x = r < 0.75 ? PLANTED.x0 + 8 + Math.random() * (PLANTED.x1 - PLANTED.x0 - 16) : PAVERS.x0 + 6 + Math.random() * (SUBSTRATE.x1 - PAVERS.x0 - 12);
  return { x, y: surfaceY(x) - 2, z, run: false, stopY: stopFor(x) };
}

const COUNT = 260;

export function BlockWater({ model, raining, active, reduced }: { model: ModelState; raining: boolean; active: boolean; reduced: boolean }) {
  const ref = useRef<Points>(null);
  const { invalidate } = useThree();
  const drops = useMemo(() => Array.from({ length: COUNT }, () => {
    const d = spawn();
    // start part-way, so the block is not empty when the rain begins
    if (!d.run) d.y += Math.random() * (d.stopY - d.y);
    return d;
  }), []);
  const positions = useMemo(() => new Float32Array(COUNT * 3), []);
  const on = raining || active;

  useFrame((_, delta) => {
    const pts = ref.current!;
    pts.visible = on;
    if (!on) return;
    const dt = reduced ? 0 : Math.min(delta, 0.05);
    drops.forEach((d, i) => {
      if (d.run) {
        d.x += 95 * dt;
        d.y = surfaceY(d.x) - 1;
        if (d.x >= PLANTED.x0 + 6) d.run = false;
      } else {
        const layer = layerAt(d.x, d.y);
        const speed = layer === 'surface' ? 34 : layer === 'substrate' ? 16 : 6;
        d.y += speed * dt;
        d.x += Math.sin(d.y * 0.21 + d.z) * 6 * dt;
        if (d.y > d.stopY) drops[i] = spawn();
      }
      const q = drops[i];
      positions[i * 3] = sx(q.x);
      positions[i * 3 + 1] = sy(q.y) + 0.06 + model.offset[layerAt(q.x, q.y)];
      positions[i * 3 + 2] = q.z;
    });
    (pts.geometry.getAttribute('position') as BufferAttribute).needsUpdate = true;
    if (!reduced) invalidate();
  });

  return (
    <points ref={ref} frustumCulled={false} raycast={() => null} renderOrder={5}>
      <bufferGeometry>
        <bufferAttribute attach="attributes-position" args={[positions, 3]} usage={DynamicDrawUsage} />
      </bufferGeometry>
      <pointsMaterial color={active ? '#9fe4ff' : '#7cc8ff'} size={active ? 6 : 4.5} sizeAttenuation={false} transparent opacity={0.95} depthWrite={false} depthTest={false} />
    </points>
  );
}
