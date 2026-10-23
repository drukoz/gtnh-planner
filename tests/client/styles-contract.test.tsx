// The Machine GUI stylesheet contract (restyle plan Phase 1 Task 1, design spec §3–§5 and §7a): the tokens, the one
// theme, the motion foundation, the font imports and the first rules every later rule builds on. The client project runs
// in node, so the stylesheet is read as text and cut into blocks by the small scanner below. Later tasks add cases here
// and reuse `css`, `rootTokens` and `ruleBody`.

import { readFileSync } from 'node:fs';
import { describe, it, expect } from 'vitest';

const read = (file: string): string => readFileSync(new URL(`../../src/client/${file}`, import.meta.url), 'utf8');

/** The stylesheet text. */
const css = read('styles.css');

/** One `prelude { inner }` block of the stylesheet; `nested` when it sits inside an `@media`-like block. */
interface Block { prelude: string; inner: string; nested: boolean }

/** The index of the `}` that closes the `{` at `open`; quoted text is skipped. */
function closingBrace(src: string, open: number): number {
  let depth = 0;
  let quote = '';
  for (let i = open; i < src.length; i++) {
    const c = src.charAt(i);
    if (quote !== '') {
      if (c === '\\') i++;
      else if (c === quote) quote = '';
    } else if (c === '"' || c === "'") quote = c;
    else if (c === '{') depth++;
    else if (c === '}' && --depth === 0) return i;
  }
  throw new Error('styles.css has a block that is never closed');
}

/**
 * Every block of `src` in source order, the blocks inside an `@media` (or similar) right after it. The steps of a
 * `@keyframes` are not rules, so they stay inside it.
 */
function scan(src: string, nested: boolean, into: Block[]): Block[] {
  for (let at = 0; at < src.length;) {
    const open = src.indexOf('{', at);
    if (open < 0) break;
    const close = closingBrace(src, open);
    const prelude = src.slice(at, open).replace(/\s+/g, ' ').trim();
    const inner = src.slice(open + 1, close);
    into.push({ prelude, inner: inner.replace(/\s+/g, ' ').trim(), nested });
    if (/^@(media|supports|layer|container)\b/.test(prelude)) scan(inner, true, into);
    at = close + 1;
  }
  return into;
}

