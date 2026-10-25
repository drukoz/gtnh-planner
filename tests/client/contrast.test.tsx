// WCAG contrast of the Machine GUI palette (restyle plan Phase 1 Task 1, design spec §4 and §6; Phase 2 spec §3.5): every pair of
// a text and what it sits on, and of a graphic and what it lies on, in one table by token name. The tokens are read from styles.css
// itself, for the light look and for the dark one, so a pair is measured at the colours the page draws in each (this closes Phase 1's
// F4, "pairs hand-copied"): text needs 4.5:1 (AA), a graphic or a component's edge 3:1 (WCAG 1.4.11). A guard checks that every pair
// measured before Phase 2 is still measured, at the same light colours (contrast-phase1.json). The reason cases further down keep the
// pairs that fall short, as literals: they say why the palette is what it is.

import { readFileSync } from 'node:fs';
import { describe, it, expect } from 'vitest';
import { DYE_HEX } from '../../src/shared/layout/enderio.ts';
import type { DyeColor } from '../../src/shared/types/layout.ts';
import { cssBlocks, resolveToken, themeTokens, type Look } from './css-blocks.ts';

const AA = 4.5;
const GRAPHICS = 3;

/** One 8-bit channel of `#rrggbb` (the pair of hex digits at `from`) as linear light. */
function channel(hex: string, from: number): number {
  const c = Number.parseInt(hex.slice(from, from + 2), 16) / 255;
  return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
}

/** WCAG relative luminance of `#rrggbb`. */
function luminance(hex: string): number {
  return 0.2126 * channel(hex, 1) + 0.7152 * channel(hex, 3) + 0.0722 * channel(hex, 5);
}

/** WCAG contrast ratio of two colours, from 1 to 21. */
function ratio(a: string, b: string): number {
  const [la, lb] = [luminance(a), luminance(b)];
  return (Math.max(la, lb) + 0.05) / (Math.min(la, lb) + 0.05);
}

const TIERS: [string, string][] = [
  ['ULV', '#9a9a9a'], ['LV', '#dddddd'], ['MV', '#55ffff'], ['HV', '#ffaa00'], ['EV', '#ff55ff'],
  ['IV', '#8c9cff'], ['LuV', '#ff8cff'], ['ZPM', '#ff5555'], ['UV', '#55dddd'], ['UHV', '#ff6b6b'],
  ['UEV', '#55ff55'], ['UIV', '#00cc00'], ['UMV', '#ffff55'], ['UXV', '#8080ff'], ['MAX', '#ff5555'],
];
/** The channel dyes too dark for the dark casing, which the view puts in a panel-grey one (design spec §7). */
const DARK_DYES: readonly DyeColor[] = ['black', 'brown', 'blue', 'gray', 'green', 'purple', 'red'];

// ---- what the page draws, in each look ----

const blocks = cssBlocks(readFileSync(new URL('../../src/client/styles.css', import.meta.url), 'utf8'));
/** Each look's tokens, as the stylesheet declares them. */
const LOOK_TOKENS: Readonly<Record<Look, ReadonlyMap<string, string>>> = { light: themeTokens(blocks, 'light'), dark: themeTokens(blocks, 'dark') };

/**
 * What a pair measures: a token `--x`; a literal `#rrggbb`, which the stylesheet draws the same in both looks; or `over`, a translucent
 * colour, alpha-composited on `on`.
 */
type Paint = string | { over: Paint; on: Paint };
/** [what it is, the text or graphic, what it sits on, the least ratio it needs, the looks it holds in (both when absent)] */
type Pair = [what: string, fg: Paint, bg: Paint, min: number, looks?: readonly Look[]];

/** The channels and the alpha of a CSS colour: `#rgb`, `#rrggbb`, `rgb(r g b / a)` or `rgba(r, g, b, a)`. */
function parse(css: string): [number, number, number, number] {
  const hex = /^#([0-9a-f]{3}|[0-9a-f]{6})$/i.exec(css)?.[1];
  if (hex !== undefined) {
    const digits = hex.length === 3 ? [...hex].map((d) => d + d).join('') : hex;
    return [Number.parseInt(digits.slice(0, 2), 16), Number.parseInt(digits.slice(2, 4), 16), Number.parseInt(digits.slice(4, 6), 16), 1];
  }
  const fn = /^rgba?\(\s*([\d.]+)(?:\s*,\s*|\s+)([\d.]+)(?:\s*,\s*|\s+)([\d.]+)\s*(?:[,/]\s*([\d.]+)\s*)?\)$/.exec(css);
  if (fn !== null) return [Number(fn[1]), Number(fn[2]), Number(fn[3]), fn[4] === undefined ? 1 : Number(fn[4])];
  throw new Error(`"${css}" is not a colour this test can read`);
}

