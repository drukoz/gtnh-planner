// Project ops (architecture §6.4): the only way a project changes. The server (ProjectStore) and every open tab
// (live sync) run this same pure code, so applying an op is deterministic and never mutates its input, and
// applying the same op again with the same `by` and `at` changes nothing but `rev`.
// Pure TypeScript shared by server and browser: nothing from node:* may be imported here.

import {
  defaultFarmSettings, FARM_KINDS, FERTILIZER_CHOICES, TGS_MODE_ORDER, TOOL_MATERIALS, type CropStats, type FarmSettings,
} from '../types/farm.ts';
import {
  DEFAULT_BUILD_HORIZON_HOURS, DEFAULT_EXCLUDED_CATEGORIES, DEFAULT_OBJECTIVE, DEFAULT_RAW_CAP, DEFAULT_STEP_CHARGE, LogisticsMode,
  PLAN_OBJECTIVES, STEP_CHARGE_BEFORE_V3, type PlanObjective, type PlanSettings,
} from '../types/plan.ts';
import type { Note, Project, ProjectOp } from '../types/project.ts';

export const MAX_NOTE_LENGTH = 4000;
export const MAX_NAME_LENGTH = 80;
/** Entries of `PlanSettings.avoid`, and the characters of each. */
export const MAX_AVOID_ENTRIES = 50;
export const MAX_AVOID_ENTRY_LENGTH = 300;
/**
 * The largest `PlanSettings.stepCharge` (fix spec §3): a step must then save half the line's least raw material, or with
 * build cost counted a new machine block costs half of it over the horizon ("Fewest machines", the default).
 */
