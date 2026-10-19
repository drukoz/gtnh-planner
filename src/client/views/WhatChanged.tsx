// The "What changed" note above the flow diagram and the materials (fix spec §6.4, D21): after a settings change brings
// a new plan, which imports and steps came and went and which problems are new. Dismissing it hides that change in
// every tab of the page until the next one.

import { useState, type ReactElement } from 'react';
import type { Plan } from '../../shared/types/plan.ts';
import { changeLines, isNoChange, planChange } from './plan-diff.ts';

/** The changes dismissed on this page ("<old settings hash>><new settings hash>"), shared by its tabs. */
const dismissed = new Set<string>();

export function WhatChanged(props: { previous: Plan | null | undefined; plan: Plan }): ReactElement | null {
  const { previous, plan } = props;
  const [, setShown] = useState(0);
  if (previous === null || previous === undefined || previous.settingsHash === plan.settingsHash) return null;
  const id = `${previous.settingsHash}>${plan.settingsHash}`;
  if (dismissed.has(id)) return null;
  const change = planChange(previous, plan);
  if (isNoChange(change)) return null;
  const dismiss = (): void => {
    dismissed.add(id);
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
