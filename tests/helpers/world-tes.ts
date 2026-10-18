// Tile-entity compounds for synthetic worlds, in the shapes of world-format §5–§6 (Tasks 5 and 6 add the storage and
// logistics mod builders). Each returns a Tag for `ChunkSpec.tileEntities` or for `parseTag` in classifier tests.

import type { Vec3 } from '../../src/server/world/model.ts';
import { byte, bytes, comp, int, ints, list, long, short, str, type Tag } from './nbt-write.ts';

/** EndlessIDs writes item ids above this as `id: Short 0` plus `idExt: Int` (world-format §5). */
const MAX_SHORT_ITEM_ID = 31_999;

/**
 * Item ids of `DEFAULT_ITEM_IDS` (make-world.ts) the logistics builders write; repeated here because make-world.ts
 * imports this file. `appliedenergistics2:item.ItemMultiPart` and `appliedenergistics2:item.ItemBasicStorageCell.1k`.
 */
const AE2_MULTI_PART_ID = 5300;
const AE2_CELL_ID = 5301;

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

// ---- Logistics mods (world-format §6.9–§6.11) ----

/** Project Red pipe part ids in `PipeDefs` order: a pipe part's `meta` Byte is its index here (world-format §6.9). */
const PR_PIPE_DEFS: readonly string[] = Object.freeze([
  'pr_pipe', 'pr_rbasic', 'pr_rinterface', 'pr_rcrafting', 'pr_rrequest', 'pr_rextension', 'pr_rfire', 'pr_pt', 'pr_rpt', 'pr_netvalve', 'pr_netlatency',
]);

/** A Forge Multipart part that is not a pipe (a torch, a cover): its `id` and a `meta` Byte. */
function plainPart(id: string): Tag {
  return comp({ id: str(id), meta: byte(0) });
}

/**
 * A Forge Multipart block holding a Project Red pipe (`savedMultipart`, world-format §6.9). The pipe part is
 * `{ id, meta: Byte (def index), connMap: Int, itemFlow }`, plus `io` Byte when given, and the routing chips as
 * `chipsitems` (`{ index: Int } + stack`) with `chipsitemsCount` Int 4 on interface pipes or whenever `chips` is given.
 * `others` are non-pipe part ids written ahead of the pipe.
 */
export function prPipe(o: { pos: Vec3; part: string; connMap: number; io?: number; chips?: readonly Tag[]; others?: readonly string[] }): Tag {
  const meta = PR_PIPE_DEFS.indexOf(o.part);
  if (meta < 0) throw new RangeError(`not a Project Red pipe part id: '${o.part}'`);
  const chips = o.chips ?? (o.part === 'pr_rinterface' ? [] : undefined);
  const pipe = comp({
    id: str(o.part), meta: byte(meta), connMap: int(o.connMap), itemFlow: compounds([]),
    ...(o.io === undefined ? {} : { io: byte(o.io) }),
    ...(chips === undefined ? {} : {
      chipsitems: compounds(chips.map((c, i) => comp({ index: int(i), ...entriesOf(c) }))), chipsitemsCount: int(4),
    }),
  });
  return te('savedMultipart', o.pos, { parts: compounds([...(o.others ?? []).map(plainPart), pipe]) });
}

/** A Forge Multipart block whose only part is not a pipe, such as `mc_torch` (world-format §6.9). */
export function otherMultipart(pos: Vec3, partId: string): Tag {
  return te('savedMultipart', pos, { parts: compounds([plainPart(partId)]) });
}

/** EnderIO `ConnectionMode` ordinals the conduit builder writes into `conModes`. */
const CON_MODE_IN_OUT = 0;
const CON_MODE_NOT_SET = 4;

/**
 * An EnderIO conduit bundle (`blockConduitBundleTileEntity`, world-format §6.10): one `conduits` entry
 * `{ conduitType: <class name>, conduit: { connections, externalConnections, conModes, signalActive } }` per conduit,
 * the two link lists as IntArrays of ForgeDirection ordinals and `conModes` a ByteArray(6); no facade (`facadeId` "null").
 */
export function conduit(o: {
  pos: Vec3; conduits: ReadonlyArray<{ cls: string; connections: readonly number[]; external: readonly number[] }>;
}): Tag {
  return te('blockConduitBundleTileEntity', o.pos, {
    conduits: compounds(o.conduits.map((c) => comp({
      conduitType: str(c.cls),
      conduit: comp({
        connections: ints(c.connections), externalConnections: ints(c.external),
        conModes: bytes(Array.from({ length: 6 }, (_, side) => (c.external.includes(side) ? CON_MODE_IN_OUT : CON_MODE_NOT_SET))),
        signalActive: byte(0),
      }),
    }))),
    facadeId: str('null'), facadeMeta: int(0), nbtVersion: short(1),
  });
}

/** The grid node every AE2 network tile saves (`proxy { p: player id, k: security key, g: grid storage id }`). */
function ae2Proxy(): Tag {
  return comp({ p: int(0), k: long(0n), g: long(1n) });
}

