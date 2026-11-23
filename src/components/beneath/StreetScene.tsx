import { useLayoutEffect, useMemo, useRef, type ComponentRef, type PointerEvent, type RefObject } from 'react';
import { Canvas, useFrame, useThree } from '@react-three/fiber';
import { Edges, Html, OrbitControls } from '@react-three/drei';
import {
  type Camera, CanvasTexture, DynamicDrawUsage, PCFShadowMap, Group, LineSegments, MathUtils, OrthographicCamera, Vector3,
} from 'three';
import { LAYERS, LENGTH, SLABS, WIDTH, zeroOffsets, type LayerKey, type ModelState, type SlabKey } from './data';
import type { RainLevel } from '../RainIntensity';
import { FLOW_STEPS } from '../section/flowPaths';
import { ROOTZONE } from '../section/geometry';
import { BLOCK_BAND as BAND, BLOCK_DEPTH, BlockBody, BlockWater, LABEL_Y, StreetRain, layerAt, sx, sy } from './BlockModel';

const HOME_OFFSET = new Vector3(22, 17.4, 35);

/**
 * The canvas fills the screen (so shadows are never clipped); the model is framed in the area the
 * title, layer list and control bar leave free. Returns that area in canvas pixels.
 */
function freeArea(canvas: HTMLCanvasElement) {
  const box = canvas.getBoundingClientRect();
  const page = canvas.closest('.beneath');
  const rect = (sel: string) => (page?.querySelector(sel) ?? document.querySelector(sel))?.getBoundingClientRect();
  // the underground view's heading card and Map / Water flows panel frame the block
  const head = rect('.ug__head');
  const rail = rect('.ug__panel');
  const bar = rect('.beneath__controls');
  let left = head ? head.left : 16;
  let right = box.right - 16;
  let top = head ? head.bottom + 12 : box.top;
  if (head && rail && rail.left - head.right > 360 && head.width > 0) {
    left = head.right + 18;
    top = box.top + 72;
  }
  let bottom = bar ? bar.top - 14 : box.bottom;
  if (rail && rail.width > 0) {
    // side rail on wide screens, bottom sheet on narrow ones
    if (rail.left > box.left + box.width * 0.5) right = rail.left - 24;
    else bottom = Math.min(bottom, rail.top - 10);
  }
  if (right - left < 200) { left = box.left; right = box.right; }
  if (bottom - top < 160) { top = box.top; bottom = box.bottom; }
  return { x: left - box.left, y: top - box.top, w: right - left, h: bottom - top };
}
/** gap between layers when the block is pulled apart (the substrate and root zone interlock, so it is generous) */
const SEPARATION = 3.9;
/** the orbit centre: middle of the block's depth */
const HOME_Y = -BLOCK_DEPTH * 0.42;

export type CameraCommand = 'left' | 'right' | 'up' | 'down' | 'near' | 'far';

interface SceneProps {
  showFlows: boolean;
  flowSvgRef: RefObject<SVGSVGElement | null>;
  /** opening sequence: how many slabs have been revealed, from the deepest up (0–5) */
  revealed: number;
  /** slow turn of the camera while the layers are revealed */
  spinning?: boolean;
  /** called once the 3D scene is up, so the opening sequence can start */
  onReady?: () => void;
  apart: boolean;
  raining: boolean;
  rainIntensity: RainLevel;
  labels: boolean;
  reduced: boolean;
  selected: LayerKey | null;
  hovered: LayerKey | null;
  reset: number;
  cameraCommand: { current: ((command: CameraCommand) => void) | null };
  onSelect: (layer: LayerKey | null) => void;
  onHover: (layer: LayerKey | null) => void;
}

function nudge(model: ModelState, layer: SlabKey, amount: number) {
  const i = SLABS.indexOf(layer);
  const min = i === SLABS.length - 1 ? -3.3 : model.manual[SLABS[i + 1]] - SEPARATION + 0.32;
  const max = i === 0 ? 3.3 : model.manual[SLABS[i - 1]] + SEPARATION - 0.32;
  model.manual[layer] = MathUtils.clamp(model.manual[layer] + amount, Math.max(-3.3, min), Math.min(3.3, max));
}

