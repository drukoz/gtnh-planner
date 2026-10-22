// GregTech facts that decide how a machine can be fed (research docs/research/machine-feeding.md §1.1, §1.3, §2.3), read
// by the planner and the layout alike (controller ruling 214 (b): one module both read, no planner-to-layout import): a
// basic machine's input slots, what AE2's blocking mode ignores in a machine, and how much an Auto Workbench's input
// slots hold safely. Pure TypeScript shared by server and browser: nothing from node:* may be imported here.

import { isFluidKey, parseItemKey, type StuffKey } from '../keys.ts';
import type { Machine, Pack } from '../types/pack.ts';

// ---- GT basic machines' input slots ----

/**
 * The input slots of a GT basic machine by its kind (`basicmachine.<kind>.tier.<nn>`) and tier, LV first, the last value
 * for every higher tier: read from GT 5.09.54.183's bytecode, `LoaderMetaTileEntities`' `setSlotsCount(in, out)` per
 * machine (the Packager's from the `MTEBoxinator` constructor). The export does not carry them yet (add-on 20).
 */
const INPUT_SLOTS: Readonly<Record<string, number | readonly number[]>> = {
  alloysmelter: 2, amplifab: 1, arcfurnace: 2, assembler: [6, 9], autoclave: 2, bender: 2, boxinator: 2, canner: 2, centrifuge: 2, chemicalbath: 1,
  chemicalreactor: 2, circuitassembler: 6, compressor: 1, cutter: 2, distillery: 1, e_furnace: 1, e_oven: 1, electrolyzer: 2,
  electromagneticseparator: 1, extractor: 1, extruder: 2, fermenter: 1, fluidcanner: 1, fluidextractor: 1, fluidheater: 1, fluidsolidifier: 1,
  hammer: 1, laserengraver: [2, 2, 2, 4], lathe: 1, macerator: 1, microwave: 1, mixer: [6, 6, 6, 9], orewasher: 1, plasmaarcfurnace: 2,
  polarizer: 1, press: [2, 2, 4, 4, 6], printer: 1, recycler: 1, sifter: 1, thermalcentrifuge: 1, unboxinator: 1, wiremill: 2,
};

/** A GT basic machine's input slots (`INPUT_SLOTS`) at its own tier, or null for a machine the table does not know. */
export function basicInputSlots(m: Pick<Machine, 'metaName' | 'tier'>): number | null {
  const kind = /^basicmachine\.([a-z_]+)\.tier\.\d+$/.exec(m.metaName)?.[1];
  const slots = kind === undefined || !Object.hasOwn(INPUT_SLOTS, kind) ? undefined : INPUT_SLOTS[kind];
  if (slots === undefined || m.tier === undefined || m.tier < 1) return null;
  if (typeof slots === 'number') return slots;
  return slots[Math.min(m.tier, slots.length) - 1] ?? null;
}

// ---- What AE2's blocking mode ignores ----

/** GT's programmed circuit: its ghost slot is no input slot, and blocking mode ignores it. */
export const PROGRAMMED_CIRCUIT_ITEM = 'gregtech:gt.integrated_circuit';
const GT_META_ITEM = 'gregtech:gt.metaitem.01';
/** The `gt.metaitem.01` metas GT registers with AE2's blocking-ignore list: its 31 molds, 28 extruder shapes and 2 slicer blades. */
const IGNORED_META_RANGES: ReadonlyArray<readonly [number, number]> = [[32301, 32331], [32350, 32377], [32398, 32399]];

/**
 * Whether AE2's blocking mode ignores `key` in a machine (GT 5.09.54 `AE2Compat.registerBlockingModeIgnoreItems`, read in
 * its bytecode: every programmed circuit, the 61 shape items above, BartWorks' and GT's lenses and a few named lenses):
 * the programmed circuit, those metas, and any item of GT's `lens` prefix. A machine holding anything else (the Packager's
 * schematic, GGFab's single-use tool molds, TGregworks' and TConstruct's casts) is never empty to blocking mode.
 */
export function ignoredByBlocking(pack: Pack, key: StuffKey): boolean {
  if (isFluidKey(key)) return false;
  const { id, meta } = parseItemKey(key);
  if (id === PROGRAMMED_CIRCUIT_ITEM) return true;
  if (id === GT_META_ITEM && IGNORED_META_RANGES.some(([lo, hi]) => meta >= lo && meta <= hi)) return true;
  return pack.items.get(key)?.gt?.prefix === 'lens';
}

// ---- An Auto Workbench's safe stock ----

/** What one stack of an ingredient is taken to hold (the export gives no stack sizes). */
export const BENCH_STACK = 64;
/**
 * The input slots an Auto Workbench's stock may fill (research §1.3.8): inserters fill the lowest empty slot first, so
 * with slot 8 of its nine left empty, a craft that fails for a missing ingredient has nothing to throw out of its back.
 */
export const BENCH_SAFE_SLOTS = 8;
/**
 * The least stock a bench keeps of each ingredient, in crafts (research §3.6): an EnderIO Limited Item Filter keeps two
 * crafts, and a Project Red Item Stock Keeper Chip at least two (more at a rate its 5 s cadence cannot keep up with).
 */
export const BENCH_LEAST_CRAFTS = 2;

/** The input slots a bench's stock of `stock` (count per ingredient) fills, one stack per slot, and whether it fits them safely. */
export function benchSlots(stock: readonly number[]): { slots: number; safe: boolean } {
  let slots = 0;
  for (const count of stock) slots += Math.ceil(count / BENCH_STACK);
  return { slots, safe: slots <= BENCH_SAFE_SLOTS && stock.every((count) => count <= BENCH_STACK) };
}
