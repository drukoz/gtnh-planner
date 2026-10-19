// Internal routing of a line (Plan 5 Task 6; spec §3.5 never overvolt, §3.6 shared runs; gt-mechanics §3.3, §3.6):
// the power head — one straight cable run per voltage tier along z, with step-down transformer banks between
// neighbouring runs — then one cable tree per feed tier from its run to the power port of every machine of that tier,
// then one GT fluid-pipe tree per fluid with a pump cover, sized to its share, on every face that makes the fluid
// (unless that face's port carries another fluid's pipe: then no pump, and a `fluid_port_shared` warning).
// A cable only ever links to its own tier's run, so no machine receives more than `V[its tier]`. Every network keeps
// off the cells other networks connect to (their ports and tail roots), so one network never takes another's cell.
// All routes use the deterministic A* router (Task 2); every order and tie-break is fixed.

import { tierName, V } from '../../shared/gt/tiers.ts';
import type { StuffKey } from '../../shared/keys.ts';
import { fmtInt, joinNames } from '../../shared/layout/format.ts';
import { posKey, step, type Vec3 } from '../../shared/layout/geometry.ts';
import { FACES } from '../../shared/types/assets.ts';
import type { Machine, Pack } from '../../shared/types/pack.ts';
import type { Plan, PlanWarning } from '../../shared/types/plan.ts';
import type { HostCover, LocalBlock, Placement, PlacedUnit } from './arrange.ts';
import { growTree, linkBits, type PathBounds, type PathOptions } from './path.ts';
import { coverRateWarning, machineRef, pickCable, pickFluidPipe, pickPump, pickTransformer, type Parts } from './parts.ts';
import type { Stages } from './power.ts';

// ---- Types ----

export interface FluidNet {
  key: StuffKey; name: string; litresPerSecond: number; producers: Vec3[]; consumers: Vec3[]; atTail: boolean;
  faces: Array<{ pos: Vec3; side: number; stepId: string; rate: number /* L/s this face must move */ }>;
}

export interface InternalInput {
  pack: Pack; parts: Parts; placement: Placement; occupied: readonly LocalBlock[]; stages: Stages | null; fluids: readonly FluidNet[]; tailFluidY: number;
  groupTier: number /* plan.tier: the highest cover tier the group can build */;
}

export interface InternalResult {
  /** Sorted by x, then y, then z. */
  blocks: LocalBlock[];
  /** Pump covers, for the producing machines (Task 11 attaches them). */
  covers: HostCover[];
  /** Cells of the supply-tier run (x = 0), where the power hookup lands. */
  supplyRun: Vec3[];
  /** Tier descending. */
  cables: Array<{ tier: number; cable: Machine; cells: number }>;
  fluidPipes: Array<{ key: StuffKey; name: string; pipe: Machine; cells: number }>;
  warnings: PlanWarning[];
}

// ---- Small helpers ----

const DOWN = 0, WEST = 4;

function compareText(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0;
}

function comparePos(a: Vec3, b: Vec3): number {
  return a[0] - b[0] || a[1] - b[1] || a[2] - b[2];
}

/** Each position once, sorted by x, y, z. */
function uniquePositions(ps: readonly Vec3[]): Vec3[] {
  const byKey = new Map<string, Vec3>();
  for (const p of ps) if (!byKey.has(posKey(p))) byKey.set(posKey(p), [...p]);
  return [...byKey.values()].sort(comparePos);
}

/** Warnings in the order first raised, each code + step + text once. */
class WarningList {
  readonly list: PlanWarning[] = [];
  private readonly seen = new Set<string>();

  add(w: PlanWarning): void {
    const key = `${w.code}\n${w.stepId ?? ''}\n${w.text}`;
    if (this.seen.has(key)) return;
    this.seen.add(key);
    this.list.push(w);
  }
}

// ---- Head geometry ----

/** Columns of the power head: the supply run, then one bank column and one run per transformer stage. */
export function headWidthFor(stages: Stages | null): number {
  return stages === null ? 1 : 1 + 2 * stages.stages.length;
}

