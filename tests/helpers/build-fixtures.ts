// Synthetic fixtures of plan 12's build-cost tests (Tasks 2–8): Mini-GT with a multiblock bender and the hatches it is
// built and run with, machines whose crafting chain has a pricing gap, a line that may make sand from rock-breaker
// cobblestone, assembler steps that share one programmed circuit, the GT++ Auto Workbench, and the build-cost MIP's small
// lines (boards from tin or solder, presses, hammers, a cleanroom recipe) with machine options given by hand and solved
// through `solvedWithBuild`. Everything here is invented, nothing is game data (the Auto Workbench's ids, class and names
// are the 2.9 export's, its recipe is not). Every helper returns a fresh spec, so a test that changes one changes no
// other (and never MINI_GT itself).

import { TIER_NAMES, V } from '../../src/shared/gt/tiers.ts';
import type { StuffKey } from '../../src/shared/keys.ts';
import { defaultSettings } from '../../src/shared/project/apply-op.ts';
import { buildCandidates, type LeafDecision, type LeafOracle, type PlanEnv } from '../../src/server/planner/candidates.ts';
import { sharingKey, type BuildModel, type MachineOption } from '../../src/server/planner/machine-options.ts';
import { solveLine, type Solution, type SolveOptions } from '../../src/server/planner/solve.ts';
import { MINI_GT } from './mini-gt.ts';
import { packFromSpec, type MachineSpec, type PackSpec, type RecipeSpec } from './pack-spec.ts';

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

/**
 * A machine option of the build-cost MIP's tests (Task 4): a `basic` machine `M<mteId>` that can be added, at `tier`,
 * doing `perMachine` runs a second, `build` raw to build (null: no price), `owned` of it owned, weighed at `solveBuild`
 * (default `build ?? 0`). One that cannot be built here spreads it: `{ ...opt(…), canAdd: false, unbuildable: '…' }`.
 */
export function opt(mteId: number, tier: number, perMachine: number, build: number | null, owned = 0, solveBuild = build ?? 0): MachineOption {
  return {
    mteId, name: `M${mteId}`, tier, kind: 'basic',
    oc: { euPerTick: 16, durationTicks: 20 / perMachine, overclocks: 0, heatOverclocks: 0, machineVoltage: V[tier] ?? 0, machineAmps: 1, parallel: 1 },
    perMachine, build, owned, solveBuild, canAdd: true,
  };
}

const ASSEMBLER = 'gt.recipe.assembler';
const EXTRACTOR = 'gt.recipe.fluidextractor';
const ALLOY_SMELTER = 'gt.recipe.alloysmelter';
const BENDER = 'gt.recipe.metalbender';
const WIREMILL = 'gt.recipe.wiremill';
const HAMMER = 'gt.recipe.hammer';
const ELECTRIC_FURNACE = 'gt.recipe.furnace';

/**
 * Boards made with tin or with solder (Tasks 4, 8): maps assembler, fluid extractor and alloy smelter; machines 121 Basic
 * Assembler, 131 Basic Fluid Extractor and 201 Basic Alloy Smelter (LV); `board-tin` (1 part + 144 L molten tin → 1
 * board) and `board-solder` (1 part + 72 L molten solder → 1 board), each 16 EU/t × 100 t; `x-tin` and `x-solder` (1
 * ingot → 144 L), 30 × 40; `alloy-solder` (9 tin + 1 antimony → 10 solder ingots), 16 × 200. With part, tin and antimony
 * at 1 a board takes 2 raw by tin and 1.5 by solder (half a solder ingot of 1 raw).
 */
export function solderSpec(): PackSpec {
  return {
    maps: [{ id: ASSEMBLER, name: 'Assembler' }, { id: EXTRACTOR, name: 'Fluid Extractor' }, { id: ALLOY_SMELTER, name: 'Alloy Smelter' }],
    machines: [
      { mteId: 121, name: 'Basic Assembler', tier: 1, maps: [ASSEMBLER] },
      { mteId: 131, name: 'Basic Fluid Extractor', tier: 1, maps: [EXTRACTOR] },
      { mteId: 201, name: 'Basic Alloy Smelter', tier: 1, maps: [ALLOY_SMELTER] },
    ],
    recipes: [
      { id: 'board-tin', map: ASSEMBLER, in: [['t:part@0', 1], ['fluid:molten.tin', 144]], out: [['t:board@0', 1]], eut: 16, dur: 100 },
      { id: 'board-solder', map: ASSEMBLER, in: [['t:part@0', 1], ['fluid:molten.solder', 72]], out: [['t:board@0', 1]], eut: 16, dur: 100 },
      { id: 'x-tin', map: EXTRACTOR, in: [['t:tin_ingot@0', 1]], out: [['fluid:molten.tin', 144]], eut: 30, dur: 40 },
      { id: 'x-solder', map: EXTRACTOR, in: [['t:solder_ingot@0', 1]], out: [['fluid:molten.solder', 144]], eut: 30, dur: 40 },
      { id: 'alloy-solder', map: ALLOY_SMELTER, in: [['t:tin_ingot@0', 9], ['t:antimony@0', 1]], out: [['t:solder_ingot@0', 10]], eut: 16, dur: 200 },
    ],
  };
}

