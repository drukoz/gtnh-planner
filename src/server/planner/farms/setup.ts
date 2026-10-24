// Which farms a line may use (add-on 17, architecture §11.45 (2); the user's ruling of 2026-10-20: a farm the group owns,
// or an easy one it could build, is a source option): the Tree Growth Simulators the group owns or, in rate mode, can
// build at the line's tier, at the energy hatch tier of its farm settings, and the Crop Manager of the settings' tier the
// group owns or can make. A Make N batch runs on owned farms only. Pure: the synthetic recipes are farms/recipes.ts's.

import { defaultFarmSettings, type FarmSettings } from '../../../shared/types/farm.ts';
import type { Pack } from '../../../shared/types/pack.ts';
import type { PlanContext, PlanSettings } from '../../../shared/types/plan.ts';
import { TREE_FARM_MAP } from '../../pack/recipes.ts';
import type { PlanBasis } from '../basis.ts';
import { ownedMachineMap } from '../owned.ts';
import { CROP_MANAGER_MTE_IDS, sticksPerManager } from './crops.ts';

/**
 * The farms a line may use: its farm settings (`PlanSettings.farms`, else the defaults); the Tree Growth Simulator's
 * energy hatch tier and the machines it may run on, owned first, then by mteId (null: the kind is off, or no machine the
 * line may use); the Crop Manager's tier, its machine and the crop sticks one tends (null likewise, and without a crop
 * table).
 */
export interface FarmSetup {
  settings: FarmSettings;                                   // settings.farms ?? defaultFarmSettings()
  tgs: { tier: number; machines: number[] } | null;         // null: off, or no machine the line may use
  crops: { tier: number; machines: number[]; parallel: number } | null;
}

/** The pack's Tree Growth Simulators: the multiblocks of `gt.recipe.treefarm`, by mteId. */
function treeFarms(pack: Pack): number[] {
  return (pack.machinesByMap.get(TREE_FARM_MAP) ?? []).filter((id) => pack.machines.get(id)?.kind === 'multiblock').sort((a, b) => a - b);
}

/**
 * The farm machines of the context the line may own (sorted mteIds, each once): its Tree Growth Simulators and Crop
 * Managers of `ctx.ownedMachines` with a count. All `farmSetup` reads of the context beside the basis, so a line's pricing
 * is memoized by them (pricing.ts); what the settings own (`ownedManual`, `reuseOwned`, `declineReuse`) is in its
 * settings hash already.
 */
export function ownedFarmMachines(pack: Pack, ctx: PlanContext): number[] {
  const farms = new Set([...treeFarms(pack), ...CROP_MANAGER_MTE_IDS]);
  return [...new Set(ctx.ownedMachines.filter((m) => m.count > 0 && farms.has(m.mteId)).map((m) => m.mteId))].sort((a, b) => a - b);
}

/**
 * The farms a line may use in `ctx` at `basis` (its tier, multiblocks and availability):
 * - with kind `tgs`, the Tree Growth Simulators the group owns (`ownedMachineMap`: none with "Reuse machines we have" off
 *   or a type declined) or, in rate mode only, can build (`basis.env.multiblocks` has it: its controller is available
 *   here), owned first, then by mteId, at the hatch tier `min(farms.tgs.tier, basis.tier)`; null without one;
 * - with kind `crop-manager` and a crop table (`pack.crops` absent or empty: none, and no plan warning — crop farms are on
 *   by default and the Farms section of Settings says what is missing), the Crop Manager of tier
 *   `m = min(farms.crops.tier, basis.tier)` (`CROP_MANAGER_MTE_IDS[m − 1]`) when the pack has it and the group owns one
 *   or, in rate mode, its item is available here (as availability.ts judges a multiblock's controller), tending
 *   `sticksPerManager(m, farms.crops.layers)` crop sticks; null otherwise.
 */
export function farmSetup(pack: Pack, settings: PlanSettings, ctx: PlanContext, basis: PlanBasis): FarmSetup {
  const farms = settings.farms ?? defaultFarmSettings();
  const owned = ownedMachineMap(ctx, settings);
  const has = (mteId: number): boolean => (owned.get(mteId) ?? 0) > 0;
  const rate = settings.mode === 'rate';
  let tgs: FarmSetup['tgs'] = null;
  if (farms.kinds.includes('tgs')) {
    const built = basis.env.multiblocks;   // absent: every multiblock counts as built (`PlanEnv.multiblocks`)
    const machines = treeFarms(pack).filter((id) => has(id) || (rate && (built === undefined || built.has(id))))
      .sort((a, b) => Number(has(b)) - Number(has(a)) || a - b);
    if (machines.length > 0) tgs = { tier: Math.min(farms.tgs.tier, basis.tier), machines };
  }
  let crops: FarmSetup['crops'] = null;
  if (farms.kinds.includes('crop-manager') && (pack.crops?.length ?? 0) > 0) {
    const tier = Math.min(farms.crops.tier, basis.tier);
    const id = CROP_MANAGER_MTE_IDS[tier - 1];
    const manager = id === undefined ? undefined : pack.machines.get(id);
    if (manager !== undefined && (has(manager.mteId) || (rate && basis.avail.available.has(manager.itemKey)))) {
      crops = { tier, machines: [manager.mteId], parallel: sticksPerManager(tier, farms.crops.layers) };
    }
  }
  return { settings: farms, tgs, crops };
}
