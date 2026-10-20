// Routed lines that move their items (architecture §11 entry 51; research docs/research/machine-feeding.md §2.2, §4.1,
// §6.4 item 1, from ProjRed-4.12.44-GTNH's bytecode): a new Item Extractor Chip is a whitelist with an empty filter, so
// each one whitelists what its machine makes (the input chest's: what enters the line); an input bus gets no Extractor
// (it would pull the inputs back out) and an output bus no Responder (it takes nothing in); and the output chest takes
// everything that leaves the placed machines, to your storage, to a step the line places no machine for or as a stray,
// on an Item Terminator Chip, which routing ranks below every machine's Item Responder Chip. The chips and their filters
// are the interface pipes' structured `feed`, and the configure steps word them; the logistics steps name what goes in
// the input chest.

import { describe, expect, it } from 'vitest';
import { placeUnits, unitsFromPlan } from '../../../src/server/layout/arrange.ts';
import { emptyScan, layoutLine } from '../../../src/server/layout/layout.ts';
import { buildMode, PORT_SPACING } from '../../../src/server/layout/modes/mode.ts';
import { resolveParts } from '../../../src/server/layout/parts.ts';
import type { StuffKey } from '../../../src/shared/keys.ts';
import type { RoutedChipSpec } from '../../../src/shared/types/feed.ts';
import type { Plan } from '../../../src/shared/types/plan.ts';
import { IDS, layoutPack, makePlan, makeProject, makeScan } from '../../helpers/layout-fixtures.ts';

const routedNet = () => makeScan({ logistics: [{ kind: 'routed', taps: [[0, 64, 0]] }] }).logistics[0]!;

function routed(plan: Plan) {
  const pack = layoutPack();
  const placement = placeUnits(unitsFromPlan(pack, plan).units, { headWidth: 1, portSpacing: PORT_SPACING.routed });
  return buildMode('routed', { pack, plan, parts: resolveParts(pack), placement, network: routedNet() });
}

const whitelist = (kind: RoutedChipSpec['kind'], keys: StuffKey[]): RoutedChipSpec => ({ kind, filter: { mode: 'whitelist', keys } });
const chipsOf = (r: ReturnType<typeof routed>, label: string) => r.blocks.filter((b) => b.label === label).map((b) => b.feed?.chips);

/** s1 (2 macerators) makes `t:out_s1@0` for s2 (an assembler), which makes `t:out_s2@0` for your storage. */
const twoStep = () => makePlan([{ id: 's1', mteId: IDS.MACERATOR, count: 2 }, { id: 's2', mteId: IDS.ASSEMBLER, count: 1, tier: 2, euPerTick: 120 }]);

