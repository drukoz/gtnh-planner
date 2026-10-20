import { describe, it, expect } from 'vitest';
// instanceTranslation stays in the pure scene-data.ts, and renderer.ts places every instance by it; load-textures.ts asks
// for every block's sceneBlockRefs (plan 11, ruling R5, merge follow-ups F1 and F2)
import { loadSceneInputs, tilesFor } from '../../src/client/three/load-textures.ts';
import { solidTile, TILE } from '../../src/client/three/textures.ts';
import {
  blockKey, blockList, buildScene, hoverText, instanceTranslation, pickInfo, sceneBlockRefs, type SceneData, type SceneInstance,
} from '../../src/client/three/scene-data.ts';
import { FACES, type BlockFaces } from '../../src/shared/types/assets.ts';
import type { ConduitFace, ConduitSpec, DyeColor, Layout, LayoutBlock } from '../../src/shared/types/layout.ts';
import type { Plan } from '../../src/shared/types/plan.ts';
import { BASIC, E, ENDER, ITEM, basic, bundle, bundleLayout, enderioNames } from './enderio-fixture.ts';
// for the tests after the plan's own: every connection drawn (the user's requirements of 2026-10-19, item 3 (a))
import { armTip, conduitGaps } from '../helpers/scene-checks.ts';

const faceSet = (id: string, name: string): [string, BlockFaces] => {
  const block = { id, meta: 0 };
  return [blockKey(block), { block, resolved: true, fallbackColor: [1, 2, 3],
    faces: { down: [E(name)], up: [E(name)], north: [E(name)], south: [E(name)], west: [E(name)], east: [E(name)] } }];
};
const faces = new Map([faceSet('conduit:item', 'itemConduit'), faceSet('conduit:liquid_ender', 'liquidConduitEnder'),
  faceSet('conduit:connector_background', 'itemConduitIoConnector'), faceSet('conduit:connector_in_out_in', 'itemConduitInOut_In'),
  faceSet('conduit:connector_in_out_out', 'itemConduitInOut_Out'), faceSet('conduit:connector_extract', 'itemConduitInput'),
  faceSet('conduit:other', 'conduitConnector')]);
const plan = { names: enderioNames } as unknown as Plan;
/** The channel colours of the fixtures as the 3D view tints them: Red and Blue as the game draws them (Minecraft 1.7.10's dye colours). */
const RED = '179,49,44', BLUE = '37,49,146';
/** A tile's layers as `<texture name>[ <tint>]`, bottom first. */
const drawn = (scene: SceneData, tile: number): string[] =>
  scene.tiles[tile]!.layers.map((l) => `${l.path.replace(/^.*\/(\w+)\.png$/, '$1')}${l.tint === undefined ? '' : ` ${l.tint.join(',')}`}`);

/** The bundle with both conduits going north (each with its face toward the macerator) and south. */
const together: LayoutBlock = { ...bundle, connections: 4 | 8, conduits: [{ ...bundle.conduits![0]!, connections: 8 },
  { ...bundle.conduits![1]!, connections: 8, faces: [{ face: 'north', mode: 'extract', target: 'Basic Macerator',
    extract: { color: 'red', filter: { whitelist: true, keys: ['fluid:molten.iron'] }, rate: 1, roundRobin: false, redstone: 'ignore' } }] }] };

