// The plan-invariant checker (tests/helpers/plan-invariants.ts) on Mini-GT: real plans pass every invariant, and each
// kind of damage a plan can carry (a good from nowhere, too few machines, a flow that does not add up, an unlisted
// surplus, a raw input without a source) is reported under its own kind.

import { describe, expect, it } from 'vitest';
import { miniGt } from '../../helpers/mini-gt.ts';
import { checkPlanInvariants, checkPlanInvariantsDeep, countByKind, type Violation } from '../../helpers/plan-invariants.ts';
import { emptyContext, planLine } from '../../../src/server/planner/plan.ts';
import { defaultSettings } from '../../../src/shared/project/apply-op.ts';
import type { Plan, PlanSettings } from '../../../src/shared/types/plan.ts';

const pack = miniGt();
const S = (p: Partial<PlanSettings>): PlanSettings => ({ ...defaultSettings(), ...p });
const errors = (v: readonly Violation[]): Violation[] => v.filter((x) => x.severity === 'error');
const kinds = (v: readonly Violation[]): string[] => [...new Set(errors(v).map((x) => x.kind))].sort();
const copy = (p: Plan): Plan => structuredClone(p);

describe('checkPlanInvariants on Mini-GT', () => {
  const cases: Array<[string, Partial<PlanSettings>]> = [
    ['circuits at LV', { target: 't:circuit@0', amount: 30, tier: 1 }],
    ['circuits at MV', { target: 't:circuit@0', amount: 30, tier: 2 }],
    ['circuits at MV, 1 per hour', { target: 't:circuit@0', amount: 1, per: 'hour', tier: 2 }],
    ['LV hulls', { target: 't:hull_lv@0', amount: 2, tier: 1 }],
    ['titanium plates at HV', { target: 't:titanium_plate@0', amount: 5, tier: 3 }],
  ];
  for (const [label, settings] of cases) {
    it(`finds nothing wrong with ${label}`, async () => {
      const s = S(settings);
      const plan = await planLine(pack, s, emptyContext());
      expect(plan.status).toBe('ok');
      const v = await checkPlanInvariantsDeep(pack, s, plan, { marginal: true });
      expect(errors(v), JSON.stringify(countByKind(v))).toEqual([]);
      expect(v.filter((x) => x.kind === 'cost' && x.severity === 'info')).toHaveLength(1);
    });
  }

  it('reports each kind of damage under its own kind', async () => {
    const s = S({ target: 't:circuit@0', amount: 30, tier: 1 });
    const plan = await planLine(pack, s, emptyContext());
    expect(errors(checkPlanInvariants(pack, s, plan))).toEqual([]);

    // A raw input dropped: its good is consumed with no source, and the flows no longer add up.
    const noCopper = copy(plan);
    noCopper.rawInputs = noCopper.rawInputs.filter((r) => r.key !== 't:copper_ingot@0');
    noCopper.flows = noCopper.flows.filter((f) => f.key !== 't:copper_ingot@0');
    expect(kinds(checkPlanInvariants(pack, s, noCopper))).toEqual(['flow', 'orphan-input']);

    // Too few machines for the runs.
    const busy = copy(plan);
    const wire = busy.steps.find((x) => x.id === 'wire')!;
    wire.count = Math.max(1, Math.ceil(wire.count / 4));
    wire.runsPerSecond *= 4;
    const v = checkPlanInvariants(pack, s, busy);
    expect(kinds(v)).toContain('machines');
    expect(kinds(v)).toContain('flow');

    // A flow listed twice.
    const twice = copy(plan);
    twice.flows.push({ ...twice.flows[0]! });
    expect(kinds(checkPlanInvariants(pack, s, twice))).toContain('flow');

    // A surplus the byproducts do not list: buy twice the iron the steps use.
    const surplus = copy(plan);
    const iron = surplus.rawInputs.find((r) => r.key === 't:iron_ingot@0')!;
    iron.perSecond *= 2;
    expect(kinds(checkPlanInvariants(pack, s, surplus))).toEqual(expect.arrayContaining(['byproduct', 'flow']));

    // A step that takes more than anything makes.
    const short = copy(plan);
    const circuit = short.steps.find((x) => x.id === 'circuit-lv')!;
    circuit.inputs = circuit.inputs.map((p) => (p.key === 't:redstone@0' ? { ...p, amount: p.amount * 2 } : p));
    expect(kinds(checkPlanInvariants(pack, s, short))).toEqual(expect.arrayContaining(['balance', 'flow']));

    // A raw input without a source.
    const unsourced = copy(plan);
    unsourced.rawInputs[0]!.sources = [];
    expect(kinds(checkPlanInvariants(pack, s, unsourced))).toEqual(['raw-source']);
  });

  it('calls a good made by two recipes redundant when one alone costs the same', async () => {
    const s = S({ target: 't:circuit@0', amount: 30, tier: 1 });
    const plan = await planLine(pack, s, emptyContext());
    // Make half the plates by hammering instead (2 ingots each): a second producer that costs more.
    const mixed = copy(plan);
    const bend = mixed.steps.find((x) => x.id === 'bend-plate')!;
    bend.runsPerSecond /= 2;
    mixed.steps.push({ ...structuredClone(bend), id: 'hammer-plate', recipeId: 'hammer-plate', mapId: 'crafting', inputs: [{ key: 't:iron_ingot@0', amount: 2, chance: 1 }] });
    const v = await checkPlanInvariantsDeep(pack, s, mixed);
    const multi = v.find((x) => x.kind === 'multi-producer' && x.key === 't:iron_plate@0');
    expect(multi?.severity).toBe('error');
    expect(multi?.message).toContain('REDUNDANT');
  });
});
