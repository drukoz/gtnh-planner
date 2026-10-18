import { mkdtemp, stat, truncate } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { itemKey } from '../../../src/shared/keys.ts';
import { EXPORT_FILES } from '../../../src/server/pack/format.ts';
import { loadPack, specialValueKind } from '../../../src/server/pack/load.ts';
import { nbtHash } from '../../../src/server/pack/recipe-id.ts';
import { makeExport } from '../../helpers/make-export.ts';
import { makePack } from '../../helpers/make-pack.ts';
import { SAMPLE, sampleExportSpec } from '../../helpers/sample-export.ts';

const tmp = () => mkdtemp(join(tmpdir(), 'gp-load-'));

describe('items, fluids and ore dictionary', () => {
  it('loads items with keys, names, ore names and GT data', async () => {
    const pack = await makePack(sampleExportSpec());
    expect(pack.items.get(SAMPLE.ironDust)).toEqual({
      key: SAMPLE.ironDust, id: 'gregtech:gt.metaitem.01', meta: 2032, name: 'Iron Dust',
      oreDict: ['dustIron'], gt: { prefix: 'dust', material: 'Iron', amount: 3628800 },
    });
  });

  it('falls back to the unlocalized name, then the key, and nameOf never returns an empty string', async () => {
    const pack = await makePack({ ...sampleExportSpec(), items: [...sampleExportSpec().items!, { id: 'examplemod:blank', m: 3, dn: '', un: '' }] });
    expect(pack.items.get('examplemod:broken@0')!.name).toBe('item.broken');
    expect(pack.items.get('examplemod:blank@3')!.name).toBe('examplemod:blank@3');
    expect(pack.fluids.get('fluid:mystery')!.name).toBe('fluid.mystery');
    expect(pack.nameOf('nope:thing@1')).toBe('nope:thing@1');
    expect(pack.nameOf(SAMPLE.oxygen)).toBe('Oxygen');
  });

  it('keys NBT variants by a 12-hex hash and keeps the SNBT', async () => {
    const pack = await makePack(sampleExportSpec());
    const key = itemKey('minecraft:written_book', 0, nbtHash('{title:"Data"}'));
    expect(pack.items.get(key)).toMatchObject({ name: 'Written Book', nbt: '{title:"Data"}' });
  });

  it('expands wildcard meta into the known variants and never keys 32767', async () => {
    const pack = await makePack(sampleExportSpec());
    expect(pack.oreDict.get('plankWood')).toEqual([SAMPLE.oakPlanks, SAMPLE.sprucePlanks]);
    expect([...pack.items.keys()].some((k) => k.includes('@32767'))).toBe(false);
  });

  it('falls back to meta 0 for a wildcard without variants and warns once per id', async () => {
    const pack = await makePack({
      items: [{ id: 'minecraft:wool', m: 32767 }],
      oreDict: [{ ore: 'blockWool', items: [0] }, { ore: 'wool', items: [0] }],
    });
    expect(pack.oreDict.get('blockWool')).toEqual(['minecraft:wool@0']);
    expect(pack.warnings!.filter((w) => w.includes('minecraft:wool@32767'))).toHaveLength(1);
  });

  it('loads fluids with molten and gas flags, and fluid containers', async () => {
    const pack = await makePack(sampleExportSpec());
    expect(pack.fluids.get(SAMPLE.moltenIron)).toEqual({ key: SAMPLE.moltenIron, id: 'molten.iron', name: 'Molten Iron', temperature: 1811, gas: false, molten: true });
    expect(pack.fluids.get(SAMPLE.oxygen)).toMatchObject({ gas: true, molten: false });
    expect(pack.fluidContainers).toEqual([{ container: 'gregtech:gt.metaitem.01@30013', empty: 'gregtech:gt.metaitem.01@32405', fluid: SAMPLE.oxygen, amount: 1000 }]);
  });

  it('passes battery data through only for electric items', async () => {
    const pack = await makePack(sampleExportSpec());
    expect(pack.items.get(SAMPLE.battery)!.electric).toEqual({ maxCharge: 100000, tier: 1, canProvideEnergy: true });
    expect(pack.items.get(SAMPLE.ironDust)!.electric).toBeUndefined();
    expect(Object.keys(pack.items.get(SAMPLE.ironDust)!)).not.toContain('electric');
  });

  it('keeps the first line of a duplicate item key and warns', async () => {
    const pack = await makePack({ items: [{ id: 'minecraft:stone', m: 0, dn: 'Stone' }, { id: 'minecraft:stone', m: 0, dn: 'Other Stone' }] });
    expect(pack.items.get('minecraft:stone@0')!.name).toBe('Stone');
    expect(pack.warnings!.filter((w) => w.includes('minecraft:stone@0'))).toHaveLength(1);
  });
});

