// The build list (spec §3.10 "to build the line (once)", architecture §11.13 and §11.15): the machines, multiblock
// structures, cleanroom and one-off items a line needs, each broken down along its cheapest accepted recipe to base
// materials, plus those base materials summed, each saying which lines need it. `expandBomLines` gives Plan 5's layout
// parts the same breakdown.

import { PSEUDO_IDS } from '../../shared/gt/tiers.ts';
import { isFluidKey, parseItemKey, type StuffKey } from '../../shared/keys.ts';
import { machineGroups } from '../../shared/plan/pools.ts';
import type { Machine, Pack } from '../../shared/types/pack.ts';
import { FREE_KEYS, type BomLine, type BomMade, type PlanContext, type PlanSettings, type PlanStep, type PlanWarning } from '../../shared/types/plan.ts';
import { PROGRAMMED_CIRCUIT_ID } from '../pack/recipes.ts';
import { structureParts } from './build-cost.ts';
import { buildCandidates, heldOption, keptOptions, type HeldAvoid, type LeafOracle, type LpRecipe, type PlanEnv } from './candidates.ts';
import { makePrices } from './costs.ts';
import { madePerRun, makersOf, ownedForParts, partMachine, settleRecipes, unmadeCause } from './howto.ts';
import { yieldToEventLoop } from './lp.ts';
import { ownedPools, recipeCircuit } from './owned.ts';
import { lineLeaf } from './pricing.ts';

export interface Bom {
  lines: BomLine[] /* top level, with children */; totals: BomLine[] /* leaves summed, sorted by key */; warnings: PlanWarning[];
  // optional addition
  /** The swap list of every good the lines make (architecture §11 entry 41 (3)), by key. */
  alternatives?: Map<StuffKey, PlanStep['alternatives']>;
}

type Group = NonNullable<BomLine['group']>;

/** The order the "to build" list is shown in (architecture §11.13). */
const GROUP_ORDER: readonly Group[] = ['machines', 'power', 'logistics', 'one-off'];
/** A breakdown stops this many levels below its top-level line. */
const MAX_DEPTH = 12;
/** Amounts up to this count as zero, and a run count this little above a whole number stays whole. */
const TINY = 1e-9;
/** Ruling R8 (architecture §11.19): the cleanroom is the machine with this simple class name. */
const CLEANROOM_CLASS = 'MTECleanroom';
const FREE: ReadonlySet<StuffKey> = new Set(FREE_KEYS);

function byString(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0;
}

/** 9 decimal places; −0 reads 0. */
function round9(x: number): number {
  return Math.round(x * 1e9) / 1e9 || 0;
}

function round6(x: number): number {
  return Math.round(x * 1e6) / 1e6 || 0;
}

/** The pack's cleanroom (the lowest mteId when there are several), if it has one. */
export function cleanroomMachine(pack: Pack): Machine | undefined {
  let room: Machine | undefined;
  for (const m of pack.machines.values()) {
    const simpleName = m.cls.slice(m.cls.lastIndexOf('.') + 1);
    if (simpleName === CLEANROOM_CLASS && (room === undefined || m.mteId < room.mteId)) room = m;
  }
  return room;
}

/**
 * The not-consumed inputs of a step's recipe (what each slot holds, `heldOption`: for a line that avoids `avoid`, an
 * option it may use), per machine: the parts that stay in the machine. A hand-crafting step has none (Task 13 ruling):
 * its not-consumed inputs are tools in the crafter's hands.
 */
export function stepOneOffs(pack: Pack, step: PlanStep, avoid?: HeldAvoid): Array<{ key: StuffKey; amount: number }> {
  if (step.handCraft) return [];
  return (pack.recipeById.get(step.recipeId)?.inputs ?? []).flatMap((ing) => {
    const held = ing.consumed ? undefined : heldOption(ing.options, avoid);
    return held !== undefined ? [{ key: held.key, amount: held.amount }] : [];
  });
}