/** The x of the cable run of `tier`: the supply run at x = 0, each lower tier two columns further on. */
export function runX(supplyTier: number, tier: number): number {
  return 2 * (supplyTier - tier);
}

// ---- Fluid nets ----

/** The port of `u` for fluid `key`: a multiblock has one per hatch, in `keys` order; a singleblock one for all. */
function fluidPortOf<T>(u: PlacedUnit, keys: readonly StuffKey[], ports: readonly T[], key: StuffKey): T | null {
  const i = keys.indexOf(key);
  if (i === -1) return null;
  return (u.multiblock ? ports[i] : ports[0]) ?? null;
}

/**
 * One net per fluid any placed unit takes or makes, sorted by key. A net is `atTail` when the fluid also enters or
 * leaves the line (a flow from `raw`, to `out`/`sink`, or touching a step with no placed unit). Each producing face
 * must move its step's outgoing flows of the fluid split evenly over the step's machines.
 */
export function fluidNets(pack: Pack, plan: Plan, placement: Placement): FluidNet[] {
  const placed = new Set(placement.units.map((u) => u.stepId));
  const counts = new Map(plan.steps.map((s) => [s.id, s.count]));
  const keys = new Set<StuffKey>();
  for (const u of placement.units) for (const key of [...u.io.fluidIn, ...u.io.fluidOut]) keys.add(key);
  return [...keys].sort(compareText).map((key): FluidNet => {
    const flows = plan.flows.filter((f) => f.key === key);
    const stepRate = (stepId: string) =>
      flows.reduce((sum, f) => (f.from === stepId ? sum + f.perSecond : sum), 0) / Math.max(1, counts.get(stepId) ?? 1);
    const producers: Vec3[] = [];
    const consumers: Vec3[] = [];
    const faces: FluidNet['faces'] = [];
    for (const u of placement.units) {
      const out = fluidPortOf(u, u.io.fluidOut, u.ports.fluidOut, key);
      if (out !== null) producers.push(out);
      const into = fluidPortOf(u, u.io.fluidIn, u.ports.fluidIn, key);
      if (into !== null) consumers.push(into);
      const face = fluidPortOf(u, u.io.fluidOut, u.ports.fluidFaces, key);
      if (face !== null) faces.push({ pos: [...face.pos], side: face.side, stepId: u.stepId, rate: stepRate(u.stepId) });
    }
    faces.sort((a, b) => comparePos(a.pos, b.pos) || a.side - b.side);
    return {
      key, name: plan.names?.[key] ?? pack.nameOf(key), litresPerSecond: flows.reduce((sum, f) => sum + f.perSecond, 0),
      producers: uniquePositions(producers), consumers: uniquePositions(consumers),
      atTail: flows.some((f) => !placed.has(f.from) || !placed.has(f.to)), faces,
    };
  });
}

// ---- Routing ----

interface Run { tier: number; cells: Vec3[]; cable: Machine | null }
interface Port { pos: Vec3; unit: PlacedUnit }

/** The cells the routing builds on, the blocks and links laid so far, and the warnings. */
class Grid {
  readonly blocks: LocalBlock[] = [];
  readonly links: Array<[Vec3, Vec3]> = [];
  readonly warnings = new WarningList();
  private readonly taken = new Set<string>();

  constructor(input: InternalInput) {
    for (const b of input.placement.blocks) this.taken.add(posKey(b.pos));
    for (const b of input.occupied) this.taken.add(posKey(b.pos));
    for (const p of input.placement.reserved) this.taken.add(posKey(p));
  }

  isTaken(p: Vec3): boolean {
    return this.taken.has(posKey(p));
  }

  take(p: Vec3): void {
    this.taken.add(posKey(p));
  }

  /** Lays a block of `m` (role `cable`, `transformer` or `pipe`) and takes its cell. */
  lay(pos: Vec3, m: Machine, role: 'cable' | 'transformer' | 'pipe', label: string, facing?: number): void {
    this.blocks.push({ pos: [...pos], block: machineRef(m), role, ...(facing === undefined ? {} : { facing }), label, item: m.itemKey });
    this.take(pos);
  }

