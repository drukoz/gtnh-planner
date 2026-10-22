// Add-on 17 Task 5: the three planning modes in the solver (architecture §11.45 (1), (3), (4); rulings R14, R15, S4, S6,
// S7, S9, S10). Which mode and horizon a project plans in (`objectiveOf`, `horizonHoursOf`, `buildCostCounts`); least raw,
// cheapest and best multi-output picking different lines; the multi-output weight, one horizon of the farm-free line's
// mean raw input per source (`sourceWeight`); the purchases the MIP drops kept out of the later stages; its start from
// cheapest's decision and its fallback; capped free supplies (farms the group runs, other projects' surplus) taken before
// buying; the byproducts of the line's own runs credited to other projects' needs; and the plan's supplies, upkeep, mode,
// source count and credits, with what a farm the group runs makes at its upkeep in the line's cost model. Solver cases
// run through `solvedWithBuild` (step charge 0); plan cases at this tree's defaults (ruling S9).

import { describe, it, expect, vi } from 'vitest';

// The multi-output start case reads the inputs `solveLine` hands the build MIP; every call runs the real `buildMip`.
vi.mock('../../../src/server/planner/build-mip.ts', async (importOriginal) => {
  const mod = await importOriginal<typeof import('../../../src/server/planner/build-mip.ts')>();
  return { ...mod, buildMip: vi.fn(mod.buildMip) };
});

import type { StuffKey } from '../../../src/shared/keys.ts';
import { indexPlan } from '../../../src/shared/plan/balance.ts';
import { defaultSettings } from '../../../src/shared/project/apply-op.ts';
import { defaultFarmSettings, type FarmSettings } from '../../../src/shared/types/farm.ts';
import type { Plan, PlanObjective, PlanSettings } from '../../../src/shared/types/plan.ts';
import { buildCostCounts } from '../../../src/server/planner/basis.ts';
import { buildMip, type BuildDecision, type BuildMipInput } from '../../../src/server/planner/build-mip.ts';
import { buildCandidates, type LeafOracle, type PlanEnv } from '../../../src/server/planner/candidates.ts';
import { buildCounts, lineBuildModel, type BuildModel } from '../../../src/server/planner/machine-options.ts';
import { buildFlows } from '../../../src/server/planner/machines.ts';
import {
  SOURCE_WEIGHT_HORIZONS, horizonHoursOf, objectiveOf, runningSupplies, sourceWeight, type Need, type Offer,
} from '../../../src/server/planner/objective.ts';
import { emptyContext, planLine } from '../../../src/server/planner/plan.ts';
import { linePricing } from '../../../src/server/planner/pricing.ts';
import { sig9 } from '../../../src/server/planner/round.ts';
import type { CreditColumn, Solution, SolveOptions, SupplyColumn } from '../../../src/server/planner/solve.ts';
import { opt, pressSpec, solvedWithBuild } from '../../helpers/build-fixtures.ts';
import { farmPack, farmSpec } from '../../helpers/farm-fixtures.ts';
import { miniGt } from '../../helpers/mini-gt.ts';
import { packFromSpec, type PackSpec, type RecipeSpec } from '../../helpers/pack-spec.ts';

const A = 't:a@0';
const B = 't:b@0';
const C = 't:c@0';
const T = 't:t@0';
const Y = 't:y@0';
const Z = 't:z@0';
const W = 't:w@0';
const P = 't:p@0';
const ASSEMBLER = 'gt.recipe.assembler';
const BENDER = 'gt.recipe.metalbender';
const TREE_FARM = 'gt.recipe.treefarm';
const SAW = 'gregtech:gt.metatool.01@10';
const KNIFE = 'gregtech:gt.metatool.01@34';
const RUBBER_WOOD = 't:rubber_wood@0';
const RESIN = 't:resin@0';
const PULP = 't:pulp@0';
const PLANTBALL = 't:plantball@0';
const RESIN_BOARD = 't:resin_board@0';
/** One a day: the demand of the solver cases, so a horizon of 24 hours is 24 units of the target. */
const DAILY = 1 / 3600;
/** The integrity warnings of a plan's flows (`indexPlan`): none in a plan that adds up. */
const INTEGRITY = ['orphan-input', 'short-input', 'multi-producer', 'bought-and-made'];

/** An assembler at LV, so the walk accepts the cases' recipes; their machine options are given by hand. */
function assemblerOnly(recipes: RecipeSpec[]): PackSpec {
  return { maps: [{ id: ASSEMBLER, name: 'Assembler' }], machines: [{ mteId: 121, name: 'Basic Assembler', tier: 1, maps: [ASSEMBLER] }], recipes };
}

/**
 * Three ways to one t, all 16 EU/t × 100 t: `r-least` (1 a + 1 b → 1 t: 2 raw a t), `r-cheap` (3 a + 2 c → 2 t: 2.5)
 * and `r-multi` (`multi` → `made` t; 3 a → 1 t: 3 raw, one input).
 */
