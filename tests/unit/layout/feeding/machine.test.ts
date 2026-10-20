// tests/unit/layout/feeding/machine.test.ts
import { describe, expect, it } from 'vitest';
import type { ScenarioName } from '../../../../src/server/layout/feeding/contract.ts';
import type { FeedModel, GtCover, MultiNode } from '../../../../src/server/layout/feeding/model.ts';
import { gtTransfer, insertEmpties, insertOneEmpty, KeyTable, NEVER, PHASE, roomFor, Sim, type SimEntity } from '../../../../src/server/layout/feeding/sim/core.ts';
import { basicMachine, type SimEnv } from '../../../../src/server/layout/feeding/sim/machine.ts';
import { NETWORK_MODELS, runScenario, type ScenarioOptions, type ScenarioRun } from '../../../../src/server/layout/feeding/sim/run.ts';
import {
  feeder, handModel, hvExport, inputChestNode, oneSlotNode, outputChestNode, simRecipe, sinkNode, smelterNode, taker,
} from '../../../helpers/feeding-fixtures.ts';
import { IDS } from '../../../helpers/layout-fixtures.ts';

const ticks = 1_000;
const run = (model: ReturnType<typeof handModel>, extra: Parameters<typeof runScenario>[2]['extra'], scenario: ScenarioName = 'steady') =>
  [false, true].map((exhaustive) => runScenario(model, scenario, { ticks, restartAt: 500, exhaustive, extra }));

/** A feeder period past every run here: it offers once. */
const NEVER_AGAIN = 1_000_000;
/** A machine's slots at the end of a run. */
const slotsOf = (r: ScenarioRun, node: string) => r.stats.final(node);

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
const lv = (over: Partial<GtCover> = {}): GtCover =>
  ({ host: '0,0,0', side: 3, kind: 'conveyor', export: true, allowInput: true, op: { tickRate: 100, stacks: 1, items: 16 }, ...over });

