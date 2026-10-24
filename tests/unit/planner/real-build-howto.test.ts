// Real-data audit of the build list you can follow (add-on 14 Task 8, Defects F1–F4 and S5; architecture §11 entry 41):
// the user's Electronic Circuit line, planned with their settings exactly as stored (this worktree's gitignored copy,
// docs/local/ec-state.json, through normalizeSettings) and no world scan, as plan 09's real tests plan; and the user's live
// projects (ruling 94, M6), planned from a sqlite3 .backup copy of the main checkout's database in the gitignored
// docs/local/plan-14-ledger/, each finished with its line layout and no scan, as the plan route finishes a plan. It runs
// only with GTNH_LOCAL=1 and is skipped everywhere else (the live-project block also without the database copy). It
// prints its figures and writes them to docs/local/plan-14-ledger/audit.txt for the ledger; nothing here quotes the
// settings, a project or an amount of them. The cases assert properties and ceilings, never a measured figure: a bound
// that fails is a regression to investigate and report, never a number to raise.
//
// Measured on export 2.9.0-RC-1_20261020-204809 (2026-10-23): the Electronic Circuit line has 94 make, 31 craft and 0
// gather part steps and 0 unmade parts, and every bound of its cases held. The live projects' builds keep the EC line's
// bounds but its two fluid ceilings: there a fluid total, free or not, fails above LIVE_FLUID_MAX (the controller's
// ruling on ruling 94's bounds), as a live build may take more of a free fluid, or of another fluid, than the EC line's
// ceilings by a strictly cheaper route (free inputs cost nothing, spec §3.3); a live total above the EC line's free-fluid
// or other-fluid ceiling is printed and written to the audit file per project and view, by bound and fluid, never failed.

import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { activeExportDir, loadConfig } from '../../../src/server/config.ts';
import { openDb, type Db } from '../../../src/server/db/db.ts';
import { createLayoutService } from '../../../src/server/layout/service.ts';
import { loadPack } from '../../../src/server/pack/load.ts';
import { CIRCUIT_STAND_IN_IDS } from '../../../src/server/pack/stand-ins.ts';
import { buildBom, expandBomLines, partName, type Bom, type BomMake } from '../../../src/server/planner/bom.ts';
import { itemPrices, minimalHatch, NOTHING_TO_PLACE, structureParts } from '../../../src/server/planner/build-cost.ts';
import { EXCLUSION_RULES, type LeafOracle } from '../../../src/server/planner/candidates.ts';
import { makePrices } from '../../../src/server/planner/costs.ts';
import { emptyContext, planLine } from '../../../src/server/planner/plan.ts';
import { lineLeaf, linePricing, type LinePricing } from '../../../src/server/planner/pricing.ts';
import { ProjectStore } from '../../../src/server/projects/store.ts';
import { isFluidKey, parseItemKey, type StuffKey } from '../../../src/shared/keys.ts';
import { defaultSettings, normalizeSettings } from '../../../src/shared/project/apply-op.ts';
import type { Machine, Pack } from '../../../src/shared/types/pack.ts';
import { FREE_KEYS, type BomLine, type BuildStep, type Plan, type PlanSettings } from '../../../src/shared/types/plan.ts';
import type { Project } from '../../../src/shared/types/project.ts';

/** Plan 09's bound on a plan with a warm pack (real-user-project.test.ts keeps its own; ruling 102). */
const PLAN_SECONDS = 5;
const STATE = 'docs/local/ec-state.json';
const LEDGER = 'docs/local/plan-14-ledger';
const AUDIT = `${LEDGER}/audit.txt`;
const DB_COPY = `${LEDGER}/planner.sqlite`;

