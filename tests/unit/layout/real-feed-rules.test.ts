// Real-data check of the feeding fix (architecture §11 entry 51; research docs/research/machine-feeding.md §4, §6.4): the
// research's five probe lines — the Electronic Circuit at MV (1 a minute, by hand and with crafting automated), Red
// Alloy Ingot (60 a minute), the LV Electric Motor (6 a minute) and the Vacuum Tube (30 a minute) — and Steel Plate (10
// a minute, whose EBF takes its Oxygen piped from another machine: a Canning Machine on main's planner, an Electrolyzer
// on Phosphate Dust on plan 12's), planned on the active export and laid out with no world in the routed, AE2 and
// EnderIO modes, as the app does. It runs only with GTNH_LOCAL=1 (and GTNH_PLANNER_CONFIG naming a config whose data
// folder holds the export) and is skipped everywhere else. It prints counts and codes only.

import { beforeAll, describe, expect, it } from 'vitest';
import { activeExportDir, loadConfig } from '../../../src/server/config.ts';
import { benchPlan } from '../../../src/server/layout/bench.ts';
import { ignoredByBlocking } from '../../../src/server/layout/modes/ae2.ts';
import { stepItemInputs, stepItemOutputs } from '../../../src/server/layout/modes/mode.ts';
import { emptyScan, layoutLine } from '../../../src/server/layout/layout.ts';
import { loadPack } from '../../../src/server/pack/load.ts';
import { machineByMteId } from '../../../src/server/pack/lookup.ts';
import { stepOneOffs } from '../../../src/server/planner/bom.ts';
import { emptyContext, planLine } from '../../../src/server/planner/plan.ts';
import { isFluidKey, type StuffKey } from '../../../src/shared/keys.ts';
import { DIRS, posKey, step } from '../../../src/shared/layout/geometry.ts';
import { defaultSettings } from '../../../src/shared/project/apply-op.ts';
import type { ChipKind } from '../../../src/shared/types/feed.ts';
import type { Layout, LayoutBlock } from '../../../src/shared/types/layout.ts';
import type { Pack } from '../../../src/shared/types/pack.ts';
import type { LogisticsMode, Plan, PlanSettings } from '../../../src/shared/types/plan.ts';
import { makeProject } from '../../helpers/layout-fixtures.ts';

const LINES: ReadonlyArray<{ name: string; settings: Partial<PlanSettings> }> = [
  { name: 'Electronic Circuit MV', settings: { target: 'IC2:itemPartCircuit@0', amount: 1, per: 'min', tier: 2 } },
  { name: 'Electronic Circuit MV, crafting automated', settings: { target: 'IC2:itemPartCircuit@0', amount: 1, per: 'min', tier: 2, automateCrafting: true } },
  { name: 'Red Alloy Ingot', settings: { target: 'gregtech:gt.metaitem.01@11308', amount: 60, per: 'min', tier: 2 } },
  { name: 'LV Electric Motor', settings: { target: 'gregtech:gt.metaitem.01@32600', amount: 6, per: 'min', tier: 2 } },
  { name: 'Vacuum Tube', settings: { target: 'gregtech:gt.metaitem.01@32700', amount: 30, per: 'min', tier: 2 } },
  { name: 'Steel Plate', settings: { target: 'gregtech:gt.metaitem.01@17305', amount: 10, per: 'min', tier: 2 } },
];
const MODES: readonly LogisticsMode[] = ['routed', 'ae2', 'enderio'];

/**
 * The machines (GT basic machine kind) AE2 runs too seldom for the fluid they pipe to another machine, per line: no job
 * of the line needs what their patterns make (research §4.2 item 2: the Refined Glue the Resistor and Wood Plank
 * assemblers wait for, the Polyethylene for the Circuit Board assembler, the EBF's Oxygen). These are the lines as plan
 * 12's planner plans them at its defaults (the merge of fix/feeding b4f5602): the EBF's Oxygen comes from an Electrolyzer
 * on Phosphate Dust, whose pattern makes Phosphorus Dust, which no job of the line needs, on the circuit, Vacuum Tube and
 * Steel Plate lines, and the circuit's Circuit Board is the wood one, which takes no Polyethylene. Main's planner made
 * the Steel Plate EBF's Oxygen in a Canning Machine (its pattern makes Empty Cells) and the circuit's Polyethylene in a
 * Chemical Reactor. When the planner picks another route for these lines (plan 12 Task 8's Phosphate Dust cases), this
 * table follows it.
 */
const FLUID_SHORT: Readonly<Record<string, ReadonlyArray<readonly [string, string]>>> = {
  'Electronic Circuit MV': [['centrifuge', 'fluid:refinedglue'], ['electrolyzer', 'fluid:oxygen']],
  'Electronic Circuit MV, crafting automated': [['centrifuge', 'fluid:refinedglue'], ['electrolyzer', 'fluid:oxygen']],
  'Vacuum Tube': [['electrolyzer', 'fluid:oxygen']],
  'Steel Plate': [['electrolyzer', 'fluid:oxygen']],
};

