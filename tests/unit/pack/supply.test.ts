// Supply recipes (plan 09 Task 3; fix spec R2): the loader turns the rock breaker's display-only recipes into real ones,
// gives the pump machines a pseudo map with water and lava recipes, and flags the compressor that fills cells with air.

import { describe, it, expect } from 'vitest';
import { deriveSupply, SUPPLY_PUMP_MAP } from '../../../src/server/pack/supply.ts';
import { nbtHash, recipeId } from '../../../src/server/pack/recipe-id.ts';
import { machineByMteId } from '../../../src/server/pack/lookup.ts';
import { gtMachineId } from '../../../src/shared/ids.ts';
import { itemKey } from '../../../src/shared/keys.ts';
import type { Ingredient, Machine, Recipe, RecipeMapInfo } from '../../../src/shared/types/pack.ts';
import { makePack } from '../../helpers/make-pack.ts';

const ROCK_BREAKER = 'gt.recipe.rockbreaker';
const DISPLAY = 'gregtech:gt.metaitem.02@32765#abcdefabcdef';
const COBBLE = 'minecraft:cobblestone@0';
const PUMP_CLS = 'gregtech.common.tileentities.machines.basic.MTEPump';

function recipe(p: Partial<Recipe> & Pick<Recipe, 'id'>): Recipe {
  return { source: 'gt', maps: [ROCK_BREAKER], inputs: [], outputs: [], euPerTick: 30, durationTicks: 16, amps: 1, specialValue: 0, meta: {}, flags: {}, ...p };
}
/** One slot of one option; not consumed means held by the machine (chance 0). */
function slot(key: string, slotNo = 0, consumed = true, amount = 1): Ingredient {
  return { slot: slotNo, consumed, chance: consumed ? 1 : 0, options: [{ key, amount }] };
}
function machine(mteId: number, cls: string, maps: string[] = []): Machine {
  return { id: gtMachineId(mteId), mteId, metaName: `m.${mteId}`, name: `Machine ${mteId}`, cls, itemKey: `machine:${mteId}@0`, kind: 'basic', tier: 1, voltage: 32, maps };
}
const MAPS: ReadonlyMap<string, RecipeMapInfo> = new Map([[ROCK_BREAKER, { id: ROCK_BREAKER, name: 'Rock Breaker', amps: 1, specialValue: 'none', aliases: [] }]]);
/** The id `recipeId` gives a recipe's content. */
const contentId = (r: Recipe): string => recipeId({
  source: r.source, inputs: r.inputs, outputs: r.outputs, euPerTick: r.euPerTick, durationTicks: r.durationTicks,
  specialValue: r.specialValue, meta: r.meta, category: r.category, fake: r.flags.fake,
});

