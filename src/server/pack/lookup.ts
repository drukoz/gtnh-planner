// The single door to the pack's machines (Task 2 of the multi-mod phase): the accessors every other module uses,
// implemented over today's numeric maps.

import type { Machine, Pack } from '../../shared/types/pack.ts';
import type { MachineId } from '../../shared/ids.ts';
import { compareMachineId, legacyMteId, machineIdOfLegacy } from '../../shared/ids.ts';

/** The machine of an id, or undefined when the pack has none. */
export function machineOf(pack: Pack, id: MachineId): Machine | undefined {
  try {
    return pack.machines.get(legacyMteId(id));
  } catch {
    return undefined;
  }
}

/** The machine of a GT MTE id or a legacy pseudo id, for a world scan, a structure block or saved settings. */
export function machineByMteId(pack: Pack, mteId: number): Machine | undefined {
  return pack.machines.get(mteId);
}

/** The ids of the machines of a recipe map, in `machinesByMap` order (tier, then `compareMachineId`). */
export function machineIdsForMap(pack: Pack, mapId: string): readonly MachineId[] {
  const ids = pack.machinesByMap.get(mapId);
  if (ids === undefined) return [];
  return ids.map(machineIdOfLegacy);
}

/** Those machines themselves, in the same order, skipping an id the pack no longer has. */
export function machinesForMap(pack: Pack, mapId: string): Machine[] {
  return machineIdsForMap(pack, mapId).map((id) => machineOf(pack, id)).filter((m): m is Machine => m !== undefined);
}

/** Every machine id in `compareMachineId` order. */
export function allMachineIds(pack: Pack): MachineId[] {
  return [...pack.machines.values()].map((m) => m.id).sort(compareMachineId);
}

/** True when the pack has a machine with that id. */
export function hasMachine(pack: Pack, id: MachineId): boolean {
  return machineOf(pack, id) !== undefined;
}
