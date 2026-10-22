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
 * Mini-GT plus Widget Dust, which the Basic Centrifuge (161, which no recipe makes) spins from 1, 3 or 9 iron ingots
 * (`spin-1`, `spin-2`, `spin-3`) and the Basic Bending Machine (101) presses from 27 (`press-widget`): the candidate walk
 * keeps only the cheapest producer (`KEEP_WITHIN`), so a line walked around one centrifuge recipe at a time would meet
 * the next one each walk.
 */
export function centrifugeDustSpec(): PackSpec {
  const ingots = (n: number): Array<[StuffKey, number]> => [['t:iron_ingot@0', n]];
  return extended(MINI_GT, {
    items: [{ key: 't:widget_dust@0', name: 'Widget Dust' }],
    recipes: [
      { id: 'spin-1', map: 'gt.recipe.centrifuge', in: ingots(1), out: [['t:widget_dust@0', 1]], eut: 16, dur: 100 },
      { id: 'spin-2', map: 'gt.recipe.centrifuge', in: ingots(3), out: [['t:widget_dust@0', 1]], eut: 16, dur: 100 },
      { id: 'spin-3', map: 'gt.recipe.centrifuge', in: ingots(9), out: [['t:widget_dust@0', 1]], eut: 16, dur: 100 },
      { id: 'press-widget', map: 'gt.recipe.metalbender', in: ingots(27), out: [['t:widget_dust@0', 1]], eut: 16, dur: 100 },
    ],
  });
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

/**
 * Mini-GT plus a Bricked Furnace (1200, a multiblock of the map `gt.recipe.brickfurnace`; its controller is crafted from
 * 4 Firebricks, each from an iron ingot) whose exported structure, like the 2.9 export's Bricked Blast Furnace (two
 * `minecraft:lava@1` cells in its hollow), holds cells nothing is placed in: a 3 × 4 × 1 box of its controller and 4
 * Firebricks, lava in the hollow above the controller, water, flowing water and a BartWorks fluid block (a BioVat's fluid)
 * on the layer above, a `minecraft:air` block and two air cells on top. Its recipe `bake` makes a Steel Ingot from an
 * iron dust (4 EU/t × 100 t). Block ids of those cells are the real ones (`NOTHING_TO_PLACE` names them); nothing else is
 * game data.
 */
export function fluidCellsSpec(): PackSpec {
  type Cell = NonNullable<MachineSpec['structure']>['blocks'][number];
  const brick = { id: 't:firebrick', meta: 0 };
  const cell = (x: number, y: number, block: Cell['block']): Cell => ({ pos: [x, y, 0], block });
  const spec = extended(MINI_GT, {
    items: [{ key: 't:firebrick@0', name: 'Firebrick' }, { key: 't:steel_ingot@0', name: 'Steel Ingot', gt: { prefix: 'ingot', material: 'Steel' } }],
    machines: [{
      mteId: 1200, name: 'Bricked Furnace', kind: 'multiblock', maps: ['gt.recipe.brickfurnace'],
      structure: {
        size: [3, 4, 1], controller: [1, 0, 0], air: [[0, 3, 0], [2, 3, 0]],
        blocks: [
          cell(0, 0, brick), cell(1, 0, { id: 'gregtech:gt.blockmachines', meta: 1200, mteId: 1200 }), cell(2, 0, brick),
          cell(0, 1, brick), cell(1, 1, { id: 'minecraft:lava', meta: 1 }), cell(2, 1, brick),
          cell(0, 2, { id: 'minecraft:water', meta: 0 }), cell(1, 2, { id: 'minecraft:flowing_water', meta: 0 }),
          cell(2, 2, { id: 'bartworks:coloredFluidBlock', meta: 0 }), cell(1, 3, { id: 'minecraft:air', meta: 0 }),
        ],
      },
    }],
    recipes: [
      craft('make-firebrick', [['t:iron_ingot@0', 1]], 't:firebrick@0'),
      craft('make-1200', [['t:firebrick@0', 4]], 'machine:1200@0'),
      { id: 'bake', map: 'gt.recipe.brickfurnace', in: [['t:iron_dust@0', 1]], out: [['t:steel_ingot@0', 1]], eut: 4, dur: 100 },
    ],
  });
  return { ...spec, maps: [...(spec.maps ?? []), { id: 'gt.recipe.brickfurnace', name: 'Bricked Furnace' }] };
}

/** GTNH's "Any LV Circuit" (NewHorizonsCoreMod's stand-in that GT recipes take for any LV circuit), by its 2.9 export key. */
export const ANY_LV_CIRCUIT = 'dreamcraft:CircuitLV@0';

/**
 * Mini-GT plus the "Any LV Circuit" stand-in (`ANY_LV_CIRCUIT`, with the 2.9 export's GT association, circuit Basic, and
 * ore name, circuitBasic, which Mini-GT's Basic Circuit also has) and a Sensor that an assembler recipe makes from 2 of
 * the stand-in and an iron plate (`make-sensor`, 16 EU/t × 100 t), as GT's own recipes list it; the Advanced Bending
 * Machine (102) is crafted from an LV hull and a Sensor. At LV: 9 + 2 × 3 + 1 = 16.
 */
export function standInSpec(): PackSpec {
  return extended(MINI_GT, {
    items: [
      { key: ANY_LV_CIRCUIT, name: 'Any LV Circuit', oreDict: ['circuitBasic'], gt: { prefix: 'circuit', material: 'Basic', amount: -1 } },
      { key: 't:sensor@0', name: 'Sensor' },
    ],
    recipes: [
      { id: 'make-sensor', map: 'gt.recipe.assembler', in: [[ANY_LV_CIRCUIT, 2], ['t:iron_plate@0', 1]], out: [['t:sensor@0', 1]], eut: 16, dur: 100 },
      craft('make-102', [['t:hull_lv@0', 1], ['t:sensor@0', 1]], 'machine:102@0'),
    ],
  });
}

/** Mini-GT's parts of an LV machine, as Task 3's `make-102` takes them: an LV hull and 4 circuits (19 raw at MV). */
export const LV_MACHINE_PARTS: ReadonlyArray<[StuffKey, number]> = [['t:hull_lv@0', 1], ['t:circuit@0', 4]];

/**
 * `spec` plus a crafting recipe `make-<mteId>` for each machine of `mteIds` (default: every machine of the spec that no
 * recipe of it makes yet), taking `from` (default: nothing, so it costs nothing to build). Controller Amendment OQ3
 * never plans a machine no recipe makes as a new one, also with build cost ignored; a test written before it whose
 * subject is a route or tier on such a machine keeps that subject with one (ruling P3).
 */
export function withBuildRecipes(spec: PackSpec, mteIds?: readonly number[], from: ReadonlyArray<[StuffKey, number]> = []): PackSpec {
  const made = new Set((spec.recipes ?? []).flatMap((r) => (r.out ?? []).map(([key]) => key)));
  const machines = mteIds ?? (spec.machines ?? []).filter((m) => !made.has(m.itemKey ?? `machine:${m.mteId}@0`)).map((m) => m.mteId);
  const itemOf = (mteId: number): string => spec.machines?.find((m) => m.mteId === mteId)?.itemKey ?? `machine:${mteId}@0`;
  return extended(spec, { recipes: machines.map((mteId) => craft(`make-${mteId}`, [...from], itemOf(mteId))) });
}

/**
 * Mini-GT plus plan 09 Task 8's tie in build mode (build-plan.test.ts's "one source at a tie", plan-invariants.test.ts's
 * purchase beside a full step): `burn` (Basic Centrifuge 161, 16 EU/t × `dur` t) splits a Raw Dust into a Copper Ingot and
 * 1,000 L Gas, and `make-thing` (assembler, 2 EU/t) takes 2 copper ingots and 1,000 L gas into a Thing. Copper is also
 * mined, so burning a second dust (its gas left over) costs the raw material that buying the other ingot does. The
 * centrifuge is crafted from `from` (nothing: it builds for free).
 */
export function gasSpec(dur: number, from: ReadonlyArray<[StuffKey, number]> = []): PackSpec {
  const spec = structuredClone(MINI_GT);
  const vein = { name: 'ore.mix.raw', dims: ['overworld'], kind: 'vein' as const, weight: 1, minY: 0, maxY: 255, size: 1, density: 1,
    materials: { primary: 'Raw', secondary: 'Raw', between: 'Raw', sporadic: 'Raw' } };
  return withBuildRecipes({
    ...spec,
    items: [...(spec.items ?? []), { key: 't:raw_dust@0', name: 'Raw Dust', gt: { prefix: 'dust', material: 'Raw' } }, { key: 't:thing@0', name: 'Thing' }],
    fluids: [...(spec.fluids ?? []), { key: 'fluid:gas', name: 'Gas' }],
    recipes: [...(spec.recipes ?? []),
      { id: 'burn', map: 'gt.recipe.centrifuge', in: [['t:raw_dust@0', 1]], out: [['t:copper_ingot@0', 1], ['fluid:gas', 1000]], eut: 16, dur },
      { id: 'make-thing', map: 'gt.recipe.assembler', in: [['t:copper_ingot@0', 2], ['fluid:gas', 1000]], out: [['t:thing@0', 1]], eut: 2 }],
    worldgen: { ...spec.worldgen, veins: [...(spec.worldgen?.veins ?? []), vein] },
  }, [161], from);
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

/** GGFab's Single Use File as the 2.9 export keys it (bench-tools.ts reads its id and its `craftingTool…` ore name). */
export const SINGLE_USE_FILE = 'ggfab:gt.ggfab.d1@0';

/**
 * Mini-GT with the LV and MV Auto Workbenches (`withAutoWorkbenches`) and tool recipes (plan 12 Task 6, controller ruling
 * 214): items Iron Rod (`t:rod@0`), Iron Mash (`t:mash@0`), a File (`t:file@0`) and a Mortar (`t:mortar@0`) — tools —
 * and GGFab's Single Use File (`SINGLE_USE_FILE`, ore name `craftingToolFile`), which the Basic Assembler makes 64 at a
 * time from an iron ingot (`make-file`, 16 EU/t × 20 t); crafting recipes `rod-file` (an iron ingot and a file slot that
 * takes the Single Use File or the File, held: the loader gives it a bench variant) and `mash-mortar` (an iron ingot and
 * a Mortar, held: GGFab has no single-use mortar); the Basic Macerator (141, built here from 4 iron ingots) and its
 * `mash-mill` (6 iron ingots → 5 mash, 2 EU/t × 40 t). With `mill: false` no `mash-mill`.
 */
export function benchToolSpec(opts: { mill?: boolean } = {}): PackSpec {
  const spec = withBuildRecipes(withAutoWorkbenches(MINI_GT, [1, 2]), [141], [['t:iron_ingot@0', 4]]);
  return extended(spec, {
    items: [
      { key: 't:rod@0', name: 'Iron Rod' }, { key: 't:mash@0', name: 'Iron Mash' }, { key: 't:file@0', name: 'File' },
      { key: 't:mortar@0', name: 'Mortar' }, { key: SINGLE_USE_FILE, name: 'Single Use File', oreDict: ['craftingToolFile'] },
    ],
    recipes: [
      { id: 'make-file', map: 'gt.recipe.assembler', in: [['t:iron_ingot@0', 1]], out: [[SINGLE_USE_FILE, 64]], eut: 16, dur: 20 },
      { id: 'rod-file', map: 'crafting', in: [{ ncAny: [SINGLE_USE_FILE, 't:file@0'] }, ['t:iron_ingot@0', 1]], out: [['t:rod@0', 1]] },
      { id: 'mash-mortar', map: 'crafting', in: [{ nc: 't:mortar@0' }, ['t:iron_ingot@0', 1]], out: [['t:mash@0', 1]] },
      ...(opts.mill === false ? [] : [{ id: 'mash-mill', map: 'gt.recipe.macerator', in: [['t:iron_ingot@0', 6]], out: [['t:mash@0', 5]], eut: 2, dur: 40 } satisfies RecipeSpec]),
    ],
  });
}

/** Nine goods a Mini-GT line gets at LV without a step (`gizmoSpec`): a crafting recipe of all nine fills a bench. */
export const NINE_KINDS: readonly StuffKey[] = [
  't:iron_ingot@0', 't:copper_ingot@0', 't:tin_ingot@0', 't:redstone@0', 't:iron_dust@0', 't:copper_dust@0', 't:tin_dust@0', 'minecraft:log@0',
  'minecraft:cobblestone@0',
];

/**
 * Mini-GT with the LV and MV Auto Workbenches and a Gizmo (`t:gizmo@0`) crafted from one each of `NINE_KINDS` (`gizmo`,
 * a shapeless crafting recipe): one craft needs all nine of a bench's input slots, so no Project Red or EnderIO line can
 * keep its stock safely (plan 12 Task 6, controller ruling 214 (c)). Copper Dust and Tin Dust are new base items of
 * their materials.
 */
export function gizmoSpec(): PackSpec {
  return extended(withAutoWorkbenches(MINI_GT, [1, 2]), {
    items: [
      { key: 't:gizmo@0', name: 'Gizmo' },
      { key: 't:copper_dust@0', name: 'Copper Dust', gt: { prefix: 'dust', material: 'Copper' } },
      { key: 't:tin_dust@0', name: 'Tin Dust', gt: { prefix: 'dust', material: 'Tin' } },
    ],
    recipes: [craft('gizmo', NINE_KINDS.map((key): [string, number] => [key, 1]), 't:gizmo@0')],
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

/**
 * `solderSpec()` as a pack a whole line plans on (Task 8's synthetic horizon flip): its goods with GT data (`t:part@0`
 * Partium Dust, `t:tin_ingot@0` Tin Ingot, `t:antimony@0` Antimony Dust, `t:iron_ingot@0` Iron Ingot), one overworld
 * vein `ore.mix.solder` (primary Tin, secondary Antimony, between Partium, sporadic Iron; weight 100, y 10–60, size 32,
 * density 3) so each is mined at 1 raw, and the crafting recipes that build its machines: `make-121` (16 iron ingots →
 * the Basic Assembler), `make-131` (12 → the Basic Fluid Extractor) and `make-201` (20 → the Basic Alloy Smelter). The
 * tin route then builds 28 and the solder route 48.
 */
export function solderPackSpec(): PackSpec {
  const spec = solderSpec();
  return {
    ...spec,
    items: [
      { key: 't:part@0', name: 'Partium Dust', gt: { prefix: 'dust', material: 'Partium' } },
      { key: 't:tin_ingot@0', name: 'Tin Ingot', gt: { prefix: 'ingot', material: 'Tin' } },
      { key: 't:antimony@0', name: 'Antimony Dust', gt: { prefix: 'dust', material: 'Antimony' } },
      { key: 't:iron_ingot@0', name: 'Iron Ingot', gt: { prefix: 'ingot', material: 'Iron' } },
    ],
    maps: [...(spec.maps ?? []), { id: 'crafting', name: 'Crafting' }],
    recipes: [
      ...(spec.recipes ?? []),
      craft('make-121', [['t:iron_ingot@0', 16]], 'machine:121@0'),
      craft('make-131', [['t:iron_ingot@0', 12]], 'machine:131@0'),
      craft('make-201', [['t:iron_ingot@0', 20]], 'machine:201@0'),
    ],
    worldgen: {
      veins: [{
        name: 'ore.mix.solder', dims: ['overworld'], kind: 'vein', weight: 100, minY: 10, maxY: 60, size: 32, density: 3,
        materials: { primary: 'Tin', secondary: 'Antimony', between: 'Partium', sporadic: 'Iron' },
      }],
    },
  };
}

/**
 * Molten Tin from Tin Dust or from a Tin Ingot (the plan 12 fix wave 2 review's twin recipes, as the 2.9 export's Fluid
 * Extractor has them): maps fluid extractor, assembler and alloy smelter; machines 121 Basic Assembler, 131 Basic Fluid
 * Extractor and 201 Basic Alloy Smelter (LV); `x-dust` (1 tin dust → 144 L molten tin) and `x-ingot` (1 tin ingot →
 * 144 L), each 30 EU/t × 40 t, and `board-tin` (1 part + 144 L molten tin → 1 board), 16 × 100; with `roast` also
 * `roast` (1 ore → 1 slag + 1 tin ingot, alloy smelter, 16 × 200), so a line that takes slag makes tin ingots too; with
 * `ingots` `x-ingot` takes that many ingots; with `foil` also `foil` (1 tin ingot or 1 tin dust, as `foil` says → 1 tin
 * foil, alloy smelter, 16 × 100), so a line that takes foil buys that form for another step; with `solder` the solder
 * twins `s-dd`, `s-id` and `s-ii` (9 tin dust or ingots and 1 antimony dust or ingot → 10 solder dust, alloy smelter,
 * 16 × 200, no `s-di`): a chain of twins over two goods.
 */
export function twinSpec(opts: { roast?: boolean; ingots?: number; foil?: 'dust' | 'ingot'; solder?: boolean } = {}): PackSpec {
  const extra: RecipeSpec[] = opts.roast === true
    ? [{ id: 'roast', map: ALLOY_SMELTER, in: [['t:ore@0', 1]], out: [['t:slag@0', 1], ['t:tin_ingot@0', 1]], eut: 16, dur: 200 }] : [];
  if (opts.foil !== undefined) {
    extra.push({ id: 'foil', map: ALLOY_SMELTER, in: [[`t:tin_${opts.foil}@0`, 1]], out: [['t:tin_foil@0', 1]], eut: 16, dur: 100 });
  }
  if (opts.solder === true) {
    for (const [id, tin, antimony] of [['s-dd', 'dust', 'dust'], ['s-id', 'ingot', 'dust'], ['s-ii', 'ingot', 'ingot']] as const) {
      extra.push({ id, map: ALLOY_SMELTER, in: [[`t:tin_${tin}@0`, 9], [`t:antimony_${antimony}@0`, 1]], out: [['t:solder_dust@0', 10]], eut: 16, dur: 200 });
    }
  }
  return {
    maps: [{ id: EXTRACTOR, name: 'Fluid Extractor' }, { id: ASSEMBLER, name: 'Assembler' }, { id: ALLOY_SMELTER, name: 'Alloy Smelter' }],
    machines: [
      { mteId: 121, name: 'Basic Assembler', tier: 1, maps: [ASSEMBLER] },
      { mteId: 131, name: 'Basic Fluid Extractor', tier: 1, maps: [EXTRACTOR] },
      { mteId: 201, name: 'Basic Alloy Smelter', tier: 1, maps: [ALLOY_SMELTER] },
    ],
    recipes: [
      { id: 'x-dust', map: EXTRACTOR, in: [['t:tin_dust@0', 1]], out: [['fluid:molten.tin', 144]], eut: 30, dur: 40 },
      { id: 'x-ingot', map: EXTRACTOR, in: [['t:tin_ingot@0', opts.ingots ?? 1]], out: [['fluid:molten.tin', 144]], eut: 30, dur: 40 },
      { id: 'board-tin', map: ASSEMBLER, in: [['t:part@0', 1], ['fluid:molten.tin', 144]], out: [['t:board@0', 1]], eut: 16, dur: 100 },
      ...extra,
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
  /** Goods of `leafCosts` bought as derived materials (`leafClass` 'derived', a chain of one recipe): R3's derived purchases. */
  derived?: StuffKey[];
}

/**
 * Plan 09's `charged()` with a build model (Task 4): the goods of `leafCosts` bought at their cost (`leafClass` 'direct',
 * `alsoMade` for those of `build.alsoMade`; 'derived' with `steps` 1 for those of `build.derived`), the graph walked from
 * the keys of `demand` at LV, and `solveLine` with `{ stepCharge: 0, handWeight: 1, ...opts, build }`, where the model's
 * `options` and `eligible` are the given lists (none for other ids), `sharingKey` is Task 3's of the recipe and its
 * graph recipe's held items (AE2's keys: the Project Red split is `lineBuildModel`'s), `owned` and `pools` come from the
 * options' `owned` (per mteId the largest, units without positions), prices price nothing, nothing is blocked or pinned,
 * and `ownedOnly` is the owned machines of a step none of whose options can add machines; defaults rate mode over 24
 * hours, no sharing, no cleanroom. `runs` = the sorted ids of the step recipes that run.
 */
export async function solvedWithBuild(
  spec: PackSpec, leafCosts: Record<StuffKey, number>, demand: Array<[StuffKey, number]>, build: BuildSetup, opts?: SolveOptions,
): Promise<{ runs: string[]; sol: Solution }> {
  const pack = packFromSpec(spec);
  const also = new Set(build.alsoMade ?? []);
  const derived = new Set(build.derived ?? []);
  const leaf: LeafOracle = (key): LeafDecision => {
    if (!Object.hasOwn(leafCosts, key)) return { buyable: false, cost: 0, leafClass: null };
    const cost = leafCosts[key] as number;
    const bought: LeafDecision = derived.has(key) ? { buyable: true, cost, leafClass: 'derived', steps: 1 } : { buyable: true, cost, leafClass: 'direct' };
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
