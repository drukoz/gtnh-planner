import { describe, it, expect } from 'vitest';
import { routeInternal, fluidNets, headWidthFor, runX } from '../../../src/server/layout/internal.ts';
import { unitsFromPlan, placeUnits, type LocalBlock, type Unit } from '../../../src/server/layout/arrange.ts';
import { tierGroups, transformerStages } from '../../../src/server/layout/power.ts';
import { resolveParts } from '../../../src/server/layout/parts.ts';
import { layoutPack, makePlan, IDS } from '../../helpers/layout-fixtures.ts';
import { posKey, step, type Vec3 } from '../../../src/shared/layout/geometry.ts';

const twoStep = () => makePlan([
  { id: 's1', mteId: IDS.MACERATOR, count: 2, euPerTick: 30 },
  { id: 's2', mteId: IDS.ASSEMBLER, count: 1, tier: 2, euPerTick: 120 },
]);
const groupsOf = (units: Unit[]) => tierGroups(units.filter((u) => u.electric).map((u) => ({ tier: u.tier, euPerTick: u.euPerTick })));

function reachesRun(blocks: LocalBlock[], from: Vec3, x: number): boolean {
  const cables = new Map(blocks.filter((b) => b.role === 'cable').map((b) => [posKey(b.pos), b]));
  const seen = new Set<string>();
  const queue = [from];
  while (queue.length) {
    const p = queue.shift()!;
    const b = cables.get(posKey(p));
    if (!b || seen.has(posKey(p))) continue;
    seen.add(posKey(p));
    if (p[0] === x && p[1] === 0) return true;
    for (let s = 0; s < 6; s++) if ((b.connections ?? 0) & (1 << s)) queue.push(step(p, s));
  }
  return false;
}

