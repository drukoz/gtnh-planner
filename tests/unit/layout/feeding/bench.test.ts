// tests/unit/layout/feeding/bench.test.ts
import { describe, expect, it } from 'vitest';
import type { ScenarioName } from '../../../../src/server/layout/feeding/contract.ts';
import type { FeedModel } from '../../../../src/server/layout/feeding/model.ts';
import { bench } from '../../../../src/server/layout/feeding/sim/bench.ts';
import type { SimEnv } from '../../../../src/server/layout/feeding/sim/machine.ts';
import { runScenario, type ScenarioOptions, type ScenarioRun } from '../../../../src/server/layout/feeding/sim/run.ts';
import { benchNode, feeder, handModel, hvExport, outputChestNode, taker } from '../../../helpers/feeding-fixtures.ts';

const flood = Array.from({ length: 8 }, (_, slot) => [slot, 't:fine@0', 64] as [number, string, number]);

/** `model` run scheduled and tick by tick; the two runs must be deep-equal (Task 4 rule 3). Returns the scheduled one. */
function both(model: FeedModel, opts: Omit<ScenarioOptions, 'exhaustive'>, scenario: ScenarioName = 'steady'): ScenarioRun {
  const [scheduled, exhaustive] = [false, true].map((x) => runScenario(model, scenario, { ...opts, exhaustive: x }));
  expect(scheduled).toEqual(exhaustive);
  return scheduled!;
}

/** The bench at `0,0,0` holding `stacks` at tick 0 (`runScenario`'s `initial`). */
const holding = (...stacks: Array<[slot: number, key: string, count: number]>) => ({ '0,0,0': stacks });

/** A bench with a chest behind it (its back, side 3, faces `0,0,1`). */
const withChest = (node = benchNode()) => handModel([node, outputChestNode('0,0,1')]);

/** The container bench: one Wet Cell and one Alpha make one Ex, and the Wet Cell's container is a Dry Cell unless `containers` says otherwise. */
const cellBench = (containers: Record<string, string> = { 't:wet@0': 't:dry@0' }) =>
  benchNode({ grid: ['t:wet@0', 't:a@0', null, null, null, null, null, null, null], result: { key: 't:x@0', amount: 1 }, containers });

const brief = (r: ScenarioRun) => r.findings.map((f) => [f.code, f.tick, f.count]);

/** The environment of a run of `model` that runs no tick: for looking at one inventory directly. */
function envOf(model: FeedModel): SimEnv {
  let env: SimEnv | undefined;
  runScenario(model, 'steady', { ticks: 0, restartAt: 0, extra: (e) => { env = e; return []; } });
  return env!;
}

