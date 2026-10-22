// tests/unit/layout/feeding/precheck.test.ts — the static rules R1–R12 on the lines `feedPlan` and main's `layoutLine` make
import { describe, expect, it } from 'vitest';
import { precheckFeeding } from '../../../../src/server/layout/feeding/precheck.ts';
import { readLine } from '../../../../src/server/layout/feeding/read.ts';
import type { FeedBlock, FeedConduitFilter, FeedSpec, RoutedChipSpec } from '../../../../src/server/layout/feeding/contract.ts';
import { PART_KEYS } from '../../../../src/server/layout/feeding/facts.ts';
import type { BasicNode, BenchNode, MultiNode } from '../../../../src/server/layout/feeding/model.ts';
import { fromWorld } from '../../../../src/server/layout/feeding/frame.ts';
import { amountText, listText, slotWord } from '../../../../src/server/layout/feeding/text.ts';
import { posKey, type Vec3 } from '../../../../src/shared/layout/geometry.ts';
import type { Layout } from '../../../../src/shared/types/layout.ts';
import type { Pack } from '../../../../src/shared/types/pack.ts';
import type { Plan, PlanFlow } from '../../../../src/shared/types/plan.ts';
import { chain2, feedPlan, layFeed, layLegacy, FEED_IDS } from '../../../helpers/feeding-fixtures.ts';
import { IDS } from '../../../helpers/layout-fixtures.ts';

const brief = (f: { code: string; certainty: string; key?: string; machine: string }) => `${f.code} ${f.certainty} ${f.key ?? '-'} ${f.machine}`;

/** The machine block of plan step `stepId`. */
function machineBlock(layout: Layout, stepId: string): FeedBlock {
  const b = layout.blocks.find((x) => x.role === 'machine' && x.stepId === stepId);
  if (b === undefined) throw new Error(`no machine block for step ${stepId}`);
  return b;
}

/** The first block labelled `label` (labels are unique in the small fixture lines). */
function labelled(layout: Layout, label: string): FeedBlock {
  const b = layout.blocks.find((x) => x.label === label);
  if (b === undefined) throw new Error(`no block labelled ${label}`);
  return b;
}