function modesSpec(multi: Array<[StuffKey, number]> = [[A, 3]], made = 1): PackSpec {
  return assemblerOnly([
    { id: 'r-least', map: ASSEMBLER, in: [[A, 1], [B, 1]], out: [[T, 1]], eut: 16, dur: 100 },
    { id: 'r-cheap', map: ASSEMBLER, in: [[A, 3], [C, 2]], out: [[T, 2]], eut: 16, dur: 100 },
    { id: 'r-multi', map: ASSEMBLER, in: multi, out: [[T, made]], eut: 16, dur: 100 },
  ]);
}
const ABC: Record<StuffKey, number> = { [A]: 1, [B]: 1, [C]: 1 };
/** `r-least` on a machine of 60 raw, the other two on machines of 10. */
const MODES = { options: { 'r-least': [opt(301, 1, 0.2, 60)], 'r-cheap': [opt(302, 1, 0.2, 10)], 'r-multi': [opt(303, 1, 0.2, 10)] } };
const MULTI: SolveOptions = { multiOutput: true };

/** The rubber tree on a Tree Growth Simulator: Saw and Knife each worn 1/512 a run, 25 rubber wood and 5 resin a run. */
const FARM_RUBBER: RecipeSpec = {
  id: 'farm-rubber', map: TREE_FARM, in: [[SAW, 1, 1 / 512], [KNIFE, 1, 1 / 512]], out: [[RUBBER_WOOD, 25], [RESIN, 5]], eut: 30, dur: 100,
  meta: { farm: { kind: 'tgs', tier: 1, machines: [15541], parallel: 1, footprint: [7, 7, 7] } },
};
/** `farmSpec()` with `farm-rubber`, its outputs `out` (by default rubber wood, its main output, then resin). */
function rubberSpec(out: RecipeSpec['out'] = FARM_RUBBER.out): PackSpec {
  const spec = farmSpec();
  return { ...spec, recipes: [...(spec.recipes ?? []), { ...FARM_RUBBER, out }] };
}
const RUBBER_COSTS: Record<StuffKey, number> = { [RUBBER_WOOD]: 1, [RESIN]: 1, [SAW]: 2, [KNIFE]: 1 };
/**
 * The resin board line's machines, a Tree Growth Simulator of `build` raw. Rubber wood is a leaf the line may also make
 * (`alsoMade`): the walk of `solvedWithBuild` then reaches its farm, as the line's own walk reaches it with `farmMade`.
 */
function rubberSetup(build: number): Parameters<typeof solvedWithBuild>[3] {
  return {
    options: {
      'farm-rubber': [opt(15541, 1, 0.2, build)], 'cf-wood': [opt(161, 1, 0.1, 20)], 'cf-resin': [opt(162, 1, 1 / 15, 20)],
      'mace-wood': [opt(141, 1, 0.05, 15)], 'resin-board': [opt(121, 1, 0.2, 16)],
    },
    alsoMade: [RUBBER_WOOD],
  };
}
const TOOLS: ReadonlySet<StuffKey> = new Set([SAW, KNIFE]);

/** `use-y`: 1 y → 1 z. */
const USE_Y: RecipeSpec = { id: 'use-y', map: BENDER, in: [[Y, 1]], out: [[Z, 1]], eut: 16, dur: 20 };
/** `make-w`: 1 c → 1 y + 1 w, y listed first: its main output, though a line may run it for its w. */
const MAKE_W: RecipeSpec = { id: 'make-w', map: BENDER, in: [[C, 1]], out: [[Y, 1], [W, 1]], eut: 16, dur: 20 };
/** `split` (1 a → 1 t + 1 y), `make-y` (1 c → 1 y) and `more` (`USE_Y`, `MAKE_W`), on the bending map. */
function splitSpec(...more: RecipeSpec[]): PackSpec {
  return {
    maps: [{ id: BENDER, name: 'Bending Machine' }],
    machines: [{ mteId: 101, name: 'Basic Bending Machine', tier: 1, maps: [BENDER] }],
    recipes: [
      { id: 'split', map: BENDER, in: [[A, 1]], out: [[T, 1], [Y, 1]], eut: 16, dur: 20 },
      { id: 'make-y', map: BENDER, in: [[C, 1]], out: [[Y, 1]], eut: 16, dur: 20 },
      ...more,
    ],
  };
}
const SPLIT = {
  options: { split: [opt(101, 1, 1, 10)], 'make-y': [opt(102, 1, 1, 10)], 'use-y': [opt(103, 1, 1, 10)], 'make-w': [opt(104, 1, 1, 10)] },
};
/** Another project's need of y (ruling R15: no price, credits never enter the solve). */
const needOfY = (perSecond: number, by = 'B'): CreditColumn => ({ id: `need:${by}:${Y}`, key: Y, perSecond });

/** `solvedWithBuild`'s planning environment and leaves, for a graph a test builds itself (`buildFlows`). */
const ENV: PlanEnv = { tier: 1, reachable: new Set(['overworld']), lowGravity: false, coilHeat: 1801, excluded: new Set(defaultSettings().excludedCategories) };
const leafOf = (costs: Record<StuffKey, number>): LeafOracle => (key) =>
  (Object.hasOwn(costs, key) ? { buyable: true, cost: costs[key] as number, leafClass: 'direct' } : { buyable: false, cost: 0, leafClass: null });

