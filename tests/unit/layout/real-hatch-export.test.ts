// Real-data acceptance of add-on 20 (architecture §11.49, research gt-mechanics.md §5.5) on an export of exporter 0.6.0:
// it carries GregTech's own hatch rules (and the basic machines' item slot counts), they match what the jars'
// definitions say, they agree with the hand table (hatch-rules.ts) wherever both have rules apart from the controller
// logic listed in EXPORT_WIDER, and the plan 09 corpus (tests/helpers/real-corpus.ts) lays out in every logistics mode
// with every hatch on a cell GregTech takes it on and no more hatch_cells_short or hatch_notes_unfit warnings than the
// table-ruled layout of the same export gives (with build cost counted, plan 12's default, two of its lines planned again
// with it ignored for the multiblocks only they still place: IGNORING_BUILD_COST). A fusion reactor, which takes energy hatches only at its own tier or
// above, lays out electric with no energy hatch and hatch_energy_exotic. It runs only with GTNH_LOCAL=1 and is skipped
// everywhere else. It prints counts, codes and the export's machine names only (pack data), never anything from a world.

import { beforeAll, describe, expect, it } from 'vitest';
import { activeExportDir, loadConfig } from '../../../src/server/config.ts';
import { unitsFromPlan, type Unit } from '../../../src/server/layout/arrange.ts';
import { exportedCells, grownCells, KIND_SOURCES } from '../../../src/server/layout/hatch-export.ts';
import { elementMap, elementTakes, hatchRuleFor, ruleFits } from '../../../src/server/layout/hatch-rules.ts';
import { emptyScan, layoutLine } from '../../../src/server/layout/layout.ts';
import { loadPack } from '../../../src/server/pack/load.ts';
import { allMachines, machineByMteId } from '../../../src/server/pack/lookup.ts';
import { emptyContext, planLine } from '../../../src/server/planner/plan.ts';
import { simpleClassName } from '../../../src/server/world/facts.ts';
import { exportKindOfClass, type ExportHatchKind } from '../../../src/shared/gt/hatch-kinds.ts';
import { posKey } from '../../../src/shared/layout/geometry.ts';
import { defaultSettings } from '../../../src/shared/project/apply-op.ts';
import type { HatchKind, Layout } from '../../../src/shared/types/layout.ts';
import type { Machine, Pack, StructureElement } from '../../../src/shared/types/pack.ts';
import type { LogisticsMode, Plan, PlanWarning } from '../../../src/shared/types/plan.ts';
import { makePlan, makeProject } from '../../helpers/layout-fixtures.ts';
import { CORPUS, VARIANTS } from '../../helpers/real-corpus.ts';

const MODES: readonly LogisticsMode[] = ['direct', 'routed', 'ae2', 'enderio'];
/** The Bricked Blast Furnace: a MetaTileEntity with no hatch lists, which the exporter does not probe. */
const UNPROBED: ReadonlySet<number> = new Set([140]);
/** The layout's hatch kinds. */
const LAYOUT_KINDS = Object.keys(KIND_SOURCES) as HatchKind[];
const ALL_SIX: readonly ExportHatchKind[] = ['input_bus', 'output_bus', 'input_hatch', 'output_hatch', 'energy', 'maintenance'];
/** The multiblocks the corpus places: EBF, Distillation Tower, Oil Cracking Unit, LCR, Vacuum Freezer, Pyrolyse Oven, Coke Oven, Bricked Blast Furnace. */
const CORPUS_MULTIBLOCKS: readonly number[] = [1000, 1126, 1160, 1169, 1002, 15546, 236, 140];
/**
 * Corpus lines planned again with build cost ignored (plan 12 Task 8, the controller's ruling after the merge e2efd36):
 * with build cost counted, the default, the corpus plans no Oil Cracking Unit (1160) and no Pyrolyse Oven (15546) — it
 * buys or makes their goods with fewer machines — while these lines still need them where build cost is ignored (measured
 * on the 2.9 export: the cracker in the Advanced Circuit a minute, the oven in it with supporting lines).
 */
