// Chests (world-format §6.8): vanilla `Chest` (chests and trapped chests) and IronChest 6.1.13 `IronChest.<TYPE>`.

import type { StuffKey } from '../../../shared/keys.ts';
import type { ItemCount, RawTe, StorageRec, Vec3 } from '../model.ts';
import { comp, list, num, type NbtCompound } from '../nbt.ts';
import { readStack } from '../tile-entities.ts';

/** Slots per IronChest type (`IronChestType`); `DIRTCHEST9000` and `WOOD` are unverified, so they have no capacity. */
export const IRON_CHEST_SLOTS: Readonly<Record<string, number>> = Object.freeze({
  IRON: 54, GOLD: 81, DIAMOND: 108, COPPER: 45, STEEL: 72, CRYSTAL: 108, OBSIDIAN: 108, NETHERITE: 135, DARKSTEEL: 135, SILVER: 72,
});

const VANILLA_CHEST_SLOTS = 27;
const IRON_CHEST_PREFIX = 'IronChest.';

/**
 * `Items` summed per item in first-seen order. Totals do not depend on where a stack sits, so `Slot` (a Byte the game
 * reads as `& 0xFF`) is not consulted and no entry is dropped for its slot: slots 128 and up, which decode as
 * negative Bytes, count like any other. A stack whose `Count` reads 0 holds nothing; any other stack that cannot be
 * read makes the whole chest found-but-unknown (null).
 */
function chestContents(t: NbtCompound, itemNames: Map<number, string>): ItemCount[] | null {
  const counts = new Map<StuffKey, number>();
  for (const entry of list(t.Items)) {
    const c = comp(entry);
    if (c === null) return null;
    if (num(c.Count) === 0) continue;
    const s = readStack(c, itemNames);
    if (s === null) return null;
    counts.set(s.key, (counts.get(s.key) ?? 0) + s.count);
  }
  return [...counts].map(([key, count]) => ({ key, count }));
}

/** A vanilla chest (27 stacks) or an IronChest chest (stacks from `IRON_CHEST_SLOTS`, left out for other types); else null. */
export function classifyChest(te: RawTe, itemNames: Map<number, string>): StorageRec | null {
  const pos: Vec3 = [te.x, te.y, te.z];
  if (te.id === 'Chest') return { dim: te.dim, pos, kind: 'chest', capacityStacks: VANILLA_CHEST_SLOTS, contents: chestContents(te.nbt, itemNames) };
  if (!te.id.startsWith(IRON_CHEST_PREFIX)) return null;
  const type = te.id.slice(IRON_CHEST_PREFIX.length);
  const slots = Object.hasOwn(IRON_CHEST_SLOTS, type) ? IRON_CHEST_SLOTS[type] : undefined;
  return { dim: te.dim, pos, kind: 'iron_chest', ...(slots === undefined ? {} : { capacityStacks: slots }), contents: chestContents(te.nbt, itemNames) };
}