describe('the GT basic machine', () => {
  it('runs its recipe as GT does', () => {
    const model = handModel([smelterNode()]);
    const [scheduled, exhaustive] = run(model, (env) => [feeder(env, '0,0,0', 3, ['t:a@0', 't:b@0'], 64, NEVER_AGAIN, 0)]);
    expect(scheduled).toEqual(exhaustive);
    // the feeder fills both slots at tick 0, before the machine's tile phase: runs start at 0, 100, …, 900; nine end before tick 1,000
    expect(scheduled!.runs).toEqual({ sm: 10 });
    expect(slotsOf(scheduled!, '0,0,0')).toEqual([['t:a@0', 54], ['t:b@0', 24], ['t:c@0', 9]]);
  });

  it('takes items as GT does', () => {
    // a second smelter on the same map, whose recipe takes Ex alone: the map takes Ex, but no recipe takes it beside Alpha
    const env = envOf(handModel([smelterNode(), oneSlotNode('0,0,1'), smelterNode({ id: '0,0,2', recipes: [simRecipe('sx', 20, [['t:x@0', 1]], [['t:y@0', 1]])] })]));
    const [a, b, c, x] = ['t:a@0', 't:b@0', 't:c@0', 't:x@0'].map((k) => env.keys.id(k)) as [number, number, number, number];
    // Multi Stack Input Off: an item in an input slot goes only into that slot, and a full one takes no more
    const off = basicMachine(smelterNode(), env);
    expect(off.insert(0, a, 64, null)).toBe(64);
    expect([off.canInsert(1, a, 3), off.canInsert(1, b, 3), off.canInsert(0, a, 3)]).toEqual([false, true, false]);
    // never through the front
    expect(off.canInsert(1, b, 4)).toBe(false);
    // the output side takes items only while Input from Output Side is allowed
    const noOutputSide = basicMachine(smelterNode({ settings: { multiStack: null, inputFilter: null, inputFromOutputSide: false, autoOutput: null } }), env);
    noOutputSide.insert(0, a, 64, null);
    expect([noOutputSide.canInsert(1, b, 3), noOutputSide.canInsert(1, b, 2)]).toEqual([false, true]);
    // Multi Stack Input On: any empty input slot takes it
    const on = basicMachine(smelterNode({ settings: { multiStack: true, inputFilter: null, inputFromOutputSide: null, autoOutput: null } }), env);
    on.insert(0, a, 64, null);
    expect(on.canInsert(1, a, 3)).toBe(true);
    // Input Filter On, two slots, one full: a recipe of the map must use both stacks
    const filtered = basicMachine(smelterNode({ settings: { multiStack: null, inputFilter: true, inputFromOutputSide: null, autoOutput: null } }), env);
    filtered.insert(0, a, 1, null);
    expect([filtered.canInsert(1, b, 3), filtered.canInsert(1, x, 3)]).toEqual([true, false]);
    // with both slots empty the map is enough
    const empty = basicMachine(smelterNode({ settings: { multiStack: null, inputFilter: true, inputFromOutputSide: null, autoOutput: null } }), env);
    expect([empty.canInsert(0, x, 3), empty.canInsert(0, c, 3)]).toEqual([true, false]);
    // only the output slots let items out, and never through the front
    expect([off.canExtract(0, a, 3), off.canExtract(2, c, 3), off.canExtract(2, c, 4)]).toEqual([false, true, false]);
  });

  it('waits on a blocked output and starts again when it is emptied', () => {
    const model = handModel([smelterNode()]);
    const r = both(model, {
      ticks, restartAt: 500, initial: { '0,0,0': [[2, 't:c@0', 64]] },
      extra: (env) => [feeder(env, '0,0,0', 3, ['t:a@0', 't:b@0'], 64, NEVER_AGAIN, 0), taker(env, '0,0,0', 3, 64, [300])],
    });
    // the taker (phase feed) empties the output slot at 300 and the machine sees the change that same tick: runs at 300, 400, …, 900
    expect(r.runs).toEqual({ sm: 7 });
    expect(slotsOf(r, '0,0,0')).toEqual([['t:a@0', 57], ['t:b@0', 36], ['t:c@0', 6]]);
    // one item of another kind in the output slot blocks it as well, and that is the item nothing takes out
    const other = both(model, { ticks: 2_000, restartAt: 2_000, initial: { '0,0,0': [[2, 't:y@0', 1]] },
      extra: (env) => [feeder(env, '0,0,0', 3, ['t:a@0', 't:b@0'], 64, NEVER_AGAIN, 0)] });
    expect([other.runs, other.findings.map((f) => [f.code, f.key, f.tick])]).toEqual([{ sm: 0 }, [['feed_no_route', 't:y@0', 0]]]);
  });

  it('rolls chances deterministically', () => {
    const node = (consume = 1) => oneSlotNode('0,0,0', { outSlots: 2, recipes: [simRecipe('one', 20, [['t:a@0', 1, consume]], [['t:x@0', 1], ['t:y@0', 1, 0.5]])] });
    const fed = (env: SimEnv) => [feeder(env, '0,0,0', 3, ['t:a@0'], 64, NEVER_AGAIN, 0)];
    // runs start at 0, 20, …, 160: 9 started and 8 completed in 170 ticks; the half chance of Why comes out of runs 2, 4, 6 and 8
    const r = both(handModel([node()]), { ticks: 170, restartAt: 170, extra: fed });
    expect(slotsOf(r, '0,0,0')).toEqual([['t:a@0', 55], ['t:x@0', 8], ['t:y@0', 4]]);
    const whyAfter = [1, 2, 3, 4, 5, 6, 7, 8].map((k) => both(handModel([node()]), { ticks: 20 * k + 1, restartAt: 0, extra: fed }).stats.final('0,0,0')[2]?.[1] ?? 0);
    expect(whyAfter).toEqual([0, 1, 1, 2, 2, 3, 3, 4]);
    // inputs used up by chance: the 9 started runs use 4 Alpha
    expect(slotsOf(both(handModel([node(0.5)]), { ticks: 170, restartAt: 170, extra: fed }), '0,0,0')).toEqual([['t:a@0', 60], ['t:x@0', 8], ['t:y@0', 4]]);
  });

  it('keeps its last recipe while its output waits', () => {
    const shared = smelterNode({ recipes: [simRecipe('r1', 20, [['t:a@0', 1]], [['t:x@0', 1]]), simRecipe('r2', 20, [['t:b@0', 1]], [['fluid:molten.iron', 1000]])] });
    const r = both(handModel([shared]), {
      ticks: 3_000, restartAt: 3_000, initial: { '0,0,0': [[2, 't:x@0', 63]] },
      extra: (env) => [feeder(env, '0,0,0', 3, ['t:a@0', 't:b@0'], 64, NEVER_AGAIN, 0)],
    });
    // r1 runs once, to 64 Ex; then its output has no room, and r2 never runs although its Beta is there
    expect(r.runs).toEqual({ r1: 1, r2: 0 });
    expect(codes(r)).toEqual(['feed_no_route', 'feed_pool_starve']);
    expect(r.findings[0]).toMatchObject({ key: 't:x@0', stepId: 'r1', tick: 20 });
    expect(r.findings[1]).toMatchObject({ stepId: 'r2', tick: 20 });
    expect(r.findings[1]!.text).toBe(`${shared.label} never ran its recipe for Molten Iron: it kept waiting on its last recipe's blocked output (Ex)`);
    // r2 ran once before r1 took over: no pool starvation, only the blocked output
    const ranOnce = both(handModel([shared]), {
      ticks: 3_000, restartAt: 3_000, initial: { '0,0,0': [[2, 't:x@0', 63]] },
      extra: (env) => [feeder(env, '0,0,0', 3, ['t:b@0'], 1, NEVER_AGAIN, 0), feeder(env, '0,0,0', 3, ['t:a@0'], 64, NEVER_AGAIN, 30),
        feeder(env, '0,0,0', 3, ['t:b@0'], 64, NEVER_AGAIN, 60)],
    });
    expect([ranOnce.runs, ranOnce.findings.map((f) => [f.code, f.tick])]).toEqual([{ r1: 1, r2: 1 }, [['feed_no_route', 50]]]);
  });

  it('finds a crowded machine', () => {
    const settings = (multiStack: boolean | null) => ({ multiStack, inputFilter: null, inputFromOutputSide: null, autoOutput: null });
    const feed = (env: SimEnv) => [feeder(env, '0,0,0', 3, ['t:a@0'], 64, 20, 0), feeder(env, '0,0,0', 3, ['t:b@0'], 64, 20, 40)];
    const crowd = (multiStack: boolean | null, scenario: ScenarioName = 'steady') => {
      const node = smelterNode({ settings: settings(multiStack) });
      return { node, r: both(handModel([node]), { ticks: 2_000, restartAt: 1_000, extra: feed }, scenario) };
    };
    // Alpha takes both input slots at tick 20, and Beta can never get in
    const { node, r } = crowd(true);
    expect(codes(r)).toEqual(['feed_crowded', 'feed_overfill']);
    expect(r.findings[0]).toMatchObject({ key: 't:b@0', tick: 20, count: 1_980, phase: 'sim', certainty: 'certain', scenario: 'steady', stepId: 'sm' });
    expect(r.findings[0]!.text).toBe(`Beta cannot get into ${node.label}: Alpha fills 2 of its 2 input slots (Multi Stack Input On) while its recipe waits for Beta`);
    expect(r.findings[1]).toMatchObject({ key: 't:a@0', tick: 20 });
    expect(r.findings[1]!.text).toBe(`Alpha fills 2 input slots of ${node.label}, which takes 2 kinds of item`);
    // left unset it is Off, unless the scenario turns it On
    expect(codes(crowd(null).r)).toEqual([]);
    expect(codes(crowd(null, 'multistack_on').r)).toEqual(['feed_crowded', 'feed_overfill']);
    // one kind in both slots of a machine that takes only that kind is no overfill
    const single = smelterNode({ settings: settings(true), recipes: [simRecipe('sm', 100, [['t:a@0', 100]], [['t:c@0', 1]])] });
    const alone = both(handModel([single]), { ticks: 100, restartAt: 100, extra: (env) => [feeder(env, '0,0,0', 3, ['t:a@0'], 64, 20, 0)] });
    expect([alone.stats.final('0,0,0'), codes(alone)]).toEqual([[['t:a@0', 64], ['t:a@0', 64], null], []]);
  });

  it('finds items that never come and outputs nothing takes', () => {
    const planned = { sm: { 't:a@0': 1, 't:b@0': 4 } };
    const node = smelterNode();
    const starved = both(handModel([node], { planned }), { ticks, restartAt: 500, extra: (env) => [feeder(env, '0,0,0', 3, ['t:a@0'], 64, NEVER_AGAIN, 0)] });
    expect(starved.findings.map((f) => [f.code, f.key, f.text])).toEqual([['feed_starved', 't:b@0', `${node.label} never gets Beta: nothing on the line hands it over`]]);
    const stuck = both(handModel([node], { planned }), {
      ticks: 3_000, restartAt: 3_000, initial: { '0,0,0': [[2, 't:c@0', 60]] },
      extra: (env) => [feeder(env, '0,0,0', 3, ['t:a@0', 't:b@0'], 64, NEVER_AGAIN, 0)],
    });
    // four runs fill the output slot to 64 by tick 400; nothing takes Gamma out
    expect(stuck.findings.map((f) => [f.code, f.key, f.tick, f.text])).toEqual([['feed_no_route', 't:c@0', 400, `Nothing takes Gamma out of ${node.label}: nothing on the line takes it`]]);
  });

  it('finds a leak', () => {
    const chest = outputChestNode('0,0,1');
    const model = handModel([smelterNode(), chest], { planned: { sm: { 't:a@0': 1, 't:b@0': 4 } }, sinks: ['t:c@0'] });
    const r = both(model, { ticks, restartAt: 500, extra: (env) => [feeder(env, '0,0,1', 2, ['t:a@0'], 64, NEVER_AGAIN, 0)] });
    const leak = r.findings.filter((f) => f.code === 'feed_leak');
    expect(leak).toHaveLength(1);
    expect(leak[0]).toMatchObject({ key: 't:a@0', count: 64, tick: 0, machine: chest.label, stepId: 'sm' });
    expect(leak[0]!.text).toBe(`Alpha meant for ${smelterNode().label} reached ${chest.label}`);
  });

  it('moves 16 items every 100 ticks with an LV conveyor', () => {
    const model = (cover: GtCover) => handModel([oneSlotNode('0,0,0'), outputChestNode('0,0,1')], { covers: [cover] });
    const initial = { '0,0,0': [[1, 't:x@0', 64]] as Array<[number, string, number]> };
    const r = both(model(lv()), { ticks: 450, restartAt: 450, initial });
    // covers do nothing in the first 10 ticks after a load, so not at 0; 64 moved; the machine makes no more
    expect(r.stats.arrivals('0,0,1')).toEqual([[100, 't:x@0', 16], [200, 't:x@0', 16], [300, 't:x@0', 16], [400, 't:x@0', 16]]);
    expect(slotsOf(r, '0,0,0')).toEqual([null, null]);
    // export without Allow Input: a feeder on that side cannot insert
    const feed = (env: SimEnv) => [feeder(env, '0,0,0', 3, ['t:a@0'], 64, NEVER_AGAIN, 0)];
    const closed = both(model(lv({ allowInput: false })), { ticks: 450, restartAt: 450, initial, extra: feed });
    expect(closed.stats.arrivals('0,0,1')).toEqual(r.stats.arrivals('0,0,1'));
    expect(slotsOf(closed, '0,0,0')[0]).toBeNull();
    expect(slotsOf(both(model(lv()), { ticks: 450, restartAt: 450, initial, extra: feed }), '0,0,0')[0]).not.toBeNull();
  });

  it('drops what a conveyor pushes into nothing', () => {
    const node = oneSlotNode('0,0,0');
    const r = both(handModel([node], { covers: [lv()] }), { ticks: 450, restartAt: 450, initial: { '0,0,0': [[1, 't:x@0', 64]] } });
    expect(r.stats.spilledTotal('0,0,0')).toBe(64);
    expect(slotsOf(r, '0,0,0')).toEqual([null, null]);
    const dropped = r.unknowns.filter((u) => u.code === 'items_dropped');
    expect(dropped).toHaveLength(1);
    expect(dropped[0]!.text).toContain(node.label);
    expect(dropped[0]!.text).toContain('64 Ex');
    expect(r.findings).toEqual([]);
  });

  it('skips a stack its target refuses', () => {
    const model = handModel([oneSlotNode('0,0,0', { outSlots: 2 }), sinkNode('0,0,1', 2)], { covers: [hvExport('0,0,0', 3)] });
    const initial = { '0,0,0': [[1, 't:x@0', 10], [2, 't:y@0', 10]], '0,0,1': [[0, 't:x@0', 64], [1, 't:y@0', 1]] } as Record<string, Array<[number, string, number]>>;
    // the conveyor acts at tick 20: the sink refuses Ex (Multi Stack Input Off keeps Ex to its full slot 0), so it moves the Why
    const before = both(model, { ticks: 20, restartAt: 20, initial });
    expect(slotsOf(before, '0,0,0')).toEqual([null, ['t:x@0', 10], ['t:y@0', 10]]);
    const after = both(model, { ticks: 30, restartAt: 30, initial });
    expect(slotsOf(after, '0,0,0')).toEqual([null, ['t:x@0', 10], null]);
    expect(slotsOf(after, '0,0,1')).toEqual([['t:x@0', 64], ['t:y@0', 11], null]);
  });
});

