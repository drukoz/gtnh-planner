// Recipe map ids after alias normalization (architecture §5; prior-art T4): GT renames maps between pack versions, and
// the 2.9 pre-releases moved the GT++ maps from `gtpp.recipe.*` to `gt.recipe.*`.

/**
 * Map renames known from pack versions: old id -> canonical id. `normalizeMapId` reads it before and after its generic
 * rules, and `aliasesOf` lists its keys even when the export has no map under that name.
 */
export const MAP_ALIASES: Readonly<Record<string, string>> = Object.freeze({
  'gtpp.recipe.lftr.sparging': 'gt.recipe.lftr.sparging',
  'gt.recipe.fluidchemicaleactor': 'gt.recipe.fluidchemicalreactor', // RC-1 misspells the reactor
});

/** GT's old map identifiers end in five counters (`gt.recipe.macerator_1_2_3_4_5`); the pattern `RecipeMap.getFromOldIdentifier` strips. */
const OLD_NUMERIC_SUFFIX = /_\d+_\d+_\d+_\d+_\d+$/;
const GTPP_PREFIX = 'gtpp.recipe.';
const GT_PREFIX = 'gt.recipe.';

/** Own entries only, so an id like `constructor` never finds something on the object's prototype. */
function aliasFor(id: string): string | undefined {
  return Object.hasOwn(MAP_ALIASES, id) ? MAP_ALIASES[id] : undefined;
}

/**
 * The canonical id of the recipe map that an export calls `raw`: an alias-table entry wins; otherwise GT's old numeric
 * suffix is stripped and a leading `gtpp.recipe.` becomes `gt.recipe.` (the two rules combine); the result may itself be
 * an alias-table key (`gtpp.recipe.fluidchemicaleactor`), so the table is read once more.
 */
export function normalizeMapId(raw: string): string {
  const direct = aliasFor(raw);
  if (direct !== undefined) return direct;
  let id = raw.replace(OLD_NUMERIC_SUFFIX, '');
  if (id.startsWith(GTPP_PREFIX)) id = GT_PREFIX + id.slice(GTPP_PREFIX.length);
  return aliasFor(id) ?? id;
}

/**
 * The other names a map goes by, sorted and without duplicates: the raw ids seen in the export that differ from `id`,
 * plus the alias-table keys that point at `id`.
 */
export function aliasesOf(id: string, rawSeen: Iterable<string>): string[] {
  const aliases = new Set<string>();
  for (const raw of rawSeen) if (raw !== id) aliases.add(raw);
  for (const [old, canonical] of Object.entries(MAP_ALIASES)) if (canonical === id) aliases.add(old);
  return [...aliases].sort();
}