  /** The blocks sorted by x, y, z, each with the connection bits of its links. */
  finish(): LocalBlock[] {
    const bits = linkBits(this.links);
    return this.blocks
      .map((b): LocalBlock => {
        const connections = bits.get(posKey(b.pos));
        return connections === undefined ? b : { ...b, connections };
      })
      .sort((a, b) => comparePos(a.pos, b.pos));
  }
}

/**
 * The runs (supply first, then each stage's lower tier) and the transformer banks between them. A run's cable is
 * rated for its tier's volts and the amps it carries: the supply amps on the supply run, a stage's amps out below it.
 */
function layHead(input: InternalInput, stages: Stages, grid: Grid): Run[] {
  const { pack, placement } = input;
  const length = placement.size[2];
  const supply = stages.supplyTier;
  const needs = [{ tier: supply, amps: stages.supplyAmps }, ...stages.stages.map((s) => ({ tier: s.toTier, amps: s.ampsOut }))];
  const runs = needs.map(({ tier, amps }): Run => {
    const x = runX(supply, tier);
    const cells = Array.from({ length }, (_, z): Vec3 => [x, 0, z]);
    for (const c of cells) grid.take(c);
    const pick = pickCable(pack, { volts: V[tier]!, amps });
    if (pick === null) {
      grid.warnings.add({ code: 'no_cable', text: `No cable for ${tierName(tier)} in this export` });
      return { tier, cells, cable: null };
    }
    const { cable, ampsShort } = pick;
    if (ampsShort) {
      grid.warnings.add({ code: 'cable_amps',
        text: `No cable carries ${fmtInt(amps)} A at ${tierName(tier)}: run ${Math.ceil(amps / cable.cable!.amps)} parallel ${cable.name} lines` });
    }
    for (const c of cells) grid.lay(c, cable, 'cable', cable.name);
    for (let z = 0; z + 1 < length; z++) grid.links.push([cells[z]!, cells[z + 1]!]);
    return { tier, cells, cable };
  });
  const runOf = new Map(runs.map((r) => [r.tier, r]));
  for (const stage of stages.stages) {
    const transformer = pickTransformer(pack, stage.toTier);
    if (transformer === null) {
      grid.warnings.add({ code: 'no_transformer', text: `No ${tierName(stage.toTier)} transformer in this export` });
      continue;
    }
    const placed = Math.min(stage.count, length);
    if (stage.count > placed) grid.warnings.add({ code: 'transformer_bank', text: `Put ${stage.count - placed} more ${transformer.name} beside the bank` });
    // centred on the spine, shifted back inside the line when the rows are uneven
    const first = Math.min(Math.max(placement.spineZ - Math.floor(placed / 2), 0), length - placed);
    const x = runX(supply, stage.toTier) - 1;
    const higher = runOf.get(stage.fromTier), lower = runOf.get(stage.toTier);
    for (let j = 0; j < placed; j++) {
      const pos: Vec3 = [x, 0, first + j];
      // facing west: the front (step-down input) touches the higher run, the east face feeds the lower one
      grid.lay(pos, transformer, 'transformer', transformer.name, WEST);
      if (higher?.cable) grid.links.push([pos, [x - 1, 0, pos[2]]]);
      if (lower?.cable) grid.links.push([pos, [x + 1, 0, pos[2]]]);
    }
  }
  return runs;
}

/** `power_tier_low`, one per unit tier above the supply tier (highest first), naming the machines of that tier. */
function warnUnderVoltage(units: readonly PlacedUnit[], supply: number, grid: Grid): void {
  const tiers = [...new Set(units.filter((u) => u.tier > supply).map((u) => u.tier))].sort((a, b) => b - a);
  for (const tier of tiers) {
    const atTier = units.filter((u) => u.tier === tier);
    const names = [...new Set(atTier.map((u) => u.name))];
    grid.warnings.add({ code: 'power_tier_low', stepId: atTier[0]!.stepId,
      text: `${joinNames(names)} ${names.length === 1 ? 'needs' : 'need'} ${tierName(tier)} power but the line gets ${tierName(supply)}: `
        + `it will run short — add a step-up transformer or a generator at ${tierName(tier)}` });
  }
}

