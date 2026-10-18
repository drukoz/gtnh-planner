import type { ChildProcess } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { mkdir, mkdtemp, readFile, realpath, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { makeExport } from '../../helpers/make-export.ts';
import { makeFakeJava } from '../../helpers/fake-java.ts';
import { makeFakeServer, snapshot } from '../../helpers/fake-server.ts';
import { runCli } from '../../helpers/run-cli.ts';
import { sampleExportSpec } from '../../helpers/sample-export.ts';

async function setup(opts: { previous?: string; fillerMaps?: number } = {}) {
  const root = await realpath(await mkdtemp(join(tmpdir(), 'gp-export-cli-')));   // the CLI resolves paths from its real cwd
  const server = await makeFakeServer(join(root, 'GT_New_Horizons_2.9.0-RC-1_Server_Java_17-26'));
  const fixture = await makeExport(join(root, 'fixture'), { ...sampleExportSpec(), fillerMaps: opts.fillerMaps ?? 140, marker: null });
  const java = await makeFakeJava(root);
  const jar = join(root, 'gtnhplannerexport-0.1.0.jar');
  await writeFile(jar, 'jar');
  if (opts.previous) {
    await mkdir(join(root, 'data'), { recursive: true });
    await writeFile(join(root, 'data', 'config.json'), JSON.stringify({ dataDir: 'data', serverFolder: server, activeExportId: opts.previous }));
  }
  const config = async () => JSON.parse(await readFile(join(root, 'data', 'config.json'), 'utf8'));
  const run = (mode: string, extra: string[] = [], more: { env?: Record<string, string>; onSpawn?: (child: ChildProcess) => void } = {}) => runCli(
    'export', ['--server', server, '--jar', jar, '--java', java, ...extra], {
      cwd: root, timeoutMs: 30_000, onSpawn: more.onSpawn,
      env: { GTNH_PLANNER_CONFIG: undefined, FAKE_JAVA_MODE: mode, FAKE_EXPORT_SRC: fixture, FAKE_JAVA_ARGS: join(root, 'args.txt'), ...more.env },
    },
  );
  return { root, server, run, config };
}

describe('npm run export', () => {
  it('clones, runs, validates and activates the export without touching the server folder', async () => {
    const { root, server, run, config } = await setup();
    const before = await snapshot(server);
    const r = await run('ok');
    expect(r.code).toBe(0);
    const cfg = await config();
    expect(cfg.serverFolder).toBe(server);
    expect(cfg.activeExportId).toMatch(/^2\.9\.0-RC-1_\d{8}-\d{6}$/);
    expect(r.stdout).toContain(`Active export: ${cfg.activeExportId}`);
    expect(existsSync(join(root, 'data', 'export', cfg.activeExportId, 'EXPORT_OK'))).toBe(true);
    expect(existsSync(join(root, '.local', 'export-server'))).toBe(false);
    expect(existsSync(join(root, '.local', 'export.lock'))).toBe(false);
    expect(await snapshot(server)).toEqual(before);
    const args = (await readFile(join(root, 'args.txt'), 'utf8')).trim().split('\n');
    expect(args[0]).toBe(join(root, '.local', 'export-server'));
    expect(args).toEqual(expect.arrayContaining([
      '-Dfml.queryResult=confirm', `-Dgtnhplanner.exportDir=${join(root, 'data', 'export', cfg.activeExportId)}`,
      '-Dgtnhplanner.packVersion=2.9.0-RC-1', '-Xms6G', '@java9args.txt', '-jar', 'lwjgl3ify-forgePatches.jar', 'nogui',
    ]));
  });

  it('keeps the previous active export when the run fails', async () => {
    const { run, config } = await setup({ previous: 'previous' });
    const r = await run('fail');
    expect(r.code).toBe(1);
    expect(r.stdout + r.stderr).toContain('java.lang.RuntimeException: boom');
    expect((await config()).activeExportId).toBe('previous');
  });

  it('keeps the previous active export when validation fails', async () => {
    const { run, config } = await setup({ previous: 'previous', fillerMaps: 0 });
    const r = await run('ok');
    expect(r.code).toBe(1);
    expect(r.stdout + r.stderr).toContain('few-maps');
    expect((await config()).activeExportId).toBe('previous');
  });

  it('stops the export copy and cleans up when the terminal closes (SIGHUP)', async () => {
    const { root, run, config } = await setup({ previous: 'previous' });
    const pidFile = join(root, 'pids.txt');
    const pids = () => (existsSync(pidFile) ? readFileSync(pidFile, 'utf8').trim().split('\n').filter((l) => l !== '').map(Number) : []);
    const alive = (pid: number) => { try { process.kill(pid, 0); return true; } catch { return false; } };
    try {
      const r = await run('hang', [], {
        env: { FAKE_JAVA_PIDS: pidFile },
        onSpawn: (child) => {
          const poll = setInterval(() => {
            if (pids().length < 2) return;   // the fake JVM and the sleep it waits for are both running
            clearInterval(poll);
            child.kill('SIGHUP');
          }, 50);
          child.once('exit', () => clearInterval(poll));
        },
      });
      expect(r.code).toBe(130);
      expect(r.stderr).toContain('SIGHUP: stopping the export');
      expect(pids().filter(alive)).toEqual([]);
      expect(existsSync(join(root, '.local', 'export-server'))).toBe(false);
      expect(existsSync(join(root, '.local', 'export.lock'))).toBe(false);
      expect((await config()).activeExportId).toBe('previous');
    } finally {
      for (const pid of pids()) try { process.kill(pid, 'SIGKILL'); } catch { /* gone */ }
    }
  });

  it('refuses a server folder with a symbolic link out of it before the export copy starts', async () => {
    const { root, server, run, config } = await setup({ previous: 'previous' });
    const shared = join(root, 'live-config');
    await mkdir(shared);
    await symlink(shared, join(server, 'shared-config'));
    const r = await run('ok');
    expect(r.code).toBe(1);
    expect(r.stderr).toContain(`shared-config -> ${shared}`);
    expect(existsSync(join(root, 'args.txt'))).toBe(false);   // the fake JVM never started
    expect(existsSync(join(root, '.local', 'export-server'))).toBe(false);
    expect((await config()).activeExportId).toBe('previous');
  });

  it('explains how to set the server folder', async () => {
    const root = await mkdtemp(join(tmpdir(), 'gp-export-noserver-'));
    const r = await runCli('export', [], { cwd: root, env: { GTNH_PLANNER_CONFIG: undefined } });
    expect(r.code).toBe(2);
    expect(r.stderr).toContain('npm run export -- --server');
  });
});
