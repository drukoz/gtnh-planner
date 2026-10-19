import { describe, it, expect } from 'vitest';
import { connectionsGraph } from '../../../src/client/connections/model.ts';
import { layoutLine } from '../../../src/server/layout/layout.ts';
import { posKey } from '../../../src/shared/layout/geometry.ts';
import { IDS, layoutPack, makePlan, makeProject } from '../../helpers/layout-fixtures.ts';
import { lineGround, lineScan, twoStep } from '../../helpers/enderio-fixtures.ts';

const placement = { origin: [30, 64, 10] as [number, number, number], rotation: 0 as const };

describe('Connections of laid-out lines', () => {
  it('shows every conduit face of an EnderIO line exactly once, a link per flow and the hookup', async () => {
    const plan = twoStep();
    const layout = await layoutLine(layoutPack(), plan, lineScan({ logistics: [{ kind: 'enderio', taps: [[26, 64, 12]] }] }),
      makeProject({ logistics: 'enderio', placement }), lineGround());
    const g = connectionsGraph(layout, plan, 'min');
    const faceCount = layout.blocks.reduce((n, b) => n + (b.conduits ?? []).reduce((m, c) => m + c.faces.length, 0), 0);
    expect(g.nodes.flatMap((n) => n.faces).filter((f) => f.id.includes('#conduit:'))).toHaveLength(faceCount);
    const chest = (side: 'input' | 'output') => `chest:${posKey(layout.blocks.find((b) => b.tail?.side === side)!.pos)}`;
    expect(g.edges.filter((e) => e.via === 'item_conduit').map((e) => [e.from, e.to])).toEqual([
      [chest('input'), 'step:s1'], ['step:s1', 'step:s2'], ['step:s2', chest('output')]]);
    expect(g.edges.filter((e) => e.via === 'item_conduit').every((e) => e.color !== null && e.fromFace !== null && e.toFace !== null)).toBe(true);
    const hookup = layout.hookups.findIndex((h) => h.kind === 'logistics');
    expect(g.edges.find((e) => e.via === 'hookup')).toMatchObject({ from: `hookup:${hookup}`, to: chest('input') });
  });

  it('builds a link per flow in the other three modes', async () => {
    for (const mode of ['direct', 'routed', 'ae2'] as const) {
      const layout = await layoutLine(layoutPack(), twoStep(), lineScan(), makeProject({ logistics: mode, placement }), lineGround());
      expect(connectionsGraph(layout, twoStep(), 'min').edges.filter((e) => e.key !== null)).toHaveLength(3);
    }
  });

  it('joins a routed hookup at the input chest and an AE2 hookup at the raw inputs, in every rotation', async () => {
    // the request pipe and the tail ME cable are in no box: a routed tap fills the input chest, an AE2 tap feeds the raw inputs
    const seen: unknown[] = [];
    const want: unknown[] = [];
    for (const rotation of [0, 90, 180, 270] as const) {
      for (const mode of ['routed', 'ae2'] as const) {
        const layout = await layoutLine(layoutPack(), twoStep(), lineScan({ logistics: [{ kind: mode, taps: [[26, 64, 12]] }] }),
          makeProject({ logistics: mode, placement: { ...placement, rotation } }), lineGround());
        const hookup = layout.hookups.findIndex((h) => h.kind === 'logistics');
        const links = connectionsGraph(layout, twoStep(), 'min').edges.filter((e) => e.via === 'hookup');
        if (mode === 'routed') {
          seen.push([mode, rotation, links.map((e) => [e.from, e.to])]);
          want.push([mode, rotation, [[`hookup:${hookup}`, `chest:${posKey(layout.blocks.find((b) => b.tail?.side === 'input')!.pos)}`]]]);
        } else {
          seen.push([mode, rotation, links.map((e) => [e.from, e.to, e.lines])]);
          want.push([mode, rotation, [[`hookup:${hookup}`, 'raw', ['Joins the line at Raw inputs']]]]);
        }
      }
    }
    expect(seen).toEqual(want);
  });

  it('puts the open fluid ends on the raw inputs and final outputs, linked over the ender fluid conduit', async () => {
    // a Basic Fluid Extractor taking Oxygen from outside the line and sending Molten Iron out of it: two open ends at the tail
    const plan = makePlan([{ id: 'x', mteId: IDS.EXTRACTOR, count: 1, inputs: [['fluid:oxygen', 10]], outputs: [['fluid:molten.iron', 144]] }],
      { flows: [{ from: 'raw', to: 'x', key: 'fluid:oxygen', perSecond: 10 }, { from: 'x', to: 'out', key: 'fluid:molten.iron', perSecond: 144 }] });
    const layout = await layoutLine(layoutPack(), plan, lineScan(), makeProject({ logistics: 'enderio', placement }), lineGround());
    const g = connectionsGraph(layout, plan, 'min');
    const faceCount = layout.blocks.reduce((n, b) => n + (b.conduits ?? []).reduce((m, c) => m + c.faces.length, 0), 0);
    expect(g.nodes.flatMap((n) => n.faces).filter((f) => f.id.includes('#conduit:'))).toHaveLength(faceCount);
    const tanks = (id: string) => g.nodes.find((n) => n.id === id)!.faces.map((f) => f.title);
    expect([tanks('raw'), tanks('out')]).toEqual([['your tank, west side · Ender Fluid Conduit'], ['your tank, west side · Ender Fluid Conduit']]);
    const owner = (face: string | null) => face?.slice(0, face.indexOf('#')) ?? null;
    expect(g.edges.filter((e) => e.key !== null).map((e) => [e.from, e.to, e.via, owner(e.fromFace), owner(e.toFace), e.color !== null])).toEqual([
      ['raw', 'step:x', 'fluid_conduit', 'raw', 'step:x', true], ['step:x', 'out', 'fluid_conduit', 'step:x', 'out', true]]);
  });
});
