// A held Enter acts once, wherever its first press puts the focus (ledger rulings P2-R69a, P2-R76). focus.ts's guard prevents a repeat that
// lands somewhere other than where the press began, which keeps it from pressing a button or typing; a handler that acts on Enter itself must
// skip a prevented key too, or the repeat acts there (the Make search picked from the list "Pick something to make" reopened). The client
// tests have no DOM, so this reads the sources, as escape-layers does for Escape: every test for Enter in src/client, however it is written
// (the key or the code compared with it either way round, a case, a list of keys, a map keyed by it), must read `defaultPrevented` in its own
// `if` (not another branch's on the same line), or after an early return on it in the same handler (a case or a map: anywhere in its handler).
// make-section.spec.ts, recipe-card.spec.ts, notes.spec.ts, toasts.spec.ts and tooltips.spec.ts show it in a browser.

import { readFileSync } from 'node:fs';
import { describe, it, expect } from 'vitest';
import { ROOT, sources, withoutComments } from './client-sources.ts';

/** The tests for Enter that are no handler's, each by its file and its line's text, with why: the guard's own two, which set what the others read. */
const EXEMPT: ReadonlyArray<{ file: string; line: string; why: string }> = [
  { file: 'components/focus.ts', line: "if (e.key !== 'Enter') return;", why: 'the guard notes where a press began, and prevents the repeats that land elsewhere' },
  { file: 'components/focus.ts', line: "if (e.key === 'Enter') began = null;", why: 'the guard forgets where a press began as its key is released' },
];

