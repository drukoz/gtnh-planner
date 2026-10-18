// `npm run export -- [--server <folder>] [--pack-version <v>] [--jar <path>] [--java <path>] [--timeout-min <n>]
// [--keep-clone] [--skip-sections <a,b>]`: exports the pack from an APFS clone of the server folder (never the folder
// itself) into a new `data/export/<exportId>/` and makes it the active export once it passes validation.
// Exit 0 activated; 1 the export or its validation failed (the previous export stays active); 2 bad arguments or
// settings; 130 interrupted. Every path is resolved from the working directory, which is the repo root under npm.

import { spawn } from 'node:child_process';
import { readFileSync, statSync } from 'node:fs';
import { mkdir, rm } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { parseArgs } from 'node:util';
import { ConfigError, exportDirFor, loadConfig, saveConfig, type AppConfig } from '../config.ts';
import { cloneServer } from '../export/clone.ts';
import {
  EXPORT_PROPERTIES, configureClone, detectPackVersion, findStartScript, makeExportId, readStartArgs,
} from '../export/configure.ts';
import { EXPORT_TIMEOUT_MS, LockHeldError, acquireLock, assertPortFree, exportJvmArgs, runExport, type RunResult } from '../export/run.ts';
import { exportFailureLines, validateExport } from '../export/validate.ts';
import { MARKER_OK } from '../pack/format.ts';

const USAGE = 'Usage: npm run export -- [--server <folder>] [--pack-version <v>] [--jar <path>] [--java <path>] '
  + '[--timeout-min <n>] [--keep-clone] [--skip-sections <a,b>]';
const NO_SERVER = 'Tell me where your GTNH server folder is once: npm run export -- --server "<path>"';
/** The export copy's own address, as its server.properties sets it (25566 on 127.0.0.1). */
const EXPORT_PORT = Number(EXPORT_PROPERTIES['server-port']);
const EXPORT_HOST = EXPORT_PROPERTIES['server-ip']!;
const CLONE_DIR = '.local/export-server';
const LOCK_FILE = '.local/export.lock';
const GRADLE_HOME = '.local/gradle-home';
const EXPORTER_DIR = 'exporter-mod';

const FAILED = 1;
const USAGE_ERROR = 2;
const INTERRUPTED = 130;

/** A failure with the message to print and the exit code. */
class CliError extends Error {
  readonly code: number;

  constructor(message: string, code: number) {
    super(message);
    this.name = 'CliError';
    this.code = code;
  }
}

interface Options {
  help: boolean; server?: string; packVersion?: string; jar?: string; java: string; timeoutMin: number; keepClone: boolean;
  skipSections: string[];
}

function parseOptions(argv: string[]): Options {
  let values: {
    help?: boolean; server?: string; 'pack-version'?: string; jar?: string; java?: string; 'timeout-min'?: string;
    'keep-clone'?: boolean; 'skip-sections'?: string;
  };
  try {
    ({ values } = parseArgs({
      args: argv, strict: true, allowPositionals: false,
      options: {
        help: { type: 'boolean', short: 'h' }, server: { type: 'string' }, 'pack-version': { type: 'string' },
        jar: { type: 'string' }, java: { type: 'string' }, 'timeout-min': { type: 'string' },
        'keep-clone': { type: 'boolean' }, 'skip-sections': { type: 'string' },
      },
    }));
  } catch (err) {
    throw new CliError(err instanceof Error ? err.message : String(err), USAGE_ERROR);
  }
  for (const flag of ['server', 'pack-version', 'jar', 'java', 'skip-sections'] as const) {
    if (values[flag] !== undefined && values[flag].trim() === '') throw new CliError(`--${flag} needs a value`, USAGE_ERROR);
  }
  const timeout = values['timeout-min'];
  if (timeout !== undefined && !(/^\d+(\.\d+)?$/.test(timeout) && Number(timeout) > 0)) {
    throw new CliError(`--timeout-min must be a number of minutes above 0, got "${timeout}"`, USAGE_ERROR);
  }
  const skipSections = (values['skip-sections'] ?? '').split(',').map((s) => s.trim()).filter((s) => s !== '');
  const java = values.java ?? 'java';
  return {
    help: values.help === true, server: values.server, packVersion: values['pack-version'], jar: values.jar,
    java: java.includes('/') ? resolve(java) : java,   // the JVM starts in the clone, so a relative path is made absolute
    timeoutMin: timeout === undefined ? EXPORT_TIMEOUT_MS / 60_000 : Number(timeout),
    keepClone: values['keep-clone'] === true, skipSections,
  };
}

