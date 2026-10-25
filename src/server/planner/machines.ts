// Machines per step (spec §3.3, §3.9; prior-art §3.4 step 6, §3.5; gt-mechanics §2): which machine runs each recipe the
// solver chose and at what tier (plan 12: the build-cost solve's decision), its overclocked speed, how many machines a
// step needs and how busy they are, which of the group's own machines it runs on (owned units, sharing pools, owned
// machines of other tiers), the tiers it could run at, and the item and fluid flows between the steps.

import { multiblockOverclock, singleblockOverclock, voltageTier, type MachineOc } from '../../shared/gt/overclock.ts';
import { V, tierName } from '../../shared/gt/tiers.ts';
import { compareMachineId, legacyMteId, isPseudoMachineId, MC_MACHINES, type MachineId } from '../../shared/ids.ts';
import type { StuffKey } from '../../shared/keys.ts';
import type { Ingredient, Machine, Pack, Product, Recipe } from '../../shared/types/pack.ts';
import {
  FREE_KEYS, type MachineWhere, type PlanContext, type PlanFlow, type PlanSettings, type PlanStep, type StepTier,
} from '../../shared/types/plan.ts';
import { machineIdsForMap, machineOf } from '../pack/lookup.ts';
import { suppliedKey } from '../pack/supply.ts';
import type { StepMachines } from './build-mip.ts';
import { keptOptions, virtualKey, type CandidateGraph, type LpRecipe } from './candidates.ts';
import { feedsEither, poolKey, sharesMachines, sharingKey, type BuildModel, type MachineOption, type OwnedPools } from './machine-options.ts';
import { ownedPools, recipeCircuit } from './owned.ts';
import { sig9 } from './round.ts';
import type { Solution } from './solve.ts';

export interface MachinePick {
  id: MachineId; name: string; tier: number; kind: 'basic' | 'multiblock' | 'hand' | 'crafting' | 'furnace'; oc: MachineOc;
  runsPerSecondPerMachine: number; handCraft: boolean;
}

const TICKS_PER_SECOND = 20;
/** Ruling R5: one craft per second per crafter, whatever the recipe's duration (0 for crafting recipes, §11.4). */
const CRAFT_TICKS = 20;
/**
 * Amounts up to this count as zero, and a machine count this little above a whole number stays whole (prior-art §3.4
 * step 6: a count that is exactly 2 stays 2).
 */
const TINY = 1e-9;
/**
 * The share of a load its rate's 9 significant digits can move it by (plan 12 Task 8): a step's runs per second keep 9
 * significant digits (`sig9`), up to 5e-9 of their value off, so a set of machines exactly full can read a little above a
 * whole number — 10 machines' worth at 1/6 a run a second reads 10.00000002 — and stays that whole number, as an exact 2
 * stays 2 (`TINY`).
 */
const SIG9_SLACK = 1e-8;

/** How little above a whole number `load` machines' worth may read and still stay that number: `TINY` or its 9 digits' slack. */
function wholeSlack(load: number): number {
  return Math.max(TINY, SIG9_SLACK * Math.abs(load));
}

/** The whole machines `load` machines' worth needs (`wholeSlack`); 0 for none. */
function wholeMachines(load: number): number {
  return Math.ceil(load - wholeSlack(load));
}
const HAND_CRAFT_RUNS_PER_SECOND = 1;
/**
 * A flow below this share of what its producer makes of the good is dropped (fix spec D3): relative, so a line keeps
 * its arrows at 1 per hour (an absolute 1e-9 per second dropped real ones there).
 */
export const FLOW_DROP_REL = 1e-9;

const HAND_NAME = 'Crafting table (by hand)';
const CRAFTING_TABLE_NAME = 'Crafting table (automated)';
const FURNACE_NAME = 'Furnace';

/** The flow endpoints that are not steps. */
const RAW = 'raw';
const OUT = 'out';
const SINK = 'sink';

function byString(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0;
}

function clamp(x: number, lo: number, hi: number): number {
  return Math.min(Math.max(x, lo), hi);
}

function tierOf(m: Machine): number {
  return m.tier ?? 0;
}

/** A machine that does not overclock and draws `euPerTick` (0: no EU at all). */
function fixedOc(euPerTick: number, durationTicks: number): MachineOc {
  return { euPerTick, durationTicks, overclocks: 0, heatOverclocks: 0, machineVoltage: 0, machineAmps: 0, parallel: 1 };
}

function picked(p: Omit<MachinePick, 'runsPerSecondPerMachine'>): MachinePick {
  return { ...p, runsPerSecondPerMachine: (TICKS_PER_SECOND * p.oc.parallel) / p.oc.durationTicks };
}

/** Highest tier first, then the lowest mteId. */
function preferred(a: Machine, b: Machine): number {
  return tierOf(b) - tierOf(a) || compareMachineId(a.id, b.id);
}

/** `wantTier` clamped to the accepting tiers (the highest machine at or below it), else owned, else the highest tier. */
function chooseSingleblock(accepting: Machine[], wantTier: number | undefined, owned: ReadonlyMap<MachineId, number>): Machine {
  if (wantTier !== undefined) {
    const tiers = accepting.map(tierOf);
    const tier = clamp(wantTier, Math.min(...tiers), Math.max(...tiers));
    return accepting.filter((m) => tierOf(m) <= tier).sort(preferred)[0] as Machine;
  }
  const mine = accepting.filter((m) => (owned.get(m.id) ?? 0) > 0);
  return (mine.length > 0 ? mine : accepting).sort(preferred)[0] as Machine;
}

/**
 * The machine that runs `r` on `mapId` for a group at `groupTier`: a crafting table (by hand unless crafting is
 * automated), the vanilla furnace, else a singleblock of the map at or below the group's tier that has the voltage for
 * the recipe (the per-recipe `wantTier`, else the best owned one, else the highest tier), else the map's multiblock
 * with one energy hatch at `wantTier ?? groupTier`. Throws when the map has no machine that can run the recipe.
 */
