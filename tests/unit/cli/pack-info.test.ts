import { mkdtemp, mkdir, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { loadPack } from '../../../src/server/pack/load.ts';
import { makeExport } from '../../helpers/make-export.ts';
import { runCli } from '../../helpers/run-cli.ts';
import { sampleExportSpec } from '../../helpers/sample-export.ts';

async function root(active: string | null) {
  const dir = await mkdtemp(join(tmpdir(), 'gp-info-'));
  const exportDir = await makeExport(join(dir, 'data', 'export', 'sample'), sampleExportSpec());
  await mkdir(join(dir, 'data'), { recursive: true });
  await writeFile(join(dir, 'data', 'config.json'), JSON.stringify({ dataDir: 'data', serverFolder: null, activeExportId: active }));
  return { dir, exportDir };
}
const env = { GTNH_PLANNER_CONFIG: undefined };

describe('pack:info', () => {
  it('prints a summary of the active export', async () => {
    const { dir, exportDir } = await root('sample');
    const pack = await loadPack(exportDir);
    const by = (s: string) => pack.recipes.filter((r) => r.source === s).length;
    const r = await runCli('pack-info', [], { cwd: dir, env });
    expect(r.code).toBe(0);
    expect(r.stdout).toContain('Export:     sample');
    expect(r.stdout).toContain(`Recipes:    ${pack.recipes.length} (gt ${by('gt')}, assemblyline ${by('assemblyline')}, crafting ${by('crafting')}, furnace ${by('furnace')}, derived ${by('derived')}) in ${pack.maps.size} maps`);
    expect(r.stdout).toContain('Name failures: 1');
  });

  it('lists producing recipes with machine, EU/t, duration and tier', async () => {
    const { dir } = await root('sample');
    const r = await runCli('pack-info', ['--find', 'Iron Dust'], { cwd: dir, env });
    expect(r.code).toBe(0);
    expect(r.stdout).toContain('Iron Dust  gregtech:gt.metaitem.01@2032');
    expect(r.stdout).toContain('5 producing recipes:');
    expect(r.stdout).toContain('  - Pulverization · Basic Macerator · 2 EU/t · 400 t (20.0 s) · LV  |  1× Iron Ore → 2× Iron Dust, 10% 1× Nickel Dust');
    expect(r.stdout).toContain('[recycling]');
  });

  it('reports no match, no active export, and reads --export without a config', async () => {
    const { dir, exportDir } = await root(null);
    const none = await runCli('pack-info', ['--export', exportDir, '--find', 'unobtainium'], { cwd: dir, env });
    expect(none.code).toBe(1);
    expect(none.stderr).toContain('No item or fluid matches "unobtainium"');
    const inactive = await runCli('pack-info', [], { cwd: dir, env });
    expect(inactive.code).toBe(1);
    expect(inactive.stderr).toContain('No active export. Run `npm run export` first.');
    const given = await runCli('pack-info', ['--export', exportDir], { cwd: dir, env });
    expect(given.code).toBe(0);
    expect(given.stdout).toContain('Export:     sample');
  });
});
