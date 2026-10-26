// The Pause pipes button of the Flow and Connections toolbars (ruling R31, WCAG 2.2.2 Pause, Stop, Hide): the pipes' contents move
// for as long as a diagram is shown, so the page offers a way to stop them where they are, and to play them again. A small text
// button after Fit whose label says what a press does, Pause pipes or Play pipes, and so whether the pipes are paused (R44: no
// `aria-pressed`). Its key is P (Phase 2 spec §14), which its tip says too. The setting is one for this browser (state/pipes-paused.ts),
// so the two toolbars agree; the diagram that shows it reads it to pause its pipes.

import type { ReactElement } from 'react';
import { setPipesPaused } from '../state/pipes-paused.ts';

export function PipesButton(props: { paused: boolean }): ReactElement {
  const { paused } = props;
  const label = paused ? 'Play pipes' : 'Pause pipes';
  return (
    <button type="button" className="small" aria-keyshortcuts="P" data-tip={`${label} · P`} onClick={() => setPipesPaused(!paused)}>
      {label}
    </button>
  );
}