export function pickMachine(
  pack: Pack, r: Recipe, mapId: string,
  opts: {
    groupTier: number; wantTier?: number; coilHeat: number; automateCrafting: boolean; owned: ReadonlyMap<MachineId, number>;
    /** The multiblocks the group can build (`PlanEnv.multiblocks`); absent = any. */
    multiblocks?: ReadonlySet<MachineId>;
  },
): MachinePick {
  if (mapId === 'crafting') {
    const hand = !opts.automateCrafting;
    return picked({
      id: hand ? MC_MACHINES.HAND : MC_MACHINES.CRAFTING_TABLE, name: hand ? HAND_NAME : CRAFTING_TABLE_NAME, tier: 0,
      kind: hand ? 'hand' : 'crafting', oc: fixedOc(0, CRAFT_TICKS), handCraft: hand,
    });
  }
  if (mapId === 'furnace') {
    // It burns fuel, not EU; a duration of at least one tick keeps the rate finite.
    return picked({
      id: MC_MACHINES.FURNACE, name: FURNACE_NAME, tier: 0, kind: 'furnace', oc: fixedOc(0, Math.max(r.durationTicks, 1)),
      handCraft: false,
    });
  }

  const machines = machineIdsForMap(pack, mapId).flatMap((id) => machineOf(pack, id) ?? []);
  const mapAmps = pack.maps.get(mapId)?.amps ?? 1;
  // The rule of acceptRecipe (candidates.ts): machine tier ≤ group tier and EU/t ≤ V[machine tier] × the map's amps.
  const accepting = machines.filter(
    (m) => m.kind === 'basic' && tierOf(m) <= opts.groupTier && (V[tierOf(m)] as number) * mapAmps >= r.euPerTick,
  );
  if (accepting.length > 0) {
    const m = chooseSingleblock(accepting, opts.wantTier, opts.owned);
    const oc = singleblockOverclock(r, { tier: tierOf(m), amps: m.amps ?? mapAmps });
    return picked({ id: m.id, name: m.name, tier: tierOf(m), kind: 'basic', oc, handCraft: false });
  }

  const built = opts.multiblocks;
  const multis = machines.filter((m) => m.kind === 'multiblock').sort((a, b) => compareMachineId(a.id, b.id));
  const multi = (built === undefined ? undefined : multis.find((m) => built.has(m.id))) ?? multis[0];
  if (multi === undefined) throw new Error(`pickMachine: no machine on ${mapId} runs recipe ${r.id} at ${tierName(opts.groupTier)}`);
  // Never a hatch above the group's tier, nor one too weak for the recipe (spec §5).
  const hatchTier = clamp(opts.wantTier ?? opts.groupTier, Math.min(voltageTier(r.euPerTick), opts.groupTier), opts.groupTier);
  const oc = multiblockOverclock(
    { euPerTick: r.euPerTick, durationTicks: r.durationTicks, heat: r.meta.coilHeat ?? r.specialValue },
    { hatchTier, perfectOC: multi.perfectOC === true, heatOC: multi.heatOC === true, coilHeat: opts.coilHeat },
  );
  return picked({ id: multi.id, name: multi.name, tier: hatchTier, kind: 'multiblock', oc, handCraft: false });
}

// The owned pools and a recipe's programmed circuit live in a leaf module (owned.ts); their callers keep reading them here.
export { ownedMachineMap, ownedPools, recipeCircuit } from './owned.ts';

type Option = Ingredient['options'][number];

/** good → node → amount per unit of time. */
type Amounts = Map<StuffKey, Map<string, number>>;

function addAmount(amounts: Amounts, key: StuffKey, node: string, amount: number): void {
  let nodes = amounts.get(key);
  if (nodes === undefined) {
    nodes = new Map();
    amounts.set(key, nodes);
  }
  nodes.set(node, (nodes.get(node) ?? 0) + amount);
}

function sum(nodes: ReadonlyMap<string, number> | undefined): number {
  let total = 0;
  for (const amount of nodes?.values() ?? []) total += amount;
  return total;
}

/** What each recipe with runs makes and consumes of each good (`coeffs` × runs), convert recipes included. */
function recipeAmounts(graph: CandidateGraph, runsById: ReadonlyMap<string, number>): { made: Amounts; used: Amounts } {
  const made: Amounts = new Map();
  const used: Amounts = new Map();
  for (const r of graph.recipes) {
    const runs = runsById.get(r.id);
    if (runs === undefined) continue;
    for (const [key, c] of r.coeffs) addAmount(c > 0 ? made : used, key, r.id, Math.abs(c) * runs);
  }
  return { made, used };
}

/**
 * The line takes all a recipe makes of a good when it throws at most this share of it away (fix spec D13): runs keep 9
 * significant digits (D3), which leaves about 1e-9 of it over where the line takes it all, while a recipe run for
 * another output throws a real share of it away (the GEC HV line's water electrolysis, 90 % of its Oxygen).
 */
const ALL_TAKEN_REL = 1e-6;

/**
 * Per recipe id, the goods the line has from that recipe alone and takes in full (fix spec D13, `StepLine.runsFor`): no
 * other recipe makes any of the good, and the other recipes take all the recipe makes of it but what rounding leaves
 * (`ALL_TAKEN_REL`).
 */
function soleTakenInFull(made: Amounts, used: Amounts): Map<string, Set<StuffKey>> {
  const runsFor = new Map<string, Set<StuffKey>>();
  for (const [key, makers] of made) {
    const making = [...makers].filter(([, amount]) => amount > 0);
    const only = making.length === 1 ? making[0] : undefined;
    if (only === undefined) continue;
    const [id, own] = only;
    const users = used.get(key);
    const taken = sum(users) - (users?.get(id) ?? 0);
    if (own - taken >= own * ALL_TAKEN_REL) continue;
    const goods = runsFor.get(id);
    if (goods === undefined) runsFor.set(id, new Set([key]));
    else goods.add(key);
  }
  return runsFor;
}

/** The good a convert recipe fills (its only output) and the option it takes (its only input). */
function convertEnds(r: LpRecipe): { virtual: StuffKey; option: StuffKey } | null {
  const virtual = r.coeffs.find(([, c]) => c > 0)?.[0];
  const option = r.coeffs.find(([, c]) => c < 0)?.[0];
  return virtual === undefined || option === undefined ? null : { virtual, option };
}

/** One option of a consumed slot and its share of the slot in the line (0..1). */
export interface OptionShare { option: Option; share: number }

/**
 * Every option of consumed slot `ing` of `r` the line may take (`keptOptions`: none the graph avoids), by key, each with
 * its share of the slot (fix spec R9): the runs of the convert recipe that filled the slot's virtual good from it over
 * those of all of them. A slot the graph pins (`StepLine.optionPins`) is its pin alone, the others at 0; a slot of one
 * option is that option. When no conversion of the slot ran, the first option by key takes it whole.
 */
