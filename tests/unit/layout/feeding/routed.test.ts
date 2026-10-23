// tests/unit/layout/feeding/routed.test.ts
import { describe, expect, it } from 'vitest';
import type { ItemFilterSpec, RoutedChipSpec, ScenarioName } from '../../../../src/server/layout/feeding/contract.ts';
import { prTravelTicks } from '../../../../src/server/layout/feeding/facts.ts';
import type { FeedModel } from '../../../../src/server/layout/feeding/model.ts';
import { precheckFeeding } from '../../../../src/server/layout/feeding/precheck.ts';
import { runScenario, type ScenarioOptions, type ScenarioRun } from '../../../../src/server/layout/feeding/sim/run.ts';
import {
  ebfNode, feedPack, feeder, inputChestNode, oneSlotNode, outputChestNode, prModel, simRecipe, sinkNode, smelterNode, taker, type PrPipeSpec,
} from '../../../helpers/feeding-fixtures.ts';

// chest 0,0,0 under its pipe 0,1,0; junctions; a sink machine h,0,0 under its pipe h,1,0 (h hops: h + 1 pipe lengths, 5 (h + 1) ticks at Passive speed)
const line = (extractor: string[] | null, sinkSlots = 1, h = 2) => prModel([inputChestNode('0,0,0', ['t:a@0']), sinkNode(`${h},0,0`, sinkSlots, 1)], [
  { id: '0,1,0', target: { node: '0,0,0', side: 1 }, chips: [{ kind: 'extractor', filter: { mode: 'whitelist', keys: extractor ?? [] } }] },
  ...Array.from({ length: h - 1 }, (_, i) => ({ id: `${i + 1},1,0` })),
  { id: `${h},1,0`, target: { node: `${h},0,0`, side: 1 }, chips: [{ kind: 'responder', filter: { mode: 'whitelist', keys: ['t:a@0'] } }] }]);

/** `model` run scheduled and tick by tick in `scenario`; the two runs must be deep-equal (Task 4 rule 3). Returns the scheduled one. */
function same(model: FeedModel, opts: Omit<ScenarioOptions, 'exhaustive'>, scenario: ScenarioName = 'steady'): ScenarioRun {
  const [scheduled, exhaustive] = [false, true].map((x) => runScenario(model, scenario, { ...opts, exhaustive: x }));
  expect(scheduled).toEqual(exhaustive);
  return scheduled!;
}

const whitelist = (...keys: string[]): ItemFilterSpec => ({ mode: 'whitelist', keys });
const responder = (...keys: string[]): RoutedChipSpec => ({ kind: 'responder', filter: whitelist(...keys) });
const extractor = (filter: ItemFilterSpec): RoutedChipSpec => ({ kind: 'extractor', filter });
const brief = (r: ScenarioRun) => r.findings.map((f) => [f.code, f.key, f.tick, f.count]);
const CHEST: PrPipeSpec = { id: '0,1,0', target: { node: '0,0,0', side: 1 }, chips: [extractor(whitelist('t:a@0'))] };
/** The junction pipes 1,1,0 … (h − 1),1,0. */
const junctions = (h: number): PrPipeSpec[] => Array.from({ length: h - 1 }, (_, i) => ({ id: `${i + 1},1,0` }));
const BOUNCE_TEXT = 'did not fit and circle its pipe, trying again every pipe length until there is room (its responder counted every empty slot as a '
  + 'stack, or a restart lost the count of what was on its way)';

