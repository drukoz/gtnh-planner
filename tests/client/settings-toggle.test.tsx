// The Settings button of the project head (restyle plan Phase 1 Task 4, design spec §7a): on a screen narrower than 900 px the
// settings column is a drawer, and this button opens and closes it. It is a plain button that names the aside it controls
// (`project-settings`) and says whether that is open; the stylesheet hides it on wide screens. It also says what the line makes, so
// that the most important setting is never out of sight behind it: "Settings · Make: Basic Circuit", or "· Make: nothing yet".

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

/** What a reader sees: the markup without its tags, entities decoded, runs of white space as one space. */
function text(html: string): string {
  return html.replace(/<[^>]+>/g, '').replace(/&#x27;/g, "'").replace(/&quot;/g, '"').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&amp;/g, '&')
    .replace(/\s+/g, ' ').trim();
}

describe('the Settings toggle', () => {
  it('is a button that names the drawer it controls and says whether it is open', () => {
    expect(renderToStaticMarkup(<SettingsToggle open={false} onToggle={() => {}} targetName={null} />)).toBe(
      '<button type="button" class="settings-toggle" aria-expanded="false" aria-controls="project-settings">Settings <span class="settings-toggle-target">· Make: nothing yet</span></button>',
    );
    expect(renderToStaticMarkup(<SettingsToggle open onToggle={() => {}} targetName={null} />)).toContain('aria-expanded="true"');
  });

  it('says there is nothing to make yet while the project has no target', () => {
    const html = renderToStaticMarkup(<SettingsToggle open={false} onToggle={() => {}} targetName={null} />);
    expect(text(html)).toBe('Settings · Make: nothing yet');
    expect(html).not.toContain('title=');                                            // nothing to spell out in full
  });

  it('says what is being made: the target, named as the settings panel names it', () => {
    const html = renderToStaticMarkup(<SettingsToggle open={false} onToggle={() => {}} targetName="Basic Circuit" />);
    expect(text(html)).toBe('Settings · Make: Basic Circuit');
    expect(html).toContain('<span class="settings-toggle-target" title="Basic Circuit">· Make: Basic Circuit</span>');
    // the smaller part is its own element, for the stylesheet to set in Inter and cut with an ellipsis
    expect(html.match(/<span /g)).toHaveLength(1);
  });

  it('keeps a long name whole, for the stylesheet to cut, and a name with markup in it a name', () => {
    const long = 'Large Extremely Long Named Industrial Multiblock Processing Array Controller Casing';
    expect(text(renderToStaticMarkup(<SettingsToggle open={false} onToggle={() => {}} targetName={long} />))).toBe(`Settings · Make: ${long}`);
    const html = renderToStaticMarkup(<SettingsToggle open={false} onToggle={() => {}} targetName={'<b>Steel</b> & "Iron"'} />);
    expect(html).not.toContain('<b>');
    expect(text(html)).toBe('Settings · Make: <b>Steel</b> & "Iron"');
  });

  it('is named by its own text, so the name holds the visible text (WCAG 2.5.3)', () => {
    // no aria-label, aria-labelledby or aria-hidden part that could make the name differ from what is drawn: the name is the text the button holds
    for (const targetName of [null, 'Basic Circuit']) {
      const html = renderToStaticMarkup(<SettingsToggle open={false} onToggle={() => {}} targetName={targetName} />);
      expect(html).not.toMatch(/aria-(label|labelledby|hidden|describedby)=/);
      expect(text(html)).toMatch(/^Settings · Make: /);
    }
  });

  it('asks the page to open or close the drawer when it is clicked', () => {
    const onToggle = vi.fn();
    const onClick = button({ open: false, onToggle, targetName: null }).props.onClick as () => void;
    onClick();
    expect(onToggle).toHaveBeenCalledOnce();
  });

  it('hands the page its button, so the focus can go back to it when Escape closes the drawer', () => {
    const ref = createRef<HTMLButtonElement>();
    expect(button({ open: false, onToggle: () => {}, targetName: null, ref }).props.ref).toBe(ref);
  });
});
