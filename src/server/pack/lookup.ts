// The single door to the pack's machines (Task 2 of the multi-mod phase): the accessors every other module uses,
// implemented over the pack's `MachineId`-keyed maps.

import type { Machine, Pack } from '../../shared/types/pack.ts';
import { compareMachineId, type MachineId } from '../../shared/ids.ts';

/** The machine of an id, or undefined when the pack has none. */
export function machineOf(pack: Pack, id: MachineId): Machine | undefined {
  return pack.machines.get(id);
}

/** The machine of a GT MTE id or a legacy pseudo id, for a world scan, a structure block or saved settings. */
export function machineByMteId(pack: Pack, mteId: number): Machine | undefined {
  return pack.machineByMteId.get(mteId);
}

/** The ids of the machines of a recipe map, in `machinesByMap` order (tier, then `compareMachineId`). */
export function machineIdsForMap(pack: Pack, mapId: string): readonly MachineId[] {
  return pack.machinesByMap.get(mapId) ?? [];
}

/** Those machines themselves, in the same order, skipping an id the pack no longer has. */
export function machinesForMap(pack: Pack, mapId: string): Machine[] {
  return machineIdsForMap(pack, mapId).map((id) => machineOf(pack, id)).filter((m): m is Machine => m !== undefined);
}

/** Every machine id in `compareMachineId` order. */
export function allMachineIds(pack: Pack): MachineId[] {
  return [...pack.machines.keys()].sort(compareMachineId);
}

/** Every machine in the pack, in `compareMachineId` order. */
export function allMachines(pack: Pack): Machine[] {
  return allMachineIds(pack).flatMap((id) => machineOf(pack, id) ?? []);
}

/** True when the pack has a machine with that id. */
export function hasMachine(pack: Pack, id: MachineId): boolean {
  return pack.machines.has(id);
}
