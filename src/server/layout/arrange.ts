// Units and their placement (Plan 5 Task 5; spec §3.6, architecture §11.13–§11.14): one unit per new machine of every
// placed step, in flow order; multiblocks take their exported structure (Plan 1 canonical frame: front on the north,
// z = 0 side) with hatch cells chosen on its casings and sized to the step (hatch positions are not in the export,
// gt-mechanics §5); the programmed circuit goes on the machine or its input bus. Units are then placed in two rows
// facing a one-block spine, row N turned 180° so every front faces the spine, with the ports the routing, logistics
// and hookup stages connect to. Covers and settings from those stages are attached to their host blocks here too.
// Every order and tie-break is fixed, so the same plan gives the same placement.

import { isFluidKey, itemKey, type ItemKey, type StuffKey } from '../../shared/keys.ts';
import { OPPOSITE, posKey, step, type Vec3 } from '../../shared/layout/geometry.ts';
import type { BlockRole, CoverSpec } from '../../shared/types/layout.ts';
import type { BlockRef, Machine, Pack, Product } from '../../shared/types/pack.ts';
import type { BomLine, Plan, PlanStep, PlanWarning } from '../../shared/types/plan.ts';
import { UNKNOWN_BLOCK } from '../../shared/types/world.ts';
import { busSlots, hatchLitres, machineRef, pickHatch, type HatchClass } from './parts.ts';

// ---- Types ----

export type BlockConfig = Record<string, string | number | boolean>;

/** A block in the line's local grid; mirrors `LayoutBlock` (architecture §11.14). */
export interface LocalBlock {
  pos: Vec3; block: BlockRef; role: BlockRole; facing?: number; stepId?: string; label: string; item?: StuffKey; connections?: number;
  covers?: CoverSpec[]; config?: BlockConfig;
}
/** A cover for the block at `pos` (Tasks 6–8). */
export interface HostCover { pos: Vec3; cover: CoverSpec }
/** Settings for the block at `pos` (Tasks 7–8). */
export interface HostConfig { pos: Vec3; config: BlockConfig }

export type HatchKind = 'energy' | 'input_bus' | 'output_bus' | 'input_hatch' | 'output_hatch' | 'maintenance';

/** What a step moves in and out; fluid keys sorted. */
export interface StepIo { itemIn: boolean; itemOut: boolean; fluidIn: StuffKey[]; fluidOut: StuffKey[] }

export interface UnitCell {
  pos: Vec3; block: BlockRef; role: 'machine' | 'casing' | 'hatch'; label: string; item?: StuffKey; hatch?: HatchKind;
  config?: BlockConfig;
  /** The casing a hatch cell replaced. */
  replaces?: ItemKey;
}

export interface Unit {
  stepId: string; index: number; mteId: number; name: string; tier: number; euPerTick: number; electric: boolean; multiblock: boolean;
  /** Canonical: front on the north (z = 0) side. */
  size: Vec3;
  cells: UnitCell[]; air: Vec3[]; io: StepIo;
}

/**
 * Local cells the line connects to. A multiblock's `fluidIn[i]` sits above its i-th input hatch, which takes
 * `io.fluidIn[i]` (likewise `fluidOut`); a singleblock has one cell above it for all its fluids.
 */
export interface UnitPorts {
  power: Vec3 | null; items: Vec3[]; fluidIn: Vec3[]; fluidOut: Vec3[];
  /** Output faces that get a conveyor cover. */
  itemFaces: Array<{ pos: Vec3; side: number }>;
  /** Output faces that get a pump cover. */
  fluidFaces: Array<{ pos: Vec3; side: number }>;
}

export interface PlacedUnit extends Unit {
  row: 'N' | 'S';
  /** Local min corner. */
  at: Vec3;
  /** 3 in row N, 2 in row S: toward the spine. */
  facing: number;
  ports: UnitPorts;
}

export interface Placement {
  units: PlacedUnit[];
  /** W, H, L */
  size: Vec3;
  spineZ: number; firstX: number; tailX: number;
  /** Every unit cell, sorted by x, y, z. */
  blocks: LocalBlock[];
  /** Air cells the multiblocks need kept empty, sorted by x, y, z. */
  reserved: Vec3[];
}

