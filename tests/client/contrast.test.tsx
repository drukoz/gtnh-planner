// WCAG AA contrast of every text pair of the Machine GUI palette (restyle plan Phase 1 Task 1, design spec §4 and §6): the
// ink of each surface, the button faces, the tabs and the tier chips. Plain arithmetic on the spec's values, so these pass
// from the start and stay as the guard for every later edit of a colour.

import { describe, it, expect } from 'vitest';
import { DYE_HEX } from '../../src/shared/layout/enderio.ts';
import type { DyeColor } from '../../src/shared/types/layout.ts';

const AA = 4.5;

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

/** [what it is, text, background] */
const PAIRS: [string, string, string][] = [
  ...['#dddddd', '#aaaaaa', '#ffffff', '#ffff55', '#ff5555', '#55ff55', '#ffaa00'].map((text): [string, string, string] => ['page ink', text, '#2b2b2b']),
  ...['#303030', '#4a4a4a', '#404040', '#1a3fa0', '#aa0000', '#1e5a1e', '#6a4000'].map((text): [string, string, string] => ['panel ink', text, '#c6c6c6']),
  ...['#ffffff', '#aaaaaa', '#ffff55', '#ff5555', '#55ff55', '#ffaa00'].map((text): [string, string, string] => ['dark ink', text, '#1b1b1b']),
  ...TIERS.map(([tier, text]): [string, string, string] => [`tier ${tier}`, text, '#1b1b1b']),
  ['button', '#ffffff', '#6b6b6b'], ['button hover', '#ffffff', '#4a5499'],
  ['danger button', '#ffffff', '#aa0000'], ['danger button hover', '#ffffff', '#c62828'],
  ['primary button', '#ffff55', '#6b6b6b'],
  ['unselected tab', '#1b1b1b', '#8b8b8b'], ['selected tab', '#303030', '#c6c6c6'],
];

describe('contrast of the Machine GUI palette', () => {
  it('measures the way the spec does', () => {
    expect(ratio('#000000', '#ffffff')).toBeCloseTo(21, 5);
    expect(ratio('#303030', '#c6c6c6')).toBeCloseTo(7.7, 1);                          // the figures design spec §4 quotes
    expect(ratio('#ffffff', '#4a5499')).toBeCloseTo(6.96, 1);
    expect(ratio('#ff5555', '#2b2b2b')).toBeCloseTo(4.5, 1);                          // the tightest pair of all
  });

  it.each(PAIRS)('%s: %s on %s meets AA', (_what, text, background) => {
    expect(ratio(text, background)).toBeGreaterThanOrEqual(AA);
  });
});

// The text of the Flow diagram (restyle plan Phase 1 Task 6, design spec §7: "text #303030 on all, ≥ 4.5:1"): every box fill with
// the text a box draws on it, then the light text on the dark canvas and in the chat boxes. A chat box is 82% black over the panel,
// which is #242424.
const FLOW_FILLS: [string, string][] = [
  ['new', '#c6c6c6'], ['owned', '#b9d6b0'], ['import', '#d8cfa8'], ['missing', '#e3b0b0'], ['target', '#f0d870'], ['left over', '#a8a8a8'],
  ['supporting line', '#cbbbe0'],
];
/** The boxes whose rows can show an issue: not a left over, which is never short of anything. */
const ISSUE_FILLS = FLOW_FILLS.filter(([box]) => box !== 'left over');
const FLOW_PAIRS: [string, string, string][] = [
  ...FLOW_FILLS.map(([box, fill]): [string, string, string] => [`${box} box text`, '#303030', fill]),
  ...ISSUE_FILLS.map(([box, fill]): [string, string, string] => [`${box} box lines and rates`, '#4a4a4a', fill]),
  ...ISSUE_FILLS.map(([box, fill]): [string, string, string] => [`${box} box row with no source`, '#990000', fill]),
  ...ISSUE_FILLS.map(([box, fill]): [string, string, string] => [`${box} box row made two ways`, '#6a4000', fill]),
  ['avoid badge', '#ffaa00', '#1b1b1b'], ['arrow label on the canvas', '#ffffff', '#373737'],
  ['open line title on the canvas', '#cbbbe0', '#373737'], ['line button', '#ffffff', '#6b6b6b'],
  ['issues on their chat box', '#ffaa00', '#242424'], ['red issues on their chat box', '#ff5555', '#242424'],
];

describe('contrast of the Flow diagram', () => {
  it.each(FLOW_PAIRS)('%s: %s on %s meets AA', (_what, text, background) => {
    expect(ratio(text, background)).toBeGreaterThanOrEqual(AA);
  });

  it('needs its own red, and the panel\'s text on a left over: the panel\'s red and quiet grey fall short there', () => {
    expect(ratio('#aa0000', '#e3b0b0')).toBeLessThan(AA);                             // the panel's error ink on a missing source
    expect(ratio('#aa0000', '#cbbbe0')).toBeLessThan(AA);                             // and on a collapsed supporting line
    expect(ratio('#4a4a4a', '#a8a8a8')).toBeLessThan(AA);                             // the quiet grey on a left over
  });
});

