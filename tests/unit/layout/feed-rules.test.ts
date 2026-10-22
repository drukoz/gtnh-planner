// The static feeding rules as layout warnings (architecture §11 entry 51; research docs/research/machine-feeding.md §7,
// with add-on 21's rule table R1–R9 and R12, its codes and its words): what a laid-out routed, AE2 or EnderIO line
// leaves that would overfill or deadlock a machine. The lines the layout lays are clean; each rule is shown on a line
// changed to break it, as a builder could set it wrong.

import { describe, expect, it } from 'vitest';
import { feedingWarnings } from '../../../src/server/layout/feed-rules.ts';
import { emptyScan, layoutLine } from '../../../src/server/layout/layout.ts';
import { emptyContext, planLine } from '../../../src/server/planner/plan.ts';
import type { StuffKey } from '../../../src/shared/keys.ts';
import { posKey } from '../../../src/shared/layout/geometry.ts';
import { defaultSettings } from '../../../src/shared/project/apply-op.ts';
import type { RoutedChipSpec } from '../../../src/shared/types/feed.ts';
import type { Layout, LayoutBlock } from '../../../src/shared/types/layout.ts';
import type { Pack } from '../../../src/shared/types/pack.ts';
import type { LogisticsMode, Plan, PlanSettings } from '../../../src/shared/types/plan.ts';
import { LV_MACHINE_PARTS, withBuildRecipes } from '../../helpers/build-fixtures.ts';
import { addLineParts, IDS, layoutPack, makePlan, makeProject } from '../../helpers/layout-fixtures.ts';
import { MINI_GT } from '../../helpers/mini-gt.ts';
import { packFromSpec } from '../../helpers/pack-spec.ts';

const SCHEMATIC = 'gregtech:gt.metaitem.01@32498';

function namedPack(): Pack {
  const p = layoutPack();
  for (const [key, name] of [['t:x@0', 'Ex'], ['t:y@0', 'Why'], [SCHEMATIC, 'Schematic (Dusts)']] as const) {
    p.items.set(key, { key, id: key.slice(0, key.lastIndexOf('@')), meta: Number(key.slice(key.lastIndexOf('@') + 1)), name, oreDict: [] });
  }
  return p;
}

function lay(pack: Pack, plan: Plan, mode: LogisticsMode): Promise<Layout> {
  return layoutLine(pack, plan, emptyScan(), makeProject({ logistics: mode, scanId: null, baseId: null }));
}

const at = (b: Pick<LayoutBlock, 'label' | 'pos'>): string => `${b.label} at ${b.pos.join(' ')}`;
const feedCodes = (layout: Layout) => layout.warnings.filter((w) => w.code.startsWith('feed_'));
/** A copy of `layout` with each block `change` maps differently. */
function changed(layout: Layout, change: (b: LayoutBlock) => LayoutBlock): Layout {
  return { ...layout, blocks: layout.blocks.map((b) => change(structuredClone(b))) };
}

/** a (an MV assembler, 9 input slots) takes Raw Input and Titanium Dust from your storage and makes Ex for m (a macerator), which makes Why. */
const twoKinds = () => makePlan([
  { id: 'a', mteId: IDS.ASSEMBLER, count: 1, tier: 2, inputs: [['t:in@0', 1], ['t:dust@0', 1]], outputs: [['t:x@0', 1]] },
  { id: 'm', mteId: IDS.MACERATOR, count: 1, inputs: [['t:x@0', 1]], outputs: [['t:y@0', 1]] },
], { flows: [{ from: 'raw', to: 'a', key: 't:in@0', perSecond: 1 }, { from: 'raw', to: 'a', key: 't:dust@0', perSecond: 1 },
  { from: 'a', to: 'm', key: 't:x@0', perSecond: 1 }, { from: 'm', to: 'out', key: 't:y@0', perSecond: 1 }] });