describe('the simulation core', () => {
  it('numbers keys in key order', () => {
    const keys = new KeyTable(['t:b@0', 'ae2fc:fluid_packet@0', 't:a@0', 't:b@0']);
    expect([keys.size, keys.id('ae2fc:fluid_packet@0'), keys.id('t:a@0'), keys.id('t:b@0'), keys.key(2)]).toEqual([3, 0, 1, 2, 't:b@0']);
    expect([keys.limit(0), keys.limit(1)]).toEqual([1, 64]);
    expect(() => keys.id('t:zz@0')).toThrow(/knows no item t:zz@0/);
  });

  it('wakes an entity this tick when its turn is still to come, else the next', () => {
    const log: string[] = [];
    const entities: Record<string, SimEntity> = {};
    const sim = new Sim(10, false);
    const toy = (name: string, phase: number, order: number, act: (t: number) => number): SimEntity => {
      const e = { phase, order, tick: (t: number) => { log.push(`${name}${t}`); return act(t); } };
      entities[name] = e;
      return e;
    };
    // A wakes B (later in the tile phase) and C (a later phase) at 5: both run at 5; C wakes A and B back, whose turns have passed: 6
    sim.add(toy('A', PHASE.tile, 0, (t) => {
      if (t === 5) { sim.wake(entities.B!, entities.A!); sim.wake(entities.C!, entities.A!); }
      return t < 5 ? 5 : NEVER;
    }), 0);
    sim.add(toy('B', PHASE.tile, 1, () => NEVER), 0);
    sim.add(toy('C', PHASE.conduits, 0, (t) => {
      if (t === 5) {
        sim.wake(entities.A!, entities.C!);
        sim.wake(entities.B!, entities.C!);
        // an entity asking for a later tick in its own tick keeps it, whatever it returns
        sim.wakeAt(entities.C!, 8);
      }
      return NEVER;
    }), 0);
    sim.run((t) => { if (t === 8) sim.wake(entities.B!, null); });
    expect(log).toEqual(['A0', 'B0', 'C0', 'A5', 'B5', 'C5', 'A6', 'B6', 'C8', 'B9']);
    expect(() => sim.add(toy('D', PHASE.tile, 0, () => NEVER), 0)).toThrow();
  });

  it('runs every entity on every tick when exhaustive', () => {
    const log: number[] = [];
    const sim = new Sim(4, true);
    sim.add({ phase: PHASE.tile, order: 0, tick: (t) => { log.push(t); return NEVER; } }, 3);
    sim.run();
    expect(log).toEqual([0, 1, 2, 3]);
  });

  it('inserts as each mod does and counts room as Project Red does', () => {
    const env = envOf(handModel([smelterNode(), outputChestNode('0,0,1')]));
    const chest = env.inv('0,0,1')!;
    const [a, b] = ['t:a@0', 't:b@0'].map((k) => env.keys.id(k)) as [number, number];
    // EnderIO puts what does not merge into one empty slot; gtnhlib and Project Red into every empty slot
    expect(insertOneEmpty(chest, a, 100, 0, null)).toBe(64);
    expect(insertEmpties(chest, a, 100, 0, null)).toBe(100);
    expect([chest.stack(0)?.count, chest.stack(1)?.count, chest.stack(2)?.count]).toEqual([64, 64, 36]);
    expect(roomFor(chest, a, 0)).toBe(28 + 24 * 64);
    // an empty two-slot machine with Multi Stack Input Off: room for two stacks, but it takes one (research C19)
    const machine = env.inv('0,0,0')!;
    expect(roomFor(machine, a, 3)).toBe(128);
    expect(insertEmpties(machine, a, 128, 3, null)).toBe(64);
    expect([roomFor(machine, a, 3), roomFor(machine, b, 3)]).toEqual([0, 64]);
  });

  it('moves stacks by GT\'s transfer, skipping what is refused', () => {
    const env = envOf(handModel([oneSlotNode('0,0,0'), outputChestNode('0,0,1')], { supply: ['t:y@0'] }));
    const chest = env.inv('0,0,1')!;
    const [x, y] = ['t:x@0', 't:y@0'].map((k) => env.keys.id(k)) as [number, number];
    chest.insert(0, x, 10, null);
    chest.insert(1, y, 10, null);
    chest.insert(2, x, 64, null);
    const onlyY = { taken: 0, accept(key: number, n: number) { const m = key === y ? Math.min(n, 5 - this.taken) : 0; this.taken += m; return m; } };
    // a target that takes 5 Why: the Ex slots are skipped and one stack moves
    expect(gtTransfer(chest, chest.sideSlots(0), 0, onlyY, 1, 4, 64, null)).toBe(5);
    expect(chest.stack(1)?.count).toBe(5);
    // at most `stacks` stacks of at most `items` each, and only what `accept` lets through
    const all = { accept: (_k: number, n: number) => n };
    expect(gtTransfer(chest, chest.sideSlots(0), 0, all, 1, 2, 8, null)).toBe(13);
    expect([chest.stack(0)?.count, chest.stack(1), chest.stack(2)?.count]).toEqual([2, null, 64]);
    expect(gtTransfer(chest, chest.sideSlots(0), 0, all, 1, 64, 64, null, (k) => k === y)).toBe(0);
  });
});

