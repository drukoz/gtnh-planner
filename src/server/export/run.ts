// Runs the export JVM on the server clone (export-mod.md §5.3–§5.6): under `nice`, as its own process group, with the
// EXPORT_OK / EXPORT_FAILED marker as the completion signal and a watchdog for a run that never finishes or never
// exits. Also the guards the export CLI checks before it clones anything: a free port and a single-export lock.

import { spawn, type ChildProcess } from 'node:child_process';
import { once } from 'node:events';
import { closeSync, existsSync, mkdirSync, openSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { mkdir, open } from 'node:fs/promises';
import { createServer } from 'node:net';
import { dirname, join, resolve } from 'node:path';
import { setTimeout as sleep } from 'node:timers/promises';

/** Boot plus export of a fresh world; no marker by then counts as a failure (export-mod.md §5.4). */
export const EXPORT_TIMEOUT_MS = 15 * 60_000;
/** A JVM still alive this long after its marker is killed (export-mod.md §5.6). */
export const LINGER_GRACE_MS = 2 * 60_000;
/** How long a process group gets between SIGTERM and SIGKILL. */
export const KILL_WAIT_MS = 10_000;

const POLL_MS = 1000;
const NICE = 10;
const TAIL_LINES = 40;
/** The log tail is taken from at most this many bytes at the end of the log. */
const TAIL_BYTES = 256 * 1024;
const GROUP_POLL_MS = 50;
const LOCK_ATTEMPTS = 3;

type Marker = 'EXPORT_OK' | 'EXPORT_FAILED';
/** EXPORT_FAILED first: if both markers ever exist, the run did not succeed. */
const MARKERS: readonly Marker[] = ['EXPORT_FAILED', 'EXPORT_OK'];

/** Something already listens on the export copy's port. */
export class PortBusyError extends Error {
  constructor(message: string, options?: ErrorOptions) {
    super(message, options);
    this.name = 'PortBusyError';
  }
}

/** Another live process holds the export lock. */
export class LockHeldError extends Error {
  constructor(message: string, options?: ErrorOptions) {
    super(message, options);
    this.name = 'LockHeldError';
  }
}

/** Resolves when `host:port` can be bound (it binds a server there and closes it again); EADDRINUSE → `PortBusyError`. */
export function assertPortFree(port: number, host: string): Promise<void> {
  return new Promise((done, fail) => {
    const server = createServer();
    server.once('error', (err: NodeJS.ErrnoException) => {
      fail(err.code === 'EADDRINUSE'
        ? new PortBusyError(`Port ${port} on ${host} is in use — is another export running?`, { cause: err })
        : err);
    });
    server.listen(port, host, () => server.close((err) => (err ? fail(err) : done())));
  });
}

function processAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch (err) {
    return (err as NodeJS.ErrnoException).code === 'EPERM';   // it exists, but belongs to someone else
  }
}

/** The pid a lock file names, or null when the file is gone or names none. */
function lockOwner(file: string): number | null {
  let text: string;
  try {
    text = readFileSync(file, 'utf8');
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === 'ENOENT') return null;
    throw err;
  }
  const pid = Number(text.trim());
  return Number.isInteger(pid) && pid > 0 ? pid : null;
}

/**
 * Takes the lock `file` (its parent is created if needed) by creating it exclusively with this process's pid. A file
 * whose pid is alive (this process included) → `LockHeldError`; a file whose owner is gone, or that names no pid, is
 * replaced. Returns `release()`, which removes the file if it still names this process; calling it again does nothing.
 */
export function acquireLock(file: string): () => void {
  mkdirSync(dirname(file), { recursive: true });
  for (let attempt = 1; ; attempt++) {
    try {
      writeFileSync(file, `${process.pid}\n`, { flag: 'wx' });
      break;
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code !== 'EEXIST') throw err;
    }
    const owner = lockOwner(file);
    if ((owner !== null && processAlive(owner)) || attempt === LOCK_ATTEMPTS) {
      throw new LockHeldError(`another export is running (pid ${owner ?? 'unknown'})`);
    }
    rmSync(file, { force: true });   // a dead owner's lock
  }
  let held = true;
  return () => {
    if (!held) return;
    held = false;
    if (lockOwner(file) === process.pid) rmSync(file, { force: true });
  };
}

