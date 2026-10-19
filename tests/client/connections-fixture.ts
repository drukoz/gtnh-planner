// The two-machine line the Connections tests share (plan 11 Tasks 7–8; spec §3.8c): a Basic Macerator (step a) and an
// Advanced Assembler (step b) side by side, both facing south onto the middle row, raw inputs coming in through an input
// chest and the final output leaving through an output chest, laid out in each of the four logistics modes: EnderIO
// conduit faces on their channels; GT conveyor covers and a shared tin item pipe; Project Red interface pipes with their
// chips; ME interfaces with their patterns and a hookup to the base's ME network (no chests). Synthetic: nothing here
// comes from a game file. Client tests only, so nothing is imported from the server.

import { FACES } from '../../src/shared/types/assets.ts';
import type { ConduitExtract, ConduitFace, ConduitInsert, CoverSpec, DyeColor, Layout, LayoutBlock, TailChest } from '../../src/shared/types/layout.ts';
import type { LogisticsMode, Plan, PlanStep } from '../../src/shared/types/plan.ts';
import { BASIC, ITEM, basic } from './enderio-fixture.ts';

/** The GT Conveyor Module (LV) and Filtered Conveyor Cover (Export). */
export const CONV = 'gregtech:gt.metaitem.01@32630';
export const FILTER = 'gregtech:gt.metaitem.01@32270';
/** The ME glass cable of the AE2 hookup; `connPlan.names` leaves it out, so its key shows (plan 11, ruling R18). */
const ME_CABLE = 'appliedenergistics2:item.ItemMultiPart@16';

const IN = 't:in@0', DUST = 't:dust@0', INGOT = 't:ingot@0';
const NORTH = 2, SOUTH = 3, WEST = 4, EAST = 5;
const bit = (side: number): number => 1 << side;

function planStep(id: string, mteId: number, name: string, tier: number, euPerTick: number, input: string, output: string): PlanStep {
  return {
    id, recipeId: id, mapId: '', machine: { mteId, name, tier }, count: 1, owned: 0, runsPerSecond: 1, utilization: 1, euPerTick,
    durationTicks: 20, overclocks: 0, inputs: [{ key: input, amount: 1, chance: 1 }], outputs: [{ key: output, amount: 1, chance: 1 }],
    alternatives: [], handCraft: false, warnings: [],
  };
}

/** raw → a (Basic Macerator, LV, 2 EU/t) → b (Advanced Assembler, MV, 30 EU/t) → out, 1/s each, with the names of the keys the texts use. */
export const connPlan: Plan = {
  settingsHash: 'h1', exportId: 'E1', scanId: 'S1', tier: 2, reachable: [], unlocks: [],
  steps: [planStep('a', 2001, 'Basic Macerator', 1, 2, IN, DUST), planStep('b', 2002, 'Advanced Assembler', 2, 30, DUST, INGOT)],
  flows: [{ from: 'raw', to: 'a', key: IN, perSecond: 1 }, { from: 'a', to: 'b', key: DUST, perSecond: 1 }, { from: 'b', to: 'out', key: INGOT, perSecond: 1 }],
  rawInputs: [], byproducts: [], power: { peakEUt: 32, averageEUt: 32, voltageTier: 2, amps: 1 }, buildList: [], buildSteps: [], warnings: [], status: 'ok',
  names: {
    [IN]: 'Raw Input', [DUST]: 'Titanium Dust', [INGOT]: 'Titanium Ingot',
    [BASIC]: 'Basic Item Filter', [CONV]: 'Conveyor Module (LV)', [FILTER]: 'Filtered Conveyor Cover (Export)',
  },
};

const GT = (mteId: number) => ({ id: 'gregtech:gt.blockmachines', meta: 0, mteId });

/** Machine a at 0 64 0 and b at 1 64 0, facing south, each with its own copy of `covers` and `config`. */
function machines(covers?: () => CoverSpec[], config?: () => Record<string, boolean>): LayoutBlock[] {
  const machine = (pos: [number, number, number], mteId: number, stepId: string, label: string): LayoutBlock => ({
    pos, block: GT(mteId), role: 'machine', facing: SOUTH, stepId, label, item: `gregtech:gt.blockmachines@${mteId}`,
    ...(covers === undefined ? {} : { covers: covers() }), ...(config === undefined ? {} : { config: config() }),
  });
  return [machine([0, 64, 0], 2001, 'a', 'Basic Macerator'), machine([1, 64, 0], 2002, 'b', 'Advanced Assembler')];
}

/** The input chest at 2 64 0 (Raw Input) and the output chest at 2 64 2 (Titanium Ingot). */
function chests(): LayoutBlock[] {
  const chest = (pos: [number, number, number], tail: TailChest): LayoutBlock => ({
    pos, block: { id: 'minecraft:chest', meta: 0 }, role: 'chest', label: tail.side === 'input' ? 'Chest (input)' : 'Chest (output)',
    item: 'minecraft:chest@0', tail,
  });
  return [chest([2, 64, 0], { side: 'input', keys: [IN] }), chest([2, 64, 2], { side: 'output', keys: [INGOT] })];
}

const exportCover = (): CoverSpec[] => [{ face: 'south', item: CONV, settings: { mode: 'export', allowInput: true, rate: 1, unit: 'items/s' } }];

// ---- EnderIO: one Item Conduit per middle-row cell, Basic filters, 1 item/s, round robin and self feed off, Always active ----

const extract = (color: DyeColor, keys: string[]): ConduitExtract => ({ color, filter: basic(keys), rate: 1, roundRobin: false, selfFeed: false, redstone: 'ignore' });
const insert = (color: DyeColor, keys: string[], priority: number): ConduitInsert => ({ color, filter: basic(keys), rate: 1, priority });

