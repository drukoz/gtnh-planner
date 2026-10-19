import { describe, it, expect } from 'vitest';
// instanceTranslation stays in the pure scene-data.ts, and renderer.ts places every instance by it; load-textures.ts asks
// for every block's sceneBlockRefs (plan 11, ruling R5, merge follow-ups F1 and F2)
import { loadSceneInputs } from '../../src/client/three/load-textures.ts';
import { blockKey, blockList, buildScene, hoverText, instanceTranslation, pickInfo, sceneBlockRefs, type SceneInstance } from '../../src/client/three/scene-data.ts';
import type { BlockFaces } from '../../src/shared/types/assets.ts';
import type { ConduitSpec, Layout, LayoutBlock } from '../../src/shared/types/layout.ts';
import type { Plan } from '../../src/shared/types/plan.ts';
import { BASIC, E, ITEM, basic, bundle, bundleLayout, enderioNames } from './enderio-fixture.ts';

const faceSet = (id: string, name: string): [string, BlockFaces] => {
  const block = { id, meta: 0 };
  return [blockKey(block), { block, resolved: true, fallbackColor: [1, 2, 3],
    faces: { down: [E(name)], up: [E(name)], north: [E(name)], south: [E(name)], west: [E(name)], east: [E(name)] } }];
};
const faces = new Map([faceSet('conduit:item', 'itemConduit'), faceSet('conduit:liquid_ender', 'liquidConduitEnder'),
  faceSet('conduit:connector_in_out', 'itemConduitInOut_Out'), faceSet('conduit:connector_extract', 'itemConduitInput')]);
const plan = { names: enderioNames } as unknown as Plan;

describe('conduits in the 3D view', () => {
  it('names the conduit and connector textures a bundle needs', () => {
    expect(sceneBlockRefs(bundle).map((r) => r.id)).toEqual(['conduit:item', 'conduit:connector_in_out', 'conduit:liquid_ender', 'conduit:connector_extract']);
  });
  it('asks the asset API for every conduit and connector texture of a bundle, each once', async () => {
    const asked: string[] = [];
    await loadSceneInputs({ ...bundleLayout, blocks: [bundle, { ...bundle, pos: [11, 64, 20] }] }, { blocks: async (refs) => { asked.push(...refs.map(blockKey)); return []; },
      icons: async () => [], covers: async (items) => items.map((item) => ({ item, layers: [] })), image: async () => null });
    expect(asked).toEqual(sceneBlockRefs(bundle).map(blockKey));
  });
  it('draws each conduit of a bundle side by side, with connector arms on its configured faces', () => {
    const scene = buildScene(bundleLayout, faces, new Map(), new Map());
    const UNDER = 'under:255,179,0|';   // every conduit tile is drawn over the pipe role's colour (plan 16 Task 9)
    const texture = (tile: number) => {
      const { key } = scene.tiles[tile]!;
      expect(key.startsWith(UNDER)).toBe(true);
      return (JSON.parse(key.slice(UNDER.length)) as Array<{ path: string }>)[0]!.path.replace(/^.*\/(\w+)\.png$/, '$1');
    };
    expect(scene.instances.map((i) => [i.shape, i.side, i.offset, texture(i.tiles[2])])).toEqual([
      ['core', -1, [0, -0.1875, 0], 'itemConduit'], ['arm', 2, [0, -0.1875, 0], 'itemConduitInOut_Out'], ['arm', 5, [0, -0.1875, 0], 'itemConduit'],
      ['core', -1, [0, 0.1875, 0], 'liquidConduitEnder'], ['arm', 1, [0, 0.1875, 0], 'itemConduitInput'], ['arm', 4, [0, 0.1875, 0], 'liquidConduitEnder']]);
  });
  it('lists each conduit and every filter and upgrade in the block list', () => {
    expect(blockList(bundleLayout, enderioNames).place).toEqual([
      { label: 'Basic Item Filter', role: 'cover', count: 2 }, { label: 'Item Conduit Speed Upgrade', role: 'cover', count: 2 },
      { label: 'Ender Fluid Conduit', role: 'pipe', count: 1 }, { label: 'Item Conduit', role: 'pipe', count: 1 }]);
  });
  it('shows every conduit face in the click info and the hover text', () => {
    expect(pickInfo(bundleLayout, plan, 0)).toEqual({ title: 'Conduit bundle (Item Conduit + Ender Fluid Conduit)', lines: [
      'Item Conduit, north face to Basic Macerator: In / Out; extract on Red with a Basic Item Filter (whitelist: Titanium Dust; match meta, ignore NBT), '
        + '2× Item Conduit Speed Upgrade, round robin off, self feed off, redstone Always active; insert on Blue with a Basic Item Filter '
        + '(whitelist: Raw Input; match meta, ignore NBT), priority 1',
      'Ender Fluid Conduit, top face to Basic Fluid Extractor: Extract; extract on Red with a fluid filter (whitelist: Molten Iron), round robin off, redstone Always active',
      'Ender Fluid Conduit, south face to Basic Macerator: Disabled'] });
    expect(hoverText(bundleLayout, plan, 0).startsWith('Conduit bundle (Item Conduit + Ender Fluid Conduit) — Item Conduit, north face')).toBe(true);
  });
  it('moves an offset instance off its cell centre', () => {
    const inst: SceneInstance = { block: 0, shape: 'core', pos: [1, 2, 3], side: -1, tiles: [0, 0, 0, 0, 0, 0], ghost: false };
    expect(instanceTranslation(inst)).toEqual([1.5, 2.5, 3.5]);
    expect(instanceTranslation({ ...inst, offset: [0, 0.1875, 0] })).toEqual([1.5, 2.6875, 3.5]);
  });
});

