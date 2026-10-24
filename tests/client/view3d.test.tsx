import { describe, it, expect } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { View3DShell, type View3DShellProps } from '../../src/client/views/View3D.tsx';
import { PROJECT_TABS } from '../../src/client/views/project-tabs.ts';
import { VERTEX_SHADER, FRAGMENT_SHADER, shapeGeometry } from '../../src/client/three/renderer.ts';
import { loadSceneInputs, tilesFor } from '../../src/client/three/load-textures.ts';
import { buildScene, blockKey, type SceneData } from '../../src/client/three/scene-data.ts';
import { solidTile, TILE } from '../../src/client/three/textures.ts';
import { sampleLayout, sampleFaces, sampleIcons, sampleCovers, L } from './layout-fixture.ts';
// for the tests after the plan's own
import { BoxGeometry, type BufferGeometry } from 'three';
import { webgl2Available } from '../../src/client/views/View3D.tsx';
import type { TextureDeps } from '../../src/client/three/load-textures.ts';
import { layerKey, regionRect, type BlockFaces, type Rect, type Rgb, type TextureLayer } from '../../src/shared/types/assets.ts';
import type { Layout, LayoutBlock } from '../../src/shared/types/layout.ts';
import { CONV } from './layout-fixture.ts';
// the user's requirements of 2026-10-19, item 3 (b): Show connections, remembered in this browser
import { LINKS_STORAGE_KEY, loadShowLinks, saveShowLinks } from '../../src/client/views/View3D.tsx';
import { linksNoteText } from '../../src/client/views/View3D.tsx';
// the review of f82c98c: Focus, the colour legend and the note in each mode's words
import { FOCUS_STORAGE_KEY } from '../../src/client/views/View3D.tsx';

const shell = (over: Partial<View3DShellProps> = {}) => renderToStaticMarkup(<View3DShell layout={sampleLayout} loading={false} error={null} webgl
  maxLayer={null} onLayer={() => {}} show={{ ghosts: true, hookups: true }} onShow={() => {}} hover={null} info={null} canvas={<canvas />}
  showLinks={false} onShowLinks={() => {}} {...over} />);

