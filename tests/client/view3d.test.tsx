import { describe, it, expect } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { View3DShell, type View3DShellProps } from '../../src/client/views/View3D.tsx';
import { PROJECT_TABS } from '../../src/client/views/project-tabs.ts';
import { VERTEX_SHADER, FRAGMENT_SHADER } from '../../src/client/three/renderer.ts';
import { loadSceneInputs, tilesFor } from '../../src/client/three/load-textures.ts';
import { buildScene, blockKey } from '../../src/client/three/scene-data.ts';
import { solidTile } from '../../src/client/three/textures.ts';
import { sampleLayout, sampleFaces, sampleIcons, sampleCovers } from './layout-fixture.ts';
// for the tests after the plan's own
import { webgl2Available } from '../../src/client/views/View3D.tsx';
import type { TextureDeps } from '../../src/client/three/load-textures.ts';
import type { BlockFaces } from '../../src/shared/types/assets.ts';
import type { Layout, LayoutBlock } from '../../src/shared/types/layout.ts';
import { CONV } from './layout-fixture.ts';

const shell = (over: Partial<View3DShellProps> = {}) => renderToStaticMarkup(<View3DShell layout={sampleLayout} loading={false} error={null} webgl
  maxLayer={null} onLayer={() => {}} show={{ ghosts: true, hookups: true }} onShow={() => {}} hover={null} info={null} canvas={<canvas />} {...over} />);

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
});
