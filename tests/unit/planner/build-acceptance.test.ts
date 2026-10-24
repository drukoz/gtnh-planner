// Acceptance of plan 12 on synthetic packs (Task 8; design spec §3.2 Make N, §3.3 Objective and "Reusing machines we
// have", D1–D3): build cost flips a line between two routes as the horizon (or the batch) grows, and the user's request —
// cobblestone → gravel → sand on one forge hammer, as few machines as the logistics allow — end to end, from the plan to
// its layout. Everything here is invented (build-fixtures.ts), nothing is game data.

import { describe, expect, it } from 'vitest';
import { sandSpec, solderPackSpec } from '../../helpers/build-fixtures.ts';
import { makeProject } from '../../helpers/layout-fixtures.ts';
import { packFromSpec } from '../../helpers/pack-spec.ts';
import { checkPlanInvariants } from '../../helpers/plan-invariants.ts';
import { emptyScan, layoutLine } from '../../../src/server/layout/layout.ts';
import { emptyContext, planLine } from '../../../src/server/planner/plan.ts';
import { defaultSettings } from '../../../src/shared/project/apply-op.ts';
import type { Layout, LayoutBlock } from '../../../src/shared/types/layout.ts';
import type { LogisticsMode, Plan, PlanSettings } from '../../../src/shared/types/plan.ts';

const COBBLE = 'minecraft:cobblestone@0';
const GRAVEL = 'minecraft:gravel@0';
const SAND = 'minecraft:sand@0';
const FORGE_HAMMER = 481;
const ids = (plan: Plan): string[] => plan.steps.map((s) => s.id);
const errors = (pack: Parameters<typeof checkPlanInvariants>[0], s: PlanSettings, plan: Plan): string[] =>
  checkPlanInvariants(pack, s, plan, { buildCost: true }).filter((v) => v.severity === 'error').map((v) => `${v.kind}: ${v.message}`);

describe('the horizon flip on boards from tin or soldering alloy', () => {
  // A board takes a part and 144 L of molten tin (2 raw, two steps: assembler 16 + fluid extractor 12 = 28 to build) or
  // 72 L of molten soldering alloy (1.5 raw, three steps: + an alloy smelter 20 = 48). At "Some machines" (2 %, per new
  // machine block, against the least raw material S1 = 1.5 a board over the horizon); at the 50 % default the week does
  // not flip it (tin 616 < solder 678), so these cases set 2 %.
  const pack = packFromSpec(solderPackSpec());
  const boards = (p: Partial<PlanSettings>): Promise<Plan> =>
    planLine(pack, { ...defaultSettings(), target: 't:board@0', tier: 1, stepCharge: 0.02, ...p }, emptyContext());

  it('flips soldering alloy against tin with the horizon', async () => {
    // Relative to S1 over the horizon: 24 h → tin 4/3 + 0.04 + 28/36 = 2.151 < solder 1 + 0.06 + 48/36 = 2.393;
    // 1 week → tin 4/3 + 0.04 + 28/252 = 1.484 > solder 1 + 0.06 + 48/252 = 1.250.
    const day = await boards({ amount: 1, per: 'hour' });
    expect(day.status).toBe('ok');
    expect(ids(day)).toEqual(['board-tin', 'x-tin']);
    expect(day.cost).toEqual({ runPerHour: 2, build: 28, horizonHours: 24 });
    const week = await boards({ amount: 1, per: 'hour', buildHorizonHours: 168 });
    expect(ids(week)).toEqual(['alloy-solder', 'board-solder', 'x-solder']);
    expect(week.cost).toEqual({ runPerHour: 1.5, build: 48, horizonHours: 168 });
  });

  it('keeps Fewest machines within +25 % of the leanest line by default, and says what that line uses', async () => {
    // A week at Fewest machines (fix wave 3 (A)): tin trades 4/3 of soldering alloy's raw material for one block less
    // (616 < 678 by the build MIP's measure); the default cap keeps soldering alloy, "No limit" (null) takes tin.
    const capped = await boards({ amount: 1, per: 'hour', buildHorizonHours: 168, stepCharge: 0.5 });
    expect(ids(capped)).toEqual(['alloy-solder', 'board-solder', 'x-solder']);
    expect(capped.rawCost).toEqual({ perSecond: 0.000416666667, leastPerSecond: 0.000416666667, leanestPerSecond: 0.000416666667 });
    // At "No limit" the week's charge-0 start costs 1.19 σ, within LEAN_BASE_ABOVE: its leanest line could not change the
    // step charge, so none is solved or reported (controller OQ1 (D)).
    const unlimited = await boards({ amount: 1, per: 'hour', buildHorizonHours: 168, stepCharge: 0.5, rawCap: null });
    expect(ids(unlimited)).toEqual(['board-tin', 'x-tin']);
    expect(unlimited.rawCost).toEqual({ perSecond: 0.000555555556, leastPerSecond: 0.000416666667 });
    // With build cost ignored there is no leanest line to report.
    expect((await boards({ amount: 1, per: 'hour', buildHorizonHours: null, stepCharge: 0.5 })).rawCost?.leanestPerSecond).toBeUndefined();
  });

  it('flips it with the batch in Make N', async () => {
    // 10: tin 20 + 28 = 48 < solder 15 + 48 = 63; 100: tin 200 + 28 = 228 > solder 150 + 48 = 198 (5 whole alloy runs).
    const few = await boards({ mode: 'makeN', amount: 10 });
    expect(ids(few)).toEqual(['board-tin', 'x-tin']);
    expect(few.cost).toMatchObject({ build: 28, batch: 20 });
    const many = await boards({ mode: 'makeN', amount: 100 });
    expect(ids(many)).toEqual(['alloy-solder', 'board-solder', 'x-solder']);
    expect(many.cost).toMatchObject({ build: 48, batch: 150 });
  });
});

