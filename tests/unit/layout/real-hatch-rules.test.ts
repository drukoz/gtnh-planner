// Real-data check of the hatch rules (hatch-rules.ts, research hatch-rules.md): every row fits the exported structure
// of its class, and the real-data corpus lines (the targets of tests/unit/planner/real-*.test.ts) laid out in every
// logistics mode put no hatch on a cell its controller's rule forbids. It runs only with GTNH_LOCAL=1 and is skipped
// everywhere else. It prints counts, codes and the export's machine names only (pack data), never anything from a world.

import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { activeExportDir, loadConfig } from '../../../src/server/config.ts';
import { overlaps, unitsFromPlan, type Unit } from '../../../src/server/layout/arrange.ts';
import { elementMap, elementTakes, HATCH_RULES, hatchRuleFor, ruleFits } from '../../../src/server/layout/hatch-rules.ts';
import { emptyScan, layoutLine } from '../../../src/server/layout/layout.ts';
import { loadPack } from '../../../src/server/pack/load.ts';
import { emptyContext, planLine } from '../../../src/server/planner/plan.ts';
import { simpleClassName } from '../../../src/server/world/facts.ts';
import { isFluidKey } from '../../../src/shared/keys.ts';
import { posKey } from '../../../src/shared/layout/geometry.ts';
import { defaultSettings, normalizeSettings } from '../../../src/shared/project/apply-op.ts';
import type { Pack } from '../../../src/shared/types/pack.ts';
import type { LogisticsMode, PlanSettings } from '../../../src/shared/types/plan.ts';
import { makeProject } from '../../helpers/layout-fixtures.ts';

const MODES: readonly LogisticsMode[] = ['direct', 'routed', 'ae2', 'enderio'];

/** real-corpus.test.ts's 16 targets at their natural tiers, in its three variants. */
const CORPUS: ReadonlyArray<readonly [string, string, number, number]> = [
  ['Electronic Circuit', 'IC2:itemPartCircuit@0', 1, 1], ['Good Electronic Circuit', 'gregtech:gt.metaitem.01@32702', 2, 1],
  ['Integrated Logic Circuit', 'gregtech:gt.metaitem.01@32701', 2, 1], ['Advanced Circuit', 'IC2:itemPartCircuitAdv@0', 3, 1],
  ['Vacuum Tube', 'gregtech:gt.metaitem.01@32700', 1, 1], ['Resistor', 'gregtech:gt.metaitem.01@32716', 1, 1],
  ['Glass Tube', 'gregtech:gt.metaitem.03@32012', 1, 1], ['Circuit Board', 'gregtech:gt.metaitem.03@32100', 1, 1],
  ['LV Machine Hull', 'gregtech:gt.blockmachines@11', 1, 1], ['MV Machine Hull', 'gregtech:gt.blockmachines@12', 2, 1],
  ['Electric Motor (LV)', 'gregtech:gt.metaitem.01@32600', 1, 1], ['Electric Pump (LV)', 'gregtech:gt.metaitem.01@32610', 1, 1],
  ['Robot Arm (LV)', 'gregtech:gt.metaitem.01@32650', 1, 1], ['Robot Arm (MV)', 'gregtech:gt.metaitem.01@32651', 2, 1],
  ['Polyethylene (PE) Bar', 'gregtech:gt.metaitem.01@11874', 1, 1], ['Steel Ingot', 'gregtech:gt.metaitem.01@11305', 1, 10],
];
const VARIANTS = [
  { label: 'per minute', per: 'min', routeDerived: false }, { label: 'per hour', per: 'hour', routeDerived: false },
  { label: 'per minute with supporting lines', per: 'min', routeDerived: true },
] as const;
/** real-acceptance.test.ts's further lines (without its avoid lists). */
const ACCEPTANCE: ReadonlyArray<readonly [string, Partial<PlanSettings>]> = [
  ['Electronic Circuit at MV', { target: 'IC2:itemPartCircuit@0', amount: 1, tier: 2 }],
  ['2 Good Electronic Circuits at HV', { target: 'gregtech:gt.metaitem.01@32702', amount: 2, tier: 3 }],
  ['Steel Ingot at MV without supporting lines', { target: 'gregtech:gt.metaitem.01@11305', amount: 10, tier: 2, routeDerived: false }],
  ['Steel Ingot at MV', { target: 'gregtech:gt.metaitem.01@11305', amount: 10, tier: 2 }],
  ['Aluminium Ingot at HV', { target: 'gregtech:gt.metaitem.01@11019', amount: 10, tier: 3 }],
  ['Advanced Circuit at HV without a step charge', { target: 'IC2:itemPartCircuitAdv@0', amount: 1, tier: 3, stepCharge: 0 }],
  ['2 Microprocessors at HV', { target: 'gregtech:gt.metaitem.03@32078', amount: 2, tier: 3 }],
];
/** real-user-project.test.ts's stored settings. */
const STORED: Partial<PlanSettings> = {
  target: 'IC2:itemPartCircuit@0', mode: 'rate', amount: 1, per: 'hour', tier: 2, dims: { policy: 'progression', overrides: {} },
  routeDerived: false, logistics: 'routed', costOverrides: {}, stopItems: [], expandItems: [],
  recipeChoice: { 'fluid:glue': '98f259e40a64e8b0', 'gregtech:gt.metaitem.01@32716': '0a074f4241a9e0f9' }, machineTier: {},
  excludedCategories: ['recycling', 'massfab', 'replicator', 'scrap', 'lava-centrifuge', 'programmed-circuit-conversion'],
  coilHeat: null, automateCrafting: false, declineReuse: [],
};

