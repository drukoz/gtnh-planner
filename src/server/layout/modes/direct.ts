// Machine to machine (Plan 5 Task 7; spec §3.6 mode 1, research gt-mechanics §3.8): one GT item pipe along the spine,
// touching every machine's front. Each machine pushes its output onto it with a conveyor cover sized to its share, and
// has its Input Filter on, because a GT pipe hands an item to any inventory that takes it and GT's item filter cover
// cannot stop a pipe: with the filter on, a machine takes only items its recipes use. Only raw inputs and final outputs
// touch storage, at the tail: an input chest the pipe pulls from, and one output chest per final item behind a one-item
// filter cover. A routed, AE2 or EnderIO item network at the base keeps the input chest stocked; a GT pipe network
// cannot (it only carries what its sources push), so then the inputs go in by hand.

import { joinNames } from '../../../shared/layout/format.ts';
import { OPPOSITE, posKey, step, type Vec3 } from '../../../shared/layout/geometry.ts';
import { FACES } from '../../../shared/types/assets.ts';
import type { TailChest } from '../../../shared/types/layout.ts';
import type { BomLine, PlanWarning } from '../../../shared/types/plan.ts';
import { comparePos } from '../../world/graph.ts';
import type { HostConfig, HostCover, LocalBlock, Placement } from '../arrange.ts';
import { linkBits } from '../path.ts';
import { machineRef, pickItemPipe } from '../parts.ts';
import {
  conveyorCover, finalItemOutputs, itemStacksPerSecond, nameList, outputSideInputs, placedStepIds, rawItemInputs, rawItemRate, spineConflicts,
  unitItemRate, type ModeHookup, type ModeInput, type ModeResult, type StepDraft,
} from './mode.ts';

const NORTH = 2, SOUTH = 3;

function noLine(warnings: PlanWarning[]): ModeResult {
  return { blocks: [], covers: [], configs: [], logisticsPort: null, hookup: null, extraParts: [], drafts: [], warnings, tailFluidY: 1 };
}

/**
 * Links every spine port to the unit cell behind it, and gives that cell its Input Filter: a singleblock's spine face
 * is its output side (it takes items there with "allow input from the output side" when it has item inputs, as in
 * every mode), a multiblock takes items only through its input bus. Sorted by pos.
 */
function spineContacts(placement: Placement, spine: ReadonlySet<string>, links: Array<[Vec3, Vec3]>): HostConfig[] {
  const blockAt = new Map(placement.blocks.map((b) => [posKey(b.pos), b]));
  const fromOutputSide = outputSideInputs(placement);
  const configs = new Map<string, HostConfig>();
  for (const u of placement.units) {
    const inputBuses = new Set(u.cells.filter((c) => c.hatch === 'input_bus').map((c) => c.block.mteId));
    for (const port of u.ports.items) {
      if (!spine.has(posKey(port))) continue;
      const cell = step(port, OPPOSITE[u.facing]!);
      links.push([port, cell]);
      if (!u.multiblock) {
        configs.set(posKey(cell), { pos: cell, config: { inputFilter: true, ...fromOutputSide.get(posKey(cell))?.config } });
        continue;
      }
      const b = blockAt.get(posKey(cell));
      if (b?.role === 'hatch' && b.stepId === u.stepId && inputBuses.has(b.block.mteId)) configs.set(posKey(cell), { pos: cell, config: { inputFilter: true } });
    }
  }
  return [...configs.values()].sort((a, b) => comparePos(a.pos, b.pos));
}

/**
 * How the base's network keeps the input chest stocked (spec §3.6 "hooked into whatever network exists"): a routed
 * interface pipe with a stock keeper chip, an ME export bus, or an EnderIO conduit fed from a whitelisted extract face
 * at the storage tap. Null for a GT pipe network or none.
 */
function networkHookup(input: ModeInput, rawNames: string): { hookup: ModeHookup; extraParts: BomLine[]; drafts: StepDraft[] } | null {
  const { parts, network } = input;
  switch (network?.kind) {
    case 'routed':
      return {
        hookup: { part: 'pr_junction', end: 'pr_interface', endConfig: { chips: `Item Stock Keeper Chip, keep in stock: ${rawNames}` } },
        extraParts: [{ key: parts.chip_stock_keeper.key, amount: 1, why: 'stock keeper on the input chest', group: 'logistics' }], drafts: [],
      };
    case 'ae2':
      return { hookup: { part: 'me_cable', end: 'me_export_bus', endConfig: { exportFilter: rawNames } }, extraParts: [], drafts: [] };
    case 'enderio':
      return {
        hookup: { part: 'eio_item_conduit', end: null },
        extraParts: [{ key: parts.eio_basic_filter.key, amount: 1, why: 'filter at the storage tap', group: 'logistics' }],
        // the extract face is on the base's own conduit, so it is not a placed block's setting
        drafts: [{ id: 'layout:configure:conduit', kind: 'configure', pin: 'logistics',
          text: `At the storage tap set the conduit face to Extract with a Basic Item Filter, whitelist: ${rawNames}; on the input chest face set Insert` }],
      };
    default:
      return null;
  }
}

