// The Machine GUI stylesheet contract (restyle plan Phase 1 Task 1, design spec §3–§5 and §7a): the tokens, the light and
// the dark look (Phase 2 spec §4), the motion foundation, the font imports and the first rules every later rule builds on.
// The client project runs in node, so the stylesheet is read as text and cut into blocks by the scanner of css-blocks.ts,
// which the contrast test shares. Later tasks add cases here and reuse `css`, `rootTokens` and `ruleBody`.

import { readdirSync, readFileSync } from 'node:fs';
import { describe, it, expect } from 'vitest';
import { cssBlocks, declarations, scan, themeTokens, type Block } from './css-blocks.ts';

const read = (file: string): string => readFileSync(new URL(`../../src/client/${file}`, import.meta.url), 'utf8');

/** The stylesheet text. */
const css = read('styles.css');

const blocks = cssBlocks(css);

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

/**
 * Every declaration of the `:root` blocks that apply always, later ones replacing earlier ones as in the cascade: the light
 * look's tokens (css-blocks.ts). A `:root` inside an `@media` (the reduced-motion override of the `--dur-*` tokens) is
 * conditional, so it is left out: otherwise it would hide the values the tokens really have.
 */
const rootTokens = (): Map<string, string> => themeTokens(blocks, 'light');

// The `:root` block (the values of design spec §4), row for row. The old names it once kept as aliases for the inline styles
// are gone (Task 9), and a case at the end of this file says so.
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
  // Phase 2 Task 2b (Phase 2 spec §25, plan ruling digits-token): the figures' face, then a fallback whose digits are distinct
  ['--font-digits', 'VT323, ui-monospace, Menlo, Consolas, monospace'],
  ['--font-diagram', "system-ui, -apple-system, 'Segoe UI', Roboto, sans-serif"],
  ['--ink', '#dddddd'], ['--ink-muted', '#aaaaaa'], ['--ink-title', '#ffffff'], ['--ink-link', '#ffff55'],
  ['--ink-error', '#ff5555'], ['--ink-ok', '#55ff55'], ['--ink-warn', '#ffaa00'],
  // Phase 2 Task 1a (Phase 2 spec §4.3): a token for every colour a look can change, at the light value the rule wrote before; the
  // Flow and Connections ones are the Flow `:root`'s
  ['--bar-line', '#3c3c3c'], ['--grid', '#404040'], ['--btn-off', '#4a4a4a'], ['--btn-off-ink', '#a0a0a0'],
  ['--tab-face', '#8b8b8b'], ['--tab-face-hi', '#a8a8a8'], ['--tab-ink', '#1b1b1b'], ['--tab-face-hover', '#9a9a9a'],
  ['--rule', '#8b8b8b'], ['--veil', 'rgb(255 255 255 / 0.35)'], ['--press', 'rgb(0 0 0 / 0.15)'],
  ['--field-edge', '#a0a0a0'], ['--bevel-tick', 'var(--bevel-slot)'],
  ['--panel-error', '#aa0000'], ['--panel-ok', '#1e5a1e'], ['--panel-warn', '#6a4000'], ['--panel-focus', '#1b1b1b'],
  ['--flow-sink-line', 'var(--flow-raw-line)'], ['--flow-group', '#cbbbe0'], ['--casing', '#1b1b1b'], ['--flow-focus', '#1b1b1b'],
  ['--flange', 'var(--slot)'], ['--dye-casing', '#c6c6c6'],
  ['--conn-box', 'var(--panel)'], ['--conn-face', '#e0e0e0'], ['--conn-face-link', '#1d3b9a'],
  ['--conn-chest', '#f0d870'], ['--conn-chest-line', '#6b5500'], ['--conn-interface', '#cbbbe0'], ['--conn-interface-line', '#5a3a8a'],
  ['--conn-source', '#d8cfa8'], ['--conn-source-line', '#6b5a20'], ['--conn-hookup', '#a8a8a8'], ['--conn-hookup-line', 'var(--outline)'],
  // Phase 2 Task 1b (Phase 2 spec §4.3): the tokens of the features to come, at their light values, so the dark look can give each its
  // own value now and the later tasks never edit the dark blocks; and the Theme button's three icons (§4.8)
  ['--screen-lo', '#555555'], ['--thumb', 'var(--btn)'], ['--flow-chip', 'var(--screen)'], ['--flow-busy-track', 'var(--screen)'],
  ['--flow-busy', '#55ff55'], ['--flow-busy-high', '#ffaa00'], ['--stack-ink', '#ffffff'], ['--stack-shadow', '#3f3f3f'],
  ['--bevel-inset', 'inset 2px 2px 0 var(--panel-lo), inset -2px -2px 0 var(--panel-hi)'],
  ['--bevel-screen', 'inset 2px 2px 0 #000000, inset -2px -2px 0 var(--screen-lo)'],
  ['--energy', '#e03c3c'], ['--progress-base', '#555555'], ['--skeleton', '#b5b5b5'], ['--skeleton-well', '#4a4a4a'],
  ['--sheen', 'rgb(255 255 255 / 0.1)'], ['--tip-mod', '#8080ff'],
  ['--icon-auto', `url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 8 8' shape-rendering='crispEdges'%3E%3Cpath fill='%23c6c6c6' d='M0 0h4v8H0z'/%3E%3Cpath fill='%232a2a2a' d='M4 0h4v8H4z'/%3E%3C/svg%3E")`],
  ['--icon-moon', `url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 8 8' shape-rendering='crispEdges'%3E%3Cpath fill='%23c8d4ff' d='M2 0h3v1H2zM1 1h2v1H1zM0 2h2v3H0zM1 5h2v1H1zM6 5h1v1H6zM2 6h4v1H2z'/%3E%3C/svg%3E")`],
  ['--icon-sun', `url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 8 8' shape-rendering='crispEdges'%3E%3Cpath fill='%23ffd84a' d='M3 0h1v7H3zM0 3h7v1H0zM2 2h3v3H2zM1 1h1v1H1zM5 1h1v1H5zM1 5h1v1H1zM5 5h1v1H5z'/%3E%3C/svg%3E")`],
  ['--gap', '12px'],
  ['color-scheme', 'dark'], ['scrollbar-color', 'var(--btn) var(--screen)'],
  ['font-family', 'var(--font-ui)'], ['line-height', '1.45'], ['color', 'var(--ink)'], ['background', 'var(--page)'],
];

/** The dark look's block (Phase 2 spec §4.2): chosen with the Theme button. */
const DARK = ":root[data-theme='dark']";
/** The OS's dark setting, which Auto follows with no JS ... */
const AUTO_DARK = '@media (prefers-color-scheme: dark)';
/** ... unless Light is chosen. */
const AUTO_ROOT = ":root:not([data-theme='light'])";

// The dark look (Phase 2 spec §4.3), row for row: the dark value of every token a look changes. The rest is the same in both looks: the
// edge, the accent, the screens' inks, the chat and tooltip colours, the tiers, the motion and the fonts, and every token built on others
// (the bevels, `--flow-chip`), which follow the values they read.
const DARK_TOKENS: [string, string][] = [
  ['--page', '#141414'], ['--page-check', '#181818'], ['--bar', '#0b0b0b'], ['--bar-line', '#2a2a2a'],
  ['--panel', '#2a2a2a'], ['--panel-hi', '#474747'], ['--panel-lo', '#0d0d0d'],
  ['--slot', '#1d1d1d'], ['--slot-hi', '#4a4a4a'], ['--slot-lo', '#070707'],
  ['--well', '#1a1a1a'], ['--grid', '#242424'], ['--screen', '#0b0b0b'], ['--screen-lo', '#2f2f2f'],
  ['--text', '#e6e6e6'], ['--text-muted', '#a8a8a8'], ['--title', '#ffffff'], ['--link', '#8fb4ff'],
  ['--ink', '#e6e6e6'], ['--ink-muted', '#a8a8a8'],
  ['--btn', '#3c3c3c'], ['--btn-hi', '#5a5a5a'], ['--btn-lo', '#1e1e1e'], ['--btn-off', '#262626'], ['--btn-off-ink', '#8a8a8a'],
  ['--tab-face', '#1f1f1f'], ['--tab-face-hi', '#2f2f2f'], ['--tab-ink', '#c8c8c8'], ['--tab-face-hover', '#2a2a2a'],
  ['--rule', '#474747'], ['--veil', 'rgb(0 0 0 / 0.3)'], ['--press', 'rgb(255 255 255 / 0.08)'],
  ['--bevel-tick', 'inset 2px 2px 0 #000000, inset -2px -2px 0 #8b8b8b'], ['--thumb', '#7a7a7a'],
  ['--panel-error', '#ff6b6b'], ['--panel-ok', '#55ff55'], ['--panel-warn', '#ffaa00'], ['--panel-focus', '#ffff55'],
  ['--flow-owned', '#22402a'], ['--flow-owned-line', '#55c06a'], ['--flow-new', '#303030'], ['--flow-raw', '#303030'],
  ['--flow-out', '#3b3313'], ['--flow-out-line', '#d9b43a'], ['--flow-import', '#34301e'], ['--flow-import-line', '#a89a5c'],
  ['--flow-missing', '#3e1e1e'], ['--flow-missing-line', '#ff5555'], ['--flow-sink', '#242424'], ['--flow-sink-line', '#6e6e6e'],
  ['--flow-line', '#2d2740'], ['--flow-line-line', '#a58bd6'], ['--flow-error', '#ff8080'], ['--flow-warn', '#ffb84d'],
  ['--flow-edge', '#050505'], ['--casing', '#050505'], ['--flow-hover', 'rgb(0 0 0 / 0.3)'], ['--flow-focus', '#ffffff'], ['--flange', '#6e6e6e'],
  ['--conn-box', '#303030'], ['--conn-face', '#3a3a3a'], ['--conn-face-link', '#8fb4ff'],
  ['--conn-chest', '#3b3313'], ['--conn-chest-line', '#d9b43a'], ['--conn-interface', '#2d2740'], ['--conn-interface-line', '#a58bd6'],
  ['--conn-source', '#34301e'], ['--conn-source-line', '#a89a5c'], ['--conn-hookup', '#242424'], ['--conn-hookup-line', '#6e6e6e'],
  ['--stack-shadow', '#000000'], ['--skeleton', '#383838'], ['--skeleton-well', '#2a2a2a'],
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
  'tip-in': ['opacity', 'transform'],                                                // ruling R27: a tooltip fades in and rises 2px
  'brand-flow': ['opacity'],                                                         // Phase 2 spec §5.3: logo C's pipe, frame by frame
  'tip-out': ['opacity', 'transform'],                                               // Phase 2 spec §6.3: the shared tooltip's 80 ms exit
  'gt-arrow': ['transform'],                                                         // Phase 2 spec §11.3: the GT progress arrow fills in eight steps
  'flash-out': ['opacity'],                                                          // Phase 2 spec §10.1: a changed strip tile's frame fades once
  sheen: ['transform'],                                                              // Phase 2 spec §11.2: a skeleton's sheen passes over its blocks
  'toast-in': ['opacity', 'transform'],                                              // Phase 2 spec §12.1: a toast pops in from 12 px below
  'toast-out': ['opacity', 'transform'],                                             // Phase 2 spec §12.1: and sinks back out as it goes
};

const FONT_IMPORTS = [
  '@fontsource/pixelify-sans/400.css', '@fontsource/pixelify-sans/600.css', '@fontsource/pixelify-sans/700.css',
  '@fontsource/inter/400.css', '@fontsource/inter/500.css', '@fontsource/inter/600.css', '@fontsource/inter/700.css',
  '@fontsource/vt323/400.css',                                                       // Phase 2 spec §25: the figures' face, one weight
];