/**
 * The tools of a hand-crafting step (Task 13 ruling): the not-consumed inputs of its recipe (what each slot holds,
 * `heldOption`, as the loader marks only crafting-table tool slots so), deduped, in slot order; none for any other step.
 */
export function stepTools(pack: Pack, step: PlanStep, avoid?: HeldAvoid): StuffKey[] {
  if (!step.handCraft) return [];
  const inputs = [...(pack.recipeById.get(step.recipeId)?.inputs ?? [])].sort((a, b) => a.slot - b.slot);
  return [...new Set(inputs.flatMap((ing) => {
    const held = ing.consumed ? undefined : heldOption(ing.options, avoid);
    return held !== undefined ? [held.key] : [];
  }))];
}

/** The English name of what a step makes: its main output, else its first output, else its recipe id. */
export function stepProductName(pack: Pack, step: PlanStep): string {
  return pack.nameOf(step.mainOutput ?? step.outputs[0]?.key ?? step.recipeId);
}

const MACHINE_ITEMS = new WeakMap<Pack, ReadonlyMap<StuffKey, Machine>>();

/** Each machine's item → the machine (the lowest mteId when several share an item), once per pack. */
function machineItems(pack: Pack): ReadonlyMap<StuffKey, Machine> {
  let byItem = MACHINE_ITEMS.get(pack);
  if (byItem === undefined) {
    const map = new Map<StuffKey, Machine>();
    for (const m of [...pack.machines.values()].sort((a, b) => a.mteId - b.mteId)) if (!map.has(m.itemKey)) map.set(m.itemKey, m);
    byItem = map;
    MACHINE_ITEMS.set(pack, byItem);
  }
  return byItem;
}

/**
 * A build part's name (architecture §11 entry 41 (8)): the item's or fluid's name when the pack has one other than its key;
 * else, for some machine's item, the machine's name; else, for a plain item key at a meta above 0 whose `<id>@0` has a
 * name, `<that name> (variant <meta>)`; else `<id>` at meta 0 and `<id> (meta <meta>)` above it. A key that is no plain
 * item key (a fluid, an NBT variant) keeps `pack.nameOf`.
 */
export function partName(pack: Pack, key: StuffKey): string {
  const named = pack.nameOf(key);
  if (named !== key || isFluidKey(key) || key.includes('#') || !/@\d+$/.test(key)) return named;
  const machine = machineItems(pack).get(key);
  if (machine !== undefined) return machine.name;
  const { id, meta } = parseItemKey(key);
  if (meta === 0) return id;
  const base = pack.nameOf(`${id}@0`);
  return base !== `${id}@0` ? `${base} (variant ${meta})` : `${id} (meta ${meta})`;
}

type AlternativeInput = NonNullable<PlanStep['alternatives'][number]['inputs']>[number];

/** Items before fluids, each largest amount first, then by key: the order a swap-list row lists goods in. */
function byPartOrder(a: { key: StuffKey; amount: number }, b: { key: StuffKey; amount: number }): number {
  return Number(isFluidKey(a.key)) - Number(isFluidKey(b.key)) || b.amount - a.amount || byString(a.key, b.key);
}

/**
 * What one run of a recipe takes and makes, as its swap-list row shows it (controller rulings, plan 09): every consumed
 * slot the line may take (`keptOptions`), a slot of one option summed with the others of that good, a slot of several
 * as one entry that lists them all in its `options` (its key and amount are the first); and every output, summed per
 * key. Items before fluids, each largest first (`byPartOrder`).
 */
