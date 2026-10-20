import { mkdtemp, readdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { itemKey } from '../../../src/shared/keys.ts';
import type { Item, Pack } from '../../../src/shared/types/pack.ts';
import { EXPORT_FILES, type CropLine } from '../../../src/server/pack/format.ts';
import { loadPack } from '../../../src/server/pack/load.ts';
import { nbtHash } from '../../../src/server/pack/recipe-id.ts';
import { searchPack } from '../../../src/server/pack/search.ts';
import { makeExport, type ExportSpec } from '../../helpers/make-export.ts';
import { makePack } from '../../helpers/make-pack.ts';
import { SAMPLE, sampleExportSpec } from '../../helpers/sample-export.ts';

const tmp = () => mkdtemp(join(tmpdir(), 'gp-crops-'));

const SEED_NBT = '{crop:"cropsnh:stickyCane"}';

/** Invented items for the crop lines: a drop, a soil the crop table names by its wildcard, a seed with NBT and a leaf. */
const ITEMS: NonNullable<ExportSpec['items']> = [
  { id: 't:resin', m: 0, dn: 'Resin' }, // 0
  { id: 't:soil', m: 32767 }, // 1: wildcard
  { id: 't:soil', m: 0, dn: 'Soil' }, // 2
  { id: 't:soil', m: 1, dn: 'Wet Soil' }, // 3
  { id: 't:seed', m: 0, nbt: SEED_NBT, dn: 'Sticky Cane Seeds' }, // 4
  { id: 't:leaf', m: 0, dn: 'Leaf' }, // 5
];

const STICKY_CANE: CropLine = {
  id: 'cropsnh:stickyCane', name: 'Sticky Cane', tier: 4, duration: 200, dropChance: 0.81450625,
  drops: [{ item: 0, count: 1, chance: 10000 }], liked: ['HOT', 'SANDY', 'WET'], soils: [1, 3], requirements: [], seed: 4, minSeedBedTier: 0,
};
/** Its drop 999, soil 998 and seed 997 are item indices the export does not have. */
const BROKEN_FERN: CropLine = {
  id: 'cropsnh:testFern', name: 'Test Fern', tier: 6, duration: 2800, dropChance: 0.735091890625,
  drops: [{ item: 999, count: 1, chance: 10000 }, { item: 5, count: 2, chance: 2500 }], liked: [], soils: [998, 2],
  requirements: ['SubSoilRequirement'], seed: 997, minSeedBedTier: -1,
};

const BERRY_SEED_NBT = '{crop:"cropsnh:testBerry"}';
const BERRY_SEED = itemKey('t:seed', 0, nbtHash(BERRY_SEED_NBT));
/**
 * Names three items the item table lacks inline (exporter 0.5.1): a drop, a soil and its seed, which has NBT and the
 * name the exporter gives a seed. The resin drops at a chance above 10000, as CropsNH's Water Lily does.
 */
const BERRY_BUSH: CropLine = {
  id: 'cropsnh:testBerry', name: 'Test Berry', tier: 2, duration: 500, dropChance: 0.9025,
  drops: [{ item: { key: 't:berry@2', name: 'Big Berry' }, count: 1, chance: 2500 }, { item: 0, count: 2, chance: 80000 }],
  liked: [], soils: [2, { key: 't:soil@7', name: 'Mossy Soil' }], requirements: [],
  seed: { key: 't:seed@0', name: 'Test Berry Seeds', nbt: BERRY_SEED_NBT }, minSeedBedTier: 0,
};

/** The items of `pack` that came from the item table, in their order: every item that is not a crop item. */
const tableItems = (pack: Pack): Array<[string, Item]> => [...pack.items].filter(([, item]) => item.cropOnly !== true);
const cropItems = (pack: Pack): Item[] => [...pack.items.values()].filter((item) => item.cropOnly === true);

describe('the crop table', () => {
  it('loads the crop table when the export has one', async () => {
    const pack = await loadPack(await makeExport(join(await tmp(), 'crops'), { items: ITEMS, crops: [STICKY_CANE, BROKEN_FERN] }));
    expect(pack.crops).toHaveLength(2);
    expect(pack.crops![0]).toEqual({
      id: 'cropsnh:stickyCane', name: 'Sticky Cane', tier: 4, growthDuration: 200, dropChance: 0.81450625,
      drops: [{ key: 't:resin@0', chance: 1, stackSize: 1 }], likedBiomes: ['HOT', 'SANDY', 'WET'],
      soils: ['t:soil@0', 't:soil@1'], requirements: [], seed: itemKey('t:seed', 0, nbtHash(SEED_NBT)), minSeedBedTier: 0,
    });
    expect(pack.crops![1]).toEqual({
      id: 'cropsnh:testFern', name: 'Test Fern', tier: 6, growthDuration: 2800, dropChance: 0.735091890625,
      drops: [{ key: 't:leaf@0', chance: 0.25, stackSize: 2 }], likedBiomes: [], soils: ['t:soil@0'],
      requirements: ['SubSoilRequirement'], seed: null, minSeedBedTier: -1,
    });
    expect(pack.warnings!.filter((w) => w.includes('cropsnh:testFern'))).toEqual([
      'crops.jsonl.gz: crop cropsnh:testFern: drop item index 999 is not in the export, the drop is left out',
      'crops.jsonl.gz: crop cropsnh:testFern: soil item index 998 is not in the export, the soil is left out',
      'crops.jsonl.gz: crop cropsnh:testFern: seed item index 997 is not in the export, the crop has no seed',
    ]);
    expect(cropItems(pack)).toEqual([]);
  });

  it('names a soil once when two of its items name the same block', async () => {
    const pack = await makePack({ items: ITEMS, crops: [{ ...STICKY_CANE, soils: [1, 2, 3] }] });
    expect(pack.crops![0]!.soils).toEqual(['t:soil@0', 't:soil@1']);   // the wildcard is its first variant, Soil itself
  });

  it('loads an export without one', async () => {
    const dir = await makeExport(join(await tmp(), 'no-crops'), { items: ITEMS, omitFiles: ['crops'] });
    expect(await readdir(dir)).not.toContain(EXPORT_FILES.crops);
    const pack = await loadPack(dir);
    expect(pack.crops).toBeUndefined();
    expect(pack.manifest.counts).not.toHaveProperty('crops');
  });

  it('loads an empty crop table as no crops', async () => {
    expect((await loadPack(await makeExport(join(await tmp(), 'empty'), { items: ITEMS }))).crops).toEqual([]);
    expect((await makePack({ items: ITEMS })).crops).toEqual([]);
  });
});

describe('the items of the crop table', () => {
  it('makes each item the item table lacks a crop item, keyed and named as the line says', async () => {
    const pack = await loadPack(await makeExport(join(await tmp(), 'inline'), { items: ITEMS, crops: [BERRY_BUSH] }));
    expect(pack.crops![0]).toEqual({
      id: 'cropsnh:testBerry', name: 'Test Berry', tier: 2, growthDuration: 500, dropChance: 0.9025,
      drops: [{ key: 't:berry@2', chance: 0.25, stackSize: 1 }, { key: 't:resin@0', chance: 8, stackSize: 2 }],   // 80000 as it is
      likedBiomes: [], soils: ['t:soil@0', 't:soil@7'], requirements: [], seed: BERRY_SEED, minSeedBedTier: 0,
    });
    expect(cropItems(pack)).toEqual([
      { key: 't:berry@2', id: 't:berry', meta: 2, name: 'Big Berry', oreDict: [], cropOnly: true },
      { key: 't:soil@7', id: 't:soil', meta: 7, name: 'Mossy Soil', oreDict: [], cropOnly: true },
      { key: BERRY_SEED, id: 't:seed', meta: 0, nbt: BERRY_SEED_NBT, name: 'Test Berry Seeds', oreDict: [], cropOnly: true },
    ]);
    expect(pack.nameOf(BERRY_SEED)).toBe('Test Berry Seeds');   // the seed is named after its crop
    expect(tableItems(pack).map(([key]) => key)).toEqual(['t:resin@0', 't:soil@0', 't:soil@1', itemKey('t:seed', 0, nbtHash(SEED_NBT)), 't:leaf@0']);
    expect(pack.warnings).toEqual([]);
  });

  it('keeps the item of the table, or of an earlier crop, when an inline item has its key', async () => {
    const pack = await makePack({
      items: ITEMS,
      crops: [
        BERRY_BUSH,
        {
          ...BERRY_BUSH, id: 'cropsnh:otherBerry', name: 'Other Berry',
          drops: [{ item: { key: 't:berry@2', name: 'Another Berry' }, count: 1, chance: 5000 }],
          soils: [2, { key: 't:soil@0', name: 'Fake Soil' }], seed: { key: 't:resin@0', name: 'Fake Resin' },
        },
      ],
    });
    expect(pack.crops![1]).toMatchObject({ drops: [{ key: 't:berry@2', chance: 0.5, stackSize: 1 }], soils: ['t:soil@0'], seed: 't:resin@0' });
    expect(pack.items.get('t:berry@2')!.name).toBe('Big Berry');
    expect(pack.items.get('t:soil@0')).toEqual({ key: 't:soil@0', id: 't:soil', meta: 0, name: 'Soil', oreDict: [] });
    expect(pack.items.get('t:resin@0')).toEqual({ key: 't:resin@0', id: 't:resin', meta: 0, name: 'Resin', oreDict: [] });
    expect(cropItems(pack).map((item) => item.key)).toEqual(['t:berry@2', 't:soil@7', BERRY_SEED]);
  });

  it('leaves out an inline item that names no item, with a warning', async () => {
    const pack = await makePack({
      items: ITEMS,
      crops: [{
        ...BERRY_BUSH,
        drops: [
          { item: { key: 't:berry', name: 'No Meta' }, count: 1, chance: 100 },
          { item: { key: 't:berry@32767', name: 'Any Berry' }, count: 1, chance: 100 },
          { item: { key: 't:berry@2#0123456789ab', name: 'Hashed Berry' }, count: 1, chance: 100 },
          { item: { key: 't:berry@3' } as never, count: 1, chance: 100 },
          { item: 0, count: 1, chance: 10000 },
        ],
        soils: [{ key: '', name: 'Nothing' }], seed: { key: 't:seed@0', name: 'Bad Seeds', nbt: '' },
      }],
    });
    expect(pack.crops![0]).toMatchObject({ drops: [{ key: 't:resin@0', chance: 1, stackSize: 1 }], soils: [], seed: null });
    expect(cropItems(pack)).toEqual([]);
    expect(pack.warnings).toEqual([
      'crops.jsonl.gz: crop cropsnh:testBerry: drop item {"key":"t:berry","name":"No Meta"} needs a key id@meta and a name, the drop is left out',
      'crops.jsonl.gz: crop cropsnh:testBerry: drop item {"key":"t:berry@32767","name":"Any Berry"} needs a key id@meta and a name, the drop is left out',
      'crops.jsonl.gz: crop cropsnh:testBerry: drop item {"key":"t:berry@2#0123456789ab","name":"Hashed Berry"} needs a key id@meta and a name, the drop is left out',
      'crops.jsonl.gz: crop cropsnh:testBerry: drop item {"key":"t:berry@3"} needs a key id@meta and a name, the drop is left out',
      'crops.jsonl.gz: crop cropsnh:testBerry: soil item {"key":"","name":"Nothing"} needs a key id@meta and a name, the soil is left out',
      'crops.jsonl.gz: crop cropsnh:testBerry: seed item {"key":"t:seed@0","name":"Bad Seeds","nbt":""} needs a key id@meta and a name, the crop has no seed',
    ]);
  });

  it('lists a crop item in search only when a recipe makes it', async () => {
    const pack = await makePack({ items: ITEMS, crops: [BERRY_BUSH] });
    expect(searchPack(pack, 'berry')).toEqual([]);
    expect(searchPack(pack, 'mossy soil')).toEqual([]);
    expect(searchPack(pack, 'soil').map((hit) => hit.key)).toEqual(['t:soil@0', 't:soil@1']);
    const farmed: Pack = { ...pack, producers: new Map([...pack.producers, ['t:berry@2', [0]]]) };   // a farm recipe makes it
    expect(searchPack(farmed, 'berry')).toEqual([{ key: 't:berry@2', name: 'Big Berry', kind: 'item', produced: true }]);
  });

  it('leaves the items, recipes, ore names and wildcards of the export as they are without the crop table', async () => {
    // The tree drops a planks variant the item table lacks: were it a line of the item table, the planks wildcard
    // (item 8) would take it as an option, and so would plankWood and both crafting recipes of planks.
    const tree: CropLine = {
      id: 'cropsnh:testTree', name: 'Test Tree', tier: 3, duration: 900, dropChance: 0.857375,
      drops: [{ item: { key: 'minecraft:planks@2', name: 'Birch Wood Planks' }, count: 4, chance: 10000 }, { item: 10, count: 1, chance: 5000 }],
      liked: ['FOREST'], soils: [8, { key: 'minecraft:dirt@0', name: 'Dirt' }], requirements: [],
      seed: { key: 'examplemod:seed@0', name: 'Test Tree Seeds', nbt: '{crop:"cropsnh:testTree"}' }, minSeedBedTier: 0,
    };
    const dir = await tmp();
    const without = await loadPack(await makeExport(join(dir, 'without'), { ...sampleExportSpec(), omitFiles: ['crops'] }));
    const withCrops = await loadPack(await makeExport(join(dir, 'with'), { ...sampleExportSpec(), crops: [tree] }));

    expect(withCrops.crops![0]).toMatchObject({
      drops: [{ key: 'minecraft:planks@2', chance: 1, stackSize: 4 }, { key: SAMPLE.stick, chance: 0.5, stackSize: 1 }],
      soils: [SAMPLE.oakPlanks, 'minecraft:dirt@0'],
    });
    expect(withCrops.recipes).toEqual(without.recipes);
    expect([...withCrops.recipeById.keys()]).toEqual([...without.recipeById.keys()]);
    expect([...withCrops.oreDict]).toEqual([...without.oreDict]);
    expect(withCrops.oreDict.get('plankWood')).toEqual([SAMPLE.oakPlanks, SAMPLE.sprucePlanks]);
    const crafted = withCrops.recipes.filter((r) => r.source === 'crafting' && r.inputs.some((i) => i.options.some((o) => o.key === SAMPLE.oakPlanks)));
    expect(crafted.map((r) => r.inputs[0]!.options.map((o) => o.key))).toEqual([[SAMPLE.oakPlanks, SAMPLE.sprucePlanks], [SAMPLE.oakPlanks, SAMPLE.sprucePlanks]]);
    expect(tableItems(withCrops)).toEqual([...without.items]);   // the same keys, in the same order, with the same values
    expect(cropItems(withCrops).map((item) => item.key)).toEqual(['minecraft:planks@2', 'minecraft:dirt@0', itemKey('examplemod:seed', 0, nbtHash('{crop:"cropsnh:testTree"}'))]);
    expect([...withCrops.producers]).toEqual([...without.producers]);
    expect([...withCrops.consumers]).toEqual([...without.consumers]);
    expect([...withCrops.materials]).toEqual([...without.materials]);
    expect(withCrops.worldgen).toEqual(without.worldgen);
    expect(withCrops.fluidContainers).toEqual(without.fluidContainers);
    expect([...withCrops.maps]).toEqual([...without.maps]);
    expect([...withCrops.machines]).toEqual([...without.machines]);
    expect(withCrops.warnings).toEqual(without.warnings);
    const { crops: cropCount, ...counts } = withCrops.manifest.counts;
    expect(cropCount).toBe(1);
    expect(counts).toEqual(without.manifest.counts);
  });
});
