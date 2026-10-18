// The shared synthetic export of the pack, CLI and export tests: a few items, maps and recipes of every kind plus a
// small worldgen. Tests that need special cases build their own small specs inline instead of changing this one.

import type { ExportSpec } from './make-export.ts';

/** Keys and MTE ids of the sample. The written book (item 17) needs nbtHash, so tests build its key themselves. */
export const SAMPLE = {
  ironIngot: 'minecraft:iron_ingot@0',
  ironDust: 'gregtech:gt.metaitem.01@2032',
  ironOre: 'gregtech:gt.blockores@32',
  nickelDust: 'gregtech:gt.metaitem.01@2034',
  steelIngot: 'gregtech:gt.metaitem.01@11305',
  circuit: 'gregtech:gt.integrated_circuit@1',
  oakPlanks: 'minecraft:planks@0',
  sprucePlanks: 'minecraft:planks@1',
  craftingTable: 'minecraft:crafting_table@0',
  stick: 'minecraft:stick@0',
  goodCircuit: 'gregtech:gt.metaitem.01@32702',
  potato: 'minecraft:potato@0',
  bakedPotato: 'minecraft:baked_potato@0',
  battery: 'examplemod:battery@0',
  oxygen: 'fluid:oxygen',
  moltenIron: 'fluid:molten.iron',
  ebf: 1000, macerator: 50, eFurnace: 60, turbine: 1120, cable: 1246, assemblyLine: 1170,
} as const;

const BASIC_MACHINE = 'gregtech.api.metatileentity.implementations.MTEBasicMachineWithRecipe';
const M = 3628800;   // GT material units in one dust or ingot

