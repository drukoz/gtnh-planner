// Synthetic fixtures of plan 12's build-cost tests (Tasks 2–8): Mini-GT with a multiblock bender and the hatches it is
// built and run with, and machines whose crafting chain has a pricing gap. Everything here is invented, nothing is game
// data. Every helper returns a fresh spec, so a test that changes one changes no other (and never MINI_GT itself).

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
