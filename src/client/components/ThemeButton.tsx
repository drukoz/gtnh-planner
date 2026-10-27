// The Theme button at the end of the top bar (Phase 2 spec §4.8, D2): it says which look the page is in, and a press moves to the next,
// Auto → Dark → Light → Auto (state/theme.ts keeps the choice for this browser). Its words are its name, so it has no aria-label, and it
// is a three-state round whose words say the state, so it has no aria-pressed either (the pattern R44 settles). The stylesheet draws a
// pixel icon before the words from data-choice. It takes the choice as a prop and holds no hooks, as PipesButton does, so a test can call
// it and read its onClick; TopNav reads the store.

import type { ReactElement } from 'react';
import { nextThemeChoice, setThemeChoice, type ThemeChoice } from '../state/theme.ts';

const LABELS: Readonly<Record<ThemeChoice, string>> = { auto: 'Auto', dark: 'Dark', light: 'Light' };

export function ThemeButton(props: { choice: ThemeChoice }): ReactElement {
  const { choice } = props;
  return (
    <button type="button" className="theme-button" data-choice={choice} onClick={() => setThemeChoice(nextThemeChoice(choice))}>
      {`Theme: ${LABELS[choice]}`}
    </button>
  );
}
