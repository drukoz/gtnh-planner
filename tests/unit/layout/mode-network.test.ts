import { describe, it, expect } from 'vitest';
import { buildMode, PORT_SPACING } from '../../../src/server/layout/modes/mode.ts';
import { unitsFromPlan, placeUnits } from '../../../src/server/layout/arrange.ts';
import { resolveParts } from '../../../src/server/layout/parts.ts';
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
    expect(r.extraParts).toEqual([
      { key: 'ProjRed|Transportation:projectred.transportation.routingchip@0', amount: 4, why: 'interface pipe chips', group: 'logistics' },
      { key: 'ProjRed|Transportation:projectred.transportation.routingchip@4', amount: 4, why: 'interface pipe chips', group: 'logistics' }]);
    expect([r.logisticsPort, r.hookup, r.tailFluidY, r.warnings]).toEqual([[4, 0, 2], { part: 'pr_junction', end: null }, 2, []]);
    expect(spine[0]!.config).toEqual({ chips: 'Item Responder Chip (whitelist: Raw Input) + Item Extractor Chip' });
    expect(r.blocks.find((b) => b.label === 'Routed Interface Pipe (output chest)')!.config).toEqual({ chips: 'Item Responder Chip (whitelist: t:out_s2@0)' });
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
    expect(r.blocks.filter((b) => b.pos[1] === 0 && b.pos[2] === 2).map((b) => [b.pos[0], b.role, b.label, b.config])).toEqual([
      [1, 'chip_pipe', 'Routed Interface Pipe (Basic Macerator)', { chips: 'Item Responder Chip (whitelist: Raw Input) + Item Extractor Chip' }],
      [2, 'pipe', 'Routed Junction Pipe', undefined],
      [3, 'chip_pipe', 'Routed Interface Pipe (Basic Fluid Extractor)', { chips: 'Item Responder Chip (whitelist: Raw Input)' }],
      [4, 'pipe', 'Routed Request Pipe', undefined]]);
    expect(r.extraParts.map((p) => p.amount)).toEqual([3, 2]);
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
    expect(r.blocks.find((b) => b.pos[0] === 1 && b.role === 'interface')!.config)
      .toEqual({ patterns: 1, pattern: '1× Raw Input → 1× t:out_s1@0', blockingMode: false });
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

  it('puts no interface in front of a machine that moves only fluids', () => {
    const network = makeScan({ logistics: [{ kind: 'ae2', taps: [[0, 64, 0]] }] }).logistics[0]!;
    const r = buildMode('ae2', { ...setup('ae2', mixed()), network });
    expect(r.blocks.map((b) => [b.pos[0], b.role, b.connections])).toEqual([
      [1, 'interface', undefined], [2, 'pipe', 16 | 32], [3, 'pipe', 16 | 32], [4, 'pipe', 16 | 32], [5, 'interface', undefined], [6, 'pipe', 16]]);
    expect(r.blocks[4]!.config).toEqual({ patterns: 1, pattern: '1× Raw Input → 144× Molten Iron', blockingMode: false });
    expect([r.extraParts[0]!.amount, r.covers.map((c) => c.pos), r.warnings]).toEqual([2, [[1, 0, 1]], []]);
    // only the machines that take items get input from their output side: the chemical reactor takes only oxygen
    expect(r.configs.map((c) => c.pos)).toEqual([[1, 0, 1], [5, 0, 1]]);
  });
});
