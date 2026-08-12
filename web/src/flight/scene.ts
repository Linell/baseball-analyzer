// three.js rendering. All curves upload once as instanced geometry and
// animate in the vertex shader off one clock uniform — positions are never
// stepped in JS, and filtering only rewrites the per-instance visibility
// attribute. Data coords (x, y-to-mound, z-up) map to world (x, z, y).

import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { ZONE_PLANE_Y, positionAt } from './trajectory';
import { CANVAS_BG, PALETTE, type Prepared } from './data';

const SEGMENTS = 30;
const CYCLE = 8; // seconds between a pitch's re-releases, at full density
const MIN_CYCLE = 2.2; // a handful of pitches would leave dead air at CYCLE
const GOLDEN = 0.6180339887;
// Below FEW visible the scene is sparse: standing arcs, fatter endpoints. Above
// MANY it is the original mass-rendered cloud, unchanged.
const FEW = 8;
const MANY = 80;
const PRESETS = {
  // the default: a 3/4 view showing whole arcs, where head-on foreshortens
  broadcast: { position: [26, 9, -2], target: [0, 4, 28] },
  catcher: { position: [0, 2.4, -11], target: [0, 4, 30] },
  pitcher: { position: [0, 6.5, 68], target: [0, 3, 5] },
  side: { position: [24, 5, 27], target: [0, 4, 27] },
  overhead: { position: [0.01, 58, 26], target: [0, 0, 26] },
} as const;
export type PresetName = keyof typeof PRESETS;

const CURVE_VERTEX = `
attribute float aParam;
attribute vec3 aP0; attribute vec3 aV0; attribute vec3 aAcc; attribute vec3 aColor;
attribute float aT1; attribute float aRelease; attribute float aVis; attribute float aId;
uniform float uTime; uniform float uFreeze; uniform float uSelected;
uniform float uSparse; uniform float uCycle;
varying vec3 vColor; varying float vAlpha;
void main() {
  float t = aParam * aT1;
  vec3 p = aP0 + aV0 * t + 0.5 * aAcc * t * t;
  float local = mod(uTime - aRelease, uCycle);
  float head = min(local, aT1);
  float dt = head - t;
  float trail = t <= head ? exp(-dt * 4.0) : 0.0;
  float linger = 1.0 - smoothstep(aT1 + 0.2, aT1 + 1.2, local);
  float alpha = mix(trail * linger, 0.22, uFreeze);
  // Few pitches: the whole arc stands, and the comet head runs along it, so
  // the shapes stay comparable instead of blinking in and out.
  alpha = max(alpha, uSparse * 0.30);
  if (uSelected >= 0.0) {
    alpha = abs(aId - uSelected) < 0.5 ? 0.95 : alpha * 0.12;
  }
  vColor = aColor + vec3(0.5) * exp(-max(dt, 0.0) * 12.0) * (1.0 - uFreeze);
  vec4 mv = modelViewMatrix * vec4(p.x, p.z, p.y, 1.0);
  vAlpha = alpha * aVis * exp(-0.0009 * dot(mv.xyz, mv.xyz)); // depth fog
  gl_Position = projectionMatrix * mv;
}`;

const CURVE_FRAGMENT = `
varying vec3 vColor; varying float vAlpha;
void main() {
  if (vAlpha <= 0.004) discard;
  gl_FragColor = vec4(vColor * vAlpha, vAlpha);
}`;

const POINT_VERTEX = `
attribute vec3 aColor; attribute float aVis; attribute float aId;
uniform float uSelected; uniform float uSparse;
varying vec3 vColor; varying float vAlpha;
void main() {
  vColor = aColor;
  vec4 mv = modelViewMatrix * vec4(position, 1.0);
  float selected = uSelected >= 0.0 && abs(aId - uSelected) < 0.5 ? 1.0 : 0.0;
  vAlpha = aVis * mix(mix(0.55, 0.95, uSparse), 1.0, selected);
  if (uSelected >= 0.0 && selected < 0.5) vAlpha *= 0.25;
  // A lone contact point has no neighbours to read against, so it carries more
  // weight on its own; at full density these fall back to the original specks.
  float lo = mix(2.0, 5.0, uSparse);
  float hi = mix(6.0, 14.0, uSparse);
  gl_PointSize = clamp(110.0 / -mv.z, lo, hi) * (1.0 + selected);
  gl_Position = projectionMatrix * mv;
}`;

