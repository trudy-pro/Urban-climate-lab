import { useLayoutEffect, useMemo, useRef } from 'react';
import {
  BoxGeometry, CanvasTexture, Color, DoubleSide, DodecahedronGeometry, Euler, ExtrudeGeometry,
  InstancedMesh, MathUtils, Mesh, Object3D, RepeatWrapping, Shape, SRGBColorSpace, Vector3,
  type BufferGeometry,
} from 'three';
import { BAND, BUILDINGS, INLETS_Z, LENGTH, PLANT_TOP, SEWER, TREES, WIDTH, seededRandom, type SlabKey } from './data';

type XYZ = [number, number, number];
interface Instance {
  at: XYZ;
  size: XYZ;
  color: string | Color;
  rotation?: XYZ;
}

function Batch({ items, geometry, cast = false, receive = true }: {
  items: Instance[]; geometry: BufferGeometry; cast?: boolean; receive?: boolean;
}) {
  const ref = useRef<InstancedMesh>(null);
  useLayoutEffect(() => {
    const mesh = ref.current!;
    const object = new Object3D();
    items.forEach(({ at, size, color, rotation }, index) => {
      object.position.set(...at);
      object.scale.set(...size);
      object.rotation.set(...(rotation ?? [0, 0, 0]));
      object.updateMatrix();
      mesh.setMatrixAt(index, object.matrix);
      mesh.setColorAt(index, new Color(color));
    });
    mesh.instanceMatrix.needsUpdate = true;
    mesh.computeBoundingSphere();
  }, [items]);
  return (
    <instancedMesh ref={ref} args={[geometry, undefined, items.length]} raycast={ignoreRaycast} castShadow={cast} receiveShadow={receive}>
      <meshStandardMaterial roughness={0.92} />
    </instancedMesh>
  );
}

const ignoreRaycast = () => null;
const UNIT_BOX = new BoxGeometry();
const STONE = new DodecahedronGeometry(0.5, 0);

const SOILS = {
  surface: { color: '#73736d', fleck: '#b0aaa0', particle: 0.6, density: 78 },
  foundation: { color: '#918572', fleck: '#b2a697', particle: 0.8, density: 180 },
  substrate: { color: '#907256', fleck: '#b69a74', particle: 1.4, density: 240 },
  roots: { color: '#785739', fleck: '#98734f', particle: 0.8, density: 150 },
  deep: { color: '#5a4637', fleck: '#7e6854', particle: 1.1, density: 220 },
};
type TextureStyle = { color: string; fleck: string; particle: number };

function grain({ color, fleck, particle }: TextureStyle, xRepeat: number, yRepeat: number, seed: number) {
  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = 128;
  const context = canvas.getContext('2d')!;
  const random = seededRandom(seed);
  context.fillStyle = color;
  context.fillRect(0, 0, 128, 128);
  for (let i = 0; i < 2800; i++) {
    context.globalAlpha = 0.12 + random() * 0.36;
    context.fillStyle = i % 3 === 0 ? '#201c17' : fleck;
    const length = (0.25 + random() * 2.2) * particle;
    context.fillRect(random() * 128, random() * 128, length * 1.6, length);
  }
  const texture = new CanvasTexture(canvas);
  texture.colorSpace = SRGBColorSpace;
  texture.wrapS = texture.wrapT = RepeatWrapping;
  texture.repeat.set(xRepeat, yRepeat);
  texture.anisotropy = 4;
  return texture;
}