describe('the Machine GUI stylesheet', () => {
  it('declares the Machine GUI tokens', () => {
    const tokens = rootTokens();
    for (const [name, value] of TOKENS) expect(tokens.get(name), name).toBe(value);
  });

  it('has a light and a dark look; Auto follows the OS', () => {
    // one dark list, written twice (spec §4.2): for the chosen Dark, and for Auto with the OS in dark, unless Light is chosen
    const dark = blocks.filter((b) => !b.nested && b.prelude === DARK);
    const auto = blocks.filter((b) => b.prelude === AUTO_DARK);
    expect(dark, DARK).toHaveLength(1);
    expect(auto, AUTO_DARK).toHaveLength(1);
    expect(scan(auto[0]!.inner, true, []).map((b) => b.prelude), `the rules inside ${AUTO_DARK}`).toEqual([AUTO_ROOT]);
    const list = declarations(dark[0]!.inner);
    expect(list, 'the two lists are the same, in the same order').toEqual(inQuery(AUTO_DARK, AUTO_ROOT));
    // it redefines tokens the light look has, and none of those that are the same in both looks
    const light = rootTokens();
    for (const [name] of list) {
      expect(light.has(name), `${name} is a token of the light look`).toBe(true);
      expect(name).not.toMatch(/^--(dur|ease|font|gap|tier|accent|item|fluid|chat|tip)/);
    }
    expect(list.map(([name]) => name).sort()).toEqual(DARK_TOKENS.map(([name]) => name).sort());
    const values = new Map(list);
    for (const [name, value] of DARK_TOKENS) expect(values.get(name), name).toBe(value);
    // nothing else asks for the OS's look or for the choice
    expect(blocks.filter((b) => /prefers-color-scheme|data-theme/.test(b.prelude)).map((b) => b.prelude)).toEqual([DARK, AUTO_DARK, AUTO_ROOT]);
    // both looks keep a dark page and black fields, so the browser's own popups, autofill and scroll bars stay dark (spec §4.1)
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
    // it reads tokens (Phase 2 spec §4.2), so a look redefines `:root` alone and never repeats this selector list
    for (const declaration of [
      '--ink: var(--text)', '--ink-muted: var(--text-muted)', '--ink-title: var(--title)', '--ink-link: var(--link)',
      '--ink-error: var(--panel-error)', '--ink-ok: var(--panel-ok)', '--ink-warn: var(--panel-warn)', 'color: var(--ink)',
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

/**
 * The selectors of a selector list, cut at its top-level commas only: `:where(a, summary):focus-visible` is one selector, as is
 * `[title='a, b']`.
 */
function selectorList(prelude: string): string[] {
  const out: string[] = [];
  let depth = 0;
  let quote = '';
  let start = 0;
  for (let i = 0; i < prelude.length; i++) {
    const c = prelude.charAt(i);
    if (quote !== '') {
      if (c === quote) quote = '';
    } else if (c === '"' || c === "'") quote = c;
    else if (c === '(' || c === '[') depth++;
    else if (c === ')' || c === ']') depth--;
    else if (c === ',' && depth === 0) {
      out.push(prelude.slice(start, i).trim());
      start = i + 1;
    }
  }
  out.push(prelude.slice(start).trim());
  return out;
}

/** The index of the `)` that closes the parenthesis opened just before `from`; nested parentheses and quoted text are passed over. */
function closing(text: string, from: number): number {
  let depth = 1;
  let quote = '';
  for (let i = from; i < text.length; i++) {
    const c = text.charAt(i);
    if (quote !== '') {
      if (c === quote) quote = '';
    } else if (c === '"' || c === "'") quote = c;
    else if (c === '(') depth++;
    else if (c === ')' && --depth === 0) return i;
  }
  return text.length;
}

/**
 * The selectors of a selector list (`selectorList`) and, at every depth, the selectors of each `:where(…)` and `:is(…)` argument list in them
 * (ruling R45): `:where(a, summary):focus-visible` gives itself, `a` and `summary`.
 */
function selectorsDeep(prelude: string): string[] {
  return selectorList(prelude).flatMap((selector) => {
    const found = [selector];
    const opener = /:(?:where|is)\(/gi;
    for (let at = opener.exec(selector); at !== null; at = opener.exec(selector)) {
      const end = closing(selector, opener.lastIndex);
      found.push(...selectorsDeep(selector.slice(opener.lastIndex, end)));
      opener.lastIndex = end + 1;
    }
    return found;
  });
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
/**
 * The focus ring's colour rule (ruling R12): a borderless focusable has no dark edge of its own for the yellow ring to touch, so its ring takes
 * the focus ink of its surface. Ruling R13: a summary and a tick have no dark edge either; R30: nor has a slider; R33: nor a file input. It is
 * the one rule that names `summary` inside a `:where(…)`, a ring and nothing else, so the summary guard exempts it by this name (ruling R45).
 */
const RING_RULE = ':where(a, button.link, summary, input[type=checkbox], input[type=radio], input[type=range], input[type=file]):focus-visible';
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
      [':where(button:disabled)', 'background', 'var(--btn-off)'], [':where(button:disabled)', 'color', 'var(--btn-off-ink)'],
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
      [FIELDS, 'border', '2px solid var(--field-edge)'], [FIELDS, 'border-radius', '0'], [FIELDS, 'color', '#ffffff'],
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
      [TICK, 'background', 'var(--screen)'], [TICK, 'box-shadow', 'var(--bevel-tick)'],
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
        // the button's face, through a token of its own (TOKENS: `--thumb` is `var(--btn)`), which the dark look lightens (P2-D24)
        [`:where(input[type=range])${thumb}`, 'background', 'var(--thumb)'], [`:where(input[type=range])${thumb}`, 'border', '2px solid var(--outline)'],
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
      [':where(input[type=file]:disabled)::file-selector-button', 'background', 'var(--btn-off)'],
      [':where(input[type=file]:disabled)::file-selector-button', 'color', 'var(--btn-off-ink)'],
    ]);
  });

  it('draws the summary of a settings section or a disclosure as a full-width button with a turning caret', () => {
    expectDeclared([
      [SUMMARY, 'display', 'flex'], [SUMMARY, 'list-style', 'none'], [SUMMARY, 'min-height', '36px'],
      [SUMMARY, 'border', '2px solid var(--outline)'], [SUMMARY, 'background', 'var(--btn)'], [SUMMARY, 'box-shadow', 'var(--bevel-btn)'],
      // ruling R37: a title that wraps grows the button instead of spilling over it (a line of 1.25 and 4px above and below, which
      // keeps a one-line button at its 36px: the readout of a settings section is 23.5px)
      [SUMMARY, 'color', '#ffffff'], [SUMMARY, 'font', '15px/1.25 var(--font-pixel)'], [SUMMARY, 'padding', '4px 12px'], [SUMMARY, 'cursor', 'pointer'],
      [SUMMARY.replace(/summary/g, 'summary::-webkit-details-marker'), 'display', 'none'],
      [SUMMARY.replace(/summary/g, 'summary:hover'), 'background', 'var(--btn-hover)'],
      [SUMMARY.replace(/summary/g, 'summary:active'), 'transform', 'translateY(1px)'],
      [SUMMARY.replace(/summary/g, 'summary:active'), 'box-shadow', 'var(--bevel-btn-down)'],
      [SUMMARY.replace(/summary/g, 'summary::before'), 'content', "''"],
      [SUMMARY.replace(/summary/g, 'summary::before'), 'transition', 'transform var(--dur-fast) var(--ease-out)'],
      ['details.settings-section[open] > summary::before, details.disclosure[open] > summary::before', 'transform', 'rotate(90deg)'],
    ]);
    expect(declared(SUMMARY.replace(/summary/g, 'summary::before'), 'clip-path'), 'a pixel caret').toMatch(/^polygon\(/);
    // a global `summary` rule would also hit Materials' two inline disclosures and the thousands of storage rows. A selector list is cut
    // at its top-level commas only (ruling R40, in place of R14's exemption of every `:focus-visible` rule), and the guard reads the
    // argument lists of `:where(…)` and `:is(…)` too, at any depth, where a bare `summary` once slipped past it (ruling R45). The one rule
    // that names `summary` there is the focus ring's colour rule (ruling R13), one selector that recolours a ring and dresses nothing: it
    // is exempted by its name, from the arguments only
    const named = (b: Block): string[] => (b.prelude === RING_RULE ? selectorList(b.prelude) : selectorsDeep(b.prelude));
    expect(blocks.filter((b) => named(b).some((s) => /^summary\b/.test(s))).map((b) => b.prelude)).toEqual([]);
    expect(selectorList(':where(a, button.link, summary):focus-visible, summary:hover')).toEqual([':where(a, button.link, summary):focus-visible', 'summary:hover']);
    expect(selectorsDeep(':where(a, summary):focus-visible')).toContain('summary');
    expect(selectorsDeep(':is(.x, summary)')).toContain('summary');
    // the deep reading keeps every top-level selector, so it still sees what the cut at the commas sees
    expect(selectorsDeep(':where(a, summary):focus-visible, summary:hover')).toEqual([':where(a, summary):focus-visible', 'a', 'summary', 'summary:hover']);
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
    expect(declarations(panels.inner).filter(([name]) => name === '--ink-focus').map(([, value]) => value)).toEqual(['var(--panel-focus)']);
    expect(declared(RING_RULE, 'outline-color')).toBe('var(--ink-focus)');
    // only the colour: the width and the offset stay the base ring's
    expect(declarations(ruleBody(RING_RULE)).map(([name]) => name)).toEqual(['outline-color']);
    // it has the base ring's specificity (0,1,0), so it is its place after the base ring that lets it recolour it
    expect(position(RING_RULE)).toBeGreaterThan(position(':focus-visible'));
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
/** Logo C's two overlays on the top bar's mark (Phase 2 spec §5.3): the pipe with the gaps of frame 1, then of frame 2. */
const OVERLAYS = '.brand-mark::before, .brand-mark::after';
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
      ['color', 'var(--ink)'],
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

  it('draws logo C from one token, on the top bar and above the login title', () => {
    // Phase 2 spec §5.1–§5.2: two machines joined by a pipe, a 16 x 16 pixel map in seven paths in painter's order (the outline and
    // casing, the lit faces, the shade, the orange and the green contents, the pipe and its dark gaps); the token is frame 0, the still one
    const tokens = rootTokens();
    const mark = decodeURIComponent(tokens.get('--brand-mark') ?? '');
    const PIPE = "fill='#ffd84a' d='M7 3h5v1H7zM11 4h1v6H11z'";
    const PATHS = [
      "fill='#141414' d='M1 1h6v6H1zM6 2h7v3H6zM10 5h3v4H10zM9 9h6v6H9z'",
      "fill='#d8d8d8' d='M2 2h3v1H2zM2 3h1v2H2zM10 10h3v1H10zM10 11h1v2H10z'",
      "fill='#6e6e6e' d='M5 2h1v3H5zM2 5h4v1H2zM13 10h1v3H13zM10 13h4v1H10z'",
      "fill='#ff8a1f' d='M3 3h2v2H3z'", "fill='#55ff55' d='M11 11h2v2H11z'", PIPE,
      "fill='#7a5a10' d='M9 3h1v1H9zM11 4h1v1H11zM11 7h1v1H11z'",
    ];
    for (const part of ['data:image/svg+xml', "viewBox='0 0 16 16'", "shape-rendering='crispEdges'", ...PATHS]) expect(mark, part).toContain(part);
    const at = PATHS.map((path) => mark.indexOf(path));
    expect(at, 'the seven paths in painter\'s order').toEqual([...at].sort((a, b) => a - b));
    // each overlay is the pipe alone, with the gaps of frame 1 or of frame 2, on the same 16 x 16 grid
    const FLOWS: [string, string][] = [
      ['--brand-flow-1', "fill='#7a5a10' d='M7 3h1v1H7zM10 3h1v1H10zM11 5h1v1H11zM11 8h1v1H11z'"],
      ['--brand-flow-2', "fill='#7a5a10' d='M8 3h1v1H8zM11 3h1v1H11zM11 6h1v1H11zM11 9h1v1H11z'"],
    ];
    for (const [name, gaps] of FLOWS) {
      const flow = decodeURIComponent(tokens.get(name) ?? '');
      for (const part of ['data:image/svg+xml', "viewBox='0 0 16 16'", "shape-rendering='crispEdges'", PIPE, gaps]) expect(flow, `${name}: ${part}`).toContain(part);
    }
    expectDeclared([
      ['.brand-mark', 'width', '32px'], ['.brand-mark', 'height', '32px'], ['.brand-mark', 'background', MARK],
      ['.brand-mark', 'position', 'relative'],                                          // the overlays' containing block
      ['.login::before', 'content', "''"], ['.login::before', 'width', '64px'], ['.login::before', 'height', '64px'],
      ['.login::before', 'background', MARK], ['.login::before', 'align-self', 'center'],
    ]);
  });

  it('flows the brand\'s pipe six turns and rests on the still frame', () => {
    // the mark is frame 0; `::before` shows frame 1's pipe in [220, 440) ms of each 660 ms turn and `::after` frame 2's in [440, 660), so
    // the gaps move from the orange machine to the green one, as the app's pipes run (spec §5.3). With no fill mode an overlay that has
    // run falls back to its own opacity 0, the still frame; under reduced motion the negative delays have used up its 1 ms by the first paint.
    // Seven runs, for six turns on screen: the negative delays spend each overlay's first run before the first paint (ruling P2-R12)
    expectDeclared([[OVERLAYS, 'content', "''"], [OVERLAYS, 'position', 'absolute'], [OVERLAYS, 'inset', '0'], [OVERLAYS, 'opacity', '0'],
      [OVERLAYS, 'background', 'var(--brand-flow-1) center / contain no-repeat'], [OVERLAYS, 'animation', 'brand-flow 0.66s step-end 7 -0.44s'],
      ['.brand-mark::after', 'background-image', 'var(--brand-flow-2)'], ['.brand-mark::after', 'animation-delay', '-0.22s']]);
    const [, duration, , count] = (declared(OVERLAYS, 'animation') ?? '').split(' ');
    expect(Number.parseFloat(duration ?? '') * Number(count)).toBeLessThanOrEqual(5);   // WCAG 2.2.2 and ruling R31: it stops within 5 s
    expect(declared(OVERLAYS, 'animation')).not.toMatch(/forwards|backwards|both|infinite/);
    expect(ruleBody('@keyframes brand-flow')).toBe('0% { opacity: 1; } 33.333% { opacity: 0; }');
  });

  it('shows the brand mark as the tab icon', () => {
    // the same data URI as the token, written out in index.html (spec §5.4): a bundled file would be an asset Vite names, which no
    // test could check against the token as text
    const uri = (rootTokens().get('--brand-mark') ?? '').replace(/^url\("/, '').replace(/"\)$/, '');
    const html = read('index.html');
    expect(html).toContain(`<link rel="icon" type="image/svg+xml" href="${uri}" />`); expect(html).not.toContain('href="data:,"');
  });

  it('draws the top bar as a dark strip of fixed height, with the pages as buttons and the current one yellow', () => {
    expectDeclared([
      ['.top-nav', 'display', 'flex'], ['.top-nav', 'align-items', 'center'], ['.top-nav', 'flex-wrap', 'wrap'],
      ['.top-nav', 'gap', '20px'], ['.top-nav', 'min-height', '50px'], ['.top-nav', 'padding', '6px 20px'],
      ['.top-nav', 'background', 'var(--bar)'], ['.top-nav', 'border-bottom', '2px solid #000'],
      ['.top-nav', 'box-shadow', 'inset 0 -2px 0 var(--bar-line)'],
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
      ['.project-name:hover', 'border-color', 'var(--field-edge)'],
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
      // ruling R31 (WCAG 2.2.2): three blinks and two breaths, so each stops within 5 s (the case at the end of this file)
      ['.connection::before', 'background', '#ffaa00'], ['.connection::before', 'animation', 'blink 1.6s steps(2) 3'],
      ['.connection.live::before', 'background', '#55ff55'],
      ['.connection.live::before', 'animation', 'breathe 2s ease-in-out 2'],
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
      // ruling R35: the heading of the problems is pixel, the planner's error is a sentence of the server's, so it is Inter
      ['.banner-integrity, .banner-heading.error', 'font-family', 'var(--font-pixel)'],
      ['.plan-banner > .error', 'font-family', 'var(--font-ui)'],
      ['.banner-integrity li', 'color', '#ffaaaa'], ['.banner-integrity li', 'font-family', 'var(--font-ui)'],
      ['.plan-banner .banner-heading', 'font', '600 14px/1.45 var(--font-pixel)'],
      ['.what-changed h4', 'font', '600 14px/1.45 var(--font-pixel)'], ['.what-changed h4', 'color', 'var(--ink-title)'],
      // a derived material's chip is a small button with its 16px icon
      ['button.banner-chip', 'min-height', '28px'], ['button.banner-chip', 'padding', '0 10px 0 4px'],
      ['button.banner-chip', 'font-size', '13px'], ['button.banner-chip', 'display', 'inline-flex'],
    ]);
    // the red of all three is one rule, which sets no font: each part has its own (ruling R35)
    expect(declared('.plan-banner > .error, .banner-integrity, .banner-heading.error', 'font-family')).toBeUndefined();
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
      [TAB, 'background', 'var(--tab-face)'], [TAB, 'box-shadow', 'inset 2px 2px 0 var(--tab-face-hi)'], [TAB, 'color', 'var(--tab-ink)'],
      [`${TAB}:hover:not([aria-selected='true'])`, 'background', 'var(--tab-face-hover)'],
      [SELECTED, 'background', 'var(--panel)'], [SELECTED, 'box-shadow', 'inset 2px 2px 0 var(--panel-hi)'],
      [SELECTED, 'border-bottom-color', 'var(--panel)'], [SELECTED, 'color', 'var(--text)'],
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
/** Below this the head wraps whatever the Settings button's width, so the 40% cap protects nothing (above it, the cap keeps the head to one
 *  row from about 740 px with a long name, earlier with a short one). */
const PHONE = '@media (max-width: 700px)';
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
      [`${SETTINGS_SUMMARY} > .muted`, 'font', '15px/19.5px var(--font-digits)'], [`${SETTINGS_SUMMARY} > .muted`, 'margin-left', 'auto'],
      // ruling R37: the readout keeps its size, and the title beside it wraps (drawer.spec.ts measures a title that does)
      [`${SETTINGS_SUMMARY} > .muted`, 'flex', 'none'], [`${SETTINGS_SUMMARY} > .muted`, 'white-space', 'nowrap'],
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

  it('shows what is being made in the Settings button as a small grey readout, cut with an ellipsis within 40% of the head', () => {
    // the button holds "Settings" and the target's part; the part gives way (it shrinks and is cut) so that a long name never grows the button
    expect(declaredIn(NARROW, '.settings-toggle', 'gap')).toBe('8px');
    expect(declaredIn(NARROW, '.settings-toggle', 'max-width')).toBe('40%');
    for (const [property, value] of [
      ['min-width', '0'], ['overflow', 'hidden'], ['text-overflow', 'ellipsis'], ['white-space', 'nowrap'],
      // Inter 13px in the muted ink, on the dark screen of a readout (the summary's count is one too): the muted ink measures 2.3:1 on the
      // button's own face (contrast.test.tsx), and the button's drop shadow would smear 13px letters
      ['font', '13px/1.5 var(--font-ui)'], ['color', 'var(--ink-muted)'], ['background', 'var(--screen)'], ['padding', '2px 6px'],
      ['text-shadow', 'none'],
    ] as const) expect(declaredIn(NARROW, '.settings-toggle-target', property), `.settings-toggle-target { ${property} }`).toBe(value);
    // the pixel font is never below 13px, and this part is small print: it is Inter, and no colour of its own is new
    expect(declaredIn(NARROW, '.settings-toggle-target', 'font')).not.toContain('--font-pixel');
    expect(declaredIn(NARROW, '.settings-toggle-target', 'color')).toMatch(/^var\(--/);
    expect(declaredIn(NARROW, '.settings-toggle-target', 'background')).toMatch(/^var\(--/);
    // it moves nothing by itself, and it is not drawn on a wide screen, where the whole button is not
    expect(declaredIn(NARROW, '.settings-toggle-target', 'animation')).toBeUndefined();
    expect(declaredIn(NARROW, '.settings-toggle-target', 'transition')).toBeUndefined();
    expect(hasTopLevelRule('.settings-toggle-target'), 'a .settings-toggle-target rule outside the query').toBe(false);
    // the readout makes the button some 140px wider, so the project's name gives way (to 160px) before the head wraps: while the stream is
    // live (the connection badge reads "live", 58px; "reconnecting…" is 137px and wraps the head a little earlier, as it already does at
    // narrower widths) the head is one row at 768 px, as it was with the bare button (drawer.spec.ts measures it)
    expect(declaredIn(NARROW, '.project-name', 'flex')).toBe('1 1 160px');
    expect(declaredIn(NARROW, '.project-name', 'min-width')).toBe('0');
  });

  it('lets the Settings button take the whole head on a phone, where the head wraps whatever its width', () => {
    // above 700 px the cap holds the head to one row (from about 740 px with a long name); below it the head wraps anyway, and the cap
    // only cut a short name there ("· Make: Basi…" for "Basic Circuit", an empty readout at 320 px) where the title does not show on a
    // touch screen
    expect(declaredIn(PHONE, '.settings-toggle', 'max-width')).toBe('100%');
    expect(inQuery(PHONE, '.settings-toggle'), 'a phone changes the button\'s cap and nothing else').toEqual([['max-width', '100%']]);
    // the same specificity as the 40% of the drawer's query, so the phone's rule has to come after it
    expect(position(PHONE)).toBeGreaterThan(position(NARROW));
    expect(declaredIn(NARROW, '.settings-toggle', 'max-width')).toBe('40%');
  });

  it('shows the drawer\'s Close settings button in the drawer only, at the top right of it', () => {
    // ruling R36: the drawer's way out, where the focus goes when it opens; a wide column has nothing to close
    expect(declarations(ruleBody('.settings-close'))).toEqual([['display', 'none']]);
    expect(inQuery(NARROW, '.settings-close')).toEqual([['display', 'inline-flex'], ['align-items', 'center'], ['align-self', 'flex-end']]);
  });

  it('slides the settings column in from the left, and keeps the hidden one out of the tab order', () => {
    for (const [property, value] of [
      ['position', 'fixed'], ['inset', '0 auto 0 0'], ['width', 'min(340px, 88vw)'], ['max-height', 'none'], ['overflow', 'auto'],
      ['padding', '12px'], ['background', 'var(--page)'], ['z-index', '60'],
      ['transform', 'translateX(-105%)'], ['visibility', 'hidden'],
      // ruling R36: the closed state's transition is the one it slides out with, the exit's: faster, easing in (design spec §7a)
      ['transition', 'transform var(--dur-exit) var(--ease-in), visibility 0s var(--dur-exit)'],
    ] as const) expect(declaredIn(NARROW, '.settings-panel', property), `.settings-panel { ${property} }`).toBe(value);
    expect(Number.parseFloat(rootTokens().get('--dur-exit') ?? '')).toBeLessThan(Number.parseFloat(rootTokens().get('--dur-slow') ?? ''));
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
/** Phase 2 Task 6b (spec §3.3, ruling R16): the two inline disclosures, which fold as a settings section does. */
const MAT_DISCLOSURES = 'details.mat-have, details.mat-needed';
/** The rules of that fold: one for the pair, then a rule of its own for each content box and for each open one (R28: no pseudo-element in a list). */
const MAT_FOLD_RULES = [
  MAT_DISCLOSURES, 'details.mat-have::details-content', 'details.mat-needed::details-content',
  'details.mat-have[open]::details-content', 'details.mat-needed[open]::details-content',
];
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
      ['.search-results', 'background', 'var(--screen)'], ['.search-results', 'border', '2px solid var(--field-edge)'],
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
      ['.mat-row', 'border-bottom', '1px solid var(--rule)'],
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
      // pointed at, the bare caret is pressed into the panel
      ['button.mat-toggle:hover', 'background', 'var(--press)'],
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

  it('opens and closes the Materials disclosures with an animated height', () => {
    // a Stock or Needed disclosure folds as a settings section does (ruling R16, which spec §3.3 extends to these two): `interpolate-size`
    // lets the content's block-size go between 0 and auto, its transition on content-visibility keeps it painted while it closes, and the
    // content is a block formatting context clipped on the block axis, with the section's 4 px clip margin
    expectDeclared([[MAT_DISCLOSURES, 'interpolate-size', 'allow-keywords']]);
    const fold = 'block-size var(--dur-base) var(--ease-out), content-visibility var(--dur-base) var(--ease-out) allow-discrete';
    for (const details of ['details.mat-have', 'details.mat-needed']) {
      const content = `${details}::details-content`;
      expectDeclared([
        [content, 'display', 'flow-root'], [content, 'block-size', '0'], [content, 'overflow-y', 'clip'], [content, 'overflow-clip-margin', '4px'],
        [content, 'transition', fold], [`${details}[open]::details-content`, 'block-size', 'auto'],
      ]);
      // the settings section's own transition
      expect(declared(content, 'transition'), content).toBe(declared(SECTION_CONTENT, 'transition'));
    }
    // a rule of its own for each content box, never a list: the minifier once dropped a pseudo-element's half of one (R28)
    expect(position('details.mat-have::details-content, details.mat-needed::details-content')).toBe(-1);
    expect(position('details.mat-have[open]::details-content, details.mat-needed[open]::details-content')).toBe(-1);
    // the summary stays the inline text it was: its rule is unchanged
    expect(declarations(ruleBody(INLINE_SUMMARY))).toEqual([['cursor', 'pointer'], ['list-style', 'none']]);
    // Phase 1's Task 5 minor: a row's tick and the rest of its line sit at the top of the line, so a disclosure that opens grows the row
    // downward and the tick stays level with the icon (centred, it dropped to the middle of the taller line)
    expectDeclared([['.mat-row > .tick', 'align-items', 'flex-start']]);
  });

  it('draws what unlocks a row as an amber chat box, the step numbers in VT323, and a pin as a small button', () => {
    expectDeclared([
      ['.mat-unlock', 'background', 'var(--chat)'], ['.mat-unlock', 'color', 'var(--ink-warn)'], ['.mat-unlock', 'border-radius', '0'],
      ['.step-list li::marker', 'font-family', 'var(--font-digits)'],
      // the list's own line (14px × 1.45) in px: the 1.45 it would inherit gives the 16px marker a 23.2px line, which grew every one-line
      // step row from 26.3 to 27.16px (Phase 2 spec §25, measured in the app)
      ['.step-list li::marker', 'line-height', '20.3px'],
      // the inline style the pin used to carry (StepsView's PIN_LINK_STYLE), plus the height of `button.small`, which its class is not
      ['button.pin-link', 'padding', '2px 10px'], ['button.pin-link', 'font-size', '0.85rem'], ['button.pin-link', 'min-height', '28px'],
    ]);
    // a dark box, so the light ink of its group (amber is `--ink-warn` there), and its own colour comes after the group's
    expect(inkGroup('.banner').prelude.split(', ')).toContain('.mat-unlock');
    expect(blocks.indexOf(inkGroup('.banner'))).toBeLessThan(position('.mat-unlock'));
    // VT323 at 16px is as tall as the list's 14px Pixelify (digits 8.96 against 9.00px; Phase 2 spec §25)
    expect(declared('.step-list li::marker', 'font-size')).toBe('16px');
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
/** Phase 2 Task 4 (spec §7.3): each tier's ink class, which the Flow chips (and Task 5a's recipe card) read, ULV to MAX. */
const TIER_SLUGS = ['ulv', 'lv', 'mv', 'hv', 'ev', 'iv', 'luv', 'zpm', 'uv', 'uhv', 'uev', 'uiv', 'umv', 'uxv', 'max'];
const TIER_RULES = TIER_SLUGS.map((slug) => `.tier-${slug}`);
const CHIP_TEXT = '.flow-node .flow-chip text';
/** Phase 2 Task 4 (spec §7.3): a step box's machine readout, its slot, its two chips, its power and its busy band. */
const READOUT_RULES = [
  '.flow-machine-slot', '.flow-slot-lo', '.flow-slot-hi', '.flow-chip rect', CHIP_TEXT, '.flow-node .flow-chip.tier-max text', '.flow-node .flow-node-power',
  '.flow-busy-track', '.flow-busy-fill', '.flow-busy.high .flow-busy-fill', '.flow-node .flow-busy-text',
];
/** A slot's stack count, the recipe card's and (Task 6a) the inventory grid's. */
const STACK_COUNT = '.stack-count';
/** The GT progress arrow's fill (spec §11.3), the recipe card's and (Task 8) the busy line's. */
const ARROW_FILL = '.gt-arrow-fill';
/**
 * Phase 2 Task 5a (spec §8.4, §11.3): the step panel's recipe card, its slots with their counts and chance tags, the arrow, the energy bar, the
 * readouts and the chips.
 */
const RECIPE_RULES = [
  '.recipe-card', '.recipe-head', '.recipe-caption', '.recipe-strip', '.recipe-slots', '.recipe-slot', '.recipe-slot.slot-short > .item-icon', STACK_COUNT,
  '.slot-chance', '.gt-arrow', ARROW_FILL, '.gt-arrow.on-chat', '.gt-arrow.on-chat .gt-arrow-fill', '.gt-arrow.still .gt-arrow-fill', '.recipe-power',
  '.energy-bar', '.energy-fill', '.recipe-time', '.recipe-stats', '.readout', '.readout dt', '.readout dd', '.oc-chips', '.oc-chip.oc-now', '.oc-chip.oc-note',
  '.badge.tier-chip', '.badge.tier-chip.tier-max',
];
/** The rules of this task that colour, edge or round something: none may read an alias of the old palette any more. */
const FLOW_RULES = [
  '.flow-canvas', '.flow-node-box', '.flow-node.sink > .flow-node-box', '.flow-node-head[role=\'button\']:hover > .flow-hit',
  '.flow-node-head:focus-visible > .flow-hit, .flow-row:focus-visible > .flow-hit', '.flow-node text', '.flow-node .flow-node-line',
  '.flow-node .flow-avoid-badge rect', '.flow-row:hover > .flow-hit, .flow-row.hl > .flow-hit', '.flow-row-rate', ISSUE_RED, ISSUE_AMBER,
  ISSUE_RED_RATE, '.flow-port', CASING, '.flow-edge-label', '.flow-group-box', '.flow-group-title', '.flow-line-toggle rect',
  '.flow-line-toggle text', '.flow-edge-tag rect', '.flow-edge-tag text', '.flow-issues', '.flow-infeasible', '.flow-legend', '.swatch',
  '.swatch.free', '.swatch.sink', '.flow-panel', '.flow-panel-section', '.flow-panel-title', WELLS, '.flow-panel .warnings',
  '.swap-option.unusable, .option-choice.unusable', '.port-short .port-rate, .port-warn', '.option-slot', '.option-slot-title',
  ...TIER_RULES, ...READOUT_RULES,                                                   // Phase 2 Task 4: the machine readout (spec §7.3)
  ...RECIPE_RULES,                                                                   // Phase 2 Task 5a: the step panel's recipe card (spec §8.4)
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
    // ruling R34: nothing moves in it, so its casing is all there is to see: a red that reads 3.79:1 on the well (#aa0000 read 1.54:1)
    expect(declarations(ruleBody('.flow-edge.missing .flow-edge-line'))).toEqual([['stroke', '#ff5555']]);
    // the base rule is the only one that sizes a casing or dashes it, in any state
    const casings = blocks.filter((b) => b.prelude.includes(CASING) && b.prelude !== CASING);
    for (const block of casings) expect(block.inner, block.prelude).not.toMatch(/stroke-width|dasharray/);
    // and the hover comes before the missing rule (both 0,3,0): a missing pipe stays red under the pointer
    expect(position('.flow-edge.missing .flow-edge-line')).toBeGreaterThan(position('.flow-edge:hover .flow-edge-line'));
  });

  it('heads each arrow in the colour of what it carries, yellow when lit and white on the red pipe of a missing source', () => {
    expectDeclared([
      ['.flow-arrow-head', 'fill', 'var(--item)'], ['.flow-arrow-head-fluid', 'fill', 'var(--fluid)'],
      // ruling R34 (over R20): white, which reads on the lighter red of its casing
      ['.flow-arrow-head-hl', 'fill', 'var(--accent)'], ['.flow-arrow-head-missing', 'fill', '#ffffff'],
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
      ['.flow-port', 'fill', 'var(--flange)'], ['.flow-port', 'stroke', 'var(--outline)'], ['.flow-port', 'stroke-width', '1'],
    ]);
    // lit, only the face turns yellow: the black edge stays, so the flange keeps its outline against a yellow rim
    expect(declarations(ruleBody('.flow-row.hl .flow-port'))).toEqual([['fill', 'var(--accent)']]);
  });

  it('sets the diagram on a dark well with a 32px grid, a black edge on every side and the diagram font', () => {
    expectDeclared([
      ['.flow-canvas', 'background-color', 'var(--well)'],
      ['.flow-canvas', 'background-image', 'linear-gradient(var(--grid) 1px, transparent 1px), linear-gradient(90deg, var(--grid) 1px, transparent 1px)'],
      ['.flow-canvas', 'background-size', '32px 32px'],
      ['.flow-canvas', 'border', '2px solid var(--outline)'], ['.flow-canvas', 'border-radius', '0'],
      ['.flow-canvas', 'box-shadow', 'var(--bevel-well)'],
      // flow-model's text widths (7.4 and 6.2 px per character, 6.5 for a tag) are measured for this font
      ['.flow-canvas', 'font-family', 'var(--font-diagram)'],
      ['.flow-canvas', 'cursor', 'grab'],
      // the canvas can take the focus (ledger ruling P2-R36), so a press focuses it too: no ring then, and the keyboard's accent ring drawn
      // inside it, as Connections draws its own (Task 5b fix round 1)
      ['.flow-canvas:focus', 'outline', 'none'],
      ['.flow-canvas:focus-visible', 'outline', '3px solid var(--accent)'], ['.flow-canvas:focus-visible', 'outline-offset', '-3px'],
    ]);
    // both are (0,2,0): the keyboard's ring must come after the press's none
    expect(position('.flow-canvas:focus-visible')).toBeGreaterThan(position('.flow-canvas:focus'));
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
      // a left over's dashed edge and the keyboard's ring on a box have colours of their own, which a look can lighten on its dark well
      ['.flow-node.sink > .flow-node-box', 'stroke', 'var(--flow-sink-line)'],
      ['.flow-node-head:focus-visible > .flow-hit, .flow-row:focus-visible > .flow-hit', 'stroke', 'var(--flow-focus)'],
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
      // the open line's frame and title have a colour of their own, no longer the box fill of a supporting line (Phase 2 spec §4.3)
      ['.flow-group-box', 'stroke', 'var(--flow-group)'], ['.flow-group-title', 'fill', 'var(--flow-group)'],
      ['.flow-group-box', 'fill', 'var(--flow-group)'],
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
    // a left over's swatch has the dashed edge of its box
    expectDeclared([['.swatch.sink', 'border-color', 'var(--flow-sink-line)']]);
  });

  it('slides the side panel in once as a Machine GUI panel with dark wells, fades in each new pick, and never animates the grid', () => {
    expectDeclared([
      ['.flow-panel', 'background', 'var(--panel)'], ['.flow-panel', 'border', '2px solid var(--outline)'], ['.flow-panel', 'border-radius', '0'],
      ['.flow-panel', 'box-shadow', 'var(--bevel-panel)'],
      // Phase 2 spec §8.6 (D7; the deliberate change of §3.9): the wrapper, which stays mounted, sticks and slides in once; the panel inside
      // it, keyed by its box, fades in on each pick
      ['.flow-side', 'animation', 'slide-in-right var(--dur-slow) var(--ease-out)'],
      ['.flow-side', 'position', 'sticky'], ['.flow-side', 'top', '12px'],
      ['.flow-panel', 'animation', 'fade-in var(--dur-base) var(--ease-out)'],
      ['.flow-panel-head h3', 'font', '600 16px/1.3 var(--font-pixel)'],
      [WELLS, 'background', 'var(--screen)'], [WELLS, 'box-shadow', 'var(--bevel-well)'],
      ['.flow-panel .warnings', 'color', 'var(--ink-error)'], ['.port-short .port-rate, .port-warn', 'color', 'var(--ink-error)'],
      // its sections and an option's slot are set apart by the 1px rule of the panels
      ['.flow-panel-section', 'border-top', '1px solid var(--rule)'], ['.option-slot', 'border', '1px solid var(--rule)'],
      // the panel slides in from the right: no horizontal scroll bar flashes while it does
      ['.flow', 'overflow-x', 'clip'],
      // and the focus ring of the Zoom in button, on the clipped edge, keeps its left side: Chromium applies the clip margin only
      // when both axes clip (measured in a browser for this task)
      ['.flow', 'overflow-y', 'clip'], ['.flow', 'overflow-clip-margin', '4px'],
    ]);
    expect(declared('.flow-panel', 'position'), 'the panel sticks through its wrapper only').toBeUndefined();
    // the grid column changes at once (the e2e tests read it): nothing animates or transitions the grid or the panel's width
    for (const block of blocks.filter((b) => b.prelude === '.flow' || b.prelude === '.flow.has-panel')) {
      expect(block.inner, block.prelude).not.toMatch(/transition|animation/);
    }
    expect(ruleBody('.flow-panel')).not.toMatch(/transition|(^|; )width/);
    expect(ruleBody('.flow-side')).not.toMatch(/transition|(^|; )width/);
    // a narrow screen (spec §8.6): the wrapper stops sticking and the panel takes its whole height, in the page's flow
    expect(declaredIn('@media (max-width: 1100px)', '.flow-side', 'position')).toBe('static');
    expect(declaredIn('@media (max-width: 1100px)', '.flow-panel', 'max-height')).toBe('none');
    expect(declaredIn('@media (max-width: 1100px)', '.flow-panel', 'position')).toBeUndefined();
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
      [CONN_CASING, 'stroke', 'var(--pipe-casing, var(--casing))'], [CONN_CASING, 'stroke-width', '6'], [CONN_CASING, 'stroke-linecap', 'butt'],
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
    // the marker sits on the contents (on the casing where nothing moves), and its head takes that element's stroke where the browser
    // knows `context-stroke`; ruling R32: a fallback comes first, which a browser without it (WebKit) keeps, so its heads are the items'
    // yellow and not black. Two rules, as the build's minifier keeps only the last `fill` of one (pipes.spec.ts asks the built page).
    const SUPPORTS = '@supports (fill: context-stroke)';
    expect(declarations(ruleBody('.conn-arrow-head'))).toEqual([['fill', 'var(--item)']]);
    expect(inQuery(SUPPORTS, '.conn-arrow-head')).toEqual([['fill', 'context-stroke']]);
    expect(position(SUPPORTS)).toBeGreaterThan(position('.conn-arrow-head'));
  });

  it('rims a pointed-at link in white and a picked one in yellow that blinks once, 1.5px round a casing that keeps its width', () => {
    expectDeclared([
      [CONN_RIM, 'stroke', 'none'], [CONN_RIM, 'stroke-width', '9'], [CONN_QUIET_RIM, 'stroke-width', '5'],
      [CONN_HOVER_RIM, 'stroke', '#ffffff'], [CONN_PICKED_RIM, 'stroke', 'var(--accent)'],
      // ruling R19: a pulse is the rim's, on opacity, never the contents'
      [CONN_PICKED_RIM, 'animation', 'pipe-pulse 400ms var(--ease-out)'],
      // a hand's link shows a casing only while it is rimmed, so its amber does not lie on the white or the yellow
      [CONN_HAND_LIT, 'stroke', 'var(--casing)'],
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
      ['.connections', 'background-image', 'linear-gradient(var(--grid) 1px, transparent 1px), linear-gradient(90deg, var(--grid) 1px, transparent 1px)'],
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
      [CONN_BOX, 'fill', 'var(--conn-box)'], [CONN_BOX, 'stroke', 'var(--outline)'], [CONN_BOX, 'stroke-width', '2'],
      [CONN_BOX, 'filter', 'drop-shadow(0 2px 0 #000)'], ['.conn-node > path', 'fill', 'var(--conn-face)'],
      ['.conn-chest > rect', 'fill', 'var(--conn-chest)'], ['.conn-chest > rect, .conn-chest > path', 'stroke', 'var(--conn-chest-line)'],
      ['.conn-interface > rect', 'fill', 'var(--conn-interface)'], ['.conn-interface > rect, .conn-interface > path', 'stroke', 'var(--conn-interface-line)'],
      ['.conn-source > rect', 'fill', 'var(--conn-source)'], ['.conn-source > rect, .conn-source > path', 'stroke', 'var(--conn-source-line)'],
      ['.conn-hookup > rect, .conn-sink > rect', 'fill', 'var(--conn-hookup)'], [CONN_DASHED, 'stroke-dasharray', '4 3'],
      // the dashed edge of a hookup or a left over has a colour of its own, which a look can lighten on its dark well
      [CONN_DASHED, 'stroke', 'var(--conn-hookup-line)'],
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
      ['.conn-node .conn-line', 'fill', 'var(--text-muted)'], ['.conn-node .conn-face', 'fill', 'var(--conn-face-link)'],
      ['.conn-node .conn-face-mode', 'fill', 'var(--text-muted)'], ['.conn-node .conn-face-mode', 'font-size', '10.5px'],
      // the grey of a hookup or a left over is darker than a panel: its quieter lines would fall under 4.5:1 there
      ['.conn-hookup .conn-line, .conn-sink .conn-line', 'fill', 'var(--text)'],
      ['.conn-label', 'fill', '#ffffff'], ['.conn-label', 'stroke', 'var(--casing)'], ['.conn-label', 'font-size', '11px'],
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
      ['.conn-swatch', 'height', '6px'], ['.conn-swatch', 'background-color', 'var(--casing)'],
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
      [TIP, 'color', '#aaaaaa'], [TIP, 'font', '14px/1.35 var(--font-pixel)'], [TIP, 'animation', 'tip-in 120ms var(--ease-out)'],
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
      ['.found-section + .found-section', 'border-top', '1px solid var(--rule)'], ['.found-section + .found-section', 'padding-top', '10px'],
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
      ['.map-list > li + li', 'border-top', '1px solid var(--rule)'], ['.map-list > li > details', 'padding', '4px 0'],
      // a flat row on the panel, not a button face: the muted coordinates of a note are 1.7:1 on a button's grey
      [ROW, 'width', '100%'], [ROW, 'text-align', 'left'], [ROW, 'padding', '4px 8px'], [ROW, 'background', 'transparent'], [ROW, 'border', '0'],
      [ROW, 'box-shadow', 'none'], [ROW, 'text-shadow', 'none'], [ROW, 'color', 'var(--ink)'],
      // a label that wraps needs more than the button's line height of 1, and it is a sentence: Inter, at the size of the lists beside it
      [ROW, 'font', '0.85rem/1.3 var(--font-ui)'],
      [`${ROW}:hover`, 'background', 'var(--veil)'],
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

  // Pixelify Sans draws its lowercase "fi", "fl" and "ff" as ligatures that look like an A at 13 to 22px ("Does not fit" read "Does not
  // At", "minecraft:fire" read "minecraft:Are": measured in a browser), so they are off for every element, once (ruling R24). A value on
  // :root, the first form of that ruling, does not reach the text: the `font` shorthand of every rule that sets the pixel font resets
  // font-feature-settings on its own element, and ligatures.spec.ts saw `normal` on the head's name field with it. So it is a rule for
  // every element, and !important to win over those shorthands. Only liga and clig: Inter's contextual alternates stay on. `*` does not
  // match a pseudo-element, so the file pickers' button has the same declaration in a rule of its own (Task 9; one list would be one rule,
  // but the build's minifier loses a list's second selector here: ligatures.spec.ts asks the built page).
  it('keeps the pixel font\'s fi, fl and ff ligatures off for every element, once, and not only on the root', () => {
    const rules = blocks.filter((b) => b.inner.includes('font-feature-settings'));
    expect(rules.map((b) => b.prelude)).toEqual(['*', '::file-selector-button']);
    for (const rule of rules) {
      expect(declarations(rule.inner), rule.prelude).toEqual([['font-feature-settings', '"liga" 0, "clig" 0 !important']]);
      expect(rule.nested, rule.prelude).toBe(false);
    }
    // nowhere else, in another property or on a rule of the pixel font's users (they would be the second place to forget)
    expect(blocks.filter((b) => b.inner.includes('font-variant-ligatures')).map((b) => b.prelude)).toEqual([]);
    expect(rootTokens().has('font-feature-settings'), 'the root: inherited text reaches it, text set with `font` does not').toBe(false);
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
      ['.map-y', 'color', 'var(--screen-text)'], ['.map-y', 'font', '15px/1 var(--font-digits)'], ['.map-y', 'box-shadow', 'var(--bevel-well)'],
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

// The 3D tab, the World page and the projector panel, and the old palette's end (restyle plan Phase 1 Task 9, design spec §6, §7a and
// §8). The inline styles of View3D's chrome, WorldPage, SmartUploadPanel and ProjectorPanel are classes now, with the values they had
// where those were layout, and the Machine GUI where they were colour, edges and fonts. What stays inline is what a test or the drawing
// reads: the canvas's cursor, the legend swatch's colour (the colour of its link in the scene), and the projector hint's top margin.
// view3d.test.tsx, world-page.test.tsx, world-smart.test.tsx and projector-panel.test.tsx pin the classes in the markup, and
// view3d-links.spec.ts, layout.spec.ts, world.spec.ts and projector.spec.ts what must keep working in a browser.

const SCREEN_FILES = ['views/View3D.tsx', 'views/WorldPage.tsx', 'views/SmartUploadPanel.tsx', 'views/ProjectorPanel.tsx'];
const STYLE_CONSTANTS = /\b(MAIN_STYLE|VIEWPORT_STYLE|HOVER_STYLE|SIDE_STYLE|BOX_STYLE|HEADING_STYLE|SUBHEAD_STYLE|LIST_STYLE|SWATCH_STYLE|PANEL_STYLE|BODY_STYLE|COMMAND_STYLE)\b/;
const VIEWPORT = '.view3d-viewport';
const SCENE = '.view3d-scene';
const HOVER = '.view3d-hover';
const TOGGLE = '.view3d-controls > .check:has(> input[type=checkbox])';
const LAYER_GROUP = '.view3d-controls > .check:has(> input[type=range])';
const BOX = '.view3d-box';
const WARNINGS = '.view3d-warnings';
const SCAN_CHIP = '.scan-row-head > strong';
const COMMAND = '.command-text';
const MONOSPACE = 'ui-monospace, Menlo, Consolas, monospace';
/** The selectors of this task: the class it styles is one of its own. */
const SCREEN_RULE = /\.(view3d(-[a-z]+)*|world-(page|section|pickers)|scan-(row(-head)?|notes|list)|backup-list|upload-status|disclosure-body|smart-(upload|areas|radius|total)|projector-(panel|body|commands|form)|command-(row|text))(?![\w-])/;
/** The old palette's names, as the stylesheet or an inline style would read them (`--ink-error` and `--accent` are not `--error` and `--accent-text`). */
const OLD_NAMES = ['bg', 'surface', 'surface-2', 'border', 'radius', 'muted', 'ok', 'error', 'error-bg', 'warn-bg', 'warn-border', 'accent-text'];
const OLD_READ = new RegExp(`var\\(--(${OLD_NAMES.join('|')})(?![\\w-])`);

/** Every `.ts`, `.tsx` and `.css` file under src/client, by its path from there, with its text. */
function clientSources(): [string, string][] {
  const out: [string, string][] = [];
  const walk = (dir: string): void => {
    for (const entry of readdirSync(new URL(`../../src/client/${dir}`, import.meta.url), { withFileTypes: true })) {
      if (entry.isDirectory()) walk(`${dir}${entry.name}/`);
      else if (/\.(tsx?|css)$/.test(entry.name)) out.push([`${dir}${entry.name}`, read(`${dir}${entry.name}`)]);
    }
  };
  walk('');
  return out;
}

/** The text of `source` without its comments, which may still say what the old names were. */
const withoutComments = (source: string): string => source.replace(/\/\*[\s\S]*?\*\//g, '');

describe('the Machine GUI 3D tab', () => {
  it('has moved the inline styles of the four files to classes, and left the old palette', () => {
    const inline: Record<string, number> = {};
    for (const file of SCREEN_FILES) {
      const source = read(file);
      for (const name of ['var(--surface', 'var(--border', 'var(--radius']) expect(source.includes(name), `${file} reads ${name}`).toBe(false);
      expect(source, file).not.toMatch(STYLE_CONSTANTS);
      expect(source.includes('borderRadius'), `${file} rounds a corner`).toBe(false);
      inline[file] = (source.match(/\bstyle=\{/g) ?? []).length;
    }
    // what stays inline: the canvas's cursor (written from code) and the legend swatch's colour; the projector's one margin, which a test pins
    expect(inline).toEqual({ 'views/View3D.tsx': 2, 'views/WorldPage.tsx': 0, 'views/SmartUploadPanel.tsx': 0, 'views/ProjectorPanel.tsx': 1 });
    expect(read('views/View3D.tsx')).toContain("style={{ cursor: hover === null ? 'grab' : 'pointer' }}");
    expect(read('views/View3D.tsx')).toContain('className="view3d-scene"');
    expect(read('views/View3D.tsx')).toContain('style={{ background: `rgb(${rgb[0]}, ${rgb[1]}, ${rgb[2]})` }}');
    expect(read('views/ProjectorPanel.tsx')).toContain('const HINT_STYLE: CSSProperties = { marginTop: 4 };');
  });

  it('lays the tab out as its inline styles did: a column, its main column beside the side column, wrapping on a narrow screen', () => {
    expectDeclared([
      ['.view3d', 'display', 'flex'], ['.view3d', 'flex-direction', 'column'], ['.view3d', 'gap', '10px'], ['.view3d > p', 'margin', '0'],
      ['.view3d-body', 'display', 'flex'], ['.view3d-body', 'flex-wrap', 'wrap'], ['.view3d-body', 'gap', '12px'],
      ['.view3d-body', 'align-items', 'flex-start'],
      ['.view3d-main', 'flex', '3 1 420px'], ['.view3d-main', 'min-width', '0'], ['.view3d-main', 'display', 'flex'],
      ['.view3d-main', 'flex-direction', 'column'], ['.view3d-main', 'gap', '8px'], ['.view3d-main > p', 'margin', '0'],
      // the side column keeps its width when the details box appears in it, so the viewport beside it is not resized
      ['.view3d-side', 'flex', '1 1 260px'], ['.view3d-side', 'max-width', '400px'], ['.view3d-side', 'display', 'flex'],
      ['.view3d-side', 'flex-direction', 'column'], ['.view3d-side', 'gap', '12px'],
    ]);
  });

  it('frames the scene in a well with a pale sky behind it, and gives the canvas no edge of its own', () => {
    expectDeclared([
      [VIEWPORT, 'position', 'relative'], [VIEWPORT, 'overflow', 'hidden'], [VIEWPORT, 'height', 'min(64vh, 680px)'], [VIEWPORT, 'min-height', '360px'],
      // the dark cables of a line would vanish on a dark well, and the WebGL clear is transparent: a light sky behind it
      [VIEWPORT, 'background', 'linear-gradient(#cfe3f2, #a9c4d9)'],
      // the frame is the box's border, the inverted bevel of a slot (dark above and left) inside a black outline: as the map's
      [VIEWPORT, 'border', '2px solid'], [VIEWPORT, 'border-color', 'var(--slot-lo) var(--slot-hi) var(--slot-hi) var(--slot-lo)'],
      [VIEWPORT, 'outline', '2px solid var(--outline)'],
      [SCENE, 'display', 'block'], [SCENE, 'width', '100%'], [SCENE, 'height', '100%'],
    ]);
    // the renderer picks with the canvas's own rect and the end-to-end tests map pixels with it: no border, padding or margin on it, and
    // nothing laid over it that could take the pointer (the hover label is the one thing over it, and takes no pointer events). The canvas
    // has a class of its own: the Map tab's guard allows no rule for the `canvas` element in the stylesheet.
    expect(declarations(ruleBody(SCENE)).map(([name]) => name).sort()).toEqual(['display', 'height', 'width']);
    expect(blocks.filter((b) => /\.view3d(-[a-z]+)*[^,{]*::?(before|after)/.test(b.prelude)).map((b) => b.prelude), 'a pseudo-element in the 3D tab').toEqual([]);
    expect(css.includes('.view3d-canvas'), 'a class that the markup test of a view without WebGL would trip on').toBe(false);
  });

  it('draws the hover label as an NEI tooltip that fades in, rises 2px, and never takes the pointer', () => {
    expect(ruleBody(HOVER)).toContain('background: var(--tip-bg)');
    expect(ruleBody(HOVER)).toContain('pointer-events: none');
    expectDeclared([
      [HOVER, 'position', 'absolute'], [HOVER, 'top', '8px'], [HOVER, 'left', '8px'], [HOVER, 'right', '8px'], [HOVER, 'margin', '0'],
      [HOVER, 'width', 'fit-content'], [HOVER, 'max-width', 'calc(100% - 16px)'], [HOVER, 'padding', '6px 8px'], [HOVER, 'overflow-wrap', 'anywhere'],
      [HOVER, 'border', '2px solid var(--tip-border)'], [HOVER, 'box-shadow', '0 0 0 1px #100010, inset 0 0 0 1px var(--tip-inner)'],
      [HOVER, 'color', '#ffffff'], [HOVER, 'font', '14px/1.35 var(--font-pixel)'], [HOVER, 'animation', 'tip-in 120ms var(--ease-out)'],
    ]);
    expect(declared(HOVER, 'border-radius') ?? '0').toBe('0');
    // ruling R27: both tooltips of the client rise with the one keyframes, `from` 2px down
    expect(ruleBody('@keyframes tip-in')).toMatch(/^from \{ opacity: 0; transform: translateY\(2px\);? \}$/);
    expect(declared(TIP, 'animation')).toBe('tip-in 120ms var(--ease-out)');
  });

  it('turns the toggles into buttons that read yellow while they are on, and the layer slider into a slider and a readout', () => {
    expectDeclared([
      ['.view3d-controls', 'gap', '8px'],
      [TOGGLE, 'align-items', 'center'], [TOGGLE, 'min-height', '32px'], [TOGGLE, 'padding', '0 12px'], [TOGGLE, 'background', 'var(--btn)'],
      [TOGGLE, 'border', '2px solid var(--outline)'], [TOGGLE, 'box-shadow', 'var(--bevel-btn)'], [TOGGLE, 'color', '#ffffff'],
      [TOGGLE, 'font', '15px/1 var(--font-pixel)'], [TOGGLE, 'text-shadow', '2px 2px 0 #3f3f3f'],
      [`${TOGGLE}:hover`, 'background', 'var(--btn-hover)'],
      [`${TOGGLE}:active`, 'transform', 'translateY(1px)'], [`${TOGGLE}:active`, 'box-shadow', 'var(--bevel-btn-down)'],
      ['.view3d-controls > .check:has(> input:checked)', 'color', 'var(--accent)'],
      ['.view3d-controls > .check:has(> input:checked)', 'text-shadow', '2px 2px 0 #3f3f15'],
      // the tick is centred on the line of the button (the 2px that line a tick up with a label that wraps are for a label that wraps)
      ['.view3d-controls > .check > input[type=checkbox]', 'margin-top', '0'],
      // the ring is the toggle's: yellow where it touches the toggle's black edge, and the tick inside it draws none of its own
      ['.view3d-controls > .check:has(> input[type=checkbox]:focus-visible)', 'outline', '3px solid var(--accent)'],
      ['.view3d-controls > .check > input[type=checkbox]:focus-visible', 'outline', 'none'],
      [LAYER_GROUP, 'align-items', 'center'],
      ['.view3d-layer-text', 'display', 'inline-flex'], ['.view3d-layer-text', 'justify-content', 'center'], ['.view3d-layer-text', 'min-height', '28px'],
      ['.view3d-layer-text', 'padding', '0 8px'], ['.view3d-layer-text', 'background', 'var(--screen)'], ['.view3d-layer-text', 'box-shadow', 'var(--bevel-well)'],
      ['.view3d-layer-text', 'color', 'var(--screen-text)'], ['.view3d-layer-text', 'font', '15px/1 var(--font-digits)'],
      ['.view3d-layer-text', 'font-variant-numeric', 'tabular-nums'],
    ]);
    // "All layers" and "Layers 1–12 of 12" are the same readout: it does not narrow, so the toggles beside it stay where they are
    expect(Number.parseFloat(declared('.view3d-layer-text', 'min-width') ?? '0')).toBeGreaterThanOrEqual(9);
    expect(declared('.view3d-layer-text', 'min-width')).toMatch(/em$/);
    // `font` resets the numbers' variant, so the variant comes after it; the checked look comes after the base it recolours
    expect(declarations(ruleBody('.view3d-layer-text')).findIndex(([name]) => name === 'font-variant-numeric'))
      .toBeGreaterThan(declarations(ruleBody('.view3d-layer-text')).findIndex(([name]) => name === 'font'));
    expect(position('.view3d-controls > .check:has(> input:checked)')).toBeGreaterThan(position(TOGGLE));
    expect(position(`${TOGGLE}:hover`)).toBeGreaterThan(position(TOGGLE));
  });

  it('puts the side column in panels, the warnings in a chat box and the details box sliding in', () => {
    expectDeclared([
      [BOX, 'display', 'flex'], [BOX, 'flex-direction', 'column'], [BOX, 'gap', '4px'], [BOX, 'padding', '12px 14px'],
      [BOX, 'background', 'var(--panel)'], [BOX, 'border', '2px solid var(--outline)'], [BOX, 'border-radius', '0'], [BOX, 'box-shadow', 'var(--bevel-panel)'],
      ['.view3d-box > h3', 'margin', '0'], ['.view3d-box > h3', 'font', '600 16px/1.3 var(--font-pixel)'],
      // the micro heading stays Inter and quiet, as in the settings and on the map's line panel
      ['.view3d-box > h4', 'font-size', '0.75rem'], ['.view3d-box > h4', 'text-transform', 'uppercase'], ['.view3d-box > h4', 'color', 'var(--ink-muted)'],
      ['.view3d-box > h4', 'margin', '6px 0 0'],
      ['.view3d-box > ul', 'margin', '0'], ['.view3d-box > ul', 'padding-left', '18px'], ['.view3d-box > .view3d-size', 'margin', '4px 0 0'],
      // what the scene's warnings say is a chat box in amber, like the flow's issues
      [WARNINGS, 'background', 'var(--chat)'], [WARNINGS, 'box-shadow', 'none'], [`${WARNINGS} > ul`, 'color', 'var(--ink-warn)'],
      ['.view3d-details', 'animation', 'slide-in-right var(--dur-slow) var(--ease-out)'],
      ['.view3d-legend', 'margin', '0'], ['.view3d-legend', 'padding', '0'], ['.view3d-legend', 'list-style', 'none'], ['.view3d-legend', 'display', 'flex'],
      ['.view3d-legend', 'flex-wrap', 'wrap'], ['.view3d-legend', 'gap', '2px 12px'],
      // the swatch's colour is its inline style: this is the frame round it
      ['.view3d-legend > li > span', 'display', 'inline-block'], ['.view3d-legend > li > span', 'width', '12px'], ['.view3d-legend > li > span', 'height', '12px'],
      ['.view3d-legend > li > span', 'margin-right', '4px'], ['.view3d-legend > li > span', 'vertical-align', 'middle'],
      ['.view3d-legend > li > span', 'box-shadow', '0 0 0 1px #000000'],
    ]);
    // the panels are in the ink of a panel (their text, links and muted text), and the chat box is in the light ink of a dark box, which
    // comes after the panel group so that it wins on the element that is both a panel and a chat box
    expect(inkGroup(BOX)).toBe(inkGroup('.tab-panel'));
    expect(inkGroup(WARNINGS)).toBe(inkGroup('.banner'));
    expect(inkGroup('.banner').prelude.split(', ')).not.toContain(BOX);
    expect(blocks.indexOf(inkGroup(WARNINGS))).toBeGreaterThan(blocks.indexOf(inkGroup(BOX)));
    expect(position(WARNINGS)).toBeGreaterThan(position(BOX));
  });

  it('never moves, resizes or covers what the scene is drawn in', () => {
    // a size change of the canvas makes the renderer resize its viewer, and a transform or an animation on an ancestor could shift the
    // canvas under the pointer the end-to-end tests hover and click: the canvas's ancestors do not animate at all
    for (const selector of ['.view3d', '.view3d-body', '.view3d-main', VIEWPORT, SCENE, '.view3d-side']) {
      for (const [name] of declarations(ruleBody(selector))) expect(name, selector).not.toMatch(/^(animation|transition|transform|translate|scale|rotate|filter|will-change|contain|clip-path)/);
    }
    // what slides in does so beside the canvas, in the side column: on opacity and transform only
    expect(declared('.view3d-details', 'animation')).toMatch(/^slide-in-right /);
    expect(declared(HOVER, 'animation')).toMatch(/^tip-in /);
    // nothing else of the tab animates
    for (const block of blocks.filter((b) => SCREEN_RULE.test(b.prelude) && /\.view3d/.test(b.prelude))) {
      if (!['.view3d-details', HOVER].includes(block.prelude)) expect(declarations(block.inner).map(([name]) => name), block.prelude).not.toContain('animation');
    }
  });
});

describe('the Machine GUI World page', () => {
  it('lays the page out as a column on the stone, with a gold title and a quiet footer', () => {
    expectDeclared([
      ['.world-page', 'display', 'flex'], ['.world-page', 'flex-direction', 'column'], ['.world-page', 'gap', '16px'],
      ['.world-page > h1', 'margin', '0'], ['.world-page > h1', 'color', '#ffd84a'], ['.world-page > h1', 'text-shadow', '2px 2px 0 #3f3300'],
      ['.world-page > footer', 'color', 'var(--ink-muted)'],
    ]);
    // the title is the global pixel h1 (this rule only recolours it and takes its margin away), and the footer is the `.muted` line it was
    expect(declared('.world-page > h1', 'font')).toBeUndefined();
    expect(declared('.world-page > h1', 'font-size')).toBeUndefined();
  });

  it('puts each section in a panel, with a pixel title and no stray margins', () => {
    expectDeclared([
      ['.world-section', 'display', 'flex'], ['.world-section', 'flex-direction', 'column'], ['.world-section', 'gap', '10px'],
      ['.world-section > h2', 'margin', '0'], ['.world-section > h2', 'font', '600 16px/1.3 var(--font-pixel)'],
      ['.world-section > p', 'margin', '0'],
      ['.world-section > .row', 'gap', '12px'],
      ['.world-section > .world-pickers', 'gap', '24px'], ['.world-section > .world-pickers', 'align-items', 'flex-end'],
      ['.backup-list', 'list-style', 'none'], ['.backup-list', 'margin', '0'], ['.backup-list', 'padding', '0'], ['.backup-list', 'display', 'flex'],
      ['.backup-list', 'flex-direction', 'column'], ['.backup-list', 'gap', '4px'], ['.backup-list > li', 'gap', '12px'],
    ]);
    // the pickers' wider gap comes after the sections' row gap (the same specificity), and the backup rows' gap out-ranks `.row`'s
    expect(position('.world-section > .world-pickers')).toBeGreaterThan(position('.world-section > .row'));
  });

  it('sets each scan in an inset frame, with its state as a screen chip coloured by the state', () => {
    expectDeclared([
      ['.scan-list', 'margin', '0'],
      // a row is not a panel inside a panel: an inset frame (the panel's bevel inverted) round the same grey
      ['.scan-row', 'display', 'flex'], ['.scan-row', 'flex-direction', 'column'], ['.scan-row', 'gap', '6px'], ['.scan-row', 'padding', '8px 10px'],
      ['.scan-row', 'border', '2px solid'], ['.scan-row', 'border-color', 'var(--panel-lo) var(--panel-hi) var(--panel-hi) var(--panel-lo)'],
      ['.scan-row-head', 'gap', '12px'], ['.scan-row-head > button', 'margin-left', 'auto'],
      [SCAN_CHIP, 'padding', '0 6px'], [SCAN_CHIP, 'background', 'var(--screen)'], [SCAN_CHIP, 'color', 'var(--screen-muted)'],
      [SCAN_CHIP, 'font', '13px/1.5 var(--font-pixel)'],
      [".scan-row[data-state='running'] .scan-row-head > strong", 'color', '#ffaa00'],
      [".scan-row[data-state='done'] .scan-row-head > strong", 'color', 'var(--screen-text)'],
      [".scan-row[data-state='failed'] .scan-row-head > strong", 'color', '#ff5555'],
      ['.scan-notes > ul', 'margin', '2px 0 0'], ['.scan-notes > ul', 'padding-left', '18px'],
    ]);
    // `.cards` has a bottom margin of 20px, and `.row` a gap of 8px: both are overridden by coming after them
    expect(position('.scan-list')).toBeGreaterThan(position('.cards'));
    expect(position('.scan-row-head')).toBeGreaterThan(position('.row'));
  });

  it('fills a failed scan\'s progress bar in red, in both engines, and every other one in the base\'s green', () => {
    for (const fill of ['::-webkit-progress-value', '::-moz-progress-bar']) {
      expect(declared(`.scan-row[data-state='failed'] progress${fill}`, 'background')).toBe('#e03c3c');
    }
    // a browser drops a whole selector list when one selector in it has a pseudo-element it does not know: one rule per engine
    expect(blocks.filter((b) => b.prelude.includes('progress') && b.prelude.includes('-webkit-') && b.prelude.includes('-moz-')).map((b) => b.prelude)).toEqual([]);
    // the bar takes the row's width from the base (`width: 100%`), which the inline style used to say
    expect(declared(':where(progress)', 'width')).toBe('100%');
  });

  it('opens the whole-dimensions disclosure into a column, and shows an upload in a column of its own', () => {
    expectDeclared([
      ['.disclosure-body', 'display', 'flex'], ['.disclosure-body', 'flex-direction', 'column'], ['.disclosure-body', 'gap', '8px'],
      ['.disclosure-body', 'margin-top', '8px'], ['.disclosure-body > p', 'margin', '0'],
      ['.upload-status', 'display', 'flex'], ['.upload-status', 'flex-direction', 'column'], ['.upload-status', 'gap', '6px'],
      ['.upload-status > p', 'margin', '0'],
    ]);
  });

  it('draws the smart upload as a titled column, with its total as a screen readout', () => {
    expectDeclared([
      ['.smart-upload', 'display', 'flex'], ['.smart-upload', 'flex-direction', 'column'], ['.smart-upload', 'gap', '8px'],
      ['.smart-upload > h3', 'margin', '0'], ['.smart-upload > h3', 'font', '600 14px/1.3 var(--font-pixel)'], ['.smart-upload > p', 'margin', '0'],
      ['.smart-areas', 'margin', '0'], ['.smart-areas', 'padding-left', '20px'], ['.smart-radius', 'gap', '12px'],
      ['.smart-total', 'align-self', 'flex-start'], ['.smart-total', 'padding', '4px 8px'], ['.smart-total', 'background', 'var(--screen)'],
      ['.smart-total', 'box-shadow', 'var(--bevel-well)'], ['.smart-total', 'color', 'var(--screen-text)'],
      // the line 14px/1.3 gave, as Chromium lays it out (it floors that to 1/64 px and would round 18.2px up): nothing below moves (P2-R13)
      ['.smart-total', 'font', '16px/18.1875px var(--font-digits)'],
    ]);
    expect(position('.smart-radius')).toBeGreaterThan(position('.row'));
  });

  it('keeps the file pickers\' button in the pixel font without ligatures, as the rest of the pixel font', () => {
    // the button is a pseudo-element of the input, which `*` does not match: it has the universal rule's declaration in a rule of its own,
    // and not in a list with `*` (Lightning CSS, with Vite's targets, merges the list's `*` half into the rule above and drops the rest)
    expect(declared('::file-selector-button', 'font-feature-settings')).toBe('"liga" 0, "clig" 0 !important');
    expect(position('::file-selector-button')).toBeGreaterThan(position('*'));
    expect(blocks.filter((b) => b.prelude.split(',').length > 1 && b.prelude.includes('::file-selector-button') && b.inner.includes('font-feature-settings'))).toEqual([]);
    expect(declared(':where(input[type=file])::file-selector-button', 'font')).toBe('13px/1 var(--font-pixel)');
  });
});

describe('the Machine GUI projector panel', () => {
  it('is a settings panel the column spaces as every other, and its body a column', () => {
    expectDeclared([
      ['.projector-body', 'display', 'flex'], ['.projector-body', 'flex-direction', 'column'], ['.projector-body', 'gap', '10px'],
      ['.command-row', 'display', 'flex'], ['.command-row', 'gap', '8px'], ['.command-row', 'align-items', 'flex-start'],
      ['.projector-form', 'align-items', 'flex-end'], ['.projector-form > .field', 'flex', '1'], ['.projector-form > .field', 'min-width', '0'],
      ['.projector-commands', 'margin', '0'], ['.projector-commands', 'padding-left', '18px'],
    ]);
    // the panel is the settings panel of the class it carries (its summary is that class's button), with the 12px gap of the column
    // above it like every section: ruling R38 took its own 14px margin away, which the gap added to (26px)
    expect(blocks.filter((b) => b.prelude.split(', ').includes('.projector-panel')).map((b) => b.prelude)).toEqual([]);
    expect(declared('.settings-panel', 'gap')).toBe('12px');
    expect(inkGroup('.settings-section')).toBe(inkGroup('.tab-panel'));
    // `.row` aligns its items in the middle: the form's alignment comes after it
    expect(position('.projector-form')).toBeGreaterThan(position('.row'));
  });

  it('shows a command as a green monospace readout in a screen well, selected whole by a click', () => {
    expectDeclared([
      [COMMAND, 'flex', '1'], [COMMAND, 'min-width', '0'], [COMMAND, 'padding', '4px 8px'], [COMMAND, 'overflow-wrap', 'anywhere'],
      [COMMAND, 'user-select', 'all'], [COMMAND, '-webkit-user-select', 'all'],
      [COMMAND, 'background', 'var(--screen)'], [COMMAND, 'box-shadow', 'var(--bevel-well)'], [COMMAND, 'color', 'var(--screen-text)'],
      [COMMAND, 'font', `0.85rem/1.4 ${MONOSPACE}`], ['.command-text code', 'font', 'inherit'],
      ['.projector-commands code', 'background', 'var(--screen)'], ['.projector-commands code', 'color', 'var(--screen-text)'],
      ['.projector-commands code', 'padding', '1px 5px'], ['.projector-commands code', 'font-family', MONOSPACE],
    ]);
    // a token has an l, a 1 and an I: not the pixel font, which draws them alike
    for (const selector of [COMMAND, '.projector-commands code']) expect(ruleBody(selector).includes('--font-pixel'), selector).toBe(false);
  });

  it('never stops a command from being selected or copied as written: no `user-select: none`, no `text-transform` on it or on any code', () => {
    // projector.spec.ts: `String(getSelection())` must equal the code's `textContent`, and the Copy button selects that text
    const codes = blocks.filter((b) => !b.prelude.startsWith('@') && b.prelude.split(',').some((s) => /(^|[\s>+~])code(?![\w-])|\.command-(text|line|row)/.test(s)));
    expect(codes.length, 'the scan sees the rules of the commands').toBeGreaterThanOrEqual(4);
    for (const block of codes) {
      const set = new Map(declarations(block.inner));
      expect(set.get('user-select'), block.prelude).not.toBe('none');
      expect(set.get('-webkit-user-select'), block.prelude).not.toBe('none');
      expect(set.has('text-transform'), block.prelude).toBe(false);
    }
  });
});

describe('the end of the old palette', () => {
  it('has no alias of an old name on :root, and no rule, style or file that reads one', () => {
    const tokens = rootTokens();
    for (const name of OLD_NAMES) expect(tokens.has(`--${name}`), `--${name} on :root`).toBe(false);
    const sources = clientSources();
    // the walk sees the whole client, so a file it could not read would not pass unnoticed
    expect(sources.length).toBeGreaterThan(60);
    for (const [file, text] of sources) expect(OLD_READ.test(withoutComments(text)), `${file} reads a name of the old palette`).toBe(false);
    // the label above a field takes the ink of the surface it is on (the stone would have made it dark on dark)
    expect(declared('.field > span', 'color')).toBe('var(--ink-muted)');
  });

  it('has no `--muted` in any ink group either: the last reader is gone (ruling R8)', () => {
    expect(withoutComments(css)).not.toMatch(/--muted\b/);
    for (const member of ['.tab-panel', '.banner']) expect(declarations(inkGroup(member).inner).map(([name]) => name), member).not.toContain('--muted');
    // and the two groups still set every ink the generic classes read
    for (const member of ['.tab-panel', '.banner']) {
      const set = new Set(declarations(inkGroup(member).inner).map(([name]) => name));
      for (const name of ['--ink', '--ink-muted', '--ink-title', '--ink-link', '--ink-error', '--ink-ok', '--ink-warn', '--ink-focus', 'color']) expect(set.has(name), `${member}: ${name}`).toBe(true);
    }
  });

  it('rounds no corner but the pin dot\'s, in the stylesheet or in a style attribute', () => {
    const radii = blocks.filter((b) => !b.prelude.startsWith('@'))
      .flatMap((b) => declarations(b.inner).filter(([name]) => name === 'border-radius').map(([, value]): [string, string] => [b.prelude, value]));
    expect(radii.length, 'the scan sees the radii').toBeGreaterThan(30);
    for (const [selector, value] of radii) expect(value, selector).toBe(selector === '.pin-dot' ? '50%' : '0');
    for (const [file, text] of clientSources()) if (/\.tsx?$/.test(file)) expect(/borderRadius|border-radius/.test(text), `${file} sets a radius`).toBe(false);
  });

  it('reads no alias of the old palette in the rules of the 3D tab, the World page and the projector panel', () => {
    const rules = blocks.filter((b) => SCREEN_RULE.test(b.prelude));
    // the scan sees the rules of the three, so a rule it cannot parse would not pass unnoticed
    expect(rules.length).toBeGreaterThan(70);
    for (const block of rules) expect(block.inner, block.prelude).not.toMatch(OLD_ALIASES);
    for (const block of rules.filter((b) => !b.prelude.startsWith('@'))) expect(declared(block.prelude, 'border-radius') ?? '0', block.prelude).toBe('0');
  });
});

// Forced colours, a Windows contrast theme (final review I1): the browser paints every background in the theme's Canvas colour and
// drops every shadow, so a control drawn with those alone vanishes there, and with it whether it is ticked. Native controls were drawn by
// the browser in the theme's colours, so this was a regression of the restyle. One block at the end of the stylesheet repaints the custom
// controls in system colours, the one kind of colour forced colours keep. forced-colors.spec.ts asks Chromium's emulation what it computes;
// these cases pin the block.

const FORCED = '@media (forced-colors: active)';
/** The system colours of CSS Color 4: what a theme sets and a forced-colours page may still name. */
const SYSTEM_COLOUR = /^(Canvas|CanvasText|LinkText|VisitedText|ActiveText|ButtonFace|ButtonText|ButtonBorder|Field|FieldText|Highlight|HighlightText|SelectedItem|SelectedItemText|Mark|MarkText|GrayText|AccentColor|AccentColorText)$/;
const FAILED_FILLS = [".scan-row[data-state='failed'] progress::-webkit-progress-value", ".scan-row[data-state='failed'] progress::-moz-progress-bar"];
/**
 * The cues of the highlighted search hit and the picked map row. The row is a button that takes the focus, and its cue, an outline, replaced
 * the focus ring, so a focused picked row looked like any other picked row: the cue keeps off it while it shows the ring (ruling R42).
 */
const PICKED_CUES = `${ACTIVE_HIT}, ${PICKED_ROW}:not(:focus-visible)`;

/** The one forced-colours block, and the rules inside it. */
function forcedBlock(): { block: Block; rules: Block[] } {
  const found = blocks.filter((b) => b.prelude === FORCED);
  expect(found, 'one forced-colours block').toHaveLength(1);
  return { block: found[0]!, rules: scan(found[0]!.inner, true, []) };
}

describe('the Machine GUI in forced colours', () => {
  it('edges a tick and a radio, and fills their mark in the Highlight, so the box and whether it is ticked both show', () => {
    expect(inQuery(FORCED, TICK)).toEqual([['border', '1px solid ButtonText']]);
    expect(inQuery(FORCED, `${TICK}::before`)).toEqual([['background', 'Highlight']]);
    // the mark keeps its pixel shape and its state: only its paint changes, so an unticked box still shows no mark
    expect(declared(`${TICK}::before`, 'opacity')).toBe('0');
    expect(declared(`${TICK}:checked::before`, 'opacity')).toBe('1');
  });

  it('draws the carets in the text colour of what they sit on: a summary\'s button, the materials list', () => {
    expect(inQuery(FORCED, SUMMARY.replace(/summary/g, 'summary::before'))).toEqual([['background', 'ButtonText']]);
    expect(inQuery(FORCED, CARETS)).toEqual([['background', 'CanvasText']]);
  });

  it('edges a slider\'s track and fills a progress bar in the Highlight, with a rule per engine', () => {
    for (const track of ['::-webkit-slider-runnable-track', '::-moz-range-track']) {
      expect(inQuery(FORCED, `:where(input[type=range])${track}`), track).toEqual([['border', '1px solid ButtonText']]);
    }
    // a failed scan's red bar is a rule of its own, which out-ranks the base fill: it is repainted too
    for (const fill of [':where(progress)::-webkit-progress-value', ':where(progress)::-moz-progress-bar', ...FAILED_FILLS]) {
      expect(inQuery(FORCED, fill), fill).toEqual([['background', 'Highlight']]);
    }
    const { rules } = forcedBlock();
    expect(rules.filter((b) => b.prelude.includes('-webkit-') && b.prelude.includes('-moz-')).map((b) => b.prelude)).toEqual([]);
  });

  it('gives a select and a search field back the browser\'s own arrow and cross, which the theme draws', () => {
    // the pixel caret and cross are white images: a light theme's field is white
    expect(inQuery(FORCED, ':where(select)')).toEqual([['appearance', 'auto'], ['background-image', 'none']]);
    expect(inQuery(FORCED, ':where(input[type=search])::-webkit-search-cancel-button')).toEqual([['appearance', 'auto'], ['background', 'none']]);
  });

  it('marks the selected tab, the highlighted search hit and the picked map row with cues the theme keeps', () => {
    expect(inQuery(FORCED, SELECTED)).toEqual([['text-decoration', 'underline']]);
    // the picked map row's cue gives way to the focus ring, which it would replace (R42)
    expect(inQuery(FORCED, PICKED_CUES)).toEqual([['outline', '2px solid Highlight'], ['outline-offset', '-2px']]);
  });

  it('names system colours only, keeps the theme, and comes after every rule it repaints', () => {
    const { block, rules } = forcedBlock();
    expect(rules.length).toBeGreaterThanOrEqual(13);
    for (const rule of rules) {
      for (const [name, value] of declarations(rule.inner)) {
        expect(value, `${rule.prelude} { ${name} }`).not.toMatch(/#|rgb|hsl|var\(|currentColor/i);
        if (/^(background|border|outline)$/.test(name) && value !== 'none') expect(value.split(' ').pop(), `${rule.prelude} { ${name} }`).toMatch(SYSTEM_COLOUR);
      }
    }
    // the user's palette is the point: nothing opts out of it
    expect(css).not.toContain('forced-color-adjust');
    // each rule has the specificity of the rule it repaints, so it is the block's place after them that lets it win
    const repainted = [
      TICK, ':where(input[type=checkbox])::before', ':where(input[type=radio])::before', SUMMARY.replace(/summary/g, 'summary::before'), CARETS,
      ':where(input[type=range])::-webkit-slider-runnable-track', ':where(input[type=range])::-moz-range-track',
      ':where(progress)::-webkit-progress-value', ':where(progress)::-moz-progress-bar', ...FAILED_FILLS, ':where(select)',
      ':where(input[type=search])::-webkit-search-cancel-button', SELECTED, ACTIVE_HIT, PICKED_ROW,
      // Phase 2 Task 6a: the inventory grid's slot, its tick, its meter's fill and the pressed Grid / List (spec §9.3)
      'button.mat-slot', '.mat-slot-tick::before', '.mat-meter-fill', ".mat-view-toggle button[aria-pressed='true']",
    ];
    for (const selector of repainted) {
      expect(position(selector), selector).toBeGreaterThan(-1);
      expect(position(selector), selector).toBeLessThan(blocks.indexOf(block));
    }
  });
});

// The pause of the pipes (ruling R31, WCAG 2.2.2 Pause, Stop, Hide): the pipes' contents move for as long as a diagram is shown, beside
// what the page says, so the Flow and Connections toolbars have a button that stops them (state/pipes-paused.ts, one setting for this
// browser). Paused, the Flow canvas has `pipes-paused` and the Connections area `data-pipes="paused"`, and the dashes stay where they
// are. The dot of the connection stops by itself within 5 s. pipes.spec.ts presses the button in a browser.

const FLOW_PAUSED = '.flow-canvas.pipes-paused .flow-edge-flow';
const CONN_PAUSED = ".connections[data-pipes='paused'] .conn-edge-flow";

describe('the Machine GUI pause of the pipes', () => {
  it('stops the pipes of both diagrams where they are while they are paused', () => {
    expect(declarations(ruleBody(FLOW_PAUSED))).toEqual([['animation-play-state', 'paused']]);
    expect(declarations(ruleBody(CONN_PAUSED))).toEqual([['animation-play-state', 'paused']]);
    // the lit rule sets a lit pipe's whole animation, its play state too, with the same specificity: the pause comes after it, so a lit
    // pipe stops as well
    expect(position(FLOW_PAUSED)).toBeGreaterThan(position(LIT_CONTENTS));
  });

  it('lets nothing but the pipes move for ever, and the button stops those', () => {
    const endless = blocks.filter((b) => !b.prelude.startsWith('@') && /(^|; )animation: [^;]*\binfinite\b/.test(b.inner)).map((b) => b.prelude);
    expect(endless.sort()).toEqual([CONTENTS, LIT_CONTENTS, CONN_CONTENTS].sort());
  });

  it('stops the dot of the connection by itself within 5 s, on the dot\'s full opacity', () => {
    for (const dot of ['.connection::before', '.connection.live::before']) {
      const [, duration, , count] = (declared(dot, 'animation') ?? '').split(' ');
      expect(Number.parseFloat(duration ?? '') * Number(count), dot).toBeLessThanOrEqual(5);
      // no fill mode: once it has run, the dot is drawn with its own opacity, which no rule lowers
      expect(declared(dot, 'animation'), dot).not.toMatch(/forwards|backwards|both/);
      expect(declared(dot, 'opacity'), dot).toBeUndefined();
    }
  });
});

// Add-on 17 in the Machine GUI (the merge of plan/17-objectives after Phase 1): "Plan for" and the farm settings sit in the settings
// column's sections and controls, and the Compare card is a panel of its own. Its button is a small button in the project head, so a
// closed card takes no room (the chrome's height budget: layout.spec.ts presses the map canvas's middle at 1280x720); open, each mode is a
// column set into the card as an inset frame, its figures readout tiles on a screen and its notes chat boxes. objectives.spec.ts drives the
// card in a browser; these cases pin the values, and the cascade the notes need.

const COMPARE_NOTES = '.compare-card > p, .compare-column > p';
/** The rules of add-on 17's own classes. */
const ADDON17_RULE = /\.(compare-[a-z]+|objective-choice|choice-hint|farm-fields|stat-input|mat-taken)(?![\w-])/;

describe('the Machine GUI planning modes, farms and the Compare card', () => {
  it('draws the open card as a panel with a pixel title, in the ink of a panel, rising in once as the banners do', () => {
    expectDeclared([
      ['.compare-card', 'background', 'var(--panel)'], ['.compare-card', 'border', '2px solid var(--outline)'],
      ['.compare-card', 'border-radius', '0'], ['.compare-card', 'box-shadow', 'var(--bevel-panel)'],
      ['.compare-card', 'animation', 'rise-in var(--dur-base) var(--ease-out)'],
      ['.compare-head > h3', 'font', '600 16px/1.3 var(--font-pixel)'], ['.compare-head > h3', 'color', 'var(--ink-title)'],
    ]);
    expect(inkGroup('.tab-panel').prelude.split(', ')).toContain('.compare-card');
  });

  it('opens it from a small button of the project head that reads yellow while the card is open, and has no closed card to draw', () => {
    expectDeclared([[".compare-toggle[aria-expanded='true']", 'color', 'var(--accent)']]);
    // the closed card was a row of its own under the banner; the button is the head's now, and the closed card draws nothing
    expect(blocks.filter((b) => b.prelude.includes('.compare-card.closed')).map((b) => b.prelude)).toEqual([]);
    expect(position('section.compare-card'), 'the flat look the card had before the restyle').toBe(-1);
  });

  it('moves the button into a bar under the banner below 900px, where the Settings button fills the head\'s one row', () => {
    // wide, the head's button is drawn and the bar is not; narrow, the other way round (the bar is in the banners' box, under the banner)
    expect(declared('.compare-bar', 'display')).toBe('none');
    expect(declaredIn(NARROW, '.project-head > .compare-toggle', 'display')).toBe('none');
    expect(declaredIn(NARROW, '.compare-bar', 'display')).toBe('flex');
    expect(declaredIn(NARROW, '.compare-bar', 'margin')).toBe('0 0 var(--gap)');
    // the head's button is not hidden on a wide window by any rule outside the query
    expect(blocks.filter((b) => !b.nested && b.prelude.split(', ').includes('.project-head > .compare-toggle'))).toEqual([]);
  });

  it('sets each mode in an inset frame, and frames the one in use black with a yellow ring, the frame of a selected slot', () => {
    expectDeclared([
      ['.compare-column', 'border-color', 'var(--panel-lo) var(--panel-hi) var(--panel-hi) var(--panel-lo)'],
      ['.compare-column.current', 'border-color', 'var(--outline)'], ['.compare-column.current', 'box-shadow', 'inset 0 0 0 2px var(--accent)'],
      ['.compare-column > h4', 'font', '600 15px/1.3 var(--font-pixel)'], ['.compare-column > h4', 'color', 'var(--ink-title)'],
    ]);
    // the frame of the one in use comes after the frame of every column, which it replaces
    expect(position('.compare-column.current')).toBeGreaterThan(position('.compare-column'));
  });

  it('shows a mode\'s figures as readout tiles on a screen: a quiet Inter label over a green VT323 value', () => {
    expectDeclared([
      ['.compare-rows', 'display', 'grid'], ['.compare-rows', 'margin', '0'],
      ['.compare-row', 'background', 'var(--screen)'], ['.compare-row', 'box-shadow', 'var(--bevel-well)'], ['.compare-row', 'border-radius', '0'],
      ['.compare-row > dt', 'color', 'var(--screen-muted)'], ['.compare-row > dt', 'font-size', '11px'],
      // the line 24px/1.1 gave, as Chromium lays it out (it floors that to 1/64 px and would round 26.4px up): a tile keeps its height (P2-R13)
      ['.compare-row > dd', 'color', 'var(--screen-text)'], ['.compare-row > dd', 'font', '28px/26.390625px var(--font-digits)'],
      ['.compare-row > dd', 'margin', '0'],
    ]);
    // the label stays Inter: the pixel font is never below 13px
    expect(declared('.compare-row > dt', 'font-family')).toBeUndefined();
  });

  it('never breaks a figure: the tiles reflow at 160px, a value stays on one line and shrinks to fit, to 14px at the least', () => {
    // the review of the merge, C4: three columns at 760 to 915px left a tile 81 to 94px, and "2,097,152" broke over two lines. A tile is
    // at least 160px: 12 glyphs of the 28 px VT323 (0.4 em each, 0.41 with the margin) and 16px of padding, never wider than its column
    // (Phase 2 spec §25, plan ruling compare-shrink-vt323)
    expectDeclared([
      ['.compare-rows', 'grid-template-columns', 'repeat(auto-fit, minmax(min(160px, 100%), 1fr))'],
      ['.compare-row > dd', 'white-space', 'nowrap'], ['.compare-row > dd', 'overflow-wrap', 'normal'],
      // a value too long for its tile shrinks (the tile is the container; the page gives the value's length in glyphs) ...
      ['.compare-row', 'container-type', 'inline-size'],
      ['.compare-row > dd', 'font-size', 'clamp(14px, calc(100cqi / (var(--glyphs, 1) * 0.41)), 28px)'],
      // ... and is cut only past 14px, so the tile never spills out of its column
      ['.compare-row > dd', 'overflow', 'hidden'], ['.compare-row > dd', 'text-overflow', 'ellipsis'],
    ]);
    // the size comes after the shorthand that sets the 28px it shrinks from
    const dd = declarations(ruleBody('.compare-row > dd')).map(([name]) => name);
    expect(dd.indexOf('font-size')).toBeGreaterThan(dd.indexOf('font'));
    // the review of the merge, C5: the label at the top of a tile and the value at its foot, so the values of a row line up when a
    // label wraps and another does not
    expectDeclared([['.compare-row', 'justify-content', 'space-between'], ['.compare-row', 'flex-direction', 'column']]);
  });

  it('writes the notes in chat boxes in the light ink, at one class\'s specificity, so .muted and .error still win on them', () => {
    expectDeclared([[COMPARE_NOTES, 'background', 'var(--chat)'], [COMPARE_NOTES, 'border', '2px solid var(--outline)']]);
    expect(declared(COMPARE_NOTES, 'color'), 'a colour here would outrank .muted and .error').toBeUndefined();
    const dark = inkGroup('.banner');
    expect(dark.prelude.split(', ')).toEqual(expect.arrayContaining(['.compare-card > :where(p)', '.compare-column > :where(p)']));
    // "Still planning…" is a .muted note and a failed mode's reason an .error one: both come after the group, at its specificity
    expect(blocks.indexOf(dark)).toBeLessThan(position('.muted'));
    expect(blocks.indexOf(dark)).toBeLessThan(position('.error'));
  });

  it('keeps "Plan for" in the section\'s choice pattern, and hangs a farm\'s fields under its tick on a grey line, as far in as the hints', () => {
    expectDeclared([
      ['.settings-section p.choice-hint', 'margin', '0 0 2px 24px'],
      ['.farm-fields', 'border-left', '2px solid var(--panel-lo)'], ['.farm-fields', 'margin-left', '7px'], ['.farm-fields', 'padding-left', '15px'],
    ]);
    // the line runs down the middle of the 16px tick (7px in, 2px wide), and the fields start as far in as the hints, under the label's text
    const px = (value: string | undefined): number => Number.parseFloat(value ?? '');
    const indent = px(declared('.farm-fields', 'margin-left')) + px(declared('.farm-fields', 'border-left')) + px(declared('.farm-fields', 'padding-left'));
    expect(indent).toBe(px(declared('.settings-section p.choice-hint', 'margin')?.split(' ')[3]));
    // the legend is a section title: the rule of the titles names it
    expect(TITLES.split(', ')).toContain('.choice > legend.settings-title');
  });

  it('writes who takes a left-over byproduct, in the rows under it, in the quiet ink of the Materials panel', () => {
    // the panel group's `--ink-muted`, which reads `--text-muted`: a look reaches these rows through the token
    expectDeclared([['.mat-taken', 'color', 'var(--ink-muted)']]);
  });

  it('keeps the cues of the open button and of the mode in use in forced colours, where the yellow is gone', () => {
    expect(inQuery(FORCED, ".compare-toggle[aria-expanded='true']")).toEqual([['text-decoration', 'underline']]);
    expect(inQuery(FORCED, '.compare-column.current')).toEqual([['outline', '2px solid Highlight'], ['outline-offset', '-4px']]);
    const { block } = forcedBlock();
    for (const selector of [".compare-toggle[aria-expanded='true']", '.compare-column.current']) expect(position(selector)).toBeLessThan(blocks.indexOf(block));
  });

  it('reads no alias of the old palette and rounds no corner in the rules of add-on 17', () => {
    const rules = blocks.filter((b) => !b.prelude.startsWith('@') && ADDON17_RULE.test(b.prelude));
    // the scan sees the rules, so a rule it cannot parse would not pass unnoticed
    expect(rules.length).toBeGreaterThan(15);
    for (const block of rules) {
      expect(block.inner, block.prelude).not.toMatch(OLD_ALIASES);
      expect(declared(block.prelude, 'border-radius') ?? '0', block.prelude).toBe('0');
    }
  });
});

// Phase 2 (Phase 2 spec §4.11, D1): every rule Phase 2 adds reads tokens, so it is drawn in both looks, and writes a colour as a literal only
// when that colour is the same in both. The Theme button (§4.8) sits at the end of the top bar, its pixel icon a background its choice picks;
// a switch cross-fades the whole page over `--dur-slow` (§4.9), which the reduced-motion block sets to 0 ms (and the JS starts no fade then).

/**
 * Phase 2 Task 6a (spec §9.3): "To build (once)" as an inventory grid. The head holds the title, the Grid / List toggle and, in Grid, the
 * meter; then the hint, and each group's head over its recessed slot area. A slot is a reset button round its 36 px item slot, with the focus
 * ring and the keyboard's veil, the dimmed face and pixel tick of a marked row, and the +N slot of an item past nine stacks.
 */
const GRID_RULES = [
  '.mat-head', '.mat-view-toggle', '.mat-view-toggle button + button', ".mat-view-toggle button[aria-pressed='true']", '.mat-meter-box', '.mat-meter-label',
  '.mat-meter', '.mat-meter-fill', '.mat-grid', '.mat-grid-hint', '.mat-grid-group h4', '.mat-grid-left', '.mat-slots', 'button.mat-slot',
  'button.mat-slot:focus-visible', 'button.mat-slot:focus-visible .item-icon::after', 'button.mat-slot.marked::after', '.mat-slot-tick', '.mat-slot-tick::before',
  'button.mat-slot-more', 'button.mat-slot-more > .stack-count',
];

/**
 * Phase 2 Task 7 (spec §10.2): the key-numbers strip, five readout tiles at the top of the banners' box, each a label row with its qualifier
 * over a VT323 figure and its unit; a changed tile's frame and qualifier flash once; the place it keeps while its plan is on its way, the
 * strip's own grid of five empty 52 px blocks (ledger ruling P2-R48); and the plan's cost sentence beside it, hidden from sight by a sibling
 * rule (`.plan-cost`'s own rule is pinned).
 */
const STRIP_HIDE = '.project-banners > .key-numbers ~ .plan-cost';
const STRIP_RULES = [
  '.key-numbers', '.key-numbers > dl', '.key-number', '.key-number dt', '.key-number-sub', '.key-number dd', '.key-number-unit',
  '.key-number dd.key-number-words', '.key-number.changed .key-number-sub', '.key-number-flash', '.key-numbers-wait', STRIP_HIDE,
];

/**
 * Phase 2 Task 8 (spec §11.2): the skeletons beside the loading lines, empty blocks in the shape of what is coming, each with a sheen that
 * passes three times; the diagram's and the scene's set into a well.
 */
const SKELETON_BLOCK = '.skeleton-block';
const SHEEN = '.skeleton-block::after';
const SKELETON_WELLS = '.skeleton-diagram, .skeleton-scene';
const SKELETON_RULES = [
  '.skeleton', SKELETON_BLOCK, SHEEN, '.skeleton-cards', '.skeleton-cards .skeleton-block', '.skeleton-project .skeleton-block:nth-child(1)',
  '.skeleton-project .skeleton-block:nth-child(2)', '.skeleton-project .skeleton-block:nth-child(3)', '.skeleton-strip', '.skeleton-strip .skeleton-block',
  SKELETON_WELLS, '.skeleton-diagram', '.skeleton-diagram .skeleton-block', '.skeleton-scene', '.skeleton-scene .skeleton-block', '.skeleton-lines .skeleton-block:nth-child(even)',
];
/** The Compare card's two (plan ruling compare-skeletons): a mode's six figures in the tiles' own grid, and the three modes framed as columns. */
const COMPARE_SKELETON_RULES = ['.skeleton-readouts', '.skeleton-readouts .skeleton-block', '.skeleton-compare', '.skeleton-compare > .skeleton-readouts'];
/**
 * Task 8 (ledger rulings P2-R18, P2-R51): the plan's busy line, out of the flow: on the key-numbers strip's top-right corner while the strip is
 * drawn (a target is set), clipped from sight as `.visually-hidden` clips while it is not.
 */
const BUSY_LINE = '.plan-banner > p.muted';
const BUSY_CHIP = '.project-banners > .key-numbers ~ .plan-banner > p.muted';
const BUSY_ALONE = '.plan-banner:has(> p.muted:only-child)';
const BUSY_RULES = ['.project-banners', BUSY_LINE, BUSY_CHIP];

/**
 * Phase 2 Task 9a (spec §12.3): the toasts, chat boxes stacked in a region fixed in the window's bottom-right corner, under every layer; the
 * region takes no pointer, its toasts do, but for one that is leaving.
 */
const TOASTS = '.toasts';
const TOAST = '.toast';
const TOAST_LEAVING = ".toast[data-state='leaving']";
const TOAST_RULES = [TOASTS, '.toasts > ol', TOAST, '.toast > span', TOAST_LEAVING];

/** The selectors of every rule Phase 2 adds; each later task appends its own. */
const PHASE2_RULES: string[] = [
  '.theme-button', '.theme-button::before', ".theme-button[data-choice='dark']::before", ".theme-button[data-choice='light']::before",
  '::view-transition-old(root)', '::view-transition-new(root)',
  OVERLAYS, '.brand-mark::after',                                                    // Task 2: logo C's overlays (spec §5.3)
  '.fig',                                                                            // Task 2b: a figure in pixel text (spec §25)
  '.nei-tooltip', '.nei-tooltip > :first-child', '.nei-tooltip-mod', ".nei-tooltip[data-state='closing']",   // Task 3a (spec §6.3)
  ...TIER_RULES, ...READOUT_RULES,                                                   // Task 4: the Flow machine readout (spec §7.3)
  ...RECIPE_RULES,                                                                   // Task 5a: the step panel's recipe card (spec §8.4)
  '.flow-side',                                                                      // Task 5b: the panel's wrapper, slid in once (spec §8.6)
  '.flow-canvas:focus', '.flow-canvas:focus-visible',                                // Task 5b fix round 1: the canvas's focus (P2-R36)
  ...GRID_RULES,                                                                     // Task 6a: the inventory grid (spec §9.3)
  ...MAT_FOLD_RULES,                                                                 // Task 6b: the Materials disclosures fold (spec §3.3, R16)
  ...STRIP_RULES,                                                                    // Task 7: the key-numbers strip (spec §10.2)
  ...SKELETON_RULES, ...COMPARE_SKELETON_RULES,                                      // Task 8: the skeletons (spec §11.2, compare-skeletons)
  ...BUSY_RULES,                                                                     // Task 8: the busy line out of the flow (P2-R18)
  ...TOAST_RULES,                                                                    // Task 9a: the toasts (spec §12.3)
];
/** The colour literals a Phase 2 rule may write: each is the same in both looks (spec §4.4). */
const SAME_IN_BOTH = ['#ffffff', '#000000', '#aaaaaa', '#100010', '#ffff55', 'rgb(0 0 0 / 0.4)'];
/** What a Phase 2 transition may animate (spec §3.3): the compositor's two, a hover's face, and the height of what folds. */
const MAY_MOVE = /^(transform|opacity|background-color|block-size|content-visibility)$/;

describe('the Machine GUI Phase 2: the dark look and the Theme button', () => {
  it('draws the look switch with its pixel icon, and cross-fades a switch over --dur-slow', () => {
    expectDeclared([
      ['.theme-button', 'margin-left', 'auto'], ['.theme-button', 'display', 'inline-flex'], ['.theme-button', 'align-items', 'center'],
      ['.theme-button', 'gap', '8px'], ['.theme-button', 'padding', '0 12px'],
      ['.theme-button::before', 'content', "''"], ['.theme-button::before', 'flex', 'none'], ['.theme-button::before', 'width', '16px'],
      ['.theme-button::before', 'height', '16px'], ['.theme-button::before', 'background', 'var(--icon-auto) center / contain no-repeat'],
      [".theme-button[data-choice='dark']::before", 'background-image', 'var(--icon-moon)'],
      [".theme-button[data-choice='light']::before", 'background-image', 'var(--icon-sun)'],
    ]);
    // each icon is an 8 x 8 pixel SVG drawn at 2x: a sun, a moon, and for Auto a square half light and half dark
    const ICONS: [string, string[]][] = [
      ['--icon-sun', ["fill='#ffd84a' d='M3 0h1v7H3zM0 3h7v1H0zM2 2h3v3H2zM1 1h1v1H1zM5 1h1v1H5zM1 5h1v1H1zM5 5h1v1H5z'"]],
      ['--icon-moon', ["fill='#c8d4ff' d='M2 0h3v1H2zM1 1h2v1H1zM0 2h2v3H0zM1 5h2v1H1zM6 5h1v1H6zM2 6h4v1H2z'"]],
      ['--icon-auto', ["fill='#c6c6c6' d='M0 0h4v8H0z'", "fill='#2a2a2a' d='M4 0h4v8H4z'"]],
    ];
    for (const [name, paths] of ICONS) {
      const icon = decodeURIComponent(rootTokens().get(name) ?? '');
      for (const part of ['data:image/svg+xml', "viewBox='0 0 8 8'", "shape-rendering='crispEdges'", ...paths]) expect(icon, `${name}: ${part}`).toContain(part);
    }
    // the cross-fade: two rules, not spec §4.9's one list, whose pseudo-element half the minifier once dropped (R28; plan ruling
    // view-transition-split)
    for (const half of ['::view-transition-old(root)', '::view-transition-new(root)']) {
      expectDeclared([[half, 'animation-duration', 'var(--dur-slow)'], [half, 'animation-timing-function', 'var(--ease-out)']]);
    }
    expect(position('::view-transition-old(root), ::view-transition-new(root)')).toBe(-1);
    // the button's face is the base button's 36px, so the top bar stays one row of the same height
    expectDeclared([['.top-nav', 'min-height', '50px']]);
    // the slider's thumb takes a token of its own, which the dark look lightens: the button's face would be 1.30:1 on a dark panel
    expectDeclared([
      [':where(input[type=range])::-webkit-slider-thumb', 'background', 'var(--thumb)'],
      [':where(input[type=range])::-moz-range-thumb', 'background', 'var(--thumb)'],
    ]);
  });

  it('builds every Phase 2 rule on tokens, and transitions only what may move', () => {
    for (const selector of PHASE2_RULES) {
      const body = ruleBody(selector);
      for (const literal of body.match(/#[0-9a-f]+\b|rgba?\([^)]*\)|hsla?\([^)]*\)/gi) ?? []) expect(SAME_IN_BOTH, `${selector}: ${literal}`).toContain(literal);
      for (const [name, value] of declarations(body)) {
        if (name !== 'transition') continue;
        for (const part of selectorList(value)) expect(part.split(' ')[0], `${selector} { transition: ${part} }`).toMatch(MAY_MOVE);
      }
    }
  });
});

// Figures in VT323 (Phase 2 spec §25, plan rulings figures-vt323, digits-token, digits-floor, digits-mixed and digits-sizes): Pixelify Sans
// draws 5 like S, 2 like Z and 0 like O, so a readout that is a figure is set whole in VT323, and the figures of other pixel text in a
// `span.fig` (Figs.tsx); words stay Pixelify. Each VT323 size gives digits as tall as the Pixelify ones it replaces, on the line it had.

/** Every rule that names the digits' face (Tasks 5a and 7 append theirs). */
const DIGIT_RULES: string[] = [
  '.fig', '.compare-row > dd', 'details.settings-section > summary > .muted', '.step-list li::marker', '.map-y', '.view3d-layer-text', '.smart-total',
  STACK_COUNT, '.readout dd',                                                        // Task 5a: a slot's count and a recipe readout, whole in VT323
  '.key-number dd', '.key-number-unit',                                              // Task 7: the strip's figure and its unit, whole in VT323
];
/** VT323 only at 14px or more (plan ruling digits-floor): at 13px a stroke thins to half a pixel on a 1x screen. */
const DIGITS_FLOOR = 14;
/** The px font sizes a rule gives: its `font`'s size, and every px of its `font-size` (both ends of a clamp). */
const pxSizes = (selector: string): number[] => [
  ...(declared(selector, 'font')?.match(/^(?:\S+ )*?([\d.]+)px/)?.slice(1) ?? []), ...(declared(selector, 'font-size')?.match(/[\d.]+(?=px)/g) ?? []),
].map(Number);

describe('the Machine GUI Phase 2: figures in VT323', () => {
  it('sets every figure in VT323, at 14 px or more, its fallback drawn as tall, and leaves the words in Pixelify', () => {
    // spec §25: these rules and no other name the digits' face (Tasks 5a and 7 append theirs), and none of them names Pixelify
    const naming = blocks.filter((b) => !b.prelude.startsWith('@') && b.inner.includes('var(--font-digits)')).map((b) => b.prelude);
    expect(naming.sort()).toEqual([...DIGIT_RULES].sort());
    for (const selector of DIGIT_RULES) {
      expect(ruleBody(selector).includes('--font-pixel'), selector).toBe(false);
      // a fallback (Menlo, Consolas …) drawn as tall as VT323's 0.56 em digits; `font` resets it, so it comes after
      expect(declared(selector, 'font-size-adjust'), selector).toBe('cap-height 0.56');
      const names = declarations(ruleBody(selector)).map(([name]) => name);
      if (names.includes('font')) expect(names.lastIndexOf('font-size-adjust'), selector).toBeGreaterThan(names.lastIndexOf('font'));
      for (const px of pxSizes(selector)) expect(px, selector).toBeGreaterThanOrEqual(DIGITS_FLOOR);
    }
    // a figure inside Pixelify text: 1.15 em, as tall as the digits around it, on a line height of 0, so it moves no line
    expect(declared('.fig', 'font')).toBe('1.15em/0 var(--font-digits)');
    expect(1.15 * 13).toBeGreaterThanOrEqual(DIGITS_FLOOR);   // in the smallest Pixelify there is
    // the words stay in Pixelify: the badges and chips, the map tooltip and the 3D label keep their rules
    expectDeclared([['.badge, .chip', 'font', '13px/1.5 var(--font-pixel)'], [TIP, 'font', '14px/1.35 var(--font-pixel)'], [HOVER, 'font', '14px/1.35 var(--font-pixel)']]);
  });
});

// The shared NEI tooltip (Phase 2 spec §6.3, Task 3a): the map tooltip's look in a rule of its own (never in `.map-tooltip`'s, whose pins
// read that rule alone: R1), fixed in the window above every layer, the modal's included, and never taking the pointer (hit tests and
// Playwright's clicks need that); its first line white and its mod line in --tip-mod's blue, italic. It rises in as the map's does, and
// fades out in 80 ms as it is about to be removed, so its exit alone keeps its last frame (`forwards`).
const NEI_TIP = '.nei-tooltip';
const NEI_TIP_CLOSING = ".nei-tooltip[data-state='closing']";

describe('the Machine GUI Phase 2: the shared NEI tooltip', () => {
  it('draws the shared tooltip as an NEI tooltip above every layer, and fades it out in 80 ms', () => {
    expectDeclared([
      [NEI_TIP, 'position', 'fixed'], [NEI_TIP, 'top', '0'], [NEI_TIP, 'left', '0'], [NEI_TIP, 'z-index', '200'], [NEI_TIP, 'pointer-events', 'none'],
      [NEI_TIP, 'width', 'max-content'], [NEI_TIP, 'max-width', '360px'], [NEI_TIP, 'padding', '6px 8px'], [NEI_TIP, 'overflow-wrap', 'anywhere'],
      [NEI_TIP, 'background', 'var(--tip-bg)'], [NEI_TIP, 'border', '2px solid var(--tip-border)'],
      [NEI_TIP, 'box-shadow', '0 0 0 1px #100010, inset 0 0 0 1px var(--tip-inner)'],
      [NEI_TIP, 'color', '#aaaaaa'], [NEI_TIP, 'font', '14px/1.35 var(--font-pixel)'], [NEI_TIP, 'animation', 'tip-in 120ms var(--ease-out)'],
      ['.nei-tooltip > :first-child', 'color', '#ffffff'],
      ['.nei-tooltip-mod', 'color', 'var(--tip-mod)'], ['.nei-tooltip-mod', 'font-style', 'italic'],
      [NEI_TIP_CLOSING, 'animation', 'tip-out 80ms var(--ease-in) forwards'],
    ]);
    expect(Number(declared(NEI_TIP, 'z-index'))).toBeGreaterThan(Number(declared('.modal-backdrop', 'z-index')));
    expect(declared(NEI_TIP, 'border-radius') ?? '0').toBe('0');
    expect(ruleBody('@keyframes tip-out')).toMatch(/^to \{ opacity: 0; transform: translateY\(2px\);? \}$/);
    // an item icon's tip is this one, never a native title, and so is a diagram box's or arrow's, never an SVG title (spec §6.4)
    expect(read('components/ItemIcon.tsx')).not.toMatch(/\btitle=/);
    for (const file of ['views/FlowView.tsx', 'views/ConnectionsView.tsx']) expect(read(file), file).not.toMatch(/<title[\s>]/);
  });
});

// The Flow machine readout (Phase 2 spec §7.3, Task 4): a step box's head draws its machine in a slot with the inverted bevel of a Minecraft
// slot, its tier and its count on Pixelify chips (the tier's in its own ink, the count's white; a count's digits ride in Task 2b's tspan.fig,
// plan ruling digits-mixed) and its power in the box's quiet ink, over a busy band whose fill turns amber from 90 %. In forced colours the
// fill is the Highlight, the track and the chips get an edge in the text colour and the slot a frame in it round a face of the canvas
// (ledger ruling P2-R26), each rule at the specificity of the rule it repaints.
describe('the Machine GUI Phase 2: the Flow machine readout', () => {
  it('draws a step\'s machine in a slot, its tier and count on Pixelify chips, and how busy it is', () => {
    // each tier class names its tier's ink and nothing else
    for (const slug of TIER_SLUGS) expect(declarations(ruleBody(`.tier-${slug}`)), slug).toEqual([['--tier-ink', `var(--tier-${slug})`]]);
    expect(TIER_SLUGS.map((slug) => rootTokens().has(`--tier-${slug}`))).toEqual(TIER_SLUGS.map(() => true));
    expectDeclared([
      ['.flow-node .flow-chip.tier-max text', 'font-weight', '700'],
      ['.flow-machine-slot', 'fill', 'var(--slot)'], ['.flow-slot-lo', 'fill', 'var(--slot-lo)'], ['.flow-slot-hi', 'fill', 'var(--slot-hi)'],
      ['.flow-chip rect', 'fill', 'var(--flow-chip)'],
      [CHIP_TEXT, 'fill', 'var(--tier-ink, var(--stack-ink))'], [CHIP_TEXT, 'font', '13px/1 var(--font-pixel)'], [CHIP_TEXT, 'text-anchor', 'middle'],
      ['.flow-node .flow-node-power', 'fill', 'var(--text-muted)'], ['.flow-node .flow-node-power', 'font-size', '11px'],
      ['.flow-busy-track', 'fill', 'var(--flow-busy-track)'], ['.flow-busy-fill', 'fill', 'var(--flow-busy)'],
      ['.flow-busy.high .flow-busy-fill', 'fill', 'var(--flow-busy-high)'],
      ['.flow-node .flow-busy-text', 'font-size', '11px'], ['.flow-node .flow-busy-text', 'font-variant-numeric', 'tabular-nums'],
      ['.flow-node .flow-busy-text', 'text-anchor', 'end'],
    ]);
    // a count's digits ride in Task 2b's tspan.fig: no chip rule names the digits' face, and the chip text's font is all Pixelify
    for (const selector of [...TIER_RULES, ...READOUT_RULES]) expect(ruleBody(selector).includes('--font-digits'), selector).toBe(false);
    // the weight comes after the font shorthand of the chip text's rule, which resets it on the text itself: MAX's rule is its own
    expect(declarations(ruleBody('.flow-node .flow-chip.tier-max text'))).toEqual([['font-weight', '700']]);
    // the power and the band's words keep the diagram's font, which flow-model measures (6.2 px a character): only a size
    for (const words of ['.flow-node .flow-node-power', '.flow-node .flow-busy-text']) {
      expect(declared(words, 'font'), words).toBeUndefined(); expect(declared(words, 'font-family'), words).toBeUndefined();
    }
    // no shadow on a chip or a slot: among the Flow rules only the box has one (the case above)
    for (const selector of READOUT_RULES) expect(ruleBody(selector), selector).not.toMatch(/shadow/);
    // forced colours: the fills in the Highlight (the high one's own rule out-ranks a bare .flow-busy-fill, so the block names it too), the
    // track and the chips an edge in the text colour, all after the rules they repaint
    expect(inQuery(FORCED, '.flow-busy-fill, .flow-busy.high .flow-busy-fill')).toEqual([['fill', 'Highlight']]);
    expect(inQuery(FORCED, '.flow-busy-track, .flow-chip rect')).toEqual([['stroke', 'CanvasText']]);
    // ledger ruling P2-R26: the machine's slot is SVG fills too, its face and its two bevel strips: a face of the theme's canvas framed in its
    // text colour, each rule at the specificity of the slot's own (0,1,0), which it beats by coming after it
    expect(inQuery(FORCED, '.flow-machine-slot')).toEqual([['fill', 'Canvas']]);
    expect(inQuery(FORCED, '.flow-slot-lo, .flow-slot-hi')).toEqual([['fill', 'CanvasText']]);
    const { block, rules } = forcedBlock();
    for (const selector of [
      '.flow-busy-fill', '.flow-busy.high .flow-busy-fill', '.flow-busy-track', '.flow-chip rect', '.flow-machine-slot', '.flow-slot-lo', '.flow-slot-hi',
    ]) {
      expect(position(selector), selector).toBeGreaterThan(-1);
      expect(position(selector), selector).toBeLessThan(blocks.indexOf(block));
    }
    // the slot's rules were added at the end of the block, after the band's and the chips'
    const inBlock = (prelude: string): number => rules.findIndex((rule) => rule.prelude === prelude);
    expect(inBlock('.flow-machine-slot')).toBeGreaterThan(inBlock('.flow-busy-track, .flow-chip rect'));
    expect(inBlock('.flow-slot-lo, .flow-slot-hi')).toBeGreaterThan(inBlock('.flow-machine-slot'));
    // the readout's rules sit with the box's, after the flange's
    for (const selector of [...TIER_RULES, ...READOUT_RULES]) expect(position(selector), selector).toBeGreaterThan(position('.flow-row.hl .flow-port'));
  });
});

// The step panel's recipe card (Phase 2 spec §8, Task 5a): one run as NEI draws it, in a recess of the panel (--bevel-inset): the slots, each
// a 36 px item slot with its stack count at the bottom right (white VT323 16 px over its 2 px shadow, in the 14 px box Pixelify's 14 px had:
// spec §25) and a chance tag at the top left (Pixelify, its digits Figs' span.fig); the GT progress arrow, whose fill runs three times in
// 4.8 s and then rests full (spec §11.3); a 10 x 36 energy bar filled from the bottom to the share of what the machine can draw; then the
// four readouts on screens in the dark box's ink (VT323 21 px, its digits as tall as the 18 px Pixelify of the mockup) and the chips. In
// forced colours the two fills are the Highlight.
describe('the Machine GUI Phase 2: the recipe card', () => {
  it('draws one run as NEI does: slots with stack counts, an arrow that runs three times, readouts', () => {
    expectDeclared([
      ['.recipe-strip', 'background', 'var(--panel)'], ['.recipe-strip', 'box-shadow', 'var(--bevel-inset)'],
      ['.recipe-slot', 'position', 'relative'],
      [STACK_COUNT, 'position', 'absolute'], [STACK_COUNT, 'right', '1px'], [STACK_COUNT, 'bottom', '-2px'], [STACK_COUNT, 'z-index', '1'],
      [STACK_COUNT, 'pointer-events', 'none'], [STACK_COUNT, 'font', '16px/14px var(--font-digits)'], [STACK_COUNT, 'font-size-adjust', 'cap-height 0.56'],
      [STACK_COUNT, 'color', 'var(--stack-ink)'], [STACK_COUNT, 'text-shadow', '2px 2px 0 var(--stack-shadow)'],
      // the chance tag keeps Pixelify, its digits in Figs' span.fig (spec §25: VT323's % reads as an x)
      ['.slot-chance', 'position', 'absolute'], ['.slot-chance', 'left', '2px'], ['.slot-chance', 'top', '2px'], ['.slot-chance', 'z-index', '1'],
      ['.slot-chance', 'pointer-events', 'none'], ['.slot-chance', 'font', '14px/1 var(--font-pixel)'], ['.slot-chance', 'color', '#ffff55'],
      ['.slot-chance', 'text-shadow', '2px 2px 0 var(--stack-shadow)'],
      // and it never draws past its own slot: 2 px in and at most 34 px wide, its 2 px right padding the room of its text's 2 px shadow, which
      // the clip at that padding's edge never reaches unless a wider fallback face runs past the slot (its text is short: chanceTag)
      ['.slot-chance', 'max-width', '34px'], ['.slot-chance', 'box-sizing', 'border-box'], ['.slot-chance', 'padding-right', '2px'],
      ['.slot-chance', 'overflow-x', 'clip'], ['.slot-chance', 'white-space', 'nowrap'],
      ['.readout', 'padding', '5px 7px'], ['.readout', 'background', 'var(--screen)'], ['.readout', 'box-shadow', 'var(--bevel-screen)'],
      ['.readout dt', 'font-size', '11px'], ['.readout dt', 'color', 'var(--ink-muted)'],
      ['.readout dd', 'margin', '0'], ['.readout dd', 'font', '21px/21.6px var(--font-digits)'], ['.readout dd', 'font-size-adjust', 'cap-height 0.56'],
      ['.readout dd', 'color', 'var(--screen-text)'], ['.readout dd', 'font-variant-numeric', 'tabular-nums'],
      // spec §11.3, as written there
      ['.gt-arrow', 'position', 'relative'], ['.gt-arrow', 'display', 'inline-block'], ['.gt-arrow', 'flex', 'none'], ['.gt-arrow', 'width', '22px'],
      ['.gt-arrow', 'height', '16px'], ['.gt-arrow', 'vertical-align', 'middle'], ['.gt-arrow', 'background', 'var(--slot)'],
      ['.gt-arrow', 'clip-path', 'polygon(0 35%, 60% 35%, 60% 0, 100% 50%, 60% 100%, 60% 65%, 0 65%)'],
      [ARROW_FILL, 'position', 'absolute'], [ARROW_FILL, 'inset', '0'], [ARROW_FILL, 'background', 'var(--stack-ink)'], [ARROW_FILL, 'transform-origin', 'left'],
      [ARROW_FILL, 'animation', 'gt-arrow 1.6s steps(8) 3'],
      ['.gt-arrow.on-chat', 'background', 'var(--progress-base)'], ['.gt-arrow.on-chat', 'margin-right', '8px'],
      ['.gt-arrow.on-chat .gt-arrow-fill', 'background', 'var(--accent)'], ['.gt-arrow.still .gt-arrow-fill', 'animation', 'none'],
      ['.energy-bar', 'position', 'relative'], ['.energy-bar', 'width', '10px'], ['.energy-bar', 'height', '36px'], ['.energy-bar', 'overflow', 'hidden'],
      ['.energy-bar', 'background', 'var(--screen)'], ['.energy-bar', 'box-shadow', 'inset 1px 1px 0 #000000'],
      ['.energy-fill', 'position', 'absolute'], ['.energy-fill', 'inset', '0'], ['.energy-fill', 'transform', 'scaleY(var(--share))'],
      ['.energy-fill', 'transform-origin', 'bottom'], ['.energy-fill', 'background', 'var(--energy)'],
      // the chips: the tier's in its tier's ink (Task 4's .tier-<slug> classes), which beats the badge's white; MAX bold; the overclock tones
      ['.badge.tier-chip', 'color', 'var(--tier-ink)'], ['.badge.tier-chip.tier-max', 'font-weight', '700'],
      ['.oc-chip.oc-now', 'color', 'var(--ink-ok)'], ['.oc-chip.oc-note', 'color', 'var(--ink-warn)'],
      ['.recipe-stats', 'grid-template-columns', 'repeat(2, minmax(0, 1fr))'],
    ]);
    // a tone's class is its own (oc-now, oc-note): a bare .note is the Notes tab's card, whose panel, edge and bevel would frame the chip
    expect(position('.oc-chip.note')).toBe(-1); expect(position('.oc-chip.now')).toBe(-1);
    expect(ruleBody('.note, .note-add')).toMatch(/box-shadow: var\(--bevel-panel\)/);
    // below 1100 px the panel is the window's width, and the four readouts make one row
    expect(declaredIn('@media (max-width: 1100px)', '.recipe-stats', 'grid-template-columns')).toBe('repeat(4, minmax(0, 1fr))');
    // a readout is a screen in the dark box's light ink: it joins the dark group, after the seven members the chrome case pins
    const dark = inkGroup('.banner').prelude.split(', ');
    expect(dark.indexOf('.readout')).toBeGreaterThanOrEqual(7);
    expect(dark).toEqual(expect.arrayContaining(['.compare-card > :where(p)', '.compare-column > :where(p)', '.readout']));
    // the arrow is finite (WCAG 2.2.2: within 5 s, rulings R31 and D17) and rests full, its own style: no fill mode
    const [, duration, , count] = (declared(ARROW_FILL, 'animation') ?? '').split(' ');
    expect(Number.parseFloat(duration ?? '') * Number(count)).toBeLessThanOrEqual(5);
    expect(declared(ARROW_FILL, 'animation')).not.toMatch(/forwards|backwards|both|infinite/);
    expect(declared(ARROW_FILL, 'transform')).toBeUndefined();
    // forced colours: the arrow's and the energy bar's fills are the Highlight (the chat arrow's own fill rule out-ranks a bare .gt-arrow-fill,
    // so the block names it too), each after the rule it repaints
    expect(inQuery(FORCED, '.gt-arrow-fill, .gt-arrow.on-chat .gt-arrow-fill, .energy-fill')).toEqual([['background', 'Highlight']]);
    // ledger ruling P2-R33: the theme paints over the backgrounds and drops the shadows the card's cues are drawn with, so the energy bar's
    // track keeps an edge in the text colour (its fill has a scale), a short slot a Highlight ring, and the arrow its base in GrayText
    expect(inQuery(FORCED, '.energy-bar')).toEqual([['outline', '1px solid CanvasText'], ['outline-offset', '-1px']]);
    expect(inQuery(FORCED, '.recipe-slot.slot-short > .item-icon')).toEqual([['outline', '2px solid Highlight'], ['outline-offset', '-2px']]);
    expect(inQuery(FORCED, '.gt-arrow, .gt-arrow.on-chat')).toEqual([['background', 'GrayText']]);
    const { block } = forcedBlock();
    for (const selector of [ARROW_FILL, '.gt-arrow.on-chat .gt-arrow-fill', '.energy-fill', '.energy-bar', '.recipe-slot.slot-short > .item-icon', '.gt-arrow', '.gt-arrow.on-chat']) {
      expect(position(selector), selector).toBeGreaterThan(-1);
      expect(position(selector), selector).toBeLessThan(blocks.indexOf(block));
    }
  });
});

// "To build (once)" as an inventory grid (Phase 2 spec §9.3, Task 6a): a slot is a button reset to nothing, so its 32 px item icon is the 36 px
// slot, which a long press never selects; its ring is in the focus ink of the panel, above the slots beside it, with the keyboard's veil over
// its image (a rule of its own: LIT_SLOT is pinned); a marked row's slots are dimmed by an overlay, never by styling the image, under a pixel
// tick, the checkbox's, in green with a 1 px black edge from four drop-shadows on its box. The slots sit in a recess of the panel; the meter
// fills on transform alone; the pressed Grid / List sinks and reads yellow. In forced colours each slot keeps a frame (but not while it shows
// the focus ring: R42's pattern), the tick and the meter's fill are the Highlight, and the pressed toggle is underlined, each after its base rule.
describe('the Machine GUI Phase 2: the inventory grid', () => {
  it('draws the inventory grid as Minecraft slots', () => {
    expectDeclared([
      ['button.mat-slot', 'position', 'relative'], ['button.mat-slot', 'width', '36px'], ['button.mat-slot', 'height', '36px'], ['button.mat-slot', 'min-height', '0'],
      ['button.mat-slot', 'padding', '0'], ['button.mat-slot', 'border', 'none'], ['button.mat-slot', 'background', 'none'], ['button.mat-slot', 'box-shadow', 'none'],
      ['button.mat-slot', 'transform', 'none'], ['button.mat-slot', '-webkit-touch-callout', 'none'], ['button.mat-slot', 'user-select', 'none'],
      // each slot a stacking context of its own: a slot's count and tick stay in it, and the focused slot's z-index lifts its ring over them
      ['button.mat-slot', 'isolation', 'isolate'],
      ['button.mat-slot:focus-visible', 'outline-color', 'var(--ink-focus)'], ['button.mat-slot:focus-visible', 'z-index', '1'],
      ['button.mat-slot:focus-visible .item-icon::after', 'opacity', '1'],
      ['button.mat-slot.marked::after', 'content', "''"], ['button.mat-slot.marked::after', 'background', 'rgb(0 0 0 / 0.4)'],
      ['.mat-slot-tick', 'animation', 'pop var(--dur-fast) var(--ease-pop)'], ['.mat-slot-tick::before', 'content', "''"],
      ['.mat-slots', 'grid-template-columns', 'repeat(auto-fill, 36px)'], ['.mat-slots', 'box-shadow', 'var(--bevel-inset)'],
      ['.mat-meter-fill', 'transform', 'scaleX(var(--done, 0))'], ['.mat-meter-fill', 'transition', 'transform var(--dur-slow) var(--ease-out)'],
      [".mat-view-toggle button[aria-pressed='true']", 'background', 'var(--btn-lo)'], [".mat-view-toggle button[aria-pressed='true']", 'box-shadow', 'var(--bevel-btn-down)'],
      [".mat-view-toggle button[aria-pressed='true']", 'color', 'var(--accent)'],
      ['.mat-grid', 'animation', 'fade-in var(--dur-base) var(--ease-out)'],
      ['.mat-grid-group h4', 'font', '600 15px/1.3 var(--font-pixel)'], ['.mat-grid-group h4', 'color', 'var(--ink-title)'],
      // [MG] §4.4: the two buttons of the toggle share one edge, the meter is a screen in a black edge, and the +N slot is a bare slot face with
      // its count in the middle
      ['.mat-view-toggle button + button', 'border-left', '0'], ['.mat-meter', 'background', 'var(--screen)'], ['.mat-meter', 'border', '2px solid var(--outline)'],
      ['.mat-meter-fill', 'transform-origin', 'left'], ['.mat-meter-fill', 'background', 'var(--screen-text)'],
      ['button.mat-slot-more', 'display', 'grid'], ['button.mat-slot-more', 'place-items', 'center'], ['button.mat-slot-more', 'background', 'var(--slot)'],
      ['button.mat-slot-more', 'box-shadow', 'var(--bevel-slot)'], ['button.mat-slot-more > .stack-count', 'position', 'static'],
    ]);
    // the toggle's negative margins make it no taller than the title's line (16 px at 1.3, which Chromium lays out a 64th of a pixel short,
    // P2-R13), so the head keeps the title's height and the List's rows stay where they were; centred, its small buttons stand past the line
    expect(declared('.materials-section h3', 'font')).toBe('600 16px/1.3 var(--font-pixel)');
    const smallButton = Number.parseFloat(declared(':where(button.small)', 'min-height') ?? '');
    const margin = Number.parseFloat(declared('.mat-view-toggle', 'margin-block') ?? '');
    expect(smallButton + 2 * margin).toBeLessThan(Math.floor(16 * 1.3 * 64) / 64);
    expect(margin).toBe(-4);
    // the tick's 1 px black edge, one drop-shadow a side, on the tick's own box: on the clipped mark itself the clip would cut it away
    expect(declared('.mat-slot-tick', 'filter')?.match(/drop-shadow\([^)]*\)/g)).toEqual(
      ['drop-shadow(1px 0 0 #000000)', 'drop-shadow(-1px 0 0 #000000)', 'drop-shadow(0 1px 0 #000000)', 'drop-shadow(0 -1px 0 #000000)']);
    expect(declared('.mat-slot-tick::before', 'clip-path'), 'the checkbox\'s pixel tick').toBe(declared(':where(input[type=checkbox])::before', 'clip-path'));
    expect(declared('.mat-slot-tick::before', 'background')).toBe('var(--screen-text)');
    // the +N slot's face comes after the reset of every slot, which it would lose to otherwise (one class and one tag each)
    expect(position('button.mat-slot-more')).toBeGreaterThan(position('button.mat-slot'));
    // the pins the grid leaves as they are: Phase 1's group heading and the lit slot's veil
    expect(declared('.mat-group h4', 'font-family')).toBeUndefined(); expect(declared('.mat-group h4', 'color')).toBe('var(--ink-muted)');
    expect(declarations(ruleBody(LIT_SLOT))).toEqual([['opacity', '1']]);
    // the meter fills by its transform alone (the mockup's width transition is a layout animation), and the grid moves nothing for ever
    expect(declared('.mat-meter-fill', 'width')).toBeUndefined();
    for (const selector of GRID_RULES) expect(declared(selector, 'animation') ?? '', selector).not.toMatch(/infinite/);
    // forced colours: a frame each slot keeps, but not while it shows the focus ring (R42's pattern), the tick and the fill in the Highlight (two rules:
    // a pseudo-element never shares a list with a plain selector, R28), the pressed toggle underlined; at the end of the block, each after its base
    expect(inQuery(FORCED, 'button.mat-slot:not(:focus-visible)')).toEqual([['outline', '1px solid ButtonText'], ['outline-offset', '-1px']]);
    // ledger ruling P2-R41: the slot's icon fills it, and its face (the theme's canvas) is painted over the button's own frame, which only the
    // +N slot, with no icon, shows; so a slot with an icon is framed by the icon's outline, painted with the icon and over its face
    expect(inQuery(FORCED, 'button.mat-slot > .item-icon')).toEqual([['outline', '1px solid CanvasText'], ['outline-offset', '-1px']]);
    expect(position(SLOT)).toBeLessThan(blocks.indexOf(forcedBlock().block));
    expect(inQuery(FORCED, '.mat-slot-tick::before')).toEqual([['background', 'Highlight']]);
    expect(inQuery(FORCED, '.mat-meter-fill')).toEqual([['background', 'Highlight']]);
    expect(inQuery(FORCED, ".mat-view-toggle button[aria-pressed='true']")).toEqual([['text-decoration', 'underline']]);
    expect(position('.mat-slot-tick::before, .mat-meter-fill')).toBe(-1);
    const { block, rules } = forcedBlock();
    for (const selector of ['button.mat-slot', '.mat-slot-tick::before', '.mat-meter-fill', ".mat-view-toggle button[aria-pressed='true']"]) {
      expect(position(selector), selector).toBeGreaterThan(-1);
      expect(position(selector), selector).toBeLessThan(blocks.indexOf(block));
    }
    const inBlock = (prelude: string): number => rules.findIndex((rule) => rule.prelude === prelude);
    expect(inBlock('button.mat-slot:not(:focus-visible)')).toBeGreaterThan(inBlock('.gt-arrow, .gt-arrow.on-chat'));
    // tokens and square corners, as every rule of the slots and Materials
    for (const selector of GRID_RULES) {
      expect(ruleBody(selector), selector).not.toMatch(OLD_ALIASES);
      expect(declared(selector, 'border-radius') ?? '0', selector).toBe('0');
    }
  });
});

// The key-numbers strip (Phase 2 spec §10, Task 7): five readout tiles at the top of the banners' box, each a screen in a black edge with its
// bevel, 52 px tall whichever font is in: a label row of 11 px Inter on a 14 px line, its qualifier at the right cut with an ellipsis, over the
// figure in VT323 28 px on a 26 px line, its digits as tall as the 24 px Pixelify the spec first gave it (§25, plan rulings digits-sizes and
// strip-figures), on one line and never shrunk, its unit VT323 15 px on the same 26 px line, and a rate in words in Inter 15 px. A changed
// tile's 2 px yellow frame fades once over its edge (opacity only, no fill mode: the frame rests at its own opacity 0) while its qualifier
// reads yellow. The strip takes 60 px with its margin where its five tiles make one row; the place it keeps while the plan is on its way is
// the strip's own grid of five empty blocks as tall as a tile, so it is as tall as the loaded strip at every width, wrapped or not (ledger
// ruling P2-R48). The plan's cost sentence beside it is hidden from sight by a sibling rule, as `.visually-hidden` hides (its own rule,
// `.plan-cost`, is pinned by the chrome case above and left as it is).
describe('the Machine GUI Phase 2: the key-numbers strip', () => {
  it('shows the key numbers on 52 px readout tiles, and hides the cost sentence beside them', () => {
    expectDeclared([
      ['.key-numbers', 'margin', '0 0 8px'],
      ['.key-numbers > dl', 'display', 'grid'], ['.key-numbers > dl', 'grid-template-columns', 'repeat(auto-fit, minmax(140px, 1fr))'],
      ['.key-numbers > dl', 'gap', '8px'], ['.key-numbers > dl', 'margin', '0'],
      ['.key-number', 'position', 'relative'], ['.key-number', 'height', '52px'], ['.key-number', 'padding', '4px 10px'],
      ['.key-number', 'background', 'var(--screen)'], ['.key-number', 'border', '2px solid var(--outline)'], ['.key-number', 'box-shadow', 'var(--bevel-screen)'],
      ['.key-number dt', 'display', 'flex'], ['.key-number dt', 'justify-content', 'space-between'], ['.key-number dt', 'gap', '6px'],
      ['.key-number dt', 'font', '11px/14px var(--font-ui)'], ['.key-number dt', 'text-transform', 'uppercase'], ['.key-number dt', 'letter-spacing', '0.06em'],
      ['.key-number dt', 'color', 'var(--screen-muted)'],
      // the label keeps its one line: only the qualifier gives way, cut with an ellipsis
      ['.key-number dt', 'white-space', 'nowrap'],
      ['.key-number-sub', 'min-width', '0'], ['.key-number-sub', 'overflow', 'hidden'], ['.key-number-sub', 'text-overflow', 'ellipsis'],
      ['.key-number-sub', 'white-space', 'nowrap'], ['.key-number-sub', 'text-transform', 'none'], ['.key-number-sub', 'letter-spacing', '0'],
      ['.key-number dd', 'margin', '0'], ['.key-number dd', 'font', '28px/26px var(--font-digits)'], ['.key-number dd', 'font-size-adjust', 'cap-height 0.56'],
      ['.key-number dd', 'color', 'var(--screen-text)'], ['.key-number dd', 'font-variant-numeric', 'tabular-nums'],
      // a figure on one line, as the Compare tiles' since 4bef36c, and never shrunk (plan ruling strip-figures): no size container, no clamp
      ['.key-number dd', 'white-space', 'nowrap'], ['.key-number dd', 'overflow', 'hidden'], ['.key-number dd', 'text-overflow', 'ellipsis'],
      ['.key-number-unit', 'margin-left', '4px'], ['.key-number-unit', 'font', '15px/26px var(--font-digits)'],
      ['.key-number-unit', 'font-size-adjust', 'cap-height 0.56'], ['.key-number-unit', 'color', 'var(--screen-muted)'],
      ['.key-number dd.key-number-words', 'font', '15px/26px var(--font-ui)'],
      ['.key-number.changed .key-number-sub', 'color', 'var(--accent)'],
      ['.key-number-flash', 'position', 'absolute'], ['.key-number-flash', 'inset', '-2px'], ['.key-number-flash', 'border', '2px solid var(--accent)'],
      ['.key-number-flash', 'pointer-events', 'none'], ['.key-number-flash', 'animation', 'flash-out 700ms var(--ease-out)'], ['.key-number-flash', 'opacity', '0'],
      ['.key-numbers-wait', 'display', 'grid'], ['.key-numbers-wait', 'margin', '0 0 8px'], ['.skeleton-strip .skeleton-block', 'height', '52px'],
      [STRIP_HIDE, 'position', 'absolute'], [STRIP_HIDE, 'width', '1px'], [STRIP_HIDE, 'height', '1px'], [STRIP_HIDE, 'overflow', 'hidden'],
      [STRIP_HIDE, 'clip-path', 'inset(50%)'], [STRIP_HIDE, 'white-space', 'nowrap'],
    ]);
    // the tile adds up to its 52 px, line boxes in px: 2 x 2 of edge, 2 x 4 of padding, the label's 14 px line and the figure's 26 px line;
    // the unit sits on the figure's line, and the words take it too
    const px = (value: string | undefined): number => Number.parseFloat(value ?? '');
    const line = (selector: string): number => px(/\/(\S+)/.exec(declared(selector, 'font') ?? '')?.[1]);
    const tile = 2 * px(declared('.key-number', 'border')) + 2 * px(declared('.key-number', 'padding')) + line('.key-number dt') + line('.key-number dd');
    expect(tile).toBe(px(declared('.key-number', 'height')));
    expect([line('.key-number-unit'), line('.key-number dd.key-number-words')]).toEqual([line('.key-number dd'), line('.key-number dd')]);
    expect(declared('.key-number dd', 'container-type')).toBeUndefined(); expect(declared('.key-number dd', 'font-size')).toBeUndefined();
    // with its margin the strip takes 60 px where its tiles make one row (spec §3.6: +27.7 px against the 32.3 px cost line it replaces), and
    // the place it keeps while the plan is on its way is the strip's own grid (its columns and gap) of blocks as tall as a tile, with no height
    // of its own, so it takes as much at every width and the views below never move when the figures come (ledger ruling P2-R48)
    expect(px(declared('.key-number', 'height')) + px(declared('.key-numbers', 'margin')?.split(' ')[2])).toBe(60);
    // (ledger ruling P2-R50b: the strip's skeleton fills the wait box, and its blocks, the grid's items, carry the tile's 52 px)
    expect(px(declared('.skeleton-strip .skeleton-block', 'height')) + px(declared('.key-numbers-wait', 'margin')?.split(' ')[2])).toBe(60);
    for (const property of ['grid-template-columns', 'gap']) expect(declared('.key-numbers-wait', property), property).toBe(declared('.key-numbers > dl', property));
    expect(declared('.skeleton-strip .skeleton-block', 'height')).toBe(declared('.key-number', 'height'));
    expect(declared('.key-numbers-wait', 'height')).toBeUndefined();
    // the flash: once, well under 5 s, and resting at the frame's own opacity, so no fill mode; it fades from full and takes no pointer
    expect(declared('.key-number-flash', 'animation')).not.toMatch(/infinite|forwards|backwards|both/);
    expect(ruleBody('@keyframes flash-out')).toMatch(/^from \{ opacity: 1;? \}$/);
    // the sentence is hidden as `.visually-hidden` hides, declaration for declaration, and the rule of the sentence itself is left alone
    expect(declarations(ruleBody(STRIP_HIDE))).toEqual(declarations(ruleBody('.visually-hidden')));
    expect(declarations(ruleBody('.plan-cost'))).toEqual([
      ['margin', '0 0 var(--gap)'], ['color', 'var(--ink)'], ['font-family', 'var(--font-ui)'], ['font-size', '14px'], ['font-variant-numeric', 'tabular-nums'],
    ]);
    // the strip's rules sit after the cost line's and before the Compare card's (the box's order: the strip, the sentence, the banner, the card)
    for (const selector of STRIP_RULES) {
      expect(position(selector), selector).toBeGreaterThan(position('.plan-cost'));
      expect(position(selector), selector).toBeLessThan(position(".compare-toggle[aria-expanded='true']"));
      expect(ruleBody(selector), selector).not.toMatch(OLD_ALIASES);
      expect(declared(selector, 'border-radius') ?? '0', selector).toBe('0');
    }
  });
});

// Skeletons and the progress arrow (Phase 2 spec §11, Task 8): beside every loading line an aria-hidden skeleton, blocks of the skeleton grey
// (on a well, its own darker grey) in the shape of what is coming, every height in px, so nothing jumps when the data comes and no late font
// changes a height; a sheen passes over each block three times in 4.2 s (WCAG 2.2.2) and rests off its left edge with no fill mode, so none
// shows. The Compare card's two (plan ruling compare-skeletons) take its own grids: three frames in its columns' grid, each framed as a column
// is, its six blocks in the tiles' grid, so they fall as the tiles will and a frame is as tall as its blocks, two a row or stacked. The strip's
// draws no box of its own: its five blocks are the wait box's grid's (ledger ruling P2-R48). In forced colours the blocks are GrayText.
describe('the Machine GUI Phase 2: skeletons', () => {
  /** Every rule, at any depth, whose selector names a skeleton class. */
  const skeletonRules = (): Block[] => blocks.filter((b) => !b.prelude.startsWith('@') && /\.skeleton(?![\w-])|\.skeleton-[a-z]/.test(b.prelude));

  it('draws skeletons whose sheen passes three times and rests off their edge', () => {
    expectDeclared([
      [SKELETON_BLOCK, 'position', 'relative'], [SKELETON_BLOCK, 'overflow', 'hidden'], [SKELETON_BLOCK, 'background', 'var(--skeleton)'],
      [SHEEN, 'content', "''"], [SHEEN, 'position', 'absolute'], [SHEEN, 'inset', '0'],
      [SHEEN, 'background', 'linear-gradient(90deg, transparent, var(--sheen), transparent)'],
      [SHEEN, 'transform', 'translateX(-100%)'], [SHEEN, 'animation', 'sheen 1.4s var(--ease-out) 3'],
      [SKELETON_WELLS, 'background', 'var(--well)'], [SKELETON_WELLS, 'border', '2px solid var(--outline)'], [SKELETON_WELLS, 'box-shadow', 'var(--bevel-well)'],
      ['.skeleton-diagram .skeleton-block', 'background', 'var(--skeleton-well)'],
      // spec §11.2's geometry, the builder's (§21): a column of blocks 8 px apart, 18 px each unless a shape sizes them
      ['.skeleton', 'display', 'flex'], ['.skeleton', 'flex-direction', 'column'], ['.skeleton', 'gap', '8px'], [SKELETON_BLOCK, 'height', '18px'],
      ['.skeleton-cards .skeleton-block', 'height', '58px'], ['.skeleton-cards', 'gap', '10px'], ['.skeleton-cards', 'margin', '0 0 20px'],
      ['.skeleton-project .skeleton-block:nth-child(1)', 'width', '40%'], ['.skeleton-project .skeleton-block:nth-child(1)', 'height', '36px'],
      ['.skeleton-project .skeleton-block:nth-child(2)', 'height', '52px'], ['.skeleton-project .skeleton-block:nth-child(3)', 'height', '360px'],
      ['.skeleton-diagram', 'display', 'grid'], ['.skeleton-diagram', 'grid-template-columns', 'repeat(3, 110px)'], ['.skeleton-diagram', 'gap', '40px'],
      ['.skeleton-diagram', 'align-content', 'center'], ['.skeleton-diagram', 'height', '240px'], ['.skeleton-diagram', 'padding', '20px'],
      ['.skeleton-diagram .skeleton-block', 'height', '70px'],
      ['.skeleton-scene', 'height', '360px'], ['.skeleton-scene', 'padding', '20px'], ['.skeleton-scene .skeleton-block', 'flex', '1'],
      ['.skeleton-lines .skeleton-block:nth-child(even)', 'width', '70%'],
    ]);
    // the sheen is finite, within 5 s, and rests where it starts, off the block's left edge: its own transform, no fill mode
    const [, duration, , count] = (declared(SHEEN, 'animation') ?? '').split(' ');
    expect(Number.parseFloat(duration ?? '') * Number(count)).toBeLessThanOrEqual(5);
    expect(declared(SHEEN, 'animation')).not.toMatch(/forwards|backwards|both|infinite/);
    expect(ruleBody('@keyframes sheen')).toMatch(/^to \{ transform: translateX\(100%\);? \}$/);
    // every height in px: nothing jumps when the data comes, and no late font changes one (spec §3.6)
    const rules = skeletonRules();
    expect(rules.length, 'the scan sees the skeleton rules').toBeGreaterThanOrEqual(SKELETON_RULES.length + COMPARE_SKELETON_RULES.length);
    for (const rule of rules) {
      for (const [name, value] of declarations(rule.inner)) if (name === 'height') expect(value, rule.prelude).toMatch(/^\d+(\.\d+)?px$/);
    }
    // a shape's display and gap come after the column every skeleton is, which they replace (one class each); the cards are as far apart as
    // the list's cards
    for (const shape of ['.skeleton-cards', '.skeleton-strip', '.skeleton-diagram', '.skeleton-readouts', '.skeleton-compare']) expect(position(shape), shape).toBeGreaterThan(position('.skeleton'));
    for (const property of ['gap', 'margin']) expect(declared('.skeleton-cards', property), property).toBe(declared('.cards', property));
    // the Compare card's (plan ruling compare-skeletons): three frames in the card's columns' grid, each framed as a column is ...
    expectDeclared([
      ['.skeleton-compare', 'display', 'grid'], ['.skeleton-compare', 'grid-template-columns', 'repeat(auto-fit, minmax(220px, 1fr))'], ['.skeleton-compare', 'gap', '12px'],
      ['.skeleton-readouts', 'display', 'grid'], ['.skeleton-readouts', 'gap', '4px'],
      ['.skeleton-readouts', 'grid-template-columns', 'repeat(auto-fit, minmax(min(160px, 100%), 1fr))'],
      ['.skeleton-readouts .skeleton-block', 'height', '55px'],
      ['.skeleton-compare > .skeleton-readouts', 'border', '2px solid'], ['.skeleton-compare > .skeleton-readouts', 'padding', '35.5px 10px 52px'],
    ]);
    expect(declared('.skeleton-compare', 'grid-template-columns')).toBe(declared('.compare-columns', 'grid-template-columns'));
    expect(declared('.skeleton-compare', 'gap')).toBe(declared('.compare-columns', 'gap'));
    expect(declared('.skeleton-readouts', 'grid-template-columns')).toBe(declared('.compare-rows', 'grid-template-columns'));
    expect(declared('.skeleton-readouts', 'gap')).toBe(declared('.compare-rows', 'gap'));
    expect(declared('.skeleton-compare > .skeleton-readouts', 'border-color')).toBe(declared('.compare-column', 'border-color'));
    // ... the room of the column's title above its tiles and of its button below: its 8 px padding, the 15 px/1.3 title and the 8 px gap above,
    // the gap, the 36 px button and the padding below, and its 10 px at each side; so a frame's grid is as wide as a loaded column's tiles
    const px = (value: string | undefined): number => Number.parseFloat(value ?? '');
    const [padTop, padSide] = (declared('.compare-column', 'padding') ?? '').split(' ').map(px);
    const gap = px(declared('.compare-column', 'gap'));
    const title = 15 * 1.3;
    expect(declared('.compare-column > h4', 'font')).toBe('600 15px/1.3 var(--font-pixel)');
    expect((declared('.skeleton-compare > .skeleton-readouts', 'padding') ?? '').split(' ').map(px))
      .toEqual([padTop! + title + gap, padSide, gap + px(declared(':where(button)', 'min-height')) + padTop!]);
    // ... and six blocks as tall as a tile, to the pixel: 6 + 14.3 + 2 + 26.390625 + 6 (its padding, label line, gap, value line, padding)
    const tile = 2 * 6 + 11 * 1.3 + 2 + 26.390625;
    expect(declared('.compare-row', 'padding')).toBe('6px 8px'); expect(declared('.compare-row', 'gap')).toBe('2px');
    expect(Math.abs(px(declared('.skeleton-readouts .skeleton-block', 'height')) - tile)).toBeLessThan(1);
    // no height of its own: a frame is as tall as its blocks, two a row or stacked as the tiles will be
    for (const rule of rules.filter((r) => r.prelude.includes('.skeleton-compare'))) {
      for (const name of ['height', 'grid-template-rows']) expect(declarations(rule.inner).map(([n]) => n), `${rule.prelude} { ${name} }`).not.toContain(name);
    }
    // tokens and square corners, as every Phase 2 rule; and no name of add-on 17's (`skeleton-compare` is not a `.compare-` class)
    for (const selector of [...SKELETON_RULES, ...COMPARE_SKELETON_RULES]) {
      expect(ruleBody(selector), selector).not.toMatch(OLD_ALIASES);
      expect(declared(selector, 'border-radius') ?? '0', selector).toBe('0');
      expect(ADDON17_RULE.test(selector), selector).toBe(false);
    }
    // forced colours: the blocks' grey, a background the theme paints like what they lie on, is GrayText (the well's blocks' own rule
    // out-ranks a bare .skeleton-block, so the block names it too), after the rules it repaints
    const FORCED_BLOCKS = '.skeleton-block, .skeleton-diagram .skeleton-block, .skeleton-strip .skeleton-block';
    expect(inQuery(FORCED, FORCED_BLOCKS)).toEqual([['background', 'GrayText']]);
    const { block, rules: forced } = forcedBlock();
    for (const selector of [SKELETON_BLOCK, '.skeleton-diagram .skeleton-block', '.skeleton-strip .skeleton-block']) {
      expect(position(selector), selector).toBeLessThan(blocks.indexOf(block));
    }
    const inBlock = (prelude: string): number => forced.findIndex((rule) => rule.prelude === prelude);
    expect(inBlock(FORCED_BLOCKS)).toBe(forced.length - 1);
  });

  it('puts the strip\'s skeleton blocks in the wait box\'s own grid, as tall as a tile and in its dark face (ledger rulings P2-R48, P2-R53)', () => {
    // the skeleton draws no box: its blocks are the grid's items, so the wait box keeps the strip's height at every width, wrapped or not
    expectDeclared([['.skeleton-strip', 'display', 'contents'], ['.skeleton-strip .skeleton-block', 'height', '52px']]);
    expect(declared('.skeleton-strip .skeleton-block', 'height')).toBe(declared('.key-number', 'height'));
    // ledger ruling P2-R50b: the wait box's own rule for its blocks sized nothing once the skeleton filled it, and is gone
    expect(position('.key-numbers-wait > div')).toBe(-1);
    // ledger ruling P2-R53: in the tiles' own dark face, in both looks, with a shimmer of the screen's lighter edge, so the strip does not
    // flash from the skeleton grey to the dark tiles when the figures come
    expectDeclared([
      ['.skeleton-strip .skeleton-block', 'background', 'var(--screen)'],
      ['.skeleton-strip .skeleton-block::after', 'background', 'linear-gradient(90deg, transparent, var(--screen-lo), transparent)'],
    ]);
    expect(declared('.skeleton-strip .skeleton-block', 'background')).toBe(declared('.key-number', 'background'));
    // forced colours: GrayText as every skeleton block, the strip's own rule out-ranking a bare .skeleton-block, so the block names it too
    expect(inQuery(FORCED, '.skeleton-block, .skeleton-diagram .skeleton-block, .skeleton-strip .skeleton-block')).toEqual([['background', 'GrayText']]);
  });

  // ledger rulings P2-R18 and P2-R51: a plan event (every replan of the project, and other projects' surplus) shows the busy line until the plan
  // is fetched again. In the flow it pushed everything under the banners down the page and back (24.3 px under the banner's other lines, the
  // whole banner's 60.3 px alone), which threw drags off the pointer (P2-R16) and made tests race; hung over the end of the tab strip it hid
  // whole tabs wherever they fill the strip. So it sits on the key-numbers strip's top-right corner, over that tile's label row, which holds
  // no control and no figure, and takes no room; with no strip it is clipped from sight, for a screen reader only.
  it('sets the plan\'s busy line on the strip\'s top-right corner, out of the flow, and clips it from sight where there is no strip', () => {
    const px = (value: string | undefined): number => Number.parseFloat(value ?? '');
    // the banners' box is the line's containing block, and the strip is its first child: its top right is the strip's. It draws no box of
    // its own (no block formatting context: its height is what it was, P2-R51)
    expectDeclared([['.project-banners', 'position', 'relative']]);
    expect(declared('.project-banners', 'display')).toBeUndefined();
    // with no strip, the line is clipped as `.visually-hidden` clips, declaration for declaration
    expect(declarations(ruleBody(BUSY_LINE))).toEqual(declarations(ruleBody('.visually-hidden')));
    expectDeclared([
      // with the strip: on its top-right corner, over the label row of that tile, the line's whole box shown again
      [BUSY_CHIP, 'top', '0'], [BUSY_CHIP, 'right', '0'], [BUSY_CHIP, 'z-index', '2'], [BUSY_CHIP, 'width', 'auto'], [BUSY_CHIP, 'height', '20px'],
      [BUSY_CHIP, 'overflow', 'visible'], [BUSY_CHIP, 'clip-path', 'none'], [BUSY_CHIP, 'margin', '0'], [BUSY_CHIP, 'padding', '0 3px'],
      [BUSY_CHIP, 'display', 'flex'], [BUSY_CHIP, 'align-items', 'center'], [BUSY_CHIP, 'pointer-events', 'none'], [BUSY_CHIP, 'white-space', 'nowrap'],
      // in the label's own words' size and line, Inter 11 px on 14 px
      [BUSY_CHIP, 'font', '11px/14px var(--font-ui)'],
      // a chat box of its own, as the banner it came from, over the page's colour, so the label row under it does not show through; its top
      // and right edges are the tile's own black edge, so it draws the other two only
      [BUSY_CHIP, 'background', 'linear-gradient(var(--chat), var(--chat)) var(--page)'],
      [BUSY_CHIP, 'border-left', '2px solid var(--outline)'], [BUSY_CHIP, 'border-bottom', '2px solid var(--outline)'],
      // a banner that says nothing else draws no box, and still appears without the entrance
      [BUSY_ALONE, 'animation', 'none'], [BUSY_ALONE, 'margin', '0'], [BUSY_ALONE, 'padding', '0'], [BUSY_ALONE, 'border', '0'], [BUSY_ALONE, 'background', 'none'],
    ]);
    expect(declared(BUSY_CHIP, 'font')).toBe(declared('.key-number dt', 'font'));
    // as tall as a tile's edge, padding and label line together: it never reaches the figure under them
    const line = (selector: string): number => px(/\/(\S+)/.exec(declared(selector, 'font') ?? '')?.[1]);
    expect(px(declared(BUSY_CHIP, 'height'))).toBe(px(declared('.key-number', 'border')) + px(declared('.key-number', 'padding')) + line('.key-number dt'));
    expect(declared(BUSY_CHIP, 'border')).toBeUndefined();
    expect(declared('.key-number', 'border')).toBe('2px solid var(--outline)');
    // the GT arrow fits inside its edge
    expect(px(declared('.gt-arrow', 'height'))).toBeLessThanOrEqual(px(declared(BUSY_CHIP, 'height')) - px(declared(BUSY_CHIP, 'border-bottom')));
    // over the tile, under the drawer's dimmed page
    const z = Number(declared(BUSY_CHIP, 'z-index'));
    expect(declared('.key-number', 'z-index')).toBeUndefined();
    expect(z).toBeLessThan(Number(declaredIn(NARROW, '.drawer-backdrop', 'z-index')));
    // no entrance: it shows on every replan (opacity and transform would be the only things it could move)
    for (const rule of [BUSY_LINE, BUSY_CHIP]) {
      expect(declared(rule, 'animation'), rule).toBeUndefined(); expect(declared(rule, 'transition'), rule).toBeUndefined();
    }
  });
});

// Toasts (Phase 2 spec §12, Task 9a): what was just done, in chat boxes stacked in the window's bottom-right corner, 16 px in, at most 360 px
// wide (less on a phone: 16 px from each edge); fixed, so they take no room on the page (spec §3.6), and under every layer: the drawer's dimmed
// page and the drawer, the modal and the tooltip. The region takes no pointer, so its empty part never stands between a click and what is
// under it; a toast does, but for one that is leaving. Toasts are sentences, so Inter (R35), on a fixed 18 px line (spec §3.6); a toast is a row
// as tall as its edge, its padding and its small buttons. It pops in once (`toast-in`, --ease-pop) and, as the tooltip does, keeps the last frame
// of its exit alone, being removed once that has run (`toast-out`, `forwards`).
describe('the Machine GUI Phase 2: toasts', () => {
  it('draws toasts as chat boxes in a corner, under every layer', () => {
    expectDeclared([
      [TOASTS, 'position', 'fixed'], [TOASTS, 'right', '16px'], [TOASTS, 'bottom', '16px'], [TOASTS, 'z-index', '40'], [TOASTS, 'pointer-events', 'none'],
      [TOASTS, 'max-width', 'min(360px, 100vw - 32px)'],
      ['.toasts > ol', 'list-style', 'none'], ['.toasts > ol', 'margin', '0'], ['.toasts > ol', 'padding', '0'], ['.toasts > ol', 'display', 'flex'],
      ['.toasts > ol', 'flex-direction', 'column'], ['.toasts > ol', 'gap', '8px'],
      [TOAST, 'pointer-events', 'auto'], [TOAST, 'background', 'var(--chat)'], [TOAST, 'border', '2px solid var(--outline)'],
      [TOAST, 'font', '13px/18px var(--font-ui)'], [TOAST, 'animation', 'toast-in var(--dur-slow) var(--ease-pop)'],
      [TOAST, 'display', 'flex'], [TOAST, 'align-items', 'center'], [TOAST, 'gap', '8px'], [TOAST, 'min-height', '44px'], [TOAST, 'padding', '6px 8px 6px 12px'],
      ['.toast > span', 'flex', '1'], ['.toast > span', 'min-width', '0'], ['.toast > span', 'overflow-wrap', 'anywhere'],
      [TOAST_LEAVING, 'pointer-events', 'none'],
      // fix round 1, M4: the entrance stays first in the leaving rule's list, so a toast that goes during it goes from where it has got to
      // (the entrance runs on with its own time, and the exit, which has no `from`, starts from it); the exit is the brief's
      [TOAST_LEAVING, 'animation', 'toast-in var(--dur-slow) var(--ease-pop), toast-out var(--dur-exit) var(--ease-in) forwards'],
    ]);
    expect(declared(TOAST_LEAVING, 'animation')).toBe(`${declared(TOAST, 'animation')}, toast-out var(--dur-exit) var(--ease-in) forwards`);
    // under every layer: the drawer's dimmed page (50) and the drawer (60), the modal (100) and the tooltip (200)
    const z = Number(declared(TOASTS, 'z-index'));
    const layers: Array<[string, string | undefined]> = [
      ['the drawer\'s dimmed page', declaredIn(NARROW, '.drawer-backdrop', 'z-index')], ['the drawer', declaredIn(NARROW, '.settings-panel', 'z-index')],
      ['the modal', declared('.modal-backdrop', 'z-index')], ['the tooltip', declared(NEI_TIP, 'z-index')],
    ];
    for (const [layer, above] of layers) expect(z, layer).toBeLessThan(Number(above));
    // a chat box in the light ink of the dark boxes, appended after the group's 7 pinned members
    expect(inkGroup('.banner').prelude.split(', ').slice(7)).toContain(TOAST);
    expect(inkGroup('.tab-panel').prelude.split(', ')).not.toContain(TOAST);
    // it pops in once from 12 px below at 96 %, and sinks back as it goes, its exit kept to the end: it is removed once that has run
    expect(ruleBody('@keyframes toast-in')).toMatch(/^from \{ opacity: 0; transform: translateY\(12px\) scale\(0\.96\);? \}$/);
    expect(ruleBody('@keyframes toast-out')).toMatch(/^to \{ opacity: 0; transform: translateY\(12px\) scale\(0\.96\);? \}$/);
    expect(declared(TOAST, 'animation')).not.toMatch(/infinite|forwards|backwards|both/);
    // every height in px (spec §3.6): the 18 px line, and a row as tall as its edge, its padding and a small button (2 + 6 + 28 + 6 + 2)
    const px = (value: string | undefined): number => Number.parseFloat(value ?? '');
    const [padTop, , padBottom] = (declared(TOAST, 'padding') ?? '').split(' ').map(px);
    expect(2 * px(declared(TOAST, 'border')) + padTop! + padBottom! + px(declared(':where(button.small)', 'min-height'))).toBe(px(declared(TOAST, 'min-height')));
    // tokens and square corners, as every Phase 2 rule
    for (const selector of TOAST_RULES) {
      expect(ruleBody(selector), selector).not.toMatch(OLD_ALIASES);
      expect(declared(selector, 'border-radius') ?? '0', selector).toBe('0');
    }
    // forced colours: a contrast theme keeps the edge, a border, in its text colour, and the chat face's 82 % (Chromium keeps a background's
    // alpha), which would let what a toast floats over show through its words: the face is the theme's canvas, whole, after the rule it repaints
    expect(inQuery(FORCED, TOAST)).toEqual([['background', 'Canvas']]);
    expect(position(TOAST)).toBeLessThan(blocks.indexOf(forcedBlock().block));
  });
});
