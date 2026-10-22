import { describe, it, expect } from 'vitest';
import { buildScene, canonicalFaceFor, visible, blockList, pickInfo, hoverText, blockKey, frontOf, ROLE_FALLBACK, type SceneInstance } from '../../src/client/three/scene-data.ts';
import { compositeTile, solidTile, packTiles, shadeFor, TILE } from '../../src/client/three/textures.ts';
import type { BlockFaces, CoverLayers, IconDescriptor, Rect, TextureLayer } from '../../src/shared/types/assets.ts';
import type { Layout, LayoutBlock } from '../../src/shared/types/layout.ts';
import type { Plan } from '../../src/shared/types/plan.ts';
import { sampleLayout as layout, sampleFaces as faces, sampleIcons as icons, sampleCovers as covers, sampleNames as names, CONV, GT, L } from './layout-fixture.ts';

describe('3D scene data', () => {
  it('maps canonical faces onto world sides for any facing', () => {
    expect([canonicalFaceFor(2, 2), canonicalFaceFor(3, 3), canonicalFaceFor(3, 2), canonicalFaceFor(5, 5), canonicalFaceFor(4, 3)])
      .toEqual(['north', 'north', 'south', 'north', 'west']);
  });

  it('makes a cube per block, a core plus arms per pipe and a plate per cover on its face, sharing tiles', () => {
    const scene = buildScene(layout, faces, icons, covers);
    expect(scene.instances.map((i) => [i.block, i.shape, i.pos, i.side])).toEqual([
      [0, 'cube', [0, 0, 0], -1], [0, 'plate', [0, 0, 0], 3], [1, 'core', [0, 0, 1], -1], [1, 'arm', [0, 0, 1], 2], [1, 'arm', [0, 0, 1], 5],
      [2, 'cube', [1, 0, 0], -1], [3, 'cube', [-1, 0, 1], -1], [4, 'core', [-1, 1, 1], -1]]);
    const machine = scene.instances[0]!;
    expect(scene.tiles[machine.tiles[3]]!.layers).toEqual([L('front')]);
    expect(scene.tiles[machine.tiles[2]]!.layers).toEqual([L('back')]);
    expect(scene.tiles[scene.instances[1]!.tiles[0]]!.layers).toEqual([L('iconsets/OVERLAY_CONVEYOR')]);   // GT's in-world cover overlay
    const noOverlay = buildScene(layout, faces, icons, new Map([[CONV, { item: CONV, layers: [] }]]));
    expect(noOverlay.tiles[noOverlay.instances[1]!.tiles[0]]!.layers).toEqual([L('conveyor')]);           // falls back to the item icon
    expect(scene.tiles[0]).toEqual({ key: 'fallback', layers: [], color: [128, 128, 128] });
    expect(scene.instances[6]!.ghost).toBe(true);
    expect(new Set(scene.tiles.map((t) => t.key)).size).toBe(scene.tiles.length);
    expect(scene.size).toEqual([3, 2, 2]);
  });

  it('hides layers above the slider, ghosts and hookups on demand', () => {
    const inst = (block: number, y: number, ghost = false): SceneInstance => ({ block, shape: 'cube', pos: [0, y, 0], side: -1, tiles: [0, 0, 0, 0, 0, 0], ghost });
    const all = { ghosts: true, hookups: true };
    expect([visible(inst(0, 1), 0, all, layout), visible(inst(0, 1), 1, all, layout), visible(inst(0, 1), null, all, layout)]).toEqual([false, true, true]);
    expect(visible(inst(3, 0, true), null, { ghosts: false, hookups: true }, layout)).toBe(false);
    expect(visible(inst(4, 1), null, { ghosts: true, hookups: false }, layout)).toBe(false);
  });

  it('lists the blocks to place, the hookups and the size', () => {
    expect(blockList(layout, names)).toEqual({
      place: [{ label: '1x Tin Cable', role: 'cable', count: 1 }, { label: 'Basic Macerator', role: 'machine', count: 1 },
        { label: 'Conveyor Module (LV) cover', role: 'cover', count: 1 }, { label: 'Input Bus (LV)', role: 'hatch', count: 1 },
        { label: 'Tin Item Pipe', role: 'pipe', count: 1 }],
      hookups: ['Power: 1 block from pin 2'], size: '3×2×2' });
  });

  it('pickInfo shows cover settings and the bus circuit number', () => {
    const plan = { steps: [{ id: 's1', machine: { mteId: 2001, name: 'Basic Macerator', tier: 1 }, euPerTick: 30,
      inputs: [{ key: 't:ore@0', amount: 1, chance: 1 }], outputs: [{ key: 't:dust@0', amount: 2, chance: 1 }] }],
      names: { 't:ore@0': 'Iron Ore', 't:dust@0': 'Iron Dust', ...names } } as unknown as Plan;
    expect(pickInfo(layout, plan, 0)).toEqual({ title: 'Basic Macerator', lines: ['Facing south', 'Makes 2× Iron Dust from 1× Iron Ore', 'LV · 30 EU/t',
      'Conveyor Module (LV) on the south face: Export, allow input, 0.5 items/s'] });
    expect(pickInfo(layout, plan, 2)).toEqual({ title: 'Input Bus (LV)', lines: ['programmed circuit 2', 'Input Filter on'] });
    expect(hoverText(layout, plan, 0)).toBe('Basic Macerator — Conveyor Module (LV) on the south face: Export, allow input, 0.5 items/s');
    expect(pickInfo(layout, null, 3)).toEqual({ title: 'existing Stone', lines: ['Already in your base'] });
  });

  it('pickInfo lists every step a shared machine runs, in order (plan 12)', () => {
    const plan = { steps: [
      { id: 's2', machine: { mteId: 2001, name: 'Basic Macerator', tier: 1 }, euPerTick: 2, inputs: [{ key: 't:gravel@0', amount: 1, chance: 1 }], outputs: [{ key: 't:sand@0', amount: 1, chance: 1 }] },
      { id: 's1', machine: { mteId: 2001, name: 'Basic Macerator', tier: 1 }, euPerTick: 30, inputs: [{ key: 't:ore@0', amount: 1, chance: 1 }], outputs: [{ key: 't:dust@0', amount: 2, chance: 1 }] }],
    names: { 't:ore@0': 'Iron Ore', 't:dust@0': 'Iron Dust', 't:gravel@0': 'Gravel', 't:sand@0': 'Sand', ...names } } as unknown as Plan;
    const pooled: Layout = { ...layout, blocks: [{ ...layout.blocks[0]!, stepId: 's1', stepIds: ['s1', 's2'] }, ...layout.blocks.slice(1)] };
    expect(pickInfo(pooled, plan, 0).lines).toEqual(['Facing south', 'Makes 2× Iron Dust from 1× Iron Ore', 'LV · 30 EU/t', 'Makes 1× Sand from 1× Gravel',
      'LV · 2 EU/t', 'Conveyor Module (LV) on the south face: Export, allow input, 0.5 items/s']);
    expect(hoverText(pooled, plan, 0)).toBe(hoverText(layout, plan, 0));
  });

  it('composites tinted layers into one tile and packs tiles for the array texture', () => {
    const white = { data: new Uint8ClampedArray(TILE * TILE * 4).fill(255) };
    const dot = new Uint8ClampedArray(TILE * TILE * 4);
    dot.set([0, 0, 0, 128], 0);
    const out = compositeTile([{ image: white, tint: [255, 0, 0] }, { image: { data: dot } }])!;
    expect([...out.slice(0, 8)]).toEqual([127, 0, 0, 255, 255, 0, 0, 255]);
    expect(compositeTile([null])).toBeNull();
    expect([...solidTile([1, 2, 3]).slice(0, 4)]).toEqual([1, 2, 3, 255]);
    expect(packTiles([solidTile([1, 2, 3]), solidTile([4, 5, 6])])).toHaveLength(2 * TILE * TILE * 4);
    expect([0, 1, 2, 3, 4, 5].map(shadeFor)).toEqual([0.5, 1, 0.8, 0.8, 0.6, 0.6]);
  });
});

