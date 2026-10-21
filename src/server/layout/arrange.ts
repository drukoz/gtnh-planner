// Units and their placement (Plan 5 Task 5; spec §3.6, architecture §11.13–§11.14): one unit per new machine of every
// placed step, in flow order; multiblocks take their exported structure (Plan 1 canonical frame: front on the north,
// z = 0 side) with hatch cells chosen on its casings and sized to the step: on the casings GregTech's structure check
// takes each hatch on — the export's hatch rules (exporter 0.6.0, hatch-export.ts, gt-mechanics §5.5) narrowed by the
// hand table's row where it fits, else either alone (hatch-rules.ts, research hatch-rules.md) — each hatch facing an
// open side where its port is; a multiblock with neither keeps the generic placement and says so (older exports hold
// no hatch positions, gt-mechanics §5). The programmed circuit goes on the machine or its input bus. Units are then
// placed in two rows facing a one-block spine, row N turned 180° so every front faces the spine, with the ports the
// routing, logistics and hookup stages connect to. Covers and settings from those stages are attached to their host
// blocks here too.
// A singleblock's output side faces the spine and its front (GT's `mMainFacing`, kept apart from the output side) faces
// the power head: GT never lets it face up or down. With the supply tier given, the lowest feed tier stands
// next to the power head and machines fed at different tiers stand a column apart, so their power ports never touch.
// With the `primitive` option (on unless false; layoutLine turns it off for machine to machine only; architecture §11
// entry 48) GT's primitive machines follow their own rules: a steam singleblock vents through its output side, which
// turns up over an empty cell, and a Bricked Blast Furnace, which GT lets nothing automated fill, or a Coke Oven, which
// GT fills only through its own Coke Oven Hatch (one the layout does not lay), is run by hand at the end of its row,
// one block back from the spine with nothing of the line touching it.
// Every order and tie-break is fixed, so the same plan gives the same placement.

import { isFluidKey, itemKey, type ItemKey, type StuffKey } from '../../shared/keys.ts';
import { joinNames } from '../../shared/layout/format.ts';
import { DIRS, OPPOSITE, posKey, step, type Vec3 } from '../../shared/layout/geometry.ts';
import type { FeedSpec } from '../../shared/types/feed.ts';
import type { BlockRole, ConduitSpec, CoverSpec, TailChest } from '../../shared/types/layout.ts';
import type { BlockRef, Machine, Pack, Product, Recipe } from '../../shared/types/pack.ts';
import { machineGroups } from '../../shared/plan/pools.ts';
import type { BomLine, Plan, PlanStep, PlanWarning } from '../../shared/types/plan.ts';
import { UNKNOWN_BLOCK } from '../../shared/types/world.ts';
import { stepProductName } from '../planner/bom.ts';
import { minimalHatch } from '../planner/build-cost.ts';
import { isAutoWorkbench } from '../planner/machine-options.ts';
import { simpleClassName } from '../world/facts.ts';
import {
  elementMap, elementTakes, hatchRulesOf, KIND_CLASS, ruleNeeds, rulePower, ruleTakes, type HatchKind, type HatchRule,
} from './hatch-rules.ts';
import { benchPlan, type BenchPlan } from './bench.ts';
import { manualReasonOf } from './multiblock-rules.ts';
import { busSlots, hatchLitres, machineRef, pickHatch, type HatchClass } from './parts.ts';

export type { HatchKind } from './hatch-rules.ts';

// ---- Types ----

export type BlockConfig = Record<string, string | number | boolean>;

/**
 * A block in the line's local grid; mirrors `LayoutBlock` (architecture §11.14, and "EnderIO conduits, granted change
 * requests (add-on 11)" for `conduits` and `tail`).
 */
export interface LocalBlock {
  pos: Vec3; block: BlockRef; role: BlockRole; facing?: number; mainFacing?: number; stepId?: string; label: string; item?: StuffKey; connections?: number;
  covers?: CoverSpec[]; config?: BlockConfig;
  /** A conduit bundle's conduits, item first, faces in the local grid (`LayoutBlock.conduits`). */
  conduits?: ConduitSpec[];
  /** Set on the tail's input and output chests (`LayoutBlock.tail`). */
  tail?: TailChest;
  /** What a hatch the line chose for a multiblock is for (`LayoutBlock.hatch`). */
  hatch?: HatchKind;
  /** The structured feeding configuration of a mode's own block (`LayoutBlock.feed`, architecture §11 entry 51). */
  feed?: FeedSpec;
  /** Every step a shared machine runs, on each of its unit's cells (`Unit.stepIds`, `LayoutBlock.stepIds`). */
  stepIds?: string[];
}
/** A cover for the block at `pos` (Tasks 6–8). */
export interface HostCover { pos: Vec3; cover: CoverSpec }
/** Settings for the block at `pos` (Tasks 7–8). */
export interface HostConfig { pos: Vec3; config: BlockConfig }

/** What a step moves in and out; fluid keys sorted. */
export interface StepIo { itemIn: boolean; itemOut: boolean; fluidIn: StuffKey[]; fluidOut: StuffKey[] }

export interface UnitCell {
  pos: Vec3; block: BlockRef; role: 'machine' | 'casing' | 'hatch'; label: string; item?: StuffKey; hatch?: HatchKind;
  config?: BlockConfig;
  /** The block of the exported structure a hatch cell replaced: a casing, or an exported hatch another tier replaced. */
  replaces?: ItemKey;
  /** The canonical side (ForgeDirection, front on the north) a placed hatch's front faces: where its port is. */
  face?: number;
  /** The fluid a fluid hatch takes or gives; none on an output hatch GregTech needs empty (a distillation layer's). */
  fluid?: StuffKey;
  /** A cell of a layer the layout added to the exported structure (a taller distillation tower). */
  added?: true;
  /**
   * A hatch the exported structure holds that the layout keeps where it is (a muffler GT's rule turns to an open side):
   * its kind is the unit's (`hatch`), but it is no hatch the line chose, so its block carries no `LayoutBlock.hatch` and
   * the layout's parts leave it to Plan 2's build list, which lists it (plan 12 Task 6).
   */
  exported?: true;
}

/**
 * Why a unit is run by hand (option `primitive`; `multiblock-rules.ts`): GT lets nothing automated move a Bricked
 * Blast Furnace's items (`no_automation`), and takes a Coke Oven's only through its own hatch (`own_hatch`).
 */
export type ManualReason = 'no_automation' | 'own_hatch';

export interface Unit {
  stepId: string; index: number; mteId: number; name: string; tier: number; euPerTick: number; electric: boolean; multiblock: boolean;
  /**
   * Every step the machine runs, `stepId` first (plan 12, architecture §11 entry 39): the steps of its sharing pool
   * (`PlanStep.pool`), in `pool.steps` order; set only for a machine of two or more steps (`unitSteps` reads it).
   */
  stepIds?: string[];
  /** Canonical: front on the north (z = 0) side. */
  size: Vec3;
  cells: UnitCell[]; air: Vec3[]; io: StepIo;
  /**
   * Run by hand (option `primitive`): its structure has no hatch, it draws no power and its `io` is empty, as the line
   * moves nothing in or out of it; `placeUnits` stands it last in its row, one block back from the spine.
   */
  manual?: ManualReason;
  /**
   * A steam singleblock (GT `MTEBasicMachineBronze`) that vents through its output side (option `primitive`):
   * `placeUnits` turns that side up and keeps the cell above it, and its steam inlet behind it, empty. Its `io` has no
   * fluids, as its top vents.
   */
  vent?: true;
  /**
   * A GT++ Electric Auto Workbench's crafting-table step (plan 12 Task 6, bench.ts): its grid, ingredients, result, what
   * a craft hands back and the tools its grid holds. `placeUnits` turns its front (GT's front: no main facing apart from
   * it) away from the middle row, so its back, the face it pushes its result out of, meets the line's logistics and its
   * front takes its power; it gets no output cover (covers fit neither its front nor its back) and no fluid port.
   */
  bench?: BenchPlan;
}

