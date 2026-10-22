import { describe, it, expect } from 'vitest';
import { addedBlocks, overlaps, placeUnits, replacedCasings, unitsFromPlan } from '../../../src/server/layout/arrange.ts';
import { elementMap, elementTakes, hatchRuleFor } from '../../../src/server/layout/hatch-rules.ts';
import { emptyScan, layoutLine } from '../../../src/server/layout/layout.ts';
import { OPPOSITE, posKey, step, type Vec3 } from '../../../src/shared/layout/geometry.ts';
import { FACES } from '../../../src/shared/types/assets.ts';
import type { Layout, LayoutBlock } from '../../../src/shared/types/layout.ts';
import type { LogisticsMode } from '../../../src/shared/types/plan.ts';
import { fluidRecipe, hatchPack, HATCH_IDS } from '../../helpers/hatch-fixtures.ts';
import { areaReader, flatVoxels, IDS, layoutPack, makePlan, makeProject, makeScan, STONE, type StepSpec } from '../../helpers/layout-fixtures.ts';

const MODES: readonly LogisticsMode[] = ['direct', 'routed', 'ae2', 'enderio'];
const ORIGIN_Y = 64;

const ebfOxygen: StepSpec = { id: 'e', mteId: IDS.EBF, count: 1, tier: 2, euPerTick: 120,
  inputs: [['t:dust@0', 1], ['fluid:oxygen', 1000]], outputs: [['t:ingot@0', 1]] };
const ebfFlows = [{ from: 'raw', to: 'e', key: 't:dust@0', perSecond: 1 }, { from: 'raw', to: 'e', key: 'fluid:oxygen', perSecond: 10 },
  { from: 'e', to: 'out', key: 't:ingot@0', perSecond: 1 }];
const pyroStep: StepSpec = { id: 'p', mteId: HATCH_IDS.PYRO, count: 1, tier: 2, euPerTick: 64,
  inputs: [['t:in@0', 16]], outputs: [['t:out_p@0', 20], ['fluid:woodtar', 1000]] };
const pyroFlows = [{ from: 'raw', to: 'p', key: 't:in@0', perSecond: 1 }, { from: 'p', to: 'out', key: 't:out_p@0', perSecond: 1 },
  { from: 'p', to: 'out', key: 'fluid:woodtar', perSecond: 50 }];

async function lay(pack: ReturnType<typeof layoutPack>, steps: StepSpec[], flows: typeof ebfFlows, mode: LogisticsMode): Promise<Layout> {
  return layoutLine(pack, makePlan(steps, { flows }), emptyScan(), makeProject({ logistics: mode, scanId: null, baseId: null }));
}
const at = (layout: Layout, p: Vec3): LayoutBlock[] => layout.blocks.filter((b) => posKey(b.pos) === posKey(p));
const byMte = (layout: Layout, mteId: number): LayoutBlock[] => layout.blocks.filter((b) => b.block.mteId === mteId);

/** The block on the cell `b` faces carries `key`'s pipe linked back to `b` (GT modes) or a fluid conduit inserting into it. */
function fedThroughFront(layout: Layout, b: LayoutBlock, fluidName: string, mode: LogisticsMode): void {
  const port = step(b.pos, b.facing!);
  const back = OPPOSITE[b.facing!]!;
  const blocks = at(layout, port);
  if (mode === 'enderio') {
    const conduit = blocks.flatMap((x) => x.conduits ?? []).find((c) => c.kind !== 'item');
    expect(conduit?.faces.find((f) => f.face === FACES[back])?.mode, 'conduit face toward the hatch').toMatch(/insert|extract|in_out/);
  } else {
    const pipe = blocks.find((x) => x.role === 'pipe');
    expect(pipe?.label, 'pipe on the hatch\'s port').toContain(fluidName);
    expect(((pipe?.connections ?? 0) >> back) & 1, 'pipe joined to the hatch').toBe(1);
  }
}

