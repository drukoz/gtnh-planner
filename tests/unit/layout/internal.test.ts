import { describe, it, expect } from 'vitest';
import { routeInternal, fluidNets, headWidthFor, runX, supplyRunLoss } from '../../../src/server/layout/internal.ts';
import { unitsFromPlan, placeUnits, type LocalBlock, type Placement, type Unit } from '../../../src/server/layout/arrange.ts';
import { hookupAllowanceVolts, tierGroups, transformerStages } from '../../../src/server/layout/power.ts';
import { resolveParts } from '../../../src/server/layout/parts.ts';
import { layoutPack, makePlan, IDS } from '../../helpers/layout-fixtures.ts';
import { machineIdOfLegacy } from '../../../src/shared/ids.ts';
import { DIRS, posKey, step, type Vec3 } from '../../../src/shared/layout/geometry.ts';
import type { Machine } from '../../../src/shared/types/pack.ts';

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

/**
 * Final review C2: every pair of touching cable blocks and every cable beside a machine's power input, as text, when
 * the two are of different tiers (a cable's tier is its run's, by its label) or the machine is below the cable's tier.
 */
function tierContacts(blocks: LocalBlock[], cables: Array<{ tier: number; cable: Machine }>, placement: Placement): string[] {
  const tierOf = new Map(cables.map((c) => [c.cable.name, c.tier]));
  const at = new Map(blocks.map((b) => [posKey(b.pos), b]));
  const machines = new Map(placement.units.filter((u) => u.ports.power !== null).map((u) => [posKey(step(u.ports.power!, u.facing)), u]));
  const out: string[] = [];
  for (const b of blocks) {
    if (b.role !== 'cable') continue;
    const tier = tierOf.get(b.label)!;
    for (let side = 0; side < DIRS.length; side++) {
      const n = step(b.pos, side);
      const other = at.get(posKey(n));
      if (other?.role === 'cable' && tierOf.get(other.label) !== tier) out.push(`${b.label} at ${posKey(b.pos)} touches ${other.label} at ${posKey(n)}`);
      const unit = machines.get(posKey(n));
      if (unit !== undefined && unit.tier < tier) out.push(`${b.label} at ${posKey(b.pos)} touches ${unit.name} at ${posKey(n)}`);
    }
  }
  return out;
}