describe('chests', () => {
  it('keeps an input chest stocked and keeps what is pushed into it', () => {
    const keys = Array.from({ length: 28 }, (_, i) => `t:k${String(i).padStart(2, '0')}@0`);
    const env = envOf(handModel([inputChestNode('0,0,0', ['t:b@0', 't:a@0']), inputChestNode('0,0,5', keys)], { supply: ['t:x@0'] }));
    const chest = env.inv('0,0,0')!;
    const [a, x] = ['t:a@0', 't:x@0'].map((k) => env.keys.id(k)) as [number, number];
    expect([chest.stack(0), chest.stack(1)?.count, chest.stack(2)]).toEqual([{ key: a, count: 64 }, 64, null]);
    // refilled at once, and nothing goes into a stocked slot
    expect(chest.extract(0, 10, null)).toBe(10);
    expect(chest.stack(0)?.count).toBe(64);
    expect(chest.canInsert(0, a, 0)).toBe(false);
    expect(insertEmpties(chest, x, 5, 0, null)).toBe(5);
    expect([chest.stack(2), env.stats.arrivals('0,0,0')]).toEqual([{ key: x, count: 5 }, [[0, 't:x@0', 5]]]);
    // what arrives in one tick is one arrival, over however many slots it went into
    expect(insertEmpties(chest, x, 70, 0, null)).toBe(70);
    expect([chest.stack(2)?.count, chest.stack(3)?.count, env.stats.arrivals('0,0,0')]).toEqual([64, 11, [[0, 't:x@0', 75]]]);
    // while Beta is held back its stocked slot looks empty, and still takes nothing: what is pushed goes to the free slots
    env.heldBack = new Set(['t:b@0']);
    env.heldUntil = 100;
    const b = env.keys.id('t:b@0');
    expect([chest.stack(1), insertEmpties(chest, b, 5, 0, null), chest.stack(1), chest.stack(4)]).toEqual([null, 5, null, { key: b, count: 5 }]);
    // only 27 stacks fit
    const big = runScenario(handModel([inputChestNode('0,0,5', keys)]), 'steady', { ticks: 1, restartAt: 1 });
    expect(big.unknowns.map((u) => u.code)).toEqual(['stack_sizes', 'input_chest_full']);
    expect(big.stats.final('0,0,5').filter((s) => s !== null)).toHaveLength(27);
  });

  it('lets the line\'s products leave an output chest, and fills it with the rest', () => {
    const full = Array.from({ length: 27 }, (_, i) => [i, 't:a@0', 64] as [number, string, number]);
    const model = handModel([outputChestNode('0,0,0')], { sinks: ['t:c@0'], supply: ['t:a@0', 't:x@0'] });
    const r = both(model, { ticks: 3, restartAt: 3, extra: (env) => [feeder(env, '0,0,0', 2, ['t:c@0', 't:x@0'], 64, 1, 0)] });
    // Gamma leaves as it arrives, every tick; Ex stays
    expect(r.stats.arrivals('0,0,0')).toEqual([[0, 't:c@0', 64], [0, 't:x@0', 64], [1, 't:c@0', 64], [1, 't:x@0', 64], [2, 't:c@0', 64], [2, 't:x@0', 64]]);
    expect(r.stats.final('0,0,0').slice(0, 4)).toEqual([['t:x@0', 64], ['t:x@0', 64], ['t:x@0', 64], null]);
    expect(r.out).toEqual({ 't:c@0': 192, 't:x@0': 192 });
    // full of Alpha, it has no room for the products either
    const stuck = both(model, { ticks: 1, restartAt: 1, initial: { '0,0,0': full }, extra: (env) => [feeder(env, '0,0,0', 2, ['t:c@0'], 64, 1, 0)] });
    expect(stuck.stats.arrivals('0,0,0')).toEqual([]);
  });
});

