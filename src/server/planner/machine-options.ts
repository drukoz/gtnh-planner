// Machine options per step and the build model (plan 12, design spec §3.3 "Reusing machines we have", architecture
// §11.39): every eligible machine tier of a step recipe, overclocked, with what building one costs (Task 2's prices) and
// how many the group owns; which of them cannot be built here (controller ruling OQ5 a: no recipe makes it, or its chain
// needs an item out of reach) and may only serve as far as the group owns them; the stand-in build of a pricing gap (OQ5
// b), so a route on one never builds for free; tier pins with Amendment OQ5's fallback; the sharing key of each step
// (programmed circuit, held items, fluids, and for a crafting-table step its recipe) with the Project Red and AE2
// splits; the owned pools; and the steps no machine can run. Crafting-table recipes run on GT++'s Electric Auto
// Workbench when crafting is automated (the controller's Auto Workbench ruling; its mechanics are gt-mechanics §8). The
// build-cost MIP weighs these options (plan 12 Task 4), and `planLine` walks a line again without its blocked recipes
// (Task 5).

import { basicInputSlots, ignoredByBlocking } from '../../shared/gt/feeding.ts';
import { multiblockOverclock, singleblockOverclock, voltageTier, type MachineOc } from '../../shared/gt/overclock.ts';
import { V } from '../../shared/gt/tiers.ts';
import { isFluidKey, type StuffKey } from '../../shared/keys.ts';
import type { Machine, Pack, Recipe } from '../../shared/types/pack.ts';
import {
  DEFAULT_BUILD_HORIZON_HOURS, type MachineWhere, type PlanContext, type PlanSettings,
} from '../../shared/types/plan.ts';
import { PROGRAMMED_CIRCUIT_ID } from '../pack/recipes.ts';
import type { PlanBasis } from './basis.ts';
import { cleanroomMachine } from './bom.ts';
import { buildKeys, gapText, hatchSet, itemPrices, machineBuildCost, machineGap, type ItemPrices, type PriceGap } from './build-cost.ts';
import { acceptRecipe, type CandidateGraph, type LpRecipe } from './candidates.ts';
import { autoWorkbenches, benchCapBy, benchRefusal, isAutoWorkbench } from './benches.ts';
import { ownedPools, recipeCircuit } from './owned.ts';

const TICKS_PER_SECOND = 20;
const SECONDS_PER_HOUR = 3600;
/** Step recipes one AE2 pool runs at most (controller Amendment OQ6): the processing patterns of one ME Interface. */
export const AE2_POOL_MAX_PATTERNS = 9;
/** EU one craft of the Auto Workbench draws in its "Normal Crafting Table" mode (gt-mechanics §8). */
const AUTO_WORKBENCH_EU_PER_CRAFT = 2048;

/** One machine a step recipe can run on (`machineOptions`), at one tier. */
export interface MachineOption {
  mteId: number; name: string; tier: number /* a multiblock's: its energy-hatch tier */; kind: 'basic' | 'multiblock';
  oc: MachineOc; perMachine: number /* runs per second one machine does: 20 × oc.parallel / oc.durationTicks */;
  build: number | null /* raw to build one (machineBuildCost, a multiblock with its hatch set at `tier`) */;
  owned: number /* owned machines of this mteId */;
  /** The build cost the build MIP counts: `build`, else a stand-in (lineBuildModel), so a pricing gap never builds for free. */
  solveBuild: number;
  /** New machines of it may be planned: false for one that cannot be built here, and for a pricing gap of a step that has a priced option. */
  canAdd: boolean;
  /**
   * A multiblock option's hatch set at `tier` (`hatchSet` as `<key>×<n>`, sorted by key, joined by ","): multiblock
   * options of two steps pool only when these are equal, so one pool has one build.
   */
  hatches?: string;
  /**
   * Controller ruling OQ5 (a): why it cannot be built here (`gapText`: "no recipe in this pack", "needs <item>, not
   * available at <tier>", "nothing at <tier> makes it"); such an option never has `canAdd`. Absent for a priced option and
   * a pricing gap.
   */
  unbuildable?: string;
  // optional addition (plan 12, controller ruling 214 (b))
  /**
   * The step recipe's id when it may share no machine of this option with another recipe: the item kinds one run uses up
   * do not fit the machine's own input slots at its tier less the items the recipe holds there (`basicInputSlots`; an AE2
   * interface on blocking mode pushes one recipe's set at a time, research machine-feeding §3.3). `poolKey` holds it, so
   * the recipe's pool on the option is its own. Absent where it fits, or on a machine the slot table does not know.
   */
  ownPool?: string;
}

/** Where one owned machine stands (ruling P11: the existing `MachineWhere`). */
export type OwnedUnit = MachineWhere;
/** Per mteId the owned machines in pool order (`ownedPools`); null for one without a known position. */
export type OwnedPools = ReadonlyMap<number, ReadonlyArray<OwnedUnit | null>>;

