// The synthetic farm pack of add-on 17's tests (Tasks 2–10): Mini-GT plus a rubber tree and an oak on the Tree Growth
// Simulator's map (fake rows with the modes of their outputs, as the loader keeps the export's), the centrifuge,
// macerator and assembler rows that turn rubber wood and resin into a Resin Board, the Tree Growth Simulator and two Crop
// Managers with what crafts them, crop sticks, and three crop cards in the shapes of farms.md §2.8's Sticky Cane, Rubber
// Bonsai and Ferrofern, and a fourth in the shape of a farmland crop whose soils start with an exotic block (the final
// review), with the assembler row that weaves its drop into Linen. Names and numbers are invented, nothing is game data,
// except the keys the farm code names (GT's tools, CropsNH's crop sticks and fertilizer, vanilla bone meal, dirt and
// farmland), as Mini-GT keeps the real programmed-circuit key. `farmSpec()` and `farmPack()` return fresh objects, so a
// test that changes one changes no other (and never MINI_GT); the cards are shared constants, which a test copies to
// change (`{ ...RESIN_CANE, tier: 12 }`). Also the small pack of the cross-project tests (`crossSpec()`, Task 6): one
// line's byproduct another line uses.

import type { CropCard, Pack } from '../../src/shared/types/pack.ts';
import { MINI_GT } from './mini-gt.ts';
import { packFromSpec, type PackSpec } from './pack-spec.ts';

/** Sticky Cane's shape: tier 4, 200 growth points, the default drop chance 0.95⁴, one Sticky Resin a round. */
export const RESIN_CANE: CropCard = {
  id: 'cropsnh:testCane', name: 'Resin Cane', tier: 4, growthDuration: 200, dropChance: 0.81450625,
  drops: [{ key: 't:resin@0', chance: 1, stackSize: 1 }], likedBiomes: ['HOT', 'SANDY', 'WET'], soils: ['minecraft:dirt@0'],
  requirements: [], seed: 't:cane_seed@0', minSeedBedTier: 0,
};

/** The Rubber Bonsai's shape: tier 1, 1200 growth points, drop chance 0.95; saplings, ten logs and two resin a success. */
export const RUBBER_BONSAI: CropCard = {
  id: 'cropsnh:testBonsai', name: 'Rubber Bonsai', tier: 1, growthDuration: 1200, dropChance: 0.95,
  drops: [
    { key: 't:rubber_sapling@0', chance: 0.3, stackSize: 1 }, { key: 't:rubber_wood@0', chance: 0.6, stackSize: 10 },
    { key: 't:resin@0', chance: 0.05, stackSize: 2 },
  ],
  likedBiomes: ['FOREST'], soils: ['minecraft:dirt@0'], requirements: [], seed: null, minSeedBedTier: 0,
};

/** Ferrofern's shape: tier 6, 2800 growth points, one iron dust a round, and a sub-soil block it needs under its soil. */
export const ORE_FERN: CropCard = {
  id: 'cropsnh:testFern', name: 'Ore Fern', tier: 6, growthDuration: 2800, dropChance: 0.735091890625,
  drops: [{ key: 't:iron_dust@0', chance: 1, stackSize: 1 }], likedBiomes: [], soils: ['minecraft:dirt@0'],
  requirements: ['sub-soil'], seed: null, minSeedBedTier: 0,
};

/**
 * A farmland crop's shape (CropsNH's Flax, Sugar Beet and 27 more on the 2.9 export, the final review of add-on 17): tier
 * 2, 400 growth points, the default drop chance 0.95², one Flax a round; its soils an exotic block nothing makes first
 * (MagicBees' Enchanted Earth there), then one crafted from dirt (Garden Soil), then vanilla farmland, which the group
 * hoes from dirt. So a farm of it is planted on Farmland, never on its first soil.
 */
export const FIELD_FLAX: CropCard = {
  id: 'cropsnh:testFlax', name: 'Field Flax', tier: 2, growthDuration: 400, dropChance: 0.9025,
  drops: [{ key: 't:flax@0', chance: 1, stackSize: 1 }], likedBiomes: [],
  soils: ['t:enchanted_earth@0', 't:garden_soil@0', 'minecraft:farmland@0'], requirements: [], seed: 't:flax_seed@0', minSeedBedTier: 0,
};

/**
 * Mini-GT plus the farm goods, maps, machines and recipes above. The Tree Growth Simulator (15541) is crafted from 20
 * titanium dust and 4 circuits: Mini-GT mines titanium dust on the Moon, which progression reaches at HV, so a TGS can be
 * built from HV on and not at MV (titanium plates would need Mini-GT's EBF, whose controller nothing makes). The Basic
 * Crop Manager (28001) is crafted as Mini-GT's LV machines are, and the Advanced one (28002) from two Basic ones. So are
 * Mini-GT's Basic Macerator (141) and Basic Centrifuge (161), which the rubber recipes run on (add-on 17 Task 4): without
 * a recipe neither can be built, and with build cost counted (add-on 12) no line of the pack would plan.
 */
