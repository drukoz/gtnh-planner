// The key-numbers strip (Phase 2 spec §10, Task 7): what the plan makes, its peak power, its machines and what it costs to build and to
// run (a Make N batch's raw material in place of the last), five readout tiles above the plan banner. The model reads them from the plan
// (`keyNumbers`), counts its machines as the build list does (`machineCount`), writes a big figure compactly (`compactNumber`) and eases a
// changed figure from the last one shown (`countUpAt`); the component draws the final values in the server's markup, with no live region.

import { describe, it, expect } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { compactNumber, countUpAt, keyNumbers, machineCount } from '../../src/client/views/key-numbers.ts';
import { KeyNumbers } from '../../src/client/views/KeyNumbers.tsx';
import { defaultSettings } from '../../src/shared/project/apply-op.ts';
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
    expect(html).toContain('<div class="key-number" data-key-number="output"><dt><span>Output</span></dt><dd><span aria-hidden="true">—</span><span class="visually-hidden">—</span></dd></div>');
    expect(html).not.toContain('t:plate@0');
  });
  it('writes big numbers compactly, three significant digits', () => {
    expect([99_999, 100_000, 540_000, 999_999, 5_400_000, 12_345_678, 2_500_000_000].map(compactNumber)).toEqual(['99,999', '100k', '540k', '1M', '5.4M', '12.3M', '2.5G']);
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
    expect(renderToStaticMarkup(<KeyNumbers plan={plan} settings={defaultSettings()} />)).toBe('');   // no target, no strip
  });
});