/**
 * The JVM arguments of an export run: `-Dfml.queryResult=confirm` (answers FML's startup queries, export-mod.md §5.7),
 * the export folder (made absolute, so the JVM in the clone and this process name the same folder), the pack version and,
 * when non-empty, the sections to skip, all in front of the start script's arguments (JVM options precede `-jar`).
 */
export function exportJvmArgs(
  startArgs: readonly string[],
  o: { exportDir: string; packVersion: string; skipSections?: readonly string[] },
): string[] {
  const props = [
    '-Dfml.queryResult=confirm', `-Dgtnhplanner.exportDir=${resolve(o.exportDir)}`, `-Dgtnhplanner.packVersion=${o.packVersion}`,
  ];
  if (o.skipSections !== undefined && o.skipSections.length > 0) props.push(`-Dgtnhplanner.skipSections=${o.skipSections.join(',')}`);
  return [...props, ...startArgs];
}

export interface RunOptions {
  /** The working folder of the JVM: the server clone. */
  cloneDir: string;
  /** The java executable (a path, or a name looked up on PATH). */
  java: string;
  /** Every argument after the java executable, usually `exportJvmArgs(…)`. */
  args: readonly string[];
  /** Where the markers appear: the folder the args name as `-Dgtnhplanner.exportDir`. */
  exportDir: string;
  /** Receives the JVM's stdout and stderr (truncated first; its folder is created if needed). */
  logFile: string;
  env?: NodeJS.ProcessEnv;
  /** No marker after this long → the run is stopped (default `EXPORT_TIMEOUT_MS`). */
  timeoutMs?: number;
  /** A JVM still alive this long after its marker is stopped (default `LINGER_GRACE_MS`). */
  graceMs?: number;
  /** How often the export folder is checked for a marker (default 1000). */
  pollMs?: number;
  /** The `nice` increment (default 10), so the live server keeps the CPU. */
  nice?: number;
  /** Aborting stops the run. */
  signal?: AbortSignal;
}

export interface RunResult {
  /** The run exported successfully: `marker === 'EXPORT_OK' && !aborted`. */
  ok: boolean;
  marker: Marker | null;
  /** The JVM's exit code; null when a signal ended it. */
  exitCode: number | null;
  /** Stopped because no marker appeared within `timeoutMs`. */
  timedOut: boolean;
  /** Stopped because `signal` was aborted. */
  aborted: boolean;
  /** Stopped because the JVM was still alive `graceMs` after its marker. */
  killedAfterMarker: boolean;
  durationMs: number;
  pid: number;
  /** The last 40 lines of the log. */
  logTail: string;
}

function readMarker(exportDir: string): Marker | null {
  return MARKERS.find((m) => existsSync(join(exportDir, m))) ?? null;
}

/** Whether the process group still has a member; EPERM means only unreaped zombies (macOS) or foreign processes are left. */
function groupAlive(pgid: number): boolean {
  try {
    process.kill(-pgid, 0);
    return true;
  } catch (err) {
    return (err as NodeJS.ErrnoException).code === 'EPERM';
  }
}

function signalGroup(pgid: number, signal: NodeJS.Signals): void {
  try {
    process.kill(-pgid, signal);
  } catch (err) {
    const code = (err as NodeJS.ErrnoException).code;
    if (code !== 'ESRCH' && code !== 'EPERM') throw err;
  }
}

async function groupGoneWithin(pgid: number, ms: number): Promise<boolean> {
  const deadline = Date.now() + ms;
  while (groupAlive(pgid)) {
    if (Date.now() >= deadline) return false;
    await sleep(GROUP_POLL_MS);
  }
  return true;
}

/** SIGTERM to the whole process group, SIGKILL after `KILL_WAIT_MS` if any member is left; resolves once it is gone. */
async function stopGroup(pgid: number): Promise<void> {
  signalGroup(pgid, 'SIGTERM');
  if (await groupGoneWithin(pgid, KILL_WAIT_MS)) return;
  signalGroup(pgid, 'SIGKILL');
  await groupGoneWithin(pgid, KILL_WAIT_MS);
}

/** The last `lines` lines of `file` ('' when it is gone). */
async function readTail(file: string, lines: number): Promise<string> {
  let handle;
  try {
    handle = await open(file, 'r');
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === 'ENOENT') return '';
    throw err;
  }
  try {
    const { size } = await handle.stat();
    const start = Math.max(0, size - TAIL_BYTES);
    const { buffer, bytesRead } = await handle.read(Buffer.alloc(size - start), 0, size - start, start);
    let text = buffer.subarray(0, bytesRead).toString('utf8');
    if (start > 0) text = text.slice(text.indexOf('\n') + 1);   // drop the partial first line
    const all = text.split('\n');
    if (all.at(-1) === '') all.pop();
    return all.slice(-lines).join('\n');
  } finally {
    await handle.close();
  }
}

