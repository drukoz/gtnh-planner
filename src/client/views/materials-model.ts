// What the Materials & steps tab shows (spec §3.10), as pure functions: the build list as rows (expandable down to
// base materials and split into the groups of architecture §11.13; each base-material total opens to the build lines
// that need it), the base materials the line runs on (per hour, or for the whole batch in Make N) with where they come
// from (spec §3.3b), what unlocks them and which steps use them — what it takes from a farm the group runs or another
// project and a tree farm's tool wear said so (add-on 17) — the inputs nothing in the plan supplies (fix spec §6.4),
// whom its byproducts serve in other projects (add-on 17), and the amount, stock and storage texts next to each row
// (spec §3.4, architecture §11.20); and what a plan uses beyond its line, for the plan banner (ruling R18). Amounts never
// read 0: tiny rates read "1 every N days" (fix spec §6.1). The build list can also be drawn as an inventory grid (Phase 2
// spec §9): its top-level lines as slots in their groups, each item split into stacks of 64, with what a group still needs,
// the stacks gathered, and what each slot's tip says.

import { tierName } from '../../shared/gt/tiers.ts';
import { isFluidKey, parseItemKey, type StuffKey } from '../../shared/keys.ts';
import type { PlanIndex } from '../../shared/plan/balance.ts';
import type { BomLine, LeafClass, Plan, PlanStep, RawInput, SourceInfo, StorageWhere } from '../../shared/types/plan.ts';
import type { Mark } from '../../shared/types/project.ts';
import { formatNumber, formatPercent, formatRate } from '../format.ts';

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

/** A count with its unit: litres for a fluid, `×` for an item. A rate (`rate`) carries its unit already. The List and the grid share it. */
export function quantity(key: StuffKey, amount: string, rate = false): string {
  if (rate) return amount;
  return isFluidKey(key) ? `${amount} L` : `${amount}×`;
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
}

const NONE: ReadonlySet<StuffKey> = new Set();

/** What the avoid marker says of a good the line uses although the avoid list covers it: its title in the List, a line of its slot's tip in the grid. */
export const AVOID_NOTE = 'On the avoid list or made from it, but no recipe at this tier avoids it';

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
 * The build tree as rows, depth first: each line, then its children when its `path` (`<parent path>/<key>`, a top-level
 * line's path is its key) is in `expanded`; a row of a good in `unavoidable` is marked `avoid`.
 */
export function buildRows(
  lines: BomLine[], names: Record<string, string>, expanded: ReadonlySet<string>, unavoidable: ReadonlySet<StuffKey> = NONE,
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
    rows.push(row);
    if (expanded.has(path)) for (const child of children) visit(child, path, depth + 1, group);
  };
  for (const line of lines) visit(line, null, 0, line.group ?? DEFAULT_GROUP);
  return rows;
}

/** The build list split into its groups (a line without one is a machine), in `BUILD_GROUPS` order; empty groups are left out. */
export function groupBuildRows(
  lines: BomLine[], names: Record<string, string>, expanded: ReadonlySet<string>, unavoidable: ReadonlySet<StuffKey> = NONE,
): Array<{ id: BuildGroup; label: string; rows: BuildRow[] }> {
  return BUILD_GROUPS
    .map(({ id, label }) => ({ id, label, rows: buildRows(lines.filter((line) => (line.group ?? DEFAULT_GROUP) === id), names, expanded, unavoidable) }))
    .filter((group) => group.rows.length > 0);
}

/** Minecraft's stack (Phase 2 spec §9.1). The export has no stack size per item (pack.ts `Item`), and a build list asks for one of each tool. */
export const STACK_SIZE = 64;
/** The stacks of an item the grid draws: past them one more slot says how many it holds (`+N`), which bounds the page however big the build. */
export const MAX_STACKS_SHOWN = 9;
/** How far past a whole number an amount may be and still count as it (float noise: 64.0000000001 items are one stack of 64). */
const STACK_NOISE = 1e-6;

/**
 * Whole items in stacks of `size`, the last one holding the rest: 80 → [64, 16], 128 → [64, 64], 1 → [1]. The amount is rounded up first
 * (0.25 → [1]), but for a hair of float noise (64.0000000001 → [64]); nothing for 0 or less.
 */
export function stackSplit(amount: number, size: number = STACK_SIZE): number[] {
  const n = Math.ceil(amount - STACK_NOISE);
  if (!Number.isFinite(n) || n <= 0) return [];
  const full = Math.floor(n / size);
  const rest = n - full * size;
  return [...Array<number>(full).fill(size), ...(rest > 0 ? [rest] : [])];
}

