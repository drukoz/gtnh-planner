// Internal routing of a line (Plan 5 Task 6; spec §3.5 never overvolt or overload a cable, §3.6 shared runs;
// gt-mechanics §3.1, §3.3, §3.6): the power head — one straight cable run per voltage tier along z, with step-down
// transformer banks between neighbouring runs — then one cable tree per feed tier from its run to the power port of
// every machine of that tier, then one GT fluid-pipe tree per fluid with a pump cover, sized to its share, on every
// face that makes the fluid (unless that face's port carries another fluid's pipe: then no pump, and a
// `fluid_port_shared` warning).
// Tiers never touch, because GT joins a cable to the block it is placed against: a cable keeps off every cell beside
// another tier's run, cable or power port and beside a machine of a lower tier, never lies in a bank column or on top
// of a bank that sends another tier, and crosses the lower runs two blocks up. So no machine receives more than
// `V[its tier]` and no two tiers can be joined by a natural click.
// Cables and banks are sized for the volts each machine really gets (gt-mechanics §3.1, §3.3): `V[tier]` less the
// loss from where the power enters its run — a bank, or for the supply run its far end after the hookup's allowance —
// to the machine; a bank likewise for what it takes from the run above. Every network keeps off the cells other
// networks connect to (their ports and tail roots), so one network never takes another's cell. All routes use the
// deterministic A* router (Task 2); every order and tie-break is fixed.

import { tierName, V } from '../../shared/gt/tiers.ts';
import type { StuffKey } from '../../shared/keys.ts';
import { fmtInt, joinNames } from '../../shared/layout/format.ts';
import { DIRS, posKey, step, type Vec3 } from '../../shared/layout/geometry.ts';
import { FACES } from '../../shared/types/assets.ts';
import type { Machine, Pack } from '../../shared/types/pack.ts';
import type { Plan, PlanWarning } from '../../shared/types/plan.ts';
import type { HostCover, LocalBlock, Placement, PlacedUnit } from './arrange.ts';
import { growTree, linkBits, type PathBounds, type PathOptions } from './path.ts';
import { coverRateWarning, machineRef, pickCable, pickFluidPipe, pickPump, pickTransformer, type Parts } from './parts.ts';
import { bankLossEUt, deliveredVolts, LOSS_WARN_FRACTION, tierGroups, transformerStages, type Stage, type Stages } from './power.ts';

// ---- Types ----

export interface FluidNet {
  key: StuffKey; name: string; litresPerSecond: number; producers: Vec3[]; consumers: Vec3[]; atTail: boolean;
  faces: Array<{ pos: Vec3; side: number; stepId: string; rate: number /* L/s this face must move */ }>;
}

export interface InternalInput {
  pack: Pack; parts: Parts; placement: Placement; occupied: readonly LocalBlock[]; stages: Stages | null; fluids: readonly FluidNet[]; tailFluidY: number;
  groupTier: number /* plan.tier: the highest cover tier the group can build */;
  /** Volts the supply run's packets may already have lost before they reach it (the power hookup's allowance); default 0. */
  supplyLossVolts?: number;
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
  /**
   * `input.stages` with the amps and transformer counts the line really needs once every machine and bank is sized for
   * the volts it gets; the same tiers and banks. Null without `input.stages`.
   */
  stages: Stages | null;
  /**
   * EU/t the line's lower runs and their trees lose: every amp a machine or bank draws times the volts it loses inside
   * the line. The supply run's share is `supplyRunLoss(supply, z)` once the hookup's landing cell z is known.
   */
  lossEUt: number;
  /** The supply run's consumers, for `supplyRunLoss`; null without stages or a cable for the supply tier. */
  supply: SupplyLoss | null;
  /**
   * Local cells a supply-tier cable from outside the line must not touch: the other tiers' cables, the transformers and
   * the power inputs of machines below the supply tier. Sorted by x, y, z.
   */
  keepAway: Vec3[];
}

// ---- Small helpers ----