const POINT_FRAGMENT = `
varying vec3 vColor; varying float vAlpha;
void main() {
  if (vAlpha <= 0.01 || length(gl_PointCoord - 0.5) > 0.5) discard;
  gl_FragColor = vec4(vColor, vAlpha);
}`;

/** GLSL smoothstep, for the density ramp the shaders and JS both read. */
function smoothstep(edge0: number, edge1: number, x: number): number {
  const t = Math.min(Math.max((x - edge0) / (edge1 - edge0), 0), 1);
  return t * t * (3 - 2 * t);
}

/** One vertex per corner, on the ground plane, for a LineLoop. */
function flatOutline(points: Array<[number, number]>, y: number): THREE.BufferGeometry {
  const positions = points.flatMap(([x, z]) => [x, y, z]);
  return new THREE.BufferGeometry().setAttribute(
    'position',
    new THREE.Float32BufferAttribute(positions, 3),
  );
}

export interface SceneHandle {
  canvas: HTMLCanvasElement;
  setVisibility(vis: Uint8Array): void;
  setSelected(index: number | null): void;
  setPlaying(playing: boolean): void;
  setSpeed(multiplier: number): void;
  setScrub(index: number | null, t: number): void;
  setZone(top: number, bot: number): void;
  flyTo(preset: PresetName): void;
  resize(width: number, height: number): void;
  dispose(): void;
}

