import { describe, it, expect } from 'vitest';
import { buildMode, PORT_SPACING, type ModeResult } from '../../../src/server/layout/modes/mode.ts';
import { unitsFromPlan, placeUnits } from '../../../src/server/layout/arrange.ts';
import { resolveParts } from '../../../src/server/layout/parts.ts';
import { configuredLines } from '../../../src/shared/layout/configure-text.ts';
import type { StuffKey } from '../../../src/shared/keys.ts';
import { layoutPack, makePlan, makeScan, IDS } from '../../helpers/layout-fixtures.ts';
import type { LogisticsMode, Plan } from '../../../src/shared/types/plan.ts';

const twoStep = () => makePlan([{ id: 's1', mteId: IDS.MACERATOR, count: 2 }, { id: 's2', mteId: IDS.ASSEMBLER, count: 1, tier: 2, euPerTick: 120 }]);
/** s1 moves items, s2 only fluids, s3 takes an item and makes a fluid. */
const mixed = () => makePlan([{ id: 's1', mteId: IDS.MACERATOR, count: 1 },
  { id: 's2', mteId: IDS.CHEM_HV, count: 1, tier: 3, inputs: [['fluid:oxygen', 1000]], outputs: [['fluid:molten.iron', 144]] },
  { id: 's3', mteId: IDS.EXTRACTOR, count: 1, outputs: [['fluid:molten.iron', 144]] }], { flows: [
  { from: 'raw', to: 's1', key: 't:in@0', perSecond: 1 }, { from: 's1', to: 'out', key: 't:out_s1@0', perSecond: 1 },
  { from: 'raw', to: 's2', key: 'fluid:oxygen', perSecond: 1000 }, { from: 's2', to: 'out', key: 'fluid:molten.iron', perSecond: 144 },
  { from: 'raw', to: 's3', key: 't:in@0', perSecond: 1 }, { from: 's3', to: 'out', key: 'fluid:molten.iron', perSecond: 144 }] });

function setup(mode: LogisticsMode, plan: Plan = twoStep()) {
  const pack = layoutPack();
  const placement = placeUnits(unitsFromPlan(pack, plan).units, { headWidth: 1, portSpacing: PORT_SPACING[mode] });
  return { pack, plan, placement, parts: resolveParts(pack) };
}
const routedNet = () => makeScan({ logistics: [{ kind: 'routed', taps: [[0, 64, 0]] }] }).logistics[0]!;

