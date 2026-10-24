// "Only these come in" (plan 12 fix wave 3 (B), the controller backlog's inputsOnly) on synthetic packs: with a list the
// line buys nothing outside it and the free inputs; every other good is made, or the plan says what nothing makes from
// the base materials; a stop item outside the list is made, with a warning; machine prices and the build list's
// breakdown do not read it. Everything here is invented (build-fixtures.ts), nothing is game data.

import { describe, expect, it } from 'vitest';
import { sandSpec, solderPackSpec } from '../../helpers/build-fixtures.ts';
import { packFromSpec } from '../../helpers/pack-spec.ts';
import { expandBomLines } from '../../../src/server/planner/bom.ts';
import { emptyContext, planLine } from '../../../src/server/planner/plan.ts';
import { defaultSettings } from '../../../src/shared/project/apply-op.ts';
import type { Plan, PlanSettings } from '../../../src/shared/types/plan.ts';

const ids = (plan: Plan): string[] => plan.steps.map((s) => s.id);
const rawKeys = (plan: Plan): string[] => plan.rawInputs.map((r) => r.key);

describe('only these come in, on boards from tin or soldering alloy', () => {
  // solderPackSpec: Partium Dust, Tin Ingot and Antimony Dust mined at 1 raw each. With build cost ignored and no step
  // charge (least raw material) a board takes 1.5 raw by soldering alloy (three steps) and 2 by tin (two steps).
  const pack = packFromSpec(solderPackSpec());
  const boards = (p: Partial<PlanSettings>): Promise<Plan> => planLine(pack, {
    ...defaultSettings(), target: 't:board@0', tier: 1, amount: 1, per: 'hour', buildHorizonHours: null, stepCharge: 0, ...p,
  }, emptyContext());

  it('plans with whatever may be bought when the list is empty', async () => {
    const open = await boards({ inputsOnly: [] });
    expect(ids(open)).toEqual(['alloy-solder', 'board-solder', 'x-solder']);
    expect(rawKeys(open)).toEqual(['t:antimony@0', 't:part@0', 't:tin_ingot@0']);
    expect(open.warnings.filter((w) => w.code === 'stop-outside-inputs')).toEqual([]);
  });

  it('makes or goes around what the list leaves out: no antimony comes in, so the boards take tin', async () => {
    const p = await boards({ inputsOnly: ['t:part@0', 't:tin_ingot@0'] });
    expect(p.status).toBe('ok');
    expect(ids(p)).toEqual(['board-tin', 'x-tin']);
    expect(rawKeys(p)).toEqual(['t:part@0', 't:tin_ingot@0']);
  });

  it('says what nothing makes from the base materials', async () => {
    const p = await boards({ inputsOnly: ['t:part@0', 't:antimony@0'] });
    expect(p.status).toBe('infeasible');
    expect(p.warnings).toContainEqual({ code: 'no-recipe', key: 't:tin_ingot@0', text: 'Nothing makes Tin Ingot from your base materials' });
    expect(p.warnings.some((w) => w.text.startsWith('Nothing in this pack makes'))).toBe(false);
  });

  it('makes a stop item the list leaves out, and says so; a listed stop item is still bought', async () => {
    const stop = { stopItems: ['t:solder_ingot@0'] };
    // Without a list the stop item is bought: no alloy smelter.
    expect(ids(await boards(stop))).toEqual(['board-solder', 'x-solder']);
    const made = await boards({ ...stop, inputsOnly: ['t:part@0', 't:tin_ingot@0', 't:antimony@0'] });
    expect(ids(made)).toEqual(['alloy-solder', 'board-solder', 'x-solder']);
    expect(rawKeys(made)).toEqual(['t:antimony@0', 't:part@0', 't:tin_ingot@0']);
    expect(made.warnings).toContainEqual({ code: 'stop-outside-inputs', key: 't:solder_ingot@0',
      // solderPackSpec names no solder ingot, so its name is its key
      text: 't:solder_ingot@0 is on “We already make” but not on “Only these come in”, so the planner does not buy it' });
    const listed = await boards({ ...stop, inputsOnly: ['t:part@0', 't:solder_ingot@0'] });
    expect(ids(listed)).toEqual(['board-solder', 'x-solder']);
    expect(rawKeys(listed)).toEqual(['t:part@0', 't:solder_ingot@0']);
    expect(listed.warnings.filter((w) => w.code === 'stop-outside-inputs')).toEqual([]);
  });

  it('holds where build cost counts too', async () => {
    // build-acceptance.test.ts's week at 2 %: soldering alloy; without antimony, tin.
    const week = { buildHorizonHours: 168, stepCharge: 0.02 };
    expect(ids(await boards(week))).toEqual(['alloy-solder', 'board-solder', 'x-solder']);
    const p = await boards({ ...week, inputsOnly: ['t:part@0', 't:tin_ingot@0'] });
    expect(ids(p)).toEqual(['board-tin', 'x-tin']);
    expect(p.cost).toEqual({ runPerHour: 2, build: 28, horizonHours: 168 });
  });
});

describe('only these come in, on glass from sand', () => {
  // sandSpec: glass is smelted from sand, a gathered block the line digs (a natural leaf); sand also comes from gravel on
  // a forge hammer, gravel from cobblestone (a free input the rock breaker makes) on the hammer or by hand.
  const pack = packFromSpec(sandSpec());
  const glass = (p: Partial<PlanSettings>): Promise<Plan> => planLine(pack, {
    ...defaultSettings(), target: 't:glass@0', tier: 1, amount: 1, per: 'min', buildHorizonHours: null, ...p,
  }, emptyContext());

  it('makes a natural good the list leaves out instead of digging it, from the free inputs', async () => {
    const dug = await glass({});
    expect(rawKeys(dug)).toEqual(['minecraft:sand@0']);
    const made = await glass({ inputsOnly: ['t:iron_ingot@0'] });
    expect(made.status).toBe('ok');
    expect(rawKeys(made).filter((k) => k !== 'minecraft:cobblestone@0')).toEqual([]);
    expect(ids(made)).toContain('hammer-sand');
    expect(made.flows.some((f) => f.key === 'minecraft:sand@0')).toBe(true);
  });

  it('breaks the build list and layout parts down as without the list', async () => {
    const lines = [{ key: 'machine:481@0', amount: 1, why: '1× Basic Forge Hammer', group: 'machines' as const }];
    const s: PlanSettings = { ...defaultSettings(), target: 't:glass@0', tier: 1, buildHorizonHours: null };
    const listed = await expandBomLines(pack, lines, { ...s, inputsOnly: ['t:iron_ingot@0'] }, emptyContext());
    expect(listed).toEqual(await expandBomLines(pack, lines, s, emptyContext()));
  });
});
