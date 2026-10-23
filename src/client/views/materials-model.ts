// What the Materials & steps tab shows (spec §3.10), as pure functions: the build list as rows (expandable down to
// base materials and split into the groups of architecture §11.13; each base-material total opens to the build lines
// that need it), the base materials the line runs on (per hour, or for the whole batch in Make N) with where they come
// from (spec §3.3b), what unlocks them and which steps use them, the inputs nothing in the plan supplies (fix spec
// §6.4), and the amount, stock and storage texts next to each row (spec §3.4, architecture §11.20). Amounts never read
// 0: tiny rates read "1 every N days" (fix spec §6.1).
// A made build part says how it is made and carries its swap list; a part nothing here can make says why (§11 entry 41).

import { tierName } from '../../shared/gt/tiers.ts';
import { isFluidKey, parseItemKey, type StuffKey } from '../../shared/keys.ts';
import type { PlanIndex } from '../../shared/plan/balance.ts';
import type { BomLine, LeafClass, Plan, PlanStep, RawInput, SourceInfo, StorageWhere } from '../../shared/types/plan.ts';
import type { Alternative } from '../components/SwapRecipe.tsx';
import { formatNumber, formatPercent, formatRate, withArticle } from '../format.ts';

type BuildGroup = NonNullable<BomLine['group']>;
type Have = { total: number; reachable: number; where?: StorageWhere[] };

/** The short word next to each base material: what kind of leaf of the plan it is. */
export const LEAF_BADGES: Record<LeafClass, string> = {
  free: 'free',
  direct: 'mined',
  byproduct: 'byproduct',
  derived: 'made from other materials',
  natural: 'gathered',
  stop: 'we make this',
  unavailable: 'not reachable yet',
};

/** The "to build" groups, in the order the list shows them (architecture §11.13). */
export const BUILD_GROUPS: ReadonlyArray<{ id: BuildGroup; label: string }> = [
  { id: 'machines', label: 'Machines' },
  { id: 'power', label: 'Power' },
  { id: 'logistics', label: 'Piping & logistics' },
  { id: 'one-off', label: 'One-off items' },
];

/** The group a build line without one belongs to. */
const DEFAULT_GROUP: BuildGroup = 'machines';
/** The leaf kinds that are base materials, which the group may choose to make in the line instead. */
const EXPANDABLE: ReadonlySet<LeafClass> = new Set<LeafClass>(['direct', 'byproduct', 'derived']);
/** Found spots listed per source before the rest is counted. */
const MAX_FOUND_AT = 3;
/** How close to a whole number an amount must be to show as one (rates carry float noise such as 360.00000000000006). */
const WHOLE_TOLERANCE = 1e-9;
/** Below this, two decimals would read `0.00` (or `0.01` for 0.005): such an amount keeps its own digits instead. */
const SMALLEST_TWO_DECIMALS = 0.01;
/** The pack's Programmed Circuit (the loader's PROGRAMMED_CIRCUIT_ID): one item per configuration, the meta. */
const PROGRAMMED_CIRCUIT_ID = 'gregtech:gt.integrated_circuit';
/** How the ids of a placed line's own build steps start (Plan 5's layout steps: `layout:site`, `layout:place:<step>`, …). */
const LAYOUT_STEP_PREFIX = 'layout:';