describe('routed mode', () => {
  it('puts an interface pipe in front of every machine and a request point at the tail', () => {
    const r = buildMode('routed', { ...setup('routed'), network: routedNet() });
    const spine = r.blocks.filter((b) => b.pos[1] === 0 && b.pos[2] === 2);
    expect(spine.map((b) => [b.pos[0], b.label, b.connections])).toEqual([
      [1, 'Routed Interface Pipe (Basic Macerator)', 4 | 32], [2, 'Routed Interface Pipe (Basic Macerator)', 8 | 16 | 32],
      [3, 'Routed Interface Pipe (Advanced Assembler)', 4 | 16 | 32], [4, 'Routed Request Pipe', 2 | 4 | 16]]);
    expect(r.blocks.filter((b) => b.pos[0] === 4 && b.pos[1] === 1).map((b) => [b.pos, b.label])).toEqual([
      [[4, 1, 1], 'Routed Interface Pipe (input chest)'], [[4, 1, 2], 'Routed Junction Pipe'], [[4, 1, 3], 'Routed Interface Pipe (output chest)']]);
    // the feeding fix (architecture §11 entry 51): the output chest takes what leaves the line on an Item Terminator Chip
    expect(r.extraParts).toEqual([
      { key: 'ProjRed|Transportation:projectred.transportation.routingchip@0', amount: 3, why: 'interface pipe chips', group: 'logistics' },
      { key: 'ProjRed|Transportation:projectred.transportation.routingchip@4', amount: 4, why: 'interface pipe chips', group: 'logistics' },
      { key: 'ProjRed|Transportation:projectred.transportation.routingchip@3', amount: 1, why: 'interface pipe chips', group: 'logistics' }]);
    expect([r.logisticsPort, r.hookup, r.tailFluidY, r.warnings]).toEqual([[4, 0, 2], { part: 'pr_junction', end: null }, 2, []]);
    expect(spine[0]!.feed).toEqual({ chips: [{ kind: 'responder', filter: { mode: 'whitelist', keys: ['t:in@0'] } },
      { kind: 'extractor', filter: { mode: 'whitelist', keys: ['t:out_s1@0'] } }] });
    expect(r.blocks.find((b) => b.label === 'Routed Interface Pipe (output chest)')!.feed).toEqual({
      chips: [{ kind: 'terminator', filter: { mode: 'whitelist', keys: ['t:out_s2@0'] } }] });
    expect([r.covers, r.drafts.map((d) => d.kind)]).toEqual([[], ['logistics', 'logistics']]);
    // "in front of" would read as GT's front, which faces along the row (the review of the EnderIO In / Out fix)
    expect(r.drafts[0]!.text).toBe("Lay routed pipes along the middle row: an interface pipe at every machine's output side or bus, a request pipe "
      + 'and two chests at the end');
    // final review: the interface pipe inserts through each machine's output side (its front is elsewhere), as in every mode
    const fromOutputSide = { inputFromOutputSide: true };
    expect(r.configs).toEqual([{ pos: [1, 0, 1], config: fromOutputSide }, { pos: [2, 0, 3], config: fromOutputSide }, { pos: [3, 0, 1], config: fromOutputSide }]);
  });

  it('builds its own network and says so when the base has none', () => {
    const r = buildMode('routed', { ...setup('routed'), network: null });
    expect(r.hookup).toBeNull();
    expect(r.warnings).toEqual([{ code: 'routed_missing', text: 'No Project Red routed network at this base: the line gets its own — put raw inputs in the input chest' }]);
  });

  it('gives each interface pipe only the chips it needs, and none to a machine that moves only fluids', () => {
    const r = buildMode('routed', { ...setup('routed', mixed()), network: routedNet() });
    const responder = { kind: 'responder', filter: { mode: 'whitelist', keys: ['t:in@0'] } };
    expect(r.blocks.filter((b) => b.pos[1] === 0 && b.pos[2] === 2).map((b) => [b.pos[0], b.role, b.label, b.feed])).toEqual([
      [1, 'chip_pipe', 'Routed Interface Pipe (Basic Macerator)', { chips: [responder, { kind: 'extractor', filter: { mode: 'whitelist', keys: ['t:out_s1@0'] } }] }],
      [2, 'pipe', 'Routed Junction Pipe', undefined],
      [3, 'chip_pipe', 'Routed Interface Pipe (Basic Fluid Extractor)', { chips: [responder] }],
      [4, 'pipe', 'Routed Request Pipe', undefined]]);
    // responders, extractors (one on the input chest) and the output chest's terminator
    expect(r.extraParts.map((p) => p.amount)).toEqual([2, 2, 1]);
  });

  it('splits a long whitelist over responder chips of nine and keeps the extractor', () => {
    // one chip's filter holds 9 items and an interface pipe 4 chips (ProjRed-4.12.44-GTNH); a Project Red line shares no
    // machine (fix wave 2 (d)), so only a recipe of many inputs gets there. Its extractor keeps its slot, as without it
    // nothing the machine makes would leave: past three responders the rest of the inputs are named.
    const assembler = (inputs: StuffKey[]): Plan => makePlan([{ id: 'a', mteId: IDS.ASSEMBLER, count: 1, tier: 2, inputs: inputs.map((k): [StuffKey, number] => [k, 1]) }],
      { flows: [...inputs.map((key) => ({ from: 'raw', to: 'a', key, perSecond: 1 })), { from: 'a', to: 'out', key: 't:out_a@0', perSecond: 1 }] });
    const keys = (prefix: string, n: number): StuffKey[] => Array.from({ length: n }, (_, i): StuffKey => `t:${prefix}${i + 1}@0`);
    const pipeOf = (r: ModeResult) => r.blocks.find((b) => b.label === 'Routed Interface Pipe (Advanced Assembler)')!;
    const whitelist = (kind: string, list: StuffKey[]) => ({ kind, filter: { mode: 'whitelist', keys: list } });
    const ten = [...keys('a', 5), ...keys('b', 5)];
    const r = buildMode('routed', { ...setup('routed', assembler(ten)), network: routedNet() });
    expect(pipeOf(r).feed?.chips).toEqual([whitelist('responder', ten.slice(0, 9)), whitelist('responder', ten.slice(9)), whitelist('extractor', ['t:out_a@0'])]);
    expect(configuredLines(pipeOf(r), (k) => k)).toEqual(['chips: Item Responder Chip (whitelist: t:a1@0, t:a2@0, t:a3@0, t:a4@0, t:a5@0, '
      + 't:b1@0, t:b2@0, t:b3@0 and t:b4@0) + Item Responder Chip (whitelist: t:b5@0) + Item Extractor Chip (whitelist: t:out_a@0)']);
    // two responders on the assembler; one extractor on it and two on the input chest (its ten raw inputs); the terminator
    expect(r.extraParts.map((p) => p.amount)).toEqual([2, 3, 1]);
    expect(r.warnings.filter((w) => w.code === 'routed_chips_short')).toEqual([]);
    // 28 inputs: three responders of nine and the extractor; the 28th needs a second pipe or your hands
    const many = [...keys('a', 14), ...keys('b', 14)].sort();
    const full = buildMode('routed', { ...setup('routed', assembler(many)), network: routedNet() });
    expect(pipeOf(full).feed?.chips?.map((c) => [c.kind, c.filter?.keys.length])).toEqual([['responder', 9], ['responder', 9], ['responder', 9], ['extractor', 1]]);
    expect(full.warnings.filter((w) => w.code === 'routed_chips_short')).toEqual([{ code: 'routed_chips_short', stepId: 'a',
      text: `The interface pipe of the Advanced Assembler holds 4 chips of 9 items each, too few for ${many[27]!}: move it by hand` }]);
  });
});

