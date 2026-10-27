// The look of the page (Phase 2 spec §4, D2): Auto, Dark or Light, one choice for this browser kept in localStorage under
// `gtnh-planner:theme`. Auto is the default and puts no data-theme on <html>, so the stylesheet follows the OS by itself; Dark and Light
// set data-theme, which outranks the OS. The head script of index.html applies a stored Dark or Light before the app runs. These cases pin
// how the choice is stored, the button and the head script; theme.spec.ts drives them in a browser. The store's storage cases (refused or
// unwritable storage, its subscribers and storage events) are browser-choice.test.tsx's, asserted there for the look (ledger ruling P2-R40).

import { readFileSync } from 'node:fs';
import { renderToStaticMarkup } from 'react-dom/server';
import { afterEach, describe, it, expect, vi } from 'vitest';
import { ThemeButton } from '../../src/client/components/ThemeButton.tsx';
import { THEME_CHOICES, THEME_KEY, applyTheme, getThemeChoice, nextThemeChoice, setThemeChoice } from '../../src/client/state/theme.ts';
import { keepIn } from './storage-stub.ts';

// A choice that storage keeps sets the module's page value back to null, which `vi.unstubAllGlobals()` alone would not: a test that
// left a page value behind would decide the next one's reads.
afterEach(() => {
  vi.stubGlobal('localStorage', keepIn(new Map()));
  setThemeChoice('auto');
  vi.unstubAllGlobals();
});

describe('the look of the page', () => {
  it('reads Auto by default, keeps each choice, and reads junk as Auto', () => {
    expect(THEME_KEY).toBe('gtnh-planner:theme'); expect(THEME_CHOICES).toEqual(['auto', 'dark', 'light']);
    const store = new Map<string, string>(); vi.stubGlobal('localStorage', keepIn(store));
    expect(getThemeChoice()).toBe('auto');
    for (const choice of ['dark', 'light', 'auto'] as const) { setThemeChoice(choice); expect([store.get(THEME_KEY), getThemeChoice()]).toEqual([choice, choice]); }
    store.set(THEME_KEY, 'sepia'); expect(getThemeChoice()).toBe('auto');
  });

  it('cycles Auto → Dark → Light → Auto', () => expect(THEME_CHOICES.map(nextThemeChoice)).toEqual(['dark', 'light', 'auto']));

  it('applies Dark and Light as data-theme, and Auto as none', () => {
    const root = { setAttribute: vi.fn(), removeAttribute: vi.fn() };
    applyTheme('dark', root); applyTheme('light', root); applyTheme('auto', root);
    expect(root.setAttribute.mock.calls).toEqual([['data-theme', 'dark'], ['data-theme', 'light']]);
    expect(root.removeAttribute.mock.calls).toEqual([['data-theme']]);
  });
});

describe('the Theme button', () => {
  it('draws the Theme button for each choice, and its click moves to the next', () => {
    expect(renderToStaticMarkup(<ThemeButton choice="auto" />)).toBe('<button type="button" class="theme-button" data-choice="auto">Theme: Auto</button>');
    expect(renderToStaticMarkup(<ThemeButton choice="dark" />)).toBe('<button type="button" class="theme-button" data-choice="dark">Theme: Dark</button>');
    expect(renderToStaticMarkup(<ThemeButton choice="light" />)).toBe('<button type="button" class="theme-button" data-choice="light">Theme: Light</button>');
    vi.stubGlobal('localStorage', keepIn(new Map())); (ThemeButton({ choice: 'dark' }).props.onClick as () => void)(); expect(getThemeChoice()).toBe('light');
  });
});

describe('the head script', () => {
  it('applies a stored Dark or Light in the head, before the app, and nothing else', () => {
    const html = readFileSync(new URL('../../src/client/index.html', import.meta.url), 'utf8');
    const body = /<script>([\s\S]*?)<\/script>/.exec(html)![1]!;          // an attribute-less <script>: no type, no src
    expect(html.indexOf('<script>')).toBeGreaterThan(html.indexOf('<title>')); expect(html.indexOf('<script>')).toBeLessThan(html.indexOf('</head>'));
    expect(body).toContain(`'${THEME_KEY}'`);
    const run = (stored: string | null | 'throws'): unknown[][] => {
      const root = { setAttribute: vi.fn() };
      new Function('document', 'localStorage', body)({ documentElement: root }, { getItem: () => { if (stored === 'throws') throw new Error('refused'); return stored; } });
      return root.setAttribute.mock.calls;
    };
    expect(run('dark')).toEqual([['data-theme', 'dark']]); expect(run('light')).toEqual([['data-theme', 'light']]);
    for (const stored of ['auto', 'junk', null, 'throws'] as const) expect(run(stored), String(stored)).toEqual([]);
  });
});