/** A paint's channels and alpha in a look: a token through that look's tokens, a composite channel by channel (and so opaque). */
function channels(look: Look, paint: Paint): [number, number, number, number] {
  if (typeof paint === 'string') return parse(resolveToken(LOOK_TOKENS[look], paint.startsWith('--') ? `var(${paint})` : paint));
  const [r, g, b, a] = channels(look, paint.over);
  const under = channels(look, paint.on);
  if (under[3] !== 1) throw new Error(`${JSON.stringify(paint.on)} is translucent: composite it on what it lies over`);
  const over = (c: number, i: 0 | 1 | 2): number => Math.round(c * a + under[i] * (1 - a));
  return [over(r, 0), over(g, 1), over(b, 2), 1];
}

/** A paint as the `#rrggbb` it is in a look; a translucent one must be composited on what it lies over. */
function colour(look: Look, paint: Paint): string {
  const [r, g, b, a] = channels(look, paint);
  if (a !== 1) throw new Error(`${JSON.stringify(paint)} is translucent: composite it on what it lies over`);
  return `#${[r, g, b].map((c) => Math.round(c).toString(16).padStart(2, '0')).join('')}`;
}

/** A paint for a failure message: `--chat over --panel`. */
const named = (paint: Paint): string => (typeof paint === 'string' ? paint : `${named(paint.over)} over ${named(paint.on)}`);

// ---- the pairs ----

/** A chat box (82 % black) over the panel it sits on. */
const CHAT_ON_PANEL: Paint = { over: '--chat', on: '--panel' };
/** The NEI tooltip (94 % of #100010) over the lightest a map or the 3D scene and its sky can put under it, white. */
const TIP_ON_WHITE: Paint = { over: '--tip-bg', on: '#ffffff' };
/** The panel under the white veil of a pointed-at map row. */
const VEILED_PANEL: Paint = { over: '--veil', on: '--panel' };
/** The ink of the stone: the page's, set on :root. */
const PAGE_INKS = ['--ink', '--ink-muted', '--ink-title', '--ink-link', '--ink-error', '--ink-ok', '--ink-warn'];
/** The ink of a panel: the tokens the panel group reads. */
const PANEL_INKS = ['--text', '--text-muted', '--title', '--link', '--panel-error', '--panel-ok', '--panel-warn'];
/** The ink of a dark box (a chat box, a screen, a chip): the literals of the dark-box group, the same in both looks. */
const DARK_INKS = ['#ffffff', '#aaaaaa', '#ffff55', '#ff5555', '#55ff55', '#ffaa00'];
const FLOW_FILLS: [string, string][] = [
  ['new', '--flow-new'], ['owned', '--flow-owned'], ['import', '--flow-import'], ['missing', '--flow-missing'], ['target', '--flow-out'],
  ['left over', '--flow-sink'], ['supporting line', '--flow-line'],
];
/** The boxes whose rows can show an issue: not a left over, which is never short of anything. */
const ISSUE_FILLS = FLOW_FILLS.filter(([box]) => box !== 'left over');
const CONN_FILLS: [string, string][] = [
  ['machine', '--conn-box'], ['chest', '--conn-chest'], ['interface', '--conn-interface'], ['source', '--conn-source'], ['hookup', '--conn-hookup'],
];

