// Hatches by GregTech's rules from the export (exporter 0.6.0, architecture §11.49, add-on 20): the export's per-cell
// rules narrowed by a fitting row of the hand table, the export alone with a warning where no row fits, the table alone
// for an export without them, and the generic placement with `hatch_rules_unknown` where neither knows the machine.

import { describe, it, expect } from 'vitest';
import { unitsFromPlan, type Unit, type UnitCell } from '../../../src/server/layout/arrange.ts';
import { exportedCells, exportedPower, grownCells, type ExportedCells } from '../../../src/server/layout/hatch-export.ts';
import { elementMap, hatchRuleFor, hatchRulesOf, ruleFits, rulePower } from '../../../src/server/layout/hatch-rules.ts';
import type { ExportHatchKind } from '../../../src/shared/gt/hatch-kinds.ts';
import { posKey, type Vec3 } from '../../../src/shared/layout/geometry.ts';
import type { HatchKind } from '../../../src/shared/types/layout.ts';
import type { Machine, Pack, StructureInfo } from '../../../src/shared/types/pack.ts';
import type { PlanWarning } from '../../../src/shared/types/plan.ts';
import {
  FRONT_BOX_ELEMENTS, FRONT_BOX_ID, FRONT_BOX_STRUCTURE, hatchExportPack, rowElements, STEAM_BOX_ID, withElements, type ElementSpec,
} from '../../helpers/hatch-export-fixtures.ts';
import { fluidRecipe, HATCH_IDS } from '../../helpers/hatch-fixtures.ts';
import { IDS, makePlan, type StepSpec } from '../../helpers/layout-fixtures.ts';

const OX = 'fluid:oxygen';
const MI = 'fluid:molten.iron';
const ALL_SIX: readonly ExportHatchKind[] = ['input_bus', 'output_bus', 'input_hatch', 'output_hatch', 'energy', 'maintenance'];

const frontBoxStep: StepSpec = { id: 'f', mteId: FRONT_BOX_ID, count: 1, tier: 1, euPerTick: 30, inputs: [['t:in@0', 1], [OX, 1000]],
  outputs: [['t:dust@0', 1], [MI, 144]] };
const ebfStep: StepSpec = { id: 'e', mteId: IDS.EBF, count: 1, tier: 2, euPerTick: 120, inputs: [['t:dust@0', 1]], outputs: [['t:ingot@0', 1], [MI, 144]] };

/** Gives machine `mteId` of `pack` these elements, on its own structure or on `structure`; returns the machine. */
function giveElements(pack: Pack, mteId: number, specs: readonly ElementSpec[], structure?: StructureInfo): Machine {
  const m = pack.machines.get(mteId)!;
  m.structure = withElements(structure ?? m.structure!, specs);
  return m;
}

/** The one unit of a one-step plan, and the plan's warnings. */
function layOne(pack: Pack, s: StepSpec): { unit: Unit; warnings: PlanWarning[] } {
  const { units, warnings } = unitsFromPlan(pack, makePlan([s]));
  expect(units).toHaveLength(1);
  return { unit: units[0]!, warnings };
}

const hatchCells = (u: Unit): UnitCell[] => u.cells.filter((c) => c.hatch !== undefined);
const codes = (warnings: readonly PlanWarning[]): string[] => warnings.map((w) => w.code);
const isAt = (p: Vec3) => (q: Vec3): boolean => posKey(q) === posKey(p);

/** The EBF's elements: its bottom layer takes all six, its coils nothing, its top centre a muffler, the rest of its top `top`. */
function ebfElements(top: ExportHatchKind[]): ElementSpec[] {
  return [
    { ch: 'b', hatches: [...ALL_SIX], where: (p) => p[1] === 0 },
    { ch: 'C', hatches: [], where: (p) => p[1] === 1 || p[1] === 2 },
    { ch: 'm', hatches: ['muffler'], where: isAt([1, 3, 1]) },
    { ch: 'f', hatches: top, where: (p) => p[1] === 3 },
  ];
}

