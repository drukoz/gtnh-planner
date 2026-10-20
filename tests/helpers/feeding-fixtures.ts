// Fixtures for the feeding checker's tests (plan 21): the fixture pack with recipe maps and the machines and items the
// feeding tests need, plans whose steps carry pack recipes (chances, held items, crafting grids), and lines laid out by
// main's `layoutLine` with or without a world. Every call returns fresh objects, so a test that changes its pack, plan or
// layout changes no other. Synthetic only: invented names, apart from the GT class names, mteIds and item ids the code
// names; no real export or world is read.

import { isFluidKey, parseItemKey, type ItemKey, type StuffKey } from '../../src/shared/keys.ts';
import type { Rotation, Vec3 } from '../../src/shared/layout/geometry.ts';
import type { Layout } from '../../src/shared/types/layout.ts';
import type { Ingredient, Item, Machine, MachineKind, Pack, Product, Recipe, StructureInfo } from '../../src/shared/types/pack.ts';
import type { LogisticsMode, Plan, PlanFlow } from '../../src/shared/types/plan.ts';
import { PART_KEYS } from '../../src/server/layout/feeding/facts.ts';
import { emptyScan, layoutLine } from '../../src/server/layout/layout.ts';
import { lineGround, lineScan } from './enderio-fixtures.ts';
import { EBF_STRUCTURE, IDS, layoutPack, makePlan, makeProject, type StepSpec } from './layout-fixtures.ts';

/** The machine ids `feedPack` adds beside `IDS`. */
export const FEED_IDS = { SMELTER: 2020, MIXER: 2021, ODD: 2022, STEAM: 2023, COKE: 2024, BENCH: 31092 } as const;

const GT_BLOCK = 'gregtech:gt.blockmachines';
const BASIC_CLASS = 'gregtech.api.metatileentity.implementations.MTEBasicMachineWithRecipe';

/** A machine in the fixture table's own shape (the fields of `layout-fixtures.ts`'s `gtMachine`). */
function gtMachine(mteId: number, name: string, metaName: string, kind: MachineKind, cls: string, more: Partial<Machine> = {}): Machine {
  return { mteId, metaName, name, cls, itemKey: `${GT_BLOCK}@${mteId}`, kind, maps: [], ...more };
}

function item(key: ItemKey, name: string): Item {
  const { id, meta } = parseItemKey(key);
  return { key, id, meta, name, oreDict: [] };
}

function addMachine(pack: Pack, m: Machine): void {
  pack.machines.set(m.mteId, m);
  pack.items.set(m.itemKey, item(m.itemKey, m.name));
}

/** The Coke Oven's structure: the fixture EBF's, with the controller block naming the Coke Oven itself. */
function cokeStructure(): StructureInfo {
  const structure = structuredClone(EBF_STRUCTURE);
  for (const b of structure.blocks) if (b.block.mteId === IDS.EBF) b.block.mteId = FEED_IDS.COKE;
  return structure;
}

/** The recipe map of each machine the layout fixtures define without one. */
const FIXTURE_MAPS: ReadonlyArray<readonly [number, string]> = [
  [IDS.MACERATOR, 'gt.recipe.macerator'], [IDS.ASSEMBLER, 'gt.recipe.assembler'], [IDS.CHEM_HV, 'gt.recipe.chemicalreactor'],
  [IDS.EXTRACTOR, 'gt.recipe.fluidextractor'], [IDS.SOLIDIFIER, 'gt.recipe.fluidsolidifier'], [IDS.EBF, 'gt.recipe.blastfurnace'],
];

/** Plain items the feeding tests flow through machines. */
const FEED_ITEMS: ReadonlyArray<readonly [ItemKey, string]> = [
  ['t:a@0', 'Alpha'], ['t:b@0', 'Beta'], ['t:c@0', 'Gamma'], ['t:x@0', 'Ex'], ['t:y@0', 'Why'],
];

/** The part items of `PART_KEYS` that `layoutPack` lacks (it holds the item filter cover and the ME Export Bus). */
const FEED_PART_ITEMS: ReadonlyArray<readonly [ItemKey, string]> = [
  [PART_KEYS.limitedFilter, 'Limited Item Filter'], [PART_KEYS.fluidPacket, 'Fluid Packet'], [PART_KEYS.shutter, 'Shutter Module'],
];