describe('routed feeding', () => {
  it("whitelists each machine's outputs on its Item Extractor Chip and the line's inputs on the input chest's", () => {
    const r = routed(twoStep());
    expect(chipsOf(r, 'Routed Interface Pipe (Basic Macerator)')).toEqual([
      [whitelist('responder', ['t:in@0']), whitelist('extractor', ['t:out_s1@0'])],
      [whitelist('responder', ['t:in@0']), whitelist('extractor', ['t:out_s1@0'])]]);
    expect(chipsOf(r, 'Routed Interface Pipe (Advanced Assembler)')).toEqual([[whitelist('responder', ['t:out_s1@0']), whitelist('extractor', ['t:out_s2@0'])]]);
    expect(chipsOf(r, 'Routed Interface Pipe (input chest)')).toEqual([[whitelist('extractor', ['t:in@0'])]]);
    expect(chipsOf(r, 'Routed Interface Pipe (output chest)')).toEqual([[whitelist('terminator', ['t:out_s2@0'])]]);
    // the chips are structured data now, not a sentence in `config`
    expect(r.blocks.filter((b) => b.role === 'chip_pipe').map((b) => b.config)).toEqual([undefined, undefined, undefined, undefined, undefined]);
    expect(r.extraParts).toEqual([
      { key: 'ProjRed|Transportation:projectred.transportation.routingchip@0', amount: 3, why: 'interface pipe chips', group: 'logistics' },
      { key: 'ProjRed|Transportation:projectred.transportation.routingchip@4', amount: 4, why: 'interface pipe chips', group: 'logistics' },
      { key: 'ProjRed|Transportation:projectred.transportation.routingchip@3', amount: 1, why: 'interface pipe chips', group: 'logistics' }]);
  });

  it('sends whatever leaves the placed machines to the output chest, strays and items for steps without machines too, and takes in what enters', () => {
    // h2 (by hand) makes t:w@0 for s2; s1's t:y@0 has no flow (a stray); s2's t:z@0 goes to h (by hand), which makes the target
    const plan = makePlan([
      { id: 's1', mteId: IDS.MACERATOR, count: 1, outputs: [['t:x@0', 1], ['t:y@0', 1]] },
      { id: 'h2', mteId: -3, count: 1, handCraft: true, inputs: [['t:q@0', 1]], outputs: [['t:w@0', 1]] },
      { id: 's2', mteId: IDS.ASSEMBLER, count: 1, tier: 2, inputs: [['t:x@0', 1], ['t:w@0', 1]], outputs: [['t:z@0', 1]] },
      { id: 'h', mteId: -3, count: 1, handCraft: true, inputs: [['t:z@0', 1]], outputs: [['t:out@0', 1]] },
    ], { flows: [
      { from: 'raw', to: 's1', key: 't:in@0', perSecond: 1 }, { from: 'raw', to: 'h2', key: 't:q@0', perSecond: 1 },
      { from: 'h2', to: 's2', key: 't:w@0', perSecond: 1 }, { from: 's1', to: 's2', key: 't:x@0', perSecond: 1 },
      { from: 's2', to: 'h', key: 't:z@0', perSecond: 1 }, { from: 'h', to: 'out', key: 't:out@0', perSecond: 1 }] });
    const r = routed(plan);
    expect(r.blocks.filter((b) => b.role === 'chest').map((b) => [b.label, b.tail])).toEqual([
      ['Chest (input)', { side: 'input', keys: ['t:in@0', 't:w@0'] }], ['Chest (output)', { side: 'output', keys: ['t:y@0', 't:z@0'] }]]);
    expect(chipsOf(r, 'Routed Interface Pipe (input chest)')).toEqual([[whitelist('extractor', ['t:in@0', 't:w@0'])]]);
    expect(chipsOf(r, 'Routed Interface Pipe (output chest)')).toEqual([[whitelist('terminator', ['t:y@0', 't:z@0'])]]);
    expect(chipsOf(r, 'Routed Interface Pipe (Basic Macerator)')).toEqual([[whitelist('responder', ['t:in@0']), whitelist('extractor', ['t:x@0', 't:y@0'])]]);
    // the steps name what goes in the input chest: the raw inputs to order at the request pipe, what you make to put in
    expect(r.drafts.slice(1)).toEqual([
      { id: 'layout:logistics:request', kind: 'logistics', pin: 'site', text: 'Request the raw inputs at the request pipe — they arrive in the input chest: '
        + 'Raw Input' },
      { id: 'layout:logistics:made', kind: 'logistics', pin: 'site', text: 'Put what you make for the line yourself in the input chest: t:w@0' }]);
    // with no routed network at the base the request pipe has nothing to order from: you put the raw inputs in too
    const pack = layoutPack();
    const placement = placeUnits(unitsFromPlan(pack, plan).units, { headWidth: 1, portSpacing: PORT_SPACING.routed });
    const own = buildMode('routed', { pack, plan, parts: resolveParts(pack), placement, network: null });
    expect(own.drafts.slice(1).map((d) => [d.id, d.text])).toEqual([
      ['layout:logistics:inputs', 'Put the raw inputs in the input chest: Raw Input'],
      ['layout:logistics:made', 'Put what you make for the line yourself in the input chest: t:w@0']]);
  });

  it('gives an input bus only an Item Responder Chip and an output bus only an Item Extractor Chip', () => {
    const plan = makePlan([{ id: 'e', mteId: IDS.EBF, count: 1, tier: 2, euPerTick: 120, inputs: [['t:dust@0', 1]], outputs: [['t:ingot@0', 1]] }]);
    const r = routed(plan);
    // each pipe by the bus it touches
    const placement = placeUnits(unitsFromPlan(layoutPack(), plan).units, { headWidth: 1, portSpacing: PORT_SPACING.routed });
    const busAt = new Map(placement.blocks.filter((b) => b.hatch !== undefined).map((b) => [b.pos.join(','), b.hatch]));
    const pipes = r.blocks.filter((b) => b.label === 'Routed Interface Pipe (Electric Blast Furnace)');
    const touched = (p: (typeof pipes)[number]) => [[0, -1, 0], [0, 1, 0], [0, 0, -1], [0, 0, 1], [-1, 0, 0], [1, 0, 0]]
      .map((d) => busAt.get([p.pos[0] + d[0]!, p.pos[1] + d[1]!, p.pos[2] + d[2]!].join(','))).find((h) => h !== undefined);
    expect(pipes.map((p) => [touched(p), p.feed?.chips]).sort()).toEqual([
      ['input_bus', [whitelist('responder', ['t:dust@0'])]], ['output_bus', [whitelist('extractor', ['t:ingot@0'])]]]);
  });

  it('puts at most nine items on a chip and at most four chips on a pipe, and says what is left over', () => {
    const many = (n: number, from = 0): Array<[StuffKey, number]> => Array.from({ length: n }, (_, i): [StuffKey, number] => [`t:k${i + from}@0`, 1]);
    const ten = routed(makePlan([{ id: 'a', mteId: IDS.ASSEMBLER, count: 1, tier: 2, inputs: many(10) }],
      { flows: [...many(10).map(([key]) => ({ from: 'raw', to: 'a', key, perSecond: 1 })), { from: 'a', to: 'out', key: 't:out_a@0', perSecond: 1 }] }));
    const keys = many(10).map(([k]) => k).sort();
    expect(chipsOf(ten, 'Routed Interface Pipe (Advanced Assembler)')).toEqual([[whitelist('responder', keys.slice(0, 9)), whitelist('responder', keys.slice(9)),
      whitelist('extractor', ['t:out_a@0'])]]);
    expect(chipsOf(ten, 'Routed Interface Pipe (input chest)')).toEqual([[whitelist('extractor', keys.slice(0, 9)), whitelist('extractor', keys.slice(9))]]);
    expect(ten.warnings.map((w) => w.code)).toEqual([]);

    const forty = routed(makePlan([{ id: 'a', mteId: IDS.ASSEMBLER, count: 1, tier: 2, inputs: many(40) }],
      { flows: [...many(40).map(([key]) => ({ from: 'raw', to: 'a', key, perSecond: 1 })), { from: 'a', to: 'out', key: 't:out_a@0', perSecond: 1 }] }));
    const pipe = forty.blocks.find((b) => b.label === 'Routed Interface Pipe (Advanced Assembler)')!;
    expect(pipe.feed?.chips?.map((c) => [c.kind, c.filter?.keys.length])).toEqual([['responder', 9], ['responder', 9], ['responder', 9], ['responder', 9]]);
    const left = many(40).map(([k]) => k).sort().slice(36);
    expect(forty.warnings.filter((w) => w.code === 'routed_chips_short')).toEqual([
      { code: 'routed_chips_short', stepId: 'a', text: `The interface pipe of the Advanced Assembler holds 4 chips of 9 items each, too few for `
        + `${left.join(', ')} and t:out_a@0: move them by hand` },
      { code: 'routed_chips_short', text: 'The interface pipe of the input chest holds 4 chips of 9 items each, too few for '
        + `${left.slice(0, -1).join(', ')} and ${left.at(-1)!}: move them by hand` }]);
  });

  it('words every chip in the configure steps and keeps the chips on the laid-out line', async () => {
    const project = { ...makeProject({ logistics: 'routed', scanId: null, baseId: null }) };
    const layout = await layoutLine(layoutPack(), twoStep(), emptyScan(), project);
    const texts = layout.buildSteps.filter((s) => s.kind === 'configure').map((s) => s.text);
    // the interface pipes are the mode's own blocks, each with its own step, as before
    expect(texts.filter((t) => t.startsWith('Routed Interface Pipe (Basic Macerator): '))).toEqual(Array(2).fill('Routed Interface Pipe (Basic Macerator): '
      + 'chips: Item Responder Chip (whitelist: Raw Input) + Item Extractor Chip (whitelist: t:out_s1@0)'));
    expect(texts).toContain('Routed Interface Pipe (output chest): chips: Item Terminator Chip (whitelist: t:out_s2@0)');
    expect(layout.blocks.find((b) => b.label === 'Routed Interface Pipe (input chest)')?.feed).toEqual({ chips: [whitelist('extractor', ['t:in@0'])] });
  });
});
