// The feeding checker's normalized line (plan `docs/superpowers/plans/2026-10-20-21-feeding-checker.md` Task 2): what
// `readLine` makes of a laid-out line, and what the static rules and the simulation read. Every position and side in
// it is the line's own local frame (`frame.ts`: the line turned back to rotation 0 at its min corner), so a line reads
// the same in every rotation and wherever it was dragged; `pos` is the world cell, for texts and the report. Every list
// is sorted by local position, then local side. Ids are the local cell, `x,y,z` (`nodeId`).
// Pure TypeScript: nothing from node:* may be imported here.

import type { StuffKey } from '../../../shared/keys.ts';
import type { Vec3 } from '../../../shared/layout/geometry.ts';
import type { DyeColor, RedstoneMode } from '../../../shared/types/layout.ts';
import type { LogisticsMode, PlanFlow } from '../../../shared/types/plan.ts';
import type { FeedConduitFilter, FeedUnknown, InterfaceSpec, ItemFilterSpec, RoutedChipSpec } from './contract.ts';

export type NodeId = string;                                  // `${x},${y},${z}` of the local cell
export interface SimRecipe {
  stepId: string; ticks: number;                              // the plan step's durationTicks, at least 1
  inputs: Array<{ key: StuffKey; amount: number; chance: number }>;   // consumed items per run (chance = probability consumed)
  held: StuffKey[];                                           // not consumed, not a programmed circuit: each sits in an input slot
  outputs: Array<{ key: StuffKey; amount: number; chance: number }>;  // item outputs in recipe order (output i ↔ output slot i)
  fluidsIn: Array<{ key: StuffKey; amount: number }>; fluidsOut: Array<{ key: StuffKey; amount: number }>;
}
/** A singleblock's settings from its `config` (`CONFIG_KEYS`): the layout's boolean, else null (GT's default, an unknown). */
export interface MachineSettings { multiStack: boolean | null; inputFilter: boolean | null; inputFromOutputSide: boolean | null; autoOutput: boolean | null }
interface NodeBase {
  id: NodeId; pos: Vec3; local: Vec3; name: string; label: string /* `${name} at x y z` */; stepIds: string[]; recipes: SimRecipe[];
  kinds: StuffKey[];                                          // the item kinds it takes: distinct consumed item keys of its recipes, sorted
}
export interface BasicNode extends NodeBase {
  kind: 'basic'; mteId: number; tier: number; inSlots: number; outSlots: number; outputSide: number; front: number; maps: string[]; settings: MachineSettings;
  steam: boolean;                                             // pack kind `steam` (E17): no cover, no auto-output, AE2 outputs by hand
}
export interface BusNode { id: NodeId; pos: Vec3; local: Vec3; label: string; front: number; slots: number; limited: boolean | null; inputFilter: boolean | null; maps: string[] }
export interface OutBusNode { id: NodeId; pos: Vec3; local: Vec3; label: string; front: number; slots: number; lock: StuffKey | null /* `config.lock` */ }
export interface MultiNode extends NodeBase { kind: 'multi'; mteId: number; inBuses: BusNode[]; outBuses: OutBusNode[]; inputSeparation: boolean | null; separationDefault: boolean }
export interface BenchNode extends NodeBase {
  kind: 'bench'; mteId: number; tier: number; front: number; back: number; grid: Array<StuffKey | null>; result: { key: StuffKey; amount: number };
  containers: Record<StuffKey, StuffKey>; throughput: number;
  fluidSides: number[]; powerSides: number[]; itemPipeSides: number[];   // sides whose neighbour connects toward it (GT6-style, E17)
}
export interface ChestNode { kind: 'chest'; id: NodeId; pos: Vec3; local: Vec3; label: string; side: 'input' | 'output'; keys: StuffKey[] /* an input chest's stocked keys */ }
export type FeedNode = BasicNode | MultiNode | BenchNode | ChestNode;
/** An inventory a network touches: a node, or a bus of the multiblock node `node`. */
export interface InvRef { node: NodeId; bus?: NodeId; side: number /* the inventory's own side that faces the network */ }
/**
 * One face of an item conduit. A Limited Item Filter without counts is read as a whitelist of its keys (no `limits`),
 * with the unknown `limited_counts_missing`.
 */