describe('3D tab', () => {
  it('shows the block list, the layer slider and the toggles', () => {
    const html = shell();
    for (const text of ['data-testid="block-list"', 'Basic Macerator ×1', 'Power: 1 block from pin 2', 'Size: 3×2×2', 'aria-label="Layer"', 'All layers', 'Ghosts', 'Hookups'])
      expect(html).toContain(text);
    expect(shell({ maxLayer: 0 })).toContain('Layers 1–1 of 2');
  });

  it('explains itself without WebGL2, while loading and when there is nothing to build', () => {
    expect(shell({ webgl: false })).toContain('The 3D view needs WebGL2 — the block list below still works');
    expect(shell({ layout: null, loading: true })).toContain('Laying out the line…');
    expect(shell({ layout: { ...sampleLayout, status: 'empty', blocks: [] } })).toContain('Nothing new to build');
    expect(shell({ info: { title: 'Basic Macerator', lines: ['Facing south'] } })).toContain('data-testid="view3d-info"');
    // a line whose only new machines are farms (add-on 17): no blocks to draw, and it says why rather than nothing
    const farm = { stepId: 'tgs', pos: [0, 64, 0] as [number, number, number], size: [7, 7, 7] as [number, number, number], text: 'Farm: Tree Growth Simulator' };
    const farmsOnly = shell({ layout: { ...sampleLayout, status: 'ok', blocks: [], warnings: [], reserved: [farm] } });
    expect(farmsOnly).toContain('Nothing to draw here — the new machines are farms: build each in the area its build step names');
    expect(farmsOnly).not.toContain('Nothing new to build');
    expect(shell()).not.toContain('Nothing to draw here');
  });

  it('puts the 3D tab right after the map', () => {
    // plan 11 inserts its Connections tab right after this one
    expect(PROJECT_TABS.map((t) => t.id)).toEqual(['map', '3d', 'connections', 'flow', 'materials', 'notes']);
    expect(PROJECT_TABS[1]!.label).toBe('3D');
  });

  it('writes WebGL2 shaders without GLSL3 and flips V for the array texture', () => {
    expect(FRAGMENT_SHADER).toContain('sampler2DArray');
    expect(FRAGMENT_SHADER).toContain('1.0 - vUv.y');
    expect(VERTEX_SHADER + FRAGMENT_SHADER).not.toContain('#version');
  });

  it('asks the asset API once per distinct block, cover overlay and cover icon', async () => {
    const asked = { blocks: [] as string[], icons: [] as string[], covers: [] as string[] };
    const got = await loadSceneInputs(sampleLayout, { blocks: async (refs) => { asked.blocks.push(...refs.map(blockKey)); return []; },
      icons: async (keys) => { asked.icons.push(...keys); return []; },
      covers: async (items) => { asked.covers.push(...items); return items.map((item) => ({ item, layers: [] })); }, image: async () => null });
    expect(asked.blocks.sort()).toEqual(['gregtech:gt.blockmachines@0#1246', 'gregtech:gt.blockmachines@0#2001', 'gregtech:gt.blockmachines@0#5600',
      'gregtech:gt.blockmachines@0#61', 'minecraft:stone@0']);
    expect([asked.icons, asked.covers]).toEqual([['gregtech:gt.metaitem.01@32630'], ['gregtech:gt.metaitem.01@32630']]);
    expect(got.covers.get('gregtech:gt.metaitem.01@32630')).toEqual({ item: 'gregtech:gt.metaitem.01@32630', layers: [] });
  });

  it('loads each texture once and falls back to the plain colour when an image is missing', async () => {
    const scene = buildScene(sampleLayout, sampleFaces, sampleIcons, sampleCovers);
    const asked: string[] = [];
    const tiles = await tilesFor(scene, { blocks: async () => [], icons: async () => [], covers: async () => [],
      image: async (layer) => { asked.push(layer.path); return layer.path.endsWith('front.png') ? null : { data: solidTile([10, 20, 30]) }; } });
    expect(tiles).toHaveLength(scene.tiles.length);
    expect(new Set(asked).size).toBe(asked.length);
    const front = scene.tiles.findIndex((t) => t.layers.some((l) => l.path.endsWith('front.png')));
    expect([...tiles[front]!.slice(0, 4)]).toEqual([1, 2, 3, 255]);
  });
});

