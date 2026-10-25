// The key-numbers strip (Phase 2 spec §10, Task 7): what the plan makes, its peak power, its machines and what it costs to build and to
// run (a Make N batch's raw material in place of the last), five readout tiles above the plan banner. The model reads them from the plan
// (`keyNumbers`), counts its machines as the build list does (`machineCount`), writes a big figure compactly (`compactNumber`) and eases a
// changed figure from the last one shown (`countUpAt`); the component draws the final values in the server's markup, with no live region.

import { describe, it, expect } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { compactNumber, countUpAt, keyNumbers, machineCount, nextCount, nextFlash, planUnit, type Count } from '../../src/client/views/key-numbers.ts';
import { KeyNumbers } from '../../src/client/views/KeyNumbers.tsx';
import { PlanBanner } from '../../src/client/views/ProjectPage.tsx';
import { defaultSettings } from '../../src/shared/project/apply-op.ts';
import { settingsHash } from '../../src/shared/project/settings-hash.ts';
import type { Plan, PlanStep } from '../../src/shared/types/plan.ts';

// copies of plan-banner.test.tsx's helpers
const step = (p: Partial<PlanStep> & Pick<PlanStep, 'id'>): PlanStep => ({
  recipeId: p.id, mapId: 'gt.recipe.assembler', machine: { mteId: 121, name: 'Basic Assembler', tier: 1 }, count: 1, owned: 0,
  runsPerSecond: 0.5, utilization: 0.5, euPerTick: 16, durationTicks: 100, overclocks: 0, inputs: [], outputs: [], alternatives: [],
  handCraft: false, warnings: [], ...p,
});
const planOf = (p: Partial<Plan>): Plan => ({
  settingsHash: 'h', exportId: 'e', tier: 1, reachable: [], unlocks: [], steps: [], flows: [], rawInputs: [], byproducts: [],
  power: { peakEUt: 0, averageEUt: 0, voltageTier: 1, amps: 0 }, buildList: [], buildSteps: [], warnings: [], status: 'ok', ...p,
});

const RATE = { mode: 'rate', per: 'min', amount: 30 } as const;
const plan = planOf({ target: 't:plate@0', targetPerSecond: 0.5, names: { 't:plate@0': 'Iron Plate' }, power: { peakEUt: 512, averageEUt: 300, voltageTier: 2, amps: 2 },
  steps: [step({ id: 'a', count: 3, owned: 1 })], cost: { runPerHour: 5400, build: 182, horizonHours: 24 } });

