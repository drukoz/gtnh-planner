// What every route module gets (architecture §7.1): the config, the project database and store, the SSE hub, the
// active pack (loaded once per export) and the services later plans register (assets, world, layout, planner hooks).

import { join } from 'node:path';
import { activeExportDir, type AppConfig } from './config.ts';
import { openDb, type Db } from './db/db.ts';
import { HttpError } from './http/router.ts';
import { SseHub } from './http/sse.ts';
import { loadPack } from './pack/load.ts';
import { ProjectStore } from './projects/store.ts';
import type { Pack } from '../shared/types/pack.ts';

export interface AppContext {
  config: AppConfig;
  db: Db;
  projects: ProjectStore;
  sse: SseHub;
  pack(): Promise<Pack>;
  /** Plans 3–5 register e.g. services.assets, services.world, services.layout. */
  services: Record<string, unknown>;
}

export interface AppDeps {
  loadPack?: (exportDir: string) => Promise<Pack>;
  /** The clock of project timestamps. */
  now?: () => Date;
}

/**
 * Opens `<dataDir>/planner.sqlite` and wires the store and the hub. `pack()` loads the active export on first use and
 * again only when `config.activeExportId` changes; callers that arrive while it loads share that load, and a load that
 * fails is forgotten so the next call tries again.
 */
export function createApp(config: AppConfig, deps: AppDeps = {}): AppContext {
  const load = deps.loadPack ?? loadPack;
  const db = openDb(join(config.dataDir, 'planner.sqlite'));
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
    projects: new ProjectStore(db, { now: deps.now }),
    sse: new SseHub(),
    pack,
    services: {},
  };
}