export function recipeParts(
  pack: Pack, recipeId: string, avoid: ReadonlySet<StuffKey>,
): { inputs: AlternativeInput[]; outputs: Array<{ key: StuffKey; amount: number }> } {
  const r = pack.recipeById.get(recipeId);
  if (r === undefined) return { inputs: [], outputs: [] };
  const summed = (entries: ReadonlyArray<[StuffKey, number]>): Array<{ key: StuffKey; amount: number }> => {
    const totals = new Map<StuffKey, number>();
    for (const [key, amount] of entries) totals.set(key, (totals.get(key) ?? 0) + amount);
    return [...totals].map(([key, amount]) => ({ key, amount: round6(amount) }));
  };
  const single: Array<[StuffKey, number]> = [];
  const several: AlternativeInput[] = [];
  for (const ing of r.inputs) {
    const options = ing.consumed ? keptOptions(ing.options, avoid) : [];
    const first = options[0];
    if (first === undefined) continue;
    if (options.length === 1) single.push([first.key, first.amount]);
    else several.push({ key: first.key, amount: round6(first.amount), options: options.map((o) => ({ key: o.key, amount: round6(o.amount) })) });
  }
  return {
    inputs: [...summed(single), ...several].sort(byPartOrder),
    outputs: summed(r.outputs.map((p): [StuffKey, number] => [p.key, p.amount])).sort(byPartOrder),
  };
}

/**
 * The build list of a line's steps: per step its new machines (`count − owned`; pseudo machines skipped) and, for a
 * multiblock, the blocks of their structures (`structureParts`: each structure hatch at the lowest tier of its class);
 * the not-consumed inputs of every machine step's recipe for all `count` machines (owned ones need them too); each
 * hand-crafting tool once, however many steps use it (Task 13 ruling); one cleanroom when any step needs one and the
 * group owns none (`ownedPools`: the world scan's and the "Machines we have" list's, plan 12). The steps of a sharing pool
 * run on the same machines (plan 12, `PlanStep.pool`, through `machineGroups`, ruling P18): its first step
 * (`pool.steps[0]`) adds the pool's new machines, their structure and the items they hold, and its other steps none. In
 * Make N the steps of one machine type share its machines (make-n.ts), so only the first step of a type adds machines.
 * So the list holds exactly the machines the plan adds: owned machines, a pool's shared ones and the owned machines of
 * other tiers a step runs on beside its own (`reused.others`) are left out. Lines with the same key and group are
 * merged, sorted by group then key, and broken down to base materials. The warnings are `no-cleanroom` and the
 * breakdown's own `graph-too-big`. With `avoid` (what the line avoids) each not-consumed slot holds an option the line
 * may use (`heldOption`); the breakdown itself avoids nothing (ruling R6).
 */
