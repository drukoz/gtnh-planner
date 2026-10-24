// GT++'s Electric Auto Workbench in a line (plan 12 Task 6; the controller's Auto Workbench rulings, 188 and 204, and the
// user's ruling on feeding; research docs/research/machine-feeding.md §1.3, §3.4, §3.6, §3.7 and §6.1): in its "Normal
// Crafting Table" mode a bench takes any item into any of its nine input slots, so every mode caps each ingredient at
// it — AE2 one exact pattern behind a Locking Card, Project Red an Item Stock Keeper Chip fed by Broadcasters, EnderIO a
// Limited Item Filter — and a machine-to-machine line lays no pipe to it. The bench's back, the face it pushes its result
// out of, meets the line's logistics; its front, away from the middle row, takes its power; no fluid face touches it.

import { describe, expect, it } from 'vitest';
import { placeUnits, unitsFromPlan } from '../../../src/server/layout/arrange.ts';
import { feedingWarnings } from '../../../src/server/layout/feed-rules.ts';
import { emptyScan, layoutLine } from '../../../src/server/layout/layout.ts';
import { buildMode, PORT_SPACING } from '../../../src/server/layout/modes/mode.ts';
import { resolveParts } from '../../../src/server/layout/parts.ts';
import type { StuffKey } from '../../../src/shared/keys.ts';
import { conduitSideText } from '../../../src/shared/layout/configure-text.ts';
import { step as stepTo } from '../../../src/shared/layout/geometry.ts';
import type { Layout, LayoutBlock } from '../../../src/shared/types/layout.ts';
import type { Pack } from '../../../src/shared/types/pack.ts';
import type { LogisticsMode, Plan } from '../../../src/shared/types/plan.ts';
import {
  AUTO_WORKBENCH, craftingRecipe, IDS, layoutPack, makePlan, makeProject, makeScan, withAutoWorkbench,
} from '../../helpers/layout-fixtures.ts';

const A = 't:a@0', B = 't:b@0', C = 't:c@0', D = 't:d@0', R = 't:r@0';
const CELL = 't:water_cell@0', EMPTY_CELL = 't:empty_cell@0', FILE = 't:file@0';
const NAMES: ReadonlyArray<readonly [StuffKey, string]> = [[A, 'Resin'], [B, 'Fine Wire'], [C, 'Wire'], [D, 'Carbon'], [R, 'Resistor'],
  [CELL, 'Water Cell'], [EMPTY_CELL, 'Empty Cell'], [FILE, 'File']];

/** The layout pack with the Auto Workbench (MV), named goods, a water cell that hands back an empty one, and the recipes below. */
function benchPack(): Pack {
  const pack = withAutoWorkbench(layoutPack());
  for (const [key, name] of NAMES) pack.items.set(key, { key, id: key.slice(0, -2), meta: 0, name, oreDict: [] });
  pack.fluidContainers = [{ container: CELL, empty: EMPTY_CELL, fluid: 'fluid:water', amount: 1000 }];
  // the research's Resistor, shaped: Resin, Fine Wire, Resin / Wire, Carbon, Wire / empty, Fine Wire, empty
  pack.recipeById.set('r', craftingRecipe('r', 3, [A, B, A, C, D, C, null, B, null], [R, 1]));
  return pack;
}

/**
 * m (a Basic Macerator) makes the Fine Wire from Raw Input; r (an Auto Workbench) crafts a Resistor a second from it and
 * the Resin, Wire and Carbon of your storage.
 */
function resistorLine(): Plan {
  return makePlan([
    { id: 'm', mteId: IDS.MACERATOR, count: 1, inputs: [['t:in@0', 1]], outputs: [[B, 1]] },
    { id: 'r', mteId: AUTO_WORKBENCH, count: 1, tier: 2, euPerTick: 128, inputs: [[A, 2], [B, 2], [C, 2], [D, 1]], outputs: [[R, 1]] },
  ], { flows: [
    { from: 'raw', to: 'm', key: 't:in@0', perSecond: 2 }, { from: 'm', to: 'r', key: B, perSecond: 2 },
    { from: 'raw', to: 'r', key: A, perSecond: 2 }, { from: 'raw', to: 'r', key: C, perSecond: 2 }, { from: 'raw', to: 'r', key: D, perSecond: 1 },
    { from: 'r', to: 'out', key: R, perSecond: 1 },
  ] });
}