export function farmSpec(): PackSpec {
  const spec = structuredClone(MINI_GT);
  return {
    ...spec,
    items: [
      ...(spec.items ?? []),
      { key: 't:rubber_wood@0', name: 'Rubber Wood', oreDict: ['logWood'] },
      { key: 't:rubber_sapling@0', name: 'Rubber Sapling' },
      { key: 't:rubber_leaves@0', name: 'Rubber Leaves', oreDict: ['treeLeaves'] },
      { key: 't:resin@0', name: 'Sticky Resin' },
      { key: 't:oak_sapling@0', name: 'Oak Sapling' },
      { key: 't:oak_leaves@0', name: 'Oak Leaves' },
      { key: 't:apple@0', name: 'Apple' },
      { key: 't:carbon_dust@0', name: 'Carbon Dust', gt: { prefix: 'dust', material: 'Carbon' } },
      { key: 't:pulp@0', name: 'Wood Pulp', gt: { prefix: 'dust', material: 'Wood' } },
      { key: 't:plantball@0', name: 'Plantball' },
      { key: 't:rubber_dust@0', name: 'Raw Rubber Dust', gt: { prefix: 'dust', material: 'RawRubber' } },
      { key: 't:resin_board@0', name: 'Resin Board' },
      { key: 't:steel_ingot@0', name: 'Steel Ingot', gt: { prefix: 'ingot', material: 'Steel' } },
      { key: 't:cane_seed@0', name: 'Resin Cane Seeds' },
      { key: 'gregtech:gt.metatool.01@10', name: 'Saw' },
      { key: 'gregtech:gt.metatool.01@30', name: 'Branch Cutter' },
      { key: 'gregtech:gt.metatool.01@26', name: 'Wire Cutter' },
      { key: 'gregtech:gt.metatool.01@34', name: 'Knife' },
      { key: 'cropsnh:cropSticks@0', name: 'Crop Sticks' },
      { key: 'cropsnh:fertilizer@0', name: 'Fertilizer' },
      { key: 'minecraft:dye@15', name: 'Bone Meal' },
      { key: 'minecraft:dirt@0', name: 'Dirt' },
      // the farmland crop (`FIELD_FLAX`): its drop (gathered, as a crop's ore name says), what is woven of it, its seeds and soils
      { key: 't:flax@0', name: 'Flax', oreDict: ['cropFlax'] },
      { key: 't:linen@0', name: 'Linen' },
      { key: 't:flax_seed@0', name: 'Field Flax Seeds' },
      { key: 't:enchanted_earth@0', name: 'Enchanted Earth' },
      { key: 't:garden_soil@0', name: 'Garden Soil' },
      { key: 'minecraft:farmland@0', name: 'Farmland' },
    ],
    fluids: [...(spec.fluids ?? []), { key: 'fluid:refinedglue', name: 'Refined Glue' }, { key: 'fluid:methane', name: 'Methane' }],
    maps: [...(spec.maps ?? []), { id: 'gt.recipe.treefarm', name: 'Tree Growth Simulator' }],
    machines: [
      ...(spec.machines ?? []),
      {
        mteId: 15541, name: 'Tree Growth Simulator', kind: 'multiblock', maps: ['gt.recipe.treefarm'],
        structure: { size: [7, 7, 7], controller: [3, 0, 0], blocks: [], air: [] },
      },
      { mteId: 28001, name: 'Basic Crop Manager', kind: 'other', tier: 1, maps: [] },
      { mteId: 28002, name: 'Advanced Crop Manager', kind: 'other', tier: 2, maps: [] },
    ],
    recipes: [
      ...(spec.recipes ?? []),
      // The export's tree farm rows: fake, eut 0, the products of the four modes with ×1 tools and no tier multiplier
      {
        id: 'tgs-rubber', map: 'gt.recipe.treefarm', dur: 100, flags: { fake: true },
        out: [['t:rubber_wood@0', 5], ['t:rubber_sapling@0', 5], ['t:rubber_leaves@0', 2], ['t:resin@0', 1]],
        meta: { specialItem: 't:rubber_sapling@0', tgsModes: ['log', 'sapling', 'leaves', 'fruit'] },
      },
      {
        id: 'tgs-oak', map: 'gt.recipe.treefarm', dur: 100, flags: { fake: true },
        out: [['minecraft:log@0', 5], ['t:oak_sapling@0', 5], ['t:oak_leaves@0', 2], ['t:apple@0', 1]],
        meta: { specialItem: 't:oak_sapling@0', tgsModes: ['log', 'sapling', 'leaves', 'fruit'] },
      },
      {
        id: 'cf-wood', map: 'gt.recipe.centrifuge', in: [['t:rubber_wood@0', 1]],
        out: [['t:resin@0', 1, 0.5], ['t:plantball@0', 1, 0.375], ['t:carbon_dust@0', 1, 0.25], ['t:pulp@0', 1, 0.25], ['fluid:methane', 60]],
        eut: 20, dur: 200,
      },
      {
        id: 'cf-resin', map: 'gt.recipe.centrifuge', in: [['t:resin@0', 1]],
        out: [['t:rubber_dust@0', 3], ['t:plantball@0', 1, 0.1], ['fluid:refinedglue', 100]], eut: 5, dur: 300,
      },
      { id: 'mace-wood', map: 'gt.recipe.macerator', in: [['t:rubber_wood@0', 1]], out: [['t:pulp@0', 6]], eut: 2, dur: 400 },
      {
        id: 'resin-board', map: 'gt.recipe.assembler', in: [['t:carbon_dust@0', 1], ['t:pulp@0', 2], ['fluid:refinedglue', 100]],
        out: [['t:resin_board@0', 1]], eut: 16, dur: 100,
      },
      { id: 'make-28001', map: 'crafting', in: [['t:hull_lv@0', 1], ['t:circuit@0', 2], ['t:iron_plate@0', 2]], out: [['machine:28001@0', 1]] },
      { id: 'make-28002', map: 'crafting', in: [['machine:28001@0', 2]], out: [['machine:28002@0', 1]] },
      { id: 'make-15541', map: 'crafting', in: [['t:titanium_dust@0', 20], ['t:circuit@0', 4]], out: [['machine:15541@0', 1]] },
      { id: 'make-141', map: 'crafting', in: [['t:hull_lv@0', 1], ['t:circuit@0', 2], ['t:iron_plate@0', 2]], out: [['machine:141@0', 1]] },
      { id: 'make-161', map: 'crafting', in: [['t:hull_lv@0', 1], ['t:circuit@0', 2], ['t:copper_wire@0', 4]], out: [['machine:161@0', 1]] },
      { id: 'sticks', map: 'crafting', in: [['minecraft:planks@0', 1]], out: [['cropsnh:cropSticks@0', 2]] },
      { id: 'weave', map: 'gt.recipe.assembler', in: [['t:flax@0', 4]], out: [['t:linen@0', 1]], eut: 16, dur: 100 },
      { id: 'garden-soil', map: 'crafting', in: [['minecraft:dirt@0', 2]], out: [['t:garden_soil@0', 1]] },
    ],
  };
}

