import { LngLatBounds, MercatorCoordinate, type CustomLayerInterface, type CustomRenderMethodInput, type Map as MLMap } from 'maplibre-gl';
import {
  BufferAttribute, BufferGeometry, Camera, DoubleSide, GLSL3, InterleavedBuffer,
  InterleavedBufferAttribute, Mesh, RawShaderMaterial, Scene, WebGLRenderer,
} from 'three';
import type { RainLevel } from '../components/RainIntensity';
import { prefersReducedMotion, STUDY_CENTER, THERWILERSTRASSE } from '../journey';
import { along, lineLengths, type LngLatTuple } from './geo';

const ORIGIN = MercatorCoordinate.fromLngLat(STUDY_CENTER);
const METRE = ORIGIN.meterInMercatorCoordinateUnits();
const LEVELS = [0.32, 0.64, 1];
const JUNCTION = THERWILERSTRASSE[2];

// Birsigstrasse centreline from the existing OSM basemap (OpenFreeMap).
// Directions, widths and pool locations illustrate runoff around the junction.
const WEST_ARM: LngLatTuple[] = [JUNCTION, [7.5754219, 47.5510898]];
const ROUTES: { line: LngLatTuple[]; width: number; feeder: boolean }[] = [
  { line: [...THERWILERSTRASSE].reverse(), width: 2.85, feeder: false },
  { line: [along(WEST_ARM, lineLengths(WEST_ARM).cum, 78), JUNCTION], width: 2.6, feeder: true },
  { line: [[7.577789, 47.5504634], JUNCTION], width: 2.4, feeder: true },
];
const STUDY_BOUNDS = new LngLatBounds([7.576, 47.5499], [7.578, 47.5515]);

const VERTEX = `
precision highp float;
in vec3 position;
in vec2 a_bank;
in vec4 a_profile; // lateral coordinate, distance along, pool, end coverage
in vec2 a_route; // normalized progress, feeder flag
uniform mat4 projectionMatrix;
uniform float u_water;
uniform float u_poolWater;
uniform float u_reveal;
out vec4 v_profile;
out vec2 v_route;

void main() {
  float pool = a_profile.z;
  float connection = a_route.y * smoothstep(0.52, 1.0, a_route.x);
  float width = mix(0.22, 0.87, u_water) + 0.09 * pool * u_poolWater + 0.04 * connection * u_reveal;
  float towardCurb = 0.25 * (1.0 - u_water) * (1.0 - pool);
  vec2 xy = position.xy + a_bank * (width + a_profile.x * towardCurb);
  gl_Position = projectionMatrix * vec4(xy, position.z, 1.0);
  v_profile = a_profile;
  v_route = a_route;
}
`;

const FRAGMENT = `
precision highp float;
in vec4 v_profile;
in vec2 v_route;
uniform float u_water;
uniform float u_poolWater;
uniform float u_reveal;
uniform float u_travel;
uniform float u_zoomFade;
uniform bool u_detail;
out vec4 fragColor;

float hash(vec2 p) {
  vec3 q = fract(vec3(p.xyx) * 0.1031);
  q += dot(q, q.yzx + 33.33);
  return fract((q.x + q.y) * q.z);
}

float noise(vec2 p) {
  vec2 cell = floor(p);
  vec2 f = fract(p);
  f = f * f * (3.0 - 2.0 * f);
  return mix(mix(hash(cell), hash(cell + vec2(1, 0)), f.x),
             mix(hash(cell + vec2(0, 1)), hash(cell + vec2(1, 1)), f.x), f.y);
}

void main() {
  float side = v_profile.x;
  float along = v_profile.y;
  float pool = v_profile.z * smoothstep(0.24, 0.91, u_poolWater);
  float localWater = max(u_water, pool * 0.75);
  float flow = along - u_travel;
  float distortion = noise(vec2(flow * 0.21, side * 3.8)) - 0.5;
  float gust = noise(vec2(flow * 0.08, side * 5.2 + along * 0.071));
  float bend = distortion * (0.54 + u_water);
  float swell = sin(flow * 1.5 + side * 4.5 + bend * 5.0);
  float fine = 0.0;
  if (u_detail) {
    float phase = (along - u_travel * 1.22) * 3.3 - side * 7.8 + bend * 5.8;
    fine = sin(phase) * (1.0 - smoothstep(0.8, 3.15, fwidth(phase)));
  }

  float lateral = abs(side + bend * mix(0.08, 0.25, u_water));
  float edge = 1.0 - smoothstep(0.61, 0.99, lateral);
  float depth = clamp(edge * (0.31 + u_water * 0.36) + pool * 0.38 + gust * 0.22, 0.0, 1.0);
  float shine = smoothstep(0.36, 0.93, swell * 0.44 + fine * 0.25 + gust * 0.52);
  float revealed = smoothstep(v_route.x * 0.73, v_route.x * 0.73 + 0.25, u_reveal);
  float streak = smoothstep(0.52, 0.88, noise(vec2(flow * 0.12, side * 8.5 + bend)));
  float confluence = v_route.y * smoothstep(0.72, 1.0, v_route.x) + pool * 0.35;

  vec3 color = mix(vec3(0.045, 0.27, 0.43), vec3(0.06, 0.49, 0.65), depth);
  color = mix(color, vec3(0.58, 0.79, 0.88), shine * (0.19 + u_water * 0.22));
  color = mix(color, vec3(0.34, 0.68, 0.79), revealed * (streak * 0.24 + confluence * 0.13));
  float alpha = edge * v_profile.w * u_zoomFade * smoothstep(0.0, 0.34, localWater)
    * (0.47 + depth * 0.31 + shine * 0.13);
  fragColor = vec4(color * alpha, alpha);
}
`;

