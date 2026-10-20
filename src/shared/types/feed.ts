// The structured feeding configuration of a laid-out line (architecture §11 entry 51; research
// docs/research/machine-feeding.md §6.4 and §7): the chips of each Project Red routed interface pipe with their filter
// mode and items, the patterns and blocking mode of each AE2 interface, and an Auto Workbench's grid (add-on 12). These
// are add-on 21's feeding-checker contract (`src/server/layout/feeding/contract.ts` in its plan), moved here unchanged
// so the build steps, the 3D view, the Connections view and the checker read one structure (its open question 1).
// Pure TypeScript shared by server and browser: nothing from node:* may be imported here.

import type { StuffKey } from '../keys.ts';
import type { Face } from './assets.ts';

export interface ItemFilterSpec { mode: 'whitelist' | 'blacklist'; keys: StuffKey[] }
export type ChipKind = 'responder' | 'extractor' | 'broadcaster' | 'stock_keeper' | 'terminator' | 'overflow';
/** One chip of a Routed Interface Pipe, in chip-slot order (at most 4). A new chip: responder and extractor whitelist [], broadcaster blacklist []. */
export interface RoutedChipSpec {
  kind: ChipKind;
  filter?: ItemFilterSpec;                              // responder, extractor, broadcaster, terminator
  stock?: Array<{ key: StuffKey; count: number }>;      // stock keeper: up to 9, counts 1–255
  requestMode?: 'when_missing' | 'when_empty' | 'infinite';   // stock keeper; default 'when_missing'
  priority?: number;                                    // the chip's own priority setting; default 0
}
/** A processing pattern: whole amounts per craft; item keys only once encodable. */
export interface PatternSpec { inputs: Array<{ key: StuffKey; amount: number }>; outputs: Array<{ key: StuffKey; amount: number }> }
export interface InterfaceSpec {
  patterns: PatternSpec[]; blocking: boolean; smartBlocking?: boolean;
  lock?: 'none' | 'until_result';                       // Locking Card on "Until crafting result is returned"
  targets?: Face[];                                     // a wrench target; absent = every neighbour
  dual?: boolean;                                       // ae2fc Dual Interface: fluids go in as fluids
}
/** Auto Workbench: mode 'normal' = GT++ mode 0; grid top row first, the planner's concrete items. */
export interface BenchSpec { mode: 'normal'; grid: Array<StuffKey | null>; throughput: 0 | 1 | 2 | 3 }
export interface FeedSpec { chips?: RoutedChipSpec[]; interface?: InterfaceSpec; bench?: BenchSpec }