describe('3D tab: the rules in detail', () => {
  const noTextures: TextureDeps = { blocks: async () => [], icons: async () => [], covers: async () => [], image: async () => null };

  it('puts the canvas in its wrapper, the slider at the top for all layers, and the hover label, details and warnings', () => {
    const warned: Layout = { ...sampleLayout, warnings: [{ code: 'no_scan', text: 'Pick a world scan and base on the Map tab to place the line' }] };
    const html = shell({ layout: warned, hover: 'Basic Macerator — programmed circuit 2', info: { title: 'Input Bus (LV)', lines: ['programmed circuit 2'] } });
    expect(html).toMatch(/data-testid="view3d-canvas"[^>]*><canvas/);
    expect(html).toMatch(/<input type="range" aria-label="Layer" min="0" max="2" step="1" value="2"\/>/);
    for (const text of ['data-testid="view3d-hover"', 'Basic Macerator — programmed circuit 2', 'Input Bus (LV)', 'Pick a world scan and base on the Map tab'])
      expect(html).toContain(text);
    expect(shell()).not.toContain('data-testid="view3d-hover"');
    expect(shell()).not.toContain('data-testid="view3d-info"');
  });

  it('keeps the block list and the warnings without WebGL2, but no canvas or controls', () => {
    const html = shell({ webgl: false });
    expect(html).toContain('data-testid="block-list"');
    expect(html).not.toContain('view3d-canvas');
    expect(html).not.toContain('aria-label="Layer"');
  });

  it('says why an empty layout is empty, and shows the error of a failed fetch', () => {
    const empty: Layout = { ...sampleLayout, status: 'empty', blocks: [] };
    expect(shell({ layout: empty, noSteps: true })).toContain('Nothing to lay out yet — the plan makes nothing');
    expect(shell({ layout: empty })).not.toContain('data-testid="block-list"');
    expect(shell({ layout: null, error: 'The server answered 500' })).toContain('The server answered 500');
  });

  it('writes the sRGB texture back as sRGB, and finds no WebGL2 without a browser', () => {
    expect(FRAGMENT_SHADER).toContain('#include <colorspace_fragment>');
    expect(webgl2Available()).toBe(false);
  });

  it('asks nothing about covers when no block has one, and a failed request empties only its own map', async () => {
    const bare: LayoutBlock[] = sampleLayout.blocks.map((b) => ({ ...b, covers: [] }));
    const asked: string[] = [];
    const deps: TextureDeps = { ...noTextures, blocks: async () => { throw new Error('offline'); },
      icons: async (keys) => { asked.push(...keys); return []; }, covers: async (items) => { asked.push(...items); return []; } };
    const none = await loadSceneInputs({ ...sampleLayout, blocks: bare }, deps);
    expect([none.faces.size, none.icons.size, none.covers.size, asked]).toEqual([0, 0, 0, []]);

    const faces = (refs: BlockFaces['block'][]): BlockFaces[] => refs.map((block) => ({ block, faces: { down: [], up: [], north: [], south: [], west: [], east: [] },
      fallbackColor: [5, 5, 5], resolved: false }));
    const partly = await loadSceneInputs(sampleLayout, { ...noTextures, blocks: async (refs) => faces(refs),
      icons: async (keys) => keys.map((key) => ({ key, layers: [], source: 'fallback', fallbackColor: [9, 9, 9] })),
      covers: () => { throw new Error('not even a promise'); } });
    expect([partly.faces.size, partly.icons.get(CONV)?.fallbackColor, partly.covers.size]).toEqual([5, [9, 9, 9], 0]);
  });

  it('never rejects: a texture that throws or has the wrong size is the plain colour, and each layer keeps its own tint', async () => {
    const scene = buildScene(sampleLayout, sampleFaces, sampleIcons, sampleCovers);
    const tiles = await tilesFor(scene, { ...noTextures, image: async (layer) => {
      if (layer.path.endsWith('/front.png')) throw new Error('does not decode');
      return layer.path.endsWith('/back.png') ? { data: new Uint8ClampedArray(4) } : { data: solidTile([200, 100, 50]) };
    } });
    const tileOf = (name: string) => tiles[scene.tiles.findIndex((t) => t.layers.some((l) => l.path.endsWith(`/${name}.png`)))]!;
    expect([tileOf('front'), tileOf('back'), tileOf('d')].map((t) => [...t.slice(0, 4)])).toEqual([[1, 2, 3, 255], [1, 2, 3, 255], [200, 100, 50, 255]]);

    const tinted = { ...scene, tiles: [{ key: 'k', layers: [{ path: 'x/a.png', tint: [255, 0, 0] as [number, number, number] }], color: [0, 0, 0] as [number, number, number] }] };
    const [red] = await tilesFor(tinted, { ...noTextures, image: async () => ({ data: solidTile([200, 100, 50]) }) });
    expect([...red!.slice(0, 4)]).toEqual([200, 0, 0, 255]);
  });

  it('asks for each crop of a sheet once, and never shares one crop\'s image with another', async () => {
    const crop = (side: number): TextureLayer => ({ path: 'ic2/textures/blocks/blockRubWood.png', region: { sheet: 96, src: [16 * side, 0, 16, 16] } });
    const scene = buildScene(sampleLayout, sampleFaces, sampleIcons, sampleCovers);
    const strip = { ...scene, tiles: [{ key: 'a', layers: [crop(0), crop(2)], color: [0, 0, 0] as [number, number, number] },
      { key: 'b', layers: [crop(0)], color: [0, 0, 0] as [number, number, number] }] };
    const asked: TextureLayer[] = [];
    await tilesFor(strip, { ...noTextures, image: async (layer) => { asked.push(layer); return { data: solidTile([200, 100, 50]) }; } });
    expect(asked).toEqual([crop(0), crop(2)]);
  });

  // Plan 16 Task 9 (architecture §11.43 (c)): pipe tiles over their role's colour, and u along an arm.
  it('draws a tile over its under colour, and the plain colour when nothing loads', async () => {
    const scene: SceneData = { tiles: [{ key: 'fallback', layers: [], color: [128, 128, 128] }, { key: 'k', layers: [L('x')], color: [1, 2, 3], under: [10, 20, 30] }], instances: [], size: [1, 1, 1] };
    const dot = new Uint8ClampedArray(TILE * TILE * 4);
    dot.set([200, 0, 0, 255], 0);
    const [, drawn] = await tilesFor(scene, { ...noTextures, image: async () => ({ data: dot }) });
    expect([...drawn!.slice(0, 8)]).toEqual([200, 0, 0, 255, 10, 20, 30, 255]);
    const [, none] = await tilesFor(scene, { ...noTextures, image: async () => null });
    expect(none).toEqual(solidTile([1, 2, 3]));
  });

  it("runs u along an arm on all four of its long faces", () => {
    const g = shapeGeometry('arm');
    const pos = g.getAttribute('position'), uv = g.getAttribute('uv');
    for (const face of [0, 1, 2, 3]) {                     // +x, −x, +y, −y: the long faces of an arm built along −z
      const uAtZ = new Map<number, number>();
      for (let i = face * 4; i < face * 4 + 4; i++) {
        const z = pos.getZ(i), u = uv.getX(i);
        if (uAtZ.has(z)) expect(u).toBe(uAtZ.get(z)); else uAtZ.set(z, u);
      }
      expect(new Set(uAtZ.values()).size).toBe(2);
    }
  });

  // Plan 16 Task 10, RC10's 3D check: a chest face is three crops of one model sheet (Task 4's table), drawn at their places.
  describe('a chest', () => {
    const N = 'minecraft/textures/entity/chest/normal.png';
    const r = (src: Rect, dst: Rect): TextureLayer => ({ path: N, region: { sheet: 64, src, dst } });
    const CHEST = { id: 'minecraft:chest', meta: 0 };
    const chestFaces: BlockFaces = { block: CHEST, resolved: true, fallbackColor: [160, 110, 50], faces: {
      down: [r([28, 19, 14, 14], [1, 1, 14, 14])],
      up: [r([14, 0, 14, 14], [1, 1, 14, 14])],
      north: [r([14, 33, 14, 10], [1, 6, 14, 10]), r([14, 14, 14, 5], [1, 2, 14, 5]), r([1, 1, 2, 4], [7, 5, 2, 4])],
      south: [r([42, 33, 14, 10], [1, 6, 14, 10]), r([42, 14, 14, 5], [1, 2, 14, 5])],
      west: [r([28, 33, 14, 10], [1, 6, 14, 10]), r([28, 14, 14, 5], [1, 2, 14, 5])],
      east: [r([0, 33, 14, 10], [1, 6, 14, 10]), r([0, 14, 14, 5], [1, 2, 14, 5])],
    } };
    const chestLayout: Layout = { ...sampleLayout, size: [1, 1, 1], hookups: [], pins: [],
      blocks: [{ pos: [10, 64, 20], block: CHEST, role: 'chest', label: 'Chest', facing: 2 }] };
    const scene = buildScene(chestLayout, new Map([[blockKey(CHEST), chestFaces]]), new Map(), new Map());
    /** A TILE × TILE image of `rgb` inside `rect` and transparent elsewhere: what `layerPixels` draws for a region layer. */
    const rectImage = ([x, y, w, h]: Rect, rgb: Rgb): Uint8ClampedArray => {
      const data = new Uint8ClampedArray(TILE * TILE * 4);
      for (let row = y; row < y + h; row++) for (let col = x; col < x + w; col++) data.set([...rgb, 255], (row * TILE + col) * 4);
      return data;
    };

    it('composes a chest face from its three crops of one sheet', async () => {
      const color = (l: TextureLayer): Rgb => (l.region!.src[0] === 1 ? [255, 0, 0] : l.region!.src[1] < 19 ? [120, 80, 40] : [60, 40, 20]);   // knob, lid, base
      const asked: string[] = [];
      const tiles = await tilesFor(scene, { ...noTextures, image: async (l) => { asked.push(layerKey(l)); return { data: rectImage(regionRect(l, TILE), color(l)) }; } });
      expect(new Set(asked).size).toBe(11);
      expect(asked).toHaveLength(11);                                           // each crop loaded once
      const north = tiles[scene.instances[0]!.tiles[2]]!;
      const px = (x: number, y: number) => [...north.slice((y * TILE + x) * 4, (y * TILE + x) * 4 + 4)];
      expect([px(7, 6), px(3, 3), px(3, 12)]).toEqual([[255, 0, 0, 255], [120, 80, 40, 255], [60, 40, 20, 255]]);   // knob over lid over base
      expect(px(0, 0)[3]).toBe(0);                                              // outside the chest: transparent, so the shader drops it
    });

    // ---- after the plan's own tests: the edges the plan leaves open ----

    it('draws each side of a chest facing north from that side\'s crops, with no colour under them', () => {
      const [inst] = scene.instances;
      expect([scene.instances.length, inst!.shape]).toEqual([1, 'cube']);
      const { down, up, north, south, west, east } = chestFaces.faces;
      expect(inst!.tiles.map((t) => scene.tiles[t]!.layers)).toEqual([down, up, north, south, west, east]);
      expect(inst!.tiles.map((t) => scene.tiles[t]!.under)).toEqual(Array(6).fill(undefined));   // the border round the chest stays see-through
    });
  });

  // ---- after the plan's own tests: the edges the plan leaves open ----

  it('draws the layers that load over the under colour, and the plain colour for an image of another size', async () => {
    const scene: SceneData = { tiles: [{ key: 'fallback', layers: [], color: [128, 128, 128] }, { key: 'k', layers: [L('a'), L('b')], color: [1, 2, 3], under: [10, 20, 30] }], instances: [], size: [1, 1, 1] };
    const dot = new Uint8ClampedArray(TILE * TILE * 4);
    dot.set([200, 0, 0, 255], 0);
    const [, half] = await tilesFor(scene, { ...noTextures, image: async (l) => (l.path.endsWith('/a.png') ? { data: dot } : null) });
    expect([...half!.slice(0, 8)]).toEqual([200, 0, 0, 255, 10, 20, 30, 255]);
    const [, odd] = await tilesFor(scene, { ...noTextures, image: async () => ({ data: new Uint8ClampedArray(4) }) });
    expect(odd).toEqual(solidTile([1, 2, 3]));
  });

  it("keeps three's UVs on the cube, the core, the plate, the connector box and an arm's ±x faces and ends", () => {
    const uvs = (g: BufferGeometry): number[] => [...g.getAttribute('uv').array];
    const box = uvs(new BoxGeometry(1, 1, 1));               // 2 numbers per vertex, 4 vertices per face: faces 0–1 are 0–15, faces 4–5 are 32–47
    for (const shape of ['cube', 'core', 'plate', 'hub'] as const) expect(uvs(shapeGeometry(shape))).toEqual(box);
    const arm = uvs(shapeGeometry('arm'));
    expect([...arm.slice(0, 16), ...arm.slice(32)]).toEqual([...box.slice(0, 16), ...box.slice(32)]);
    expect(arm.slice(16, 32)).not.toEqual(box.slice(16, 32));
  });
});