// ---- after the plan's own tests: the rulings and the edges the plan leaves open ----

describe('3D scene data: tiles', () => {
  it('gives every tile the plain colour it falls back to (R15) and keys plain tiles by colour', () => {
    const scene = buildScene(layout, faces, icons, covers);
    const textured = (path: string) => scene.tiles.find((t) => t.layers.length === 1 && t.layers[0]!.path.endsWith(`/${path}.png`))!;
    expect(textured('front').color).toEqual([1, 2, 3]);                      // a block face: the block's own fallback colour
    expect(textured('iconsets/OVERLAY_CONVEYOR').color).toEqual([9, 9, 9]);   // a cover plate: the cover item's
    expect(scene.tiles.filter((t) => t.layers.length === 0).map((t) => [t.key, t.color])).toEqual([
      ['fallback', [128, 128, 128]], ['color:255,179,0', [255, 179, 0]], ['color:121,85,72', [121, 85, 72]],   // pipe, hatch
      ['color:200,200,200', [200, 200, 200]], ['color:66,66,66', [66, 66, 66]]]);                               // ghost, cable
  });

  it('names the plain colour of every role', () => {
    expect(ROLE_FALLBACK).toEqual({ machine: [96, 125, 139], hatch: [121, 85, 72], casing: [158, 158, 158], transformer: [142, 36, 170],
      cable: [66, 66, 66], pipe: [255, 179, 0], cover: [220, 220, 220], interface: [126, 87, 194], chip_pipe: [255, 112, 67],
      chest: [160, 110, 50], ghost: [200, 200, 200] });
  });

  it('shows the front texture on the side the machine faces, whatever the facing', () => {
    const faced = (facing: number | undefined): Layout => ({ ...layout, blocks: [{ pos: [10, 64, 20], block: GT(2001), role: 'machine', label: 'Basic Macerator', facing }] });
    for (const facing of [0, 1, 2, 3, 4, 5]) {
      const scene = buildScene(faced(facing), faces, icons, covers);
      expect(scene.tiles[scene.instances[0]!.tiles[facing]!]!.layers).toEqual([L('front')]);
    }
    const unset = buildScene(faced(undefined), faces, icons, covers);            // no facing: the canonical one, front on north
    expect(unset.instances[0]!.tiles.map((t) => unset.tiles[t]!.layers[0]!.path.split('/').pop())).toEqual(['d.png', 'u.png', 'front.png', 'back.png', 'w.png', 'e.png']);
  });

  it('draws a pipe from its north face on the core and on every arm', () => {
    const withFaces = new Map(faces).set(blockKey(GT(5600)), { block: GT(5600), resolved: true, fallbackColor: [4, 5, 6],
      faces: { down: [L('pd')], up: [L('pu')], north: [L('pn')], south: [L('ps')], west: [L('pw')], east: [L('pe')] } });
    const scene = buildScene(layout, withFaces, icons, covers);
    const pipe = scene.instances.filter((i) => i.block === 1);
    expect(pipe.map((i) => i.shape)).toEqual(['core', 'arm', 'arm']);
    expect([...new Set(pipe.flatMap((i) => i.tiles))]).toHaveLength(1);
    expect(scene.tiles[pipe[0]!.tiles[0]]).toEqual({ key: `under:255,179,0|${JSON.stringify([L('pn')])}`, layers: [L('pn')], color: [4, 5, 6], under: [255, 179, 0] });
  });

  it('falls back from the cover overlay to the item icon to a plain colour on a cover plate', () => {
    const plate = (c: ReadonlyMap<string, CoverLayers>, i: ReadonlyMap<string, IconDescriptor>) => { const s = buildScene(layout, faces, i, c); return s.tiles[s.instances[1]!.tiles[0]]!; };
    const none = new Map<string, CoverLayers>();
    expect(plate(none, icons)).toMatchObject({ layers: [L('conveyor')], color: [9, 9, 9] });
    expect(plate(none, new Map())).toEqual({ key: 'color:220,220,220', layers: [], color: [220, 220, 220] });
    const bare = new Map<string, IconDescriptor>([[CONV, { key: CONV, layers: [], source: 'fallback', fallbackColor: [7, 8, 9] }]]);
    expect(plate(none, bare)).toEqual({ key: 'color:7,8,9', layers: [], color: [7, 8, 9] });   // an icon without layers still lends its colour
  });

  it('shares a tile between faces and blocks that draw the same layers, and the first colour stays', () => {
    const machine = (mteId: number, x: number): LayoutBlock => ({ pos: [x, 64, 20], block: GT(mteId), role: 'machine', label: `Machine ${mteId}`, facing: 2 });
    const twin = new Map(faces).set(blockKey(GT(2002)), { ...faces.get(blockKey(GT(2001)))!, block: GT(2002), fallbackColor: [4, 4, 4] });
    const colorOfFront = (first: number, second: number) => {
      const scene = buildScene({ ...layout, blocks: [machine(first, 10), machine(second, 11)] }, twin, icons, covers);
      expect(scene.tiles).toHaveLength(7);                                       // the fallback tile and the six faces, once
      expect(scene.instances[1]!.tiles).toEqual(scene.instances[0]!.tiles);
      return scene.tiles.find((t) => t.layers[0]?.path.endsWith('/front.png'))!.color;
    };
    expect([colorOfFront(2001, 2002), colorOfFront(2002, 2001)]).toEqual([[1, 2, 3], [4, 4, 4]]);
  });

  it('hands out data of its own: changing a scene changes neither its inputs nor the next scene', () => {
    const scene = buildScene(layout, faces, icons, covers);
    scene.tiles[1]!.color[0] = 99;                               // a face's colour is copied from the block's faces
    scene.tiles[0]!.color[0] = 99;                               // the fallback tile's from no shared constant
    scene.tiles.find((t) => t.key === 'color:255,179,0')!.color[0] = 0;
    scene.instances[2]!.pos[0] = 99;                             // the pipe's core, whose arms must not share its arrays
    scene.instances[2]!.tiles[0] = 99;
    expect(faces.get(blockKey(GT(2001)))!.fallbackColor).toEqual([1, 2, 3]);
    expect(ROLE_FALLBACK.pipe).toEqual([255, 179, 0]);
    expect(scene.instances[3]).toMatchObject({ shape: 'arm', pos: [0, 0, 1] });
    expect(scene.instances[3]!.tiles[0]).not.toBe(99);
    expect(buildScene(layout, faces, icons, covers).tiles[0]).toEqual({ key: 'fallback', layers: [], color: [128, 128, 128] });
  });

  it('names a block to the asset routes by id, meta and GT tile id', () => {
    expect(blockKey({ id: 'minecraft:stone', meta: 0 })).toBe('minecraft:stone@0');
    expect(blockKey(GT(0))).toBe('gregtech:gt.blockmachines@0#0');       // an id of 0 is still an id
  });

  it('turns the front to the facing for all six facings and refuses a side that does not exist', () => {
    for (const facing of [0, 1, 2, 3, 4, 5]) expect(canonicalFaceFor(facing, facing)).toBe('north');
    expect(() => canonicalFaceFor(2, 6)).toThrow(RangeError);
  });
});

