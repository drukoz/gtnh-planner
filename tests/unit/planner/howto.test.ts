// How the build list's parts are made (architecture §11 entry 41; add-on 14): the machine a one-off job runs on, the
// machines the group has for one, the settle that gives each good of the breakdown one recipe, and the pooled make plan
// of a whole build list.

import { describe, it, expect } from 'vitest';
import { packedTableSpec, partStep } from '../../helpers/howto-fixtures.ts';
import { miniGt } from '../../helpers/mini-gt.ts';
import { packFromSpec } from '../../helpers/pack-spec.ts';
import { emptyContextForTest } from '../../helpers/plan-context.ts';
import { planBasis } from '../../../src/server/planner/basis.ts';
import { buildCandidates } from '../../../src/server/planner/candidates.ts';
import { orderJobs, ownedForParts, partMachine, poolMakes, settleRecipes, type OrderJob, type PoolGood } from '../../../src/server/planner/howto.ts';
import { PSEUDO_MACHINES } from '../../../src/shared/gt/tiers.ts';
import type { MachineId } from '../../../src/shared/ids.ts';
import { defaultSettings } from '../../../src/shared/project/apply-op.ts';
import type { StuffKey } from '../../../src/shared/keys.ts';

const pack = miniGt();
const r = (id: string) => pack.recipeById.get(id)!;

