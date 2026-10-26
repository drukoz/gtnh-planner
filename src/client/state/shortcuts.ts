// Keyboard shortcuts (Phase 2 spec §14, D16): what a key pressed on the project page does, decided by a pure function for the page's one
// handler (ProjectPage, a bubble listener on the document: React has handled the key by then, so `defaultPrevented` says whether an element
// took it). `/` the Make section's item search, 1–6 the tabs, F the shown diagram's Fit, P its Pause pipes, ? the sheet that lists them
// (components/ShortcutsSheet.tsx). A key is decided on `key`, never on `code`, so a layout that types a digit or ? with Shift held (AZERTY,
// German, Nordic) still has them, and Shift is no reason to skip one. No React.

/** What a key does: switch to the tab of PROJECT_TABS at `index`, focus the item search, fit the diagram, pause its pipes, or show the sheet. */
export type Shortcut = { kind: 'tab'; index: 0 | 1 | 2 | 3 | 4 | 5 } | { kind: 'search' } | { kind: 'fit' } | { kind: 'pipes' } | { kind: 'sheet' };

/**
 * The parts of a keydown event a shortcut is decided by; `altGraph`, the event's `getModifierState('AltGraph')`, says Ctrl and Alt are AltGr's,
 * with which some layouts type a key (Windows sends them together).
 */
export interface KeyLike {
  key: string; ctrlKey: boolean; metaKey: boolean; altKey: boolean; shiftKey: boolean;
  defaultPrevented: boolean; isComposing: boolean; repeat: boolean; altGraph?: boolean;
}

/** The parts of a key's target a shortcut is decided by (an HTML element). */
export interface TargetLike { tagName: string; type?: string; isContentEditable?: boolean; closest(selector: string): unknown }

/** The input types that take no typing: a key pressed on one of them is no text. */
const NOT_TYPED: ReadonlySet<string> = new Set(['checkbox', 'radio', 'range', 'button', 'submit', 'reset', 'file', 'color', 'image']);

/** The keys of the tabs, in PROJECT_TABS' order: Map, 3D, Connections, Flow, Materials & steps, Notes. */
const TAB_KEYS: readonly string[] = ['1', '2', '3', '4', '5', '6'];

/**
 * Whether a key pressed on `el` is typed: a field (an input of any type that takes text), a text area, a select, anything editable, and
 * anything inside a combobox or a listbox (an item search and its list of matches, the avoid box's), whose keys move in it.
 */
export function isTypingTarget(el: TargetLike | null): boolean {
  if (el === null) return false;
  const tag = el.tagName.toUpperCase();
  if (tag === 'INPUT') return !NOT_TYPED.has((el.type ?? 'text').toLowerCase());
  if (tag === 'TEXTAREA' || tag === 'SELECT' || el.isContentEditable === true) return true;
  return el.closest('[role="combobox"], [role="listbox"]') != null;
}

/**
 * The shortcut `e` stands for, pressed on `target` (null for none, or for an element that takes no typing outside HTML, such as a Flow box
 * in its svg); null when it is none. A key is left alone with Ctrl, Cmd or Alt held (the browser's and the system's; but Ctrl and Alt that
 * are AltGr's type the key, fix round 1), while it is being
 * composed, when it repeats (a held key acts once), once something has handled it, when it is typed (`isTypingTarget`), and inside an in-app
 * confirm, which keeps the keyboard while its question asks (ledger ruling P2-R73).
 */
export function shortcutOf(e: KeyLike, target: TargetLike | null): Shortcut | null {
  if (e.metaKey || (e.altGraph !== true && (e.ctrlKey || e.altKey)) || e.isComposing || e.repeat || e.defaultPrevented) return null;
  if (isTypingTarget(target) || target?.closest('[role="alertdialog"]') != null) return null;
  const tab = TAB_KEYS.indexOf(e.key);
  if (tab >= 0) return { kind: 'tab', index: tab as 0 | 1 | 2 | 3 | 4 | 5 };
  switch (e.key) {
    case '/': return { kind: 'search' };
    case 'f': case 'F': return { kind: 'fit' };
    case 'p': case 'P': return { kind: 'pipes' };
    case '?': return { kind: 'sheet' };
    default: return null;
  }
}

/**
 * The sheet's rows (the mockup's, `Phase2Feedback.dc.html`): each key's caps, an en dash between two caps standing for a range, and what it does.
 * The Esc row says what Escape does, a layer a press (spec §6.1, §14.1), in place of the mockup's words, which named a panel that no Escape
 * closes (ledger ruling P2-R134).
 */
export const SHORTCUT_ROWS: ReadonlyArray<readonly [caps: readonly string[], what: string]> = [
  [['/'], 'Search items and fluids'],
  [['1', '–', '6'], 'Switch tabs: Map, 3D, Connections, Flow, Materials, Notes'],
  [['F'], 'Fit the diagram'],
  [['P'], 'Pause or play the pipes'],
  [['Esc'], 'Hide a tip, close a list, a question or the drawer, clear the highlight'],
  [['?'], 'Show this sheet'],
];
