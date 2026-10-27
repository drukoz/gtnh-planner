// The Pause pipes setting (ruling R31, WCAG 2.2.2 Pause, Stop, Hide; design spec §7 "Motion budget"): the pipes of the Flow and
// Connections diagrams move for as long as a diagram is shown, so the page offers a way to stop them. One value for this browser, kept in
// localStorage under `gtnh-planner:pipes-paused` and shared by both toolbars; a browser that refuses storage keeps it for the page.
// pipes.spec.ts presses the button in a browser; these cases pin how the setting is stored and the button. The store's storage cases (refused
// storage, storage read but not written, its subscribers) are browser-choice.test.tsx's, asserted there for this setting (ledger ruling P2-R40).

import { isValidElement, type ReactElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { afterEach, describe, it, expect, vi } from 'vitest';
import { PipesButton } from '../../src/client/components/PipesButton.tsx';
import { PIPES_PAUSED_KEY, getPipesPaused, setPipesPaused } from '../../src/client/state/pipes-paused.ts';
import { keepIn } from './storage-stub.ts';

/** What `PipesButton` renders, unrendered, so that its props can be read. */
function button(paused: boolean): ReactElement<Record<string, unknown>> {
  const element = PipesButton({ paused });
  if (!isValidElement<Record<string, unknown>>(element)) throw new Error('PipesButton rendered no element');
  return element;
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('the Pause pipes setting', () => {
  it('is off by default', () => {
    vi.stubGlobal('localStorage', keepIn(new Map()));
    expect(getPipesPaused()).toBe(false);
  });

  it('keeps a pause in this browser\'s storage, and finds it there when the page is loaded again', () => {
    expect(PIPES_PAUSED_KEY).toBe('gtnh-planner:pipes-paused');
    const store = new Map<string, string>();
    vi.stubGlobal('localStorage', keepIn(store));
    setPipesPaused(true);
    expect([store.get(PIPES_PAUSED_KEY), getPipesPaused()]).toEqual(['1', true]);
    setPipesPaused(false);
    expect([store.get(PIPES_PAUSED_KEY), getPipesPaused()]).toEqual(['0', false]);
    // what an earlier visit or another tab of this browser kept is read from the storage, not from this page
    store.set(PIPES_PAUSED_KEY, '1');
    expect(getPipesPaused()).toBe(true);
    // and anything but the pause's own value is no pause
    store.set(PIPES_PAUSED_KEY, 'yes');
    expect(getPipesPaused()).toBe(false);
  });
});

describe('the Pause pipes button', () => {
  // R44 (Phase 2 spec §17, §3.9): no `aria-pressed`, the label says what a press does; its key is P (spec §14), which its tip says too
  it('is a small text button that says what pressing it does, and whether the pipes are paused', () => {
    expect(renderToStaticMarkup(<PipesButton paused={false} />)).toBe('<button type="button" class="small" aria-keyshortcuts="P" data-tip="Pause pipes · P">Pause pipes</button>');
    expect(renderToStaticMarkup(<PipesButton paused />)).toBe('<button type="button" class="small" aria-keyshortcuts="P" data-tip="Play pipes · P">Play pipes</button>');
  });

  // Task 11's fix round 1 (ledger ruling P2-R85): with the single-key shortcuts off it says no key and has no tip, as before Task 11
  it('says no key, and has no tip, while the single-key shortcuts are off', () => {
    expect(renderToStaticMarkup(<PipesButton paused={false} keys={false} />)).toBe('<button type="button" class="small">Pause pipes</button>');
    expect(renderToStaticMarkup(<PipesButton paused keys={false} />)).toBe('<button type="button" class="small">Play pipes</button>');
  });

  it('pauses the pipes when they move, and plays them when they are paused', () => {
    vi.stubGlobal('localStorage', keepIn(new Map()));
    (button(false).props.onClick as () => void)();
    expect(getPipesPaused()).toBe(true);
    (button(true).props.onClick as () => void)();
    expect(getPipesPaused()).toBe(false);
  });
});
