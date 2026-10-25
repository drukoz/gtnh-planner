// The build checks the real-data planner tests share (add-on 12 x 17 ruling R10: one copy of each): plan 12's
// calibration lines (`CASES`, made with `at`), the line's build MIP run on its own as `planLine` solves it (`buildRun`),
// and the new machine blocks a plan adds (`newBlocks`). real-build-cost.test.ts, real-raw-cap.test.ts and
// real-board.test.ts import them. Pack keys and settings only, never anything from a world.

import type { CandidateGraph } from '../../src/server/planner/candidates.ts';
import { lineBuildModel, type BuildModel } from '../../src/server/planner/machine-options.ts';
import { runningSupplies } from '../../src/server/planner/objective.ts';
import { groupStock, solveOptions, stockForm } from '../../src/server/planner/plan.ts';
import { linePricing } from '../../src/server/planner/pricing.ts';
import { solveLine, type Solution } from '../../src/server/planner/solve.ts';
import type { StuffKey } from '../../src/shared/keys.ts';
import { defaultSettings } from '../../src/shared/project/apply-op.ts';
import type { Pack } from '../../src/shared/types/pack.ts';
import type { Plan, PlanContext, PlanSettings } from '../../src/shared/types/plan.ts';

export const ELECTRONIC_CIRCUIT = 'IC2:itemPartCircuit@0';
export const GOOD_ELECTRONIC_CIRCUIT = 'gregtech:gt.metaitem.01@32702';
export const POLYETHYLENE_BAR = 'gregtech:gt.metaitem.01@11874';
export const STEEL_INGOT = 'gregtech:gt.metaitem.01@11305';
export const SECONDS_PER: Readonly<Record<PlanSettings['per'], number>> = { min: 60, hour: 3600 };

/** One calibration plan: its settings and whether two of every candidate machine of its line are owned (`owning`). */
export interface Case { name: string; settings: PlanSettings; owned: boolean }

/** `amount` of `target` a minute at `tier`, on the default settings with `more` over them. */
export const at = (target: StuffKey, tier: number, amount: number, more: Partial<PlanSettings> = {}): PlanSettings =>
  ({ ...defaultSettings(), per: 'min', target, tier, amount, ...more });

/**
 * The eleven calibration plans of plan 12 (seven nothing owned, two of them routed; four through `owning`) and the
 * Electronic Circuit at LV on AE2 (ruling P15).
 */
export const CASES: readonly Case[] = [
  { name: 'Electronic Circuit MV', settings: at(ELECTRONIC_CIRCUIT, 2, 1), owned: false },
  { name: 'Electronic Circuit MV on Project Red', settings: at(ELECTRONIC_CIRCUIT, 2, 1, { logistics: 'routed' }), owned: false },
  { name: 'Good Electronic Circuit HV', settings: at(GOOD_ELECTRONIC_CIRCUIT, 3, 1), owned: false },
  { name: 'Polyethylene Bar MV', settings: at(POLYETHYLENE_BAR, 2, 1), owned: false },
  { name: 'Steel Ingot MV x10', settings: at(STEEL_INGOT, 2, 10), owned: false },
  { name: 'Electronic Circuit LV', settings: at(ELECTRONIC_CIRCUIT, 1, 1), owned: false },
  { name: 'Electronic Circuit LV on Project Red', settings: at(ELECTRONIC_CIRCUIT, 1, 1, { logistics: 'routed' }), owned: false },
  { name: 'Electronic Circuit MV on Project Red', settings: at(ELECTRONIC_CIRCUIT, 2, 1, { logistics: 'routed' }), owned: true },
  { name: 'Polyethylene Bar MV', settings: at(POLYETHYLENE_BAR, 2, 1), owned: true },
  { name: 'Electronic Circuit LV', settings: at(ELECTRONIC_CIRCUIT, 1, 1), owned: true },
  { name: 'Electronic Circuit LV on Project Red', settings: at(ELECTRONIC_CIRCUIT, 1, 1, { logistics: 'routed' }), owned: true },
  { name: 'Electronic Circuit LV on AE2', settings: at(ELECTRONIC_CIRCUIT, 1, 1, { logistics: 'ae2' }), owned: false },
];

