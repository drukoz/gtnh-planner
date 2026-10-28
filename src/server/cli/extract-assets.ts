// `npm run extract-assets -- [--server <folder>] [--client-jar <path> | --no-client] [--instance <folder> | --no-packs]`:
// copies the block and item textures of the server pack's mod jars and of the official Minecraft 1.7.10 client jar
// into `<dataDir>/assets/` (Task 3), with the resource packs enabled in the GTNH client instance over every jar
// (add-on 23). The instance is `--instance`, else `clientInstance` in the settings; `--no-packs` leaves the packs out
// for one run, and with neither the textures come from the jars alone. The server folder and the instance are only
// read. Each run lists the packs it used and what changed in them since the previous extraction. Exit 0 extracted;
// 1 the extraction failed, also when no mod jar could be read (the previous textures stay in place); 2 bad arguments
// or settings, no usable client jar, or an instance whose `options.txt` cannot be found or read. Every path is
// resolved from the working directory, which is the repo root under npm.

import { createHash } from 'node:crypto';
import { createReadStream, statSync } from 'node:fs';
import { readdir } from 'node:fs/promises';
import { homedir } from 'node:os';
import { basename, join, resolve } from 'node:path';
import { parseArgs } from 'node:util';
import { ExtractError, extractAssets, type ExtractSummary, type JarSource } from '../assets/extract.ts';
import { loadAssetIndex, type AssetPacks, type PackRecord } from '../assets/index.ts';
import { gameDirOf, packChanges, readPackSet, type PackSet, type SkippedPack } from '../assets/resource-packs.ts';
import { ConfigError, loadConfig, type AppConfig } from '../config.ts';

/** The SHA-1 of Mojang's `1.7.10.jar` client download. */
export const CLIENT_JAR_SHA1 = 'e80d9b3bf5085002218d4be59e668bac718abbc6';
/** Where the launchers keep the 1.7.10 client jar, relative to the home folder: Prism Launcher, then Mojang's own. */
export const CLIENT_JAR_CANDIDATES: readonly string[] = Object.freeze([
  'Library/Application Support/PrismLauncher/libraries/com/mojang/minecraft/1.7.10/minecraft-1.7.10-client.jar',
  'Library/Application Support/minecraft/versions/1.7.10/1.7.10.jar',
]);

const USAGE = 'Usage: npm run extract-assets -- [--server <folder>] [--client-jar <path> | --no-client] '
  + '[--instance <folder> | --no-packs]';
const NO_SERVER = 'No server folder: set "serverFolder" in data/config.json or pass --server <folder>';
const NO_CLIENT = 'No Minecraft 1.7.10 client jar found. Pass --client-jar <path> or set "clientJar" in data/config.json '
  + `(Prism Launcher keeps it at ~/${CLIENT_JAR_CANDIDATES[0]}), or use --no-client.`;
const NO_CLIENT_WARNING = 'warning: no client jar - vanilla block and item textures will be missing';
const WINNER_RULE = 'winner: mod over vanilla, then an overriding jar over the texture\'s own mod, then the last jar by name';
const PACKS_OFF = 'Resource packs: off (--no-packs)';
const NO_INSTANCE = 'No client instance set: textures from the jars only '
  + '(set "clientInstance" in data/config.json or pass --instance <folder>)';
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

/**
 * The `clientInstance` setting when it holds more than white space, else null: like an empty `clientJar`, an empty
 * value means none is set.
 */
function clientInstanceOf(c: AppConfig): string | null {
  const value = c.clientInstance;
  return typeof value === 'string' && value.trim() !== '' ? value : null;
}

class UsageError extends Error {}

interface Options { help: boolean; server?: string; clientJar?: string; noClient: boolean; instance?: string; noPacks: boolean }

function parseOptions(argv: string[]): Options {
  let values: {
    help?: boolean; server?: string; 'client-jar'?: string; 'no-client'?: boolean; instance?: string; 'no-packs'?: boolean;
  };
  try {
    ({ values } = parseArgs({
      args: argv, strict: true, allowPositionals: false,
      options: {
        help: { type: 'boolean', short: 'h' }, server: { type: 'string' }, 'client-jar': { type: 'string' },
        'no-client': { type: 'boolean' }, instance: { type: 'string' }, 'no-packs': { type: 'boolean' },
      },
    }));
  } catch (err) {
    throw new UsageError(err instanceof Error ? err.message : String(err));
  }
  for (const flag of ['server', 'client-jar', 'instance'] as const) {
    if (values[flag] !== undefined && values[flag].trim() === '') throw new UsageError(`--${flag} needs a value`);
  }
  const noClient = values['no-client'] === true;
  if (noClient && values['client-jar'] !== undefined) throw new UsageError('--client-jar and --no-client cannot be used together');
  const noPacks = values['no-packs'] === true;
  if (noPacks && values.instance !== undefined) throw new UsageError('--instance and --no-packs cannot be used together');
  return {
    help: values.help === true, server: values.server, clientJar: values['client-jar'], noClient, instance: values.instance, noPacks,
  };
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
  const packCount = s.packs?.read.length ?? 0;
  const fromPacks = packCount === 0 ? '' : ` and ${packCount} resource pack${packCount === 1 ? '' : 's'}`;
  const lines = [
    `Extracted ${s.files} textures (${(s.bytes / BYTES_PER_MB).toFixed(1)} MB) from ${s.jars} jars${fromPacks} into ${assets}`,
    `${s.identicalDuplicates} identical duplicates, ${s.conflicts.length} conflicting paths (${WINNER_RULE}):`,
    ...s.conflicts.slice(0, SHOWN_CONFLICTS).map((c) => `  ${c.path}: ${c.winner} over ${c.losers.join(', ')}`),
  ];
  if (s.conflicts.length > SHOWN_CONFLICTS) {
    lines.push(`  … ${s.conflicts.length - SHOWN_CONFLICTS} more in ${join(assets, 'index.json')}`);
  }
  return lines;
}

