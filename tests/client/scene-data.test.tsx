import { describe, it, expect } from 'vitest';
import { buildScene, canonicalFaceFor, visible, blockList, pickInfo, hoverText, blockKey, ROLE_FALLBACK, type SceneInstance } from '../../src/client/three/scene-data.ts';
import { compositeTile, solidTile, packTiles, shadeFor, TILE } from '../../src/client/three/textures.ts';
import type { CoverLayers, IconDescriptor } from '../../src/shared/types/assets.ts';
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
    expect(scene.tiles[pipe[0]!.tiles[0]]).toEqual({ key: JSON.stringify([L('pn')]), layers: [L('pn')], color: [4, 5, 6] });
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