/** Every pair of the page, by token name; each later task appends its own. */
const PAIRS: Pair[] = [
  // the palette (Phase 1 Task 1): the ink of each surface, the button faces, the tabs and the tier chips
  ...PAGE_INKS.map((ink): Pair => ['page ink', ink, '--page', AA]),
  ...PAGE_INKS.map((ink): Pair => ['page ink on the check squares of the stone', ink, '--page-check', AA]),
  ...PANEL_INKS.map((ink): Pair => ['panel ink', ink, '--panel', AA]),
  ...DARK_INKS.map((ink): Pair => ['dark ink', ink, '--screen', AA]),
  ...TIERS.map(([tier, text]): Pair => [`tier ${tier}`, text, '--screen', AA]),
  ['button', '#ffffff', '--btn', AA], ['button hover', '#ffffff', '--btn-hover', AA],
  ['danger button', '#ffffff', '--danger-face', AA], ['danger button hover', '#ffffff', '--danger-face-hover', AA],
  ['primary button', '--accent', '--btn', AA],
  ['unselected tab', '--tab-ink', '--tab-face', AA], ['hovered tab', '--tab-ink', '--tab-face-hover', AA], ['selected tab', '--text', '--panel', AA],

  // the Flow diagram (Phase 1 Task 6, design spec §7: "text #303030 on all, ≥ 4.5:1"): every box fill with the text a box draws on it,
  // then the light text on the dark canvas and in the chat boxes
  ...FLOW_FILLS.map(([box, fill]): Pair => [`${box} box text`, '--text', fill, AA]),
  ...ISSUE_FILLS.map(([box, fill]): Pair => [`${box} box lines and rates`, '--text-muted', fill, AA]),
  ...ISSUE_FILLS.map(([box, fill]): Pair => [`${box} box row with no source`, '--flow-error', fill, AA]),
  ...ISSUE_FILLS.map(([box, fill]): Pair => [`${box} box row made two ways`, '--flow-warn', fill, AA]),
  ['avoid badge', '#ffaa00', '--screen', AA], ['arrow label on the canvas', '#ffffff', '--well', AA],
  ['open line title on the canvas', '--flow-group', '--well', AA], ['line button', '#ffffff', '--btn', AA],
  ['issues on their chat box', '#ffaa00', CHAT_ON_PANEL, AA], ['red issues on their chat box', '#ff5555', CHAT_ON_PANEL, AA],

  // the Connections tab (Phase 1 Task 7, design spec §7): the text of each kind of box on its fill and of the face rows on their lighter
  // grey, the links' white labels on their dark halo; and, as graphics, what moves in each pipe on the casing it moves in, a channel's
  // dye (the seven too dark for the dark casing on the panel grey the view gives them) or the colour of what carries a link without one
  ...CONN_FILLS.map(([box, fill]): Pair => [`${box} box text`, '--text', fill, AA]),
  // a hookup's and a left over's lines take the box text's colour instead, as in the flow diagram
  ...CONN_FILLS.filter(([box]) => box !== 'hookup').map(([box, fill]): Pair => [`${box} box lines`, '--text-muted', fill, AA]),
  ['face row', '--text', '--conn-face', AA], ['face row link', '--conn-face-link', '--conn-face', AA],
  ['face row mode', '--text-muted', '--conn-face', AA],
  ['link label on its halo', '#ffffff', '--casing', AA], ['link label on the well', '#ffffff', '--well', AA],
  ...(Object.entries(DYE_HEX) as [DyeColor, string][]).map(([dye, hex]): Pair => [
    `channel dye ${dye}`, hex, DARK_DYES.includes(dye) ? '--dye-casing' : '--casing', GRAPHICS,
  ]),
  ['GT item pipe', '#9ccc65', '--casing', GRAPHICS], ['GT fluid pipe', '#1e88e5', '--casing', GRAPHICS],
  ['Project Red network', '#ff7043', '--casing', GRAPHICS], ['ME network', '#7e57c2', '--casing', GRAPHICS],
  ['EnderIO conduit', '#26c6da', '--casing', GRAPHICS], ['by hand', '#ffca28', '--well', GRAPHICS],
  ['an interface on its machine or a hookup', '#8a92a0', '--well', GRAPHICS],

  // a Flow pipe from a missing source (ruling R34, over R20), as graphics: nothing moves in it, so its red casing is all there is to see
  // of it, on the well; its white head reads on that red and on the well beside it
  ['missing casing on the well', '#ff5555', '--well', GRAPHICS],
  ['white head on the missing casing', '#ffffff', '#ff5555', GRAPHICS], ['white head on the well', '#ffffff', '--well', GRAPHICS],

  // the Map tab (Phase 1 Task 8, design spec §6): the fits badge's four colours on the badge's screen, the NEI tooltip's two greys of
  // text, the rows of the pin and note lists on the panel and under the pointer, and the picked row (yellow and grey on a screen)
  ['fits badge: fits', '--screen-text', '--screen', AA], ['fits badge: tight', '#ffaa00', '--screen', AA],
  ['fits badge: does not fit', '#ff5555', '--screen', AA], ['fits badge: unknown', '--screen-muted', '--screen', AA],
  ['tooltip first line', '#ffffff', TIP_ON_WHITE, AA], ['tooltip detail lines', '#aaaaaa', TIP_ON_WHITE, AA],
  ['row label', '--text', '--panel', AA], ['row coordinates', '--text-muted', '--panel', AA],
  ['row label under the pointer', '--text', VEILED_PANEL, AA], ['row coordinates under the pointer', '--text-muted', VEILED_PANEL, AA],
  ['picked row', '--accent', '--screen', AA], ['picked row coordinates', '--screen-muted', '--screen', AA],
  ['Y level readout', '--screen-text', '--screen', AA],

  // the 3D tab, the World page and the projector panel (Phase 1 Task 9, design spec §6): the hover label on the NEI tooltip, the
  // toggles' two texts on a button under the pointer, the warnings' chat box, the World page's gold title and grey footer on the stone,
  // the scans' four state chips and the green readouts on a screen; and, as graphics, the fills of a scan's bar on its screen
  ['3D hover label', '#ffffff', TIP_ON_WHITE, AA],
  ['toggle that is on, under the pointer', '--accent', '--btn-hover', AA], ['toggle that is off, under the pointer', '#ffffff', '--btn-hover', AA],
  ['warnings title on its chat box', '#ffff55', CHAT_ON_PANEL, AA], ['warnings text on its chat box', '#ffaa00', CHAT_ON_PANEL, AA],
  ['World page title', '#ffd84a', '--page', AA], ['World page footer', '--ink-muted', '--page', AA],
  ['scan state: queued', '--screen-muted', '--screen', AA], ['scan state: running', '#ffaa00', '--screen', AA],
  ['scan state: done', '--screen-text', '--screen', AA], ['scan state: failed', '#ff5555', '--screen', AA],
  ['layer readout', '--screen-text', '--screen', AA], ['smart upload total', '--screen-text', '--screen', AA],
  ['command', '--screen-text', '--screen', AA],
  ['failed scan bar', '#e03c3c', '--screen', GRAPHICS], ['scan bar', '--screen-text', '--screen', GRAPHICS],

  // the Settings button's small part, "Make: Basic Circuit" (the Make-picker fix): Inter 13px in the page's muted ink, on a dark readout
  // in the head (it sits on the stone); on the button's own face that ink falls short (the reason case below)
  ['Settings target part on its readout', '--ink-muted', '--screen', AA],

  // add-on 17: the Compare card's titles on the panel, its readout tiles' label and value on a screen (a value shrunk toward 13px, or cut
  // with its ellipsis, is the same ink on the same screen), its notes in the dark-box group's literals on their chat box over the panel,
  // its Compare modes button while the card is open (yellow on the button face, and under the pointer), the hints of "Plan for"; and, as
  // graphics, the frame of the mode in use: a black edge on the panel with a yellow ring inside it. The edge's row is the light look's: on
  // the dark panel the black all but vanishes, and the ring carries the frame (its row on the panel below; plan ruling compare-frame-dark)
  ['card and column titles', '--title', '--panel', AA], ['"Updating…" beside the title', '--text-muted', '--panel', AA],
  ['tile label', '--screen-muted', '--screen', AA], ['tile value', '--screen-text', '--screen', AA],
  ['note', '#ffffff', CHAT_ON_PANEL, AA], ['note of a mode still planning', '#aaaaaa', CHAT_ON_PANEL, AA],
  ['note of a mode that failed', '#ff5555', CHAT_ON_PANEL, AA],
  ['Compare modes while the card is open', '--accent', '--btn', AA], ['Compare modes while open, under the pointer', '--accent', '--btn-hover', AA],
  ['a hint of Plan for', '--text-muted', '--panel', AA],
  ['mode-in-use edge on the panel', '--outline', '--panel', GRAPHICS, ['light']],
  ['mode-in-use ring on the edge', '--accent', '--outline', GRAPHICS],

  // the dark look and its switch (Phase 2 Task 1b, spec §4.5), as graphics: the slider's thumb on the dark panel (P2-D24: the button's
  // face would be 1.30:1 there), the Theme button's sun and moon on its face, the light edge of the dark tick well (4.21:1, D2), the yellow
  // ring that carries the mode in use on the dark panel (plan ruling compare-frame-dark), and add-on 17's farm fields' line, which the light
  // look keeps at 3:1 (in dark it is a groove: plan ruling farm-line-dark, the reason case below)
  ['slider thumb', '--thumb', '--panel', GRAPHICS, ['dark']],
  ['sun icon', '#ffd84a', '--btn', GRAPHICS], ['moon icon', '#c8d4ff', '--btn', GRAPHICS],
  ['tick-well edge', '#8b8b8b', '--panel', GRAPHICS, ['dark']],
  ['mode-in-use ring on the panel', '--accent', '--panel', GRAPHICS, ['dark']],
  ['farm fields line on the panel', '--panel-lo', '--panel', GRAPHICS, ['light']],
  // and a Flow box under the pointer, whose veil (--flow-hover) lightens it in light and darkens it in dark: its text and its lines
  ...FLOW_FILLS.map(([box, fill]): Pair => [`${box} box text under the pointer`, '--text', { over: '--flow-hover', on: fill }, AA]),
  ...ISSUE_FILLS.map(([box, fill]): Pair => [`${box} box lines under the pointer`, '--text-muted', { over: '--flow-hover', on: fill }, AA]),

  // the shared NEI tooltip (Phase 2 Task 3a, spec §6.3): its white first line and grey details are the map tooltip's (above); its mod line
  // is --tip-mod's blue, on the box over a panel and over the lightest a map or the 3D scene can put under it (the reason case below says
  // why it is not the mockups' blue)
  ['tooltip mod line, over a panel', '--tip-mod', { over: '--tip-bg', on: '--panel' }, AA],
  ['tooltip mod line, over white', '--tip-mod', { over: '--tip-bg', on: '#ffffff' }, AA],

  // a Flow step box's machine readout (Phase 2 Task 4, spec §7): the count chip's white and each tier's own ink on the chip (the tier tokens,
  // which the chip reads through --tier-ink), the busy band's two fills on its track as graphics, and the machine's power (and "by hand")
  // in the box's quiet ink on a new and on an owned box; the band's words are the box text (the table's "box text" rows)
  ['count chip', '--stack-ink', '--flow-chip', AA],
  ...TIERS.map(([tier]): Pair => [`tier chip ${tier}`, `--tier-${tier.toLowerCase()}`, '--flow-chip', AA]),
  ['busy fill', '--flow-busy', '--flow-busy-track', GRAPHICS], ['busy fill, high', '--flow-busy-high', '--flow-busy-track', GRAPHICS],
  ['machine power on a new box', '--text-muted', '--flow-new', AA], ['machine power on an owned box', '--text-muted', '--flow-owned', AA],

  // the step panel's recipe card (Phase 2 Task 5a, spec §8): a slot's stack count and its chance tag on their 2 px shadow (D8: the shadow is what
  // they are read against; the bare light slot face is the reason case below), the readouts' label and value on their screen, and, as graphics,
  // the progress arrow's white fill on its slot-grey base, the energy bar's red on its screen and the red ring of a slot the line does not supply
  // in full on the recess round it (inside the ring is the slot's own image)
  ['stack count on its shadow', '--stack-ink', '--stack-shadow', AA], ['chance tag on its shadow', '#ffff55', '--stack-shadow', AA],
  ['recipe arrow fill on its base', '--stack-ink', '--slot', GRAPHICS], ['energy fill', '--energy', '--screen', GRAPHICS],
  ['readout label', '--screen-muted', '--screen', AA], ['readout value', '--screen-text', '--screen', AA],
  ['ring of a slot not supplied in full, on the recess', '--panel-error', '--panel', GRAPHICS],
];