describe("the user's sand line", () => {
  // Glass at LV, 1 a minute, at 2 %, crafted by hand (as Task 5's `G`, whose arithmetic it shares: build-plan.test.ts's
  // sand cases). Sand from rock-breaker cobblestone on forge hammers, or dug.
  const pack = packFromSpec(sandSpec());
  const glass = (logistics: LogisticsMode): PlanSettings => ({
    ...defaultSettings(), target: 't:glass@0', tier: 1, amount: 1, per: 'min', stepCharge: 0.02, automateCrafting: false, logistics,
  });
  const laidOut = (plan: Plan, logistics: LogisticsMode): Promise<Layout> =>
    layoutLine(pack, plan, emptyScan(), makeProject({ logistics, scanId: null, baseId: null }));
  const hammers = (layout: Layout): LayoutBlock[] => layout.blocks.filter((b) => b.role === 'machine' && b.block.mteId === FORGE_HAMMER);
  const configureText = (layout: Layout, label: string): string[] =>
    layout.buildSteps.filter((b) => b.kind === 'configure' && b.text.startsWith(`${label}: `)).map((b) => b.text.slice(label.length + 2));

  it('makes sand from cobblestone on one forge hammer in AE2 lines and lays it out once', async () => {
    const settings = glass('ae2');
    const plan = await planLine(pack, settings, emptyContext());
    expect(plan.status).toBe('ok');
    const pool = { id: 'pool:hammer-gravel', steps: ['hammer-gravel', 'hammer-sand'] };
    for (const id of pool.steps) expect(plan.steps.find((s) => s.id === id)?.pool, id).toEqual(pool);
    expect(ids(plan)).not.toContain('gravel-hand');
    expect(plan.rawInputs).toEqual([]);
    expect(plan.cost?.build).toBe(37);   // rock breaker 4 + the one hammer 17 + furnace 16
    expect(errors(pack, settings, plan)).toEqual([]);
    // One machine block for the hammer, running both steps, with one ME Interface holding both patterns.
    const layout = await laidOut(plan, 'ae2');
    expect(hammers(layout).map((b) => [b.stepId, b.stepIds])).toEqual([['hammer-gravel', pool.steps]]);
    const iface = layout.blocks.filter((b) => b.role === 'interface' && b.label === 'ME Interface (Basic Forge Hammer)');
    expect(iface.map((b) => b.feed)).toEqual([{
      interface: {
        patterns: [{ inputs: [{ key: COBBLE, amount: 1 }], outputs: [{ key: GRAVEL, amount: 1 }] }, { inputs: [{ key: GRAVEL, amount: 1 }], outputs: [{ key: SAND, amount: 1 }] }],
        blocking: true,
      },
    }]);
    expect(configureText(layout, 'ME Interface (Basic Forge Hammer)'))
      .toEqual(['2 processing patterns; pattern 1: 1× Cobblestone → 1× Gravel; pattern 2: 1× Gravel → 1× Sand; blocking mode on']);
    expect(layout.buildSteps.find((b) => b.id === 'layout:place:hammer-gravel')?.text).toMatch(/; it runs Gravel and Sand$/);
    expect(layout.buildSteps.find((b) => b.id === 'layout:place:hammer-sand')).toBeUndefined();
  });

  it('gives each step its own hammer on Project Red lines, each with its own interface pipe', async () => {
    // Project Red shares no machine (fix wave 2 (d)): the gravel goes from one hammer to the other, as Project Red would
    // never route it back into the hammer that made it.
    const settings = glass('routed');
    const plan = await planLine(pack, settings, emptyContext());
    expect(plan.status).toBe('ok');
    expect(plan.steps.filter((s) => s.pool !== undefined)).toEqual([]);
    expect(plan.cost?.build).toBe(54);   // 4 + 2 × 17 + 16
    expect(errors(pack, settings, plan)).toEqual([]);
    const layout = await laidOut(plan, 'routed');
    expect(hammers(layout).map((b) => [b.stepId, b.stepIds])).toEqual([['hammer-gravel', undefined], ['hammer-sand', undefined]]);
    const pipes = layout.blocks.filter((b) => b.role === 'chip_pipe' && b.label === 'Routed Interface Pipe (Basic Forge Hammer)');
    const whitelist = (keys: string[]) => ({ mode: 'whitelist', keys });
    expect(pipes.map((b) => b.feed?.chips)).toEqual([
      [{ kind: 'responder', filter: whitelist([COBBLE]) }, { kind: 'extractor', filter: whitelist([GRAVEL]) }],
      [{ kind: 'responder', filter: whitelist([GRAVEL]) }, { kind: 'extractor', filter: whitelist([SAND]) }],
    ]);
    expect(configureText(layout, 'Routed Interface Pipe (Basic Forge Hammer)')).toEqual([
      'chips: Item Responder Chip (whitelist: Cobblestone) + Item Extractor Chip (whitelist: Gravel)',
      'chips: Item Responder Chip (whitelist: Gravel) + Item Extractor Chip (whitelist: Sand)',
    ]);
  });

  it('digs its sand on machine-to-machine lines', async () => {
    // Controller Amendment OQ4 (ruling P1): machine-to-machine lines dig gathered blocks until add-on 15 redesigns the
    // direct tail, so no forge hammer is laid and no hammer can catch the other's input from the shared pipe.
    const settings = glass('direct');
    const plan = await planLine(pack, settings, emptyContext());
    expect(plan.status).toBe('ok');
    expect(ids(plan)).toEqual(['smelt-glass']);
    expect(plan.rawInputs.map((r) => r.key)).toEqual([SAND]);
    expect(plan.cost?.build).toBe(16);
    expect(errors(pack, settings, plan)).toEqual([]);
    const layout = await laidOut(plan, 'direct');
    expect(hammers(layout)).toEqual([]);
    expect(layout.warnings.filter((w) => w.code === 'spine_misroute')).toEqual([]);
  });
});
