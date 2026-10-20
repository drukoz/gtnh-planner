// Synthetic fixtures of plan 12's build-cost tests (Tasks 2–8): Mini-GT with a multiblock bender and the hatches it is
// built and run with, machines whose crafting chain has a pricing gap, a line that may make sand from rock-breaker
// cobblestone, assembler steps that share one programmed circuit, and the GT++ Auto Workbench. Everything here is
// invented, nothing is game data (the Auto Workbench's ids, class and names are the 2.9 export's, its recipe is not).
// Every helper returns a fresh spec, so a test that changes one changes no other (and never MINI_GT itself).

import { TIER_NAMES } from '../../src/shared/gt/tiers.ts';
import { MINI_GT } from './mini-gt.ts';
import type { MachineSpec, PackSpec, RecipeSpec } from './pack-spec.ts';

/** The package of GT's hatch classes (architecture §11.19 compares the simple name after the last '.'). */
const HATCHES = 'gregtech.api.metatileentity.implementations.';

function hatch(mteId: number, name: string, tier: number, cls: string): MachineSpec {
  return { mteId, name, kind: 'hatch', tier, maps: [], cls: HATCHES + cls };
}

/** A crafting-table recipe: `id` makes one `out` from `ins`. */
function craft(id: string, ins: Array<[string, number]>, out: string): RecipeSpec {
  return { id, map: 'crafting', in: ins, out: [[out, 1]] };
}

/** A fresh copy of `spec` with `more` appended to its lists. */
function extended(spec: PackSpec, more: Pick<PackSpec, 'items' | 'machines' | 'recipes'>): PackSpec {
  const copy = structuredClone(spec);
  return {
    ...copy,
    items: [...(copy.items ?? []), ...(more.items ?? [])],
    machines: [...(copy.machines ?? []), ...(more.machines ?? [])],
    recipes: [...(copy.recipes ?? []), ...(more.recipes ?? [])],
  };
}

/**
 * Mini-GT plus a Large Bender (1100, a multiblock of the bending map): a 3 × 1 × 3 structure of its controller, an HV
 * Muffler Hatch (93) and 7 Machine Casings, crafted from 3 circuits and a casing; the LV and HV muffler hatches (91, 93),
 * an LV input bus (51), an LV output bus (61), a maintenance hatch (71) and the LV and MV energy hatches (81, 82), each
 * crafted from an LV hull. At LV and MV alike 51, 61, 71 and 81 cost 10, 82 costs 15 and the LV muffler 10; the HV
 * muffler needs a titanium plate, which nothing at LV or MV makes.
 */
export function largeBenderSpec(): PackSpec {
  // The controller at [1, 0, 0], the muffler at [1, 0, 2], casings on the other 7 cells.
  const blocks: NonNullable<MachineSpec['structure']>['blocks'] = [];
  for (let z = 0; z < 3; z++) {
    for (let x = 0; x < 3; x++) {
      const block = x === 1 && z === 0 ? { id: 'gregtech:gt.blockmachines', meta: 1100, mteId: 1100 }
        : x === 1 && z === 2 ? { id: 'gregtech:gt.blockmachines', meta: 93, mteId: 93 } : { id: 't:casing', meta: 0 };
      blocks.push({ pos: [x, 0, z], block });
    }
  }
  return extended(MINI_GT, {
    items: [{ key: 't:casing@0', name: 'Machine Casing' }],
    machines: [
      hatch(91, 'Muffler Hatch (LV)', 1, 'MTEHatchMuffler'),
      hatch(93, 'Muffler Hatch (HV)', 3, 'MTEHatchMuffler'),
      hatch(51, 'Input Bus (LV)', 1, 'MTEHatchInputBus'),
      hatch(61, 'Output Bus (LV)', 1, 'MTEHatchOutputBus'),
      hatch(71, 'Maintenance Hatch', 1, 'MTEHatchMaintenance'),
      hatch(81, 'Energy Hatch (LV)', 1, 'MTEHatchEnergy'),
      hatch(82, 'Energy Hatch (MV)', 2, 'MTEHatchEnergy'),
      {
        mteId: 1100, name: 'Large Bender', kind: 'multiblock', maps: ['gt.recipe.metalbender'],
        structure: { size: [3, 1, 3], controller: [1, 0, 0], air: [], blocks },
      },
    ],
    recipes: [
      craft('make-casing', [['t:iron_plate@0', 6]], 't:casing@0'),
      craft('make-muffler-lv', [['t:hull_lv@0', 1], ['t:iron_plate@0', 1]], 'machine:91@0'),
      craft('make-muffler-hv', [['t:hull_lv@0', 1], ['t:titanium_plate@0', 1]], 'machine:93@0'),
      craft('make-1100', [['t:circuit@0', 3], ['t:casing@0', 1]], 'machine:1100@0'),
      craft('make-51', [['t:hull_lv@0', 1], ['t:iron_plate@0', 1]], 'machine:51@0'),
      craft('make-61', [['t:hull_lv@0', 1], ['t:iron_plate@0', 1]], 'machine:61@0'),
      craft('make-71', [['t:hull_lv@0', 1], ['t:copper_wire@0', 2]], 'machine:71@0'),
      craft('make-81', [['t:hull_lv@0', 1], ['t:tin_cable@0', 2]], 'machine:81@0'),
      craft('make-82', [['t:hull_lv@0', 1], ['t:tin_cable@0', 8], ['t:iron_plate@0', 2]], 'machine:82@0'),
    ],
  });
}

