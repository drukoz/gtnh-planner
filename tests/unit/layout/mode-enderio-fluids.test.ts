import { describe, it, expect } from 'vitest';
import { placeUnits, unitsFromPlan } from '../../../src/server/layout/arrange.ts';
import { buildMode, PORT_SPACING, type ModeResult } from '../../../src/server/layout/modes/mode.ts';
import { layoutLine } from '../../../src/server/layout/layout.ts';
import { resolveParts } from '../../../src/server/layout/parts.ts';
import { posKey, rotateConnections, rotateFace } from '../../../src/shared/layout/geometry.ts';
import { FACES, type Face } from '../../../src/shared/types/assets.ts';
import type { Layout } from '../../../src/shared/types/layout.ts';
import type { Plan } from '../../../src/shared/types/plan.ts';
import { layoutPack, makePlan, makeProject, IDS } from '../../helpers/layout-fixtures.ts';
import { ENDER, ITEM, basic, faces, fluidFilter, fluidPlan, fluidSteps, lineGround, lineScan, setup } from '../../helpers/enderio-fixtures.ts';

const iron = fluidFilter(['fluid:molten.iron']);
const fluidKinds = (r: ModeResult) => [...new Set(r.blocks.flatMap((b) => (b.conduits ?? []).map((c) => c.kind)).filter((k) => k !== 'item'))];
/** The fluids draft's words for the conduit that runs along the middle row to the single-block machines' output sides. */
const ALONG = 'along the middle row to the output side of each electric single-block machine that moves fluids';

/**
 * `setup` with the fixture machines `mteIds` turned into single-block machines that are no GT basic machine and no steam
 * machine (kind `other`), so their fluids keep the port on their top. A steam machine does not: it vents through its
 * top (architecture §11 entry 48), so the line lays it no pipe or conduit (primitive.test.ts).
 */
function topPortSetup(plan: Plan, mteIds: readonly number[]): ReturnType<typeof setup> {
  const pack = layoutPack();
  for (const id of mteIds) pack.machines.set(id, { ...pack.machines.get(id)!, kind: 'other', cls: 'gregtech.api.metatileentity.implementations.MTETestMachine' });
  return { pack, plan, placement: placeUnits(unitsFromPlan(pack, plan).units, { headWidth: 1, portSpacing: PORT_SPACING.enderio }), parts: resolveParts(pack) };
}

