// The plan index (fix spec R11, §6.4): what flows into and out of every step's ports, who makes each good, and the
// integrity issues a plan carries (an input nothing supplies, one supplied short, a good two steps make, a good both
// bought and made), with their texts. Synthetic plans only: invented keys, no game data.

import { describe, expect, it } from 'vitest';
import { indexPlan, issueText, ORPHAN_REL, SHORT_INPUT_SHARE, type PlanIssue } from '../../../src/shared/plan/balance.ts';
import type { Product } from '../../../src/shared/types/pack.ts';
import type { Plan, PlanFlow, PlanStep, RawInput } from '../../../src/shared/types/plan.ts';

const NAMES: Record<string, string> = {
  'fluid:pva': 'PVA', 't:resin@0': 'Resin', 't:glue@0': 'Glue', 't:circuit@0': 'Circuit', 't:iron_plate@0': 'Iron Plate',
  't:iron_ingot@0': 'Iron Ingot', 't:empty_cell@0': 'Empty Cell', 't:a@0': 'Part A', 't:b@0': 'Part B', 't:t@0': 'Thing',
  'fluid:x': 'X', 'fluid:y': 'Y', 't:pa@0': 'Product A', 't:pb@0': 'Product B',
};
const per = (key: string, amount: number): Product => ({ key, amount, chance: 1 });
function step(id: string, machine: string, mainOutput: string | undefined, runsPerSecond: number, inputs: Product[], outputs: Product[]): PlanStep {
  return {
    id, recipeId: id, mapId: 'gt.recipe.test', machine: { mteId: 1, name: machine, tier: 1 }, count: 1, owned: 0, runsPerSecond,
    utilization: 0.5, euPerTick: 0, durationTicks: 20, overclocks: 0, inputs, outputs, alternatives: [], handCraft: false, warnings: [],
    ...(mainOutput === undefined ? {} : { mainOutput }),
  };
}
const flow = (from: string, to: string, key: string, perSecond: number): PlanFlow => ({ from, to, key, perSecond });
const raw = (key: string, perSecond: number): RawInput => ({ key, perSecond, cost: perSecond, available: true, sources: [], leafClass: 'direct' });
function planOf(steps: PlanStep[], flows: PlanFlow[], rawInputs: RawInput[] = [], byproducts: Product[] = []): Plan {
  return {
    settingsHash: 'h', exportId: 'test', tier: 2, reachable: [], unlocks: [], steps, flows, rawInputs, byproducts,
    power: { peakEUt: 0, averageEUt: 0, voltageTier: 0, amps: 0 }, buildList: [], buildSteps: [], warnings: [], status: 'ok', names: NAMES,
  };
}
const HOUR = 3600;
const codes = (issues: readonly PlanIssue[]): string[] => issues.map((i) => i.code);