export function SlabBody({ layer }: { layer: SlabKey }) {
  const [top, bottom] = BAND[layer];
  const thickness = top - bottom;
  const style = SOILS[layer];
  const textures = useMemo(() => [
    grain(style, LENGTH / 2.1, thickness / 2.1, 31),
    grain(style, WIDTH / 2.1, LENGTH / 2.1, 19),
    grain(style, WIDTH / 2.1, thickness / 2.1, 27),
  ], [style, thickness]);
  useLayoutEffect(() => () => textures.forEach((texture) => texture.dispose()), [textures]);
  const stones = useMemo(() => {
    const random = seededRandom(108 + style.density);
    return Array.from({ length: style.density * 2 }, (_, i): Instance => {
      const front = i < style.density * 1.18;
      const sign = i % 4 === 0 ? -1 : 1;
      const along = random() - 0.5;
      const depth = bottom + thickness * (0.08 + 0.84 * random());
      const scale = (0.045 + random() ** 2 * 0.32) * style.particle;
      return {
        at: front ? [along * (WIDTH - 0.3), depth, sign * LENGTH / 2] : [sign * WIDTH / 2, depth, along * (LENGTH - 0.3)],
        size: [scale * (1 + random()), Math.min(scale * 0.78, thickness * 0.19), scale * (0.62 + random())],
        rotation: [random(), random(), (random() - 0.5) * 1.6],
        color: new Color(style.fleck).multiplyScalar(0.55 + random() * 0.63),
      };
    });
  }, [bottom, style, thickness]);

  return (
    <>
      <mesh position={[0, (top + bottom) / 2, 0]} castShadow receiveShadow>
        <boxGeometry args={[WIDTH, thickness, LENGTH]} />
        {[0, 0, 1, 1, 2, 2].map((index, face) => (
          <meshStandardMaterial key={face} attach={`material-${face}`} map={textures[index]} roughness={0.98} />
        ))}
      </mesh>
      <Batch items={stones} geometry={STONE} />
    </>
  );
}

function StreetPaving() {
  const textures = useMemo(() => [
    grain({ color: '#555952', fleck: '#a2a199', particle: 0.55 }, 7, 15, 178),
    grain({ color: '#898774', fleck: '#a7a28d', particle: 0.8 }, 4, 15, 185),
  ], []);
  useLayoutEffect(() => () => textures.forEach((texture) => texture.dispose()), [textures]);
  const details = useMemo(() => {
    const items: Instance[] = [];
    const random = seededRandom(83);
    const paving = (from: number, to: number, step: number, stride: number, color: string, y: number) => {
      for (let x = from + step / 2; x < to; x += step) {
        for (let z = -LENGTH / 2 + stride / 2; z < LENGTH / 2; z += stride) {
          items.push({ at: [x, y, z], size: [step - 0.027, 0.055, stride - 0.028], color: new Color(color).multiplyScalar(0.84 + random() * 0.27) });
        }
      }
    };
    paving(-8.48, -6.1, 0.46, 0.5, '#bfb9ab', 0.073);
    paving(7.55, 9.45, 0.37, 0.5, '#c4bcb0', 0.073);
    paving(9.5, 11.98, 0.49, 0.5, '#b9ab98', 0.085);
    paving(4.63, 7.5, 0.28, 0.32, '#aaa391', 0.023);
    paving(0.53, 0.95, 0.16, 0.35, '#aaa799', 0.021);
    for (const x of [-6.05, 1.03, 4.55, 7.52]) {
      for (let z = -7.75; z < 8; z += 0.5) {
        items.push({ at: [x, 0.06, z], size: [0.126, 0.16, 0.48], color: '#c9c3b6' });
      }
    }
    for (let z = -7.1; z < 8; z += 2.8) {
      items.push({ at: [-2.82, 0.009, z], size: [0.105, 0.011, 1.14], color: '#d9d7c7' });
    }
    for (const z of INLETS_Z) {
      items.push({ at: [0.73, 0.07, z], size: [0.3, 0.038, 0.5], color: '#3f4945' });
      for (let slot = -3; slot <= 3; slot++) {
        items.push({ at: [0.73, 0.092, z + slot * 0.061], size: [0.264, 0.008, 0.017], color: '#92948b' });
      }
    }
    return items;
  }, []);

  return (
    <>
      <mesh position={[-2.75, 0.001, 0]} rotation={[-Math.PI / 2, 0, 0]} receiveShadow>
        <planeGeometry args={[6.59, LENGTH]} />
        <meshStandardMaterial map={textures[0]} roughness={0.96} />
      </mesh>
      <mesh position={[2.8, 0.009, 0]} rotation={[-Math.PI / 2, 0, 0]} receiveShadow>
        <planeGeometry args={[3.42, LENGTH]} />
        <meshStandardMaterial map={textures[1]} roughness={1} />
      </mesh>
      <Batch items={details} geometry={UNIT_BOX} />
    </>
  );
}

