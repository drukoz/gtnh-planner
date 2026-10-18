import { describe, it, expect } from 'vitest';
import { miniGt } from '../../helpers/mini-gt.ts';
import { packFromSpec, type IngredientSpec } from '../../helpers/pack-spec.ts';
import { acceptRecipe, buildCandidates, virtualKey, type PlanEnv, type LeafOracle } from '../../../src/server/planner/candidates.ts';
import { defaultSettings } from '../../../src/shared/project/apply-op.ts';
import { EXCLUSION_RULES } from '../../../src/server/planner/candidates.ts';
import { DEFAULT_EXCLUDED_CATEGORIES } from '../../../src/shared/types/plan.ts';

const pack = miniGt();
const env = (tier: number, extra: Partial<PlanEnv> = {}): PlanEnv => ({ tier, reachable: new Set(['overworld', 'nether']), lowGravity: false,
  coilHeat: 1801, excluded: new Set(defaultSettings().excludedCategories), ...extra });
const R = (id: string) => pack.recipeById.get(id)!;
const BASE = new Set(['t:iron_ingot@0', 't:copper_ingot@0', 't:tin_ingot@0', 't:redstone@0', 't:iron_dust@0', 't:iron_ore@0']);
const oracle: LeafOracle = (k) => (BASE.has(k) ? { buyable: true, cost: 1, leafClass: 'direct' } : { buyable: false, cost: 0, leafClass: null });

describe('acceptRecipe', () => {
  it('limits by tier and reports the tier that would run it', () => {
    expect(acceptRecipe(pack, R('circuit-mv'), env(1))).toEqual({ ok: false, why: 'tier', needTier: 2 });
    expect(acceptRecipe(pack, R('circuit-mv'), env(2))).toEqual({ ok: true, mapId: 'gt.recipe.assembler' });
  });
  it('uses the map amperage (thermal centrifuge is 2 A)', () => {
    const p = packFromSpec({ maps: [{ id: 'gt.recipe.thermalcentrifuge', amps: 2 }],
      machines: [{ mteId: 1, name: 'Basic Thermal Centrifuge', maps: ['gt.recipe.thermalcentrifuge'], tier: 1, amps: 2 }],
      recipes: [{ id: 'tc48', map: 'gt.recipe.thermalcentrifuge', in: [['a@0', 1]], out: [['b@0', 1]], eut: 48 },
                { id: 'tc65', map: 'gt.recipe.thermalcentrifuge', in: [['a@0', 1]], out: [['b@0', 1]], eut: 65 }] });
    expect(acceptRecipe(p, p.recipeById.get('tc48')!, env(1)).ok).toBe(true);
    expect(acceptRecipe(p, p.recipeById.get('tc65')!, env(1))).toMatchObject({ ok: false, why: 'tier', needTier: 2 });
  });
  it('drops fake, opaque, excluded and low-gravity recipes', () => {
    const m = { map: 'gt.recipe.macerator', in: [['a@0', 1]] as IngredientSpec[], out: [['b@0', 1]] as Array<[string, number]> };
    const p = packFromSpec({ machines: [{ mteId: 1, name: 'M', maps: ['gt.recipe.macerator'], tier: 1 }], recipes: [
      { id: 'fake', ...m, flags: { fake: true } }, { id: 'opaque', ...m, flags: { opaque: true } },
      { id: 'recy', ...m, category: 'gt.recipe.category.macerator_recycling' }, { id: 'lowg', ...m, meta: { lowGravity: true } }] });
    const why = (id: string) => (acceptRecipe(p, p.recipeById.get(id)!, env(1)) as { why: string }).why;
    expect(['fake', 'opaque', 'recy', 'lowg'].map(why)).toEqual(['fake', 'opaque', 'excluded', 'low-gravity']);
    expect(acceptRecipe(p, p.recipeById.get('lowg')!, env(1, { lowGravity: true })).ok).toBe(true);
  });
  it('excludes lava centrifuging unless the group turns the rule off', () => {
    expect(acceptRecipe(pack, R('lava-copper'), env(3))).toMatchObject({ ok: false, why: 'excluded' });
    expect(acceptRecipe(pack, R('lava-copper'), env(3, { excluded: new Set() })).ok).toBe(true);
  });
  it('uses the vanilla furnace only at ULV', () => {
    expect(acceptRecipe(pack, R('smelt-v'), env(1))).toMatchObject({ ok: false, why: 'vanilla-furnace' });
    expect(acceptRecipe(pack, R('smelt-v'), env(0))).toEqual({ ok: true, mapId: 'furnace' });
  });
  it('checks EBF heat: coil + 100 per tier above MV', () => {
    expect(acceptRecipe(pack, R('ebf-ti'), env(3, { coilHeat: 1801 }))).toMatchObject({ ok: false, why: 'heat' });   // 1901 K < 1941 K
    expect(acceptRecipe(pack, R('ebf-ti'), env(3, { coilHeat: 2701 })).ok).toBe(true);                               // 2801 K
  });
});

