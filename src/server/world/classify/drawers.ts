// Storage Drawers 2.2.31-GTNH (world-format §6.6): drawers with their slot contents and capacity, controllers, which
// blocks a controller's search walks through, and the parts of `config/StorageDrawers.cfg` that change any of that.

import { parseItemKey, type StuffKey } from '../../../shared/keys.ts';
import type { ItemCount, RawTe, StorageRec, Vec3 } from '../model.ts';
import { comp, list, num, type NbtCompound } from '../nbt.ts';
import { readStack } from '../tile-entities.ts';

/** Controller reach, storage-upgrade multipliers by upgrade level (2..8), and whether creative upgrades are unlimited. */
export interface DrawerConfig { range: number; maxDrawers: number; upgradeMult: Record<number, number>; creativeUnlimited: boolean }

/** The mod's defaults, which this pack keeps (`range=4`, `maxDrawers=50`, `enableCreativeUpgrades=true`). */
export const DEFAULT_DRAWER_CONFIG: DrawerConfig = Object.freeze({
  range: 4, maxDrawers: 50, upgradeMult: Object.freeze({ 2: 2, 3: 4, 4: 8, 5: 16, 6: 32, 7: 64, 8: 128 }), creativeUnlimited: true,
});

const UPGRADE = 'StorageDrawers:upgrade';
const DOWNGRADE = 'StorageDrawers:upgradeDowngrade';
const CREATIVE = 'StorageDrawers:upgradeCreative';

const TE_STANDARD = 'StorageDrawers:tileDrawersStandard';
const TE_COMPACTING = 'StorageDrawers:tileDrawersComp';
const TE_CONTROLLER = 'StorageDrawers:tileController';

/** `ConfigManager.getStorageUpgradeMultiplier`: levels 2..8 take `level<N>Mult`, every other level 1. */
function storageMult(level: number, cfg: DrawerConfig): number {
  if (!Number.isInteger(level) || level < 2 || level > 8) return 1;
  return cfg.upgradeMult[level] ?? DEFAULT_DRAWER_CONFIG.upgradeMult[level] ?? 1;
}

/**
 * Stacks one slot holds (world-format §6.6, corrected rule): null (unlimited) with a creative upgrade of either damage
 * while the config enables them; else M × B, where M is the sum of the storage upgrades' multipliers (1 when none) and
 * B is `cap`, or 1 with a downgrade upgrade installed.
 */
export function slotCapacityStacks(cap: number, upgrades: Array<{ name: string; damage: number }>, cfg: DrawerConfig): number | null {
  if (cfg.creativeUnlimited && upgrades.some((u) => u.name === CREATIVE)) return null;
  let mult = 0;
  for (const u of upgrades) if (u.name === UPGRADE) mult += storageMult(u.damage, cfg);
  const base = upgrades.some((u) => u.name === DOWNGRADE) ? 1 : cap;
  return (mult === 0 ? 1 : mult) * base;
}

/** The installed upgrades by registry name and damage; null when one cannot be named (it may change the capacity). */
function upgradesOf(t: NbtCompound, itemNames: Map<number, string>): Array<{ name: string; damage: number }> | null {
  const out: Array<{ name: string; damage: number }> = [];
  for (const entry of list(t.Upgrades)) {
    const c = comp(entry);
    const s = c === null ? null : readStack(c, itemNames);
    if (s === null) return null;
    const { id, meta } = parseItemKey(s.key);
    out.push({ name: id, damage: meta });
  }
  return out;
}

/** `slotCapacityStacks` × the number of slots, empty ones included; null when unlimited or unknown. */
function drawerCapacity(t: NbtCompound, itemNames: Map<number, string>, cfg: DrawerConfig): number | null {
  if (typeof t.Cap !== 'number') return null;
  const upgrades = upgradesOf(t, itemNames);
  const perSlot = upgrades === null ? null : slotCapacityStacks(t.Cap, upgrades, cfg);
  return perSlot === null ? null : perSlot * list(t.Slots).length;
}

/** The item of a stocked slot: `{ItemStack, Count}`, or the legacy `{Item, Meta, Count}`; null when it cannot be keyed. */
function slotKey(slot: NbtCompound, itemNames: Map<number, string>): StuffKey | null {
  const item = comp(slot.ItemStack);
  if (item !== null) return readStack(item, itemNames)?.key ?? null;
  if (slot.Item === undefined) return null;
  const legacy: NbtCompound = { id: slot.Item, ...(slot.Meta === undefined ? {} : { Damage: slot.Meta }) };
  return readStack(legacy, itemNames)?.key ?? null;
}

/**
 * Slot counts summed per item in first-seen order. A slot whose `Count` reads 0 holds nothing (an empty `{}`, or a
 * locked slot keeping its item; `DrawerData` reads a missing `Count` as 0 too); any other slot that cannot be read
 * makes the whole drawer found-but-unknown (null).
 */
function drawerContents(t: NbtCompound, itemNames: Map<number, string>): ItemCount[] | null {
  const counts = new Map<StuffKey, number>();
  for (const entry of list(t.Slots)) {
    const slot = comp(entry);
    if (slot === null) return null;
    const count = num(slot.Count);
    if (count === 0) continue;
    const key = count > 0 ? slotKey(slot, itemNames) : null;
    if (key === null) return null;
    counts.set(key, (counts.get(key) ?? 0) + count);
  }
  return [...counts].map(([key, count]) => ({ key, count }));
}

/**
 * A standard drawer with its contents and capacity; a compacting drawer as found-but-unknown (its pooled count is in
 * the smallest unit); a controller with no contents of its own. Null for every other tile entity (slaves, trim,
 * framing tables, other mods).
 */
