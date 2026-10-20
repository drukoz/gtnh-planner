// AE2 lines whose patterns can be encoded (architecture §11 entry 51; research docs/research/machine-feeding.md §2.3,
// §3.5, §4.2 and §6.4 item 3): a pattern holds the item inputs a machine uses up (no fluid the line pipes, no held item,
// no programmed circuit) and only the item outputs every run gives in whole numbers; a machine with neither gets no
// pattern — one that makes only fluids an ME Export Bus filtered to its inputs, one that takes only fluids nothing,
// one whose item outputs all come by chance nothing that feeds it — and a warning that the line relies on stock (or
// your hands). Blocking mode is on unless the machine holds an item AE2's blocking-ignore list (GT's
// `AE2Compat.registerBlockingModeIgnoreItems`) leaves out, which blocking mode would never push past.

import { describe, expect, it } from 'vitest';
import { placeUnits, unitsFromPlan } from '../../../src/server/layout/arrange.ts';
import { emptyScan, layoutLine } from '../../../src/server/layout/layout.ts';
import { buildMode, PORT_SPACING } from '../../../src/server/layout/modes/mode.ts';
import { ae2IdleEUt, resolveParts } from '../../../src/server/layout/parts.ts';
import type { StuffKey } from '../../../src/shared/keys.ts';
import type { Pack, Product, Recipe } from '../../../src/shared/types/pack.ts';
import type { Plan, PlanStep } from '../../../src/shared/types/plan.ts';
import { IDS, layoutPack, makePlan, makeProject, makeScan, type StepSpec } from '../../helpers/layout-fixtures.ts';

const MOLD = 'gregtech:gt.metaitem.01@32307', SCHEMATIC = 'gregtech:gt.metaitem.01@32498', CIRCUIT = 'gregtech:gt.integrated_circuit@3';
const LENS = 't:lens@0', EXPORT_BUS = 'appliedenergistics2:item.ItemMultiPart@260';

/** The fixture pack with a lens item (GT's `lens` prefix: blocking mode ignores lenses) and two named products. */
function pack(): Pack {
  const p = layoutPack();
  p.items.set(LENS, { key: LENS, id: 't:lens', meta: 0, name: 'Test Lens', oreDict: [], gt: { prefix: 'lens', material: 'Glass', amount: 3_628_800 } });
  for (const [key, name] of [['t:x@0', 'Ex'], ['t:y@0', 'Why']] as const) p.items.set(key, { key, id: key.slice(0, -2), meta: 0, name, oreDict: [] });
  return p;
}

/** A recipe for plan step `s` holding `held` (not consumed) beside its consumed inputs, so the layout sees what the machine keeps. */
function withRecipe(p: Pack, s: PlanStep, held: readonly StuffKey[]): void {
  const recipe: Recipe = {
    id: s.recipeId, source: 'gt', maps: [], euPerTick: s.euPerTick, durationTicks: 20, amps: 1, specialValue: 0, meta: {}, flags: {},
    inputs: [...s.inputs.map((p2, slot) => ({ slot, consumed: true, chance: 1, options: [{ key: p2.key, amount: p2.amount }] })),
      ...held.map((key, i) => ({ slot: 50 + i, consumed: false, chance: 0, options: [{ key, amount: 1 }] }))],
    outputs: s.outputs.map((o) => ({ ...o })),
  };
  p.recipeById.set(recipe.id, recipe);
}

function ae2(p: Pack, plan: Plan) {
  const placement = placeUnits(unitsFromPlan(p, plan).units, { headWidth: 1, portSpacing: PORT_SPACING.ae2 });
  const network = makeScan({ logistics: [{ kind: 'ae2', taps: [[0, 64, 0]], channelsMax: 32 }] }).logistics[0]!;
  return { placement, r: buildMode('ae2', { pack: p, plan, parts: resolveParts(p), placement, network }) };
}

