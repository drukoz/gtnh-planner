import { describe, it, expect, vi } from 'vitest';
import { chmod, mkdtemp, mkdir, readFile, readdir, stat, symlink, writeFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { crc32 } from 'node:zlib';
import { snapshot } from '../../helpers/fake-server.ts';
import { makeJar } from '../../helpers/jar.ts';
import { makePng } from '../../helpers/png.ts';
import { extractAssets, textureEntry, pickWinner, ExtractError, folderEntry, scanFolderPack, copyFromFolder } from '../../../src/server/assets/extract.ts';
import type { PackSet } from '../../../src/server/assets/resource-packs.ts';

const RED = makePng(16, 16, [255, 0, 0, 255]);
const BLUE = makePng(16, 16, [0, 0, 255, 255]);
const GREY = makePng(16, 16, [128, 128, 128, 255]);
const GREEN = makePng(16, 16, [0, 255, 0, 255]);
const P = (dir: string, rel: string) => join(dir, 'assets', rel);

async function pack() {
  const dir = await mkdtemp(join(tmpdir(), 'gp-ex-'));
  const jars = join(dir, 'jars');
  await mkdir(jars);
  const client = await makeJar(join(jars, 'minecraft-1.7.10-client.jar'), {
    'assets/minecraft/textures/blocks/stone.png': GREY, 'assets/minecraft/textures/blocks/sponge.png': RED,
    'assets/minecraft/textures/items/apple.png': RED, 'assets/minecraft/lang/en_US.lang': 'x=y', 'net/minecraft/client/Main.class': 'cafebabe' });
  const gt = await makeJar(join(jars, 'gregtech-5.09.54.183.jar'), {
    'assets/gregtech/textures/blocks/iconsets/MACHINE_LV_SIDE.png': GREY,
    'assets/gregtech/textures/blocks/iconsets/OVERLAY_ACCELERATOR.png': RED,
    'assets/gregtech/textures/blocks/fluids/fluid.water.png': makePng(16, 64, [40, 60, 200, 255]),
    'assets/gregtech/textures/blocks/fluids/fluid.water.png.mcmeta': '{"animation":{"frametime":2}}',
    'assets/gregtech/textures/items/gt.metaitem.01/606.png': GREY,
    'assets/gregtech/textures/gui/background.png': GREY,
    'assets/x/textures/blocks/../../../../evil.png': RED });
  const core = await makeJar(join(jars, 'GTNewHorizonsCoreMod-2.9.76.jar'), {
    'assets/gregtech/textures/blocks/iconsets/OVERLAY_ACCELERATOR.png': BLUE,
    'assets/gregtech/textures/items/gt.metaitem.01/606.png': GREY,
    'assets/dreamcraft/textures/items/item.Foo.png': BLUE });
  const vn = await makeJar(join(jars, 'VillageNames-4.jar'), { 'assets/minecraft/textures/blocks/sponge.png': BLUE });
  const broken = join(jars, 'broken.jar');
  await writeFile(broken, 'this is not a zip');
  return { dir, jars: [{ path: client, kind: 'client' as const }, ...[gt, core, vn, broken].map((path) => ({ path, kind: 'mod' as const }))] };
}

/** Writes `data` to `<root>/<rel>`, creating its folder. */
async function put(root: string, rel: string, data: Uint8Array | string): Promise<void> {
  await mkdir(dirname(join(root, rel)), { recursive: true });
  await writeFile(join(root, rel), data);
}

/**
 * `pack()`'s jars under two resource packs, lowest first as options.txt lists them: the folder `P1` and the zip
 * `P2.zip` (`gone` is listed but was not found). `<dir>/assets/nei/` already holds the NEI import.
 */
async function withPacks() {
  const { dir, jars } = await pack();
  const folder = join(dir, 'resourcepacks', 'P1');
  await put(folder, 'pack.mcmeta', '{"pack":{"pack_format":1,"description":"v1"}}');
  await put(folder, 'assets/minecraft/textures/blocks/STONE.png', GREEN);   // the client jar's stone.png in another case
  await put(folder, 'assets/gregtech/textures/blocks/fluids/fluid.water.png.mcmeta', '{"animation":{}}');
  await put(folder, 'assets/p/textures/items/only.png', GREEN);
  await put(folder, 'assets/nei/textures/items/n.png', GREEN);
  await put(dir, 'outside.png', GREEN);
  await mkdir(join(folder, 'assets/p/textures/blocks'));
  await symlink(join(dir, 'outside.png'), join(folder, 'assets/p/textures/blocks/link.png'));
  const zip = await makeJar(join(dir, 'resourcepacks', 'P2.zip'), {
    'pack.mcmeta': '{"pack":{"pack_format":1,"description":"v2"}}',
    'assets/gregtech/textures/blocks/iconsets/OVERLAY_ACCELERATOR.png': makePng(16, 32, [128, 0, 128, 255]),
    'assets/gregtech/textures/blocks/iconsets/OVERLAY_ACCELERATOR.png.mcmeta': '{"animation":{}}',
    'assets/minecraft/textures/blocks/Sponge.png': GREEN,   // only the case differs from the jars' sponge.png
    'assets/gregtech/textures/blocks/iconsets/MACHINE_LV_SIDE.png': Buffer.concat([Buffer.from([0xff, 0xd8, 0xff, 0xe0]), Buffer.from(' not a png')]),
  });
  const packs: PackSet = {
    enabled: ['P1', 'gone', 'P2.zip'],
    packs: [{ name: 'P1', path: folder, format: 'folder', version: 'v1' }, { name: 'P2.zip', path: zip, format: 'zip', version: 'v2' }],
  };
  await put(dir, 'assets/nei/index.json', '{}');
  return { dir, jars, packs, folder };
}

describe('textureEntry and pickWinner', () => {
  it('accepts only block and item textures under a lower-case domain', () => {
    expect(textureEntry('assets/gregtech/textures/blocks/iconsets/MACHINE_LV_SIDE.png')).toBe('gregtech/textures/blocks/iconsets/MACHINE_LV_SIDE.png');
    expect(textureEntry('assets/gregtech/textures/blocks/fluids/fluid.water.png.mcmeta')).toBe('gregtech/textures/blocks/fluids/fluid.water.png.mcmeta');
    for (const bad of ['assets/gregtech/textures/gui/x.png', 'assets/StorageDrawers/textures/blocks/a.png', 'assets/x/textures/blocks/../../../evil.png',
      'assets/x/textures/items/a\\b.png', 'assets/x/textures/items/', 'assets/x/textures/blocks/a.txt', 'assets/x/textures/blocks//a.png'])
      expect(textureEntry(bad)).toBeNull();
  });

  it('accepts the chest model sheets and no other entity or model texture', () => {
    expect(textureEntry('assets/minecraft/textures/entity/chest/normal.png')).toBe('minecraft/textures/entity/chest/normal.png');
    expect(textureEntry('assets/ironchest/textures/model/ironchest.png')).toBe('ironchest/textures/model/ironchest.png');
    expect(textureEntry('assets/minecraft/textures/entity/chest/christmas_double.png')).toBe('minecraft/textures/entity/chest/christmas_double.png');
    for (const bad of ['assets/minecraft/textures/entity/pig/pig.png', 'assets/minecraft/textures/entity/chest/normal.png.mcmeta',
      'assets/othermod/textures/model/x.png', 'assets/ironchest/textures/gui/ironcontainer.png',
      'assets/ironchest/textures/model/ironchest.png.mcmeta', 'assets/minecraft/textures/model/normal.png', 'assets/ironchest/textures/entity/chest/normal.png',
      'assets/minecraft/textures/entity/chest/Normal.png', 'assets/minecraft/textures/entity/chest/normal2.png', 'assets/minecraft/textures/entity/chest/.png',
      'assets/minecraft/textures/entity/chest/sub/normal.png', 'assets/minecraft/textures/entity/chest/../pig/pig.png', 'assets/minecraft/textures/entity/chest/normal.txt'])
      expect(textureEntry(bad)).toBeNull();
  });

  it('applies the winner rule', () => {
    expect(pickWinner([{ jar: 'minecraft-1.7.10-client.jar', kind: 'client' }, { jar: 'VillageNames-4.jar', kind: 'mod' }], undefined))
      .toEqual({ winner: 'VillageNames-4.jar', rule: 'mod-over-client' });
    expect(pickWinner([{ jar: 'gregtech-5.09.54.183.jar', kind: 'mod' }, { jar: 'GTNewHorizonsCoreMod-2.9.76.jar', kind: 'mod' }], 'gregtech-5.09.54.183.jar'))
      .toEqual({ winner: 'GTNewHorizonsCoreMod-2.9.76.jar', rule: 'override-over-home' });
    expect(pickWinner([{ jar: 'B.jar', kind: 'mod' }, { jar: 'a.jar', kind: 'mod' }], 'home.jar')).toEqual({ winner: 'B.jar', rule: 'last-by-name' });
    expect(pickWinner([{ jar: 'CoFHCore.jar', kind: 'mod' }, { jar: 'ThermalFoundation.jar', kind: 'mod' }, { jar: 'zzz.jar', kind: 'mod' }], 'CoFHCore.jar'))
      .toEqual({ winner: 'zzz.jar', rule: 'last-by-name' });
  });
});

describe('extractAssets', () => {
  it('copies winners, indexes sizes and frames, logs conflicts and skips broken jars', async () => {
    const { dir, jars } = await pack();
    const before = await Promise.all(jars.map((j) => stat(j.path)));
    const s = await extractAssets({ jars, dataDir: dir, clientSha1: 'e80d9b3bf5085002218d4be59e668bac718abbc6' });
    expect(s.files).toBe(8);
    expect(s.identicalDuplicates).toBe(1);
    expect(s.skippedJars.map((j) => j.jar)).toEqual(['broken.jar']);
    expect(s.conflicts).toEqual([
      { path: 'gregtech/textures/blocks/iconsets/OVERLAY_ACCELERATOR.png', winner: 'GTNewHorizonsCoreMod-2.9.76.jar', losers: ['gregtech-5.09.54.183.jar'], rule: 'override-over-home' },
      { path: 'minecraft/textures/blocks/sponge.png', winner: 'VillageNames-4.jar', losers: ['minecraft-1.7.10-client.jar'], rule: 'mod-over-client' },
    ]);
    expect(await readFile(P(dir, 'gregtech/textures/blocks/iconsets/OVERLAY_ACCELERATOR.png'))).toEqual(BLUE);
    expect(existsSync(P(dir, 'gregtech/textures/blocks/fluids/fluid.water.png.mcmeta'))).toBe(true);
    expect(existsSync(P(dir, 'gregtech/textures/gui/background.png'))).toBe(false);
    expect(existsSync(P(dir, 'minecraft/lang/en_US.lang'))).toBe(false);
    expect(existsSync(join(dir, 'evil.png'))).toBe(false);
    const ix = JSON.parse(await readFile(P(dir, 'index.json'), 'utf8'));
    expect(ix.files['gregtech/textures/blocks/fluids/fluid.water.png']).toEqual({ w: 16, h: 64, frames: 4, jar: 'gregtech-5.09.54.183.jar' });
    expect(ix.files['minecraft/textures/blocks/stone.png']).toEqual({ w: 16, h: 16, jar: 'minecraft-1.7.10-client.jar' });
    expect(ix.sources.find((x: { kind: string }) => x.kind === 'client').sha1).toBe('e80d9b3bf5085002218d4be59e668bac718abbc6');
    const after = await Promise.all(jars.map((j) => stat(j.path)));
    expect(after.map((a) => a.mtimeMs)).toEqual(before.map((b) => b.mtimeMs));
  });

  it('copies the chest model sheets, and no other texture outside blocks and items', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'gp-ex-'));
    const sheet = makePng(64, 64, [150, 100, 50, 255]);
    const client = await makeJar(join(dir, 'jars', 'minecraft-1.7.10-client.jar'), {
      'assets/minecraft/textures/entity/chest/normal.png': sheet, 'assets/minecraft/textures/entity/pig/pig.png': RED });
    const iron = await makeJar(join(dir, 'jars', 'ironchest-6.1.13.jar'), {
      'assets/ironchest/textures/model/ironchest.png': sheet, 'assets/ironchest/textures/gui/ironcontainer.png': GREY });
    const s = await extractAssets({ jars: [{ path: client, kind: 'client' }, { path: iron, kind: 'mod' }], dataDir: dir });
    expect(s).toMatchObject({ files: 2, ignoredEntries: 2 });
    const ix = JSON.parse(await readFile(P(dir, 'index.json'), 'utf8'));
    expect(ix.files).toEqual({
      'ironchest/textures/model/ironchest.png': { w: 64, h: 64, jar: 'ironchest-6.1.13.jar' },
      'minecraft/textures/entity/chest/normal.png': { w: 64, h: 64, jar: 'minecraft-1.7.10-client.jar' },
    });
    expect(await readFile(P(dir, 'minecraft/textures/entity/chest/normal.png'))).toEqual(sheet);
    expect(await readFile(P(dir, 'ironchest/textures/model/ironchest.png'))).toEqual(sheet);
    expect(existsSync(P(dir, 'ironchest/textures/gui/ironcontainer.png'))).toBe(false);
    expect(existsSync(P(dir, 'minecraft/textures/entity/pig/pig.png'))).toBe(false);
  });

  it('replaces old files but keeps the NEI import', async () => {
    const { dir, jars } = await pack();
    await mkdir(P(dir, 'nei/icons'), { recursive: true });
    await writeFile(P(dir, 'nei/index.json'), '{}');
    await writeFile(P(dir, 'nei/icons/a.png'), RED);
    await writeFile(P(dir, 'stale.png'), RED);
    await extractAssets({ jars, dataDir: dir });
    expect(existsSync(P(dir, 'nei/icons/a.png'))).toBe(true);
    expect(existsSync(P(dir, 'stale.png'))).toBe(false);
    expect((await readdir(dir)).filter((n) => n.startsWith('assets.'))).toEqual([]);
  });

  it('leaves the previous assets in place when copying fails', async () => {
    const { dir, jars } = await pack();
    await extractAssets({ jars, dataDir: dir });
    const first = await readFile(P(dir, 'index.json'), 'utf8');
    const bad = await makeJar(join(dir, 'jars', 'bad.jar'), { 'assets/bad/textures/blocks/a.png': RED }, { corrupt: ['assets/bad/textures/blocks/a.png'] });
    await expect(extractAssets({ jars: [...jars, { path: bad, kind: 'mod' }], dataDir: dir })).rejects.toBeInstanceOf(ExtractError);
    expect(await readFile(P(dir, 'index.json'), 'utf8')).toBe(first);
    expect((await readdir(dir)).filter((n) => n.startsWith('assets.'))).toEqual([]);
  });

  it('leaves the previous assets in place when no mod jar can be read', async () => {
    const { dir, jars } = await pack();
    await extractAssets({ jars, dataDir: dir });
    const first = await readFile(P(dir, 'index.json'));
    const client = jars.filter((j) => j.kind === 'client');
    const broken = jars.filter((j) => j.path.endsWith('broken.jar'));
    const err = await extractAssets({ jars: broken, dataDir: dir }).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(ExtractError);
    expect((err as Error).message).toMatch(/^no mod jar could be read: broken\.jar \(.+\)$/);
    for (const only of [[...client, ...broken], client, []]) {   // the client jar alone, or no jar at all, is no pack either
      await expect(extractAssets({ jars: only, dataDir: dir })).rejects.toThrow(/^no mod jar could be read: /);
    }
    expect((await readFile(P(dir, 'index.json'))).equals(first)).toBe(true);
    expect(await readFile(P(dir, 'gregtech/textures/blocks/iconsets/OVERLAY_ACCELERATOR.png'))).toEqual(BLUE);
    expect((await readdir(dir)).filter((n) => n.startsWith('assets.'))).toEqual([]);
  });
});

