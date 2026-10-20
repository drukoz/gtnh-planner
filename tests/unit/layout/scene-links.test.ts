// The 3D view on laid-out lines (the user's requirements of 2026-10-19, item 3): (a) every conduit connection of a real
// EnderIO layout drawn as EnderIO draws it — an arm per link and per set face, a set face's arm its connector, linked
// neighbours' arms meeting end to end, every arm reaching its face, bundles side by side and every tile opaque over
// its role's colour; (b) the Connections tab's links in the world for every logistics mode, from the shared model.

import { describe, it, expect } from 'vitest';
import { connectionSpans, connectionsGraph, type ConnGraph, type ConnSpan } from '../../../src/client/connections/model.ts';
import { blockKey, buildScene } from '../../../src/client/three/scene-data.ts';
import { layoutLine } from '../../../src/server/layout/layout.ts';
import { OPPOSITE, posKey, step } from '../../../src/shared/layout/geometry.ts';
import { FACES, type BlockFaces } from '../../../src/shared/types/assets.ts';
import type { Layout } from '../../../src/shared/types/layout.ts';
import type { Plan } from '../../../src/shared/types/plan.ts';
import { IDS, layoutPack, makePlan, makeProject, type ScanSpec } from '../../helpers/layout-fixtures.ts';
import { fluidPlan, keysN, lineGround, lineScan, twoStep } from '../../helpers/enderio-fixtures.ts';
import { conduitGaps } from '../../helpers/scene-checks.ts';

const placement = { origin: [30, 64, 10] as [number, number, number], rotation: 0 as const };
/** Every conduit and connector texture the scene asks for, one file each (`<pseudo id>.png`). */
const PARTS = ['item', 'liquid_ender', 'liquid_crystalline', 'other', 'connector_background', 'connector_extract', 'connector_insert',
  'connector_in_out_in', 'connector_in_out_out'];
const texture = (id: string): [string, BlockFaces] => [blockKey({ id, meta: 0 }), { block: { id, meta: 0 }, resolved: true, fallbackColor: [1, 2, 3],
  faces: Object.fromEntries(FACES.map((f) => [f, [{ path: `${id}.png` }]])) as BlockFaces['faces'] }];
const conduitTextures = new Map(PARTS.map((p) => texture(`conduit:${p}`)));
const CONNECTOR = 'conduit:connector_background.png';

/** An Electric Blast Furnace taking dust and Oxygen from raw: a riser from its input hatch down to a bundle on the spine. */
const ebfPlan = (): Plan => makePlan([{ id: 'e', mteId: IDS.EBF, count: 1, tier: 2, inputs: [['t:dust@0', 1], ['fluid:oxygen', 10]], outputs: [['t:ingot@0', 1]] }],
  { flows: [{ from: 'raw', to: 'e', key: 't:dust@0', perSecond: 1 }, { from: 'raw', to: 'e', key: 'fluid:oxygen', perSecond: 10 },
    { from: 'e', to: 'out', key: 't:ingot@0', perSecond: 1 }] });
/** 26 final items: a second output chest above the tail, on an Item Conduit joined to the tail cell. */
const manyOutputs = (): Plan => {
  const many = keysN(26);
  return makePlan([
    { id: 'a', mteId: IDS.MACERATOR, count: 1, outputs: many.slice(0, 13).map((k): [string, number] => [k, 1]) },
    { id: 'b', mteId: IDS.ASSEMBLER, count: 1, tier: 2, outputs: many.slice(13).map((k): [string, number] => [k, 1]) },
  ], { flows: [{ from: 'raw', to: 'a', key: 't:in@0', perSecond: 1 }, { from: 'raw', to: 'b', key: 't:in@0', perSecond: 1 },
    ...many.map((key, i) => ({ from: i < 13 ? 'a' : 'b', to: 'out', key, perSecond: 1 }))] });
};
/** A solidifier taking three fluids from outside the line: three open ends stacked above the tail cell. */
const threeFluids = (): Plan => makePlan([{ id: 'y', mteId: IDS.SOLIDIFIER, count: 1, inputs: [['fluid:a', 1], ['fluid:b', 1], ['fluid:c', 1]] }],
  { flows: [...['fluid:a', 'fluid:b', 'fluid:c'].map((key) => ({ from: 'raw', to: 'y', key, perSecond: 1 })), { from: 'y', to: 'out', key: 't:out_y@0', perSecond: 1 }] });

const LINES: ReadonlyArray<readonly [string, () => Plan, Pick<ScanSpec, 'logistics'>?]> = [
  ['two steps hooked up to an EnderIO network', twoStep, { logistics: [{ kind: 'enderio', taps: [[26, 64, 12]] }] }],
  ['a fluid line', () => fluidPlan()],
  ['a multiblock riser', ebfPlan],
  ['a stack of output chests', manyOutputs],
  ['three open fluid ends', threeFluids],
];

async function laid(plan: Plan, logistics: 'enderio' | 'direct' | 'routed' | 'ae2', scan: Pick<ScanSpec, 'logistics'> = {}): Promise<Layout> {
  return layoutLine(layoutPack(), plan, lineScan(scan), makeProject({ logistics, placement }), lineGround());
}

