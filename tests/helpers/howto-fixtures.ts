// Synthetic fixtures of add-on 14's tests (a build list you can follow): a furnace whose structure holds a variant block,
// parts made from each other, a chain deeper than the build tree shows, a table packed into itself, GTNH's circuit
// stand-in pressed from the circuits it stands for, an EBF whose coils need molten tin, a stopped steel rod with GT's
// recycling loop, and smelting recipes for the recycling rule. Everything here is invented, nothing is game data.

import { MINI_GT } from './mini-gt.ts';
import type { PackSpec, RecipeSpec } from './pack-spec.ts';
import { ANY_LV_CIRCUIT, fluidCellsSpec, standInSpec, withBuildRecipes } from './build-fixtures.ts';
import { defaultSettings } from '../../src/shared/project/apply-op.ts';
import type { PlanSettings, PlanStep } from '../../src/shared/types/plan.ts';

/** Half a dust or ingot in GT's material units: a rod, a casing. */
const HALF = 1_814_400;

/** A crafting-table recipe: `id` makes `n` (default 1) `out` from `ins`. */
function craft(id: string, ins: Array<[string, number]>, out: string, n = 1): RecipeSpec {
  return { id, map: 'crafting', in: ins, out: [[out, n]] };
}

/** `spec` plus `more` appended to its lists, a fresh copy. */
function extended(spec: PackSpec, more: Pick<PackSpec, 'items' | 'fluids' | 'maps' | 'machines' | 'recipes'>): PackSpec {
  const copy = structuredClone(spec);
  return {
    ...copy,
    items: [...(copy.items ?? []), ...(more.items ?? [])], fluids: [...(copy.fluids ?? []), ...(more.fluids ?? [])],
    maps: [...(copy.maps ?? []), ...(more.maps ?? [])], machines: [...(copy.machines ?? []), ...(more.machines ?? [])],
    recipes: [...(copy.recipes ?? []), ...(more.recipes ?? [])],
  };
}

/** A plan step with the defaults of bom-steps.test.ts's local `step` helper. */
export function partStep(p: Partial<PlanStep>): PlanStep {
  return {
    id: 'x', recipeId: 'x', mapId: 'm', machine: { mteId: 0, name: '', tier: 1 }, count: 1, owned: 0, runsPerSecond: 0.1,
    utilization: 1, euPerTick: 0, durationTicks: 20, overclocks: 0, inputs: [], outputs: [], alternatives: [], handCraft: false, warnings: [], ...p,
  };
}

/** fluidCellsSpec with the Firebrick at [2, 1, 0] at meta 3, which `make-firebrick-3` crafts from an iron ingot. */
export function variantCellSpec(): PackSpec {
  const spec = fluidCellsSpec();
  const cell = spec.machines?.find((m) => m.mteId === 1200)?.structure?.blocks.find((b) => b.pos[0] === 2 && b.pos[1] === 1);
  if (cell === undefined) throw new Error('fluidCellsSpec changed: no Firebrick at [2, 1, 0]');
  cell.block = { id: 't:firebrick', meta: 3 };
  spec.recipes?.push(craft('make-firebrick-3', [['t:iron_ingot@0', 1]], 't:firebrick@3'));
  return spec;
}

/** Mini-GT plus parts made from each other: X, Y and Z in a loop with copper ways into X and Z; W and V only from each other. */
export function loopSpec(): PackSpec {
  return extended(MINI_GT, {
    items: ['x', 'y', 'z', 'w', 'v'].map((c) => ({ key: `t:${c}@0`, name: `Part ${c.toUpperCase()}` })),
    recipes: [
      craft('z1', [['t:x@0', 1]], 't:z@0'), craft('z2', [['t:copper_ingot@0', 5]], 't:z@0'),
      craft('x1', [['t:y@0', 1]], 't:x@0'), craft('x2', [['t:copper_ingot@0', 3]], 't:x@0'),
      craft('y1', [['t:z@0', 1]], 't:y@0'), craft('w1', [['t:v@0', 1]], 't:w@0'), craft('v1', [['t:w@0', 1]], 't:v@0'),
    ],
  });
}

