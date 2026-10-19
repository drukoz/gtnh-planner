import { describe, it, expect } from 'vitest';
import { miniGt } from '../../helpers/mini-gt.ts';
import { packFromSpec, type IngredientSpec, type RecipeSpec } from '../../helpers/pack-spec.ts';
import { acceptRecipe, buildCandidates, MAX_RECIPES, virtualKey, type PlanEnv, type LeafOracle } from '../../../src/server/planner/candidates.ts';
import { solveLine } from '../../../src/server/planner/solve.ts';
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
    const p = packFromSpec({ items: [{ key: 'stone@0', oreDict: ['dustStone'] }, { key: 'obsidian@0', oreDict: ['dustObsidian'] }], recipes: [
      { id: 'flagged', map: 'gt.recipe.macerator', flags: { recycling: true } }, { id: 'mf', map: 'gt.recipe.massfab' },
      { id: 'rep', map: 'gt.recipe.replicator' }, { id: 'rc', map: 'ic2.recycler' }, { id: 'sb', map: 'ic2.scrapbox' },
      { id: 'stone', map: 'gt.recipe.centrifuge', in: [['stone@0', 1]] }, { id: 'plain', map: 'gt.recipe.centrifuge', in: [['a@0', 1]] },
      { id: 'obsidian', map: 'gt.recipe.electrolyzer', in: [['obsidian@0', 12]] }, { id: 'lava', map: 'gt.recipe.centrifuge', in: [['fluid:lava', 100]] }] });
    const hits = (id: string) => Object.keys(EXCLUSION_RULES).filter((k) => EXCLUSION_RULES[k]!(p.recipeById.get(id)!, p));
    expect(['flagged', 'mf', 'rep', 'rc', 'sb', 'stone', 'plain', 'obsidian', 'lava'].map(hits))
      .toEqual([['recycling'], ['massfab'], ['replicator'], ['scrap'], ['scrap'], ['lava-centrifuge'], [], ['lava-centrifuge'], ['lava-centrifuge']]);
  });
  it('skips crafting a programmed circuit back into a circuit, not setting its number or using it in a recipe', () => {
    const pc = (n: number) => ({ key: `gregtech:gt.integrated_circuit@${n}`, id: 'gregtech:gt.integrated_circuit', name: 'Programmed Circuit' });
    const p = packFromSpec({ items: [pc(0), pc(1), pc(2)], recipes: [
      { id: 'back', map: 'crafting', in: [{ any: [['gregtech:gt.integrated_circuit@0', 1], ['gregtech:gt.integrated_circuit@1', 1]] }], out: [['IC2:itemPartCircuit@0', 1]] },
      { id: 'renumber', map: 'crafting', in: [['gregtech:gt.integrated_circuit@0', 1], { nc: 'screwdriver@0' }], out: [['gregtech:gt.integrated_circuit@2', 1]] },
      { id: 'to-pc', map: 'crafting', in: [['IC2:itemPartCircuit@0', 1]], out: [['gregtech:gt.integrated_circuit@0', 1]] },
      { id: 'bus', map: 'crafting', in: [['gregtech:gt.integrated_circuit@1', 1], ['bus@0', 1]], out: [['bus@1', 1]] },
      { id: 'machine', map: 'gt.recipe.assembler', in: [['gregtech:gt.integrated_circuit@0', 1]], out: [['IC2:itemPartCircuit@0', 1]] }] });
    const rule = EXCLUSION_RULES['programmed-circuit-conversion']!;
    expect(['back', 'renumber', 'to-pc', 'bus', 'machine'].map((id) => rule(p.recipeById.get(id)!, p))).toEqual([true, false, false, false, false]);
    expect(DEFAULT_EXCLUDED_CATEGORIES).toContain('programmed-circuit-conversion');
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
  it('keeps the three cheapest producers of a good, within twice the cheapest estimated raw cost', () => {
    const recipes: RecipeSpec[] = [1, 1.5, 2, 2.5, 3, 10].map((n, i) => ({ id: `p${i}`, map: 'gt.recipe.macerator', in: [['raw@0', n]], out: [['t@0', 1]] }));
    recipes.push({ id: 'by', map: 'gt.recipe.macerator', in: [['raw@0', 1]], out: [['u@0', 1], ['t@0', 1, 0.01]] });   // 100 per t
    const p = packFromSpec({ machines: [M(1, ['gt.recipe.macerator'], 1)], recipes });
    const raw: LeafOracle = (k) => (k === 'raw@0' ? { buyable: true, cost: 1, leafClass: 'direct' } : { buyable: false, cost: 0, leafClass: null });
    expect(buildCandidates(p, defaultSettings(), env(1), raw, ['t@0']).recipes.map((r) => r.id)).toEqual(['p0', 'p1', 'p2']);
  });
  it('ranks producers made from goods settled before the output first (no closed loop of equally cheap recipes)', () => {
    // Sand from gravel and sand from sandstone (made from sand) cost the same; only the first is grounded.
    const p = packFromSpec({ machines: [M(1, ['gt.recipe.macerator'], 1)], recipes: [
      { id: 'a-from-sandstone', map: 'gt.recipe.macerator', in: [['sandstone@0', 1]], out: [['sand@0', 4]] },
      { id: 'b-sandstone', map: 'gt.recipe.macerator', in: [['sand@0', 4]], out: [['sandstone@0', 1]] },
      { id: 'c-a', map: 'gt.recipe.macerator', in: [['sandstone@0', 1]], out: [['sand@0', 4]] },
      { id: 'c-b', map: 'gt.recipe.macerator', in: [['sandstone@0', 1]], out: [['sand@0', 4]] },
      { id: 'z-from-gravel', map: 'gt.recipe.macerator', in: [['gravel@0', 1]], out: [['sand@0', 1]] }] });
    const gravel: LeafOracle = (k) => (k === 'gravel@0' ? { buyable: true, cost: 1, leafClass: 'free' } : { buyable: false, cost: 0, leafClass: null });
    expect(buildCandidates(p, defaultSettings(), env(1), gravel, ['sand@0']).recipes.map((r) => r.id)).toContain('z-from-gravel');
  });
  it('keeps the same producers whatever order the export lists recipes and options in', () => {
    // x and y cost the same and each is made from the other: which one counts as made first must not follow the
    // export's order, or y→x is grounded in one export of a pack and not in the next.
    const recipes: RecipeSpec[] = [
      { id: 'a-from-y', map: 'gt.recipe.macerator', in: [['y@0', 1]], out: [['x@0', 1]] },
      { id: 'x-from-raw', map: 'gt.recipe.macerator', in: [['raw@0', 2]], out: [['x@0', 1]] },
      { id: 'x-from-raw2', map: 'gt.recipe.macerator', in: [{ any: [['raw2@0', 2], ['raw3@0', 2]] }], out: [['x@0', 1]] },
      { id: 'x-from-raw4', map: 'gt.recipe.macerator', in: [['raw4@0', 2]], out: [['x@0', 1]] },
      { id: 'y-from-raw', map: 'gt.recipe.macerator', in: [['raw@0', 2]], out: [['y@0', 1]] },
      { id: 'y-from-x', map: 'gt.recipe.macerator', in: [['x@0', 1]], out: [['y@0', 1]] }];
    const raw: LeafOracle = (k) => (k.startsWith('raw') ? { buyable: true, cost: 0.5, leafClass: 'direct' } : { buyable: false, cost: 0, leafClass: null });
    const ids = (list: RecipeSpec[]) => buildCandidates(packFromSpec({ machines: [M(1, ['gt.recipe.macerator'], 1)], recipes: list }),
      defaultSettings(), env(1), raw, ['x@0']).recipes.map((r) => r.id);
    const reversed = [...recipes].reverse().map((r) => ({ ...r, in: r.in?.map((ing) => (typeof ing === 'object' && 'any' in ing ? { any: [...ing.any].reverse() } : ing)) }));
    expect(ids(reversed)).toEqual(ids(recipes));
  });
  it('stops adding recipes at the cap (40,000) and says the graph was cut short', () => {
    expect(MAX_RECIPES).toBe(40_000);
    // t ← one recipe of 200 inputs, each made from 200 more, each made from nothing: 40,201 recipes, one per good.
    const ins = (prefix: string): Array<[string, number]> => Array.from({ length: 200 }, (_, i): [string, number] => [`${prefix}_${i}@0`, 1]);
    const p = packFromSpec({ machines: [M(1, ['gt.recipe.macerator'], 1)], recipes: [
      { id: 'r', map: 'gt.recipe.macerator', in: ins('w'), out: [['t@0', 1]] },
      ...ins('w').flatMap(([w], i) => [
        { id: `r${i}`, map: 'gt.recipe.macerator', in: ins(`w${i}`), out: [[w, 1]] as Array<[string, number]> },
        ...ins(`w${i}`).map(([leaf], j) => ({ id: `r${i}_${j}`, map: 'gt.recipe.macerator', out: [[leaf, 1]] as Array<[string, number]> }))])] });
    const g = buildCandidates(p, defaultSettings(), env(1), oracle, ['t@0']);
    expect(g.recipes).toHaveLength(MAX_RECIPES);
    expect(g.truncated).toBe(true);
    expect(g.warnings).toEqual([{ code: 'graph-too-big', text: 'This chain is too large to plan in one go; mark some parts as "we already make this"' }]);
    expect(buildCandidates(p, defaultSettings(), env(1), oracle, ['t@0'], { maxRecipes: 10 }).recipes).toHaveLength(10);
  });
});