/** One step `s` of `spec` with the outputs and their chances given (makePlan gives every product chance 1). */
function oneStep(spec: StepSpec, outputs?: Product[]): Plan {
  const plan = makePlan([spec]);
  if (outputs !== undefined) plan.steps[0]!.outputs = outputs;
  return plan;
}

const interfaces = (r: ReturnType<typeof ae2>['r']) => r.blocks.filter((b) => b.role === 'interface');

describe('AE2 feeding', () => {
  it('writes patterns of the item inputs used up and the whole item outputs every run gives', () => {
    // c takes 2 Raw Input, 1 Titanium Dust and piped Oxygen; makes 1 Ex every run, Why one run in two and piped Molten Iron
    const plan = oneStep({ id: 'c', mteId: IDS.CHEM_HV, count: 1, tier: 3, inputs: [['t:in@0', 2], ['t:dust@0', 1], ['fluid:oxygen', 1000]] },
      [{ key: 't:x@0', amount: 1, chance: 1 }, { key: 't:y@0', amount: 0.5, chance: 0.5 }, { key: 'fluid:molten.iron', amount: 144, chance: 1 }]);
    const { r } = ae2(pack(), plan);
    expect(interfaces(r).map((b) => [b.label, b.feed, b.config])).toEqual([['ME Interface (Advanced Chemical Reactor)', { interface: {
      patterns: [{ inputs: [{ key: 't:in@0', amount: 2 }, { key: 't:dust@0', amount: 1 }], outputs: [{ key: 't:x@0', amount: 1 }] }], blocking: true } }, undefined]]);
    expect(r.extraParts).toEqual([{ key: 'appliedenergistics2:item.ItemMultiMaterial@52', amount: 1, why: 'one processing pattern per machine', group: 'logistics' }]);
    expect(r.warnings).toEqual([]);
  });

  it('takes the pattern amounts from the recipe, not from the expected amounts of a slot the line splits', () => {
    const p = pack();
    const plan = oneStep({ id: 'm', mteId: IDS.MACERATOR, count: 1, inputs: [['t:in@0', 0.5], ['t:dust@0', 0.5]] });
    plan.steps[0]!.inputs = [{ key: 't:in@0', amount: 0.5, chance: 0.5 }, { key: 't:dust@0', amount: 0.5, chance: 0.5 }];
    p.recipeById.set('m', { id: 'm', source: 'gt', maps: [], euPerTick: 30, durationTicks: 20, amps: 1, specialValue: 0, meta: {}, flags: {},
      inputs: [{ slot: 0, consumed: true, chance: 1, options: [{ key: 't:dust@0', amount: 1 }, { key: 't:in@0', amount: 1 }] }],
      outputs: [{ key: 't:out_m@0', amount: 1, chance: 1 }] });
    // one run takes one item of the slot: the option the line uses most, the slot's first on a tie (here Titanium Dust)
    expect(interfaces(ae2(p, plan).r)[0]!.feed?.interface?.patterns).toEqual([
      { inputs: [{ key: 't:dust@0', amount: 1 }], outputs: [{ key: 't:out_m@0', amount: 1 }] }]);
  });

  it('turns blocking mode on unless the machine holds an item blocking mode does not ignore', () => {
    const blocking = (held: readonly StuffKey[]) => {
      const p = pack();
      const plan = oneStep({ id: 'm', mteId: IDS.MACERATOR, count: 1 });
      withRecipe(p, plan.steps[0]!, held);
      return interfaces(ae2(p, plan).r)[0]!.feed?.interface?.blocking;
    };
    // GT registers its molds, extruder shapes, slicer blades, lenses and the programmed circuit; not the Packager's schematics
    expect([blocking([]), blocking([MOLD]), blocking([CIRCUIT]), blocking([LENS]), blocking([MOLD, CIRCUIT])]).toEqual([true, true, true, true, true]);
    expect([blocking([SCHEMATIC]), blocking([MOLD, SCHEMATIC]), blocking(['t:dust@0'])]).toEqual([false, false, false]);
  });

  it('feeds a machine that makes only fluids through an ME Export Bus filtered to its inputs, and says the line relies on stock', () => {
    const plan = oneStep({ id: 'x', mteId: IDS.EXTRACTOR, count: 1, inputs: [['t:in@0', 1]] }, [{ key: 'fluid:molten.iron', amount: 144, chance: 1 }]);
    const { placement, r } = ae2(pack(), plan);
    const machine = placement.blocks.find((b) => b.role === 'machine')!;
    const port = placement.units[0]!.ports.items[0]!;
    expect(interfaces(r)).toEqual([]);
    expect(r.blocks.filter((b) => b.pos.join(',') === port.join(',')).map((b) => [b.role, b.label])).toEqual([['pipe', 'ME Glass Cable - Fluix']]);
    const side = machine.pos[2] > port[2] ? 'south' : 'north';
    expect(r.covers).toEqual([{ pos: port, cover: { face: side, item: EXPORT_BUS, settings: { mode: 'me_export' }, filter: ['t:in@0'] } }]);
    expect(r.extraParts).toEqual([]);
    expect(r.warnings).toEqual([{ code: 'ae2_no_pattern', stepId: 'x', text: 'AE2 cannot plan the Basic Fluid Extractor: it makes only Molten Iron, '
      + 'which the line pipes on, so no pattern can count what it makes. An ME Export Bus on the cable in front of it feeds it Raw Input whenever '
      + 'your ME storage holds some, so the line relies on that stock: keep Raw Input in storage' }]);
    expect(r.drafts[0]!.text).toBe("Lay ME glass cable along the middle row with an ME interface at every machine's output side or bus, but only "
      + 'cable in front of the Basic Fluid Extractor, with an ME Export Bus on its face toward the machine');
  });

  it('gives an export bus a Capacity Card for each four more items and Acceleration Cards for its rate', () => {
    const plan = oneStep({ id: 'x', mteId: IDS.CHEM_HV, count: 1, tier: 3, inputs: [['t:in@0', 1], ['t:dust@0', 1]] },
      [{ key: 'fluid:molten.iron', amount: 144, chance: 1 }]);
    plan.flows = [{ from: 'raw', to: 'x', key: 't:in@0', perSecond: 2 }, { from: 'raw', to: 'x', key: 't:dust@0', perSecond: 2 },
      { from: 'x', to: 'out', key: 'fluid:molten.iron', perSecond: 288 }];
    const { r } = ae2(pack(), plan);
    // 4 items/s at an operation every 10 ticks: 2 items an operation, one Acceleration Card's 8 (a bare bus moves 1; AE2 rv3 PartExportBus)
    expect(r.covers.map((c) => [c.cover.settings, c.cover.filter])).toEqual([[{ mode: 'me_export', capacityCards: 1, accelerationCards: 1 }, ['t:dust@0', 't:in@0']]]);
    expect(r.extraParts).toEqual([
      { key: 'appliedenergistics2:item.ItemMultiMaterial@27', amount: 1, why: 'ME Export Bus upgrades', group: 'logistics' },
      { key: 'appliedenergistics2:item.ItemMultiMaterial@30', amount: 1, why: 'ME Export Bus upgrades', group: 'logistics' }]);
  });

  it('gives a machine that takes only fluids an interface for what it makes, and no pattern', () => {
    const plan = oneStep({ id: 'f', mteId: IDS.CHEM_HV, count: 1, tier: 3, inputs: [['fluid:oxygen', 1000]], outputs: [['t:x@0', 1]] });
    const { r } = ae2(pack(), plan);
    expect(interfaces(r).map((b) => [b.label, b.feed])).toEqual([['ME Interface (Advanced Chemical Reactor)', undefined]]);
    expect(r.covers.map((c) => c.cover.settings.mode)).toEqual(['export']);
    expect(r.warnings).toEqual([{ code: 'ae2_no_pattern', stepId: 'f', text: 'AE2 cannot plan the Advanced Chemical Reactor: it takes only Oxygen, '
      + 'which the line pipes in, so no pattern can push anything into it. It runs from its pipes and what it makes goes back into your ME storage, '
      + 'so jobs that need Ex rely on stock' }]);
    expect(r.extraParts).toEqual([]);
  });

  it('gives a machine whose item outputs all come by chance no pattern, and says to fill it by hand', () => {
    const plan = oneStep({ id: 'c', mteId: IDS.MACERATOR, count: 1 }, [{ key: 't:x@0', amount: 0.5, chance: 0.5 }, { key: 't:y@0', amount: 0.25, chance: 0.25 }]);
    const { r } = ae2(pack(), plan);
    expect(interfaces(r).map((b) => b.feed)).toEqual([undefined]);
    expect(r.covers.map((c) => c.cover.settings.mode)).toEqual(['export']);
    expect(r.warnings).toEqual([{ code: 'ae2_no_pattern', stepId: 'c', text: 'AE2 cannot plan the Basic Macerator: what it makes (Ex and Why) comes '
      + 'by chance, which no pattern can count, so it gets no pattern and nothing pushes Raw Input into it: put it in by hand; what it makes still '
      + 'goes back into your ME storage' }]);
  });

  it("puts a multiblock's pattern on its input bus's interface", () => {
    const plan = oneStep({ id: 'e', mteId: IDS.EBF, count: 1, tier: 2, euPerTick: 120, inputs: [['t:dust@0', 1], ['fluid:oxygen', 1000]],
      outputs: [['t:ingot@0', 1]] });
    const { placement, r } = ae2(pack(), plan);
    const busAt = new Map(placement.blocks.filter((b) => b.hatch !== undefined).map((b) => [b.pos.join(','), b.hatch]));
    const near = (pos: readonly number[]) => [[0, 0, -1], [0, 0, 1], [0, 1, 0], [0, -1, 0], [1, 0, 0], [-1, 0, 0]]
      .map((d) => busAt.get([pos[0]! + d[0]!, pos[1]! + d[1]!, pos[2]! + d[2]!].join(','))).find((h) => h === 'input_bus' || h === 'output_bus');
    expect(interfaces(r).map((b) => [near(b.pos), b.feed?.interface?.patterns]).sort()).toEqual([
      ['input_bus', [{ inputs: [{ key: 't:dust@0', amount: 1 }], outputs: [{ key: 't:ingot@0', amount: 1 }] }]], ['output_bus', undefined]]);
  });

  it('words the patterns and the export bus in the configure steps, and counts the export bus as an idle ME part', async () => {
    const p = pack();
    const plan = makePlan([{ id: 'm', mteId: IDS.MACERATOR, count: 1 }, { id: 'x', mteId: IDS.EXTRACTOR, count: 1, inputs: [['t:out_m@0', 1]],
      outputs: [['fluid:molten.iron', 144]] }]);
    const layout = await layoutLine(p, plan, emptyScan(), makeProject({ logistics: 'ae2', scanId: null, baseId: null }));
    const texts = layout.buildSteps.filter((s) => s.kind === 'configure').map((s) => s.text);
    expect(texts).toContain('ME Interface (Basic Macerator): 1 processing pattern; pattern 1× Raw Input → 1× t:out_m@0; blocking mode on');
    expect(texts.filter((t) => t.startsWith('ME Glass Cable - Fluix: '))).toEqual([expect.stringMatching(
      /^ME Glass Cable - Fluix: ME Export Bus on the (north|south) face: put t:out_m@0 in its filter slots$/)]);
    const parts = resolveParts(p);
    // an ME interface and an ME Export Bus, 1 AE/t each, at 2 AE per EU
    expect(ae2IdleEUt(layout.blocks, parts)).toBe(1);
    expect(layout.bom.find((l) => l.key === EXPORT_BUS)).toEqual({ key: EXPORT_BUS, amount: 1, why: 'covers', group: 'logistics' });
  });
});
