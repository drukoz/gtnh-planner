// `npm run extract-assets -- [--server <folder>] [--client-jar <path> | --no-client]`: copies the block and item
// textures of the server pack's mod jars and of the official Minecraft 1.7.10 client jar into `<dataDir>/assets/`
// (Task 3). The server folder is only read. Exit 0 extracted; 1 the extraction failed, also when no mod jar could be
// read (the previous textures stay in place); 2 bad arguments or settings, or no usable client jar. Every path is
// resolved from the working directory, which is the repo root under npm.

import { createHash } from 'node:crypto';
import { createReadStream, statSync } from 'node:fs';
import { readdir } from 'node:fs/promises';
import { homedir } from 'node:os';
import { basename, join, resolve } from 'node:path';
import { parseArgs } from 'node:util';
import { ExtractError, extractAssets, type ExtractSummary, type JarSource } from '../assets/extract.ts';
import { ConfigError, loadConfig, type AppConfig } from '../config.ts';

/** The SHA-1 of Mojang's `1.7.10.jar` client download. */
export const CLIENT_JAR_SHA1 = 'e80d9b3bf5085002218d4be59e668bac718abbc6';
/** Where the launchers keep the 1.7.10 client jar, relative to the home folder: Prism Launcher, then Mojang's own. */
export const CLIENT_JAR_CANDIDATES: readonly string[] = Object.freeze([
  'Library/Application Support/PrismLauncher/libraries/com/mojang/minecraft/1.7.10/minecraft-1.7.10-client.jar',
  'Library/Application Support/minecraft/versions/1.7.10/1.7.10.jar',
]);

const USAGE = 'Usage: npm run extract-assets -- [--server <folder>] [--client-jar <path> | --no-client]';
const NO_SERVER = 'No server folder: set "serverFolder" in data/config.json or pass --server <folder>';
const NO_CLIENT = 'No Minecraft 1.7.10 client jar found. Pass --client-jar <path> or set "clientJar" in data/config.json '
  + `(Prism Launcher keeps it at ~/${CLIENT_JAR_CANDIDATES[0]}), or use --no-client.`;
const NO_CLIENT_WARNING = 'warning: no client jar - vanilla block and item textures will be missing';
const WINNER_RULE = 'winner: mod over vanilla, then an overriding jar over the texture\'s own mod, then the last jar by name';
const SHOWN_CONFLICTS = 20;
const BYTES_PER_MB = 1_000_000;

const FAILED = 1;
const USAGE_ERROR = 2;

/** `AppConfig` with the client jar setting of architecture §11.17, which Plan 2 adds to `AppConfig` itself. */
export type ClientJarConfig = AppConfig & { clientJar?: string | null };

/** The `clientJar` setting when it is a non-empty string, else null (`loadConfig` keeps keys it does not know). */
export function clientJarOf(c: AppConfig): string | null {
  const value = (c as ClientJarConfig).clientJar;
  return typeof value === 'string' && value !== '' ? value : null;
}

class UsageError extends Error {}

interface Options { help: boolean; server?: string; clientJar?: string; noClient: boolean }

function parseOptions(argv: string[]): Options {
  let values: { help?: boolean; server?: string; 'client-jar'?: string; 'no-client'?: boolean };
  try {
    ({ values } = parseArgs({
      args: argv, strict: true, allowPositionals: false,
      options: {
        help: { type: 'boolean', short: 'h' }, server: { type: 'string' }, 'client-jar': { type: 'string' },
        'no-client': { type: 'boolean' },
      },
    }));
  } catch (err) {
    throw new UsageError(err instanceof Error ? err.message : String(err));
  }
  for (const flag of ['server', 'client-jar'] as const) {
    if (values[flag] !== undefined && values[flag].trim() === '') throw new UsageError(`--${flag} needs a value`);
  }
  const noClient = values['no-client'] === true;
  if (noClient && values['client-jar'] !== undefined) throw new UsageError('--client-jar and --no-client cannot be used together');
  return { help: values.help === true, server: values.server, clientJar: values['client-jar'], noClient };
}