describe('buildCandidates', () => {
  it('walks back from the target to buyable leaves', () => {
    const g = buildCandidates(pack, defaultSettings(), env(1), oracle, ['t:circuit@0']);
    expect(g.recipes.map((r) => r.id)).toEqual(['bend-plate', 'circuit-lv', 'hammer-plate', 'wire']);
    expect(g.recipes.find((r) => r.id === 'circuit-lv')).toMatchObject({ kind: 'recipe', mapId: 'gt.recipe.assembler', euPerRun: 3200,
      nonConsumed: ['gregtech:gt.integrated_circuit@2'], coeffs: [['t:circuit@0', 1], ['t:copper_wire@0', -2], ['t:iron_plate@0', -1], ['t:redstone@0', -1]] });
    expect(g.goods.get('t:iron_ingot@0')).toMatchObject({ buyable: true, cost: 1, leafClass: 'direct' });
    expect(g.goods.get('t:circuit@0')).toMatchObject({ buyable: false });
    expect(g.goods.has('gregtech:gt.integrated_circuit@2')).toBe(false);
  });
  it('never buys the target itself', () => {
    const g = buildCandidates(pack, defaultSettings(), env(1), oracle, ['t:iron_ingot@0']);
    expect(g.goods.get('t:iron_ingot@0')?.buyable).toBe(false);
    expect(g.recipes.map((r) => r.id)).toEqual(['smelt-e']);
  });
  it('stops at "we already make this" goods', () => {
    const stop: LeafOracle = (k) => (k === 't:iron_plate@0' ? { buyable: true, cost: 1, leafClass: 'stop' } : oracle(k));
    const g = buildCandidates(pack, defaultSettings(), env(1), stop, ['t:circuit@0']);
    expect(g.recipes.map((r) => r.id)).toEqual(['circuit-lv', 'wire']);
  });
  it('honours a pinned recipe and warns about a stale pin', () => {
    const s = { ...defaultSettings(), recipeChoice: { 't:iron_plate@0': 'hammer-plate' } };
    expect(buildCandidates(pack, s, env(1), oracle, ['t:iron_plate@0']).recipes.map((r) => r.id)).toEqual(['hammer-plate']);
    const stale = buildCandidates(pack, { ...s, recipeChoice: { 't:iron_plate@0': 'gone' } }, env(1), oracle, ['t:iron_plate@0']);
    expect(stale.recipes.map((r) => r.id)).toEqual(['bend-plate', 'hammer-plate']);
    expect(stale.warnings).toEqual([expect.objectContaining({ code: 'stale-choice', key: 't:iron_plate@0', text: expect.stringContaining('Iron Plate') })]);
  });
  it('turns ore-dictionary slots into a virtual good with free conversions', () => {
    const p = packFromSpec({ machines: [{ mteId: 1, name: 'A', maps: ['gt.recipe.assembler'], tier: 1 }],
      recipes: [{ id: 'chest', map: 'gt.recipe.assembler', in: [{ any: [['minecraft:planks@0', 8], ['t:spruce_planks@0', 8]] }], out: [['minecraft:chest@0', 1]], eut: 4 }] });
    const V = virtualKey([{ key: 'minecraft:planks@0', amount: 8 }, { key: 't:spruce_planks@0', amount: 8 }]);
    expect(V).toBe('alt:minecraft:planks@0*8|t:spruce_planks@0*8');
    const all: LeafOracle = () => ({ buyable: true, cost: 1, leafClass: 'natural' });
    const g = buildCandidates(p, defaultSettings(), env(1), all, ['minecraft:chest@0']);
    expect(g.recipes.map((r) => r.id)).toEqual(['chest', `convert:${V}:minecraft:planks@0`, `convert:${V}:t:spruce_planks@0`]);
    expect(g.recipes[1]).toMatchObject({ kind: 'convert', euPerRun: 0, coeffs: [[V, 1], ['minecraft:planks@0', -8]] });
    expect(g.goods.get(V)).toMatchObject({ virtual: true, buyable: false });
  });
  it('records why a needed good cannot be made', () => {
    const g = buildCandidates(pack, defaultSettings(), env(1), oracle, ['t:titanium_plate@0']);
    expect(g.blocked.get('t:titanium_plate@0')).toEqual([{ recipeId: 'bend-ti', why: 'tier', needTier: 2 }]);
  });
});