/** The bending map with machines 101 (LV) and 102 (MV). */
function benders(): Pick<PackSpec, 'maps' | 'machines'> {
  return {
    maps: [{ id: BENDER, name: 'Bending Machine' }],
    machines: [
      { mteId: 101, name: 'Basic Bending Machine', tier: 1, maps: [BENDER] },
      { mteId: 102, name: 'Advanced Bending Machine', tier: 2, maps: [BENDER] },
    ],
  };
}

/** One press on the bending map (101 LV, 102 MV): `press` makes 1 t from 1 a, 24 EU/t × 100 t. */
export function pressSpec(): PackSpec {
  return { ...benders(), recipes: [{ id: 'press', map: BENDER, in: [['t:a@0', 1]], out: [['t:t@0', 1]], eut: 24, dur: 100 }] };
}

/**
 * `pressSpec`'s map and machines with two presses, `press-a` (1 a → 1 t1) and `press-b` (1 b → 1 t2), each 24 EU/t ×
 * 100 t; with `circuits` recipe i takes programmed circuit `circuits[i]`, with `held` it holds `held[i]`, with `fluids` it
 * also takes 144 L of `fluids[i]` (the sharing key's parts, Task 3).
 */
export function twoPressSpec(opts: { circuits?: [number, number]; held?: [StuffKey, StuffKey]; fluids?: [StuffKey, StuffKey] } = {}): PackSpec {
  const press = (i: 0 | 1, id: string, from: StuffKey, to: StuffKey): RecipeSpec => {
    const circuit = opts.circuits?.[i];
    const held = opts.held?.[i];
    const fluid = opts.fluids?.[i];
    const recipe: RecipeSpec = {
      id, map: BENDER, eut: 24, dur: 100, out: [[to, 1]],
      in: [
        [from, 1],
        ...(fluid === undefined ? [] : [[fluid, 144] as [StuffKey, number]]),
        ...(circuit === undefined ? [] : [{ nc: `gregtech:gt.integrated_circuit@${circuit}` }]),
        ...(held === undefined ? [] : [{ nc: held }]),
      ],
    };
    if (circuit !== undefined) recipe.meta = { circuit };
    return recipe;
  };
  return {
    ...benders(),
    items: [
      { key: 'gregtech:gt.integrated_circuit@1', name: 'Programmed Circuit' }, { key: 'gregtech:gt.integrated_circuit@2', name: 'Programmed Circuit' },
      { key: 't:mold_a@0', name: 'Mold A' }, { key: 't:mold_b@0', name: 'Mold B' },
    ],
    fluids: [{ key: 'fluid:molten.iron', name: 'Molten Iron' }, { key: 'fluid:molten.tin', name: 'Molten Tin' }],
    recipes: [press(0, 'press-a', 't:a@0', 't:t1@0'), press(1, 'press-b', 't:b@0', 't:t2@0')],
  };
}

/**
 * Glass from cobblestone (Task 4): maps forge hammer, electric furnace and crafting; machines 481 Basic Forge Hammer and
 * 151 Basic Electric Furnace (LV); `h-gravel` (1 cobble → 1 gravel) and `h-sand` (1 gravel → 1 sand) on the hammer and
 * `smelt` (1 sand → 1 glass) in the furnace, each 16 EU/t × 40 t (0.5 runs a second), and `hand-gravel` (crafting: 1
 * cobble → 1 gravel).
 */
