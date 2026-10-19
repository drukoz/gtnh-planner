import { describe, it, expect, vi } from 'vitest';
import { mkdtemp, mkdir, readFile, readdir, stat, writeFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { makeJar } from '../../helpers/jar.ts';
import { makePng } from '../../helpers/png.ts';
import { extractAssets, textureEntry, pickWinner, ExtractError } from '../../../src/server/assets/extract.ts';

const RED = makePng(16, 16, [255, 0, 0, 255]);
const BLUE = makePng(16, 16, [0, 0, 255, 255]);
const GREY = makePng(16, 16, [128, 128, 128, 255]);
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

describe('textureEntry and pickWinner', () => {
  it('accepts only block and item textures under a lower-case domain', () => {
    expect(textureEntry('assets/gregtech/textures/blocks/iconsets/MACHINE_LV_SIDE.png')).toBe('gregtech/textures/blocks/iconsets/MACHINE_LV_SIDE.png');
    expect(textureEntry('assets/gregtech/textures/blocks/fluids/fluid.water.png.mcmeta')).toBe('gregtech/textures/blocks/fluids/fluid.water.png.mcmeta');
    for (const bad of ['assets/gregtech/textures/gui/x.png', 'assets/StorageDrawers/textures/blocks/a.png', 'assets/x/textures/blocks/../../../evil.png',
      'assets/x/textures/items/a\\b.png', 'assets/x/textures/items/', 'assets/x/textures/blocks/a.txt', 'assets/x/textures/blocks//a.png'])
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
