// The machines a line may run on that the group owns, and a recipe's programmed circuit (plan 12, architecture §11.29 and
// §11.39): a leaf module, so the modules that read them (machines.ts, machine-options.ts, bom.ts, make-n.ts) import no
// value from each other in a cycle (the controller's ruling after plan 12 Task 5, item (d)).

import { isFluidKey, parseItemKey } from '../../shared/keys.ts';
import { compareMachineId, machineIdOfLegacy, type MachineId } from '../../shared/ids.ts';
import type { Recipe } from '../../shared/types/pack.ts';
import type { MachineWhere, PlanContext, PlanSettings } from '../../shared/types/plan.ts';
import { PROGRAMMED_CIRCUIT_ID } from '../pack/recipes.ts';

/**
 * The owned machines the line may run on, one entry each, per id (plan 12, architecture §11.39): none when the project
 * turned "Reuse machines we have" off (`settings.reuseOwned === false`); else, leaving out the types the group declined
 * to reuse for this line (`settings.declineReuse`), per world-scan entry (`ctx.ownedMachines`) in context order its
 * machines with where they stand (`where`, padded with null up to `count`), then per "Machines we have" entry
 * (`settings.ownedManual`) `count` machines without a position. A machine's index in its type's list is the unit number
 * `PlanStep.reused.units` names; the entries are machine-options.ts's `OwnedUnit` (that is, `MachineWhere`) or null. The
 * pools are keyed by `MachineId` and ordered by `compareMachineId`; the owned counts arrive as numbers and are converted
 * as they enter.
 */
export function ownedPools(ctx: PlanContext, settings: PlanSettings): Map<MachineId, Array<MachineWhere | null>> {
  const pools = new Map<MachineId, Array<MachineWhere | null>>();
  if (settings.reuseOwned === false) return pools;
  const declined = new Set((settings.declineReuse ?? []).map(machineIdOfLegacy));
  const add = (id: MachineId, count: number, where: readonly MachineWhere[]): void => {
    if (declined.has(id) || !(count > 0)) return;
    let units = pools.get(id);
    if (units === undefined) pools.set(id, (units = []));
    for (let i = 0; i < count; i++) {
      const at = where[i];
      units.push(at === undefined ? null : { dim: at.dim, pos: [at.pos[0], at.pos[1], at.pos[2]] });
    }
  };
  for (const m of ctx.ownedMachines) add(machineIdOfLegacy(m.mteId), m.count, m.where ?? []);
  for (const m of settings.ownedManual ?? []) add(machineIdOfLegacy(m.mteId), m.count, []);
  return new Map([...pools].sort(([a], [b]) => compareMachineId(a, b)));
}

/**
 * How many machines of each type the line may run on: the sizes of its owned pools (`ownedPools`), so a declined type
 * counts as not owned everywhere.
 */
export function ownedMachineMap(ctx: PlanContext, settings: PlanSettings): Map<MachineId, number> {
  return new Map([...ownedPools(ctx, settings)].map(([id, units]) => [id, units.length]));
}

/** The programmed-circuit number a recipe needs: `meta.circuit`, else the meta of a not-consumed programmed circuit. */
export function recipeCircuit(r: Recipe): number | undefined {
  if (typeof r.meta.circuit === 'number') return r.meta.circuit;
  for (const ing of r.inputs) {
    if (ing.consumed) continue;
    for (const option of ing.options) {
      if (isFluidKey(option.key)) continue;
      const { id, meta } = parseItemKey(option.key);
      if (id === PROGRAMMED_CIRCUIT_ID) return meta;
    }
  }
  return undefined;
}
