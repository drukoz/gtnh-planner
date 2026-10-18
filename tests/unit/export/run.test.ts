import { mkdtemp, readFile, realpath, writeFile } from 'node:fs/promises';
import { createServer } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  LockHeldError, PortBusyError, acquireLock, assertPortFree, exportJvmArgs, runExport, type RunOptions,
} from '../../../src/server/export/run.ts';
import { makeFakeJava } from '../../helpers/fake-java.ts';

async function setup(mode: string, extra: Partial<RunOptions> = {}) {
  const dir = await mkdtemp(join(tmpdir(), 'gp-run-'));
  const java = await makeFakeJava(dir);
  const exportDir = join(dir, 'export', 'x');
  const pids = join(dir, 'pids.txt');
  const argsFile = join(dir, 'args.txt');
  const opts: RunOptions = {
    cloneDir: dir, java, exportDir, logFile: join(dir, 'run.log'), pollMs: 50, graceMs: 300, timeoutMs: 1500,
    args: [`-Dgtnhplanner.exportDir=${exportDir}`, '-jar', 'server.jar', 'nogui'],
    env: { ...process.env, FAKE_JAVA_MODE: mode, FAKE_JAVA_PIDS: pids, FAKE_JAVA_ARGS: argsFile }, ...extra,
  };
  return { dir, opts, pids, argsFile };
}
const alive = (pid: number) => { try { process.kill(pid, 0); return true; } catch { return false; } };
const allDead = async (pids: string) => (await readFile(pids, 'utf8')).trim().split('\n').map(Number).every((p) => !alive(p));

describe('runExport', () => {
  it('succeeds when the JVM writes EXPORT_OK and exits 0, running under nice in the clone folder', async () => {
    const { dir, opts, argsFile } = await setup('ok');
    const r = await runExport(opts);
    expect(r).toMatchObject({ ok: true, marker: 'EXPORT_OK', exitCode: 0, timedOut: false, aborted: false });
    const lines = (await readFile(argsFile, 'utf8')).trim().split('\n');
    expect(lines[0]).toBe(await realpath(dir));
    expect(lines[1]).toBe('nice=10');
    expect(lines.slice(2)).toEqual([...opts.args]);
    expect(await readFile(opts.logFile, 'utf8')).toContain('fake server starting');
  });

  it('reports EXPORT_FAILED and a crash without a marker', async () => {
    const failed = await runExport((await setup('fail')).opts);
    expect(failed).toMatchObject({ ok: false, marker: 'EXPORT_FAILED' });
    const crashed = await runExport((await setup('crash')).opts);
    expect(crashed).toMatchObject({ ok: false, marker: null, exitCode: 1 });
    expect(crashed.logTail).toContain('Exception in thread "main"');
  });

  it('kills the whole process group on timeout', async () => {
    const { opts, pids } = await setup('hang');
    const r = await runExport(opts);
    expect(r).toMatchObject({ ok: false, timedOut: true, marker: null });
    expect(await allDead(pids)).toBe(true);
  });

  it('kills a JVM that lingers after EXPORT_OK and still succeeds', async () => {
    const { opts, pids } = await setup('linger');
    const r = await runExport(opts);
    expect(r).toMatchObject({ ok: true, marker: 'EXPORT_OK', killedAfterMarker: true });
    expect(await allDead(pids)).toBe(true);
  });

  it('stops the JVM when aborted', async () => {
    const ac = new AbortController();
    const { opts, pids } = await setup('hang', { timeoutMs: 60_000 });
    setTimeout(() => ac.abort(), 300);
    const r = await runExport({ ...opts, signal: ac.signal });
    expect(r).toMatchObject({ ok: false, aborted: true });
    expect(await allDead(pids)).toBe(true);
  });
});

describe('guards', () => {
  it('rejects a busy port', async () => {
    const server = createServer();
    await new Promise<void>((res) => server.listen(0, '127.0.0.1', res));
    const port = (server.address() as { port: number }).port;
    await expect(assertPortFree(port, '127.0.0.1')).rejects.toThrow(PortBusyError);
    await new Promise<void>((res) => server.close(() => res()));
    await expect(assertPortFree(port, '127.0.0.1')).resolves.toBeUndefined();
  });

  it('refuses a second export while the lock is held and takes over a dead owner', async () => {
    const file = join(await mkdtemp(join(tmpdir(), 'gp-lock-')), 'export.lock');
    const release = acquireLock(file);
    expect(() => acquireLock(file)).toThrow(LockHeldError);
    release();
    acquireLock(file)();
    await writeFile(file, '999999');
    expect(() => acquireLock(file)).not.toThrow();
  });

  it('puts the export properties in front of the start-script arguments', () => {
    expect(exportJvmArgs(['-Xmx6G', '@java9args.txt', '-jar', 'lwjgl3ify-forgePatches.jar', 'nogui'],
      { exportDir: '/abs/data/export/id', packVersion: '2.9.0-RC-1', skipSections: ['structures'] })).toEqual([
      '-Dfml.queryResult=confirm', '-Dgtnhplanner.exportDir=/abs/data/export/id', '-Dgtnhplanner.packVersion=2.9.0-RC-1',
      '-Dgtnhplanner.skipSections=structures', '-Xmx6G', '@java9args.txt', '-jar', 'lwjgl3ify-forgePatches.jar', 'nogui',
    ]);
  });
});
