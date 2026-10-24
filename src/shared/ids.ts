// Namespaced machine and process ids (architecture §5, §6.1). Pure TypeScript shared by server and browser:
// nothing from node:* may be imported here.

/** A lower case namespace, /^[a-z][a-z0-9_]*$/ — a mod id, or 'mc' for vanilla. */
export type Namespace = string;
/** A namespaced machine id, `${ns}:${local}` — "gt:1001", "mc:furnace", "ic2:macerator". */
export type MachineId = string;
/** A namespaced process id, `${ns}:${local}` — the recipe-map namespace of a later phase. */
export type ProcessId = string;

/** The GregTech machine namespace. */
export const GT_NS = 'gt';
/** The vanilla pseudo-machine namespace. */
export const MC_NS = 'mc';

/** A lower case namespace: /^[a-z][a-z0-9_]*$/. */
const NS_TEXT = /^[a-z][a-z0-9_]*$/;

/** A plain decimal non-negative integer with no leading zeros, so a GT mteId has exactly one spelling. */
const MTE_TEXT = /^(?:0|[1-9]\d*)$/;

/** `${ns}:${local}`. Throws RangeError for a namespace that is not /^[a-z][a-z0-9_]*$/ or an empty local part. */
export function makeId(ns: Namespace, local: string): string {
  if (!NS_TEXT.test(ns)) throw new RangeError(`not a namespace, expected /^[a-z][a-z0-9_]*$/: ${ns}`);
  if (local === '') throw new RangeError(`empty local part in namespace ${ns}`);
  return `${ns}:${local}`;
}

/** The part before the first ':'. Throws Error for a value without one. */
export function nsOf(id: string): Namespace {
  const at = id.indexOf(':');
  if (at < 1) throw new Error(`not a namespaced id, expected ns:local: ${id}`);
  return id.slice(0, at);
}

/** Everything after the first ':' — a local part may itself contain ':' (a registry name). */
export function localOf(id: string): string {
  const at = id.indexOf(':');
  if (at < 1) throw new Error(`not a namespaced id, expected ns:local: ${id}`);
  return id.slice(at + 1);
}

/** A well-formed `${ns}:${local}`. */
export function isId(v: unknown): v is string {
  if (typeof v !== 'string') return false;
  const at = v.indexOf(':');
  if (at < 1) return false;
  if (!NS_TEXT.test(v.slice(0, at))) return false;
  return v.length > at + 1;
}

/** `gt:${mteId}` for a GT MTE id (a non-negative safe integer; RangeError otherwise). */
export function gtMachineId(mteId: number): MachineId {
  if (!Number.isSafeInteger(mteId) || mteId < 0) {
    throw new RangeError(`a GT mteId is a non-negative safe integer, got ${mteId}`);
  }
  return `${GT_NS}:${mteId}`;
}

/** The pseudo machines of recipes no GT machine runs. */
export const MC_MACHINES: { readonly HAND: MachineId; readonly FURNACE: MachineId; readonly CRAFTING_TABLE: MachineId } = {
  HAND: 'mc:hand',
  FURNACE: 'mc:furnace',
  CRAFTING_TABLE: 'mc:crafting_table',
};

/** True for a machine with nothing to build or place: namespace 'mc' (what PSEUDO_IDS.has(mteId) answered). */
export function isPseudoMachineId(id: MachineId): boolean {
  return nsOf(id) === MC_NS;
}

/** The number the old `mteId` held: `gt:<n>` → n, 'mc:hand' → −3, 'mc:furnace' → −2, 'mc:crafting_table' → −1.
 *  Throws Error for any other id — only GT and the three pseudo machines have a legacy number. */
export function legacyMteId(id: MachineId): number {
  const ns = nsOf(id);
  if (ns === GT_NS) {
    const local = localOf(id);
    if (!MTE_TEXT.test(local)) throw new Error(`not a GT machine id, expected gt:<n>: ${id}`);
    const n = Number(local);
    if (!Number.isSafeInteger(n) || n < 0) throw new Error(`not a GT machine id, expected gt:<n>: ${id}`);
    return n;
  }
  if (ns === MC_NS) {
    const local = localOf(id);
    if (local === 'hand') return -3;
    if (local === 'furnace') return -2;
    if (local === 'crafting_table') return -1;
  }
  throw new Error(`no legacy mteId for ${id}, only gt:<n> and the three pseudo machines have one`);
}

/** The inverse, for data saved before Phase 1 and for GT tile ids read from a world. */
export function machineIdOfLegacy(mteId: number): MachineId {
  if (!Number.isSafeInteger(mteId)) throw new RangeError(`a legacy mteId is an integer, got ${mteId}`);
  if (mteId >= 0) return gtMachineId(mteId);
  if (mteId === -3) return MC_MACHINES.HAND;
  if (mteId === -2) return MC_MACHINES.FURNACE;
  if (mteId === -1) return MC_MACHINES.CRAFTING_TABLE;
  throw new RangeError(`no machine for legacy mteId ${mteId}, expected -3, -2, -1 or a non-negative integer`);
}

/** The namespace rank: 'mc' 0, 'gt' 1, anything else 2. */
function nsRank(ns: Namespace): number {
  if (ns === MC_NS) return 0;
  if (ns === GT_NS) return 1;
  return 2;
}

/** The order today's `a.mteId - b.mteId` gave, for any pair of ids:
 *  namespace rank first ('mc' 0, 'gt' 1, anything else 2 then its namespace by `<`), then within
 *  'mc' by `legacyMteId` (hand, furnace, crafting table), within 'gt' by the numeric local part,
 *  and in any other namespace by the local part with `<`. Returns a negative number, 0 or a positive number. */
export function compareMachineId(a: MachineId, b: MachineId): number {
  const nsA = nsOf(a);
  const nsB = nsOf(b);
  const rankA = nsRank(nsA);
  const rankB = nsRank(nsB);
  if (rankA !== rankB) return rankA - rankB;
  if (nsA === MC_NS) return legacyMteId(a) - legacyMteId(b);
  if (nsA === GT_NS) return Number(localOf(a)) - Number(localOf(b));
  if (nsA !== nsB) return nsA < nsB ? -1 : 1;
  const la = localOf(a);
  const lb = localOf(b);
  if (la !== lb) return la < lb ? -1 : 1;
  return 0;
}