describe('contrast of the Machine GUI palette', () => {
  it('measures the way the spec does', () => {
    expect(ratio('#000000', '#ffffff')).toBeCloseTo(21, 5);
    expect(ratio('#303030', '#c6c6c6')).toBeCloseTo(7.7, 1);                          // the figures design spec §4 quotes
    expect(ratio('#ffffff', '#4a5499')).toBeCloseTo(6.96, 1);
    expect(ratio('#ff5555', '#2b2b2b')).toBeCloseTo(4.5, 1);                          // the tightest pair of all
  });
});

// One table, run for both looks (Phase 2 spec §3.5): the dark look reads the light tokens with the dark block's over them (Task 1b).
const LOOKS: readonly Look[] = ['light', 'dark'];
describe.each(LOOKS)('contrast in the %s look', (look) => {
  it.each(PAIRS.filter(([, , , , looks]) => looks === undefined || looks.includes(look)))('%s', (_what, fg, bg, min) => {
    expect(ratio(colour(look, fg), colour(look, bg)), `${named(fg)} on ${named(bg)}`).toBeGreaterThanOrEqual(min);
  });
});

// Phase 2 Task 4: a tier chip reads its tier's token, which is the tier ink Phase 1 measured on a screen (the table's "tier" rows), in both looks
it('reads each tier token as the tier ink measured on a screen, in both looks', () => {
  for (const look of LOOKS) for (const [tier, ink] of TIERS) expect(colour(look, `--tier-${tier.toLowerCase()}`), `${look} ${tier}`).toBe(ink);
});