// ---- Small helpers ----

const UP = 1, NORTH = 2, SOUTH = 3;

function compareText(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0;
}

function comparePos(a: Vec3, b: Vec3): number {
  return a[0] - b[0] || a[1] - b[1] || a[2] - b[2];
}

function samePos(a: Vec3, b: Vec3): boolean {
  return a[0] === b[0] && a[1] === b[1] && a[2] === b[2];
}

function blockKey(b: BlockRef): ItemKey {
  return itemKey(b.id, b.meta);
}

// ---- Steps ----

/**
 * 0 for a step fed only by `raw` (or with no flows), else 1 + the deepest step feeding it. Flows that close a loop are
 * ignored: a depth-first walk along the flows, from the raw-fed steps first (then the others, in `plan.steps` order),
 * drops every flow into a step still in progress, so a loop is cut where it turns back toward the raw inputs whatever
 * order the steps are listed in. Keys in `plan.steps` order.
 */
export function stepDepths(plan: Plan): Map<string, number> {
  const ids = new Set(plan.steps.map((s) => s.id));
  const next = new Map<string, string[]>();
  const rawFed = new Set<string>();
  for (const f of plan.flows) {
    if (!ids.has(f.to)) continue;                                                     // out, sink
    if (f.from === 'raw') rawFed.add(f.to);
    if (!ids.has(f.from)) continue;
    const list = next.get(f.from);
    if (list === undefined) next.set(f.from, [f.to]);
    else list.push(f.to);
  }
  const feeders = new Map<string, string[]>();                                          // the flows that stay, by target
  const state = new Map<string, 'in progress' | 'done'>();
  const walk = (id: string): void => {
    state.set(id, 'in progress');
    for (const to of next.get(id) ?? []) {
      const seen = state.get(to);
      if (seen === 'in progress') continue;                                             // closes a loop
      const list = feeders.get(to);
      if (list === undefined) feeders.set(to, [id]);
      else list.push(id);
      if (seen === undefined) walk(to);
    }
    state.set(id, 'done');
  };
  for (const s of plan.steps) if (rawFed.has(s.id) && !state.has(s.id)) walk(s.id);
  for (const s of plan.steps) if (!state.has(s.id)) walk(s.id);
  const depths = new Map<string, number>();
  const depthOf = (id: string): number => {
    let depth = depths.get(id);
    if (depth === undefined) {
      depth = (feeders.get(id) ?? []).reduce((d, from) => Math.max(d, 1 + depthOf(from)), 0);
      depths.set(id, depth);
    }
    return depth;
  };
  return new Map(plan.steps.map((s) => [s.id, depthOf(s.id)]));
}

function distinctFluids(products: readonly Product[]): StuffKey[] {
  return [...new Set(products.filter((p) => isFluidKey(p.key)).map((p) => p.key))].sort(compareText);
}

function distinctItems(products: readonly Product[]): number {
  return new Set(products.filter((p) => !isFluidKey(p.key)).map((p) => p.key)).size;
}

/** Per-run amount of `key` (a key listed twice is summed). */
function perRun(products: readonly Product[], key: StuffKey): number {
  return products.reduce((sum, p) => (p.key === key ? sum + p.amount : sum), 0);
}

export function stepIo(s: PlanStep): StepIo {
  return {
    itemIn: s.inputs.some((p) => !isFluidKey(p.key)), itemOut: s.outputs.some((p) => !isFluidKey(p.key)),
    fluidIn: distinctFluids(s.inputs), fluidOut: distinctFluids(s.outputs),
  };
}

// ---- Units ----

interface Shape { size: Vec3; cells: UnitCell[]; air: Vec3[] }

function singleblockShape(m: Machine, circuit: number | undefined): Shape {
  const cell: UnitCell = { pos: [0, 0, 0], block: machineRef(m), role: 'machine', label: m.name, item: m.itemKey };
  if (circuit !== undefined) cell.config = { circuit };
  return { size: [1, 1, 1], cells: [cell], air: [] };
}

