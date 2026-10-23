// Real-data check of the feeding checker (plan docs/superpowers/plans/2026-10-20-21-feeding-checker.md Task 12; research
// docs/research/machine-feeding.md §4, its audit of main's layouts): the research's probe lines — the user's Electronic
// Circuit settings (by hand, and with crafting automated), Red Alloy Ingot (60 a minute), the LV Electric Motor (6 a
// minute) and the Vacuum Tube (30 a minute) — planned on the active export with no world, in the routed, AE2 and EnderIO
// modes as the app plans a project in each, laid out as today's main lays them, and checked with `checkFeeding`'s default
// options (in AE2 once more with ME stocking every pattern's fluid). It runs only with GTNH_LOCAL=1 and GTNH_PLANNER_CONFIG
// naming a config whose data folder holds the export, and is skipped everywhere else. The user's settings are read at run
// time from GTNH_FEED_REFERENCE, else docs/local/circuit-reference/reference.json (private: never printed, copied or
// committed); without that file their two lines are skipped with a note. It prints counts, codes and mteIds only.
//
// Today's main lays these lines with fix/feeding's structured feeding (research §6.4: chips that list what their machine
// makes, encodable patterns, Multi Stack Input Off where a machine takes two kinds or more) and add-on 12's Auto Workbenches
// and shared machines, so the predictions written for the main the research probed are derived again from the main these
// lines are laid by: each case says what it expects there and why.

import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { beforeAll, describe, expect, it } from 'vitest';
import { activeExportDir, loadConfig } from '../../../src/server/config.ts';
import { checkFeeding } from '../../../src/server/layout/feeding/check.ts';
import { SCENARIOS, type FeedFinding, type FeedingOptions, type FeedingReport } from '../../../src/server/layout/feeding/contract.ts';
import type { FeedModel, FeedNode } from '../../../src/server/layout/feeding/model.ts';
import { readLine } from '../../../src/server/layout/feeding/read.ts';
import { emptyScan, layoutLine } from '../../../src/server/layout/layout.ts';
import { stepItemInputs } from '../../../src/server/layout/modes/mode.ts';
import { loadPack } from '../../../src/server/pack/load.ts';
import { emptyContext, planLine } from '../../../src/server/planner/plan.ts';
import { isFluidKey, type StuffKey } from '../../../src/shared/keys.ts';
import { defaultSettings } from '../../../src/shared/project/apply-op.ts';
import type { Layout } from '../../../src/shared/types/layout.ts';
import type { Pack } from '../../../src/shared/types/pack.ts';
import type { LogisticsMode, Plan, PlanSettings } from '../../../src/shared/types/plan.ts';
import { makeProject } from '../../helpers/layout-fixtures.ts';

type LineName = 'ec-user' | 'ec-user-auto' | 'red-alloy' | 'motor-lv' | 'vacuum-tube';
type Mode = Extract<LogisticsMode, 'routed' | 'ae2' | 'enderio'>;

const MODES: readonly Mode[] = ['routed', 'ae2', 'enderio'];
/** The plan's bound on one real-data line, in main-thread CPU time (Global Constraints, as Task 11 times its bound). */
const LINE_MS = 5_000;
/** The user's reference settings: private, read at run time only. */
const REFERENCE = process.env.GTNH_FEED_REFERENCE || join('docs', 'local', 'circuit-reference', 'reference.json');
/** Sticky Resin: the Electronic Circuit line's centrifuges make it only by chance, so no whole AE2 pattern makes it. */
const STICKY_RESIN = 'IC2:itemHarz@0';

/** The probe lines: the user's two Electronic Circuit lines when the reference file is there, then the research's other three. */
function probeLines(): Array<{ name: LineName; settings: Partial<PlanSettings> }> {
  const lines: Array<{ name: LineName; settings: Partial<PlanSettings> }> = [];
  if (existsSync(REFERENCE)) {
    const settings = (JSON.parse(readFileSync(REFERENCE, 'utf8')) as { settings: Partial<PlanSettings> }).settings;
    lines.push({ name: 'ec-user', settings }, { name: 'ec-user-auto', settings: { ...settings, automateCrafting: true } });
  }
  lines.push(
    { name: 'red-alloy', settings: { target: 'gregtech:gt.metaitem.01@11308', amount: 60, per: 'min', tier: 2 } },
    { name: 'motor-lv', settings: { target: 'gregtech:gt.metaitem.01@32600', amount: 6, per: 'min', tier: 2 } },
    { name: 'vacuum-tube', settings: { target: 'gregtech:gt.metaitem.01@32700', amount: 30, per: 'min', tier: 2 } },
  );
  return lines;
}