function lines(): Array<{ name: string; settings: PlanSettings }> {
  const out: Array<{ name: string; settings: PlanSettings }> = [];
  for (const [name, target, tier, amount] of CORPUS) {
    for (const v of VARIANTS) out.push({ name: `${name} ${v.label}`, settings: { ...defaultSettings(), target, amount, per: v.per, tier, routeDerived: v.routeDerived } });
  }
  for (const [name, s] of ACCEPTANCE) out.push({ name, settings: { ...defaultSettings(), per: 'min', ...s } });
  const user = normalizeSettings(STORED);
  out.push({ name: "the user's Electronic Circuit project", settings: user });
  out.push({ name: "the user's project with supporting lines", settings: { ...user, routeDerived: true } });
  out.push({ name: "the user's project for an Advanced Circuit", settings: { ...user, target: 'IC2:itemPartCircuitAdv@0', tier: 3, stepCharge: 0 } });
  return out;
}

/** `name×n` per key, sorted. */
function counts(m: ReadonlyMap<string, number>): string {
  return [...m].sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0)).map(([k, n]) => `${k}×${n}`).join(', ') || 'none';
}

describe.skipIf(process.env.GTNH_LOCAL !== '1')('hatch rules on the real 2.9 export', () => {
  let pack: Pack;
  const placed = new Map<string, number>();
  const unruled = new Map<string, number>();
  const codes = new Map<string, number>();
  const bump = (m: Map<string, number>, k: string) => m.set(k, (m.get(k) ?? 0) + 1);

  beforeAll(async () => {
    pack = await loadPack(activeExportDir(loadConfig()));
  }, 300_000);

  afterAll(() => {
    if (pack === undefined) return;
    console.log(`real-hatch-rules: placed multiblock steps with a row: ${counts(placed)}; without a row: ${counts(unruled)}; `
      + `layout warnings: ${counts(codes)}`);
  });

  it('fits every row to the exported structure of its class', () => {
    const fits = HATCH_RULES.map((rule) => {
      const machines = [...pack.machines.values()].filter((m) => m.kind === 'multiblock' && simpleClassName(m.cls) === rule.cls);
      const st = machines[0]?.structure;
      return { cls: rule.cls, machines: machines.length,
        fits: st !== undefined && ruleFits(rule, st.controller, st.size, st.blocks.map((b) => b.pos)) };
    });
    console.log(`real-hatch-rules rows: ${fits.map((f) => `${f.cls} ${f.machines} ${f.fits ? 'fits' : 'DOES NOT FIT'}`).join(', ')}`);
    expect(fits.filter((f) => f.machines !== 1 || !f.fits).map((f) => f.cls)).toEqual([]);
  });

  /** Every hatch the layout chose, on a cell whose element takes its kind; the tower's and the cracker's fluid rules. */
  function checkUnit(u: Unit, recipeFluids: { inputs: string[]; outputs: string[] }): string[] {
    const m = pack.machines.get(u.mteId)!;
    const rule = hatchRuleFor(m);
    const st = m.structure;
    if (rule === null || st === undefined || !ruleFits(rule, st.controller, st.size, st.blocks.map((b) => b.pos))) return [];
    const controller = u.cells.find((c) => c.role === 'machine')!.pos;
    const map = elementMap(rule, controller, u.size);
    const bad: string[] = [];
    for (const c of u.cells) {
      if (c.hatch === undefined) continue;
      const ch = map.get(posKey(c.pos));
      if (!elementTakes(rule, ch, c.hatch)) bad.push(`${u.name}: ${c.hatch} on '${ch ?? 'nothing'}' at ${c.pos.join(',')}`);
    }
    if (rule.layerOutputs !== undefined) {
      const order = recipeFluids.outputs.filter((k) => u.io.fluidOut.includes(k));
      for (const c of u.cells) {
        if (c.hatch === 'output_hatch' && c.fluid !== undefined && order.indexOf(c.fluid) + 1 !== c.pos[1]) bad.push(`${u.name}: ${c.fluid} on layer ${c.pos[1]}`);
      }
      for (let y = 1; y < u.size[1]; y++) if (!u.cells.some((c) => c.hatch === 'output_hatch' && c.pos[1] === y)) bad.push(`${u.name}: no output hatch on layer ${y}`);
    }
    if (rule.fluidInputSlots !== undefined) {
      for (const [slot, chars] of Object.entries(rule.fluidInputSlots)) {
        const key = recipeFluids.inputs[Number(slot)];
        const c = u.cells.find((x) => x.hatch === 'input_hatch' && x.fluid === key);
        if (key !== undefined && c !== undefined && !chars.includes(map.get(posKey(c.pos)) ?? '')) bad.push(`${u.name}: fluid slot ${slot} on '${map.get(posKey(c.pos))}'`);
      }
    }
    if (rule.needs?.includes('muffler') === true && !u.cells.some((c) => c.hatch === 'muffler')) bad.push(`${u.name}: no muffler`);
    return bad;
  }

  it.each(lines())('lays out $name in every mode with every hatch where GregTech takes it', { timeout: 120_000 }, async ({ settings }) => {
    const plan = await planLine(pack, settings, emptyContext());
    expect(plan.status).toBe('ok');
    const { units } = unitsFromPlan(pack, plan);
    const seen = new Set<string>();
    const bad: string[] = [];
    for (const u of units) {
      if (!u.multiblock || seen.has(u.stepId)) continue;
      seen.add(u.stepId);
      const m = pack.machines.get(u.mteId)!;
      bump(hatchRuleFor(m) === null ? unruled : placed, u.name);
      const recipe = pack.recipeById.get(plan.steps.find((s) => s.id === u.stepId)!.recipeId);
      const fluidInputs = (recipe?.inputs ?? []).filter((i) => i.slot >= 100).sort((a, b) => a.slot - b.slot).map((i) => i.options[0]!.key);
      const fluidOutputs = [...new Set((recipe?.outputs ?? []).filter((p) => isFluidKey(p.key)).map((p) => p.key))];
      bad.push(...checkUnit(u, { inputs: fluidInputs, outputs: fluidOutputs }));
    }
    expect(bad).toEqual([]);
    const hatches = units.reduce((n, u) => n + u.cells.filter((c) => c.role === 'hatch').length, 0);
    for (const mode of MODES) {
      const project = { ...makeProject({ scanId: null, baseId: null }), settings: { ...settings, logistics: mode } };
      const layout = await layoutLine(pack, plan, emptyScan(), project);
      expect(layout.status, mode).toBe('no-world');
      expect(overlaps(layout.blocks.filter((b) => b.role !== 'ghost')).length, `${mode}: cells holding two blocks`).toBe(0);
      expect(layout.blocks.filter((b) => b.role === 'hatch').length, `${mode}: hatches in the layout`).toBe(hatches);
      for (const w of layout.warnings) bump(codes, `${mode} ${w.code}`);
    }
  });
});