function casingCell(pack: Pack, pos: Vec3, block: BlockRef): UnitCell {
  const key = blockKey(block);
  return { pos: [...pos], block: { ...block }, role: 'casing', label: pack.items.get(key)?.name ?? block.id, item: key };
}

/** The exported structure's cells, or null when it is missing, truncated or has no block on its controller cell. */
function structureCells(pack: Pack, m: Machine): Shape | null {
  const st = m.structure;
  if (st === undefined || st.truncated === true || !st.blocks.some((b) => samePos(b.pos, st.controller))) return null;
  const cells = st.blocks.map((b): UnitCell => {
    if (samePos(b.pos, st.controller)) return { pos: [...b.pos], block: machineRef(m), role: 'machine', label: m.name, item: m.itemKey };
    if (b.block.mteId === undefined) return casingCell(pack, b.pos, b.block);
    const hatch = pack.machines.get(b.block.mteId);
    return {
      pos: [...b.pos], block: { ...b.block }, role: 'hatch', label: hatch?.name ?? `${b.block.id} #${b.block.mteId}`,
      ...(hatch === undefined ? {} : { item: hatch.itemKey }),
    };
  });
  return { size: [...st.size], cells, air: st.air.map((p): Vec3 => [...p]) };
}

/** A 3×3×3 box of unknown casings with the controller at the front bottom centre. */
function unknownBoxCells(pack: Pack, m: Machine): Shape {
  const cells: UnitCell[] = [];
  for (let y = 0; y < 3; y++) {
    for (let z = 0; z < 3; z++) {
      for (let x = 0; x < 3; x++) {
        cells.push(x === 1 && y === 0 && z === 0
          ? { pos: [x, y, z], block: machineRef(m), role: 'machine', label: m.name, item: m.itemKey }
          : casingCell(pack, [x, y, z], UNKNOWN_BLOCK));
      }
    }
  }
  return { size: [3, 3, 3], cells, air: [] };
}

/** Indices of the casing cells of layer `y` holding the layer's most common `id@meta` (ties → smallest string). */
function commonCasings(cells: readonly UnitCell[], y: number): number[] {
  const counts = new Map<ItemKey, number>();
  for (const c of cells) if (c.role === 'casing' && c.pos[1] === y) counts.set(blockKey(c.block), (counts.get(blockKey(c.block)) ?? 0) + 1);
  let best: ItemKey | null = null, bestCount = 0;
  for (const [key, n] of counts) {
    if (n > bestCount || (n === bestCount && best !== null && key < best)) {
      best = key;
      bestCount = n;
    }
  }
  const out: number[] = [];
  cells.forEach((c, i) => {
    if (c.role === 'casing' && c.pos[1] === y && blockKey(c.block) === best) out.push(i);
  });
  return out;
}

const HATCH_TEXT: Readonly<Record<HatchKind, string>> = {
  energy: 'energy', input_bus: 'input bus', output_bus: 'output bus', input_hatch: 'input hatch', output_hatch: 'output hatch', maintenance: 'maintenance',
};

/** A pick that holds less than `need`. */
function holdsLess(hatch: Machine, need: { slots?: number; litres?: number } | undefined): boolean {
  if (need?.slots !== undefined) return hatch.tier === undefined || busSlots(hatch.tier) < need.slots;
  if (need?.litres !== undefined) return hatch.tier === undefined || hatchLitres(hatch.tier) < need.litres;
  return false;
}

/**
 * A multiblock: its structure (or the unknown box) with hatch cells on its casings. Buses on the front of the bottom
 * layer nearest the controller, energy and maintenance on its back nearest the middle, fluid hatches on the top layer.
 */