export async function buildBom(
  pack: Pack, steps: PlanStep[],
  opts: { settings: PlanSettings; env: PlanEnv; leaf: LeafOracle; ctx: PlanContext; avoid?: HeldAvoid },
): Promise<Bom> {
  const drafts = new Map<string, { key: StuffKey; amount: number; whys: string[]; group: Group }>();
  const add = (key: StuffKey, amount: number, why: string, group: Group): void => {
    const id = `${group}\u0000${key}`;
    const draft = drafts.get(id);
    if (draft === undefined) drafts.set(id, { key, amount, whys: [why], group });
    else {
      draft.amount += amount;
      draft.whys.push(why);
    }
  };

  const makeN = opts.settings.mode === 'makeN';
  const typesSeen = new Set<number>();
  // a sharing pool's machines once, by its first step (`machineGroups`): its steps' `count`, `owned` and held items are
  // the pool's
  for (const group of machineGroups(steps)) {
    const step = group[0]!;
    const mteId = step.machine.mteId;
    const machine = PSEUDO_IDS.has(mteId) ? undefined : pack.machines.get(mteId);
    if (machine !== undefined && !(makeN && typesSeen.has(mteId))) {
      typesSeen.add(mteId);
      const n = step.count - step.owned;
      if (n > 0) {
        add(machine.itemKey, n, `${n}× ${step.machine.name}`, 'machines');
        for (const [key, cells] of structureParts(pack, machine)) add(key, cells * n, `structure of ${n}× ${step.machine.name}`, 'machines');
      }
    }
    for (const { key, amount } of stepOneOffs(pack, step, opts.avoid)) {
      const n = amount * step.count;
      if (n > 0) add(key, n, `${n}× ${pack.nameOf(key)} (stays in the machine)`, 'one-off');
    }
  }
  const toolUses = new Map<StuffKey, Set<string>>();   // tool → the names of what it hand-crafts, in step order
  for (const step of steps) {
    for (const key of stepTools(pack, step, opts.avoid)) {
      const products = toolUses.get(key) ?? new Set<string>();
      products.add(stepProductName(pack, step));
      toolUses.set(key, products);
    }
  }
  for (const [key, products] of toolUses) {
    add(key, 1, `1× ${pack.nameOf(key)} (tool for hand-crafting ${[...products].join(', ')})`, 'one-off');
  }

  const warnings: PlanWarning[] = [];
  const clean = steps.filter((s) => s.needsCleanroom === true);
  if (clean.length > 0) {
    const products = [...new Set(clean.map((s) => stepProductName(pack, s)))].join(', ');
    const room = cleanroomMachine(pack);
    // the group's own cleanroom needs no building (plan 12 Task 6)
    const owned = room !== undefined && (ownedPools(opts.ctx, opts.settings).get(room.mteId)?.length ?? 0) > 0;
    if (room === undefined) warnings.push({ code: 'no-cleanroom', text: `Making ${products} needs a cleanroom, but this pack has no cleanroom machine` });
    else if (!owned) add(room.itemKey, 1, `cleanroom for ${products}`, 'machines');
  }

  const lines: BomLine[] = [...drafts.values()]
    .map((d) => ({ key: d.key, amount: round9(d.amount), why: d.whys.join('; '), group: d.group }))
    .sort((a, b) => GROUP_ORDER.indexOf(a.group) - GROUP_ORDER.indexOf(b.group) || byString(a.key, b.key));
  const expanded = await expandWith(pack, lines, { ...opts, steps });
  return { lines: expanded.lines, totals: expanded.totals, warnings: [...warnings, ...expanded.warnings], alternatives: expanded.alternatives };
}

/**
 * Breaks lines that do not come from plan steps (Plan 5's layout parts) down to base materials exactly as `buildBom`
 * does for the line's plan: in its environment and at its prices (`lineLeaf`: stop items at their cost-model price,
 * derived leaves at their own chain's cost; the plain prices of `planBasis` when the settings name no target the export
 * knows), so the same lines break down the same way in both. One output line per input line, in input order. The return
 * shape is architecture §11.15's, so the breakdown's warnings are not passed on here. With `opts.steps` the machine pass
 * knows the line's machines and the owned ones as `buildBom` does; without them, no line machines and only the
 * context's owned ones.
 */
export async function expandBomLines(
  pack: Pack, lines: BomLine[], settings: PlanSettings, ctx: PlanContext, opts?: { steps?: readonly PlanStep[] },
): Promise<{ lines: BomLine[]; totals: BomLine[] }> {
  const { env, leaf } = await lineLeaf(pack, settings, ctx);
  const expanded = await expandWith(pack, lines, { settings, env, leaf, ctx, ...(opts?.steps === undefined ? {} : { steps: opts.steps }) });
  return { lines: expanded.lines, totals: expanded.totals };
}

interface Expansion {
  settings: PlanSettings; env: PlanEnv; leaf: LeafOracle; ctx: PlanContext;
  /** `buildBom`'s steps: the line's machines and the owned ones behind them (the machine pass, `madeParts`). */
  steps?: readonly PlanStep[];
}

