import type { Layout } from '../../src/shared/types/layout.ts';
import type { Project } from '../../src/shared/types/project.ts';
import { defaultSettings } from '../../src/shared/project/apply-op.ts';

export const CONVEYOR = 'gregtech:gt.metaitem.01@32630';
const GT = (mteId: number) => ({ id: 'gregtech:gt.blockmachines', meta: 0, mteId });

// One block per membership rule; texts follow Plan 5 Task 10, labels Plan 5 Tasks 5-8. Coordinates are synthetic.
export function projectorLayout(): Layout {
  return {
    status: 'ok', dim: 0, origin: [99, 64, 200], size: [7, 2, 4], rotation: 0, mode: 'direct',
    blocks: [
      { pos: [100, 64, 201], block: GT(1180), role: 'cable', label: '1x Tin Cable', hookup: 0 },
      { pos: [101, 64, 201], block: GT(1180), role: 'cable', label: '1x Tin Cable' },
      { pos: [101, 64, 202], block: GT(21), role: 'transformer', label: 'Low Voltage Transformer', facing: 4 },
      { pos: [102, 64, 201], block: GT(201), role: 'machine', label: 'Basic Macerator', facing: 3, stepId: 's1',
        covers: [{ face: 'south', item: CONVEYOR, settings: { mode: 'export', rate: 1, unit: 'stacks/s' } }] },
      { pos: [103, 64, 201], block: GT(201), role: 'machine', label: 'Basic Macerator', facing: 3, stepId: 's1' },
      { pos: [102, 64, 202], block: GT(5110), role: 'pipe', label: 'Tin Item Pipe' },
      { pos: [104, 64, 202], block: { id: 'minecraft:chest', meta: 0 }, role: 'chest', label: 'Chest (input)' },
      { pos: [102, 65, 201], block: GT(5131), role: 'pipe', label: 'Bronze Fluid Pipe (Water)' },
      { pos: [105, 64, 202], block: { id: 'fmp:pr_rinterface', meta: 0 }, role: 'chip_pipe', label: 'Routed Interface Pipe (input chest)' },
      { pos: [99, 64, 201], block: { id: 'minecraft:stone', meta: 0 }, role: 'ghost', label: 'existing Stone' },
      { pos: [103, 65, 203], block: { id: 'gregtech:gt.blockcasings', meta: 11 }, role: 'casing', label: 'Heat Proof Machine Casing', stepId: 's2' },
    ],
    hookups: [{ kind: 'power', from: { pos: [99, 64, 201], dim: 0, kind: 'power', voltageTier: 1, networkId: 'p1' }, path: [[100, 64, 201]], parts: [] }],
    pins: [], bom: [], warnings: [],
    buildSteps: [
      { id: 'layout:site', order: 1, kind: 'place', text: 'Clear a 7×4 spot (2 high) and keep a 1-block path around it' },
      { id: 'layout:place:s1', order: 2, kind: 'place', text: 'Place 2× Basic Macerator facing the middle row' },
      { id: 'layout:place:s2', order: 3, kind: 'place', text: 'Build 1× Electric Blast Furnace (3×4×3) with the controller facing the middle row; hatches: LV Input Bus' },
      { id: 'layout:power:stage:1', order: 4, kind: 'power', text: 'Place 1× Low Voltage Transformer between the MV and LV cables, front (input) toward MV' },
      { id: 'layout:power:wire:1', order: 5, kind: 'power', text: 'Wire the LV machines with 1x Tin Cable (1 blocks)' },
      { id: 'layout:power:hookup', order: 6, kind: 'power', text: 'Run 1× 1x Tin Cable from the tap to the line: up to 1 A at LV, arriving at 32 V' },
      { id: 'layout:logistics:line', order: 7, kind: 'logistics', text: "Lay 1× Tin Item Pipe along the middle row so it touches every machine's front, with an input chest at the end" },
      { id: 'layout:logistics:fluid:fluid:water', order: 8, kind: 'logistics', text: 'Lay 1× Bronze Fluid Pipe for Water' },
      { id: 'layout:configure:s1', order: 9, kind: 'configure', text: 'Basic Macerator: Conveyor Module (LV) on the south face: Export, 1 stacks/s' },
      { id: 'layout:test', order: 10, kind: 'test', text: 'Switch on and check: every machine has power, none is fed above its tier, items reach the output' },
    ],
  };
}

export function projectorProject(): Project {
  return { id: 'Pr0jectAb1', name: 'Steel line', createdAt: '2026-10-18T09:00:00.000Z', createdBy: 'Ann', rev: 7, settings: defaultSettings(),
    world: { scanId: 'S1', baseId: '0:0:0' }, placement: null, notes: [],
    marks: { 'step:layout:place:s2': { by: 'Ann', at: '2026-10-18T10:00:00.000Z' }, 'build:x@0': { by: 'Ann', at: '2026-10-18T10:00:00.000Z' } } };
}