/** `farmSpec()` as a pack, with the crop table `[RESIN_CANE, RUBBER_BONSAI, ORE_FERN, FIELD_FLAX]` (copies). */
export function farmPack(): Pack {
  const pack = packFromSpec(farmSpec());
  pack.crops = structuredClone([RESIN_CANE, RUBBER_BONSAI, ORE_FERN, FIELD_FLAX]);
  return pack;
}

/**
 * Mini-GT plus the goods of add-on 17's cross-project tests (Task 6) — a Tee (`t:t@0`), a Wye (`t:y@0`) and a Cue
 * (`t:q@0`) — and three assembler recipes between them, 16 EU/t for 100 ticks each: `split` makes a Tee and a Wye from an
 * iron ingot, `use-y` a Cue from a Wye, and `make-y` two Wyes from a copper ingot, cheaper per Wye than running `split`
 * for it. So a project making Tees has Wyes to spare for one making Cues. A fresh copy on every call.
 */
export function crossSpec(): PackSpec {
  const spec = structuredClone(MINI_GT);
  return {
    ...spec,
    items: [...(spec.items ?? []), { key: 't:t@0', name: 'Tee' }, { key: 't:y@0', name: 'Wye' }, { key: 't:q@0', name: 'Cue' }],
    recipes: [
      ...(spec.recipes ?? []),
      { id: 'split', map: 'gt.recipe.assembler', in: [['t:iron_ingot@0', 1]], out: [['t:t@0', 1], ['t:y@0', 1]], eut: 16, dur: 100 },
      { id: 'use-y', map: 'gt.recipe.assembler', in: [['t:y@0', 1]], out: [['t:q@0', 1]], eut: 16, dur: 100 },
      { id: 'make-y', map: 'gt.recipe.assembler', in: [['t:copper_ingot@0', 1]], out: [['t:y@0', 2]], eut: 16, dur: 100 },
    ],
  };
}