const ROOF = new ExtrudeGeometry((() => {
  const shape = new Shape();
  shape.moveTo(-0.5, 0);
  shape.lineTo(0.5, 0);
  shape.lineTo(0, 1);
  shape.closePath();
  return shape;
})(), { depth: 1, bevelEnabled: false });

function Buildings() {
  const details = useMemo(() => {
    const items: Instance[] = [];
    for (const { x, z, w, d, h, trim, shutters } of BUILDINGS) {
      for (const y of [0.25, 1.05, h - 0.1]) {
        items.push({ at: [x, y, z], size: [w + 0.09, y < 0.3 ? 0.31 : 0.092, d + 0.09], color: trim });
      }
      const windowAt = (horizontal: number, rooms: number, front: boolean, side: -1 | 1) => {
        const wall = (front ? z : x) + side * (front ? d : w) * 0.5;
        const put = (along: number, y: number, depth: number, width: number, height: number, color: string) => {
          items.push({
            at: front ? [along, y, wall + depth * side] : [wall + depth * side, y, along],
            size: front ? [width, height, 0.028] : [0.028, height, width],
            color,
          });
        };
        for (let i = 0; i < rooms; i++) {
          const center = (front ? x : z) + (i + 0.5 - rooms / 2) * horizontal / rooms;
          const floors = h >= 5 ? 3 : 2;
          for (let floor = 0; floor < floors; floor++) {
            const isDoor = floor === 0 && i === 1 && ((!front && side === 1 && x < 0) || (front && side === 1 && x > 0));
            const y = isDoor ? 0.83 : 1.05 + floor * ((h - 1.75) / floors) + (floor === 0 ? 0.35 : 0.22);
            const windowHeight = isDoor ? 1.5 : 0.86;
            put(center, y, 0.013, 0.66, windowHeight + 0.14, trim);
            put(center, y, 0.031, 0.51, windowHeight, isDoor ? '#655348' : '#424945');
            if (isDoor) continue;
            put(center, y - 0.48, 0.045, 0.76, 0.075, trim);
            put(center, y, 0.049, 0.031, 0.85, trim);
            put(center, y + 0.11, 0.049, 0.5, 0.027, trim);
            for (const sign of [-1, 1]) put(center + sign * 0.418, y, 0.031, 0.17, 0.84, shutters);
          }
        }
      };
      windowAt(w - 0.25, 2, true, 1);
      windowAt(w - 0.25, 2, true, -1);
      windowAt(d - 0.25, d > 4.6 ? 3 : 2, false, 1);
      windowAt(d - 0.25, d > 4.6 ? 3 : 2, false, -1);
      for (let row = 0; row < 12; row++) {
        const t = (row + 1) / 13;
        for (const s of [-1, 1]) {
          items.push({ at: [x + s * (w + 0.18) * 0.5 * (1 - t), h + 1.34 * t + 0.016, z], size: [0.022, 0.023, d + 0.15], color: '#8d7260' });
        }
      }
      items.push({ at: [x + 0.56, h + 1.31, z - d * 0.23], size: [0.32, 0.88, 0.42], color: '#9b7862' });
      items.push({ at: [x + 0.56, h + 1.76, z - d * 0.23], size: [0.42, 0.1, 0.51], color: '#685a4d' });
      items.push({ at: [x, h + 1.347, z], size: [0.08, 0.05, d + 0.2], color: '#68564b' });
    }
    return items;
  }, []);

  return (
    <>
      {BUILDINGS.map(({ x, z, w, d, h, plaster, roof }) => (
        <group key={z}>
          <mesh position={[x, h / 2, z]} castShadow receiveShadow>
            <boxGeometry args={[w, h, d]} />
            <meshStandardMaterial color={plaster} roughness={0.92} />
          </mesh>
          <mesh geometry={ROOF} position={[x, h, z - (d + 0.19) / 2]} scale={[w + 0.18, 1.34, d + 0.19]} castShadow receiveShadow>
            <meshStandardMaterial color={roof} roughness={0.89} />
          </mesh>
        </group>
      ))}
      <Batch items={details} geometry={UNIT_BOX} receive={false} />
    </>
  );
}

