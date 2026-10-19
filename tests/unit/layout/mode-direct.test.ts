import { describe, it, expect } from 'vitest';
import { buildMode, PORT_SPACING, spineConflicts, placedStepIds } from '../../../src/server/layout/modes/mode.ts';
import { unitsFromPlan, placeUnits } from '../../../src/server/layout/arrange.ts';
import { resolveParts } from '../../../src/server/layout/parts.ts';
import { layoutPack, makePlan, makeScan, IDS } from '../../helpers/layout-fixtures.ts';
import type { Plan } from '../../../src/shared/types/plan.ts';

const CONV = 'gregtech:gt.metaitem.01@32630';
const FILTER = 'gregtech:gt.metaitem.01@32270';
const twoStep = () => makePlan([{ id: 's1', mteId: IDS.MACERATOR, count: 2 }, { id: 's2', mteId: IDS.ASSEMBLER, count: 1, tier: 2, euPerTick: 120 }]);
function setup(plan: Plan = twoStep(), pack = layoutPack()) {
  const placement = placeUnits(unitsFromPlan(pack, plan).units, { headWidth: 1, portSpacing: PORT_SPACING.direct });
  return { pack, plan, placement, parts: resolveParts(pack) };
}

describe('machine-to-machine mode', () => {
  it('lays one shared item pipe along the spine, with sized covers and chests', () => {
    const r = buildMode('direct', { ...setup(), network: null });
    expect(r.blocks.filter((b) => b.role === 'pipe').map((b) => [b.pos, b.block.mteId, b.connections])).toEqual([
      [[1, 0, 2], IDS.TIN_ITEM_PIPE, 4 | 8 | 32], [[2, 0, 2], IDS.TIN_ITEM_PIPE, 4 | 16 | 32], [[3, 0, 2], IDS.TIN_ITEM_PIPE, 4 | 8 | 16]]);
    expect(r.blocks.some((b) => b.role === 'cover')).toBe(false);
    expect(r.covers.map((c) => [c.pos, c.cover.face, c.cover.item])).toEqual([
      [[1, 0, 1], 'south', CONV], [[1, 0, 3], 'north', CONV], [[2, 0, 1], 'south', CONV], [[3, 0, 2], 'north', CONV], [[3, 0, 2], 'south', FILTER]]);
    expect(r.covers[0]!.cover.settings).toEqual({ mode: 'export', allowInput: true, rate: 0.5, unit: 'items/s' });   // 1 item/s shared by 2 macerators
    expect(r.covers[3]!.cover.settings).toEqual({ mode: 'import', allowInput: false, rate: 1, unit: 'items/s' });
    expect(r.blocks.filter((b) => b.role === 'chest').map((b) => [b.pos, b.label])).toEqual([[[3, 0, 1], 'Chest (input)'], [[3, 0, 3], 'Chest (output)']]);
    expect([r.logisticsPort, r.hookup, r.tailFluidY]).toEqual([null, null, 1]);
    expect(r.drafts.map((d) => d.id)).toEqual(['layout:logistics:line']);
    expect(r.drafts[0]!.text).toBe("Lay 3× Tin Item Pipe along the middle row so it touches every machine's front, with an input chest and an output chest at the end");
  });

  it('turns every machine on the shared pipe to Input Filter on, so it takes only items its recipes use', () => {
    const r = buildMode('direct', { ...setup(), network: null });
    const on = { inputFilter: true, inputFromOutputSide: true };
    expect(r.configs).toEqual([{ pos: [1, 0, 1], config: on }, { pos: [1, 0, 3], config: on }, { pos: [2, 0, 1], config: on }]);
    expect(r.warnings).toEqual([]);
  });

  it("warns when a machine's recipes also take another step's item from the shared pipe", () => {
    const pack = layoutPack();
    pack.machines.get(IDS.ASSEMBLER)!.maps = ['assembler'];
    pack.recipes.push({ id: 'asm-in', source: 'gt', maps: ['assembler'], inputs: [{ options: [{ key: 't:in@0', amount: 1 }], consumed: true, chance: 1, slot: 0 }],
      outputs: [{ key: 't:x@0', amount: 1, chance: 1 }], euPerTick: 30, durationTicks: 20, amps: 1, specialValue: 0, meta: {}, flags: {} });
    pack.consumers.set('t:in@0', [pack.recipes.length - 1]);
    const s = setup(twoStep(), pack);
    expect(spineConflicts(pack, s.plan, placedStepIds(s.placement))).toEqual([{ stepId: 's2', keys: ['t:in@0'] }]);
    expect(buildMode('direct', { ...s, network: null }).warnings).toEqual([{ code: 'spine_misroute', stepId: 's2',
      text: 'Advanced Assembler also has recipes for Raw Input carried by the shared pipe, so they can end up in it: give it its own pipe or feed it by hand' }]);
  });

  it('records each output-chest filter as a one-item whitelist CoverSpec', () => {
    const plan = makePlan([{ id: 's1', mteId: IDS.MACERATOR, count: 2 },
      { id: 's2', mteId: IDS.ASSEMBLER, count: 1, tier: 2, euPerTick: 120, outputs: [['t:out_s2@0', 1], ['t:by@0', 1]] }], { flows: [
      { from: 'raw', to: 's1', key: 't:in@0', perSecond: 1 }, { from: 's1', to: 's2', key: 't:out_s1@0', perSecond: 1 },
      { from: 's2', to: 'out', key: 't:out_s2@0', perSecond: 1 }, { from: 's2', to: 'sink', key: 't:by@0', perSecond: 1 }] });
    const r = buildMode('direct', { ...setup(plan), network: null });
    expect(r.covers.filter((c) => c.cover.item === FILTER)).toEqual([
      { pos: [3, 0, 2], cover: { face: 'south', item: FILTER, settings: { mode: 'whitelist' }, filter: ['t:by@0'] } },
      { pos: [3, 1, 2], cover: { face: 'south', item: FILTER, settings: { mode: 'whitelist' }, filter: ['t:out_s2@0'] } }]);
    expect(r.blocks.filter((b) => b.role === 'chest').map((b) => b.pos)).toEqual([[3, 0, 1], [3, 0, 3], [3, 1, 3]]);
    expect(r.tailFluidY).toBe(2);
  });

  it('feeds the input chest from a routed network when the base has one', () => {
    const network = makeScan({ logistics: [{ kind: 'routed', taps: [[0, 64, 0]] }] }).logistics[0]!;
    const r = buildMode('direct', { ...setup(), network });
    expect(r.logisticsPort).toEqual([3, 0, 1]);
    expect(r.hookup).toEqual({ part: 'pr_junction', end: 'pr_interface', endConfig: { chips: 'Item Stock Keeper Chip, keep in stock: Raw Input' } });
    expect(r.extraParts).toEqual([{ key: 'ProjRed|Transportation:projectred.transportation.routingchip@6', amount: 1, why: 'stock keeper on the input chest', group: 'logistics' }]);
  });

  it('hooks an EnderIO item network through a whitelisted extract filter', () => {
    const network = makeScan({ logistics: [{ kind: 'enderio', taps: [[0, 64, 0]] }] }).logistics[0]!;
    const r = buildMode('direct', { ...setup(), network });
    expect([r.logisticsPort, r.hookup]).toEqual([[3, 0, 1], { part: 'eio_item_conduit', end: null }]);
    expect(r.extraParts).toEqual([{ key: 'EnderIO:itemBasicFilterUpgrade@0', amount: 1, why: 'filter at the storage tap', group: 'logistics' }]);
    expect(r.drafts.at(-1)).toEqual({ id: 'layout:configure:conduit', kind: 'configure', pin: 'logistics',
      text: 'At the storage tap set the conduit face to Extract with a Basic Item Filter, whitelist: Raw Input; on the input chest face set Insert' });
  });
});
