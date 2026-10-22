// tests/unit/layout/feeding/multi.test.ts
import { describe, expect, it } from 'vitest';
import type { ScenarioName } from '../../../../src/server/layout/feeding/contract.ts';
import type { FeedModel, GtCover } from '../../../../src/server/layout/feeding/model.ts';
import { precheckFeeding } from '../../../../src/server/layout/feeding/precheck.ts';
import { NEVER, PHASE, type Preloadable, type SimEntity, type SimInv } from '../../../../src/server/layout/feeding/sim/core.ts';
import type { SimEnv } from '../../../../src/server/layout/feeding/sim/machine.ts';
import { multiblock } from '../../../../src/server/layout/feeding/sim/multi.ts';
import { runScenario, type ScenarioOptions, type ScenarioRun } from '../../../../src/server/layout/feeding/sim/run.ts';
import {
  busNode, ebfNode, feeder, feedPack, handModel, inputChestNode, oneSlotNode, outBusNode, outputChestNode, simRecipe, taker, twoBusNode,
} from '../../../helpers/feeding-fixtures.ts';

/** A feeder period past every run here: it offers once. */
const NEVER_AGAIN = 1_000_000;

/** `model` run scheduled and tick by tick; the two runs must be deep-equal (Task 4 rule 3). Returns the scheduled one. */
function both(model: FeedModel, opts: Omit<ScenarioOptions, 'exhaustive'>, scenario: ScenarioName = 'steady'): ScenarioRun {
  const [scheduled, exhaustive] = [false, true].map((x) => runScenario(model, scenario, { ...opts, exhaustive: x }));
  expect(scheduled).toEqual(exhaustive);
  return scheduled!;
}

/** The environment of a run of `model` that runs no tick: for looking at one inventory directly. */
function envOf(model: FeedModel): SimEnv {
  let env: SimEnv | undefined;
  runScenario(model, 'steady', { ticks: 0, restartAt: 0, extra: (e) => { env = e; return []; } });
  return env!;
}

const codes = (r: ScenarioRun) => r.findings.map((f) => f.code);
/** A set (one Alpha and one Beta) offered to the EBF's input bus at tick 0. */
const oneSet = (env: SimEnv) => [feeder(env, '0,0,0', 3, ['t:a@0', 't:b@0'], 1, NEVER_AGAIN, 0)];
/** Contents for every slot of an LV bus: a full stack of `key` in each. */
const fullOf = (key: string) => [0, 1, 2, 3].map((slot) => [slot, key, 64] as [number, string, number]);