/** Amendment OQ5 (ruling P5): the pinned tier `t*` whose machine cannot be built here, so its step falls back to another. */
export interface PinFallback { tier: number; name: string; why: string }

export interface BuildModel {
  mode: 'rate' | 'makeN';
  /** rate: buildHorizonHours × 3600, null = build cost ignored; makeN: null (the batch is the horizon). */
  horizonSeconds: number | null;
  /** New and owned machines are shared by sharing pools (`sharesMachines`: rate mode on AE2 lines); else every step has its own. */
  share: boolean;
  /**
   * A step recipe's sharing key (`sharingKey` of the recipe and its graph recipe's `nonConsumed`; with `share`, `#<n>`
   * appended for its AE2 part n ≥ 1, `ae2Parts`); '-|' for unknown ids.
   */
  sharingKey(recipeId: string): string;
  /**
   * A step recipe's options (rules 1–8), tier then mteId ascending; [] for furnace steps, crafting-table steps without
   * Auto Workbench options (by hand, or a pack without one: rule 1), unknown ids and the recipes of `blocked`.
   */
  options(recipeId: string): readonly MachineOption[];
  /** Every eligible option of a step recipe (rules 1–4: before rule 5, the pin, rule 7 and rule 8), for `PlanStep.tiers`. */
  eligible(recipeId: string): readonly MachineOption[];
  /**
   * OQ5 (a): the step recipes of the graph no machine can run (every eligible option cannot be built here and none is
   * owned, or a cleanroom that cannot be built is needed and none is owned) → `<machine name> cannot be built here
   * (<why>)`. `planLine` walks the line again without them (Task 5).
   */
  blocked: ReadonlyMap<string, string>;
  // optional addition (the plan 12 fix wave: one walk around a machine that cannot be built, not one per recipe of it)
  /**
   * The pack's other recipes the group can run here (`acceptRecipe`) on the maps of `blocked`'s recipes, none in the
   * graph, that no machine can run either, by the same rule and with the same reason, judged only where every machine
   * that could run them is one this model priced (another is left to a later walk): `planLine` walks the line without
   * them too, so a machine that cannot be built (a Brewery with a dozen recipes for one good) costs one walk around it,
   * not one per recipe the walk would otherwise pick next. Absent when `blocked` is empty or names all of them.
   */
  blockedAlike?: ReadonlyMap<string, string>;
  /**
   * OQ5 (a): a step recipe whose options all lack `canAdd` (only owned machines that cannot be built are left): the most
   * runs per second they do, Σ perMachine × owned, and `<owned>× <name>, which cannot be built here (<why>)` of its first
   * option; undefined otherwise. Rate mode bounds the step by it (Task 4).
   */
  ownedOnly(recipeId: string): { runsPerSecond: number; text: string } | undefined;
  /**
   * Amendment OQ5 (ruling P5): when a pin's tier `t*` cannot be built here and rule 6 fell back to another tier, `t*`,
   * the machine of its eligible option with the lowest mteId and that option's `unbuildable`; undefined otherwise.
   */
  pinFallback(recipeId: string): PinFallback | undefined;
  owned: ReadonlyMap<number, number>; pools: OwnedPools; prices: ItemPrices;
  cleanroom: { mteId: number; name: string; build: number | null; solveBuild: number; owned: number; unbuildable?: string } | null;
}

/** What `machineOptions` judges a step's machines in. */
export interface MachineOptionEnv {
  groupTier: number; coilHeat: number; multiblocks?: ReadonlySet<number>; owned: ReadonlyMap<number, number>; prices: ItemPrices; pin?: number;
  /** `PlanSettings.automateCrafting`: crafting-table steps run on the Auto Workbench (rule 1); absent = by hand. */
  automateCrafting?: boolean;
  // optional addition (plan 12, controller ruling 214 (c))
  /**
   * The logistics that keep a stock at an Auto Workbench on the line (`benchCapBy`: Project Red, EnderIO): a crafting
   * recipe whose least stock cannot fit its safe input slots gets no Auto Workbench (rule 1). Absent: AE2, machine to
   * machine.
   */
  benchCapBy?: string;
  /** The stand-in build of a pricing-gap option of this kind and tier (default: 0). */
  standIn?: (kind: MachineOption['kind'], tier: number) => number;
  /** Rules 1–4 only. */
  eligibleOnly?: boolean;
}

/**
 * Whether a line's steps share machines (`BuildModel.share`, `PlanStep.pool`): only a running line on AE2 (spec §3.3's
 * networked modes, controller ruling 188 and fix wave 2 (d)). Project Red cannot: a GT basic machine reruns the recipe it
 * cached while the responder chips top its inputs up, so a second recipe on the machine waits for ever
 * (docs/research/machine-feeding.md), and its extractor never routes an item back to the machine it took it from;
 * machine-to-machine and EnderIO lines give every step its own machines (Global Constraints); Make N has its own sharing
 * (one added machine per type, make-n.ts).
 */
export function sharesMachines(settings: Pick<PlanSettings, 'mode' | 'logistics'>): boolean {
  return settings.mode === 'rate' && settings.logistics === 'ae2';
}