const IGNORING_BUILD_COST: ReadonlyArray<{ target: string; variant: (typeof VARIANTS)[number]['label'] }> = [
  { target: 'Advanced Circuit', variant: 'per minute' },   // the cracker
  { target: 'Advanced Circuit', variant: 'per minute with supporting lines' },   // the oven
];
/** The fusion controllers Mk I–III and the tier of the energy hatch each takes at the least (MTEFusionComputer.tier()). */
const FUSION: ReadonlyArray<readonly [mteId: number, tier: number]> = [[1193, 6], [1194, 7], [1195, 8]];

/**
 * Where GregTech's check takes more than the table's row, the controller's own logic (research gt-mechanics.md §5.5,
 * bullet 11): the row keeps the layout inside what forms. Class (simple name), row character, layout kind.
 */
const EXPORT_WIDER: ReadonlyArray<{ cls: string; ch: string; kind: HatchKind; why: string }> = [
  { cls: 'MTEOilCracker', ch: 'l', kind: 'output_hatch', why: 'each side adder takes either hatch; the first one found fixes the side (mInputOnSide)' },
  { cls: 'MTEOilCracker', ch: 'r', kind: 'input_hatch', why: 'each side adder takes either hatch; the first one found fixes the side (mInputOnSide)' },
  ...(['output_bus', 'output_hatch', 'maintenance'] as const).map((kind) => ({
    cls: 'MTEDistillationTower', ch: 'c', kind, why: 'the top centre files into mOutputHatches, which no layer reads; the row keeps the centre free',
  })),
];

const wider = (cls: string, ch: string | undefined, kind: HatchKind): string => `${cls} '${ch ?? 'nothing'}' ${kind}`;

/** `name×n` per key, sorted. */
function counts(m: ReadonlyMap<string, number>): string {
  return [...m].sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0)).map(([k, n]) => `${k}×${n}`).join(', ') || 'none';
}

const bump = (m: Map<string, number>, k: string, n = 1): void => {
  m.set(k, (m.get(k) ?? 0) + n);
};

/** One element as the logs show it: its character (`#<index>` without one), its kinds and how many cells it has. */
const elementText = (e: StructureElement, k: number): string => `${e.ch ?? `#${k}`} [${e.hatches.join(', ')}] ×${e.cells.length}`;

/** Each character of `m`'s exported elements (named as `exportedCells` names them) → the export kinds its element takes. */
function exportKindsOf(m: Machine): Map<string, ReadonlySet<ExportHatchKind>> {
  const out = new Map<string, ReadonlySet<ExportHatchKind>>();
  (m.structure?.elements ?? []).forEach((e, k) => {
    const ch = e.ch ?? `#${k}`;
    const before = out.get(ch);
    out.set(ch, new Set(before === undefined ? e.hatches : e.hatches.filter((h) => before.has(h))));
  });
  return out;
}

/** `m` with no hatch rules from the export: what the hatch-rules fix alone lays out on this export. */
function withoutElements(m: Machine): Machine {
  if (m.structure?.elements === undefined) return m;
  const { elements: _elements, ...structure } = m.structure;
  return { ...m, structure };
}

/** Warnings of `code` per step. */
function perStep(warnings: readonly PlanWarning[], code: string): Map<string, PlanWarning[]> {
  const out = new Map<string, PlanWarning[]>();
  for (const w of warnings) if (w.code === code) out.set(w.stepId ?? '', [...(out.get(w.stepId ?? '') ?? []), w]);
  return out;
}

