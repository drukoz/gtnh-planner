// Fixtures for the feeding checker's tests (plan 21): the fixture pack with recipe maps and the machines and items the
// feeding tests need, plans whose steps carry pack recipes (chances, held items, crafting grids), lines laid out by
// main's `layoutLine` with or without a world, and hand-built models with test entities for the simulation (Tasks 4–6),
// EnderIO lines (Task 7), Project Red lines (Task 8), AE2 lines (Task 9) and GT item pipe lines (Task 10) among them.
// Every call returns fresh objects, so a test that changes its pack, plan, layout or model changes no other. Synthetic
// only: invented names, apart from the GT class names, mteIds and item ids the code names; no real export or world is read.

import { TIER_NAMES } from '../../src/shared/gt/tiers.ts';
import { isFluidKey, parseItemKey, type ItemKey, type StuffKey } from '../../src/shared/keys.ts';
import { gtMachineId } from '../../src/shared/ids.ts';
import { DIRS, OPPOSITE, posKey, step, type Rotation, type Vec3 } from '../../src/shared/layout/geometry.ts';
import { FACES } from '../../src/shared/types/assets.ts';
import type { ConduitMode, Layout, LayoutBlock } from '../../src/shared/types/layout.ts';
import type { Ingredient, Item, Machine, MachineKind, Pack, Product, Recipe, StructureInfo } from '../../src/shared/types/pack.ts';
import type { LogisticsMode, Plan, PlanFlow } from '../../src/shared/types/plan.ts';
import { itemFilterFor } from '../../src/server/layout/conduits.ts';
import type { InterfaceSpec, RoutedChipSpec } from '../../src/server/layout/feeding/contract.ts';
import { ignoredByBlocking, PART_KEYS } from '../../src/server/layout/feeding/facts.ts';
import { compareLocal } from '../../src/server/layout/feeding/frame.ts';
import type {
  Ae2ExportBus, Ae2Iface, BasicNode, BenchNode, BusNode, ChestNode, EioFace, FeedModel, FeedNode, GtCover, GtPipe, InvRef, MachineSettings, MultiNode,
  NodeId, OutBusNode, RoutedPipe, SimRecipe,
} from '../../src/server/layout/feeding/model.ts';
import { insertEmpties, NEVER, PHASE, type SimEntity } from '../../src/server/layout/feeding/sim/core.ts';
import type { SimEnv } from '../../src/server/layout/feeding/sim/machine.ts';
import { emptyScan, layoutLine } from '../../src/server/layout/layout.ts';
import { amountList, finalItemOutputs, nameList, rawItemInputs, stepItemInputs, stepItemOutputs } from '../../src/server/layout/modes/mode.ts';
import { manualReasonOf } from '../../src/server/layout/multiblock-rules.ts';
import { resolveParts } from '../../src/server/layout/parts.ts';
import { lineGround, lineScan } from './enderio-fixtures.ts';
import { EBF_STRUCTURE, IDS, layoutPack, makePlan, makeProject, type StepSpec } from './layout-fixtures.ts';

/** The machine ids `feedPack` adds beside `IDS`. */
export const FEED_IDS = { SMELTER: 2020, MIXER: 2021, ODD: 2022, STEAM: 2023, COKE: 2024, BENCH: 31092 } as const;

const GT_BLOCK = 'gregtech:gt.blockmachines';
const BASIC_CLASS = 'gregtech.api.metatileentity.implementations.MTEBasicMachineWithRecipe';