const network = (kind: 'routed' | 'ae2' | 'enderio') => makeScan({ logistics: [{ kind, taps: [[0, 64, 0]], channelsMax: 32 }] }).logistics[0]!;

function laid(mode: LogisticsMode, plan: Plan = resistorLine(), pack: Pack = benchPack()) {
  const placement = placeUnits(unitsFromPlan(pack, plan, { primitive: mode !== 'direct' }).units, { headWidth: 1, portSpacing: PORT_SPACING[mode] });
  const r = buildMode(mode, { pack, plan, parts: resolveParts(pack), placement, network: mode === 'direct' ? null : network(mode) });
  return { pack, placement, r };
}

const benchBlock = (blocks: readonly LayoutBlock[]) => blocks.find((b) => b.role === 'machine' && b.block.mteId === AUTO_WORKBENCH)!;
const whitelist = (kind: string, keys: StuffKey[]) => ({ kind, filter: { mode: 'whitelist', keys } });

describe('the Auto Workbench in a line', () => {
  it('stands with its back on the middle row and its front, which takes its power, away from it, its grid set', () => {
    const { placement } = laid('ae2');
    const unit = placement.units.find((u) => u.stepId === 'r')!;
    const bench = benchBlock(placement.blocks);
    // GT++'s bench pushes what it makes out of its back (`isOutputFacing`), takes EU on every other face (`isInputFacing`)
    expect(bench.facing).toBe(unit.facing === 3 ? 2 : 3);
    expect(bench.mainFacing).toBeUndefined();
    expect(unit.ports.power).toEqual(stepTo(bench.pos, bench.facing!));
    expect(unit.ports.items).toEqual([stepTo(bench.pos, unit.facing)]);
    // no output cover (covers fit neither its front nor its back) and no fluid port
    expect([unit.ports.itemFaces, unit.ports.fluidIn, unit.ports.fluidOut]).toEqual([[], [], []]);
    expect(bench.feed).toEqual({ bench: { mode: 'normal', grid: [A, B, A, C, D, C, null, B, null], throughput: 0 } });
  });

  it('says how to place it and how to set its mode, grid and button', async () => {
    const layout = await layoutLine(benchPack(), resistorLine(), emptyScan(), makeProject({ logistics: 'ae2', scanId: null, baseId: null }));
    const text = (id: string) => layout.buildSteps.find((s) => s.id === id)?.text;
    expect(text('layout:place:r')).toBe('Place 1× Auto Workbench (MV) with its back, the face with the pipe opening (the front shows a crafting grid), '
      + 'toward the middle row: with a Wrench, right-click its side away from the middle row to make that its front; run its power cable to the front '
      + 'or a side, never the back, and keep fluid pipes off it');
    expect(text('layout:configure:r')).toBe('Auto Workbench (MV): mode Normal Crafting Table (the bottom-left button; its tooltip names the mode); '
      + 'grid, top row first: Resin, Fine Wire, Resin / Wire, Carbon, Wire / empty, Fine Wire, empty; leave the top-left button on its first state');
    // no Input from Output Side or Multi Stack Input to set: GT++'s bench has neither
    expect(benchBlock(layout.blocks).config).toBeUndefined();
  });

  it('AE2: one pattern exactly equal to the grid, blocking mode off and a Locking Card', () => {
    const { pack, r } = laid('ae2');
    const iface = r.blocks.find((b) => b.label === 'ME Interface (Auto Workbench (MV))')!;
    expect(iface.feed).toEqual({ interface: { patterns: [{ inputs: [{ key: A, amount: 2 }, { key: B, amount: 2 }, { key: C, amount: 2 }, { key: D, amount: 1 }],
      outputs: [{ key: R, amount: 1 }] }], blocking: false, lock: 'until_result' } });
    // it pushes its result into the interface itself: no conveyor cover
    expect(r.covers.filter((c) => c.cover.item === 'gregtech:gt.metaitem.01@32630').map((c) => c.pos)).toHaveLength(1);
    expect(r.extraParts).toEqual([
      { key: 'appliedenergistics2:item.ItemMultiMaterial@52', amount: 2, why: 'one processing pattern per machine', group: 'logistics' },
      { key: 'appliedenergistics2:item.ItemMultiMaterial@65', amount: 1, why: 'Locking Card on each Auto Workbench\'s interface', group: 'logistics' }]);
    expect(resolveParts(pack).ae2_locking_card.found).toBe(true);
    expect(r.warnings).toEqual([]);
  });

  it('Project Red: an Item Stock Keeper Chip keeps its stock, fed by Item Broadcaster Chips on what supplies it', () => {
    const { r } = laid('routed');
    const chips = (label: string) => r.blocks.find((b) => b.label === label)?.feed?.chips;
    // at a craft a second the Stock Keeper's 5 s cadence asks for 5 crafts of stock (research §3.6)
    expect(chips('Routed Interface Pipe (Auto Workbench (MV))')).toEqual([
      { kind: 'stock_keeper', stock: [{ key: A, count: 10 }, { key: B, count: 10 }, { key: C, count: 5 * 2 }, { key: D, count: 5 }], requestMode: 'when_missing' },
      whitelist('extractor', [R])]);
    // the Fine Wire goes only to the bench: the macerator broadcasts it, and no Extractor sends it out
    expect(chips('Routed Interface Pipe (Basic Macerator)')).toEqual([whitelist('responder', ['t:in@0']), whitelist('broadcaster', [B])]);
    // the bench's raw inputs wait in the input chest for its orders; the macerator's Raw Input goes out as before
    expect(chips('Routed Interface Pipe (input chest)')).toEqual([whitelist('extractor', ['t:in@0']), whitelist('broadcaster', [A, C, D])]);
    // what only benches take, lost after a restart, ends in the output chest, below every machine
    expect(chips('Routed Interface Pipe (output chest)')).toEqual([whitelist('terminator', [A, B, C, D, R])]);
    expect(r.extraParts.map((p) => [p.key.replace('ProjRed|Transportation:projectred.transportation.routingchip', 'chip'), p.amount])).toEqual([
      ['chip@0', 1], ['chip@4', 2], ['chip@3', 1], ['chip@5', 2], ['chip@6', 1]]);
    expect(r.warnings.filter((w) => w.code.startsWith('bench_'))).toEqual([]);
  });

  it('EnderIO: a Limited Item Filter on the bench face lets each ingredient in up to two crafts and its grid cells', () => {
    const { r } = laid('enderio');
    const face = r.blocks.flatMap((b) => b.conduits ?? []).flatMap((c) => c.faces).find((f) => f.target === 'Auto Workbench (MV)')!;
    expect(face.mode).toBe('in_out');
    expect(face.insert!.filter).toEqual({ item: 'EnderIO:itemLimitedItemFilter@0', whitelist: true, keys: [A, B, C, D], limits: [6, 6, 6, 3],
      matchMeta: true, matchNbt: false, oreDict: false, sticky: false, slots: 10 });
    expect(face.insert!.outputSide).toBeUndefined();
    expect(face.extract!.filter).toMatchObject({ item: 'EnderIO:itemBasicFilterUpgrade@0', keys: [R] });
    expect(r.warnings.filter((w) => w.code.startsWith('bench_'))).toEqual([]);
    // the conduit's configure step says each count, and that it counts the grid's cells (research §2.1, §3.7)
    expect(conduitSideText('insert', face.insert!, (k) => benchPack().nameOf(k))).toBe('insert on Red with a Limited Item Filter (whitelist, '
      + '4 of 10 slots: Resin 6, Fine Wire 6, Wire 6 and Carbon 3, each count with its cells in the crafting grid; match meta, ignore NBT), priority 1');
  });

  it('machine to machine: no pipe touches it, and it says to fill it by hand', () => {
    const { placement, r } = laid('direct');
    const bench = benchBlock(placement.blocks);
    const toward = stepTo(bench.pos, placement.units.find((u) => u.stepId === 'r')!.facing);
    const pipe = r.blocks.find((b) => b.pos.join() === toward.join())!;
    // the spine pipe runs on past it, never joined to its back
    const side = [0, 1, 2, 3, 4, 5].find((s) => stepTo(toward, s).join() === bench.pos.join())!;
    expect(((pipe.connections ?? 0) & (1 << side)) === 0).toBe(true);
    expect(r.configs.some((c) => c.pos.join() === bench.pos.join())).toBe(false);
    expect(r.warnings.filter((w) => w.code === 'bench_by_hand')).toEqual([{ code: 'bench_by_hand', stepId: 'r',
      text: 'Fill this Auto Workbench by hand: machine-to-machine lines cannot cap its ingredients yet' }]);
  });

  it('hands back the empty container of a filled one in its grid, into your storage, in every mode', () => {
    // a craft puts the empty cell in its output slots; left there they fill up and it stops (research §1.3.7, C14)
    const pack = benchPack();
    pack.recipeById.set('r', craftingRecipe('r', 3, [A, CELL], [R, 1]));
    const plan = makePlan([{ id: 'r', mteId: AUTO_WORKBENCH, count: 1, tier: 2, inputs: [[A, 1], [CELL, 1]], outputs: [[R, 1]] }]);
    plan.flows = [{ from: 'raw', to: 'r', key: A, perSecond: 1 }, { from: 'raw', to: 'r', key: CELL, perSecond: 1 }, { from: 'r', to: 'out', key: R, perSecond: 1 }];
    expect(laid('ae2', plan, pack).r.blocks.find((b) => b.role === 'interface')!.feed?.interface?.patterns[0]!.outputs)
      .toEqual([{ key: R, amount: 1 }, { key: EMPTY_CELL, amount: 1 }]);
    const routed = laid('routed', plan, pack).r;
    expect(routed.blocks.find((b) => b.label === 'Routed Interface Pipe (Auto Workbench (MV))')!.feed?.chips?.at(-1))
      .toEqual(whitelist('extractor', [EMPTY_CELL, R]));
    expect(routed.blocks.find((b) => b.label === 'Routed Interface Pipe (output chest)')!.feed?.chips).toEqual([whitelist('terminator', [A, EMPTY_CELL, R, CELL])]);
    const enderio = laid('enderio', plan, pack).r;
    const faces = enderio.blocks.flatMap((b) => b.conduits ?? []).flatMap((c) => c.faces);
    expect(faces.find((f) => f.target === 'Auto Workbench (MV)')!.extract!.filter?.keys).toEqual([EMPTY_CELL, R]);
    expect(faces.filter((f) => f.target === 'Chest (output)').flatMap((f) => f.insert?.filter?.keys ?? [])).toEqual([EMPTY_CELL, R]);
  });

  it('says a bench cannot keep crafting a recipe whose grid holds a tool, in every mode', async () => {
    // a craft wears a GT tool out of its grid match, or uses a single-use one up (research §1.3.4)
    const pack = benchPack();
    pack.recipeById.set('r', craftingRecipe('r', 3, [A, FILE], [R, 1], [1]));
    const plan = makePlan([{ id: 'r', mteId: AUTO_WORKBENCH, count: 1, tier: 2, inputs: [[A, 1]], outputs: [[R, 1]] }]);
    const TOOL = { code: 'bench_tool', stepId: 'r', text: 'Auto Workbench (MV) cannot keep crafting Resistor: its grid holds File, which every craft '
      + 'wears out or uses up, so it stops after one craft — craft Resistor by hand, or put a fresh one in for every craft' };
    for (const primitive of [true, false]) expect(unitsFromPlan(pack, plan, { primitive }).warnings, String(primitive)).toEqual([TOOL]);
    for (const mode of ['ae2', 'routed', 'enderio', 'direct'] as const) {
      const layout = await layoutLine(pack, plan, emptyScan(), makeProject({ logistics: mode, scanId: null, baseId: null }));
      expect(layout.warnings.filter((w) => w.code === 'bench_tool'), mode).toEqual([TOOL]);
    }
    expect(benchBlock(laid('ae2', plan, pack).placement.blocks).feed?.bench?.grid).toEqual([A, FILE, null, null, null, null, null, null, null]);
  });

  it('says where a Project Red stock at its planned rate cannot fit its safe input slots', () => {
    // three ingredients of three cells each at 10 crafts a second: the Stock Keeper's 5 s cadence keeps 50 crafts, 150 of
    // each, three stacks apiece, nine slots (research §3.6, §6.1 item 8)
    const pack = benchPack();
    pack.recipeById.set('r', craftingRecipe('r', 3, [A, A, A, C, C, C, D, D, D], [R, 1]));
    const at = (perSecond: number): Plan => {
      const plan = makePlan([{ id: 'r', mteId: AUTO_WORKBENCH, count: 1, tier: 2, inputs: [[A, 3], [C, 3], [D, 3]], outputs: [[R, 1]] }],
        { flows: [...[A, C, D].map((key) => ({ from: 'raw', to: 'r', key, perSecond: 3 * perSecond })), { from: 'r', to: 'out', key: R, perSecond }] });
      plan.steps[0]!.runsPerSecond = perSecond;
      return plan;
    };
    const cap = (mode: LogisticsMode, perSecond: number) => laid(mode, at(perSecond), pack).r.warnings.filter((w) => w.code === 'bench_cap');
    expect(cap('routed', 10)).toEqual([{ code: 'bench_cap', stepId: 'r', text: 'Auto Workbench (MV) crafting Resistor cannot keep its ingredients '
      + 'within the 8 input slots it fills safely at its planned rate on this line (it would take 9): when one runs short it throws a stack out of its '
      + 'back and stops — give it more Auto Workbenches so each crafts less, craft Resistor by hand, or plan the line on AE2' }]);
    // at 1 a second, 5 crafts: 15 of each, a slot apiece
    expect(cap('routed', 1)).toEqual([]);
    // EnderIO keeps two crafts whatever the rate, which the planner's cap rule (controller ruling 214 (c)) always fits; AE2
    // pushes one whole set at a time behind its Locking Card
    expect(cap('enderio', 10)).toEqual([]);
    expect(cap('ae2', 10)).toEqual([]);
  });

  it("grids a single-use variant with its tool as an ingredient, so it keeps crafting and AE2 can encode its pattern", async () => {
    // controller ruling 214 (a): the variant's file slot is a consumed input of GGFab's Single Use File, one a craft
    const pack = benchPack();
    const FILE1 = 'ggfab:gt.ggfab.d1@0';
    pack.items.set(FILE1, { key: FILE1, id: 'ggfab:gt.ggfab.d1', meta: 0, name: 'Single Use File', oreDict: ['craftingToolFile'] });
    pack.recipeById.set('r', { ...craftingRecipe('r', 3, [A, FILE1], [R, 1]), meta: { ...craftingRecipe('r', 3, [A, FILE1], [R, 1]).meta, benchVariantOf: 'r0' } });
    const plan = makePlan([{ id: 'r', mteId: AUTO_WORKBENCH, count: 1, tier: 2, inputs: [[A, 1], [FILE1, 1]], outputs: [[R, 1]] }],
      { flows: [{ from: 'raw', to: 'r', key: A, perSecond: 1 }, { from: 'raw', to: 'r', key: FILE1, perSecond: 1 }, { from: 'r', to: 'out', key: R, perSecond: 1 }] });
    expect(unitsFromPlan(pack, plan, { primitive: true }).warnings).toEqual([]);
    const { placement, r } = laid('ae2', plan, pack);
    expect(benchBlock(placement.blocks).feed?.bench?.grid).toEqual([A, FILE1, null, null, null, null, null, null, null]);
    expect(r.blocks.find((b) => b.role === 'interface')?.feed?.interface?.patterns).toEqual([{ inputs: [{ key: A, amount: 1 }, { key: FILE1, amount: 1 }], outputs: [{ key: R, amount: 1 }] }]);
    const layout = await layoutLine(pack, plan, emptyScan(), makeProject({ logistics: 'ae2', scanId: null, baseId: null }));
    expect(layout.warnings.filter((w) => w.code === 'bench_tool' || w.code === 'feed_pattern_unencodable')).toEqual([]);
  });
});

