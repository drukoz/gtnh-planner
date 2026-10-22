import { describe, it, expect } from 'vitest';
import { MINI_GT, miniGt } from '../../helpers/mini-gt.ts';
import { packFromSpec, type PackSpec } from '../../helpers/pack-spec.ts';
import { fluidCellsSpec, largeBenderSpec, standInSpec, withPriceGap } from '../../helpers/build-fixtures.ts';
import {
  MACHINE_PRICE_MEMO_SIZE, NOTHING_TO_PLACE, bomBuildCost, buildKeys, gapText, hatchSet, itemPrices, machineBuildCost, machineGap,
  pricingSettings, structureParts, type ItemPrices,
} from '../../../src/server/planner/build-cost.ts';
import { planBasis } from '../../../src/server/planner/basis.ts';
import { emptyContext } from '../../../src/server/planner/plan.ts';
import { PSEUDO_MACHINES } from '../../../src/shared/gt/tiers.ts';
import { defaultSettings } from '../../../src/shared/project/apply-op.ts';
import type { Machine, Pack, Recipe } from '../../../src/shared/types/pack.ts';
import { EBF_STRUCTURE, IDS, layoutPack, makePlan, type StepSpec } from '../../helpers/layout-fixtures.ts';
import {
  FRONT_BOX_ELEMENTS, FRONT_BOX_ID, hatchExportPack, rowElements, STEAM_BOX_ID, withElements, type ElementSpec,
} from '../../helpers/hatch-export-fixtures.ts';
import { HATCH_IDS } from '../../helpers/hatch-fixtures.ts';
import { unitsFromPlan } from '../../../src/server/layout/arrange.ts';
import { hatchRulesOf } from '../../../src/server/layout/hatch-rules.ts';
import type { ExportHatchKind } from '../../../src/shared/gt/hatch-kinds.ts';
import type { PlanSettings } from '../../../src/shared/types/plan.ts';

const lv: PlanSettings = { ...defaultSettings(), tier: 1 };
const mv: PlanSettings = { ...defaultSettings(), tier: 2 };
const ctx = emptyContext();

/** The prices of every machine of `pack` at `s`. */
function pricesOf(pack: Pack, s: PlanSettings): Promise<ItemPrices> {
  return itemPrices(pack, s, ctx, buildKeys(pack, [...pack.machines.values()]));
}

function machine(pack: Pack, mteId: number): Machine {
  const m = pack.machines.get(mteId);
  if (m === undefined) throw new Error(`no machine ${mteId}`);
  return m;
}

/** A fresh Mini-GT pack with `recipes` added. */
function miniWith(...recipes: NonNullable<PackSpec['recipes']>): Pack {
  const spec = structuredClone(MINI_GT);
  return packFromSpec({ ...spec, recipes: [...(spec.recipes ?? []), ...recipes] });
}

const HATCHES = 'gregtech.api.metatileentity.implementations.';