/** Whether the model counts build cost: Make N, or rate mode with a horizon (basis.ts `buildCostCounts` says so of the settings). */
export function buildCounts(model: BuildModel): boolean {
  return model.mode === 'makeN' || model.horizonSeconds !== null;
}

function byString(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0;
}

function byTierThenId(a: MachineOption, b: MachineOption): number {
  return a.tier - b.tier || a.mteId - b.mteId;
}

function tierOf(m: Machine): number {
  return m.tier ?? 0;
}

/** A programmed circuit (`gregtech:gt.integrated_circuit@<n>`), which the circuit part of a sharing key stands for. */
function isProgrammedCircuit(key: StuffKey): boolean {
  if (isFluidKey(key)) return false;
  const at = key.lastIndexOf('@');
  return at > 0 && key.slice(0, at) === PROGRAMMED_CIRCUIT_ID;
}

/**
 * The fluid a slot fills: its option, or all its options sorted and joined by `/` when it has several (the walk's one
 * virtual good, so one supply); undefined for a slot that takes an item.
 */
function fluidSlot(options: Recipe['inputs'][number]['options']): string | undefined {
  if (options.length === 0 || !options.every((o) => isFluidKey(o.key))) return undefined;
  return options.map((o) => o.key).sort(byString).join('/');
}

function distinctSorted(keys: Iterable<string>): string[] {
  return [...new Set(keys)].sort(byString);
}

/**
 * A step recipe's sharing key (controller ruling 9): `<recipeCircuit(r) ?? '-'>|<held items without programmed circuits,
 * distinct, sorted, joined by ",">`, and when the recipe takes or makes a fluid `|<the fluids it takes>|<the fluids it
 * makes>` (each distinct, sorted, joined by ","): a basic machine has one input and one output tank and a fluid hatch
 * holds one fluid, so steps on different fluids never share (review). A crafting-table recipe also ends in
 * `|recipe:<id>`: the Auto Workbench crafts the 3×3 pattern set in its GUI and never switches recipes by itself
 * (gt-mechanics §8), so two crafting recipes never share one. With the pack (every planning caller passes it), so does
 * a recipe holding an item AE2's blocking mode does not ignore (`ignoredByBlocking`: the Packager's schematic, a GGFab
 * mold, a cast): a shared machine needs blocking mode, which never pushes into a machine holding one, so such a recipe
 * never shares one (controller ruling 214 (b)). `held` is the graph recipe's `LpRecipe.nonConsumed`.
 */
export function sharingKey(r: Recipe, held: readonly StuffKey[], pack?: Pack): string {
  const items = distinctSorted(held.filter((key) => !isFluidKey(key) && !isProgrammedCircuit(key)));
  let key = `${recipeCircuit(r) ?? '-'}|${items.join(',')}`;
  const fluidsIn = distinctSorted(r.inputs.flatMap((ing) => fluidSlot(ing.options) ?? []));
  const fluidsOut = distinctSorted(r.outputs.filter((p) => isFluidKey(p.key)).map((p) => p.key));
  if (fluidsIn.length > 0 || fluidsOut.length > 0) key += `|${fluidsIn.join(',')}|${fluidsOut.join(',')}`;
  const unblocked = pack !== undefined && items.some((item) => !ignoredByBlocking(pack, item));
  if (r.maps.includes('crafting') || unblocked) key += `|recipe:${r.id}`;
  return key;
}

/**
 * The sharing pool of a step on option `o`: `<mteId>:<tier>:<hatches ?? ''>|<key>`, and `|own:<recipe id>` for an option
 * its recipe may share with no other (`MachineOption.ownPool`).
 */
export function poolKey(o: MachineOption, key: string): string {
  return `${o.mteId}:${o.tier}:${o.hatches ?? ''}|${key}${o.ownPool === undefined ? '' : `|own:${o.ownPool}`}`;
}

/**
 * Whether the item kinds one run of `r` uses up fit the input slots of `m` at its own tier less the items `r` holds there
 * (its not-consumed item slots but the programmed circuit, which has a ghost slot of its own; research machine-feeding
 * §1.1.1, §3.3): a slot each, consumed slots of the same options one kind. True for a machine `basicInputSlots` does not
 * know (a multiblock's buses, a steam machine, the Auto Workbench).
 */
export function kindsFitSlots(r: Recipe, m: Machine): boolean {
  const slots = basicInputSlots(m);
  if (slots === null) return true;
  const items = r.inputs.filter((ing) => ing.options.length > 0 && !ing.options.some((o) => isFluidKey(o.key)));
  const held = items.filter((ing) => !ing.consumed && !ing.options.every((o) => isProgrammedCircuit(o.key))).length;
  const kinds = new Set(items.filter((ing) => ing.consumed).map((ing) => ing.options.map((o) => o.key).sort().join('|'))).size;
  return kinds <= slots - held;
}

const RECIPES_OF_MAP = new WeakMap<Pack, ReadonlyMap<string, readonly Recipe[]>>();

