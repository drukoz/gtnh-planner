// What a world folder or zip picked in the browser holds for a scan (spec §3.4, §6). The world root is the folder of
// the shallowest level.dat; `files` are the files an upload may carry (the server's allow-list: level.dat and region
// files in their one canonical spelling); `local` are the player and claim files that only the browser reads
// (architecture §11.12) and that are never an upload item.

import { parseRegionPath, regionPathOf } from '../../shared/world/region.ts';

export { dimLabel } from '../map/render.ts';   // one rule for dimension names (ledger ruling M-R1)

export interface PickedEntry { path: string; size: number }

export interface WorldPick {
  /** The folder holding level.dat, ending in '/' ('' when level.dat is at the top); null without a level.dat. */
  root: string | null;
  /** `rel` is world-relative; `dim` is null for level.dat. */
  files: Array<{ path: string; rel: string; dim: number | null; size: number }>;
  local: Array<{ path: string; rel: string; size: number }>;
  /** The region files of each dimension, sorted by dim. */
  dims: Array<{ dim: number; files: number; bytes: number }>;
}

const LEVEL_DAT = 'level.dat';
// `<name>` is one path segment with something before the extension, as the server's scan paths (files.ts).
const LOCAL_FILE = /^(?:playerdata|serverutilities\/teams\/claimedchunks)\/[^/\\\0]+\.dat$/;

/**
 * The world-relative path itself when the server takes it in an upload, else null. The same rule as the server's
 * `uploadKind`: `level.dat`, or a region path that `regionPathOf` spells exactly so.
 */
export function uploadRel(worldRelative: string): string | null {
  if (worldRelative === LEVEL_DAT) return worldRelative;
  const r = parseRegionPath(worldRelative);
  return r !== null && worldRelative === regionPathOf(r.dim, r.rx, r.rz) ? worldRelative : null;
}

/** The folder of the shallowest level.dat; ties go to the first path in code-point order (as the server's zip reader). */
function worldRoot(entries: readonly PickedEntry[]): string | null {
  let best: { path: string; depth: number } | null = null;
  for (const { path } of entries) {
    if (path !== LEVEL_DAT && !path.endsWith(`/${LEVEL_DAT}`)) continue;
    const depth = path.split('/').length;
    if (best === null || depth < best.depth || (depth === best.depth && path < best.path)) best = { path, depth };
  }
  return best === null ? null : best.path.slice(0, best.path.length - LEVEL_DAT.length);
}

/** Sorts the picked entries into upload files and browser-only files under the world root; each path counts once. */
export function pickWorldFiles(entries: PickedEntry[]): WorldPick {
  const root = worldRoot(entries);
  const pick: WorldPick = { root, files: [], local: [], dims: [] };
  if (root === null) return pick;
  const seen = new Set<string>();
  const dims = new Map<number, { dim: number; files: number; bytes: number }>();
  for (const { path, size } of entries) {
    if (!path.startsWith(root) || seen.has(path)) continue;
    seen.add(path);
    const rel = path.slice(root.length);
    if (uploadRel(rel) !== null) {
      const dim = rel === LEVEL_DAT ? null : parseRegionPath(rel)!.dim;
      pick.files.push({ path, rel, dim, size });
      if (dim !== null) {
        const d = dims.get(dim) ?? { dim, files: 0, bytes: 0 };
        d.files += 1;
        d.bytes += size;
        dims.set(dim, d);
      }
    } else if (LOCAL_FILE.test(rel)) {
      pick.local.push({ path, rel, size });
    }
  }
  pick.dims = [...dims.values()].sort((a, b) => a.dim - b.dim);
  return pick;
}

/** What a whole-dimension upload sends: level.dat first, then the region files of `dims` in picked order. */
export function selectDims(pick: WorldPick, dims: number[]): WorldPick['files'] {
  const wanted = new Set(dims);
  return [...pick.files.filter((f) => f.dim === null), ...pick.files.filter((f) => f.dim !== null && wanted.has(f.dim))];
}
