import { describe, it, expect } from 'vitest';
import { channelWarnings } from '../../../src/server/layout/modes/enderio.ts';
import { buildMode, PORT_SPACING, stepItemOutputs } from '../../../src/server/layout/modes/mode.ts';
import { OPPOSITE, posKey, step } from '../../../src/shared/layout/geometry.ts';
import { makePlan, makeScan, IDS, type StepSpec } from '../../helpers/layout-fixtures.ts';
import { BASIC, ITEM, basic, faces, keysN, setup, twoStep } from '../../helpers/enderio-fixtures.ts';

const sharedPlan = () => makePlan([
  { id: 'a', mteId: IDS.MACERATOR, count: 1, outputs: [['t:dust@0', 3]] },
  { id: 'b', mteId: IDS.ASSEMBLER, count: 1, tier: 2, inputs: [['t:dust@0', 1]], outputs: [['t:ingot@0', 1]] },
  { id: 'c', mteId: IDS.CHEM_HV, count: 1, tier: 3, inputs: [['t:dust@0', 1]], outputs: [['t:out_c@0', 1]] },
], { flows: [{ from: 'raw', to: 'a', key: 't:in@0', perSecond: 3 }, { from: 'a', to: 'b', key: 't:dust@0', perSecond: 1 },
  { from: 'a', to: 'c', key: 't:dust@0', perSecond: 1 }, { from: 'a', to: 'out', key: 't:dust@0', perSecond: 1 },
  { from: 'b', to: 'out', key: 't:ingot@0', perSecond: 1 }, { from: 'c', to: 'out', key: 't:out_c@0', perSecond: 1 }] });
/**
 * Why the storage tap and the input chest's face share a channel of their own (the audit of the EnderIO In / Out fix):
 * EnderIO extracts only what an Insert face of the extract side's colour takes (`NetworkedInventory.doTransfer`), so on
 * Light Gray, with the input chest's face the only one on it, the tap stops while the chest is full; on Green, every
 * face's default, it would hand the raw inputs on to the base's other storages.
 */
const TAP_NOTE = "Light Gray is the tap's own channel, so check that no other face on your network inserts on Light Gray: then the tap "
  + "hands the raw inputs to the input chest alone and stops while the chest is full (on Green, every face's default, it would go on filling "
  + 'your other storages)';
const manyInputs = (n: number) => makePlan([{ id: 's1', mteId: IDS.ASSEMBLER, count: 1, tier: 2, inputs: keysN(n).map((k): [string, number] => [k, 1]) }],
  { flows: [...keysN(n).map((key) => ({ from: 'raw', to: 's1', key, perSecond: 1 })), { from: 's1', to: 'out', key: 't:out_s1@0', perSecond: 1 }] });
/**
 * Every route EnderIO can take on the item faces, `<extract face's target> -<key>-> <insert face's target>`, sorted: an
 * insert side of the extract side's colour whose filter passes the key, on another face (NetworkedInventory offers each
 * extraction to every face of the network but its own whose colour and filter take it).
 */
const routes = (r: { blocks: Parameters<typeof faces>[0]['blocks'] }): string[] => {
  const item = faces(r).filter((f) => f.kind === 'item');
  return item.flatMap((from) => (from.extract?.filter?.keys ?? []).flatMap((key) => item
    .filter((to) => to.insert !== undefined && !(posKey(to.pos) === posKey(from.pos) && to.face === from.face) && to.insert.color === from.extract!.color
      && (to.insert.filter?.keys ?? []).includes(key))
    .map((to) => `${from.target} -${key}-> ${to.target}`))).sort();
};