it('reads the light tokens as the literals Phase 1 measured', () => {
  expect(colour('light', '--panel')).toBe('#c6c6c6');
  expect(colour('light', '--flow-new')).toBe('#c6c6c6');
  expect(colour('light', { over: '--tip-bg', on: '#ffffff' })).toBe('#1e0f1e');
  expect(colour('light', { over: '--chat', on: '--panel' })).toBe('#242424');
  expect(colour('light', { over: '--veil', on: '--panel' })).toBe('#dadada');
});

/**
 * The 155 light pairs measured before Phase 2 (Phase 1's 142, the Make-picker fix's 1, add-on 17's 12), each with the least ratio the
 * base held it to: 4.5 for text, 3 for a graphic (ruling P2-R7).
 */
const PHASE1_PAIRS = JSON.parse(readFileSync(new URL('./contrast-phase1.json', import.meta.url), 'utf8')) as Array<[string, string, string, number]>;
// the guard of the rewrite (spec §3.5): no pair measured before Phase 2 is dropped, moved out of the light run or held to less (P2-R7)
it('still measures every pair measured before Phase 2 in the light look, at the same light colours and at least as strictly', () => {
  expect(PHASE1_PAIRS).toHaveLength(155); expect(PAIRS.length).toBeGreaterThanOrEqual(PHASE1_PAIRS.length);
  for (const [what, fg, bg, min] of PHASE1_PAIRS) {
    const kept = PAIRS.some(([w, f, b, m, looks]) => w === what && (looks === undefined || looks.includes('light')) && m >= min
      && colour('light', f) === fg && colour('light', b) === bg);
    expect(kept, `${what}: ${fg} on ${bg}, at ${min}:1 or more, in the light look`).toBe(true);
  }
});