const say = (line: string) => process.stdout.write(`${line}\n`);
const tell = (text: string) => process.stderr.write(`${text}\n`);
const isFolder = (path: string) => statSync(path, { throwIfNoEntry: false })?.isDirectory() === true;
const isFile = (path: string) => statSync(path, { throwIfNoEntry: false })?.isFile() === true;

function checkInterrupted(signal: AbortSignal): void {
  if (signal.aborted) throw new CliError('Interrupted.', INTERRUPTED);
}

/** Step 1: the server folder from `--server` (remembered in the settings) or from the settings. */
function serverFolderOf(opts: Options, cfg: AppConfig): { folder: string; cfg: AppConfig } {
  const given = opts.server ?? cfg.serverFolder;
  if (given === null) throw new CliError(NO_SERVER, USAGE_ERROR);
  const folder = resolve(given);
  if (!isFolder(folder)) {
    throw new CliError(`The server folder ${folder} does not exist or is not a folder. ${NO_SERVER}`, USAGE_ERROR);
  }
  if (opts.server === undefined || cfg.serverFolder === folder) {
    say(`Server folder: ${folder}`);
    return { folder, cfg };
  }
  const saved = { ...cfg, serverFolder: folder };
  saveConfig(saved);
  say(`Server folder: ${folder} (remembered for the next export)`);
  return { folder, cfg: saved };
}

function packageVersion(): string {
  const file = resolve('package.json');
  let version: unknown;
  try {
    version = (JSON.parse(readFileSync(file, 'utf8')) as { version?: unknown }).version;
  } catch (err) {
    throw new CliError(`cannot read the version from ${file} (${err instanceof Error ? err.message : String(err)}); `
      + 'run the export from the repo root or pass --jar', USAGE_ERROR);
  }
  if (typeof version !== 'string' || !/^[\w.+-]+$/.test(version)) throw new CliError(`${file} has no usable version`, USAGE_ERROR);
  return version;
}

/** `./gradlew assemble` in exporter-mod with the repo's own Gradle home; output goes straight to the terminal. */
function buildExporter(version: string, signal: AbortSignal): Promise<void> {
  const cwd = resolve(EXPORTER_DIR);
  if (!isFile(join(cwd, 'gradlew'))) {
    return Promise.reject(new CliError(`${cwd}/gradlew is missing; run the export from the repo root or pass --jar`, USAGE_ERROR));
  }
  return new Promise((done, fail) => {
    const child = spawn('./gradlew', ['assemble'], {
      cwd, env: { ...process.env, GRADLE_USER_HOME: resolve(GRADLE_HOME), VERSION: version }, stdio: 'inherit', signal,
    });
    child.once('error', (err) => {
      fail(signal.aborted ? new CliError('Interrupted during the exporter build.', INTERRUPTED)
        : new CliError(`could not run ./gradlew in ${cwd}: ${err.message}`, FAILED));
    });
    child.once('exit', (code, sig) => {
      if (code === 0) done();
      else fail(new CliError(`the exporter build failed (${code === null ? `signal ${sig}` : `exit code ${code}`}); see the Gradle output above`, FAILED));
    });
  });
}

/** Step 3: `--jar`, else the jar `./gradlew assemble` builds for the package version. */
async function exporterJar(opts: Options, signal: AbortSignal): Promise<string> {
  if (opts.jar !== undefined) {
    const jar = resolve(opts.jar);
    if (!isFile(jar)) throw new CliError(`--jar ${jar} is not a file`, USAGE_ERROR);
    say(`Exporter jar: ${jar}`);
    return jar;
  }
  const version = packageVersion();
  const jar = resolve(EXPORTER_DIR, 'build', 'libs', `gtnhplannerexport-${version}.jar`);
  say(`Building the exporter jar ${jar} (./gradlew assemble, VERSION=${version})`);
  await buildExporter(version, signal);
  if (!isFile(jar)) throw new CliError(`the exporter build finished, but ${jar} is missing`, FAILED);
  return jar;
}