describe('precheckFeeding', () => {
  it('finds the routed lines main laid before fix/feeding move nothing', async () => {
    const { pack, plan } = chain2();
    const m = readLine({ pack, plan, layout: await layLegacy(pack, plan, 'routed') });
    // node order, then rule order (R5a before R5d)
    expect(precheckFeeding(m, pack).map(brief)).toEqual([
      'feed_no_route certain t:x@0 Basic Macerator at 3 64 1', 'feed_starved certain t:a@0 Basic Macerator at 3 64 1',
      'feed_no_route certain t:x@0 Basic Macerator at 4 64 3', 'feed_starved certain t:a@0 Basic Macerator at 4 64 3',
      'feed_no_route certain t:y@0 Advanced Assembler at 5 64 1',
    ]);
    expect(precheckFeeding(m, pack)[0]!.text).toBe('Nothing takes Ex out of Basic Macerator at 3 64 1: its Item Extractor Chip has an empty whitelist (a new chip extracts nothing)');
    expect(precheckFeeding(m, pack)[1]!.text).toBe('Basic Macerator at 3 64 1 never gets Alpha: the Item Extractor Chip on Chest (input) at 6 64 1 has an empty whitelist (a new chip extracts nothing)');
  });

  it('counts kinds against free slots', async () => {
    const keys = Array.from({ length: 10 }, (_, i) => `t:k${i}@0`);
    const big = feedPlan([{ id: 'big', mteId: IDS.ASSEMBLER, tier: 2, count: 1, inputs: keys.map((k): [string, number] => [k, 1]) }]);
    const bigModel = readLine({ pack: big.pack, plan: big.plan, layout: await layFeed(big.pack, big.plan, 'enderio') });
    const assembler = bigModel.nodes.find((n): n is BasicNode => n.kind === 'basic')!;
    // the assembler (tier 2) has 9 input slots; Multi Stack Input is left unset, which R2 notes as a risk
    expect(precheckFeeding(bigModel, big.pack).map(brief)).toEqual([`feed_crowded certain - ${assembler.label}`, `feed_crowded risk - ${assembler.label}`]);
    expect(precheckFeeding(bigModel, big.pack)[0]!.text).toBe(`${assembler.label} takes 10 kinds of item but has 9 input slots free: one kind always waits`);

    const sm = feedPlan([{ id: 'sm', mteId: FEED_IDS.SMELTER, count: 1, inputs: [['t:a@0', 1], ['t:b@0', 4]], held: ['t:c@0'], outputs: [['t:x@0', 1]] }]);
    const smModel = readLine({ pack: sm.pack, plan: sm.plan, layout: await layFeed(sm.pack, sm.plan, 'enderio') });
    const smelter = smModel.nodes.find((n): n is BasicNode => n.kind === 'basic')!;
    const crowded = precheckFeeding(smModel, sm.pack).filter((f) => f.certainty === 'certain');
    expect(crowded.map((f) => [f.code, f.stepId, f.text])).toEqual([[
      'feed_crowded', 'sm', `${smelter.label} takes 2 kinds of item but has 1 input slot free (1 held: Gamma): one kind always waits`,
    ]]);
  });

  it('skips the slot rule where slots are unknown', async () => {
    const { pack, plan } = feedPlan([{ id: 'q', mteId: FEED_IDS.ODD, count: 1, inputs: [['t:a@0', 1], ['t:b@0', 2], ['t:c@0', 1]], outputs: [['t:x@0', 1]] }]);
    const m = readLine({ pack, plan, layout: await layFeed(pack, plan, 'enderio') });
    const node = m.nodes.find((n): n is BasicNode => n.kind === 'basic')!;
    expect(node.kinds).toHaveLength(3);
    // no R1, and the R2 risk is still raised
    expect(precheckFeeding(m, pack).map(brief)).toEqual([`feed_crowded risk - ${node.label}`]);
    // the slots of such a machine come from its recipes, so they are no measure: even fewer of them raise no R1
    node.inSlots = 1;
    expect(precheckFeeding(m, pack).map(brief)).toEqual([`feed_crowded risk - ${node.label}`]);
  });

  it('counts a machine\'s kinds against the slots the export gives it', async () => {
    // a steam macerator that takes two kinds: without exported counts its slots come from its recipes, which are no measure
    const line = () => feedPlan([{ id: 'st', mteId: FEED_IDS.STEAM, count: 1, inputs: [['t:a@0', 1], ['t:b@0', 1]], outputs: [['t:x@0', 1]] }]);
    const certain = async (counts?: { itemInSlots: number; itemOutSlots: number }) => {
      const { pack, plan } = line();
      if (counts !== undefined) Object.assign(pack.machines.get(FEED_IDS.STEAM)!, counts);
      const m = readLine({ pack, plan, layout: await layFeed(pack, plan, 'enderio') });
      const label = m.nodes.find((n) => n.kind === 'basic')!.label;
      return precheckFeeding(m, pack).filter((f) => f.certainty === 'certain').map((f) => [f.code, f.text.replace(label, '<steam>')]);
    };
    expect(await certain()).toEqual([]);
    // exporter 0.6.0 counts its one input slot: R1 applies
    expect(await certain({ itemInSlots: 1, itemOutSlots: 1 })).toEqual([['feed_crowded', '<steam> takes 2 kinds of item but has 1 input slot free: one kind always waits']]);
  });

  it('flags Multi Stack Input left to chance', async () => {
    const line = () => feedPlan([{ id: 'sm', mteId: FEED_IDS.SMELTER, count: 1, inputs: [['t:a@0', 1], ['t:b@0', 4]], outputs: [['t:x@0', 1]] }]);
    const run = async (mode: 'enderio' | 'ae2', multiStack?: boolean) => {
      const { pack, plan } = line();
      const layout = await layFeed(pack, plan, mode);
      if (multiStack !== undefined) machineBlock(layout, 'sm').config = { ...machineBlock(layout, 'sm').config, multiStack };
      const m = readLine({ pack, plan, layout });
      return { m, findings: precheckFeeding(m, pack), label: m.nodes.find((n) => n.kind === 'basic')!.label };
    };
    const unset = await run('enderio');
    expect(unset.findings.map(brief)).toEqual([`feed_crowded risk - ${unset.label}`]);
    expect(unset.findings[0]!.text).toBe(`${unset.label} takes 2 kinds of item and the layout does not set Multi Stack Input Off: with it On, the first kind to arrive fills every free input slot`);
    expect((await run('enderio', false)).findings).toEqual([]);
    const on = await run('enderio', true);
    expect(on.findings.map(brief)).toEqual([`feed_crowded certain - ${on.label}`]);
    expect(on.findings[0]!.text).toBe(`${on.label} has Multi Stack Input On and takes 2 kinds of item: the first kind to arrive fills every free input slot`);
    // AE2 pushes whole sets, so the setting does not matter there
    expect((await run('ae2')).findings).toEqual([]);
  });

  it('flags buses without Limiting mode', async () => {
    const { pack, plan } = feedPlan([{ id: 'e', mteId: IDS.EBF, count: 1, inputs: [['t:a@0', 1], ['t:b@0', 1]], outputs: [['t:x@0', 1]] }]);
    const layout = await layFeed(pack, plan, 'enderio');
    const m = readLine({ pack, plan, layout });
    const ebf = m.nodes.find((n) => n.kind === 'multi')!;
    const findings = precheckFeeding(m, pack);
    expect(findings.map(brief)).toEqual([`feed_overfill risk - ${ebf.label}`]);
    expect(findings[0]!.text).toBe(`Input Bus (LV) at 3 64 3 of ${ebf.label} takes 2 kinds of item without Limiting mode: one kind can fill every slot of the bus`);
    const bus = layout.blocks.find((b) => b.hatch === 'input_bus')!;
    // Limiting mode set Off is still Limiting mode off
    bus.config = { limited: false };
    expect(precheckFeeding(readLine({ pack, plan, layout }), pack).map(brief)).toEqual([`feed_overfill risk - ${ebf.label}`]);
    bus.config = { limited: true };
    expect(precheckFeeding(readLine({ pack, plan, layout }), pack)).toEqual([]);
  });

  it('finds items with nowhere to go', async () => {
    const { pack, plan } = feedPlan([
      { id: 's1', mteId: IDS.MACERATOR, count: 1, inputs: [['t:a@0', 1]], outputs: [['t:x@0', 1]] },
      { id: 'h', mteId: -1, count: 1, handCraft: true, inputs: [['t:x@0', 1]], outputs: [['t:y@0', 1]] },
    ]);
    const layout = await layLegacy(pack, plan, 'routed');
    labelled(layout, 'Routed Interface Pipe (Basic Macerator)').feed = {
      chips: [{ kind: 'responder', filter: { mode: 'whitelist', keys: ['t:a@0'] } }, { kind: 'extractor', filter: { mode: 'whitelist', keys: ['t:x@0'] } }],
    };
    labelled(layout, 'Routed Interface Pipe (input chest)').feed = { chips: [{ kind: 'extractor', filter: { mode: 'whitelist', keys: ['t:a@0'] } }] };
    const m = readLine({ pack, plan, layout });
    const findings = precheckFeeding(m, pack);
    expect(findings.map(brief)).toEqual(['feed_no_route certain t:x@0 Basic Macerator at 1 64 1']);
    expect(findings[0]!.text).toBe('Nothing on the routed network takes Ex from Basic Macerator at 1 64 1: no Item Responder Chip lists it (it goes to Why, which has no machine)');
    expect(findings[0]).toMatchObject({ phase: 'static', kind: 'deadlock', stepId: 's1', pos: [1, 64, 1] });
  });

  it('flags input-bus extractors and blacklist chips', async () => {
    const ebf = feedPlan([{ id: 'e', mteId: IDS.EBF, count: 1, inputs: [['t:a@0', 1], ['t:b@0', 1]], outputs: [['t:x@0', 1]] }]);
    const ebfModel = readLine({ pack: ebf.pack, plan: ebf.plan, layout: await layLegacy(ebf.pack, ebf.plan, 'routed') });
    const ebfFindings = precheckFeeding(ebfModel, ebf.pack);
    const churn = ebfFindings.filter((f) => f.code === 'feed_churn');
    expect(churn.map(brief)).toEqual(['feed_churn certain - Electric Blast Furnace at 2 64 3']);
    expect(churn[0]!.text).toBe("The Item Extractor Chip on Input Bus (LV) at 3 64 3 pulls Electric Blast Furnace at 2 64 3's inputs back out of its input bus");

    const { pack, plan } = chain2();
    const layout = await layLegacy(pack, plan, 'routed');
    labelled(layout, 'Routed Interface Pipe (Basic Macerator)').feed = {
      chips: [{ kind: 'extractor', filter: { mode: 'blacklist', keys: [] } }, { kind: 'broadcaster', filter: { mode: 'blacklist', keys: [] } }],
    };
    const m = readLine({ pack, plan, layout });
    // both macerators' pipes carry the chips now; the risks are theirs
    const risks = precheckFeeding(m, pack).filter((f) => f.machine === 'Basic Macerator at 3 64 1' && f.certainty === 'risk');
    expect(risks.map(brief)).toEqual(['feed_starved risk t:a@0 Basic Macerator at 3 64 1', 'feed_starved risk - Basic Macerator at 3 64 1']);
    expect(risks[0]!.text).toBe('The Item Extractor Chip on Basic Macerator at 3 64 1 also lists Alpha, which it cannot take back out: each time it tries it first, it gives up the whole update');
    expect(risks[1]!.text).toBe('The Item Broadcaster Chip on Basic Macerator at 3 64 1 offers its inputs too: an order for one of them fails and is dropped');
  });

  it('finds patterns AE2 cannot encode', async () => {
    const f = feedPlan([{ id: 'f', mteId: IDS.SOLIDIFIER, count: 1, inputs: [['fluid:molten.iron', 144]], held: ['gregtech:gt.metaitem.01@32301'], outputs: [['t:x@0', 1]] }]);
    const fm = readLine({ pack: f.pack, plan: f.plan, layout: await layLegacy(f.pack, f.plan, 'ae2') });
    const label = fm.nodes.find((n) => n.kind === 'basic')!.label;
    const findings = precheckFeeding(fm, f.pack);
    expect(findings.map(brief)).toEqual([`feed_pattern_unencodable certain fluid:molten.iron ${label}`, `feed_fluid_packet risk fluid:molten.iron ${label}`]);
    expect(findings[0]!.text).toBe(`The pattern for ${label} lists Molten Iron, a fluid the line pipes: ME never holds it, so AE2 cannot plan with it`);
    expect(findings[1]!.text).toBe(`ME Interface (Basic Fluid Solidifier) at 1 64 2 turns Molten Iron into a Fluid Packet item, which ${label} can take into an input slot for good`);

    const c = feedPlan([{ id: 'c', mteId: IDS.MACERATOR, count: 1, inputs: [['t:a@0', 1]], outputs: [['t:x@0', 1], ['t:y@0', 1]], chances: { 't:y@0': 0.5 } }]);
    const cm = readLine({ pack: c.pack, plan: c.plan, layout: await layLegacy(c.pack, c.plan, 'ae2') });
    const cLabel = cm.nodes.find((n) => n.kind === 'basic')!.label;
    const fraction = precheckFeeding(cm, c.pack);
    expect(fraction.map(brief)).toEqual([`feed_pattern_unencodable certain t:y@0 ${cLabel}`]);
    expect(fraction[0]!.text).toBe(`The pattern for ${cLabel} holds 0.50× Why: a pattern holds whole items`);
  });

  it('knows what blocking mode skips', async () => {
    const run = async (held: string) => {
      const { pack, plan } = feedPlan([{ id: 'f', mteId: IDS.SOLIDIFIER, count: 1, inputs: [['fluid:molten.iron', 144]], held: [held], outputs: [['t:x@0', 1]] }]);
      const layout = await layFeed(pack, plan, 'ae2');
      labelled(layout, 'ME Interface (Basic Fluid Solidifier)').feed = { interface: { patterns: [{ inputs: [], outputs: [{ key: 't:x@0', amount: 1 }] }], blocking: true } };
      const m = readLine({ pack, plan, layout });
      return { findings: precheckFeeding(m, pack), label: m.nodes.find((n) => n.kind === 'basic')!.label };
    };
    // GT's mold 32301 is on AE2's ignore list
    expect((await run('gregtech:gt.metaitem.01@32301')).findings).toEqual([]);
    const stuck = await run('t:mold@0');
    expect(stuck.findings.map(brief)).toEqual([`feed_starved certain t:mold@0 ${stuck.label}`]);
    expect(stuck.findings[0]!.text).toBe(
      `ME Interface (Basic Fluid Solidifier) at 1 64 2 has blocking mode on and ${stuck.label} holds t:mold@0, which blocking mode does not ignore: it never pushes into it`);
  });

  it("checks a bench's cap and faces", async () => {
    const BENCH_GRID = ['t:a@0', 't:b@0', null, 't:b@0', 't:a@0', null, null, null, null];
    const benchLine = () => feedPlan([{
      id: 'b', mteId: FEED_IDS.BENCH, count: 1, inputs: [['t:a@0', 2], ['t:b@0', 2]], outputs: [['t:x@0', 1]], craft: { width: 2, cells: ['t:a@0', 't:b@0', 't:b@0', 't:a@0'] },
    }]);
    // today's faces: the bench's front is turned to the middle row, so its back touches nothing of the line, and the only cable that connects to it is on its back
    const today = benchLine();
    const todayModel = readLine({ pack: today.pack, plan: today.plan, layout: await layFeed(today.pack, today.plan, 'enderio') });
    const label = todayModel.nodes.find((n) => n.kind === 'bench')!.label;
    const findings = precheckFeeding(todayModel, today.pack);
    expect(findings.map(brief)).toEqual([`feed_overfill certain - ${label}`, `feed_bench_stuck certain - ${label}`, `feed_starved certain - ${label}`]);
    expect(findings.map((f) => f.text)).toEqual([
      `${label} takes its ingredients through a Basic Item Filter, which does not cap amounts: one ingredient can fill all nine input slots`,
      `${label}'s back, where it puts out its result, does not touch the line's logistics`,
      `${label}'s only power cable touches its back, which takes no EU`,
    ]);

    // facing away from the middle row puts the conduit on its back and the cable on its front; a Limited Item Filter caps it
    const fixed = benchLine();
    const layout = await layFeed(fixed.pack, fixed.plan, 'enderio');
    const bench = machineBlock(layout, 'b');
    bench.facing = 2;
    const conduit = layout.blocks.find((b) => b.conduits !== undefined && b.conduits.some((c) => c.faces.some((f) => f.target === bench.label)))!;
    const face = conduit.conduits![0]!.faces.find((f) => f.target === bench.label)!;
    const limited: FeedConduitFilter = {
      item: PART_KEYS.limitedFilter, whitelist: true, keys: ['t:a@0', 't:b@0'], limits: [6, 6],
    };
    face.insert!.filter = limited;
    expect(precheckFeeding(readLine({ pack: fixed.pack, plan: fixed.plan, layout }), fixed.pack)).toEqual([]);

    // a GT tool in a grid cell wears with each craft
    const spec: FeedSpec = { bench: { mode: 'normal', grid: [...BENCH_GRID.slice(0, 8), 'gregtech:gt.metatool.01@170'], throughput: 0 } };
    bench.feed = spec;
    const tool = precheckFeeding(readLine({ pack: fixed.pack, plan: fixed.plan, layout }), fixed.pack);
    expect(tool.map(brief)).toEqual([`feed_bench_stuck certain gregtech:gt.metatool.01@170 ${label}`]);
    expect(tool[0]!.text).toBe(`${label}'s grid holds gregtech:gt.metatool.01@170: a GT tool wears with each craft and stops matching the grid after one (use a single-use tool)`);
  });

  it('flags shared machines outside AE2', async () => {
    const run = async (mode: 'routed' | 'ae2', blocking = false) => {
      const { pack, plan } = feedPlan([
        { id: 'p1', mteId: IDS.MACERATOR, count: 1, inputs: [['t:a@0', 1]], outputs: [['t:x@0', 1]] },
        { id: 'p2', mteId: IDS.MACERATOR, count: 1, inputs: [['t:b@0', 1]], outputs: [['t:y@0', 1]] },
      ]);
      const layout = await layLegacy(pack, plan, mode);
      machineBlock(layout, 'p1').stepIds = ['p1', 'p2'];
      layout.blocks = layout.blocks.filter((b) => b.stepId !== 'p2');
      if (blocking) {
        const patterns = [{ inputs: [{ key: 't:a@0', amount: 1 }], outputs: [{ key: 't:x@0', amount: 1 }] }, { inputs: [{ key: 't:b@0', amount: 1 }], outputs: [{ key: 't:y@0', amount: 1 }] }];
        labelled(layout, 'ME Interface (Basic Macerator)').feed = { interface: { patterns, blocking: true } };
      }
      const m = readLine({ pack, plan, layout });
      const findings = precheckFeeding(m, pack);
      // each recipe takes one kind of item, which the macerator's one input slot holds: the two together are not R1's concern
      expect(findings.filter((f) => f.code === 'feed_crowded' && f.certainty === 'certain')).toEqual([]);
      return findings.filter((f) => f.code === 'feed_pool_starve');
    };
    const push = await run('routed');
    expect(push.map(brief)).toEqual(['feed_pool_starve certain - Basic Macerator at 1 64 1']);
    expect(push[0]!.text).toBe('Basic Macerator at 1 64 1 runs 2 recipes in Project Red: it reruns its last recipe while that recipe\'s output waits, so Why can starve');
    const ae2 = await run('ae2');
    expect(ae2.map(brief)).toEqual(['feed_pool_starve risk - Basic Macerator at 1 64 1']);
    expect(ae2[0]!.text).toBe("Basic Macerator at 1 64 1 runs 2 recipes and ME Interface (Basic Macerator) at 1 64 2 has blocking mode off: it mixes the recipes' sets");
    // blocking mode on pushes one recipe's set at a time into an empty machine: nothing to say
    expect(await run('ae2', true)).toEqual([]);
  });

  it('flags an interface touching two inventories', async () => {
    const { pack, plan } = chain2();
    const layout = await layFeed(pack, plan, 'ae2');
    layout.blocks.push({ pos: [7, 65, 2], block: { id: 'minecraft:chest', meta: 0 }, role: 'chest', label: 'Chest', tail: { side: 'output', keys: [] } });
    const findings = precheckFeeding(readLine({ pack, plan, layout }), pack);
    expect(findings.map(brief)).toEqual(['feed_leak risk - Advanced Assembler at 7 64 1']);
    expect(findings[0]!.text).toBe(
      "ME Interface (Advanced Assembler) at 7 64 2 pushes into 2 inventories (Chest at 7 65 2 and Advanced Assembler at 7 64 1): its pattern's items can reach the wrong one");
  });
});

