// What the settings panel shows and sends (spec §3.2–§3.3b, §3.6), as pure functions: the reachable-dimension rows
// and their labels, the patches the panel sends (each a whole field value, so one `settings` op says everything), the
// checks an amount or a cost must pass before anything is sent, the avoid list's suggestions, labels and changes, the
// "Steps vs raw material" presets (fix spec §3), the pinned ingredient options in words (fix spec §6.4) and the
// "Machines we have" list's machines, counts and changes (architecture §11.29).

import { TIER_NAMES, tierName } from '../../shared/gt/tiers.ts';
import { isFluidKey, type StuffKey } from '../../shared/keys.ts';
import { MAX_AVOID_ENTRIES, MAX_AVOID_ENTRY_LENGTH, MAX_OWNED_MANUAL_COUNT, MAX_OWNED_MANUAL_ENTRIES, MAX_STEP_CHARGE } from '../../shared/project/apply-op.ts';
import type { PackInfo } from '../../shared/types/api.ts';
import { DEFAULT_STEP_CHARGE, type Plan, type PlanSettings, type ReachableDim } from '../../shared/types/plan.ts';
import { formatNumber } from '../format.ts';

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

/** A cost override or avoid entry keyed by an item or fluid (not by a material name such as "Silver"). */
export function isStuffKey(key: string): boolean {
  return isFluidKey(key) || key.includes('@');
}

/** A material an avoid entry can name (`PackInfo.materials`): its exact name and its display name. */
export type AvoidMaterial = NonNullable<PackInfo['materials']>[number];

/** Material suggestions shown at most. */
const MAX_MATERIAL_SUGGESTIONS = 8;

/**
 * The materials whose name or display name holds `query`, ignoring case and the query's outer spaces: those equal to it
 * first, then those starting with it, then the rest, each group in the list's order; at most `limit`.
 */
export function materialSuggestions(materials: readonly AvoidMaterial[], query: string, limit = MAX_MATERIAL_SUGGESTIONS): AvoidMaterial[] {
  const q = query.trim().toLowerCase();
  if (q === '') return [];
  const rank = (m: AvoidMaterial): number => {
    const texts = [m.name.toLowerCase(), m.label.toLowerCase()];
    if (texts.includes(q)) return 0;
    if (texts.some((t) => t.startsWith(q))) return 1;
    return texts.some((t) => t.includes(q)) ? 2 : -1;
  };
  return materials.map((m) => ({ m, r: rank(m) })).filter((x) => x.r >= 0).sort((a, b) => a.r - b.r).slice(0, limit).map((x) => x.m);
}

/** The material whose name or display name is `text`, ignoring case and outer spaces. */
export function materialFor(materials: readonly AvoidMaterial[], text: string): AvoidMaterial | undefined {
  const q = text.trim().toLowerCase();
  return materials.find((m) => m.name.toLowerCase() === q || m.label.toLowerCase() === q);
}

/**
 * `avoid` with `entry` (without its outer spaces) added at the end, or null when nothing should be sent: it is empty or
 * longer than an entry may be, already listed, or the list is full (validateOp's limits).
 */
export function avoidWith(avoid: readonly string[], entry: string): string[] | null {
  const value = entry.trim();
  if (value === '' || value.length > MAX_AVOID_ENTRY_LENGTH || avoid.includes(value) || avoid.length >= MAX_AVOID_ENTRIES) return null;
  return [...avoid, value];
}

/** `avoid` without `entry`. */
export function avoidWithout(avoid: readonly string[], entry: string): string[] {
  return avoid.filter((e) => e !== entry);
}

/** What an avoid entry's chip says: a material's display name, else the item or fluid's name (`nameOf`). */
export function avoidLabel(entry: string, materials: readonly AvoidMaterial[], nameOf: (key: string) => string): string {
  return materials.find((m) => m.name === entry)?.label ?? nameOf(entry);
}

/**
 * The "Steps vs raw material" presets (fix spec §3, architecture §11.34 as entry 39 amends it): with build cost counted
 * the share of the line's least raw material over the horizon one new machine block costs, with it ignored the share
 * one recipe step must save. "Fewest machines" is the default (`DEFAULT_STEP_CHARGE`, the user's answer of 2026-10-20).
 */
export const STEP_CHARGE_PRESETS: ReadonlyArray<{ value: number; label: string }> = [
  { value: 0, label: 'Least raw material' },
  { value: 0.02, label: 'Some machines' },
  { value: 0.5, label: 'Fewest machines' },
];

/** A step charge as a percentage, as precise as it is stored: `2%`, `7%`, `2.5%`. */
function chargePercent(charge: number): string {
  return `${formatNumber(charge * 100)}%`;
}

/** The step charge a project plans with: its own, else the default (a project stored before the setting). */
export function stepChargeOf(settings: PlanSettings): number {
  return settings.stepCharge ?? DEFAULT_STEP_CHARGE;
}

/** A step charge in words: its preset's name (`Some machines`), else `Custom (7%)`. */
export function stepChargeLabel(charge: number): string {
  return STEP_CHARGE_PRESETS.find((p) => p.value === charge)?.label ?? `Custom (${chargePercent(charge)})`;
}

/** The choices of the "Steps vs raw material" select: each preset as "<name> (<n>%)", then the stored value when it is none of them. */
export function stepChargeOptions(charge: number): Array<{ value: string; label: string }> {
  const options = STEP_CHARGE_PRESETS.map((p) => ({ value: String(p.value), label: `${p.label} (${chargePercent(p.value)})` }));
  if (!STEP_CHARGE_PRESETS.some((p) => p.value === charge)) options.push({ value: String(charge), label: stepChargeLabel(charge) });
  return options;
}