describe.each(MODES)('an EBF that takes oxygen, in %s mode', (mode) => {
  it('gets its input hatch on the bottom layer facing a side, its oxygen pipe or conduit on the cell it faces, nothing on its muffler\'s air', async () => {
    // MTEElectricBlastFurnace: b (bottom layer) = atLeast(InputHatch, …); the top layer f takes an output hatch only
    const layout = await lay(layoutPack(), [ebfOxygen], ebfFlows, mode);
    const [hatch] = byMte(layout, IDS.INPUT_HATCH);
    expect(hatch!.pos[1]).toBe(ORIGIN_Y);
    expect([2, 3, 4, 5]).toContain(hatch!.facing);
    fedThroughFront(layout, hatch!, 'Oxygen', mode);
    const [muffler] = byMte(layout, IDS.MUFFLER);
    expect([muffler!.pos[1], muffler!.facing]).toEqual([ORIGIN_Y + 3, 1]);
    expect(at(layout, step(muffler!.pos, 1))).toEqual([]);
    expect(overlaps(layout.blocks.filter((b) => b.role !== 'ghost'))).toEqual([]);
    expect(layout.warnings.map((w) => w.code)).not.toContain('route_failed');
    expect(layout.warnings.map((w) => w.code)).not.toContain('hatch_rules_unknown');
    expect(layout.buildSteps.find((b) => b.id === 'layout:logistics:line')!.text).not.toContain('above it');
  });
});

describe('a line whose tallest unit is an EBF', () => {
  it("stands as tall as the air its muffler needs: the site, the check of a chosen spot and the steps keep that block free", async () => {
    // MTEHatchMuffler.polluteEnvironment needs air in front of the muffler (getAirAtSide(front)); without it
    // MTEMultiBlockBase stops the machine (POLLUTION_FAIL). The EBF is 4 high, its muffler faces up from its top.
    const layout = await lay(layoutPack(), [ebfOxygen], ebfFlows, 'direct');
    const [muffler] = byMte(layout, IDS.MUFFLER);
    expect(layout.size[1]).toBe(5);
    expect(step(muffler!.pos, muffler!.facing!)[1]).toBe(layout.origin[1] + layout.size[1] - 1);
    const text = (l: Layout, id: string) => l.buildSteps.find((s) => s.id === id)!.text;
    expect(text(layout, 'layout:site')).toContain('(5 high)');
    expect(text(layout, 'layout:roof')).toBe('Roof the line over its 5-high space: GT machines left in the rain can catch fire or explode, '
      + 'and a Muffler Hatch needs the block it faces kept empty');
    expect(text(layout, 'layout:place:e')).toMatch(/; keep the block above its Muffler Hatch empty, or GregTech stops the machine \(a muffler needs air to vent\)$/);
    // a block where the muffler's air goes, at a spot the group chose: the check finds it in the way
    const scan = makeScan({ base: { center: [20, 64, 20], bbox: { minX: 16, minY: 64, minZ: 16, maxX: 24, maxY: 65, maxZ: 24 } } });
    const project = makeProject({ placement: { origin: [30, 64, 30], rotation: 0 } });
    const plan = makePlan([ebfOxygen], { flows: ebfFlows });
    const ground = (boxes: Array<{ from: Vec3; to: Vec3; block: typeof STONE }>) => ({
      readArea: areaReader(flatVoxels({ origin: [-20, 50, -20], size: [90, 30, 90], groundY: 63, boxes })) });
    const clear = await layoutLine(layoutPack(), plan, scan, project, ground([]));
    expect(clear.warnings.map((w) => w.code)).not.toContain('placement_blocked');
    const [placed] = byMte(clear, IDS.MUFFLER);
    const air = step(placed!.pos, placed!.facing!);
    const covered = await layoutLine(layoutPack(), plan, scan, project, ground([{ from: air, to: air, block: STONE }]));
    expect(covered.origin).toEqual(clear.origin);
    expect(covered.warnings).toContainEqual({ code: 'placement_blocked', text: '1 block is in the way at the chosen spot' });
  });
});