// ---- the rules' other branches ----

/** The line's own block at world cell `pos` (no ghost, no hookup block). */
function blockAt(layout: Layout, pos: Vec3): FeedBlock {
  const b = layout.blocks.find((x) => posKey(x.pos) === posKey(pos) && x.role !== 'ghost' && x.hookup === undefined);
  if (b === undefined) throw new Error(`no block at ${posKey(pos)}`);
  return b;
}

const whitelist = (...keys: string[]) => ({ mode: 'whitelist' as const, keys });
const extractorOf = (...keys: string[]): RoutedChipSpec => ({ kind: 'extractor', filter: whitelist(...keys) });
const responderOf = (...keys: string[]): RoutedChipSpec => ({ kind: 'responder', filter: whitelist(...keys) });
const texts = (findings: ReadonlyArray<{ text: string }>) => findings.map((f) => f.text);

const MOLD = 'gregtech:gt.metaitem.01@32301';
const CIRCUIT = 'gregtech:gt.integrated_circuit@2';
const BENCH_GRID = ['t:a@0', 't:b@0', null, 't:b@0', 't:a@0', null, null, null, null];

/** The bench step of Task 2: a shaped 2 × 2 crafting recipe `t:a t:b / t:b t:a` → 1 `t:x` on the Auto Workbench. */
const benchLine = () => feedPlan([{
  id: 'b', mteId: FEED_IDS.BENCH, count: 1, inputs: [['t:a@0', 2], ['t:b@0', 2]], outputs: [['t:x@0', 1]], craft: { width: 2, cells: ['t:a@0', 't:b@0', 't:b@0', 't:a@0'] },
}]);
const ebfLine = () => feedPlan([{ id: 'e', mteId: IDS.EBF, count: 1, inputs: [['t:a@0', 1], ['t:b@0', 1]], outputs: [['t:x@0', 1]] }]);