export const MAX_STEP_CHARGE = 0.5;
/** The largest `PlanSettings.rawCap` (fix wave 3 (A)): ten times the leanest line's raw material on top of it. */
export const MAX_RAW_CAP = 10;
/** The longest `PlanSettings.buildHorizonHours` (architecture §11.39): a year of running. */
export const MAX_BUILD_HORIZON_HOURS = 8760;
/** Characters of a pinned option (`PlanSettings.optionChoice` values, fix spec §3). */
export const MAX_OPTION_KEY_LENGTH = 300;
/** `<recipe id>#<Ingredient.slot>`: the keys of `PlanSettings.optionChoice` (fix spec §3). */
const OPTION_SLOT = /^[^#]{1,100}#\d{1,4}$/;
/** Entries of `PlanSettings.ownedManual` ("Machines we have", architecture §11.29), and the machines one may count. */
export const MAX_OWNED_MANUAL_ENTRIES = 200;
export const MAX_OWNED_MANUAL_COUNT = 10_000;
/**
 * Farms the group already runs (`FarmSettings.running`, add-on 17), the outputs one lists, and the most one output gives
 * a minute.
 */
export const MAX_RUNNING_FARMS = 20;
export const MAX_FARM_OUTPUTS = 10;
export const MAX_FARM_PER_MINUTE = 1e6;
/**
 * Layers of crop sticks under one Crop Manager (`FarmSettings.crops.layers`): a layer is a soil block with crop sticks on
 * it, two blocks high, and a Crop Manager reaches 2 blocks up and down, so 3 fit.
 */
export const MAX_CROP_LAYERS = 3;
/** Crop Managers exist for LV to UMV only (mteIds 28001–28012). */
export const MAX_CROP_MANAGER_TIER = 12;
/** A crop seed's growth, gain and resistance (farms.md §2.2). */
export const MAX_CROP_STAT = 31;
/** The crop's liked biome tags the farm's biome may have (`FarmSettings.crops.likedTags`). */
export const MAX_LIKED_TAGS = 2;
/** Keys of "Only these come in" (`PlanSettings.inputsOnly`, plan 12 fix wave 3 (B)). */
export const MAX_INPUTS_ONLY = 50;

const MAX_TIER = 14;
const MAX_AMOUNT = 1e9;
const MAX_COIL_HEAT = 100_000;
const MAX_TARGET_LENGTH = 300;
const MAX_RECIPE_ID_LENGTH = 100;
const MAX_NOTE_ID_LENGTH = 64;
const MAX_WORLD_ID_LENGTH = 100;
const MARK_ROW = /^(build|run|step):.{1,300}$/;
const ROTATIONS: readonly unknown[] = [0, 90, 180, 270];
const LOGISTICS_MODES: readonly unknown[] = Object.values(LogisticsMode);
/** `PlanSettings.multiblocks`'s values (the user's ruling 224). */
const MULTIBLOCK_CHOICES: readonly unknown[] = ['allow', 'only-required'] satisfies ReadonlyArray<NonNullable<PlanSettings['multiblocks']>>;

/**
 * The version of the defaults new settings are made under (`PlanSettings.settingsVersion`, architecture §11.32): 2 since
 * supporting lines (`routeDerived: true`) became the default (plan 09), 3 since "Fewest machines" (`DEFAULT_STEP_CHARGE`
 * 0.5) did (plan 12 fix wave 2, the user's answer of 2026-10-20), 4 since the raw cap (`DEFAULT_RAW_CAP`, fix wave 3 (A),
 * the user's answer of 2026-10-22). Settings stored before 2 read as version 1.
 */
export const SETTINGS_VERSION = 4;
/** What `normalizeSettings` gives settings stored before `settingsVersion` existed. */
const FIRST_SETTINGS_VERSION = 1;
/** What `normalizeSettings` gives settings stored before `objective` existed (add-on 17): add-on 12 planned them cheapest. */
const FIRST_OBJECTIVE: PlanObjective = 'cheapest';

export function defaultSettings(): PlanSettings {
  return {
    target: null, mode: 'rate', amount: 1, per: 'min', tier: null, dims: { policy: 'progression', overrides: {} },
    routeDerived: true, logistics: 'direct', costOverrides: {}, stopItems: [], expandItems: [], recipeChoice: {},
    machineTier: {}, excludedCategories: [...DEFAULT_EXCLUDED_CATEGORIES], coilHeat: null, automateCrafting: true,
    avoid: [], declineReuse: [], settingsVersion: SETTINGS_VERSION, haveSupply: [], stepCharge: DEFAULT_STEP_CHARGE,
    optionChoice: {}, reuseOwned: true, ownedManual: [], buildHorizonHours: DEFAULT_BUILD_HORIZON_HOURS, buildTier: null, multiblocks: 'allow',
    objective: DEFAULT_OBJECTIVE, farms: defaultFarmSettings(), useSurplus: true,
    rawCap: DEFAULT_RAW_CAP,
    inputsOnly: [],
  };
}

/**
 * Fills the fields an older stored project lacks (later plans add settings), `dims` and `farms` field by field, and drops
 * repeated avoid entries and sums repeated machines of the "Machines we have" list. A missing `settingsVersion` is 1, not
 * the default: the project was stored before it, and the server switches such projects to the new defaults once
 * (`ProjectStore.migrateSettings`); every stored value, a stored `routeDerived: false` or `buildHorizonHours: null`
 * ("Ignore build cost") among them, is kept — but `automateCrafting`, which reads true whatever was stored (the user's
 * ruling 180 of 2026-10-20: crafting steps are automatic, with no switch for them), so a project stored "by hand" plans
 * its crafting on Auto Workbenches at once, with no recorded change. `planLine` still plans an explicit false by hand.
 * The planning mode (add-on 17) is the stored one, or cheapest for a project stored before it, except that a rate
 * project with a null horizon plans least raw material whatever was stored beside it, as the planner reads it (add-on
 * 12's "Ignore build cost"); farms and other projects' surplus are on unless stored off.
 */
export function normalizeSettings(s: Partial<PlanSettings> | undefined): PlanSettings {
  const defaults = defaultSettings();
  const merged = { ...defaults, ...definedOnly(s ?? {}) };
  merged.dims = { ...defaults.dims, ...definedOnly(s?.dims ?? {}) };
  merged.farms = filledFarms(s?.farms);
  merged.avoid = withoutRepeats(merged.avoid);
  merged.inputsOnly = withoutRepeats(merged.inputsOnly ?? []);
  merged.ownedManual = summedOwned(merged.ownedManual ?? []);
  merged.automateCrafting = true;
  if (s?.settingsVersion === undefined) merged.settingsVersion = FIRST_SETTINGS_VERSION;
  if (s?.objective === undefined) merged.objective = FIRST_OBJECTIVE;
  if (merged.mode === 'rate' && merged.buildHorizonHours === null) merged.objective = 'least-raw';
  return merged;
}

/**
 * Stored farm settings over `defaultFarmSettings()`, field by field at every depth (as `dims`): farm settings stored with
 * fewer fields keep their own and get the defaults of the rest.
 */
function filledFarms(stored: Partial<FarmSettings> | undefined): FarmSettings {
  const d = defaultFarmSettings();
  const f: Partial<FarmSettings> = definedOnly(stored ?? {});
  const tgs: Partial<FarmSettings['tgs']> = definedOnly(f.tgs ?? {});
  const crops: Partial<FarmSettings['crops']> = definedOnly(f.crops ?? {});
  return {
    ...d, ...f,
    tgs: { ...d.tgs, ...tgs, tools: { ...d.tgs.tools, ...definedOnly(tgs.tools ?? {}) } },
    crops: { ...d.crops, ...crops, stats: { ...d.crops.stats, ...definedOnly(crops.stats ?? {}) } },
  };
}

/**
 * `{ ...before, ...patch }` with the planning-mode rules of a settings patch (add-on 17, architecture §11.45 (1)), in this
 * order: (1) a patch that sets a null horizon ("Ignore build cost", a stale tab) and names no mode plans least raw;
 * (2) one that sets a horizon and names no mode on a least-raw project plans cheapest (a stale tab that picks a horizon);
 * (3) a result planning cheapest or best multi-output with a null horizon counts build cost against the default
 * `DEFAULT_BUILD_HORIZON_HOURS`. A settings op and a new project's settings (`ProjectStore.create`) take them; never
 * changes its inputs.
 */
export function withObjectiveRules(before: PlanSettings, patch: Partial<PlanSettings>): PlanSettings {
  const after: PlanSettings = { ...before, ...patch };
  if (patch.objective === undefined && patch.buildHorizonHours !== undefined) {
    if (patch.buildHorizonHours === null) after.objective = 'least-raw';           // (1)
    else if (before.objective === 'least-raw') after.objective = 'cheapest';      // (2)
  }
  if ((after.objective === 'cheapest' || after.objective === 'multi-output') && after.buildHorizonHours === null) {   // (3)
    after.buildHorizonHours = DEFAULT_BUILD_HORIZON_HOURS;
  }
  return after;
}

/** `list` with each value only where it first appears. */
function withoutRepeats(list: readonly string[]): string[] {
  return [...new Set(list)];
}

/**
 * A "Machines we have" list with one entry per mteId, where it first appears, holding the counts of its repeats added up
 * (at most `MAX_OWNED_MANUAL_COUNT`, ruling P22); each entry keeps only its id and count.
 */
function summedOwned(list: NonNullable<PlanSettings['ownedManual']>): NonNullable<PlanSettings['ownedManual']> {
  const counts = new Map<number, number>();
  for (const { mteId, count } of list) counts.set(mteId, Math.min(MAX_OWNED_MANUAL_COUNT, (counts.get(mteId) ?? 0) + count));
  return [...counts].map(([mteId, count]) => ({ mteId, count }));
}

/**
 * The settings patch that brings `s` (as `normalizeSettings` reads it) from its `settingsVersion` to `SETTINGS_VERSION`
 * (`ProjectStore.migrateSettings` records it once, as the planner): from before 2, supporting lines on (plan 09); from
 * before 3, a step charge of exactly the old default (`STEP_CHARGE_BEFORE_V3`, 0.02) becomes the new one (0.5, "Fewest
 * machines"), any other stored value staying; from before 4, the raw cap at its default (`DEFAULT_RAW_CAP`, fix wave 3
 * (A)) where none is stored; and the version. Null for settings of this version, which it never touches, so a later
 * deliberate value (a 2 % step charge, "No limit") sticks.
 */
export function settingsUpgrade(s: PlanSettings): Partial<PlanSettings> | null {
  const from = s.settingsVersion ?? FIRST_SETTINGS_VERSION;
  if (from >= SETTINGS_VERSION) return null;
  const patch: Partial<PlanSettings> = {};
  if (from < 2) patch.routeDerived = true;
  if (from < 3 && s.stepCharge === STEP_CHARGE_BEFORE_V3) patch.stepCharge = DEFAULT_STEP_CHARGE;
  if (from < 4) patch.rawCap = s.rawCap === undefined ? DEFAULT_RAW_CAP : s.rawCap;
  patch.settingsVersion = SETTINGS_VERSION;
  return patch;
}

/** A copy without the keys whose value is `undefined`, so spreading it never blanks a default. */
function definedOnly<T extends object>(o: T): Partial<T> {
  return Object.fromEntries(Object.entries(o).filter(([, v]) => v !== undefined)) as Partial<T>;
}

/** Pure: returns a new project with `rev + 1`; `by` and `at` record who made a tick or note and when. */
export function applyOp(p: Project, op: ProjectOp, by: string, at: string): Project {
  const next: Project = { ...p, rev: p.rev + 1 };
  switch (op.op) {
    case 'rename':
      return { ...next, name: op.name.trim() };
    case 'settings': {
      // Records and arrays in the patch replace the old value whole (farm settings too); the planning mode and the build
      // horizon follow `withObjectiveRules`; an avoid list keeps the first of repeated entries, and the "Machines we have"
      // list sums the counts of a repeated machine.
      const settings = withObjectiveRules(p.settings, op.patch);
      if (op.patch.avoid !== undefined) settings.avoid = withoutRepeats(op.patch.avoid);
      if (op.patch.inputsOnly !== undefined) settings.inputsOnly = withoutRepeats(op.patch.inputsOnly);
      if (op.patch.ownedManual !== undefined) settings.ownedManual = summedOwned(op.patch.ownedManual);
      return { ...next, settings };
    }
    case 'mark': {
      const marks = { ...p.marks };
      if (op.on) marks[op.row] = { by, at };
      else delete marks[op.row];
      return { ...next, marks };
    }
    case 'addNote': {
      const { id, text, pin } = op.note;
      const existing = p.notes.find((n) => n.id === id);
      // A retried addNote replaces text and pin of the note it already made; author and time stay.
      const note: Note = { id, text, by: existing?.by ?? by, at: existing?.at ?? at };
      if (pin !== undefined) note.pin = { dim: pin.dim, x: pin.x, y: pin.y, z: pin.z };
      return { ...next, notes: existing ? p.notes.map((n) => (n.id === id ? note : n)) : [...p.notes, note] };
    }
    case 'editNote':
      return { ...next, notes: p.notes.map((n) => (n.id === op.id ? { ...n, text: op.text } : n)) };
    case 'deleteNote':
      return { ...next, notes: p.notes.filter((n) => n.id !== op.id) };
    case 'world':
      return { ...next, world: { scanId: op.scanId, baseId: op.baseId } };
    case 'placement':
      return { ...next, placement: { origin: [op.origin[0], op.origin[1], op.origin[2]], rotation: op.rotation } };
    case 'clearPlacement':
      return { ...next, placement: null };
    default:
      return unknownOp(op);
  }
}

function unknownOp(op: never): never {
  throw new TypeError(`unknown project op ${JSON.stringify((op as { op?: unknown }).op)}`);
}

type Check = (value: unknown) => string | null;

const isRecord = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);
const isTier = (v: unknown): boolean => Number.isInteger(v) && (v as number) >= 0 && (v as number) <= MAX_TIER;
const isStringOfLength = (v: unknown, min: number, max: number): v is string =>
  typeof v === 'string' && v.length >= min && v.length <= max;