/** The breakdown's recipe book (architecture §11 entry 41 (1)): every good's settled recipe and every slot's settled option. */
interface RecipeBook {
  /** The recipe `key` settled by, and how much one run makes; undefined for a leaf and for a good that never settled. */
  chosen(key: StuffKey): { lp: LpRecipe; perRun: number } | undefined;
  /** Every recipe of the book that makes `key` and whose consumed goods all settled, at its gross cost per unit, cheapest first, then by id. */
  producersOf(key: StuffKey): Array<{ lp: LpRecipe; perRun: number; cost: number }>;
  /** The consumed inputs of one run, each ore-dictionary slot at its settled option, summed per key and sorted. */
  inputsOf(lp: LpRecipe): Array<[StuffKey, number]>;
  /** Why a good the breakdown needs never settled (`unmadeCause`). */
  unmade(key: StuffKey): 'no-recipe' | 'own-chain';
  /**
   * `BOM_TOO_BIG` when the graph stopped growing at its recipe cap: the goods it never expanded have no producers, so
   * they read as unmade. The graph's other warnings are not passed on: `planLine` reports its own graph's.
   */
  warnings: PlanWarning[];
}

const NO_RECIPES: RecipeBook = { chosen: () => undefined, producersOf: () => [], inputsOf: () => [], unmade: () => 'no-recipe', warnings: [] };
/** The build list's wording of candidates.ts's `graph-too-big`. */
const BOM_TOO_BIG: Readonly<PlanWarning> = {
  code: 'graph-too-big', text: 'The build list is too large to break down fully; mark some parts as "we already make this"',
};

async function recipeBook(pack: Pack, x: Expansion, targets: StuffKey[], isLeaf: (key: StuffKey) => boolean): Promise<RecipeBook> {
  await yieldToEventLoop();
  // Pins act through the settle only: the book holds a pinned good's other producers beside its pin (`pinnedBeside`).
  const graph = buildCandidates(pack, x.settings, x.env, x.leaf, targets, { pinnedBeside: true });
  const filled = new Set((pack.fluidContainers ?? []).map((c) => c.container));
  const empties = new Set((pack.fluidContainers ?? []).flatMap((c) => (c.empty === null ? [] : [c.empty])));
  const settled = settleRecipes(graph, {
    leafCost: (key) => {
      if (!isLeaf(key)) return null;
      const d = x.leaf(key);
      return d.buyable ? d.cost : Infinity;   // a base material out of reach settles after every other good
    },
    // An exact cost tie goes to the offer that burns less free input (architecture §11 entry 41 (1)): gases made from
    // free Air cost 0, so the 2.9 export's Aluminium Ingot tied its plain EBF recipe with its gas variants.
    free: (key) => (x.leaf(key).leafClass === 'free' ? 1 : 0),
    pins: x.settings.recipeChoice,
    // An empty container is made from its own parts, never by emptying or reacting a filled one (or itself): credit for
    // the outputs the breakdown throws away made 3 Empty Cells beside 5,000 L of glue the "cheapest" Empty Cell (fix spec
    // D15, audit patch G-bom-containers).
    offers: (lp, key) => !empties.has(key) || !lp.coeffs.some(([input, c]) => c < 0 && (filled.has(input) || input === key)),
  });
  const resolved = new Map<string, Array<[StuffKey, number]>>();
  const inputsOf = (lp: LpRecipe): Array<[StuffKey, number]> => {
    let inputs = resolved.get(lp.id);
    if (inputs === undefined) {
      const amounts = new Map<StuffKey, number>();
      for (const [key, c] of lp.coeffs) {
        if (c >= 0) continue;
        const option = graph.goods.get(key)?.virtual === true ? settled.option.get(key) : { key, amount: 1 };
        if (option !== undefined) amounts.set(option.key, (amounts.get(option.key) ?? 0) - c * option.amount);
      }
      inputs = [...amounts].sort(([a], [b]) => byString(a, b));
      resolved.set(lp.id, inputs);
    }
    return inputs;
  };
  return {
    warnings: graph.warnings.some((w) => w.code === 'graph-too-big') ? [{ ...BOM_TOO_BIG }] : [],
    chosen: (key) => settled.recipe.get(key),
    producersOf: (key) => (makersOf(graph).get(key) ?? [])
      .filter((lp) => lp.kind === 'recipe' && lp.coeffs.every(([k, c]) => c >= 0 || settled.cost.has(k)))
      .map((lp) => {
        const perRun = madePerRun(lp, key);
        let total = 0;
        for (const [k, c] of lp.coeffs) if (c < 0) total -= c * (settled.cost.get(k) as number);
        return { lp, perRun, cost: total / perRun };
      })
      .sort((a, b) => a.cost - b.cost || byString(a.lp.id, b.lp.id)),
    inputsOf,
    unmade: (key) => unmadeCause(graph, settled, key),
  };
}