export function optionShares(r: Recipe, ing: Ingredient, line: StepLine): OptionShare[] {
  const kept = keptOptions(ing.options, line.avoid);
  const sorted = [...kept].sort((a, b) => byString(a.key, b.key));
  const pin = line.optionPins?.get(`${r.id}#${ing.slot}`);
  if (pin !== undefined && sorted.some((o) => o.key === pin)) return sorted.map((option) => ({ option, share: option.key === pin ? 1 : 0 }));
  if (sorted.length <= 1) return sorted.map((option) => ({ option, share: 1 }));
  // A slot with several options is the virtual good candidates.ts made for it.
  const runs = line.conversions.get(virtualKey(kept));
  const ran = (o: Option): number => Math.max(0, runs?.get(o.key) ?? 0);
  let total = 0;
  for (const option of sorted) total += ran(option);
  return sorted.map((option, i) => ({ option, share: total > 0 ? sig9(ran(option) / total) : i === 0 ? 1 : 0 }));
}

/** Virtual good → option → runs of the convert recipe that fills it from that option. */
function conversionRuns(graph: CandidateGraph, runsById: ReadonlyMap<string, number>): Map<StuffKey, Map<StuffKey, number>> {
  const runs = new Map<StuffKey, Map<StuffKey, number>>();
  for (const r of graph.recipes) {
    const ends = r.kind === 'convert' ? convertEnds(r) : null;
    if (ends !== null) addAmount(runs, ends.virtual, ends.option, runsById.get(r.id) ?? 0);
  }
  return runs;
}

/** One good of a step's inputs, added up over the slots it fills. */
interface InputTotal { expected: number; nominal: number; chance: number; sameChance: boolean }

/**
 * The consumed inputs per run with expected amounts (`amount × chance`), one entry per good in the order of the slot
 * it first fills: a good in several slots (a real crafting recipe has one ingredient of amount 1 per grid slot,
 * recipes.ts) is added up. Its `chance` is the slots' chance when they share one, else the expected amount over the
 * nominal one. Not-consumed inputs are one-off items of the machine (Task 13). A slot is read as the graph has it, so
 * without the options the line avoids (`keptOptions`, ruling R7) and with its pin (`optionPins`). An ore-dictionary slot
 * lists every option it took (fix spec R9, `optionShares`), each at its share of the slot: `amount × chance × share`,
 * with chance `chance × share` when the slot is split.
 */
export function stepInputs(r: Recipe, line: StepLine): Product[] {
  const totals = new Map<StuffKey, InputTotal>();
  for (const ing of r.inputs) {
    if (!ing.consumed) continue;
    for (const { option, share } of optionShares(r, ing, line)) {
      if (share <= 0) continue;
      const whole = share === 1;
      const expected = whole ? option.amount * ing.chance : sig9(option.amount * ing.chance * share);
      const chance = whole ? ing.chance : sig9(ing.chance * share);
      const total = totals.get(option.key);
      if (total === undefined) {
        totals.set(option.key, { expected, nominal: option.amount, chance, sameChance: true });
      } else {
        total.expected += expected;
        total.nominal += option.amount;
        total.sameChance &&= total.chance === chance;
      }
    }
  }
  return [...totals].map(([key, t]) => ({
    key, amount: t.expected, chance: t.sameChance || t.nominal <= 0 ? t.chance : t.expected / t.nominal,
  }));
}

/**
 * `line.valueOf` when the line was given one. The name (fix spec D13) shadows `Object.prototype.valueOf`, which every
 * object inherits, so only an own property counts: TypeScript makes every `StepLine` literal spell it out (`undefined`
 * when there is none), and this guards the objects that reach here some other way.
 */
function valueOfLine(line: Pick<StepLine, 'valueOf'>): ((key: StuffKey) => number) | undefined {
  return Object.hasOwn(line, 'valueOf') && typeof line.valueOf === 'function' ? line.valueOf : undefined;
}

/** Free inputs (water, lava, air, cobblestone): a step that makes one beside another good does not run for it. */
const FREE: ReadonlySet<StuffKey> = new Set(FREE_KEYS);

/**
 * What the step is for (fix spec D13): the target when the recipe makes it; else the output with the largest value,
 * `line.valueOf(key)` × what the other recipes take of it, then the most taken, then the smallest key, of these:
 * - its outputs but an empty container the recipe hands back (`line.empties`), unless it makes nothing else;
 * - of those, never a good the line buys (`line.bought`) while the recipe makes another that the other recipes take,
 *   that the line does not buy and that is neither a free input nor a container it hands back: at an optimum the step
 *   runs for that one (making more of a good the line buys would cost more than buying it), as a Bricked Blast Furnace
 *   runs for its Ferrosilite beside bought copper;
 * - of those, when there are any, only the ones the line has from this recipe alone and takes in full
 *   (`line.runsFor`), that the line does not buy and that are neither free inputs nor containers it hands back. Such an
 *   output sets how much the step runs, so at an optimum the step runs for it, not for a good another step makes too
 *   (run for that good, it would be its cheaper source and the other step would not run beside it): a reactor that
 *   alone makes the line's Iron III Chloride runs for it, not for the Hydrogen Cells beside it that an electrolyzer
 *   makes too. An output the line throws part of away sets nothing: the GEC HV line's water electrolysis alone makes
 *   its Oxygen, throws 90 % of it away and runs for its Hydrogen Cells.
 * Without `valueOf` every value is 0, so the output the other recipes take most of wins (the rule before values:
 * litres beat items there); without `bought` no output is passed over for being bought, and without `runsFor` none for
 * being made by another recipe too.
 */
function mainOutputOf(r: Recipe, line: StepLine): StuffKey | undefined {
  const outputs = [...new Set(r.outputs.map((p) => p.key))].sort(byString);
  const target = outputs.find((key) => line.targets.has(key));
  if (target !== undefined) return target;
  const handedBack = (key: StuffKey): boolean => line.empties?.has(key) === true;
  /** What the line's other recipes take of `key`. */
  const useOf = (key: StuffKey): number => {
    const nodes = line.used.get(key);
    return sum(nodes) - (nodes?.get(r.id) ?? 0);
  };
  const bought = line.bought;
  /** An output the other recipes take that the line does not buy and that is neither a free input nor handed back. */
  const takenAndNotBought = (key: StuffKey): boolean => bought?.has(key) !== true && !FREE.has(key) && !handedBack(key) && useOf(key) > 0;
  let candidates = outputs.some((key) => !handedBack(key)) ? outputs.filter((key) => !handedBack(key)) : outputs;
  if (bought !== undefined && outputs.some(takenAndNotBought)) candidates = candidates.filter((key) => !bought.has(key));
  const runsFor = line.runsFor?.get(r.id);
  if (runsFor !== undefined) {
    const alone = candidates.filter((key) => runsFor.has(key) && takenAndNotBought(key));
    if (alone.length > 0) candidates = alone;
  }
  const valueOf = valueOfLine(line);
  let best: StuffKey | undefined;
  let bestValue = -Infinity;
  let bestUse = -Infinity;
  for (const key of candidates) {
    const use = useOf(key);
    const value = valueOf === undefined ? 0 : valueOf(key) * use;
    if (value > bestValue || (value === bestValue && use > bestUse)) {
      best = key;
      bestValue = value;
      bestUse = use;
    }
  }
  return best;
}