// rendered inside drei's <Html> (a separate React root), so it receives the camera instead of using R3F hooks
function LayerHandle({ layer, model, labels, selected, onSelect, camera, invalidate }: {
  layer: SlabKey; model: ModelState; labels: boolean; selected: boolean; onSelect: () => void;
  camera: Camera; invalidate: () => void;
}) {
  const drag = useRef<{ id: number; y: number } | null>(null);
  const end = (event: PointerEvent<HTMLButtonElement>) => {
    if (drag.current?.id !== event.pointerId) return;
    drag.current = null;
    model.down = false;
  };
  const info = LAYERS.find(({ key }) => key === layer)!;

  return (
    <button
      type="button"
      className={`beneath__handle ${selected ? 'is-selected' : ''}`}
      aria-label={`Move ${info.name}. Drag vertically or use the Up and Down keys.`}
      title={`Drag ${info.name} vertically`}
      onPointerDown={(event) => {
        if (!event.isPrimary || event.button !== 0) return;
        event.stopPropagation();
        event.currentTarget.setPointerCapture(event.pointerId);
        drag.current = { id: event.pointerId, y: event.clientY };
        model.down = true;
        onSelect();
      }}
      onPointerMove={(event) => {
        if (drag.current?.id !== event.pointerId) return;
        const viewCosine = Math.sqrt(1 - camera.getWorldDirection(handleDirection).y ** 2);
        const units = -(event.clientY - drag.current.y) / ((camera as OrthographicCamera).zoom * Math.max(0.29, viewCosine));
        nudge(model, layer, units);
        drag.current.y = event.clientY;
        invalidate();
      }}
      onPointerUp={end}
      onPointerCancel={end}
      onLostPointerCapture={end}
      onKeyDown={(event) => {
        if (event.key !== 'ArrowUp' && event.key !== 'ArrowDown') return;
        event.preventDefault();
        event.stopPropagation();
        invalidate();
        nudge(model, layer, event.key === 'ArrowUp' ? 0.33 : -0.33);
        onSelect();
      }}
      onClick={onSelect}
    >
      <span aria-hidden="true">↕</span>{labels && <span>{info.name}</span>}
    </button>
  );
}

const handleDirection = new Vector3();

function Slab({ layer, index, model, revealed, apart, labels, reduced, selected, hovered, onSelect, onHover }: {
  layer: SlabKey; index: number; model: ModelState;
} & Pick<SceneProps, 'revealed' | 'apart' | 'labels' | 'reduced' | 'selected' | 'hovered' | 'onSelect' | 'onHover'>) {
  const group = useRef<Group>(null);
  const { camera, invalidate } = useThree();
  /** 0 → 1 as the slab grows up out of its own base during the opening sequence */
  const grow = useRef(0);
  const shown = revealed > SLABS.length - 1 - index;
  const [top, bottom] = BAND[layer];
  const middle = (top + bottom) / 2;
  const visibleLabel = labels;

  useFrame(({ gl, invalidate }, dt) => {
    const target = apart ? (2 - index) * SEPARATION + model.manual[layer] : 0;
    const y = reduced ? target : MathUtils.damp(model.offset[layer], target, model.down ? 21 : 6.2, Math.min(dt, 0.05));
    const next = Math.abs(y - target) < 0.001 ? target : y;
    if (next !== model.offset[layer]) gl.shadowMap.needsUpdate = true;
    model.offset[layer] = next;
    const want = shown ? 1 : 0;
    const g = reduced ? want : Math.abs(grow.current - want) < 0.002 ? want : MathUtils.damp(grow.current, want, 2.6, Math.min(dt, 0.05));
    if (g !== grow.current) gl.shadowMap.needsUpdate = true;
    grow.current = g;
    // grow from the slab's own base, so each layer rises into place (buildings and trees with the street)
    const eased = 1 - (1 - g) ** 3;
    const obj = group.current!;
    obj.visible = eased > 0.004;
    obj.scale.y = Math.max(eased, 0.0001);
    obj.position.y = next + bottom * (1 - eased);
    if (next !== target || g !== want) invalidate();
  }, -2);

  return (
    <group ref={group}
      onClick={(event) => {
        if (event.delta > 5) return;
        event.stopPropagation();
        onSelect(layer);
      }}
      onPointerOver={(event) => {
        if (event.pointerType === 'touch') return;
        event.stopPropagation();
        onHover(layer);
      }}
      onPointerOut={() => onHover(null)}
    >
      <BlockBody layer={layer} />
      {(selected === layer || hovered === layer) && (
        <mesh position={[0, middle, 0]} raycast={() => null}>
          <boxGeometry args={[WIDTH + 0.045, top - bottom + 0.044, LENGTH + 0.045]} />
          <meshBasicMaterial visible={false} />
          <Edges raycast={() => null} color={selected === layer ? '#22e4ff' : '#9fefff'} />
        </mesh>
      )}
      {shown && (apart || visibleLabel) && (
        <Html position={[WIDTH / 2 + 0.05, LABEL_Y[layer], LENGTH / 2 + 0.21]} zIndexRange={[8, 1]} className="beneath__anchor">
          {apart
            ? <LayerHandle layer={layer} model={model} labels={labels} selected={selected === layer} onSelect={() => onSelect(layer)} camera={camera} invalidate={invalidate} />
            : <span className="beneath__callout">{LAYERS[index].name}</span>}
        </Html>
      )}
    </group>
  );
}

