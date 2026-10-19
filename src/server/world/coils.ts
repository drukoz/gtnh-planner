// Electric Blast Furnace coil heat (gt-mechanics §6.4): the EBF's heat comes from the lowest coil of the two coil
// layers around its hollow middle, so the scan reads the 8 ring blocks of each layer behind the controller.
// Architecture §11.19: `cls` is the fully qualified class name, so the EBF is recognised by its simple name.

import type { BlockReader } from './area.ts';
import type { GtMachineRec } from './classify/gt.ts';
import { simpleClassName } from './facts.ts';
import { DIRS, type Vec3 } from './model.ts';

/** The block of every GregTech heating coil; its meta names the coil. */
export const COIL_BLOCK = 'gregtech:gt.blockcasings5';

/**
 * Coil heat in kelvin by `gt.blockcasings5` meta (GT `BlockCasings5.getCoilHeat` order): Cupronickel, Kanthal,
 * Nichrome, TPV, HSS-G, Naquadah, Naquadah Alloy, Electrum Flux, Awakened Draconium, HSS-S, Trinium, Infinity,
 * Hypogen, Eternal.
 */
export const COIL_HEAT_BY_META: Readonly<Record<number, number>> = Object.freeze({
  0: 1801, 1: 2701, 2: 3601, 3: 4501, 4: 5401, 5: 7201, 6: 8101, 7: 9901, 8: 10801, 9: 6301, 10: 9001, 11: 11701, 12: 12601, 13: 13501,
});

const EBF_CLASS = 'MTEElectricBlastFurnace';
const EBF_MTE_ID = 1000;

/** An EBF controller: by the simple name of its class; only a machine without a class falls back to mteId 1000. */
export function isEbf(m: Pick<GtMachineRec, 'mteId' | 'cls'>): boolean {
  return m.cls === null ? m.mteId === EBF_MTE_ID : simpleClassName(m.cls) === EBF_CLASS;
}

/**
 * The coil heat of an EBF whose controller sits at `controller` facing `facing` (a ForgeDirection ordinal): the
 * middle column is one block behind the controller (`controller − DIRS[facing]`), and the 8 blocks around it at
 * y + 1 and y + 2 must all be coils of a known meta. The lowest coil's heat, else null (a broken or unreadable ring).
 */
export async function ebfCoilHeat(
  reader: BlockReader, blockNames: Map<number, string>, dim: number, controller: Vec3, facing: number,
): Promise<number | null> {
  const front = DIRS[facing];
  if (front === undefined) return null;
  const [x, y, z] = [controller[0] - front[0], controller[1] - front[1], controller[2] - front[2]];
  let lowest: number | null = null;
  for (let dy = 1; dy <= 2; dy++) {
    for (let dz = -1; dz <= 1; dz++) {
      for (let dx = -1; dx <= 1; dx++) {
        if (dx === 0 && dz === 0) continue;
        const block = await reader.blockAt(dim, x + dx, y + dy, z + dz);
        if (block === null || blockNames.get(block.id) !== COIL_BLOCK) return null;
        const heat = Object.hasOwn(COIL_HEAT_BY_META, block.meta) ? COIL_HEAT_BY_META[block.meta] : undefined;
        if (heat === undefined) return null;
        lowest = lowest === null ? heat : Math.min(lowest, heat);
      }
    }
  }
  return lowest;
}