/** The pack's recipes that list `mapId` among their maps, in the pack's order; indexed once per pack. */
function recipesOfMap(pack: Pack, mapId: string): readonly Recipe[] {
  let byMap = RECIPES_OF_MAP.get(pack);
  if (byMap === undefined) {
    const lists = new Map<string, Recipe[]>();
    for (const r of pack.recipes) {
      for (const id of r.maps) {
        const list = lists.get(id);
        if (list === undefined) lists.set(id, [r]);
        else list.push(r);
      }
    }
    byMap = lists;
    RECIPES_OF_MAP.set(pack, byMap);
  }
  return byMap.get(mapId) ?? [];
}

/** A step recipe of a graph (`kind: 'recipe'`) with its pack recipe and map. */
interface StepRecipe { lp: LpRecipe; r: Recipe; mapId: string }

/** The step recipes of `graph` the pack knows, in id order. */
function stepRecipes(pack: Pack, graph: CandidateGraph): StepRecipe[] {
  const steps: StepRecipe[] = [];
  for (const lp of graph.recipes) {
    const r = lp.kind === 'recipe' ? pack.recipeById.get(lp.id) : undefined;
    if (r !== undefined && lp.mapId !== null) steps.push({ lp, r, mapId: lp.mapId });
  }
  return steps;
}

/** The step recipes that may pool together, per map and base sharing key, each list in id order; never furnace steps. */
function poolGroups(pack: Pack, graph: CandidateGraph): StepRecipe[][] {
  const groups = new Map<string, StepRecipe[]>();
  for (const step of stepRecipes(pack, graph)) {
    if (step.mapId === 'furnace') continue;
    const id = `${step.mapId}\u0000${sharingKey(step.r, step.lp.nonConsumed, pack)}`;
    const group = groups.get(id);
    if (group === undefined) groups.set(id, [step]);
    else group.push(step);
  }
  return [...groups.values()];
}

/** Item keys of any option of `r`'s consumed item slots. */
function consumedItems(r: Recipe): Set<StuffKey> {
  return new Set(r.inputs.flatMap((ing) => (ing.consumed ? ing.options.map((o) => o.key).filter((key) => !isFluidKey(key)) : [])));
}

function madeItems(r: Recipe): Set<StuffKey> {
  return new Set(r.outputs.map((p) => p.key).filter((key) => !isFluidKey(key)));
}

function meets(a: ReadonlySet<StuffKey>, b: ReadonlySet<StuffKey>): boolean {
  for (const key of a) if (b.has(key)) return true;
  return false;
}

/**
 * Whether one of two recipes takes an item the other makes (any option of a consumed item slot; item products): Project
 * Red's Item Extractor Chip never routes an item back to the machine it took it from, so on a Project Red line such
 * steps could never share a machine; machines.ts `planSteps` says so on their steps (ruling P7).
 */
export function feedsEither(a: Recipe, b: Recipe): boolean {
  return meets(madeItems(a), consumedItems(b)) || meets(madeItems(b), consumedItems(a));
}

/**
 * The AE2 split (controller Amendment OQ6, ruling P6): per map and base sharing key, the step recipes in id order in
 * parts of at most `AE2_POOL_MAX_PATTERNS`, one ME Interface's processing patterns; each step recipe → its part.
 */
export function ae2Parts(pack: Pack, graph: CandidateGraph): Map<string, number> {
  const parts = new Map<string, number>();
  for (const group of poolGroups(pack, graph)) group.forEach(({ lp }, i) => parts.set(lp.id, Math.floor(i / AE2_POOL_MAX_PATTERNS)));
  return parts;
}

/** One machine at one tier rules 1–3 offer a step, before prices. */
interface Offer { m: Machine; tier: number; kind: MachineOption['kind'] }

/** What rules 1–3 read. */
type OfferEnv = Pick<MachineOptionEnv, 'groupTier' | 'multiblocks' | 'owned' | 'automateCrafting' | 'benchCapBy'>;

/** Whether `m` is GT++'s Electric Auto Workbench (benches.ts, where the planner's bench rules live). */
export { isAutoWorkbench };

/** `lo`, `lo + 1`, … `hi`. */
function tiersFrom(lo: number, hi: number): number[] {
  const tiers: number[] = [];
  for (let t = lo; t <= hi; t++) tiers.push(t);
  return tiers;
}

/**
 * Rules 1–3 of `machineOptions`: the machines and tiers that can run `r` on `mapId` for the group (see there), without
 * overclocks or prices.
 */