/** An item or fluid key as a setting names one (`target`, a running farm's output). */
const isKeyText = (v: unknown): v is string => isStringOfLength(v, 1, MAX_TARGET_LENGTH);

function oneOf(field: string, allowed: readonly unknown[]): Check {
  return (v) => (allowed.includes(v) ? null : `${field} must be one of ${allowed.map((a) => JSON.stringify(a)).join(', ')}`);
}

/** As `oneOf`, naming the allowed words plainly: "objective must be one of least-raw, cheapest, multi-output". */
function oneOfNames(field: string, allowed: readonly string[]): Check {
  return (v) => ((allowed as readonly unknown[]).includes(v) ? null : `${field} must be one of ${allowed.join(', ')}`);
}

function wholeNumber(field: string, min: number, max: number): Check {
  return (v) => (Number.isInteger(v) && (v as number) >= min && (v as number) <= max ? null : `${field} must be a whole number from ${min} to ${max}`);
}

function booleanField(field: string): Check {
  return (v) => (typeof v === 'boolean' ? null : `${field} must be true or false`);
}

function stringList(field: string): Check {
  return (v) => (Array.isArray(v) && v.every((x) => typeof x === 'string') ? null : `${field} must be a list of strings`);
}

/** Every record value must pass `ok`. */
function recordOf(field: string, ok: (v: unknown) => boolean, what: string): Check {
  return (v) => (isRecord(v) && Object.values(v).every(ok) ? null : `${field} values must be ${what}`);
}

