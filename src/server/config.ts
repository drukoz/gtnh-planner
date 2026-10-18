// The app's settings file, `data/config.json` (architecture §9, §11.1). Plan 1 knows the export paths; Plan 2 adds
// `port`, `host`, `passwordHash` and `sessionSecret`. Keys this code does not know survive a load and save.

import { closeSync, fchmodSync, fsyncSync, mkdirSync, openSync, readFileSync, renameSync, rmSync, writeSync } from 'node:fs';
import { basename, dirname, join, resolve } from 'node:path';

export interface AppConfig {
  dataDir: string;
  serverFolder: string | null;
  activeExportId: string | null;
  port: number;
  host: string;
  /** `scrypt$N$r$p$<salt>$<key>` from `npm run set-password`; `''` = no password set yet. */
  passwordHash: string;
  /** Hex key that signs session cookies; `''` until `npm run set-password` creates it. */
  sessionSecret: string;
  /** The Minecraft 1.7.10 client jar (architecture §11.17, read by Plan 3's `extract-assets`). */
  clientJar?: string | null;
}

export const DEFAULT_CONFIG: Readonly<AppConfig> = Object.freeze({
  dataDir: 'data', serverFolder: null, activeExportId: null,
  port: 8765, host: '0.0.0.0', passwordHash: '', sessionSecret: '', clientJar: null,
});

/** The settings file cannot be read, is not valid JSON, or holds a value of the wrong type. */
export class ConfigError extends Error {
  constructor(message: string, options?: ErrorOptions) {
    super(message, options);
    this.name = 'ConfigError';
  }
}

export class NoActiveExportError extends Error {
  constructor() {
    super('No active export. Run `npm run export` first.');
    this.name = 'NoActiveExportError';
  }
}

/** `GTNH_PLANNER_CONFIG` when set (and not empty), else `data/config.json` in the working directory. */
export function configPath(): string {
  return resolve(process.env.GTNH_PLANNER_CONFIG || 'data/config.json');
}

function messageOf(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

function isMissing(err: unknown): boolean {
  return (err as NodeJS.ErrnoException | null)?.code === 'ENOENT';
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function checkFields(c: Record<string, unknown>, file: string): void {
  const fail = (field: string, expected: string) =>
    new ConfigError(`${file}: ${field} must be ${expected}, got ${JSON.stringify(c[field])}. Fix or delete the file.`);
  if (typeof c.dataDir !== 'string' || c.dataDir === '') throw fail('dataDir', 'a non-empty string');
  for (const field of ['serverFolder', 'activeExportId'] as const) {
    if (c[field] !== null && typeof c[field] !== 'string') throw fail(field, 'a string or null');
  }
}

/** The defaults when `file` does not exist; otherwise its values over the defaults, unknown keys kept. Never writes. */
export function loadConfig(file: string = configPath()): AppConfig {
  let text: string;
  try {
    text = readFileSync(file, 'utf8');
  } catch (err) {
    if (isMissing(err)) return { ...DEFAULT_CONFIG };
    throw new ConfigError(`${file}: cannot read the settings file: ${messageOf(err)}`, { cause: err });
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch (err) {
    throw new ConfigError(`${file}: the settings file is not valid JSON (${messageOf(err)}). Fix or delete it.`, { cause: err });
  }
  if (!isPlainObject(parsed)) throw new ConfigError(`${file}: the settings file must hold a JSON object. Fix or delete it.`);
  const config = { ...DEFAULT_CONFIG, ...parsed };
  checkFields(config, file);
  return config as AppConfig;
}

/**
 * Writes `c` as 2-space JSON plus a newline, readable by its owner only (0600): first to a temporary file next to
 * `file`, which is then renamed over it, so a crash never leaves a half-written file. Creates the folder if needed.
 */
export function saveConfig(c: AppConfig, file: string = configPath()): void {
  const dir = dirname(file);
  mkdirSync(dir, { recursive: true });
  const temp = join(dir, `.${basename(file)}.${process.pid}.${Date.now()}.tmp`);
  try {
    const fd = openSync(temp, 'wx', 0o600);
    try {
      writeSync(fd, `${JSON.stringify(c, null, 2)}\n`);
      fchmodSync(fd, 0o600);   // the mode given to openSync is reduced by the umask
      fsyncSync(fd);
    } finally {
      closeSync(fd);
    }
    renameSync(temp, file);
  } catch (err) {
    rmSync(temp, { force: true });
    throw err;
  }
}

/** `<dataDir>/export/<exportId>`, absolute; a relative `dataDir` is relative to the working directory. */
export function exportDirFor(cfg: AppConfig, exportId: string): string {
  if (exportId === '' || exportId === '.' || exportId === '..' || /[/\\\0]/.test(exportId)) {
    throw new ConfigError(`export id ${JSON.stringify(exportId)} is not a folder name`);
  }
  return resolve(cfg.dataDir, 'export', exportId);
}

/** The folder of the active export; `NoActiveExportError` when there is none. */
export function activeExportDir(cfg: AppConfig): string {
  if (!cfg.activeExportId) throw new NoActiveExportError();
  return exportDirFor(cfg, cfg.activeExportId);
}
