import { chmod, mkdir, mkdtemp, readdir, readFile, rm, stat, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Readable } from 'node:stream';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { isScanPath, openDirWorld } from '../../../src/server/world/files.ts';
import {
  completeUpload, copyServerSideFiles, createUpload, isUploadId, listSources, openResolved, resolveSource, serverLayout, SourceError,
  storeUploadFile, UPLOAD_LIMITS, uploadKind, type WorldConfig,
} from '../../../src/server/world/sources.ts';
import { writeZip } from '../../helpers/zip-write.ts';

const NOW = Date.parse('2026-10-17T12:00:00Z');
const LEVEL = Buffer.from([10, 0, 0, 4, 5, 6, 0]);
const REG = Buffer.alloc(9000, 3);
const B1 = Buffer.from([1]);
const BACKUP = '2026-10-17-11-00-00.zip';

let root: string, srv: string, srvNoBackups: string, dataDir: string, scanDir: string;
const cfgWith = (serverFolder: string | null): WorldConfig => ({ dataDir, serverFolder });
const filesOf = (uploadId: string) => join(dataDir, 'uploads', uploadId, 'files');
const uploadMeta = async (uploadId: string): Promise<unknown> => JSON.parse(await readFile(join(dataDir, 'uploads', uploadId, 'upload.json'), 'utf8'));

/** Every file and folder below `dir`, relative and sorted; [] when `dir` does not exist. */
async function listTree(dir: string): Promise<string[]> {
  return (await readdir(dir, { recursive: true }).catch(() => [] as string[])).sort();
}

/** `[relative path, mtimeMs]` of `dir` itself ('') and of everything below it. */
async function treeWithMtimes(dir: string): Promise<Array<[string, number]>> {
  const out: Array<[string, number]> = [];
  for (const rel of ['', ...await listTree(dir)]) out.push([rel, (await stat(join(dir, rel))).mtimeMs]);
  return out;
}

async function chmodTree(dir: string, mode: 'read-only' | 'writable'): Promise<void> {
  for (const rel of ['', ...await listTree(dir)]) {
    const path = join(dir, rel);
    const isDir = (await stat(path)).isDirectory();
    await chmod(path, mode === 'read-only' ? (isDir ? 0o555 : 0o444) : (isDir ? 0o755 : 0o644));
  }
}

async function makeServer(dir: string, withBackups: boolean): Promise<void> {
  await mkdir(join(dir, 'World', 'region'), { recursive: true });
  await writeFile(join(dir, 'server.properties'), '#Minecraft server properties\nserver-port=25565\nlevel-name=World\nmotd=A Server\n');
  await writeFile(join(dir, 'World', 'level.dat'), LEVEL);
  await writeFile(join(dir, 'World', 'region', 'r.0.0.mca'), REG);
  await writeFile(join(dir, 'World', 'session.lock'), B1);
  if (!withBackups) return;
  const entries = [{ name: 'World/level.dat', data: LEVEL }, { name: 'World/region/r.0.0.mca', data: REG }];
  await writeZip(join(dir, 'backups', BACKUP), entries, { mtime: new Date(NOW - 3_600_000) });
  await writeZip(join(dir, 'backups', 'fresh.zip'), entries, { mtime: new Date(NOW - 60_000) });
}

beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), 'gp-sources-'));
  srv = join(root, 'srv');
  srvNoBackups = join(root, 'srv-no-backups');
  dataDir = join(root, 'data');
  scanDir = join(dataDir, 'scans', 'scan-1');
  await makeServer(srv, true);
  await makeServer(srvNoBackups, false);
});
afterEach(async () => {
  await chmodTree(srv, 'writable').catch(() => {});
  await rm(root, { recursive: true, force: true });
});

