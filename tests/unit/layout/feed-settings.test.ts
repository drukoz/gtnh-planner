// The feeding settings of the routed, AE2 and EnderIO lines (architecture §11 entry 51; research
// docs/research/machine-feeding.md §1.1.3, §1.2, §3.7 and §6.4 item 2, from GT 5.09.54's bytecode): a GT basic machine
// fed two or more kinds of item gets Multi Stack Input off (with it on, the first kind to arrive fills every free input
// slot), an input bus fed two or more gets Limiting mode on, and a multiblock with two or more input buses Input
// Separation off; each set where the configure steps say how, in add-on 15's words and the research's.

import { describe, expect, it } from 'vitest';
import { placeUnits, unitsFromPlan, type Placement } from '../../../src/server/layout/arrange.ts';
import { emptyScan, layoutLine } from '../../../src/server/layout/layout.ts';
import { buildMode, feedSettings, PORT_SPACING } from '../../../src/server/layout/modes/mode.ts';
import { resolveParts } from '../../../src/server/layout/parts.ts';
import { configTexts } from '../../../src/shared/layout/configure-text.ts';
import type { LogisticsMode, Plan } from '../../../src/shared/types/plan.ts';
import { IDS, layoutPack, makePlan, makeProject, makeScan } from '../../helpers/layout-fixtures.ts';

const MODES: readonly LogisticsMode[] = ['routed', 'ae2', 'enderio'];
const MULTI_STACK_OFF = configTexts({ multiStack: false })[0]!;
const LIMITING_ON = configTexts({ limited: true })[0]!;

/** a (an assembler) takes Raw Input and Titanium Dust; m (a macerator) takes a's product only. */
const twoKinds = () => makePlan([
  { id: 'a', mteId: IDS.ASSEMBLER, count: 1, tier: 2, inputs: [['t:in@0', 1], ['t:dust@0', 1]], outputs: [['t:x@0', 1]] },
  { id: 'm', mteId: IDS.MACERATOR, count: 1, inputs: [['t:x@0', 1]], outputs: [['t:y@0', 1]] },
], { flows: [{ from: 'raw', to: 'a', key: 't:in@0', perSecond: 1 }, { from: 'raw', to: 'a', key: 't:dust@0', perSecond: 1 },
  { from: 'a', to: 'm', key: 't:x@0', perSecond: 1 }, { from: 'm', to: 'out', key: 't:y@0', perSecond: 1 }] });

/** e (an EBF) takes Raw Input and Titanium Dust through its input bus. */
const ebfTwoKinds = () => makePlan([{ id: 'e', mteId: IDS.EBF, count: 1, tier: 2, euPerTick: 120, inputs: [['t:in@0', 1], ['t:dust@0', 1]],
  outputs: [['t:ingot@0', 1]] }], { flows: [{ from: 'raw', to: 'e', key: 't:in@0', perSecond: 1 }, { from: 'raw', to: 'e', key: 't:dust@0', perSecond: 1 },
  { from: 'e', to: 'out', key: 't:ingot@0', perSecond: 1 }] });

function setup(mode: LogisticsMode, plan: Plan) {
  const pack = layoutPack();
  const placement = placeUnits(unitsFromPlan(pack, plan).units, { headWidth: 1, portSpacing: PORT_SPACING[mode] });
  const kind = mode === 'enderio' ? 'enderio' : mode === 'ae2' ? 'ae2' : 'routed';
  const network = makeScan({ logistics: [{ kind, taps: [[0, 64, 0]] }] }).logistics[0]!;
  return { pack, plan, placement, parts: resolveParts(pack), network };
}

const machineAt = (placement: Placement, stepId: string) => placement.blocks.find((b) => b.stepId === stepId && b.role === 'machine')!.pos;
const busAt = (placement: Placement, stepId: string) => placement.blocks.find((b) => b.stepId === stepId && b.hatch === 'input_bus')!.pos;

describe('feeding settings', () => {
  it.each(MODES)('turns Multi Stack Input off on a basic machine fed two kinds of item, and only there (%s)', (mode) => {
    const input = setup(mode, twoKinds());
    const r = buildMode(mode, input);
    const configAt = (pos: readonly number[]) => r.configs.find((c) => c.pos.join(',') === pos.join(','))?.config;
    expect(configAt(machineAt(input.placement, 'a'))).toEqual({ inputFromOutputSide: true, multiStack: false });
    expect(configAt(machineAt(input.placement, 'm'))).toEqual({ inputFromOutputSide: true });
    // one entry per block, sorted by position
    expect(r.configs.map((c) => c.pos.join(','))).toEqual([...new Set(r.configs.map((c) => c.pos.join(',')))]);
  });

  it.each(MODES)('turns Limiting mode on on an input bus fed two kinds of item (%s)', (mode) => {
    const input = setup(mode, ebfTwoKinds());
    const r = buildMode(mode, input);
    const bus = busAt(input.placement, 'e');
    expect(r.configs.filter((c) => c.pos.join(',') === bus.join(',')).map((c) => c.config)).toEqual([{ limited: true }]);
  });

  it('turns Input Separation off on a multiblock that takes its items through two input buses', () => {
    const { pack, plan, placement } = setup('routed', ebfTwoKinds());
    expect(feedSettings(pack, plan, placement).map((c) => c.config)).toEqual([{ limited: true }]);
    // a second input bus on the same unit (no layout of main lays one; add-on 15's lanes may)
    const unit = placement.units[0]!;
    const casing = unit.cells.findIndex((c) => c.role === 'casing' && c.pos[1] === 0);
    unit.cells[casing] = { ...unit.cells[casing]!, role: 'hatch', hatch: 'input_bus' };
    expect(feedSettings(pack, plan, placement)).toEqual([
      { pos: machineAt(placement, 'e'), config: { inputSeparation: false } }, { pos: busAt(placement, 'e'), config: { limited: true } }]
      .sort((a, b) => a.pos[0] - b.pos[0] || a.pos[1] - b.pos[1] || a.pos[2] - b.pos[2]));
  });

  it('leaves Multi Stack Input as it is on a machine fed one kind of item', () => {
    const { pack, plan, placement } = setup('enderio', makePlan([{ id: 'm', mteId: IDS.MACERATOR, count: 2 }]));
    expect(feedSettings(pack, plan, placement)).toEqual([]);
  });

  it.each(MODES)('says how to set them in the configure steps (%s)', async (mode) => {
    const project = makeProject({ logistics: mode, scanId: null, baseId: null });
    const pack = layoutPack();
    const machine = await layoutLine(pack, twoKinds(), emptyScan(), project);
    expect(machine.buildSteps.find((s) => s.id === 'layout:configure:a')?.text).toContain(`; ${MULTI_STACK_OFF}`);
    expect(machine.buildSteps.find((s) => s.id === 'layout:configure:m')?.text ?? '').not.toContain('Multi Stack');
    const ebf = await layoutLine(pack, ebfTwoKinds(), emptyScan(), project);
    expect(ebf.buildSteps.filter((s) => s.kind === 'configure').map((s) => s.text)).toContainEqual(expect.stringContaining(LIMITING_ON));
  });
});