function conduit(pos: [number, number, number], links: number, faces: ConduitFace[]): LayoutBlock {
  const open = faces.reduce((bits, f) => bits | bit(FACES.indexOf(f.face)), 0);
  return { pos, block: { id: 'conduit:item', meta: 0 }, role: 'pipe', label: 'Item Conduit', item: ITEM, connections: links | open,
    conduits: [{ kind: 'item', item: ITEM, connections: links, faces }] };
}

function enderioBlocks(): LayoutBlock[] {
  return [...machines(),
    conduit([0, 64, 1], bit(EAST), [{ face: 'north', mode: 'in_out', target: 'Basic Macerator', extract: extract('red', [DUST]), insert: insert('blue', [IN], 1) }]),
    conduit([1, 64, 1], bit(WEST) | bit(EAST),
      [{ face: 'north', mode: 'in_out', target: 'Advanced Assembler', extract: extract('yellow', [INGOT]), insert: insert('red', [DUST], 1) }]),
    conduit([2, 64, 1], bit(WEST), [
      { face: 'north', mode: 'extract', target: 'Chest (input)', extract: extract('blue', [IN]) },
      { face: 'south', mode: 'insert', target: 'Chest (output)', insert: insert('yellow', [INGOT], 0) }]),
    ...chests()];
}

// ---- Machine to machine: export covers and Input Filters on the machines, a tin item pipe, the tail's covers ----

function directBlocks(): LayoutBlock[] {
  const pipe = (pos: [number, number, number], connections: number, covers?: CoverSpec[]): LayoutBlock => ({
    pos, block: GT(5600), role: 'pipe', label: 'Tin Item Pipe', item: 'gregtech:gt.blockmachines@5600', connections, ...(covers === undefined ? {} : { covers }),
  });
  return [...machines(exportCover, () => ({ inputFilter: true, inputFromOutputSide: true })),
    pipe([0, 64, 1], bit(NORTH) | bit(EAST)), pipe([1, 64, 1], bit(NORTH) | bit(WEST) | bit(EAST)),
    pipe([2, 64, 1], bit(NORTH) | bit(SOUTH) | bit(WEST), [
      { face: 'north', item: CONV, settings: { mode: 'import', allowInput: false, rate: 1, unit: 'items/s' } },
      { face: 'south', item: FILTER, settings: { mode: 'whitelist' }, filter: [INGOT] }]),
    ...chests()];
}

// ---- Project Red: an interface pipe with its chips in front of each machine, the request pipe at the tail ----

function routedBlocks(): LayoutBlock[] {
  const iface = (pos: [number, number, number], connections: number, machine: string, takes: string): LayoutBlock => ({
    pos, block: { id: 'fmp:pr_rinterface', meta: 0 }, role: 'chip_pipe', label: `Routed Interface Pipe (${machine})`,
    item: 'ProjRed|Transportation:projectred.transportation.pipe@2', connections,
    config: { chips: `Item Responder Chip (whitelist: ${takes}) + Item Extractor Chip` },
  });
  return [...machines(),
    iface([0, 64, 1], bit(NORTH) | bit(EAST), 'Basic Macerator', 'Raw Input'),
    iface([1, 64, 1], bit(NORTH) | bit(WEST) | bit(EAST), 'Advanced Assembler', 'Titanium Dust'),
    { pos: [2, 64, 1], block: { id: 'fmp:pr_rrequest', meta: 0 }, role: 'pipe', label: 'Routed Request Pipe',
      item: 'ProjRed|Transportation:projectred.transportation.pipe@4', connections: bit(NORTH) | bit(WEST) },
    ...chests()];
}

// ---- AE2: export covers on the machines, an ME interface with its pattern in front of each, cable to the base's network ----

function ae2Blocks(): LayoutBlock[] {
  const iface = (pos: [number, number, number], machine: string, pattern: string): LayoutBlock => ({
    pos, block: { id: 'appliedenergistics2:tile.BlockInterface', meta: 0 }, role: 'interface', label: `ME Interface (${machine})`,
    item: 'appliedenergistics2:tile.BlockInterface@0', config: { patterns: 1, pattern, blockingMode: false },
  });
  const cable = (pos: [number, number, number], connections: number): LayoutBlock => ({
    pos, block: { id: 'ae2cable:glass', meta: 0 }, role: 'pipe', label: 'ME Glass Cable - Fluix', item: ME_CABLE, connections,
  });
  return [...machines(exportCover),
    iface([0, 64, 1], 'Basic Macerator', '1× Raw Input → 1× Titanium Dust'),
    iface([1, 64, 1], 'Advanced Assembler', '1× Titanium Dust → 1× Titanium Ingot'),
    cable([2, 64, 1], bit(WEST) | bit(EAST)),
    { ...cable([3, 64, 1], bit(WEST)), hookup: 0 }];
}

const BLOCKS: Readonly<Record<LogisticsMode, () => LayoutBlock[]>> = { enderio: enderioBlocks, direct: directBlocks, routed: routedBlocks, ae2: ae2Blocks };

/** The line laid out in `mode` (fresh objects on every call). */
export function connLayout(mode: LogisticsMode): Layout {
  const hookups: Layout['hookups'] = mode !== 'ae2' ? [] : [{
    kind: 'logistics', from: { pos: [3, 64, 1], dim: 0, kind: 'ae2', networkId: 'ae2:0:0' }, path: [[3, 64, 1]],
    parts: [{ key: ME_CABLE, amount: 1, why: 'logistics hookup', group: 'logistics' }], found: true,
  }];
  return { dim: 0, origin: [0, 64, 0], size: [3, 1, 3], rotation: 0, mode, status: 'ok', blocks: BLOCKS[mode](), hookups,
    pins: [], buildSteps: [], bom: [], warnings: [] };
}