describe('3D scene data: layers, list and click info', () => {
  it('hides a cover plate with its host', () => {
    const plate: SceneInstance = { block: 4, shape: 'plate', pos: [0, 0, 0], side: 1, tiles: [0, 0, 0, 0, 0, 0], ghost: false };
    expect([visible(plate, null, { ghosts: true, hookups: false }, layout), visible(plate, null, { ghosts: true, hookups: true }, layout)]).toEqual([false, true]);
  });

  it('groups equal labels, counts every cover and counts only the blocks a hookup lays', () => {
    const cover = (face: 'north' | 'south', item = CONV) => ({ face, item, settings: {} });
    const mac = (x: number, covers?: LayoutBlock['covers']): LayoutBlock => ({ pos: [x, 64, 20], block: GT(2001), role: 'machine', label: 'Basic Macerator', covers });
    const cable = (y: number): LayoutBlock => ({ pos: [9, y, 21], block: GT(1246), role: 'cable', label: '1x Tin Cable', hookup: 0 });
    const busy: Layout = { ...layout, size: [4, 3, 5],
      blocks: [mac(10, [cover('south'), cover('north')]), mac(11, [cover('south')]), mac(12), cable(65), cable(66),
        { pos: [9, 64, 21], block: { id: 'minecraft:stone', meta: 0 }, role: 'ghost', label: 'existing Stone', hookup: 0, covers: [cover('north', 'x:cover@0')] }],
      hookups: [layout.hookups[0]!, { kind: 'logistics', from: { pos: [1, 2, 3], dim: 0, kind: 'routed', networkId: 'r' }, path: [], parts: [], found: false }],
      pins: [{ n: 1, dim: 0, pos: [9, 64, 21], kind: 'warning', text: 'Something is in the way' }, { n: 3, dim: 0, pos: [9, 64, 21], kind: 'power', text: 'Tap power here' }] };
    expect(blockList(busy, names)).toEqual({
      place: [{ label: 'Basic Macerator', role: 'machine', count: 3 }, { label: 'Conveyor Module (LV) cover', role: 'cover', count: 3 },   // ghosts and their covers are not placed
        { label: '1x Tin Cable', role: 'cable', count: 2 }],
      hookups: ['Power: 2 blocks from pin 3', 'Logistics: 0 blocks from the tap'], size: '4×5×3' });
    expect(blockList(busy).place[1]!.label).toBe(`${CONV} cover`);                                          // no name: the item key
    const pinned = { ...busy, pins: [...busy.pins, { n: 4, dim: 0, pos: [1, 2, 3] as [number, number, number], kind: 'logistics' as const, text: 'Hook logistics here' }] };
    expect(blockList(pinned).hookups).toEqual(['Power: 2 blocks from pin 3', 'Logistics: 0 blocks from pin 4']);
  });

  it('names the hookup a block belongs to and answers a block outside the layout with nothing', () => {
    expect(pickInfo(layout, null, 4)).toEqual({ title: '1x Tin Cable', lines: ['Part of the power hookup'] });
    expect(pickInfo(layout, null, 99)).toEqual({ title: '', lines: [] });
    expect(hoverText(layout, null, 99)).toBe('');
  });

  it('shows the keys when the plan has no names, and no recipe without the plan or its step', () => {
    expect(pickInfo(layout, null, 0).lines).toEqual(['Facing south', `${CONV} on the south face: Export, allow input, 0.5 items/s`]);
    const other = { steps: [{ id: 'other', machine: { mteId: 1, name: 'M', tier: 1 }, euPerTick: 8, inputs: [], outputs: [] }] } as unknown as Plan;
    expect(pickInfo(layout, other, 0).lines).toEqual(['Facing south', `${CONV} on the south face: Export, allow input, 0.5 items/s`]);
  });

  it('writes a step per run: litres for fluids, small chances with two significant digits, big numbers with separators', () => {
    const step = (tier: number, euPerTick: number, inputs: Array<[string, number]>, outputs: Array<[string, number]>) => ({
      steps: [{ id: 's1', machine: { mteId: 2001, name: 'Basic Macerator', tier }, euPerTick,
        inputs: inputs.map(([key, amount]) => ({ key, amount, chance: 1 })), outputs: outputs.map(([key, amount]) => ({ key, amount, chance: 1 })) }],
      names: { 'fluid:water': 'Water' } }) as unknown as Plan;
    const recipe = (plan: Plan) => pickInfo(layout, plan, 0).lines.slice(1, 3);
    expect(recipe(step(3, 1_200_000, [['fluid:water', 1000], ['fluid:oxygen', 144]], [['t:dust@0', 2], ['t:tiny@0', 0.04], ['fluid:steam', 1234.56]])))
      .toEqual(['Makes 2× t:dust@0, 0.04× t:tiny@0, 1,234.6 L fluid:steam from 1,000 L Water, 144 L fluid:oxygen', 'HV · 1,200,000 EU/t']);
    expect(recipe(step(1, 30, [], [['fluid:water', 1000]]))).toEqual(['Makes 1,000 L Water', 'LV · 30 EU/t']);          // a supply step takes nothing
    expect(recipe(step(99, 8, [['t:ore@0', 0.999]], [['t:dust@0', 1]]))).toEqual(['Makes 1× t:dust@0 from 1× t:ore@0', 'tier 99 · 8 EU/t']);   // a tier outside 0..14 shows as its number
  });
});