/**
 * A recipe the solution runs that is a step (convert recipes are not), and the machine that runs it; `decided` is the
 * build-cost solve's decision for it (`Solution.machines`), when it made one.
 */
export interface PickedRecipe { id: string; runs: number; lp: LpRecipe; mapId: string; recipe: Recipe; pick: MachinePick; decided?: StepMachines }

/** The machine of a machine option (plan 12): its type, tier and overclock, as the build-cost solve picked it. */
function optionPick(o: MachineOption): MachinePick {
  return { id: o.id, name: o.name, tier: o.tier, kind: o.kind, oc: o.oc, runsPerSecondPerMachine: o.perMachine, handCraft: false };
}

/**
 * The recipes in `runs` that are steps, sorted by id, each with its machine: the option the build-cost solve decided
 * for it (`machines`, plan 12: `Solution.machines`), else `pickMachine` with the recipe's own tier from
 * `settings.machineTier` and the group's `owned` machines (pseudo steps, and lines solved without a build model). Shared
 * by the rate plan and Make N.
 */
export function pickStepMachines(
  pack: Pack, graph: CandidateGraph, runs: ReadonlyMap<string, number>,
  opts: {
    settings: PlanSettings; groupTier: number; coilHeat: number; owned: ReadonlyMap<MachineId, number>; multiblocks?: ReadonlySet<MachineId>;
    machines?: ReadonlyMap<string, StepMachines>;
  },
): PickedRecipe[] {
  const { settings, groupTier, coilHeat, owned, multiblocks, machines } = opts;
  const lpById = new Map(graph.recipes.map((r) => [r.id, r]));
  const picked: PickedRecipe[] = [];
  for (const [id, n] of [...runs].sort(([a], [b]) => byString(a, b))) {
    const lp = lpById.get(id);
    if (lp === undefined || lp.kind === 'convert' || lp.mapId === null) continue;
    const recipe = pack.recipeById.get(id);
    if (recipe === undefined) throw new Error(`recipe ${id} of the plan is not in the pack`);
    const decided = machines?.get(id);
    if (decided !== undefined) {
      picked.push({ id, runs: n, lp, mapId: lp.mapId, recipe, pick: optionPick(decided.option), decided });
      continue;
    }
    const wantTier = Object.hasOwn(settings.machineTier, id) ? settings.machineTier[id] : undefined;
    // a crafting-table recipe no Auto Workbench of the line runs is crafted by hand (`LpRecipe.byHand`, controller ruling 214)
    const automateCrafting = settings.automateCrafting && lp.byHand === undefined;
    const pick = pickMachine(pack, recipe, lp.mapId, { groupTier, wantTier, coilHeat, automateCrafting, owned, multiblocks });
    picked.push({ id, runs: n, lp, mapId: lp.mapId, recipe, pick });
  }
  return picked;
}

/**
 * What describing a step needs from the whole line: its targets, what its recipes consume, its ore-dictionary
 * conversions, and the goods its graph avoids.
 */
export interface StepLine {
  targets: ReadonlySet<StuffKey>;
  used: ReadonlyMap<StuffKey, ReadonlyMap<string, number>>;
  conversions: ReadonlyMap<StuffKey, ReadonlyMap<StuffKey, number>>;
  avoid?: ReadonlySet<StuffKey>;
  // optional additions (fix spec D13): what names a step's main output
  /**
   * What one unit of a good is worth (planLine: its cost-model raw cost, never below its plain price). Read only as an
   * own property (`valueOfLine`); a literal without values sets it `undefined`, as TypeScript otherwise sees `Object`'s
   * valueOf there.
   */
  valueOf?: (key: StuffKey) => number;
  /** The empty containers of the pack (`emptyContainers`): a recipe handing one back is not there for it. */
  empties?: ReadonlySet<StuffKey>;
  // optional addition (fix spec D13, plan 09 Task 8)
  /**
   * The goods the line buys (`boughtGoods` of the solution's purchases, or of the Make N batch's): a step making one of
   * them beside another output the line uses and does not buy is named after that other output (`mainOutputOf`).
   */
  bought?: ReadonlySet<StuffKey>;
  // optional addition (fix spec D13, plan 09 final review)
  /**
   * Recipe id → the goods the line has from that recipe alone and takes in full (`soleTakenInFull`): what sets how much
   * the recipe runs, so a step is named after one of them (`mainOutputOf`). `stepLine` reads it from the runs it is
   * given; Make N from the line's LP, not its whole runs, whose rounding leaves over goods the line takes in full.
   */
  runsFor?: ReadonlyMap<string, ReadonlySet<StuffKey>>;
  // optional addition (fix spec R9)
  /** The ingredient options the graph pins (`CandidateGraph.optionPins`): `<recipe id>#<slot>` → the option it takes. */
  optionPins?: ReadonlyMap<string, StuffKey>;
}

/**
 * The `StepLine` of a line that runs each recipe `runs` times (per second or in all; only the proportions matter), with
 * the `value` of its goods when the caller has one.
 */
export function stepLine(graph: CandidateGraph, runs: ReadonlyMap<string, number>, value?: Pick<StepLine, 'valueOf' | 'empties'>): StepLine {
  const { made, used } = recipeAmounts(graph, runs);
  const line: StepLine = {
    targets: new Set(graph.targets), used, runsFor: soleTakenInFull(made, used), conversions: conversionRuns(graph, runs),
    valueOf: value === undefined ? undefined : valueOfLine(value),
  };
  if (graph.avoid !== undefined) line.avoid = graph.avoid;
  if (value?.empties !== undefined) line.empties = value.empties;
  if (graph.optionPins !== undefined) line.optionPins = graph.optionPins;
  return line;
}

/** The goods a line buys, from its purchases (`Solution.buys`, or a Make N batch's): `StepLine.bought`. */
export function boughtGoods(buys: ReadonlyMap<StuffKey, number>): ReadonlySet<StuffKey> {
  return new Set([...buys].filter(([, amount]) => amount > 0).map(([key]) => key));
}

const EMPTIES = new WeakMap<Pack, ReadonlySet<StuffKey>>();

