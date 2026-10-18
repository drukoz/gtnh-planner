// The files a world scan reads, behind one interface for every source: a world folder (a snapshot copy or an upload)
// here, a backup zip in zip.ts. Paths are world-relative with '/' separators; only scan paths are ever listed or read.

import type { Dirent } from 'node:fs';
import { readdir, readFile, stat } from 'node:fs/promises';
import { basename, join } from 'node:path';
import { parseRegionPath } from '../../shared/world/region.ts';

export interface WorldEntry { path: string /* world-relative, '/' separators */; size: number }

export interface WorldFiles {
  readonly label: string;
  list(): Promise<WorldEntry[]>;
  /** The file's bytes; null for a path that `list()` does not hold. */
  read(rel: string): Promise<Buffer | null>;
  close(): Promise<void>;
}

// `<name>` is one path segment with something before the extension.
const SIDE_FILE = /^(?:playerdata\/[^/\\\0]+\.dat|serverutilities\/teams\/claimedchunks\/[^/\\\0]+\.dat|gtnhteams\/[^/\\\0]+\.json|betterquesting\/QuestProgress\/[^/\\\0]+\.json)$/;

/** True only for the files a scan reads: level.dat, region files and the player, claim, team, quest and prospecting files. */
export function isScanPath(rel: string): boolean {
  return rel === 'level.dat' || rel === 'data/visualprospecting.dat' || SIDE_FILE.test(rel) || parseRegionPath(rel) !== null;
}

// The folders that can hold scan paths; nothing else of a world (~50 DIM folders of mod data) is walked.
const SCAN_DIRS = new Set(['region', 'playerdata', 'serverutilities', 'serverutilities/teams', 'serverutilities/teams/claimedchunks',
  'gtnhteams', 'betterquesting', 'betterquesting/QuestProgress', 'data']);
const DIM_DIR = /^DIM-?[1-9]\d*(?:\/region)?$/;

function isMissing(err: unknown): boolean {
  const code = (err as { code?: unknown } | null)?.code;
  return code === 'ENOENT' || code === 'ENOTDIR';
}

/**
 * Regular files only (links are never followed out of the world). A file or folder below the root that disappears
 * while the walk runs (a live world renames player files as it saves them) is left out; errors on the root propagate.
 */
async function walk(root: string, relDir: string, out: WorldEntry[]): Promise<void> {
  let dirents: Dirent[];
  try {
    dirents = await readdir(relDir === '' ? root : join(root, relDir), { withFileTypes: true });
  } catch (err) {
    if (relDir !== '' && isMissing(err)) return;
    throw err;
  }
  for (const d of dirents) {
    const rel = relDir === '' ? d.name : `${relDir}/${d.name}`;
    if (d.isDirectory()) {
      if (SCAN_DIRS.has(rel) || DIM_DIR.test(rel)) await walk(root, rel, out);
    } else if (d.isFile() && isScanPath(rel)) {
      try {
        out.push({ path: rel, size: (await stat(join(root, rel))).size });
      } catch (err) {
        if (!isMissing(err)) throw err;
      }
    }
  }
}

/** The scan paths of a world folder, listed once when it is opened. File system errors on `root` propagate unchanged. */
export async function openDirWorld(root: string, label: string = basename(root)): Promise<WorldFiles> {
  const entries: WorldEntry[] = [];
  await walk(root, '', entries);
  entries.sort((a, b) => (a.path < b.path ? -1 : a.path > b.path ? 1 : 0));
  const listed = new Set(entries.map((e) => e.path));
  return {
    label,
    list: async () => entries.map((e) => ({ ...e })),
    read: async (rel) => (listed.has(rel) ? readFile(join(root, rel)) : null),
    close: async () => {},
  };
}
