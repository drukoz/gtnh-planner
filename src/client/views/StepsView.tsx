// The build steps (spec §3.10): the plan's steps in order, each one a row anyone can cross off, showing who did it and
// when. A step with a map pin links to it: the link focuses the pin and opens the Map tab, which centres on it.

import type { ReactElement } from 'react';
import { Tick } from '../components/Tick.tsx';
import { focusPin } from '../state/pin-focus.ts';
import type { ProjectViewProps } from './project-tabs.ts';

function showPin(n: number): void {
  focusPin(n);
  location.hash = '#map';
}

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
            const { pin } = step;
            return (
              <li key={step.id} className="step-row">
                <Tick row={row} mark={project.marks[row]} label={step.text} onToggle={(on) => send([{ op: 'mark', row, on }])}>
                  {pin !== undefined && (
                    <button type="button" className="pin-link" data-pin={pin} onClick={() => showPin(pin)}>{`pin ${pin}`}</button>
                  )}
                </Tick>
              </li>
            );
          })}
        </ol>
      )}
    </section>
  );
}
