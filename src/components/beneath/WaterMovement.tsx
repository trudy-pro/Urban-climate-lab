import { useEffect, useLayoutEffect, useMemo, useRef } from 'react';
import { useFrame, useThree } from '@react-three/fiber';
import {
  BufferAttribute, Color, DoubleSide, DynamicDrawUsage, Group, InstancedMesh, LineSegments, MathUtils,
  Mesh, MeshBasicMaterial, Object3D, ShaderMaterial, Vector2, Vector3,
} from 'three';
import { INLETS_Z, LENGTH, PLANT_TOP, SEWER, seededRandom, type ModelState, type SlabKey } from './data';

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

/* ---------- simulated surface water (replaces falling rain) ---------- */

/** The wet part of the street: from the far kerb across to the planted strip. */
const SHEET = { x0: -5.9, x1: 2.35, y: 0.071 };
/** Where the surface water leaves the street: curb inlets and the planted strip. */
const OUTLETS: [x: number, z: number][] = [
  ...INLETS_Z.map((z): [number, number] => [0.73, z]),
  ...[-3.33, 2.1, 6.45].map((z): [number, number] => [2.08, z]),
];

const sheetVertex = /* glsl */ `
  varying vec2 vPos;
  void main() {
    vPos = (modelMatrix * vec4(position, 1.0)).xz;
    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
  }
`;

const sheetFragment = /* glsl */ `
  uniform float uTime;
  uniform float uWet;
  uniform vec3 uDeep;
  uniform vec3 uLight;
  uniform vec2 uRange;
  uniform vec2 uOutlets[${OUTLETS.length}];
  varying vec2 vPos;

  float hash(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
  float noise(vec2 p) {
    vec2 i = floor(p), f = fract(p);
    vec2 u = f * f * (3.0 - 2.0 * f);
    return mix(mix(hash(i), hash(i + vec2(1, 0)), u.x), mix(hash(i + vec2(0, 1)), hash(i + vec2(1, 1)), u.x), u.y);
  }
  float fbm(vec2 p) {
    float v = 0.0, a = 0.5;
    for (int k = 0; k < 4; k++) { v += a * noise(p); p = p * 2.03 + 7.1; a *= 0.5; }
    return v;
  }

  void main() {
    vec2 p = vPos; // street x, street z
    float across = clamp((p.x - uRange.x) / (uRange.y - uRange.x), 0.0, 1.0);

    // water gathers downstream and is pulled toward the nearest outlet
    float gather = 0.0;
    vec2 pull = vec2(1.0, 0.0);
    float best = 1e9;
    for (int k = 0; k < ${OUTLETS.length}; k++) {
      vec2 d = uOutlets[k] - p;
      float dist = length(d);
      gather += exp(-dist * dist * 0.55);
      if (dist < best) { best = dist; pull = normalize(d + vec2(0.001, 0.0)); }
    }
    gather = clamp(gather, 0.0, 1.0);
    float depth = smoothstep(0.0, 1.0, across) * 0.55 + gather * 0.75;

    // flowing ripples advected toward the outlet
    vec2 flow = p - pull * uTime * 0.9;
    float ripples = fbm(flow * vec2(1.6, 2.4));
    float streaks = smoothstep(0.52, 0.86, fbm(flow * vec2(3.4, 1.1) + ripples));
    float sparkle = smoothstep(0.78, 0.96, noise(flow * 7.0 + uTime * 0.6));

    // soft edges where the sheet meets the dry street
    float edge = smoothstep(0.0, 0.06, across) * (1.0 - smoothstep(0.93, 1.0, across))
               * (1.0 - smoothstep(7.3, 8.0, abs(p.y)));

    vec3 color = mix(uDeep, uLight, 0.25 + streaks * 0.6 + sparkle * 0.4);
    float alpha = uWet * edge * (0.18 + depth * 0.36 + streaks * (0.2 + depth * 0.4) + sparkle * 0.25);
    gl_FragColor = vec4(color, clamp(alpha, 0.0, 0.82));
  }
`;

function WaterSheet({ model, reduced, wet }: { model: ModelState; reduced: boolean; wet: { current: number } }) {
  const mesh = useRef<Mesh>(null);
  const material = useMemo(() => new ShaderMaterial({
    vertexShader: sheetVertex,
    fragmentShader: sheetFragment,
    transparent: true,
    depthWrite: false,
    toneMapped: false,
    uniforms: {
      uTime: { value: 0 },
      uWet: { value: 0 },
      uDeep: { value: new Color('#1f6fae') },
      uLight: { value: new Color('#9fd8f3') },
      uRange: { value: new Vector2(SHEET.x0, SHEET.x1) },
      uOutlets: { value: OUTLETS.map(([x, z]) => new Vector2(x, z)) },
    },
  }), []);
  useEffect(() => () => material.dispose(), [material]);

  useFrame((_, dt) => {
    if (!reduced) material.uniforms.uTime.value += Math.min(dt, 0.05);
    material.uniforms.uWet.value = wet.current;
    mesh.current!.position.y = SHEET.y + model.offset.surface;
  });

  return (
    <mesh ref={mesh} material={material} rotation={[-Math.PI / 2, 0, 0]}
      position={[(SHEET.x0 + SHEET.x1) / 2, SHEET.y, 0]} renderOrder={5} frustumCulled={false}>
      <planeGeometry args={[SHEET.x1 - SHEET.x0, LENGTH, 1, 1]} />
    </mesh>
  );
}

const RIVULETS = 320;

