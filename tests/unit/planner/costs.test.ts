import { describe, it, expect } from 'vitest';
import { miniGt } from '../../helpers/mini-gt.ts';
import { packFromSpec } from '../../helpers/pack-spec.ts';
import { makePrices, makeLeafOracle, analyzeCosts } from '../../../src/server/planner/costs.ts';
import { computeAvailability, reachableDims } from '../../../src/server/planner/availability.ts';
import { buildCandidates, type LeafOracle, type PlanEnv } from '../../../src/server/planner/candidates.ts';
import { defaultSettings } from '../../../src/shared/project/apply-op.ts';

const pack = miniGt();
const env = (tier: number): PlanEnv => ({ tier, reachable: reachableDims(pack.worldgen, { policy: 'progression', overrides: {} }, [], tier).keys,
  lowGravity: false, coilHeat: 2701, excluded: new Set(defaultSettings().excludedCategories) });

describe('makePrices', () => {
  it('prices in ingot-equivalents', () => {
    const p = makePrices(pack, {});
    expect(['t:iron_ingot@0', 't:iron_plate@0', 't:copper_wire@0', 't:iron_ore@0', 't:circuit@0', 'fluid:water', 'minecraft:cobblestone@0']
      .map((k) => p.price(k))).toEqual([1, 1, 0.5, 1, 1, 0, 0]);
    expect([p.price('fluid:lava'), p.price('fluid:air')]).toEqual([0, 0]);
    expect(p.price('fluid:molten.iron') * 144).toBeCloseTo(1, 12);
    expect(p.price('fluid:oil') * 1000).toBeCloseTo(1, 12);
  });
  it('applies overrides by material and by key', () => {
    const p = makePrices(pack, { Iron: 3, 'fluid:water': 0.5 });
    expect([p.price('t:iron_ingot@0'), p.price('t:iron_plate@0'), p.price('fluid:water')]).toEqual([3, 3, 0.5]);
    expect(p.price('fluid:molten.iron') * 144).toBeCloseTo(3, 12);
  });
});

describe('makeLeafOracle', () => {
  const avail = computeAvailability(pack, env(1));
  const prices = makePrices(pack, {});
  it('buys reachable base materials, never unavailable ones', () => {
    const leaf = makeLeafOracle(pack, defaultSettings(), avail, prices);
    expect(leaf('t:iron_ingot@0')).toEqual({ buyable: true, cost: 1, leafClass: 'direct' });
    expect(leaf('t:titanium_dust@0')).toEqual({ buyable: false, cost: 0, leafClass: 'unavailable' });
    expect(leaf('t:iron_plate@0')).toEqual({ buyable: false, cost: 0, leafClass: null });
    expect(leaf('minecraft:log@0')).toEqual({ buyable: true, cost: 1, leafClass: 'natural' });
  });
  it('handles stop and expand items', () => {
    const s = { ...defaultSettings(), stopItems: ['t:iron_plate@0'], expandItems: ['t:iron_ingot@0'] };
    const leaf = makeLeafOracle(pack, s, avail, prices, () => 1.25);
    expect(leaf('t:iron_plate@0')).toEqual({ buyable: true, cost: 1.25, leafClass: 'stop' });
    expect(leaf('t:iron_ingot@0')).toEqual({ buyable: false, cost: 0, leafClass: null });
    expect(makeLeafOracle(pack, { ...s, costOverrides: { 't:iron_plate@0': 4 } }, avail, prices, () => 1.25)('t:iron_plate@0').cost).toBe(4);
  });
  it('routes derived base materials only when asked', () => {
    const p = packFromSpec({ items: [{ key: 'clay@0', name: 'Clay' }, { key: 'alu@0', name: 'Aluminium Dust', gt: { prefix: 'dust', material: 'Aluminium' } }],
      machines: [{ mteId: 1, name: 'Basic Electrolyzer', maps: ['gt.recipe.electrolyzer'], tier: 1 }],
      recipes: [{ id: 'el', map: 'gt.recipe.electrolyzer', in: [['clay@0', 1]], out: [['alu@0', 1]], eut: 30 }] });
    const e: PlanEnv = { tier: 1, reachable: new Set(['overworld']), lowGravity: false, coilHeat: 1801, excluded: new Set() };
    const a = computeAvailability(p, e);
    expect(makeLeafOracle(p, defaultSettings(), a, makePrices(p, {}))('alu@0')).toEqual({ buyable: true, cost: 1, leafClass: 'derived' });
    expect(makeLeafOracle(p, { ...defaultSettings(), routeDerived: true }, a, makePrices(p, {}))('alu@0').buyable).toBe(false);
  });
});