describe('3D scene data: texture tiles', () => {
  it('blends the entries that are not null, in order, and none at all gives null', () => {
    const red = { image: { data: solidTile([255, 0, 0]) } };
    const blue = { image: { data: solidTile([0, 0, 255]) } };
    expect([...compositeTile([null, red, null, blue, null])!.slice(0, 4)]).toEqual([0, 0, 255, 255]);   // blue over red
    expect(compositeTile([])).toBeNull();
  });

  it('packs each tile at its own offset and refuses a tile of another size', () => {
    const packed = packTiles([solidTile([1, 2, 3]), solidTile([4, 5, 6])]);
    expect([...packed.slice(0, 4)]).toEqual([1, 2, 3, 255]);
    expect([...packed.slice(TILE * TILE * 4, TILE * TILE * 4 + 4)]).toEqual([4, 5, 6, 255]);
    expect(packTiles([])).toHaveLength(0);
    expect(() => packTiles([new Uint8ClampedArray(10)])).toThrow(RangeError);
    expect(() => shadeFor(6)).toThrow(RangeError);
  });
});

// Final review: a GT basic machine's front (mMainFacing) and output side (mFacing) are two faces.
describe('3D scene data: a basic machine with a front of its own', () => {
  it('draws the front on the output side when the front faces up or down, else on the front', () => {
    expect([frontOf({ facing: 3 }), frontOf({ facing: 3, mainFacing: 1 }), frontOf({ facing: 3, mainFacing: 0 }), frontOf({ facing: 3, mainFacing: 4 }), frontOf({})])
      .toEqual([3, 3, 3, 4, 2]);
    const up: Layout = { ...layout, blocks: layout.blocks.map((b, i) => (i === 0 ? { ...b, mainFacing: 1 } : b)) };
    const west: Layout = { ...layout, blocks: layout.blocks.map((b, i) => (i === 0 ? { ...b, mainFacing: 4 } : b)) };
    const frontTile = (l: Layout, side: number) => { const s = buildScene(l, faces, icons, covers); return s.tiles[s.instances[0]!.tiles[side]]!.layers; };
    expect(frontTile(up, 3)).toEqual([L('front')]);                    // GT shows the front overlay on the output side
    expect(frontTile(west, 4)).toEqual([L('front')]);
    expect(frontTile(west, 3)).not.toEqual([L('front')]);
  });

  it('names the front and the output side on click', () => {
    const up: Layout = { ...layout, blocks: layout.blocks.map((b, i) => (i === 0 ? { ...b, mainFacing: 1 } : b)) };
    expect(pickInfo(up, null, 0).lines.slice(0, 2)).toEqual(['Front facing up', 'Output side south']);
  });
});

