import { useEffect, useLayoutEffect, useMemo, useRef } from 'react';
import { useFrame, useThree } from '@react-three/fiber';
import {
  BufferAttribute, Color, DynamicDrawUsage, Group, InstancedMesh, LineSegments, MathUtils,
  MeshBasicMaterial, Object3D,
} from 'three';
import { BUILDINGS, INLETS_Z, PLANT_TOP, SEWER, seededRandom, type ModelState, type SlabKey } from './data';

type Node = [x: number, y: number, z: number, slab: SlabKey];
type Flow = { color: string; nodes: Node[]; open: boolean };

const FLOWS: Flow[] = [
  ...INLETS_Z.flatMap((z): Flow[] => [
    { color: '#3494d3', open: true, nodes: [[-5.22, 0.065, z - 0.78, 'surface'], [-2.9, 0.062, z - 0.32, 'surface'], [-0.86, 0.066, z, 'surface'], [0.73, 0.115, z, 'surface']] },
    { color: '#287fbd', open: false, nodes: [[0.73, 0.115, z, 'surface'], [0.73, -0.66, z, 'foundation'], [-0.18, -0.99, z, 'foundation'], [SEWER.x, SEWER.y, z, 'foundation']] },
  ]),
  { color: '#287fbd', open: false, nodes: [[SEWER.x, SEWER.y, -7.96, 'foundation'], [SEWER.x, SEWER.y, 8.02, 'foundation']] },
  ...[-3.33, 2.1, 6.45].flatMap((z): Flow[] => [
    { color: '#38a6dd', open: true, nodes: [[-3.63, 0.063, z - 0.78, 'surface'], [-0.72, 0.067, z - 0.21, 'surface'], [0.69, 0.067, z, 'surface'], [1.48, 0.133, z, 'surface'], [2.08, PLANT_TOP + 0.12, z, 'surface']] },
    { color: '#3f9fd5', open: false, nodes: [[2.08, 0.09, z, 'surface'], [2.14, -0.65, z, 'foundation'], [2.25, -1.53, z, 'foundation'], [2.59, -2.01, z + 0.19, 'substrate'], [3.26, -2.65, z + 0.37, 'substrate'], [3.36, -3.48, z + 0.46, 'roots']] },
    { color: '#46a7db', open: false, nodes: [[5.9, 0.08, z - 0.78, 'surface'], [5.88, -1.13, z - 0.63, 'foundation'], [5.64, -1.84, z - 0.48, 'substrate'], [4.93, -2.56, z - 0.39, 'substrate'], [3.82, -2.77, z - 0.15, 'substrate']] },
  ]),
];

const RAIN_COUNT = 188;
const RAIN_COLOR = '#559bd0';
const RAIN_HEIGHT = 12.7;
const STORAGE = [
  [3.29, -2.72, 6.84, 1.04, 0.25, 0.46], [3.98, -2.8, 6.26, 0.83, 0.16, 0.52],
  [4.49, -2.71, 2.07, 0.86, 0.23, 0.48], [2.83, -2.72, 2.58, 1.12, 0.27, 0.66],
  [3.28, -2.73, -2.96, 1.31, 0.27, 0.62], [5.24, -2.47, -3.49, 0.55, 0.14, 0.35],
] as const;

