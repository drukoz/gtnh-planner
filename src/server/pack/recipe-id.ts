// Content-hash recipe ids and NBT hashes (architecture §5, §11.4). Server side: this file uses node:crypto.
//
// Plan 2 stores recipe ids inside projects, so the canonical form below is fixed. Change it only on purpose and
// bump CANONICAL_VERSION when you do. v2 replaced v1 before any project stored an id: v1 kept the order of inputs and
// outputs (and the input slots), which GT fills from hash-ordered collections for some recipes, so two exports of one
// pack gave those recipes different ids.

import { createHash } from 'node:crypto';
import type { Ingredient, Product, RecipeSource } from '../../shared/types/pack.ts';

/**
 * What identifies a recipe. Recipe maps, amps, the hidden/recycling/dynamicMap flags, input slots and the order of
 * inputs and outputs are not part of it, so the same recipe in two maps (prior-art T10) and the same recipe in a
 * re-export (T5) get one id.
 */
export type RecipeContent = {
  source: RecipeSource;
  inputs: Ingredient[];
  outputs: Product[];
  euPerTick: number;
  durationTicks: number;
  specialValue: number;
  meta: Record<string, unknown>;
  category?: string;
  fake?: boolean;
};

const CANONICAL_VERSION = 'v2';

export function sha1Hex(text: string): string {
  return createHash('sha1').update(text, 'utf8').digest('hex');
}

/** First 12 hex digits of sha1 over an item's SNBT text: the `#…` part of an NBT-sensitive item key. */
export function nbtHash(snbt: string): string {
  return sha1Hex(snbt).slice(0, 12);
}

type Option = Ingredient['options'][number];

/** Key first (by UTF-16 code units, never by the locale), then amount. */
function byKeyThenAmount(a: Option, b: Option): number {
  if (a.key !== b.key) return a.key < b.key ? -1 : 1;
  return a.amount - b.amount;
}

/**
 * The same value with the keys of every object, at any depth, sorted; arrays keep their order. (JavaScript puts
 * integer-like keys first in ascending numeric order whatever the insertion order, so the result is canonical too.)
 */
function sortKeys(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(sortKeys);
  if (typeof value === 'object' && value !== null) {
    const object = value as Record<string, unknown>;
    return Object.fromEntries(Object.keys(object).sort().map((key) => [key, sortKeys(object[key])]));
  }
  return value;
}

/** The entries sorted by their JSON text, compared by UTF-16 code units (never by the locale). */
function sortedByText(entries: readonly unknown[]): unknown[] {
  return entries
    .map((entry) => ({ entry, text: JSON.stringify(entry) }))
    .sort((a, b) => (a.text < b.text ? -1 : a.text > b.text ? 1 : 0))
    .map(({ entry }) => entry);
}

/**
 * The canonical text of a recipe: a JSON array of the format version, source, category (or null), fake flag (0/1),
 * EU/t, duration, special value, the inputs ([consumed 0/1, chance, options sorted by key then amount as
 * [key, amount]]), the outputs ([key, amount, chance]) and the meta without its `owners` key, object keys sorted
 * recursively. Inputs and outputs are each sorted by the JSON text of their entries, so their order does not count;
 * an input's slot is left out, as it is only its position (fluid options are told apart by their `fluid:` keys).
 */
export function canonicalRecipe(r: RecipeContent): string {
  return JSON.stringify([
    CANONICAL_VERSION, r.source, r.category ?? null, r.fake ? 1 : 0, r.euPerTick, r.durationTicks, r.specialValue,
    sortedByText(r.inputs.map((i) => [i.consumed ? 1 : 0, i.chance, i.options.toSorted(byKeyThenAmount).map((o) => [o.key, o.amount])])),
    sortedByText(r.outputs.map((o) => [o.key, o.amount, o.chance])),
    sortKeys(Object.fromEntries(Object.entries(r.meta).filter(([key]) => key !== 'owners'))),
  ]);
}

/** First 16 hex digits of sha1 over `canonicalRecipe(r)`. */
export function recipeId(r: RecipeContent): string {
  return sha1Hex(canonicalRecipe(r)).slice(0, 16);
}