/** One `checkFeeding` run of a laid line, and its main-thread CPU time. */
interface Check { what: string; layout: Layout; model: FeedModel; report: FeedingReport; ms: number }
/** A probe line in one mode: its plan and its checks, `main` on the line as main lays it. */
interface Line {
  name: LineName; mode: Mode; plan: Plan;
  /** With the default options; in AE2 with ME stocking every pattern's fluid (`ae2FluidStock`); in EnderIO with Multi Stack Input left unset. */
  main: Check; stocked?: Check; unset?: Check;
}

/** `checkFeeding` on `layout`, timed in main-thread CPU time (user plus system), as Task 11 times its bound. */
function checked(what: string, pack: Pack, plan: Plan, layout: Layout, options?: FeedingOptions): Check {
  const model = readLine({ pack, plan, layout });
  const before = process.threadCpuUsage();
  const report = checkFeeding({ pack, plan, layout, ...(options === undefined ? {} : { options }) });
  const used = process.threadCpuUsage(before);
  return { what, layout, model, report, ms: (used.user + used.system) / 1_000 };
}

/**
 * `layout` with Multi Stack Input left unset on every block, as main laid it before fix/feeding set it Off on the machines fed
 * two kinds or more (research §4.3 item 1, §6.4 item 2). Only that setting goes: main's other changes since the research's
 * probe (Limiting mode on input buses, add-on 12's benches) stay as main lays them.
 */
function multiStackUnset(layout: Layout): Layout {
  const out = structuredClone(layout);
  for (const b of out.blocks) {
    if (b.config === undefined || !Object.hasOwn(b.config, 'multiStack')) continue;
    delete b.config.multiStack;
    if (Object.keys(b.config).length === 0) delete b.config;
  }
  return out;
}

/** "1 machine", "2 machines". */
function machinesText(n: number): string {
  return `${n} machine${n === 1 ? '' : 's'}`;
}

/** `code` or `code×n`, one per code in code order; `none` for none. */
function codeCounts(findings: readonly FeedFinding[]): string {
  const counts = new Map<string, number>();
  for (const f of findings) counts.set(f.code, (counts.get(f.code) ?? 0) + 1);
  return [...counts].sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0)).map(([code, n]) => (n === 1 ? code : `${code}×${n}`)).join(' ') || 'none';
}

/** The console line of a check: counts and codes only. */
function consoleLine(line: Line, check: Check): string {
  const statics = check.report.findings.filter((f) => f.phase === 'static');
  const scenarios = SCENARIOS.map((s) => `${s} ${codeCounts(check.report.findings.filter((f) => f.scenario === s))}`);
  return `real-feeding ${line.name} ${check.what}: ${check.layout.blocks.length} blocks, ${machines(check.model).length} machines, static ${codeCounts(statics)}, `
    + `${scenarios.join(', ')}, ok ${check.report.ok}, ${Math.round(check.ms)} ms`;
}

/** The model's machine nodes (no chests), in its local order. */
function machines(model: FeedModel): Array<Exclude<FeedNode, { kind: 'chest' }>> {
  return model.nodes.filter((n): n is Exclude<FeedNode, { kind: 'chest' }> => n.kind !== 'chest');
}

/** The items the plan brings to a machine's steps (`stepItemInputs`), each once. */
function kindsOf(plan: Plan, node: Exclude<FeedNode, { kind: 'chest' }>): StuffKey[] {
  return [...new Set(node.stepIds.flatMap((id) => stepItemInputs(plan, id)))].sort();
}

/** The items that come to a machine's steps from the input chest: from outside the line (`raw`) or from a step without machines. */
function fromChest(model: FeedModel, node: Exclude<FeedNode, { kind: 'chest' }>): StuffKey[] {
  return model.itemFlows.filter((f) => node.stepIds.includes(f.to) && (f.from === 'raw' || !model.laid.includes(f.from))).map((f) => f.key);
}