function offersFor(pack: Pack, r: Recipe, mapId: string, env: OfferEnv): Offer[] {
  if (mapId === 'furnace') return [];
  if (mapId === 'crafting') {
    if (env.automateCrafting !== true) return [];
    // controller ruling 214: a recipe no bench runs (a tool slot; a stock past its safe slots where the line keeps one) is
    // crafted by hand
    if (benchRefusal(pack, r, env.benchCapBy === undefined ? {} : { capBy: env.benchCapBy }) !== undefined) return [];
    return autoWorkbenches(pack).filter((m) => tierOf(m) <= env.groupTier).map((m) => ({ m, tier: tierOf(m), kind: 'basic' }));
  }
  const machines = (pack.machinesByMap.get(mapId) ?? []).flatMap((id) => pack.machines.get(id) ?? []);
  const mapAmps = pack.maps.get(mapId)?.amps ?? 1;
  // The rule of acceptRecipe and pickMachine: machine tier ≤ group tier and EU/t ≤ V[machine tier] × the map's amps.
  const singles: Offer[] = machines
    .filter((m) => m.kind === 'basic' && tierOf(m) <= env.groupTier && (V[tierOf(m)] as number) * mapAmps >= r.euPerTick)
    .map((m) => ({ m, tier: tierOf(m), kind: 'basic' }));
  const multis = machines.filter((m) => m.kind === 'multiblock').sort((a, b) => a.mteId - b.mteId);
  const built = env.multiblocks;
  const buildable = built === undefined ? multis : multis.filter((m) => built.has(m.mteId));
  // None the group can build: the lowest mteId, as pickMachine does.
  const usable = buildable.length > 0 ? buildable : multis.slice(0, 1);
  const offered = singles.length === 0 ? usable : usable.filter((m) => (env.owned.get(m.mteId) ?? 0) > 0);
  const lowest = Math.min(voltageTier(r.euPerTick), env.groupTier);
  return [...singles, ...offered.flatMap((m) => tiersFrom(lowest, env.groupTier).map((tier): Offer => ({ m, tier, kind: 'multiblock' })))];
}

/**
 * The Auto Workbench's rate at `tier` (gt-mechanics §8): every craft draws AUTO_WORKBENCH_EU_PER_CRAFT EU from its buffer,
 * which takes 1 A of the tier's voltage, and it crafts at most once a tick, so a craft takes 2,048 / V[tier] ticks below
 * EV (LV 64, MV 16, HV 4) and one tick from EV on, drawing V[tier] EU/t below EV and 2,048 EU/t from EV on. It does not
 * overclock.
 */
function autoWorkbenchOc(tier: number): MachineOc {
  const volts = V[tier] as number;
  const euPerTick = Math.min(volts, AUTO_WORKBENCH_EU_PER_CRAFT);
  return {
    euPerTick, durationTicks: Math.ceil(AUTO_WORKBENCH_EU_PER_CRAFT / euPerTick), overclocks: 0, heatOverclocks: 0, machineVoltage: volts,
    machineAmps: 1, parallel: 1,
  };
}

function ocOf(pack: Pack, r: Recipe, mapId: string, offer: Offer, coilHeat: number): MachineOc {
  if (mapId === 'crafting') return autoWorkbenchOc(offer.tier);
  if (offer.kind === 'basic') return singleblockOverclock(r, { tier: offer.tier, amps: offer.m.amps ?? pack.maps.get(mapId)?.amps ?? 1 });
  return multiblockOverclock(
    { euPerTick: r.euPerTick, durationTicks: r.durationTicks, heat: r.meta.coilHeat ?? r.specialValue },
    { hatchTier: offer.tier, perfectOC: offer.m.perfectOC === true, heatOC: offer.m.heatOC === true, coilHeat },
  );
}

/** Controller ruling OQ5 (a): why `m` cannot be built here, for a gap of no recipe or an unavailable item; else undefined. */
function unbuildableText(pack: Pack, m: Machine, gap: PriceGap | null, tier: number): string | undefined {
  return gap !== null && gap.kind !== 'gap' ? (gapText(pack, m, gap, tier) ?? undefined) : undefined;
}

/** `hatchSet` as `<key>×<n>`, sorted by key, joined by ",". */
function hatchesText(set: ReadonlyMap<StuffKey, number>): string {
  return [...set].sort(([a], [b]) => byString(a, b)).map(([key, n]) => `${key}×${n}`).join(',');
}

/** Rule 4 of `machineOptions`: what an offer costs to build, how many the group owns, and whether it can be built here. */
function optionOf(pack: Pack, r: Recipe, mapId: string, offer: Offer, env: MachineOptionEnv): MachineOption {
  const { m, tier, kind } = offer;
  const use = { recipe: r, tier };
  const oc = ocOf(pack, r, mapId, offer, env.coilHeat);
  const build = machineBuildCost(pack, env.prices, m, use);
  const option: MachineOption = {
    mteId: m.mteId, name: m.name, tier, kind, oc, perMachine: (TICKS_PER_SECOND * oc.parallel) / oc.durationTicks, build,
    owned: env.owned.get(m.mteId) ?? 0, solveBuild: build ?? env.standIn?.(kind, tier) ?? 0, canAdd: true,
  };
  if (kind === 'multiblock') option.hatches = hatchesText(hatchSet(pack, m, r, tier));
  if (kind === 'basic' && !kindsFitSlots(r, m)) option.ownPool = r.id;
  const why = build === null ? unbuildableText(pack, m, machineGap(pack, env.prices, m, use), env.groupTier) : undefined;
  if (why !== undefined) {
    option.unbuildable = why;
    option.canAdd = false;
  }
  return option;
}

