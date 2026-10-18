import { describe, it, expect } from 'vitest';
import { miniGt } from '../../helpers/mini-gt.ts';
import { packFromSpec } from '../../helpers/pack-spec.ts';
import { reachableDims, computeAvailability, unlockText, isBaseItem, isNatural } from '../../../src/server/planner/availability.ts';
import { defaultSettings } from '../../../src/shared/project/apply-op.ts';
import type { PlanEnv } from '../../../src/server/planner/candidates.ts';

const pack = miniGt();
const prog = { policy: 'progression' as const, overrides: {} };
const envAt = (tier: number, dims = prog, visited: string[] = []): PlanEnv => {
  const r = reachableDims(pack.worldgen, dims, visited, tier);
  return { tier, reachable: r.keys, lowGravity: r.lowGravity, coilHeat: 2701, excluded: new Set(defaultSettings().excludedCategories) };
};

describe('reachableDims', () => {
  it('follows progression, adds visited dimensions and honours overrides', () => {
    expect(reachableDims(pack.worldgen, prog, [], 1).reachable).toEqual([{ key: 'nether', why: 'progression' }, { key: 'overworld', why: 'progression' }]);
    expect(reachableDims(pack.worldgen, prog, [], 3).keys.has('moon')).toBe(true);
    expect(reachableDims(pack.worldgen, prog, ['moon'], 1).reachable).toContainEqual({ key: 'moon', why: 'visited' });
    expect(reachableDims(pack.worldgen, { policy: 'progression', overrides: { moon: 'on', nether: 'off' } }, [], 1).reachable)
      .toEqual([{ key: 'moon', why: 'override' }, { key: 'overworld', why: 'progression' }]);
    expect(reachableDims(pack.worldgen, { policy: 'visited', overrides: {} }, [], 5).reachable).toEqual([{ key: 'overworld', why: 'progression' }]);
  });
});

describe('computeAvailability', () => {
  it('classifies base materials by reachable sources', () => {
    const a = computeAvailability(pack, envAt(1));
    expect(['t:iron_ingot@0', 't:iron_ore@0', 't:redstone@0', 't:titanium_dust@0', 'fluid:oil', 'fluid:water', 'minecraft:log@0', 'fluid:molten.iron']
      .map((k) => a.classOf(k))).toEqual(['direct', 'direct', 'direct', 'unavailable', 'unavailable', 'free', 'natural', 'derived']);
    expect(computeAvailability(pack, envAt(2)).classOf('fluid:oil')).toBe('direct');
    expect(computeAvailability(pack, envAt(3)).classOf('t:titanium_ingot@0')).toBe('direct');
    expect(computeAvailability(pack, envAt(1, prog, ['moon'])).classOf('t:titanium_dust@0')).toBe('direct');
    expect(computeAvailability(pack, envAt(1, { policy: 'progression', overrides: { nether: 'off' } })).classOf('t:redstone@0')).toBe('unavailable');
  });
  it('explains sources', () => {
    const a = computeAvailability(pack, envAt(1));
    expect(a.sources('t:iron_ingot@0')).toEqual([{ kind: 'vein', dims: ['overworld'], detail: 'ore.mix.iron' }]);
    expect(a.sources('fluid:molten.iron')).toEqual([{ kind: 'derived', dims: [], detail: 'made by Fluid Extractor from Iron Ingot' }]);
    expect(a.why.get('fluid:molten.iron')).toBe('extract-iron');
  });
  it('marks byproducts of reachable ores', () => {
    const p = packFromSpec({
      items: [{ key: 'ore@0', name: 'Iron Ore', gt: { prefix: 'ore', material: 'Iron' } }, { key: 'gold@0', name: 'Gold Dust', gt: { prefix: 'dust', material: 'Gold' } }],
      machines: [{ mteId: 1, name: 'Basic Ore Washer', maps: ['gt.recipe.orewasher'], tier: 1 }],
      recipes: [{ id: 'wash', map: 'gt.recipe.orewasher', in: [['ore@0', 1]], out: [['gold@0', 1, 0.1]], eut: 16 }],
      worldgen: { veins: [{ name: 'ore.mix.iron', dims: ['overworld'], materials: { primary: 'Iron', secondary: 'Iron', between: 'Iron', sporadic: 'Iron' }, weight: 1, minY: 0, maxY: 255, size: 1, density: 1, kind: 'vein' }],
        byproducts: { Iron: ['Gold'] } },
    });
    const r = reachableDims(p.worldgen, prog, [], 1);
    const a = computeAvailability(p, { tier: 1, reachable: r.keys, lowGravity: false, coilHeat: 1801, excluded: new Set() });
    expect(a.classOf('gold@0')).toBe('byproduct');
    expect(a.sources('gold@0')).toEqual([{ kind: 'byproduct', dims: ['overworld'], detail: 'byproduct of Iron ore' }]);
  });
  it('never fires a recipe with a slot that accepts nothing', () => {
    // The loader keeps a crafting slot whose ore name lists no items, with no options (src/server/pack/recipes.ts).
    const p = packFromSpec({
      items: [{ key: 'log@0', name: 'Log' }, { key: 'plank@0', name: 'Plank' }, { key: 'widget@0', name: 'Widget' }, { key: 'gadget@0', name: 'Gadget' }],
      recipes: [
        { id: 'plank', map: 'crafting', in: [['log@0', 1]], out: [['plank@0', 4]] },
        { id: 'widget', map: 'crafting', in: [['log@0', 1], { any: [] }], out: [['widget@0', 1]] },
        { id: 'gadget', map: 'crafting', in: [{ any: [] }], out: [['gadget@0', 1]] },
      ],
    });
    const a = computeAvailability(p, { tier: 1, reachable: new Set(['overworld']), lowGravity: false, coilHeat: 1801, excluded: new Set() });
    expect(['log@0', 'plank@0', 'widget@0', 'gadget@0'].map((k) => a.classOf(k))).toEqual(['natural', 'derived', 'unavailable', 'unavailable']);
    expect(a.sources('widget@0')).toEqual([]);
  });
  it('knows base and natural items', () => {
    expect(['t:iron_dust@0', 't:iron_plate@0', 'fluid:oil', 'fluid:molten.iron', 'minecraft:cobblestone@0'].map((k) => isBaseItem(pack, k)))
      .toEqual([true, false, true, false, true]);
    expect(isNatural(pack, 'minecraft:log@0')).toBe(true);
    expect(isNatural(pack, 'minecraft:planks@0')).toBe(false);
  });
});