/** Whether every item flow into the machine's steps comes from the input chest. */
function fedFromChest(model: FeedModel, node: Exclude<FeedNode, { kind: 'chest' }>): boolean {
  return model.itemFlows.filter((f) => node.stepIds.includes(f.to)).every((f) => f.from === 'raw' || !model.laid.includes(f.from));
}

/** The items a machine's steps plan to take (`model.planned`), each once. */
function plannedOf(model: FeedModel, node: Exclude<FeedNode, { kind: 'chest' }>): StuffKey[] {
  return [...new Set(node.stepIds.flatMap((id) => Object.keys(model.planned[id] ?? {})))].sort();
}

/** The line's product: what the plan sends out of it. */
function productOf(plan: Plan): { key: StuffKey; stepId: string } {
  const f = plan.flows.find((x) => x.to === 'out');
  if (f === undefined) throw new Error('the plan sends nothing out');
  return { key: f.key, stepId: f.from };
}

/** The findings of `scenario` (sim phase). */
function inScenario(report: FeedingReport, scenario: string): FeedFinding[] {
  return report.findings.filter((f) => f.phase === 'sim' && f.scenario === scenario);
}

const brief = (f: FeedFinding) => `${f.code} ${f.certainty} ${f.key ?? '-'} ${f.machine}`;

