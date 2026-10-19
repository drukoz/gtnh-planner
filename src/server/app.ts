// What every route module gets (architecture §7.1): the config, the project database and store, the SSE hub, the
// active pack (loaded once per export) and the services later plans register (assets, world, layout, planner hooks).

import { join } from 'node:path';
import { activeExportDir, type AppConfig } from './config.ts';
import { openDb, type Db } from './db/db.ts';
import { HttpError } from './http/router.ts';
import { SseHub } from './http/sse.ts';
import { loadPack } from './pack/load.ts';
import { PLANNER_UPDATE, ProjectStore } from './projects/store.ts';
import type { Pack } from '../shared/types/pack.ts';
import type { Plan, PlanContext } from '../shared/types/plan.ts';
import type { Project } from '../shared/types/project.ts';

/**
 * What later plans register. The planner hooks are read on every call, never captured at start (ruling R20):
 * `planContext` (architecture §7.1, set by Plan 4) gives the world a project is planned in, else the planner uses an
 * empty context; `planFinish` (§11.16, set by Plan 5) finishes a plan the cache holds before the plan route sends it,
 * and returns a new plan rather than changing the one it gets.
 */
export interface AppServices {
  planContext?: (project: Project) => Promise<PlanContext>;
  planFinish?: (plan: Plan, project: Project) => Promise<Plan>;
  [name: string]: unknown;
}

export interface AppContext {
  config: AppConfig;
  db: Db;
  projects: ProjectStore;
  sse: SseHub;
  pack(): Promise<Pack>;
  /** Plans 3–5 register e.g. services.assets, services.world, services.layout, and the planner hooks. */
  services: AppServices;
}

export interface AppDeps {
  loadPack?: (exportDir: string) => Promise<Pack>;
  /** The clock of project timestamps. */
  now?: () => Date;
}

/**
 * Opens `<dataDir>/planner.sqlite` and wires the store and the hub. Projects stored before the current settings defaults
 * are brought to them first, as recorded 'Planner update' ops (`ProjectStore.migrateSettings`), before anything can read
 * or plan them. `pack()` loads the active export on first use and again only when `config.activeExportId` changes;
 * callers that arrive while it loads share that load, and a load that fails is forgotten so the next call tries again.
 */
export function createApp(config: AppConfig, deps: AppDeps = {}): AppContext {
  const load = deps.loadPack ?? loadPack;
  const db = openDb(join(config.dataDir, 'planner.sqlite'));
  const projects = new ProjectStore(db, { now: deps.now });
  projects.migrateSettings(PLANNER_UPDATE);
  let loaded: { exportId: string; pack: Promise<Pack> } | null = null;

  function pack(): Promise<Pack> {
    const exportId = config.activeExportId;
    if (!exportId) {
      return Promise.reject(new HttpError(503, 'no-export', 'No recipe export yet — run npm run export'));
    }
    if (loaded?.exportId === exportId) return loaded.pack;
    const entry = { exportId, pack: Promise.resolve().then(() => load(activeExportDir(config))) };
    loaded = entry;
    entry.pack.catch(() => {
      if (loaded === entry) loaded = null;
    });
    return entry.pack;
  }

  return {
    config,
    db,
    projects,
    sse: new SseHub(),
    pack,
    services: {},
  };
}
