// Real-world check (Plan 4 Task 18, architecture §10): scans this host's server folder (its newest complete backup, else
// a snapshot copy; never the live world files) with the active export and a real worker thread, as the app does. It
// runs only with GTNH_LOCAL=1 and is skipped everywhere else. It prints counts only — no names, ids or coordinates —
// and the scan it writes lands in the config's data folder (git-ignored), where the app's Map tab can open it. The
// checks after the first read the scan the first one made.

import { monitorEventLoopDelay } from 'node:perf_hooks';
import { beforeAll, describe, expect, it } from 'vitest';
import { activeExportDir, loadConfig, type AppConfig } from '../../../src/server/config.ts';
import { loadPack } from '../../../src/server/pack/load.ts';
import { machineByMteId } from '../../../src/server/pack/lookup.ts';
import { COIL_HEAT_BY_META, isEbf } from '../../../src/server/world/coils.ts';
import { packFacts, type ScanPackFacts } from '../../../src/server/world/facts.ts';
import { DIRS, posKey, step } from '../../../src/server/world/model.ts';
import { createWorldService } from '../../../src/server/world/scan.ts';
import { scanSummary } from '../../../src/server/world/scan.worker.ts';
import type { Pack } from '../../../src/shared/types/pack.ts';
import type { PowerNetwork, WorldScan } from '../../../src/shared/types/world.ts';

const SCAN_LIMIT_MS = 180_000;
const MAX_LAG_MS = 100;
const MIN_DIMS = 5;
const UNKNOWN_MANAGER = 'Unknown chunk manager';
/** The scan notes of plan 10 Task 1 and the unknown-boiler note, with their counts. */
const UNFED_NOTE = /^(\d+) steam turbines? gets? no steam the scan can follow$/;
const UNKNOWN_BOILERS_NOTE = /^(\d+) boilers? with unknown steam output$/;
/**
 * The pack warnings of plan 10 Task 2 on an export from before the fix: battery slots taken from a name (a buffer's
 * number, a charger's family), or unknown.
 */
const SLOTS_FROM_NAME = /: the export gives 0 battery slots, using \d+(?: from its name|, the slot count GT gives every charger)$/;
const SLOTS_UNKNOWN = /: the export gives 0 battery slots and its name does not tell how many, slots unknown$/;

/**
 * The ids of the power networks holding a generator or steam turbine, from the scan's own blocks as buildPower joins
 * them (rules 1–2): a machine is in the network of a cable pointing at it, and a generator also in the network of a
 * machine its front touches. A network fed only through something the scan does not follow (a diode) has none.
 */
function networksWithAGenerator(scan: WorldScan): Set<string> {
  const machineKeys = new Set(scan.machines.map((m) => posKey(m.dim, ...m.pos)));
  const networkOf = new Map<string, string>();   // machine position → the network of a cable pointing at it
  for (const p of scan.pipes) {
    const id = p.networkId;
    if (p.kind !== 'cable' || id === undefined) continue;
    for (let side = 0; side < DIRS.length; side++) {
      const k = posKey(p.dim, ...step(p.pos, side));
      if ((p.connections & (1 << side)) !== 0 && machineKeys.has(k)) networkOf.set(k, id);
    }
  }
  const ids = new Set<string>();
  for (const m of scan.machines) {
    if (m.kind !== 'turbine' && m.kind !== 'generator') continue;
    const front = m.facing >= 0 && m.facing < DIRS.length ? networkOf.get(posKey(m.dim, ...step(m.pos, m.facing))) : undefined;
    const id = networkOf.get(posKey(m.dim, ...m.pos)) ?? front;
    if (id !== undefined) ids.add(id);
  }
  return ids;
}

describe.skipIf(process.env.GTNH_LOCAL !== '1')('a scan of the real world', () => {
  let config: AppConfig, pack: Pack, facts: ScanPackFacts;
  let scanned: WorldScan | null = null;

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
    scanned = scan;
    const ebfs = scan.machines.filter((m) => {
      const cls = machineByMteId(pack, m.mteId)?.cls;
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

  // Ruling R8, narrowed as it allows: a base network fed only through something the scan does not follow holds no
  // generator, so the check covers the base networks that hold one (why: docs/local/world-runs.md).
  it('reports generation > 0 in clear weather on every power network of a base that holds a generator (plan 10, ruling R8)', () => {
    expect(scanned, 'the scan the first check made').not.toBeNull();
    const scan = scanned!;
    const notes = scan.warnings ?? [];
    const counted = (re: RegExp): number => notes.reduce((n, w) => n + Number(re.exec(w)?.[1] ?? 0), 0);
    const withGenerator = networksWithAGenerator(scan);
    const baseNetworks = scan.power.filter((n) => n.baseId !== null);
    const checked = baseNetworks.filter((n) => withGenerator.has(n.id));
    const generating = checked.filter((n) => n.generatorEUt.clear > 0);
    console.log([
      `real-world: power networks ${scan.power.length}, of a base ${baseNetworks.length}`,
      `${checked.length} of those hold a generator, ${generating.length} of them generate in clear weather`,
      `unfed-turbine notes ${notes.filter((w) => UNFED_NOTE.test(w)).length} (${counted(UNFED_NOTE)} turbines), unknown boilers ${counted(UNKNOWN_BOILERS_NOTE)}`,
    ].join('\n'));
    expect(checked.length).toBeGreaterThan(0);
    expect(generating.length).toBe(checked.length);
  });

  it('reports storedEU ≤ capacityEU on every power network (plan 10 Task 2)', () => {
    expect(scanned, 'the scan the first check made').not.toBeNull();
    const networks = scanned!.power;
    const over = networks.filter((n) => n.storedEU > n.capacityEU);
    const sum = (pick: (n: PowerNetwork) => number): number => networks.reduce((s, n) => s + pick(n), 0);
    const warnings = pack.warnings ?? [];
    console.log([
      `real-world: exporter ${pack.manifest.exporterVersion}, battery slots from names ${warnings.filter((w) => SLOTS_FROM_NAME.test(w)).length}, unknown ${warnings.filter((w) => SLOTS_UNKNOWN.test(w)).length}`,
      `power networks ${networks.length}, ${networks.filter((n) => n.capacityEU > 0).length} with storage, ${over.length} holding more than their capacity`,
      `stored ${sum((n) => n.storedEU)} of ${sum((n) => n.capacityEU)} EU in all`,
    ].join('\n'));
    expect(over.length, 'power networks holding more EU than their capacity').toBe(0);
  });
});
