// What the planner worked out, kept on disk between runs (RUK-563 milestone 2), under `<dataDir>/cache/`: the plans by
// their plan cache key (`plans/`), the lines' goods by their plan key (`goods/`), and what finishing each plan with its
// layout worked out by its layout key (`finished/`), each a `diskCache` under the code's version (`codeVersion`), so a
// restarted server answers what the last one worked out, and a pulled change never serves what older code made. Only
// `main.ts` opens it (`app.services.planStore`); without it, every result is kept in memory only, as before.

import { readdirSync, rmSync } from 'node:fs';
import { join, resolve } from 'node:path';
import type { AppContext } from '../app.ts';
import { worldService } from '../http/routes/world.ts';
import { diskCache, type DiskCache } from './disk-cache.ts';
import type { Project } from '../../shared/types/project.ts';

/** Files kept in each of the store's folders, the least recently used dropped first. */
export const PLAN_STORE_FILES = 64;

/** The store's three caches, one folder each. */
export interface PlanStore {
  /** Plans as the plan cache keeps them, by plan cache key. */
  plans: DiskCache;
  /** A line's goods (`StuffKey[]`, in the order they were found), by plan key. */
  goods: DiskCache;
  /** What finishing a plan with its layout worked out (layout/service.ts), by layout key. */
  finished: DiskCache;
}

/**
 * The store under `<dataDir>/cache/`, for code version `version`. It first deletes the temp files a `put` that died
 * between its write and its rename left behind (`*.tmp`): one server uses a data folder, so no other put is under way.
 */
export function openPlanStore(dataDir: string, version: string): PlanStore {
  const open = (name: string): DiskCache => {
    const dir = resolve(dataDir, 'cache', name);
    let names: string[] = [];
    try {
      names = readdirSync(dir);
    } catch {
      // not made yet: the first put makes it
    }
    for (const n of names) if (n.endsWith('.tmp')) rmSync(join(dir, n), { force: true });
    return diskCache(dir, { max: PLAN_STORE_FILES, version });
  };
  return { plans: open('plans'), goods: open('goods'), finished: open('finished') };
}

/**
 * The app's store (`app.services.planStore`, which `main.ts` opens) for `project`'s results, or undefined: keep them
 * in memory only. Undefined also while the project's scan is not done: what is worked out then is worked out in an
 * empty world, under the keys the finished scan's results will have, so it must not outlive this server.
 */
export function planStoreFor(app: AppContext, project: Project): PlanStore | undefined {
  const store = app.services.planStore as PlanStore | undefined;
  if (store === undefined) return undefined;
  const { scanId } = project.world;
  return scanId === null || worldService(app).scanStatus(scanId).state === 'done' ? store : undefined;
}
