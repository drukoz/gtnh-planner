// Export-ruled multiblocks in every logistics mode (exporter 0.6.0, architecture §11.49, add-on 20): a multiblock whose
// hatch rules come from the export, beside a fitting table row (the EBF) or alone (the front box, which no row knows),
// is laid out and connected in machine to machine, routed, AE2 and EnderIO mode like any other. hatch-export.test.ts
// checks the hatches of one unit; these check, mode by mode, what the line does at their ports.

import { describe, it, expect } from 'vitest';
import { hatchRuleFor, hatchRulesOf } from '../../../src/server/layout/hatch-rules.ts';
import { emptyScan, layoutLine } from '../../../src/server/layout/layout.ts';
import { machineByMteId } from '../../../src/server/pack/lookup.ts';
import { simpleClassName } from '../../../src/server/world/facts.ts';
import { OPPOSITE, posKey, step } from '../../../src/shared/layout/geometry.ts';
import { FACES } from '../../../src/shared/types/assets.ts';
import type { BlockRole } from '../../../src/shared/types/layout.ts';
import type { PlanFlow } from '../../../src/shared/types/plan.ts';
import { FRONT_BOX_ELEMENTS, FRONT_BOX_ID, hatchExportPack, rowElements, withElements } from '../../helpers/hatch-export-fixtures.ts';
import { IDS, makePlan, makeProject, type StepSpec } from '../../helpers/layout-fixtures.ts';

const MODES = ['direct', 'routed', 'ae2', 'enderio'] as const;

const OX = 'fluid:oxygen';
const MI = 'fluid:molten.iron';

const macerator: StepSpec = { id: 'm', mteId: IDS.MACERATOR, count: 1, outputs: [['t:dust@0', 1]] };
const ebfStep: StepSpec = { id: 'e', mteId: IDS.EBF, count: 1, tier: 2, euPerTick: 120, inputs: [['t:dust@0', 1]], outputs: [['t:ingot@0', 1], [MI, 144]] };
const frontBoxStep: StepSpec = { id: 'f', mteId: FRONT_BOX_ID, count: 1, tier: 1, euPerTick: 30, inputs: [['t:dust@0', 1], [OX, 1000]],
  outputs: [['t:ingot@0', 1], [MI, 144]] };
const frontBoxFlows: PlanFlow[] = [
  { from: 'raw', to: 'm', key: 't:in@0', perSecond: 1 }, { from: 'm', to: 'f', key: 't:dust@0', perSecond: 1 },
  { from: 'raw', to: 'f', key: OX, perSecond: 1 }, { from: 'f', to: 'out', key: 't:ingot@0', perSecond: 1 },
  { from: 'f', to: 'out', key: MI, perSecond: 1 },
];

/** What the hand table's EBF row (GT 5.09.54.183) takes on each of its characters: `b` the six kinds, `f` an output hatch, `m` the muffler, the coils `C` nothing. */
const EBF_ROW = {
  b: ['input_bus', 'output_bus', 'input_hatch', 'output_hatch', 'energy', 'maintenance'], f: ['output_hatch'], m: ['muffler'], C: [],
} as const;

// What stands on the cell a hatch faces, by the hatch's class. A bus gets the mode's item part (a GT item pipe, a Project
// Red pipe, an ME interface, an EnderIO conduit) or a chest, a fluid hatch a GT fluid pipe or an ender fluid conduit, an
// energy hatch a cable. `into`: the hatch takes what the part carries (else it gives it).
interface PortSpec { carries: 'item' | 'fluid' | 'power'; into: boolean; roles: readonly BlockRole[] }
const BUS_ROLES: readonly BlockRole[] = ['pipe', 'chip_pipe', 'interface', 'chest'];
const PORT_OF_CLASS: Readonly<Record<string, PortSpec>> = {
  MTEHatchInputBus: { carries: 'item', into: true, roles: BUS_ROLES }, MTEHatchOutputBus: { carries: 'item', into: false, roles: BUS_ROLES },
  MTEHatchInput: { carries: 'fluid', into: true, roles: ['pipe'] }, MTEHatchOutput: { carries: 'fluid', into: false, roles: ['pipe'] },
  MTEHatchEnergy: { carries: 'power', into: true, roles: ['cable'] },
};
/** The part each mode puts at a bus (spec §3.6): a GT pipe along the spine, a routed interface pipe, an ME interface, an EnderIO conduit bundle (role `pipe`). */
const BUS_PART: Readonly<Record<(typeof MODES)[number], BlockRole>> = { direct: 'pipe', routed: 'chip_pipe', ae2: 'interface', enderio: 'pipe' };

