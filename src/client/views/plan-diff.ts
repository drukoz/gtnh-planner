// What changed between the plan a settings change replaced and the plan it brought (fix spec §6.4, D21): the imports
// and the steps that came and went (steps by recipe id, imports by key) and the problems that are new, so a click on
// "Make it here instead" or a pin says what it did. Pure functions; the note that shows them is WhatChanged.tsx.

import type { StuffKey } from '../../shared/keys.ts';
import { indexPlan, issueText, type PlanIssue } from '../../shared/plan/balance.ts';
import type { Plan, PlanStep } from '../../shared/types/plan.ts';

export interface PlanChange {
  importsAdded: StuffKey[]; importsRemoved: StuffKey[];
  /** Recipe ids, in the order of the plan they are in. */
  stepsAdded: string[]; stepsRemoved: string[];
  /** Integrity issues (`indexPlan`) of the new plan that the old one did not have. */
  issuesNew: PlanIssue[];
}

/** An issue's identity, or a warning's: the same problem of the same good at the same step. */
function issueId(problem: { code: string; key?: StuffKey | undefined; stepId?: string | undefined }): string {
  return `${problem.code}|${problem.key ?? ''}|${problem.stepId ?? ''}`;
}

/** What `next` imports and runs that `prev` did not, what it no longer does, and its new problems. */
export function planChange(prev: Plan, next: Plan): PlanChange {
  const imports = (plan: Plan): Set<StuffKey> => new Set(plan.rawInputs.map((r) => r.key));
  const recipes = (plan: Plan): Set<string> => new Set(plan.steps.map((s) => s.recipeId));
  const [importsBefore, importsAfter] = [imports(prev), imports(next)];
  const [stepsBefore, stepsAfter] = [recipes(prev), recipes(next)];
  const known = new Set(indexPlan(prev).issues.map(issueId));
  return {
    importsAdded: [...importsAfter].filter((key) => !importsBefore.has(key)),
    importsRemoved: [...importsBefore].filter((key) => !importsAfter.has(key)),
    stepsAdded: [...stepsAfter].filter((id) => !stepsBefore.has(id)),
    stepsRemoved: [...stepsBefore].filter((id) => !stepsAfter.has(id)),
    issuesNew: indexPlan(next).issues.filter((issue) => !known.has(issueId(issue))),
  };
}

/** Whether nothing a reader would notice changed. */
export function isNoChange(change: PlanChange): boolean {
  return change.importsAdded.length + change.importsRemoved.length + change.stepsAdded.length + change.stepsRemoved.length + change.issuesNew.length === 0;
}

/** "Fluid Extractor (Molten Polyethylene)": a step by its machine and the name of what it makes. */
function stepWords(step: PlanStep, plan: Plan): string {
  const main = step.mainOutput;
  return main === undefined ? step.machine.name : `${step.machine.name} (${plan.names?.[main] ?? main})`;
}

/**
 * The change in words, one line each: the imports and steps that came and went (names from the plan they are in), and
 * each new problem in the server's words when the plan carries them, else `issueText`'s.
 */
export function changeLines(prev: Plan, next: Plan, change: PlanChange): string[] {
  const nameIn = (plan: Plan) => (key: StuffKey): string => plan.names?.[key] ?? key;
  const stepsIn = (plan: Plan, ids: readonly string[]): string[] => {
    const byRecipe = new Map(plan.steps.map((s) => [s.recipeId, s]));
    return ids.map((id) => {
      const step = byRecipe.get(id);
      return step === undefined ? id : stepWords(step, plan);
    });
  };
  const served = new Map(next.warnings.map((w) => [issueId(w), w.text]));
  const lines: string[] = [];
  const add = (label: string, items: readonly string[]): void => {
    if (items.length > 0) lines.push(`${label}: ${items.join(', ')}`);
  };
  add('New imports', change.importsAdded.map(nameIn(next)));
  add('No longer imported', change.importsRemoved.map(nameIn(prev)));
  add('New steps', stepsIn(next, change.stepsAdded));
  add('Steps no longer needed', stepsIn(prev, change.stepsRemoved));
  for (const issue of change.issuesNew) lines.push(`New problem: ${served.get(issueId(issue)) ?? issueText(issue, next)}`);
  return lines;
}
