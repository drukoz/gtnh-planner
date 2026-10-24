// The Settings button of the project head (design spec §7a): below 900 px the settings column is a drawer, and this button
// opens and closes it. The stylesheet hides it on wider screens, where the column stays beside the views. The page passes a
// `ref` (React 19 hands it to a function component as a prop) to give the focus back to the button whenever the drawer is closed
// by a way out of it: Escape, the dimmed page, its Close settings button (ruling R36).

import type { ReactElement, Ref } from 'react';

export function SettingsToggle(props: { open: boolean; onToggle: () => void; ref?: Ref<HTMLButtonElement> }): ReactElement {
  const { open, onToggle, ref } = props;
  return (
    <button type="button" className="settings-toggle" aria-expanded={open} aria-controls="project-settings" onClick={onToggle} ref={ref}>
      Settings
    </button>
  );
}
