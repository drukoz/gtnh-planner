// Which file each indexed texture path comes from once the user's resource packs lie over the jars (add-on 23). Pure:
// the extractor hands in the PNG paths the jars hold and the names each pack holds, and gets back every path's
// source, the source of its `.mcmeta`, and the pack entries that had to be left out. As in the game, every pack
// outranks every jar and a later pack outranks an earlier one. A folder pack matches file names without regard to
// case (this Mac's file system), a zip pack matches exactly. The index may not hold two paths that differ only in
// case, because the Mac's disk would merge them on write, so each path gets one spelling: a jar's, else a zip's,
// else a folder's.

/** Where an indexed file comes from: the jar `jar`, or the entry `entry` of the pack `pack` (as the pack spells it). */
export type LayerFrom = { kind: 'jar'; jar: number } | { kind: 'pack'; pack: number; entry: string };
/** What one pack holds: its `data/assets`-relative PNG and `.png.mcmeta` names, as the pack spells them. */
export interface PackEntries { format: 'folder' | 'zip'; entries: ReadonlySet<string> }
export interface LayerInput {
  /** Each PNG path the jars hold, with the jar `pickWinner` chose for it. */
  jarPngs: ReadonlyMap<string, number>;
  /** Whether the jar holds `<png>.mcmeta`; `png` is a key of `jarPngs`. */
  jarHasMcmeta: (jar: number, png: string) => boolean;
  /** Lowest priority first, as `options.txt` lists them. `LayerFrom.pack` is an index into this list. */
  packs: readonly PackEntries[];
}
export interface LayerResult {
  /** Each indexed PNG path with its source. */
  png: Map<string, LayerFrom>;
  /** A PNG path with the source of its `.mcmeta`, only when it has one. */
  mcmeta: Map<string, LayerFrom>;
  /** Zip entries left out because their spelling differs from the path's only in case. */
  caseOnly: Array<{ pack: number; entry: string }>;
}

type FromPack = Extract<LayerFrom, { kind: 'pack' }>;

const PNG = '.png';
const MCMETA = '.mcmeta';
const PNG_MCMETA = `${PNG}${MCMETA}`;

/**
 * Puts the packs over the jars, in three steps.
 *
 * 1. Spelling. A lower-case path keeps the first spelling set: a jar's, else a zip's (the highest pack first), else a
 *    folder's (the highest first). Jar paths that differ only in case among themselves stay as they are, as today.
 * 2. PNG. The highest pack that holds a path takes it, with its entry as the pack spells it. A folder matches in any
 *    case, so a folder entry replaces the jar's texture under the path's spelling. A zip entry in another spelling is
 *    left out (`caseOnly`) and takes nothing. Inside one pack the first entry of a path wins (only a case-sensitive
 *    disk holds two). A jar path that no pack took keeps its jar.
 * 3. `.mcmeta`. It belongs to the path it names, in any case: one for a path that nobody holds is ignored, and a zip's
 *    in another spelling is left out. The highest pack that holds one is `h`. A PNG from pack `w` takes it only when
 *    `h >= w`: the game gives a PNG the `.mcmeta` of the highest pack at or above its own, so a pack PNG without one is
 *    still. A PNG from a jar takes `h` when there is one, else its own jar's.
 *
 * `caseOnly` lists the PNGs of step 2 first, then the `.mcmeta` entries of step 3, each highest pack first and in
 * each pack's entry order.
 */
export function layerPacks(input: LayerInput): LayerResult {
  const { jarPngs, jarHasMcmeta, packs } = input;
  const highestFirst = packs.map((pack, index) => ({ pack, index })).reverse();
  // A zip matches exactly, so its spelling is surer than a folder's: zips set spellings first.
  const spellingOrder = [
    ...highestFirst.filter(({ pack }) => pack.format === 'zip'),
    ...highestFirst.filter(({ pack }) => pack.format === 'folder'),
  ];

  const canon = new Map<string /* lower case */, string>();
  const spell = (path: string) => {
    const key = path.toLowerCase();
    if (!canon.has(key)) canon.set(key, path);
  };
  for (const path of jarPngs.keys()) spell(path);
  for (const { pack } of spellingOrder) {
    for (const entry of pack.entries) if (entry.endsWith(PNG)) spell(entry);
  }

  const png = new Map<string, LayerFrom>();
  const caseOnly: LayerResult['caseOnly'] = [];
  for (const { pack, index } of highestFirst) {
    for (const entry of pack.entries) {
      if (!entry.endsWith(PNG)) continue;
      const path = canon.get(entry.toLowerCase())!;   // spelled above
      if (pack.format === 'zip' && path !== entry) caseOnly.push({ pack: index, entry });
      else if (!png.has(path)) png.set(path, { kind: 'pack', pack: index, entry });
    }
  }
  for (const [path, jar] of jarPngs) if (!png.has(path)) png.set(path, { kind: 'jar', jar });

  const held = new Map<string, FromPack>();   // path → its `.mcmeta` in the highest pack that holds one
  for (const { pack, index } of highestFirst) {
    for (const entry of pack.entries) {
      if (!entry.endsWith(PNG_MCMETA)) continue;
      const path = canon.get(entry.slice(0, -MCMETA.length).toLowerCase());
      if (path === undefined) continue;
      if (pack.format === 'zip' && path + MCMETA !== entry) caseOnly.push({ pack: index, entry });
      else if (!held.has(path)) held.set(path, { kind: 'pack', pack: index, entry });
    }
  }
  const mcmeta = new Map<string, LayerFrom>();
  for (const [path, from] of png) {
    const meta = held.get(path);
    if (from.kind === 'jar') {
      if (meta !== undefined) mcmeta.set(path, meta);
      else if (jarHasMcmeta(from.jar, path)) mcmeta.set(path, { kind: 'jar', jar: from.jar });
    } else if (meta !== undefined && meta.pack >= from.pack) {
      mcmeta.set(path, meta);
    }
  }
  return { png, mcmeta, caseOnly };
}
