// Multiblocks with GT's hatch rules from the export (exporter 0.6.0, architecture §11.49) for the layout tests of
// add-on 20: `withElements` gives a structure the elements a probe would have recorded, `rowElements` builds them from
// the characters of a hatch-rules row, and `hatchExportPack()` is the hatch-rules fix's `hatchPack()` plus two test
// multiblocks no row knows (a front box and a steam box, the way the export gives GT++'s steam multiblocks: kind
// `multiblock`) and four test fluids. Synthetic: ids, names and recipes are invented, only the class names follow GT.

import { elementMap, hatchRuleFor } from '../../src/server/layout/hatch-rules.ts';
import type { ExportHatchKind } from '../../src/shared/gt/hatch-kinds.ts';
import { gtMachineId } from '../../src/shared/ids.ts';
import { posKey, type Vec3 } from '../../src/shared/layout/geometry.ts';
import type { BlockRef, Machine, Pack, StructureElement, StructureInfo } from '../../src/shared/types/pack.ts';
import { hatchPack } from './hatch-fixtures.ts';

/** One element of a structure's hatch rules: its character (none: the export knew none), its kinds, its cells. */
export interface ElementSpec { ch?: string; hatches: ExportHatchKind[]; where: (pos: Vec3) => boolean }

/**
 * A copy of `structure` with `specs` as its elements: element k holds the blocks other than the controller whose first
 * matching spec is k, in block order; blocks no spec matches belong to none (the export did not cover them).
 */
export function withElements(structure: StructureInfo, specs: readonly ElementSpec[]): StructureInfo {
  const copy = structuredClone(structure);
  const elements = specs.map((s): StructureElement => (s.ch === undefined ? { hatches: [...s.hatches], cells: [] } : { ch: s.ch, hatches: [...s.hatches], cells: [] }));
  const controller = posKey(copy.controller);
  for (const { pos } of copy.blocks) {
    if (posKey(pos) === controller) continue;
    const k = specs.findIndex((s) => s.where(pos));
    if (k !== -1) elements[k]!.cells.push([...pos]);
  }
  return { ...copy, elements };
}

/**
 * One spec per character of `kinds`, in its order: that character, with the cells whose character it is in `m`'s row
 * laid onto `m`'s structure (`elementMap`).
 */
export function rowElements(m: Machine, kinds: Readonly<Record<string, readonly ExportHatchKind[]>>): ElementSpec[] {
  const st = m.structure!;
  const map = elementMap(hatchRuleFor(m)!, st.controller, st.size);
  return Object.entries(kinds).map(([ch, hatches]): ElementSpec => ({ ch, hatches: [...hatches], where: (pos) => map.get(posKey(pos)) === ch }));
}

export const FRONT_BOX_ID = 4242;
export const STEAM_BOX_ID = 4243;

const GT_BLOCK = 'gregtech:gt.blockmachines';
const IMPL = 'gregtech.api.metatileentity.implementations.';
const CASING4: BlockRef = { id: 'gregtech:gt.blockcasings4', meta: 1 };

/** A 3×2×3 box of casings with the controller `mteId` at the front bottom centre (1, 0, 0) and no air. */
function boxStructure(mteId: number): StructureInfo {
  const blocks: StructureInfo['blocks'] = [];
  for (let y = 0; y < 2; y++) {
    for (let z = 0; z < 3; z++) {
      for (let x = 0; x < 3; x++) {
        blocks.push({ pos: [x, y, z], block: x === 1 && y === 0 && z === 0 ? { id: GT_BLOCK, meta: 0, mteId } : { ...CASING4 } });
      }
    }
  }
  return { size: [3, 2, 3], controller: [1, 0, 0], blocks, air: [] };
}

/** The test front box: 3×2×3 casings, its controller at (1, 0, 0), no air (no elements). */
export const FRONT_BOX_STRUCTURE: StructureInfo = boxStructure(FRONT_BOX_ID);

/** The front box's elements: buses on the front of the bottom (`a`), energy and maintenance on its back (`k`), fluid hatches on the top's back (`u`). */
export const FRONT_BOX_ELEMENTS: readonly ElementSpec[] = [
  { ch: 'a', hatches: ['input_bus', 'output_bus'], where: (p) => p[1] === 0 && p[2] === 0 },
  { ch: 'k', hatches: ['energy', 'maintenance'], where: (p) => p[1] === 0 && p[2] === 2 },
  { ch: 'u', hatches: ['input_hatch', 'output_hatch'], where: (p) => p[1] === 1 && p[2] === 2 },
  { ch: 'c', hatches: [], where: () => true },
];

function box(mteId: number, name: string, metaName: string, cls: string): Machine {
  return { id: gtMachineId(mteId), mteId, metaName, name, cls: `${IMPL}${cls}`, itemKey: `${GT_BLOCK}@${mteId}`, kind: 'multiblock', maps: [], structure: boxStructure(mteId) };
}

/**
 * `hatchPack()` with the front box 4242 and the steam box 4243 (the front box's structure, its own controller; neither
 * has elements) and the fluids `fluid:t1` … `fluid:t4`.
 */
export function hatchExportPack(): Pack {
  const pack = hatchPack();
  for (const m of [box(FRONT_BOX_ID, 'Test Front Box', 'multimachine.testfrontbox', 'MTETestFrontBox'),
    box(STEAM_BOX_ID, 'Test Steam Box', 'multimachine.teststeambox', 'MTETestSteamBox')]) {
    pack.machines.set(m.id, m);
    pack.machineByMteId.set(m.mteId, m);
    pack.items.set(m.itemKey, { key: m.itemKey, id: GT_BLOCK, meta: m.mteId, name: m.name, oreDict: [] });
  }
  for (let k = 1; k <= 4; k++) {
    pack.fluids.set(`fluid:t${k}`, { key: `fluid:t${k}`, id: `t${k}`, name: `Test Fluid ${k}`, temperature: 300, gas: false, molten: false });
  }
  return pack;
}
