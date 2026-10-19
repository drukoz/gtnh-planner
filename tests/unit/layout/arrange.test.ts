import { describe, it, expect } from 'vitest';
import { unitsFromPlan, placeUnits, stepDepths, stepIo, overlaps, compactness, replacedCasings, attachCovers, type LocalBlock } from '../../../src/server/layout/arrange.ts';
import { layoutPack, makePlan, IDS } from '../../helpers/layout-fixtures.ts';
import type { Recipe } from '../../../src/shared/types/pack.ts';

const withCircuit = (id: string, circuit: number): Recipe => ({ id, source: 'gt', maps: [], inputs: [], outputs: [], euPerTick: 30, durationTicks: 100,
  amps: 1, specialValue: 0, meta: { circuit }, flags: {} });

const twoStep = () => makePlan([
  { id: 's1', mteId: IDS.MACERATOR, count: 2, euPerTick: 30 },
  { id: 's2', mteId: IDS.ASSEMBLER, count: 1, tier: 2, euPerTick: 120 },
]);
const ebfStep = { id: 'e', mteId: IDS.EBF, count: 1, tier: 2, euPerTick: 120,
  inputs: [['t:dust@0', 1], ['fluid:oxygen', 1000]] as Array<[string, number]>, outputs: [['t:ingot@0', 1]] as Array<[string, number]> };

describe('units', () => {
  it('makes one unit per new machine, in flow order', () => {
    const plan = makePlan([
      { id: 's2', mteId: IDS.ASSEMBLER, count: 3, owned: 1, tier: 2 },
      { id: 's1', mteId: IDS.MACERATOR, count: 1 },
      { id: 's3', mteId: IDS.MACERATOR, count: 1, handCraft: true },
    ], { flows: [
      { from: 'raw', to: 's1', key: 't:in@0', perSecond: 1 },
      { from: 's1', to: 's2', key: 't:out_s1@0', perSecond: 1 },
      { from: 's2', to: 'out', key: 't:out_s2@0', perSecond: 1 },
    ] });
    expect(stepDepths(plan)).toEqual(new Map([['s1', 0], ['s2', 1], ['s3', 0]]));
    const { units, warnings } = unitsFromPlan(layoutPack(), plan);
    expect(units.map((u) => `${u.stepId}#${u.index}`)).toEqual(['s1#0', 's2#0', 's2#1']);
    expect(units[1]).toMatchObject({ mteId: IDS.ASSEMBLER, name: 'Advanced Assembler', tier: 2, multiblock: false, size: [1, 1, 1], electric: true });
    expect(warnings).toEqual([]);
  });

  it('reads the item and fluid sides of a step', () => {
    const plan = makePlan([{ id: 's1', mteId: IDS.EXTRACTOR, count: 1, outputs: [['fluid:molten.iron', 144]] }]);
    expect(stepIo(plan.steps[0]!)).toEqual({ itemIn: true, itemOut: false, fluidIn: [], fluidOut: ['fluid:molten.iron'] });
  });

  it('gives a multiblock its structure, hatches on the right faces and its air cells', () => {
    const [ebf] = unitsFromPlan(layoutPack(), makePlan([ebfStep])).units;
    const hatch = (k: string) => ebf!.cells.find((c) => c.hatch === k);
    expect(ebf!.size).toEqual([3, 4, 3]);
    expect(hatch('input_bus')).toMatchObject({ pos: [0, 0, 0], block: { mteId: IDS.INPUT_BUS_ULV }, label: 'Input Bus (ULV)' });
    expect(hatch('output_bus')).toMatchObject({ pos: [2, 0, 0], block: { mteId: IDS.OUTPUT_BUS } });
    expect(hatch('energy')).toMatchObject({ pos: [1, 0, 2], block: { mteId: IDS.ENERGY_MV } });
    expect(hatch('maintenance')).toMatchObject({ pos: [0, 0, 2], block: { mteId: IDS.MAINTENANCE } });
    expect(hatch('input_hatch')).toMatchObject({ pos: [0, 3, 0], block: { mteId: IDS.INPUT_HATCH } });
    expect(hatch('energy')!.replaces).toBe('gregtech:gt.blockcasings@11');
    expect(ebf!.cells.filter((c) => c.role === 'casing')).toHaveLength(34 - 1 - 5);
    expect(ebf!.air).toEqual([[1, 1, 1], [1, 2, 1]]);
    expect(replacedCasings([ebf!])).toEqual([{ key: 'gregtech:gt.blockcasings@11', amount: 5, why: 'replaced by hatches', group: 'machines' }]);
  });

  it('sizes buses to the recipe and puts the programmed circuit on the machine or its input bus', () => {
    const pack = layoutPack();
    pack.recipeById.set('m', withCircuit('m', 3));
    pack.recipeById.set('e', withCircuit('e', 2));
    const plan = makePlan([{ id: 'm', mteId: IDS.MACERATOR, count: 1 },
      { ...ebfStep, inputs: [['t:dust@0', 1], ['t:in@0', 1], ['fluid:oxygen', 1000]] as Array<[string, number]> }]);
    const [mac, ebf] = unitsFromPlan(pack, plan).units;
    expect(mac!.cells[0]!.config).toEqual({ circuit: 3 });
    expect(ebf!.cells.find((c) => c.hatch === 'input_bus')).toMatchObject({ block: { mteId: IDS.INPUT_BUS_LV }, config: { circuit: 2 } });   // 2 item inputs > 1 ULV slot
    expect(ebf!.cells.find((c) => c.role === 'machine')!.config).toBeUndefined();
  });

  it('attaches covers and settings to the block at their position', () => {
    const blocks: LocalBlock[] = [{ pos: [1, 0, 1], block: { id: 'm', meta: 0 }, role: 'machine', label: 'M', config: { circuit: 1 } },
      { pos: [2, 0, 1], block: { id: 'p', meta: 0 }, role: 'pipe', label: 'P' }];
    const cover = { face: 'south' as const, item: 'gregtech:gt.metaitem.01@32630', settings: { mode: 'export' } };
    expect(attachCovers(blocks, [{ pos: [1, 0, 1], cover }], [{ pos: [1, 0, 1], config: { inputFilter: true } }])).toEqual([
      { ...blocks[0], covers: [cover], config: { circuit: 1, inputFilter: true } }, blocks[1]]);
    expect(() => attachCovers(blocks, [{ pos: [9, 9, 9], cover }], [])).toThrow('no host block at 9,9,9');
  });

  it('draws a multiblock without an exported structure as a 3×3×3 box and says so', () => {
    const pack = layoutPack();
    delete pack.machines.get(IDS.EBF)!.structure;
    const { units, warnings } = unitsFromPlan(pack, makePlan([{ id: 'e', mteId: IDS.EBF, count: 1, tier: 2 }]));
    expect(units[0]!.size).toEqual([3, 3, 3]);
    expect(warnings).toEqual([{ code: 'structure_unknown', stepId: 'e',
      text: 'Electric Blast Furnace: no exported structure, drawn as a 3×3×3 box — check its real size in game' }]);
  });
});