describe('analyzeCosts', () => {
  it('gives every good its cheapest raw cost and ranks recipes', async () => {
    const leaf = makeLeafOracle(pack, defaultSettings(), computeAvailability(pack, env(2)), makePrices(pack, {}));
    const c = await analyzeCosts(buildCandidates(pack, defaultSettings(), env(2), leaf, ['t:circuit@0']));
    expect(c.cost('t:iron_plate@0')).toBeCloseTo(1, 6);
    expect(c.cost('t:copper_wire@0')).toBeCloseTo(0.5, 6);
    expect(c.cost('t:circuit@0')).toBeCloseTo(2.5, 6);
    expect(c.recipeCost('circuit-lv', 't:circuit@0')).toBeCloseTo(3, 6);
    expect(c.recipeCost('circuit-mv', 't:circuit@0')).toBeCloseTo(2.5, 6);
    expect(c.recipeCost('hammer-plate', 't:iron_plate@0')).toBeCloseTo(2, 6);
  });
  it('is Infinity for goods nothing reachable makes', async () => {
    const leaf = makeLeafOracle(pack, defaultSettings(), computeAvailability(pack, env(2)), makePrices(pack, {}));
    const c = await analyzeCosts(buildCandidates(pack, defaultSettings(), env(2), leaf, ['t:titanium_plate@0']));
    expect(c.cost('t:titanium_plate@0')).toBe(Infinity);
  });
  const lv: PlanEnv = { tier: 1, reachable: new Set(['overworld']), lowGravity: false, coilHeat: 1801, excluded: new Set() };
  const macerator = { mteId: 1, name: 'M', maps: ['gt.recipe.macerator'], tier: 1 };
  it('is Infinity for goods made only from unreachable goods, whatever the yield', async () => {
    const p = packFromSpec({ machines: [macerator],
      recipes: [{ id: 'split', map: 'gt.recipe.macerator', in: [['ore@0', 1]], out: [['bit@0', 4]], eut: 2 },
                { id: 'join', map: 'gt.recipe.macerator', in: [['bit@0', 1], ['raw@0', 1]], out: [['t@0', 1]], eut: 2 },
                { id: 'honest', map: 'gt.recipe.macerator', in: [['raw@0', 2]], out: [['t@0', 1]], eut: 2 }] });
    const leaf: LeafOracle = (k) => (k === 'raw@0' ? { buyable: true, cost: 1, leafClass: 'direct' }
      : k === 'ore@0' ? { buyable: false, cost: 0, leafClass: 'unavailable' } : { buyable: false, cost: 0, leafClass: null });
    const c = await analyzeCosts(buildCandidates(p, defaultSettings(), lv, leaf, ['t@0']));
    expect([c.cost('ore@0'), c.cost('bit@0'), c.recipeCost('join', 't@0')]).toEqual([Infinity, Infinity, Infinity]);
    expect(c.cost('t@0')).toBeCloseTo(2, 6);
    expect(c.recipeCost('honest', 't@0')).toBeCloseTo(2, 6);
  });
  it('credits co-products at their cost', async () => {
    const p = packFromSpec({ machines: [macerator],
      recipes: [{ id: 'both', map: 'gt.recipe.macerator', in: [['raw@0', 4]], out: [['t@0', 1], ['s@0', 1]], eut: 2 },
                { id: 'only-s', map: 'gt.recipe.macerator', in: [['raw@0', 1]], out: [['s@0', 1]], eut: 2 },
                { id: 'only-t', map: 'gt.recipe.macerator', in: [['raw@0', 2]], out: [['t@0', 1]], eut: 2 }] });
    const leaf: LeafOracle = (k) => (k === 'raw@0' ? { buyable: true, cost: 1, leafClass: 'direct' } : { buyable: false, cost: 0, leafClass: null });
    const c = await analyzeCosts(buildCandidates(p, defaultSettings(), lv, leaf, ['t@0', 's@0']));
    expect([c.cost('t@0'), c.cost('s@0')].map((v) => Math.round(v * 1e6) / 1e6)).toEqual([2, 1]);
    expect(c.recipeCost('both', 't@0')).toBeCloseTo(3, 6);
    expect(c.recipeCost('both', 's@0')).toBeCloseTo(2, 6);
    expect(c.recipeCost('both', 'raw@0')).toBe(Infinity);
    expect(c.recipeCost('missing', 't@0')).toBe(Infinity);
  });
});
