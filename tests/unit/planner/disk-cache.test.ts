// The plan cache's store on disk (RUK-563 milestone 2): JSON values by key under one code version, at most `max` files.
import { existsSync, mkdirSync, mkdtempSync, readdirSync, rmSync, utimesSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, expect, it } from 'vitest';
import { cacheFile, codeVersion, diskCache } from '../../../src/server/planner/disk-cache.ts';

let root = '';
beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), 'disk-cache-'));
});
afterEach(() => {
  rmSync(root, { recursive: true, force: true });
});

it('gives back what was put, also to a new cache on the same folder', async () => {
  const dir = join(root, 'plans');
  const value = { status: 'ok', steps: [{ id: 'a', count: 2.5 }], names: { 'k@0': 'Thing' } };
  await diskCache(dir, { max: 4, version: 'v1' }).put('key 1', value);
  expect(await diskCache(dir, { max: 4, version: 'v1' }).get('key 1')).toEqual(value);
  expect(readdirSync(dir)).toEqual([cacheFile('v1', 'key 1')]);
});

it('a key never put is a miss', async () => {
  expect(await diskCache(join(root, 'plans'), { max: 4, version: 'v1' }).get('nothing')).toBeUndefined();
});

it('another code version reads nothing of an older one', async () => {
  const dir = join(root, 'plans');
  await diskCache(dir, { max: 4, version: 'v1' }).put('key', { a: 1 });
  expect(await diskCache(dir, { max: 4, version: 'v1' }).get('key')).toEqual({ a: 1 });
  expect(await diskCache(dir, { max: 4, version: 'v2' }).get('key')).toBeUndefined();
});

it('keeps at most max files, dropping the least recently used', async () => {
  const dir = join(root, 'plans');
  const cache = diskCache(dir, { max: 2, version: 'v1' });
  await cache.put('a', 1);
  await cache.put('b', 2);
  utimesSync(join(dir, cacheFile('v1', 'a')), new Date('2020-01-01'), new Date('2020-01-01'));
  utimesSync(join(dir, cacheFile('v1', 'b')), new Date('2020-01-02'), new Date('2020-01-02'));
  expect(await cache.get('a')).toBe(1);   // a is now the most recently used
  await cache.put('c', 3);
  expect(readdirSync(dir).sort()).toEqual([cacheFile('v1', 'a'), cacheFile('v1', 'c')].sort());
  expect(await cache.get('b')).toBeUndefined();
  expect(await cache.get('c')).toBe(3);
});

it('a damaged file is a miss and is removed', async () => {
  const dir = join(root, 'plans');
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, cacheFile('v1', 'key')), 'not gzip');
  expect(await diskCache(dir, { max: 4, version: 'v1' }).get('key')).toBeUndefined();
  expect(existsSync(join(dir, cacheFile('v1', 'key')))).toBe(false);
});

it('a folder it cannot make fails no caller', async () => {
  const file = join(root, 'a-file');
  writeFileSync(file, 'x');
  const cache = diskCache(join(file, 'plans'), { max: 4, version: 'v1' });   // no folder can be made under a file
  await expect(cache.put('key', 1)).resolves.toBeUndefined();
  expect(await cache.get('key')).toBeUndefined();
});

it('codeVersion follows the .ts files under src/server and src/shared and package-lock.json, and nothing else', () => {
  const write = (path: string, text: string): void => {
    mkdirSync(join(root, path, '..'), { recursive: true });
    writeFileSync(join(root, path), text);
  };
  write('src/server/a.ts', 'export const a = 1;\n');
  write('src/shared/b/c.ts', 'export const c = 2;\n');
  write('package-lock.json', '{}\n');
  const first = codeVersion(root);
  expect(first).toMatch(/^[0-9a-f]{64}$/);
  expect(codeVersion(root)).toBe(first);
  write('src/server/notes.md', 'not code');
  write('src/client/d.ts', 'export const d = 3;\n');
  expect(codeVersion(root)).toBe(first);
  write('src/shared/b/c.ts', 'export const c = 3;\n');
  const second = codeVersion(root);
  expect(second).not.toBe(first);
  write('package-lock.json', '{"x":1}\n');
  expect(codeVersion(root)).not.toBe(second);
});