/**
 * `spec` plus a pricing gap for each machine of `mteIds`: its recipe `make-<mteId>` (crafting: an LV hull and a Seed
 * Crystal) works at every tier and nothing in its chain is out of reach, but the Seed Crystal only comes from a loop with
 * no way in and no gain (`grow-seed` and `sprout-seed` make Seed Crystal and Crystal Sprout from each other), so the cost
 * analysis finds no price for it.
 */
export function withPriceGap(spec: PackSpec, mteIds: readonly number[]): PackSpec {
  return extended(spec, {
    items: [{ key: 't:seed@0', name: 'Seed Crystal' }, { key: 't:sprout@0', name: 'Crystal Sprout' }],
    recipes: [
      craft('grow-seed', [['t:sprout@0', 1]], 't:seed@0'),
      craft('sprout-seed', [['t:seed@0', 1]], 't:sprout@0'),
      ...mteIds.map((mteId) => craft(`make-${mteId}`, [['t:hull_lv@0', 1], ['t:seed@0', 1]], `machine:${mteId}@0`)),
    ],
  });
}

/** GT's display item the rock breaker's recipes list as their input (plan 09 R2: the loader drops it). */
const ROCK_BREAKER_DISPLAY = 'gregtech:gt.metaitem.02@32765#abcdefabcdef';
const COBBLE = 'minecraft:cobblestone@0';
const SAND = 'minecraft:sand@0';
const GRAVEL = 'minecraft:gravel@0';

/**
 * Mini-GT plus a glass line that may make its sand (Tasks 3, 5, 6, 8): sand and gravel (gathered blocks of the overworld,
 * plan 09 R1), glass, frit (with `frit`) and the rock breaker's display item; maps `gt.recipe.rockbreaker` and
 * `gt.recipe.hammer`; machines 441 Basic Rock Breaker (its supply recipe, `packFromSpec`'s `deriveSupply`, makes
 * cobblestone from nothing: 1.25 runs/s at LV), 481 Basic Forge Hammer and 491 Basic Sifter (no map: only its build
 * cost, which takes sand, is used), all LV; recipes `fake-cobble` (rock breaker, display only), `hammer-gravel`
 * (cobblestone → gravel) and `hammer-sand` (gravel → sand), each 16 EU/t × 40 t (0.5 runs/s), `smelt-glass` (Mini-GT's
 * Basic Electric Furnace 151: sand → glass, 16 × 40), `gravel-hand` (crafting: cobblestone → gravel; none with
 * `handGravel: false`), the build recipes of 441, 481, 151 and 491 (at LV 4, 17, 16 and 13: 4 iron ingots; an LV hull 9 +
 * 2 circuits 6 + 2 iron plates 2; hull 9 + 6 + 2 tin cables 1; hull 9 + 4 sand dug at 1) and with `frit` the assembler
 * recipes `frit-sand` (2 sand → 1 frit) and `frit-iron` (1 iron ingot → 1 frit), each 16 EU/t × 100 t.
 */