describe('the conduits of laid-out EnderIO lines in the 3D view', () => {
  for (const [name, plan, scan] of LINES) {
    it(`draws every link and set face of ${name}`, async () => {
      const layout = await laid(plan(), 'enderio', scan);
      expect(layout.blocks.some((b) => (b.conduits ?? []).length > 0)).toBe(true);
      expect(conduitGaps(layout, buildScene(layout, conduitTextures, new Map(), new Map()), CONNECTOR)).toEqual([]);
    });
  }

  it('draws the bundles on the spine side by side where both conduits go on, and in a connector box where they part', async () => {
    const layout = await laid(ebfPlan(), 'enderio');
    const scene = buildScene(layout, conduitTextures, new Map(), new Map());
    const bundles = layout.blocks.flatMap((b, i) => ((b.conduits ?? []).length > 1 ? [i] : []));
    expect(bundles.length).toBeGreaterThan(0);
    // a bundle cell either draws each conduit's one core beside the other's, or holds them in EnderIO's connector box
    for (const i of bundles) {
      const shapes = scene.instances.filter((x) => x.block === i);
      const hub = shapes.filter((x) => x.shape === 'hub');
      const cores = shapes.filter((x) => x.shape === 'core');
      expect([hub.length, cores.length], posKey(layout.blocks[i]!.pos)).toEqual(hub.length === 1 ? [1, 0] : [0, 2]);
    }
    expect(scene.instances.some((x) => x.shape === 'hub')).toBe(true);
  });
});

/** The links of `g` that carry a good, joined to the spans drawn for them. */
function spansByEdge(g: ConnGraph, spans: readonly ConnSpan[]): Map<string, ConnSpan[]> {
  const by = new Map(g.edges.map((e): [string, ConnSpan[]] => [e.id, []]));
  for (const s of spans) by.get(s.edge)!.push(s);
  return by;
}

describe('the Connections links of laid-out lines in the world', () => {
  it('draws every flow of an EnderIO line from each extract face to each insert face it reaches on its channel', async () => {
    const plan = twoStep();
    const layout = await laid(plan, 'enderio', { logistics: [{ kind: 'enderio', taps: [[26, 64, 12]] }] });
    const g = connectionsGraph(layout, plan, 'min');
    const spans = connectionSpans(layout, g);
    const by = spansByEdge(g, spans);
    const at = new Map(layout.blocks.map((b) => [posKey(b.pos), b]));
    const rows = new Map(g.nodes.flatMap((n) => n.faces.map((f) => [f.id, f])));
    for (const e of g.edges.filter((x) => x.via === 'item_conduit')) {
      const own = by.get(e.id)!;
      expect(own.length, e.id).toBeGreaterThan(0);
      for (const s of own) {
        // each end on the face of the block its conduit face points at, toward the conduit; extract and insert on one channel
        for (const end of [s.from, s.to]) {
          const conduit = at.get(posKey(step(end.cell, end.side)));
          expect(conduit?.conduits?.some((c) => c.faces.some((f) => f.face === FACES[OPPOSITE[end.side]!])), JSON.stringify(end)).toBe(true);
        }
        expect(rows.get(s.from.face!)!.mode!.extract).toBe(rows.get(s.to.face!)!.mode!.insert);
      }
    }
    // the two macerators each hand their dust to the assembler: one piece each, from their own faces
    const dust = by.get(g.edges.find((e) => e.from === 'step:s1' && e.to === 'step:s2')!.id)!;
    expect(new Set(dust.map((s) => s.from.face)).size).toBe(2);
    // the hookup joins the input chest from the conduit at its end
    const hookup = g.edges.find((e) => e.via === 'hookup')!;
    expect(by.get(hookup.id)!.length).toBe(1);
  });

  it('draws every link of a line in the other three modes between the blocks that stand for its boxes', async () => {
    // an AE2 line's raw inputs and final outputs are the base's ME network, which comes in at the hookup's end
    const networks: Readonly<Record<'direct' | 'routed' | 'ae2', Pick<ScanSpec, 'logistics'>>> = {
      direct: {}, routed: {}, ae2: { logistics: [{ kind: 'ae2', taps: [[26, 64, 12]] }] } };
    for (const mode of ['direct', 'routed', 'ae2'] as const) {
      const plan = twoStep();
      const layout = await laid(plan, mode, networks[mode]);
      const g = connectionsGraph(layout, plan, 'min');
      const by = spansByEdge(g, connectionSpans(layout, g));
      const missing = g.edges.filter((e) => e.via !== 'hookup' && by.get(e.id)!.length === 0).map((e) => e.id);
      expect(missing, mode).toEqual([]);
      // the flow from the two macerators to the assembler: a piece from each macerator's top to the assembler's
      const flow = by.get(g.edges.find((e) => e.from === 'step:s1' && e.to === 'step:s2')!.id)!;
      const machine = (cell: [number, number, number]) => layout.blocks.find((b) => posKey(b.pos) === posKey(cell))!;
      expect(flow.map((s) => [machine(s.from.cell).stepId, s.from.side, machine(s.to.cell).stepId, s.to.side]), mode)
        .toEqual([['s1', 1, 's2', 1], ['s1', 1, 's2', 1]]);
    }
  });
});