function buildGeometry() {
  const vertices: number[] = [];
  const indices: number[] = [];
  for (const { line, width, feeder } of ROUTES) {
    const { cum, total } = lineLengths(line);
    // Include every original vertex so resampling preserves the mapped bends and junction.
    const samples = [...cum];
    for (let d = 2; d < total; d += 2) {
      if (cum.every((at) => Math.abs(at - d) > 0.2)) samples.push(d);
    }
    samples.sort((a, b) => a - b);
    const points = samples.map((d) => MercatorCoordinate.fromLngLat(along(line, cum, d)));
    const first = vertices.length / 11;
    const poolAt = feeder ? total - 6 : cum[line.indexOf(JUNCTION)];
    let flowDistance = 0;

    for (const [i, d] of samples.entries()) {
      const p = points[i];
      const before = points[Math.max(0, i - 1)];
      const after = points[Math.min(points.length - 1, i + 1)];
      const dx = after.x - before.x;
      const dy = after.y - before.y;
      const length = Math.hypot(dx, dy);
      // Pockets at the junction and along the curb grow more than the rest of the sheet.
      const pool = Math.max(
        Math.exp(-((d - poolAt) ** 2) / 60),
        feeder ? 0 : 0.64 * Math.exp(-((d - total * 0.47) ** 2) / 112),
      );
      // A stretched flow coordinate slows the moving highlights in the pockets.
      if (i > 0) flowDistance += (d - samples[i - 1]) * (1 + 0.65 * pool);
      const halfWidth = width * (0.68 + 0.32 * pool);
      const coverage = Math.min(1, d / 11, (total - d) / (feeder ? 2.4 : 14));
      const east = (p.x - ORIGIN.x) / METRE;
      const south = (p.y - ORIGIN.y) / METRE;
      for (const side of [-1, 1]) {
        vertices.push(
          east, south, 0.09,
          -side * dy / length * halfWidth, side * dx / length * halfWidth,
          side, flowDistance, pool, coverage, d / total, Number(feeder),
        );
      }
      if (i > 0) {
        const edge = first + i * 2;
        indices.push(edge - 2, edge - 1, edge, edge - 1, edge + 1, edge);
      }
    }
  }
  const buffer = new InterleavedBuffer(new Float32Array(vertices), 11);
  const geometry = new BufferGeometry();
  geometry.setAttribute('position', new InterleavedBufferAttribute(buffer, 3, 0));
  geometry.setAttribute('a_bank', new InterleavedBufferAttribute(buffer, 2, 3));
  geometry.setAttribute('a_profile', new InterleavedBufferAttribute(buffer, 4, 5));
  geometry.setAttribute('a_route', new InterleavedBufferAttribute(buffer, 2, 9));
  geometry.setIndex(new BufferAttribute(new Uint16Array(indices), 1));
  return geometry;
}

export class SurfaceWaterLayer implements CustomLayerInterface {
  readonly id = 'surface-water';
  readonly type = 'custom';
  readonly renderingMode = '3d';
  private map?: MLMap;
  private renderer?: WebGLRenderer;
  private scene = new Scene();
  private camera = new Camera();
  private mesh?: Mesh<BufferGeometry, RawShaderMaterial>;
  private uniforms = {
    u_water: { value: 0 },
    u_poolWater: { value: 0 },
    u_reveal: { value: 0 },
    u_travel: { value: 0 },
    u_zoomFade: { value: 0 },
    u_detail: { value: true },
  };
  private water = 0;
  private poolWater = 0;
  private target = 0;
  private reveal = 0;
  private revealTarget = 0;
  private travel = 0;
  private lastFrame = 0;
  private reduced = false;

