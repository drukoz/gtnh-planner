import { mkdtemp, readdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, beforeEach, expect, it } from 'vitest';
import { runScanCli } from '../../../src/server/cli/scan.ts';
import type { WorldConfig } from '../../../src/server/world/sources.ts';
import type { Base } from '../../../src/shared/types/world.ts';
import { SAMPLE, SAMPLE_BACKUP, makeSampleWorld } from '../../helpers/sample-world.ts';
import { testFacts } from '../../helpers/world-facts.ts';

// io collects stdout/stderr into strings; config points at the sample server (its backup SAMPLE_BACKUP is 10 minutes old).

let tmp: string, config: WorldConfig;
let io: { config: WorldConfig; facts: () => Promise<ReturnType<typeof testFacts>>; stdout: (s: string) => void; stderr: (s: string) => void; out: string; err: string };

beforeAll(async () => {
  tmp = await mkdtemp(join(tmpdir(), 'gp-scan-cli-'));
  const { serverDir } = await makeSampleWorld(join(tmp, 'srv'));
  config = { dataDir: join(tmp, 'data'), serverFolder: serverDir };
});
afterAll(() => rm(tmp, { recursive: true, force: true }));
beforeEach(() => {
  io = {
    config, facts: async () => testFacts(), out: '', err: '',
    stdout: (s) => { io.out += s; },
    stderr: (s) => { io.err += s; },
  };
});

it('prints the scan as JSON and exits 0', { timeout: 60_000 }, async () => {
  expect(await runScanCli(['--json'], io)).toBe(0);
  expect(JSON.parse(io.out).bases.map((b: Base) => b.id)).toEqual(SAMPLE.baseIds);
});

it('prints progress on stderr and a summary per base and power network on stdout', { timeout: 60_000 }, async () => {
  // the sample scans faster than the progress poll; slow pack facts keep it 'running' / 'Starting' for a few polls
  const slow = { ...io, facts: async () => { await new Promise((r) => setTimeout(r, 300)); return testFacts(); } };
  expect(await runScanCli(['--backup', SAMPLE_BACKUP], slow)).toBe(0);
  const lines = io.err.split('\n');
  expect(lines[0]).toBe('[  0%] Starting');
  expect(lines.at(-1)).toBe('');
  expect(lines.slice(0, -1).every((l) => /^\[[ \d]{2}\d%\] \S/.test(l))).toBe(true);
  expect(new Set(lines).size).toBe(lines.length);   // a line is printed only when it changes
  expect(io.out.split('\n')).toEqual([
    'Done: 2 bases, 10 machines',
    'Alpha base (4, 5): 6 machines, top tier 1',
    'Nether base (-4, -2): 4 machines, top tier 2',
    expect.stringMatching(/^Power p:0:1:64:0 \(Alpha base \(4, 5\)\): 7\.04\/[\d.]+\/[\d.]+ EU\/t clear\/rain\/average, 101000 EU stored$/),
    '',
  ]);
});

it('exits 1 with a message when the backup is unknown', async () => {
  expect(await runScanCli(['--backup', 'nope.zip'], io)).toBe(1);
  expect(io.err).toContain('nope.zip');
  expect(io.out).toBe('');
});

it('exits 1 when the scan fails', async () => {
  expect(await runScanCli(['--upload', 'a'.repeat(32)], io)).toBe(1);   // no such upload
  expect(io.err).toContain('Unknown upload');
  const failing = { ...io, facts: async () => { throw new Error('No export is active'); } };
  expect(await runScanCli([], failing)).toBe(1);
  expect(io.err).toContain('Scan failed: No export is active');
  expect(io.out).toBe('');
});

it.each([
  [['--frobnicate']], [['--backup']], [['--backup', 'a.zip', '--upload', 'b'.repeat(32)]], [['extra']],
])('exits 1 with the usage for %j', async (argv) => {
  const before = await readdir(join(tmp, 'data', 'scans'));
  expect(await runScanCli(argv, io)).toBe(1);
  expect(io.err).toContain('Usage: npm run scan -- [--backup <file> | --upload <uploadId>] [--json]');
  expect(await readdir(join(tmp, 'data', 'scans'))).toEqual(before);   // nothing was started
});