/**
 * Local cells the line connects to. A multiblock's `fluidIn[i]` is the cell its front faces of the input hatch that
 * takes `io.fluidIn[i]` (likewise `fluidOut`); a singleblock has one cell above it for all its fluids. An item port is
 * on the spine's column: on the spine, or above it in front of a bus GregTech takes only higher up.
 */
export interface UnitPorts {
  power: Vec3 | null; items: Vec3[]; fluidIn: Vec3[]; fluidOut: Vec3[];
  /** The side of each `fluidIn[i]` / `fluidOut[i]` cell that touches its hatch or machine (down for a port above). */
  fluidInSides: number[]; fluidOutSides: number[];
  /** Output faces that get a conveyor cover. */
  itemFaces: Array<{ pos: Vec3; side: number }>;
  /** Output faces that get a pump cover. */
  fluidFaces: Array<{ pos: Vec3; side: number }>;
}

export interface PlacedUnit extends Unit {
  row: 'N' | 'S';
  /** Local min corner. */
  at: Vec3;
  /** 3 in row N, 2 in row S: toward the spine (a singleblock's output side, a multiblock's controller front). */
  facing: number;
  /**
   * A singleblock's front (GT's `mMainFacing`, kept apart from its output side `facing`): toward the power head (local
   * west), as GT allows no front up or down. Undefined for a multiblock.
   */
  mainFacing?: number;
  /** A singleblock's output side where it does not face the spine: up (1) for a venting steam singleblock (`Unit.vent`). */
  outputSide?: number;
  ports: UnitPorts;
}

export interface Placement {
  units: PlacedUnit[];
  /** W, H, L */
  size: Vec3;
  spineZ: number; firstX: number; tailX: number;
  /** Every unit cell, sorted by x, y, z. */
  blocks: LocalBlock[];
  /**
   * Cells kept empty, sorted by x, y, z: the air cells the multiblocks need (their hollows, the block a muffler faces),
   * the vent above a venting steam machine and its steam inlet behind it (`Unit.vent`), and the front row of a unit run
   * by hand, between it and the spine (`Unit.manual`).
   */
  reserved: Vec3[];
}

// ---- Small helpers ----

const DOWN = 0, UP = 1, NORTH = 2, SOUTH = 3, WEST = 4, EAST = 5;

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

/**
 * What a unit's buses and fluid hatches are sized for: the slots of one run's distinct item inputs and outputs, and the
 * litres one run takes or gives of each fluid — of the largest need among the steps the machine runs (a shared
 * multiblock runs one recipe at a time, plan 12 Task 6).
 */
interface HatchNeed { inSlots: number; outSlots: number; litresIn(key: StuffKey): number; litresOut(key: StuffKey): number }

