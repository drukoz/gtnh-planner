// How the contents of a diagram's pipes move (design spec §7 and §7a), for the Flow diagram and the Connections tab: the
// dashes of a pipe travel one 16 px cycle (a 6 px dash and its 10 px gap) per `pipeSeconds`, faster the more flows, and a
// diagram with more edges than `PIPE_ANIMATION_LIMIT` moves only its lit pipes, so a huge plan still pans smoothly. The
// stylesheet does the moving (the `pipe-flow` keyframes, timed by the `--pipe-dur` custom property); this only picks the
// numbers.

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
