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
