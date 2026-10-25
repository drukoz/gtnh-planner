import { describe, expect, it } from 'vitest';
import type { StructureElementLine, StructureLine } from '../../../src/server/pack/format.ts';
import { machineByMteId } from '../../../src/server/pack/lookup.ts';
import { makePack } from '../../helpers/make-pack.ts';
import { SAMPLE, sampleExportSpec } from '../../helpers/sample-export.ts';

describe('machines', () => {
  it('converts kinds, tiers, maps and power stats', async () => {
    const pack = await makePack(sampleExportSpec());
    expect(machineByMteId(pack, SAMPLE.macerator)).toMatchObject({
      mteId: 50, metaName: 'basicmachine.macerator.tier.01', name: 'Basic Macerator', itemKey: 'gregtech:gt.blockmachines@50',
      kind: 'basic', tier: 1, voltage: 32, amps: 1, maps: ['gt.recipe.macerator'],
    });
    expect(machineByMteId(pack, SAMPLE.cable)!.cable).toEqual({ voltage: 32, amps: 1, lossPerBlock: 1, insulated: true, material: 'Tin' });
    expect(machineByMteId(pack, SAMPLE.turbine)).toMatchObject({ kind: 'turbine', turbineEfficiency: 0.428571 });
    expect(machineByMteId(pack, SAMPLE.ebf)).toMatchObject({ kind: 'multiblock', heatOC: true, maps: ['gt.recipe.blastfurnace'] });
  });

  it('computes pipe throughput per second', async () => {
    const pack = await makePack({
      machines: [
        { id: 5110, name: 'pipe.fluid.steel', cls: 'x', item: null, kind: 'fluid_pipe', fluidPipe: { capacityPerSecond: 1200, pipes: 1, maxTemp: 2557, gasProof: true, material: 'Steel' } },
        { id: 5602, name: 'pipe.item.tin', cls: 'x', item: null, kind: 'item_pipe', itemPipe: { slots: 2, tickTime: 10, stepSize: 32768, restrictive: false, material: 'Tin' } },
      ],
    });
    expect(machineByMteId(pack, 5110)!.fluidPipe).toEqual({ litresPerSecond: 1200, material: 'Steel' });
    expect(machineByMteId(pack, 5602)!.itemPipe).toEqual({ stacksPerSecond: 4, material: 'Tin' });
  });

  it('adds the assemblyline pseudo map and the crafting table and furnace pseudo machines', async () => {
    const pack = await makePack(sampleExportSpec());
    expect(machineByMteId(pack, SAMPLE.assemblyLine)!.maps).toEqual(['gt.recipe.fakeAssemblylineProcess', 'assemblyline']);
    expect(machineByMteId(pack, -1)).toMatchObject({ name: 'Crafting Table', itemKey: 'minecraft:crafting_table@0', maps: ['crafting'] });
    expect(pack.machinesByMap.get('crafting')).toEqual([-1]);
    expect(pack.machinesByMap.get('furnace')).toEqual([-2]);
    expect(pack.machinesByMap.get('assemblyline')).toEqual([SAMPLE.assemblyLine]);
  });

  it('attaches multiblock structures', async () => {
    const pack = await makePack(sampleExportSpec());
    const casing = { id: 'gregtech:gt.blockcasings', meta: 11 };
    expect(machineByMteId(pack, SAMPLE.ebf)!.structure).toEqual({
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
    expect(machineByMteId(pack, 1)!.metaName).toBe('m');
    expect(pack.warnings).toEqual([
      'machines.jsonl.gz:2: duplicate machine id 1 ignored, the first line wins',
      'structures.jsonl.gz:1: structure for unknown machine 9 ignored',
    ]);
    await expect(makePack({ machines, structures: [{ id: 1, size: [1, 1, 1], controller: [0, 0, 0], palette: [], blocks: [[0, 0, 0, 3]], air: [] }] }))
      .rejects.toMatchObject({ name: 'ExportFormatError', file: 'structures.jsonl.gz', line: 1 });
  });

  it('reads the item slot counts of a GT basic machine (exporter 0.6.0)', async () => {
    const pack = await makePack({
      machines: [
        { id: 302, name: 'basicmachine.macerator.tier.02', cls: 'x', item: null, kind: 'basic', tier: 2, itemInSlots: 1, itemOutSlots: 1 },
        { id: 211, name: 'basicmachine.assembler.tier.01', cls: 'x', item: null, kind: 'basic', tier: 1, itemInSlots: 6, itemOutSlots: 1 },
        { id: 212, name: 'basicmachine.assembler.tier.02', cls: 'x', item: null, kind: 'basic', tier: 2, itemInSlots: 9, itemOutSlots: 1 },
        { id: 4300, name: 'basicmachine.test_sorter.tier.01', cls: 'x', item: null, kind: 'basic', tier: 1, itemInSlots: 2, itemOutSlots: 0 },
      ],
    });
    expect(machineByMteId(pack, 302)).toMatchObject({ itemInSlots: 1, itemOutSlots: 1 });
    expect(machineByMteId(pack, 211)).toMatchObject({ itemInSlots: 6, itemOutSlots: 1 });
    expect(machineByMteId(pack, 212)).toMatchObject({ itemInSlots: 9, itemOutSlots: 1 });
    expect(machineByMteId(pack, 4300)).toMatchObject({ itemInSlots: 2, itemOutSlots: 0 });   // no output slot is still a count
    const macerator = machineByMteId(await makePack(sampleExportSpec()), SAMPLE.macerator)!;
    expect('itemInSlots' in macerator).toBe(false);
    expect('itemOutSlots' in macerator).toBe(false);
  });
});

describe('structure hatch rules', () => {
  const casing = { id: 'gregtech:gt.blockcasings', meta: 11 };
  const ctrl = { id: 'gregtech:gt.blockmachines', meta: 0, mte: 1000 };
  const machines = [{ id: 1000, name: 'multimachine.blastfurnace', cls: 'x', item: null, kind: 'multiblock' as const }];
  /** Casings at (0, 0, 0), (2, 0, 0) and (1, 1, 0) around the controller, block 1 at (1, 0, 0). */
  const line: StructureLine = {
    id: 1000, size: [3, 2, 1], controller: [1, 0, 0], palette: [casing, ctrl], blocks: [[0, 0, 0, 0], [1, 0, 0, 1], [2, 0, 0, 0], [1, 1, 0, 0]], air: [],
  };
  const load = async (structure: StructureLine) => {
    const pack = await makePack({ machines, structures: [structure] });
    return { pack, structure: machineByMteId(pack, 1000)!.structure! };
  };

  it('reads the hatch rules of a structure (exporter 0.6.0)', async () => {
    const { pack, structure } = await load({ ...line, elements: [{ ch: 'b', hatches: ['input_bus', 'energy'] }, { ch: 'f', hatches: [] }], elementOf: [0, -1, 0, 1] });
    expect(structure.elements).toEqual([
      { ch: 'b', hatches: ['input_bus', 'energy'], cells: [[0, 0, 0], [2, 0, 0]] },
      { ch: 'f', hatches: [], cells: [[1, 1, 0]] },
    ]);
    expect(pack.warnings).toEqual([]);
  });

  it('keeps an element without a character and a structure without rules as they were', async () => {
    const { structure } = await load({ ...line, elements: [{ hatches: ['muffler'] }], elementOf: [0, -1, -1, -1] });
    expect(structure.elements).toEqual([{ hatches: ['muffler'], cells: [[0, 0, 0]] }]);
    expect('ch' in structure.elements![0]!).toBe(false);
    const ebf = machineByMteId(await makePack(sampleExportSpec()), SAMPLE.ebf)!.structure!;
    expect('elements' in ebf).toBe(false);
  });

  it('ignores hatch kinds it does not know, with one warning', async () => {
    const { pack, structure } = await load({
      ...line,
      elements: [{ ch: 'b', hatches: ['input_bus', 'quantum_hatch', 'flux_hatch'] }, { ch: 'm', hatches: ['quantum_hatch', 'muffler'] }],
      elementOf: [0, -1, 0, 1],
    });
    expect(structure.elements?.map((e) => e.hatches)).toEqual([['input_bus'], ['muffler']]);
    // one warning for the line, each kind named once in first-seen order (ruling R10)
    expect(pack.warnings).toEqual(['structures.jsonl.gz:1: structure 1000: hatch kinds unknown to this planner ignored: quantum_hatch, flux_hatch']);
  });

  const elements: StructureElementLine[] = [{ ch: 'b', hatches: ['input_bus', 'energy'] }, { ch: 'f', hatches: [] }];
  it.each<[string, StructureLine]>([
    ['three values for four blocks', { ...line, elements, elementOf: [0, -1, 0] }],
    ['five values for four blocks', { ...line, elements, elementOf: [0, -1, 0, 1, 0] }],
    ['element 2 of two', { ...line, elements, elementOf: [0, -1, 0, 2] }],
    ['a value below -1', { ...line, elements, elementOf: [0, -1, 0, -2] }],
    ['a value that is no integer', { ...line, elements, elementOf: [0, -1, 0, 0.5] }],
    ['elements without elementOf', { ...line, elements }],
    ['elementOf without elements', { ...line, elementOf: [0, -1, 0, 1] }],
    ['the controller in an element', { ...line, elements, elementOf: [0, 0, 0, 1] }],
  ])('rejects hatch rules that do not fit the blocks: %s', async (_why, structure) => {
    // a RangeError of the converter's own checks, not a TypeError from indexing past them
    await expect(makePack({ machines, structures: [structure] })).rejects
      .toMatchObject({ name: 'ExportFormatError', file: 'structures.jsonl.gz', line: 1, cause: expect.any(RangeError) });
  });
});