/** Every empty container of the pack (the `empty` of a `fluidContainers` entry: an Empty Cell), once per pack. */
export function emptyContainers(pack: Pack): ReadonlySet<StuffKey> {
  let set = EMPTIES.get(pack);
  if (set === undefined) {
    set = new Set((pack.fluidContainers ?? []).flatMap((c) => (c.empty === null ? [] : [c.empty])));
    EMPTIES.set(pack, set);
  }
  return set;
}

/** The warnings that follow from a step's recipe and machine: cleanroom, fast hand-crafting, one energy hatch. */
export function machineWarnings(lp: LpRecipe, pick: MachinePick, runsPerSecond: number): string[] {
  const warnings: string[] = [];
  if (lp.needsCleanroom) warnings.push('Needs a cleanroom');
  // why no Auto Workbench crafts it although the line's crafting is automated (controller ruling 214, user ruling 180 (d))
  if (pick.handCraft && lp.byHand !== undefined) warnings.push(`Crafted by hand: it ${lp.byHand}`);
  if (pick.handCraft && runsPerSecond > HAND_CRAFT_RUNS_PER_SECOND) {
    warnings.push('More than one craft per second by hand — consider automating it');
  }
  if (pick.kind === 'multiblock') warnings.push(`Multiblock: count assumes one energy hatch at ${tierName(pick.tier)}`);
  return warnings;
}

/**
 * How the caller sized a step: machines, owned ones among them (and, when there are any, which: `reused`), rate, how
 * busy they are, and the step's warnings.
 */
export type StepSize = Pick<PlanStep, 'count' | 'owned' | 'runsPerSecond' | 'utilization' | 'warnings' | 'reused'>;

/**
 * The step of a picked recipe, sized by the caller: the machine and its overclocked speed, per-run inputs (one per
 * good, slots added up) and outputs (expected amounts), the main output, the overclock inputs, the cleanroom flag, the
 * programmed circuit, for a supply recipe the good it supplies (`suppliedKey`, fix spec R2), and the owned machines it
 * runs on (`size.reused`).
 * `alternatives` stays empty here (Task 14 fills it).
 */
export function describeStep(pack: Pack, p: PickedRecipe, line: StepLine, size: StepSize): PlanStep {
  const { id, recipe: r, pick } = p;
  const step: PlanStep = {
    id, recipeId: id, mapId: p.mapId, machine: { mteId: legacyMteId(pick.id), name: pick.name, tier: pick.tier },
    count: size.count, owned: size.owned, runsPerSecond: size.runsPerSecond, utilization: size.utilization,
    euPerTick: pick.oc.euPerTick, durationTicks: pick.oc.durationTicks, overclocks: pick.oc.overclocks,
    inputs: stepInputs(r, line),
    outputs: r.outputs.map((o) => ({ key: o.key, amount: o.amount * o.chance, chance: o.chance })),
    alternatives: [], handCraft: pick.handCraft, warnings: size.warnings,
  };
  const mainOutput = mainOutputOf(r, line);
  if (mainOutput !== undefined) step.mainOutput = mainOutput;
  step.oc = {
    recipeEuPerTick: r.euPerTick, recipeDurationTicks: baseDurationTicks(r, p.mapId, pick), machineVoltage: pick.oc.machineVoltage,
    machineAmps: pick.oc.machineAmps, perfect: pick.kind === 'multiblock' && machineOf(pack, pick.id)?.perfectOC === true,
    heatOverclocks: pick.oc.heatOverclocks,
  };
  if (p.lp.needsCleanroom) step.needsCleanroom = true;
  const circuit = recipeCircuit(r);
  if (circuit !== undefined) step.circuit = circuit;
  const supply = suppliedKey(r, pack.fluidContainers);
  if (supply !== undefined) step.supply = supply;
  if (size.reused !== undefined) step.reused = size.reused;
  return step;
}

/**
 * One step's claim on the owned machines of one machine type (`assignOwned`, plan 12): `load` is the machines' worth of
 * the type it needs; `also` marks the owned machines of another of its options it runs on beside its own type's
 * (`StepMachines.others`), which take exactly their `share` (the owned machines' worth the build-cost solve gave it; an
 * own claim is placed by its load alone); `key` is its sharing pool (with sharing; default its own id); `ownedOnly`, a
 * step that can only run on owned machines (`BuildModel.ownedOnly`).
 */
export interface OwnedClaim { stepId: string; id: MachineId; load: number; share?: number; also?: boolean; key?: string; ownedOnly?: boolean }

/**
 * Which owned machines (`units`, indices in the type's pool, ascending) a step runs on and how many new ones of its
 * type it adds; `pool` (`'pool:' + its smallest id`) when a sharing pool of two or more steps holds them; `others`, the
 * units of its `also` claims, per type.
 */
export interface OwnedAssignment { units: number[]; added: number; pool?: string; others?: Array<{ id: MachineId; units: number[] }> }

/**
 * A claim's first unit is taken for any load above 0 (a running step needs a machine); further ones while more than
 * `slack` is left (`wholeSlack` of the claim's whole load).
 */
function loadLeft(left: number, taken: number, slack: number): boolean {
  return taken === 0 ? left > 0 : left > slack;
}

/**
 * The owned machines of `pools` the steps run on (plan 12, design spec §3.3 "Reusing machines we have"), one entry per
 * step id of `claims`, deterministic whatever order the solver broke its ties in. Per machine type (by mteId), first the
 * `also` claims, by id, each taking exactly its `share` — without `shared`, that many whole units (the next indices);
 * with it, room in a unit that serves its key and holds all of it (the least room that does, then the lower index), else
 * the next free unit, which then serves its key, spilling into further free units for a share above 1 — and adding no
 * machine (the solve's owned rows left room for them); then the own claims, those with `ownedOnly` first (a step that
 * can only use owned machines takes its units before the others, so a machine that cannot be built is never added).
 * Without `shared`, by load descending, then id: `needed = max(1, wholeMachines(load))`, the next `min(needed, left)`
 * units, and the rest added new. With it, the claims of one key form a sharing pool of their summed load; pools by load
 * descending, then their smallest id: a pool takes the room left in the units of its key (index order), then free units
 * (the next indices) while load is left — any load above 0 takes one — then `ceil(left − slack)` new machines, at least
 * one machine in all, `slack` being `wholeSlack` of the pool's load (a load read from 9 significant digits, a little
 * above a whole number, stays whole); every claim of the pool gets the pool's units and new machines. A unit serves one key (controller
 * ruling 9), and a pool takes no unit its load does not reach, so no step is counted on machines it does not use.
 */
