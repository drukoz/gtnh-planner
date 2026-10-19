// Applied Energistics 2 rv3-beta-1073-GTNH (world-format §6.11): controllers, drives, ME chests, interface blocks and
// cable buses, with the channels each uses and the items stored in the cells of drives and ME chests. The world does
// not store channel use, so `channels` is an estimate by part type.

import { parseItemKey, type ItemKey, type StuffKey } from '../../../shared/keys.ts';
import type { ItemCount, RawTe, Vec3 } from '../model.ts';
import { comp, type NbtCompound, type NbtValue } from '../nbt.ts';
import { readStack } from '../tile-entities.ts';

export type Ae2BlockKind = 'controller' | 'drive' | 'chest' | 'interface' | 'cable_bus';

export interface Ae2Rec {
  dim: number; pos: Vec3; block: Ae2BlockKind;
  /** A cable bus's centre cable (`def:6`); null without one and on every other block. */
  center: 'glass' | 'covered' | 'smart' | 'dense' | 'dense_covered' | null;
  /**
   * A cable bus's side parts (`def:0..5`) in side order: the `PartType` name of an AE2 part, the item key of another
   * mod's part, or 'unknown' for a part stack that cannot be named. Empty on other blocks.
   */
  parts: Array<{ side: number; type: string }>;
  /** Channels used: 1 for a drive, ME chest or interface block, plus 1 per side part that needs one; 0 for a controller. */
  channels: number;
  /**
   * Items in a drive's or ME chest's cells, summed per item in slot order; null (found-but-unknown) when any cell
   * cannot be read, fluid cells included. `[]` on every other block.
   */
  cells: ItemCount[] | null;
}

/** The TE ids (block class simple names) this classifier reads. `BlockSkyChest` is a plain chest, not an AE2 network block. */
const TE_BLOCKS: ReadonlyMap<string, Ae2BlockKind> = new Map<string, Ae2BlockKind>([
  ['BlockController', 'controller'], ['BlockDrive', 'drive'], ['BlockChest', 'chest'], ['BlockInterface', 'interface'], ['BlockCableBus', 'cable_bus'],
]);

/** `appeng.items.parts.PartType` bases (world-format §6.11) in ascending order; a part's damage is its base plus a variant. */
export const PART_BASES: ReadonlyArray<[number, string]> = Object.freeze([
  [0, 'CableGlass'], [20, 'CableCovered'], [40, 'CableSmart'], [60, 'CableDense'], [80, 'ToggleBus'], [100, 'InvertedToggleBus'],
  [120, 'CableAnchor'], [140, 'QuartzFiber'], [160, 'Monitor'], [180, 'SemiDarkMonitor'], [200, 'DarkMonitor'], [220, 'StorageBus'],
  [240, 'ImportBus'], [260, 'ExportBus'], [280, 'LevelEmitter'], [281, 'AdvancedLevelEmitter'], [300, 'AnnihilationPlane'],
  [301, 'IdentityAnnihilationPlane'], [320, 'FormationPlane'], [340, 'PatternTerminal'], [360, 'CraftingTerminal'],
  [370, 'CraftingDiagnosticTerminal'], [380, 'Terminal'], [400, 'StorageMonitor'], [410, 'ThroughputMonitor'], [420, 'ConversionMonitor'],
  [440, 'Interface'], [460, 'P2PTunnelME'], [461, 'P2PTunnelRedstone'], [462, 'P2PTunnelItems'], [463, 'P2PTunnelLiquids'],
  [465, 'P2PTunnelEU'], [466, 'P2PTunnelRF'], [467, 'P2PTunnelLight'], [468, 'P2PTunnelOpenComputers'], [469, 'P2PTunnelPressure'],
  [470, 'P2PTunnelGT'], [471, 'P2PTunnelInterface'], [472, 'P2PTunnelSound'], [473, 'PatternRepeater'], [480, 'InterfaceTerminal'],
  [500, 'PatternTerminalEx'], [520, 'CableDenseCovered'], [690, 'PartCreativeEnergy'],
].map(([base, name]) => Object.freeze([base, name]) as [number, string]));

/** The part type of an `ItemMultiPart` damage: the largest base at or below it (a negative damage reads as 0). */
export function partType(damage: number): string {
  const d = damage > 0 ? damage : 0;
  let type = 'CableGlass';
  for (const [base, name] of PART_BASES) {
    if (base > d) break;
    type = name;
  }
  return type;
}

const MULTI_PART = 'appliedenergistics2:item.ItemMultiPart';

const CENTRE_CABLES: ReadonlyMap<string, NonNullable<Ae2Rec['center']>> = new Map<string, NonNullable<Ae2Rec['center']>>([
  ['CableGlass', 'glass'], ['CableCovered', 'covered'], ['CableSmart', 'smart'], ['CableDense', 'dense'], ['CableDenseCovered', 'dense_covered'],
]);