describe('multiblocks', () => {
  it('starts when a set reaches its bus and pushes out every 8 ticks', () => {
    const model = handModel([ebfNode(), outputChestNode('2,0,1')]);
    const runs = [false, true].map((exhaustive) => runScenario(model, 'steady', { ticks: 700, restartAt: 350, exhaustive,
      extra: (env) => [feeder(env, '0,0,0', 3, ['t:a@0', 't:b@0'], 1, Number.POSITIVE_INFINITY, 500)] }));
    expect(runs[0]).toEqual(runs[1]);
    // the feeder fills the bus at 500; the bus (order 0) wakes the controller (order 1) that same tick; the run ends at 600,
    // and the output bus (order 2) pushes at 607, when its own timer (aTick = age + 1 = 608) is a multiple of 8
    expect(runs[0]!.runs).toEqual({ e: 1 });
    expect(runs[0]!.stats.arrivals('2,0,1')).toEqual([[607, 't:x@0', 1]]);
  });

  it('takes items through its front, with Limiting mode as GT does', () => {
    const env = envOf(handModel([ebfNode()]));
    const [a, b, x] = ['t:a@0', 't:b@0', 't:x@0'].map((k) => env.keys.id(k)) as [number, number, number];
    const inBus = (over: Parameters<typeof busNode>[1] = {}) => multiblock(ebfNode({ inBuses: [busNode('0,0,0', over)] }), env).buses[0]!;
    // only through its front, and out of it too
    const open = inBus();
    expect([open.canInsert(0, a, 3), open.canInsert(0, a, 2), open.canExtract(0, a, 3), open.canExtract(0, a, 2)]).toEqual([true, false, true, false]);
    // Limiting mode off: one kind may take every slot, though a full stack takes no more
    open.insert(0, a, 64, null);
    expect([open.canInsert(1, a, 3), open.canInsert(0, a, 3)]).toEqual([true, false]);
    // a Shutter on "Only Output allowed" at its front lets nothing in
    const shutter: GtCover = { host: '0,0,0', side: 3, kind: 'shutter', export: false, allowInput: false, shutter: 'output_only' };
    const shut = envOf(handModel([ebfNode()], { covers: [shutter] }));
    expect(multiblock(ebfNode(), shut).buses[0]!.canInsert(0, a, 3)).toBe(false);
    // Limiting mode on: an item already in a slot goes only into that slot, another kind into an empty one
    const limited = inBus({ limited: true });
    limited.insert(0, a, 64, null);
    expect([limited.canInsert(1, a, 3), limited.canInsert(1, b, 3)]).toEqual([false, true]);
    // the Input Filter takes only what the controller's recipe map takes: Ex is no input of it
    const filtered = inBus({ inputFilter: true });
    expect([filtered.canInsert(0, a, 3), filtered.canInsert(0, x, 3)]).toEqual([true, false]);
    // sorting: what goes into slot 2 of an empty bus sits in slot 0 after the bus's tick
    const sorted = inBus();
    sorted.insert(2, a, 5, null);
    sorted.tick(0);
    expect([0, 1, 2, 3].map((s) => sorted.stack(s))).toEqual([{ key: a, count: 5 }, null, null, null]);
    // the same item merged into full stacks, each stack where its item first stood
    const merged = inBus();
    merged.insert(0, a, 10, null);
    merged.insert(1, b, 5, null);
    merged.insert(2, a, 60, null);
    merged.tick(0);
    expect([0, 1, 2, 3].map((s) => merged.stack(s))).toEqual([{ key: a, count: 64 }, { key: b, count: 5 }, { key: a, count: 6 }, null]);
    // an output bus takes nothing from outside and lets items out of its front
    const out = multiblock(ebfNode(), env).outBuses[0]!;
    out.preload(0, x, 5);
    expect([out.canInsert(1, x, 3), out.canExtract(0, x, 3), out.canExtract(0, x, 2)]).toEqual([false, true, false]);
  });

  it('waits while a set is split over separated buses', () => {
    const fed = (env: SimEnv) => [feeder(env, '0,0,0', 3, ['t:a@0'], 64, NEVER_AGAIN, 0), feeder(env, '0,1,0', 3, ['t:b@0'], 64, NEVER_AGAIN, 0)];
    const node = twoBusNode();
    const split = both(handModel([node]), { ticks: 2_000, restartAt: 1_000, extra: fed });
    expect(split.runs).toEqual({ e: 0 });
    expect(split.findings.map((f) => [f.code, f.tick, f.count, f.stepId, f.key])).toEqual([['feed_crowded', 0, 2_000, 'e', undefined]]);
    expect(split.findings[0]!.text).toBe(`${node.label} has every input of its recipe but on different input buses, and Input Separation checks each bus alone`);
    // a split that ends before STALL_TICKS (Beta reaches the Alpha's bus at 600; runs at 600, 700, …, 1,900) is no finding
    const brief = both(handModel([node]), { ticks: 2_000, restartAt: 1_000,
      extra: (env) => [...fed(env), feeder(env, '0,0,0', 3, ['t:b@0'], 64, NEVER_AGAIN, 600)] });
    expect([brief.runs, brief.findings]).toEqual([{ e: 14 }, []]);
    // with Input Separation off the buses are checked together: runs start at 0, 100, …, 1,900, and the outputs stay in the
    // output bus, which faces nothing
    const together = both(handModel([{ ...node, inputSeparation: false }]), { ticks: 2_000, restartAt: 1_000, extra: fed });
    expect([together.runs, together.findings]).toEqual([{ e: 20 }, []]);
    expect([together.stats.final('0,0,0'), together.stats.final('0,1,0'), together.stats.final('2,0,0')]).toEqual([
      [['t:a@0', 44], null, null, null], [['t:b@0', 44], null, null, null], [['t:x@0', 19], null, null, null],
    ]);
  });

  it('takes a run\'s inputs out of its buses in local order, and sorts its buses again', () => {
    // with Input Separation off, the one Alpha of 0,0,0 goes before those of 0,1,0
    const order = both(handModel([{ ...twoBusNode(), inputSeparation: false }]), { ticks: 100, restartAt: 100,
      extra: (env) => [feeder(env, '0,0,0', 3, ['t:a@0'], 1, NEVER_AGAIN, 0), feeder(env, '0,1,0', 3, ['t:a@0', 't:b@0'], 64, NEVER_AGAIN, 0)] });
    expect([order.runs, order.stats.final('0,0,0'), order.stats.final('0,1,0')]).toEqual([{ e: 1 }, [null, null, null, null], [['t:a@0', 64], ['t:b@0', 63], null, null]]);
    // the run takes slot 0's one Alpha, and the bus's stacks move up into its first slots at once (GT's updateSlots)
    const gap = both(handModel([ebfNode()]), { ticks: 100, restartAt: 100,
      extra: (env) => [feeder(env, '0,0,0', 3, ['t:a@0'], 1, NEVER_AGAIN, 0), feeder(env, '0,0,0', 3, ['t:b@0'], 64, NEVER_AGAIN, 0)] });
    expect([gap.runs, gap.stats.final('0,0,0')]).toEqual([{ e: 1 }, [['t:b@0', 63], null, null, null]]);
    // each bus from its highest slot down: a run of 64 Alpha takes slot 2's stack and leaves slot 0's 6 standing first
    const highest = both(handModel([ebfNode({ recipes: [simRecipe('e', 100, [['t:a@0', 64], ['t:b@0', 1]], [['t:x@0', 1]])] })]), { ticks: 1, restartAt: 1,
      initial: { '0,0,0': [[0, 't:a@0', 6], [1, 't:b@0', 5], [2, 't:a@0', 64]] } });
    expect([highest.runs, highest.stats.final('0,0,0')]).toEqual([{ e: 1 }, [['t:a@0', 6], ['t:b@0', 4], null, null]]);
  });

  it('passes over a recipe whose outputs do not fit', () => {
    // two recipes, each output bus locked to one of their products: Ex's bus is full, so Alpha's recipe is passed over and
    // Beta's runs (ProcessingLogic goes on to the next recipe that matches)
    const node = ebfNode({
      recipes: [simRecipe('r1', 100, [['t:a@0', 1]], [['t:x@0', 1]]), simRecipe('r2', 100, [['t:b@0', 1]], [['t:y@0', 1]])],
      outBuses: [outBusNode('2,0,0', { lock: 't:x@0' }), outBusNode('2,1,0', { lock: 't:y@0' })],
    });
    const r = both(handModel([node]), { ticks: 101, restartAt: 101, initial: { '2,0,0': fullOf('t:x@0') }, extra: oneSet });
    expect([r.runs, r.stats.final('2,1,0'), r.stats.final('0,0,0')]).toEqual([{ r1: 0, r2: 1 }, [['t:y@0', 1], null, null, null], [['t:a@0', 1], null, null, null]]);
    // it tries its cached recipe first: Beta's ran at 0, so at 100 it runs again though Alpha's is first and its set came at 50
    const cached = ebfNode({ recipes: node.recipes });
    const again = both(handModel([cached]), { ticks: 150, restartAt: 150,
      extra: (env) => [feeder(env, '0,0,0', 3, ['t:b@0'], 2, NEVER_AGAIN, 0), feeder(env, '0,0,0', 3, ['t:a@0'], 1, NEVER_AGAIN, 50)] });
    expect(again.runs).toEqual({ r1: 0, r2: 2 });
  });

  it('waits for a drain when its output buses are full', () => {
    const model = handModel([ebfNode(), outputChestNode('2,0,1')]);
    const opts = { restartAt: 100, initial: { '2,0,0': fullOf('t:x@0') }, extra: oneSet };
    // its check at tick 0 finds no room; the output bus (order 2) first pushes at tick 7 (its aTick 8) and empties its four
    // stacks into the chest, which wakes the controller (order 1) for tick 8
    const before = both(model, { ticks: 8, ...opts });
    expect([before.runs, before.stats.arrivals('2,0,1')]).toEqual([{ e: 0 }, [[7, 't:x@0', 256]]]);
    const after = both(model, { ticks: 9, ...opts });
    expect([after.runs, after.stats.final('0,0,0'), after.stats.final('2,0,0')]).toEqual([{ e: 1 }, [null, null, null, null], [null, null, null, null]]);
  });

  it('fills the bus locked to an item first', () => {
    const node = ebfNode({
      recipes: [simRecipe('e', 100, [['t:a@0', 1], ['t:b@0', 1]], [['t:x@0', 1], ['t:y@0', 1]])],
      outBuses: [outBusNode('2,0,0'), outBusNode('2,1,0', { lock: 't:x@0' })],
    });
    // neither bus faces anything; after the run (tick 100) the locked bus holds the Ex and the unlocked one the Why, where
    // local order alone would have put both into 2,0,0
    const r = both(handModel([node]), { ticks: 101, restartAt: 101, extra: oneSet });
    expect([r.stats.final('2,0,0'), r.stats.final('2,1,0')]).toEqual([[['t:y@0', 1], null, null, null], [['t:x@0', 1], null, null, null]]);
    // with the locked bus full of Ex, the run's Ex goes into the unlocked bus, and the locked bus never takes the Why
    const full = both(handModel([node]), { ticks: 101, restartAt: 101, initial: { '2,1,0': fullOf('t:x@0') }, extra: oneSet });
    expect([full.runs, full.stats.final('2,0,0'), full.stats.final('2,1,0')]).toEqual([
      { e: 1 }, [['t:x@0', 1], ['t:y@0', 1], null, null], fullOf('t:x@0').map(([, key, n]) => [key, n]),
    ]);
    // with the unlocked bus full, the Why has nowhere to go (the locked bus stores only Ex): the controller waits
    const noRoom = both(handModel([node]), { ticks: 101, restartAt: 101, initial: { '2,0,0': fullOf('t:c@0') }, extra: oneSet });
    expect([noRoom.runs, noRoom.stats.final('2,1,0')]).toEqual([{ e: 0 }, [null, null, null, null]]);
    // one bus with one free slot: the Ex would take it, so the Why does not fit, and nothing runs
    const oneFree = both(handModel([{ ...node, outBuses: [outBusNode('2,0,0')] }]), { ticks: 101, restartAt: 101,
      initial: { '2,0,0': fullOf('t:c@0').slice(0, 3) }, extra: oneSet });
    expect(oneFree.runs).toEqual({ e: 0 });
  });

  it('raises R4 from the controller\'s class', () => {
    const pack = feedPack();
    const brief = (f: { code: string; certainty: string }) => `${f.code} ${f.certainty}`;
    const node = twoBusNode();
    // R3 for each of its two buses left without Limiting mode, then R4: the EBF starts with Input Separation on
    const found = precheckFeeding(handModel([node]), pack);
    expect(found.map(brief)).toEqual(['feed_overfill risk', 'feed_overfill risk', 'feed_crowded risk']);
    expect(found.slice(0, 2).map((f) => f.text.split(' of ')[0])).toEqual(['Input Bus (LV) at 0 0 0', 'Input Bus (LV) at 0 1 0']);
    expect(found[2]!.text).toBe(`${node.label} has 2 input buses with Input Separation on: each bus is checked alone, so a recipe whose items arrive on different buses never starts`);
    // a controller off INPUT_SEPARATION_DEFAULT starts with it off; set on, the risk is back
    expect(precheckFeeding(handModel([{ ...node, separationDefault: false }]), pack).map(brief)).toEqual(['feed_overfill risk', 'feed_overfill risk']);
    expect(precheckFeeding(handModel([{ ...node, separationDefault: false, inputSeparation: true }]), pack).map(brief))
      .toEqual(['feed_overfill risk', 'feed_overfill risk', 'feed_crowded risk']);
  });

  it('overfills a bus without Limiting mode', () => {
    const fed = (env: SimEnv) => [feeder(env, '0,0,0', 3, ['t:a@0'], 64, 20, 0)];
    const node = ebfNode();
    // Alpha takes a second slot at 20 and the fourth at 60; from then on Beta cannot get in
    const r = both(handModel([node]), { ticks: 2_000, restartAt: 1_000, extra: fed });
    expect(r.findings.map((f) => [f.code, f.key, f.tick, f.count, f.stepId])).toEqual([['feed_crowded', 't:b@0', 60, 1_940, 'e'], ['feed_overfill', 't:a@0', 20, undefined, 'e']]);
    expect(r.findings[0]!.text).toBe(`Beta cannot get into ${node.label}: Alpha fills 4 of its 4 input slots while its recipe waits for Beta`);
    expect(r.findings[1]!.text).toBe(`Alpha fills 4 slots of ${node.inBuses[0]!.label} of ${node.label}, which takes 2 kinds of item`);
    // with Limiting mode on, Alpha keeps to slot 0 and Beta always has room
    const limited = both(handModel([ebfNode({ inBuses: [busNode('0,0,0', { limited: true })] })]), { ticks: 2_000, restartAt: 1_000, extra: fed });
    expect([codes(limited), limited.stats.final('0,0,0')]).toEqual([[], [['t:a@0', 64], null, null, null]]);
    // two kinds fill two slots each: the crowd names the one that stands first; a bus overfilled from the start counts from
    // tick 0, by any kind in it (Gamma, which the recipe does not take, as well)
    const tie = both(handModel([node], { supply: ['t:c@0'] }), { ticks: 2_000, restartAt: 1_000,
      initial: { '0,0,0': [[0, 't:a@0', 64], [1, 't:a@0', 64], [2, 't:c@0', 64], [3, 't:c@0', 64]] } });
    expect(tie.findings.map((f) => [f.code, f.key, f.tick])).toEqual([['feed_crowded', 't:b@0', 0], ['feed_overfill', 't:a@0', 0], ['feed_overfill', 't:c@0', 0]]);
    expect(tie.findings[0]!.text).toBe(`Beta cannot get into ${node.label}: Alpha fills 2 of its 4 input slots while its recipe waits for Beta`);
  });

  it('looks for a recipe when its chunk loads, not on a timer', () => {
    // a set put into the bus with no change GT would see: an idle controller does not look again on its own
    const sneak = (env: SimEnv): SimEntity => ({
      phase: PHASE.feed, order: 0,
      tick(t: number): number {
        if (t === 100) {
          const bus = env.inv('0,0,0') as SimInv & Preloadable;
          bus.preload(0, env.keys.id('t:a@0'), 1);
          bus.preload(1, env.keys.id('t:b@0'), 1);
        }
        return t < 100 ? 100 : NEVER;
      },
    });
    const model = handModel([ebfNode(), outputChestNode('2,0,1')]);
    expect(both(model, { ticks: 700, restartAt: 350, extra: (env) => [sneak(env)] }).runs).toEqual({ e: 0 });
    // a set there from the start (no change marked): its check at tick 0 finds it
    expect(both(model, { ticks: 100, restartAt: 100, initial: { '0,0,0': [[0, 't:a@0', 1], [1, 't:b@0', 1]] } }).runs).toEqual({ e: 1 });
    // the line loads again at 350 and the controller looks then (ruling R-17); the output bus's timer starts again from
    // that load, so the run's Ex (tick 450, aTick 101) leaves at 453 (aTick 104)
    const reloaded = both(model, { ticks: 700, restartAt: 350, extra: (env) => [sneak(env)] }, 'restart');
    expect([reloaded.runs, reloaded.stats.arrivals('2,0,1')]).toEqual([{ e: 1 }, [[453, 't:x@0', 1]]]);
    // the first case's run ends at 600 after the same load: aTick 251 there, so the push comes at 605 (aTick 256)
    const late = both(model, { ticks: 700, restartAt: 350, extra: (env) => [feeder(env, '0,0,0', 3, ['t:a@0', 't:b@0'], 1, NEVER_AGAIN, 500)] }, 'restart');
    expect(late.stats.arrivals('2,0,1')).toEqual([[605, 't:x@0', 1]]);
  });

  it('imports through its front with a conveyor', () => {
    // an input chest of Alpha and Beta south of the bus, and an import conveyor on the bus's front taking a stack every 20 ticks
    const conveyor: GtCover = { host: '0,0,0', side: 3, kind: 'conveyor', export: false, allowInput: false, op: { tickRate: 20, stacks: 1, items: 64 } };
    const line = (limited: boolean | null) => handModel([inputChestNode('0,0,1', ['t:a@0', 't:b@0']), ebfNode({ inBuses: [busNode('0,0,0', { limited })] })],
      { covers: [conveyor] });
    // with Limiting mode on, Alpha comes in at 20 and Beta at 40 (the conveyor skips the Alpha the bus refuses): runs start at
    // 40, 140, …, 1,940, each set topped up by the next two acts
    const fed = both(line(true), { ticks: 2_000, restartAt: 1_000 });
    expect([fed.runs, fed.findings, fed.stats.final('2,0,0')]).toEqual([{ e: 20 }, [], [['t:x@0', 19], null, null, null]]);
    // without it Alpha takes every slot by 80, and Beta never gets in
    const stuck = both(line(null), { ticks: 2_000, restartAt: 1_000 });
    expect([stuck.runs, stuck.findings.map((f) => [f.code, f.key, f.tick])]).toEqual([{ e: 0 }, [['feed_crowded', 't:b@0', 80], ['feed_overfill', 't:a@0', 40]]]);
  });

  it('finds an output nothing takes and an input that never comes', () => {
    // each run makes a full stack of Ex: four runs (0–400) fill the output bus, which faces nothing
    const node = ebfNode({ recipes: [simRecipe('e', 100, [['t:a@0', 1], ['t:b@0', 1]], [['t:x@0', 64]])] });
    const planned = { e: { 't:a@0': 0.2, 't:b@0': 0.2 } };
    const stuck = both(handModel([node], { planned }), { ticks: 3_000, restartAt: 1_500,
      extra: (env) => [feeder(env, '0,0,0', 3, ['t:a@0', 't:b@0'], 64, NEVER_AGAIN, 0)] });
    // what reached its input bus counts as handed to it: no feed_starved
    expect([stuck.runs, stuck.findings.map((f) => [f.code, f.key, f.tick, f.text])]).toEqual([
      { e: 4 }, [['feed_no_route', 't:x@0', 400, `Nothing takes Ex out of ${node.label}: nothing on the line takes it`]],
    ]);
    // a chest at its output bus's front, which the line's products leave as they arrive, takes them out every 8 ticks: no stall
    const drained = both(handModel([node, outputChestNode('2,0,1')], { planned, sinks: ['t:x@0'] }), { ticks: 3_000, restartAt: 1_500,
      extra: (env) => [feeder(env, '0,0,0', 3, ['t:a@0', 't:b@0'], 64, NEVER_AGAIN, 0)] });
    expect([drained.runs, codes(drained)]).toEqual([{ e: 30 }, []]);
    // something taken out of the output bus every 1,000 ticks starts the stall again: never 1,200 in a row
    const taken = both(handModel([node], { planned }), { ticks: 3_000, restartAt: 1_500,
      extra: (env) => [feeder(env, '0,0,0', 3, ['t:a@0', 't:b@0'], 64, NEVER_AGAIN, 0), taker(env, '2,0,0', 3, 1, [1_000, 2_000])] });
    expect([taken.runs, codes(taken)]).toEqual([{ e: 4 }, []]);
    // the item in the way is what the blocked output meets: an output bus full of Why blocks the Ex
    const junk = both(handModel([ebfNode()]), { ticks: 3_000, restartAt: 1_500, initial: { '2,0,0': fullOf('t:y@0') }, extra: oneSet });
    expect(junk.findings.map((f) => [f.code, f.key, f.tick, f.text])).toEqual([['feed_no_route', 't:y@0', 0, `Nothing takes Why out of ${node.label}: nothing on the line takes it`]]);
    const starved = both(handModel([ebfNode()], { planned }), { ticks: 3_000, restartAt: 1_500,
      extra: (env) => [feeder(env, '0,0,0', 3, ['t:a@0'], 64, NEVER_AGAIN, 0)] });
    expect(starved.findings.map((f) => [f.code, f.key, f.text])).toEqual([['feed_starved', 't:b@0', `${node.label} never gets Beta: nothing on the line hands it over`]]);
  });

  it('runs a fast step\'s runs short and waits while what it makes is held back', () => {
    const fed = (env: SimEnv) => [feeder(env, '0,0,0', 3, ['t:a@0', 't:b@0'], 64, NEVER_AGAIN, 0)];
    // as a fast supplier, a run lasts a tenth as long: 10 ticks
    const fast = both(handModel([ebfNode()]), { ticks: 100, restartAt: 100, extra: (env) => { env.fastSteps = new Set(['e']); return fed(env); } });
    expect(fast.runs).toEqual({ e: 10 });
    // a multiblock whose recipe makes an item held back starts no run before the hold ends, and starts then: at 300 and 400
    const held = both(handModel([ebfNode()]), { ticks: 450, restartAt: 450,
      extra: (env) => { env.heldBack = new Set(['t:x@0']); env.heldUntil = 300; return fed(env); } });
    expect(held.runs).toEqual({ e: 2 });
  });

  it('rolls chances, holds its held items and pools its fluids as a basic machine does', () => {
    const fed = (env: SimEnv) => [feeder(env, '0,0,0', 3, ['t:a@0', 't:b@0'], 64, NEVER_AGAIN, 0)];
    // 11 runs start by tick 1,000 and 10 end: half a Why each gives 5, from runs 2, 4, …, 10; Alpha used up at half a chance: 5
    const chanced = ebfNode({ recipes: [simRecipe('e', 100, [['t:a@0', 1, 0.5], ['t:b@0', 1]], [['t:x@0', 1], ['t:y@0', 1, 0.5]])] });
    const r = both(handModel([chanced]), { ticks: 1_001, restartAt: 1_001, extra: fed });
    expect([r.runs, r.stats.final('0,0,0'), r.stats.final('2,0,0')]).toEqual([
      { e: 11 }, [['t:a@0', 59], ['t:b@0', 53], null, null], [['t:x@0', 10], ['t:y@0', 5], null, null],
    ]);
    // a held item stands in the first input bus from tick 0 and stays there
    const mold = 'gregtech:gt.metaitem.01@32301';
    const held = both(handModel([ebfNode({ recipes: [simRecipe('e', 100, [['t:a@0', 1]], [['t:x@0', 1]], { held: [mold] })] })]),
      { ticks: 250, restartAt: 250, extra: (env) => [feeder(env, '0,0,0', 3, ['t:a@0'], 5, NEVER_AGAIN, 0)] });
    expect([held.runs, held.stats.final('0,0,0')]).toEqual([{ e: 3 }, [[mold, 1], ['t:a@0', 2], null, null]]);
    // AE2's blocking mode counts every slot of an input bus but what it ignores: a GT lens, which the pack tells by its prefix, is not counted
    const engraver = ebfNode({ recipes: [simRecipe('e', 100, [['t:a@0', 1]], [['t:x@0', 1]], { held: ['t:lens@0'] })] });
    const env = envOf(handModel([engraver]));
    const bus = multiblock(engraver, env).buses[0]!;
    expect([bus.stack(0), bus.countsAsEmpty()]).toEqual([{ key: env.keys.id('t:lens@0'), count: 1 }, true]);
    bus.insert(1, env.keys.id('t:a@0'), 1, null);
    expect(bus.countsAsEmpty()).toBe(false);
    // a fluid a slower machine makes: each of the maker's runs (300 ticks) lets one run of the EBF start, the tick after
    const maker = oneSlotNode('3,0,0', { recipes: [simRecipe('m', 300, [['t:a@0', 1]], [['fluid:molten.iron', 144]])] });
    const user = ebfNode({ recipes: [simRecipe('e', 100, [['t:b@0', 1], ['fluid:molten.iron', 144]], [['t:x@0', 1]])] });
    const piped = both(handModel([user, maker], { makers: { 'fluid:molten.iron': ['m'] } }), { ticks: 1_000, restartAt: 1_000,
      extra: (env) => [feeder(env, '3,0,0', 2, ['t:a@0'], 64, NEVER_AGAIN, 0), feeder(env, '0,0,0', 3, ['t:b@0'], 64, NEVER_AGAIN, 0)] });
    expect(piped.runs).toEqual({ e: 3, m: 4 });
    expect(piped.stats.final('0,0,0')).toEqual([['t:b@0', 61], null, null, null]);
    // a fluid it makes goes into the pool at each run's end: the machine that pipes it starts that same tick, after it
    const smelter = ebfNode({ recipes: [simRecipe('e', 100, [['t:b@0', 1]], [['t:x@0', 1], ['fluid:molten.iron', 144]])] });
    const caster = oneSlotNode('3,0,0', { recipes: [simRecipe('u', 20, [['t:a@0', 1], ['fluid:molten.iron', 144]], [['t:y@0', 1]])] });
    const made = both(handModel([smelter, caster], { makers: { 'fluid:molten.iron': ['e'] } }), { ticks: 1_000, restartAt: 1_000,
      extra: (env) => [feeder(env, '3,0,0', 2, ['t:a@0'], 64, NEVER_AGAIN, 0), feeder(env, '0,0,0', 3, ['t:b@0'], 64, NEVER_AGAIN, 0)] });
    expect([made.runs, made.stats.final('3,0,0')]).toEqual([{ e: 10, u: 9 }, [['t:a@0', 55], ['t:y@0', 9]]]);
  });
});