const DOWN = 0, WEST = 4;
/** Sizing rounds at most: the amps only grow, so they settle; this only bounds a pathological pack. */
const MAX_SIZING_ROUNDS = 8;

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

function voltsOf(tier: number): number {
  const v = V[tier];
  if (v === undefined) throw new RangeError(`tier must be an integer from 0 to ${V.length - 1}, got ${tier}`);
  return v;
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

/** A cable run of the head; `rated`: the pack has a cable for its volts (else it is never laid). */
interface Run { tier: number; cells: Vec3[]; rated: boolean }
/** The column of the step-down bank of `stage`, between the runs of its two tiers. */
interface Bank { stage: number; fromTier: number; toTier: number; x: number }
interface Port { pos: Vec3; unit: PlacedUnit }
/** One feed tier's tree from its run to its machines' power ports, before its cable is chosen. */
interface Tree { tier: number; cells: Vec3[]; links: Array<[Vec3, Vec3]>; ports: Port[]; unreached: ReadonlySet<string> }

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

/** The runs (supply first, then each stage's lower tier, each across the whole length) and the bank columns between them. */
function planHead(input: InternalInput, stages: Stages, grid: Grid): { runs: Run[]; banks: Bank[] } {
  const { pack, placement } = input;
  const length = placement.size[2];
  const supply = stages.supplyTier;
  const runs = [supply, ...stages.stages.map((s) => s.toTier)].map((tier): Run => {
    const x = runX(supply, tier);
    const cells = Array.from({ length }, (_, z): Vec3 => [x, 0, z]);
    for (const c of cells) grid.take(c);
    return { tier, cells, rated: pickCable(pack, { volts: voltsOf(tier), amps: 1 }) !== null };
  });
  const banks = stages.stages.map((s, stage): Bank => ({ stage, fromTier: s.fromTier, toTier: s.toTier, x: runX(supply, s.toTier) - 1 }));
  return { runs, banks };
}

/** The cell a unit's power reaches it through: the machine (singleblock) or its energy hatch, behind the power port. */
function powerCell(u: PlacedUnit): Vec3 | null {
  return u.ports.power === null ? null : step(u.ports.power, u.facing);
}

/** `power_tier_low`, one per unit tier above the supply tier (highest first), naming the machines of that tier. */
function warnUnderVoltage(units: readonly PlacedUnit[], supply: number, warnings: WarningList): void {
  const tiers = [...new Set(units.filter((u) => u.tier > supply).map((u) => u.tier))].sort((a, b) => b - a);
  for (const tier of tiers) {
    const atTier = units.filter((u) => u.tier === tier);
    const names = [...new Set(atTier.map((u) => u.name))];
    warnings.add({ code: 'power_tier_low', stepId: atTier[0]!.stepId,
      text: `${joinNames(names)} ${names.length === 1 ? 'needs' : 'need'} ${tierName(tier)} power but the line gets ${tierName(supply)}: `
        + `it will run short — add a step-up transformer or a generator at ${tierName(tier)}` });
  }
}

/**
 * One cable tree per feed tier, highest first: from the tier's run to the power port of every electric unit fed at
 * that tier (`min(unit tier, supply)`). Its cells keep off `keepOff`, the bank columns, the ports of other feed tiers and
 * the cells on top of a bank that sends another tier, and never touch another tier's run, tree or port or a machine of
 * a lower tier; the box reaches H + 1 high, so a tree crosses a lower run two blocks up. The cells are taken but not
 * yet laid: the cables are chosen once the trees give the lengths. Units that cannot be reached (or whose tier has no
 * run) get `route_failed`.
 */
function growTrees(input: InternalInput, stages: Stages, head: { runs: readonly Run[]; banks: readonly Bank[] }, keepOff: ReadonlySet<string>,
  grid: Grid, warnings: WarningList): Tree[] {
  const { placement } = input;
  const [w, h, l] = placement.size;
  const supply = stages.supplyTier;
  const electric = placement.units.filter((u) => u.electric);
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
  const bankCells = new Set<string>();
  const onBank = new Map<string, number>();                                            // the cell on top of a bank → the tier it sends
  for (const b of head.banks) {
    for (let z = 0; z < l; z++) {
      bankCells.add(posKey([b.x, 0, z]));
      onBank.set(posKey([b.x, 1, z]), b.toTier);
    }
  }
  const bounds: PathBounds = { min: [0, 0, 0], max: [w - 1, h + 1, l - 1] };
  const unwired = (unit: PlacedUnit) =>
    warnings.add({ code: 'route_failed', stepId: unit.stepId, text: `Could not wire ${unit.name} inside the line — connect it by hand` });
  const trees: Tree[] = [];
  for (const run of head.runs) {
    if (!run.rated) continue;                                                          // its machines are reported below
    const ports = (portsByTier.get(run.tier) ?? []).sort((a, b) => comparePos(a.pos, b.pos));
    portsByTier.delete(run.tier);
    // the cells this tier's cables must not touch
    const avoid = new Set<string>();
    for (const r of head.runs) if (r.rated && r.tier !== run.tier) for (const c of r.cells) avoid.add(posKey(c));
    for (const t of trees) for (const c of t.cells) avoid.add(posKey(c));
    for (const [key, tier] of portTier) if (tier !== run.tier) avoid.add(key);
    for (const u of electric) {
      const cell = u.tier < run.tier ? powerCell(u) : null;
      if (cell !== null) avoid.add(posKey(cell));
    }
    const opts: PathOptions = {
      bounds,
      passable: (p) => {
        const key = posKey(p);
        const tier = portTier.get(key);
        if (grid.isTaken(p) || keepOff.has(key) || bankCells.has(key) || (tier !== undefined && tier !== run.tier)) return false;
        const sends = onBank.get(key);
        if (sends !== undefined && sends !== run.tier) return false;
        return !DIRS.some((_, side) => avoid.has(posKey(step(p, side))));
      },
    };
    const tree = ports.length === 0 ? { cells: [], links: [], unreached: [] } : growTree(run.cells, ports.map((p) => p.pos), opts);
    for (const c of tree.cells) grid.take(c);
    const unreached = new Set(tree.unreached.map(posKey));
    for (const { pos, unit } of ports) if (unreached.has(posKey(pos))) unwired(unit);
    trees.push({ tier: run.tier, cells: tree.cells, links: tree.links, ports, unreached });
  }
  // a feed tier without a laid run (no cable for it, or no run because its machines draw nothing) is never wired
  // from another tier's run
  for (const ports of portsByTier.values()) for (const { unit } of ports) unwired(unit);
  return trees;
}

/** The rows a bank of `count` transformers takes: centred on the spine, moved back inside the line when uneven. */
function bankRows(count: number, length: number, spineZ: number): { first: number; placed: number } {
  const placed = Math.min(count, length);
  return { first: Math.min(Math.max(spineZ - Math.floor(placed / 2), 0), length - placed), placed };
}

/** Breadth-first edge counts over one tier's linked cable cells from `source`. */
function edgesFrom(adjacent: ReadonlyMap<string, readonly string[]>, source: Vec3): Map<string, number> {
  const start = posKey(source);
  const seen = new Map<string, number>([[start, 0]]);
  const queue = [start];
  for (let i = 0; i < queue.length; i++) {
    const key = queue[i]!;
    const d = seen.get(key)!;
    for (const next of adjacent.get(key) ?? []) {
      if (seen.has(next)) continue;
      seen.set(next, d + 1);
      queue.push(next);
    }
  }
  return seen;
}

/** A tier's cable network: the run along z and its tree's links. */
function tierGraph(run: Run, tree: Tree | undefined): Map<string, string[]> {
  const adjacent = new Map<string, string[]>();
  const join = (a: Vec3, b: Vec3): void => {
    const ka = posKey(a), kb = posKey(b);
    adjacent.set(ka, [...(adjacent.get(ka) ?? []), kb]);
    adjacent.set(kb, [...(adjacent.get(kb) ?? []), ka]);
  };
  for (let z = 0; z + 1 < run.cells.length; z++) join(run.cells[z]!, run.cells[z + 1]!);
  for (const [a, b] of tree?.links ?? []) join(a, b);
  return adjacent;
}

interface Sizing {
  stages: Stages;
  /** The cable of each rated run's tier and whether it is short of amps (parallel runs needed). */
  cables: Map<number, { cable: Machine; ampsShort: boolean; amps: number }>;
  /** Transformer rows per bank, by stage index. */
  rows: Array<{ first: number; placed: number }>;
  /** Volts each unit's packets lose inside the line (not counting the hookup's allowance), by electric unit index. */
  unitLoss: number[];
  /** The amps each unit counts at the volts it gets, by electric unit index. */
  unitAmps: number[];
  /** The cables from the power's entry to each unit's port, by electric unit index; undefined when its port is not wired. */
  unitBlocks: Array<number | undefined>;
  /** Volts each bank's packets lose on the run above before they reach it, by stage index. */
  bankLoss: number[];
  bankBlocks: number[];
  /** The supply tier's consumers with the cables from each supply-run cell (by z) to them, for `supplyRunLoss`. */
  supply: SupplyLoss | null;
}

/**
 * What the supply run feeds inside the line — its wired machines with their amps, and the bank below it with its input
 * amps — and how many cables lie between each supply-run cell (index z) and each of them. Where the hookup lands on the
 * supply run is known only once the line is in the world, so its loss is priced then (`supplyRunLoss`).
 */
export interface SupplyLoss {
  tier: number; cable: string; lossPerBlock: number;
  consumers: Array<{ amps: number; blocks: number[] }>;
}

/**
 * The supply tier's loss inside the line when the hookup lands on supply-run cell `z` (null: unknown, the worst cell
 * counts): the EU/t lost (every consumer's amps over its cables) and `cable_loss_high` when the farthest consumer loses
 * more than `LOSS_WARN_FRACTION` of the supply volts.
 */
export function supplyRunLoss(supply: SupplyLoss | null, z: number | null): { lossEUt: number; warning: PlanWarning | null } {
  if (supply === null) return { lossEUt: 0, warning: null };
  const blocksOf = (c: SupplyLoss['consumers'][number]): number => (z === null ? Math.max(...c.blocks) : c.blocks[z] ?? Math.max(...c.blocks));
  let lossEUt = 0, worst = 0;
  for (const c of supply.consumers) {
    const blocks = blocksOf(c);
    lossEUt += c.amps * blocks * supply.lossPerBlock;
    worst = Math.max(worst, blocks);
  }
  const volts = voltsOf(supply.tier);
  const lost = worst * supply.lossPerBlock;
  return { lossEUt, warning: lost > LOSS_WARN_FRACTION * volts ? lossWarning(supply.tier, lost, worst, supply.cable) : null };
}

function lossWarning(tier: number, lostVolts: number, blocks: number, cable: string): PlanWarning {
  return { code: 'cable_loss_high',
    text: `The ${tierName(tier)} wiring inside the line loses up to ${Math.round((100 * lostVolts) / voltsOf(tier))}% over ${fmtInt(blocks)} blocks of ${cable}: `
      + 'it is sized for that, but a cable with less loss or a shorter line wastes less power' };
}

/**
 * Sizes the head and the trees for the volts every consumer really gets (gt-mechanics §3.1, §3.3). For each tier, the
 * power enters at its bank's outermost transformer rows (a lower run) or at either end of the supply run (where the
 * hookup lands is not known yet, so the farther end counts), and a consumer's packets lose `lossPerBlock` volts for
 * every cable from there to it; the supply tier's also lose `supplyLossVolts` on the hookup. Each machine then counts
 * `ceil(EU/t ÷ delivered volts)` amps and each bank takes its input amps at the volts it gets, which may need more
 * transformers (whose rows move the entry) and bigger cables (whose loss differs): repeated until nothing changes,
 * never lowering an amp or a count. A unit whose port is not wired counts the worst wired distance of its tier.
 */
function sizePower(input: InternalInput, stages: Stages, head: { runs: readonly Run[]; banks: readonly Bank[] }, trees: readonly Tree[]): Sizing {
  const { pack, placement } = input;
  const length = placement.size[2];
  const supply = stages.supplyTier;
  const supplyLoss = input.supplyLossVolts ?? 0;
  const units = placement.units.filter((u) => u.electric);
  const treeOf = new Map(trees.map((t) => [t.tier, t]));
  const runOf = new Map(head.runs.map((r) => [r.tier, r]));
  const graphs = new Map(head.runs.map((r) => [r.tier, tierGraph(r, treeOf.get(r.tier))]));
  const runCell = (tier: number, z: number): Vec3 => [runX(supply, tier), 0, z];

  let current: Stages = { ...stages, stages: stages.stages.map((s) => ({ ...s })) };
  const pick = (s: Stages): Sizing['cables'] => {
    const cables: Sizing['cables'] = new Map();
    for (const run of head.runs) {
      if (!run.rated) continue;
      const amps = run.tier === supply ? s.supplyAmps : s.stages.find((st) => st.toTier === run.tier)?.ampsOut ?? 0;
      const chosen = pickCable(pack, { volts: voltsOf(run.tier), amps })!;
      cables.set(run.tier, { ...chosen, amps });
    }
    return cables;
  };
  let cables = pick(current);
  let result: Sizing | null = null;
  for (let round = 0; round < MAX_SIZING_ROUNDS; round++) {
    const rows = current.stages.map((s) => bankRows(s.count, length, placement.spineZ));
    const lossPerBlock = (tier: number): number => cables.get(tier)?.cable.cable?.lossPerBlock ?? 0;
    // where the power enters each run: the supply run's two ends, else the outermost rows of the bank feeding it
    const sources = (tier: number): Vec3[] => {
      if (tier === supply) return length === 1 ? [runCell(tier, 0)] : [runCell(tier, 0), runCell(tier, length - 1)];
      const i = current.stages.findIndex((s) => s.toTier === tier);
      const r = rows[i]!;
      return r.placed <= 1 ? [runCell(tier, r.first)] : [runCell(tier, r.first), runCell(tier, r.first + r.placed - 1)];
    };
    const reach = new Map(head.runs.map((r) => [r.tier, sources(r.tier).map((s) => edgesFrom(graphs.get(r.tier)!, s))]));
    /** The cables a packet crosses from the farthest entry to `p` on `tier`'s network; undefined when not linked. */
    const blocksTo = (tier: number, p: Vec3): number | undefined => {
      const key = posKey(p);
      let worst: number | undefined;
      for (const seen of reach.get(tier) ?? []) {
        const d = seen.get(key);
        if (d !== undefined && (worst === undefined || d + 1 > worst)) worst = d + 1;
      }
      return worst;
    };
    const unitBlocks = units.map((u): number | undefined => {
      const feed = Math.min(u.tier, supply);
      const tree = treeOf.get(feed);
      const port = u.ports.power;
      return port === null || tree === undefined || tree.unreached.has(posKey(port)) ? undefined : blocksTo(feed, port);
    });
    const worstOf = (tier: number): number => {
      let worst = 0;
      units.forEach((u, i) => {
        if (Math.min(u.tier, supply) === tier && unitBlocks[i] !== undefined) worst = Math.max(worst, unitBlocks[i]!);
      });
      return worst > 0 ? worst : (runOf.get(tier)?.cells.length ?? length) + 1;
    };
    const unitLoss = units.map((u, i) => lossPerBlock(Math.min(u.tier, supply)) * (unitBlocks[i] ?? worstOf(Math.min(u.tier, supply))));
    const bankBlocks = current.stages.map((s, i) => {
      const r = rows[i]!;
      let worst = 1;
      for (let z = r.first; z < r.first + r.placed; z++) worst = Math.max(worst, blocksTo(s.fromTier, runCell(s.fromTier, z)) ?? 1);
      return worst;
    });
    const bankLoss = current.stages.map((s, i) => lossPerBlock(s.fromTier) * bankBlocks[i]!);
    const totalLoss = (u: PlacedUnit, i: number): number => unitLoss[i]! + (Math.min(u.tier, supply) === supply ? supplyLoss : 0);
    const unitAmps = units.map((u, i) => Math.ceil(u.euPerTick / deliveredVolts(voltsOf(Math.min(u.tier, supply)), totalLoss(u, i))));
    const groups = tierGroups(units.map((u, i) => ({ tier: u.tier, euPerTick: u.euPerTick, lossVolts: totalLoss(u, i) })));
    const lossAbove = (fromTier: number): number => {
      const i = current.stages.findIndex((s) => s.fromTier === fromTier);
      return (i === -1 ? 0 : bankLoss[i]!) + (fromTier === supply ? supplyLoss : 0);
    };
    const next = transformerStages(groups, supply, lossAbove);
    // never lower an amp or a count, so the rounds settle
    const merged: Stage[] = current.stages.map((s) => {
      const n = next.stages.find((x) => x.toTier === s.toTier) ?? s;
      return { ...s, count: Math.max(s.count, n.count), ampsIn: Math.max(s.ampsIn, n.ampsIn), ampsOut: Math.max(s.ampsOut, n.ampsOut) };
    });
    const sized: Stages = { ...current, stages: merged, supplyAmps: Math.max(current.supplyAmps, next.supplyAmps), lossEUt: bankLossEUt(merged) };
    const nextCables = pick(sized);
    const same = sized.supplyAmps === current.supplyAmps && merged.every((s, i) => s.count === current.stages[i]!.count && s.ampsIn === current.stages[i]!.ampsIn
      && s.ampsOut === current.stages[i]!.ampsOut)
      && [...nextCables].every(([tier, c]) => cables.get(tier)?.cable.mteId === c.cable.mteId);
    result = {
      stages: sized, cables: nextCables, rows: merged.map((s) => bankRows(s.count, length, placement.spineZ)), unitLoss, unitAmps, unitBlocks,
      bankLoss, bankBlocks, supply: null,
    };
    current = sized;
    cables = nextCables;
    if (same) break;
  }
  const sizing = result!;
  return { ...sizing, supply: supplyConsumers(sizing, supply, units, runOf.get(supply)!, graphs.get(supply)!, treeOf.get(supply)) };
}

/** The supply tier's wired machines and the bank it feeds, with the cables from every supply-run cell to each. */
function supplyConsumers(sizing: Sizing, supply: number, units: readonly PlacedUnit[], run: Run, graph: ReadonlyMap<string, readonly string[]>,
  tree: Tree | undefined): SupplyLoss | null {
  const chosen = sizing.cables.get(supply);
  if (chosen === undefined) return null;
  const fromCell = run.cells.map((c) => edgesFrom(graph, c));
  const blocksAt = (p: Vec3): number[] | undefined => {
    const key = posKey(p);
    const edges = fromCell.map((seen) => seen.get(key));
    return edges.some((d) => d === undefined) ? undefined : edges.map((d) => d! + 1);
  };
  const consumers: SupplyLoss['consumers'] = [];
  units.forEach((u, i) => {
    const port = u.ports.power;
    if (Math.min(u.tier, supply) !== supply || port === null || tree === undefined || tree.unreached.has(posKey(port))) return;
    const blocks = blocksAt(port);
    if (blocks !== undefined) consumers.push({ amps: sizing.unitAmps[i]!, blocks });
  });
  const top = sizing.stages.stages.findIndex((s) => s.fromTier === supply);
  if (top !== -1) {
    const { first, placed } = sizing.rows[top]!;
    const rows = Array.from({ length: placed }, (_, j) => blocksAt(run.cells[first + j]!)).filter((b): b is number[] => b !== undefined);
    if (rows.length > 0) consumers.push({ amps: sizing.stages.stages[top]!.ampsIn, blocks: run.cells.map((_, z) => Math.max(...rows.map((b) => b[z]!))) });
  }
  return { tier: supply, cable: chosen.cable.name, lossPerBlock: chosen.cable.cable?.lossPerBlock ?? 0, consumers };
}

/**
 * Lays the head, the banks and the trees with the cables `sizePower` chose; warns `no_cable` / `cable_amps` per run,
 * `no_transformer` / `transformer_bank` per bank, then (after `power_tier_low` and `route_failed`, raised while
 * growing) `cable_loss_high` per tier whose farthest consumer loses more than `LOSS_WARN_FRACTION` of its volts inside
 * the line. Returns the cable cells laid per tier, run included, and the internal loss in EU/t.
 */
function layPower(input: InternalInput, head: { runs: readonly Run[]; banks: readonly Bank[] }, trees: readonly Tree[], sizing: Sizing, grid: Grid,
  headWarnings: WarningList, lossWarnings: WarningList): { cells: Map<number, number>; lossEUt: number } {
  const { pack, placement } = input;
  const length = placement.size[2];
  const { stages, cables } = sizing;
  const supply = stages.supplyTier;
  const treeOf = new Map(trees.map((t) => [t.tier, t]));
  for (const run of head.runs) {
    const chosen = cables.get(run.tier);
    if (chosen === undefined) {
      headWarnings.add({ code: 'no_cable', text: `No cable for ${tierName(run.tier)} in this export` });
      continue;
    }
    const { cable, ampsShort, amps } = chosen;
    if (ampsShort) {
      headWarnings.add({ code: 'cable_amps',
        text: `No cable carries ${fmtInt(amps)} A at ${tierName(run.tier)}: run ${Math.ceil(amps / cable.cable!.amps)} parallel ${cable.name} lines` });
    }
    for (const c of run.cells) grid.lay(c, cable, 'cable', cable.name);
    for (let z = 0; z + 1 < length; z++) grid.links.push([run.cells[z]!, run.cells[z + 1]!]);
  }
  for (const bank of head.banks) {
    const stage = stages.stages[bank.stage]!;
    const transformer = pickTransformer(pack, stage.toTier);
    if (transformer === null) {
      headWarnings.add({ code: 'no_transformer', text: `No ${tierName(stage.toTier)} transformer in this export` });
      continue;
    }
    const { first, placed } = sizing.rows[bank.stage]!;
    if (stage.count > placed) headWarnings.add({ code: 'transformer_bank', text: `Put ${stage.count - placed} more ${transformer.name} beside the bank` });
    for (let j = 0; j < placed; j++) {
      const pos: Vec3 = [bank.x, 0, first + j];
      // facing west: the front (step-down input) touches the higher run, the east face feeds the lower one
      grid.lay(pos, transformer, 'transformer', transformer.name, WEST);
      if (cables.has(stage.fromTier)) grid.links.push([pos, [bank.x - 1, 0, pos[2]]]);
      if (cables.has(stage.toTier)) grid.links.push([pos, [bank.x + 1, 0, pos[2]]]);
    }
  }
  const cells = new Map<number, number>();
  for (const run of head.runs) {
    const chosen = cables.get(run.tier);
    const tree = treeOf.get(run.tier);
    if (chosen === undefined || tree === undefined) continue;
    for (const c of tree.cells) grid.lay(c, chosen.cable, 'cable', chosen.cable.name);
    grid.links.push(...tree.links);
    for (const { pos, unit } of tree.ports) if (!tree.unreached.has(posKey(pos))) grid.links.push([pos, step(pos, unit.facing)]);   // into the machine or energy hatch
    cells.set(run.tier, run.cells.length + tree.cells.length);
  }

  // the loss on the lower runs: every machine's and bank's amps over its own path (gt-mechanics §3.3); the supply
  // run's depends on where the hookup lands, so `supplyRunLoss` prices it
  const units = placement.units.filter((u) => u.electric);
  let lossEUt = 0;
  const worst = new Map<number, { volts: number; blocks: number }>();
  const note = (tier: number, volts: number, blocks: number | undefined): void => {
    if (blocks === undefined) return;
    const known = worst.get(tier);
    if (known === undefined || volts > known.volts) worst.set(tier, { volts, blocks });
  };
  units.forEach((u, i) => {
    const feed = Math.min(u.tier, supply);
    if (feed === supply) return;
    lossEUt += sizing.unitAmps[i]! * sizing.unitLoss[i]!;
    note(feed, sizing.unitLoss[i]!, sizing.unitBlocks[i]);
  });
  stages.stages.forEach((s, i) => {
    if (s.fromTier === supply) return;
    lossEUt += s.ampsIn * sizing.bankLoss[i]!;
    note(s.fromTier, sizing.bankLoss[i]!, sizing.bankBlocks[i]);
  });
  for (const run of head.runs) {
    const chosen = cables.get(run.tier);
    const w = worst.get(run.tier);
    if (chosen === undefined || w === undefined || w.volts <= LOSS_WARN_FRACTION * voltsOf(run.tier)) continue;
    lossWarnings.add(lossWarning(run.tier, w.volts, w.blocks, chosen.cable.name));
  }
  return { cells, lossEUt };
}

/** Local cells a supply-tier cable must not touch: other tiers' cables, every transformer, machines below the supply. */
function keepAwayCells(input: InternalInput, supply: number, head: { runs: readonly Run[] }, trees: readonly Tree[], grid: Grid): Vec3[] {
  const cells: Vec3[] = [];
  const laid = new Set(grid.blocks.map((b) => posKey(b.pos)));
  for (const run of head.runs) if (run.tier !== supply) for (const c of run.cells) if (laid.has(posKey(c))) cells.push(c);
  for (const tree of trees) if (tree.tier !== supply) cells.push(...tree.cells);
  for (const b of grid.blocks) if (b.role === 'transformer') cells.push(b.pos);
  for (const u of input.placement.units) {
    const cell = u.electric && u.tier < supply ? powerCell(u) : null;
    if (cell !== null) cells.push(cell);
  }
  return uniquePositions(cells);
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
  let sized: Stages | null = null;
  let lossEUt = 0;
  let supply: SupplyLoss | null = null;
  let keepAway: Vec3[] = [];
  if (stages !== null) {
    const head = planHead(input, stages, grid);
    const routeWarnings = new WarningList();
    warnUnderVoltage(placement.units.filter((u) => u.electric), stages.supplyTier, routeWarnings);
    const trees = growTrees(input, stages, head, fluidCells, grid, routeWarnings);
    const sizing = sizePower(input, stages, head, trees);
    const headWarnings = new WarningList();
    const lossWarnings = new WarningList();
    const laid = layPower(input, head, trees, sizing, grid, headWarnings, lossWarnings);
    // the order the plan's tests read: head, then routing, then loss
    for (const w of [...headWarnings.list, ...routeWarnings.list, ...lossWarnings.list]) grid.warnings.add(w);
    sized = sizing.stages;
    lossEUt = laid.lossEUt;
    supply = sizing.supply;
    supplyRun = head.runs[0]!.cells.map((c): Vec3 => [...c]);
    for (const run of head.runs) {
      const chosen = sizing.cables.get(run.tier);
      if (chosen !== undefined) cables.push({ tier: run.tier, cable: chosen.cable, cells: laid.cells.get(run.tier) ?? run.cells.length });
    }
    keepAway = keepAwayCells(input, stages.supplyTier, head, trees, grid);
  }
  const pipeAt = new Map<string, StuffKey>();
  const fluidPipes = pipeFluids(input, fluids, fluidCells, powerPorts, pipeAt, grid);
  const covers = pumpCovers(input, fluids, pipeAt, grid);
  return { blocks: grid.finish(), covers, supplyRun, cables, fluidPipes, warnings: grid.warnings.list, stages: sized, lossEUt, supply, keepAway };
}