// Plan 16 Task 9 (architecture §11.43 (c)): a pipe drawn from its core, arm and end layers, over its role's colour.
describe('3D scene data: pipes', () => {
  const J = 'projectred/textures/blocks/mechanical/pipes/routedjunc.png';
  const crop = (src: Rect): TextureLayer => ({ path: J, region: { sheet: 16, src } });
  const piped: BlockFaces = { block: { id: 'fmp:pr_rbasic', meta: 0 }, resolved: true, fallbackColor: [7, 7, 7],
    faces: { down: [{ path: J }], up: [{ path: J }], north: [{ path: J }], south: [{ path: J }], west: [{ path: J }], east: [{ path: J }] },
    pipe: { core: [crop([4, 0, 8, 8])], arm: [crop([0, 0, 4, 8])], end: [crop([8, 8, 8, 8])] } };

  it("draws a pipe's core, arms and tips from its pipe layers, over the role colour", () => {
    const one: Layout = { ...layout, blocks: [{ pos: [10, 64, 20], block: { id: 'fmp:pr_rbasic', meta: 0 }, role: 'pipe', label: 'Routed Junction Pipe', connections: 1 << 5 }], hookups: [], pins: [] };
    const scene = buildScene(one, new Map([[blockKey({ id: 'fmp:pr_rbasic', meta: 0 }), piped]]), icons, covers);
    const [core, arm] = scene.instances;
    const t = (i: number) => scene.tiles[i]!;
    expect(t(core!.tiles[0])).toEqual({ key: `under:255,179,0|${JSON.stringify([crop([4, 0, 8, 8])])}`, layers: [crop([4, 0, 8, 8])], color: [7, 7, 7], under: [255, 179, 0] });
    expect(new Set(core!.tiles).size).toBe(1);
    expect([arm!.shape, arm!.side]).toEqual(['arm', 5]);
    expect(t(arm!.tiles[5]).layers).toEqual([crop([8, 8, 8, 8])]);
    expect([0, 1, 2, 3, 4].map((s) => t(arm!.tiles[s]!).layers)).toEqual(Array(5).fill([crop([0, 0, 4, 8])]));
  });

  it('draws a ghost with pipe layers as a core with arms toward the pipes of the line', () => {
    const ghostCable = { ...piped, block: GT(1391) };
    const g: Layout = { ...layout, blocks: [
      { pos: [9, 64, 21], block: GT(1391), role: 'ghost', label: 'existing cable' },
      { pos: [9, 65, 21], block: GT(1246), role: 'cable', label: '1x Tin Cable', hookup: 0, connections: 1 },
      { pos: [10, 64, 21], block: { id: 'minecraft:stone', meta: 0 }, role: 'ghost', label: 'existing Stone' }] };
    const scene = buildScene(g, new Map([[blockKey(GT(1391)), ghostCable]]), icons, covers);
    expect(scene.instances.filter((i) => i.block === 0).map((i) => [i.shape, i.side, i.ghost])).toEqual([['core', -1, true], ['arm', 1, true]]);
    expect(scene.tiles[scene.instances[0]!.tiles[0]]!.under).toEqual([200, 200, 200]);
    expect(scene.instances.filter((i) => i.block === 2).map((i) => i.shape)).toEqual(['cube']);   // no pipe layers: a cube, as today
  });

  // ---- after the plan's own tests: the edges the plan leaves open ----

  it('gives a ghost an arm only toward a pipe of the line, never toward another ghost or a machine', () => {
    const ghost = (x: number): LayoutBlock => ({ pos: [x, 64, 21], block: GT(1391), role: 'ghost', label: 'existing cable' });
    const g: Layout = { ...layout, blocks: [ghost(9), ghost(10), { pos: [9, 64, 20], block: GT(2001), role: 'machine', label: 'Basic Macerator' },
      { pos: [9, 64, 22], block: GT(5600), role: 'pipe', label: 'Tin Item Pipe', connections: 0 }] };
    const scene = buildScene(g, new Map([[blockKey(GT(1391)), { ...piped, block: GT(1391) }]]), icons, covers);
    const shapes = (block: number) => scene.instances.filter((i) => i.block === block).map((i) => [i.shape, i.side]);
    expect([shapes(0), shapes(1)]).toEqual([[['core', -1], ['arm', 3]], [['core', -1]]]);   // south to the pipe; the other ghost is a lone core
  });

  it('keys a tile by the colour under it as well, and copies that colour', () => {
    const ref = { id: 'fmp:pr_rbasic', meta: 0 };
    const two: Layout = { ...layout, blocks: [{ pos: [10, 64, 20], block: ref, role: 'pipe', label: 'Routed Junction Pipe', connections: 0 },
      { pos: [11, 64, 20], block: ref, role: 'chip_pipe', label: 'Routed Junction Pipe', connections: 0 }], hookups: [], pins: [] };
    const scene = buildScene(two, new Map([[blockKey(ref), piped]]), icons, covers);
    const [pipe, chip] = scene.instances.map((i) => scene.tiles[i.tiles[0]]!);
    expect([pipe!.under, chip!.under, chip!.layers]).toEqual([[255, 179, 0], [255, 112, 67], pipe!.layers]);   // the same layers over two colours: two tiles
    expect(pipe!.key).not.toBe(chip!.key);
    pipe!.under![0] = 0;
    expect(ROLE_FALLBACK.pipe).toEqual([255, 179, 0]);
  });
});

