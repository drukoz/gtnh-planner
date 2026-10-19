import { describe, it, expect } from 'vitest';
import { buildMode, type ModeResult } from '../../../src/server/layout/modes/mode.ts';
import { layoutLine } from '../../../src/server/layout/layout.ts';
import { posKey, rotateConnections, rotateFace } from '../../../src/shared/layout/geometry.ts';
import { FACES, type Face } from '../../../src/shared/types/assets.ts';
import type { Layout } from '../../../src/shared/types/layout.ts';
import { layoutPack, makePlan, makeProject, IDS } from '../../helpers/layout-fixtures.ts';
import { ENDER, ITEM, basic, faces, fluidPlan, fluidSteps, lineGround, lineScan, setup } from '../../helpers/enderio-fixtures.ts';

const iron = { whitelist: true, keys: ['fluid:molten.iron'] };
const fluidKinds = (r: ModeResult) => [...new Set(r.blocks.flatMap((b) => (b.conduits ?? []).map((c) => c.kind)).filter((k) => k !== 'item'))];

describe('EnderIO mode — fluids', () => {
  it('lays one Ender Fluid Conduit from the machine that makes a fluid to the one that takes it', () => {
    const r = buildMode('enderio', { ...setup(fluidPlan()), network: null });
    expect(r.ownsFluids).toBe(true);
    const fluid = r.blocks.filter((b) => b.conduits?.some((c) => c.kind === 'liquid_ender'));
    expect(fluid.map((b) => [b.pos, b.label, b.block.id, b.connections])).toEqual([
      [[1, 1, 1], 'Ender Fluid Conduit', 'conduit:liquid_ender', 8 | 1], [[1, 1, 2], 'Ender Fluid Conduit', 'conduit:liquid_ender', 4 | 8],
      [[1, 1, 3], 'Ender Fluid Conduit', 'conduit:liquid_ender', 4 | 1]]);
    expect(fluid.map((b) => b.conduits)).toEqual([
      [{ kind: 'liquid_ender', item: ENDER, connections: 8, faces: [{ face: 'down', mode: 'extract', target: 'Basic Fluid Extractor',
        extract: { color: 'red', filter: iron, rate: 1, roundRobin: false, redstone: 'ignore' } }] }],
      [{ kind: 'liquid_ender', item: ENDER, connections: 12, faces: [] }],
      [{ kind: 'liquid_ender', item: ENDER, connections: 4, faces: [{ face: 'down', mode: 'insert', target: 'Basic Fluid Solidifier',
        insert: { color: 'red', filter: iron, rate: 1 } }] }]]);
    expect(r.drafts.find((d) => d.id === 'layout:logistics:fluids')!.text).toBe("Lay 3× Ender Fluid Conduit from every machine's fluid port");
  });

  it('shares the spine with the Item Conduit as one bundle and opens a fluid that enters the line at the tail', () => {
    const plan = makePlan([{ id: 's1', mteId: IDS.SOLIDIFIER, count: 1, inputs: [['fluid:molten.iron', 144]], outputs: [['t:out_s1@0', 1]] }],
      { flows: [{ from: 'raw', to: 's1', key: 'fluid:molten.iron', perSecond: 1 }, { from: 's1', to: 'out', key: 't:out_s1@0', perSecond: 1 }] });
    const r = buildMode('enderio', { ...setup(plan), network: null });
    const at = new Map(r.blocks.map((b) => [posKey(b.pos), b]));
    expect(r.blocks.filter((b) => b.conduits?.some((c) => c.kind === 'liquid_ender')).map((b) => [b.pos, b.label])).toEqual([
      [[1, 0, 2], 'Conduit bundle (Item Conduit + Ender Fluid Conduit)'], [[1, 1, 1], 'Ender Fluid Conduit'], [[1, 1, 2], 'Ender Fluid Conduit'],
      [[2, 0, 2], 'Conduit bundle (Item Conduit + Ender Fluid Conduit)']]);
    expect(at.get('1,0,2')!.conduits).toEqual([
      { kind: 'item', item: ITEM, connections: 32, faces: [{ face: 'north', mode: 'extract', target: 'Basic Fluid Solidifier',
        extract: { color: 'red', filter: basic(['t:out_s1@0']), rate: 1, roundRobin: false, selfFeed: false, redstone: 'ignore' } }] },
      { kind: 'liquid_ender', item: ENDER, connections: 2 | 32, faces: [{ face: 'north', mode: 'disabled', target: 'Basic Fluid Solidifier' }] }]);
    expect([at.get('1,0,2')!.connections, at.get('1,0,2')!.block.id, at.get('1,0,2')!.item]).toEqual([32 | 4 | 2, 'conduit:item', ITEM]);
    expect(at.get('2,0,2')!.conduits!.map((c) => [c.kind, c.connections, c.faces.map((f) => [f.face, f.mode, f.target])])).toEqual([
      ['item', 16, [['south', 'insert', 'Chest (output)']]], ['liquid_ender', 16, [['east', 'extract', 'your tank']]]]);
    expect(at.get('2,0,2')!.conduits![1]!.faces[0]!.extract).toEqual({ color: 'red', filter: iron, rate: 1, roundRobin: false, redstone: 'ignore' });
    expect(at.get('1,1,1')!.conduits![0]!.faces).toEqual([{ face: 'down', mode: 'insert', target: 'Basic Fluid Solidifier', insert: { color: 'red', filter: iron, rate: 1 } }]);
    expect(r.drafts.map((d) => d.id)).toEqual(['layout:logistics:line', 'layout:logistics:fluids', 'layout:logistics:tanks']);
    expect(r.drafts[1]!.text).toBe("Lay 4× Ender Fluid Conduit from every machine's fluid port, with an open end at the tail for your tanks; 2 of them go in the same bundle as the Item Conduit");
    expect(r.drafts[2]!.text).toBe('Connect a tank to the side of each open conduit end at the tail that faces out of the end of the line, from the bottom: Molten Iron');
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
    expect(layout.blocks.filter((b) => b.conduits?.some((c) => c.kind === 'liquid_ender'))).toHaveLength(3);
  });
});