describe('the key-numbers strip', () => {
  it('reads the five tiles of a running line', () => {
    expect(keyNumbers(plan, RATE)!.map((n) => [n.id, n.label, n.value, n.text, n.unit, n.sub])).toEqual([
      ['output', 'Output', 30, '30', '/min', 'Iron Plate'], ['power', 'Peak power', 512, '512', 'EU/t', 'MV · 2 A'], ['machines', 'Machines', 3, '3', '', '2 new'],
      ['build', 'To build', 182, '182', 'raw', 'over 24 h'], ['run', 'To run', 5400, '5,400', 'raw/h', '']]);
  });
  it('reads Make N\'s count, time and batch', () => {
    const batch = { ...plan, makeN: { totalSeconds: 600, leftovers: [] }, cost: { runPerHour: 0, build: 182, horizonHours: null, batch: 192 } };
    const tiles = keyNumbers(batch, { mode: 'makeN', per: 'min', amount: 64 })!;
    expect(tiles[0]).toMatchObject({ id: 'output', value: 64, text: '64', unit: '', sub: '10 min' }); expect(tiles[3]!.sub).toBe('for the batch');
    expect(tiles[4]).toMatchObject({ id: 'batch', label: 'Batch', value: 192, text: '192', unit: 'raw', sub: '' });
  });
  it('reads a fluid in litres, and a rare rate in words that never counts up', () => {
    expect(keyNumbers(planOf({ target: 'fluid:water', targetPerSecond: 2 }), { ...RATE, per: 'hour' })![0]).toMatchObject({ value: 7200, text: '7,200', unit: 'L/h' });
    expect(keyNumbers(planOf({ target: 't:x@0', targetPerSecond: 1 / (526 * 86400) }), RATE)![0]).toMatchObject({ value: null, text: '1 every 526 days', unit: '', words: true });
  });
  it('qualifies the build cost: not counted, or what it leaves out', () => {
    expect(keyNumbers(planOf({ cost: { runPerHour: 1, build: 2, horizonHours: null } }), RATE)![3]!.sub).toBe('not counted');
    expect(keyNumbers(planOf({ cost: { runPerHour: 1, build: 2, horizonHours: 168, unpriced: 4 } }), RATE)![3]!.sub).toBe('+4 not counted');
    expect(keyNumbers(planOf({ cost: { runPerHour: 1, build: 2, horizonHours: null, unpriced: 4 } }), RATE)![3]!.sub).toBe('not counted');   // none of it is
    expect(keyNumbers(planOf({ makeN: { totalSeconds: 60, leftovers: [] }, cost: { runPerHour: 0, build: 2, horizonHours: null, batch: 9, unpriced: 4 } }),
      { mode: 'makeN', per: 'min', amount: 1 })![3]!.sub).toBe('+4 not counted');                                                               // before "for the batch"
    expect(keyNumbers(planOf({}), RATE)![3]).toMatchObject({ value: null, text: '—' });   // no cost
  });
  it('counts a pool once and skips hand and pseudo steps', () => {
    expect(machineCount({ steps: [step({ id: 'a', count: 2, pool: { id: 'pool:a', steps: ['a', 'b'] } }), step({ id: 'b', count: 2, pool: { id: 'pool:a', steps: ['a', 'b'] } }),
      step({ id: 'h', count: 1, handCraft: true }), step({ id: 'c', count: 1, machine: { mteId: -1, name: 'Crafting table', tier: 0 } })] })).toEqual({ total: 2, new: 2 });
  });
  it(`counts a Make N batch's machine type once, as the build list and the Compare card do`, () => {
    const steps = [step({ id: 'a' }), step({ id: 'b' }), step({ id: 'w', machine: { mteId: 111, name: 'Basic Wiremill', tier: 1 }, count: 2, owned: 1 })];
    expect(machineCount({ steps, makeN: { totalSeconds: 60, leftovers: [] } })).toEqual({ total: 3, new: 2 });   // one Basic Assembler shared by a and b
    expect(machineCount({ steps })).toEqual({ total: 4, new: 3 });                                               // a running line: each step its own machines
  });
  it('shows dashes for a plan that cannot run, and nothing while one is on its way', () => {
    expect(keyNumbers(planOf({ status: 'infeasible' }), RATE)!.map((n) => n.text)).toEqual(['—', '—', '—', '—', '—']); expect(keyNumbers(null, RATE)).toBeNull();
    expect(keyNumbers(planOf({ status: 'empty', warnings: [{ code: 'no-target', text: 'Pick something to make' }] }), RATE)![0]).toMatchObject({ id: 'output', text: '—', sub: '' });   // a plan that names no target: no key, no name
  });
  it('names the plan\'s own target, never a newer pick whose first plan is on its way', () => {
    // the page still holds the no-target plan while a just-picked target's plan comes: only the Settings button and the panel name the pick
    const waiting = planOf({ status: 'empty', warnings: [{ code: 'no-target', text: 'Pick something to make' }] });
    const html = renderToStaticMarkup(<KeyNumbers plan={waiting} settings={{ ...defaultSettings(), target: 't:plate@0' }} />);
    expect(html).toContain('<div class="key-number" data-key-number="output"><dt><span>Output</span></dt><dd><span aria-hidden="true">—</span><span class="visually-hidden">not available</span></dd></div>');
    expect(html).not.toContain('t:plate@0');
  });
  // ledger ruling P2-R48 (fix round 1, I1): the wait box is the strip's own grid, so it is as tall as the loaded strip at every width; Task 8
  // fills it with the strip's skeleton, whose five blocks are the grid's (the skeleton draws no box of its own: they take the grid's columns)
  it('keeps the strip\'s place while its plan is on its way: five empty blocks in the strip\'s grid', () => {
    const wait = renderToStaticMarkup(<KeyNumbers plan={null} settings={{ ...defaultSettings(), target: 't:plate@0' }} />);
    expect(wait).toBe(`<div class="key-numbers-wait" aria-hidden="true"><div class="skeleton skeleton-strip" aria-hidden="true">${'<div class="skeleton-block"></div>'.repeat(5)}</div></div>`);
  });
  // fix round 1, I2 (spec §10.1: the exact figures stay in the visually hidden value): the tile writes 540k, a screen reader hears 540,000
  it('gives a screen reader the exact figure a tile writes compactly', () => {
    const big = planOf({ ...plan, power: { peakEUt: 2.5e9, averageEUt: 1, voltageTier: 9, amps: 16 }, cost: { runPerHour: 5400, build: 540_000, horizonHours: 24 } });
    const tiles = keyNumbers(big, RATE)!;
    expect([tiles[1], tiles[3], tiles[4]].map((n) => [n!.text, n!.spoken])).toEqual([['2.5G', '2,500,000,000'], ['540k', '540,000'], ['5,400', '5,400']]);
    const html = renderToStaticMarkup(<KeyNumbers plan={big} settings={{ ...defaultSettings(), target: 't:plate@0', amount: 30, per: 'min' }} />);
    expect(html).toContain('<span aria-hidden="true">2.5G</span><span class="visually-hidden">2,500,000,000</span><span class="key-number-unit">EU/t</span>');
    expect(html).toContain('<span aria-hidden="true">540k</span><span class="visually-hidden">540,000</span><span class="key-number-unit">raw</span>');
  });
  // fix round 1, M5: a dash has words a screen reader says, where a lone "—" is often skipped
  it('gives a dash words a screen reader says', () => {
    expect(keyNumbers(planOf({ status: 'infeasible' }), RATE)!.map((n) => n.spoken)).toEqual(Array(5).fill('not available'));
    expect(keyNumbers(planOf({}), RATE)![3]).toMatchObject({ text: '—', spoken: 'not available' });   // no cost
    expect(keyNumbers(planOf({ target: 't:x@0', targetPerSecond: 1 / (526 * 86400) }), RATE)![0]!.spoken).toBe('1 every 526 days');
  });
  // fix round 1, M2: the strip is a screen reader's one source of the plan's cost, so the build tile says every qualifier the cost sentence
  // gives, the one it shows first and those it leaves out; and the sentence itself is hidden from a screen reader while the strip says it,
  // and gone with no target (M8), where the strip shows nothing either
  it('says every qualifier of the build cost once, the one shown and those it leaves out', () => {
    const counted = planOf({ cost: { runPerHour: 1, build: 2, horizonHours: 168, unpriced: 4 } });
    expect([keyNumbers(counted, RATE)![3]!.sub, keyNumbers(counted, RATE)![3]!.more]).toEqual(['+4 not counted', 'over 1 week']);
    const ignored = keyNumbers(planOf({ cost: { runPerHour: 1, build: 2, horizonHours: null, unpriced: 4 } }), RATE)![3]!;
    expect([ignored.sub, ignored.more]).toEqual(['not counted', '+4 not counted']);
    const batch = keyNumbers(planOf({ makeN: { totalSeconds: 60, leftovers: [] }, cost: { runPerHour: 0, build: 2, horizonHours: null, batch: 9, unpriced: 4 } }),
      { mode: 'makeN', per: 'min', amount: 1 })![3]!;
    expect([batch.sub, batch.more]).toEqual(['+4 not counted', 'for the batch']);
    expect(keyNumbers(plan, RATE)!.map((n) => n.more)).toEqual([undefined, undefined, undefined, undefined, undefined]);
    const html = renderToStaticMarkup(<KeyNumbers plan={counted} settings={{ ...defaultSettings(), target: 't:plate@0' }} />);
    expect(html).toContain('<dt><span>To build</span><span class="key-number-sub">+4 not counted</span><span class="visually-hidden">over 1 week</span></dt>');
  });
  it('leaves the cost sentence to the strip: hidden from a screen reader while the strip says it, gone with no target', () => {
    const costed = planOf({ cost: { runPerHour: 5400, build: 182, horizonHours: 24 } });
    const banner = (cost?: 'sentence' | 'strip' | 'none'): string =>
      renderToStaticMarkup(<PlanBanner plan={costed} planError={null} planLoading={false} settings={defaultSettings()} send={() => {}} cost={cost} />);
    expect(banner()).toMatch(/^<p class="plan-cost">5,400 raw per hour to run/);                       // the default, which plan-banner.test.tsx pins
    expect(banner('strip')).toMatch(/^<p class="plan-cost" aria-hidden="true">5,400 raw per hour to run/);
    expect(banner('none')).toBe('');
  });
  // fix round 1, M3: a rate is shown in the unit its plan was made in. Changing the unit (minutes to hours) leaves the tile as it is until the
  // plan of the new unit comes, which then shows at once (useCountUp: a new unit counts from nothing); a new amount on its way counts up
  it('shows a rate in the unit its plan was made in while the plan of another unit is on its way', () => {
    expect(keyNumbers(plan, { ...RATE, per: 'hour' })![0]).toMatchObject({ value: 30, text: '30', unit: '/min' });   // the plan of 30 a minute
    expect(keyNumbers(planOf({ ...plan, targetPerSecond: 30 / 3600 }), { ...RATE, per: 'hour' })![0]).toMatchObject({ text: '30', unit: '/h' });
    expect(keyNumbers(plan, { ...RATE, amount: 60 })![0]).toMatchObject({ value: 30, unit: '/min' });                // a new amount on its way
    expect(keyNumbers(planOf({ ...plan, targetPerSecond: 60 / 3600 }), { ...RATE, amount: 60 })![0]).toMatchObject({ text: '60', unit: '/h' });   // and back
  });
  // fix round 2, ledger ruling P2-R49: the strip knows the unit of the plan on screen from the settings it drew (their settingsHash, which the
  // plan carries), and guesses it (fix round 1's `planPer`) only for settings it never drew. Typing an amount and then picking a unit lands in
  // one replan: the plan of 30 a minute stays "30 /min" under settings of 60 an hour, and the plan of 60 an hour then shows "60 /h" at once,
  // with no count and no flash; an amount alone, in its unit, still counts up and flashes (key-numbers.spec.ts's 30 → 60)
  it('knows the unit of the plan on screen from the settings it drew, so an amount and a unit changed in one replan never mix', () => {
    const drawn = (amount: number, per: 'min' | 'hour') => ({ ...defaultSettings(), target: 't:plate@0', amount, per });
    const [minute30, minute60, hour60] = [drawn(30, 'min'), drawn(60, 'min'), drawn(60, 'hour')];
    const onScreen = planOf({ ...plan, settingsHash: settingsHash(minute30) });                                  // 0.5 a second
    const arrived = planOf({ ...plan, settingsHash: settingsHash(hour60), targetPerSecond: 60 / 3600 });
    const units = new Map<string, 'min' | 'hour'>();
    expect([minute30, minute60, hour60].map((s) => planUnit(units, s, onScreen))).toEqual(['min', 'min', 'min']);   // one plan, three renders
    expect(keyNumbers(onScreen, hour60, planUnit(units, hour60, onScreen))![0]).toMatchObject({ value: 30, text: '30', unit: '/min' });
    const next = keyNumbers(arrived, hour60, planUnit(units, hour60, arrived))![0]!;
    expect(next).toMatchObject({ text: '60', unit: '/h' });
    // when it comes, the tile's two steps: the figure at once, never counted from 30 /min, and no flash: another unit, another figure
    expect(nextCount({ from: 30, to: 30, unit: '/min', shown: 30 }, next.value, next.unit, () => false)).toEqual({ from: next.value, to: next.value, unit: '/h', shown: next.value });
    const shown = { text: '30', unit: '/min', figure: true, changes: 0, running: false };
    expect(nextFlash(shown, next)).toEqual({ text: '60', unit: '/h', figure: true, changes: 0, running: false });
    expect(nextFlash(shown, { text: '60', unit: '/min', value: 60 })).toEqual({ text: '60', unit: '/min', figure: true, changes: 1, running: true });
    expect(nextFlash(shown, { text: '30', unit: '/min', value: 30 })).toBe(shown);                                // nothing changed
    // a dash's figure coming flashes, as any changed text does; settings never drawn here leave the guess
    expect(nextFlash({ text: '—', unit: '', figure: false, changes: 0, running: false }, { text: '30', unit: '/min', value: 30 })).toMatchObject({ changes: 1, running: true });
    expect(planUnit(new Map(), hour60, onScreen)).toBeUndefined();
  });
  // fix round 1, M3 and M4: useCountUp's step (`nextCount`), the same target changing nothing, a new one counting on from the figure shown, and
  // at once from a dash, to a dash, in another unit and under reduced motion
  it('counts on from the figure shown, and at once from or to a dash, in another unit and under reduced motion', () => {
    const at = (shown: number | null, unit = '/min'): Count => ({ from: shown, to: shown, unit, shown });
    const moving = (): boolean => false;
    const counting: Count = { from: 30, to: 60, unit: '/min', shown: 45 };
    expect(nextCount(counting, 60, '/min', moving)).toBe(counting);                                            // the same target: nothing changes
    expect(nextCount(at(30), 60, '/min', moving)).toEqual({ from: 30, to: 60, unit: '/min', shown: 30 });      // counts on from 30
    expect(nextCount(counting, 90, '/min', moving)).toEqual({ from: 45, to: 90, unit: '/min', shown: 45 });    // from where it stands
    expect(nextCount(at(null, ''), 30, '/min', moving)).toEqual(at(30));                                     // from a dash: at once
    expect(nextCount(at(30), null, '', moving)).toEqual(at(null, ''));                                        // to a dash: at once
    expect(nextCount(at(30), 1800, '/h', moving)).toEqual(at(1800, '/h'));                                    // another unit: never from 30
    expect(nextCount(at(30), 60, '/min', () => true)).toEqual(at(60));                                       // reduced motion: at once
  });
  it('writes big numbers compactly, three significant digits', () => {
    expect([99_999, 100_000, 540_000, 999_999, 5_400_000, 12_345_678, 2_500_000_000].map(compactNumber)).toEqual(['99,999', '100k', '540k', '1M', '5.4M', '12.3M', '2.5G']);
  });
  // fix round 1, M6: the form follows the figure as written, so 99,999.6, which rounds to 100,000, is 100k
  it('rounds a figure before it picks the compact form', () => {
    expect([99_999.4, 99_999.6, 999_999.6].map(compactNumber)).toEqual(['99,999', '100k', '1M']);
  });
  it('counts up easing out, from the last value to the new one, never backwards', () => {
    expect([0, 200, 400, 500].map((t) => countUpAt(0, 100, t))).toEqual([0, 87.5, 100, 100]); expect(countUpAt(100, 0, 200)).toBe(12.5);
    for (let t = 0, last = -1; t <= 400; t += 25) { const v = countUpAt(10, 90, t); expect(v).toBeGreaterThanOrEqual(last); last = v; }
  });
  it('draws the final values for a screen reader and the page, no live region', () => {
    const html = renderToStaticMarkup(<KeyNumbers plan={plan} settings={{ ...defaultSettings(), target: 't:plate@0', amount: 30, per: 'min' }} />);
    expect(html).toMatch(/^<section class="key-numbers" aria-label="Key numbers"><dl><div class="key-number" data-key-number="output"><dt><span>Output<\/span><span class="key-number-sub">Iron Plate<\/span><\/dt><dd><span aria-hidden="true">30<\/span><span class="visually-hidden">30<\/span><span class="key-number-unit">\/min<\/span><\/dd><\/div>/);
    expect(html).not.toMatch(/aria-live|role="status"/);
    const wait = renderToStaticMarkup(<KeyNumbers plan={null} settings={{ ...defaultSettings(), target: 't:plate@0' }} />);
    expect(wait).toMatch(/^<div class="key-numbers-wait" aria-hidden="true">/); expect(wait.replace(/<[^>]+>/g, '')).toBe('');   // Task 8 fills it
    expect(wait).toContain('<div class="key-numbers-wait" aria-hidden="true"><div class="skeleton skeleton-strip" aria-hidden="true">');   // with the strip's skeleton
    expect(renderToStaticMarkup(<KeyNumbers plan={plan} settings={defaultSettings()} />)).toBe('');   // no target, no strip
  });
});
