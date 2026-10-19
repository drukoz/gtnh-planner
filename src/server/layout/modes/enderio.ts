// EnderIO conduits (plan 11 Task 3; spec §3.6 mode 4, architecture "EnderIO conduits, granted change requests (add-on
// 11)"): one Item Conduit along the spine, touching every machine's front. Each face toward a machine or a tail chest is
// set on its own: Extract (EnderIO INPUT) what the machine makes, Insert (OUTPUT) what it takes, or In / Out for both,
// each side with its own channel colour and a whitelist of its exact items in the smallest item filter that holds them;
// faces toward any other machine, bus or chest are Disabled. Extract sides get the speed upgrades their rate needs, round
// robin when they feed several faces, self feed off and redstone Always active (an unset face extracts only with a
// signal); insert sides fill machines before chests. The plan's flows link what makes an item to what takes it, and
// linked sides share a channel. Only raw inputs and final outputs touch storage, at the tail: an input chest the line
// extracts from, which an EnderIO network at the base keeps stocked on Green (a colour the line never uses), and output
// chests of 24 items each. Every order and tie-break is fixed, so the same plan gives the same faces and colours.

import { isFluidKey, type StuffKey } from '../../../shared/keys.ts';
import { conduitSideText } from '../../../shared/layout/configure-text.ts';
import {
  CHANNEL_PALETTE, CONDUIT_NAMES, DEFAULT_CHANNEL, DYE_NAMES, ITEM_CONDUIT, ITEM_FILTER_SLOTS, itemFaceRate,
} from '../../../shared/layout/enderio.ts';
import { fmtInt, fmtRate, joinNames } from '../../../shared/layout/format.ts';
import { posKey, sideToward, step, type Vec3 } from '../../../shared/layout/geometry.ts';
import { FACES } from '../../../shared/types/assets.ts';
import type { ConduitExtract, ConduitFace, ConduitFilter, ConduitInsert, ConduitMode, TailChest } from '../../../shared/types/layout.ts';
import type { BomLine, Plan, PlanFlow, PlanWarning } from '../../../shared/types/plan.ts';
import { comparePos } from '../../world/graph.ts';
import type { HostConfig, LocalBlock, PlacedUnit, Placement } from '../arrange.ts';
import { assignChannels, itemFilterFor, speedUpgradesFor, type ChannelEnd, type ChannelLink } from '../conduits.ts';
import type { Parts } from '../parts.ts';
import { linkBits } from '../path.ts';
import {
  emptyModeResult, itemPorts, nameList, placedStepIds, stepItemInputs, stepItemOutputs, unitItemRate,
  type ItemPort, type ModeHookup, type ModeInput, type ModeResult, type StepDraft,
} from './mode.ts';

const NORTH = 2, SOUTH = 3;
const INPUT_CHEST = 'Chest (input)', OUTPUT_CHEST = 'Chest (output)';

// ---- Types and small helpers ----

type SideName = 'extract' | 'insert';

/** One side of a face before its channel is known: the items it passes and the items/s it must move. */
interface Side { keys: StuffKey[]; rate: number }

/**
 * A face of an Item Conduit cell that trades with what it touches: a machine's item port (`stepId` its step) or a tail
 * chest (`stepId` null, where the line meets its storage). It has an extract side, an insert side or both.
 */
interface FacePlan { pos: Vec3; side: number; target: string; stepId: string | null; extract: Side | null; insert: Side | null }

/** The item flows that cross the line's edge, and the items placed steps make that no flow carries. */
interface Crossing { entering: PlanFlow[]; leaving: PlanFlow[]; strays: Array<{ stepId: string; key: StuffKey }> }

function compareText(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0;
}

/** Each key once, sorted. */
function distinctKeys(keys: Iterable<StuffKey>): StuffKey[] {
  return [...new Set(keys)].sort(compareText);
}