/**
 * The bench line laid in `mode` with the bench's front turned away from the middle row (so its back touches the line and no cable is on it),
 * as main lays it, or with `legacy` as main laid it before fix/feeding (`legacyFeed`).
 */
async function benchAway(mode: 'enderio' | 'routed' | 'ae2', legacy = false) {
  const { pack, plan } = benchLine();
  const layout = await (legacy ? layLegacy : layFeed)(pack, plan, mode);
  machineBlock(layout, 'b').facing = 2;
  return { pack, plan, layout };
}

describe('precheckFeeding, the other branches', () => {
  it('notes Input Separation on two input buses', async () => {
    const { pack, plan } = ebfLine();
    const layout = await layFeed(pack, plan, 'enderio');
    // a second LV input bus in place of the coil casing above the first
    Object.assign(blockAt(layout, [3, 65, 3]), { role: 'hatch', block: { id: 'gregtech:gt.blockmachines', meta: 0, mteId: IDS.INPUT_BUS_LV }, label: 'Input Bus (LV)', facing: 3, hatch: 'input_bus' });
    const m = readLine({ pack, plan, layout });
    const ebf = m.nodes.find((n): n is MultiNode => n.kind === 'multi')!;
    const findings = precheckFeeding(m, pack);
    expect(findings.map(brief)).toEqual([`feed_overfill risk - ${ebf.label}`, `feed_overfill risk - ${ebf.label}`, `feed_crowded risk - ${ebf.label}`]);
    expect(texts(findings)).toEqual([
      `Input Bus (LV) at 3 64 3 of ${ebf.label} takes 2 kinds of item without Limiting mode: one kind can fill every slot of the bus`,
      `Input Bus (LV) at 3 65 3 of ${ebf.label} takes 2 kinds of item without Limiting mode: one kind can fill every slot of the bus`,
      `${ebf.label} has 2 input buses with Input Separation on: each bus is checked alone, so a recipe whose items arrive on different buses never starts`,
    ]);
    // the controller's own setting beats the class's default, both ways
    ebf.inputSeparation = false;
    expect(precheckFeeding(m, pack).map((f) => f.code)).toEqual(['feed_overfill', 'feed_overfill']);
    ebf.inputSeparation = null;
    ebf.separationDefault = false;
    expect(precheckFeeding(m, pack).map((f) => f.code)).toEqual(['feed_overfill', 'feed_overfill']);
    ebf.inputSeparation = true;
    expect(precheckFeeding(m, pack).map((f) => f.code)).toEqual(['feed_overfill', 'feed_overfill', 'feed_crowded']);
  });

  it('says why an Item Extractor Chip does not let an output out', async () => {
    const { pack, plan } = chain2();
    const layout = await layLegacy(pack, plan, 'routed');
    blockAt(layout, [3, 64, 2]).feed = { chips: [responderOf('t:a@0'), { kind: 'extractor', filter: { mode: 'blacklist', keys: ['t:x@0'] } }] };
    blockAt(layout, [4, 64, 2]).feed = { chips: [extractorOf('t:y@0')] };
    const noRoute = precheckFeeding(readLine({ pack, plan, layout }), pack).filter((f) => f.code === 'feed_no_route');
    expect(texts(noRoute)).toEqual([
      'Nothing takes Ex out of Basic Macerator at 3 64 1: its Item Extractor Chip blacklists it',
      'Nothing takes Ex out of Basic Macerator at 4 64 3: its Item Extractor Chip does not list it',
      'Nothing takes Why out of Advanced Assembler at 5 64 1: its Item Extractor Chip has an empty whitelist (a new chip extracts nothing)',
    ]);
    // a machine with no Item Extractor Chip at all is left to the simulation: there is no chip to blame
    blockAt(layout, [4, 64, 2]).feed = { chips: [responderOf('t:a@0')] };
    expect(precheckFeeding(readLine({ pack, plan, layout }), pack).filter((f) => f.code === 'feed_no_route').map((f) => f.machine))
      .toEqual(['Basic Macerator at 3 64 1', 'Advanced Assembler at 5 64 1']);
  });

  it('reads a multiblock\'s outputs from its output buses only, and raises each finding once', async () => {
    const { pack, plan } = ebfLine();
    const layout = await layLegacy(pack, plan, 'routed');
    // the pipe on the input bus lists the EBF's output; the pipe on the output bus (main's bare chip) does not
    blockAt(layout, [3, 64, 4]).feed = { chips: [responderOf('t:a@0'), extractorOf('t:x@0')] };
    const m = readLine({ pack, plan, layout });
    const ebf = m.nodes.find((n) => n.kind === 'multi')!;
    const findings = precheckFeeding(m, pack);
    // node order, then rule order: R3, R5a, R5c, R5d
    expect(findings.map(brief)).toEqual([
      `feed_overfill risk - ${ebf.label}`, `feed_no_route certain t:x@0 ${ebf.label}`, `feed_churn certain - ${ebf.label}`, `feed_starved certain t:a@0 ${ebf.label}`,
    ]);
    expect(findings[1]!.text).toBe(`Nothing takes Ex out of ${ebf.label}: its Item Extractor Chip has an empty whitelist (a new chip extracts nothing)`);
    expect(findings[3]!.text).toBe(`${ebf.label} never gets Alpha: the Item Extractor Chip on Chest (input) at 4 64 3 has an empty whitelist (a new chip extracts nothing)`);
  });

  it('names the chest whose chip keeps a supply item in', async () => {
    const { pack, plan } = chain2();
    const layout = await layFeed(pack, plan, 'routed');
    const starved = () => precheckFeeding(readLine({ pack, plan, layout }), pack).filter((f) => f.code === 'feed_starved');
    blockAt(layout, [6, 65, 1]).feed = { chips: [extractorOf('t:y@0')] };
    expect(texts(starved())).toEqual([
      'Basic Macerator at 3 64 1 never gets Alpha: the Item Extractor Chip on Chest (input) at 6 64 1 does not list it',
      'Basic Macerator at 4 64 3 never gets Alpha: the Item Extractor Chip on Chest (input) at 6 64 1 does not list it',
    ]);
    blockAt(layout, [6, 65, 1]).feed = { chips: [extractorOf('t:a@0', 't:y@0')] };
    expect(starved()).toEqual([]);
    // a chest without any extractor chip has none to blame
    blockAt(layout, [6, 65, 1]).feed = { chips: [] };
    expect(starved()).toEqual([]);
  });

  it('leaves out an extractor that lists only outputs and a broadcaster that offers only outputs', async () => {
    const { pack, plan } = chain2();
    const layout = await layFeed(pack, plan, 'routed');
    const chips = (broadcast: RoutedChipSpec): { chips: RoutedChipSpec[] } => ({ chips: [responderOf('t:a@0'), extractorOf('t:x@0'), broadcast] });
    blockAt(layout, [3, 64, 2]).feed = chips({ kind: 'broadcaster', filter: whitelist('t:x@0') });
    const risks = () => precheckFeeding(readLine({ pack, plan, layout }), pack).filter((f) => f.machine === 'Basic Macerator at 3 64 1' && f.certainty === 'risk');
    expect(risks()).toEqual([]);
    // a broadcaster that lists an input offers it; one with no filter is a new one, a blacklist, that offers everything
    blockAt(layout, [3, 64, 2]).feed = chips({ kind: 'broadcaster', filter: whitelist('t:x@0', 't:a@0') });
    expect(risks().map(brief)).toEqual(['feed_starved risk - Basic Macerator at 3 64 1']);
    blockAt(layout, [3, 64, 2]).feed = chips({ kind: 'broadcaster' });
    expect(risks().map(brief)).toEqual(['feed_starved risk - Basic Macerator at 3 64 1']);
    // a blacklist of the input offers only the output
    blockAt(layout, [3, 64, 2]).feed = chips({ kind: 'broadcaster', filter: { mode: 'blacklist', keys: ['t:a@0'] } });
    expect(risks()).toEqual([]);
  });

  it('orders a node\'s findings by rule and then by item key', async () => {
    const { pack, plan } = feedPlan([{ id: 'c', mteId: IDS.MACERATOR, count: 1, inputs: [['t:a@0', 1]], outputs: [['t:y@0', 1], ['t:x@0', 1]] }]);
    const m = readLine({ pack, plan, layout: await layLegacy(pack, plan, 'routed') });
    const label = m.nodes.find((n) => n.kind === 'basic')!.label;
    expect(precheckFeeding(m, pack).map(brief)).toEqual([`feed_no_route certain t:x@0 ${label}`, `feed_no_route certain t:y@0 ${label}`, `feed_starved certain t:a@0 ${label}`]);
  });

  it('counts what takes an item away from its maker', async () => {
    const { pack, plan } = chain2();
    const layout = await layFeed(pack, plan, 'routed');
    const findings = (setup: () => void) => {
      setup();
      return precheckFeeding(readLine({ pack, plan, layout }), pack).filter((f) => f.text.startsWith('Nothing on the routed network'));
    };
    // the assembler's pipe stops answering for Ex: both macerators have nowhere to put it
    const noResponder = () => { blockAt(layout, [5, 64, 2]).feed = { chips: [extractorOf('t:y@0')] }; };
    expect(texts(findings(noResponder))).toEqual([
      'Nothing on the routed network takes Ex from Basic Macerator at 3 64 1: no Item Responder Chip lists it',
      'Nothing on the routed network takes Ex from Basic Macerator at 4 64 3: no Item Responder Chip lists it',
    ]);
    // a terminator or overflow responder takes it too, and so does a stock keeper that keeps it
    for (const chip of [{ kind: 'terminator', filter: whitelist('t:x@0') }, { kind: 'overflow' }, { kind: 'stock_keeper', stock: [{ key: 't:x@0', count: 4 }] }] as RoutedChipSpec[]) {
      expect(findings(() => { blockAt(layout, [5, 64, 2]).feed = { chips: [extractorOf('t:y@0'), chip] }; })).toEqual([]);
    }
    // a responder for another item does not
    expect(findings(() => { blockAt(layout, [5, 64, 2]).feed = { chips: [responderOf('t:b@0'), extractorOf('t:y@0')] }; })).toHaveLength(2);
    // a responder on the maker's own pipe does not take it from that maker, but it takes it from the other macerator
    const own = () => {
      blockAt(layout, [3, 64, 2]).feed = { chips: [responderOf('t:x@0'), extractorOf('t:x@0')] };
      blockAt(layout, [4, 64, 2]).feed = { chips: [extractorOf('t:x@0')] };
      blockAt(layout, [5, 64, 2]).feed = { chips: [extractorOf('t:y@0')] };
    };
    expect(texts(findings(own))).toEqual(['Nothing on the routed network takes Ex from Basic Macerator at 3 64 1: no Item Responder Chip lists it']);
  });

  it('names every step with no machine that an item goes to', async () => {
    const flows: PlanFlow[] = [
      { from: 'raw', to: 's1', key: 't:a@0', perSecond: 1 }, { from: 's1', to: 'h1', key: 't:x@0', perSecond: 1 }, { from: 's1', to: 'h2', key: 't:x@0', perSecond: 1 },
      { from: 'h1', to: 'out', key: 't:y@0', perSecond: 1 }, { from: 'h2', to: 'out', key: 't:c@0', perSecond: 1 },
    ];
    const { pack, plan } = feedPlan([
      { id: 's1', mteId: IDS.MACERATOR, count: 1, inputs: [['t:a@0', 1]], outputs: [['t:x@0', 1]] },
      { id: 'h1', mteId: -1, count: 1, handCraft: true, inputs: [['t:x@0', 1]], outputs: [['t:y@0', 1]] },
      { id: 'h2', mteId: -1, count: 1, handCraft: true, inputs: [['t:x@0', 1]], outputs: [['t:c@0', 1]] },
    ], flows);
    const layout = await layLegacy(pack, plan, 'routed');
    blockAt(layout, [1, 64, 2]).feed = { chips: [responderOf('t:a@0'), extractorOf('t:x@0')] };
    const findings = precheckFeeding(readLine({ pack, plan, layout }), pack).filter((f) => f.text.startsWith('Nothing on the routed network'));
    expect(texts(findings)).toEqual(['Nothing on the routed network takes Ex from Basic Macerator at 1 64 1: no Item Responder Chip lists it (it goes to Why and Gamma, which have no machine)']);
  });

  it('finds held items and circuits in a pattern, and a plain interface\'s Fluid Packet', async () => {
    const f = feedPlan([{ id: 'f', mteId: IDS.SOLIDIFIER, count: 1, inputs: [['fluid:molten.iron', 144]], held: [MOLD], outputs: [['t:x@0', 1]] }]);
    const layout = await layFeed(f.pack, f.plan, 'ae2');
    const iface = labelled(layout, 'ME Interface (Basic Fluid Solidifier)');
    const pattern = { inputs: [{ key: MOLD, amount: 1 }, { key: CIRCUIT, amount: 1 }, { key: 'fluid:molten.iron', amount: 144 }], outputs: [{ key: 't:x@0', amount: 1 }, { key: 'fluid:oxygen', amount: 1000 }] };
    iface.feed = { interface: { patterns: [pattern], blocking: false, dual: true } };
    const m = readLine({ pack: f.pack, plan: f.plan, layout });
    const label = m.nodes.find((n) => n.kind === 'basic')!.label;
    const findings = precheckFeeding(m, f.pack);
    // R8a (inputs and outputs, by key), then R8c (by key); a Dual Interface keeps fluids as fluids, so no Fluid Packet
    expect(findings.map(brief)).toEqual([
      `feed_pattern_unencodable certain fluid:molten.iron ${label}`, `feed_pattern_unencodable certain fluid:oxygen ${label}`,
      `feed_pattern_unencodable certain ${CIRCUIT} ${label}`, `feed_pattern_unencodable certain ${MOLD} ${label}`,
    ]);
    expect(texts(findings)).toEqual([
      `The pattern for ${label} lists Molten Iron, a fluid the line pipes: ME never holds it, so AE2 cannot plan with it`,
      `The pattern for ${label} makes Oxygen, which the line pipes away: it never comes back to ME`,
      `The pattern for ${label} lists ${m.nameOf(CIRCUIT)}, which ${label} keeps and does not use up`,
      `The pattern for ${label} lists ${m.nameOf(MOLD)}, which ${label} keeps and does not use up`,
    ]);
    // a plain interface turns the input fluid into a Fluid Packet item (the output fluid is not one)
    iface.feed = { interface: { patterns: [pattern], blocking: false } };
    expect(precheckFeeding(readLine({ pack: f.pack, plan: f.plan, layout }), f.pack).filter((x) => x.code === 'feed_fluid_packet').map(brief))
      .toEqual([`feed_fluid_packet risk fluid:molten.iron ${label}`]);
  });

  it('keeps a bench whose interface has blocking mode on from being pushed into', async () => {
    const { pack, plan, layout } = await benchAway('ae2');
    const iface = labelled(layout, 'ME Interface (Auto Workbench (MV))');
    const pattern = { inputs: [{ key: 't:a@0', amount: 2 }, { key: 't:b@0', amount: 2 }], outputs: [{ key: 't:x@0', amount: 1 }] };
    iface.feed = { interface: { patterns: [pattern], blocking: true } };
    const m = readLine({ pack, plan, layout });
    const label = m.nodes.find((n) => n.kind === 'bench')!.label;
    const findings = precheckFeeding(m, pack);
    // R9, then R10a (no Locking Card)
    expect(findings.map(brief)).toEqual([`feed_starved certain - ${label}`, `feed_overfill risk - ${label}`]);
    expect(texts(findings)).toEqual([
      `ME Interface (Auto Workbench (MV)) at 1 64 2 has blocking mode on and ${label}'s crafting grid counts as items: it never pushes into it`,
      `ME Interface (Auto Workbench (MV)) at 1 64 2 has no Locking Card: a pattern that differs from ${label}'s grid pushes the whole job into it`,
    ]);
    // the Locking Card on "Until crafting result is returned" caps it
    iface.feed = { interface: { patterns: [pattern], blocking: false, lock: 'until_result' } };
    expect(precheckFeeding(readLine({ pack, plan, layout }), pack)).toEqual([]);
  });

  it('caps a routed bench with a Stock Keeper, not a responder', async () => {
    const { pack, plan, layout } = await benchAway('routed', true);
    // main's chips before fix/feeding: a responder answers with the room of all nine slots (and the bare extractors move nothing)
    const label = readLine({ pack, plan, layout }).nodes.find((n) => n.kind === 'bench')!.label;
    const today = precheckFeeding(readLine({ pack, plan, layout }), pack);
    expect(today.map(brief)).toEqual([`feed_no_route certain t:x@0 ${label}`, `feed_starved certain t:a@0 ${label}`, `feed_overfill certain - ${label}`]);
    expect(today[2]!.text).toBe(`${label} is fed by an Item Responder Chip, which answers with the room of all nine input slots`);

    const keeper = (stock: Array<{ key: string; count: number }>) => ({ kind: 'stock_keeper' as const, stock });
    const run = (stock: Array<{ key: string; count: number }>, grid?: Array<string | null>) => {
      blockAt(layout, [1, 64, 2]).feed = { chips: [keeper(stock), extractorOf('t:x@0')] };
      blockAt(layout, [2, 65, 1]).feed = { chips: [extractorOf('t:a@0', 't:b@0')] };
      if (grid !== undefined) machineBlock(layout, 'b').feed = { bench: { mode: 'normal', grid, throughput: 0 } };
      return precheckFeeding(readLine({ pack, plan, layout }), pack);
    };
    // 4 of each is two crafts: nothing to say
    expect(run([{ key: 't:a@0', count: 4 }, { key: 't:b@0', count: 4 }])).toEqual([]);
    // one Alpha is less than a craft (a craft takes 2); 100 Beta is more than a stack
    const out = run([{ key: 't:a@0', count: 1 }, { key: 't:b@0', count: 100 }]);
    expect(out.map(brief)).toEqual([`feed_overfill risk t:a@0 ${label}`, `feed_overfill risk t:b@0 ${label}`]);
    expect(texts(out)).toEqual([`${label} keeps 1× Alpha for 2 a craft: less than one craft`, `${label} keeps 100× Beta for 2 a craft: more than a stack`]);
    // nine items at a stack each need nine input slots; slot 8 must stay empty
    const grid = Array.from({ length: 9 }, (_, i) => `t:g${i}@0`);
    const nine = run(grid.map((key) => ({ key, count: 64 })), grid);
    expect(nine.filter((f) => f.text.includes(' keeps '))).toHaveLength(1);
    const slots = nine.find((f) => f.text.includes(' keeps '))!;
    expect(slots).toMatchObject({ code: 'feed_overfill', certainty: 'risk', key: 't:g8@0' });
    expect(slots.text).toBe(`${label} keeps 64× t:g8@0 for 1 a craft: its stock needs 9 input slots, more than 8, so a failed craft throws out its last input slot`);
    // eight is the most
    expect(run(grid.slice(0, 8).map((key) => ({ key, count: 64 })), grid.slice(0, 8)).filter((f) => f.text.includes(' keeps '))).toEqual([]);
  });

  it('checks the counts of a Limited Item Filter and names the filter that caps nothing', async () => {
    const { pack, plan, layout } = await benchAway('enderio');
    const bench = machineBlock(layout, 'b');
    const conduit = layout.blocks.find((b) => b.conduits !== undefined && b.conduits.some((c) => c.faces.some((f) => f.target === bench.label)))!;
    const face = conduit.conduits![0]!.faces.find((f) => f.target === bench.label)!;
    const run = (filter: FeedConduitFilter | null) => {
      face.insert!.filter = filter;
      return precheckFeeding(readLine({ pack, plan, layout }), pack);
    };
    const label = readLine({ pack, plan, layout }).nodes.find((n) => n.kind === 'bench')!.label;
    // the grid holds 2 of each, so a count of 2 leaves no stock, and 200 leaves 198, more than a stack
    const counted = run({ item: PART_KEYS.limitedFilter, whitelist: true, keys: ['t:a@0', 't:b@0'], limits: [2, 200] });
    expect(texts(counted)).toEqual([`${label} keeps 0× Alpha for 2 a craft: less than one craft`, `${label} keeps 198× Beta for 2 a craft: more than a stack`]);
    // counts add up over the filter's slots (Alpha is in two)
    expect(run({ item: PART_KEYS.limitedFilter, whitelist: true, keys: ['t:a@0', 't:a@0', 't:b@0'], limits: [2, 2, 5] })).toEqual([]);
    // the filters that cap nothing, by name; a Limited Item Filter without counts is one of them
    const capOf = (item: string | undefined) => texts(run({ ...(item === undefined ? {} : { item }), whitelist: true, keys: ['t:a@0', 't:b@0'] }));
    expect(capOf('EnderIO:itemBasicFilterUpgrade@1')).toEqual([`${label} takes its ingredients through an Advanced Item Filter, which does not cap amounts: one ingredient can fill all nine input slots`]);
    expect(capOf('EnderIO:itemBigFilterUpgrade@0')[0]).toContain('through a Big Item Filter, which');
    expect(capOf(PART_KEYS.limitedFilter)[0]).toContain('through a Limited Item Filter, which');
    expect(texts(run(null))[0]).toContain('through a face with no item filter, which');
  });

  it('finds the faces and pipes that touch a bench', async () => {
    const { pack, plan } = benchLine();
    const layout = await layFeed(pack, plan, 'enderio');
    // the cable west of it becomes a GT item pipe linked toward it; its conduit bundle gets an ender fluid conduit face toward it
    Object.assign(blockAt(layout, [0, 64, 1]), { role: 'pipe', block: { id: 'gregtech:gt.blockmachines', meta: 0, mteId: IDS.TIN_ITEM_PIPE }, connections: 1 << 5 });
    blockAt(layout, [1, 64, 2]).conduits!.push({ kind: 'liquid_ender', item: 'EnderIO:itemLiquidConduit@2', connections: 0, faces: [{ face: 'north', mode: 'insert', target: 'Auto Workbench (MV)' }] });
    const m = readLine({ pack, plan, layout });
    const label = m.nodes.find((n) => n.kind === 'bench')!.label;
    const findings = precheckFeeding(m, pack);
    expect(findings.map(brief)).toEqual([
      `feed_overfill certain - ${label}`, `feed_bench_stuck certain - ${label}`, `feed_starved certain - ${label}`, `feed_overfill risk - ${label}`, `feed_overfill certain - ${label}`,
    ]);
    expect(findings[3]!.text).toBe(`${label} has a fluid conduit on its front: its tank takes any fluid and fills containers into its input slots`);
    expect(findings[4]!.text).toBe(`A GT item pipe touches ${label}: it fills all nine input slots with whatever it carries`);
  });

  it('names the side of a bench as its builder sees it', async () => {
    const { pack, plan } = benchLine();
    const m = readLine({ pack, plan, layout: await layFeed(pack, plan, 'direct') });
    const bench = m.nodes.find((n): n is BenchNode => n.kind === 'bench')!;
    // facing south (side 3): its back is north, its left east and its right west
    bench.fluidSides = [0, 1, 2, 3, 4, 5];
    const sides = precheckFeeding(m, pack).filter((f) => f.text.includes(' has a fluid '));
    expect(sides.map((f) => f.text.replace(`${bench.label} has a fluid pipe on its `, '').replace(/: .*/, ''))).toEqual(['bottom', 'top', 'back', 'front', 'right side', 'left side']);
    // without a front, left and right are not defined
    bench.front = -1;
    bench.back = -1;
    expect(precheckFeeding(m, pack).filter((f) => f.text.includes(' has a fluid ')).map((f) => f.text.replace(`${bench.label} has a fluid pipe on its `, '').replace(/: .*/, '')))
      .toEqual(['bottom', 'top', 'side', 'side', 'side', 'side']);
  });

  it('says a bench\'s back touches nothing when no network is there at all', async () => {
    const { pack, plan } = benchLine();
    const m = readLine({ pack, plan, layout: await layFeed(pack, plan, 'enderio') });
    m.networks = [];
    expect(precheckFeeding(m, pack).map((f) => f.code)).toEqual(['feed_bench_stuck', 'feed_starved']);
    // another cable that connects to it, on a side that takes EU, makes the one on its back harmless
    const bench = m.nodes.find((n): n is BenchNode => n.kind === 'bench')!;
    bench.powerSides = [bench.back, 4];
    expect(precheckFeeding(m, pack).map((f) => f.code)).toEqual(['feed_bench_stuck']);
    // a bench whose front is unknown can say nothing about its back
    bench.front = -1;
    bench.back = -1;
    expect(precheckFeeding(m, pack)).toEqual([]);
  });

  it('names the mode of a machine shared by two steps', async () => {
    const run = async (mode: 'direct' | 'enderio') => {
      const { pack, plan } = feedPlan([
        { id: 'p1', mteId: IDS.MACERATOR, count: 1, inputs: [['t:a@0', 1]], outputs: [['t:x@0', 1]] },
        { id: 'p2', mteId: IDS.MACERATOR, count: 1, inputs: [['t:b@0', 1]], outputs: [['t:y@0', 1]] },
      ]);
      const layout = await layFeed(pack, plan, mode);
      machineBlock(layout, 'p1').stepIds = ['p1', 'p2'];
      layout.blocks = layout.blocks.filter((b) => b.stepId !== 'p2');
      return precheckFeeding(readLine({ pack, plan, layout }), pack).filter((f) => f.code === 'feed_pool_starve');
    };
    expect((await run('direct'))[0]!.text).toContain(' recipes in machine-to-machine: ');
    expect((await run('enderio'))[0]!.text).toContain(' recipes in EnderIO: ');
  });

  it('names the buses an interface touches', async () => {
    const { pack, plan } = ebfLine();
    const layout = await layFeed(pack, plan, 'ae2');
    layout.blocks.push({ pos: [3, 65, 4], block: { id: 'minecraft:chest', meta: 0 }, role: 'chest', label: 'Chest', tail: { side: 'output', keys: [] } });
    const m = readLine({ pack, plan, layout });
    const leaks = precheckFeeding(m, pack).filter((f) => f.code === 'feed_leak');
    expect(leaks.map(brief)).toEqual(['feed_leak risk - Electric Blast Furnace at 2 64 3']);
    expect(leaks[0]!.text).toBe(
      "ME Interface (Electric Blast Furnace) at 3 64 4 pushes into 2 inventories (Chest at 3 65 4 and Input Bus (LV) at 3 64 3): its pattern's items can reach the wrong one");
  });

  it('treats an item a machine holds as one its chips must not list', async () => {
    const { pack, plan } = feedPlan([{ id: 'f', mteId: IDS.SOLIDIFIER, count: 1, inputs: [['fluid:molten.iron', 144]], held: [MOLD], outputs: [['t:x@0', 1]] }]);
    const layout = await layFeed(pack, plan, 'routed');
    // a new broadcaster is a blacklist: it offers the mold the solidifier holds, and so does an extractor that lists it
    labelled(layout, 'Routed Interface Pipe (Basic Fluid Solidifier)').feed = {
      chips: [{ kind: 'extractor', filter: { mode: 'blacklist', keys: [] } }, { kind: 'broadcaster', filter: whitelist(MOLD) }],
    };
    const m = readLine({ pack, plan, layout });
    const label = m.nodes.find((n) => n.kind === 'basic')!.label;
    const risks = precheckFeeding(m, pack).filter((f) => f.certainty === 'risk');
    expect(risks.map(brief)).toEqual([`feed_starved risk ${MOLD} ${label}`, `feed_starved risk - ${label}`]);
    expect(risks[0]!.text).toBe(`The Item Extractor Chip on ${label} also lists ${m.nameOf(MOLD)}, which it cannot take back out: each time it tries it first, it gives up the whole update`);
  });

  it('raises one finding for what two patterns or two pipes show twice', async () => {
    // two patterns of one interface list the same fluid
    const f = feedPlan([{ id: 'f', mteId: IDS.SOLIDIFIER, count: 1, inputs: [['fluid:molten.iron', 144]], held: [MOLD], outputs: [['t:x@0', 1]] }]);
    const layout = await layFeed(f.pack, f.plan, 'ae2');
    const pattern = { inputs: [{ key: 'fluid:molten.iron', amount: 144 }], outputs: [{ key: 't:x@0', amount: 1 }] };
    labelled(layout, 'ME Interface (Basic Fluid Solidifier)').feed = { interface: { patterns: [pattern, pattern], blocking: false } };
    expect(precheckFeeding(readLine({ pack: f.pack, plan: f.plan, layout }), f.pack).map((x) => x.code)).toEqual(['feed_pattern_unencodable', 'feed_fluid_packet']);
    // a pattern amount a hair off a whole number is whole
    labelled(layout, 'ME Interface (Basic Fluid Solidifier)').feed = { interface: { patterns: [{ inputs: [], outputs: [{ key: 't:x@0', amount: 1 + 1e-12 }] }], blocking: false } };
    expect(precheckFeeding(readLine({ pack: f.pack, plan: f.plan, layout }), f.pack)).toEqual([]);

    // two pipes on one output bus carry the same bare extractor (ruling R-9)
    const { pack, plan } = ebfLine();
    const m = readLine({ pack, plan, layout: await layLegacy(pack, plan, 'routed') });
    const net = m.networks.find((n) => n.kind === 'routed')!;
    if (net.kind !== 'routed') throw new Error('no routed network');
    const outBusPipe = net.pipes.find((p) => p.target?.bus === '1,0,3')!;
    net.pipes.push({ ...outBusPipe, id: 'dup', label: 'Routed Interface Pipe (copy)' });
    expect(precheckFeeding(m, pack).filter((x) => x.code === 'feed_no_route').map(brief)).toEqual(['feed_no_route certain t:x@0 Electric Blast Furnace at 2 64 3']);
  });

  it('keeps to the routed network the maker is on', async () => {
    const { pack, plan } = chain2();
    const layout = await layFeed(pack, plan, 'routed');
    blockAt(layout, [5, 64, 2]).feed = { chips: [extractorOf('t:y@0')] };
    const m = readLine({ pack, plan, layout });
    // a second network, touching no machine of the line, whose one pipe would answer for Ex
    m.networks.push({ kind: 'routed', hops: {}, pipes: [{ id: '90,0,0', label: 'Routed Interface Pipe (elsewhere)', chips: [responderOf('t:x@0')], target: { node: '5,0,1', side: 3 } }] });
    const noRoute = precheckFeeding(m, pack).filter((f) => f.text.startsWith('Nothing on the routed network'));
    // the assembler is on that network, but the macerators are not: it takes Ex from nobody on their network
    expect(noRoute.map((f) => f.machine)).toEqual(['Basic Macerator at 3 64 1', 'Basic Macerator at 4 64 3']);
  });

  it('counts the held items of every recipe against the kinds of the largest', async () => {
    const { pack, plan } = chain2();
    const m = readLine({ pack, plan, layout: await layFeed(pack, plan, 'enderio') });
    const node = m.nodes.find((n): n is BasicNode => n.kind === 'basic' && n.stepIds[0] === 's2')!;
    const recipe = node.recipes[0]!;
    const take = (...keys: string[]) => keys.map((key) => ({ key, amount: 1, chance: 1 }));
    // a 3-slot machine shared by A (2 kinds) and B (1 kind, and 2 held items that stay in their slots when A runs)
    node.inSlots = 3;
    node.recipes = [{ ...recipe, stepId: 'b', inputs: take('t:c@0'), held: ['t:x@0', 't:y@0'] }, { ...recipe, stepId: 'a', inputs: take('t:a@0', 't:b@0'), held: [] }];
    node.kinds = ['t:a@0', 't:b@0', 't:c@0'];
    node.settings.multiStack = false;
    const crowded = () => precheckFeeding(m, pack).filter((f) => f.code === 'feed_crowded').map((f) => [f.certainty, f.text]);
    expect(crowded()).toEqual([['certain', `${node.label} takes 2 kinds of item but has 1 input slot free (2 held: Ex and Why): one kind always waits`]]);
    // with a slot more, A's 2 kinds fit beside B's 2 held items
    node.inSlots = 4;
    expect(crowded()).toEqual([]);
    // one kind is "1 kind", and more held items than slots leave none, not a negative number
    node.inSlots = 3;
    node.recipes = [{ ...recipe, stepId: 'a', inputs: take('t:a@0'), held: ['t:x@0', 't:y@0', 't:c@0', 't:b@0', 't:x@0'] }];
    expect(crowded().map(([, text]) => text)).toEqual([`${node.label} takes 1 kind of item but has 0 input slots free (5 held: Ex, Why, Gamma and Beta): one kind always waits`]);
  });

  it('reports the same findings in every rotation', async () => {
    // the lines main laid before fix/feeding, whose routed line has findings to turn, and main's lines now, which have none
    for (const lay of [layLegacy, layFeed]) {
      for (const mode of ['direct', 'routed', 'ae2', 'enderio'] as const) {
        const views: unknown[][] = [];
        for (const rotation of [0, 90, 180, 270] as const) {
          const { pack, plan } = chain2();
          const layout = await lay(pack, plan, mode, { origin: [30, 64, 10], rotation });
          const findings = precheckFeeding(readLine({ pack, plan, layout }), pack);
          views.push(findings.map((f) => [f.code, f.certainty, f.key, f.stepId, fromWorld(f.pos, layout)]));
        }
        expect(views.slice(1)).toEqual([views[0], views[0], views[0]]);
        if (lay === layLegacy && mode === 'routed') expect(views[0]!.length).toBeGreaterThan(0);
      }
    }
  });

  it('gives the same findings every run, as plain data', async () => {
    const { pack, plan } = chain2();
    const m = readLine({ pack, plan, layout: await layLegacy(pack, plan, 'routed') });
    const first = precheckFeeding(m, pack);
    expect(first.length).toBeGreaterThan(0);
    expect(precheckFeeding(m, pack)).toEqual(first);
    expect(JSON.parse(JSON.stringify(first))).toEqual(first);
    // a finding holds no reference into the model
    first[0]!.pos[0] = -1;
    expect(precheckFeeding(m, pack)[0]!.pos[0]).not.toBe(-1);
    expect(m.nodes[0]!.pos[0]).not.toBe(-1);
  });
});