/**
 * The breakdown's leaf oracle: the line's, except that every free input (`FREE_KEYS`) is a leaf at its price (fix spec
 * R2): a running line makes its own with a generator (`PlanBasis.supplied`), but the one-off materials of its machines
 * get none. And a leaf the line may also make (`LeafDecision.alsoMade`, plan 12: a gathered world block) is a plain one
 * here: one-off build materials are dug, so the breakdown never walks a gathered block's producers, nor prices it at
 * what free cobblestone and hammers would make it for.
 */
function freeLeaves(pack: Pack, x: Expansion): LeafOracle {
  const prices = makePrices(pack, x.settings.costOverrides);
  return (key) => {
    const d = x.leaf(key);
    if (d.buyable) {
      if (d.alsoMade !== true) return d;
      const { alsoMade: _made, ...dug } = d;
      return dug;
    }
    return FREE.has(key) ? { buyable: true, cost: prices.price(key), leafClass: 'free' } : d;
  };
}

/** A copy of what storage holds of `key` (§11.20, ruling R9): `total` and `reachable`, plus `where` when known. */
function haveOf(ctx: PlanContext, key: StuffKey): BomLine['have'] {
  const stock = ctx.storage.get(key);
  if (stock === undefined) return undefined;
  const have: NonNullable<BomLine['have']> = { total: stock.total, reachable: stock.reachable };
  if (stock.where !== undefined) have.where = [...stock.where];
  return have;
}

/** How the breakdown makes a good: its recipe here, or why it stays unmade; undefined for a leaf. */
type How = { lp: LpRecipe; perRun: number } | 'no-recipe' | 'own-chain' | undefined;

/**
 * The machine pass (architecture §11 entry 41 (1)) over the book's choices: the machines the group has for a one-off job
 * (`ownedForParts`), the types the line builds (`x.steps` with new machines), and per good the line types whose own build
 * reaches it (from a top-level line of the type's item or structure parts), which `partMachine` then sets aside. `how`
 * gives a good's recipe, `no-recipe` when no machine runs its recipe here, or its unmade cause; `madeOf` a node's `BomMade`;
 * `alternatives` the swap list of every good the lines make.
 */