describe('export-ruled multiblocks in every logistics mode', () => {
  it.each(MODES)('lays the EBF out the same from export rules as from the table when they agree (%s)', async (mode) => {
    const table = hatchExportPack();
    const exported = hatchExportPack();
    const ebf = machineByMteId(exported, IDS.EBF)!;
    ebf.structure = withElements(ebf.structure!, rowElements(ebf, EBF_ROW));
    // two sources that agree: the export narrows the row by nothing, and the other pack has the row alone
    expect(hatchRulesOf(machineByMteId(table, IDS.EBF)!)!.source).toBe('table');
    const both = hatchRulesOf(ebf)!;
    expect(both.source).toBe('both');
    expect(both.rule.elements).toEqual(hatchRuleFor(ebf)!.elements);
    const plan = makePlan([macerator, ebfStep]);
    const project = makeProject({ logistics: mode });
    const fromTable = await layoutLine(table, plan, emptyScan(), project);
    const fromExport = await layoutLine(exported, plan, emptyScan(), project);
    // the layout holds the EBF's hatches, so equal is more than both empty
    expect(fromTable.blocks.filter((b) => b.role === 'hatch' && b.stepId === 'e').map((b) => b.hatch).sort())
      .toEqual(['energy', 'input_bus', 'maintenance', 'muffler', 'output_bus', 'output_hatch']);
    expect(fromExport).toEqual(fromTable);
  });

  it.each(MODES)('connects an export-ruled multiblock in %s mode', async (mode) => {
    const pack = hatchExportPack();
    const box = machineByMteId(pack, FRONT_BOX_ID)!;
    box.structure = withElements(box.structure!, FRONT_BOX_ELEMENTS);
    const layout = await layoutLine(pack, makePlan([macerator, frontBoxStep], { flows: frontBoxFlows }), emptyScan(), makeProject({ logistics: mode }));
    const codes = layout.warnings.map((w) => w.code);
    for (const code of ['hatch_rules_unknown', 'hatch_cells_short', 'route_failed']) expect(codes, code).not.toContain(code);
    // no table row knows the box, so the export alone rules it
    expect(codes).toContain('hatch_rules_export_only');
    // every bus, fluid hatch and energy hatch of the box has the mode's part on the cell it faces, joined to the hatch
    const checked: string[] = [];
    for (const b of layout.blocks.filter((x) => x.stepId === 'f' && x.role === 'hatch')) {
      const cls = simpleClassName(machineByMteId(pack, b.block.mteId!)!.cls)!;
      const spec = PORT_OF_CLASS[cls];
      if (spec === undefined) continue;                                                   // the maintenance hatch takes nothing
      const where = `${b.label} at ${posKey(b.pos)} facing ${b.facing}`;
      expect(b.facing, where).toBeDefined();
      const faced = layout.blocks.filter((x) => x.role !== 'ghost' && posKey(x.pos) === posKey(step(b.pos, b.facing!)));
      expect(faced, `${where}: the block it faces`).toHaveLength(1);
      const port = faced[0]!;
      expect(spec.roles, `${where} faces a ${port.role} (${port.label})`).toContain(port.role);
      // beyond the role: the part is joined to the hatch (its connection bit toward it; an ME interface or a chest is a full block)
      const toHatch = OPPOSITE[b.facing!]!;
      if (port.role !== 'interface' && port.role !== 'chest') expect(((port.connections ?? 0) >> toHatch) & 1, `${where}: ${port.label} joined to it`).toBe(1);
      // a bus meets the mode's own item part: a plain junction pipe or glass cable there would feed it nothing
      if (spec.carries === 'item') expect(port.role, `${where}: the ${mode} part at a bus`).toBe(BUS_PART[mode]);
      // an EnderIO bundle's face toward the hatch is on: it inserts into an input and extracts from an output (or does both)
      if (mode === 'enderio' && spec.carries !== 'power') {
        const conduit = port.conduits?.find((c) => (c.kind === 'item') === (spec.carries === 'item'));
        const face = conduit?.faces.find((f) => f.face === FACES[toHatch]);
        expect(['in_out', spec.into ? 'insert' : 'extract'], `${where}: the ${spec.carries} conduit's face toward it`).toContain(face?.mode);
      }
      checked.push(cls);
    }
    expect(checked.sort()).toEqual(['MTEHatchEnergy', 'MTEHatchInput', 'MTEHatchInputBus', 'MTEHatchOutput', 'MTEHatchOutputBus']);
  });
});
