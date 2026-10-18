import { beforeAll, describe, expect, it } from 'vitest';
import type { Pack } from '../../../src/shared/types/pack.ts';
import { searchPack } from '../../../src/server/pack/search.ts';
import { makePack } from '../../helpers/make-pack.ts';
import { SAMPLE, sampleExportSpec } from '../../helpers/sample-export.ts';

let pack: Pack;
beforeAll(async () => { pack = await makePack(sampleExportSpec()); });
const names = (q: string, limit?: number) => searchPack(pack, q, limit).map((h) => h.name);

describe('searchPack', () => {
  it('ranks an exact name first', () => {
    expect(searchPack(pack, 'iron dust')[0]).toEqual({ key: SAMPLE.ironDust, name: 'Iron Dust', kind: 'item', produced: true });
  });
  it('ranks name prefixes, then word starts, then substrings', () => {
    expect(names('iron')).toEqual(['Iron Ore', 'Iron Dust', 'Iron Ingot', 'Molten Iron']);
  });
  it('matches every word of a query in any order', () => {
    expect(names('dust iron')[0]).toBe('Iron Dust');
    expect(names('dust nickel')[0]).toBe('Nickel Dust');
  });
  it('filters by ore name with $ and by mod with @', () => {
    expect(names('$plankwood')).toEqual(['Oak Wood Planks', 'Spruce Wood Planks']);
    expect(names('@minecraft iron')).toEqual(['Iron Ingot']);
  });
  it('includes fluids, finds registry names and respects the limit', () => {
    expect(searchPack(pack, 'oxygen')[0]).toMatchObject({ key: SAMPLE.oxygen, kind: 'fluid' });
    expect(names('gt.blockores')).toEqual(['Iron Ore']);
    expect(names('e', 3)).toHaveLength(3);
  });
  it('returns nothing for an empty query', () => {
    expect(searchPack(pack, '')).toEqual([]);
    expect(searchPack(pack, '   ')).toEqual([]);
  });
});