describe('extractAssets edge cases', () => {
  it('leaves out the NEI folder, files that are not PNGs and a second jar of the same name', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'gp-ex-'));
    const a = await makeJar(join(dir, 'jars', 'a.jar'), {
      'assets/a/textures/blocks/x.png': RED, 'assets/nei/textures/items/n.png': RED,
      'assets/a/textures/blocks/text.png': 'not a png', 'assets/a/textures/blocks/text.png.mcmeta': '{"animation":{}}' });
    const again = await makeJar(join(dir, 'jars', '1.7.10', 'a.jar'), { 'assets/a/textures/blocks/y.png': RED });
    const s = await extractAssets({ jars: [{ path: a, kind: 'mod' }, { path: again, kind: 'mod' }], dataDir: dir });
    expect(s).toMatchObject({ files: 1, jars: 1, ignoredEntries: 2, skippedJars: [{ jar: 'a.jar', error: `same file name as ${a}` }] });
    expect(await readdir(P(dir, 'a/textures/blocks'))).toEqual(['x.png']);
    expect(existsSync(P(dir, 'nei'))).toBe(false);
  });

  it('moves everything back when the swap fails', async () => {
    const { dir, jars } = await pack();
    await extractAssets({ jars, dataDir: dir });
    const first = await readFile(P(dir, 'index.json'), 'utf8');
    await mkdir(P(dir, 'nei'));
    await writeFile(P(dir, 'nei/index.json'), '{}');
    const now = vi.spyOn(Date, 'now').mockReturnValue(1_000);
    try {
      await mkdir(join(dir, 'assets.old-1000', 'busy'), { recursive: true });   // assets/ cannot be renamed onto a non-empty folder
      const err = await extractAssets({ jars, dataDir: dir }).catch((e: unknown) => e);
      expect(err).toBeInstanceOf(ExtractError);
      expect((err as Error).message).toMatch(/^could not put the new textures in place: /);
    } finally {
      now.mockRestore();
    }
    expect(await readFile(P(dir, 'index.json'), 'utf8')).toBe(first);
    expect(existsSync(P(dir, 'nei/index.json'))).toBe(true);
    expect((await readdir(dir)).filter((n) => n.startsWith('assets.'))).toEqual(['assets.old-1000']);
  });
});