describe('Project Red routed pipes', () => {
  it('moves one stack and counts it in transit', () => {
    const runs = [false, true].map((exhaustive) => runScenario(line(['t:a@0']), 'steady', { ticks: 1_000, restartAt: 1_000, exhaustive }));
    expect(runs[0]).toEqual(runs[1]);
    // the extractor acts at 9, 19, …; the 64 it queues at 9 leave the chest's pipe at 10 (one payload a tick, counted in the
    // sink's transit from then) and reach the sink at 25 (2 hops: 3 pipe lengths, 15 ticks); the act at 19 sees them in transit
    expect(runs[0]!.stats.dispatches('0,1,0')).toEqual([10]);
    expect(runs[0]!.stats.deliveries('2,0,0')).toEqual([[25, 't:a@0', 64]]);
    expect(runs[0]!.findings).toEqual([]);
  });

  it('moves nothing with a new Item Extractor Chip', () => {
    const run = same({ ...line(null), planned: { n: { 't:a@0': 1 } } }, { ticks: 1_000, restartAt: 1_000 });
    expect([run.stats.deliveries('2,0,0'), run.stats.dispatches('0,1,0')]).toEqual([[], []]);
    expect(run.findings.map((f) => [f.code, f.key, f.text])).toEqual([['feed_starved', 't:a@0',
      'Basic Mixer at 2 0 0 never gets Alpha: the Item Extractor Chip on Chest (input) at 0 0 0 has an empty whitelist (a new chip extracts nothing)']]);
  });

  it('overshoots an empty two-slot machine', () => {
    // research §2.2, C19: 64 queued at 9 (room 128) and dispatched at 10, 64 queued at 19 (room 128 − 64 in transit) and dispatched at 20;
    // the first reach the sink at 25 and fill slot 0; the second, at 35, do not fit (Multi Stack Off keeps Alpha to slot 0), stay in
    // the sink's transit and circle its pipe
    const run = same(line(['t:a@0'], 2), { ticks: 200, restartAt: 200 });
    expect(run.stats.dispatches('0,1,0')).toEqual([10, 20]);
    expect(run.stats.deliveries('2,0,0')).toEqual([[25, 't:a@0', 64]]);
    expect([run.stats.bouncedTotal('2,0,0'), run.stats.wanderedTotal('2,0,0')]).toEqual([64, 0]);
    expect(brief(run)).toEqual([['feed_churn', 't:a@0', 35, 64]]);
    expect(run.findings[0]!.text).toBe(`64 Alpha sent to Basic Mixer at 2 0 0 ${BOUNCE_TEXT}`);
    expect(run.stats.final('2,0,0')).toEqual([['t:a@0', 64], null, null]);
  });

  it('sends twice in one tick from two extractors', () => {
    // E6: transit counts from dispatch. Both extractors act at 9 and both see the sink's whole room (neither payload is dispatched
    // yet); both payloads leave at 10 and reach the sink at 25 (2 hops each): the first in dispatch order (the lower pipe's) fills
    // its one slot, the other bounces and circles
    const run = same(prModel([inputChestNode('0,0,0', ['t:a@0']), inputChestNode('4,0,0', ['t:a@0']), sinkNode('2,0,0', 1, 1)], [
      CHEST, { id: '1,1,0' }, { id: '2,1,0', target: { node: '2,0,0', side: 1 }, chips: [responder('t:a@0')] }, { id: '3,1,0' },
      { id: '4,1,0', target: { node: '4,0,0', side: 1 }, chips: [extractor(whitelist('t:a@0'))] }]), { ticks: 200, restartAt: 200 });
    expect([run.stats.dispatches('0,1,0'), run.stats.dispatches('4,1,0')]).toEqual([[10], [10]]);
    expect(run.stats.deliveries('2,0,0')).toEqual([[25, 't:a@0', 64]]);
    expect(run.stats.bouncedTotal('2,0,0')).toBe(64);
    expect(brief(run)).toEqual([['feed_churn', 't:a@0', 25, 64]]);
    // the other chest holding 40: its payload, the later in dispatch order, is the one that bounces
    const second = same(prModel([inputChestNode('0,0,0', ['t:a@0']), outputChestNode('4,0,0'), sinkNode('2,0,0', 1, 1)], [
      CHEST, { id: '1,1,0' }, { id: '2,1,0', target: { node: '2,0,0', side: 1 }, chips: [responder('t:a@0')] }, { id: '3,1,0' },
      { id: '4,1,0', target: { node: '4,0,0', side: 1 }, chips: [extractor(whitelist('t:a@0'))] }]),
    { ticks: 200, restartAt: 200, initial: { '4,0,0': [[0, 't:a@0', 40]] } });
    expect([second.stats.deliveries('2,0,0'), second.stats.bouncedTotal('2,0,0')]).toEqual([[[25, 't:a@0', 64]], 40]);
    // 40 circling items are fewer than `CHURN_ITEMS` (64): no finding
    expect(second.findings).toEqual([]);
  });

  it('gives up its act on an input item', () => {
    // research C3: a machine M at 2,0,0 (it never runs) with 10 Alpha in its input slot and 5 Ex in its output slot; another
    // machine at 4,0,0 takes Alpha and an output chest at 0,0,0 takes Ex
    const c3 = (filter: ItemFilterSpec) => same(prModel([outputChestNode('0,0,0'), sinkNode('2,0,0', 1, 1), sinkNode('4,0,0', 1, 1)], [
      { id: '0,1,0', target: { node: '0,0,0', side: 1 }, chips: [responder('t:x@0')] }, { id: '1,1,0' },
      { id: '2,1,0', target: { node: '2,0,0', side: 1 }, chips: [extractor(filter)] }, { id: '3,1,0' },
      { id: '4,1,0', target: { node: '4,0,0', side: 1 }, chips: [responder('t:a@0')] }]),
    { ticks: 1_000, restartAt: 1_000, initial: { '2,0,0': [[0, 't:a@0', 10], [1, 't:x@0', 5]] } });
    // each act lists Alpha first, cannot take it out of the input slot and stops: nothing moves
    const blacklist = c3({ mode: 'blacklist', keys: [] });
    expect([blacklist.stats.dispatches('2,1,0'), blacklist.stats.deliveries('0,0,0'), blacklist.stats.deliveries('4,0,0')]).toEqual([[], [], []]);
    expect(blacklist.stats.final('2,0,0')).toEqual([['t:a@0', 10], ['t:x@0', 5]]);
    // a whitelist of its output: the 5 Ex are queued at 9, dispatched at 10 and delivered 2 hops later
    const outputs = c3(whitelist('t:x@0'));
    const at = 10 + prTravelTicks(2, 'passive');
    expect([outputs.stats.dispatches('2,1,0'), outputs.stats.arrivals('0,0,0'), outputs.stats.deliveries('0,0,0')]).toEqual([[10], [[at, 't:x@0', 5]], [[at, 't:x@0', 5]]]);
    expect(outputs.stats.final('2,0,0')).toEqual([['t:a@0', 10], null]);
  });

  it('keeps a stock with a Stock Keeper and a Broadcaster', () => {
    // at tick 99 the broadcaster (lower pipe order) acts first with no order, then the stock keeper asks for 16; the
    // broadcaster's act at 109 serves it and the payload leaves at 110 (Active Broadcast, 2 hops: 3 pipe lengths, 10 ticks)
    const run = same(prModel([inputChestNode('0,0,0', ['t:a@0']), sinkNode('2,0,0', 1, 1)], [
      { id: '0,1,0', target: { node: '0,0,0', side: 1 }, chips: [{ kind: 'broadcaster', filter: whitelist('t:a@0') }] }, { id: '1,1,0' },
      { id: '2,1,0', target: { node: '2,0,0', side: 1 }, chips: [{ kind: 'stock_keeper', stock: [{ key: 't:a@0', count: 16 }] }] }]), { ticks: 2_000, restartAt: 2_000 });
    // and nothing more: the stock stays at 16
    expect(run.stats.dispatches('0,1,0')).toEqual([110]);
    expect(run.stats.deliveries('2,0,0')).toEqual([[120, 't:a@0', 16]]);
    // a restart at 105 drops the order the broadcaster had promised: the stock keeper, counting down again, asks at 204
    const keeper = prModel([inputChestNode('0,0,0', ['t:a@0']), sinkNode('2,0,0', 1, 1)], [
      { id: '0,1,0', target: { node: '0,0,0', side: 1 }, chips: [{ kind: 'broadcaster', filter: whitelist('t:a@0') }] }, { id: '1,1,0' },
      { id: '2,1,0', target: { node: '2,0,0', side: 1 }, chips: [{ kind: 'stock_keeper', stock: [{ key: 't:a@0', count: 16 }] }] }]);
    const restarted = same(keeper, { ticks: 400, restartAt: 105 }, 'restart');
    expect([restarted.stats.dispatches('0,1,0'), restarted.stats.deliveries('2,0,0')]).toEqual([[215], [[225, 't:a@0', 16]]]);
  });

  it('drops an order its broadcaster cannot fill', () => {
    // research C4: the broadcaster's machine holds its only Alpha, 10, in its input slot; its filter is a new one (an empty blacklist)
    const run = same(prModel([sinkNode('0,0,0', 1, 1), sinkNode('2,0,0', 1, 1)], [
      { id: '0,1,0', target: { node: '0,0,0', side: 1 }, chips: [{ kind: 'broadcaster', filter: { mode: 'blacklist', keys: [] } }] }, { id: '1,1,0' },
      { id: '2,1,0', target: { node: '2,0,0', side: 1 }, chips: [{ kind: 'stock_keeper', stock: [{ key: 't:a@0', count: 16 }] }] }]),
    { ticks: 2_000, restartAt: 2_000, initial: { '0,0,0': [[0, 't:a@0', 10]] } });
    // it promises 10 at each of the stock keeper's acts (99, 199, …, 1,999: a promise resets its slowdown), takes 0 at its next act
    // (109, 209, …, 1,909) and drops the order
    expect([run.stats.deliveries('2,0,0'), run.stats.dispatches('0,1,0')]).toEqual([[], []]);
    expect(run.stats.droppedTotal('0,1,0')).toBe(190);
  });

  it('loses its transit on a restart', () => {
    // research C5, 6 hops (7 pipe lengths, 35 ticks): the payload queued at 9 and dispatched at 10 loses its destination at 15
    // and re-routes as it enters its second pipe that tick, to the same sink, whose transit no longer counts it (it still arrives
    // at 45); the extractor's countdown starts again at 15 and it acts at 24 with nothing counted, queuing 64 more (dispatched at
    // 25, arriving at 60); the first goes in at 45 and takes its 64 off the transit, which held only the second's; the second
    // does not fit at 60 and circles
    const model = line(['t:a@0'], 1, 6);
    const restarted = same(model, { ticks: 200, restartAt: 15 }, 'restart');
    expect(restarted.stats.dispatches('0,1,0')).toEqual([10, 25]);
    expect(restarted.stats.deliveries('6,0,0')).toEqual([[45, 't:a@0', 64]]);
    expect(brief(restarted)).toEqual([['feed_churn', 't:a@0', 60, 64]]);
    expect(restarted.findings[0]!.text).toBe(`64 Alpha sent to Basic Mixer at 6 0 0 ${BOUNCE_TEXT}`);
    const steady = same(model, { ticks: 200, restartAt: 15 });
    expect([steady.stats.dispatches('0,1,0'), steady.stats.deliveries('6,0,0'), steady.findings]).toEqual([[10], [[45, 't:a@0', 64]], []]);
  });

  it('loses what a send queue holds at a restart', () => {
    // E6: the 64 queued at 9 are still in the chest pipe's queue at the start of tick 10 and are lost; the extractor's countdown
    // starts again at 10, it acts at 19, the payload leaves at 20 and arrives at 35
    const run = same(line(['t:a@0']), { ticks: 100, restartAt: 10 }, 'restart');
    expect(run.stats.queueLostTotal('0,1,0')).toBe(64);
    expect(run.stats.dispatches('0,1,0')).toEqual([20]);
    expect(run.stats.deliveries('2,0,0')).toEqual([[35, 't:a@0', 64]]);
    expect(run.unknowns.map((u) => [u.code, u.pos, u.key])).toEqual([['stack_sizes', undefined, undefined], ['pr_queue_lost', [0, 0, 0], 't:a@0']]);
    expect(run.unknowns[1]!.text).toBe('Routed Interface Pipe at 0 1 0 lost 64 Alpha from its send queue in the restart: Project Red saves no send queue, '
      + 'so a restart just after a chip\'s act deletes what it queued');
    expect(same(line(['t:a@0']), { ticks: 100, restartAt: 10 }).stats.queueLostTotal('0,1,0')).toBe(0);
  });
});