/** e (an EBF) takes Raw Input and Titanium Dust through one input bus and makes Titanium Ingot. */
const ebf = () => makePlan([{ id: 'e', mteId: IDS.EBF, count: 1, tier: 2, euPerTick: 120, inputs: [['t:in@0', 1], ['t:dust@0', 1]],
  outputs: [['t:ingot@0', 1]] }], { flows: [{ from: 'raw', to: 'e', key: 't:in@0', perSecond: 1 }, { from: 'raw', to: 'e', key: 't:dust@0', perSecond: 1 },
  { from: 'e', to: 'out', key: 't:ingot@0', perSecond: 1 }] });

describe('static feeding rules', () => {
  it.each(['routed', 'ae2', 'enderio'] as const)('find nothing on the lines the layout lays (%s)', async (mode) => {
    const pack = namedPack();
    for (const plan of [twoKinds(), ebf()]) {
      const layout = await lay(pack, plan, mode);
      expect(feedCodes(layout)).toEqual([]);
      expect(feedingWarnings({ pack, plan, layout })).toEqual([]);
    }
  });

  it('counts the kinds a machine takes against its input slots less what it holds (R1)', async () => {
    const pack = namedPack();
    const keys = Array.from({ length: 10 }, (_, i): StuffKey => `t:k${i}@0`);
    const plan = makePlan([{ id: 'a', mteId: IDS.ASSEMBLER, count: 1, tier: 2, inputs: keys.map((k): [StuffKey, number] => [k, 1]) }]);
    const layout = await lay(pack, plan, 'enderio');
    const a = layout.blocks.find((b) => b.role === 'machine')!;
    expect(feedCodes(layout)).toEqual([{ code: 'feed_crowded', stepId: 'a',
      text: `${at(a)} takes 10 kinds of item but has 9 input slots free: one kind always waits` }]);

    // a 1-slot macerator that holds a schematic in its input slot has none left for its one kind
    const held = makePlan([{ id: 'm', mteId: IDS.MACERATOR, count: 1 }]);
    pack.recipeById.set('m', { id: 'm', source: 'gt', maps: [], euPerTick: 30, durationTicks: 20, amps: 1, specialValue: 0, meta: {}, flags: {},
      inputs: [{ slot: 0, consumed: true, chance: 1, options: [{ key: 't:in@0', amount: 1 }] },
        { slot: 1, consumed: false, chance: 0, options: [{ key: SCHEMATIC, amount: 1 }] }],
      outputs: [{ key: 't:out_m@0', amount: 1, chance: 1 }] });
    const m = await lay(pack, held, 'enderio');
    expect(feedCodes(m).map((w) => w.text)).toEqual([`${at(m.blocks.find((b) => b.role === 'machine')!)} takes 1 kind of item but has 0 input slots `
      + 'free (1 held: Schematic (Dusts)): one kind always waits']);
  });

  it('counts the kinds of every recipe a shared machine runs (R1, plan 12)', async () => {
    // an AE2 sharing pool on the 1-slot macerator: s1 takes one kind, s2 two, which one input slot never holds at once
    const pack = namedPack();
    const pool = { id: 'pool:s1', steps: ['s1', 's2'] };
    const plan = makePlan([{ id: 's1', mteId: IDS.MACERATOR, count: 1, pool },
      { id: 's2', mteId: IDS.MACERATOR, count: 1, pool, inputs: [['t:out_s1@0', 1], ['t:dust@0', 1]] }], { flows: [
      { from: 'raw', to: 's1', key: 't:in@0', perSecond: 1 }, { from: 's1', to: 's2', key: 't:out_s1@0', perSecond: 1 },
      { from: 'raw', to: 's2', key: 't:dust@0', perSecond: 1 }, { from: 's2', to: 'out', key: 't:out_s2@0', perSecond: 1 }] });
    const layout = await lay(pack, plan, 'ae2');
    const m = layout.blocks.find((b) => b.role === 'machine')!;
    expect(m.stepIds).toEqual(['s1', 's2']);
    expect(feedCodes(layout)).toEqual([{ code: 'feed_crowded', stepId: 's1', text: `${at(m)} takes 2 kinds of item but has 1 input slot free: one kind always waits` }]);
  });

  it('flags Multi Stack Input left unset or set On on a machine fed two kinds, in a line that pushes (R2)', async () => {
    const pack = namedPack();
    const layout = await lay(pack, twoKinds(), 'enderio');
    const a = layout.blocks.find((b) => b.role === 'machine' && b.stepId === 'a')!;
    const setTo = (value: boolean) => changed(layout, (b) => (b.stepId === 'a' && b.role === 'machine' ? { ...b, config: { ...b.config, multiStack: value } } : b));
    const unset = changed(layout, (b) => {
      if (b.stepId !== 'a' || b.role !== 'machine') return b;
      const { multiStack: _drop, ...config } = b.config!;
      return { ...b, config };
    });
    expect(feedingWarnings({ pack, plan: twoKinds(), layout: unset })).toEqual([{ code: 'feed_crowded', stepId: 'a', text: `${at(a)} takes 2 kinds of item `
      + 'and the layout does not set Multi Stack Input Off: with it On, the first kind to arrive fills every free input slot' }]);
    expect(feedingWarnings({ pack, plan: twoKinds(), layout: setTo(true) })).toEqual([{ code: 'feed_crowded', stepId: 'a', text: `${at(a)} has Multi `
      + 'Stack Input On and takes 2 kinds of item: the first kind to arrive fills every free input slot' }]);
    // AE2 pushes a whole set at a time with blocking mode on: no R2 there
    const ae2 = await lay(pack, twoKinds(), 'ae2');
    expect(feedingWarnings({ pack, plan: twoKinds(), layout: changed(ae2, (b) => (b.stepId === 'a' && b.role === 'machine'
      ? { ...b, config: { ...b.config, multiStack: true } } : b)) })).toEqual([]);
  });

  it('flags an input bus fed two kinds without Limiting mode, and two input buses with Input Separation on (R3, R4)', async () => {
    const pack = namedPack();
    const layout = await lay(pack, ebf(), 'enderio');
    const controller = layout.blocks.find((b) => b.role === 'machine')!;
    const bus = layout.blocks.find((b) => b.hatch === 'input_bus')!;
    const unlimited = changed(layout, (b) => (b.hatch === 'input_bus' ? { ...b, config: { ...b.config, limited: false } } : b));
    expect(feedingWarnings({ pack, plan: ebf(), layout: unlimited })).toEqual([{ code: 'feed_overfill', stepId: 'e',
      text: `${at(bus)} of ${at(controller)} takes 2 kinds of item without Limiting mode: one kind can fill every slot of the bus` }]);
    // a second input bus on a casing (the EBF has Input Separation, on when built)
    const casing = layout.blocks.find((b) => b.role === 'casing' && b.stepId === 'e' && b.pos[1] === controller.pos[1])!;
    const twoBuses = changed(layout, (b) => (posKey(b.pos) === posKey(casing.pos)
      ? { ...b, role: 'hatch', hatch: 'input_bus', label: bus.label, config: { limited: true } } : b));
    expect(feedingWarnings({ pack, plan: ebf(), layout: twoBuses })).toEqual([{ code: 'feed_crowded', stepId: 'e', text: `${at(controller)} has 2 input `
      + 'buses with Input Separation on: each bus is checked alone, so a recipe whose items arrive on different buses never starts' }]);
    expect(feedingWarnings({ pack, plan: ebf(), layout: changed(twoBuses, (b) => (b.role === 'machine' ? { ...b, config: { inputSeparation: false } } : b)) }))
      .toEqual([]);
    // the Pyrolyse Oven starts with Input Separation on too; a controller without the setting reads all its buses together
    pack.machines.get(IDS.EBF)!.cls = 'gregtech.common.tileentities.machines.multi.MTEPyrolyseOven';
    expect(feedingWarnings({ pack, plan: ebf(), layout: twoBuses }).map((w) => w.code)).toEqual(['feed_crowded']);
    pack.machines.get(IDS.EBF)!.cls = 'gregtech.common.tileentities.machines.multi.MTEVacuumFreezer';
    expect(feedingWarnings({ pack, plan: ebf(), layout: twoBuses })).toEqual([]);
  });

  describe('routed chips (R5, R6)', () => {
    const chipsOn = (layout: Layout, label: string, chips: RoutedChipSpec[]) =>
      changed(layout, (b) => (b.label === label ? { ...b, feed: { chips } } : b));

    it('finds an output nothing takes out, an input listed for extraction, and an extractor on an input bus', async () => {
      const pack = namedPack();
      const layout = await lay(pack, twoKinds(), 'routed');
      const a = layout.blocks.find((b) => b.role === 'machine' && b.stepId === 'a')!;
      const pipe = 'Routed Interface Pipe (Advanced Assembler)';
      const responder: RoutedChipSpec = { kind: 'responder', filter: { mode: 'whitelist', keys: ['t:dust@0', 't:in@0'] } };
      const extractor = (keys: StuffKey[]): RoutedChipSpec => ({ kind: 'extractor', filter: { mode: 'whitelist', keys } });
      const warn = (l: Layout) => feedingWarnings({ pack, plan: twoKinds(), layout: l });
      expect(warn(chipsOn(layout, pipe, [responder, extractor([])]))).toEqual([{ code: 'feed_no_route', stepId: 'a', key: 't:x@0',
        text: `Nothing takes Ex out of ${at(a)}: its Item Extractor Chip has an empty whitelist (a new chip extracts nothing)` }]);
      expect(warn(chipsOn(layout, pipe, [responder, extractor(['t:y@0'])])).map((w) => w.text)).toEqual([
        `Nothing takes Ex out of ${at(a)}: its Item Extractor Chip does not list it`]);
      expect(warn(chipsOn(layout, pipe, [responder])).map((w) => w.text)).toEqual([`Nothing takes Ex out of ${at(a)}: no Item Extractor Chip is on its `
        + 'interface pipe']);
      expect(warn(chipsOn(layout, pipe, [responder, extractor(['t:x@0', 't:in@0'])]))).toEqual([{ code: 'feed_starved', stepId: 'a', key: 't:in@0',
        text: `The Item Extractor Chip on ${at(a)} also lists Raw Input, which it cannot take back out: each time it tries it first, it gives up the whole update` }]);

      const furnace = await lay(pack, ebf(), 'routed');
      const controller = furnace.blocks.find((b) => b.role === 'machine')!;
      const bus = furnace.blocks.find((b) => b.hatch === 'input_bus')!;
      const busPipe = furnace.blocks.find((b) => b.role === 'chip_pipe' && b.feed?.chips?.[0]?.kind === 'responder' && b.label.includes('Electric Blast'))!;
      const extracting = changed(furnace, (b) => (posKey(b.pos) === posKey(busPipe.pos)
        ? { ...b, feed: { chips: [...b.feed!.chips!, extractor(['t:ingot@0'])] } } : b));
      expect(feedingWarnings({ pack, plan: ebf(), layout: extracting })).toEqual([{ code: 'feed_churn', stepId: 'e',
        text: `The Item Extractor Chip on ${at(bus)} pulls ${at(controller)}'s inputs back out of its input bus` }]);
    });

    it('finds a supply the input chest keeps in, and an item with nowhere to go', async () => {
      const pack = namedPack();
      const layout = await lay(pack, twoKinds(), 'routed');
      const a = layout.blocks.find((b) => b.role === 'machine' && b.stepId === 'a')!;
      const m = layout.blocks.find((b) => b.role === 'machine' && b.stepId === 'm')!;
      const chest = layout.blocks.find((b) => b.tail?.side === 'input')!;
      const keptIn = chipsOn(layout, 'Routed Interface Pipe (input chest)', [{ kind: 'extractor', filter: { mode: 'whitelist', keys: ['t:in@0'] } }]);
      expect(feedingWarnings({ pack, plan: twoKinds(), layout: keptIn })).toEqual([{ code: 'feed_starved', stepId: 'a', key: 't:dust@0',
        text: `${at(a)} never gets Titanium Dust: the Item Extractor Chip on ${at(chest)} does not list it` }]);
      const nowhere = chipsOn(layout, 'Routed Interface Pipe (output chest)', []);
      expect(feedingWarnings({ pack, plan: twoKinds(), layout: nowhere })).toEqual([{ code: 'feed_no_route', stepId: 'm', key: 't:y@0',
        text: `Nothing on the routed network takes Why from ${at(m)}: no Item Responder Chip lists it` }]);

      // an item for a step without machines (hand-crafted here) names it
      const hand = makePlan([{ id: 'a', mteId: IDS.ASSEMBLER, count: 1, tier: 2, inputs: [['t:in@0', 1]], outputs: [['t:x@0', 1]] },
        { id: 'h', mteId: -3, count: 1, handCraft: true, inputs: [['t:x@0', 1]], outputs: [['t:y@0', 1]] }]);
      hand.steps[1]!.mainOutput = 't:y@0';
      const handLayout = await lay(pack, hand, 'routed');
      const ha = handLayout.blocks.find((b) => b.role === 'machine')!;
      expect(feedingWarnings({ pack, plan: hand, layout: chipsOn(handLayout, 'Routed Interface Pipe (output chest)', []) }).map((w) => w.text)).toEqual([
        `Nothing on the routed network takes Ex from ${at(ha)}: no Item Responder Chip lists it (it goes to Why, which has no machine)`]);
    });
  });

  describe('AE2 patterns (R8, R9, R12)', () => {
    it('finds patterns AE2 cannot encode, blocking mode toward a held item it does not ignore, and an interface touching two inventories', async () => {
      const pack = namedPack();
      // a chemical reactor (2 input slots) holding a schematic in one of them
      const plan = makePlan([{ id: 'm', mteId: IDS.CHEM_HV, count: 1, tier: 3, outputs: [['t:out_m@0', 1]] }]);
      pack.recipeById.set('m', { id: 'm', source: 'gt', maps: [], euPerTick: 30, durationTicks: 20, amps: 1, specialValue: 0, meta: {}, flags: {},
        inputs: [{ slot: 0, consumed: true, chance: 1, options: [{ key: 't:in@0', amount: 1 }] },
          { slot: 1, consumed: false, chance: 0, options: [{ key: SCHEMATIC, amount: 1 }] }],
        outputs: [{ key: 't:out_m@0', amount: 1, chance: 1 }] });
      const layout = await lay(pack, plan, 'ae2');
      const m = layout.blocks.find((b) => b.role === 'machine')!;
      const iface = layout.blocks.find((b) => b.role === 'interface')!;
      expect(iface.feed?.interface?.blocking).toBe(false);
      const list = (items: Array<[StuffKey, number]>) => items.map(([key, amount]) => ({ key, amount }));
      const pattern = (inputs: Array<[StuffKey, number]>, outputs: Array<[StuffKey, number]>, blocking = false) => changed(layout, (b) => (b.role === 'interface'
        ? { ...b, feed: { interface: { patterns: [{ inputs: list(inputs), outputs: list(outputs) }], blocking } } } : b));
      const warn = (l: Layout) => feedingWarnings({ pack, plan, layout: l });
      expect(warn(pattern([['t:in@0', 1], ['fluid:oxygen', 1000]], [['t:out_m@0', 1], ['fluid:molten.iron', 144]]))).toEqual([
        { code: 'feed_pattern_unencodable', stepId: 'm', key: 'fluid:oxygen', text: `The pattern for ${at(m)} lists Oxygen, a fluid the line pipes: ME never `
          + 'holds it, so AE2 cannot plan with it' },
        { code: 'feed_pattern_unencodable', stepId: 'm', key: 'fluid:molten.iron', text: `The pattern for ${at(m)} makes Molten Iron, which the line pipes `
          + 'away: it never comes back to ME' },
        { code: 'feed_fluid_packet', stepId: 'm', key: 'fluid:oxygen', text: `${at(iface)} turns Oxygen into a Fluid Packet item, which ${at(m)} can take `
          + 'into an input slot for good' }]);
      expect(warn(pattern([['t:in@0', 1]], [['t:out_m@0', 0.5]])).map((w) => w.text)).toEqual([`The pattern for ${at(m)} holds 0.50× t:out_m@0: a `
        + 'pattern holds whole items']);
      expect(warn(pattern([['t:in@0', 1], [SCHEMATIC, 1]], [['t:out_m@0', 1]])).map((w) => w.text)).toEqual([`The pattern for ${at(m)} lists Schematic `
        + `(Dusts), which ${at(m)} keeps and does not use up`]);
      expect(warn(pattern([['t:in@0', 1]], [['t:out_m@0', 1]], true))).toEqual([{ code: 'feed_starved', stepId: 'm', key: SCHEMATIC,
        text: `${at(iface)} has blocking mode on and ${at(m)} holds Schematic (Dusts), which blocking mode does not ignore: it never pushes into it` }]);
      // a chest beside the interface: the interface pushes into it too
      const above = { pos: [iface.pos[0], iface.pos[1] + 1, iface.pos[2]] as [number, number, number], block: { id: 'minecraft:chest', meta: 0 },
        role: 'chest' as const, label: 'Chest' };
      expect(warn({ ...layout, blocks: [...layout.blocks, above] })).toEqual([{ code: 'feed_leak', stepId: 'm',
        text: `${at(iface)} pushes into 2 inventories (${at(m)} and ${at(above)}): its pattern's items can reach the wrong one` }]);
    });
  });

  it.each(['routed', 'ae2', 'enderio'] as const)('lays a Mini-GT circuit line with its feeding settings and no feeding warning (%s)', async (mode) => {
    // Mini-GT's MV circuit: 2 copper wire, 1 redstone and piped molten iron in an assembler; the wire from a wiremill, the molten
    // iron from a fluid extractor. Plan 12 never plans a machine no recipe makes as a new one (Amendment OQ3), so the
    // Advanced Assembler and the Basic Fluid Extractor get a build recipe to keep this route (ruling P3)
    const spec = withBuildRecipes(MINI_GT, [122, 131], LV_MACHINE_PARTS);
    const settings: PlanSettings = { ...defaultSettings(), target: 't:circuit@0', amount: 6, per: 'min', tier: 2, logistics: mode };
    const plan = await planLine(packFromSpec(structuredClone(spec)), settings, emptyContext());
    const pack = addLineParts(packFromSpec(structuredClone(spec)));
    const layout = await layoutLine(pack, plan, emptyScan(), { ...makeProject({ logistics: mode, scanId: null, baseId: null }), settings });
    expect(plan.steps.map((s) => s.id).sort()).toEqual(['circuit-mv', 'extract-iron', 'wire']);
    expect(feedCodes(layout)).toEqual([]);
    const assembler = layout.blocks.find((b) => b.role === 'machine' && b.stepId === 'circuit-mv')!;
    expect(assembler.config?.multiStack).toBe(false);
    if (mode === 'ae2') {
      // the fluid extractor makes only fluid: an export bus; the assembler's pattern leaves the piped molten iron out
      expect(layout.warnings.filter((w) => w.code === 'ae2_no_pattern').map((w) => w.stepId)).toEqual(['extract-iron']);
      expect(layout.blocks.find((b) => b.label === `ME Interface (${assembler.label})`)?.feed?.interface?.patterns).toEqual([{
        inputs: [{ key: 't:copper_wire@0', amount: 2 }, { key: 't:redstone@0', amount: 1 }], outputs: [{ key: 't:circuit@0', amount: 1 }] }]);
    }
    if (mode === 'routed') {
      expect(layout.blocks.find((b) => b.label === `Routed Interface Pipe (${assembler.label})`)?.feed?.chips?.map((c) => [c.kind, c.filter?.keys])).toEqual([
        ['responder', ['t:copper_wire@0', 't:redstone@0']], ['extractor', ['t:circuit@0']]]);
    }
  });
});