// ---- the lines main lays now: fix/feeding's structured feed and settings (architecture §11 entry 51; ruling R-28's twins) ----

describe('precheckFeeding on the lines main lays now', () => {
  /** Both kinds flow into the step: the smelter (Alpha and 4 Beta → Ex) and the EBF (Alpha and Beta → Ex). */
  const smelterBoth = () => feedPlan([{ id: 'sm', mteId: FEED_IDS.SMELTER, count: 1, inputs: [['t:a@0', 1], ['t:b@0', 4]], outputs: [['t:x@0', 1]] }], [
    { from: 'raw', to: 'sm', key: 't:a@0', perSecond: 1 }, { from: 'raw', to: 'sm', key: 't:b@0', perSecond: 4 }, { from: 'sm', to: 'out', key: 't:x@0', perSecond: 1 },
  ]);
  const ebfBoth = () => feedPlan([{ id: 'e', mteId: IDS.EBF, count: 1, inputs: [['t:a@0', 1], ['t:b@0', 1]], outputs: [['t:x@0', 1]] }], [
    { from: 'raw', to: 'e', key: 't:a@0', perSecond: 1 }, { from: 'raw', to: 'e', key: 't:b@0', perSecond: 1 }, { from: 'e', to: 'out', key: 't:x@0', perSecond: 1 },
  ]);
  const findings = async (line: { pack: Pack; plan: Plan }, mode: 'routed' | 'ae2' | 'enderio') =>
    precheckFeeding(readLine({ pack: line.pack, plan: line.plan, layout: await layFeed(line.pack, line.plan, mode) }), line.pack).map(brief);

  it('finds that the routed and AE2 lines main lays move what they make (R5a, R5d, R6, R8, R9)', async () => {
    expect(await findings(chain2(), 'routed')).toEqual([]);
    expect(await findings(chain2(), 'ae2')).toEqual([]);
    // what goes to a step with no machine reaches the output chest's Item Terminator Chip
    const nowhere = feedPlan([
      { id: 's1', mteId: IDS.MACERATOR, count: 1, inputs: [['t:a@0', 1]], outputs: [['t:x@0', 1]] },
      { id: 'h', mteId: -1, count: 1, handCraft: true, inputs: [['t:x@0', 1]], outputs: [['t:y@0', 1]] },
    ]);
    expect(await findings(nowhere, 'routed')).toEqual([]);
  });

  it('finds Multi Stack Input, Limiting mode and the input bus\'s chips set where main sets them (R2, R3, R5c)', async () => {
    for (const mode of ['routed', 'ae2', 'enderio'] as const) {
      expect([mode, await findings(smelterBoth(), mode)]).toEqual([mode, []]);
      expect([mode, await findings(ebfBoth(), mode)]).toEqual([mode, []]);
    }
  });

  it('finds the patterns main encodes encodable (R8)', async () => {
    // the pattern holds the outputs of chance 1 only
    const c = feedPlan([{ id: 'c', mteId: IDS.MACERATOR, count: 1, inputs: [['t:a@0', 1]], outputs: [['t:x@0', 1], ['t:y@0', 1]], chances: { 't:y@0': 0.5 } }]);
    expect(await findings(c, 'ae2')).toEqual([]);
    // a machine that takes only a fluid the line pipes gets no pattern: main says so itself (ae2_no_pattern)
    const f = feedPlan([{ id: 'f', mteId: IDS.SOLIDIFIER, count: 1, inputs: [['fluid:molten.iron', 144]], held: [MOLD], outputs: [['t:x@0', 1]] }]);
    const layout = await layFeed(f.pack, f.plan, 'ae2');
    expect(precheckFeeding(readLine({ pack: f.pack, plan: f.plan, layout }), f.pack)).toEqual([]);
    expect(layout.warnings.map((w) => w.code)).toContain('ae2_no_pattern');
  });
});

describe('text helpers', () => {
  it('writes amounts as the layout does', () => {
    expect(amountText(1286400)).toBe('1,286,400');
    expect(amountText(0.5)).toBe('0.50');
    expect(amountText(2.5)).toBe('2.50');
    expect(amountText(0.1 + 0.2)).toBe('0.30');
    expect(amountText(3.0000000001)).toBe('3');
    expect(amountText(-0.0000000001)).toBe('0');
  });

  it('lists names and counts slots', () => {
    expect(listText([])).toBe('');
    expect(listText(['A'])).toBe('A');
    expect(listText(['A', 'B'])).toBe('A and B');
    expect(listText(['A', 'B', 'C'])).toBe('A, B and C');
    expect([0, 1, 2, 9].map(slotWord)).toEqual(['0 input slots', '1 input slot', '2 input slots', '9 input slots']);
  });
});