describe('EnderIO mode — items', () => {
  it('lays one Item Conduit along the spine, every machine face In / Out with its own filters, all on the line\'s one channel', () => {
    const r = buildMode('enderio', { ...setup(), network: null });
    expect(r.blocks.filter((b) => b.conduits !== undefined).map((b) => [b.pos, b.role, b.block.id, b.label, b.item, b.connections])).toEqual([
      [[1, 0, 2], 'pipe', 'conduit:item', 'Item Conduit', ITEM, 4 | 8 | 32],
      [[2, 0, 2], 'pipe', 'conduit:item', 'Item Conduit', ITEM, 4 | 16 | 32],
      [[3, 0, 2], 'pipe', 'conduit:item', 'Item Conduit', ITEM, 4 | 8 | 16]]);
    // every machine's outputs go into the one pipe and the insert filters (and priorities) send each item on: Red only
    const s1 = { mode: 'in_out', target: 'Basic Macerator',
      extract: { color: 'red', filter: basic(['t:out_s1@0']), rate: 0.5, roundRobin: false, selfFeed: false, redstone: 'ignore' },
      // a singleblock takes the face's items through its output side (GT's Input from Output Side, plan 11 Task 3's configs)
      insert: { color: 'red', filter: basic(['t:in@0']), rate: 0.5, priority: 1, outputSide: true } };
    expect(r.blocks.find((b) => posKey(b.pos) === '1,0,2')!.conduits).toEqual([
      { kind: 'item', item: ITEM, connections: 32, faces: [{ face: 'north', ...s1 }, { face: 'south', ...s1 }] }]);
    expect(faces(r).filter((f) => posKey(f.pos) !== '1,0,2').map(({ pos: _pos, kind: _kind, ...f }) => f)).toEqual([
      { face: 'north', mode: 'in_out', target: 'Advanced Assembler',
        extract: { color: 'red', filter: basic(['t:out_s2@0']), rate: 1, roundRobin: false, selfFeed: false, redstone: 'ignore' },
        insert: { color: 'red', filter: basic(['t:out_s1@0']), rate: 1, priority: 1, outputSide: true } },
      { face: 'north', mode: 'extract', target: 'Chest (input)',
        extract: { color: 'red', filter: basic(['t:in@0']), rate: 1, roundRobin: true, selfFeed: false, redstone: 'ignore' } },
      { face: 'south', mode: 'insert', target: 'Chest (output)', insert: { color: 'red', filter: basic(['t:out_s2@0']), rate: 1, priority: 0 } }]);
    expect(r.configs).toEqual([{ pos: [1, 0, 1], config: { inputFromOutputSide: true } }, { pos: [1, 0, 3], config: { inputFromOutputSide: true } },
      { pos: [2, 0, 1], config: { inputFromOutputSide: true } }]);
    expect(r.blocks.filter((b) => b.role === 'chest').map((b) => [b.pos, b.label, b.tail])).toEqual([
      [[3, 0, 1], 'Chest (input)', { side: 'input', keys: ['t:in@0'] }], [[3, 0, 3], 'Chest (output)', { side: 'output', keys: ['t:out_s2@0'] }]]);
    expect([r.covers, r.logisticsPort, r.hookup, r.tailFluidY, r.warnings, r.extraParts]).toEqual([[], null, null, 1, [], []]);
    expect(r.drafts).toEqual([
      { id: 'layout:logistics:line', kind: 'logistics', pin: 'site',
        text: "Lay 3× Item Conduit along the middle row so it touches every machine's output side or bus, with an input chest and an output chest at the end" },
      { id: 'layout:logistics:inputs', kind: 'logistics', pin: 'site', text: 'Put the raw inputs in the input chest: Raw Input' }]);
  });

  it('feeds the input chest from an EnderIO item network on a channel of its own, so the tap stops when the chest is full', () => {
    const network = makeScan({ logistics: [{ kind: 'enderio', taps: [[0, 64, 0]] }] }).logistics[0]!;
    const r = buildMode('enderio', { ...setup(), network });
    expect(r.logisticsPort).toEqual([3, 0, 1]);
    // Light Gray, which the base's faces do not have by default: the tap's only target on it is the input chest, so once
    // that is full the tap moves nothing (on Green it would fill the base's other storages); priority 1 stays, above the
    // base network's own Insert faces at EnderIO's default 0, should another face share the colour after all
    expect(r.hookup).toEqual({ part: 'eio_item_conduit', end: null, endConduit: { kind: 'item',
      face: { mode: 'insert', target: 'Chest (input)', insert: { color: 'silver', filter: basic(['t:in@0']), rate: 1, priority: 1 } } } });
    expect(r.extraParts).toEqual([{ key: 'EnderIO:itemBasicFilterUpgrade@0', amount: 1, why: 'filter at the storage tap', group: 'logistics' }]);
    expect(r.drafts.map((d) => [d.id, d.pin])).toEqual([['layout:logistics:line', 'site'], ['layout:configure:conduit-tap', 'logistics']]);
    expect(r.drafts[1]!.text).toBe('At the storage tap set the conduit face toward your storage to Extract (In / Out if it already inserts, its insert '
      + 'side left as it is); extract on Light Gray with a Basic Item Filter (whitelist, 1 of 5 slots: Raw Input; match meta, ignore NBT), round robin off, self feed '
      + `off, redstone Always active. ${TAP_NOTE}`);
  });

  it('joins a shared item into one channel and fills machines before the chest', () => {
    const r = buildMode('enderio', { ...setup(sharedPlan()), network: null });
    const at = (target: string) => faces(r).find((f) => f.target === target)!;
    const [a, b, c, out] = [at('Basic Macerator'), at('Advanced Assembler'), at('Advanced Chemical Reactor'), at('Chest (output)')];
    expect([a.extract!.color, b.insert!.color, c.insert!.color, out.insert!.color]).toEqual(['red', 'red', 'red', 'red']);
    // round robin would hand the chest its turn whatever its priority, so it is off: each extraction goes to the first
    // face that takes it, the machines (priority 1) before the chest (0)
    expect([a.extract!.roundRobin, a.extract!.rate, b.insert!.priority, c.insert!.priority, out.insert!.priority]).toEqual([false, 3, 1, 1, 0]);
    expect(out.insert!.filter!.keys).toEqual(['t:dust@0', 't:ingot@0', 't:out_c@0']);
  });

  it('gives the raw inputs a channel of their own only where a machine makes one of them for another machine', () => {
    // b takes Dust from the input chest, c takes it from a: on one colour the chest would fill c as well (it hands out
    // as fast as the conduit moves) and a would back up, which no filter stops, as c does take Dust; Ingot and
    // t:out_c@0 only go out, so the output chest shares a's colour
    const plan = makePlan([
      { id: 'a', mteId: IDS.MACERATOR, count: 1, outputs: [['t:dust@0', 1]] },
      { id: 'b', mteId: IDS.ASSEMBLER, count: 1, tier: 2, inputs: [['t:dust@0', 1]], outputs: [['t:ingot@0', 1]] },
      { id: 'c', mteId: IDS.CHEM_HV, count: 1, tier: 3, inputs: [['t:dust@0', 1]], outputs: [['t:out_c@0', 1]] },
    ], { flows: [{ from: 'raw', to: 'a', key: 't:in@0', perSecond: 1 }, { from: 'raw', to: 'b', key: 't:dust@0', perSecond: 1 },
      { from: 'a', to: 'c', key: 't:dust@0', perSecond: 1 }, { from: 'b', to: 'out', key: 't:ingot@0', perSecond: 1 },
      { from: 'c', to: 'out', key: 't:out_c@0', perSecond: 1 }] });
    const r = buildMode('enderio', { ...setup(plan), network: null });
    const at = (target: string) => faces(r).find((f) => f.target === target)!;
    const [a, b, c, chest, out] = [at('Basic Macerator'), at('Advanced Assembler'), at('Advanced Chemical Reactor'), at('Chest (input)'), at('Chest (output)')];
    expect([chest.extract!.color, a.insert!.color, b.insert!.color]).toEqual(['blue', 'blue', 'blue']);
    expect([a.extract!.color, c.insert!.color, b.extract!.color, c.extract!.color, out.insert!.color]).toEqual(['red', 'red', 'red', 'red', 'red']);
    expect(r.warnings).toEqual([]);
  });

  it('keeps a raw input off the output chest that collects the same item from a machine', () => {
    // the chest would take Dust from the input chest whenever b is full and fill up with it
    const plan = makePlan([
      { id: 'a', mteId: IDS.MACERATOR, count: 1, outputs: [['t:dust@0', 1]] },
      { id: 'b', mteId: IDS.ASSEMBLER, count: 1, tier: 2, inputs: [['t:dust@0', 1]], outputs: [['t:ingot@0', 1]] },
    ], { flows: [{ from: 'raw', to: 'a', key: 't:in@0', perSecond: 1 }, { from: 'raw', to: 'b', key: 't:dust@0', perSecond: 1 },
      { from: 'a', to: 'out', key: 't:dust@0', perSecond: 1 }, { from: 'b', to: 'out', key: 't:ingot@0', perSecond: 1 }] });
    const r = buildMode('enderio', { ...setup(plan), network: null });
    const at = (target: string) => faces(r).find((f) => f.target === target)!;
    expect([at('Basic Macerator').extract!.color, at('Chest (output)').insert!.color, at('Advanced Assembler').extract!.color]).toEqual(['red', 'red', 'red']);
    expect([at('Chest (input)').extract!.color, at('Basic Macerator').insert!.color, at('Advanced Assembler').insert!.color]).toEqual(['blue', 'blue', 'blue']);
  });

  it('gives a maker a channel of its own where its item would reach a machine the plan feeds that item from another maker', () => {
    // the review of the EnderIO single pipe (its case E4, the user's own example): a makes 2 Dust/s, 1 for c and 1 for the
    // output chest; b makes 1 Dust/s for d. On one colour both makers' extract sides reach c, d and the chest, round robin
    // is off (the chest takes Dust) and EnderIO hands each stack to the nearest face with room: a machine with room to
    // spare (counts round up, and raw inputs never hold it back) takes Dust planned for the other, which runs short, and
    // b's Dust overflows into the chest. No filter stops it, as c and d both take Dust, so b and d get Blue
    const plan = makePlan([
      { id: 'a', mteId: IDS.MACERATOR, count: 1, inputs: [['t:in@0', 1]], outputs: [['t:dust@0', 2]] },
      { id: 'b', mteId: IDS.EXTRACTOR, count: 1, inputs: [['t:in2@0', 1]], outputs: [['t:dust@0', 1]] },
      { id: 'c', mteId: IDS.CHEM_HV, count: 1, tier: 3, inputs: [['t:dust@0', 1]], outputs: [['t:out_c@0', 1]] },
      { id: 'd', mteId: IDS.ASSEMBLER, count: 1, tier: 2, inputs: [['t:dust@0', 1]], outputs: [['t:out_d@0', 1]] },
    ], { flows: [{ from: 'raw', to: 'a', key: 't:in@0', perSecond: 1 }, { from: 'raw', to: 'b', key: 't:in2@0', perSecond: 1 },
      { from: 'a', to: 'c', key: 't:dust@0', perSecond: 1 }, { from: 'a', to: 'out', key: 't:dust@0', perSecond: 1 },
      { from: 'b', to: 'd', key: 't:dust@0', perSecond: 1 },
      { from: 'c', to: 'out', key: 't:out_c@0', perSecond: 1 }, { from: 'd', to: 'out', key: 't:out_d@0', perSecond: 1 }] });
    const r = buildMode('enderio', { ...setup(plan), network: null });
    const at = (target: string) => faces(r).find((f) => f.target === target)!;
    const [a, b, c, d, chest, out] = [at('Basic Macerator'), at('Basic Fluid Extractor'), at('Advanced Chemical Reactor'), at('Advanced Assembler'),
      at('Chest (input)'), at('Chest (output)')];
    expect([a.extract!.color, c.insert!.color, out.insert!.color, chest.extract!.color, a.insert!.color, b.insert!.color, c.extract!.color, d.extract!.color])
      .toEqual(['red', 'red', 'red', 'red', 'red', 'red', 'red', 'red']);
    expect([b.extract!.color, d.insert!.color]).toEqual(['blue', 'blue']);
    // every route EnderIO can take is one the plan's flows name
    expect(routes(r)).toEqual([
      'Advanced Assembler -t:out_d@0-> Chest (output)', 'Advanced Chemical Reactor -t:out_c@0-> Chest (output)',
      'Basic Fluid Extractor -t:dust@0-> Advanced Assembler', 'Basic Macerator -t:dust@0-> Advanced Chemical Reactor',
      'Basic Macerator -t:dust@0-> Chest (output)', 'Chest (input) -t:in2@0-> Basic Fluid Extractor', 'Chest (input) -t:in@0-> Basic Macerator']);
    expect([a.extract!.roundRobin, b.extract!.roundRobin, r.warnings]).toEqual([false, false, []]);
  });

  it('round robins a face whose item two machines take, though the output chest takes another of its items', () => {
    // EnderIO's round robin hands each extraction to the next face that takes it, so the chest only ever gets By-product
    const plan = makePlan([
      { id: 'a', mteId: IDS.MACERATOR, count: 1, outputs: [['t:dust@0', 2], ['t:by@0', 1]] },
      { id: 'b', mteId: IDS.ASSEMBLER, count: 1, tier: 2, inputs: [['t:dust@0', 1]], outputs: [['t:ingot@0', 1]] },
      { id: 'c', mteId: IDS.CHEM_HV, count: 1, tier: 3, inputs: [['t:dust@0', 1]], outputs: [['t:out_c@0', 1]] },
    ], { flows: [{ from: 'raw', to: 'a', key: 't:in@0', perSecond: 1 }, { from: 'a', to: 'b', key: 't:dust@0', perSecond: 1 },
      { from: 'a', to: 'c', key: 't:dust@0', perSecond: 1 }, { from: 'a', to: 'out', key: 't:by@0', perSecond: 1 },
      { from: 'b', to: 'out', key: 't:ingot@0', perSecond: 1 }, { from: 'c', to: 'out', key: 't:out_c@0', perSecond: 1 }] });
    const r = buildMode('enderio', { ...setup(plan), network: null });
    expect(faces(r).find((f) => f.target === 'Basic Macerator')!.extract!.roundRobin).toBe(true);
  });

  it('round robins only between machine faces, so a surplus for the output chest never takes a machine\'s share', () => {
    // a makes 2.5 dust/s: b needs 2 and the output chest gets the 0.5 left. EnderIO's round robin rotates over every
    // face a side feeds, whatever its priority, so with it on the chest would take every other extraction (half the
    // dust, b getting 1.25 of its 2); with it off each extraction goes to b (priority 1) first and the chest takes the rest
    const surplus = makePlan([
      { id: 'a', mteId: IDS.MACERATOR, count: 1, outputs: [['t:dust@0', 5]] },
      { id: 'b', mteId: IDS.ASSEMBLER, count: 1, tier: 2, inputs: [['t:dust@0', 4]], outputs: [['t:ingot@0', 1]] },
    ], { flows: [{ from: 'raw', to: 'a', key: 't:in@0', perSecond: 2.5 }, { from: 'a', to: 'b', key: 't:dust@0', perSecond: 2 },
      { from: 'a', to: 'out', key: 't:dust@0', perSecond: 0.5 }, { from: 'b', to: 'out', key: 't:ingot@0', perSecond: 0.5 }] });
    const r = buildMode('enderio', { ...setup(surplus), network: null });
    const at = (target: string) => faces(r).find((f) => f.target === target)!;
    const [a, b, out] = [at('Basic Macerator'), at('Advanced Assembler'), at('Chest (output)')];
    expect([a.extract!.color, b.insert!.color, out.insert!.color]).toEqual(['red', 'red', 'red']);
    expect([a.extract!.roundRobin, a.extract!.rate, b.insert!.priority, b.insert!.rate, out.insert!.priority, out.insert!.rate])
      .toEqual([false, 2.5, 1, 2, 0, 1]);
    // two machines and no chest, one taking twice the other's share: round robin, each machine skipped once it is full
    const machines = makePlan([
      { id: 'a', mteId: IDS.MACERATOR, count: 1, outputs: [['t:dust@0', 3]] },
      { id: 'b', mteId: IDS.ASSEMBLER, count: 1, tier: 2, inputs: [['t:dust@0', 1]], outputs: [['t:ingot@0', 1]] },
      { id: 'c', mteId: IDS.CHEM_HV, count: 1, tier: 3, inputs: [['t:dust@0', 2]], outputs: [['t:out_c@0', 1]] },
    ], { flows: [{ from: 'raw', to: 'a', key: 't:in@0', perSecond: 3 }, { from: 'a', to: 'b', key: 't:dust@0', perSecond: 1 },
      { from: 'a', to: 'c', key: 't:dust@0', perSecond: 2 }, { from: 'b', to: 'out', key: 't:ingot@0', perSecond: 1 },
      { from: 'c', to: 'out', key: 't:out_c@0', perSecond: 1 }] });
    const m = buildMode('enderio', { ...setup(machines), network: null });
    expect(faces(m).find((f) => f.target === 'Basic Macerator')!.extract!.roundRobin).toBe(true);
  });

  it('leaves round robin off when the output chest takes a side\'s item on its colour, though no flow of that side goes there', () => {
    // a's dust goes only to b and d, but x sends its surplus dust out, and b, taking dust from both, puts a, x and the
    // output chest on one channel. EnderIO offers each extraction to every face of the side's colour whose filter
    // passes the item (NetworkedInventory.updateInsertOrder), so with round robin on the chest would take every third
    // of a's dust too
    const plan = makePlan([
      { id: 'a', mteId: IDS.MACERATOR, count: 1, outputs: [['t:dust@0', 2]] },
      { id: 'x', mteId: IDS.EXTRACTOR, count: 1, outputs: [['t:dust@0', 2]] },
      { id: 'b', mteId: IDS.ASSEMBLER, count: 1, tier: 2, inputs: [['t:dust@0', 2]], outputs: [['t:ingot@0', 1]] },
      { id: 'd', mteId: IDS.CHEM_HV, count: 1, tier: 3, inputs: [['t:dust@0', 1]], outputs: [['t:out_d@0', 1]] },
    ], { flows: [{ from: 'raw', to: 'a', key: 't:in@0', perSecond: 2 }, { from: 'raw', to: 'x', key: 't:in@0', perSecond: 2 },
      { from: 'a', to: 'b', key: 't:dust@0', perSecond: 1 }, { from: 'a', to: 'd', key: 't:dust@0', perSecond: 1 },
      { from: 'x', to: 'b', key: 't:dust@0', perSecond: 1 }, { from: 'x', to: 'out', key: 't:dust@0', perSecond: 1 },
      { from: 'b', to: 'out', key: 't:ingot@0', perSecond: 1 }, { from: 'd', to: 'out', key: 't:out_d@0', perSecond: 1 }] });
    const r = buildMode('enderio', { ...setup(plan), network: null });
    const at = (target: string) => faces(r).find((f) => f.target === target)!;
    const [a, x, b, d, out] = [at('Basic Macerator'), at('Basic Fluid Extractor'), at('Advanced Assembler'), at('Advanced Chemical Reactor'),
      at('Chest (output)')];
    expect([a.extract!.color, x.extract!.color, b.insert!.color, d.insert!.color, out.insert!.color]).toEqual(['red', 'red', 'red', 'red', 'red']);
    expect(out.insert!.filter!.keys).toContain('t:dust@0');
    expect([a.extract!.roundRobin, x.extract!.roundRobin, b.insert!.priority, d.insert!.priority, out.insert!.priority]).toEqual([false, false, 1, 1, 0]);
  });

  it('sends items for owned machines and unplanned byproducts through the chests', () => {
    const plan = makePlan([
      { id: 'p', mteId: IDS.ASSEMBLER, count: 1, owned: 1, tier: 2, outputs: [['t:dust@0', 1]] },
      { id: 'q', mteId: IDS.MACERATOR, count: 1, inputs: [['t:dust@0', 1]], outputs: [['t:out_q@0', 1], ['t:ingot@0', 1]] },
    ], { flows: [{ from: 'raw', to: 'p', key: 't:in@0', perSecond: 1 }, { from: 'p', to: 'q', key: 't:dust@0', perSecond: 1 },
      { from: 'q', to: 'out', key: 't:out_q@0', perSecond: 1 }] });
    const r = buildMode('enderio', { ...setup(plan), network: null });
    expect(r.blocks.filter((b) => b.role === 'chest').map((b) => b.tail)).toEqual([
      { side: 'input', keys: ['t:dust@0'] }, { side: 'output', keys: ['t:ingot@0', 't:out_q@0'] }]);
    const q = faces(r).find((f) => f.target === 'Basic Macerator')!;
    expect([q.extract!.filter!.keys, q.insert!.filter!.keys]).toEqual([['t:ingot@0', 't:out_q@0'], ['t:dust@0']]);
  });

  it('uses an Advanced Item Filter for six inputs and warns past 24', () => {
    const six = faces(buildMode('enderio', { ...setup(manyInputs(6)), network: null })).find((f) => f.target === 'Advanced Assembler')!;
    expect(six.insert!.filter!.item).toBe('EnderIO:itemBasicFilterUpgrade@1');
    const r = buildMode('enderio', { ...setup(manyInputs(25)), network: null });
    expect(r.warnings).toContainEqual({ code: 'filter_full', stepId: 's1',
      text: 'The insert filter toward Advanced Assembler holds 24 items, so t:i24@0 is left out: move it by hand' });
  });

  it('adds speed upgrades to a fast face and warns past 128 items/s', () => {
    const fast = (rate: number) => makePlan([{ id: 's1', mteId: IDS.MACERATOR, count: 1 }], { flows: [
      { from: 'raw', to: 's1', key: 't:in@0', perSecond: rate }, { from: 's1', to: 'out', key: 't:out_s1@0', perSecond: rate }] });
    const f = faces(buildMode('enderio', { ...setup(fast(20)), network: null })).find((g) => g.target === 'Basic Macerator')!;
    expect(f.extract!.speed).toEqual({ item: 'EnderIO:itemExtractSpeedUpgrade@0', count: 2 });
    expect(buildMode('enderio', { ...setup(fast(200)), network: null }).warnings).toContainEqual({ code: 'conduit_rate', stepId: 's1',
      text: 'No item conduit face moves 200 items/s out of Basic Macerator: 15 Item Conduit Speed Upgrades move 128 items/s, so the line runs slower' });
  });

  it('inserts into a multiblock input bus and extracts from its output bus', () => {
    const plan = makePlan([{ id: 'e', mteId: IDS.EBF, count: 1, tier: 2, inputs: [['t:dust@0', 1]], outputs: [['t:ingot@0', 1]] }],
      { flows: [{ from: 'raw', to: 'e', key: 't:dust@0', perSecond: 1 }, { from: 'e', to: 'out', key: 't:ingot@0', perSecond: 1 }] });
    const s = setup(plan);
    const r = buildMode('enderio', { ...s, network: null });
    const unit = s.placement.units[0]!;
    const busKind = (mteId: number | undefined) => unit.cells.find((c) => c.block.mteId === mteId)?.hatch;
    for (const port of unit.ports.items) {
      const behind = step(port, OPPOSITE[unit.facing]!);
      const hatch = busKind(s.placement.blocks.find((b) => posKey(b.pos) === posKey(behind))!.block.mteId);
      const face = faces(r).find((f) => posKey(f.pos) === posKey(port) && f.mode !== 'disabled')!;
      expect(face.mode).toBe(hatch === 'input_bus' ? 'insert' : 'extract');
      expect(face.insert?.outputSide).toBeUndefined();                              // a bus takes items whatever its side
    }
    expect(r.configs).toEqual([]);
  });

  it('disables the face toward a machine that moves no items', () => {
    const plan = makePlan([
      { id: 'x', mteId: IDS.EXTRACTOR, count: 1, inputs: [['fluid:oxygen', 10]], outputs: [['fluid:molten.iron', 144]] },
      { id: 's2', mteId: IDS.MACERATOR, count: 1 },
    ], { flows: [{ from: 'raw', to: 'x', key: 'fluid:oxygen', perSecond: 10 }, { from: 'x', to: 'out', key: 'fluid:molten.iron', perSecond: 144 },
      { from: 'raw', to: 's2', key: 't:in@0', perSecond: 1 }, { from: 's2', to: 'out', key: 't:out_s2@0', perSecond: 1 }] });
    const f = faces(buildMode('enderio', { ...setup(plan), network: null })).find((g) => g.kind === 'item' && g.target === 'Basic Fluid Extractor')!;
    expect([f.mode, f.extract, f.insert]).toEqual(['disabled', undefined, undefined]);
  });

  it('sets every extract face to Always active (EnderIO falls back to Active with signal)', () => {
    for (const plan of [twoStep(), sharedPlan(), manyInputs(6)]) {
      for (const f of faces(buildMode('enderio', { ...setup(plan), network: null }))) if (f.extract !== undefined) expect(f.extract.redstone).toBe('ignore');
    }
  });

  it('lays nothing when no machine moves items', () => {
    const plan = makePlan([{ id: 'x', mteId: IDS.EXTRACTOR, count: 1, inputs: [['fluid:oxygen', 10]], outputs: [['fluid:molten.iron', 144]] }],
      { flows: [{ from: 'raw', to: 'x', key: 'fluid:oxygen', perSecond: 10 }, { from: 'x', to: 'out', key: 'fluid:molten.iron', perSecond: 144 }] });
    expect(buildMode('enderio', { ...setup(plan, PORT_SPACING.enderio), network: null }).blocks.filter((b) => b.conduits?.some((c) => c.kind === 'item'))).toEqual([]);
  });
});

