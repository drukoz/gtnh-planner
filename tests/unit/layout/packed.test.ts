// RUK-2877 (M3-P2): the packed line as a search candidate. `buildLocal` lays the line packed three machines to a cable
// cell (`placePacked`, west head only) in direct and EnderIO, as one last candidate the search keeps when it wins. The
// first test pins where that candidate is laid, the second that packing alone powers the 40-machine direct line the
// middle head starves, and the third lays a packed line with two products up its tail column.
import { describe, it, expect } from 'vitest';
import { layoutLine } from '../../../src/server/layout/layout.ts';
import { CandidateKind } from '../../../src/shared/types/layout.ts';
import type { Face } from '../../../src/shared/types/assets.ts';
import { layoutPack, makePlan, makeProject, IDS } from '../../helpers/layout-fixtures.ts';
import { lossGround, lossLine, lossScan, overlaps } from '../../helpers/power-loss.ts';
import { lengthOf } from '../../helpers/layout-bench.ts';

/** The world offset of each face, as `LayoutBlock.facing` numbers it (`DIRS`). */
const SIDE: Record<Face, readonly [number, number, number]> = {
  down: [0, -1, 0], up: [0, 1, 0], north: [0, 0, -1], south: [0, 0, 1], west: [-1, 0, 0], east: [1, 0, 0],
};

describe('the packed line as a search candidate', () => {
  it('lays the packed candidates last: one in direct and enderio, two in ae2, none in routed', async () => {
    for (const mode of ['direct', 'enderio', 'routed', 'ae2'] as const) {
      const { layout } = await lossLine(10, mode);
      const kinds = layout.search!.candidates.map((c) => c.kind);
      const packed = kinds.filter((k) => k === CandidateKind.Packed || k === CandidateKind.PackedOpen);
      if (mode === 'ae2') {
        expect(kinds.slice(-2), 'ae2: the open column is laid right after the closed one').toEqual([CandidateKind.Packed, CandidateKind.PackedOpen]);
        expect(packed, 'ae2: exactly the two packed candidates').toHaveLength(2);
      } else if (mode !== 'routed') {
        expect(packed.length, `${mode}: one packed candidate`).toBe(1);
        expect(kinds.at(-1), `${mode}: packed laid last`).toBe(CandidateKind.Packed);
        expect(kinds, `${mode}: the open column is AE2's alone`).not.toContain(CandidateKind.PackedOpen);
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
    expect(layout.size).toEqual([7, 4, 5]);
    expect(overlaps(layout.blocks)).toEqual([]);
    expect(lengthOf(layout).total).toBe(38);
  }, 60_000);

  it('lays a 6-machine AE2 line packed, each ME Interface wrenched down into its own machine', async () => {
    const { layout } = await lossLine(6, 'ae2');
    expect(layout.search!.candidates[layout.search!.chosen]!.kind).toBe(CandidateKind.Packed);
    const own = layout.blocks.filter((b) => b.hookup === undefined);
    const at = new Map(own.map((b) => [b.pos.join(','), b]));
    const interfaces = own.filter((b) => b.role === 'interface');
    expect(interfaces).toHaveLength(6);
    for (const iface of interfaces) {
      expect(iface.feed?.interface?.targets, `interface at ${iface.pos.join(' ')} wrenched down`).toEqual(['down']);
      const below = at.get(`${iface.pos[0]},${iface.pos[1] - 1},${iface.pos[2]}`);
      expect(below?.role, `the block below the interface at ${iface.pos.join(' ')}`).toBe('machine');
    }
  }, 60_000);

  it('lays the 10-machine AE2 line packed open, each ME Interface wrenched into its own machine', async () => {
    // the open column (spike SP-I, RUK-3016) wins the 10-machine line: every interface stands on the box's outer face,
    // wrenched into the machine behind it, and no builder is walled out.
    const { layout } = await lossLine(10, 'ae2');
    const chosen = layout.search!.candidates[layout.search!.chosen]!;
    expect(chosen.kind, 'the search keeps the open column').toBe(CandidateKind.PackedOpen);
    expect(chosen.unreachable, 'the open column reaches every machine').toBe(0);
    const own = layout.blocks.filter((b) => b.hookup === undefined);
    const at = new Map(own.map((b) => [b.pos.join(','), b]));
    const interfaces = own.filter((b) => b.role === 'interface');
    expect(interfaces).toHaveLength(10);
    for (const iface of interfaces) {
      const targets = iface.feed?.interface?.targets;
      expect(targets, `the interface at ${iface.pos.join(' ')} has one wrench target`).toHaveLength(1);
      const [dx, dy, dz] = SIDE[targets![0]!];
      const wrenched = at.get(`${iface.pos[0] + dx},${iface.pos[1] + dy},${iface.pos[2] + dz}`);
      expect(wrenched?.role, `the interface at ${iface.pos.join(' ')} is wrenched into its own machine`).toBe('machine');
    }
    expect(layout.buildSteps.find((s) => s.id === 'layout:logistics:line')!.text, 'the build step describes the open lanes')
      .toContain('on the lanes beside the outer machines and above the middle ones');
  }, 60_000);

  it('never turns a machine\'s front onto its output side', async () => {
    // gt-mechanics "Front and output side": `setMainFacing` turns the output side away from the front, so a GT basic
    // machine's front is one of the four horizontal sides (0 is down, 1 up) and never its output side.
    for (const n of [10, 40]) {
      for (const mode of ['direct', 'routed', 'ae2', 'enderio'] as const) {
        const { layout } = await lossLine(n, mode);
        for (const b of layout.blocks.filter((b) => b.hookup === undefined && b.role === 'machine' && b.mainFacing !== undefined)) {
          expect(b.mainFacing, `${mode} ${n}: the front of the machine at ${b.pos.join(' ')} is a horizontal side`).toBeGreaterThanOrEqual(2);
          expect(b.mainFacing, `${mode} ${n}: the machine at ${b.pos.join(' ')} has its front on its output side`).not.toBe(b.facing);
        }
      }
    }
  }, 120_000);

  it('keeps the 40-machine AE2 line packed open: the closed column shuts 12 machines in, the open one none', async () => {
    // the closed packed column powers all 40 but shuts 12 of its middle Ts in; the open column (spike SP-I, RUK-3016)
    // reaches every machine, so the search keeps it.
    const { layout } = await lossLine(40, 'ae2');
    const packed = layout.search!.candidates.find((c) => c.kind === CandidateKind.Packed);
    expect(packed, 'the closed packed candidate is laid').toBeDefined();
    expect(packed!.unreachable, 'its middle T columns shut 12 machines in').toBe(12);
    const open = layout.search!.candidates.find((c) => c.kind === CandidateKind.PackedOpen);
    expect(open, 'the open packed candidate is laid').toBeDefined();
    expect(open!.unreachable, 'the open column reaches every machine').toBe(0);
    expect(layout.search!.candidates[layout.search!.chosen]!.kind, 'the search keeps the open column').toBe(CandidateKind.PackedOpen);
  }, 60_000);
});