export function createScene(
  prepared: Prepared,
  onPick: (index: number | null) => void,
): SceneHandle {
  const { payload, flights, endT, slotByPitch, contactIndexes } = prepared;
  const n = payload.count;

  const renderer = new THREE.WebGLRenderer({ antialias: true });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
  renderer.setClearColor(new THREE.Color(CANVAS_BG));
  const scene = new THREE.Scene();
  scene.fog = new THREE.FogExp2(CANVAS_BG, 0.011); // built-in materials only
  const camera = new THREE.PerspectiveCamera(55, 16 / 9, 0.1, 500);

  const colors = PALETTE.map((hex) => new THREE.Color(hex));
  const curveGeometry = new THREE.InstancedBufferGeometry();
  const params = new Float32Array(SEGMENTS * 2);
  for (let s = 0; s < SEGMENTS; s++) {
    params[s * 2] = s / SEGMENTS;
    params[s * 2 + 1] = (s + 1) / SEGMENTS;
  }
  curveGeometry.setAttribute('position', new THREE.BufferAttribute(new Float32Array(SEGMENTS * 6), 3));
  curveGeometry.setAttribute('aParam', new THREE.BufferAttribute(params, 1));
  const p0 = new Float32Array(n * 3);
  const v0 = new Float32Array(n * 3);
  const acc = new Float32Array(n * 3);
  const color = new Float32Array(n * 3);
  const t1 = new Float32Array(n);
  const release = new Float32Array(n);
  const ids = new Float32Array(n);
  const visibility = new Float32Array(n).fill(1);
  for (let i = 0; i < n; i++) {
    const f = flights[i];
    p0.set([f.p0.x, f.p0.y, f.p0.z], i * 3);
    v0.set([f.v0.x, f.v0.y, f.v0.z], i * 3);
    acc.set([f.a.x, f.a.y, f.a.z], i * 3);
    const c = colors[slotByPitch[i]];
    color.set([c.r, c.g, c.b], i * 3);
    t1[i] = endT[i];
    release[i] = ((i * GOLDEN) % 1) * CYCLE; // restaggered per filter, see setVisibility
    ids[i] = i;
  }
  // prettier-ignore
  const perInstance: Array<[string, Float32Array, number]> = [
    ['aP0', p0, 3], ['aV0', v0, 3], ['aAcc', acc, 3], ['aColor', color, 3],
    ['aT1', t1, 1], ['aRelease', release, 1], ['aVis', visibility, 1], ['aId', ids, 1],
  ];
  for (const [name, array, size] of perInstance) {
    curveGeometry.setAttribute(name, new THREE.InstancedBufferAttribute(array, size));
  }
  curveGeometry.instanceCount = n;
  // Shared by both materials: how sparse the visible set is, 0 = the full cloud.
  const uSparse = { value: 0 };
  const uCycle = { value: CYCLE };
  // prettier-ignore
  const curveUniforms = {
    uTime: { value: 0 }, uFreeze: { value: 0 }, uSelected: { value: -1 }, uSparse, uCycle,
  };
  const curveMaterial = new THREE.ShaderMaterial({
    vertexShader: CURVE_VERTEX,
    fragmentShader: CURVE_FRAGMENT,
    uniforms: curveUniforms,
    transparent: true,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
  });
  const curves = new THREE.LineSegments(curveGeometry, curveMaterial);
  curves.frustumCulled = false; // the position attribute is a placeholder

  // Contact endpoints, raycast for selection instead of the curves.
  const m = contactIndexes.length;
  const endPositions = new Float32Array(m * 3);
  const endColors = new Float32Array(m * 3);
  const endVisibility = new Float32Array(m).fill(1);
  const endIds = new Float32Array(m);
  contactIndexes.forEach((pitchIndex, k) => {
    const p = positionAt(flights[pitchIndex], endT[pitchIndex]);
    endPositions.set([p.x, p.z, p.y], k * 3);
    endColors.set(color.subarray(pitchIndex * 3, pitchIndex * 3 + 3), k * 3);
    endIds[k] = pitchIndex;
  });
  const pointGeometry = new THREE.BufferGeometry();
  pointGeometry.setAttribute('position', new THREE.BufferAttribute(endPositions, 3));
  pointGeometry.setAttribute('aColor', new THREE.BufferAttribute(endColors, 3));
  pointGeometry.setAttribute('aVis', new THREE.BufferAttribute(endVisibility, 1));
  pointGeometry.setAttribute('aId', new THREE.BufferAttribute(endIds, 1));
  const pointUniforms = { uSelected: { value: -1 }, uSparse };
  const pointMaterial = new THREE.ShaderMaterial({
    vertexShader: POINT_VERTEX,
    fragmentShader: POINT_FRAGMENT,
    uniforms: pointUniforms,
    transparent: true,
    depthWrite: false,
  });
  const endpoints = new THREE.Points(pointGeometry, pointMaterial);

  const chrome = new THREE.LineBasicMaterial({ color: 0x6b7280, transparent: true, opacity: 0.8 });
  const zoneGeometry = flatOutline([[0, 0], [0, 0], [0, 0], [0, 0]], 0);
  const zone = new THREE.LineLoop(zoneGeometry, chrome);
  // prettier-ignore
  const plate = new THREE.LineLoop(
    flatOutline([[-0.708, 1.417], [0.708, 1.417], [0.708, 0.708], [0, 0], [-0.708, 0.708]], 0.02), chrome);
  // prettier-ignore
  const rubber = new THREE.LineLoop(
    flatOutline([[-1, 60.3], [1, 60.3], [1, 60.8], [-1, 60.8]], 0.02), chrome);
  const grid = new THREE.GridHelper(140, 28, 0x2b2f36, 0x1e2229);
  grid.position.z = 28;
  Object.assign(grid.material as THREE.Material, { transparent: true, opacity: 0.5 });
  const ball = new THREE.Mesh(
    new THREE.SphereGeometry(0.14, 16, 12),
    new THREE.MeshBasicMaterial({ color: 0xffffff }),
  );
  ball.visible = false;
  scene.add(curves, endpoints, zone, plate, rubber, grid, ball);

  const controls = new OrbitControls(camera, renderer.domElement);
  Object.assign(controls, { enableDamping: true, maxDistance: 160 });
  let flight: { position: THREE.Vector3; target: THREE.Vector3 } | null = null;
  controls.addEventListener('start', () => (flight = null));
  const applyPreset = (name: PresetName): void => {
    const p = PRESETS[name];
    flight = { position: new THREE.Vector3(...p.position), target: new THREE.Vector3(...p.target) };
  };
  camera.position.set(...PRESETS.broadcast.position);
  controls.target.set(...PRESETS.broadcast.target);

  // A click (not an orbit drag) raycasts the endpoints.
  const raycaster = new THREE.Raycaster();
  raycaster.params.Points.threshold = 0.22;
  let downAt: { x: number; y: number } | null = null;
  renderer.domElement.addEventListener('pointerdown', (e) => (downAt = { x: e.clientX, y: e.clientY }));
  renderer.domElement.addEventListener('pointerup', (event) => {
    if (!downAt || Math.hypot(event.clientX - downAt.x, event.clientY - downAt.y) > 5) return;
    const rect = renderer.domElement.getBoundingClientRect();
    const ndc = new THREE.Vector2(
      ((event.clientX - rect.left) / rect.width) * 2 - 1,
      -((event.clientY - rect.top) / rect.height) * 2 + 1,
    );
    raycaster.setFromCamera(ndc, camera);
    const visible = raycaster
      .intersectObject(endpoints)
      .filter((hit) => endVisibility[hit.index ?? 0] > 0);
    onPick(visible.length > 0 ? endIds[visible[0].index ?? 0] : null);
  });

  let playing = true;
  let speed = 1;
  let disposed = false;
  let last = performance.now();
  const animate = (): void => {
    if (disposed) return;
    requestAnimationFrame(animate);
    const now = performance.now();
    const delta = Math.min((now - last) / 1000, 0.1);
    last = now;
    if (!renderer.domElement.isConnected) return;
    if (playing) curveUniforms.uTime.value += delta * speed;
    if (flight) {
      camera.position.lerp(flight.position, 0.08);
      controls.target.lerp(flight.target, 0.08);
      if (camera.position.distanceTo(flight.position) < 0.05) flight = null;
    }
    controls.update();
    renderer.render(scene, camera);
  };
  animate();

  return {
    canvas: renderer.domElement,
    setVisibility(vis) {
      let visibleCount = 0;
      for (let i = 0; i < n; i++) {
        visibility[i] = vis[i];
        if (vis[i]) visibleCount += 1;
      }
      // Stagger over the visible set, not the whole dataset: three surviving
      // pitches keep their original offsets otherwise, and bunch into one
      // streak followed by seconds of empty canvas.
      const cycle = Math.min(CYCLE, Math.max(MIN_CYCLE, visibleCount * 0.3));
      uCycle.value = cycle;
      let rank = 0;
      for (let i = 0; i < n; i++) {
        if (vis[i]) release[i] = ((rank++ * GOLDEN) % 1) * cycle;
      }
      curveGeometry.getAttribute('aRelease').needsUpdate = true;
      uSparse.value = 1 - smoothstep(FEW, MANY, visibleCount);
      raycaster.params.Points.threshold = 0.22 + 0.3 * uSparse.value; // fatter dots, fatter target
      curveGeometry.getAttribute('aVis').needsUpdate = true;
      contactIndexes.forEach((pitchIndex, k) => {
        endVisibility[k] = vis[pitchIndex];
      });
      pointGeometry.getAttribute('aVis').needsUpdate = true;
    },
    setSelected(index) {
      curveUniforms.uSelected.value = index ?? -1;
      pointUniforms.uSelected.value = index ?? -1;
      if (index === null) ball.visible = false;
    },
    setPlaying(next) {
      playing = next;
      curveUniforms.uFreeze.value = next ? 0 : 1;
    },
    setSpeed(multiplier) {
      speed = multiplier;
    },
    setScrub(index, t) {
      ball.visible = index !== null;
      if (index !== null) {
        const p = positionAt(flights[index], Math.min(t, endT[index]));
        ball.position.set(p.x, p.z, p.y);
      }
    },
    setZone(top, bot) {
      const y = ZONE_PLANE_Y; // the measurement plane the reconstruction targets
      const attribute = zoneGeometry.getAttribute('position');
      (attribute.array as Float32Array).set([
        -0.83, bot, y, 0.83, bot, y, 0.83, top, y, -0.83, top, y,
      ]);
      attribute.needsUpdate = true;
    },
    flyTo: applyPreset,
    resize(width, height) {
      if (width < 2 || height < 2) return; // hidden/detached; keep the matrix sane
      renderer.setSize(width, height, false);
      camera.aspect = width / height;
      camera.updateProjectionMatrix();
    },
    dispose() {
      disposed = true;
      scene.traverse((object) => {
        const mesh = object as Partial<THREE.Mesh>;
        (mesh.geometry as THREE.BufferGeometry | undefined)?.dispose();
        (mesh.material as THREE.Material | undefined)?.dispose();
      });
      controls.dispose();
      renderer.dispose();
    },
  };
}