describe('world files', () => {
  it('isScanPath accepts only the files a scan reads', () => {
    for (const p of ['level.dat', 'region/r.0.0.mca', 'DIM-1/region/r.-1.0.mca', 'DIM7/region/r.3.-4.mca', 'playerdata/a-b.dat',
      'serverutilities/teams/claimedchunks/team.dat', 'gtnhteams/team.json', 'betterquesting/QuestProgress/q.json', 'data/visualprospecting.dat'])
      expect(isScanPath(p), p).toBe(true);
    for (const p of ['session.lock', 'level.dat_old', 'World/level.dat', '/level.dat', 'Region/r.0.0.mca', 'DIM0/region/r.0.0.mca',
      'region/r.0.0.mca.tmp', 'playerdata/a.dat.tmp', 'playerdata/x/a.dat', 'playerdata/.dat', 'playerdata\\a.dat', 'gtnhteams/a.dat',
      'serverutilities/teams/a.dat', 'betterquesting/QuestProgress/../q.json', 'data/other.dat', 'stats/a.json', 'level.dat\0', ''])
      expect(isScanPath(p), JSON.stringify(p)).toBe(false);
  });

  it('openDirWorld lists only scan paths and reads only listed files', async () => {
    const w = join(root, 'w');
    const files: Record<string, Buffer> = {
      'level.dat': LEVEL, 'region/r.0.0.mca': REG, 'region/r.0.0.mca.tmp': B1, 'DIM-1/region/r.-1.0.mca': REG, 'DIM-1/data/x.dat': B1,
      'playerdata/p.dat': B1, 'playerdata/p.dat.tmp': B1, 'serverutilities/teams/claimedchunks/t.dat': B1, 'gtnhteams/t.json': B1,
      'betterquesting/QuestProgress/q.json': B1, 'data/visualprospecting.dat': B1, 'data/other.dat': B1, 'session.lock': B1, 'stats/x.json': B1,
    };
    for (const [rel, data] of Object.entries(files)) {
      await mkdir(join(w, rel, '..'), { recursive: true });
      await writeFile(join(w, rel), data);
    }
    await symlink(join(srv, 'server.properties'), join(w, 'region', 'r.1.0.mca'));   // a link out of the world is never listed
    const world = await openDirWorld(w, 'test world');
    expect(world.label).toBe('test world');
    expect(await world.list()).toEqual([
      { path: 'DIM-1/region/r.-1.0.mca', size: REG.length }, { path: 'betterquesting/QuestProgress/q.json', size: 1 },
      { path: 'data/visualprospecting.dat', size: 1 }, { path: 'gtnhteams/t.json', size: 1 }, { path: 'level.dat', size: LEVEL.length },
      { path: 'playerdata/p.dat', size: 1 }, { path: 'region/r.0.0.mca', size: REG.length },
      { path: 'serverutilities/teams/claimedchunks/t.dat', size: 1 },
    ]);
    expect(await world.read('level.dat')).toEqual(LEVEL);
    for (const rel of ['session.lock', 'data/other.dat', 'region/r.1.0.mca', '../srv/server.properties', 'region/../level.dat'])
      expect(await world.read(rel), rel).toBeNull();
    await world.close();
    expect((await openDirWorld(w)).label).toBe('w');
  });

  it('openDirWorld passes file system errors through', async () => {
    await expect(openDirWorld(join(root, 'missing'))).rejects.toMatchObject({ code: 'ENOENT' });
  });
});

