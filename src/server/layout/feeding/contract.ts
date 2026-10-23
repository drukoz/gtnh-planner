// The feeding checker's contract: the structured layout config it reads and the report it gives
// (architecture §11 entry 50; research `docs/research/machine-feeding.md` §7, the design of a feeding checker; plan
// `docs/superpowers/plans/2026-10-20-21-feeding-checker.md`).
// - The first half is the config the checker reads from a layout. Its structured part, `LayoutBlock.feed` (fix/feeding's
//   architecture entry 51), is typed in `src/shared/types/feed.ts`: fix/feeding moved this file's Task 1 types from
//   `ItemFilterSpec` to `FeedSpec` there unchanged, and this file re-exports them (plan open question 1), so the layout,
//   the build steps, the 3D view and the checker read one structure. fix/feeding writes the chips, the interface patterns,
//   the ME Export Bus on its cable and the flat `CONFIG_KEYS` settings on main's routed, AE2 and EnderIO layouts; add-on
//   12 Task 6 writes bench grids, Limited Item Filter counts (main's `ConduitFilter.limits`, read through
//   `FeedConduitFilter`) and shared machines (`LayoutBlock.stepIds`, read through `FeedBlock`).
// - The second half is what the checker reports: the thirteen `feed_*` codes, their kinds and the gate (the plan's
//   Codes table), the scenarios, the options and the time constants.
// Pure TypeScript: nothing from node:* may be imported here.

import type { StuffKey } from '../../../shared/keys.ts';
import type { Vec3 } from '../../../shared/layout/geometry.ts';
import type { ConduitFilter, LayoutBlock } from '../../../shared/types/layout.ts';

// ---- The layout config the checker reads (architecture entries 50 and 51) ----
export type {
  BenchSpec, ChipKind, ExportBusSpec, FeedSpec, InterfaceSpec, ItemFilterSpec, PatternSpec, RoutedChipSpec,
} from '../../../shared/types/feed.ts';
/**
 * A conduit side's filter that may be a Limited Item Filter (`item` = PART_KEYS.limitedFilter): main's `ConduitFilter` as
 * it is. Its counts are main's `ConduitFilter.limits` (add-on 12 Task 6), in `keys` order: `limits[i]` is the count of the
 * slot that holds `keys[i]`. An item in several slots is let in up to the sum of their counts (research §2.1), and a key
 * past the end of `limits` counts 0, as main's configure text reads it.
 */
export type FeedConduitFilter = ConduitFilter;
/**
 * A layout block as the checker reads it: main's `LayoutBlock` itself, which carries both fields the checker needed beyond
 * §6.7 — `feed` (architecture entry 51) and a shared machine's `stepIds` (add-on 12). An alias, kept because entry 51 names
 * it among this contract's types.
 */
export type FeedBlock = LayoutBlock;
/** The flat `LayoutBlock.config` keys the checker reads (add-on 15's words, architecture entry 50 item 4). */
export const CONFIG_KEYS = { multiStack: 'multiStack', inputFilter: 'inputFilter', inputFromOutputSide: 'inputFromOutputSide',
  autoOutput: 'autoOutput', limited: 'limited', inputSeparation: 'inputSeparation', circuit: 'circuit',
  lock: 'lock' /* output bus: the item's name, add-on 15 */, exportFilter: 'exportFilter' /* ME Export Bus: item names */ } as const;

// ---- What the checker reports ----
export type FeedKind = 'overfill' | 'deadlock' | 'livelock' | 'starvation' | 'deletion';
export type FeedCode = 'feed_crowded' | 'feed_overfill' | 'feed_bench_eject' | 'feed_bench_delete' | 'feed_bench_stuck' | 'feed_no_route'
  | 'feed_pool_starve' | 'feed_fluid_packet' | 'feed_pattern_unencodable' | 'feed_starved' | 'feed_slow' | 'feed_leak' | 'feed_churn';
