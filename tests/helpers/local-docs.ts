// The user's private files under docs/local (never committed or copied): the real-data tests read a few of them at run
// time, settings only, and skip with a logged note where they are missing. A worktree has no docs/local of its own, so
// the main checkout's is found too: the parent of git's common directory.

import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import type { PlanSettings } from '../../src/shared/types/plan.ts';

/** The user's reference Electronic Circuit flow (the plan 12 fix wave 2 analysis): `.settings` holds its settings. */
export const REFERENCE = join('docs', 'local', 'circuit-reference', 'reference.json');
/** The user's own Electronic Circuit project as stored (the Auto Workbench ruling's item 7): `.settings` holds its settings. */
export const EC_STATE = join('docs', 'local', 'ec-state.json');

/**
 * `file` (a path relative to a checkout): `override` when set, else `file` in this checkout, else in the main checkout;
 * undefined when none exists.
 */
export function localDocPath(file: string, override?: string): string | undefined {
  const candidates = [override, resolve(file)];
  try {
    candidates.push(join(dirname(resolve(execFileSync('git', ['rev-parse', '--git-common-dir'], { encoding: 'utf8' }).trim())), file));
  } catch {
    // no git here: the other places only
  }
  return candidates.find((path): path is string => path !== undefined && existsSync(path));
}

/** The stored settings of the project file at `path` (`.settings`), as stored: callers normalize them. */
export function storedSettings(path: string): Partial<PlanSettings> {
  return (JSON.parse(readFileSync(path, 'utf8')) as { settings: Partial<PlanSettings> }).settings;
}
