// The Settings button of the project head (restyle plan Phase 1 Task 4, design spec §7a): on a screen narrower than 900 px the
// settings column is a drawer, and this button opens and closes it. It is a plain button that names the aside it controls
// (`project-settings`) and says whether that is open; the stylesheet hides it on wide screens.

import { createRef, isValidElement, type ReactElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, it, expect, vi } from 'vitest';
import { SettingsToggle } from '../../src/client/components/SettingsToggle.tsx';

/** What `SettingsToggle` renders, unrendered, so that its props can be read. */
function button(props: Parameters<typeof SettingsToggle>[0]): ReactElement<Record<string, unknown>> {
  const element = SettingsToggle(props);
  if (!isValidElement<Record<string, unknown>>(element)) throw new Error('SettingsToggle rendered no element');
  return element;
}

describe('the Settings toggle', () => {
  it('is a button that names the drawer it controls and says whether it is open', () => {
    expect(renderToStaticMarkup(<SettingsToggle open={false} onToggle={() => {}} />)).toBe(
      '<button type="button" class="settings-toggle" aria-expanded="false" aria-controls="project-settings">Settings</button>',
    );
    expect(renderToStaticMarkup(<SettingsToggle open onToggle={() => {}} />)).toContain('aria-expanded="true"');
  });

  it('asks the page to open or close the drawer when it is clicked', () => {
    const onToggle = vi.fn();
    const onClick = button({ open: false, onToggle }).props.onClick as () => void;
    onClick();
    expect(onToggle).toHaveBeenCalledOnce();
  });

  it('hands the page its button, so the focus can go back to it when Escape closes the drawer', () => {
    const ref = createRef<HTMLButtonElement>();
    expect(button({ open: false, onToggle: () => {}, ref }).props.ref).toBe(ref);
  });
});
