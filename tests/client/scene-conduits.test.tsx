import { describe, it, expect } from 'vitest';
// instanceTranslation stays in the pure scene-data.ts, and renderer.ts places every instance by it; load-textures.ts asks
// for every block's sceneBlockRefs (plan 11, ruling R5, merge follow-ups F1 and F2)
import { loadSceneInputs, tilesFor } from '../../src/client/three/load-textures.ts';
import { solidTile, TILE } from '../../src/client/three/textures.ts';
import {
  blockKey, blockList, buildScene, hoverText, instanceTranslation, pickInfo, sceneBlockRefs, type SceneData, type SceneInstance,
} from '../../src/client/three/scene-data.ts';
import type { BlockFaces } from '../../src/shared/types/assets.ts';
import type { ConduitFace, ConduitSpec, DyeColor, Layout, LayoutBlock } from '../../src/shared/types/layout.ts';
import type { Plan } from '../../src/shared/types/plan.ts';
import { BASIC, E, ITEM, basic, bundle, bundleLayout, enderioNames } from './enderio-fixture.ts';

const faceSet = (id: string, name: string): [string, BlockFaces] => {
  const block = { id, meta: 0 };
  return [blockKey(block), { block, resolved: true, fallbackColor: [1, 2, 3],
    faces: { down: [E(name)], up: [E(name)], north: [E(name)], south: [E(name)], west: [E(name)], east: [E(name)] } }];
};
const faces = new Map([faceSet('conduit:item', 'itemConduit'), faceSet('conduit:liquid_ender', 'liquidConduitEnder'),
  faceSet('conduit:connector_background', 'itemConduitIoConnector'), faceSet('conduit:connector_in_out_in', 'itemConduitInOut_In'),
  faceSet('conduit:connector_in_out_out', 'itemConduitInOut_Out'), faceSet('conduit:connector_extract', 'itemConduitInput')]);
const plan = { names: enderioNames } as unknown as Plan;
/** The channel colours of the fixtures as the 3D view tints them: Red and Blue as the game draws them (Minecraft 1.7.10's dye colours). */
const RED = '179,49,44', BLUE = '37,49,146';
/** A tile's layers as `<texture name>[ <tint>]`, bottom first. */
const drawn = (scene: SceneData, tile: number): string[] =>
  scene.tiles[tile]!.layers.map((l) => `${l.path.replace(/^.*\/(\w+)\.png$/, '$1')}${l.tint === undefined ? '' : ` ${l.tint.join(',')}`}`);