export function assignOwned(claims: readonly OwnedClaim[], pools: OwnedPools, shared: boolean): Map<string, OwnedAssignment> {
  const out = new Map<string, OwnedAssignment>();
  const entryOf = (id: string): OwnedAssignment => {
    let entry = out.get(id);
    if (entry === undefined) out.set(id, (entry = { units: [], added: 0 }));
    return entry;
  };
  const byType = new Map<MachineId, OwnedClaim[]>();
  for (const claim of claims) {
    entryOf(claim.stepId);
    const list = byType.get(claim.id);
    if (list === undefined) byType.set(claim.id, [claim]);
    else list.push(claim);
  }
  for (const id of [...byType.keys()].sort(compareMachineId)) {
    const list = byType.get(id) as OwnedClaim[];
    const total = pools.get(id)?.length ?? 0;
    const free = Array.from({ length: total }, (_, u) => u);   // the next indices first
    const used = new Array<number>(total).fill(0);              // with sharing: machines' worth on each unit
    const keyOf: Array<string | undefined> = new Array<string | undefined>(total).fill(undefined);
    const take = (u: number, key: string, amount: number): void => {
      keyOf[u] = key;
      used[u] = (used[u] ?? 0) + amount;
    };
    for (const claim of list.filter((c) => c.also === true).sort((a, b) => byString(a.stepId, b.stepId))) {
      const share = Math.max(0, claim.share ?? claim.load);
      const key = claim.key ?? claim.stepId;
      const taken: number[] = [];
      if (!shared) {
        taken.push(...free.splice(0, Math.min(free.length, wholeMachines(share))));
      } else {
        let best: number | undefined;
        for (let u = 0; u < total; u++) {
          const room = 1 - (used[u] ?? 0);
          if (keyOf[u] === key && room >= share - TINY && (best === undefined || room < 1 - (used[best] ?? 0))) best = u;
        }
        if (best !== undefined) {
          take(best, key, share);
          taken.push(best);
        } else {
          for (let left = share; loadLeft(left, taken.length, wholeSlack(share)) && free.length > 0;) {
            const u = free.shift() as number;
            take(u, key, Math.min(1, left));
            taken.push(u);
            left -= 1;
          }
        }
      }
      if (taken.length > 0) (entryOf(claim.stepId).others ??= []).push({ id, units: taken.sort((a, b) => a - b) });
    }
    const own = list.filter((c) => c.also !== true);
    const onlyOwnedFirst = (a: boolean, b: boolean): number => Number(b) - Number(a);
    if (!shared) {
      own.sort((a, b) => onlyOwnedFirst(a.ownedOnly === true, b.ownedOnly === true) || b.load - a.load || byString(a.stepId, b.stepId));
      for (const claim of own) {
        const needed = Math.max(1, wholeMachines(claim.load));
        const entry = entryOf(claim.stepId);
        entry.units = free.splice(0, Math.min(needed, free.length));
        entry.added = needed - entry.units.length;
      }
      continue;
    }
    const byKey = new Map<string, OwnedClaim[]>();
    for (const claim of own) {
      const key = claim.key ?? claim.stepId;
      const members = byKey.get(key);
      if (members === undefined) byKey.set(key, [claim]);
      else members.push(claim);
    }
    const sharingPools = [...byKey].map(([key, members]) => {
      members.sort((a, b) => byString(a.stepId, b.stepId));
      let load = 0;
      for (const m of members) load += Math.max(0, m.load);
      return { key, members, load, first: (members[0] as OwnedClaim).stepId, ownedOnly: members.some((m) => m.ownedOnly === true) };
    }).sort((a, b) => onlyOwnedFirst(a.ownedOnly, b.ownedOnly) || b.load - a.load || byString(a.first, b.first));
    for (const p of sharingPools) {
      let left = p.load;
      const slack = wholeSlack(p.load);
      const taken: number[] = [];
      for (let u = 0; u < total && loadLeft(left, taken.length, slack); u++) {
        const room = 1 - (used[u] ?? 0);
        if (keyOf[u] !== p.key || room <= TINY) continue;
        const t = Math.min(room, left);
        take(u, p.key, t);
        taken.push(u);
        left -= t;
      }
      while (loadLeft(left, taken.length, slack) && free.length > 0) {
        const u = free.shift() as number;
        const t = Math.min(1, left);
        take(u, p.key, t);
        taken.push(u);
        left -= t;
      }
      let added = Math.max(0, Math.ceil(left - slack));
      if (taken.length + added === 0) added = 1;
      const units = taken.sort((a, b) => a - b);
      for (const m of p.members) {
        const entry = entryOf(m.stepId);
        entry.units = [...units];
        entry.added = added;
        if (p.members.length >= 2) entry.pool = `pool:${p.first}`;
      }
    }
  }
  return out;
}

/** A step on a pseudo machine (by hand, the crafting table, the vanilla furnace): no owned machines, no build cost. */
function isPseudo(pick: MachinePick): boolean {
  return pick.handCraft || isPseudoMachineId(pick.id);
}

/**
 * A step's claims on owned machines (`assignOwned`): its own type, for the runs its owned machines of other options do
 * not take (`load = max(0, runs − Σ others ownedLoad × ρ) ÷ its own ρ`), with the solve's owned share, whether it can
 * only use owned machines and, with sharing, its pool (`poolKey` of its option and sharing key); and an `also` claim per
 * option of `StepMachines.others`, taking that option's owned share. None for a pseudo step.
 */
function ownedClaims(p: PickedRecipe, runsPerSecond: number, model: BuildModel | undefined): OwnedClaim[] {
  if (isPseudo(p.pick)) return [];
  const decided = p.decided;
  const others = decided?.others ?? [];
  let besides = 0;
  for (const o of others) besides += o.ownedLoad * o.option.perMachine;
  const load = Math.max(0, runsPerSecond - besides) / p.pick.runsPerSecondPerMachine;
  const claim: OwnedClaim = { stepId: p.id, id: p.pick.id, load };
  if (decided !== undefined) claim.share = Math.min(decided.ownedLoad, load);
  if (model?.ownedOnly(p.id) !== undefined) claim.ownedOnly = true;
  if (decided !== undefined && model?.share === true) claim.key = poolKey(decided.option, model.sharingKey(p.id));
  const claims = [claim];
  for (const o of others) {
    const also: OwnedClaim = { stepId: p.id, id: o.option.id, load: o.ownedLoad, share: o.ownedLoad, also: true };
    if (model !== undefined) also.key = poolKey(o.option, model.sharingKey(p.id));
    claims.push(also);
  }
  return claims;
}

/** Where the owned machines `units` of type `id` stand, those known, in unit order (copies). */
function unitPositions(pools: OwnedPools, id: MachineId, units: readonly number[]): MachineWhere[] {
  const pool = pools.get(id) ?? [];
  return units.flatMap((u) => {
    const at = pool[u];
    return at === undefined || at === null ? [] : [{ dim: at.dim, pos: [at.pos[0], at.pos[1], at.pos[2]] as [number, number, number] }];
  });
}