describe('internal routing', () => {
  it('builds the power head and wires every machine from the run of its own tier', () => {
    const pack = layoutPack();
    const { units } = unitsFromPlan(pack, twoStep());
    const stages = transformerStages(groupsOf(units), 2);
    expect(headWidthFor(stages)).toBe(3);
    expect([runX(2, 2), runX(2, 1)]).toEqual([0, 2]);
    // final review C2: the MV assembler stands a column away from the LV macerators (x 5, not 4)
    const placement = placeUnits(units, { headWidth: 3, portSpacing: 0, supplyTier: 2 });
    expect(placement.units.map((u) => u.at[0])).toEqual([3, 3, 5]);
    const r = routeInternal({ pack, parts: resolveParts(pack), placement, occupied: placement.blocks, stages, fluids: [], tailFluidY: 1, groupTier: 2 });
    const at = (p: Vec3) => r.blocks.filter((b) => posKey(b.pos) === posKey(p));
    expect(at([1, 0, 2])).toMatchObject([{ role: 'transformer', facing: 4, block: { mteId: IDS.TRANSFORMER_LV }, label: 'Low Voltage Transformer' }]);
    expect([0, 1, 2, 3, 4].map((z) => at([0, 0, z])[0]!.block.mteId)).toEqual(Array(5).fill(IDS.ANNEALED_2X));
    // final review I4: each macerator is 4 tin cables from the bank, gets 28 V and so draws 2 A: 4 A on the LV run
    expect([0, 1, 2, 3, 4].map((z) => at([2, 0, z])[0]!.block.mteId)).toEqual(Array(5).fill(IDS.TIN_4X));
    // RUK-115: the landing cells are the whole x = 0 run column plus the supply tier's tree cells on the boundary (z = 0 and the top layer y = 2)
    expect(r.supplyRun).toEqual([[0, 0, 0], [0, 0, 1], [0, 0, 2], [0, 0, 3], [0, 0, 4], [0, 1, 0], [0, 2, 0], [1, 2, 0], [2, 2, 0], [3, 2, 0], [4, 2, 0],
      [5, 0, 0], [5, 1, 0], [5, 2, 0]]);
    expect(r.cables.map((c) => [c.tier, c.cable.mteId])).toEqual([[2, IDS.ANNEALED_2X], [1, IDS.TIN_4X]]);
    // the assembler gets 114 V from the supply run's far end (2 A) and the bank takes 2 A for its 4 A out: no MV cable of the pack carries 4 A
    expect(r.stages).toMatchObject({ supplyAmps: 4, stages: [{ fromTier: 2, toTier: 1, count: 1, ampsIn: 2, ampsOut: 4 }] });
    expect(r.warnings).toEqual([
      { code: 'cable_amps', text: 'No cable carries 4 A at MV: run 2 parallel 2x Annealed Copper Cable lines' },
      { code: 'cable_loss_high', text: 'The LV wiring inside the line loses up to 13% over 4 blocks of 4x Tin Cable: it is sized for that, '
        + 'but a cable with less loss or a shorter line wastes less power' },
    ]);
    expect(tierContacts(r.blocks, r.cables, placement)).toEqual([]);
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
    // final review I4: from the run's far end the macerators get 26 V (2 A each) and the assembler 25 V (5 A)
    expect(r.warnings).toContainEqual({ code: 'cable_amps', text: 'No cable carries 9 A at LV: run 3 parallel 4x Tin Cable lines' });
    expect(reachesRun(r.blocks, placement.units[2]!.ports.power!, 0)).toBe(true);
    // with the hookup's allowance (10 % of the supply volts) the supply run is sized for 3.2 V less
    const allowed = routeInternal({ pack, parts: resolveParts(pack), placement, occupied: placement.blocks, stages, fluids: [], tailFluidY: 1, groupTier: 2,
      supplyLossVolts: hookupAllowanceVolts(1) });
    expect(allowed.stages!.supplyAmps).toBe(10);
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

  it('counts the fluid of a shared machine once', () => {
    // two extractor steps of one sharing pool run on one machine: one producing face, moving what both steps make
    const pack = layoutPack();
    const pool = { id: 'pool:x1', steps: ['x1', 'x2'] };
    const plan = makePlan(['x1', 'x2'].map((id) => ({ id, mteId: IDS.EXTRACTOR, count: 1, pool, outputs: [['fluid:molten.iron', 144]] as Array<[string, number]> })),
      { flows: ['x1', 'x2'].flatMap((id) => [{ from: 'raw', to: id, key: 't:in@0', perSecond: 1 }, { from: id, to: 'out', key: 'fluid:molten.iron', perSecond: 144 }]) });
    const placement = placeUnits(unitsFromPlan(pack, plan).units, { headWidth: 1, portSpacing: 0 });
    const nets = fluidNets(pack, plan, placement);
    expect(nets.map((n) => [n.key, n.atTail, n.faces.map((f) => [f.stepId, f.rate])])).toEqual([['fluid:molten.iron', true, [['x1', 288]]]]);
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
    const placement = placeUnits(units, { headWidth: headWidthFor(stages), portSpacing: 0, ...(supply === null ? {} : { supplyTier: supply }) });
    const r = routeInternal({ pack, parts: resolveParts(pack), placement, occupied: [...placement.blocks, ...extra], stages,
      fluids: fluidNets(pack, plan, placement), tailFluidY: 1, groupTier: 2 });
    return { placement, r };
  };
  const blockAt = (r: { blocks: LocalBlock[] }, p: Vec3) => r.blocks.find((b) => posKey(b.pos) === posKey(p));

  it('says so when a machine cannot be wired inside the line', () => {
    const pack = layoutPack();
    // the assembler's port at [5, 0, 0]: above and beside it blocked, and [4, 0, 0] touches the LV macerator's port
    const { placement, r } = route(pack, twoStep(), 2, [stone([5, 1, 0]), stone([6, 0, 0])]);
    expect(r.warnings).toEqual([
      { code: 'cable_amps', text: 'No cable carries 3 A at MV: run 2 parallel 2x Annealed Copper Cable lines' },
      { code: 'route_failed', stepId: 's2', text: 'Could not wire Advanced Assembler inside the line — connect it by hand' },
      { code: 'cable_loss_high', text: 'The LV wiring inside the line loses up to 13% over 4 blocks of 4x Tin Cable: it is sized for that, '
        + 'but a cable with less loss or a shorter line wastes less power' },
    ]);
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
    // the macerators' fluid ports [3, 1, 1] and [3, 1, 3] and the tail root [6, 1, 2] stay pipe cells; the MV tree now
    // keeps two blocks up and clear of the LV macerators anyway (final review C2)
    const { placement, r } = route(pack, plan, 2, [stone([3, 1, 0]), stone([4, 1, 2])]);
    const fluidCells = new Set([...placement.units.flatMap((u) => u.ports.fluidIn.map(posKey)), '6,1,2']);
    expect(r.blocks.filter((b) => b.role === 'cable' && fluidCells.has(posKey(b.pos)))).toEqual([]);
    expect(placement.units.map((u) => reachesRun(r.blocks, u.ports.power!, runX(2, u.tier)))).toEqual([true, true, true]);
    expect([[3, 1, 1], [3, 1, 3], [6, 1, 2]].map((p) => [blockAt(r, p as Vec3)?.label, (blockAt(r, p as Vec3)?.connections ?? 0) & 1]))
      .toEqual([['Small Bronze Fluid Pipe (Oxygen)', 1], ['Small Bronze Fluid Pipe (Oxygen)', 1], ['Small Bronze Fluid Pipe (Oxygen)', 0]]);
    expect(r.warnings.map((w) => w.code)).not.toContain('route_failed');
    expect(tierContacts(r.blocks, r.cables, placement)).toEqual([]);
  });

  it("lays a pipe walled in by a higher tier's cable one block over the cable", () => {
    // the LV extractor stands next to the head and the MV assemblers behind it in both rows, so the MV tree crosses the
    // spine one block up between them (x 4); with the spine taken (stones for the logistics) the pipe can only go over it
    const plan = makePlan([
      { id: 'a', mteId: IDS.EXTRACTOR, count: 1, euPerTick: 24, outputs: [['fluid:molten.iron', 144]] },
      { id: 'b', mteId: IDS.ASSEMBLER, count: 1, tier: 2, euPerTick: 120 },
      { id: 'c', mteId: IDS.ASSEMBLER, count: 1, tier: 2, euPerTick: 120, inputs: [['fluid:molten.iron', 144]] },
    ], { flows: [{ from: 'raw', to: 'a', key: 't:in@0', perSecond: 1 }, { from: 'raw', to: 'b', key: 't:in@0', perSecond: 1 },
      { from: 'a', to: 'c', key: 'fluid:molten.iron', perSecond: 1 }, { from: 'b', to: 'out', key: 't:out_b@0', perSecond: 1 },
      { from: 'c', to: 'out', key: 't:out_c@0', perSecond: 1 }] });
    const pack = layoutPack();
    const { placement, r } = route(pack, plan, 2, [3, 4, 5, 6].map((x) => stone([x, 0, 2])));
    expect(placement.units.map((u) => [u.stepId, u.row, u.at[0]])).toEqual([['a', 'N', 3], ['b', 'S', 4], ['c', 'N', 5]]);
    expect([0, 1, 2, 3, 4].map((z) => blockAt(r, [4, 1, z])?.label)).toEqual(Array(5).fill('2x Annealed Copper Cable'));
    // up from the extractor, over the cable at y 2 and down into the far assembler
    expect(r.blocks.filter((b) => b.role === 'pipe').map((b) => [posKey(b.pos), b.connections]))
      .toEqual([['3,1,1', 1 | 2], ['3,2,1', 1 | 32], ['4,2,1', 16 | 32], ['5,1,1', 1 | 2], ['5,2,1', 1 | 16]]);
    expect(r.fluidPipes.map((f) => [f.key, f.cells])).toEqual([['fluid:molten.iron', 5]]);
    expect(r.warnings.map((w) => w.code)).not.toContain('route_failed');
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

  it('places no pump on a face that makes two fluids when the pipe above carries only one of them', () => {
    const pack = layoutPack();
    const plan = makePlan([{ id: 'x', mteId: IDS.EXTRACTOR, count: 1, outputs: [['fluid:molten.iron', 144], ['fluid:oxygen', 10]] }], {
      flows: [{ from: 'raw', to: 'x', key: 't:in@0', perSecond: 1 }, { from: 'x', to: 'out', key: 'fluid:molten.iron', perSecond: 2 },
        { from: 'x', to: 'out', key: 'fluid:oxygen', perSecond: 3 }] });
    const { r } = route(pack, plan, null);
    // a singleblock has one cell above it for all its fluids, so only the first fluid's pipe reaches it, and a pump
    // there would push the oxygen into the molten iron pipe
    expect(blockAt(r, [1, 1, 1])?.label).toBe('Small Bronze Fluid Pipe (Molten Iron)');
    expect(r.covers).toEqual([]);
    expect(r.warnings).toEqual([
      { code: 'route_failed', stepId: 'x', text: 'Could not lay the Oxygen pipe to Basic Fluid Extractor — connect it by hand' },
      { code: 'fluid_port_shared', stepId: 'x', text: 'Basic Fluid Extractor: the Molten Iron pipe uses the cell above it, so a pump there would '
        + 'push Oxygen into that pipe — no pump placed; pump Molten Iron and Oxygen out of another side by hand' },
    ]);
    // with no pipe laid above it, the face keeps its one pump, sized for both fluids
    const noPipe = layoutPack();
    for (const id of [IDS.SMALL_BRONZE_PIPE, IDS.BRONZE_PIPE]) {
      noPipe.machines.delete(machineIdOfLegacy(id));
      noPipe.machineByMteId.delete(id);
    }
    expect(route(noPipe, plan, null).r.covers).toEqual([{ pos: [1, 0, 1], cover: { face: 'up', item: 'gregtech:gt.metaitem.01@32610',
      settings: { mode: 'export', allowInput: false, rate: 5, unit: 'L/s' } } }]);
  });

  it('places no pump where the pipe above carries a fluid the machine takes, and says why', () => {
    const pack = layoutPack();
    // the input's key sorts first, so its pipe takes the one cell above the extractor
    const plan = makePlan([
      { id: 'x', mteId: IDS.EXTRACTOR, count: 1, inputs: [['fluid:molten.iron', 144]], outputs: [['fluid:oxygen', 10]] },
      { id: 'y', mteId: IDS.SOLIDIFIER, count: 1, inputs: [['fluid:oxygen', 10]], outputs: [['t:out_y@0', 1]] },
    ]);
    const { r } = route(pack, plan, null);
    expect(blockAt(r, [1, 1, 1])?.label).toBe('Small Bronze Fluid Pipe (Molten Iron)');
    expect(r.covers.filter((c) => posKey(c.pos) === posKey([1, 0, 1]) && c.cover.face === 'up')).toEqual([]);
    expect(r.covers).toEqual([]);
    expect(r.warnings).toEqual([
      { code: 'route_failed', stepId: 'x', text: 'Could not lay the Oxygen pipe to Basic Fluid Extractor — connect it by hand' },
      { code: 'fluid_port_shared', stepId: 'x', text: 'Basic Fluid Extractor: the Molten Iron pipe uses the cell above it, so a pump there would '
        + 'push Oxygen into that pipe — no pump placed; pump Oxygen out of another side by hand' },
    ]);
  });

  it('keeps the pump where the pipe above carries the fluid the machine makes', () => {
    const pack = layoutPack();
    // the output's key sorts first, so its own pipe takes the cell above the extractor
    const plan = makePlan([
      { id: 'x', mteId: IDS.EXTRACTOR, count: 1, inputs: [['fluid:oxygen', 10]], outputs: [['fluid:molten.iron', 144]] },
      { id: 'y', mteId: IDS.SOLIDIFIER, count: 1, inputs: [['fluid:molten.iron', 144]], outputs: [['t:out_y@0', 1]] },
    ]);
    const { r } = route(pack, plan, null);
    expect(blockAt(r, [1, 1, 1])?.label).toBe('Small Bronze Fluid Pipe (Molten Iron)');
    expect(r.covers).toEqual([{ pos: [1, 0, 1], cover: { face: 'up', item: 'gregtech:gt.metaitem.01@32610',
      settings: { mode: 'export', allowInput: false, rate: 1, unit: 'L/s' } } }]);
    expect(r.warnings.map((w) => w.code)).not.toContain('fluid_port_shared');
    expect(r.warnings).toEqual([{ code: 'route_failed', stepId: 'x', text: 'Could not lay the Oxygen pipe to Basic Fluid Extractor — connect it by hand' }]);
  });

  it('fills the bank column and asks for parallel runs when one cable or column is not enough', () => {
    const pack = layoutPack();
    const { placement, r } = route(pack, makePlan([{ id: 's1', mteId: IDS.MACERATOR, count: 1, euPerTick: 672 }]), 2);
    expect(placement.size[2]).toBe(4);
    expect(r.blocks.filter((b) => b.role === 'transformer').map((b) => [b.pos, b.connections])).toEqual(
      [0, 1, 2, 3].map((z) => [[1, 0, z], (1 << 4) | (1 << 5)]));
    // final review I4: the macerator is up to 5 cables from the four transformers (27 V: 25 A); the seven transformers
    // that takes draw 7 A from MV, up to 4 cables from the supply run's far end (124 V)
    expect(r.warnings).toEqual([
      { code: 'cable_amps', text: 'No cable carries 7 A at MV: run 4 parallel 2x Annealed Copper Cable lines' },
      { code: 'cable_amps', text: 'No cable carries 25 A at LV: run 7 parallel 4x Tin Cable lines' },
      { code: 'transformer_bank', text: 'Put 3 more Low Voltage Transformer beside the bank' },
      { code: 'cable_loss_high', text: 'The LV wiring inside the line loses up to 16% over 5 blocks of 4x Tin Cable: it is sized for that, '
        + 'but a cable with less loss or a shorter line wastes less power' },
    ]);
    expect(reachesRun(r.blocks, placement.units[0]!.ports.power!, 2)).toBe(true);
    // a deep multiblock in row N only: the bank centred on the spine would leave the line, so it moves back inside
    const ebf = route(pack, makePlan([{ id: 'b', mteId: IDS.EBF, count: 1, euPerTick: 480 }]), 2);
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
    noTransformer.machines.delete(machineIdOfLegacy(IDS.TRANSFORMER_LV));
    noTransformer.machineByMteId.delete(IDS.TRANSFORMER_LV);
    const a = route(noTransformer, twoStep(), 2).r;
    expect(a.warnings.map((w) => w.code)).toEqual(['cable_amps', 'no_transformer', 'cable_loss_high']);
    expect(a.warnings[1]).toEqual({ code: 'no_transformer', text: 'No LV transformer in this export' });
    expect(a.blocks.some((b) => b.role === 'transformer')).toBe(false);

    const noMvCable = layoutPack();
    for (const id of [IDS.COPPER_1X, IDS.ANNEALED_1X, IDS.ANNEALED_2X, IDS.SILVER_1X, IDS.SILVER_2X]) {
      noMvCable.machines.delete(machineIdOfLegacy(id));
      noMvCable.machineByMteId.delete(id);
    }
    const b = route(noMvCable, twoStep(), 2);
    expect(b.r.warnings.slice(0, 2)).toEqual([{ code: 'no_cable', text: 'No cable for MV in this export' },
      { code: 'route_failed', stepId: 's2', text: 'Could not wire Advanced Assembler inside the line — connect it by hand' }]);
    expect(b.r.warnings.map((w) => w.code).slice(2)).toEqual(['cable_loss_high']);
    expect(b.r.cables.map((c) => c.tier)).toEqual([1]);
    expect(b.r.blocks.filter((x) => x.pos[0] === 0)).toEqual([]);
    expect(b.r.supplyRun).toHaveLength(5);

    const noPipe = layoutPack();
    for (const id of [IDS.SMALL_BRONZE_PIPE, IDS.BRONZE_PIPE]) {
      noPipe.machines.delete(machineIdOfLegacy(id));
      noPipe.machineByMteId.delete(id);
    }
    const fluidPlan = makePlan([
      { id: 'x', mteId: IDS.EXTRACTOR, count: 1, outputs: [['fluid:molten.iron', 144]] },
      { id: 'y', mteId: IDS.SOLIDIFIER, count: 1, inputs: [['fluid:molten.iron', 144]], outputs: [['t:out_y@0', 1]] },
    ]);
    const c = route(noPipe, fluidPlan, null).r;
    expect(c.warnings).toEqual([{ code: 'no_pipe', text: 'No GT fluid pipe in this export: connect Molten Iron by hand' }]);
    expect([c.blocks, c.fluidPipes, c.covers.length]).toEqual([[], [], 1]);
  });
});

// Final review C2 and I4: tiers never touch, and every cable is sized for the volts its machines really get.
describe('internal routing: tiers apart, sized for the loss', () => {
  const route = (plan: ReturnType<typeof makePlan>, supply: number, supplyLossVolts = 0, portSpacing: 0 | 1 | 2 = 0) => {
    const pack = layoutPack();
    const { units } = unitsFromPlan(pack, plan);
    const stages = transformerStages(groupsOf(units), supply);
    const placement = placeUnits(units, { headWidth: headWidthFor(stages), portSpacing, supplyTier: supply });
    return { placement, r: routeInternal({ pack, parts: resolveParts(pack), placement, occupied: placement.blocks, stages, fluids: [], tailFluidY: 1,
      groupTier: 3, supplyLossVolts }) };
  };

  it('crosses a lower run two blocks up and never lets two tiers touch', () => {
    const { r } = route(twoStep(), 2);
    const mv = r.blocks.filter((b) => b.role === 'cable' && b.label === '2x Annealed Copper Cable').map((b) => posKey(b.pos));
    // up from the MV run, over the bank and the LV run at y 2, and down to the assembler's port behind it
    expect(mv).toEqual(expect.arrayContaining(['0,1,0', '0,2,0', '1,2,0', '2,2,0', '3,2,0', '4,2,0', '5,2,0', '5,1,0', '5,0,0']));
    expect(r.blocks.some((b) => b.pos[1] === 1 && b.pos[0] === 1)).toBe(false);   // never on top of the bank
    // what a supply-tier hookup from outside must not touch: the bank, the LV run, the LV ports and the LV macerators
    expect(r.keepAway.map(posKey)).toEqual(['1,0,2', '2,0,0', '2,0,1', '2,0,2', '2,0,3', '2,0,4', '3,0,0', '3,0,1', '3,0,3', '3,0,4']);
  });

  it('keeps HV, MV and LV apart in a three-tier line', () => {
    const plan = makePlan([
      { id: 'l', mteId: IDS.MACERATOR, count: 1, euPerTick: 16 },
      { id: 'm', mteId: IDS.ASSEMBLER, count: 1, tier: 2, euPerTick: 64 },
      { id: 'h', mteId: IDS.CHEM_HV, count: 1, tier: 3, euPerTick: 256 },
    ]);
    const { placement, r } = route(plan, 3);
    expect(r.cables.map((c) => c.tier)).toEqual([3, 2, 1]);
    expect(r.warnings.map((w) => w.code)).not.toContain('route_failed');
    expect(placement.units.map((u) => reachesRun(r.blocks, u.ports.power!, runX(3, u.tier)))).toEqual([true, true, true]);
    expect(tierContacts(r.blocks, r.cables, placement)).toEqual([]);
  });

  it('wires the lowest tier first and lets each higher tier climb over the trees below it', () => {
    // two machines per tier, one in each row, lowest next to the head as `placeUnits` places them: the MV tree crosses
    // the LV run two blocks up, and the HV tree must cross both runs and keep off the MV crossing, so it goes higher
    const plan = makePlan([
      { id: 'l', mteId: IDS.MACERATOR, count: 2, euPerTick: 16 },
      { id: 'm', mteId: IDS.ASSEMBLER, count: 2, tier: 2, euPerTick: 64 },
      { id: 'h', mteId: IDS.CHEM_HV, count: 2, tier: 3, euPerTick: 256 },
    ]);
    for (const portSpacing of [0, 1, 2] as const) {
      const { placement, r } = route(plan, 3, 0, portSpacing);
      expect(placement.units.map((u) => [u.stepId, u.row])).toEqual([['l', 'N'], ['l', 'S'], ['m', 'N'], ['m', 'S'], ['h', 'N'], ['h', 'S']]);
      expect([portSpacing, r.warnings.filter((w) => w.code === 'route_failed'), tierContacts(r.blocks, r.cables, placement)]).toEqual([portSpacing, [], []]);
      expect(placement.units.map((u) => reachesRun(r.blocks, u.ports.power!, runX(3, u.tier)))).toEqual(Array(6).fill(true));
    }
  });

  it('wires every machine of a line whose flow order runs HV, MV, LV: the placement stands LV next to the head', () => {
    // in flow order the HV reactors would stand next to the head and the LV tree, grown first, would wall them off
    const plan = makePlan([
      { id: 'h', mteId: IDS.CHEM_HV, count: 2, tier: 3, euPerTick: 256 },
      { id: 'm', mteId: IDS.ASSEMBLER, count: 2, tier: 2, euPerTick: 64 },
      { id: 'l', mteId: IDS.MACERATOR, count: 2, euPerTick: 16 },
    ]);
    for (const portSpacing of [0, 1, 2] as const) {
      const { placement, r } = route(plan, 3, 0, portSpacing);
      expect(placement.units.map((u) => [u.stepId, u.row])).toEqual([['l', 'N'], ['l', 'S'], ['m', 'N'], ['m', 'S'], ['h', 'N'], ['h', 'S']]);
      expect([portSpacing, r.warnings.filter((w) => w.code === 'route_failed'), tierContacts(r.blocks, r.cables, placement)]).toEqual([portSpacing, [], []]);
      expect(placement.units.map((u) => reachesRun(r.blocks, u.ports.power!, runX(3, u.tier)))).toEqual(Array(6).fill(true));
    }
  });

  it('prices the supply run from where the hookup lands', () => {
    const { r } = route(twoStep(), 2);
    // RUK-115: one entry per `supplyRun` cell (the x = 0 run column z 0…4, then the supply tree's boundary cells);
    // the assembler (2 A) is 10 cables from cell 0 and the bank (2 A in) 3, so cell 0 is the best landing and cell 4 the worst
    expect(r.supply).toEqual({ tier: 2, cable: '2x Annealed Copper Cable', lossPerBlock: 1,
      consumers: [{ amps: 2, blocks: [10, 11, 12, 13, 14, 9, 8, 7, 6, 5, 4, 1, 2, 3] },
        { amps: 2, blocks: [3, 2, 1, 2, 3, 4, 5, 6, 7, 8, 9, 12, 11, 10] }] });
    expect(supplyRunLoss(r.supply, 0)).toEqual({ lossEUt: 2 * 10 + 2 * 3, warning: null });
    expect(supplyRunLoss(r.supply, 4).warning).toEqual({ code: 'cable_loss_high', text: 'The MV wiring inside the line loses up to 11% over 14 blocks of '
      + '2x Annealed Copper Cable: it is sized for that, but a cable with less loss or a shorter line wastes less power' });
    // unknown landing: every consumer counts its own farthest cell, so the two worst cells (assembler 14, bank 12) both price in
    expect(supplyRunLoss(r.supply, null)).toEqual({ lossEUt: 2 * 14 + 2 * 12, warning: supplyRunLoss(r.supply, 4).warning });
    expect(r.lossEUt).toBe(2 * 4 + 2 * 4);                                                  // the LV run: two macerators, 2 A over 4 cables
    expect(supplyRunLoss(null, 2)).toEqual({ lossEUt: 0, warning: null });
  });
});

// RUK-115: a power hookup may land on any supply-tier cable cell on the line's outer boundary, not just the x = 0 run.
describe('supply landing cells on the line boundary', () => {
  const route = (plan: ReturnType<typeof makePlan>, supply: number) => {
    const pack = layoutPack();
    const { units } = unitsFromPlan(pack, plan);
    const stages = transformerStages(groupsOf(units), supply);
    const placement = placeUnits(units, { headWidth: headWidthFor(stages), portSpacing: 0, supplyTier: supply });
    const r = routeInternal({ pack, parts: resolveParts(pack), placement, occupied: placement.blocks, stages,
      fluids: fluidNets(pack, plan, placement), tailFluidY: 1, groupTier: supply });
    return { placement, r };
  };
  // ten single-block LV macerators: a 7 × 1 × 5 line, so the supply tree spreads across the z = 0 and z = 4 faces
  const tenLV = () => makePlan([{ id: 'm', mteId: IDS.MACERATOR, count: 10, euPerTick: 30 }]);

  it('lands on the x = 0 run and the boundary cells of the supply tree, sorted and deduped', () => {
    const { placement, r } = route(tenLV(), 1);
    const [w, h, l] = placement.size;
    const onBoundary = (p: Vec3): boolean => p[0] === 0 || p[0] === w - 1 || p[2] === 0 || p[2] === l - 1 || p[1] === h - 1;
    const runColumn = [0, 1, 2, 3, 4].map((z): Vec3 => [0, 0, z]);
    for (const c of runColumn) expect(r.supplyRun.some((s) => posKey(s) === posKey(c))).toBe(true);   // whole x = 0 column
    expect(r.supplyRun.some((c) => c[0] > 0)).toBe(true);                                             // tree cells with x > 0
    expect(r.supplyRun.every(onBoundary)).toBe(true);                                                 // nothing interior
    const keys = r.supplyRun.map(posKey);
    expect(new Set(keys).size).toBe(r.supplyRun.length);                                              // each cell once
    expect(keys).toEqual([...keys].sort());                                                           // sorted by x, y, z
  });

  it('indexes the cables of every consumer by the landing-cell list', () => {
    const { r } = route(tenLV(), 1);
    expect(r.supply!.consumers.length).toBeGreaterThan(0);
    for (const c of r.supply!.consumers) expect(c.blocks).toHaveLength(r.supplyRun.length);
  });

  it('prices a landing far from a consumer higher than one near it, and lower than an unknown landing', () => {
    const { r } = route(tenLV(), 1);
    const loss = r.supplyRun.map((_, i) => supplyRunLoss(r.supply, i).lossEUt);
    const best = Math.min(...loss), worst = Math.max(...loss);
    expect(best).toBeLessThan(worst);
    expect(worst).toBeLessThan(supplyRunLoss(r.supply, null).lossEUt);
  });

  it('lands on the same cells every time the line is routed', () => {
    const first = route(tenLV(), 1).r.supplyRun;
    const second = route(tenLV(), 1).r.supplyRun;
    expect(first.length).toBeGreaterThan(1);
    expect(second).toEqual(first);                                                                   // deterministic
  });
});
