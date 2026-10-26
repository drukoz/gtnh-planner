// How the contents of a diagram's pipes move (design spec §7 and §7a), for the Flow diagram and the Connections tab: the
// dashes of a pipe travel one 16 px cycle (a 6 px dash and its 10 px gap) per `pipeSeconds`, faster the more flows, and a
// diagram with more edges than `PIPE_ANIMATION_LIMIT` moves only its lit pipes, so a huge plan still pans smoothly. The
// stylesheet does the moving (the `pipe-flow` keyframes, timed by the `--pipe-dur` custom property); this only picks the
// numbers. The goods that ride the Flow pipes (Phase 2 spec §15) too: how long a ride takes, where in its ride each one
// starts, and which pipes carry one (the `pipe-ride` keyframes, timed by `--rider-dur`).

/** Above this many edges a diagram moves only its lit pipes. */
export const PIPE_ANIMATION_LIMIT = 200;
/** Seconds per cycle at the fastest and the slowest; nothing flowing (or a rate that is not a number) gets the slowest. */
const FASTEST = 0.35;
const SLOWEST = 1.6;
/** A fluid's rate is in litres: a thousand litres (a bucket) moves like one item. */
const LITRES_PER_ITEM = 1000;

/**
 * Seconds per 16 px dash cycle for a pipe that carries `perSecond` (items, or litres when `fluid`): one second at one a
 * second, a quarter of a second less for each tenfold (a log scale, so a trickle and a torrent both stay readable), within
 * 0.35–1.6 s, in hundredths.
 */
export function pipeSeconds(perSecond: number, fluid: boolean): number {
  const units = fluid ? perSecond / LITRES_PER_ITEM : perSecond;
  if (!Number.isFinite(units) || units <= 0) return SLOWEST;
  const seconds = Math.min(SLOWEST, Math.max(FASTEST, 1 - 0.25 * Math.log10(units)));
  return Math.round(seconds * 100) / 100;
}

/** Which pipes of a diagram with `edgeCount` edges move: all of them, or only the lit ones above `PIPE_ANIMATION_LIMIT`. */
export function pipeAnimationMode(edgeCount: number): 'all' | 'lit' {
  return edgeCount > PIPE_ANIMATION_LIMIT ? 'lit' : 'all';
}

/** At most this many goods ride the pipes of one diagram: the one number that bounds them (a slow diagram lowers it first, spec §20). */
export const RIDER_LIMIT = 150;
/** A rider's side, in the diagram's units: smaller than the rows' 16 px icons, whose image it is drawn from. */
export const RIDER_SIZE = 12;
/** How far a rider travels per dash cycle: four of the dashes' 16 px, so a good outruns the contents around it. */
const RIDER_PER_CYCLE = 64;
/** Seconds per ride at the quickest and the slowest, so a short pipe's good can be followed and a long one's still comes. */
const RIDE_QUICKEST = 1.2;
const RIDE_SLOWEST = 12;

/** The length of a route through `points`, one straight run to the next. */
export function pathLength(points: ReadonlyArray<readonly [number, number]>): number {
  let length = 0;
  for (let i = 1; i < points.length; i++) {
    const [x0, y0] = points[i - 1]!;
    const [x1, y1] = points[i]!;
    length += Math.hypot(x1 - x0, y1 - y0);
  }
  return length;
}

/**
 * Seconds for one ride along a pipe `length` long that carries `perSecond` (items, or litres when `fluid`): 64 px per `pipeSeconds` cycle,
 * four times as fast as the dashes, within 1.2–12 s, in hundredths.
 */
export function riderSeconds(length: number, perSecond: number, fluid: boolean): number {
  const seconds = (length / RIDER_PER_CYCLE) * pipeSeconds(perSecond, fluid);
  return Math.round(Math.min(RIDE_SLOWEST, Math.max(RIDE_QUICKEST, seconds)) * 100) / 100;
}

/**
 * Where in its ride the good of edge `id` starts, a fraction 0 ≤ phase < 1 of the ride: the FNV-1a hash of the id over 2³². The same for the
 * same edge on every render, and spread over the ride, so the goods of a diagram do not all leave their ports together.
 */
export function riderPhase(id: string): number {
  let hash = 0x811c9dc5;
  for (let i = 0; i < id.length; i++) {
    hash ^= id.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }
  return hash / 2 ** 32;
}

/**
 * The edges a good rides: none from a missing source or of no length; above `PIPE_ANIMATION_LIMIT` edges only the lit ones; and at most
 * `limit`, chosen lit first, then by the largest rate, then by id. They come in the order of `edges`, whatever that ranking: a rider moved in
 * the page starts its ride over, so a focus that lights another pipe moves none.
 */
export function riderEdges<E extends { id: string; perSecond: number; points: Array<[number, number]> }>(
  edges: readonly E[], lit: ReadonlySet<string> | null, missing: ReadonlySet<string>, limit = RIDER_LIMIT,
): E[] {
  const litOnly = pipeAnimationMode(edges.length) === 'lit';
  const isLit = (edge: E): boolean => lit?.has(edge.id) === true;
  const riding = edges.filter((edge) => !missing.has(edge.id) && pathLength(edge.points) > 0 && (!litOnly || isLit(edge)));
  if (riding.length <= limit) return riding;
  const byId = (a: E, b: E): number => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0);
  const ranked = [...riding].sort((a, b) => Number(isLit(b)) - Number(isLit(a)) || b.perSecond - a.perSecond || byId(a, b));
  const kept = new Set(ranked.slice(0, Math.max(0, limit)));
  return riding.filter((edge) => kept.has(edge));
}