// Plan 16 Task 10 (architecture §11.43 (j)): a block facing up or down keeps its hull by world side; only its front turns.
describe('3D scene data: vertical facings', () => {
  const l = (n: string): TextureLayer => ({ path: `gregtech/textures/blocks/iconsets/${n}.png` });
  const hatchFaces: BlockFaces = { block: GT(60), resolved: true, fallbackColor: [121, 85, 72],
    faces: { down: [l('B')], up: [l('T')], north: [l('S'), l('OUT')], south: [l('S')], west: [l('S')], east: [l('S')] } };
  const hatchFacing = (facing: number): Layout => ({ ...layout, blocks: [{ pos: [10, 64, 20], block: GT(60), role: 'hatch', label: 'Output Hatch (ULV)', facing }], hookups: [], pins: [] });
  /** The layers the hatch's cube shows on each world side, down to east. */
  const sides = (facing: number): TextureLayer[][] => {
    const scene = buildScene(hatchFacing(facing), new Map([[blockKey(GT(60)), hatchFaces]]), icons, covers);
    return scene.instances[0]!.tiles.map((t) => scene.tiles[t]!.layers);
  };

  it('keeps the hull of a hatch facing up on every world side, its overlay on top', () => {
    const shown = sides(1);
    expect([shown[1], shown[2], shown[0]]).toEqual([[l('T'), l('OUT')], [l('S')], [l('B')]]);
  });

  // ---- after the plan's own tests: the edges the plan leaves open ----

  it('draws a hatch facing down with its overlay on the bottom, and its four sides with one tile', () => {
    expect(sides(0)).toEqual([[l('B'), l('OUT')], [l('T')], [l('S')], [l('S')], [l('S')], [l('S')]]);
    const scene = buildScene(hatchFacing(0), new Map([[blockKey(GT(60)), hatchFaces]]), icons, covers);
    expect(new Set(scene.instances[0]!.tiles.slice(2)).size).toBe(1);   // world north shows the hull alone: the sides' tile
  });

  it('turns a hatch facing a side whole, its overlay onto that side', () => {
    expect(sides(5)).toEqual([[l('B')], [l('T')], [l('S')], [l('S')], [l('S')], [l('S'), l('OUT')]]);
  });

  it('draws a block facing up without faces in its plain colour on every side', () => {
    const scene = buildScene(hatchFacing(1), new Map(), icons, covers);
    expect(scene.instances[0]!.tiles.map((t) => scene.tiles[t]!.key)).toEqual(Array(6).fill('color:121,85,72'));
  });
});
