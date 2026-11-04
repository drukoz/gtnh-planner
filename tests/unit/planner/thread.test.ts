// The planning thread (RUK-563 milestone 2): each job answers what the same planner call gives on this thread, on the
// Mini-GT pack written as a real export; a job that throws rejects with its message, and a closed thread starts again.
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, expect, it } from 'vitest';
import { loadPack } from '../../../src/server/pack/load.ts';
import { expandBomLines } from '../../../src/server/planner/bom.ts';
import { bomBuildCost } from '../../../src/server/planner/build-cost.ts';
import { emptyContext, planLine } from '../../../src/server/planner/plan.ts';
import { linePricing } from '../../../src/server/planner/pricing.ts';
import { partSteps } from '../../../src/server/planner/steps.ts';
import { startPlanningThread, type PlanningThread } from '../../../src/server/planner/thread.ts';
import { defaultSettings } from '../../../src/shared/project/apply-op.ts';
import type { Pack } from '../../../src/shared/types/pack.ts';
import type { BomLine, PlanSettings } from '../../../src/shared/types/plan.ts';
import { toExportSpec } from '../../helpers/export-spec.ts';
import { makeExport } from '../../helpers/make-export.ts';
import { MINI_GT } from '../../helpers/mini-gt.ts';

/** plan.test.ts's LV circuit line: three steps (their ids are hashes in a loaded export). */
const SETTINGS: PlanSettings = { ...defaultSettings(), routeDerived: false, buildHorizonHours: null, target: 't:circuit@0', amount: 30, tier: 1 };
const NOTHING_READ = { offers: [], needs: [] };

let root = '';
let exportDir = '';
let pack: Pack;
let thread: PlanningThread;

beforeAll(async () => {
  root = mkdtempSync(join(tmpdir(), 'planning-thread-'));
  exportDir = await makeExport(join(root, 'export', 'mini'), toExportSpec(MINI_GT));
  pack = await loadPack(exportDir);
  thread = startPlanningThread();
}, 30_000);

afterAll(async () => {
  await thread.close();
  rmSync(root, { recursive: true, force: true });
});

it('plans as planLine does on this thread', async () => {
  const here = await planLine(pack, SETTINGS, emptyContext(), NOTHING_READ);
  expect(here.status).toBe('ok');
  expect(here.steps.length).toBe(3);
  const there = await thread.plan(exportDir, SETTINGS, emptyContext(), NOTHING_READ);
  expect(there).toStrictEqual(here);
  expect(JSON.stringify(there)).toBe(JSON.stringify(here));
}, 30_000);

it('gives the goods of the line linePricing walks, in its order, and null without a target', async () => {
  const pricing = linePricing(pack, SETTINGS, emptyContext());
  expect(pricing).not.toBeNull();
  const here = pricing === null ? [] : [...(await pricing).graph.goods.keys()];
  expect(here.length).toBeGreaterThan(0);
  expect(await thread.goods(exportDir, SETTINGS, emptyContext())).toStrictEqual(here);
  expect(await thread.goods(exportDir, { ...SETTINGS, target: null }, emptyContext())).toBeNull();
}, 30_000);

it('breaks the build down, prices it and words its steps as this thread does', async () => {
  const plan = await planLine(pack, SETTINGS, emptyContext(), NOTHING_READ);
  const lines = plan.buildList.map(({ key, amount, why, group }): BomLine => ({ key, amount, why, ...(group === undefined ? {} : { group }) }));
  expect(lines.length).toBeGreaterThan(0);
  const expansion = await expandBomLines(pack, lines, SETTINGS, emptyContext(), { steps: plan.steps });
  expect(expansion.totals.length).toBeGreaterThan(0);
  expect(await thread.expand(exportDir, lines, SETTINGS, emptyContext(), plan.steps)).toStrictEqual(expansion);
  const cost = await bomBuildCost(pack, SETTINGS, emptyContext(), lines);
  expect(await thread.layoutCost(exportDir, SETTINGS, emptyContext(), lines)).toBe(cost);
  const input = { steps: plan.steps, bom: { lines: expansion.lines, totals: expansion.totals, makes: expansion.makes ?? [] }, tier: plan.tier };
  const pricing = linePricing(pack, SETTINGS, emptyContext());
  const steps = partSteps(pricing === null ? pack : (await pricing).pack ?? pack, input);
  expect(steps.length).toBeGreaterThan(0);
  expect(await thread.partSteps(exportDir, SETTINGS, emptyContext(), input)).toStrictEqual(steps);
}, 30_000);

it('rejects a job that throws with its message, and answers the next job', async () => {
  const missing = join(root, 'export', 'missing');
  const here = await loadPack(missing).then(() => '', (err: unknown) => (err instanceof Error ? err.message : String(err)));
  expect(here).not.toBe('');
  await expect(thread.plan(missing, SETTINGS, emptyContext(), NOTHING_READ)).rejects.toThrow(here);
  expect((await thread.plan(exportDir, SETTINGS, emptyContext(), NOTHING_READ)).status).toBe('ok');
}, 30_000);

it('rejects the jobs of a closed thread, and the next job starts a new one', async () => {
  const unanswered = expect(thread.plan(exportDir, { ...SETTINGS, amount: 31 }, emptyContext(), NOTHING_READ))
    .rejects.toThrow('The planning thread stopped: it was closed');
  await thread.close();
  await unanswered;
  expect((await thread.plan(exportDir, SETTINGS, emptyContext(), NOTHING_READ)).status).toBe('ok');
}, 30_000);
