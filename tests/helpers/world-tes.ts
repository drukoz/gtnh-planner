// Tile-entity compounds for synthetic worlds, in the shapes of world-format §5–§6 (Tasks 5 and 6 add the storage and
// logistics mod builders). Each returns a Tag for `ChunkSpec.tileEntities` or for `parseTag` in classifier tests.

import type { Vec3 } from '../../src/server/world/model.ts';
import { byte, comp, int, list, long, short, str, type Tag } from './nbt-write.ts';

/** EndlessIDs writes item ids above this as `id: Short 0` plus `idExt: Int` (world-format §5). */
const MAX_SHORT_ITEM_ID = 31_999;

/** `{ id, x, y, z, ...fields }`: every TE carries its String id and Int absolute position (world-format §6). */
export function te(id: string, pos: Vec3, fields: Record<string, Tag>): Tag {
  return comp({ id: str(id), x: int(pos[0]), y: int(pos[1]), z: int(pos[2]), ...fields });
}

/** A list of compounds; an empty one has element type End, as Minecraft writes it. */
export function compounds(items: readonly Tag[]): Tag {
  return items.length === 0 ? list('end', []) : list('compound', items);
}

function entriesOf(t: Tag): Readonly<Record<string, Tag>> {
  if (t.type !== 'compound') throw new TypeError(`expected a compound tag, got '${t.type}'`);
  return t.entries;
}

/**
 * A GregTech machine (`BaseMetaTileEntity`, world-format §6.1): `mID` Int, `mFacing` Short, `mMainFacing` Int when
 * given, `mColor` Byte, `mStoredEnergy` Long and `mWorks` saved **inverted** (Byte 1 = disabled); `extra` is merged last.
 */
export function gtMachine(o: {
  pos: Vec3; mID: number; facing?: number; mainFacing?: number; color?: number; storedEU?: number; works?: boolean; extra?: Record<string, Tag>;
}): Tag {
  const { pos, mID, facing = 2, mainFacing, color = 0, storedEU = 0, works = true, extra = {} } = o;
  return te('BaseMetaTileEntity', pos, {
    mID: int(mID), mFacing: short(facing), ...(mainFacing === undefined ? {} : { mMainFacing: int(mainFacing) }),
    mColor: byte(color), mStoredEnergy: long(BigInt(storedEU)), mWorks: byte(works ? 0 : 1), ...extra,
  });
}

/**
 * A GregTech pipe or cable (`BaseMetaPipeEntity`, world-format §6.2): `mID` Int, `mConnections` Byte (`1 << side`).
 * Fluid pipes write `mDisableInput` (and `mLastReceivedFrom`), item pipes `mLastReceivedFrom` only, cables neither.
 */
export function gtPipe(o: { pos: Vec3; mID: number; connections: number; kind: 'cable' | 'fluid' | 'item' }): Tag {
  const kindKeys: Record<string, Tag> =
    o.kind === 'fluid' ? { mLastReceivedFrom: byte(0), mDisableInput: byte(0) } : o.kind === 'item' ? { mLastReceivedFrom: byte(0) } : {};
  return te('BaseMetaPipeEntity', o.pos, { mID: int(o.mID), mConnections: byte(o.connections), mColor: byte(0), ...kindKeys });
}

/** The fields of a vanilla stack, to spread into slot compounds: `id` Short (`idExt` Int above 31,999), `Count` Byte, `Damage` Short. */
export function stackFields(id: number, count: number, damage = 0): Record<string, Tag> {
  const ids: Record<string, Tag> = id > MAX_SHORT_ITEM_ID ? { id: short(0), idExt: int(id) } : { id: short(id) };
  return { ...ids, Count: byte(count), Damage: short(damage) };
}

/** A vanilla stack compound (`ItemStack.writeToNBT` under EndlessIDs), plus `extra` keys such as `tag`. */
export function stack(id: number, count: number, damage = 0, extra: Record<string, Tag> = {}): Tag {
  return comp({ ...stackFields(id, count, damage), ...extra });
}

/** Chest `Items` (world-format §6.8): `{ Slot: Byte } + stack` per entry; slot 200 is written as Byte −56. */
function chestItems(items: ReadonlyArray<[slot: number, stack: Tag]>): Tag {
  return compounds(items.map(([slot, s]) => comp({ Slot: byte(slot), ...entriesOf(s) })));
}

