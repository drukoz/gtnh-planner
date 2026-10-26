// The shared NEI tooltip's pure parts (Phase 2 spec §6): where a tip goes (MapTooltip's rule beside the pointer, an element's left edge
// below or above it), its lines in and out of `data-tip`, the rest before it shows, when it describes an element, which taps act and
// which show a tip, which pointers hover, the one re-placement a frame, the mod names, and what the box holds. TooltipHost's listeners
// need a browser: tooltips.spec.ts drives them.

import { afterEach, describe, it, expect, vi } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { HOVER_DELAY_MS } from '../../src/client/map/hover.ts';
import {
  alongAxis, createRestTimer, describedLines, describes, frameThrottle, hoverFrom, inView, placeTip, spokenName, tapActs, TIP_DELAY_MS, tipLines, tipText,
  type TapNode,
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

  // spec §6.2, ledger ruling P2-R23 and Task 3b's fix round (M1, M2): an element tip is placed at what of its element is in view, in its
  // outermost svg's view and in the window both; a box needs some of its area there, a line (a Flow arrow that runs straight) some of its
  // length; a box that only touches a view's edge, and a point, are not in view
  it('places an element tip at what of its element is in its svg\'s view and in the window, a line\'s length counting', () => {
    const win = { left: 0, top: 0, right: 1280, bottom: 720 }; const svg = { left: 100, top: 200, right: 900, bottom: 600 };
    const head = { left: 300, top: 300, right: 500, bottom: 340 };
    expect(inView(head, [win, svg])).toEqual(head);
    expect(inView({ ...head, left: 850, right: 1050 }, [win, svg])).toEqual({ left: 850, top: 300, right: 900, bottom: 340 });   // cut to the svg
    expect(inView({ ...head, left: 900, right: 1100 }, [win, svg])).toBeNull();                 // M2: it only touches the svg's edge
    expect(inView({ ...head, top: 560, bottom: 600 }, [win, svg])).toEqual({ ...head, top: 560, bottom: 600 });   // flush with the edge, inside
    // M1: the page has scrolled the svg up, so the head is in the svg's box but above the window: no tip (it came back at the window's edge)
    const scrolled = { left: 100, top: -300, right: 900, bottom: 100 };
    expect(inView({ ...head, top: -200, bottom: -160 }, [win, scrolled])).toBeNull();
    expect(inView({ ...head, top: -20, bottom: 20 }, [win, scrolled])).toEqual({ ...head, top: 0, bottom: 20 });
    // P2-R23: a level line (a straight arrow) is in view where some of its length is; an upright one too; out of view, or a point, it is not
    const level = { left: 300, top: 400, right: 360, bottom: 400 };
    expect(inView(level, [win, svg])).toEqual(level);
    expect(inView({ ...level, left: 880, right: 940 }, [win, svg])).toEqual({ ...level, left: 880, right: 900 });
    expect(inView({ ...level, top: 650, bottom: 650 }, [win, svg])).toBeNull();
    expect(inView({ ...level, left: 900, right: 960 }, [win, svg])).toBeNull();                 // only its end touches the edge
    expect(inView({ left: 300, top: 300, right: 300, bottom: 360 }, [win, svg])).toEqual({ left: 300, top: 300, right: 300, bottom: 360 });
    expect(inView({ left: 300, top: 300, right: 300, bottom: 300 }, [win, svg])).toBeNull();
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

  // ledger ruling P2-R20 (spec §6.1: where a tap acts, it only acts): what the trigger sits in counts too, up to the document's root
  it('lets a tap on an icon inside a search option or a summary only act', () => {
    const n = (tag: string, over: Partial<TapNode> = {}): TapNode => ({ tag, role: null, hasHref: false, inSvg: false, ...over });
    const page = [n('div'), n('aside', { role: 'complementary' }), n('main'), n('body'), n('html')];
    // ItemSearch's option picks on a click; FoundPanel's summary opens its details
    expect(tapActs([n('img'), n('span')], [n('li', { role: 'option' }), n('ul', { role: 'listbox' }), ...page])).toBe(true);
    expect(tapActs([n('span')], [n('span'), n('summary'), n('details'), n('li'), ...page])).toBe(true);
    // a Materials row's icon sits beside its tick, not in it: nothing on the way up acts, and the tap shows the tip
    expect(tapActs([n('span')], [n('li'), n('ul'), n('section'), n('div', { role: 'tabpanel' }), ...page])).toBe(false);
    // the svg rule is the trigger's own: an element above it in an svg makes no tap act
    expect(tapActs([n('span')], [n('div', { inSvg: true }), ...page])).toBe(false);
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

  // plan ruling digits-mixed: a mod's name is a name, which stays Pixelify, digits and all
  it('writes a mod line as the name it is, with no figure', () => {
    expect(renderToStaticMarkup(<TipLines lines={['Copper Cable']} mod="IndustrialCraft 2" />)).toBe('<div>Copper Cable</div><div class="nei-tooltip-mod">IndustrialCraft 2</div>');
  });

  // ledger ruling P2-R22 (spec §6.6): the description is what the tip says beyond the element's name, its mod line included, so a screen
  // reader hears "GregTech" and never the name twice
  it('describes what a tip says beyond the name of the element it describes, and hides the lines that only repeat it', () => {
    expect(describedLines(['Copper Wire'], 'GregTech', 'Copper Wire')).toEqual(['GregTech']);
    expect(describedLines(['Copper Wire'], null, 'Copper Wire')).toEqual([]);
    expect(describedLines(['Copper  Wire '], null, 'Copper Wire')).toEqual([]);
    expect(describedLines(['Basic Wiremill', 'takes Copper Ingot 1/s'], null, 'Basic Wiremill')).toEqual(['takes Copper Ingot 1/s']);
    expect(describedLines(['Basic Wiremill', 'LV · 32 EU/t'], null, 'Basic Wiremill\nLV · 32 EU/t')).toEqual([]);   // its name is the whole tip
    // ledger ruling P2-R24 turned this one round: a name whose parts the view joins with ", " says those lines too (a Flow head's)
    expect(describedLines(['Basic Wiremill', 'LV · 32 EU/t'], null, 'Basic Wiremill, LV · 32 EU/t')).toEqual([]);
    expect(describedLines(['Fit · F'], null, null)).toEqual(['Fit · F']);
    expect(renderToStaticMarkup(<TipLines lines={['Copper Wire']} mod="GregTech" name="Copper Wire" />))
      .toBe('<div aria-hidden="true">Copper Wire</div><div class="nei-tooltip-mod">GregTech</div>');
    expect(renderToStaticMarkup(<TipLines lines={['Basic Wiremill', 'LV · 32 EU/t']} mod={null} name="Basic Wiremill" />))
      .toBe('<div aria-hidden="true">Basic Wiremill</div><div>LV · <span class="fig">32</span> EU/t</div>');
  });

  // ledger ruling P2-R24 (spec §6.6, P2-D36): the description never restates the element's name, whatever its separators: a view joins a
  // name's parts with " · ", ", " or ": " where the tip gives each a line. The first lines whose parts are all the name's say it, and so
  // does a line whose parts begin it (a row's name is its words, then what a click on it does)
  it('drops from the description what restates the name, whatever its separators: an arrow\'s, a step head\'s and a row\'s', () => {
    // a Flow arrow, named by its title: its tip is the same three parts, a line each, so it has no description
    expect(describedLines(['Iron Ingot', '1/s', 'A → B'], null, 'Iron Ingot · 1/s · A → B')).toEqual([]);
    // a step head, named by its title and line joined with ", ": its description is its rows
    const box = ['Wiremill', 'LV · 32 EU/t · 1 machine', 'takes Copper Ingot 1/s', 'makes Copper Wire 2/s'];
    expect(describedLines(box, null, 'Wiremill, LV · 32 EU/t · 1 machine')).toEqual(['takes Copper Ingot 1/s', 'makes Copper Wire 2/s']);
    // a row, named by its words and what a click on it does: the box's title, its line and the other rows
    expect(describedLines(box, null, 'takes Copper Ingot 1/s: show where it comes from')).toEqual(['Wiremill', 'LV · 32 EU/t · 1 machine', 'makes Copper Wire 2/s']);
    // an import stub's row, named by the stub's good and its words: the stub's tip says nothing more
    expect(describedLines(['Iron Ingot', 'Iron Ingot: mined 1/s'], null, 'Iron Ingot, mined 1/s: show where it goes')).toEqual([]);
    // the lines it drops are the ones TipLines hides
    const head = renderToStaticMarkup(<TipLines lines={box} mod={null} name="Wiremill, LV · 32 EU/t · 1 machine" />);
    expect(head.match(/<div aria-hidden="true">/g)).toHaveLength(2);
    expect(head).toMatch(/^<div aria-hidden="true">Wiremill<\/div><div aria-hidden="true">LV · /);
    // a part is said whole or not at all: a line that names something longer, or only the start of a part, says nothing of the name
    expect(describedLines(['Iron Ingot Block', 'Iron'], null, 'Iron Ingot')).toEqual(['Iron Ingot Block', 'Iron']);
    // and a figure's comma is no separator: "1,440" is not "1 440"
    expect(describes('1,440', '1 440')).toBe(true); expect(describes('Iron Ingot\n1/s', 'Iron Ingot · 1/s')).toBe(false);
  });

  // Task 11 (spec §14.1): the diagrams' Fit and Pause pipes buttons are named by their words and give their key in `aria-keyshortcuts`, which a
  // screen reader says with the name; their tips, "Fit · F" and "Pause pipes · P", say nothing more, so they describe nothing, and the name is not
  // heard twice. A name with no key is said as it was
  it('describes nothing on a button whose tip is its name and its key', () => {
    expect(spokenName('Pause pipes', 'P')).toBe('Pause pipes\nP\np');                // a one-letter key either case (fix round 1, M7)
    expect(describedLines(['Pause pipes · P'], null, spokenName('Pause pipes', 'P'))).toEqual([]);
    expect(describedLines(['Play pipes · P'], null, spokenName('Play pipes', 'P'))).toEqual([]);
    expect(describedLines(['Fit · F'], null, spokenName('Fit', 'F'))).toEqual([]);
    // the name alone, the key unsaid, leaves the whole line to describe; and a key counts whole: F is not Flow
    expect(describedLines(['Fit · F'], null, spokenName('Fit', null))).toEqual(['Fit · F']);
    expect(describedLines(['Fit · Flow'], null, spokenName('Fit', 'F'))).toEqual(['Fit · Flow']);
    expect([spokenName('Copper Wire', null), spokenName(null, null), spokenName(null, 'F'), spokenName('Fit', ' F  Shift+F ')])
      .toEqual(['Copper Wire', null, 'F\nf', 'Fit\nF\nf\nShift+F']);
    expect(describedLines(['Fit · f'], null, spokenName('Fit', 'F'))).toEqual([]);
    // the host draws a tip that describes nothing with no name (`named` null): no line is hidden, for the tip is no element's description
    expect(renderToStaticMarkup(<TipLines lines={['Pause pipes · P']} mod={null} name={null} />)).toBe('<div>Pause pipes · P</div>');
  });

  // ledger ruling P2-R24c: since P2-R32 a recipe slot's name says its chance and what a run takes of it, which its tip says on lines of their
  // own. A line whose parts all equal parts of the name, wherever it stands, is not heard twice; a line that says it in other words stays
  it('drops a line that equals a part of the name wherever it stands, and keeps one that says it in other words', () => {
    expect(describedLines(['Tiny Pile of Dust', '10% chance', '1/min in the line'], null, 'Tiny Pile of Dust, 10% chance')).toEqual(['1/min in the line']);
    // a slot's tip as the recipe card writes it: the line of what a run makes stands between the good's name and its chance
    expect(describedLines(['Tiny Pile of Dust', 'Tiny Pile of Dust per run', '10% chance', '1/min in the line'], null, 'Tiny Pile of Dust, 10% chance'))
      .toEqual(['Tiny Pile of Dust per run', '1/min in the line']);
    expect(describedLines(['1x Copper Wire', '2× 1x Copper Wire per run', '10% chance', '30/min in the line'], 'GregTech', '1x Copper Wire, 2 per run, 10% chance'))
      .toEqual(['2× 1x Copper Wire per run', '30/min in the line', 'GregTech']);   // "2 per run" said again in other words stays
    // the lines it drops are the ones TipLines hides
    const tip = renderToStaticMarkup(<TipLines lines={['Tiny Pile of Dust', 'Tiny Pile of Dust per run', '10% chance', '1/min in the line']} mod={null}
      name="Tiny Pile of Dust, 10% chance" />);
    expect(tip).toBe('<div aria-hidden="true">Tiny Pile of Dust</div><div>Tiny Pile of Dust per run</div><div aria-hidden="true"><span class="fig">10</span>% chance</div>'
      + '<div><span class="fig">1</span>/min in the line</div>');
  });
});
