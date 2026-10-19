// The build list (spec §3.10 "to build the line (once)", architecture §11.13 and §11.15): the machines, multiblock
// structures, cleanroom and one-off items a line needs, each broken down along its cheapest accepted recipe to base
// materials, plus those base materials summed, each saying which lines need it. `expandBomLines` gives Plan 5's layout
// parts the same breakdown.

import { PSEUDO_MACHINES } from '../../shared/gt/tiers.ts';
import { itemKey, type StuffKey } from '../../shared/keys.ts';
import type { Machine, Pack } from '../../shared/types/pack.ts';
import { FREE_KEYS, type BomLine, type PlanContext, type PlanSettings, type PlanStep, type PlanWarning } from '../../shared/types/plan.ts';
import { buildCandidates, heldOption, type HeldAvoid, type LeafOracle, type LpRecipe, type PlanEnv } from './candidates.ts';
import { analyzeCosts, makePrices, type CostAnalysis } from './costs.ts';
import { yieldToEventLoop } from './lp.ts';
import { lineLeaf } from './pricing.ts';

export interface Bom { lines: BomLine[] /* top level, with children */; totals: BomLine[] /* leaves summed, sorted by key */; warnings: PlanWarning[] }

type Group = NonNullable<BomLine['group']>;

/** The order the "to build" list is shown in (architecture §11.13). */
const GROUP_ORDER: readonly Group[] = ['machines', 'power', 'logistics', 'one-off'];
/** A breakdown stops this many levels below its top-level line. */
const MAX_DEPTH = 12;
/** Amounts up to this count as zero, and a run count this little above a whole number stays whole. */
const TINY = 1e-9;
/** Ruling R8 (architecture §11.19): the cleanroom is the machine with this simple class name. */
const CLEANROOM_CLASS = 'MTECleanroom';
const PSEUDO_IDS: ReadonlySet<number> = new Set(Object.values(PSEUDO_MACHINES));
const FREE: ReadonlySet<StuffKey> = new Set(FREE_KEYS);

function byString(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0;
}