/**
 * Starts `nice -n <nice> <java> ...args` in `cloneDir` as the leader of a new process group (stdout and stderr to
 * `logFile`) and checks `exportDir` every `pollMs` for a marker. After a marker it waits up to `graceMs` for the exit,
 * then stops the group (`killedAfterMarker`); without a marker it stops the group at `timeoutMs` (`timedOut`); an
 * aborted `signal` stops it at any time (`aborted`). Stopping = SIGTERM to the group, SIGKILL after `KILL_WAIT_MS`.
 * Resolves once the JVM has exited and nothing of its process group is left; rejects if the process cannot be started
 * or `exportDir` already holds a marker (it would pass for this run's).
 */
export async function runExport(o: RunOptions): Promise<RunResult> {
  const started = performance.now();
  const exportDir = resolve(o.exportDir);
  const stale = readMarker(exportDir);
  if (stale !== null) throw new Error(`${exportDir} already holds ${stale} from an earlier run; export into an empty folder`);
  await mkdir(dirname(o.logFile), { recursive: true });
  const log = openSync(o.logFile, 'w');
  let child: ChildProcess;
  try {
    // `detached` makes the JVM a process-group leader, so the whole group (with anything it starts) can be stopped.
    child = spawn('nice', ['-n', String(o.nice ?? NICE), o.java, ...o.args], {
      cwd: o.cloneDir, env: o.env, detached: true, stdio: ['ignore', log, log],
    });
  } finally {
    closeSync(log);   // the child has its own copy
  }
  const exited = new Promise<number | null>((done) => child.once('exit', (code) => done(code)));
  try {
    await once(child, 'spawn');
  } catch (err) {   // Node words a missing cwd as "spawn nice ENOENT"
    throw new Error(`could not start ${o.java} under nice in ${o.cloneDir}: ${(err as Error).message}`, { cause: err });
  }
  const pid = child.pid as number;

  let marker: Marker | null = null;
  let timedOut = false;
  let aborted = false;
  let killedAfterMarker = false;
  let stopping: Promise<void> | null = null;
  let poller: NodeJS.Timeout | undefined;
  let watchdog: NodeJS.Timeout | undefined;
  let grace: NodeJS.Timeout | undefined;

  const stopTimers = () => {
    clearInterval(poller);
    clearTimeout(watchdog);
    clearTimeout(grace);
  };
  const findMarker = () => (marker ??= readMarker(exportDir));
  /** Stops the group once; `reason` records why, but only for the first stop. */
  const stop = (reason: () => void) => {
    if (stopping !== null) return;
    reason();
    stopTimers();
    stopping = stopGroup(pid);
  };
  const afterMarker = () => {
    clearInterval(poller);
    clearTimeout(watchdog);
    grace ??= setTimeout(() => stop(() => { killedAfterMarker = true; }), o.graceMs ?? LINGER_GRACE_MS);
  };
  const onAbort = () => stop(() => { aborted = true; });

  poller = setInterval(() => {
    if (findMarker() !== null) afterMarker();
  }, o.pollMs ?? POLL_MS);
  watchdog = setTimeout(() => {
    if (findMarker() !== null) afterMarker();
    else stop(() => { timedOut = true; });
  }, o.timeoutMs ?? EXPORT_TIMEOUT_MS);
  if (o.signal?.aborted) onAbort();
  else o.signal?.addEventListener('abort', onAbort, { once: true });

  const exitCode = await exited;
  stopTimers();
  o.signal?.removeEventListener('abort', onAbort);
  if (!timedOut) findMarker();   // a marker written just before a normal exit, between two polls
  // After a normal exit, anything the JVM started and left behind in its group is stopped too.
  await (stopping ?? (groupAlive(pid) ? stopGroup(pid) : undefined));

  return {
    ok: marker === 'EXPORT_OK' && !aborted,
    marker,
    exitCode,
    timedOut,
    aborted,
    killedAfterMarker,
    durationMs: Math.round(performance.now() - started),
    pid,
    logTail: await readTail(o.logFile, TAIL_LINES),
  };
}
