import { mkdtemp, readdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { EXPORT_FILES, type BiomeLine } from '../../../src/server/pack/format.ts';
import { loadPack } from '../../../src/server/pack/load.ts';
import { makeExport, type ExportSpec } from '../../helpers/make-export.ts';
import { makePack } from '../../helpers/make-pack.ts';
import { sampleExportSpec } from '../../helpers/sample-export.ts';

const tmp = () => mkdtemp(join(tmpdir(), 'gp-biomes-'));

/** The biome table names no item, so the smallest export that loads is one item. */
const ITEMS: NonNullable<ExportSpec['items']> = [{ id: 'minecraft:stone', m: 0, dn: 'Stone' }];

/** The five biomes of the format's contract, with the rain gate each must give. */
const PLAINS: BiomeLine = { id: 1, name: 'Plains', rainfall: 0.4, snow: false, lightning: true };
const DESERT: BiomeLine = { id: 2, name: 'Desert', rainfall: 0.0, snow: false, lightning: false };
const HELL: BiomeLine = { id: 8, name: 'Hell', rainfall: 0.0, snow: false, lightning: false };
const SKY: BiomeLine = { id: 9, name: 'Sky', rainfall: 0.5, snow: false, lightning: false };
const ICE_PLAINS: BiomeLine = { id: 12, name: 'Ice Plains', rainfall: 0.5, snow: true, lightning: false };

describe('the biome table', () => {
  it('loads every biome of the table sorted by id, whatever order the lines come in', async () => {
    const dir = await makeExport(join(await tmp(), 'biomes'), { items: ITEMS, biomes: [ICE_PLAINS, DESERT, SKY, HELL, PLAINS] });
    const pack = await loadPack(dir);
    expect(pack.biomes).toEqual([
      { id: 1, name: 'Plains', rain: true },
      { id: 2, name: 'Desert', rain: false },
      { id: 8, name: 'Hell', rain: false },
      { id: 9, name: 'Sky', rain: false },
      { id: 12, name: 'Ice Plains', rain: true },   // snow counts as rain for GT
    ]);
    expect(pack.warnings).toEqual([]);
  });

  it('reads the same table from memory', async () => {
    const pack = await makePack({ items: ITEMS, biomes: [PLAINS, DESERT, HELL, SKY, ICE_PLAINS] });
    expect(pack.biomes!.map((b) => b.id)).toEqual([1, 2, 8, 9, 12]);
  });

  it('takes rain from GT\'s own gate, rainfall > 0 && (lightning || snow)', async () => {
    const pack = await makePack({
      items: ITEMS,
      biomes: [
        { id: 0, name: 'Zero rainfall, lightning', rainfall: 0.0, snow: false, lightning: true },
        { id: 1, name: 'Zero rainfall, snow', rainfall: 0.0, snow: true, lightning: false },
        { id: 2, name: 'Rainfall, lightning', rainfall: 0.4, snow: false, lightning: true },
        { id: 3, name: 'Rainfall, snow', rainfall: 0.5, snow: true, lightning: false },
        { id: 4, name: 'Rainfall, neither flag', rainfall: 0.5, snow: false, lightning: false },
      ],
    });
    expect(pack.biomes!.map((b) => b.rain)).toEqual([false, false, true, true, false]);
  });

  it('names a biome without a name Biome <id>', async () => {
    const pack = await makePack({ items: ITEMS, biomes: [{ ...PLAINS, id: 5, name: '' }] });
    expect(pack.biomes).toEqual([{ id: 5, name: 'Biome 5', rain: true }]);
    expect(pack.warnings).toEqual([]);
  });

  it('loads an export without a biome table', async () => {
    const dir = await makeExport(join(await tmp(), 'no-biomes'), { items: ITEMS, omitFiles: ['biomes'] });
    expect(await readdir(dir)).not.toContain(EXPORT_FILES.biomes);
    const pack = await loadPack(dir);
    expect(pack.biomes).toBeUndefined();
    expect(pack.warnings).toEqual([]);
    expect(pack.manifest.counts).not.toHaveProperty('biomes');
  });

  it('loads an empty biome table as no biomes', async () => {
    expect((await loadPack(await makeExport(join(await tmp(), 'empty'), { items: ITEMS }))).biomes).toEqual([]);
    expect((await makePack({ items: ITEMS })).biomes).toEqual([]);
  });

  it('keeps the first line of a duplicated id and warns', async () => {
    const pack = await makePack({ items: ITEMS, biomes: [PLAINS, { ...DESERT, id: 1, name: 'Other Plains' }, ICE_PLAINS] });
    expect(pack.biomes).toEqual([{ id: 1, name: 'Plains', rain: true }, { id: 12, name: 'Ice Plains', rain: true }]);
    expect(pack.warnings).toEqual(['biome 1: duplicate, the first one wins']);
  });

  it('skips a line whose fields are not the raw biome fields, with a warning, and loads the rest', async () => {
    const pack = await makePack({
      items: ITEMS,
      biomes: [
        PLAINS,
        { ...DESERT, rainfall: 'x' as never },
        { ...SKY, id: -1 },
        { ...SKY, id: 2.5 },
        { ...SKY, name: 7 as never },
        { ...SKY, snow: 'no' as never },
        { ...SKY, lightning: null as never },
        { ...SKY, rainfall: Number.NaN },
        ICE_PLAINS,
      ],
    });
    expect(pack.biomes).toEqual([{ id: 1, name: 'Plains', rain: true }, { id: 12, name: 'Ice Plains', rain: true }]);
    expect(pack.warnings).toEqual([
      'biome line 2: the rainfall is not a finite number, the line is skipped',
      'biome line 3: -1 is not a biome id, which is an integer >= 0, the line is skipped',
      'biome line 4: 2.5 is not a biome id, which is an integer >= 0, the line is skipped',
      'biome line 5: the name is not a string, the line is skipped',
      'biome line 6: snow is not a boolean, the line is skipped',
      'biome line 7: lightning is not a boolean, the line is skipped',
      'biome line 8: the rainfall is not a finite number, the line is skipped',
    ]);
  });

  it('leaves every other part of the export as it loads without the biome table', async () => {
    const dir = await tmp();
    const without = await loadPack(await makeExport(join(dir, 'without'), { ...sampleExportSpec(), omitFiles: ['biomes'] }));
    const withBiomes = await loadPack(await makeExport(join(dir, 'with'), { ...sampleExportSpec(), biomes: [PLAINS, ICE_PLAINS] }));

    expect(withBiomes.biomes).toEqual([{ id: 1, name: 'Plains', rain: true }, { id: 12, name: 'Ice Plains', rain: true }]);
    expect(without.biomes).toBeUndefined();
    expect([...withBiomes.items]).toEqual([...without.items]);
    expect(withBiomes.recipes).toEqual(without.recipes);
    expect([...withBiomes.machines]).toEqual([...without.machines]);
    expect([...withBiomes.materials]).toEqual([...without.materials]);
    expect(withBiomes.worldgen).toEqual(without.worldgen);
    expect(withBiomes.warnings).toEqual(without.warnings);
    const { biomes: biomeCount, ...counts } = withBiomes.manifest.counts;
    expect(biomeCount).toBe(2);
    expect(counts).toEqual(without.manifest.counts);
  });
});
