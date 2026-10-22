import { describe, it, expect } from 'vitest';
import { unitsFromPlan, placeUnits, stepDepths, stepIo, overlaps, compactness, replacedCasings, attachCovers, type LocalBlock } from '../../../src/server/layout/arrange.ts';
import { emptyContext, planLine } from '../../../src/server/planner/plan.ts';
import { defaultSettings } from '../../../src/shared/project/apply-op.ts';
import { kitSpec } from '../../helpers/build-fixtures.ts';
import { FRONT_BOX_ELEMENTS, FRONT_BOX_ID, hatchExportPack, withElements } from '../../helpers/hatch-export-fixtures.ts';
import { layoutPack, makePlan, IDS, type StepSpec } from '../../helpers/layout-fixtures.ts';
import { packFromSpec } from '../../helpers/pack-spec.ts';
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
    expect(hatch('input_bus')).toMatchObject({ pos: [0, 0, 0], block: { mteId: IDS.INPUT_BUS_ULV }, label: 'Input Bus (ULV)', face: 2 });
    expect(hatch('output_bus')).toMatchObject({ pos: [2, 0, 0], block: { mteId: IDS.OUTPUT_BUS }, face: 2 });
    expect(hatch('energy')).toMatchObject({ pos: [1, 0, 2], block: { mteId: IDS.ENERGY_MV }, face: 3 });
    expect(hatch('maintenance')).toMatchObject({ pos: [0, 0, 2], block: { mteId: IDS.MAINTENANCE }, face: 3 });
    // GT's EBF takes an input hatch only on its bottom layer (element 'b'), so the oxygen goes in beside it, facing west
    expect(hatch('input_hatch')).toMatchObject({ pos: [0, 0, 1], block: { mteId: IDS.INPUT_HATCH }, face: 4, fluid: 'fluid:oxygen' });
    // and it needs a muffler on the top centre (element 'm'), facing up onto a cell kept as air
    expect(hatch('muffler')).toMatchObject({ pos: [1, 3, 1], block: { mteId: IDS.MUFFLER }, face: 1 });
    expect(hatch('energy')!.replaces).toBe('gregtech:gt.blockcasings@11');
    expect(ebf!.cells.filter((c) => c.role === 'casing')).toHaveLength(34 - 1 - 6);
    expect(ebf!.air).toEqual([[1, 1, 1], [1, 2, 1], [1, 4, 1]]);
    expect(replacedCasings([ebf!])).toEqual([{ key: 'gregtech:gt.blockcasings@11', amount: 6, why: 'replaced by hatches', group: 'machines' }]);
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

  it('lays out no unit for a shared owned machine', async () => {
    // Task 5's AE2 kit plan: circuit-lv, gear and kit share the group's own assembler (one sharing pool), so only the new
    // bender and wiremill are laid out
    const pack = packFromSpec(kitSpec());
    const owned = { ...emptyContext(), ownedMachines: [{ mteId: 121, count: 1, where: [{ dim: 0, pos: [10, 64, 10] as [number, number, number] }] }] };
    const plan = await planLine(pack, { ...defaultSettings(), target: 't:kit@0', tier: 1, automateCrafting: false, logistics: 'ae2' }, owned);
    expect(plan.steps.filter((s) => s.pool !== undefined).map((s) => s.id)).toEqual(['circuit-lv', 'gear', 'kit']);
    expect(unitsFromPlan(pack, plan).units.map((u) => [u.mteId, u.stepIds])).toEqual([[101, undefined], [111, undefined]]);
  });

  it('lays out one unit for a shared machine', () => {
    // s1 makes t:out_s1@0 from Raw Input and s2 makes t:out_s2@0 from it, on one macerator: an AE2 sharing pool (the
    // planner never pools a machine that feeds itself on a Project Red line, Task 3)
    const pool = { id: 'pool:s1', steps: ['s1', 's2'] };
    const steps: StepSpec[] = [{ id: 's1', mteId: IDS.MACERATOR, count: 1, pool }, { id: 's2', mteId: IDS.MACERATOR, count: 1, pool, inputs: [['t:out_s1@0', 1]] }];
    const pooled = makePlan(steps);
    const { units } = unitsFromPlan(layoutPack(), pooled);
    expect(units).toHaveLength(1);
    expect(units[0]).toMatchObject({ stepId: 's1', stepIds: ['s1', 's2'], mteId: IDS.MACERATOR, io: { itemIn: true, itemOut: true, fluidIn: [], fluidOut: [] } });
    // the same steps without the pool: a machine each
    const apart = unitsFromPlan(layoutPack(), makePlan(steps.map(({ pool: _pool, ...s }) => s))).units;
    expect(apart.map((u) => [u.stepId, u.stepIds])).toEqual([['s1', undefined], ['s2', undefined]]);
    // every cell of the shared machine names the steps it runs
    const machine = placeUnits(units, { headWidth: 1, portSpacing: 2 }).blocks.find((b) => b.role === 'machine');
    expect(machine).toMatchObject({ stepId: 's1', stepIds: ['s1', 's2'] });
  });

  it('sizes a shared multiblock for the largest need of its steps and runs it at the largest EU/t', () => {
    // two EBF steps of one pool: e1 takes 1 kind of item, e2 three; e2 draws more
    const pool = { id: 'pool:e1', steps: ['e1', 'e2'] };
    const plan = makePlan([
      { ...ebfStep, id: 'e1', pool, euPerTick: 120, inputs: [['t:dust@0', 1], ['fluid:oxygen', 1000]] },
      { ...ebfStep, id: 'e2', pool, euPerTick: 480, inputs: [['t:dust@0', 1], ['t:in@0', 1], ['t:ingot@0', 1], ['fluid:oxygen', 2000]] }], { flows: [] });
    const [ebf, ...more] = unitsFromPlan(layoutPack(), plan).units;
    expect(more).toEqual([]);
    expect(ebf).toMatchObject({ stepId: 'e1', stepIds: ['e1', 'e2'], euPerTick: 480 });
    // 3 kinds take the LV bus (4 slots), not the ULV one (1); 2,000 L of oxygen fit the LV input hatch
    expect(ebf!.cells.find((c) => c.hatch === 'input_bus')!.block.mteId).toBe(IDS.INPUT_BUS_LV);
  });

  it('keeps a shared multiblock ruled by the export alone electric when any step it runs draws EU', () => {
    // architecture §11 entry 49 (3): an export that took no energy hatch keeps a machine whose steps draw EU powered; the
    // first step of this pool draws none, the second does
    const pack = hatchExportPack();
    const box = pack.machines.get(FRONT_BOX_ID)!;
    box.structure = withElements(box.structure!, FRONT_BOX_ELEMENTS.map((s) => (s.ch === 'k' ? { ...s, hatches: [] } : s)));
    const pool = { id: 'pool:f1', steps: ['f1', 'f2'] };
    const step = { mteId: FRONT_BOX_ID, count: 1, tier: 1, pool, inputs: [['t:in@0', 1]] as Array<[string, number]>, outputs: [['t:dust@0', 1]] as Array<[string, number]> };
    const { units } = unitsFromPlan(pack, makePlan([{ ...step, id: 'f1', euPerTick: 0 }, { ...step, id: 'f2', euPerTick: 30 }], { flows: [] }));
    expect(units).toMatchObject([{ stepId: 'f1', stepIds: ['f1', 'f2'], euPerTick: 30, electric: true }]);
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
    // the EBF's input hatch faces west on its bottom layer: its port keeps a column of its own off the power head; the
    // placement is as tall as its cells kept empty too, the air above the muffler (architecture §11 entry 48)
    expect(p.size).toEqual([6, 5, 7]);
    const ebf = p.units[1]!;
    expect([ebf.row, ebf.at, ebf.facing]).toEqual(['S', [2, 0, 3], 2]);
    expect(p.blocks.find((b) => b.role === 'machine' && b.block.mteId === IDS.EBF)!.pos).toEqual([3, 0, 3]);
    expect(ebf.ports).toMatchObject({ power: [3, 0, 6], items: [[2, 0, 2], [4, 0, 2]], fluidIn: [[1, 0, 4]], fluidInSides: [5] });
    expect(p.blocks.find((b) => b.role === 'hatch' && b.block.mteId === IDS.INPUT_HATCH)).toMatchObject({ pos: [2, 0, 4], facing: 4 });
    // the hollow middle and the air above the muffler
    expect(p.reserved).toEqual([[3, 1, 4], [3, 2, 4], [3, 4, 4]]);
    expect(compactness(p)).toBeCloseTo(42 / 10, 5);
  });
});

