// EnderIO conduits (plan 11 Tasks 3–4; spec §3.6 mode 4, architecture "EnderIO conduits, granted change requests (add-on
// 11)"; the user's single-pipe requirements of 2026-10-19): one Item Conduit along the spine, touching every machine's
// output side or bus, and one ender fluid conduit network in the same bundles along the spine, so a GT basic machine has
// one connection, its output side, for its items and its fluids (GT 5.09.54 `MTEBasicMachine`: fluids pass the output
// side as items do, in under Input from Output Side, `isLiquidInput`, and out anywhere but the front, `isLiquidOutput`);
// only a multiblock's fluid hatches, and a single-block machine that is no basic machine, get a riser to a port on top.
// Each face toward a machine, a tail chest or a tank is set on its own: Extract (EnderIO INPUT) what the machine makes,
// Insert (OUTPUT) what it takes, or In / Out for both, each side with its own channel colour and a whitelist of its
// exact items or fluids (an insert side into a singleblock's output side needs the machine's Input from Output Side, and
// says so); faces toward anything else they could trade with are Disabled. Extract sides get redstone Always active (an
// unset face extracts only with a signal); item extract sides also get the speed upgrades their rate needs and self feed
// off, and item insert sides fill machines (priority 1) before chests (0).
// The single pipe: every machine's outputs are extracted into the line's one network and the insert sides' whitelists
// and priorities send each item or fluid on, so the whole line shares one channel, Red. The plan's flows link what
// makes an item or fluid to what takes it, and linked sides share a channel (each side has one colour); a channel moves
// to another colour only where a filter cannot keep a key away from a face that must not get it, because that face
// takes the key from elsewhere: where one of its extract sides would hand a key to an insert side of another channel, a
// route no flow plans (`assignChannels`). Whatever hands it out, the input chest's raw inputs, an open end bringing a
// fluid in or a machine making an item that two machines take from two different makers, the face takes more than its
// flows while it has room (machine counts round up), so the face the key is planned for runs short, its maker backs up
// or a chest fills with it; and an open end that sends a fluid out has no priority, so it would take its turn with the
// machines. Past 15 colours a channel shares the colour that leaks least, with a `conduit_channels` warning. A side's
// targets are the insert sides of its colour that pass one of its keys, and EnderIO's round robin rotates over them
// whatever their priority, so an item extract side gets it only when two or more machine faces take one of its items
// and no chest takes an item a machine takes too; a fluid extract side (ender fluid conduits have no priority) gets it
// for any two or more, and a fluid it hands both to machines and to an open end is warned about. Items and fluids are
// separate networks with their own channels. Only raw inputs and final outputs touch storage, at the tail: an input
// chest the line extracts from, which an EnderIO network at the base keeps stocked from the storage tap on a channel of
// that link's own (`TAP_CHANNEL`), output chests of 24 items each, and one open fluid conduit end per fluid that enters
// or leaves the line, for a tank. The fluid conduit is the slowest ender tier that moves the busiest face. Every order
// and tie-break is fixed, so the same plan gives the same faces and colours.

import { isFluidKey, type StuffKey } from '../../../shared/keys.ts';
import { conduitSideText } from '../../../shared/layout/configure-text.ts';
import {
  CHANNEL_PALETTE, CONDUIT_NAMES, DYE_NAMES, FLUID_CONDUITS, ITEM_CONDUIT, ITEM_FILTER_SLOTS, TAP_CHANNEL, TAP_CHANNEL_NOTE, itemFaceRate,
} from '../../../shared/layout/enderio.ts';
import { fmtInt, fmtRate, joinNames } from '../../../shared/layout/format.ts';
import { OPPOSITE, posKey, sideToward, step, type Vec3 } from '../../../shared/layout/geometry.ts';
import { conduitBlockRef, FACES } from '../../../shared/types/assets.ts';
import type {
  ConduitExtract, ConduitFace, ConduitFilter, ConduitInsert, ConduitKind, ConduitMode, ConduitSpec, TailChest,
} from '../../../shared/types/layout.ts';
import type { Pack } from '../../../shared/types/pack.ts';
import type { BomLine, Plan, PlanFlow, PlanWarning } from '../../../shared/types/plan.ts';
import { comparePos } from '../../world/graph.ts';
import { handRunSurroundings, type HatchKind, type HostConfig, type LocalBlock, type PlacedUnit, type Placement } from '../arrange.ts';
import {
  assignChannels, fluidFilterFor, itemFilterFor, pickFluidConduit, speedUpgradesFor, type ChannelEnd, type ChannelLink, type ChannelPlan,
} from '../conduits.ts';
import { fluidNets, type FluidNet } from '../internal.ts';
import type { Parts } from '../parts.ts';
import { growTree, linkBits, type PathBounds } from '../path.ts';
import {
  emptyModeResult, feedSettings, itemPorts, itemRisers, lineExceptions, mergeHostConfigs, nameList, placedStepIds, RISER_WORDS, stepItemInputs,
  stepItemOutputs, unitItemRate, type ItemPort, type ModeHookup, type ModeInput, type ModeResult, type StepDraft,
} from './mode.ts';

const DOWN = 0, NORTH = 2, SOUTH = 3, EAST = 5;
const TICKS_PER_SECOND = 20;
const INPUT_CHEST = 'Chest (input)', OUTPUT_CHEST = 'Chest (output)', YOUR_TANK = 'your tank';

// ---- Types and small helpers ----

type SideName = 'extract' | 'insert';

/** One side of a face before its channel is known: the items or fluids it passes and how many per second it must move. */
interface Side { keys: StuffKey[]; rate: number }

/**
 * Where a fluid face meets its unit (`unitFluidPorts`): on a GT basic machine's output side from the spine (`spine`),
 * above a multiblock's fluid hatch (`hatch`), or above any other single-block machine (`top`).
 */
type FluidPort = 'spine' | 'hatch' | 'top';

/**
 * A face of a conduit cell that trades with what it touches: a machine's item or fluid port (`stepId` its step), or a
 * tail chest or open fluid end (`stepId` null, where the line meets its storage). It has an extract side, an insert side
 * or both. `outputSide`: the face touches a singleblock's output side and inserts, so the machine needs its Input from
 * Output Side. `port`: where a machine's fluid face meets it.
 */
interface FacePlan {
  pos: Vec3; side: number; target: string; stepId: string | null; extract: Side | null; insert: Side | null; outputSide?: true; port?: FluidPort;
}

/** Each face's mode and sides, by `faceKey`. */
type FaceSettings = ReadonlyMap<string, Omit<ConduitFace, 'face'>>;