/** Thin streams of water running over the street to the inlets and the planted strip. */
function Rivulets({ model, reduced, wet }: { model: ModelState; reduced: boolean; wet: { current: number } }) {
  const dots = useRef<InstancedMesh>(null);
  const time = useRef(0);
  const { paths, streams, object, dir, unit } = useMemo(() => {
    const paths = SURFACE_FLOWS.map(({ nodes }) => {
      const lengths = [0];
      for (let k = 1; k < nodes.length; k++) {
        const a = nodes[k - 1], b = nodes[k];
        lengths.push(lengths[k - 1] + Math.hypot(b[0] - a[0], b[1] - a[1], b[2] - a[2]));
      }
      return { nodes, lengths, total: lengths[lengths.length - 1] };
    });
    const random = seededRandom(41);
    const streams = Array.from({ length: RIVULETS }, (_, i) => ({
      path: i % paths.length,
      phase: random(),
      speed: 0.7 + random() * 0.75,
      lateral: (random() - 0.5) * 2,
      wobble: random() * Math.PI * 2,
      size: 0.75 + random() * 0.6,
    }));
    return { paths, streams, object: new Object3D(), dir: new Vector3(), unit: new Vector3(1, 0, 0) };
  }, []);

  useLayoutEffect(() => {
    const mesh = dots.current!;
    const c = new Color();
    streams.forEach((s, i) => mesh.setColorAt(i, c.set(SURFACE_FLOWS[s.path].color).lerp(highlight, 0.2 + (i % 4) * 0.12)));
    mesh.instanceColor!.needsUpdate = true;
  }, [streams]);

  useFrame((_, dt) => {
    if (!reduced) time.current += Math.min(dt, 0.05);
    const mesh = dots.current!;
    const lift = model.offset.surface;
    streams.forEach((s, i) => {
      const { nodes, lengths, total } = paths[s.path];
      const u = (time.current * s.speed / total + s.phase) % 1;
      const at = u * total;
      let end = 1;
      while (lengths[end] < at) end++;
      const a = nodes[end - 1], b = nodes[end];
      const t = (at - lengths[end - 1]) / (lengths[end] - lengths[end - 1] || 1);
      dir.set(b[0] - a[0], 0, b[2] - a[2]).normalize();
      // the stream starts wide and narrows as water converges on the outlet
      const spread = (1 - u) * 0.62 + 0.05;
      const side = s.lateral * spread + Math.sin(time.current * 2.1 + s.wobble) * 0.035;
      object.position.set(
        MathUtils.lerp(a[0], b[0], t) - dir.z * side,
        MathUtils.lerp(a[1], b[1], t) + lift + 0.012,
        MathUtils.lerp(a[2], b[2], t) + dir.x * side,
      );
      object.quaternion.setFromUnitVectors(unit, dir);
      const fade = Math.min(1, u * 6, (1 - u) * 9) * wet.current * s.size;
      object.scale.set(fade * (2.6 + s.speed), fade * 0.55, fade);
      object.updateMatrix();
      mesh.setMatrixAt(i, object.matrix);
    });
    mesh.instanceMatrix.needsUpdate = true;
  });

  return (
    <instancedMesh ref={dots} args={[undefined, undefined, RIVULETS]} frustumCulled={false} renderOrder={6}>
      <sphereGeometry args={[0.06, 8, 6]} />
      <meshBasicMaterial transparent opacity={0.85} depthWrite={false} toneMapped={false} />
    </instancedMesh>
  );
}

/** Rings where the water drops into each curb inlet or soaks into the planted strip. */
function OutletRipples({ model, reduced, wet }: { model: ModelState; reduced: boolean; wet: { current: number } }) {
  const group = useRef<Group>(null);
  const material = useMemo(() => new MeshBasicMaterial({
    color: '#b6e3f6', transparent: true, opacity: 0, depthWrite: false, toneMapped: false, side: DoubleSide,
  }), []);
  useEffect(() => () => material.dispose(), [material]);
  const time = useRef(0);
  useFrame((_, dt) => {
    if (!reduced) time.current += Math.min(dt, 0.05);
    const g = group.current!;
    g.position.y = model.offset.surface;
    g.children.forEach((ring, i) => {
      const k = ((time.current * 0.8 + i * 0.37) % 1);
      ring.scale.setScalar(0.15 + k * 0.85);
      (ring as Mesh).visible = wet.current > 0.02;
    });
    material.opacity = 0.45 * wet.current;
  });
  return (
    <group ref={group}>
      {OUTLETS.flatMap(([x, z], i) => [0, 1].map((n) => (
        <mesh key={`${i}-${n}`} material={material} position={[x, SHEET.y + 0.03, z]} rotation={[-Math.PI / 2, 0, 0]} renderOrder={6}>
          <ringGeometry args={[0.32, 0.36, 32]} />
        </mesh>
      )))}
    </group>
  );
}

function SurfaceWater({ model, reduced }: { model: ModelState; reduced: boolean }) {
  const wet = useRef(0);
  useFrame(({ invalidate }, dt) => {
    invalidate();
    wet.current = reduced ? 1 : MathUtils.damp(wet.current, 1, 0.9, Math.min(dt, 0.05));
  });
  return (
    <>
      <WaterSheet model={model} reduced={reduced} wet={wet} />
      <Rivulets model={model} reduced={reduced} wet={wet} />
      <OutletRipples model={model} reduced={reduced} wet={wet} />
    </>
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
      {raining && <SurfaceWater model={model} reduced={reduced} />}
      {(raining || active) && <>
        <Pathways flows={SURFACE_FLOWS} model={model} raining={raining} reduced={reduced} />
        <Pathways flows={BELOW_FLOWS} model={model} raining={raining} reduced={reduced} />
      </>}
      <StoredWater model={model} raining={raining} reduced={reduced} active={active} onSelect={onSelect} />
    </>
  );
}