export function hammerSpec(): PackSpec {
  return {
    maps: [{ id: HAMMER, name: 'Forge Hammer' }, { id: ELECTRIC_FURNACE, name: 'Electric Furnace' }, { id: 'crafting', name: 'Crafting' }],
    machines: [
      { mteId: 481, name: 'Basic Forge Hammer', tier: 1, maps: [HAMMER] },
      { mteId: 151, name: 'Basic Electric Furnace', tier: 1, maps: [ELECTRIC_FURNACE] },
    ],
    recipes: [
      { id: 'h-gravel', map: HAMMER, in: [['t:cobble@0', 1]], out: [['t:gravel@0', 1]], eut: 16, dur: 40 },
      { id: 'h-sand', map: HAMMER, in: [['t:gravel@0', 1]], out: [['t:sand@0', 1]], eut: 16, dur: 40 },
      craft('hand-gravel', [['t:cobble@0', 1]], 't:gravel@0'),
      { id: 'smelt', map: ELECTRIC_FURNACE, in: [['t:sand@0', 1]], out: [['t:glass@0', 1]], eut: 16, dur: 40 },
    ],
  };
}

/** `fast` (bending map, 301 Fast Press: 1 a → 1 t) and `slow` (wiremill map, 302 Slow Press: 2 a → 1 t), each 16 EU/t × 100 t. */
export function fastSlowSpec(): PackSpec {
  return {
    maps: [{ id: BENDER, name: 'Bending Machine' }, { id: WIREMILL, name: 'Wiremill' }],
    machines: [{ mteId: 301, name: 'Fast Press', tier: 1, maps: [BENDER] }, { mteId: 302, name: 'Slow Press', tier: 1, maps: [WIREMILL] }],
    recipes: [
      { id: 'fast', map: BENDER, in: [['t:a@0', 1]], out: [['t:t@0', 1]], eut: 16, dur: 100 },
      { id: 'slow', map: WIREMILL, in: [['t:a@0', 2]], out: [['t:t@0', 1]], eut: 16, dur: 100 },
    ],
  };
}

/** The bending map with 101 and the crafting table: `p-machine` makes 1 t from 1 `machineInput` (24 EU/t × 100 t), `p-hand` from 1 `handInput`. */
function benderOrHand(machineInput: StuffKey, handInput: StuffKey): PackSpec {
  return {
    maps: [{ id: BENDER, name: 'Bending Machine' }, { id: 'crafting', name: 'Crafting' }],
    machines: [{ mteId: 101, name: 'Basic Bending Machine', tier: 1, maps: [BENDER] }],
    recipes: [
      craft('p-hand', [[handInput, 1]], 't:t@0'),
      { id: 'p-machine', map: BENDER, in: [[machineInput, 1]], out: [['t:t@0', 1]], eut: 24, dur: 100 },
    ],
  };
}

/** `p-hand` (crafting: 1 a → 1 t) and `p-machine` (bender 101: the same, 24 EU/t × 100 t). */
export function handSpec(): PackSpec {
  return benderOrHand('t:a@0', 't:a@0');
}

/** `p-machine` (bender 101: 1 a → 1 t, 24 EU/t × 100 t) and `p-hand` (crafting: 1 c → 1 t); its tests price a at 0 and c at 1. */
export function freeSpec(): PackSpec {
  return benderOrHand('t:a@0', 't:c@0');
}

/** `p-a` (1 a → 1 t) and `p-b` (1 b → 1 t), both on bender 101, 24 EU/t × 100 t: two routes to one good on one machine and sharing key. */
export function twoFreeSpec(): PackSpec {
  return {
    maps: [{ id: BENDER, name: 'Bending Machine' }],
    machines: [{ mteId: 101, name: 'Basic Bending Machine', tier: 1, maps: [BENDER] }],
    recipes: [
      { id: 'p-a', map: BENDER, in: [['t:a@0', 1]], out: [['t:t@0', 1]], eut: 24, dur: 100 },
      { id: 'p-b', map: BENDER, in: [['t:b@0', 1]], out: [['t:t@0', 1]], eut: 24, dur: 100 },
    ],
  };
}

/** `clean` (bender 101: 1 a → 1 t, 24 EU/t × 100 t, in a cleanroom) and `dirty` (wiremill 111: 2 a → 1 t, 8 EU/t × 100 t). */
export function cleanSpec(): PackSpec {
  return {
    maps: [{ id: BENDER, name: 'Bending Machine' }, { id: WIREMILL, name: 'Wiremill' }],
    machines: [{ mteId: 101, name: 'Basic Bending Machine', tier: 1, maps: [BENDER] }, { mteId: 111, name: 'Basic Wiremill', tier: 1, maps: [WIREMILL] }],
    recipes: [
      { id: 'clean', map: BENDER, in: [['t:a@0', 1]], out: [['t:t@0', 1]], eut: 24, dur: 100, meta: { cleanroom: true } },
      { id: 'dirty', map: WIREMILL, in: [['t:a@0', 2]], out: [['t:t@0', 1]], eut: 8, dur: 100 },
    ],
  };
}

