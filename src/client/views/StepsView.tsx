// The build steps (spec §3.10): the plan's steps in order, each one a row anyone can cross off, showing who did it and
// when. Plan 5 adds a link from a step to its map pin.

import type { ReactElement } from 'react';
import { Tick } from '../components/Tick.tsx';
import type { ProjectViewProps } from './project-tabs.ts';

export function StepsView(props: ProjectViewProps): ReactElement {
  const { project, plan, send } = props;
  const steps = [...(plan?.buildSteps ?? [])].sort((a, b) => a.order - b.order);
  return (
    <section className="materials-section build-steps" aria-labelledby="build-steps-title">
      <h3 id="build-steps-title">Build steps</h3>
      {steps.length === 0 ? (
        <p className="muted">No build steps yet.</p>
      ) : (
        <ol className="step-list">
          {steps.map((step) => {
            const row = `step:${step.id}`;
            return (
              <li key={step.id} className="step-row">
                <Tick row={row} mark={project.marks[row]} label={step.text} onToggle={(on) => send([{ op: 'mark', row, on }])} />
              </li>
            );
          })}
        </ol>
      )}
    </section>
  );
}
