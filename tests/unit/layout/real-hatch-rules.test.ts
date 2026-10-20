// Real-data check of the hatch rules (hatch-rules.ts, research hatch-rules.md): every row fits the exported structure
// of its class, and the corpus lines (tests/helpers/real-corpus-lines.ts: every line the planner's real-data tests
// plan) laid out in every logistics mode put every hatch on a cell its controller's rule takes it on, meet what
// GregTech's checkMachine asks of each class (`GT_CHECKS`, kept apart from the table: the hatches it needs, a few element
// facts in the export frame, its casing minimum) and join every fluid and bus port to its pipe, conduit face or
// interface, or warn route_failed for its step. It runs only with GTNH_LOCAL=1 and is skipped everywhere else. It
// prints counts, codes and the export's machine names only (pack data), never anything from a world.

import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { activeExportDir, loadConfig } from '../../../src/server/config.ts';
import { overlaps, placeUnits, unitsFromPlan, type HatchKind, type PlacedUnit, type Unit, type UnitCell } from '../../../src/server/layout/arrange.ts';
import { elementMap, elementTakes, HATCH_RULES, hatchRuleFor, ruleFits } from '../../../src/server/layout/hatch-rules.ts';
import { headWidthFor } from '../../../src/server/layout/internal.ts';
import { DEFAULT_ORIGIN, emptyScan, layoutLine } from '../../../src/server/layout/layout.ts';
import { PORT_SPACING } from '../../../src/server/layout/modes/mode.ts';
import { tierGroups, transformerStages } from '../../../src/server/layout/power.ts';
import { loadPack } from '../../../src/server/pack/load.ts';
import { emptyContext, planLine } from '../../../src/server/planner/plan.ts';
import { simpleClassName } from '../../../src/server/world/facts.ts';
import { isFluidKey } from '../../../src/shared/keys.ts';
import { OPPOSITE, posKey, step, type Vec3 } from '../../../src/shared/layout/geometry.ts';
import { FACES } from '../../../src/shared/types/assets.ts';
import type { Layout, LayoutBlock } from '../../../src/shared/types/layout.ts';
import type { Pack } from '../../../src/shared/types/pack.ts';
import type { LogisticsMode, Plan } from '../../../src/shared/types/plan.ts';
import { makeProject } from '../../helpers/layout-fixtures.ts';
import { realCorpusLines } from '../../helpers/real-corpus-lines.ts';

const MODES: readonly LogisticsMode[] = ['direct', 'routed', 'ae2', 'enderio'];
const ALL_KINDS: readonly HatchKind[] = ['energy', 'input_bus', 'output_bus', 'input_hatch', 'output_hatch', 'maintenance', 'muffler', 'steam'];

/** What GT's checkMachine asks of a formed machine of a class, kept apart from hatch-rules.ts. */
interface GtCheck {
  /** checkHasEnergyHatch, checkHasMaintenanceHatch, checkHasMufflerHatch, checkHasInputHatch, …: at least one of each. */
  needs: readonly HatchKind[];
  /** Kinds the structure takes nowhere. */
  never?: readonly HatchKind[];
  /** checkOneOutputHatch: exactly one. */
  one?: readonly HatchKind[];
  /** checkCasingMin over the unit's most common casing block, for a structure `height` high. */
  casings?: (height: number) => number;
  /** Element facts in the export frame (front on the north, x west of the controller as GT's a grows, y up): faults. */
  facts?: (hatches: readonly UnitCell[], size: Vec3) => string[];
}

const fault = (what: string) => (c: UnitCell): string => `${c.hatch} at ${c.pos.join(',')}: ${what}`;
const kindIn = (c: UnitCell, kinds: readonly HatchKind[]): boolean => c.hatch !== undefined && kinds.includes(c.hatch);
/** Hatches anywhere but the bottom and top layers (the glass between them). */
const offTopAndBottom = (hs: readonly UnitCell[], size: Vec3): string[] =>
  hs.filter((c) => c.pos[1] !== 0 && c.pos[1] !== size[1] - 1).map(fault('between the top and bottom layers'));