/**
 * One cable tree per feed tier, highest first: from the tier's run to the power port of every electric unit fed at
 * that tier (`min(unit tier, supply)`), with the run's cable. Ports of other feed tiers and `keepOff` cells are never
 * crossed. Returns the cable cells laid per tier, run included.
 */
function wireUnits(input: InternalInput, stages: Stages, runs: readonly Run[], keepOff: ReadonlySet<string>, grid: Grid): Map<number, number> {
  const { placement } = input;
  const [w, h, l] = placement.size;
  const supply = stages.supplyTier;
  const electric = placement.units.filter((u) => u.electric);
  warnUnderVoltage(electric, supply, grid);
  const portsByTier = new Map<number, Port[]>();
  const portTier = new Map<string, number>();
  for (const u of electric) {
    if (u.ports.power === null) continue;                                              // Task 5 warned hatch_cells_short
    const tier = Math.min(u.tier, supply);
    const list = portsByTier.get(tier) ?? [];
    list.push({ pos: u.ports.power, unit: u });
    portsByTier.set(tier, list);
    portTier.set(posKey(u.ports.power), tier);
  }
  const bounds: PathBounds = { min: [0, 0, 0], max: [w - 1, h, l - 1] };          // up to H: runs may pass over singleblocks
  const unwired = (unit: PlacedUnit) =>
    grid.warnings.add({ code: 'route_failed', stepId: unit.stepId, text: `Could not wire ${unit.name} inside the line — connect it by hand` });
  const cells = new Map<number, number>();
  for (const run of runs) {
    if (run.cable === null) continue;                                                  // its machines are reported below
    const ports = (portsByTier.get(run.tier) ?? []).sort((a, b) => comparePos(a.pos, b.pos));
    portsByTier.delete(run.tier);
    const opts: PathOptions = {
      bounds,
      passable: (p) => {
        const key = posKey(p);
        const tier = portTier.get(key);
        return !grid.isTaken(p) && !keepOff.has(key) && (tier === undefined || tier === run.tier);
      },
    };
    const tree = ports.length === 0 ? { cells: [], links: [], unreached: [] } : growTree(run.cells, ports.map((p) => p.pos), opts);
    for (const c of tree.cells) grid.lay(c, run.cable, 'cable', run.cable.name);
    grid.links.push(...tree.links);
    const unreached = new Set(tree.unreached.map(posKey));
    for (const { pos, unit } of ports) {
      if (unreached.has(posKey(pos))) unwired(unit);
      else grid.links.push([pos, step(pos, unit.facing)]);                             // into the machine or energy hatch
    }
    cells.set(run.tier, run.cells.length + tree.cells.length);
  }
  // a feed tier without a laid run (no cable for it, or no run because its machines draw nothing) is never wired
  // from another tier's run
  for (const ports of portsByTier.values()) for (const { unit } of ports) unwired(unit);
  return cells;
}

interface FluidPlan { net: FluidNet; ports: Vec3[]; tailRoot: Vec3 | null }

/** Every net's ports and, for a net that enters or leaves the line, its root above the tail. */
function planFluids(input: InternalInput): FluidPlan[] {
  const { placement } = input;
  let tail = 0;
  return [...input.fluids].sort((a, b) => compareText(a.key, b.key)).map((net): FluidPlan => ({
    net, ports: uniquePositions([...net.producers, ...net.consumers]),
    tailRoot: net.atTail ? [placement.tailX, input.tailFluidY + tail++, placement.spineZ] : null,
  }));
}

/** The cells a net connects to: its ports and its tail root. */
function fluidCellsOf(plan: FluidPlan): Vec3[] {
  return plan.tailRoot === null ? plan.ports : [...plan.ports, plan.tailRoot];
}