/** The goods of `sol` bought at a cost above 0 by `costs`, upkeep aside. */
function boughtSources(sol: Solution, costs: Record<StuffKey, number>, upkeep: ReadonlySet<StuffKey> = new Set()): number {
  return [...sol.buys.keys()].filter((key) => (costs[key] ?? 0) > 0 && !upkeep.has(key)).length;
}

/** The project settings of a farm-pack case: the defaults, resin boards 1 a minute at LV, then the case's own. */
function boardSettings(c: Partial<PlanSettings> = {}): PlanSettings {
  return { ...defaultSettings(), target: RESIN_BOARD, amount: 1, per: 'min', tier: 1, ...c };
}
/** The default farm settings with `patch` over them. */
function farmsWith(patch: Partial<FarmSettings>): FarmSettings {
  return { ...defaultFarmSettings(), ...patch };
}
/** The tree farms only (none at LV) and the group's rubber farm of 2 a minute. */
const RUBBER_FARM: FarmSettings = farmsWith({ kinds: ['tgs'], running: [{ name: 'Forestry rubber farm', outputs: [{ key: RUBBER_WOOD, perMinute: 2 }] }] });

/** What flows from `raw` of `key` in `plan`, per second. */
function fromRaw(plan: Plan, key: StuffKey): number {
  let total = 0;
  for (const f of plan.flows) if (f.from === 'raw' && f.key === key) total += f.perSecond;
  return total;
}

describe('the mode and horizon a project plans with', () => {
  it('reads the mode and horizon of a project', () => {
    const cases: Array<[Partial<PlanSettings>, PlanObjective, number | null, boolean]> = [
      [{}, 'cheapest', 24, true],
      // the defaults' `objective: 'cheapest'` beside it, as add-on 12's test helpers build "Ignore build cost"
      [{ buildHorizonHours: null }, 'least-raw', null, false],
      [{ objective: 'least-raw', buildHorizonHours: 8 }, 'least-raw', null, false],
      [{ objective: 'multi-output', buildHorizonHours: 8 }, 'multi-output', 8, true],
      // a null horizon in rate mode
      [{ objective: 'multi-output', buildHorizonHours: null }, 'least-raw', null, false],
      [{ mode: 'makeN', objective: 'least-raw' }, 'least-raw', null, false],
      [{ mode: 'makeN', objective: 'cheapest', buildHorizonHours: null }, 'cheapest', null, true],
    ];
    for (const [patch, mode, hours, counts] of cases) {
      const s: PlanSettings = { ...defaultSettings(), ...patch };
      expect([objectiveOf(s), horizonHoursOf(s), buildCostCounts(s)], JSON.stringify(patch)).toEqual([mode, hours, counts]);
    }
    const stored: PlanSettings = { ...defaultSettings() };   // stored before both fields
    delete stored.objective;
    delete stored.buildHorizonHours;
    expect([objectiveOf(stored), horizonHoursOf(stored), buildCostCounts(stored)]).toEqual(['cheapest', 24, true]);
  });

  it('says build cost is not counted in least raw', async () => {
    const pack = miniGt();
    const circuits = (p: Partial<PlanSettings>): Promise<Plan> =>
      planLine(pack, { ...defaultSettings(), target: 't:circuit@0', tier: 1, ...p }, emptyContext());
    const least = await circuits({ objective: 'least-raw', buildHorizonHours: 24 });
    expect(least.status).toBe('ok');
    expect(least.objective).toBe('least-raw');
    // the cost line then reads "build cost not counted"
    expect(least.cost?.horizonHours).toBeNull();
    const cheapest = await circuits({ objective: 'cheapest', buildHorizonHours: 24 });
    expect(cheapest.objective).toBe('cheapest');
    expect(cheapest.cost?.horizonHours).toBe(24);
  });

  it('builds the model of the mode a project plans in', async () => {
    const pack = miniGt();
    const circuits = (p: Partial<PlanSettings>): PlanSettings => ({ ...defaultSettings(), target: 't:circuit@0', tier: 1, ...p });
    const modelOf = async (s: PlanSettings): Promise<BuildModel> => {
      const pricing = await linePricing(pack, s, emptyContext());
      if (pricing === null) throw new Error('no pricing');
      return lineBuildModel(pack, pricing.graph, pricing.basis, s, emptyContext());
    };
    // rate mode: the horizon of the mode, none in least raw whatever is stored
    const least = await modelOf(circuits({ objective: 'least-raw', buildHorizonHours: 8 }));
    expect([least.horizonSeconds, buildCounts(least)]).toEqual([null, false]);
    const multi = await modelOf(circuits({ objective: 'multi-output', buildHorizonHours: 8 }));
    expect([multi.horizonSeconds, buildCounts(multi)]).toEqual([28800, true]);
    // Make N counts the batch's build cost unless it plans least raw
    const batch = circuits({ mode: 'makeN', amount: 10 });
    expect(buildCounts(await modelOf(batch))).toBe(true);
    const leastBatch = { ...batch, objective: 'least-raw' as const };
    expect(buildCounts(await modelOf(leastBatch))).toBe(false);
    const planned = await planLine(pack, leastBatch, emptyContext());
    expect([planned.status, planned.objective, planned.cost?.horizonHours]).toEqual(['ok', 'least-raw', null]);
  });

  it('weighs a raw source at one horizon of the mean raw input', () => {
    expect(SOURCE_WEIGHT_HORIZONS).toBe(1);
    // 'picks a different line': 2 raw a t of two sources, 24 t over the horizon, σ = 48 → 24 raw, 0.5 of the MIP's unit
    expect(sourceWeight({ s1f: 2, k1f: 2, F: 24, sigma: 48 })).toBe(0.5);
    // a line of no source still weighs one input's worth (max(1, k1f))
    expect(sourceWeight({ s1f: 2, k1f: 0, F: 24, sigma: 48 })).toBe(1);
    expect(sourceWeight({ s1f: 1e-10, k1f: 1, F: 24, sigma: 48 })).toBe(0);
  });

  it('lists the farms the group runs as capped supplies', () => {
    const farms = farmsWith({
      running: [
        { name: 'Forestry rubber farm', outputs: [{ key: RUBBER_WOOD, perMinute: 2 }, { key: RESIN, perMinute: 1 }, { key: RUBBER_WOOD, perMinute: 1 }] },
        { name: 'Second farm', outputs: [{ key: RUBBER_WOOD, perMinute: 6 }] },
      ],
    });
    // one column per farm and good, its outputs of one good summed
    expect(runningSupplies({ ...defaultSettings(), farms })).toEqual([
      { id: `farm:0:${RUBBER_WOOD}`, key: RUBBER_WOOD, perSecond: 3 / 60, name: 'Forestry rubber farm' },
      { id: `farm:0:${RESIN}`, key: RESIN, perSecond: 1 / 60, name: 'Forestry rubber farm' },
      { id: `farm:1:${RUBBER_WOOD}`, key: RUBBER_WOOD, perSecond: 6 / 60, name: 'Second farm' },
    ]);
    expect(runningSupplies(defaultSettings())).toEqual([]);
  });
});

