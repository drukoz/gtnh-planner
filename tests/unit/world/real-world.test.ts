// Real-world check (Plan 4 Task 18, architecture §10): scans this host's server folder (its newest complete backup, else
// a snapshot copy; never the live world files) with the active export and a real worker thread, as the app does. It
// runs only with GTNH_LOCAL=1 and is skipped everywhere else. It prints counts only — no names, ids or coordinates —
// and the scan it writes lands in the config's data folder (git-ignored), where the app's Map tab can open it.

import { monitorEventLoopDelay } from 'node:perf_hooks';
import { beforeAll, describe, expect, it } from 'vitest';
import { activeExportDir, loadConfig, type AppConfig } from '../../../src/server/config.ts';
import { loadPack } from '../../../src/server/pack/load.ts';
import { COIL_HEAT_BY_META, isEbf } from '../../../src/server/world/coils.ts';
import { packFacts, type ScanPackFacts } from '../../../src/server/world/facts.ts';
import { createWorldService } from '../../../src/server/world/scan.ts';
import { scanSummary } from '../../../src/server/world/scan.worker.ts';
import type { Pack } from '../../../src/shared/types/pack.ts';

const SCAN_LIMIT_MS = 180_000;
const MAX_LAG_MS = 100;
const MIN_DIMS = 5;
const UNKNOWN_MANAGER = 'Unknown chunk manager';

describe.skipIf(process.env.GTNH_LOCAL !== '1')('a scan of the real world', () => {
  let config: AppConfig, pack: Pack, facts: ScanPackFacts;

  beforeAll(async () => {
    config = loadConfig();
    pack = await loadPack(activeExportDir(config));
    facts = packFacts(pack);
  }, 180_000);

  it('finishes in a worker within 180 s without blocking the main thread', { timeout: SCAN_LIMIT_MS + 60_000 }, async () => {
    expect(config.serverFolder, 'serverFolder in the config').not.toBeNull();
    const svc = createWorldService({ config, facts: async () => facts });               // useWorker defaults to true
    const lag = monitorEventLoopDelay({ resolution: 10 });
    lag.enable();
    const t0 = performance.now();
    const id = await svc.startScan({ kind: 'server' });
    await svc.idle();
    const ms = performance.now() - t0;
    lag.disable();
    const status = svc.scanStatus(id);
    const lagMs = lag.max / 1e6;
    console.log(`real-world: scan ${Math.round(ms / 1000)} s, max event-loop lag ${lagMs.toFixed(1)} ms, rss ${Math.round(process.memoryUsage().rss / 2 ** 20)} MiB`);
    expect(status.state, status.message).toBe('done');
    expect(ms).toBeLessThan(SCAN_LIMIT_MS);
    expect(lagMs).toBeLessThan(MAX_LAG_MS);

    const scan = (await svc.getScan(id))!;
    const ebfs = scan.machines.filter((m) => {
      const cls = pack.machines.get(m.mteId)?.cls;
      return isEbf({ mteId: m.mteId, cls: cls ?? null });
    });
    const heats = ebfs.flatMap((m) => (m.coilHeat === undefined ? [] : [m.coilHeat]));
    const unknownBlocks = scan.storage.filter((s) => s.contents === null).length;
    console.log([
      `real-world: ${scanSummary(scan)}`,
      `dims ${scan.dims.length} (${scan.dims.filter((d) => d.visited).length} visited, ${scan.dims.reduce((n, d) => n + d.chunks, 0)} chunks)`,
      `power networks ${scan.power.length}, logistics networks ${scan.logistics.length} (${scan.logistics.filter((n) => n.kind === 'routed').length} routed)`,
      `storage blocks ${scan.storage.length} (${unknownBlocks} unknown), EBFs ${ebfs.length} (${heats.length} with a coil heat)`,
      `warnings ${(scan.warnings ?? []).length}, skipped chunks ${scan.skippedChunks ?? 0}`,
    ].join('\n'));

    expect(scan.bases.length).toBeGreaterThanOrEqual(1);
    expect(scan.dims.length).toBeGreaterThanOrEqual(MIN_DIMS);
    const known = new Set(Object.values(COIL_HEAT_BY_META));
    expect(heats.filter((h) => !known.has(h))).toEqual([]);
    expect((scan.warnings ?? []).filter((w) => w.startsWith(UNKNOWN_MANAGER))).toEqual([]);
  });
});
