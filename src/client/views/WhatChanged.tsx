// The "What changed" note above the flow diagram and the materials (fix spec §6.4, D21): after a settings change brings
// a new plan, which imports and steps came and went and which problems are new. Dismissing it hides that change in
// every tab of the page until the next one.

import { useState, type ReactElement } from 'react';
import type { Plan } from '../../shared/types/plan.ts';
import { changeLines, isNoChange, planChange } from './plan-diff.ts';

/**
 * The changes dismissed on this page, by the plan each replaced (the store's `previousPlan`, shared by its tabs): the
 * next change replaces another plan, also when its settings come round again or another project makes the same one.
 */
const dismissed = new WeakSet<Plan>();

/** Dismisses the note of the change that replaced `previous`, in every tab of the page. */
export function dismissChange(previous: Plan): void {
  dismissed.add(previous);
}

/**
 * Whether `plan` is the first plan of its target, which changes nothing a reader saw: `previous` planned nothing (no
 * target picked yet, or the line could not be planned) or planned another target.
 */
function firstOfTarget(previous: Plan, plan: Plan): boolean {
  if ((previous.status ?? 'ok') !== 'ok') return true;
  return previous.target !== undefined && plan.target !== undefined && previous.target !== plan.target;
}

export function WhatChanged(props: { previous: Plan | null | undefined; plan: Plan }): ReactElement | null {
  const { previous, plan } = props;
  const [, setShown] = useState(0);
  if (previous === null || previous === undefined || previous.settingsHash === plan.settingsHash) return null;
  if (firstOfTarget(previous, plan) || dismissed.has(previous)) return null;
  const change = planChange(previous, plan);
  if (isNoChange(change)) return null;
  const dismiss = (): void => {
    dismissChange(previous);
    setShown((n) => n + 1);
  };
  return (
    <section className="what-changed" aria-label="What changed" role="status">
      <div className="what-changed-head">
        <h4>What changed</h4>
        <button type="button" className="small" onClick={dismiss}>Dismiss</button>
      </div>
      <ul>
        {changeLines(previous, plan, change).map((line, i) => <li key={`${i}:${line}`}>{line}</li>)}
      </ul>
    </section>
  );
}
