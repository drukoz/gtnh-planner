// Item and fluid keys (architecture §5, §6.1). Pure TypeScript shared by server and browser:
// nothing from node:* may be imported here.

export type ItemKey = string;
export type FluidKey = string;
/** Every planner node is either an item or a fluid. */
export type StuffKey = string;

const FLUID_PREFIX = 'fluid:';

/** Minecraft's OreDictionary.WILDCARD_VALUE ("any meta"). It is expanded when a pack is loaded and never appears in a key. */
const WILDCARD_META = 32767;

/** Plain decimal digits without leading zeros, so a meta has exactly one spelling. */
const META_TEXT = /^(?:0|[1-9]\d*)$/;

function isConcreteMeta(meta: number): boolean {
  return Number.isSafeInteger(meta) && meta >= 0 && meta !== WILDCARD_META;
}

/** `${id}@${meta}`, plus `#${nbtHash}` for an NBT-sensitive variant. */
export function itemKey(id: string, meta: number, nbtHash?: string): ItemKey {
  if (!isConcreteMeta(meta)) {
    throw new RangeError(`item meta must be a non-negative integer other than ${WILDCARD_META}, got ${meta} (${id})`);
  }
  return nbtHash === undefined ? `${id}@${meta}` : `${id}@${meta}#${nbtHash}`;
}

/** `fluid:${name}` */
export function fluidKey(name: string): FluidKey {
  return FLUID_PREFIX + name;
}

export function isFluidKey(k: StuffKey): boolean {
  return k.startsWith(FLUID_PREFIX);
}

/** Splits `id@meta` or `id@meta#hash` on the last `@`, then on `#`. Throws `Error` for fluid keys and malformed keys. */
export function parseItemKey(k: ItemKey): { id: string; meta: number; nbtHash?: string } {
  if (isFluidKey(k)) throw new Error(`not an item key, it is a fluid key: ${k}`);
  const at = k.lastIndexOf('@');
  if (at < 1) throw new Error(`malformed item key, expected id@meta[#hash]: ${k}`);
  const id = k.slice(0, at);
  const tail = k.slice(at + 1);
  const hashAt = tail.indexOf('#');
  const metaText = hashAt === -1 ? tail : tail.slice(0, hashAt);
  if (!META_TEXT.test(metaText)) throw new Error(`malformed item key, meta is not a plain number: ${k}`);
  const meta = Number(metaText);
  if (!isConcreteMeta(meta)) throw new Error(`malformed item key, meta is out of range or the ${WILDCARD_META} wildcard: ${k}`);
  if (hashAt === -1) return { id, meta };
  const nbtHash = tail.slice(hashAt + 1);
  if (nbtHash === '' || nbtHash.includes('#')) throw new Error(`malformed item key, bad NBT hash: ${k}`);
  return { id, meta, nbtHash };
}