describe('unlockText', () => {
  it('names the first tier and the new dimension', () => {
    const from = { env: envAt(1), settings: defaultSettings(), visited: [] };
    expect(unlockText(pack, 't:titanium_ingot@0', from)).toBe('Titanium Ingot: needs Moon (T1 rocket) — reachable at HV');
    expect(unlockText(pack, 'fluid:oil', from)).toBe('Oil: needs MV machines');
    expect(unlockText(packFromSpec({ items: [{ key: 'x@0', name: 'Unobtainium', gt: { prefix: 'dust', material: 'Unobtainium' } }] }), 'x@0', from))
      .toBe('Unobtainium: no source in this pack\'s data');
  });
  it('names only the dimensions of seeds the group cannot reach yet', () => {
    const vein = (name: string, dims: string[], material: string) => ({
      name, dims, materials: { primary: material, secondary: material, between: material, sporadic: material },
      weight: 1, minY: 0, maxY: 255, size: 1, density: 1, kind: 'vein' as const,
    });
    const p = packFromSpec({
      items: [
        { key: 'iron@0', name: 'Iron Dust', gt: { prefix: 'dust', material: 'Iron' } }, { key: 'ti@0', name: 'Titanium Dust', gt: { prefix: 'dust', material: 'Titanium' } },
        { key: 'steel@0', name: 'Steel Thing' }, { key: 'alloy@0', name: 'Iron-Titanium Mix' },
      ],
      machines: [{ mteId: 1, name: 'Basic Mixer', maps: ['gt.recipe.mixer'], tier: 1 }, { mteId: 2, name: 'Advanced Mixer III', maps: ['gt.recipe.mixer'], tier: 3 }],
      recipes: [
        { id: 'steel', map: 'gt.recipe.mixer', in: [['iron@0', 1]], out: [['steel@0', 1]], eut: 480 },
        { id: 'alloy', map: 'gt.recipe.mixer', in: [['iron@0', 1], ['ti@0', 1]], out: [['alloy@0', 1]], eut: 16 },
      ],
      worldgen: {
        dimensions: [
          { key: 'overworld', id: 0, name: 'Overworld', mod: 'minecraft', kind: 'dimension', defaultTier: 0 },
          { key: 'moon', id: 28, name: 'Moon', mod: 'galacticraftcore', kind: 'moon', rocketTier: 1, defaultTier: 3 },
          { key: 'mars', id: 29, name: 'Mars', mod: 'galacticraftmars', kind: 'planet', rocketTier: 2, defaultTier: 3 },
        ],
        veins: [vein('ore.mix.iron', ['overworld', 'moon'], 'Iron'), vein('ore.mix.iron.mars', ['mars'], 'Iron'), vein('ore.mix.ilmenite', ['moon'], 'Titanium')],
      },
    });
    const r = reachableDims(p.worldgen, prog, [], 1);
    const env: PlanEnv = { tier: 1, reachable: r.keys, lowGravity: r.lowGravity, coilHeat: 1801, excluded: new Set() };
    expect(computeAvailability(p, env).classOf('iron@0')).toBe('direct');
    const from = { env, settings: defaultSettings(), visited: [] };
    expect(unlockText(p, 'steel@0', from)).toBe('Steel Thing: needs HV machines');
    expect(unlockText(p, 'alloy@0', from)).toBe('Iron-Titanium Mix: needs Moon (T1 rocket) — reachable at HV');
  });
});