describe('covers, timers and scenarios', () => {
  const initial = { '0,0,0': [[1, 't:x@0', 64]] as Array<[number, string, number]> };

  it('starts the covers\' and the tiles\' timers again when the line loads again', () => {
    const model = handModel([oneSlotNode('0,0,0'), outputChestNode('0,0,1')], { covers: [lv()] });
    const ticksOf = (r: ScenarioRun) => r.stats.arrivals('0,0,1').map(([t]) => t);
    expect(ticksOf(both(model, { ticks: 600, restartAt: 250, initial }))).toEqual([100, 200, 300, 400]);
    expect(ticksOf(both(model, { ticks: 600, restartAt: 250, initial }, 'restart'))).toEqual([100, 200, 350, 450]);
    // an idle machine whose inputs are there looks for its recipe when its timer reaches 600: at 599, or 849 after a load at 250
    const full = { '0,0,0': [[0, 't:a@0', 64], [1, 't:b@0', 64]] as Array<[number, string, number]> };
    expect(both(handModel([smelterNode()]), { ticks: 1_000, restartAt: 250, initial: full }).runs).toEqual({ sm: 5 });
    expect(both(handModel([smelterNode()]), { ticks: 1_000, restartAt: 250, initial: full }, 'restart').runs).toEqual({ sm: 2 });
  });

  it('pushes its outputs out of its output side with auto-output on', () => {
    const auto = (over: Parameters<typeof oneSlotNode>[1] = {}) => oneSlotNode('0,0,0', { settings: { multiStack: null, inputFilter: null, inputFromOutputSide: null, autoOutput: true }, ...over });
    const fed = (env: SimEnv) => [feeder(env, '0,0,0', 2, ['t:a@0'], 3, NEVER_AGAIN, 0)];
    const r = both(handModel([auto(), outputChestNode('0,0,1')]), { ticks: 100, restartAt: 100, extra: fed });
    expect(r.stats.arrivals('0,0,1')).toEqual([[20, 't:x@0', 1], [40, 't:x@0', 1], [60, 't:x@0', 1]]);
    // with nothing at its output side it drops them; a steam machine never auto-outputs
    const dropped = both(handModel([auto()]), { ticks: 100, restartAt: 100, extra: fed });
    expect([dropped.stats.spilledTotal('0,0,0'), dropped.unknowns.map((u) => u.code)]).toEqual([3, ['stack_sizes', 'items_dropped']]);
    const steam = both(handModel([auto({ steam: true }), outputChestNode('0,0,1')]), { ticks: 100, restartAt: 100, extra: fed });
    expect([steam.stats.arrivals('0,0,1'), slotsOf(steam, '0,0,0')]).toEqual([[], [null, ['t:x@0', 3]]]);
  });

  it('moves only its filter\'s items with an Item Filter cover, every tick from age 10', () => {
    const filter: GtCover = { host: '0,0,0', side: 3, kind: 'filter', export: true, allowInput: true, filter: { mode: 'whitelist', keys: ['t:y@0'] } };
    const two = { '0,0,0': [[1, 't:x@0', 10], [2, 't:y@0', 10]] as Array<[number, string, number]> };
    const r = both(handModel([oneSlotNode('0,0,0', { outSlots: 2 }), outputChestNode('0,0,1')], { covers: [filter] }), { ticks: 30, restartAt: 30, initial: two });
    expect(r.stats.arrivals('0,0,1')).toEqual([[10, 't:y@0', 10]]);
    const alone = both(handModel([oneSlotNode('0,0,0', { outSlots: 2 })], { covers: [filter] }), { ticks: 30, restartAt: 30, initial: two });
    expect([alone.stats.spilledTotal('0,0,0'), slotsOf(alone, '0,0,0')]).toEqual([0, [null, ['t:x@0', 10], ['t:y@0', 10]]]);
  });

  it('lets items through a shutter one way', () => {
    const shut = (mode: 'input_only' | 'output_only'): GtCover => ({ host: '0,0,0', side: 3, kind: 'shutter', export: false, allowInput: false, shutter: mode });
    const io = (env: SimEnv) => [feeder(env, '0,0,0', 3, ['t:a@0'], 5, NEVER_AGAIN, 0), taker(env, '0,0,0', 3, 5, [1])];
    const start = { '0,0,0': [[1, 't:x@0', 5]] as Array<[number, string, number]> };
    const run2 = (mode: 'input_only' | 'output_only') => both(handModel([oneSlotNode('0,0,0', { recipes: [] })], { covers: [shut(mode)], supply: ['t:a@0', 't:x@0'] }),
      { ticks: 5, restartAt: 5, initial: start, extra: io });
    expect(slotsOf(run2('input_only'), '0,0,0')).toEqual([['t:a@0', 5], ['t:x@0', 5]]);
    expect(slotsOf(run2('output_only'), '0,0,0')).toEqual([null, null]);
  });

  it('imports with a conveyor, and waits for an input held back', () => {
    // an input chest of Alpha and Beta north of the smelter, whose import conveyor on that side takes a stack every 20 ticks
    const model = handModel([inputChestNode('0,0,0', ['t:a@0', 't:b@0']), smelterNode({ id: '0,0,1' })], {
      covers: [{ host: '0,0,1', side: 2, kind: 'conveyor', export: false, allowInput: false, op: { tickRate: 20, stacks: 1, items: 64 } }],
      planned: { sm: { 't:a@0': 0.2, 't:b@0': 0.8 } },
    });
    // Alpha comes in at 20, Beta at 40: runs at 40, 140, …, 940
    const steady = both(model, { ticks: 1_000, restartAt: 500 });
    expect([steady.runs, codes(steady)]).toEqual([{ sm: 10 }, []]);
    // the chest's Beta held back until 300 (as late_input sets it): it comes in at 300
    const late = both(model, { ticks: 1_000, restartAt: 500, extra: (env) => { env.heldBack = new Set(['t:b@0']); env.heldUntil = 300; return []; } });
    expect(late.runs).toEqual({ sm: 7 });
    // a machine whose step makes an item held back starts no run before the hold ends, and starts then
    const maker = both(handModel([smelterNode()]), {
      ticks: 1_000, restartAt: 500,
      extra: (env) => { env.heldBack = new Set(['t:c@0']); env.heldUntil = 300; return [feeder(env, '0,0,0', 3, ['t:a@0', 't:b@0'], 64, NEVER_AGAIN, 0)]; },
    });
    expect(maker.runs).toEqual({ sm: 7 });
    // a fast supplier's runs last a tenth as long
    const fast = both(handModel([smelterNode()]), {
      ticks: 1_000, restartAt: 500, extra: (env) => { env.fastSteps = new Set(['sm']); return [feeder(env, '0,0,0', 3, ['t:a@0', 't:b@0'], 64, NEVER_AGAIN, 0)]; },
    });
    expect([fast.runs, slotsOf(fast, '0,0,0')]).toEqual([{ sm: 16 }, [['t:a@0', 48], null, ['t:c@0', 16]]]);
  });

  it('runs a step fed by a piped fluid only as fast as the fluid\'s maker', () => {
    const maker = oneSlotNode('0,0,0', { recipes: [simRecipe('e', 20, [['t:a@0', 1]], [['fluid:molten.iron', 144]])] });
    const user = smelterNode({ id: '0,0,1', recipes: [simRecipe('s', 10, [['t:b@0', 1], ['fluid:molten.iron', 144]], [['t:x@0', 1]])] });
    const fed = (env: SimEnv) => [feeder(env, '0,0,0', 2, ['t:a@0'], 64, NEVER_AGAIN, 0), feeder(env, '0,0,1', 2, ['t:b@0'], 64, NEVER_AGAIN, 0)];
    // the maker's runs end at 20, 40, …, 180 and each fills the pool for one run of the user
    expect(both(handModel([maker, user], { makers: { 'fluid:molten.iron': ['e'] } }), { ticks: 200, restartAt: 200, extra: fed }).runs).toEqual({ e: 10, s: 9 });
    // a fluid the line takes from outside is always there
    expect(both(handModel([maker, user]), { ticks: 200, restartAt: 200, extra: fed }).runs).toEqual({ e: 10, s: 20 });
  });

  it('leaves out what it has no model for', () => {
    const multi: MultiNode = {
      kind: 'multi', id: '0,0,0', pos: [0, 0, 0], local: [0, 0, 0], name: 'Electric Blast Furnace', label: 'Electric Blast Furnace at 0 0 0', stepIds: ['e'],
      recipes: [simRecipe('e', 100, [['t:a@0', 1]], [['t:x@0', 1]])], kinds: ['t:a@0'], mteId: IDS.EBF, inBuses: [], outBuses: [], inputSeparation: null,
      separationDefault: true,
    };
    const r = both(handModel([multi], { networks: [{ kind: 'gtpipe', pipes: [] }], planned: { e: { 't:a@0': 1 } } }), { ticks: 10, restartAt: 10 });
    expect(r.unknowns.map((u) => [u.code, u.pos, u.stepId])).toEqual([['stack_sizes', undefined, undefined], ['not_simulated', [0, 0, 0], 'e'], ['not_simulated', undefined, undefined]]);
    expect([r.findings, r.runs]).toEqual([[], {}]);
  });
});

