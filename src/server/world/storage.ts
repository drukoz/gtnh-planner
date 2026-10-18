// Storage blocks of a scan: the classifiers' records plus AE2 drives and ME chests, each with its base and network.
// Drawers join a controller's network by the reach rule of world-format §6.6.

import { REQUEST_KINDS } from '../../shared/world/storage-totals.ts';
import type { LogisticsNetwork, StorageBlock } from '../../shared/types/world.ts';
import type { Ae2Rec } from './classify/ae2.ts';
import { countsAsDrawer, isNetworkedDrawerBlock, type DrawerConfig } from './classify/drawers.ts';
import type { BlockReader } from './area.ts';
import type { Attachments } from './logistics.ts';
import { posKey, step, type StorageRec, type Vec3 } from './model.ts';

export { REQUEST_KINDS, reachKinds, storageTotals } from '../../shared/world/storage-totals.ts';
export type { ReachMode, StorageTotal, StorageWhere } from '../../shared/world/storage-totals.ts';

/**
 * The drawers a controller reaches (world-format §6.6): breadth-first over the face neighbours, in the order x−1, x+1,
 * z−1, z+1, y−1, y+1, through networked blocks within `cfg.range` of the controller (a missing chunk is not networked).
 * A drawer that would pass `cfg.maxDrawers` ends the whole search. `members` holds every networked position reached,
 * the controller, slaves and trim included.
 */
export async function drawerReach(
  reader: BlockReader, blockNames: Map<number, string>, dim: number, controller: Vec3, cfg: DrawerConfig,
): Promise<{ drawers: Vec3[]; members: Vec3[] }> {
  const drawers: Vec3[] = [], members: Vec3[] = [];
  const seen = new Set<string>();
  const queue: Vec3[] = [controller];
  const sideOrder = [4, 5, 2, 3, 0, 1];   // west, east, north, south, down, up
  for (let head = 0; head < queue.length; head++) {
    const p = queue[head]!;
    const k = posKey(dim, p[0], p[1], p[2]);
    if (seen.has(k)) continue;
    seen.add(k);
    if (Math.max(Math.abs(p[0] - controller[0]), Math.abs(p[1] - controller[1]), Math.abs(p[2] - controller[2])) > cfg.range) continue;
    const block = await reader.blockAt(dim, p[0], p[1], p[2]);
    const name = block === null ? undefined : blockNames.get(block.id);
    if (name === undefined || !isNetworkedDrawerBlock(name)) continue;
    if (countsAsDrawer(name)) {
      if (drawers.length + 1 > cfg.maxDrawers) break;
      drawers.push(p);
    }
    members.push(p);
    for (const side of sideOrder) queue.push(step(p, side));
  }
  return { drawers, members };
}

export interface StorageInput {
  recs: StorageRec[]; ae2: Ae2Rec[]; attachments: Attachments; networks: LogisticsNetwork[];
  reader: BlockReader; blockNames: Map<number, string>; drawerCfg: DrawerConfig;
  baseOf: (dim: number, pos: Vec3) => string | null;
}

type Attached = Array<{ networkId: string; kind: LogisticsNetwork['kind'] }>;

/** The first request network among `at`, else the first network of any kind, else null. */
function preferredNetwork(at: Attached[]): string | null {
  const all = at.flat();
  return (all.find((a) => REQUEST_KINDS.has(a.kind)) ?? all[0])?.networkId ?? null;
}

const byId = (a: string, b: string): number => (a < b ? -1 : a > b ? 1 : 0);
const idOf = (dim: number, p: Vec3): string => `s:${posKey(dim, p[0], p[1], p[2])}`;

/**
 * One block per record, plus an `ae2_drive` block per AE2 drive and ME chest (contents = its cells). Drawers a
 * controller reaches take `controller` and share one network: the first request network attached to any member
 * position, else the first of any kind, else null. Everything else takes its own attachments by that preference.
 */
export async function buildStorage(input: StorageInput): Promise<StorageBlock[]> {
  const { attachments } = input;
  const own = (dim: number, p: Vec3): string | null => preferredNetwork([attachments.get(posKey(dim, p[0], p[1], p[2])) ?? []]);

  // Controller order is by id so that a drawer in reach of two controllers always joins the same one.
  const controllers = input.recs.filter((r) => r.kind === 'drawer_controller').sort((a, b) => byId(idOf(a.dim, a.pos), idOf(b.dim, b.pos)));
  const joined = new Map<string, { controller: Vec3; networkId: string | null }>();
  for (const c of controllers) {
    if (joined.has(posKey(c.dim, ...c.pos))) continue;
    const { drawers, members } = await drawerReach(input.reader, input.blockNames, c.dim, c.pos, input.drawerCfg);
    const networkId = preferredNetwork(members.map((m) => attachments.get(posKey(c.dim, m[0], m[1], m[2])) ?? []));
    for (const p of [c.pos, ...drawers]) {
      const k = posKey(c.dim, ...p);
      if (!joined.has(k)) joined.set(k, { controller: c.pos, networkId });
    }
  }

  const out: StorageBlock[] = [];
  for (const r of input.recs) {
    const j = joined.get(posKey(r.dim, ...r.pos));
    const block: StorageBlock = {
      id: idOf(r.dim, r.pos), dim: r.dim, pos: [...r.pos], kind: r.kind, baseId: input.baseOf(r.dim, r.pos),
      networkId: j !== undefined ? j.networkId : own(r.dim, r.pos), contents: r.contents === null ? null : r.contents.map((c) => ({ key: c.key, count: c.count })),
    };
    if (r.capacityStacks !== undefined) block.capacityStacks = r.capacityStacks;
    if (j !== undefined && r.kind === 'drawer') block.controller = [...j.controller];
    out.push(block);
  }
  for (const a of input.ae2) {
    if (a.block !== 'drive' && a.block !== 'chest') continue;
    out.push({
      id: idOf(a.dim, a.pos), dim: a.dim, pos: [...a.pos], kind: 'ae2_drive', baseId: input.baseOf(a.dim, a.pos),
      networkId: own(a.dim, a.pos), contents: a.cells === null ? null : a.cells.map((c) => ({ key: c.key, count: c.count })),
    });
  }
  return out.sort((a, b) => byId(a.id, b.id));
}