/** Mini-GT plus a chain of 15 parts, Deep 0 from Deep 1 … Deep 14 from 2 copper ingots: three levels past the tree's 12. */
export function deepSpec(): PackSpec {
  return extended(MINI_GT, {
    items: Array.from({ length: 15 }, (_, i) => ({ key: `t:d${i}@0`, name: `Deep ${i}` })),
    recipes: [
      ...Array.from({ length: 14 }, (_, i) => craft(`deep-${i}`, [[`t:d${i + 1}@0`, 1]], `t:d${i}@0`)),
      craft('deep-14', [['t:copper_ingot@0', 2]], 't:d14@0'),
    ],
  });
}

/**
 * Mini-GT plus a Table crafted from 4 copper ingots, packed 9 into a Packed Table and 9 of those into a Packed Table II,
 * and unpacked again (`a-unpack-…`, ids that sort before `table`, as the export's hashes may): unpacking ties `table` on
 * cost, as the 2.9 export's Crafting Table and Compressed Crafting Tables do.
 */
export function packedTableSpec(): PackSpec {
  return extended(MINI_GT, {
    items: [{ key: 't:table@0', name: 'Table' }, { key: 't:table_c1@0', name: 'Packed Table' }, { key: 't:table_c2@0', name: 'Packed Table II' }],
    recipes: [
      craft('table', [['t:copper_ingot@0', 4]], 't:table@0'),
      craft('pack-1', [['t:table@0', 9]], 't:table_c1@0'), craft('a-unpack-1', [['t:table_c1@0', 1]], 't:table@0', 9),
      craft('pack-2', [['t:table_c1@0', 9]], 't:table_c2@0'), craft('a-unpack-2', [['t:table_c2@0', 1]], 't:table_c1@0', 9),
    ],
  });
}

/** standInSpec plus a Basic Forming Press (191) that presses any LV circuit into the "Any LV Circuit" stand-in, as GTNH's does. */
export function standInPressSpec(): PackSpec {
  return extended(standInSpec(), {
    maps: [{ id: 'gt.recipe.press', name: 'Forming Press' }],
    machines: [{ mteId: 191, name: 'Basic Forming Press', maps: ['gt.recipe.press'], tier: 1 }],
    recipes: [{ id: 'a-press', map: 'gt.recipe.press', in: [{ any: [[ANY_LV_CIRCUIT, 1], ['t:circuit@0', 1]] }], out: [[ANY_LV_CIRCUIT, 1]], eut: 16 }],
  });
}

/** MV with 1801 K coils: the settings of the coil fixture's tests. */
export const COIL_MV: PlanSettings = { ...defaultSettings(), tier: 2, coilHeat: 1801 };