/** One entry of the "Machines we have" list: a machine id of 0 or more and a whole count from 1 to the most one may count. */
function isOwnedEntry(v: unknown): boolean {
  return isRecord(v) && Number.isSafeInteger(v.mteId) && (v.mteId as number) >= 0
    && Number.isInteger(v.count) && (v.count as number) >= 1 && (v.count as number) <= MAX_OWNED_MANUAL_COUNT;
}

/**
 * Farm settings (add-on 17) whole, as `defaultFarmSettings()` makes them: a patch's records replace the stored value
 * whole, so a patch never leaves a project with part of them.
 */
function checkFarms(v: unknown): string | null {
  if (!isRecord(v)) return 'farms must be an object';
  const known = (kind: unknown): boolean => (FARM_KINDS as readonly unknown[]).includes(kind);
  if (!Array.isArray(v.kinds) || !v.kinds.every(known) || new Set(v.kinds).size !== v.kinds.length) {
    return `farms.kinds must be a list of ${FARM_KINDS.join(', ')}, each at most once`;
  }
  return checkTreeFarm(v.tgs) ?? checkCropFarm(v.crops) ?? checkRunningFarms(v.running);
}

/** The Tree Growth Simulator: its energy hatch tier (LV and up), whether its input bus holds each mode's tool, their material. */
function checkTreeFarm(v: unknown): string | null {
  if (!isRecord(v)) return 'farms.tgs must be an object';
  const { tools } = v;
  return wholeNumber('farms.tgs.tier', 1, MAX_TIER)(v.tier)
    ?? (isRecord(tools) && TGS_MODE_ORDER.every((mode) => typeof tools[mode] === 'boolean')
      ? null : `farms.tgs.tools must be true or false for each of ${TGS_MODE_ORDER.join(', ')}`)
    ?? oneOfNames('farms.tgs.toolMaterial', TOOL_MATERIALS)(v.toolMaterial);
}

