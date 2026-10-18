// Item and fluid search over a loaded pack (architecture §6.2), NEI-style: English names first, then ore names and
// registry keys. `@mod` keeps items whose registry namespace starts with "mod"; `$ore` keeps items with an ore name
// that contains "ore".

import type { ItemKey, StuffKey } from '../../shared/keys.ts';
import type { Pack, SearchHit } from '../../shared/types/pack.ts';

/** The searchable fields of one item or fluid, lower-cased once per pack. */
interface Entry {
  readonly key: StuffKey;
  readonly name: string;
  readonly kind: SearchHit['kind'];
  readonly produced: boolean;
  /** The name, lower-cased with whitespace collapsed. */
  readonly lowerName: string;
  /** Where the words of `lowerName` start: 0 and every position after ' ', '(', '-' or '/'. */
  readonly wordStarts: readonly number[];
  readonly lowerKey: string;
  readonly lowerOres: readonly string[];
  /** The lower-cased registry namespace (`minecraft` of `minecraft:stick`); null for fluids. */
  readonly namespace: string | null;
}

interface Match { readonly entry: Entry; readonly tier: number }

const WORD_SEPARATORS = new Set([' ', '(', '-', '/']);
const entriesByPack = new WeakMap<Pack, readonly Entry[]>();

function normalize(text: string): string {
  return text.toLowerCase().replace(/\s+/g, ' ').trim();
}

function wordStartsOf(name: string): number[] {
  const starts: number[] = [];
  for (let i = 0; i < name.length; i++) if (i === 0 || WORD_SEPARATORS.has(name[i - 1]!)) starts.push(i);
  return starts;
}

function entry(pack: Pack, key: StuffKey, name: string, kind: SearchHit['kind'], ores: Iterable<string>, namespace: string | null): Entry {
  const lowerName = normalize(name);
  return {
    key, name, kind, produced: pack.producers.has(key), lowerName, wordStarts: wordStartsOf(lowerName),
    lowerKey: key.toLowerCase(), lowerOres: [...new Set([...ores].map((ore) => ore.toLowerCase()))], namespace,
  };
}

/** An item's ore names are those on its own line plus every ore-dictionary entry that lists it. */
function entriesOf(pack: Pack): readonly Entry[] {
  const cached = entriesByPack.get(pack);
  if (cached !== undefined) return cached;
  const oresByItem = new Map<ItemKey, string[]>();
  for (const [ore, keys] of pack.oreDict) {
    for (const key of keys) {
      const ores = oresByItem.get(key);
      if (ores === undefined) oresByItem.set(key, [ore]);
      else ores.push(ore);
    }
  }
  const entries: Entry[] = [];
  for (const item of pack.items.values()) {
    const colon = item.id.indexOf(':');
    const namespace = (colon === -1 ? item.id : item.id.slice(0, colon)).toLowerCase();
    entries.push(entry(pack, item.key, item.name, 'item', [...item.oreDict, ...(oresByItem.get(item.key) ?? [])], namespace));
  }
  for (const fluid of pack.fluids.values()) entries.push(entry(pack, fluid.key, fluid.name, 'fluid', [], null));
  entriesByPack.set(pack, entries);
  return entries;
}

function wordStartsWith(e: Entry, text: string): boolean {
  return e.wordStarts.some((at) => e.lowerName.startsWith(text, at));
}

/** One query word on its own: word start 2, contains 3, an ore name equal 4, an ore name contains 5, the key contains 6. */
function tokenTier(e: Entry, token: string): number | null {
  if (wordStartsWith(e, token)) return 2;
  if (e.lowerName.includes(token)) return 3;
  if (e.lowerOres.includes(token)) return 4;
  if (e.lowerOres.some((ore) => ore.includes(token))) return 5;
  if (e.lowerKey.includes(token)) return 6;
  return null;
}

/** The whole text against the name (0–3), else the worst tier of its words, each matched its own way; null = no match. */
function textTier(e: Entry, text: string, tokens: readonly string[]): number | null {
  if (e.lowerName === text) return 0;
  if (e.lowerName.startsWith(text)) return 1;
  if (wordStartsWith(e, text)) return 2;
  if (e.lowerName.includes(text)) return 3;
  let worst = 0;
  for (const token of tokens) {
    const tier = tokenTier(e, token);
    if (tier === null) return null;
    worst = Math.max(worst, tier);
  }
  return worst;
}

/** `@` filters keep only items (fluids have no namespace); `$` filters only entries with ore names, i.e. items. */
function passesFilters(e: Entry, namespaces: readonly string[], oreParts: readonly string[]): boolean {
  const ns = e.namespace;
  if (namespaces.length > 0 && (ns === null || !namespaces.every((prefix) => ns.startsWith(prefix)))) return false;
  return oreParts.every((part) => e.lowerOres.some((ore) => ore.includes(part)));
}

/** Tier, then produced first, then the shorter name, then `localeCompare` of the names, then the key. */
function compareMatches(a: Match, b: Match): number {
  return a.tier - b.tier
    || Number(b.entry.produced) - Number(a.entry.produced)
    || a.entry.name.length - b.entry.name.length
    || a.entry.name.localeCompare(b.entry.name)
    || (a.entry.key < b.entry.key ? -1 : a.entry.key > b.entry.key ? 1 : 0);
}

/** The first `limit` matches in `compareMatches` order, without sorting every match of a short query. */
function best(matches: Match[], limit: number): Match[] {
  if (matches.length <= limit) return matches.sort(compareMatches);
  const top: Match[] = [];
  for (const m of matches) {
    if (top.length === limit && compareMatches(m, top[limit - 1]!) >= 0) continue;
    let lo = 0;
    let hi = top.length;
    while (lo < hi) {
      const mid = (lo + hi) >>> 1;
      if (compareMatches(top[mid]!, m) <= 0) lo = mid + 1;
      else hi = mid;
    }
    top.splice(lo, 0, m);
    if (top.length > limit) top.pop();
  }
  return top;
}

/**
 * Items and fluids matching `query`, best first (architecture §6.2). Whitespace separates words; a word starting with
 * `@` keeps the items whose registry namespace starts with the rest, one starting with `$` the items with an ore name
 * containing the rest (a lone `@` or `$` is ignored). Without other words every item the filters keep matches; with
 * none at all, nothing does.
 */
export function searchPack(pack: Pack, query: string, limit = 50): SearchHit[] {
  const max = Math.floor(limit);
  if (!(max >= 1)) return [];
  const namespaces: string[] = [];
  const oreParts: string[] = [];
  const tokens: string[] = [];
  for (const token of normalize(query).split(' ')) {
    if (token.startsWith('@')) {
      if (token.length > 1) namespaces.push(token.slice(1));
    } else if (token.startsWith('$')) {
      if (token.length > 1) oreParts.push(token.slice(1));
    } else if (token !== '') {
      tokens.push(token);
    }
  }
  if (tokens.length === 0 && namespaces.length === 0 && oreParts.length === 0) return [];
  const text = tokens.join(' ');
  const matches: Match[] = [];
  for (const e of entriesOf(pack)) {
    if (!passesFilters(e, namespaces, oreParts)) continue;
    const tier = tokens.length === 0 ? 0 : textTier(e, text, tokens);
    if (tier !== null) matches.push({ entry: e, tier });
  }
  return best(matches, max).map(({ entry: e }) => ({ key: e.key, name: e.name, kind: e.kind, produced: e.produced }));
}
