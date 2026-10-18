// What the Materials & steps tab shows (spec §3.10), as pure functions: the build list as rows (expandable down to
// base materials and split into the groups of architecture §11.13), the base materials the line runs on (per hour, or
// for the whole batch in Make N) with where they come from (spec §3.3b) and what unlocks them, and the amount, stock
// and storage texts next to each row (spec §3.4, architecture §11.20).

import type { StuffKey } from '../../shared/keys.ts';
import type { BomLine, LeafClass, Plan, RawInput, SourceInfo, StorageWhere } from '../../shared/types/plan.ts';

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
const SECONDS_PER_HOUR = 3600;
/** How close to a whole number an amount must be to show as one (rates carry float noise such as 360.00000000000006). */
const WHOLE_TOLERANCE = 1e-9;

// A fixed locale, so every friend's browser (and the tests) writes `1,440` the same way.
const WHOLE = new Intl.NumberFormat('en-US', { maximumFractionDigits: 0 });
const TWO_DECIMALS = new Intl.NumberFormat('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

/** Whole numbers with thousands separators (`1,440`), anything else with two decimals (`0.13`). */
export function amountText(n: number): string {
  const whole = Math.round(n) || 0;   // never `-0`
  return Math.abs(n - whole) <= WHOLE_TOLERANCE * Math.max(1, Math.abs(n)) ? WHOLE.format(whole) : TWO_DECIMALS.format(n);
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
 * line's path is its key) is in `expanded`.
 */
export function buildRows(lines: BomLine[], names: Record<string, string>, expanded: ReadonlySet<string>): BuildRow[] {
  const rows: BuildRow[] = [];
  const visit = (line: BomLine, parentPath: string | null, depth: number, group: BuildGroup): void => {
    const path = parentPath === null ? line.key : `${parentPath}/${line.key}`;
    const children = line.children ?? [];
    rows.push({
      row: `build:${line.key}`, path, key: line.key, name: names[line.key] ?? line.key, amount: amountText(line.amount), why: line.why,
      ...stockOf(line.have), depth, hasChildren: children.length > 0, group,
    });
    if (expanded.has(path)) for (const child of children) visit(child, path, depth + 1, group);
  };
  for (const line of lines) visit(line, null, 0, line.group ?? DEFAULT_GROUP);
  return rows;
}

/** The build list split into its groups (a line without one is a machine), in `BUILD_GROUPS` order; empty groups are left out. */
export function groupBuildRows(
  lines: BomLine[], names: Record<string, string>, expanded: ReadonlySet<string>,
): Array<{ id: BuildGroup; label: string; rows: BuildRow[] }> {
  return BUILD_GROUPS
    .map(({ id, label }) => ({ id, label, rows: buildRows(lines.filter((line) => (line.group ?? DEFAULT_GROUP) === id), names, expanded) }))
    .filter((group) => group.rows.length > 0);
}

export interface RunRow {
  row: string /* run:<key> */; key: StuffKey; name: string; amount: string /* "<n>/h" in rate mode, "<n>" in Make N */; cost: string; badge: string;
  sources: string[]; unlock?: string; have?: string; canExpand: boolean; isStop: boolean;
  /** One line per storage block holding some of it (architecture §11.20); only when the scan says where. */
  where?: string[];
}

/** The badge of a raw input; one without a leaf class is a plain base material, or out of reach when it is not available. */
function badgeOf(input: RawInput): string {
  if (input.leafClass !== undefined) return LEAF_BADGES[input.leafClass];
  return input.available ? 'base material' : LEAF_BADGES.unavailable;
}

/**
 * The base materials the line runs on: per hour in rate mode (spec §3.10 "base materials per hour"), for the whole
 * batch in Make N; with their raw-material cost on the same basis, sources, unlock text and stock.
 */
export function runRows(plan: Plan, mode: 'rate' | 'makeN'): RunRow[] {
  const names = plan.names ?? {};
  const unlocks = new Map(plan.unlocks.map((u) => [u.key, u.text]));
  return plan.rawInputs.map((input): RunRow => {
    const batch = input.total ?? input.perSecond * (plan.makeN?.totalSeconds ?? 0);
    const amount = mode === 'rate' ? `${amountText(input.perSecond * SECONDS_PER_HOUR)}/h` : amountText(batch);
    const cost = mode === 'rate' ? `cost ${amountText(input.cost * SECONDS_PER_HOUR)}/h` : `cost ${amountText(input.cost)}`;
    const row: RunRow = {
      row: `run:${input.key}`, key: input.key, name: names[input.key] ?? input.key, amount, cost, badge: badgeOf(input),
      sources: input.sources.map((s) => sourceText(s, names)), ...stockOf(input.have),
      canExpand: input.leafClass !== undefined && EXPANDABLE.has(input.leafClass), isStop: input.leafClass === 'stop',
    };
    const unlock = unlocks.get(input.key);
    if (unlock !== undefined) row.unlock = unlock;
    return row;
  });
}
