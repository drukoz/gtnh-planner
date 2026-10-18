import { createHash } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { canonicalRecipe, nbtHash, recipeId, type RecipeContent } from '../../../src/server/pack/recipe-id.ts';
import type { Recipe } from '../../../src/shared/types/pack.ts';

const sha = (s: string, n: number) => createHash('sha1').update(s).digest('hex').slice(0, n);

const ebf = (): RecipeContent => ({
  source: 'gt',
  inputs: [{ slot: 0, consumed: true, chance: 1, options: [{ key: 'gregtech:gt.metaitem.01@2032', amount: 1 }] }],
  outputs: [{ key: 'gregtech:gt.metaitem.01@11305', amount: 1, chance: 1 }],
  euPerTick: 120, durationTicks: 1000, specialValue: 1000, meta: { coilHeat: 1000 },
});

describe('recipeId', () => {
  it('hashes the documented canonical form', () => {
    const canonical =
      '["v1","gt",null,0,120,1000,1000,[[0,1,1,[["gregtech:gt.metaitem.01@2032",1]]]],[["gregtech:gt.metaitem.01@11305",1,1]],{"coilHeat":1000}]';
    expect(canonicalRecipe(ebf())).toBe(canonical);
    expect(recipeId(ebf())).toBe(sha(canonical, 16));
  });

  it('ignores option order, meta key order and owners', () => {
    const a = ebf();
    a.inputs[0]!.options = [{ key: 'b:x@0', amount: 1 }, { key: 'a:x@0', amount: 2 }];
    a.meta = { x: { z: 1, y: 2 }, coilHeat: 1000, owners: ['gregtech'] };
    const b = ebf();
    b.inputs[0]!.options = [{ key: 'a:x@0', amount: 2 }, { key: 'b:x@0', amount: 1 }];
    b.meta = { coilHeat: 1000, x: { y: 2, z: 1 } };
    expect(recipeId(a)).toBe(recipeId(b));
  });

  const changes: Array<[string, (r: RecipeContent) => void]> = [
    ['output amount', (r) => { r.outputs[0]!.amount = 2; }],
    ['output chance', (r) => { r.outputs[0]!.chance = 0.5; }],
    ['EU/t', (r) => { r.euPerTick = 121; }],
    ['duration', (r) => { r.durationTicks = 999; }],
    ['category', (r) => { r.category = 'gt.recipe.category.macerator_recycling'; }],
    ['fake flag', (r) => { r.fake = true; }],
    ['consumed flag', (r) => { r.inputs[0]!.consumed = false; }],
    ['source', (r) => { r.source = 'derived'; }],
  ];
  it.each(changes)('changes when the %s changes', (_name, mutate) => {
    const r = ebf();
    mutate(r);
    expect(recipeId(r)).not.toBe(recipeId(ebf()));
  });
});

describe('nbtHash', () => {
  it('is the first 12 hex of sha1 over the SNBT text', () => {
    expect(nbtHash('{title:"Data"}')).toBe(sha('{title:"Data"}', 12));
  });
});

describe('recipeId, the rest of the canonical form', () => {
  it('is 16 lowercase hex digits', () => {
    expect(recipeId(ebf())).toMatch(/^[0-9a-f]{16}$/);
  });

  it('sorts options by key, then amount, and leaves the order of the caller\'s list alone', () => {
    const r = ebf();
    r.inputs[0]!.options = [{ key: 'b:x@0', amount: 1 }, { key: 'a:x@0', amount: 5 }, { key: 'a:x@0', amount: 2 }];
    expect(canonicalRecipe(r)).toContain('[[0,1,1,[["a:x@0",2],["a:x@0",5],["b:x@0",1]]]]');
    expect(r.inputs[0]!.options.map((o) => `${o.key}/${o.amount}`)).toEqual(['b:x@0/1', 'a:x@0/5', 'a:x@0/2']);
  });

  it('sorts meta keys at every depth, also inside arrays, and drops only a top-level owners key', () => {
    const r = ebf();
    r.meta = { z: [{ b: 1, a: 2 }], a: { owners: ['gregtech'], c: 1 }, owners: ['examplemod'] };
    expect(canonicalRecipe(r).endsWith(',{"a":{"c":1,"owners":["gregtech"]},"z":[{"a":2,"b":1}]}]')).toBe(true);
  });

  const moreChanges: Array<[string, (r: RecipeContent) => void]> = [
    ['special value', (r) => { r.specialValue = 1001; }],
    ['input slot', (r) => { r.inputs[0]!.slot = 1; }],
    ['input chance', (r) => { r.inputs[0]!.chance = 0.5; }],
    ['input option amount', (r) => { r.inputs[0]!.options[0]!.amount = 2; }],
    ['input option key', (r) => { r.inputs[0]!.options[0]!.key = 'gregtech:gt.metaitem.01@2033'; }],
    ['output key', (r) => { r.outputs[0]!.key = 'gregtech:gt.metaitem.01@11306'; }],
    ['meta value', (r) => { r.meta = { coilHeat: 1001 }; }],
    ['set of meta keys', (r) => { r.meta = { coilHeat: 1000, cleanroom: true }; }],
  ];
  it.each(moreChanges)('changes when the %s changes', (_name, mutate) => {
    const r = ebf();
    mutate(r);
    expect(recipeId(r)).not.toBe(recipeId(ebf()));
  });

  it('gives a loaded recipe the same id in every map and whatever its amps and map flags are', () => {
    const recipe = (extra: Partial<Recipe>): Recipe => ({ ...ebf(), id: 'stale', maps: ['gt.recipe.blastfurnace'], amps: 1, flags: {}, ...extra });
    const idOf = (r: Recipe) => recipeId({ ...r, fake: r.flags.fake });
    const plain = recipe({});
    const inTwoMaps = recipe({ maps: ['gt.recipe.blastfurnace', 'gt.recipe.other'], amps: 4, flags: { hidden: true, recycling: true, dynamicMap: 'overwrite' } });
    expect(idOf(inTwoMaps)).toBe(idOf(plain));
    expect(idOf(inTwoMaps)).toBe(recipeId(ebf()));
    expect(idOf(recipe({ flags: { fake: true } }))).not.toBe(idOf(plain));
  });
});