describe('the detectors', () => {
  it('finds an input that comes too slowly while the recipe waits for it', () => {
    const node = smelterNode();
    const model = handModel([node], { planned: { sm: { 't:a@0': 0.2, 't:b@0': 0.8 } } });
    // Beta comes 4 every 200 ticks: 0.4/s against the 0.8/s a run every 5 s needs; the recipe waits half the time
    const r = both(model, { ticks: 2_000, restartAt: 1_000, extra: (env) => [feeder(env, '0,0,0', 3, ['t:a@0'], 64, NEVER_AGAIN, 0), feeder(env, '0,0,0', 3, ['t:b@0'], 4, 200, 0)] });
    expect(r.findings.map((f) => [f.code, f.key, f.tick, f.text])).toEqual([['feed_slow', 't:b@0', 1_100, `${node.label} gets Beta at 0.4/s, below the 0.8/s the plan needs`]]);
    // the same rate with more than 10 % of slack in the plan is not slow
    expect(codes(both(handModel([node], { planned: { sm: { 't:b@0': 0.44 } } }), { ticks: 2_000, restartAt: 1_000,
      extra: (env) => [feeder(env, '0,0,0', 3, ['t:a@0'], 64, NEVER_AGAIN, 0), feeder(env, '0,0,0', 3, ['t:b@0'], 4, 200, 0)] }))).toEqual([]);
  });

  it('counts a stall from the last time something was taken out', () => {
    // each run makes 4 Gamma, so taking 1 out of a full output slot leaves it blocked
    const node = smelterNode({ recipes: [simRecipe('sm', 100, [['t:a@0', 1], ['t:b@0', 4]], [['t:c@0', 4]])] });
    const go = (at: number[]) => both(handModel([node]), {
      ticks: 3_000, restartAt: 3_000, initial: { '0,0,0': [[2, 't:c@0', 64]] },
      extra: (env) => [feeder(env, '0,0,0', 3, ['t:a@0', 't:b@0'], 64, NEVER_AGAIN, 0), taker(env, '0,0,0', 3, 1, at)],
    });
    expect(go([500]).findings.map((f) => [f.code, f.tick])).toEqual([['feed_no_route', 500]]);
    // something taken out every 1,000 ticks: never 1,200 in a row
    expect(codes(go([500, 1_500, 2_500]))).toEqual([]);
  });

  it('looks at the slots, not the side, for what keeps a kind out', () => {
    // its output side takes nothing (Input from Output Side off), so it is fed from the north; Beta never comes, but nothing keeps it out
    const node = smelterNode({ settings: { multiStack: null, inputFilter: null, inputFromOutputSide: false, autoOutput: null } });
    const r = both(handModel([node]), { ticks: 2_000, restartAt: 1_000, extra: (env) => [feeder(env, '0,0,0', 2, ['t:a@0'], 64, NEVER_AGAIN, 0)] });
    expect(codes(r)).toEqual([]);
  });
});