/** The EBF with a fifth layer of casings on top (3×5×3), which its row does not fit: its bottom takes all six, the rest nothing. */
function tallEbf(pack: Pack): Machine {
  const st = pack.machines.get(IDS.EBF)!.structure!;
  const roof = [0, 1, 2].flatMap((z) => [0, 1, 2].map((x) => ({ pos: [x, 4, z] as Vec3, block: { id: 'gregtech:gt.blockcasings', meta: 11 } })));
  return giveElements(pack, IDS.EBF, [{ ch: 'b', hatches: [...ALL_SIX], where: (p) => p[1] === 0 }, { ch: 'z', hatches: [], where: () => true }],
    { ...st, size: [3, 5, 3], blocks: [...st.blocks, ...roof] });
}

/** The cracker as GT's check takes its cells (gt-mechanics §5.5, bullet 11): either fluid hatch on each side, its inputs in the middle. */
function crackerWithElements(pack: Pack): Machine {
  const cracker = pack.machines.get(HATCH_IDS.CRACKER)!;
  const side: ExportHatchKind[] = ['input_hatch', 'output_hatch', 'energy', 'maintenance'];
  return giveElements(pack, HATCH_IDS.CRACKER, rowElements(cracker, { l: side, r: side, m: ['input_bus', 'input_hatch', 'energy', 'maintenance'], c: [] }));
}

