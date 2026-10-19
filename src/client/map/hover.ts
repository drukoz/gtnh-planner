// What the map says about the block under the pointer (spec §3.7; architecture §11, Map hover): the scan's records of
// one dimension by column, the hover tooltip's lines for a column, the top block of a column in a map tile, the names
// of GT tile entities in the palette names, and the short rest before a column is described. Pure TypeScript without
// the DOM, so all of it runs in tests as it is.

import type { StuffKey } from '../../shared/keys.ts';
import { TIER_NAMES, tierName } from '../../shared/gt/tiers.ts';
import type { PaletteName } from '../../shared/types/api.ts';
import { FACES } from '../../shared/types/assets.ts';
import {
  AIR_INDEX, TILE_SIZE, tileOf, UNKNOWN_INDEX, type LogisticsBlock, type MapTile, type PlacedMachine, type PlacedPipe, type StorageBlock, type WorldScan,
} from '../../shared/types/world.ts';
import type { MapOverlay } from './types.ts';

/** How long (ms) the pointer rests on a column before the map describes it. */
export const HOVER_DELAY_MS = 150;

/** A storage line names this many of the block's contents, the largest first. */
const CONTENTS_SHOWN = 3;
/**
 * A column lists this many of its scan records, top-most first, and counts the rest ("+N more below"): a riser, a
 * stacked wall or a multi-floor base would otherwise push the base and overlay lines out of the map box.
 */
const RECORDS_SHOWN = 5;
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
  /** `drawers`: for a drawer controller, the drawers the scan joined to it (`StorageBlock.controller`); else 0. */
  | { kind: 'storage'; y: number; storage: StorageBlock; drawers: number }
  | { kind: 'logistics'; y: number; block: LogisticsBlock; label: string };

/** Records at the same height: machine, pipe, storage, logistics. */
const KIND_ORDER: Readonly<Record<ColumnRecord['kind'], number>> = { machine: 0, pipe: 1, storage: 2, logistics: 3 };

/** The scan records of dimension `dim` by column, each column top-most first (`buildColumnIndex`). */
export interface ColumnIndex { readonly dim: number; readonly columns: ReadonlyMap<string, readonly ColumnRecord[]> }

const columnKey = (x: number, z: number): string => `${x},${z}`;
const int = (n: number): string => n.toLocaleString('en-US', { maximumFractionDigits: 0 });
const plural = (n: number, word: string): string => `${int(n)} ${word}${n === 1 ? '' : 's'}`;
/** The names route's word for a GT tile entity id the export does not know (architecture §11, Map hover), as the Found panel says it. */
const unknownMachine = (mteId: number): string => `Unknown machine #${mteId}`;

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
  // A drawer controller holds nothing of its own (the scan writes []): its network is the drawers that name it.
  const drawersOf = new Map<string, number>();
  for (const s of scan.storage) {
    if (s.dim !== dim || s.controller === undefined) continue;
    const at = s.controller.join(',');
    drawersOf.set(at, (drawersOf.get(at) ?? 0) + 1);
  }
  for (const machine of scan.machines) if (machine.dim === dim) add(machine.pos, { kind: 'machine', y: machine.pos[1], machine });
  for (const pipe of scan.pipes) if (pipe.dim === dim) add(pipe.pos, { kind: 'pipe', y: pipe.pos[1], pipe });
  for (const s of scan.storage) {
    if (s.dim !== dim) continue;
    const drawers = s.kind === 'drawer_controller' ? drawersOf.get(s.pos.join(',')) ?? 0 : 0;
    add(s.pos, { kind: 'storage', y: s.pos[1], storage: s, drawers });
  }
  for (const block of scan.logisticsBlocks ?? []) {
    const label = LOGISTICS_LABELS[block.kind];
    if (block.dim === dim && label !== undefined) add(block.pos, { kind: 'logistics', y: block.pos[1], block, label });
  }
  for (const list of columns.values()) list.sort((a, b) => b.y - a.y || KIND_ORDER[a.kind] - KIND_ORDER[b.kind]);
  return { dim, columns };
}

const NO_RECORDS: { shown: readonly ColumnRecord[]; more: number } = { shown: [], more: 0 };

/**
 * The records of column (x, z) at or below its top block, top-most first: the RECORDS_SHOWN the tooltip lists, and how
 * many more lie below them. None without a top block.
 */