/** The planning environment of `solvedWithBuild`: plan 09's `charged()` one (LV, the overworld). */
const BUILD_ENV: PlanEnv = { tier: 1, reachable: new Set(['overworld']), lowGravity: false, coilHeat: 1801, excluded: new Set(defaultSettings().excludedCategories) };

/** The build model `solvedWithBuild` hands `solveLine` (see there). */
interface BuildSetup {
  options: Record<string, MachineOption[]>; mode?: 'rate' | 'makeN'; horizonSeconds?: number | null; share?: boolean;
  cleanroom?: BuildModel['cleanroom']; alsoMade?: StuffKey[];
}

/**
 * Plan 09's `charged()` with a build model (Task 4): the goods of `leafCosts` bought at their cost (`leafClass` 'direct',
 * `alsoMade` for those of `build.alsoMade`), the graph walked from the keys of `demand` at LV, and `solveLine` with
 * `{ stepCharge: 0, handWeight: 1, ...opts, build }`, where the model's `options` and `eligible` are the given lists
 * (none for other ids), `sharingKey` is Task 3's of the recipe and its graph recipe's held items (AE2's keys: the
 * Project Red split is `lineBuildModel`'s), `owned` and `pools` come from the options' `owned` (per mteId the largest,
 * units without positions), prices price nothing, nothing is blocked or pinned, and `ownedOnly` is the owned machines
 * of a step none of whose options can add machines; defaults rate mode over 24 hours, no sharing, no cleanroom.
 * `runs` = the sorted ids of the step recipes that run.
 */
export async function solvedWithBuild(
  spec: PackSpec, leafCosts: Record<StuffKey, number>, demand: Array<[StuffKey, number]>, build: BuildSetup, opts?: SolveOptions,
): Promise<{ runs: string[]; sol: Solution }> {
  const pack = packFromSpec(spec);
  const also = new Set(build.alsoMade ?? []);
  const leaf: LeafOracle = (key): LeafDecision => {
    if (!Object.hasOwn(leafCosts, key)) return { buyable: false, cost: 0, leafClass: null };
    const bought: LeafDecision = { buyable: true, cost: leafCosts[key] as number, leafClass: 'direct' };
    if (also.has(key)) bought.alsoMade = true;
    return bought;
  };
  const graph = buildCandidates(pack, defaultSettings(), BUILD_ENV, leaf, demand.map(([key]) => key));
  const optionsOf = (id: string): readonly MachineOption[] => (Object.hasOwn(build.options, id) ? build.options[id] as MachineOption[] : []);
  const owned = new Map<number, number>();
  for (const list of Object.values(build.options)) {
    for (const o of list) if (o.owned > 0) owned.set(o.mteId, Math.max(owned.get(o.mteId) ?? 0, o.owned));
  }
  const held = new Map(graph.recipes.map((r) => [r.id, r.nonConsumed]));
  const model: BuildModel = {
    mode: build.mode ?? 'rate',
    horizonSeconds: build.horizonSeconds === undefined ? 86400 : build.horizonSeconds,
    share: build.share ?? false,
    sharingKey: (id) => {
      const r = pack.recipeById.get(id);
      return r === undefined ? '-|' : sharingKey(r, held.get(id) ?? []);
    },
    options: optionsOf,
    eligible: optionsOf,
    blocked: new Map(),
    ownedOnly: (id) => {
      const list = optionsOf(id);
      const first = list[0];
      if (first === undefined || list.some((o) => o.canAdd)) return undefined;
      let runsPerSecond = 0;
      for (const o of list) runsPerSecond += o.perMachine * o.owned;
      return { runsPerSecond, text: `${first.owned}× ${first.name}, which cannot be built here (${first.unbuildable ?? ''})` };
    },
    pinFallback: () => undefined,
    owned,
    pools: new Map([...owned].map(([mteId, n]) => [mteId, new Array<null>(n).fill(null)])),
    prices: { cost: () => Infinity, gap: () => ({ kind: 'no-recipe' }) },
    cleanroom: build.cleanroom ?? null,
  };
  const sol = await solveLine(graph, new Map(demand), { stepCharge: 0, handWeight: 1, ...opts, build: model });
  const runs = graph.recipes.filter((r) => r.kind === 'recipe' && (sol.runs.get(r.id) ?? 0) > 0).map((r) => r.id).sort();
  return { runs, sol };
}