// The Connections tab (restyle plan Phase 1 Task 7, design spec §7): the text of each kind of box on its fill and of the face rows on
// their lighter grey, the links' white labels on their dark halo; and, as graphics (WCAG 1.4.11: 3:1), what moves in each pipe
// against the casing it moves in. Design spec §7 names the seven dyes too dark for the dark casing, which get the panel grey.
const GRAPHICS = 3;
const DARK_CASING = '#1b1b1b';
const PANEL_CASING = '#c6c6c6';
const WELL = '#373737';
const CONN_FILLS: [string, string][] = [['machine', '#c6c6c6'], ['chest', '#f0d870'], ['interface', '#cbbbe0'], ['source', '#d8cfa8'], ['hookup', '#a8a8a8']];
const CONN_PAIRS: [string, string, string][] = [
  ...CONN_FILLS.map(([box, fill]): [string, string, string] => [`${box} box text`, '#303030', fill]),
  // a hookup's and a left over's lines take the box text's colour instead, as in the flow diagram
  ...CONN_FILLS.filter(([box]) => box !== 'hookup').map(([box, fill]): [string, string, string] => [`${box} box lines`, '#4a4a4a', fill]),
  ['face row', '#303030', '#e0e0e0'], ['face row link', '#1d3b9a', '#e0e0e0'], ['face row mode', '#4a4a4a', '#e0e0e0'],
  ['link label on its halo', '#ffffff', DARK_CASING], ['link label on the well', '#ffffff', WELL],
];
const DARK_DYES: readonly DyeColor[] = ['black', 'brown', 'blue', 'gray', 'green', 'purple', 'red'];
/** What carries a link without a channel (styles.css `.conn-via-*`), and what it moves on: by hand there is no casing. */
const CARRIERS: [string, string, string][] = [
  ['GT item pipe', '#9ccc65', DARK_CASING], ['GT fluid pipe', '#1e88e5', DARK_CASING], ['Project Red network', '#ff7043', DARK_CASING],
  ['ME network', '#7e57c2', DARK_CASING], ['EnderIO conduit', '#26c6da', DARK_CASING], ['by hand', '#ffca28', WELL],
  ['an interface on its machine or a hookup', '#8a92a0', WELL],
];

describe('contrast of the Connections tab', () => {
  it.each(CONN_PAIRS)('%s: %s on %s meets AA', (_what, text, background) => {
    expect(ratio(text, background)).toBeGreaterThanOrEqual(AA);
  });

  it('shows every channel dye at 3:1 on its casing: the seven too dark for the dark casing on the panel grey', () => {
    for (const [dye, hex] of Object.entries(DYE_HEX) as [DyeColor, string][]) {
      const casing = DARK_DYES.includes(dye) ? PANEL_CASING : DARK_CASING;
      expect(ratio(hex, casing), dye).toBeGreaterThanOrEqual(GRAPHICS);
    }
    // and those seven do need it: Red, the line's first channel, would be 2.8:1 on the dark casing
    for (const dye of DARK_DYES) expect(ratio(DYE_HEX[dye], DARK_CASING), dye).toBeLessThan(GRAPHICS);
  });

  it.each(CARRIERS)('what carries a link without a channel, %s: %s on %s, reads at 3:1', (_what, colour, under) => {
    expect(ratio(colour, under)).toBeGreaterThanOrEqual(GRAPHICS);
  });
});

// A Flow pipe from a missing source (ruling R34, over R20): nothing moves in it, so its casing is all there is to see of it, and as a
// graphic it reads at 3:1 on the well; its arrow head is white, which reads on that red (and on the well beside it).
describe('contrast of a Flow pipe from a missing source', () => {
  it('reads its red casing at 3:1 on the well, where the panel\'s red read 1.54:1', () => {
    expect(ratio('#ff5555', WELL)).toBeGreaterThanOrEqual(GRAPHICS);
    expect(ratio('#aa0000', WELL)).toBeLessThan(GRAPHICS);
  });

  it('reads its white head at 3:1 on the casing and on the well', () => {
    expect(ratio('#ffffff', '#ff5555')).toBeGreaterThanOrEqual(GRAPHICS);
    expect(ratio('#ffffff', WELL)).toBeGreaterThanOrEqual(GRAPHICS);
    // the head of R20, in the casing's own red now, would not show on it
    expect(ratio('#ff5555', '#ff5555')).toBeLessThan(GRAPHICS);
  });
});

