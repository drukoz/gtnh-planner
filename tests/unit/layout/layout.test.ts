import { describe, it, expect } from 'vitest';
import { layoutLine, emptyScan } from '../../../src/server/layout/layout.ts';
import { overlaps } from '../../../src/server/layout/arrange.ts';
import { ae2IdleEUt, resolveParts } from '../../../src/server/layout/parts.ts';
import { layoutPack, makePlan, makeProject, makeScan, flatVoxels, areaReader, IDS, STONE } from '../../helpers/layout-fixtures.ts';

const twoStep = () => makePlan([
  { id: 's1', mteId: IDS.MACERATOR, count: 2, euPerTick: 30 },
  { id: 's2', mteId: IDS.ASSEMBLER, count: 1, tier: 2, euPerTick: 120 },
]);
const scan = () => makeScan({
  base: { center: [20, 64, 20], bbox: { minX: 16, minY: 64, minZ: 16, maxX: 24, maxY: 65, maxZ: 24 } },
  machines: [{ pos: [18, 64, 18], mteId: IDS.MACERATOR }],
  power: [{ voltageTier: 2, average: 1000, loadEUt: 100, storedEU: 10_000_000, taps: [{ pos: [16, 64, 30], freeAmps: 8 }] }],
});
const GT = (mteId: number) => ({ id: 'gregtech:gt.blockmachines', meta: 0, mteId });
const ground = (boxes: Parameters<typeof flatVoxels>[0]['boxes'] = []) => ({ readArea: areaReader(flatVoxels({
  origin: [-20, 50, -20], size: [90, 30, 90], groundY: 63,
  boxes: [{ from: [18, 64, 18], to: [18, 64, 18], block: GT(IDS.MACERATOR) }, { from: [16, 64, 30], to: [16, 64, 30], block: GT(IDS.ANNEALED_1X) }, ...(boxes ?? [])],
})) });

