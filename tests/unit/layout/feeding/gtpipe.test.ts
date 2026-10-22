// tests/unit/layout/feeding/gtpipe.test.ts
import { describe, expect, it } from 'vitest';
import { OPPOSITE } from '../../../../src/shared/layout/geometry.ts';
import { DEFAULT_TICKS, type ScenarioName } from '../../../../src/server/layout/feeding/contract.ts';
import type { BasicNode, FeedModel, FeedNode, GtCover, GtPipeNet, MultiNode } from '../../../../src/server/layout/feeding/model.ts';
import { readLine } from '../../../../src/server/layout/feeding/read.ts';
import { isInv, isTarget, NEVER, PHASE, type PushTarget, type SimEntity, type SimInv } from '../../../../src/server/layout/feeding/sim/core.ts';
import { gtPipeModel } from '../../../../src/server/layout/feeding/sim/gtpipe.ts';
import type { SimEnv } from '../../../../src/server/layout/feeding/sim/machine.ts';
import { runScenario, type ScenarioOptions, type ScenarioRun } from '../../../../src/server/layout/feeding/sim/run.ts';
import {
  busNode, chain2, ebfNode, hvExport, inputChestNode, layFeed, oneSlotNode, outBusNode, outputChestNode, pipeModel, simRecipe, sinkNode,
} from '../../../helpers/feeding-fixtures.ts';

// an input chest 0,0,0 north of pipe P1 0,0,1 (HV import conveyor on P1's side 2); P1 – P2 1,0,1 – P3 2,0,1;
// a one-slot machine N 1,0,2 south of P2 (planned to take t:x@0); an output chest 2,0,2 south of P3
const tail = (p3South?: GtCover, n: BasicNode = sinkNode('1,0,2', 1, 2), capacity = 1) => pipeModel([inputChestNode('0,0,0', ['t:x@0']), n, outputChestNode('2,0,2')],
  [{ id: '0,0,1', links: 0b100100 }, { id: '1,0,1', capacity, links: 0b111000 }, { id: '2,0,1', links: 0b011000 }],
  [{ host: '0,0,1', side: 2, kind: 'conveyor', export: false, allowInput: false, op: { tickRate: 20, stacks: 1, items: 64 } }, ...(p3South ? [p3South] : [])],
  { planned: { n: { 't:x@0': 1 } } });

/** `model` run scheduled and tick by tick; the two runs must be deep-equal (Task 4 rule 3). Returns the scheduled one. */
function both(model: FeedModel, opts: Omit<ScenarioOptions, 'exhaustive'>, scenario: ScenarioName = 'steady'): ScenarioRun {
  const [scheduled, exhaustive] = [false, true].map((x) => runScenario(model, scenario, { ...opts, exhaustive: x }));
  expect(scheduled).toEqual(exhaustive);
  return scheduled!;
}

/** The environment of a run of `model` that runs no tick (with `initial` contents): for pushing into a pipe directly. */
function envOf(model: FeedModel, initial?: ScenarioOptions['initial']): SimEnv {
  let env: SimEnv | undefined;
  runScenario(model, 'steady', { ticks: 0, restartAt: 0, initial, extra: (e) => { env = e; return []; } });
  return env!;
}

/** A test entity (phase `feed`) that at tick `at` pushes 64 of `key` out of side `side` of the cell `from`, as a cover there would. */
function pushIn(env: SimEnv, from: string, side: number, key: string, at: number): SimEntity {
  const self: SimEntity = {
    phase: PHASE.feed, order: 0,
    tick(t: number): number {
      const into = env.push(from, side);
      if (t === at && into !== null && isTarget(into)) into.accept(env.keys.id(key), 64, OPPOSITE[side]!, self);
      return t < at ? at : NEVER;
    },
  };
  return self;
}