function sumRate(flows: readonly PlanFlow[]): number {
  return flows.reduce((sum, f) => sum + f.perSecond, 0);
}

/** `list` cut into slices of `size`, in order. */
function slices<T>(list: readonly T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < list.length; i += size) out.push(list.slice(i, i + size));
  return out;
}

/** The channel end of one side of a face. */
function endId(face: FacePlan, side: SideName): string {
  return `${posKey(face.pos)}:${face.side}:${side}`;
}

function faceKey(pos: Vec3, side: number): string {
  return `${posKey(pos)}:${side}`;
}

/** EnderIO's connection mode for a face with these sides. */
function modeOf(extract: boolean, insert: boolean): ConduitMode {
  return extract && insert ? 'in_out' : extract ? 'extract' : insert ? 'insert' : 'disabled';
}

// ---- The face plan ----

/** The bus behind a multiblock's port, told apart by the mteIds of the unit's bus cells (as direct.ts `spineContacts` does). */
function busOf(u: PlacedUnit, b: LocalBlock | undefined): 'input_bus' | 'output_bus' | null {
  if (b?.role !== 'hatch' || b.stepId !== u.stepId) return null;
  for (const c of u.cells) {
    if ((c.hatch === 'input_bus' || c.hatch === 'output_bus') && c.block.mteId === b.block.mteId) return c.hatch;
  }
  return null;
}

/** Σ item flows into the step ÷ step.count: the items/s each of its machines takes in. */
function unitItemIntake(plan: Plan, items: readonly PlanFlow[], stepId: string): number {
  const count = plan.steps.find((s) => s.id === stepId)?.count ?? 1;
  return sumRate(items.filter((f) => f.to === stepId)) / Math.max(1, count);
}

/**
 * The face of every item port toward its unit, in unit then port order: a singleblock's extracts every item it makes and
 * inserts every item it takes; a multiblock's extracts toward an output bus and inserts toward an input bus, with all of
 * the step's items on every bus (plan 11, ruling R10). A unit's rates are split evenly over its extract faces and over
 * its insert faces. With them, `inputFromOutputSide` on every singleblock that takes items (its front, the face, is its
 * output side), sorted by pos.
 */
function machineFaces(plan: Plan, items: readonly PlanFlow[], placement: Placement): { faces: FacePlan[]; configs: HostConfig[] } {
  const blockAt = new Map(placement.blocks.map((b) => [posKey(b.pos), b]));
  const portsOf = new Map<PlacedUnit, ItemPort[]>();
  for (const p of itemPorts(placement)) {
    const list = portsOf.get(p.unit);
    if (list === undefined) portsOf.set(p.unit, [p]);
    else list.push(p);
  }
  const faces: FacePlan[] = [];
  const configs: HostConfig[] = [];
  for (const [u, ports] of portsOf) {
    const makes = stepItemOutputs(plan, u.stepId), takes = stepItemInputs(plan, u.stepId);
    const roles = ports.map((port) => {
      const bus = u.multiblock ? busOf(u, blockAt.get(posKey(port.behind))) : null;
      return {
        port, extracts: makes.length > 0 && (!u.multiblock || bus === 'output_bus'), inserts: takes.length > 0 && (!u.multiblock || bus === 'input_bus'),
      };
    });
    const extractRate = unitItemRate(plan, u.stepId) / Math.max(1, roles.filter((r) => r.extracts).length);
    const insertRate = unitItemIntake(plan, items, u.stepId) / Math.max(1, roles.filter((r) => r.inserts).length);
    for (const { port, extracts, inserts } of roles) {
      if (!extracts && !inserts) continue;
      faces.push({
        pos: port.pos, side: sideToward(port.pos, port.behind), target: u.name, stepId: u.stepId,
        extract: extracts ? { keys: makes, rate: extractRate } : null, insert: inserts ? { keys: takes, rate: insertRate } : null,
      });
      if (!u.multiblock && inserts) configs.push({ pos: [...port.behind], config: { inputFromOutputSide: true } });
    }
  }
  return { faces, configs: configs.sort((a, b) => comparePos(a.pos, b.pos)) };
}