/** Step 5: a new, empty export folder named by the pack version and the time. */
async function newExportDir(cfg: AppConfig, serverFolder: string, opts: Options): Promise<{ exportId: string; exportDir: string; packVersion: string }> {
  const packVersion = opts.packVersion ?? detectPackVersion(serverFolder) ?? 'unknown';
  const exportId = makeExportId(packVersion, new Date());
  const exportDir = exportDirFor(cfg, exportId);
  await mkdir(dirname(exportDir), { recursive: true });
  try {
    await mkdir(exportDir);   // not recursive: an existing folder is an error, so an older export is never written into
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code !== 'EEXIST') throw err;
    throw new CliError(`${exportDir} already exists; run the export again in a second`, FAILED);
  }
  say(`Export ${exportId} (pack version ${packVersion}) goes to ${exportDir}`);
  return { exportId, exportDir, packVersion };
}

/** Step 8: why the run did not produce a usable export, with the end of its log. */
async function runFailure(r: RunResult, o: { exportDir: string; logFile: string; timeoutMin: number; interrupted: boolean }): Promise<CliError> {
  const lines: string[] = [];
  if (o.interrupted || r.aborted) lines.push('Interrupted: the export server copy was stopped.');
  else if (r.timedOut) lines.push(`No ${MARKER_OK} after ${o.timeoutMin} minutes: the export server copy was stopped.`);
  else if (r.marker === 'EXPORT_FAILED') {
    lines.push('The exporter failed:', ...((await exportFailureLines(o.exportDir)) ?? []).map((line) => `  ${line}`));
  } else {
    lines.push(`The export server copy stopped without finishing the export (${r.exitCode === null ? 'ended by a signal' : `exit code ${r.exitCode}`}).`);
  }
  if (r.logTail !== '') lines.push(`Last lines of ${o.logFile}:`, r.logTail);
  return new CliError(lines.join('\n'), o.interrupted || r.aborted ? INTERRUPTED : FAILED);
}

/** Steps 3–10, with the lock held. Returns once the new export is active; throws for every other outcome. */
async function exportAndActivate(opts: Options, cfg: AppConfig, serverFolder: string, signal: AbortSignal, onClone: (dir: string) => void): Promise<void> {
  const jar = await exporterJar(opts, signal);
  checkInterrupted(signal);

  await assertPortFree(EXPORT_PORT, EXPORT_HOST);   // before anything is cloned
  say(`Port ${EXPORT_PORT} on ${EXPORT_HOST} is free`);

  const { exportId, exportDir, packVersion } = await newExportDir(cfg, serverFolder, opts);
  checkInterrupted(signal);

  say(`Cloning the server folder into ${CLONE_DIR} (no world, backups, logs or player files)`);
  const clone = (await cloneServer({ source: serverFolder, target: resolve(CLONE_DIR), root: process.cwd() })).target;
  onClone(clone);
  await configureClone(clone, { jar });
  checkInterrupted(signal);

  const startArgs = readStartArgs(readFileSync(findStartScript(serverFolder), 'utf8'));   // the server folder's own script
  const args = exportJvmArgs(startArgs, { exportDir, packVersion, skipSections: opts.skipSections });
  const logFile = join(exportDir, 'export-run.log');
  say(`Running the export server copy on ${EXPORT_HOST}:${EXPORT_PORT} (stopped after ${opts.timeoutMin} min without ${MARKER_OK}; log ${logFile})`);
  const result = await runExport({
    cloneDir: clone, java: opts.java, args, exportDir, logFile, timeoutMs: opts.timeoutMin * 60_000, signal,
  });
  // An interrupt that arrived while the copy was being stopped for another reason still counts as an interrupt.
  if (!result.ok || signal.aborted) {
    throw await runFailure(result, { exportDir, logFile, timeoutMin: opts.timeoutMin, interrupted: signal.aborted });
  }
  say(`Exported in ${Math.round(result.durationMs / 1000)} s${result.killedAfterMarker ? ' (the copy did not exit by itself and was stopped)' : ''}`);

  const report = await validateExport(exportDir);
  const errors = report.issues.filter((i) => i.level === 'error').length;
  say(`Checks: ${errors} error${errors === 1 ? '' : 's'}, ${report.issues.length - errors} warning${report.issues.length - errors === 1 ? '' : 's'}`);
  for (const issue of report.issues) say(`${issue.level} ${issue.code}: ${issue.text}`);
  if (!report.ok) throw new CliError(`The export in ${exportDir} failed its checks and was not activated.`, FAILED);
  checkInterrupted(signal);   // the last moment an interrupt keeps the previous export

  saveConfig({ ...loadConfig(), activeExportId: exportId });   // reread, so settings changed meanwhile survive
  say(`Active export: ${exportId}`);
  say(report.summary);
}

