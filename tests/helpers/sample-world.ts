// One rich synthetic world (Plan 4 Task 12), reused by the scan job, the world service, the planner context and the
// end-to-end check (Tasks 12, 13, 14, 18): an Overworld base with steam power, a battery buffer, an EBF with a Kanthal
// coil ring, a drawer network on a routed pipe network, a barrel, a chest and a quantum chest; a Nether base of four
// assemblers in a pre-upgrade chunk; two empty Twilight Forest chunks; a player, a claim, a quest, a team and the
// VisualProspecting files. `SAMPLE` holds what a scan of it must find. Every name and id here is synthetic.

import type { Vec3 } from '../../src/server/world/model.ts';
import type { StuffKey } from '../../src/shared/keys.ts';
import type { StorageTotal } from '../../src/shared/world/storage-totals.ts';
import { makeBackup, makeWorld, type ChunkSpec, type FillBox, type WorldSpec } from './make-world.ts';
import { byte, comp, int, list, long, type Tag } from './nbt-write.ts';
import { barrel, chest, drawer, drawerController, gtMachine, gtPipe, prPipe, stack, stackFields } from './world-tes.ts';

/** The world id VisualProspecting names this world's server-cache folder with. */
export const SAMPLE_WORLD_ID = 'World_00000000-0000-4000-8000-000000000000';
/** The one player file (`playerdata/<file>.dat`) and quest progress file; a synthetic UUID. */
export const SAMPLE_PLAYER_FILE = '00000000-0000-4000-8000-000000000001';
/** The backup `makeSampleWorld` writes, 10 minutes old. */
export const SAMPLE_BACKUP = '2026-10-17-11-00-00.zip';

const GT_MACHINE_BLOCK = 'gregtech:gt.blockmachines';
const COIL_BLOCK = 'gregtech:gt.blockcasings5';
const KANTHAL = 1;

const ITEM = { cobblestone: 4, ironIngot: 265, metaItem01: 5000 } as const;
const SMALL_LITHIUM_BATTERY = 32519;

const at = (p: Vec3, block: string, meta?: number): FillBox => ({ from: p, to: p, block, ...(meta === undefined ? {} : { meta }) });
const floor = (y: number): FillBox => ({ from: [0, y, 0], to: [31, y, 31], block: 'minecraft:stone' });
const RUNNING_2_EUT: Record<string, Tag> = { mEUt: int(2), mMaxProgresstime: int(200), mProgresstime: int(50) };
const MAINTENANCE: Record<string, Tag> = {
  mWrench: byte(1), mScrewdriver: byte(1), mSoftMallet: byte(1), mHardHammer: byte(1), mSolderingTool: byte(1), mCrowbar: byte(1),
};

/** The Overworld base chunk (0,0): power at y 64–65 along z 0, the EBF at (8,64,8), storage and pipes along z 10. */
function overworldBaseChunk(): ChunkSpec {
  const fill: FillBox[] = [
    floor(63),
    // steam power, the macerator and the battery buffer
    at([0, 64, 0], GT_MACHINE_BLOCK), at([1, 64, 0], GT_MACHINE_BLOCK), at([2, 64, 0], GT_MACHINE_BLOCK), at([3, 64, 0], GT_MACHINE_BLOCK),
    at([2, 65, 0], GT_MACHINE_BLOCK),
    // EBF facing north: the coil ring around (8, ·, 9) at y 65–66, air in its middle column
    at([8, 64, 8], GT_MACHINE_BLOCK),
    { from: [7, 65, 8], to: [9, 66, 10], block: COIL_BLOCK, meta: KANTHAL },
    { from: [8, 65, 9], to: [8, 66, 9], block: 'minecraft:air' },
    // storage row at z 10 and the routed pipes above the controller and the first drawer
    at([0, 64, 10], 'StorageDrawers:controller'), at([1, 64, 10], 'StorageDrawers:fullDrawers4'), at([2, 64, 10], 'StorageDrawers:trim'),
    at([3, 64, 10], 'StorageDrawers:fullDrawers4'), at([5, 64, 10], 'JABBA:barrel'), at([6, 64, 10], 'minecraft:chest'),
    at([7, 64, 10], GT_MACHINE_BLOCK),
    at([0, 65, 10], 'ForgeMultipart:block'), at([1, 65, 10], 'ForgeMultipart:block'),
  ];
  const battery = comp({ IntSlot: int(0), ...stackFields(ITEM.metaItem01, 1, SMALL_LITHIUM_BATTERY), tag: comp({ 'GT.ItemCharge': long(100_000n) }) });
  const tileEntities: Tag[] = [
    gtMachine({ pos: [0, 64, 0], mID: 114, facing: 5 }),                                         // HP solar boiler → east
    gtMachine({ pos: [1, 64, 0], mID: 1120, facing: 5 }),                                        // LV steam turbine → east
    gtPipe({ pos: [2, 64, 0], mID: 1246, connections: (1 << 4) | (1 << 5) | (1 << 1), kind: 'cable' }),   // tin cable W|E|UP
    gtMachine({ pos: [3, 64, 0], mID: 2001, extra: RUNNING_2_EUT }),                             // LV macerator, 2 EU/t
    gtMachine({ pos: [2, 65, 0], mID: 161, facing: 1, storedEU: 1000, extra: { Inventory: list('compound', [battery]) } }),   // LV buffer
    gtMachine({ pos: [8, 64, 8], mID: 1000, facing: 2, extra: MAINTENANCE }),                    // EBF facing north
    drawerController([0, 64, 10]),
    drawer({ pos: [1, 64, 10], slots: [[ITEM.ironIngot, 1000], null, null, null] }),
    drawer({ pos: [3, 64, 10], slots: [[ITEM.cobblestone, 640], null, null, null] }),
    prPipe({ pos: [0, 65, 10], part: 'pr_rinterface', connMap: (1 << 0) | (1 << 5), io: 0 }),   // connects down (the controller) and east
    prPipe({ pos: [1, 65, 10], part: 'pr_rrequest', connMap: 1 << 4 }),                          // connects west
    barrel({ pos: [5, 64, 10], item: ITEM.ironIngot, amount: 3000 }),
    chest([6, 64, 10], [[0, stack(ITEM.cobblestone, 64)]]),
    gtMachine({ pos: [7, 64, 10], mID: 125, extra: { mItemStack: stack(ITEM.ironIngot, 1), mItemCount: int(500) } }),   // quantum chest LV
  ];
  return { cx: 0, cz: 0, inhabitedTime: 500_000, fill, tileEntities };
}