/**
 * Rule 8's dominance: `p` makes new machines of `o` needless — same kind, `p` can add machines, at least as fast and at
 * most as dear to build (null counts as Infinity), one of them strictly; or both equal and `p` of a lower mteId. An
 * option that cannot add machines dominates none: its owned machines never make another option's new ones needless.
 */
function dominates(p: MachineOption, o: MachineOption): boolean {
  if (p === o || p.kind !== o.kind || !p.canAdd) return false;
  const pBuild = p.build ?? Infinity;
  const oBuild = o.build ?? Infinity;
  if (p.perMachine < o.perMachine || pBuild > oBuild) return false;
  return p.perMachine > o.perMachine || pBuild < oBuild || p.mteId < o.mteId;
}

/** Rules 1–8 of `machineOptions`, and the pinned tier rule 6 fell back from (Amendment OQ5). */
function optionsOf(pack: Pack, r: Recipe, mapId: string, env: MachineOptionEnv): { options: MachineOption[]; fallback?: PinFallback } {
  const eligible = offersFor(pack, r, mapId, env).map((offer) => optionOf(pack, r, mapId, offer, env)).sort(byTierThenId);
  if (env.eligibleOnly === true) return { options: eligible };
  // Rule 5: one that cannot be built here serves only as far as the group owns it.
  let options = eligible.filter((o) => o.unbuildable === undefined || o.owned > 0);
  // Rule 6 (Amendment OQ5, ruling P5): the pin clamped to the eligible tiers; when that tier cannot be built here, its
  // owned machines and the buildable ones of the highest tier below it, else of the lowest above it.
  let fallback: PinFallback | undefined;
  const pin = env.pin;
  if (pin !== undefined && eligible.length > 0) {
    const tiers = [...new Set(eligible.map((o) => o.tier))];
    const below = tiers.filter((t) => t <= pin);
    const pinned = below.length > 0 ? Math.max(...below) : Math.min(...tiers);
    const atPin = options.filter((o) => o.tier === pinned);
    const addable = options.filter((o) => o.canAdd);
    if (atPin.some((o) => o.canAdd) || addable.length === 0) {
      options = atPin;
    } else {
      const lower = addable.filter((o) => o.tier < pinned).map((o) => o.tier);
      const tier = lower.length > 0 ? Math.max(...lower) : Math.min(...addable.map((o) => o.tier));
      options = [...atPin, ...addable.filter((o) => o.tier === tier)].sort(byTierThenId);
      const first = eligible.filter((o) => o.tier === pinned).sort((a, b) => a.mteId - b.mteId)[0];
      if (first?.unbuildable !== undefined) fallback = { tier: pinned, name: first.name, why: first.unbuildable };
    }
  }
  // Rule 7 (OQ5 b): beside a priced option, a pricing gap serves only as far as the group owns it.
  if (options.some((o) => o.build !== null)) {
    options = options.flatMap((o) => (o.build !== null || o.unbuildable !== undefined ? [o] : o.owned > 0 ? [{ ...o, canAdd: false }] : []));
  }
  // Rule 8: an option the group owns none of, dominated by another, is never worth new machines.
  const kept = options;
  options = kept.filter((o) => o.owned > 0 || !kept.some((p) => dominates(p, o)));
  return fallback === undefined ? { options } : { options, fallback };
}

/**
 * The machine options of a step of `r` on `mapId`, tier then mteId ascending, in this order:
 * 1. `furnace` → none. `crafting` → none by hand (`automateCrafting` not true); with `automateCrafting` the pack's GT++
 *    Electric Auto Workbenches at or below the group's tier (gt-mechanics §8: 2,048 EU a craft at 1 A, so 64 ticks at
 *    LV, 16 at MV, 4 at HV, 1 from EV on), each a `basic` option through rules 4–8 — none in a pack without them (a
 *    pseudo step that pays only the step charge).
 * 2. Singleblocks: the map's `basic` machines with `tier ≤ groupTier` and `V[tier] × mapAmps ≥ r.euPerTick` (the rule of
 *    `acceptRecipe` and `pickMachine`), each overclocked by `singleblockOverclock(r, { tier, amps: m.amps ?? mapAmps })`.
 * 3. Multiblocks of the map (those of `env.multiblocks` when given, else every one; none of them in it → the lowest
 *    mteId, as `pickMachine` does) only when rule 2 found none or the group owns that multiblock: one option per
 *    energy-hatch tier from `min(voltageTier(r.euPerTick), groupTier)` to `groupTier` (`multiblockOverclock`).
 * 4. `build` = `machineBuildCost(pack, prices, m, { recipe: r, tier })` (a multiblock's hatch set at the option's hatch
 *    tier), `solveBuild = build ?? standIn(kind, tier)`, `owned`, a multiblock's `hatches`, and `unbuildable` when its
 *    gap (`machineGap`) is `no-recipe` or `unavailable` (controller ruling OQ5 a). With `eligibleOnly`, stop here (every
 *    option `canAdd` but those with `unbuildable`).
 * 5. An option with `unbuildable` never has `canAdd` and is dropped when the group owns none of it.
 * 6. A pin (`env.pin`, Amendment OQ5): `t*` = the pin clamped to the eligible option tiers (the highest at or below it,
 *    else the lowest); keep rule 5's options of `t*`, and when none of them can add machines also those that can of the
 *    highest tier below `t*` that has one, else of the lowest above it (`optionsOf`'s fallback).
 * 7. Pricing gaps (OQ5 b, `build` null without `unbuildable`): when some option has a price, each loses `canAdd` and is
 *    dropped when none is owned; otherwise they keep `canAdd` (the solve weighs them at their stand-in).
 * 8. An option the group owns none of is dropped when another dominates it (`dominates`); one with owned machines always
 *    stays (the solve may run them beside another option's new ones).
 */
