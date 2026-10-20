// The structured feeding configuration of a laid-out line (architecture §11 entry 51; research
// docs/research/machine-feeding.md §6.4 and §7): the chips of each Project Red routed interface pipe with their filter
// mode and items, the patterns and blocking mode of each AE2 interface, the filter and cards of an ME Export Bus, and
// an Auto Workbench's grid (add-on 12). These are add-on 21's feeding-checker contract
// (`src/server/layout/feeding/contract.ts` in its plan, its architecture request 2), moved here unchanged so the build
// steps, the 3D view, the Connections view and the checker read one structure (its open question 1); its `contract.ts`
// then re-exports them. One thing differs from what add-on 21's reader expects: fix/feeding lays an ME Export Bus as an
// AE2 part on the ME glass cable in front of the machine (the cable block's `CoverSpec` with the `me_export_bus` part,
// facing the machine or its input bus, so the spine's cable runs on through that cell) and writes `exportBus` on that
// cable block, while add-on 21's reading rule 13 looks for a block whose `block` is the bus (as main lays the hookup's
// end). Its reader must also take a block with `feed.exportBus` as an ME Export Bus, its target the neighbour on the
// face of that block's `me_export_bus` cover. Pure TypeScript shared by server and browser: nothing from node:* may be
// imported here.

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
  targets?: Face[];                                     // a wrench target, in world faces like CoverSpec.face; absent = every neighbour
  dual?: boolean;                                       // ae2fc Dual Interface: fluids go in as fluids
}
/** Auto Workbench: mode 'normal' = GT++ mode 0; grid top row first, the planner's concrete items. */
export interface BenchSpec { mode: 'normal'; grid: Array<StuffKey | null>; throughput: 0 | 1 | 2 | 3 }
/** An ME Export Bus feeding a step without an encodable pattern (research §3.5): its config slots in order, its Acceleration Cards. */
export interface ExportBusSpec { keys: StuffKey[]; cards?: 0 | 1 | 2 | 3 | 4 }
export interface FeedSpec { chips?: RoutedChipSpec[]; interface?: InterfaceSpec; bench?: BenchSpec; exportBus?: ExportBusSpec }