/** A new spec on every call, so a test may change it freely. */
export function sampleExportSpec(): ExportSpec {
  return {
    manifest: { nameFailures: 1, nameFailureSamples: ['examplemod:broken@0'] },
    items: [
      { id: 'minecraft:iron_ingot', m: 0, dn: 'Iron Ingot', od: ['ingotIron'], gtPrefix: 'ingot', gtMat: 'Iron', gtAmt: M }, // 0
      { id: 'gregtech:gt.metaitem.01', m: 2032, dn: 'Iron Dust', od: ['dustIron'], gtPrefix: 'dust', gtMat: 'Iron', gtAmt: M }, // 1
      { id: 'gregtech:gt.blockores', m: 32, dn: 'Iron Ore', od: ['oreIron'], gtPrefix: 'ore', gtMat: 'Iron', gtAmt: M }, // 2
      { id: 'gregtech:gt.metaitem.01', m: 2034, dn: 'Nickel Dust', od: ['dustNickel'], gtPrefix: 'dust', gtMat: 'Nickel', gtAmt: M }, // 3
      { id: 'gregtech:gt.metaitem.01', m: 11305, dn: 'Steel Ingot', od: ['ingotSteel'], gtPrefix: 'ingot', gtMat: 'Steel', gtAmt: M }, // 4
      { id: 'gregtech:gt.integrated_circuit', m: 1, dn: 'Programmed Circuit' }, // 5
      { id: 'minecraft:planks', m: 0, dn: 'Oak Wood Planks', od: ['plankWood'] }, // 6
      { id: 'minecraft:planks', m: 1, dn: 'Spruce Wood Planks', od: ['plankWood'] }, // 7
      { id: 'minecraft:planks', m: 32767, dn: null }, // 8: wildcard
      { id: 'minecraft:crafting_table', m: 0, dn: 'Crafting Table' }, // 9
      { id: 'minecraft:stick', m: 0, dn: 'Stick', od: ['stickWood'] }, // 10
      { id: 'gregtech:gt.blockmachines', m: 1000, dn: 'Electric Blast Furnace' }, // 11
      { id: 'gregtech:gt.blockmachines', m: 50, dn: 'Basic Macerator' }, // 12
      { id: 'gregtech:gt.blockmachines', m: 60, dn: 'Basic Electric Furnace' }, // 13
      { id: 'gregtech:gt.blockmachines', m: 1120, dn: 'Basic Steam Turbine' }, // 14
      { id: 'gregtech:gt.blockmachines', m: 1246, dn: '1x Tin Cable' }, // 15
      { id: 'gregtech:gt.metaitem.01', m: 32702, dn: 'Good Electronic Circuit', od: ['circuitGood'] }, // 16
      { id: 'minecraft:written_book', m: 0, nbt: '{title:"Data"}', dn: 'Written Book' }, // 17
      { id: 'examplemod:broken', m: 0, dn: null, un: 'item.broken' }, // 18: its English name failed
      { id: 'gregtech:gt.metatool.01', m: 12, dn: 'Hard Hammer', od: ['craftingToolHardHammer'] }, // 19
      { id: 'minecraft:potato', m: 0, dn: 'Potato' }, // 20
      { id: 'minecraft:baked_potato', m: 0, dn: 'Baked Potato' }, // 21
      { id: 'gregtech:gt.metaitem.01', m: 30013, dn: 'Oxygen Cell' }, // 22
      { id: 'gregtech:gt.metaitem.01', m: 32405, dn: 'Empty Cell' }, // 23
      { id: 'examplemod:battery', m: 0, dn: 'Test Battery', electric: { maxCharge: 100000, tier: 1, canProvideEnergy: true } }, // 24
    ],
    fluids: [
      { id: 'water', dn: 'Water', temp: 300, gas: false },
      { id: 'molten.iron', dn: 'Molten Iron', temp: 1811, gas: false },
      { id: 'oxygen', dn: 'Oxygen', temp: 295, gas: true },
      { id: 'steam', dn: 'Steam', temp: 373, gas: true },
      { id: 'oil', dn: 'Oil', temp: 295, gas: false },
      { id: 'helium-3', dn: 'Helium-3', temp: 295, gas: true },
      { id: 'hydrogen', dn: 'Hydrogen', temp: 295, gas: true },
      { id: 'chlorobenzene', dn: 'Chlorobenzene', temp: 295, gas: false },
      { id: 'netherair', dn: 'Nether Air', temp: 295, gas: true },
      { id: 'air', dn: 'Air', temp: 295, gas: true },
      { id: 'mystery', dn: null, un: 'fluid.mystery', temp: 295, gas: false },
    ],
    fluidContainers: [{ container: 22, empty: 23, fluid: 'oxygen', amount: 1000 }],
    oreDict: [
      { ore: 'ingotIron', items: [0] },
      { ore: 'dustIron', items: [1] },
      { ore: 'oreIron', items: [2] },
      { ore: 'dustNickel', items: [3] },
      { ore: 'ingotSteel', items: [4] },
      { ore: 'plankWood', items: [8] },
      { ore: 'stickWood', items: [10] },
      { ore: 'circuitGood', items: [16] },
      { ore: 'craftingToolHardHammer', items: [19] },
    ],
    recipeMaps: [
      { id: 'gt.recipe.macerator', dn: 'Pulverization', amps: 1, cats: ['gt.recipe.macerator', 'gt.recipe.category.macerator_recycling'] }, // 0
      { id: 'gt.recipe.blastfurnace', dn: 'Blast Furnace', amps: 1, svFormatter: 'gregtech.nei.formatter.HeatingCoilSpecialValueFormatter' }, // 1
      { id: 'gt.recipe.centrifuge', dn: 'Centrifuge', amps: 1 }, // 2
      { id: 'gt.recipe.centrifugeNonCell', dn: 'Centrifuge (no cells)', amps: 1 }, // 3
      { id: 'gt.recipe.furnace', dn: 'Furnace', amps: 1, dynamic: 'overwrite' }, // 4
      { id: 'gt.recipe.microwave', dn: 'Microwave', amps: 1, dynamic: 'overwrite' }, // 5
      { id: 'gt.recipe.circuitassembler', dn: 'Circuit Assembler', amps: 1 }, // 6
      { id: 'gtpp.recipe.testalias', dn: 'Alias Test', amps: 1 }, // 7
      { id: 'gt.recipe.fakeAssemblylineProcess', dn: 'Assembly Line', amps: 1 }, // 8
      { id: 'gt.recipe.thermalcentrifuge', dn: 'Thermal Centrifuge', amps: 2 }, // 9
      { id: 'gt.recipe.rockbreakerfakerecipes', dn: 'Rock Breaker', amps: 1 }, // 10
    ],
    recipesGt: [
      { map: 0, in: [[2, 1]], out: [[1, 2], [3, 1, 1000]], fin: [], fout: [], eut: 2, dur: 400 }, // G1
      { map: 1, in: [[1, 1], [5, 0]], out: [[4, 1]], fin: [['oxygen', 1000]], fout: [], eut: 120, dur: 1000, sv: 1000, meta: { coil_heat: 1000 } }, // G2
      { map: 2, in: [[1, 1]], out: [[3, 1, 500]], fin: [], fout: [['oxygen', 100, 5000]], eut: 5, dur: 100 }, // G3
      { map: 3, in: [[1, 1]], out: [[3, 1, 500]], fin: [], fout: [['oxygen', 100, 5000]], eut: 5, dur: 100 }, // G4 = G3 in another map
      { map: 6, in: [[4, 1], [10, 2]], inAlt: [[[4, 1], [0, 1]], null], out: [[16, 1]], fin: [['molten.iron', 144]], fout: [], eut: 30, dur: 200, meta: { cleanroom: true } }, // G5
      { map: 0, in: [[4, 1]], out: [[1, 1]], fin: [], fout: [], eut: 2, dur: 100, cat: 'gt.recipe.category.macerator_recycling', meta: { recycle: true } }, // G6
      { map: 0, in: [[0, 1]], out: [[1, 1]], fin: [], fout: [], eut: 2, dur: 100, disabled: true }, // G7
      { map: 10, in: [], out: [[2, 1]], fin: [], fout: [], eut: 30, dur: 16, fake: true }, // G8
      { map: 7, in: [[3, 1]], out: [[1, 1]], fin: [], fout: [], eut: 30, dur: 20 }, // G9
      { map: 9, in: [[2, 1]], out: [[1, 1], [3, 1]], fin: [], fout: [], eut: 48, dur: 500 }, // G10
    ],
    recipesAssemblyLine: [
      { research: 16, researchTime: 3600, researchVoltage: 30720, in: [[4, 4], [16, 1]], fin: [['molten.iron', 576]], out: [11, 1], eut: 7680, dur: 600 },
    ],
    recipesCrafting: [
      { cls: 'net.minecraftforge.oredict.ShapedOreRecipe', shape: 'shaped', w: 2, h: 2, in: [{ ore: 'plankWood' }, { ore: 'plankWood' }, { ore: 'plankWood' }, { ore: 'plankWood' }], out: [9, 1] }, // C1
      { cls: 'net.minecraft.item.crafting.ShapelessRecipes', shape: 'shapeless', in: [8, 8], out: [10, 4] }, // C2
      { cls: 'gregtech.api.util.GTShapelessRecipe', shape: 'shapeless', in: [{ ore: 'craftingToolHardHammer' }, 2], out: [1, 1] }, // C3
      { cls: 'example.DynamicRecipe', shape: 'opaque', out: [17, 1] }, // C4
    ],
    recipesFurnace: [
      { in: 1, out: [0, 1], xp: 0.7, ef: [0, 1] }, // F1: no mw, iron is a metal
      { in: 20, out: [21, 1], xp: 0.35, ef: [21, 1], mw: [21, 1] }, // F2
      { in: 2, out: [0, 1], xp: 0.7, ef: [0, 1] }, // F3
    ],
    machines: [
      { id: 1000, name: 'multimachine.blastfurnace', cls: 'gregtech.common.tileentities.machines.multi.MTEElectricBlastFurnace', dn: 'Electric Blast Furnace', item: 11, kind: 'multiblock', maps: ['gt.recipe.blastfurnace'], heatOC: true },
      { id: 50, name: 'basicmachine.macerator.tier.01', cls: BASIC_MACHINE, dn: 'Basic Macerator', item: 12, kind: 'basic', tier: 1, voltage: 32, amps: 1, maps: ['gt.recipe.macerator'] },
      { id: 60, name: 'basicmachine.e_furnace.tier.01', cls: BASIC_MACHINE, dn: 'Basic Electric Furnace', item: 13, kind: 'basic', tier: 1, voltage: 32, amps: 1, maps: ['gt.recipe.furnace'] },
      { id: 1120, name: 'basicgenerator.steamturbine.tier.01', cls: 'gregtech.common.tileentities.generators.MTESteamTurbine', dn: 'Basic Steam Turbine', item: 14, kind: 'turbine', tier: 1, voltage: 32, turbineEfficiency: 0.428571 },
      { id: 1246, name: 'wire.tin.01', cls: 'gregtech.api.metatileentity.implementations.MTECable', dn: '1x Tin Cable', item: 15, kind: 'cable', cable: { voltage: 32, amps: 1, lossPerBlock: 1, insulated: true, material: 'Tin' } },
      { id: 1170, name: 'multimachine.assemblyline', cls: 'gregtech.common.tileentities.machines.multi.MTEAssemblyLine', dn: 'Assembling Line', item: null, kind: 'multiblock', maps: ['gt.recipe.fakeAssemblylineProcess'] },
    ],
    structures: [
      { id: 1000, size: [3, 4, 3], controller: [1, 0, 0], palette: [{ id: 'gregtech:gt.blockcasings', meta: 11 }, { id: 'gregtech:gt.blockmachines', meta: 0, mte: 1000 }], blocks: [[0, 0, 0, 0], [1, 0, 0, 1], [2, 0, 0, 0]], air: [] },
    ],
    materials: [
      { name: 'Iron', dn: 'Iron', rgba: [200, 200, 200, 0], iconSet: 'METALLIC', byproducts: ['Nickel', 'Tin'] },
      { name: 'Nickel', rgba: [200, 200, 250, 0], iconSet: 'METALLIC', byproducts: ['Iron'] },
      { name: 'Tin', rgba: [220, 220, 220, 0], iconSet: 'DULL', byproducts: [] },
      { name: 'Steel', rgba: [128, 128, 128, 0], iconSet: 'METALLIC', byproducts: [] },
    ],
    oreMaterials: [
      { key: 'gt:Iron', family: 'gt', name: 'Iron', id: 32, byproducts: ['gt:Nickel', 'gt:Tin'], parts: { ore: 2, dust: 1, ingot: 0 } },
      { key: 'gt:Nickel', family: 'gt', name: 'Nickel', id: 34, byproducts: ['gt:Iron'], parts: { dust: 3 } },
      { key: 'bw:Prasiolite', family: 'bw', name: 'Prasiolite', id: 10106, dn: 'Prasiolite', rgba: [156, 177, 94, 0], iconSet: 'GEM_VERTICAL', byproducts: [], parts: {} },
    ],
    dimensions: [
      { id: 0, provider: 'net.minecraft.world.WorldProviderSurface', name: 'Overworld', display: 'Overworld', mod: 'minecraft', ore: { type: 'Planet', veinChance: 100, voidMinable: true }, airIntake: 'air' },
      { id: -1, provider: 'net.minecraft.world.WorldProviderHell', name: 'Nether', display: 'Nether', mod: 'minecraft', ore: { type: 'Planet', veinChance: 100, voidMinable: true }, airIntake: 'netherair' },
      { id: 1, provider: 'net.minecraft.world.WorldProviderEnd', name: 'The End', display: 'The End', mod: 'minecraft', ore: { type: 'Planet', veinChance: 100, voidMinable: true }, airIntake: 'air' },
      { id: 28, provider: 'micdoodle8.mods.galacticraft.core.dimension.WorldProviderMoon', name: 'moon', display: 'Moon', mod: 'GalacticraftCore', ore: { type: 'Planet', veinChance: 100, voidMinable: true }, body: 'moon', airIntake: 'air' },
      { id: null, name: 'EndAsteroid', ore: { type: 'Asteroid', voidMinable: true } },
      { id: 100, provider: 'com.rwtema.extrautils.worldgen.Underdark.WorldProviderUnderdark', name: 'Underdark', display: 'Deep Dark', mod: 'ExtraUtilities', ore: { type: 'Planet', voidMinable: true }, airIntake: 'air' },
      { id: 55, provider: 'com.emoniph.witchery.dimension.WorldProviderDreamWorld', name: 'Spirit World', display: 'Spirit World', mod: 'witchery', airIntake: 'air' },
    ],
    celestial: [
      { name: 'overworld', display: 'Overworld', kind: 'planet', parent: 'sol', tier: 0, dim: 0, reachable: true },
      { name: 'moon', display: 'Moon', kind: 'moon', parent: 'overworld', tier: 1, dim: 28, reachable: true },
      { name: 'jupiter', display: 'Jupiter', kind: 'planet', parent: 'sol', tier: 3, dim: 71, reachable: false },
      { name: 'spacestation.overworld', display: 'Overworld Space Station', kind: 'satellite', parent: 'overworld', tier: 1, dim: null, reachable: true },
      { name: 'spacestation.jupiter', display: 'Jupiter Space Station', kind: 'satellite', parent: 'jupiter', tier: 3, dim: null, reachable: true },
    ],
    oreVeins: [
      { name: 'ore.mix.iron', weight: 80, density: 3, size: 24, dims: ['Overworld', 'moon'], yByDim: { Overworld: [10, 40], moon: [20, 60] }, primary: 'gt:Iron', secondary: 'gt:Iron', between: 'gt:Nickel', sporadic: 'gt:Nickel', stoneSpecific: false },
      { name: 'ore.mix.prasiolite', weight: 30, density: 2, size: 16, dims: ['EndAsteroid'], yByDim: { EndAsteroid: [0, 255] }, primary: 'bw:Prasiolite', secondary: 'bw:Prasiolite', between: 'bw:Prasiolite', sporadic: 'bw:Prasiolite', stoneSpecific: false },
    ],
    smallOres: [{ name: 'ore.small.nickel', amount: 16, y: [5, 120], dims: ['Nether'], material: 'gt:Nickel' }],
    undergroundFluids: [
      { key: '0', dims: [0], fluids: [{ fluid: 'oil', chance: 20, min: 200, max: 625, decrease: 5 }] },
      { key: 'Moon', dims: [28], fluids: [{ fluid: 'helium-3', chance: 83, min: 50, max: 100, decrease: 1 }] },
    ],
    voidMiner: [
      { dim: 'moon', drops: [{ item: 2, weight: 80 }], extra: [] },
      { dim: 'Underdark', drops: [{ item: 2, weight: 1 }], extra: [] },
    ],
    gasSiphon: [{ planet: 'jupiter', tier: 3, depths: [[1, 'hydrogen', 15000]] }],
    spacePump: [{ planetType: 2, gasType: 1, fluid: 'chlorobenzene', amount: 896000 }],
    spaceAsteroids: [{ name: 'Iron asteroid', outputs: [1, 3], chances: [7000, 3000], moduleTier: 1, droneTiers: [0, 3], distance: [10, 50], weight: 100 }],
  };
}
