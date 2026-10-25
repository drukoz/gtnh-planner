// The shared NEI tooltip's pure parts (Phase 2 spec §6): where a tip goes (MapTooltip's rule beside the pointer, an element's left edge
// below or above it), its lines in and out of `data-tip`, the rest before it shows, when it describes an element, which taps act and
// which show a tip, which pointers hover, the one re-placement a frame, the mod names, and what the box holds. TooltipHost's listeners
// need a browser: tooltips.spec.ts drives them.

import { afterEach, describe, it, expect, vi } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { HOVER_DELAY_MS } from '../../src/client/map/hover.ts';
import {
  alongAxis, createRestTimer, describes, frameThrottle, hoverFrom, placeTip, tapActs, TIP_DELAY_MS, tipLines, tipText, type TapNode,
} from '../../src/client/components/tooltip-model.ts';
import { MOD_NAMES, modName } from '../../src/client/components/mod-names.ts';
import { TipLines } from '../../src/client/components/Tooltip.tsx';

afterEach(() => vi.useRealTimers());

describe('the shared tooltip: placement', () => {
  it('places along one axis as MapTooltip does (its six cases)', () => {
    expect(alongAxis(100, 100, 100, 400)).toBe(112); expect(alongAxis(390, 390, 100, 400)).toBe(278); expect(alongAxis(290, 290, 40, 300)).toBe(238);
    expect(alongAxis(200, 232, 100, 400)).toBe(244); expect(alongAxis(360, 392, 100, 400)).toBe(248); expect(alongAxis(40, 40, 100, 80)).toBe(0);
  });

  it('puts a pointer tip 12 px below and right, flipped and clamped, and an element tip at its left edge 4 px below (above: first above)', () => {
    const room = { width: 1280, height: 720 }; const size = { width: 200, height: 60 }; const at = (x: number, y: number) => ({ left: x, right: x, top: y, bottom: y });
    expect(placeTip(at(100, 80), size, room, 'pointer')).toEqual({ left: 112, top: 92 });
    expect(placeTip(at(1200, 80), size, room, 'pointer')).toEqual({ left: 988, top: 92 });
    expect(placeTip(at(100, 700), size, room, 'pointer')).toEqual({ left: 112, top: 628 });
    const head = { left: 40, top: 100, right: 140, bottom: 120 };
    expect(placeTip(head, size, room, 'below')).toEqual({ left: 40, top: 124 });
    expect(placeTip({ ...head, top: 680, bottom: 700 }, size, room, 'below')).toEqual({ left: 40, top: 616 });
    expect(placeTip(head, size, room, 'above')).toEqual({ left: 40, top: 36 });
    expect(placeTip({ ...head, top: 30, bottom: 50 }, size, room, 'above')).toEqual({ left: 40, top: 54 });
    expect(placeTip({ ...head, left: 1250, right: 1270 }, size, room, 'below').left).toBe(1080);
    expect(placeTip(head, size, { width: 150, height: 40 }, 'below')).toEqual({ left: 0, top: 0 });
  });
});

describe('the shared tooltip: its lines and when it shows', () => {
  it('joins and splits the lines, dropping empty ones', () => {
    expect(tipText(['A', undefined, '', 'B'])).toBe('A\nB'); expect(tipText([undefined, ''])).toBeUndefined(); expect(tipLines('A\n\n B \n')).toEqual(['A', 'B']); expect(tipLines(null)).toEqual([]);
  });

  it('shows only the target the pointer rests on, after 150 ms', () => {   // map-hover.test.tsx:285-310's sequence, on string targets
    vi.useFakeTimers(); const shown: Array<string | null> = []; const timer = createRestTimer<string>((t) => shown.push(t));
    timer.move('A'); vi.advanceTimersByTime(60); timer.move('B'); vi.advanceTimersByTime(60); timer.move('C');
    vi.advanceTimersByTime(TIP_DELAY_MS - 1); timer.move('C'); expect(shown).toEqual([]);                 // A and B never shown, C not yet
    vi.advanceTimersByTime(1); expect(shown).toEqual(['C']);
    timer.move('C'); timer.move('D'); expect(shown).toEqual(['C', null]);                                 // the same keeps it, another hides at once
    timer.clear(); vi.advanceTimersByTime(TIP_DELAY_MS); expect(shown).toEqual(['C', null]);              // clear drops D's wait
    timer.now('X'); expect(shown).toEqual(['C', null, 'X']); timer.clear(); expect(shown).toEqual(['C', null, 'X', null]);
  });

  it('waits as long as the map', () => expect(TIP_DELAY_MS).toBe(HOVER_DELAY_MS));

  it('describes an element only when the tip says more than its name', () => {
    expect(describes('Copper Wire', 'Copper Wire')).toBe(false); expect(describes('Copper  Wire ', 'Copper Wire')).toBe(false);
    expect(describes('Basic Wiremill\ntakes Copper Ingot', 'Basic Wiremill')).toBe(true); expect(describes('Fit · F', null)).toBe(true);
  });

  it('lets a tap act on what acts, and show the tip on what does not', () => {
    const n = (tag: string, over: Partial<TapNode> = {}): TapNode => ({ tag, role: null, hasHref: false, inSvg: false, ...over });
    expect(tapActs([n('span'), n('li')])).toBe(false);
    for (const path of [[n('span'), n('button')], [n('a', { hasHref: true })], [n('label')], [n('summary')], [n('li', { role: 'checkbox' })], [n('g', { inSvg: true })]]) expect(tapActs(path)).toBe(true);
  });

  it('hovers with a mouse or a pen, never with a finger', () => {   // spec §6.1: touch's pointerover and pointerout are ignored
    expect(['mouse', 'pen', 'touch', ''].map(hoverFrom)).toEqual([true, true, false, false]);
  });

  it('re-places a shown tip at most once a frame, at the last pointer position', () => {
    const run = vi.fn(); const frames: Array<() => void> = []; const cancel = vi.fn();
    const throttle = frameThrottle<number>(run, { request: (cb) => frames.push(cb), cancel });
    throttle.push(1); throttle.push(2); throttle.push(3); expect(frames).toHaveLength(1); expect(run).not.toHaveBeenCalled();
    frames[0]!(); expect(run.mock.calls).toEqual([[3]]);
    throttle.push(4); throttle.cancel(); expect(cancel).toHaveBeenCalledTimes(1);
  });
});

describe('the shared tooltip: the mod line and the box', () => {
  it('names the mod of an item key, whatever its case, and nothing for a fluid or an unknown namespace', () => {
    expect(modName('gregtech:gt.metaitem.01@2032')).toBe('GregTech'); expect(modName('IC2:itemCable@0')).toBe('IndustrialCraft 2');
    expect(modName('EnderIO:itemItemConduit@0')).toBe('Ender IO'); expect(modName('fluid:water')).toBeNull(); expect(modName('t:iron_ingot@0')).toBeNull();
    expect(Object.keys(MOD_NAMES).length).toBeLessThanOrEqual(15); for (const key of Object.keys(MOD_NAMES)) expect(key).toBe(key.toLowerCase());
  });

  // spec §25: a tip's figures in VT323, its words and its `%` and `×` in Pixelify
  it('writes a tip\'s figures in span.fig', () => expect(renderToStaticMarkup(<TipLines lines={['Copper Wire', 'need 80× · have 1,440', '10% chance']} mod="GregTech" />)).toBe('<div>Copper Wire</div><div>need <span class="fig">80</span>× · have <span class="fig">1,440</span></div><div><span class="fig">10</span>% chance</div><div class="nei-tooltip-mod">GregTech</div>'));
});
