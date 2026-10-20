import { describe, it, expect } from 'vitest';
import { mkdir, mkdtemp, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { writeAssetsDir } from '../../helpers/assets-dir.ts';
import { dumpFile, writeTexturesDump } from '../../helpers/textures-dump.ts';
import { gtSampleFile, GT_SAMPLE_ASSETS } from '../../helpers/gt-sample.ts';
import { AssetService } from '../../../src/server/assets/service.ts';

describe('AssetService', () => {
  it('reloads when index, dump or NEI index change', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'gp-svc-'));
    const exportDir = join(dir, 'export', 'e1');
    await writeAssetsDir(dir, { 'minecraft/textures/blocks/stone.png': {} });
    const logs: string[] = [];
    const svc = new AssetService({ dataDir: dir, exportDir: () => exportDir, pack: async () => null, checkEveryMs: 0, log: (l) => logs.push(l) });
    expect((await svc.icons(['fluid:water']))[0]!.source).toBe('fallback');
    await writeAssetsDir(dir, GT_SAMPLE_ASSETS);
    await writeTexturesDump(exportDir, gtSampleFile());
    expect((await svc.icons(['fluid:water']))[0]!.source).toBe('gt');
    await mkdir(join(dir, 'assets', 'nei', 'icons'), { recursive: true });
    await writeFile(join(dir, 'assets', 'nei', 'index.json'), JSON.stringify({ format: 'gtnh-planner-nei/1', importedAt: 't', rows: 1, icons: { 'fluid:water': 'nei/icons/79da7cf2c0480a76.png' } }));
    expect((await svc.icons(['fluid:water']))[0]!.source).toBe('nei');
    await writeFile(join(dir, 'assets', 'index.json'), '{broken');
    expect((await svc.icons(['fluid:water']))[0]!.source).toBe('nei');
    expect(await svc.icons(['fluid:water'])).toHaveLength(1);
    expect(logs).toHaveLength(1);
  });

  it('checks at most once per checkEveryMs, and concurrent callers share one check', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'gp-svc-'));
    await writeAssetsDir(dir, { 'minecraft/textures/blocks/stone.png': {} });
    let packCalls = 0;
    const svc = new AssetService({ dataDir: dir, exportDir: () => null, pack: async () => { packCalls++; return null; }, checkEveryMs: 60_000 });
    const [a, b] = await Promise.all([svc.sources(), svc.sources()]);
    expect(a).toBe(b);
    expect(packCalls).toBe(1);
    await writeAssetsDir(dir, GT_SAMPLE_ASSETS);
    expect((await svc.sources()).index.size).toBe(1);
    expect(packCalls).toBe(1);
  });

  it('says once per dump load how many fluids name a still texture that was not extracted', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'gp-svc-'));
    const exportDir = join(dir, 'export', 'e1');
    const still = (name: string) => ({ name, color: 0, still: `gregtech/textures/blocks/fluids/fluid.${name}.png` });
    await writeTexturesDump(exportDir, dumpFile({ fluids: [still('a')] }));
    const logs: string[] = [];
    const svc = new AssetService({ dataDir: dir, exportDir: () => exportDir, pack: async () => null, checkEveryMs: 0, log: (l) => logs.push(l) });
    await svc.sources();
    await svc.sources();
    expect(logs).toHaveLength(1);
    expect(logs[0]).toContain('1 fluid of the texture dump');
    await writeTexturesDump(exportDir, dumpFile({ fluids: [still('a'), still('b'), { name: 'c', color: 0 }] }));
    await svc.sources();
    expect(logs).toEqual([logs[0], 'Assets: 2 fluids of the texture dump name a still texture that was not extracted; they are drawn by name or '
      + 'as GT\'s generic fluid (exporter 0.4.0 fixes the GT ones).']);
  });

  it('works with no assets, no export and no pack', async () => {
    const svc = new AssetService({ dataDir: await mkdtemp(join(tmpdir(), 'gp-svc-')), exportDir: () => null, pack: async () => null });
    expect((await svc.blocks([{ id: 'minecraft:stone', meta: 0 }]))[0]!.resolved).toBe(false);
  });
});