// Fix spec R4 (pruning keeps the simplest route), R10 (canonical members win ties) and D14 (a filled container is emptied).
describe('pruning by steps, carried containers and canonical ties', () => {
  const M = (mteId: number, maps: string[]) => ({ mteId, name: `M${mteId}`, maps, tier: 1 });
  const step = (id: string, from: string, to: string, amount = 1): RecipeSpec => ({ id, map: 'gt.recipe.assembler', in: [[from, amount]], out: [[to, 1]], eut: 16 });
  const priced = (costs: Record<string, number>): LeafOracle => (k) => (Object.hasOwn(costs, k)
    ? { buyable: true, cost: costs[k] as number, leafClass: 'direct' } : { buyable: false, cost: 0, leafClass: null });
  const ids = (p: ReturnType<typeof packFromSpec>, leaf: LeafOracle, target: string) =>
    buildCandidates(p, defaultSettings(), env(1), leaf, [target]).recipes.map((r) => r.id);

  it('neither charges nor waits for cells a recipe hands on', () => {
    // Steel from iron dust and 1,000 L oxygen (an EBF), or from an iron ingot and 2 coal (a Bricked Blast Furnace, 3 raw).
    // Oxygen comes from free water in an electrolyzer that hands its 2 Empty Cells on as Hydrogen Cells, or from 10
    // quartz dust (12.5 raw). Charging the cells (15 tin each) and waiting for them to be priced made oxygen cost 12.5,
    // so the EBF recipe (13.5) was pruned.
    const p = packFromSpec({
      machines: [M(1, ['gt.recipe.blastfurnace']), M(2, ['gt.recipe.primitiveblastfurnace']), M(3, ['gt.recipe.electrolyzer']), M(4, ['gt.recipe.assembler'])],
      recipes: [
        { id: 'ebf-steel', map: 'gt.recipe.blastfurnace', in: [['t:iron_dust@0', 1], ['fluid:oxygen', 1000]], out: [['t:steel_ingot@0', 1]], eut: 30 },
        { id: 'bbf-steel', map: 'gt.recipe.primitiveblastfurnace', in: [['t:iron_ingot@0', 1], ['t:coal@0', 2]], out: [['t:steel_ingot@0', 1]] },
        { id: 'electrolyze', map: 'gt.recipe.electrolyzer', in: [['t:empty_cell@0', 2], ['fluid:water', 1000]], out: [['fluid:oxygen', 1000], ['t:h_cell@0', 2]], eut: 30 },
        { id: 'dust-oxygen', map: 'gt.recipe.electrolyzer', in: [['t:quartz_dust@0', 10]], out: [['fluid:oxygen', 1000]], eut: 30 },
        step('make-cell', 't:tin_ingot@0', 't:empty_cell@0', 15),
      ],
      fluidContainers: [{ container: 't:h_cell@0', empty: 't:empty_cell@0', fluid: 'fluid:hydrogen', amount: 1000 }],
    });
    const leaf = priced({ 't:iron_dust@0': 1, 't:iron_ingot@0': 1, 't:coal@0': 1, 'fluid:water': 0, 't:quartz_dust@0': 1.25, 't:tin_ingot@0': 1 });
    expect(ids(p, leaf, 't:steel_ingot@0')).toEqual(expect.arrayContaining(['ebf-steel', 'electrolyze']));
  });
  it('keeps the simplest producer', () => {
    // One recipe from s (2.5), or four from r (1): the short route is 2.5× the cheapest and still kept.
    const p = packFromSpec({ machines: [M(1, ['gt.recipe.assembler'])], recipes: [
      step('simple', 't:s@0', 't:t@0'),
      step('c1', 't:r@0', 't:m1@0'), step('c2', 't:m1@0', 't:m2@0'), step('c3', 't:m2@0', 't:m3@0'), step('from-m', 't:m3@0', 't:t@0'),
    ] });
    expect(ids(p, priced({ 't:s@0': 2.5, 't:r@0': 1 }), 't:t@0')).toEqual(['c1', 'c2', 'c3', 'from-m', 'simple']);
  });
  it('drops a producer far longer than the simplest', () => {
    // t from s in 1 recipe (1.2), from r in 2 (1), or from l in 8 (1.5, or 0.5): the 8-recipe route is 7 steps longer
    // than the simplest, so it stays only while it is the cheapest.
    const long = Array.from({ length: 8 }, (_, i) => step(`l${i + 1}`, i === 0 ? 't:l@0' : `t:l${i}@0`, i === 7 ? 't:t@0' : `t:l${i + 1}@0`));
    const p = packFromSpec({ machines: [M(1, ['gt.recipe.assembler'])], recipes: [
      step('simple', 't:s@0', 't:t@0'), step('n1', 't:r@0', 't:n1@0'), step('from-n', 't:n1@0', 't:t@0'), ...long,
    ] });
    expect(ids(p, priced({ 't:s@0': 1.2, 't:r@0': 1, 't:l@0': 1.5 }), 't:t@0')).toEqual(['from-n', 'n1', 'simple']);
    expect(ids(p, priced({ 't:s@0': 1.2, 't:r@0': 1, 't:l@0': 0.5 }), 't:t@0')).toEqual(expect.arrayContaining(['l1', 'l8', 'simple']));
  });
  it('prefers the canonical member at a tie', async () => {
    // Oak Wood and modded logs fill one slot at the same price, the modded ones sorting first by key.
    const logs = (keys: string[]) => packFromSpec({ machines: [M(1, ['gt.recipe.assembler'])], recipes: [
      { id: 'saw', map: 'gt.recipe.assembler', in: [{ any: keys.map((k): [string, number] => [k, 1]) }], out: [['t:planks@0', 4]], eut: 16 }] });
    const natural: LeafOracle = (k) => (k.includes(':log') ? { buyable: true, cost: 1, leafClass: 'natural' } : { buyable: false, cost: 0, leafClass: null });
    const options = (p: ReturnType<typeof packFromSpec>) => buildCandidates(p, defaultSettings(), env(1), natural, ['t:planks@0']).recipes
      .filter((r) => r.kind === 'convert').map((r) => r.coeffs.find(([, c]) => c < 0)?.[0]);
    // A slot keeps three options: Oak Wood is among them.
    expect(options(logs(['BiomesOPlenty:logs1@0', 'BiomesOPlenty:logs1@1', 'BiomesOPlenty:logs1@2', 'minecraft:log@0']))).toContain('minecraft:log@0');
    // When the line keeps only one of two, it is Oak Wood.
    const two = logs(['BiomesOPlenty:logs1@0', 'minecraft:log@0']);
    const graph = buildCandidates(two, defaultSettings(), env(1), natural, ['t:planks@0']);
    for (const opts of [{}, { stepCharge: 0.05 }]) {
      const sol = await solveLine(graph, new Map([['t:planks@0', 1]]), opts);
      expect([...sol.buys.keys()]).toEqual(['minecraft:log@0']);
    }
  });
  it('adds the recipe that empties a filled container a recipe makes', () => {
    // The press hands back an Oxygen Cell; a canner can empty it into its Empty Cell instead of the line throwing it away.
    const p = packFromSpec({
      machines: [M(1, ['gt.recipe.assembler']), M(2, ['gt.recipe.canner'])],
      recipes: [{ id: 'press', map: 'gt.recipe.assembler', in: [['t:raw@0', 1]], out: [['t:t@0', 1], ['t:o2_cell@0', 1]], eut: 16 },
                { id: 'empty-o2', map: 'gt.recipe.canner', in: [['t:o2_cell@0', 1]], out: [['fluid:oxygen', 1000], ['t:empty_cell@0', 1]], eut: 4 }],
      fluidContainers: [{ container: 't:o2_cell@0', empty: 't:empty_cell@0', fluid: 'fluid:oxygen', amount: 1000 }],
    });
    expect(ids(p, priced({ 't:raw@0': 1 }), 't:t@0')).toEqual(['empty-o2', 'press']);
  });
});