/** Read from gregtech 5.09.54.183 (research hatch-rules.md §4): each class's checkMachine and its elements. */
const GT_CHECKS: Readonly<Record<string, GtCheck>> = {
  // b, the bottom layer but the controller, takes all six; f, the top layer but its middle, an output hatch only; m, the
  // top middle, the muffler only (Muffler.newAny); checkHasEnergyHatch, checkHasMaintenanceHatch
  MTEElectricBlastFurnace: { needs: ['energy', 'maintenance', 'muffler'], facts: (hs) => [
    ...hs.filter((c) => c.pos[1] > 0 && !kindIn(c, ['output_hatch', 'muffler'])).map(fault('above the bottom layer')),
    ...hs.filter((c) => c.hatch === 'muffler' && posKey(c.pos) !== '1,3,1').map(fault('off the top middle')),
  ] },
  // b, the bottom: energy, output bus, input hatch and bus, maintenance; l, each layer above: its layer's output hatch,
  // energy, maintenance; c, a layer's middle: air below the top; missingOutputHatchDT; at least 3 layers;
  // checkCasingMin(7 × layers − 5); checkHasEnergyHatch, checkHasMaintenanceHatch, checkHasInputHatch
  MTEDistillationTower: { needs: ['energy', 'maintenance', 'input_hatch'], casings: (h) => 7 * h - 5, facts: (hs, size) => [
    ...(size[1] < 3 ? [`${size[1]} layers`] : []),
    ...hs.filter((c) => c.pos[1] === 0 && !kindIn(c, ['energy', 'output_bus', 'input_hatch', 'input_bus', 'maintenance'])).map(fault('on the bottom')),
    ...hs.filter((c) => c.pos[1] > 0 && !kindIn(c, ['output_hatch', 'energy', 'maintenance'])).map(fault('above the bottom')),
    ...hs.filter((c) => c.pos[1] > 0 && c.pos[0] === 1 && c.pos[2] === 1).map(fault("in a layer's middle")),
    ...Array.from({ length: size[1] - 1 }, (_, i) => i + 1)
      .filter((y) => !hs.some((c) => c.hatch === 'output_hatch' && c.pos[1] === y)).map((y) => `no output hatch on layer ${y}`),
  ] },
  // c and x take all six; P, the middle, is the PTFE pipe casing; need_exactly_one_coil; checkCasingMin(8)
  MTELargeChemicalReactor: { needs: ['energy', 'maintenance'], casings: () => 8,
    facts: (hs) => hs.filter((c) => posKey(c.pos) === '1,1,1').map(fault('on the PTFE pipe casing')) },
  // l (x = 4): the side input hatch; r (x = 0): the side output hatch; m (x = 2): the middle input hatch or an input bus;
  // c (x = 1, 3): coils; missingHatch(InputHatch), missingHatch(OutputHatch), cracker_missing_middle_input_hatch;
  // checkCasingMin(18)
  MTEOilCracker: { needs: ['energy', 'maintenance'], casings: () => 18, facts: (hs) => [
    ...hs.filter((c) => c.pos[0] === 1 || c.pos[0] === 3).map(fault('on a coil column')),
    ...hs.filter((c) => c.hatch === 'input_hatch' && c.pos[0] === 0).map(fault('on the output side')),
    ...hs.filter((c) => c.hatch === 'output_hatch' && c.pos[0] !== 0).map(fault('off the output side')),
    ...[4, 2].filter((x) => !hs.some((c) => c.hatch === 'input_hatch' && c.pos[0] === x)).map((x) => `no input hatch at x = ${x}`),
    ...(hs.some((c) => c.hatch === 'output_hatch' && c.pos[0] === 0) ? [] : ['no output hatch at x = 0']),
  ] },
  // C takes all six; checkCasingMin(16)
  MTEVacuumFreezer: { needs: ['energy', 'maintenance'], casings: () => 16 },
  // C takes the buses, maintenance, energy and the muffler; checkHasMufflerHatch, checkHasInputBus, checkHasOutputBus;
  // checkCasingMin(16)
  MTEImplosionCompressor: { needs: ['energy', 'maintenance', 'muffler', 'input_bus', 'output_bus'], never: ['input_hatch', 'output_hatch'], casings: () => 16 },
  // G, the bottom layer: output bus and hatch, energy, maintenance; F (y = 2, 3): input bus and hatch, the muffler; D, the
  // controller's layer: casings; checkHasMufflerHatch; checkCasingMin(60)
  MTEPyrolyseOven: { needs: ['energy', 'maintenance', 'muffler'], casings: () => 60, facts: (hs) => [
    ...hs.filter((c) => c.pos[1] < 2 && kindIn(c, ['input_bus', 'input_hatch', 'muffler'])).map(fault('below the F levels')),
    ...hs.filter((c) => c.pos[1] > 0 && kindIn(c, ['output_bus', 'output_hatch', 'energy', 'maintenance'])).map(fault('above the bottom layer')),
  ] },
  // c, the top and bottom layers: all six; g: glass; checkHasInputHatch, checkOneOutputHatch; checkCasingMin(19)
  MTEBioVat: { needs: ['energy', 'maintenance', 'input_hatch'], one: ['output_hatch'], casings: () => 19, facts: offTopAndBottom },
  // A, the top and bottom layers: all but an output hatch; checkHasInputBus, checkHasInputHatch, checkHasOutputBus;
  // checkCasingMin(15)
  MTESolarFactory: { needs: ['energy', 'maintenance', 'input_bus', 'input_hatch', 'output_bus'], never: ['output_hatch'], casings: () => 15,
    facts: offTopAndBottom },
  // a steam machine: no energy hatch, no maintenance (getDefaultHasMaintenanceChecks false); checkHasSteamInput;
  // checkCasingMin(25)
  MTESteamMixer: { needs: ['steam'], never: ['energy', 'maintenance'], casings: () => 25 },
  // MTELargeBoilerBase: no EU; checkHasMaintenanceHatch, checkHasMufflerHatch, checkHasInputHatch, checkHasOutputHatch;
  // checkCasingMin(20) casings
  MTELargeBoilerBronze: { needs: ['maintenance', 'muffler', 'input_hatch', 'output_hatch'], never: ['energy'], casings: () => 20 },
  // a MetaTileEntity of firebricks; the coke oven takes only Coke Oven Hatches
  MTEBrickedBlastFurnace: { needs: [], never: ALL_KINDS },
  MTECokeOven: { needs: [], never: ALL_KINDS },
};