/** The machines `feedPack` adds. */
function feedMachines(): Machine[] {
  return [
    gtMachine(FEED_IDS.SMELTER, 'Advanced Alloy Smelter', 'basicmachine.alloysmelter.tier.02', 'basic', BASIC_CLASS,
      { tier: 2, maps: ['gt.recipe.alloysmelter'] }),
    gtMachine(FEED_IDS.MIXER, 'Basic Mixer', 'basicmachine.mixer.tier.01', 'basic', BASIC_CLASS, { tier: 1, maps: ['gt.recipe.mixer'] }),
    gtMachine(FEED_IDS.BENCH, 'Auto Workbench (MV)', 'basicmachine.automation.autoworkbench.02', 'other',
      'gtPlusPlus.xmod.gregtech.common.tileentities.automation.MTEElectricAutoWorkbench', { tier: 2, maps: [] }),
    gtMachine(FEED_IDS.ODD, 'Seed Thing', 'cropsnh.seedthing.tier.01', 'basic', 'com.example.MTESeedThing', { tier: 1, maps: ['t.recipe.seed'] }),
    gtMachine(FEED_IDS.STEAM, 'Steam Macerator', 'bronzemachine.macerator', 'steam',
      'gregtech.common.tileentities.machines.steam.MTESteamMaceratorBronze', { tier: 1, maps: ['gt.recipe.macerator'] }),
    gtMachine(FEED_IDS.COKE, 'Coke Oven', 'multimachine.cokeoven', 'multiblock', 'gregtech.common.tileentities.machines.multi.MTECokeOven',
      { maps: ['gt.recipe.cokeoven'], structure: cokeStructure() }),
  ];
}

/**
 * `layoutPack()` plus what the feeding tests need: recipe maps on the fixture machines (`IDS.MACERATOR` and the other five that
 * `layoutPack` leaves without one), the machines of `FEED_IDS` (a smelter and a mixer, an Auto Workbench, a basic machine of an
 * unknown kind, a steam macerator and a Coke Oven), the items `t:a@0` "Alpha", `t:b@0` "Beta", `t:c@0` "Gamma", `t:x@0` "Ex",
 * `t:y@0` "Why" and `t:lens@0` "Test Lens" (a GT lens), and the part items of `PART_KEYS`. The machines of `layoutPack` keep their
 * ids (`IDS`) and names.
 */
export function feedPack(): Pack {
  const pack = layoutPack();
  for (const [mteId, map] of FIXTURE_MAPS) {
    const m = pack.machines.get(mteId);
    if (m === undefined) throw new Error(`the layout fixtures define no machine ${mteId}`);
    m.maps = [map];
  }
  for (const m of feedMachines()) addMachine(pack, m);
  for (const [key, name] of FEED_ITEMS) pack.items.set(key, item(key, name));
  pack.items.set('t:lens@0', { ...item('t:lens@0', 'Test Lens'), gt: { prefix: 'lens', material: 'Glass', amount: 3628800 } });
  for (const [key, name] of FEED_PART_ITEMS) pack.items.set(key, item(key, name));
  return pack;
}

// ---- Plans with pack recipes ----

/**
 * A step of `feedPlan`: `makePlan`'s step plus its run time (`ticks`, default 20), items it holds in an input slot without
 * using them up (`held`), output chances (`chances`), the chance each input is used up (`consumeChance`), and for a crafting
 * step its grid (`craft`: `width` and the cells of its shaped recipe, row by row).
 */
export type FeedStep = StepSpec & {
  ticks?: number; held?: StuffKey[]; chances?: Record<StuffKey, number>; consumeChance?: Record<StuffKey, number>;
  craft?: { width: number; cells: Array<StuffKey | null> };
};

const DEFAULT_TICKS = 20;

/** Adds recipe index `i` to `index` under `key`, once (the pack's own indices list a recipe once per key, ascending). */
function addIndex(index: Map<StuffKey, number[]>, key: StuffKey, i: number): void {
  const list = index.get(key);
  if (list === undefined) index.set(key, [i]);
  else if (list.at(-1) !== i) list.push(i);
}

/** `r` added to the pack's recipes and to `recipeById`, `producers` and `consumers`. */
function addRecipe(pack: Pack, r: Recipe): void {
  const i = pack.recipes.length;
  pack.recipes.push(r);
  pack.recipeById.set(r.id, r);
  for (const o of r.outputs) addIndex(pack.producers, o.key, i);
  for (const ing of r.inputs) for (const o of ing.options) addIndex(pack.consumers, o.key, i);
}

/**
 * The pack recipe of `spec`, id = the step id, from its step's nominal amounts (`makePlan`'s, before the chances): a GT
 * recipe on its machine's maps — inputs used up with `consumeChance[key] ?? 1` in the step's order (items from slot 0,
 * fluids from slot 100), then the held items, not consumed; outputs with `chances[key] ?? 1` — or, with `craft`, a shaped
 * crafting recipe of one ingredient per filled cell, `slot` = the cell's index.
 */
