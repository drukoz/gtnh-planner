// Stock per item over the storage blocks of a scan (spec §3.4): how much there is, how much of it the line's chosen
// logistics can reach automatically, and where it sits. Pure, so the server (context, materials list) and the browser
// (Map tab) show the same numbers.

import type { StuffKey } from '../keys.ts';
import type { LogisticsNetwork, StorageBlock } from '../types/world.ts';

/** The value union of architecture §6.3's `LogisticsMode` (ruling R4). */
export type ReachMode = 'direct' | 'routed' | 'ae2';

type NetworkKind = LogisticsNetwork['kind'];

/**
 * The networks a line can order arbitrary items from. EnderIO and GT pipe networks only move items point to point,
 * so storage on them is found but not reachable (spec §3.4).
 */
export const REQUEST_KINDS: ReadonlySet<NetworkKind> = new Set<NetworkKind>(['routed', 'ae2']);

const ROUTED_ONLY: ReadonlySet<NetworkKind> = new Set<NetworkKind>(['routed']);
const AE2_ONLY: ReadonlySet<NetworkKind> = new Set<NetworkKind>(['ae2']);

/** The network kinds that count as reachable under a project's logistics mode; no mode means any request network. */
export function reachKinds(mode: ReachMode | undefined): ReadonlySet<NetworkKind> {
  return mode === 'routed' ? ROUTED_ONLY : mode === 'ae2' ? AE2_ONLY : REQUEST_KINDS;
}

/** One block holding an item; `kind` stays assignable to architecture §11.20's `StorageWhere.kind: string`. */
export interface StorageWhere { kind: StorageBlock['kind']; pos: [number, number, number]; count: number; reachable: boolean }

export interface StorageTotal { total: number; reachable: number; where: StorageWhere[] }

/**
 * Totals per item over the blocks of `baseId` (all blocks when null). A block with `contents: null` is skipped. A
 * block is reachable when its network's kind is in `kinds`; `where` lists every block holding the item, most first,
 * ties by x, then y, then z.
 */
export function storageTotals(
  storage: StorageBlock[], networks: LogisticsNetwork[], baseId: string | null, kinds: ReadonlySet<NetworkKind> = REQUEST_KINDS,
): Map<StuffKey, StorageTotal> {
  const kindOf = new Map(networks.map((n) => [n.id, n.kind]));
  const out = new Map<StuffKey, StorageTotal>();
  for (const block of storage) {
    if (block.contents === null || (baseId !== null && block.baseId !== baseId)) continue;
    const kind = block.networkId === null ? undefined : kindOf.get(block.networkId);
    const reachable = kind !== undefined && kinds.has(kind);
    const perKey = new Map<StuffKey, number>();
    for (const { key, count } of block.contents) perKey.set(key, (perKey.get(key) ?? 0) + count);
    for (const [key, count] of perKey) {
      let t = out.get(key);
      if (t === undefined) out.set(key, (t = { total: 0, reachable: 0, where: [] }));
      t.total += count;
      if (reachable) t.reachable += count;
      t.where.push({ kind: block.kind, pos: [block.pos[0], block.pos[1], block.pos[2]], count, reachable });
    }
  }
  for (const t of out.values()) t.where.sort((a, b) => b.count - a.count || a.pos[0] - b.pos[0] || a.pos[1] - b.pos[1] || a.pos[2] - b.pos[2]);
  return out;
}