describe('EnderIO mode — tail chests, the storage tap and warnings', () => {
  const SPEED = 'EnderIO:itemExtractSpeedUpgrade@0';
  const oneMacerator = (rate: number) => makePlan([{ id: 's1', mteId: IDS.MACERATOR, count: 1 }], { flows: [
    { from: 'raw', to: 's1', key: 't:in@0', perSecond: rate }, { from: 's1', to: 'out', key: 't:out_s1@0', perSecond: rate }] });

  it('stacks one more output chest above the tail for every 24 more final items, on a conduit joined to the one below', () => {
    const many = keysN(26);
    const plan = makePlan([
      { id: 'a', mteId: IDS.MACERATOR, count: 1, outputs: many.slice(0, 13).map((k): [string, number] => [k, 1]) },
      { id: 'b', mteId: IDS.ASSEMBLER, count: 1, tier: 2, outputs: many.slice(13).map((k): [string, number] => [k, 1]) },
    ], { flows: [{ from: 'raw', to: 'a', key: 't:in@0', perSecond: 1 }, { from: 'raw', to: 'b', key: 't:in@0', perSecond: 1 },
      ...many.map((key, i) => ({ from: i < 13 ? 'a' : 'b', to: 'out', key, perSecond: 1 }))] });
    const r = buildMode('enderio', { ...setup(plan), network: null });
    expect(r.blocks.filter((b) => b.role === 'chest').map((b) => [b.pos, b.tail])).toEqual([
      [[2, 0, 1], { side: 'input', keys: ['t:in@0'] }], [[2, 0, 3], { side: 'output', keys: many.slice(0, 24) }],
      [[2, 1, 3], { side: 'output', keys: ['t:i24@0', 't:i25@0'] }]]);
    const riser = r.blocks.find((b) => posKey(b.pos) === '2,1,2')!;
    expect([riser.label, riser.connections, riser.conduits]).toEqual(['Item Conduit', 1 | 8, [{ kind: 'item', item: ITEM, connections: 1, faces: [
      { face: 'south', mode: 'insert', target: 'Chest (output)', insert: { color: 'red', filter: basic(['t:i24@0', 't:i25@0']), rate: 2, priority: 0 } }] }]]);
    expect(r.blocks.find((b) => posKey(b.pos) === '2,0,2')!.connections).toBe(2 | 4 | 8 | 16);
    // the assembler's outputs go into both output chests, the macerator's into the first only; round robin stays off
    // toward chests, each of which takes only its own items
    expect([faces(r).find((f) => f.target === 'Advanced Assembler')!.extract!.roundRobin, faces(r).find((f) => f.target === 'Basic Macerator')!.extract!.roundRobin])
      .toEqual([false, false]);
    expect([r.tailFluidY, r.warnings, r.drafts[0]!.text]).toEqual([2, [],
      "Lay 3× Item Conduit along the middle row so it touches every machine's output side or bus, with an input chest and 2 output chests at the end"]);
  });

  it('warns once for a machine and once for the input chest when a face cannot move its rate (plan 11, ruling R9)', () => {
    const r = buildMode('enderio', { ...setup(oneMacerator(200)), network: null });
    const why = ': 15 Item Conduit Speed Upgrades move 128 items/s, so the line runs slower';
    expect(r.warnings).toEqual([
      { code: 'conduit_rate', stepId: 's1', text: `No item conduit face moves 200 items/s out of Basic Macerator${why}` },
      { code: 'conduit_rate', text: `No item conduit face moves 200 items/s out of the input chest${why}` }]);
    expect(faces(r).find((f) => f.target === 'Chest (input)')!.extract!.speed).toEqual({ item: SPEED, count: 15 });
  });

  it('names every item a full filter leaves out, and gives the input chest face no step', () => {
    const left = 't:i24@0 and t:i25@0 are left out: move them by hand';
    expect(buildMode('enderio', { ...setup(manyInputs(26)), network: null }).warnings).toEqual([
      { code: 'filter_full', stepId: 's1', text: `The insert filter toward Advanced Assembler holds 24 items, so ${left}` },
      { code: 'filter_full', text: `The extract filter toward Chest (input) holds 24 items, so ${left}` }]);
  });

  it('keeps sixteen channels that trade nothing off their flows on one colour', () => {
    const ids = Array.from({ length: 16 }, (_, i) => `e${String(i).padStart(2, '0')}`);
    // sixteen machines that only take Raw Input (and make nothing, so no fluid conduit is laid), each its own channel:
    // nothing feeds them, so nothing links their faces, and with no extract side no face hands a key to another channel
    const plan = makePlan(ids.map((id): StepSpec => ({ id, mteId: IDS.EXTRACTOR, count: 1, outputs: [] })), { flows: [] });
    const r = buildMode('enderio', { ...setup(plan), network: null });
    expect(faces(r).map((f) => [f.mode, f.insert!.color])).toEqual(ids.map(() => ['insert', 'red']));
    expect(r.warnings).toEqual([]);
    expect(r.drafts).toEqual([{ id: 'layout:logistics:line', kind: 'logistics', pin: 'site',
      text: "Lay 9× Item Conduit along the middle row so it touches every machine's output side or bus" }]);
  });

  it('says which items can reach a face the plan does not send them to once more than 15 channels are needed', () => {
    const { pack, plan } = setup(manyInputs(1));
    expect(channelWarnings({ pack, plan }, { shared: [{ color: 'red', keys: ['t:i00@0'] }, { color: 'blue', keys: ['t:i00@0', 't:in@0'] }] })).toEqual([
      { code: 'conduit_channels', text: 'More than 15 conduit channels are needed: Red also carries t:i00@0, so it can reach a face the plan does not send it to' },
      { code: 'conduit_channels',
        text: 'More than 15 conduit channels are needed: Blue also carries t:i00@0 and Raw Input, so they can reach a face the plan does not send them to' }]);
  });

  it('sizes the storage tap face to the input rate and lists its filter and speed upgrades', () => {
    const network = makeScan({ logistics: [{ kind: 'enderio', taps: [[0, 64, 0]] }] }).logistics[0]!;
    const r = buildMode('enderio', { ...setup(oneMacerator(20)), network });
    expect(r.extraParts).toEqual([
      { key: BASIC, amount: 1, why: 'filter at the storage tap', group: 'logistics' },
      { key: SPEED, amount: 2, why: 'speed upgrades at the storage tap', group: 'logistics' }]);
    expect(r.drafts.map((d) => d.id)).toEqual(['layout:logistics:line', 'layout:configure:conduit-tap']);
    expect(r.drafts[1]!.text).toBe('At the storage tap set the conduit face toward your storage to Extract (In / Out if it already inserts, its insert '
      + 'side left as it is); extract on Light Gray with a Basic Item Filter (whitelist, 1 of 5 slots: Raw Input; match meta, ignore NBT), 2× Item Conduit Speed '
      + `Upgrade, round robin off, self feed off, redstone Always active. ${TAP_NOTE}`);
    expect(r.hookup!.endConduit!.face.insert).toEqual({ color: 'silver', filter: basic(['t:in@0']), rate: 20, priority: 1 });
  });

  it("disables the face toward a multiblock's controller and names the multiblock on each of its faces", () => {
    const plan = makePlan([{ id: 'e', mteId: IDS.EBF, count: 1, tier: 2, inputs: [['t:dust@0', 1]], outputs: [['t:ingot@0', 1]] }],
      { flows: [{ from: 'raw', to: 'e', key: 't:dust@0', perSecond: 2 }, { from: 'e', to: 'out', key: 't:ingot@0', perSecond: 2 }] });
    const r = buildMode('enderio', { ...setup(plan), network: null });
    // output bus behind 1,0,4, the controller behind 2,0,4, input bus behind 3,0,4; the tail cell is x 4
    expect(faces(r).filter((f) => f.pos[0] < 4).map((f) => [f.pos, f.face, f.mode, f.target, f.extract?.filter?.keys, f.extract?.rate, f.insert?.filter?.keys,
      f.insert?.rate])).toEqual([
      [[1, 0, 4], 'north', 'extract', 'Electric Blast Furnace', ['t:ingot@0'], 2, undefined, undefined],
      [[2, 0, 4], 'north', 'disabled', 'Electric Blast Furnace', undefined, undefined, undefined, undefined],
      [[3, 0, 4], 'north', 'insert', 'Electric Blast Furnace', undefined, undefined, ['t:dust@0'], 2]]);
    expect(r.blocks.find((b) => posKey(b.pos) === '2,0,4')!.connections).toBe(16 | 32);   // a disabled face connects nothing
  });

  it("joins a byproduct no flow carries to the output chest on its machine's channel", () => {
    const plan = makePlan([
      { id: 'q', mteId: IDS.MACERATOR, count: 1, outputs: [['t:dust@0', 1], ['t:by@0', 1]] },
      { id: 'r', mteId: IDS.ASSEMBLER, count: 1, tier: 2, inputs: [['t:dust@0', 1]] },
    ], { flows: [{ from: 'raw', to: 'q', key: 't:in@0', perSecond: 1 }, { from: 'q', to: 'r', key: 't:dust@0', perSecond: 1 },
      { from: 'r', to: 'out', key: 't:out_r@0', perSecond: 1 }] });
    const r = buildMode('enderio', { ...setup(plan), network: null });
    const [q, out] = [faces(r).find((f) => f.target === 'Basic Macerator')!, faces(r).find((f) => f.target === 'Chest (output)')!];
    expect([q.extract!.color, q.extract!.roundRobin, out.insert!.color, out.insert!.filter!.keys]).toEqual(['red', false, 'red', ['t:by@0', 't:out_r@0']]);
  });

  it('rates each tail chest face by what crosses the line there', () => {
    const r = buildMode('enderio', { ...setup(sharedPlan()), network: null });
    const at = (target: string) => faces(r).find((f) => f.target === target)!;
    // in: 3/s Raw Input; out: the dust the machines leave (1/s), the ingot and t:out_c@0 — not the dust that feeds the machines
    expect([at('Chest (input)').extract!.rate, at('Chest (output)').insert!.rate]).toEqual([3, 3]);
  });

  it("lists a step's item outputs once each, sorted, without its fluids", () => {
    const plan = makePlan([{ id: 's', mteId: IDS.MACERATOR, count: 1, outputs: [['t:b@0', 1], ['fluid:molten.iron', 1], ['t:a@0', 1], ['t:b@0', 2]] }]);
    expect([stepItemOutputs(plan, 's'), stepItemOutputs(plan, 'nope')]).toEqual([['t:a@0', 't:b@0'], []]);
  });

  it('gives the same result for the same plan', () => {
    const build = () => JSON.stringify(buildMode('enderio', { ...setup(sharedPlan()), network: makeScan({ logistics: [{ kind: 'enderio', taps: [[0, 64, 0]] }] }).logistics[0]! }));
    expect(build()).toBe(build());
  });
});
