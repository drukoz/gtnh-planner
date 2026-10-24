import { afterAll, describe, expect, it } from 'vitest';
import { mkdir, mkdtemp, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { snapshot } from '../../helpers/fake-server.ts';
import { makeJar } from '../../helpers/jar.ts';
import type { AssetPacks } from '../../../src/server/assets/index.ts';
import { gameDirOf, packChanges, packVersion, parseResourcePacks, readPackSet } from '../../../src/server/assets/resource-packs.ts';

const made: string[] = [];
async function scratch(): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), 'gp-rp-'));
  made.push(dir);
  return dir;
}
afterAll(async () => {
  await Promise.all(made.map((dir) => rm(dir, { recursive: true, force: true })));
});

describe('resource packs of a client instance', () => {
  it('parseResourcePacks', () => {
    expect(parseResourcePacks('version:0\r\nresourcePacks:["UU-Tex-main","Modernity-GTNH-Dark-UI","Modernity-GTNH-2026-08-31.zip"]\r\nlang:en_US\r\n'))
      .toEqual(['UU-Tex-main', 'Modernity-GTNH-Dark-UI', 'Modernity-GTNH-2026-08-31.zip']);
    expect(['lang:en_US', 'resourcePacks:[oops', 'resourcePacks:{}', 'resourcePacks:[]'].map(parseResourcePacks)).toEqual([[], [], [], []]);
    expect(parseResourcePacks('resourcePacks:["a",3,"b"]')).toEqual(['a', 'b']);
    // LF lines, and the game assigns line by line, so the last resourcePacks line wins
    expect(parseResourcePacks('lang:en_US\nresourcePacks:["a"]\nresourcePacks:["b","c"]\nfov:0.5\n')).toEqual(['b', 'c']);
    // only that key, on a line of its own
    expect(parseResourcePacks('xresourcePacks:["a"]\nsomeresourcePacks:["b"]\nresourcePacksX:["c"]\n')).toEqual([]);
  });

  it('packVersion', () => {
    expect(packVersion('{"pack":{"pack_format":1,"description":"UU-Tex for 2.9.X"},"gtnh_resource_pack_updater":{"pack_version":"2.0"}}')).toBe('2.0');
    expect(packVersion('\uFEFF{"pack":{"pack_format":1,"description":"§bModernity-GTNH-v1.5.6"}}')).toBe('Modernity-GTNH-v1.5.6');   // keep the escape: a literal BOM is invisible
    expect(packVersion('{"pack":{}}')).toBe('');
    expect(['{}', '{"pack":3}', 'nope', ''].map(packVersion)).toEqual([null, null, null, null]);
    // `pack` has to be a plain object; the updater's version only counts when it is a non-empty string
    expect(['{"pack":[]}', '{"pack":null}', '[]', 'null'].map(packVersion)).toEqual([null, null, null, null]);
    expect(packVersion('{"pack":{"description":"D"},"gtnh_resource_pack_updater":{"pack_version":""}}')).toBe('D');
    expect(packVersion('{"pack":{"description":"D"},"gtnh_resource_pack_updater":{"pack_version":2}}')).toBe('D');
    expect(packVersion('{"pack":{"description":"D"},"gtnh_resource_pack_updater":"2.0"}')).toBe('D');
    // a description that is not a string gives '', and every § code goes
    expect(packVersion('{"pack":{"description":{"text":"x"}}}')).toBe('');
    expect(packVersion('{"pack":{"description":" §l Bold §r§zX "}}')).toBe('Bold X');
  });

  it('gameDirOf', async () => {
    const root = await scratch();
    const inst = join(root, 'inst');
    const other = join(root, 'other');
    await mkdir(join(inst, '.minecraft'), { recursive: true });
    await writeFile(join(inst, '.minecraft', 'options.txt'), 'version:0\r\n');
    await mkdir(other);
    expect(gameDirOf(inst)).toBe(join(inst, '.minecraft'));
    expect(gameDirOf(join(inst, '.minecraft'))).toBe(join(inst, '.minecraft'));
    expect(gameDirOf(other)).toBeNull();
    expect(gameDirOf(join(root, 'nowhere'))).toBeNull();
    expect(gameDirOf(join(inst, '.minecraft', 'options.txt'))).toBeNull();   // a file is not a folder
    // minecraft/ without the dot counts, the folder itself comes first, and the options.txt has to be a file
    const plain = join(root, 'plain');
    await mkdir(join(plain, 'minecraft'), { recursive: true });
    await writeFile(join(plain, 'minecraft', 'options.txt'), '');
    expect(gameDirOf(plain)).toBe(join(plain, 'minecraft'));
    await writeFile(join(plain, 'options.txt'), '');
    expect(gameDirOf(plain)).toBe(plain);
    const hollow = join(root, 'hollow');
    await mkdir(join(hollow, 'options.txt'), { recursive: true });
    expect(gameDirOf(hollow)).toBeNull();
  });

  it('readPackSet reads the enabled packs read-only and skips the rest', async () => {
    const game = await scratch();
    const packs = join(game, 'resourcepacks');
    await writeFile(join(game, 'options.txt'), 'resourcePacks:["Folder Pack","b.zip","gone","../escape","nometa","broken.zip","nested.zip","b.zip"]\r\n');
    await mkdir(join(packs, 'Folder Pack'), { recursive: true });
    await writeFile(join(packs, 'Folder Pack', 'pack.mcmeta'), '\uFEFF{"pack":{"description":"§aF 1"}}');   // the escape, not a literal BOM
    await makeJar(join(packs, 'b.zip'), { 'pack.mcmeta': '{"pack":{"description":"B 2"}}' });
    await mkdir(join(packs, 'nometa'));
    await writeFile(join(packs, 'broken.zip'), 'not a zip');
    await makeJar(join(packs, 'nested.zip'), { 'sub/pack.mcmeta': '{"pack":{}}' });   // no top-level pack.mcmeta
    // a valid pack exactly where resourcepacks/../escape resolves, so only the name check can skip it
    await makeJar(join(game, 'escape'), { 'pack.mcmeta': '{"pack":{"description":"E"}}' });
    const before = await snapshot(game);
    const { set, skipped } = await readPackSet(game);
    expect(set.enabled).toEqual(['Folder Pack', 'b.zip', 'gone', '../escape', 'nometa', 'broken.zip', 'nested.zip', 'b.zip']);
    expect(set.packs).toEqual([
      { name: 'Folder Pack', path: join(game, 'resourcepacks', 'Folder Pack'), format: 'folder', version: 'F 1' },
      { name: 'b.zip', path: join(game, 'resourcepacks', 'b.zip'), format: 'zip', version: 'B 2' },
    ]);
    expect(skipped).toEqual([
      { name: 'gone', reason: 'not in resourcepacks/' },
      { name: '../escape', reason: 'not a pack name' },
      { name: 'nometa', reason: 'no valid pack.mcmeta (the game skips it too)' },
      { name: 'broken.zip', reason: expect.any(String) },   // yauzl's message
      { name: 'nested.zip', reason: 'no valid pack.mcmeta (the game skips it too)' },
      { name: 'b.zip', reason: 'listed twice' },
    ]);
    expect(skipped[3]!.reason).not.toBe('');
    expect(await snapshot(game)).toEqual(before);
  });

  it('readPackSet skips a pack.mcmeta that is not strict JSON with a "pack" object for its own reason, by its own rule', async () => {
    const game = await scratch();
    const packs = join(game, 'resourcepacks');
    await writeFile(join(game, 'options.txt'), 'resourcePacks:["Lenient","NoSection.zip","Listless","Bare"]\n');
    await mkdir(join(packs, 'Lenient'), { recursive: true });
    await writeFile(join(packs, 'Lenient', 'pack.mcmeta'), '{pack:{pack_format:1,description:"x"}}');   // Gson-lenient: the game applies it
    await makeJar(join(packs, 'NoSection.zip'), { 'pack.mcmeta': '{"gtnh_resource_pack_updater":{"pack_version":"2.0"}}' });   // the game applies it too
    await mkdir(join(packs, 'Listless'));
    await writeFile(join(packs, 'Listless', 'pack.mcmeta'), '[]');
    await mkdir(join(packs, 'Bare'));
    await writeFile(join(packs, 'Bare', 'pack.mcmeta'), '{"pack":{}}');   // a `pack` object is all this reader asks (the game also wants pack_format)
    const { set, skipped } = await readPackSet(game);
    const reason = 'pack.mcmeta is not strict JSON with a "pack" object';
    expect(skipped).toEqual([{ name: 'Lenient', reason }, { name: 'NoSection.zip', reason }, { name: 'Listless', reason }]);
    expect(set.packs).toEqual([{ name: 'Bare', path: join(packs, 'Bare'), format: 'folder', version: '' }]);
  });

  it('readPackSet refuses names that are not file names, and a name listed again after it was skipped', async () => {
    const game = await scratch();
    const names = ['', '.', '..', 'a/b', 'a\\b', 'ctl\u0001', 'nul\u0000', '/abs', 'gone', 'gone'];
    await writeFile(join(game, 'options.txt'), `resourcePacks:${JSON.stringify(names)}\n`);
    await mkdir(join(game, 'resourcepacks'));
    const { set, skipped } = await readPackSet(game);
    expect(set.enabled).toEqual(names);
    expect(set.packs).toEqual([]);
    expect(skipped).toEqual([
      ...names.slice(0, 8).map((name) => ({ name, reason: 'not a pack name' })),
      { name: 'gone', reason: 'not in resourcepacks/' },
      { name: 'gone', reason: 'listed twice' },
    ]);
  });

  it('readPackSet follows a link in resourcepacks/, and reads a zip whose other entries have odd names', async () => {
    const game = await scratch();
    const elsewhere = await scratch();
    const packs = join(game, 'resourcepacks');
    await writeFile(join(game, 'options.txt'), 'resourcePacks:["Odd.zip","Linked","LinkedZip.zip"]\n');
    await mkdir(join(elsewhere, 'Real'));
    await writeFile(join(elsewhere, 'Real', 'pack.mcmeta'), '{"pack":{"description":"L"},"gtnh_resource_pack_updater":{"pack_version":"3"}}');
    await mkdir(packs);
    await symlink(join(elsewhere, 'Real'), join(packs, 'Linked'));
    await makeJar(join(elsewhere, 'real.zip'), { 'pack.mcmeta': '{"pack":{"description":"Z"}}' });
    await symlink(join(elsewhere, 'real.zip'), join(packs, 'LinkedZip.zip'));
    // yauzl refuses a whole zip for one entry name with `..` or `\` unless it is told not to decode names, and
    // the pack.mcmeta is not the first entry
    await makeJar(join(packs, 'Odd.zip'), {
      'assets/x/textures/blocks/../../../evil.png': 'x', 'assets\\x\\a.png': 'y', 'Pack.mcmeta': '{"pack":{"description":"wrong case"}}',
      'pack.mcmeta': '{"pack":{"description":"O"}}',
    });
    const { set, skipped } = await readPackSet(game);
    expect(skipped).toEqual([]);
    expect(set.packs).toEqual([
      { name: 'Odd.zip', path: join(packs, 'Odd.zip'), format: 'zip', version: 'O' },
      { name: 'Linked', path: join(packs, 'Linked'), format: 'folder', version: '3' },
      { name: 'LinkedZip.zip', path: join(packs, 'LinkedZip.zip'), format: 'zip', version: 'Z' },
    ]);
  });

  it('readPackSet lets an options.txt that cannot be read through, and lists nothing for a missing line', async () => {
    const game = await scratch();
    await expect(readPackSet(game)).rejects.toThrow(/options\.txt/);
    await writeFile(join(game, 'options.txt'), 'version:0\r\nlang:en_US\r\n');
    expect(await readPackSet(game)).toEqual({ set: { enabled: [], packs: [] }, skipped: [] });
  });

  it('packChanges', () => {
    const rec = (name: string, version: string, entries = 10, bytes = 100) => ({ name, format: 'zip' as const, version, entries, bytes, files: 5 });
    const a: AssetPacks = { enabled: ['A', 'B'], read: [rec('A', '1'), rec('B', '1')] };
    expect(packChanges(undefined, undefined)).toEqual([]);
    expect(packChanges(a, a)).toEqual([]);
    expect(packChanges(undefined, a)).toEqual(['added A (1)', 'added B (1)']);
    expect(packChanges(a, undefined)).toEqual(['removed A', 'removed B']);
    expect(packChanges(a, { enabled: ['B', 'A', 'C'], read: [rec('B', '2'), rec('A', '1', 11), rec('C', 'x')] }))
      .toEqual(['B: 1 → 2', 'A: same version, different files', 'added C (x)', 'order changed, last wins: C, A, B']);
    expect(packChanges(a, { enabled: ['A'], read: [rec('A', '1')] })).toEqual(['removed B']);
    // bytes alone count, an empty version prints as it is, and a pack that was only added or removed is no reorder
    expect(packChanges(a, { enabled: ['A', 'B'], read: [rec('A', '1'), rec('B', '1', 10, 101)] })).toEqual(['B: same version, different files']);
    expect(packChanges({ enabled: ['A'], read: [rec('A', '')] }, { enabled: ['A', 'N'], read: [rec('A', ''), rec('N', '')] })).toEqual(['added N ()']);
    expect(packChanges(a, { enabled: ['A', 'C', 'B'], read: [rec('A', '1'), rec('C', '1'), rec('B', '1')] })).toEqual(['added C (1)']);
    expect(packChanges(a, { enabled: ['B', 'A'], read: [rec('B', '1'), rec('A', '1')] })).toEqual(['order changed, last wins: A, B']);
  });
});
