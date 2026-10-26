// Keyboard shortcuts (Phase 2 spec §14, D16; Task 11): one handler on the project page decides what a key does through a pure function, which
// these cases pin: `/` the item search, 1–6 the tabs, F Fit, P Pause pipes and ? the sheet that lists them; never a key typed in a field, one
// with Ctrl, Cmd or Alt, while composing, repeating or once something has handled it, and never inside an in-app confirm (ledger ruling
// P2-R73). Shift is no reason to skip: some layouts type the digits and ? with it (Review Focus 5). shortcuts.spec.ts shows it in a browser.

import { renderToStaticMarkup } from 'react-dom/server';
import { afterEach, describe, it, expect, vi } from 'vitest';
import { ShortcutsDialog } from '../../src/client/components/ShortcutsSheet.tsx';
import { isTypingTarget, shortcutOf, SHORTCUT_ROWS, type KeyLike, type TargetLike } from '../../src/client/state/shortcuts.ts';
import { SINGLE_KEY_SHORTCUTS_KEY, getSingleKeyShortcuts, setSingleKeyShortcuts } from '../../src/client/state/single-key-shortcuts.ts';
import { keepIn } from './storage-stub.ts';

const key = (k: string, over: Partial<KeyLike> = {}): KeyLike => ({ key: k, ctrlKey: false, metaKey: false, altKey: false, shiftKey: false, defaultPrevented: false, isComposing: false, repeat: false, ...over });
const el = (tagName: string, over: Partial<TargetLike> = {}): TargetLike => ({ tagName, closest: () => null, ...over });

