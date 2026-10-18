import { describe, it, expect } from 'vitest';
import { packFromSpec, type PackSpec } from '../../helpers/pack-spec.ts';
import { roughCosts } from '../../../src/server/planner/rough.ts';
import type { LeafOracle, PlanEnv } from '../../../src/server/planner/candidates.ts';
import type { Pack } from '../../../src/shared/types/pack.ts';

const env: PlanEnv = { tier: 1, reachable: new Set(['overworld']), lowGravity: false, coilHeat: 1801, excluded: new Set() };
const M = (mteId: number, map: string) => ({ mteId, name: `M${mteId}`, maps: [map], tier: 1 });
const leafOf = (prices: Record<string, number>): LeafOracle => (k) =>
  (Object.hasOwn(prices, k) ? { buyable: true, cost: prices[k]!, leafClass: 'direct' } : { buyable: false, cost: 0, leafClass: null });
const everything = (p: Pack): Set<string> => new Set([...p.items.keys(), ...p.fluids.keys()]);
const index = (p: Pack, id: string): number => p.recipes.findIndex((r) => r.id === id);
let key = 0;
/** A fresh cache key per call, so no test sees another's cached result. */
const fresh = (): string => `t${key++}`;

describe('roughCosts', () => {
  it('prices a good by its cheapest recipe, ore yields included, without byproduct credit', () => {
    const spec: PackSpec = { machines: [M(1, 'gt.recipe.macerator'), M(2, 'gt.recipe.furnace')], recipes: [
      { id: 'mace', map: 'gt.recipe.macerator', in: [['ore@0', 1]], out: [['dust@0', 2], ['side@0', 1, 0.5]], eut: 2 },
      { id: 'smelt', map: 'gt.recipe.furnace', in: [['dust@0', 1]], out: [['ingot@0', 1]], eut: 4 },
      { id: 'alt', map: 'gt.recipe.furnace', in: [['raw@0', 1]], out: [['ingot@0', 1]], eut: 4 }] };
    const p = packFromSpec(spec);
    const r = roughCosts(p, env, leafOf({ 'ore@0': 1, 'raw@0': 5 }), everything(p), fresh());
    expect([r.cost('dust@0'), r.cost('ingot@0'), r.cost('side@0')]).toEqual([0.5, 0.5, 2]);   // the whole run is charged to each output
    expect(r.recipeCost(index(p, 'alt'), 'ingot@0')).toBe(5);
    expect(r.recipeCost(index(p, 'smelt'), 'dust@0')).toBe(Infinity);   // it does not make dust
    expect(r.via('ingot@0')).toBe(index(p, 'smelt'));
  });
  it('keeps a bought good at its price, whatever a recipe could make it for', () => {
    const p = packFromSpec({ machines: [M(1, 'gt.recipe.macerator')], recipes: [
      { id: 'mace', map: 'gt.recipe.macerator', in: [['ore@0', 1]], out: [['dust@0', 4]], eut: 2 }] });
    expect(roughCosts(p, env, leafOf({ 'ore@0': 1, 'dust@0': 1 }), everything(p), fresh()).cost('dust@0')).toBe(1);
  });
  it('needs every not-consumed input available and leaves out recipes the group cannot run', () => {
    const p = packFromSpec({ machines: [M(1, 'gt.recipe.assembler'), { mteId: 2, name: 'MV', maps: ['gt.recipe.mixer'], tier: 2 }], recipes: [
      { id: 'molded', map: 'gt.recipe.assembler', in: [['raw@0', 1], { nc: 'mold@0' }], out: [['a@0', 1]], eut: 16 },
      { id: 'mv', map: 'gt.recipe.mixer', in: [['raw@0', 1]], out: [['b@0', 1]], eut: 120 }] });
    const leaf = leafOf({ 'raw@0': 1 });
    expect(roughCosts(p, env, leaf, new Set(['raw@0']), fresh()).cost('a@0')).toBe(Infinity);
    expect(roughCosts(p, env, leaf, new Set(['raw@0', 'mold@0']), fresh()).cost('a@0')).toBe(1);
    expect(roughCosts(p, env, leaf, everything(p), fresh()).cost('b@0')).toBe(Infinity);   // MV recipe at LV
  });
  it('counts a filled container that comes back empty as its fluid only', () => {
    const p = packFromSpec({ machines: [M(1, 'gt.recipe.canner'), M(2, 'gt.recipe.centrifuge'), M(3, 'gt.recipe.extruder')], recipes: [
      { id: 'can', map: 'gt.recipe.canner', in: [['cell@0', 1], ['fluid:oxygen', 1000]], out: [['ocell@0', 1]], eut: 2 },
      { id: 'use', map: 'gt.recipe.centrifuge', in: [['ocell@0', 1]], out: [['t@0', 1], ['cell@0', 1]], eut: 2 },
      { id: 'make-cell', map: 'gt.recipe.extruder', in: [['tin@0', 2]], out: [['cell@0', 1]], eut: 2 }] });
    p.fluidContainers = [{ container: 'ocell@0', empty: 'cell@0', fluid: 'fluid:oxygen', amount: 1000 }];
    const r = roughCosts(p, env, leafOf({ 'fluid:oxygen': 0.001, 'tin@0': 1 }), everything(p), fresh());
    expect(r.cost('t@0')).toBeCloseTo(1, 12);                        // 1,000 L of oxygen; the cell went back
    expect(r.cost('cell@0')).toBe(2);
    expect(r.cost('ocell@0')).toBeCloseTo(3, 12);                    // a filled container: its fluid and its cell
    expect(r.recipeCost(index(p, 'use'), 'cell@0')).toBe(Infinity);  // it only hands the cell back
    expect(r.recipeCost(index(p, 'make-cell'), 'cell@0')).toBe(2);
  });
  it('never takes the target as an input, so nothing made only from it gets a price', () => {
    const p = packFromSpec({ machines: [M(1, 'gt.recipe.polarizer'), M(2, 'gt.recipe.alloysmelter')], recipes: [
      { id: 'magnetize', map: 'gt.recipe.polarizer', in: [['steel@0', 1]], out: [['magnetic@0', 1]], eut: 16 },
      { id: 'demagnetize', map: 'gt.recipe.alloysmelter', in: [['magnetic@0', 1]], out: [['steel@0', 1]], eut: 16 },
      { id: 'smelt', map: 'gt.recipe.alloysmelter', in: [['iron@0', 1], ['coal@0', 1]], out: [['steel@0', 1]], eut: 16 }] });
    const leaf = leafOf({ 'iron@0': 1, 'coal@0': 1 });
    expect(roughCosts(p, env, leaf, everything(p), fresh()).cost('magnetic@0')).toBe(2);
    const barred = roughCosts(p, env, leaf, everything(p), fresh(), ['steel@0']);
    expect([barred.cost('magnetic@0'), barred.cost('steel@0')]).toEqual([Infinity, 2]);
  });
});
