// Conduit sizing for the EnderIO mode (spec §3.6 mode 4, architecture "EnderIO conduits, granted change requests
// (add-on 11)"): the speed upgrades an item face needs, the filter that holds what a side passes, the ender fluid conduit
// that carries the busiest face, and the channel colours that keep each item's route apart from the others. Pure
// functions of the numbers they are given and the resolved parts, with every order and tie-break fixed, so the same plan
// gives the same sizes and colours. The facts (rates, slots, palette) are `shared/layout/enderio.ts`'s.

import type { StuffKey } from '../../shared/keys.ts';
import { CHANNEL_PALETTE, FLUID_CONDUITS, FLUID_FILTER_SLOTS, ITEM_CONDUIT, ITEM_FILTER_SLOTS, itemFaceRate } from '../../shared/layout/enderio.ts';
import type { ConduitFilter, ConduitKind, DyeColor } from '../../shared/types/layout.ts';
import type { Part, PartId, Parts } from './parts.ts';

const TICKS_PER_SECOND = 20;

function compareText(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0;
}

/** The keys sorted, each once. */
function sortedKeys(keys: readonly StuffKey[]): StuffKey[] {
  return [...new Set(keys)].sort(compareText);
}

// ---- Speed upgrades, filters, fluid conduits ----

/** The fewest Item Conduit Speed Upgrades (0..15) whose `itemFaceRate` covers the rate; `short` when even 15 do not. */
export function speedUpgradesFor(itemsPerSecond: number): { count: number; short: boolean } {
  for (let count = 0; count <= ITEM_CONDUIT.maxUpgrades; count++) {
    if (itemFaceRate(count) >= itemsPerSecond) return { count, short: false };
  }
  return { count: ITEM_CONDUIT.maxUpgrades, short: true };
}

/**
 * Exact keys (sorted, each once) as a whitelist in the smallest filter that holds them: Basic ≤ 5, Advanced ≤ 10, Big ≤ 24;
 * past 24 the first 24 and the rest `dropped`. Items match meta, and NBT only when a kept key carries an NBT suffix (`#…`).
 */
export function itemFilterFor(parts: Parts, keys: readonly StuffKey[]): { filter: ConduitFilter; dropped: StuffKey[] } {
  const sorted = sortedKeys(keys);
  const kept = sorted.slice(0, ITEM_FILTER_SLOTS.big);
  const part = kept.length <= ITEM_FILTER_SLOTS.basic ? parts.eio_basic_filter
    : kept.length <= ITEM_FILTER_SLOTS.advanced ? parts.eio_advanced_filter : parts.eio_big_filter;
  return {
    filter: { item: part.key, whitelist: true, keys: kept, matchMeta: true, matchNbt: kept.some((k) => k.includes('#')), oreDict: false, sticky: false },
    dropped: sorted.slice(ITEM_FILTER_SLOTS.big),
  };
}

/** An ender fluid conduit's own filter (no item): whitelist of at most 5 fluids (sorted, each once), the rest `dropped`. */
export function fluidFilterFor(keys: readonly StuffKey[]): { filter: ConduitFilter; dropped: StuffKey[] } {
  const sorted = sortedKeys(keys);
  return { filter: { whitelist: true, keys: sorted.slice(0, FLUID_FILTER_SLOTS) }, dropped: sorted.slice(FLUID_FILTER_SLOTS) };
}

/** The part each conduit kind is laid with. */
const CONDUIT_PARTS: Readonly<Record<ConduitKind, PartId>> = Object.freeze({
  item: 'eio_item_conduit', liquid_ender: 'eio_fluid_ender', liquid_crystalline: 'eio_fluid_crystalline',
  liquid_pink_slime: 'eio_fluid_pink_slime', liquid_melodic: 'eio_fluid_melodic', liquid_stellar: 'eio_fluid_stellar',
});

/**
 * The first row of `FLUID_CONDUITS` with extract × 20 ≥ `need.extract` and maxIo × 20 ≥ `need.insert` (L/s per face), else
 * the last one (Stellar) with `short`.
 */
