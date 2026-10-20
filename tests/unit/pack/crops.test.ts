import { mkdtemp, readdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { itemKey } from '../../../src/shared/keys.ts';
import { EXPORT_FILES } from '../../../src/server/pack/format.ts';
import { loadPack } from '../../../src/server/pack/load.ts';
import { nbtHash } from '../../../src/server/pack/recipe-id.ts';
import { makeExport, type ExportSpec } from '../../helpers/make-export.ts';
import { makePack } from '../../helpers/make-pack.ts';

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

const STICKY_CANE = {
  id: 'cropsnh:stickyCane', name: 'Sticky Cane', tier: 4, duration: 200, dropChance: 0.81450625,
  drops: [{ item: 0, count: 1, chance: 10000 }], liked: ['HOT', 'SANDY', 'WET'], soils: [1, 3], requirements: [], seed: 4, minSeedBedTier: 0,
};
/** Its drop 999, soil 998 and seed 997 are item indices the export does not have. */
const BROKEN_FERN = {
  id: 'cropsnh:testFern', name: 'Test Fern', tier: 6, duration: 2800, dropChance: 0.735091890625,
  drops: [{ item: 999, count: 1, chance: 10000 }, { item: 5, count: 2, chance: 2500 }], liked: [], soils: [998, 2],
  requirements: ['SubSoilRequirement'], seed: 997, minSeedBedTier: -1,
};

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