function Pathways({ flows, model, raining, reduced }: {
  flows: Flow[]; model: ModelState; raining: boolean; reduced: boolean;
}) {
  const traces = useRef<LineSegments>(null);
  const particles = useRef<InstancedMesh>(null);
  const time = useRef(0);
  const { segments, positions, vertexColors, particleObject, pathLengths, particleCount } = useMemo(() => {
    const segments = flows.flatMap(({ nodes, color }) =>
      nodes.slice(1).map((end, i) => ({ start: nodes[i], end, color })));
    const pointCount = segments.length * 2;
    const colors = new Float32Array(pointCount * 3);
    segments.forEach(({ color }, i) => {
      const c = new Color(color);
      c.toArray(colors, i * 6);
      c.toArray(colors, i * 6 + 3);
    });
    const particleCount = flows.reduce((sum, { nodes }) => sum + (nodes.length - 1) * 2, 0);
    return { segments, positions: new Float32Array(pointCount * 3), vertexColors: colors, particleObject: new Object3D(), pathLengths: new Float32Array(8), particleCount };
  }, [flows]);

  useLayoutEffect(() => {
    const dots = particles.current!;
    let index = 0;
    for (const { nodes, color } of flows) {
      particleColor.set(color).lerp(highlight, 0.29);
      for (let i = 0; i < (nodes.length - 1) * 2; i++) dots.setColorAt(index++, particleColor);
    }
    dots.instanceColor!.needsUpdate = true;
  }, [flows]);

  useFrame((_, dt) => {
    time.current += Math.min(dt, 0.05);
    const trace = traces.current!;
    const dots = particles.current!;
    const position = trace.geometry.getAttribute('position') as BufferAttribute;
    const { offset } = model;
    const gap = (node: Node) => node[1] + offset[node[3]];
    segments.forEach(({ start, end }, i) => {
      position.setXYZ(i * 2, start[0], gap(start), start[2]);
      position.setXYZ(i * 2 + 1, end[0], gap(end), end[2]);
    });
    position.needsUpdate = true;
    if (!raining || reduced) return;
    let index = 0;
    for (const { nodes } of flows) {
      pathLengths[0] = 0;
      for (let k = 1; k < nodes.length; k++) {
        const a = nodes[k - 1], b = nodes[k];
        pathLengths[k] = pathLengths[k - 1] + Math.hypot(b[0] - a[0], gap(b) - gap(a), b[2] - a[2]);
      }
      const count = (nodes.length - 1) * 2;
      const distance = pathLengths[nodes.length - 1];
      for (let i = 0; i < count; i++) {
        const at = ((time.current * (nodes.length === 2 ? 2.9 : 1.9) / distance + i / count) % 1) * distance;
        let end = 1;
        while (pathLengths[end] < at) end++;
        const a = nodes[end - 1], b = nodes[end];
        const t = (at - pathLengths[end - 1]) / (pathLengths[end] - pathLengths[end - 1]);
        particleObject.position.set(MathUtils.lerp(a[0], b[0], t), MathUtils.lerp(gap(a), gap(b), t), MathUtils.lerp(a[2], b[2], t));
        particleObject.scale.setScalar(0.8 + (i % 3) * 0.17);
        particleObject.updateMatrix();
        dots.setMatrixAt(index, particleObject.matrix);
        index++;
      }
    }
    dots.instanceMatrix.needsUpdate = true;
  });
  const surface = flows[0].open;

  return (
    <>
      <lineSegments ref={traces} frustumCulled={false} renderOrder={surface ? 5 : 8}>
        <bufferGeometry>
          <bufferAttribute attach="attributes-position" args={[positions, 3]} usage={DynamicDrawUsage} />
          <bufferAttribute attach="attributes-color" args={[vertexColors, 3]} />
        </bufferGeometry>
        <lineBasicMaterial vertexColors transparent opacity={raining ? 0.6 : 0.74} depthTest={surface} depthWrite={false} />
      </lineSegments>
      <instancedMesh ref={particles} args={[undefined, undefined, particleCount]} visible={raining && !reduced} frustumCulled={false} renderOrder={9}>
        <sphereGeometry args={[surface ? 0.082 : 0.096, 7, 5]} />
        <meshBasicMaterial depthTest={surface} depthWrite={false} toneMapped={false} />
      </instancedMesh>
    </>
  );
}

const particleColor = new Color();
const highlight = new Color('#b6e3f6');
const SURFACE_FLOWS = FLOWS.filter(({ open }) => open);
const BELOW_FLOWS = FLOWS.filter(({ open }) => !open);