describe('deriveSupply', () => {
  it('turns the display-only rock breaker recipes into real ones', () => {
    const lavaOnSide = recipe({ id: 'fake-cobble', inputs: [slot(DISPLAY)], outputs: [{ key: COBBLE, amount: 1, chance: 1 }], flags: { fake: true } });
    const obsidian = recipe({
      id: 'fake-obsidian', inputs: [slot('minecraft:redstone@0')], outputs: [{ key: 'minecraft:obsidian@0', amount: 1, chance: 1 }],
      durationTicks: 128, flags: { fake: true },
    });
    const input = { recipes: [lavaOnSide, obsidian], machines: new Map<number, Machine>(), maps: MAPS, fluidContainers: [] };
    const out = deriveSupply(input);
    expect(out.recipes).toHaveLength(1);
    const made = out.recipes[0]!;
    expect(made).toMatchObject({
      source: 'derived', maps: [ROCK_BREAKER], inputs: [], outputs: [{ key: COBBLE, amount: 1, chance: 1 }],
      euPerTick: 30, durationTicks: 16, amps: 1, meta: { supply: 'rock-breaker' },
    });
    expect(made.flags.fake).toBeUndefined();
    expect(made.id).toBe(contentId(made));
    expect(deriveSupply(input).recipes.map((r) => r.id)).toEqual([made.id]);
    // Pure: the fake recipe stays as it was, and nothing else is made or flagged.
    expect(lavaOnSide.flags.fake).toBe(true);
    expect([out.pumpMap, out.pumpMachines, out.flagged]).toEqual([null, [], []]);
  });

  it('keeps the other inputs of a display-only rock breaker recipe', () => {
    const lavaOnTop = recipe({
      id: 'fake-stone', inputs: [slot(DISPLAY), slot('gregtech:gt.integrated_circuit@1', 1, false)],
      outputs: [{ key: 'minecraft:stone@0', amount: 1, chance: 1 }], flags: { fake: true },
    });
    const [made] = deriveSupply({ recipes: [lavaOnTop], machines: new Map(), maps: MAPS, fluidContainers: [] }).recipes;
    expect(made?.inputs).toEqual([slot('gregtech:gt.integrated_circuit@1', 1, false)]);
    expect(made?.meta.supply).toBe('rock-breaker');
  });

  it('adds the pump map, pump machines and water and lava recipes', () => {
    const machines = new Map([[1140, machine(1140, PUMP_CLS)], [441, machine(441, 'gregtech.common.tileentities.machines.basic.MTERockBreaker', [ROCK_BREAKER])]]);
    const out = deriveSupply({ recipes: [], machines, maps: MAPS, fluidContainers: [] });
    expect(SUPPLY_PUMP_MAP).toBe('pump');
    expect(out.pumpMap).toEqual({ id: 'pump', name: 'Pump', amps: 1, specialValue: 'none', aliases: [] });
    expect(out.pumpMachines).toEqual([1140]);
    expect(out.recipes.map((r) => [r.outputs, r.inputs, r.euPerTick, r.durationTicks, r.maps, r.meta.supply, r.source])).toEqual([
      [[{ key: 'fluid:water', amount: 1000, chance: 1 }], [], 8, 80, ['pump'], 'pump', 'derived'],
      [[{ key: 'fluid:lava', amount: 1000, chance: 1 }], [], 8, 80, ['pump'], 'pump', 'derived'],
    ]);
    for (const r of out.recipes) expect(r.id).toBe(contentId(r));
    expect(machines.get(1140)?.maps).toEqual([]);   // pure: the caller adds the map
    const without = deriveSupply({ recipes: [], machines: new Map([[441, machine(441, 'gregtech.common.tileentities.machines.basic.MTERockBreaker')]]), maps: MAPS, fluidContainers: [] });
    expect([without.pumpMap, without.pumpMachines, without.recipes]).toEqual([null, [], []]);
  });

  it('flags the compressor that fills an empty cell with air', () => {
    const compress = recipe({ id: 'compress-air', maps: ['gt.recipe.compressor'], inputs: [slot('t:empty_cell@0')], outputs: [{ key: 't:air_cell@0', amount: 1, chance: 1 }], euPerTick: 2, durationTicks: 300 });
    const release = recipe({
      id: 'release-air', maps: ['gt.recipe.canner'], inputs: [slot('t:air_cell@0')],
      outputs: [{ key: 't:empty_cell@0', amount: 1, chance: 1 }, { key: 'fluid:air', amount: 2000, chance: 1 }], euPerTick: 2,
    });
    const oxygen = recipe({ id: 'compress-oxygen', maps: ['gt.recipe.compressor'], inputs: [slot('t:empty_cell@0')], outputs: [{ key: 't:oxygen_cell@0', amount: 1, chance: 1 }], euPerTick: 2 });
    const fluidContainers = [
      { container: 't:air_cell@0', empty: 't:empty_cell@0', fluid: 'fluid:air', amount: 2000 },
      { container: 't:oxygen_cell@0', empty: 't:empty_cell@0', fluid: 'fluid:oxygen', amount: 1000 },
    ];
    const out = deriveSupply({ recipes: [compress, release, oxygen], machines: new Map(), maps: MAPS, fluidContainers });
    expect(out.flagged).toEqual(['compress-air']);
    expect(out.recipes).toEqual([]);
    expect(compress.meta.supply).toBeUndefined();   // the caller marks it
  });
});