describe('the Auto Workbench', () => {
  it('deletes stacks when flooded with one ingredient', () => {
    const model = handModel([benchNode(), outputChestNode('0,0,1')]);
    const [run, again] = [false, true].map((exhaustive) => runScenario(model, 'steady', { ticks: 100, restartAt: 50, exhaustive, initial: { '0,0,0': flood } }));
    expect(run).toEqual(again);
    // MV: 2,048 EU after the gain of tick 15, then 20 counted ticks: the first update at 34. Tick 34 moves slots 1, 3, 5, 7 to
    // slot 18 (three overwritten) and pushes one stack; tick 35 moves 2 and 6 (one overwritten); tick 36 moves 4; 64 stay in slot 0
    expect(run!.stats.arrivals('0,0,1')).toEqual([[34, 't:fine@0', 64], [35, 't:fine@0', 64], [36, 't:fine@0', 64]]);
    expect(run!.findings.map((f) => [f.code, f.count])).toEqual([['feed_overfill', undefined], ['feed_bench_eject', 448], ['feed_bench_delete', 256]]);
    expect(run!.findings[2]!.text).toBe('Auto Workbench (MV) at 0 0 0 destroyed 256 items (256× Fine Wire): its clean-up of stacks of one ingredient overwrites the stack it already moved to its result slot');
    // the rest of the findings: one item in eight input slots from tick 0, and the moves of 34, 35 and 36, all duplicates
    expect(brief(run!)).toEqual([['feed_overfill', 0, undefined], ['feed_bench_eject', 34, 448], ['feed_bench_delete', 34, 256]]);
    expect(run!.findings.slice(0, 2).map((f) => f.text)).toEqual([
      'Fine Wire fills 8 input slots of Auto Workbench (MV) at 0 0 0',
      'Auto Workbench (MV) at 0 0 0 threw 448 items out of its input slots (448× Fine Wire): its clean-up moves the second of two stacks of one '
        + 'ingredient to its result slot',
    ]);
    expect(run!.stats.final('0,0,0').slice(0, 19)).toEqual([['t:fine@0', 64], ...Array.from({ length: 18 }, () => null)]);
  });

  it('takes any item into its input slots and lets out only its output slots and result', () => {
    const node = benchNode();
    const env = envOf(handModel([node]));
    const b = bench(node, env);
    const [resin, fine, carbon] = ['t:resin@0', 't:fine@0', 't:carbon@0'].map((k) => env.keys.id(k)) as [number, number, number];
    // mode 0: any item, from any face (its front 2 and its back 3 too), into slots 0–8 only
    expect([0, 1, 2, 3, 4, 5].map((side) => b.canInsert(0, resin, side))).toEqual([true, true, true, true, true, true]);
    expect([8, 9, 17, 18, 19, 28].map((slot) => b.canInsert(slot, resin, 1))).toEqual([true, false, false, false, false, false]);
    expect(b.insert(0, resin, 64, null)).toBe(64);
    // a full slot takes no more, and another slot takes the same item (no Multi Stack rule, research §1.3.1)
    expect([b.canInsert(0, resin, 1), b.canInsert(0, fine, 1), b.canInsert(1, resin, 1)]).toEqual([false, false, true]);
    expect([0, 8, 9, 17, 18, 19].map((slot) => b.canExtract(slot, resin, 3))).toEqual([false, false, true, true, true, false]);
    expect(b.sideSlots(4)).toEqual(Array.from({ length: 19 }, (_, i) => i));
    expect(b.slotCount()).toBe(30);
    // every grid cell counts one of its item (Resin in cells 0 and 2), as EnderIO's Limited Item Filter sees it
    expect([b.countAll(resin), b.countAll(fine), b.countAll(carbon)]).toEqual([66, 2, 1]);
    // a grid that holds an item keeps AE2's blocking mode from ever seeing it empty; an empty grid with empty slots is empty
    expect(bench(benchNode(), envOf(handModel([benchNode()]))).countsAsEmpty()).toBe(false);
    const blank = benchNode({ grid: Array.from({ length: 9 }, () => null) });
    expect(bench(blank, envOf(handModel([blank]))).countsAsEmpty()).toBe(true);
  });

  it('crafts from the highest slot first and pushes its result', () => {
    const run = both(withChest(), { ticks: 100, restartAt: 100, initial: holding([0, 't:resin@0', 2], [1, 't:fine@0', 2], [2, 't:wire@0', 2], [3, 't:carbon@0', 1]) });
    // one cell after another, from cell 8 down, each from the highest slot that holds its item: slot 1's Fine Wire for cell 7 first
    expect(run.stats.benchCrafts('0,0,0')).toEqual([34]);
    expect(run.stats.arrivals('0,0,1')).toEqual([[34, 't:resistor@0', 1]]);
    expect(run.stats.final('0,0,0').slice(0, 4)).toEqual([null, null, null, null]);
    expect(run.findings).toEqual([]);
    expect(run.runs).toEqual({ w: 1 });
    // with a third Fine Wire in slot 5, cell 7 takes it from slot 5 and cell 1 from slot 1, which keeps one
    const more = both(withChest(), {
      ticks: 100, restartAt: 100, initial: holding([0, 't:resin@0', 2], [1, 't:fine@0', 2], [2, 't:wire@0', 2], [3, 't:carbon@0', 1], [5, 't:fine@0', 1]),
    });
    expect(more.stats.benchCrafts('0,0,0')).toEqual([34]);
    expect(more.stats.final('0,0,0').slice(0, 6)).toEqual([null, ['t:fine@0', 1], null, null, null, null]);
  });

  it('throws out a stray', () => {
    const initial = holding([3, 't:x@0', 5]);
    const run = both(withChest(), { ticks: 100, restartAt: 100, initial });
    // the update at 34 moves on from slot 0 past the empty slots 1 and 2 to slot 3, whose Ex is not in its grid
    expect(run.stats.arrivals('0,0,1')).toEqual([[34, 't:x@0', 5]]);
    expect(brief(run)).toEqual([['feed_overfill', 0, undefined], ['feed_bench_eject', 34, 5]]);
    expect(run.findings.map((f) => [f.key, f.text])).toEqual([
      ['t:x@0', 'Auto Workbench (MV) at 0 0 0 took Ex, which is not in its grid'],
      [undefined, 'Auto Workbench (MV) at 0 0 0 threw 5 items out of its input slots (5× Ex): it took items that are not in its grid'],
    ]);
    // nothing behind it: Ex stays in its result slot, and the bench does nothing more
    const stuck = both(handModel([benchNode()]), { ticks: 2_000, restartAt: 2_000, initial });
    expect(brief(stuck)).toEqual([['feed_overfill', 0, undefined], ['feed_bench_eject', 34, 5], ['feed_bench_stuck', 34, undefined]]);
    expect([stuck.findings[2]!.key, stuck.findings[2]!.text])
      .toEqual(['t:x@0', 'Auto Workbench (MV) at 0 0 0 stopped: Ex sits in its result slot and the block behind it does not take it']);
    // stuck from 34 counts only once it has lasted STALL_TICKS: not over 1,233 ticks, over 1,234 it has
    expect(both(handModel([benchNode()]), { ticks: 1_233, restartAt: 1_233, initial }).findings.map((f) => f.code)).not.toContain('feed_bench_stuck');
    expect(both(handModel([benchNode()]), { ticks: 1_234, restartAt: 1_234, initial }).findings.map((f) => f.code)).toContain('feed_bench_stuck');
  });

  it('empties its last slot on a failed craft', () => {
    const run = both(withChest(), { ticks: 100, restartAt: 100, initial: holding([0, 't:resin@0', 2], [1, 't:fine@0', 2], [2, 't:wire@0', 2], [8, 't:wire@0', 1]) });
    // no Carbon Dust: the craft at 34 fails, so slot 8 goes to slot 18 and out; at 35 (and after) nothing else moves
    expect(run.stats.arrivals('0,0,1')).toEqual([[34, 't:wire@0', 1]]);
    expect(run.stats.final('0,0,0').slice(0, 9)).toEqual([['t:resin@0', 2], ['t:fine@0', 2], ['t:wire@0', 2], null, null, null, null, null, null]);
    expect(run.stats.benchCrafts('0,0,0')).toEqual([]);
    // Wire stood in two input slots (2 and 8) from tick 0
    expect(brief(run)).toEqual([['feed_overfill', 0, undefined], ['feed_bench_eject', 34, 1]]);
    expect(run.findings.map((f) => f.text)).toEqual([
      'Wire fills 2 input slots of Auto Workbench (MV) at 0 0 0',
      'Auto Workbench (MV) at 0 0 0 threw 1 item out of its input slots (1× Wire): a failed craft empties its last input slot',
    ]);
  });

  it('crafts as fast as its energy allows', () => {
    const lv = benchNode({ tier: 1 });
    expect(lv.label).toBe('Auto Workbench (LV) at 0 0 0');
    const run = both(withChest(lv), { ticks: 300, restartAt: 300, initial: holding([0, 't:resin@0', 6], [1, 't:fine@0', 6], [2, 't:wire@0', 6], [3, 't:carbon@0', 3]) });
    // LV: 32 EU a tick and 2,048 at most, so 64 ticks of gains for each craft (research §1.3.7: 0.31/s)
    expect(run.stats.benchCrafts('0,0,0')).toEqual([82, 146, 210]);
    expect(run.stats.arrivals('0,0,1')).toEqual([82, 146, 210].map((t) => [t, 't:resistor@0', 1]));
    expect(run.findings).toEqual([]);
  });

  it('crafts every 33 ticks when a container comes back', () => {
    const initial = holding([0, 't:wet@0', 4], [1, 't:a@0', 4]);
    const run = both(withChest(cellBench()), { ticks: 200, restartAt: 200, initial });
    // the push moves the Dry Cell first, the result waits a tick, and that tick's update starts the 32-tick countdown
    expect(run.stats.benchCrafts('0,0,0')).toEqual([34, 67, 100, 133]);
    expect(run.stats.arrivals('0,0,1').slice(0, 4)).toEqual([[34, 't:dry@0', 1], [35, 't:x@0', 1], [67, 't:dry@0', 1], [68, 't:x@0', 1]]);
    expect(run.findings).toEqual([]);
    // the same grid without a container crafts at each update that has the energy: then the energy limits it
    expect(both(withChest(cellBench({})), { ticks: 200, restartAt: 200, initial }).stats.benchCrafts('0,0,0')).toEqual([34, 35, 48, 64]);
  });

  it('forgets its countdown on a restart', () => {
    const model = withChest(cellBench());
    const opts = { ticks: 600, restartAt: 500, initial: holding([0, 't:wet@0', 64], [1, 't:a@0', 64]) };
    const crafts = both(model, opts, 'restart').stats.benchCrafts('0,0,0');
    expect(crafts.filter((t) => t < 500)).toEqual(Array.from({ length: 15 }, (_, i) => 34 + 33 * i));   // 34, 67, …, 496
    // the countdown starts again at 20 from tick 500; without the restart the next craft is 33 ticks after 496
    expect(crafts.find((t) => t >= 500)).toBe(519);
    expect(both(model, opts).stats.benchCrafts('0,0,0').find((t) => t >= 500)).toBe(529);
  });

  it('is slow when its ingredient comes slower than the plan needs', () => {
    // one Alpha makes one Ex; the plan wants an Alpha a second, and a feeder brings one every 100 ticks (0.2/s)
    const node = benchNode({ grid: ['t:a@0', null, null, null, null, null, null, null, null], result: { key: 't:x@0', amount: 1 } });
    const model = handModel([node, outputChestNode('0,0,1')], { planned: { w: { 't:a@0': 1 } } });
    const fed = (every: number) => (env: SimEnv) => [feeder(env, '0,0,0', 1, ['t:a@0'], 1, every, 0)];
    const slow = both(model, { ticks: 2_000, restartAt: 2_000, extra: fed(100) });
    // its updates between the deliveries find no Alpha in slots 0–17: its recipe waits for it nearly all the time
    expect(slow.findings.map((f) => [f.code, f.key, f.text])).toEqual([['feed_slow', 't:a@0', 'Auto Workbench (MV) at 0 0 0 gets Alpha at 0.2/s, below the 1/s the plan needs']]);
    expect(slow.runs).toEqual({ w: 20 });
    // fed at the plan's rate, it keeps up
    expect(both(model, { ticks: 2_000, restartAt: 2_000, extra: fed(20) }).findings).toEqual([]);
  });

  it('waits for a slow taker behind it without being stuck while it gives what the plan asks of it', () => {
    // one Alpha makes one Ex; the chest behind it is full of Ex, and a taker frees one every 2,000 ticks: each take lets one push
    // out and ends a wait of about 2,000 ticks (research §7: a push line's machines run ahead of their takers and wait)
    const node = benchNode({ grid: ['t:a@0', null, null, null, null, null, null, null, null], result: { key: 't:x@0', amount: 1 } });
    const full = Array.from({ length: 27 }, (_, slot) => [slot, 't:x@0', 64] as [number, string, number]);
    const at = Array.from({ length: 11 }, (_, i) => 2_000 * (i + 1));
    const go = (plannedOut?: FeedModel['plannedOut']) => both(handModel([node, outputChestNode('0,0,1')], plannedOut === undefined ? {} : { plannedOut }), {
      ticks: 24_000, restartAt: 24_000, initial: { '0,0,1': full },
      extra: (env) => [feeder(env, '0,0,0', 1, ['t:a@0'], 1, 1_000, 0), taker(env, '0,0,1', 2, 1, at)],
    });
    // the run's second half pushes 6 Ex out in 600 s: the 0.01/s the plan asks of it
    expect(go({ w: { 't:x@0': 0.01 } }).findings).toEqual([]);
    // a plan that asks 0.02/s of it, and a model that does not say: its first wait, from its first craft at 34, counts
    expect(go({ w: { 't:x@0': 0.02 } }).findings.map((f) => [f.code, f.key, f.tick])).toEqual([['feed_bench_stuck', 't:x@0', 34]]);
    expect(go().findings.map((f) => [f.code, f.key, f.tick])).toEqual([['feed_bench_stuck', 't:x@0', 34]]);
  });

  it('lets its covers act first in its tick', () => {
    // nothing behind it, but an HV export conveyor on its east side takes the stray out of its result slot at 40: nothing is stuck
    const node = benchNode({ id: '1,0,0' });
    const model = handModel([node, outputChestNode('2,0,0')], { covers: [hvExport('1,0,0', 5)] });
    const run = both(model, { ticks: 2_000, restartAt: 2_000, initial: { '1,0,0': [[3, 't:x@0', 5]] } });
    expect(run.stats.arrivals('2,0,0')).toEqual([[40, 't:x@0', 5]]);
    expect(run.findings.map((f) => f.code)).toEqual(['feed_overfill', 'feed_bench_eject']);
  });
});