/** The kind of each code (the plan's Codes table, in table order). */
export const FEED_KINDS: Readonly<Record<FeedCode, FeedKind>> = Object.freeze({
  feed_crowded: 'deadlock', feed_overfill: 'overfill', feed_bench_eject: 'overfill', feed_bench_delete: 'deletion', feed_bench_stuck: 'deadlock',
  feed_no_route: 'deadlock', feed_pool_starve: 'starvation', feed_fluid_packet: 'deadlock', feed_pattern_unencodable: 'deadlock',
  feed_starved: 'starvation', feed_slow: 'starvation', feed_leak: 'starvation', feed_churn: 'livelock',
});
/**
 * The codes that gate a layout: the Codes table's "yes" rows, in table order. `FeedingReport.ok` is true when no `certain`
 * finding has one of them (research §7's acceptance list, plus `feed_no_route`, `feed_pattern_unencodable` and `feed_starved`).
 */
export const FEED_GATE_CODES: readonly FeedCode[] = Object.freeze([
  'feed_crowded', 'feed_bench_eject', 'feed_bench_delete', 'feed_bench_stuck', 'feed_no_route', 'feed_pool_starve', 'feed_fluid_packet',
  'feed_pattern_unencodable', 'feed_starved',
] as const);
export type ScenarioName = 'steady' | 'fast_supplier' | 'late_input' | 'restart' | 'multistack_on';
/** The scenarios `checkFeeding` runs by default, in report order. */
export const SCENARIOS: readonly ScenarioName[] = Object.freeze(['steady', 'fast_supplier', 'late_input', 'restart', 'multistack_on'] as const);
/**
 * One thing the checker found. `phase` `static`: a rule on the layout alone; `sim`: the tick simulation found it in `scenario`.
 * `certainty` `certain`: it will happen; `risk`: it can, under a schedule or a setting the layout does not fix (a risk never gates).
 */
export interface FeedFinding {
  code: FeedCode; kind: FeedKind; phase: 'static' | 'sim'; certainty: 'certain' | 'risk'; scenario?: ScenarioName;
  stepId?: string; machine: string /* `${name} at ${x} ${y} ${z}`, world position */; pos: Vec3; key?: StuffKey;
  text: string; tick?: number; count?: number;
}
/**
 * One thing the checker could not know. `key`: the item it is about, on an unknown raised once per item (`items_dropped`,
 * `pr_queue_lost`, `pr_wander_path`); the model's unknowns are one per code and block, and name their items in `text`.
 */
export interface FeedUnknown { code: string; text: string; pos?: Vec3; stepId?: string; key?: StuffKey }
export interface InputReport {
  stepId: string; machine: string; pos: Vec3; key: StuffKey; plannedPerSecond: number;
  deliveredPerSecond: Partial<Record<ScenarioName, number>>; burst?: { before: number; after: number };
}
export interface ScenarioSummary {
  name: ScenarioName; ticks: number; runs: Record<string, number> /* by stepId */; out: Record<StuffKey, number> /* reached output chests or ME */;
}
export interface FeedingOptions {
  ticks?: number; scenarios?: readonly ScenarioName[]; restartAt?: number; ae2Coprocessors?: number /* 0 */;
  ae2FluidStock?: boolean /* false: ME holds no fluid */; slowTolerance?: number; exhaustive?: boolean /* tests: every entity every tick */;
}
export interface FeedingReport { ok: boolean; findings: FeedFinding[]; inputs: InputReport[]; unknowns: FeedUnknown[]; scenarios: ScenarioSummary[] }

// ---- Time (ticks of 1/20 s) ----
// `DEFAULT_TICKS`: one scenario is 20 minutes. A restart is at `restartAt` (default `Math.floor(ticks / 2)`), and rates are
// taken over the second half `[⌊ticks/2⌋, ticks)`. `STALL_TICKS`: how long a blocked output, a refused slot or a recipe
// that never ran counts as stuck. `LATE_TICKS`: how long `late_input` holds an input back. `FAST_FACTOR`: how many times
// faster `fast_supplier` runs its supplier. `SLOW_TOLERANCE`: `feed_slow` fires below `(1 − SLOW_TOLERANCE)` of the plan.
// `CHURN_ITEMS`: `feed_churn` fires from this many items pulled back out of an input bus, bounced or wandering. `BURST_TICKS`: the
// windows before and after `restartAt` over which `InputReport.burst` counts deliveries.
export const TICKS_PER_SECOND = 20, DEFAULT_TICKS = 24_000, STALL_TICKS = 1_200, LATE_TICKS = 1_200, FAST_FACTOR = 10,
  SLOW_TOLERANCE = 0.1, CHURN_ITEMS = 64, BURST_TICKS = 1_200;
