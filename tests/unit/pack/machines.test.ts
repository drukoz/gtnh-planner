import { describe, expect, it } from 'vitest';
import { makePack } from '../../helpers/make-pack.ts';
import { SAMPLE, sampleExportSpec } from '../../helpers/sample-export.ts';

describe('machines', () => {
  it('converts kinds, tiers, maps and power stats', async () => {
    const pack = await makePack(sampleExportSpec());
    expect(pack.machines.get(SAMPLE.macerator)).toMatchObject({
      mteId: 50, metaName: 'basicmachine.macerator.tier.01', name: 'Basic Macerator', itemKey: 'gregtech:gt.blockmachines@50',
      kind: 'basic', tier: 1, voltage: 32, amps: 1, maps: ['gt.recipe.macerator'],
    });
    expect(pack.machines.get(SAMPLE.cable)!.cable).toEqual({ voltage: 32, amps: 1, lossPerBlock: 1, insulated: true, material: 'Tin' });
    expect(pack.machines.get(SAMPLE.turbine)).toMatchObject({ kind: 'turbine', turbineEfficiency: 0.428571 });
    expect(pack.machines.get(SAMPLE.ebf)).toMatchObject({ kind: 'multiblock', heatOC: true, maps: ['gt.recipe.blastfurnace'] });
  });

  it('computes pipe throughput per second', async () => {
    const pack = await makePack({
      machines: [
        { id: 5110, name: 'pipe.fluid.steel', cls: 'x', item: null, kind: 'fluid_pipe', fluidPipe: { capacityPerSecond: 1200, pipes: 1, maxTemp: 2557, gasProof: true, material: 'Steel' } },
        { id: 5602, name: 'pipe.item.tin', cls: 'x', item: null, kind: 'item_pipe', itemPipe: { slots: 2, tickTime: 10, stepSize: 32768, restrictive: false, material: 'Tin' } },
      ],
    });
    expect(pack.machines.get(5110)!.fluidPipe).toEqual({ litresPerSecond: 1200, material: 'Steel' });
    expect(pack.machines.get(5602)!.itemPipe).toEqual({ stacksPerSecond: 4, material: 'Tin' });
  });

  it('adds the assemblyline pseudo map and the crafting table and furnace pseudo machines', async () => {
    const pack = await makePack(sampleExportSpec());
    expect(pack.machines.get(SAMPLE.assemblyLine)!.maps).toEqual(['gt.recipe.fakeAssemblylineProcess', 'assemblyline']);
    expect(pack.machines.get(-1)).toMatchObject({ name: 'Crafting Table', itemKey: 'minecraft:crafting_table@0', maps: ['crafting'] });
    expect(pack.machinesByMap.get('crafting')).toEqual([-1]);
    expect(pack.machinesByMap.get('furnace')).toEqual([-2]);
    expect(pack.machinesByMap.get('assemblyline')).toEqual([SAMPLE.assemblyLine]);
  });

  it('attaches multiblock structures', async () => {
    const pack = await makePack(sampleExportSpec());
    const casing = { id: 'gregtech:gt.blockcasings', meta: 11 };
    expect(pack.machines.get(SAMPLE.ebf)!.structure).toEqual({
      size: [3, 4, 3], controller: [1, 0, 0], air: [],
      blocks: [
        { pos: [0, 0, 0], block: casing },
        { pos: [1, 0, 0], block: { id: 'gregtech:gt.blockmachines', meta: 0, mteId: 1000 } },
        { pos: [2, 0, 0], block: casing },
      ],
    });
  });

  it('warns about unreadable maps and truncated structures, and orders machines by tier', async () => {
    const pack = await makePack({
      recipeMaps: [{ id: 'gt.recipe.macerator', amps: 1 }],
      machines: [
        { id: 52, name: 'm3', cls: 'x', item: null, kind: 'basic', tier: 3, maps: ['gt.recipe.macerator'] },
        { id: 50, name: 'm1', cls: 'x', item: null, kind: 'basic', tier: 1, maps: ['gt.recipe.macerator'] },
        { id: 51, name: 'm2', cls: 'x', item: null, kind: 'basic', tier: 2, maps: ['gt.recipe.macerator'] },
        { id: 77, name: 'odd', cls: 'x', item: null, kind: 'multiblock', mapsError: 'java.lang.NullPointerException' },
      ],
      structures: [{ id: 77, size: [1, 1, 1], controller: [0, 0, 0], palette: [], blocks: [], air: [], truncated: true }],
    });
    expect(pack.machinesByMap.get('gt.recipe.macerator')).toEqual([50, 51, 52]);
    expect(pack.warnings!.some((w) => w.startsWith('machine 77 (odd)'))).toBe(true);
    expect(pack.warnings!.some((w) => w.includes('77') && w.includes('truncated'))).toBe(true);
  });

  it('warns about a duplicate machine id and a structure for an unknown machine, and rejects a block outside the palette', async () => {
    const machines = [{ id: 1, name: 'm', cls: 'x', item: null, kind: 'multiblock' as const }];
    const pack = await makePack({
      machines: [...machines, { ...machines[0]!, name: 'copy' }],
      structures: [{ id: 9, size: [1, 1, 1], controller: [0, 0, 0], palette: [], blocks: [], air: [] }],
    });
    expect(pack.machines.get(1)!.metaName).toBe('m');
    expect(pack.warnings).toEqual([
      'machines.jsonl.gz:2: duplicate machine id 1 ignored, the first line wins',
      'structures.jsonl.gz:1: structure for unknown machine 9 ignored',
    ]);
    await expect(makePack({ machines, structures: [{ id: 1, size: [1, 1, 1], controller: [0, 0, 0], palette: [], blocks: [[0, 0, 0, 3]], air: [] }] }))
      .rejects.toMatchObject({ name: 'ExportFormatError', file: 'structures.jsonl.gz', line: 1 });
  });
});