describe('AE2 mode', () => {
  it('puts an ME interface in front of every machine, cable between, and counts channels', () => {
    const network = makeScan({ logistics: [{ kind: 'ae2', taps: [[0, 64, 0]], channelsUsed: 30, channelsMax: 32 }] }).logistics[0]!;
    const r = buildMode('ae2', { ...setup('ae2'), network });
    expect(r.blocks.filter((b) => b.pos[2] === 2).map((b) => [b.pos[0], b.role, b.label])).toEqual([
      [1, 'interface', 'ME Interface (Basic Macerator)'], [2, 'pipe', 'ME Glass Cable - Fluix'], [3, 'interface', 'ME Interface (Basic Macerator)'],
      [4, 'pipe', 'ME Glass Cable - Fluix'], [5, 'interface', 'ME Interface (Advanced Assembler)'], [6, 'pipe', 'ME Glass Cable - Fluix']]);
    expect(r.covers.map((c) => [c.pos, c.cover.face, c.cover.settings])).toEqual([
      [[1, 0, 1], 'south', { mode: 'export', allowInput: true, rate: 0.5, unit: 'items/s' }],
      [[3, 0, 3], 'north', { mode: 'export', allowInput: true, rate: 0.5, unit: 'items/s' }],
      [[5, 0, 1], 'south', { mode: 'export', allowInput: true, rate: 1, unit: 'items/s' }]]);
    expect(r.extraParts).toEqual([{ key: 'appliedenergistics2:item.ItemMultiMaterial@52', amount: 3, why: 'one processing pattern per machine', group: 'logistics' }]);
    expect(r.warnings).toEqual([{ code: 'ae2_channels', text: 'The line needs 3 channels; the AE2 network has 2 free' }]);
    expect([r.logisticsPort, r.hookup]).toEqual([[6, 0, 2], { part: 'me_cable', end: null }]);
    // the feeding fix (architecture §11 entry 51): the pattern is the interface's structured feed, blocking when nothing it
    // holds is off AE2's ignore list
    const iface = r.blocks.find((b) => b.pos[0] === 1 && b.role === 'interface')!;
    expect([iface.config, iface.feed]).toEqual([undefined, { interface: { patterns: [{ inputs: [{ key: 't:in@0', amount: 1 }],
      outputs: [{ key: 't:out_s1@0', amount: 1 }] }], blocking: true } }]);
    expect(r.drafts.map((d) => d.id)).toEqual(['layout:logistics:line']);
    expect(r.drafts[0]!.text).toBe("Lay ME glass cable along the middle row with an ME interface at every machine's output side or bus");
    // final review: the interface pushes the pattern's inputs through each machine's output side
    expect(r.configs.map((c) => [c.pos, c.config])).toEqual([[[1, 0, 1], { inputFromOutputSide: true }], [[3, 0, 3], { inputFromOutputSide: true }],
      [[5, 0, 1], { inputFromOutputSide: true }]]);
  });

  it('never assumes an AE2 network the scan did not find', () => {
    const r = buildMode('ae2', { ...setup('ae2'), network: null });
    expect(r.hookup).toBeNull();
    expect(r.warnings.map((w) => w.code)).toEqual(['ae2_missing']);
  });

  it('puts no interface in front of a machine that moves only fluids, and an ME Export Bus in front of one that makes only fluids', () => {
    const network = makeScan({ logistics: [{ kind: 'ae2', taps: [[0, 64, 0]] }] }).logistics[0]!;
    const r = buildMode('ae2', { ...setup('ae2', mixed()), network });
    // s3 makes only Molten Iron: no pattern could count it, so cable with an export bus on its face toward the machine
    expect(r.blocks.map((b) => [b.pos[0], b.role, b.connections])).toEqual([
      [1, 'interface', undefined], [2, 'pipe', 16 | 32], [3, 'pipe', 16 | 32], [4, 'pipe', 16 | 32], [5, 'pipe', 16 | 32], [6, 'pipe', 16]]);
    // the cable carries the bus's filter as add-on 21's ExportBusSpec (its cover says what to set)
    expect([r.blocks[4]!.config, r.blocks[4]!.feed]).toEqual([undefined, { exportBus: { keys: ['t:in@0'] } }]);
    expect([r.extraParts[0]!.amount, r.covers.map((c) => [c.pos, c.cover.item]), r.warnings.map((w) => [w.code, w.stepId])]).toEqual([1,
      [[[1, 0, 1], 'gregtech:gt.metaitem.01@32630'], [[5, 0, 2], 'appliedenergistics2:item.ItemMultiPart@260']], [['ae2_no_pattern', 's3']]]);
    // only the machines that take items get input from their output side: the chemical reactor takes only oxygen
    expect(r.configs.map((c) => c.pos)).toEqual([[1, 0, 1], [5, 0, 1]]);
  });

  /** s1 makes t:out_s1@0 from Raw Input and s2 makes t:out_s2@0 from it, both on one macerator (an AE2 sharing pool). */
  const pooled = (): Plan => {
    const pool = { id: 'pool:s1', steps: ['s1', 's2'] };
    return makePlan([{ id: 's1', mteId: IDS.MACERATOR, count: 1, pool }, { id: 's2', mteId: IDS.MACERATOR, count: 1, pool, inputs: [['t:out_s1@0', 1]] }]);
  };

  it('gives a shared machine one ME interface with a pattern per step', () => {
    // one machine, one interface: its steps' patterns in step order, blocking mode on (a crafting CPU then pushes one
    // recipe's set at a time, and nothing the macerator holds is off AE2's ignore list: controller ruling 204 (3))
    const network = makeScan({ logistics: [{ kind: 'ae2', taps: [[0, 64, 0]] }] }).logistics[0]!;
    const r = buildMode('ae2', { ...setup('ae2', pooled()), network });
    const ifaces = r.blocks.filter((b) => b.role === 'interface');
    expect(ifaces.map((b) => b.label)).toEqual(['ME Interface (Basic Macerator)']);
    expect(ifaces[0]!.feed).toEqual({ interface: { patterns: [
      { inputs: [{ key: 't:in@0', amount: 1 }], outputs: [{ key: 't:out_s1@0', amount: 1 }] },
      { inputs: [{ key: 't:out_s1@0', amount: 1 }], outputs: [{ key: 't:out_s2@0', amount: 1 }] }], blocking: true } });
    expect(configuredLines(ifaces[0]!, layoutPack().nameOf)).toEqual(['2 processing patterns', 'pattern 1: 1× Raw Input → 1× t:out_s1@0',
      'pattern 2: 1× t:out_s1@0 → 1× t:out_s2@0', 'blocking mode on']);
    expect(r.extraParts).toEqual([{ key: 'appliedenergistics2:item.ItemMultiMaterial@52', amount: 2, why: 'one processing pattern per recipe each machine runs',
      group: 'logistics' }]);
    // its conveyor cover pushes out what both steps make, 1 item/s each
    expect(r.covers.map((c) => [c.cover.item, c.cover.settings.rate])).toEqual([['gregtech:gt.metaitem.01@32630', 2]]);
    expect(r.warnings).toEqual([]);
  });

  it('says where a shared machine holds an item blocking mode does not ignore, so its recipes can mix', () => {
    // research machine-feeding §3.3, §4.2 item 4: without blocking mode the interface pushes the next recipe's set before
    // the machine has run the last, so two recipes' items sit in it at once (a Packager's schematic is off AE2's list)
    const pack = layoutPack();
    const SCHEMATIC = 'gregtech:gt.metaitem.01@32498';
    for (const id of ['s1', 's2']) {
      pack.recipeById.set(id, { id, source: 'gt', maps: [], euPerTick: 30, durationTicks: 20, amps: 1, specialValue: 0, meta: {}, flags: {},
        inputs: [{ slot: 0, consumed: true, chance: 1, options: [{ key: id === 's1' ? 't:in@0' : 't:out_s1@0', amount: 1 }] },
          { slot: 1, consumed: false, chance: 0, options: [{ key: SCHEMATIC, amount: 1 }] }],
        outputs: [{ key: `t:out_${id}@0`, amount: 1, chance: 1 }] });
    }
    const plan = pooled();
    const placement = placeUnits(unitsFromPlan(pack, plan).units, { headWidth: 1, portSpacing: PORT_SPACING.ae2 });
    const network = makeScan({ logistics: [{ kind: 'ae2', taps: [[0, 64, 0]] }] }).logistics[0]!;
    const r = buildMode('ae2', { pack, plan, parts: resolveParts(pack), placement, network });
    expect(r.blocks.find((b) => b.role === 'interface')!.feed?.interface?.blocking).toBe(false);
    expect(r.warnings.filter((w) => w.code === 'ae2_shared_unblocked')).toEqual([{ code: 'ae2_shared_unblocked', stepId: 's1',
      text: `The Basic Macerator runs 2 recipes from one ME Interface but holds ${SCHEMATIC}, which blocking mode does not ignore, so blocking mode `
        + 'stays off and the next recipe\'s items can go in before the last has run: give each recipe its own machine' }]);
  });

  it('puts at most nine patterns in one ME interface and says which recipes need another', () => {
    // controller Amendment OQ6: one ME Interface holds nine processing patterns; the planner splits a key's pools into
    // parts of nine (`ae2Parts`), but a machine type of several maps could still gather more
    const ids = Array.from({ length: 10 }, (_, i) => `m${i}`);
    const pool = { id: 'pool:m0', steps: ids };
    const plan = makePlan(ids.map((id) => ({ id, mteId: IDS.MACERATOR, count: 1, pool })), { flows: ids.flatMap((id) => [
      { from: 'raw', to: id, key: 't:in@0', perSecond: 0.1 }, { from: id, to: 'out', key: `t:out_${id}@0`, perSecond: 0.1 }]) });
    const network = makeScan({ logistics: [{ kind: 'ae2', taps: [[0, 64, 0]] }] }).logistics[0]!;
    const r = buildMode('ae2', { ...setup('ae2', plan), network });
    expect(r.blocks.filter((b) => b.role === 'interface').map((b) => b.feed?.interface?.patterns.length)).toEqual([9]);
    expect(r.extraParts.find((p) => p.key === 'appliedenergistics2:item.ItemMultiMaterial@52')?.amount).toBe(9);
    expect(r.warnings).toEqual([{ code: 'ae2_patterns_short', stepId: 'm9',
      text: 'Basic Macerator runs more recipes than one ME Interface holds (9 patterns): t:out_m9@0 need another interface' }]);
  });
});
