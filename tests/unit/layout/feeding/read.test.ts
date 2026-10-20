// tests/unit/layout/feeding/read.test.ts — the cases below; positions are rotation 0 at origin [0, 64, 0] unless a case says otherwise
import { describe, expect, it } from 'vitest';
import { readLine } from '../../../../src/server/layout/feeding/read.ts';
import { fromWorld } from '../../../../src/server/layout/feeding/frame.ts';
import type { RoutedNet, Ae2Net, EioNet, GtPipeNet, BasicNode, BenchNode, FeedModel, FeedNetwork, MultiNode } from '../../../../src/server/layout/feeding/model.ts';
import type { FeedBlock, FeedConduitFilter } from '../../../../src/server/layout/feeding/contract.ts';
import { PART_KEYS } from '../../../../src/server/layout/feeding/facts.ts';
import { OPPOSITE, posKey, rotateFace, type Vec3 } from '../../../../src/shared/layout/geometry.ts';
import type { Layout, LayoutBlock } from '../../../../src/shared/types/layout.ts';
import type { PlanFlow } from '../../../../src/shared/types/plan.ts';
import { busSlots } from '../../../../src/server/layout/parts.ts';
import { chain2, feedPlan, layFeed, FEED_IDS } from '../../../helpers/feeding-fixtures.ts';
import { IDS } from '../../../helpers/layout-fixtures.ts';

/** The line's own block at world cell `pos` (no ghost, no hookup block). */
function blockAt(layout: Layout, pos: Vec3): FeedBlock {
  const b = layout.blocks.find((x) => posKey(x.pos) === posKey(pos) && x.role !== 'ghost' && x.hookup === undefined);
  if (b === undefined) throw new Error(`no block at ${posKey(pos)}`);
  return b;
}

/** The world positions of the model's unknowns of `code`, in model order. */
const unknownsAt = (m: FeedModel, code: string): Vec3[] => m.unknowns.filter((u) => u.code === code).map((u) => u.pos!);
const routedNet = (m: FeedModel): RoutedNet => m.networks.find((n): n is RoutedNet => n.kind === 'routed')!;

/** raw → s1 t:a@0, s1 → s2 t:x@0, s2 → out t:y@0, 1/s each. */
const CHAIN_FLOWS: PlanFlow[] = [
  { from: 'raw', to: 's1', key: 't:a@0', perSecond: 1 }, { from: 's1', to: 's2', key: 't:x@0', perSecond: 1 }, { from: 's2', to: 'out', key: 't:y@0', perSecond: 1 },
];
/** s1 on machine `s1Machine` (Alpha → Ex), s2 the assembler (Ex → Why), with `CHAIN_FLOWS`. */
const twoSteps = (s1Machine: number) => feedPlan([
  { id: 's1', mteId: s1Machine, count: 1, inputs: [['t:a@0', 1]], outputs: [['t:x@0', 1]] },
  { id: 's2', mteId: IDS.ASSEMBLER, tier: 2, count: 1, inputs: [['t:x@0', 1]], outputs: [['t:y@0', 1]] },
], CHAIN_FLOWS);
/** The multiblock case: an EBF taking Alpha and Beta, making Ex (the chained flows carry only Alpha in). */
const ebfLine = () => feedPlan([{ id: 'e', mteId: IDS.EBF, count: 1, inputs: [['t:a@0', 1], ['t:b@0', 1]], outputs: [['t:x@0', 1]] }]);
/** The bench case: a shaped 2 × 2 crafting recipe `t:a t:b / t:b t:a` → 1 `t:x` on the Auto Workbench. */
const benchLine = () => feedPlan([{
  id: 'b', mteId: FEED_IDS.BENCH, count: 1, inputs: [['t:a@0', 2], ['t:b@0', 2]], outputs: [['t:x@0', 1]],
  craft: { width: 2, cells: ['t:a@0', 't:b@0', 't:b@0', 't:a@0'] },
}]);
const BENCH_GRID = ['t:a@0', 't:b@0', null, 't:b@0', 't:a@0', null, null, null, null];

