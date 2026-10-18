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
});