export function classifyDrawer(te: RawTe, itemNames: Map<number, string>, cfg: DrawerConfig): StorageRec | null {
  const pos: Vec3 = [te.x, te.y, te.z];
  switch (te.id) {
    case TE_STANDARD:
      return { dim: te.dim, pos, kind: 'drawer', capacityStacks: drawerCapacity(te.nbt, itemNames, cfg), contents: drawerContents(te.nbt, itemNames) };
    case TE_COMPACTING:
      return { dim: te.dim, pos, kind: 'drawer', contents: null };
    case TE_CONTROLLER:
      return { dim: te.dim, pos, kind: 'drawer_controller', contents: [] };
    default:
      return null;
  }
}

/** The mod and its pack variants register the same block names under these domains. */
const DRAWER_DOMAINS: ReadonlySet<string> = new Set([
  'StorageDrawers', 'StorageDrawersBop', 'StorageDrawersForestry', 'StorageDrawersMisc', 'StorageDrawersNatura',
]);
/** Blocks implementing `INetworked`: drawers (standard, custom, compacting), controller, controller slave and trim. */
const NETWORKED_PATH = /^(full|half)(Drawers|Custom)\d|^compDrawers|^controller(Slave)?$|^trim(Custom)?$/;
/** The `BlockDrawers` subclasses, the ones that count toward `maxDrawers`. */
const DRAWER_PATH = /^(full|half)(Drawers|Custom)\d|^compDrawers/;

function drawerBlockPath(name: string): string | null {
  const colon = name.indexOf(':');
  return colon > 0 && DRAWER_DOMAINS.has(name.slice(0, colon)) ? name.slice(colon + 1) : null;
}

/** True when a controller's search may pass through this block (world-format §6.6 rule 3). */
export function isNetworkedDrawerBlock(name: string): boolean {
  const path = drawerBlockPath(name);
  return path !== null && NETWORKED_PATH.test(path);
}

/** True for drawers blocks, which count toward `maxDrawers`; controllers, slaves and trim do not. */
export function countsAsDrawer(name: string): boolean {
  const path = drawerBlockPath(name);
  return path !== null && DRAWER_PATH.test(path);
}

const INT_MIN = -(2 ** 31);
const INT_MAX = 2 ** 31 - 1;

/** `Integer.parseInt`, or null where it would throw (and Forge would keep the default). */
function forgeInt(value: string): number | null {
  if (!/^[+-]?\d+$/.test(value)) return null;
  const n = Number(value);
  return n >= INT_MIN && n <= INT_MAX ? n : null;
}

/** Forge accepts `true`/`false` in any case and keeps the default for anything else. */
function forgeBool(value: string): boolean | null {
  const v = value.toLowerCase();
  return v === 'true' ? true : v === 'false' ? false : null;
}

/** `name {` or `"quoted name" {` opens a category. */
const CATEGORY_OPEN = /^(?:"([^"]*)"|([^\s"{}]+))\s*\{$/;
/** `T:name=value`, `T:"quoted name"=value`, or `T:name <` opening a list that runs to a line `>`. */
const PROPERTY = /^([A-Za-z]):(?:"([^"]*)"|([^"=<]+?))\s*(?:=(.*)|<\s*(>?))$/;
const LEVEL_MULT = /^level([2-8])Mult$/;

/**
 * The parts of a Forge `config/StorageDrawers.cfg` the scan uses: `I:range` and `I:maxDrawers` in a `controller`
 * category, `I:level<N>Mult` (N 2..8) in `upgrades`, and `B:enableCreativeUpgrades` in any category. Category names
 * compare case-insensitively (Forge lower-cases them); a missing key or a value Forge could not parse keeps the
 * default. Null (no file) gives the defaults. Always a fresh object.
 */
export function readDrawerConfig(text: string | null): DrawerConfig {
  const cfg: DrawerConfig = { ...DEFAULT_DRAWER_CONFIG, upgradeMult: { ...DEFAULT_DRAWER_CONFIG.upgradeMult } };
  if (text === null) return cfg;
  const categories: string[] = [];
  let inList = false;
  for (const rawLine of text.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (inList) {
      if (line === '>') inList = false;
      continue;
    }
    if (line === '' || line.startsWith('#')) continue;
    if (line === '}') {
      categories.pop();
      continue;
    }
    const open = CATEGORY_OPEN.exec(line);
    if (open !== null) {
      categories.push((open[1] ?? open[2] ?? '').toLowerCase());
      continue;
    }
    const prop = PROPERTY.exec(line);
    if (prop === null) continue;
    const [, type, quoted, bare, value, listEnd] = prop;
    if (value === undefined) {
      inList = listEnd !== '>';
      continue;
    }
    const name = (quoted ?? bare ?? '').trim();
    const category = categories.at(-1);
    if (type === 'I' && category === 'controller' && (name === 'range' || name === 'maxDrawers')) {
      const n = forgeInt(value.trim());
      if (n !== null) cfg[name] = n;
    } else if (type === 'I' && category === 'upgrades') {
      const level = LEVEL_MULT.exec(name)?.[1];
      const n = level === undefined ? null : forgeInt(value.trim());
      if (level !== undefined && n !== null) cfg.upgradeMult[Number(level)] = n;
    } else if (type === 'B' && name === 'enableCreativeUpgrades') {
      const b = forgeBool(value.trim());
      if (b !== null) cfg.creativeUnlimited = b;
    }
  }
  return cfg;
}
