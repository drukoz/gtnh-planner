// tests/unit/layout/feeding/check.test.ts
import { describe, expect, it } from 'vitest';
import { checkFeeding, scenarioParams } from '../../../../src/server/layout/feeding/check.ts';
import type { FeedFinding, FeedingReport, ScenarioName } from '../../../../src/server/layout/feeding/contract.ts';
import { fromWorld, nodeId } from '../../../../src/server/layout/feeding/frame.ts';
import type { FeedModel, NodeId, RoutedNet } from '../../../../src/server/layout/feeding/model.ts';
import { readLine } from '../../../../src/server/layout/feeding/read.ts';
import { NEVER, PHASE, type SimEntity } from '../../../../src/server/layout/feeding/sim/core.ts';
import type { SimEnv } from '../../../../src/server/layout/feeding/sim/machine.ts';
import { runScenario } from '../../../../src/server/layout/feeding/sim/run.ts';
import type { Layout, LayoutBlock } from '../../../../src/shared/types/layout.ts';
import type { Pack } from '../../../../src/shared/types/pack.ts';
import type { Plan, PlanFlow } from '../../../../src/shared/types/plan.ts';
import {
  benchBesideMachine, benchNode, bigLine, chain2, ebfNode, eioModel, feedPlan, feeder, handModel, inputChestNode, layFeed, layLegacy, outputChestNode, simRecipe,
  smelterNode, taker, FEED_IDS, type FeedStep,
} from '../../../helpers/feeding-fixtures.ts';
import { IDS } from '../../../helpers/layout-fixtures.ts';

const MODES = ['direct', 'routed', 'ae2', 'enderio'] as const;

const brief = (f: FeedFinding) => `${f.code} ${f.certainty} ${f.key ?? '-'} ${f.machine}`;
const inScenario = (report: FeedingReport, name: ScenarioName) => report.findings.filter((f) => f.phase === 'sim' && f.scenario === name);
/** A finding as rule 4 compares it across scenarios: its code, its machine and its item. */
const same = (f: FeedFinding) => `${f.code} ${f.machine} ${f.key ?? '-'}`;

/** The machine block of plan step `stepId`. */
function machineBlock(layout: Layout, stepId: string): LayoutBlock {
  const b = layout.blocks.find((x) => x.role === 'machine' && x.stepId === stepId);
  if (b === undefined) throw new Error(`no machine block for step ${stepId}`);
  return b;
}

/**
 * `layout` with every Routed Interface Pipe that holds an Item Extractor Chip given its chips as `feed.chips` in place of
 * its text: the extractor whitelisting what its machine makes (the input chest's: what it stocks), the other chips as the
 * text reads them.
 */
function whitelistExtractors(layout: Layout, pack: Pack, plan: Plan): Layout {
  const model = readLine({ pack, plan, layout });
  const net = model.networks.find((n): n is RoutedNet => n.kind === 'routed')!;
  for (const pipe of net.pipes) {
    if (!pipe.chips.some((c) => c.kind === 'extractor')) continue;
    const node = model.nodes.find((n) => n.id === pipe.target?.node)!;
    const keys = node.kind === 'chest' ? [...node.keys] : [...new Set(node.recipes.flatMap((r) => r.outputs.map((o) => o.key)))].sort();
    const block = layout.blocks.find((b) => b.role === 'chip_pipe' && nodeId(fromWorld(b.pos, layout)) === pipe.id)!;
    block.feed = { chips: pipe.chips.map((c) => (c.kind === 'extractor' ? { kind: 'extractor', filter: { mode: 'whitelist', keys } } : c)) };
    delete block.config?.chips;
  }
  return layout;
}

/** The Advanced Alloy Smelter fed Alpha and 4 Beta from outside, making Gamma (research §4.3). */
const smelterLine = () => feedPlan([{ id: 'sm', mteId: FEED_IDS.SMELTER, count: 1, inputs: [['t:a@0', 1], ['t:b@0', 4]], outputs: [['t:c@0', 1]], ticks: 100 }], [
  { from: 'raw', to: 'sm', key: 't:a@0', perSecond: 1 }, { from: 'raw', to: 'sm', key: 't:b@0', perSecond: 4 }, { from: 'sm', to: 'out', key: 't:c@0', perSecond: 1 },
]);

