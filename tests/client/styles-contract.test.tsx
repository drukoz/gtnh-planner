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
  'pipe-pulse': ['opacity'],
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
      // opacity and transform only, but the pipes' dash offset; the breathing and blinking dots never move
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

// The controls (restyle plan Phase 1 Task 2, design spec §6 and §7a). Every base rule is a `:where(…)` rule, which has no
// specificity: a component rule (the tabs, the toolbars, the chips) wins on its own, and a state rule here can no longer
// outrank it the way `button:hover:not(:disabled)` outranked `.tabs [role='tab']`. Among rules of equal specificity the
// source order is the cascade, so the cases below pin the order where it matters.

/** The value the first rule for `selector` gives `property` (the last such declaration), or undefined. */
function declared(selector: string, property: string): string | undefined {
  return declarations(ruleBody(selector)).filter(([name]) => name === property).map(([, value]) => value).pop();
}

/** Where in the source the first rule for `selector` is; -1 when there is none. */
function position(selector: string): number {
  const wanted = selector.replace(/\s+/g, ' ').trim();
  return blocks.findIndex((b) => b.prelude === wanted);
}

/** Each `[selector, property, value]`: the rule gives the property exactly that value. */
function expectDeclared(rows: [string, string, string][]): void {
  for (const [selector, property, value] of rows) expect(declared(selector, property), `${selector} { ${property} }`).toBe(value);
}

const TICK = ':where(input[type=checkbox], input[type=radio])';
const FIELD = 'input:not([type=checkbox], [type=radio], [type=range], [type=file])';
const FIELDS = `:where(${FIELD}, textarea, select)`;
const SUMMARY = 'details.settings-section > summary, details.disclosure > summary';
const BUTTON_FACE = 'background-color var(--dur-fast) var(--ease-out), transform var(--dur-fast) var(--ease-out)';