/**
 * One pipe tree per fluid, in key order: from the tail root (a fluid that enters or leaves the line) or the first free
 * producer port to every other port of the net. Port cells link down into their machine or hatch. The box reaches up
 * to the highest tail root, which may sit above the units. `pipeAt` records which net's fluid each laid pipe cell
 * carries.
 */
function pipeFluids(input: InternalInput, plans: readonly FluidPlan[], fluidCells: ReadonlySet<string>, powerPorts: ReadonlySet<string>,
  pipeAt: Map<string, StuffKey>, grid: Grid): InternalResult['fluidPipes'] {
  const { pack, placement } = input;
  const [w, h, l] = placement.size;
  const top = plans.reduce((y, p) => Math.max(y, p.tailRoot?.[1] ?? 0), h);
  const bounds: PathBounds = { min: [0, 0, 0], max: [w - 1, top, l - 1] };
  const inside = (p: Vec3) => p.every((v, i) => v >= bounds.min[i]! && v <= bounds.max[i]!);
  const portUnit = new Map<string, PlacedUnit>();
  for (const u of placement.units) for (const p of [...u.ports.fluidIn, ...u.ports.fluidOut]) if (!portUnit.has(posKey(p))) portUnit.set(posKey(p), u);
  const pipes: InternalResult['fluidPipes'] = [];
  for (const plan of plans) {
    const { net } = plan;
    const fail = (ports: readonly Vec3[]) => {
      for (const p of ports) {
        const unit = portUnit.get(posKey(p));
        if (unit !== undefined) grid.warnings.add({ code: 'route_failed', stepId: unit.stepId, text: `Could not lay the ${net.name} pipe to ${unit.name} — connect it by hand` });
      }
    };
    const pipe = pickFluidPipe(pack, net.litresPerSecond);
    if (pipe === null) {
      grid.warnings.add({ code: 'no_pipe', text: `No GT fluid pipe in this export: connect ${net.name} by hand` });
      continue;
    }
    const own = new Set(fluidCellsOf(plan).map(posKey));
    const passable = (p: Vec3) => {
      const key = posKey(p);
      // a cell this net shares with another (one port above a singleblock) is free until either lays a pipe on it
      return !grid.isTaken(p) && !powerPorts.has(key) && (own.has(key) || !fluidCells.has(key));
    };
    const candidates = plan.tailRoot !== null ? [plan.tailRoot] : [...net.producers, ...net.consumers].sort(comparePos);
    const root = candidates.find((p) => inside(p) && passable(p));
    if (root === undefined) {
      fail(plan.ports);
      continue;
    }
    const others = plan.ports.filter((p) => posKey(p) !== posKey(root));
    const tree = others.length === 0 ? { cells: [], links: [], unreached: [] } : growTree([root], others, { bounds, passable });
    const label = `${pipe.name} (${net.name})`;
    for (const c of [root, ...tree.cells]) {
      grid.lay(c, pipe, 'pipe', label);
      pipeAt.set(posKey(c), net.key);
    }
    grid.links.push(...tree.links);
    const unreached = new Set(tree.unreached.map(posKey));
    for (const p of plan.ports) if (!unreached.has(posKey(p))) grid.links.push([p, step(p, DOWN)]);
    fail(tree.unreached);
    pipes.push({ key: net.key, name: net.name, pipe, cells: 1 + tree.cells.length });
  }
  return pipes;
}

/**
 * A pump cover on every producing face, sized to the litres it must move (a face two nets share moves both), sorted by
 * pos, then face; `cover_rate` once per step when no pump up to the group's tier moves that much. A face whose cell
 * (the port it opens onto) holds the pipe of one fluid while the face also exports another gets no pump, since the
 * pump would push that other fluid into the pipe (a singleblock's one top port, taken by another net): it gets
 * `fluid_port_shared` once per step instead, and no `cover_rate` check.
 */
