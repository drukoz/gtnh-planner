// Sharing pools of a plan's steps (plan 12, architecture §11.39, `PlanStep.pool`): the steps of one pool run on the same
// machines, so whatever counts machines — the plan's build cost, its power, the place step, the configure step, the build
// list, the layout — counts a pool once, at its first step (ruling P18: one helper for all of them); and what the steps
// a shared machine runs are called where the client names them (the step panel, the Connections view).
// Pure TypeScript shared by server and browser: nothing from node:* and no DOM.

import type { StuffKey } from '../keys.ts';
import type { Plan, PlanStep } from '../types/plan.ts';

/**
 * A step of `plan` by what it makes, as the layout names the steps a shared machine runs: the name of its main output,
 * else of its first output, else its id (also for an id the plan lacks).
 */
export function stepNameIn(plan: Pick<Plan, 'steps'>, stepId: string, nameOf: (key: StuffKey) => string): string {
  const step = plan.steps.find((s) => s.id === stepId);
  const key = step?.mainOutput ?? step?.outputs[0]?.key;
  return key === undefined ? stepId : nameOf(key);
}

/**
 * The steps grouped by the machines they hold, in step order: each step outside a sharing pool alone, and each sharing
 * pool once, where its first step (`pool.steps[0]`) stands, with every step of the pool in the plan in `pool.steps` order
 * (that first step first). A group's first step speaks for its machines: its `count`, `owned` and `reused.units` are the
 * pool's.
 */
export function machineGroups(steps: readonly PlanStep[]): PlanStep[][] {
  const byId = new Map<string, PlanStep>();
  for (const step of steps) if (step.pool !== undefined && !byId.has(step.id)) byId.set(step.id, step);
  const groups: PlanStep[][] = [];
  const placed = new Set<PlanStep>();
  for (const step of steps) {
    if (placed.has(step)) continue;
    const pool = step.pool;
    if (pool === undefined) {
      groups.push([step]);
      placed.add(step);
      continue;
    }
    const members = pool.steps.flatMap((id) => {
      const member = byId.get(id);
      return member === undefined || member.pool?.id !== pool.id || placed.has(member) ? [] : [member];
    });
    // A step of a pool whose listed steps the plan lacks still counts its own machines.
    const group = members.includes(step) ? members : [step, ...members];
    for (const member of group) placed.add(member);
    groups.push(group);
  }
  return groups;
}