describe('placement', () => {
  it('puts units in two rows facing a shared spine (machine-to-machine)', () => {
    const p = placeUnits(unitsFromPlan(layoutPack(), twoStep()).units, { headWidth: 1, portSpacing: 0 });
    expect(p.size).toEqual([4, 1, 5]);
    expect([p.spineZ, p.firstX, p.tailX]).toEqual([2, 1, 3]);
    expect(p.units.map((u) => [u.stepId, u.row, u.at, u.facing])).toEqual([
      ['s1', 'N', [1, 0, 1], 3], ['s1', 'S', [1, 0, 3], 2], ['s2', 'N', [2, 0, 1], 3]]);
    expect(p.units.map((u) => u.ports.power)).toEqual([[1, 0, 0], [1, 0, 4], [2, 0, 0]]);
    expect(p.units.map((u) => u.ports.items)).toEqual([[[1, 0, 2]], [[1, 0, 2]], [[2, 0, 2]]]);
    expect(p.blocks.filter((b) => b.role === 'machine').map((b) => [b.pos, b.facing, b.block.mteId])).toEqual([
      [[1, 0, 1], 3, IDS.MACERATOR], [[1, 0, 3], 2, IDS.MACERATOR], [[2, 0, 1], 3, IDS.ASSEMBLER]]);
    expect(overlaps(p.blocks)).toEqual([]);
  });

  it('gives each unit its own spine cell (routed) and keeps AE2 interfaces apart', () => {
    const { units } = unitsFromPlan(layoutPack(), twoStep());
    expect(placeUnits(units, { headWidth: 1, portSpacing: 1 }).units.map((u) => u.at[0])).toEqual([1, 2, 3]);
    const ae2 = placeUnits(units, { headWidth: 1, portSpacing: 2 });
    expect(ae2.units.map((u) => u.at[0])).toEqual([1, 3, 5]);
    expect(ae2.tailX).toBe(6);
  });

  it('turns multiblocks to face the spine and keeps their air cells free', () => {
    const plan = makePlan([{ id: 'm', mteId: IDS.MACERATOR, count: 1 }, ebfStep]);
    const p = placeUnits(unitsFromPlan(layoutPack(), plan).units, { headWidth: 1, portSpacing: 0 });
    expect(p.size).toEqual([5, 4, 7]);
    const ebf = p.units[1]!;
    expect([ebf.row, ebf.at, ebf.facing]).toEqual(['S', [1, 0, 3], 2]);
    expect(p.blocks.find((b) => b.role === 'machine' && b.block.mteId === IDS.EBF)!.pos).toEqual([2, 0, 3]);
    expect(ebf.ports).toMatchObject({ power: [2, 0, 6], items: [[1, 0, 2], [3, 0, 2]], fluidIn: [[1, 4, 3]] });
    expect(p.reserved).toEqual([[2, 1, 4], [2, 2, 4]]);
    expect(compactness(p)).toBeCloseTo(35 / 10, 5);
  });
});