describe('internal routing', () => {
  it('builds the power head and wires every machine from the run of its own tier', () => {
    const pack = layoutPack();
    const { units } = unitsFromPlan(pack, twoStep());
    const stages = transformerStages(groupsOf(units), 2);
    expect(headWidthFor(stages)).toBe(3);
    expect([runX(2, 2), runX(2, 1)]).toEqual([0, 2]);
    const placement = placeUnits(units, { headWidth: 3, portSpacing: 0 });
    const r = routeInternal({ pack, parts: resolveParts(pack), placement, occupied: placement.blocks, stages, fluids: [], tailFluidY: 1, groupTier: 2 });
    const at = (p: Vec3) => r.blocks.filter((b) => posKey(b.pos) === posKey(p));
    expect(at([1, 0, 2])).toMatchObject([{ role: 'transformer', facing: 4, block: { mteId: IDS.TRANSFORMER_LV }, label: 'Low Voltage Transformer' }]);
    expect([0, 1, 2, 3, 4].map((z) => at([0, 0, z])[0]!.block.mteId)).toEqual(Array(5).fill(IDS.ANNEALED_2X));
    expect([0, 1, 2, 3, 4].map((z) => at([2, 0, z])[0]!.block.mteId)).toEqual(Array(5).fill(IDS.TIN_2X));
    expect(r.supplyRun).toEqual([[0, 0, 0], [0, 0, 1], [0, 0, 2], [0, 0, 3], [0, 0, 4]]);
    expect(r.cables.map((c) => [c.tier, c.cable.mteId])).toEqual([[2, IDS.ANNEALED_2X], [1, IDS.TIN_2X]]);
    expect(r.warnings).toEqual([]);
    expect(placement.units.map((u) => reachesRun(r.blocks, u.ports.power!, runX(2, u.tier)))).toEqual([true, true, true]);
    expect(placement.units.filter((u) => u.tier === 1).some((u) => reachesRun(r.blocks, u.ports.power!, 0))).toBe(false);
    const used = new Set([...placement.blocks.map((b) => posKey(b.pos)), ...placement.reserved.map(posKey)]);
    expect(r.blocks.filter((b) => used.has(posKey(b.pos)))).toEqual([]);
  });

  it('wires a machine above the supply tier to the supply run and warns', () => {
    const pack = layoutPack();
    const { units } = unitsFromPlan(pack, twoStep());
    const stages = transformerStages(groupsOf(units), 1);
    const placement = placeUnits(units, { headWidth: headWidthFor(stages), portSpacing: 0 });
    const r = routeInternal({ pack, parts: resolveParts(pack), placement, occupied: placement.blocks, stages, fluids: [], tailFluidY: 1, groupTier: 2 });
    expect(r.warnings).toContainEqual({ code: 'power_tier_low', stepId: 's2',
      text: 'Advanced Assembler needs MV power but the line gets LV: it will run short — add a step-up transformer or a generator at MV' });
    expect(r.warnings).toContainEqual({ code: 'cable_amps', text: 'No cable carries 6 A at LV: run 2 parallel 4x Tin Cable lines' });
    expect(reachesRun(r.blocks, placement.units[2]!.ports.power!, 0)).toBe(true);
  });

  it('lays one fluid pipe per fluid, with pump covers on the machines that make it', () => {
    const pack = layoutPack();
    const plan = makePlan([
      { id: 'x', mteId: IDS.EXTRACTOR, count: 1, outputs: [['fluid:molten.iron', 144]] },
      { id: 'y', mteId: IDS.SOLIDIFIER, count: 1, inputs: [['fluid:molten.iron', 144]], outputs: [['t:out_y@0', 1]] },
    ]);
    const placement = placeUnits(unitsFromPlan(pack, plan).units, { headWidth: 1, portSpacing: 0 });
    const nets = fluidNets(pack, plan, placement);
    expect(nets).toEqual([{ key: 'fluid:molten.iron', name: 'Molten Iron', litresPerSecond: 1, producers: [[1, 1, 1]], consumers: [[1, 1, 3]],
      atTail: false, faces: [{ pos: [1, 0, 1], side: 1, stepId: 'x', rate: 1 }] }]);
    const r = routeInternal({ pack, parts: resolveParts(pack), placement, occupied: placement.blocks, stages: null, fluids: nets, tailFluidY: 1, groupTier: 1 });
    expect(r.blocks.filter((b) => b.role === 'pipe').map((b) => [b.pos, b.block.mteId, b.connections])).toEqual([
      [[1, 1, 1], IDS.SMALL_BRONZE_PIPE, 1 | 8], [[1, 1, 2], IDS.SMALL_BRONZE_PIPE, 4 | 8], [[1, 1, 3], IDS.SMALL_BRONZE_PIPE, 1 | 4]]);
    expect(r.covers).toEqual([{ pos: [1, 0, 1], cover: { face: 'up', item: 'gregtech:gt.metaitem.01@32610',
      settings: { mode: 'export', allowInput: false, rate: 1, unit: 'L/s' } } }]);
    expect(r.blocks.some((b) => b.role === 'cover')).toBe(false);
    expect(r.fluidPipes.map((f) => [f.key, f.pipe.mteId, f.cells])).toEqual([['fluid:molten.iron', IDS.SMALL_BRONZE_PIPE, 3]]);
  });

  it('warns cover_rate when no cover at the group tier carries the flow', () => {
    const pack = layoutPack();
    const plan = makePlan([
      { id: 'x', mteId: IDS.EXTRACTOR, count: 1, outputs: [['fluid:molten.iron', 144]] },
      { id: 'y', mteId: IDS.SOLIDIFIER, count: 1, inputs: [['fluid:molten.iron', 144]], outputs: [['t:out_y@0', 1]] },
    ], { flows: [{ from: 'raw', to: 'x', key: 't:in@0', perSecond: 1 }, { from: 'x', to: 'y', key: 'fluid:molten.iron', perSecond: 1000 },
      { from: 'y', to: 'out', key: 't:out_y@0', perSecond: 1 }] });
    const placement = placeUnits(unitsFromPlan(pack, plan).units, { headWidth: 1, portSpacing: 0 });
    const route = (groupTier: number) => routeInternal({ pack, parts: resolveParts(pack), placement, occupied: placement.blocks, stages: null,
      fluids: fluidNets(pack, plan, placement), tailFluidY: 1, groupTier });
    const lv = route(1);
    expect(lv.covers[0]!.cover.item).toBe('gregtech:gt.metaitem.01@32610');
    expect(lv.warnings).toContainEqual({ code: 'cover_rate', stepId: 'x',
      text: 'No pump cover up to LV moves 1,000 L/s out of Basic Fluid Extractor: the Electric Pump (LV) moves 640 L/s, so the line runs slower' });
    const mv = route(2);
    expect(mv.covers[0]!.cover.item).toBe('gregtech:gt.metaitem.01@32611');
    expect(mv.warnings.map((w) => w.code)).not.toContain('cover_rate');
  });
});