describe('checkFeeding', () => {
  it('runs every scenario the same way twice, scheduled or tick by tick', async () => {
    for (const mode of ['direct', 'routed', 'ae2', 'enderio'] as const) {
      const { pack, plan } = chain2();
      const layout = await layFeed(pack, plan, mode);
      const a = checkFeeding({ pack, plan, layout, options: { ticks: 2_000 } });
      expect(JSON.parse(JSON.stringify(checkFeeding({ pack, plan, layout, options: { ticks: 2_000 } })))).toEqual(JSON.parse(JSON.stringify(a)));
      expect(checkFeeding({ pack, plan, layout, options: { ticks: 2_000, exhaustive: true } })).toEqual(a);
      expect(a.scenarios.map((s) => s.name)).toEqual(['steady', 'fast_supplier', 'late_input', 'restart', 'multistack_on']);
    }
  });

  it('runs the lines main laid before fix/feeding the same way, scheduled or tick by tick, and reports plain data', async () => {
    // the routed line moves nothing, the machine-to-machine line leaks: reports with findings in them
    for (const mode of MODES) {
      const { pack, plan } = chain2();
      const layout = await layLegacy(pack, plan, mode);
      const a = checkFeeding({ pack, plan, layout, options: { ticks: 3_000 } });
      expect(checkFeeding({ pack, plan, layout, options: { ticks: 3_000, exhaustive: true } })).toEqual(a);
      expect(JSON.parse(JSON.stringify(a))).toStrictEqual(a);
    }
  });

  it('finds today\'s routed line stuck and says why', async () => {
    // main's routed line before fix/feeding, the input this case was written for (it must not move when main's layout does):
    // every Item Extractor Chip is a new one, an empty whitelist
    const { pack, plan } = chain2();
    const layout = await layLegacy(pack, plan, 'routed');
    const report = checkFeeding({ pack, plan, layout });
    expect(report.ok).toBe(false);
    expect([...new Set(report.findings.filter((f) => f.certainty === 'certain').map((f) => f.code))].sort()).toEqual(['feed_no_route', 'feed_starved']);
    // the static findings exactly as precheckFeeding's first case
    expect(report.findings.filter((f) => f.phase === 'static').map(brief)).toEqual([
      'feed_no_route certain t:x@0 Basic Macerator at 3 64 1', 'feed_starved certain t:a@0 Basic Macerator at 3 64 1',
      'feed_no_route certain t:x@0 Basic Macerator at 4 64 3', 'feed_starved certain t:a@0 Basic Macerator at 4 64 3',
      'feed_no_route certain t:y@0 Advanced Assembler at 5 64 1',
    ]);
    // the input chest's new extractor lets no Alpha out, the macerators' let no Ex out
    expect(inScenario(report, 'steady').map((f) => [brief(f), f.text])).toEqual([
      ['feed_starved certain t:a@0 Basic Macerator at 3 64 1',
        'Basic Macerator at 3 64 1 never gets Alpha: the Item Extractor Chip on Chest (input) at 6 64 1 has an empty whitelist (a new chip extracts nothing)'],
      ['feed_starved certain t:a@0 Basic Macerator at 4 64 3',
        'Basic Macerator at 4 64 3 never gets Alpha: the Item Extractor Chip on Chest (input) at 6 64 1 has an empty whitelist (a new chip extracts nothing)'],
      ['feed_starved certain t:x@0 Advanced Assembler at 5 64 1',
        'Advanced Assembler at 5 64 1 never gets Ex: the Item Extractor Chip on Basic Macerator at 3 64 1 has an empty whitelist (a new chip extracts nothing)'],
    ]);
    // every other scenario finds what steady finds, and so reports nothing (rule 4)
    expect(report.findings.filter((f) => f.phase === 'sim' && f.scenario !== 'steady')).toEqual([]);
    expect(report.inputs.map((i) => [i.machine, i.stepId, i.key, i.plannedPerSecond, i.deliveredPerSecond.steady])).toEqual([
      ['Basic Macerator at 3 64 1', 's1', 't:a@0', 0.5, 0], ['Basic Macerator at 4 64 3', 's1', 't:a@0', 0.5, 0],
      ['Advanced Assembler at 5 64 1', 's2', 't:x@0', 1, 0],
    ]);
    // the model's unknowns (each chip pipe read from its text), then the scenarios': the stack sizes once for all five (rule 6)
    expect(report.unknowns.map((u) => [u.code, u.pos?.join(' ')])).toEqual([
      ['routed_text', '3 64 2'], ['extractor_new', '3 64 2'], ['routed_text', '4 64 2'], ['extractor_new', '4 64 2'], ['routed_text', '5 64 2'],
      ['extractor_new', '5 64 2'], ['routed_text', '6 65 1'], ['extractor_new', '6 65 1'], ['routed_text', '6 65 3'], ['stack_sizes', undefined],
    ]);
    // no scenario: the static rules alone, which gate it too (rule 1)
    const statics = checkFeeding({ pack, plan, layout, options: { scenarios: [] } });
    expect([statics.ok, statics.findings, statics.scenarios]).toEqual([false, report.findings.filter((f) => f.phase === 'static'), []]);
    expect(statics.inputs.map((i) => i.deliveredPerSecond)).toEqual([{}, {}, {}]);
    // the model's unknowns, and the stack sizes once, as the static rules read them too (rule 6)
    expect(statics.unknowns).toEqual(report.unknowns);
    expect(statics.unknowns.at(-1)?.code).toBe('stack_sizes');
  });

  it('runs the scenarios asked for, in report order, with the options given', async () => {
    // main's machine-to-machine line: Alpha reaches the output chest first, so the second macerator gets 0.21/s of its 0.5/s
    const { pack, plan } = chain2();
    const layout = await layFeed(pack, plan, 'direct');
    const slow = (r: FeedingReport) => r.findings.filter((f) => f.code === 'feed_slow').map((f) => [f.scenario, f.machine]);
    const asked = checkFeeding({ pack, plan, layout, options: { scenarios: ['restart', 'steady', 'restart'] } });
    expect(asked.scenarios.map((s) => [s.name, s.ticks])).toEqual([['steady', 24_000], ['restart', 24_000]]);
    expect(slow(asked)).toEqual([['steady', 'Basic Macerator at 3 64 3']]);
    // a tolerance of 60 % lets 0.21/s of 0.5/s pass
    expect(slow(checkFeeding({ pack, plan, layout, options: { scenarios: ['steady'], slowTolerance: 0.6 } }))).toEqual([]);
    expect(checkFeeding({ pack, plan, layout, options: { ticks: 3_000, scenarios: ['steady'] } }).scenarios.map((s) => s.ticks)).toEqual([3_000]);
  });

  it('finds the routed line main lays now moving its items', async () => {
    // the same line as main lays it now, with fix/feeding's structured chips: every Item Extractor Chip whitelists what its machine makes
    const { pack, plan } = chain2();
    const report = checkFeeding({ pack, plan, layout: await layFeed(pack, plan, 'routed') });
    expect(report.findings.filter((f) => f.phase === 'static')).toEqual([]);
    expect(report.unknowns.filter((u) => u.code === 'routed_text' || u.code === 'extractor_new')).toEqual([]);
    expect(report.findings.filter((f) => f.code === 'feed_starved' || f.code === 'feed_no_route')).toEqual([]);
    expect(report.ok).toBe(true);
    expect(report.inputs.map((i) => [i.machine, i.deliveredPerSecond.steady! > 0])).toEqual(report.inputs.map((i) => [i.machine, true]));
  });

  it('leaves the bench main fills by hand out of the machine-to-machine line beside it', async () => {
    // main connects nothing to the bench on a machine-to-machine line: no finding names it or what it takes, nothing stocks its
    // Alpha and Beta in the input chest ahead of the macerator's Gamma, and the macerator gets Gamma and runs (what is left is
    // the tail's leak of Gamma into the output chest, which then stops its Ex: Task 10's machine-to-machine case)
    const { pack, plan } = benchBesideMachine();
    const report = checkFeeding({ pack, plan, layout: await layFeed(pack, plan, 'direct') });
    expect(report.findings.filter((f) => f.stepId === 'b' || f.key === 't:a@0' || f.key === 't:b@0' || f.machine.startsWith('Auto Workbench'))).toEqual([]);
    expect(report.findings.filter((f) => f.code === 'feed_starved' || f.code === 'feed_slow')).toEqual([]);
    expect(report.inputs.map((i) => [i.stepId, i.key])).toEqual([['m', 't:c@0']]);
    expect(report.scenarios.map((s) => [s.name, (s.runs.m ?? 0) > 0, s.runs.b])).toEqual(report.scenarios.map((s) => [s.name, true, undefined]));
    expect(report.unknowns.filter((u) => u.code === 'hand_run').map((u) => u.stepId)).toEqual(['b']);
  });

  it('runs main\'s AE2 line into a step made by hand, and reads a rate only while the job has crafts for it', async () => {
    // a macerator whose Ex goes to a step made by hand (Ex → Why → out): the job asks for the Ex the laid part sends out, not for
    // the Why no machine makes, so the macerator is pushed in every scenario (the job used to fail: nothing makes Why)
    const flows: PlanFlow[] = [
      { from: 'raw', to: 's1', key: 't:a@0', perSecond: 0.2 }, { from: 's1', to: 'h', key: 't:x@0', perSecond: 0.2 }, { from: 'h', to: 'out', key: 't:y@0', perSecond: 0.2 },
    ];
    const toHand = feedPlan([
      { id: 's1', mteId: IDS.MACERATOR, count: 1, inputs: [['t:a@0', 1]], outputs: [['t:x@0', 1]] },
      { id: 'h', mteId: -1, count: 1, handCraft: true, inputs: [['t:x@0', 1]], outputs: [['t:y@0', 1]] },
    ], flows);
    const handed = checkFeeding({ ...toHand, layout: await layFeed(toHand.pack, toHand.plan, 'ae2') });
    expect([handed.ok, handed.findings]).toEqual([true, []]);
    expect(handed.scenarios.map((s) => s.runs.s1)).toEqual([480, 480, 480, 480, 480]);
    // a lone macerator (1 Alpha a second at most) planned at 0.3 and 0.1 a second: the job, twice the run's worth at the plan's rate,
    // has pushed its last craft before the run ends, at 0.1 a second before its second half begins; rates are read only before
    const lone = async (rate: number) => {
      const { pack, plan } = feedPlan([{ id: 'm', mteId: IDS.MACERATOR, count: 1, inputs: [['t:a@0', 1]], outputs: [['t:x@0', 1]] }],
        [{ from: 'raw', to: 'm', key: 't:a@0', perSecond: rate }, { from: 'm', to: 'out', key: 't:x@0', perSecond: rate }]);
      return checkFeeding({ pack, plan, layout: await layFeed(pack, plan, 'ae2'), options: { scenarios: ['steady'] } });
    };
    // no feed_slow (it gave 0.2 and 0 a second over the whole second half), and a rate near its speed, or none
    const fast = await lone(0.3);
    expect([fast.findings, fast.inputs[0]!.deliveredPerSecond.steady! > 0.9]).toEqual([[], true]);
    const faster = await lone(0.1);
    expect([faster.findings, faster.inputs[0]!.deliveredPerSecond]).toEqual([[], {}]);
  });

  it('passes the routed line main lays for a bench beside a machine', async () => {
    // the input chest's Item Broadcaster Chip sends Alpha and Beta, which only the bench takes, on its Item Stock Keeper Chip's
    // orders; its Item Extractor Chip sends the macerator's Gamma: R5d has nothing to find, and every scenario keeps the plan's pace
    const { pack, plan } = benchBesideMachine();
    const report = checkFeeding({ pack, plan, layout: await layFeed(pack, plan, 'routed') });
    expect([report.ok, report.findings]).toEqual([true, []]);
    expect(report.inputs.map((i) => [i.stepId, i.key, Object.values(i.deliveredPerSecond).every((r) => r >= i.plannedPerSecond)])).toEqual([
      ['b', 't:a@0', true], ['b', 't:b@0', true], ['m', 't:c@0', true],
    ]);
  });

  it('names the cause of the stops on the lines main lays: the item that circles, the takers without room', { timeout: 60_000 }, async () => {
    // main's routed smelter line (research C19): the input chest's Item Extractor Chip lists Beta, but the Alpha that overshot the
    // empty smelter circles its pipe, still counted as on its way, and leaves its pipe no room to answer for Beta
    const smelter = smelterLine();
    const routed = checkFeeding({ ...smelter, layout: await layFeed(smelter.pack, smelter.plan, 'routed'), options: { scenarios: ['steady'] } });
    expect(routed.findings.filter((f) => f.code === 'feed_starved').map((f) => f.text)).toEqual([
      'Advanced Alloy Smelter at 1 64 1 never gets Beta: 64 Alpha sent to it did not fit and circle its pipe, still counted as on their way there, '
        + 'so its pipe has no room left to answer for Beta',
    ]);
    // the 1,200-block line on EnderIO: the assemblers of Part 3 stop because the two blast furnaces that take it have no room
    const big = checkFeeding({ ...(await bigLine('enderio')), options: { scenarios: ['steady'] } });
    const parts = big.findings.filter((f) => f.code === 'feed_no_route' && f.key === 't:o3@0');
    expect(parts.length).toBeGreaterThan(0);
    expect(parts.filter((f) => !/: its conduit network's only takers for Part 3, Electric Blast Furnace at .* and Electric Blast Furnace at .*, have no room$/.test(f.text))).toEqual([]);
    expect(big.findings.filter((f) => f.text.endsWith('nothing on the line takes it'))).toEqual([]);
  });

  describe('finds today\'s EnderIO smelter crowded only when Multi Stack Input is On', () => {
    it('as main laid it before fix/feeding', async () => {
      const { pack, plan } = smelterLine();
      const layout = await layLegacy(pack, plan, 'enderio');
      const report = checkFeeding({ pack, plan, layout });
      const label = report.inputs[0]!.machine;
      expect(report.findings.filter((f) => f.phase === 'static').map(brief)).toEqual([`feed_crowded risk - ${label}`]);
      expect(inScenario(report, 'steady')).toEqual([]);
      // the input chest's one face starts again at its slot of Alpha after each move, so Alpha fills the first input slot by tick
      // 150 and goes on into the second from 160 (full at 310): Beta never gets in
      const crowded = inScenario(report, 'multistack_on').filter((f) => f.code === 'feed_crowded');
      expect(crowded.map((f) => [brief(f), f.tick])).toEqual([[`feed_crowded certain t:b@0 ${label}`, 161]]);
      expect(crowded[0]!.text).toBe(`Beta cannot get into ${label}: Alpha fills 2 of its 2 input slots (Multi Stack Input On) while its recipe waits for Beta`);
      expect(report.ok).toBe(false);
      // it is multistack_on's finding that gates: the static one is a risk, which never does
      expect(checkFeeding({ pack, plan, layout, options: { scenarios: [] } }).ok).toBe(true);
      // Multi Stack Input set Off
      machineBlock(layout, 'sm').config = { ...machineBlock(layout, 'sm').config, multiStack: false };
      const off = checkFeeding({ pack, plan, layout });
      expect(off.findings.filter((f) => f.code === 'feed_crowded')).toEqual([]);
      expect(off.ok).toBe(true);
    });

    it('as main lays it now', async () => {
      // the same line as main lays it now: fix/feeding sets Multi Stack Input Off on a machine that takes two or more kinds
      const { pack, plan } = smelterLine();
      const report = checkFeeding({ pack, plan, layout: await layFeed(pack, plan, 'enderio') });
      expect(report.findings.filter((f) => f.code === 'feed_crowded')).toEqual([]);
      expect(report.ok).toBe(true);
    });

    it('machine by machine: multistack_on reports what it adds (rule 4)', async () => {
      // two such smelters: one with Multi Stack Input set On, crowded in every scenario, one leaving it unset
      const step = (id: string): FeedStep => ({ id, mteId: FEED_IDS.SMELTER, count: 1, inputs: [['t:a@0', 1], ['t:b@0', 4]], outputs: [['t:c@0', 1]], ticks: 100 });
      const flows = ['on', 'unset'].flatMap((id): PlanFlow[] => [
        { from: 'raw', to: id, key: 't:a@0', perSecond: 0.2 }, { from: 'raw', to: id, key: 't:b@0', perSecond: 0.8 }, { from: id, to: 'out', key: 't:c@0', perSecond: 0.2 },
      ]);
      const { pack, plan } = feedPlan([step('on'), step('unset')], flows);
      const layout = await layLegacy(pack, plan, 'enderio');
      machineBlock(layout, 'on').config = { ...machineBlock(layout, 'on').config, multiStack: true };
      const report = checkFeeding({ pack, plan, layout });
      const found = (name: ScenarioName) => inScenario(report, name).map((f) => `${f.code} ${f.key} ${f.stepId}`);
      expect(found('steady')).toEqual(['feed_crowded t:b@0 on', 'feed_overfill t:a@0 on', 'feed_starved t:b@0 on']);
      // multistack_on finds those three again and the same three on the other smelter: it reports only the other's
      expect(found('multistack_on')).toEqual(['feed_crowded t:b@0 unset', 'feed_overfill t:a@0 unset', 'feed_starved t:b@0 unset']);
    });
  });

  /** m1 (Alpha → Ex, 100 ticks) and m2 (Beta → Why, `m2Ticks`) feeding the smelter c (Ex + Why → Zed, 20 ticks) on main's EnderIO line, with c's Multi Stack Input On. */
  const suppliedLine = async (m2Ticks: number) => {
    const flows: PlanFlow[] = [
      { from: 'raw', to: 'm1', key: 't:a@0', perSecond: 0.2 }, { from: 'raw', to: 'm2', key: 't:b@0', perSecond: 0.2 },
      { from: 'm1', to: 'c', key: 't:x@0', perSecond: 0.2 }, { from: 'm2', to: 'c', key: 't:y@0', perSecond: 0.2 },
      { from: 'c', to: 'out', key: 't:z@0', perSecond: 0.2 },
    ];
    const { pack, plan } = feedPlan([
      { id: 'm1', mteId: IDS.MACERATOR, count: 1, inputs: [['t:a@0', 1]], outputs: [['t:x@0', 1]], ticks: 100 },
      { id: 'm2', mteId: IDS.MACERATOR, count: 1, inputs: [['t:b@0', 1]], outputs: [['t:y@0', 1]], ticks: m2Ticks },
      { id: 'c', mteId: FEED_IDS.SMELTER, count: 1, inputs: [['t:x@0', 1], ['t:y@0', 1]], outputs: [['t:z@0', 1]], ticks: 20 },
    ], flows);
    const layout = await layFeed(pack, plan, 'enderio');
    machineBlock(layout, 'c').config = { ...machineBlock(layout, 'c').config, multiStack: true };
    return { pack, plan, layout };
  };

  it('adds what a fast supplier adds', async () => {
    const { pack, plan, layout } = await suppliedLine(100);
    expect(scenarioParams(readLine({ pack, plan, layout }), 'fast_supplier')).toEqual({ fastSteps: new Set(['m1']), heldBack: new Set(), heldUntil: 0 });
    const report = checkFeeding({ pack, plan, layout });
    const crowded = (name: ScenarioName) => inScenario(report, name).filter((f) => f.code === 'feed_crowded').map((f) => [f.stepId, f.key]);
    // m1 runs in 10 ticks: Ex fills its slot of the smelter, then the slot Why leaves empty between runs
    expect(crowded('fast_supplier')).toEqual([['c', 't:y@0']]);
    expect([crowded('steady'), crowded('late_input')]).toEqual([[], []]);
  });

  it('adds an item a fast supplier crowds out where steady crowds out another (rule 4)', async () => {
    // m2 twice as fast as m1: in steady Why floods the smelter and keeps Ex out; with m1 ten times faster, Ex floods it and keeps Why out
    const { pack, plan, layout } = await suppliedLine(50);
    const report = checkFeeding({ pack, plan, layout });
    const crowded = (name: ScenarioName) => inScenario(report, name).filter((f) => f.code === 'feed_crowded').map((f) => [f.stepId, f.key]);
    expect([crowded('steady'), crowded('fast_supplier')]).toEqual([[['c', 't:x@0']], [['c', 't:y@0']]]);
  });

  it('chooses each scenario\'s fast suppliers and late inputs from the machines taking two or more kinds', () => {
    // p takes Alpha and Beta, q Beta and Gamma (their recipes, whatever the plan flows), r Why alone; s0 to s3 make Alpha, Beta,
    // Gamma and Why
    const two = (id: string, step: string, kinds: string[]) => smelterNode({ id, recipes: [simRecipe(step, 20, kinds.map((k): [string, number] => [k, 1]), [['t:x@0', 1]])] });
    const model = handModel([two('0,0,0', 'p', ['t:a@0', 't:b@0']), two('2,0,0', 'q', ['t:b@0', 't:c@0']), two('4,0,0', 'r', ['t:y@0'])],
      { makers: { 't:a@0': ['s0'], 't:b@0': ['s1'], 't:c@0': ['s2'], 't:y@0': ['s3'] } });
    const none = { fastSteps: new Set(), heldBack: new Set(), heldUntil: 0 };
    // the makers of each one's first kind run fast; each one's last kind is held back, but Beta, which q takes first
    expect(scenarioParams(model, 'fast_supplier')).toEqual({ ...none, fastSteps: new Set(['s0', 's1']) });
    expect(scenarioParams(model, 'late_input')).toEqual({ ...none, heldBack: new Set(['t:c@0']), heldUntil: 1_200 });
    expect((['steady', 'restart', 'multistack_on'] as const).map((s) => scenarioParams(model, s))).toEqual([none, none, none]);
  });

  it('adds what a late input adds', () => {
    // chest 0,0,0 (Ex) and chest 2,0,0 (Why), each north of its own conduit with an extract face; the conduit between them
    // inserts into the smelter c at 1,0,2, which has Multi Stack Input On
    const c = smelterNode({
      id: '1,0,2', recipes: [simRecipe('c', 20, [['t:x@0', 1], ['t:y@0', 1]], [['t:z@0', 1]])],
      settings: { multiStack: true, inputFilter: null, inputFromOutputSide: null, autoOutput: null },
    });
    const model = eioModel([inputChestNode('0,0,0', ['t:x@0']), inputChestNode('2,0,0', ['t:y@0']), c], [
      { conduit: '0,0,1', side: 2, mode: 'extract', extract: { filter: { whitelist: true, keys: ['t:x@0'] } } },
      { conduit: '1,0,1', side: 3, mode: 'insert' },
      { conduit: '2,0,1', side: 2, mode: 'extract', extract: { filter: { whitelist: true, keys: ['t:y@0'] } } },
    ]);
    expect(scenarioParams(model, 'late_input')).toEqual({ fastSteps: new Set(), heldBack: new Set(['t:y@0']), heldUntil: 1_200 });
    const run = (name: ScenarioName) => {
      const [scheduled, exhaustive] = [false, true].map((x) => runScenario(model, name, { ticks: 3_000, restartAt: 1_500, exhaustive: x }));
      expect(scheduled).toEqual(exhaustive);
      return scheduled!;
    };
    const crowded = (name: ScenarioName) => run(name).findings.filter((f) => f.code === 'feed_crowded').map((f) => [f.key, f.tick]);
    // Ex takes both slots by tick 310 (the second from 160), before Why may come at 1,200
    expect(crowded('late_input')).toEqual([['t:y@0', 161]]);
    expect(run('late_input').stats.final('1,0,2')).toEqual([['t:x@0', 64], ['t:x@0', 64], null]);
    expect([crowded('steady'), crowded('fast_supplier')]).toEqual([[], []]);
  });

  it('reports the restart\'s burst', async () => {
    const { pack, plan } = chain2();
    const lines = [
      // main's routed line before fix/feeding with every Item Extractor Chip whitelisting its machine's outputs, and main's line now
      { layout: whitelistExtractors(await layLegacy(pack, plan, 'routed'), pack, plan), ticks: 24_000 },
      { layout: await layFeed(pack, plan, 'routed'), ticks: 24_000 },
      // main's EnderIO line restarted at 11,990, half its run: the faces, built anew, hand Alpha over on that very tick (which
      // steady does not), so the restart's own tick counts after it and in the second half
      { layout: await layFeed(pack, plan, 'enderio'), ticks: 23_980 },
    ];
    for (const { layout, ticks } of lines) {
      const restartAt = ticks / 2;
      const report = checkFeeding({ pack, plan, layout, options: { ticks } });
      const macerators = report.inputs.filter((i) => i.stepId === 's1');
      expect(macerators.map((i) => i.machine)).toEqual(['Basic Macerator at 3 64 1', layout.mode === 'enderio' ? 'Basic Macerator at 3 64 3' : 'Basic Macerator at 4 64 3']);
      // what the restart run handed each macerator in the 1,200 ticks before the restart and in those from it, and over the
      // run's second half, per second
      const restart = runScenario(readLine({ pack, plan, layout }), 'restart', { ticks, restartAt });
      const given = (id: string, from: number, to: number) => restart.stats.deliveries(id)
        .reduce((n, [t, key, count]) => (key === 't:a@0' && t >= from && t < to ? n + count : n), 0);
      for (const m of macerators) {
        const id = nodeId(fromWorld(m.pos, layout));
        expect(m.burst).toEqual({ before: given(id, restartAt - 1_200, restartAt), after: given(id, restartAt, restartAt + 1_200) });
        expect(m.burst!.before).toBeGreaterThan(0);
        expect(m.deliveredPerSecond.restart).toBe(given(id, restartAt, ticks) / ((ticks - restartAt) / 20));
        if (layout.mode === 'enderio') expect(given(id, restartAt, restartAt + 1)).toBeGreaterThan(0);
      }
      // a report without the restart has no burst
      expect(checkFeeding({ pack, plan, layout, options: { scenarios: ['steady'] } }).inputs.map((i) => i.burst)).toEqual([undefined, undefined, undefined]);
      // what steady finds, restart does not report again (rule 4)
      const steady = new Set(inScenario(report, 'steady').map(same));
      expect(inScenario(report, 'restart').filter((f) => steady.has(same(f)))).toEqual([]);
    }
  });

  it('counts what a multiblock is handed through its input buses', async () => {
    // an Electric Blast Furnace fed Alpha and Beta on main's EnderIO line: its conduit face inserts into its input bus
    const { pack, plan } = feedPlan([{ id: 'e', mteId: IDS.EBF, count: 1, inputs: [['t:a@0', 1], ['t:b@0', 1]], outputs: [['t:x@0', 1]], ticks: 100 }], [
      { from: 'raw', to: 'e', key: 't:a@0', perSecond: 0.2 }, { from: 'raw', to: 'e', key: 't:b@0', perSecond: 0.2 }, { from: 'e', to: 'out', key: 't:x@0', perSecond: 0.2 },
    ]);
    const report = checkFeeding({ pack, plan, layout: await layFeed(pack, plan, 'enderio'), options: { scenarios: ['steady'] } });
    expect(report.inputs.map((i) => [i.machine, i.key, i.plannedPerSecond, i.deliveredPerSecond])).toEqual([
      ['Electric Blast Furnace at 2 64 3', 't:a@0', 0.2, { steady: 0.2 }], ['Electric Blast Furnace at 2 64 3', 't:b@0', 0.2, { steady: 0.2 }],
    ]);
  });

  it('reports the same findings in every rotation', async () => {
    // the lines main laid before fix/feeding (whose routed line moves nothing) and main's lines now
    for (const lay of [layLegacy, layFeed]) {
      for (const mode of MODES) {
        const views: unknown[][] = [];
        for (const rotation of [0, 90, 180, 270] as const) {
          const { pack, plan } = chain2();
          const layout = await lay(pack, plan, mode, { origin: [30, 64, 10], rotation });
          const report = checkFeeding({ pack, plan, layout });
          views.push(report.findings.map((f) => [f.code, f.phase, f.certainty, f.scenario, f.stepId, fromWorld(f.pos, layout), f.key, f.tick, f.count]));
        }
        expect(views.slice(1)).toEqual([views[0], views[0], views[0]]);
        if (lay === layLegacy && mode === 'routed') expect(views[0]!.length).toBeGreaterThan(0);
      }
    }
  });

  it('checks an empty layout', async () => {
    const empty = { code: 'empty_line', text: 'Nothing to check: the layout places no machine' };
    const { pack, plan } = chain2();
    plan.status = 'empty';
    const layout = await layFeed(pack, plan, 'routed');
    expect(layout.status).toBe('empty');
    expect(checkFeeding({ pack, plan, layout })).toEqual({ ok: true, findings: [], inputs: [], scenarios: [], unknowns: [empty] });
    // a layout whose only machine's step the plan lacks
    const one = feedPlan([{ id: 'q', mteId: IDS.MACERATOR, count: 1, inputs: [['t:a@0', 1]], outputs: [['t:x@0', 1]] }]);
    const report = checkFeeding({ pack: one.pack, plan: { ...one.plan, steps: [] }, layout: await layFeed(one.pack, one.plan, 'enderio') });
    expect([report.ok, report.findings, report.inputs, report.scenarios]).toEqual([true, [], [], []]);
    expect(report.unknowns[0]).toEqual(empty);
    expect(report.unknowns.filter((u) => u.code === 'step_missing').map((u) => u.stepId)).toEqual(['q']);
  });

  it('lists each item a machine drops into the world, once for the five scenarios (rule 6)', async () => {
    // a Seed Thing making Ex and Why on main's machine-to-machine line, without its two output chests and with an HV export
    // conveyor on its top, where nothing stands: every scenario drops 38 of each into the world there
    const { pack, plan } = feedPlan([{ id: 'q', mteId: FEED_IDS.ODD, count: 1, inputs: [['t:a@0', 1]], outputs: [['t:x@0', 1], ['t:y@0', 1]], ticks: 100 }], [
      { from: 'raw', to: 'q', key: 't:a@0', perSecond: 0.2 }, { from: 'q', to: 'out', key: 't:x@0', perSecond: 0.2 }, { from: 'q', to: 'out', key: 't:y@0', perSecond: 0.2 },
    ]);
    const layout = await layFeed(pack, plan, 'direct');
    layout.blocks = layout.blocks.filter((b) => b.tail?.side !== 'output');
    const machine = machineBlock(layout, 'q');
    machine.covers = [...(machine.covers ?? []), { face: 'up', item: 'gregtech:gt.metaitem.01@32632', settings: { mode: 'export', allowInput: true } }];
    const report = checkFeeding({ pack, plan, layout, options: { ticks: 4_000 } });
    expect([report.ok, report.findings]).toEqual([true, []]);
    // two items dropped at one machine are two unknowns, each kept once, with its count
    const lost = (name: string) => `Seed Thing at 1 64 1 dropped 38 ${name} into the world: nothing at the side it pushes them out of takes them, so they are lost to the line`;
    expect(report.unknowns.filter((u) => u.code === 'items_dropped').map((u) => [u.pos, u.stepId, u.key, u.text])).toEqual([
      [[1, 64, 1], 'q', 't:x@0', lost('Ex')], [[1, 64, 1], 'q', 't:y@0', lost('Why')],
    ]);
  });

  it('checks a 1,200-block line in under a second', { timeout: 120_000 }, async () => {
    // per mode, one untimed run as the warm-up, then three timed in main-thread CPU time: other lanes' load on this shared host
    // stretches wall-clock time, and process.cpuUsage() would count the process's other threads too
    const medians: Array<{ mode: string; blocks: number; ms: number }> = [];
    for (const mode of MODES) {
      const line = await bigLine(mode);
      checkFeeding(line);
      const times = [0, 1, 2].map(() => {
        const before = process.threadCpuUsage();
        checkFeeding(line);
        const used = process.threadCpuUsage(before);
        return (used.user + used.system) / 1_000;
      }).sort((a, b) => a - b);
      medians.push({ mode, blocks: line.layout.blocks.length, ms: times[1]! });
    }
    console.log(`checkFeeding on a 1,200-block line, the median main-thread CPU time of 3 runs: ${medians.map((m) => `${m.mode} ${m.ms.toFixed(0)} ms (${m.blocks} blocks)`).join(', ')}`);
    expect(medians.filter((m) => m.blocks < 1_200)).toEqual([]);
    expect(medians.filter((m) => m.ms >= 1_000)).toEqual([]);
  });
});

describe('the change counts rule 7\'s routed steps rest on', () => {
  const NEVER_AGAIN = 1_000_000;

  /**
   * A test entity (phase `feed`, before the others) that looks at the inventories `ids` at the start of every tick and records
   * each tick their slots differ from the tick before (`moved`), and each such tick their `changes` did not move (`missed`).
   */
  const watcher = (env: SimEnv, ids: NodeId[], moved: Array<[NodeId, number]>, missed: Array<[NodeId, number]>): SimEntity => {
    const last = new Map<NodeId, [number, string]>();
    return {
      phase: PHASE.feed, order: 0,
      tick(t: number): number {
        for (const id of ids) {
          const inv = env.inv(id)!;
          const slots = JSON.stringify(Array.from({ length: inv.slotCount() }, (_, i) => inv.stack(i)));
          const before = last.get(id);
          if (before !== undefined && before[1] !== slots) {
            moved.push([id, t]);
            if (before[0] === inv.changes) missed.push([id, t]);
          }
          last.set(id, [inv.changes, slots]);
        }
        return t + 1;
      },
    };
  };

  /** `model` run for `ticks` with `initial` contents and the entities of `more`, watched at `ids`. */
  const watch = (model: FeedModel, ids: NodeId[], ticks: number, initial: Parameters<typeof runScenario>[2]['initial'], more: (env: SimEnv) => SimEntity[]) => {
    const moved: Array<[NodeId, number]> = [], missed: Array<[NodeId, number]> = [];
    runScenario(model, 'steady', { ticks, restartAt: ticks, initial, extra: (env) => [watcher(env, ids, moved, missed), ...more(env)] });
    return { moved, missed };
  };

  it('counts every change to what an inventory holds, each in a tick of its own', () => {
    // a basic machine: its run starts at its first 600-tick check (599) and ends at 699; a taker takes its output at 800, a feeder brings Alpha at 900
    expect(watch(handModel([smelterNode()]), ['0,0,0'], 1_000, { '0,0,0': [[0, 't:a@0', 1], [1, 't:b@0', 4]] },
      (env) => [taker(env, '0,0,0', 3, 64, [800]), feeder(env, '0,0,0', 3, ['t:a@0'], 1, NEVER_AGAIN, 900)]))
      .toEqual({ moved: [['0,0,0', 600], ['0,0,0', 700], ['0,0,0', 801], ['0,0,0', 901]], missed: [] });
    // a multiblock: its controller's check at tick 0 takes the set out of its input bus (and sorts it), the run puts its output
    // into its output bus at 100, a taker takes it at 200; in the arrivals phase, after the bus's own turn, Alpha goes into the
    // input bus's third slot at 300 and out of its first at 350: the bus sorts itself only in its tick after each (301, 351)
    const late = (env: SimEnv): SimEntity => ({
      phase: PHASE.arrivals, order: 0,
      tick(t: number): number {
        const bus = env.inv('0,0,0')!;
        if (t === 300) bus.insert(2, env.keys.id('t:a@0'), 5, null);
        if (t === 350) bus.extract(0, 5, null);
        return t < 300 ? 300 : t < 350 ? 350 : NEVER;
      },
    });
    expect(watch(handModel([ebfNode()]), ['0,0,0', '2,0,0'], 400, { '0,0,0': [[0, 't:a@0', 1], [1, 't:b@0', 1]] },
      (env) => [taker(env, '2,0,0', 3, 64, [200]), late(env)]))
      .toEqual({ moved: [['0,0,0', 1], ['2,0,0', 101], ['2,0,0', 201], ['0,0,0', 301], ['0,0,0', 302], ['0,0,0', 351]], missed: [] });
    // a bench crafts at 34 from what it holds, and a taker takes the result at 40
    expect(watch(handModel([benchNode()]), ['0,0,0'], 60, { '0,0,0': [[0, 't:resin@0', 2], [1, 't:fine@0', 2], [2, 't:wire@0', 2], [3, 't:carbon@0', 1]] },
      (env) => [taker(env, '0,0,0', 3, 64, [40])]))
      .toEqual({ moved: [['0,0,0', 35], ['0,0,0', 41]], missed: [] });
    // an output chest keeps an item the line does not send out, brought at 10, until a taker takes it at 20
    expect(watch(handModel([outputChestNode('0,0,0')], { supply: ['t:a@0'] }), ['0,0,0'], 30, undefined,
      (env) => [feeder(env, '0,0,0', 2, ['t:a@0'], 5, NEVER_AGAIN, 10), taker(env, '0,0,0', 2, 64, [20])]))
      .toEqual({ moved: [['0,0,0', 11], ['0,0,0', 21]], missed: [] });
  });
});
