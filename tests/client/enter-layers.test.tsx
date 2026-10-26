// A held Enter acts once, wherever its first press puts the focus (ledger rulings P2-R69a, P2-R76). focus.ts's guard prevents a repeat that
// lands somewhere other than where the press began, which keeps it from pressing a button or typing; a handler that acts on Enter itself must
// skip a prevented key too, or the repeat acts there (the Make search picked from the list "Pick something to make" reopened). The client
// tests have no DOM, so this reads the sources: every Enter test in src/client reads `defaultPrevented` on the same line, as escape-layers
// does for Escape. make-section.spec.ts, recipe-card.spec.ts, notes.spec.ts and toasts.spec.ts show it in a browser.

import { readFileSync } from 'node:fs';
import { describe, it, expect } from 'vitest';
import { ROOT, sources, withoutComments } from './client-sources.ts';

/** The files whose Enter tests are no handler's, each with why. */
const EXEMPT = new Map([['components/focus.ts', 'the guard itself: it notes where a press began and prevents the repeats that land elsewhere']]);
/** A test for Enter: the key compared with it, or Enter in a list of keys. */
const ENTER = /\bkey\s*[!=]==\s*['"]Enter['"]|\[[^\]]*['"]Enter['"][^\]]*\]/;

describe('a held Enter acts once, app-wide', () => {
  it('lets every Enter handler skip a key whose default was prevented', () => {
    const found: string[] = [];
    const deaf: string[] = [];
    for (const file of sources()) {
      withoutComments(readFileSync(new URL(file, ROOT), 'utf8')).split('\n').forEach((line, i) => {
        if (!ENTER.test(line) || EXEMPT.has(file)) return;
        found.push(`${file}:${i + 1}`);
        if (!/\bdefaultPrevented\b/.test(line)) deaf.push(`${file}:${i + 1}: ${line.trim()}`);
      });
    }
    expect(deaf).toEqual([]);
    // the scan sees them: the item search's pick, the avoid box's add, the tip's quiet, Flow's pick, the three settings drafts' commit and the
    // project name's blur
    expect(found.length, found.join('\n')).toBeGreaterThanOrEqual(8);
  });

  it('finds an Enter test however it is written, and only in code', () => {
    for (const line of ["if (e.key === 'Enter') go();", 'if (e.key !== "Enter") return;', "if (['Enter', ' '].includes(e.key)) go();"]) expect(ENTER.test(line), line).toBe(true);
    for (const line of ["setError('Enter a number above 0');", 'onMouseEnter={() => go()}']) expect(ENTER.test(line), line).toBe(false);
    expect(ENTER.test(withoutComments("go(); // if (e.key === 'Enter') no"))).toBe(false);
  });
});