/** 9 decimal places; −0 reads 0. */
function round9(x: number): number {
  return Math.round(x * 1e9) / 1e9 || 0;
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

/** The blocks of a multiblock's exported structure per item, without the controller cell (the machine line itself). */
function structureParts(pack: Pack, m: Machine): Map<StuffKey, number> {
  const parts = new Map<StuffKey, number>();
  const s = m.structure;
  if (m.kind !== 'multiblock' || s === undefined) return parts;
  const [cx, cy, cz] = s.controller;
  for (const { pos, block } of s.blocks) {
    if ((pos[0] === cx && pos[1] === cy && pos[2] === cz) || block.mteId === m.mteId) continue;
    const hatch = block.mteId === undefined ? undefined : pack.machines.get(block.mteId);
    const key = hatch?.itemKey ?? itemKey(block.id, block.meta);
    parts.set(key, (parts.get(key) ?? 0) + 1);
  }
  return parts;
}

/**
 * The build list of a line's steps: per step its new machines (`count − owned`; pseudo machines skipped) and, for a
 * multiblock, the blocks of their structures; the not-consumed inputs of every machine step's recipe for all `count`
 * machines (owned ones need them too); each hand-crafting tool once, however many steps use it (Task 13 ruling); one
 * cleanroom when any step needs one. In Make N the steps of one machine type share its machines (make-n.ts), so only
 * the first step of a type adds machines. Lines with the same key and group are merged, sorted by group then key, and
 * broken down to base materials. The warnings are `no-cleanroom` and the breakdown's own `graph-too-big`. With `avoid`
 * (what the line avoids) each not-consumed slot holds an option the line may use (`heldOption`); the breakdown itself
 * avoids nothing (ruling R6).
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
  for (const step of steps) {
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
    if (room !== undefined) add(room.itemKey, 1, `cleanroom for ${products}`, 'machines');
    else warnings.push({ code: 'no-cleanroom', text: `Making ${products} needs a cleanroom, but this pack has no cleanroom machine` });
  }

  const lines: BomLine[] = [...drafts.values()]
    .map((d) => ({ key: d.key, amount: round9(d.amount), why: d.whys.join('; '), group: d.group }))
    .sort((a, b) => GROUP_ORDER.indexOf(a.group) - GROUP_ORDER.indexOf(b.group) || byString(a.key, b.key));
  const expanded = await expandWith(pack, lines, opts);
  return { lines: expanded.lines, totals: expanded.totals, warnings: [...warnings, ...expanded.warnings] };
}

/**
 * Breaks lines that do not come from plan steps (Plan 5's layout parts) down to base materials exactly as `buildBom`
 * does for the line's plan: in its environment and at its prices (`lineLeaf`: stop items at their cost-model price,
 * derived leaves at their own chain's cost; the plain prices of `planBasis` when the settings name no target the export
 * knows), so the same lines break down the same way in both. One output line per input line, in input order. The return
 * shape is architecture §11.15's, so the breakdown's warnings are not passed on here.
 */
export async function expandBomLines(
  pack: Pack, lines: BomLine[], settings: PlanSettings, ctx: PlanContext,
): Promise<{ lines: BomLine[]; totals: BomLine[] }> {
  const { env, leaf } = await lineLeaf(pack, settings, ctx);
  const expanded = await expandWith(pack, lines, { settings, env, leaf, ctx });
  return { lines: expanded.lines, totals: expanded.totals };
}

interface Expansion { settings: PlanSettings; env: PlanEnv; leaf: LeafOracle; ctx: PlanContext }

/**
 * One accepted recipe that makes a good: how much of it per run, and the raw cost of a run's inputs per unit made (cost
 * analysis), with no credit for its other outputs.
 */
interface Producer { lp: LpRecipe; perRun: number; cost: number }

/** The accepted recipes of a candidate graph, ranked per good, and the option each ore-dictionary slot takes. */
interface RecipeBook {
  /**
   * Cheapest first (lowest `Producer.cost`, ties by id), for an empty container none that consumes a filled container
   * or the container itself; only the pinned recipe when `settings.recipeChoice` pins one of them.
   */
  producersOf(key: StuffKey): Producer[];
  /** The consumed inputs of one run, ore-dictionary slots resolved to their cheapest option, summed per key and sorted. */
  inputsOf(lp: LpRecipe): Array<[StuffKey, number]>;
  /**
   * `BOM_TOO_BIG` when the graph stopped growing at its recipe cap: the goods it never expanded have no producers, so
   * they read as base materials. The graph's other warnings are not passed on: `planLine` reports its own graph's.
   */
  warnings: PlanWarning[];
}

const NO_RECIPES: RecipeBook = { producersOf: () => [], inputsOf: () => [], warnings: [] };
/** The build list's wording of candidates.ts's `graph-too-big`. */
const BOM_TOO_BIG: Readonly<PlanWarning> = {
  code: 'graph-too-big', text: 'The build list is too large to break down fully; mark some parts as "we already make this"',
};

function byCostThenId(a: Producer, b: Producer): number {
  return a.cost < b.cost ? -1 : a.cost > b.cost ? 1 : byString(a.lp.id, b.lp.id);
}

async function recipeBook(pack: Pack, x: Expansion, targets: StuffKey[]): Promise<RecipeBook> {
  await yieldToEventLoop();
  const graph = buildCandidates(pack, x.settings, x.env, x.leaf, targets);
  const costs: CostAnalysis = await analyzeCosts(graph);
  const makers = new Map<StuffKey, Array<{ lp: LpRecipe; perRun: number }>>();
  const options = new Map<StuffKey, Array<{ key: StuffKey; amount: number }>>();
  for (const lp of graph.recipes) {
    if (lp.kind === 'convert') {
      // A convert recipe takes `amount` of one option for one of the slot's virtual good.
      const virtual = lp.coeffs.find(([, c]) => c > 0)?.[0];
      const option = lp.coeffs.find(([, c]) => c < 0);
      if (virtual === undefined || option === undefined) continue;
      const list = options.get(virtual) ?? [];
      list.push({ key: option[0], amount: -option[1] });
      options.set(virtual, list);
      continue;
    }
    for (const [key, c] of lp.coeffs) {
      if (c <= 0) continue;
      const list = makers.get(key) ?? [];
      list.push({ lp, perRun: c });
      makers.set(key, list);
    }
  }

  const ranked = new Map<StuffKey, Producer[]>();
  const resolved = new Map<string, Array<[StuffKey, number]>>();
  const filled = new Set((pack.fluidContainers ?? []).map((c) => c.container));
  const empties = new Set((pack.fluidContainers ?? []).flatMap((c) => (c.empty === null ? [] : [c.empty])));
  /** What a run's inputs cost per unit of `key`, without credit for its other outputs: the breakdown throws those away. */
  const gross = (lp: LpRecipe, perRun: number): number => {
    let total = 0;
    for (const [input, c] of lp.coeffs) if (c < 0) total -= c * costs.cost(input);
    return total / perRun;
  };
  const chosenOption = new Map<StuffKey, { key: StuffKey; amount: number } | undefined>();
  const optionFor = (virtual: StuffKey): { key: StuffKey; amount: number } | undefined => {
    if (!chosenOption.has(virtual)) {
      let best: { key: StuffKey; amount: number; cost: number } | undefined;
      for (const o of options.get(virtual) ?? []) {
        const cost = costs.cost(o.key) * o.amount;
        if (best === undefined || cost < best.cost || (cost === best.cost && o.key < best.key)) best = { ...o, cost };
      }
      chosenOption.set(virtual, best === undefined ? undefined : { key: best.key, amount: best.amount });
    }
    return chosenOption.get(virtual);
  };

  return {
    warnings: graph.warnings.some((w) => w.code === 'graph-too-big') ? [{ ...BOM_TOO_BIG }] : [],
    producersOf(key) {
      let list = ranked.get(key);
      if (list === undefined) {
        // Ranked by `gross` cost: credit for the outputs the breakdown throws away made the Advanced Glue mixer, 3 Empty
        // Cells beside 5,000 L of glue, the "cheapest" Empty Cell (fix spec D15, audit patch G-bom-containers). And an
        // empty container is made from its own parts, never by emptying or reacting a filled one (or itself).
        const empty = empties.has(key);
        const all = (makers.get(key) ?? [])
          .filter(({ lp }) => !empty || !lp.coeffs.some(([input, c]) => c < 0 && (filled.has(input) || input === key)))
          .map(({ lp, perRun }) => ({ lp, perRun, cost: gross(lp, perRun) }));
        const pin = Object.hasOwn(x.settings.recipeChoice, key) ? x.settings.recipeChoice[key] : undefined;
        const pinned = all.filter((p) => p.lp.id === pin);
        list = pinned.length > 0 ? pinned : all.sort(byCostThenId);
        ranked.set(key, list);
      }
      return list;
    },
    inputsOf(lp) {
      let inputs = resolved.get(lp.id);
      if (inputs === undefined) {
        const amounts = new Map<StuffKey, number>();
        for (const [key, c] of lp.coeffs) {
          if (c >= 0) continue;
          const option = graph.goods.get(key)?.virtual === true ? optionFor(key) : { key, amount: 1 };
          if (option !== undefined) amounts.set(option.key, (amounts.get(option.key) ?? 0) - c * option.amount);
        }
        inputs = [...amounts].sort(([a], [b]) => byString(a, b));
        resolved.set(lp.id, inputs);
      }
      return inputs;
    },
  };
}

/**
 * The breakdown's leaf oracle: the line's, except that every free input (`FREE_KEYS`) is a leaf at its price (fix spec
 * R2): a running line makes its own with a generator (`PlanBasis.supplied`), but the one-off materials of its machines
 * get none.
 */
function freeLeaves(pack: Pack, x: Expansion): LeafOracle {
  const prices = makePrices(pack, x.settings.costOverrides);
  return (key) => {
    const d = x.leaf(key);
    return d.buyable || !FREE.has(key) ? d : { buyable: true, cost: prices.price(key), leafClass: 'free' };
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

/**
 * The breakdown `buildBom` and `expandBomLines` share, so the two can never differ. Each line keeps its key, amount,
 * why and group and gets what storage holds of it. A good is a leaf when it is a free input (`freeLeaves`: always, even
 * where the line itself plans its generator), when the line can buy it, when it is a base
 * material out of reach (the material itself is what the group must unlock, as solve.ts names it), when no accepted
 * recipe makes it without consuming a good it is being made for, or 12 levels down. Anything else is made by its
 * cheapest accepted recipe (`RecipeBook.producersOf`: what a run's inputs cost in the cost analysis of the lines' own
 * candidate graph, ties by id; an Empty Cell never from a filled one): `ceil(amount / made per run)` runs, whose
 * consumed inputs × runs are its children (sorted by key, ruling R7). `totals` sums the leaves per key, sorted by key,
 * each with the top-level lines that need it (`neededFor`, fix spec D15: by key, in the order of the lines, summed) and
 * the why "for <their names>", each name once (ruling P18). Lines that are leaves themselves are not targets of the
 * graph, so where another line consumes them they keep their purchase price; such a line needs itself. `warnings` holds
 * the graph's `graph-too-big`, in the build list's words, when the graph hit its recipe cap.
 */
async function expandWith(
  pack: Pack, lines: readonly BomLine[], expansion: Expansion,
): Promise<{ lines: BomLine[]; totals: BomLine[]; warnings: PlanWarning[] }> {
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
  const book = targets.length > 0 ? await recipeBook(pack, x, targets) : NO_RECIPES;
  const totals = new Map<StuffKey, number>();
  /** Per leaf, what each top-level line (by key, first need first) needs of it. */
  const neededBy = new Map<StuffKey, Map<StuffKey, number>>();

  const consumesAny = (lp: LpRecipe, goods: readonly StuffKey[]): boolean => book.inputsOf(lp).some(([input]) => goods.includes(input));
  /** A good with recipes that all consume one of `lineage`: making it there would loop back. */
  const loopsBack = (key: StuffKey, lineage: readonly StuffKey[]): boolean => {
    if (isLeaf(key)) return false;
    const producers = book.producersOf(key);
    return producers.length > 0 && producers.every((p) => consumesAny(p.lp, lineage));
  };

  /**
   * The children of `amount` of `key`, or null when it is a leaf. `path` holds the goods it is being made for: a recipe
   * that consumes one of them, or `key`, is never used, and one whose inputs would only loop back (ingot ↔ block,
   * where the cheapest recipe ties) gives way to the next cheapest.
   */
  const breakDown = (key: StuffKey, amount: number, depth: number, path: StuffKey[]): BomLine[] | null => {
    if (depth >= MAX_DEPTH || isLeaf(key)) return null;
    const lineage = [...path, key];
    const usable = book.producersOf(key).filter((p) => !consumesAny(p.lp, lineage));
    const p = usable.find((q) => !book.inputsOf(q.lp).some(([input]) => loopsBack(input, lineage))) ?? usable[0];
    if (p === undefined) return null;
    const runs = Math.ceil(amount / p.perRun - TINY);
    const why = `for ${pack.nameOf(key)}`;
    return book.inputsOf(p.lp).map(([input, perRun]) => node({ key: input, amount: round9(perRun * runs), why }, depth + 1, lineage));
  };
  const node = (line: BomLine, depth: number, path: StuffKey[]): BomLine => {
    const out: BomLine = { key: line.key, amount: line.amount, why: line.why };
    if (line.group !== undefined) out.group = line.group;
    const have = haveOf(x.ctx, line.key);
    if (have !== undefined) out.have = have;
    if (line.amount <= TINY) return out;   // nothing to make, nothing to gather
    const children = breakDown(line.key, line.amount, depth, path);
    if (children === null) {
      totals.set(line.key, (totals.get(line.key) ?? 0) + line.amount);
      // `path` starts with the top-level line this one is part of; a top-level line has an empty path.
      const top = path[0] ?? line.key;
      const byLine = neededBy.get(line.key) ?? new Map<StuffKey, number>();
      byLine.set(top, (byLine.get(top) ?? 0) + line.amount);
      neededBy.set(line.key, byLine);
    } else if (children.length > 0) {
      out.children = children;
    }
    return out;
  };

  const expanded = lines.map((line) => node(line, 0, []));
  return {
    warnings: book.warnings,
    lines: expanded,
    totals: [...totals].sort(([a], [b]) => byString(a, b)).map(([key, amount]) => {
      const neededFor = [...(neededBy.get(key) ?? [])].map(([top, n]) => ({ key: top, amount: round9(n) }));
      // Each name once: the programmed circuits of several configurations are all "Programmed Circuit".
      const names = [...new Set(neededFor.map((n) => pack.nameOf(n.key)))];
      const total: BomLine = { key, amount: round9(amount), why: `for ${names.join(', ')}`, neededFor };
      const have = haveOf(x.ctx, key);
      if (have !== undefined) total.have = have;
      return total;
    }),
  };
}