/** The patch for a value picked in that select, or null for anything validateOp would refuse. */
export function stepChargePatch(value: string): Partial<PlanSettings> | null {
  const charge = value.trim() === '' ? Number.NaN : Number(value);
  return Number.isFinite(charge) && charge >= 0 && charge <= MAX_STEP_CHARGE ? { stepCharge: charge } : null;
}

/** One pinned ingredient option (`PlanSettings.optionChoice`): its key, recipe, slot, the option and the pin in words. */
export interface OptionPinRow { pin: string; recipeId: string; slot: number; option: StuffKey; label: string; optionName: string }

/**
 * The project's pinned ingredient options by key, each named by the step of the plan that runs its recipe ("Circuit
 * Assembler (Electronic Circuit): Molten Tin"), else by its recipe id and slot; a key that is no `<recipe>#<slot>` is left out.
 */
export function optionPinRows(settings: PlanSettings, plan: Plan | null, nameOf: (key: string) => string): OptionPinRow[] {
  const stepOf = new Map((plan?.steps ?? []).map((s) => [s.recipeId, s]));
  return Object.entries(settings.optionChoice ?? {}).sort(([a], [b]) => byString(a, b)).flatMap(([pin, option]): OptionPinRow[] => {
    const hash = pin.lastIndexOf('#');
    const slot = Number(pin.slice(hash + 1));
    if (hash <= 0 || !Number.isInteger(slot)) return [];
    const recipeId = pin.slice(0, hash);
    const step = stepOf.get(recipeId);
    const where = step === undefined ? `recipe ${recipeId}, slot ${slot}`
      : step.mainOutput === undefined ? step.machine.name : `${step.machine.name} (${nameOf(step.mainOutput)})`;
    const optionName = nameOf(option);
    return [{ pin, recipeId, slot, option, label: `${where}: ${optionName}`, optionName }];
  });
}

/** A machine the "Machines we have" list can name (`PackInfo.machines`). */
export type OwnableMachine = NonNullable<PackInfo['machines']>[number];
/** One entry of the "Machines we have" list (`PlanSettings.ownedManual`). */
export type OwnedEntry = NonNullable<PlanSettings['ownedManual']>[number];

const OWNED_COUNT_ERROR = `Enter a whole number from 1 to ${formatNumber(MAX_OWNED_MANUAL_COUNT)}`;
/** The add form's group of the machines without a tier of their own. */
const MULTIBLOCKS = 'Multiblocks';

/** A machine in words: its name and tier ("Basic Assembler (LV)"), a multiblock by its name, one the pack does not know by its id. */
export function ownedMachineLabel(machine: OwnableMachine | undefined, mteId: number): string {
  if (machine === undefined) return `Machine #${mteId}`;
  return machine.tier === undefined ? machine.name : `${machine.name} (${tierText(machine.tier)})`;
}

/** The machines of the add form by tier, the lowest first, then the multiblocks; each group in the list's order. */
export function ownableMachineGroups(machines: readonly OwnableMachine[]): Array<{ label: string; machines: OwnableMachine[] }> {
  const byTier = new Map<number, OwnableMachine[]>();   // multiblocks under +∞
  for (const m of machines) {
    const tier = m.tier ?? Number.POSITIVE_INFINITY;
    const list = byTier.get(tier);
    if (list === undefined) byTier.set(tier, [m]);
    else list.push(m);
  }
  return [...byTier].sort(([a], [b]) => a - b)
    .map(([tier, list]) => ({ label: Number.isFinite(tier) ? tierText(tier) : MULTIBLOCKS, machines: list }));
}

/** How many of a machine the group has, as typed into the "Machines we have" form, or why it cannot be sent. */
export function parseOwnedCount(text: string): { count: number } | { error: string } {
  const trimmed = text.trim();
  const count = /^\d+$/.test(trimmed) ? Number(trimmed) : Number.NaN;
  return count >= 1 && count <= MAX_OWNED_MANUAL_COUNT ? { count } : { error: OWNED_COUNT_ERROR };
}

/**
 * `owned` with `count` more of machine `mteId`: added to its entry (up to the most one entry may count) or at the end;
 * else why that cannot be sent (validateOp's limits).
 */
export function ownedWith(owned: readonly OwnedEntry[], mteId: number, count: number): { owned: OwnedEntry[] } | { error: string } {
  if (!Number.isInteger(count) || count < 1 || count > MAX_OWNED_MANUAL_COUNT) return { error: OWNED_COUNT_ERROR };
  const entry = owned.find((e) => e.mteId === mteId);
  if (entry === undefined) {
    return owned.length >= MAX_OWNED_MANUAL_ENTRIES
      ? { error: `The list holds at most ${MAX_OWNED_MANUAL_ENTRIES} machine types; remove one first` }
      : { owned: [...owned, { mteId, count }] };
  }
  if (entry.count >= MAX_OWNED_MANUAL_COUNT) return { error: `The list already counts ${formatNumber(MAX_OWNED_MANUAL_COUNT)} of this machine` };
  return { owned: owned.map((e) => (e === entry ? { mteId, count: Math.min(MAX_OWNED_MANUAL_COUNT, e.count + count) } : e)) };
}

/** `owned` without machine `mteId`. */
export function ownedWithout(owned: readonly OwnedEntry[], mteId: number): OwnedEntry[] {
  return owned.filter((e) => e.mteId !== mteId);
}
