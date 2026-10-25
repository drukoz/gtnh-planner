// The pack's machine accessors (multi-mod phase 1, Task 2): one door to the numeric maps, by the new machine ids.

import { describe, expect, it } from 'vitest';
import { miniGt } from '../../helpers/mini-gt.ts';
import { PSEUDO_MACHINE_ENTRIES } from '../../../src/server/pack/machines.ts';
import { allMachineIds, hasMachine, machineByMteId, machineIdsForMap, machineOf, machinesForMap } from '../../../src/server/pack/lookup.ts';
import { compareMachineId, gtMachineId, legacyMteId, machineIdOfLegacy, MC_MACHINES } from '../../../src/shared/ids.ts';
import type { Pack } from '../../../src/shared/types/pack.ts';

/** `miniGt()` plus the loader's pseudo machines, so the pseudo maps have machines the accessors can find. */
function packWithPseudo(): Pack {
  const pack = miniGt();
  for (const pseudo of PSEUDO_MACHINE_ENTRIES) {
    pack.machines.set(pseudo.id, pseudo);
    pack.machineByMteId.set(pseudo.mteId, pseudo);
    const mapId = pseudo.maps[0]!;
    pack.machinesByMap.set(mapId, [...(pack.machinesByMap.get(mapId) ?? []), pseudo.id]);
  }
  return pack;
}

describe('the pack lookup', () => {
  const pack = packWithPseudo();

  it('finds a machine by its id and by its legacy mte id, and gives no machine for an id the pack lacks', () => {
    const m = pack.machines.get(gtMachineId(101))!;
    expect(machineOf(pack, gtMachineId(101))).toBe(m);
    expect(machineByMteId(pack, 101)).toBe(m);
    expect(machineOf(pack, m.id)).toBe(m);
    expect(machineOf(pack, 'ic2:macerator')).toBeUndefined();
    expect(machineOf(pack, 'gt:999_999')).toBeUndefined();
    expect(machineOf(pack, 'gt:-1')).toBeUndefined();
  });

  it('lists the machines of a map in `machinesByMap` order, as ids and as machines', () => {
    expect(machineIdsForMap(pack, 'crafting')).toEqual([MC_MACHINES.CRAFTING_TABLE]);
    expect(machineIdsForMap(pack, 'furnace')).toEqual([MC_MACHINES.FURNACE]);
    expect(machinesForMap(pack, 'crafting')).toEqual([pack.machines.get(MC_MACHINES.CRAFTING_TABLE)]);
    expect(machinesForMap(pack, 'furnace')).toEqual([pack.machines.get(MC_MACHINES.FURNACE)]);
    for (const mapId of pack.maps.keys()) {
      const direct = pack.machinesByMap.get(mapId) ?? [];
      expect(machineIdsForMap(pack, mapId)).toEqual(direct);
    }
  });

  it('reports presence and lists every machine id in `compareMachineId` order', () => {
    expect(hasMachine(pack, gtMachineId(101))).toBe(true);
    expect(hasMachine(pack, MC_MACHINES.FURNACE)).toBe(true);
    expect(hasMachine(pack, 'ic2:macerator')).toBe(false);
    expect(allMachineIds(pack)).toEqual([...pack.machines.values()].map((m) => m.id).sort(compareMachineId));
  });

  it('keeps every machine id consistent with its legacy mte id', () => {
    for (const m of pack.machines.values()) expect(legacyMteId(m.id)).toBe(m.mteId);
  });
});