describe('the Machine GUI controls', () => {
  it('draws a button as a Minecraft button, from a base that adds no specificity', () => {
    expectDeclared([
      [':where(button)', 'min-height', '36px'], [':where(button)', 'padding', '0 14px'],
      [':where(button)', 'border', '2px solid var(--outline)'], [':where(button)', 'border-radius', '0'],
      [':where(button)', 'background', 'var(--btn)'], [':where(button)', 'box-shadow', 'var(--bevel-btn)'],
      [':where(button)', 'color', '#ffffff'], [':where(button)', 'font', '15px/1 var(--font-pixel)'],
      [':where(button)', 'text-shadow', '2px 2px 0 #3f3f3f'], [':where(button)', 'cursor', 'pointer'],
      [':where(button)', 'transition', BUTTON_FACE],
    ]);
    // the old states are gone: `button:hover:not(:disabled)` (0,2,1) beat `.tabs [role='tab']` (0,2,0) and `.mat-toggle`
    for (const old of ['button', 'button:hover:not(:disabled)', 'button:disabled']) expect(position(old), `a bare "${old}" rule`).toBe(-1);
  });

  it('lights a button on hover and sinks it when pressed', () => {
    expectDeclared([
      [':where(button:hover:not(:disabled))', 'background', 'var(--btn-hover)'],
      [':where(button:active:not(:disabled))', 'transform', 'translateY(1px)'],
      [':where(button:active:not(:disabled))', 'box-shadow', 'var(--bevel-btn-down)'],
    ]);
  });

  it('dresses the primary, danger and small buttons, and the disabled look covers them all', () => {
    expectDeclared([
      [':where(button.primary)', 'color', 'var(--accent)'], [':where(button.primary)', 'text-shadow', '2px 2px 0 #3f3f15'],
      [':where(button.danger)', 'background', 'var(--danger-face)'],
      [':where(button.danger:hover:not(:disabled))', 'background', 'var(--danger-face-hover)'],
      [':where(button.small)', 'min-height', '28px'], [':where(button.small)', 'padding', '0 10px'],
      [':where(button.small)', 'font-size', '13px'],
      [':where(button:disabled)', 'background', '#4a4a4a'], [':where(button:disabled)', 'color', '#a0a0a0'],
      [':where(button:disabled)', 'text-shadow', 'none'], [':where(button:disabled)', 'box-shadow', 'none'],
      [':where(button:disabled)', 'cursor', 'default'],
    ]);
    expect(declared(':where(button:disabled)', 'opacity'), 'a disabled button is a grey face, not a faded one').toBeUndefined();
    // equal specificity, so the order is the cascade: a variant after the base and its hover, the disabled look last
    const order = [
      ':where(button)', ':where(button:hover:not(:disabled))', ':where(button:active:not(:disabled))', ':where(button.primary)',
      ':where(button.danger)', ':where(button.danger:hover:not(:disabled))', ':where(button.small)', ':where(button:disabled)',
    ].map(position);
    expect(order.every((at) => at >= 0), 'every button rule exists').toBe(true);
    expect(order).toEqual([...order].sort((a, b) => a - b));
  });

  it('lets the small utility size everything but a button', () => {
    // `.small { font-size: 0.85rem }` (0,1,0) would beat the 13px of `:where(button.small)` and leave it 13.6px
    expect(ruleBody('.small:where(:not(button))')).toContain('font-size: 0.85rem');
    expect(position('.small'), 'a bare .small rule').toBe(-1);
  });

  it('keeps a link button a link, with every button property reset', () => {
    expectDeclared([
      ['button.link', 'min-height', '0'], ['button.link', 'padding', '0'], ['button.link', 'border', 'none'],
      ['button.link', 'background', 'none'], ['button.link', 'box-shadow', 'none'], ['button.link', 'text-shadow', 'none'],
      ['button.link', 'transform', 'none'], ['button.link', 'font', 'inherit'], ['button.link', 'text-decoration', 'underline'],
    ]);
    // its colour is the link ink of `a, button.link`, which sits on the surface it is in; no later rule may give it another
    expect(declared('button.link', 'color')).toBeUndefined();
    expect(ruleBody('a, button.link')).toContain('color: var(--ink-link)');
  });

  it('puts a text field, a text area and a select in a black field, and no box around a tick, slider or file', () => {
    // the literal selector of the plan: a checkbox, radio, range or file input is never boxed like a text field
    expect(position(':where(input:not([type=checkbox], [type=radio], [type=range], [type=file]), textarea, select)')).toBeGreaterThan(-1);
    expectDeclared([
      [FIELDS, 'min-height', '36px'], [FIELDS, 'padding', '6px 10px'], [FIELDS, 'background', '#000000'],
      [FIELDS, 'border', '2px solid var(--btn-hi)'], [FIELDS, 'border-radius', '0'], [FIELDS, 'color', '#ffffff'],
      [FIELDS, 'font', '14px var(--font-ui)'], ['::placeholder', 'color', '#8b8b8b'],
      [`:where(${FIELD}:focus, textarea:focus, select:focus)`, 'border-color', 'var(--accent)'],
    ]);
    const invalid = `:where(${FIELD}[aria-invalid='true'], textarea[aria-invalid='true'], select[aria-invalid='true'])`;
    expect(declared(invalid, 'border-color')).toBe('#ff5555');
    expect(position(invalid), 'an invalid field stays red while it has the focus').toBeGreaterThan(position(`:where(${FIELD}:focus, textarea:focus, select:focus)`));
  });

  it('gives a select a pixel caret, and a search field a pixel cross', () => {
    expectDeclared([
      [':where(select)', 'appearance', 'none'], [':where(select)', 'padding-right', '26px'],
      [':where(select)', 'background-repeat', 'no-repeat'], [':where(select)', 'background-position', 'right 8px center'],
      [':where(input[type=search])', 'appearance', 'none'],
      [':where(input[type=search])::-webkit-search-cancel-button', 'appearance', 'none'],
    ]);
    // the field's `background` shorthand would wipe the caret if it came after it
    expect(position(':where(select)')).toBeGreaterThan(position(FIELDS));
    const caret = decodeURIComponent(declared(':where(select)', 'background-image') ?? '');
    for (const part of ['data:image/svg+xml', "width='8'", "height='5'", "fill='#ffffff'", "shape-rendering='crispEdges'"]) expect(caret, part).toContain(part);
    const cross = decodeURIComponent(declared(':where(input[type=search])::-webkit-search-cancel-button', 'background') ?? '');
    for (const part of ['data:image/svg+xml', "fill='#ffffff'", "shape-rendering='crispEdges'"]) expect(cross, part).toContain(part);
  });

  it('turns a checkbox and a radio into a screen well, and keeps the native input', () => {
    expectDeclared([
      [TICK, 'appearance', 'none'], [TICK, 'display', 'inline-grid'], [TICK, 'place-content', 'center'], [TICK, 'flex', 'none'],
      [TICK, 'width', '16px'], [TICK, 'height', '16px'], [TICK, 'margin', '0'],
      [TICK, 'background', 'var(--screen)'], [TICK, 'box-shadow', 'var(--bevel-slot)'],
      [`${TICK}::before`, 'content', "''"], [`${TICK}::before`, 'width', '10px'], [`${TICK}::before`, 'height', '10px'],
      [`${TICK}::before`, 'opacity', '0'], [`${TICK}::before`, 'transform', 'scale(0.6)'],
      [`${TICK}::before`, 'transition', 'opacity var(--dur-fast) var(--ease-pop), transform var(--dur-fast) var(--ease-pop)'],
      [':where(input[type=checkbox])::before', 'background', 'var(--screen-text)'],
      [':where(input[type=radio])::before', 'background', 'var(--screen-text)'],
      [':where(input[type=radio])::before', 'width', '6px'], [':where(input[type=radio])::before', 'height', '6px'],
      [`${TICK}:checked::before`, 'opacity', '1'], [`${TICK}:checked::before`, 'transform', 'none'],
      [`${TICK}:disabled`, 'opacity', '0.5'], [`${TICK}:disabled`, 'cursor', 'default'],
    ]);
    expect(declared(':where(input[type=checkbox])::before', 'clip-path'), 'a pixel tick').toMatch(/^polygon\((\d+px \d+px, )+\d+px \d+px\)$/);
  });

  it('draws a range as a well with a Minecraft button for a thumb', () => {
    expectDeclared([[':where(input[type=range])', 'appearance', 'none'], [':where(input[type=range])', 'background', 'transparent']]);
    for (const track of ['::-webkit-slider-runnable-track', '::-moz-range-track']) {
      expectDeclared([
        [`:where(input[type=range])${track}`, 'height', '6px'], [`:where(input[type=range])${track}`, 'background', 'var(--screen)'],
        [`:where(input[type=range])${track}`, 'box-shadow', 'var(--bevel-well)'],
      ]);
    }
    for (const thumb of ['::-webkit-slider-thumb', '::-moz-range-thumb']) {
      expectDeclared([
        [`:where(input[type=range])${thumb}`, 'width', '12px'], [`:where(input[type=range])${thumb}`, 'height', '20px'],
        [`:where(input[type=range])${thumb}`, 'background', 'var(--btn)'], [`:where(input[type=range])${thumb}`, 'border', '2px solid var(--outline)'],
        [`:where(input[type=range])${thumb}`, 'box-shadow', 'var(--bevel-btn)'], [`:where(input[type=range])${thumb}`, 'border-radius', '0'],
      ]);
    }
    // a browser drops a whole selector list when one selector in it has a pseudo-element it does not know
    const mixed = blocks.filter((b) => b.prelude.includes('-webkit-') && b.prelude.includes('-moz-'));
    expect(mixed.map((b) => b.prelude)).toEqual([]);
  });

  it('draws a progress bar as a screen with a green fill', () => {
    expectDeclared([
      [':where(progress)', 'appearance', 'none'], [':where(progress)', 'width', '100%'], [':where(progress)', 'height', '14px'],
      [':where(progress)', 'border', '2px solid var(--outline)'], [':where(progress)', 'background', 'var(--screen)'],
      [':where(progress)::-webkit-progress-bar', 'background', 'var(--screen)'],
      [':where(progress)::-webkit-progress-value', 'background', 'var(--screen-text)'],
      [':where(progress)::-moz-progress-bar', 'background', 'var(--screen-text)'],
    ]);
  });

  it('gives a file input no field box, and its button the small button look', () => {
    expectDeclared([
      [':where(input[type=file])', 'padding', '0'], [':where(input[type=file])', 'border', '0'], [':where(input[type=file])', 'background', 'none'],
      [':where(input[type=file])::file-selector-button', 'min-height', '28px'],
      [':where(input[type=file])::file-selector-button', 'padding', '0 10px'],
      [':where(input[type=file])::file-selector-button', 'border', '2px solid var(--outline)'],
      [':where(input[type=file])::file-selector-button', 'background', 'var(--btn)'],
      [':where(input[type=file])::file-selector-button', 'box-shadow', 'var(--bevel-btn)'],
      [':where(input[type=file])::file-selector-button', 'font', '13px/1 var(--font-pixel)'],
      [':where(input[type=file]:disabled)::file-selector-button', 'background', '#4a4a4a'],
    ]);
  });

  it('draws the summary of a settings section or a disclosure as a full-width button with a turning caret', () => {
    expectDeclared([
      [SUMMARY, 'display', 'flex'], [SUMMARY, 'list-style', 'none'], [SUMMARY, 'min-height', '36px'],
      [SUMMARY, 'border', '2px solid var(--outline)'], [SUMMARY, 'background', 'var(--btn)'], [SUMMARY, 'box-shadow', 'var(--bevel-btn)'],
      [SUMMARY, 'color', '#ffffff'], [SUMMARY, 'font', '15px/1 var(--font-pixel)'], [SUMMARY, 'cursor', 'pointer'],
      [SUMMARY.replace(/summary/g, 'summary::-webkit-details-marker'), 'display', 'none'],
      [SUMMARY.replace(/summary/g, 'summary:hover'), 'background', 'var(--btn-hover)'],
      [SUMMARY.replace(/summary/g, 'summary:active'), 'transform', 'translateY(1px)'],
      [SUMMARY.replace(/summary/g, 'summary:active'), 'box-shadow', 'var(--bevel-btn-down)'],
      [SUMMARY.replace(/summary/g, 'summary::before'), 'content', "''"],
      [SUMMARY.replace(/summary/g, 'summary::before'), 'transition', 'transform var(--dur-fast) var(--ease-out)'],
      ['details.settings-section[open] > summary::before, details.disclosure[open] > summary::before', 'transform', 'rotate(90deg)'],
    ]);
    expect(declared(SUMMARY.replace(/summary/g, 'summary::before'), 'clip-path'), 'a pixel caret').toMatch(/^polygon\(/);
    // a global `summary` rule would also hit Materials' two inline disclosures and the thousands of storage rows (the focus ring's
    // colour rule lists `summary` too, ruling R13: it recolours a ring and dresses nothing)
    expect(blocks.filter((b) => !b.prelude.endsWith(':focus-visible') && b.prelude.split(',').some((s) => /^\s*summary\b/.test(s))).map((b) => b.prelude)).toEqual([]);
  });

  it('shows the keyboard focus as a 3px yellow ring that touches the control', () => {
    expectDeclared([[':focus-visible', 'outline', '3px solid var(--accent)'], [':focus-visible', 'outline-offset', '0']]);
  });

  it('rings a link in the focus ink of its surface: yellow on the stone, near black on a panel', () => {
    // a button, a field and a tick have a dark edge of their own for the yellow ring to touch; a link has none, and yellow
    // on the light grey of a panel measures 1.6:1 where near black measures 10:1
    expect(rootTokens().get('--ink-focus')).toBe('#ffff55');
    const panels = blocks.find((b) => !b.nested && b.prelude.split(', ').includes('.tab-panel') && b.inner.includes('--ink:'));
    if (panels === undefined) throw new Error('styles.css has no rule that sets the panel ink');
    expect(declarations(panels.inner).filter(([name]) => name === '--ink-focus').map(([, value]) => value)).toEqual(['#1b1b1b']);
    const link = ':where(a, button.link, summary, input[type=checkbox], input[type=radio]):focus-visible';   // ruling R13: a summary and a tick have no dark edge either
    expect(declared(link, 'outline-color')).toBe('var(--ink-focus)');
    // only the colour: the width and the offset stay the base ring's
    expect(declarations(ruleBody(link)).map(([name]) => name)).toEqual(['outline-color']);
    // it has the base ring's specificity (0,1,0), so it is its place after the base ring that lets it recolour it
    expect(position(link)).toBeGreaterThan(position(':focus-visible'));
  });

  it('draws badges and chips as dark rectangles with pixel text', () => {
    expectDeclared([
      ['.badge, .chip', 'background', 'var(--screen)'], ['.badge, .chip', 'color', '#ffffff'], ['.badge, .chip', 'border-radius', '0'],
      ['.badge, .chip', 'padding', '0 6px'], ['.badge, .chip', 'font', '13px/1.5 var(--font-pixel)'],
      ['.badge.muted', 'color', 'var(--screen-muted)'],
    ]);
    // the old pill of the materials section (a border, a radius, a light fill) would win over the shared rule by coming later
    const chip = blocks.filter((b) => b.prelude === '.chip').flatMap((b) => declarations(b.inner).map(([name]) => name));
    expect(chip.filter((name) => name !== 'overflow-wrap')).toEqual([]);
  });

  it('gives a decorative pseudo-element an empty content, never text that joins an accessible name', () => {
    const drawn = blocks.filter((b) => b.prelude.split(',').some((s) => /::(before|after)$/.test(s.trim())));
    // the scan sees the controls' own marks, so a rule it cannot parse would not pass unnoticed
    for (const mark of [`${TICK}::before`, ':where(input[type=checkbox])::before', ':where(input[type=radio])::before', SUMMARY.replace(/summary/g, 'summary::before')]) {
      expect(drawn.map((b) => b.prelude), mark).toContain(mark);
    }
    for (const block of drawn) {
      for (const [name, value] of declarations(block.inner)) if (name === 'content') expect(value, block.prelude).toMatch(/^(''|none)$/);
    }
  });
});

// The app chrome (restyle plan Phase 1 Task 3, design spec §6 and §7a): the top bar, the login card, the modal, the project
// head, the banners, the tabs, the project list and the notes. These cases pin the values of the brief; chrome.spec.ts measures
// what a stylesheet cannot say in text (that the bar and the tabs keep their height when the fonts arrive late, that reduced
// motion stops the live dot).

/** The rule that sets a surface's ink (it declares `--ink:`) and lists `member` among its selectors. */
function inkGroup(member: string): Block {
  const group = blocks.find((b) => !b.nested && b.prelude.split(', ').includes(member) && b.inner.includes('--ink:'));
  if (group === undefined) throw new Error(`styles.css has no rule that sets the ink of "${member}"`);
  return group;
}

/** The brand mark as a background: centred, contained, drawn once. */
const MARK = 'var(--brand-mark) center / contain no-repeat';
const TAB = ".tabs [role='tab']";
const SELECTED = `${TAB}[aria-selected='true']`;
/** The chrome rules whose colours, edges and radii this task replaced: none may read an alias of the old palette any more. */
const CHROME_RULES = [
  '.top-nav', '.brand', '.brand-mark', '.top-nav nav', '.top-nav nav a', '.card', '.banner', '.delete-confirm', '.project-name',
  '.connection', '.plan-banner', '.plan-cost', '.what-changed', '.tabs', TAB, '.tab-panel', '.modal-backdrop', '.modal',
  '.note, .note-add', '.tick.marked .tick-label', '.tick-by',
];
const OLD_ALIASES = /var\(--(bg|surface|surface-2|border|radius|muted|ok|error|error-bg|warn-bg|warn-border|accent-text)\)/;

describe('the Machine GUI chrome', () => {
  it('gives a dark box the light ink of its own group, and the notes the ink of a panel', () => {
    const dark = inkGroup('.banner');
    // the group starts with the surfaces Task 3 moved out of the panel group and the screens; later tasks append to it
    expect(dark.prelude.split(', ').slice(0, 7)).toEqual(['.banner', '.plan-banner', '.what-changed', '.delete-confirm', '.connection', '.badge', '.chip']);
    const INK: [string, string][] = [
      ['--ink', '#ffffff'], ['--ink-muted', '#aaaaaa'], ['--ink-title', '#ffff55'], ['--ink-link', '#ffff55'],
      ['--ink-error', '#ff5555'], ['--ink-ok', '#55ff55'], ['--ink-warn', '#ffaa00'],
      ['--ink-focus', '#ffff55'],                                                      // ruling R12: not the dark ring of a panel it may sit in
      ['--muted', '#aaaaaa'], ['color', 'var(--ink)'],
    ];
    const set = new Map(declarations(dark.inner));
    for (const [name, value] of INK) expect(set.get(name), name).toBe(value);
    // moved, not copied: the panel group no longer lists them, and lists the notes
    const panels = inkGroup('.tab-panel');
    for (const member of ['.banner', '.plan-banner', '.what-changed', '.delete-confirm']) expect(panels.prelude.split(', '), member).not.toContain(member);
    for (const member of ['.note', '.note-add']) expect(panels.prelude.split(', '), member).toContain(member);
    // both groups come before `.muted` and `.error`, which still win on an element that is both (a `.banner.error`)
    for (const group of [dark, panels]) {
      expect(blocks.indexOf(group), group.prelude).toBeLessThan(position('.muted'));
      expect(blocks.indexOf(group), group.prelude).toBeLessThan(position('.error'));
    }
  });

  it('draws the pixel brand mark from one token, on the top bar and above the login title', () => {
    const mark = decodeURIComponent(rootTokens().get('--brand-mark') ?? '');
    for (const part of [
      'data:image/svg+xml', "viewBox='0 0 8 8'", "shape-rendering='crispEdges'",
      "fill='#000' d='M2 0h4v1H2zM1 1h1v1H1zM6 1h1v1H6zM0 2h1v4H0zM7 2h1v4H7zM1 6h1v1H1zM6 6h1v1H6zM2 7h4v1H2z'",
      "fill='#ffd84a' d='M2 1h4v1H2zM1 2h1v4H1zM6 2h1v4H6zM2 6h4v1H2z'",
      "fill='#c98a00' d='M2 2h4v1H2zM2 3h1v2H2zM5 3h1v2H5zM2 5h4v1H2z'",
      "fill='#fff' d='M3 3h2v2H3z'",
    ]) expect(mark, part).toContain(part);
    expectDeclared([
      ['.brand-mark', 'width', '32px'], ['.brand-mark', 'height', '32px'], ['.brand-mark', 'background', MARK],
      ['.login::before', 'content', "''"], ['.login::before', 'width', '64px'], ['.login::before', 'height', '64px'],
      ['.login::before', 'background', MARK], ['.login::before', 'align-self', 'center'],
    ]);
  });

  it('draws the top bar as a dark strip of fixed height, with the pages as buttons and the current one yellow', () => {
    expectDeclared([
      ['.top-nav', 'display', 'flex'], ['.top-nav', 'align-items', 'center'], ['.top-nav', 'flex-wrap', 'wrap'],
      ['.top-nav', 'gap', '20px'], ['.top-nav', 'min-height', '50px'], ['.top-nav', 'padding', '6px 20px'],
      ['.top-nav', 'background', 'var(--bar)'], ['.top-nav', 'border-bottom', '2px solid #000'],
      ['.top-nav', 'box-shadow', 'inset 0 -2px 0 #3c3c3c'],
      ['.brand', 'display', 'inline-flex'], ['.brand', 'gap', '10px'], ['.brand', 'align-items', 'center'],
      ['.brand', 'font', '700 20px/1 var(--font-pixel)'], ['.brand', 'color', '#ffd84a'], ['.brand', 'text-shadow', '2px 2px 0 #3f3300'],
      ['.top-nav nav a', 'display', 'flex'], ['.top-nav nav a', 'min-height', '36px'], ['.top-nav nav a', 'padding', '0 14px'],
      ['.top-nav nav a', 'background', 'var(--btn)'], ['.top-nav nav a', 'border', '2px solid var(--outline)'],
      ['.top-nav nav a', 'box-shadow', 'var(--bevel-btn)'], ['.top-nav nav a', 'color', '#ffffff'],
      ['.top-nav nav a', 'font', '15px/1 var(--font-pixel)'], ['.top-nav nav a', 'text-decoration', 'none'],
      ['.top-nav nav a', 'text-shadow', '2px 2px 0 #3f3f3f'],
      ['.top-nav nav a:hover', 'background', 'var(--btn-hover)'],
      ['.top-nav nav a:active', 'transform', 'translateY(1px)'], ['.top-nav nav a:active', 'box-shadow', 'var(--bevel-btn-down)'],
      [".top-nav nav a[aria-current='page']", 'color', 'var(--accent)'],
    ]);
    // the links of the nav only: a bare `.top-nav a` would dress every link in the header. The bar scrolls with the page.
    expect(position('.top-nav a'), 'a bare .top-nav a rule').toBe(-1);
    expect(declared('.top-nav', 'position'), 'the top bar is not sticky').toBeUndefined();
    // on a narrow screen the bar keeps its 6 px of padding, so it stays 50 px tall
    const narrow = blocks.find((b) => b.nested && b.prelude === '.top-nav');
    expect(narrow === undefined ? [] : declarations(narrow.inner)).toEqual([['gap', '12px'], ['padding', '6px 14px']]);
  });

  it('fades the modal backdrop in and scales the modal up, once', () => {
    expectDeclared([
      ['.modal-backdrop', 'background', 'rgba(0, 0, 0, 0.6)'],
      ['.modal-backdrop', 'animation', 'fade-in var(--dur-base) var(--ease-out)'],
      ['.modal', 'background', 'var(--panel)'], ['.modal', 'border', '2px solid var(--outline)'], ['.modal', 'border-radius', '0'],
      ['.modal', 'box-shadow', 'var(--bevel-panel), 0 2px 0 #000'],
      ['.modal', 'animation', 'scale-in var(--dur-slow) var(--ease-out)'],
    ]);
    expect(ruleBody('.modal')).toContain('animation: scale-in var(--dur-slow) var(--ease-out)');
    // the title is the heading of a panel: the pixel font and the title ink come from the global h2 and `h1, h2, h3` rules, and
    // no rule of the modal takes them away
    expect(ruleBody('.modal h2, .modal p')).not.toMatch(/font|color/);
  });

  it('draws the project name as a pixel heading that turns into a field when it is hovered or focused', () => {
    expectDeclared([
      ['.project-name', 'min-height', '36px'], ['.project-name', 'border-color', 'transparent'],
      ['.project-name', 'background', 'transparent'], ['.project-name', 'color', 'var(--ink)'],
      ['.project-name', 'font', '600 22px/1.2 var(--font-pixel)'],
      ['.project-name:hover', 'border-color', 'var(--btn-hi)'],
      ['.project-name:focus', 'border-color', 'var(--accent)'], ['.project-name:focus', 'background', '#000000'],
    ]);
    // both are one class and one pseudo-class: the one that comes later wins, and a field being typed in is a focused one
    expect(position('.project-name:focus')).toBeGreaterThan(position('.project-name:hover'));
  });

  it('shows the connection as a readout whose square dot breathes while live and blinks while not', () => {
    expectDeclared([
      ['.connection', 'background', 'var(--screen)'], ['.connection', 'font', '14px/1 var(--font-pixel)'],
      ['.connection', 'color', '#ffaa00'], ['.connection.live', 'color', '#55ff55'],
      ['.connection::before', 'content', "''"], ['.connection::before', 'width', '8px'], ['.connection::before', 'height', '8px'],
      ['.connection::before', 'background', '#ffaa00'], ['.connection::before', 'animation', 'blink 1.6s steps(2) infinite'],
      ['.connection.live::before', 'background', '#55ff55'],
      ['.connection.live::before', 'animation', 'breathe 2s ease-in-out infinite'],
    ]);
    expect(ruleBody('.connection.live::before')).toContain('animation: breathe 2s');
    // opacity only (the keyframes), and no transform: a test waits for what it clicks to hold still, and this is a square
    for (const dot of ['.connection::before', '.connection.live::before']) {
      expect(ruleBody(dot), dot).not.toContain('transform');
      expect(ruleBody(dot), dot).not.toContain('radius');
    }
    // the head has no panel around it: it is the height budget's
    expect(declarations(ruleBody('.project-head')).map(([name]) => name)).not.toContain('background');
  });

  it('draws a notice, an error, the plan banner and what changed as chat boxes that rise in', () => {
    for (const selector of ['.banner', '.plan-banner', '.what-changed']) {
      expectDeclared([
        [selector, 'background', 'var(--chat)'], [selector, 'border', '2px solid var(--outline)'], [selector, 'border-radius', '0'],
        [selector, 'animation', 'rise-in var(--dur-base) var(--ease-out)'],
      ]);
    }
    expectDeclared([
      ['.banner.notice', 'color', 'var(--ink-title)'], ['.banner.error', 'color', 'var(--ink-error)'],
      // the busy line shows on every replan: it appears without the entrance
      ['.plan-banner:has(> p.muted:only-child)', 'animation', 'none'],
      // a hint or a warning is yellow, a problem is red in the pixel font with its items in a paler red
      ['.plan-banner', 'color', 'var(--ink-title)'],
      ['.plan-banner > .error, .banner-integrity, .banner-heading.error', 'color', 'var(--ink-error)'],
      ['.plan-banner > .error, .banner-integrity, .banner-heading.error', 'font-family', 'var(--font-pixel)'],
      ['.banner-integrity li', 'color', '#ffaaaa'], ['.banner-integrity li', 'font-family', 'var(--font-ui)'],
      ['.plan-banner .banner-heading', 'font', '600 14px/1.45 var(--font-pixel)'],
      ['.what-changed h4', 'font', '600 14px/1.45 var(--font-pixel)'], ['.what-changed h4', 'color', 'var(--ink-title)'],
      // a derived material's chip is a small button with its 16px icon
      ['button.banner-chip', 'min-height', '28px'], ['button.banner-chip', 'padding', '0 10px 0 4px'],
      ['button.banner-chip', 'font-size', '13px'], ['button.banner-chip', 'display', 'inline-flex'],
    ]);
    // what the plan costs sits on the page, in its ink, with figures that line up
    expectDeclared([
      ['.plan-cost', 'color', 'var(--ink)'], ['.plan-cost', 'font-family', 'var(--font-ui)'], ['.plan-cost', 'font-size', '14px'],
      ['.plan-cost', 'font-variant-numeric', 'tabular-nums'],
    ]);
  });

  it('draws the tabs as creative-inventory tabs that join the panel below, and fades the panel in', () => {
    expectDeclared([
      ['.tabs', 'gap', '2px'], ['.tabs', 'padding-left', '6px'], ['.tabs', 'border', '0'], ['.tabs', 'margin', '0'],
      ['.tabs', 'flex-wrap', 'wrap'],                                                  // as the mockup's: six pixel tabs are wider than a phone
      [TAB, 'position', 'relative'], [TAB, 'top', '2px'], [TAB, 'z-index', '1'], [TAB, 'min-height', '38px'], [TAB, 'padding', '0 14px'],
      [TAB, 'border', '2px solid #000'], [TAB, 'font', '15px/1 var(--font-pixel)'], [TAB, 'text-shadow', 'none'],
      [TAB, 'background', '#8b8b8b'], [TAB, 'box-shadow', 'inset 2px 2px 0 #a8a8a8'], [TAB, 'color', '#1b1b1b'],
      [`${TAB}:hover:not([aria-selected='true'])`, 'background', '#9a9a9a'],
      [SELECTED, 'background', 'var(--panel)'], [SELECTED, 'box-shadow', 'inset 2px 2px 0 #fff'],
      [SELECTED, 'border-bottom-color', 'var(--panel)'], [SELECTED, 'color', '#303030'],
    ]);
    // the plan's own words, and the order the selected look needs to beat the unselected one
    expect(ruleBody(TAB)).toContain('min-height: 38px');
    expect(ruleBody(TAB)).toContain('font: 15px/1 var(--font-pixel)');
    expect(position(SELECTED)).toBeGreaterThan(position(TAB));
    // ruling R1: the fade is in the one rule the panel has
    expect(ruleBody('.tab-panel')).toContain('animation: fade-in var(--dur-base) var(--ease-out)');
    expect(blocks.filter((b) => b.prelude === '.tab-panel')).toHaveLength(1);
    // The tab sits 2px over the panel's top edge, and the selected one joins the panel only while it paints above that edge. The
    // panel's fade-in makes it a stacking context for its 160ms, painted in tree order after a tab that has no z-index, so its
    // black edge covered the selected tab's foot for most of every tab switch. The tab's own z-index (1) keeps it on top, and
    // stays under the modal.
    expect(Number(declared(TAB, 'z-index'))).toBeLessThan(Number(declared('.modal-backdrop', 'z-index')));
  });

  it('draws the project list: panel cards, a pixel link, a small danger button and a chat box to confirm in', () => {
    expectDeclared([
      ['.card', 'background', 'var(--panel)'], ['.card', 'border', '2px solid var(--outline)'], ['.card', 'border-radius', '0'],
      ['.card', 'box-shadow', 'var(--bevel-panel)'],
      ['.project-link', 'color', 'var(--ink)'], ['.project-link', 'font-family', 'var(--font-pixel)'],
      ['.project-link', 'font-size', '16px'],
      ['.project-card .delete-open', 'min-height', '28px'], ['.project-card .delete-open', 'padding', '0 10px'],
      ['.project-card .delete-open', 'font-size', '13px'], ['.project-card .delete-open', 'background', 'var(--danger-face)'],
      ['.project-card .delete-open:hover', 'background', 'var(--danger-face-hover)'],
      ['.delete-confirm', 'background', 'var(--chat)'], ['.delete-confirm', 'border', '2px solid var(--outline)'],
      ['.delete-confirm', 'border-radius', '0'],
    ]);
    // the headings of the list sit on the stone: no ink group gives the page a panel's ink, so they read the page's own
    for (const group of blocks.filter((b) => !b.nested && b.inner.includes('--ink:'))) {
      expect(group.prelude, 'an ink group that lists the stone').not.toMatch(/recently-deleted|project-list|\.page\b/);
    }
  });

  it('draws the notes as panels with small buttons, and a ticked row in the muted ink with a signature that pops', () => {
    expectDeclared([
      ['.note, .note-add', 'background', 'var(--panel)'], ['.note, .note-add', 'border', '2px solid var(--outline)'],
      ['.note, .note-add', 'border-radius', '0'], ['.note, .note-add', 'box-shadow', 'var(--bevel-panel)'],
      ['.note-actions button', 'min-height', '28px'], ['.note-actions button', 'padding', '0 10px'],
      ['.note-actions button', 'font-size', '13px'],
      ['.tick.marked .tick-label', 'color', 'var(--ink-muted)'],
      ['.tick-by', 'color', 'var(--ink-ok)'], ['.tick-by', 'animation', 'pop var(--dur-fast) var(--ease-pop)'],
    ]);
  });

  it('reads no alias of the old palette in the chrome rules', () => {
    for (const selector of CHROME_RULES) expect(ruleBody(selector), selector).not.toMatch(OLD_ALIASES);
  });
});

// The settings column and the narrow-screen drawer (restyle plan Phase 1 Task 4, design spec §6 and §7a). The column is a stack of
// panels on the stone, one per section, with pixel titles; below 900 px it is a drawer that slides in from the left over a dimmed
// page, opened by the Settings button of the project head. drawer.spec.ts drives it in a browser; these cases pin the values of the
// brief, and the order the cascade needs.

const NARROW = '@media (max-width: 900px)';
/** The title of a section, whichever element carries it: its h3, the Tier label's span and the Logistics legend. */
const TITLES = '.settings-section h3, .settings-title, .settings .field > span.settings-title, .choice > legend.settings-title';
const SETTINGS_SUMMARY = 'details.settings-section > summary';
const SECTION_CONTENT = 'details.settings-section::details-content';
const LED = '.dim-name::before';

/** The declarations of the first rule for `selector` inside the `@media` block whose prelude is `query`; throws when there is none. */
function inQuery(query: string, selector: string): [string, string][] {
  const wanted = selector.replace(/\s+/g, ' ').trim();
  for (const media of blocks.filter((b) => b.prelude === query)) {
    const rule = scan(media.inner, true, []).find((b) => b.prelude === wanted);
    if (rule !== undefined) return declarations(rule.inner);
  }
  throw new Error(`styles.css has no rule for "${selector}" inside "${query}"`);
}

/** The value `property` has in the rule for `selector` inside the `query` block (the last such declaration), or undefined. */
function declaredIn(query: string, selector: string, property: string): string | undefined {
  return inQuery(query, selector).filter(([name]) => name === property).map(([, value]) => value).pop();
}

/** True when a rule for exactly `selector` sits outside every `@media` block. */
function hasTopLevelRule(selector: string): boolean {
  return blocks.some((b) => !b.nested && b.prelude === selector);
}

/** The settings rules whose colours and edges this task moved to the tokens: none may read an alias of the old palette any more. */
const SETTINGS_RULES = [
  '.settings-panel', '.settings', '.settings-section', TITLES, '.settings-section h3', '.settings-section h4', '.choice',
  '.choice > legend', '.check', '.field-label', LED, '.dim-row.reachable .dim-name::before', '.cost-table th', '.avoid-chip',
  'button.avoid-chip-remove',
];

describe('the Machine GUI settings column', () => {
  it('stacks the sections as panels on the stone, and takes the panel ink with them', () => {
    // the column itself is transparent: no surface, no edge, no padding of its own
    const column = declarations(ruleBody('.settings-panel')).map(([name]) => name);
    for (const surface of ['background', 'border', 'border-radius', 'box-shadow', 'padding']) expect(column, `.settings-panel { ${surface} }`).not.toContain(surface);
    expectDeclared([
      ['.settings-panel', 'position', 'sticky'], ['.settings-panel', 'top', '12px'], ['.settings-panel', 'max-height', 'calc(100vh - 24px)'],
      ['.settings-panel', 'overflow-y', 'auto'], ['.settings-panel', 'display', 'flex'], ['.settings-panel', 'flex-direction', 'column'],
      ['.settings-panel', 'gap', '12px'],
      ['.settings-section', 'background', 'var(--panel)'], ['.settings-section', 'border', '2px solid var(--outline)'],
      ['.settings-section', 'border-radius', '0'], ['.settings-section', 'box-shadow', 'var(--bevel-panel)'],
      ['.settings-section', 'padding', '12px'],
    ]);
    // each section is a panel, so the lines between sections are gone
    expect(declared('.settings-section', 'border-bottom')).toBeUndefined();
    expect(position('.settings-section:last-child')).toBe(-1);
    // the panel ink moved with the surface: the sections have it, and the column (now the stone) no longer does
    const panels = inkGroup('.tab-panel').prelude.split(', ');
    expect(panels).toContain('.settings-section');
    expect(panels).not.toContain('.settings-panel');
  });

  it('sets a title in the pixel font and the title ink, on whichever element carries it', () => {
    expectDeclared([
      [TITLES, 'font', '600 16px/1.3 var(--font-pixel)'], [TITLES, 'color', 'var(--ink-title)'],
      ['.settings-section h3', 'margin', '0'],
    ]);
    // only the h3 has a margin to take away: the Logistics legend keeps the 4px under it
    expect(declared(TITLES, 'margin')).toBeUndefined();
    // the micro headings of a section stay Inter (the pixel font is never below 13px)
    expect(declared('.settings-section h4', 'font-family')).toBeUndefined();
    expect(declared('.settings-section h4', 'font-size')).toBe('0.75rem');
  });

  it('keeps the summary text white on its button face, and shows the count as a green readout', () => {
    // ruling R11: the title ink (#404040) on the button face (#6b6b6b) measures 1.9:1, the white 5.3:1
    expect(declared(SUMMARY, 'color')).toBe('#ffffff');
    expect(declared(SETTINGS_SUMMARY, 'color')).toBeUndefined();
    expectDeclared([
      [SETTINGS_SUMMARY, 'font-size', '16px'],
      [`${SETTINGS_SUMMARY} > .muted`, 'background', 'var(--screen)'], [`${SETTINGS_SUMMARY} > .muted`, 'color', 'var(--screen-text)'],
      [`${SETTINGS_SUMMARY} > .muted`, 'font', '13px/1.5 var(--font-pixel)'], [`${SETTINGS_SUMMARY} > .muted`, 'margin-left', 'auto'],
    ]);
    // the readout has the specificity of the rule that gives the summary's `.muted` the button's own text colour, so it must come after
    expect(position(`${SETTINGS_SUMMARY} > .muted`)).toBeGreaterThan(position('details.settings-section > summary .muted'));
    // the title sits in a flex summary, which spaces it with `gap`: the old inline title with a margin is gone
    expect(blocks.filter((b) => b.prelude === 'details.settings-section > summary h3')).toHaveLength(1);
  });

  it('animates the height of a section that opens, and snaps where the browser cannot', () => {
    expectDeclared([
      ['details.settings-section', 'interpolate-size', 'allow-keywords'],
      [SECTION_CONTENT, 'block-size', '0'], [SECTION_CONTENT, 'overflow-y', 'clip'],
      ['details.settings-section[open]::details-content', 'block-size', 'auto'],
    ]);
    const transition = declared(SECTION_CONTENT, 'transition') ?? '';
    expect(transition).toContain('block-size var(--dur-base) var(--ease-out)');
    expect(transition).toContain('content-visibility var(--dur-base) var(--ease-out) allow-discrete');
    // the gap under the summary is the first child's margin, kept inside the clipped box by a block formatting context: out in the
    // open it would collapse through the box and jump when the content is hidden. Not padding: that of a fieldset goes under its legend.
    expect(declared(SECTION_CONTENT, 'display')).toBe('flow-root');
    expect(declared('details.settings-section > :not(summary)', 'margin-top')).toBe('8px');
    expect(declared('details.settings-section > :not(summary)', 'padding-top')).toBeUndefined();
  });

  it('lines a tick up with the first line of a label that wraps, and lights a dimension with a square LED', () => {
    expectDeclared([
      ['.check', 'align-items', 'flex-start'], ['.choice', 'align-items', 'flex-start'],
      // the 16px well beside a 20px line of text; a tick only (the layer slider of the 3D tab is in a `.check` too)
      ['.check > :where(input[type=checkbox], input[type=radio])', 'margin-top', '2px'],
      [LED, 'content', "''"], [LED, 'border', '1px solid #000'], [LED, 'background', '#6b6b6b'],
      ['.dim-row.reachable .dim-name::before', 'background', '#55ff55'],
    ]);
    expect(position('.check > input'), 'a margin on every input of a check label, the 3D layer slider\'s included').toBe(-1);
    expect(ruleBody(LED), 'a square, not a round dot').not.toContain('radius');
  });

  it('draws an avoided material as an amber readout with a square remove button', () => {
    expectDeclared([
      ['.avoid-chip', 'background', 'var(--screen)'], ['.avoid-chip', 'color', '#ffaa00'], ['.avoid-chip', 'font', '13px/1.5 var(--font-pixel)'],
      ['button.avoid-chip-remove', 'width', '24px'], ['button.avoid-chip-remove', 'height', '24px'],
      ['button.avoid-chip-remove', 'min-height', '0'], ['button.avoid-chip-remove', 'padding', '0'],
    ]);
    // a rectangle and a square: the pills are gone
    expect(ruleBody('.avoid-chip')).not.toContain('radius');
    expect(ruleBody('button.avoid-chip-remove')).not.toContain('radius');
    // no background of its own, so the button keeps the face and the hover of every button (a transparent one hid both)
    expect(declared('button.avoid-chip-remove', 'background')).toBeUndefined();
    expect(position('button.avoid-chip-remove:hover:not(:disabled)'), 'the old hover rule').toBe(-1);
    // a dark box: it takes the light ink of the group, like the other chips, and its own colour comes after the group's
    expect(inkGroup('.banner').prelude.split(', ')).toContain('.avoid-chip');
    expect(blocks.indexOf(inkGroup('.banner'))).toBeLessThan(position('.avoid-chip'));
  });

  it('reads no alias of the old palette in the settings rules', () => {
    for (const selector of SETTINGS_RULES) expect(ruleBody(selector), selector).not.toMatch(OLD_ALIASES);
  });
});

describe('the Machine GUI settings drawer', () => {
  it('shows the Settings button on narrow screens only', () => {
    expect(declared('.settings-toggle', 'display')).toBe('none');
    expect(declaredIn(NARROW, '.settings-toggle', 'display')).toBe('inline-flex');
    expect(declaredIn(NARROW, '.settings-toggle', 'align-items')).toBe('center');
  });

  it('slides the settings column in from the left, and keeps the hidden one out of the tab order', () => {
    for (const [property, value] of [
      ['position', 'fixed'], ['inset', '0 auto 0 0'], ['width', 'min(340px, 88vw)'], ['max-height', 'none'], ['overflow', 'auto'],
      ['padding', '12px'], ['background', 'var(--page)'], ['z-index', '60'],
      ['transform', 'translateX(-105%)'], ['visibility', 'hidden'],
      ['transition', 'transform var(--dur-slow) var(--ease-out), visibility 0s var(--dur-slow)'],
    ] as const) expect(declaredIn(NARROW, '.settings-panel', property), `.settings-panel { ${property} }`).toBe(value);
    // open: in place at once and visible at once; closed: out of sight and out of the tab order after the slide (the delayed `visibility`)
    expect(declaredIn(NARROW, '.settings-open .settings-panel', 'transform')).toBe('none');
    expect(declaredIn(NARROW, '.settings-open .settings-panel', 'visibility')).toBe('visible');
    expect(declaredIn(NARROW, '.settings-open .settings-panel', 'transition')).toBe('transform var(--dur-slow) var(--ease-out)');
    // the views keep the one column, with the settings column out of it
    expect(declaredIn(NARROW, '.project-body', 'grid-template-columns')).toBe('1fr');
  });

  it('dims the page behind the drawer, under the modal', () => {
    for (const [property, value] of [
      ['position', 'fixed'], ['inset', '0'], ['z-index', '50'], ['background', 'rgba(0, 0, 0, 0.6)'],
      ['animation', 'fade-in var(--dur-base) var(--ease-out)'],
    ] as const) expect(declaredIn(NARROW, '.drawer-backdrop', property), `.drawer-backdrop { ${property} }`).toBe(value);
    // the drawer is above its backdrop, and both are below the modal's
    const modal = Number(declared('.modal-backdrop', 'z-index'));
    expect(Number(declaredIn(NARROW, '.drawer-backdrop', 'z-index'))).toBeLessThan(Number(declaredIn(NARROW, '.settings-panel', 'z-index')));
    expect(Number(declaredIn(NARROW, '.settings-panel', 'z-index'))).toBeLessThan(modal);
  });

  it('keeps every drawer rule inside the query, so a wide screen keeps its sticky column and a stale backdrop dims nothing', () => {
    expect(declared('.settings-panel', 'position')).toBe('sticky');
    expect(hasTopLevelRule('.drawer-backdrop'), 'a .drawer-backdrop rule outside the query').toBe(false);
    expect(hasTopLevelRule('.settings-open .settings-panel'), 'a .settings-open rule outside the query').toBe(false);
  });
});

// The item slots, the search list, the chips and the Materials & steps tab (restyle plan Phase 1 Task 5, design spec §4, §6 and
// §7a). Every HTML item icon sits in a slot. assets.spec.ts reads the <img>'s own decoded bitmap, so nothing drawn around the image
// can change that pixel. The Flow diagram's 16 px icons sit in a 16 px foreignObject, which has no room for 4 px of frame, so they
// opt out; slots.spec.ts measures that in a browser. These cases pin the values of the brief and the order the cascade needs.

const SLOT = '.item-icon';
const SLOT_VEIL = '.item-icon::after';
const LIT_SLOT = '.item-icon:hover::after, .search-hit.active .item-icon::after';
const FLOW_SLOT = 'svg .item-icon';
const ACTIVE_HIT = ".search-hit.active, .search-hit[aria-selected='true']";
/** The pixel caret of the build toggle and of the two inline disclosures, which share one rule, and the same three turned down. */
const CARETS = 'button.mat-toggle::before, .mat-have summary::before, .mat-needed summary::before';
const CARETS_DOWN = "button.mat-toggle[aria-expanded='true']::before, .mat-have[open] summary::before, .mat-needed[open] summary::before";
const INLINE_SUMMARY = '.mat-have summary, .mat-needed summary';
const INLINE_CARET = '.mat-have summary::before, .mat-needed summary::before';
const DARK_CHIP = '.badge, .chip';
/** The rules of this task: none may read an alias of the old palette any more. */
const SLOT_AND_MATERIALS_RULES = [
  SLOT, '.item-icon.placeholder', '.search-results', '.search-hit', ACTIVE_HIT, '.search-note', '.badge.avoid-badge', '.missing-badge',
  '.materials-section', '.materials-section h3', '.mat-group h4', '.mat-row', '.mat-row > .item-icon', '.mat-toggle', '.mat-unlock',
  '.mat-missing .tick-label', 'button.pin-link',
];

describe('the Machine GUI item slots', () => {
  it('sets every HTML item icon in a slot: 2px of padding round the image, a grey face, an inverted bevel', () => {
    expectDeclared([
      [SLOT, 'box-sizing', 'content-box'], [SLOT, 'padding', '2px'], [SLOT, 'position', 'relative'], [SLOT, 'border-radius', '0'],
      [SLOT, 'background-color', 'var(--slot)'], [SLOT, 'box-shadow', 'var(--bevel-slot)'],
      // the letters of a placeholder are 7 to 12px, below what the pixel font may be
      [SLOT, 'font-family', 'var(--font-ui)'],
    ]);
    // `* { box-sizing: border-box }` would let the padding eat into the inline width and height that the unit tests pin
    expect(declared('*', 'box-sizing')).toBe('border-box');
    // a placeholder keeps the inline `background: rgb()` of its markup (an inline style beats the face), with the bevel over a dark ring
    expect(declared('.item-icon.placeholder', 'box-shadow')).toBe('var(--bevel-slot), inset 0 0 0 3px rgb(0 0 0 / 0.3)');
    expect(declared('.item-icon.placeholder', 'background')).toBeUndefined();
    expect(declared('.item-icon.placeholder', 'background-color')).toBeUndefined();
    // the letters of a light placeholder stay dark
    expect(declared('.item-icon.ink-dark', 'color')).toBe('#1f2328');
    // nothing styles the image inside: the end-to-end test reads its own bitmap
    expect(blocks.filter((b) => /\.item-icon\s*>?\s*img\b/.test(b.prelude)).map((b) => b.prelude)).toEqual([]);
  });

  it('lifts a white 35% veil over a slot that is pointed at, or that is the highlighted search hit', () => {
    expectDeclared([
      [SLOT_VEIL, 'content', "''"], [SLOT_VEIL, 'position', 'absolute'], [SLOT_VEIL, 'inset', '2px'],
      [SLOT_VEIL, 'background', 'rgb(255 255 255 / 0.35)'], [SLOT_VEIL, 'opacity', '0'], [SLOT_VEIL, 'pointer-events', 'none'],
      [SLOT_VEIL, 'transition', 'opacity var(--dur-fast) var(--ease-out)'],
      [LIT_SLOT, 'opacity', '1'],
    ]);
    // the veil covers the image and not the bevel: the padding box is the whole slot, so inset 2px is the padding's width
    expect(declared(SLOT, 'padding')).toBe(declared(SLOT_VEIL, 'inset'));
    expect(position(LIT_SLOT)).toBeGreaterThan(position(SLOT_VEIL));
  });

  it('frames no icon inside an SVG, where a 16px foreignObject has no room for 4px of frame', () => {
    expectDeclared([
      [FLOW_SLOT, 'padding', '0'], [FLOW_SLOT, 'box-shadow', 'none'], [FLOW_SLOT, 'background-color', 'transparent'],
      [FLOW_SLOT, 'position', 'static'], [FLOW_SLOT, 'box-sizing', 'border-box'],
      ['svg .item-icon::after', 'content', 'none'],
      // `.item-icon.placeholder` (0,2,0) would out-rank `svg .item-icon` (0,1,1) and keep the 2px bevel on a 16px square, so a
      // placeholder in the diagram has a rule of its own: the thin inset edge it had before the slots
      ['svg .item-icon.placeholder', 'box-shadow', 'inset 0 0 0 1px rgb(0 0 0 / 0.3)'],
    ]);
    expect(position(FLOW_SLOT)).toBeGreaterThan(position(SLOT));
    expect(position('svg .item-icon.placeholder')).toBeGreaterThan(position('.item-icon.placeholder'));
    // the inline background of a placeholder still wins over the transparent one, so the square keeps its colour in the diagram
    expect(declared('svg .item-icon.placeholder', 'background')).toBeUndefined();
  });

  it('makes the search list a dark well, with a hit that squares its corners and wears a yellow frame when it is highlighted', () => {
    expectDeclared([
      ['.search-results', 'background', 'var(--screen)'], ['.search-results', 'border', '2px solid #a0a0a0'],
      ['.search-results', 'border-radius', '0'], ['.search-hit', 'border-radius', '0'],
      // inset, so the list's own scrolling does not clip it; a frame, not a fill: the hit's text stays white on the well
      [ACTIVE_HIT, 'box-shadow', 'inset 0 0 0 2px var(--accent)'],
    ]);
    expect(declared(ACTIVE_HIT, 'background')).toBeUndefined();
    expect(declared('.search-hit', 'background')).toBeUndefined();
    // ruling R3: no scale animation on the frame
    expect(declared(ACTIVE_HIT, 'animation')).toBeUndefined();
    expect(declared(ACTIVE_HIT, 'transform')).toBeUndefined();
    // a dark box: the light ink of its group (white text, grey `.muted`), so the group is before `.muted`, which still wins on its text
    const dark = inkGroup('.banner');
    expect(dark.prelude.split(', ')).toContain('.search-results');
    expect(inkGroup('.tab-panel').prelude.split(', ')).not.toContain('.search-results');
    expect(blocks.indexOf(dark)).toBeLessThan(position('.muted'));
  });

  it('draws the avoid and missing badges as the dark chip of the shared rule, in amber and in red', () => {
    expectDeclared([['.badge.avoid-badge', 'color', '#ffaa00'], ['.missing-badge', 'color', '#ff5555']]);
    // colour only: the light fills and edges they had would win over the shared rule by coming after it
    for (const selector of ['.badge.avoid-badge', '.missing-badge']) {
      expect(declarations(ruleBody(selector)).map(([name]) => name), selector).toEqual(['color']);
    }
    // no other rule of the page gives them a face (the Flow diagram's `.flow-avoid-badge` is another class)
    const faces = blocks.filter((b) => /\.(avoid-badge|missing-badge)\b/.test(b.prelude)).map((b) => b.prelude);
    expect(faces.sort()).toEqual(['.badge.avoid-badge', '.missing-badge']);
    // `.missing-badge` and the shared rule are both one class: it is the order that lets the red win
    expect(position('.missing-badge')).toBeGreaterThan(position(DARK_CHIP));
  });
});

describe('the Machine GUI Materials & steps tab', () => {
  it('draws each section as a panel with a pixel title, in the ink of a panel', () => {
    expect(inkGroup('.tab-panel').prelude.split(', ')).toContain('.materials-section');
    expect(inkGroup('.banner').prelude.split(', ')).not.toContain('.materials-section');
    expectDeclared([
      ['.materials-section', 'background', 'var(--panel)'], ['.materials-section', 'border', '2px solid var(--outline)'],
      ['.materials-section', 'border-radius', '0'], ['.materials-section', 'box-shadow', 'var(--bevel-panel)'],
      ['.materials-section h3', 'font', '600 16px/1.3 var(--font-pixel)'], ['.materials-section h3', 'margin', '0'],
    ]);
    // the micro heading of a group stays Inter (the pixel font is never below 13px)
    expect(declared('.mat-group h4', 'font-family')).toBeUndefined();
    expect(declared('.mat-group h4', 'color')).toBe('var(--ink-muted)');
  });

  it('separates the rows with a grey line, and centres the framed icon on the first line of text', () => {
    expectDeclared([
      ['.mat-row', 'border-bottom', '1px solid #8b8b8b'],
      // the text line is 20.3px (14px at 1.45) and the framed icon 24px: half of the 4px difference, above the line
      ['.mat-row > .item-icon', 'margin-top', '-2px'],
    ]);
  });

  it('turns the toggle of a build row into a 20px caret button that turns down when the row is open', () => {
    expectDeclared([
      ['.mat-toggle', 'width', '20px'], ['.mat-toggle', 'height', '20px'], ['.mat-toggle', 'min-height', '0'], ['.mat-toggle', 'padding', '0'],
      ['.mat-toggle', 'border', 'none'], ['.mat-toggle', 'background', 'none'], ['.mat-toggle', 'box-shadow', 'none'],
      // the glyph in the markup (▸ and ▾, which the pixel font may lack) is hidden, and a pixel caret is drawn in its place
      ['.mat-toggle', 'font-size', '0'],
      [CARETS, 'content', "''"], [CARETS, 'width', '9px'], [CARETS, 'height', '9px'], [CARETS, 'background', 'currentColor'],
      [CARETS, 'transition', 'transform var(--dur-fast) var(--ease-out)'],
      [CARETS_DOWN, 'transform', 'rotate(90deg)'],
    ]);
    expect(declared(CARETS, 'clip-path'), 'a pixel caret').toMatch(/^polygon\(/);
    // a borderless button has no dark edge for the yellow ring to touch: its ring takes the focus ink of the surface, like a link's
    expect(declared('button.mat-toggle:focus-visible', 'outline-color')).toBe('var(--ink-focus)');
    // only a button has a caret: the span that keeps a leaf row in line with the others has no state to show
    const carets = blocks.flatMap((b) => b.prelude.split(', ')).filter((selector) => selector.includes('.mat-toggle') && selector.includes('::before'));
    expect(carets.length).toBeGreaterThan(0);
    for (const selector of carets) expect(selector).toMatch(/^button\.mat-toggle/);
  });

  it('keeps the two disclosures of a row inline, with the caret before the text and turned down while they are open', () => {
    expectDeclared([
      [INLINE_SUMMARY, 'cursor', 'pointer'], [INLINE_SUMMARY, 'list-style', 'none'],
      [INLINE_SUMMARY.replace(/summary/g, 'summary::-webkit-details-marker'), 'display', 'none'],
      // the caret is text-sized: inline, a little right margin and a hair below the baseline
      [INLINE_CARET, 'display', 'inline-block'], [INLINE_CARET, 'margin-right', '6px'], [INLINE_CARET, 'vertical-align', '-1px'],
    ]);
    // the shared caret rule is before the layout of the inline one, and the turned-down rule after the caret it turns
    expect(position(INLINE_CARET)).toBeGreaterThan(position(CARETS));
    expect(position(CARETS_DOWN)).toBeGreaterThan(position(CARETS));
    // inline: not the full-width Minecraft button of a settings section (no button face, no bevel, no height of its own)
    for (const property of ['background', 'border', 'box-shadow', 'min-height', 'display']) {
      expect(declared(INLINE_SUMMARY, property), `${INLINE_SUMMARY} { ${property} }`).toBeUndefined();
    }
  });

  it('draws what unlocks a row as an amber chat box, the step numbers in the pixel font, and a pin as a small button', () => {
    expectDeclared([
      ['.mat-unlock', 'background', 'var(--chat)'], ['.mat-unlock', 'color', 'var(--ink-warn)'], ['.mat-unlock', 'border-radius', '0'],
      ['.step-list li::marker', 'font-family', 'var(--font-pixel)'],
      // the inline style the pin used to carry (StepsView's PIN_LINK_STYLE), plus the height of `button.small`, which its class is not
      ['button.pin-link', 'padding', '2px 10px'], ['button.pin-link', 'font-size', '0.85rem'], ['button.pin-link', 'min-height', '28px'],
    ]);
    // a dark box, so the light ink of its group (amber is `--ink-warn` there), and its own colour comes after the group's
    expect(inkGroup('.banner').prelude.split(', ')).toContain('.mat-unlock');
    expect(blocks.indexOf(inkGroup('.banner'))).toBeLessThan(position('.mat-unlock'));
    // the pixel font is never below 13px: the marker takes the 14px of the list
    expect(declared('.step-list li::marker', 'font-size')).toBeUndefined();
  });

  it('reads no alias of the old palette in the rules of the slots, the search list and Materials', () => {
    for (const selector of SLOT_AND_MATERIALS_RULES) expect(ruleBody(selector), selector).not.toMatch(OLD_ALIASES);
  });
});

// The Flow diagram (restyle plan Phase 1 Task 6, design spec §7 and §7a): every arrow is a pipe, a dark casing with the good moving
// inside it from the output toward the input, that ends on the flange of its port; the boxes are Machine GUI blocks on a dark well;
// the panel is a Machine GUI panel that slides in, with its lists as dark wells. pipes.spec.ts watches the pipes move and measures
// their ends in a browser, flow-pipes.test.tsx pins the markup; these cases pin the values of the brief and the order the cascade
// needs.

const CASING = '.flow-edge-line';
const CONTENTS = '.flow-edge-flow';
const LIT_RIM = '.flow-edge.hl .flow-edge-hit';
const LIT_CONTENTS = '.flow-edge.hl .flow-edge-flow';
const DIMMED_CONTENTS = '.flow-edge.dim .flow-edge-flow';
const DRAGGED_CONTENTS = '.flow-canvas.dragging .flow-edge-flow';
const MANY_CONTENTS = '.flow-canvas.many-edges .flow-edge:not(.hl) .flow-edge-flow';
const FADES = '.flow-node, .flow-row, .flow-edge, .flow-group';
const LIT_BOX = '.flow-node.selected > .flow-node-box, .flow-node.producer > .flow-node-box';
const TAKER_BOX = '.flow-node.consumer > .flow-node-box';
/** The lists of the side panel, each a dark well in the light ink. */
const PANEL_LISTS = ['.flow-panel .ports', '.flow-panel .oc-lines', '.flow-panel .warnings', '.flow-panel .sources', '.flow-panel .used-by', '.flow-panel .also-made'];
const WELLS = PANEL_LISTS.join(', ');
const ISSUE_RED = '.flow-row.issue-orphan-input .flow-row-text, .flow-row.issue-short-input .flow-row-text';
const ISSUE_AMBER = '.flow-row.issue-multi-producer .flow-row-text, .flow-row.issue-bought-and-made .flow-row-text';
const ISSUE_RED_RATE = '.flow-row.issue-orphan-input .flow-row-rate, .flow-row.issue-short-input .flow-row-rate';
/** The rules of this task that colour, edge or round something: none may read an alias of the old palette any more. */
const FLOW_RULES = [
  '.flow-canvas', '.flow-node-box', '.flow-node.sink > .flow-node-box', '.flow-node-head[role=\'button\']:hover > .flow-hit',
  '.flow-node-head:focus-visible > .flow-hit, .flow-row:focus-visible > .flow-hit', '.flow-node text', '.flow-node .flow-node-line',
  '.flow-node .flow-avoid-badge rect', '.flow-row:hover > .flow-hit, .flow-row.hl > .flow-hit', '.flow-row-rate', ISSUE_RED, ISSUE_AMBER,
  ISSUE_RED_RATE, '.flow-port', CASING, '.flow-edge-label', '.flow-group-box', '.flow-group-title', '.flow-line-toggle rect',
  '.flow-line-toggle text', '.flow-edge-tag rect', '.flow-edge-tag text', '.flow-issues', '.flow-infeasible', '.flow-legend', '.swatch',
  '.swatch.free', '.swatch.sink', '.flow-panel', '.flow-panel-section', '.flow-panel-title', WELLS, '.flow-panel .warnings',
  '.swap-option.unusable, .option-choice.unusable', '.port-short .port-rate, .port-warn', '.option-slot', '.option-slot-title',
];

describe('the Machine GUI Flow diagram', () => {
  it('draws each arrow as a pipe: a dark 6px casing with butt ends on the flanges and mitred bends', () => {
    expectDeclared([
      [CASING, 'fill', 'none'], [CASING, 'stroke', 'var(--flow-edge)'], [CASING, 'stroke-width', '6'],
      [CASING, 'stroke-linejoin', 'miter'], [CASING, 'stroke-linecap', 'butt'],
    ]);
    expect(rootTokens().get('--flow-edge')).toBe('#1b1b1b');
    expect(ruleBody(CASING)).toContain('stroke-width: 6');
    // a dashed casing could end in a gap at a flange
    expect(ruleBody(CASING)).not.toContain('dasharray');
  });

  it('moves the contents along the pipe, yellow for an item and cyan for a fluid, at the speed of the arrow', () => {
    expect(ruleBody(CONTENTS)).toContain('stroke-dasharray: 6 10');
    expect(ruleBody(CONTENTS)).toContain('animation: pipe-flow var(--pipe-dur, 1s) linear infinite');
    expectDeclared([
      [CONTENTS, 'fill', 'none'], [CONTENTS, 'stroke', 'var(--item)'], [CONTENTS, 'stroke-width', '2.5'],
      // the contents never take the pointer from the arrow (the hit path and the casing do)
      [CONTENTS, 'pointer-events', 'none'],
      ['.flow-edge.fluid .flow-edge-flow', 'stroke', 'var(--fluid)'],
    ]);
    // a seamless loop: one turn of the keyframes moves the dashes by exactly one dash and its gap
    const cycle = (declared(CONTENTS, 'stroke-dasharray') ?? '').split(' ').reduce((sum, length) => sum + Number(length), 0);
    expect(ruleBody('@keyframes pipe-flow')).toContain(`stroke-dashoffset: -${cycle}`);
  });

  it('keeps a pipe its width under the pointer, and draws one from a missing source as a solid red casing', () => {
    // pointed at, only the colour of the casing changes: a wider casing would overshoot its flange (the old rule widened it)
    expect(declarations(ruleBody('.flow-edge:hover .flow-edge-line'))).toEqual([['stroke', '#2e2e2e']]);
    expect(declarations(ruleBody('.flow-edge.missing .flow-edge-line'))).toEqual([['stroke', '#aa0000']]);
    // the base rule is the only one that sizes a casing or dashes it, in any state
    const casings = blocks.filter((b) => b.prelude.includes(CASING) && b.prelude !== CASING);
    for (const block of casings) expect(block.inner, block.prelude).not.toMatch(/stroke-width|dasharray/);
    // and the hover comes before the missing rule (both 0,3,0): a missing pipe stays red under the pointer
    expect(position('.flow-edge.missing .flow-edge-line')).toBeGreaterThan(position('.flow-edge:hover .flow-edge-line'));
  });

  it('heads each arrow in the colour of what it carries, yellow when lit and a light red from a missing source', () => {
    expectDeclared([
      ['.flow-arrow-head', 'fill', 'var(--item)'], ['.flow-arrow-head-fluid', 'fill', 'var(--fluid)'],
      ['.flow-arrow-head-hl', 'fill', 'var(--accent)'], ['.flow-arrow-head-missing', 'fill', '#ff5555'],
    ]);
    // ruling R20: a missing source's head is not its casing's red, so the arrow's direction shows on it
    expect(declared('.flow-arrow-head-missing', 'fill')).not.toBe(declared('.flow-edge.missing .flow-edge-line', 'stroke'));
  });

  it('lights a focused pipe with an accent rim that blinks once and white contents, and pauses the dimmed ones', () => {
    expectDeclared([
      [LIT_RIM, 'stroke', 'var(--accent)'], [LIT_RIM, 'stroke-width', '9'],
      // ruling R19: the pulse is the rim's, on opacity (brightness cannot raise the white contents: each channel stops at 1)
      [LIT_RIM, 'animation', 'pipe-pulse 400ms var(--ease-out)'],
      [LIT_CONTENTS, 'stroke', '#ffffff'],
      [LIT_CONTENTS, 'animation', 'pipe-flow var(--pipe-dur, 1s) linear infinite'],
      [DIMMED_CONTENTS, 'animation-play-state', 'paused'],
      // what is not lit fades over 160ms instead of snapping; the dimming rule itself stays
      [FADES, 'transition', 'opacity var(--dur-base) var(--ease-out)'],
      ['.flow-canvas.focusing .dim', 'opacity', '0.18'],
    ]);
    // the rim is the hit path showing 1.5px past each side of the 6px casing it lies under
    expect((Number(declared(LIT_RIM, 'stroke-width')) - Number(declared(CASING, 'stroke-width'))) / 2).toBe(1.5);
    // the blink is visible: the rim fades to 15% and back, ending where it started
    expect(ruleBody('@keyframes pipe-pulse')).toContain('35% { opacity: 0.15; }');
    expect(ruleBody('@keyframes pipe-pulse')).toContain('0%, 100% { opacity: 1; }');
    // the casing of a lit pipe keeps its colour and width (the old rule thinned it to a 3px accent line)
    expect(position('.flow-edge.hl .flow-edge-line')).toBe(-1);
  });

  it('stops the pipes while the diagram is dragged, and above 200 edges moves only the lit ones', () => {
    const stops = (selector: string): boolean => /(^|; )(animation: none|animation-play-state: paused)(;|$)/.test(ruleBody(selector));
    expect(stops(DRAGGED_CONTENTS), DRAGGED_CONTENTS).toBe(true);
    expect(stops(MANY_CONTENTS), MANY_CONTENTS).toBe(true);
    expect(declared(DIMMED_CONTENTS, 'animation-play-state')).toBe('paused');
    // the lit rule sets the whole animation (its play state too) with the same specificity, so the drag rule must come after it
    // to stop a lit pipe as well
    expect(position(DRAGGED_CONTENTS)).toBeGreaterThan(position(LIT_CONTENTS));
  });

  it('ends every port on a flange in a slot grey with a black edge, yellow when its row is lit', () => {
    expectDeclared([
      ['.flow-port', 'fill', 'var(--slot)'], ['.flow-port', 'stroke', 'var(--outline)'], ['.flow-port', 'stroke-width', '1'],
    ]);
    // lit, only the face turns yellow: the black edge stays, so the flange keeps its outline against a yellow rim
    expect(declarations(ruleBody('.flow-row.hl .flow-port'))).toEqual([['fill', 'var(--accent)']]);
  });

  it('sets the diagram on a dark well with a 32px grid, a black edge on every side and the diagram font', () => {
    expectDeclared([
      ['.flow-canvas', 'background-color', 'var(--well)'],
      ['.flow-canvas', 'background-image', 'linear-gradient(#404040 1px, transparent 1px), linear-gradient(90deg, #404040 1px, transparent 1px)'],
      ['.flow-canvas', 'background-size', '32px 32px'],
      ['.flow-canvas', 'border', '2px solid var(--outline)'], ['.flow-canvas', 'border-radius', '0'],
      ['.flow-canvas', 'box-shadow', 'var(--bevel-well)'],
      // flow-model's text widths (7.4 and 6.2 px per character, 6.5 for a tag) are measured for this font
      ['.flow-canvas', 'font-family', 'var(--font-diagram)'],
      ['.flow-canvas', 'cursor', 'grab'],
    ]);
    // the same edge all round: flow-focus.spec.ts finds a centred box at the centre of the svg's border box
    expect(ruleBody('.flow-canvas')).not.toMatch(/border-(top|right|bottom|left)/);
  });

  it('draws the boxes as Machine GUI blocks: tinted fills, a 2px edge, a hard shadow; the boxes of a focus in yellow', () => {
    const tokens = rootTokens();
    for (const [name, value] of [
      ['--flow-owned', '#b9d6b0'], ['--flow-owned-line', '#2f6b2f'], ['--flow-new', 'var(--panel)'], ['--flow-new-line', '#000'],
      ['--flow-import', '#d8cfa8'], ['--flow-import-line', '#6b5a20'], ['--flow-missing', '#e3b0b0'], ['--flow-missing-line', '#aa0000'],
      ['--flow-out', '#f0d870'], ['--flow-out-line', '#6b5500'], ['--flow-sink', '#a8a8a8'],
      ['--flow-line', '#cbbbe0'], ['--flow-line-line', '#5a3a8a'],
    ]) expect(tokens.get(name), name).toBe(value);
    expectDeclared([
      ['.flow-node-box', 'stroke-width', '2'], ['.flow-node-box', 'filter', 'drop-shadow(0 2px 0 #000)'],
      ['.flow-node.sink > .flow-node-box', 'fill', 'var(--flow-sink)'],
      [LIT_BOX, 'stroke', 'var(--accent)'], [LIT_BOX, 'stroke-width', '3'],
      [TAKER_BOX, 'stroke', 'var(--accent)'], [TAKER_BOX, 'stroke-width', '3'], [TAKER_BOX, 'stroke-dasharray', '6 3'],
    ]);
    // a free import, a missing source, a left over and a supporting line are dashed
    for (const kind of ['.flow-node.import.leaf-free', '.flow-node.missing', '.flow-node.sink', '.flow-node.line']) {
      expect(declared(`${kind} > .flow-node-box`, 'stroke-dasharray'), kind).toBeDefined();
    }
    // the shadow is the box's alone, never its text's
    expect(blocks.filter((b) => b.prelude.includes('flow') && b.inner.includes('drop-shadow')).map((b) => b.prelude)).toEqual(['.flow-node-box']);
    // the box text keeps its sizes (flow-model measures them), and the focus outlines come after the kinds they cover
    expectDeclared([
      ['.flow-node text', 'font-size', '11.5px'], ['.flow-node .flow-node-title', 'font-size', '13px'],
      ['.flow-node .flow-node-title', 'font-weight', '600'], ['.flow-edge-label', 'font-size', '11px'],
    ]);
    expect(position(LIT_BOX)).toBeGreaterThan(position('.flow-node.line > .flow-node-box'));
    expect(position(TAKER_BOX)).toBeGreaterThan(position('.flow-node.line > .flow-node-box'));
  });

  it('keeps every text of a box at 4.5:1 or more: the panel\'s text on the grey of a left over, darker red and amber for issues', () => {
    expectDeclared([
      ['.flow-node text', 'fill', 'var(--text)'], ['.flow-node .flow-node-line', 'fill', 'var(--text-muted)'],
      ['.flow-row-rate', 'fill', 'var(--text-muted)'],
      ['.flow-node.sink .flow-node-line, .flow-node.sink .flow-row-rate', 'fill', 'var(--text)'],
      [ISSUE_RED, 'fill', 'var(--flow-error)'], [ISSUE_RED_RATE, 'fill', 'var(--flow-error)'], [ISSUE_AMBER, 'fill', 'var(--flow-warn)'],
      // the avoid badge is the amber chip of the settings column
      ['.flow-node .flow-avoid-badge rect', 'fill', 'var(--screen)'], ['.flow-node .flow-avoid-badge text', 'fill', '#ffaa00'],
    ]);
    expect(rootTokens().get('--flow-error')).toBe('#990000');
    expect(rootTokens().get('--flow-warn')).toBe('#6a4000');
  });

  it('writes the labels, the tags and the open lines in light ink on the dark canvas', () => {
    expectDeclared([
      ['.flow-edge-label', 'fill', '#ffffff'], ['.flow-edge-label', 'stroke', 'var(--well)'],
      ['.flow-edge-tag', 'pointer-events', 'none'],
      ['.flow-edge-tag rect', 'fill', 'var(--tip-bg)'], ['.flow-edge-tag rect', 'stroke', 'var(--tip-border)'],
      ['.flow-edge-tag text', 'fill', '#ffffff'], ['.flow-edge-tag text', 'font-size', '11px'], ['.flow-edge-tag text', 'font-weight', '600'],
      ['.flow-group-box', 'stroke', 'var(--flow-line)'], ['.flow-group-title', 'fill', 'var(--flow-line)'],
      // the open/collapse button is a mini Minecraft button
      ['.flow-line-toggle rect', 'fill', 'var(--btn)'], ['.flow-line-toggle rect', 'stroke', 'var(--outline)'],
      ['.flow-line-toggle text', 'fill', '#ffffff'], ['.flow-line-toggle:hover rect', 'fill', 'var(--btn-hover)'],
    ]);
    expect(declared('.flow-group-box', 'stroke-dasharray')).toBeDefined();
    // the tag stays in the diagram font: edgeTag sizes it at 6.5px per character (flow.test.tsx)
    expect(declared('.flow-edge-tag text', 'font-family')).toBeUndefined();
    expect(declared('.flow-edge-tag text', 'font')).toBeUndefined();
  });

  it('draws what does not add up and a line that cannot be planned as chat boxes in the light ink, the issues rising in', () => {
    const dark = inkGroup('.banner').prelude.split(', ');
    const panels = inkGroup('.tab-panel').prelude.split(', ');
    for (const member of ['.flow-issues', '.flow-infeasible', ...PANEL_LISTS]) {
      expect(dark, member).toContain(member);
      expect(panels, member).not.toContain(member);
    }
    expect(panels).toContain('.flow-panel');
    for (const box of ['.flow-issues', '.flow-infeasible']) {
      expectDeclared([
        [box, 'background', 'var(--chat)'], [box, 'border', '2px solid var(--outline)'], [box, 'border-radius', '0'], [box, 'color', 'var(--ink-warn)'],
      ]);
    }
    expectDeclared([
      ['.flow-issues.error', 'color', 'var(--ink-error)'],
      // ruling R4: the entrance of the banners
      ['.flow-issues', 'animation', 'rise-in var(--dur-base) var(--ease-out)'],
    ]);
    // the legend's swatches are square with a 2px edge
    expectDeclared([['.swatch', 'border-radius', '0'], ['.swatch', 'border', '2px solid var(--flow-raw-line)'], ['.swatch.sink', 'background', 'var(--flow-sink)']]);
  });

  it('slides the side panel in as a Machine GUI panel, with its lists as dark wells, and never animates the grid', () => {
    expectDeclared([
      ['.flow-panel', 'background', 'var(--panel)'], ['.flow-panel', 'border', '2px solid var(--outline)'], ['.flow-panel', 'border-radius', '0'],
      ['.flow-panel', 'box-shadow', 'var(--bevel-panel)'], ['.flow-panel', 'animation', 'slide-in-right var(--dur-slow) var(--ease-out)'],
      ['.flow-panel-head h3', 'font', '600 16px/1.3 var(--font-pixel)'],
      [WELLS, 'background', 'var(--screen)'], [WELLS, 'box-shadow', 'var(--bevel-well)'],
      ['.flow-panel .warnings', 'color', 'var(--ink-error)'], ['.port-short .port-rate, .port-warn', 'color', 'var(--ink-error)'],
      // the panel slides in from the right: no horizontal scroll bar flashes while it does
      ['.flow', 'overflow-x', 'clip'],
      // and the focus ring of the Zoom in button, on the clipped edge, keeps its left side: Chromium applies the clip margin only
      // when both axes clip (measured in a browser for this task)
      ['.flow', 'overflow-y', 'clip'], ['.flow', 'overflow-clip-margin', '4px'],
    ]);
    // the grid column changes at once (the e2e tests read it): nothing animates or transitions the grid or the panel's width
    for (const block of blocks.filter((b) => b.prelude === '.flow' || b.prelude === '.flow.has-panel')) {
      expect(block.inner, block.prelude).not.toMatch(/transition|animation/);
    }
    expect(ruleBody('.flow-panel')).not.toMatch(/transition|(^|; )width/);
    // the hand-offs: a 16px tick centred on the first line of its text, and the steps under a port past its 20px slot
    expectDeclared([['.swap-option input', 'margin-top', '2px'], ['.option-choice input', 'margin-top', '2px'], ['.port-peers', 'padding-left', '26px']]);
  });

  it('reads no alias of the old palette and rounds no corner in the Flow rules', () => {
    for (const selector of FLOW_RULES) {
      expect(ruleBody(selector), selector).not.toMatch(OLD_ALIASES);
      expect(declared(selector, 'border-radius') ?? '0', selector).toBe('0');
    }
  });
});

// The Connections tab (restyle plan Phase 1 Task 7, design spec §7 and §7a): every link is a pipe like the flow diagram's, its
// contents in its channel's dye or in the colour of what carries it; a dye too dark for the dark casing gets a panel-grey one (the
// view sets `--pipe-casing`); what carries nothing is a thin still line. The boxes are Machine GUI blocks that never move under the
// pointer (connections.spec.ts measures a hovered box), on a well whose grid is the area's own background, so nothing lies over the
// svg (connections.spec.ts hit-tests empty space). connections-view.test.tsx pins the markup, pipes.spec.ts watches the pipes move.

const CONN_CASING = '.conn-edge-line';
const CONN_CONTENTS = '.conn-edge-flow';
const CONN_RIM = '.conn-edge-rim';
const CONN_HOVER_RIM = '.conn-edge:hover .conn-edge-rim';
const CONN_PICKED_RIM = '.conn-edge.selected .conn-edge-rim';
const CONN_DRAGGED = '.connections > svg.dragging .conn-edge-flow';
const CONN_MANY = ".connections[data-pipes='lit'] .conn-edge:not(.selected) .conn-edge-flow";
const CONN_HAND_CASING = '.conn-via-hand .conn-edge-line';
const CONN_HAND_LIT = '.conn-via-hand:hover .conn-edge-line, .conn-via-hand.selected .conn-edge-line';
const CONN_QUIET = '.conn-via-attached .conn-edge-line, .conn-via-hookup .conn-edge-line';
const CONN_QUIET_RIM = '.conn-via-attached .conn-edge-rim, .conn-via-hookup .conn-edge-rim';
const CONN_BOX = '.conn-node > rect, .conn-node > path';
const CONN_BOX_HOVER = '.conn-node:hover > rect, .conn-node:hover > path';
const CONN_BOX_PICKED = '.conn-node.selected > rect, .conn-node.selected > path';
const CONN_DASHED = '.conn-hookup > rect, .conn-hookup > path, .conn-sink > rect, .conn-sink > path';
/** The rules of this task that colour, edge or round something: none may read an alias of the old palette any more. */
const CONN_RULES = [
  '.connections', '.connections > svg', '.connections > svg:focus-visible', CONN_BOX, '.conn-node > path', CONN_BOX_HOVER, CONN_BOX_PICKED,
  '.conn-node text', '.conn-node .conn-line', '.conn-node .conn-face', '.conn-node .conn-face-mode', CONN_CASING, CONN_CONTENTS,
  `${CONN_CONTENTS}:not([stroke])`, CONN_QUIET, CONN_RIM, CONN_HOVER_RIM, CONN_PICKED_RIM, '.conn-arrow-head', '.conn-label', '.conn-legend',
  '.conn-swatch', '.conn-panel', '.conn-panel-head h3',
];

describe('the Machine GUI Connections tab', () => {
  it('draws each link as a pipe: a 6px casing, dark or the panel grey the view asks for, with butt ends on the boxes and mitred bends', () => {
    expectDeclared([
      ['.conn-edge polyline', 'fill', 'none'], ['.conn-edge polyline', 'stroke-linejoin', 'miter'],
      [CONN_CASING, 'stroke', 'var(--pipe-casing, #1b1b1b)'], [CONN_CASING, 'stroke-width', '6'], [CONN_CASING, 'stroke-linecap', 'butt'],
    ]);
    // the old rules styled the bare polyline, so the contents would have taken the casing's width and the hand's dashes
    expect(blocks.filter((b) => /\.conn-edge(\.selected|:hover)? polyline(:|\[|,|$)/.test(b.prelude)).map((b) => b.prelude)).toEqual(['.conn-edge polyline']);
    expect(declarations(ruleBody('.conn-edge polyline')).map(([name]) => name).sort()).toEqual(['fill', 'stroke-linejoin']);
    // a casing is never dashed but where it carries nothing, so a pipe cannot end in a gap at its box
    for (const block of blocks.filter((b) => b.prelude.includes(CONN_CASING) && b.inner.includes('dasharray'))) {
      expect(block.prelude, 'only an interface on its machine or a hookup has a dashed line').toMatch(/^\.conn-via-(attached|hookup) \.conn-edge-line$/);
    }
  });

  it('moves the contents 6px on 10px off at the speed of the link, in the channel\'s colour or else the carrier\'s', () => {
    expect(ruleBody(CONN_CONTENTS)).toContain('stroke-dasharray: 6 10');
    expect(ruleBody(CONN_CONTENTS)).toContain('animation: pipe-flow var(--pipe-dur, 0.8s) linear infinite');
    expectDeclared([[CONN_CONTENTS, 'stroke-width', '2.5'], [`${CONN_CONTENTS}:not([stroke])`, 'stroke', 'var(--conn-link)']]);
    // a channel's dye is the contents' stroke attribute, which a stroke in any rule for every content would cover
    expect(declared(CONN_CONTENTS, 'stroke')).toBeUndefined();
    // a seamless loop: one turn of the keyframes moves the dashes by exactly one dash and its gap
    const cycle = (declared(CONN_CONTENTS, 'stroke-dasharray') ?? '').split(' ').reduce((sum, length) => sum + Number(length), 0);
    expect(ruleBody('@keyframes pipe-flow')).toContain(`stroke-dashoffset: -${cycle}`);
  });

  it('draws a flow by hand as a 16px dash-dot with no pipe round it, and what carries nothing as a thin still grey line', () => {
    expectDeclared([
      ['.conn-via-hand .conn-edge-flow', 'stroke-dasharray', '8 3 2 3'], [CONN_HAND_CASING, 'stroke', 'transparent'],
      [CONN_QUIET, 'stroke', 'var(--conn-link)'], [CONN_QUIET, 'stroke-width', '2'],
      ['.conn-via-attached, .conn-via-hookup', '--conn-link', '#8a92a0'],
      ['.conn-via-hookup .conn-edge-line', 'stroke-dasharray', '6 4'], ['.conn-via-attached .conn-edge-line', 'stroke-dasharray', '2 3'],
    ]);
    // the hand's dash-dot loops as seamlessly as the 6 10 of the others
    expect((declared('.conn-via-hand .conn-edge-flow', 'stroke-dasharray') ?? '').split(' ').reduce((sum, length) => sum + Number(length), 0)).toBe(16);
  });

  it('heads each pipe in the colour of what it carries, or of a hookup\'s line', () => {
    // the marker sits on the contents (on the casing where nothing moves), and its head takes that element's stroke
    expect(declarations(ruleBody('.conn-arrow-head'))).toEqual([['fill', 'context-stroke']]);
  });

  it('rims a pointed-at link in white and a picked one in yellow that blinks once, 1.5px round a casing that keeps its width', () => {
    expectDeclared([
      [CONN_RIM, 'stroke', 'none'], [CONN_RIM, 'stroke-width', '9'], [CONN_QUIET_RIM, 'stroke-width', '5'],
      [CONN_HOVER_RIM, 'stroke', '#ffffff'], [CONN_PICKED_RIM, 'stroke', 'var(--accent)'],
      // ruling R19: a pulse is the rim's, on opacity, never the contents'
      [CONN_PICKED_RIM, 'animation', 'pipe-pulse 400ms var(--ease-out)'],
      // a hand's link shows a casing only while it is rimmed, so its amber does not lie on the white or the yellow
      [CONN_HAND_LIT, 'stroke', '#1b1b1b'],
      ['.conn-edge.selected .conn-label', 'font-weight', '600'],
    ]);
    // 1.5px of rim past each side of a 6px casing and of a 2px line
    expect((Number(declared(CONN_RIM, 'stroke-width')) - Number(declared(CONN_CASING, 'stroke-width'))) / 2).toBe(1.5);
    expect((Number(declared(CONN_QUIET_RIM, 'stroke-width')) - Number(declared(CONN_QUIET, 'stroke-width'))) / 2).toBe(1.5);
    // only the base rules size a casing or its contents: no state widens either (the old rule widened a hovered link to 4px)
    for (const block of blocks.filter((b) => /\.conn-edge-(line|flow)/.test(b.prelude) && /:hover|\.selected/.test(b.prelude))) {
      expect(block.inner, block.prelude).not.toMatch(/stroke-width/);
    }
    // the picked rim wins over the pointed-at one on a picked link under the pointer (both 0,3,0)
    expect(position(CONN_PICKED_RIM)).toBeGreaterThan(position(CONN_HOVER_RIM));
  });

  it('stops the pipes while the picture is dragged, and above 200 links moves only the picked one', () => {
    expect(declarations(ruleBody(CONN_DRAGGED))).toEqual([['animation-play-state', 'paused']]);
    expect(declarations(ruleBody(CONN_MANY))).toEqual([['animation', 'none']]);
  });

  it('sets the picture on a dark well with a 32px grid that is the area\'s own background, and nothing over the svg', () => {
    expectDeclared([
      ['.connections', 'background-color', 'var(--well)'],
      ['.connections', 'background-image', 'linear-gradient(#404040 1px, transparent 1px), linear-gradient(90deg, #404040 1px, transparent 1px)'],
      ['.connections', 'background-size', '32px 32px'],
      ['.connections', 'border', '2px solid var(--outline)'], ['.connections', 'border-radius', '0'],
      ['.connections', 'box-shadow', 'var(--bevel-well)'], ['.connections', 'overflow', 'hidden'],
      // the box metrics and cuts (32 and 38 characters) are measured for the diagram font
      ['.connections > svg', 'font-family', 'var(--font-diagram)'], ['.connections > svg', 'transition', 'opacity var(--dur-base)'],
      ['.connections > svg', 'cursor', 'grab'],
      // the area clips its outside, so the keyboard's ring is drawn inside the svg
      ['.connections > svg:focus-visible', 'outline', '3px solid var(--accent)'], ['.connections > svg:focus-visible', 'outline-offset', '-3px'],
    ]);
    // a pseudo-element of the area would lie over the svg, and elementFromPoint on empty space must find the svg
    expect(blocks.filter((b) => /\.connections[^,{]*::?(before|after)/.test(b.prelude)).map((b) => b.prelude)).toEqual([]);
  });

  it('draws the boxes as Machine GUI blocks that never move or grow under the pointer', () => {
    expectDeclared([
      [CONN_BOX, 'fill', 'var(--panel)'], [CONN_BOX, 'stroke', 'var(--outline)'], [CONN_BOX, 'stroke-width', '2'],
      [CONN_BOX, 'filter', 'drop-shadow(0 2px 0 #000)'], ['.conn-node > path', 'fill', '#e0e0e0'],
      ['.conn-chest > rect', 'fill', '#f0d870'], ['.conn-chest > rect, .conn-chest > path', 'stroke', '#6b5500'],
      ['.conn-interface > rect', 'fill', '#cbbbe0'], ['.conn-interface > rect, .conn-interface > path', 'stroke', '#5a3a8a'],
      ['.conn-source > rect', 'fill', '#d8cfa8'], ['.conn-source > rect, .conn-source > path', 'stroke', '#6b5a20'],
      ['.conn-hookup > rect, .conn-sink > rect', 'fill', '#a8a8a8'], [CONN_DASHED, 'stroke-dasharray', '4 3'],
      [CONN_BOX_PICKED, 'stroke', 'var(--accent)'], [CONN_BOX_PICKED, 'stroke-width', '3'],
    ]);
    // pointed at, a box only changes the colour of its edge (connections.spec.ts measures it hovered)
    expect(declarations(ruleBody(CONN_BOX_HOVER))).toEqual([['stroke', '#ffffff']]);
    // the shadow is the rect's and the face rows', never the text's
    expect(blocks.filter((b) => b.prelude.includes('conn') && b.inner.includes('drop-shadow')).map((b) => b.prelude)).toEqual([CONN_BOX]);
    // a CSS transform on a group would replace its transform attribute (a box would jump to the corner), and the view moves at once
    for (const block of blocks.filter((b) => /\.conn-|\.connections/.test(b.prelude))) expect(block.inner, block.prelude).not.toMatch(/(^|; )transform:/);
    expect(blocks.filter((b) => /\.conn-pan(?![\w-])/.test(b.prelude)).map((b) => b.prelude)).toEqual([]);
    // the hover and the pick come after the kinds whose edges they cover
    expect(position(CONN_BOX_HOVER)).toBeGreaterThan(position('.conn-source > rect, .conn-source > path'));
    expect(position(CONN_BOX_PICKED)).toBeGreaterThan(position(CONN_BOX_HOVER));
  });

  it('keeps the box texts at the sizes the model measures, in inks of 4.5:1, and the labels light on the dark well', () => {
    expectDeclared([
      ['.conn-node text', 'fill', 'var(--text)'], ['.conn-node text', 'font-size', '11.5px'], ['.conn-node text', 'pointer-events', 'none'],
      ['.conn-node .conn-title', 'font-size', '13px'], ['.conn-node .conn-title', 'font-weight', '600'],
      ['.conn-node .conn-line', 'fill', 'var(--text-muted)'], ['.conn-node .conn-face', 'fill', '#1d3b9a'],
      ['.conn-node .conn-face-mode', 'fill', 'var(--text-muted)'], ['.conn-node .conn-face-mode', 'font-size', '10.5px'],
      // the grey of a hookup or a left over is darker than a panel: its quieter lines would fall under 4.5:1 there
      ['.conn-hookup .conn-line, .conn-sink .conn-line', 'fill', 'var(--text)'],
      ['.conn-label', 'fill', '#ffffff'], ['.conn-label', 'stroke', '#1b1b1b'], ['.conn-label', 'font-size', '11px'],
      ['.conn-label', 'paint-order', 'stroke'],
    ]);
    expect(position('.conn-hookup .conn-line, .conn-sink .conn-line')).toBeGreaterThan(position('.conn-node .conn-line'));
    // ELK sizes a label at 6.5px a character of the diagram font: no rule gives a label or a box text another font
    for (const block of blocks.filter((b) => /\.conn-(node|label|title|line|face)/.test(b.prelude))) {
      expect(block.inner, block.prelude).not.toMatch(/(^|; )font(-family)?:/);
    }
  });

  it('draws the legend\'s swatch as a mini pipe on its one empty span, and its text in the quiet ink of the panel', () => {
    expectDeclared([
      ['.conn-legend', 'color', 'var(--ink-muted)'],
      ['.conn-swatch', 'height', '6px'], ['.conn-swatch', 'background-color', '#1b1b1b'],
      ['.conn-swatch', 'background-image', 'linear-gradient(90deg, var(--conn-link) 6px, transparent 6px)'],
      ['.conn-swatch', 'background-size', '16px 2px'],
    ]);
    // a pseudo-element would need content, and the legend reads one span per entry
    expect(blocks.filter((b) => /\.conn-swatch[^,{]*::?(before|after)/.test(b.prelude)).map((b) => b.prelude)).toEqual([]);
  });

  it('slides the side panel in as a Machine GUI panel, and never animates the grid or the panel\'s width', () => {
    expectDeclared([
      ['.conn-panel', 'background', 'var(--panel)'], ['.conn-panel', 'border', '2px solid var(--outline)'], ['.conn-panel', 'border-radius', '0'],
      ['.conn-panel', 'box-shadow', 'var(--bevel-panel)'], ['.conn-panel', 'animation', 'slide-in-right var(--dur-slow) var(--ease-out)'],
      ['.conn-panel-head h3', 'font', '600 16px/1.3 var(--font-pixel)'],
      // as for the flow diagram (ruling R17): the slide flashes no horizontal scroll bar, and the Fit button keeps its whole ring
      ['.conn-view', 'overflow-x', 'clip'], ['.conn-view', 'overflow-y', 'clip'], ['.conn-view', 'overflow-clip-margin', '4px'],
    ]);
    expect(inkGroup('.tab-panel').prelude.split(', ')).toContain('.conn-panel');
    // the grid column changes at once (connections.spec.ts reads the narrowed svg straight away)
    for (const block of blocks.filter((b) => b.prelude === '.conn-view' || b.prelude === '.conn-view.has-panel')) {
      expect(block.inner, block.prelude).not.toMatch(/transition|animation/);
    }
    expect(ruleBody('.conn-panel')).not.toMatch(/transition|(^|; )width/);
  });

  it('keeps the carriers\' colours of the 3D view and the map, and has dropped the halo of the old channel lines', () => {
    expectDeclared([
      ['.conn-via-gt_pipe', '--conn-link', '#9ccc65'], ['.conn-via-fluid_pipe', '--conn-link', '#1e88e5'],
      ['.conn-via-routed', '--conn-link', '#ff7043'], ['.conn-via-ae2', '--conn-link', '#7e57c2'],
      ['.conn-via-item_conduit, .conn-via-fluid_conduit', '--conn-link', '#26c6da'], ['.conn-via-hand', '--conn-link', '#ffca28'],
    ]);
    expect(css).not.toContain('--conn-halo');
  });

  it('reads no alias of the old palette and rounds no corner in the Connections rules', () => {
    for (const selector of CONN_RULES) {
      expect(ruleBody(selector), selector).not.toMatch(OLD_ALIASES);
      expect(declared(selector, 'border-radius') ?? '0', selector).toBe('0');
    }
    // nor does any other rule of the tab: they are the flow diagram's tokens no more either
    for (const block of blocks.filter((b) => /\.conn-|\.connections/.test(b.prelude))) {
      expect(block.inner, block.prelude).not.toMatch(OLD_ALIASES);
      expect(block.inner, block.prelude).not.toMatch(/var\(--flow-/);
    }
  });
});

// The Map tab (restyle plan Phase 1 Task 8, design spec §6 and §8): the controls on the tab's panel, the map in a frame of its own
// under a toolbar of Minecraft buttons, the new line and what the scan found in two panels beside it, and an NEI tooltip over the
// map. The inline styles of the five files are classes now, and the rules below carry the values they had; what stays inline is the
// canvas's style, the tooltip's position and pointer events and the colour of a pin's dot. map-view.test.tsx and the other markup
// tests pin the classes in the markup, world.spec.ts and layout.spec.ts the canvas that must stay where it was.

const MAP_FILES = ['views/MapTab.tsx', 'views/MapView.tsx', 'map/MapTooltip.tsx', 'map/LinePanel.tsx', 'map/FoundPanel.tsx'];
/** The old palette's names, by prefix (`var(--surface` is `--surface-2` too): none of the five files reads one any more. */
const OLD_PALETTE = ['var(--surface', 'var(--border', 'var(--radius', 'var(--accent', 'var(--ok', 'var(--warn-', 'var(--error'];
const TIP = '.map-tooltip';
const PANELS = '.line-panel, .found-panel';
const MAP_BULLETS = '.line-panel ul, .found-panel ul';
const MAP_LISTS = '.line-panel .map-list, .found-panel .map-list';
const ROW = '.map-row-button';
const PICKED_ROW = ".map-list > li[aria-current='true'] > .map-row-button";
/** A selector of this tab: the class it styles is one of the tab's own. */
const MAP_RULE = /\.(map-(tab-status|tab|picker-actions|picker-line|picker|controls|layers|body|main|side|view|toolbar|zoom|y|box|tooltip|list|row-button)|line-panel|line-actions|found-(panel|section|item-label|item-name|show-all)|pin-dot)(?![\w-])/;
/** What the canvas sits in, and the tab the note dialog's fixed backdrop is drawn in. */
const MAP_ANCESTORS = ['.map-tab', '.map-body', '.map-main', '.map-view', '.map-box'];

describe('the Machine GUI Map tab', () => {
  it('has moved the inline styles of the five Map files to classes, and left the old palette', () => {
    const inline: Record<string, number> = {};
    for (const file of MAP_FILES) {
      const source = read(file);
      for (const name of OLD_PALETTE) expect(source.includes(name), `${file} reads ${name}`).toBe(false);
      expect(source, file).not.toMatch(/\b(MAP_STYLE|PANEL_STYLE|FITS_STYLE|LIST_STYLE|PLAIN_LIST_STYLE|SUBHEAD_STYLE|DOT_STYLE)\b/);
      inline[file] = (source.match(/\bstyle=\{/g) ?? []).length;
    }
    // what stays inline: the canvas's (its cursor is written from code), the tooltip's position and pointer events, and a pin's dot
    // (the colour of its marker on the map, as the 3D view's legend swatch)
    expect(inline).toEqual({ 'views/MapTab.tsx': 0, 'views/MapView.tsx': 1, 'map/MapTooltip.tsx': 1, 'map/LinePanel.tsx': 1, 'map/FoundPanel.tsx': 0 });
    expect(read('map/MapTooltip.tsx')).toContain("const TOOLTIP_STYLE: CSSProperties = { position: 'absolute', pointerEvents: 'none' };");
    expect(read('map/LinePanel.tsx')).toContain('style={{ background: PIN_COLORS[p.kind] }}');
  });

  it('draws the tooltip as an NEI tooltip: a dark box with a violet edge, a white first line and grey details, that rises in', () => {
    expectDeclared([
      [TIP, 'background', 'var(--tip-bg)'], [TIP, 'border', '2px solid var(--tip-border)'],
      [TIP, 'box-shadow', '0 0 0 1px #100010, inset 0 0 0 1px var(--tip-inner)'],
      [TIP, 'color', '#aaaaaa'], [TIP, 'font', '14px/1.35 var(--font-pixel)'], [TIP, 'animation', 'rise-in 120ms var(--ease-out)'],
      // what the inline style used to carry, but the position and the pointer events (they stay inline)
      [TIP, 'width', 'max-content'], [TIP, 'max-width', '360px'], [TIP, 'padding', '6px 8px'], [TIP, 'overflow-wrap', 'anywhere'],
      ['.map-tooltip > :first-child', 'color', '#ffffff'],
    ]);
    expect(ruleBody(TIP)).toContain('background: var(--tip-bg)');
    expect(ruleBody(TIP)).toContain('border: 2px solid var(--tip-border)');
    expect(declared(TIP, 'border-radius') ?? '0').toBe('0');
    // the first line of a tooltip is the one the hover code puts first (the block's name, else its position, else the base)
    expect(position('.map-tooltip > :first-child')).toBeGreaterThan(position(TIP));
  });

  it('frames the map on its box, and never on the canvas or on anything laid over it', () => {
    expectDeclared([
      ['.map-box', 'position', 'relative'], ['.map-box', 'overflow', 'hidden'], ['.map-box', 'flex', '1'], ['.map-box', 'min-height', '360px'],
      ['.map-box', 'background', 'var(--well)'], ['.map-box', 'border', '3px solid'],
      ['.map-box', 'border-color', 'var(--slot-lo) var(--slot-hi) var(--slot-hi) var(--slot-lo)'],
      ['.map-box', 'outline', '2px solid var(--outline)'],
    ]);
    // the canvas fills the box's padding box: the tests aim at its centre, read its bitmap and measure the box
    expect(blocks.filter((b) => /(^|[\s,>+~])canvas\b/.test(b.prelude) || /\.map-[a-z-]+[^,{]*\bcanvas\b/.test(b.prelude)).map((b) => b.prelude), 'a rule for the canvas').toEqual([]);
    expect(blocks.filter((b) => /\.map-(box|view|main)[^,{]*::?(before|after)/.test(b.prelude)).map((b) => b.prelude), 'a pseudo-element over the canvas').toEqual([]);
  });

  it('lays the tab out as its inline styles did: the controls, the picker, the map, and the side column that scrolls', () => {
    expectDeclared([
      ['.map-tab', 'display', 'flex'], ['.map-tab', 'flex-direction', 'column'], ['.map-tab', 'gap', '10px'],
      ['.map-tab-status, .map-picker, .map-picker-line', 'max-width', '560px'],
      ['.map-picker', 'display', 'flex'], ['.map-picker', 'flex-direction', 'column'], ['.map-picker', 'gap', '12px'],
      ['.map-picker > h2, .map-picker > p', 'margin', '0'], ['.map-picker-actions', 'gap', '16px'], ['.map-picker-line', 'margin-top', '14px'],
      ['.map-controls', 'display', 'flex'], ['.map-controls', 'flex-wrap', 'wrap'], ['.map-controls', 'gap', '12px'],
      ['.map-controls', 'align-items', 'flex-end'],
      ['.map-layers', 'display', 'flex'], ['.map-layers', 'flex-wrap', 'wrap'], ['.map-layers', 'gap', '12px'], ['.map-layers', 'border', '0'],
      ['.map-layers', 'margin', '0'], ['.map-layers', 'padding', '0'],
      ['.map-body', 'display', 'flex'], ['.map-body', 'flex-wrap', 'wrap'], ['.map-body', 'gap', '12px'], ['.map-body', 'align-items', 'stretch'],
      ['.map-main', 'flex', '3 1 420px'], ['.map-main', 'min-width', '0'], ['.map-main', 'height', 'min(72vh, 760px)'],
      ['.map-main', 'min-height', '420px'],
      ['.map-side', 'flex', '1 1 300px'], ['.map-side', 'max-width', '400px'], ['.map-side', 'max-height', 'min(72vh, 760px)'],
      ['.map-side', 'overflow-y', 'auto'], ['.map-side', 'padding-right', '4px'], ['.map-side', 'display', 'flex'],
      ['.map-side', 'flex-direction', 'column'], ['.map-side', 'gap', '14px'], ['.map-side', 'scrollbar-color', 'var(--btn) var(--well)'],
      ['.map-view', 'display', 'flex'], ['.map-view', 'flex-direction', 'column'], ['.map-view', 'gap', '8px'], ['.map-view', 'min-width', '0'],
      ['.map-view', 'height', '100%'],
    ]);
    // `.row` sets the picker's actions a gap of 8px: theirs is wider, so it comes after
    expect(position('.map-picker-actions')).toBeGreaterThan(position('.row'));
  });

  it('puts the new line and what the scan found in panels, in the ink of a panel, with pixel titles and no bare lists', () => {
    expectDeclared([
      [PANELS, 'display', 'flex'], [PANELS, 'flex-direction', 'column'], [PANELS, 'background', 'var(--panel)'],
      [PANELS, 'border', '2px solid var(--outline)'], [PANELS, 'border-radius', '0'], [PANELS, 'box-shadow', 'var(--bevel-panel)'],
      ['.line-panel', 'gap', '6px'], ['.found-panel', 'gap', '10px'],
      ['.line-panel > h3, .found-section > h3', 'font', '600 16px/1.3 var(--font-pixel)'], ['.line-panel > h3, .found-section > h3', 'margin', '0'],
      // the micro heading of a group stays Inter, as in the settings and in Materials
      ['.line-panel h4', 'font-size', '0.75rem'], ['.line-panel h4', 'color', 'var(--ink-muted)'], ['.line-panel h4', 'margin', '4px 0 0'],
      ['.line-panel p, .found-panel p', 'margin', '0'], [MAP_BULLETS, 'margin', '0'], [MAP_BULLETS, 'padding-left', '18px'],
      ['.found-section', 'display', 'flex'], ['.found-section', 'flex-direction', 'column'], ['.found-section', 'gap', '4px'],
      ['.found-section + .found-section', 'border-top', '1px solid #8b8b8b'], ['.found-section + .found-section', 'padding-top', '10px'],
      ['.line-actions', 'gap', '6px'], ['.found-panel summary', 'cursor', 'pointer'],
      ['.found-item-label', 'display', 'inline-flex'], ['.found-item-label', 'align-items', 'center'], ['.found-item-label', 'gap', '6px'],
      ['.found-item-label', 'vertical-align', 'middle'], ['.found-item-name', 'overflow-wrap', 'anywhere'], ['.found-show-all', 'align-self', 'flex-start'],
    ]);
    expect(declared('.line-panel h4', 'font-family'), 'a micro heading is under the 13px the pixel font may be').toBeUndefined();
    // the panel group sets the panel ink, and the panels are in it (so are a panel's rules wherever it sits), not in the dark box group
    expect(inkGroup('.line-panel')).toBe(inkGroup('.tab-panel'));
    expect(inkGroup('.found-panel')).toBe(inkGroup('.tab-panel'));
    expect(inkGroup('.banner').prelude.split(', ')).not.toContain('.line-panel');
    expect(inkGroup('.banner').prelude.split(', ')).not.toContain('.found-panel');
    expect(blocks.indexOf(inkGroup('.line-panel'))).toBeLessThan(position('.muted'));
  });

  it('lists the pins, the notes and the items as flat rows, and the picked row as a dark one with yellow text', () => {
    expectDeclared([
      [MAP_LISTS, 'list-style', 'none'], [MAP_LISTS, 'padding', '0'], [MAP_LISTS, 'display', 'flex'], [MAP_LISTS, 'flex-direction', 'column'],
      ['.map-list > li + li', 'border-top', '1px solid #8b8b8b'], ['.map-list > li > details', 'padding', '4px 0'],
      // a flat row on the panel, not a button face: the muted coordinates of a note are 1.7:1 on a button's grey
      [ROW, 'width', '100%'], [ROW, 'text-align', 'left'], [ROW, 'padding', '4px 8px'], [ROW, 'background', 'transparent'], [ROW, 'border', '0'],
      [ROW, 'box-shadow', 'none'], [ROW, 'text-shadow', 'none'], [ROW, 'color', 'var(--ink)'],
      // a label that wraps needs more than the button's line height of 1, and it is a sentence: Inter, at the size of the lists beside it
      [ROW, 'font', '0.85rem/1.3 var(--font-ui)'],
      [`${ROW}:hover`, 'background', 'rgb(255 255 255 / 0.35)'],
      [PICKED_ROW, 'background', 'var(--screen)'], [PICKED_ROW, 'color', 'var(--accent)'], [`${PICKED_ROW} .muted`, 'color', 'var(--screen-muted)'],
      // a flat row has no dark edge for a yellow ring to touch, a dark row has
      [`${ROW}:focus-visible`, 'outline-color', 'var(--ink-focus)'], [`${PICKED_ROW}:focus-visible`, 'outline-color', 'var(--accent)'],
    ]);
    expect(Number(/\/([\d.]+) /.exec(declared(ROW, 'font') ?? '')?.[1])).toBeGreaterThanOrEqual(1.3);
    // `.found-panel ul` (0,1,1) would put the bullets back on a list: the resets have two classes, and come after it
    expect(position(MAP_LISTS)).toBeGreaterThan(position(MAP_BULLETS));
    // the picked row beats the pointed-at one by its own specificity, and the dark row's ring beats the flat row's
    expect(position(PICKED_ROW)).toBeGreaterThan(position(`${ROW}:hover`));
    expect(position(`${PICKED_ROW}:focus-visible`)).toBeGreaterThan(position(`${ROW}:focus-visible`));
  });

  it('tints the fits badge by its data-fits in the colours of a dark box, and nothing else of it', () => {
    for (const [fits, colour] of [['yes', '#55ff55'], ['tight', '#ffaa00'], ['no', '#ff5555'], ['unknown', '#aaaaaa']] as const) {
      const selector = `.badge[data-fits='${fits}']`;
      expect(declarations(ruleBody(selector)), selector).toEqual([['color', colour]]);
      expect(position(selector), selector).toBeGreaterThan(position('.badge, .chip'));
    }
    // the note badge is the plain one (`<span class="badge">N1</span>`): nothing of the panel tints it
    expect(blocks.filter((b) => /\.found-panel[^,{]*\.badge|\.map-row-button[^,{]*\.badge/.test(b.prelude)).map((b) => b.prelude)).toEqual([]);
  });

  // Pixelify Sans draws its lowercase "fi" and "fl" as ligatures that look like an A at 13 and 14px ("Does not fit" read "Does not At",
  // "minecraft:fire" read "minecraft:Are": measured in a browser). The `font` shorthand resets the setting, so it comes after the
  // shorthand in a rule of its own, or in the same rule below it.
  it('keeps the pixel font\'s fi and fl ligatures off in the text of the fit and of the tooltip', () => {
    expect(declarations(ruleBody('.badge[data-fits]'))).toEqual([['font-variant-ligatures', 'none']]);
    expect(position('.badge[data-fits]')).toBeGreaterThan(position('.badge, .chip'));
    const tooltip = declarations(ruleBody(TIP)).map(([name]) => name);
    expect(declared(TIP, 'font-variant-ligatures')).toBe('none');
    expect(tooltip.indexOf('font-variant-ligatures')).toBeGreaterThan(tooltip.indexOf('font'));
  });

  it('keeps the pin dot the one round shape, with the thin ring of the map\'s own markers', () => {
    expectDeclared([
      ['.pin-dot', 'display', 'inline-block'], ['.pin-dot', 'width', '10px'], ['.pin-dot', 'height', '10px'], ['.pin-dot', 'border-radius', '50%'],
      ['.pin-dot', 'margin-right', '6px'], ['.pin-dot', 'vertical-align', 'middle'], ['.pin-dot', 'box-shadow', '0 0 0 1px rgb(0 0 0 / 0.7)'],
    ]);
    for (const block of blocks.filter((b) => MAP_RULE.test(b.prelude) && !b.prelude.includes('.pin-dot'))) {
      expect(declared(block.prelude, 'border-radius') ?? '0', block.prelude).toBe('0');
    }
  });

  it('draws the toolbar as buttons and a readout of fixed height, so a late font cannot resize the box under it', () => {
    expectDeclared([
      ['.map-toolbar > button', 'min-height', '32px'], ['.map-zoom', 'min-width', '32px'], ['.map-zoom', 'padding', '0'],
      ['.map-y', 'display', 'inline-flex'], ['.map-y', 'min-width', '6em'], ['.map-y', 'min-height', '32px'], ['.map-y', 'background', 'var(--screen)'],
      ['.map-y', 'color', 'var(--screen-text)'], ['.map-y', 'font', '13px/1 var(--font-pixel)'], ['.map-y', 'box-shadow', 'var(--bevel-well)'],
    ]);
    // the readout reads "surface" or "Y ≤ n" as the slider moves: the same width for both
    expect(declared('.map-y', 'justify-content')).toBe('center');
  });

  it('gives the canvas and the note dialog nothing to move: no transform, filter, containment or animation round them', () => {
    // a transform, a filter, a containment or a will-change on an ancestor makes it the containing block of the dialog's fixed backdrop,
    // and an animated transform shifts the box the end-to-end tests read the canvas's centre from
    const traps = /^(transform|translate|scale|rotate|filter|backdrop-filter|perspective|will-change|contain|container-type|animation|clip-path|mask)/;
    const ancestors = blocks.filter((b) => b.prelude.split(', ').some((selector) => MAP_ANCESTORS.includes(selector)));
    expect(ancestors.length, 'the rules of the canvas\'s ancestors').toBeGreaterThanOrEqual(MAP_ANCESTORS.length);
    for (const block of ancestors) {
      for (const [name] of declarations(block.inner)) expect(name, block.prelude).not.toMatch(traps);
    }
    // nothing in the tab animates but the tooltip, which rises on its own (opacity and a few pixels) and holds nothing
    for (const block of blocks.filter((b) => MAP_RULE.test(b.prelude) && b.prelude !== TIP)) expect(block.inner, block.prelude).not.toContain('animation');
  });

  it('reads no alias of the old palette in the rules of the tab', () => {
    const rules = blocks.filter((b) => MAP_RULE.test(b.prelude));
    // the scan sees the tab's rules, so a rule it cannot parse would not pass unnoticed
    expect(rules.length).toBeGreaterThan(40);
    for (const block of rules) expect(block.inner, block.prelude).not.toMatch(OLD_ALIASES);
  });
});