/** One conduit on one cell; a cell with more than one is a bundle. */
interface CellConduit { pos: Vec3; spec: ConduitSpec }

function compareText(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0;
}

function compareFaces(a: FacePlan, b: FacePlan): number {
  return comparePos(a.pos, b.pos) || a.side - b.side;
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

/** The busiest `side` of the faces, per second; 0 when none has that side. */
function busiest(plans: readonly FacePlan[], side: SideName): number {
  return plans.reduce((most, f) => Math.max(most, f[side]?.rate ?? 0), 0);
}

/** Σ flows into the step ÷ step.count: what each of its machines takes in per second. */
function unitIntake(plan: Plan, flows: readonly PlanFlow[], stepId: string): number {
  const count = plan.steps.find((s) => s.id === stepId)?.count ?? 1;
  return sumRate(flows.filter((f) => f.to === stepId)) / Math.max(1, count);
}

/**
 * The flows that cross the line's edge: entering, into a placed step from outside it (raw, or a step whose machines are
 * all owned); leaving, from a placed step to outside it (out, sink, or such a step).
 */
export function edgeFlows(flows: readonly PlanFlow[], placed: ReadonlySet<string>): { entering: PlanFlow[]; leaving: PlanFlow[] } {
  return {
    entering: flows.filter((f) => !placed.has(f.from) && placed.has(f.to)),
    leaving: flows.filter((f) => placed.has(f.from) && !placed.has(f.to)),
  };
}

/** Warnings in the order first raised, each code, step and text once. */
class WarningList {
  readonly list: PlanWarning[] = [];
  private readonly seen = new Set<string>();

  add(w: PlanWarning): void {
    const key = JSON.stringify([w.code, w.stepId ?? null, w.text]);
    if (this.seen.has(key)) return;
    this.seen.add(key);
    this.list.push(w);
  }
}

// ---- What a conduit side touches ----

/**
 * The kind, among `kinds`, of the unit's hatch that `b` is, told apart by the mteIds of the unit's hatch cells (as
 * direct.ts `spineContacts` tells its buses apart).
 */
function hatchOf<K extends HatchKind>(u: PlacedUnit, b: LocalBlock | undefined, kinds: readonly K[]): K | null {
  if (b?.role !== 'hatch' || b.stepId !== u.stepId) return null;
  for (const c of u.cells) {
    const kind = kinds.find((k) => k === c.hatch);
    if (kind !== undefined && c.block.mteId === b.block.mteId) return kind;
  }
  return null;
}

/** The bus behind a multiblock's item port. */
function busOf(u: PlacedUnit, b: LocalBlock | undefined): 'input_bus' | 'output_bus' | null {
  return hatchOf(u, b, ['input_bus', 'output_bus']);
}

/** The unit blocks a conduit side could trade with, by posKey, each with its unit's name (the name its face shows). */
function unitTraders(placement: Placement, trades: (u: PlacedUnit, b: LocalBlock) => boolean): Map<string, string> {
  const unitOf = new Map<string, PlacedUnit>();                                        // a step's units share name and cells
  for (const u of placement.units) if (!unitOf.has(u.stepId)) unitOf.set(u.stepId, u);
  const out = new Map<string, string>();
  for (const b of placement.blocks) {
    const u = b.stepId === undefined ? undefined : unitOf.get(b.stepId);
    if (u !== undefined && trades(u, b)) out.set(posKey(b.pos), u.name);
  }
  return out;
}

// ---- Channels, faces and blocks (items and fluids alike) ----

/**
 * The channels of one conduit network's faces (items and fluids each get their own network). Each flow links the
 * extract sides that give its key at its source to the insert sides that take it at its target, where the faces without
 * a step (the tail chests, the open fluid ends) stand for outside the line; a flow with both ends outside is skipped. A
 * stray output links its machine to the faces outside the line that take it. Linked sides share a channel, and the
 * channels share the line's one colour unless a side would then trade a key with a side its flows do not link it to
 * (`assignChannels`). Ends in face order, extract before insert.
 */
function planChannels(plans: readonly FacePlan[], flows: readonly PlanFlow[], placed: ReadonlySet<string>,
  strays: ReadonlyArray<{ stepId: string; key: StuffKey }>): ChannelPlan {
  const sidesOf = (owner: string | null, side: SideName, key: StuffKey): string[] =>
    plans.filter((f) => f.stepId === owner && f[side]?.keys.includes(key) === true).map((f) => endId(f, side));
  const links: ChannelLink[] = [];
  const link = (from: string | null, to: string | null, key: StuffKey): void => {
    for (const a of sidesOf(from, 'extract', key)) for (const b of sidesOf(to, 'insert', key)) links.push({ from: a, to: b });
  };
  for (const f of flows) {
    const from = placed.has(f.from) ? f.from : null, to = placed.has(f.to) ? f.to : null;
    if (from !== null || to !== null) link(from, to, f.key);
  }
  for (const s of strays) link(s.stepId, null, s.key);
  const endOf = (f: FacePlan, side: SideName, s: Side): ChannelEnd => ({ id: endId(f, side), keys: s.keys, side, face: faceKey(f.pos, f.side) });
  const ends: ChannelEnd[] = plans.flatMap((f) => [
    ...(f.extract === null ? [] : [endOf(f, 'extract', f.extract)]),
    ...(f.insert === null ? [] : [endOf(f, 'insert', f.insert)]),
  ]);
  return assignChannels(ends, links);
}

/**
 * The insert sides an extract side can hand to, in face order. EnderIO offers each extraction to every other face of
 * the network whose insert colour is the side's extract colour (`NetworkedInventory.updateInsertOrder`,
 * `EnderLiquidConduitNetwork.fillFrom`; self feed is off) and lets that face's filter decide, so these are the insert
 * sides of its colour that pass one of its keys: those the plan's flows link it to, and any other on its channel (a
 * machine that also takes from another maker, the output chest of another maker's surplus) or, past the palette, on its
 * colour.
 */
function targetsOf(plans: readonly FacePlan[], colors: ChannelPlan['colors'], from: FacePlan): FacePlan[] {
  const color = colors.get(endId(from, 'extract'));
  const keys = from.extract?.keys ?? [];
  return plans.filter((g) => g !== from && g.insert !== null && colors.get(endId(g, 'insert')) === color && g.insert.keys.some((k) => keys.includes(k)));
}

/** An item insert side's priority (higher is filled first): 1 toward a machine, 0 toward a tail chest. */
function insertPriority(face: FacePlan): number {
  return face.stepId === null ? 0 : 1;
}

/**
 * Round robin for the extract side of `from`, which can hand to `targets` (`targetsOf`). With it on, EnderIO starts
 * each extraction at the target after the one served last, over all of them whatever their priority
 * (`NetworkedInventory.getTargetIterator` hands out EnderCore's `RoundRobinIterator` over the priority-sorted targets,
 * and its index only moves on), passing on from a target whose filter refuses the item; with it off, an item goes to
 * the first target that takes it (sticky, then priority, then distance) and a fluid first to the face that took fluid
 * last (`EnderLiquidConduitNetwork$TankIterator.rewind`). So an item side gets it when two or more machine faces (all
 * of priority 1) take one of its items and no tail chest takes an item a machine takes too (round robin would hand the
 * chest its turn before the machines are full; a chest that only takes the side's other items never gets these); a
 * fluid side, whose faces have no priority, for any two or more (without it, a tank that took fluid once would be tried
 * first from then on and take it all).
 */
function roundRobin(kind: 'item' | 'fluid', from: FacePlan, targets: readonly FacePlan[]): boolean {
  if (targets.length < 2) return false;
  if (kind === 'fluid') return true;
  const takers = (from.extract?.keys ?? []).map((k) => targets.filter((g) => g.insert!.keys.includes(k)));
  const machines = (list: readonly FacePlan[]): number => list.filter((g) => g.stepId !== null).length;
  return takers.some((list) => machines(list) >= 2) && takers.every((list) => machines(list) === 0 || machines(list) === list.length);
}

/** Each face's mode and sides from the side builders, called face by face, extract first. */
function configureFaces(plans: readonly FacePlan[], extractOf: (f: FacePlan, s: Side) => ConduitExtract,
  insertOf: (f: FacePlan, s: Side) => ConduitInsert): FaceSettings {
  const configured = new Map<string, Omit<ConduitFace, 'face'>>();
  for (const f of plans) {
    const extract = f.extract === null ? undefined : extractOf(f, f.extract);
    const insert = f.insert === null ? undefined : insertOf(f, f.insert);
    configured.set(faceKey(f.pos, f.side), {
      mode: modeOf(extract !== undefined, insert !== undefined), target: f.target,
      ...(extract === undefined ? {} : { extract }), ...(insert === undefined ? {} : { insert }),
    });
  }
  return configured;
}

/**
 * A conduit's faces on `cell`, in FACES order: its configured face on a side; else, on a side that is not a link,
 * Disabled toward anything it could trade with (`traders`, by posKey: the name the face shows); else nothing.
 */
function conduitFaces(cell: Vec3, links: number, configured: FaceSettings, traders: ReadonlyMap<string, string>): ConduitFace[] {
  const faces: ConduitFace[] = [];
  FACES.forEach((face, side) => {
    const set = configured.get(faceKey(cell, side));
    if (set !== undefined) faces.push({ face, ...set });
    else if ((links & (1 << side)) === 0) {
      const target = traders.get(posKey(step(cell, side)));
      if (target !== undefined) faces.push({ face, mode: 'disabled', target });
    }
  });
  return faces;
}

/** The bits `1 << side` of the faces that are not Disabled. */
function openBits(faces: readonly ConduitFace[]): number {
  return faces.reduce((bits, f) => (f.mode === 'disabled' ? bits : bits | (1 << FACES.indexOf(f.face))), 0);
}

/**
 * The block of one cell's conduits: a single conduit keeps its own name, pseudo block and item; a bundle is named
 * `Conduit bundle (<names joined with ' + '>)` and shows its first conduit's pseudo block and item. It connects on every
 * conduit's links and on every face that is not Disabled.
 */
function conduitBlock(pos: Vec3, conduits: [ConduitSpec, ...ConduitSpec[]]): LocalBlock {
  const [first] = conduits;
  const label = conduits.length === 1 ? CONDUIT_NAMES[first.kind] : `Conduit bundle (${conduits.map((c) => CONDUIT_NAMES[c.kind]).join(' + ')})`;
  return {
    pos, block: conduitBlockRef(first.kind), role: 'pipe', label, item: first.item,
    connections: conduits.reduce((bits, c) => bits | c.connections | openBits(c.faces), 0), conduits,
  };
}

/** Every cell's conduits as one block, in the lists' order (so the Item Conduit comes first in a bundle). */
function conduitBlocks(...lists: ReadonlyArray<readonly CellConduit[]>): LocalBlock[] {
  const cells = new Map<string, { pos: Vec3; conduits: [ConduitSpec, ...ConduitSpec[]] }>();
  for (const list of lists) {
    for (const { pos, spec } of list) {
      const cell = cells.get(posKey(pos));
      if (cell === undefined) cells.set(posKey(pos), { pos, conduits: [spec] });
      else cell.conduits.push(spec);
    }
  }
  return [...cells.values()].map(({ pos, conduits }) => conduitBlock(pos, conduits));
}

// ---- Warnings ----

/** An item face that cannot move its rate even with every speed upgrade (plan 11, ruling R9, for the input chest's face too). */
function itemRateWarning(parts: Parts, rate: number, from: string, stepId: string | null): PlanWarning {
  const most = ITEM_CONDUIT.maxUpgrades;
  const text = `No item conduit face moves ${fmtRate(rate)} items/s out of ${from}: ${fmtInt(most)} ${parts.eio_speed_upgrade.name}s move `
    + `${fmtRate(itemFaceRate(most))} items/s, so the line runs slower`;
  return stepId === null ? { code: 'conduit_rate', text } : { code: 'conduit_rate', stepId, text };
}

/**
 * A fluid network whose busiest face is beyond the fastest ender fluid conduit (`kind`): the side that is short, extract
 * first, against what that conduit moves through one face.
 */
function fluidRateWarning(kind: ConduitKind, need: Readonly<Record<SideName, number>>): PlanWarning {
  const row = FLUID_CONDUITS.find((r) => r.kind === kind)!;
  const most: Record<SideName, number> = { extract: row.extractPerTick * TICKS_PER_SECOND, insert: row.maxIoPerTick * TICKS_PER_SECOND };
  const side: SideName = need.extract > most.extract ? 'extract' : 'insert';
  return { code: 'conduit_rate', text: `No fluid conduit moves ${fmtRate(need[side])} L/s through one face: `
    + `the ${CONDUIT_NAMES[kind]} moves ${fmtRate(most[side])} L/s, so the line runs slower` };
}

/** A side whose filter is full: the items, or the fluids for an ender fluid conduit's own filter (it has no item), it leaves out. */
function filterFullWarning(input: ModeInput, face: FacePlan, side: SideName, filter: ConduitFilter, dropped: readonly StuffKey[]): PlanWarning {
  const one = dropped.length === 1;
  const text = `The ${side} filter toward ${face.target} holds ${fmtInt(filter.keys.length)} ${filter.item === undefined ? 'fluids' : 'items'}, `
    + `so ${nameList(input.plan, input.pack, dropped)} ${one ? 'is' : 'are'} left out: move ${one ? 'it' : 'them'} by hand`;
  return face.stepId === null ? { code: 'filter_full', text } : { code: 'filter_full', stepId: face.stepId, text };
}

/**
 * `conduit_share`, one per fluid (in key order) that a face can hand (`targetsOf`) both to an open end (the surplus, for
 * your tank) and to machines that take it: ender fluid conduits have no priority, so the tank takes its turn with those
 * machines however much they need. Without the tank the fluid has nowhere else to go, so the maker waits for the machines.
 */
function fluidShareWarnings(input: ModeInput, plans: readonly FacePlan[], channels: ChannelPlan): PlanWarning[] {
  const sharing = new Map<StuffKey, string[]>();
  for (const f of plans) {
    if (f.extract === null) continue;
    const targets = targetsOf(plans, channels.colors, f);
    for (const key of f.extract.keys) {
      const takes = targets.filter((g) => g.insert!.keys.includes(key));
      const machines = takes.filter((g) => g.stepId !== null).map((g) => g.target);
      if (machines.length > 0 && takes.some((g) => g.stepId === null)) sharing.set(key, [...(sharing.get(key) ?? []), ...machines]);
    }
  }
  return [...sharing].sort(([a], [b]) => compareText(a, b)).map(([key, targets]): PlanWarning => {
    const names = [...new Set(targets)];
    const one = names.length === 1;
    return { code: 'conduit_share', text: `${joinNames(names)} ${one ? 'shares' : 'share'} ${nameList(input.plan, input.pack, [key])} with the open end `
      + `for your tank turn by turn (ender fluid conduits have no priority), so ${one ? 'it' : 'they'} can run short: if ${one ? 'it does' : 'they do'}, `
      + 'take the tank off that end' };
  });
}

/**
 * `conduit_channels`, one per colour a channel had to share past the palette, naming the items or fluids that a side can
 * then hand to a side its flows do not link it to (`assignChannels`): a raw input or a machine's item reaching a machine
 * the plan feeds it from another maker, or an output chest; a fluid reaching an open end in turn with the machines.
 */
export function channelWarnings(input: Pick<ModeInput, 'pack' | 'plan'>, channels: Pick<ChannelPlan, 'shared'>): PlanWarning[] {
  return channels.shared.map(({ color, keys }): PlanWarning => {
    const one = keys.length === 1;
    return { code: 'conduit_channels',
      text: `More than ${fmtInt(CHANNEL_PALETTE.length)} conduit channels are needed: ${DYE_NAMES[color]} also carries ${nameList(input.plan, input.pack, keys)}, `
        + `so ${one ? 'it' : 'they'} can reach a face the plan does not send ${one ? 'it' : 'them'} to` };
  });
}

// ---- Items ----

/** The item flows that cross the line's edge, and the items placed steps make that no flow carries. */
export interface Crossing { entering: PlanFlow[]; leaving: PlanFlow[]; strays: Array<{ stepId: string; key: StuffKey }> }

/**
 * The face of every item port toward its unit, in unit then port order: a singleblock's extracts every item it makes and
 * inserts every item it takes; a multiblock's extracts toward an output bus and inserts toward an input bus, with all of
 * the step's items on every bus (plan 11, ruling R10). A unit's rates are split evenly over its extract faces and over
 * its insert faces. With them, `inputFromOutputSide` on every singleblock that takes items (the face is on its output
 * side, GT's `getFrontFacing()`, which takes items only with that setting), sorted by pos; such a face is `outputSide`.
 * A venting steam machine's output side faces up (`PlacedUnit.outputSide`), so its face needs neither (architecture §11
 * entry 48): GT lets its items in and out on any side but its front and its output side.
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
    const insertRate = unitIntake(plan, items, u.stepId) / Math.max(1, roles.filter((r) => r.inserts).length);
    for (const { port, extracts, inserts } of roles) {
      if (!extracts && !inserts) continue;
      const outputSide = !u.multiblock && u.outputSide === undefined && inserts;
      faces.push({
        pos: port.pos, side: sideToward(port.pos, port.behind), target: u.name, stepId: u.stepId,
        extract: extracts ? { keys: makes, rate: extractRate } : null, insert: inserts ? { keys: takes, rate: insertRate } : null,
        ...(outputSide ? { outputSide: true as const } : {}),
      });
      if (outputSide) configs.push({ pos: [...port.behind], config: { inputFromOutputSide: true } });
    }
  }
  return { faces, configs: configs.sort((a, b) => comparePos(a.pos, b.pos)) };
}

/**
 * What crosses the line's edge (spec §3.6: only raw inputs and final outputs touch storage): the item flows that enter and
 * leave it, and the strays, each item a placed step makes that no flow carries (a chance byproduct), so that it leaves
 * through an output chest and no machine clogs.
 */
export function crossing(plan: Plan, items: readonly PlanFlow[], placed: ReadonlySet<string>): Crossing {
  return {
    ...edgeFlows(items, placed),
    strays: [...placed].flatMap((stepId) => stepItemOutputs(plan, stepId)
      .filter((key) => !items.some((f) => f.from === stepId && f.key === key))
      .map((key) => ({ stepId, key }))),
  };
}

/**
 * Each item side's colour, filter, speed upgrades, priority and round robin, by face, with the `conduit_rate` warnings
 * (once per step, and for the input chest's face) and then the `filter_full` ones. Round robin is on only for a side
 * one of whose items two or more machine faces take, and none of whose items both a chest and a machine take
 * (`roundRobin`): round robin would hand a chest its turn before the machines are full, while without it the machines
 * (priority 1) are filled first and the chest takes what is left.
 */
function itemSettings(input: ModeInput, plans: readonly FacePlan[], channels: ChannelPlan): { configured: FaceSettings; warnings: PlanWarning[] } {
  const { parts } = input;
  const rateWarnings = new WarningList(), filterWarnings = new WarningList();
  const filterOf = (f: FacePlan, side: SideName, keys: readonly StuffKey[]): ConduitFilter => {
    const { filter, dropped } = itemFilterFor(parts, keys);
    if (dropped.length > 0) filterWarnings.add(filterFullWarning(input, f, side, filter, dropped));
    return filter;
  };
  const extractOf = (f: FacePlan, s: Side): ConduitExtract => {
    const id = endId(f, 'extract');
    const speed = speedUpgradesFor(s.rate);
    if (speed.short) rateWarnings.add(itemRateWarning(parts, s.rate, f.stepId === null ? 'the input chest' : f.target, f.stepId));
    return {
      color: channels.colors.get(id)!, filter: filterOf(f, 'extract', s.keys), rate: s.rate, roundRobin: roundRobin('item', f, targetsOf(plans, channels.colors, f)),
      selfFeed: false, redstone: 'ignore', ...(speed.count > 0 ? { speed: { item: parts.eio_speed_upgrade.key, count: speed.count } } : {}),
    };
  };
  const insertOf = (f: FacePlan, s: Side): ConduitInsert => ({
    color: channels.colors.get(endId(f, 'insert'))!, filter: filterOf(f, 'insert', s.keys), rate: s.rate, priority: insertPriority(f),
    ...(f.outputSide === true ? { outputSide: true } : {}),
  });
  return { configured: configureFaces(plans, extractOf, insertOf), warnings: [...rateWarnings.list, ...filterWarnings.list] };
}

/**
 * How an EnderIO item network at the base keeps the input chest stocked (spec §3.6 "hooked into whatever network
 * exists"): Plan 5's hookup lays Item Conduits from the storage tap, the last one inserting into the chest with the
 * chest's whitelist. Both ends of that link are on `TAP_CHANNEL`, a colour of its own on the base's network (the audit
 * of the EnderIO In / Out fix): an extract side hands items only to Insert faces of its colour and moves nothing none of
 * them takes, so the tap stops while the chest is full instead of handing the raw inputs on to the base's other
 * storages, which are on Green by default (round robin off: there is one target). The end face keeps priority 1, above
 * EnderIO's default 0, should another face of the base share the colour after all. The conduit face at the tap is the
 * base's own, so its settings are a drafted configure step that says why the colour must stay free: Extract, or In / Out
 * when that face already inserts into the storage (Extract alone would stop it storing; its insert side stays as it
 * is), and its filter and speed upgrades are parts lines.
 */
function storageHookup(input: ModeInput, keys: readonly StuffKey[], rate: number): { hookup: ModeHookup; extraParts: BomLine[]; draft: StepDraft } {
  const { pack, plan, parts } = input;
  const { filter } = itemFilterFor(parts, keys);
  const speed = speedUpgradesFor(rate);
  const tap: ConduitExtract = {
    color: TAP_CHANNEL, filter, rate, roundRobin: false, selfFeed: false, redstone: 'ignore',
    ...(speed.count > 0 ? { speed: { item: parts.eio_speed_upgrade.key, count: speed.count } } : {}),
  };
  const extraParts: BomLine[] = [];
  if (filter.item !== undefined) extraParts.push({ key: filter.item, amount: 1, why: 'filter at the storage tap', group: 'logistics' });
  if (speed.count > 0) extraParts.push({ key: parts.eio_speed_upgrade.key, amount: speed.count, why: 'speed upgrades at the storage tap', group: 'logistics' });
  // the end face holds a filter of its own: it is a second part, on a block the hookup places; its priority is above
  // the base network's own Insert faces (EnderIO's default 0), as the line's machine faces are
  const end: ConduitInsert = { color: TAP_CHANNEL, filter: itemFilterFor(parts, keys).filter, rate, priority: 1 };
  const tapText = conduitSideText('extract', tap, (k) => nameList(plan, pack, [k]));
  return {
    hookup: { part: 'eio_item_conduit', end: null, endConduit: { kind: 'item', face: { mode: 'insert', target: INPUT_CHEST, insert: end } } },
    extraParts,
    draft: { id: 'layout:configure:conduit-tap', kind: 'configure', pin: 'logistics',
      text: `At the storage tap set the conduit face toward your storage to Extract (In / Out if it already inserts, its insert side left as it is); `
        + `${tapText}. ${TAP_CHANNEL_NOTE}` },
  };
}

/** The Item Conduit line: its conduits, the tail chests and what else the items need. */
interface ItemLine {
  conduits: CellConduit[];
  chests: LocalBlock[]; configs: HostConfig[];
  logisticsPort: Vec3 | null; hookup: ModeHookup | null; extraParts: BomLine[];
  /** `layout:logistics:line`, and how the input chest is stocked (through the storage tap, or by hand) when there is one. */
  lineDraft: StepDraft; stockDraft: StepDraft | null;
  warnings: PlanWarning[];
  tailFluidY: number;
}

/**
 * The Item Conduit spine `[firstX … tailX] × (y 0, z spineZ)`, one more cell above the tail cell per further output chest
 * and up the spine's column to any bus above it (`itemRisers`), every face toward a machine or tail chest set, the faces
 * toward other machines, hatches and chests disabled, the tail chests, and the hookup's end face when an EnderIO item
 * network can stock the input chest.
 */
function itemLine(input: ModeInput): ItemLine {
  const { pack, plan, parts, placement, network } = input;
  const { firstX, tailX, spineZ } = placement;
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
  const plans = [...machine, ...tailFaces].sort(compareFaces);

  // the channels (the tail chests stand for outside the line; a stray output joins its machine to its output chest),
  // then each side's colour, filter, speed upgrades, priority and round robin
  const channels = planChannels(plans, items, placed, strays);
  const { configured, warnings } = itemSettings(input, plans, channels);

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
  // up the spine's column to a bus GT takes only higher up
  const risers = itemRisers(placement);
  cells.push(...risers.cells, ...risers.ports);
  runs.push(...risers.links);
  const bits = linkBits(runs);

  const chests: LocalBlock[] = [];
  const layChest = (pos: Vec3, label: string, tail: TailChest): void => {
    chests.push({ pos, block: { ...parts.chest.block }, role: 'chest', label, item: parts.chest.key, tail });
  };
  if (inputChest !== null) layChest([...inputChest], INPUT_CHEST, { side: 'input', keys: [...inputKeys] });
  outputSlices.forEach((keys, j) => layChest([tailX, j, spineZ + 1], OUTPUT_CHEST, { side: 'output', keys: [...keys] }));

  // every side of a cell: its configured face, a link, Disabled toward any other machine, hatch or chest, or nothing (a
  // GT hatch is an inventory too: a fluid hatch's container slots would take items)
  const touching = unitTraders(placement, (_u, b) => b.role === 'machine' || b.role === 'hatch');
  for (const c of chests) touching.set(posKey(c.pos), c.label);
  const item = parts.eio_item_conduit.key;
  const conduits = cells.map((pos): CellConduit => {
    const connections = bits.get(posKey(pos)) ?? 0;
    return { pos, spec: { kind: 'item', item, connections, faces: conduitFaces(pos, connections, configured, touching) } };
  });

  // drafts: lay the line (against a singleblock's output side, which GT keeps apart from its front, and a multiblock's
  // buses); then stock the input chest through the storage tap, or by hand
  const hooked = network?.kind === 'enderio' && inputChest !== null ? storageHookup(input, inputKeys, inputRate) : null;
  const chestWords = [...(inputChest === null ? [] : ['an input chest']),
    ...(outputSlices.length === 0 ? [] : [outputSlices.length === 1 ? 'an output chest' : `${fmtInt(outputSlices.length)} output chests`])];
  const lineDraft: StepDraft = { id: 'layout:logistics:line', kind: 'logistics', pin: 'site',
    text: `Lay ${fmtInt(cells.length)}× ${CONDUIT_NAMES.item} along the middle row so it touches every machine's output side or bus${lineExceptions(placement)}`
      + `${risers.links.length > 0 ? RISER_WORDS : ''}${chestWords.length > 0 ? `, with ${joinNames(chestWords)} at the end` : ''}` };
  const stockDraft: StepDraft | null = hooked !== null ? hooked.draft : inputChest === null ? null
    : { id: 'layout:logistics:inputs', kind: 'logistics', pin: 'site', text: `Put the raw inputs in the input chest: ${nameList(plan, pack, inputKeys)}` };

  return {
    conduits, chests, configs,
    logisticsPort: hooked === null || inputChest === null ? null : [...inputChest],
    hookup: hooked?.hookup ?? null,
    extraParts: hooked?.extraParts ?? [],
    lineDraft, stockDraft,
    warnings: [...warnings, ...channelWarnings(input, channels)],
    tailFluidY: Math.max(1, outputSlices.length),
  };
}

// ---- Fluids ----

/** A unit's fluid port with the fluids it makes and takes there (each list sorted). */
interface FluidPortPlan { pos: Vec3; side: number; port: FluidPort; makes: readonly StuffKey[]; takes: readonly StuffKey[] }

/**
 * Where a unit's fluids are met. A GT basic machine (pack kind `basic`, an electric `MTEBasicMachine`): on its spine
 * cell, the face on its output side (`spine`), the cell and face its items use, so one bundle face serves both (GT
 * 5.09.54 `MTEBasicMachine.isLiquidOutput(side)` is `side ≠ mMainFacing` and `isLiquidInput(side)` is `side ≠ mMainFacing
 * && (mAllowInputFromOutputSide || side ≠ getFrontFacing())`, the rule `allowPullStack` and `allowPutStack` give its
 * items, and `BaseMetaTileEntity.fill` and `drain` ask exactly these; EnderIO's fluid conduit joins any GT tile whose
 * tank holds anything, `AbstractLiquidConduit.canConnectToExternal` asking `getCapacity() > 0`, which every machine whose
 * recipes use fluids has, and each conduit of a bundle connects on its own). A multiblock: the cell each fluid hatch
 * faces, one fluid each (`hatch`: above it, or beside it where GT takes the hatch only lower down). Any other
 * single-block machine that is no steam machine keeps the cell above it for all its fluids (`top`). A steam machine
 * (`MTEBasicMachineBronze`) vents through its top (`allowToCheckRecipe`), so it gets no fluid port here and its fluids
 * are moved by hand (`steam_fluids`); the other kinds follow rules of their own. A port's face looks at its hatch or
 * machine.
 */
function unitFluidPorts(pack: Pack, u: PlacedUnit): FluidPortPlan[] {
  if (u.io.fluidIn.length === 0 && u.io.fluidOut.length === 0) return [];
  if (u.multiblock) {
    return [
      ...u.ports.fluidIn.map((pos, i): FluidPortPlan => ({ pos, side: u.ports.fluidInSides[i] ?? DOWN, port: 'hatch', makes: [], takes: [u.io.fluidIn[i]!] })),
      ...u.ports.fluidOut.map((pos, i): FluidPortPlan => ({ pos, side: u.ports.fluidOutSides[i] ?? DOWN, port: 'hatch', makes: [u.io.fluidOut[i]!], takes: [] })),
    ];
  }
  const spine = u.ports.items[0];
  if (pack.machines.get(u.mteId)?.kind === 'basic' && spine !== undefined) {
    return [{ pos: spine, side: OPPOSITE[u.facing]!, port: 'spine', makes: u.io.fluidOut, takes: u.io.fluidIn }];
  }
  const top = u.ports.fluidIn[0] ?? u.ports.fluidOut[0];
  return top === undefined ? [] : [{ pos: top, side: DOWN, port: 'top', makes: u.io.fluidOut, takes: u.io.fluidIn }];
}

/**
 * The face of every fluid port toward its unit (`unitFluidPorts`), in face order: Extract the fluids the unit makes
 * there, at Σ the step's flows of them ÷ step.count; Insert the fluids it takes there, at Σ their flows into the step ÷
 * step.count. A face on a basic machine's output side that inserts is `outputSide`.
 */
function portFaces(input: ModeInput, fluids: readonly PlanFlow[]): FacePlan[] {
  const { pack, plan, placement } = input;
  return placement.units.flatMap((u) => unitFluidPorts(pack, u).map((p): FacePlan => {
    const count = plan.steps.find((s) => s.id === u.stepId)?.count ?? 1;
    const extractRate = sumRate(fluids.filter((f) => f.from === u.stepId && p.makes.includes(f.key))) / Math.max(1, count);
    const insertRate = unitIntake(plan, fluids.filter((f) => p.takes.includes(f.key)), u.stepId);
    return {
      pos: [...p.pos], side: p.side, target: u.name, stepId: u.stepId, port: p.port,
      extract: p.makes.length === 0 ? null : { keys: [...p.makes], rate: extractRate },
      insert: p.takes.length === 0 ? null : { keys: [...p.takes], rate: insertRate },
      ...(p.port === 'spine' && p.takes.length > 0 ? { outputSide: true as const } : {}),
    };
  })).sort(compareFaces);
}

/** An open fluid conduit end at the tail and the fluid it passes. */
interface OpenEnd { key: StuffKey; face: FacePlan }

/**
 * One open end per fluid that enters or leaves the line, in key order, at `[tailX, i, spineZ]`, its east face toward your
 * tank: Extract a fluid that enters, Insert one that leaves, In / Out both, each side at Σ the flows that cross the line's
 * edge that way. These are the nets `FluidNet.atTail` marks, less one whose only flows outside the line pass it by.
 */
function openEnds(nets: readonly FluidNet[], fluids: readonly PlanFlow[], placed: ReadonlySet<string>, placement: Placement): OpenEnd[] {
  const { entering, leaving } = edgeFlows(fluids, placed);
  const out: OpenEnd[] = [];
  for (const { key } of nets) {
    const into = entering.filter((f) => f.key === key), away = leaving.filter((f) => f.key === key);
    if (into.length === 0 && away.length === 0) continue;
    out.push({ key, face: {
      pos: [placement.tailX, out.length, placement.spineZ], side: EAST, target: YOUR_TANK, stepId: null,
      extract: into.length === 0 ? null : { keys: [key], rate: sumRate(into) },
      insert: away.length === 0 ? null : { keys: [key], rate: sumRate(away) },
    } });
  }
  return out;
}

/**
 * The fluid conduit network's cells (sorted by x, y, z) and links: it starts as the spine cells linked along x and the
 * open-end column `[tailX, i, spineZ]` (i = 1 … ends − 1) linked up from the tail cell, which already hold the ports on
 * the spine; Plan 5's `growTree` adds a riser from every other port (by posKey) to the nearest network cell, inside the
 * box up to the higher of the units and the column, at x ≥ firstX, on cells that are not `blocked`; then every cell with
 * at most one link that is neither a port nor an open end is dropped until none is left. `unreached`: the ports no riser
 * reaches.
 */
function fluidNetwork(placement: Placement, ports: readonly Vec3[], ends: number, blocked: ReadonlySet<string>): {
  cells: Vec3[]; links: Array<[Vec3, Vec3]>; unreached: Vec3[];
} {
  const { firstX, tailX, spineZ, size: [w, h, l] } = placement;
  const roots: Vec3[] = [];
  const rootLinks: Array<[Vec3, Vec3]> = [];
  for (let x = firstX; x <= tailX; x++) {
    roots.push([x, 0, spineZ]);
    if (x > firstX) rootLinks.push([[x - 1, 0, spineZ], [x, 0, spineZ]]);
  }
  for (let i = 1; i < ends; i++) {
    roots.push([tailX, i, spineZ]);
    rootLinks.push([[tailX, i - 1, spineZ], [tailX, i, spineZ]]);
  }
  const bounds: PathBounds = { min: [0, 0, 0], max: [w - 1, Math.max(h, ends - 1), l - 1] };
  const terminals = [...ports].sort((a, b) => compareText(posKey(a), posKey(b)));
  const tree = growTree(roots, terminals, { bounds, passable: (p) => p[0] >= firstX && !blocked.has(posKey(p)) });

  const keep = new Set([...ports.map(posKey), ...Array.from({ length: ends }, (_, i) => posKey([tailX, i, spineZ]))]);
  let cells = [...roots, ...tree.cells];
  let links = [...rootLinks, ...tree.links];
  for (;;) {
    const degree = new Map<string, number>();
    for (const link of links) for (const p of link) degree.set(posKey(p), (degree.get(posKey(p)) ?? 0) + 1);
    const dropped = new Set(cells.map(posKey).filter((key) => !keep.has(key) && (degree.get(key) ?? 0) <= 1));
    if (dropped.size === 0) break;
    cells = cells.filter((c) => !dropped.has(posKey(c)));
    links = links.filter(([a, b]) => !dropped.has(posKey(a)) && !dropped.has(posKey(b)));
  }
  return { cells: cells.sort(comparePos), links, unreached: tree.unreached };
}

/**
 * Each fluid side's colour, filter and round robin, by face (fluid conduits have no self feed, speed upgrades or
 * priority), with the `filter_full` warnings. Round robin is on for a side that can hand to two or more insert sides,
 * open ends among them (`roundRobin`): without it, a tank that took fluid once would be tried first from then on and
 * take it all.
 */
function fluidSettings(input: ModeInput, plans: readonly FacePlan[], channels: ChannelPlan): { configured: FaceSettings; warnings: PlanWarning[] } {
  const filterWarnings = new WarningList();
  const filterOf = (f: FacePlan, side: SideName, keys: readonly StuffKey[]): ConduitFilter => {
    const { filter, dropped } = fluidFilterFor(keys);
    if (dropped.length > 0) filterWarnings.add(filterFullWarning(input, f, side, filter, dropped));
    return filter;
  };
  const extractOf = (f: FacePlan, s: Side): ConduitExtract => {
    const id = endId(f, 'extract');
    return {
      color: channels.colors.get(id)!, filter: filterOf(f, 'extract', s.keys), rate: s.rate, roundRobin: roundRobin('fluid', f, targetsOf(plans, channels.colors, f)),
      redstone: 'ignore',
    };
  };
  const insertOf = (f: FacePlan, s: Side): ConduitInsert => ({
    color: channels.colors.get(endId(f, 'insert'))!, filter: filterOf(f, 'insert', s.keys), rate: s.rate,
    ...(f.outputSide === true ? { outputSide: true } : {}),
  });
  return { configured: configureFaces(plans, extractOf, insertOf), warnings: filterWarnings.list };
}

/** The distinct names of the faces' units whose fluid port is `port`, in face order. */
function portNames(faces: readonly FacePlan[], port: FluidPort): string[] {
  return [...new Set(faces.filter((f) => f.port === port).map((f) => f.target))];
}

/**
 * `layout:logistics:fluids`: lay the network along the middle row[ to the output side of each GT basic machine whose
 * fluids it meets there][ and to the fluid hatches of each multiblock][ and up to the top of each other machine][,
 * with its open ends][; and how many of its cells share a bundle with the Item Conduit], from the laid faces `laid`;
 * with open ends, `layout:logistics:tanks`: a tank on each, from the bottom. Both pinned to the site. The tanks step
 * names the open ends' side by the line's shape, never by compass: drafts are in the line's own frame and become build
 * steps word for word, so a compass word would be wrong once the line is turned (each open end's turned face is named
 * in its own `layout:conduit:…` configure step).
 */
function fluidDrafts(input: ModeInput, conduit: string, cells: readonly Vec3[], laid: readonly FacePlan[], ends: readonly OpenEnd[],
  itemCells: ReadonlySet<string>): StepDraft[] {
  if (cells.length === 0) return [];
  const bundled = cells.filter((c) => itemCells.has(posKey(c))).length;
  const hatches = portNames(laid, 'hatch'), tops = portNames(laid, 'top');
  const reach = `${laid.some((f) => f.port === 'spine') ? ' to the output side of each electric single-block machine that moves fluids' : ''}`
    + `${hatches.length === 0 ? '' : ` and to the fluid hatches of each ${joinNames(hatches)}`}`
    + `${tops.length === 0 ? '' : ` and up to the top of each ${joinNames(tops)}`}`;
  const endWords = ends.length === 0 ? '' : `, with ${ends.length === 1 ? 'an open end' : `${fmtInt(ends.length)} open ends`} at the tail for your tanks`;
  const bundleWords = bundled === 0 ? ''
    : `; ${fmtInt(bundled)} of them ${bundled === 1 ? 'goes' : 'go'} in the same bundle as the ${CONDUIT_NAMES.item}`;
  const drafts: StepDraft[] = [{ id: 'layout:logistics:fluids', kind: 'logistics', pin: 'site',
    text: `Lay ${fmtInt(cells.length)}× ${conduit} along the middle row${reach}${endWords}${bundleWords}` }];
  if (ends.length > 0) {
    drafts.push({ id: 'layout:logistics:tanks', kind: 'logistics', pin: 'site',
      text: 'Connect a tank to the side of each open conduit end at the tail that faces out of the end of the line, '
        + `from the bottom: ${nameList(input.plan, input.pack, ends.map((e) => e.key))}` });
  }
  return drafts;
}

/** The fluid conduit network: its conduits, the machines' settings, drafts and warnings. */
interface FluidLine { conduits: CellConduit[]; configs: HostConfig[]; drafts: StepDraft[]; warnings: PlanWarning[] }

/**
 * One ender fluid conduit network for every fluid the units move (plan 11 "How the EnderIO mode works", Fluids): the
 * faces of the fluid ports (a GT basic machine's on its output side, beside its item face, so it has one connection for
 * both) and the open ends; the slowest ender tier that moves the busiest extract and the busiest insert side of them
 * (one tier for the whole network, since EnderIO joins only conduits of one kind, so a port left for the player to
 * connect counts too); the network along the spine, through the Item Conduit's cells, with risers through free cells to
 * the ports above; the channels of its faces by the plan's fluid flows; Disabled toward the singleblock machines and
 * fluid hatches it touches otherwise; and Input from Output Side on every machine a laid face inserts into through its
 * output side, sorted by pos.
 */
function fluidLine(input: ModeInput, nets: readonly FluidNet[], items: ItemLine | null): FluidLine {
  const { parts, plan, placement } = input;
  const placed = placedStepIds(placement);
  const fluids = plan.flows.filter((f) => isFluidKey(f.key));
  const ports = portFaces(input, fluids);
  const ends = openEnds(nets, fluids, placed, placement);
  const planned = [...ports, ...ends.map((e) => e.face)];
  const need: Record<SideName, number> = { extract: busiest(planned, 'extract'), insert: busiest(planned, 'insert') };
  const { part, kind, short } = pickFluidConduit(parts, need);

  // a riser may cross a free cell or an Item Conduit cell, never a unit, reserved air, a power port, a chest or a cell
  // beside a unit run by hand, which nothing of the line touches
  const blocked = new Set([
    ...placement.blocks.map((b) => posKey(b.pos)), ...placement.reserved.map(posKey),
    ...placement.units.flatMap((u) => (u.ports.power === null ? [] : [posKey(u.ports.power)])),
    ...(items?.chests ?? []).map((c) => posKey(c.pos)), ...handRunSurroundings(placement).map(posKey),
  ]);
  const network = fluidNetwork(placement, ports.map((f) => f.pos), ends.length, blocked);
  const laidCells = new Set(network.cells.map(posKey));
  const laid = planned.filter((f) => laidCells.has(posKey(f.pos))).sort(compareFaces);

  const channels = planChannels(laid, fluids, placed, []);
  const { configured, warnings: filterWarnings } = fluidSettings(input, laid, channels);
  const bits = linkBits(network.links);
  const touching = unitTraders(placement, (u, b) => (b.role === 'machine' && !u.multiblock) || hatchOf(u, b, ['input_hatch', 'output_hatch']) !== null);
  const conduits = network.cells.map((pos): CellConduit => {
    const connections = bits.get(posKey(pos)) ?? 0;
    return { pos, spec: { kind, item: part.key, connections, faces: conduitFaces(pos, connections, configured, touching) } };
  });

  const unreached = new WarningList();
  for (const p of network.unreached) {
    const port = ports.find((f) => posKey(f.pos) === posKey(p));
    if (port === undefined || port.stepId === null) continue;
    unreached.add({ code: 'route_failed', stepId: port.stepId, text: `Could not lay the ${CONDUIT_NAMES[kind]} to ${port.target} — connect it by hand` });
  }
  const itemCells = new Set((items?.conduits ?? []).map((c) => posKey(c.pos)));
  const configs = laid.filter((f) => f.outputSide === true)
    .map((f): HostConfig => ({ pos: step(f.pos, f.side), config: { inputFromOutputSide: true } })).sort((a, b) => comparePos(a.pos, b.pos));
  return {
    conduits, configs,
    drafts: fluidDrafts(input, CONDUIT_NAMES[kind], network.cells, laid, ends, itemCells),
    warnings: [
      ...(short ? [fluidRateWarning(kind, need)] : []), ...filterWarnings, ...channelWarnings(input, channels), ...fluidShareWarnings(input, laid, channels),
      ...unreached.list,
    ],
  };
}

// ---- The mode ----

/**
 * The Item Conduit line when any placed unit moves items, and the ender fluid conduit network when any moves fluids,
 * sharing cells as conduit bundles; nothing when the units move neither. The mode then lays the line's fluids itself
 * (`ownsFluids`). Drafts: lay the item line, lay the fluid network and connect its tanks, then stock the input chest.
 */
export function enderioMode(input: ModeInput): ModeResult {
  const { pack, plan, placement } = input;
  const nets = fluidNets(pack, plan, placement);
  const items = itemPorts(placement).length > 0 ? itemLine(input) : null;
  if (items === null && nets.length === 0) return emptyModeResult();
  const fluids = nets.length > 0 ? fluidLine(input, nets, items) : null;
  const stock = items?.stockDraft ?? null;
  // a machine that takes items and fluids through its output side gets the setting once; then the machines' feeding
  // settings (architecture §11 entry 51)
  const configs = mergeHostConfigs([...(items?.configs ?? []), ...(fluids?.configs ?? []), ...feedSettings(pack, plan, placement)]);
  return {
    blocks: [...conduitBlocks(items?.conduits ?? [], fluids?.conduits ?? []), ...(items?.chests ?? [])].sort((a, b) => comparePos(a.pos, b.pos)),
    covers: [], configs,
    logisticsPort: items?.logisticsPort ?? null,
    hookup: items?.hookup ?? null,
    extraParts: items?.extraParts ?? [],
    drafts: [...(items === null ? [] : [items.lineDraft]), ...(fluids?.drafts ?? []), ...(stock === null ? [] : [stock])],
    warnings: [...(items?.warnings ?? []), ...(fluids?.warnings ?? [])],
    tailFluidY: items?.tailFluidY ?? 1,
    ...(fluids === null ? {} : { ownsFluids: true }),
  };
}
