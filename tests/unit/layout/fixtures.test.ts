import { describe, it, expect } from 'vitest';
import { layoutPack, IDS, EBF_STRUCTURE, makePlan, makeScan, flatVoxels, areaReader, STONE, addLineParts, emptyPack } from '../../helpers/layout-fixtures.ts';
import { withLineParts } from '../../helpers/line-parts-export.ts';
import { makePack } from '../../helpers/make-pack.ts';
import type { Machine } from '../../../src/shared/types/pack.ts';
import { AIR_INDEX, UNKNOWN_INDEX } from '../../../src/shared/types/world.ts';
import { allMachines, machineByMteId } from '../../../src/server/pack/lookup.ts';

/** The machine fields the line-parts export must load back exactly (ruling R19). */
const LOADED_FIELDS = ['mteId', 'metaName', 'name', 'cls', 'kind', 'itemKey', 'tier', 'cable', 'fluidPipe', 'itemPipe', 'steamPerSecondMax'] as const;

describe('layout fixtures', () => {
  it('builds a pack with line parts', () => {
    const pack = layoutPack();
    expect(machineByMteId(pack, IDS.TIN_2X)!.cable).toEqual({ voltage: 32, amps: 2, lossPerBlock: 1, insulated: true, material: 'Tin' });
    expect(machineByMteId(pack, IDS.EBF)!.structure!.blocks).toHaveLength(34);
    expect(EBF_STRUCTURE.air).toEqual([[1, 1, 1], [1, 2, 1]]);
    expect(pack.nameOf('gregtech:gt.metaitem.01@32630')).toBe('Conveyor Module (LV)');
  });

  it('chains plan steps with flows and sums power', () => {
    const plan = makePlan([{ id: 's1', mteId: IDS.MACERATOR, count: 2 }, { id: 's2', mteId: IDS.ASSEMBLER, count: 1, tier: 2, euPerTick: 120 }]);
    expect(plan.flows.map((f) => `${f.from}>${f.to}`)).toEqual(['raw>s1', 's1>s2', 's2>out']);
    expect(plan.power.peakEUt).toBe(180);
    expect(makeScan({ power: [{ voltageTier: 1, average: 50, taps: [{ pos: [0, 64, 0], freeAmps: 2 }] }] }).power[0]!.taps[0]!.voltageTier).toBe(1);
  });

  it('indexes voxels as (y·sz + z)·sx + x and answers unknown outside', async () => {
    const vox = flatVoxels({ origin: [0, 60, 0], size: [4, 8, 4], groundY: 63 });
    expect(vox.palette[vox.blocks[((63 - 60) * 4 + 2) * 4 + 1]!]).toEqual(STONE);
    expect(vox.blocks[((64 - 60) * 4 + 0) * 4 + 0]).toBe(AIR_INDEX);
    const part = await areaReader(vox)(0, { minX: 2, minY: 62, minZ: 2, maxX: 5, maxY: 64, maxZ: 3 });
    expect(part.size).toEqual([4, 3, 2]);
    expect(part.blocks[(0 * 2 + 0) * 4 + 3]).toBe(UNKNOWN_INDEX);
  });

  it('writes the line parts as export rows that load back to the fixture values', async () => {
    const want = addLineParts(emptyPack());
    const pack = await makePack(withLineParts({}));
    expect(pack.warnings ?? []).toEqual([]);
    expect(want.machines.size).toBe(31);
    // toEqual takes an undefined field as missing: a field the fixture leaves out must be missing after loading too
    const fields = (m: Machine | undefined) => Object.fromEntries(LOADED_FIELDS.map((f) => [f, m?.[f]]));
    for (const m of allMachines(want)) expect(fields(machineByMteId(pack, m.mteId)), `machine ${m.mteId}`).toEqual(fields(m));
    for (const [key, item] of want.items) expect(pack.items.get(key)?.name, key).toBe(item.name);
  });
});