function pumpCovers(input: InternalInput, plans: readonly FluidPlan[], pipeAt: ReadonlyMap<string, StuffKey>, grid: Grid): HostCover[] {
  const { pack, placement, groupTier } = input;
  // `keys`: the fluids the face exports, in key order (the plans are)
  const faces = new Map<string, { pos: Vec3; side: number; stepId: string; rate: number; keys: StuffKey[] }>();
  for (const { net } of plans) {
    for (const f of net.faces) {
      const key = `${posKey(f.pos)}/${f.side}`;
      const known = faces.get(key);
      if (known === undefined) faces.set(key, { pos: [...f.pos], side: f.side, stepId: f.stepId, rate: f.rate, keys: [net.key] });
      else {
        known.rate += f.rate;
        known.keys.push(net.key);
      }
    }
  }
  const names = new Map(placement.units.map((u) => [u.stepId, u.name]));
  const fluidNames = new Map(plans.map(({ net }) => [net.key, net.name]));
  const fluidName = (key: StuffKey) => fluidNames.get(key) ?? key;
  const warned = new Set<string>();
  const sharedWarned = new Set<string>();
  const covers: HostCover[] = [];
  for (const f of [...faces.values()].sort((a, b) => comparePos(a.pos, b.pos) || a.side - b.side)) {
    const piped = pipeAt.get(posKey(step(f.pos, f.side)));
    if (piped !== undefined && f.keys.some((k) => k !== piped)) {
      if (!sharedWarned.has(f.stepId)) {
        sharedWarned.add(f.stepId);
        const others = f.keys.filter((k) => k !== piped).map(fluidName);
        grid.warnings.add({ code: 'fluid_port_shared', stepId: f.stepId,
          text: `${names.get(f.stepId) ?? f.stepId}: the ${fluidName(piped)} pipe uses the cell above it, so a pump there would push `
            + `${joinNames(others)} into that pipe — no pump placed; pump ${joinNames(f.keys.map(fluidName))} out of another side by hand` });
      }
      continue;
    }
    const pick = pickPump(pack, f.rate, groupTier);
    covers.push({ pos: f.pos, cover: { face: FACES[f.side]!, item: pick.key, settings: { mode: 'export', allowInput: false, rate: f.rate, unit: 'L/s' } } });
    if (pick.short && !warned.has(f.stepId)) {
      warned.add(f.stepId);
      grid.warnings.add(coverRateWarning('pump', pick, f.rate, groupTier, names.get(f.stepId) ?? f.stepId, f.stepId));
    }
  }
  return covers;
}

/**
 * The power head, the cable trees per feed tier and the fluid-pipe trees, on cells inside the line that no unit, mode
 * block, reserved air cell or earlier route uses. Without `stages` (no electric unit) nothing is wired.
 */
export function routeInternal(input: InternalInput): InternalResult {
  const { placement, stages } = input;
  const grid = new Grid(input);
  const fluids = planFluids(input);
  const fluidCells = new Set(fluids.flatMap(fluidCellsOf).map(posKey));
  const powerPorts = new Set(placement.units.flatMap((u) => (u.electric && u.ports.power !== null ? [posKey(u.ports.power)] : [])));

  let supplyRun: Vec3[] = [];
  const cables: InternalResult['cables'] = [];
  if (stages !== null) {
    const runs = layHead(input, stages, grid);
    const cells = wireUnits(input, stages, runs, fluidCells, grid);
    supplyRun = runs[0]!.cells.map((c): Vec3 => [...c]);
    for (const run of runs) if (run.cable !== null) cables.push({ tier: run.tier, cable: run.cable, cells: cells.get(run.tier) ?? run.cells.length });
  }
  const pipeAt = new Map<string, StuffKey>();
  const fluidPipes = pipeFluids(input, fluids, fluidCells, powerPorts, pipeAt, grid);
  const covers = pumpCovers(input, fluids, pipeAt, grid);
  return { blocks: grid.finish(), covers, supplyRun, cables, fluidPipes, warnings: grid.warnings.list };
}
