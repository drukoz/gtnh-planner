// tests/unit/layout/feeding/ae2.test.ts
import { describe, expect, it } from 'vitest';
import type { InterfaceSpec, PatternSpec, ScenarioName } from '../../../../src/server/layout/feeding/contract.ts';
import type { Ae2ExportBus, BasicNode, FeedModel, GtCover } from '../../../../src/server/layout/feeding/model.ts';
import { runScenario, type ScenarioOptions, type ScenarioRun } from '../../../../src/server/layout/feeding/sim/run.ts';
import { ae2Model, benchNode, feeder, handModel, hvExport, oneSlotNode, simRecipe } from '../../../helpers/feeding-fixtures.ts';

// M: a one-slot machine at 0,0,0 (1 t:a@0 → 1 t:x@0, 20 ticks) with an HV export conveyor on side 3; its interface at 0,0,1
// (`spec` and `node` vary it: the other patterns and settings of an interface, another machine there, no cover)
const line = (blocking: boolean, more: { spec?: Partial<InterfaceSpec>; node?: BasicNode; covers?: GtCover[] } = {}) => ae2Model(
  [more.node ?? oneSlotNode('0,0,0')], [{ id: '0,0,1', targets: [{ node: '0,0,0', side: 3 }],
    spec: { patterns: [{ inputs: [{ key: 't:a@0', amount: 1 }], outputs: [{ key: 't:x@0', amount: 1 }] }], blocking, ...more.spec } }],
  { covers: more.covers ?? [hvExport('0,0,0', 3)] });

/** `model` run scheduled and tick by tick in `scenario`; the two runs must be deep-equal (Task 4 rule 3). Returns the scheduled one. */
function same(model: FeedModel, opts: Omit<ScenarioOptions, 'exhaustive'>, scenario: ScenarioName = 'steady'): ScenarioRun {
  const [scheduled, exhaustive] = [false, true].map((x) => runScenario(model, scenario, { ...opts, exhaustive: x }));
  expect(scheduled).toEqual(exhaustive);
  return scheduled!;
}

/** A processing pattern of `[key, amount]` inputs and outputs. */
const pattern = (inputs: Array<[string, number]>, outputs: Array<[string, number]>): PatternSpec => ({
  inputs: inputs.map(([key, amount]) => ({ key, amount })), outputs: outputs.map(([key, amount]) => ({ key, amount })),
});
const brief = (r: ScenarioRun) => r.findings.map((f) => [f.code, f.key, f.tick, f.text]);

const IRON = 'fluid:molten.iron';
/** A machine's settings with its Input Filter on and the rest unset. */
const FILTER_ON = { multiStack: null, inputFilter: true, inputFromOutputSide: null, autoOutput: null };
const MOLD = 'gregtech:gt.metaitem.01@32301';
const PACKET = 'ae2fc:fluid_packet@0';

// the Resistor bench (research §1.3.9): its grid's exact pattern, what ME stocks for it, and the plan asking for Resistors
const RESISTOR = pattern([['t:resin@0', 2], ['t:fine@0', 2], ['t:wire@0', 2], ['t:carbon@0', 1]], [['t:resistor@0', 1]]);
const BENCH_SUPPLY = ['t:carbon@0', 't:fine@0', 't:resin@0', 't:wire@0'];
const RESISTORS_OUT = [{ from: 'w', to: 'out', key: 't:resistor@0', perSecond: 1 }];
/** `benchNode()` at 0,0,0 under its interface at 0,0,1, its back (side 3). */
const benchLine = (spec: InterfaceSpec, more: Partial<FeedModel> = {}) => ae2Model([benchNode()], [{ id: '0,0,1', targets: [{ node: '0,0,0', side: 3 }], spec }],
  { supply: BENCH_SUPPLY, itemFlows: RESISTORS_OUT, ...more });