describe('conduits in the 3D view', () => {
  it('names the conduit and connector textures a bundle needs', () => {
    // EnderIO draws every set face's plate, then the mode's arrows: In / Out has two halves, Extract and Insert one arrow;
    // the bundle's conduits go different ways, so they meet in EnderIO's connector box (conduitConnector, `conduit:other`)
    expect(sceneBlockRefs(bundle).map((r) => r.id)).toEqual(['conduit:item', 'conduit:connector_background', 'conduit:connector_in_out_in',
      'conduit:connector_in_out_out', 'conduit:liquid_ender', 'conduit:connector_extract', 'conduit:other']);
    expect(sceneBlockRefs(together).map((r) => r.id)).not.toContain('conduit:other');
  });
  it('asks the asset API for every conduit and connector texture of a bundle, each once', async () => {
    const asked: string[] = [];
    await loadSceneInputs({ ...bundleLayout, blocks: [bundle, { ...bundle, pos: [11, 64, 20] }] }, { blocks: async (refs) => { asked.push(...refs.map(blockKey)); return []; },
      icons: async () => [], covers: async (items) => items.map((item) => ({ item, layers: [] })), image: async () => null });
    expect(asked).toEqual(sceneBlockRefs(bundle).map(blockKey));
  });
  it('draws the conduits of a bundle that go one way side by side, with connector arms on their configured faces', () => {
    const scene = buildScene({ ...bundleLayout, blocks: [together] }, faces, new Map(), new Map());
    // as EnderIO 2.10.46 draws a set face (ItemConduitRenderer, EnderLiquidConduitRenderer): the plate, then In / Out's
    // In half in the extract side's colour and its Out half in the insert side's, or Extract's arrow in its colour; both
    // conduits go north and south, so each is drawn beside the other, 6 px apart, all the way: the Item Conduit on the
    // east, as EnderIO places it on an arm north or south (Offsets: IItemConduit Z → EAST, ILiquidConduit Z → WEST)
    expect(scene.instances.map((i) => [i.shape, i.side, i.conduit, i.offset, drawn(scene, i.tiles[2])])).toEqual([
      ['core', -1, 0, [0.1875, 0, 0], ['itemConduit']],
      ['arm', 2, 0, [0.1875, 0, 0], ['itemConduitIoConnector', `itemConduitInOut_In ${RED}`, `itemConduitInOut_Out ${BLUE}`]],
      ['arm', 3, 0, [0.1875, 0, 0], ['itemConduit']],
      ['core', -1, 1, [-0.1875, 0, 0], ['liquidConduitEnder']],
      ['arm', 2, 1, [-0.1875, 0, 0], ['itemConduitIoConnector', `itemConduitInput ${RED}`]],
      ['arm', 3, 1, [-0.1875, 0, 0], ['liquidConduitEnder']]]);
    expect(scene.instances.every((i) => i.tiles.every((t) => t === i.tiles[0]))).toBe(true);   // one picture on every side
    // every conduit tile, a connector's included, is drawn over a colour (plan 16 Task 9): EnderIO's dark conduit grey,
    // so the Item Conduit's see-through window shows dark as in the game, not the pipe role's amber (the review of
    // f82c98c)
    const UNDER = 'under:48,48,48|';
    for (const i of scene.instances) {
      const { key, layers, under } = scene.tiles[i.tiles[2]]!;
      expect(key).toBe(`${UNDER}${JSON.stringify(layers)}`);
      expect(under).toEqual([48, 48, 48]);
    }
  });
  it("draws a bundle whose conduits part around EnderIO's connector box, each arm on the cell's centre line", () => {
    // the item conduit goes north (its In / Out face) and east, the fluid conduit up (its Extract face) and west: no
    // side has two, so every arm is centred (TileConduitBundle.getOffset), both cores sit in the middle and EnderIO
    // draws its internal connector around them, 1.05 times their size (TileConduitBundle.addConnectors), over the
    // conduits' grey
    const scene = buildScene(bundleLayout, faces, new Map(), new Map());
    expect(scene.instances.map((i) => [i.shape, i.side, i.conduit, i.offset, drawn(scene, i.tiles[2])])).toEqual([
      ['hub', -1, undefined, undefined, ['conduitConnector']],
      ['arm', 2, 0, undefined, ['itemConduitIoConnector', `itemConduitInOut_In ${RED}`, `itemConduitInOut_Out ${BLUE}`]],
      ['arm', 5, 0, undefined, ['itemConduit']],
      ['arm', 1, 1, undefined, ['itemConduitIoConnector', `itemConduitInput ${RED}`]],
      ['arm', 4, 1, undefined, ['liquidConduitEnder']]]);
    expect(scene.instances[0]!.size!.map((v) => Number(v.toFixed(6)))).toEqual([0.39375, 0.39375, 0.39375]);
    expect(scene.tiles[scene.instances[0]!.tiles[0]]!.under).toEqual([48, 48, 48]);
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
    const one = { ...bundleLayout, blocks: [together] };
    const scene = buildScene(one, faces, new Map(), new Map());
    scene.instances[0]!.offset![0] = 9;
    expect(scene.instances[1]!.offset).toEqual([0.1875, 0, 0]);
    expect(buildScene(one, faces, new Map(), new Map()).instances[0]!.offset).toEqual([0.1875, 0, 0]);
    const hub = buildScene(bundleLayout, faces, new Map(), new Map()).instances[0]!;
    hub.size![0] = 9;
    expect(buildScene(bundleLayout, faces, new Map(), new Map()).instances[0]!.size![0]).toBeCloseTo(0.39375, 9);
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

// The user's requirements of 2026-10-19, item 3 (a): every conduit connection drawn as EnderIO 2.10.46 draws it. A
// conduit's arm toward a side two or more of the bundle's conduits go is drawn beside the others where EnderIO puts its
// kind for that arm's axis (TileConduitBundle.getOffset, Offsets: the Item Conduit east of an ender fluid conduit on an
// arm up, down, north or south, south of it on an arm east or west; as the review of f9fe23e found from EnderIO's
// classes), and toward a side it goes alone on the cell's centre line, so linked neighbours' arms meet and every arm
// reaches its face; where a conduit's arms leave from two places, or two conduits' cores would overlap, EnderIO's
// connector box holds them (TileConduitBundle.addConnectors).
describe('every conduit connection in the 3D view', () => {
  const CONNECTOR = 'enderio/textures/blocks/itemConduitIoConnector.png';
  const DOWN = 1, UP = 2, NORTH = 4, SOUTH = 8, WEST = 16, EAST = 32;
  const extractSide = { color: 'red' as const, filter: null, rate: 1, roundRobin: false, selfFeed: false, redstone: 'ignore' as const };
  const insertSide = { color: 'red' as const, filter: null, rate: 1, priority: 1 };
  const face = (f: ConduitFace['face'], mode: 'extract' | 'insert' | 'in_out', target: string): ConduitFace => ({ face: f, mode, target,
    ...(mode === 'insert' ? {} : { extract: { ...extractSide } }), ...(mode === 'extract' ? {} : { insert: { ...insertSide } }) });
  const item = (connections: number, ...set: ConduitFace[]): ConduitSpec => ({ kind: 'item', item: ITEM, connections, faces: set });
  const fluid = (connections: number, ...set: ConduitFace[]): ConduitSpec => ({ kind: 'liquid_ender', item: ENDER, connections, faces: set });
  const cell = (pos: [number, number, number], ...conduits: ConduitSpec[]): LayoutBlock => ({ pos, block: { id: 'conduit:item', meta: 0 }, role: 'pipe',
    label: conduits.length > 1 ? 'Conduit bundle' : 'Item Conduit', item: ITEM, conduits,
    connections: conduits.reduce((bits, c) => c.faces.reduce((b, f) => b | (1 << FACES.indexOf(f.face)), bits | c.connections), 0) });
  const lineOf = (blocks: LayoutBlock[]): Layout => ({ ...bundleLayout, origin: [0, 64, 0], blocks });
  const sceneOf = (blocks: LayoutBlock[]) => buildScene(lineOf(blocks), faces, new Map(), new Map());
  const gaps = (blocks: LayoutBlock[]) => conduitGaps(lineOf(blocks), sceneOf(blocks), CONNECTOR);
  const arms = (blocks: LayoutBlock[], block: number, side: number) => sceneOf(blocks).instances
    .filter((i) => i.block === block && i.shape === 'arm' && i.side === side).map((i) => [i.conduit, i.offset ?? [0, 0, 0]]);

  // the spine where the fluid conduit ends: the macerators' bundles, then the Item Conduit alone toward the tail
  const spine = [
    cell([0, 64, 0], item(EAST, face('north', 'in_out', 'Basic Macerator')), fluid(EAST, face('north', 'extract', 'Basic Macerator'))),
    cell([1, 64, 0], item(WEST | EAST, face('north', 'in_out', 'Basic Macerator')), fluid(WEST, face('north', 'insert', 'Basic Macerator'))),
    cell([2, 64, 0], item(WEST, face('south', 'insert', 'Chest (output)')))];
  // the tail column: both conduits climb to the next output chest and open end
  const column = [
    cell([0, 64, 0], item(UP, face('north', 'extract', 'Chest (input)')), fluid(UP, face('east', 'insert', 'your tank'))),
    cell([0, 65, 0], item(DOWN, face('south', 'insert', 'Chest (output)')), fluid(DOWN, face('east', 'extract', 'your tank')))];
  // a bundle over a multiblock's input hatch: the fluid conduit goes down into it, the Item Conduit north
  const overHatch = [cell([0, 65, 0], item(0, face('north', 'in_out', 'Basic Macerator')), fluid(0, face('down', 'insert', 'Electric Blast Furnace')))];

  it('joins a bundle to the conduit that goes on alone, without a step between them', () => {
    expect(gaps(spine)).toEqual([]);
    // both conduits go north and east from the first cell: side by side, 6 px apart, the Item Conduit south of the fluid
    // conduit on the arm east and east of it on the arm north, so each turns the corner in a connector box; the Item
    // Conduit goes on east alone
    expect(arms(spine, 0, 5)).toEqual([[0, [0, 0, 0.1875]], [1, [0, 0, -0.1875]]]);
    expect(arms(spine, 0, 2)).toEqual([[0, [0.1875, 0, 0]], [1, [-0.1875, 0, 0]]]);
    expect(arms(spine, 1, 5)).toEqual([[0, [0, 0, 0]]]);
    expect(arms(spine, 2, 4)).toEqual([[0, [0, 0, 0]]]);
    const scene = sceneOf(spine);
    expect(scene.instances.filter((i) => i.shape === 'hub').map((i) => i.block)).toEqual([0, 1]);
    const tip = (block: number, side: number) => armTip(scene.instances.find((i) => i.block === block && i.shape === 'arm' && i.side === side && i.conduit === 0)!);
    expect(tip(1, 5)).toEqual(tip(2, 4));
  });

  it('runs two conduits up a column side by side across their arms, each reaching the face it points at', () => {
    expect(gaps(column)).toEqual([]);
    // up and down, the Item Conduit east of the fluid conduit (Offsets: IItemConduit Y → EAST, ILiquidConduit Y → WEST)
    expect([arms(column, 0, 1), arms(column, 1, 0)]).toEqual([[[0, [0.1875, 0, 0]], [1, [-0.1875, 0, 0]]], [[0, [0.1875, 0, 0]], [1, [-0.1875, 0, 0]]]]);
    expect(arms(column, 0, 2)).toEqual([[0, [0, 0, 0]]]);
  });

  it("puts the cores of a bundle's conduits with no arms where EnderIO puts them, the Item Conduit east", () => {
    // Offsets for no axis: IItemConduit EAST, ILiquidConduit WEST; apart, so no connector box
    const idle = [cell([0, 64, 0], item(0), fluid(0))];
    expect(gaps(idle)).toEqual([]);
    expect(sceneOf(idle).instances.map((i) => [i.shape, i.conduit, i.offset])).toEqual([['core', 0, [0.1875, 0, 0]], ['core', 1, [-0.1875, 0, 0]]]);
  });

  it('takes a connector down into the block below all the way to its face', () => {
    expect(gaps(overHatch)).toEqual([]);
    expect(arms(overHatch, 0, 0)).toEqual([[1, [0, 0, 0]]]);
  });

  it('draws every link and set face of the shared fixtures with their neighbours, a ghost bundle and a hookup end too', () => {
    // the fixtures' links go to cells of their own; a hookup's run ends at the tap, the base's conduit (a ghost)
    const run: LayoutBlock = { pos: [9, 64, 20], block: { id: 'conduit:item', meta: 0 }, role: 'pipe', label: 'Item Conduit', item: ITEM, hookup: 0, connections: WEST | EAST };
    const end: LayoutBlock = { pos: [8, 64, 20], block: { id: 'conduit:item', meta: 0 }, role: 'pipe', label: 'Item Conduit', item: ITEM, hookup: 0,
      connections: NORTH | EAST, conduits: [item(EAST, face('north', 'insert', 'Chest (input)'))] };
    const tap: LayoutBlock = { pos: [10, 64, 20], block: { id: 'EnderIO:blockConduitBundle', meta: 0 }, role: 'ghost', label: 'existing Conduit Bundle' };
    const ghost = (b: LayoutBlock): LayoutBlock => ({ ...b, role: 'ghost', label: `existing ${b.label}` });
    const bundleWithNeighbours = [bundle, cell([11, 64, 20], item(WEST)), cell([9, 64, 20], fluid(EAST))];
    for (const blocks of [bundleWithNeighbours, [together, cell([10, 64, 21], item(NORTH), fluid(NORTH))],
      [lone, cell([9, 64, 20], item(EAST)), cell([11, 64, 20], item(WEST))], bundleWithNeighbours.map(ghost), [run, end, tap],
      [cell([10, 64, 20], item(SOUTH | WEST, face('north', 'insert', 'Basic Macerator')), fluid(WEST)), cell([10, 64, 21], item(NORTH)),
        cell([9, 64, 20], item(EAST), fluid(EAST))]]) {
      expect(conduitGaps({ ...bundleLayout, blocks }, buildScene({ ...bundleLayout, blocks }, faces, new Map(), new Map()), CONNECTOR)).toEqual([]);
    }
  });

  it('names what is missing when a link has no arm on the other side', () => {
    const oneSided = [cell([0, 64, 0], item(EAST)), cell([1, 64, 0], item(0))];
    expect(gaps(oneSided)).toEqual(["Item Conduit at 0,64,0: item east's link meets 0 arms"]);
  });
});
