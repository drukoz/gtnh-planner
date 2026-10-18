// "Found in world" for one base (spec §3.4, §3.5, §3.7 side panel): its machines and top tier, power estimate,
// logistics, storage (everything at the base, broken down by where it sits and what the project's logistics can
// reach), the world's dimensions and the prospected veins nearest the base, plus the scan's own notes (what it could
// not read or work out). Every part is optional: a base without any of them gives empty lists (ledger ruling M-R6
// for a base that is not found).

import type { StuffKey } from '../../shared/keys.ts';
import type { LogisticsMode } from '../../shared/types/plan.ts';
import { findBase, type Base, type LogisticsNetwork, type PlacedMachine, type StorageBlock, type WorldScan } from '../../shared/types/world.ts';
import { reachKinds, storageTotals, type StorageWhere } from '../../shared/world/storage-totals.ts';

export interface FoundSummary {
  machineCount: number; topTier: number | null; machines: Array<{ name: string; tier: number | null; count: number }>;
  power: Array<{ id: string; voltageTier: number; clear: number; rain: number; average: number; storedEU: number; capacityEU: number; spare: number }>;
  logistics: Array<{ id: string; kind: LogisticsNetwork['kind']; nodes: number; channels: string | null; parts: string | null }>;
  storage: {
    blocks: Array<{ kind: StorageBlock['kind']; count: number; unknown: number }>;
    barrelBanks: Array<{ barrels: number; pos: [number, number, number] }>;
    items: Array<{ key: StuffKey; total: number; reachable: number; where: StorageWhere[] }>;
  };
  dims: Array<{ name: string; visited: boolean; evidence: string[] }>;
  prospected: Array<{ vein: string; x: number; z: number; distance: number }>;
  /**
   * What the scan could not read or work out, world-wide (spec §3.5: an honest estimate): its warnings — no recipe
   * export, an unknown chunk manager, unreadable side files, boilers with unknown steam output, veins without a type —
   * then a line for the chunks it skipped.
   */
  scanNotes: string[];
}

/** The order storage kinds are listed in: networked storage first, then plain containers, then GT and AE2 blocks. */
export const STORAGE_KIND_ORDER: readonly StorageBlock['kind'][] = ['drawer_controller', 'drawer', 'barrel', 'chest', 'iron_chest', 'gt_chest', 'gt_tank', 'ae2_drive'];
const PROSPECTED_MAX = 10;
const FACE_NEIGHBOURS: ReadonlyArray<readonly [number, number, number]> = [[1, 0, 0], [-1, 0, 0], [0, 1, 0], [0, -1, 0], [0, 0, 1], [0, 0, -1]];

/** Code-point order, the same in every browser. */
function compareText(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0;
}

function comparePos(a: readonly number[], b: readonly number[]): number {
  return a[0]! - b[0]! || a[1]! - b[1]! || a[2]! - b[2]!;
}

/** Machines by name and tier, most first; a machine the export does not know is named by its mID. */
function machineRows(machines: readonly PlacedMachine[]): FoundSummary['machines'] {
  const rows = new Map<string, FoundSummary['machines'][number]>();
  for (const m of machines) {
    const name = m.name ?? `Unknown machine #${m.mteId}`, tier = m.tier ?? null;
    const key = `${tier}|${name}`;
    const row = rows.get(key);
    if (row === undefined) rows.set(key, { name, tier, count: 1 });
    else row.count++;
  }
  return [...rows.values()].sort((a, b) => b.count - a.count || compareText(a.name, b.name) || (a.tier ?? -1) - (b.tier ?? -1));
}

/** "4 cable, 1 drive": each part type with its count, by type name; null when the scan lists no parts. */
function partsText(parts: Record<string, number> | undefined): string | null {
  const names = Object.keys(parts ?? {}).sort(compareText);
  return names.length === 0 ? null : names.map((name) => `${parts![name]} ${name}`).join(', ');
}

function logisticsRow(n: LogisticsNetwork): FoundSummary['logistics'][number] {
  const channels = n.kind === 'ae2' && n.channelsUsed !== undefined && n.channelsMax !== undefined ? `${n.channelsUsed} / ${n.channelsMax}` : null;
  return { id: n.id, kind: n.kind, nodes: n.nodes, channels, parts: partsText(n.parts) };
}

function blockRows(blocks: readonly StorageBlock[]): FoundSummary['storage']['blocks'] {
  const perKind = new Map<StorageBlock['kind'], { count: number; unknown: number }>();
  for (const b of blocks) {
    let c = perKind.get(b.kind);
    if (c === undefined) perKind.set(b.kind, (c = { count: 0, unknown: 0 }));
    c.count++;
    if (b.contents === null) c.unknown++;
  }
  return STORAGE_KIND_ORDER.flatMap((kind) => {
    const c = perKind.get(kind);
    return c === undefined ? [] : [{ kind, ...c }];
  });
}