describe('a bench ingredient that also leaves the line, on Project Red (plan 12 final review)', () => {
  it('is offered back from the output chest, and the feeding rules name the bench and the good where it is not (R10)', async () => {
    // The macerator's Fine Wire goes to the bench and, 1 a second, out of the line. Its Item Extractor Chip sends every
    // wire on as soon as it is made, past the bench (a Stock Keeper only orders) to the output chest's Terminator, so the
    // bench orders its wire from there: the output chest broadcasts it (research machine-feeding §2.2, §3.6).
    const pack = benchPack();
    const plan = resistorLine();
    plan.steps.find((s) => s.id === 'm')!.runsPerSecond = 3;
    plan.flows = [...plan.flows.map((f) => (f.from === 'raw' && f.to === 'm' ? { ...f, perSecond: 3 } : f)), { from: 'm', to: 'out', key: B, perSecond: 1 }];
    const { r } = laid('routed', plan, pack);
    const chips = (label: string) => r.blocks.find((b) => b.label === label)?.feed?.chips;
    expect(chips('Routed Interface Pipe (Basic Macerator)')).toEqual([whitelist('responder', ['t:in@0']), whitelist('extractor', [B]), whitelist('broadcaster', [B])]);
    expect(chips('Routed Interface Pipe (output chest)')).toEqual([whitelist('broadcaster', [B]), whitelist('terminator', [A, B, C, D, R])]);
    const layout = await layoutLine(pack, plan, emptyScan(), makeProject({ logistics: 'routed', scanId: null, baseId: null }));
    expect(layout.warnings.filter((w) => w.code.startsWith('feed_'))).toEqual([]);
    // Without that Broadcaster the bench starves, and R10 says so.
    const bare = { ...layout, blocks: layout.blocks.map((b) => (b.label !== 'Routed Interface Pipe (output chest)' ? b
      : { ...b, feed: { chips: b.feed!.chips!.filter((c) => c.kind !== 'broadcaster') } })) };
    const chest = bare.blocks.find((b) => b.label === 'Chest (output)')!;
    const bench = benchBlock(bare.blocks);
    expect(feedingWarnings({ pack, plan, layout: bare })).toEqual([{ code: 'feed_starved', stepId: 'r', key: B,
      text: `${bench.label} at ${bench.pos.join(' ')} may never get Fine Wire: an Item Extractor Chip sends it on as soon as it is made, and the `
        + `Item Terminator Chip on ${chest.label} at ${chest.pos.join(' ')} takes it in with no Item Broadcaster Chip there to fill the bench's orders` }]);
  });
});