/** What must not change when the line turns: nodes, then each network's members and targets, then covers, all in local terms. */
function localView(m: FeedModel): unknown {
  const net = (n: FeedNetwork): unknown => {
    switch (n.kind) {
      case 'routed': return n.pipes.map((p) => [p.id, p.target, p.chips]);
      case 'enderio': return n.faces.map((f) => [f.id, f.target, f.extract?.filter?.keys, f.insert?.filter?.keys]);
      case 'ae2': return n.interfaces.map((i) => [i.id, i.targets]);
      case 'gtpipe': return n.pipes.map((p) => [p.id, p.links, p.sides]);
    }
  };
  return {
    nodes: m.nodes.map((n) => (n.kind === 'basic' ? [n.kind, n.id, n.outputSide, n.front] : [n.kind, n.id])),
    networks: m.networks.map((n) => [n.kind, net(n)]),
    covers: m.covers.map((c) => [c.host, c.side, c.kind]),
  };
}

describe('readLine', () => {
  it('reads a routed line from its chip text', async () => {
    const { pack, plan } = chain2();
    const m = readLine({ pack, plan, layout: await layFeed(pack, plan, 'routed') });
    expect(m.nodes.map((n) => `${n.kind} ${n.id}`)).toEqual(['basic 3,0,1', 'basic 4,0,3', 'basic 5,0,1', 'chest 6,0,1', 'chest 6,0,3']);
    const net = m.networks.find((n): n is RoutedNet => n.kind === 'routed')!;
    expect(net.pipes.find((p) => p.id === '3,0,2')).toMatchObject({
      target: { node: '3,0,1', side: 3 },
      chips: [{ kind: 'responder', filter: { mode: 'whitelist', keys: ['t:a@0'] } }, { kind: 'extractor', filter: { mode: 'whitelist', keys: [] } }],
    });
    expect(net.pipes.find((p) => p.id === '6,1,1')).toMatchObject({ target: { node: '6,0,1', side: 1 }, chips: [{ kind: 'extractor', filter: { mode: 'whitelist', keys: [] } }] });
    expect(net.hops['3,0,2']!['6,1,3']).toBe(5);
    expect(m.unknowns.filter((u) => u.code === 'extractor_new').map((u) => u.pos)).toEqual([[3, 64, 2], [4, 64, 2], [5, 64, 2], [6, 65, 1]]);
    expect([m.supply, m.sinks, m.planned]).toEqual([['t:a@0'], ['t:y@0'], { s1: { 't:a@0': 0.5 }, s2: { 't:x@0': 1 } }]);
    expect((m.nodes[0] as BasicNode)).toMatchObject({ inSlots: 1, outSlots: 1, outputSide: 3, front: 4, settings: { multiStack: null, inputFromOutputSide: true } });
  });

  it('reads AE2 patterns from the plan steps', async () => {
    const { pack, plan } = chain2();
    const m = readLine({ pack, plan, layout: await layFeed(pack, plan, 'ae2') });
    const nets = m.networks.filter((n): n is Ae2Net => n.kind === 'ae2');
    expect(nets).toHaveLength(1);
    expect(nets[0]!.interfaces.map((i) => i.id)).toEqual(['3,0,2', '5,0,2', '7,0,2']);
    const last = nets[0]!.interfaces[2]!;
    expect(last.targets).toEqual([{ node: '7,0,1', side: 3 }]);
    expect(last.spec).toEqual({ patterns: [{ inputs: [{ key: 't:x@0', amount: 1 }], outputs: [{ key: 't:y@0', amount: 1 }] }], blocking: false, lock: 'none' });
    expect(m.covers).toContainEqual({ host: '7,0,1', side: 3, kind: 'conveyor', export: true, allowInput: true, op: { tickRate: 100, stacks: 1, items: 16 } });
    expect(unknownsAt(m, 'ae2_pattern_text')).toEqual([[3, 64, 2], [5, 64, 2], [7, 64, 2]]);
    expect(m.nodes.filter((n) => n.kind === 'chest')).toEqual([]);
  });

  it('reads EnderIO faces', async () => {
    const { pack, plan } = chain2();
    const m = readLine({ pack, plan, layout: await layFeed(pack, plan, 'enderio') });
    const nets = m.networks.filter((n): n is EioNet => n.kind === 'enderio');
    expect(nets).toHaveLength(1);
    const face = (id: string) => nets[0]!.faces.find((f) => f.id === id);
    // 1 item/s needs no speed upgrade
    expect(face('6,0,2:2')).toMatchObject({
      target: { node: '6,0,1', side: 3 },
      extract: { color: 'red', filter: { whitelist: true, keys: ['t:a@0'] }, max: 4, roundRobin: true, selfFeed: false, redstone: 'ignore' },
    });
    // the two macerators share a conduit cell
    expect(face('3,0,2:2')).toMatchObject({ target: { node: '3,0,1', side: 3 }, insert: { priority: 1, filter: { keys: ['t:a@0'] } }, extract: { filter: { keys: ['t:x@0'] } } });
    expect(face('3,0,2:3')).toMatchObject({ target: { node: '3,0,3', side: 2 }, insert: { priority: 1, filter: { keys: ['t:a@0'] } }, extract: { filter: { keys: ['t:x@0'] } } });
    expect(nets[0]!.hops['3,0,2']!['6,0,2']).toBe(3);
  });

  it('reads machine-to-machine pipes', async () => {
    const { pack, plan } = chain2();
    const m = readLine({ pack, plan, layout: await layFeed(pack, plan, 'direct') });
    const nets = m.networks.filter((n): n is GtPipeNet => n.kind === 'gtpipe');
    expect(nets).toHaveLength(1);
    expect(nets[0]!.pipes.map((p) => [p.id, p.capacity])).toEqual([['3,0,2', 1], ['4,0,2', 1], ['5,0,2', 1], ['6,0,2', 1]]);
    expect(nets[0]!.pipes.find((p) => p.id === '6,0,2')!.sides).toEqual([{ side: 2, target: { node: '6,0,1', side: 3 } }, { side: 3, target: { node: '6,0,3', side: 2 } }]);
    // the tail pipe's import conveyor from the input chest and its filter cover toward the output chest
    expect(m.covers).toContainEqual(expect.objectContaining({ host: '6,0,2', side: 2, kind: 'conveyor', export: false }));
    expect(m.covers).toContainEqual(expect.objectContaining({ host: '6,0,2', side: 3, kind: 'filter', filter: { mode: 'whitelist', keys: ['t:y@0'] } }));
    expect(m.nodes.filter((n): n is BasicNode => n.kind === 'basic').map((n) => n.settings.inputFilter)).toEqual([true, true, true]);
  });

  it('prefers the structured config over the text', async () => {
    const { pack, plan } = chain2();
    const layout = await layFeed(pack, plan, 'routed');
    blockAt(layout, [3, 64, 2]).feed = { chips: [{ kind: 'extractor', filter: { mode: 'whitelist', keys: ['t:x@0'] } }] };   // its config.chips kept
    blockAt(layout, [5, 64, 2]).config = { chips: 'Item Responder Chip (whitelist: Nothing Known)' };
    const m = readLine({ pack, plan, layout });
    const net = routedNet(m);
    expect(net.pipes.find((p) => p.id === '3,0,2')!.chips).toEqual([{ kind: 'extractor', filter: { mode: 'whitelist', keys: ['t:x@0'] } }]);
    expect(unknownsAt(m, 'text_ignored')).toEqual([[3, 64, 2]]);
    // the name reads as nothing the plan names, so the responder whitelists the assembler's own input
    expect(net.pipes.find((p) => p.id === '5,0,2')!.chips).toEqual([{ kind: 'responder', filter: { mode: 'whitelist', keys: ['t:x@0'] } }]);
    expect(unknownsAt(m, 'text_unread')).toEqual([[5, 64, 2]]);
    // the structured pipe is not read from its text
    expect(unknownsAt(m, 'routed_text')).toEqual([[4, 64, 2], [5, 64, 2], [6, 65, 1], [6, 65, 3]]);
    expect(unknownsAt(m, 'extractor_new')).toEqual([[4, 64, 2], [6, 65, 1]]);
  });

  it('reads a rotated line in the local frame', async () => {
    for (const mode of ['direct', 'routed', 'ae2', 'enderio'] as const) {
      const views: unknown[] = [];
      for (const rotation of [0, 90, 180, 270] as const) {
        const { pack, plan } = chain2();
        const layout = await layFeed(pack, plan, mode, { origin: [30, 64, 10], rotation });
        expect(layout.rotation).toBe(rotation);
        if (mode === 'ae2') {
          // the world face toward the assembler, as the writer turns it with the line
          const iface = layout.blocks.find((b) => b.role === 'interface' && posKey(fromWorld(b.pos, layout)) === '7,0,2')! as FeedBlock;
          iface.feed = { interface: { patterns: [{ inputs: [{ key: 't:x@0', amount: 1 }], outputs: [{ key: 't:y@0', amount: 1 }] }], blocking: false,
            targets: [rotateFace('north', rotation)] } };
        }
        const m = readLine({ pack, plan, layout });
        for (const n of m.nodes) expect(fromWorld(n.pos, layout)).toEqual(n.local);
        if (mode === 'ae2') {
          const net = m.networks.find((n): n is Ae2Net => n.kind === 'ae2')!;
          expect(net.interfaces.find((i) => i.id === '7,0,2')!.targets).toEqual([{ node: '7,0,1', side: 3 }]);
          // its pattern text is still on the block: the structured config wins
          expect(m.unknowns.filter((u) => u.code === 'text_ignored').map((u) => fromWorld(u.pos!, layout))).toEqual([[7, 0, 2]]);
        }
        views.push(localView(m));
      }
      expect(views.slice(1)).toEqual([views[0], views[0], views[0]]);
    }
  });

  it('reads a steam machine as a basic machine', async () => {
    const { pack, plan } = twoSteps(FEED_IDS.STEAM);
    const layout = await layFeed(pack, plan, 'routed');
    const m = readLine({ pack, plan, layout });
    expect(m.nodes.find((n) => n.id === '1,0,1')).toMatchObject({ kind: 'basic', steam: true, outputSide: 1, front: 4, inSlots: 1, outSlots: 1 });
    expect(m.unknowns.filter((u) => u.code === 'slots_unknown')).toEqual([expect.objectContaining({ pos: [1, 64, 1], stepId: 's1' })]);
    expect(blockAt(layout, [1, 64, 2]).config?.chips).toBe('Item Responder Chip (whitelist: Alpha) + Item Extractor Chip');
    expect(routedNet(m).pipes.find((p) => p.id === '1,0,2')).toMatchObject({
      target: { node: '1,0,1', side: 3 },
      chips: [{ kind: 'responder', filter: { mode: 'whitelist', keys: ['t:a@0'] } }, { kind: 'extractor', filter: { mode: 'whitelist', keys: [] } }],
    });
    // Ex is made on the line
    expect(m.supply).toEqual(['t:a@0']);
    // GT lets only primitive covers onto a steam machine (E17): a conveyor there is not read
    blockAt(layout, [1, 64, 1]).covers = [{ face: 'south', item: 'gregtech:gt.metaitem.01@32630', settings: { mode: 'export', allowInput: true } }];
    const covered = readLine({ pack, plan, layout });
    expect([covered.covers, unknownsAt(covered, 'cover_unknown')]).toEqual([[], [[1, 64, 1]]]);
  });

  it("runs main's hand-run multiblocks by hand", async () => {
    const { pack, plan } = twoSteps(FEED_IDS.COKE);
    const layout = await layFeed(pack, plan, 'routed');
    const m = readLine({ pack, plan, layout });
    const coke = layout.blocks.find((b) => b.role === 'machine' && b.stepId === 's1')!;
    expect(m.nodes.filter((n) => n.kind !== 'chest' && n.stepIds.includes('s1'))).toEqual([]);
    expect(m.unknowns.filter((u) => u.code === 'hand_run')).toEqual([expect.objectContaining({ pos: coke.pos, stepId: 's1', text: expect.stringContaining('own_hatch') })]);
    expect([m.laid, m.supply]).toEqual([['s2'], ['t:x@0']]);
    // the input chest lists it
    expect(m.nodes.find((n) => n.kind === 'chest' && n.side === 'input')).toMatchObject({ keys: ['t:x@0'] });
    expect(m.unknowns.some((u) => u.code === 'supply_not_listed')).toBe(false);
  });

  it('reads output bus locks', async () => {
    for (const [lock, expected] of [['Ex', 't:x@0'], ['Nothing Known', 'Nothing Known']] as const) {
      const { pack, plan } = ebfLine();
      const layout = await layFeed(pack, plan, 'routed');
      const bus = layout.blocks.find((b) => b.hatch === 'output_bus')!;
      bus.config = { ...bus.config, lock };
      const m = readLine({ pack, plan, layout });
      const multi = m.nodes.find((n): n is MultiNode => n.kind === 'multi')!;
      expect(multi.outBuses[0]!.lock).toBe(expected);
      // a lock that names no item of the plan matches no output of the line
      expect(unknownsAt(m, 'text_unread')).toEqual(lock === 'Ex' ? [] : [bus.pos]);
    }
  });

  it('reads an ME Export Bus', async () => {
    const { pack, plan } = chain2();
    const layout = await layFeed(pack, plan, 'ae2');
    layout.blocks.push({ pos: [3, 65, 1], block: { id: 'appliedenergistics2:item.ItemMultiPart', meta: 260 }, role: 'interface', label: 'ME Export Bus',
      config: { exportFilter: 'Alpha' } });
    const m = readLine({ pack, plan, layout });
    const net = m.networks.find((n): n is Ae2Net => n.kind === 'ae2')!;
    expect(net.exportBuses).toEqual([{ id: '3,1,1', label: 'ME Export Bus at 3 65 1', keys: ['t:a@0'], amount: 1, target: { node: '3,0,1', side: 1 } }]);
    expect(unknownsAt(m, 'export_bus_text')).toEqual([[3, 65, 1]]);
    expect(net.interfaces.map((i) => i.id)).toEqual(['3,0,2', '5,0,2', '7,0,2']);
  });

  it('skips a machine whose step the plan lacks', async () => {
    const { pack, plan } = chain2();
    const layout = await layFeed(pack, plan, 'routed');
    const older = { ...plan, steps: plan.steps.filter((s) => s.id !== 's2') };
    const m = readLine({ pack, plan: older, layout });
    expect(m.nodes.map((n) => n.id)).not.toContain('5,0,1');
    expect(m.unknowns.filter((u) => u.code === 'step_missing')).toEqual([{ code: 'step_missing', text: expect.any(String), pos: [5, 64, 1], stepId: 's2' }]);
    // a machine the pack does not know is skipped too
    blockAt(layout, [3, 64, 1]).block = { id: 'gregtech:gt.blockmachines', meta: 0, mteId: 9999 };
    const unknownMachine = readLine({ pack, plan, layout });
    expect(unknownMachine.nodes.map((n) => n.id)).toEqual(['4,0,3', '5,0,1', '6,0,1', '6,0,3']);
    expect(unknownsAt(unknownMachine, 'machine_unknown')).toEqual([[3, 64, 1]]);
  });

  it('falls back to the recipes for slots', async () => {
    const { pack, plan } = feedPlan([{ id: 'q', mteId: FEED_IDS.ODD, count: 1, inputs: [['t:a@0', 1], ['t:b@0', 2]], held: ['t:c@0'], outputs: [['t:x@0', 1]] }]);
    const m = readLine({ pack, plan, layout: await layFeed(pack, plan, 'enderio') });
    const node = m.nodes.find((n): n is BasicNode => n.kind === 'basic')!;
    expect([node.inSlots, node.outSlots, node.recipes[0]!.held]).toEqual([3, 1, ['t:c@0']]);
    expect(m.unknowns.filter((u) => u.code === 'slots_unknown')).toEqual([expect.objectContaining({ pos: node.pos, stepId: 'q' })]);
  });

  it('reads recipes, chances and circuits', async () => {
    const line = () => feedPlan([{
      id: 'r', mteId: IDS.MACERATOR, count: 1, inputs: [['t:a@0', 1]], consumeChance: { 't:a@0': 0.5 }, held: ['gregtech:gt.integrated_circuit@2'],
      outputs: [['t:x@0', 1]], chances: { 't:x@0': 0.25 },
    }]);
    const { pack, plan } = line();
    const layout = await layFeed(pack, plan, 'routed');
    const recipe = readLine({ pack, plan, layout }).nodes.find((n): n is BasicNode => n.kind === 'basic')!.recipes[0]!;
    expect(recipe).toMatchObject({
      stepId: 'r', ticks: 20, inputs: [{ key: 't:a@0', amount: 1, chance: 0.5 }], held: [], outputs: [{ key: 't:x@0', amount: 1, chance: 0.25 }],
    });
    // without its pack recipe: the plan step's expected amounts (0.5 Alpha in, 0.25 Ex out)
    pack.recipeById.delete('r');
    const m = readLine({ pack, plan, layout });
    expect(m.nodes.find((n): n is BasicNode => n.kind === 'basic')!.recipes[0]).toMatchObject({
      inputs: [{ key: 't:a@0', amount: 1, chance: 1 }], held: [], outputs: [{ key: 't:x@0', amount: 1, chance: 0.25 }],
    });
    expect(m.unknowns.map((u) => u.code)).toEqual(expect.arrayContaining(['recipe_missing', 'amount_fraction']));
  });

  it('reads a multiblock and its buses', async () => {
    const { pack, plan } = ebfLine();
    const layout = await layFeed(pack, plan, 'routed');
    const m = readLine({ pack, plan, layout });
    const multi = m.nodes.find((n): n is MultiNode => n.kind === 'multi')!;
    const input = layout.blocks.find((b) => b.hatch === 'input_bus')!;
    expect(multi).toMatchObject({ id: '2,0,3', kinds: ['t:a@0', 't:b@0'], separationDefault: true, inputSeparation: null });
    expect(multi.inBuses).toEqual([expect.objectContaining({ id: '3,0,3', front: 3, slots: busSlots(pack.machines.get(input.block.mteId!)!.tier!), limited: null })]);
    expect(multi.outBuses).toEqual([expect.objectContaining({ id: '1,0,3', front: 3, lock: null })]);
    expect(unknownsAt(m, 'limited_unset')).toEqual([input.pos]);
    // main lays an interface pipe on each bus port: its target is the bus, as part of the multiblock
    expect(routedNet(m).pipes.find((p) => p.id === '3,0,4')!.target).toEqual({ node: '2,0,3', bus: '3,0,3', side: 3 });
  });

  it('reads a bench', async () => {
    for (const given of [true, false]) {
      const { pack, plan } = benchLine();
      const layout = await layFeed(pack, plan, 'enderio');
      const block = layout.blocks.find((b) => b.role === 'machine' && b.stepId === 'b')! as FeedBlock;
      if (given) block.feed = { bench: { mode: 'normal', grid: [...BENCH_GRID], throughput: 0 } };
      const m = readLine({ pack, plan, layout });
      const bench = m.nodes.find((n): n is BenchNode => n.kind === 'bench')!;
      expect(bench).toMatchObject({ grid: BENCH_GRID, result: { key: 't:x@0', amount: 1 }, throughput: 0, kinds: ['t:a@0', 't:b@0'] });
      // main turns the bench's front to the middle row, so north is its back, and only the cable north of it connects toward it
      expect(bench.back).toBe(OPPOSITE[bench.front]);
      expect([bench.front, bench.back, bench.powerSides, bench.fluidSides, bench.itemPipeSides]).toEqual([3, 2, [2], [], []]);
      expect(['bench_grid_derived', 'bench_mode_unset'].map((code) => m.unknowns.some((u) => u.code === code))).toEqual([!given, !given]);
    }
  });

  // ---- the reading rules' other branches ----

  it('leaves out the hookup and the ghosts', async () => {
    const { pack, plan } = chain2();
    const layout = await layFeed(pack, plan, 'direct');
    const tinPipe = (pos: Vec3, role: 'pipe' | 'ghost', connections: number, hookup?: number): LayoutBlock => ({
      pos, block: { id: 'gregtech:gt.blockmachines', meta: 0, mteId: IDS.TIN_ITEM_PIPE }, role, label: 'Tin Item Pipe', connections,
      ...(hookup === undefined ? {} : { hookup }),
    });
    // a tap's ghost beside the tail pipe, and a hookup pipe on it, both linked toward it
    layout.blocks.push(tinPipe([7, 64, 2], 'ghost', 1 << 4), tinPipe([6, 65, 2], 'pipe', 1 << 0, 0));
    const m = readLine({ pack, plan, layout });
    expect(m.networks.filter((n): n is GtPipeNet => n.kind === 'gtpipe').map((n) => n.pipes.map((p) => p.id))).toEqual([['3,0,2', '4,0,2', '5,0,2', '6,0,2']]);
  });

  it('reads chip lists as main writes them', async () => {
    // an item whose name holds " and ", sorted last, so main's list ends with it
    const { pack, plan } = chain2();
    pack.items.set('t:zz@0', { key: 't:zz@0', id: 't:zz', meta: 0, name: 'Salt and Pepper', oreDict: [] });
    plan.flows.push({ from: 'raw', to: 's2', key: 't:zz@0', perSecond: 1 });
    const layout = await layFeed(pack, plan, 'routed');
    expect(blockAt(layout, [5, 64, 2]).config?.chips).toBe('Item Responder Chip (whitelist: Ex and Salt and Pepper) + Item Extractor Chip');
    blockAt(layout, [4, 64, 2]).config = { chips: 'Item Responder Chip (whitelist: Alpha, Ex and Salt and Pepper) + Item Crafting Chip + Item Broadcaster Chip' };
    const m = readLine({ pack, plan, layout });
    const chipsOf = (id: string) => routedNet(m).pipes.find((p) => p.id === id)!.chips;
    expect(chipsOf('5,0,2')[0]).toEqual({ kind: 'responder', filter: { mode: 'whitelist', keys: ['t:x@0', 't:zz@0'] } });
    // a new broadcaster offers everything (research §2.2); a chip the checker does not know is left out
    expect(chipsOf('4,0,2')).toEqual([
      { kind: 'responder', filter: { mode: 'whitelist', keys: ['t:a@0', 't:x@0', 't:zz@0'] } }, { kind: 'broadcaster', filter: { mode: 'blacklist', keys: [] } },
    ]);
    expect(m.unknowns.filter((u) => u.code === 'text_unread').map((u) => [u.pos, u.text.includes('"Item Crafting Chip"')])).toEqual([[[4, 64, 2], true]]);
  });

  it('reads Limited Item Filters', async () => {
    const { pack, plan } = chain2();
    const layout = await layFeed(pack, plan, 'enderio');
    const face = blockAt(layout, [5, 64, 2]).conduits![0]!.faces[0]!;
    const counted: FeedConduitFilter = { item: PART_KEYS.limitedFilter, whitelist: true, keys: ['t:y@0'], limits: [{ key: 't:y@0', count: 6 }] };
    face.insert!.filter = { item: PART_KEYS.limitedFilter, whitelist: false, keys: ['t:x@0'] };
    face.extract!.filter = counted;
    const m = readLine({ pack, plan, layout });
    const read = m.networks.find((n): n is EioNet => n.kind === 'enderio')!.faces.find((f) => f.id === '5,0,2:2')!;
    // without counts it is read as a whitelist of its items; on an extract side it is kept as it is, but not modelled
    expect(read.insert!.filter).toEqual({ item: PART_KEYS.limitedFilter, whitelist: true, keys: ['t:x@0'] });
    expect(read.extract!.filter).toEqual(counted);
    expect(['limited_counts_missing', 'eio_limited_extract'].map((code) => unknownsAt(m, code))).toEqual([[[5, 64, 2]], [[5, 64, 2]]]);
  });

  it('reads every cover it knows and names the others', async () => {
    const { pack, plan } = chain2();
    const layout = await layFeed(pack, plan, 'direct');
    blockAt(layout, [4, 64, 2]).covers = [
      { face: 'south', item: PART_KEYS.shutter, settings: { mode: 'input_only' } },
      { face: 'up', item: 'gregtech:gt.metaitem.01@32610', settings: { mode: 'export' } },
    ];
    const m = readLine({ pack, plan, layout });
    expect(m.covers.filter((c) => c.host === '4,0,2')).toEqual([{ host: '4,0,2', side: 3, kind: 'shutter', export: false, allowInput: false, shutter: 'input_only' }]);
    expect(m.unknowns.filter((u) => u.code === 'cover_unknown').map((u) => [u.pos, u.text.includes('Electric Pump (LV)')])).toEqual([[[4, 64, 2], true]]);
  });

  it('stocks supply no input chest lists and reads a chest without its side as an output chest', async () => {
    const { pack, plan } = chain2();
    const layout = await layFeed(pack, plan, 'routed');
    blockAt(layout, [6, 64, 1]).tail = { side: 'input', keys: [] };
    delete blockAt(layout, [6, 64, 3]).tail;
    const m = readLine({ pack, plan, layout });
    expect(m.nodes.filter((n) => n.kind === 'chest')).toEqual([
      expect.objectContaining({ id: '6,0,1', side: 'input', keys: ['t:a@0'] }), expect.objectContaining({ id: '6,0,3', side: 'output', keys: [] }),
    ]);
    expect(['supply_not_listed', 'chest_side_unknown'].map((code) => unknownsAt(m, code))).toEqual([[[6, 64, 1]], [[6, 64, 3]]]);
  });

  it('gives each bus to the nearest controller of its step', async () => {
    // ruling R-6: hatch blocks carry their step but no unit, and main lays both EBFs of a two-machine step
    const { pack, plan } = feedPlan([{ id: 'e', mteId: IDS.EBF, count: 2, inputs: [['t:a@0', 1], ['t:b@0', 1]], outputs: [['t:x@0', 1]] }]);
    const m = readLine({ pack, plan, layout: await layFeed(pack, plan, 'routed') });
    expect(m.nodes.filter((n): n is MultiNode => n.kind === 'multi').map((n) => [n.id, n.inBuses.map((b) => b.id), n.outBuses.map((b) => b.id)]))
      .toEqual([['2,0,3', ['3,0,3'], ['1,0,3']], ['3,0,5', ['2,0,5'], ['4,0,5']]]);
  });

  it('notes Input Separation left unset on two input buses', async () => {
    const { pack, plan } = ebfLine();
    const layout = await layFeed(pack, plan, 'routed');
    // a second LV input bus in place of the coil casing above the first
    Object.assign(blockAt(layout, [3, 65, 3]), {
      role: 'hatch', block: { id: 'gregtech:gt.blockmachines', meta: 0, mteId: IDS.INPUT_BUS_LV }, label: 'Input Bus (LV)', facing: 3, hatch: 'input_bus',
    });
    const m = readLine({ pack, plan, layout });
    const multi = m.nodes.find((n): n is MultiNode => n.kind === 'multi')!;
    expect(multi.inBuses.map((b) => b.id)).toEqual(['3,0,3', '3,1,3']);
    expect(['separation_unset', 'limited_unset'].map((code) => unknownsAt(m, code))).toEqual([[[2, 64, 3]], [[3, 64, 3], [3, 65, 3]]]);
  });

  it('reads ME Export Bus cards and facing, and a bus that feeds nothing', async () => {
    const { pack, plan } = chain2();
    const layout = await layFeed(pack, plan, 'ae2');
    const bus = (pos: Vec3, more: Partial<FeedBlock>): FeedBlock => ({
      pos, block: { id: 'appliedenergistics2:item.ItemMultiPart', meta: 260 }, role: 'interface', label: 'ME Export Bus', ...more,
    });
    layout.blocks.push(bus([5, 65, 3], { facing: 0, feed: { exportBus: { keys: ['t:x@0'], cards: 2 } } }), bus([3, 66, 1], { config: { exportFilter: 'Alpha and Nothing Known' } }));
    const m = readLine({ pack, plan, layout });
    expect(m.networks.find((n): n is Ae2Net => n.kind === 'ae2')!.exportBuses).toEqual([
      { id: '3,2,1', label: 'ME Export Bus at 3 66 1', keys: ['t:a@0'], amount: 1, target: null },
      { id: '5,1,3', label: 'ME Export Bus at 5 65 3', keys: ['t:x@0'], amount: 32, target: { node: '5,0,3', side: 1 } },
    ]);
    expect(['export_bus_text', 'text_unread', 'export_target_unknown'].map((code) => unknownsAt(m, code))).toEqual([[[3, 66, 1]], [[3, 66, 1]], [[3, 66, 1]]]);
  });

  it('counts the sides a bench is connected on and the containers of its grid', async () => {
    const { pack, plan } = benchLine();
    pack.fluidContainers = [{ container: 't:a@0', empty: 't:c@0', fluid: 'fluid:molten.iron', amount: 144 }];
    const layout = await layFeed(pack, plan, 'enderio');
    // the cable west of it becomes a GT item pipe linked toward it; its conduit bundle gets an ender fluid conduit face toward it
    Object.assign(blockAt(layout, [0, 64, 1]), { role: 'pipe', block: { id: 'gregtech:gt.blockmachines', meta: 0, mteId: IDS.TIN_ITEM_PIPE }, connections: 1 << 5 });
    blockAt(layout, [1, 64, 2]).conduits!.push({ kind: 'liquid_ender', item: 'EnderIO:itemLiquidConduit@2', connections: 0,
      faces: [{ face: 'north', mode: 'insert', target: 'Auto Workbench (MV)' }] });
    const bench = readLine({ pack, plan, layout }).nodes.find((n): n is BenchNode => n.kind === 'bench')!;
    expect([bench.powerSides, bench.fluidSides, bench.itemPipeSides, bench.containers]).toEqual([[2], [3], [4], { 't:a@0': 't:c@0' }]);
  });
});
