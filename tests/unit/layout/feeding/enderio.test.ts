// tests/unit/layout/feeding/enderio.test.ts
import { describe, expect, it } from 'vitest';
import type { FeedConduitFilter, ScenarioName } from '../../../../src/server/layout/feeding/contract.ts';
import { PART_KEYS } from '../../../../src/server/layout/feeding/facts.ts';
import type { EioNet, FeedModel } from '../../../../src/server/layout/feeding/model.ts';
import { readLine } from '../../../../src/server/layout/feeding/read.ts';
import { runScenario, type ScenarioOptions, type ScenarioRun } from '../../../../src/server/layout/feeding/sim/run.ts';
import {
  benchNode, chain2, ebfNode, eioModel, hvExport, inputChestNode, layFeed, oneSlotNode, outputChestNode, sinkNode, taker, type EioFaceSpec,
} from '../../../helpers/feeding-fixtures.ts';

const both = (model: Parameters<typeof runScenario>[0], ticks: number) =>
  [false, true].map((exhaustive) => runScenario(model, 'steady', { ticks, restartAt: ticks, exhaustive }));

/** `model` run scheduled and tick by tick in `scenario`; the two runs must be deep-equal (Task 4 rule 3). Returns the scheduled one. */
function same(model: FeedModel, opts: Omit<ScenarioOptions, 'exhaustive'>, scenario: ScenarioName = 'steady'): ScenarioRun {
  const [scheduled, exhaustive] = [false, true].map((x) => runScenario(model, scenario, { ...opts, exhaustive: x }));
  expect(scheduled).toEqual(exhaustive);
  return scheduled!;
}

const whitelist = (...keys: string[]): FeedConduitFilter => ({ whitelist: true, keys });
const ticksOf = (r: ScenarioRun, node: string) => r.stats.deliveries(node).map(([t]) => t);
const brief = (r: ScenarioRun) => r.findings.map((f) => [f.code, f.tick, f.count]);