/** Steps 1, 2 and 11 around `exportAndActivate`; prints every failure and returns the exit code. */
async function exportPack(opts: Options, signal: AbortSignal): Promise<number> {
  const exitCode = (err: unknown) => {
    if (signal.aborted) return INTERRUPTED;
    if (err instanceof CliError) return err.code;
    return err instanceof ConfigError ? USAGE_ERROR : FAILED;
  };
  const fail = (err: unknown) => {
    tell(err instanceof Error ? err.message : String(err));
    return exitCode(err);
  };

  let cfg: AppConfig;
  let serverFolder: string;
  let release: () => void;
  try {
    ({ folder: serverFolder, cfg } = serverFolderOf(opts, loadConfig()));
    release = acquireLock(resolve(LOCK_FILE));
  } catch (err) {
    if (err instanceof LockHeldError) return fail(new CliError(`Cannot start: ${err.message}. Wait for it to finish.`, FAILED));
    return fail(err);
  }
  say(`Holding the export lock ${LOCK_FILE}`);

  const made: { clone: string | null } = { clone: null };   // set once cloneServer made it; only that folder is removed
  try {
    await exportAndActivate(opts, cfg, serverFolder, signal, (dir) => { made.clone = dir; });
    return 0;
  } catch (err) {
    const code = fail(err);
    tell(cfg.activeExportId === null ? 'No export is active yet.' : `The active export is still ${cfg.activeExportId}.`);
    return code;
  } finally {
    const { clone } = made;
    if (clone !== null && opts.keepClone) say(`Kept the clone in ${CLONE_DIR} (--keep-clone)`);
    else if (clone !== null) {
      try {
        await rm(clone, { recursive: true, force: true });
        say(`Removed the clone ${CLONE_DIR}`);
      } catch (err) {
        tell(`Could not remove the clone ${clone}: ${err instanceof Error ? err.message : String(err)}`);
      }
    }
    release();
  }
}

export async function main(argv: string[]): Promise<number> {
  let opts: Options;
  try {
    opts = parseOptions(argv);
  } catch (err) {
    if (err instanceof CliError) {
      tell(`${err.message}\n${USAGE}`);
      return err.code;
    }
    throw err;
  }
  if (opts.help) {
    say(USAGE);
    return 0;
  }
  // Ctrl-C or SIGTERM stops the export copy (its whole process group) instead of leaving it running.
  const interrupt = new AbortController();
  const onSignal = (signal: NodeJS.Signals) => {
    if (!interrupt.signal.aborted) tell(`${signal}: stopping the export…`);
    interrupt.abort();
  };
  // A closed output pipe (`npm run export | head`) must not end the process before the copy is stopped and cleaned up.
  const ignore = () => {};
  process.stdout.on('error', ignore);
  process.stderr.on('error', ignore);
  process.on('SIGINT', onSignal);
  process.on('SIGTERM', onSignal);
  try {
    return await exportPack(opts, interrupt.signal);
  } finally {
    process.off('SIGINT', onSignal);
    process.off('SIGTERM', onSignal);
  }
}

if (import.meta.main) process.exitCode = await main(process.argv.slice(2));