function madeParts(pack: Pack, lines: readonly BomLine[], x: Expansion, book: RecipeBook, isLeaf: (key: StuffKey) => boolean): {
  how(key: StuffKey): How; madeOf(key: StuffKey, lp: LpRecipe, runs: number): BomMade; alternatives(): Map<StuffKey, PlanStep['alternatives']>;
} {
  const steps = x.steps ?? [];
  const owned = ownedForParts(x.ctx, x.settings, steps);
  const line = new Set(steps.filter((s) => s.count > s.owned && !PSEUDO_IDS.has(s.machine.mteId)).map((s) => s.machine.mteId));
  const reach = (start: StuffKey): Set<StuffKey> => {
    const seen = new Set<StuffKey>();
    const stack = [start];
    while (stack.length > 0) {
      const key = stack.pop() as StuffKey;
      if (seen.has(key)) continue;
      seen.add(key);
      const c = book.chosen(key);
      if (c !== undefined) for (const [input] of book.inputsOf(c.lp)) stack.push(input);
    }
    return seen;
  };
  const exclude = new Map<StuffKey, Set<number>>();
  for (const mteId of [...line].sort((a, b) => a - b)) {
    const m = pack.machines.get(mteId);
    if (m === undefined) continue;
    const own = new Set([m.itemKey, ...structureParts(pack, m).keys()]);
    for (const top of lines) {
      if (!own.has(top.key)) continue;
      for (const key of reach(top.key)) {
        const set = exclude.get(key) ?? new Set<number>();
        set.add(mteId);
        exclude.set(key, set);
      }
    }
  }
  const machines = new Map<StuffKey, BomMade['machine'] | null>();
  const machineOf = (key: StuffKey, lp: LpRecipe): BomMade['machine'] | null => {
    if (!machines.has(key)) {
      const r = pack.recipeById.get(lp.id);
      machines.set(key, r === undefined || lp.mapId === null ? null : partMachine(pack, r, lp.mapId, {
        groupTier: x.env.tier, owned, line, exclude: exclude.get(key) ?? new Set(), ...(x.env.multiblocks === undefined ? {} : { multiblocks: x.env.multiblocks }),
      }));
    }
    return machines.get(key) as BomMade['machine'] | null;
  };
  const how = (key: StuffKey): How => {
    if (isLeaf(key)) return undefined;
    const c = book.chosen(key);
    if (c === undefined) return book.unmade(key);
    return machineOf(key, c.lp) === null ? 'no-recipe' : c;
  };
  const madeOf = (key: StuffKey, lp: LpRecipe, runs: number): BomMade => {
    const r = pack.recipeById.get(lp.id);
    const made: BomMade = { recipeId: lp.id, mapId: lp.mapId as string, machine: machineOf(key, lp) as BomMade['machine'], runs };
    const circuit = r === undefined ? undefined : recipeCircuit(r);
    if (circuit !== undefined) made.circuit = circuit;
    const held = (r?.inputs ?? []).flatMap((ing) => {
      const option = ing.consumed ? undefined : heldOption(ing.options);
      if (option === undefined) return [];
      if (circuit !== undefined && !isFluidKey(option.key) && parseItemKey(option.key).id === PROGRAMMED_CIRCUIT_ID) return [];
      return [option.key];
    });
    if (held.length > 0) made.nonConsumed = held;
    if (lp.needsCleanroom) made.cleanroom = true;
    return made;
  };
  const alternatives = (): Map<StuffKey, PlanStep['alternatives']> => {
    const out = new Map<StuffKey, PlanStep['alternatives']>();
    // The goods the lines make, through the recipes they are made by (not through a good no machine here makes).
    const made = new Set<StuffKey>();
    const stack = lines.map((l) => l.key);
    while (stack.length > 0) {
      const key = stack.pop() as StuffKey;
      const h = how(key);
      if (made.has(key) || typeof h !== 'object') continue;
      made.add(key);
      for (const [input] of book.inputsOf(h.lp)) stack.push(input);
    }
    for (const key of [...made].sort(byString)) {
      const list = book.producersOf(key);
      if (list.length > 0) out.set(key, list.map((p) => ({ recipeId: p.lp.id, rawCost: round6(p.cost), mapId: p.lp.mapId as string, ...recipeParts(pack, p.lp.id, new Set()) })));
    }
    return out;
  };
  return { how, madeOf, alternatives };
}

/**
 * The breakdown `buildBom` and `expandBomLines` share, so the two can never differ (architecture §11 entry 41 (1)–(3)).
 * Each line keeps its key, amount, why and group and gets what storage holds of it. A good is a leaf when it is a free
 * input (`freeLeaves`: always, even where the line itself plans its generator), when the line can buy it, or when it is a
 * base material out of reach (the material itself is what the group must unlock, as solve.ts names it). Every other good
 * is made one way across the whole list, by the recipe the book settled for it (`settleRecipes`: cheapest first from the
 * leaves, at gross cost, a pinned good by its pin while that settles it), on the machine `madeParts` picks — or it is
 * `unmade`, by cause. A made node has `made` and `ceil(amount / made per run)` runs, whose consumed inputs × runs are its
 * children (sorted by key, ruling R7); the tree stops at `MAX_DEPTH`, where a node keeps its `made` and has no children.
 * `totals` sums the leaves and unmade nodes per key, sorted by key, each with the top-level lines that need it
 * (`neededFor`, fix spec D15: by key, in the order of the lines) and the why "for <their names>", each name once (ruling
 * P18); `alternatives` the swap list of every made good. `warnings` holds the graph's `graph-too-big`, in the build list's
 * words, when the graph hit its recipe cap.
 */