  setWeather(active: boolean, intensity: RainLevel, reveal: boolean) {
    this.target = active ? LEVELS[intensity] : reveal ? LEVELS[0] : 0;
    this.revealTarget = Number(reveal);
    this.reduced = prefersReducedMotion();
    this.map?.triggerRepaint();
  }

  onAdd(map: MLMap, gl: WebGL2RenderingContext) {
    this.map = map;
    this.renderer = new WebGLRenderer({ canvas: map.getCanvas(), context: gl });
    this.renderer.autoClear = false;
    const material = new RawShaderMaterial({
      glslVersion: GLSL3,
      vertexShader: VERTEX,
      fragmentShader: FRAGMENT,
      uniforms: this.uniforms,
      transparent: true,
      premultipliedAlpha: true,
      depthWrite: false,
      side: DoubleSide,
      forceSinglePass: true,
    });
    this.mesh = new Mesh(buildGeometry(), material);
    this.mesh.frustumCulled = false;
    this.scene.add(this.mesh);
  }

  onRemove() {
    if (this.mesh) {
      this.scene.remove(this.mesh);
      this.mesh.geometry.dispose();
      this.mesh.material.dispose();
      this.mesh = undefined;
    }
    this.renderer?.dispose();
    this.renderer = undefined;
    this.map = undefined;
    this.lastFrame = 0;
  }

  render(gl: WebGL2RenderingContext, args: CustomRenderMethodInput) {
    const { renderer, map } = this;
    if (!renderer || !map || (!this.target && !this.water && !this.poolWater)) return;
    const now = performance.now();
    const dt = this.lastFrame ? Math.min((now - this.lastFrame) / 1000, 0.05) : 1 / 60;
    this.lastFrame = now;
    const response = this.target > 0 ? 2.3 : 0.9;
    this.water += (this.target - this.water) * (1 - Math.exp(-dt * response));
    if (this.reduced || Math.abs(this.water - this.target) < 0.003) this.water = this.target;
    this.poolWater += (this.target - this.poolWater) * (1 - Math.exp(-dt * (this.target > 0 ? 1.1 : 0.6)));
    if (this.reduced || Math.abs(this.poolWater - this.target) < 0.01) this.poolWater = this.target;
    this.reveal += (this.revealTarget - this.reveal) * (1 - Math.exp(-dt * 2.3));
    if (this.reduced || Math.abs(this.reveal - this.revealTarget) < 0.01) this.reveal = this.revealTarget;
    if (!this.water && !this.poolWater) {
      this.lastFrame = 0;
      return;
    }

    const zoomFade = Math.max(0, Math.min(1, (map.getZoom() - 13.6) / 2.25));
    const visible = zoomFade > 0 && map.getBounds().intersects(STUDY_BOUNDS);
    if (!this.reduced && (visible || this.water !== this.target || this.poolWater !== this.target)) map.triggerRepaint();
    if (!visible) return;
    if (!this.reduced) this.travel += dt * (2.4 + 8.5 * this.water);
    else this.travel = 0;

    // Translate in double precision before uploading so sub-metre banks stay fixed at high zoom.
    const projection = args.defaultProjectionData.mainMatrix;
    const matrix = this.camera.projectionMatrix.elements;
    for (let row = 0; row < 4; row++) {
      matrix[row] = projection[row] * METRE;
      matrix[4 + row] = projection[4 + row] * METRE;
      matrix[8 + row] = projection[8 + row] * METRE;
      matrix[12 + row] = projection[row] * ORIGIN.x + projection[4 + row] * ORIGIN.y + projection[12 + row];
    }

    this.uniforms.u_water.value = this.water;
    this.uniforms.u_poolWater.value = this.poolWater;
    this.uniforms.u_reveal.value = this.reveal;
    this.uniforms.u_travel.value = this.travel;
    this.uniforms.u_zoomFade.value = zoomFade;
    this.uniforms.u_detail.value = map.getZoom() >= 16.6 && navigator.hardwareConcurrency > 4;
    renderer.resetState();
    renderer.setViewport(0, 0, gl.drawingBufferWidth, gl.drawingBufferHeight);
    renderer.render(this.scene, this.camera);
  }
}