/**
 * What crosses the line's edge (spec §3.6: only raw inputs and final outputs touch storage). Entering: the item flows into
 * a placed step from outside the line (raw, or a step whose machines are all owned). Leaving: the item flows from a placed
 * step to outside it (out, sink, or such a step). Strays: each item a placed step makes that no flow carries (a chance
 * byproduct), so that it leaves through an output chest and no machine clogs.
 */
function crossing(plan: Plan, items: readonly PlanFlow[], placed: ReadonlySet<string>): Crossing {
  return {
    entering: items.filter((f) => !placed.has(f.from) && placed.has(f.to)),
    leaving: items.filter((f) => placed.has(f.from) && !placed.has(f.to)),
    strays: [...placed].flatMap((stepId) => stepItemOutputs(plan, stepId)
      .filter((key) => !items.some((f) => f.from === stepId && f.key === key))
      .map((key) => ({ stepId, key }))),
  };
}

// ---- Warnings ----

/** A face that cannot move its rate even with every speed upgrade (plan 11, ruling R9, for the input chest's face too). */
function rateWarning(parts: Parts, rate: number, from: string, stepId: string | null): PlanWarning {
  const most = ITEM_CONDUIT.maxUpgrades;
  const text = `No item conduit face moves ${fmtRate(rate)} items/s out of ${from}: ${fmtInt(most)} ${parts.eio_speed_upgrade.name}s move `
    + `${fmtRate(itemFaceRate(most))} items/s, so the line runs slower`;
  return stepId === null ? { code: 'conduit_rate', text } : { code: 'conduit_rate', stepId, text };
}

/** A side whose filter is full: the items it leaves out. */
function filterFullWarning(input: ModeInput, face: FacePlan, side: SideName, filter: ConduitFilter, dropped: readonly StuffKey[]): PlanWarning {
  const one = dropped.length === 1;
  const text = `The ${side} filter toward ${face.target} holds ${fmtInt(filter.keys.length)} items, so ${nameList(input.plan, input.pack, dropped)} `
    + `${one ? 'is' : 'are'} left out: move ${one ? 'it' : 'them'} by hand`;
  return face.stepId === null ? { code: 'filter_full', text } : { code: 'filter_full', stepId: face.stepId, text };
}

// ---- Disabled faces ----

/**
 * What an Item Conduit side could trade with, by posKey, with the name its face shows: every singleblock machine,
 * multiblock controller and input or output bus (by its unit's name), and the tail chests (by their label).
 */
function traders(placement: Placement, chests: readonly LocalBlock[]): Map<string, string> {
  const unitOf = new Map<string, PlacedUnit>();
  for (const u of placement.units) if (!unitOf.has(u.stepId)) unitOf.set(u.stepId, u);
  const out = new Map<string, string>();
  for (const b of placement.blocks) {
    const u = b.stepId === undefined ? undefined : unitOf.get(b.stepId);
    if (u !== undefined && (b.role === 'machine' || busOf(u, b) !== null)) out.set(posKey(b.pos), u.name);
  }
  for (const c of chests) out.set(posKey(c.pos), c.label);
  return out;
}

// ---- Hookup ----

/**
 * How an EnderIO item network at the base keeps the input chest stocked (spec §3.6 "hooked into whatever network
 * exists"): Plan 5's hookup lays Item Conduits from the storage tap, the last one inserting into the chest on Green with
 * the chest's whitelist. The conduit face at the tap is the base's own, so its settings are a drafted configure step,
 * and its filter and speed upgrades are parts lines.
 */