describe('EnderIO mode — fluids', () => {
  it("meets a single-block machine's fluids on its output side, in the bundle face its items use", () => {
    // GT 5.09.54 MTEBasicMachine: isLiquidOutput(side) = side ≠ front, isLiquidInput(side) = side ≠ front and (Input from
    // Output Side allowed or side ≠ output side), the rule its items follow: so the conduit on the spine cell serves
    // both, and no riser goes to a port on top
    const r = buildMode('enderio', { ...setup(fluidPlan()), network: null });
    expect(r.ownsFluids).toBe(true);
    expect(r.blocks.filter((b) => b.conduits !== undefined).map((b) => [b.pos, b.label, b.block.id, b.connections])).toEqual([
      [[1, 0, 2], 'Conduit bundle (Item Conduit + Ender Fluid Conduit)', 'conduit:item', 32 | 4 | 8], [[2, 0, 2], 'Item Conduit', 'conduit:item', 16 | 4 | 8]]);
    expect(r.blocks.find((b) => posKey(b.pos) === '1,0,2')!.conduits![1]).toEqual({ kind: 'liquid_ender', item: ENDER, connections: 0, faces: [
      { face: 'north', mode: 'extract', target: 'Basic Fluid Extractor', extract: { color: 'red', filter: iron, rate: 1, roundRobin: false, redstone: 'ignore' } },
      // the solidifier takes the fluid through its output side, as the extractor's items go in there
      { face: 'south', mode: 'insert', target: 'Basic Fluid Solidifier', insert: { color: 'red', filter: iron, rate: 1, outputSide: true } }] });
    expect(r.configs).toEqual([{ pos: [1, 0, 1], config: { inputFromOutputSide: true } }, { pos: [1, 0, 3], config: { inputFromOutputSide: true } }]);
    expect(r.drafts.find((d) => d.id === 'layout:logistics:fluids')!.text)
      .toBe(`Lay 1× Ender Fluid Conduit ${ALONG}; 1 of them goes in the same bundle as the Item Conduit`);
  });

  it('shares the spine with the Item Conduit as one bundle and opens a fluid that enters the line at the tail', () => {
    const plan = makePlan([{ id: 's1', mteId: IDS.SOLIDIFIER, count: 1, inputs: [['fluid:molten.iron', 144]], outputs: [['t:out_s1@0', 1]] }],
      { flows: [{ from: 'raw', to: 's1', key: 'fluid:molten.iron', perSecond: 1 }, { from: 's1', to: 'out', key: 't:out_s1@0', perSecond: 1 }] });
    const r = buildMode('enderio', { ...setup(plan), network: null });
    const at = new Map(r.blocks.map((b) => [posKey(b.pos), b]));
    expect(r.blocks.filter((b) => b.conduits?.some((c) => c.kind === 'liquid_ender')).map((b) => [b.pos, b.label])).toEqual([
      [[1, 0, 2], 'Conduit bundle (Item Conduit + Ender Fluid Conduit)'], [[2, 0, 2], 'Conduit bundle (Item Conduit + Ender Fluid Conduit)']]);
    expect(at.get('1,0,2')!.conduits).toEqual([
      { kind: 'item', item: ITEM, connections: 32, faces: [{ face: 'north', mode: 'extract', target: 'Basic Fluid Solidifier',
        extract: { color: 'red', filter: basic(['t:out_s1@0']), rate: 1, roundRobin: false, selfFeed: false, redstone: 'ignore' } }] },
      { kind: 'liquid_ender', item: ENDER, connections: 32, faces: [{ face: 'north', mode: 'insert', target: 'Basic Fluid Solidifier',
        insert: { color: 'red', filter: iron, rate: 1, outputSide: true } }] }]);
    expect([at.get('1,0,2')!.connections, at.get('1,0,2')!.block.id, at.get('1,0,2')!.item]).toEqual([32 | 4, 'conduit:item', ITEM]);
    expect(at.get('2,0,2')!.conduits!.map((c) => [c.kind, c.connections, c.faces.map((f) => [f.face, f.mode, f.target])])).toEqual([
      ['item', 16, [['south', 'insert', 'Chest (output)']]], ['liquid_ender', 16, [['east', 'extract', 'your tank']]]]);
    expect(at.get('2,0,2')!.conduits![1]!.faces[0]!.extract).toEqual({ color: 'red', filter: iron, rate: 1, roundRobin: false, redstone: 'ignore' });
    // a machine that takes only fluids needs Input from Output Side too
    expect(r.configs).toEqual([{ pos: [1, 0, 1], config: { inputFromOutputSide: true } }]);
    expect(r.drafts.map((d) => d.id)).toEqual(['layout:logistics:line', 'layout:logistics:fluids', 'layout:logistics:tanks']);
    expect(r.drafts[1]!.text).toBe(`Lay 2× Ender Fluid Conduit ${ALONG}, with an open end at the tail for your tanks; 2 of them go in the same bundle as the Item Conduit`);
    expect(r.drafts[2]!.text).toBe('Connect a tank to the side of each open conduit end at the tail that faces out of the end of the line, from the bottom: Molten Iron');
  });

  it('keeps the riser to a port on top for a single-block machine that is no GT basic machine', () => {
    // GT meets a basic machine's fluids on its output side; any other single-block machine follows rules of its own and
    // keeps its port on top (a steam machine vents through its top instead, so it gets no conduit: primitive.test.ts)
    const r = buildMode('enderio', { ...topPortSetup(fluidPlan(), [IDS.SOLIDIFIER]), network: null });
    expect(faces(r).filter((f) => f.kind !== 'item' && f.mode !== 'disabled').map((f) => [f.pos, f.face, f.mode, f.target, f.insert?.outputSide])).toEqual([
      [[1, 0, 2], 'north', 'extract', 'Basic Fluid Extractor', undefined], [[1, 1, 3], 'down', 'insert', 'Basic Fluid Solidifier', undefined]]);
    expect(r.blocks.filter((b) => b.conduits?.some((c) => c.kind !== 'item')).map((b) => b.pos)).toEqual([[1, 0, 2], [1, 1, 2], [1, 1, 3]]);
    expect(r.configs).toEqual([{ pos: [1, 0, 1], config: { inputFromOutputSide: true } }]);   // the extractor takes items there
    expect(r.drafts.find((d) => d.id === 'layout:logistics:fluids')!.text)
      .toBe(`Lay 3× Ender Fluid Conduit ${ALONG} and up to the top of each Basic Fluid Solidifier; 1 of them goes in the same bundle as the Item Conduit`);
  });

  it('sizes the fluid conduit to the busiest face and warns when none is big enough', () => {
    const flows = (litres: number) => [{ from: 'raw', to: 'x', key: 't:in@0', perSecond: 1 }, { from: 'x', to: 'y', key: 'fluid:molten.iron', perSecond: litres },
      { from: 'y', to: 'out', key: 't:out_y@0', perSecond: 1 }];
    expect(fluidKinds(buildMode('enderio', { ...setup(makePlan(fluidSteps, { flows: flows(5000) })), network: null }))).toEqual(['liquid_crystalline']);
    const r = buildMode('enderio', { ...setup(makePlan(fluidSteps, { flows: flows(500000) })), network: null });
    expect(fluidKinds(r)).toEqual(['liquid_stellar']);
    expect(r.warnings).toContainEqual({ code: 'conduit_rate',
      text: 'No fluid conduit moves 500,000 L/s through one face: the Stellar Ender Fluid Conduit moves 400,000 L/s, so the line runs slower' });
  });

  it('leaves no GT fluid pipe or pump cover in a laid-out enderio line', async () => {
    const layout = await layoutLine(layoutPack(), fluidPlan(), lineScan(), makeProject({ logistics: 'enderio' }), lineGround());
    expect(layout.blocks.some((b) => b.block.mteId === IDS.SMALL_BRONZE_PIPE || b.block.mteId === IDS.BRONZE_PIPE)).toBe(false);
    expect(layout.blocks.flatMap((b) => b.covers ?? []).some((c) => c.item === 'gregtech:gt.metaitem.01@32610')).toBe(false);
    expect(layout.blocks.filter((b) => b.conduits?.some((c) => c.kind === 'liquid_ender'))).toHaveLength(1);   // the spine cell both machines face
  });
});

