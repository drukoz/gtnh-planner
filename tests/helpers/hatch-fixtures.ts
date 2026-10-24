// Multiblocks for the hatch-rule tests (hatch-rules.ts, research hatch-rules.md): a distillation tower, an oil
// cracker, a pyrolyse oven, a bricked blast furnace, a steam mixer and a large bronze boiler, each with the structure
// GT's shape gives it in the export frame (front on north, a running west), added to `layoutPack()` with the hatches
// they need. The structures are built from the rows' own shapes; the real-data test checks the rows against the real
// export. Synthetic otherwise: ids, names and recipes are invented, only the class names and shapes follow GT.

import { elementMap, hatchRuleFor } from '../../src/server/layout/hatch-rules.ts';
import { posKey, type Vec3 } from '../../src/shared/layout/geometry.ts';
import { gtMachineId } from '../../src/shared/ids.ts';
import type { BlockRef, Fluid, Machine, Pack, Recipe, StructureInfo } from '../../src/shared/types/pack.ts';
import { layoutPack } from './layout-fixtures.ts';

export const HATCH_IDS = {
  DT: 1126, CRACKER: 1160, PYRO: 15546, BBF: 140, STEAM_MIXER: 31084, STEAM_BUS_IN: 31046, STEAM_BUS_OUT: 31047, STEAM_HATCH: 31040,
  BOILER: 15529,
} as const;

const GT_BLOCK = 'gregtech:gt.blockmachines';
const MULTI = 'gregtech.common.tileentities.machines.multi.';
const CASING4: BlockRef = { id: 'gregtech:gt.blockcasings4', meta: 1 };
const COIL: BlockRef = { id: 'gregtech:gt.blockcasings5', meta: 0 };

/**
 * The structure of `cls`'s row with its controller at `controller` in a box of `size`: a block for every element
 * character `blockOf` names (the controller for '~'), air for '-', nothing for any other character.
 */
function ruleStructure(cls: string, mteId: number, controller: Vec3, size: Vec3, blockOf: Readonly<Record<string, BlockRef>>, skip: readonly Vec3[] = []): StructureInfo {
  const rule = hatchRuleFor({ cls: `${MULTI}${cls}` })!;
  const skipped = new Set(skip.map(posKey));
  const blocks: StructureInfo['blocks'] = [];
  const air: StructureInfo['air'] = [];
  for (const [key, ch] of elementMap(rule, controller, size)) {
    const pos = key.split(',').map(Number) as Vec3;
    if (skipped.has(key)) continue;
    if (ch === '~') blocks.push({ pos, block: { id: GT_BLOCK, meta: 2, mteId } });
    else if (ch === '-') air.push(pos);
    else if (blockOf[ch] !== undefined) blocks.push({ pos, block: { ...blockOf[ch]! } });
  }
  const order = (a: Vec3, b: Vec3) => a[1] - b[1] || a[2] - b[2] || a[0] - b[0];
  blocks.sort((a, b) => order(a.pos, b.pos));
  air.sort(order);
  return { size: [...size], controller: [...controller], blocks, air };
}

/** A 3 × 3 × 3 distillation tower: the base, one layer (its middle empty) and the top. */
export function dtStructure(): StructureInfo {
  return ruleStructure('MTEDistillationTower', HATCH_IDS.DT, [1, 0, 0], [3, 3, 3], { b: CASING4, l: CASING4, c: CASING4 }, [[1, 1, 1]]);
}

function multi(mteId: number, name: string, cls: string, structure: StructureInfo, maps: string[] = []): Machine {
  return { id: gtMachineId(mteId), mteId, metaName: `multimachine.${mteId}`, name, cls: `${MULTI}${cls}`, itemKey: `${GT_BLOCK}@${mteId}`, kind: 'multiblock', maps, structure };
}

function hatch(mteId: number, name: string, cls: string): Machine {
  return { id: gtMachineId(mteId), mteId, metaName: `hatch.${mteId}`, name, cls, itemKey: `${GT_BLOCK}@${mteId}`, kind: 'hatch', tier: 0, maps: [] };
}

function fluid(name: string, display: string): Fluid {
  return { key: `fluid:${name}`, id: name, name: display, temperature: 300, gas: false, molten: false };
}

