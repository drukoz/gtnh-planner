// The stylesheet scanner of the client tests (css-blocks.ts, Phase 2 Task 1a): the tokens of each look, and a value resolved
// through them, on a small stylesheet of its own. The contract and contrast tests read styles.css through it, so these cases pin
// the branches styles.css does not reach yet: fallbacks, cycles, the dark block (Task 1b) and a `:root` inside an `@media`.

import { describe, it, expect } from 'vitest';
import { cssBlocks, resolveToken, themeTokens } from './css-blocks.ts';

/** Two always-on `:root` blocks, the dark look's block, a `:root` in two queries, and a rule that sets a token of its own. */
const SHEET = `
/* a comment { with braces } is left out */
:root { --a: #111111; --b: var(--a); --edge: inset 0 -2px 0 var(--b); --x: #000000; }
:root { --b: #222222; }
@media (prefers-reduced-motion: reduce) {
  :root { --a: #333333; }
}
@media (prefers-color-scheme: dark) {
  :root:not([data-theme='light']) { --a: #999999; }
}
:root[data-theme='dark'] { --a: #444444; --x: var(--a); }
.card { --a: #555555; }
`;
const blocks = cssBlocks(SHEET);

describe('the tokens of a look', () => {
  it('reads the light look from the :root blocks that always apply, a later one replacing an earlier one', () => {
    const light = themeTokens(blocks, 'light');
    expect(light.get('--a')).toBe('#111111');
    expect(light.get('--b')).toBe('#222222');
    expect([...light.keys()]).toEqual(['--a', '--b', '--edge', '--x']);
  });

  it('reads the dark look as the light one with the dark block over it', () => {
    const dark = themeTokens(blocks, 'dark');
    expect(dark.get('--a')).toBe('#444444');
    expect(dark.get('--b')).toBe('#222222');                                          // a name the dark block leaves alone
    expect(dark.get('--x')).toBe('var(--a)');
    expect(resolveToken(dark, 'var(--x)')).toBe('#444444');
    // the light look never sees the dark block
    expect(themeTokens(blocks, 'light').get('--x')).toBe('#000000');
  });

  it('leaves out a :root inside an @media, and the tokens a rule sets for its own element', () => {
    expect(blocks.filter((b) => b.nested).map((b) => b.prelude)).toEqual([':root', ":root:not([data-theme='light'])"]);
    for (const look of ['light', 'dark'] as const) {
      expect(themeTokens(blocks, look).get('--a'), look).not.toMatch(/#333333|#999999|#555555/);
    }
  });
});

describe('a value resolved through the tokens', () => {
  const tokens = themeTokens(blocks, 'light');

  it('replaces each var() with its token, again and again', () => {
    expect(resolveToken(tokens, 'var(--edge)')).toBe('inset 0 -2px 0 #222222');
    expect(resolveToken(tokens, 'var(--a) var(--b)')).toBe('#111111 #222222');
    expect(resolveToken(tokens, '#abcdef')).toBe('#abcdef');
  });

  it('takes the fallback of a var() whose name is not a token, and keeps a token over its fallback', () => {
    expect(resolveToken(tokens, 'var(--pipe-casing, #1b1b1b)')).toBe('#1b1b1b');
    expect(resolveToken(tokens, 'var(--a, #1b1b1b)')).toBe('#111111');
  });

  it('reads a fallback that is a var() itself, and a fallback with commas of its own', () => {
    expect(resolveToken(tokens, 'var(--missing, var(--also-missing, var(--b)))')).toBe('#222222');
    expect(resolveToken(tokens, 'var(--missing, rgba(0, 0, 0, 0.5))')).toBe('rgba(0, 0, 0, 0.5)');
    expect(resolveToken(tokens, '0 0 0 var(--missing, rgba(1, 2, 3, 0.4)), 0 1px 0 var(--a)')).toBe('0 0 0 rgba(1, 2, 3, 0.4), 0 1px 0 #111111');
  });

  it('throws on a name that is not a token and has no fallback, and on a token that reads itself', () => {
    expect(() => resolveToken(tokens, 'var(--missing)')).toThrow('--missing is not a token, and var(--missing) has no fallback');
    const loop = new Map([['--p', 'var(--q)'], ['--q', 'inset var(--p)']]);
    expect(() => resolveToken(loop, 'var(--p)')).toThrow('--p reads itself: --p → --q → --p');
  });
});
