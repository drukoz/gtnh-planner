// GregTech digital storage (world-format §6.5): super and quantum chests (`MTEDigitalChestBase`) and tanks
// (`MTEDigitalTankBase`). They are GT machines as well (classify/gt.ts); this reads only what they hold.

import { fluidKey, type StuffKey } from '../../../shared/keys.ts';
import { simpleClassName, type ScanPackFacts } from '../facts.ts';
import type { ItemCount, RawTe, StorageRec } from '../model.ts';
import { comp, list, num, str, type NbtCompound } from '../nbt.ts';
import { readStack } from '../tile-entities.ts';

function ids(from: number, to: number): number[] {
  return Array.from({ length: to - from + 1 }, (_, i) => from + i);
}

/** `QUANTUM_CHEST_LV…IV` and `SUPER_CHEST_LV…IV` in GT's `MetaTileEntityIDs`. */
export const GT_CHEST_IDS: ReadonlySet<number> = new Set([...ids(125, 129), ...ids(135, 139)]);
/** `QUANTUM_TANK_LV…IV` and `SUPER_TANK_LV…IV`. */
export const GT_TANK_IDS: ReadonlySet<number> = new Set([...ids(120, 124), ...ids(130, 134)]);

const CHEST_CLASSES: ReadonlySet<string> = new Set(['MTEQuantumChest', 'MTESuperChest']);
const TANK_CLASSES: ReadonlySet<string> = new Set(['MTEQuantumTank', 'MTESuperTank']);

/** The export's class decides when it names a digital chest or tank; else the id ranges, else `mItemCount`. */
function storageKind(mteId: number, cls: string | null, t: NbtCompound): 'gt_chest' | 'gt_tank' | null {
  if (cls !== null && CHEST_CLASSES.has(cls)) return 'gt_chest';
  if (cls !== null && TANK_CLASSES.has(cls)) return 'gt_tank';
  if (GT_CHEST_IDS.has(mteId)) return 'gt_chest';
  if (GT_TANK_IDS.has(mteId)) return 'gt_tank';
  return Object.hasOwn(t, 'mItemCount') ? 'gt_chest' : null;
}

/**
 * Stored = `mItemCount` of `mItemStack`'s item + the stacks in `Inventory` slots 0 and 1 (`MTEDigitalChestBase.
 * getProgresstime`), per item key. Null when a stored stack cannot be keyed, since a chest holds one item and a partial
 * count would be a guess.
 */
function chestContents(t: NbtCompound, itemNames: Map<number, string>): ItemCount[] | null {
  const counts = new Map<StuffKey, number>();
  const add = (key: StuffKey, n: number): void => {
    counts.set(key, (counts.get(key) ?? 0) + n);
  };
  const stored = num(t.mItemCount);
  if (stored < 0) return null;
  if (stored > 0) {
    const template = comp(t.mItemStack);
    const s = template === null ? null : readStack(template, itemNames);
    if (s === null) return null;
    add(s.key, stored);
  }
  for (const entry of list(t.Inventory)) {
    const c = comp(entry);
    if (c === null || (c.IntSlot !== 0 && c.IntSlot !== 1)) continue;
    const s = readStack(c, itemNames);
    if (s === null) return null;
    add(s.key, s.count);
  }
  return [...counts].filter(([, count]) => count > 0).map(([key, count]) => ({ key, count }));
}

/** `mFluid` `{FluidName, Amount}` (`MTEBasicTank`); GT leaves the key out when the tank is empty. */
function tankContents(t: NbtCompound): ItemCount[] | null {
  if (!Object.hasOwn(t, 'mFluid')) return [];
  const fluid = comp(t.mFluid);
  const name = str(fluid?.FluidName), amount = num(fluid?.Amount, -1);
  if (name === null || name === '' || amount < 0) return null;
  return amount === 0 ? [] : [{ key: fluidKey(name), count: amount }];
}

/** A GT super or quantum chest or tank with what it holds; null for every other GT machine. */
export function classifyGtStorage(te: RawTe, facts: ScanPackFacts, itemNames: Map<number, string>): StorageRec | null {
  const t = te.nbt;
  const mteId = num(t.mID);
  const kind = storageKind(mteId, simpleClassName(facts.machines.get(mteId)?.cls), t);
  if (kind === null) return null;
  return { dim: te.dim, pos: [te.x, te.y, te.z], kind, contents: kind === 'gt_tank' ? tankContents(t) : chestContents(t, itemNames) };
}