const STEEL_ROD = 'gregtech:gt.metaitem.01@23305';
const STEEL_INGOT = 'gregtech:gt.metaitem.01@11305';
const LONG_MAGNETIC_STEEL_ROD = 'gregtech:gt.metaitem.02@22355';
const STEEL_BARS = 'dreamcraft:SteelBars@0';
/** The GT Steel Nugget (a TConstruct one has the same name). */
const STEEL_NUGGET = 'gregtech:gt.metaitem.01@9305';
const CUPRONICKEL_COIL_BLOCK = 'gregtech:gt.blockcasings5@0';
const MOLTEN_TIN = 'fluid:molten.tin';
const EMPTY_CELL = 'IC2:itemCellEmpty@0';
const UHV_MUFFLER_HATCH = 'gregtech:gt.blockmachines@99';
/** Iron Plate: a first, unrelated plan warms the pack. */
const WARM_TARGET = 'gregtech:gt.metaitem.01@17032';
/** The smelting maps: the furnace and the electric furnace. */
const SMELTING: ReadonlySet<string> = new Set(['furnace', 'gt.recipe.furnace']);
const recycling = EXCLUSION_RULES.recycling!;
/** Cells of these are never base materials of the user's line: the breakdown makes and empties them (Defects F4). */
const CELL_FLUIDS: ReadonlySet<StuffKey> = new Set(['fluid:water', 'fluid:lava', 'fluid:air', 'fluid:steam', 'fluid:ic2steam']);
const FREE: ReadonlySet<StuffKey> = new Set(FREE_KEYS);
/** Litres of a free fluid a build may call for once (the controller's ruling on open question 2: build-time Air). */
const FREE_FLUID_MAX = 400_000;
const FLUID_MAX = 50_000;
const ITEM_MAX = 2_000;
const EMPTY_CELL_MAX = 64;
/**
 * Litres of any one fluid, free or not, a live project's build may call for (the controller's ruling on ruling 94's
 * bounds): above the real needs of the live builds, below the Air an exact cost tie asks for without ruling 93's
 * tie-break, which this block still catches on real data.
 */
const LIVE_FLUID_MAX = 10_000_000;
/** The gather step names this many base materials (steps.ts), then "(and N more)". */
const GATHER_SHOWN = 8;
/** How a make step words a machine the line builds whose own build needs the part. */
const FIRST = 'the one this line builds needs it first';
/** Amounts are rounded to 9 decimals: pooled amounts agree within this. */
const WITHIN = 1e-6;

let packLoad: Promise<Pack> | undefined;
/** The active export, loaded once for the whole file. */
function realPack(): Promise<Pack> {
  packLoad ??= loadPack(activeExportDir(loadConfig()));
  return packLoad;
}

const audit = new Map<string, string[]>();
/** Prints `lines` and writes them, after the sections printed before, to the audit file the controller reads. */
function record(section: string, lines: string[]): void {
  audit.set(section, lines);
  console.info([`${section}:`, ...lines].join('\n  '));
  mkdirSync(LEDGER, { recursive: true });
  const body = [...audit].flatMap(([name, rows]) => [`## ${name}`, ...rows, '']);
  writeFileSync(AUDIT, ["# add-on 14 Task 8 audit (local only: figures of the user's private settings and projects)", '', ...body].join('\n'));
}