function Alignment({ model }: { model: ModelState }) {
  const guides = useRef<LineSegments>(null);
  const points = useMemo(() => new Float32Array((SLABS.length - 1) * 4 * 6), []);
  const distances = useMemo(() => new Float32Array(points.length / 3), [points]);
  useFrame(() => {
    const lines = guides.current!;
    const geom = lines.geometry.getAttribute('position');
    const distance = lines.geometry.getAttribute('lineDistance');
    let vertex = 0;
    let visible = false;
    for (let i = 0; i < SLABS.length - 1; i++) {
      const from = SLABS[i], to = SLABS[i + 1];
      const top = BAND[from][1] + model.offset[from];
      const bottom = BAND[to][0] + model.offset[to];
      if (top - bottom > 0.025) visible = true;
      for (const x of [-WIDTH / 2, WIDTH / 2]) {
        for (const z of [-LENGTH / 2, LENGTH / 2]) {
          geom.setXYZ(vertex++, x, top, z);
          distance.setX(vertex, top - bottom);
          geom.setXYZ(vertex++, x, bottom, z);
        }
      }
    }
    lines.visible = visible;
    if (!visible) return;
    geom.needsUpdate = true;
    distance.needsUpdate = true;
  });

  return (
    <lineSegments ref={guides} frustumCulled={false}>
      <bufferGeometry>
        <bufferAttribute attach="attributes-position" args={[points, 3]} usage={DynamicDrawUsage} />
        <bufferAttribute attach="attributes-lineDistance" args={[distances, 1]} usage={DynamicDrawUsage} />
      </bufferGeometry>
      <lineDashedMaterial color="#5d8fb8" dashSize={0.15} gapSize={0.14} transparent opacity={0.6} depthWrite={false} />
    </lineSegments>
  );
}

function Floor({ model }: { model: ModelState }) {
  const group = useRef<Group>(null);
  const shadow = useMemo(() => {
    const canvas = document.createElement('canvas');
    canvas.width = canvas.height = 96;
    const ctx = canvas.getContext('2d')!;
    const shade = ctx.createRadialGradient(48, 48, 5, 48, 48, 48);
    shade.addColorStop(0, 'rgba(2, 6, 14, 0.62)');
    shade.addColorStop(0.49, 'rgba(2, 6, 14, 0.48)');
    shade.addColorStop(0.81, 'rgba(2, 6, 14, 0.18)');
    shade.addColorStop(1, 'rgba(2, 6, 14, 0)');
    ctx.fillStyle = shade;
    ctx.fillRect(0, 0, 96, 96);
    return new CanvasTexture(canvas);
  }, []);
  useLayoutEffect(() => () => shadow.dispose(), [shadow]);
  useFrame(() => {
    group.current!.position.y = BAND.deep[1] + model.offset.deep - 0.18;
  });
  return (
    <group ref={group}>
      <mesh position={[0.5, -0.04, 0.48]} rotation={[-Math.PI / 2, 0, 0]}>
        <planeGeometry args={[40, 30]} />
        <meshBasicMaterial map={shadow} transparent depthWrite={false} toneMapped={false} />
      </mesh>
      <mesh rotation={[-Math.PI / 2, 0, 0]} receiveShadow>
        <planeGeometry args={[57, 44]} />
        <shadowMaterial transparent opacity={0.38} depthWrite={false} />
      </mesh>
    </group>
  );
}