describe('EnderIO item conduits', () => {
  it('moves 4 items every 10 ticks, 16 with three speed upgrades', () => {
    // chest 0,0,0 → conduit 0,0,1 → a one-slot machine 0,0,2 that never runs (its recipe needs t:z@0)
    const at = (max: number) => eioModel([inputChestNode('0,0,0', ['t:a@0']), sinkNode('0,0,2', 1)], [
      { conduit: '0,0,1', side: 2, mode: 'extract', extract: { filter: { whitelist: true, keys: ['t:a@0'] }, max } },
      { conduit: '0,0,1', side: 3, mode: 'insert', insert: { filter: { whitelist: true, keys: ['t:a@0'] }, priority: 1 } }]);
    const [four, again] = both(at(4), 100);
    expect(four).toEqual(again);
    expect(four!.stats.deliveries('0,0,2')).toEqual([0, 10, 20, 30, 40, 50, 60, 70, 80, 90].map((t) => [t, 't:a@0', 4]));
    expect(both(at(16), 100)[0]!.stats.deliveries('0,0,2')).toEqual([0, 10, 20, 30].map((t) => [t, 't:a@0', 16]));
  });

  it('fills machines before chests', () => {
    // the input chest's face on 0,0,1; an output chest (priority 0) one hop along, on 1,0,1; a one-slot machine (priority 1)
    // three hops along, on 3,0,1 (the conduit at 2,0,1 has no face)
    const model = eioModel([inputChestNode('0,0,0', ['t:a@0']), outputChestNode('1,0,2'), sinkNode('3,0,2', 1)], [
      { conduit: '0,0,1', side: 2 },
      { conduit: '1,0,1', side: 3, insert: {} },
      { conduit: '3,0,1', side: 3, insert: { priority: 1 } },
    ], [['0,0,1', '1,0,1'], ['1,0,1', '2,0,1'], ['2,0,1', '3,0,1']]);
    const run = same(model, { ticks: 200, restartAt: 200 });
    // the machine first, though it is further: 16 × 4 fill its one slot by tick 150; then the chest
    expect(run.stats.deliveries('3,0,2')).toEqual(Array.from({ length: 16 }, (_, i) => [10 * i, 't:a@0', 4]));
    expect(run.stats.arrivals('1,0,2')).toEqual([160, 170, 180, 190].map((t) => [t, 't:a@0', 4]));
    // at one priority, the nearer target first: the chest takes everything
    const level = eioModel([inputChestNode('0,0,0', ['t:a@0']), outputChestNode('1,0,2'), sinkNode('3,0,2', 1)], [
      { conduit: '0,0,1', side: 2 }, { conduit: '1,0,1', side: 3, insert: {} }, { conduit: '3,0,1', side: 3, insert: {} },
    ], [['0,0,1', '1,0,1'], ['1,0,1', '2,0,1'], ['2,0,1', '3,0,1']]);
    const near = same(level, { ticks: 200, restartAt: 200 });
    expect([near.stats.deliveries('3,0,2'), near.stats.arrivals('1,0,2').length]).toEqual([[], 20]);
    // a sticky filter goes first whatever its priority: the chest's, at priority 0
    const sticky = eioModel([inputChestNode('0,0,0', ['t:a@0']), outputChestNode('1,0,2'), sinkNode('3,0,2', 1)], [
      { conduit: '0,0,1', side: 2 }, { conduit: '1,0,1', side: 3, insert: { filter: { whitelist: true, keys: ['t:a@0'], sticky: true } } },
      { conduit: '3,0,1', side: 3, insert: { priority: 1 } },
    ], [['0,0,1', '1,0,1'], ['1,0,1', '2,0,1'], ['2,0,1', '3,0,1']]);
    const first = same(sticky, { ticks: 200, restartAt: 200 });
    expect([first.stats.deliveries('3,0,2'), first.stats.arrivals('1,0,2').length]).toEqual([[], 20]);
  });

  it('takes turns with round robin', () => {
    // two one-slot machines, B one hop along (1,0,2) and C two hops along (2,0,2), both priority 1
    const line = (roundRobin: boolean) => eioModel([inputChestNode('0,0,0', ['t:a@0']), sinkNode('1,0,2', 1), sinkNode('2,0,2', 1)], [
      { conduit: '0,0,1', side: 2, extract: { roundRobin } },
      { conduit: '1,0,1', side: 3, insert: { priority: 1 } },
      { conduit: '2,0,1', side: 3, insert: { priority: 1 } },
    ]);
    const turns = same(line(true), { ticks: 60, restartAt: 60 });
    expect([ticksOf(turns, '1,0,2'), ticksOf(turns, '2,0,2')]).toEqual([[0, 20, 40], [10, 30, 50]]);
    // without it the nearer one takes everything
    const first = same(line(false), { ticks: 60, restartAt: 60 });
    expect([ticksOf(first, '1,0,2'), ticksOf(first, '2,0,2')]).toEqual([[0, 10, 20, 30, 40, 50], []]);
  });

  it('starts each extraction at the slot it last moved from', () => {
    // an input chest of Alpha (slot 0) and Beta (slot 1), an output chest that takes anything, or only Beta
    const line = (insert: FeedConduitFilter | null) => eioModel([inputChestNode('0,0,0', ['t:a@0', 't:b@0']), outputChestNode('0,0,2')], [
      { conduit: '0,0,1', side: 2 },
      { conduit: '0,0,1', side: 3, insert: { filter: insert } },
    ]);
    const any = same(line(null), { ticks: 100, restartAt: 100 });
    expect(any.stats.deliveries('0,0,2')).toEqual(Array.from({ length: 10 }, (_, i) => [10 * i, 't:a@0', 4]));
    // the first try passes over Alpha, which the chest refuses, and takes Beta; each next one starts at Beta's slot
    const beta = same(line(whitelist('t:b@0')), { ticks: 100, restartAt: 100 });
    expect(beta.stats.deliveries('0,0,2')).toEqual(Array.from({ length: 10 }, (_, i) => [10 * i, 't:b@0', 4]));
    // from a chest nobody refills: the 3 Alpha of slot 0 (no more than the stack holds; 3 of 4 is a wait of
    // round(3 × 2.5) = 8 ticks), then, slot 0 empty, Beta
    const drained = eioModel([outputChestNode('0,0,0'), outputChestNode('0,0,2')], [{ conduit: '0,0,1', side: 2 }, { conduit: '0,0,1', side: 3, insert: {} }]);
    const run = same(drained, { ticks: 30, restartAt: 30, initial: { '0,0,0': [[0, 't:a@0', 3], [1, 't:b@0', 64]] } });
    expect(run.stats.deliveries('0,0,2')).toEqual([[0, 't:a@0', 3], [8, 't:b@0', 4], [18, 't:b@0', 4], [28, 't:b@0', 4]]);
    expect(run.stats.final('0,0,0').slice(0, 2)).toEqual([null, ['t:b@0', 52]]);
  });

  it('caps a bench with a Limited Item Filter', () => {
    // the bench's back (side 3) on the conduit 0,0,1; an input chest of Resin south of the conduit
    const line = (insert: FeedConduitFilter) => eioModel([benchNode(), inputChestNode('0,0,2', ['t:resin@0'])], [
      { conduit: '0,0,1', side: 2, mode: 'in_out', insert: { filter: insert }, extract: { filter: whitelist('t:resistor@0') } },
      { conduit: '0,0,1', side: 3, mode: 'extract' },
    ]);
    const opts = { ticks: 2_000, restartAt: 2_000 };
    const limited = same(line({ item: PART_KEYS.limitedFilter, whitelist: true, keys: ['t:resin@0'], limits: [6] }), opts);
    // 6, less the 2 grid cells that hold Resin: 4 at tick 0, then 6 − 2 − 4 = 0
    expect(limited.stats.deliveries('0,0,0')).toEqual([[0, 't:resin@0', 4]]);
    expect(limited.findings).toEqual([]);
    // a Basic Item Filter: slot 0 full by tick 150, slot 1 gets Resin at 160, and the update at 162 moves slot 1 to the
    // result slot, which the face's extract filter refuses
    const basic = same(line({ item: 'EnderIO:itemBasicFilterUpgrade@0', whitelist: true, keys: ['t:resin@0'] }), opts);
    expect(ticksOf(basic, '0,0,0').slice(0, 17)).toEqual(Array.from({ length: 17 }, (_, i) => 10 * i));
    expect(brief(basic)).toEqual([['feed_overfill', 160, undefined], ['feed_bench_eject', 162, 4], ['feed_bench_stuck', 162, undefined]]);
  });

  it('takes a push only through an extracting face', () => {
    // the crafting bench with its back on the conduit 0,0,1, and an output chest's face on the same conduit
    const line = (face: EioFaceSpec) => eioModel([benchNode(), outputChestNode('0,0,2')], [face, { conduit: '0,0,1', side: 3, insert: {} }]);
    const grid = whitelist('t:resin@0', 't:fine@0', 't:wire@0', 't:carbon@0');
    const toward = (extract: string[]): EioFaceSpec => ({ conduit: '0,0,1', side: 2, mode: 'in_out', insert: { filter: grid }, extract: { filter: whitelist(...extract) } });
    const opts = { ticks: 2_000, restartAt: 2_000, initial: { '0,0,0': [[0, 't:resin@0', 2], [1, 't:fine@0', 2], [2, 't:wire@0', 2], [3, 't:carbon@0', 1]] as Array<[number, string, number]> } };
    // the craft at 34 pushes the Resistor through the face (which itself sleeps from 24 to 43): it reaches the chest at once
    const pushed = same(line(toward(['t:resistor@0'])), opts);
    expect(pushed.stats.benchCrafts('0,0,0')).toEqual([34]);
    expect(pushed.stats.arrivals('0,0,2')).toEqual([[34, 't:resistor@0', 1]]);
    expect(pushed.findings).toEqual([]);
    // an extract filter that refuses it, or a face that only inserts: the push is refused and the bench stops
    for (const face of [toward(['t:x@0']), { conduit: '0,0,1', side: 2, mode: 'insert', insert: { filter: grid } } satisfies EioFaceSpec]) {
      const refused = same(line(face), opts);
      expect(refused.stats.arrivals('0,0,2')).toEqual([]);
      expect(brief(refused)).toEqual([['feed_bench_stuck', 34, undefined]]);
    }
  });

  it('pushes its result past a refused container', () => {
    // the container bench: a Wet Cell and an Alpha make an Ex, and the Wet Cell's Dry Cell comes back into slots 9–17
    const cells = benchNode({ grid: ['t:wet@0', 't:a@0', null, null, null, null, null, null, null], result: { key: 't:x@0', amount: 1 }, containers: { 't:wet@0': 't:dry@0' } });
    const model = eioModel([cells, outputChestNode('0,0,2')], [
      { conduit: '0,0,1', side: 2, mode: 'in_out', insert: { filter: whitelist('t:wet@0', 't:a@0') }, extract: { filter: whitelist('t:x@0') } },
      { conduit: '0,0,1', side: 3, insert: {} },
    ]);
    const dry = Array.from({ length: 8 }, (_, i) => [9 + i, 't:dry@0', 64] as [number, string, number]);
    const run = same(model, { ticks: 2_000, restartAt: 2_000, initial: { '0,0,0': [[0, 't:wet@0', 4], [8, 't:a@0', 2], ...dry] } });
    // the push skips slots 9–16, whose Dry Cells the face refuses, and moves the result
    expect(run.stats.benchCrafts('0,0,0')).toEqual([34]);
    expect(run.stats.arrivals('0,0,2')).toEqual([[34, 't:x@0', 1]]);
    // the craft's Dry Cell stands in slot 17, so at 35 the craft fails and slot 8's last Alpha goes to the result slot, refused too
    expect(brief(run)).toEqual([['feed_bench_eject', 35, 1], ['feed_bench_stuck', 35, undefined]]);
    expect(run.findings[0]!.text).toBe('Auto Workbench (MV) at 0 0 0 threw 1 item out of its input slots (1× Alpha): a failed craft empties its last input slot');
  });

  it('explains what does not arrive', async () => {
    const { pack, plan } = chain2();
    const layout = await layFeed(pack, plan, 'enderio');
    // as main lays it, the line runs: no finding, and Why leaves through the output chest
    const ok = same(readLine({ pack, plan, layout }), { ticks: 2_000, restartAt: 2_000 });
    expect(ok.findings).toEqual([]);
    expect(Object.keys(ok.out)).toEqual(['t:y@0']);
    // the assembler's insert filter emptied
    const model = readLine({ pack, plan, layout });
    const assembler = model.nodes.find((n) => n.id === '5,0,1')!;
    model.networks.find((n): n is EioNet => n.kind === 'enderio')!.faces.find((f) => f.target?.node === assembler.id)!.insert!.filter!.keys = [];
    const run = same(model, { ticks: 2_000, restartAt: 2_000 });
    expect(run.findings.filter((f) => f.code === 'feed_starved').map((f) => [f.key, f.text]))
      .toEqual([['t:x@0', `${assembler.label} never gets Ex: its conduit face's Insert filter lists nothing`]]);
  });
});