describe('server folder sources', () => {
  it('reads the world folder name from server.properties', async () => {
    expect(serverLayout(srv)).toEqual({ serverDir: srv, worldDir: join(srv, 'World'), backupsDir: join(srv, 'backups') });
    await writeFile(join(srv, 'server.properties'), '# comment\n! level-name=Not This\n  level-name = My\\ W\\u00f6rld\\:2\r\nmotd=x\n');
    expect(serverLayout(srv).worldDir).toBe(join(srv, 'My Wörld:2'));
    await writeFile(join(srv, 'server.properties'), 'level-name:First\nlevel-name Second\n');
    expect(serverLayout(srv).worldDir).toBe(join(srv, 'Second'));
    for (const text of ['motd=x\n', 'level-name=\n']) {
      await writeFile(join(srv, 'server.properties'), text);
      expect(serverLayout(srv).worldDir).toBe(join(srv, 'World'));
    }
    expect(serverLayout(join(root, 'none'))).toEqual({ serverDir: join(root, 'none'), worldDir: join(root, 'none', 'World'), backupsDir: join(root, 'none', 'backups') });
  });

  it('lists server availability and complete backups', async () => {
    expect(await listSources(cfgWith(srv), NOW)).toEqual({ server: true, backups: [BACKUP] });
    expect(await listSources(cfgWith(null), NOW)).toEqual({ server: false, backups: [] });
    expect(await listSources(cfgWith(srvNoBackups), NOW)).toEqual({ server: true, backups: [] });
    await mkdir(join(root, 'empty'));
    expect(await listSources(cfgWith(join(root, 'empty')), NOW)).toEqual({ server: false, backups: [] });
    expect(await listSources(cfgWith(join(root, 'missing')), NOW)).toEqual({ server: false, backups: [] });
  });

  it('resolves {kind: server} to the newest complete backup, else a snapshot', async () => {
    expect(await resolveSource(cfgWith(srv), { kind: 'server' }, NOW)).toMatchObject({ kind: 'zip', path: join(srv, 'backups', BACKUP) });
    expect(await resolveSource(cfgWith(srvNoBackups), { kind: 'server' }, NOW)).toMatchObject({ kind: 'snapshot', worldDir: join(srvNoBackups, 'World') });
  });

  it('resolves a listed backup by name', async () => {
    expect(await resolveSource(cfgWith(srv), { kind: 'backup', file: BACKUP }, NOW)).toEqual({ kind: 'zip', path: join(srv, 'backups', BACKUP), label: `backup ${BACKUP}` });
  });

  it.each(['../../etc/passwd', 'fresh.zip', 'missing.zip', 'a/b.zip'])('refuses backup %s with 400', async (file) => {
    await expect(resolveSource(cfgWith(srv), { kind: 'backup', file }, NOW)).rejects.toMatchObject({ status: 400 });
  });

  it('refuses server sources when there is no usable server folder', async () => {
    await expect(resolveSource(cfgWith(null), { kind: 'server' }, NOW)).rejects.toBeInstanceOf(SourceError);
    await expect(resolveSource(cfgWith(null), { kind: 'server' }, NOW)).rejects.toMatchObject({ status: 400 });
    await expect(resolveSource(cfgWith(null), { kind: 'backup', file: BACKUP }, NOW)).rejects.toMatchObject({ status: 400 });
    await mkdir(join(root, 'empty'));
    await expect(resolveSource(cfgWith(join(root, 'empty')), { kind: 'server' }, NOW)).rejects.toMatchObject({ status: 400 });
  });

  it('snapshot copies never write into the server folder', async () => {
    const before = await treeWithMtimes(srv);
    await chmodTree(srv, 'read-only');                         // a write would now fail with EACCES
    const w = await openResolved({ kind: 'snapshot', worldDir: join(srv, 'World'), label: 'snapshot' }, scanDir);
    expect((await w.list()).map((e) => e.path).sort()).toEqual(['level.dat', 'region/r.0.0.mca']);
    await chmodTree(srv, 'writable');
    expect(await treeWithMtimes(srv)).toEqual(before);
    expect(w.label).toBe('snapshot');
    expect(await w.read('region/r.0.0.mca')).toEqual(REG);
    expect(await listTree(join(scanDir, 'snapshot'))).toEqual(['level.dat', 'region', 'region/r.0.0.mca']);
    await w.close();
  });

  it('opens backup zips and upload folders as they are', async () => {
    const zip = await openResolved(await resolveSource(cfgWith(srv), { kind: 'server' }, NOW), scanDir);
    expect((await zip.list()).map((e) => e.path).sort()).toEqual(['level.dat', 'region/r.0.0.mca']);
    expect(await zip.read('level.dat')).toEqual(LEVEL);
    await zip.close();
    const dir = await openResolved({ kind: 'dir', path: join(srvNoBackups, 'World'), label: 'folder' }, scanDir);
    expect((await dir.list()).map((e) => e.path).sort()).toEqual(['level.dat', 'region/r.0.0.mca']);
    await dir.close();
    expect(await listTree(scanDir)).toEqual([]);                // neither copies anything
  });

  it('copies the VisualProspecting cache of this world and the drawer config into side/', async () => {
    const vp = join(srv, 'visualprospecting', 'server');
    await mkdir(join(vp, 'World_a'), { recursive: true });
    await mkdir(join(vp, 'World_b'), { recursive: true });
    await writeFile(join(vp, 'World_a', 'DIM0.dat'), LEVEL);
    await writeFile(join(vp, 'World_a', 'DIM-1.dat'), B1);
    await writeFile(join(vp, 'World_a', 'notes.txt'), B1);
    await writeFile(join(vp, 'World_b', 'DIM7.dat'), B1);           // another world that once ran here
    await mkdir(join(srv, 'config'));
    await writeFile(join(srv, 'config', 'StorageDrawers.cfg'), 'controller {\n    I:range=4\n}\n');
    const before = await treeWithMtimes(srv);
    await chmodTree(srv, 'read-only');

    const side = join(scanDir, 'side');
    expect(await copyServerSideFiles(srv, 'World_a', scanDir)).toEqual({ vpDir: join(side, 'visualprospecting'), drawersCfg: join(side, 'StorageDrawers.cfg') });
    expect(await listTree(join(side, 'visualprospecting'))).toEqual(['DIM-1.dat', 'DIM0.dat']);
    expect(await readFile(join(side, 'visualprospecting', 'DIM0.dat'))).toEqual(LEVEL);
    expect(await readFile(join(side, 'StorageDrawers.cfg'), 'utf8')).toContain('I:range=4');

    const other = join(dataDir, 'scans', 'scan-2');
    expect(await copyServerSideFiles(srv, null, other)).toEqual({ vpDir: null, drawersCfg: join(other, 'side', 'StorageDrawers.cfg') });
    for (const worldId of ['x/../World_a', '..', '', 'World_c'])
      expect((await copyServerSideFiles(srv, worldId, join(dataDir, 'scans', `scan-3${worldId.length}`))).vpDir, worldId).toBeNull();
    await chmodTree(srv, 'writable');
    expect(await treeWithMtimes(srv)).toEqual(before);
    expect(await copyServerSideFiles(srvNoBackups, 'World_a', join(dataDir, 'scans', 'scan-4'))).toEqual({ vpDir: null, drawersCfg: null });
  });
});