/** `layoutPack()` with the six multiblocks, the steam hatches and the fluids their tests use. */
export function hatchPack(): Pack {
  const pack = layoutPack();
  const add = (m: Machine): void => {
    pack.machines.set(m.mteId, m);
    pack.items.set(m.itemKey, { key: m.itemKey, id: GT_BLOCK, meta: m.mteId, name: m.name, oreDict: [] });
  };
  add(multi(HATCH_IDS.DT, 'Distillation Tower', 'MTEDistillationTower', dtStructure()));
  add(multi(HATCH_IDS.CRACKER, 'Oil Cracking Unit', 'MTEOilCracker',
    ruleStructure('MTEOilCracker', HATCH_IDS.CRACKER, [2, 1, 0], [5, 3, 3], { l: CASING4, r: CASING4, m: CASING4, c: COIL })));
  add(multi(HATCH_IDS.PYRO, 'Pyrolyse Oven', 'MTEPyrolyseOven', ruleStructure('MTEPyrolyseOven', HATCH_IDS.PYRO, [3, 1, 0], [7, 6, 5], {
    D: { id: 'gregtech:gt.blockcasingsNH', meta: 2 }, F: { id: 'gregtech:gt.blockcasingsNH', meta: 2 }, G: { id: 'gregtech:gt.blockcasingsNH', meta: 2 },
    B: { id: 'gregtech:gt.blockcasings3', meta: 14 }, C: COIL, A: { id: 'gregtech:gt.blockcasings2', meta: 13 }, E: { id: 'gregtech:gt.blockframes', meta: 305 },
  })));
  add(multi(HATCH_IDS.BBF, 'Bricked Blast Furnace', 'MTEBrickedBlastFurnace', ruleStructure('MTEBrickedBlastFurnace', HATCH_IDS.BBF, [1, 1, 0], [3, 4, 3], {
    c: { id: 'gregtech:gt.blockcasings4', meta: 15 }, l: { id: 'minecraft:lava', meta: 1 },
  })));
  add(multi(HATCH_IDS.STEAM_MIXER, 'Steam Blender', 'steam.MTESteamMixer', ruleStructure('MTESteamMixer', HATCH_IDS.STEAM_MIXER, [2, 1, 0], [5, 4, 5], {
    A: { id: 'gregtech:gt.blockcasings', meta: 10 }, B: { id: 'gregtech:gt.blockcasings2', meta: 2 }, C: { id: 'gregtech:gt.blockcasings2', meta: 12 },
    D: { id: 'gregtech:gt.blockframes', meta: 300 },
  })));
  // MTELargeBoilerBase's raw shape (not transposed): 5 wide, 6 high, 3 deep, the controller one above the fireboxes
  add(multi(HATCH_IDS.BOILER, 'Large Bronze Boiler', 'MTELargeBoilerBronze', ruleStructure('MTELargeBoilerBronze', HATCH_IDS.BOILER, [2, 1, 0], [5, 6, 3], {
    C: { id: 'gregtech:gt.blockcasings', meta: 10 }, F: { id: 'gregtech:gt.blockcasings3', meta: 13 }, P: { id: 'gregtech:gt.blockcasings2', meta: 12 },
  })));
  const GTPP = 'gtPlusPlus.xmod.gregtech.api.metatileentity.implementations.';
  add(hatch(HATCH_IDS.STEAM_BUS_IN, 'Input Bus (Steam)', `${GTPP}MTEHatchSteamBusInput`));
  add(hatch(HATCH_IDS.STEAM_BUS_OUT, 'Output Bus (Steam)', `${GTPP}MTEHatchSteamBusOutput`));
  add(hatch(HATCH_IDS.STEAM_HATCH, 'Steam Hatch', `${GTPP}base.MTEHatchCustomFluidBase`));
  for (const f of [fluid('steam', 'Steam'), fluid('heavyfuel', 'Heavy Fuel'), fluid('crackedheavy', 'Steam-Cracked Heavy Fuel'),
    fluid('aaa', 'First by Name'), fluid('zzz', 'Last by Name'), fluid('mmm', 'Middle by Name'), fluid('nnn', 'Next by Name'), fluid('woodtar', 'Wood Tar'),
    fluid('water', 'Water'), fluid('creosote', 'Creosote Oil')]) {
    pack.fluids.set(f.key, f);
  }
  return pack;
}

/** A GT recipe `id` with these fluid inputs (slots from 100, in order) and outputs, for a step whose recipeId is `id`. */
export function fluidRecipe(id: string, fluidIn: readonly string[], outputs: ReadonlyArray<readonly [string, number]>): Recipe {
  return {
    id, source: 'gt', maps: [], euPerTick: 30, durationTicks: 20, amps: 1, specialValue: 0, meta: {}, flags: {},
    inputs: fluidIn.map((key, i) => ({ options: [{ key, amount: 100 }], consumed: true, chance: 1, slot: 100 + i })),
    outputs: outputs.map(([key, amount]) => ({ key, amount, chance: 1 })),
  };
}
