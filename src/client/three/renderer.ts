// The three.js viewer of the 3D tab (Plan 5 Task 15; spec §3.8, web-stack §8): the scene's tiles as the layers of one
// DataArrayTexture, one InstancedMesh per shape, ghost and hookup group, a ShaderMaterial that picks each face's tile
// from per-instance attributes (never `glslVersion: GLSL3`: three already compiles a ShaderMaterial as GLSL ES 3.00
// under WebGL2), orbit controls around the line's box, the layer slider as a uniform and picking by raycast. It draws
// only when something changes — the camera, a toggle, the slider, the size — because the host also runs the game.
//
// The texture is sRGB, so sampling it gives linear colour; the fragment shader ends with three's colorspace_fragment,
// which writes it back as sRGB as web-stack §8's probe did — without it every texture shows far too dark (a tile of
// [128, 64, 200] was drawn as [55, 13, 147]).

import {
  BoxGeometry, DataArrayTexture, InstancedBufferAttribute, InstancedMesh, Matrix4, NearestFilter, PerspectiveCamera, Raycaster,
  SRGBColorSpace, Scene, ShaderMaterial, Vector2, WebGLRenderer, type BufferGeometry, type Object3D,
} from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import type { Layout } from '../../shared/types/layout.ts';
import { visible, type SceneData, type SceneInstance, type ShapeKind } from './scene-data.ts';
import { packTiles, solidTile, TILE } from './textures.ts';

export const VERTEX_SHADER = `
attribute vec3 aTiles0; attribute vec3 aTiles1; attribute float aLayer;
varying vec2 vUv; flat varying float vTile; varying float vShade; varying float vLayer;
void main() {
  vec3 n = normalize(mat3(instanceMatrix) * normal);
  if (n.y < -0.5) { vTile = aTiles0.x; vShade = 0.5; } else if (n.y > 0.5) { vTile = aTiles0.y; vShade = 1.0; }
  else if (n.z < -0.5) { vTile = aTiles0.z; vShade = 0.8; } else if (n.z > 0.5) { vTile = aTiles1.x; vShade = 0.8; }
  else if (n.x < -0.5) { vTile = aTiles1.y; vShade = 0.6; } else { vTile = aTiles1.z; vShade = 0.6; }
  vUv = uv; vLayer = aLayer;
  gl_Position = projectionMatrix * modelViewMatrix * instanceMatrix * vec4(position, 1.0);
}`;
export const FRAGMENT_SHADER = `
precision highp sampler2DArray;
uniform sampler2DArray uTex; uniform float uMaxLayer; uniform float uAlpha;
varying vec2 vUv; flat varying float vTile; varying float vShade; varying float vLayer;
void main() {
  if (vLayer > uMaxLayer + 0.5) discard;
  vec4 c = texture(uTex, vec3(vUv.x, 1.0 - vUv.y, vTile));
  if (c.a < 0.1) discard;
  gl_FragColor = vec4(c.rgb * vShade, uAlpha);
  #include <colorspace_fragment>
}`;

export interface Viewer {
  /** Shows layers 0 … `n` only; `null` shows all. */
  setMaxLayer(n: number | null): void;
  setShow(show: { ghosts: boolean; hookups: boolean }): void;
  /** The index into `layout.blocks` of the block drawn under the pointer (a cover plate names its host), else null. */
  pick(clientX: number, clientY: number): number | null;
  /** Fits the drawing buffer and the camera to the canvas's CSS size, and draws. */
  resize(): void;
  render(): void;
  /** Frees the GPU resources and the controls; the viewer does nothing afterwards. */
  dispose(): void;
}

/** One pixel of a 16 px block texture, in blocks. */
const PX = 1 / 16;
/** `uMaxLayer` while every layer shows. */
const ALL_LAYERS = 1e9;
const GHOST_ALPHA = 0.3;
/** Every WebGL2 GPU has at least this many array texture layers (ES 3.0 `GL_MAX_ARRAY_TEXTURE_LAYERS`). */
const MIN_ARRAY_LAYERS = 256;
/** The texture of a scene without tiles: the fallback tile's grey. */
const NO_TILES: readonly Uint8ClampedArray[] = [solidTile([128, 128, 128])];

/** Arms and plates are built pointing north (−z) and turned to their side, in ForgeDirection order. */
const SIDE_TURNS: readonly Matrix4[] = [
  new Matrix4().makeRotationX(-Math.PI / 2),   // down
  new Matrix4().makeRotationX(Math.PI / 2),    // up
  new Matrix4(),                               // north
  new Matrix4().makeRotationY(Math.PI),        // south
  new Matrix4().makeRotationY(Math.PI / 2),    // west
  new Matrix4().makeRotationY(-Math.PI / 2),   // east
];