const TREE_COLORS = ['#536744', '#64764b', '#728354', '#89935c', '#a1a171', '#66774c'];
const barkMaterial = '#71624b';

function Branch({ from, to, start, end, color }: { from: XYZ; to: XYZ; start: number; end: number; color: string }) {
  const direction = new Vector3(...to).sub(new Vector3(...from));
  const mid = new Vector3(...from).addScaledVector(direction, 0.5);
  const ref = useRef<Mesh>(null);
  useLayoutEffect(() => {
    const delta = new Vector3(...to).sub(new Vector3(...from)).normalize();
    ref.current!.quaternion.setFromUnitVectors(new Vector3(0, 1, 0), delta);
  }, [from, to]);
  return (
    <mesh ref={ref} position={mid} castShadow>
      <cylinderGeometry args={[end, start, direction.length(), 7]} />
      <meshStandardMaterial color={color} roughness={0.96} />
    </mesh>
  );
}

function StreetPlanting() {
  const { leaves, brush, branches } = useMemo(() => {
    const random = seededRandom(390);
    const leaves: Instance[] = [];
    const brush: Instance[] = [];
    const branches: { from: XYZ; to: XYZ }[] = [];
    TREES.forEach(([x, z], i) => {
      const crown = 4.45 + i * 0.36;
      branches.push({ from: [x, PLANT_TOP, z], to: [x - 0.16, crown + 0.28, z] });
      for (let j = 0; j < 8; j++) {
        const angle = j * 2.399;
        const reach = 0.8 + random() * 0.99;
        const branch: XYZ = [x + Math.sin(angle) * reach, crown + (random() - 0.44) * 1.65, z + Math.cos(angle) * reach];
        branches.push({ from: [x - 0.07, 2.27 + random() * 1.12, z], to: branch });
        for (let k = 0; k < 21; k++) {
          const a = random() * Math.PI * 2;
          const r = Math.sqrt(random()) * 0.82;
          const scale = 0.22 + random() * 0.7;
          leaves.push({
            at: [branch[0] + Math.cos(a) * r, branch[1] + (random() - 0.4) * 1.3, branch[2] + Math.sin(a) * r],
            size: [scale * 1.38, scale, scale * 1.31], rotation: [random(), random() * 6, random()],
            color: TREE_COLORS[Math.floor(random() * TREE_COLORS.length)],
          });
        }
      }
    });
    for (let i = 0; i < 490; i++) {
      const z = (random() - 0.5) * 15.6;
      const x = 1.3 + random() * 3.02;
      const size = (0.045 + random() * 0.16) * (Math.abs(Math.cos(z * 0.68 + x)) * 0.7 + 0.6);
      brush.push({ at: [x, size * 0.4, z], size: [size, size * 1.42, size], color: TREE_COLORS[Math.floor(random() * TREE_COLORS.length)] });
    }
    return { leaves, brush, branches };
  }, []);
  return (
    <>
      {branches.map(({ from, to }, i) => <Branch key={i} from={from} to={to} start={i % 9 === 0 ? 0.154 : 0.063} end={0.022} color={barkMaterial} />)}
      <Batch items={leaves} geometry={STONE} cast />
      <Batch items={brush} geometry={STONE} />
    </>
  );
}

