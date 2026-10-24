import { mkdtempSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { afterEach, expect, it } from 'vitest';
import { ConfigError, DEFAULT_CONFIG, NoActiveExportError, activeExportDir, configPath, loadConfig, saveConfig } from '../../../src/server/config.ts';

const file = () => join(mkdtempSync(join(tmpdir(), 'gp-config-')), 'data', 'config.json');
afterEach(() => { delete process.env.GTNH_PLANNER_CONFIG; });

it('returns defaults when the file does not exist', () => {
  expect(loadConfig(file())).toEqual({ dataDir: 'data', serverFolder: null, activeExportId: null,
    port: 8765, host: '0.0.0.0', passwordHash: '', sessionSecret: '', clientJar: null });
});

it('round-trips, keeps unknown keys, writes mode 0600 and a trailing newline', () => {
  const f = file();
  saveConfig({ ...DEFAULT_CONFIG, serverFolder: '/srv/gtnh' }, f);
  writeFileSync(f, JSON.stringify({ ...JSON.parse(readFileSync(f, 'utf8')), passwordHash: 'scrypt$x', futureKey: 'kept' }));
  saveConfig({ ...loadConfig(f), activeExportId: 'abc' }, f);
  const text = readFileSync(f, 'utf8');
  expect(JSON.parse(text)).toEqual({ dataDir: 'data', serverFolder: '/srv/gtnh', activeExportId: 'abc', passwordHash: 'scrypt$x',
    futureKey: 'kept', port: 8765, host: '0.0.0.0', sessionSecret: '', clientJar: null });
  expect(text.endsWith('\n')).toBe(true);
  expect(statSync(f).mode & 0o777).toBe(0o600);
});

it('refuses a damaged file and leaves it untouched', () => {
  const f = file();
  saveConfig({ ...DEFAULT_CONFIG }, f);
  writeFileSync(f, '{oops');
  expect(() => loadConfig(f)).toThrow(ConfigError);
  expect(() => loadConfig(f)).toThrow(f);
  expect(readFileSync(f, 'utf8')).toBe('{oops');
});

it('checks clientInstance when present', () => {
  const f = file();
  saveConfig({ ...DEFAULT_CONFIG }, f);
  writeFileSync(f, JSON.stringify({ dataDir: 'd', clientInstance: 5 }));
  expect(() => loadConfig(f)).toThrow(/clientInstance must be a string or null/);
  writeFileSync(f, JSON.stringify({ dataDir: 'd', clientInstance: '/x/inst' }));
  expect(loadConfig(f).clientInstance).toBe('/x/inst');
});

it('keeps a null clientInstance (unset)', () => {
  const f = file();
  saveConfig({ ...DEFAULT_CONFIG, clientInstance: null }, f);
  expect(loadConfig(f).clientInstance).toBeNull();
});

it('resolves the active export directory', () => {
  expect(activeExportDir({ ...DEFAULT_CONFIG, activeExportId: 'abc' })).toBe(resolve('data/export/abc'));
  expect(() => activeExportDir({ ...DEFAULT_CONFIG })).toThrow(NoActiveExportError);
  expect(() => activeExportDir({ ...DEFAULT_CONFIG })).toThrow('No active export. Run `npm run export` first.');
});

it('honors GTNH_PLANNER_CONFIG', () => {
  process.env.GTNH_PLANNER_CONFIG = '/tmp/x/config.json';
  expect(configPath()).toBe('/tmp/x/config.json');
});