/** An EBF (1000) whose structure holds 4 Cupronickel Coil Blocks, a Tinned Casing and a Tin Pipe, and the LV machines that make them. */
export function coilSpec(): PackSpec {
  const vein = (name: string, m: [string, string, string, string]) => ({
    name, dims: ['overworld'], kind: 'vein' as const, weight: 1, minY: 0, maxY: 255, size: 1, density: 1,
    materials: { primary: m[0], secondary: m[1], between: m[2], sporadic: m[3] },
  });
  const item = (key: string, name: string, prefix?: string, material?: string) =>
    ({ key, name, ...(prefix === undefined ? {} : { gt: { prefix, material: material as string } }) });
  const cell = (x: number, y: number, block: { id: string; meta: number; mteId?: number }) => ({ pos: [x, y, 0] as [number, number, number], block });
  return {
    items: [
      item('t:tin_dust@0', 'Tin Dust', 'dust', 'Tin'), item('t:copper_ingot@0', 'Copper Ingot', 'ingot', 'Copper'),
      item('t:nickel_dust@0', 'Nickel Dust', 'dust', 'Nickel'), item('t:iron_ingot@0', 'Iron Ingot', 'ingot', 'Iron'),
      item('t:mica_dust@0', 'Mica Dust', 'dust', 'Mica'), item('t:ti_dust@0', 'Titanium Dust', 'dust', 'Titanium'),
      item('t:ti_ingot@0', 'Titanium Ingot', 'ingot', 'Titanium'), item('t:cupronickel_ingot@0', 'Cupronickel Ingot', 'ingot', 'Cupronickel'),
      item('t:cupro_wire@0', '2x Cupronickel Wire', 'wireGt02', 'Cupronickel'),
      item('t:mica_foil@0', 'Mica Insulator Foil'), item('t:coil@0', 'Cupronickel Coil Block'), item('t:tin_casing@0', 'Tinned Casing'),
      item('t:tin_pipe@0', 'Tin Pipe'),
    ],
    fluids: [{ key: 'fluid:molten.tin', name: 'Molten Tin' }],
    maps: [
      { id: 'gt.recipe.fluidextractor', name: 'Fluid Extractor' }, { id: 'gt.recipe.alloysmelter', name: 'Alloy Smelter' },
      { id: 'gt.recipe.wiremill', name: 'Wiremill' }, { id: 'gt.recipe.metalbender', name: 'Bending Machine' },
      { id: 'gt.recipe.assembler', name: 'Assembler' }, { id: 'gt.recipe.blastfurnace', name: 'Blast Furnace', specialValue: 'heat' },
    ],
    machines: [
      { mteId: 131, name: 'Basic Fluid Extractor', maps: ['gt.recipe.fluidextractor'], tier: 1 },
      { mteId: 201, name: 'Basic Alloy Smelter', maps: ['gt.recipe.alloysmelter'], tier: 1 },
      { mteId: 111, name: 'Basic Wiremill', maps: ['gt.recipe.wiremill'], tier: 1 },
      { mteId: 101, name: 'Basic Bending Machine', maps: ['gt.recipe.metalbender'], tier: 1 },
      { mteId: 121, name: 'Basic Assembler', maps: ['gt.recipe.assembler'], tier: 1 },
      {
        mteId: 1000, name: 'Electric Blast Furnace', maps: ['gt.recipe.blastfurnace'], kind: 'multiblock', heatOC: true,
        structure: {
          size: [3, 3, 1], controller: [1, 0, 0], air: [],
          blocks: [
            cell(0, 0, { id: 't:coil', meta: 0 }), cell(1, 0, { id: 'gregtech:gt.blockmachines', meta: 1000, mteId: 1000 }),
            cell(2, 0, { id: 't:coil', meta: 0 }), cell(0, 1, { id: 't:coil', meta: 0 }), cell(1, 1, { id: 't:tin_casing', meta: 0 }),
            cell(2, 1, { id: 't:coil', meta: 0 }), cell(1, 2, { id: 't:tin_pipe', meta: 0 }),
          ],
        },
      },
    ],
    recipes: [
      { id: 'melt-tin', map: 'gt.recipe.fluidextractor', in: [['t:tin_dust@0', 1]], out: [['fluid:molten.tin', 144]], eut: 24 },
      { id: 'alloy-cupro', map: 'gt.recipe.alloysmelter', in: [['t:copper_ingot@0', 1], ['t:nickel_dust@0', 1]], out: [['t:cupronickel_ingot@0', 2]], eut: 16 },
      { id: 'wire-cupro', map: 'gt.recipe.wiremill', in: [['t:cupronickel_ingot@0', 1]], out: [['t:cupro_wire@0', 1]], eut: 8, meta: { circuit: 2 } },
      { id: 'press-foil', map: 'gt.recipe.metalbender', in: [['t:mica_dust@0', 1]], out: [['t:mica_foil@0', 4]], eut: 8 },
      {
        id: 'assemble-coil', map: 'gt.recipe.assembler', in: [['t:cupro_wire@0', 8], ['t:mica_foil@0', 8], ['fluid:molten.tin', 144]],
        out: [['t:coil@0', 1]], eut: 30, meta: { circuit: 8 },
      },
      { id: 'solder-casing', map: 'gt.recipe.assembler', in: [['t:iron_ingot@0', 1], ['fluid:molten.tin', 72]], out: [['t:tin_casing@0', 1]], eut: 16 },
      { id: 'solder-pipe', map: 'gt.recipe.assembler', in: [['t:iron_ingot@0', 1], ['fluid:molten.tin', 72]], out: [['t:tin_pipe@0', 1]], eut: 16 },
      { id: 'ebf-ti', map: 'gt.recipe.blastfurnace', in: [['t:ti_dust@0', 1]], out: [['t:ti_ingot@0', 1]], eut: 120, dur: 1000, sv: 1000, meta: { coilHeat: 1000 } },
    ],
    worldgen: {
      dimensions: [{ key: 'overworld', id: 0, name: 'Overworld', mod: 'minecraft', kind: 'dimension', defaultTier: 0 }],
      veins: [vein('ore.mix.tin', ['Tin', 'Copper', 'Nickel', 'Iron']), vein('ore.mix.mica', ['Mica', 'Titanium', 'Iron', 'Copper'])],
      fluidSources: [], capabilities: [], byproducts: {},
    },
  };
}