function CameraRig({ apart, reset, reduced, spinning, showFlows, model, cameraCommand, onHover }: Pick<SceneProps, 'apart' | 'reset' | 'reduced' | 'spinning' | 'showFlows' | 'cameraCommand' | 'onHover'> & { model: ModelState }) {
  const controls = useRef<ComponentRef<typeof OrbitControls>>(null);
  const { size, gl, camera, invalidate } = useThree();
  const cam = camera as OrthographicCamera;
  const initial = useRef(true);
  const queued = useRef<CameraCommand | null>(null);
  const needsHome = useRef(false);
  const baseZoom = useRef(0);
  const fit = useRef(0);
  const deltaPosition = useMemo(() => new Vector3(), []);
  const homePosition = useMemo(() => new Vector3(), []);
  const homeTarget = useMemo(() => new Vector3(), []);

  useLayoutEffect(() => {
    const orbit = controls.current!;
    const fitCamera = () => {
      const area = freeArea(gl.domElement);
      const next = Math.min(area.w / 30.5, area.h / (apart ? 34 : 17.8));
      // shift the view so the model's centre lands in the middle of the free area
      const shiftX = area.x + area.w / 2 - size.width / 2;
      const shiftY = area.y + area.h / 2 - size.height / 2;
      cam.setViewOffset(size.width, size.height, -shiftX, -shiftY, size.width, size.height);
      if (initial.current) {
        homeTarget.set(0, HOME_Y, 0.16);
        orbit.target.copy(homeTarget);
        camera.position.copy(homeTarget).add(HOME_OFFSET);
        cam.zoom = next;
        cam.updateProjectionMatrix();
        orbit.update();
        fit.current = next;
        initial.current = false;
      }
      baseZoom.current = next;
      orbit.minZoom = next * 0.67;
      orbit.maxZoom = next * 2.4;
      invalidate();
    };
    fitCamera();
    const resize = new ResizeObserver(fitCamera);
    const story = gl.domElement.closest('.beneath')?.querySelector('.ug__head');
    const panel = document.querySelector('.ug__panel');
    if (story) resize.observe(story);
    if (panel) resize.observe(panel);
    return () => resize.disconnect();
  }, [apart, cam, camera, gl, homeTarget, invalidate, showFlows, size.height, size.width]);

  useLayoutEffect(() => {
    if (reset === 0) return;
    needsHome.current = true;
    invalidate();
  }, [invalidate, reset]);

  useLayoutEffect(() => {
    cameraCommand.current = (command) => {
      queued.current = command;
      invalidate();
    };
    return () => { cameraCommand.current = null; };
  }, [cameraCommand, invalidate]);

  useFrame((_, dt) => {
    const orbit = controls.current!;
    if (spinning) invalidate(); // keep the slow opening turn going (the canvas renders on demand)
    const alpha = reduced ? 1 : 1 - Math.exp(-Math.min(dt, 0.05) * 6.7);
    if (Math.abs(baseZoom.current - fit.current) > 0.003 && fit.current > 0) {
      const nextFit = MathUtils.lerp(fit.current, baseZoom.current, alpha);
      if (!needsHome.current) cam.zoom *= nextFit / fit.current;
      fit.current = nextFit;
      cam.updateProjectionMatrix();
      invalidate();
    }
    const command = queued.current;
    if (command) {
      queued.current = null;
      needsHome.current = false;
      if (command === 'near' || command === 'far') {
        cam.zoom = MathUtils.clamp(cam.zoom * (command === 'near' ? 1.16 : 1 / 1.16), orbit.minZoom, orbit.maxZoom);
        cam.updateProjectionMatrix();
      } else {
        const angle = orbit.getAzimuthalAngle() + (command === 'left' ? 0.17 : command === 'right' ? -0.17 : 0);
        const polar = MathUtils.clamp(orbit.getPolarAngle() + (command === 'up' ? -0.14 : command === 'down' ? 0.14 : 0), orbit.minPolarAngle, orbit.maxPolarAngle);
        deltaPosition.setFromSphericalCoords(camera.position.distanceTo(orbit.target), polar, angle);
        camera.position.copy(orbit.target).add(deltaPosition);
      }
      orbit.update();
    }
    if (!needsHome.current) return;
    homeTarget.set(0, HOME_Y, 0.16);
    homePosition.copy(homeTarget).add(HOME_OFFSET);
    orbit.target.lerp(homeTarget, alpha);
    camera.position.lerp(homePosition, alpha);
    cam.zoom = MathUtils.lerp(cam.zoom, baseZoom.current, alpha);
    cam.updateProjectionMatrix();
    orbit.update();
    if (camera.position.distanceToSquared(homePosition) < 0.0002 && Math.abs(cam.zoom - baseZoom.current) < 0.015) {
      orbit.target.copy(homeTarget);
      camera.position.copy(homePosition);
      cam.zoom = baseZoom.current;
      cam.updateProjectionMatrix();
      orbit.update();
      needsHome.current = false;
    } else invalidate();
  });
  return (
    <OrbitControls ref={controls} domElement={gl.domElement} enablePan={false} makeDefault enableDamping={!reduced}
      autoRotate={!!spinning && !reduced} autoRotateSpeed={0.55}
      dampingFactor={0.13} rotateSpeed={0.78} zoomSpeed={0.86} minPolarAngle={0.26} maxPolarAngle={Math.PI * 0.57}
      onStart={() => { needsHome.current = false; if (!model.down) onHover(null); }}
    />
  );
}