/** The world `SAMPLE` describes; a fresh object on every call, so tests can extend it. */
export function sampleSpec(): WorldSpec {
  return {
    spawn: [8, 64, 8],
    dims: {
      0: [
        overworldBaseChunk(),
        { cx: 1, cz: 0, fill: [floor(63)] }, { cx: 0, cz: 1, fill: [floor(63)] }, { cx: 1, cz: 1, fill: [floor(63)] },
        { cx: 3, cz: 3 },
      ],
      [-1]: [{
        cx: -1, cz: -1, format: 'legacy', inhabitedTime: 72_000, oreTes: 300,
        fill: [{ from: [-5, 64, -2], to: [-2, 64, -2], block: GT_MACHINE_BLOCK }],
        tileEntities: [-2, -3, -4, -5].map((x) => gtMachine({ pos: [x, 64, -2], mID: 2002 })),   // MV assemblers
      }],
      7: [{ cx: 0, cz: 0 }, { cx: 1, cz: 0 }],
    },
    players: [{ file: SAMPLE_PLAYER_FILE, dim: 0, pos: [4.5, 65, 5.5], portals: [[0, -1]] }],
    claims: { Alpha: { 0: [[0, 0], [0, 1]] } },
    teams: { Alpha: [{ dim: 0, veins: [[-3, 5]] }] },
    quests: { [SAMPLE_PLAYER_FILE]: [1072] },
    vp: { worldId: SAMPLE_WORLD_ID, dims: { 0: [{ chunkX: -3, chunkZ: 5, vein: 'ore.mix.copper' }] } },
  };
}

/** `makeWorld(dir, sampleSpec())` plus the complete backup `SAMPLE_BACKUP`, 10 minutes old. */
export async function makeSampleWorld(dir: string): Promise<{ serverDir: string; worldDir: string }> {
  const world = await makeWorld(dir, sampleSpec());
  await makeBackup(world.serverDir, SAMPLE_BACKUP, { mtime: new Date(Date.now() - 10 * 60_000) });
  return world;
}

const IRON = 'minecraft:iron_ingot@0' as StuffKey;
const COBBLESTONE = 'minecraft:cobblestone@0' as StuffKey;

/** What a scan of the sample world finds (with `testFacts()`); `totals` as `storageTotals` gives them in mode `direct`. */
export const SAMPLE = Object.freeze({
  baseIds: ['0:0:0', '-1:-1:-1'],
  baseNames: ['Alpha base (4, 5)', 'Nether base (-4, -2)'],
  machineCount: [6, 4],
  topTier: 2,
  baseTopTier: [1, 2],
  coilHeat: 2701,
  visitedDims: ['nether', 'overworld', 'moon'],
  routedId: 'r:0:0:65:10',
  power: { clear: 7.037, storedEU: 101_000, capacityEU: 102_048 },
  totals: {
    [IRON]: { total: 4500, reachable: 1000, where: [
      { kind: 'barrel', pos: [5, 64, 10], count: 3000, reachable: false },
      { kind: 'drawer', pos: [1, 64, 10], count: 1000, reachable: true },
      { kind: 'gt_chest', pos: [7, 64, 10], count: 500, reachable: false }] },
    [COBBLESTONE]: { total: 704, reachable: 640, where: [
      { kind: 'drawer', pos: [3, 64, 10], count: 640, reachable: true },
      { kind: 'chest', pos: [6, 64, 10], count: 64, reachable: false }] },
  } as Record<StuffKey, StorageTotal>,
  prospected: [{ dim: 0, x: -40, z: 88, vein: 'ore.mix.copper' }],
});