describe('the loader', () => {
  it('adds the supply recipes, the pump map and the compressor flag before it builds the indices', async () => {
    const lavaOnSide = '{display:{Name:"IT\'S FREE! Place Lava on Side"}}';
    const pack = await makePack({
      items: [
        { id: 'minecraft:cobblestone', m: 0, dn: 'Cobblestone' },
        { id: 'gregtech:gt.metaitem.02', m: 32765, nbt: lavaOnSide, dn: 'IT\'S FREE! Place Lava on Side' },
        { id: 'IC2:itemCellEmpty', m: 0, dn: 'Empty Cell' },
        { id: 'IC2:itemCellAir', m: 0, dn: 'Compressed Air Cell' },
      ],
      fluids: [{ id: 'water', temp: 300, gas: false }, { id: 'lava', temp: 1300, gas: false }, { id: 'air', temp: 300, gas: true }],
      fluidContainers: [{ container: 3, empty: 2, fluid: 'air', amount: 2000 }],
      recipeMaps: [{ id: ROCK_BREAKER, dn: 'Rock Breaker', amps: 1 }, { id: 'gt.recipe.compressor', dn: 'Compressor', amps: 1 }],
      recipesGt: [
        { map: 0, in: [[1, 1]], out: [[0, 1]], fin: [], fout: [], eut: 30, dur: 16, fake: true },
        { map: 1, in: [[2, 1]], out: [[3, 1]], fin: [], fout: [], eut: 2, dur: 300 },
      ],
      machines: [
        { id: 441, name: 'basicmachine.rockbreaker.tier.01', cls: 'gregtech.common.tileentities.machines.basic.MTERockBreaker', dn: 'Basic Rock Breaker', item: null, kind: 'basic', tier: 1, voltage: 32, amps: 1, maps: [ROCK_BREAKER] },
        { id: 1140, name: 'basicmachine.pump.tier.01', cls: PUMP_CLS, dn: 'Basic Pump', item: null, kind: 'basic', tier: 1, voltage: 32, amps: 1 },
      ],
    });
    const display = itemKey('gregtech:gt.metaitem.02', 32765, nbtHash(lavaOnSide));
    const fake = pack.recipes.find((r) => r.flags.fake === true);
    expect(fake?.inputs[0]?.options[0]?.key).toBe(display);
    const supplied = (kind: string) => pack.recipes.filter((r) => r.meta.supply === kind);
    expect(supplied('rock-breaker').map((r) => [r.outputs[0]?.key, r.inputs.length, r.source])).toEqual([[COBBLE, 0, 'derived']]);
    expect(supplied('pump').map((r) => r.outputs[0]?.key)).toEqual(['fluid:water', 'fluid:lava']);
    for (const r of [...supplied('rock-breaker'), ...supplied('pump')]) {
      expect(pack.recipeById.get(r.id)).toBe(r);
      expect(pack.producers.get(r.outputs[0]!.key)).toContain(pack.recipes.indexOf(r));
    }
    // The compressor keeps the id of its content without the flag (ruling P20), so stored pins still find it.
    const [compressor] = supplied('compressor');
    expect(compressor?.outputs[0]?.key).toBe('IC2:itemCellAir@0');
    const { supply: _flag, ...meta } = compressor!.meta;
    expect(contentId({ ...compressor!, meta })).toBe(compressor!.id);
    expect(pack.maps.get('pump')).toEqual({ id: 'pump', name: 'Pump', amps: 1, specialValue: 'none', aliases: [] });
    expect(machineByMteId(pack, 1140)?.maps).toEqual(['pump']);
    expect(pack.machinesByMap.get('pump')).toEqual([1140]);
  });
});