describe('machineBuildCost', () => {
  it('prices a singleblock through its crafting chain', async () => {
    const pack = miniGt();
    // LV: hull 9 (8 plates + 2 cables) + 2 circuits of 3 + 2 cables (121), 2 plates (101) or 4 wires (111).
    const atLv = await pricesOf(pack, lv);
    expect([121, 101, 111].map((id) => machineBuildCost(pack, atLv, machine(pack, id)))).toEqual([16, 17, 17]);
    // MV: the circuit costs 2.5 (circuit-mv: 2 wires 1 + redstone 1 + 72 L molten iron 0.5).
    const atMv = await pricesOf(pack, mv);
    expect([121, 101, 111].map((id) => machineBuildCost(pack, atMv, machine(pack, id)))).toEqual([15, 16, 16]);
  });

  it('has no build cost for a machine nothing makes', async () => {
    const pack = miniGt();
    const prices = await pricesOf(pack, lv);
    expect(machineBuildCost(pack, prices, machine(pack, 122))).toBeNull();
    // A priced item on a pseudo machine (packFromSpec packs hold none).
    expect(machineBuildCost(pack, prices, { ...machine(pack, 121), mteId: PSEUDO_MACHINES.CRAFTING_TABLE })).toBeNull();
    expect(machineBuildCost(pack, prices, undefined)).toBeNull();
  });

  it('prices a multiblock as its controller and structure, hatches at their lowest tier', async () => {
    const pack = packFromSpec(largeBenderSpec());
    const m1100 = machine(pack, 1100);
    // The structure's HV muffler counts as the LV one.
    expect([...structureParts(pack, m1100)].sort()).toEqual([['machine:91@0', 1], ['t:casing@0', 7]]);
    // Controller 3 × 3 + 6 = 15, casings 7 × 6 = 42, LV muffler 9 + 1 = 10.
    expect(machineBuildCost(pack, await pricesOf(pack, lv), m1100)).toBe(67);
  });

  it('adds the hatches a multiblock needs to run at its hatch tier', async () => {
    const pack = packFromSpec(largeBenderSpec());
    const m1100 = machine(pack, 1100);
    const bendPlate = pack.recipeById.get('bend-plate')!;
    // Item in, item out, energy, maintenance.
    expect([...hatchSet(pack, m1100, bendPlate, 1)].sort())
      .toEqual([['machine:51@0', 1], ['machine:61@0', 1], ['machine:71@0', 1], ['machine:81@0', 1]]);
    // 67 + 4 hatches of 10 − the 4 casings they stand on, 6 each.
    expect(machineBuildCost(pack, await pricesOf(pack, lv), m1100, { recipe: bendPlate, tier: 1 })).toBe(83);
    const atMv = await pricesOf(pack, mv);
    // Controller 3 × 2.5 + 6 = 13.5, so 65.5 + 40 − 24; with the MV energy hatch (15) 65.5 + 45 − 24.
    expect(machineBuildCost(pack, atMv, m1100, { recipe: bendPlate, tier: 1 })).toBe(81.5);
    expect(machineBuildCost(pack, atMv, m1100, { recipe: bendPlate, tier: 2 })).toBe(86.5);
  });

  it('fits a hatch per fluid and an input bus for a held item, and leaves out a hatch the pack lacks', () => {
    const spec = largeBenderSpec();
    spec.machines?.push(
      { mteId: 42, name: 'Input Hatch (MV)', kind: 'hatch', tier: 2, maps: [], cls: `${HATCHES}MTEHatchInput` },
      { mteId: 41, name: 'Input Hatch (LV)', kind: 'hatch', tier: 1, maps: [], cls: `${HATCHES}MTEHatchInput` },
    );
    spec.recipes?.push({
      id: 'press-mix', map: 'gt.recipe.metalbender', in: [{ nc: 't:mold@0' }, ['fluid:a', 100], ['fluid:b', 100]],
      out: [['t:mixed@0', 1], ['fluid:c', 50]], eut: 16,
    });
    const pack = packFromSpec(spec);
    const m1100 = machine(pack, 1100);
    // Two fluids in, at the lowest input hatch tier; no output hatch in this pack for fluid:c.
    expect([...hatchSet(pack, m1100, pack.recipeById.get('press-mix')!, 2)].sort())
      .toEqual([['machine:41@0', 2], ['machine:51@0', 1], ['machine:61@0', 1], ['machine:71@0', 1], ['machine:82@0', 1]]);
    // No HV energy hatch in this pack, and a singleblock runs with no hatches.
    expect([...hatchSet(pack, m1100, pack.recipeById.get('bend-plate')!, 3)].sort())
      .toEqual([['machine:51@0', 1], ['machine:61@0', 1], ['machine:71@0', 1]]);
    expect(hatchSet(pack, machine(pack, 101), pack.recipeById.get('bend-plate')!, 1).size).toBe(0);
  });

  it("adds the hatch GT's structure check needs where neither the recipe nor the exported structure holds one", () => {
    // the controller's note at the merge of main's hatch rules (architecture §11 entry 47): Plan 5's layout adds an EBF's
    // muffler, empty, where its exported structure has none, so the EBF's build counts one too (plan 12 Task 6)
    const pack = layoutPack();
    const ebf = machine(pack, IDS.EBF);
    const recipe: Recipe = { id: 'e', source: 'gt', maps: [], euPerTick: 120, durationTicks: 20, amps: 1, specialValue: 0, meta: {}, flags: {},
      inputs: [{ slot: 0, consumed: true, chance: 1, options: [{ key: 't:dust@0', amount: 1 }] }, { slot: 100, consumed: true, chance: 1, options: [{ key: 'fluid:oxygen', amount: 1000 }] }],
      outputs: [{ key: 't:ingot@0', amount: 1, chance: 1 }] };
    const gt = (id: number) => `gregtech:gt.blockmachines@${id}`;
    expect([...hatchSet(pack, ebf, recipe, 2)].sort()).toEqual([[gt(IDS.ENERGY_MV), 1], [gt(IDS.INPUT_HATCH), 1], [gt(IDS.INPUT_BUS_ULV), 1],
      [gt(IDS.OUTPUT_BUS), 1], [gt(IDS.MAINTENANCE), 1], [gt(IDS.MUFFLER), 1]].sort());
    // the export's own muffler (the real EBF's) is the one GT needs: its structure parts count it
    const withMuffler = { ...ebf, structure: { ...ebf.structure!, blocks: ebf.structure!.blocks.map((b) => (b.pos.join() === '1,3,1'
      ? { pos: b.pos, block: { id: 'gregtech:gt.blockmachines', meta: 0, mteId: IDS.MUFFLER } } : b)) } };
    expect([...hatchSet(pack, withMuffler, recipe, 2)].map(([key]) => key)).not.toContain(gt(IDS.MUFFLER));
    expect([...structureParts(pack, withMuffler)].find(([key]) => key === gt(IDS.MUFFLER))).toEqual([gt(IDS.MUFFLER), 1]);
  });

  it("reads a multiblock's needs from the hatch rules its layout lays it by, the export's own included", () => {
    // architecture §11 entry 49 (3): with GT's own rules in the export the layout narrows the fitting row by them and keeps
    // the row's needs, and the export's rules alone need nothing, so the build counts the EBF's muffler only beside its row
    const pack = layoutPack();
    const ebf = machine(pack, IDS.EBF);
    const recipe: Recipe = { id: 'e', source: 'gt', maps: [], euPerTick: 120, durationTicks: 20, amps: 1, specialValue: 0, meta: {}, flags: {},
      inputs: [{ slot: 0, consumed: true, chance: 1, options: [{ key: 't:dust@0', amount: 1 }] }], outputs: [{ key: 't:ingot@0', amount: 1, chance: 1 }] };
    const muffler = `gregtech:gt.blockmachines@${IDS.MUFFLER}`;
    const exported: Machine = { ...ebf, structure: withElements(ebf.structure!, rowElements(ebf, {
      b: ['input_hatch', 'output_hatch', 'input_bus', 'output_bus', 'maintenance', 'energy'], f: ['output_hatch'], m: ['muffler'], C: [],
    })) };
    expect(hatchRulesOf(exported)?.source).toBe('both');
    expect([...hatchSet(pack, exported, recipe, 2).keys()]).toContain(muffler);
    const alone: Machine = { ...exported, cls: `${exported.cls}ExportOnly` };
    expect(hatchRulesOf(alone)?.source).toBe('export');
    expect([...hatchSet(pack, alone, recipe, 2).keys()]).not.toContain(muffler);
  });

  it('prices an EBF with the muffler its structure check needs', async () => {
    // GT's EBF needs a muffler on its top middle (its rule's `needs`), which this structure lacks: Plan 5's layout adds one
    // on a casing, and so does its build, whose keys price that muffler too (no `HATCH_CLASSES` class holds it)
    const spec = largeBenderSpec();
    spec.machines = spec.machines!.map((m) => (m.mteId !== 1000 ? m : {
      ...m, cls: 'gregtech.common.tileentities.machines.multi.MTEElectricBlastFurnace',
      structure: { size: [3, 4, 3], controller: [1, 0, 0], air: EBF_STRUCTURE.air.map((p): [number, number, number] => [...p]),
        blocks: EBF_STRUCTURE.blocks.map((b) => ({ pos: [...b.pos] as [number, number, number],
          block: b.block.mteId === undefined ? { id: 't:casing', meta: 0 } : { id: 'gregtech:gt.blockmachines', meta: 1000, mteId: 1000 } })) },
    }));
    spec.recipes!.push({ id: 'make-1000', map: 'crafting', in: [['t:circuit@0', 3], ['t:casing@0', 1]], out: [['machine:1000@0', 1]] },
      { id: 'smelt', map: 'gt.recipe.blastfurnace', in: [['t:iron_dust@0', 1]], out: [['t:iron_ingot@0', 1]], eut: 16 });
    const pack = packFromSpec(spec);
    const ebf = machine(pack, 1000);
    const smelt = pack.recipeById.get('smelt')!;
    expect([...hatchSet(pack, ebf, smelt, 1)].sort()).toEqual([['machine:51@0', 1], ['machine:61@0', 1], ['machine:71@0', 1], ['machine:81@0', 1],
      ['machine:91@0', 1]]);
    // controller 3 × 3 + 6 = 15, 33 casings × 6 = 198, the buses, energy, maintenance and the muffler 5 × 10, less the 5
    // casings they stand on (30)
    const prices = await itemPrices(pack, lv, ctx, buildKeys(pack, [ebf]));
    expect(machineBuildCost(pack, prices, ebf, { recipe: smelt, tier: 1 })).toBe(233);
  });

  describe('counts exactly the hatches its layout lays (the controller\'s ruling after the merge e2efd36)', () => {
    // A multiblock's build holds the hatches Plan 5's layout lays for the same step, kind for kind: by its hatch rules
    // (ruledHatches) where it has any, else generically. Each case lays the step out and compares the classes.
    const OX = 'fluid:oxygen';
    const MI = 'fluid:molten.iron';
    /** A GT recipe `id` of these item and fluid inputs and outputs, `eut` EU/t. */
    const recipeOf = (id: string, inputs: Array<[string, number]>, outputs: Array<[string, number]>, eut = 30): Recipe => ({
      id, source: 'gt', maps: [], euPerTick: eut, durationTicks: 20, amps: 1, specialValue: 0, meta: {}, flags: {},
      inputs: inputs.map(([key, amount], i) => ({ slot: key.startsWith('fluid:') ? 100 + inputs.slice(0, i).filter(([k]) => k.startsWith('fluid:')).length
        : inputs.slice(0, i).filter(([k]) => !k.startsWith('fluid:')).length, consumed: true, chance: 1, options: [{ key, amount }] })),
      outputs: outputs.map(([key, amount]) => ({ key, amount, chance: 1 })),
    });
    /** The simple class names of `hatchSet`'s hatches and of the hatch cells the layout lays (exported mufflers aside), each sorted. */
    const both = (pack: Pack, mteId: number, r: Recipe, tier: number): { build: string[]; layout: string[] } => {
      pack.recipes.push(r);
      pack.recipeById.set(r.id, r);
      const simple = (m: Machine | undefined): string => (m?.cls ?? '?').slice((m?.cls ?? '?').lastIndexOf('.') + 1);
      const byItem = new Map([...pack.machines.values()].map((m) => [m.itemKey, m]));
      const build = [...hatchSet(pack, machine(pack, mteId), r, tier)].flatMap(([key, n]) => Array.from({ length: n }, () => simple(byItem.get(key)))).sort();
      const step: StepSpec = { id: r.id, mteId, count: 1, tier, euPerTick: r.euPerTick,
        inputs: r.inputs.map((ing) => [ing.options[0]!.key, ing.options[0]!.amount]), outputs: r.outputs.map((p) => [p.key, p.amount]) };
      const { units } = unitsFromPlan(pack, makePlan([step]));
      const layout = units[0]!.cells.filter((c) => c.hatch !== undefined && c.exported !== true).map((c) => simple(pack.machines.get(c.block.mteId!))).sort();
      return { build, layout };
    };
    const ALL_SIX: ExportHatchKind[] = ['input_bus', 'output_bus', 'input_hatch', 'output_hatch', 'energy', 'maintenance'];
    const giveElements = (pack: Pack, mteId: number, specs: readonly ElementSpec[]): void => {
      const m = machine(pack, mteId);
      m.structure = withElements(m.structure!, specs);
    };

    it('lays no maintenance hatch where the export takes none, and no energy hatch where it takes only multi-amp ones', () => {
      const frontBox = recipeOf('f', [['t:in@0', 1], [OX, 1000]], [['t:dust@0', 1], [MI, 144]]);
      const noMaintenance = hatchExportPack();
      giveElements(noMaintenance, FRONT_BOX_ID, FRONT_BOX_ELEMENTS.map((s) => (s.ch === 'k' ? { ...s, hatches: ['energy'] } : s)));
      const a = both(noMaintenance, FRONT_BOX_ID, frontBox, 1);
      expect(a.build).toEqual(['MTEHatchEnergy', 'MTEHatchInput', 'MTEHatchInputBus', 'MTEHatchOutput', 'MTEHatchOutputBus']);
      expect(a.build).toEqual(a.layout);
      const exotic = hatchExportPack();
      giveElements(exotic, FRONT_BOX_ID, FRONT_BOX_ELEMENTS.map((s) => (s.ch === 'k' ? { ...s, hatches: ['energy_multi', 'maintenance'] } : s)));
      const b = both(exotic, FRONT_BOX_ID, frontBox, 1);
      expect(b.build).toEqual(['MTEHatchInput', 'MTEHatchInputBus', 'MTEHatchMaintenance', 'MTEHatchOutput', 'MTEHatchOutputBus']);
      expect(b.build).toEqual(b.layout);
      // the export's six on its cells: all of them, as before
      const all = hatchExportPack();
      giveElements(all, FRONT_BOX_ID, FRONT_BOX_ELEMENTS);
      const c = both(all, FRONT_BOX_ID, frontBox, 1);
      expect(c.build).toEqual(['MTEHatchEnergy', 'MTEHatchInput', 'MTEHatchInputBus', 'MTEHatchMaintenance', 'MTEHatchOutput', 'MTEHatchOutputBus']);
      expect(c.build).toEqual(c.layout);
    });

    it("lays a steam multiblock's steam buses and steam hatch, and no energy or maintenance hatch", () => {
      const pack = hatchExportPack();
      giveElements(pack, STEAM_BOX_ID, [
        { ch: 'a', hatches: ['steam_input_bus', 'steam_output_bus'], where: (p) => p[1] === 0 && p[2] === 0 },
        { ch: 'k', hatches: ['steam_hatch'], where: (p) => p[1] === 0 && p[2] === 2 },
        { ch: 'c', hatches: [], where: () => true },
      ]);
      const { build, layout } = both(pack, STEAM_BOX_ID, recipeOf('s', [['t:in@0', 1]], [['t:dust@0', 1]], 0), 1);
      expect(build).toEqual(['MTEHatchCustomFluidBase', 'MTEHatchSteamBusInput', 'MTEHatchSteamBusOutput']);
      expect(build).toEqual(layout);
      // and prices them: the keys of a build hold its steam hatches
      expect(buildKeys(pack, [machine(pack, STEAM_BOX_ID)])).toEqual(expect.arrayContaining(
        [HATCH_IDS.STEAM_BUS_IN, HATCH_IDS.STEAM_BUS_OUT, HATCH_IDS.STEAM_HATCH].map((id) => `gregtech:gt.blockmachines@${id}`)));
    });

    it('lays a tower an output hatch on every layer, a cracker its middle input hatch, an EBF its muffler, by the table and the export', () => {
      // the tower: one fluid out on its 3 layers needs an output hatch on each of the 2 above the bottom, and the input
      // hatch GT's check needs; four fluids out build it 5 high
      const tower = hatchExportPack();
      const one = both(tower, HATCH_IDS.DT, recipeOf('d1', [['t:in@0', 1]], [['fluid:t1', 100]], 480), 3);
      expect(one.build.filter((c) => c === 'MTEHatchOutput')).toHaveLength(2);
      expect(one.build).toEqual(one.layout);
      const four = both(tower, HATCH_IDS.DT, recipeOf('d4', [['fluid:t1', 100]], [['fluid:t1', 100], ['fluid:t2', 100], ['fluid:t3', 100], ['fluid:t4', 100]], 480), 3);
      expect(four.build.filter((c) => c === 'MTEHatchOutput')).toHaveLength(4);
      expect(four.build).toEqual(four.layout);
      // the cracker: a recipe of one fluid on the sides still needs a middle input hatch; with two, both are its own
      const cracker = hatchExportPack();
      const single = both(cracker, HATCH_IDS.CRACKER, recipeOf('c1', [['fluid:heavyfuel', 1000]], [['fluid:crackedheavy', 1000]], 30), 1);
      expect(single.build.filter((c) => c === 'MTEHatchInput')).toHaveLength(2);
      expect(single.build).toEqual(single.layout);
      const pair = both(cracker, HATCH_IDS.CRACKER, recipeOf('c2', [['fluid:heavyfuel', 1000], ['fluid:steam', 1000]], [['fluid:crackedheavy', 1000]], 30), 1);
      expect(pair.build.filter((c) => c === 'MTEHatchInput')).toHaveLength(2);
      expect(pair.build).toEqual(pair.layout);
      // the EBF by its row narrowed by the export, and by the export alone (no muffler need there)
      const ebfRule = layoutPack();
      const ebf = machine(ebfRule, IDS.EBF);
      ebf.structure = withElements(ebf.structure!, rowElements(ebf, { b: ALL_SIX, f: ['output_hatch'], m: ['muffler'], C: [] }));
      const smelt = recipeOf('e', [['t:dust@0', 1]], [['t:ingot@0', 1]], 120);
      const ruled = both(ebfRule, IDS.EBF, smelt, 2);
      expect(ruled.build).toContain('MTEHatchMuffler');
      expect(ruled.build).toEqual(ruled.layout);
      ebfRule.machines.set(IDS.EBF, { ...ebf, cls: `${ebf.cls}ExportOnly` });
      const alone = both(ebfRule, IDS.EBF, { ...smelt, id: 'e2' }, 2);
      expect(alone.build).not.toContain('MTEHatchMuffler');
      expect(alone.build).toEqual(alone.layout);
    });

    it('lays no energy hatch on a furnace its rules run without power, and keeps the generic placement without rules', () => {
      // the Bricked Blast Furnace (power none, run by hand): nothing its rules take; the large bender (no rules): buses,
      // energy and maintenance as Plan 5's generic placement lays them
      const pack = hatchExportPack();
      const bbf = both(pack, HATCH_IDS.BBF, recipeOf('b', [['t:in@0', 1]], [['t:dust@0', 1]], 0), 1);
      expect(bbf.build).toEqual([]);
      expect(bbf.build).toEqual(bbf.layout);
      const bender = packFromSpec(largeBenderSpec());
      const plate = bender.recipeById.get('bend-plate')!;
      expect([...hatchSet(bender, machine(bender, 1100), plate, 1)].sort())
        .toEqual([['machine:51@0', 1], ['machine:61@0', 1], ['machine:71@0', 1], ['machine:81@0', 1]]);
    });
  });

  it('prices free inputs at 0 where a supply machine exists', async () => {
    const spec = structuredClone(MINI_GT);
    const pack = packFromSpec({
      ...spec,
      machines: [...(spec.machines ?? []), { mteId: 1140, name: 'Basic Pump', tier: 1, maps: [], cls: 'gregtech.common.tileentities.machines.basic.MTEPump' }],
      recipes: [...(spec.recipes ?? []), {
        id: 'make-161', map: 'gt.recipe.assembler', in: [['t:hull_lv@0', 1], ['fluid:water', 1000]], out: [['machine:161@0', 1]], eut: 16, dur: 100,
      }],
    });
    // A running line here plans a pump for its water; a machine's build materials take water free.
    expect(planBasis(pack, lv, ctx).supplied.has('fluid:water')).toBe(true);
    expect(machineBuildCost(pack, await pricesOf(pack, lv), machine(pack, 161))).toBe(9);
  });
});