/** What the previous extraction's `index.json` says about its resource packs (`packs` absent: it read none). */
interface PreviousRun { createdAt: string; packs?: AssetPacks }

/** The previous extraction, read before this run replaces its index; null when there is none or it cannot be read. */
async function previousRun(dataDir: string): Promise<PreviousRun | null> {
  try {
    const file = (await loadAssetIndex(join(dataDir, 'assets'))).file;
    return file === null ? null : { createdAt: file.createdAt, packs: file.packs };
  } catch {
    return null;   // an index this version cannot read: nothing to compare the packs with
  }
}

/** `<name> (<version>)`, or the name alone when its `pack.mcmeta` gives no version. */
function packLabel(pack: PackRecord): string {
  return pack.version === '' ? pack.name : `${pack.name} (${pack.version})`;
}

/**
 * The lines about resource packs that follow the summary, each only when it applies: what the packs supplied, the zip
 * entries left out for their case, the packs read (the winner first) or why none was, and what changed in the packs
 * since the previous extraction.
 */
function packLines(s: ExtractSummary, noPacks: boolean, previous: PreviousRun | null): string[] {
  const lines: string[] = [];
  const read = s.packs?.read ?? [];
  if (read.length > 0) lines.push(`${s.packFiles} of them from resource packs (${s.packReplaced} replace a jar's texture)`);
  if (s.caseOnly > 0) lines.push(`${s.caseOnly} files of zip packs left out: their names differ from the game's only in case`);
  if (s.packs === null) {
    lines.push(noPacks ? PACKS_OFF : NO_INSTANCE);   // no instance was read
  } else if (read.length > 0) {
    lines.push(`Resource packs, first wins (as in the game's menu): ${read.toReversed().map(packLabel).join(', ')}`);
  } else {
    lines.push(s.packs.enabled.length === 0
      ? 'Resource packs: none enabled in options.txt'
      : 'Resource packs: none usable (all skipped, see warnings)');
  }
  if (previous !== null) {
    const changes = packChanges(previous.packs, s.packs ?? undefined);
    if (changes.length > 0) {
      lines.push(`Resource packs changed since the last extraction (${previous.createdAt}):`, ...changes.map((line) => `  ${line}`));
    }
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

  let packs: { set: PackSet; skipped: SkippedPack[] } | null = null;   // the client instance's, when one is read
  const instance = opts.noPacks ? null : (opts.instance ?? clientInstanceOf(config));
  if (instance !== null) {
    const folder = resolve(instance);
    let gameDir: string | null;
    try {
      gameDir = gameDirOf(folder);
    } catch (e) {
      return fail(`Cannot read ${folder}: ${messageOf(e)}`, USAGE_ERROR);   // e.g. EACCES: a folder on the way is closed to us
    }
    if (gameDir === null) return fail(`No options.txt in ${folder} or its .minecraft folder`, USAGE_ERROR);
    try {
      packs = await readPackSet(gameDir);   // reads options.txt once; a pack it cannot use is skipped, not thrown
    } catch (e) {
      return fail(`Cannot read ${join(gameDir, 'options.txt')}: ${messageOf(e)}`, USAGE_ERROR);
    }
  }

  const jars: JarSource[] = [
    ...(client === null ? [] : [{ path: client.path, kind: 'client' as const }]),
    ...(await listModJars(server)).map((path) => ({ path, kind: 'mod' as const })),
  ];
  const previous = await previousRun(config.dataDir);
  let summary: ExtractSummary;
  try {
    summary = await extractAssets({
      jars, dataDir: config.dataDir,
      ...(client === null ? {} : { clientSha1: client.sha1 }),
      ...(packs === null ? {} : { packs: packs.set }),
    });
  } catch (e) {
    if (e instanceof ExtractError) return fail(`Extraction failed; the previous textures are still in place: ${e.message}`, FAILED);
    throw e;
  }
  for (const line of summaryLines(summary, config.dataDir)) out(line);
  for (const skipped of summary.skippedJars) err(`warning: skipped ${skipped.jar}: ${skipped.error}`);
  for (const line of packLines(summary, opts.noPacks, previous)) out(line);
  for (const pack of packs?.skipped ?? []) err(`warning: resource pack ${pack.name} skipped: ${pack.reason}`);
  for (const { pack, path } of summary.notPngInPacks) {
    err(`warning: ${pack}: ${path} is not a PNG (the game may still read it); left out`);
  }
  return 0;
}

if (import.meta.main) process.exitCode = await main(process.argv.slice(2));