/** The ways a test for Enter is written, each with its kind: a comparison, a case, a list of keys, or a map keyed by it. */
const ENTER_TESTS: ReadonlyArray<readonly [RegExp, 'compare' | 'case' | 'list' | 'map']> = [
  [/\b(?:key|code)\s*[!=]==?\s*(['"])(?:Numpad)?Enter\1/g, 'compare'],              // e.key === 'Enter', e.code == 'NumpadEnter'
  [/(['"])(?:Numpad)?Enter\1\s*[!=]==?\s*[\w$.?]*\b(?:key|code)\b/g, 'compare'],     // 'Enter' === e.key
  [/\bcase\s+(['"])(?:Numpad)?Enter\1\s*:/g, 'case'],                                 // case 'Enter':
  [/\[[^\][]*(['"])(?:Numpad)?Enter\1[^\][]*\]/g, 'list'],                            // ['Enter', ' '], on one line or several
  [/[{,]\s*(['"]?)(?:Numpad)?Enter\1\s*:/g, 'map'],                                  // { Enter: … }[e.key]
];

/** `code` with the inside of every string and template literal blanked, line breaks kept: its brackets, and nothing in a string, are code. */
function withoutStrings(code: string): string {
  return code.replace(/"(?:\\.|[^"\\\n])*"|'(?:\\.|[^'\\\n])*'|`(?:\\.|[^`\\])*`/g, (s) => s[0] + s.slice(1, -1).replace(/[^\n]/g, ' ') + s.at(-1));
}

/** The index of the bracket in `shape` that closes the one at `open`. */
function closer(shape: string, open: number): number {
  let depth = 0;
  for (let i = open; i < shape.length; i++) {
    if ('([{'.includes(shape[i]!)) depth++;
    else if (')]}'.includes(shape[i]!) && --depth === 0) return i;
  }
  return shape.length;
}

/** The index of the bracket in `shape` that opens the one at `close`. */
function opener(shape: string, close: number): number {
  let depth = 0;
  for (let i = close; i >= 0; i--) {
    if (')]}'.includes(shape[i]!)) depth++;
    else if ('([{'.includes(shape[i]!) && --depth === 0) return i;
  }
  return -1;
}

/** Whether the `{` at `at` opens a function's body: after an arrow, or after a parameter list (and its return type) that is no `if`'s, `for`'s … */
function opensFunction(shape: string, at: number): boolean {
  const before = shape.slice(0, at).trimEnd();
  if (before.endsWith('=>')) return true;
  const params = before.replace(/\)\s*:\s*[^(){};=]*$/, ')');
  if (!params.endsWith(')')) return false;
  const word = /(\w+)\s*$/.exec(shape.slice(0, opener(shape, params.length - 1)))?.[1];
  return word === undefined || !['if', 'for', 'while', 'switch', 'catch', 'with'].includes(word);
}

/** The body of the innermost function around `at`, as the span of its braces; null when there is none. */
function handlerOf(shape: string, at: number): readonly [number, number] | null {
  let depth = 0;
  for (let i = at - 1; i >= 0; i--) {
    if (shape[i] === '}') depth++;
    else if (shape[i] === '{') {
      if (depth > 0) depth--;
      else if (opensFunction(shape, i)) return [i, closer(shape, i)];
    }
  }
  return null;
}

interface EnterTest { line: number; text: string; deaf: string | null }

/** Every test for Enter in `code` (comments already stripped), each with why it is deaf to a prevented key, or null when it reads it. */
function enterTests(code: string): EnterTest[] {
  const shape = withoutStrings(code);
  const ifs = [...shape.matchAll(/\bif\s*\(/g)].map((m) => {
    const open = m.index + m[0].length - 1;
    return [open, closer(shape, open)] as const;
  });
  const reads = (from: number, to: number): boolean => /\bdefaultPrevented\b/.test(code.slice(from, to));
  /** An `if` reading defaultPrevented that returns (or breaks) within [from, to). */
  const earlyReturn = (from: number, to: number): boolean =>
    ifs.some(([open, close]) => open >= from && close < to && reads(open, close) && /^\s*(?:return|break|continue)\b/.test(shape.slice(close + 1)));
  const found = new Map<number, EnterTest>();
  for (const [pattern, kind] of ENTER_TESTS) {
    for (const m of code.matchAll(pattern)) {
      const at = m.index;
      if (found.has(at)) continue;
      const handler = handlerOf(shape, at);
      const own = ifs.filter(([open, close]) => open < at && at < close).sort((x, y) => x[1] - x[0] - (y[1] - y[0]))[0];
      let deaf: string | null = null;
      if (own !== undefined) {
        if (!reads(own[0], own[1]) && !(handler !== null && earlyReturn(handler[0], at))) deaf = 'its if reads no defaultPrevented, and no early return on it comes first';
      } else if (kind === 'case' || kind === 'map') {
        if (!(handler !== null && earlyReturn(handler[0], handler[1]))) deaf = `a ${kind} with no early return on defaultPrevented in its handler`;
      } else {
        deaf = 'a test for Enter outside an if: write it as one, which can read defaultPrevented';
      }
      const line = code.slice(0, at).split('\n').length;
      found.set(at, { line, text: code.split('\n')[line - 1]!.trim(), deaf });
    }
  }
  return [...found.values()];
}

describe('a held Enter acts once, app-wide', () => {
  it('lets every Enter handler skip a key whose default was prevented', () => {
    const found: string[] = [];
    const deaf: string[] = [];
    const exempted = new Set<string>();
    for (const file of sources()) {
      for (const test of enterTests(withoutComments(readFileSync(new URL(file, ROOT), 'utf8')))) {
        const exempt = EXEMPT.find((x) => x.file === file && x.line === test.text);
        if (exempt !== undefined) {
          exempted.add(`${exempt.file}: ${exempt.line}`);
          continue;
        }
        found.push(`${file}:${test.line}`);
        if (test.deaf !== null) deaf.push(`${file}:${test.line}: ${test.text} (${test.deaf})`);
      }
    }
    expect(deaf).toEqual([]);
    // the scan sees them: the item search's pick, the avoid box's add, the tip's quiet, Flow's pick, the three settings drafts' commit and the
    // project name's blur; and the guard's own two, exempt by their lines, not by their file
    expect(found.length, found.join('\n')).toBeGreaterThanOrEqual(8);
    expect([...exempted].sort()).toEqual(EXEMPT.map((x) => `${x.file}: ${x.line}`).sort());
  });

  it('finds a test for Enter however it is written, and only in code', () => {
    const finds = (code: string): number => enterTests(withoutComments(code)).length;
    const FOUND = [
      "if (e.key === 'Enter') go();", 'if (e.key !== "Enter") return;', "if (['Enter', ' '].includes(e.key)) go();",
      "switch (e.key) { case 'Enter': go(); }", "if ('Enter' === e.key) go();", "if ('Enter' !== e.nativeEvent.key) return;",
      "if (e.code === 'Enter') go();", "if (e.code === 'NumpadEnter') go();", "if (e.key == 'Enter') go();", "if (e.key != 'Enter') return;",
      "if ([\n  'Escape',\n  'Enter',\n].includes(e.key)) go();", "const act = { Enter: go, ' ': go }[e.key];", "const act = ({ 'Enter': go } as const)[e.key];",
    ];
    for (const code of FOUND) expect(finds(code), code).toBe(1);
    const NOT_FOUND = [
      "setError('Enter a number above 0');", 'onMouseEnter={() => go()}', "switch (e.key) { case 'Escape': stop(); }", "if ('Enter a name' === label) go();",
      "if (e.code === 'KeyE') go();", "if (e.key === 'Escape') stop();", "if (['Escape', ' '].includes(e.key)) stop();", "const act = { Escape: stop }[e.key];",
      "go(); // if (e.key === 'Enter') no", "/* case 'Enter': */ go();",
    ];
    for (const code of NOT_FOUND) expect(finds(code), code).toBe(0);
  });

  it('asks the test\'s own condition, or an early return before it in its handler, to read defaultPrevented', () => {
    const deafness = (code: string): Array<string | null> => enterTests(withoutComments(code)).map((t) => t.deaf);
    const READS = [
      "const on = (e) => { if (e.key === 'Enter' && !e.nativeEvent.defaultPrevented) go(); };",
      "const on = (e) => { if ((e.key !== 'Enter' && e.key !== ' ') || e.nativeEvent.defaultPrevented) return; go(); };",
      "const on = (e) => { if (e.nativeEvent.defaultPrevented) return; if (e.key === 'Enter') go(); };",
      "function on(e: KeyboardEvent): void { if (e.defaultPrevented) return; switch (e.key) { case 'Enter': go(); } }",
      "const on = (e) => { const act = { Enter: go }[e.key]; if (act === undefined || e.defaultPrevented) return; act(); };",
    ];
    for (const code of READS) expect(deafness(code), code).toEqual([null]);
    const DEAF = [
      // another branch's read on the same line is not the Enter test's
      "const on = (e) => { if (e.key === 'Enter') { go(); } else if (e.key === 'Escape' && !e.nativeEvent.defaultPrevented) stop(); };",
      // an early return that comes after the test does not guard it
      "const on = (e) => { if (e.key === 'Enter') go(); if (e.defaultPrevented) return; };",
      // a read inside the Enter branch comes after the test: the rule asks for it in the test's own condition, or before it
      "const on = (e) => { if (e.key === 'Enter') { if (e.defaultPrevented) return; go(); } };",
      "const on = (e) => { switch (e.key) { case 'Enter': go(); } };",
      "const on = (e) => { const act = { Enter: go }[e.key]; act?.(); };",
      "const on = (e) => e.key === 'Enter' && go();",
      // an early return in another function does not guard this one
      "const a = (e) => { if (e.defaultPrevented) return; }; const b = (e) => { if (e.key === 'Enter') go(); };",
    ];
    for (const code of DEAF) expect(deafness(code)[0], code).not.toBeNull();
  });
});