// ---- after the plan's own tests: the edges the plan leaves open ----

/** A lone Item Conduit on the spine: linked west and east, Insert into a macerator north, Disabled toward an assembler south. */
const loneConduit: ConduitSpec = { kind: 'item', item: ITEM, connections: 16 | 32, faces: [
  { face: 'north', mode: 'insert', target: 'Basic Macerator', insert: { color: 'red', filter: basic(['t:dust@0']), rate: 1, priority: 1 } },
  { face: 'south', mode: 'disabled', target: 'Advanced Assembler' }] };
const lone: LayoutBlock = { pos: [10, 64, 20], block: { id: 'conduit:item', meta: 0 }, role: 'pipe', label: 'Item Conduit', item: ITEM,
  connections: 4 | 16 | 32, conduits: [loneConduit] };

describe('conduits in the 3D view: the edges', () => {
  it('draws a lone conduit on its cell centre, with one arm per side and none toward a Disabled face', () => {
    const scene = buildScene({ ...bundleLayout, blocks: [lone] }, faces, new Map(), new Map());
    expect(scene.instances.map((i) => [i.shape, i.side, 'offset' in i])).toEqual([['core', -1, false], ['arm', 2, false], ['arm', 4, false], ['arm', 5, false]]);
    expect(instanceTranslation(scene.instances[0]!)).toEqual([0.5, 0.5, 0.5]);
    // no faces for conduit:connector_insert here (as until Plan 5's loader asks for sceneBlockRefs): the pipe's plain colour
    expect(scene.tiles[scene.instances[1]!.tiles[0]]).toEqual({ key: 'color:255,179,0', layers: [], color: [255, 179, 0] });
    const linkedFace = buildScene({ ...bundleLayout, blocks: [{ ...lone, conduits: [{ ...loneConduit, connections: 4 | 16 | 32 }] }] }, faces, new Map(), new Map());
    expect(linkedFace.instances.filter((i) => i.side === 2)).toHaveLength(1);   // a set face on a linked side is still one arm
  });

  it('gives every shape of a bundle an offset of its own', () => {
    const scene = buildScene(bundleLayout, faces, new Map(), new Map());
    scene.instances[0]!.offset![1] = 9;
    expect(scene.instances[1]!.offset).toEqual([0, -0.1875, 0]);
    expect(buildScene(bundleLayout, faces, new Map(), new Map()).instances[0]!.offset).toEqual([0, -0.1875, 0]);
  });

  it('names a block without conduits by its own ref, and each connector once', () => {
    expect(sceneBlockRefs({ ...lone, conduits: undefined })).toEqual([{ id: 'conduit:item', meta: 0 }]);
    const twoInserts: LayoutBlock = { ...lone, conduits: [{ ...loneConduit, faces: [loneConduit.faces[0]!, { ...loneConduit.faces[0]!, face: 'south' }] }] };
    expect(sceneBlockRefs(twoInserts).map((r) => r.id)).toEqual(['conduit:item', 'conduit:connector_insert']);
  });

  it('counts conduits by name across bundles, lone cells and hookup cells, and shows a hookup end face before its hookup', () => {
    const tap = { pos: [7, 64, 20] as [number, number, number], dim: 0, kind: 'pipe' as const, networkId: 'e:item:0:1' };
    const end: LayoutBlock = { pos: [8, 64, 20], block: { id: 'conduit:item', meta: 0 }, role: 'pipe', label: 'Item Conduit', item: ITEM, hookup: 0,
      connections: 4 | 32, conduits: [{ kind: 'item', item: ITEM, connections: 32, faces: [
        { face: 'north', mode: 'insert', target: 'Chest (input)', insert: { color: 'green', filter: basic(['t:in@0']), rate: 1 } }] }] };
    const run: LayoutBlock = { pos: [9, 64, 20], block: { id: 'conduit:item', meta: 0 }, role: 'pipe', label: 'Item Conduit', item: ITEM, hookup: 0, connections: 16 | 32 };
    const ghost: LayoutBlock = { ...bundle, pos: [10, 64, 21], role: 'ghost', label: 'existing Conduit bundle' };
    const hooked: Layout = { ...bundleLayout, blocks: [bundle, run, end, ghost],
      hookups: [{ kind: 'logistics', from: tap, path: [[9, 64, 20], [8, 64, 20]], parts: [] }] };
    expect(blockList(hooked, enderioNames).place).toEqual([
      { label: 'Basic Item Filter', role: 'cover', count: 3 }, { label: 'Item Conduit', role: 'pipe', count: 3 },
      { label: 'Item Conduit Speed Upgrade', role: 'cover', count: 2 }, { label: 'Ender Fluid Conduit', role: 'pipe', count: 1 }]);
    expect(blockList(hooked).place[0]!.label).toBe(BASIC);   // no name: the item key, without " cover"
    expect(pickInfo(hooked, plan, 2).lines).toEqual([
      'Item Conduit, north face to Chest (input): Insert; insert on Green with a Basic Item Filter (whitelist: Raw Input; match meta, ignore NBT)',
      'Part of the logistics hookup']);
  });
});