describe.skipIf(process.env.GTNH_LOCAL !== '1')('hatch rules of the 0.6.0 export on the real 2.9 pack', () => {
  let pack: Pack;
  beforeAll(async () => {
    pack = await loadPack(activeExportDir(loadConfig()));
  }, 300_000);

  /** The kinds GregTech's check took on the element of machine `mteId` with character `ch`; fails when it has none. */
  function takes(mteId: number, ch: string): ExportHatchKind[] {
    const element = machineByMteId(pack, mteId)?.structure?.elements?.find((e) => e.ch === ch);
    expect(element, `machine ${mteId} has an element '${ch}'`).toBeDefined();
    return [...element!.hatches];
  }

  it("carries GregTech's hatch rules", () => {
    const manifest = pack.manifest;
    const machines = allMachines(pack);
    const ruled = machines.filter((m) => m.structure?.elements !== undefined);
    console.log(`real-hatch-export: exporter ${manifest.exporterVersion}, hatchRules ${manifest.counts.hatchRules} of `
      + `${machines.filter((m) => m.structure !== undefined).length} structures (${ruled.length} machines with elements)`);
    for (const w of (manifest.warnings ?? []).filter((x) => x.startsWith('structures:'))) console.log(`real-hatch-export manifest: ${w}`);
    expect(manifest.exporterVersion).toBe('0.6.0');
    expect(manifest.counts.hatchRules).toBeGreaterThanOrEqual(300);
    expect(manifest.counts.hatchRules).toBe(ruled.length);
    const bbf = machineByMteId(pack, 140);
    expect(bbf?.structure, 'the Bricked Blast Furnace has a structure').toBeDefined();
    expect(bbf?.structure?.elements, 'the Bricked Blast Furnace has no hatch rules').toBeUndefined();
    for (const id of [3013, 15411]) {
      const st = machineByMteId(pack, id)?.structure;
      expect(st?.truncated, `${id} is truncated`).toBe(true);
      expect(st?.elements, `${id} has no hatch rules`).toBeUndefined();
    }
    // the item slot counts of GT's basic machines (exporter 0.6.0, architecture §11.49 (5))
    const slots = (id: number): Array<number | undefined> => [machineByMteId(pack, id)?.itemInSlots, machineByMteId(pack, id)?.itemOutSlots];
    expect(slots(302), 'the Advanced Macerator').toEqual([1, 1]);
    expect(slots(211)[0], 'the LV Assembler').toBe(6);
    expect(slots(212)[0], 'the MV Assembler').toBe(9);
    const count = (n: number | undefined): boolean => n !== undefined && Number.isInteger(n) && n >= 0;
    const basic = machines.filter((m) => m.kind === 'basic' || m.kind === 'steam');
    console.log(`real-hatch-export: item slot counts on ${basic.filter((m) => count(m.itemInSlots) && count(m.itemOutSlots)).length} `
      + `of ${basic.length} basic and steam machines`);
    expect(basic.length).toBeGreaterThan(0);
    expect(basic.filter((m) => !count(m.itemInSlots) || !count(m.itemOutSlots)).map((m) => m.mteId)).toEqual([]);
    expect(machines.filter((m) => m.kind !== 'basic' && m.kind !== 'steam' && (m.itemInSlots !== undefined || m.itemOutSlots !== undefined))
      .map((m) => m.mteId)).toEqual([]);
  });

  it('matches the definitions read from the jars', () => {
    // exact lists in EXPORT_HATCH_KINDS order: a probe GT filed and then rejected (gt-mechanics §5.5, bullet 9) fails here
    expect(takes(1000, 'b')).toEqual(ALL_SIX);
    expect(takes(1000, 'f')).toEqual(['output_hatch']);
    expect(takes(1000, 'm')).toEqual(['muffler']);
    expect(takes(1000, 'C')).toEqual([]);
    expect(takes(1126, 'b')).toEqual(['input_bus', 'output_bus', 'input_hatch', 'energy', 'maintenance']);
    expect(takes(1126, 'l')).toEqual(['output_hatch', 'energy', 'maintenance']);
    expect(takes(1126, 'c')).toEqual(['output_bus', 'output_hatch', 'maintenance']);
    expect(takes(1160, 'l')).toEqual(['input_hatch', 'output_hatch', 'energy', 'maintenance']);
    expect(takes(1160, 'r')).toEqual(['input_hatch', 'output_hatch', 'energy', 'maintenance']);
    expect(takes(1160, 'm')).toEqual(['input_bus', 'input_hatch', 'energy', 'maintenance']);
    expect(takes(15546, 'F')).toEqual(['input_bus', 'input_hatch', 'muffler']);
    expect(takes(15546, 'G')).toEqual(['output_bus', 'output_hatch', 'energy', 'maintenance']);
    expect(takes(1169, 'c')).toEqual(ALL_SIX);
    expect(takes(1169, 'x')).toEqual(ALL_SIX);
    expect(takes(1169, 'P')).toEqual([]);
    const coke = machineByMteId(pack, 236)?.structure?.elements ?? [];
    console.log(`real-hatch-export: Coke Oven 236 elements: ${coke.map(elementText).join('; ') || 'none'}`);
    expect(coke.some((e) => e.hatches.includes('coke_oven_hatch')), 'some element of the Coke Oven takes a Coke Oven Hatch').toBe(true);
    // for review, not asserted: with Task 2's verdict these are steam multiblocks and data-stick machines
    const special: ReadonlySet<ExportHatchKind> = new Set(['steam_input_bus', 'steam_output_bus', 'steam_hatch', 'data_access']);
    const marked = allMachines(pack).filter((m) => m.structure?.elements?.some((e) => e.hatches.some((h) => special.has(h))));
    console.log(`real-hatch-export: ${marked.length} machines with an element taking a steam kind or data_access: `
      + marked.map((m) => {
        const kinds = [...new Set(m.structure!.elements!.flatMap((e) => e.hatches.filter((h) => special.has(h))))];
        return `${m.mteId} ${simpleClassName(m.cls)} (${kinds.join(', ')})`;
      }).join('; '));
  });

  it('agrees with the hand table wherever both have rules, apart from the listed controller logic', () => {
    const problems: string[] = [];
    const matched = new Map<string, number>(EXPORT_WIDER.map((w) => [wider(w.cls, w.ch, w.kind), 0]));
    const cellCounts: string[] = [];
    for (const m of allMachines(pack)) {
      const st = m.structure;
      const cells = exportedCells(m);
      const row = hatchRuleFor(m);
      if (st === undefined || cells === null || row === null || !ruleFits(row, st.controller, st.size, st.blocks.map((b) => b.pos))) continue;
      const rowMap = elementMap(row, st.controller, st.size);
      let covered = 0;
      for (const b of st.blocks) {
        const key = posKey(b.pos);
        const exportedChar = cells.charOf.get(key);
        if (exportedChar === undefined) continue;
        covered++;
        const ch = rowMap.get(key);
        const given = cells.takes.get(exportedChar);
        for (const kind of LAYOUT_KINDS) {
          const byRow = elementTakes(row, ch, kind);
          const byExport = given?.has(kind) ?? false;
          if (byRow && !byExport) {
            problems.push(`${row.cls} '${ch}' ${kind} at ${b.pos.join(',')}: the table takes it, GregTech's check does not`);
          } else if (byExport && !byRow) {
            const entry = wider(row.cls, ch, kind);
            if (matched.has(entry)) bump(matched, entry);
            else problems.push(`${row.cls} '${ch ?? 'nothing'}' ${kind} at ${b.pos.join(',')}: GregTech's check takes it, the table does not`);
          }
        }
      }
      const uncovered = st.blocks.filter((b) => posKey(b.pos) !== posKey(st.controller) && !cells.charOf.has(posKey(b.pos))).length;
      cellCounts.push(`${m.mteId} ${row.cls} ${covered} covered, ${uncovered} uncovered`);
    }
    console.log(`real-hatch-export table: ${cellCounts.length} machines with both: ${cellCounts.join('; ')}`);
    console.log(`real-hatch-export table: wider in GregTech than the table: ${EXPORT_WIDER.map((w) => {
      const n = matched.get(wider(w.cls, w.ch, w.kind)) ?? 0;
      return `${wider(w.cls, w.ch, w.kind)} ${n === 0 ? 'STALE (matched no cell)' : `on ${n} cells`}`;
    }).join('; ')}`);
    expect(cellCounts.length).toBeGreaterThan(0);
    expect(problems).toEqual([]);
  });

  /** Hatch cells `checkUnit` has checked: chosen by the layout (`hatch` set), and exported ones of an export kind. */
  const checked = { chosen: 0, exported: 0 };

  /**
   * What is wrong with the hatch cells of multiblock unit `u`: a machine without the export's rules (unless unprobed);
   * a hatch cell holding a hatch of another kind than its own, or on a cell whose element GregTech's check does not take
   * that hatch on (the export's cells grown with the unit), or, where the row fits, on a cell its row character does not
   * take it on; an exported hatch of one of the export kinds on a cell whose element does not take it.
   */
  function checkUnit(u: Unit): string[] {
    if (UNPROBED.has(u.mteId)) return [];
    const m = machineByMteId(pack, u.mteId)!;
    const cells = exportedCells(m);
    if (cells === null) return ['its structure has no hatch rules in the export'];
    if (u.manual !== undefined) return [];          // run by hand: no hatch cells
    const grown = grownCells(cells, u.size[1] - cells.height);
    const kindsOf = exportKindsOf(m);
    const st = m.structure!;
    const row = hatchRuleFor(m);
    const fits = row !== null && ruleFits(row, st.controller, st.size, st.blocks.map((b) => b.pos));
    const controller = u.cells.find((c) => c.role === 'machine')!.pos;
    const rowMap = row !== null && fits ? elementMap(row, controller, u.size) : null;
    const bad: string[] = [];
    for (const c of u.cells) {
      if (c.role !== 'hatch') continue;
      const hatch = c.block.mteId === undefined ? undefined : machineByMteId(pack, c.block.mteId);
      const kind = hatch === undefined ? null : exportKindOfClass(simpleClassName(hatch.cls) ?? '', hatch.metaName);
      const key = posKey(c.pos);
      const ch = grown.charOf.get(key);
      const takenHere = kind !== null && ch !== undefined && (kindsOf.get(ch)?.has(kind) ?? false);
      const what = `${c.label} (#${c.block.mteId ?? '?'}) at ${c.pos.join(',')}`;
      if (c.hatch === undefined) {
        if (kind === null) continue;
        checked.exported++;
        if (!takenHere) bad.push(`the exported ${what} (${kind}) is on '${ch ?? 'a cell the export does not cover'}', where GregTech's check does not take it`);
        continue;
      }
      checked.chosen++;
      if (kind === null || !KIND_SOURCES[c.hatch].includes(kind)) {
        bad.push(`its ${c.hatch} cell holds ${what}, whose kind is ${kind ?? 'none of the export kinds'}`);
      } else if (!takenHere) {
        bad.push(`${what} (${kind}) is on '${ch ?? 'a cell the export does not cover'}', where GregTech's check does not take it`);
      }
      if (row !== null && rowMap !== null && !elementTakes(row, rowMap.get(key), c.hatch)) {
        bad.push(`${what} (${c.hatch}) is on the row's '${rowMap.get(key) ?? 'nothing'}', where the table does not take it`);
      }
    }
    return bad;
  }

  it('forms every corpus multiblock by the exported rules in every logistics mode', async () => {
    const tablePack: Pack = { ...pack, machines: new Map([...pack.machines].map(([id, m]) => [id, withoutElements(m)])) };
    const problems: string[] = [];
    const met = new Map<string, number>();
    const metIds = new Set<number>();
    const ruledCodes = new Map<LogisticsMode, Map<string, number>>(MODES.map((mode) => [mode, new Map()]));
    const tableCodes = new Map<LogisticsMode, Map<string, number>>(MODES.map((mode) => [mode, new Map()]));
    const lines = [
      ...CORPUS.flatMap((t) => VARIANTS.map((v) => ({ t, v, ignoring: false }))),
      ...IGNORING_BUILD_COST.map(({ target, variant }) => ({
        t: CORPUS.find((c) => c.name === target)!, v: VARIANTS.find((x) => x.label === variant)!, ignoring: true,
      })),
    ];
    for (const { t, v, ignoring } of lines) {
      const at = `${t.name} ${v.label}${ignoring ? ', build cost ignored' : ''}`;
      const plan: Plan = await planLine(pack, {
        ...defaultSettings(), target: t.key, amount: t.amount, per: v.per, tier: t.tier, routeDerived: v.routeDerived, ...(ignoring ? { buildHorizonHours: null } : {}),
      }, emptyContext());
      if (plan.status !== 'ok') {
        problems.push(`${at} - -: the plan is ${plan.status}`);
        continue;
      }
      const machineOf = (stepId: string | undefined): string => {
        const s = plan.steps.find((x) => x.id === stepId);
        return s === undefined ? `step ${stepId ?? '?'}` : `${s.machine.name} (${s.machine.mteId})`;
      };
      for (const u of unitsFromPlan(pack, plan).units) {
        if (!u.multiblock) continue;
        bump(met, `${u.name} (${u.mteId})`);
        metIds.add(u.mteId);
        for (const p of checkUnit(u)) problems.push(`${at} units ${u.name} (${u.mteId}): ${p}`);
      }
      for (const mode of MODES) {
        const ruled: Layout = await layoutLine(pack, plan, emptyScan(), makeProject({ logistics: mode }));
        const table: Layout = await layoutLine(tablePack, plan, emptyScan(), makeProject({ logistics: mode }));
        for (const w of ruled.warnings) bump(ruledCodes.get(mode)!, w.code);
        for (const w of table.warnings) bump(tableCodes.get(mode)!, w.code);
        for (const w of ruled.warnings) {
          if (w.code !== 'hatch_rules_unknown') continue;
          const mteId = plan.steps.find((s) => s.id === w.stepId)?.machine.mteId;
          if (mteId === undefined || !UNPROBED.has(mteId)) problems.push(`${at} ${mode} ${machineOf(w.stepId)}: hatch_rules_unknown: ${w.text}`);
        }
        for (const code of ['hatch_cells_short', 'hatch_notes_unfit']) {
          const before = perStep(table.warnings, code);
          for (const [stepId, ws] of perStep(ruled.warnings, code)) {
            const n = before.get(stepId)?.length ?? 0;
            if (ws.length > n) {
              problems.push(`${at} ${mode} ${machineOf(stepId)}: ${ws.length} ${code} where the table-ruled layout has ${n}: ${ws.map((w) => w.text).join(' | ')}`);
            }
          }
        }
      }
    }
    console.log(`real-hatch-export corpus: multiblock units met: ${counts(met)}; hatch cells checked: ${checked.chosen} chosen by the layout, `
      + `${checked.exported} exported`);
    for (const mode of MODES) {
      console.log(`real-hatch-export corpus ${mode}: export-ruled layout warnings: ${counts(ruledCodes.get(mode)!)}; `
        + `table-ruled: ${counts(tableCodes.get(mode)!)}`);
    }
    expect(problems).toEqual([]);
    expect(CORPUS_MULTIBLOCKS.filter((id) => !metIds.has(id)), 'corpus multiblocks never met').toEqual([]);
  }, 1_800_000);

  it('lays a fusion reactor out electric, with no energy hatch and a note to place one by hand', async () => {
    const map = 'gt.recipe.fusionreactor';
    const recipe = pack.recipes.filter((r) => r.maps.includes(map))
      .sort((a, b) => a.euPerTick - b.euPerTick || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0))[0];
    expect(recipe, `a recipe of ${map}`).toBeDefined();
    expect(recipe!.euPerTick).toBeGreaterThan(0);
    for (const [id, tier] of FUSION) {
      const m = machineByMteId(pack, id)!;
      const elements = m.structure?.elements;
      console.log(`real-hatch-export: ${m.name} (${id}) elements: ${(elements ?? []).map(elementText).join('; ') || 'none'}`);
      expect(elements, `${m.name} has hatch rules`).toBeDefined();
      expect(elements!.filter((e) => e.hatches.includes('energy')).map((e) => e.ch), `${m.name}: elements taking an energy hatch`).toEqual([]);
      // one step on the controller, its id the recipe's so the layout reads the recipe's fluids
      const plan = makePlan([{
        id: recipe!.id, mteId: id, count: 1, tier, euPerTick: recipe!.euPerTick, name: m.name,
        inputs: recipe!.inputs.map((i): [string, number] => [i.options[0]!.key, i.options[0]!.amount]),
        outputs: recipe!.outputs.map((p): [string, number] => [p.key, p.amount]),
      }]);
      const { units, warnings } = unitsFromPlan(pack, plan);
      const unit = units.find((u) => u.mteId === id);
      expect(unit, `${m.name}'s unit`).toBeDefined();
      expect(unit!.electric, `${m.name} is electric`).toBe(true);
      expect(unit!.cells.filter((c) => c.hatch === 'energy').map((c) => c.pos.join(',')), `${m.name}: energy hatches`).toEqual([]);
      expect(warnings.filter((w) => w.code === 'hatch_energy_exotic' && w.stepId === recipe!.id), `${m.name}: hatch_energy_exotic`).toHaveLength(1);
      for (const mode of MODES) {
        const layout = await layoutLine(pack, plan, emptyScan(), makeProject({ logistics: mode }));
        const exotic = layout.warnings.filter((w) => w.code === 'hatch_energy_exotic' && w.stepId === recipe!.id);
        expect(exotic, `${m.name} ${mode}: hatch_energy_exotic`).toHaveLength(1);
        expect(exotic[0]!.text, `${m.name} ${mode}`).toContain('only higher tiers');
      }
    }
  }, 600_000);
});