export function machineOptions(pack: Pack, r: Recipe, mapId: string, env: MachineOptionEnv): MachineOption[] {
  return optionsOf(pack, r, mapId, env).options;
}

/**
 * The machines rules 1–3 of `machineOptions` (without pins or prices) yield for the step recipes of `graph` — a crafting
 * recipe's Auto Workbenches only with `automateCrafting` — distinct, by mteId: what `lineBuildModel` prices.
 */
export function optionMachines(
  pack: Pack, graph: CandidateGraph, env: { groupTier: number; multiblocks?: ReadonlySet<number>; automateCrafting?: boolean; benchCapBy?: string },
  owned: ReadonlyMap<number, number>,
): Machine[] {
  const byId = new Map<number, Machine>();
  for (const { r, mapId } of stepRecipes(pack, graph)) for (const { m } of offersFor(pack, r, mapId, { ...env, owned })) byId.set(m.mteId, m);
  return [...byId.values()].sort((a, b) => a.mteId - b.mteId);
}

/**
 * The build model of a line's graph (architecture §11.39): owned pools (`ownedPools`) and their sizes; prices for every
 * machine its steps can use and, when a step needs one, the cleanroom; per step recipe its eligible options and its
 * options (`machineOptions` with `settings.machineTier`'s pin), a pricing gap weighed at the largest priced build among
 * the model's eligible options of its kind and tier, else the largest of the model, else 0; the cleanroom (a pricing gap
 * weighed at the largest priced build of the model); the steps no machine can run (`blocked`), whose options are then
 * none; the steps only owned machines that cannot be built can run (`ownedOnly`); each step's sharing key, with on AE2
 * lines (the only ones that share, in rate mode: `sharesMachines`) its split into parts of at most nine recipes
 * (`ae2Parts`); and the horizon.
 */