function shownRecords(index: ColumnIndex, x: number, z: number, topY: number | null): { shown: readonly ColumnRecord[]; more: number } {
  if (topY === null) return NO_RECORDS;
  const below = (index.columns.get(columnKey(x, z)) ?? []).filter((r) => r.y <= topY);
  return below.length === 0 ? NO_RECORDS : { shown: below.slice(0, RECORDS_SHOWN), more: Math.max(0, below.length - RECORDS_SHOWN) };
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

/** North, south, west or east: a ForgeDirection ordinal 2–5. */
const isSide = (face: number): boolean => Number.isInteger(face) && face >= 2 && face <= 5;

/**
 * `<name> (<TIER>) · facing <front>[ · output <side>][ · stored <n> EU]`. The front is the face GT draws it on: a basic
 * machine's `mainFacing` (`mMainFacing`), except when that is up or down (GT then draws the front on `facing`), and
 * `facing` (`mFacing`) for every other machine, which has no `mainFacing`. A basic machine's `facing` is its output
 * side, named when the front is another face (research textures-icons "Which face gets what", world-format §6.1).
 */
function machineLine(m: PlacedMachine): string {
  const tier = tierText(m.tier);
  const front = m.mainFacing !== undefined && isSide(m.mainFacing) ? m.mainFacing : m.facing;
  const frontFace = FACES[front], outputFace = FACES[m.facing];
  let line = m.name ?? unknownMachine(m.mteId);
  if (tier !== null) line += ` (${tier})`;
  if (frontFace !== undefined) line += `${SEP}facing ${frontFace}`;
  if (front !== m.facing && outputFace !== undefined) line += `${SEP}output ${outputFace}`;
  // The scan writes 0 when a machine holds no energy (or says nothing), so only a positive buffer is worth a word.
  if (m.storedEU !== undefined && m.storedEU > 0) line += `${SEP}stored ${int(m.storedEU)} EU`;
  return line;
}

/**
 * A GT cable or pipe by its own English name, which carries its material ("1x Tin Cable", "Bronze Fluid Pipe"), else
 * by its kind; a cable adds its voltage tier and amps. The scan record has no name: it comes from the palette names by
 * `mteId`, so a pipe under a floor or a machine is named as well as one on top.
 */
function pipeLine(p: PlacedPipe, mteName: (mteId: number) => string | undefined): string {
  const parts = [mteName(p.mteId) ?? (p.kind === undefined ? 'GT pipe' : PIPE_LABELS[p.kind])];
  if (p.kind === 'cable') {
    const tier = tierText(p.voltageTier);
    if (tier !== null) parts.push(tier);
    if (p.amps !== undefined) parts.push(`${int(p.amps)} A`);
  }
  return parts.join(SEP);
}

/**
 * The block's kind and what it holds itself: its 3 largest contents and how many more, "empty" or "contents unknown".
 * A drawer controller holds nothing itself (its `[]` is not "empty"): it says how many drawers are joined to it.
 */
function storageLine(r: { storage: StorageBlock; drawers: number }, itemName: (key: StuffKey) => string): string {
  const s = r.storage;
  const parts = [STORAGE_LABELS[s.kind]];
  if (s.kind === 'drawer_controller') {
    if (r.drawers > 0) parts.push(plural(r.drawers, 'drawer'));
  } else if (s.contents === null) parts.push('contents unknown');
  else if (s.contents.length === 0) parts.push('empty');
  else {
    for (const c of largest(s.contents)) parts.push(`${int(c.count)}× ${itemName(c.key)}`);
    if (s.contents.length > CONTENTS_SHOWN) parts.push(`+${int(s.contents.length - CONTENTS_SHOWN)} more`);
  }
  return parts.join(SEP);
}

/** Where a record line gets the names the scan does not hold. */
interface LineNames { itemName: (key: StuffKey) => string; mteName: (mteId: number) => string | undefined }

function recordLine(r: ColumnRecord, names: LineNames): string {
  switch (r.kind) {
    case 'machine': return machineLine(r.machine);
    case 'pipe': return pipeLine(r.pipe, names.mteName);
    case 'storage': return storageLine(r, names.itemName);
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
  /** The English name of the GT tile entity `mteId` (`mteNamesOf` the palette names), for cables and pipes; undefined when unknown. */
  mteName?: (mteId: number) => string | undefined;
}

const NO_MTE_NAME = (): undefined => undefined;

/**
 * The hover tooltip's lines for column (x, z), in this order and none of them empty: (1) the top block's name, (2) its
 * position, (3) a line for each scan record of the column at or below it, top-most first — one below the top block
 * starts with its own height, "y <y>" — at most RECORDS_SHOWN of them, then "+N more below" for the rest, (4) the base
 * the column lies in (the first of `index.dim` whose box holds it), (5) every overlay's own lines, in overlay order.
 * Without a top block (1)–(3) are left out; without its name, (1).
 */
export function describeColumn(input: DescribeColumnInput): string[] {
  const { x, z, topY, blockName, index, scan, overlays } = input;
  const names: LineNames = { itemName: input.itemName ?? ((key: StuffKey) => key), mteName: input.mteName ?? NO_MTE_NAME };
  const lines: string[] = [];
  const add = (line: string): void => {
    if (line !== '') lines.push(line);
  };
  if (topY !== null) {
    if (blockName !== null) add(blockName);
    add(`${x} ${topY} ${z}`);
    const { shown, more } = shownRecords(index, x, z, topY);
    for (const r of shown) add(r.y < topY ? `y ${r.y}${SEP}${recordLine(r, names)}` : recordLine(r, names));
    if (more > 0) add(`+${int(more)} more below`);
  }
  const base = scan.bases.find((b) => b.dim === index.dim && b.bbox.minX <= x && x <= b.bbox.maxX && b.bbox.minZ <= z && z <= b.bbox.maxZ);
  if (base !== undefined) add(`Base: ${base.name}`);
  for (const overlay of overlays) for (const line of overlay.describe?.(x, z) ?? []) add(line);
  return lines;
}

/** The item keys the storage lines of column (x, z) name (`describeColumn`): the largest contents of each block listed. */
export function columnItemKeys(index: ColumnIndex, x: number, z: number, topY: number | null): StuffKey[] {
  return shownRecords(index, x, z, topY).shown.flatMap((r) => (
    r.kind === 'storage' && r.storage.contents !== null ? largest(r.storage.contents).map((c) => c.key) : []
  ));
}

/**
 * The English name of each GT tile entity in the palette names (`GET …/palette?names=1`), by `mteId`: every GT block
 * state of the scan is a palette entry carrying its `mteId`, wherever it stands. The route's "Unknown machine #<id>"
 * for an id the export does not know is not a name and is left out, so such a pipe keeps its kind.
 */
export function mteNamesOf(entries: readonly PaletteName[]): ReadonlyMap<number, string> {
  const names = new Map<number, string>();
  for (const { block, name } of entries) {
    if (block.mteId !== undefined && name !== unknownMachine(block.mteId) && !names.has(block.mteId)) names.set(block.mteId, name);
  }
  return names;
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