/** The Crop Manager: its tier, the seeds' stats, the layers of crop sticks, the liked biome tags, open sky and fertilizer. */
function checkCropFarm(v: unknown): string | null {
  if (!isRecord(v)) return 'farms.crops must be an object';
  const { stats } = v;
  const stat = (name: keyof CropStats): string | null => (isRecord(stats)
    ? wholeNumber(`farms.crops.stats.${name}`, 1, MAX_CROP_STAT)(stats[name]) : 'farms.crops.stats must be an object');
  return wholeNumber('farms.crops.tier', 1, MAX_CROP_MANAGER_TIER)(v.tier)
    ?? stat('growth') ?? stat('gain') ?? stat('resistance')
    ?? wholeNumber('farms.crops.layers', 1, MAX_CROP_LAYERS)(v.layers)
    ?? wholeNumber('farms.crops.likedTags', 0, MAX_LIKED_TAGS)(v.likedTags)
    ?? booleanField('farms.crops.sky')(v.sky)
    ?? oneOfNames('farms.crops.fertilizer', FERTILIZER_CHOICES)(v.fertilizer);
}

/**
 * The farms the group runs: at most `MAX_RUNNING_FARMS`, each named as a project is, listing at most `MAX_FARM_OUTPUTS`
 * goods, each with what it gives a minute (above 0 and at most `MAX_FARM_PER_MINUTE`).
 */
