// What the settings panel shows and sends (spec §3.2–§3.3b, §3.6), as pure functions: the reachable-dimension rows
// and their labels, the patches the panel sends (each a whole field value, so one `settings` op says everything), and
// the checks an amount or a cost must pass before anything is sent.

import { TIER_NAMES, tierName } from '../../shared/gt/tiers.ts';
import type { PackInfo } from '../../shared/types/api.ts';
import type { Plan, PlanSettings, ReachableDim } from '../../shared/types/plan.ts';

export interface DimRow { key: string; name: string; group: string; state: 'auto' | 'on' | 'off'; reachable: boolean; label: string }

/** The highest amount a project accepts (validateOp's limit). */
const MAX_AMOUNT = 1e9;
const OVERWORLD = 'overworld';
const NO_ROCKET = 'No rocket';
const CAPABILITIES = 'Capabilities';

/** The recipe groups `excludedCategories` can skip (Task 7's EXCLUSION_RULES), in words. */
export const EXCLUSION_LABELS: Record<string, string> = {
  recycling: 'Recycling',
  massfab: 'Mass fabricator',
  replicator: 'Replicator',
  scrap: 'Scrap and recycler',
  'lava-centrifuge': 'Lava and stone-dust centrifuging',
  'programmed-circuit-conversion': 'Programmed circuit back into circuits',
};

function byString(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0;
}

/** A tier's name; a tier outside 0..14 (a hand-edited table) shows as its number instead of breaking the panel. */
function tierText(t: number): string {
  return Number.isInteger(t) && t >= 0 && t < TIER_NAMES.length ? tierName(t) : `tier ${t}`;
}

function rowLabel(key: string, state: DimRow['state'], why: ReachableDim['why'] | undefined, tier: number, rocketTier?: number): string {
  if (state === 'off') return 'turned off';
  if (key === OVERWORLD) return 'always';
  if (state === 'on' || why === 'override') return 'turned on';
  if (why === 'visited') return 'visited';
  if (why === 'progression') return `assumed by progression (${tierText(tier)})`;
  const rocket = rocketTier !== undefined && rocketTier > 0 ? `, T${rocketTier} rocket` : '';
  return `not yet — assumed from ${tierText(tier)}${rocket}`;
}

/**
 * One row per dimension (by `defaultTier`, then name) and then one per capability (by `minTier`, then name), with
 * the project's override, whether the current plan counts it as reachable and why, in words.
 */
export function dimRows(info: PackInfo, settings: PlanSettings, plan: Plan | null): DimRow[] {
  const overrides = settings.dims.overrides;
  const stateOf = (key: string): DimRow['state'] => (Object.hasOwn(overrides, key) ? overrides[key]! : 'auto');
  const why = new Map((plan?.reachable ?? []).map((r) => [r.key, r.why]));
  const ordered = <T extends { name: string; key: string }>(list: readonly T[], tierOf: (x: T) => number): T[] =>
    [...list].sort((a, b) => tierOf(a) - tierOf(b) || byString(a.name, b.name) || byString(a.key, b.key));

  const dims = ordered(info.dimensions, (d) => d.defaultTier).map((d): DimRow => {
    const state = stateOf(d.key);
    return {
      key: d.key, name: d.name, state, reachable: why.has(d.key),
      group: d.rocketTier !== undefined && d.rocketTier > 0 ? `T${d.rocketTier} rocket` : NO_ROCKET,
      label: rowLabel(d.key, state, why.get(d.key), d.defaultTier, d.rocketTier),
    };
  });
  const capabilities = ordered(info.capabilities, (c) => c.minTier).map((c): DimRow => {
    const state = stateOf(c.key);
    return { key: c.key, name: c.name, group: CAPABILITIES, state, reachable: why.has(c.key), label: rowLabel(c.key, state, why.get(c.key), c.minTier) };
  });
  return [...dims, ...capabilities];
}

/** Where a group sits in the panel: no rocket first, then by rocket tier, capabilities last. */
function groupRank(group: string): number {
  if (group === NO_ROCKET) return 0;
  if (group === CAPABILITIES) return Number.POSITIVE_INFINITY;
  return Number.parseInt(group.slice(1), 10) || 0;
}

/** The rows of `dimRows` under their group headings, each group keeping its rows' order. */
export function groupDimRows(rows: readonly DimRow[]): Array<{ group: string; rows: DimRow[] }> {
  const groups = new Map<string, DimRow[]>();
  for (const row of rows) {
    const list = groups.get(row.group);
    if (list === undefined) groups.set(row.group, [row]);
    else list.push(row);
  }
  return [...groups].map(([group, list]) => ({ group, rows: list })).sort((a, b) => groupRank(a.group) - groupRank(b.group));
}

/** The whole `dims` value with one override changed; `auto` removes the override. */
export function dimOverridePatch(settings: PlanSettings, key: string, state: 'auto' | 'on' | 'off'): Partial<PlanSettings> {
  const overrides = { ...settings.dims.overrides };
  if (state === 'auto') delete overrides[key];
  else overrides[key] = state;
  return { dims: { ...settings.dims, overrides } };
}

/** `list` with `value` added (`on`) or removed, sorted and without repeats. */
export function toggleList(list: readonly string[], value: string, on: boolean): string[] {
  const set = new Set(list);
  if (on) set.add(value);
  else set.delete(value);
  return [...set].sort(byString);
}

/** The amount typed into the Make section, or why it cannot be sent. */
export function parseAmount(text: string, mode: 'rate' | 'makeN'): { amount: number } | { error: string } {
  const trimmed = text.trim();
  const amount = trimmed === '' ? Number.NaN : Number(trimmed);
  if (!Number.isFinite(amount) || amount <= 0 || amount > MAX_AMOUNT) return { error: 'Enter a number above 0' };
  if (mode === 'makeN' && !Number.isInteger(amount)) return { error: 'Make N needs a whole number' };
  return { amount };
}

/** A material cost typed into the Material costs table, or why it cannot be sent (validateOp takes 0 or more). */
export function parseCost(text: string): { cost: number } | { error: string } {
  const trimmed = text.trim();
  const cost = trimmed === '' ? Number.NaN : Number(trimmed);
  return Number.isFinite(cost) && cost >= 0 ? { cost } : { error: 'Enter a cost of 0 or more' };
}