describe('the three modes in the solver', () => {
  it('picks a different line in each mode', async () => {
    // over 24 h: least 48 + 60, cheap 60 + 10, multi 72 + 10
    const least = await solvedWithBuild(modesSpec(), ABC, [[T, DAILY]], { ...MODES, horizonSeconds: null });
    expect(least.runs).toEqual(['r-least']);
    expect(least.sol.sources).toBe(2);
    expect(least.sol.farmFree).toBeUndefined();   // build cost does not count
    const cheapest = await solvedWithBuild(modesSpec(), ABC, [[T, DAILY]], MODES);
    expect(cheapest.runs).toEqual(['r-cheap']);
    expect(cheapest.sol.sources).toBe(2);
    // weight 24 per source, σ = 48: least 156, cheap 118, multi 106
    const multi = await solvedWithBuild(modesSpec(), ABC, [[T, DAILY]], MODES, MULTI);
    expect(multi.runs).toEqual(['r-multi']);
    expect(multi.sol.sources).toBe(1);
    // no farm: S1's (scaled, not rounded to 9 digits)
    expect(multi.sol.farmFree?.sources).toBe(2);
    expect(Math.abs((multi.sol.farmFree?.raw ?? 0) - 2 * DAILY)).toBeLessThanOrEqual(1e-12);
  });

  it('pays at most one horizon of the mean input to drop a source', async () => {
    // multi 108 + 10 + 24 = 142 > 118
    const nine = await solvedWithBuild(modesSpec([[A, 9]], 2), ABC, [[T, DAILY]], MODES, MULTI);
    expect(nine.runs).toEqual(['r-cheap']);
    // The walk keeps a producer within twice the cheapest estimate (2 raw a t), so 9 a → 2 t (4.5) never reaches the
    // MIP; these two do, a quarter of a raw unit a t either side of cheap's 2.5 + the one mean input (1 a t) it saves:
    // 3.75 a t costs 90 + 10 + 24 = 124 > 118, 3.25 a t 78 + 10 + 24 = 112 < 118.
    const dearer = await solvedWithBuild(modesSpec([[A, 15]], 4), ABC, [[T, DAILY]], MODES, MULTI);
    expect(dearer.runs).toEqual(['r-cheap']);
    const cheaper = await solvedWithBuild(modesSpec([[A, 13]], 4), ABC, [[T, DAILY]], MODES, MULTI);
    expect(cheaper.runs).toEqual(['r-multi']);
  });

  it('keeps out the sources the MIP dropped', async () => {
    // r-x (1 a + 1 p → 1 t) and r-p (2 a → 1 p); p is a leaf the line may also make
    const spec = assemblerOnly([
      { id: 'r-x', map: ASSEMBLER, in: [[A, 1], [P, 1]], out: [[T, 1]], eut: 16, dur: 100 },
      { id: 'r-p', map: ASSEMBLER, in: [[A, 2]], out: [[P, 1]], eut: 16, dur: 100 },
    ]);
    const costs = { [A]: 1, [P]: 1.5 };
    const setup = { options: { 'r-x': [opt(311, 1, 0.2, 10)], 'r-p': [opt(312, 1, 0.2, 10)] }, alsoMade: [P] };
    // buying p: 60 + 10, against making it: 72 + 20
    const cheapest = await solvedWithBuild(spec, costs, [[T, DAILY]], setup);
    expect(cheapest.runs).toEqual(['r-x']);
    expect(cheapest.sol.buys.get(P)).toBeGreaterThan(0);
    // weight 30 raw: making p 72 + 20 + 30 = 122 against buying it 60 + 10 + 60 = 130; without `dropped` stage 5 would
    // buy p again (1.5 raw against 2 a to make it) and leave r-p's machine idle
    const multi = await solvedWithBuild(spec, costs, [[T, DAILY]], setup, MULTI);
    expect(multi.runs).toEqual(['r-p', 'r-x']);
    expect(multi.sol.buys.has(P)).toBe(false);
    expect(multi.sol.sources).toBe(1);
  });

  it('weighs sources against the line without its farms', async () => {
    const demand: Array<[StuffKey, number]> = [[RESIN_BOARD, DAILY]];
    const upkeep: SolveOptions = { upkeep: TOOLS };
    // 25/6 rubber wood a board: 100 raw over 24 h, against a Tree Growth Simulator of 150: 171 against 206.05
    const cheapest = await solvedWithBuild(rubberSpec(), RUBBER_COSTS, demand, rubberSetup(150), upkeep);
    expect(cheapest.runs).toEqual(['cf-resin', 'cf-wood', 'mace-wood', 'resin-board']);
    expect(cheapest.sol.sources).toBe(1);
    // weight 100 raw: without the farm 171 + 100 = 271; with it the farm's wood is free, so 8 wood centrifuge runs a
    // board make the 2 pulp (8/3600 runs a second still fit the one centrifuge) and the macerator's 15 is saved: 150 +
    // 20 + 20 + 16 + 0.045 of tool wear = 206.05, against 221.02 with mace-wood
    const multi = await solvedWithBuild(rubberSpec(), RUBBER_COSTS, demand, rubberSetup(150), { ...upkeep, ...MULTI });
    expect(multi.runs).toEqual(['cf-resin', 'cf-wood', 'farm-rubber', 'resin-board']);
    expect(multi.sol.sources).toBe(0);
    expect(multi.sol.farmFree?.sources).toBe(1);
    expect(Math.abs((multi.sol.farmFree?.raw ?? 0) - (25 / 6) * DAILY)).toBeLessThanOrEqual(1e-12);
    // a farm of 250: 306.05 > 271
    const dear = await solvedWithBuild(rubberSpec(), RUBBER_COSTS, demand, rubberSetup(250), { ...upkeep, ...MULTI });
    expect(dear.runs).not.toContain('farm-rubber');
    expect(dear.sol.sources).toBe(1);
    // least raw: 1/1024 raw of tool wear a board, the macerator's 1/6 wood a board needing the least farm work
    const least = await solvedWithBuild(rubberSpec(), RUBBER_COSTS, demand, { ...rubberSetup(150), horizonSeconds: null }, upkeep);
    expect(least.runs).toContain('farm-rubber');
    expect(least.runs).toContain('mace-wood');
    expect(least.sol.sources).toBe(0);
  });

  it('measures the step charge against the line without its farms', async () => {
    // A farm whose main output (resin, listed first) is no leaf the line also makes: S1g leaves it out all the same
    // (ruling S7), so σ is the farm-free 25/6 rubber wood a board over 24 h, 100 raw, never its tool wear (σ = 1), and the
    // build MIP's objective is the cheapest plan's 171 raw in units of 100.
    const spec = rubberSpec([[RESIN, 5], [RUBBER_WOOD, 25]]);
    const { runs, sol } = await solvedWithBuild(spec, RUBBER_COSTS, [[RESIN_BOARD, DAILY]], rubberSetup(150), { upkeep: TOOLS });
    expect(runs).toEqual(['cf-resin', 'cf-wood', 'mace-wood', 'resin-board']);
    expect(sol.buildStats?.objective).toBeCloseTo(1.71, 4);
  });
});

