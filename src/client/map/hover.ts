// What the map says about the block under the pointer (spec §3.7; architecture §11, Map hover): the scan's records of
// one dimension by column, the hover tooltip's lines for a column, the top block of a column in a map tile, and the
// short rest before a column is described. Pure TypeScript without the DOM, so all of it runs in tests as it is.

import type { StuffKey } from '../../shared/keys.ts';
import { TIER_NAMES, tierName } from '../../shared/gt/tiers.ts';
import { FACES } from '../../shared/types/assets.ts';
import {
  AIR_INDEX, TILE_SIZE, tileOf, UNKNOWN_INDEX, type LogisticsBlock, type MapTile, type PlacedMachine, type PlacedPipe, type StorageBlock, type WorldScan,
} from '../../shared/types/world.ts';
import type { MapOverlay } from './types.ts';

/** How long (ms) the pointer rests on a column before the map describes it. */
export const HOVER_DELAY_MS = 150;

/** A storage line names this many of the block's contents, the largest first. */
const CONTENTS_SHOWN = 3;
const SEP = ' · ';

const STORAGE_LABELS: Readonly<Record<StorageBlock['kind'], string>> = {
  drawer: 'Drawer', drawer_controller: 'Drawer controller', barrel: 'JABBA barrel', chest: 'Chest', iron_chest: 'Iron chest', gt_chest: 'GT chest',
  gt_tank: 'GT tank', ae2_drive: 'AE2 drive',
};
const PIPE_LABELS: Readonly<Record<NonNullable<PlacedPipe['kind']>, string>> = { cable: 'Cable', fluid: 'Fluid pipe', item: 'Item pipe' };
/** The logistics blocks a column lists. Plan 4 also lists each GT item and fluid pipe as a `gtpipe` block: those are `scan.pipes` records already. */
const LOGISTICS_LABELS: Readonly<Partial<Record<LogisticsBlock['kind'], string>>> = { routed: 'Routed pipe', enderio: 'EnderIO conduit', ae2: 'AE2 part' };

type ColumnRecord =
  | { kind: 'machine'; y: number; machine: PlacedMachine }
  | { kind: 'pipe'; y: number; pipe: PlacedPipe }
  | { kind: 'storage'; y: number; storage: StorageBlock }
  | { kind: 'logistics'; y: number; block: LogisticsBlock; label: string };

/** Records at the same height: machine, pipe, storage, logistics. */
const KIND_ORDER: Readonly<Record<ColumnRecord['kind'], number>> = { machine: 0, pipe: 1, storage: 2, logistics: 3 };

/** The scan records of dimension `dim` by column, each column top-most first (`buildColumnIndex`). */
export interface ColumnIndex { readonly dim: number; readonly columns: ReadonlyMap<string, readonly ColumnRecord[]> }

const columnKey = (x: number, z: number): string => `${x},${z}`;
const int = (n: number): string => n.toLocaleString('en-US', { maximumFractionDigits: 0 });

/** Code-point order, the same in every browser. */
function compareText(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0;
}

/** The records of `scan` in dimension `dim` by column, once per scan and dimension: O(records). */
export function buildColumnIndex(scan: Pick<WorldScan, 'machines' | 'pipes' | 'storage' | 'logisticsBlocks'>, dim: number): ColumnIndex {
  const columns = new Map<string, ColumnRecord[]>();
  const add = (pos: readonly number[], record: ColumnRecord): void => {
    const key = columnKey(pos[0]!, pos[2]!);
    const list = columns.get(key);
    if (list === undefined) columns.set(key, [record]);
    else list.push(record);
  };
  for (const machine of scan.machines) if (machine.dim === dim) add(machine.pos, { kind: 'machine', y: machine.pos[1], machine });
  for (const pipe of scan.pipes) if (pipe.dim === dim) add(pipe.pos, { kind: 'pipe', y: pipe.pos[1], pipe });
  for (const s of scan.storage) if (s.dim === dim) add(s.pos, { kind: 'storage', y: s.pos[1], storage: s });
  for (const block of scan.logisticsBlocks ?? []) {
    const label = LOGISTICS_LABELS[block.kind];
    if (block.dim === dim && label !== undefined) add(block.pos, { kind: 'logistics', y: block.pos[1], block, label });
  }
  for (const list of columns.values()) list.sort((a, b) => b.y - a.y || KIND_ORDER[a.kind] - KIND_ORDER[b.kind]);
  return { dim, columns };
}