describe('the feeding rules on a bench', () => {
  it('find nothing on the lines the layout lays, and flag blocking mode toward a bench (R9)', async () => {
    const pack = benchPack();
    const lay = (mode: LogisticsMode): Promise<Layout> => layoutLine(pack, resistorLine(), emptyScan(), makeProject({ logistics: mode, scanId: null, baseId: null }));
    for (const mode of ['routed', 'ae2', 'enderio'] as const) {
      expect((await lay(mode)).warnings.filter((w) => w.code.startsWith('feed_')), mode).toEqual([]);
    }
    const ae2 = await lay('ae2');
    const blocked = { ...ae2, blocks: ae2.blocks.map((b) => (b.feed?.interface === undefined || !b.label.includes('Auto Workbench') ? b
      : { ...b, feed: { interface: { ...b.feed.interface, blocking: true } } })) };
    const iface = blocked.blocks.find((b) => b.label === 'ME Interface (Auto Workbench (MV))')!;
    const bench = benchBlock(blocked.blocks);
    expect(feedingWarnings({ pack, plan: resistorLine(), layout: blocked })).toEqual([{ code: 'feed_starved', stepId: 'r',
      text: `${iface.label} at ${iface.pos.join(' ')} has blocking mode on toward ${bench.label} at ${bench.pos.join(' ')}, an Auto Workbench: blocking `
        + 'mode counts the items of its crafting grid, so it never pushes into it' }]);
  });
});