/** The coil fixture's EBF step: one new EBF that runs `ebf-ti` at MV. */
export function ebfStep(p: Partial<PlanStep> = {}): PlanStep {
  return partStep({ id: 'ebf-ti', recipeId: 'ebf-ti', mainOutput: 't:ti_ingot@0', machine: { mteId: 1000, name: 'Electric Blast Furnace', tier: 2 }, ...p });
}

/**
 * A Vacuum Tube from a Steel Rod and a Steel Casing (`tube`), the group stopping Steel Rods and a lathe-made Fancy Steel Rod
 * it cannot make at LV; steel from iron and coal dust in an alloy smelter (the Dark Ash thrown away), rods and casings
 * extruded from it, and GT's recycling loop: polarize rods, craft two into a Long Magnetic Steel Rod, smelt that back into a
 * Steel Ingot in an electric furnace. Every machine is crafted from nothing (`withBuildRecipes`), so it builds for free.
 */
export function rodSpec(): PackSpec {
  const vein = { name: 'ore.mix.iron', dims: ['overworld'], kind: 'vein' as const, weight: 1, minY: 0, maxY: 255, size: 1, density: 1,
    materials: { primary: 'Iron', secondary: 'Coal', between: 'Iron', sporadic: 'Coal' } };
  const gt = (key: string, name: string, prefix: string, material: string, amount?: number) =>
    ({ key, name, gt: { prefix, material, ...(amount === undefined ? {} : { amount }) } });
  return withBuildRecipes({
    items: [
      gt('t:iron_dust@0', 'Iron Dust', 'dust', 'Iron'), gt('t:coal@0', 'Coal Dust', 'dust', 'Coal'), gt('t:ash@0', 'Dark Ash Dust', 'dust', 'DarkAsh'),
      gt('t:steel_ingot@0', 'Steel Ingot', 'ingot', 'Steel'), gt('t:steel_rod@0', 'Steel Rod', 'stick', 'Steel', HALF),
      gt('t:mag_rod@0', 'Magnetic Steel Rod', 'stick', 'SteelMagnetic', HALF), gt('t:mag_long@0', 'Long Magnetic Steel Rod', 'stickLong', 'SteelMagnetic'),
      gt('t:steel_casing@0', 'Steel Casing', 'itemCasing', 'Steel', HALF), gt('t:fancy_rod@0', 'Fancy Steel Rod', 'stick', 'Steel', HALF),
      { key: 't:tube@0', name: 'Vacuum Tube' },
    ],
    maps: ['gt.recipe.alloysmelter', 'gt.recipe.extruder', 'gt.recipe.polarizer', 'gt.recipe.assembler', 'gt.recipe.lathe', 'gt.recipe.furnace', 'crafting'].map((id) => ({ id })),
    machines: [
      { mteId: 201, name: 'Basic Alloy Smelter', maps: ['gt.recipe.alloysmelter'], tier: 1 }, { mteId: 281, name: 'Basic Extruder', maps: ['gt.recipe.extruder'], tier: 1 },
      { mteId: 551, name: 'Basic Polarizer', maps: ['gt.recipe.polarizer'], tier: 1 }, { mteId: 121, name: 'Basic Assembler', maps: ['gt.recipe.assembler'], tier: 1 },
      { mteId: 151, name: 'Basic Electric Furnace', maps: ['gt.recipe.furnace'], tier: 1 },
    ],
    recipes: [
      { id: 'alloy-steel', map: 'gt.recipe.alloysmelter', in: [['t:iron_dust@0', 1], ['t:coal@0', 1]], out: [['t:steel_ingot@0', 1], ['t:ash@0', 1]], eut: 16 },
      { id: 'extrude-rod', map: 'gt.recipe.extruder', in: [['t:steel_ingot@0', 1]], out: [['t:steel_rod@0', 2]], eut: 30 },
      { id: 'extrude-casing', map: 'gt.recipe.extruder', in: [['t:steel_ingot@0', 1]], out: [['t:steel_casing@0', 2]], eut: 30 },
      { id: 'polarize-rod', map: 'gt.recipe.polarizer', in: [['t:steel_rod@0', 1]], out: [['t:mag_rod@0', 1]], eut: 16 },
      { id: 'long-mag', map: 'crafting', in: [['t:mag_rod@0', 2]], out: [['t:mag_long@0', 1]] },
      { id: 'smelt-mag-long', map: 'gt.recipe.furnace', in: [['t:mag_long@0', 1]], out: [['t:steel_ingot@0', 1]], eut: 4 },
      { id: 'lathe-fancy', map: 'gt.recipe.lathe', in: [['t:steel_ingot@0', 1]], out: [['t:fancy_rod@0', 1]], eut: 16 },
      { id: 'tube', map: 'gt.recipe.assembler', in: [['t:steel_rod@0', 1], ['t:steel_casing@0', 1]], out: [['t:tube@0', 1]], eut: 16 },
    ],
    worldgen: { veins: [vein] },
  });
}