function storageHookup(input: ModeInput, keys: readonly StuffKey[], rate: number): { hookup: ModeHookup; extraParts: BomLine[]; draft: StepDraft } {
  const { pack, plan, parts } = input;
  const { filter } = itemFilterFor(parts, keys);
  const speed = speedUpgradesFor(rate);
  const tap: ConduitExtract = {
    color: DEFAULT_CHANNEL, filter, rate, roundRobin: false, selfFeed: false, redstone: 'ignore',
    ...(speed.count > 0 ? { speed: { item: parts.eio_speed_upgrade.key, count: speed.count } } : {}),
  };
  const extraParts: BomLine[] = [];
  if (filter.item !== undefined) extraParts.push({ key: filter.item, amount: 1, why: 'filter at the storage tap', group: 'logistics' });
  if (speed.count > 0) extraParts.push({ key: parts.eio_speed_upgrade.key, amount: speed.count, why: 'speed upgrades at the storage tap', group: 'logistics' });
  // the end face holds a filter of its own: it is a second part, on a block the hookup places
  const end: ConduitInsert = { color: DEFAULT_CHANNEL, filter: itemFilterFor(parts, keys).filter, rate, priority: 0 };
  const tapText = conduitSideText('extract', tap, (k) => nameList(plan, pack, [k]));
  return {
    hookup: { part: 'eio_item_conduit', end: null, endConduit: { kind: 'item', face: { mode: 'insert', target: INPUT_CHEST, insert: end } } },
    extraParts,
    draft: { id: 'layout:configure:conduit-tap', kind: 'configure', pin: 'logistics',
      text: `At the storage tap set the conduit face toward your storage to Extract; ${tapText}` },
  };
}

// ---- The mode ----

/**
 * The Item Conduit spine `[firstX … tailX] × (y 0, z spineZ)`, one more cell above the tail cell per further output chest,
 * every face toward a machine or tail chest set, the faces toward other machines, buses and chests disabled, the tail
 * chests, and the hookup's end face when an EnderIO item network can stock the input chest. Nothing when no placed unit
 * moves items.
 */