describe.each(MODES)('a pyrolyse oven, whose input bus GT takes only above its bottom, in %s mode', (mode) => {
  it('feeds the bus from above the spine and keeps the rest where GT takes it', async () => {
    // MTEPyrolyseOven: F = atLeast(InputBus, InputHatch, Muffler), G (bottom layer) = atLeast(OutputBus, OutputHatch, Energy, Maintenance)
    const pack = hatchPack();
    const layout = await lay(pack, [pyroStep], pyroFlows, mode);
    const unit = unitsFromPlan(pack, makePlan([pyroStep], { flows: pyroFlows })).units[0]!;
    const rule = hatchRuleFor(pack.machines.get(HATCH_IDS.PYRO)!)!;
    const map = elementMap(rule, [3, 1, 0], unit.size);
    for (const c of unit.cells.filter((x) => x.hatch !== undefined)) expect(elementTakes(rule, map.get(posKey(c.pos)), c.hatch!), `${c.hatch} at ${c.pos}`).toBe(true);
    // the bus on F facing the spine two blocks up; the muffler on F facing up; the rest on the bottom layer G
    expect(Object.fromEntries(unit.cells.filter((c) => c.hatch !== undefined).map((c) => [c.hatch, [c.pos, c.face]]))).toEqual({
      input_bus: [[2, 2, 0], 2], output_bus: [[3, 0, 0], 2], energy: [[3, 0, 4], 3], maintenance: [[2, 0, 4], 3], output_hatch: [[0, 0, 0], 4],
      muffler: [[0, 2, 0], 1] });
    expect(unit.air).toContainEqual([0, 3, 0]);
    // in the line: the bus two blocks up faces the spine's column, and the mode climbs it from the spine
    const bus = layout.blocks.find((b) => b.role === 'hatch' && b.label === 'Input Bus (ULV)')!;
    const port = step(bus.pos, bus.facing!);
    const below: Vec3 = [port[0], port[1] - 1, port[2]];
    const spine: Vec3 = [port[0], port[1] - 2, port[2]];
    expect(port[1] - ORIGIN_Y).toBe(2);
    const roleAt = (p: Vec3) => at(layout, p).map((b) => b.role);
    if (mode === 'direct') {
      expect([roleAt(spine), roleAt(below), roleAt(port)]).toEqual([['pipe'], ['pipe'], ['pipe']]);
      expect((at(layout, port)[0]!.connections! >> OPPOSITE[bus.facing!]!) & 1).toBe(1);
      expect(at(layout, bus.pos)[0]!.config).toEqual({ inputFilter: true });
    } else if (mode === 'routed') {
      expect([roleAt(below), roleAt(port)]).toEqual([['pipe'], ['chip_pipe']]);
      // an input bus gets its Item Responder Chip and no Item Extractor Chip (the feeding fix, architecture §11 entry 51)
      expect(at(layout, port)[0]!.feed?.chips?.map((c) => [c.kind, c.filter?.mode])).toEqual([['responder', 'whitelist']]);
    } else if (mode === 'ae2') {
      expect([roleAt(below), roleAt(port)]).toEqual([['pipe'], ['interface']]);
      expect(at(layout, below)[0]!.label).toBe('ME Glass Cable - Fluix');
    } else {
      const face = at(layout, port)[0]!.conduits![0]!.faces.find((f) => f.face === FACES[OPPOSITE[bus.facing!]!]);
      expect(face?.mode).toBe('insert');
      expect(at(layout, below)[0]!.conduits!.map((c) => c.kind)).toContain('item');
    }
    // the step that lays the line says it climbs to the bus
    expect(layout.buildSteps.find((b) => b.id === 'layout:logistics:line')!.text).toContain('up to each bus above it');
    const [tarHatch] = byMte(layout, IDS.OUTPUT_HATCH);
    expect(tarHatch!.pos[1]).toBe(ORIGIN_Y);
    fedThroughFront(layout, tarHatch!, 'Wood Tar', mode);
    expect(overlaps(layout.blocks.filter((b) => b.role !== 'ghost'))).toEqual([]);
    expect(layout.warnings.map((w) => w.code)).not.toContain('route_failed');
  });
});

