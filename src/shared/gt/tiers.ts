// GregTech voltage tiers (architecture §5, §6.1). Pure TypeScript shared by server and browser:
// nothing from node:* may be imported here.

/** Tier t is the index: 0 ULV, 1 LV, 2 MV, 3 HV, 4 EV, 5 IV, 6 LuV, 7 ZPM, 8 UV, 9 UHV, 10 UEV, 11 UIV, 12 UMV, 13 UXV, 14 MAX. */
export const TIER_NAMES: readonly string[] = [
  'ULV', 'LV', 'MV', 'HV', 'EV', 'IV', 'LuV', 'ZPM', 'UV', 'UHV', 'UEV', 'UIV', 'UMV', 'UXV', 'MAX',
];

const MAX_TIER = TIER_NAMES.length - 1;

/** Voltage (EU/t) of each tier: 8·4^t up to UXV; MAX is GT's Integer.MAX_VALUE - 7. */
export const V: readonly number[] = TIER_NAMES.map((_name, t) => (t < MAX_TIER ? 8 * 4 ** t : 2147483640));

export function tierName(t: number): string {
  const name = TIER_NAMES[t]; // undefined for anything but the integers 0..14
  if (name === undefined) throw new RangeError(`tier must be an integer from 0 to ${MAX_TIER}, got ${t}`);
  return name;
}

/**
 * The tier a recipe is shown at: the smallest tier whose voltage covers the EU/t drawn per amp,
 * never below LV (1) and never above MAX (14). Zero or fewer amps count as one.
 */
export function recipeTier(euPerTick: number, amps: number): number {
  const perAmp = euPerTick / Math.max(amps, 1);
  const tier = V.findIndex((volts, t) => t >= 1 && volts >= perAmp);
  return tier === -1 ? MAX_TIER : tier;
}

/** Ids of the "machines" that are not GT machines; real machines use their GT MTE id. */
export const PSEUDO_MACHINES = { CRAFTING_TABLE: -1, FURNACE: -2, HAND: -3 } as const;