describe('machineGap', () => {
  it('tells why a machine has no price', async () => {
    const pack = miniGt();
    const prices = await pricesOf(pack, lv);
    const m122 = machine(pack, 122);
    expect(prices.gap('machine:122@0')).toEqual({ kind: 'no-recipe' });
    const none = machineGap(pack, prices, m122);
    expect(none).toEqual({ kind: 'no-recipe' });
    expect(gapText(pack, m122, none!, 1)).toBe('no recipe in this pack');
    expect(prices.gap('machine:121@0')).toBeUndefined();
    expect(machineGap(pack, prices, machine(pack, 121))).toBeNull();

    // bend-ti needs 120 EU/t, above any LV bender, so nothing in the graph makes the plate.
    const ti = miniWith({ id: 'make-122', map: 'crafting', in: [['t:hull_lv@0', 1], ['t:titanium_plate@0', 1]], out: [['machine:122@0', 1]] });
    const tiPrices = await pricesOf(ti, lv);
    const plate = { kind: 'unavailable', item: 't:titanium_plate@0' };
    expect(tiPrices.gap('machine:122@0')).toEqual(plate);
    const needs = machineGap(ti, tiPrices, machine(ti, 122));
    expect(needs).toEqual(plate);
    expect(gapText(ti, machine(ti, 122), needs!, 1)).toBe('needs Titanium Plate, not available at LV');

    // Its only recipe needs an MV assembler.
    const mvOnly = miniWith({ id: 'make-122', map: 'gt.recipe.assembler', in: [['t:hull_lv@0', 1]], out: [['machine:122@0', 1]], eut: 120, dur: 100 });
    const own = machineGap(mvOnly, await pricesOf(mvOnly, lv), machine(mvOnly, 122));
    expect(own).toEqual({ kind: 'unavailable', item: 'machine:122@0' });
    expect(gapText(mvOnly, machine(mvOnly, 122), own!, 1)).toBe('nothing at LV makes it');

    // Its Seed Crystal and Crystal Sprout only make each other.
    const seed = packFromSpec(withPriceGap(MINI_GT, [122]));
    const seedPrices = await pricesOf(seed, lv);
    expect(seedPrices.gap('machine:122@0')).toEqual({ kind: 'gap' });
    const gap = machineGap(seed, seedPrices, machine(seed, 122));
    expect(gap).toEqual({ kind: 'gap' });
    expect(gapText(seed, machine(seed, 122), gap!, 1)).toBeNull();
  });

  it('prices a machine whose part only ore processing makes from the ore the group can mine', async () => {
    // The Advanced Bending Machine is crafted from a Flawless Gem, which only sifting a Purified Gem Ore makes, from a Gem
    // Ore. Machine prices buy no ore blocks (plan 09's R8: only a material line does), so nothing in the price graph made
    // the ore, and on the 2.9 export the Advanced Lathe and Advanced Macerator (a Flawless Diamond) had no price: first
    // "needs Native Diamond Cluster, not available at MV", then a pricing gap at a stand-in. Fix wave 2 (c): an ore block
    // the group can mine is a leaf for a part only ore processing makes — hull 9 + one Gem Ore 1 = 10 — while every other
    // good keeps its price; where no vein of the ore is in reach, the machine cannot be built (OQ5 a).
    const gemSpec = (dims: string[], opts: { shard?: boolean; press?: boolean } = {}): PackSpec => {
      const spec = structuredClone(MINI_GT);
      return {
        ...spec,
        items: [...(spec.items ?? []), { key: 't:gem_ore@0', name: 'Gem Ore', gt: { prefix: 'ore', material: 'Gem' } },
          { key: 't:gem_purified@0', name: 'Purified Gem Ore', gt: { prefix: 'crushedPurified', material: 'Gem' } },
          { key: 't:gem_flawless@0', name: 'Flawless Gem', gt: { prefix: 'gemFlawless', material: 'Gem' } }, { key: 't:zircon@0', name: 'Zircon Shard' }],
        recipes: [...(spec.recipes ?? []),
          { id: 'wash-gem', map: 'gt.recipe.macerator', in: [['t:gem_ore@0', 1]], out: [['t:gem_purified@0', 1]], eut: 2, dur: 100 },
          { id: 'sift-gem', map: 'gt.recipe.centrifuge', in: [['t:gem_purified@0', 1]], out: [['t:gem_flawless@0', 1]], eut: 15, dur: 100 },
          { id: 'make-102', map: 'crafting', in: [['t:hull_lv@0', 1], ['t:gem_flawless@0', 1], ...(opts.shard === true ? [['t:zircon@0', 1] as [string, number]] : [])],
            out: [['machine:102@0', 1]] },
          ...(opts.press === true ? [{ id: 'press-gem', map: 'gt.recipe.metalbender', in: [['t:iron_ingot@0', 5] as [string, number]], out: [['t:gem_flawless@0', 1] as [string, number]], eut: 24, dur: 100 }] : [])],
        worldgen: { ...spec.worldgen, veins: [...(spec.worldgen?.veins ?? []), { name: 'ore.mix.gem', dims, kind: 'vein', weight: 1, minY: 0, maxY: 255,
          size: 1, density: 1, materials: { primary: 'Gem', secondary: 'Gem', between: 'Gem', sporadic: 'Gem' } }] },
      };
    };
    const mined = packFromSpec(gemSpec(['overworld']));
    const minedPrices = await pricesOf(mined, lv);
    expect(machineBuildCost(mined, minedPrices, machine(mined, 102))).toBe(10);
    expect(machineGap(mined, minedPrices, machine(mined, 102))).toBeNull();
    expect(minedPrices.cost('t:gem_flawless@0')).toBe(1);
    // A part another route makes keeps that route's price (5 iron ingots, so 9 + 5): the ore is a leaf only where
    // nothing else makes the part.
    const pressed = packFromSpec(gemSpec(['overworld'], { press: true }));
    expect(machineBuildCost(pressed, await pricesOf(pressed, lv), machine(pressed, 102))).toBe(14);
    // On the Moon, which LV cannot reach, the ore is out of reach.
    const moon = packFromSpec(gemSpec(['moon']));
    const moonPrices = await pricesOf(moon, lv);
    const out = machineGap(moon, moonPrices, machine(moon, 102));
    expect(out).toEqual({ kind: 'unavailable', item: 't:gem_ore@0' });
    expect(gapText(moon, machine(moon, 102), out!, 1)).toBe('needs Gem Ore, not available at LV');
    // Where it also takes a Zircon Shard nothing makes, that is what it lacks: never the ore the group can mine.
    const shard = packFromSpec(gemSpec(['overworld'], { shard: true }));
    expect(machineGap(shard, await pricesOf(shard, lv), machine(shard, 102))).toEqual({ kind: 'unavailable', item: 't:zircon@0' });
  });

  it('names the part a multiblock cannot get', async () => {
    // The controller is made from circuits alone, and nothing makes the casings of its structure.
    const spec = largeBenderSpec();
    spec.recipes = [...(spec.recipes ?? []).filter((r) => r.id !== 'make-casing' && r.id !== 'make-1100'),
      { id: 'make-1100', map: 'crafting', in: [['t:circuit@0', 3]], out: [['machine:1100@0', 1]] }];
    const pack = packFromSpec(spec);
    const prices = await pricesOf(pack, lv);
    const m1100 = machine(pack, 1100);
    expect(prices.gap('t:casing@0')).toEqual({ kind: 'no-recipe' });
    expect(machineBuildCost(pack, prices, m1100)).toBeNull();
    const gap = machineGap(pack, prices, m1100);
    expect(gap).toEqual({ kind: 'unavailable', item: 't:casing@0' });
    expect(gapText(pack, m1100, gap!, 1)).toBe('needs Machine Casing, not available at LV');
  });

  it('names the good that alone keeps a machine from being built, not the first dead end of another route', async () => {
    // Two ways to an Emitter: an assembler recipe that also takes a Location Card nothing makes and a Rare Dust out of reach,
    // and a crafting one from circuits; both need an Ender Gem, which no vein yields. So on the 2.9 export the Emitter (MV)
    // has an assembler route through "Any MV Circuit", whose only recipes take reactor sensor location cards nothing makes,
    // and a crafting one; both take an Ender Pearl. The first dead end by key is the card; only the gem, made available,
    // would let the machine be built.
    const spec = structuredClone(MINI_GT);
    const pack = packFromSpec({
      ...spec,
      items: [...(spec.items ?? []), { key: 'a:card@0', name: 'Location Card' }, { key: 'b:dust@0', name: 'Rare Dust', gt: { prefix: 'dust', material: 'Rare' } },
        { key: 'm:gem@0', name: 'Ender Gem', gt: { prefix: 'gem', material: 'EnderGem' } }, { key: 't:emitter@0', name: 'Emitter' }],
      recipes: [...(spec.recipes ?? []),
        { id: 'emit-assembler', map: 'gt.recipe.assembler', in: [['a:card@0', 1], ['b:dust@0', 1], ['m:gem@0', 1]], out: [['t:emitter@0', 1]], eut: 16, dur: 100 },
        { id: 'emit-crafting', map: 'crafting', in: [['t:circuit@0', 2], ['m:gem@0', 1]], out: [['t:emitter@0', 1]] },
        { id: 'make-122', map: 'crafting', in: [['t:hull_lv@0', 1], ['t:emitter@0', 1]], out: [['machine:122@0', 1]] }],
    });
    const prices = await pricesOf(pack, lv);
    const m122 = machine(pack, 122);
    const gap = machineGap(pack, prices, m122);
    expect(gap).toEqual({ kind: 'unavailable', item: 'm:gem@0' });
    expect(gapText(pack, m122, gap!, 1)).toBe('needs Ender Gem, not available at LV');
  });

  it('names, of the goods that alone would do, one whose recipes cannot run here before one nothing makes', async () => {
    // A Widget takes a Token (nothing makes it) or an MV Part (made only at 120 EU/t, above any LV machine): either alone
    // would let the machine be built. So the 2.9 export's Basic Circuit Assembler takes MV circuits, one option of which,
    // "Any MV Circuit", only reactor sensor location cards make: at LV it lacks an MV circuit, not a card.
    const spec = structuredClone(MINI_GT);
    const pack = packFromSpec({
      ...spec,
      items: [...(spec.items ?? []), { key: 'a:token@0', name: 'Token' }, { key: 't:mv_part@0', name: 'MV Part' }, { key: 't:widget@0', name: 'Widget' }],
      recipes: [...(spec.recipes ?? []),
        { id: 'mv-part', map: 'gt.recipe.assembler', in: [['t:iron_plate@0', 1]], out: [['t:mv_part@0', 1]], eut: 120, dur: 100 },
        { id: 'widget', map: 'crafting', in: [{ any: [['a:token@0', 1], ['t:mv_part@0', 1]] }, ['t:iron_plate@0', 1]], out: [['t:widget@0', 1]] },
        { id: 'make-122', map: 'crafting', in: [['t:hull_lv@0', 1], ['t:widget@0', 1]], out: [['machine:122@0', 1]] }],
    });
    const m122 = machine(pack, 122);
    const gap = machineGap(pack, await pricesOf(pack, lv), m122);
    expect(gap).toEqual({ kind: 'unavailable', item: 't:mv_part@0' });
    expect(gapText(pack, m122, gap!, 1)).toBe('needs MV Part, not available at LV');
  });

  it('prices a part whose GT recipe takes GTNH\'s "Any LV Circuit" at the circuits that stand-in stands for', async () => {
    // GT recipes list NewHorizonsCoreMod's stand-in where they take any LV circuit, and nothing makes the stand-in itself:
    // every machine built from such a part could not be built ("needs Any LV Circuit, not available at LV").
    const pack = packFromSpec(standInSpec());
    const prices = await pricesOf(pack, lv);
    const m102 = machine(pack, 102);
    expect(machineGap(pack, prices, m102)).toBeNull();
    // An LV hull 9 + a Sensor: 2 Basic Circuits of 3 and an iron plate.
    expect(machineBuildCost(pack, prices, m102)).toBe(16);
  });
});

