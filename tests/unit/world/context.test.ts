import { mkdir, mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, expect, it } from 'vitest';
import { emptyContext } from '../../../src/server/planner/plan.ts';
import { contextFromScan } from '../../../src/server/world/context.ts';
import { runScanJob } from '../../../src/server/world/scan.worker.ts';
import type { WorldScan } from '../../../src/shared/types/world.ts';
import { SAMPLE, makeSampleWorld } from '../../helpers/sample-world.ts';
import { packWithout, testFacts, testPack } from '../../helpers/world-facts.ts';

// scan = runScanJob (in-process) on a snapshot of the sample world (Task 12), pack = testPack().

/** A scan that found nothing: every array empty, no tier and no coil heat. */
const EMPTY_SCAN: WorldScan = {
  id: '20261017T120000Z-000000', source: { kind: 'server' }, scannedAt: '2026-10-17T12:00:00.000Z', levelName: 'World',
  dims: [], bases: [], machines: [], pipes: [], power: [], logistics: [], storage: [],
  visitedDims: [], topTier: null, coilHeat: null, prospected: [],
};

let tmp: string, scan: WorldScan;

beforeAll(async () => {
  tmp = await mkdtemp(join(tmpdir(), 'gp-context-'));
  const { serverDir, worldDir } = await makeSampleWorld(join(tmp, 'srv'));
  const scanDir = join(tmp, 'scan');
  await mkdir(scanDir);
  scan = await runScanJob({
    scanId: '20261017T120000Z-000001', scanDir, request: { kind: 'server' },
    source: { kind: 'snapshot', worldDir, label: 'snapshot' }, serverDir, facts: testFacts(),
  }, () => {});
});
afterAll(() => rm(tmp, { recursive: true, force: true }));

it('builds the context of the main base', () => {
  const ctx = contextFromScan(scan, testPack(), '0:0:0');
  expect(ctx.ownedMachines).toEqual([{ mteId: 114, count: 1 }, { mteId: 125, count: 1 }, { mteId: 161, count: 1 },
    { mteId: 1000, count: 1 }, { mteId: 1120, count: 1 }, { mteId: 2001, count: 1 }]);
  expect(Object.fromEntries(ctx.storage)).toEqual(SAMPLE.totals);
  expect([ctx.topTier, ctx.coilHeat, ctx.visitedDims, ctx.prospected]).toEqual([1, 2701, SAMPLE.visitedDims, SAMPLE.prospected]);
  expect(ctx.power).toMatchObject({ voltageTier: 1, storedEU: 101_000, rainOutageSeconds: 480 });
  expect(ctx.power!.averageEUt).toBeCloseTo(6.444, 3);
  expect(ctx.power!.spareEUt).toBeCloseTo(4.444, 3);
});

it('builds the context of another base and drops machines the export does not know', () => {
  expect(contextFromScan(scan, testPack(), '-1:-1:-1')).toMatchObject({ ownedMachines: [{ mteId: 2002, count: 4 }], topTier: 2, coilHeat: null, power: undefined });
  const unknown = contextFromScan(scan, packWithout(testPack(), 2002), '-1:-1:-1');
  expect(unknown.ownedMachines).toEqual([]);
  expect(unknown.topTier).toBeNull();   // a machine the export does not know has no tier
});

it('takes every machine, network and storage block when no base is chosen', () => {
  const ctx = contextFromScan(scan, testPack(), null);
  expect(ctx.ownedMachines).toContainEqual({ mteId: 2002, count: 4 });
  expect(ctx.ownedMachines).toContainEqual({ mteId: 2001, count: 1 });
  expect(ctx.topTier).toBe(2);
  expect(Object.fromEntries(ctx.storage)).toEqual(SAMPLE.totals);   // every storage block is in the main base
  expect(ctx.power).toMatchObject({ voltageTier: 1, storedEU: 101_000 });
});

it('builds a valid context from an empty scan', () =>
  expect(contextFromScan(EMPTY_SCAN, testPack(), null)).toEqual({ ...emptyContext(), storage: new Map(), power: undefined }));

it('AE2 mode counts nothing reachable at a routed-only base', () =>
  expect(contextFromScan(scan, testPack(), '0:0:0', 'ae2').storage.get('minecraft:iron_ingot@0')).toMatchObject({ total: 4500, reachable: 0 }));

it('routed mode keeps 1,000 reachable', () =>
  expect(contextFromScan(scan, testPack(), '0:0:0', 'routed').storage.get('minecraft:iron_ingot@0')).toMatchObject({ total: 4500, reachable: 1000 }));

it('does not share arrays with the scan, which every caller reads', () => {
  const ctx = contextFromScan(scan, testPack(), '0:0:0');
  expect(ctx.visitedDims).not.toBe(scan.visitedDims);
  expect(ctx.prospected).not.toBe(scan.prospected);
});