export function pickFluidConduit(parts: Parts, need: { extract: number; insert: number }): { part: Part; kind: ConduitKind; short: boolean } {
  const enough = FLUID_CONDUITS.find((row) => row.extractPerTick * TICKS_PER_SECOND >= need.extract && row.maxIoPerTick * TICKS_PER_SECOND >= need.insert);
  const row = enough ?? FLUID_CONDUITS.at(-1)!;
  return { part: parts[CONDUIT_PARTS[row.kind]], kind: row.kind, short: enough === undefined };
}

// ---- Channel colours ----

/** An extract side or an insert side of a conduit face, with the items or fluids it passes. `id` is unique among the ends. */
export interface ChannelEnd { id: string; keys: readonly StuffKey[] }
/** The two ends must trade, so they share a channel. */
export interface ChannelLink { from: string; to: string }
/** `colors` by end id; `shared` lists each channel that had to take a colour already carrying some of its keys. */
export interface ChannelPlan { colors: Map<string, DyeColor>; shared: Array<{ color: DyeColor; keys: StuffKey[] }> }

/**
 * The palette colour for a channel once the palette is used up: the first colour whose channels share no key with `keys`;
 * else the colour whose channels share the fewest (ties: palette order), with the keys it shares, sorted.
 */
function reusedColor(keys: ReadonlySet<StuffKey>, carried: ReadonlyMap<DyeColor, ReadonlySet<StuffKey>>): { color: DyeColor; common: StuffKey[] } {
  const options = CHANNEL_PALETTE.map((color) => ({ color, common: [...keys].filter((k) => carried.get(color)!.has(k)) }));
  const pick = options.find((o) => o.common.length === 0) ?? options.reduce((best, o) => (o.common.length < best.common.length ? o : best));
  return { color: pick.color, common: pick.common.sort(compareText) };
}

/**
 * Linked ends share a channel; channels are coloured in order of their first end: the first 15 take `CHANNEL_PALETTE` in
 * order, a later one the colour of `reusedColor` (and a `shared` entry when that colour already carries one of its keys).
 * The keys of a channel are the union of its ends' keys. Throws `RangeError` for a link to an end that is not listed, and
 * for two ends with one id.
 */
export function assignChannels(ends: readonly ChannelEnd[], links: readonly ChannelLink[]): ChannelPlan {
  const indexOf = new Map<string, number>();
  for (const [i, end] of ends.entries()) {
    if (indexOf.has(end.id)) throw new RangeError(`two channel ends have the id ${JSON.stringify(end.id)}`);
    indexOf.set(end.id, i);
  }
  const endNamed = (id: string): number => {
    const i = indexOf.get(id);
    if (i === undefined) throw new RangeError(`unknown channel end ${JSON.stringify(id)}`);
    return i;
  };

  // union-find over the ends (path halving): a link joins its two ends into one channel
  const parent = ends.map((_, i) => i);
  const find = (end: number): number => {
    let at = end;
    while (parent[at] !== at) {
      parent[at] = parent[parent[at]!]!;
      at = parent[at]!;
    }
    return at;
  };
  for (const { from, to } of links) {
    const a = find(endNamed(from));
    const b = find(endNamed(to));
    if (a !== b) parent[b] = a;
  }

  // channels in order of their first end (a Map keeps the order its roots were first met in), each with its keys
  const channels = new Map<number, Set<StuffKey>>();
  for (const [i, end] of ends.entries()) {
    const root = find(i);
    const keys = channels.get(root) ?? new Set<StuffKey>();
    channels.set(root, keys);
    for (const key of end.keys) keys.add(key);
  }

  const carried = new Map<DyeColor, Set<StuffKey>>(CHANNEL_PALETTE.map((color) => [color, new Set<StuffKey>()]));   // keys on each colour so far
  const colorOfRoot = new Map<number, DyeColor>();
  const shared: ChannelPlan['shared'] = [];
  for (const [root, keys] of channels) {
    let color = CHANNEL_PALETTE[colorOfRoot.size];                                  // channel number n takes palette colour n
    if (color === undefined) {
      const reuse = reusedColor(keys, carried);
      color = reuse.color;
      if (reuse.common.length > 0) shared.push({ color, keys: reuse.common });
    }
    for (const key of keys) carried.get(color)!.add(key);
    colorOfRoot.set(root, color);
  }

  const colors = new Map<string, DyeColor>();
  for (const [i, end] of ends.entries()) colors.set(end.id, colorOfRoot.get(find(i))!);
  return { colors, shared };
}
