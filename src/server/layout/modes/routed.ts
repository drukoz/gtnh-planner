// Project Red routed network (Plan 5 Task 8; spec §3.6 mode 2, research gt-mechanics §3.8): every machine gets a routed
// interface pipe on its spine cell, with an Item Responder Chip whitelisting what it takes (the network delivers those
// items to it) and an Item Extractor Chip (it pulls the machine's output back into the network); routed junction
// pipes fill the rest of the spine. The tail holds a request pipe, where the player orders raw inputs from the base's
// network, an input chest the request pipe fills (its own interface pipe extracts them into the line) and an output
// chest whose interface pipe responds to the final outputs. The chip settings are the interface pipes' `config`
// (architecture §11.14). Without a routed network at the base the line is its own network, fed by hand.

import type { StuffKey } from '../../../shared/keys.ts';
import { posKey, step, type Vec3 } from '../../../shared/layout/geometry.ts';
import type { BlockRole, TailChest } from '../../../shared/types/layout.ts';
import type { BomLine, PlanWarning } from '../../../shared/types/plan.ts';
import { comparePos } from '../../world/graph.ts';
import type { BlockConfig, LocalBlock } from '../arrange.ts';
import { linkBits } from '../path.ts';
import type { Part } from '../parts.ts';
import {
  emptyModeResult, finalItemOutputs, itemPorts, itemRisers, nameList, outputSideInputs, placedStepIds, rawItemInputs, RISER_WORDS,
  stepItemInputs, type ModeInput, type ModeResult, type StepDraft,
} from './mode.ts';

const UP = 1, SOUTH = 3, EAST = 5;
const PIPE_ROLES: ReadonlySet<BlockRole> = new Set<BlockRole>(['pipe', 'chip_pipe']);

interface Chip { part: Part; text: string }

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
  const chipsUsed: Chip[] = [];
  const lay = (pos: Vec3, part: Part, role: BlockRole, label: string, config?: BlockConfig): void => {
    blocks.push({ pos, block: { ...part.block }, role, label, item: part.key, ...(config === undefined ? {} : { config }) });
  };
  // the tail chests say which side they are and what they hold (architecture "EnderIO conduits, granted change requests (add-on 11)")
  const layChest = (pos: Vec3, label: string, tail: TailChest): void => {
    blocks.push({ pos, block: { ...parts.chest.block }, role: 'chest', label, item: parts.chest.key, tail });
  };
  /** An interface pipe on `pos` joined to the inventory `onto`; its chips are its config. */
  const layInterface = (pos: Vec3, onto: Vec3, label: string, chips: readonly Chip[]): void => {
    chipsUsed.push(...chips);
    lay(pos, parts.pr_interface, 'chip_pipe', `${parts.pr_interface.name} (${label})`,
      chips.length === 0 ? undefined : { chips: chips.map((c) => c.text).join(' + ') });
    links.push([pos, onto]);
  };
  // a responder with an empty whitelist would take nothing, so there is none
  const responder = (keys: readonly StuffKey[]): Chip[] =>
    (keys.length === 0 ? [] : [{ part: parts.chip_responder, text: `${parts.chip_responder.name} (whitelist: ${nameList(plan, pack, keys)})` }]);
  const extractor: Chip = { part: parts.chip_extractor, text: parts.chip_extractor.name };

  // every machine: a responder for what it takes, an extractor when it makes items
  const portCells = new Set<string>();
  for (const { pos, behind, unit } of ports) {
    layInterface(pos, behind, unit.name, [...responder(stepItemInputs(plan, unit.stepId)), ...(unit.io.itemOut ? [extractor] : [])]);
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
  // joined to the request pipe by a junction
  const request: Vec3 = [tailX, 0, spineZ];
  const inputChest: Vec3 = [tailX, 0, spineZ - 1];
  const outputChest: Vec3 = [tailX, 0, spineZ + 1];
  const placed = placedStepIds(placement);
  const finals = finalItemOutputs(plan, placed);
  lay(request, parts.pr_request, 'pipe', parts.pr_request.name);
  links.push([request, inputChest]);
  layChest(inputChest, 'Chest (input)', { side: 'input', keys: rawItemInputs(plan, placed) });
  layChest(outputChest, 'Chest (output)', { side: 'output', keys: [...finals] });
  lay(step(request, UP), parts.pr_junction, 'pipe', parts.pr_junction.name);
  layInterface(step(inputChest, UP), inputChest, 'input chest', [extractor]);
  layInterface(step(outputChest, UP), outputChest, 'output chest', responder(finals));

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
  for (const chip of [parts.chip_responder, parts.chip_extractor]) {
    const amount = chipsUsed.filter((c) => c.part.id === chip.id).length;
    if (amount > 0) extraParts.push({ key: chip.key, amount, why: 'interface pipe chips', group: 'logistics' });
  }

  const hooked = network?.kind === 'routed';
  const warnings: PlanWarning[] = hooked ? [] : [{ code: 'routed_missing',
    text: 'No Project Red routed network at this base: the line gets its own — put raw inputs in the input chest' }];
  const drafts: StepDraft[] = [
    { id: 'layout:logistics:line', kind: 'logistics', pin: 'site',
      // at the side it touches: "in front of" would read as GT's front, which faces along the row
      text: `Lay routed pipes along the middle row: an interface pipe at every machine's output side or bus${risers.links.length > 0 ? RISER_WORDS : ''}, `
        + 'a request pipe and two chests at the end' },
    { id: 'layout:logistics:request', kind: 'logistics', pin: 'site', text: 'Request raw inputs at the request pipe — they arrive in the input chest' },
  ];

  const bits = linkBits(links);
  return {
    blocks: blocks
      .map((b): LocalBlock => {
        const connections = PIPE_ROLES.has(b.role) ? bits.get(posKey(b.pos)) : undefined;
        return connections === undefined ? b : { ...b, connections };
      })
      .sort((a, b) => comparePos(a.pos, b.pos) || (a.facing ?? -1) - (b.facing ?? -1)),
    // the interface pipe inserts through the machine's output side
    covers: [], configs: [...outputSideInputs(placement).values()].sort((a, b) => comparePos(a.pos, b.pos)),
    logisticsPort: hooked ? request : null,
    hookup: hooked ? { part: 'pr_junction', end: null } : null,
    extraParts, drafts, warnings, tailFluidY: 2,
  };
}