function multiblockShape(pack: Pack, m: Machine, s: PlanStep, io: StepIo, electric: boolean, circuit: number | undefined,
  warnings: PlanWarning[]): Shape {
  let shape = structureCells(pack, m);
  if (shape === null) {
    warnings.push({ code: 'structure_unknown', stepId: s.id, text: `${m.name}: no exported structure, drawn as a 3×3×3 box — check its real size in game` });
    shape = unknownBoxCells(pack, m);
  }
  const { size, cells } = shape;
  const controller = cells.find((c) => c.role === 'machine')!.pos;
  const middle = Math.floor((size[0] - 1) / 2);

  // Candidates are all chosen before any cell turns into a hatch, so a one-layer structure shares one list.
  // Bottom layer: each x column's front (smallest z) and back (largest z) among the layer's block cells.
  const bottom = commonCasings(cells, 0);
  const minZ = new Map<number, number>(), maxZ = new Map<number, number>();
  for (const c of cells) {
    if (c.pos[1] !== 0) continue;
    const [x, , z] = c.pos;
    minZ.set(x, Math.min(minZ.get(x) ?? z, z));
    maxZ.set(x, Math.max(maxZ.get(x) ?? z, z));
  }
  const byDistance = (centre: number) => (a: number, b: number) =>
    Math.abs(cells[a]!.pos[0] - centre) - Math.abs(cells[b]!.pos[0] - centre) || cells[a]!.pos[0] - cells[b]!.pos[0];
  const front = bottom.filter((i) => cells[i]!.pos[2] === minZ.get(cells[i]!.pos[0])).sort(byDistance(controller[0]));
  const back = bottom.filter((i) => cells[i]!.pos[2] === maxZ.get(cells[i]!.pos[0])).sort(byDistance(middle));
  const top = commonCasings(cells, size[1] - 1).sort((a, b) => cells[a]!.pos[2] - cells[b]!.pos[2] || cells[a]!.pos[0] - cells[b]!.pos[0]);

  const taken = new Set<number>();
  const short: HatchKind[] = [];
  const place = (kind: HatchKind, cls: HatchClass, tier: number | null, need: { slots?: number; litres?: number } | undefined,
    pools: ReadonlyArray<readonly number[]>, config?: BlockConfig): void => {
    const hatch = pickHatch(pack, cls, tier, need);
    let free: number | undefined;
    for (const pool of pools) {
      free = pool.find((i) => !taken.has(i));
      if (free !== undefined) break;
    }
    if (hatch === null || free === undefined) {
      short.push(kind);
      return;
    }
    taken.add(free);
    const casing = cells[free]!;
    cells[free] = {
      pos: casing.pos, block: machineRef(hatch), role: 'hatch', label: hatch.name, item: hatch.itemKey, hatch: kind,
      ...(config === undefined ? {} : { config }), replaces: blockKey(casing.block),
    };
    if (holdsLess(hatch, need)) {
      warnings.push({ code: 'hatch_small', stepId: s.id, text: `${m.name}: the biggest ${hatch.name} holds less than one run needs — split the inputs by hand` });
    }
  };

  // the circuit goes in the input bus's circuit slot, so a step with a circuit always gets one
  if (io.itemIn || circuit !== undefined) {
    place('input_bus', 'MTEHatchInputBus', null, { slots: distinctItems(s.inputs) }, [front], circuit === undefined ? undefined : { circuit });
  }
  if (io.itemOut) place('output_bus', 'MTEHatchOutputBus', null, { slots: distinctItems(s.outputs) }, [front]);
  if (electric) place('energy', 'MTEHatchEnergy', s.machine.tier, undefined, [back]);
  const anyBottom = [...bottom].sort((a, b) => cells[b]!.pos[2] - cells[a]!.pos[2] || byDistance(middle)(a, b));
  place('maintenance', 'MTEHatchMaintenance', null, undefined, [back, anyBottom]);
  for (const key of io.fluidIn) place('input_hatch', 'MTEHatchInput', null, { litres: perRun(s.inputs, key) }, [top]);
  for (const key of io.fluidOut) place('output_hatch', 'MTEHatchOutput', null, { litres: perRun(s.outputs, key) }, [top]);

  if (short.length > 0) {
    warnings.push({ code: 'hatch_cells_short', stepId: s.id,
      text: `${m.name}: put the remaining hatches (${short.map((k) => HATCH_TEXT[k]).join(', ')}) on any casing` });
  }
  return shape;
}

