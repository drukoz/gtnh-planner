import { mkdtemp, readFile, realpath, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { expect, it } from 'vitest';
import { loadPack } from '../../../src/server/pack/load.ts';
import { makeExport } from '../../helpers/make-export.ts';
import { makeFakeJava } from '../../helpers/fake-java.ts';
import { makeFakeServer, snapshot } from '../../helpers/fake-server.ts';
import { runCli } from '../../helpers/run-cli.ts';
import { sampleExportSpec } from '../../helpers/sample-export.ts';

it('exports from a server folder and answers pack:info from the new active export', async () => {
  const root = await realpath(await mkdtemp(join(tmpdir(), 'gp-pipeline-')));
  const server = await makeFakeServer(join(root, 'GT_New_Horizons_2.9.0-RC-1_Server_Java_17-26'));
  const fixture = await makeExport(join(root, 'fixture'), { ...sampleExportSpec(), fillerMaps: 140, marker: null });
  const java = await makeFakeJava(root);
  const jar = join(root, 'gtnhplannerexport-0.1.0.jar');
  await writeFile(jar, 'jar');
  const before = await snapshot(server);
  const env = { GTNH_PLANNER_CONFIG: undefined, FAKE_JAVA_MODE: 'ok', FAKE_EXPORT_SRC: fixture };

  const exported = await runCli('export', ['--server', server, '--jar', jar, '--java', java], { cwd: root, env, timeoutMs: 30_000 });
  expect(exported.code).toBe(0);
  const { activeExportId } = JSON.parse(await readFile(join(root, 'data', 'config.json'), 'utf8'));
  const pack = await loadPack(join(root, 'data', 'export', activeExportId));

  const info = await runCli('pack-info', [], { cwd: root, env });
  expect(info.code).toBe(0);
  expect(info.stdout).toContain(`Export:     ${activeExportId}`);
  expect(info.stdout).toContain(`Items:      ${pack.items.size} · Fluids: ${pack.fluids.size}`);

  const find = await runCli('pack-info', ['--find', 'Iron Dust'], { cwd: root, env });
  expect(find.stdout).toContain('  - Pulverization · Basic Macerator · 2 EU/t · 400 t (20.0 s) · LV');

  await new Promise((r) => setTimeout(r, 1100));                  // export ids have one-second resolution
  const again = await runCli('export', ['--jar', jar, '--java', java], { cwd: root, env, timeoutMs: 30_000 });   // server folder remembered
  expect(again.code).toBe(0);
  const second = JSON.parse(await readFile(join(root, 'data', 'config.json'), 'utf8')).activeExportId;
  expect(second).not.toBe(activeExportId);                        // a re-export never overwrites an older export
  expect((await loadPack(join(root, 'data', 'export', second))).recipes.map((r) => r.id).sort())
    .toEqual(pack.recipes.map((r) => r.id).sort());                // same pack → same recipe ids
  expect(await snapshot(server)).toEqual(before);
}, 90_000);
