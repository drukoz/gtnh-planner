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
 * Exact keys (sorted, each once) as a whitelist in the smallest filter that holds them: Basic ≤ 5, Advanced ≤ 10, Big ≤ 24
 * (its `slots`); past 24 the first 24 and the rest `dropped`. Items match meta, and NBT only when a kept key carries an
 * NBT suffix (`#…`).
 */
export function itemFilterFor(parts: Parts, keys: readonly StuffKey[]): { filter: ConduitFilter; dropped: StuffKey[] } {
  const sorted = sortedKeys(keys);
  const kept = sorted.slice(0, ITEM_FILTER_SLOTS.big);
  const slots = kept.length <= ITEM_FILTER_SLOTS.basic ? ITEM_FILTER_SLOTS.basic
    : kept.length <= ITEM_FILTER_SLOTS.advanced ? ITEM_FILTER_SLOTS.advanced : ITEM_FILTER_SLOTS.big;
  const part = slots === ITEM_FILTER_SLOTS.basic ? parts.eio_basic_filter : slots === ITEM_FILTER_SLOTS.advanced ? parts.eio_advanced_filter : parts.eio_big_filter;
  return {
    filter: { item: part.key, whitelist: true, keys: kept, matchMeta: true, matchNbt: kept.some((k) => k.includes('#')), oreDict: false, sticky: false, slots },
    dropped: sorted.slice(ITEM_FILTER_SLOTS.big),
  };
}

/** Slots of EnderIO's Limited Item Filter (`ItemFilterLimited`, research machine-feeding §2.1). */
export const LIMITED_FILTER_SLOTS = 10;

/**
 * A Limited Item Filter (plan 12 Task 6: an Auto Workbench's insert side): a whitelist of the keys of `limits` (sorted,
 * at most `LIMITED_FILTER_SLOTS`; a bench takes at most nine), each let in up to its count, matching meta.
 */
export function limitedFilterFor(parts: Parts, limits: ReadonlyMap<StuffKey, number>): ConduitFilter {
  const keys = sortedKeys([...limits.keys()]).slice(0, LIMITED_FILTER_SLOTS);
  return {
    item: parts.eio_limited_filter.key, whitelist: true, keys, limits: keys.map((k) => limits.get(k)!), matchMeta: true,
    matchNbt: keys.some((k) => k.includes('#')), oreDict: false, sticky: false, slots: LIMITED_FILTER_SLOTS,
  };
}

/** An ender fluid conduit's own filter (no item): whitelist of at most 5 fluids (sorted, each once), the rest `dropped`. */
export function fluidFilterFor(keys: readonly StuffKey[]): { filter: ConduitFilter; dropped: StuffKey[] } {
  const sorted = sortedKeys(keys);
  return { filter: { whitelist: true, keys: sorted.slice(0, FLUID_FILTER_SLOTS), slots: FLUID_FILTER_SLOTS }, dropped: sorted.slice(FLUID_FILTER_SLOTS) };
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

/**
 * An extract side or an insert side of a conduit face, with the items or fluids it passes. `id` is unique among the
 * ends; the two sides of one `face` never trade with each other (self feed is off, and an ender fluid conduit never
 * fills the tank it drains).
 */
export interface ChannelEnd { id: string; keys: readonly StuffKey[]; side: 'extract' | 'insert'; face?: string }
/** The two ends must trade, so they share a channel. */
export interface ChannelLink { from: string; to: string }
/**
 * `colors` by end id; `shared` lists each colour a channel had to share once the palette was used up, with the keys that
 * can then reach an end its flows do not link them to.
 */
export interface ChannelPlan { colors: Map<string, DyeColor>; shared: Array<{ color: DyeColor; keys: StuffKey[] }> }

/**
 * The keys that would pass between the ends of `a` and those of `b` on one colour: an extract side and an insert side,
 * of different faces, with a key in common. Called for two different channels, so no flow links such a pair (it would
 * have joined them): every one is a route the plan does not have (the review of the EnderIO single pipe). Sorted, each
 * once.
 */
function leaks(a: readonly ChannelEnd[], b: readonly ChannelEnd[]): StuffKey[] {
  const keys = new Set<StuffKey>();
  const pass = (from: ChannelEnd, to: ChannelEnd): void => {
    if (from.side !== 'extract' || to.side !== 'insert') return;
    if (from.face !== undefined && from.face === to.face) return;
    for (const k of from.keys) if (to.keys.includes(k)) keys.add(k);
  };
  for (const x of a) {
    for (const y of b) {
      pass(x, y);
      pass(y, x);
    }
  }
  return [...keys].sort(compareText);
}

/**
 * Linked ends share a channel (an extract side and an insert side each have one colour, so the ends a face trades with
 * are on its colour). Channels are coloured in order of their first end, each with the first `CHANNEL_PALETTE` colour
 * that none of the channels on it `leaks` a key with: so a line is on one colour, Red, and a channel takes another only
 * where, on a shared colour, an extract side would hand a key to an insert side its flows do not link it to. No filter
 * stops that, as the insert side takes the key (the plan brings it from elsewhere), and whatever hands it out, the input
 * chest, an open fluid end or a machine, the insert side takes more than its flows while it has room (machine counts
 * round up), so the face the key is planned for runs short, its maker backs up or a chest fills with it.
 * Once every colour leaks, the one that leaks the fewest keys (ties: palette order), with a `shared` entry naming them.
 * Throws `RangeError` for a link to an end that is not listed, and for two ends with one id.
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

  // channels in order of their first end (a Map keeps the order its roots were first met in), each with its ends
  const channels = new Map<number, ChannelEnd[]>();
  for (const [i, end] of ends.entries()) {
    const root = find(i);
    const own = channels.get(root) ?? [];
    channels.set(root, own);
    own.push(end);
  }

  const onColor = new Map<DyeColor, ChannelEnd[]>(CHANNEL_PALETTE.map((color) => [color, []]));   // the ends on each colour so far
  const colorOfRoot = new Map<number, DyeColor>();
  const shared: ChannelPlan['shared'] = [];
  for (const [root, own] of channels) {
    const options = CHANNEL_PALETTE.map((color) => ({ color, keys: leaks(own, onColor.get(color)!) }));
    const pick = options.find((o) => o.keys.length === 0) ?? options.reduce((best, o) => (o.keys.length < best.keys.length ? o : best));
    if (pick.keys.length > 0) shared.push({ color: pick.color, keys: pick.keys });
    onColor.get(pick.color)!.push(...own);
    colorOfRoot.set(root, pick.color);
  }

  const colors = new Map<string, DyeColor>();
  for (const [i, end] of ends.entries()) colors.set(end.id, colorOfRoot.get(find(i))!);
  return { colors, shared };
}
