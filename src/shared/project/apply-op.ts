// Project ops (architecture §6.4): the only way a project changes. The server (ProjectStore) and every open tab
// (live sync) run this same pure code, so applying an op is deterministic and never mutates its input, and
// applying the same op again with the same `by` and `at` changes nothing but `rev`.
// Pure TypeScript shared by server and browser: nothing from node:* may be imported here.

import { DEFAULT_EXCLUDED_CATEGORIES, LogisticsMode, type PlanSettings } from '../types/plan.ts';
import type { Note, Project, ProjectOp } from '../types/project.ts';

export const MAX_NOTE_LENGTH = 4000;
export const MAX_NAME_LENGTH = 80;

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

export function defaultSettings(): PlanSettings {
  return {
    target: null, mode: 'rate', amount: 1, per: 'min', tier: null, dims: { policy: 'progression', overrides: {} },
    routeDerived: false, logistics: 'direct', costOverrides: {}, stopItems: [], expandItems: [], recipeChoice: {},
    machineTier: {}, excludedCategories: [...DEFAULT_EXCLUDED_CATEGORIES], coilHeat: null, automateCrafting: false,
    declineReuse: [],
  };
}

/** Fills the fields an older stored project lacks (later plans add settings), `dims` field by field. */
export function normalizeSettings(s: Partial<PlanSettings> | undefined): PlanSettings {
  const defaults = defaultSettings();
  const merged = { ...defaults, ...definedOnly(s ?? {}) };
  merged.dims = { ...defaults.dims, ...definedOnly(s?.dims ?? {}) };
  return merged;
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
    case 'settings':
      // Records and arrays in the patch replace the old value whole.
      return { ...next, settings: { ...p.settings, ...op.patch } };
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

function oneOf(field: string, allowed: readonly unknown[]): Check {
  return (v) => (allowed.includes(v) ? null : `${field} must be one of ${allowed.map((a) => JSON.stringify(a)).join(', ')}`);
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

/** One check per setting; a setting added to `PlanSettings` must get its check here (and its default above). */
const SETTING_CHECKS: { readonly [K in keyof PlanSettings]-?: Check } = {
  target: (v) => (v === null || isStringOfLength(v, 1, MAX_TARGET_LENGTH) ? null : `target must be empty or 1 to ${MAX_TARGET_LENGTH} characters`),
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
  declineReuse: (v) => (Array.isArray(v) && v.every((x) => Number.isSafeInteger(x)) ? null : 'declineReuse must be a list of whole numbers'),
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