/** A top-level line of the build list as inventory slots (Phase 2 spec §9.4). */
export interface SlotItem {
  /** `build:<key>`, the row's one mark, which the List's row shares and every stack of it shows. */
  row: string; key: StuffKey; name: string; group: BuildGroup;
  /** The quantity the List shows: "80×", "1,000 L". */
  amount: string;
  /** The item's stacks (`stackSplit`); a fluid is one slot, whatever its litres. */
  stacks: number[];
  why: string; have?: string; where?: string[];
  /** A good on the avoid list the line still uses, as nothing at the tier avoids it (`unavoidableKeys`). */
  avoid?: true;
  fluid: boolean;
}

/** A group of the build list as slots: one of `BUILD_GROUPS`. */
export interface SlotGroup { id: BuildGroup; label: string; items: SlotItem[] }

/**
 * The build list's top-level lines as slots (their breakdown stays in the List), grouped as `groupBuildRows` groups them: in `BUILD_GROUPS`
 * order, a line without a group a machine, empty groups left out; a good in `unavoidable` is marked `avoid`.
 */
export function groupBuildSlots(lines: BomLine[], names: Record<string, string>, unavoidable: ReadonlySet<StuffKey> = NONE): SlotGroup[] {
  return BUILD_GROUPS
    .map(({ id, label }) => ({ id, label, items: lines.filter((line) => (line.group ?? DEFAULT_GROUP) === id).map((line) => slotItem(line, id, names, unavoidable)) }))
    .filter((group) => group.items.length > 0);
}

function slotItem(line: BomLine, group: BuildGroup, names: Record<string, string>, unavoidable: ReadonlySet<StuffKey>): SlotItem {
  const fluid = isFluidKey(line.key);
  const item: SlotItem = {
    row: `build:${line.key}`, key: line.key, name: buildName(line.key, names), group, amount: quantity(line.key, amountText(line.amount)),
    stacks: fluid ? [1] : stackSplit(line.amount), why: line.why, ...stockOf(line.have), fluid,
  };
  if (unavoidable.has(line.key)) item.avoid = true;
  return item;
}

/** The stacks of every item, those past the ninth too, and of the marked rows among them: "Gathered <done> of <total> stacks". */
export function gatheredStacks(groups: readonly SlotGroup[], marks: Readonly<Record<string, Mark>>): { done: number; total: number } {
  let done = 0;
  let total = 0;
  for (const group of groups) {
    for (const item of group.items) {
      total += item.stacks.length;
      if (marks[item.row] !== undefined) done += item.stacks.length;
    }
  }
  return { done, total };
}

/** What a group still needs, counting its rows: "3 of 11 still needed", or "all in your chests" once every row is marked. */
export function stillNeeded(items: readonly SlotItem[], marks: Readonly<Record<string, Mark>>): string {
  const left = items.filter((item) => marks[item.row] === undefined).length;
  return left === 0 ? 'all in your chests' : `${left} of ${items.length} still needed`;
}

/**
 * A slot's tip after its name (Phase 2 spec §9.4): what the build needs, and what the scanned world holds; why; the avoid marker's words,
 * for a good nothing at the tier avoids; and who marked the row, and when (`when` writes the time).
 */
export function slotTipLines(item: SlotItem, mark: Mark | undefined, when: (iso: string) => string): string[] {
  return [
    item.have === undefined ? `need ${item.amount}` : `need ${item.amount} · ${item.have}`,
    item.why,
    ...(item.avoid === true ? [AVOID_NOTE] : []),
    ...(mark === undefined ? [] : [`✓ ${mark.by}, ${when(mark.at)}`]),
  ];
}

/** A step that takes a good, and how much: per hour in rate mode, for the whole batch in Make N. */
export interface UsedBy { stepId: string; label: string /* "Mixer (Glue)" */; rate: string }