/** Whole numbers with thousands separators, anything else with two decimals (steps.ts's amountText). */
function amountText(n: number): string {
  const x = Math.round(n * 1e9) / 1e9 || 0;
  return Number.isInteger(x) ? x.toLocaleString('en-US') : x.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

/** "3× Iron Ingot", "1,000 L Water", as the build steps name an amount of a part. */
function qty(pack: Pack, key: StuffKey, amount: number): string {
  return isFluidKey(key) ? `${amountText(amount)} L ${partName(pack, key)}` : `${amountText(amount)}× ${partName(pack, key)}`;
}

/** Every node of a build list, at any depth. */
function nodesOf(lines: readonly BomLine[]): BomLine[] {
  return lines.flatMap((l) => [l, ...nodesOf(l.children ?? [])]);
}

/** The build-list key of a part step (`make:<key>`, `craft:<key>`); undefined for any other step. */
function partKey(step: BuildStep): StuffKey | undefined {
  return step.id.startsWith('make:') || step.id.startsWith('craft:') ? step.id.slice(step.id.indexOf(':') + 1) : undefined;
}

function partStepsByKey(steps: readonly BuildStep[]): Map<StuffKey, BuildStep[]> {
  const byKey = new Map<StuffKey, BuildStep[]>();
  for (const s of steps) {
    const key = partKey(s);
    if (key !== undefined) byKey.set(key, [...(byKey.get(key) ?? []), s]);
  }
  return byKey;
}

/** A plain item key whose item id is one of `ids`. */
function itemIn(key: StuffKey, ids: ReadonlySet<string>): boolean {
  return !isFluidKey(key) && ids.has(parseItemKey(key).id);
}

/** What a build takes of each good: the amounts of its top-level lines of the good plus the good among the inputs of every make. */
function pooledDemand(lines: readonly BomLine[], makes: readonly BomMake[]): Map<StuffKey, number> {
  const demand = new Map<StuffKey, number>();
  const add = (key: StuffKey, n: number): void => {
    demand.set(key, (demand.get(key) ?? 0) + n);
  };
  for (const l of lines) add(l.key, l.amount);
  for (const m of makes) for (const i of m.inputs) add(i.key, i.amount);
  return demand;
}

/** Each make short of its demand or with a whole run to spare, and each total off its pooled demand. */
function poolingViolations(pack: Pack, totals: readonly BomLine[], makes: readonly BomMake[], demand: ReadonlyMap<StuffKey, number>): string[] {
  const out: string[] = [];
  for (const m of makes) {
    const d = demand.get(m.key) ?? 0;
    if (d > m.amount + WITHIN) out.push(`${partName(pack, m.key)}: made ${m.amount} short of ${d}`);
    if (m.amount - m.amount / m.made.runs >= d + WITHIN) out.push(`${partName(pack, m.key)}: ${m.made.runs} runs make ${m.amount}, one too many for ${d}`);
  }
  for (const t of totals) {
    const d = demand.get(t.key) ?? 0;
    if (Math.abs(t.amount - d) > WITHIN) out.push(`${partName(pack, t.key)}: total ${t.amount}, pooled demand ${d}`);
  }
  return out;
}

/** Each total above its ceiling: Empty Cells, an item, a free fluid (`freeFluidMax`), any other fluid (`fluidMax`). */
function ceilingViolations(pack: Pack, totals: readonly BomLine[], freeFluidMax = FREE_FLUID_MAX, fluidMax = FLUID_MAX): string[] {
  return totals.flatMap((t) => {
    const max = t.key === EMPTY_CELL ? EMPTY_CELL_MAX : !isFluidKey(t.key) ? ITEM_MAX : FREE.has(t.key) ? freeFluidMax : fluidMax;
    return t.amount > max ? [`${qty(pack, t.key, t.amount)} above ${amountText(max)}`] : [];
  });
}

/**
 * The fluid totals above the EC line's ceiling of their class, by bound, then fluid: a live build reports them and never
 * fails on them (the controller's ruling on ruling 94's bounds).
 */
function fluidReports(pack: Pack, totals: readonly BomLine[]): string[] {
  const fluids = totals.filter((t) => isFluidKey(t.key));
  return ([['free', FREE_FLUID_MAX, true], ['other', FLUID_MAX, false]] as const).flatMap(([kind, max, free]) => {
    const above = fluids.filter((t) => FREE.has(t.key) === free && t.amount > max).map((t) => qty(pack, t.key, t.amount));
    return above.length === 0 ? [] : [`${kind} fluid above ${amountText(max)} L: ${above.join(', ')}`];
  });
}

/** Each total that is no leaf of the breakdown and not unmade (a made good counted as a base material), or a circuit stand-in. */
function leafViolations(pack: Pack, totals: readonly BomLine[], leaf: LeafOracle): string[] {
  return totals.flatMap((t) => {
    const d = leaf(t.key);
    const isLeaf = d.buyable || d.leafClass === 'unavailable' || FREE.has(t.key);
    return [
      ...(isLeaf || t.unmade !== undefined ? [] : [`${partName(pack, t.key)} is made, yet a total`]),
      ...(itemIn(t.key, CIRCUIT_STAND_IN_IDS) ? [`${partName(pack, t.key)} is a circuit stand-in`] : []),
    ];
  });
}

/** The filled containers of the pack (`fluidContainers`), of `fluids` only when given. */
function filledContainers(pack: Pack, fluids?: ReadonlySet<StuffKey>): Set<StuffKey> {
  return new Set((pack.fluidContainers ?? []).filter((c) => fluids === undefined || fluids.has(c.fluid)).map((c) => c.container));
}

/** The gather step a build with `totals` has (architecture §11 entry 41 (5)): the totals that are not unmade, in order. */
function gatherText(pack: Pack, totals: readonly BomLine[]): string | undefined {
  const gathered = totals.filter((t) => t.unmade === undefined);
  if (gathered.length === 0) return undefined;
  const shown = gathered.slice(0, GATHER_SHOWN).map((t) => qty(pack, t.key, t.amount)).join(', ');
  const more = gathered.length - GATHER_SHOWN;
  return `Gather the base materials: ${shown}${more > 0 ? ` (and ${more} more)` : ''}`;
}

/** The figures the audit file holds for a build: its gather text, five largest totals, largest free fluid and step counts. */
function buildFigures(pack: Pack, totals: readonly BomLine[], steps: readonly BuildStep[], tree: readonly BomLine[]): string[] {
  const largest = [...totals].sort((a, b) => b.amount - a.amount || (a.key < b.key ? -1 : 1)).slice(0, 5);
  const free = totals.filter((t) => FREE.has(t.key) && isFluidKey(t.key)).sort((a, b) => b.amount - a.amount)[0];
  const parts = steps.filter((s) => partKey(s) !== undefined);
  const count = (kind: BuildStep['kind']): number => parts.filter((s) => s.kind === kind).length;
  const unmade = nodesOf(tree).filter((l) => l.unmade !== undefined).length + totals.filter((t) => t.unmade !== undefined).length;
  return [
    `gather: ${steps.find((s) => s.id === 'gather')?.text ?? 'none'}`,
    `five largest totals: ${largest.map((t) => qty(pack, t.key, t.amount)).join(', ') || 'none'}`,
    `largest free fluid: ${free === undefined ? 'none' : qty(pack, free.key, free.amount)}`,
    `part steps: ${count('make')} make, ${count('craft')} craft, ${count('gather')} gather; `
      + `unmade parts (nodes and totals): ${unmade}; build steps: ${steps.length}`,
  ];
}

/**
 * The order of a build's make steps against what each waits for (`BomMake.after`): its material waits, and for a machine
 * this line builds the machine's own key and structure parts (its machine waits); and each make whose step words a
 * `first` machine (`FIRST`) otherwise than its `made` has it.
 */
function waitOrder(pack: Pack, steps: readonly BuildStep[], makes: readonly BomMake[]): {
  lateMaterial: string[]; lateMachine: string[]; firstWording: string[]; firstMachines: number;
} {
  const byKey = partStepsByKey(steps);
  const index = new Map(steps.map((s, i) => [s.id, i]));
  const position = (key: StuffKey): number | undefined => {
    const s = byKey.get(key)?.[0];
    return s === undefined ? undefined : index.get(s.id);
  };
  const lateMaterial: string[] = [];
  const lateMachine: string[] = [];
  const firstWording: string[] = [];
  for (const m of makes) {
    const machine = m.made.machine;
    const unit = typeof machine === 'object' && machine.source === 'line' ? pack.machines.get(machine.mteId) : undefined;
    const own = new Set(unit === undefined ? [] : [unit.itemKey, ...structureParts(pack, unit).keys()]);
    const me = position(m.key);
    if (me === undefined) continue;   // the one-step case reports it
    let machineLater = false;
    for (const w of m.after) {
      const at = position(w);
      if (at === undefined) lateMaterial.push(`${partName(pack, m.key)} waits for ${partName(pack, w)}, which has no step`);
      else if (own.has(w)) machineLater ||= at > me;
      else if (at > me) lateMaterial.push(`${partName(pack, m.key)} comes before ${partName(pack, w)}`);
    }
    if (machineLater) lateMachine.push(partName(pack, m.key));
    const first = typeof machine === 'object' && machine.source === 'first';
    if ((steps[me] as BuildStep).text.includes(FIRST) !== first) {
      firstWording.push(`${partName(pack, m.key)}: ${first ? 'on a first machine, not worded so' : `worded "${FIRST}", on a ${typeof machine === 'object' ? machine.source : machine} machine`}`);
    }
  }
  const firstMachines = makes.filter((m) => typeof m.made.machine === 'object' && m.made.machine.source === 'first').length;
  return { lateMaterial, lateMachine, firstWording, firstMachines };
}

/**
 * Each node of a build list whose machine is not its make's (spec §3.10): its row on the Materials page (`madeText`)
 * would name another machine than its step.
 */
function machineDisagreements(pack: Pack, tree: readonly BomLine[], makes: readonly BomMake[]): string[] {
  const byKey = new Map(makes.map((m) => [m.key, m]));
  return tree.flatMap((l) => {
    if (l.made === undefined) return [];
    const m = byKey.get(l.key);
    if (m === undefined) return [`${partName(pack, l.key)} is made, but has no make`];
    const [node, job] = [JSON.stringify(l.made.machine), JSON.stringify(m.made.machine)];
    return node === job ? [] : [`${partName(pack, l.key)}: ${node} in the build list, ${job} in its make`];
  });
}

describe.skipIf(process.env.GTNH_LOCAL !== '1')("the build list of the user's Electronic Circuit line", () => {
  let pack: Pack;
  let settings: PlanSettings;
  let plan: Plan;
  let seconds: number;
  let pricing: LinePricing;
  let bom: Bom;
  let makes: BomMake[];
  let tree: BomLine[];

  beforeAll(async () => {
    if (!existsSync(STATE)) throw new Error("copy the user's settings to docs/local/ec-state.json (Task 8 Step 1)");
    settings = normalizeSettings((JSON.parse(readFileSync(STATE, 'utf8')) as { settings: Partial<PlanSettings> }).settings);
    pack = await realPack();
    await planLine(pack, { ...defaultSettings(), target: WARM_TARGET, amount: 1, per: 'min', tier: 1 }, emptyContext());
    const started = performance.now();
    plan = await planLine(pack, settings, emptyContext());
    seconds = (performance.now() - started) / 1000;
    pricing = (await linePricing(pack, settings, emptyContext()))!;
    // The plan's own breakdown once more, for its make plan; the user's line avoids nothing, so no `avoid`.
    bom = await buildBom(pack, plan.steps, { settings, env: pricing.basis.env, leaf: pricing.leaf, ctx: emptyContext() });
    makes = bom.makes ?? [];
    tree = nodesOf(plan.buildList);
  }, 600_000);

  it('plans the line in time', () => {
    expect(plan.status, JSON.stringify(plan.warnings)).toBe('ok');
    expect(seconds).toBeLessThan(PLAN_SECONDS);
  });

  it('says how the molten tin for the coils is made, before the coils', () => {
    const coils = tree.filter((l) => l.key === CUPRONICKEL_COIL_BLOCK);
    expect(coils.length, 'the line builds Cupronickel Coil Blocks (if not, the line changed: stop and report)').toBeGreaterThan(0);
    const tins = coils.flatMap((c) => nodesOf(c.children ?? [])).filter((l) => l.key === MOLTEN_TIN);
    expect(tins.length, 'Molten Tin under the coils').toBeGreaterThan(0);
    for (const tin of tins) {
      const machine = tin.made?.machine;
      expect(typeof machine === 'object' ? machine.name : machine).toContain('Fluid Extractor');
      const tinParts = (tin.children ?? []).map((c) => partName(pack, c.key)).filter((name) => name === 'Tin Dust' || name === 'Tin Ingot');
      expect(tinParts.length, 'a Tin Dust or Tin Ingot child').toBeGreaterThan(0);
    }
    const order = new Map(plan.buildSteps.map((s, i) => [s.id, i]));
    const step = plan.buildSteps.find((s) => s.id === `make:${MOLTEN_TIN}`);
    expect(step?.kind).toBe('make');
    expect(step?.text).toMatch(/^Make [\d,]+ L Molten Tin from [\d,]+× Tin (Dust|Ingot) in .*Fluid Extractor/);
    expect(order.get(`craft:${CUPRONICKEL_COIL_BLOCK}`), "the coils' step").toBeDefined();
    expect(order.get(`make:${MOLTEN_TIN}`)).toBeLessThan(order.get(`craft:${CUPRONICKEL_COIL_BLOCK}`) as number);
  });

  it('gives every made part one step, after the parts it is made from', () => {
    const byKey = partStepsByKey(plan.buildSteps);
    const kindOf = new Map<StuffKey, BuildStep['kind']>();
    for (const l of tree) if (l.made !== undefined) kindOf.set(l.key, l.made.machine === 'crafting table' ? 'craft' : 'make');
    for (const m of makes) kindOf.set(m.key, m.made.machine === 'crafting table' ? 'craft' : 'make');
    for (const l of tree) if (l.unmade !== undefined) kindOf.set(l.key, 'gather');
    const wrong = [...kindOf].flatMap(([key, kind]) => {
      const steps = byKey.get(key) ?? [];
      if (steps.length === 1 && steps[0]?.kind === kind) return [];
      return [`${partName(pack, key)}: ${steps.map((s) => s.kind).join(', ') || 'no step'}, not one ${kind} step`];
    });
    expect(wrong).toEqual([]);
    const waits = waitOrder(pack, plan.buildSteps, makes);
    expect(waits.lateMaterial).toEqual([]);
    // A job on a machine this line builds comes after that machine's own steps: where their waits form a cycle, the job
    // the order breaks it at runs on another machine (`first`), decided where `made` is set, so its step and its row on the
    // Materials page say the same.
    expect(waits.lateMachine).toEqual([]);
    expect(waits.firstWording).toEqual([]);
    expect(machineDisagreements(pack, tree, makes)).toEqual([]);
  });

  it('falls back from a pin the build list cannot use', () => {
    const pinned = new Set(Object.keys(settings.recipeChoice));
    const found = tree.filter((l) => pinned.has(l.key));
    expect(found.length, 'the build list holds a pinned good (if not, the line changed: stop and report)').toBeGreaterThan(0);
    expect(found.filter((l) => l.unmade !== undefined).map((l) => partName(pack, l.key))).toEqual([]);
  });

  it('prices stopped items honestly and never smelts them back', async () => {
    const prices = makePrices(pack, settings.costOverrides);
    const stops = new Set(settings.stopItems);
    const cheap = plan.rawInputs
      .filter((r) => stops.has(r.key) && pack.items.get(r.key)?.gt !== undefined && r.perSecond > 0)
      .filter((r) => r.cost / r.perSecond < prices.price(r.key) * (1 - WITHIN))
      .map((r) => `${partName(pack, r.key)} at ${r.cost / r.perSecond} below ${prices.price(r.key)}`);
    expect(cheap).toEqual([]);
    const rod = plan.rawInputs.find((r) => r.key === STEEL_ROD);
    expect(rod, 'the line buys its Steel Rods').toBeDefined();
    expect((rod?.cost ?? 0) / (rod?.perSecond ?? 1)).toBeGreaterThanOrEqual(0.5 * (1 - WITHIN));
    expect(pricing.leaf(STEEL_ROD)).toMatchObject({ buyable: true, leafClass: 'stop' });
    expect(pricing.leaf(STEEL_ROD).cost).toBeGreaterThanOrEqual(0.5 * (1 - WITHIN));
    expect((await itemPrices(pack, settings, emptyContext(), [STEEL_ROD])).cost(STEEL_ROD)).toBeGreaterThanOrEqual(0.5 * (1 - WITHIN));
    // The smelts that priced the stopped rod at 0 (Defects F2) are recycling now.
    const smelts = (from: StuffKey, to: StuffKey) => pack.recipes.filter((r) => r.maps.some((m) => SMELTING.has(m))
      && r.inputs.some((i) => i.consumed && i.options.some((o) => o.key === from)) && r.outputs.some((o) => o.key === to));
    for (const [from, to] of [[LONG_MAGNETIC_STEEL_ROD, STEEL_INGOT], [STEEL_BARS, STEEL_NUGGET]] as const) {
      const found = smelts(from, to);
      expect(found.length, `${partName(pack, from)} smelted into ${partName(pack, to)}`).toBeGreaterThan(0);
      expect(found.filter((r) => !recycling(r, pack)).map((r) => r.id)).toEqual([]);
    }
    // Downstream of the bought rods (raw → the steps that take them → where their outputs go → …) nothing makes steel.
    const reached = new Set<string>();
    const next = plan.flows.filter((f) => f.from === 'raw' && f.key === STEEL_ROD).map((f) => f.to);
    expect(next.length, 'steps that take the bought rods').toBeGreaterThan(0);
    while (next.length > 0) {
      const id = next.pop() as string;
      if (reached.has(id) || id === 'out' || id === 'sink') continue;
      reached.add(id);
      for (const f of plan.flows) if (f.from === id) next.push(f.to);
    }
    expect(plan.steps.filter((s) => reached.has(s.id) && s.outputs.some((o) => o.key === STEEL_INGOT)).map((s) => s.id)).toEqual([]);
    expect(plan.steps.filter((s) => {
      const r = pack.recipeById.get(s.recipeId);
      return r !== undefined && recycling(r, pack);
    }).map((s) => s.id)).toEqual([]);
  }, 60_000);   // a fresh machine-price walk (`itemPrices`), as the repo's other real-data async cases allow

  it('lists no fluid cell and names every part', () => {
    const keys = [...new Set([...tree, ...(plan.buildTotals ?? [])].map((l) => l.key))];
    expect(keys.filter((k) => itemIn(k, NOTHING_TO_PLACE))).toEqual([]);
    expect(keys.filter((k) => plan.names?.[k] === undefined || plan.names[k] === k)).toEqual([]);
    expect(plan.buildSteps.filter((s) => s.text.includes('minecraft:') || s.text.includes('gregtech:')).map((s) => s.text)).toEqual([]);
  });

  it('builds no hatch above what the structure needs', () => {
    const hatches = new Map<StuffKey, Machine[]>();
    for (const m of pack.machines.values()) if (m.kind === 'hatch') hatches.set(m.itemKey, [...(hatches.get(m.itemKey) ?? []), m]);
    const keys = [...new Set(tree.map((l) => l.key))];
    expect(keys.filter((key) => hatches.has(key)).length, 'the build list holds a hatch (if not, the line changed: stop and report)').toBeGreaterThan(0);
    const above = keys.filter((key) => (hatches.get(key) ?? [])
      .some((m) => !((m.tier ?? Infinity) <= plan.tier || minimalHatch(pack, m).mteId === m.mteId)));
    expect(above.map((key) => partName(pack, key))).toEqual([]);
    const everywhere = [...tree, ...(plan.buildTotals ?? [])].map((l) => l.key).concat(makes.flatMap((m) => [m.key, ...m.inputs.map((i) => i.key)]));
    expect(everywhere).not.toContain(UHV_MUFFLER_HATCH);
    expect(plan.buildSteps.filter((s) => s.text.includes(partName(pack, UHV_MUFFLER_HATCH))).map((s) => s.id)).toEqual([]);
  });

  it('pools the build totals and keeps them in bounds', () => {
    const totals = plan.buildTotals ?? [];
    const waits = waitOrder(pack, plan.buildSteps, makes);
    const filled = filledContainers(pack, CELL_FLUIDS);
    const standIns = [...tree, ...totals].filter((l) => itemIn(l.key, CIRCUIT_STAND_IN_IDS)).length;
    record('the Electronic Circuit line', [
      `planned in ${seconds.toFixed(2)} s on a warm pack (status ${plan.status})`,
      ...buildFigures(pack, totals, plan.buildSteps, plan.buildList),
      `makes: ${makes.length}; machine waits later than their make: ${waits.lateMachine.length}; made on a first machine `
        + `(worded "${FIRST}"; by the machine pass or a broken cycle of machine waits): ${waits.firstMachines}; `
        + `material waits later: ${waits.lateMaterial.length}; filled cells of free fluids or steam: ${totals.filter((t) => filled.has(t.key)).length}; `
        + `circuit stand-ins: ${standIns}`,
    ]);
    expect(bom.totals.map((t) => [t.key, t.amount, t.unmade])).toEqual(totals.map((t) => [t.key, t.amount, t.unmade]));
    expect(poolingViolations(pack, totals, makes, pooledDemand(bom.lines, makes))).toEqual([]);
    expect(leafViolations(pack, totals, pricing.leaf)).toEqual([]);
    expect(tree.filter((l) => itemIn(l.key, CIRCUIT_STAND_IN_IDS)).map((l) => partName(pack, l.key))).toEqual([]);
    expect(tree.filter((l) => l.unmade !== undefined).length + totals.filter((t) => t.unmade !== undefined).length).toBe(0);
    expect(totals.filter((t) => filled.has(t.key)).map((t) => partName(pack, t.key))).toEqual([]);
    expect(ceilingViolations(pack, totals)).toEqual([]);
    expect(plan.buildSteps.find((s) => s.id === 'gather')?.text).toBe(gatherText(pack, totals));
  });
});

/** One live project of the database copy, by its index in the store's list: its plan, the plan's own breakdown, and the plan finished with its layout. */
interface LiveProject {
  index: number;
  stops: ReadonlySet<StuffKey>;
  leaf: LeafOracle;
  plan: Plan;
  seconds: number;
  /** The plan's top-level lines broken down again with its steps (`expandBomLines`, as `buildBom` does), for its make plan. */
  own: { lines: BomLine[]; totals: BomLine[]; makes: BomMake[] };
  /** The plan as the plan route finishes it (no scan), the whole build it broke down, and its make plan; or why finishing failed. */
  finished: { plan: Plan; lines: BomLine[]; makes: BomMake[] } | { error: string } | null;
}

describe.skipIf(process.env.GTNH_LOCAL !== '1' || !existsSync(DB_COPY))("the build lists of the user's live projects", () => {
  let pack: Pack;
  let db: Db | undefined;
  const projects: LiveProject[] = [];

  beforeAll(async () => {
    pack = await realPack();
    // The copy only, never the main checkout's file (ruling 94).
    db = openDb(DB_COPY);
    const store = new ProjectStore(db);
    for (const [index, summary] of store.list().entries()) {
      const stored = store.get(summary.id) as Project;
      const settings = normalizeSettings(stored.settings);
      const project: Project = { ...stored, settings, world: { scanId: null, baseId: null } };
      const started = performance.now();
      const plan = await planLine(pack, settings, emptyContext());
      const seconds = (performance.now() - started) / 1000;
      const tops = plan.buildList.map(({ key, amount, why, group }): BomLine => ({ key, amount, why, ...(group === undefined ? {} : { group }) }));
      const own = await expandBomLines(pack, tops, settings, emptyContext(), { steps: plan.steps });
      let finished: LiveProject['finished'] = null;
      if (plan.status === 'ok') {
        // One service per project, as the plan route finishes a plan: the whole build it breaks down is the one kept here.
        const seen: { whole?: { lines: BomLine[]; makes: BomMake[] } } = {};
        const service = createLayoutService({
          pack: async () => pack,
          plan: async () => plan,
          scan: async () => null,
          readArea: async () => {
            throw new Error('the audit lays lines out without a world scan');
          },
          expand: async (p, lines, of, steps) => {
            const whole = await expandBomLines(p, lines, of.settings, emptyContext(), steps === undefined ? undefined : { steps });
            seen.whole = { lines, makes: whole.makes ?? [] };
            return whole;
          },
        });
        try {
          const done = await service.finishPlan(plan, project);
          finished = seen.whole === undefined ? { error: 'finished without breaking the whole build down' } : { plan: done, ...seen.whole };
        } catch (err) {
          finished = { error: err instanceof Error ? err.message : String(err) };
        }
      }
      projects.push({
        index: index + 1, stops: new Set(settings.stopItems), leaf: (await lineLeaf(pack, settings, emptyContext())).leaf, plan, seconds,
        own: { lines: tops, totals: own.totals, makes: own.makes ?? [] }, finished,
      });
    }
  }, 600_000);

  afterAll(() => {
    db?.close();
  });

  /**
   * Every bound a build of project `p` breaks: `label` names the plan or the finished plan. Its fluids are held to
   * LIVE_FLUID_MAX, free or not; above the EC line's ceilings they are reported (`fluidReports`), not failed.
   */
  const violations = (
    p: LiveProject, label: string, totals: readonly BomLine[], tree: readonly BomLine[], lines: readonly BomLine[], makes: readonly BomMake[],
  ): string[] => {
    const filled = filledContainers(pack);
    return [
      ...ceilingViolations(pack, totals, LIVE_FLUID_MAX, LIVE_FLUID_MAX),
      ...totals.filter((t) => filled.has(t.key) && !p.stops.has(t.key)).map((t) => `${qty(pack, t.key, t.amount)} is a filled container`),
      ...tree.filter((l) => itemIn(l.key, CIRCUIT_STAND_IN_IDS)).map((l) => `${partName(pack, l.key)} is a circuit stand-in in the build list`),
      ...leafViolations(pack, totals, p.leaf),
      ...poolingViolations(pack, totals, makes, pooledDemand(lines, makes)),
    ].map((v) => `project ${p.index} (${label}): ${v}`);
  };

  it('keeps the build of every live project in bounds', () => {
    record('the live projects (by index in the database copy, most recently changed first)', projects.flatMap((p) => {
      const rows = (label: string, plan: Plan, lines: readonly BomLine[], makes: readonly BomMake[]): string[] => {
        const totals = plan.buildTotals ?? [];
        const demand = pooledDemand(lines, makes).get(EMPTY_CELL) ?? 0;
        const made = makes.find((m) => m.key === EMPTY_CELL)?.amount ?? 0;
        const bought = totals.find((t) => t.key === EMPTY_CELL)?.amount ?? 0;
        return [
          `project ${p.index}, ${label}:`,
          ...buildFigures(pack, totals, plan.buildSteps, plan.buildList),
          `Empty Cells: ${amountText(demand)} needed, ${amountText(made)} made, ${amountText(bought)} bought`,
          `above the EC line's fluid ceilings (reported, not failed): ${fluidReports(pack, totals).join('; ') || 'none'}`,
        ].map((row, i) => (i === 0 ? row : `  ${row}`));
      };
      const f = p.finished;
      return [
        `project ${p.index}: status ${p.plan.status}, planned in ${p.seconds.toFixed(2)} s, tier ${p.plan.tier}`,
        ...rows('its plan', p.plan, p.own.lines, p.own.makes),
        ...(f === null ? ['  not finished (no ok plan)'] : 'error' in f ? [`  finishing failed: ${f.error}`]
          : rows('finished with its layout (no scan)', f.plan, f.lines, f.makes)),
      ];
    }));
    expect(projects.length).toBeGreaterThan(0);
    const rowsOf = (totals: readonly BomLine[]): string => JSON.stringify(totals.map((t) => [t.key, t.amount, t.unmade]));
    const broken = projects.flatMap((p) => {
      const f = p.finished;
      return [
        // the plan's own breakdown again, so its make plan is the plan's
        ...(rowsOf(p.own.totals) === rowsOf(p.plan.buildTotals ?? []) ? [] : [`project ${p.index}: its build list breaks down otherwise again`]),
        ...violations(p, 'its plan', p.plan.buildTotals ?? [], nodesOf(p.plan.buildList), p.own.lines, p.own.makes),
        ...(f === null ? [] : 'error' in f ? [`project ${p.index}: finishing failed: ${f.error}`]
          : violations(p, 'finished', f.plan.buildTotals ?? [], nodesOf(f.plan.buildList), f.lines, f.makes)),
      ];
    });
    expect(broken).toEqual([]);
  });

  it('gathers in one step exactly the totals of a finished project (M6 (c))', () => {
    const finished = projects.flatMap((p) => (p.finished === null || 'error' in p.finished ? [] : [{ index: p.index, plan: p.finished.plan }]));
    expect(finished.length).toBeGreaterThan(0);
    for (const { index, plan } of finished) {
      expect(plan.buildSteps.find((s) => s.id === 'gather')?.text, `project ${index}`).toBe(gatherText(pack, plan.buildTotals ?? []));
    }
  });
});