describe('uploads', () => {
  it('creates an upload folder with its record', async () => {
    const id = await createUpload(dataDir, 'Ann');
    expect(isUploadId(id)).toBe(true);
    expect(await createUpload(dataDir, null)).not.toBe(id);
    expect(await uploadMeta(id)).toEqual({ createdAt: expect.stringMatching(/^\d{4}-\d\d-\d\dT/), by: 'Ann', complete: false, files: 0, bytes: 0 });
    expect(await listTree(join(dataDir, 'uploads', id))).toEqual(['files', 'upload.json']);
  });

  it('knows upload kinds and ids', () => {
    expect([uploadKind('level.dat'), uploadKind('region/r.0.0.mca'), uploadKind('DIM7/region/r.-1.3.mca'), uploadKind('world.zip'), uploadKind('DIM0/region/r.0.0.mca')])
      .toEqual(['level', 'region', 'region', null, null]);
    expect([isUploadId('0123456789abcdef0123456789abcdef'), isUploadId('0123456789ABCDEF0123456789abcdef'), isUploadId('../x'), isUploadId('f'.repeat(33))])
      .toEqual([true, false, false, false]);
    expect(UPLOAD_LIMITS).toEqual({ levelDat: 32 * 1024 ** 2, region: 128 * 1024 ** 2, files: 4096, total: 8 * 1024 ** 3 });
  });

  it.each<[string, 204 | 400]>([
    ['level.dat', 204], ['region/r.0.0.mca', 204], ['DIM-1/region/r.-1.2.mca', 204], ['world.zip', 400],
    ['../level.dat', 400], ['/level.dat', 400], ['Region/r.0.0.mca', 400], ['DIM-1/r.0.0.mca', 400], ['region/../level.dat', 400],
    ['region/r.0.0.mca/x', 400], ['playerdata/a.dat', 400], ['region\\r.0.0.mca', 400], ['level.dat\0', 400],
  ])('upload path %s → %i', async (rel, status) => {
    const id = await createUpload(dataDir, 'Ann');
    const r = storeUploadFile(dataDir, id, rel, Readable.from([Buffer.from('x')]), 1);
    if (status === 204) await expect(r).resolves.toBeUndefined(); else await expect(r).rejects.toMatchObject({ status });
    expect(await listTree(join(dataDir, 'uploads'))).not.toContain('..');
    const parts = rel.split('/');
    expect(await listTree(filesOf(id))).toEqual(status === 204 ? parts.map((_, i) => parts.slice(0, i + 1).join('/')) : []);
    if (status === 204) expect(await readFile(join(filesOf(id), rel), 'utf8')).toBe('x');
  });

  it('enforces size and count limits and leaves no partial file', async () => {
    const id = await createUpload(dataDir, null);
    const limits = { ...UPLOAD_LIMITS, region: 1000, files: 2 };
    await expect(storeUploadFile(dataDir, id, 'region/r.0.0.mca', Readable.from([Buffer.alloc(1001)]), null, limits)).rejects.toMatchObject({ status: 413 });
    await expect(storeUploadFile(dataDir, id, 'region/r.0.0.mca', Readable.from([Buffer.alloc(10)]), 5000, limits)).rejects.toMatchObject({ status: 413 });   // declared length checked first
    expect((await readdir(join(dataDir, 'uploads', id, 'files', 'region')).catch(() => []))).toEqual([]);
    // two small files accepted, the third → 413
    await storeUploadFile(dataDir, id, 'level.dat', Readable.from([B1]), 1, limits);
    await storeUploadFile(dataDir, id, 'region/r.0.0.mca', Readable.from([Buffer.alloc(1000)]), 1000, limits);
    await expect(storeUploadFile(dataDir, id, 'region/r.1.0.mca', Readable.from([B1]), 1, limits)).rejects.toMatchObject({ status: 413 });
    expect(await listTree(filesOf(id))).toEqual(['level.dat', 'region', 'region/r.0.0.mca']);
    expect(await uploadMeta(id)).toMatchObject({ complete: false, files: 2, bytes: 1001 });
  });

  it('enforces the total size and counts a re-sent file once', async () => {
    const id = await createUpload(dataDir, null);
    const limits = { ...UPLOAD_LIMITS, total: 10 };
    await storeUploadFile(dataDir, id, 'level.dat', Readable.from([Buffer.alloc(6)]), 6, limits);
    await expect(storeUploadFile(dataDir, id, 'region/r.0.0.mca', Readable.from([Buffer.alloc(5)]), 5, limits)).rejects.toMatchObject({ status: 413 });
    await expect(storeUploadFile(dataDir, id, 'region/r.0.0.mca', Readable.from([Buffer.alloc(5)]), null, limits)).rejects.toMatchObject({ status: 413 });
    await storeUploadFile(dataDir, id, 'level.dat', Readable.from([Buffer.alloc(9)]), 9, limits);    // replaces the 6 bytes
    expect(await uploadMeta(id)).toMatchObject({ files: 1, bytes: 9 });
    await storeUploadFile(dataDir, id, 'region/r.0.0.mca', Readable.from([B1]), 1, limits);
    expect(await uploadMeta(id)).toMatchObject({ files: 2, bytes: 10 });
    expect(await listTree(filesOf(id))).toEqual(['level.dat', 'region', 'region/r.0.0.mca']);
  });

  it('counts files sent at the same time against the limits', async () => {
    const id = await createUpload(dataDir, null);
    const limits = { ...UPLOAD_LIMITS, files: 2 };
    const results = await Promise.allSettled(['region/r.0.0.mca', 'region/r.1.0.mca', 'region/r.2.0.mca']
      .map((rel) => storeUploadFile(dataDir, id, rel, Readable.from([Buffer.alloc(4)]), 4, limits)));
    expect(results.map((r) => r.status).sort()).toEqual(['fulfilled', 'fulfilled', 'rejected']);
    expect(results.find((r): r is PromiseRejectedResult => r.status === 'rejected')!.reason).toMatchObject({ status: 413 });
    expect(await uploadMeta(id)).toMatchObject({ files: 2, bytes: 8 });
    expect(await readdir(join(filesOf(id), 'region'))).toHaveLength(2);
  });

  it('refuses a body that does not match its declared length or fails, and leaves no partial file', async () => {
    const id = await createUpload(dataDir, null);
    await expect(storeUploadFile(dataDir, id, 'level.dat', Readable.from([Buffer.alloc(3)]), 5)).rejects.toMatchObject({ status: 400 });
    await expect(storeUploadFile(dataDir, id, 'level.dat', Readable.from([Buffer.alloc(3)]), 2)).rejects.toMatchObject({ status: 400 });
    const failing = new Readable({ read() { this.push(Buffer.alloc(10)); this.destroy(new Error('client went away')); } });
    await expect(storeUploadFile(dataDir, id, 'region/r.0.0.mca', failing, null)).rejects.toThrow('client went away');
    expect(await listTree(filesOf(id))).toEqual(['region']);
    expect(await uploadMeta(id)).toMatchObject({ files: 0, bytes: 0 });
  });

  it('completes only uploads with level.dat; refuses writes after completion', async () => {
    const empty = await createUpload(dataDir, null);
    const withLevel = await createUpload(dataDir, 'Ann');
    await storeUploadFile(dataDir, withLevel, 'level.dat', Readable.from([LEVEL]), LEVEL.length);
    await expect(completeUpload(dataDir, empty)).rejects.toMatchObject({ status: 400, message: 'level.dat is missing' });
    expect(await completeUpload(dataDir, withLevel)).toEqual({ kind: 'upload', uploadId: withLevel });
    await expect(storeUploadFile(dataDir, withLevel, 'region/r.0.0.mca', Readable.from([B1]), 1)).rejects.toMatchObject({ status: 409 });
    await expect(storeUploadFile(dataDir, 'f'.repeat(32), 'level.dat', Readable.from([B1]), 1)).rejects.toMatchObject({ status: 404 });
    expect(await uploadMeta(withLevel)).toEqual({ createdAt: expect.any(String), by: 'Ann', complete: true, files: 1, bytes: LEVEL.length });
    expect(await completeUpload(dataDir, withLevel)).toEqual({ kind: 'upload', uploadId: withLevel });   // repeating it is harmless
    for (const bad of ['f'.repeat(32), '../uploads'])
      await expect(completeUpload(dataDir, bad)).rejects.toMatchObject({ status: 404 });
    await expect(storeUploadFile(dataDir, '../uploads', 'level.dat', Readable.from([B1]), 1)).rejects.toMatchObject({ status: 404 });
  });

  it('resolves only completed uploads, as their files folder', async () => {
    const id = await createUpload(dataDir, null);
    await storeUploadFile(dataDir, id, 'level.dat', Readable.from([LEVEL]), LEVEL.length);
    await storeUploadFile(dataDir, id, 'DIM-1/region/r.0.0.mca', Readable.from([REG]), REG.length);
    await expect(resolveSource(cfgWith(null), { kind: 'upload', uploadId: id }, NOW)).rejects.toMatchObject({ status: 409 });
    await completeUpload(dataDir, id);
    const src = await resolveSource(cfgWith(null), { kind: 'upload', uploadId: id }, NOW);
    expect(src).toMatchObject({ kind: 'dir', path: filesOf(id) });
    const w = await openResolved(src, scanDir);
    expect((await w.list()).map((e) => e.path).sort()).toEqual(['DIM-1/region/r.0.0.mca', 'level.dat']);
    expect(await w.read('level.dat')).toEqual(LEVEL);
    await w.close();
    for (const uploadId of ['f'.repeat(32), '../x', 'F'.repeat(32)])
      await expect(resolveSource(cfgWith(null), { kind: 'upload', uploadId }, NOW)).rejects.toMatchObject({ status: 400 });
  });
});
