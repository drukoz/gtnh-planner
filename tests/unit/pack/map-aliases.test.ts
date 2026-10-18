import { expect, it } from 'vitest';
import { aliasesOf, normalizeMapId } from '../../../src/server/pack/map-aliases.ts';

it.each([
  ['gtpp.recipe.lftr.sparging', 'gt.recipe.lftr.sparging'],
  ['gtpp.recipe.multicentrifuge', 'gt.recipe.multicentrifuge'],
  ['gt.recipe.fluidchemicaleactor', 'gt.recipe.fluidchemicalreactor'],
  ['gt.recipe.macerator_1_2_3_4_5', 'gt.recipe.macerator'],
  ['gt.recipe.blastfurnace', 'gt.recipe.blastfurnace'],
])('normalizeMapId(%s) = %s', (raw, id) => {
  expect(normalizeMapId(raw)).toBe(id);
});

it('lists the raw ids and table entries that point at a canonical id', () => {
  expect(aliasesOf('gt.recipe.fluidchemicalreactor', ['gt.recipe.fluidchemicaleactor'])).toEqual(['gt.recipe.fluidchemicaleactor']);
  expect(aliasesOf('gt.recipe.lftr.sparging', ['gt.recipe.lftr.sparging'])).toEqual(['gtpp.recipe.lftr.sparging']);
  expect(aliasesOf('gt.recipe.blastfurnace', ['gt.recipe.blastfurnace'])).toEqual([]);
});

it.each([
  ['gt.recipe.fluidchemicaleactor_1_2_3_4_5', 'gt.recipe.fluidchemicalreactor'], // the suffix goes, then the table applies
  ['gtpp.recipe.fluidchemicaleactor', 'gt.recipe.fluidchemicalreactor'], // the prefix changes, then the table applies
  ['gtpp.recipe.oremill_1_2_3_4_5', 'gt.recipe.oremill'], // both rules on one id
  ['gt.recipe.centrifugeNonCell', 'gt.recipe.centrifugeNonCell'],
  ['gt.recipe.macerator_1_2_3_4', 'gt.recipe.macerator_1_2_3_4'], // only five trailing counters are GT's old suffix
  ['constructor', 'constructor'], // never an inherited property of the alias table
  ['__proto__', '__proto__'],
])('normalizeMapId(%s) = %s', (raw, id) => {
  expect(normalizeMapId(raw)).toBe(id);
});

it('normalizes an id that is already canonical to itself', () => {
  for (const id of ['gt.recipe.lftr.sparging', 'gt.recipe.fluidchemicalreactor', 'gt.recipe.multicentrifuge', 'gt.recipe.macerator']) {
    expect(normalizeMapId(id)).toBe(id);
  }
});

it('returns aliases sorted and unique, without the id itself, for any iterable', () => {
  const seen = new Set(['gtpp.recipe.macerator', 'gt.recipe.macerator_1_2_3_4_5', 'gt.recipe.macerator']);
  expect(aliasesOf('gt.recipe.macerator', seen)).toEqual(['gt.recipe.macerator_1_2_3_4_5', 'gtpp.recipe.macerator']);
  expect(aliasesOf('gt.recipe.lftr.sparging', ['gtpp.recipe.lftr.sparging', 'gt.recipe.lftr.sparging_1_2_3_4_5', 'gtpp.recipe.lftr.sparging']))
    .toEqual(['gt.recipe.lftr.sparging_1_2_3_4_5', 'gtpp.recipe.lftr.sparging']);
  expect(aliasesOf('gt.recipe.fluidchemicalreactor', [])).toEqual(['gt.recipe.fluidchemicaleactor']);
});
