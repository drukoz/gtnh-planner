// The EnderIO conduit bundle the map and 3D view tests share (plan 11 Task 6; spec §3.6 mode 4, §3.7, §3.8): one cell
// holding an Item Conduit (In / Out to a macerator on its north face, inserting through the macerator's output side,
// linked east) and an Ender Fluid Conduit (Extract from a fluid extractor on its top face, Disabled toward the macerator
// on its south face, linked west), alone in a one-block EnderIO layout, with the names of every key it uses. Synthetic:
// nothing here comes from a game file. Client tests only, so nothing is imported from the server
// (tests/helpers/enderio-fixtures.ts holds the server's copies).

import type { TextureLayer } from '../../src/shared/types/assets.ts';
import type { ConduitFilter, Layout, LayoutBlock } from '../../src/shared/types/layout.ts';

/** The Item Conduit, Ender Fluid Conduit, Basic Item Filter and Item Conduit Speed Upgrade. */
export const ITEM = 'EnderIO:itemItemConduit@0';
export const ENDER = 'EnderIO:itemLiquidConduit@2';
export const BASIC = 'EnderIO:itemBasicFilterUpgrade@0';
export const SPEED = 'EnderIO:itemExtractSpeedUpgrade@0';

/** A Basic Item Filter whitelisting `keys` as given: match meta, ignore NBT, no ore dictionary, not sticky. */
export function basic(keys: string[]): ConduitFilter {
  return { item: BASIC, whitelist: true, keys: [...keys], matchMeta: true, matchNbt: false, oreDict: false, sticky: false };
}

/** An EnderIO block texture: `enderio/textures/blocks/<name>.png`. */
export const E = (name: string): TextureLayer => ({ path: `enderio/textures/blocks/${name}.png` });

export const bundle: LayoutBlock = { pos: [10, 64, 20], block: { id: 'conduit:item', meta: 0 }, role: 'pipe',
  label: 'Conduit bundle (Item Conduit + Ender Fluid Conduit)', item: ITEM, connections: 4 | 32 | 2 | 16, conduits: [
    { kind: 'item', item: ITEM, connections: 32, faces: [{ face: 'north', mode: 'in_out', target: 'Basic Macerator',
      extract: { color: 'red', filter: basic(['t:dust@0']), rate: 20, roundRobin: false, selfFeed: false, redstone: 'ignore', speed: { item: SPEED, count: 2 } },
      insert: { color: 'blue', filter: basic(['t:in@0']), rate: 20, priority: 1, outputSide: true } }] },
    { kind: 'liquid_ender', item: ENDER, connections: 16, faces: [
      { face: 'up', mode: 'extract', target: 'Basic Fluid Extractor',
        extract: { color: 'red', filter: { whitelist: true, keys: ['fluid:molten.iron'] }, rate: 1, roundRobin: false, redstone: 'ignore' } },
      { face: 'south', mode: 'disabled', target: 'Basic Macerator' }] }] };

/** The bundle alone; dim 0, so layout-map's viewport draws it (ruling R17). */
export const bundleLayout: Layout = { dim: 0, origin: [10, 64, 20], size: [1, 1, 1], rotation: 0, mode: 'enderio', status: 'ok',
  blocks: [bundle], hookups: [], pins: [], buildSteps: [], bom: [], warnings: [] };

export const enderioNames: Record<string, string> = {
  [BASIC]: 'Basic Item Filter', [SPEED]: 'Item Conduit Speed Upgrade',
  't:dust@0': 'Titanium Dust', 't:in@0': 'Raw Input', 'fluid:molten.iron': 'Molten Iron',
};