// ---- why the palette is what it is: the pairs that fall short, as literals ----

/** The dark casing of a Connections pipe, the well under the diagrams, the stone and the panel, as Phase 1 measured them. */
const DARK_CASING = '#1b1b1b';
const WELL = '#373737';
const STONE = '#2b2b2b';
const PANEL = '#c6c6c6';

describe('contrast of the Flow diagram', () => {
  it('needs its own red, and the panel\'s text on a left over: the panel\'s red and quiet grey fall short there', () => {
    expect(ratio('#aa0000', '#e3b0b0')).toBeLessThan(AA);                             // the panel's error ink on a missing source
    expect(ratio('#aa0000', '#cbbbe0')).toBeLessThan(AA);                             // and on a collapsed supporting line
    expect(ratio('#4a4a4a', '#a8a8a8')).toBeLessThan(AA);                             // the quiet grey on a left over
  });
});

describe('contrast of the Connections tab', () => {
  it('needs the panel grey for seven dyes: on the dark casing they fall under 3:1', () => {
    // Red, the line's first channel, would be 2.8:1 on the dark casing; every dye at 3:1 on the casing it gets is the table's
    // `channel dye …` rows
    for (const dye of DARK_DYES) expect(ratio(DYE_HEX[dye], DARK_CASING), dye).toBeLessThan(GRAPHICS);
  });
});