export function enderioMode(input: ModeInput): ModeResult {
  const { pack, plan, parts, placement, network } = input;
  const { firstX, tailX, spineZ } = placement;
  if (itemPorts(placement).length === 0) return emptyModeResult();
  const placed = placedStepIds(placement);
  const items = plan.flows.filter((f) => !isFluidKey(f.key));

  // the face plan: every item port; the input chest north of the tail cell; output chest j south of tail cell j
  const { faces: machine, configs } = machineFaces(plan, items, placement);
  const { entering, leaving, strays } = crossing(plan, items, placed);
  const inputKeys = distinctKeys(entering.map((f) => f.key));
  const inputRate = sumRate(entering);
  const outputSlices = slices(distinctKeys([...leaving.map((f) => f.key), ...strays.map((s) => s.key)]), ITEM_FILTER_SLOTS.big);
  const inputChest: Vec3 | null = inputKeys.length > 0 ? [tailX, 0, spineZ - 1] : null;
  const tailFaces: FacePlan[] = [];
  if (inputChest !== null) {
    tailFaces.push({ pos: [tailX, 0, spineZ], side: NORTH, target: INPUT_CHEST, stepId: null, extract: { keys: inputKeys, rate: inputRate }, insert: null });
  }
  outputSlices.forEach((keys, j) => {
    tailFaces.push({ pos: [tailX, j, spineZ], side: SOUTH, target: OUTPUT_CHEST, stepId: null, extract: null,
      insert: { keys, rate: sumRate(leaving.filter((f) => keys.includes(f.key))) } });
  });
  const plans = [...machine, ...tailFaces].sort((a, b) => comparePos(a.pos, b.pos) || a.side - b.side);

  // the links: each flow joins the sides that give its item at its source to the sides that take it at its target (the
  // tail chests stand for outside the line); a stray output joins its machine to its output chest
  const sidesOf = (owner: string | null, side: SideName, key: StuffKey): string[] =>
    plans.filter((f) => f.stepId === owner && f[side]?.keys.includes(key) === true).map((f) => endId(f, side));
  const links: ChannelLink[] = [];
  const link = (from: string | null, to: string | null, key: StuffKey): void => {
    for (const a of sidesOf(from, 'extract', key)) for (const b of sidesOf(to, 'insert', key)) links.push({ from: a, to: b });
  };
  for (const f of items) {
    const from = placed.has(f.from) ? f.from : null, to = placed.has(f.to) ? f.to : null;
    if (from !== null || to !== null) link(from, to, f.key);
  }
  for (const s of strays) link(s.stepId, null, s.key);
  const ends: ChannelEnd[] = plans.flatMap((f) => [
    ...(f.extract === null ? [] : [{ id: endId(f, 'extract'), keys: f.extract.keys }]),
    ...(f.insert === null ? [] : [{ id: endId(f, 'insert'), keys: f.insert.keys }]),
  ]);
  const channels = assignChannels(ends, links);
  const fed = new Map<string, Set<string>>();                                         // insert ends per extract end
  for (const l of links) fed.set(l.from, (fed.get(l.from) ?? new Set<string>()).add(l.to));

  // each side's colour, filter, speed upgrades, priority and round robin
  const rateWarnings: PlanWarning[] = [];
  const filterWarnings: PlanWarning[] = [];
  const rateWarned = new Set<string | null>();                                        // step ids; null: the input chest
  const filterWarned = new Set<string>();
  const filterOf = (f: FacePlan, side: SideName, keys: readonly StuffKey[]): ConduitFilter => {
    const { filter, dropped } = itemFilterFor(parts, keys);
    if (dropped.length > 0) {
      const warning = filterFullWarning(input, f, side, filter, dropped);
      const seen = JSON.stringify([f.stepId, warning.text]);
      if (!filterWarned.has(seen)) {
        filterWarned.add(seen);
        filterWarnings.push(warning);
      }
    }
    return filter;
  };
  const extractOf = (f: FacePlan, s: Side): ConduitExtract => {
    const id = endId(f, 'extract');
    const speed = speedUpgradesFor(s.rate);
    if (speed.short && !rateWarned.has(f.stepId)) {
      rateWarned.add(f.stepId);
      rateWarnings.push(rateWarning(parts, s.rate, f.stepId === null ? 'the input chest' : f.target, f.stepId));
    }
    return {
      color: channels.colors.get(id)!, filter: filterOf(f, 'extract', s.keys), rate: s.rate, roundRobin: (fed.get(id)?.size ?? 0) >= 2,
      selfFeed: false, redstone: 'ignore', ...(speed.count > 0 ? { speed: { item: parts.eio_speed_upgrade.key, count: speed.count } } : {}),
    };
  };
  const insertOf = (f: FacePlan, s: Side): ConduitInsert => ({
    color: channels.colors.get(endId(f, 'insert'))!, filter: filterOf(f, 'insert', s.keys), rate: s.rate, priority: f.stepId === null ? 0 : 1,
  });
  const configured = new Map<string, Omit<ConduitFace, 'face'>>();
  for (const f of plans) {
    const extract = f.extract === null ? undefined : extractOf(f, f.extract);
    const insert = f.insert === null ? undefined : insertOf(f, f.insert);
    configured.set(faceKey(f.pos, f.side), {
      mode: modeOf(extract !== undefined, insert !== undefined), target: f.target,
      ...(extract === undefined ? {} : { extract }), ...(insert === undefined ? {} : { insert }),
    });
  }

  // the conduit cells: the spine along x, then the cells above the tail cell, each joined to the one below
  const cells: Vec3[] = [];
  const runs: Array<[Vec3, Vec3]> = [];
  for (let x = firstX; x <= tailX; x++) {
    cells.push([x, 0, spineZ]);
    if (x > firstX) runs.push([[x - 1, 0, spineZ], [x, 0, spineZ]]);
  }
  for (let j = 1; j < outputSlices.length; j++) {
    cells.push([tailX, j, spineZ]);
    runs.push([[tailX, j - 1, spineZ], [tailX, j, spineZ]]);
  }
  const bits = linkBits(runs);

  const chests: LocalBlock[] = [];
  const layChest = (pos: Vec3, label: string, tail: TailChest): void => {
    chests.push({ pos, block: { ...parts.chest.block }, role: 'chest', label, item: parts.chest.key, tail });
  };
  if (inputChest !== null) layChest([...inputChest], INPUT_CHEST, { side: 'input', keys: [...inputKeys] });
  outputSlices.forEach((keys, j) => layChest([tailX, j, spineZ + 1], OUTPUT_CHEST, { side: 'output', keys: [...keys] }));

  // every side of a cell: its configured face, a link, Disabled toward anything else it could trade with, or nothing
  const conduit = parts.eio_item_conduit;
  const touching = traders(placement, chests);
  const conduits = cells.map((cell): LocalBlock => {
    const linked = bits.get(posKey(cell)) ?? 0;
    const faces: ConduitFace[] = [];
    let open = 0;                                                                     // the bits of its non-disabled faces
    FACES.forEach((face, side) => {
      const set = configured.get(faceKey(cell, side));
      if (set !== undefined) {
        faces.push({ face, ...set });
        open |= 1 << side;
        return;
      }
      if ((linked & (1 << side)) !== 0) return;
      const target = touching.get(posKey(step(cell, side)));
      if (target !== undefined) faces.push({ face, mode: 'disabled', target });
    });
    return {
      pos: cell, block: { ...conduit.block }, role: 'pipe', label: CONDUIT_NAMES.item, item: conduit.key, connections: linked | open,
      conduits: [{ kind: 'item', item: conduit.key, connections: linked, faces }],
    };
  });

  // drafts: lay the line; then stock the input chest through the storage tap, or by hand
  const hooked = network?.kind === 'enderio' && inputChest !== null ? storageHookup(input, inputKeys, inputRate) : null;
  const chestWords = [...(inputChest === null ? [] : ['an input chest']),
    ...(outputSlices.length === 0 ? [] : [outputSlices.length === 1 ? 'an output chest' : `${fmtInt(outputSlices.length)} output chests`])];
  const drafts: StepDraft[] = [{ id: 'layout:logistics:line', kind: 'logistics', pin: 'site',
    text: `Lay ${fmtInt(cells.length)}× ${CONDUIT_NAMES.item} along the middle row so it touches every machine's front`
      + `${chestWords.length > 0 ? `, with ${joinNames(chestWords)} at the end` : ''}` }];
  if (hooked !== null) drafts.push(hooked.draft);
  else if (inputChest !== null) {
    drafts.push({ id: 'layout:logistics:inputs', kind: 'logistics', pin: 'site', text: `Put the raw inputs in the input chest: ${nameList(plan, pack, inputKeys)}` });
  }

  const channelWarnings = channels.shared.map(({ color, keys }): PlanWarning => ({ code: 'conduit_channels',
    text: `More than ${fmtInt(CHANNEL_PALETTE.length)} conduit channels are needed: ${DYE_NAMES[color]} also carries ${nameList(plan, pack, keys)}, `
      + 'so they can reach a machine that does not take them' }));

  return {
    blocks: [...conduits, ...chests].sort((a, b) => comparePos(a.pos, b.pos)),
    covers: [], configs,
    logisticsPort: hooked === null || inputChest === null ? null : [...inputChest],
    hookup: hooked?.hookup ?? null,
    extraParts: hooked?.extraParts ?? [],
    drafts,
    warnings: [...rateWarnings, ...filterWarnings, ...channelWarnings],
    tailFluidY: Math.max(1, outputSlices.length),
  };
}
