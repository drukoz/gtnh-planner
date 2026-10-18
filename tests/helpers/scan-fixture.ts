// Hand-written world scans for the Map tab's tests (Plan 4 Task 16; ledger ruling M-R7). SCAN_FIXTURE holds one
// Overworld base, 0:0:0, centred at (4, 64, 5), with a little of everything the map draws and the Found panel lists.

import type { StorageBlock, WorldScan } from '../../src/shared/types/world.ts';

const BASE = '0:0:0';
const ROUTED = 'r:0:0:65:10';
const IRON = 'minecraft:iron_ingot@0';

/**
 * Machines: 2 × "Basic Macerator" (LV), 1 × "Basic Steam Turbine" (LV) and one machine the export does not know
 * (mID 31999). One LV cable at (2, 64, 0) joined west and east. One routed network of two pipes. Storage: a drawer on
 * that network (iron × 1,000), a chest off any network (iron × 30), a compacting drawer whose contents are unknown and
 * two empty JABBA barrels stacked at (5, 64..65, 10). One LV power network with a 2 EU/t load. Overworld visited,
 * Twilight Forest not. One copper vein prospected at (−40, 88).
 */
export const SCAN_FIXTURE: WorldScan = {
  id: '20261017T120000Z-000016', source: { kind: 'server' }, scannedAt: '2026-10-17T12:00:00.000Z', levelName: 'World',
  dims: [
    { dim: 0, keys: ['Overworld'], name: 'Overworld', chunks: 4, inhabitedChunks: 1, visited: true, visitEvidence: ['InhabitedTime'] },
    { dim: 7, keys: ['TwilightForest'], name: 'Twilight Forest', chunks: 1, inhabitedChunks: 0, visited: false, visitEvidence: [] },
  ],
  bases: [{
    id: BASE, dim: 0, name: 'Overworld base (4, 5)', bbox: { minX: 0, minY: 60, minZ: 0, maxX: 9, maxY: 68, maxZ: 10 },
    center: [4, 64, 5], machineCount: 4, topTier: 1,
  }],
  machines: [
    { dim: 0, pos: [3, 64, 3], mteId: 11, facing: 3, color: -1, baseId: BASE, kind: 'basic', tier: 1, name: 'Basic Macerator', recipeEUt: 2 },
    { dim: 0, pos: [4, 64, 3], mteId: 11, facing: 3, color: -1, baseId: BASE, kind: 'basic', tier: 1, name: 'Basic Macerator', recipeEUt: 2 },
    { dim: 0, pos: [1, 64, 0], mteId: 1120, facing: 5, color: -1, baseId: BASE, kind: 'turbine', tier: 1, name: 'Basic Steam Turbine' },
    { dim: 0, pos: [7, 64, 3], mteId: 31999, facing: 2, color: -1, baseId: BASE, kind: 'unknown' },
  ],
  pipes: [
    { dim: 0, pos: [2, 64, 0], mteId: 1240, connections: 16 | 32, kind: 'cable', voltageTier: 1, amps: 1, networkId: 'p:0:2:64:0' },
  ],
  power: [{
    id: 'p:0:2:64:0', baseId: BASE, voltageTier: 1, generatorEUt: { clear: 7.037, rain: 0, average: 6.444 }, consumersMaxEUt: 64,
    storedEU: 101_000, capacityEU: 102_048, taps: [], loadEUt: 2, solarShare: 1,
  }],
  logistics: [{ id: ROUTED, baseId: BASE, kind: 'routed', nodes: 2, taps: [] }],
  logisticsBlocks: [
    { dim: 0, pos: [0, 65, 10], kind: 'routed', networkId: ROUTED, connections: 32 },
    { dim: 0, pos: [1, 65, 10], kind: 'routed', networkId: ROUTED, connections: 16 },
  ],
  storage: [
    { id: 's:0:1:64:10', dim: 0, pos: [1, 64, 10], kind: 'drawer', baseId: BASE, networkId: ROUTED, contents: [{ key: IRON, count: 1000 }] },
    { id: 's:0:6:64:10', dim: 0, pos: [6, 64, 10], kind: 'chest', baseId: BASE, networkId: null, contents: [{ key: IRON, count: 30 }] },
    { id: 's:0:3:64:10', dim: 0, pos: [3, 64, 10], kind: 'drawer', baseId: BASE, networkId: null, contents: null },   // compacting drawer
    { id: 's:0:5:64:10', dim: 0, pos: [5, 64, 10], kind: 'barrel', baseId: BASE, networkId: null, contents: [] },
    { id: 's:0:5:65:10', dim: 0, pos: [5, 65, 10], kind: 'barrel', baseId: BASE, networkId: null, contents: [] },
  ],
  visitedDims: ['Overworld'], topTier: 1, coilHeat: null,
  prospected: [{ dim: 0, x: -40, z: 88, vein: 'ore.mix.copper' }],
};

/** A scan that found nothing: every list empty, no tier and no coil heat. */
export const EMPTY_SCAN: WorldScan = {
  id: '20261017T120000Z-000000', source: { kind: 'server' }, scannedAt: '2026-10-17T12:00:00.000Z', levelName: 'World',
  dims: [], bases: [], machines: [], pipes: [], power: [], logistics: [], storage: [],
  visitedDims: [], topTier: null, coilHeat: null, prospected: [],
};

/**
 * SCAN_FIXTURE plus `spread` chests at base 0:0:0 (at z = 20) holding `n` different items `test:item@0` … : the first
 * item sits in every chest, item i > 0 in chest (i − 1) mod `spread` only.
 */
export function manyItems(n: number, spread: number): WorldScan {
  const chests: StorageBlock[] = [];
  for (let c = 0; c < spread; c++) {
    chests.push({ id: `s:0:${c}:64:20`, dim: 0, pos: [c, 64, 20], kind: 'chest', baseId: BASE, networkId: null, contents: [{ key: 'test:item@0', count: c + 1 }] });
  }
  for (let i = 1; i < n; i++) chests[(i - 1) % spread]!.contents!.push({ key: `test:item@${i}`, count: 10 * i });
  return { ...SCAN_FIXTURE, storage: [...SCAN_FIXTURE.storage, ...chests] };
}