/** Side parts that use no channel: cables and anchors, quartz fibres, panels and monitors, toggle buses. */
const NO_CHANNEL = /^Cable|^CableAnchor$|^QuartzFiber$|Monitor$|ToggleBus$/;

/** The part a `def:<side>` stack holds (see `Ae2Rec.parts`); null when the key holds no compound (no part there). */
function partOf(v: NbtValue | undefined, itemNames: Map<number, string>): string | null {
  const c = comp(v);
  if (c === null) return null;
  const s = readStack(c, itemNames);
  if (s === null) return 'unknown';
  const { id, meta } = parseItemKey(s.key);
  return id === MULTI_PART ? partType(meta) : s.key;
}

/** `#<n>` with `n` a plain decimal: an `inv` slot (`AppEngInternalInventory`) or a cell's stored stack (`CellInventory`). */
const NUMBERED_KEY = /^#(0|[1-9]\d*)$/;

/** The `#<n>` entries of a compound in numeric order of `n`, whatever order the NBT lists them in. */
function numbered(t: NbtCompound): Array<[n: number, value: NbtValue]> {
  const out: Array<[number, NbtValue]> = [];
  for (const [k, v] of Object.entries(t)) {
    const m = NUMBERED_KEY.exec(k);
    if (m !== null) out.push([Number(m[1]), v]);
  }
  return out.sort((a, b) => a[0] - b[0]);
}

/** An AE stack's item key. Its amount is in `@<n>`/`Cnt`, not in its `Count` Byte, so `Count` is not consulted. */
function aeStackKey(ae: NbtCompound, itemNames: Map<number, string>): ItemKey | null {
  return readStack({ ...ae, Count: 0 }, itemNames)?.key ?? null;
}

/**
 * Adds one cell's items to `counts`: each `#<n>` AE stack with the amount `@<n>`, else its `Cnt`. A cell with no `tag`
 * was never written to. False when the cell cannot be read: an unknown cell item, a fluid cell (`ft`/`fc`), or a
 * stored stack that cannot be keyed or has no non-negative amount.
 */
function addCell(cell: NbtCompound, itemNames: Map<number, string>, counts: Map<StuffKey, number>): boolean {
  if (readStack(cell, itemNames) === null) return false;
  const tag = comp(cell.tag);
  if (tag === null) return true;
  if (tag.ft !== undefined || tag.fc !== undefined) return false;
  for (const [n, v] of numbered(tag)) {
    const ae = comp(v);
    const key = ae === null ? null : aeStackKey(ae, itemNames);
    const slotCount = tag[`@${n}`];
    const amount = typeof slotCount === 'number' ? slotCount : ae?.Cnt;
    if (key === null || typeof amount !== 'number' || amount < 0) return false;
    if (amount > 0) counts.set(key, (counts.get(key) ?? 0) + amount);
  }
  return true;
}

/** The items in the `inv` cells, summed per item in slot order; no `inv` holds nothing, an unreadable one is null. */
function cellContents(inv: NbtValue | undefined, itemNames: Map<number, string>): ItemCount[] | null {
  if (inv === undefined) return [];
  const slots = comp(inv);
  if (slots === null) return null;
  const counts = new Map<StuffKey, number>();
  for (const [, v] of numbered(slots)) {
    const cell = comp(v);
    if (cell === null || !addCell(cell, itemNames, counts)) return null;
  }
  return [...counts].map(([key, count]) => ({ key, count }));
}

/** A controller, drive, ME chest, interface block or cable bus; null for every other tile entity. */
export function classifyAe2(te: RawTe, itemNames: Map<number, string>): Ae2Rec | null {
  const block = TE_BLOCKS.get(te.id);
  if (block === undefined) return null;
  const pos: Vec3 = [te.x, te.y, te.z];
  switch (block) {
    case 'cable_bus': {
      const centre = partOf(te.nbt['def:6'], itemNames);
      const parts: Ae2Rec['parts'] = [];
      for (let side = 0; side < 6; side++) {
        const type = partOf(te.nbt[`def:${side}`], itemNames);
        if (type !== null) parts.push({ side, type });
      }
      const channels = parts.filter((p) => !NO_CHANNEL.test(p.type)).length;
      return { dim: te.dim, pos, block, center: centre === null ? null : CENTRE_CABLES.get(centre) ?? null, parts, channels, cells: [] };
    }
    case 'controller':
      return { dim: te.dim, pos, block, center: null, parts: [], channels: 0, cells: [] };
    case 'interface':
      return { dim: te.dim, pos, block, center: null, parts: [], channels: 1, cells: [] };
    case 'drive':
    case 'chest':
      return { dim: te.dim, pos, block, center: null, parts: [], channels: 1, cells: cellContents(te.nbt.inv, itemNames) };
  }
}
