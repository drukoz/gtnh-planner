// WCAG AA contrast of every text pair of the Machine GUI palette (restyle plan Phase 1 Task 1, design spec §4 and §6): the
// ink of each surface, the button faces, the tabs and the tier chips. Plain arithmetic on the spec's values, so these pass
// from the start and stay as the guard for every later edit of a colour.

import { describe, it, expect } from 'vitest';

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
