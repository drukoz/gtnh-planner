import { describe, it, expect } from 'vitest';
import { machineByMteId } from '../../../src/server/pack/lookup.ts';
import { packFromSpec } from '../../helpers/pack-spec.ts';

describe('packFromSpec', () => {
  it('fills the loader conventions as defaults', () => {
    const p = packFromSpec({
      items: [{ key: 't:dust@0', name: 'Iron Dust', oreDict: ['dustIron'], gt: { prefix: 'dust', material: 'Iron' } }],
      maps: [{ id: 'crafting' }, { id: 'gt.recipe.mixer', amps: 2 }],
      machines: [{ mteId: 7, name: 'Mixer', maps: ['gt.recipe.mixer'], tier: 2 }, { mteId: 3, name: 'Cheap Mixer', maps: ['gt.recipe.mixer'], tier: 1 }],
      recipes: [
        { map: 'crafting', in: [['t:dust@0', 1], { nc: 't:hammer@0' }], out: [['t:plate@0', 1]] },
        { map: 'furnace', in: [['t:dust@0', 1]], out: [['t:ingot@0', 1]] },
        { id: 'mix', map: 'gt.recipe.mixer', in: [['t:dust@0', 2, 0.5], ['fluid:water', 1000], { any: [['fluid:molten.iron', 144], ['fluid:steam', 100]] }],
          out: [['t:ingot@0', 1, 0.25]] },
      ],
      materials: ['Copper'],
      worldgen: { byproducts: { Iron: ['Tin'] } },
    });
    expect(p.manifest.exportId).toBe('test');
    expect([...p.maps.keys()]).toEqual(['crafting', 'gt.recipe.mixer']);
    expect(p.maps.get('crafting')).toMatchObject({ name: 'Crafting Table', amps: 0, specialValue: 'none' });
    expect(p.machinesByMap.get('gt.recipe.mixer')).toEqual([3, 7]);
    expect(machineByMteId(p, 7)).toMatchObject({ itemKey: 'machine:7@0', kind: 'basic', tier: 2, voltage: 128 });
    expect(machineByMteId(p, 7)?.amps).toBeUndefined();

    const [craft, smelt, mix] = [p.recipes[0]!, p.recipes[1]!, p.recipes[2]!];
    expect(craft).toMatchObject({ id: 'r1', source: 'crafting', euPerTick: 0, durationTicks: 0, amps: 0 });
    expect(craft.inputs[1]).toEqual({ slot: 1, consumed: false, chance: 0, options: [{ key: 't:hammer@0', amount: 1 }] });
    expect(smelt).toMatchObject({ id: 'r2', source: 'furnace', durationTicks: 200, amps: 0 });
    expect(mix).toMatchObject({ source: 'gt', euPerTick: 0, durationTicks: 20, amps: 1, specialValue: 0 });
    expect(mix.inputs.map((i) => [i.slot, i.consumed, i.chance, i.options.length])).toEqual([[0, true, 0.5, 1], [100, true, 1, 1], [101, true, 1, 2]]);
    expect(mix.outputs).toEqual([{ key: 't:ingot@0', amount: 1, chance: 0.25 }]);
    expect(p.recipeById.get('mix')).toBe(mix);
    expect(p.producers.get('t:ingot@0')).toEqual([1, 2]);
    expect(p.consumers.get('t:hammer@0')).toEqual([0]);

    expect(p.items.get('t:plate@0')).toEqual({ key: 't:plate@0', id: 't:plate', meta: 0, name: 't:plate@0', oreDict: [] });
    expect(p.items.get('t:dust@0')?.gt).toEqual({ prefix: 'dust', material: 'Iron', amount: 3628800 });
    expect(p.fluids.get('fluid:molten.iron')).toEqual({ key: 'fluid:molten.iron', id: 'molten.iron', name: 'fluid:molten.iron', temperature: 300, gas: false, molten: true });
    expect(p.fluids.get('fluid:water')?.molten).toBe(false);
    expect(p.oreDict.get('dustIron')).toEqual(['t:dust@0']);
    expect([...p.materials.keys()]).toEqual(['Copper', 'Iron']);
    expect(p.materials.get('Iron')?.oreByproducts).toEqual(['Tin']);
    expect(p.worldgen.dimensions).toEqual([{ key: 'overworld', id: 0, name: 'Overworld', mod: 'minecraft', kind: 'dimension', defaultTier: 0 }]);
    expect(p.nameOf('t:dust@0')).toBe('Iron Dust');
    expect(p.nameOf('nothing@0')).toBe('nothing@0');
  });
  it('refuses an id declared twice', () => {
    expect(() => packFromSpec({ recipes: [{ id: 'x', map: 'm' }, { id: 'x', map: 'm' }] })).toThrow(/declared twice/);
  });
});
