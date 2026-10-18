// Block-grid routing for line layouts: a deterministic multi-source, multi-goal A*, shared-run trees grown from it
// (cables and pipes that branch off what is already laid), straight guides for hookups no search could route, and
// the connection bits of a routed network. The search is fully deterministic — fixed neighbour order and heap
// tie-breaks — because the map, the 3D view and the plan cache must agree; every search stops after a node budget.

import { DIRS, OPPOSITE, bboxOf, manhattan, posKey, sideToward, step, type Vec3 } from '../../shared/layout/geometry.ts';

/** The expansion budget of one search unless the caller sets `maxNodes`. */
export const MAX_PATH_NODES = 200_000;

const DEFAULT_VERTICAL_COST = 2;
const DEFAULT_TURN_COST = 0.25;
/** Search states per cell: entered by no move (a start) or by a move on side 0..5. */
const STATES_PER_CELL = 7;

export interface PathBounds { min: Vec3; max: Vec3 }                     // inclusive
export interface PathOptions {
  passable(p: Vec3): boolean;
  bounds: PathBounds;
  maxNodes?: number;      // MAX_PATH_NODES
  verticalCost?: number;  // 2
  turnCost?: number;      // 0.25
}
export interface PathResult { found: boolean; path: Vec3[] /* start … goal, inclusive; [] when not found */; expanded: number }
export interface TreeResult { cells: Vec3[] /* new cells in the order added */; links: Array<[Vec3, Vec3]>; unreached: Vec3[] }

/** A binary min-heap of search states ordered by (f, h, insertion number), kept in parallel arrays. */
class OpenList {
  private readonly f: number[] = [];
  private readonly h: number[] = [];
  private readonly order: number[] = [];
  private readonly state: number[] = [];
  private inserted = 0;

  get size(): number {
    return this.state.length;
  }

  push(f: number, h: number, state: number): void {
    this.f.push(f);
    this.h.push(h);
    this.order.push(this.inserted++);
    this.state.push(state);
    let i = this.state.length - 1;
    while (i > 0) {
      const up = (i - 1) >> 1;
      if (!this.before(i, up)) break;
      this.swap(i, up);
      i = up;
    }
  }

  /** Removes and returns the first state; the list must not be empty. */
  pop(): number {
    const top = this.state[0]!;
    const last = this.state.length - 1;
    this.swap(0, last);
    this.f.pop();
    this.h.pop();
    this.order.pop();
    this.state.pop();
    let i = 0;
    for (;;) {
      const l = 2 * i + 1, r = l + 1;
      let best = i;
      if (l < last && this.before(l, best)) best = l;
      if (r < last && this.before(r, best)) best = r;
      if (best === i) break;
      this.swap(i, best);
      i = best;
    }
    return top;
  }

  private before(a: number, b: number): boolean {
    const fa = this.f[a]!, fb = this.f[b]!;
    if (fa !== fb) return fa < fb;
    const ha = this.h[a]!, hb = this.h[b]!;
    if (ha !== hb) return ha < hb;
    return this.order[a]! < this.order[b]!;
  }

  private swap(a: number, b: number): void {
    for (const arr of [this.f, this.h, this.order, this.state]) {
      const t = arr[a]!;
      arr[a] = arr[b]!;
      arr[b] = t;
    }
  }
}

/** How far `v` lies outside `[lo, hi]`. */
function gap(v: number, lo: number, hi: number): number {
  return v < lo ? lo - v : v > hi ? v - hi : 0;
}

function inside(p: Vec3, b: PathBounds): boolean {
  return p[0] >= b.min[0] && p[0] <= b.max[0] && p[1] >= b.min[1] && p[1] <= b.max[1] && p[2] >= b.min[2] && p[2] <= b.max[2];
}

/**
 * The cheapest path from any start to any goal. A state is (cell, side of the move that entered it); a move costs 1
 * horizontally, `verticalCost` up or down, plus `turnCost` when its side differs from the previous move's. A cell may be
 * entered when it is inside `bounds` and passable, or when it is a goal. Each pop of the open list is one expansion;
 * the search gives up once `expanded > maxNodes`.
 */