describe('keyboard shortcuts', () => {
  it('counts a field, a text area, a select, an editable and a list as typing, and a tick or a button not', () => {
    for (const type of [undefined, 'text', 'search', 'number', 'email', 'password', 'url', 'tel']) expect(isTypingTarget(el('INPUT', { type })), String(type)).toBe(true);
    for (const type of ['checkbox', 'radio', 'range', 'button', 'submit', 'reset', 'file', 'color', 'image']) expect(isTypingTarget(el('INPUT', { type })), type).toBe(false);
    // an element inside a combobox or a listbox: `closest` matches a part of the selector list exactly
    const inside = (role: string): TargetLike => el('LI', { closest: (s) => (s.split(',').map((p) => p.trim()).includes(`[role="${role}"]`) ? {} : null) });
    expect([el('TEXTAREA'), el('SELECT'), el('DIV', { isContentEditable: true }), inside('combobox'), inside('listbox')].map(isTypingTarget)).toEqual([true, true, true, true, true]);
    expect(isTypingTarget(inside('menu'))).toBe(false); expect(isTypingTarget(el('BUTTON'))).toBe(false); expect(isTypingTarget(null)).toBe(false);
  });

  it('maps / 1–6 F P and ?', () => {
    expect(shortcutOf(key('/'), null)).toEqual({ kind: 'search' });
    expect(['1', '2', '3', '4', '5', '6'].map((k) => shortcutOf(key(k), null))).toEqual([0, 1, 2, 3, 4, 5].map((index) => ({ kind: 'tab', index })));
    expect(shortcutOf(key('7'), null)).toBeNull(); expect(shortcutOf(key('Escape'), null)).toBeNull();
    for (const k of ['f', 'F']) expect(shortcutOf(key(k), null)).toEqual({ kind: 'fit' }); for (const k of ['p', 'P']) expect(shortcutOf(key(k), null)).toEqual({ kind: 'pipes' });
    expect(shortcutOf(key('?'), null)).toEqual({ kind: 'sheet' });
  });

  it('leaves a key alone with Ctrl, Cmd or Alt, while composing, repeating, once handled, or in a field', () => {
    for (const over of [{ ctrlKey: true }, { metaKey: true }, { altKey: true }, { isComposing: true }, { repeat: true }, { defaultPrevented: true }]) expect(shortcutOf(key('1', over), null)).toBeNull();
    expect(shortcutOf(key('1'), el('INPUT', { type: 'text' }))).toBeNull();
  });

  it('ignores Shift: AZERTY digits and ? still work', () => {   // Review Focus 5
    expect(shortcutOf(key('1', { shiftKey: true }), null)).toEqual({ kind: 'tab', index: 0 }); expect(shortcutOf(key('?', { shiftKey: true }), null)).toEqual({ kind: 'sheet' });
  });

  // ledger ruling P2-R73: while an in-app confirm asks, the keyboard stays with it (P2-R66), so a key pressed inside it is no shortcut: a digit
  // must not pull the focus out to a tab. A button outside one takes them all
  it('takes no shortcut inside an in-app confirm', () => {
    const inConfirm = el('BUTTON', { closest: (s) => (s === '[role="alertdialog"]' ? {} : null) });
    for (const k of ['/', '5', 'f', 'p', '?']) expect(shortcutOf(key(k), inConfirm), k).toBeNull();
    expect(shortcutOf(key('5'), el('BUTTON'))).toEqual({ kind: 'tab', index: 4 });
  });

  it('lists the mockup\'s rows, and draws them in a dialog named by its title', () => {
    expect(SHORTCUT_ROWS).toEqual([[['/'], 'Search items and fluids'], [['1', '–', '6'], 'Switch tabs: Map, 3D, Connections, Flow, Materials, Notes'], [['F'], 'Fit the diagram'],
      [['P'], 'Pause or play the pipes'], [['Esc'], 'Close a panel, clear the highlight, close the drawer'], [['?'], 'Show this sheet']]);
    const html = renderToStaticMarkup(<ShortcutsDialog onClose={() => {}} />);
    expect(html).toMatch(/<div class="modal shortcuts-sheet" role="dialog" aria-modal="true" aria-labelledby="([^"]+)"><h2 id="\1">Keyboard shortcuts<\/h2>/);
    expect(html).toContain('<dt><kbd><span class="fig">1</span></kbd>–<kbd><span class="fig">6</span></kbd></dt>'); expect(html.match(/<dt>/g)).toHaveLength(6); expect(html).toContain('<button type="button">Close</button>');   // a digit cap's digit in VT323 (spec §25)
  });

  // Task 11's fix round 1 (ledger ruling P2-R85, WCAG 2.1.4): single-key shortcuts can be turned off, per browser, in the sheet; they are on
  // unless this browser stored 'off'. The store's storage cases are browser-choice.test.tsx's, asserted there for this choice
  it('keeps the single-key shortcuts on unless this browser turned them off', () => {
    expect(SINGLE_KEY_SHORTCUTS_KEY).toBe('gtnh-planner:shortcuts');
    const store = new Map<string, string>();
    vi.stubGlobal('localStorage', keepIn(store));
    expect(getSingleKeyShortcuts()).toBe(true);
    setSingleKeyShortcuts(false);
    expect([store.get(SINGLE_KEY_SHORTCUTS_KEY), getSingleKeyShortcuts()]).toEqual(['off', false]);
    setSingleKeyShortcuts(true);
    expect([store.get(SINGLE_KEY_SHORTCUTS_KEY), getSingleKeyShortcuts()]).toEqual(['on', true]);
    store.set(SINGLE_KEY_SHORTCUTS_KEY, 'no');
    expect(getSingleKeyShortcuts()).toBe(true);                                       // anything but 'off' reads as on
  });

  it('turns them off and on in the sheet, a tick between the list and Close, ticked while they are on', () => {
    expect(renderToStaticMarkup(<ShortcutsDialog onClose={() => {}} />))
      .toContain('</dl><label class="check"><input type="checkbox" checked=""/>Use single-key shortcuts</label><button type="button">Close</button>');
    setSingleKeyShortcuts(false);
    try {
      expect(renderToStaticMarkup(<ShortcutsDialog onClose={() => {}} />)).toContain('<label class="check"><input type="checkbox"/>Use single-key shortcuts</label>');
    } finally {
      setSingleKeyShortcuts(true);
    }
  });
});

afterEach(() => {
  vi.unstubAllGlobals();
});