function copyCell(c: UnitCell): UnitCell {
  return { ...c, pos: [...c.pos], block: { ...c.block }, ...(c.config === undefined ? {} : { config: { ...c.config } }) };
}

/**
 * One unit per machine still to build (`count − owned`) of every step that is not hand-crafted and runs on a real
 * machine, sorted by (depth, step id, index). Machines missing from the pack are left out with a warning.
 */
export function unitsFromPlan(pack: Pack, plan: Plan): { units: Unit[]; warnings: PlanWarning[] } {
  const depths = stepDepths(plan);
  const steps = [...plan.steps].sort((a, b) => depths.get(a.id)! - depths.get(b.id)! || compareText(a.id, b.id));
  const units: Unit[] = [];
  const warnings: PlanWarning[] = [];
  for (const s of steps) {
    const count = s.count - s.owned;
    if (s.handCraft || s.machine.mteId < 0 || count <= 0) continue;
    const m = pack.machines.get(s.machine.mteId);
    if (m === undefined) {
      warnings.push({ code: 'unknown_machine', stepId: s.id, text: `${s.machine.name} (#${s.machine.mteId}) is not in this recipe export` });
      continue;
    }
    const electric = m.kind !== 'steam';
    if (!electric) warnings.push({ code: 'steam_machine', stepId: s.id, text: `${m.name} runs on steam: connect a steam supply by hand` });
    const multiblock = m.kind === 'multiblock';
    const io = stepIo(s);
    // the step's own circuit wins over the recipe's (ruling R5)
    const circuit = s.circuit ?? pack.recipeById.get(s.recipeId)?.meta.circuit;
    const shape = multiblock ? multiblockShape(pack, m, s, io, electric, circuit, warnings) : singleblockShape(m, circuit);
    for (let index = 0; index < count; index++) {
      units.push({
        stepId: s.id, index, mteId: m.mteId, name: m.name, tier: s.machine.tier, euPerTick: s.euPerTick, electric, multiblock,
        size: [...shape.size], cells: shape.cells.map(copyCell), air: shape.air.map((p): Vec3 => [...p]),
        io: { ...io, fluidIn: [...io.fluidIn], fluidOut: [...io.fluidOut] },
      });
    }
  }
  return { units, warnings };
}

/** Per casing key: how many hatch cells replaced it, over all units; sorted by key. */
export function replacedCasings(units: readonly Unit[]): BomLine[] {
  const counts = new Map<ItemKey, number>();
  for (const u of units) for (const c of u.cells) if (c.role === 'hatch' && c.replaces !== undefined) counts.set(c.replaces, (counts.get(c.replaces) ?? 0) + 1);
  return [...counts].sort((a, b) => compareText(a[0], b[0]))
    .map(([key, amount]): BomLine => ({ key, amount, why: 'replaced by hatches', group: 'machines' }));
}

// ---- Placement ----

type Row = PlacedUnit['row'];

/** The side of a unit in `row` that faces the spine. */
function towardSpine(row: Row): number {
  return row === 'N' ? SOUTH : NORTH;
}

/**
 * Where canonical cell `c` of `u` lands: row S keeps the orientation (min corner `[x, 0, spineZ + 1]`, cell at + c);
 * row N turns 180° (min corner `[x, 0, spineZ − D]`, cell at + (W − 1 − cx, cy, D − 1 − cz)), so both fronts touch the spine.
 */
function localCell(u: Unit, row: Row, x: number, spineZ: number, c: Vec3): Vec3 {
  const [w, , d] = u.size;
  return row === 'S' ? [x + c[0], c[1], spineZ + 1 + c[2]] : [x + w - 1 - c[0], c[1], spineZ - d + (d - 1 - c[2])];
}

function hatchFacing(kind: HatchKind | undefined, row: Row): number | undefined {
  switch (kind) {
    case 'input_bus': case 'output_bus': return towardSpine(row);
    case 'energy': case 'maintenance': return OPPOSITE[towardSpine(row)];
    case 'input_hatch': case 'output_hatch': return UP;
    default: return undefined;
  }
}

