// GregTech overclocking (gt-mechanics §2, §6.4): a port of the non-laser path of
// gregtech.api.util.OverclockCalculator at GT5-Unofficial 5.09.54.183, plus how singleblocks and
// multiblocks set it up. Pure TypeScript shared by server and browser: nothing from node:* may be
// imported here.

import { V } from './tiers.ts';

/** Recipe EU/t per tier ("voltage practical", GTValues.VP): floor(V[t] × 30 / 32), so ULV 7, LV 30, MV 120, ... */
export const VP: readonly number[] = V.map((volts) => Math.floor((volts * 30) / 32));

const HEAT_OVERCLOCK_THRESHOLD = 1800; // K above the recipe per perfect (heat) overclock
const HEAT_DISCOUNT_THRESHOLD = 900; // K above the recipe per EU discount step
const HEAT_DISCOUNT_EXPONENT = 0.95; // EU multiplier per discount step
const DURATION_DECREASE_PER_HEAT_OC = 4;

/** Java's integer division (truncates toward zero), exact for integers up to 2^53 where `a / b` could round up. */
function idiv(a: number, b: number): number {
  return (a - (a % b)) / b;
}

/** GTUtility.log4: floor(log4(a)), 0 for a ≤ 1. A Java long never reaches 4^32, so the result is at most 31. */
export function log4(a: number): number {
  let n = 0;
  for (let p = 4; p <= a && n < 31; p *= 4) n++;
  return n;
}

/** GTUtility.log4ceil: the smallest n with 4^n ≥ a, 0 for a ≤ 1 (at most 32, as for a Java long). */
export function log4ceil(a: number): number {
  let n = 0;
  for (let p = 1; p < a && n < 32; p *= 4) n++;
  return n;
}

/** GTUtility.powInt: base^exp for an integer exponent by squaring, in Java's multiplication order. */
export function powInt(base: number, exp: number): number {
  return exp < 0 ? 1 / powBySquaring(base, -exp) : powBySquaring(base, exp);
}

function powBySquaring(base: number, exp: number): number {
  let result = 1;
  for (let b = base, e = exp; e > 0; e >>= 1) {
    if ((e & 1) === 1) result *= b;
    b *= b;
  }
  return result;
}

/** GTUtility.getTier: the smallest tier t with V[t] ≥ v; 0 for v ≤ 8 and 15 above MAX. */
export function voltageTier(v: number): number {
  const tier = V.findIndex((volts) => volts >= v);
  return tier === -1 ? V.length : tier;
}

export interface OcInput {
  recipeEUt: number;
  duration: number;
  machineVoltage: number;
  /** Machine amperage; default 1. */
  amperage?: number;
  /** Default 1. */
  parallel?: number;
  /** The parallels actually running; when given, `parallel = min(parallel, currentParallel)`. */
  currentParallel?: number;
  /** Multiblock amperage OC (all amps drive overclocks, no voltage-tier cap); default false. */
  amperageOC?: boolean;
  perfectOC?: boolean;
  /** Default 4. */
  eutIncreasePerOC?: number;
  /** Default 2, or 4 when `perfectOC`. */
  durationDecreasePerOC?: number;
  /** Default 1. */
  durationModifier?: number;
  /** Default 1. */
  eutDiscount?: number;
  heatOC?: boolean;
  heatDiscount?: boolean;
  recipeHeat?: number;
  machineHeat?: number;
  /** Default Infinity. */
  maxOverclocks?: number;
  noOverclock?: boolean;
}

export interface OcResult { euPerTick: number; durationTicks: number; overclocks: number; heatOverclocks: number }