export async function lineBuildModel(pack: Pack, graph: CandidateGraph, basis: PlanBasis, settings: PlanSettings, ctx: PlanContext): Promise<BuildModel> {
  const pools = ownedPools(ctx, settings);
  const owned: ReadonlyMap<number, number> = new Map([...pools].map(([mteId, units]) => [mteId, units.length]));
  const capBy = benchCapBy(settings.logistics);
  const offerEnv = { groupTier: basis.tier, multiblocks: basis.env.multiblocks, automateCrafting: settings.automateCrafting, ...(capBy === undefined ? {} : { benchCapBy: capBy }) };
  const steps = stepRecipes(pack, graph);
  const machines = optionMachines(pack, graph, offerEnv, owned);
  const room = steps.some((s) => s.lp.needsCleanroom) ? cleanroomMachine(pack) : undefined;
  const prices = await itemPrices(pack, settings, ctx, buildKeys(pack, room === undefined ? machines : [...machines, room]));
  const env: MachineOptionEnv = { ...offerEnv, coilHeat: basis.coilHeat, owned, prices };

  const eligibleById = new Map<string, MachineOption[]>();
  for (const { lp, r, mapId } of steps) eligibleById.set(lp.id, machineOptions(pack, r, mapId, { ...env, eligibleOnly: true }));
  const dearestOf = new Map<string, number>();
  let dearest: number | undefined;
  for (const options of eligibleById.values()) {
    for (const { kind, tier, build } of options) {
      if (build === null) continue;
      dearestOf.set(`${kind}:${tier}`, Math.max(dearestOf.get(`${kind}:${tier}`) ?? build, build));
      dearest = Math.max(dearest ?? build, build);
    }
  }
  const standIn = (kind: MachineOption['kind'], tier: number): number => dearestOf.get(`${kind}:${tier}`) ?? dearest ?? 0;
  for (const [id, options] of eligibleById) eligibleById.set(id, options.map((o) => (o.build === null ? { ...o, solveBuild: standIn(o.kind, o.tier) } : o)));

  let cleanroom: BuildModel['cleanroom'] = null;
  if (room !== undefined) {
    const build = machineBuildCost(pack, prices, room);
    cleanroom = { mteId: room.mteId, name: room.name, build, solveBuild: build ?? dearest ?? 0, owned: owned.get(room.mteId) ?? 0 };
    const why = build === null ? unbuildableText(pack, room, machineGap(pack, prices, room), basis.tier) : undefined;
    if (why !== undefined) cleanroom.unbuildable = why;
  }
  // A cleanroom that cannot be built here and none owned: why the steps that need one cannot run.
  const roomWhy = cleanroom !== null && (pools.get(cleanroom.mteId)?.length ?? 0) === 0 ? cleanroom.unbuildable : undefined;

  const optionsById = new Map<string, MachineOption[]>();
  const fallbackById = new Map<string, PinFallback>();
  const blocked = new Map<string, string>();
  const ownedOnly = new Map<string, { runsPerSecond: number; text: string }>();
  /**
   * OQ5 (a): why no machine can run `r` on `mapId` — every eligible machine cannot be built here and none is owned (a
   * furnace step, and a crafting step by hand or in a pack without an Auto Workbench, has no machine to name), or its
   * cleanroom cannot be built — with its options (rules 1–8, its pin) and pin fallback; `why` undefined when one can.
   */
  const judge = (r: Recipe, mapId: string, eligible: readonly MachineOption[] | undefined): { options: MachineOption[]; fallback?: PinFallback; why?: string } => {
    const pin = Object.hasOwn(settings.machineTier, r.id) ? settings.machineTier[r.id] : undefined;
    const judged: { options: MachineOption[]; fallback?: PinFallback; why?: string } = optionsOf(pack, r, mapId, { ...env, standIn, pin });
    const first = (eligible ?? machineOptions(pack, r, mapId, { ...env, eligibleOnly: true }))[0];
    const why = judged.options.length === 0 && first?.unbuildable !== undefined ? `${first.name} cannot be built here (${first.unbuildable})`
      : roomWhy !== undefined && r.meta.cleanroom === true ? `Cleanroom cannot be built here (${roomWhy})` : undefined;
    if (why !== undefined) judged.why = why;
    return judged;
  };
  for (const { lp, r, mapId } of steps) {
    const { options, fallback, why } = judge(r, mapId, eligibleById.get(lp.id));
    if (why !== undefined) {
      blocked.set(lp.id, why);
      optionsById.set(lp.id, []);
      continue;
    }
    optionsById.set(lp.id, options);
    if (fallback !== undefined) fallbackById.set(lp.id, fallback);
    // Only owned machines that cannot be built are left when no option can add machines (a pricing gap loses `canAdd`
    // only beside a priced option, which keeps it).
    const lead = options[0];
    if (lead?.unbuildable !== undefined && !options.some((o) => o.canAdd)) {
      let runsPerSecond = 0;
      for (const o of options) runsPerSecond += o.perMachine * o.owned;
      ownedOnly.set(lp.id, { runsPerSecond, text: `${lead.owned}× ${lead.name}, which cannot be built here (${lead.unbuildable})` });
    }
  }

  // The recipes of the maps it blocks that no machine can run either (`BuildModel.blockedAlike`).
  const alike = new Map<string, string>();
  if (blocked.size > 0) {
    const priced = new Set(machines.map((m) => m.mteId));
    const inGraph = new Set(steps.map((s) => s.lp.id));
    const maps = [...new Set(steps.filter((s) => blocked.has(s.lp.id)).map((s) => s.mapId))].sort(byString);
    for (const mapId of maps) {
      for (const r of recipesOfMap(pack, mapId)) {
        if (inGraph.has(r.id) || alike.has(r.id)) continue;
        const accepted = acceptRecipe(pack, r, basis.env);
        if (!accepted.ok || accepted.mapId !== mapId) continue;
        if (!offersFor(pack, r, mapId, { ...offerEnv, owned }).every(({ m }) => priced.has(m.mteId))) continue;
        const { why } = judge(r, mapId, undefined);
        if (why !== undefined) alike.set(r.id, why);
      }
    }
  }

  const share = sharesMachines(settings);
  const parts = share ? ae2Parts(pack, graph) : undefined;
  const keys = new Map<string, string>();
  for (const { lp, r } of steps) {
    const part = parts?.get(lp.id) ?? 0;
    keys.set(lp.id, `${sharingKey(r, lp.nonConsumed, pack)}${part > 0 ? `#${part}` : ''}`);
  }
  const horizonSeconds = settings.mode === 'makeN' || settings.buildHorizonHours === null
    ? null : (settings.buildHorizonHours ?? DEFAULT_BUILD_HORIZON_HOURS) * SECONDS_PER_HOUR;

  const model: BuildModel = {
    mode: settings.mode, horizonSeconds, share,
    sharingKey: (id) => keys.get(id) ?? '-|',
    options: (id) => optionsById.get(id) ?? [],
    eligible: (id) => eligibleById.get(id) ?? [],
    blocked,
    ownedOnly: (id) => ownedOnly.get(id),
    pinFallback: (id) => fallbackById.get(id),
    owned, pools, prices, cleanroom,
  };
  if (alike.size > 0) model.blockedAlike = alike;
  return model;
}