describe('the machine of a one-off job', () => {
  it('picks a machine the group has, then one the line builds, then the cheapest that can', () => {
    const at = (owned: Map<MachineId, number>, line: Set<MachineId>) => partMachine(pack, r('circuit-lv'), 'gt.recipe.assembler', { groupTier: 2, owned, line });
    expect(at(new Map(), new Set())).toEqual({ mteId: 121, name: 'Basic Assembler', tier: 1, source: 'new' });
    expect(at(new Map([['gt:122', 1]]), new Set())).toEqual({ mteId: 122, name: 'Advanced Assembler', tier: 2, source: 'owned' });
    expect(at(new Map(), new Set(['gt:122']))).toEqual({ mteId: 122, name: 'Advanced Assembler', tier: 2, source: 'line' });
    expect(at(new Map([['gt:121', 1]]), new Set(['gt:122']))).toEqual({ mteId: 121, name: 'Basic Assembler', tier: 1, source: 'owned' });
    // circuit-mv draws 120 EU/t: an LV assembler's 32 EU/t is too little
    expect(partMachine(pack, r('circuit-mv'), 'gt.recipe.assembler', { groupTier: 2, owned: new Map(), line: new Set() }))
      .toEqual({ mteId: 122, name: 'Advanced Assembler', tier: 2, source: 'new' });
    expect(partMachine(pack, r('hammer-plate'), 'crafting', { groupTier: 2, owned: new Map(), line: new Set() })).toBe('crafting table');
    expect(partMachine(pack, r('smelt-v'), 'furnace', { groupTier: 2, owned: new Map(), line: new Set() }))
      .toEqual({ mteId: PSEUDO_MACHINES.FURNACE, name: 'Furnace', tier: 0, source: 'owned' });
  });

  it('marks the line\'s machine when its own build needs the part', () => {
    expect(partMachine(pack, r('wire'), 'gt.recipe.wiremill', { groupTier: 1, owned: new Map(), line: new Set(['gt:111']), exclude: new Set(['gt:111']) }))
      .toEqual({ mteId: 111, name: 'Basic Wiremill', tier: 1, source: 'first' });
  });

  it('counts every machine the group has for a one-off job', () => {
    // Reuse settings keep a machine out of the running line, not out of a one-off job.
    const owned = ownedForParts(
      { ...emptyContextForTest(), ownedMachines: [{ mteId: 121, count: 2 }] },
      { ...defaultSettings(), ownedManual: [{ mteId: 111, count: 1 }], declineReuse: [121], reuseOwned: false },
      [partStep({ owned: 1, machine: { mteId: 101, name: 'Basic Bending Machine', tier: 1 } })],
    );
    expect([...owned]).toEqual([['gt:101', 1], ['gt:111', 1], ['gt:121', 2]]);
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

describe('poolMakes', () => {
  /** A coil takes 144 of m and 8 wire, a casing and a pipe 72 of m and an iron; m comes 144 to a run from a dust. */
  const coilTable: Record<StuffKey, PoolGood> = {
    m: { perRun: 144, inputs: [['dust', 1]] },
    coil: { perRun: 1, inputs: [['m', 144], ['wire', 8]] },
    casing: { perRun: 1, inputs: [['m', 72], ['iron', 1]] },
    pipe: { perRun: 1, inputs: [['m', 72], ['iron', 1]] },
  };
  const coilMade = (key: StuffKey): PoolGood | null => coilTable[key] ?? null;

  it('rounds whole runs once for the whole list', () => {
    const pooled = poolMakes([{ key: 'coil', amount: 4 }, { key: 'casing', amount: 1 }, { key: 'pipe', amount: 1 }], coilMade);
    // ceil((576 + 72 + 72) / 144) = 5 runs of m; rounded per line it would be 4 + 1 + 1
    expect(Object.fromEntries(pooled.runs)).toEqual({ m: 5, coil: 4, casing: 1, pipe: 1 });
    expect(pooled.demand.get('m')).toBe(720);
    expect(Object.fromEntries(pooled.leaves)).toEqual({ dust: 5, wire: 32, iron: 2 });
    expect(Object.fromEntries(pooled.shares.get('dust') ?? [])).toEqual({ coil: 4, casing: 0.5, pipe: 0.5 });
    expect(pooled.backEdges).toEqual([]);
  });

  it('keeps a whole run\'s leftover out of the shares', () => {
    const pooled = poolMakes([{ key: 'coil', amount: 4 }, { key: 'casing', amount: 1 }], coilMade);
    expect(pooled.runs.get('m')).toBe(5);   // ceil(648 / 144)
    expect(pooled.leaves.get('dust')).toBe(5);
    expect(Object.fromEntries(pooled.shares.get('dust') ?? [])).toEqual({ coil: 4, casing: 0.5 });
  });

  it('gathers the demand a back edge meets', () => {
    // a is made from b and b from a: the walk from a meets a again at b, whose demand for a is gathered, not made.
    const table: Record<string, PoolGood> = { a: { perRun: 1, inputs: [['b', 1]] }, b: { perRun: 1, inputs: [['a', 1]] } };
    const pooled = poolMakes([{ key: 'a', amount: 1 }], (key) => table[key] ?? null);
    expect(Object.fromEntries(pooled.runs)).toEqual({ a: 1, b: 1 });
    expect(pooled.leaves.get('a')).toBe(1);
    expect(pooled.backEdges).toEqual([['b', 'a']]);
  });
});

describe('orderJobs', () => {
  /** A job of the order: no machine waits unless given. */
  const job = (key: string, machineKey: string, name: string, waits: string[] = [], machineWaits: string[] = []): OrderJob =>
    ({ key, machineKey, name, waits, machineWaits });

  it('takes the inputs first, then the machine just used, then the smallest by machine, name and key', () => {
    // Once the wire is drawn, the fine wire (Wiremill) and the board (Assembler) are both ready: the wiremill goes on.
    const jobs = [job('panel', 'crafting table', 'Control Panel', ['fine', 'board']), job('board', 'Basic Assembler', 'Circuit Board', ['wire']),
      job('fine', 'Basic Wiremill', 'Fine Wire', ['wire']), job('wire', 'Basic Wiremill', 'Copper Wire', ['ingot'])];
    // `ingot` is no job: it holds nothing up
    expect(orderJobs(jobs)).toEqual({ order: ['wire', 'fine', 'board', 'panel'], first: new Set() });
  });

  it('breaks a cycle through the line\'s machines at the smallest job that waits only for its machine', () => {
    // The bender is crafted from wires, the wiremill from foils, the wires drawn in the wiremill and the foils pressed in the
    // bender that the line builds: nothing is ready. The bender's and the wiremill's crafts wait for a material; of the two
    // jobs that wait only for their machine, the foil's sorts first (Bending Machine before Wiremill), so it drops that wait.
    const jobs = [
      job('machine:101@0', 'crafting table', 'Basic Bending Machine', ['wire']), job('machine:111@0', 'crafting table', 'Basic Wiremill', ['foil']),
      job('wire', 'Basic Wiremill', '2x Cupronickel Wire', ['machine:111@0', 'ingot'], ['machine:111@0']),
      job('foil', 'Basic Bending Machine', 'Mica Insulator Foil', ['machine:101@0'], ['machine:101@0']), job('ingot', 'Basic Alloy Smelter', 'Cupronickel Ingot'),
    ];
    expect(orderJobs(jobs)).toEqual({ order: ['ingot', 'foil', 'machine:111@0', 'wire', 'machine:101@0'], first: new Set(['foil']) });
    // Without the foil's machine wait (as the breakdown passes its make once it is `first`) the order is the same, with no break.
    const broken = jobs.map((j) => (j.key === 'foil' ? job('foil', 'Basic Bending Machine', 'Mica Insulator Foil') : j));
    expect(orderJobs(broken)).toEqual({ order: ['ingot', 'foil', 'machine:111@0', 'wire', 'machine:101@0'], first: new Set() });
  });

  it('ends a cycle of material waits at the smallest job, with no machine to send elsewhere', () => {
    const jobs = [job('coil', 'Basic Assembler', 'Coil', ['wire']), job('wire', 'Basic Wiremill', 'Wire', ['coil'])];
    expect(orderJobs(jobs)).toEqual({ order: ['coil', 'wire'], first: new Set() });
  });
});