describe('capped supplies and credits', () => {
  it('takes a capped free supply before buying', async () => {
    const supplies: SupplyColumn[] = [{ id: `farm:0:${A}`, key: A, perSecond: 0.5 }];
    const options = { options: { press: [opt(101, 1, 1, 10)] } };
    const full = await solvedWithBuild(pressSpec(), { [A]: 1 }, [[T, 1]], options, { supplies });
    expect(full.sol.supplied?.get(`farm:0:${A}`)).toBe(0.5);
    expect(full.sol.buys.get(A)).toBe(0.5);
    expect(full.sol.sources).toBe(1);
    // bought and supplied together reach the press from `raw`
    const graph = buildCandidates(packFromSpec(pressSpec()), defaultSettings(), ENV, leafOf({ [A]: 1 }), [T]);
    expect(buildFlows(graph, full.sol, [T]).filter((f) => f.key === A)).toEqual([{ from: 'raw', to: 'press', key: A, perSecond: 1 }]);
    for (const horizonSeconds of [86400, null]) {
      const part = await solvedWithBuild(pressSpec(), { [A]: 1 }, [[T, 0.2]], { ...options, horizonSeconds }, { supplies });
      expect(part.sol.supplied?.get(`farm:0:${A}`), `horizon ${horizonSeconds}`).toBe(0.2);
      expect(part.sol.buys.has(A), `horizon ${horizonSeconds}`).toBe(false);
      expect(part.sol.sources, `horizon ${horizonSeconds}`).toBe(0);
      expect(buildFlows(graph, part.sol, [T]).filter((f) => f.key === A)).toEqual([{ from: 'raw', to: 'press', key: A, perSecond: 0.2 }]);
    }
    // A good the line cannot buy, wholly supplied (another project's y), needs no step that makes it: the build MIP's
    // valid rows read a supply as a purchase, so its bound meets its objective, use-y's machine of 10 alone (σ = 1).
    const offered: SupplyColumn[] = [{ id: `project:p:${Y}`, key: Y, perSecond: 0.1 }];
    const unbought = await solvedWithBuild(splitSpec(USE_Y), { [A]: 1, [C]: 1 }, [[Z, 0.05]], SPLIT, { supplies: offered });
    expect(unbought.runs).toEqual(['use-y']);
    expect(unbought.sol.supplied?.get(`project:p:${Y}`)).toBe(0.05);
    expect(unbought.sol.buildStats).toMatchObject({ status: 'optimal', objective: 10, bound: 10 });
  });

  it('credits the byproducts another project needs, in multi-output only', async () => {
    const costs = { [A]: 1, [C]: 1 };
    const demand: Array<[StuffKey, number]> = [[T, 0.2]];
    const cheapest = await solvedWithBuild(splitSpec(), costs, demand, SPLIT, { credits: [needOfY(0.1)] });
    expect(cheapest.sol.credited?.size ?? 0).toBe(0);
    expect(cheapest.runs).toEqual(['split']);
    // the y `split` makes anyway
    const multi = await solvedWithBuild(splitSpec(), costs, demand, SPLIT, { ...MULTI, credits: [needOfY(0.1)] });
    expect(multi.sol.credited).toEqual(new Map([[`need:B:${Y}`, 0.1]]));
    expect(multi.runs).toEqual(['split']);
    // ruling R15: a need beyond it gets all the y of the 0.2 runs a second the line needs, and the line grows nothing
    const more = await solvedWithBuild(splitSpec(), costs, demand, SPLIT, { ...MULTI, credits: [needOfY(0.5)] });
    expect(more.sol.credited).toEqual(new Map([[`need:B:${Y}`, 0.2]]));
    expect(more.runs).toEqual(['split']);
    expect(more.sol.runs.get('split')).toBe(0.2);
    expect(more.sol.buys.has(Y)).toBe(false);
    // y also buyable at 0.5: still no y bought, nothing passed through
    const buyable = await solvedWithBuild(splitSpec(), { ...costs, [Y]: 0.5 }, demand, SPLIT, { ...MULTI, credits: [needOfY(0.5)] });
    expect(buyable.sol.buys.has(Y)).toBe(false);
    expect(buyable.sol.credited).toEqual(new Map([[`need:B:${Y}`, 0.2]]));
    expect(buyable.sol.runs.get('split')).toBe(0.2);
    // two needs of y, in their order (the older project first, ruling R16)
    const two = await solvedWithBuild(splitSpec(), costs, demand, SPLIT, { ...MULTI, credits: [needOfY(0.15, 'B'), needOfY(0.15, 'A')] });
    expect(two.sol.credited).toEqual(new Map([[`need:A:${Y}`, 0.05], [`need:B:${Y}`, 0.15]]));
    // what the line uses of it itself is not credited: 0.05 z a second takes 0.05 of the 0.2 y
    const used = await solvedWithBuild(splitSpec(USE_Y), costs, [[T, 0.2], [Z, 0.05]], SPLIT, { ...MULTI, credits: [needOfY(0.5)] });
    expect(used.runs).toEqual(['split', 'use-y']);
    expect(used.sol.credited).toEqual(new Map([[`need:B:${Y}`, 0.15]]));
    // nor the y of a recipe whose main output it is, though the line runs `make-w` for its w and sinks that y: of the
    // 0.3 y it makes and 0.15 it sinks, only `split`'s 0.2 less the line's own 0.15 is credited (ruling R14's B_g)
    const demands: Array<[StuffKey, number]> = [[T, 0.2], [W, 0.1], [Z, 0.15]];
    const mainMade = await solvedWithBuild(splitSpec(USE_Y, MAKE_W), costs, demands, SPLIT, { ...MULTI, credits: [needOfY(0.5)] });
    expect(mainMade.runs).toEqual(['make-w', 'split', 'use-y']);
    expect(mainMade.sol.sinks.get(Y)).toBeCloseTo(0.15, 9);
    expect(mainMade.sol.credited).toEqual(new Map([[`need:B:${Y}`, 0.05]]));
    // and what goes out as the line's own target is no surplus: of split's 0.2 y, 0.05 is the target and 0.15 is sunk
    const target = await solvedWithBuild(splitSpec(), costs, [[T, 0.2], [Y, 0.05]], SPLIT, { ...MULTI, credits: [needOfY(0.5)] });
    expect(target.runs).toEqual(['split']);
    expect(target.sol.credited).toEqual(new Map([[`need:B:${Y}`, 0.15]]));
  });

  it('starts the multi-output MIP from cheapest\'s decision', async () => {
    const spy = vi.mocked(buildMip);
    spy.mockClear();
    const multi = await solvedWithBuild(modesSpec(), ABC, [[T, DAILY]], MODES, MULTI);
    expect(multi.runs).toEqual(['r-multi']);
    // first the build MIP as cheapest solves it (no source binaries), then the multi-output one from its solution
    const [pre, withSources] = spy.mock.calls.map(([input]) => input) as [BuildMipInput, BuildMipInput];
    expect(pre.sources).toBeUndefined();
    expect(pre.start).toBeUndefined();
    const sources = withSources.sources as NonNullable<BuildMipInput['sources']>;
    const x = withSources.start as readonly number[];
    const { lp } = pre;
    const runsOf = (d: BuildDecision): string[] => [...d.support].map((j) => lp.recipes[j]?.id ?? '').sort();
    expect(runsOf(buildMip(pre).decode(x))).toEqual(['r-cheap']);
    // the purchase columns of a, b and c, each at one horizon of the mean input: 24 raw of σ = 48
    expect(sources.columns.map((j) => lp.buyKeys[j - lp.firstBuy])).toEqual([A, B, C]);
    expect(sources.weight).toBeCloseTo(0.5, 12);
    // the model's start is x with s_j 1 on the purchase columns of a and c and 0 on b's
    const mip = buildMip({ ...pre, sources, start: x });
    expect(mip.start).toEqual([...x, 1, 0, 1]);
    // add-on 12's skip to the fallback: both MIPs skipped, the plan says so twice
    const fallback = await solvedWithBuild(modesSpec(), ABC, [[T, DAILY]], MODES, { ...MULTI, buildTimeLimit: 0 });
    const codes = fallback.sol.warnings.map((w) => w.code);
    expect(codes).toContain('build-cost-approx');
    expect(codes).toContain('sources-approx');
    expect(fallback.sol.warnings.find((w) => w.code === 'sources-approx')?.text)
      .toBe('Finding the fewest different raw materials took too long; this plan may need more of them than it could');
    expect(fallback.sol.sources).toBe(boughtSources(fallback.sol, ABC));
    expect(fallback.sol.buildStats).toMatchObject({ status: 'skipped', approx: true, nodes: 0 });
  });
});