/** The blocks beside `b` (all six sides), by the layout's own index of positions. */
function beside(at: ReadonlyMap<string, LayoutBlock>, b: LayoutBlock, sides = 0b111111): LayoutBlock[] {
  return DIRS.flatMap((_, side) => ((sides >> side) & 1) === 0 ? [] : [at.get(posKey(step(b.pos, side)))].filter((x): x is LayoutBlock => x !== undefined));
}

describe.skipIf(process.env.GTNH_LOCAL !== '1')('the feeding fix on the research probe lines', () => {
  let pack: Pack;
  const plans = new Map<string, Plan>();

  beforeAll(async () => {
    pack = await loadPack(activeExportDir(loadConfig()));
    for (const line of LINES) {
      const plan = await planLine(pack, { ...defaultSettings(), ...line.settings } as PlanSettings, emptyContext());
      expect(plan.status ?? 'ok', `${line.name}: ${plan.warnings.map((w) => w.code).join(' ')}`).toBe('ok');
      plans.set(line.name, plan);
    }
  }, 600_000);

  const cases = LINES.flatMap((line) => MODES.map((mode) => [line.name, mode] as const));
  it.each(cases)('%s in %s mode moves its items and crowds no machine', { timeout: 120_000 }, async (name, mode) => {
    const plan = plans.get(name)!;
    const settings = { ...defaultSettings(), ...LINES.find((l) => l.name === name)!.settings, logistics: mode } as PlanSettings;
    const layout: Layout = await layoutLine(pack, plan, emptyScan(), { ...makeProject({ logistics: mode, scanId: null, baseId: null }), settings });
    const live = layout.blocks.filter((b) => b.role !== 'ghost' && b.hookup === undefined);
    const at = new Map(live.map((b) => [posKey(b.pos), b]));
    const stepOf = (id: string | undefined) => plan.steps.find((s) => s.id === id);

    // the static rules find nothing on the lines the layout lays
    expect(layout.warnings.filter((w) => w.code.startsWith('feed_')).map((w) => w.text), 'static feeding warnings').toEqual([]);

    // Multi Stack Input off on every basic machine fed two kinds, Limiting mode on on every input bus fed two
    const crowded = live.filter((b) => b.role === 'machine' && b.stepId !== undefined && stepItemInputs(plan, b.stepId).length >= 2);
    for (const b of crowded) {
      const kind = machineByMteId(pack, b.block.mteId ?? -1)?.kind;
      if (kind === 'basic' || kind === 'steam') expect(b.config?.multiStack, `${b.label} Multi Stack Input`).toBe(false);
    }
    for (const bus of live.filter((b) => b.hatch === 'input_bus' && b.stepId !== undefined && stepItemInputs(plan, b.stepId).length >= 2)) {
      expect(bus.config?.limited, `${bus.label} Limiting mode`).toBe(true);
    }

    const counts: string[] = [];
    if (mode === 'routed') {
      const pipes = live.filter((b) => b.role === 'chip_pipe');
      // what the Auto Workbenches take (plan 12 Task 6, controller ruling 188): their Item Stock Keeper Chips ask for it,
      // an Item Broadcaster Chip on each supplier answers, and the output chest's Terminator catches what only they take
      const benchTakes = new Set(live.filter((b) => b.role === 'machine' && b.feed?.bench !== undefined).flatMap((b) => stepItemInputs(plan, b.stepId!)));
      for (const p of pipes) {
        const chips = p.feed?.chips ?? [];
        expect(chips.filter((c) => c.kind !== 'stock_keeper').every((c) => c.filter?.mode === 'whitelist' && c.filter.keys.length > 0), `${p.label} chips are whitelists`).toBe(true);
        expect(chips.filter((c) => c.kind === 'stock_keeper').every((c) => (c.stock ?? []).length > 0 && c.stock!.every((x) => x.count >= 1 && x.count <= 255)),
          `${p.label} stock keepers keep a stock`).toBe(true);
        const touched = beside(at, p, p.connections ?? 0).filter((b) => b.role === 'machine' || b.role === 'hatch' || b.role === 'chest');
        expect(touched, `${p.label} serves one inventory`).toHaveLength(1);
        const t = touched[0]!;
        const kinds = chips.map((c) => c.kind);
        const listed = (...of: ChipKind[]) => [...new Set(chips.filter((c) => of.includes(c.kind)).flatMap((c) => c.filter!.keys))].sort();
        if (t.hatch === 'input_bus') expect(kinds, `${p.label} on an input bus`).not.toContain('extractor');
        if (t.hatch === 'output_bus') expect(kinds, `${p.label} on an output bus`).not.toContain('responder');
        if ((t.role === 'machine' || t.hatch === 'output_bus') && t.stepId !== undefined) {
          // what it makes leaves by its Extractor, or by its Broadcaster where a bench takes it; a bench's returns too
          const bench = t.feed?.bench === undefined ? undefined : benchPlan(pack, stepOf(t.stepId)!);
          if (bench !== undefined) expect(kinds, `${p.label} on an Auto Workbench`).toContain('stock_keeper');
          const makes = [...(t.stepIds ?? [t.stepId]).flatMap((id) => stepItemOutputs(plan, id)), ...(bench?.returns.map((r) => r.key) ?? [])];
          expect(listed('extractor', 'broadcaster'), `${p.label} sends on what it makes`).toEqual([...new Set(makes)].sort());
        }
        if (t.tail !== undefined) {
          const allowed: readonly ChipKind[] = t.tail.side === 'input' ? ['extractor', 'broadcaster'] : ['terminator'];
          expect(kinds.every((k) => allowed.includes(k)), `${t.label} chips`).toBe(true);
          const keys = listed(...allowed);
          if (t.tail.side === 'input') expect(keys, `${t.label} whitelist`).toEqual([...t.tail.keys].sort());
          else {
            expect(keys, `${t.label} whitelist`).toEqual(expect.arrayContaining([...t.tail.keys]));
            expect(keys.filter((k) => !t.tail!.keys.includes(k)).filter((k) => !benchTakes.has(k)), `${t.label} catches only what benches take besides`).toEqual([]);
          }
        }
      }
      counts.push(`${pipes.length} chip pipes, ${pipes.reduce((n, p) => n + (p.feed?.chips?.length ?? 0), 0)} chips`);
    }
    if (mode === 'ae2') {
      const interfaces = live.filter((b) => b.role === 'interface');
      let patterns = 0;
      for (const iface of interfaces) {
        const spec = iface.feed?.interface;
        if (spec === undefined) continue;
        const served = beside(at, iface).find((b) => b.stepId !== undefined && (b.role === 'machine' || b.hatch === 'input_bus'))!;
        const grid = served.feed?.bench?.grid;
        if (grid !== undefined) {
          // an Auto Workbench (plan 12 Task 6, controller ruling 204 (1)): one pattern exactly its grid, blocking mode off
          // (blocking mode counts the grid as items) and a Locking Card until the crafting result is returned
          const cells = new Map<StuffKey, number>();
          for (const k of grid) if (k !== null) cells.set(k, (cells.get(k) ?? 0) + 1);
          expect(spec.patterns.map((p) => p.inputs.map((x) => [x.key, x.amount])), `${iface.label} pattern is its grid`).toEqual([[...cells]]);
          expect(spec.lock, `${iface.label} Locking Card`).toBe('until_result');
        }
        // every recipe the machine runs (a shared machine runs several, plan 12 Task 6); a bench's grid holds its tools
        const held = grid !== undefined ? [] : [...new Set((served.stepIds ?? [served.stepId!]).flatMap((id) => stepOneOffs(pack, stepOf(id)!).map((h) => h.key)))];
        for (const p of spec.patterns) {
          patterns += 1;
          const all = [...p.inputs, ...p.outputs];
          expect(all.filter((x) => isFluidKey(x.key) || !Number.isInteger(x.amount) || x.amount < 1), `${iface.label} pattern items`).toEqual([]);
          expect(p.inputs.filter((x) => held.includes(x.key as StuffKey)), `${iface.label} pattern holds no held item`).toEqual([]);
          expect(p.outputs.length, `${iface.label} pattern outputs`).toBeGreaterThan(0);
        }
        expect(spec.blocking, `${iface.label} blocking mode`).toBe(grid === undefined && held.every((k) => ignoredByBlocking(pack, k)));
      }
      const buses = live.flatMap((b) => (b.covers ?? []).filter((c) => c.settings.mode === 'me_export'));
      // each ME Export Bus's cable carries its filter as add-on 21's ExportBusSpec
      for (const b of live.filter((x) => (x.covers ?? []).some((c) => c.settings.mode === 'me_export'))) {
        expect(b.feed?.exportBus?.keys, `${b.label} export bus feed`).toEqual(b.covers!.find((c) => c.settings.mode === 'me_export')!.filter);
      }
      // a machine whose piped fluid another machine waits for, and whose pattern no job of the line runs, is warned about
      const kindOf = (id: string | undefined) => /^basicmachine\.([a-z_]+)\.tier/.exec(machineByMteId(pack, stepOf(id)?.machine.mteId ?? -1)?.metaName ?? '')?.[1];
      const short = layout.warnings.filter((w) => w.code === 'ae2_fluid_short').map((w) => [kindOf(w.stepId), w.key]);
      const expected = FLUID_SHORT[name];
      if (expected === undefined) expect(short, 'machines AE2 runs too seldom for their piped fluids').toEqual([]);
      else expect(short, 'machines AE2 runs too seldom for their piped fluids').toEqual(expect.arrayContaining(expected.map((e) => [...e])));
      counts.push(`${interfaces.length} interfaces, ${patterns} patterns, ${buses.length} export buses, ${short.length} fluid suppliers run too seldom`);
    }
    const codes = [...new Set(layout.warnings.map((w) => w.code))].sort().join(' ');
    console.log(`real-feed ${name} ${mode}: ${plan.steps.length} steps, ${live.filter((b) => b.role === 'machine').length} machines, `
      + `${crowded.length} fed two kinds or more${counts.length > 0 ? `, ${counts.join(', ')}` : ''}; warnings ${codes || 'none'}`);
  });
});