// A Flow pipe from a missing source (ruling R34, over R20): its casing and its white head read at 3:1 (the table's rows); the panel's red
// would not, and neither would a head in the casing's own red.
describe('contrast of a Flow pipe from a missing source', () => {
  it('needs a red of its own for the casing: the panel\'s red reads 1.54:1 on the well', () => {
    expect(ratio('#aa0000', WELL)).toBeLessThan(GRAPHICS);
  });

  it('needs a head of another colour than the casing: one in the casing\'s own red would not show on it', () => {
    // ruling R20 gave the head the casing's red, before R34 made the casing that red
    expect(ratio('#ff5555', '#ff5555')).toBeLessThan(GRAPHICS);
  });
});

describe('contrast of the Map tab', () => {
  it('needs a flat row: the coordinates of a note would fall short on a button\'s grey', () => {
    expect(ratio('#4a4a4a', '#6b6b6b')).toBeLessThan(AA);                             // the panel's quiet grey on a button face
    expect(ratio('#aaaaaa', '#6b6b6b')).toBeLessThan(AA);                             // and the dark box's
  });
});

describe('contrast of the 3D tab, the World page and the projector panel', () => {
  it('needs the stone\'s own ink: the panel\'s grey footer would be dark on dark', () => {
    expect(ratio('#4a4a4a', STONE)).toBeLessThan(AA);
  });
});

// The Settings button's small part, "Make: Basic Circuit" (Inter 13px in --ink-muted): the button's own face is the grey #6b6b6b, and
// the muted ink (#aaaaaa) measures 2.3:1 on it, and 3.0:1 on the face under the pointer, so the part is a dark readout on the screen
// (the table's "Settings target part on its readout"), where it measures 7.4:1.
describe('contrast of the Settings button\'s target part', () => {
  it('needs the dark readout: on the button\'s face, and on that face under the pointer, the muted ink falls short', () => {
    expect(ratio('#aaaaaa', '#6b6b6b')).toBeLessThan(AA);                              // the button's face
    expect(ratio('#aaaaaa', '#4a5499')).toBeLessThan(AA);                              // and under the pointer
  });
});

// Add-on 17's frame of the mode in use: a black edge the panel shows, with a yellow ring the edge shows (the table's "mode-in-use" rows);
// the ring alone would be faint on the light panel. In the dark look it is the other way round, and the ring carries the frame.
describe('contrast of the planning modes, farms and the Compare card', () => {
  it('needs the black edge round the mode in use: its yellow ring alone is faint on the panel', () => {
    // the ring alone would be faint on the panel: the black edge is what makes it read
    expect(ratio('#ffff55', PANEL)).toBeLessThan(GRAPHICS);
  });

  it('lets the yellow ring carry the mode in use in the dark look, where the black edge all but vanishes on the panel', () => {
    // 1.46:1, which is why the edge's row runs in the light look only; the ring, 13.46:1 on the panel and 19.69:1 on the edge (the table),
    // carries the frame, as the green carries the grid tick (Phase 2 spec §4.5; plan ruling compare-frame-dark: no rule or token changes)
    expect(ratio(colour('dark', '--outline'), colour('dark', '--panel'))).toBeLessThan(GRAPHICS);
  });

  it('hangs a farm\'s fields on a decorative line, a groove in the dark look like the dark panel\'s own bevel shadow', () => {
    // add-on 17's farm fields hang on a 2 px --panel-lo line: 4.36:1 in light (the table), 1.35:1 in dark. It is a decorative connector:
    // the indent under the tick and the fields' own labels carry the grouping (plan ruling farm-line-dark: no rule or token changes)
    expect(ratio(colour('dark', '--panel-lo'), colour('dark', '--panel'))).toBeLessThan(GRAPHICS);
  });
});