/** JABBA has no controller (spec §3.4): face-adjacent barrels form one bank, the largest bank first. */
function barrelBanks(blocks: readonly StorageBlock[]): FoundSummary['storage']['barrelBanks'] {
  const keyOf = (dim: number, x: number, y: number, z: number): string => `${dim}:${x}:${y}:${z}`;
  const barrels = new Map(blocks.filter((b) => b.kind === 'barrel').map((b) => [keyOf(b.dim, ...b.pos), b]));
  const seen = new Set<string>();
  const banks: FoundSummary['storage']['barrelBanks'] = [];
  for (const [start, first] of barrels) {
    if (seen.has(start)) continue;
    seen.add(start);
    const queue = [first];
    let count = 0, pos: [number, number, number] = [...first.pos];
    for (let b = queue.pop(); b !== undefined; b = queue.pop()) {
      count++;
      if (comparePos(b.pos, pos) < 0) pos = [...b.pos];
      for (const [dx, dy, dz] of FACE_NEIGHBOURS) {
        const k = keyOf(b.dim, b.pos[0] + dx, b.pos[1] + dy, b.pos[2] + dz);
        const next = barrels.get(k);
        if (next === undefined || seen.has(k)) continue;
        seen.add(k);
        queue.push(next);
      }
    }
    banks.push({ barrels: count, pos });
  }
  return banks.sort((a, b) => b.barrels - a.barrels || comparePos(a.pos, b.pos));
}

/** The scan's warnings, then "<n> chunk(s) could not be read and was / were left out" when it skipped any. */
export function scanNotesOf(scan: Pick<WorldScan, 'warnings' | 'skippedChunks'>): string[] {
  const skipped = scan.skippedChunks ?? 0;
  const notes = [...(scan.warnings ?? [])];
  if (skipped > 0) notes.push(`${skipped.toLocaleString('en-US')} ${skipped === 1 ? 'chunk' : 'chunks'} could not be read and ${skipped === 1 ? 'was' : 'were'} left out`);
  return notes;
}

/** The veins of the base's dimension nearest its centre (horizontal distance, rounded to a block). */
function nearestVeins(scan: WorldScan, base: Base): FoundSummary['prospected'] {
  const [cx, , cz] = base.center;
  return scan.prospected
    .filter((p) => p.dim === base.dim)
    .map((p) => ({ vein: p.vein, x: p.x, z: p.z, d: Math.hypot(p.x - cx, p.z - cz) }))
    .sort((a, b) => a.d - b.d || compareText(a.vein, b.vein) || a.x - b.x || a.z - b.z)
    .slice(0, PROSPECTED_MAX)
    .map(({ vein, x, z, d }) => ({ vein, x, z, distance: Math.round(d) }));
}

/**
 * What was found at base `baseId` (`findBase`, so a rescan that moved the base's anchor still finds it). Item totals
 * and reach come from `storageTotals` with the network kinds of `mode`, exactly as the planner's context counts them.
 * Dimensions and the scan's notes are world-wide; everything else is the base's, and empty when there is no such base.
 */
export function summarize(scan: WorldScan, baseId: string | null, mode?: LogisticsMode): FoundSummary {
  const dims = scan.dims.map((d) => ({ name: d.name, visited: d.visited, evidence: [...d.visitEvidence] }));
  const scanNotes = scanNotesOf(scan);
  const base = findBase(scan, baseId);
  if (base === null) {
    return {
      machineCount: 0, topTier: null, machines: [], power: [], logistics: [], storage: { blocks: [], barrelBanks: [], items: [] }, dims, prospected: [], scanNotes,
    };
  }
  const atBase = <T extends { baseId: string | null }>(records: readonly T[]): T[] => records.filter((r) => r.baseId === base.id);
  const machines = atBase(scan.machines);
  const storage = atBase(scan.storage);
  const items = [...storageTotals(scan.storage, scan.logistics, base.id, reachKinds(mode))]
    .map(([key, t]) => ({ key, total: t.total, reachable: t.reachable, where: t.where }))
    .sort((a, b) => b.total - a.total || compareText(a.key, b.key));
  return {
    machineCount: machines.length,
    topTier: machines.some((m) => m.tier !== undefined) ? base.topTier : null,   // the scan writes 0 when no machine has a known tier
    machines: machineRows(machines),
    power: atBase(scan.power).map((n) => ({
      id: n.id, voltageTier: n.voltageTier, clear: n.generatorEUt.clear, rain: n.generatorEUt.rain, average: n.generatorEUt.average,
      storedEU: n.storedEU, capacityEU: n.capacityEU, spare: n.generatorEUt.average - (n.loadEUt ?? 0),
    })),
    logistics: atBase(scan.logistics).map(logisticsRow),
    storage: { blocks: blockRows(storage), barrelBanks: barrelBanks(storage), items },
    dims,
    prospected: nearestVeins(scan, base),
    scanNotes,
  };
}