// Final review C2 and the GT facings.
describe('placement: tiers apart, front and output side apart', () => {
  it('keeps machines fed at different tiers a column apart, also from the power head', () => {
    const { units } = unitsFromPlan(layoutPack(), twoStep());
    // MV supply: the head ends with the LV run, so the LV macerators stand at x 3 and the MV assembler at 5, not 4
    const p = placeUnits(units, { headWidth: 3, portSpacing: 0, supplyTier: 2 });
    expect(p.units.map((u) => [u.stepId, u.row, u.at[0]])).toEqual([['s1', 'N', 3], ['s1', 'S', 3], ['s2', 'N', 5]]);
    expect(p.units.map((u) => u.ports.power)).toEqual([[3, 0, 0], [3, 0, 4], [5, 0, 0]]);
    // an LV supply feeds all three at LV: no gap
    expect(placeUnits(units, { headWidth: 1, portSpacing: 0, supplyTier: 1 }).units.map((u) => u.at[0])).toEqual([1, 1, 2]);
    // the first unit of a row fed at another tier than the head's last run keeps a column away from it (the LV
    // macerator now stands first, next to the head; the MV assembler starts row S)
    const mvFirst = unitsFromPlan(layoutPack(), makePlan([{ id: 'a', mteId: IDS.ASSEMBLER, count: 1, tier: 2, euPerTick: 120 },
      { id: 'b', mteId: IDS.MACERATOR, count: 1, euPerTick: 30 }], { flows: [] })).units;
    expect(placeUnits(mvFirst, { headWidth: 3, portSpacing: 0, supplyTier: 2 }).units.map((u) => [u.stepId, u.row, u.at[0]]))
      .toEqual([['b', 'N', 3], ['a', 'S', 4]]);
  });

  it('stands the lowest feed tier next to the power head whatever the flow order, and leaves a steam machine in its place', () => {
    // Plan 5's final ruling: Task 6 grows the lowest tier's tree first from the head's last run, so a higher tier's
    // machines (and the tree that crosses the spine to them) standing in front of a lower tier's walled those off
    const STEAM = 2099;
    const pack = layoutPack();
    pack.machines.set(STEAM, { ...pack.machines.get(IDS.MACERATOR)!, mteId: STEAM, name: 'Steam Macerator', kind: 'steam' });
    const plan = makePlan([
      { id: 'h', mteId: IDS.CHEM_HV, count: 1, tier: 3, euPerTick: 256 },
      { id: 'm', mteId: IDS.ASSEMBLER, count: 2, tier: 2, euPerTick: 64 },
      { id: 's', mteId: STEAM, count: 1 },
      { id: 'l', mteId: IDS.MACERATOR, count: 1, euPerTick: 16 },
    ]);
    const { units } = unitsFromPlan(pack, plan);
    expect(units.map((u) => [u.stepId, u.electric])).toEqual([['h', true], ['m', true], ['m', true], ['s', false], ['l', true]]);
    // HV supply: the electric units take the electric units' slots LV first, then MV in flow order, then HV; the steam
    // macerator keeps its own slot (it has no feed tier)
    const hv = placeUnits(units, { headWidth: 5, portSpacing: 0, supplyTier: 3 });
    expect(hv.units.map((u) => [u.stepId, u.index, u.row, u.at[0]])).toEqual([['l', 0, 'N', 5], ['m', 0, 'S', 6], ['m', 1, 'N', 7], ['s', 0, 'S', 7], ['h', 0, 'N', 9]]);
    // MV supply: the HV reactor is fed at MV, so it keeps its flow place among the MV machines
    expect(placeUnits(units, { headWidth: 3, portSpacing: 0, supplyTier: 2 }).units.map((u) => u.stepId)).toEqual(['l', 'h', 'm', 's', 'm']);
    // without the supply tier the units keep their flow order
    expect(placeUnits(units, { headWidth: 5, portSpacing: 0 }).units.map((u) => u.stepId)).toEqual(['h', 'm', 'm', 's', 'l']);
  });

  it("gives every singleblock its front toward the power head and its output side toward the spine", () => {
    // GT 5.09.54 never lets a basic machine's front face up or down (MTEBasicMachine.isValidMainFacing), so a machine
    // without a fluid port gets the power-head side as well, never its top
    const plan = makePlan([{ id: 'm', mteId: IDS.MACERATOR, count: 1 }, { id: 'x', mteId: IDS.EXTRACTOR, count: 1, outputs: [['fluid:molten.iron', 144]] }]);
    const p = placeUnits(unitsFromPlan(layoutPack(), plan).units, { headWidth: 1, portSpacing: 0 });
    expect(p.units.map((u) => [u.stepId, u.facing, u.mainFacing])).toEqual([['m', 3, 4], ['x', 2, 4]]);
    expect(p.blocks.filter((b) => b.role === 'machine').map((b) => [b.facing, b.mainFacing])).toEqual([[3, 4], [2, 4]]);
    const ebf = placeUnits(unitsFromPlan(layoutPack(), makePlan([ebfStep])).units, { headWidth: 1, portSpacing: 0 });
    expect(ebf.units[0]!.mainFacing).toBeUndefined();
    expect(ebf.blocks.some((b) => b.mainFacing !== undefined)).toBe(false);
  });
});