// The user's requirements of 2026-10-19, item 3 (b): the Connections tab's links drawn in the 3D view on request.
describe('3D tab: Show connections', () => {
  it('shows the Show connections toggle beside the others, off unless asked, and what the links mean while it is on', () => {
    const off = shell();
    expect(off).toMatch(/Hookups<\/label><label class="check"><input type="checkbox"\/>Show connections<\/label>/);
    expect(off).not.toContain('data-testid="view3d-links"');
    const on = shell({ showLinks: true, linksNote: '3 connections drawn' });
    expect(on).toMatch(/<input type="checkbox" checked=""\/>Show connections/);
    expect(on).toMatch(/<p data-testid="view3d-links" class="muted small"[^>]*>3 connections drawn<\/p>/);
    // no toggle without a canvas to draw on
    expect(shell({ webgl: false, showLinks: true, linksNote: '3 connections drawn' })).not.toContain('Show connections');
  });

  it('remembers the toggle in this browser, and stays off when storage is refused or holds something else', () => {
    const store = new Map<string, string>();
    const was = Object.getOwnPropertyDescriptor(globalThis, 'localStorage');
    const use = (storage: unknown) => Object.defineProperty(globalThis, 'localStorage', { value: storage, configurable: true, writable: true });
    try {
      use({ getItem: (k: string) => store.get(k) ?? null, setItem: (k: string, v: string) => { store.set(k, v); } });
      expect(loadShowLinks()).toBe(false);
      saveShowLinks(true);
      expect([store.get(LINKS_STORAGE_KEY), loadShowLinks()]).toEqual(['1', true]);
      saveShowLinks(false);
      expect(loadShowLinks()).toBe(false);
      store.set(LINKS_STORAGE_KEY, 'yes');
      expect(loadShowLinks()).toBe(false);
      use({ getItem: () => { throw new Error('refused'); }, setItem: () => { throw new Error('refused'); } });
      expect(loadShowLinks()).toBe(false);
      expect(() => saveShowLinks(true)).not.toThrow();
    } finally {
      if (was === undefined) delete (globalThis as { localStorage?: unknown }).localStorage;
      else Object.defineProperty(globalThis, 'localStorage', was);
    }
    expect(LINKS_STORAGE_KEY).toBe('gtnh-planner:3d-connections');
  });

  // the review of f9fe23e: the note counts links, not only the pieces they are drawn in, and names what it leaves out;
  // the review of f82c98c: in each mode's words, with what it hides with the hookups or leaves out of big steps
  it('says how many pieces of how many links it draws, and names the links it has nowhere to draw', () => {
    const none = { more: 0, hidden: 0, unplaced: [], noNetwork: [] };
    expect(linksNoteText(null)).toBe('Nothing to connect yet: the plan has no line to lay out');
    expect(linksNoteText({ ...none, pieces: 0, links: 0 })).toBe('No connections to draw');
    expect(linksNoteText({ ...none, pieces: 4, links: 4 })).toMatch(/^4 connections drawn, each from the face that gives to the face that takes/);
    expect(linksNoteText({ ...none, pieces: 1, links: 1 })).toMatch(/^1 connection drawn, /);
    expect(linksNoteText({ ...none, pieces: 6, links: 4 })).toMatch(/^6 pieces of 4 connections drawn, .*click it to mark its two faces\.$/);
    expect(linksNoteText({ ...none, pieces: 5, links: 5, unplaced: ['A → B'] }))
      .toMatch(/^5 connections drawn, .*\. Not drawn, with nowhere in the line to draw it: A → B\.$/);
    expect(linksNoteText({ ...none, pieces: 0, links: 0, unplaced: ['A → B', 'C → D', 'E → F', 'G → H', 'I → J'] }))
      .toBe('No connections to draw. Not drawn, with nowhere in the line to draw them: A → B; C → D; E → F; and 2 more.');
  });

  it("says what the links' colours mean in each mode's words, and what it hides, leaves out or cannot draw", () => {
    const none = { pieces: 4, links: 3, more: 0, hidden: 0, unplaced: [], noNetwork: [] };
    const how = (mode: 'enderio' | 'direct' | 'routed' | 'ae2', byGood: 'red' | null = null, focus = false) => ({ mode, byGood, focus });
    expect(linksNoteText(none, how('enderio'))).toContain("Each is in its EnderIO channel's colour, as on the Connections tab.");
    expect(linksNoteText(none, how('enderio', 'red'))).toContain('Every flow rides the Red channel, so each good has a colour of its own; hovering a link names its good and channel.');
    for (const mode of ['direct', 'routed', 'ae2'] as const) {
      expect(linksNoteText(none, how(mode))).toContain('Each is in the colour of what carries it, as on the Connections tab.');
      expect(linksNoteText(none, how(mode))).not.toContain('EnderIO');
    }
    expect(linksNoteText(none, how('direct'))).not.toContain('Focus');
    expect(linksNoteText(none, how('direct', null, true))).toContain('Focus shows only the links of the block under the pointer, or of the block you click.');
    // the pieces of links between big steps left out, the links hidden with the hookups
    expect(linksNoteText({ ...none, more: 33 }, how('direct'))).toMatch(/ Links between big steps are drawn with at most 8 pieces each: 33 more pieces are not drawn\.$/);
    expect(linksNoteText({ ...none, hidden: 28 }, how('ae2'))).toMatch(/ 28 more connections are hidden with the hookups\.$/);
    expect(linksNoteText({ ...none, hidden: 1 }, how('ae2'))).toMatch(/ 1 more connection is hidden with the hookups\.$/);
    // an AE2 line whose base has no ME network: its raw inputs and final outputs, with the reason
    expect(linksNoteText({ ...none, noNetwork: ['Iron 1/min: Raw inputs → 1× Macerator'] }, how('ae2')))
      .toMatch(/ Raw inputs and final outputs are not drawn, as the base has no ME network to hook into: Iron 1\/min: Raw inputs → 1× Macerator\.$/);
  });

  it('offers Focus beside Show connections while the links show, remembered like it, and shows their colour legend', () => {
    const legend = [{ rgb: [156, 204, 101] as [number, number, number], label: 'Shared GT item pipe' }, { rgb: [30, 136, 229] as [number, number, number], label: 'GT fluid pipe' }];
    const on = shell({ showLinks: true, linksNote: '3 connections drawn', linksLegend: legend, focus: false, onFocus: () => {} });
    expect(on).toMatch(/Show connections<\/label><label class="check" title="[^"]+"><input type="checkbox"\/>Focus<\/label>/);
    expect(on).toContain('data-testid="view3d-links-legend"');
    expect(on).toMatch(/<li><span aria-hidden="true" style="[^"]*background:rgb\(156, 204, 101\)[^"]*"><\/span>Shared GT item pipe<\/li>/);
    expect(on).toContain('GT fluid pipe');
    expect(shell({ showLinks: true, linksNote: 'x', linksLegend: legend, focus: true, onFocus: () => {} })).toMatch(/<input type="checkbox" checked=""\/>Focus/);
    // neither while the links are off
    const off = shell({ showLinks: false, linksLegend: legend, focus: true, onFocus: () => {} });
    expect([off.includes('Focus'), off.includes('view3d-links-legend')]).toEqual([false, false]);
    expect(FOCUS_STORAGE_KEY).toBe('gtnh-planner:3d-connections-focus');
    const store = new Map<string, string>();
    const was = Object.getOwnPropertyDescriptor(globalThis, 'localStorage');
    Object.defineProperty(globalThis, 'localStorage', { value: { getItem: (k: string) => store.get(k) ?? null, setItem: (k: string, v: string) => { store.set(k, v); } },
      configurable: true, writable: true });
    try {
      saveShowLinks(true, FOCUS_STORAGE_KEY);
      expect([store.get(FOCUS_STORAGE_KEY), loadShowLinks(FOCUS_STORAGE_KEY), loadShowLinks()]).toEqual(['1', true, false]);
    } finally {
      if (was === undefined) delete (globalThis as { localStorage?: unknown }).localStorage;
      else Object.defineProperty(globalThis, 'localStorage', was);
    }
  });
});