function checkRunningFarms(v: unknown): string | null {
  if (!Array.isArray(v) || v.length > MAX_RUNNING_FARMS) return `farms.running must be a list of at most ${MAX_RUNNING_FARMS} farms`;
  for (const farm of v) {
    if (!isRecord(farm) || !isStringOfLength(farm.name, 1, MAX_NAME_LENGTH)) return `farms.running names must be 1 to ${MAX_NAME_LENGTH} characters`;
    if (!Array.isArray(farm.outputs) || farm.outputs.length > MAX_FARM_OUTPUTS || !farm.outputs.every(isFarmOutput)) {
      return `farms.running: ${JSON.stringify(farm.name)} must list at most ${MAX_FARM_OUTPUTS} outputs, each a key of 1 to `
        + `${MAX_TARGET_LENGTH} characters with a perMinute above 0 and at most ${MAX_FARM_PER_MINUTE}`;
    }
  }
  return null;
}

function isFarmOutput(v: unknown): boolean {
  return isRecord(v) && isKeyText(v.key) && typeof v.perMinute === 'number' && Number.isFinite(v.perMinute)
    && v.perMinute > 0 && v.perMinute <= MAX_FARM_PER_MINUTE;
}

/** One check per setting; a setting added to `PlanSettings` must get its check here (and its default above). */
const SETTING_CHECKS: { readonly [K in keyof PlanSettings]-?: Check } = {
  target: (v) => (v === null || isKeyText(v) ? null : `target must be empty or 1 to ${MAX_TARGET_LENGTH} characters`),
  mode: oneOf('mode', ['rate', 'makeN']),
  amount: (v) =>
    typeof v === 'number' && Number.isFinite(v) && v > 0 && v <= MAX_AMOUNT ? null : `amount must be above 0 and at most ${MAX_AMOUNT}`,
  per: oneOf('per', ['min', 'hour']),
  tier: (v) => (v === null || isTier(v) ? null : `tier must be empty or a whole number from 0 to ${MAX_TIER}`),
  dims: (v) => {
    if (!isRecord(v)) return 'dims must be an object';
    return oneOf('dims.policy', ['progression', 'visited'])(v.policy)
      ?? recordOf('dims.overrides', (x) => x === 'on' || x === 'off', '"on" or "off"')(v.overrides);
  },
  routeDerived: booleanField('routeDerived'),
  logistics: oneOf('logistics', LOGISTICS_MODES),
  costOverrides: recordOf('costOverrides', (x) => typeof x === 'number' && Number.isFinite(x) && x >= 0, 'numbers of 0 or more'),
  stopItems: stringList('stopItems'),
  expandItems: stringList('expandItems'),
  recipeChoice: recordOf('recipeChoice', (x) => isStringOfLength(x, 1, MAX_RECIPE_ID_LENGTH), `recipe ids of 1 to ${MAX_RECIPE_ID_LENGTH} characters`),
  machineTier: recordOf('machineTier', isTier, `whole numbers from 0 to ${MAX_TIER}`),
  excludedCategories: stringList('excludedCategories'),
  coilHeat: (v) =>
    v === null || (Number.isInteger(v) && (v as number) >= 0 && (v as number) <= MAX_COIL_HEAT)
      ? null : `coilHeat must be empty or a whole number from 0 to ${MAX_COIL_HEAT}`,
  automateCrafting: booleanField('automateCrafting'),
  // Counted as sent, repeats included: applyOp drops the repeats.
  avoid: (v) => (Array.isArray(v) && v.length <= MAX_AVOID_ENTRIES && v.every((x) => isStringOfLength(x, 1, MAX_AVOID_ENTRY_LENGTH))
    ? null : `avoid must be a list of at most ${MAX_AVOID_ENTRIES} entries of 1 to ${MAX_AVOID_ENTRY_LENGTH} characters`),
  declineReuse: (v) => (Array.isArray(v) && v.every((x) => Number.isSafeInteger(x)) ? null : 'declineReuse must be a list of whole numbers'),
  // Never back below the current version: a project switched to the new defaults stays switched.
  settingsVersion: (v) => (Number.isSafeInteger(v) && (v as number) >= SETTINGS_VERSION
    ? null : `settingsVersion must be a whole number of at least ${SETTINGS_VERSION}`),
  // Keys of free inputs; one that is no free input is kept and has no effect (fix spec §3).
  haveSupply: stringList('haveSupply'),
  stepCharge: (v) => (typeof v === 'number' && Number.isFinite(v) && v >= 0 && v <= MAX_STEP_CHARGE
    ? null : `stepCharge must be a number from 0 to ${MAX_STEP_CHARGE}`),
  // A pin the pack no longer fits is kept and ignored with a warning (fix spec R9); only its shape is checked here.
  optionChoice: (v) => (isRecord(v) && Object.entries(v).every(([slot, key]) => OPTION_SLOT.test(slot) && isStringOfLength(key, 1, MAX_OPTION_KEY_LENGTH))
    ? null : `optionChoice keys must look like <recipe id>#<slot>, with options of 1 to ${MAX_OPTION_KEY_LENGTH} characters`),
  reuseOwned: booleanField('reuseOwned'),
  // Counted as sent, repeats included: applyOp sums the counts of a repeated machine.
  ownedManual: (v) => (Array.isArray(v) && v.length <= MAX_OWNED_MANUAL_ENTRIES && v.every(isOwnedEntry)
    ? null : `ownedManual must be a list of at most ${MAX_OWNED_MANUAL_ENTRIES} machines, each an mteId of 0 or more with a whole count from 1 to ${MAX_OWNED_MANUAL_COUNT}`),
  // null = ignore build cost (rate mode).
  buildHorizonHours: (v) => (v === null || (typeof v === 'number' && Number.isFinite(v) && v > 0 && v <= MAX_BUILD_HORIZON_HOURS)
    ? null : `buildHorizonHours must be empty or above 0 and at most ${MAX_BUILD_HORIZON_HOURS}`),
  // null = the cheapest tier; a tier above the project's is kept and clamped by the planner.
  buildTier: (v) => (v === null || (isTier(v) && (v as number) >= 1) ? null : `buildTier must be empty or a whole number from 1 to ${MAX_TIER}`),
  multiblocks: oneOf('multiblocks', MULTIBLOCK_CHOICES),
  objective: oneOfNames('objective', PLAN_OBJECTIVES),
  farms: checkFarms,
  useSurplus: booleanField('useSurplus'),
  // null = no limit (fix wave 3 (A)).
  rawCap: (v) => (v === null || (typeof v === 'number' && Number.isFinite(v) && v >= 0 && v <= MAX_RAW_CAP)
    ? null : `rawCap must be empty or a number from 0 to ${MAX_RAW_CAP}`),
  // Counted as sent, repeats included: applyOp drops the repeats.
  inputsOnly: (v) => (Array.isArray(v) && v.length <= MAX_INPUTS_ONLY && v.every((x) => isStringOfLength(x, 1, MAX_TARGET_LENGTH))
    ? null : `inputsOnly must be a list of at most ${MAX_INPUTS_ONLY} keys of 1 to ${MAX_TARGET_LENGTH} characters`),
};