function messageOf(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

const isFile = (path: string) => statSync(path, { throwIfNoEntry: false })?.isFile() === true;
const isFolder = (path: string) => statSync(path, { throwIfNoEntry: false })?.isDirectory() === true;

/** Case-insensitive order of the file names, then exact order, then the full paths. */
function byJarName(a: string, b: string): number {
  const x = basename(a);
  const y = basename(b);
  const cmp = (p: string, q: string) => (p < q ? -1 : p > q ? 1 : 0);
  return cmp(x.toLowerCase(), y.toLowerCase()) || cmp(x, y) || cmp(a, b);
}

/** `<server>/mods/*.jar` and `<server>/mods/1.7.10/*.jar` (the folders FML loads mods from), sorted by file name. */
export async function listModJars(serverFolder: string): Promise<string[]> {
  const jars: string[] = [];
  for (const dir of [join(serverFolder, 'mods'), join(serverFolder, 'mods', '1.7.10')]) {
    let names: string[];
    try {
      names = await readdir(dir);
    } catch (err) {
      const code = (err as NodeJS.ErrnoException | null)?.code;
      if (code === 'ENOENT' || code === 'ENOTDIR') continue;
      throw err;
    }
    for (const name of names) {
      if (name.endsWith('.jar') && isFile(join(dir, name))) jars.push(join(dir, name));
    }
  }
  return jars.sort(byJarName);
}

/**
 * The client jar to use: the flag when given (even if it does not exist, so that a typo is reported), else the first
 * of the configured path and the launcher folders under `home` that is a file; null when none is.
 */
export function findClientJar(opts: { flag: string | null; config: string | null | undefined; home: string }): string | null {
  if (opts.flag !== null) return resolve(opts.flag);
  const tried = [...(opts.config ? [resolve(opts.config)] : []), ...CLIENT_JAR_CANDIDATES.map((rel) => join(opts.home, rel))];
  return tried.find(isFile) ?? null;
}

/** The SHA-1 of the file, as lower-case hex. */
export async function sha1File(path: string): Promise<string> {
  const hash = createHash('sha1');
  for await (const chunk of createReadStream(path, { flags: 'r' })) hash.update(chunk as Buffer);
  return hash.digest('hex');
}

function summaryLines(s: ExtractSummary, dataDir: string): string[] {
  const assets = join(dataDir, 'assets');
  const lines = [
    `Extracted ${s.files} textures (${(s.bytes / BYTES_PER_MB).toFixed(1)} MB) from ${s.jars} jars into ${assets}`,
    `${s.identicalDuplicates} identical duplicates, ${s.conflicts.length} conflicting paths (${WINNER_RULE}):`,
    ...s.conflicts.slice(0, SHOWN_CONFLICTS).map((c) => `  ${c.path}: ${c.winner} over ${c.losers.join(', ')}`),
  ];
  if (s.conflicts.length > SHOWN_CONFLICTS) {
    lines.push(`  … ${s.conflicts.length - SHOWN_CONFLICTS} more in ${join(assets, 'index.json')}`);
  }
  return lines;
}

export async function main(
  argv: string[],
  deps: { config?: AppConfig; home?: string; clientSha1?: string; out?: (line: string) => void; err?: (line: string) => void } = {},
): Promise<number> {
  const out = deps.out ?? ((line: string) => { process.stdout.write(`${line}\n`); });
  const err = deps.err ?? ((line: string) => { process.stderr.write(`${line}\n`); });
  const fail = (message: string, code: number) => {
    err(message);
    return code;
  };

  let opts: Options;
  try {
    opts = parseOptions(argv);
  } catch (e) {
    if (e instanceof UsageError) return fail(`${e.message}\n${USAGE}`, USAGE_ERROR);
    throw e;
  }
  if (opts.help) {
    out(USAGE);
    return 0;
  }

  let config: AppConfig;
  try {
    config = deps.config ?? loadConfig();
  } catch (e) {
    if (e instanceof ConfigError) return fail(e.message, USAGE_ERROR);
    throw e;
  }
  const given = opts.server ?? config.serverFolder;
  if (given === null) return fail(NO_SERVER, USAGE_ERROR);
  const server = resolve(given);
  if (!isFolder(join(server, 'mods'))) return fail(`No mods folder in ${server}`, USAGE_ERROR);

  let client: { path: string; sha1: string } | null = null;
  if (opts.noClient) {
    err(NO_CLIENT_WARNING);
  } else {
    const path = findClientJar({ flag: opts.clientJar ?? null, config: clientJarOf(config), home: deps.home ?? homedir() });
    if (path === null) return fail(NO_CLIENT, USAGE_ERROR);
    if (opts.clientJar !== undefined && !isFile(path)) return fail(`Client jar not found: ${path}`, USAGE_ERROR);
    let sha1: string;
    try {
      sha1 = await sha1File(path);
    } catch (e) {
      return fail(`Cannot read the client jar ${path}: ${messageOf(e)}`, USAGE_ERROR);
    }
    const expected = deps.clientSha1 ?? CLIENT_JAR_SHA1;
    if (sha1 !== expected) {
      return fail(`${path} is not the official Minecraft 1.7.10 client jar (sha1 ${sha1}, expected ${expected})`, USAGE_ERROR);
    }
    client = { path, sha1 };
  }

  const jars: JarSource[] = [
    ...(client === null ? [] : [{ path: client.path, kind: 'client' as const }]),
    ...(await listModJars(server)).map((path) => ({ path, kind: 'mod' as const })),
  ];
  let summary: ExtractSummary;
  try {
    summary = await extractAssets({ jars, dataDir: config.dataDir, ...(client === null ? {} : { clientSha1: client.sha1 }) });
  } catch (e) {
    if (e instanceof ExtractError) return fail(`Extraction failed; the previous textures are still in place: ${e.message}`, FAILED);
    throw e;
  }
  for (const line of summaryLines(summary, config.dataDir)) out(line);
  for (const skipped of summary.skippedJars) err(`warning: skipped ${skipped.jar}: ${skipped.error}`);
  return 0;
}

if (import.meta.main) process.exitCode = await main(process.argv.slice(2));