/** `PlanStep.reused` of a step on the owned machines `units` of type `id` (plan 12): how many, where those known stand, which. */
export function reusedOf(pools: OwnedPools, id: MachineId, units: readonly number[]): NonNullable<PlanStep['reused']> {
  return { count: units.length, where: unitPositions(pools, id, units), units: [...units] };
}

/** The option of `list` with the lowest build (an unpriced one last), then the lowest mteId. */
function cheapestBuild(list: readonly MachineOption[]): MachineOption | undefined {
  return [...list].sort((a, b) => (a.build ?? Infinity) - (b.build ?? Infinity) || compareMachineId(a.id, b.id))[0];
}

/**
 * `PlanStep.tiers` (plan 12): per distinct tier of the step's eligible options (`BuildModel.eligible`, before a pin, rule
 * 5, rule 7 and rule 8 narrow them), the option with the lowest build: the machines the step needs of it at its rate (at
 * least 1), the group's among them, the raw material to build the rest (null without a price) and why it cannot be built
 * here; with a `machineTier` pin, `pinned` on the tier the pin clamps to (the highest at or below it, else the lowest —
 * also when that tier cannot be built here, Amendment OQ5). Undefined for a step with no eligible options.
 */
function stepTiers(model: BuildModel, recipeId: string, runsPerSecond: number, pin: number | undefined): StepTier[] | undefined {
  const byTier = new Map<number, MachineOption[]>();
  for (const o of model.eligible(recipeId)) {
    const list = byTier.get(o.tier);
    if (list === undefined) byTier.set(o.tier, [o]);
    else list.push(o);
  }
  if (byTier.size === 0) return undefined;
  const tiers = [...byTier.keys()].sort((a, b) => a - b);
  const below = pin === undefined ? [] : tiers.filter((t) => t <= pin);
  const pinned = pin === undefined ? undefined : below.length > 0 ? Math.max(...below) : tiers[0];
  return tiers.map((tier): StepTier => {
    const o = cheapestBuild(byTier.get(tier) as MachineOption[]) as MachineOption;
    const machines = Math.max(1, wholeMachines(runsPerSecond / o.perMachine));
    const owned = Math.min(machines, o.owned);
    const entry: StepTier = { tier, mteId: legacyMteId(o.id), name: o.name, machines, owned, build: o.build === null ? null : sig9((machines - owned) * o.build) };
    if (o.unbuildable !== undefined) entry.unbuildable = o.unbuildable;
    if (tier === pinned) entry.pinned = true;
    return entry;
  });
}

/** Ruling P7 (controller Amendment OQ1): the step warning on a Project Red line for a step kept out of a shared machine. */
function ownOutputWarning(machineName: string): string {
  return `One ${machineName} needs AE2: Project Red cannot feed a machine its own output`;
}

/**
 * Ruling P7: on a Project Red line, which shares no machine (`sharesMachines`), the steps that run on the same machine
 * option (mteId, tier and hatch set) with the same sharing key as another step, so that an AE2 line would run both on
 * one machine, where one of the two takes an item the other makes (`feedsEither`): Project Red's extractor never routes
 * an item back to the machine it came from, so one machine for both needs AE2.
 */
function keptApart(pack: Pack, picked: readonly PickedRecipe[]): Set<string> {
  const apart = new Set<string>();
  // the pool each would join on AE2: option and sharing key (`poolKey`, which holds a recipe that may share with none)
  const decided = picked.flatMap((p) => (p.decided === undefined ? [] : [{ p, pool: poolKey(p.decided.option, sharingKey(p.recipe, p.lp.nonConsumed, pack)) }]));
  for (let i = 0; i < decided.length; i++) {
    const a = decided[i] as (typeof decided)[number];
    for (let j = i + 1; j < decided.length; j++) {
      const b = decided[j] as (typeof decided)[number];
      if (a.pool !== b.pool) continue;
      if (!feedsEither(a.p.recipe, b.p.recipe)) continue;
      apart.add(a.p.id);
      apart.add(b.p.id);
    }
  }
  return apart;
}

/**
 * One step per recipe the solution runs (convert recipes are not steps), sorted by id: the machine the build-cost solve
 * decided for it (`Solution.machines`, plan 12; else `pickStepMachines`' pick: pseudo steps and lines solved without a
 * build model), its overclocked speed, per-run inputs and outputs, and its warnings. Its machines come from `assignOwned`
 * over every step that is no pseudo step, from the final runs (`perSecondScale` turns runs into runs per second): the
 * owned ones of its type it runs on (`reused.units` in the owned pools — `opts.build`'s, else `ownedPools` — with where
 * they stand) and the new ones it adds (`count = added + owned`); the owned machines of its other options beside them
 * (`reused.others`); the other steps on any of those machines (`reused.sharedWith`); and its sharing pool (`pool`, with
 * the model's sharing, else on an AE2 rate line: `sharesMachines`). `utilization` counts the others' capacity too, and a pooled step's
 * is its own share of the pool. With a model, `tiers` lists the step's eligible tiers, and on a Project Red line a step
 * kept out of another's machine because one feeds the other says so (ruling P7).
 */