export interface EioFace {
  id: string /* `${conduit}:${side}` */; conduit: NodeId; side: number; target: InvRef | null; label: string;
  extract?: { color: DyeColor; filter: FeedConduitFilter | null; max: number; roundRobin: boolean; selfFeed: boolean; redstone: RedstoneMode };
  insert?: { color: DyeColor; filter: FeedConduitFilter | null; priority: number };
}
/** `hops[a][b]`: breadth-first conduit hops between the network's conduit cells. */
export interface EioNet { kind: 'enderio'; faces: EioFace[]; hops: Record<NodeId, Record<NodeId, number>> }
/** Every Project Red pipe of a network; only a Routed Interface Pipe (role `chip_pipe`) has chips and a target. */
export interface RoutedPipe { id: NodeId; label: string; chips: RoutedChipSpec[]; target: InvRef | null }
/** `hops[a][b]`: breadth-first pipe hops between any two pipes of the network, junctions included. */
export interface RoutedNet { kind: 'routed'; pipes: RoutedPipe[]; hops: Record<NodeId, Record<NodeId, number>> }
/** An ME interface; `spec.targets`, when the layout gives them, are turned into the line's local faces like every side here. */
export interface Ae2Iface { id: NodeId; label: string; spec: InterfaceSpec; targets: InvRef[] }
export interface Ae2ExportBus { id: NodeId; label: string; keys: StuffKey[] /* config slots in order */; amount: number /* per operation, E16 */; target: InvRef | null }
export interface Ae2Net { kind: 'ae2'; interfaces: Ae2Iface[]; exportBuses: Ae2ExportBus[] }
export interface GtPipe { id: NodeId; label: string; capacity: number /* stacks per 20 ticks */; links: number /* local bits 1 << side */; sides: Array<{ side: number; target: InvRef }> }
export interface GtPipeNet { kind: 'gtpipe'; pipes: GtPipe[] }
export type FeedNetwork = EioNet | RoutedNet | Ae2Net | GtPipeNet;
export interface GtCover {
  host: NodeId; side: number; kind: 'conveyor' | 'filter' | 'shutter';
  export: boolean; allowInput: boolean; op?: { tickRate: number; stacks: number; items: number }; filter?: ItemFilterSpec;
  shutter?: 'input_only' | 'output_only' | 'open';
}
export interface FeedModel {
  mode: LogisticsMode; nodes: FeedNode[]; networks: FeedNetwork[]; covers: GtCover[];
  supply: StuffKey[]; sinks: StuffKey[];                      // into the line from outside; out of it (sorted)
  planned: Record<string, Record<StuffKey, number>>;          // stepId → item → per second for each machine of the step
  makers: Record<StuffKey, string[]>;                         // laid-out stepIds whose flows carry the item
  laid: string[];                                             // stepIds with at least one machine node, plan order
  fed: Record<string, StuffKey[]>; made: Record<string, StuffKey[]>;   // stepItemInputs / stepItemOutputs of every plan step (text fallbacks only: "takes 2+ kinds" is `node.kinds`)
  itemFlows: PlanFlow[];                                      // the plan's item flows, plan order
  /**
   * `stepDepths(plan)` (ruling R-20): 0 for a step fed only from raw, else 1 + the deepest step feeding it. The AE2 model
   * orders its tasks by it; a step a model does not list (a hand-built fixture model) counts as depth 0.
   */
  depths: Record<string, number>;
  unknowns: FeedUnknown[]; nameOf(key: StuffKey): string; stepName(stepId: string): string;   // main output's name, else the machine's
  mapTakes(map: string, key: StuffKey): boolean;              // some recipe of the map takes the item (GT's containsInput)
  mapPair(map: string, a: StuffKey, b: StuffKey): boolean;    // some recipe of the map takes both
  circuitOre(key: StuffKey): boolean;                         // the item has an ore name starting `circuit`
}