/** A machine in the fixture table's own shape (the fields of `layout-fixtures.ts`'s `gtMachine`). */
function gtMachine(mteId: number, name: string, metaName: string, kind: MachineKind, cls: string, more: Partial<Machine> = {}): Machine {
  return { id: gtMachineId(mteId), mteId, metaName, name, cls, itemKey: `${GT_BLOCK}@${mteId}`, kind, maps: [], ...more };
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

/**
 * Plain items the feeding tests flow through machines, and those of the bench tests (Task 6: the research's Resistor grid and a
 * cell; Task 9: another Fine Wire than the grid's, research C11).
 */
const FEED_ITEMS: ReadonlyArray<readonly [ItemKey, string]> = [
  ['t:a@0', 'Alpha'], ['t:b@0', 'Beta'], ['t:c@0', 'Gamma'], ['t:x@0', 'Ex'], ['t:y@0', 'Why'],
  ['t:resin@0', 'Resin'], ['t:fine@0', 'Fine Wire'], ['t:wire@0', 'Wire'], ['t:carbon@0', 'Carbon Dust'], ['t:resistor@0', 'Resistor'],
  ['t:wet@0', 'Wet Cell'], ['t:dry@0', 'Dry Cell'], ['t:fine2@0', 'Other Fine Wire'],
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
 * "Wire", `t:carbon@0` "Carbon Dust", `t:resistor@0` "Resistor", `t:wet@0` "Wet Cell", `t:dry@0` "Dry Cell" and `t:fine2@0` "Other
 * Fine Wire", and the part items of `PART_KEYS`. The machines of `layoutPack` keep their ids (`IDS`) and names.
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
 * A Basic Macerator on raw Gamma (m: Gamma → Ex) beside an MV Auto Workbench on raw Alpha and Beta (b: a shaped crafting
 * recipe, Alpha beside Beta in the grid's top row → Why), with the flows raw → m Gamma, m → out Ex, raw → b Alpha and Beta,
 * b → out Why, 0.2/s each: a line where main lays what only the bench takes apart from what the macerator takes.
 */
export function benchBesideMachine(): { pack: Pack; plan: Plan } {
  return feedPlan([
    { id: 'm', mteId: IDS.MACERATOR, count: 1, inputs: [['t:c@0', 1]], outputs: [['t:x@0', 1]] },
    { id: 'b', mteId: FEED_IDS.BENCH, count: 1, inputs: [['t:a@0', 1], ['t:b@0', 1]], outputs: [['t:y@0', 1]], craft: { width: 2, cells: ['t:a@0', 't:b@0', null, null] } },
  ], [
    { from: 'raw', to: 'm', key: 't:c@0', perSecond: 0.2 }, { from: 'm', to: 'out', key: 't:x@0', perSecond: 0.2 },
    { from: 'raw', to: 'b', key: 't:a@0', perSecond: 0.2 }, { from: 'raw', to: 'b', key: 't:b@0', perSecond: 0.2 },
    { from: 'b', to: 'out', key: 't:y@0', perSecond: 0.2 },
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

// ---- Main's layouts before fix/feeding ----

/** The `config` keys of fix/feeding's feeding settings (architecture §11 entry 51), which main wrote nowhere before. */
const FEED_SETTING_KEYS = ['multiStack', 'limited', 'inputSeparation'] as const;
const EXTRACTOR_TEXT = 'Item Extractor Chip';
const INTERFACE_LABEL = /^.* \((.*)\)$/;

/**
 * `layout` as main laid it out before fix/feeding gave its lines structured feeding (architecture §11 entry 51): the
 * input the feeding tests' "today's text" cases were written against, rebuilt from the plan with main's own helpers, so
 * those cases keep their input when main's layout moves on. A fresh copy:
 * - every block loses its `feed` and fix/feeding's settings `multiStack`, `limited` and `inputSeparation`;
 * - routed: the chests list what main listed then (the input chest the raw inputs and what the hand-run units make, the
 *   output chest the line's final outputs and what the hand-run units take), and each Routed Interface Pipe carries its
 *   chips as `config.chips` text: a machine's, and each bus pipe of a multiblock's, `Item Responder Chip (whitelist: <what
 *   its step takes>)` when the step takes items and then a bare `Item Extractor Chip` when it makes items; the input
 *   chest's a bare `Item Extractor Chip`; the output chest's an `Item Responder Chip` whitelisting what it lists, in place
 *   of fix/feeding's Item Terminator Chip;
 * - AE2: an ME Export Bus fix/feeding put on the spine's cable is the ME interface main laid there, and an interface in
 *   front of a singleblock or an input bus (in front of an output bus where the step takes no item) carries `config`
 *   `{ patterns: 1, pattern: '<inputs> → <outputs>', blockingMode: false }`, the plan step's per-run amounts as main wrote
 *   them (main wrote it on each unit's first port: one per unit for the units with one input bus, as every fixture's);
 * - EnderIO and machine-to-machine lines lose only the settings.
 */
export function legacyFeed(layout: Layout, pack: Pack, plan: Plan): Layout {
  const out = structuredClone(layout);
  const live = out.blocks.filter((b) => b.role !== 'ghost' && b.hookup === undefined);
  const byPos = new Map(live.map((b) => [posKey(b.pos), b]));
  const steps = new Map(plan.steps.map((s) => [s.id, s]));
  const unitName = (stepId: string | undefined): string | undefined => {
    const s = stepId === undefined ? undefined : steps.get(stepId);
    return s === undefined ? undefined : pack.machines.get(s.machine.mteId)?.name;
  };
  const isStepBlock = (b: LayoutBlock | undefined): b is LayoutBlock & { stepId: string } =>
    b !== undefined && b.stepId !== undefined && (b.role === 'machine' || b.hatch === 'input_bus' || b.hatch === 'output_bus');
  // the ME Export Buses fix/feeding lays on the spine's cable, read before the feed goes
  const parts = resolveParts(pack);
  const exportBuses = out.mode !== 'ae2' ? [] : live.flatMap((b) => {
    const cover = b.feed?.exportBus === undefined ? undefined : b.covers?.find((c) => c.item === parts.me_export_bus.key);
    return cover === undefined ? [] : [{ b, cover }];
  });
  for (const b of live) {
    delete b.feed;
    if (b.config === undefined) continue;
    for (const key of FEED_SETTING_KEYS) delete b.config[key];
    if (Object.keys(b.config).length === 0) delete b.config;
  }

  if (out.mode === 'routed') {
    const placed = new Set<string>(), hand = new Set<string>();
    for (const b of live) {
      if (b.role !== 'machine' || b.stepId === undefined) continue;
      const m = b.block.mteId === undefined ? undefined : pack.machines.get(b.block.mteId);
      (m !== undefined && manualReasonOf(m) !== null ? hand : placed).add(b.stepId);
    }
    const items = plan.flows.filter((f) => !isFluidKey(f.key));
    const inputKeys = distinctKeys([...rawItemInputs(plan, placed), ...items.filter((f) => hand.has(f.from) && placed.has(f.to)).map((f) => f.key)]);
    const outputKeys = distinctKeys([...finalItemOutputs(plan, placed), ...items.filter((f) => placed.has(f.from) && hand.has(f.to)).map((f) => f.key)]);
    for (const b of live) if (b.role === 'chest' && b.tail !== undefined) b.tail.keys = [...(b.tail.side === 'input' ? inputKeys : outputKeys)];
    const responder = (keys: readonly StuffKey[]): string[] => (keys.length === 0 ? [] : [`Item Responder Chip (whitelist: ${nameList(plan, pack, keys)})`]);
    for (const b of live) {
      if (b.role !== 'chip_pipe') continue;
      // the inventory the pipe links to, in side order
      const target = DIRS.map((_, side) => (((b.connections ?? 0) & (1 << side)) === 0 ? undefined : byPos.get(posKey(step(b.pos, side)))))
        .find((n) => n !== undefined && (n.role === 'chest' || isStepBlock(n)));
      let chips: string[] = [];
      if (target?.role === 'chest') chips = target.tail?.side === 'input' ? [EXTRACTOR_TEXT] : responder(outputKeys);
      else if (isStepBlock(target)) {
        chips = [...responder(stepItemInputs(plan, target.stepId)), ...(stepItemOutputs(plan, target.stepId).length > 0 ? [EXTRACTOR_TEXT] : [])];
      }
      if (chips.length > 0) b.config = { ...b.config, chips: chips.join(' + ') };
    }
  }

  if (out.mode === 'ae2') {
    for (const { b, cover } of exportBuses) {
      const name = unitName(byPos.get(posKey(step(b.pos, FACES.indexOf(cover.face))))?.stepId) ?? '?';
      Object.assign(b, { block: { ...parts.me_interface.block }, role: 'interface', label: `${parts.me_interface.name} (${name})`, item: parts.me_interface.key });
      delete b.connections;
      const covers = (b.covers ?? []).filter((c) => c !== cover);
      if (covers.length > 0) b.covers = covers;
      else delete b.covers;
    }
    for (const b of live) {
      if (b.role !== 'interface') continue;
      // the unit it serves: the step block beside it whose machine names the interface, else the first beside it
      const name = INTERFACE_LABEL.exec(b.label)?.[1];
      const around = DIRS.map((_, side) => byPos.get(posKey(step(b.pos, side)))).filter(isStepBlock);
      const target = around.find((n) => unitName(n.stepId) === name) ?? around[0];
      const s = target === undefined ? undefined : steps.get(target.stepId);
      // a multiblock that takes items has its pattern in front of its input bus
      if (target === undefined || s === undefined || (target.hatch === 'output_bus' && s.inputs.some((p) => !isFluidKey(p.key)))) continue;
      b.config ={ ...b.config, patterns: 1, pattern: `${amountList(plan, pack, s.inputs)} → ${amountList(plan, pack, s.outputs)}`, blockingMode: false };
    }
  }
  return out;
}

/** `layFeed`'s line as main laid it out before fix/feeding (`legacyFeed`). */
export async function layLegacy(pack: Pack, plan: Plan, mode: LogisticsMode, at?: { origin: Vec3; rotation: Rotation }): Promise<Layout> {
  return legacyFeed(await layFeed(pack, plan, mode, at), pack, plan);
}

// ---- Main's Auto Workbenches before add-on 12 capped them ----

/**
 * `layout`'s Auto Workbenches (the blocks with `feed.bench`) as main laid them before add-on 12 Task 6 capped them: the
 * input the bench cases were written against, rebuilt so they keep it now that main lays benches capped. A fresh copy, in
 * which each bench's front faces the middle row, where its back meets the line now, so its back touches nothing of the
 * line and its power cable is on its back; it has no `feed`, so the checker derives its grid from the recipe; and on an
 * EnderIO line the conduit face toward it inserts through the Basic Item Filter of what its step takes, on its output
 * side, which `inputFromOutputSide` opens. A face is toward a bench when its conduit cell neighbours the bench's cell on
 * that face, as two benches share one label. The rest of what add-on 12 changed stays as main lays it now, since no bench
 * case reads it: the bench's `mainFacing` (the checker reads a bench's front from `facing`), its routed chips, its AE2
 * pattern and Locking Card, its pipe, cover and settings on a machine-to-machine line, and the build steps and the bill.
 */
export function uncappedBenches(layout: Layout, pack: Pack, plan: Plan): Layout {
  const out = structuredClone(layout);
  const parts = resolveParts(pack);
  // every conduit face, with the cell it faces
  const faces = out.blocks.flatMap((b) => (b.conduits ?? []).flatMap((c) => c.faces.map((f) => ({ f, toward: posKey(step(b.pos, FACES.indexOf(f.face))) }))));
  for (const b of out.blocks) {
    if (b.feed?.bench === undefined || b.stepId === undefined) continue;
    if (b.facing !== undefined) b.facing = OPPOSITE[b.facing]!;
    delete b.feed;
    if (out.mode !== 'enderio') continue;
    b.config = { ...b.config, inputFromOutputSide: true };
    const { filter } = itemFilterFor(parts, stepItemInputs(plan, b.stepId));
    const at = posKey(b.pos);
    for (const { f, toward } of faces) if (toward === at && f.insert !== undefined) f.insert = { ...f.insert, filter: structuredClone(filter), outputSide: true };
  }
  return out;
}

/** `layFeed`'s line with its Auto Workbenches as main laid them before add-on 12 (`uncappedBenches`). */
export async function layUncapped(pack: Pack, plan: Plan, mode: LogisticsMode, at?: { origin: Vec3; rotation: Rotation }): Promise<Layout> {
  return uncappedBenches(await layFeed(pack, plan, mode, at), pack, plan);
}

// ---- Hand-built models and test entities for the simulation (plan Tasks 4–6) ----

/** A local cell `x,y,z` as numbers. */
function cellOf(id: NodeId): Vec3 {
  const p = id.split(',').map(Number);
  if (p.length !== 3 || p.some((n) => !Number.isInteger(n))) throw new Error(`not a local cell: ${id}`);
  return [p[0]!, p[1]!, p[2]!];
}

/** The inventory at each cell of `nodes`: the node there, or the multiblock whose bus it is with that bus. */
function ownersOf(nodes: readonly FeedNode[]): Map<NodeId, { node: NodeId; bus?: NodeId }> {
  const owners = new Map<NodeId, { node: NodeId; bus?: NodeId }>();
  for (const n of nodes) {
    owners.set(n.id, { node: n.id });
    if (n.kind === 'multi') for (const b of [...n.inBuses, ...n.outBuses]) owners.set(b.id, { node: n.id, bus: b.id });
  }
  return owners;
}

function compareText(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0;
}

/** Each key once, sorted (code-unit order). */
function distinctKeys(keys: Iterable<StuffKey>): StuffKey[] {
  return [...new Set(keys)].sort(compareText);
}

let fixture: Pack | null = null;

/** The fixture pack (`feedPack`), built once: a hand-built model's names and its blocking-ignore test read it. */
function fixturePack(): Pack {
  fixture ??= feedPack();
  return fixture;
}

/** An item's or a fluid's name in the fixture pack (`feedPack`), else the key itself. */
function fixtureName(key: StuffKey): string {
  return fixturePack().nameOf(key);
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

/**
 * An HV export conveyor (64 items every 20 ticks) on side `side` of `host`, letting items in as well, as main lays a machine's
 * output-side conveyor: an ME interface pushes in through it.
 */
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
 * a recipe map takes what the recipes of the nodes on it take (a basic machine's maps, a multiblock's input buses' maps);
 * AE2's blocking mode ignores what `ignoredByBlocking` says over the fixture pack (its GT lens `t:lens@0` among them).
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
    ignoredByBlocking: (key) => ignoredByBlocking(fixturePack(), key),
    ...more,
    supply: distinctKeys([...chestKeys, ...(more.supply ?? [])]),
  };
}

/**
 * A test entity (phase `feed`) that, at ticks `from`, `from + every`, …, offers `n` of each of `keys` in turn to the
 * inventory `target` from its side `side` by `insertEmpties`, and records what goes in as `delivered`, the way a network
 * does, so a test's `feed_starved` names only an item it never offered. `every` past the run offers once.
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

// ---- EnderIO lines (plan Task 7) ----

/**
 * A face of `eioModel`'s network: side `side` of the conduit cell `conduit`, its mode, and its extract and insert sides'
 * settings (each one the defaults where it does not say).
 */
export interface EioFaceSpec {
  conduit: NodeId; side: number; mode?: ConduitMode;
  extract?: Partial<NonNullable<EioFace['extract']>>; insert?: Partial<NonNullable<EioFace['insert']>>;
}

/**
 * `handModel(nodes)` in EnderIO mode with one item conduit network over the conduit cells that `faces` and `links` name:
 * linked in a chain in the order the faces first name them unless `links` lists the links, hops breadth-first over them.
 * Each face (`${conduit}:${side}`, in local order) has as its target the node, or the multiblock's bus, on its side (null
 * when none is there). Its mode is `mode`, else `in_out` when it gives both sides, `insert` when it gives only an insert
 * side, and `extract` otherwise (EnderIO's own default for an item conduit face); a `disabled` face is left out, as
 * `readLine` leaves it out. An extract side is red, unfiltered, 4 items at a time, without round robin or self feed and
 * with redstone `ignore`; an insert side is red, unfiltered and of priority 0, unless the face's `extract` and `insert`
 * say otherwise.
 */
export function eioModel(nodes: FeedNode[], faces: EioFaceSpec[], links?: Array<[NodeId, NodeId]>): FeedModel {
  const owners = ownersOf(nodes);
  const read = faces.flatMap((spec): EioFace[] => {
    const mode = spec.mode ?? (spec.insert === undefined ? 'extract' : spec.extract === undefined ? 'insert' : 'in_out');
    if (mode === 'disabled') return [];
    const cell = cellOf(spec.conduit);
    const owner = owners.get(posKey(step(cell, spec.side)));
    const target: InvRef | null = owner === undefined ? null : { ...owner, side: OPPOSITE[spec.side]! };
    const face: EioFace = { id: `${spec.conduit}:${spec.side}`, conduit: spec.conduit, side: spec.side, target, label: `Item Conduit at ${cell.join(' ')}, ${FACES[spec.side]} face` };
    if (mode !== 'insert') face.extract = { color: 'red', filter: null, max: 4, roundRobin: false, selfFeed: false, redstone: 'ignore', ...spec.extract };
    if (mode !== 'extract') face.insert = { color: 'red', filter: null, priority: 0, ...spec.insert };
    return [face];
  }).sort((a, b) => compareLocal(cellOf(a.conduit), cellOf(b.conduit)) || a.side - b.side);
  // the conduit cells and their links
  const cells = [...new Set([...faces.map((f) => f.conduit), ...(links ?? []).flat()])];
  return handModel(nodes, { mode: 'enderio', networks: [{ kind: 'enderio', faces: read, hops: hopsOver(cells, links) }] });
}

/**
 * Breadth-first hops between `cells` (`hops[a][b]`, 0 from a cell to itself), linked as `links` lists them, else in a chain
 * in the order `cells` gives them.
 */
function hopsOver(cells: readonly NodeId[], links: ReadonlyArray<readonly [NodeId, NodeId]> | undefined): Record<NodeId, Record<NodeId, number>> {
  const chain = links ?? cells.slice(1).map((c, i): [NodeId, NodeId] => [cells[i]!, c]);
  const next = new Map<NodeId, NodeId[]>(cells.map((c) => [c, []]));
  const linksOf = (c: NodeId): NodeId[] => {
    const list = next.get(c);
    if (list === undefined) throw new Error(`a link names ${c}, which is not one of the network's cells`);
    return list;
  };
  for (const [a, b] of chain) {
    linksOf(a).push(b);
    linksOf(b).push(a);
  }
  const hops: Record<NodeId, Record<NodeId, number>> = {};
  for (const from of cells) {
    const dist: Record<NodeId, number> = { [from]: 0 };
    const queue = [from];
    for (let i = 0; i < queue.length; i++) {
      for (const n of next.get(queue[i]!)!) {
        if (dist[n] !== undefined) continue;
        dist[n] = dist[queue[i]!]! + 1;
        queue.push(n);
      }
    }
    hops[from] = dist;
  }
  return hops;
}

// ---- Project Red lines (plan Task 8) ----

/** A pipe of `prModel`'s network: its cell, its chips (a Routed Interface Pipe's; without them, a Routed Junction Pipe) and the inventory it serves. */
export interface PrPipeSpec { id: NodeId; chips?: RoutedChipSpec[]; target?: InvRef }

/**
 * `handModel(nodes)` in routed mode with one Project Red network of `pipes`, linked in a chain in the order given unless `links`
 * lists the links, hops breadth-first over them. A pipe with chips is a Routed Interface Pipe (`Routed Interface Pipe at x y z`)
 * serving `target` (null when it gives none), one without a Routed Junction Pipe; the network lists them in local order.
 */
export function prModel(nodes: FeedNode[], pipes: PrPipeSpec[], links?: Array<[NodeId, NodeId]>): FeedModel {
  const read = pipes.map((p): RoutedPipe => ({
    id: p.id, label: `${p.chips === undefined ? 'Routed Junction Pipe' : 'Routed Interface Pipe'} at ${cellOf(p.id).join(' ')}`,
    chips: structuredClone(p.chips ?? []), target: p.target === undefined ? null : { ...p.target },
  })).sort((a, b) => compareLocal(cellOf(a.id), cellOf(b.id)));
  return handModel(nodes, { mode: 'routed', networks: [{ kind: 'routed', pipes: read, hops: hopsOver(pipes.map((p) => p.id), links) }] });
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

// ---- AE2 lines (plan Task 9) ----

/** An ME interface of `ae2Model`'s network: its cell, its patterns and settings, and the inventories it pushes into (each by its own side toward it). */
export interface Ae2IfaceSpec { id: NodeId; spec: InterfaceSpec; targets: InvRef[] }

/**
 * `handModel(nodes)` in AE2 mode with one AE2 network of the interfaces `ifaces` (each `ME Interface at x y z`, in local order)
 * and the ME Export Buses `more.exportBuses`. ME's supply is `t:a@0`, and the plan sends `t:x@0` out of the line at 1/s from
 * the first machine's first step, unless `more` gives `supply` or `itemFlows`; `more` sets the rest of the model.
 */
export function ae2Model(nodes: FeedNode[], ifaces: Ae2IfaceSpec[], more: Partial<FeedModel> & { exportBuses?: Ae2ExportBus[] } = {}): FeedModel {
  const { exportBuses = [], ...rest } = more;
  const interfaces = ifaces.map((i): Ae2Iface => ({
    id: i.id, label: `ME Interface at ${cellOf(i.id).join(' ')}`, spec: structuredClone(i.spec), targets: i.targets.map((t) => ({ ...t })),
  })).sort((a, b) => compareLocal(cellOf(a.id), cellOf(b.id)));
  const buses = exportBuses.map((b): Ae2ExportBus => ({ ...b, keys: [...b.keys], target: b.target === null ? null : { ...b.target } }));
  const first = nodes.find((n): n is Exclude<FeedNode, ChestNode> => n.kind !== 'chest');
  return handModel(nodes, {
    mode: 'ae2', supply: ['t:a@0'], itemFlows: [{ from: first?.stepIds[0] ?? 'raw', to: 'out', key: 't:x@0', perSecond: 1 }], ...rest,
    networks: [{ kind: 'ae2', interfaces, exportBuses: buses }],
  });
}

// ---- GT item pipe lines (plan Task 10) ----

/** A pipe of `pipeModel`'s network: its cell, its capacity (its slots, and the stacks it moves per 20 ticks; 1 unless given) and its links (`1 << side`, local). */
export interface GtPipeSpec { id: NodeId; capacity?: number; links: number }

/**
 * `handModel(nodes)` in direct mode with one GT item pipe network of `pipes` (each `Item Pipe at x y z`, in local order) and the
 * covers `covers`: a pipe's `sides` are its linked sides whose neighbour is a node or a multiblock's bus, each with that
 * inventory's own side toward the pipe, as `readLine` reads them; `more` sets the rest of the model.
 */
export function pipeModel(nodes: FeedNode[], pipes: GtPipeSpec[], covers: GtCover[] = [], more: Partial<FeedModel> = {}): FeedModel {
  const owners = ownersOf(nodes);
  const read = pipes.map((p): GtPipe => {
    const cell = cellOf(p.id);
    const sides = DIRS.flatMap((_, side) => {
      const owner = (p.links & (1 << side)) === 0 ? undefined : owners.get(posKey(step(cell, side)));
      return owner === undefined ? [] : [{ side, target: { ...owner, side: OPPOSITE[side]! } }];
    });
    return { id: p.id, label: `Item Pipe at ${cell.join(' ')}`, capacity: p.capacity ?? 1, links: p.links, sides };
  }).sort((a, b) => compareLocal(cellOf(a.id), cellOf(b.id)));
  return handModel(nodes, { mode: 'direct', ...more, covers: structuredClone(covers), networks: [{ kind: 'gtpipe', pipes: read }] });
}

// ---- The 1,200-block line (plan Task 11) ----

/** The blocks Task 11's timing case lays at least (Global Constraints: under 1,000 ms on a 1,200-block line). */
const BIG_LINE_BLOCKS = 1_200;

/**
 * `bigLine`'s plan of `steps` chain steps: step i (`s${i}`) is 8 Basic Macerators (`IDS.MACERATOR`, i even) or 8 Advanced
 * Assemblers (`IDS.ASSEMBLER`, tier 2, i odd) on a 200-tick recipe that takes the previous step's output (step 0: Alpha)
 * and, for odd i, Alpha from outside too, and makes Part i (`t:o${i}@0`); after every fourth step (i = 3, 7, …) a step
 * `e${i}` of 2 Electric Blast Furnaces (`IDS.EBF`) on a 200-tick recipe takes Part i and makes Ingot i (`t:e${i}@0`), which
 * the next step takes. Every flow is 1/s: from the step before when it makes the item, else from outside; the last step's
 * output leaves the line.
 */
function bigPlan(steps: number): { pack: Pack; plan: Plan } {
  const pack = feedPack();
  const specs: FeedStep[] = [];
  const flows: PlanFlow[] = [];
  const add = (spec: FeedStep): void => {
    const before = specs.at(-1);
    const made = before?.outputs?.[0]?.[0];
    for (const [key] of spec.inputs ?? []) flows.push({ from: before !== undefined && made === key ? before.id : 'raw', to: spec.id, key, perSecond: 1 });
    specs.push(spec);
  };
  for (let i = 0; i < steps; i++) {
    const odd = i % 2 === 1;
    const prev = specs.at(-1)?.outputs?.[0]?.[0] ?? 't:a@0';
    pack.items.set(`t:o${i}@0`, item(`t:o${i}@0`, `Part ${i}`));
    add({
      id: `s${i}`, mteId: odd ? IDS.ASSEMBLER : IDS.MACERATOR, ...(odd ? { tier: 2 } : {}), count: 8,
      inputs: odd ? [[prev, 1], ['t:a@0', 1]] : [[prev, 1]], outputs: [[`t:o${i}@0`, 1]], ticks: 200,
    });
    if (i % 4 !== 3) continue;
    pack.items.set(`t:e${i}@0`, item(`t:e${i}@0`, `Ingot ${i}`));
    add({ id: `e${i}`, mteId: IDS.EBF, count: 2, inputs: [[`t:o${i}@0`, 1]], outputs: [[`t:e${i}@0`, 1]], ticks: 200 });
  }
  const last = specs.at(-1);
  if (last !== undefined) flows.push({ from: last.id, to: 'out', key: last.outputs![0]![0], perSecond: 1 });
  return feedPlan(specs, flows, pack);
}

/**
 * A line of at least 1,200 blocks laid out in `mode` (Task 11's timing case): `bigPlan`'s chain grown one step at a time
 * until `layFeed(pack, plan, mode)` places at least 1,200 blocks.
 */
export async function bigLine(mode: LogisticsMode): Promise<{ pack: Pack; plan: Plan; layout: Layout }> {
  for (let steps = 1; steps <= 200; steps++) {
    const { pack, plan } = bigPlan(steps);
    const layout = await layFeed(pack, plan, mode);
    if (layout.blocks.length >= BIG_LINE_BLOCKS) return { pack, plan, layout };
  }
  throw new Error(`a chain of 200 steps lays fewer than ${BIG_LINE_BLOCKS} blocks in ${mode} mode`);
}