export function planSteps(
  pack: Pack, graph: CandidateGraph, sol: Solution,
  opts: {
    settings: PlanSettings; groupTier: number; coilHeat: number; ctx: PlanContext; perSecondScale: number; multiblocks?: ReadonlySet<MachineId>;
    /** What the line's goods are worth and the pack's empty containers, for each step's main output (`StepLine`). */
    value?: Pick<StepLine, 'valueOf' | 'empties'>;
    /** The line's build model (plan 12): its owned pools, sharing, steps that can only use owned machines and tiers. */
    build?: BuildModel;
  },
): PlanStep[] {
  const { settings, groupTier, coilHeat, ctx, perSecondScale, multiblocks, build: model } = opts;
  const pools: OwnedPools = model?.pools ?? ownedPools(ctx, settings);
  const owned: ReadonlyMap<MachineId, number> = new Map([...pools].map(([id, units]) => [id, units.length]));
  const line = stepLine(graph, sol.runs, opts.value);
  line.bought = boughtGoods(sol.buys);
  const picked = pickStepMachines(pack, graph, sol.runs, { settings, groupTier, coilHeat, owned, multiblocks, machines: sol.machines });
  const shared = model?.share ?? sharesMachines(settings);
  const assigned = assignOwned(picked.flatMap((p) => ownedClaims(p, p.runs * perSecondScale, model)), pools, shared);

  // Every owned machine (type, unit) and the steps on it, for `sharedWith`; every pool and its steps.
  const onUnit = new Map<string, Set<string>>();
  const unitsOf = new Map<string, string[]>();
  const poolSteps = new Map<string, string[]>();
  for (const p of picked) {
    const a = assigned.get(p.id);
    if (a === undefined) continue;
    const mine = [...a.units.map((u) => `${p.pick.id}:${u}`), ...(a.others ?? []).flatMap((o) => o.units.map((u) => `${o.id}:${u}`))];
    unitsOf.set(p.id, mine);
    for (const unit of mine) {
      const ids = onUnit.get(unit);
      if (ids === undefined) onUnit.set(unit, new Set([p.id]));
      else ids.add(p.id);
    }
    if (a.pool !== undefined) poolSteps.set(a.pool, [...(poolSteps.get(a.pool) ?? []), p.id]);
  }
  const apart = model !== undefined && settings.mode === 'rate' && settings.logistics === 'routed' ? keptApart(pack, picked) : new Set<string>();

  return picked.map((p) => {
    const runsPerSecond = p.runs * perSecondScale;
    const perMachine = p.pick.runsPerSecondPerMachine;
    const a = assigned.get(p.id);
    const warnings = machineWarnings(p.lp, p.pick, runsPerSecond);
    if (apart.has(p.id)) warnings.push(ownOutputWarning(p.pick.name));
    if (a === undefined) {
      const count = Math.max(1, wholeMachines(runsPerSecond / perMachine));
      return describeStep(pack, p, line, { count, owned: 0, runsPerSecond, utilization: runsPerSecond / (count * perMachine), warnings });
    }
    const count = a.added + a.units.length;
    // The owned machines of the step's other options, matched to the solve's `others` in its order: per type, its claims
    // in the order they were made (two options of one type, a multiblock at two hatch tiers, take one claim each).
    const left = new Map<MachineId, number[][]>();
    for (const o of a.others ?? []) left.set(o.id, [...(left.get(o.id) ?? []), o.units]);
    const others = (p.decided?.others ?? []).flatMap(({ option: o }) => {
      const units = left.get(o.id)?.shift() ?? [];
      return units.length === 0 ? [] : [{
        mteId: legacyMteId(o.id), name: o.name, tier: o.tier, count: units.length, units, where: unitPositions(pools, o.id, units),
        euPerTick: o.oc.euPerTick, runsPerSecondPerMachine: o.perMachine,
      }];
    });
    let capacity = count * perMachine;
    for (const o of others) capacity += o.count * o.runsPerSecondPerMachine;
    const size: StepSize = { count, owned: a.units.length, runsPerSecond, utilization: capacity > 0 ? runsPerSecond / capacity : 0, warnings };
    if (a.units.length > 0 || others.length > 0) {
      const reused = reusedOf(pools, p.pick.id, a.units);
      const peers = new Set<string>();
      for (const unit of unitsOf.get(p.id) ?? []) for (const id of onUnit.get(unit) ?? []) if (id !== p.id) peers.add(id);
      if (peers.size > 0) reused.sharedWith = [...peers].sort(byString);
      if (others.length > 0) reused.others = others;
      size.reused = reused;
    }
    const step = describeStep(pack, p, line, size);
    if (a.pool !== undefined) step.pool = { id: a.pool, steps: [...(poolSteps.get(a.pool) ?? [p.id])].sort(byString) };
    if (model !== undefined) {
      const pin = Object.hasOwn(settings.machineTier, p.id) ? settings.machineTier[p.id] : undefined;
      const tiers = stepTiers(model, p.id, runsPerSecond, pin);
      if (tiers !== undefined) step.tiers = tiers;
    }
    return step;
  });
}

/**
 * The duration the pick started from: a crafting table's fixed craft time, the furnace's own, the Auto Workbench's own
 * time per craft (a crafting recipe has none), else the recipe's.
 */
function baseDurationTicks(r: Recipe, mapId: string, pick: MachinePick): number {
  if (pick.kind === 'hand' || pick.kind === 'crafting') return CRAFT_TICKS;
  return pick.kind === 'furnace' || mapId === 'crafting' ? pick.oc.durationTicks : r.durationTicks;
}

/**
 * Item and fluid flows per unit of time. Per real good, each producer (`raw` for what the line buys, else the recipe)
 * is split across its consumers (recipes, `out` for the targets' demand, `sink` for what the line throws away) in
 * proportion to what each takes. Convert recipes are transparent: what one takes of an option goes on to the recipes
 * that consume its virtual good, in proportion to their use. A flow at most `FLOW_DROP_REL` of what its producer makes
 * of the good is dropped, and a target's `out` flow needs more than that share of what is made of it; values keep 9
 * significant digits and are sorted by `from`, `to`, `key`.
 */
export function buildFlows(graph: CandidateGraph, sol: Solution, targets: StuffKey[]): PlanFlow[] {
  const { made, used } = recipeAmounts(graph, sol.runs);
  for (const [key, amount] of sol.buys) addAmount(made, key, RAW, amount);
  for (const [key, amount] of sol.sinks) addAmount(used, key, SINK, amount);
  for (const target of new Set(targets)) {
    const total = sum(made.get(target));
    const out = total - sum(used.get(target));
    if (out > FLOW_DROP_REL * total) addAmount(used, target, OUT, out);
  }

  // Convert recipes are transparent: what one takes of an option goes on to the users of its virtual good.
  for (const r of graph.recipes) {
    const ends = r.kind === 'convert' ? convertEnds(r) : null;
    const takers = ends === null ? undefined : used.get(ends.option);
    const taken = takers?.get(r.id);
    if (ends === null || takers === undefined || taken === undefined) continue;
    takers.delete(r.id);
    const users = used.get(ends.virtual);
    const total = sum(users);
    if (total <= 0) continue;
    for (const [to, amount] of users ?? []) addAmount(used, ends.option, to, (taken * amount) / total);
  }

  const flows: PlanFlow[] = [];
  for (const [key, producers] of made) {
    if (graph.goods.get(key)?.virtual === true) continue;
    const consumers = used.get(key);
    const total = sum(consumers);
    if (consumers === undefined || total <= 0) continue;
    for (const [from, produced] of producers) {
      for (const [to, amount] of consumers) {
        const perSecond = (produced * amount) / total;
        if (perSecond > FLOW_DROP_REL * produced) flows.push({ from, to, key, perSecond: sig9(perSecond) });
      }
    }
  }
  return flows.sort((a, b) => byString(a.from, b.from) || byString(a.to, b.to) || byString(a.key, b.key));
}