describe('recipe maps and manifest', () => {
  it('normalizes ids, keeps aliases and adds the pseudo maps', async () => {
    const pack = await makePack(sampleExportSpec());
    expect(pack.maps.get('gt.recipe.testalias')!.aliases).toEqual(['gtpp.recipe.testalias']);
    expect(pack.maps.get('gt.recipe.blastfurnace')).toMatchObject({ name: 'Blast Furnace', specialValue: 'heat', amps: 1 });
    expect(pack.maps.get('gt.recipe.thermalcentrifuge')!.amps).toBe(2);
    expect(pack.maps.get('gt.recipe.furnace')!.dynamic).toBe('overwrite');
    expect(pack.maps.get('gt.recipe.macerator')!.categories).toEqual(['gt.recipe.macerator', 'gt.recipe.category.macerator_recycling']);
    for (const id of ['crafting', 'furnace', 'assemblyline']) expect(pack.maps.has(id)).toBe(true);
    expect(pack.manifest).toMatchObject({ exportId: 'memory', packVersion: '2.9.0-RC-1', gtVersion: '5.09.54.183', nameFailures: 1 });
  });

  it('merges raw maps that normalize to one id', async () => {
    const pack = await makePack({
      items: [{ id: 'gregtech:gt.blockmachines', m: 1, dn: 'Sparger' }],
      recipeMaps: [
        { id: 'gtpp.recipe.lftr.sparging', dn: 'LFTR Sparging', amps: 1, recipes: 2, cats: ['a'] },
        { id: 'gt.recipe.lftr.sparging', dn: 'Sparging', amps: 1, recipes: 3, cats: ['b'], catalysts: [0] },
      ],
    });
    expect(pack.maps.get('gt.recipe.lftr.sparging')).toMatchObject({
      name: 'LFTR Sparging', aliases: ['gtpp.recipe.lftr.sparging'], recipeCount: 5, categories: ['a', 'b'], catalystItems: ['gregtech:gt.blockmachines@1'],
    });
    expect(pack.maps.size).toBe(1 + 3);
  });

  it.each([
    ['gregtech.nei.formatter.HeatingCoilSpecialValueFormatter', undefined, 'heat'],
    ['gregtech.nei.formatter.FusionSpecialValueFormatter', undefined, 'fusion'],
    ['gregtech.nei.formatter.FuelSpecialValueFormatter', undefined, 'fuel'],
    ['gregtech.nei.formatter.SimpleSpecialValueFormatter', 'GT5U.nei.tier', 'tier'],
    ['gregtech.nei.formatter.SimpleSpecialValueFormatter', 'GT5U.nei.stages', 'none'],
    [undefined, undefined, 'none'],
  ] as const)('specialValueKind(%s, %s) = %s', (fmt, key, kind) => {
    expect(specialValueKind(fmt, key)).toBe(kind);
  });
});

describe('export directories', () => {
  it('loads what makeExport wrote', async () => {
    const pack = await loadPack(await makeExport(join(await tmp(), 'sample'), sampleExportSpec()));
    expect(pack.manifest.exportId).toBe('sample');
    expect(pack.items.size).toBe((await makePack(sampleExportSpec())).items.size);
  });

  it('rejects another format, and a missing required file, but not a missing structures file', async () => {
    await expect(loadPack(await makeExport(join(await tmp(), 'a'), { ...sampleExportSpec(), manifest: { format: 'other/1' as never } })))
      .rejects.toThrow(/gtnh-planner-export\/1/);
    await expect(loadPack(await makeExport(join(await tmp(), 'b'), { ...sampleExportSpec(), omitFiles: ['oreDict'] })))
      .rejects.toThrow(/oredict\.jsonl\.gz/);
    await expect(loadPack(await makeExport(join(await tmp(), 'c'), { ...sampleExportSpec(), omitFiles: ['structures'] }))).resolves.toBeDefined();
  });

  it('reports bad JSON with the file and line', async () => {
    const dir = await makeExport(join(await tmp(), 'd'), { ...sampleExportSpec(), rawLines: { fluids: ['{oops'] } });
    await expect(loadPack(dir)).rejects.toMatchObject({ name: 'ExportFormatError', file: 'fluids.jsonl.gz', line: 12 });
  });

  it('reports a truncated gzip file', async () => {
    const dir = await makeExport(join(await tmp(), 'e'), sampleExportSpec());
    const file = join(dir, EXPORT_FILES.items);
    await truncate(file, Math.floor((await stat(file)).size / 2));
    await expect(loadPack(dir)).rejects.toMatchObject({ name: 'ExportFormatError', file: 'items.jsonl.gz' });
  });

  it('reports a file whose line count differs from the manifest', async () => {
    const dir = await makeExport(join(await tmp(), 'f'), { ...sampleExportSpec(), countOverrides: { fluids: 3 } });
    await expect(loadPack(dir)).rejects.toThrow(/fluids\.jsonl\.gz.*manifest says 3 lines/);
  });

  it('reports a reference to an unknown item index', async () => {
    const dir = await makeExport(join(await tmp(), 'g'), { ...sampleExportSpec(), oreDict: [{ ore: 'dustBogus', items: [999] }] });
    await expect(loadPack(dir)).rejects.toMatchObject({ file: 'oredict.jsonl.gz', line: 1, message: expect.stringContaining('unknown item index 999') });
  });
});