describe('the GT basic machine, more closely', () => {
  it('retries a blocked auto-output every 300 ticks', () => {
    // its output slot is full and the chest at its output side is full of Why: the push at tick 0 fails, and the next tries
    // come at 1, 301, … (outputBlocked % 300 === 1), not at the next change, since the chest's change does not reach it
    const auto = oneSlotNode('0,0,0', { settings: { multiStack: null, inputFilter: null, inputFromOutputSide: null, autoOutput: true } });
    const junk = Array.from({ length: 27 }, (_, i) => [i, 't:y@0', 64] as [number, string, number]);
    const r = both(handModel([auto, outputChestNode('0,0,1')]), {
      ticks: 330, restartAt: 330, initial: { '0,0,0': [[1, 't:x@0', 64]], '0,0,1': junk },
      extra: (env) => [feeder(env, '0,0,0', 2, ['t:a@0'], 64, NEVER_AGAIN, 0), taker(env, '0,0,1', 2, 64, [100])],
    });
    expect(r.stats.arrivals('0,0,1')).toEqual([[301, 't:x@0', 64]]);
    // the push wakes its recipe check: runs at 301 and 321, whose Ex finds the chest full again
    expect([r.runs, slotsOf(r, '0,0,0')]).toEqual([{ one: 2 }, [['t:a@0', 62], ['t:x@0', 1]]]);
  });

  it('holds its held items and takes inputs from the lowest slot', () => {
    const mold = 'gregtech:gt.metaitem.01@32301';
    const node = oneSlotNode('0,0,0', { inSlots: 2, recipes: [simRecipe('one', 20, [['t:a@0', 1]], [['t:x@0', 1]], { held: [mold] })] });
    const env = envOf(handModel([node]));
    const m = env.inv('0,0,0')!;
    // the mold stands in slot 0 from tick 0, and AE2's blocking mode does not count it
    expect([m.stack(0), m.countsAsEmpty()]).toEqual([{ key: env.keys.id(mold), count: 1 }, true]);
    m.insert(1, env.keys.id('t:a@0'), 1, null);
    expect(m.countsAsEmpty()).toBe(false);
    const r = both(handModel([node]), { ticks: 30, restartAt: 30, extra: (e) => [feeder(e, '0,0,0', 3, ['t:a@0'], 5, NEVER_AGAIN, 0)] });
    // runs at 0 and 20
    expect([r.runs, slotsOf(r, '0,0,0')]).toEqual([{ one: 2 }, [[mold, 1], ['t:a@0', 3], ['t:x@0', 1]]]);
    // without its mold it waits
    const noMold = both(handModel([node]), { ticks: 30, restartAt: 30, initial: { '0,0,0': [[0, 't:a@0', 5]] },
      extra: (e) => [feeder(e, '0,0,0', 3, ['t:a@0'], 1, NEVER_AGAIN, 0)] });
    expect([noMold.runs, slotsOf(noMold, '0,0,0')]).toEqual([{ one: 0 }, [['t:a@0', 6], null, null]]);
    // Multi Stack Input On, Alpha in both slots (the feeder's 1 tops slot 0 up to 4): a run of 5 takes slot 0's 4 first, then 1 from slot 1
    const on = smelterNode({ settings: { multiStack: true, inputFilter: null, inputFromOutputSide: null, autoOutput: null },
      recipes: [simRecipe('sm', 100, [['t:a@0', 5]], [['t:c@0', 1]])] });
    const r2 = both(handModel([on]), { ticks: 50, restartAt: 50, initial: { '0,0,0': [[0, 't:a@0', 3], [1, 't:a@0', 64]] },
      extra: (e) => [feeder(e, '0,0,0', 3, ['t:a@0'], 1, NEVER_AGAIN, 0)] });
    expect([r2.runs, slotsOf(r2, '0,0,0')]).toEqual([{ sm: 1 }, [null, ['t:a@0', 63], null]]);
  });

  it('adds up small chances exactly', () => {
    const node = oneSlotNode('0,0,0', { outSlots: 2, recipes: [simRecipe('one', 20, [['t:a@0', 1]], [['t:x@0', 1], ['t:y@0', 1, 0.1]])] });
    const r = both(handModel([node]), { ticks: 201, restartAt: 201, extra: (e) => [feeder(e, '0,0,0', 3, ['t:a@0'], 10, NEVER_AGAIN, 0)] });
    // ten runs at a chance of 0.1 give exactly one Why, though ten floating-point tenths fall short of 1
    expect(slotsOf(r, '0,0,0')).toEqual([null, ['t:x@0', 10], ['t:y@0', 1]]);
  });
});