const oxygen = fluidFilter(['fluid:oxygen']);
const fluidFaces = (r: ModeResult) => faces(r).filter((f) => f.kind !== 'item');
/** A Basic Fluid Extractor taking Oxygen from outside the line and sending Molten Iron out of it: no items at all. */
const fluidOnly = () => makePlan([{ id: 'x', mteId: IDS.EXTRACTOR, count: 1, inputs: [['fluid:oxygen', 10]], outputs: [['fluid:molten.iron', 144]] }],
  { flows: [{ from: 'raw', to: 'x', key: 'fluid:oxygen', perSecond: 10 }, { from: 'x', to: 'out', key: 'fluid:molten.iron', perSecond: 144 }] });
/** A Basic Fluid Solidifier taking each of `fluids` (1 L/s) from outside the line, making `t:out_y@0`. */
const takesRaw = (fluids: string[]) => makePlan([{ id: 'y', mteId: IDS.SOLIDIFIER, count: 1, inputs: fluids.map((k): [string, number] => [k, 1]) }],
  { flows: [...fluids.map((key) => ({ from: 'raw', to: 'y', key, perSecond: 1 })), { from: 'y', to: 'out', key: 't:out_y@0', perSecond: 1 }] });
/** `fluidSteps` with `extractors` Basic Fluid Extractors sending `litres` L/s of Molten Iron to one Basic Fluid Solidifier. */
const manyToOne = (extractors: number, litres: number) => makePlan([{ ...fluidSteps[0]!, count: extractors }, fluidSteps[1]!],
  { flows: [{ from: 'raw', to: 'x', key: 't:in@0', perSecond: 1 }, { from: 'x', to: 'y', key: 'fluid:molten.iron', perSecond: litres },
    { from: 'y', to: 'out', key: 't:out_y@0', perSecond: 1 }] });