/** What a GT transfer out of side `side` of the cell `from` meets, as both a push target and an inventory: a pipe. */
function pipeAt(env: SimEnv, from: string, side: number): PushTarget & SimInv {
  const there = env.push(from, side);
  if (there === null || !isTarget(there) || !isInv(there)) throw new Error(`no pipe beside ${from} on side ${side}`);
  return there;
}

const arrivals = (ticks: number[], key = 't:x@0', n = 64) => ticks.map((t) => [t, key, n]);
/** The tail's runs: 120 ticks, no restart. */
const short = { ticks: 120, restartAt: 120 };

describe('GT item pipes', () => {
  it('hands items to the nearest taker, then to the next', () => {
    const runs = [false, true].map((exhaustive) => runScenario(tail(), 'steady', { ticks: 120, restartAt: 120, exhaustive }));
    expect(runs[0]).toEqual(runs[1]);
    // P1's conveyor imports a stack at 20, 40, … (covers wait 10 ticks after a load); P1 checks at 9, 19, 29, … (aTick % 10)
    // and holds a fresh stack for one check, so it sends at 39, 59, …; N (1 hop) takes the first, then is full; the chest (2 hops) the rest
    expect(runs[0]!.stats.deliveries('1,0,2')).toEqual([[39, 't:x@0', 64]]);
    expect(runs[0]!.stats.arrivals('2,0,2')).toEqual([59, 79, 99, 119].map((t) => [t, 't:x@0', 64]));
    expect(runs[0]!.findings.map((f) => f.code)).toEqual(['feed_leak']);
  });

  it('never pushes through a shutter on Only Input allowed', () => {
    const shut = both(tail({ host: '2,0,1', side: 3, kind: 'shutter', export: false, allowInput: false, shutter: 'input_only' }), short);
    expect(shut.stats.deliveries('1,0,2')).toEqual([[39, 't:x@0', 64]]);
    expect(shut.stats.arrivals('2,0,2')).toEqual([]);
    // a Shutter in front of N: the chest gets every stack, but it is not nearer than N, which the pipes cannot reach
    const n = sinkNode('1,0,2', 1, 2);
    const blind = both(tail({ host: '1,0,1', side: 3, kind: 'shutter', export: false, allowInput: false, shutter: 'input_only' }), short);
    expect(blind.stats.arrivals('2,0,2')).toEqual(arrivals([39, 59, 79, 99, 119]));
    expect(blind.findings.find((f) => f.code === 'feed_starved')?.text).toBe(`${n.label} never gets Ex: nothing on the line hands it over`);
    // an Item Filter cover never stops a pipe, whatever it lists
    const filtered = both(tail({ host: '2,0,1', side: 3, kind: 'filter', export: true, allowInput: true, filter: { mode: 'whitelist', keys: ['t:y@0'] } }), short);
    expect(filtered.stats.arrivals('2,0,2')).toEqual(arrivals([59, 79, 99, 119]));
  });

  it('keeps out what an Input Filter refuses', () => {
    // N's recipe map (the mixer's) has no recipe that takes Ex
    const plain = sinkNode('1,0,2', 1, 2);
    const n: BasicNode = { ...plain, settings: { ...plain.settings, inputFilter: true } };
    const r = both(tail(undefined, n), short);
    expect(r.stats.deliveries('1,0,2')).toEqual([]);
    expect(r.stats.arrivals('2,0,2')).toEqual(arrivals([39, 59, 79, 99, 119]));
    expect(r.findings.map((f) => [f.code, f.machine, f.text])).toEqual([
      ['feed_starved', n.label, `${n.label} never gets Ex: its Input Filter keeps Ex out (no recipe of its machine uses it)`],
      ['feed_leak', 'Chest (output) at 2 0 2', `Ex meant for ${n.label} reached Chest (output) at 2 0 2`],
    ]);
    // N full of another item takes no Ex either, but the chest that gets it is farther from P1 than N: nothing nearer took it
    const busy = both(tail(), { ...short, initial: { '1,0,2': [[0, 't:c@0', 64]] } });
    expect(busy.findings.map((f) => f.text)).toEqual([
      `${plain.label} never gets Ex: nothing on the line hands it over`, `Ex meant for ${plain.label} reached Chest (output) at 2 0 2`,
    ]);
  });

  it('takes a stack only into an empty slot, from one side', () => {
    const env = envOf(tail(undefined, undefined, 2));
    const x = env.keys.id('t:x@0');
    // P1's east side meets P2's west side (4)
    const p2 = pipeAt(env, '0,0,1', 5);
    expect(p2.accept(x, 10, 4, null)).toBe(10);
    expect([p2.canInsert(0, x, 4), p2.canInsert(1, x, 4)]).toEqual([false, true]);
    // again from the west: into its other slot, never onto the first stack
    expect(p2.accept(x, 10, 4, null)).toBe(10);
    expect([p2.stack(0), p2.stack(1)]).toEqual([{ key: x, count: 10 }, { key: x, count: 10 }]);
    // it holds items from the west, so the east side takes none
    const again = envOf(tail(undefined, undefined, 2));
    const p2b = pipeAt(again, '2,0,1', 4);
    expect(p2b.accept(x, 10, 4, null)).toBe(10);
    expect(p2b.accept(x, 10, 5, null)).toBe(0);
    // a pipe of one slot takes nothing more while it holds a stack
    const one = pipeAt(envOf(tail()), '0,0,1', 5);
    expect(one.accept(x, 10, 4, null)).toBe(10);
    expect(one.accept(x, 10, 4, null)).toBe(0);
    // nor through a side it is not connected on (P2 has no link down)
    expect(pipeAt(envOf(tail()), '1,1,1', 0).accept(x, 10, 1, null)).toBe(0);
  });

  it('never hands a stack back out of the side it came in by', () => {
    // M at 0,0,0 pushes its Ex south into the pipe P 0,0,1, which also touches a chest east of it; M (Input Filter unset)
    // would take Ex back into its input slot through that side, but P sends it east, to the chest
    const r = both(pipeModel([oneSlotNode('0,0,0'), outputChestNode('1,0,1')], [{ id: '0,0,1', links: 0b100100 }], [hvExport('0,0,0', 3)]),
      { ticks: 60, restartAt: 60, initial: { '0,0,0': [[1, 't:x@0', 64]] } });
    // the conveyor moves the 64 at tick 20; P holds a fresh stack at 29 and sends it at 39
    expect(r.stats.arrivals('1,0,1')).toEqual(arrivals([39]));
    expect(r.stats.final('0,0,0')).toEqual([null, null]);
  });

  it('counts a send against every pipe it passes and lets a full pipe rest until its 20-tick window starts again', () => {
    // two input chests, of Ex north of P1 and of Why north of P3, each imported by an HV conveyor; a two-slot machine N south of
    // P2 takes both; P3 touches nothing else, so its Why can only go through P2
    const model = pipeModel([inputChestNode('0,0,0', ['t:x@0']), inputChestNode('2,0,0', ['t:y@0']), sinkNode('1,0,2', 2, 2)],
      [{ id: '0,0,1', links: 0b100100 }, { id: '1,0,1', links: 0b111000 }, { id: '2,0,1', links: 0b010100 }],
      [{ host: '0,0,1', side: 2, kind: 'conveyor', export: false, allowInput: false, op: { tickRate: 20, stacks: 1, items: 64 } },
        { host: '2,0,1', side: 2, kind: 'conveyor', export: false, allowInput: false, op: { tickRate: 20, stacks: 1, items: 64 } }]);
    const r = both(model, short);
    // at 39 P1 sends Ex through P2, which counts it and is then full for 20 ticks: P3, which checks later in that tick, waits
    // until 59 to send its Why through P2
    expect(r.stats.deliveries('1,0,2')).toEqual([[39, 't:x@0', 64], [59, 't:y@0', 64]]);
  });

  it('starts its 20-tick window at the first send it counts', () => {
    // as above, without the chests: Ex pushed into P1 at 35 is sent through P2 at 49 (aTick 50), so P2 rests until 69; Why
    // pushed into P3 at 45 waits one check, and at 59 still finds P2 full (a window from aTick 40 would have let it go)
    const model = pipeModel([sinkNode('1,0,2', 2, 2)], [{ id: '0,0,1', links: 0b100100 }, { id: '1,0,1', links: 0b111000 }, { id: '2,0,1', links: 0b010100 }],
      [], { planned: { n: { 't:x@0': 1, 't:y@0': 1 } } });
    const r = both(model, { ticks: 120, restartAt: 120, extra: (env) => [pushIn(env, '0,0,0', 3, 't:x@0', 35), pushIn(env, '2,0,0', 3, 't:y@0', 45)] });
    expect(r.stats.deliveries('1,0,2')).toEqual([[49, 't:x@0', 64], [69, 't:y@0', 64]]);
  });

  it('feeds a multiblock\'s input bus and takes from its output bus', () => {
    // the EBF's input bus 0,0,0 (Limiting on) north of P0 0,0,1 and its output bus 2,0,0 north of P2 2,0,1; Alpha comes from a
    // chest south of P0 and Beta from one south of P1 1,0,1 (HV import conveyors); K 2,0,2, south of P2, takes Ex
    const ebf = ebfNode({ inBuses: [busNode('0,0,0', { limited: true })] });
    const k = oneSlotNode('2,0,2', { outputSide: 2, settings: { multiStack: null, inputFilter: true, inputFromOutputSide: null, autoOutput: null },
      recipes: [simRecipe('k', 20, [['t:x@0', 1]], [['t:y@0', 1]])] });
    const imports: GtCover[] = ['0,0,1', '1,0,1'].map((host) => ({ host, side: 3, kind: 'conveyor', export: false, allowInput: false, op: { tickRate: 20, stacks: 1, items: 64 } }));
    const model = pipeModel([ebf, inputChestNode('0,0,2', ['t:a@0']), inputChestNode('1,0,2', ['t:b@0']), k],
      [{ id: '0,0,1', links: 0b101100 }, { id: '1,0,1', links: 0b111000 }, { id: '2,0,1', links: 0b011100 }], imports);
    const r = both(model, { ticks: 400, restartAt: 400 });
    // Alpha at 39 (P0 then rests until 59, so P1's Beta waits); at 59 P0's second Alpha finds the bus's slot of Alpha full
    // (Limiting) and no other taker, and P1's Beta goes in; the bus sorts itself at 60 and the run starts; after each run the
    // pipes top the bus up by the one Alpha and one Beta it used, a stack going in in part, each pipe resting while the other's
    // send counts against it
    expect(r.stats.deliveries('0,0,0')).toEqual([[39, 't:a@0', 64], [59, 't:b@0', 64],
      ...[79, 169, 269, 369].flatMap((t) => [[t, 't:a@0', 1], [t + 20, 't:b@0', 1]])]);
    expect(r.stats.starts('1,0,0')).toEqual([60, 160, 260, 360]);
    // each run's Ex goes into the output bus at its end; the bus pushes it into P2 at its next aTick % 8 (167, …), and P2 sends
    // it to K one check later
    expect(r.stats.deliveries('2,0,2')).toEqual([179, 279, 379].map((t) => [t, 't:x@0', 1]));
    expect(r.findings).toEqual([]);
  });

  it('says why an item does not arrive or leave', () => {
    // M 0,0,0 pushes into P 0,0,1 (an LV conveyor on its side 3); P – Q 1,0,1; F 1,0,2 south of Q keeps Ex out with its Input
    // Filter; L 3,0,0 touches no pipe
    const plain = sinkNode('1,0,2', 1, 2);
    const f: BasicNode = { ...plain, settings: { ...plain.settings, inputFilter: true } };
    const lv = (over: Partial<GtCover> = {}): GtCover => ({ host: '0,0,0', side: 3, kind: 'conveyor', export: true, allowInput: true, op: { tickRate: 100, stacks: 1, items: 16 }, ...over });
    const line = (covers: GtCover[], q = 0b011000, more: FeedNode[] = []) => pipeModel([oneSlotNode('0,0,0'), f, oneSlotNode('3,0,0'), ...more],
      [{ id: '0,0,1', links: 0b100100 }, { id: '1,0,1', links: q }], covers);
    const whyOf = (model: FeedModel, initial?: ScenarioOptions['initial']) => gtPipeModel(model.networks[0] as GtPipeNet, envOf(model, initial)).explain;
    const why = whyOf(line([lv()]));
    expect([why('in', '3,0,0', 't:a@0'), why('out', '3,0,0', 't:x@0')]).toEqual(['no pipe touches it', 'no pipe touches it']);
    expect(why('in', '1,0,2', 't:x@0')).toBe('its Input Filter keeps Ex out (no recipe of its machine uses it)');
    expect(why('in', '0,0,0', 't:a@0')).toBe('nothing pushes Alpha into its pipe');
    expect(why('out', '0,0,0', 't:x@0')).toBe('nothing on its pipe takes Ex');
    expect(whyOf(line([]))('out', '0,0,0', 't:x@0')).toBe('no conveyor cover pushes it out of Basic Macerator at 0 0 0');
    const filter = (mode: 'whitelist' | 'blacklist', keys: string[]): GtCover => lv({ kind: 'filter', export: true, allowInput: true, op: undefined, filter: { mode, keys } });
    expect(whyOf(line([filter('whitelist', ['t:y@0'])]))('out', '0,0,0', 't:x@0')).toBe('its Item Filter cover lists Why');
    expect(whyOf(line([filter('blacklist', ['t:x@0'])]))('out', '0,0,0', 't:x@0')).toBe('its Item Filter cover blacklists Ex');
    // an input bus takes only through its front, an output bus never: east of Q, neither takes Ex unless an input bus faces Q
    const east = (over: Partial<MultiNode>) => line([lv()], 0b111000, [ebfNode({ id: '2,0,2', inBuses: [], outBuses: [], ...over })]);
    expect(whyOf(east({ inBuses: [busNode('2,0,1', { front: 2 })] }))('out', '0,0,0', 't:x@0')).toBe('nothing on its pipe takes Ex');
    expect(whyOf(east({ outBuses: [outBusNode('2,0,1', { front: 4 })] }))('out', '0,0,0', 't:x@0')).toBe('nothing on its pipe takes Ex');
    expect(whyOf(east({ inBuses: [busNode('2,0,1', { front: 4 })] }))('out', '0,0,0', 't:x@0')).toBe(null);
    // nor does a machine through its front
    const machine = (front: number) => line([lv()], 0b111000, [oneSlotNode('2,0,1', { front })]);
    expect([whyOf(machine(4))('out', '0,0,0', 't:x@0'), whyOf(machine(5))('out', '0,0,0', 't:x@0')]).toEqual(['nothing on its pipe takes Ex', null]);
    // a node another network touches is that network's to explain: a second GT pipe network, or another kind
    const two = line([lv()]);
    two.networks.push({ kind: 'gtpipe', pipes: [{ id: '3,0,1', label: 'Item Pipe at 3 0 1', capacity: 1, links: 0b100, sides: [{ side: 2, target: { node: '3,0,0', side: 3 } }] }] });
    const mixed = line([lv()]);
    mixed.networks.push({ kind: 'routed', pipes: [], hops: {} });
    expect([whyOf(two)('in', '3,0,0', 't:a@0'), whyOf(mixed)('in', '3,0,0', 't:a@0')]).toEqual([null, null]);
    // Q also touches two output chests, north and east of it: full of Alpha, they take no Ex
    const full = Array.from({ length: 27 }, (_, i) => [i, 't:a@0', 64] as [number, string, number]);
    const chests = line([lv()], 0b111100, [outputChestNode('1,0,0'), outputChestNode('2,0,1')]);
    expect(whyOf(chests, { '1,0,0': full, '2,0,1': full })('out', '0,0,0', 't:x@0'))
      .toBe('its pipe\'s only takers for Ex, Chest (output) at 1 0 0 and Chest (output) at 2 0 1, are full');
    expect(whyOf(chests, { '1,0,0': full })('out', '0,0,0', 't:x@0')).toBe(null);
  });

  it('waits one check again after its chunk loads again', () => {
    // a restart at 35 keeps P1's stack and the side it came from, but not the side of its last check: checks now fall on 44, 54, …
    const r = both(tail(), { ticks: 120, restartAt: 35 }, 'restart');
    expect(r.stats.deliveries('1,0,2')).toEqual([[54, 't:x@0', 64]]);
    // the conveyor acts again from 55 (20 ticks after the load), so the chest gets stacks at 74, 94, 114
    expect(r.stats.arrivals('2,0,2')).toEqual(arrivals([74, 94, 114]));
  });

  it('finds today\'s machine-to-machine tail leaking', async () => {
    const { pack, plan } = chain2();
    const model = readLine({ pack, plan, layout: await layFeed(pack, plan, 'direct') });
    const chest = 'Chest (output) at 6 64 3';
    // the tail pipe 6,0,2 imports 16 Alpha every 100 ticks from 100 through its north side's LV conveyor; each waits one
    // check in the pipe, and the output chest on the pipe's own south side (Item Filter cover) is its nearest taker
    const early = both(model, { ticks: 2_000, restartAt: 2_000 });
    expect(early.stats.arrivals('6,0,3')).toEqual(Array.from({ length: 19 }, (_, i) => [119 + 100 * i, 't:a@0', 16]));
    const macerators = ['Basic Macerator at 3 64 1', 'Basic Macerator at 3 64 3'];
    expect(early.findings.map((f) => [f.code, f.machine, f.key, f.count, f.text])).toEqual([
      ...macerators.map((m) => ['feed_starved', m, 't:a@0', undefined, `${m} never gets Alpha: its pipe hands Alpha to ${chest} first, which is nearer`]),
      ['feed_starved', 'Advanced Assembler at 5 64 1', 't:x@0', undefined, 'Advanced Assembler at 5 64 1 never gets Ex: nothing pushes Ex into its pipe'],
      ['feed_leak', chest, 't:a@0', 304, `Alpha meant for ${macerators[0]} reached ${chest}`],
    ]);

    // over the default 20 minutes the chest fills with 27 stacks of Alpha at its 108th arrival; then Alpha reaches the
    // macerators (3 hops) and Ex the assembler, whose Why finds no room in the full chest
    const long = both(model, { ticks: DEFAULT_TICKS, restartAt: DEFAULT_TICKS });
    const filled = long.stats.arrivals('6,0,3');
    expect(filled).toEqual(Array.from({ length: 108 }, (_, i) => [119 + 100 * i, 't:a@0', 16]));
    expect(filled.at(-1)![0]).toBe(10_819);
    expect(long.stats.final('6,0,3')).toEqual(Array.from({ length: 27 }, () => ['t:a@0', 64]));
    expect(long.stats.final('5,0,1').at(-1)).toEqual(['t:y@0', 64]);
    expect(long.findings.filter((f) => f.code === 'feed_no_route' && f.key === 't:y@0').map((f) => [f.machine, f.text])).toEqual([[
      'Advanced Assembler at 5 64 1',
      `Nothing takes Why out of Advanced Assembler at 5 64 1: its pipe's only taker for Why, ${chest}, is full`,
    ]]);
  });
});