describe('conduits in the 3D view', () => {
  it('names the conduit and connector textures a bundle needs', () => {
    // EnderIO draws every set face's plate, then the mode's arrows: In / Out has two halves, Extract and Insert one arrow
    expect(sceneBlockRefs(bundle).map((r) => r.id)).toEqual(['conduit:item', 'conduit:connector_background', 'conduit:connector_in_out_in',
      'conduit:connector_in_out_out', 'conduit:liquid_ender', 'conduit:connector_extract']);
  });
  it('asks the asset API for every conduit and connector texture of a bundle, each once', async () => {
    const asked: string[] = [];
    await loadSceneInputs({ ...bundleLayout, blocks: [bundle, { ...bundle, pos: [11, 64, 20] }] }, { blocks: async (refs) => { asked.push(...refs.map(blockKey)); return []; },
      icons: async () => [], covers: async (items) => items.map((item) => ({ item, layers: [] })), image: async () => null });
    expect(asked).toEqual(sceneBlockRefs(bundle).map(blockKey));
  });
  it('draws each conduit of a bundle side by side, with connector arms on its configured faces', () => {
    const scene = buildScene(bundleLayout, faces, new Map(), new Map());
    // as EnderIO 2.10.46 draws a set face (ItemConduitRenderer, EnderLiquidConduitRenderer): the plate, then In / Out's
    // In half in the extract side's colour and its Out half in the insert side's, or Extract's arrow in its colour
    expect(scene.instances.map((i) => [i.shape, i.side, i.offset, drawn(scene, i.tiles[2])])).toEqual([
      ['core', -1, [0, -0.1875, 0], ['itemConduit']],
      ['arm', 2, [0, -0.1875, 0], ['itemConduitIoConnector', `itemConduitInOut_In ${RED}`, `itemConduitInOut_Out ${BLUE}`]],
      ['arm', 5, [0, -0.1875, 0], ['itemConduit']],
      ['core', -1, [0, 0.1875, 0], ['liquidConduitEnder']],
      ['arm', 1, [0, 0.1875, 0], ['itemConduitIoConnector', `itemConduitInput ${RED}`]],
      ['arm', 4, [0, 0.1875, 0], ['liquidConduitEnder']]]);
    expect(scene.instances.every((i) => i.tiles.every((t) => t === i.tiles[0]))).toBe(true);   // one picture on every side
    // every conduit tile, a connector's included, is drawn over the pipe role's colour (plan 16 Task 9)
    const UNDER = 'under:255,179,0|';
    for (const i of scene.instances) {
      const { key, layers, under } = scene.tiles[i.tiles[2]]!;
      expect(key).toBe(`${UNDER}${JSON.stringify(layers)}`);
      expect(under).toEqual([255, 179, 0]);
    }
  });
  it('lists each conduit and every filter and upgrade in the block list', () => {
    expect(blockList(bundleLayout, enderioNames).place).toEqual([
      { label: 'Basic Item Filter', role: 'cover', count: 2 }, { label: 'Item Conduit Speed Upgrade', role: 'cover', count: 2 },
      { label: 'Ender Fluid Conduit', role: 'pipe', count: 1 }, { label: 'Item Conduit', role: 'pipe', count: 1 }]);
  });
  it('shows every conduit face in the click info and the hover text', () => {
    expect(pickInfo(bundleLayout, plan, 0)).toEqual({ title: 'Conduit bundle (Item Conduit + Ender Fluid Conduit)', lines: [
      'Item Conduit, north face to Basic Macerator: In / Out (2 filters, 2 speed upgrades); extract on Red with a Basic Item Filter (whitelist: Titanium Dust; match meta, ignore NBT), '
        + '2× Item Conduit Speed Upgrade, round robin off, self feed off, redstone Always active; insert on Blue with a Basic Item Filter '
        + '(whitelist: Raw Input; match meta, ignore NBT), priority 1, into its output side: keep its Input from Output Side allowed (a newly crafted '
        + 'machine has it on; a Screwdriver right-click on that side of the machine, beside the conduit, switches it)',
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
    // no faces for conduit:connector_insert here: the plate alone; and with no connector textures at all, the plain colour
    // of the face's channel (its insert side's Red)
    expect(drawn(scene, scene.instances[1]!.tiles[0])).toEqual(['itemConduitIoConnector']);
    const bare = buildScene({ ...bundleLayout, blocks: [lone] }, new Map(), new Map(), new Map());
    expect(bare.tiles[bare.instances[1]!.tiles[0]]).toEqual({ key: `color:${RED}`, layers: [], color: [179, 49, 44] });
    const linkedFace = buildScene({ ...bundleLayout, blocks: [{ ...lone, conduits: [{ ...loneConduit, connections: 4 | 16 | 32 }] }] }, faces, new Map(), new Map());
    expect(linkedFace.instances.filter((i) => i.side === 2)).toHaveLength(1);   // a set face on a linked side is still one arm
  });

  it('gives every shape of a bundle an offset of its own', () => {
    const scene = buildScene(bundleLayout, faces, new Map(), new Map());
    scene.instances[0]!.offset![1] = 9;
    expect(scene.instances[1]!.offset).toEqual([0, -0.1875, 0]);
    expect(buildScene(bundleLayout, faces, new Map(), new Map()).instances[0]!.offset).toEqual([0, -0.1875, 0]);
  });

  it("tints each arrow with its own side's channel, so two faces share an arm tile only when they draw the same", () => {
    const plain = { filter: null, rate: 1 };
    const inOut = (face: ConduitFace['face'], extract: DyeColor, insert: DyeColor): ConduitFace => ({ face, mode: 'in_out', target: 'Basic Macerator',
      extract: { ...plain, color: extract, roundRobin: false, selfFeed: false, redstone: 'ignore' }, insert: { ...plain, color: insert, priority: 1 } });
    const block: LayoutBlock = { ...lone, connections: 4 | 8 | 16 | 32, conduits: [{ ...loneConduit, connections: 0, faces: [
      inOut('north', 'red', 'blue'), inOut('south', 'red', 'blue'), inOut('west', 'blue', 'red'),
      { face: 'east', mode: 'insert', target: 'Chest (output)', insert: { ...plain, color: 'blue', priority: 0 } }] }] };
    const scene = buildScene({ ...bundleLayout, blocks: [block] }, new Map([...faces, faceSet('conduit:connector_insert', 'itemConduitOutput')]), new Map(), new Map());
    const arm = (side: number) => scene.instances.find((i) => i.shape === 'arm' && i.side === side)!.tiles[0];
    expect(arm(2)).toBe(arm(3));
    expect(drawn(scene, arm(4))).toEqual(['itemConduitIoConnector', `itemConduitInOut_In ${BLUE}`, `itemConduitInOut_Out ${RED}`]);
    expect(drawn(scene, arm(5))).toEqual(['itemConduitIoConnector', `itemConduitOutput ${BLUE}`]);
    expect(new Set([arm(2), arm(4), arm(5)]).size).toBe(3);
    // the plate is opaque, so the arm is drawn whole (the renderer drops pixels under 10 % alpha)
    expect(scene.tiles[arm(5)]!.layers[0]).toEqual(E('itemConduitIoConnector'));
  });

  it("composites an In / Out arm into an opaque plate with each half in its channel's colour", async () => {
    // synthetic textures: the plate a solid (51, 51, 51) like itemConduitIoConnector, each half a white arrow on its own
    // rows (In on row 2, Out on row 12) and transparent elsewhere, as the game's halves are mostly transparent
    const arrow = (row: number) => {
      const data = new Uint8ClampedArray(TILE * TILE * 4);
      for (let x = 4; x < 12; x++) data.set([255, 255, 255, 255], (row * TILE + x) * 4);
      return { data };
    };
    const images: Record<string, { data: Uint8ClampedArray }> = {
      itemConduitIoConnector: { data: solidTile([51, 51, 51]) }, itemConduitInOut_In: arrow(2), itemConduitInOut_Out: arrow(12),
    };
    const scene = buildScene(bundleLayout, faces, new Map(), new Map());
    const arm = scene.instances.find((i) => i.shape === 'arm' && i.side === 2)!.tiles[0];
    const tiles = await tilesFor(scene, { blocks: async () => [], icons: async () => [], covers: async () => [],
      image: async (layer) => images[layer.path.replace(/^.*\/(\w+)\.png$/, '$1')] ?? null });
    const pixel = (x: number, y: number) => [...tiles[arm]!.slice((y * TILE + x) * 4, (y * TILE + x) * 4 + 4)];
    expect([pixel(6, 2), pixel(6, 12), pixel(0, 0)]).toEqual([[179, 49, 44, 255], [37, 49, 146, 255], [51, 51, 51, 255]]);
    expect(tiles[arm]!.every((v, i) => i % 4 !== 3 || v === 255)).toBe(true);           // nothing for the renderer to discard
  });

  it('names a block without conduits by its own ref, and each connector once', () => {
    expect(sceneBlockRefs({ ...lone, conduits: undefined })).toEqual([{ id: 'conduit:item', meta: 0 }]);
    const twoInserts: LayoutBlock = { ...lone, conduits: [{ ...loneConduit, faces: [loneConduit.faces[0]!, { ...loneConduit.faces[0]!, face: 'south' }] }] };
    expect(sceneBlockRefs(twoInserts).map((r) => r.id)).toEqual(['conduit:item', 'conduit:connector_background', 'conduit:connector_insert']);
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
      'Item Conduit, north face to Chest (input): Insert (1 filter); insert on Green with a Basic Item Filter (whitelist: Raw Input; match meta, ignore NBT)',
      'Part of the logistics hookup']);
  });
});