const oxygen = { whitelist: true, keys: ['fluid:oxygen'] };
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
      [[1, 1, 1], 'pipe', 'Ender Fluid Conduit', 'conduit:liquid_ender', ENDER, 8 | 1],
      [[1, 1, 2], 'pipe', 'Ender Fluid Conduit', 'conduit:liquid_ender', ENDER, 4 | 32],
      [[2, 0, 2], 'pipe', 'Ender Fluid Conduit', 'conduit:liquid_ender', ENDER, 2 | 32],
      [[2, 1, 2], 'pipe', 'Ender Fluid Conduit', 'conduit:liquid_ender', ENDER, 1 | 16 | 32]]);
    expect(fluidFaces(r).map(({ pos, kind: _kind, ...f }) => [pos, f])).toEqual([
      [[1, 1, 1], { face: 'down', mode: 'in_out', target: 'Basic Fluid Extractor',
        extract: { color: 'red', filter: iron, rate: 144, roundRobin: false, redstone: 'ignore' }, insert: { color: 'blue', filter: oxygen, rate: 10 } }],
      [[2, 0, 2], { face: 'east', mode: 'insert', target: 'your tank', insert: { color: 'red', filter: iron, rate: 144 } }],
      [[2, 1, 2], { face: 'east', mode: 'extract', target: 'your tank',
        extract: { color: 'blue', filter: oxygen, rate: 10, roundRobin: false, redstone: 'ignore' } }]]);
    expect([r.ownsFluids, r.configs, r.covers, r.logisticsPort, r.hookup, r.extraParts, r.warnings, r.tailFluidY])
      .toEqual([true, [], [], null, null, [], [], 1]);
    expect(r.drafts).toEqual([
      { id: 'layout:logistics:fluids', kind: 'logistics', pin: 'site',
        text: "Lay 4× Ender Fluid Conduit from every machine's fluid port, with 2 open ends at the tail for your tanks" },
      { id: 'layout:logistics:tanks', kind: 'logistics', pin: 'site',
        text: 'Connect a tank to the side of each open conduit end at the tail that faces out of the end of the line, from the bottom: Molten Iron and Oxygen' }]);
  });

  it('runs a multiblock riser down past its fluid hatch with that face Disabled, into a bundle on the spine', () => {
    const plan = makePlan([{ id: 'e', mteId: IDS.EBF, count: 1, tier: 2, inputs: [['t:dust@0', 1], ['fluid:oxygen', 10]], outputs: [['t:ingot@0', 1]] }],
      { flows: [{ from: 'raw', to: 'e', key: 't:dust@0', perSecond: 1 }, { from: 'raw', to: 'e', key: 'fluid:oxygen', perSecond: 10 },
        { from: 'e', to: 'out', key: 't:ingot@0', perSecond: 1 }] });
    const s = setup(plan);
    const r = buildMode('enderio', { ...s, network: null });
    // the input hatch is on the top layer's front row, so the riser from the port above it comes down the furnace's front
    expect(s.placement.blocks.filter((b) => b.block.mteId === IDS.INPUT_HATCH).map((b) => [b.pos, b.role])).toEqual([[[3, 3, 3], 'hatch']]);
    expect(r.blocks.filter((b) => b.conduits?.some((c) => c.kind === 'liquid_ender')).map((b) => [b.pos, b.label])).toEqual([
      [[3, 0, 4], 'Conduit bundle (Item Conduit + Ender Fluid Conduit)'], [[3, 1, 4], 'Ender Fluid Conduit'], [[3, 2, 4], 'Ender Fluid Conduit'],
      [[3, 3, 4], 'Ender Fluid Conduit'], [[3, 4, 3], 'Ender Fluid Conduit'], [[3, 4, 4], 'Ender Fluid Conduit'],
      [[4, 0, 4], 'Conduit bundle (Item Conduit + Ender Fluid Conduit)']]);
    expect(fluidFaces(r).map((f) => [f.pos, f.face, f.mode, f.target, f.extract ?? f.insert ?? null])).toEqual([
      [[3, 3, 4], 'north', 'disabled', 'Electric Blast Furnace', null],
      [[3, 4, 3], 'down', 'insert', 'Electric Blast Furnace', { color: 'red', filter: oxygen, rate: 10 }],
      [[4, 0, 4], 'east', 'extract', 'your tank', { color: 'red', filter: oxygen, rate: 10, roundRobin: false, redstone: 'ignore' }]]);
    const bundle = r.blocks.find((b) => posKey(b.pos) === '3,0,4')!;
    expect([bundle.connections, bundle.block.id, bundle.item, bundle.conduits!.map((c) => [c.kind, c.connections, c.faces.map((f) => [f.face, f.mode])])]).toEqual([
      16 | 32 | 4 | 2, 'conduit:item', ITEM, [['item', 16 | 32, [['north', 'insert']]], ['liquid_ender', 2 | 32, []]]]);
    expect(r.drafts.map((d) => d.id)).toEqual(['layout:logistics:line', 'layout:logistics:fluids', 'layout:logistics:tanks', 'layout:logistics:inputs']);
    expect(r.drafts[1]!.text).toBe("Lay 7× Ender Fluid Conduit from every machine's fluid port, with an open end at the tail for your tanks; "
      + '2 of them go in the same bundle as the Item Conduit');
  });

  it('opens no end for a fluid whose only flows outside the line pass it by', () => {
    // an owned solidifier (not placed) takes Molten Iron straight from raw; the line's own Molten Iron stays inside it
    const plan = makePlan([...fluidSteps, { id: 'w', mteId: IDS.SOLIDIFIER, count: 1, owned: 1, inputs: [['fluid:molten.iron', 144]] }], { flows: [
      { from: 'raw', to: 'x', key: 't:in@0', perSecond: 1 }, { from: 'x', to: 'y', key: 'fluid:molten.iron', perSecond: 1 },
      { from: 'raw', to: 'w', key: 'fluid:molten.iron', perSecond: 1 }, { from: 'y', to: 'out', key: 't:out_y@0', perSecond: 1 },
      { from: 'w', to: 'out', key: 't:out_w@0', perSecond: 1 }] });
    const r = buildMode('enderio', { ...setup(plan), network: null });
    expect(fluidFaces(r).map((f) => [f.pos, f.mode, f.target])).toEqual([[[1, 1, 1], 'extract', 'Basic Fluid Extractor'], [[1, 1, 3], 'insert', 'Basic Fluid Solidifier']]);
    expect(r.drafts.map((d) => d.id)).toEqual(['layout:logistics:line', 'layout:logistics:fluids', 'layout:logistics:inputs']);
  });

  it('round robins a fluid face that feeds two machines, each taking its share', () => {
    const r = buildMode('enderio', { ...setup(makePlan([fluidSteps[0]!, { ...fluidSteps[1]!, count: 2 }])), network: null });
    expect(fluidFaces(r).map((f) => [f.pos, f.mode, f.target, f.extract ?? f.insert])).toEqual([
      [[1, 1, 1], 'extract', 'Basic Fluid Extractor', { color: 'red', filter: iron, rate: 1, roundRobin: true, redstone: 'ignore' }],
      [[1, 1, 3], 'insert', 'Basic Fluid Solidifier', { color: 'red', filter: iron, rate: 0.5 }],
      [[2, 1, 1], 'insert', 'Basic Fluid Solidifier', { color: 'red', filter: iron, rate: 0.5 }]]);
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
      ['insert', 'Basic Fluid Solidifier', { color: 'red', filter: iron, rate: 2 }],
      ['insert', 'your tank', { color: 'red', filter: iron, rate: 0.5 }]]);
    expect(r.warnings).toEqual([{ code: 'conduit_share', text: 'Basic Fluid Solidifier shares Molten Iron with the open end for your tank turn by turn '
      + '(ender fluid conduits have no priority), so it can run short: if it does, take the tank off that end' }]);
    // a face that feeds only machines, or only the open end, shares with no tank
    expect(buildMode('enderio', { ...setup(makePlan([fluidSteps[0]!, { ...fluidSteps[1]!, count: 2 }])), network: null }).warnings).toEqual([]);
    expect(buildMode('enderio', { ...setup(fluidOnly()), network: null }).warnings).toEqual([]);
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
    expect(fluidFaces(r).find((f) => posKey(f.pos) === '1,1,1')!.insert).toEqual({ color: 'red', filter: { whitelist: true, keys: six.slice(0, 5) }, rate: 6 });
    expect(r.warnings).toEqual([{ code: 'filter_full', stepId: 'y',
      text: 'The insert filter toward Basic Fluid Solidifier holds 5 fluids, so fluid:f5 is left out: move it by hand' }]);
  });

  it('stacks the open ends above the tail cell, from the bottom in key order', () => {
    const r = buildMode('enderio', { ...setup(takesRaw(['fluid:c', 'fluid:a', 'fluid:b'])), network: null });
    expect(fluidFaces(r).filter((f) => f.target === 'your tank').map((f) => [f.pos, f.face, f.mode, f.extract!.filter!.keys])).toEqual([
      [[2, 0, 2], 'east', 'extract', ['fluid:a']], [[2, 1, 2], 'east', 'extract', ['fluid:b']], [[2, 2, 2], 'east', 'extract', ['fluid:c']]]);
    // the column is linked up from the tail cell, the riser from the port joining it at y 1
    expect(r.blocks.filter((b) => b.pos[0] === 2 && b.pos[2] === 2).map((b) => [b.pos[1], b.conduits!.map((c) => [c.kind, c.connections])])).toEqual([
      [0, [['item', 16], ['liquid_ender', 2]]], [1, [['liquid_ender', 1 | 2 | 16]]], [2, [['liquid_ender', 1]]]]);
    expect(r.drafts.slice(1).map((d) => d.text)).toEqual([
      "Lay 5× Ender Fluid Conduit from every machine's fluid port, with 3 open ends at the tail for your tanks; 1 of them goes in the same bundle as the Item Conduit",
      'Connect a tank to the side of each open conduit end at the tail that faces out of the end of the line, from the bottom: fluid:a, fluid:b and fluid:c']);
  });

  it('leaves a fluid port no riser can reach for the player and says so', () => {
    const s = setup(fluidPlan());
    s.placement.reserved.push([1, 1, 0], [1, 1, 2], [2, 1, 1]);                       // walls the extractor's port in (west: the power head)
    const r = buildMode('enderio', { ...s, network: null });
    expect(fluidFaces(r).map((f) => [f.pos, f.mode, f.target])).toEqual([[[1, 1, 3], 'insert', 'Basic Fluid Solidifier']]);
    expect(r.warnings).toEqual([{ code: 'route_failed', stepId: 'x', text: 'Could not lay the Ender Fluid Conduit to Basic Fluid Extractor — connect it by hand' }]);
  });

  it('sums every fluid a port makes into its one extract side', () => {
    const plan = makePlan([{ id: 'x', mteId: IDS.EXTRACTOR, count: 1, outputs: [['fluid:molten.iron', 144], ['fluid:oxygen', 10]] }],
      { flows: [{ from: 'raw', to: 'x', key: 't:in@0', perSecond: 1 }, { from: 'x', to: 'out', key: 'fluid:molten.iron', perSecond: 2 },
        { from: 'x', to: 'out', key: 'fluid:oxygen', perSecond: 3 }] });
    const r = buildMode('enderio', { ...setup(plan), network: null });
    expect(fluidFaces(r).map((f) => [f.pos, f.mode, f.extract ?? f.insert])).toEqual([
      [[1, 1, 1], 'extract', { color: 'red', filter: { whitelist: true, keys: ['fluid:molten.iron', 'fluid:oxygen'] }, rate: 5, roundRobin: true, redstone: 'ignore' }],
      [[2, 0, 2], 'insert', { color: 'red', filter: iron, rate: 2 }], [[2, 1, 2], 'insert', { color: 'red', filter: oxygen, rate: 3 }]]);
  });

  it('keeps risers off the power ports', () => {
    const s = setup(fluidPlan());
    s.placement.units[1]!.ports.power = [1, 1, 2];                                       // a power port where both risers would meet
    const r = buildMode('enderio', { ...s, network: null });
    const cells = r.blocks.filter((b) => b.conduits?.some((c) => c.kind === 'liquid_ender')).map((b) => posKey(b.pos));
    expect([cells.includes('1,1,1'), cells.includes('1,1,3'), cells.includes('1,1,2'), r.warnings]).toEqual([true, true, false, []]);
  });

  it('lets a riser climb above the units as high as the open-end column', () => {
    const s = setup(takesRaw(['fluid:a', 'fluid:b', 'fluid:c']));
    s.placement.reserved.push([1, 1, 0], [1, 1, 2], [2, 1, 1]);                       // only the way up is left
    const r = buildMode('enderio', { ...s, network: null });
    expect(fluidFaces(r).find((f) => posKey(f.pos) === '1,1,1')?.mode).toBe('insert');
    expect(r.blocks.some((b) => posKey(b.pos) === '1,2,1' && b.conduits?.some((c) => c.kind === 'liquid_ender'))).toBe(true);
    expect(r.warnings).toEqual([]);
  });

  it('never runs a riser through a chest', () => {
    const s = setup(fluidPlan());
    // with these walled off, the extractor's port can only reach the spine through the input chest, the solidifier's
    // through the output chest
    s.placement.reserved.push([1, 1, 0], [1, 1, 2], [2, 1, 2]);
    const r = buildMode('enderio', { ...s, network: null });
    expect(fluidFaces(r)).toEqual([]);
    expect(r.warnings.map((w) => [w.code, w.stepId])).toEqual([['route_failed', 'x'], ['route_failed', 'y']]);
  });

  it('lays no fluid conduit at all when no riser reaches a port and nothing opens at the tail', () => {
    const s = setup(makePlan([...fluidSteps, { id: 'z', mteId: IDS.MACERATOR, count: 1 }]));   // a spine of three cells
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
