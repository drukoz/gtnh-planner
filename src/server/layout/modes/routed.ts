// Project Red routed network (Plan 5 Task 8; spec §3.6 mode 2, research gt-mechanics §3.8; the feeding fix, architecture
// §11 entry 51, research machine-feeding §2.2 and §6.4 item 1): every machine gets a routed interface pipe on its spine
// cell, with an Item Responder Chip whitelisting what it takes (the network delivers those items to it) and an Item
// Extractor Chip whitelisting what it makes (it pulls those outputs back into the network); routed junction pipes fill
// the rest of the spine. A multiblock's input bus gets only the Responder (an Extractor there would pull the inputs back
// out of the bus: GT's input bus lets them out through its front) and its output bus only the Extractor (an output bus
// takes nothing in). ProjRed-4.12.44-GTNH, read in its bytecode: a new chip's filter is a whitelist with nothing in it
// (`TChipFilter`: `filterExclude` false), so a bare Extractor moves nothing, and an Extractor that lists an item its
// machine cannot let out gives up its whole update; a chip's filter holds 9 items and an interface pipe 4 chips. The
// tail holds a request pipe, where the player orders raw inputs from the base's network, an input chest the request
// pipe fills (its interface pipe's Extractor whitelists everything that enters the line, as EnderIO's input chest does)
// and an output chest whose interface pipe takes everything that leaves the placed machines (to your storage, to a step
// the line places no machine for, or a stray no flow carries, as EnderIO's output chests do) on an Item Terminator
// Chip: routing ranks a Terminator below every Item Responder (`SyncResponse.isPreferredOver` compares the priority
// first, then the chip's preference, and the path finder asks the destinations nearest first), so a machine that takes
// an item gets it before the output chest does, however far the chest is. The chips are the interface pipes'
// structured `feed` (architecture §11 entry 51), which the configure steps word, and the logistics steps name what goes
// in the input chest: the raw inputs to order at the request pipe, and what you make for the line yourself (by hand, in
// your own machines or in a machine run by hand) to put in. Without a routed network at the base the line is its own
// network, fed by hand: you put the raw inputs in too. A machine run by hand (architecture §11 entry 48) gets nothing:
// what the line makes for it waits in the output chest, and what it makes for the line goes in the input chest. A
// venting steam machine's interface pipe meets it on its middle-row side, not its output side (which faces up), and its
// extractor chip pulls its output there (GT gives it on any side but the front).

import { isFluidKey, type StuffKey } from '../../../shared/keys.ts';
import { posKey, step, type Vec3 } from '../../../shared/layout/geometry.ts';
import type { ChipKind, RoutedChipSpec } from '../../../shared/types/feed.ts';
import type { BlockRole, TailChest } from '../../../shared/types/layout.ts';
import type { BomLine, PlanWarning } from '../../../shared/types/plan.ts';
import { comparePos } from '../../world/graph.ts';
import type { LocalBlock } from '../arrange.ts';
import { linkBits } from '../path.ts';
import type { Part, PartId } from '../parts.ts';
import { crossing } from './enderio.ts';
import {
  emptyModeResult, feedSettings, itemPorts, itemRisers, lineExceptions, mergeHostConfigs, nameList, outputSideInputs, placedStepIds, RISER_WORDS,
  stepItemInputs, stepItemOutputs, type ModeInput, type ModeResult, type StepDraft,
} from './mode.ts';

const UP = 1, SOUTH = 3, EAST = 5;
const PIPE_ROLES: ReadonlySet<BlockRole> = new Set<BlockRole>(['pipe', 'chip_pipe']);

/** How many items a chip's filter holds (ProjRed `TChipFilter.filter`: `SimpleInventory(9)`). */
export const CHIP_FILTER_SLOTS = 9;
/** How many chips a Routed Interface Pipe holds (ProjRed `RoutedInterfacePipePart.chipSlots`: `SimpleInventory(4)`). */
export const INTERFACE_CHIP_SLOTS = 4;

/** The part of each chip kind the line lays, in the order the parts list names them. */
const CHIP_PARTS: ReadonlyArray<readonly [ChipKind, PartId]> = [
  ['responder', 'chip_responder'], ['extractor', 'chip_extractor'], ['terminator', 'chip_terminator'],
];

function compareText(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0;
}

/** Each key once, sorted. */
function sorted(keys: Iterable<StuffKey>): StuffKey[] {
  return [...new Set(keys)].sort(compareText);
}