const CUT_FACE_PATHS = FLOW_STEPS.map((step) => step.pts.map(([x, y]) => {
  const withinRoots = ((x - ROOTZONE.cx) / ROOTZONE.rx) ** 2 + ((y - ROOTZONE.cy) / ROOTZONE.ry) ** 2 < 1;
  let slab = layerAt(x, y);
  if (step.id === 'runoff') slab = 'surface';
  if (step.id === 'sewer') slab = y <= 179 ? 'surface' : 'deep';
  if (step.id === 'roots' && withinRoots) slab = 'roots';
  return { x: sx(x), y: sy(y), slab, revealAt: SLABS.length - SLABS.indexOf(slab) };
}));

function FlowPaths({ model, flowSvgRef, revealed }: Pick<SceneProps, 'flowSvgRef' | 'revealed'> & { model: ModelState }) {
  const point = useMemo(() => new Vector3(), []);
  useFrame(({ camera, size }) => {
    const svg = flowSvgRef.current;
    if (!svg) return;
    // The paths are on the front cut face, so turning the block around hides them.
    const facingCut = camera.position.z > LENGTH / 2 + 1;
    camera.updateMatrixWorld();
    for (const [index, vertices] of CUT_FACE_PATHS.entries()) {
      const group = svg.children[index] as SVGGElement;
      const visible = facingCut && vertices.every((vertex) => revealed >= vertex.revealAt);
      group.style.visibility = visible ? 'visible' : 'hidden';
      if (!visible) continue;
      const points = vertices.map(({ x, y, slab }) => {
        point.set(x, y + model.offset[slab], LENGTH / 2 + 0.07).project(camera);
        return `${((point.x + 1) * size.width / 2).toFixed(1)} ${((1 - point.y) * size.height / 2).toFixed(1)}`;
      });
      const path = 'M' + points.join(' L');
      if (group.children[0].getAttribute('d') === path) continue;
      group.children[0].setAttribute('d', path);
      group.children[1].setAttribute('d', path);
      group.children[2].setAttribute('transform', `translate(${points[Math.floor(points.length / 2)]})`);
    }
  });
  return null;
}

function Model(props: SceneProps) {
  const { invalidate } = useThree();
  const model = useMemo<ModelState>(() => ({ offset: zeroOffsets(), manual: zeroOffsets(), down: false }), []);
  useLayoutEffect(() => {
    if (!props.apart) {
      model.manual = zeroOffsets();
      model.down = false;
    }
    invalidate();
  }, [invalidate, model, props.apart]);

  return (
    <>
      <hemisphereLight args={['#d6e2f6', '#4a3c2e', 2.3]} />
      <directionalLight position={[-19, 32, 14]} intensity={2.05} color="#fff1dc" castShadow shadow-mapSize={[2048, 2048]}
        shadow-camera-left={-27} shadow-camera-right={27} shadow-camera-top={24} shadow-camera-bottom={-24}
        shadow-camera-near={2} shadow-camera-far={79} shadow-normalBias={0.034} shadow-bias={-0.00016} shadow-radius={3.5}
      />
      <directionalLight position={[19, 10, -14]} intensity={0.7} color="#6fb6ff" />
      {/* cool cyan rim, echoing the map's night palette */}
      <directionalLight position={[6, 4, -26]} intensity={0.45} color="#22e4ff" />
      <Floor model={model} />
      {SLABS.map((layer, index) => <Slab key={layer} layer={layer} index={index} model={model} {...props} />)}
      <Alignment model={model} />
      {props.raining && props.revealed === 5 && <StreetRain model={model} intensity={props.rainIntensity} reduced={props.reduced} />}
      <BlockWater model={model} raining={props.raining && props.revealed === 5} active={props.selected === 'water'} reduced={props.reduced} />
      <CameraRig {...props} model={model} />
      {props.showFlows && <FlowPaths flowSvgRef={props.flowSvgRef} revealed={props.revealed} model={model} />}
    </>
  );
}

export default function StreetScene(props: SceneProps) {
  return (
    <Canvas orthographic shadows={{ type: PCFShadowMap, autoUpdate: false, needsUpdate: true }} frameloop="demand" dpr={[1, 1.6]} camera={{ position: [22, 17, 35], near: 0.1, far: 160 }}
      gl={{ antialias: true, alpha: true }} style={{ background: 'transparent', touchAction: 'none' }}
      onCreated={() => props.onReady?.()}
      onPointerMissed={(event) => { if (event.type === 'click') props.onSelect(null); }}
      fallback={<p className="beneath__unavailable">This browser could not open the 3D view. Select a layer to read about it.</p>}
    >
      <Model {...props} />
    </Canvas>
  );
}
