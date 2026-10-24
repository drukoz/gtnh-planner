// The Pause pipes button of the Flow and Connections toolbars (ruling R31, WCAG 2.2.2 Pause, Stop, Hide): the pipes' contents move
// for as long as a diagram is shown, so the page offers a way to stop them where they are, and to play them again. A small text
// button after Fit that says what pressing it does, with `aria-pressed` saying whether the pipes are paused. The setting is one for
// this browser (state/pipes-paused.ts), so the two toolbars agree; the diagram that shows it reads it to pause its pipes.

import type { ReactElement } from 'react';
import { setPipesPaused } from '../state/pipes-paused.ts';

export function PipesButton(props: { paused: boolean }): ReactElement {
  const { paused } = props;
  return (
    <button type="button" className="small" aria-pressed={paused} onClick={() => setPipesPaused(!paused)}>
      {paused ? 'Play pipes' : 'Pause pipes'}
    </button>
  );
}