/**
 * Smelting recipes for the recycling rule: a rod back into its own steel, a magnetic and a pig-iron part into their base
 * metal's forms, bars made from rods back into nuggets, and what stays allowed — a dust into an ingot, Red Iron Compound
 * (crafted from iron and redstone) into a Red Alloy Ingot, a cluster nothing makes, a nugget into another material's
 * nugget — and a polarizer recipe, which is no smelting.
 */
export function smeltSpec(): PackSpec {
  const gt = (key: string, prefix: string, material: string, amount?: number) =>
    ({ key, gt: { prefix, material, ...(amount === undefined ? {} : { amount }) } });
  return {
    items: [
      gt('t:steel_rod@0', 'stick', 'Steel', HALF), gt('t:mag_long@0', 'stickLong', 'SteelMagnetic'), gt('t:pig_spring@0', 'spring', 'PigIron'),
      gt('t:steel_ingot@0', 'ingot', 'Steel'), gt('t:steel_nugget@0', 'nugget', 'Steel'), gt('t:iron_dust@0', 'dust', 'Iron'),
      gt('t:iron_ingot@0', 'ingot', 'Iron'), gt('t:iron_nugget@0', 'nugget', 'Iron'), gt('t:castiron_nugget@0', 'nugget', 'CastIron'),
      gt('t:redstone@0', 'dust', 'Redstone'), gt('t:redalloy_ingot@0', 'ingot', 'RedAlloy'), gt('t:mag_rod@0', 'stick', 'SteelMagnetic', HALF),
      { key: 't:steel_bars@0' }, { key: 't:red_iron@0' }, { key: 't:cluster@0' },
    ],
    maps: [{ id: 'furnace' }, { id: 'gt.recipe.furnace' }, { id: 'gt.recipe.assembler' }, { id: 'crafting' }, { id: 'gt.recipe.polarizer' }],
    recipes: [
      { id: 'smelt-rod', map: 'furnace', in: [['t:steel_rod@0', 1]], out: [['t:steel_nugget@0', 4]] },
      { id: 'smelt-mag-long', map: 'furnace', in: [['t:mag_long@0', 1]], out: [['t:steel_ingot@0', 1]] },
      { id: 'smelt-pig-spring', map: 'gt.recipe.furnace', in: [['t:pig_spring@0', 1]], out: [['t:iron_ingot@0', 1]], eut: 4 },
      { id: 'make-bars', map: 'gt.recipe.assembler', in: [['t:steel_rod@0', 3]], out: [['t:steel_bars@0', 4]], eut: 16 },
      { id: 'smelt-bars', map: 'furnace', in: [['t:steel_bars@0', 1]], out: [['t:steel_nugget@0', 3]] },
      { id: 'smelt-dust', map: 'furnace', in: [['t:iron_dust@0', 1]], out: [['t:iron_ingot@0', 1]] },
      { id: 'make-red-iron', map: 'crafting', in: [['t:iron_ingot@0', 1], ['t:redstone@0', 4]], out: [['t:red_iron@0', 1]] },
      { id: 'smelt-red-iron', map: 'furnace', in: [['t:red_iron@0', 1]], out: [['t:redalloy_ingot@0', 1]] },
      { id: 'smelt-cluster', map: 'furnace', in: [['t:cluster@0', 1]], out: [['t:iron_ingot@0', 2]] },
      { id: 'smelt-nugget', map: 'furnace', in: [['t:iron_nugget@0', 1]], out: [['t:castiron_nugget@0', 1]] },
      { id: 'polarize-rod', map: 'gt.recipe.polarizer', in: [['t:steel_rod@0', 1]], out: [['t:mag_rod@0', 1]], eut: 16 },
    ],
  };
}