function stepRecipe(pack: Pack, spec: FeedStep, nominal: { inputs: readonly Product[]; outputs: readonly Product[] }): Recipe {
  const outputs = nominal.outputs.map((p): Product => ({ key: p.key, amount: p.amount, chance: spec.chances?.[p.key] ?? 1 }));
  if (spec.craft !== undefined) {
    const inputs = spec.craft.cells.flatMap((key, slot): Ingredient[] => (key === null ? [] : [{ slot, consumed: true, chance: 1, options: [{ key, amount: 1 }] }]));
    return {
      id: spec.id, source: 'crafting', maps: ['crafting'], inputs, outputs, euPerTick: 0, durationTicks: 0, amps: 0, specialValue: 0,
      meta: { width: spec.craft.width }, flags: { shaped: true },
    };
  }
  let itemSlot = 0;
  let fluidSlot = 100;
  const inputs: Ingredient[] = nominal.inputs.map((p) => ({
    slot: isFluidKey(p.key) ? fluidSlot++ : itemSlot++, consumed: true, chance: spec.consumeChance?.[p.key] ?? 1, options: [{ key: p.key, amount: p.amount }],
  }));
  for (const key of spec.held ?? []) inputs.push({ slot: itemSlot++, consumed: false, chance: 0, options: [{ key, amount: 1 }] });
  return {
    id: spec.id, source: 'gt', maps: [...(pack.machines.get(spec.mteId)?.maps ?? [])], inputs, outputs, euPerTick: spec.euPerTick ?? 30,
    durationTicks: spec.ticks ?? DEFAULT_TICKS, amps: 1, specialValue: 0, meta: {}, flags: {},
  };
}

/**
 * `makePlan(steps)` (flows chained raw → … → out unless `flows` is given) on `pack` (default `feedPack()`), with a pack
 * recipe per step (`stepRecipe`) and each plan step as the planner gives it: `durationTicks` = `ticks ?? 20`, its inputs
 * and outputs at `amount × chance`, the expected amounts per run. Held items are in the recipe only, as the planner
 * leaves not-consumed inputs out of a step's inputs.
 */
export function feedPlan(steps: FeedStep[], flows?: PlanFlow[], pack: Pack = feedPack()): { pack: Pack; plan: Plan } {
  const plan = makePlan(steps, flows === undefined ? {} : { flows });
  plan.steps.forEach((planStep, i) => {
    const spec = steps[i]!;
    addRecipe(pack, stepRecipe(pack, spec, planStep));
    planStep.durationTicks = spec.ticks ?? DEFAULT_TICKS;
    planStep.inputs = planStep.inputs.map((p) => {
      const chance = spec.consumeChance?.[p.key] ?? 1;
      return { key: p.key, amount: p.amount * chance, chance };
    });
    planStep.outputs = planStep.outputs.map((p) => {
      const chance = spec.chances?.[p.key] ?? 1;
      return { key: p.key, amount: p.amount * chance, chance };
    });
  });
  return { pack, plan };
}

/**
 * Two Basic Macerators (s1: Alpha → Ex) feeding one Advanced Assembler (s2, tier 2: Ex → Why), with the flows raw → s1
 * Alpha, s1 → s2 Ex and s2 → out Why, 1/s each.
 */
export function chain2(): { pack: Pack; plan: Plan } {
  return feedPlan([
    { id: 's1', mteId: IDS.MACERATOR, count: 2, inputs: [['t:a@0', 1]], outputs: [['t:x@0', 1]] },
    { id: 's2', mteId: IDS.ASSEMBLER, tier: 2, count: 1, inputs: [['t:x@0', 1]], outputs: [['t:y@0', 1]] },
  ], [
    { from: 'raw', to: 's1', key: 't:a@0', perSecond: 1 }, { from: 's1', to: 's2', key: 't:x@0', perSecond: 1 },
    { from: 's2', to: 'out', key: 't:y@0', perSecond: 1 },
  ]);
}

/**
 * `plan` laid out by main's `layoutLine` in `mode`: without a world (at the default origin, rotation 0) unless `at` is
 * given, then on the layout tests' line scan and ground (`lineScan()`, `lineGround()`) at that origin and rotation.
 */
export async function layFeed(pack: Pack, plan: Plan, mode: LogisticsMode, at?: { origin: Vec3; rotation: Rotation }): Promise<Layout> {
  if (at === undefined) return layoutLine(pack, plan, emptyScan(), makeProject({ logistics: mode, scanId: null, baseId: null }));
  return layoutLine(pack, plan, lineScan(), makeProject({ logistics: mode, placement: { origin: [...at.origin], rotation: at.rotation } }), lineGround());
}