// The dark look's own exceptions (Phase 2 spec §4.3, §4.5): what falls short is identified some other way, and the dark hover darkens a
// box because a light veil would leave its quiet text short.
describe('contrast of the dark look', () => {
  it('accepts button faces on the panel and box fills on the well below 3:1: their labels and text identify them', () => {
    expect(ratio(colour('dark', '--btn'), colour('dark', '--panel'))).toBeLessThan(GRAPHICS);              // 1.30:1
    expect(ratio(colour('dark', '--flow-new'), colour('dark', '--well'))).toBeLessThan(GRAPHICS);          // 1.32:1
  });

  it('accepts the flange on a new box below 3:1 in both looks: a shape detail with a black edge', () => {
    // 2.59:1 in dark, and less in light
    for (const look of ['light', 'dark'] as const) expect(ratio(colour(look, '--flange'), colour(look, '--flow-new')), look).toBeLessThan(GRAPHICS);
  });

  it('darkens a box under the pointer: an 8 % white veil would leave the muted text short on an owned box', () => {
    // 3.79:1; the dark --flow-hover, 30 % black, keeps it at 4.5:1 or more (the table's "under the pointer" rows)
    expect(ratio(colour('dark', '--text-muted'), colour('dark', { over: 'rgb(255 255 255 / 0.08)', on: '--flow-owned' }))).toBeLessThan(AA);
  });
});

// The shared NEI tooltip's mod line (Phase 2 spec §6.3): NEI's own blue, the mockups' #5555ff, reads 3.70:1 on the box over a panel, so the
// line is --tip-mod's #8080ff (the table's "tooltip mod line" rows, 5.6:1 or more).
describe('contrast of the shared tooltip', () => {
  it('needs a lighter blue for its mod line: the mockups\' blue falls short on the box', () => {
    expect(ratio('#5555ff', colour('light', { over: '--tip-bg', on: '--panel' }))).toBeLessThan(AA);
  });
});

// The recipe card (Phase 2 spec §8): a stack count is white over a 2 px dark shadow, the Minecraft convention (D8), and is measured against
// that shadow (the table's row, 10.53:1 in light and 21:1 in dark); on the bare light slot face it would be 3.41:1. The arrow's base is an
// aria-hidden shape (spec §3.5): its fill is what moves and what shows, measured on it in the table.
describe('contrast of the recipe card', () => {
  it('reads a stack count on its shadow: on the bare light slot face it would fall short (D8, accepted)', () => {
    expect(ratio('#ffffff', '#8b8b8b')).toBeLessThan(AA);
  });

  it('lets the arrow\'s base go below 3:1 on the recess, in both looks: an aria-hidden shape its fill is measured on', () => {
    for (const look of LOOKS) expect(ratio(colour(look, '--slot'), colour(look, '--panel')), look).toBeLessThan(GRAPHICS);
  });

  // ledger ruling P2-R30: in the dark look an empty bar's track and a readout tile's edge are grooves on the panel, exempt from 3:1; the fill
  // and the printed figure carry the value, on the condition that each fill reads 3:1 or more on its track in both looks (the table's
  // "energy fill" and "busy fill" rows), and a tile's text carries its own contrast
  it('lets the empty energy track and a readout tile\'s edge go below 3:1 on the dark panel (ledger ruling P2-R30)', () => {
    expect(ratio(colour('dark', '--screen'), colour('dark', '--panel'))).toBeLessThan(GRAPHICS);                // 1.37:1
    // and, by the same ruling, Task 4's busy track on a new Flow box
    expect(ratio(colour('dark', '--flow-busy-track'), colour('dark', '--flow-new'))).toBeLessThan(GRAPHICS);   // 1.49:1
  });

  // ledger ruling P2-R31: the red ring of a slot the line does not supply in full falls short against the light slot face inside it; the short
  // state is also in the slot's name and tip, on the condition that the ring reads 3:1 or more against the recess round it (the table)
  it('lets the short ring go below 3:1 against the light slot face inside it (ledger ruling P2-R31)', () => {
    expect(ratio(colour('light', '--panel-error'), colour('light', '--slot'))).toBeLessThan(GRAPHICS);          // 2.27:1
  });
});