describe('structure cells that need nothing placed', () => {
  it('leaves out cells that hold air or a fluid, so a furnace with lava in its hollow can be built', async () => {
    // The 2.9 export's Bricked Blast Furnace holds minecraft:lava@1 in its hollow: priced as a part nothing makes, it made the
    // furnace a machine that cannot be built here, and every LV steel line infeasible whatever the build-cost setting.
    expect([...NOTHING_TO_PLACE].sort())
      .toEqual(['bartworks:coloredFluidBlock', 'minecraft:air', 'minecraft:flowing_lava', 'minecraft:flowing_water', 'minecraft:lava', 'minecraft:water']);
    const pack = packFromSpec(fluidCellsSpec());
    const m1200 = machine(pack, 1200);
    expect([...structureParts(pack, m1200)]).toEqual([['t:firebrick@0', 4]]);
    expect(buildKeys(pack, [m1200])).toEqual(['machine:1200@0', 't:firebrick@0']);
    const prices = await pricesOf(pack, lv);
    expect(machineGap(pack, prices, m1200)).toBeNull();
    // Its controller (4 Firebricks) and the 4 Firebricks of its structure, each an iron ingot.
    expect(machineBuildCost(pack, prices, m1200)).toBe(8);
  });

  it('builds a structure\'s debug hatches as the hatches they stand for, and an anvil as an Anvil whichever way it faces', async () => {
    // The 2.9 export's Assembly Line holds a Debug Input Bus (MTEHatchInputBusDebug), its Large Heat Exchanger a Debug Input
    // Hatch (MTEHatchInputDebug), and its Industrial Sledgehammer an anvil block at meta 1 (vanilla keeps an anvil's facing
    // in the meta's low two bits, its damage above them): nothing makes the debug hatches or a Slightly Damaged Anvil
    // (minecraft:anvil@1), so each made its multiblock one that cannot be built here, at any tier.
    const spec = largeBenderSpec();
    const structure = spec.machines?.find((m) => m.mteId === 1100)?.structure;
    if (structure === undefined) throw new Error('no Large Bender structure');
    const cell = (x: number, z: number): (typeof structure.blocks)[number] => structure.blocks.find((b) => b.pos[0] === x && b.pos[2] === z)!;
    cell(1, 2).block = { id: 'gregtech:gt.blockmachines', meta: 9001, mteId: 9001 };
    cell(0, 0).block = { id: 'gregtech:gt.blockmachines', meta: 9002, mteId: 9002 };
    cell(2, 0).block = { id: 'minecraft:anvil', meta: 1 };
    spec.items?.push({ key: 'minecraft:anvil@0', name: 'Anvil' }, { key: 'minecraft:anvil@1', name: 'Slightly Damaged Anvil' });
    spec.machines?.push(
      { mteId: 9001, name: 'Debug Input Bus', kind: 'hatch', tier: 9, maps: [], cls: `${HATCHES}MTEHatchInputBusDebug` },
      { mteId: 9002, name: 'Debug Input Hatch', kind: 'hatch', tier: 14, maps: [], cls: `${HATCHES}MTEHatchInputDebug` },
      { mteId: 41, name: 'Input Hatch (LV)', kind: 'hatch', tier: 1, maps: [], cls: `${HATCHES}MTEHatchInput` },
    );
    spec.recipes?.push(
      { id: 'make-41', map: 'crafting', in: [['t:hull_lv@0', 1], ['t:iron_plate@0', 1]], out: [['machine:41@0', 1]] },
      { id: 'make-anvil', map: 'crafting', in: [['t:iron_ingot@0', 3]], out: [['minecraft:anvil@0', 1]] },
    );
    const pack = packFromSpec(spec);
    const m1100 = machine(pack, 1100);
    expect([...structureParts(pack, m1100)].sort())
      .toEqual([['machine:41@0', 1], ['machine:51@0', 1], ['minecraft:anvil@0', 1], ['t:casing@0', 5]]);
    const prices = await pricesOf(pack, lv);
    expect(machineGap(pack, prices, m1100)).toBeNull();
    // Controller 3 × 3 + 6 = 15, 5 casings of 6, the LV input bus and input hatch 10 each, the anvil 3 iron ingots.
    expect(machineBuildCost(pack, prices, m1100)).toBe(68);
    // Run with: the hatches it needs come from the production classes, never a debug hatch.
    expect([...hatchSet(pack, m1100, pack.recipeById.get('bend-plate')!, 1)].sort())
      .toEqual([['machine:51@0', 1], ['machine:61@0', 1], ['machine:71@0', 1], ['machine:81@0', 1]]);
  });
});