// Behaviours the plan leaves open (task 6 report, "Decision" entries); not part of the plan's four tests.
describe('internal routing edge cases', () => {
  const stone = (pos: Vec3): LocalBlock => ({ pos, block: { id: 'minecraft:stone', meta: 0 }, role: 'casing', label: 'Stone' });
  const route = (pack: ReturnType<typeof layoutPack>, plan: ReturnType<typeof makePlan>, supply: number | null, extra: LocalBlock[] = []) => {
    const { units } = unitsFromPlan(pack, plan);
    const stages = supply === null ? null : transformerStages(groupsOf(units), supply);
    const placement = placeUnits(units, { headWidth: headWidthFor(stages), portSpacing: 0 });
    const r = routeInternal({ pack, parts: resolveParts(pack), placement, occupied: [...placement.blocks, ...extra], stages,
      fluids: fluidNets(pack, plan, placement), tailFluidY: 1, groupTier: 2 });
    return { placement, r };
  };
  const blockAt = (r: { blocks: LocalBlock[] }, p: Vec3) => r.blocks.find((b) => posKey(b.pos) === posKey(p));

  it('says so when a machine cannot be wired inside the line', () => {
    const pack = layoutPack();
    const { placement, r } = route(pack, twoStep(), 2, [stone([4, 1, 0]), stone([5, 0, 0])]);
    expect(r.warnings).toEqual([{ code: 'route_failed', stepId: 's2', text: 'Could not wire Advanced Assembler inside the line — connect it by hand' }]);
    expect(blockAt(r, [4, 0, 0])).toBeUndefined();
    expect(placement.units.filter((u) => u.tier === 1).map((u) => reachesRun(r.blocks, u.ports.power!, 2))).toEqual([true, true]);
  });

  it('keeps cables off the cells the fluid pipes connect to', () => {
    const pack = layoutPack();
    const plan = makePlan([
      { id: 's1', mteId: IDS.MACERATOR, count: 2, euPerTick: 30, inputs: [['t:in@0', 1], ['fluid:oxygen', 10]] },
      { id: 's2', mteId: IDS.ASSEMBLER, count: 1, tier: 2, euPerTick: 120 },
    ], { flows: [{ from: 'raw', to: 's1', key: 't:in@0', perSecond: 1 }, { from: 'raw', to: 's1', key: 'fluid:oxygen', perSecond: 20 },
      { from: 's1', to: 's2', key: 't:out_s1@0', perSecond: 1 }, { from: 's2', to: 'out', key: 't:out_s2@0', perSecond: 1 }] });
    // with the lane above the first macerator blocked, the shortest MV route would cross that macerator's fluid port
    const { placement, r } = route(pack, plan, 2, [stone([3, 1, 0]), stone([4, 1, 2])]);
    const fluidCells = new Set([...placement.units.flatMap((u) => u.ports.fluidIn.map(posKey)), '5,1,2']);
    expect(r.blocks.filter((b) => b.role === 'cable' && fluidCells.has(posKey(b.pos)))).toEqual([]);
    expect(placement.units.map((u) => reachesRun(r.blocks, u.ports.power!, runX(2, u.tier)))).toEqual([true, true, true]);
    expect([[3, 1, 1], [3, 1, 3], [5, 1, 2]].map((p) => [blockAt(r, p as Vec3)?.label, (blockAt(r, p as Vec3)?.connections ?? 0) & 1]))
      .toEqual([['Small Bronze Fluid Pipe (Oxygen)', 1], ['Small Bronze Fluid Pipe (Oxygen)', 1], ['Small Bronze Fluid Pipe (Oxygen)', 0]]);
    expect(r.warnings).toEqual([]);
  });

  it('lays a second fluid that enters the line above the first, even over the units', () => {
    const pack = layoutPack();
    const plan = makePlan([
      { id: 's1', mteId: IDS.SOLIDIFIER, count: 1, inputs: [['fluid:molten.iron', 144]] },
      { id: 's2', mteId: IDS.SOLIDIFIER, count: 1, inputs: [['fluid:oxygen', 10]] },
    ], { flows: [{ from: 'raw', to: 's1', key: 'fluid:molten.iron', perSecond: 1 }, { from: 'raw', to: 's2', key: 'fluid:oxygen', perSecond: 1 },
      { from: 's1', to: 'out', key: 't:out_s1@0', perSecond: 1 }, { from: 's2', to: 'out', key: 't:out_s2@0', perSecond: 1 }] });
    const { placement, r } = route(pack, plan, null);
    expect([placement.size[1], placement.tailX, placement.spineZ]).toEqual([1, 2, 2]);
    expect([blockAt(r, [2, 1, 2])?.label, blockAt(r, [2, 2, 2])?.label]).toEqual(['Small Bronze Fluid Pipe (Molten Iron)', 'Small Bronze Fluid Pipe (Oxygen)']);
    expect([[1, 1, 1], [1, 1, 3]].map((p) => (blockAt(r, p as Vec3)?.connections ?? 0) & 1)).toEqual([1, 1]);
    expect(r.fluidPipes.map((f) => f.key)).toEqual(['fluid:molten.iron', 'fluid:oxygen']);
    expect(r.warnings).toEqual([]);
  });

  it('puts one pump on a face that makes two fluids, sized for both', () => {
    const pack = layoutPack();
    const plan = makePlan([{ id: 'x', mteId: IDS.EXTRACTOR, count: 1, outputs: [['fluid:molten.iron', 144], ['fluid:oxygen', 10]] }], {
      flows: [{ from: 'raw', to: 'x', key: 't:in@0', perSecond: 1 }, { from: 'x', to: 'out', key: 'fluid:molten.iron', perSecond: 2 },
        { from: 'x', to: 'out', key: 'fluid:oxygen', perSecond: 3 }] });
    const { r } = route(pack, plan, null);
    expect(r.covers).toEqual([{ pos: [1, 0, 1], cover: { face: 'up', item: 'gregtech:gt.metaitem.01@32610',
      settings: { mode: 'export', allowInput: false, rate: 5, unit: 'L/s' } } }]);
    // a singleblock has one cell above it for all its fluids, so only the first fluid's pipe reaches it
    expect(r.warnings).toEqual([{ code: 'route_failed', stepId: 'x', text: 'Could not lay the Oxygen pipe to Basic Fluid Extractor — connect it by hand' }]);
  });

  it('fills the bank column and asks for parallel runs when one cable or column is not enough', () => {
    const pack = layoutPack();
    const { placement, r } = route(pack, makePlan([{ id: 's1', mteId: IDS.MACERATOR, count: 1, euPerTick: 672 }]), 2);
    expect(placement.size[2]).toBe(4);
    expect(r.blocks.filter((b) => b.role === 'transformer').map((b) => [b.pos, b.connections])).toEqual(
      [0, 1, 2, 3].map((z) => [[1, 0, z], (1 << 4) | (1 << 5)]));
    expect(r.warnings).toEqual([
      { code: 'cable_amps', text: 'No cable carries 6 A at MV: run 3 parallel 2x Annealed Copper Cable lines' },
      { code: 'cable_amps', text: 'No cable carries 21 A at LV: run 6 parallel 4x Tin Cable lines' },
      { code: 'transformer_bank', text: 'Put 2 more Low Voltage Transformer beside the bank' },
    ]);
    expect(reachesRun(r.blocks, placement.units[0]!.ports.power!, 2)).toBe(true);
    // a deep multiblock in row N only: the bank centred on the spine would leave the line, so it moves back inside
    const ebf = route(pack, makePlan([{ id: 'b', mteId: IDS.EBF, count: 1, euPerTick: 544 }]), 2);
    expect([ebf.placement.size[2], ebf.placement.spineZ]).toEqual([6, 4]);
    expect(ebf.r.blocks.filter((b) => b.role === 'transformer').map((b) => b.pos[2])).toEqual([1, 2, 3, 4, 5]);
  });

  it("keeps one fluid's pipe off the cells another fluid connects to", () => {
    const pack = layoutPack();
    const plan = makePlan([
      { id: 'a', mteId: IDS.SOLIDIFIER, count: 1, inputs: [['fluid:molten.iron', 144]] },
      { id: 'b', mteId: IDS.MACERATOR, count: 1 },
      { id: 'c', mteId: IDS.SOLIDIFIER, count: 1, inputs: [['fluid:oxygen', 10]] },
    ], { flows: [{ from: 'raw', to: 'a', key: 'fluid:molten.iron', perSecond: 1 }, { from: 'raw', to: 'b', key: 't:in@0', perSecond: 1 },
      { from: 'raw', to: 'c', key: 'fluid:oxygen', perSecond: 1 }, { from: 'a', to: 'out', key: 't:out_a@0', perSecond: 1 },
      { from: 'b', to: 'out', key: 't:out_b@0', perSecond: 1 }, { from: 'c', to: 'out', key: 't:out_c@0', perSecond: 1 }] });
    // the molten iron pipe's shortest way to the tail runs over the oxygen machine's port at [2, 1, 1]
    const { r } = route(pack, plan, null, [stone([2, 1, 2])]);
    expect(blockAt(r, [2, 1, 1])?.label).toBe('Small Bronze Fluid Pipe (Oxygen)');
    expect(r.warnings).toEqual([]);
  });

  it('says what the export lacks and still places what it can', () => {
    const noTransformer = layoutPack();
    noTransformer.machines.delete(IDS.TRANSFORMER_LV);
    const a = route(noTransformer, twoStep(), 2).r;
    expect(a.warnings).toEqual([{ code: 'no_transformer', text: 'No LV transformer in this export' }]);
    expect(a.blocks.some((b) => b.role === 'transformer')).toBe(false);

    const noMvCable = layoutPack();
    for (const id of [IDS.COPPER_1X, IDS.ANNEALED_1X, IDS.ANNEALED_2X, IDS.SILVER_1X, IDS.SILVER_2X]) noMvCable.machines.delete(id);
    const b = route(noMvCable, twoStep(), 2);
    expect(b.r.warnings).toEqual([{ code: 'no_cable', text: 'No cable for MV in this export' },
      { code: 'route_failed', stepId: 's2', text: 'Could not wire Advanced Assembler inside the line — connect it by hand' }]);
    expect(b.r.cables.map((c) => c.tier)).toEqual([1]);
    expect(b.r.blocks.filter((x) => x.pos[0] === 0)).toEqual([]);
    expect(b.r.supplyRun).toHaveLength(5);

    const noPipe = layoutPack();
    for (const id of [IDS.SMALL_BRONZE_PIPE, IDS.BRONZE_PIPE]) noPipe.machines.delete(id);
    const fluidPlan = makePlan([
      { id: 'x', mteId: IDS.EXTRACTOR, count: 1, outputs: [['fluid:molten.iron', 144]] },
      { id: 'y', mteId: IDS.SOLIDIFIER, count: 1, inputs: [['fluid:molten.iron', 144]], outputs: [['t:out_y@0', 1]] },
    ]);
    const c = route(noPipe, fluidPlan, null).r;
    expect(c.warnings).toEqual([{ code: 'no_pipe', text: 'No GT fluid pipe in this export: connect Molten Iron by hand' }]);
    expect([c.blocks, c.fluidPipes, c.covers.length]).toEqual([[], [], 1]);
  });
});