export function sandSpec(opts: { handGravel?: boolean; frit?: boolean } = {}): PackSpec {
  const recipes: RecipeSpec[] = [
    { id: 'fake-cobble', map: 'gt.recipe.rockbreaker', in: [[ROCK_BREAKER_DISPLAY, 1]], out: [[COBBLE, 1]], eut: 30, dur: 16, flags: { fake: true } },
    { id: 'hammer-gravel', map: 'gt.recipe.hammer', in: [[COBBLE, 1]], out: [[GRAVEL, 1]], eut: 16, dur: 40 },
    { id: 'hammer-sand', map: 'gt.recipe.hammer', in: [[GRAVEL, 1]], out: [[SAND, 1]], eut: 16, dur: 40 },
    { id: 'smelt-glass', map: 'gt.recipe.furnace', in: [[SAND, 1]], out: [['t:glass@0', 1]], eut: 16, dur: 40 },
    ...(opts.handGravel === false ? [] : [craft('gravel-hand', [[COBBLE, 1]], GRAVEL)]),
    craft('make-441', [['t:iron_ingot@0', 4]], 'machine:441@0'),
    craft('make-481', [['t:hull_lv@0', 1], ['t:circuit@0', 2], ['t:iron_plate@0', 2]], 'machine:481@0'),
    craft('make-151', [['t:hull_lv@0', 1], ['t:circuit@0', 2], ['t:tin_cable@0', 2]], 'machine:151@0'),
    craft('make-491', [['t:hull_lv@0', 1], [SAND, 4]], 'machine:491@0'),
  ];
  const items: NonNullable<PackSpec['items']> = [
    { key: SAND, name: 'Sand' }, { key: GRAVEL, name: 'Gravel' }, { key: 't:glass@0', name: 'Glass' },
    { key: ROCK_BREAKER_DISPLAY, name: 'IT\'S FREE! Place Lava on Side' },
  ];
  if (opts.frit === true) {
    items.push({ key: 't:frit@0', name: 'Frit' });
    recipes.push(
      { id: 'frit-sand', map: 'gt.recipe.assembler', in: [[SAND, 2]], out: [['t:frit@0', 1]], eut: 16, dur: 100 },
      { id: 'frit-iron', map: 'gt.recipe.assembler', in: [['t:iron_ingot@0', 1]], out: [['t:frit@0', 1]], eut: 16, dur: 100 },
    );
  }
  const spec = extended(MINI_GT, {
    items,
    machines: [
      { mteId: 441, name: 'Basic Rock Breaker', tier: 1, maps: ['gt.recipe.rockbreaker'], cls: 'gregtech.common.tileentities.machines.basic.MTERockBreaker' },
      { mteId: 481, name: 'Basic Forge Hammer', tier: 1, maps: ['gt.recipe.hammer'] },
      { mteId: 491, name: 'Basic Sifter', tier: 1, maps: [] },
    ],
    recipes,
  });
  spec.maps = [...(spec.maps ?? []), { id: 'gt.recipe.rockbreaker', name: 'Rock Breaker' }, { id: 'gt.recipe.hammer', name: 'Forge Hammer' }];
  return spec;
}

/**
 * Mini-GT plus a kit made in the assembler (Tasks 3, 5, 6): items Gear and Kit, recipes `gear` (2 iron plates → 1 gear)
 * and `kit` (1 circuit + 1 gear → 1 kit), each 16 EU/t × 100 t and taking programmed circuit `circuit` (as Mini-GT's
 * `circuit-lv` takes 2), none with null. By default `circuit-lv`, `gear` and `kit` share one sharing key ('2|').
 */
export function kitSpec(circuit: number | null = 2): PackSpec {
  const configured = (r: RecipeSpec): RecipeSpec => (circuit === null ? r
    : { ...r, in: [...(r.in ?? []), { nc: `gregtech:gt.integrated_circuit@${circuit}` }], meta: { circuit } });
  return extended(MINI_GT, {
    items: [{ key: 't:gear@0', name: 'Gear' }, { key: 't:kit@0', name: 'Kit' }],
    recipes: [
      configured({ id: 'gear', map: 'gt.recipe.assembler', in: [['t:iron_plate@0', 2]], out: [['t:gear@0', 1]], eut: 16, dur: 100 }),
      configured({ id: 'kit', map: 'gt.recipe.assembler', in: [['t:circuit@0', 1], ['t:gear@0', 1]], out: [['t:kit@0', 1]], eut: 16, dur: 100 }),
    ],
  });
}

/** GT++'s Electric Auto Workbench as the 2.9 export lists it (architecture §11.19 compares the name after the last '.'). */
const AUTO_WORKBENCH_CLS = 'gtPlusPlus.xmod.gregtech.common.tileentities.automation.MTEElectricAutoWorkbench';

/**
 * `spec` plus GT++'s Electric Auto Workbench at each of `tiers` as the 2.9 export lists it (mteId 31090 + tier, "Auto
 * Workbench (<TIER>)", kind `other`, no recipe map) and, unless `buildable` is false, its invented crafting recipe
 * `make-<mteId>`: an LV hull and 2 × tier circuits (at MV, circuits at 2.5: 14 for the LV one, 19 for the MV one).
 */
export function withAutoWorkbenches(spec: PackSpec, tiers: readonly number[], opts: { buildable?: boolean } = {}): PackSpec {
  return extended(spec, {
    machines: tiers.map((tier): MachineSpec => ({
      mteId: 31090 + tier, name: `Auto Workbench (${TIER_NAMES[tier] ?? tier})`, kind: 'other', tier, maps: [], cls: AUTO_WORKBENCH_CLS,
    })),
    recipes: opts.buildable === false ? [] : tiers.map((tier) => craft(`make-${31090 + tier}`, [['t:hull_lv@0', 1], ['t:circuit@0', 2 * tier]], `machine:${31090 + tier}@0`)),
  });
}
