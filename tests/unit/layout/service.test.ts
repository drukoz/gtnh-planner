import { describe, it, expect } from 'vitest';
import { createLayoutService, LAYOUT_CACHE_SIZE, layoutKey, type LayoutServiceDeps } from '../../../src/server/layout/service.ts';
import { layoutLine } from '../../../src/server/layout/layout.ts';
import type { Project } from '../../../src/shared/types/project.ts';
import { layoutPack, makePlan, makeProject, makeScan, flatVoxels, areaReader, IDS } from '../../helpers/layout-fixtures.ts';

const twoStep = () => makePlan([{ id: 's1', mteId: IDS.MACERATOR, count: 2 }, { id: 's2', mteId: IDS.ASSEMBLER, count: 1, tier: 2, euPerTick: 120 }]);
const vox = flatVoxels({ origin: [-40, 50, -40], size: [100, 30, 100], groundY: 63 });
const deps = (over: Partial<LayoutServiceDeps> = {}): LayoutServiceDeps => ({
  pack: async () => layoutPack(), plan: async () => twoStep(),
  scan: async () => makeScan({ power: [{ voltageTier: 2, average: 1000, loadEUt: 0, taps: [{ pos: [0, 64, 30], freeAmps: 8 }] }] }),
  readArea: (_id, dim, bbox) => areaReader(vox)(dim, bbox), expand: async (_pack, lines) => ({ lines, totals: [] }), ...over });