/** An AE2 controller (`BlockController`, world-format §6.11): `paintedColor` and its grid node. */
export function ae2Controller(pos: Vec3): Tag {
  return te('BlockController', pos, { paintedColor: byte(16), proxy: ae2Proxy() });
}

/**
 * A storage cell for `ae2Drive`. An item cell stores `items` as `[itemId, damage, count]` per type; with no items it
 * is a cell never written to (no `tag`). `fluid` writes a fluid cell (`ft`/`fc`). `cntOnly` leaves out the `@<n>`
 * counts, so only each AE stack's `Cnt` holds the amount.
 */
export interface Ae2CellSpec { items?: ReadonlyArray<[id: number, damage: number, count: number]>; fluid?: boolean; cntOnly?: boolean }

/** An AE stack (`AEItemStack.writeToNBT` keys, world-format §6.11): the stack fields with `Count` 0 and the amount in `Cnt` Long. */
function aeItemStack(id: number, damage: number, count: number): Tag {
  return comp({ ...stackFields(id, 0, damage), Cnt: long(BigInt(count)), Req: long(0n), Craft: byte(0) });
}

/** A cell item stack whose `tag` holds its contents: `it` Short, `ic` Long, `#<n>` AE stacks and `@<n>` Long counts. */
function ae2Cell(c: Ae2CellSpec): Tag {
  if (c.fluid === true) {
    const water = comp({ FluidName: str('water'), Count: byte(0), Cnt: long(1000n), Req: long(0n), Craft: byte(0) });
    return stack(AE2_CELL_ID, 1, 0, { tag: comp({ ft: short(1), fc: long(1000n), '#0': water, '@0': long(1000n) }) });
  }
  const items = c.items ?? [];
  if (items.length === 0) return stack(AE2_CELL_ID, 1, 0);
  const entries: Record<string, Tag> = { it: short(items.length), ic: long(BigInt(items.reduce((sum, [, , count]) => sum + count, 0))) };
  items.forEach(([id, damage, count], n) => {
    entries[`#${n}`] = aeItemStack(id, damage, count);
    if (c.cntOnly !== true) entries[`@${n}`] = long(BigInt(count));
  });
  return stack(AE2_CELL_ID, 1, 0, { tag: comp(entries) });
}

/**
 * An AE2 drive (`BlockDrive`, world-format §6.11): `priority`, `paintedColor`, orientation and grid node, and the cells
 * in `inv` as `#<slot>` stacks from slot 0. `chest` writes an ME chest (`BlockChest`), which holds one cell.
 */
export function ae2Drive(o: { pos: Vec3; cells: readonly Ae2CellSpec[]; chest?: boolean }): Tag {
  if (o.chest === true && o.cells.length > 1) throw new RangeError(`an ME chest holds one cell, got ${o.cells.length}`);
  const inv = comp(Object.fromEntries(o.cells.map((c, slot) => [`#${slot}`, ae2Cell(c)])));
  return te(o.chest === true ? 'BlockChest' : 'BlockDrive', o.pos, {
    priority: int(0), paintedColor: byte(16), orientation_forward: str('NORTH'), orientation_up: str('UP'), inv, proxy: ae2Proxy(),
  });
}

/**
 * An AE2 cable bus (`BlockCableBus`, world-format §6.11): `def:6` the centre cable and `def:<side>` each side part, as
 * `appliedenergistics2:item.ItemMultiPart` stacks whose damage is the part's (`PartType` base, plus the colour on
 * cables), each with the part's own NBT in `extra:<side>`.
 */
export function ae2CableBus(o: { pos: Vec3; center?: number; parts?: Readonly<Record<number, number>> }): Tag {
  const fields: Record<string, Tag> = { hasRedstone: int(0) };
  const sides: Array<[side: number, damage: number]> = [
    ...(o.center === undefined ? [] : [[6, o.center] as [number, number]]),
    ...Object.entries(o.parts ?? {}).map(([side, damage]): [number, number] => [Number(side), damage]),
  ];
  for (const [side, damage] of sides) {
    fields[`def:${side}`] = stack(AE2_MULTI_PART_ID, 1, damage);
    fields[`extra:${side}`] = comp({});
  }
  return te('BlockCableBus', o.pos, fields);
}

/** An AE2 interface block (`BlockInterface`): `priority`, orientation and its grid node. */
export function ae2Interface(pos: Vec3): Tag {
  return te('BlockInterface', pos, { priority: int(0), orientation_forward: str('NORTH'), orientation_up: str('UP'), proxy: ae2Proxy() });
}

/** A pre-upgrade GT ore TE (world-format §8): the 61-byte `{ m: Short, n: Byte, id, x, y, z }`. */
export function oreTe(pos: Vec3): Tag {
  return comp({ m: short(32), n: byte(1), id: str('GT_TileEntity_Ores'), x: int(pos[0]), y: int(pos[1]), z: int(pos[2]) });
}