describe('Project Red routed pipes, more closely', () => {
  it('starts its budget of 64 again for each item, and a key that uses it up ends the act', () => {
    // E6: a chest of 5 Ex, 64 Why and 64 Alpha, in that slot order, and another chest 2 hops away that takes all three. At 9: 5 Ex,
    // then 64 Why (a new budget, not the 59 left), which use the budget up and end the act; Alpha goes at 19. One payload a tick
    const run = same(prModel([outputChestNode('0,0,0'), outputChestNode('2,0,0')], [
      { id: '0,1,0', target: { node: '0,0,0', side: 1 }, chips: [extractor(whitelist('t:a@0', 't:x@0', 't:y@0'))] }, { id: '1,1,0' },
      { id: '2,1,0', target: { node: '2,0,0', side: 1 }, chips: [responder('t:a@0', 't:x@0', 't:y@0')] }]),
    { ticks: 100, restartAt: 100, initial: { '0,0,0': [[0, 't:x@0', 5], [1, 't:y@0', 64], [2, 't:a@0', 64]] } });
    expect(run.stats.dispatches('0,1,0')).toEqual([10, 11, 20]);
    expect(run.stats.arrivals('2,0,0')).toEqual([[25, 't:x@0', 5], [26, 't:y@0', 64], [35, 't:a@0', 64]]);
  });

  it('takes only the last part of a payload that went in in parts off its transit, and retries every pipe length', () => {
    // the line's sink replaced by a two-slot machine that uses 32 Alpha a run (20 ticks). The payloads of 9 and 19 (room 128, then
    // 64) reach it at 25 and 35: the first fills slot 0 and the machine starts at 26 (32 left); of the second 32 go in at 35, 32
    // bounce, and go in at 50, the first retry after the run of 46 used 32 more. Only those last 32 leave the transit, so 32 stay
    // counted: at 69 and 79 slot 0's room of 32 less them is 0, and the extractor sends again only at 89, once slot 0 is empty
    const machine = smelterNode({ id: '2,0,0', recipes: [simRecipe('h', 20, [['t:a@0', 32]], [['t:x@0', 1]])] });
    const run = same(prModel([inputChestNode('0,0,0', ['t:a@0']), machine], [
      CHEST, { id: '1,1,0' }, { id: '2,1,0', target: { node: '2,0,0', side: 1 }, chips: [responder('t:a@0')] }]), { ticks: 120, restartAt: 120 });
    expect(run.stats.dispatches('0,1,0')).toEqual([10, 20, 90, 100]);
    expect(run.stats.deliveries('2,0,0')).toEqual([[25, 't:a@0', 64], [35, 't:a@0', 32], [50, 't:a@0', 32], [105, 't:a@0', 64], [115, 't:a@0', 32]]);
    expect(run.stats.bouncedTotal('2,0,0')).toBe(32);
    expect(run.findings).toEqual([]);
  });

  it('keeps another item out with a bouncing payload\'s transit', () => {
    // a two-slot machine 2,0,0 that needs Alpha and Beta, fed from a chest of both: Alpha overshoots (64 at 9 and at 19, each
    // act ending when Alpha uses its budget up), the first fills slot 0 at 25 and the second bounces at 35 and stays in transit.
    // Beta's answer is slot 1's room, 64, less a stack for that Alpha: 0, so Beta never goes
    const machine = smelterNode({ id: '2,0,0', recipes: [simRecipe('s', 20, [['t:a@0', 1], ['t:b@0', 1]], [['t:x@0', 1]])] });
    const run = same({ ...prModel([inputChestNode('0,0,0', ['t:a@0', 't:b@0']), machine], [
      { id: '0,1,0', target: { node: '0,0,0', side: 1 }, chips: [extractor(whitelist('t:a@0', 't:b@0'))] }, { id: '1,1,0' },
      { id: '2,1,0', target: { node: '2,0,0', side: 1 }, chips: [responder('t:a@0', 't:b@0')] }]), planned: { s: { 't:a@0': 1, 't:b@0': 1 } } },
    { ticks: 500, restartAt: 500 });
    expect(run.stats.deliveries('2,0,0')).toEqual([[25, 't:a@0', 64]]);
    expect(run.runs).toEqual({ s: 0 });
    expect(run.findings.map((f) => [f.code, f.key, f.tick])).toEqual([['feed_starved', 't:b@0', 0], ['feed_churn', 't:a@0', 35]]);
  });

  it('weighs answers by priority, then the chip\'s own priority, then hops, then pipe order', () => {
    // the input chest's extractor; a one-slot machine 1,0,0 one hop along and another 3,0,0 three hops along
    const two = (near: RoutedChipSpec, far: RoutedChipSpec) => {
      const run = same(prModel([inputChestNode('0,0,0', ['t:a@0']), sinkNode('1,0,0', 1, 1), sinkNode('3,0,0', 1, 1)], [
        CHEST, { id: '1,1,0', target: { node: '1,0,0', side: 1 }, chips: [near] }, { id: '2,1,0' },
        { id: '3,1,0', target: { node: '3,0,0', side: 1 }, chips: [far] }]), { ticks: 100, restartAt: 100 });
      return [run.stats.deliveries('1,0,0').map(([t]) => t), run.stats.deliveries('3,0,0').map(([t]) => t)];
    };
    // one priority: the nearer first (sent at 10: 2 pipe lengths, 10 ticks), then the other (sent at 20: 4 lengths, 20 ticks)
    expect(two(responder('t:a@0'), responder('t:a@0'))).toEqual([[20], [40]]);
    // the nearer first though it comes later in local order: the chest's pipe at the line's other end
    const mirrored = same(prModel([sinkNode('0,0,0', 1, 1), sinkNode('2,0,0', 1, 1), inputChestNode('3,0,0', ['t:a@0'])], [
      { id: '0,1,0', target: { node: '0,0,0', side: 1 }, chips: [responder('t:a@0')] }, { id: '1,1,0' },
      { id: '2,1,0', target: { node: '2,0,0', side: 1 }, chips: [responder('t:a@0')] },
      { id: '3,1,0', target: { node: '3,0,0', side: 1 }, chips: [extractor(whitelist('t:a@0'))] }]), { ticks: 100, restartAt: 100 });
    expect([mirrored.stats.deliveries('0,0,0').map(([t]) => t), mirrored.stats.deliveries('2,0,0').map(([t]) => t)]).toEqual([[40], [20]]);
    // the chip's own priority first
    expect(two(responder('t:a@0'), { ...responder('t:a@0'), priority: 1 })).toEqual([[30], [30]]);
    // an Item Responder (Passive) before an Item Terminator (Terminated, 0.05 a tick: 40 ticks for 2 lengths)
    expect(two({ kind: 'terminator', filter: whitelist('t:a@0') }, responder('t:a@0'))).toEqual([[60], [30]]);
    // an Item Terminator (80 ticks for 4 lengths) before an Item Overflow Responder (Default, any item, 0.1 a tick)
    expect(two({ kind: 'overflow' }, { kind: 'terminator', filter: whitelist('t:a@0') })).toEqual([[40], [90]]);
    // one priority and one distance: the pipe earlier in local order; the chest's pipe 1,1,0 between the machines' pipes
    const forked = same(prModel([sinkNode('0,0,0', 1, 1), inputChestNode('1,0,0', ['t:a@0']), sinkNode('2,0,0', 1, 1)], [
      { id: '2,1,0', target: { node: '2,0,0', side: 1 }, chips: [responder('t:a@0')] },
      { id: '1,1,0', target: { node: '1,0,0', side: 1 }, chips: [extractor(whitelist('t:a@0'))] },
      { id: '0,1,0', target: { node: '0,0,0', side: 1 }, chips: [responder('t:a@0')] }], [['1,1,0', '0,1,0'], ['1,1,0', '2,1,0']]), { ticks: 100, restartAt: 100 });
    expect([forked.stats.deliveries('0,0,0'), forked.stats.deliveries('2,0,0')]).toEqual([[[20, 't:a@0', 64]], [[30, 't:a@0', 64]]]);
  });

  it('promises what its inventory holds less its open orders, and its payloads leave one a tick', () => {
    // two stock keepers of 48 Alpha, 2 and 4 hops from the broadcaster: at 99 the first is promised 48 and the second the 16 left
    // of the chest's stack; the act of 109 sends both (64 items), and they leave at 110 and 111. At 199 the second asks for its 32
    const run = same(prModel([inputChestNode('0,0,0', ['t:a@0']), sinkNode('2,0,0', 1, 1), sinkNode('4,0,0', 1, 1)], [
      { id: '0,1,0', target: { node: '0,0,0', side: 1 }, chips: [{ kind: 'broadcaster', filter: whitelist('t:a@0') }] }, { id: '1,1,0' },
      { id: '2,1,0', target: { node: '2,0,0', side: 1 }, chips: [{ kind: 'stock_keeper', stock: [{ key: 't:a@0', count: 48 }] }] }, { id: '3,1,0' },
      { id: '4,1,0', target: { node: '4,0,0', side: 1 }, chips: [{ kind: 'stock_keeper', stock: [{ key: 't:a@0', count: 48 }] }] }]), { ticks: 300, restartAt: 300 });
    expect(run.stats.dispatches('0,1,0')).toEqual([110, 111, 210]);
    const active = (hops: number) => prTravelTicks(hops, 'active_broadcast');
    expect([run.stats.deliveries('2,0,0'), run.stats.deliveries('4,0,0')])
      .toEqual([[[110 + active(2), 't:a@0', 48]], [[111 + active(4), 't:a@0', 16], [210 + active(4), 't:a@0', 32]]]);
  });

  it('asks again only once its inventory is empty in "when empty" mode', () => {
    // the broadcaster's output chest holds 16 Alpha, and 64 more from 150; the stock keeper keeps 32
    const run = (requestMode: 'when_missing' | 'when_empty') => same(prModel([outputChestNode('0,0,0'), sinkNode('2,0,0', 1, 1)], [
      { id: '0,1,0', target: { node: '0,0,0', side: 1 }, chips: [{ kind: 'broadcaster', filter: whitelist('t:a@0') }] }, { id: '1,1,0' },
      { id: '2,1,0', target: { node: '2,0,0', side: 1 }, chips: [{ kind: 'stock_keeper', stock: [{ key: 't:a@0', count: 32 }], requestMode }] }]),
    { ticks: 300, restartAt: 300, initial: { '0,0,0': [[0, 't:a@0', 16]] }, extra: (env) => [feeder(env, '0,0,0', 1, ['t:a@0'], 64, Number.POSITIVE_INFINITY, 150)] })
      .stats.deliveries('2,0,0');
    // promised the 16 there at 99, it gets them at 120; at 199 it asks for the 16 it still lacks, unless it waits to be empty
    expect(run('when_missing')).toEqual([[120, 't:a@0', 16], [220, 't:a@0', 16]]);
    expect(run('when_empty')).toEqual([[120, 't:a@0', 16]]);
  });

  it('waits longer after each pass that requested nothing', () => {
    // E7: the broadcaster's output chest gets its Alpha only at 300. The stock keeper finds none at 99 and 209 (100 + 10 after one
    // idle pass), then 120 later, at 329, it is promised 16; the broadcaster sends them at its act of 339, they leave at 340 and
    // arrive at 350 (at 100 ticks a pass it would have asked at 399)
    const run = same(prModel([outputChestNode('0,0,0'), sinkNode('2,0,0', 1, 1)], [
      { id: '0,1,0', target: { node: '0,0,0', side: 1 }, chips: [{ kind: 'broadcaster', filter: whitelist('t:a@0') }] }, { id: '1,1,0' },
      { id: '2,1,0', target: { node: '2,0,0', side: 1 }, chips: [{ kind: 'stock_keeper', stock: [{ key: 't:a@0', count: 16 }] }] }]),
    { ticks: 400, restartAt: 400, extra: (env) => [feeder(env, '0,0,0', 1, ['t:a@0'], 64, Number.POSITIVE_INFINITY, 300)] });
    expect(run.stats.deliveries('2,0,0')).toEqual([[350, 't:a@0', 16]]);
  });

  it('wanders after a restart when only a request wanted it', () => {
    // research C5: the broadcaster's 64 for the stock keeper, 6 hops away, leave at 110 (Active Broadcast, 24 ticks); restarted at
    // 112, they enter their second pipe at 114 and find no responder there: they wander. The stock keeper's countdown starts
    // again at 112, it asks again at 211, and the broadcaster's act of 221 sends 64 more
    const model = prModel([inputChestNode('0,0,0', ['t:a@0']), sinkNode('6,0,0', 1, 1)], [
      { id: '0,1,0', target: { node: '0,0,0', side: 1 }, chips: [{ kind: 'broadcaster', filter: whitelist('t:a@0') }] }, ...junctions(6),
      { id: '6,1,0', target: { node: '6,0,0', side: 1 }, chips: [{ kind: 'stock_keeper', stock: [{ key: 't:a@0', count: 64 }] }] }]);
    const steady = same(model, { ticks: 300, restartAt: 112 });
    expect([steady.stats.deliveries('6,0,0'), steady.findings]).toEqual([[[134, 't:a@0', 64]], []]);
    const run = same(model, { ticks: 300, restartAt: 112 }, 'restart');
    expect(run.stats.dispatches('0,1,0')).toEqual([110, 222]);
    expect(run.stats.deliveries('6,0,0')).toEqual([[246, 't:a@0', 64]]);
    expect([run.stats.wanderedTotal('6,0,0'), run.stats.bouncedTotal('6,0,0')]).toEqual([64, 0]);
    expect(run.findings.map((f) => [f.code, f.key, f.tick, f.count, f.text]))
      .toEqual([['feed_churn', 't:a@0', 114, 64, '64 Alpha lost their way and wander the routed pipes until a responder answers']]);
    expect(run.unknowns.map((u) => [u.code, u.pos, u.stepId, u.key])).toEqual([['stack_sizes', undefined, undefined, undefined], ['pr_wander_path', [6, 0, 0], 'n', 't:a@0']]);
    // with an output chest that takes Alpha on the pipe 3,1,0, full of Beta until a taker empties a slot at 140: the wanderer asks
    // at 114 and 134 (every 20 ticks at Wandering speed), finds room at 154 and reaches the chest 2 hops on, at Passive speed
    const chest = prModel([inputChestNode('0,0,0', ['t:a@0']), outputChestNode('3,0,0'), sinkNode('6,0,0', 1, 1)], [
      { id: '0,1,0', target: { node: '0,0,0', side: 1 }, chips: [{ kind: 'broadcaster', filter: whitelist('t:a@0') }] }, { id: '1,1,0' }, { id: '2,1,0' },
      { id: '3,1,0', target: { node: '3,0,0', side: 1 }, chips: [responder('t:a@0')] }, { id: '4,1,0' }, { id: '5,1,0' },
      { id: '6,1,0', target: { node: '6,0,0', side: 1 }, chips: [{ kind: 'stock_keeper', stock: [{ key: 't:a@0', count: 64 }] }] }]);
    const junk = Array.from({ length: 27 }, (_, i) => [i, 't:b@0', 64] as [number, string, number]);
    const found = same(chest, { ticks: 300, restartAt: 112, initial: { '3,0,0': junk }, extra: (env) => [taker(env, '3,0,0', 1, 64, [140])] }, 'restart');
    expect(found.stats.arrivals('3,0,0')).toEqual([[154 + prTravelTicks(2, 'passive'), 't:a@0', 64]]);
    expect(found.stats.wanderedTotal('6,0,0')).toBe(64);
  });

  it('re-routes a payload a restart caught in its destination pipe where it arrives', () => {
    // the overshoot line restarted at 31: the second payload (sent at 20) entered the sink's pipe at 30, so it keeps its arrival
    // at 35, does not fit, and asks for a route there; with the sink full nothing answers, and it wanders instead of circling
    const restarted = same(line(['t:a@0'], 2), { ticks: 200, restartAt: 31 }, 'restart');
    expect([restarted.stats.bouncedTotal('2,0,0'), restarted.stats.wanderedTotal('2,0,0')]).toEqual([0, 64]);
    expect(brief(restarted)).toEqual([['feed_churn', 't:a@0', 35, 64]]);
    expect(restarted.findings[0]!.text).toBe('64 Alpha lost their way and wander the routed pipes until a responder answers');
    // a payload still on its way to its pipe re-routes as it enters the next one: restarted at 26, the second (in the chest's
    // pipe then the junction, entering the sink's at 30) asks there, finds no room either, and wanders from 30
    expect(brief(same(line(['t:a@0'], 2), { ticks: 200, restartAt: 26 }, 'restart'))).toEqual([['feed_churn', 't:a@0', 30, 64]]);
  });

  it('counts what an Item Extractor Chip pulls back out of an input bus', () => {
    // research §3.2: the EBF's input bus 0,0,0 holds 64 Alpha, and its pipe 0,0,1 has a responder and an extractor whose filter is
    // an empty blacklist (it passes everything); an output chest's pipe 1,0,1 lists Alpha. The act at 9 pulls the Alpha back out
    const run = same(prModel([ebfNode(), outputChestNode('1,0,2')], [
      { id: '0,0,1', target: { node: '1,0,0', bus: '0,0,0', side: 3 }, chips: [responder('t:a@0', 't:b@0'), extractor({ mode: 'blacklist', keys: [] })] },
      { id: '1,0,1', target: { node: '1,0,2', side: 2 }, chips: [responder('t:a@0')] }]), { ticks: 100, restartAt: 100, initial: { '0,0,0': [[0, 't:a@0', 64]] } });
    expect(run.stats.pulledBackTotal('0,0,0')).toBe(64);
    expect(run.stats.arrivals('1,0,2')).toEqual([[10 + prTravelTicks(1, 'passive'), 't:a@0', 64]]);
    expect(run.findings.map((f) => [f.code, f.key, f.tick, f.count, f.text])).toEqual([['feed_churn', 't:a@0', 9, 64,
      '64 Alpha were pulled back out of Input Bus (LV) at 0 0 0 of Electric Blast Furnace at 1 0 0 by its Item Extractor Chip']]);
  });

  it('says why an output stays, in R5a\'s words', () => {
    // a macerator 2,0,0 whose output slot is full of Ex (its first check, at 599, finds its output blocked) and an output chest 0,0,0
    const model = (chip: RoutedChipSpec, chest: RoutedChipSpec) => prModel([outputChestNode('0,0,0'), oneSlotNode('2,0,0')], [
      { id: '0,1,0', target: { node: '0,0,0', side: 1 }, chips: [chest] }, { id: '1,1,0' }, { id: '2,1,0', target: { node: '2,0,0', side: 1 }, chips: [chip] }]);
    const why = (chip: RoutedChipSpec, chest: RoutedChipSpec) => same(model(chip, chest), { ticks: 2_000, restartAt: 2_000,
      initial: { '2,0,0': [[0, 't:a@0', 1], [1, 't:x@0', 64]] } }).findings.map((f) => [f.code, f.tick, f.text]);
    const stuck = (reason: string) => [['feed_no_route', 599, `Nothing takes Ex out of Basic Macerator at 2 0 0: ${reason}`]];
    expect(why(extractor(whitelist()), responder('t:x@0'))).toEqual(stuck('its Item Extractor Chip has an empty whitelist (a new chip extracts nothing)'));
    expect(why(extractor(whitelist('t:y@0')), responder('t:x@0'))).toEqual(stuck('its Item Extractor Chip does not list it'));
    expect(why(extractor({ mode: 'blacklist', keys: ['t:x@0'] }), responder('t:x@0'))).toEqual(stuck('its Item Extractor Chip blacklists it'));
    expect(why(extractor(whitelist('t:x@0')), responder('t:y@0'))).toEqual(stuck('no Item Responder Chip on the line lists it'));
    expect(why(extractor(whitelist('t:x@0')), responder('t:x@0'))).toEqual([]);
    // R5a words the same line the same
    expect(precheckFeeding(model(extractor(whitelist()), responder('t:x@0')), feedPack()).map((f) => [f.code, f.text]))
      .toEqual([['feed_no_route', 'Nothing takes Ex out of Basic Macerator at 2 0 0: its Item Extractor Chip has an empty whitelist (a new chip extracts nothing)']]);
    // a multiblock's outputs leave through its output buses' pipes (its full output bus blocks its run at 0): the extractor on its
    // input bus's pipe, which lists Ex, is not one of them
    const full = [0, 1, 2, 3].map((slot) => [slot, 't:x@0', 64] as [number, string, number]);
    const ebf = same(prModel([ebfNode()], [
      { id: '0,0,1', target: { node: '1,0,0', bus: '0,0,0', side: 3 }, chips: [responder('t:a@0', 't:b@0'), extractor(whitelist('t:x@0'))] }, { id: '1,0,1' },
      { id: '2,0,1', target: { node: '1,0,0', bus: '2,0,0', side: 3 }, chips: [extractor(whitelist())] }]),
    { ticks: 2_000, restartAt: 2_000, initial: { '0,0,0': [[0, 't:a@0', 1], [1, 't:b@0', 1]], '2,0,0': full } });
    expect(ebf.findings.map((f) => [f.code, f.tick, f.text])).toEqual([['feed_no_route', 0,
      'Nothing takes Ex out of Electric Blast Furnace at 1 0 0: its Item Extractor Chip has an empty whitelist (a new chip extracts nothing)']]);
  });

  it('says why an input never comes', () => {
    // the line, its sink's step planned to take Alpha
    const starved = (chest: RoutedChipSpec, sink: RoutedChipSpec) => same({ ...prModel([inputChestNode('0,0,0', ['t:a@0']), sinkNode('2,0,0', 1, 1)], [
      { id: '0,1,0', target: { node: '0,0,0', side: 1 }, chips: [chest] }, { id: '1,1,0' }, { id: '2,1,0', target: { node: '2,0,0', side: 1 }, chips: [sink] }]),
    planned: { n: { 't:a@0': 1 } } }, { ticks: 500, restartAt: 500 }).findings.map((f) => [f.code, f.text]);
    const never = (reason: string) => [['feed_starved', `Basic Mixer at 2 0 0 never gets Alpha: ${reason}`]];
    expect(starved(extractor(whitelist('t:a@0')), responder('t:b@0'))).toEqual(never('no Item Responder Chip on its pipe lists Alpha'));
    expect(starved(extractor(whitelist('t:b@0')), responder('t:a@0'))).toEqual(never('the Item Extractor Chip on Chest (input) at 0 0 0 does not list it'));
    // a Stock Keeper Chip that keeps Alpha lists it, and the chest's extractor lets it out: no reason the network can name
    expect(starved(extractor(whitelist('t:a@0')), { kind: 'stock_keeper', stock: [{ key: 't:a@0', count: 16 }] }))
      .toEqual(never('nothing on the line hands it over'));
  });
});