function Rain({ model }: { model: ModelState }) {
  const streaks = useRef<LineSegments>(null);
  const positions = useMemo(() => new Float32Array(RAIN_COUNT * 6), []);
  const drops = useMemo(() => {
    const random = seededRandom(18);
    return Array.from({ length: RAIN_COUNT }, () => {
      const x = (random() - 0.5) * 24;
      const z = (random() - 0.5) * 16;
      const roof = BUILDINGS.find((b) => Math.abs(b.x - x) < (b.w + 0.18) / 2 && Math.abs(b.z - z) < (b.d + 0.19) / 2);
      const land = roof ? roof.h + 1.34 * (1 - Math.abs(roof.x - x) / ((roof.w + 0.18) / 2)) : 0.1;
      return { x, z, land, phase: random(), speed: 8 + random() * 5, length: 0.26 + random() * 0.31 };
    });
  }, []);
  const elapsed = useRef(0);

  useFrame(({ invalidate }, dt) => {
    invalidate();
    elapsed.current += Math.min(dt, 0.05);
    const buffer = streaks.current!.geometry.getAttribute('position');
    drops.forEach(({ x, z, land, phase, speed, length }, i) => {
      const y = RAIN_HEIGHT - ((elapsed.current * speed + phase * (RAIN_HEIGHT - land)) % (RAIN_HEIGHT - land));
      buffer.setXYZ(i * 2, x, y + model.offset.surface, z);
      buffer.setXYZ(i * 2 + 1, x + 0.016, y + length + model.offset.surface, z + 0.024);
    });
    buffer.needsUpdate = true;
  });

  return (
    <lineSegments ref={streaks} frustumCulled={false} renderOrder={5}>
      <bufferGeometry>
        <bufferAttribute attach="attributes-position" args={[positions, 3]} usage={DynamicDrawUsage} />
      </bufferGeometry>
      <lineBasicMaterial color={RAIN_COLOR} transparent opacity={0.52} depthWrite={false} />
    </lineSegments>
  );
}

function StoredWater({ model, raining, reduced, active, onSelect }: {
  model: ModelState; raining: boolean; reduced: boolean; active: boolean; onSelect: () => void;
}) {
  const group = useRef<Group>(null);
  const material = useMemo(() => new MeshBasicMaterial({
    color: '#3e9bce', transparent: true, opacity: 0, depthTest: false, depthWrite: false, toneMapped: false,
  }), []);
  useEffect(() => () => material.dispose(), [material]);
  const wet = useRef(0);
  const { invalidate } = useThree();
  useLayoutEffect(() => { invalidate(); }, [invalidate, raining, active, reduced]);
  useFrame((_, dt) => {
    const target = Number(raining);
    const next = reduced ? target : MathUtils.damp(wet.current, target, raining ? 0.52 : 2.3, Math.min(dt, 0.05));
    wet.current = Math.abs(next - target) < 0.015 ? target : next;
    if (wet.current !== target) invalidate();
    group.current!.position.y = model.offset.substrate;
    group.current!.visible = wet.current > 0.015;
    material.opacity = wet.current * (active ? 0.4 : 0.29);
  });
  return (
    <group ref={group} onClick={(event) => {
      if (!group.current?.visible) return;
      event.stopPropagation();
      onSelect();
    }}>
      {STORAGE.map(([x, y, z, sx, sy, sz], index) => (
        <mesh material={material} key={x} position={[x, y, z]} scale={[sx, sy, sz]} rotation={[0.12, index * 1.86, index * 0.074]} renderOrder={7}>
          <sphereGeometry args={[1, 14, 8]} />
        </mesh>
      ))}
    </group>
  );
}

export function WaterMovement({ model, raining, active, reduced, onSelect }: {
  model: ModelState; raining: boolean; active: boolean; reduced: boolean; onSelect: () => void;
}) {
  return (
    <>
      {raining && !reduced && <Rain model={model} />}
      {(raining || active) && <>
        <Pathways flows={SURFACE_FLOWS} model={model} raining={raining} reduced={reduced} />
        <Pathways flows={BELOW_FLOWS} model={model} raining={raining} reduced={reduced} />
      </>}
      <StoredWater model={model} raining={raining} reduced={reduced} active={active} onSelect={onSelect} />
    </>
  );
}