/** The records of column (x, z) at or below its top block, top-most first; none without a top block. */
function recordsAt(index: ColumnIndex, x: number, z: number, topY: number | null): readonly ColumnRecord[] {
  if (topY === null) return [];
  return (index.columns.get(columnKey(x, z)) ?? []).filter((r) => r.y <= topY);
}

/** The CONTENTS_SHOWN largest contents, ties by key. */
function largest(contents: ReadonlyArray<{ key: StuffKey; count: number }>): Array<{ key: StuffKey; count: number }> {
  return [...contents].sort((a, b) => b.count - a.count || compareText(a.key, b.key)).slice(0, CONTENTS_SHOWN);
}

/** LV, MV, …; null when there is no tier or the number is not one. */
function tierText(tier: number | undefined): string | null {
  return tier === undefined || TIER_NAMES[tier] === undefined ? null : tierName(tier);
}

/** "connected west, east" for the sides set in `connections` (bit `1 << side`, ForgeDirection order). */
function connectedText(connections: number): string {
  const sides = FACES.filter((_face, side) => (connections & (1 << side)) !== 0);
  return sides.length === 0 ? 'not connected' : `connected ${sides.join(', ')}`;
}

function machineLine(m: PlacedMachine): string {
  const tier = tierText(m.tier), facing = FACES[m.facing];
  let line = m.name ?? `Unknown machine #${m.mteId}`;
  if (tier !== null) line += ` (${tier})`;
  if (facing !== undefined) line += `${SEP}facing ${facing}`;
  // The scan writes 0 when a machine holds no energy (or says nothing), so only a positive buffer is worth a word.
  if (m.storedEU !== undefined && m.storedEU > 0) line += `${SEP}stored ${int(m.storedEU)} EU`;
  return line;
}

/** A GT pipe's material is in its block name (line 1); a cable adds its voltage tier and amps. */
function pipeLine(p: PlacedPipe): string {
  if (p.kind === undefined) return 'GT pipe';
  const parts = [PIPE_LABELS[p.kind]];
  if (p.kind === 'cable') {
    const tier = tierText(p.voltageTier);
    if (tier !== null) parts.push(tier);
    if (p.amps !== undefined) parts.push(`${int(p.amps)} A`);
  }
  return parts.join(SEP);
}

function storageLine(s: StorageBlock, itemName: (key: StuffKey) => string): string {
  const parts = [STORAGE_LABELS[s.kind]];
  if (s.contents === null) parts.push('contents unknown');
  else if (s.contents.length === 0) parts.push('empty');
  else {
    for (const c of largest(s.contents)) parts.push(`${int(c.count)}× ${itemName(c.key)}`);
    if (s.contents.length > CONTENTS_SHOWN) parts.push(`+${int(s.contents.length - CONTENTS_SHOWN)} more`);
  }
  return parts.join(SEP);
}

function recordLine(r: ColumnRecord, itemName: (key: StuffKey) => string): string {
  switch (r.kind) {
    case 'machine': return machineLine(r.machine);
    case 'pipe': return pipeLine(r.pipe);
    case 'storage': return storageLine(r.storage, itemName);
    case 'logistics': return `${r.label}${SEP}${connectedText(r.block.connections)}`;
  }
}

export interface DescribeColumnInput {
  x: number; z: number;
  /** The height of the column's top block at the view's Y level; null for air, a chunk the scan did not read or a tile not loaded. */
  topY: number | null;
  /** The top block's English name (palette names); null while it is not known. */
  blockName: string | null;
  index: ColumnIndex; scan: Pick<WorldScan, 'bases'>; overlays: readonly MapOverlay[];
  /** The name of an item (or fluid) a storage block holds; the key itself when absent. */
  itemName?: (key: StuffKey) => string;
}