export interface RunRow {
  /** `run:<key>`; a row taken from a farm the group runs or another project `run:<key>:<from.kind>:<from.id>` (add-on 17). */
  row: string; key: StuffKey; name: string;
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

/**
 * The badge of a raw input: where one taken from a farm the group runs or another project comes from (`from <name>`), a
 * tree farm's worn tools as `tool wear` (add-on 17); else its kind of leaf, and one without a leaf class is a plain base
 * material, or out of reach when it is not available.
 */
function badgeOf(input: RawInput): string {
  if (input.from !== undefined) return `from ${input.from.name}`;
  if (input.upkeep === true) return 'tool wear';
  if (input.leafClass !== undefined) return LEAF_BADGES[input.leafClass];
  return input.available ? 'base material' : LEAF_BADGES.unavailable;
}

/** A raw input's row id: `run:<key>`, and `run:<key>:<from.kind>:<from.id>` for one taken from a farm or project, so neither shares the other's tick. */
function runRowId(input: RawInput): string {
  return input.from === undefined ? `run:${input.key}` : `run:${input.key}:${input.from.kind}:${input.from.id}`;
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
 * one on the avoid list, the steps that take it, and why a base material cannot be made in the line instead. A good the
 * line takes from a farm the group runs or another project has a row of its own beside its bought row (add-on 17), and
 * the steps that take the good are listed on its first row only: they take it from all of them alike.
 */
export function runRows(plan: Plan, mode: 'rate' | 'makeN'): RunRow[] {
  const names = plan.names ?? {};
  const unlocks = new Map(plan.unlocks.map((u) => [u.key, u.text]));
  const unavoidable = unavoidableKeys(plan);
  const listed = new Set<StuffKey>();
  return plan.rawInputs.map((input): RunRow => {
    const batch = input.total ?? input.perSecond * (plan.makeN?.totalSeconds ?? 0);
    const amount = mode === 'rate' ? formatRate(input.perSecond, 'hour', { fluid: isFluidKey(input.key) }) : amountText(batch);
    const cost = mode === 'rate' ? `cost ${formatRate(input.cost, 'hour')}` : `cost ${amountText(input.cost)}`;
    const first = !listed.has(input.key);
    listed.add(input.key);
    const row: RunRow = {
      row: runRowId(input), key: input.key, name: names[input.key] ?? input.key, amount, cost, badge: badgeOf(input),
      sources: input.sources.map((s) => sourceText(s, names)), ...stockOf(input.have),
      canExpand: input.leafClass !== undefined && EXPANDABLE.has(input.leafClass), isStop: input.leafClass === 'stop',
      usedBy: first ? usersOf(plan, mode, input.key, 'raw') : [],
    };
    // What unlocks a good is said once, with its first row; what is taken from a farm or project needs no unlock.
    const unlock = first && input.from === undefined ? unlocks.get(input.key) : undefined;
    if (unlock !== undefined) row.unlock = unlock;
    if (unavoidable.has(input.key)) row.avoid = true;
    if (row.canExpand && input.canMake === false) row.cannotMake = `Nothing at ${tierName(plan.tier)} makes ${row.name}`;
    return row;
  });
}

/** One of the line's byproducts serving another project (add-on 17), under that byproduct: `for <name>` or `taken by <name>`. */
export interface TakenRow { key: StuffKey; text: string; amount: string /* per hour */ }

/**
 * Whom the line's byproducts serve in the group's other projects, in the plan's order: the needs it is credited for
 * (`Plan.credits`, best multi-output: `for <project>`), then each live project's draw on its surplus (`Plan.drawnBy`,
 * ruling R16: `taken by <project>`), each per hour.
 */
export function takenRows(plan: Plan): TakenRow[] {
  const perHour = (key: StuffKey, perSecond: number): string => formatRate(perSecond, 'hour', { fluid: isFluidKey(key) });
  return [
    ...(plan.credits ?? []).map((c): TakenRow => ({ key: c.key, text: `for ${c.name}`, amount: perHour(c.key, c.perSecond) })),
    ...(plan.drawnBy ?? []).map((d): TakenRow => ({ key: d.key, text: `taken by ${d.name}`, amount: perHour(d.key, d.perSecond) })),
  ];
}

/** `a` or `an` before `word`, by its first letter. */
function article(word: string): string {
  return /^[aeiou]/i.test(word) ? 'an' : 'a';
}

/**
 * What the plan uses beyond its own line, for the plan banner's "This plan …" notes (ruling R18; OQ1: farms and other
 * projects' surplus are on for every project, so the plan says when it uses them), in this order: each farm step
 * (`uses a Tree Growth Simulator (<sapling>)`, `uses a <crop> crop farm`), each farm the group runs that it takes from
 * (`uses <farm>`), each good it draws from another project (`draws <item> from <project>`); names from `plan.names`, each
 * note once.
 */
export function sourceNotes(plan: Plan): string[] {
  const names = plan.names ?? {};
  const nameOf = (key: StuffKey): string => names[key] ?? key;
  const notes: string[] = [];
  for (const step of plan.steps) {
    const farm = step.farm;
    if (farm === undefined) continue;
    if (farm.kind === 'tgs') notes.push(farm.sapling === undefined ? 'uses a Tree Growth Simulator' : `uses a Tree Growth Simulator (${nameOf(farm.sapling)})`);
    else notes.push(farm.crop === undefined ? 'uses a crop farm' : `uses ${article(farm.crop.name)} ${farm.crop.name} crop farm`);
  }
  for (const input of plan.rawInputs) if (input.from?.kind === 'farm') notes.push(`uses ${input.from.name}`);
  for (const input of plan.rawInputs) if (input.from?.kind === 'project') notes.push(`draws ${nameOf(input.key)} from ${input.from.name}`);
  return [...new Set(notes)];
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
