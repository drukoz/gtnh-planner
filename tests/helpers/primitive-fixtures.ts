// Synthetic GT primitive machines for the layout tests of the steam and hand-run fix (architecture §11 entry 48): a
// Steam Macerator (GT `MTEBasicMachineBronze`), a Bricked Blast Furnace and a Coke Oven on structures shaped like the
// pack's (the controller in the middle of the front's second layer), the goods they move, and a steel line through
// them. Nothing here reads a real export or world; each call returns fresh objects.

import { parseItemKey, type ItemKey } from '../../src/shared/keys.ts';
import { gtMachineId } from '../../src/shared/ids.ts';
import type { BlockRef, Machine, Pack, StructureInfo } from '../../src/shared/types/pack.ts';
import type { Plan, PlanFlow } from '../../src/shared/types/plan.ts';
import { IDS, layoutPack, makePlan } from './layout-fixtures.ts';

/** The machine ids the fixtures add to the layout pack. */
export const STEAM = 2099, BRICKED = 1010, COKE = 1011;

const GT_BLOCK = 'gregtech:gt.blockmachines';
const MULTI = 'gregtech.common.tileentities.machines.multi.';
const FIREBRICKS: BlockRef = Object.freeze({ id: 'gregtech:gt.blockcasings4', meta: 15 });
const COKE_BRICKS: BlockRef = Object.freeze({ id: 'gregtech:gt.blockcasings12', meta: 0 });
const LAVA: BlockRef = Object.freeze({ id: 'minecraft:lava', meta: 1 });

/** The goods of the steel line, by key. */
export const GOODS: ReadonlyArray<readonly [ItemKey, string]> = [
  ['t:coal@0', 'Coal'], ['t:coke@0', 'Coal Coke'], ['t:iron@0', 'Iron Ingot'], ['t:steel@0', 'Steel Ingot'], ['t:ash@0', 'Dark Ash'],
  ['t:out_s@0', 'Steel Dust'],
];

/**
 * A `size` box of `casing` with the controller of `mteId` at `controller`, `lava` cells and `air` cells (canonical
 * frame: front on the north, z = 0).
 */
function box(size: [number, number, number], controller: [number, number, number], mteId: number, casing: BlockRef,
  lava: ReadonlyArray<[number, number, number]>, air: Array<[number, number, number]>): StructureInfo {
  const key = (p: readonly number[]) => p.join();
  const lavaAt = new Set(lava.map(key)), airAt = new Set(air.map(key));
  const blocks: StructureInfo['blocks'] = [];
  for (let y = 0; y < size[1]; y++) {
    for (let z = 0; z < size[2]; z++) {
      for (let x = 0; x < size[0]; x++) {
        const pos: [number, number, number] = [x, y, z];
        if (airAt.has(key(pos))) continue;
        const block: BlockRef = key(pos) === key(controller) ? { id: GT_BLOCK, meta: 0, mteId } : lavaAt.has(key(pos)) ? { ...LAVA } : { ...casing };
        blocks.push({ pos, block });
      }
    }
  }
  return { size, controller, blocks, air };
}

function machine(mteId: number, name: string, metaName: string, cls: string, more: Partial<Machine>): Machine {
  return { id: gtMachineId(mteId), mteId, metaName, name, cls, itemKey: `${GT_BLOCK}@${mteId}`, kind: 'multiblock', maps: [], ...more };
}

/**
 * `layoutPack()` plus a Steam Macerator (a bronze singleblock), a Bricked Blast Furnace (3×4×3: firebricks round two
 * lava cells, open on top) and a Coke Oven (3×3×3 of coke oven bricks round one air cell), and the steel line's goods.
 */
export function primitivePack(): Pack {
  const pack = layoutPack();
  const machines: Machine[] = [
    { ...pack.machines.get(IDS.MACERATOR)!, id: gtMachineId(STEAM), mteId: STEAM, metaName: 'bronzemachine.macerator', name: 'Steam Macerator', kind: 'steam',
      cls: 'gregtech.common.tileentities.machines.steam.MTESteamMaceratorBronze', itemKey: `${GT_BLOCK}@${STEAM}` },
    machine(BRICKED, 'Bricked Blast Furnace', 'multimachine.brickedblastfurnace', `${MULTI}MTEBrickedBlastFurnace`,
      { structure: box([3, 4, 3], [1, 1, 0], BRICKED, FIREBRICKS, [[1, 1, 1], [1, 2, 1]], [[1, 3, 1]]) }),
    machine(COKE, 'Coke Oven', 'multimachine.cokeoven', `${MULTI}MTECokeOven`, { structure: box([3, 3, 3], [1, 1, 0], COKE, COKE_BRICKS, [], [[1, 1, 1]]) }),
  ];
  for (const m of machines) {
    pack.machines.set(m.mteId, m);
    pack.items.set(m.itemKey, { key: m.itemKey, ...parseItemKey(m.itemKey), name: m.name, oreDict: [] });
  }
  for (const [key, name] of GOODS) pack.items.set(key, { key, ...parseItemKey(key), name, oreDict: [] });
  pack.fluids.set('fluid:creosote', { key: 'fluid:creosote', id: 'creosote', name: 'Creosote', temperature: 300, gas: false, molten: false });
  return pack;
}

const flow = (from: string, to: string, key: string, perSecond = 1): PlanFlow => ({ from, to, key, perSecond });

/**
 * A steel line through every kind of machine the fix handles: a Coke Oven (k) makes Coal Coke and Creosote from raw
 * Coal; a Basic Macerator (m, LV) makes Iron Ingot from Raw Input; the Bricked Blast Furnace (b) makes Steel Ingot and
 * Dark Ash from both; a Steam Macerator (s) makes the product, Steel Dust, from the Steel Ingot. So the line moves goods
 * from a machine on its logistics into one run by hand (m → b), between two run by hand (k → b), and from one run by
 * hand into a steam machine (b → s).
 */
export function steelLine(): Plan {
  return makePlan([
    { id: 'k', mteId: COKE, count: 1, euPerTick: 0, name: 'Coke Oven', inputs: [['t:coal@0', 1]], outputs: [['t:coke@0', 1], ['fluid:creosote', 500]] },
    { id: 'm', mteId: IDS.MACERATOR, count: 1, inputs: [['t:in@0', 1]], outputs: [['t:iron@0', 1]] },
    { id: 'b', mteId: BRICKED, count: 1, euPerTick: 0, name: 'Bricked Blast Furnace', inputs: [['t:iron@0', 1], ['t:coke@0', 2]],
      outputs: [['t:steel@0', 1], ['t:ash@0', 0.25]] },
    { id: 's', mteId: STEAM, count: 1, euPerTick: 4, name: 'Steam Macerator', inputs: [['t:steel@0', 1]], outputs: [['t:out_s@0', 1]] },
  ], { flows: [
    flow('raw', 'k', 't:coal@0'), flow('k', 'b', 't:coke@0', 2), flow('k', 'sink', 'fluid:creosote', 500),
    flow('raw', 'm', 't:in@0'), flow('m', 'b', 't:iron@0'),
    flow('b', 's', 't:steel@0'), flow('b', 'sink', 't:ash@0', 0.25), flow('s', 'out', 't:out_s@0'),
  ] });
}