describe('indexPlan', () => {
  it('flags an input nothing supplies', () => {
    // The mixer needs 0.223 L of PVA an hour; the plan neither makes nor buys any.
    const mixer = step('mixer', 'Mixer', 't:glue@0', 1 / HOUR, [per('fluid:pva', 0.223), per('t:resin@0', 1)], [per('t:glue@0', 1)]);
    const plan = planOf([mixer], [flow('mixer', 'out', 't:glue@0', 1 / HOUR), flow('raw', 'mixer', 't:resin@0', 1 / HOUR)], [raw('t:resin@0', 1 / HOUR)]);
    const index = indexPlan(plan);
    expect(index.issues).toHaveLength(1);
    expect(index.issues[0]).toMatchObject({ code: 'orphan-input', key: 'fluid:pva', stepId: 'mixer', gotPerSecond: 0 });
    expect(index.issues[0]?.needPerSecond).toBeCloseTo(0.223 / HOUR, 15);
    expect(index.inputs.get('mixer')?.get('fluid:pva')).toMatchObject({ perSecond: 0, peers: [] });
    expect(issueText(index.issues[0] as PlanIssue, plan)).toBe('Nothing supplies PVA to Mixer (Glue): it needs 0.223 L/h and the plan neither makes nor buys it.');
  });

  it('flags a good two steps make as their main output, largest first', () => {
    // The steps come sorted by id, so the smaller producer is listed first in steps and flows alike.
    const solid = step('solid', 'Fluid Solidifier', 't:iron_plate@0', 0.999, [], [per('t:iron_plate@0', 1)]);
    const saw = step('saw', 'Cutting Saw', 't:iron_plate@0', 0.001, [], [per('t:iron_plate@0', 1)]);
    const asm = step('asm', 'Assembler', 't:circuit@0', 1, [per('t:iron_plate@0', 1)], [per('t:circuit@0', 1)]);
    const plan = planOf([asm, saw, solid], [flow('asm', 'out', 't:circuit@0', 1), flow('saw', 'asm', 't:iron_plate@0', 0.001), flow('solid', 'asm', 't:iron_plate@0', 0.999)]);
    const index = indexPlan(plan);
    expect(codes(index.issues)).toEqual(['multi-producer']);
    const issue = index.issues[0] as PlanIssue;
    expect(issue).toMatchObject({ code: 'multi-producer', key: 't:iron_plate@0', stepIds: ['solid', 'saw'] });
    expect(issue.share?.[0]).toBeCloseTo(0.999, 9);
    expect(issue.share?.[1]).toBeCloseTo(0.001, 9);
    expect(issueText(issue, plan)).toBe('Iron Plate is made 2 ways: Fluid Solidifier (99.9%) and Cutting Saw (0.1%).');
    // Ports and producers list their peers largest first.
    expect(index.inputs.get('asm')?.get('t:iron_plate@0')).toMatchObject({ perSecond: 1, needPerSecond: 1,
      peers: [{ node: 'solid', perSecond: 0.999 }, { node: 'saw', perSecond: 0.001 }] });
    expect(index.outputs.get('solid')?.get('t:iron_plate@0')).toEqual({ perSecond: 0.999, peers: [{ node: 'asm', perSecond: 0.999 }] });
    expect(index.producers.get('t:iron_plate@0')?.map((p) => [p.stepId, p.main])).toEqual([['solid', true], ['saw', true]]);
    expect(index.producers.get('t:iron_plate@0')?.[0]?.share).toBeCloseTo(0.999, 9);
  });

  it('flags an input supplied short of what the step needs', () => {
    const short = (share: number): Plan => planOf(
      [step('asm', 'Assembler', 't:circuit@0', 1, [per('t:glue@0', 1)], [per('t:circuit@0', 1)]),
       step('mixer', 'Mixer', 't:glue@0', share, [], [per('t:glue@0', 1)])],
      [flow('asm', 'out', 't:circuit@0', 1), flow('mixer', 'asm', 't:glue@0', share)],
    );
    const plan = short(0.992);
    const index = indexPlan(plan);
    expect(index.issues).toMatchObject([{ code: 'short-input', key: 't:glue@0', stepId: 'asm', needPerSecond: 1, gotPerSecond: 0.992 }]);
    expect(issueText(index.issues[0] as PlanIssue, plan)).toBe('Assembler (Circuit) gets only 99.2% of the Glue it needs.');
    expect(indexPlan(short(0.996)).issues).toEqual([]);
    expect([ORPHAN_REL, SHORT_INPUT_SHARE]).toEqual([1e-6, 0.995]);
  });

  it('needs of a good only what a step takes beyond what it makes of it', () => {
    // Flows carry net amounts: a catalyst taken and handed back flows nowhere, and a step that makes more than it takes
    // of a good needs none of it.
    const reactor = step('react', 'Chemical Reactor', 't:pa@0', 1, [per('t:a@0', 1), per('t:b@0', 2)], [per('t:pa@0', 1), per('t:a@0', 1), per('t:b@0', 3)]);
    const plan = planOf([reactor], [flow('react', 'out', 't:pa@0', 1), flow('react', 'sink', 't:b@0', 1)], [], [per('t:b@0', 1)]);
    const index = indexPlan(plan);
    expect(index.issues).toEqual([]);
    expect(index.inputs.get('react')?.get('t:a@0')).toEqual({ perSecond: 0, peers: [], needPerSecond: 0 });
    expect(index.outputs.get('react')?.get('t:b@0')).toEqual({ perSecond: 1, peers: [{ node: 'sink', perSecond: 1 }] });
  });

  it('lets several steps make a good as a by-product', () => {
    // Both steps hand back an Empty Cell; neither is there for it.
    const plan = planOf(
      [step('asm', 'Assembler', 't:t@0', 1, [per('t:a@0', 1), per('t:b@0', 1)], [per('t:t@0', 1)]),
       step('fill-a', 'Canner', 't:a@0', 1, [], [per('t:a@0', 1), per('t:empty_cell@0', 1)]),
       step('fill-b', 'Canner', 't:b@0', 1, [], [per('t:b@0', 1), per('t:empty_cell@0', 1)])],
      [flow('asm', 'out', 't:t@0', 1), flow('fill-a', 'asm', 't:a@0', 1), flow('fill-a', 'sink', 't:empty_cell@0', 1),
       flow('fill-b', 'asm', 't:b@0', 1), flow('fill-b', 'sink', 't:empty_cell@0', 1)],
      [], [per('t:empty_cell@0', 2)],
    );
    const index = indexPlan(plan);
    expect(index.issues).toEqual([]);
    expect(index.producers.get('t:empty_cell@0')?.map((p) => [p.stepId, p.main])).toEqual([['fill-a', false], ['fill-b', false]]);
  });

  it('flags a good both bought and made', () => {
    const plan = planOf(
      [step('bend', 'Bending Machine', 't:iron_plate@0', 1, [per('t:iron_ingot@0', 1)], [per('t:iron_plate@0', 1)]),
       step('smelt', 'Furnace', 't:iron_ingot@0', 0.25, [], [per('t:iron_ingot@0', 1)])],
      [flow('bend', 'out', 't:iron_plate@0', 1), flow('raw', 'bend', 't:iron_ingot@0', 0.75), flow('smelt', 'bend', 't:iron_ingot@0', 0.25)],
      [raw('t:iron_ingot@0', 0.75)],
    );
    const index = indexPlan(plan);
    expect(index.issues).toMatchObject([{ code: 'bought-and-made', key: 't:iron_ingot@0', stepId: 'smelt' }]);
    expect(index.issues[0]?.share?.[0]).toBeCloseTo(0.75, 9);
    expect(issueText(index.issues[0] as PlanIssue, plan)).toBe('Iron Ingot is both bought (75%) and made by Furnace.');
    // Two recipes of one machine name it once.
    const twice = planOf(
      [...plan.steps, step('smelt-2', 'Furnace', 't:iron_ingot@0', 0.25, [], [per('t:iron_ingot@0', 1)])],
      [...plan.flows, flow('smelt-2', 'sink', 't:iron_ingot@0', 0.25)], plan.rawInputs, [per('t:iron_ingot@0', 0.25)],
    );
    const both = indexPlan(twice).issues.find((i) => i.code === 'bought-and-made') as PlanIssue;
    expect(both.stepIds).toEqual(['smelt', 'smelt-2']);
    expect(issueText(both, twice)).toBe('Iron Ingot is both bought (60%) and made by Furnace.');
  });

  it('sorts issues by code, then key, then step', () => {
    const plan = planOf(
      [step('a', 'Mixer', 't:pa@0', 1, [per('fluid:y', 1), per('fluid:x', 1)], [per('t:pa@0', 1)]),
       step('b', 'Mixer', 't:pb@0', 1, [per('fluid:x', 1), per('t:pa@0', 2)], [per('t:pb@0', 1)]),
       step('c', 'Mixer', 't:pa@0', 1, [], [per('t:pa@0', 1)])],
      [flow('a', 'b', 't:pa@0', 1), flow('b', 'out', 't:pb@0', 1), flow('c', 'b', 't:pa@0', 0.5), flow('c', 'sink', 't:pa@0', 0.5)],
      [], [per('t:pa@0', 0.5)],
    );
    expect(indexPlan(plan).issues.map((i) => [i.code, i.key, i.stepId])).toEqual([
      ['multi-producer', 't:pa@0', 'a'], ['orphan-input', 'fluid:x', 'a'], ['orphan-input', 'fluid:x', 'b'], ['orphan-input', 'fluid:y', 'a'],
      ['short-input', 't:pa@0', 'b'],
    ]);
  });

  it('leaves the goods a Make N batch comes out short of to its batch-short warning', () => {
    // Plan 09's final review: whole runs that leave a good short (cells the chain hands round) gave an issue at every step
    // that takes it, under the plan banner's red heading, beside the warning that says what to have ready before the
    // batch starts. That warning covers its goods (`keys`); any other shortfall is still an issue.
    const use = step('use', 'Assembler', 't:t@0', 1 / HOUR, [per('t:empty_cell@0', 2), per('fluid:pva', 1), per('t:glue@0', 1)], [per('t:t@0', 1)]);
    const can = step('can', 'Canner', 't:empty_cell@0', 1 / HOUR, [], [per('t:empty_cell@0', 1)]);
    const batch = planOf([use, can], [flow('can', 'use', 't:empty_cell@0', 1 / HOUR), flow('use', 'out', 't:t@0', 1 / HOUR)]);
    const issues = (warnings: Plan['warnings']) => indexPlan({ ...batch, warnings }).issues.map((i) => [i.code, i.key]);
    expect(issues([])).toEqual([['orphan-input', 'fluid:pva'], ['orphan-input', 't:glue@0'], ['short-input', 't:empty_cell@0']]);
    const short = { code: 'batch-short', key: 't:empty_cell@0', text: 'Whole crafts do not balance: have 1× Empty Cell ready before you start …' };
    expect(issues([{ ...short, keys: ['t:empty_cell@0', 'fluid:pva'] }])).toEqual([['orphan-input', 't:glue@0']]);
    // The batch still needs the cells it is short of: the port says so.
    expect(indexPlan({ ...batch, warnings: [{ ...short, keys: ['t:empty_cell@0'] }] }).inputs.get('use')?.get('t:empty_cell@0'))
      .toMatchObject({ needPerSecond: 2 / HOUR, perSecond: 1 / HOUR });
    // Only a batch-short warning's goods count.
    expect(issues([{ code: 'avoid-unavoidable', key: 't:empty_cell@0', text: 'Assembler uses Empty Cell', keys: ['t:empty_cell@0'] }])).toHaveLength(3);
  });
});
