// `npm start`: the planner's one Node process (web-stack §2.2). It serves the API and the built client on the configured
// port, backs the project database up and purges projects deleted over 7 days ago once a day (and at start), and shuts
// down cleanly on Ctrl-C or SIGTERM.

import { join } from 'node:path';
import { createApp } from './app.ts';
import { ConfigError, configPath, loadConfig, type AppConfig } from './config.ts';
import { backupDaily, PURGE_AFTER_MS } from './db/db.ts';
import { startServer } from './http/server.ts';
import { startPlanningThread } from './planner/thread.ts';

const DAY_MS = 86_400_000;

function messageOf(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

function fail(message: string): never {
  console.error(message);
  process.exit(1);
}

/** What keeps this config from serving, or null. loadConfig type-checks the export fields and `requirePassword` only. */
export function startProblem(config: AppConfig, file: string): string | null {
  if (config.requirePassword) {
    if (typeof config.passwordHash !== 'string' || config.passwordHash === '') return 'Set a password first: npm run set-password';
    if (typeof config.sessionSecret !== 'string' || config.sessionSecret === '') {
      return `${file}: sessionSecret must be a non-empty string; remove it and run npm run set-password`;
    }
  }
  if (!Number.isInteger(config.port) || config.port < 0 || config.port > 65_535) return `${file}: port must be a whole number from 0 to 65535`;
  if (typeof config.host !== 'string' || config.host === '') return `${file}: host must be a non-empty string such as "0.0.0.0"`;
  return null;
}

async function main(): Promise<void> {
  const file = configPath();
  let config: AppConfig;
  try {
    config = loadConfig(file);
  } catch (err) {
    if (err instanceof ConfigError) fail(err.message);
    throw err;
  }
  const problem = startProblem(config, file);
  if (problem !== null) fail(problem);

  const app = createApp(config);
  // Planning runs on a thread of its own, so this one keeps answering the group meanwhile (RUK-563).
  app.services.planningThread = startPlanningThread();
  let server;
  try {
    server = await startServer(app, { port: config.port, host: config.host });
  } catch (err) {
    app.db.close();
    fail(`Cannot listen on ${config.host}:${config.port}: ${messageOf(err)}`);
  }

  const purge = (): void => {
    try {
      const purged = app.db.purgeDeletedProjects(new Date(), PURGE_AFTER_MS);
      if (purged > 0) console.log(`Removed ${purged} project(s) deleted more than 7 days ago`);
    } catch (err) {
      console.error(`Purging deleted projects failed: ${messageOf(err)}`);
    }
  };
  // The backup goes first, so the day's copy still holds what the purge then removes for good.
  const daily = (): void => {
    backupDaily(app.db, join(config.dataDir, 'backups'), new Date())
      .catch((err: unknown) => console.error(`Daily backup failed: ${messageOf(err)}`))
      .finally(purge);
  };
  daily();
  const backups = setInterval(daily, DAY_MS);
  backups.unref();

  // This thread's own pack, loaded before the server says it is ready, so no request waits behind its load (RUK-563);
  // a failed load shows on use.
  await app.pack().catch(() => {});
  console.log(`GTNH Line Planner on ${server.url}`);
  if (!config.requirePassword) {
    console.log('No password is asked: anyone who can reach that address can change and delete projects. npm run set-password sets one.');
  }

  let stopping = false;
  const stop = (): void => {
    if (stopping) process.exit(1);   // a second Ctrl-C does not wait
    stopping = true;
    clearInterval(backups);
    server.close()
      .catch((err: unknown) => console.error(`Closing the server failed: ${messageOf(err)}`))
      .finally(() => {
        app.db.close();
        process.exit(0);
      });
  };
  process.on('SIGINT', stop);
  process.on('SIGTERM', stop);
}

if (import.meta.main) await main();