describe("hatches by the export's rules", () => {
  it('puts every hatch on a cell whose element GregTech lets take it', () => {
    const pack = hatchExportPack();
    giveElements(pack, FRONT_BOX_ID, FRONT_BOX_ELEMENTS);
    const { unit, warnings } = layOne(pack, frontBoxStep);
    expect(hatchCells(unit).map((c) => [c.hatch, c.pos[1], c.pos[2]]).sort()).toEqual([
      ['energy', 0, 2], ['input_bus', 0, 0], ['input_hatch', 1, 2], ['maintenance', 0, 2], ['output_bus', 0, 0], ['output_hatch', 1, 2]]);
    // no row knows the machine
    expect(warnings.filter((w) => w.code === 'hatch_rules_export_only')).toEqual([{ code: 'hatch_rules_export_only', stepId: 'f',
      text: "Test Front Box: its hatches go where GregTech's structure check takes them on each casing; GregTech checks more in the controller "
        + '(sides, layers, line length) than the planner has notes for here — check in game that it forms' }]);
    for (const code of ['hatch_rules_unknown', 'hatch_cells_short', 'hatch_not_taken']) expect(codes(warnings)).not.toContain(code);
  });

  it('takes only what both the export and the hand table allow', () => {
    // the EBF's row lets its top ring f take an output hatch; this export does not, so the output hatch goes on the bottom
    const pack = hatchExportPack();
    giveElements(pack, IDS.EBF, ebfElements([]));
    const { unit, warnings } = layOne(pack, ebfStep);
    expect(unit.cells.filter((c) => c.hatch === 'output_hatch').map((c) => c.pos[1])).toEqual([0]);
    expect(codes(warnings)).not.toContain('hatch_rules_unknown');
    expect(codes(warnings)).not.toContain('hatch_rules_export_only');
  });

  it('uses the hand table for an export without hatch rules', () => {
    // the row's top ring takes output hatches
    const { unit, warnings } = layOne(hatchExportPack(), ebfStep);
    expect(unit.cells.filter((c) => c.hatch === 'output_hatch').map((c) => c.pos[1])).toEqual([3]);
    expect(codes(warnings)).not.toContain('hatch_rules_unknown');
  });

  it('warns and places generically when neither the export nor the table knows the machine', () => {
    const { warnings } = layOne(hatchExportPack(), frontBoxStep);
    expect(warnings.filter((w) => w.code === 'hatch_rules_unknown').map((w) => w.stepId)).toEqual(['f']);
  });

  it('picks a steam bus and a steam hatch where GregTech takes only those', () => {
    const pack = hatchExportPack();
    const box = giveElements(pack, STEAM_BOX_ID, [
      { ch: 'a', hatches: ['steam_input_bus', 'steam_output_bus'], where: (p) => p[1] === 0 && p[2] === 0 },
      { ch: 'k', hatches: ['steam_hatch'], where: (p) => p[1] === 0 && p[2] === 2 },
      { ch: 'c', hatches: [], where: () => true },
    ]);
    const { unit, warnings } = layOne(pack, { id: 's', mteId: STEAM_BOX_ID, count: 1, inputs: [['t:in@0', 1]], outputs: [['t:dust@0', 1]] });
    expect(unit.cells.filter((c) => c.hatch === 'input_bus').map((c) => c.block.mteId)).toEqual([HATCH_IDS.STEAM_BUS_IN]);
    expect(unit.cells.filter((c) => c.hatch === 'output_bus').map((c) => c.block.mteId)).toEqual([HATCH_IDS.STEAM_BUS_OUT]);
    expect(unit.cells.filter((c) => c.hatch === 'steam').map((c) => [c.block.mteId, c.pos[1], c.pos[2]])).toEqual([[HATCH_IDS.STEAM_HATCH, 0, 2]]);
    expect(unit.cells.some((c) => c.hatch === 'energy')).toBe(false);
    expect(unit.electric).toBe(false);
    expect(rulePower(hatchRulesOf(box)!.rule)).toBe('steam');
    expect(codes(warnings)).toEqual(expect.arrayContaining(['steam_machine', 'hatch_rules_export_only']));
    expect(codes(warnings)).not.toContain('hatch_rules_unknown');
  });

  it('grows the exported cells with a taller tower', () => {
    // a 3×3×3 tower: y 0 `b` but the controller (1, 0, 0); y 1 ring `l`, its centre absent; y 2 ring `l`, centre `c`
    const charOf = new Map<string, string>();
    for (let z = 0; z < 3; z++) {
      for (let x = 0; x < 3; x++) {
        const centre = x === 1 && z === 1;
        if (!(x === 1 && z === 0)) charOf.set(posKey([x, 0, z]), 'b');
        if (!centre) charOf.set(posKey([x, 1, z]), 'l');
        charOf.set(posKey([x, 2, z]), centre ? 'c' : 'l');
      }
    }
    const tower: ExportedCells = {
      charOf, takes: new Map([['b', new Set<HatchKind>(['input_bus'])], ['l', new Set<HatchKind>(['output_hatch'])], ['c', new Set<HatchKind>()]]),
      anywhere: new Set(['input_bus', 'output_hatch']), classes: {}, height: 3,
    };
    const grown = grownCells(tower, 2);
    expect(grown.height).toBe(5);
    const RING: readonly Vec3[] = [[0, 0, 0], [1, 0, 0], [2, 0, 0], [0, 0, 1], [2, 0, 1], [0, 0, 2], [1, 0, 2], [2, 0, 2]];
    for (const y of [1, 2, 3, 4]) expect(RING.map(([x, , z]) => grown.charOf.get(posKey([x, y, z]))), `layer ${y}`).toEqual(Array(8).fill('l'));
    expect([1, 2, 3].map((y) => grown.charOf.has(posKey([1, y, 1])))).toEqual([false, false, false]);
    expect(grown.charOf.get(posKey([1, 4, 1]))).toBe('c');
    const layer = (map: ReadonlyMap<string, string>, y: number) => [...map].filter(([key]) => key.split(',')[1] === String(y));
    expect(layer(grown.charOf, 0)).toEqual(layer(tower.charOf, 0));
    expect(grown.charOf.size).toBe(8 + 4 * 8 + 1);
    expect(grown.takes).toEqual(tower.takes);
    expect(grownCells(tower, 0)).toBe(tower);
    // a structure under 3 high grows no layer, as growLayers grows none
    const box = exportedCells({ ...hatchExportPack().machines.get(FRONT_BOX_ID)!, structure: withElements(FRONT_BOX_STRUCTURE, FRONT_BOX_ELEMENTS) })!;
    expect(grownCells(box, 2)).toBe(box);
  });

  it('says a needed hatch the export takes nowhere is not taken', () => {
    const pack = hatchExportPack();
    giveElements(pack, FRONT_BOX_ID, FRONT_BOX_ELEMENTS.map((s) => (s.ch === 'u' ? { ...s, hatches: ['output_hatch'] } : s)));
    const { unit, warnings } = layOne(pack, frontBoxStep);
    const notTaken = warnings.filter((w) => w.code === 'hatch_not_taken');
    expect(notTaken).toHaveLength(1);
    expect(notTaken[0]!.text).toContain('input hatch');
    expect(unit.cells.some((c) => c.hatch === 'input_hatch')).toBe(false);
  });

  it('says when a machine takes only multi-amp or laser energy hatches', () => {
    const pack = hatchExportPack();
    giveElements(pack, FRONT_BOX_ID, FRONT_BOX_ELEMENTS.map((s) => (s.ch === 'k' ? { ...s, hatches: ['energy_multi', 'maintenance'] } : s)));
    const { unit, warnings } = layOne(pack, frontBoxStep);
    expect(warnings.filter((w) => w.code === 'hatch_energy_exotic')).toEqual([{ code: 'hatch_energy_exotic', stepId: 'f',
      text: 'Test Front Box takes only multi-amp or laser energy hatches in GregTech: place one by hand' }]);
    expect(unit.electric).toBe(true);
    expect(unit.cells.some((c) => c.hatch === 'energy')).toBe(false);
    expect(warnings.filter((w) => w.code === 'hatch_not_taken' && w.text.includes('energy'))).toEqual([]);
  });

  it('gives an element without a character its own', () => {
    const placed = (specs: readonly ElementSpec[]) => {
      const pack = hatchExportPack();
      giveElements(pack, FRONT_BOX_ID, specs);
      return hatchCells(layOne(pack, frontBoxStep).unit).map((c) => ({ pos: c.pos, hatch: c.hatch, block: c.block }));
    };
    const named = placed(FRONT_BOX_ELEMENTS);
    expect(named).toHaveLength(6);
    expect(placed(FRONT_BOX_ELEMENTS.map(({ hatches, where }): ElementSpec => ({ hatches, where })))).toEqual(named);
  });

  it('places hatches only on the cells the export covers', () => {
    const pack = hatchExportPack();
    giveElements(pack, FRONT_BOX_ID, [
      { ch: 'a', hatches: ['input_bus', 'output_bus'], where: (p) => p[1] === 0 && p[2] === 0 },
      { ch: 'k', hatches: ['energy', 'maintenance'], where: isAt([0, 0, 2]) },
    ]);
    const { unit, warnings } = layOne(pack, { id: 'f', mteId: FRONT_BOX_ID, count: 1, tier: 1, inputs: [['t:in@0', 1]], outputs: [['t:dust@0', 1]] });
    expect(hatchCells(unit).filter((c) => !['0,0,0', '2,0,0', '0,0,2'].includes(posKey(c.pos)))).toEqual([]);
    const back = hatchCells(unit).filter((c) => c.hatch === 'energy' || c.hatch === 'maintenance');
    expect(back.map((c) => c.pos)).toEqual([[0, 0, 2]]);
    const other: HatchKind = back[0]!.hatch === 'energy' ? 'maintenance' : 'energy';
    expect(warnings.filter((w) => w.code === 'hatch_cells_short').map((w) => w.text)).toEqual([expect.stringContaining(`(${other})`)]);
    // under a fitting row too: an EBF whose export leaves out the front row of its top ring
    const ebfPack = hatchExportPack();
    const ebf = giveElements(ebfPack, IDS.EBF, ebfElements(['output_hatch']).map((s) => (s.ch === 'f' ? { ...s, where: (p: Vec3) => p[1] === 3 && p[2] > 0 } : s)));
    expect(hatchRulesOf(ebf)!.source).toBe('both');
    const covered = new Set(ebf.structure!.elements!.flatMap((e) => e.cells.map(posKey)));
    const furnace = layOne(ebfPack, ebfStep).unit;
    expect(hatchCells(furnace).filter((c) => !covered.has(posKey(c.pos)))).toEqual([]);
    expect(furnace.cells.filter((c) => c.hatch === 'output_hatch').map((c) => c.pos[1])).toEqual([3]);
  });

  it('keeps each multiblock of one line on its own source', () => {
    const pack = hatchExportPack();
    giveElements(pack, FRONT_BOX_ID, FRONT_BOX_ELEMENTS);
    const { warnings } = unitsFromPlan(pack, makePlan([frontBoxStep, { id: 'a2', mteId: IDS.AIR_MULTI, count: 1, inputs: [['t:dust@0', 1]] }]));
    expect(warnings.filter((w) => w.code === 'hatch_rules_unknown').map((w) => w.stepId)).toEqual(['a2']);
    expect(warnings.filter((w) => w.code === 'hatch_rules_export_only').map((w) => w.stepId)).toEqual(['f']);
  });

  it('keeps the muffler GregTech requires on its cell', () => {
    const pack = hatchExportPack();
    const st = pack.machines.get(IDS.EBF)!.structure!;
    const muffled: StructureInfo = { ...st, blocks: st.blocks.map((b) => (posKey(b.pos) === '1,3,1'
      ? { pos: b.pos, block: { id: 'gregtech:gt.blockmachines', meta: 3, mteId: IDS.MUFFLER } } : b)) };
    giveElements(pack, IDS.EBF, ebfElements(['output_hatch']), muffled);
    const { unit } = layOne(pack, ebfStep);
    expect(unit.cells.filter((c) => c.hatch === 'muffler').map((c) => c.pos)).toEqual([[1, 3, 1]]);
    const outputs = unit.cells.filter((c) => c.hatch === 'output_hatch');
    expect(outputs).toHaveLength(1);
    expect(posKey(outputs[0]!.pos)).not.toBe('1,3,1');
  });

  it('drops table notes that do not fit the exported structure, and says so', () => {
    const pack = hatchExportPack();
    tallEbf(pack);
    const { unit, warnings } = layOne(pack, ebfStep);
    expect(warnings.filter((w) => w.code === 'hatch_notes_unfit')).toEqual([{ code: 'hatch_notes_unfit', stepId: 'e',
      text: "Electric Blast Furnace: the planner's notes for this machine do not fit its exported structure, so its hatches follow GregTech's "
        + 'per-casing rules from the export alone; GregTech checks more in the controller — check in game that it forms' }]);
    expect(codes(warnings)).not.toContain('hatch_rules_unknown');
    expect(codes(warnings)).not.toContain('hatch_rules_export_only');
    expect(hatchCells(unit).length).toBeGreaterThan(0);
    expect(hatchCells(unit).filter((c) => c.pos[1] !== 0)).toEqual([]);
  });

  it('builds a taller tower by the exported rules and keeps its top centre free', () => {
    // what GT's check takes on the tower's cells (gt-mechanics §5.5, bullet 11): its top centre `c` takes output
    // hatches, which no layer reads
    const pack = hatchExportPack();
    const dt = pack.machines.get(HATCH_IDS.DT)!;
    giveElements(pack, HATCH_IDS.DT, rowElements(dt, {
      b: ['input_bus', 'output_bus', 'input_hatch', 'energy', 'maintenance'], l: ['output_hatch', 'energy', 'maintenance'],
      c: ['output_bus', 'output_hatch', 'maintenance'],
    }));
    const outs: Array<[string, number]> = [['fluid:t1', 100], ['fluid:t2', 100], ['fluid:t3', 100], ['fluid:t4', 100]];
    pack.recipeById.set('d', fluidRecipe('d', [], outs));
    const { unit } = layOne(pack, { id: 'd', mteId: HATCH_IDS.DT, count: 1, tier: 3, euPerTick: 480, inputs: [['t:in@0', 1]], outputs: outs });
    expect(unit.size).toEqual([3, 5, 3]);
    const outputs = unit.cells.filter((c) => c.hatch === 'output_hatch');
    expect(outputs.map((c) => [c.pos[1], c.fluid]).sort()).toEqual([[1, 'fluid:t1'], [2, 'fluid:t2'], [3, 'fluid:t3'], [4, 'fluid:t4']]);
    const rowMap = elementMap(hatchRuleFor(dt)!, dt.structure!.controller, unit.size);
    expect(outputs.map((c) => rowMap.get(posKey(c.pos)))).toEqual(['l', 'l', 'l', 'l']);
    expect(hatchCells(unit).filter((c) => c.pos[0] === 1 && c.pos[2] === 1)).toEqual([]);
  });

  it('reads the export elements into layout kinds', () => {
    const box = hatchExportPack().machines.get(FRONT_BOX_ID)!;
    const cells = exportedCells({ ...box, structure: withElements(FRONT_BOX_STRUCTURE, [
      { ch: 'a', hatches: ['input_bus', 'steam_input_bus', 'energy'], where: (p) => p[1] === 0 },
      { hatches: ['steam_output_bus'], where: (p) => p[1] === 1 },
    ]) })!;
    expect(cells.charOf.get(posKey([0, 0, 0]))).toBe('a');
    expect(cells.charOf.get(posKey([0, 1, 0]))).toBe('#1');
    expect(cells.charOf.has(posKey([1, 0, 0]))).toBe(false);                                 // the controller
    expect(cells.takes.get('a')).toEqual(new Set(['input_bus', 'energy']));
    expect(cells.takes.get('#1')).toEqual(new Set(['output_bus']));
    expect(cells.anywhere).toEqual(new Set(['input_bus', 'energy', 'steam_input_bus', 'steam_output_bus']));
    expect(cells.classes).toEqual({ output_bus: 'MTEHatchSteamBusOutput' });
    expect(cells.height).toBe(2);
    expect(exportedCells(box)).toBeNull();
  });

  it('tells the power from the export', () => {
    const box = hatchExportPack().machines.get(FRONT_BOX_ID)!;
    const power = (hatches: ExportHatchKind[]) => exportedPower(exportedCells({ ...box, structure: withElements(box.structure!, [{ hatches, where: () => true }]) })!);
    expect(power(['input_bus', 'energy', 'maintenance'])).toBe('eu');
    expect(power(['energy_multi'])).toBe('eu');
    expect(power(['energy_laser'])).toBe('eu');
    expect(power(['steam_hatch'])).toBe('steam');
    expect(power(['steam_input_bus', 'steam_output_bus'])).toBe('steam');
    expect(power(['coke_oven_hatch'])).toBe('none');
  });

  it("keeps a cracker's inputs on one side and its outputs on the other where GregTech takes both on each side", () => {
    const pack = hatchExportPack();
    crackerWithElements(pack);
    pack.recipeById.set('k', fluidRecipe('k', ['fluid:heavyfuel', 'fluid:steam'], [['fluid:crackedheavy', 100], ['fluid:woodtar', 100]]));
    const { unit, warnings } = layOne(pack, { id: 'k', mteId: HATCH_IDS.CRACKER, count: 1, tier: 3, inputs: [['fluid:heavyfuel', 100], ['fluid:steam', 100]],
      outputs: [['fluid:crackedheavy', 100], ['fluid:woodtar', 100]] });
    const hatchOf = (key: string) => unit.cells.filter((c) => c.fluid === key).map((c) => [c.hatch, c.pos[0]]);
    expect(hatchOf('fluid:heavyfuel')).toEqual([['input_hatch', 4]]);                         // the row's `l`
    expect(hatchOf('fluid:steam')).toEqual([['input_hatch', 2]]);                             // `m`
    expect(hatchOf('fluid:crackedheavy')).toEqual([['output_hatch', 0]]);                     // `r`
    expect(hatchOf('fluid:woodtar')).toEqual([['output_hatch', 0]]);
    expect(codes(warnings)).not.toContain('hatch_rules_unknown');
    expect(codes(warnings)).not.toContain('hatch_rules_export_only');
  });

  it('narrows a fitting row by the export, and names each source', () => {
    // the cracker: each side keeps only the row's hatch of the two GT's adder takes there; its notes stay the row's
    const crackerPack = hatchExportPack();
    const crackerRow = hatchRuleFor(crackerPack.machines.get(HATCH_IDS.CRACKER)!)!;
    const crackerMachine = crackerWithElements(crackerPack);
    const cracker = hatchRulesOf(crackerMachine)!;
    expect(cracker.source).toBe('both');
    expect(cracker.rule.elements.l).toEqual(['input_hatch', 'energy', 'maintenance']);
    expect(cracker.rule.elements.r).toEqual(['output_hatch', 'energy', 'maintenance']);
    expect(cracker.rule.fluidInputSlots).toEqual(crackerRow.fluidInputSlots);
    expect({ ...cracker.rule, elements: crackerRow.elements, exported: undefined }).toEqual(crackerRow);
    expect(cracker.rule.exported).toEqual(exportedCells(crackerMachine));
    // the EBF: an element the export takes nothing on keeps nothing
    const ebfPack = hatchExportPack();
    const ebfRow = hatchRuleFor(ebfPack.machines.get(IDS.EBF)!)!;
    const ebf = hatchRulesOf(giveElements(ebfPack, IDS.EBF, ebfElements([])))!;
    expect(ebf.source).toBe('both');
    expect(ebf.rule.elements.f).toEqual([]);
    expect(ebf.rule.elements.b).toEqual(ebfRow.elements.b);
    // a character keeps a kind only where the export gives it on every covered cell of it, and the row's kinds without
    // one: the top ring split over two elements, the coils and the top centre not covered. No hatch goes on an
    // uncovered cell, so the muffler GT needs there is short of a cell, not a hatch the machine takes nowhere
    const splitPack = hatchExportPack();
    const split = hatchRulesOf(giveElements(splitPack, IDS.EBF, [
      { ch: 'b', hatches: [...ALL_SIX], where: (p) => p[1] === 0 },
      { ch: 'f', hatches: ['output_hatch'], where: (p) => p[1] === 3 && p[2] === 0 },
      { ch: 'g', hatches: [], where: (p) => p[1] === 3 && p[2] > 0 && !isAt([1, 3, 1])(p) },
    ]))!;
    expect([split.source, split.rule.elements.f, split.rule.elements.m]).toEqual(['both', [], ['muffler']]);
    const splitLaid = layOne(splitPack, ebfStep);
    expect(splitLaid.unit.cells.some((c) => c.hatch === 'muffler')).toBe(false);
    expect(splitLaid.warnings.filter((w) => w.code === 'hatch_cells_short').map((w) => w.text)).toEqual([
      'Electric Blast Furnace: put the remaining hatches (muffler) on casings GregTech takes them on (it shows them in game)']);
    expect(codes(splitLaid.warnings)).not.toContain('hatch_not_taken');
    // no row: the export alone
    const boxPack = hatchExportPack();
    const box = hatchRulesOf(giveElements(boxPack, FRONT_BOX_ID, FRONT_BOX_ELEMENTS))!;
    expect([box.source, box.rowUnfit, rulePower(box.rule)]).toEqual(['export', false, 'eu']);
    expect(box.rule.elements).toEqual({ a: ['input_bus', 'output_bus'], k: ['energy', 'maintenance'], u: ['input_hatch', 'output_hatch'], c: [] });
    // a row that does not fit: the export alone, which fits as exported
    const tall = tallEbf(hatchExportPack());
    const unfit = hatchRulesOf(tall)!;
    expect([unfit.source, unfit.rowUnfit]).toEqual(['export', true]);
    const st = tall.structure!;
    expect(ruleFits(unfit.rule, st.controller, st.size, st.blocks.map((b) => b.pos))).toBe(true);
    // no elements: the row as it is, else nothing
    const plain = hatchExportPack();
    const table = hatchRulesOf(plain.machines.get(IDS.EBF)!)!;
    expect([table.source, table.rowUnfit]).toEqual(['table', false]);
    expect(table.rule).toBe(hatchRuleFor(plain.machines.get(IDS.EBF)!));
    expect(hatchRulesOf(plain.machines.get(FRONT_BOX_ID)!)).toBeNull();
  });

  it('keeps a step that draws EU electric where GregTech took none of the energy hatches the export tried, and says so', () => {
    // GT may take only energy hatches above the probe's tier (a fusion reactor's energy injectors): the line still
    // powers the machine, and the group places the energy hatch
    const pack = hatchExportPack();
    giveElements(pack, FRONT_BOX_ID, FRONT_BOX_ELEMENTS.map((s) => (s.ch === 'k' ? { ...s, hatches: [] } : s)));
    const { unit, warnings } = layOne(pack, frontBoxStep);
    expect(unit.electric).toBe(true);
    expect(unit.cells.some((c) => c.hatch === 'energy')).toBe(false);
    expect(warnings).toEqual([
      expect.objectContaining({ code: 'hatch_rules_export_only', stepId: 'f' }),
      { code: 'hatch_energy_exotic', stepId: 'f',
        text: 'Test Front Box: GregTech took none of the lowest-tier energy hatches the export tried on it, so it may take only higher tiers: place one by hand' },
    ]);
    // under a fitting row too, which runs the machine on EU: an EBF whose export took no energy hatch
    const ebfPack = hatchExportPack();
    const ebf = giveElements(ebfPack, IDS.EBF, ebfElements([]).map((s) => (s.ch === 'b' ? { ...s, hatches: ALL_SIX.filter((k) => k !== 'energy') } : s)));
    expect(hatchRulesOf(ebf)!.source).toBe('both');
    const furnace = layOne(ebfPack, ebfStep);
    expect(furnace.unit.electric).toBe(true);
    expect(furnace.unit.cells.some((c) => c.hatch === 'energy')).toBe(false);
    expect(furnace.warnings.filter((w) => w.code === 'hatch_energy_exotic').map((w) => w.text)).toEqual([
      'Electric Blast Furnace: GregTech took none of the lowest-tier energy hatches the export tried on it, so it may take only higher tiers: place one by hand']);
  });

  it('leaves a multiblock whose export took no energy hatch unpowered when its step draws no EU', () => {
    const pack = hatchExportPack();
    giveElements(pack, FRONT_BOX_ID, FRONT_BOX_ELEMENTS.map((s) => (s.ch === 'k' ? { ...s, hatches: [] } : s)));
    const { unit, warnings } = layOne(pack, { ...frontBoxStep, euPerTick: 0 });
    expect(unit.electric).toBe(false);
    expect(unit.cells.some((c) => c.hatch === 'energy')).toBe(false);
    expect(codes(warnings)).toEqual(['hatch_rules_export_only']);
  });
});