/** The line's build MIP run on its own, as `planLine` solves the line when nothing is avoided. */
export interface BuildRun {
  sol: Solution; model: BuildModel; graph: CandidateGraph;
  /** The line's first walk, before any recipe is walked around: its graph and build model (`optionMachines`' list for it). */
  first: { graph: CandidateGraph; model: BuildModel };
  /** Walks of the line, the last the one solved. */
  rounds: number;
  /** The step recipes the build models blocked (no machine that runs them can be built here or is owned), every walk's. */
  blocked: string[];
  /** How many of the pack's recipes alike to those were walked around with them (`BuildModel.blockedAlike`). */
  alike: number;
}

/**
 * The build MIP of the running line `s` on `pack` in the world `ctx`, run on its own (plan 12 Task 5's walk): its pricing
 * and build model, both made again without the recipes the model blocks (with the pack's alike ones) while it blocks any,
 * the model on the line's own pack (with its farm recipes, `LinePricing.pack`), as `planLine` does; then `solveLine` with
 * the model and what `planLine` passes it (ruling R10): the tools the line's farms wear as upkeep, in rate mode the farms
 * the group runs as capped free supplies (`runningSupplies`; no other project's surplus), and the group's stock
 * (`groupStock`, fix wave 3 (C); `stocked` false: none, the problem fix wave 3 (F) was set on), and `nodes` as its node
 * limit where given (`SolveOptions.buildMaxNodes`: `GTNH_BUILD_NODES` in real-build-cost).
 */
export async function buildRun(pack: Pack, ctx: PlanContext, s: PlanSettings, opts: { stocked?: boolean; nodes?: number } = {}): Promise<BuildRun> {
  const { stocked = true, nodes } = opts;
  const unbuildable = new Map<string, string>();
  const blocked = new Set<string>();
  let first: BuildRun['first'] | undefined;
  for (let rounds = 1; ; rounds++) {
    const pricing = linePricing(pack, s, ctx, { unbuildable });
    if (pricing === null) throw new Error(`no line for ${s.target}`);
    const priced = await pricing;
    const { graph, basis, target } = priced;
    const model = await lineBuildModel(priced.pack ?? pack, graph, basis, s, ctx);
    first ??= { graph, model };
    let grew = false;
    for (const [id, why] of model.blocked) {
      blocked.add(id);
      if (unbuildable.has(id)) continue;
      unbuildable.set(id, why);
      grew = true;
    }
    if (grew) {
      for (const [id, why] of model.blockedAlike ?? []) if (!unbuildable.has(id)) unbuildable.set(id, why);
      continue;
    }
    const sol = await solveLine(graph, new Map([[target, s.amount / SECONDS_PER[s.per]]]), {
      ...solveOptions(s, { upkeep: new Set(priced.farm?.tools.keys() ?? []), supplies: runningSupplies(s) }),
      formRank: stockForm(pack), ...(stocked ? { stock: groupStock(s, ctx) } : {}), build: model,
      ...(nodes === undefined ? {} : { buildMaxNodes: nodes }),
    });
    return { sol, model, graph, first, rounds, blocked: [...blocked].sort(), alike: unbuildable.size - blocked.size };
  }
}

/**
 * The new machine blocks `plan` adds: per step on a machine (a step by hand or on a pseudo machine aside) its machines
 * beyond the owned ones, a sharing pool's once.
 */
export function newBlocks(plan: Plan): number {
  const pools = new Set<string>();
  let n = 0;
  for (const s of plan.steps) {
    if (s.machine.mteId < 0) continue;
    if (s.pool !== undefined) {
      if (pools.has(s.pool.id)) continue;
      pools.add(s.pool.id);
    }
    n += Math.max(0, s.count - s.owned);
  }
  return n;
}