describe('extractAssets with resource packs', () => {
  it('packs win over every jar, the last listed first', async () => {
    const { dir, jars, packs, folder } = await withPacks();
    const before = await snapshot(folder);
    const s = await extractAssets({ jars, packs, dataDir: dir });
    const ix = JSON.parse(await readFile(P(dir, 'index.json'), 'utf8'));
    expect(ix.files['gregtech/textures/blocks/iconsets/OVERLAY_ACCELERATOR.png']).toEqual({ w: 16, h: 32, frames: 2, jar: 'P2.zip' });
    expect(ix.files['minecraft/textures/blocks/stone.png']).toEqual({ w: 16, h: 16, jar: 'P1' });
    expect(ix.files['p/textures/items/only.png'].jar).toBe('P1');
    expect(ix.files['gregtech/textures/blocks/fluids/fluid.water.png']).toEqual({ w: 16, h: 64, frames: 4, jar: 'gregtech-5.09.54.183.jar' });
    expect(await readFile(P(dir, 'gregtech/textures/blocks/fluids/fluid.water.png.mcmeta'), 'utf8')).toBe('{"animation":{}}');   // P1's, over the jar's
    expect(ix.conflicts).toEqual([
      { path: 'gregtech/textures/blocks/iconsets/OVERLAY_ACCELERATOR.png', winner: 'GTNewHorizonsCoreMod-2.9.76.jar', losers: ['gregtech-5.09.54.183.jar'], rule: 'override-over-home' },
      { path: 'minecraft/textures/blocks/sponge.png', winner: 'VillageNames-4.jar', losers: ['minecraft-1.7.10-client.jar'], rule: 'mod-over-client' },
    ]);
    expect(ix.packs).toEqual({ enabled: ['P1', 'gone', 'P2.zip'], read: [
      { name: 'P1', format: 'folder', version: 'v1', entries: 3, bytes: expect.any(Number), files: 2 },
      { name: 'P2.zip', format: 'zip', version: 'v2', entries: 4, bytes: expect.any(Number), files: 1 } ] });
    expect(ix.sources.map((x: { jar: string }) => x.jar)).not.toContain('P1');
    expect(s).toMatchObject({ packFiles: 3, packReplaced: 2, caseOnly: 1 });
    expect(await snapshot(folder)).toEqual(before);
  });

  it('writes one file per path', async () => {   // Review Focus 1
    const { dir, jars, packs } = await withPacks();
    const s = await extractAssets({ jars, packs, dataDir: dir });
    expect((await readdir(P(dir, 'minecraft/textures/blocks'))).sort()).toEqual(['sponge.png', 'stone.png']);   // the Mac's disk merges case variants, so also:
    const ix = JSON.parse(await readFile(P(dir, 'index.json'), 'utf8'));
    const keys = Object.keys(ix.files);
    expect(new Set(keys.map((k) => k.toLowerCase())).size).toBe(keys.length);
    expect(ix.files['minecraft/textures/blocks/Sponge.png']).toBeUndefined();
    expect(ix.files['minecraft/textures/blocks/STONE.png']).toBeUndefined();
    expect(await readFile(P(dir, 'minecraft/textures/blocks/stone.png'))).toEqual(GREEN);   // P1's STONE.png under the jar's spelling
    expect(await readFile(P(dir, 'minecraft/textures/blocks/sponge.png'))).toEqual(BLUE);   // VillageNames' as before: the zip's Sponge.png is left out
    expect(s.caseOnly).toBe(1);   // catches a Sponge.png that was written and then overwritten by the jar's copy
  });

  it('not a PNG', async () => {   // Review Focus 3
    const { dir, jars, packs } = await withPacks();
    const s = await extractAssets({ jars, packs, dataDir: dir });
    expect(s.notPngInPacks).toEqual([{ pack: 'P2.zip', path: 'gregtech/textures/blocks/iconsets/MACHINE_LV_SIDE.png' }]);
    expect(JSON.parse(await readFile(P(dir, 'index.json'), 'utf8')).files['gregtech/textures/blocks/iconsets/MACHINE_LV_SIDE.png']).toBeUndefined();
  });

  it('keeps the NEI import and never extracts a pack into nei/ or through a link', async () => {   // Global Constraints: NEI
    const { dir, jars, packs } = await withPacks();
    await extractAssets({ jars, packs, dataDir: dir });
    expect(await readFile(P(dir, 'nei/index.json'), 'utf8')).toBe('{}');
    expect(existsSync(P(dir, 'nei/textures'))).toBe(false);
    expect(existsSync(P(dir, 'p/textures/blocks/link.png'))).toBe(false);
  });

  it('copyFromFolder refuses a file that changed', async () => {   // Review Focus 4
    const { folder } = await withPacks();
    const { entries } = await scanFolderPack(folder);
    const rel = 'p/textures/items/only.png';
    await writeFile(entries.get(rel)!.file, RED);
    await expect(copyFromFolder(entries, new Map([[rel, rel]]), await mkdtemp(join(tmpdir(), 'gp-cp-')), new Set()))
      .rejects.toThrow(/changed during the extraction/);
  });

  it('copyFromFolder refuses a file edited to the same size', async () => {   // Review Focus 4: only the CRC-32 tells
    const { folder } = await withPacks();
    const { entries } = await scanFolderPack(folder);
    const rel = 'p/textures/items/only.png';
    await writeFile(entries.get(rel)!.file, Buffer.alloc(GREEN.length));
    await expect(copyFromFolder(entries, new Map([[rel, rel]]), await mkdtemp(join(tmpdir(), 'gp-cp-')), new Set()))
      .rejects.toThrow(/changed during the extraction/);
  });

  it('fails on a zip pack entry that differs from its scan, and keeps the previous textures', async () => {   // Review Focus 4
    const { dir, jars, packs } = await withPacks();
    await extractAssets({ jars, packs, dataDir: dir });
    const first = await readFile(P(dir, 'index.json'), 'utf8');
    const zip = packs.packs[1]!.path;
    const bytes = await readFile(zip);
    const name = Buffer.from('assets/gregtech/textures/blocks/iconsets/OVERLAY_ACCELERATOR.png.mcmeta');   // no other entry name holds it
    const central = bytes.indexOf(name, bytes.indexOf(name) + 1) - 46;   // its second copy follows its central directory record
    bytes.writeUInt32LE(bytes.readUInt32LE(central + 16) ^ 1, central + 16);   // the CRC-32 that the scan lists
    await writeFile(zip, bytes);
    await expect(extractAssets({ jars, packs, dataDir: dir })).rejects.toThrow(/^P2\.zip: .*OVERLAY_ACCELERATOR\.png\.mcmeta: CRC-32 mismatch/);
    expect(await readFile(P(dir, 'index.json'), 'utf8')).toBe(first);
    expect((await readdir(dir)).filter((n) => n.startsWith('assets.'))).toEqual([]);
  });

  it('folderEntry', () => {
    expect(folderEntry('assets/gregtech/Textures/Blocks/iconsets/MACHINE_LV_SIDE.PNG')).toBe('gregtech/textures/blocks/iconsets/MACHINE_LV_SIDE.png');
    expect(folderEntry('assets/gregtech/textures/blocks/a.png.MCMETA')).toBe('gregtech/textures/blocks/a.png.mcmeta');
    expect(folderEntry('assets/minecraft/textures/entity/chest/Normal.png')).toBe('minecraft/textures/entity/chest/normal.png');
    for (const bad of ['assets/x/textures/gui/a.png', 'assets/x/textures/blocks/../../a.png', 'pack.mcmeta', 'assets/x/mcpatcher/ctm/glass/0.png',
      'assets/GregTech/textures/blocks/a.png'])   // 1.7.10 ignores non-lower-case namespaces
      expect(folderEntry(bad)).toBeNull();
  });

  it('scanFolderPack reads only the texture files outside nei/; a folder without assets/, or with a link there, holds none', async () => {
    const folder = await mkdtemp(join(tmpdir(), 'gp-fp-'));
    expect(await scanFolderPack(folder)).toEqual({ entries: new Map(), ignored: 0 });
    await put(folder, 'assets/x/Textures/Blocks/A.PNG', GREEN);
    for (const rel of ['assets/x/lang/en_US.lang', 'assets/nei/textures/items/n.png', 'assets/Other/textures/blocks/b.png']) {
      await put(folder, rel, GREEN);
      await chmod(join(folder, rel), 0o000);   // a read of any of these would fail the scan
    }
    const scan = await scanFolderPack(folder);
    expect(scan).toEqual({
      entries: new Map([['x/textures/blocks/A.png', { crc: crc32(GREEN), size: GREEN.length, file: join(folder, 'assets/x/Textures/Blocks/A.PNG') }]]),
      ignored: 3,
    });
    const rel = 'x/textures/blocks/a.png';   // the entry is keyed as the scan spelled it, A.png
    await expect(copyFromFolder(scan.entries, new Map([[rel, rel]]), await mkdtemp(join(tmpdir(), 'gp-cp-')), new Set())).rejects.toThrow(/was not scanned/);
    const linked = await mkdtemp(join(tmpdir(), 'gp-fp-'));
    await symlink(join(folder, 'assets'), join(linked, 'assets'));   // a link inside a pack is never followed, assets/ included
    expect(await scanFolderPack(linked)).toEqual({ entries: new Map(), ignored: 0 });
  });

  it('skips a pack it cannot scan or that is named like a jar, and never counts a pack as a mod jar', async () => {
    const { dir, jars, packs } = await withPacks();
    const broken = join(dir, 'resourcepacks', 'broken.zip');
    await writeFile(broken, 'not a zip');
    const villageNames = jars.find((j) => j.path.endsWith('VillageNames-4.jar'))!.path;
    const named = await makeJar(join(dir, 'resourcepacks', 'VillageNames-4.jar'), { 'assets/minecraft/textures/blocks/sponge.png': GREEN });
    const more: PackSet = {
      enabled: [...packs.enabled, 'broken.zip', 'VillageNames-4.jar'],
      packs: [...packs.packs, { name: 'broken.zip', path: broken, format: 'zip', version: '' }, { name: 'VillageNames-4.jar', path: named, format: 'zip', version: '' }],
    };
    const s = await extractAssets({ jars, packs: more, dataDir: dir });
    expect(s.skippedJars.map((j) => j.jar)).toEqual(['broken.jar', 'broken.zip', 'VillageNames-4.jar']);
    expect(s.skippedJars[2]!.error).toBe(`same file name as ${villageNames}`);
    expect(s.packs).toEqual({ enabled: more.enabled, read: [expect.objectContaining({ name: 'P1' }), expect.objectContaining({ name: 'P2.zip' })] });
    expect(JSON.parse(await readFile(P(dir, 'index.json'), 'utf8')).packs).toEqual(s.packs);
    expect(await readFile(P(dir, 'minecraft/textures/blocks/sponge.png'))).toEqual(BLUE);
    const client = jars.filter((j) => j.kind === 'client');
    await expect(extractAssets({ jars: client, packs, dataDir: dir })).rejects.toThrow(/^no mod jar could be read: /);
  });

  it('records packs only when it was given some', async () => {
    const { dir, jars } = await pack();
    const s = await extractAssets({ jars, dataDir: dir });
    expect(s).toMatchObject({ packFiles: 0, packReplaced: 0, caseOnly: 0, notPngInPacks: [], packs: null });
    expect('packs' in JSON.parse(await readFile(P(dir, 'index.json'), 'utf8'))).toBe(false);
    const none = await extractAssets({ jars, packs: { enabled: [], packs: [] }, dataDir: dir });
    expect(none.packs).toEqual({ enabled: [], read: [] });
    expect(JSON.parse(await readFile(P(dir, 'index.json'), 'utf8')).packs).toEqual({ enabled: [], read: [] });
  });
});