/** `name×n` per key, sorted. */
function counts(m: ReadonlyMap<string, number>): string {
  return [...m].sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0)).map(([k, n]) => `${k}×${n}`).join(', ') || 'none';
}

/** Where layoutLine places the units of a line without a world: placeUnits as buildLocal calls it. */
function placedUnits(units: readonly Unit[], mode: LogisticsMode): PlacedUnit[] {
  const electric = units.filter((u) => u.electric);
  const stages = electric.length === 0 ? null : transformerStages(tierGroups(electric), Math.max(...electric.map((u) => u.tier)));
  return placeUnits(units, { headWidth: headWidthFor(stages), portSpacing: PORT_SPACING[mode], ...(stages === null ? {} : { supplyTier: stages.supplyTier }) }).units;
}

describe.skipIf(process.env.GTNH_LOCAL !== '1')('hatch rules on the real 2.9 export', () => {
  let pack: Pack;
  const placed = new Map<string, number>();
  const unruled = new Map<string, number>();
  const codes = new Map<string, number>();
  const ports = new Map<string, number>();
  const bump = (m: Map<string, number>, k: string) => m.set(k, (m.get(k) ?? 0) + 1);

  beforeAll(async () => {
    pack = await loadPack(activeExportDir(loadConfig()));
  }, 300_000);

  afterAll(() => {
    if (pack === undefined) return;
    console.log(`real-hatch-rules: placed multiblock steps with a row: ${counts(placed)}; without a row: ${counts(unruled)}; `
      + `ports: ${counts(ports)}; layout warnings: ${counts(codes)}`);
  });

  it('fits every row to the exported structure of its class, and checks every class it has a row for', () => {
    const fits = HATCH_RULES.map((rule) => {
      const machines = [...pack.machines.values()].filter((m) => m.kind === 'multiblock' && simpleClassName(m.cls) === rule.cls);
      const st = machines[0]?.structure;
      return { cls: rule.cls, machines: machines.length,
        fits: st !== undefined && ruleFits(rule, st.controller, st.size, st.blocks.map((b) => b.pos)) };
    });
    console.log(`real-hatch-rules rows: ${fits.map((f) => `${f.cls} ${f.machines} ${f.fits ? 'fits' : 'DOES NOT FIT'}`).join(', ')}`);
    expect(fits.filter((f) => f.machines !== 1 || !f.fits).map((f) => f.cls)).toEqual([]);
    expect(HATCH_RULES.map((r) => r.cls).filter((cls) => GT_CHECKS[cls] === undefined)).toEqual([]);
  });

  /** Every hatch the layout chose, on a cell whose element takes its kind (the table); the tower's and the cracker's fluid rules. */
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
    }
    if (rule.fluidInputSlots !== undefined) {
      for (const [slot, chars] of Object.entries(rule.fluidInputSlots)) {
        const key = recipeFluids.inputs[Number(slot)];
        const c = u.cells.find((x) => x.hatch === 'input_hatch' && x.fluid === key);
        if (key !== undefined && c !== undefined && !chars.includes(map.get(posKey(c.pos)) ?? '')) bad.push(`${u.name}: fluid slot ${slot} on '${map.get(posKey(c.pos))}'`);
      }
    }
    return bad;
  }

  /** What GT_CHECKS says of the unit's class that the unit does not meet. */
  function checkGt(u: Unit): string[] {
    const cls = simpleClassName(pack.machines.get(u.mteId)!.cls) ?? '';
    const check = GT_CHECKS[cls];
    if (check === undefined) return [];
    const hatches = u.cells.filter((c) => c.hatch !== undefined);
    const n = (kind: HatchKind) => hatches.filter((c) => c.hatch === kind).length;
    const bad = [
      ...check.needs.filter((k) => n(k) === 0).map((k) => `no ${k}`),
      ...(check.never ?? []).filter((k) => n(k) > 0).map((k) => `${n(k)} ${k}`),
      ...(check.one ?? []).filter((k) => n(k) !== 1).map((k) => `${n(k)} ${k}, not one`),
      ...(check.facts?.(hatches, u.size) ?? []),
    ];
    if (check.casings !== undefined) {
      const byBlock = new Map<string, number>();
      for (const c of u.cells) if (c.role === 'casing') bump(byBlock, `${c.block.id}@${c.block.meta}`);
      const most = Math.max(0, ...byBlock.values());
      if (most < check.casings(u.size[1])) bad.push(`${most} casings, fewer than ${check.casings(u.size[1])}`);
    }
    return bad.map((b) => `${u.name} (${cls}): ${b}`);
  }

  /**
   * Every fluid port of the line's multiblocks, and every bus port that moves the step's items (an input bus that holds
   * only the programmed circuit takes nothing), joined to its hatch by a pipe (GT pipes, a routed interface pipe, an ME
   * interface) or a conduit face, or a fluid port the layout warns route_failed for (by its text: the layout gives each
   * text once, so two steps of one machine share it); a port that faces no hatch of its unit is a fault of the placement
   * this test copies.
   */
  function checkPorts(plan: Plan, units: readonly Unit[], layout: Layout, mode: LogisticsMode): string[] {
    const blocksAt = new Map<string, LayoutBlock[]>();
    for (const b of layout.blocks) {
      const key = posKey(b.pos);
      blocksAt.set(key, [...(blocksAt.get(key) ?? []), b]);
    }
    const world = (p: Vec3): Vec3 => [p[0] + DEFAULT_ORIGIN[0], p[1] + DEFAULT_ORIGIN[1], p[2] + DEFAULT_ORIGIN[2]];
    const at = (p: Vec3) => blocksAt.get(posKey(world(p))) ?? [];
    const failed = layout.warnings.filter((w) => w.code === 'route_failed').map((w) => w.text);
    const warned = (u: Unit, name: string) =>
      failed.some((t) => t.includes(mode === 'enderio' ? ` to ${u.name} — ` : ` the ${name} pipe to ${u.name} — `));
    const bad: string[] = [];
    const faces = (p: Vec3, side: number, conduit: (kind: string) => boolean): boolean =>
      at(p).some((b) => (b.conduits ?? []).some((c) => conduit(c.kind) && c.faces.some((f) => f.face === FACES[side] && f.mode !== 'disabled')));
    for (const u of placedUnits(units, mode)) {
      if (!u.multiblock) continue;
      const hatchOf = (p: Vec3, side: number) => at(step(p, side)).find((b) => b.role === 'hatch' && b.stepId === u.stepId && b.facing === OPPOSITE[side]);
      const fluidPorts = [
        ...u.ports.fluidIn.map((p, i) => ({ p, side: u.ports.fluidInSides[i]!, key: u.io.fluidIn[i]! })),
        ...u.ports.fluidOut.map((p, i) => ({ p, side: u.ports.fluidOutSides[i]!, key: u.io.fluidOut[i]! })),
      ];
      for (const { p, side, key } of fluidPorts) {
        if (hatchOf(p, side) === undefined) {
          bad.push(`${u.name}: the ${key} port at ${p.join(',')} faces no hatch of its unit`);
          continue;
        }
        const name = plan.names?.[key] ?? pack.nameOf(key);
        const joined = mode === 'enderio' ? faces(p, side, (kind) => kind !== 'item')
          : at(p).some((b) => b.role === 'pipe' && b.label.includes(`(${name})`) && (((b.connections ?? 0) >> side) & 1) === 1);
        bump(ports, `${mode} fluid ${joined ? 'joined' : warned(u, name) ? 'warned' : 'LOOSE'}`);
        if (!joined && !warned(u, name)) bad.push(`${mode}: ${u.name}'s ${name} port at ${p.join(',')} is not joined and not warned`);
      }
      const side = OPPOSITE[u.facing]!;
      for (const p of u.ports.items) {
        const bus = hatchOf(p, side);
        if (bus === undefined) {
          bad.push(`${u.name}: the bus port at ${p.join(',')} faces no hatch of its unit`);
          continue;
        }
        const kind = u.cells.find((c) => (c.hatch === 'input_bus' || c.hatch === 'output_bus') && c.block.mteId === bus.block.mteId)?.hatch;
        if (!(kind === 'input_bus' ? u.io.itemIn : u.io.itemOut)) continue;
        const joined = mode === 'direct' ? at(p).some((b) => b.role === 'pipe' && (((b.connections ?? 0) >> side) & 1) === 1)
          : mode === 'routed' ? at(p).some((b) => b.role === 'chip_pipe')
            : mode === 'ae2' ? at(p).some((b) => b.role === 'interface')
              : faces(p, side, (kind) => kind === 'item');
        bump(ports, `${mode} bus ${joined ? 'joined' : 'LOOSE'}`);
        if (!joined) bad.push(`${mode}: ${u.name}'s bus port at ${p.join(',')} is not joined`);
      }
    }
    return bad;
  }

  it.each(realCorpusLines())('lays out $name in every mode with every hatch where GregTech takes it and every port joined',
    { timeout: 120_000 }, async ({ settings, infeasible }) => {
      const plan = await planLine(pack, settings, emptyContext());
      expect(plan.status).toBe(infeasible === true ? 'infeasible' : 'ok');
      if (infeasible === true) return;
      // the hatch rules on every multiblock, the furnaces and ovens the other modes run by hand included
      const { units } = unitsFromPlan(pack, plan, { primitive: false });
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
        bad.push(...checkUnit(u, { inputs: fluidInputs, outputs: fluidOutputs }), ...checkGt(u));
      }
      expect(bad).toEqual([]);
      const loose: string[] = [];
      for (const mode of MODES) {
        const project = { ...makeProject({ scanId: null, baseId: null }), settings: { ...settings, logistics: mode } };
        const layout = await layoutLine(pack, plan, emptyScan(), project);
        // the units as layoutLine makes them in this mode: in every mode but machine to machine (architecture §11
        // entry 48) a Bricked Blast Furnace or a Coke Oven is run by hand, which places the units of its row elsewhere
        const modeUnits = unitsFromPlan(pack, plan, { primitive: mode !== 'direct' }).units;
        const hatches = modeUnits.reduce((n, u) => n + u.cells.filter((c) => c.role === 'hatch').length, 0);
        expect(layout.status, mode).toBe('no-world');
        expect(overlaps(layout.blocks.filter((b) => b.role !== 'ghost')).length, `${mode}: cells holding two blocks`).toBe(0);
        expect(layout.blocks.filter((b) => b.role === 'hatch').length, `${mode}: hatches in the layout`).toBe(hatches);
        loose.push(...checkPorts(plan, modeUnits, layout, mode));
        for (const w of layout.warnings) bump(codes, `${mode} ${w.code}`);
      }
      expect(loose).toEqual([]);
    });
});

