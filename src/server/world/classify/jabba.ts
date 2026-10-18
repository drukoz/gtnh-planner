// JABBA 1.5.23 barrels (world-format §6.7): `TileEntityBarrel` holds one item type, `storage.amount` of it.

import type { ItemCount, RawTe, StorageRec } from '../model.ts';
import { comp, num, type NbtCompound } from '../nbt.ts';
import { readStack } from '../tile-entities.ts';

/**
 * `storage.amount` of `storage.current_item` (a stack written at Count 0). Null (found-but-unknown) for a barrel
 * linked to BSpace (`ender` or `linked`: its storage lives in `World/JABBA/*.dat`, not decoded), and for one whose
 * amount or stored item cannot be read.
 */
function barrelContents(t: NbtCompound, storage: NbtCompound | null, itemNames: Map<number, string>): ItemCount[] | null {
  if (num(t.ender) !== 0 || num(t.linked) !== 0) return null;
  const amount = storage?.amount;
  if (typeof amount !== 'number' || amount < 0) return null;
  if (amount === 0) return [];
  const item = comp(storage?.current_item);
  const s = item === null ? null : readStack(item, itemNames);
  return s === null ? null : [{ key: s.key, count: amount }];
}

/** A JABBA barrel: its contents and `storage.maxstacks` as capacity (null when the barrel has no readable `storage`). */
export function classifyBarrel(te: RawTe, itemNames: Map<number, string>): StorageRec {
  const storage = comp(te.nbt.storage);
  const maxstacks = storage?.maxstacks;
  return {
    dim: te.dim, pos: [te.x, te.y, te.z], kind: 'barrel',
    capacityStacks: typeof maxstacks === 'number' ? maxstacks : null,
    contents: barrelContents(te.nbt, storage, itemNames),
  };
}