/** OverclockCalculator.calculateOverclock with the duration before the 1-tick floor (`duration`). */
function overclock(input: OcInput): { euPerTick: number; duration: number; overclocks: number; heatOverclocks: number } {
  const {
    recipeEUt, machineVoltage, amperage = 1, amperageOC = false, perfectOC = false, eutIncreasePerOC = 4,
    durationDecreasePerOC = perfectOC ? 4 : 2, durationModifier = 1, eutDiscount = 1, heatOC = false,
    heatDiscount = false, recipeHeat = 0, machineHeat = 0, maxOverclocks = Infinity, noOverclock = false,
  } = input;
  const parallel = Math.min(input.parallel ?? 1, input.currentParallel ?? Infinity);
  let duration = input.duration * durationModifier;

  const heatDiscounts = heatDiscount ? idiv(machineHeat - recipeHeat, HEAT_DISCOUNT_THRESHOLD) : 0;
  const recipePower = recipeEUt * parallel * eutDiscount * powInt(HEAT_DISCOUNT_EXPONENT, heatDiscounts);
  const machinePower = machineVoltage * (amperageOC ? amperage : Math.min(amperage, parallel));
  // Recipes under 32 EU/t count as 32 EU/t here, so ULV recipes get no overclock in an LV machine.
  const tiersAbove = log4(idiv(Math.trunc(machinePower), Math.max(Math.ceil(recipePower), 32)));

  if (noOverclock) return { euPerTick: Math.ceil(recipePower), duration, overclocks: 0, heatOverclocks: 0 };

  let overclocks = Math.min(maxOverclocks, tiersAbove);
  if (!amperageOC) {
    // Voltage-tier cap; ULV counts as LV.
    const machineTier = Math.max(log4ceil(idiv(Math.trunc(machineVoltage), 8)), 1);
    const recipeTier = Math.max(log4ceil(idiv(Math.trunc(recipeEUt), 8)), 1);
    overclocks = Math.min(overclocks, machineTier - recipeTier);
  }
  overclocks = Math.max(overclocks, 0);

  const heatOverclocks = Math.min(heatOC ? idiv(machineHeat - recipeHeat, HEAT_OVERCLOCK_THRESHOLD) : 0, overclocks);
  const regularOverclocks = overclocks - heatOverclocks;
  const euPerTick = Math.ceil(recipePower * powInt(eutIncreasePerOC, overclocks));
  duration /= powInt(DURATION_DECREASE_PER_HEAT_OC, heatOverclocks);
  duration /= powInt(durationDecreasePerOC, regularOverclocks);
  return { euPerTick, duration, overclocks, heatOverclocks };
}

/**
 * The overclocked EU/t and duration. The duration is floored and at least 1 tick, and overclocking does
 * not stop at 1 tick: EU/t keeps growing. With `noOverclock` the base values are returned, rounded up.
 */
export function calculateOverclock(input: OcInput): OcResult {
  const { euPerTick, duration, overclocks, heatOverclocks } = overclock(input);
  const durationTicks = input.noOverclock === true ? Math.ceil(duration) : Math.trunc(Math.max(duration, 1));
  return { euPerTick, durationTicks, overclocks, heatOverclocks };
}

/**
 * The speed-up lost below 1 tick, rounded up (gt-mechanics §2.3): 1 while the overclocked duration is at
 * least 1 tick, else ceil(1 / duration). Multiblocks turn it into extra parallels.
 */
export function multiplierUnderOneTick(input: OcInput): number {
  if (input.noOverclock === true) return 1;
  const { duration } = overclock(input);
  return duration > 0 && duration < 1 ? Math.ceil(1 / duration) : 1;
}

export interface MachineOc extends OcResult { machineVoltage: number; machineAmps: number; parallel: number }

/**
 * A singleblock (gt-mechanics §2.2): overclock voltage V[tier] × the machine's amps at 1 A, no amperage OC.
 * Arc furnaces (3 A) also triple the recipe EU/t; the mass fabricator (8 A) gets ×2 EU/t per OC and at
 * most tier − 1 OCs. `machineAmps` is the calculator's amperage (1), so voltage × amps is the OC power.
 */