describe('AE2', () => {
  it('pushes one set at a time with blocking mode on', () => {
    const runs = [false, true].map((exhaustive) => runScenario(line(true), 'steady', { ticks: 70, restartAt: 70, exhaustive }));
    expect(runs[0]).toEqual(runs[1]);
    // the CPU pushes at 0 (M sees it at 1 and starts); at 4 into the empty input slot; then only when M takes that set, at 21, 41, 61
    expect(runs[0]!.stats.ae2Pushes('0,0,1')).toEqual([0, 4, 21, 41, 61]);
    expect(runs[0]!.stats.starts('0,0,0')).toEqual([1, 21, 41, 61]);
    // M's conveyor pushes each Ex into the interface, and it enters ME (at 40 and 60)
    expect(runs[0]!.out).toEqual({ 't:x@0': 2 });
    expect(runs[0]!.findings).toEqual([]);
    // with co-processors to spare, a blocking interface still takes one set: the CPU gives the turn on and pushes again as soon as M takes it
    expect(same(line(true), { ticks: 70, restartAt: 70, ae2Coprocessors: 3 }).stats.ae2Pushes('0,0,1')).toEqual([0, 1, 21, 41, 61]);
  });

  it('pushes as fast as the CPU allows without blocking mode', () => {
    // E8: c + 1 − (the pushes of its last three updates) a tick: without co-processors one push every 4 ticks (over 200 ticks the
    // job plans 20 crafts, twice the run's 10 Ex)
    const before = (run: ScenarioRun, t: number) => run.stats.ae2Pushes('0,0,1').filter((x) => x < t);
    expect(before(same(line(false), { ticks: 200, restartAt: 200 }), 20)).toEqual([0, 4, 8, 12, 16]);
    expect(before(same(line(false), { ticks: 200, restartAt: 200, ae2Coprocessors: 3 }), 8)).toEqual([0, 0, 0, 0, 4, 4, 4, 4]);
    // the job's crafts are all it pushes: 2 over 20 ticks
    expect(same(line(false), { ticks: 20, restartAt: 20 }).stats.ae2Pushes('0,0,1')).toEqual([0, 4]);
  });

  it('pushes the same pattern again with smart blocking, but only into an empty machine at first', () => {
    // smart blocking skips the test when the pattern is the one it pushed last (research §2.3)
    const before20 = (run: ScenarioRun) => run.stats.ae2Pushes('0,0,1').filter((x) => x < 20);
    expect(before20(same(line(true, { spec: { smartBlocking: true } }), { ticks: 200, restartAt: 200 }))).toEqual([0, 4, 8, 12, 16]);
    // a two-slot M holding a Beta it never uses: without blocking the first push goes in beside it; with smart blocking it never does
    const two = oneSlotNode('0,0,0', { inSlots: 2 });
    const initial = { '0,0,0': [[0, 't:b@0', 1]] as Array<[number, string, number]> };
    expect(before20(same(line(false, { node: two }), { ticks: 200, restartAt: 200, initial }))).toEqual([0, 4, 8, 12, 16]);
    expect(same(line(true, { node: two, spec: { smartBlocking: true } }), { ticks: 200, restartAt: 200, initial }).stats.ae2Pushes('0,0,1')).toEqual([]);
  });

  it('jams on a Fluid Packet', () => {
    // research §2.3, §4.2: a one-slot solidifier holding its mold; its pattern's 144 L become one Fluid Packet item, which no slot takes,
    // so the CPU tries again every tick and never pushes
    const solidifier = oneSlotNode('0,0,0', { name: 'Fluid Solidifier', recipes: [simRecipe('one', 20, [[IRON, 144]], [['t:x@0', 1]], { held: [MOLD] })] });
    const mold = (ticks: number) => same(line(true, { node: solidifier, spec: { patterns: [pattern([[IRON, 144]], [['t:x@0', 1]])] } }),
      { ticks, restartAt: ticks, ae2FluidStock: true });
    const jam = mold(2_000);
    expect(jam.stats.ae2Pushes('0,0,1')).toEqual([]);
    expect(brief(jam)).toEqual([['feed_fluid_packet', IRON, 0, 'ME Interface at 0 0 1 cannot push Molten Iron into Fluid Solidifier at 0 0 0: as a Fluid Packet item '
      + 'it needs a free input slot, and Fluid Solidifier at 0 0 0 has none']]);
    // it counts once the CPU has kept trying for STALL_TICKS
    expect(mold(1_200).findings).toEqual([]);
    expect(mold(1_201).findings.map((f) => f.code)).toEqual(['feed_fluid_packet']);

    // a two-slot machine: the first push puts the packet into its second slot for good; the next push's packet has no slot (Multi Stack
    // Input Off keeps packets to the slot that holds one) and waits in the send list, which keeps the interface busy for the rest of the run
    const twoSlot = oneSlotNode('0,0,0', { inSlots: 2, recipes: [simRecipe('one', 20, [['t:a@0', 1], [IRON, 144]], [['t:x@0', 1]])] });
    const withAlpha = { patterns: [pattern([['t:a@0', 1], [IRON, 144]], [['t:x@0', 1]])] };
    const slot = same(line(false, { node: twoSlot, spec: withAlpha }), { ticks: 2_000, restartAt: 2_000, ae2FluidStock: true });
    expect(slot.stats.ae2Pushes('0,0,1')).toEqual([0, 4]);
    expect(brief(slot)).toEqual([['feed_fluid_packet', IRON, 0,
      'ME Interface at 0 0 1 pushed a Fluid Packet (Molten Iron) into Basic Macerator at 0 0 0: it stays in an input slot for good']]);
    expect(slot.stats.final('0,0,0')).toEqual([null, [PACKET, 1], null]);
    // with its Input Filter on, the machine's map does not take the packet: the first push leaves it in the send list for good
    const filtered = same(line(false, { node: oneSlotNode('0,0,0', { ...twoSlot, settings: FILTER_ON }), spec: withAlpha }),
      { ticks: 2_000, restartAt: 2_000, ae2FluidStock: true });
    expect(filtered.stats.ae2Pushes('0,0,1')).toEqual([0]);
    expect(brief(filtered)).toEqual([['feed_fluid_packet', IRON, 0,
      'ME Interface at 0 0 1 cannot push the Fluid Packet (Molten Iron) into Basic Macerator at 0 0 0, so it is stuck with it']]);
    // a Dual Interface puts the fluid into the machine's tank, which takes it: no packet
    const dual = same(line(true, { node: solidifier, spec: { patterns: [pattern([[IRON, 144]], [['t:x@0', 1]])], dual: true } }),
      { ticks: 70, restartAt: 70, ae2FluidStock: true });
    expect(dual.stats.ae2Pushes('0,0,1')[0]).toBe(0);
    expect([dual.stats.final('0,0,0'), dual.findings]).toEqual([[[MOLD, 1], null], []]);
  });

  it('never pushes into a bench with blocking mode on', () => {
    // research §1.3.6: its grid counts as items, so a blocking interface never sees it empty
    const planned = { w: { 't:carbon@0': 0.5, 't:fine@0': 1, 't:resin@0': 1, 't:wire@0': 1 } };
    const blocked = same(benchLine({ patterns: [RESISTOR], blocking: true }, { planned }), { ticks: 2_000, restartAt: 2_000 });
    expect(blocked.stats.ae2Pushes('0,0,1')).toEqual([]);
    const r9 = 'ME Interface at 0 0 1 has blocking mode on and Auto Workbench (MV) at 0 0 0\'s crafting grid counts as items: it never pushes into it';
    expect(brief(blocked)).toEqual([['t:carbon@0', 'Carbon Dust'], ['t:fine@0', 'Fine Wire'], ['t:resin@0', 'Resin'], ['t:wire@0', 'Wire']]
      .map(([key, name]) => ['feed_starved', key, 0, `Auto Workbench (MV) at 0 0 0 never gets ${name}: ${r9}`]));

    // blocking off with a Locking Card, the pattern listing another Fine Wire than the grid (research C11): one push; at 34 the bench throws
    // the 2 strays out into the interface (they enter ME, but the lock waits for the Resistor) and nothing more is pushed
    const other = pattern([['t:resin@0', 2], ['t:fine2@0', 2], ['t:wire@0', 2], ['t:carbon@0', 1]], [['t:resistor@0', 1]]);
    const supply = [...BENCH_SUPPLY, 't:fine2@0'];
    const locked = same(benchLine({ patterns: [other], blocking: false, lock: 'until_result' }, { supply }), { ticks: 2_000, restartAt: 2_000 });
    expect(locked.stats.ae2Pushes('0,0,1')).toEqual([0]);
    expect(locked.findings.map((f) => [f.code, f.key, f.tick, f.count])).toEqual([['feed_overfill', 't:fine2@0', 0, undefined], ['feed_bench_eject', undefined, 34, 2]]);
    expect([locked.out, locked.stats.unlocked('0,0,1')]).toEqual([{ 't:fine2@0': 2 }, []]);
    // the same without the lock: a set every 4 ticks for the whole job, so the bench throws out more and, flooded, its clean-up
    // destroys stacks (research §3.4: why the Locking Card is required)
    const flooded = same(benchLine({ patterns: [other], blocking: false }, { supply }), { ticks: 2_000, restartAt: 2_000 });
    expect(flooded.stats.ae2Pushes('0,0,1').slice(0, 9)).toEqual([0, 4, 8, 12, 16, 20, 24, 28, 32]);
    expect(flooded.stats.ae2Pushes('0,0,1').length).toBe(200);
    expect(flooded.findings.find((f) => f.code === 'feed_bench_eject')?.count).toBeGreaterThan(2);
    expect(flooded.findings.map((f) => f.code)).toContain('feed_bench_delete');
  });

  it('never pushes into a machine holding what blocking mode does not ignore', () => {
    // a held Gamma (not on AE2's ignore list) in M's first input slot: a blocking interface never sees M empty
    const holder = oneSlotNode('0,0,0', { inSlots: 2, recipes: [simRecipe('one', 20, [['t:a@0', 1]], [['t:x@0', 1]], { held: ['t:c@0'] })] });
    const run = same({ ...line(true, { node: holder }), planned: { one: { 't:a@0': 1 } } }, { ticks: 2_000, restartAt: 2_000 });
    expect(run.stats.ae2Pushes('0,0,1')).toEqual([]);
    expect(brief(run)).toEqual([['feed_starved', 't:a@0', 0, 'Basic Macerator at 0 0 0 never gets Alpha: ME Interface at 0 0 1 has blocking mode on and '
      + 'Basic Macerator at 0 0 0 holds Gamma, which blocking mode does not ignore: it never pushes into it']]);
    // a mold is on the list (E12): the same with a mold pushes as usual
    const molded = oneSlotNode('0,0,0', { inSlots: 2, recipes: [simRecipe('one', 20, [['t:a@0', 1]], [['t:x@0', 1]], { held: [MOLD] })] });
    expect(same(line(true, { node: molded }), { ticks: 70, restartAt: 70 }).stats.ae2Pushes('0,0,1')).toEqual([0, 4, 21, 41, 61]);
  });

  it('unlocks every interface waiting on the same result', () => {
    // E14: A (MV) at 0,0,0 and B (LV) at 2,0,0, each under an interface at its back with the grid's exact pattern and a Locking Card
    const spec: InterfaceSpec = { patterns: [RESISTOR], blocking: false, lock: 'until_result' };
    const model = ae2Model([benchNode(), benchNode({ id: '2,0,0', tier: 1 })], [
      { id: '0,0,1', targets: [{ node: '0,0,0', side: 3 }], spec }, { id: '2,0,1', targets: [{ node: '2,0,0', side: 3 }], spec },
    ], { supply: BENCH_SUPPLY, itemFlows: RESISTORS_OUT });
    const run = same(model, { ticks: 300, restartAt: 300 });
    // one push every 4 ticks: A's interface at 0, B's at 4; then both are locked
    expect([run.stats.ae2Pushes('0,0,1')[0], run.stats.ae2Pushes('2,0,1')[0]]).toEqual([0, 4]);
    // A crafts at 34 and its Resistor enters ME through its interface: that counts down both lists
    expect(run.stats.benchCrafts('0,0,0')[0]).toBe(34);
    expect([run.stats.unlocked('0,0,1')[0], run.stats.unlocked('2,0,1')[0]]).toEqual([34, 34]);
    // A's interface is first again at 34 (and at 38, A's second craft having unlocked it at 35); B gets its second set at 42, before its first craft at 82
    expect(run.stats.ae2Pushes('0,0,1').slice(0, 3)).toEqual([0, 34, 38]);
    expect(run.stats.ae2Pushes('2,0,1').slice(0, 2)).toEqual([4, 42]);
    expect(run.stats.benchCrafts('2,0,0')[0]).toBe(82);
    // B then holds two sets (and more as A's later Resistors unlock it again), and nothing is thrown out: the pattern matches its grid
    expect(run.findings).toEqual([]);
  });

  it('stays locked until the container comes back too', () => {
    // E14: the Task 6 container bench under an interface whose pattern returns the Dry Cell beside the result
    const cell = benchNode({ grid: ['t:wet@0', 't:a@0', null, null, null, null, null, null, null], result: { key: 't:x@0', amount: 1 }, containers: { 't:wet@0': 't:dry@0' } });
    const spec = (outputs: Array<[string, number]>): InterfaceSpec => ({ patterns: [pattern([['t:wet@0', 1], ['t:a@0', 1]], outputs)], blocking: false, lock: 'until_result' });
    const model = (outputs: Array<[string, number]>, out = 't:x@0') => ae2Model([cell], [{ id: '0,0,1', targets: [{ node: '0,0,0', side: 3 }], spec: spec(outputs) }],
      { supply: ['t:a@0', 't:wet@0'], itemFlows: [{ from: 'w', to: 'out', key: out, perSecond: 1 }] });
    const run = same(model([['t:x@0', 1], ['t:dry@0', 1]]), { ticks: 200, restartAt: 200 });
    // the bench crafts at 34 and pushes the Dry Cell into the interface at 34 and the result at 35 (slot 9 first): only then is the list down to 0
    expect(run.stats.benchCrafts('0,0,0')[0]).toBe(34);
    expect(run.stats.unlocked('0,0,1')[0]).toBe(35);
    expect(run.stats.ae2Pushes('0,0,1').slice(0, 2)).toEqual([0, 35]);
    // a pattern that lists only the Dry Cell (for a job that asks for Dry Cells) clears at 34; one that lists a fluid the line pipes away never clears
    expect(same(model([['t:dry@0', 1]], 't:dry@0'), { ticks: 200, restartAt: 200 }).stats.unlocked('0,0,1')[0]).toBe(34);
    const piped = same(model([['t:x@0', 1], [IRON, 144]]), { ticks: 200, restartAt: 200 });
    expect([piped.stats.ae2Pushes('0,0,1'), piped.stats.unlocked('0,0,1')]).toEqual([[0], []]);
  });

  it('feeds a step without a pattern through an ME Export Bus', () => {
    // E16, research §3.5: the machine has no interface; the bus at 0,1,0 above it exports 1 Alpha an operation
    const bus: Ae2ExportBus = { id: '0,1,0', label: 'ME Export Bus at 0 65 0', keys: ['t:a@0'], amount: 1, target: { node: '0,0,0', side: 1 } };
    const run = same(ae2Model([oneSlotNode('0,0,0')], [], { exportBuses: [bus], planned: { one: { 't:a@0': 1 } } }), { ticks: 400, restartAt: 400 });
    // its first operation is 32 ticks after the line starts; each that moved something brings the next 2 ticks sooner, down to 5
    expect(run.stats.deliveries('0,0,0').slice(0, 5)).toEqual([32, 62, 90, 116, 140].map((t) => [t, 't:a@0', 1]));
    expect(run.stats.deliveries('0,0,0').slice(13, 17).map(([t]) => t)).toEqual([266, 271, 276, 281]);
    expect(run.stats.starts('0,0,0').slice(0, 2)).toEqual([33, 63]);
    expect(run.findings).toEqual([]);
    // a bus with no target or no keys does nothing
    for (const idle of [{ ...bus, target: null }, { ...bus, keys: [] }]) {
      expect(same(ae2Model([oneSlotNode('0,0,0')], [], { exportBuses: [idle] }), { ticks: 400, restartAt: 400 }).stats.deliveries('0,0,0')).toEqual([]);
    }

    // the job counts on that step's Ex from stock: N at 2,0,0 (1 Ex → 1 Why) has an interface with that pattern, and M pushes its Ex into
    // an interface without patterns; once the first Ex is in ME (M's conveyor at 60) N's interface is pushed
    const chain = (buses: Ae2ExportBus[]) => ae2Model([oneSlotNode('0,0,0'), oneSlotNode('2,0,0', { recipes: [simRecipe('two', 20, [['t:x@0', 1]], [['t:y@0', 1]])] })], [
      { id: '0,0,1', targets: [{ node: '0,0,0', side: 3 }], spec: { patterns: [], blocking: true } },
      { id: '2,0,1', targets: [{ node: '2,0,0', side: 3 }], spec: { patterns: [pattern([['t:x@0', 1]], [['t:y@0', 1]])], blocking: true } },
    ], { covers: [hvExport('0,0,0', 3)], exportBuses: buses, itemFlows: [{ from: 'two', to: 'out', key: 't:y@0', perSecond: 1 }], planned: { two: { 't:x@0': 1 } } });
    const fed = same(chain([bus]), { ticks: 400, restartAt: 400 });
    expect(fed.stats.ae2Pushes('2,0,1')[0]).toBe(60);
    expect(fed.findings.filter((f) => f.code === 'feed_starved')).toEqual([]);
    // without the bus no step that ME feeds makes Ex, so the job cannot be planned
    const unfed = same(chain([]), { ticks: 400, restartAt: 400 });
    expect(unfed.stats.ae2Pushes('2,0,1')).toEqual([]);
    expect(brief(unfed)).toEqual([['feed_starved', 't:x@0', 0, 'Basic Macerator at 2 0 0 never gets Ex: the AE2 job cannot be planned: nothing makes Ex and ME holds none']]);
  });

  it('takes a steam machine\'s outputs by hand', () => {
    // E17: a steam machine takes no cover and never pushes its outputs out; in AE2 mode the player takes them, so each run's Ex
    // enters ME when the run ends (the job counts it)
    const run = same(line(true, { node: oneSlotNode('0,0,0', { steam: true }), covers: [] }), { ticks: 70, restartAt: 70 });
    expect(run.stats.ae2Pushes('0,0,1')).toEqual([0, 4, 21, 41, 61]);
    // the runs that ended at 21, 41 and 61; its output slot stays empty (its input slot holds the set pushed at 61)
    expect(run.out).toEqual({ 't:x@0': 3 });
    expect(run.stats.final('0,0,0')).toEqual([['t:a@0', 1], null]);
    expect(run.unknowns.map((u) => [u.code, u.text, u.pos, u.stepId])).toEqual([
      ['stack_sizes', expect.any(String), undefined, undefined],
      ['steam_by_hand', 'Basic Macerator at 0 0 0 takes no cover and never pushes its outputs out (a steam machine): the player takes them out by hand, '
        + 'which the checker models as each run\'s outputs entering ME as the run ends', [0, 0, 0], 'one'],
    ]);
    // outside AE2 a steam machine keeps its outputs in its output slot
    const kept = same(handModel([oneSlotNode('0,0,0', { steam: true })]), { ticks: 70, restartAt: 70, extra: (env) => [feeder(env, '0,0,0', 3, ['t:a@0'], 2, 1_000, 0)] });
    expect(kept.stats.final('0,0,0')).toEqual([null, ['t:x@0', 2]]);
  });

  it('never encodes a fraction', () => {
    // Review Focus 5: a pattern holds whole items, so this one is skipped, and the job asking for Ex cannot be planned: nothing is ever pushed
    const half = line(true, { spec: { patterns: [pattern([['t:a@0', 1]], [['t:x@0', 1], ['t:y@0', 0.5]])] } });
    const run = same({ ...half, planned: { one: { 't:a@0': 1 } } }, { ticks: 400, restartAt: 400 });
    expect(run.stats.ae2Pushes('0,0,1')).toEqual([]);
    expect(brief(run)).toEqual([['feed_starved', 't:a@0', 0,
      'Basic Macerator at 0 0 0 never gets Alpha: the AE2 job cannot be planned: the pattern for Basic Macerator at 0 0 0 holds 0.50× Why: a pattern holds whole items']]);
    // nor one that lists what the machine keeps
    const held = oneSlotNode('0,0,0', { inSlots: 2, recipes: [simRecipe('one', 20, [['t:a@0', 1]], [['t:x@0', 1]], { held: ['t:c@0'] })] });
    const keeps = line(true, { node: held, spec: { patterns: [pattern([['t:a@0', 1], ['t:c@0', 1]], [['t:x@0', 1]])] } });
    expect(brief(same({ ...keeps, planned: { one: { 't:a@0': 1 } } }, { ticks: 400, restartAt: 400 }))).toEqual([['feed_starved', 't:a@0', 0,
      'Basic Macerator at 0 0 0 never gets Alpha: the AE2 job cannot be planned: the pattern for Basic Macerator at 0 0 0 lists Gamma, which Basic Macerator at 0 0 0 '
      + 'keeps and does not use up']]);
  });

  it('waits for a fluid the line pipes away', () => {
    // research §4.2 item 2: an extractor E (1 Alpha → 144 L) and a solidifier S (144 L → 1 Ex), each under its interface; the plan asks for Ex
    const extractor = oneSlotNode('0,0,0', { name: 'Fluid Extractor', recipes: [simRecipe('e', 20, [['t:a@0', 1]], [[IRON, 144]])] });
    const solidify = (inputs: Array<[string, number]>) => oneSlotNode('2,0,0', { name: 'Fluid Solidifier', recipes: [simRecipe('s', 20, inputs, [['t:x@0', 1]])] });
    const model = (inputs: Array<[string, number]>, more: Partial<FeedModel> = {}) => ae2Model([extractor, solidify(inputs)], [
      { id: '0,0,1', targets: [{ node: '0,0,0', side: 3 }], spec: { patterns: [pattern([['t:a@0', 1]], [[IRON, 144]])], blocking: true } },
      { id: '2,0,1', targets: [{ node: '2,0,0', side: 3 }], spec: { patterns: [pattern(inputs, [['t:x@0', 1]])], blocking: true } },
    ], { makers: { [IRON]: ['e'] }, itemFlows: [{ from: 's', to: 'out', key: 't:x@0', perSecond: 1 }], ...more });
    const run = same(model([[IRON, 144]]), { ticks: 1_000, restartAt: 1_000 });
    // E's pattern is pushed; S's never, as its Molten Iron never reaches the CPU, while S runs from the fluid pool (Task 4 rule 7a):
    // nothing goes into S, so it first looks for its recipe at its 600-tick check, and then runs one run after another
    expect(run.stats.ae2Pushes('0,0,1').slice(0, 4)).toEqual([0, 4, 21, 41]);
    expect(run.stats.ae2Pushes('2,0,1')).toEqual([]);
    expect(run.stats.starts('2,0,0').slice(0, 3)).toEqual([599, 619, 639]);
    // S taking a Beta too: its task waits for the Molten Iron, so S never gets the Beta
    const beta = same(model([[IRON, 144], ['t:b@0', 1]], { supply: ['t:a@0', 't:b@0'], planned: { s: { 't:b@0': 1 } } }), { ticks: 1_000, restartAt: 1_000 });
    expect(brief(beta)).toEqual([['feed_starved', 't:b@0', 0, 'Fluid Solidifier at 2 0 0 never gets Beta: the AE2 job waits for Molten Iron, which Fluid Extractor at 0 0 0 '
      + 'makes but the line pipes away, so it never comes back to ME']]);
  });

  it('holds a late input back from the job until it comes', () => {
    // late_input: ME holds no Alpha before the hold ends; the job is planned, and its task waits for it
    const run = same(line(true), { ticks: 200, restartAt: 200, extra: (env) => { env.heldBack = new Set(['t:a@0']); env.heldUntil = 100; return []; } });
    expect(run.stats.ae2Pushes('0,0,1')).toEqual([100, 104, 121, 141, 161, 181]);
  });

  it('keeps its job, send lists and locks through a restart', () => {
    // rule 7: the locked interface of the stray-throwing bench stays locked, and the stuck packet stays in its send list
    const other = pattern([['t:resin@0', 2], ['t:fine2@0', 2], ['t:wire@0', 2], ['t:carbon@0', 1]], [['t:resistor@0', 1]]);
    const locked = benchLine({ patterns: [other], blocking: false, lock: 'until_result' }, { supply: [...BENCH_SUPPLY, 't:fine2@0'] });
    expect(same(locked, { ticks: 2_000, restartAt: 1_000 }, 'restart').stats.ae2Pushes('0,0,1')).toEqual([0]);
    const filtered = oneSlotNode('0,0,0', { inSlots: 2, settings: FILTER_ON, recipes: [simRecipe('one', 20, [['t:a@0', 1], [IRON, 144]], [['t:x@0', 1]])] });
    const stuck = same(line(false, { node: filtered, spec: { patterns: [pattern([['t:a@0', 1], [IRON, 144]], [['t:x@0', 1]])] } }),
      { ticks: 2_000, restartAt: 1_000, ae2FluidStock: true }, 'restart');
    expect([stuck.stats.ae2Pushes('0,0,1'), stuck.findings.map((f) => f.code)]).toEqual([[0], ['feed_fluid_packet']]);
  });
});