export function StreetSurface() {
  return <><StreetPaving /><Buildings /><StreetPlanting /></>;
}

function Pipe({ x, y, radius, color }: { x: number; y: number; radius: number; color: string }) {
  return (
    <group position={[x, y, 0]}>
      <mesh rotation={[Math.PI / 2, 0, 0]}>
        <cylinderGeometry args={[radius, radius, LENGTH + 0.014, 24, 1, true]} />
        <meshStandardMaterial color={color} roughness={0.64} side={DoubleSide} />
      </mesh>
      {[-1, 1].map((side) => (
        <group key={side} position={[0, 0, side * (LENGTH / 2 + 0.024)]} rotation={[0, side === -1 ? Math.PI : 0, 0]}>
          <mesh>
            <circleGeometry args={[radius * 0.84, 24]} />
            <meshStandardMaterial color="#302f2a" />
          </mesh>
          <mesh position={[0, 0, 0.019]}>
            <torusGeometry args={[radius * 0.91, radius * 0.11, 8, 28]} />
            <meshStandardMaterial color={color} roughness={0.6} />
          </mesh>
        </group>
      ))}
    </group>
  );
}

export function Infrastructure() {
  return (
    <>
      <Pipe x={SEWER.x} y={SEWER.y} radius={SEWER.radius} color="#b7b1a0" />
      <Pipe x={-4.36} y={-1.04} radius={0.18} color="#8d7b63" />
      <Pipe x={-5.08} y={-0.94} radius={0.12} color="#b6a58c" />
      {[-10.2, 10.69].map((x) => <mesh key={x} position={[x, -0.94, x > 0 ? -2.6 : 0]} receiveShadow>
        <boxGeometry args={[x > 0 ? 2.62 : 3.42, 0.96, x > 0 ? 10.18 : 16.025]} />
        <meshStandardMaterial color="#aaa18f" roughness={0.92} />
      </mesh>)}
    </>
  );
}

function rootMass() {
  const random = seededRandom(21);
  const segments: { from: XYZ; to: XYZ; radius: number }[] = [];
  // Expose a network of roots on both longitudinal cut faces and under the trees.
  for (const [x, z] of [[2.85, 7.98], [2.85, -7.98], ...TREES]) {
    for (let i = 0; i < 14; i++) {
      const sign = i % 2 === 0 ? 1 : -1;
      const y = -3.223 - (i % 7) * 0.142;
      const reach = 0.7 + random() * 3.45;
      let from: XYZ = [x + (random() - 0.5) * 0.27, y, z];
      for (let j = 1; j < 5; j++) {
        const to: XYZ = [
          x + sign * reach * j / 4,
          MathUtils.clamp(from[1] + (random() - 0.64) * 0.24, -4.41, -3.22),
          z + (j / 4) * (Math.abs(z) > 7 ? Math.sign(z) * 0.051 : (random() - 0.5) * 1.9),
        ];
        segments.push({ from, to, radius: (0.045 + reach * 0.016) * (1 - j * 0.204) });
        from = to;
      }
    }
  }

  const axis = new Vector3(0, 1, 0);
  return segments.map(({ from, to, radius }): Instance => {
    const delta = new Vector3(...to).sub(new Vector3(...from));
    const mid = new Vector3(...from).addScaledVector(delta, 0.5);
    const object = new Object3D();
    object.quaternion.setFromUnitVectors(axis, delta.clone().normalize());
    const angle = new Euler().setFromQuaternion(object.quaternion);
    return { at: [mid.x, mid.y, mid.z], size: [radius, delta.length() + radius * 0.25, radius], rotation: [angle.x, angle.y, angle.z], color: '#b59364' };
  });
}

export function Roots() {
  const roots = useMemo(rootMass, []);
  return <Batch items={roots} geometry={UNIT_BOX} />;
}