export function findPath(starts: readonly Vec3[], goals: readonly Vec3[], opts: PathOptions): PathResult {
  const maxNodes = opts.maxNodes ?? MAX_PATH_NODES;
  const verticalCost = opts.verticalCost ?? DEFAULT_VERTICAL_COST;
  const turnCost = opts.turnCost ?? DEFAULT_TURN_COST;
  const goalKeys = new Set(goals.map(posKey));
  for (const s of starts) if (goalKeys.has(posKey(s))) return { found: true, path: [[...s]], expanded: 0 };
  const goalBox = bboxOf(goals);
  if (goalBox === null || starts.length === 0) return { found: false, path: [], expanded: 0 };
  const { min, max } = goalBox;
  const heuristic = (p: Vec3): number =>
    gap(p[0], min[0], max[0]) + gap(p[2], min[2], max[2]) + verticalCost * gap(p[1], min[1], max[1]);

  // Cells get dense ids on first sight; a state's index is cellId · 7 + (entering side + 1).
  const cellIds = new Map<string, number>();
  const cells: Vec3[] = [];
  const isGoal: boolean[] = [];
  const enterable: Array<boolean | undefined> = [];
  const cellId = (p: Vec3): number => {
    const key = posKey(p);
    let id = cellIds.get(key);
    if (id === undefined) {
      id = cells.length;
      cellIds.set(key, id);
      cells.push(p);
      isGoal.push(goalKeys.has(key));
    }
    return id;
  };
  const canEnter = (id: number): boolean => {
    let ok = enterable[id];
    if (ok === undefined) {
      const p = cells[id]!;
      ok = isGoal[id]! || (inside(p, opts.bounds) && opts.passable(p));
      enterable[id] = ok;
    }
    return ok;
  };

  const cost: number[] = [];
  const parent: number[] = [];
  const closed: boolean[] = [];
  const open = new OpenList();
  for (const s of starts) {
    const state = cellId([...s]) * STATES_PER_CELL;
    if (cost[state] !== undefined) continue;
    cost[state] = 0;
    parent[state] = -1;
    const h = heuristic(s);
    open.push(h, h, state);
  }

  let expanded = 0;
  while (open.size > 0) {
    const state = open.pop();
    expanded++;
    if (expanded > maxNodes) break;
    if (closed[state]) continue;
    closed[state] = true;
    const id = Math.floor(state / STATES_PER_CELL);
    if (isGoal[id]) return { found: true, path: trace(state, parent, cells), expanded };
    const entered = (state % STATES_PER_CELL) - 1;
    const here = cells[id]!;
    const g = cost[state]!;
    for (let side = 0; side < DIRS.length; side++) {
      const next = step(here, side);
      const nextId = cellId(next);
      if (!canEnter(nextId)) continue;
      const nextState = nextId * STATES_PER_CELL + side + 1;
      if (closed[nextState]) continue;
      const nextCost = g + (side <= 1 ? verticalCost : 1) + (entered !== -1 && entered !== side ? turnCost : 0);
      const known = cost[nextState];
      if (known !== undefined && known <= nextCost) continue;
      cost[nextState] = nextCost;
      parent[nextState] = state;
      const h = heuristic(next);
      open.push(nextCost + h, h, nextState);
    }
  }
  return { found: false, path: [], expanded };
}

function trace(goalState: number, parent: readonly number[], cells: readonly Vec3[]): Vec3[] {
  const path: Vec3[] = [];
  for (let s = goalState; s !== -1; s = parent[s]!) path.push(cells[Math.floor(s / STATES_PER_CELL)]!);
  return path.reverse();
}

/**
 * Connects every terminal to a tree that starts as `roots`, each by the cheapest path to any cell already in the tree,
 * so later terminals branch off earlier runs. Terminals are taken nearest to a root first (ties by posKey); one that
 * is already in the tree is skipped, one that is not passable or cannot be reached is `unreached`.
 */
export function growTree(roots: readonly Vec3[], terminals: readonly Vec3[], opts: PathOptions): TreeResult {
  const tree = new Set(roots.map(posKey));
  const treeCells: Vec3[] = roots.map((r) => [...r]);
  const result: TreeResult = { cells: [], links: [], unreached: [] };
  const rootDistance = (t: Vec3) => roots.reduce((best, r) => Math.min(best, manhattan(t, r)), Infinity);
  const ordered = terminals
    .map((t) => ({ t, d: rootDistance(t), key: posKey(t) }))
    .sort((a, b) => a.d - b.d || (a.key < b.key ? -1 : a.key > b.key ? 1 : 0));
  const passable = (p: Vec3) => opts.passable(p) && !tree.has(posKey(p));
  for (const { t, key } of ordered) {
    if (tree.has(key)) continue;
    if (!opts.passable(t)) {
      result.unreached.push([...t]);
      continue;
    }
    const found = findPath([t], treeCells, { ...opts, passable });
    if (!found.found) {
      result.unreached.push([...t]);
      continue;
    }
    const path = found.path;
    for (let i = 0; i < path.length - 1; i++) {
      const cell = path[i]!;
      const cellKey = posKey(cell);
      if (!tree.has(cellKey)) {
        tree.add(cellKey);
        treeCells.push(cell);
        result.cells.push(cell);
      }
      result.links.push([cell, path[i + 1]!]);
    }
  }
  return result;
}

/** A guide from `from` to `to` that moves along x first, then z, then y; both ends included. */
export function straightPath(from: Vec3, to: Vec3): Vec3[] {
  const at: Vec3 = [...from];
  const path: Vec3[] = [[...at]];
  for (const axis of [0, 2, 1] as const) {
    const dir = Math.sign(to[axis] - at[axis]);
    for (let n = Math.abs(to[axis] - at[axis]); n > 0; n--) {
      at[axis] += dir;
      path.push([...at]);
    }
  }
  return path;
}

/** The connection bits (`1 << side`) of every linked cell: each link sets the side facing its partner on both ends. */
export function linkBits(links: ReadonlyArray<[Vec3, Vec3]>): Map<string, number> {
  const bits = new Map<string, number>();
  const set = (p: Vec3, side: number) => {
    const key = posKey(p);
    bits.set(key, (bits.get(key) ?? 0) | (1 << side));
  };
  for (const [a, b] of links) {
    const side = sideToward(a, b);
    if (side === -1) throw new RangeError(`a link joins face-adjacent cells, got ${posKey(a)} and ${posKey(b)}`);
    set(a, side);
    set(b, OPPOSITE[side]!);
  }
  return bits;
}
