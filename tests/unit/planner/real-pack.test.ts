// Real-data smoke check (architecture §10): plans lines on the active export of this host. It runs only with
// GTNH_LOCAL=1 and is skipped everywhere else; nothing game-derived is read or written otherwise. Timings go to
// docs/local (git-ignored) when GTNH_PLANNER_TIMINGS names a file there.

import { appendFileSync } from 'node:fs';
import { describe, it, expect, beforeAll } from 'vitest';
import { activeExportDir, loadConfig } from '../../../src/server/config.ts';
import { loadPack } from '../../../src/server/pack/load.ts';
import { emptyContext, planLine } from '../../../src/server/planner/plan.ts';
import { defaultSettings } from '../../../src/shared/project/apply-op.ts';
import { FREE_KEYS, type Plan, type PlanSettings } from '../../../src/shared/types/plan.ts';
import type { Pack } from '../../../src/shared/types/pack.ts';

/** No free input (water, air, cobblestone, lava) above this many litres or items a minute: the old plans ran on millions. */
const SANE_FREE_PER_MINUTE = 100_000;
const FREE: ReadonlySet<string> = new Set(FREE_KEYS);

let pack: Pack;
/** The GregTech item of this name (several mods name an item "Steel Ingot"). */
const gt = (name: string): string => {
  const items = [...pack.items.values()].filter((item) => item.name === name);
  const item = items.find((i) => i.key.startsWith('gregtech:')) ?? items[0];
  expect(item, `an item named ${name}`).toBeDefined();
  return item!.key;
};
const machines = (plan: Plan): number => plan.steps.reduce((sum, s) => sum + s.count, 0);
const freePerMinute = (plan: Plan): number => Math.max(0, ...plan.rawInputs.filter((r) => FREE.has(r.key)).map((r) => r.perSecond * 60));

async function timed(label: string, settings: Partial<PlanSettings>): Promise<{ plan: Plan; seconds: number }> {
  const started = performance.now();
  const plan = await planLine(pack, { ...defaultSettings(), ...settings }, emptyContext());
  const seconds = (performance.now() - started) / 1000;
  const file = process.env.GTNH_PLANNER_TIMINGS;
  if (file !== undefined && file !== '') {
    appendFileSync(file, `${new Date().toISOString()}\t${pack.manifest.exportId}\t${label}\t${plan.status}\t${plan.steps.length} steps\t${machines(plan)} machines\t${seconds.toFixed(2)} s\n`);
  }
  return { plan, seconds };
}

/** What every ordinary plan must hold on real data (spec §5, plan Review Focus #3 and #4). */
function expectSane(plan: Plan, maxMachines: number): void {
  expect(plan.status, JSON.stringify(plan.warnings)).toBe('ok');
  expect(plan.steps.length).toBeGreaterThan(0);
  expect(plan.rawInputs.filter((r) => !r.available)).toEqual([]);
  expect(plan.rawInputs.filter((r) => !FREE.has(r.key)).length, 'something real goes in').toBeGreaterThan(0);
  expect(plan.warnings.filter((w) => ['free-loop', 'graph-too-big', 'batch-short'].includes(w.code))).toEqual([]);
  expect(freePerMinute(plan)).toBeLessThan(SANE_FREE_PER_MINUTE);
  expect(machines(plan)).toBeLessThanOrEqual(maxMachines);
  expect(plan.steps.filter((s) => /Eye of Harmony|Thermal Boiler|Thermal Refinery/.test(s.machine.name))).toEqual([]);
}

describe.skipIf(process.env.GTNH_LOCAL !== '1')('the active export', () => {
  beforeAll(async () => {
    pack = await loadPack(activeExportDir(loadConfig()));
  }, 120_000);

  it('plans 60 Electronic Circuits per hour at MV', async () => {
    const circuit = [...pack.items.values()].find((item) => item.name === 'Electronic Circuit');
    expect(circuit, 'an item named Electronic Circuit').toBeDefined();
    const { plan, seconds } = await timed('Electronic Circuit 60/h MV', { target: circuit!.key, amount: 60, per: 'hour', tier: 2 });
    expectSane(plan, 120);
    expect(plan.rawInputs.map((r) => pack.nameOf(r.key))).not.toContain('GregTech Sensor Card');
    expect(seconds).toBeLessThan(5);
  }, 300_000);

  it('plans 10 LV Machine Hulls a minute at LV from ordinary materials', async () => {
    const { plan, seconds } = await timed('LV Machine Hull 10/min LV', { target: gt('LV Machine Hull'), amount: 10, per: 'min', tier: 1 });
    expectSane(plan, 40);
    expect(seconds).toBeLessThan(5);
  }, 300_000);

  it('plans Steel Ingots at MV without buying a form of steel made from steel', async () => {
    const { plan, seconds } = await timed('Steel Ingot 10/min MV', { target: gt('Steel Ingot'), amount: 10, per: 'min', tier: 2 });
    expectSane(plan, 30);
    expect(plan.rawInputs.map((r) => pack.nameOf(r.key)).filter((name) => /Steel/.test(name))).toEqual([]);
    expect(seconds).toBeLessThan(5);
  }, 300_000);

  it('plans 2 Good Electronic Circuits a minute at HV without endgame multiblocks', async () => {
    const { plan, seconds } = await timed('Good Electronic Circuit 2/min HV', { target: gt('Good Electronic Circuit'), amount: 2, per: 'min', tier: 3 });
    expectSane(plan, 200);
    expect(seconds).toBeLessThan(5);
  }, 300_000);

  it('says what unlocks a titanium part at LV instead of planning one', async () => {
    const { plan, seconds } = await timed('Titanium Plate 1/min LV', { target: gt('Titanium Plate'), amount: 1, per: 'min', tier: 1 });
    expect(plan.status).toBe('infeasible');
    expect(plan.steps).toEqual([]);
    expect(plan.unlocks.length).toBeGreaterThan(0);
    expect(plan.unlocks[0]?.text).toMatch(/^Titanium .*: needs .*(reachable at|machines)/);
    expect(plan.warnings.filter((w) => w.code === 'graph-too-big')).toEqual([]);
    expect(seconds).toBeLessThan(5);
  }, 300_000);

  it('makes 64 LV Machine Hulls in a sane time with nothing short', async () => {
    const { plan, seconds } = await timed('LV Machine Hull x64 LV', { target: gt('LV Machine Hull'), mode: 'makeN', amount: 64, tier: 1 });
    expect(plan.status).toBe('ok');
    expect(plan.warnings.filter((w) => w.code === 'batch-short')).toEqual([]);
    expect(plan.makeN?.totalSeconds).toBeGreaterThan(0);
    expect(plan.makeN?.totalSeconds).toBeLessThan(24 * 3600);
    expect(seconds).toBeLessThan(5);
  }, 300_000);
});