/** The shape around its cell's centre: an arm reaches from the core to the north face, a plate lies just outside it. */
function shapeGeometry(shape: ShapeKind): BufferGeometry {
  switch (shape) {
    case 'cube': return new BoxGeometry(1, 1, 1);
    case 'core': return new BoxGeometry(6 * PX, 6 * PX, 6 * PX);
    case 'arm': return new BoxGeometry(6 * PX, 6 * PX, 5 * PX).translate(0, 0, -(3 + 2.5) * PX);
    case 'plate': return new BoxGeometry(14 * PX, 14 * PX, PX).translate(0, 0, -(8 + 0.5) * PX);
  }
}

/** The instances one mesh draws: one shape, ghosts or not, blocks of a hookup or not. */
interface Group { shape: ShapeKind; ghost: boolean; hookup: boolean; instances: SceneInstance[] }

function groupsOf(scene: SceneData, layout: Layout): Group[] {
  const groups = new Map<string, Group>();
  for (const inst of scene.instances) {
    const hookup = layout.blocks[inst.block]?.hookup !== undefined;
    const key = `${inst.shape}|${inst.ghost}|${hookup}`;
    const group = groups.get(key);
    if (group === undefined) groups.set(key, { shape: inst.shape, ghost: inst.ghost, hookup, instances: [inst] });
    else group.instances.push(inst);
  }
  return [...groups.values()];
}

/**
 * The group's mesh: each instance at its cell (an arm or plate turned to its side) with its six tiles in `aTiles0`
 * (down, up, north) and `aTiles1` (south, west, east) — a tile without an array layer drawn as tile 0 — and its layer
 * (y relative to the origin) in `aLayer`.
 */
function meshOf(group: Group, material: ShaderMaterial, layerCount: number): InstancedMesh {
  const geometry = shapeGeometry(group.shape);
  const n = group.instances.length;
  const tiles0 = new Float32Array(n * 3);
  const tiles1 = new Float32Array(n * 3);
  const layers = new Float32Array(n);
  const mesh = new InstancedMesh(geometry, material, n);
  const at = new Matrix4();
  group.instances.forEach((inst, i) => {
    const [down, up, north, south, west, east] = inst.tiles.map((tile) => (tile < layerCount ? tile : 0));
    tiles0.set([down!, up!, north!], i * 3);
    tiles1.set([south!, west!, east!], i * 3);
    layers[i] = inst.pos[1];
    at.makeTranslation(inst.pos[0] + 0.5, inst.pos[1] + 0.5, inst.pos[2] + 0.5);
    const turn = SIDE_TURNS[inst.side];
    if (turn !== undefined) at.multiply(turn);
    mesh.setMatrixAt(i, at);
  });
  geometry.setAttribute('aTiles0', new InstancedBufferAttribute(tiles0, 3));
  geometry.setAttribute('aTiles1', new InstancedBufferAttribute(tiles1, 3));
  geometry.setAttribute('aLayer', new InstancedBufferAttribute(layers, 1));
  mesh.instanceMatrix.needsUpdate = true;
  return mesh;
}

/** GL_MAX_ARRAY_TEXTURE_LAYERS of the renderer's GPU (three r186 runs on WebGL2 only). */
function maxArrayLayers(renderer: WebGLRenderer): number {
  const gl = renderer.getContext() as WebGL2RenderingContext;
  const layers: unknown = gl.getParameter(gl.MAX_ARRAY_TEXTURE_LAYERS);
  return typeof layers === 'number' && layers > 0 ? layers : MIN_ARRAY_LAYERS;
}

/**
 * Draws `scene` (the blocks of `layout`; `tiles[i]` holds the pixels of `scene.tiles[i]`) on `canvas`. The camera looks
 * at the centre of the line's box from `d = 1.4 × max(W, H, L)` along every axis; drag, wheel and right-drag orbit, zoom
 * and pan around it. `preserveDrawingBuffer` is for tests that read the pixels back.
 */