describe('layout service', () => {
  it('caches by plan, scan, base and placement and shares concurrent work', async () => {
    const svc = createLayoutService(deps());
    const p = makeProject();
    const [a, b] = await Promise.all([svc.layoutFor(p), svc.layoutFor(p)]);
    expect(a).toBe(b);
    expect(svc.computations).toBe(1);
    await svc.layoutFor(p);
    expect(svc.computations).toBe(1);
    await svc.layoutFor({ ...p, placement: { origin: [30, 64, 30], rotation: 0 } });
    expect(svc.computations).toBe(2);
    expect(layoutKey(twoStep(), p)).toBe('E1|S1|0:0:0|h1|-');
    expect(layoutKey(twoStep(), { ...p, placement: { origin: [1, 2, 3], rotation: 90 } })).toBe('E1|S1|0:0:0|h1|1,2,3@90');
  });

  it('finishes a plan with the layout power fit, parts and steps', async () => {
    const svc = createLayoutService(deps());
    const done = await svc.finishPlan(twoStep(), makeProject());
    expect(done.power.fits).toBe('yes');
    expect(done.buildSteps.map((s) => s.id)).toContain('layout:site');
    expect(done.buildList.map((l) => l.key)).toContain('gregtech:gt.blockmachines@21');
    const empty = makePlan([], { status: 'empty' });
    expect(await svc.finishPlan(empty, makeProject())).toBe(empty);
  });

  it('does not cache a failed layout', async () => {
    let fail = true;
    const svc = createLayoutService(deps({ layout: async (...args) => { if (fail) throw new Error('boom'); return layoutLine(...args); } }));
    await expect(svc.layoutFor(makeProject())).rejects.toThrow('boom');
    fail = false;
    await expect(svc.layoutFor(makeProject())).resolves.toMatchObject({ status: 'ok' });
  });

  // Rules of the brief its tests above leave out.

  it(`keeps the ${LAYOUT_CACHE_SIZE} layouts used last`, async () => {
    const svc = createLayoutService(deps());
    const at = (x: number): Project => ({ ...makeProject(), placement: { origin: [x, 64, 30], rotation: 0 } });
    for (let x = 0; x < LAYOUT_CACHE_SIZE; x++) await svc.layoutFor(at(x));
    await svc.layoutFor(at(0));
    await svc.layoutFor(at(LAYOUT_CACHE_SIZE));
    expect(svc.computations).toBe(LAYOUT_CACHE_SIZE + 1);
    await svc.layoutFor(at(0));
    expect(svc.computations).toBe(LAYOUT_CACHE_SIZE + 1);
    await svc.layoutFor(at(1));
    expect(svc.computations).toBe(LAYOUT_CACHE_SIZE + 2);
  });

  it('breaks the parts down once per layout, leaving the generator suggestions out', async () => {
    const asked: string[][] = [];
    const totals = [{ key: 't:in@0', amount: 1, why: 'base material' }];
    const svc = createLayoutService(deps({
      scan: async () => makeScan({ power: [{ voltageTier: 2, average: 10, loadEUt: 0, taps: [{ pos: [0, 64, 30], freeAmps: 8 }] }] }),
      expand: async (_pack, lines) => { asked.push(lines.map((l) => l.why)); return { lines, totals }; },
    }));
    const suggested = (await svc.layoutFor(makeProject())).bom.filter((l) => l.why.startsWith('optional:')).map((l) => l.key);
    expect(suggested.length).toBeGreaterThan(0);
    const done = await svc.finishPlan(twoStep(), makeProject());
    await svc.finishPlan(twoStep(), makeProject());
    expect(asked).toHaveLength(1);
    expect(asked[0]!.filter((why) => why.startsWith('optional:'))).toEqual([]);
    expect(done.power.fits).toBe('no');
    expect(done.buildList.map((l) => l.key)).toEqual(expect.arrayContaining(suggested));
    expect(done.buildTotals).toEqual(totals);
  });

  it('keeps what each build line needs of every total it merges (architecture §11.36)', async () => {
    const plan = { ...twoStep(), buildTotals: [
      { key: 't:iron@0', amount: 6, why: 'for Basic Macerator, Basic Assembler', neededFor: [{ key: 'gregtech:gt.blockmachines@2001', amount: 4 }, { key: 'gregtech:gt.blockmachines@2002', amount: 2 }] },
      { key: 't:tin@0', amount: 1, why: 'for Basic Assembler', neededFor: [{ key: 'gregtech:gt.blockmachines@2002', amount: 1 }] }] };
    const svc = createLayoutService(deps({
      plan: async () => plan,
      expand: async (_pack, lines) => ({ lines, totals: [
        { key: 't:copper@0', amount: 2, why: 'for 1x Copper Cable', neededFor: [{ key: 'gregtech:gt.blockmachines@1366', amount: 2 }] },
        { key: 't:tin@0', amount: 5, why: 'for 2x Tin Cable, 1x Tin Cable', neededFor: [{ key: 'gregtech:gt.blockmachines@1247', amount: 3 }, { key: 'gregtech:gt.blockmachines@1246', amount: 2 }] }] }),
    }));
    const done = await svc.finishPlan(plan, makeProject());
    expect(done.buildTotals).toEqual([
      { key: 't:copper@0', amount: 2, why: 'for 1x Copper Cable', neededFor: [{ key: 'gregtech:gt.blockmachines@1366', amount: 2 }] },
      { key: 't:iron@0', amount: 6, why: 'for Basic Macerator, Basic Assembler', neededFor: [{ key: 'gregtech:gt.blockmachines@2001', amount: 4 }, { key: 'gregtech:gt.blockmachines@2002', amount: 2 }] },
      { key: 't:tin@0', amount: 6, why: 'for Basic Assembler; for 2x Tin Cable, 1x Tin Cable', neededFor: [
        { key: 'gregtech:gt.blockmachines@2002', amount: 1 }, { key: 'gregtech:gt.blockmachines@1247', amount: 3 }, { key: 'gregtech:gt.blockmachines@1246', amount: 2 }] }]);
    for (const total of done.buildTotals!) expect(total.neededFor!.reduce((sum, n) => sum + n.amount, 0)).toBe(total.amount);
  });

  it('prices the layout parts of a finished plan', async () => {
    // plan 12 Task 6: `cost.layout` is the layout's required parts other than its hatches (each new multiblock's build
    // already holds its hatch set less the casings it stands on); without the dep a finished plan gets none
    const recorded: string[][] = [];
    const plan = { ...makePlan([{ id: 's1', mteId: IDS.MACERATOR, count: 2 }, { id: 'e', mteId: IDS.EBF, count: 1, tier: 2, euPerTick: 120,
      inputs: [['t:dust@0', 1]], outputs: [['t:ingot@0', 1]] }]), cost: { runPerHour: 1, build: 10, horizonHours: 24 } };
    const svc = createLayoutService(deps({ plan: async () => plan, layoutCost: async (_pack, lines) => { recorded.push(lines.map((l) => l.key)); return 7; } }));
    const done = await svc.finishPlan(plan, makeProject());
    expect(done.cost).toEqual({ runPerHour: 1, build: 10, horizonHours: 24, layout: 7 });
    const layout = await svc.layoutFor(makeProject());
    const hatches = layout.bom.filter((l) => l.group === 'machines' && l.why.includes('hatches')).map((l) => l.key);
    expect(hatches.length).toBeGreaterThan(0);
    expect(recorded).toEqual([layout.bom.filter((l) => !l.why.startsWith('optional:') && !hatches.includes(l.key)).map((l) => l.key)]);
    const unpriced = await createLayoutService(deps({ plan: async () => plan })).finishPlan(plan, makeProject());
    expect(unpriced.cost).toEqual({ runPerHour: 1, build: 10, horizonHours: 24 });
  });

  it('does not keep a failed parts breakdown', async () => {
    let fail = true;
    const svc = createLayoutService(deps({ expand: async (_pack, lines) => { if (fail) throw new Error('no prices'); return { lines, totals: [] }; } }));
    await expect(svc.finishPlan(twoStep(), makeProject())).rejects.toThrow('no prices');
    fail = false;
    await expect(svc.finishPlan(twoStep(), makeProject())).resolves.toMatchObject({ power: { fits: 'yes' } });
    expect(svc.computations).toBe(1);
  });

  it('lays a plan out again when what it read changed', async () => {
    // add-on 17 Task 6: the hash of what the plan read of other projects' summaries comes before the placement
    const p = makeProject();
    expect(layoutKey({ ...twoStep(), crossHash: 'abc' }, p)).toBe('E1|S1|0:0:0|h1|x:abc|-');
    expect(layoutKey(twoStep(), p)).toBe('E1|S1|0:0:0|h1|-');
    // what Q's plan does once it takes y from P: the same settings hash, and its step that made y gone
    const taken = { ...makePlan([{ id: 's1', mteId: IDS.MACERATOR, count: 2 }]), crossHash: 'abc' };
    let calls = 0;
    const svc = createLayoutService(deps({ plan: async () => (calls++ === 0 ? twoStep() : taken) }));
    const first = await svc.layoutFor(p);
    expect(first.blocks.some((b) => b.stepId === 's2')).toBe(true);
    const again = await svc.layoutFor(p);
    expect(svc.computations).toBe(2);
    expect(again.blocks.some((b) => b.stepId === 's2')).toBe(false);
  });

  it('lays out on an empty scan until the scan is done, and reads terrain only for a scan id', async () => {
    const reads: boolean[] = [];
    const svc = createLayoutService(deps({
      scan: async () => null, layout: async (...args) => { reads.push(args[4]?.readArea !== undefined); return layoutLine(...args); },
    }));
    // the warning that says what to pick comes first; the line's own wiring warnings follow it
    const noBase = await svc.layoutFor(makeProject());
    expect([noBase.status, noBase.warnings[0]?.code]).toEqual(['no-world', 'no_base']);
    const noScan = await svc.layoutFor(makeProject({ scanId: null, baseId: null }));
    expect([noScan.status, noScan.warnings[0]?.code]).toEqual(['no-world', 'no_scan']);
    expect(reads).toEqual([true, false]);
  });
});
