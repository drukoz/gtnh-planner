import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { BACKUP_MIN_AGE_MS, isCompleteZip, listCompleteBackups, openZipWorld, ZipWorldError } from '../../../src/server/world/zip.ts';
import { writeZip, zipBuffer } from '../../helpers/zip-write.ts';

const LEVEL = new Uint8Array([10, 0, 0, 1, 2, 3, 0]);
const REG = new Uint8Array(20_000).map((_, i) => i % 251);
const B1 = new Uint8Array([1]);
const ok = [{ name: 'World/level.dat', data: LEVEL }, { name: 'World/region/r.0.0.mca', data: REG }];

let dir: string;
let zipPath: string;
let noLevel: string;
beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), 'gp-zip-'));
  zipPath = join(dir, 'world.zip');
  noLevel = join(dir, 'no-level.zip');
  await writeZip(noLevel, [{ name: 'World/region/r.0.0.mca', data: REG }, { name: 'World/levelxdat', data: B1 }]);
});
afterEach(() => rm(dir, { recursive: true, force: true }));

describe('openZipWorld', () => {
  it('opens a backup zip and lists world-relative scan entries', async () => {
    await writeZip(zipPath, [{ name: 'World/level.dat', data: LEVEL }, { name: 'World/region/r.0.0.mca', data: REG },
      { name: 'World/DIM-1/region/r.-1.0.mca', data: REG }, { name: 'World/session.lock', data: B1 }, { name: 'serverutilities/a.txt', data: B1 }]);
    const w = await openZipWorld(zipPath);
    expect((await w.list()).map((e) => e.path).sort()).toEqual(['DIM-1/region/r.-1.0.mca', 'level.dat', 'region/r.0.0.mca']);
    expect(await w.read('level.dat')).toEqual(Buffer.from(LEVEL));
    expect(await w.read('session.lock')).toBeNull();
    await w.close();
  });

  it('finds the world root at any depth', async () => {
    await writeZip(zipPath, [
      { name: 'saves/My World/backup/level.dat', data: B1 },        // deeper: not the root
      { name: 'saves/My World/region/r.0.0.mca', data: REG },
      { name: 'saves/My World/level.dat', data: LEVEL },
      { name: 'saves/region/r.5.5.mca', data: REG },                 // outside the root
    ]);
    const w = await openZipWorld(zipPath);
    expect((await w.list()).map((e) => e.path).sort()).toEqual(['level.dat', 'region/r.0.0.mca']);
    expect(await w.read('level.dat')).toEqual(Buffer.from(LEVEL));
    expect(await w.read('backup/level.dat')).toBeNull();
    await w.close();

    await writeZip(zipPath, [{ name: 'level.dat', data: LEVEL }, { name: 'region/r.1.-1.mca', data: REG }]);
    const top = await openZipWorld(zipPath);
    expect((await top.list()).map((e) => e.path).sort()).toEqual(['level.dat', 'region/r.1.-1.mca']);
    await top.close();
  });

  it('throws ZipWorldError when the zip has no level.dat', async () => {
    await expect(openZipWorld(noLevel)).rejects.toThrow(ZipWorldError);
  });

  it('throws ZipWorldError for a zip without a central directory, and passes file system errors through', async () => {
    await writeZip(zipPath, ok, { truncateBytes: 100 });
    await expect(openZipWorld(zipPath)).rejects.toThrow(ZipWorldError);
    await writeFile(join(dir, 'text.zip'), 'not a zip at all');
    await expect(openZipWorld(join(dir, 'text.zip'))).rejects.toThrow(ZipWorldError);
    const missing = openZipWorld(join(dir, 'gone.zip'));
    await expect(missing).rejects.toMatchObject({ code: 'ENOENT' });
    await expect(missing).rejects.not.toBeInstanceOf(ZipWorldError);
  });

  it('reports sizes and labels, keeps scan side files and reads entries one after another', async () => {
    await writeZip(zipPath, [...ok, { name: 'World/playerdata/a.dat', data: B1 }, { name: 'World/stats/a.json', data: B1 },
      { name: 'World/data/visualprospecting.dat', data: LEVEL }, { name: 'World/data/other.dat', data: B1 }]);
    const w = await openZipWorld(zipPath, 'my backup');
    expect(w.label).toBe('my backup');
    expect((await w.list()).sort((a, b) => a.path.localeCompare(b.path))).toEqual([
      { path: 'data/visualprospecting.dat', size: LEVEL.length }, { path: 'level.dat', size: LEVEL.length },
      { path: 'playerdata/a.dat', size: 1 }, { path: 'region/r.0.0.mca', size: REG.length },
    ]);
    const [reg, level, player] = await Promise.all([w.read('region/r.0.0.mca'), w.read('level.dat'), w.read('playerdata/a.dat')]);
    expect([reg, level, player]).toEqual([Buffer.from(REG), Buffer.from(LEVEL), Buffer.from(B1)]);
    await w.close();
    const unnamed = await openZipWorld(zipPath);
    expect(unnamed.label).toBe('world.zip');
    await unnamed.close();
  });
});

describe('backups', () => {
  it('skips zips that are too new or truncated', async () => {
    const now = Date.parse('2026-10-17T12:00:00Z');
    await writeZip(join(dir, '2026-10-17-11-00-00.zip'), ok, { mtime: new Date(now - 3_600_000) });
    await writeZip(join(dir, '2026-10-17-11-30-00.zip'), ok, { mtime: new Date(now - 1_800_000) });
    await writeZip(join(dir, '2026-10-17-11-58-00.zip'), ok, { mtime: new Date(now - 60_000) });             // < 2 min old
    await writeZip(join(dir, '2026-10-17-11-45-00.zip'), ok, { mtime: new Date(now - 900_000), truncateBytes: 100 });  // no central directory
    // the beforeEach zip (no-level.zip) has a current mtime: too new for `now`
    expect(await listCompleteBackups(dir, now)).toEqual(['2026-10-17-11-30-00.zip', '2026-10-17-11-00-00.zip']);
  });

  it('accepts a zip exactly BACKUP_MIN_AGE_MS old, ignores other files and folders, and treats a missing folder as empty', async () => {
    const now = Date.parse('2026-10-17T12:00:00Z');
    expect(BACKUP_MIN_AGE_MS).toBe(120_000);
    const backups = join(dir, 'backups');
    await writeZip(join(backups, 'edge.zip'), ok, { mtime: new Date(now - BACKUP_MIN_AGE_MS) });
    await writeZip(join(backups, 'notes.txt'), ok, { mtime: new Date(now - 3_600_000) });
    await mkdir(join(backups, 'folder.zip'));
    expect(await listCompleteBackups(backups, now)).toEqual(['edge.zip']);
    expect(await listCompleteBackups(join(dir, 'nope'), now)).toEqual([]);
  });

  it('isCompleteZip opens only zips with a central directory', async () => {
    await writeFile(join(dir, 'full.zip'), zipBuffer(ok));
    await writeZip(join(dir, 'cut.zip'), ok, { truncateBytes: 100 });
    expect(await isCompleteZip(join(dir, 'full.zip'))).toBe(true);
    expect(await isCompleteZip(join(dir, 'cut.zip'))).toBe(false);
    expect(await isCompleteZip(join(dir, 'gone.zip'))).toBe(false);
  });
});
