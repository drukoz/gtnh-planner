// Parity of the Phase 1 MachineId migration (RUK-70): two behaviours that changed shape and are guarded only
// by a reading of the code — (1) compareMachineId must keep the old `a.mteId - b.mteId` order (as plain strings
// "gt:1001" < "gt:999", the bug this guards against), and (2) ownedPools is now sorted by machine id and every
// caller reads the map by key, so the order the owned machines arrive in must not change a plan.

import { describe, it, expect } from 'vitest';
import { miniGt } from '../../helpers/mini-gt.ts';
import { emptyContext, planLine } from '../../../src/server/planner/plan.ts';
import { ownedMachineMap, ownedPools } from '../../../src/server/planner/machines.ts';
import { allMachineIds } from '../../../src/server/pack/lookup.ts';
import { compareMachineId, legacyMteId, machineIdOfLegacy } from '../../../src/shared/ids.ts';
import { defaultSettings } from '../../../src/shared/project/apply-op.ts';
import type { MachineWhere, PlanContext, PlanSettings } from '../../../src/shared/types/plan.ts';

const pack = miniGt();
const ASSEMBLER = 121;   // Mini-GT's Basic Assembler (LV), which runs circuit-lv
const BENDER = 101;      // Basic Bending Machine (LV)
const at = (x: number, z: number): MachineWhere => ({ dim: 0, pos: [x, 64, z] });
const A1 = at(1, 2), A2 = at(3, 2), B1 = at(5, 2);
const S = (p: Partial<PlanSettings> = {}): PlanSettings => ({ ...defaultSettings(), target: 't:circuit@0', amount: 18, per: 'min', tier: 1, buildHorizonHours: null, ...p });
const scanned = (...owned: PlanContext['ownedMachines']): PlanContext => ({ ...emptyContext(), ownedMachines: owned });

describe('MachineId migration parity', () => {
  it('compareMachineId keeps the old numeric order', () => {
    const ids = allMachineIds(pack);
    const byId = [...ids].sort(compareMachineId);
    const byNumber = [...ids].sort((a, b) => legacyMteId(a) - legacyMteId(b));
    expect(byId).toEqual(byNumber);

    const tricky = [999, 1001, 99, 1, 31040].map(machineIdOfLegacy);
    expect([...tricky].sort(compareMachineId)).toEqual([1, 99, 999, 1001, 31040].map(machineIdOfLegacy));
  });

  it('the order the owned machines arrive in does not change the plan', async () => {
    const ab = scanned({ mteId: ASSEMBLER, count: 2, where: [A1, A2] }, { mteId: BENDER, count: 1, where: [B1] });
    const ba = scanned({ mteId: BENDER, count: 1, where: [B1] }, { mteId: ASSEMBLER, count: 2, where: [A1, A2] });
    const p1 = await planLine(pack, S(), ab);
    const p2 = await planLine(pack, S(), ba);
    expect(p2.steps).toEqual(p1.steps);
    expect(p2.buildList).toEqual(p1.buildList);
    expect([...ownedMachineMap(ab, S())]).toEqual([...ownedMachineMap(ba, S())]);
    expect(ownedPools(ab, S()).get('gt:121')).toEqual([A1, A2]);
  });
});