describe('candidate rules without a fixture test above', () => {
  const M = (mteId: number, maps: string[], tier: number) => ({ mteId, name: `M${mteId}`, maps, tier });
  it('has one exclusion rule per default excluded category, each matching its recipes', () => {
    expect(Object.keys(EXCLUSION_RULES)).toEqual([...DEFAULT_EXCLUDED_CATEGORIES]);
    const p = packFromSpec({ items: [{ key: 'stone@0', oreDict: ['dustStone'] }], recipes: [
      { id: 'flagged', map: 'gt.recipe.macerator', flags: { recycling: true } }, { id: 'mf', map: 'gt.recipe.massfab' },
      { id: 'rep', map: 'gt.recipe.replicator' }, { id: 'rc', map: 'ic2.recycler' }, { id: 'sb', map: 'ic2.scrapbox' },
      { id: 'stone', map: 'gt.recipe.centrifuge', in: [['stone@0', 1]] }, { id: 'plain', map: 'gt.recipe.centrifuge', in: [['a@0', 1]] }] });
    const hits = (id: string) => Object.keys(EXCLUSION_RULES).filter((k) => EXCLUSION_RULES[k]!(p.recipeById.get(id)!, p));
    expect(['flagged', 'mf', 'rep', 'rc', 'sb', 'stone', 'plain'].map(hits))
      .toEqual([['recycling'], ['massfab'], ['replicator'], ['scrap'], ['scrap'], ['lava-centrifuge'], []]);
  });
  it('reports no-machine, and the voltage tier for multiblocks', () => {
    const p = packFromSpec({ machines: [{ mteId: 1, name: 'Big', maps: ['gt.recipe.big'], kind: 'multiblock' }],
      recipes: [{ id: 'none', map: 'gt.recipe.nobody', eut: 2 }, { id: 'big', map: 'gt.recipe.big', eut: 2000 }] });
    expect(acceptRecipe(p, p.recipeById.get('none')!, env(1))).toEqual({ ok: false, why: 'no-machine' });
    expect(acceptRecipe(p, p.recipeById.get('big')!, env(1))).toEqual({ ok: false, why: 'tier', needTier: 4 });
    expect(acceptRecipe(p, p.recipeById.get('big')!, env(4))).toEqual({ ok: true, mapId: 'gt.recipe.big' });
  });
  it('names the next listed machine when the pack skips the tiers in between', () => {
    const p = packFromSpec({ machines: [M(1, ['gt.recipe.x'], 1), M(5, ['gt.recipe.x'], 5)], recipes: [{ id: 'mv', map: 'gt.recipe.x', eut: 100 }] });
    expect(acceptRecipe(p, p.recipeById.get('mv')!, env(3))).toEqual({ ok: false, why: 'tier', needTier: 5 });
  });
  it('keeps only the buyable options of an ore-dictionary slot, else the first 8 by key', () => {
    const opts = Array.from({ length: 10 }, (_, i): [string, number] => [`o${i}@0`, 1]);
    const p = packFromSpec({ machines: [M(1, ['gt.recipe.assembler'], 1)],
      recipes: [{ id: 'use', map: 'gt.recipe.assembler', in: [{ any: opts }], out: [['t@0', 1]], eut: 4 }] });
    const V = virtualKey(opts.map(([key, amount]) => ({ key, amount })));
    const some: LeafOracle = (k) => (k === 'o3@0' || k === 'o7@0' ? { buyable: true, cost: 1, leafClass: 'direct' } : { buyable: false, cost: 0, leafClass: null });
    expect(buildCandidates(p, defaultSettings(), env(1), some, ['t@0']).recipes.map((r) => r.id))
      .toEqual([`convert:${V}:o3@0`, `convert:${V}:o7@0`, 'use']);
    const none: LeafOracle = () => ({ buyable: false, cost: 0, leafClass: null });
    expect(buildCandidates(p, defaultSettings(), env(1), none, ['t@0']).recipes.filter((r) => r.kind === 'convert').map((r) => r.id))
      .toEqual(opts.slice(0, 8).map(([key]) => `convert:${V}:${key}`));
  });
  it('knows byproduct outputs without walking back from them', () => {
    const p = packFromSpec({ machines: [M(1, ['gt.recipe.macerator'], 1)], recipes: [
      { id: 'both', map: 'gt.recipe.macerator', in: [['raw@0', 1]], out: [['t@0', 1], ['b@0', 1, 0.5]], eut: 2 },
      { id: 'make-b', map: 'gt.recipe.macerator', in: [['other@0', 1]], out: [['b@0', 1]], eut: 2 }] });
    const g = buildCandidates(p, defaultSettings(), env(1), () => ({ buyable: false, cost: 0, leafClass: null }), ['t@0']);
    expect(g.recipes.map((r) => [r.id, r.coeffs])).toEqual([['both', [['b@0', 0.5], ['raw@0', -1], ['t@0', 1]]]]);
    expect([...g.goods.keys()].sort()).toEqual(['b@0', 'raw@0', 't@0']);
  });
  it('stops adding recipes after 20,000', () => {
    const p = packFromSpec({ machines: [M(1, ['gt.recipe.macerator'], 1)],
      recipes: Array.from({ length: 20_001 }, (_, i) => ({ id: `r${String(i).padStart(5, '0')}`, map: 'gt.recipe.macerator', out: [['t@0', 1]] as Array<[string, number]> })) });
    const g = buildCandidates(p, defaultSettings(), env(1), oracle, ['t@0']);
    expect(g.recipes).toHaveLength(20_000);
    expect(g.warnings).toEqual([{ code: 'graph-too-big', text: 'This chain is too large to plan in one go; mark some parts as "we already make this"' }]);
  });
});
