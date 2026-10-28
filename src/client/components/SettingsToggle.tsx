// The Settings button of the project head (design spec §7a): below 900 px the settings column is a drawer, and this button
// opens and closes it. The stylesheet hides it on wider screens, where the column stays beside the views. The page passes a
// `ref` (React 19 hands it to a function component as a prop) to give the focus back to the button whenever the drawer is closed
// by a way out of it: Escape, the dimmed page, its Close settings button (ruling R36).
//
// The button also says what the line makes, "Settings · Make: Basic Circuit" or "Settings · Make: nothing yet", so that the most
// important setting is never out of sight behind it. The button is named by the text it holds, so its name holds what is drawn
// (WCAG 2.5.3): nothing here replaces or hides a part of it. The stylesheet sets the target's part small and cuts a long name with
// an ellipsis, which is why the name is also its `title`.

import type { ReactElement, Ref } from 'react';

export function SettingsToggle(props: {
  open: boolean; onToggle: () => void; ref?: Ref<HTMLButtonElement>;
  /** What the project makes, named as the settings panel names it, or null while it has no target. */
  targetName: string | null;
}): ReactElement {
  const { open, onToggle, ref, targetName } = props;
  return (
    <button type="button" className="settings-toggle" aria-expanded={open} aria-controls="project-settings" onClick={onToggle} ref={ref}>
      Settings{' '}
      <span className="settings-toggle-target" title={targetName ?? undefined}>{`· Make: ${targetName ?? 'nothing yet'}`}</span>
    </button>
  );
}
