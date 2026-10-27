// The mod line of an item's tip (Phase 2 spec §6.5, D10): NEI names the mod an item comes from under its name, and the planner knows it
// from the registry namespace of the item's key alone, so nothing new comes from the server. The table holds the pack's main mods, at most
// 15; a fluid, and any namespace it does not hold (the e2e pack's `t:` and `machine:` keys among them), get no line.

import { isFluidKey, type StuffKey } from '../../shared/keys.ts';

/** Each mod's name by its registry namespace, in lower case: 1.7.10 writes some in upper case (`IC2`, `EnderIO`; P2-D30). */
export const MOD_NAMES: Readonly<Record<string, string>> = {
  gregtech: 'GregTech',
  minecraft: 'Minecraft',
  ic2: 'IndustrialCraft 2',
  bartworks: 'BartWorks',
  gtnhlanth: 'GTNH Lanthanides',
  tectech: 'TecTech',
  appliedenergistics2: 'Applied Energistics 2',
  enderio: 'Ender IO',
  miscutils: 'GT++',
  dreamcraft: 'GT New Horizons',
  railcraft: 'Railcraft',
  forestry: 'Forestry',
  tconstruct: "Tinkers' Construct",
};

/** The mod `key` comes from, by the namespace before its first ':' whatever its case; null for a fluid or a namespace not in the table. */
export function modName(key: StuffKey): string | null {
  if (isFluidKey(key)) return null;
  const namespace = key.slice(0, Math.max(0, key.indexOf(':'))).toLowerCase();
  // an own key only: `constructor` and the like are no mod
  return Object.hasOwn(MOD_NAMES, namespace) ? (MOD_NAMES[namespace] ?? null) : null;
}