describe.skipIf(process.env.GTNH_LOCAL !== '1')('the feeding checker on the research probe lines', () => {
  let pack: Pack;
  const lines: Line[] = [];
  const of = (mode: Mode) => lines.filter((l) => l.mode === mode);

  beforeAll(async () => {
    pack = await loadPack(activeExportDir(loadConfig()));
    const probe = probeLines();
    if (!probe.some((l) => l.name === 'ec-user')) {
      console.log('real-feeding: ec-user and ec-user-auto skipped: no reference settings (GTNH_FEED_REFERENCE, else docs/local/circuit-reference/reference.json)');
    }
    for (const { name, settings: own } of probe) {
      for (const mode of MODES) {
        // planned as the app plans a project in the mode: it shares machines only in AE2, caps benches by the mode's parts
        const settings = { ...defaultSettings(), ...own, logistics: mode } as PlanSettings;
        const plan = await planLine(pack, settings, emptyContext());
        expect(plan.status ?? 'ok', `${name} ${mode}: ${plan.warnings.map((w) => w.code).join(' ')}`).toBe('ok');
        const layout = await layoutLine(pack, plan, emptyScan(), { ...makeProject({ logistics: mode, scanId: null, baseId: null }), settings });
        const main = checked(mode, pack, plan, layout);
        lines.push({
          name, mode, plan, main,
          ...(mode === 'ae2' ? { stocked: checked('ae2 (ae2FluidStock)', pack, plan, layout, { ae2FluidStock: true }) } : {}),
          ...(mode === 'enderio' ? { unset: checked('enderio (Multi Stack Input unset)', pack, plan, multiStackUnset(layout)) } : {}),
        });
      }
    }
  }, 300_000);

  it('checks every line in every mode in under 5 s', () => {
    for (const line of lines) {
      for (const check of [line.main, line.stocked, line.unset]) {
        if (check === undefined) continue;
        console.log(consoleLine(line, check));
        const { report } = check;
        expect(JSON.parse(JSON.stringify(report)), `${line.name} ${check.what}: plain data`).toStrictEqual(report);
        // the static findings come first, then each scenario's
        const statics = report.findings.filter((f) => f.phase === 'static');
        expect(report.findings.slice(0, statics.length), `${line.name} ${check.what}: static findings first`).toEqual(statics);
        expect(report.findings.slice(statics.length).every((f) => f.phase === 'sim'), `${line.name} ${check.what}: then the scenarios'`).toBe(true);
        expect(report.scenarios.map((s) => s.name)).toEqual([...SCENARIOS]);
        expect(check.ms, `${line.name} ${check.what}: CPU ms`).toBeLessThan(LINE_MS);
      }
    }
    expect(of('routed').length).toBeGreaterThanOrEqual(3);
  });

  it('finds what still stops today\'s routed lines', () => {
    // Research §4.1 items 1, 3 and 4 are gone on today's main: fix/feeding whitelists every Item Extractor Chip with what its
    // machine makes (the input chest's: its supply), lists every item the line sends out on the output chest's Item
    // Terminator Chips, lays no extractor on an input bus's pipe, and sets Multi Stack Input Off where a machine takes two
    // kinds or more, so R5a, R5d, R6, R5c and R2 have nothing to find. What stops each line is research C19 as the plan's E6
    // reads Project Red: an empty machine with Multi Stack Input Off is credited a stack per empty slot, so a kind the input
    // chest sends (a stack an act, from stock) overshoots it; the overshoot circles its pipe and stays counted on its way there,
    // and the responder then answers for the other kinds with no room: they never come (until a restart). So every machine fed
    // two kinds or more, one of them from the input chest, starves of one kind while another circles.
    for (const line of of('routed')) {
      const { report, model } = line.main;
      expect(report.findings.filter((f) => f.phase === 'static').map(brief), `${line.name}: static findings`).toEqual([]);
      expect(model.unknowns.filter((u) => u.code === 'routed_text' || u.code === 'extractor_new').map((u) => u.code), `${line.name}: chips read from text`).toEqual([]);
      const steady = inScenario(report, 'steady');
      let deadlocked = 0;
      for (const node of machines(model)) {
        const kinds = kindsOf(line.plan, node);
        if (kinds.length < 2 || !fromChest(model, node).some((k) => kinds.includes(k))) continue;
        deadlocked++;
        const starved = steady.filter((f) => f.code === 'feed_starved' && f.machine === node.label && kinds.includes(f.key!)).map((f) => f.key);
        const circling = steady.filter((f) => f.code === 'feed_churn' && f.machine === node.label && kinds.includes(f.key!)).map((f) => f.key);
        expect(starved.length, `${line.name}: ${node.label} gets one of its kinds`).toBeGreaterThan(0);
        expect(circling.length, `${line.name}: ${node.label} has the first kind's overshoot circling its pipe`).toBeGreaterThan(0);
        expect(starved.filter((k) => circling.includes(k)), `${line.name}: ${node.label} starves of another kind than the one that circles`).toEqual([]);
      }
      // every line has one (red-alloy its two Alloy Smelters, motor-lv its Chemical Reactor, vacuum-tube its Mixer and Electric
      // Blast Furnaces, the Electronic Circuit lines their Alloy Smelter), so no line makes its product, and every one fails the gate
      expect(deadlocked, `${line.name}: machines fed two kinds or more, one from the input chest`).toBeGreaterThan(0);
      const product = productOf(line.plan);
      expect(report.scenarios.find((s) => s.name === 'steady')!.out[product.key] ?? 0, `${line.name}: its product out`).toBe(0);
      expect(report.ok, `${line.name}: ok`).toBe(false);
    }
  });

  it('runs Red Alloy on AE2 cleanly and finds the others stuck', () => {
    // Research §4.2 items 1 and 3 are gone on today's main: fix/feeding writes each pattern with item inputs and whole,
    // guaranteed item outputs only, so R8 has nothing to find and ME's fluid stock changes nothing. What stops the lines now is
    // item 2 in its fixed form. The AE2 job (twice the run's worth of the line's product) crafts only what the product needs
    // through the patterns, which carry no fluid: a step whose only product is a piped fluid has no pattern, and its ME Export
    // Bus asks ME for items that ME holds only as stock, which no job crafts; a machine whose pattern makes only what no job
    // needs, while it pipes a fluid to another (fix/feeding's own `ae2_fluid_short`), never runs. Either way the fluid never
    // comes, and the product never runs. Only where an item the job needs comes only by chance can AE2 not plan it at all.
    const unplanned: Partial<Record<LineName, StuffKey>> = { 'ec-user-auto': STICKY_RESIN };
    for (const line of of('ae2')) {
      const { report, model, layout } = line.main;
      const laid = layout.blocks.flatMap((b) => b.feed?.interface?.patterns ?? []).flatMap((p) => [...p.inputs, ...p.outputs]);
      expect(laid.filter((e) => isFluidKey(e.key) || !Number.isInteger(e.amount)), `${line.name}: laid pattern entries a pattern cannot hold`).toEqual([]);
      expect(report.findings.filter((f) => f.phase === 'static').map(brief), `${line.name}: static findings`).toEqual([]);
      // no pattern lists a fluid, so ME's fluid stock changes nothing
      expect(line.stocked!.report, `${line.name}: with ME stocking the patterns' fluids`).toEqual(report);

      const steady = inScenario(report, 'steady');
      const product = productOf(line.plan);
      const made = report.scenarios.find((s) => s.name === 'steady')!;
      if (line.name === 'red-alloy') {
        expect(report.findings.map(brief), 'red-alloy: findings').toEqual([]);
        expect(report.ok).toBe(true);
        expect(made.out[product.key] ?? 0, 'red-alloy: its product into ME').toBeGreaterThan(0);
        continue;
      }
      expect([report.ok, made.runs[product.stepId] ?? 0, made.out[product.key] ?? 0], `${line.name}: ok, its product's runs and what reached ME`).toEqual([false, 0, 0]);

      // a machine an ME Export Bus feeds never gets the items ME holds only as stock: no job crafts them
      const buses = model.networks.flatMap((n) => (n.kind === 'ae2' ? n.exportBuses : []));
      for (const bus of buses) {
        const node = model.nodes.find((n) => n.id === bus.target?.node);
        if (node === undefined) continue;
        for (const key of bus.keys.filter((k) => !model.supply.includes(k))) {
          expect(steady.filter((f) => f.code === 'feed_starved' && f.machine === node.label && f.key === key).length, `${line.name}: ${node.label} gets ${key}`).toBe(1);
        }
      }
      // and a machine fix/feeding warns AE2 runs too seldom for the fluid it pipes never runs at all
      for (const w of layout.warnings.filter((x) => x.code === 'ae2_fluid_short')) {
        for (const node of machines(model).filter((n) => n.stepIds.includes(w.stepId ?? ''))) {
          const missed = new Set(steady.filter((f) => f.code === 'feed_starved' && f.machine === node.label).map((f) => f.key));
          expect(plannedOf(model, node).filter((k) => !missed.has(k)), `${line.name}: what ${node.label}, whose fluid AE2 runs too seldom, gets`).toEqual([]);
        }
      }

      // the job: only where an item it needs comes only by chance can AE2 not plan it at all, and then nothing is pushed anywhere
      const cannot = [...new Set(steady.map((f) => /the AE2 job cannot be planned: (.*)$/.exec(f.text)?.[1]).filter((x) => x !== undefined))];
      const missing = unplanned[line.name];
      expect(cannot, `${line.name}: why its job cannot be planned`).toEqual(missing === undefined ? [] : [`nothing makes ${model.nameOf(missing)} and ME holds none`]);
      if (missing !== undefined) {
        const pushed = new Set(model.networks.flatMap((n) => (n.kind === 'ae2' ? n.interfaces.flatMap((i) => i.targets.map((t) => t.node)) : [])));
        for (const node of machines(model).filter((n) => pushed.has(n.id))) {
          const starved = new Set(steady.filter((f) => f.code === 'feed_starved' && f.machine === node.label && f.text.includes(`: the AE2 job cannot be planned: ${cannot[0]}`)).map((f) => f.key));
          expect(plannedOf(model, node).filter((k) => !starved.has(k)), `${line.name}: what ${node.label} gets`).toEqual([]);
        }
      }
    }
    // motor-lv: the Auto Workbench that makes its Electric Motor never gets any of its four items: the CPU pushes its pattern only
    // with all four in store, and the 1x Tin Cable never comes (its machine waits for the reactor's Molten Rubber)
    const motor = of('ae2').find((l) => l.name === 'motor-lv')!;
    const bench = machines(motor.main.model).find((n) => n.stepIds.includes(productOf(motor.plan).stepId))!;
    expect(bench.kind).toBe('bench');
    const benchStarved = new Set(inScenario(motor.main.report, 'steady').filter((f) => f.code === 'feed_starved' && f.machine === bench.label).map((f) => f.key));
    expect(plannedOf(motor.main.model, bench).filter((k) => !benchStarved.has(k))).toEqual([]);
    expect(plannedOf(motor.main.model, bench)).toHaveLength(4);
  });

  it('crowds EnderIO machines only with Multi Stack Input On', () => {
    // Research §4.3 item 1: EnderIO merges, then fills the first empty slot, so with Multi Stack Input On the first kind takes
    // every free slot of a machine fed two kinds or more. Today's main sets it Off on each such machine (fix/feeding), so
    // `multistack_on`, which turns On only what the layout leaves unset, finds nothing, and every line passes the gate
    // (research §4.3: everything else holds; §7's acceptance). With the setting taken back out (Multi Stack Input left to
    // chance, as the research probed main), `steady` still crowds nothing and `multistack_on` crowds every basic machine fed
    // two kinds or more that all come from the input chest.
    let crowdedFromChest = 0;
    for (const line of of('enderio')) {
      const { report, model } = line.main;
      const twoKinds = machines(model).filter((n) => n.kind === 'basic' && kindsOf(line.plan, n).length >= 2);
      expect(twoKinds.filter((n) => n.kind === 'basic' && n.settings.multiStack !== false).map((n) => n.label), `${line.name}: Multi Stack Input left on`).toEqual([]);
      expect(report.findings.filter((f) => f.code === 'feed_crowded').map(brief), `${line.name}: crowded`).toEqual([]);
      expect(report.ok, `${line.name}: ok`).toBe(true);
      const product = productOf(line.plan);
      expect(report.scenarios.find((s) => s.name === 'steady')!.out[product.key] ?? 0, `${line.name}: its product out`).toBeGreaterThan(0);

      const unset = line.unset!.report;
      // R2 names each machine whose Multi Stack Input the layout leaves to chance
      expect(unset.findings.filter((f) => f.phase === 'static' && f.code === 'feed_crowded').map((f) => `${f.certainty} ${f.machine}`), `${line.name} unset: R2`)
        .toEqual(twoKinds.map((n) => `risk ${n.label}`));
      expect(inScenario(unset, 'steady').filter((f) => f.code === 'feed_crowded').map(brief), `${line.name} unset: crowded in steady`).toEqual([]);
      const crowded = new Set(inScenario(unset, 'multistack_on').filter((f) => f.code === 'feed_crowded').map((f) => f.machine));
      const chestFed = twoKinds.filter((n) => fedFromChest(model, n));
      crowdedFromChest += chestFed.length;
      expect(chestFed.filter((n) => !crowded.has(n.label)).map((n) => n.label), `${line.name} unset: not crowded with Multi Stack Input On`).toEqual([]);
      // the others crowded there (the research also names the Electronic Circuit line's Circuit Assembler): counts and mteIds only
      const others = machines(model).filter((n) => crowded.has(n.label) && !chestFed.includes(n));
      console.log(`real-feeding ${line.name} enderio (Multi Stack Input unset): multistack_on crowds ${machinesText(chestFed.length)} fed from the input chest `
        + `and ${others.length} ${others.length === 1 ? 'other' : 'others'}${others.length > 0 ? ` (mteIds ${others.map((n) => n.mteId).join(' ')})` : ''}`);
    }
    // red-alloy's two Alloy Smelters and the Electronic Circuit lines' Alloy Smelter
    expect(crowdedFromChest).toBeGreaterThanOrEqual(2);
  });

  it('finds fix/feeding\'s routed chips moving items', () => {
    // Research §6.4 item 1, now on main: each Item Extractor Chip lists what its machine makes (the input chest's: its supply)
    // in `feed.chips`, and an Item Broadcaster Chip sends what an Auto Workbench's Item Stock Keeper Chip asks for. No static
    // R5a, no item waits for a new chip, the output chest's Item Terminator Chips take every item that leaves the line (R6), and
    // `multistack_on` crowds nothing, Multi Stack Input being set Off: every machine fed one kind from the input chest gets it.
    let single = 0;
    for (const line of of('routed')) {
      const { report, model } = line.main;
      expect(report.findings.filter((f) => f.phase === 'static' && f.code === 'feed_no_route').map(brief), `${line.name}: R5a and R6`).toEqual([]);
      expect(report.findings.filter((f) => f.code === 'feed_starved' && f.text.includes('Item Extractor Chip')).map(brief), `${line.name}: starved by a chip`).toEqual([]);
      expect(inScenario(report, 'multistack_on').filter((f) => f.code === 'feed_crowded').map(brief), `${line.name}: crowded with Multi Stack Input On`).toEqual([]);
      const fedOne = machines(model).filter((n) => kindsOf(line.plan, n).length === 1 && fedFromChest(model, n));
      single += fedOne.length;
      const starved = new Set(report.findings.filter((f) => f.code === 'feed_starved').map((f) => f.machine));
      expect(fedOne.filter((n) => starved.has(n.label)).map((n) => n.label), `${line.name}: fed one kind from the chest and starved`).toEqual([]);
    }
    expect(single).toBeGreaterThan(0);
  });
});