/**
 * The hover tooltip's lines for column (x, z), in this order and none of them empty: (1) the top block's name, (2) its
 * position, (3) a line for each scan record of the column at or below it, top-most first, (4) the base the column lies
 * in (the first of `index.dim` whose box holds it), (5) every overlay's own lines, in overlay order. Without a top
 * block (1)–(3) are left out; without its name, (1).
 */
export function describeColumn(input: DescribeColumnInput): string[] {
  const { x, z, topY, blockName, index, scan, overlays } = input;
  const itemName = input.itemName ?? ((key: StuffKey) => key);
  const lines: string[] = [];
  const add = (line: string): void => {
    if (line !== '') lines.push(line);
  };
  if (topY !== null) {
    if (blockName !== null) add(blockName);
    add(`${x} ${topY} ${z}`);
    for (const r of recordsAt(index, x, z, topY)) add(recordLine(r, itemName));
  }
  const base = scan.bases.find((b) => b.dim === index.dim && b.bbox.minX <= x && x <= b.bbox.maxX && b.bbox.minZ <= z && z <= b.bbox.maxZ);
  if (base !== undefined) add(`Base: ${base.name}`);
  for (const overlay of overlays) for (const line of overlay.describe?.(x, z) ?? []) add(line);
  return lines;
}

/** The item keys the storage lines of column (x, z) name (`describeColumn`): the largest contents of each block shown. */
export function columnItemKeys(index: ColumnIndex, x: number, z: number, topY: number | null): StuffKey[] {
  return recordsAt(index, x, z, topY).flatMap((r) => (r.kind === 'storage' && r.storage.contents !== null ? largest(r.storage.contents).map((c) => c.key) : []));
}

const NO_BLOCK: { topY: null; blockName: null } = { topY: null, blockName: null };

/**
 * The top block of column (x, z) in `tile` (the tile of the view's Y level holding that column), named from `names`
 * (the palette names, in palette order; null while not loaded). A tile stores height 0 both for "nothing" and for a
 * block at y 0, so the palette index decides: air, and the unknown block at height 0 (a chunk the scan did not read),
 * are no block; the unknown block above 0 is a block the scan could not name.
 */
export function topBlockAt(tile: MapTile | undefined, x: number, z: number, names: readonly string[] | null): { topY: number | null; blockName: string | null } {
  if (tile === undefined || tileOf(x) !== tile.tx || tileOf(z) !== tile.tz) return NO_BLOCK;
  const i = (z - tile.tz * TILE_SIZE) * TILE_SIZE + (x - tile.tx * TILE_SIZE);
  const index = tile.top[i] ?? AIR_INDEX, height = tile.height[i] ?? 0;
  if (index === AIR_INDEX || (index === UNKNOWN_INDEX && height === 0)) return NO_BLOCK;
  return { topY: height, blockName: names?.[index] ?? null };
}

export interface HoverTimer {
  /** The pointer is over column (x, z): a column other than the last one hides the tooltip and starts the wait again. */
  move(x: number, z: number): void;
  /** No column (the pointer left, a press, a new view): hides the tooltip and drops the wait. */
  clear(): void;
}

/**
 * Calls `show(column)` once the pointer has rested `delayMs` on a column, and `show(null)` as soon as it leaves the
 * column shown. There is one pending wait, restarted only when the pointer enters another column, so however fast the
 * pointer crosses the map only the column it rests on is described.
 */
export function createHoverTimer(show: (column: { x: number; z: number } | null) => void, delayMs: number = HOVER_DELAY_MS): HoverTimer {
  let column: { x: number; z: number } | null = null;
  let wait: ReturnType<typeof setTimeout> | null = null;
  let shown = false;
  const hide = (): void => {
    if (wait !== null) clearTimeout(wait);
    wait = null;
    if (shown) {
      shown = false;
      show(null);
    }
  };
  return {
    move(x, z) {
      if (column !== null && column.x === x && column.z === z) return;
      hide();
      const next = { x, z };
      column = next;
      wait = setTimeout(() => {
        wait = null;
        shown = true;
        show(next);
      }, delayMs);
    },
    clear() {
      hide();
      column = null;
    },
  };
}