export function createViewer(
  canvas: HTMLCanvasElement, layout: Layout, scene: SceneData, tiles: readonly Uint8ClampedArray[], opts?: { preserveDrawingBuffer?: boolean },
): Viewer {
  const renderer = new WebGLRenderer({ canvas, antialias: false, alpha: true, preserveDrawingBuffer: opts?.preserveDrawingBuffer ?? false });
  const layerCount = Math.min(tiles.length, maxArrayLayers(renderer));
  const packed = layerCount > 0 ? tiles.slice(0, layerCount) : NO_TILES;
  const texture = new DataArrayTexture(packTiles(packed), TILE, TILE, packed.length);
  texture.magFilter = NearestFilter;
  texture.minFilter = NearestFilter;
  texture.generateMipmaps = false;
  texture.colorSpace = SRGBColorSpace;
  texture.needsUpdate = true;

  // Both materials read the same texture and slider value.
  const uTex = { value: texture };
  const uMaxLayer = { value: ALL_LAYERS };
  const solid = new ShaderMaterial({ vertexShader: VERTEX_SHADER, fragmentShader: FRAGMENT_SHADER, uniforms: { uTex, uMaxLayer, uAlpha: { value: 1 } } });
  const faint = new ShaderMaterial({
    vertexShader: VERTEX_SHADER, fragmentShader: FRAGMENT_SHADER, uniforms: { uTex, uMaxLayer, uAlpha: { value: GHOST_ALPHA } },
    transparent: true, depthWrite: false,
  });

  const scene3 = new Scene();
  const meshes = groupsOf(scene, layout).map((group) => ({ group, mesh: meshOf(group, group.ghost ? faint : solid, layerCount) }));
  for (const { mesh } of meshes) scene3.add(mesh);
  const groupOf = new Map<Object3D, Group>(meshes.map(({ group, mesh }) => [mesh, group]));

  const [w, h, l] = scene.size;
  const d = 1.4 * Math.max(w, h, l, 1);
  const camera = new PerspectiveCamera(45, 1, 0.1, Math.max(1000, 10 * d));
  camera.position.set(w / 2 + d, h / 2 + d, l / 2 + d);
  const controls = new OrbitControls(camera, canvas);
  controls.target.set(w / 2, h / 2, l / 2);
  controls.maxDistance = camera.far / 2;   // zoomed all the way out, the far plane still holds the line and its hookups
  controls.update();

  let maxLayer: number | null = null;
  let show = { ghosts: true, hookups: true };
  let disposed = false;
  const raycaster = new Raycaster();
  const pointer = new Vector2();

  const render = (): void => {
    if (!disposed) renderer.render(scene3, camera);
  };
  controls.addEventListener('change', render);

  const viewer: Viewer = {
    setMaxLayer(n) {
      maxLayer = n;
      uMaxLayer.value = n ?? ALL_LAYERS;
      render();
    },
    setShow(next) {
      show = { ghosts: next.ghosts, hookups: next.hookups };
      for (const { group, mesh } of meshes) mesh.visible = (!group.ghost || show.ghosts) && (!group.hookup || show.hookups);
      render();
    },
    pick(clientX, clientY) {
      if (disposed) return null;
      const rect = canvas.getBoundingClientRect();
      if (rect.width === 0 || rect.height === 0) return null;
      pointer.set(((clientX - rect.left) / rect.width) * 2 - 1, 1 - ((clientY - rect.top) / rect.height) * 2);
      raycaster.setFromCamera(pointer, camera);   // returns void in r186
      const shown = meshes.filter(({ mesh }) => mesh.visible).map(({ mesh }) => mesh);
      for (const hit of raycaster.intersectObjects(shown, false)) {
        const inst = hit.instanceId === undefined ? undefined : groupOf.get(hit.object)?.instances[hit.instanceId];
        if (inst !== undefined && visible(inst, maxLayer, show, layout)) return inst.block;   // the nearest one still drawn
      }
      return null;
    },
    resize() {
      const width = canvas.clientWidth;
      const height = canvas.clientHeight;
      if (disposed || width === 0 || height === 0) return;   // a hidden canvas keeps its last size
      renderer.setPixelRatio(globalThis.devicePixelRatio || 1);
      renderer.setSize(width, height, false);
      camera.aspect = width / height;
      camera.updateProjectionMatrix();
      render();
    },
    render,
    dispose() {
      if (disposed) return;
      disposed = true;
      controls.removeEventListener('change', render);
      controls.dispose();
      for (const { mesh } of meshes) {
        mesh.dispose();
        mesh.geometry.dispose();
      }
      solid.dispose();
      faint.dispose();
      texture.dispose();
      renderer.dispose();
      // A canvas that has left the page (the tab was closed) is never drawn on again: its WebGL context goes now, not at
      // garbage collection, or a few tab switches leave Chrome with too many contexts. A canvas still on the page (a new
      // layout) keeps it for the next viewer.
      if (!canvas.isConnected) renderer.forceContextLoss();
    },
  };
  viewer.resize();
  return viewer;
}