describe('layoutLine', () => {
  it('lays out a two-step line next to the base, wired from the tap through a transformer', async () => {
    const layout = await layoutLine(layoutPack(), twoStep(), scan(), makeProject({ logistics: 'direct' }), ground());
    expect([layout.status, layout.mode, layout.dim]).toEqual(['ok', 'direct', 0]);
    expect(layout.blocks.filter((b) => b.role === 'machine').map((b) => b.block.mteId).sort()).toEqual([IDS.MACERATOR, IDS.MACERATOR, IDS.ASSEMBLER]);
    expect(layout.blocks.filter((b) => b.role === 'transformer').map((b) => b.block.mteId)).toEqual([IDS.TRANSFORMER_LV]);
    expect(layout.hookups.map((h) => [h.kind, h.from.pos, h.found])).toEqual([['power', [16, 64, 30], true]]);
    expect(layout.blocks.filter((b) => b.role === 'ghost').map((b) => [b.pos, b.label])).toEqual([[[16, 64, 30], 'existing 1x Annealed Copper Cable']]);
    expect(layout.pins.map((p) => [p.n, p.kind])).toEqual([[1, 'site'], [2, 'power']]);
    expect(layout.power!.fits).toBe('yes');
    expect(layout.buildSteps.map((s) => s.id)).toEqual(expect.arrayContaining(['layout:site', 'layout:power:stage:1', 'layout:power:hookup', 'layout:configure:s1']));
    expect(layout.bom).toContainEqual({ key: 'gregtech:gt.blockmachines@21', amount: 1, why: 'transformers', group: 'power' });
    expect(layout.bom.find((l) => l.key === 'gregtech:gt.metaitem.01@32630')).toMatchObject({ amount: 4, group: 'logistics' });
    expect(layout.bom.every((l) => l.group !== undefined)).toBe(true);
    expect(layout.blocks.some((b) => b.role === 'cover')).toBe(false);
    expect(layout.blocks.filter((b) => b.role === 'machine').every((b) => b.covers?.length === 1 && b.config?.inputFilter === true)).toBe(true);
    expect(overlaps(layout.blocks.filter((b) => b.role !== 'ghost'))).toEqual([]);
    const inside = (p: number[]) => p.every((v, i) => v >= layout.origin[i]! && v < layout.origin[i]! + layout.size[i]!);
    expect(layout.blocks.filter((b) => b.hookup === undefined && b.role !== 'ghost').every((b) => inside(b.pos))).toBe(true);
    expect(layout.blocks.some((b) => b.pos.join() === '18,64,18')).toBe(false);
    // ruling R7 (architecture §11.23): every placed block names the build step that places it
    const stepIds = new Set(layout.buildSteps.map((s) => s.id));
    expect(layout.blocks.filter((b) => b.role !== 'ghost').every((b) => b.buildStep !== undefined && stepIds.has(b.buildStep))).toBe(true);
    const again = await layoutLine(layoutPack(), twoStep(), scan(), makeProject({ logistics: 'direct' }), ground());
    expect(JSON.stringify(again)).toBe(JSON.stringify(layout));
  });

  it('lays out without a scan so the 3D view and parts still work', async () => {
    const layout = await layoutLine(layoutPack(), twoStep(), emptyScan(), makeProject({ scanId: null, baseId: null }));
    expect([layout.status, layout.origin, layout.hookups, layout.pins]).toEqual(['no-world', [0, 64, 0], [], []]);
    expect(layout.warnings).toEqual([{ code: 'no_scan', text: 'Pick a world scan and base on the Map tab to place the line' }]);
    expect(layout.blocks.filter((b) => b.role === 'machine')).toHaveLength(3);
    expect(layout.buildSteps.every((s) => s.pin === undefined)).toBe(true);
  });

  it('honours a dragged placement and says what is in the way', async () => {
    const project = makeProject({ placement: { origin: [30, 64, 30], rotation: 90 } });
    const layout = await layoutLine(layoutPack(), twoStep(), scan(), project, ground([{ from: [30, 64, 30], to: [30, 64, 30], block: STONE }]));
    expect([layout.origin, layout.rotation]).toEqual([[30, 64, 30], 90]);
    expect(layout.warnings).toContainEqual({ code: 'placement_blocked', text: '1 block is in the way at the chosen spot' });
  });

  it('pins machines the group already owns instead of placing new ones', async () => {
    const plan = makePlan([{ id: 's1', mteId: IDS.MACERATOR, count: 1, owned: 1 }, { id: 's2', mteId: IDS.ASSEMBLER, count: 1, tier: 2, euPerTick: 120 }]);
    const layout = await layoutLine(layoutPack(), plan, scan(), makeProject(), ground());
    expect(layout.blocks.filter((b) => b.role === 'machine').map((b) => b.block.mteId)).toEqual([IDS.ASSEMBLER]);
    expect(layout.pins.find((p) => p.kind === 'reuse')).toMatchObject({ pos: [18, 64, 18], text: 'Reuse your 1× Basic Macerator' });
    expect(layout.buildSteps.map((s) => s.id)).toContain('layout:reuse:s1');
  });

  it('never assumes AE2 the base does not have', async () => {
    const layout = await layoutLine(layoutPack(), twoStep(), scan(), makeProject({ logistics: 'ae2' }), ground());
    expect(layout.warnings.map((w) => w.code)).toContain('ae2_missing');
    expect(layout.pins.at(-1)!.kind).toBe('warning');
    expect(layout.hookups.map((h) => h.kind)).toEqual(['power']);
  });

  it("AE2 mode adds the ME parts' idle draw to the line's power need", async () => {
    const pack = layoutPack();
    const ae2 = await layoutLine(pack, twoStep(), scan(), makeProject({ logistics: 'ae2' }), ground());
    const idle = ae2IdleEUt(ae2.blocks, resolveParts(pack));
    expect(idle).toBe(1.5);                                  // three ME interfaces at 1 AE/t, glass cable 0 AE/t, 2 AE per EU
    expect([ae2.power!.averageEUt, ae2.power!.peakEUt]).toEqual([twoStep().power.averageEUt + idle, twoStep().power.peakEUt + idle]);
    expect(ae2.power!.detail).toContain('; AE2 parts idle: 1.5 EU/t');
    const direct = await layoutLine(pack, twoStep(), scan(), makeProject({ logistics: 'direct' }), ground());
    expect([direct.power!.averageEUt, direct.power!.detail]).toEqual([twoStep().power.averageEUt, expect.not.stringContaining('AE2')]);
  });

  it('returns an empty layout for a plan with nothing to build', async () => {
    const layout = await layoutLine(layoutPack(), makePlan([], { status: 'empty' }), scan(), makeProject(), ground());
    expect([layout.status, layout.blocks, layout.pins, layout.buildSteps]).toEqual(['empty', [], [], []]);
  });
});