describe('hatches by GregTech\'s rules', () => {
  it('gives a distillation tower one output hatch per layer above its bottom, the fluids in the recipe\'s order', () => {
    // MTEDistillationTower.addFluidOutputs: the k-th fluid output of the recipe goes to the k-th layer's output hatches
    const pack = hatchPack();
    pack.recipeById.set('d', fluidRecipe('d', ['fluid:oil'], [['fluid:zzz', 100], ['fluid:aaa', 100]]));
    const plan = makePlan([{ id: 'd', mteId: HATCH_IDS.DT, count: 1, tier: 2, inputs: [['fluid:oil', 100]], outputs: [['fluid:zzz', 100], ['fluid:aaa', 100]] }]);
    const { units, warnings } = unitsFromPlan(pack, plan);
    const dt = units[0]!;
    expect(dt.size).toEqual([3, 3, 3]);
    // the input hatch faces west from the front corner; layer 1's port takes a column of its own, on the east
    expect(dt.cells.filter((c) => c.hatch === 'output_hatch').map((c) => [c.pos[1], c.fluid, c.face]).sort()).toEqual([[1, 'fluid:zzz', 5], [2, 'fluid:aaa', 1]]);
    expect(dt.cells.find((c) => c.hatch === 'input_hatch')).toMatchObject({ pos: [0, 0, 0], face: 4, fluid: 'fluid:oil' });
    expect(warnings).toEqual([]);
  });

  it("spreads a distillation tower's side ports over columns of their own, so every pipe reaches its port", async () => {
    // one output hatch per layer: stacked in one column (the front corner, facing west), each port can only be reached
    // from the side, and in the busy lines of the real corpus the pipes of tall towers failed
    const pack = hatchPack();
    const outs: Array<[string, number]> = [['fluid:zzz', 10], ['fluid:mmm', 10], ['fluid:aaa', 10], ['fluid:nnn', 10], ['fluid:woodtar', 10]];
    pack.recipeById.set('d', fluidRecipe('d', ['fluid:oil'], outs));
    const dtStep: StepSpec = { id: 'd', mteId: HATCH_IDS.DT, count: 1, tier: 2, inputs: [['fluid:oil', 100]], outputs: outs };
    const flows = [{ from: 'raw', to: 'd', key: 'fluid:oil', perSecond: 1 }, ...outs.map(([key]) => ({ from: 'd', to: 'out', key, perSecond: 1 }))];
    const dt = unitsFromPlan(pack, makePlan([dtStep], { flows })).units[0]!;
    expect(dt.size).toEqual([3, 6, 3]);
    const sidePorts = dt.cells.filter((c) => c.fluid !== undefined && c.face !== 1).map((c) => step(c.pos, c.face!));
    expect(sidePorts).toHaveLength(5);                                                  // the input and layers 1–4
    expect(new Set(sidePorts.map((p) => `${p[0]},${p[2]}`)).size).toBe(sidePorts.length);
    for (const mode of ['direct', 'routed', 'ae2', 'enderio'] as const) {
      const layout = await lay(pack, [dtStep], flows, mode);
      expect(layout.warnings.filter((w) => w.code === 'route_failed'), mode).toEqual([]);
      for (const b of byMte(layout, IDS.OUTPUT_HATCH).filter((x) => x.facing !== 1)) {
        const name = layout.blocks.find((x) => posKey(x.pos) === posKey(step(b.pos, b.facing!)) && x.role === 'pipe')?.label ?? '';
        if (mode !== 'enderio') expect(name, `${mode}: the pipe on the port of the hatch at ${b.pos}`).toMatch(/Fluid Pipe/);
      }
    }
  });

  it('builds a distillation tower taller for a recipe with more fluids than it has layers', () => {
    const pack = hatchPack();
    const outs: Array<[string, number]> = [['fluid:zzz', 10], ['fluid:mmm', 10], ['fluid:aaa', 10], ['fluid:nnn', 10]];
    pack.recipeById.set('d', fluidRecipe('d', ['fluid:oil'], outs));
    const dt = unitsFromPlan(pack, makePlan([{ id: 'd', mteId: HATCH_IDS.DT, count: 1, tier: 2, inputs: [['fluid:oil', 100]], outputs: outs }])).units[0]!;
    expect(dt.size).toEqual([3, 5, 3]);
    expect(dt.cells.filter((c) => c.hatch === 'output_hatch').sort((a, b) => a.pos[1] - b.pos[1]).map((c) => [c.pos[1], c.fluid]))
      .toEqual([[1, 'fluid:zzz'], [2, 'fluid:mmm'], [3, 'fluid:aaa'], [4, 'fluid:nnn']]);
    // the new layers are copies of the first one above the bottom: an empty middle, which GT needs below the top
    expect([1, 2, 3].map((y) => dt.cells.some((c) => posKey(c.pos) === `1,${y},1`))).toEqual([false, false, false]);
    expect(dt.cells.some((c) => posKey(c.pos) === '1,4,1')).toBe(true);
    expect(dt.cells).toHaveLength(9 + 3 * 8 + 9);
  });

  it('gives a distillation tower whose recipe takes no fluid an empty input hatch on its bottom, as GT needs one', () => {
    // MTEDistillationTower.checkMachine: checkHasInputHatch whatever the recipe moves (the export's Oil Berry recipes take
    // an item and a circuit and give five fluids)
    const pack = hatchPack();
    pack.recipeById.set('d', fluidRecipe('d', [], [['fluid:zzz', 100], ['fluid:aaa', 100]]));
    const plan = makePlan([{ id: 'd', mteId: HATCH_IDS.DT, count: 1, tier: 2, inputs: [['t:in@0', 1]], outputs: [['fluid:zzz', 100], ['fluid:aaa', 100]] }]);
    const { units, warnings } = unitsFromPlan(pack, plan);
    const dt = units[0]!;
    const map = elementMap(hatchRuleFor(pack.machines.get(HATCH_IDS.DT)!)!, [1, 0, 0], dt.size);
    expect(dt.cells.filter((c) => c.hatch === 'input_hatch').map((c) => [map.get(posKey(c.pos)), c.fluid ?? null])).toEqual([['b', null]]);
    expect(dt.io.fluidIn).toEqual([]);
    expect(placeUnits(units, { headWidth: 1, portSpacing: 0 }).units[0]!.ports.fluidIn).toEqual([]);
    expect(warnings).toEqual([]);
  });

  it('gives a cracker whose recipe has no catalyst an empty middle input hatch, as GT needs one', () => {
    // MTEOilCracker.checkMachine: cracker_missing_middle_input_hatch whatever the recipe moves
    const pack = hatchPack();
    pack.recipeById.set('k', fluidRecipe('k', ['fluid:heavyfuel'], [['fluid:crackedheavy', 100]]));
    const plan = makePlan([{ id: 'k', mteId: HATCH_IDS.CRACKER, count: 1, tier: 3, inputs: [['fluid:heavyfuel', 100]], outputs: [['fluid:crackedheavy', 100]] }]);
    const { units, warnings } = unitsFromPlan(pack, plan);
    expect(units[0]!.cells.filter((c) => c.hatch === 'input_hatch').map((c) => [c.pos[0], c.fluid ?? null]).sort()).toEqual([[2, null], [4, 'fluid:heavyfuel']]);
    expect(warnings).toEqual([]);
  });

  it('gives a large boiler a water input hatch and a steam output hatch of their own, and says to fill and empty them by hand', () => {
    // MTELargeBoilerBase.checkMachine: checkHasInputHatch and checkHasOutputHatch; onRunningTick boils the input hatches'
    // water into steam and explodes without water; its recipes name only the fuel
    const pack = hatchPack();
    pack.recipeById.set('b', fluidRecipe('b', ['fluid:creosote'], []));
    const plan = makePlan([{ id: 'b', mteId: HATCH_IDS.BOILER, count: 1, tier: 1, inputs: [['fluid:creosote', 100]], outputs: [] }]);
    const { units, warnings } = unitsFromPlan(pack, plan);
    const boiler = units[0]!;
    const rule = hatchRuleFor(pack.machines.get(HATCH_IDS.BOILER)!)!;
    const map = elementMap(rule, [2, 1, 0], boiler.size);
    for (const c of boiler.cells.filter((x) => x.hatch !== undefined)) expect(elementTakes(rule, map.get(posKey(c.pos)), c.hatch!), `${c.hatch} at ${c.pos}`).toBe(true);
    expect(boiler.cells.filter((c) => c.hatch !== undefined).map((c) => [c.hatch, c.fluid ?? null]).sort()).toEqual([
      ['input_hatch', 'fluid:creosote'], ['input_hatch', 'fluid:water'], ['maintenance', null], ['muffler', null], ['output_hatch', 'fluid:steam']]);
    // the fuel is piped in; the water and the steam are no fluid of the recipe, so they get no port
    expect(boiler.io).toMatchObject({ fluidIn: ['fluid:creosote'], fluidOut: [] });
    const placed = placeUnits(units, { headWidth: 1, portSpacing: 0 }).units[0]!;
    expect([placed.electric, placed.ports.fluidIn.length, placed.ports.fluidOut.length, placed.ports.power]).toEqual([false, 1, 0, null]);
    expect(warnings).toEqual([{ code: 'hatch_by_hand', stepId: 'b', text: 'Large Bronze Boiler: keep water in its water input hatch whenever it '
      + 'burns (a large boiler that runs dry explodes) and take the steam from its steam output hatch, both by hand' }]);
  });

  it('puts an output hatch on a distillation layer no fluid of the recipe reaches, with no port', () => {
    // MTEDistillationTower.checkMachine: missingOutputHatchDT for every layer above the bottom without an output hatch
    const pack = hatchPack();
    const plan = makePlan([{ id: 'd', mteId: HATCH_IDS.DT, count: 1, tier: 2, inputs: [['fluid:oil', 100]], outputs: [['fluid:aaa', 100]] }]);
    const dt = placeUnits(unitsFromPlan(pack, plan).units, { headWidth: 1, portSpacing: 0 }).units[0]!;
    expect(dt.cells.filter((c) => c.hatch === 'output_hatch').map((c) => [c.pos[1], c.fluid ?? null]).sort()).toEqual([[1, 'fluid:aaa'], [2, null]]);
    expect(dt.io.fluidOut).toEqual(['fluid:aaa']);
    expect(dt.ports.fluidOut).toHaveLength(1);
  });

  it("puts a cracker's catalyst in its middle hatch, its feed on the input side and its product on the other", () => {
    // MTEOilCracker: the side input hatches count only fluids that are no catalyst (a recipe's second fluid input)
    const pack = hatchPack();
    pack.recipeById.set('k', fluidRecipe('k', ['fluid:heavyfuel', 'fluid:steam'], [['fluid:crackedheavy', 100]]));
    const plan = makePlan([{ id: 'k', mteId: HATCH_IDS.CRACKER, count: 1, tier: 3, inputs: [['fluid:heavyfuel', 100], ['fluid:steam', 100]],
      outputs: [['fluid:crackedheavy', 100]] }]);
    const cracker = unitsFromPlan(pack, plan).units[0]!;
    const hatchOf = (key: string) => cracker.cells.find((c) => c.fluid === key)!;
    expect(hatchOf('fluid:heavyfuel').pos[0]).toBe(4);
    expect(hatchOf('fluid:steam').pos[0]).toBe(2);
    expect(hatchOf('fluid:crackedheavy').pos[0]).toBe(0);
    expect([hatchOf('fluid:heavyfuel').hatch, hatchOf('fluid:steam').hatch, hatchOf('fluid:crackedheavy').hatch]).toEqual(['input_hatch', 'input_hatch', 'output_hatch']);
  });

  it('keeps the generic placement and says so for a multiblock without a rule', () => {
    const plan = makePlan([{ id: 'a', mteId: IDS.AIR_MULTI, count: 1, tier: 1, inputs: [['t:in@0', 1], ['fluid:oxygen', 100]] }]);
    const { units, warnings } = unitsFromPlan(layoutPack(), plan);
    expect(warnings).toEqual([{ code: 'hatch_rules_unknown', stepId: 'a',
      text: "Test Front-Air Machine: hatch positions are not checked against GregTech's rules here — if it does not form, move the hatches to the casings it shows in game" }]);
    // as before the rules: the fluid hatch on the top layer facing up, the buses at the front, energy and maintenance at the back
    expect(units[0]!.cells.filter((c) => c.hatch !== undefined).map((c) => [c.hatch, c.pos, c.face])).toEqual([
      ['input_bus', [0, 0, 1], 2], ['output_bus', [2, 0, 1], 2], ['maintenance', [0, 0, 2], 3], ['energy', [1, 0, 2], 3], ['input_hatch', [0, 1, 1], 1]]);
  });

  it('puts no hatch on a bricked blast furnace, feeds it no power and says how to run it', () => {
    // MTEBrickedBlastFurnace is a MetaTileEntity without hatches: its structure takes firebricks and lava only. By
    // default (every mode but machine to machine) the line runs it by hand and says so once, never hatch_not_taken too
    const plan = makePlan([{ id: 'b', mteId: HATCH_IDS.BBF, count: 1, tier: 1, inputs: [['t:in@0', 1]], outputs: [['t:ingot@0', 1]] }]);
    const byHand = unitsFromPlan(hatchPack(), plan);
    expect([byHand.units[0]!.manual, byHand.units[0]!.cells.some((c) => c.role === 'hatch'), byHand.warnings.map((w) => w.code)])
      .toEqual(['no_automation', false, ['manual_machine']]);
    // machine to machine (the primitive rules off): the hatch rules say it takes no bus
    const { units, warnings } = unitsFromPlan(hatchPack(), plan, { primitive: false });
    expect(units[0]!.cells.filter((c) => c.role === 'hatch')).toEqual([]);
    expect(units[0]!.electric).toBe(false);
    expect(warnings).toEqual([{ code: 'hatch_not_taken', stepId: 'b',
      text: 'Bricked Blast Furnace takes no input bus or output bus in GregTech: load and empty it by hand' }]);
    expect(placeUnits(units, { headWidth: 1, portSpacing: 0 }).units[0]!.ports).toMatchObject({ power: null, items: [] });
  });

  it('gives a steam multiblock steam buses and a Steam Hatch, and no energy or maintenance hatch', () => {
    // MTESteamMixer: A = steam input or atLeast(InputBus_Steam, OutputBus_Steam, OutputHatch, InputHatch); no maintenance
    const plan = makePlan([{ id: 's', mteId: HATCH_IDS.STEAM_MIXER, count: 1, tier: 1, inputs: [['t:in@0', 1], ['t:dust@0', 1]], outputs: [['t:ingot@0', 1]] }]);
    const { units, warnings } = unitsFromPlan(hatchPack(), plan);
    const mixer = units[0]!;
    expect(mixer.electric).toBe(false);
    expect(mixer.cells.filter((c) => c.hatch !== undefined).map((c) => [c.hatch, c.block.mteId, c.pos, c.face])).toEqual([
      ['output_bus', HATCH_IDS.STEAM_BUS_OUT, [1, 0, 0], 2], ['input_bus', HATCH_IDS.STEAM_BUS_IN, [2, 0, 0], 2], ['steam', HATCH_IDS.STEAM_HATCH, [2, 0, 4], 3]]);
    expect(warnings).toEqual([{ code: 'steam_machine', stepId: 's', text: 'Steam Blender runs on steam: connect a steam supply to its Steam Hatch by hand' }]);
  });

  it("lays the export's muffler at the lowest tier of its class, the one Plan 2's build list lists", () => {
    // the export builds the EBF's hatch-only muffler element as a UHV muffler (mte 99); Plan 2's build list lists every
    // structure hatch at the lowest tier of its class (Task 2's `minimalHatch`), and so does the layout (plan 12 Task 6),
    // so that cell replaces nothing on the list
    const pack = layoutPack();
    pack.machines.set(99, { ...pack.machines.get(IDS.MUFFLER)!, mteId: 99, name: 'Muffler Hatch (UHV)', tier: 9, itemKey: 'gregtech:gt.blockmachines@99' });
    const ebf = pack.machines.get(IDS.EBF)!;
    ebf.structure = { ...ebf.structure!, blocks: ebf.structure!.blocks.map((b) => (posKey(b.pos) === '1,3,1' ? { pos: b.pos, block: { id: 'gregtech:gt.blockmachines', meta: 3, mteId: 99 } } : b)) };
    const { units, warnings } = unitsFromPlan(pack, makePlan([ebfOxygen]));
    expect(warnings).toEqual([]);
    expect(units[0]!.cells.filter((c) => c.hatch === 'muffler').map((c) => [c.pos, c.block.mteId, c.face, c.replaces])).toEqual([
      [[1, 3, 1], IDS.MUFFLER, 1, undefined]]);
    expect(replacedCasings(units)).toEqual([{ key: 'gregtech:gt.blockcasings@11', amount: 5, why: 'replaced by hatches', group: 'machines' }]);
    expect(units[0]!.air).toContainEqual([1, 4, 1]);
  });

  it("lists the casings of a distillation tower's added layers as parts", async () => {
    const pack = hatchPack();
    const outs: Array<[string, number]> = [['fluid:zzz', 10], ['fluid:mmm', 10], ['fluid:aaa', 10], ['fluid:nnn', 10]];
    pack.recipeById.set('d', fluidRecipe('d', ['fluid:oil'], outs));
    const plan = makePlan([{ id: 'd', mteId: HATCH_IDS.DT, count: 2, tier: 2, inputs: [['fluid:oil', 100]], outputs: outs }]);
    const { units } = unitsFromPlan(pack, plan);
    // two towers built two layers taller: 8 casings a layer, less the output hatch each added layer holds, which
    // replaced no casing of the exported structure (Plan 2's build list holds that one)
    expect(addedBlocks(units)).toEqual([{ key: 'gregtech:gt.blockcasings4@1', amount: 2 * (2 * 8 - 2), why: 'taller structure than its smallest', group: 'machines' }]);
    // on the exported cells: the input, energy and maintenance hatches and the first and top layers' output hatches
    expect(replacedCasings(units)).toEqual([{ key: 'gregtech:gt.blockcasings4@1', amount: 2 * 5, why: 'replaced by hatches', group: 'machines' }]);
    const layout = await layoutLine(pack, plan, emptyScan(), makeProject({ scanId: null, baseId: null }));
    expect(layout.bom.find((l) => l.key === 'gregtech:gt.blockcasings4@1')).toEqual(
      { key: 'gregtech:gt.blockcasings4@1', amount: 28, why: 'taller structure than its smallest', group: 'machines' });
  });

  it('says hatch_cells_short when no casing GT takes a hatch on is left', () => {
    // the EBF's bottom layer holds 8 casings: two buses, the energy hatch and four of five input hatches use the open
    // ones; the middle one faces nothing, and the maintenance hatch finds no casing GT takes it on
    const inputs: Array<[string, number]> = [['t:dust@0', 1], ...['a', 'b', 'c', 'd', 'e'].map((n): [string, number] => [`fluid:${n}`, 100])];
    const { units, warnings } = unitsFromPlan(layoutPack(), makePlan([{ ...ebfOxygen, inputs }]));
    expect(units[0]!.cells.filter((c) => c.hatch === 'input_hatch')).toHaveLength(4);
    expect(units[0]!.io.fluidIn).toEqual(['fluid:a', 'fluid:b', 'fluid:c', 'fluid:d']);
    expect(warnings).toEqual([{ code: 'hatch_cells_short', stepId: 'e',
      text: 'Electric Blast Furnace: put the remaining hatches (input hatch, maintenance) on casings GregTech takes them on (it shows them in game)' }]);
  });
});