describe('a scenario run', () => {
  it('pushes into what a network registers at a cell and asks the network why', () => {
    const got: Array<[number, number, number]> = [];
    NETWORK_MODELS.gtpipe = () => ({
      entities: [], explain: (kind, node, key) => (kind === 'in' && node === '0,0,0' && key === 't:a@0' ? 'its pipe brings none' : null),
      receivers: [{ at: '0,0,1', side: 2, target: { accept: (key, n, side) => { got.push([key, n, side]); return n; } } }],
    });
    try {
      const model = handModel([oneSlotNode('0,0,0')], { covers: [lv()], networks: [{ kind: 'gtpipe', pipes: [] }], planned: { one: { 't:a@0': 1 } } });
      const r = both(model, { ticks: 150, restartAt: 150, initial: { '0,0,0': [[1, 't:x@0', 64]] } });
      // the conveyor's side 3 meets the receiver at 0,0,1 for that cell's side 2 (twice: the scheduled run and the exhaustive one)
      const x = r.stats.keys.id('t:x@0');
      expect(got).toEqual([[x, 16, 2], [x, 16, 2]]);
      expect(r.findings.map((f) => f.text)).toEqual(['Basic Macerator at 0 0 0 never gets Alpha: its pipe brings none']);
      expect(r.unknowns.map((u) => u.code)).toEqual(['stack_sizes']);
    } finally {
      delete NETWORK_MODELS.gtpipe;
    }
  });

  it('runs the networks\' restarts when the line loads again, and wakes everything for it', () => {
    const acted: number[] = [];
    NETWORK_MODELS.gtpipe = (_net, env) => {
      let armed = -1;
      // a toy network entity that sleeps until a restart arms it for 5 ticks later
      const toy: SimEntity = { phase: PHASE.tile, order: 0, tick: (t) => { if (t === armed) acted.push(t); return armed > t ? armed : NEVER; } };
      return { entities: [toy], explain: () => null, receivers: [], restart: () => { armed = env.loadedAt + 5; } };
    };
    try {
      const model = handModel([oneSlotNode('0,0,0')], { networks: [{ kind: 'gtpipe', pipes: [] }] });
      both(model, { ticks: 400, restartAt: 250 }, 'restart');
      expect(acted).toEqual([255, 255]);
      both(model, { ticks: 400, restartAt: 250 });
      expect(acted).toEqual([255, 255]);
    } finally {
      delete NETWORK_MODELS.gtpipe;
    }
  });

  it('does not count a product that leaves the line as a leak', () => {
    const model = handModel([smelterNode(), outputChestNode('0,0,1')], { planned: { sm: { 't:a@0': 1 } }, sinks: ['t:a@0'] });
    const r = both(model, { ticks: 10, restartAt: 10, extra: (env) => [feeder(env, '0,0,1', 2, ['t:a@0'], 64, NEVER_AGAIN, 0)] });
    expect(r.findings.filter((f) => f.code === 'feed_leak')).toEqual([]);
    expect(r.out).toEqual({ 't:a@0': 64 });
  });
});
