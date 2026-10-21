// Fixtures for the feeding checker's tests (plan 21): the fixture pack with recipe maps and the machines and items the
// feeding tests need, plans whose steps carry pack recipes (chances, held items, crafting grids), lines laid out by
// main's `layoutLine` with or without a world, and hand-built models with test entities for the simulation (Tasks 4–6).
// Every call returns fresh objects, so a test that changes its pack, plan, layout or model changes no other. Synthetic
// only: invented names, apart from the GT class names, mteIds and item ids the code names; no real export or world is read.

import { TIER_NAMES } from '../../src/shared/gt/tiers.ts';
import { isFluidKey, parseItemKey, type ItemKey, type StuffKey } from '../../src/shared/keys.ts';
import type { Rotation, Vec3 } from '../../src/shared/layout/geometry.ts';
import type { Layout } from '../../src/shared/types/layout.ts';
import type { Ingredient, Item, Machine, MachineKind, Pack, Product, Recipe, StructureInfo } from '../../src/shared/types/pack.ts';
import type { LogisticsMode, Plan, PlanFlow } from '../../src/shared/types/plan.ts';
import { PART_KEYS } from '../../src/server/layout/feeding/facts.ts';
import { compareLocal } from '../../src/server/layout/feeding/frame.ts';
import type {
  BasicNode, BenchNode, BusNode, ChestNode, FeedModel, FeedNode, GtCover, MachineSettings, MultiNode, NodeId, OutBusNode, SimRecipe,
} from '../../src/server/layout/feeding/model.ts';
import { insertEmpties, NEVER, PHASE, type SimEntity } from '../../src/server/layout/feeding/sim/core.ts';
import type { SimEnv } from '../../src/server/layout/feeding/sim/machine.ts';
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