/** Fluid hatches of `kind` in the order they were given their fluids: canonical (z, x), like the top-layer candidates. */
function fluidHatches(u: Unit, kind: 'input_hatch' | 'output_hatch'): UnitCell[] {
  return u.cells.filter((c) => c.hatch === kind).sort((a, b) => a.pos[2] - b.pos[2] || a.pos[0] - b.pos[0]);
}

function unitPorts(u: Unit, row: Row, x: number, spineZ: number): UnitPorts {
  const toSpine = towardSpine(row);
  const away = OPPOSITE[toSpine]!;
  const at = (c: UnitCell) => localCell(u, row, x, spineZ, c.pos);
  if (!u.multiblock) {
    const machine = at(u.cells.find((c) => c.role === 'machine')!);
    return {
      power: u.electric ? step(machine, away) : null,
      items: [step(machine, toSpine)],
      fluidIn: u.io.fluidIn.length > 0 ? [step(machine, UP)] : [],
      fluidOut: u.io.fluidOut.length > 0 ? [step(machine, UP)] : [],
      itemFaces: u.io.itemOut ? [{ pos: machine, side: toSpine }] : [],
      fluidFaces: u.io.fluidOut.length > 0 ? [{ pos: machine, side: UP }] : [],
    };
  }
  const energy = u.cells.find((c) => c.hatch === 'energy');
  const items: Vec3[] = [];
  for (const kind of ['input_bus', 'output_bus'] as const) {
    for (const c of u.cells) {
      if (c.hatch !== kind) continue;
      const front = step(at(c), toSpine);
      if (front[1] === 0 && front[2] === spineZ && !items.some((p) => samePos(p, front))) items.push(front);
    }
  }
  const outputHatches = fluidHatches(u, 'output_hatch');
  return {
    power: energy === undefined ? null : step(at(energy), away),
    items,
    fluidIn: fluidHatches(u, 'input_hatch').map((c) => step(at(c), UP)),
    fluidOut: outputHatches.map((c) => step(at(c), UP)),
    itemFaces: u.cells.filter((c) => c.hatch === 'output_bus').map((c) => ({ pos: at(c), side: toSpine })),
    fluidFaces: outputHatches.map((c) => ({ pos: at(c), side: UP })),
  };
}

/**
 * Two rows along x facing a spine at z = `spineZ`, after a power head of `headWidth` columns. Each unit goes to the
 * shorter row (N on a tie), one column apart from a multiblock neighbour, and moves along until its item ports are
 * `portSpacing` cells apart from every earlier unit's (0: may share; 1: own cell; 2: not even neighbouring).
 */