function hatchNeed(steps: readonly PlanStep[]): HatchNeed {
  const most = (of: (s: PlanStep) => number): number => steps.reduce((m, s) => Math.max(m, of(s)), 0);
  return {
    inSlots: most((s) => distinctItems(s.inputs)), outSlots: most((s) => distinctItems(s.outputs)),
    litresIn: (key) => most((s) => perRun(s.inputs, key)), litresOut: (key) => most((s) => perRun(s.outputs, key)),
  };
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

/**
 * The exported structure's cells, or null when it is missing, truncated or has no block on its controller cell. A hatch
 * the structure holds is laid as the hatch of its class the multiblock is built with (`minimalHatch`, Task 2: the lowest
 * tier, a debug hatch's plain class), with that hatch's block, item and name, so the layout, its place step, the 3D view
 * and the projector show the hatch Plan 2's build list lists (`structureParts`); an exporter's UV muffler is an LV one.
 */
function structureCells(pack: Pack, m: Machine): Shape | null {
  const st = m.structure;
  if (st === undefined || st.truncated === true || !st.blocks.some((b) => samePos(b.pos, st.controller))) return null;
  const cells = st.blocks.map((b): UnitCell => {
    if (samePos(b.pos, st.controller)) return { pos: [...b.pos], block: machineRef(m), role: 'machine', label: m.name, item: m.itemKey };
    if (b.block.mteId === undefined) return casingCell(pack, b.pos, b.block);
    const exported = pack.machines.get(b.block.mteId);
    if (exported === undefined) return { pos: [...b.pos], block: { ...b.block }, role: 'hatch', label: `${b.block.id} #${b.block.mteId}` };
    const hatch = minimalHatch(pack, exported);
    return { pos: [...b.pos], block: machineRef(hatch), role: 'hatch', label: hatch.name, item: hatch.itemKey };
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
  muffler: 'muffler', steam: 'steam hatch',
};

/** A pick that holds less than `need`. */
function holdsLess(hatch: Machine, need: { slots?: number; litres?: number } | undefined): boolean {
  if (need?.slots !== undefined) return hatch.tier === undefined || busSlots(hatch.tier) < need.slots;
  if (need?.litres !== undefined) return hatch.tier === undefined || hatchLitres(hatch.tier) < need.litres;
  return false;
}

/** "a", "a or b", "a, b or c". */
function orList(words: readonly string[]): string {
  return words.length <= 1 ? (words[0] ?? '') : `${words.slice(0, -1).join(', ')} or ${words.at(-1)!}`;
}

/** A multiblock's shape, what its unit moves (`io` without the fluids no hatch was placed for) and its power. */
interface MultiblockShape { shape: Shape; io: StepIo; electric: boolean }

/** `io` with only the fluids a fluid hatch of the unit takes or gives. */
function placedIo(io: StepIo, cells: readonly UnitCell[]): StepIo {
  const has = (kind: HatchKind, key: StuffKey) => cells.some((c) => c.hatch === kind && c.fluid === key);
  return { ...io, fluidIn: io.fluidIn.filter((k) => has('input_hatch', k)), fluidOut: io.fluidOut.filter((k) => has('output_hatch', k)) };
}

/** The hatch of `kind` in place of the casing `cells[i]` (on an added layer, as that casing was). */
function hatchCell(cells: UnitCell[], i: number, hatch: Machine, kind: HatchKind, face: number, extra: { config?: BlockConfig; fluid?: StuffKey }): void {
  const casing = cells[i]!;
  cells[i] = {
    pos: casing.pos, block: machineRef(hatch), role: 'hatch', label: hatch.name, item: hatch.itemKey, hatch: kind,
    ...(extra.config === undefined ? {} : { config: extra.config }), replaces: blockKey(casing.block), face,
    ...(extra.fluid === undefined ? {} : { fluid: extra.fluid }), ...(casing.added === true ? { added: true } : {}),
  };
}

/**
 * The generic placement, for a multiblock without a rule (or without an exported structure): buses on the front of the
 * bottom layer nearest the controller, energy and maintenance on its back nearest the middle, fluid hatches on the top
 * layer facing up.
 */
function genericHatches(pack: Pack, m: Machine, s: PlanStep, io: StepIo, electric: boolean, circuit: number | undefined, shape: Shape,
  need: HatchNeed, warnings: PlanWarning[]): StepIo {
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
  const place = (kind: HatchKind, tier: number | null, need: { slots?: number; litres?: number } | undefined,
    pools: ReadonlyArray<readonly number[]>, face: number, extra: { config?: BlockConfig; fluid?: StuffKey } = {}): void => {
    const hatch = pickHatch(pack, KIND_CLASS[kind], tier, need);
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
    hatchCell(cells, free, hatch, kind, face, extra);
    if (holdsLess(hatch, need)) {
      warnings.push({ code: 'hatch_small', stepId: s.id, text: `${m.name}: the biggest ${hatch.name} holds less than one run needs — split the inputs by hand` });
    }
  };

  // the circuit goes in the input bus's circuit slot, so a step with a circuit always gets one
  if (io.itemIn || circuit !== undefined) {
    place('input_bus', null, { slots: need.inSlots }, [front], NORTH, circuit === undefined ? {} : { config: { circuit } });
  }
  if (io.itemOut) place('output_bus', null, { slots: need.outSlots }, [front], NORTH);
  if (electric) place('energy', s.machine.tier, undefined, [back], SOUTH);
  const anyBottom = [...bottom].sort((a, b) => cells[b]!.pos[2] - cells[a]!.pos[2] || byDistance(middle)(a, b));
  place('maintenance', null, undefined, [back, anyBottom], SOUTH);
  for (const key of io.fluidIn) place('input_hatch', null, { litres: need.litresIn(key) }, [top], UP, { fluid: key });
  for (const key of io.fluidOut) place('output_hatch', null, { litres: need.litresOut(key) }, [top], UP, { fluid: key });

  if (short.length > 0) {
    warnings.push({ code: 'hatch_cells_short', stepId: s.id,
      text: `${m.name}: put the remaining hatches (${short.map((k) => HATCH_TEXT[k]).join(', ')}) on any casing` });
  }
  return placedIo(io, cells);
}

// ---- Hatches by GregTech's rules ----

/**
 * The cells around and inside the structure's box, one wider and up to one above it but never below its floor, that
 * hold no block and are no reserved air and that can be reached from outside the box: the cells a hatch may face.
 */
function openCells(shape: Shape): Set<string> {
  const [w, h, d] = shape.size;
  const solid = new Set([...shape.cells.map((c) => posKey(c.pos)), ...shape.air.map(posKey)]);
  const inBox = (p: Vec3) => p[0] >= -1 && p[0] <= w && p[1] >= 0 && p[1] <= h && p[2] >= -1 && p[2] <= d;
  const open = new Set<string>();
  const queue: Vec3[] = [];
  const visit = (p: Vec3): void => {
    const key = posKey(p);
    if (!inBox(p) || solid.has(key) || open.has(key)) return;
    open.add(key);
    queue.push(p);
  };
  for (let y = 0; y <= h; y++) {
    for (let z = -1; z <= d; z++) {
      for (let x = -1; x <= w; x++) if (x < 0 || x >= w || y >= h || z < 0 || z >= d) visit([x, y, z]);
    }
  }
  for (let i = 0; i < queue.length; i++) for (let side = 0; side < DIRS.length; side++) visit(step(queue[i]!, side));
  return open;
}

/** One way to put a hatch on cell `i`: its front toward `side`, onto the open cell `port`. */
interface Spot { i: number; side: number; port: Vec3; rank: number[] }

/** How a hatch of each kind wants to face: buses the spine, fluid hatches and mufflers up, the rest the back. */
type FacePlan = 'front' | 'up' | 'back';

const FACE_PLAN: Readonly<Record<HatchKind, FacePlan>> = {
  input_bus: 'front', output_bus: 'front', input_hatch: 'up', output_hatch: 'up', muffler: 'up', energy: 'back', maintenance: 'back', steam: 'back',
};

/**
 * The order of the spots a hatch may take (smaller first): a bus faces the spine from the lowest layer, nearest the
 * controller; an energy, maintenance or steam hatch faces the back from the lowest layer, nearest the middle, else a
 * side, else up; a fluid hatch or muffler faces up (front row first, as the generic placement), else a side, else the
 * back, and among those first onto a column (x, z) that holds no other port of the unit (`stacked`): ports stacked in
 * one column wall each other in, so each pipe could only come from the side (a distillation tower's layer outputs, one
 * per layer, would all take its front corner). A face toward the spine's side of the box (z = −1) is a bus's only:
 * elsewhere it is the spine, or the cells above it that both rows' hatches would share.
 */
function spotRank(plan: FacePlan, p: Vec3, side: number, cx: number, middle: number, stacked: boolean): number[] | null {
  const [x, y, z] = p;
  const front = side === NORTH && z === 0;
  if (plan === 'front') return front ? [0, y, Math.abs(x - cx), x, z] : null;
  if (front || side === DOWN) return null;
  const sideways = side === WEST || side === EAST;
  if (plan === 'back') {
    if (side === SOUTH) return [0, y, Math.abs(x - middle), x, z];
    if (sideways) return [1, y, -z, x, side];
    return side === UP ? [2, z, x, y] : [3, y, z, x];
  }
  if (side === UP) return [0, 0, z, x, y];
  const below = stacked ? 1 : 0;
  if (sideways) return [1, below, 0, y, z, x, side];
  return side === SOUTH ? [1, below, 1, y, Math.abs(x - middle), x] : [1, below, 2, y, z, x];
}

/** The column a port cell stands in. */
function columnKey(p: Vec3): string {
  return `${p[0]},${p[2]}`;
}

function compareRanks(a: readonly number[], b: readonly number[]): number {
  for (let k = 0; k < Math.max(a.length, b.length); k++) {
    const d = (a[k] ?? 0) - (b[k] ?? 0);
    if (d !== 0) return d;
  }
  return 0;
}

/** The step's fluid inputs by the recipe's fluid slot (0 = its first fluid), from `Ingredient.slot` (fluids from 100). */
function fluidInputSlot(recipe: Recipe | undefined, key: StuffKey): number | undefined {
  const ing = recipe?.inputs.find((i) => i.slot >= 100 && i.options.some((o) => o.key === key));
  return ing === undefined ? undefined : ing.slot - 100;
}

/** The recipe's fluid outputs in its own order, each once (GT hands the k-th to a distillation tower's k-th layer). */
function recipeFluidOutputs(recipe: Recipe | undefined, io: StepIo): StuffKey[] {
  const order = recipe === undefined ? [] : [...new Set(recipe.outputs.filter((p) => isFluidKey(p.key)).map((p) => p.key))];
  return [...order.filter((k) => io.fluidOut.includes(k)), ...io.fluidOut.filter((k) => !order.includes(k))];
}

/**
 * The structure with `extra` more layers: copies of its first layer above the bottom go in under its top layer, which
 * moves up (a distillation tower built taller, GT's "layer" piece repeated).
 */
function growLayers(shape: Shape, extra: number): Shape {
  const [w, h, d] = shape.size;
  if (extra <= 0 || h < 3) return shape;
  const lift = (p: Vec3): Vec3 => (p[1] === h - 1 ? [p[0], p[1] + extra, p[2]] : [...p]);
  const cells = shape.cells.map((c) => ({ ...copyCell(c), pos: lift(c.pos) }));
  const air = shape.air.map(lift);
  for (let k = 0; k < extra; k++) {
    for (const c of shape.cells) if (c.pos[1] === 1) cells.push({ ...copyCell(c), pos: [c.pos[0], h - 1 + k, c.pos[2]], added: true });
    for (const a of shape.air) if (a[1] === 1) air.push([a[0], h - 1 + k, a[2]]);
  }
  return { size: [w, h + extra, d], cells, air };
}

/** A machine whose class simple name is `cls`. */
function isClass(pack: Pack, mteId: number | undefined, cls: string): boolean {
  return mteId !== undefined && simpleClassName(pack.machines.get(mteId)?.cls) === cls;
}

/**
 * Hatches on the casings GregTech's structure check takes them on (`rule`, research hatch-rules.md): each kind only on
 * cells whose element takes it and that hold their element's usual block (so never on a coil among casings), each
 * facing an open cell, its port, that no other hatch of the unit faces. Buses face the spine (on it, or above it where
 * GT takes a bus only higher up), energy and maintenance the back, fluid hatches up where they may and else a side or
 * the back; a cracker's catalyst goes in its middle hatch, and a distillation tower gets one output hatch per layer, the
 * k-th fluid output on the k-th layer, built taller when the recipe has more fluids. A hatch GT's check needs whatever
 * the recipe moves (`rule.needs`: a muffler, the tower's input hatch, a boiler's water and steam hatches) is added, empty,
 * where the recipe's hatches give none; an exported muffler stays where the export has it (at the lowest tier of its class,
 * as `structureCells` lays it: `UnitCell.exported`), every muffler keeps its front cell as air, and a casing minimum is
 * kept. Buses and fluid hatches are sized for `need` (the largest need of the steps the machine runs). A kind the step
 * needs that GT takes nowhere on the machine is left out with
 * `hatch_not_taken`; one without a free cell gives `hatch_cells_short`; a row's `handNote` gives `hatch_by_hand`.
 */
function ruledHatches(pack: Pack, m: Machine, s: PlanStep, io: StepIo, electric: boolean, circuit: number | undefined, rule: HatchRule,
  base: Shape, need: HatchNeed, warnings: PlanWarning[]): { shape: Shape; io: StepIo } {
  const recipe = pack.recipeById.get(s.recipeId);
  const outputs = recipeFluidOutputs(recipe, io);
  const maxLayers = rule.layerOutputs?.maxLayers ?? 0;
  const shape = rule.layerOutputs === undefined ? base
    : growLayers(base, Math.min(Math.max(0, outputs.length + 1 - base.size[1]), Math.max(0, maxLayers - base.size[1])));
  const { size, cells } = shape;
  const controller = cells.find((c) => c.role === 'machine')!.pos;
  const middle = Math.floor((size[0] - 1) / 2);
  const map = elementMap(rule, controller, size);
  const charOf = (i: number): string | undefined => map.get(posKey(cells[i]!.pos));
  // an element's usual block: the one most of its casings hold (ties → smallest key)
  const usual = new Map<string, ItemKey>();
  {
    const counts = new Map<string, Map<ItemKey, number>>();
    cells.forEach((c, i) => {
      const ch = charOf(i);
      if (c.role !== 'casing' || ch === undefined) return;
      const byKey = counts.get(ch) ?? new Map<ItemKey, number>();
      byKey.set(blockKey(c.block), (byKey.get(blockKey(c.block)) ?? 0) + 1);
      counts.set(ch, byKey);
    });
    for (const [ch, byKey] of counts) {
      const best = [...byKey].sort((a, b) => b[1] - a[1] || compareText(a[0], b[0]))[0];
      if (best !== undefined) usual.set(ch, best[0]);
    }
  }
  const open = openCells(shape);
  const claimed = new Set<string>();
  /** The columns (x, z) of the claimed ports. */
  const columns = new Set<string>();
  const claim = (port: Vec3): void => {
    claimed.add(posKey(port));
    columns.add(columnKey(port));
  };
  const casingsLeft = (rule.casingMin ?? []).map((c) => ({
    chars: c.chars, min: typeof c.min === 'number' ? c.min : c.min(size[1]),
    left: cells.filter((cell, i) => cell.role === 'casing' && c.chars.includes(charOf(i) ?? '\0')).length,
  }));
  const short: HatchKind[] = [];
  const notTaken: HatchKind[] = [];

  /** The best free spot for `kind` among cells whose element character passes `chars` (and on layer `layer`). */
  const spotFor = (kind: HatchKind, chars?: string, layer?: number): Spot | null => {
    const plan = FACE_PLAN[kind];
    let best: Spot | null = null;
    cells.forEach((c, i) => {
      const ch = charOf(i);
      if (c.role !== 'casing' || ch === undefined || !elementTakes(rule, ch, kind) || (chars !== undefined && !chars.includes(ch))) return;
      if (layer !== undefined && c.pos[1] !== layer) return;
      if (blockKey(c.block) !== usual.get(ch)) return;
      if (casingsLeft.some((min) => min.chars.includes(ch) && min.left - 1 < min.min)) return;
      for (let side = 0; side < DIRS.length; side++) {
        const port = step(c.pos, side);
        if (!open.has(posKey(port)) || claimed.has(posKey(port))) continue;
        const rank = spotRank(plan, c.pos, side, controller[0], middle, columns.has(columnKey(port)));
        if (rank !== null && (best === null || compareRanks(rank, best.rank) < 0)) best = { i, side, port, rank };
      }
    });
    return best;
  };
  const take = (spot: Spot): void => {
    claim(spot.port);
    const ch = charOf(spot.i) ?? '';
    for (const c of casingsLeft) if (c.chars.includes(ch)) c.left -= 1;
  };
  const place = (kind: HatchKind, tier: number | null, need: { slots?: number; litres?: number } | undefined,
    where: { chars?: string; layer?: number } = {}, extra: { config?: BlockConfig; fluid?: StuffKey } = {}): Spot | null => {
    if (!ruleTakes(rule, kind)) {
      if (!notTaken.includes(kind)) notTaken.push(kind);
      return null;
    }
    const cls = rule.classes?.[kind] ?? KIND_CLASS[kind];
    const sized = rule.classes?.[kind] === undefined ? need : undefined;     // another class keeps its own sizes
    const hatch = pickHatch(pack, cls as HatchClass, tier, sized);
    const spot = spotFor(kind, where.chars, where.layer);
    if (hatch === null || spot === null) {
      short.push(kind);
      return null;
    }
    take(spot);
    hatchCell(cells, spot.i, hatch, kind, spot.side, extra);
    if (holdsLess(hatch, sized)) {
      warnings.push({ code: 'hatch_small', stepId: s.id, text: `${m.name}: the biggest ${hatch.name} holds less than one run needs — split the inputs by hand` });
    }
    return spot;
  };

  // an exported muffler (a hatch-only element the export builds) stays, at the lowest tier of its class as
  // `structureCells` laid it (the one Plan 2's build list lists), facing an open side
  cells.forEach((c, i) => {
    if (c.role !== 'hatch' || c.hatch !== undefined || !isClass(pack, c.block.mteId, 'MTEHatchMuffler')) return;
    const spot = [UP, WEST, EAST, SOUTH].map((side) => ({ side, port: step(c.pos, side) })).find((f) => open.has(posKey(f.port)) && !claimed.has(posKey(f.port)));
    cells[i] = { ...c, hatch: 'muffler', face: spot?.side ?? UP, exported: true };
    if (spot !== undefined) {
      claim(spot.port);
      shape.air.push([...spot.port]);
    }
  });

  // the circuit goes in the input bus's circuit slot, so a step with a circuit always gets one
  if (io.itemIn || circuit !== undefined) {
    place('input_bus', null, { slots: need.inSlots }, {}, circuit === undefined ? {} : { config: { circuit } });
  }
  if (io.itemOut) place('output_bus', null, { slots: need.outSlots });
  if (electric) place('energy', s.machine.tier, undefined);
  if (rulePower(rule) === 'steam') place('steam', null, undefined);
  for (const key of io.fluidIn) {
    const slot = fluidInputSlot(recipe, key);
    const chars = slot === undefined ? undefined : rule.fluidInputSlots?.[slot];
    place('input_hatch', null, { litres: need.litresIn(key) }, chars === undefined ? {} : { chars }, { fluid: key });
  }
  for (const [k, key] of outputs.entries()) {
    const layer = rule.layerOutputs === undefined ? undefined : k + 1;
    if (layer !== undefined && layer >= size[1]) {
      short.push('output_hatch');
      continue;
    }
    place('output_hatch', null, { litres: need.litresOut(key) }, layer === undefined ? {} : { layer }, { fluid: key });
  }
  if (rule.layerOutputs !== undefined) {
    // GT needs an output hatch on every layer above the bottom, also one no fluid of the recipe reaches
    for (let y = 1; y < size[1]; y++) {
      if (!cells.some((c) => c.hatch === 'output_hatch' && c.pos[1] === y)) place('output_hatch', null, undefined, { layer: y });
    }
  }
  if (ruleTakes(rule, 'maintenance')) place('maintenance', null, undefined);
  // what GT's check needs whatever the recipe moves: one, empty, where the recipe's hatches gave none (a kind already
  // short is said once); a fluid of the machine's own (a boiler's water and steam) always gets a hatch of its own
  for (const need of ruleNeeds(rule)) {
    const met = need.fluid === undefined
      && cells.some((c, i) => c.hatch === need.kind && (need.chars === undefined || need.chars.includes(charOf(i) ?? '\0')));
    if (met || (need.fluid === undefined && short.includes(need.kind))) continue;
    const spot = place(need.kind, need.kind === 'energy' ? s.machine.tier : null, undefined, need.chars === undefined ? {} : { chars: need.chars },
      need.fluid === undefined ? {} : { fluid: need.fluid });
    if (spot !== null && need.kind === 'muffler') shape.air.push([...spot.port]);          // GT's muffler needs air in front
  }

  const needed = notTaken.filter((k) => k !== 'energy' && k !== 'maintenance');
  if (needed.length > 0) {
    warnings.push({ code: 'hatch_not_taken', stepId: s.id,
      text: `${m.name} takes no ${orList(needed.map((k) => HATCH_TEXT[k]))} in GregTech: ${rule.byHand ?? 'move those items and fluids by hand'}` });
  }
  if (rule.handNote !== undefined) warnings.push({ code: 'hatch_by_hand', stepId: s.id, text: `${m.name}: ${rule.handNote}` });
  if (short.length > 0) {
    warnings.push({ code: 'hatch_cells_short', stepId: s.id,
      text: `${m.name}: put the remaining hatches (${short.map((k) => HATCH_TEXT[k]).join(', ')}) on casings GregTech takes them on (it shows them in game)` });
  }
  shape.air.sort(comparePos);
  return { shape, io: placedIo(io, cells) };
}

/**
 * A multiblock: its structure (or the unknown box) with hatch cells on its casings, by its hatch rules
 * (`hatchRulesOf`, `ruledHatches`): the export's narrowed by the table row that fits the exported structure, the
 * export's alone (`hatch_rules_export_only`, or `hatch_notes_unfit` for a row that does not fit), or the fitting row
 * alone; else by the generic placement with `hatch_rules_unknown`. Electric unless it is a steam machine or its rules
 * run it on steam or nothing (a steam multiblock then says how to feed it), but one ruled by the export alone whose
 * export took neither an energy nor a steam hatch (power none) stays electric when a step it runs draws EU
 * (`euPerTick`, the largest of its steps'): GT may take only energy hatches above the probe's tier there (a fusion
 * reactor's energy injectors), so the line still counts its power. An electric one whose export took no plain energy
 * hatch gets no energy hatch and says so (`hatch_energy_exotic`): it takes only multi-amp or laser energy hatches, or
 * only higher tiers.
 */
function multiblockShape(pack: Pack, m: Machine, s: PlanStep, io: StepIo, circuit: number | undefined, need: HatchNeed,
  euPerTick: number, warnings: PlanWarning[]): MultiblockShape {
  const exported = structureCells(pack, m);
  if (exported === null) {
    warnings.push({ code: 'structure_unknown', stepId: s.id, text: `${m.name}: no exported structure, drawn as a 3×3×3 box — check its real size in game` });
    const shape = unknownBoxCells(pack, m);
    const electric = m.kind !== 'steam';
    return { shape, io: genericHatches(pack, m, s, io, electric, circuit, shape, need, warnings), electric };
  }
  const rules = hatchRulesOf(m);
  if (rules === null) {
    warnings.push({ code: 'hatch_rules_unknown', stepId: s.id,
      text: `${m.name}: hatch positions are not checked against GregTech's rules here — if it does not form, move the hatches to the casings it shows in game` });
    const electric = m.kind !== 'steam';
    return { shape: exported, io: genericHatches(pack, m, s, io, electric, circuit, exported, need, warnings), electric };
  }
  const { rule, source, rowUnfit } = rules;
  if (source === 'export') {
    warnings.push(rowUnfit
      ? { code: 'hatch_notes_unfit', stepId: s.id, text: `${m.name}: the planner's notes for this machine do not fit its exported structure, so its `
        + "hatches follow GregTech's per-casing rules from the export alone; GregTech checks more in the controller — check in game that it forms" }
      : { code: 'hatch_rules_export_only', stepId: s.id, text: `${m.name}: its hatches go where GregTech's structure check takes them on each casing; `
        + 'GregTech checks more in the controller (sides, layers, line length) than the planner has notes for here — check in game that it forms' });
  }
  const power = rulePower(rule);
  // an export that took neither an energy nor a steam hatch (power none) does not show that the machine takes no EU: its
  // controller may take only hatches above the probe's lowest tier (GT's fusion reactors take an energy hatch of their
  // own tier or above); a shared machine draws EU when any step it runs does (plan 12 Task 6)
  const electric = m.kind !== 'steam' && (power === 'eu' || (source === 'export' && power === 'none' && euPerTick > 0));
  if (power === 'steam') warnings.push({ code: 'steam_machine', stepId: s.id, text: `${m.name} runs on steam: connect a steam supply to its Steam Hatch by hand` });
  const anywhere = rule.exported?.anywhere;
  if (electric && anywhere !== undefined && !anywhere.has('energy')) {
    // the layout lays only GT's plain energy hatch, and only where the export took one, so the unit gets no energy hatch
    warnings.push({ code: 'hatch_energy_exotic', stepId: s.id, text: anywhere.has('energy_multi') || anywhere.has('energy_laser')
      ? `${m.name} takes only multi-amp or laser energy hatches in GregTech: place one by hand`
      : `${m.name}: GregTech took none of the lowest-tier energy hatches the export tried on it, so it may take only higher tiers: place one by hand` });
  }
  const ruled = ruledHatches(pack, m, s, io, electric, circuit, rule, exported, need, warnings);
  return { shape: ruled.shape, io: ruled.io, electric };
}

function copyCell(c: UnitCell): UnitCell {
  return { ...c, pos: [...c.pos], block: { ...c.block }, ...(c.config === undefined ? {} : { config: { ...c.config } }) };
}

/** The canonical side `face` of a unit in `row`: row S keeps it, row N is turned 180° (north ↔ south, west ↔ east). */
function rowFace(face: number, row: 'N' | 'S'): number {
  return row === 'S' ? face : face <= UP ? face : OPPOSITE[face]!;
}

/** Options of `unitsFromPlan`. */
export interface UnitOptions {
  /**
   * The rules of GT's primitive machines (architecture §11 entry 48): a steam singleblock vents (`Unit.vent`), and a
   * Bricked Blast Furnace or a Coke Oven is run by hand (`Unit.manual`). On unless false, so every caller gets
   * vent-safe placement; `layoutLine` passes false for machine-to-machine mode only, which add-on 15 lays out its own
   * way.
   */
  primitive?: boolean;
}

/** Why a unit run by hand gets nothing of the line, for its `manual_machine` warning (`multiblock-rules.ts`). */
const MANUAL_WHY: Readonly<Record<ManualReason, string>> = {
  no_automation: 'GregTech lets no pipe, conveyor, bus or interface move items in or out of it',
  own_hatch: 'GregTech lets items into it only through its own Coke Oven Hatch, which this layout does not place',
};

/** A multiblock's exported structure as it is, with no hatch chosen, or the unknown box with `structure_unknown`. */
function plainShape(pack: Pack, m: Machine, s: PlanStep, warnings: PlanWarning[]): Shape {
  const shape = structureCells(pack, m);
  if (shape !== null) return shape;
  warnings.push({ code: 'structure_unknown', stepId: s.id, text: `${m.name}: no exported structure, drawn as a 3×3×3 box — check its real size in game` });
  return unknownBoxCells(pack, m);
}

/** The sides of several steps one machine runs: the items any of them moves, every fluid of theirs, each once, sorted. */
function unionIo(ios: readonly StepIo[]): StepIo {
  const fluids = (of: (io: StepIo) => readonly StuffKey[]) => [...new Set(ios.flatMap(of))].sort(compareText);
  return { itemIn: ios.some((io) => io.itemIn), itemOut: ios.some((io) => io.itemOut), fluidIn: fluids((io) => io.fluidIn), fluidOut: fluids((io) => io.fluidOut) };
}

/**
 * One unit per machine still to build (`count − owned`) of every step that is not hand-crafted and runs on a real
 * machine, sorted by (depth, step id, index) — a sharing pool's machines once (plan 12, architecture §11 entry 39:
 * `PlanStep.pool`, through `machineGroups`, ruling P18): its first step (`pool.steps[0]`) gives the pool's `count − owned`
 * units, with `stepIds` every step of the pool, and its other steps none. Such a unit moves what its steps move (`io`:
 * the item sides any of them has, and their fluids, the same for every step of a pool, whose sharing key holds them),
 * runs at the largest EU/t of theirs, takes their programmed circuit (one: the key holds it) and stands at the smallest
 * depth of theirs; a multiblock's buses and fluid hatches are sized for the largest need of its steps (`hatchNeed`).
 * Machines missing from the pack are left out with a warning. With `primitive` (the default), a steam singleblock vents
 * (`vent`: `steam_machine` says where its steam goes, `steam_fluids` that its top takes no pipe) and a Bricked Blast
 * Furnace or a Coke Oven is run by hand (`manual`, with `manual_machine`): GT's steam machines take no EU
 * (`MTEBasicMachineBronze.isElectric` is false) and the furnace and the oven draw none.
 */
export function unitsFromPlan(pack: Pack, plan: Plan, opts: UnitOptions = {}): { units: Unit[]; warnings: PlanWarning[] } {
  const depths = stepDepths(plan);
  const groups = machineGroups(plan.steps)
    .map((steps) => ({ steps, depth: Math.min(...steps.map((s) => depths.get(s.id)!)) }))
    .sort((a, b) => a.depth - b.depth || compareText(a.steps[0]!.id, b.steps[0]!.id));
  const units: Unit[] = [];
  const warnings: PlanWarning[] = [];
  const nameOf = (k: StuffKey): string => plan.names?.[k] ?? pack.nameOf(k);
  const primitive = opts.primitive !== false;
  for (const { steps: group } of groups) {
    const s = group[0]!;
    const count = s.count - s.owned;
    if (s.handCraft || s.machine.mteId < 0 || count <= 0) continue;
    const m = pack.machines.get(s.machine.mteId);
    if (m === undefined) {
      warnings.push({ code: 'unknown_machine', stepId: s.id, text: `${s.machine.name} (#${s.machine.mteId}) is not in this recipe export` });
      continue;
    }
    const manual = primitive ? manualReasonOf(m) : null;
    const vent = primitive && m.kind === 'steam';
    // a crafting-table step on GT++'s Auto Workbench (crafting recipes never share one: their sharing key holds the
    // recipe), laid with its grid; a tool in the grid stops it after one craft (research machine-feeding §1.3.4)
    const bench = isAutoWorkbench(m) ? benchPlan(pack, s) : undefined;
    if (bench !== undefined && bench.tools.length > 0) {
      const product = stepProductName(pack, s);
      warnings.push({ code: 'bench_tool', stepId: s.id, text: `${m.name} cannot keep crafting ${product}: its grid holds ${joinNames(bench.tools.map(nameOf))}, `
        + `which every craft wears out or uses up, so it stops after one craft — craft ${product} by hand, or put a fresh one in for every craft` });
    }
    const stepped = group.length === 1 ? stepIo(s) : unionIo(group.map(stepIo));
    if (m.kind === 'steam') {
      // GT's steam machines take steam on every side but their front (`MTEBasicMachineBronze.isLiquidInput`)
      warnings.push({ code: 'steam_machine', stepId: s.id, text: vent
        ? `${m.name} runs on steam: pipe your steam into its back, the side away from the middle row (GregTech takes steam on every side but `
          + 'its front, and its top must stay clear to vent)'
        : `${m.name} runs on steam: connect a steam supply by hand` });
    }
    const fluids = [...new Set([...stepped.fluidIn, ...stepped.fluidOut])].sort(compareText);
    if (vent && fluids.length > 0) {
      warnings.push({ code: 'steam_fluids', stepId: s.id,
        text: `${m.name} vents steam through its top, so the line lays no pipe to it: move ${joinNames(fluids.map(nameOf))} by hand` });
    }
    if (manual !== null) {
      warnings.push({ code: 'manual_machine', stepId: s.id, text: `${m.name}: ${MANUAL_WHY[manual]}, so nothing of the line touches it: fill and empty it by hand` });
    }
    const multiblock = m.kind === 'multiblock';
    // the step's own circuit wins over the recipe's (ruling R5)
    const circuit = s.circuit ?? pack.recipeById.get(s.recipeId)?.meta.circuit;
    const euPerTick = Math.max(...group.map((g) => g.euPerTick));
    // a unit run by hand skips the hatch rules: it gets no hatch, no power and nothing to move (so `manual_machine` is
    // its only word on it, never `hatch_not_taken` as well); any other multiblock gets its hatches by its rule
    const made: MultiblockShape = manual !== null
      ? { shape: plainShape(pack, m, s, warnings), io: { itemIn: false, itemOut: false, fluidIn: [], fluidOut: [] }, electric: false }
      : multiblock ? multiblockShape(pack, m, s, stepped, circuit, hatchNeed(group), euPerTick, warnings)
      // a steam machine's top vents and a bench takes no fluid: neither gets a fluid port
      : { shape: singleblockShape(m, circuit), io: vent || bench !== undefined ? { ...stepped, fluidIn: [], fluidOut: [] } : stepped, electric: m.kind !== 'steam' };
    const { shape, io, electric } = made;
    for (let index = 0; index < count; index++) {
      units.push({
        stepId: s.id, index, mteId: m.mteId, name: m.name, tier: s.machine.tier, euPerTick, electric, multiblock,
        ...(group.length > 1 ? { stepIds: group.map((g) => g.id) } : {}),
        size: [...shape.size], cells: shape.cells.map(copyCell), air: shape.air.map((p): Vec3 => [...p]),
        io: { ...io, fluidIn: [...io.fluidIn], fluidOut: [...io.fluidOut] },
        ...(manual === null ? {} : { manual }), ...(vent ? { vent: true as const } : {}), ...(bench === undefined ? {} : { bench: structuredClone(bench) }),
      });
    }
  }
  return { units, warnings };
}

/**
 * Per block key of the exported structures: how many hatch cells replaced it (a casing, or an exported hatch another
 * tier took the place of), over all units; sorted by key. A hatch on a layer the layout added replaced nothing exported.
 */
export function replacedCasings(units: readonly Unit[]): BomLine[] {
  const counts = new Map<ItemKey, number>();
  for (const u of units) {
    for (const c of u.cells) if (c.role === 'hatch' && c.replaces !== undefined && c.added !== true) counts.set(c.replaces, (counts.get(c.replaces) ?? 0) + 1);
  }
  return [...counts].sort((a, b) => compareText(a[0], b[0]))
    .map(([key, amount]): BomLine => ({ key, amount, why: 'replaced by hatches', group: 'machines' }));
}

/**
 * Per block key: the casings of the layers the layout added to exported structures (a taller distillation tower), over
 * all units; sorted by key. Plan 2's build list holds the exported structure only.
 */
export function addedBlocks(units: readonly Unit[]): BomLine[] {
  const counts = new Map<ItemKey, number>();
  for (const u of units) for (const c of u.cells) if (c.added === true && c.role === 'casing') counts.set(blockKey(c.block), (counts.get(blockKey(c.block)) ?? 0) + 1);
  return [...counts].sort((a, b) => compareText(a[0], b[0]))
    .map(([key, amount]): BomLine => ({ key, amount, why: 'taller structure than its smallest', group: 'machines' }));
}

// ---- Placement ----

type Row = PlacedUnit['row'];

/** The side of a unit in `row` that faces the spine. */
function towardSpine(row: Row): number {
  return row === 'N' ? SOUTH : NORTH;
}

/** How far a unit stands back from the spine: one block for a unit run by hand, whose front row stays free. */
function standOff(u: Unit): number {
  return u.manual === undefined ? 0 : 1;
}

/**
 * Where canonical cell `c` of `u` lands: row S keeps the orientation (min corner `[x, 0, spineZ + 1]`, cell at + c);
 * row N turns 180° (min corner `[x, 0, spineZ − D]`, cell at + (W − 1 − cx, cy, D − 1 − cz)), so both fronts touch the spine.
 * A unit run by hand stands `standOff` further from the spine.
 */
function localCell(u: Unit, row: Row, x: number, spineZ: number, c: Vec3): Vec3 {
  const [w, , d] = u.size;
  const off = standOff(u);
  return row === 'S' ? [x + c[0], c[1], spineZ + 1 + off + c[2]] : [x + w - 1 - c[0], c[1], spineZ - d - off + (d - 1 - c[2])];
}

/** The side a hatch cell faces in `row`; none for a hatch the exported structure holds. */
function hatchFacing(c: UnitCell, row: Row): number | undefined {
  return c.face === undefined ? undefined : rowFace(c.face, row);
}

function unitPorts(u: Unit, row: Row, x: number, spineZ: number): UnitPorts {
  const toSpine = towardSpine(row);
  const away = OPPOSITE[toSpine]!;
  const at = (c: UnitCell) => localCell(u, row, x, spineZ, c.pos);
  if (!u.multiblock) {
    const machine = at(u.cells.find((c) => c.role === 'machine')!);
    if (u.vent === true) {
      // its output side is up, where it vents: it takes and gives its items on its spine side, which takes no cover (GT
      // lets only primitive covers onto a steam machine: `MTEBasicMachineBronze.allowCoverOnSide`), and no fluid pipe
      return { power: null, items: [step(machine, toSpine)], fluidIn: [], fluidOut: [], fluidInSides: [], fluidOutSides: [], itemFaces: [], fluidFaces: [] };
    }
    return {
      // a bench's power comes in at its front, which faces away from the spine
      power: u.electric ? step(machine, away) : null,
      items: [step(machine, toSpine)],
      fluidIn: u.io.fluidIn.length > 0 ? [step(machine, UP)] : [],
      fluidOut: u.io.fluidOut.length > 0 ? [step(machine, UP)] : [],
      fluidInSides: u.io.fluidIn.length > 0 ? [DOWN] : [],
      fluidOutSides: u.io.fluidOut.length > 0 ? [DOWN] : [],
      // a bench pushes its result out of its back by itself, and takes no cover there
      itemFaces: u.io.itemOut && u.bench === undefined ? [{ pos: machine, side: toSpine }] : [],
      fluidFaces: u.io.fluidOut.length > 0 ? [{ pos: machine, side: UP }] : [],
    };
  }
  const sideOf = (c: UnitCell): number => rowFace(c.face!, row);
  const portOf = (c: UnitCell): Vec3 => step(at(c), sideOf(c));
  const energy = u.cells.find((c) => c.hatch === 'energy' && c.face !== undefined);
  // an item port is on the spine's column: on the spine, or above it in front of a bus GT takes only higher up
  const items: Vec3[] = [];
  for (const kind of ['input_bus', 'output_bus'] as const) {
    for (const c of u.cells) {
      if (c.hatch !== kind || c.face === undefined) continue;
      const port = portOf(c);
      if (port[2] === spineZ && !items.some((p) => samePos(p, port))) items.push(port);
    }
  }
  // fluid hatches in `io` order: the unit's io holds only the fluids a hatch was placed for
  const hatchesOf = (kind: 'input_hatch' | 'output_hatch', keys: readonly StuffKey[]): UnitCell[] =>
    keys.flatMap((key) => u.cells.filter((c) => c.hatch === kind && c.fluid === key && c.face !== undefined).slice(0, 1));
  const inputs = hatchesOf('input_hatch', u.io.fluidIn);
  const outputs = hatchesOf('output_hatch', u.io.fluidOut);
  return {
    power: energy === undefined ? null : portOf(energy),
    items,
    fluidIn: inputs.map(portOf),
    fluidOut: outputs.map(portOf),
    fluidInSides: inputs.map((c) => OPPOSITE[sideOf(c)]!),
    fluidOutSides: outputs.map((c) => OPPOSITE[sideOf(c)]!),
    itemFaces: u.cells.filter((c) => c.hatch === 'output_bus' && c.face !== undefined).map((c) => ({ pos: at(c), side: sideOf(c) })),
    fluidFaces: outputs.map((c) => ({ pos: at(c), side: sideOf(c) })),
  };
}

/**
 * The cells beside a unit's own columns that it keeps for itself, canonical: what its hatches face there (their ports)
 * and its reserved air there (a muffler's front).
 */
function besideCells(u: Unit): Vec3[] {
  const w = u.size[0];
  const out: Vec3[] = [];
  for (const c of u.cells) {
    if (c.role !== 'hatch' || c.face === undefined) continue;
    const p = step(c.pos, c.face);
    if (p[0] < 0 || p[0] >= w) out.push(p);
  }
  for (const a of u.air) if (a[0] < 0 || a[0] >= w) out.push([...a]);
  return out;
}

/**
 * A singleblock's front: toward the power head (local west). GT 5.09.54 never lets a basic machine's front face up or
 * down (`MTEBasicMachine.isValidMainFacing`; `setMainFacing` refuses such a side), the spine side is its output side, the
 * side away from the spine its power port (energy never enters the front: `isInputFacing`), and its top may be the cell
 * its fluids use; so a side along the row is left, which GT moves neither items nor fluids through.
 */
function singleblockMainFacing(): number {
  return WEST;
}

/**
 * `units` with the electric ones stably sorted by `feedTier`, lowest first, in the places the electric units had; the
 * others (steam units, which have no feed tier) keep theirs.
 */
function lowestFeedFirst(units: readonly Unit[], feedTier: (u: Unit) => number | null): Unit[] {
  const electric = units.filter((u) => feedTier(u) !== null).sort((a, b) => feedTier(a)! - feedTier(b)!);
  let next = 0;
  return units.map((u) => (feedTier(u) === null ? u : electric[next++]!));
}

/**
 * Two rows along x facing a spine at z = `spineZ`, after a power head of `headWidth` columns. Units are placed in the
 * order given (flow order). Each goes to the shorter row (N on a tie), one column apart from a multiblock neighbour, and
 * moves along until its item ports are `portSpacing` cells apart from every earlier unit's (0: may share; 1: own cell;
 * 2: not even neighbouring).
 * With `supplyTier`, the electric units are placed by feed tier (`min(tier, supplyTier)`), lowest first and each tier in
 * flow order (`lowestFeedFirst`): the lowest feed tier stands next to the head, whose last column is that tier's run, so
 * a tier's cable tree never has to get past a higher tier's machines, or the tree that crosses the spine to them, to
 * reach its own (Task 6 grows the trees lowest first). Units fed at different tiers never stand side by side, and a
 * unit fed at another tier than the head's last column keeps a column away from it, so cables of two tiers never have
 * to touch (spec §3.5): their power ports stay at least two cells apart.
 * A unit run by hand (`Unit.manual`) comes after all the others, so nothing of the line has to pass it and it stands
 * near the tail chests; it stands one block back from the spine, its front row kept empty (`reserved`), a column from
 * the power head and off every cell its neighbour keeps beside it (a side port, whose pipe would touch it), so nothing
 * of the line touches it (the routing keeps off the cells around it: `handRunSurroundings`) and its controller is in
 * reach. A venting steam unit (`Unit.vent`) faces the spine with its output side up (`PlacedUnit.outputSide`), the cell
 * above it (its vent: GT's `MTEBasicMachineBronze.allowToCheckRecipe` waits while a cover or a block with a hit box is
 * there) and the one behind it (its steam inlet) kept empty.
 */
export function placeUnits(units: readonly Unit[], opts: { headWidth: number; portSpacing: 0 | 1 | 2; supplyTier?: number }): Placement {
  const { headWidth, portSpacing, supplyTier } = opts;
  const cursor: Record<Row, number> = { N: headWidth, S: headWidth };
  const previous: Record<Row, Unit | null> = { N: null, S: null };
  const feedTier = (u: Unit): number | null => (supplyTier === undefined || !u.electric ? null : Math.min(u.tier, supplyTier));
  // without `supplyTier`: flow order; the units run by hand last
  const ordered = [...lowestFeedFirst(units.filter((u) => u.manual === undefined), feedTier), ...units.filter((u) => u.manual !== undefined)];
  const feeds = ordered.map(feedTier).filter((t): t is number => t !== null);
  // the head's last column is the run of the lowest feed tier (Task 6 lays one run per fed tier, lowest last)
  const headTier = headWidth > 0 && feeds.length > 0 ? Math.min(...feeds) : null;
  /** The feed tier the next unit of a row stands beside: the head's, the previous unit's, or none (a steam unit). */
  const besideTier: Record<Row, number | null> = { N: headTier, S: headTier };
  const claimed = new Set<number>();
  const near = (px: number) => {
    for (let d = -(portSpacing - 1); d <= portSpacing - 1; d++) if (claimed.has(px + d)) return true;
    return false;
  };
  // item ports lie on the spine's column, so their x does not depend on where the spine ends up
  const portXs = (u: Unit, row: Row, x: number) => unitPorts(u, row, x, 0).items.map((p) => p[0]);
  // the cells beside a unit's columns it keeps (side ports, a muffler's air), in the row's own z (spine at 0)
  const beside = (u: Unit, row: Row, x: number) => besideCells(u).map((p) => localCell(u, row, x, 0, p));
  /** Per row: the cells the last unit keeps beside its columns, and the first column past them and the unit. */
  const kept: Record<Row, Set<string>> = { N: new Set(), S: new Set() };
  const reach: Record<Row, number> = { N: headWidth, S: headWidth };
  const fits = (u: Unit, row: Row, x: number) => beside(u, row, x).every((p) => p[0] >= headWidth && !kept[row].has(posKey(p)));
  // nothing the neighbour keeps beside it may touch a unit run by hand: no cell beside one of its own is one of those
  const clear = (u: Unit, row: Row, x: number) => u.manual === undefined
    || !u.cells.some((c) => DIRS.some((_, side) => kept[row].has(posKey(step(localCell(u, row, x, 0, c.pos), side)))));
  const slots: Array<{ u: Unit; row: Row; x: number }> = [];
  for (const u of ordered) {
    const row: Row = cursor.N <= cursor.S ? 'N' : 'S';
    const before = previous[row];
    const tier = feedTier(u);
    const otherTier = tier !== null && besideTier[row] !== null && tier !== besideTier[row];
    // a unit run by hand keeps a column from the power head too, whose last column is a cable run (Task 6)
    const besideHead = before === null && u.manual !== undefined && supplyTier !== undefined;
    let x = cursor[row] + ((before !== null && (u.multiblock || before.multiblock)) || otherTier || besideHead ? 1 : 0);
    // a port or air cell beside the unit stays off the power head and off the cells its neighbour keeps
    while ((portSpacing > 0 && portXs(u, row, x).some(near)) || !fits(u, row, x) || !clear(u, row, x)) x += 1;
    for (const px of portXs(u, row, x)) claimed.add(px);
    cursor[row] = x + u.size[0];
    const own = beside(u, row, x);
    kept[row] = new Set(own.map(posKey));
    reach[row] = own.reduce((r, p) => Math.max(r, p[0] + 1), cursor[row]);
    previous[row] = u;
    besideTier[row] = tier;
    slots.push({ u, row, x });
  }

  const deepest = (row: Row) => slots.reduce((d, s) => (s.row === row ? Math.max(d, s.u.size[2] + standOff(s.u)) : d), 0);
  const dN = deepest('N'), dS = deepest('S');
  const spineZ = 1 + dN;
  // the tail column stays clear of the cells the last unit of each row keeps beside it
  const tailX = Math.max(reach.N, reach.S);

  const placed: PlacedUnit[] = [];
  const blocks: LocalBlock[] = [];
  const reserved: Vec3[] = [];
  for (const { u, row, x } of slots) {
    const toSpine = towardSpine(row);
    // a singleblock's output side faces the spine (its covers and inputs go there), its front elsewhere (GT keeps the
    // two apart); a venting steam unit's output side faces up; a bench has only its front, turned away from the spine,
    // so its back, its output face, meets the spine
    const mainFacing = u.multiblock || u.bench !== undefined ? undefined : singleblockMainFacing();
    for (const c of u.cells) {
      const facing = c.role === 'machine' ? (u.vent === true ? UP : u.bench !== undefined ? OPPOSITE[toSpine]! : toSpine)
        : c.role === 'hatch' ? hatchFacing(c, row) : undefined;
      blocks.push({
        pos: localCell(u, row, x, spineZ, c.pos), block: { ...c.block }, role: c.role, ...(facing === undefined ? {} : { facing }),
        ...(c.role === 'machine' && mainFacing !== undefined ? { mainFacing } : {}),
        stepId: u.stepId, ...(u.stepIds === undefined ? {} : { stepIds: [...u.stepIds] }),
        // a hatch the exported structure holds is no hatch the line chose (`UnitCell.exported`)
        label: c.label, ...(c.item === undefined ? {} : { item: c.item }), ...(c.hatch === undefined || c.exported === true ? {} : { hatch: c.hatch }),
        ...(c.config === undefined ? {} : { config: { ...c.config } }),
        // a bench's grid, mode and button: the configure step words them (architecture §11 entry 51's `FeedSpec.bench`)
        ...(c.role === 'machine' && u.bench !== undefined ? { feed: { bench: structuredClone(u.bench.spec) } } : {}),
      });
    }
    for (const a of u.air) reserved.push(localCell(u, row, x, spineZ, a));
    if (u.manual !== undefined) {
      // its front row, between it and the spine: you fill and empty it from there, and nothing of the line touches it
      const z = row === 'S' ? spineZ + 1 : spineZ - 1;
      for (let cx = 0; cx < u.size[0]; cx++) for (let y = 0; y < u.size[1]; y++) reserved.push([x + cx, y, z]);
    }
    if (u.vent === true) {
      const machine = localCell(u, row, x, spineZ, u.cells.find((c) => c.role === 'machine')!.pos);
      reserved.push(step(machine, UP), step(machine, OPPOSITE[toSpine]!));                  // its vent and its steam inlet
    }
    const off = standOff(u);
    const at: Vec3 = row === 'S' ? [x, 0, spineZ + 1 + off] : [x, 0, spineZ - u.size[2] - off];
    placed.push({
      ...u, row, at, facing: toSpine, ...(mainFacing === undefined ? {} : { mainFacing }), ...(u.vent === true ? { outputSide: UP } : {}),
      ports: unitPorts(u, row, x, spineZ),
    });
  }
  blocks.sort((a, b) => comparePos(a.pos, b.pos));
  reserved.sort(comparePos);
  // the box holds every cell kept empty too (a steam vent above a singleblock), so the site checks it is clear
  const height = reserved.reduce((h, p) => Math.max(h, p[1] + 1), units.reduce((h, u) => Math.max(h, u.size[1]), 1));
  const size: Vec3 = [tailX + 1, height, dN + dS + 3];
  return { units: placed, size, spineZ, firstX: headWidth, tailX, blocks, reserved };
}

/**
 * The cells face to face with a unit run by hand (`Unit.manual`) that are none of its own, sorted by x, y, z: nothing
 * of the line takes them (the power trees and fluid pipes keep off them, and so does the EnderIO fluid conduit), so
 * nothing of the line touches its casing.
 */
export function handRunSurroundings(placement: Placement): Vec3[] {
  const hand = new Set(placement.units.filter((u) => u.manual !== undefined).map((u) => u.stepId));
  if (hand.size === 0) return [];
  const own = placement.blocks.filter((b) => b.stepId !== undefined && hand.has(b.stepId));
  const mine = new Set(own.map((b) => posKey(b.pos)));
  const around = new Map<string, Vec3>();
  for (const b of own) {
    for (let side = 0; side < DIRS.length; side++) {
      const p = step(b.pos, side);
      if (!mine.has(posKey(p)) && !around.has(posKey(p))) around.set(posKey(p), p);
    }
  }
  return [...around.values()].sort(comparePos);
}

/**
 * The plan steps a unit's machine runs (plan 12, architecture §11 entry 39): every step of its sharing pool
 * (`Unit.stepIds`), else its own step.
 */
export function unitSteps(u: Pick<Unit, 'stepId' | 'stepIds'>): string[] {
  return u.stepIds ?? [u.stepId];
}

/**
 * The step ids whose units the line's logistics serve, in unit order: every step of every unit in the placement
 * (`unitSteps`, so a shared machine's steps all count) but those run by hand (`Unit.manual`), whose goods cross the line's
 * edge like those of a step it does not place.
 */
export function placedStepIds(placement: Placement): Set<string> {
  return new Set(placement.units.filter((u) => u.manual === undefined).flatMap(unitSteps));
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