describe('EnderIO mode — the fluid network in detail', () => {
  it('lays fluid conduits only when the units move no items, with one open end per fluid in key order', () => {
    const r = buildMode('enderio', { ...setup(fluidOnly()), network: null });
    expect(r.blocks.map((b) => [b.pos, b.role, b.label, b.block.id, b.item, b.connections])).toEqual([
      [[1, 0, 2], 'pipe', 'Ender Fluid Conduit', 'conduit:liquid_ender', ENDER, 32 | 4],
      [[2, 0, 2], 'pipe', 'Ender Fluid Conduit', 'conduit:liquid_ender', ENDER, 16 | 2 | 32],
      [[2, 1, 2], 'pipe', 'Ender Fluid Conduit', 'conduit:liquid_ender', ENDER, 1 | 32]]);
    // the two open ends keep to their own flows, which neither crosses: one channel
    expect(fluidFaces(r).map(({ pos, kind: _kind, ...f }) => [pos, f])).toEqual([
      [[1, 0, 2], { face: 'north', mode: 'in_out', target: 'Basic Fluid Extractor',
        extract: { color: 'red', filter: iron, rate: 144, roundRobin: false, redstone: 'ignore' }, insert: { color: 'red', filter: oxygen, rate: 10, outputSide: true } }],
      [[2, 0, 2], { face: 'east', mode: 'insert', target: 'your tank', insert: { color: 'red', filter: iron, rate: 144 } }],
      [[2, 1, 2], { face: 'east', mode: 'extract', target: 'your tank',
        extract: { color: 'red', filter: oxygen, rate: 10, roundRobin: false, redstone: 'ignore' } }]]);
    expect([r.ownsFluids, r.configs, r.covers, r.logisticsPort, r.hookup, r.extraParts, r.warnings, r.tailFluidY])
      .toEqual([true, [{ pos: [1, 0, 1], config: { inputFromOutputSide: true } }], [], null, null, [], [], 1]);
    expect(r.drafts).toEqual([
      { id: 'layout:logistics:fluids', kind: 'logistics', pin: 'site',
        text: `Lay 3× Ender Fluid Conduit ${ALONG}, with 2 open ends at the tail for your tanks` },
      { id: 'layout:logistics:tanks', kind: 'logistics', pin: 'site',
        text: 'Connect a tank to the side of each open conduit end at the tail that faces out of the end of the line, from the bottom: Molten Iron and Oxygen' }]);
  });

  it("runs a multiblock's riser from the side its fluid hatch faces, along that side to a bundle on the spine", () => {
    const plan = makePlan([{ id: 'e', mteId: IDS.EBF, count: 1, tier: 2, inputs: [['t:dust@0', 1], ['fluid:oxygen', 10]], outputs: [['t:ingot@0', 1]] }],
      { flows: [{ from: 'raw', to: 'e', key: 't:dust@0', perSecond: 1 }, { from: 'raw', to: 'e', key: 'fluid:oxygen', perSecond: 10 },
        { from: 'e', to: 'out', key: 't:ingot@0', perSecond: 1 }] });
    const s = setup(plan);
    const r = buildMode('enderio', { ...s, network: null });
    // GT takes the EBF's input hatch only on its bottom layer: in row N it faces east, onto the column beside the furnace
    expect(s.placement.blocks.filter((b) => b.block.mteId === IDS.INPUT_HATCH).map((b) => [b.pos, b.role, b.facing])).toEqual([[[3, 0, 2], 'hatch', 5]]);
    expect(s.placement.units[0]!.ports).toMatchObject({ fluidIn: [[4, 0, 2]], fluidInSides: [4] });
    expect(r.blocks.filter((b) => b.conduits?.some((c) => c.kind === 'liquid_ender')).map((b) => [b.pos, b.label])).toEqual([
      [[4, 0, 2], 'Ender Fluid Conduit'], [[4, 0, 3], 'Ender Fluid Conduit'], [[4, 0, 4], 'Conduit bundle (Item Conduit + Ender Fluid Conduit)'],
      [[5, 0, 4], 'Conduit bundle (Item Conduit + Ender Fluid Conduit)']]);
    expect(fluidFaces(r).map((f) => [f.pos, f.face, f.mode, f.target, f.extract ?? f.insert ?? null])).toEqual([
      [[4, 0, 2], 'west', 'insert', 'Electric Blast Furnace', { color: 'red', filter: oxygen, rate: 10 }],
      [[5, 0, 4], 'east', 'extract', 'your tank', { color: 'red', filter: oxygen, rate: 10, roundRobin: false, redstone: 'ignore' }]]);
    const bundle = r.blocks.find((b) => posKey(b.pos) === '4,0,4')!;
    expect([bundle.connections, bundle.block.id, bundle.item, bundle.conduits!.map((c) => [c.kind, c.connections, c.faces.map((f) => [f.face, f.mode])])]).toEqual([
      16 | 32 | 4, 'conduit:item', ITEM, [['item', 16 | 32, []], ['liquid_ender', 4 | 32, []]]]);
    expect(r.drafts.map((d) => d.id)).toEqual(['layout:logistics:line', 'layout:logistics:fluids', 'layout:logistics:tanks', 'layout:logistics:inputs']);
    expect(r.drafts[1]!.text).toBe('Lay 4× Ender Fluid Conduit along the middle row and to the fluid hatches of each Electric Blast Furnace, with an open '
      + 'end at the tail for your tanks; 2 of them go in the same bundle as the Item Conduit');
  });

  it('opens no end for a fluid whose only flows outside the line pass it by', () => {
    // an owned solidifier (not placed) takes Molten Iron straight from raw; the line's own Molten Iron stays inside it
    const plan = makePlan([...fluidSteps, { id: 'w', mteId: IDS.SOLIDIFIER, count: 1, owned: 1, inputs: [['fluid:molten.iron', 144]] }], { flows: [
      { from: 'raw', to: 'x', key: 't:in@0', perSecond: 1 }, { from: 'x', to: 'y', key: 'fluid:molten.iron', perSecond: 1 },
      { from: 'raw', to: 'w', key: 'fluid:molten.iron', perSecond: 1 }, { from: 'y', to: 'out', key: 't:out_y@0', perSecond: 1 },
      { from: 'w', to: 'out', key: 't:out_w@0', perSecond: 1 }] });
    const r = buildMode('enderio', { ...setup(plan), network: null });
    expect(fluidFaces(r).map((f) => [f.pos, f.mode, f.target])).toEqual([[[1, 0, 2], 'extract', 'Basic Fluid Extractor'], [[1, 0, 2], 'insert', 'Basic Fluid Solidifier']]);
    expect(r.drafts.map((d) => d.id)).toEqual(['layout:logistics:line', 'layout:logistics:fluids', 'layout:logistics:inputs']);
  });

  it('round robins a fluid face that feeds two machines, each taking its share', () => {
    const r = buildMode('enderio', { ...setup(makePlan([fluidSteps[0]!, { ...fluidSteps[1]!, count: 2 }])), network: null });
    expect(fluidFaces(r).map((f) => [f.pos, f.mode, f.target, f.extract ?? f.insert])).toEqual([
      [[1, 0, 2], 'extract', 'Basic Fluid Extractor', { color: 'red', filter: iron, rate: 1, roundRobin: true, redstone: 'ignore' }],
      [[1, 0, 2], 'insert', 'Basic Fluid Solidifier', { color: 'red', filter: iron, rate: 0.5, outputSide: true }],
      [[2, 0, 2], 'insert', 'Basic Fluid Solidifier', { color: 'red', filter: iron, rate: 0.5, outputSide: true }]]);
  });

  it('warns when an open end takes a fluid in turn with the machine that needs it, ender fluid conduits having no priority', () => {
    // x makes 2.5 L/s of Molten Iron: y takes 2 and the 0.5 left leaves through the open end. The extract face round
    // robins (without it, the tank would be tried first once it took any, and keep it all), so the tank takes its turn
    const plan = makePlan(fluidSteps, { flows: [{ from: 'raw', to: 'x', key: 't:in@0', perSecond: 1 },
      { from: 'x', to: 'y', key: 'fluid:molten.iron', perSecond: 2 }, { from: 'x', to: 'out', key: 'fluid:molten.iron', perSecond: 0.5 },
      { from: 'y', to: 'out', key: 't:out_y@0', perSecond: 1 }] });
    const r = buildMode('enderio', { ...setup(plan), network: null });
    expect(fluidFaces(r).filter((f) => f.mode !== 'disabled').map((f) => [f.mode, f.target, f.extract ?? f.insert])).toEqual([
      ['extract', 'Basic Fluid Extractor', { color: 'red', filter: iron, rate: 2.5, roundRobin: true, redstone: 'ignore' }],
      ['insert', 'Basic Fluid Solidifier', { color: 'red', filter: iron, rate: 2, outputSide: true }],
      ['insert', 'your tank', { color: 'red', filter: iron, rate: 0.5 }]]);
    expect(r.warnings).toEqual([{ code: 'conduit_share', text: 'Basic Fluid Solidifier shares Molten Iron with the open end for your tank turn by turn '
      + '(ender fluid conduits have no priority), so it can run short: if it does, take the tank off that end' }]);
    // a face that feeds only machines, or only the open end, shares with no tank
    expect(buildMode('enderio', { ...setup(makePlan([fluidSteps[0]!, { ...fluidSteps[1]!, count: 2 }])), network: null }).warnings).toEqual([]);
    expect(buildMode('enderio', { ...setup(fluidOnly()), network: null }).warnings).toEqual([]);
  });

  it('round robins a fluid face whose colour reaches the open end, though its own flow goes only to a machine', () => {
    // x and z both make Molten Iron for y, and z sends its surplus out, so y puts x, z and the open end on one channel.
    // EnderIO fills any face of x's colour whose filter passes the fluid (EnderLiquidConduitNetwork.fillFrom): without
    // round robin x would keep filling whichever face took fluid last, the tank once it took any, so x round robins too
    const plan = makePlan([fluidSteps[0]!, { id: 'z', mteId: IDS.MACERATOR, count: 1, outputs: [['fluid:molten.iron', 144]] }, fluidSteps[1]!], {
      flows: [{ from: 'raw', to: 'x', key: 't:in@0', perSecond: 1 }, { from: 'raw', to: 'z', key: 't:in@0', perSecond: 1 },
        { from: 'x', to: 'y', key: 'fluid:molten.iron', perSecond: 1 }, { from: 'z', to: 'y', key: 'fluid:molten.iron', perSecond: 1 },
        { from: 'z', to: 'out', key: 'fluid:molten.iron', perSecond: 1 }, { from: 'y', to: 'out', key: 't:out_y@0', perSecond: 1 }] });
    const r = buildMode('enderio', { ...setup(plan), network: null });
    expect(fluidFaces(r).filter((f) => f.mode !== 'disabled').map((f) => [f.mode, f.target, f.extract?.color ?? f.insert!.color, f.extract?.roundRobin ?? null]))
      .toEqual([
        ['extract', 'Basic Fluid Extractor', 'red', true], ['extract', 'Basic Macerator', 'red', true], ['insert', 'Basic Fluid Solidifier', 'red', null],
        ['insert', 'your tank', 'red', null]]);
    expect(r.warnings).toEqual([{ code: 'conduit_share', text: 'Basic Fluid Solidifier shares Molten Iron with the open end for your tank turn by turn '
      + '(ender fluid conduits have no priority), so it can run short: if it does, take the tank off that end' }]);
  });

  it('gives a maker of a fluid a channel of its own where the fluid would reach a machine the plan feeds it from another maker', () => {
    // the review of the EnderIO single pipe (its case F2): x makes Molten Iron for y and w makes it for z. On one colour
    // each maker would fill the other's machine as well (EnderLiquidConduitNetwork.fillFrom fills any face of its colour
    // whose filter passes the fluid), so x and y get Blue (w's face comes first), and each maker, with one face to fill,
    // needs no round robin
    const plan = makePlan([
      { id: 'x', mteId: IDS.EXTRACTOR, count: 1, inputs: [['t:in@0', 1]], outputs: [['fluid:molten.iron', 144]] },
      { id: 'w', mteId: IDS.MACERATOR, count: 1, inputs: [['t:in2@0', 1]], outputs: [['fluid:molten.iron', 144]] },
      { id: 'y', mteId: IDS.SOLIDIFIER, count: 1, inputs: [['fluid:molten.iron', 144]], outputs: [['t:out_y@0', 1]] },
      { id: 'z', mteId: IDS.CHEM_HV, count: 1, tier: 3, inputs: [['fluid:molten.iron', 144]], outputs: [['t:out_z@0', 1]] },
    ], { flows: [{ from: 'raw', to: 'x', key: 't:in@0', perSecond: 1 }, { from: 'raw', to: 'w', key: 't:in2@0', perSecond: 1 },
      { from: 'x', to: 'y', key: 'fluid:molten.iron', perSecond: 1 }, { from: 'w', to: 'z', key: 'fluid:molten.iron', perSecond: 1 },
      { from: 'y', to: 'out', key: 't:out_y@0', perSecond: 1 }, { from: 'z', to: 'out', key: 't:out_z@0', perSecond: 1 }] });
    const r = buildMode('enderio', { ...setup(plan), network: null });
    expect(fluidFaces(r).filter((f) => f.mode !== 'disabled').map((f) => [f.mode, f.target, f.extract?.color ?? f.insert!.color, f.extract?.roundRobin ?? null]))
      .toEqual([
        ['extract', 'Basic Macerator', 'red', false], ['extract', 'Basic Fluid Extractor', 'blue', false],
        ['insert', 'Basic Fluid Solidifier', 'blue', null], ['insert', 'Advanced Chemical Reactor', 'red', null]]);
    expect(r.warnings).toEqual([]);
  });

  it('sizes the fluid conduit to the busiest insert face too and names the side that is short', () => {
    // five faces extract 4,000 L/s each, an Ender Fluid Conduit's most, into one face that takes 20,000 (past its 16,000)
    expect(fluidKinds(buildMode('enderio', { ...setup(manyToOne(5, 20_000)), network: null }))).toEqual(['liquid_crystalline']);
    const r = buildMode('enderio', { ...setup(manyToOne(5, 2_000_000)), network: null });
    expect(fluidKinds(r)).toEqual(['liquid_stellar']);
    expect(r.warnings).toEqual([{ code: 'conduit_rate',
      text: 'No fluid conduit moves 2,000,000 L/s through one face: the Stellar Ender Fluid Conduit moves 1,600,000 L/s, so the line runs slower' }]);
  });

  it("keeps 5 fluids in an ender fluid conduit's own filter and says which are left out", () => {
    const six = ['fluid:f0', 'fluid:f1', 'fluid:f2', 'fluid:f3', 'fluid:f4', 'fluid:f5'];
    const r = buildMode('enderio', { ...setup(takesRaw(six)), network: null });
    expect(fluidFaces(r).find((f) => posKey(f.pos) === '1,0,2')!.insert)
      .toEqual({ color: 'red', filter: fluidFilter(six.slice(0, 5)), rate: 6, outputSide: true });
    expect(r.warnings).toEqual([{ code: 'filter_full', stepId: 'y',
      text: 'The insert filter toward Basic Fluid Solidifier holds 5 fluids, so fluid:f5 is left out: move it by hand' }]);
  });

  it('stacks the open ends above the tail cell, from the bottom in key order', () => {
    const r = buildMode('enderio', { ...setup(takesRaw(['fluid:c', 'fluid:a', 'fluid:b'])), network: null });
    expect(fluidFaces(r).filter((f) => f.target === 'your tank').map((f) => [f.pos, f.face, f.mode, f.extract!.filter!.keys])).toEqual([
      [[2, 0, 2], 'east', 'extract', ['fluid:a']], [[2, 1, 2], 'east', 'extract', ['fluid:b']], [[2, 2, 2], 'east', 'extract', ['fluid:c']]]);
    // the column is linked up from the tail cell, which the spine joins from the solidifier's output side
    expect(r.blocks.filter((b) => b.pos[0] === 2 && b.pos[2] === 2).map((b) => [b.pos[1], b.conduits!.map((c) => [c.kind, c.connections])])).toEqual([
      [0, [['item', 16], ['liquid_ender', 2 | 16]]], [1, [['liquid_ender', 1 | 2]]], [2, [['liquid_ender', 1]]]]);
    expect(r.drafts.slice(1).map((d) => d.text)).toEqual([
      `Lay 4× Ender Fluid Conduit ${ALONG}, with 3 open ends at the tail for your tanks; 2 of them go in the same bundle as the Item Conduit`,
      'Connect a tank to the side of each open conduit end at the tail that faces out of the end of the line, from the bottom: fluid:a, fluid:b and fluid:c']);
  });

  it('leaves a fluid port no riser can reach for the player and says so', () => {
    const s = topPortSetup(fluidPlan(), [IDS.EXTRACTOR]);
    s.placement.reserved.push([1, 1, 0], [1, 1, 2], [2, 1, 1]);                       // walls the extractor's port in (west: the power head)
    const r = buildMode('enderio', { ...s, network: null });
    // the spine cell the solidifier is met on touches the extractor's output side too, so that face is Disabled
    expect(fluidFaces(r).map((f) => [f.pos, f.mode, f.target])).toEqual([
      [[1, 0, 2], 'disabled', 'Basic Fluid Extractor'], [[1, 0, 2], 'insert', 'Basic Fluid Solidifier']]);
    expect(r.warnings).toEqual([{ code: 'route_failed', stepId: 'x', text: 'Could not lay the Ender Fluid Conduit to Basic Fluid Extractor — connect it by hand' }]);
  });

  it('sums every fluid a port makes into its one extract side', () => {
    const plan = makePlan([{ id: 'x', mteId: IDS.EXTRACTOR, count: 1, outputs: [['fluid:molten.iron', 144], ['fluid:oxygen', 10]] }],
      { flows: [{ from: 'raw', to: 'x', key: 't:in@0', perSecond: 1 }, { from: 'x', to: 'out', key: 'fluid:molten.iron', perSecond: 2 },
        { from: 'x', to: 'out', key: 'fluid:oxygen', perSecond: 3 }] });
    const r = buildMode('enderio', { ...setup(plan), network: null });
    expect(fluidFaces(r).map((f) => [f.pos, f.mode, f.extract ?? f.insert])).toEqual([
      [[1, 0, 2], 'extract', { color: 'red', filter: fluidFilter(['fluid:molten.iron', 'fluid:oxygen']), rate: 5, roundRobin: true, redstone: 'ignore' }],
      [[2, 0, 2], 'insert', { color: 'red', filter: iron, rate: 2 }], [[2, 1, 2], 'insert', { color: 'red', filter: oxygen, rate: 3 }]]);
  });

  it('keeps risers off the power ports', () => {
    const s = topPortSetup(fluidPlan(), [IDS.EXTRACTOR, IDS.SOLIDIFIER]);
    s.placement.units[1]!.ports.power = [1, 1, 2];                                       // a power port where both risers would meet
    const r = buildMode('enderio', { ...s, network: null });
    const cells = r.blocks.filter((b) => b.conduits?.some((c) => c.kind === 'liquid_ender')).map((b) => posKey(b.pos));
    expect([cells.includes('1,1,1'), cells.includes('1,1,3'), cells.includes('1,1,2'), r.warnings]).toEqual([true, true, false, []]);
  });

  it('lets a riser climb above the units as high as the open-end column', () => {
    const s = topPortSetup(takesRaw(['fluid:a', 'fluid:b', 'fluid:c']), [IDS.SOLIDIFIER]);
    s.placement.reserved.push([1, 1, 0], [1, 1, 2], [2, 1, 1]);                       // only the way up is left
    const r = buildMode('enderio', { ...s, network: null });
    expect(fluidFaces(r).find((f) => posKey(f.pos) === '1,1,1')?.mode).toBe('insert');
    expect(r.blocks.some((b) => posKey(b.pos) === '1,2,1' && b.conduits?.some((c) => c.kind === 'liquid_ender'))).toBe(true);
    expect(r.warnings).toEqual([]);
  });

  it('never runs a riser through a chest', () => {
    const s = topPortSetup(fluidPlan(), [IDS.EXTRACTOR, IDS.SOLIDIFIER]);
    // with these walled off, the extractor's port can only reach the spine through the input chest, the solidifier's
    // through the output chest
    s.placement.reserved.push([1, 1, 0], [1, 1, 2], [2, 1, 2]);
    const r = buildMode('enderio', { ...s, network: null });
    expect(fluidFaces(r)).toEqual([]);
    expect(r.warnings.map((w) => [w.code, w.stepId])).toEqual([['route_failed', 'x'], ['route_failed', 'y']]);
  });

  it('lays no fluid conduit at all when no riser reaches a port and nothing opens at the tail', () => {
    const s = topPortSetup(makePlan([...fluidSteps, { id: 'z', mteId: IDS.MACERATOR, count: 1 }]), [IDS.EXTRACTOR, IDS.SOLIDIFIER]);   // a spine of three cells
    s.placement.reserved.push([1, 1, 0], [1, 1, 2], [2, 1, 1], [2, 1, 3], [1, 1, 4]);           // around both fluid ports
    const r = buildMode('enderio', { ...s, network: null });
    expect([s.placement.firstX, s.placement.tailX]).toEqual([1, 3]);
    expect(r.blocks.filter((b) => b.conduits?.some((c) => c.kind !== 'item'))).toEqual([]);
    expect(r.drafts.map((d) => d.id)).toEqual(['layout:logistics:line', 'layout:logistics:inputs']);
    expect([r.ownsFluids, r.warnings.map((w) => w.text)]).toEqual([true, ['Could not lay the Ender Fluid Conduit to Basic Fluid Extractor — connect it by hand',
      'Could not lay the Ender Fluid Conduit to Basic Fluid Solidifier — connect it by hand']]);
  });

  it('gives the same fluid network for the same plan', () => {
    const run = () => JSON.stringify(buildMode('enderio', { ...setup(makePlan([fluidSteps[0]!, { ...fluidSteps[1]!, count: 2 }])), network: null }));
    expect(run()).toBe(run());
  });

  it('turns the fluid conduit faces and links with the line', async () => {
    const plan = () => makePlan([{ id: 's1', mteId: IDS.SOLIDIFIER, count: 1, inputs: [['fluid:molten.iron', 144], ['t:in@0', 1]] }],
      { flows: [{ from: 'raw', to: 's1', key: 'fluid:molten.iron', perSecond: 1 }, { from: 'raw', to: 's1', key: 't:in@0', perSecond: 1 },
        { from: 's1', to: 'out', key: 't:out_s1@0', perSecond: 1 }] });
    const at = (rotation: 0 | 90) =>
      layoutLine(layoutPack(), plan(), lineScan(), makeProject({ logistics: 'enderio', placement: { origin: [30, 64, 10], rotation } }), lineGround());
    const [flat, turned] = [await at(0), await at(90)];
    const faceList = (l: Layout, turn: (f: Face) => Face) =>
      l.blocks.flatMap((b) => (b.conduits ?? []).flatMap((c) => c.faces.map((f) => `${c.kind} ${turn(f.face)} ${f.mode} ${f.target}`))).sort();
    const linkList = (l: Layout, turn: (n: number) => number) => l.blocks.flatMap((b) => (b.conduits ?? []).map((c) => `${c.kind} ${turn(c.connections)}`)).sort();
    expect(faceList(turned, (f) => f)).toEqual(faceList(flat, (f) => rotateFace(f, 90)));
    expect(linkList(turned, (n) => n)).toEqual(linkList(flat, (n) => rotateConnections(n, 90)));
    // the tail bundle: the chests north and south of it end up east and west, listed in FACES order; the open end faces south
    const tail = turned.blocks.find((b) => b.conduits?.some((c) => c.faces.some((f) => f.target === 'your tank')))!;
    expect(tail.conduits!.map((c) => [c.kind, c.faces.map((f) => [f.face, f.target])])).toEqual([
      ['item', [['west', 'Chest (output)'], ['east', 'Chest (input)']]], ['liquid_ender', [['south', 'your tank']]]]);
    // the tanks step names that side by the line's shape, not by compass, so it reads the same however the line is turned
    const tanks = (l: Layout) => l.buildSteps.find((s) => s.id === 'layout:logistics:tanks')!.text;
    expect(tanks(turned)).toBe(tanks(flat));
    expect(tanks(turned)).not.toMatch(/\b(north|south|east|west)\b/);
    for (const b of turned.blocks) {
      for (const c of b.conduits ?? []) {
        const order = c.faces.map((f) => FACES.indexOf(f.face));
        expect(order).toEqual([...order].sort((x, y) => x - y));
      }
    }
  });
});