async function expandWith(
  pack: Pack, lines: readonly BomLine[], expansion: Expansion,
): Promise<{ lines: BomLine[]; totals: BomLine[]; warnings: PlanWarning[]; alternatives: Map<StuffKey, PlanStep['alternatives']> }> {
  const x: Expansion = { ...expansion, leaf: freeLeaves(pack, expansion) };
  const leafKeys = new Map<StuffKey, boolean>();
  const isLeaf = (key: StuffKey): boolean => {
    let leaf = leafKeys.get(key);
    if (leaf === undefined) {
      const d = x.leaf(key);
      leaf = d.buyable || d.leafClass === 'unavailable';
      leafKeys.set(key, leaf);
    }
    return leaf;
  };
  const targets = [...new Set(lines.map((l) => l.key))].filter((key) => !isLeaf(key));
  const book = targets.length > 0 ? await recipeBook(pack, x, targets, isLeaf) : NO_RECIPES;
  const parts = madeParts(pack, lines, x, book, isLeaf);
  const totals = new Map<StuffKey, number>();
  /** Per total, what each top-level line (by key, first need first) needs of it. */
  const neededBy = new Map<StuffKey, Map<StuffKey, number>>();
  const node = (line: BomLine, depth: number, top: StuffKey): BomLine => {
    const out: BomLine = { key: line.key, amount: line.amount, why: line.why };
    if (line.group !== undefined) out.group = line.group;
    const have = haveOf(x.ctx, line.key);
    if (have !== undefined) out.have = have;
    if (line.amount <= TINY) return out;   // nothing to make, nothing to gather
    const how = parts.how(line.key);
    if (typeof how !== 'object') {
      if (how !== undefined) out.unmade = how;
      totals.set(line.key, (totals.get(line.key) ?? 0) + line.amount);
      const byTop = neededBy.get(line.key) ?? new Map<StuffKey, number>();
      byTop.set(top, (byTop.get(top) ?? 0) + line.amount);
      neededBy.set(line.key, byTop);
      return out;
    }
    const runs = Math.ceil(line.amount / how.perRun - TINY);
    out.made = parts.madeOf(line.key, how.lp, runs);
    if (depth >= MAX_DEPTH) return out;   // the tree stops here; the choices below it still stand
    const why = `for ${pack.nameOf(line.key)}`;
    const children = book.inputsOf(how.lp).map(([input, perRun]) => node({ key: input, amount: round9(perRun * runs), why }, depth + 1, top));
    if (children.length > 0) out.children = children;
    return out;
  };
  const expanded = lines.map((line) => node(line, 0, line.key));
  return {
    warnings: book.warnings,
    lines: expanded,
    totals: [...totals].sort(([a], [b]) => byString(a, b)).map(([key, amount]) => {
      const neededFor = [...(neededBy.get(key) ?? [])].map(([top, n]) => ({ key: top, amount: round9(n) }));
      // Each name once: the programmed circuits of several configurations are all "Programmed Circuit".
      const names = [...new Set(neededFor.map((n) => pack.nameOf(n.key)))];
      const total: BomLine = { key, amount: round9(amount), why: `for ${names.join(', ')}`, neededFor };
      const how = parts.how(key);
      if (typeof how === 'string') total.unmade = how;
      const have = haveOf(x.ctx, key);
      if (have !== undefined) total.have = have;
      return total;
    }),
    alternatives: parts.alternatives(),
  };
}
