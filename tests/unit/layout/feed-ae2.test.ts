// AE2 lines whose patterns can be encoded (architecture §11 entry 51; research docs/research/machine-feeding.md §2.3,
// §3.5, §4.2 and §6.4 item 3): a pattern holds the item inputs a machine uses up (no fluid the line pipes, no held item,
// no programmed circuit) and only the item outputs every run gives in whole numbers; a machine with neither gets no
// pattern — one that makes only fluids an ME Export Bus filtered to its inputs, one that takes only fluids nothing,
// one whose item outputs all come by chance nothing that feeds it — and a warning that the line relies on stock (or
// your hands). Blocking mode is on unless the machine holds an item AE2's blocking-ignore list (GT's
// `AE2Compat.registerBlockingModeIgnoreItems`) leaves out, which blocking mode would never push past. A crafting CPU runs a
// pattern only as often as a job needs what it makes, so a machine whose piped fluid another machine waits for, and whose
// items no job needs as often, is warned about (`ae2_fluid_short`); a job plans a loop of patterns until it would come
// back to a pattern above the request (AE2 rv3-beta-1073-GTNH `CraftingRequest.patternParents`), as the pack's
// calculator does.

import { describe, expect, it } from 'vitest';
import { placeUnits, unitsFromPlan } from '../../../src/server/layout/arrange.ts';
import { emptyScan, layoutLine } from '../../../src/server/layout/layout.ts';
import { aeRunShares } from '../../../src/server/layout/modes/ae2.ts';
import { buildMode, PORT_SPACING } from '../../../src/server/layout/modes/mode.ts';
import { ae2IdleEUt, resolveParts } from '../../../src/server/layout/parts.ts';
import { projectorPayload } from '../../../src/server/projector/payload.ts';
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
    // the bus is a part on the spine's cable: the cable carries its cover and add-on 21's ExportBusSpec
    expect(r.blocks.filter((b) => b.pos.join(',') === port.join(',')).map((b) => [b.role, b.label, b.feed])).toEqual([
      ['pipe', 'ME Glass Cable - Fluix', { exportBus: { keys: ['t:in@0'] } }]]);
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
    expect(r.blocks.filter((b) => b.feed?.exportBus !== undefined).map((b) => b.feed)).toEqual([{ exportBus: { keys: ['t:dust@0', 't:in@0'], cards: 1 } }]);
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

  describe('a fluid the line pipes on from a machine AE2 runs too seldom', () => {
    /**
     * c (a chemical reactor) makes Ex and Oxygen from Raw Input; the Oxygen goes by pipe to each assembler of `to`, which
     * makes its product from Titanium Dust, the Oxygen and, where `exTo` sends it some, Ex; Ex goes where `exTo` says.
     */
    const fluidLine = (exTo: ReadonlyArray<readonly [string, number]>, to: ReadonlyArray<readonly [string, StuffKey]> = [['e', 't:y@0']]): Plan => {
      const takesEx = new Set(exTo.map(([id]) => id));
      return makePlan([
        { id: 'c', mteId: IDS.CHEM_HV, count: 1, tier: 3, inputs: [['t:in@0', 1]], outputs: [['t:x@0', 1], ['fluid:oxygen', 1000]] },
        ...to.map(([id, product]) => ({ id, mteId: IDS.ASSEMBLER, count: 1, tier: 2, outputs: [[product, 1]] as Array<[StuffKey, number]>,
          inputs: [['t:dust@0', 1], ...(takesEx.has(id) ? [['t:x@0', 1]] : []), ['fluid:oxygen', 1000]] as Array<[StuffKey, number]> })),
      ], { flows: [{ from: 'raw', to: 'c', key: 't:in@0', perSecond: 1 }, ...exTo.map(([id, perSecond]) => ({ from: 'c', to: id, key: 't:x@0', perSecond })),
        // an assembler that takes Ex takes one a run: what c does not send it comes from storage
        ...exTo.filter(([id, perSecond]) => to.some(([t]) => t === id) && perSecond < 1).map(([id, perSecond]) => ({ from: 'raw', to: id, key: 't:x@0', perSecond: 1 - perSecond })),
        ...to.flatMap(([id, product]) => [{ from: 'c', to: id, key: 'fluid:oxygen', perSecond: 1000 / to.length },
          { from: 'raw', to: id, key: 't:dust@0', perSecond: 1 }, { from: id, to: 'out', key: product, perSecond: 1 }])] });
    };
    const short = (plan: Plan) => ae2(pack(), plan).r.warnings.filter((w) => w.code === 'ae2_fluid_short');

    it('says so where no job of the line needs what its pattern makes', () => {
      // Ex goes to your storage as a byproduct, so no job ever runs c, and e waits for the Oxygen for ever
      expect(short(fluidLine([['sink', 1]]))).toEqual([{ code: 'ae2_fluid_short', stepId: 'c', key: 'fluid:oxygen', text: 'AE2 runs the Advanced '
        + 'Chemical Reactor only for a job that needs what its pattern makes (Ex), and no job of this line does: so its Oxygen never reaches the '
        + 'Advanced Assembler by pipe, which waits for it for ever, and so does a job that needs what it makes. Keep the Advanced Chemical Reactor '
        + 'running yourself: feed it Raw Input from stock, keep a request for Ex standing, or fill it by hand' }]);
    });

    it('says how short it runs where a job needs only part of what its pattern makes', () => {
      const p = pack();
      p.items.set('t:z@0', { key: 't:z@0', id: 't:z', meta: 0, name: 'Zed', oreDict: [] });
      // half the Ex goes to e, half to your storage: a job runs c half as often as the two assemblers need its Oxygen
      const plan = fluidLine([['e', 0.5], ['sink', 0.5]], [['e', 't:y@0'], ['f', 't:z@0']]);
      expect(ae2(p, plan).r.warnings.filter((w) => w.code === 'ae2_fluid_short').map((w) => w.text)).toEqual(['AE2 runs the Advanced Chemical '
        + 'Reactor only as often as a job needs what its pattern makes (Ex), about 50 % of the runs the Oxygen it pipes to the Advanced Assembler '
        + 'making Why and the Advanced Assembler making Zed needs: so they run out of Oxygen and wait for ever, and so does a job that needs what '
        + 'they make. Keep the Advanced Chemical Reactor running yourself: feed it Raw Input from stock, keep a request for Ex standing, or fill it by hand']);
    });

    it('says nothing where a job needs all it makes', () => {
      expect(short(fluidLine([['e', 1]]))).toEqual([]);
      // a step the line places no machine for asks for all of the Ex it takes: you run that one, asking for Ex as you go
      expect(short(fluidLine([['n', 1]]))).toEqual([]);
    });

    describe('the runs a job asks for (AE2 rv3-beta-1073-GTNH CraftingJobV2)', () => {
      const flow = (from: string, to: string, key: StuffKey, perSecond = 1) => ({ from, to, key, perSecond });
      type Side = ReadonlyArray<StuffKey | readonly [StuffKey, number]>;
      /** aeRunShares of one run a second of each step of `patterns` (its inputs, its outputs; one of each but where an amount is given). */
      const shares = (flows: Plan['flows'], patterns: Readonly<Record<string, readonly [Side, Side]>>) => {
        const plan = makePlan(Object.keys(patterns).map((id) => ({ id, mteId: IDS.MACERATOR, count: 1 })), { flows });
        const side = (list: Side) => list.map((x) => (typeof x === 'string' ? { key: x, amount: 1 } : { key: x[0], amount: x[1] }));
        return Object.fromEntries(aeRunShares(plan, new Map(Object.entries(patterns).map(([id, [ins, outs]]) => [id, { inputs: side(ins), outputs: side(outs) }]))));
      };
      const O0 = 't:o0@0', O1 = 't:o1@0', O2 = 't:o2@0', IN = 't:in@0';

      it('counts runs only along what a job asks for: the product, patterns at their own share, and what you keep going', () => {
        // a chain to the product; a byproduct; half to a pattern (whose other half comes from storage), half to storage; to
        // a step without a pattern
        expect(shares([flow('raw', 'a', IN), flow('a', 'b', O0), flow('b', 'out', O1)], { a: [[IN], [O0]], b: [[O0], [O1]] })).toEqual({ a: 1, b: 1 });
        expect(shares([flow('raw', 'a', IN), flow('a', 'sink', O0)], { a: [[IN], [O0]] })).toEqual({ a: 0 });
        expect(shares([flow('raw', 'a', IN), flow('a', 'b', O0, 0.5), flow('a', 'sink', O0, 0.5), flow('raw', 'b', O0, 0.5), flow('b', 'out', O1)],
          { a: [[IN], [O0]], b: [[O0], [O1]] })).toEqual({ a: 0.5, b: 1 });
        expect(shares([flow('raw', 'a', IN), flow('a', 'hand', O0)], { a: [[IN], [O0]] })).toEqual({ a: 1 });
      });

      it("asks for what a pattern takes, at the pattern's amounts", () => {
        // b's pattern does not take the O0 the plan sends it (it holds it, or its slot takes another option): no job asks a for it
        expect(shares([flow('raw', 'a', IN), flow('a', 'b', O0), flow('raw', 'b', IN), flow('b', 'out', O1)], { a: [[IN], [O0]], b: [[IN], [O1]] }))
          .toEqual({ a: 0, b: 1 });
        // b's pattern takes 2 O0 a run where the plan feeds it 1 (an input used up one run in two): each run of b asks a for 2
        expect(shares([flow('raw', 'a', IN), flow('a', 'b', O0, 0.5), flow('a', 'sink', O0, 0.5), flow('raw', 'b', O0, 0.5), flow('b', 'out', O1)],
          { a: [[IN], [O0]], b: [[[O0, 2]], [O1]] })).toEqual({ a: 1, b: 1 });
      });

      it('plans a loop until it comes back to a pattern the request descends from, which takes that item from storage', () => {
        // cells b empties and a fills: a job for b's product runs b, b's filled cells run a, and a's empty cells cannot run b
        // again (b's pattern is above them), so they come from storage, where b puts them back
        expect(shares([flow('a', 'b', O0), flow('b', 'a', O1), flow('b', 'out', O2)], { a: [[O1], [O0]], b: [[O0], [O2, O1]] })).toEqual({ a: 1, b: 1 });
        // three patterns round: t's product runs t, t runs s, s runs u, and u's input, made by t, comes from storage
        expect(shares([flow('s', 't', O0), flow('u', 's', O1), flow('t', 'u', O2), flow('t', 'out', 't:p@0')],
          { t: [[O0], ['t:p@0', O2]], s: [[O1], [O0]], u: [[O2], [O1]] })).toEqual({ t: 1, s: 1, u: 1 });
      });

      it('never plans what goes round a loop back to a pattern above it, nor a loop no job enters', () => {
        // b makes O1 for the product and for a, a makes b's O0 from it: a job runs b for the product only, and a as often as
        // that b asks; the O1 a asks for cannot run b (b's pattern is above it), so it comes from storage, and neither runs
        // as often as the plan has them
        expect(shares([flow('a', 'b', O0), flow('b', 'a', O1, 0.5), flow('raw', 'a', O1, 0.5), flow('b', 'out', O1, 0.5)],
          { a: [[O1], [O0]], b: [[O0], [O1]] })).toEqual({ a: 0.5, b: 0.5 });
        // what goes only round the loop: no job ever asks for it
        expect(shares([flow('a', 'b', O0), flow('b', 'a', O1)], { a: [[O1], [O0]], b: [[O0], [O1]] })).toEqual({ a: 0, b: 0 });
        // a pattern that takes what it makes (a catalyst) never runs itself for it
        expect(shares([flow('a', 'a', O0), flow('raw', 'a', IN), flow('a', 'sink', O0)], { a: [[O0, IN], [O0]] })).toEqual({ a: 0 });
      });
    });

    describe('in a loop of cells one machine fills and another empties', () => {
      /**
       * f (a chemical reactor) fills Ex into Why and pipes Oxygen to e (an assembler); b (an assembler) takes Why and gives
       * `bMakes` (Zed, the product, with Ex back to f; or Ex alone, half to f and half to the product, f's other half
       * coming from storage).
       */
      const cellLine = (bMakes: 'zed' | 'ex'): Plan => makePlan([
        { id: 'f', mteId: IDS.CHEM_HV, count: 1, tier: 3, inputs: [['t:x@0', 1]], outputs: [['t:y@0', 1], ['fluid:oxygen', 1000]] },
        { id: 'b', mteId: IDS.ASSEMBLER, count: 1, tier: 2, inputs: [['t:y@0', 1], ['t:dust@0', 1]], outputs: bMakes === 'zed' ? [['t:z@0', 1], ['t:x@0', 1]] : [['t:x@0', 1]] },
        { id: 'e', mteId: IDS.ASSEMBLER, count: 1, tier: 2, inputs: [['t:dust@0', 1], ['fluid:oxygen', 1000]] },
      ], { flows: [
        { from: 'f', to: 'b', key: 't:y@0', perSecond: 1 }, { from: 'raw', to: 'b', key: 't:dust@0', perSecond: 1 },
        ...(bMakes === 'zed'
          ? [{ from: 'b', to: 'f', key: 't:x@0', perSecond: 1 }, { from: 'b', to: 'out', key: 't:z@0', perSecond: 1 }]
          : [{ from: 'b', to: 'f', key: 't:x@0', perSecond: 0.5 }, { from: 'raw', to: 'f', key: 't:x@0', perSecond: 0.5 }, { from: 'b', to: 'out', key: 't:x@0', perSecond: 0.5 }]),
        { from: 'f', to: 'e', key: 'fluid:oxygen', perSecond: 1000 }, { from: 'raw', to: 'e', key: 't:dust@0', perSecond: 1 },
        { from: 'e', to: 'out', key: 't:out_e@0', perSecond: 1 },
      ] });
      const short = (plan: Plan) => {
        const p = pack();
        p.items.set('t:z@0', { key: 't:z@0', id: 't:z', meta: 0, name: 'Zed', oreDict: [] });
        return ae2(p, plan).r.warnings.filter((w) => w.code === 'ae2_fluid_short');
      };

      it('says nothing where a job runs the machine that fills them', () => {
        // a job for Zed runs b, b's Why runs f, and f's Ex comes from storage, where b puts it back
        expect(short(cellLine('zed'))).toEqual([]);
      });

      it('says how short it runs where what goes round the loop comes back to a pattern above it', () => {
        expect(short(cellLine('ex')).map((w) => [w.stepId, w.key, w.text])).toEqual([['f', 'fluid:oxygen', 'AE2 runs the Advanced Chemical '
          + 'Reactor only as often as a job needs what its pattern makes (Why), about 50 % of the runs the Oxygen it pipes to the Advanced Assembler '
          + 'needs: so it runs out of Oxygen and waits for ever, and so does a job that needs what it makes. Keep the Advanced Chemical Reactor '
          + 'running yourself: feed it Ex from stock, keep a request for Why standing, or fill it by hand']]);
      });
    });
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
    // the laid-out cable keeps the bus's ExportBusSpec, which only its cover words
    expect(layout.blocks.filter((b) => b.feed !== undefined && b.role === 'pipe').map((b) => [b.label, b.feed])).toEqual([
      ['ME Glass Cable - Fluix', { exportBus: { keys: ['t:out_m@0'] } }]]);
    const parts = resolveParts(p);
    // an ME interface and an ME Export Bus, 1 AE/t each, at 2 AE per EU
    expect(ae2IdleEUt(layout.blocks, parts)).toBe(1);
    expect(layout.bom.find((l) => l.key === EXPORT_BUS)).toEqual({ key: EXPORT_BUS, amount: 1, why: 'covers', group: 'logistics' });
    // the projector draws the bus on its cable and lists the step that sets it
    const project = makeProject({ logistics: 'ae2', scanId: null, baseId: null });
    const payload = projectorPayload(project, { ...layout, status: 'ok' }, p);
    expect(payload.blocks.filter((b) => (b.covers ?? []).some((c) => c.item === EXPORT_BUS)).map((b) => [b.id, b.part])).toEqual([
      ['appliedenergistics2:tile.BlockCableBus', 'glass']]);
    expect(payload.steps.map((s) => s.text)).toContainEqual(expect.stringMatching(/^ME Glass Cable - Fluix: ME Export Bus on the (north|south) face/));
  });
});
