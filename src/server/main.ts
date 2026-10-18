// `npm start`: the planner's one Node process (web-stack §2.2). It serves the API and the built client on the configured
// port, backs the project database up once a day, and shuts down cleanly on Ctrl-C or SIGTERM.

import { join } from 'node:path';
import { createApp } from './app.ts';
import { ConfigError, configPath, loadConfig, type AppConfig } from './config.ts';
import { backupDaily } from './db/db.ts';
import { startServer } from './http/server.ts';

const DAY_MS = 86_400_000;

function messageOf(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

function fail(message: string): never {
  console.error(message);
  process.exit(1);
}

/** What keeps this config from serving, or null. loadConfig type-checks only the export fields. */
function startProblem(config: AppConfig, file: string): string | null {
  if (typeof config.passwordHash !== 'string' || config.passwordHash === '') return 'Set a password first: npm run set-password';
  if (typeof config.sessionSecret !== 'string' || config.sessionSecret === '') {
    return `${file}: sessionSecret must be a non-empty string; remove it and run npm run set-password`;
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
  let server;
  try {
    server = await startServer(app, { port: config.port, host: config.host });
  } catch (err) {
    app.db.close();
    fail(`Cannot listen on ${config.host}:${config.port}: ${messageOf(err)}`);
  }

  const backup = (): void => {
    backupDaily(app.db, join(config.dataDir, 'backups'), new Date())
      .catch((err: unknown) => console.error(`Daily backup failed: ${messageOf(err)}`));
  };
  backup();
  const backups = setInterval(backup, DAY_MS);
  backups.unref();

  console.log(`GTNH Line Planner on ${server.url}`);
  app.pack().catch(() => {});   // load in the background so the first page does not wait; errors show on use

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