// A fixed locale, so every friend's browser (and the tests) writes `1,440` the same way.
const WHOLE = new Intl.NumberFormat('en-US', { maximumFractionDigits: 0 });
const TWO_DECIMALS = new Intl.NumberFormat('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

/**
 * Whole numbers with thousands separators (`1,440`), anything else with two decimals (`0.13`); an amount too small for
 * two decimals keeps its significant digits (`0.004`), so a positive amount never reads `0.00`.
 */
export function amountText(n: number): string {
  const whole = Math.round(n) || 0;   // never `-0`
  if (Math.abs(n - whole) <= WHOLE_TOLERANCE * Math.max(1, Math.abs(n))) return WHOLE.format(whole);
  return Math.abs(n) < SMALLEST_TWO_DECIMALS ? formatNumber(n) : TWO_DECIMALS.format(n);
}

/** A good's name in a build list: a Programmed Circuit says its configuration ("Programmed Circuit (config 3)"). */
function buildName(key: StuffKey, names: Record<string, string>): string {
  const name = names[key] ?? key;
  if (isFluidKey(key) || !key.includes('@')) return name;
  const { id, meta, nbtHash } = parseItemKey(key);
  return id === PROGRAMMED_CIRCUIT_ID && nbtHash === undefined ? `${name} (config ${meta})` : name;
}

/** "Mixer (Glue)": a step by its machine and what it makes. */
function stepLabel(step: PlanStep, names: Record<string, string>): string {
  return step.mainOutput === undefined ? step.machine.name : `${step.machine.name} (${names[step.mainOutput] ?? step.mainOutput})`;
}

/** `have <total> (<reachable> reachable)`; nothing when the plan knows no stock for the line. */
export function haveText(h: { total: number; reachable: number } | undefined): string | undefined {
  return h === undefined ? undefined : `have ${amountText(h.total)} (${amountText(h.reachable)} reachable)`;
}

/** One line per storage block that holds some of it, in the order given: `<count> in <kind> at <x> <y> <z>`. */
export function whereLines(have: { where?: StorageWhere[] } | undefined): string[] {
  return (have?.where ?? []).map((w) => `${amountText(w.count)} in ${w.kind} at ${w.pos[0]} ${w.pos[1]} ${w.pos[2]}`);
}

/** Where a base material comes from, its dimensions by name, and the first few spots where the group already found it. */
export function sourceText(s: SourceInfo, names: Record<string, string>): string {
  const dims = s.dims.map((key) => names[`dim:${key}`] ?? key).join(', ');
  let parts: string[];
  if (s.kind === 'vein') parts = [`vein ${s.detail}`, dims];
  else if (s.kind === 'small_ore') parts = ['small ore', dims];
  else if (s.kind === 'byproduct' || s.kind === 'fluid') parts = [s.detail, dims];
  else parts = [s.detail];
  const spots = s.foundAt ?? [];
  if (spots.length > 0) {
    const listed = spots.slice(0, MAX_FOUND_AT).map((p) => `${p.x} ${p.z} (${names[`dimId:${p.dim}`] ?? `DIM${p.dim}`})`);
    const more = spots.length > MAX_FOUND_AT ? ` +${spots.length - MAX_FOUND_AT} more` : '';
    parts.push(`found at ${listed.join(', ')}${more}`);
  }
  const text = parts.filter((part) => part !== '').join(' · ');
  return text === '' ? s.kind.replace('_', ' ') : text;
}

export interface BuildRow {
  row: string /* build:<key> */; path: string; key: StuffKey; name: string; amount: string; why: string; have?: string; depth: number;
  hasChildren: boolean; group: BuildGroup /* of its top-level line; missing → 'machines' */;
  /** One line per storage block holding some of it (architecture §11.20); only when the scan says where. */
  where?: string[];
  /** A good on the avoid list the line still uses, as nothing at the tier avoids it (`unavoidableKeys`). */
  avoid?: true;
  /** On a total of base materials (`BomLine.neededFor`, fix spec D15): each build line that needs it, and how much. */
  neededFor?: Array<{ key: StuffKey; name: string; amount: string }>;
  /**
   * How the build list makes it (`BomLine.made`, architecture §11 entry 41 (1)): in words (`madeText`), its recipe, and
   * every way to make it (`Plan.buildAlternatives`) for the recipe swap.
   */
  made?: { text: string; recipeId: string; alternatives: Alternative[] };
  /** A part the line cannot buy and the breakdown cannot make here, and why (`BomLine.unmade`, entry 41 (2)): the row says to import it. */
  unmade?: 'no-recipe' | 'own-chain';
}

const NONE: ReadonlySet<StuffKey> = new Set();

/** The goods the plan uses although the avoid list covers them, as nothing at its tier avoids them (spec §3.3). */
export function unavoidableKeys(plan: Plan): Set<StuffKey> {
  return new Set((plan.avoided ?? []).filter((a) => a.unavoidable).map((a) => a.key));
}

/** The have and where texts of a row, set only when there is something to show. */
function stockOf(have: Have | undefined): { have?: string; where?: string[] } {
  const stock: { have?: string; where?: string[] } = {};
  const text = haveText(have);
  if (text !== undefined) stock.have = text;
  const where = whereLines(have);
  if (where.length > 0) stock.where = where;
  return stock;
}

/**
 * How the build list makes a part, in words (architecture §11 entry 41 (1)): "made at a crafting table from LV Machine
 * Hull, Basic Circuit", else "made in" the group's own machine ("your Basic Wiremill"), the one this line builds ("the
 * Basic Assembler this line builds") or one still to get ("a Basic Fluid Extractor"); from what goes in (its children,
 * in their order: none for a node the tree cuts at its depth cap or a recipe that consumes nothing); then the recipe's
 * programmed circuit and cleanroom, those it needs ("(circuit 8; in a cleanroom)"). Undefined for a part that is not made.
 */
export function madeText(line: BomLine, names: Record<string, string>): string | undefined {
  const { made } = line;
  if (made === undefined) return undefined;
  const { machine } = made;
  let where: string;
  if (machine === 'crafting table') where = 'at a crafting table';
  else if (machine.source === 'owned') where = `in your ${machine.name}`;
  else if (machine.source === 'line') where = `in the ${machine.name} this line builds`;
  else where = `in ${withArticle(machine.name)}`;
  const inputs = (line.children ?? []).map((child) => names[child.key] ?? child.key);
  const notes = [...(made.circuit === undefined ? [] : [`circuit ${made.circuit}`]), ...(made.cleanroom === true ? ['in a cleanroom'] : [])];
  return `made ${where}${inputs.length > 0 ? ` from ${inputs.join(', ')}` : ''}${notes.length > 0 ? ` (${notes.join('; ')})` : ''}`;
}

/**
 * The build counts the placed line's parts (the controller's ruling on open question 3): the plan's build steps hold a
 * layout step, as they do once Plan 5 merged the layout's parts into the build list and pooled them into its breakdown
 * (architecture §11 entry 41 (9)), so a part's recipe or amount can differ from the unplaced line's.
 */
export function withLinePlaced(plan: Plan): boolean {
  return plan.buildSteps.some((step) => step.id.startsWith(LAYOUT_STEP_PREFIX));
}

/**
 * The build tree as rows, depth first: each line, then its children when its `path` (`<parent path>/<key>`, a top-level
 * line's path is its key) is in `expanded`; a row of a good in `unavoidable` is marked `avoid`. A made part says how it
 * is made, with its swap list from `alternatives` (`Plan.buildAlternatives`); a part to import says why.
 */
export function buildRows(
  lines: BomLine[], names: Record<string, string>, expanded: ReadonlySet<string>, unavoidable: ReadonlySet<StuffKey> = NONE,
  alternatives?: Record<StuffKey, Alternative[]>,
): BuildRow[] {
  const rows: BuildRow[] = [];
  const visit = (line: BomLine, parentPath: string | null, depth: number, group: BuildGroup): void => {
    const path = parentPath === null ? line.key : `${parentPath}/${line.key}`;
    const children = line.children ?? [];
    const row: BuildRow = {
      row: `build:${line.key}`, path, key: line.key, name: buildName(line.key, names), amount: amountText(line.amount), why: line.why,
      ...stockOf(line.have), depth, hasChildren: children.length > 0, group,
    };
    if (unavoidable.has(line.key)) row.avoid = true;
    if (line.neededFor !== undefined && line.neededFor.length > 0) {
      row.neededFor = line.neededFor.map((n) => ({ key: n.key, name: buildName(n.key, names), amount: amountText(n.amount) }));
    }
    const text = madeText(line, names);
    if (line.made !== undefined && text !== undefined) row.made = { text, recipeId: line.made.recipeId, alternatives: alternatives?.[line.key] ?? [] };
    if (line.unmade !== undefined) row.unmade = line.unmade;
    rows.push(row);
    if (expanded.has(path)) for (const child of children) visit(child, path, depth + 1, group);
  };
  for (const line of lines) visit(line, null, 0, line.group ?? DEFAULT_GROUP);
  return rows;
}

/** The build list split into its groups (a line without one is a machine), in `BUILD_GROUPS` order; empty groups are left out. */
export function groupBuildRows(
  lines: BomLine[], names: Record<string, string>, expanded: ReadonlySet<string>, unavoidable: ReadonlySet<StuffKey> = NONE,
  alternatives?: Record<StuffKey, Alternative[]>,
): Array<{ id: BuildGroup; label: string; rows: BuildRow[] }> {
  return BUILD_GROUPS
    .map(({ id, label }) => ({ id, label, rows: buildRows(lines.filter((line) => (line.group ?? DEFAULT_GROUP) === id), names, expanded, unavoidable, alternatives) }))
    .filter((group) => group.rows.length > 0);
}

/** A step that takes a good, and how much: per hour in rate mode, for the whole batch in Make N. */
export interface UsedBy { stepId: string; label: string /* "Mixer (Glue)" */; rate: string }

export interface RunRow {
  row: string /* run:<key> */; key: StuffKey; name: string;
  /** In rate mode a rate with its unit ("1,800/h", "71.9 L/h", "1 L every 12.1 days"); in Make N a count ("10"). */
  amount: string;
  cost: string; badge: string;
  sources: string[]; unlock?: string; have?: string; canExpand: boolean; isStop: boolean;
  /** One line per storage block holding some of it (architecture §11.20); only when the scan says where. */
  where?: string[];
  /** A good on the avoid list the line still uses, as nothing at the tier avoids it (`unavoidableKeys`). */
  avoid?: true;
  /** The steps it goes to, largest first (fix spec §6.4). */
  usedBy: UsedBy[];
  /** Why the group cannot make it in the line instead: nothing at the tier makes it (`RawInput.canMake` false). */
  cannotMake?: string;
}

/** The badge of a raw input; one without a leaf class is a plain base material, or out of reach when it is not available. */
function badgeOf(input: RawInput): string {
  if (input.leafClass !== undefined) return LEAF_BADGES[input.leafClass];
  return input.available ? 'base material' : LEAF_BADGES.unavailable;
}

/** An amount of `key` a second: per hour in rate mode (litres for a fluid), the whole batch's in Make N (a bare count). */
function amountOf(plan: Plan, mode: 'rate' | 'makeN', key: StuffKey, perSecond: number): string {
  return mode === 'rate' ? formatRate(perSecond, 'hour', { fluid: isFluidKey(key) }) : amountText(perSecond * (plan.makeN?.totalSeconds ?? 0));
}

/** The same with its unit in Make N too ("10×", "250 L"), for a text that stands on its own (a chip). */
function amountWithUnit(plan: Plan, mode: 'rate' | 'makeN', key: StuffKey, perSecond: number): string {
  const text = amountOf(plan, mode, key, perSecond);
  return mode === 'rate' ? text : isFluidKey(key) ? `${text} L` : `${text}×`;
}

/** The steps the flows of `key` from `from` go to, largest first, by their machine and product. */
function usersOf(plan: Plan, mode: 'rate' | 'makeN', key: StuffKey, from: string): UsedBy[] {
  const names = plan.names ?? {};
  const steps = new Map(plan.steps.map((s) => [s.id, s]));
  const perStep = new Map<string, number>();
  for (const f of plan.flows) if (f.from === from && f.key === key && steps.has(f.to)) perStep.set(f.to, (perStep.get(f.to) ?? 0) + f.perSecond);
  return [...perStep].sort(([a, x], [b, y]) => y - x || (a < b ? -1 : a > b ? 1 : 0))
    .map(([stepId, perSecond]) => ({ stepId, label: stepLabel(steps.get(stepId) as PlanStep, names), rate: amountWithUnit(plan, mode, key, perSecond) }));
}

/**
 * The base materials the line runs on: per hour in rate mode (spec §3.10 "base materials per hour"), for the whole
 * batch in Make N; with their raw-material cost on the same basis, sources, unlock text, stock, whether the line uses
 * one on the avoid list, the steps that take it, and why a base material cannot be made in the line instead.
 */
export function runRows(plan: Plan, mode: 'rate' | 'makeN'): RunRow[] {
  const names = plan.names ?? {};
  const unlocks = new Map(plan.unlocks.map((u) => [u.key, u.text]));
  const unavoidable = unavoidableKeys(plan);
  return plan.rawInputs.map((input): RunRow => {
    const batch = input.total ?? input.perSecond * (plan.makeN?.totalSeconds ?? 0);
    const amount = mode === 'rate' ? formatRate(input.perSecond, 'hour', { fluid: isFluidKey(input.key) }) : amountText(batch);
    const cost = mode === 'rate' ? `cost ${formatRate(input.cost, 'hour')}` : `cost ${amountText(input.cost)}`;
    const row: RunRow = {
      row: `run:${input.key}`, key: input.key, name: names[input.key] ?? input.key, amount, cost, badge: badgeOf(input),
      sources: input.sources.map((s) => sourceText(s, names)), ...stockOf(input.have),
      canExpand: input.leafClass !== undefined && EXPANDABLE.has(input.leafClass), isStop: input.leafClass === 'stop',
      usedBy: usersOf(plan, mode, input.key, 'raw'),
    };
    const unlock = unlocks.get(input.key);
    if (unlock !== undefined) row.unlock = unlock;
    if (unavoidable.has(input.key)) row.avoid = true;
    if (row.canExpand && input.canMake === false) row.cannotMake = `Nothing at ${tierName(plan.tier)} makes ${row.name}`;
    return row;
  });
}

/** An input of a step that nothing in the plan supplies, or supplies short (`orphan-input`, `short-input`). */
export interface MissingRow {
  row: string /* missing:<key>@<stepId> */; key: StuffKey; name: string; stepId: string;
  /** How much is missing: per hour in rate mode, for the whole batch in Make N. */
  amount: string;
  badge: string /* "no source in the plan" | "short: gets <pct>" */;
  usedBy: UsedBy[];
}

/**
 * The inputs the plan does not supply (fix spec §6.4), from the integrity issues of `index` (`indexPlan(plan)`), in
 * its order: listed before the base materials, as a plan with one does not add up.
 */
export function missingRows(plan: Plan, index: PlanIndex): MissingRow[] {
  const names = plan.names ?? {};
  const steps = new Map(plan.steps.map((s) => [s.id, s]));
  const mode = plan.makeN === undefined ? 'rate' : 'makeN';
  return index.issues.flatMap((issue): MissingRow[] => {
    if ((issue.code !== 'orphan-input' && issue.code !== 'short-input') || issue.stepId === undefined) return [];
    const step = steps.get(issue.stepId);
    const need = issue.needPerSecond ?? 0;
    const got = issue.gotPerSecond ?? 0;
    const missing = amountOf(plan, mode, issue.key, issue.code === 'orphan-input' ? need : Math.max(0, need - got));
    const badge = issue.code === 'orphan-input' ? 'no source in the plan' : `short: gets ${formatPercent(need > 0 ? got / need : 0)}`;
    return [{
      row: `missing:${issue.key}@${issue.stepId}`, key: issue.key, name: names[issue.key] ?? issue.key, stepId: issue.stepId, amount: missing, badge,
      usedBy: step === undefined ? [] : [{ stepId: step.id, label: stepLabel(step, names), rate: amountWithUnit(plan, mode, issue.key, need) }],
    }];
  });
}