/** Whitelist chips of `kind` for `keys`, nine to a chip in key order; none for no keys. */
function chipsFor(kind: ChipKind, keys: readonly StuffKey[]): RoutedChipSpec[] {
  const chips: RoutedChipSpec[] = [];
  for (let i = 0; i < keys.length; i += CHIP_FILTER_SLOTS) chips.push({ kind, filter: { mode: 'whitelist', keys: keys.slice(i, i + CHIP_FILTER_SLOTS) } });
  return chips;
}

/**
 * The routed spine `[firstX … tailX] × (y 0, z spineZ)` with its interface pipes and chips (junctions up the spine's
 * column to an interface above it, `itemRisers`), and the request tail.
 * Nothing when no placed unit moves items.
 */
export function routedMode(input: ModeInput): ModeResult {
  const { pack, plan, parts, placement, network } = input;
  const { firstX, tailX, spineZ } = placement;
  const ports = itemPorts(placement);
  if (ports.length === 0) return emptyModeResult();

  const blocks: LocalBlock[] = [];
  const links: Array<[Vec3, Vec3]> = [];
  const chipsUsed: RoutedChipSpec[] = [];
  const warnings: PlanWarning[] = [];
  const lay = (pos: Vec3, part: Part, role: BlockRole, label: string, chips?: RoutedChipSpec[]): void => {
    blocks.push({ pos, block: { ...part.block }, role, label, item: part.key, ...(chips === undefined || chips.length === 0 ? {} : { feed: { chips } }) });
  };
  // the tail chests say which side they are and what they hold (architecture "EnderIO conduits, granted change requests (add-on 11)")
  const layChest = (pos: Vec3, label: string, tail: TailChest): void => {
    blocks.push({ pos, block: { ...parts.chest.block }, role: 'chest', label, item: parts.chest.key, tail });
  };
  /**
   * An interface pipe on `pos` joined to the inventory `onto`, holding the first `INTERFACE_CHIP_SLOTS` of `chips`;
   * `routed_chips_short` names the items of the chips left over (`whose`: the pipe's owner, `stepId` its step).
   */
  const layInterface = (pos: Vec3, onto: Vec3, label: string, chips: readonly RoutedChipSpec[], whose: string, stepId?: string): void => {
    const kept = chips.slice(0, INTERFACE_CHIP_SLOTS);
    const left = chips.slice(INTERFACE_CHIP_SLOTS).flatMap((c) => c.filter?.keys ?? []);
    if (left.length > 0) {
      const one = left.length === 1;
      warnings.push({ code: 'routed_chips_short', ...(stepId === undefined ? {} : { stepId }),
        text: `The interface pipe of ${whose} holds ${INTERFACE_CHIP_SLOTS} chips of ${CHIP_FILTER_SLOTS} items each, too few for `
          + `${nameList(plan, pack, left)}: move ${one ? 'it' : 'them'} by hand` });
    }
    chipsUsed.push(...kept);
    lay(pos, parts.pr_interface, 'chip_pipe', `${parts.pr_interface.name} (${label})`, kept);
    links.push([pos, onto]);
  };

  // every machine: a responder for what it takes and an extractor for what it makes; a multiblock's input bus only the
  // responder, its output bus only the extractor
  const blockAt = new Map(placement.blocks.map((b) => [posKey(b.pos), b]));
  const portCells = new Set<string>();
  for (const { pos, behind, unit } of ports) {
    const bus = unit.multiblock ? blockAt.get(posKey(behind))?.hatch : undefined;
    const takes = !unit.multiblock || bus === 'input_bus' ? stepItemInputs(plan, unit.stepId) : [];
    const makes = unit.io.itemOut && (!unit.multiblock || bus === 'output_bus') ? stepItemOutputs(plan, unit.stepId) : [];
    layInterface(pos, behind, unit.name, [...chipsFor('responder', takes), ...chipsFor('extractor', makes)], `the ${unit.name}`, unit.stepId);
    portCells.add(posKey(pos));
  }
  for (let x = firstX; x < tailX; x++) {
    const cell: Vec3 = [x, 0, spineZ];
    if (!portCells.has(posKey(cell))) lay(cell, parts.pr_junction, 'pipe', parts.pr_junction.name);
  }
  // junction pipes climb the spine's column to the interface of a bus GT takes only higher up
  const risers = itemRisers(placement);
  for (const cell of risers.cells) lay(cell, parts.pr_junction, 'pipe', parts.pr_junction.name);

  // the tail: the request pipe on the spine fills the input chest beside it; the chests' interface pipes sit above them,
  // joined to the request pipe by a junction. What crosses the line's edge: the item flows into the placed machines from
  // outside them (raw, a step without machines of its own, a machine run by hand), and those out of them to outside, with
  // each item a placed machine makes that no flow carries (a stray), as EnderIO's chests take them
  const request: Vec3 = [tailX, 0, spineZ];
  const inputChest: Vec3 = [tailX, 0, spineZ - 1];
  const outputChest: Vec3 = [tailX, 0, spineZ + 1];
  const placed = placedStepIds(placement);
  const edge = crossing(plan, plan.flows.filter((f) => !isFluidKey(f.key)), placed);
  const entering = sorted(edge.entering.map((f) => f.key));
  const leaving = sorted([...edge.leaving.map((f) => f.key), ...edge.strays.map((s) => s.key)]);
  lay(request, parts.pr_request, 'pipe', parts.pr_request.name);
  links.push([request, inputChest]);
  layChest(inputChest, 'Chest (input)', { side: 'input', keys: [...entering] });
  layChest(outputChest, 'Chest (output)', { side: 'output', keys: [...leaving] });
  lay(step(request, UP), parts.pr_junction, 'pipe', parts.pr_junction.name);
  layInterface(step(inputChest, UP), inputChest, 'input chest', chipsFor('extractor', entering), 'the input chest');
  layInterface(step(outputChest, UP), outputChest, 'output chest', chipsFor('terminator', leaving), 'the output chest');

  // every pair of face-adjacent pipe cells is joined
  const pipeCells = new Set(blocks.filter((b) => PIPE_ROLES.has(b.role)).map((b) => posKey(b.pos)));
  for (const b of blocks) {
    if (!PIPE_ROLES.has(b.role)) continue;
    for (const side of [UP, SOUTH, EAST]) {
      const next = step(b.pos, side);
      if (pipeCells.has(posKey(next))) links.push([b.pos, next]);
    }
  }

  const extraParts: BomLine[] = [];
  for (const [kind, id] of CHIP_PARTS) {
    const amount = chipsUsed.filter((c) => c.kind === kind).length;
    if (amount > 0) extraParts.push({ key: parts[id].key, amount, why: 'interface pipe chips', group: 'logistics' });
  }

  const hooked = network?.kind === 'routed';
  if (!hooked) {
    warnings.unshift({ code: 'routed_missing',
      text: 'No Project Red routed network at this base: the line gets its own — put raw inputs in the input chest' });
  }
  // what goes in the input chest, by name: the raw inputs, which the request pipe orders from the base's network (with no
  // network there, you put them in), and what you make for the line yourself (by hand, in your own machines or in a
  // machine the line runs by hand), which you put in
  const raw = sorted(edge.entering.filter((f) => f.from === 'raw').map((f) => f.key));
  const made = entering.filter((k) => !raw.includes(k));
  const drafts: StepDraft[] = [
    { id: 'layout:logistics:line', kind: 'logistics', pin: 'site',
      // at the side it touches: "in front of" would read as GT's front, which faces along the row
      text: `Lay routed pipes along the middle row: an interface pipe at every machine's output side or bus${lineExceptions(placement)}`
        + `${risers.links.length > 0 ? RISER_WORDS : ''}, a request pipe and two chests at the end` },
  ];
  if (raw.length > 0) {
    drafts.push(hooked
      ? { id: 'layout:logistics:request', kind: 'logistics', pin: 'site',
        text: `Request the raw inputs at the request pipe — they arrive in the input chest: ${nameList(plan, pack, raw)}` }
      : { id: 'layout:logistics:inputs', kind: 'logistics', pin: 'site', text: `Put the raw inputs in the input chest: ${nameList(plan, pack, raw)}` });
  }
  if (made.length > 0) {
    drafts.push({ id: 'layout:logistics:made', kind: 'logistics', pin: 'site',
      text: `Put what you make for the line yourself in the input chest: ${nameList(plan, pack, made)}` });
  }

  const bits = linkBits(links);
  return {
    blocks: blocks
      .map((b): LocalBlock => {
        const connections = PIPE_ROLES.has(b.role) ? bits.get(posKey(b.pos)) : undefined;
        return connections === undefined ? b : { ...b, connections };
      })
      .sort((a, b) => comparePos(a.pos, b.pos) || (a.facing ?? -1) - (b.facing ?? -1)),
    // the interface pipe inserts through the machine's output side; the machines' feeding settings (architecture §11 entry 51)
    covers: [], configs: mergeHostConfigs([...outputSideInputs(placement).values(), ...feedSettings(pack, plan, placement)]),
    logisticsPort: hooked ? request : null,
    hookup: hooked ? { part: 'pr_junction', end: null } : null,
    extraParts, drafts, warnings, tailFluidY: 2,
  };
}