const SETTING_KEYS: ReadonlySet<string> = new Set(Object.keys(defaultSettings()));

function checkSettingsPatch(patch: unknown): string | null {
  if (!isRecord(patch)) return 'settings patch must be an object';
  for (const [key, value] of Object.entries(patch)) {
    if (!SETTING_KEYS.has(key)) return `unknown setting ${JSON.stringify(key)}`;
    const problem = SETTING_CHECKS[key as keyof PlanSettings](value);
    if (problem !== null) return problem;
  }
  // Only the patch's own mode is known here; ProjectStore.apply re-checks against the resulting settings.
  if (patch.mode === 'makeN' && 'amount' in patch && !Number.isInteger(patch.amount)) {
    return 'amount must be an integer in Make N mode';
  }
  return null;
}

function checkNoteId(id: unknown): string | null {
  return isStringOfLength(id, 1, MAX_NOTE_ID_LENGTH) ? null : `note id must be 1 to ${MAX_NOTE_ID_LENGTH} characters`;
}

function checkNoteText(text: unknown): string | null {
  return isStringOfLength(text, 1, MAX_NOTE_LENGTH) ? null : `note text must be 1 to ${MAX_NOTE_LENGTH} characters`;
}

function checkPin(pin: unknown): string | null {
  if (pin === undefined) return null;
  if (!isRecord(pin) || ![pin.dim, pin.x, pin.y, pin.z].every((c) => Number.isInteger(c))) {
    return 'note pin must have whole-number dim, x, y and z';
  }
  return null;
}