export function placeUnits(units: readonly Unit[], opts: { headWidth: number; portSpacing: 0 | 1 | 2 }): Placement {
  const { headWidth, portSpacing } = opts;
  const cursor: Record<Row, number> = { N: headWidth, S: headWidth };
  const previous: Record<Row, Unit | null> = { N: null, S: null };
  const claimed = new Set<number>();
  const near = (px: number) => {
    for (let d = -(portSpacing - 1); d <= portSpacing - 1; d++) if (claimed.has(px + d)) return true;
    return false;
  };
  // item ports lie on the spine, so their x does not depend on where the spine ends up
  const portXs = (u: Unit, row: Row, x: number) => unitPorts(u, row, x, 0).items.map((p) => p[0]);
  const slots: Array<{ u: Unit; row: Row; x: number }> = [];
  for (const u of units) {
    const row: Row = cursor.N <= cursor.S ? 'N' : 'S';
    const before = previous[row];
    let x = cursor[row] + (before !== null && (u.multiblock || before.multiblock) ? 1 : 0);
    if (portSpacing > 0) while (portXs(u, row, x).some(near)) x += 1;
    for (const px of portXs(u, row, x)) claimed.add(px);
    cursor[row] = x + u.size[0];
    previous[row] = u;
    slots.push({ u, row, x });
  }

  const deepest = (row: Row) => slots.reduce((d, s) => (s.row === row ? Math.max(d, s.u.size[2]) : d), 0);
  const dN = deepest('N'), dS = deepest('S');
  const spineZ = 1 + dN;
  const tailX = Math.max(cursor.N, cursor.S);
  const size: Vec3 = [tailX + 1, units.reduce((h, u) => Math.max(h, u.size[1]), 1), dN + dS + 3];

  const placed: PlacedUnit[] = [];
  const blocks: LocalBlock[] = [];
  const reserved: Vec3[] = [];
  for (const { u, row, x } of slots) {
    const toSpine = towardSpine(row);
    for (const c of u.cells) {
      const facing = c.role === 'machine' ? toSpine : c.role === 'hatch' ? hatchFacing(c.hatch, row) : undefined;
      blocks.push({
        pos: localCell(u, row, x, spineZ, c.pos), block: { ...c.block }, role: c.role, ...(facing === undefined ? {} : { facing }),
        stepId: u.stepId, label: c.label, ...(c.item === undefined ? {} : { item: c.item }),
        ...(c.config === undefined ? {} : { config: { ...c.config } }),
      });
    }
    for (const a of u.air) reserved.push(localCell(u, row, x, spineZ, a));
    const at: Vec3 = row === 'S' ? [x, 0, spineZ + 1] : [x, 0, spineZ - u.size[2]];
    placed.push({ ...u, row, at, facing: toSpine, ports: unitPorts(u, row, x, spineZ) });
  }
  blocks.sort((a, b) => comparePos(a.pos, b.pos));
  reserved.sort(comparePos);
  return { units: placed, size, spineZ, firstX: headWidth, tailX, blocks, reserved };
}

/** Positions used by two or more blocks, each once, sorted by x, y, z. */
export function overlaps(blocks: ReadonlyArray<{ pos: Vec3; role: BlockRole }>): Vec3[] {
  const seen = new Map<string, number>();
  const twice: Vec3[] = [];
  for (const b of blocks) {
    const key = posKey(b.pos);
    const n = (seen.get(key) ?? 0) + 1;
    seen.set(key, n);
    if (n === 2) twice.push([...b.pos]);
  }
  return twice.sort(comparePos);
}

/** The placement's floor area over the units' floor areas (1 = no space between units); 0 without units. */
export function compactness(p: Placement): number {
  const unitArea = p.units.reduce((sum, u) => sum + u.size[0] * u.size[2], 0);
  return unitArea === 0 ? 0 : (p.size[0] * p.size[2]) / unitArea;
}

// ---- Covers and settings ----

/**
 * The blocks in their order, with each cover appended to `covers` and each config merged key by key into `config` of
 * the first non-ghost block at its position. The input blocks are not changed. A position without such a block is a
 * bug in the calling stage and throws.
 */
export function attachCovers(blocks: readonly LocalBlock[], covers: readonly HostCover[], configs: readonly HostConfig[]): LocalBlock[] {
  const hostIndex = new Map<string, number>();
  blocks.forEach((b, i) => {
    const key = posKey(b.pos);
    if (b.role !== 'ghost' && !hostIndex.has(key)) hostIndex.set(key, i);
  });
  const out = [...blocks];
  const copied = new Set<number>();
  const host = (pos: Vec3): LocalBlock => {
    const i = hostIndex.get(posKey(pos));
    if (i === undefined) throw new Error(`no host block at ${posKey(pos)}`);
    if (!copied.has(i)) {
      const b = blocks[i]!;
      out[i] = { ...b, ...(b.covers === undefined ? {} : { covers: [...b.covers] }), ...(b.config === undefined ? {} : { config: { ...b.config } }) };
      copied.add(i);
    }
    return out[i]!;
  };
  for (const { pos, cover } of covers) {
    const b = host(pos);
    b.covers = [...(b.covers ?? []), cover];
  }
  for (const { pos, config } of configs) {
    const b = host(pos);
    b.config = { ...b.config, ...config };
  }
  return out;
}