/**
 * The shared spine pipe `[firstX … tailX] × (y 0, z spineZ)` with its covers, input filters, tail chests and hookup.
 * Nothing when no placed unit moves items; only `no_pipe` when the pack has no GT item pipe.
 */
export function directMode(input: ModeInput): ModeResult {
  const { pack, plan, parts, placement } = input;
  const { units, firstX, tailX, spineZ } = placement;
  if (!units.some((u) => u.io.itemIn || u.io.itemOut)) return noLine([]);
  const placed = placedStepIds(placement);
  const pipe = pickItemPipe(pack, itemStacksPerSecond(plan, placed));
  if (pipe === null) return noLine([{ code: 'no_pipe', text: 'No GT item pipe in this export: move items by hand' }]);

  const blocks: LocalBlock[] = [];
  const links: Array<[Vec3, Vec3]> = [];
  const covers: HostCover[] = [];
  const warnings: PlanWarning[] = [];
  const layPipe = (pos: Vec3): void => {
    blocks.push({ pos, block: machineRef(pipe), role: 'pipe', label: pipe.name, item: pipe.itemKey });
  };
  // the tail chests say which side they are and what they hold (architecture "EnderIO conduits, granted change requests (add-on 11)")
  const layChest = (pos: Vec3, label: string, tail: TailChest): void => {
    blocks.push({ pos, block: { ...parts.chest.block }, role: 'chest', label, item: parts.chest.key, tail });
  };

  const spine = new Set<string>();
  for (let x = firstX; x <= tailX; x++) {
    const cell: Vec3 = [x, 0, spineZ];
    layPipe(cell);
    spine.add(posKey(cell));
    if (x > firstX) links.push([[x - 1, 0, spineZ], cell]);
  }
  const configs = spineContacts(placement, spine, links);

  const names = new Map(units.map((u) => [u.stepId, u.name]));
  for (const { stepId, keys } of spineConflicts(pack, plan, placed)) {
    warnings.push({ code: 'spine_misroute', stepId,
      text: `${names.get(stepId) ?? stepId} also has recipes for ${nameList(plan, pack, keys)} carried by the shared pipe, so they can end up in it: `
        + 'give it its own pipe or feed it by hand' });
  }

  // every output face pushes its machine's share onto the pipe (architecture §11.13 sizing)
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

  // the tail: the input chest north of the tail pipe, output chest i south of tail pipe cell i (one item per filter)
  const tail: Vec3 = [tailX, 0, spineZ];
  const raw = rawItemInputs(plan, placed);
  let inputChest: Vec3 | null = null;
  if (raw.length > 0) {
    inputChest = [tailX, 0, spineZ - 1];
    layChest(inputChest, 'Chest (input)', { side: 'input', keys: [...raw] });
    links.push([tail, inputChest]);
    const { cover, warning } = conveyorCover(input, { pos: tail, side: NORTH }, 'import', false, rawItemRate(plan, placed), 'the input chest');
    covers.push(cover);
    if (warning !== null) warnings.push(warning);
  }
  const outputs = finalItemOutputs(plan, placed);
  outputs.forEach((key, i) => {
    const cell: Vec3 = [tailX, i, spineZ];
    const chest: Vec3 = [tailX, i, spineZ + 1];
    if (i > 0) {
      layPipe(cell);
      links.push([[tailX, i - 1, spineZ], cell]);
    }
    layChest(chest, 'Chest (output)', { side: 'output', keys: [key] });
    links.push([cell, chest]);
    covers.push({ pos: cell, cover: { face: FACES[SOUTH]!, item: parts.item_filter_cover.key, settings: { mode: 'whitelist' }, filter: [key] } });
  });

  const hooked = inputChest === null ? null : networkHookup(input, nameList(plan, pack, raw));

  const chests = [...(inputChest === null ? [] : ['an input chest']),
    ...(outputs.length === 0 ? [] : [outputs.length === 1 ? 'an output chest' : `${outputs.length} output chests`])];
  const pipeCells = blocks.filter((b) => b.role === 'pipe').length;
  const drafts: StepDraft[] = [{ id: 'layout:logistics:line', kind: 'logistics', pin: 'site',
    text: `Lay ${pipeCells}× ${pipe.name} along the middle row so it touches every machine's front${chests.length > 0 ? `, with ${joinNames(chests)} at the end` : ''}` },
  ...(hooked?.drafts ?? [])];

  const bits = linkBits(links);
  return {
    blocks: blocks
      .map((b): LocalBlock => {
        const connections = b.role === 'pipe' ? bits.get(posKey(b.pos)) : undefined;
        return connections === undefined ? b : { ...b, connections };
      })
      .sort((a, b) => comparePos(a.pos, b.pos) || (a.facing ?? -1) - (b.facing ?? -1)),
    covers: covers.sort((a, b) => comparePos(a.pos, b.pos) || FACES.indexOf(a.cover.face) - FACES.indexOf(b.cover.face)),
    configs,
    logisticsPort: hooked === null ? null : inputChest,
    hookup: hooked?.hookup ?? null,
    extraParts: hooked?.extraParts ?? [],
    drafts, warnings, tailFluidY: Math.max(1, outputs.length),
  };
}