describe('real-data rules (final review)', () => {
  const M = (mteId: number, maps: string[], tier: number) => ({ mteId, name: `M${mteId}`, maps, tier });
  it('never makes goods from a generator fuel list', () => {
    const p = packFromSpec({
      maps: [{ id: 'bw.fuels.acidgens', specialValue: 'fuel' }, { id: 'gt.recipe.rtg' }],
      machines: [{ mteId: 1, name: 'Large Neutralization Engine', maps: ['bw.fuels.acidgens'], kind: 'multiblock' },
                 { mteId: 2, name: 'RTG', maps: ['gt.recipe.rtg'], kind: 'generator', tier: 1 }],
      recipes: [{ id: 'acid', map: 'bw.fuels.acidgens', in: [['acid-cell@0', 1]], out: [['cell@0', 1]] },
                { id: 'rtg', map: 'gt.recipe.rtg', in: [['pellet@0', 1]], out: [['depleted@0', 1]] }] });
    expect(acceptRecipe(p, p.recipeById.get('acid')!, env(5))).toEqual({ ok: false, why: 'fuel' });
    expect(acceptRecipe(p, p.recipeById.get('rtg')!, env(5))).toEqual({ ok: false, why: 'fuel' });
  });
  it('runs a multiblock recipe only where the group can build the multiblock (EU/t 0 endgame machines)', () => {
    const p = packFromSpec({ machines: [{ mteId: 9, name: 'Eye of Harmony', maps: ['gt.recipe.eyeofharmony'], kind: 'multiblock' }],
      recipes: [{ id: 'eoh', map: 'gt.recipe.eyeofharmony', out: [['t:iron_dust@0', 64]], eut: 0 }] });
    const r = p.recipeById.get('eoh')!;
    expect(acceptRecipe(p, r, env(1)).ok).toBe(true);                                         // no gate given: any multiblock
    expect(acceptRecipe(p, r, env(1, { multiblocks: new Set() }))).toEqual({ ok: false, why: 'multiblock' });
    expect(acceptRecipe(p, r, env(1, { multiblocks: new Set([9]) })).ok).toBe(true);
  });
  it('leaves out the recipes an env names as making ore from nothing, and smelting parts back into metal', () => {
    const p = packFromSpec({
      items: [{ key: 'spring@0', name: 'Steel Spring', gt: { prefix: 'spring', material: 'Steel' } }, { key: 'steel@0', name: 'Steel Ingot', gt: { prefix: 'ingot', material: 'Steel' } },
              { key: 'sdust@0', name: 'Steel Dust', gt: { prefix: 'dust', material: 'Steel' } }],
      machines: [M(1, ['gt.recipe.furnace'], 1), M(2, ['gt.recipe.electrolyzer'], 1)],
      recipes: [{ id: 'back', map: 'gt.recipe.furnace', source: 'derived', in: [['spring@0', 1]], out: [['steel@0', 1]], eut: 4 },
                { id: 'dust', map: 'gt.recipe.furnace', source: 'derived', in: [['sdust@0', 1]], out: [['steel@0', 1]], eut: 4 },
                { id: 'obsidian', map: 'gt.recipe.electrolyzer', in: [['odust@0', 12]], out: [['t:iron_dust@0', 1], ['mg@0', 1]], eut: 90 }] });
    expect(acceptRecipe(p, p.recipeById.get('back')!, env(1))).toEqual({ ok: false, why: 'excluded' });
    expect(acceptRecipe(p, p.recipeById.get('back')!, env(1, { excluded: new Set() })).ok).toBe(true);
    expect(acceptRecipe(p, p.recipeById.get('dust')!, env(1)).ok).toBe(true);
    expect(acceptRecipe(p, p.recipeById.get('obsidian')!, env(1, { fromNothing: new Set(['obsidian']) }))).toEqual({ ok: false, why: 'excluded' });
  });
});
