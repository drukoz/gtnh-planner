// How the build list's parts are made (architecture §11 entry 41; add-on 14): the machine a one-off job runs on, the
// machines the group has for one, and the settle that gives each good of the breakdown one recipe.

import { describe, it, expect } from 'vitest';
import { packedTableSpec, partStep } from '../../helpers/howto-fixtures.ts';
import { miniGt } from '../../helpers/mini-gt.ts';
import { packFromSpec } from '../../helpers/pack-spec.ts';
import { emptyContextForTest } from '../../helpers/plan-context.ts';
import { planBasis } from '../../../src/server/planner/basis.ts';
import { buildCandidates } from '../../../src/server/planner/candidates.ts';
import { ownedForParts, partMachine, settleRecipes } from '../../../src/server/planner/howto.ts';
import { PSEUDO_MACHINES } from '../../../src/shared/gt/tiers.ts';
import { defaultSettings } from '../../../src/shared/project/apply-op.ts';
import type { StuffKey } from '../../../src/shared/keys.ts';

const pack = miniGt();
const r = (id: string) => pack.recipeById.get(id)!;

describe('the machine of a one-off job', () => {
  it('picks a machine the group has, then one the line builds, then the cheapest that can', () => {
    const at = (owned: Map<number, number>, line: Set<number>) => partMachine(pack, r('circuit-lv'), 'gt.recipe.assembler', { groupTier: 2, owned, line });
    expect(at(new Map(), new Set())).toEqual({ mteId: 121, name: 'Basic Assembler', tier: 1, source: 'new' });
    expect(at(new Map([[122, 1]]), new Set())).toEqual({ mteId: 122, name: 'Advanced Assembler', tier: 2, source: 'owned' });
    expect(at(new Map(), new Set([122]))).toEqual({ mteId: 122, name: 'Advanced Assembler', tier: 2, source: 'line' });
    expect(at(new Map([[121, 1]]), new Set([122]))).toEqual({ mteId: 121, name: 'Basic Assembler', tier: 1, source: 'owned' });
    // circuit-mv draws 120 EU/t: an LV assembler's 32 EU/t is too little
    expect(partMachine(pack, r('circuit-mv'), 'gt.recipe.assembler', { groupTier: 2, owned: new Map(), line: new Set() }))
      .toEqual({ mteId: 122, name: 'Advanced Assembler', tier: 2, source: 'new' });
    expect(partMachine(pack, r('hammer-plate'), 'crafting', { groupTier: 2, owned: new Map(), line: new Set() })).toBe('crafting table');
    expect(partMachine(pack, r('smelt-v'), 'furnace', { groupTier: 2, owned: new Map(), line: new Set() }))
      .toEqual({ mteId: PSEUDO_MACHINES.FURNACE, name: 'Furnace', tier: 0, source: 'owned' });
  });

  it('marks the line\'s machine when its own build needs the part', () => {
    expect(partMachine(pack, r('wire'), 'gt.recipe.wiremill', { groupTier: 1, owned: new Map(), line: new Set([111]), exclude: new Set([111]) }))
      .toEqual({ mteId: 111, name: 'Basic Wiremill', tier: 1, source: 'first' });
  });

  it('counts every machine the group has for a one-off job', () => {
    // Reuse settings keep a machine out of the running line, not out of a one-off job.
    const owned = ownedForParts(
      { ...emptyContextForTest(), ownedMachines: [{ mteId: 121, count: 2 }] },
      { ...defaultSettings(), ownedManual: [{ mteId: 111, count: 1 }], declineReuse: [121], reuseOwned: false },
      [partStep({ owned: 1, machine: { mteId: 101, name: 'Basic Bending Machine', tier: 1 } })],
    );
    expect([...owned]).toEqual([[101, 1], [111, 1], [121, 2]]);
  });
});

describe('settleRecipes', () => {
  it('settles each good by its cheapest recipe whose parts settled first', () => {
    const tp = packFromSpec(packedTableSpec());
    const settings = { ...defaultSettings(), tier: 1 };
    const b = planBasis(tp, settings, emptyContextForTest());
    const graph = buildCandidates(tp, settings, b.env, b.leaf, ['t:table@0']);
    const leafCost = (k: StuffKey): number | null => (b.leaf(k).buyable ? b.leaf(k).cost : null);
    const settled = settleRecipes(graph, { leafCost, pins: {} });
    expect(settled.recipe.get('t:table@0')?.lp.id).toBe('table');
    expect(settled.cost.get('t:table@0')).toBe(4);
    expect([settled.recipe.get('t:table_c1@0')?.lp.id, settled.cost.get('t:table_c1@0')]).toEqual(['pack-1', 36]);
    expect([settled.recipe.get('t:table_c2@0')?.lp.id, settled.cost.get('t:table_c2@0')]).toEqual(['pack-2', 324]);
    expect(settled.droppedPins).toEqual([]);
    // The pin never settles the Table (its Packed Table needs Tables), so it is dropped and the Table settles by `table`.
    const pinned = settleRecipes(graph, { leafCost, pins: { 't:table@0': 'a-unpack-1' } });
    expect(pinned.droppedPins).toEqual(['t:table@0']);
    expect(pinned.recipe.get('t:table@0')?.lp.id).toBe('table');
  });
});