export function singleblockOverclock(
  recipe: { euPerTick: number; durationTicks: number },
  machine: { tier: number; amps: number },
): MachineOc {
  const machineVoltage = (V[machine.tier] as number) * machine.amps;
  const massFabricator: Partial<OcInput> = machine.amps === 8 ? { eutIncreasePerOC: 2, maxOverclocks: machine.tier - 1 } : {};
  const input: OcInput = {
    recipeEUt: machine.amps === 3 ? recipe.euPerTick * 3 : recipe.euPerTick,
    duration: recipe.durationTicks,
    machineVoltage,
    amperage: 1,
    amperageOC: false,
    ...massFabricator,
  };
  return { ...calculateOverclock(input), machineVoltage, machineAmps: 1, parallel: 1 };
}

/**
 * A multiblock with `hatches` energy hatches of `hatchTier` (gt-mechanics §2.3): one hatch counts as 1 A,
 * more count all their amps (2 each); amperage OC. Heat machines (EBF family, §6.4) get heat OCs and the
 * heat discount from the coil heat (default: the usual coil at the hatch tier). `parallel` is the
 * under-one-tick multiplier.
 */
export function multiblockOverclock(
  recipe: { euPerTick: number; durationTicks: number; heat?: number },
  opts: { hatchTier: number; hatches?: number; perfectOC?: boolean; heatOC?: boolean; coilHeat?: number },
): MachineOc {
  const hatches = opts.hatches ?? 1;
  const machineVoltage = V[opts.hatchTier] as number;
  const machineAmps = hatches === 1 ? 1 : 2 * hatches;
  const heat: Partial<OcInput> = opts.heatOC === true
    ? {
      heatOC: true,
      heatDiscount: true,
      recipeHeat: recipe.heat ?? 0,
      machineHeat: ebfHeat(opts.coilHeat ?? defaultCoilHeat(opts.hatchTier), hatches * machineVoltage),
    }
    : {};
  const input: OcInput = {
    recipeEUt: recipe.euPerTick,
    duration: recipe.durationTicks,
    machineVoltage,
    amperage: machineAmps,
    amperageOC: true,
    perfectOC: opts.perfectOC === true,
    ...heat,
  };
  return { ...calculateOverclock(input), machineVoltage, machineAmps, parallel: multiplierUnderOneTick(input) };
}

/** EBF heat (gt-mechanics §6.4): coil heat + 100 K per tier of the summed hatch voltage above MV (LV gives −100). */
export function ebfHeat(coilHeat: number, summedHatchVoltage: number): number {
  return coilHeat + 100 * (voltageTier(summedHatchVoltage) - 2);
}

/** Heating coils and their heat (HeatingCoilLevel.getHeat = 1 + 900 × ordinal), lowest first. */
export const COIL_HEATS: ReadonlyArray<{ name: string; heat: number }> = [
  { name: 'Cupronickel', heat: 1801 },
  { name: 'Kanthal', heat: 2701 },
  { name: 'Nichrome', heat: 3601 },
  { name: 'TPV-Alloy', heat: 4501 },
  { name: 'HSS-G', heat: 5401 },
  { name: 'HSS-S', heat: 6301 },
  { name: 'Naquadah', heat: 7201 },
  { name: 'Naquadah Alloy', heat: 8101 },
  { name: 'Trinium', heat: 9001 },
  { name: 'Fluxed Electrum', heat: 9901 },
  { name: 'Awakened Draconium', heat: 10801 },
  { name: 'Infinity', heat: 11701 },
  { name: 'Hypogen', heat: 12601 },
  { name: 'Eternal', heat: 13501 },
];

/** The coil a group at `tier` normally has: Cupronickel up to MV, then one coil per tier (HV Kanthal … MAX Hypogen). */
export function defaultCoilHeat(tier: number): number {
  const index = Math.min(Math.max(tier, 2), V.length - 1) - 2;
  return (COIL_HEATS[index] as { heat: number }).heat;
}