// The Map tab (restyle plan Phase 1 Task 8, design spec §6): the fits badge's four colours on the badge's screen, the NEI tooltip's
// two greys of text on its box (94% of #100010 over the lightest a map can be, white), the rows of the pin and note lists on the panel
// and under the pointer (the panel's grey under a 35% white veil), and the picked row (yellow and the screen's grey on a screen).
const SCREEN = '#1b1b1b';
const PANEL = '#c6c6c6';
const TIP_OVER_WHITE = '#1e0f1e';
const VEILED_PANEL = '#dadada';
const MAP_PAIRS: [string, string, string][] = [
  ['fits badge: fits', '#55ff55', SCREEN], ['fits badge: tight', '#ffaa00', SCREEN], ['fits badge: does not fit', '#ff5555', SCREEN],
  ['fits badge: unknown', '#aaaaaa', SCREEN],
  ['tooltip first line', '#ffffff', TIP_OVER_WHITE], ['tooltip detail lines', '#aaaaaa', TIP_OVER_WHITE],
  ['row label', '#303030', PANEL], ['row coordinates', '#4a4a4a', PANEL],
  ['row label under the pointer', '#303030', VEILED_PANEL], ['row coordinates under the pointer', '#4a4a4a', VEILED_PANEL],
  ['picked row', '#ffff55', SCREEN], ['picked row coordinates', '#aaaaaa', SCREEN], ['Y level readout', '#55ff55', SCREEN],
];

describe('contrast of the Map tab', () => {
  it.each(MAP_PAIRS)('%s: %s on %s meets AA', (_what, text, background) => {
    expect(ratio(text, background)).toBeGreaterThanOrEqual(AA);
  });

  it('needs a flat row: the coordinates of a note would fall short on a button\'s grey', () => {
    expect(ratio('#4a4a4a', '#6b6b6b')).toBeLessThan(AA);                             // the panel's quiet grey on a button face
    expect(ratio('#aaaaaa', '#6b6b6b')).toBeLessThan(AA);                             // and the dark box's
  });
});

// The 3D tab, the World page and the projector panel (restyle plan Phase 1 Task 9, design spec §6): the hover label's white on the NEI tooltip
// (over white, the lightest the scene or its sky can put under it: the Map's pair above), the toggles' two texts on a button under the
// pointer, the warnings' chat box, the World page's gold title and grey footer on the stone, the scans' four state chips, and the green
// readouts (the layer, the smart upload's total and the commands) on a screen; and, as graphics (WCAG 1.4.11: 3:1), the red fill of a failed
// scan's bar.
const CHAT_OVER_PANEL = '#242424';
const STONE = '#2b2b2b';
const SCREEN_PAIRS: [string, string, string][] = [
  ['3D hover label', '#ffffff', TIP_OVER_WHITE],
  ['toggle that is on, under the pointer', '#ffff55', '#4a5499'], ['toggle that is off, under the pointer', '#ffffff', '#4a5499'],
  ['warnings title on its chat box', '#ffff55', CHAT_OVER_PANEL], ['warnings text on its chat box', '#ffaa00', CHAT_OVER_PANEL],
  ['World page title', '#ffd84a', STONE], ['World page footer', '#aaaaaa', STONE],
  ['scan state: queued', '#aaaaaa', SCREEN], ['scan state: running', '#ffaa00', SCREEN], ['scan state: done', '#55ff55', SCREEN],
  ['scan state: failed', '#ff5555', SCREEN],
  ['layer readout', '#55ff55', SCREEN], ['smart upload total', '#55ff55', SCREEN], ['command', '#55ff55', SCREEN],
];

describe('contrast of the 3D tab, the World page and the projector panel', () => {
  it.each(SCREEN_PAIRS)('%s: %s on %s meets AA', (_what, text, background) => {
    expect(ratio(text, background)).toBeGreaterThanOrEqual(AA);
  });

  it('reads the red fill of a failed scan\'s bar at 3:1 on its screen, as the green of the others', () => {
    expect(ratio('#e03c3c', SCREEN)).toBeGreaterThanOrEqual(GRAPHICS);
    expect(ratio('#55ff55', SCREEN)).toBeGreaterThanOrEqual(GRAPHICS);
  });

  it('needs the stone\'s own ink: the panel\'s grey footer would be dark on dark', () => {
    expect(ratio('#4a4a4a', STONE)).toBeLessThan(AA);
  });
});

// The Settings button's small part, "Make: Basic Circuit" (Inter 13px in --ink-muted): the button's own face is the grey #6b6b6b, and
// the muted ink (#aaaaaa) measures 2.3:1 on it, and 3.0:1 on the face under the pointer, so the part is a dark readout on the screen
// (the pair "dark ink" above), where it measures 7.4:1.
describe('contrast of the Settings button\'s target part', () => {
  it('reads the muted ink on its dark readout, and needs it: on the button\'s face the ink falls short', () => {
    expect(ratio('#aaaaaa', SCREEN)).toBeGreaterThanOrEqual(AA);
    expect(ratio('#aaaaaa', '#6b6b6b')).toBeLessThan(AA);                              // the button's face
    expect(ratio('#aaaaaa', '#4a5499')).toBeLessThan(AA);                              // and under the pointer
  });
});
