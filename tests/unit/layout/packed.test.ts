// RUK-2877 (M3-P2): the packed line as a search candidate. `buildLocal` lays the line packed three machines to a cable
// cell (`placePacked`, west head only) in direct and EnderIO, as one last candidate the search keeps when it wins. The
// first test pins where that candidate is laid, the second that packing alone powers the 40-machine direct line the
// middle head starves, and the third lays a packed line with two products up its tail column.
import { describe, it, expect } from 'vitest';
import { layoutLine } from '../../../src/server/layout/layout.ts';
import { CandidateKind } from '../../../src/shared/types/layout.ts';
import { layoutPack, makePlan, makeProject, IDS } from '../../helpers/layout-fixtures.ts';
import { lossGround, lossLine, lossScan, overlaps } from '../../helpers/power-loss.ts';
import { lengthOf } from '../../helpers/layout-bench.ts';

describe('the packed line as a search candidate', () => {
  it('lays one packed candidate, last, in direct and enderio only', async () => {
    for (const mode of ['direct', 'enderio', 'routed', 'ae2'] as const) {
      const { layout } = await lossLine(10, mode);
      const kinds = layout.search!.candidates.map((c) => c.kind);
      const packed = kinds.filter((k) => k === CandidateKind.Packed);
      if (mode === 'direct' || mode === 'enderio') {
        expect(packed.length, `${mode}: one packed candidate`).toBe(1);
        expect(kinds.at(-1), `${mode}: packed laid last`).toBe(CandidateKind.Packed);
      } else {
        expect(packed.length, `${mode}: no packed candidate`).toBe(0);
      }
    }
  }, 60_000);

  it('packing alone powers the 40-machine direct line with satellites off', async () => {
    const starved = (internal: { machines: Array<{ powered: boolean; tier: number; feedTier: number }> }): number =>
      internal.machines.filter((m) => !m.powered && m.tier <= m.feedTier).length;
    const packed = await lossLine(40, 'direct', { stacking: false });
    expect(starved(packed.internal), 'packed: starved by wiring').toBe(0);
    const plain = await lossLine(40, 'direct', { stacking: false, packing: false });
    expect(starved(plain.internal), 'unpacked: starved by wiring').toBe(7);
  }, 60_000);

  it('lays a packed line with two products up its tail column', async () => {
    const outputs: Array<[`t:${string}`, number]> = [['t:o0@0', 1], ['t:o1@0', 1]];
    const plan = makePlan([{ id: 'm', mteId: IDS.MACERATOR, count: 6, outputs }], {
      flows: [{ from: 'raw', to: 'm', key: 't:in@0', perSecond: 1 }, ...outputs.map(([key]) => ({ from: 'm', to: 'out', key, perSecond: 1 }))],
    });
    const layout = await layoutLine(layoutPack(), plan, lossScan('direct'), makeProject({ logistics: 'direct' }), lossGround());
    expect(layout.search!.candidates[layout.search!.chosen]!.kind).toBe(CandidateKind.Packed);
    expect(layout.blocks.filter((b) => b.hookup === undefined && b.role === 'chest').map((b) => ({ pos: b.pos, tail: b.tail }))).toEqual([
      { pos: [22, 64, 21], tail: { side: 'input', keys: ['t:in@0'] } },
      { pos: [23, 65, 21], tail: { side: 'output', keys: ['t:o0@0'] } },
      { pos: [23, 66, 21], tail: { side: 'output', keys: ['t:o1@0'] } },
    ]);
    expect(layout.size).toEqual([7, 3, 3]);
    expect(overlaps(layout.blocks)).toEqual([]);
    expect(lengthOf(layout).total).toBe(26);
  }, 60_000);
});