describe('itemPrices', () => {
  it('memoizes prices per pricing context', async () => {
    const pack = miniGt();
    const keys = buildKeys(pack, [...pack.machines.values()]);
    const first = itemPrices(pack, lv, ctx, keys);
    const line: PlanSettings = { ...lv, target: 't:iron_plate@0', amount: 60, mode: 'makeN', logistics: 'ae2', buildHorizonHours: null };
    expect(itemPrices(pack, line, ctx, [...keys].reverse())).toBe(first);
    const dearer = itemPrices(pack, { ...lv, costOverrides: { Iron: 2 } }, ctx, keys);
    expect(dearer).not.toBe(first);
    // Hull 8 × 2 + 1 = 17, circuits 2 × 4 = 8, cables 1.
    expect(machineBuildCost(pack, await dearer, machine(pack, 121))).toBe(26);
  });

  it('keeps the most recently used pricings of a pack', async () => {
    const pack = miniGt();
    const keys = ['machine:121@0'];
    const others = Array.from({ length: MACHINE_PRICE_MEMO_SIZE }, (_, i): PlanSettings => ({ ...lv, costOverrides: { Iron: 2 + i } }));
    const first = itemPrices(pack, lv, ctx, keys);
    const asked = [first, ...others.slice(0, -1).map((s) => itemPrices(pack, s, ctx, keys))];
    expect(itemPrices(pack, lv, ctx, keys)).toBe(first);
    // One more drops the least recently used, which is no longer `first`.
    asked.push(itemPrices(pack, others.at(-1)!, ctx, keys));
    expect(itemPrices(pack, lv, ctx, keys)).toBe(first);
    const again = itemPrices(pack, others[0]!, ctx, keys);
    expect(asked).not.toContain(again);
    await Promise.all([...asked, again]);
  });

  it('prices machines without the project\'s target and pins', async () => {
    // Slot 1 of make-151 takes an iron or a titanium plate; nothing at LV makes the titanium one.
    const pack = miniWith({
      id: 'make-151', map: 'crafting', in: [['t:hull_lv@0', 1], { any: [['t:iron_plate@0', 1], ['t:titanium_plate@0', 1]] }], out: [['machine:151@0', 1]],
    });
    const keys = buildKeys(pack, [...pack.machines.values()]);
    const project: PlanSettings = { ...lv, target: 't:iron_dust@0', optionChoice: { 'make-151#1': 't:titanium_plate@0' } };
    const first = itemPrices(pack, project, ctx, keys);
    // Hull 9 + iron plate 1; pinned to the titanium plate it would have no price.
    expect(machineBuildCost(pack, await first, machine(pack, 151))).toBe(10);
    expect(pricingSettings(project, ctx)).toEqual(pricingSettings(lv, ctx));
    expect(itemPrices(pack, lv, ctx, keys)).toBe(first);
  });
});

describe('bomBuildCost', () => {
  it('prices layout parts and takes off replaced casings', async () => {
    const pack = miniGt();
    const add = [{ key: 'machine:121@0', amount: 2, why: 'a' }, { key: 't:iron_plate@0', amount: 3, why: 'b' }];
    expect(await bomBuildCost(pack, lv, ctx, add, [{ key: 't:iron_plate@0', amount: 1, why: 'c' }])).toBe(34);
    // A part without a price counts nothing, and the total never goes below 0.
    expect(await bomBuildCost(pack, lv, ctx, [{ key: 'machine:122@0', amount: 1, why: 'd' }], [{ key: 't:iron_plate@0', amount: 1, why: 'e' }])).toBe(0);
  });
});
