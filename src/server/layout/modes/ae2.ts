// AE2 (Plan 5 Task 8; spec §3.6 mode 3, research gt-mechanics §3.8): every machine gets an ME interface on its spine
// cell, holding one processing pattern for the machine's recipe (the interface pushes the pattern's inputs into the
// machine), and the machine pushes its output back into the interface with a conveyor cover sized to its share. ME
// glass cable fills the rest of the spine, the tail included, where the base's ME network joins the line. Each
// interface takes a channel, so the line is checked against the channels the network has free. The pattern settings
// are the interfaces' `config` (architecture §11.14). Without an AE2 network at the base the ME parts cannot work: the
// layout says so and never assumes one.

import { posKey, type Vec3 } from '../../../shared/layout/geometry.ts';
import { FACES } from '../../../shared/types/assets.ts';
import type { BomLine, PlanWarning } from '../../../shared/types/plan.ts';
import { comparePos } from '../../world/graph.ts';
import type { HostCover, LocalBlock } from '../arrange.ts';
import { linkBits } from '../path.ts';
import {
  amountList, conveyorCover, emptyModeResult, itemPorts, itemRisers, outputSideInputs, RISER_WORDS, unitItemRate, type ModeInput,
  type ModeResult, type StepDraft,
} from './mode.ts';

/** A network whose scan gives no channel figures is taken to have the 8 channels of a network without a controller. */
const DEFAULT_CHANNELS_MAX = 8;

/**
 * The ME spine `[firstX … tailX] × (y 0, z spineZ)`: interfaces with their patterns, cable between and up the spine's
 * column to an interface above it (`itemRisers`), output covers on the machines. Nothing when no placed unit moves items.
 */
export function ae2Mode(input: ModeInput): ModeResult {
  const { pack, plan, parts, placement, network } = input;
  const { units, firstX, tailX, spineZ } = placement;
  const ports = itemPorts(placement);
  if (ports.length === 0) return emptyModeResult();

  // one interface per item port; the unit's first one holds its pattern (per-run amounts from the plan step)
  const blocks: LocalBlock[] = [];
  const portCells = new Set<string>();
  let patterns = 0;
  for (const { pos, unit, first } of ports) {
    const planStep = plan.steps.find((s) => s.id === unit.stepId);
    const pattern = `${amountList(plan, pack, planStep?.inputs ?? [])} → ${amountList(plan, pack, planStep?.outputs ?? [])}`;
    const config = first ? { patterns: 1, pattern, blockingMode: false } : undefined;
    if (first) patterns += 1;
    blocks.push({
      pos, block: { ...parts.me_interface.block }, role: 'interface', label: `${parts.me_interface.name} (${unit.name})`, item: parts.me_interface.key,
      ...(config === undefined ? {} : { config }),
    });
    portCells.add(posKey(pos));
  }
  const links: Array<[Vec3, Vec3]> = [];
  for (let x = firstX; x <= tailX; x++) {
    const cell: Vec3 = [x, 0, spineZ];
    if (!portCells.has(posKey(cell))) {
      blocks.push({ pos: cell, block: { ...parts.me_cable.block }, role: 'pipe', label: parts.me_cable.name, item: parts.me_cable.key });
    }
    if (x > firstX) links.push([[x - 1, 0, spineZ], cell]);
  }
  // cable climbs the spine's column to the interface of a bus GT takes only higher up
  const risers = itemRisers(placement);
  for (const cell of risers.cells) blocks.push({ pos: cell, block: { ...parts.me_cable.block }, role: 'pipe', label: parts.me_cable.name, item: parts.me_cable.key });
  links.push(...risers.links);

  // every output face pushes its machine's share into the interface in front of it
  const covers: HostCover[] = [];
  const warnings: PlanWarning[] = [];
  const rateWarned = new Set<string>();
  for (const u of units) {
    for (const face of u.ports.itemFaces) {
      const { cover, warning } = conveyorCover(input, face, 'export', true, unitItemRate(plan, u.stepId), u.name, u.stepId);
      covers.push(cover);
      if (warning !== null && !rateWarned.has(u.stepId)) {
        rateWarned.add(u.stepId);
        warnings.push(warning);
      }
    }
  }

  const hooked = network?.kind === 'ae2';
  if (!hooked) {
    warnings.push({ code: 'ae2_missing', text: 'No AE2 network at this base: the ME parts need an ME controller and drive — build those first (not in this list)' });
  } else {
    const free = Math.max(0, (network.channelsMax ?? DEFAULT_CHANNELS_MAX) - (network.channelsUsed ?? 0));
    if (ports.length > free) warnings.push({ code: 'ae2_channels', text: `The line needs ${ports.length} channels; the AE2 network has ${free} free` });
  }

  const extraParts: BomLine[] = [{ key: parts.blank_pattern.key, amount: patterns, why: 'one processing pattern per machine', group: 'logistics' }];
  const drafts: StepDraft[] = [{ id: 'layout:logistics:line', kind: 'logistics', pin: 'site',
    text: `Lay ME glass cable along the middle row with an ME interface at every machine's output side or bus${risers.links.length > 0 ? RISER_WORDS : ''}` }];

  // cable cells show their joins to the spine cells beside them; an interface is a full block
  const bits = linkBits(links);
  return {
    blocks: blocks
      .map((b): LocalBlock => {
        const connections = b.role === 'pipe' ? bits.get(posKey(b.pos)) : undefined;
        return connections === undefined ? b : { ...b, connections };
      })
      .sort((a, b) => comparePos(a.pos, b.pos) || (a.facing ?? -1) - (b.facing ?? -1)),
    covers: covers.sort((a, b) => comparePos(a.pos, b.pos) || FACES.indexOf(a.cover.face) - FACES.indexOf(b.cover.face)),
    // the interface pushes the pattern's inputs through the machine's output side
    configs: [...outputSideInputs(placement).values()].sort((a, b) => comparePos(a.pos, b.pos)),
    logisticsPort: hooked ? [tailX, 0, spineZ] : null,
    hookup: hooked ? { part: 'me_cable', end: null } : null,
    extraParts, drafts, warnings, tailFluidY: 1,
  };
}