describe('EnderIO item conduits, more closely', () => {
  it('sleeps 20 ticks after two ticks that moved nothing', () => {
    // the output chest is full until a taker empties its first slot at tick 5: the face tried at 0 and 1, and next at 22
    const junk = Array.from({ length: 27 }, (_, i) => [i, 't:b@0', 64] as [number, string, number]);
    const model = eioModel([inputChestNode('0,0,0', ['t:a@0']), outputChestNode('0,0,2')], [{ conduit: '0,0,1', side: 2 }, { conduit: '0,0,1', side: 3, insert: {} }]);
    const run = same(model, { ticks: 60, restartAt: 60, initial: { '0,0,2': junk }, extra: (env) => [taker(env, '0,0,2', 2, 64, [5])] });
    expect(run.stats.arrivals('0,0,2')).toEqual([22, 32, 42, 52].map((t) => [t, 't:a@0', 4]));
  });

  it('extracts only in a redstone mode that needs no signal', () => {
    const moved = (redstone: 'ignore' | 'on' | 'off' | 'never') => ticksOf(same(eioModel([inputChestNode('0,0,0', ['t:a@0']), sinkNode('0,0,2', 1)], [
      { conduit: '0,0,1', side: 2, extract: { redstone } }, { conduit: '0,0,1', side: 3, insert: {} },
    ]), { ticks: 30, restartAt: 30 }), '0,0,2');
    expect([moved('ignore'), moved('off'), moved('on'), moved('never')]).toEqual([[0, 10, 20], [0, 10, 20], [], []]);
  });

  it('passes what its filter passes', () => {
    // an input chest of `key` and an extract face with `filter`: does anything reach the output chest?
    const passes = (filter: FeedConduitFilter | null, key: string) => same(eioModel([inputChestNode('0,0,0', [key]), outputChestNode('0,0,2')], [
      { conduit: '0,0,1', side: 2, extract: { filter } }, { conduit: '0,0,1', side: 3, insert: {} },
    ]), { ticks: 20, restartAt: 20 }).stats.arrivals('0,0,2').length > 0;
    const keys = ['t:a@0', 't:a@1', 't:a@0#n1', 't:b@0'];
    const row = (filter: FeedConduitFilter | null) => keys.map((key) => passes(filter, key));
    expect(row(null)).toEqual([true, true, true, true]);
    expect(row(whitelist('t:a@0'))).toEqual([true, false, false, false]);
    // ignoring NBT compares the items without their NBT; ignoring meta compares ids only
    expect(row({ whitelist: true, keys: ['t:a@0'], matchNbt: false })).toEqual([true, false, true, false]);
    expect(row({ whitelist: true, keys: ['t:a@0'], matchMeta: false })).toEqual([true, true, true, false]);
    expect(row({ whitelist: false, keys: ['t:a@0'] })).toEqual([false, true, true, true]);
    // an empty whitelist passes nothing, an empty blacklist everything; an ore dictionary filter is read as its exact items
    expect(row(whitelist())).toEqual([false, false, false, false]);
    expect(row({ whitelist: false, keys: [] })).toEqual([true, true, true, true]);
    expect(row({ whitelist: true, keys: ['t:a@0'], oreDict: true })).toEqual([true, false, false, false]);
  });

  it('feeds its own inventory with self feed', () => {
    // an output chest holding 10 Alpha behind an In / Out face, the network's only face
    const line = (selfFeed: boolean) => eioModel([outputChestNode('0,0,0')], [{ conduit: '0,0,1', side: 2, mode: 'in_out', extract: { selfFeed } }]);
    const opts = { ticks: 30, restartAt: 30, initial: { '0,0,0': [[0, 't:a@0', 10]] as Array<[number, string, number]> } };
    // 4 out of slot 0, merged back onto slot 0 first: the chest counts each as an arrival and keeps its 10
    const fed = same(line(true), opts);
    expect([fed.stats.arrivals('0,0,0'), fed.stats.final('0,0,0')[0]]).toEqual([[0, 10, 20].map((t) => [t, 't:a@0', 4]), ['t:a@0', 10]]);
    expect(same(line(false), opts).stats.arrivals('0,0,0')).toEqual([]);
  });

  it('starts again when the line loads again', () => {
    // the round robin line, restarted at 25: the face extracts at once, and starts its turns again at B
    const model = eioModel([inputChestNode('0,0,0', ['t:a@0']), sinkNode('1,0,2', 1), sinkNode('2,0,2', 1)], [
      { conduit: '0,0,1', side: 2, extract: { roundRobin: true } }, { conduit: '1,0,1', side: 3, insert: {} }, { conduit: '2,0,1', side: 3, insert: {} },
    ]);
    const restarted = same(model, { ticks: 60, restartAt: 25 }, 'restart');
    expect([ticksOf(restarted, '1,0,2'), ticksOf(restarted, '2,0,2')]).toEqual([[0, 20, 25, 45], [10, 35, 55]]);
    const steady = same(model, { ticks: 60, restartAt: 25 });
    expect([ticksOf(steady, '1,0,2'), ticksOf(steady, '2,0,2')]).toEqual([[0, 20, 40], [10, 30, 50]]);
  });

  it('says why an input never comes', () => {
    // an input chest of Alpha → the conduit 0,0,1 → a macerator (0,0,2) whose plan wants Alpha
    const why = (machine: EioFaceSpec, chest: EioFaceSpec = { conduit: '0,0,1', side: 2 }) => {
      const model = { ...eioModel([inputChestNode('0,0,0', ['t:a@0']), oneSlotNode('0,0,2')], [chest, machine]), planned: { one: { 't:a@0': 1 } } };
      return same(model, { ticks: 100, restartAt: 100 }).findings.map((f) => [f.code, f.text]);
    };
    const starved = (reason: string) => [['feed_starved', `Basic Macerator at 0 0 2 never gets Alpha: ${reason}`]];
    expect(why({ conduit: '0,0,1', side: 3, mode: 'extract' })).toEqual(starved('no conduit face toward it inserts'));
    expect(why({ conduit: '0,0,1', side: 3, insert: { filter: whitelist('t:b@0', 't:c@0') } })).toEqual(starved('its conduit face\'s Insert filter lists Beta and Gamma'));
    expect(why({ conduit: '0,0,1', side: 3, insert: { filter: { whitelist: false, keys: ['t:a@0'] } } })).toEqual(starved('its conduit face\'s Insert filter blacklists Alpha'));
    expect(why({ conduit: '0,0,1', side: 3, insert: {} }, { conduit: '0,0,1', side: 2, extract: { filter: whitelist('t:b@0') } }))
      .toEqual(starved('no conduit face extracts Alpha anywhere on the line'));
    expect(why({ conduit: '0,0,1', side: 3, insert: {} })).toEqual([]);
  });

  it('says why an output stays', () => {
    // the macerator's output slot full of Ex, Alpha brought to it: it waits on its output from tick 1
    const why = (machine: EioFaceSpec, more: EioFaceSpec[] = []) => same(eioModel([inputChestNode('0,0,0', ['t:a@0']), oneSlotNode('0,0,2'), outputChestNode('1,0,2')],
      [{ conduit: '0,0,1', side: 2 }, machine, ...more], [['0,0,1', '1,0,1']]), { ticks: 1_300, restartAt: 1_300, initial: { '0,0,2': [[1, 't:x@0', 64]] } })
      .findings.map((f) => [f.code, f.tick, f.text]);
    const stuck = (reason: string) => [['feed_no_route', 1, `Nothing takes Ex out of Basic Macerator at 0 0 2: ${reason}`]];
    expect(why({ conduit: '0,0,1', side: 3, insert: {} })).toEqual(stuck('no conduit face toward it extracts'));
    expect(why({ conduit: '0,0,1', side: 3, mode: 'in_out', extract: { filter: whitelist('t:a@0') } })).toEqual(stuck('its conduit face\'s Extract filter lists Alpha'));
    expect(why({ conduit: '0,0,1', side: 3, mode: 'in_out' })).toEqual(stuck('no conduit face on the line inserts Ex'));
    // an output chest's face on another channel colour takes nothing from it; on the same one it takes Ex
    expect(why({ conduit: '0,0,1', side: 3, mode: 'in_out' }, [{ conduit: '1,0,1', side: 3, insert: { color: 'blue' } }])).toEqual(stuck('no conduit face on the line inserts Ex'));
    expect(why({ conduit: '0,0,1', side: 3, mode: 'in_out' }, [{ conduit: '1,0,1', side: 3, insert: {} }])).toEqual([]);
  });

  it('takes a conveyor\'s push only through an extracting face, and drops nothing', () => {
    // a macerator holding 64 Ex, an HV export conveyor on its south side (64 every 20 ticks), the conduit 0,0,1 south of it
    // and an output chest south of that
    const line = (face: EioFaceSpec) => eioModel([oneSlotNode('0,0,0'), outputChestNode('0,0,2')], [face, { conduit: '0,0,1', side: 3, insert: {} }]);
    const opts = { ticks: 30, restartAt: 30, initial: { '0,0,0': [[1, 't:x@0', 64]] as Array<[number, string, number]> } };
    const run = (face: EioFaceSpec) => same({ ...line(face), covers: [hvExport('0,0,0', 3)] }, opts);
    // through an extract face: its own 4 at 0 and 10, then the conveyor's push of the rest at 20, in the machine's tick
    const through = run({ conduit: '0,0,1', side: 2 });
    expect(through.stats.arrivals('0,0,2')).toEqual([[0, 't:x@0', 4], [10, 't:x@0', 4], [20, 't:x@0', 56]]);
    // through a face that only inserts, or one whose extract filter refuses Ex: the conduit takes nothing, and nothing is dropped
    for (const face of [{ conduit: '0,0,1', side: 2, insert: {} }, { conduit: '0,0,1', side: 2, extract: { filter: whitelist('t:a@0') } }] satisfies EioFaceSpec[]) {
      const refused = run(face);
      expect([refused.stats.arrivals('0,0,2'), refused.stats.final('0,0,0')[1], refused.unknowns.map((u) => u.code)]).toEqual([[], ['t:x@0', 64], ['stack_sizes']]);
    }
  });

  it('feeds a multiblock\'s input bus and takes its output bus\'s push', () => {
    // the EBF (input bus 0,0,0, controller 1,0,0, output bus 2,0,0, fronts south) on the conduits 0,0,1 – 1,0,1 – 2,0,1,
    // an input chest of Alpha (0,0,2), one of Beta (1,0,2) and an output chest (2,0,2) south of them
    const model = eioModel([ebfNode(), inputChestNode('0,0,2', ['t:a@0']), inputChestNode('1,0,2', ['t:b@0']), outputChestNode('2,0,2')], [
      { conduit: '0,0,1', side: 2, insert: {} }, { conduit: '0,0,1', side: 3 }, { conduit: '1,0,1', side: 3 },
      { conduit: '2,0,1', side: 2 }, { conduit: '2,0,1', side: 3, insert: {} },
    ]);
    const run = same(model, { ticks: 250, restartAt: 250 });
    // both reach the bus at tick 0; the bus wakes its controller at 1; runs start at 1, 101 and 201, and after each the
    // output bus pushes at its next 8th tick (aTick 104 and 208: ticks 103 and 207) through the face toward it, whose own
    // tries (0, 1, 22, 23, … 198, 199, 220) sleep then
    expect(run.stats.deliveries('0,0,0').slice(0, 2)).toEqual([[0, 't:a@0', 4], [0, 't:b@0', 4]]);
    expect(run.runs).toEqual({ e: 3 });
    expect(run.stats.arrivals('2,0,2')).toEqual([[103, 't:x@0', 1], [207, 't:x@0', 1]]);
  });
});