const blocks = scan(css.replace(/\/\*[\s\S]*?\*\//g, ''), false, []);

/**
 * The declarations of the first rule whose selector list is exactly `selector` (whitespace collapsed); throws when there
 * is none. An at-rule works the same way (`'@media (prefers-reduced-motion: reduce)'`, `'@keyframes pop'`) and gives
 * its whole body.
 */
function ruleBody(selector: string): string {
  const wanted = selector.replace(/\s+/g, ' ').trim();
  const block = blocks.find((b) => b.prelude === wanted);
  if (block === undefined) throw new Error(`styles.css has no rule for "${selector}"`);
  return block.inner;
}

/** The `[name, value]` pairs of a block body; a `;` inside quotes or parentheses (a data URI) does not end a declaration. */
function declarations(body: string): [string, string][] {
  const out: [string, string][] = [];
  let start = 0;
  let parens = 0;
  let quote = '';
  for (let i = 0; i <= body.length; i++) {
    const c = body.charAt(i);
    if (quote !== '') {
      if (c === quote) quote = '';
    } else if (c === '"' || c === "'") quote = c;
    else if (c === '(') parens++;
    else if (c === ')') parens--;
    else if ((c === ';' && parens === 0) || i === body.length) {
      const declaration = body.slice(start, i).trim();
      start = i + 1;
      const colon = declaration.indexOf(':');
      if (colon > 0) out.push([declaration.slice(0, colon).trim(), declaration.slice(colon + 1).trim()]);
    }
  }
  return out;
}

/**
 * Every declaration of the `:root` blocks that apply always, later ones replacing earlier ones as in the cascade. A
 * `:root` inside an `@media` (the reduced-motion override of the `--dur-*` tokens) is conditional, so it is left out:
 * otherwise it would hide the values the tokens really have.
 */
function rootTokens(): Map<string, string> {
  const tokens = new Map<string, string>();
  for (const block of blocks) {
    if (block.prelude !== ':root' || block.nested) continue;
    for (const [name, value] of declarations(block.inner)) tokens.set(name, value);
  }
  return tokens;
}

// The `:root` block (the values of design spec §4), row for row. The old names it keeps as aliases for the inline styles
// are left out: the last task of this plan deletes them.
const TOKENS: [string, string][] = [
  ['--page', '#2b2b2b'], ['--page-check', '#262626'], ['--bar', '#1a1a1a'],
  ['--panel', '#c6c6c6'], ['--panel-hi', '#ffffff'], ['--panel-lo', '#555555'], ['--outline', '#000000'],
  ['--slot', '#8b8b8b'], ['--slot-hi', '#ffffff'], ['--slot-lo', '#373737'], ['--well', '#373737'], ['--screen', '#1b1b1b'],
  ['--text', '#303030'], ['--text-muted', '#4a4a4a'], ['--title', '#404040'],
  ['--btn', '#6b6b6b'], ['--btn-hi', '#a0a0a0'], ['--btn-lo', '#3c3c3c'], ['--btn-hover', '#4a5499'],
  ['--danger-face', '#aa0000'], ['--danger-face-hover', '#c62828'], ['--link', '#1a3fa0'],
  ['--accent', '#ffff55'], ['--screen-text', '#55ff55'], ['--screen-muted', '#aaaaaa'], ['--chat', 'rgba(0, 0, 0, 0.82)'],
  ['--tip-bg', 'rgba(16, 0, 16, 0.94)'], ['--tip-border', '#5000ff'], ['--tip-inner', '#28007f'],
  ['--item', '#ffff55'], ['--fluid', '#55ffff'],
  ['--bevel-panel', 'inset 3px 3px 0 var(--panel-hi), inset -3px -3px 0 var(--panel-lo)'],
  ['--bevel-btn', 'inset 2px 2px 0 var(--btn-hi), inset -2px -2px 0 var(--btn-lo)'],
  ['--bevel-btn-down', 'inset 2px 2px 0 var(--btn-lo), inset -2px -2px 0 var(--btn-hi)'],
  ['--bevel-slot', 'inset 2px 2px 0 var(--slot-lo), inset -2px -2px 0 var(--slot-hi)'],
  ['--bevel-well', 'inset 2px 2px 0 #000000, inset -2px -2px 0 var(--panel-lo)'],
  ['--tier-ulv', '#9a9a9a'], ['--tier-lv', '#dddddd'], ['--tier-mv', '#55ffff'], ['--tier-hv', '#ffaa00'], ['--tier-ev', '#ff55ff'],
  ['--tier-iv', '#8c9cff'], ['--tier-luv', '#ff8cff'], ['--tier-zpm', '#ff5555'], ['--tier-uv', '#55dddd'], ['--tier-uhv', '#ff6b6b'],
  ['--tier-uev', '#55ff55'], ['--tier-uiv', '#00cc00'], ['--tier-umv', '#ffff55'], ['--tier-uxv', '#8080ff'], ['--tier-max', '#ff5555'],
  ['--dur-fast', '90ms'], ['--dur-base', '160ms'], ['--dur-slow', '260ms'], ['--dur-exit', '180ms'],
  ['--ease-out', 'cubic-bezier(0.2, 0.8, 0.2, 1)'], ['--ease-pop', 'cubic-bezier(0.34, 1.56, 0.64, 1)'], ['--ease-in', 'cubic-bezier(0.4, 0, 1, 1)'],
  ['--font-pixel', "'Pixelify Sans', Inter, sans-serif"], ['--font-ui', 'Inter, system-ui, sans-serif'],
  ['--font-diagram', "system-ui, -apple-system, 'Segoe UI', Roboto, sans-serif"],
  ['--ink', '#dddddd'], ['--ink-muted', '#aaaaaa'], ['--ink-title', '#ffffff'], ['--ink-link', '#ffff55'],
  ['--ink-error', '#ff5555'], ['--ink-ok', '#55ff55'], ['--ink-warn', '#ffaa00'],
  ['--gap', '12px'],
  ['color-scheme', 'dark'], ['scrollbar-color', 'var(--btn) var(--screen)'],
  ['font-family', 'var(--font-ui)'], ['line-height', '1.45'], ['color', 'var(--ink)'], ['background', 'var(--page)'],
];

const KEYFRAMES: Record<string, string[]> = {
  'fade-in': ['opacity'],
  'rise-in': ['opacity', 'transform'],
  'scale-in': ['opacity', 'transform'],
  'slide-in-right': ['opacity', 'transform'],
  pop: ['opacity', 'transform'],
  breathe: ['opacity'],
  blink: ['opacity'],
  'pipe-flow': ['stroke-dashoffset'],
  'pipe-pulse': ['filter'],
};

const FONT_IMPORTS = [
  '@fontsource/pixelify-sans/400.css', '@fontsource/pixelify-sans/600.css', '@fontsource/pixelify-sans/700.css',
  '@fontsource/inter/400.css', '@fontsource/inter/500.css', '@fontsource/inter/600.css', '@fontsource/inter/700.css',
];

describe('the Machine GUI stylesheet', () => {
  it('declares the Machine GUI tokens', () => {
    const tokens = rootTokens();
    for (const [name, value] of TOKENS) expect(tokens.get(name), name).toBe(value);
  });

  it('has one theme', () => {
    expect(css.includes('prefers-color-scheme'), 'styles.css mentions prefers-color-scheme').toBe(false);
    const html = read('index.html');
    expect(html).toContain('<meta name="color-scheme" content="dark" />');
    expect(html).toContain('<meta name="theme-color" content="#1a1a1a" />');
  });

  it('stops motion for reduced-motion users', () => {
    const reduced = ruleBody('@media (prefers-reduced-motion: reduce)');
    expect(reduced).toContain('animation-duration: 1ms !important');
    expect(reduced).toContain('animation-iteration-count: 1 !important');
    expect(reduced).toContain('transition-duration: 1ms !important');
    for (const name of ['--dur-fast', '--dur-base', '--dur-slow', '--dur-exit']) expect(reduced, name).toContain(`${name}: 0ms`);
  });

  it('defines the keyframes', () => {
    for (const [name, properties] of Object.entries(KEYFRAMES)) {
      expect(new RegExp(`@keyframes ${name}\\s*\\{`).test(css), `@keyframes ${name} is defined`).toBe(true);
      // opacity and transform only, but the pipes' dash offset and brightness pulse; the breathing and blinking dots never move
      const steps = ruleBody(`@keyframes ${name}`).match(/\{[^}]*\}/g) ?? [];
      const animated = new Set(steps.flatMap((step) => declarations(step.slice(1, -1)).map(([property]) => property)));
      expect([...animated].sort(), name).toEqual([...properties].sort());
    }
  });

  it('loads the fonts before the stylesheet', () => {
    const main = read('main.tsx');
    const sheet = main.indexOf("import './styles.css'");
    expect(sheet).toBeGreaterThan(-1);
    for (const font of FONT_IMPORTS) {
      const at = main.indexOf(`import '${font}'`);
      expect(at, font).toBeGreaterThan(-1);
      expect(at, font).toBeLessThan(sheet);
    }
  });

  it('sets the 14px text size on the body, so a rem stays what it was', () => {
    expect(ruleBody('body')).toMatch(/(^|; )font-size: 14px(;|$)/);
    expect(rootTokens().has('font-size'), ':root declares a font-size, which would change every rem').toBe(false);
  });

  it('paints the stone page', () => {
    const body = ruleBody('body');
    expect(body).toContain('background-color: var(--page)');
    expect(body).toContain('background-size: 16px 16px');
    expect(body).toContain('background-position: 0 0, 8px 8px');
    const checker = 'linear-gradient(45deg, var(--page-check) 25%, transparent 25%, transparent 75%, var(--page-check) 75%)';
    expect(body.split(checker)).toHaveLength(3);                                       // two layers, offset by half a tile
  });

  it('makes the tab panel a panel', () => {
    const panel = ruleBody('.tab-panel');
    expect(panel).toContain('background: var(--panel)');
    expect(panel).toContain('border: 2px solid var(--outline)');
    expect(panel).toContain('box-shadow: var(--bevel-panel)');
    expect(panel).toMatch(/(^|; )padding: 8px(;|$)/);                                  // the height budget: 8 px all round, not more
    expect(ruleBody('.tabs')).toMatch(/(^|; )margin: 0(;|$)/);                         // and no margin between the strip and the panel
  });

  it('gives each surface its ink, and the headings the pixel font', () => {
    expect(ruleBody('h1, h2, h3')).toContain('color: var(--ink-title)');
    expect(ruleBody('h1, h2')).toContain('font-family: var(--font-pixel)');
    expect(ruleBody('h1, h2')).toContain('font-weight: 600');
    expect(ruleBody('h1')).toContain('font-size: 1.6rem');
    expect(ruleBody('h2')).toContain('font-size: 1.2rem');
    expect(ruleBody('a, button.link')).toContain('color: var(--ink-link)');
    expect(ruleBody('.muted')).toContain('color: var(--ink-muted)');
    expect(ruleBody('.error')).toContain('color: var(--ink-error)');
    // The panel group is the rule that holds `.tab-panel` and sets the panel ink (later tasks move members in and out).
    const panels = blocks.find((b) => !b.nested && b.prelude.split(', ').includes('.tab-panel') && b.inner.includes('--ink:'));
    if (panels === undefined) throw new Error('styles.css has no rule that sets the panel ink');
    expect(panels.prelude.split(', ')).toContain('.card');
    for (const declaration of [
      '--ink: #303030', '--ink-muted: #4a4a4a', '--ink-title: #404040', '--ink-link: #1a3fa0',
      '--ink-error: #aa0000', '--ink-ok: #1e5a1e', '--ink-warn: #6a4000', 'color: var(--ink)',
    ]) expect(panels.inner, declaration).toContain(declaration);
  });
});
