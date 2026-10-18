// Mini-GT: the shared synthetic pack of the planner tests (Plan 2 Tasks 7–14 and 19; Plan 5 calls `miniGt()`).
// A tiny LV/MV GregTech world: iron, copper and tin from the overworld, redstone from the Nether, titanium from the Moon;
// two circuit recipes (LV and a cheaper MV one), an EBF recipe gated by coil heat, a lava centrifuge recipe the default
// exclusions drop, and the crafting recipes of three LV machines. Everything here is invented, nothing is game data.

import type { Pack } from '../../src/shared/types/pack.ts';
import { packFromSpec, type PackSpec } from './pack-spec.ts';

/** Half a dust or ingot in GT's material units: 1x wires and cables. */
const HALF = 1_814_400;

export const MINI_GT: PackSpec = {
  items: [
    { key: 't:iron_ore@0', name: 'Iron Ore', gt: { prefix: 'ore', material: 'Iron' } },
    { key: 't:iron_dust@0', name: 'Iron Dust', gt: { prefix: 'dust', material: 'Iron' } },
    { key: 't:iron_ingot@0', name: 'Iron Ingot', gt: { prefix: 'ingot', material: 'Iron' } },
    { key: 't:iron_plate@0', name: 'Iron Plate', gt: { prefix: 'plate', material: 'Iron' } },
    { key: 't:copper_ingot@0', name: 'Copper Ingot', gt: { prefix: 'ingot', material: 'Copper' } },
    { key: 't:copper_wire@0', name: '1x Copper Wire', gt: { prefix: 'wireGt01', material: 'Copper', amount: HALF } },
    { key: 't:tin_ingot@0', name: 'Tin Ingot', gt: { prefix: 'ingot', material: 'Tin' } },
    { key: 't:tin_cable@0', name: '1x Tin Cable', gt: { prefix: 'cableGt01', material: 'Tin', amount: HALF } },
    { key: 't:redstone@0', name: 'Redstone', gt: { prefix: 'dust', material: 'Redstone' } },
    { key: 't:titanium_dust@0', name: 'Titanium Dust', gt: { prefix: 'dust', material: 'Titanium' } },
    { key: 't:titanium_ingot@0', name: 'Titanium Ingot', gt: { prefix: 'ingot', material: 'Titanium' } },
    { key: 't:titanium_plate@0', name: 'Titanium Plate', gt: { prefix: 'plate', material: 'Titanium' } },
    { key: 't:circuit@0', name: 'Basic Circuit', oreDict: ['circuitBasic'] },
    // The real GT key, so Plan 1's loader derives the same `meta.circuit` from the e2e export.
    { key: 'gregtech:gt.integrated_circuit@2', name: 'Programmed Circuit' },
    { key: 't:hull_lv@0', name: 'LV Machine Hull' },
    { key: 'minecraft:log@0', name: 'Oak Wood' },
    { key: 'minecraft:planks@0', name: 'Oak Planks' },
    { key: 'minecraft:cobblestone@0', name: 'Cobblestone' },
  ],
  fluids: [
    { key: 'fluid:water', name: 'Water' },
    { key: 'fluid:lava', name: 'Lava' },
    { key: 'fluid:air', name: 'Air' },
    { key: 'fluid:molten.iron', name: 'Molten Iron' },
    { key: 'fluid:oil', name: 'Oil' },
  ],
  maps: [
    { id: 'gt.recipe.metalbender', name: 'Bending Machine' },
    { id: 'gt.recipe.wiremill', name: 'Wiremill' },
    { id: 'gt.recipe.assembler', name: 'Assembler' },
    { id: 'gt.recipe.fluidextractor', name: 'Fluid Extractor' },
    { id: 'gt.recipe.macerator', name: 'Macerator' },
    { id: 'gt.recipe.furnace', name: 'Electric Furnace' },
    { id: 'gt.recipe.centrifuge', name: 'Centrifuge' },
    { id: 'gt.recipe.blastfurnace', name: 'Blast Furnace', specialValue: 'heat' },
    { id: 'crafting', name: 'Crafting' },
    { id: 'furnace', name: 'Furnace' },
  ],
  machines: [
    { mteId: 101, name: 'Basic Bending Machine', maps: ['gt.recipe.metalbender'], tier: 1 },
    { mteId: 102, name: 'Advanced Bending Machine', maps: ['gt.recipe.metalbender'], tier: 2 },
    { mteId: 111, name: 'Basic Wiremill', maps: ['gt.recipe.wiremill'], tier: 1 },
    { mteId: 121, name: 'Basic Assembler', maps: ['gt.recipe.assembler'], tier: 1 },
    { mteId: 122, name: 'Advanced Assembler', maps: ['gt.recipe.assembler'], tier: 2 },
    { mteId: 131, name: 'Basic Fluid Extractor', maps: ['gt.recipe.fluidextractor'], tier: 1 },
    { mteId: 141, name: 'Basic Macerator', maps: ['gt.recipe.macerator'], tier: 1 },
    { mteId: 151, name: 'Basic Electric Furnace', maps: ['gt.recipe.furnace'], tier: 1 },
    { mteId: 161, name: 'Basic Centrifuge', maps: ['gt.recipe.centrifuge'], tier: 1 },
    // Ruling R1: lava-copper (80 EU/t) needs an MV centrifuge.
    { mteId: 162, name: 'Advanced Centrifuge', maps: ['gt.recipe.centrifuge'], tier: 2 },
    { mteId: 1000, name: 'Electric Blast Furnace', maps: ['gt.recipe.blastfurnace'], kind: 'multiblock', heatOC: true },
  ],
  recipes: [
    { id: 'bend-plate', map: 'gt.recipe.metalbender', in: [['t:iron_ingot@0', 1]], out: [['t:iron_plate@0', 1]], eut: 24, dur: 100 },
    { id: 'hammer-plate', map: 'crafting', in: [['t:iron_ingot@0', 2]], out: [['t:iron_plate@0', 1]] },
    { id: 'wire', map: 'gt.recipe.wiremill', in: [['t:copper_ingot@0', 1]], out: [['t:copper_wire@0', 2]], eut: 8, dur: 100 },
    { id: 'cable', map: 'crafting', in: [['t:tin_ingot@0', 1]], out: [['t:tin_cable@0', 2]] },
    {
      id: 'circuit-lv', map: 'gt.recipe.assembler',
      in: [['t:iron_plate@0', 1], ['t:copper_wire@0', 2], ['t:redstone@0', 1], { nc: 'gregtech:gt.integrated_circuit@2' }],
      out: [['t:circuit@0', 1]], eut: 16, dur: 200, meta: { circuit: 2 },
    },
    {
      id: 'circuit-mv', map: 'gt.recipe.assembler', in: [['t:copper_wire@0', 2], ['t:redstone@0', 1], ['fluid:molten.iron', 72]],
      out: [['t:circuit@0', 1]], eut: 120, dur: 100,
    },
    { id: 'extract-iron', map: 'gt.recipe.fluidextractor', in: [['t:iron_ingot@0', 1]], out: [['fluid:molten.iron', 144]], eut: 30, dur: 40 },
    { id: 'mace-ore', map: 'gt.recipe.macerator', in: [['t:iron_ore@0', 1]], out: [['t:iron_dust@0', 2]], eut: 2, dur: 400 },
    { id: 'smelt-e', map: 'gt.recipe.furnace', source: 'derived', in: [['t:iron_dust@0', 1]], out: [['t:iron_ingot@0', 1]], eut: 4, dur: 128 },
    { id: 'smelt-v', map: 'furnace', in: [['t:iron_dust@0', 1]], out: [['t:iron_ingot@0', 1]], eut: 0, dur: 200 },
    { id: 'lava-copper', map: 'gt.recipe.centrifuge', in: [['fluid:lava', 3600]], out: [['t:copper_ingot@0', 1, 0.1]], eut: 80, dur: 2880 },
    {
      id: 'ebf-ti', map: 'gt.recipe.blastfurnace', in: [['t:titanium_dust@0', 1]], out: [['t:titanium_ingot@0', 1]],
      eut: 480, dur: 1000, sv: 1941, meta: { coilHeat: 1941 },
    },
    { id: 'bend-ti', map: 'gt.recipe.metalbender', in: [['t:titanium_ingot@0', 1]], out: [['t:titanium_plate@0', 1]], eut: 120, dur: 200 },
    { id: 'planks', map: 'crafting', in: [['minecraft:log@0', 1]], out: [['minecraft:planks@0', 4]] },
    { id: 'hull-lv', map: 'crafting', in: [['t:iron_plate@0', 8], ['t:tin_cable@0', 2]], out: [['t:hull_lv@0', 1]] },
    { id: 'make-101', map: 'crafting', in: [['t:hull_lv@0', 1], ['t:circuit@0', 2], ['t:iron_plate@0', 2]], out: [['machine:101@0', 1]] },
    { id: 'make-111', map: 'crafting', in: [['t:hull_lv@0', 1], ['t:circuit@0', 2], ['t:copper_wire@0', 4]], out: [['machine:111@0', 1]] },
    { id: 'make-121', map: 'crafting', in: [['t:hull_lv@0', 1], ['t:circuit@0', 2], ['t:tin_cable@0', 2]], out: [['machine:121@0', 1]] },
  ],
  worldgen: {
    dimensions: [
      { key: 'overworld', id: 0, name: 'Overworld', mod: 'minecraft', kind: 'dimension', defaultTier: 0 },
      { key: 'nether', id: -1, name: 'Nether', mod: 'minecraft', kind: 'dimension', defaultTier: 0 },
      { key: 'moon', id: 28, name: 'Moon', mod: 'galacticraftcore', kind: 'moon', rocketTier: 1, defaultTier: 3 },
    ],
    veins: [
      { name: 'ore.mix.iron', dims: ['overworld'], materials: { primary: 'Iron', secondary: 'Iron', between: 'Tin', sporadic: 'Copper' },
        weight: 100, minY: 10, maxY: 60, size: 32, density: 3, kind: 'vein' },
      { name: 'ore.mix.redstone', dims: ['nether'], materials: { primary: 'Redstone', secondary: 'Redstone', between: 'Redstone', sporadic: 'Redstone' },
        weight: 100, minY: 5, maxY: 40, size: 24, density: 2, kind: 'vein' },
      { name: 'ore.mix.ilmenite', dims: ['moon'], materials: { primary: 'Titanium', secondary: 'Titanium', between: 'Iron', sporadic: 'Titanium' },
        weight: 100, minY: 10, maxY: 50, size: 32, density: 3, kind: 'vein' },
    ],
    fluidSources: [{ fluid: 'fluid:oil', dims: ['overworld'], kind: 'underground', minTier: 2 }],
    capabilities: [],
    byproducts: { Iron: ['Tin'] },
  },
};

/** A fresh Mini-GT pack; every call is independent of the others (the spec is copied, so no pack shares its arrays). */
export function miniGt(): Pack {
  return packFromSpec(structuredClone(MINI_GT));
}