/** A vanilla chest (`Chest`, world-format §6.8): `Items` of `{ Slot: Byte } + stack`; slot 200 is written as Byte −56. */
export function chest(pos: Vec3, items: Array<[slot: number, stack: Tag]>): Tag {
  return te('Chest', pos, { Items: chestItems(items) });
}

/** An IronChest chest (world-format §6.8): TE id `IronChest.<type>`, `Items` as a vanilla chest, `facing` Byte. */
export function ironChest(pos: Vec3, type: string, items: Array<[slot: number, stack: Tag]>): Tag {
  return te(`IronChest.${type}`, pos, { Items: chestItems(items), facing: byte(2) });
}

/**
 * A Storage Drawers slot: `[itemId, count, damage = 0]`, written `{ ItemStack: <stack, Count 1>, Count: Int }`; a slot
 * compound written as given (such as the legacy `{ Item, Meta, Count }`); or null for an empty slot `{}`.
 */
export type DrawerSlot = [id: number, count: number, damage?: number] | Tag | null;

/**
 * A Storage Drawers drawer (world-format §6.6): `StorageDrawers:tileDrawersStandard` with `Slots`, `Cap` Int (base
 * stacks per slot) and `Dir`, plus `Upgrades` (`{ Slot: Byte } + stack` per `[itemId, damage]`) when any are given.
 * `comp` writes a compacting drawer (`StorageDrawers:tileDrawersComp`) with its pooled `Count` Int.
 */
export function drawer(o: { pos: Vec3; slots: readonly DrawerSlot[]; cap?: number; comp?: boolean; upgrades?: ReadonlyArray<[id: number, damage: number]> }): Tag {
  const { pos, slots, cap = 16, comp: compacting = false, upgrades = [] } = o;
  const slotTags = slots.map((s) =>
    s === null ? comp({}) : Array.isArray(s) ? comp({ ItemStack: stack(s[0], 1, s[2] ?? 0), Count: int(s[1]) }) : s);
  const pooled = slots.reduce((sum, s) => sum + (Array.isArray(s) ? s[1] : 0), 0);
  return te(compacting ? 'StorageDrawers:tileDrawersComp' : 'StorageDrawers:tileDrawersStandard', pos, {
    Slots: compounds(slotTags), Cap: int(cap), Dir: byte(2),
    ...(upgrades.length === 0 ? {} : { Upgrades: compounds(upgrades.map(([id, damage], i) => comp({ Slot: byte(i), ...stackFields(id, 1, damage) }))) }),
    ...(compacting ? { Count: int(pooled) } : {}),
  });
}

/** A drawer controller (`StorageDrawers:tileController`): it saves only `Dir` (world-format §6.6). */
export function drawerController(pos: Vec3): Tag {
  return te('StorageDrawers:tileController', pos, { Dir: byte(2) });
}

/** A controller slave (`StorageDrawers:tileControllerSlave`): `Controller: { x, y, z }` of the controller it joined. */
export function drawerSlave(pos: Vec3, controller: Vec3): Tag {
  return te('StorageDrawers:tileControllerSlave', pos, { Controller: comp({ x: int(controller[0]), y: int(controller[1]), z: int(controller[2]) }) });
}

/**
 * A JABBA barrel (`TileEntityBarrel`, world-format §6.7): `storage { amount, maxstacks, upgCapacity, current_item? }`
 * with the stored item written at Count 0, plus the facing Ints and the `creative`/`ender`/`linked` Bytes.
 */
export function barrel(o: { pos: Vec3; item?: number; damage?: number; amount: number; maxstacks?: number; linked?: boolean; ender?: boolean }): Tag {
  const { pos, item, damage = 0, amount, maxstacks = 64, linked = false, ender = false } = o;
  const storage = comp({
    amount: int(amount), maxstacks: int(maxstacks), upgCapacity: int(0), ...(item === undefined ? {} : { current_item: stack(item, 0, damage) }),
  });
  return te('TileEntityBarrel', pos, {
    storage, rotation: int(2), orientation: int(1), creative: byte(0), ender: byte(ender ? 1 : 0), linked: byte(linked ? 1 : 0),
  });
}

/** A pre-upgrade GT ore TE (world-format §8): the 61-byte `{ m: Short, n: Byte, id, x, y, z }`. */
export function oreTe(pos: Vec3): Tag {
  return comp({ m: short(32), n: byte(1), id: str('GT_TileEntity_Ores'), x: int(pos[0]), y: int(pos[1]), z: int(pos[2]) });
}