describe('the modes in the plan', () => {
  it('lists supplies, upkeep and the mode in the plan', async () => {
    const pack = farmPack();
    const offers: Offer[] = [{ from: 'p2', name: 'Rubber line', key: RUBBER_WOOD, perSecond: 1 / 60 }];
    const needs: Need[] = [{ by: 'p3', name: 'Glue line', key: PLANTBALL, perSecond: 0.01 }];
    const farmRow = {
      key: RUBBER_WOOD, perSecond: sig9(2 / 60), cost: 0, available: true, sources: [],
      from: { kind: 'farm', id: `farm:0:${RUBBER_WOOD}`, name: 'Forestry rubber farm' },
    };
    const rubberRows = (plan: Plan): Plan['rawInputs'] => plan.rawInputs.filter((r) => r.key === RUBBER_WOOD);
    /** The bought row of rubber wood: first, no `from`, at `perSecond` to 9 decimals (the LP's tolerances move its last digit). */
    const boughtRow = (plan: Plan, perSecond: number): void => {
      const row = rubberRows(plan)[0];
      expect(row?.from).toBeUndefined();
      expect(row?.cost).toBeGreaterThan(0);
      expect(row?.perSecond).toBeCloseTo(perSecond, 9);
    };
    const plain = (plan: Plan): void => {
      expect(plan.status).toBe('ok');
      expect(plan.warnings.filter((w) => INTEGRITY.includes(w.code))).toEqual([]);
      // the flows bring rubber wood from `raw` at the bought and supplied rates together
      let total = 0;
      for (const r of rubberRows(plan)) total += r.perSecond;
      expect(fromRaw(plan, RUBBER_WOOD)).toBeCloseTo(total, 9);
      expect(total).toBeCloseTo(25 / 6 / 60, 9);
    };

    const cheapest = await planLine(pack, boardSettings({ farms: RUBBER_FARM }), emptyContext());
    plain(cheapest);
    expect(rubberRows(cheapest)).toEqual([expect.objectContaining({ key: RUBBER_WOOD }), farmRow]);
    boughtRow(cheapest, (25 / 6 - 2) / 60);
    expect(cheapest.objective).toBe('cheapest');
    expect(cheapest.rawSources).toBe(1);
    expect(cheapest.credits).toBeUndefined();
    // the same supplied good is no bought-and-made issue in the plan's own index either
    expect(indexPlan(cheapest).issues).toEqual([]);

    const drawing = await planLine(pack, boardSettings({ farms: RUBBER_FARM }), emptyContext(), { offers });
    plain(drawing);
    expect(rubberRows(drawing)).toEqual([
      expect.objectContaining({ key: RUBBER_WOOD }),
      farmRow,
      { key: RUBBER_WOOD, perSecond: sig9(1 / 60), cost: 0, available: true, sources: [], from: { kind: 'project', id: 'p2', name: 'Rubber line' } },
    ]);
    boughtRow(drawing, (25 / 6 - 3) / 60);
    expect(drawing.rawSources).toBe(1);

    // best multi-output, credited for another project's plantball: 4 wood centrifuge runs × 0.375 + 1 resin centrifuge
    // run × 0.1 a board, credited goods counting as surplus
    const multi = await planLine(pack, boardSettings({ farms: RUBBER_FARM, objective: 'multi-output' }), emptyContext(), { needs });
    plain(multi);
    expect(multi.objective).toBe('multi-output');
    expect(multi.credits).toEqual([{ to: 'p3', name: 'Glue line', key: PLANTBALL, perSecond: 0.01 }]);
    expect(multi.byproducts.find((p) => p.key === PLANTBALL)?.amount).toBeCloseTo(1.6 / 60, 9);
    let sunk = 0;
    for (const f of multi.flows) if (f.to === 'sink' && f.key === PLANTBALL) sunk += f.perSecond;
    expect(sunk).toBeGreaterThanOrEqual(0.01);
    expect(sunk).toBeCloseTo(1.6 / 60, 9);
    // cheapest reads no needs
    const notCredited = await planLine(pack, boardSettings({ farms: RUBBER_FARM }), emptyContext(), { needs });
    expect(notCredited.credits).toBeUndefined();

    // An owned Tree Growth Simulator tops the farm's 2 a minute up: its tools are upkeep, never a raw source, and a supply
    // topped up by a step is no bought-and-made issue (`indexPlan` counts only the bought share of the `raw` flows)
    const owned = await planLine(pack, boardSettings({ farms: RUBBER_FARM, ownedManual: [{ mteId: 15541, count: 1 }] }), emptyContext());
    expect(owned.status).toBe('ok');
    expect(owned.steps.find((s) => s.farm?.kind === 'tgs')?.mainOutput).toBe(RUBBER_WOOD);
    expect(rubberRows(owned)).toEqual([farmRow]);
    expect(fromRaw(owned, RUBBER_WOOD)).toBeCloseTo(2 / 60, 9);
    expect(owned.warnings.filter((w) => INTEGRITY.includes(w.code))).toEqual([]);
    expect(owned.rawInputs.filter((r) => r.upkeep === true).map((r) => r.key).sort()).toEqual([SAW, KNIFE].sort());
    expect(owned.rawSources).toBe(0);
  });

  it('prices what a farm the group runs makes at its upkeep', async () => {
    const pack = farmPack();
    const running = boardSettings({ farms: RUBBER_FARM });
    const pricing = await linePricing(pack, running, emptyContext());
    expect(pricing?.model.costs.cost(RUBBER_WOOD)).toBe(0);
    /** The `mace-wood` row of the swap list of the step that makes Wood Pulp. */
    const maceRow = async (s: PlanSettings): Promise<number | undefined> => {
      const plan = await planLine(pack, s, emptyContext());
      const pulp = plan.steps.find((step) => step.mainOutput === PULP);
      return pulp?.alternatives.find((a) => a.recipeId === 'mace-wood')?.rawCost;
    };
    expect(await maceRow(running)).toBe(0);
    // without the farm it reads 1/6 (a sixth of a rubber wood a pulp), and in Make N, which has no supplies
    const plainFarms = boardSettings({ farms: farmsWith({ kinds: ['tgs'] }) });
    expect((await linePricing(pack, plainFarms, emptyContext()))?.model.costs.cost(RUBBER_WOOD)).toBe(1);
    expect(await maceRow(plainFarms)).toBeCloseTo(1 / 6, 6);
    const batch = boardSettings({ farms: RUBBER_FARM, mode: 'makeN', amount: 100 });
    expect((await linePricing(pack, batch, emptyContext()))?.model.costs.cost(RUBBER_WOOD)).toBe(1);
    expect(await maceRow(batch)).toBeCloseTo(1 / 6, 6);
  });
});