/** Plain items the feeding tests flow through machines, and those of the bench tests (Task 6: the research's Resistor grid and a cell). */
const FEED_ITEMS: ReadonlyArray<readonly [ItemKey, string]> = [
  ['t:a@0', 'Alpha'], ['t:b@0', 'Beta'], ['t:c@0', 'Gamma'], ['t:x@0', 'Ex'], ['t:y@0', 'Why'],
  ['t:resin@0', 'Resin'], ['t:fine@0', 'Fine Wire'], ['t:wire@0', 'Wire'], ['t:carbon@0', 'Carbon Dust'], ['t:resistor@0', 'Resistor'],
  ['t:wet@0', 'Wet Cell'], ['t:dry@0', 'Dry Cell'],
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
 * `t:y@0` "Why" and `t:lens@0` "Test Lens" (a GT lens), the bench tests' `t:resin@0` "Resin", `t:fine@0` "Fine Wire", `t:wire@0`
 * "Wire", `t:carbon@0` "Carbon Dust", `t:resistor@0` "Resistor", `t:wet@0` "Wet Cell" and `t:dry@0` "Dry Cell", and the part items
 * of `PART_KEYS`. The machines of `layoutPack` keep their ids (`IDS`) and names.
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

// ---- Hand-built models and test entities for the simulation (plan Tasks 4–6) ----

/** A local cell `x,y,z` as numbers. */
function cellOf(id: NodeId): Vec3 {
  const p = id.split(',').map(Number);
  if (p.length !== 3 || p.some((n) => !Number.isInteger(n))) throw new Error(`not a local cell: ${id}`);
  return [p[0]!, p[1]!, p[2]!];
}

function compareText(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0;
}

/** Each key once, sorted (code-unit order). */
function distinctKeys(keys: Iterable<StuffKey>): StuffKey[] {
  return [...new Set(keys)].sort(compareText);
}

let names: Pack | null = null;

/** An item's or a fluid's name in the fixture pack (`feedPack`), else the key itself. */
function fixtureName(key: StuffKey): string {
  names ??= feedPack();
  return names.nameOf(key);
}

/**
 * A recipe as a machine node runs it: `inputs` and `outputs` as `[key, amount, chance = 1]`, a fluid key going to
 * `fluidsIn` / `fluidsOut` (its chance is ignored); `more` sets the rest (`held`, …).
 */
export function simRecipe(stepId: string, ticks: number, inputs: Array<[StuffKey, number, number?]>, outputs: Array<[StuffKey, number, number?]>,
  more: Partial<SimRecipe> = {}): SimRecipe {
  return {
    stepId, ticks,
    inputs: inputs.filter(([key]) => !isFluidKey(key)).map(([key, amount, chance]) => ({ key, amount, chance: chance ?? 1 })),
    held: [],
    outputs: outputs.filter(([key]) => !isFluidKey(key)).map(([key, amount, chance]) => ({ key, amount, chance: chance ?? 1 })),
    fluidsIn: inputs.filter(([key]) => isFluidKey(key)).map(([key, amount]) => ({ key, amount })),
    fluidsOut: outputs.filter(([key]) => isFluidKey(key)).map(([key, amount]) => ({ key, amount })),
    ...more,
  };
}

const UNSET: MachineSettings = { multiStack: null, inputFilter: null, inputFromOutputSide: null, autoOutput: null };

type BasicBase = Pick<BasicNode, 'id' | 'mteId' | 'name' | 'tier' | 'inSlots' | 'outSlots' | 'outputSide' | 'front' | 'maps' | 'recipes'>;

/**
 * A basic node from `base` and the caller's `over`: its local cell and world cell (the same, in a hand-built model) from
 * its id, its label `${name} at x y z`, its steps and kinds from its recipes and its settings unset, unless `over` gives
 * them; `over.settings` is merged into the unset ones.
 */
function basicNode(base: BasicBase, over: Partial<BasicNode>): BasicNode {
  const id = over.id ?? base.id;
  const local = over.local ?? cellOf(id);
  const pos = over.pos ?? ([...local] as Vec3);
  const name = over.name ?? base.name;
  const recipes = over.recipes ?? base.recipes;
  return {
    ...base, kind: 'basic', id, local, pos, name, label: `${name} at ${pos.join(' ')}`, recipes,
    stepIds: [...new Set(recipes.map((r) => r.stepId))], kinds: distinctKeys(recipes.flatMap((r) => r.inputs.map((i) => i.key))), steam: false,
    ...over, settings: { ...UNSET, ...over.settings },
  };
}

/**
 * The Advanced Alloy Smelter (`FEED_IDS.SMELTER`, tier 2) at local `0,0,0`: 2 input and 1 output slot, output side 3,
 * front 4, recipe `sm`: 1 `t:a@0` + 4 `t:b@0` → 1 `t:c@0` in 100 ticks.
 */
export function smelterNode(over: Partial<BasicNode> = {}): BasicNode {
  return basicNode({
    id: '0,0,0', mteId: FEED_IDS.SMELTER, name: 'Advanced Alloy Smelter', tier: 2, inSlots: 2, outSlots: 1, outputSide: 3, front: 4,
    maps: ['gt.recipe.alloysmelter'], recipes: [simRecipe('sm', 100, [['t:a@0', 1], ['t:b@0', 4]], [['t:c@0', 1]])],
  }, over);
}

/** A Basic Macerator (`IDS.MACERATOR`) at `id`: 1 input and 1 output slot, output side 3, front 4, recipe `one`: 1 `t:a@0` → 1 `t:x@0` in 20 ticks. */
export function oneSlotNode(id: NodeId, over: Partial<BasicNode> = {}): BasicNode {
  return basicNode({
    id, mteId: IDS.MACERATOR, name: 'Basic Macerator', tier: 1, inSlots: 1, outSlots: 1, outputSide: 3, front: 4, maps: ['gt.recipe.macerator'],
    recipes: [simRecipe('one', 20, [['t:a@0', 1]], [['t:x@0', 1]])],
  }, over);
}

/**
 * A Basic Mixer (`FEED_IDS.MIXER`) at `id` that takes what it is given and never runs: `inSlots` input slots and 1 output
 * slot, output side `side` (default 2, toward a block north of it), front 4, step `n`, whose one recipe needs `t:z@0`,
 * which never comes.
 */
export function sinkNode(id: NodeId, inSlots: number, side = 2): BasicNode {
  return basicNode({
    id, mteId: FEED_IDS.MIXER, name: 'Basic Mixer', tier: 1, inSlots, outSlots: 1, outputSide: side, front: 4, maps: ['gt.recipe.mixer'],
    recipes: [simRecipe('n', 20, [['t:z@0', 1]], [['t:c@0', 1]])],
  }, {});
}

/** A cell's world position in a hand-built model (its local cell) and its label `${name} at x y z`. */
function placed(id: NodeId, name: string, over: { local?: Vec3; pos?: Vec3 }): { id: NodeId; local: Vec3; pos: Vec3; label: string } {
  const local = over.local ?? cellOf(id);
  const pos = over.pos ?? ([...local] as Vec3);
  return { id, local, pos, label: `${name} at ${pos.join(' ')}` };
}

/** An LV Input Bus at `id` (4 slots, front 3) on the fixture EBF's recipe map, its Limiting mode and Input Filter unset. */
export function busNode(id: NodeId, over: Partial<BusNode> = {}): BusNode {
  return { ...placed(id, 'Input Bus (LV)', over), front: 3, slots: 4, limited: null, inputFilter: null, maps: ['gt.recipe.blastfurnace'], ...over };
}

/** An LV Output Bus at `id` (4 slots, front 3), locked to no item. */
export function outBusNode(id: NodeId, over: Partial<OutBusNode> = {}): OutBusNode {
  return { ...placed(id, 'Output Bus (LV)', over), front: 3, slots: 4, lock: null, ...over };
}

/**
 * The Electric Blast Furnace (`IDS.EBF`, a controller GT starts with Input Separation on) at local `1,0,0`, with an input
 * bus at `0,0,0` and an output bus at `2,0,0` (`busNode`, `outBusNode`), recipe `e`: 1 `t:a@0` + 1 `t:b@0` → 1 `t:x@0` in
 * 100 ticks. Its steps and kinds come from its recipes unless `over` gives them.
 */
export function ebfNode(over: Partial<MultiNode> = {}): MultiNode {
  const name = over.name ?? 'Electric Blast Furnace';
  const recipes = over.recipes ?? [simRecipe('e', 100, [['t:a@0', 1], ['t:b@0', 1]], [['t:x@0', 1]])];
  return {
    kind: 'multi', ...placed(over.id ?? '1,0,0', name, over), name, mteId: IDS.EBF, recipes, stepIds: [...new Set(recipes.map((r) => r.stepId))],
    kinds: distinctKeys(recipes.flatMap((r) => r.inputs.map((i) => i.key))), inBuses: [busNode('0,0,0')], outBuses: [outBusNode('2,0,0')],
    inputSeparation: null, separationDefault: true, ...over,
  };
}

/** `ebfNode()` with a second input bus at `0,1,0`, front 3. */
export function twoBusNode(): MultiNode {
  return ebfNode({ inBuses: [busNode('0,0,0'), busNode('0,1,0')] });
}

/** The research's Resistor grid (§1.3.9), top row first: Resin, Fine Wire, Resin / Wire, Carbon Dust, Wire / –, Fine Wire, –. */
const RESISTOR_GRID: ReadonlyArray<StuffKey | null> = ['t:resin@0', 't:fine@0', 't:resin@0', 't:wire@0', 't:carbon@0', 't:wire@0', null, 't:fine@0', null];

/**
 * An MV Auto Workbench (`FEED_IDS.BENCH`, tier 2) at local `0,0,0`: front 2, back 3, the research's Resistor grid, result 1
 * `t:resistor@0`, no containers, throughput 0, no fluid, power or item pipe sides. Its name follows its tier (`Auto Workbench
 * (MV)`), and its recipe (step `w`) takes one of each grid cell's item and makes its result, unless `over` gives `recipes`.
 */
export function benchNode(over: Partial<BenchNode> = {}): BenchNode {
  const id = over.id ?? '0,0,0';
  const local = over.local ?? cellOf(id);
  const pos = over.pos ?? ([...local] as Vec3);
  const tier = over.tier ?? 2;
  const name = over.name ?? `Auto Workbench (${TIER_NAMES[tier] ?? `tier ${tier}`})`;
  const grid = over.grid ?? [...RESISTOR_GRID];
  const result = over.result ?? { key: 't:resistor@0', amount: 1 };
  const cells = new Map<StuffKey, number>();
  for (const key of grid) if (key !== null) cells.set(key, (cells.get(key) ?? 0) + 1);
  const recipes = over.recipes ?? [simRecipe('w', 1, [...cells], [[result.key, result.amount]])];
  return {
    kind: 'bench', id, local, pos, name, label: `${name} at ${pos.join(' ')}`, mteId: FEED_IDS.BENCH, tier, front: 2, back: 3, grid, result,
    containers: {}, throughput: 0, fluidSides: [], powerSides: [], itemPipeSides: [], recipes, stepIds: [...new Set(recipes.map((r) => r.stepId))],
    kinds: distinctKeys(recipes.flatMap((r) => r.inputs.map((i) => i.key))), ...over,
  };
}

function chestNode(id: NodeId, side: ChestNode['side'], keys: StuffKey[]): ChestNode {
  const local = cellOf(id);
  return { kind: 'chest', id, pos: [...local], local, label: `Chest (${side}) at ${local.join(' ')}`, side, keys: distinctKeys(keys) };
}

/** An input chest at `id` that stocks `keys` (`handModel` adds them to `model.supply`). */
export function inputChestNode(id: NodeId, keys: StuffKey[]): ChestNode {
  return chestNode(id, 'input', keys);
}

/** An output chest at `id`. */
export function outputChestNode(id: NodeId): ChestNode {
  return chestNode(id, 'output', []);
}

/** An HV export conveyor (64 items every 20 ticks) on side `side` of `host`, letting items in as well, as main lays it (ruling R-15). */
export function hvExport(host: NodeId, side: number): GtCover {
  return { host, side, kind: 'conveyor', export: true, allowInput: true, op: { tickRate: 20, stacks: 1, items: 64 } };
}

/** The item keys a recipe's slots hold: what it uses up and what it holds. */
function itemKeys(r: SimRecipe): StuffKey[] {
  return [...r.inputs.map((i) => i.key), ...r.held];
}

/**
 * A model of `nodes` without networks (mode `direct`), as `readLine` would give it for a line of only these blocks:
 * nodes in local order, the input chests' keys in `supply`, no sinks, plan rates or makers unless `more` gives them.
 * Names are the fixture pack's; a step's name is its first item output's (else its first fluid output's, else its id);
 * a recipe map takes what the recipes of the nodes on it take (a basic machine's maps, a multiblock's input buses' maps).
 */
export function handModel(nodes: FeedNode[], more: Partial<FeedModel> = {}): FeedModel {
  const sorted = [...nodes].sort((a, b) => compareLocal(a.local, b.local));
  const machines = sorted.filter((n) => n.kind !== 'chest');
  const recipes = machines.flatMap((n) => n.recipes);
  const steps = new Map<string, SimRecipe>();
  for (const r of recipes) if (!steps.has(r.stepId)) steps.set(r.stepId, r);
  const onMap = new Map<string, SimRecipe[]>();
  for (const n of machines) {
    const maps = n.kind === 'basic' ? n.maps : n.kind === 'multi' ? n.inBuses.flatMap((b) => b.maps) : [];
    for (const map of new Set(maps)) onMap.set(map, [...(onMap.get(map) ?? []), ...n.recipes]);
  }
  const chestKeys = sorted.flatMap((n) => (n.kind === 'chest' && n.side === 'input' ? n.keys : []));
  return {
    mode: 'direct', nodes: sorted, networks: [], covers: [], sinks: [], planned: {}, makers: {}, laid: [...steps.keys()],
    fed: Object.fromEntries([...steps].map(([id, r]) => [id, distinctKeys(r.inputs.map((i) => i.key))])),
    made: Object.fromEntries([...steps].map(([id, r]) => [id, distinctKeys(r.outputs.map((o) => o.key))])),
    itemFlows: [], depths: {}, unknowns: [],
    nameOf: fixtureName,
    stepName: (stepId) => {
      const r = steps.get(stepId);
      const made = r?.outputs[0]?.key ?? r?.fluidsOut[0]?.key;
      return made === undefined ? stepId : fixtureName(made);
    },
    mapTakes: (map, key) => (onMap.get(map) ?? []).some((r) => itemKeys(r).includes(key)),
    mapPair: (map, a, b) => (onMap.get(map) ?? []).some((r) => itemKeys(r).includes(a) && itemKeys(r).includes(b)),
    circuitOre: () => false,
    ...more,
    supply: distinctKeys([...chestKeys, ...(more.supply ?? [])]),
  };
}

/**
 * A test entity (phase `feed`) that, at ticks `from`, `from + every`, …, offers `n` of each of `keys` in turn to the
 * inventory `target` from its side `side` by `insertEmpties`, and records what goes in as `delivered`, the way a network
 * does (ruling R-14). `every` past the run offers once.
 */
export function feeder(env: SimEnv, target: NodeId, side: number, keys: StuffKey[], n: number, every: number, from = 0): SimEntity {
  const ids = keys.map((k) => env.keys.id(k));
  const self: SimEntity = {
    phase: PHASE.feed, order: 0,
    tick(t: number): number {
      if (t >= from && (t - from) % every === 0) {
        const inv = env.inv(target);
        if (inv === null) throw new Error(`no inventory at ${target}`);
        for (const key of ids) {
          const got = insertEmpties(inv, key, n, side, self);
          if (got > 0) env.stats.delivered(target, key, got, t);
        }
      }
      if (t < from) return from;
      const next = from + (Math.floor((t - from) / every) + 1) * every;
      return Number.isFinite(next) ? next : NEVER;
    },
  };
  return self;
}

/** A test entity (phase `feed`) that, at each of the ticks `at`, takes `n` out of the first stack of `target` that its side `side` lets out. */
export function taker(env: SimEnv, target: NodeId, side: number, n: number, at: number[]): SimEntity {
  const ticks = [...at].sort((a, b) => a - b);
  const self: SimEntity = {
    phase: PHASE.feed, order: 0,
    tick(t: number): number {
      if (ticks.includes(t)) {
        const inv = env.inv(target);
        if (inv === null) throw new Error(`no inventory at ${target}`);
        const slot = inv.sideSlots(side).find((s) => {
          const stack = inv.stack(s);
          return stack !== null && inv.canExtract(s, stack.key, side);
        });
        if (slot !== undefined) inv.extract(slot, n, self);
      }
      return ticks.find((x) => x > t) ?? NEVER;
    },
  };
  return self;
}