function checkWorldId(field: string, id: unknown): string | null {
  return id === null || isStringOfLength(id, 0, MAX_WORLD_ID_LENGTH) ? null : `${field} must be empty or at most ${MAX_WORLD_ID_LENGTH} characters`;
}

/** `null` when `op` is a well-formed ProjectOp, else a short English reason (shown to the sender). */
export function validateOp(op: unknown): string | null {
  if (!isRecord(op)) return 'op must be an object';
  switch (op.op) {
    case 'rename': {
      const name = typeof op.name === 'string' ? op.name.trim() : '';
      return name.length >= 1 && name.length <= MAX_NAME_LENGTH ? null : `name must be 1 to ${MAX_NAME_LENGTH} characters`;
    }
    case 'settings':
      return checkSettingsPatch(op.patch);
    case 'mark':
      if (typeof op.row !== 'string' || !MARK_ROW.test(op.row)) return 'mark row must look like build:<key>, run:<key> or step:<id>';
      return typeof op.on === 'boolean' ? null : 'mark on must be true or false';
    case 'addNote':
      if (!isRecord(op.note)) return 'note must be an object';
      return checkNoteId(op.note.id) ?? checkNoteText(op.note.text) ?? checkPin(op.note.pin);
    case 'editNote':
      return checkNoteId(op.id) ?? checkNoteText(op.text);
    case 'deleteNote':
      return checkNoteId(op.id);
    case 'world':
      return checkWorldId('scanId', op.scanId) ?? checkWorldId('baseId', op.baseId);
    case 'placement':
      if (!Array.isArray(op.origin) || op.origin.length !== 3 || !op.origin.every((c) => Number.isInteger(c))) {
        return 'placement origin must be three whole numbers';
      }
      return ROTATIONS.includes(op.rotation) ? null : 'placement rotation must be 0, 90, 180 or 270';
    case 'clearPlacement':
      return null;
    default:
      return typeof op.op === 'string' ? `unknown op ${JSON.stringify(op.op)}` : 'op is missing';
  }
}
