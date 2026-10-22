// The static feeding rules (architecture §11 entry 51; research docs/research/machine-feeding.md §7 "Static rules", with
// add-on 21's rule table and words, its R1–R9 and R12; R10, benches, and R11, shared machines, are add-on 12's, which
// so far reads a shared machine's every step and an Auto Workbench's own feed into R1, R5a, R5d and R9): what
// a laid-out routed, AE2 or EnderIO line leaves that can overfill or deadlock a machine, read from the layout itself — its
// machines and buses, their settings, and the structured chips and patterns of `LayoutBlock.feed` — so the warnings say
// what the build steps and the 3D view show. Each rule raises the feeding checker's code: `feed_crowded`,
// `feed_overfill`, `feed_no_route`, `feed_starved`, `feed_churn`, `feed_pattern_unencodable`, `feed_fluid_packet` and
// `feed_leak`. Machine to machine (add-on 15's mode) is left to add-on 15 and the checker. When add-on 21's
// `precheckFeeding` lands, it replaces this module. Every order is fixed: machines in block order, then rule order, then
// key order (a pattern's items in its own order).

import { isFluidKey, parseItemKey, type StuffKey } from '../../shared/keys.ts';
import { fmtInt, joinNames } from '../../shared/layout/format.ts';
import { basicInputSlots, ignoredByBlocking, PROGRAMMED_CIRCUIT_ITEM } from '../../shared/gt/feeding.ts';
import { DIRS, posKey, step, type Vec3 } from '../../shared/layout/geometry.ts';
import type { InterfaceSpec, ItemFilterSpec, RoutedChipSpec } from '../../shared/types/feed.ts';
import type { Layout, LayoutBlock } from '../../shared/types/layout.ts';
import type { Machine, Pack } from '../../shared/types/pack.ts';
import type { Plan, PlanFlow, PlanStep, PlanWarning } from '../../shared/types/plan.ts';
import { stepOneOffs } from '../planner/bom.ts';
import { isAutoWorkbench } from '../planner/machine-options.ts';
import { comparePos } from '../world/graph.ts';
import { stepItemInputs, stepItemOutputs } from './modes/mode.ts';
import { hasInputSeparation, manualReasonOf } from './multiblock-rules.ts';

export interface FeedRulesInput { pack: Pack; plan: Plan; layout: Pick<Layout, 'mode' | 'blocks'> }

// ---- GT basic machines' input slots ----

/** A GT basic machine's input slots (shared/gt/feeding.ts, which the planner reads too: controller ruling 214 (b)). */
export { basicInputSlots };

// ---- Words ----

/** Whole numbers with thousands separators, anything else to two decimals. */
function amountText(n: number): string {
  return Number.isInteger(n) ? fmtInt(n) : n.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

function slotWord(n: number): string {
  return `${fmtInt(n)} input slot${n === 1 ? '' : 's'}`;
}

function kindWord(n: number): string {
  return `${fmtInt(n)} kind${n === 1 ? '' : 's'} of item`;
}

/** `<label> at x y z`: a block in a builder's words. */
function where(b: Pick<LayoutBlock, 'label' | 'pos'>): string {
  return `${b.label} at ${b.pos.join(' ')}`;
}

/** How an Extractor Chip that does not pass an item fails it: an empty whitelist (a new chip) or a list without it. */
function extractorFault(extractors: readonly RoutedChipSpec[]): string {
  return extractors.every((c) => (c.filter?.keys.length ?? 0) === 0) ? 'has an empty whitelist (a new chip extracts nothing)' : 'does not list it';
}

// ---- The line as the rules read it ----

/**
 * A machine of a placed step: its block, step (the first of a shared machine's, `LayoutBlock.stepIds`: plan 12), every
 * step it runs, pack machine and words, and for a multiblock its item buses.
 */
interface Node {
  block: LayoutBlock; step: PlanStep; steps: PlanStep[]; machine: Machine | undefined; label: string; multiblock: boolean;
  inBuses: LayoutBlock[]; outBuses: LayoutBlock[];
}

/** A routed interface pipe with its chips and the inventory its links join. */
interface ChipPipe { block: LayoutBlock; chips: RoutedChipSpec[]; targets: LayoutBlock[] }
/** An ME interface with its patterns and every inventory beside it (a full block pushes into each). */
interface MeInterface { block: LayoutBlock; spec: InterfaceSpec; targets: LayoutBlock[] }

/** What every rule reads. */
interface Line {
  pack: Pack; plan: Plan; nameOf: (k: StuffKey) => string; nodes: Node[]; laid: ReadonlySet<string>; items: PlanFlow[];
  pipes: ChipPipe[]; interfaces: MeInterface[]; inputChests: LayoutBlock[];
}

/** One finding of a rule on the node it raises for. */
type Raise = (code: string, text: string, key?: StuffKey) => void;

function distance(a: Vec3, b: Vec3): number {
  return Math.abs(a[0] - b[0]) + Math.abs(a[1] - b[1]) + Math.abs(a[2] - b[2]);
}

/** A filter passes a key: on its list for a whitelist, off it for a blacklist. */
function passes(filter: ItemFilterSpec | undefined, key: StuffKey): boolean {
  return filter !== undefined && filter.keys.includes(key) === (filter.mode === 'whitelist');
}

function compareText(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0;
}

function sorted(keys: Iterable<StuffKey>): StuffKey[] {
  return [...new Set(keys)].sort(compareText);
}

/** The machine nodes of the placed steps, in block order: hand-run machines left out, each item bus with its nearest controller. */
function lineNodes(pack: Pack, plan: Plan, live: readonly LayoutBlock[]): Node[] {
  const nodes: Node[] = [];
  for (const b of live) {
    if (b.role !== 'machine' || b.stepId === undefined) continue;
    const step = plan.steps.find((s) => s.id === b.stepId);
    const machine = b.block.mteId === undefined ? undefined : pack.machines.get(b.block.mteId);
    if (step === undefined || (machine !== undefined && manualReasonOf(machine) !== null)) continue;
    const steps = (b.stepIds ?? [b.stepId]).flatMap((id) => plan.steps.find((s) => s.id === id) ?? []);
    nodes.push({ block: b, step, steps, machine, label: where(b), multiblock: machine?.kind === 'multiblock', inBuses: [], outBuses: [] });
  }
  for (const b of live) {
    if (b.role !== 'hatch' || (b.hatch !== 'input_bus' && b.hatch !== 'output_bus')) continue;
    const owner = nodes.filter((n) => n.multiblock && n.step.id === b.stepId)
      .reduce<Node | undefined>((best, n) => (best === undefined || distance(n.block.pos, b.pos) < distance(best.block.pos, b.pos) ? n : best), undefined);
    owner?.[b.hatch === 'input_bus' ? 'inBuses' : 'outBuses'].push(b);
  }
  return nodes;
}

function isInventory(b: LayoutBlock): boolean {
  return b.role === 'machine' || b.role === 'chest' || (b.role === 'hatch' && (b.hatch === 'input_bus' || b.hatch === 'output_bus'));
}

/** The inventory blocks (machine, bus or chest) beside `b` on the sides `sides` lets through, in side order. */
function inventoriesBeside(b: LayoutBlock, byPos: ReadonlyMap<string, LayoutBlock>, sides: (side: number) => boolean): LayoutBlock[] {
  return DIRS.flatMap((_, side) => {
    const n = sides(side) ? byPos.get(posKey(step(b.pos, side))) : undefined;
    return n !== undefined && isInventory(n) ? [n] : [];
  });
}

function ownBlocks(n: Node): LayoutBlock[] {
  return [n.block, ...n.inBuses, ...n.outBuses];
}

function chipsOf(pipes: readonly ChipPipe[], kind: RoutedChipSpec['kind']): RoutedChipSpec[] {
  return pipes.flatMap((p) => p.chips.filter((c) => c.kind === kind));
}

function pipesAt(line: Line, targets: readonly LayoutBlock[]): ChipPipe[] {
  return line.pipes.filter((p) => p.targets.some((t) => targets.includes(t)));
}

function nodeOf(line: Line, b: LayoutBlock): Node | undefined {
  return line.nodes.find((n) => ownBlocks(n).includes(b));
}

/** A step by what it makes: its main output's name, else its first output's, else its machine's. */
function stepName(line: Line, s: PlanStep): string {
  const key = s.mainOutput ?? s.outputs[0]?.key;
  return key === undefined ? s.machine.name : line.nameOf(key);
}

// ---- The rules ----

/** R1–R4: a machine's kinds against its input slots, and the settings that keep one kind from crowding the others. */
function slotRules(line: Line, n: Node, pushes: boolean, raise: Raise): void {
  const { pack, plan, nameOf } = line;
  // what the machine is fed for every step it runs (a shared machine, plan 12)
  const takes = sorted(n.steps.flatMap((s) => stepItemInputs(plan, s.id)));
  const basic = !n.multiblock && (n.machine?.kind === 'basic' || n.machine?.kind === 'steam');
  // R1: the kinds one run uses up against the input slots its held items leave (a programmed circuit has its own slot),
  // for each recipe the machine runs, once per machine
  const slots = basic && n.machine !== undefined ? basicInputSlots(n.machine) : null;
  if (slots !== null) {
    const crowded = n.steps.map((s) => {
      const kinds = new Set(s.inputs.filter((p) => !isFluidKey(p.key)).map((p) => p.key)).size;
      const held = stepOneOffs(pack, s).map((h) => h.key).filter((k) => parseItemKey(k).id !== PROGRAMMED_CIRCUIT_ITEM);
      return { kinds, held, free: Math.max(0, slots - held.length) };
    }).find((r) => r.kinds > r.free);
    if (crowded !== undefined) {
      const { kinds, held, free } = crowded;
      raise('feed_crowded', `${n.label} takes ${kindWord(kinds)} but has ${slotWord(free)} free`
        + `${held.length > 0 ? ` (${fmtInt(held.length)} held: ${joinNames(held.map(nameOf))})` : ''}: one kind always waits`);
    }
  }
  // R2: Multi Stack Input on a machine fed two or more kinds by a line that pushes
  if (basic && pushes && takes.length >= 2) {
    const set = n.block.config?.multiStack;
    if (set === true) {
      raise('feed_crowded', `${n.label} has Multi Stack Input On and takes ${kindWord(takes.length)}: the first kind to arrive fills every free input slot`);
    } else if (set !== false) {
      raise('feed_crowded', `${n.label} takes ${kindWord(takes.length)} and the layout does not set Multi Stack Input Off: with it On, the first kind `
        + 'to arrive fills every free input slot');
    }
  }
  if (!n.multiblock) return;
  // R3: Limiting mode on each input bus fed two or more kinds
  if (takes.length >= 2) {
    for (const bus of n.inBuses.filter((b) => b.config?.limited !== true)) {
      raise('feed_overfill', `${where(bus)} of ${n.label} takes ${kindWord(takes.length)} without Limiting mode: one kind can fill every slot of the bus`);
    }
  }
  // R4: Input Separation checks each bus alone; it is on in a new controller that has the setting (the EBF, the Pyrolyse
  // Oven, GT++'s industrial multiblocks), and a controller without it reads all its buses together
  const separated = n.block.config?.inputSeparation ?? hasInputSeparation(n.machine);
  if (n.inBuses.length >= 2 && separated !== false) {
    raise('feed_crowded', `${n.label} has ${fmtInt(n.inBuses.length)} input buses with Input Separation on: each bus is checked alone, so a recipe `
      + 'whose items arrive on different buses never starts');
  }
}

/** R5–R7: what a machine's chips take out and in, and what takes its items on the routed network. */
function routedRules(line: Line, n: Node, raise: Raise): void {
  const { plan, nameOf, items, laid } = line;
  const s = n.step;
  const takes = stepItemInputs(plan, s.id);
  const makes = stepItemOutputs(plan, s.id);
  const outPipes = pipesAt(line, n.multiblock ? n.outBuses : [n.block]);
  const extractors = chipsOf(outPipes, 'extractor');
  const broadcasters = chipsOf(outPipes, 'broadcaster');
  // R5a: what it makes, each out through an Extractor Chip that lists it, or a Broadcaster Chip that fills an Auto
  // Workbench's orders for it (plan 12)
  for (const key of makes.filter((k) => !extractors.some((c) => passes(c.filter, k)) && !broadcasters.some((c) => passes(c.filter, k)))) {
    const how = extractors.length === 0 ? 'no Item Extractor Chip is on its interface pipe' : `its Item Extractor Chip ${extractorFault(extractors)}`;
    raise('feed_no_route', `Nothing takes ${nameOf(key)} out of ${n.label}: ${how}`, key);
  }
  // R5b: an Extractor that lists an item the machine takes gives up its whole update on it
  if (!n.multiblock) {
    for (const key of takes.filter((k) => extractors.some((c) => passes(c.filter, k)))) {
      raise('feed_starved', `The Item Extractor Chip on ${n.label} also lists ${nameOf(key)}, which it cannot take back out: each time it tries it `
        + 'first, it gives up the whole update', key);
    }
  }
  // R5c: an Extractor on an input bus pulls the inputs back out
  for (const bus of n.inBuses.filter((b) => chipsOf(pipesAt(line, [b]), 'extractor').length > 0)) {
    raise('feed_churn', `The Item Extractor Chip on ${where(bus)} pulls ${n.label}'s inputs back out of its input bus`);
  }
  // R5d: what it takes from outside the line, each out of the input chest through its Extractor, or for an Auto
  // Workbench, which orders what it takes with its Stock Keeper, its Broadcaster (plan 12)
  const fromOutside = sorted(items.filter((f) => f.to === s.id && !laid.has(f.from)).map((f) => f.key));
  const bench = isAutoWorkbench(n.machine);
  const chestChip = bench ? 'Item Broadcaster Chip' : 'Item Extractor Chip';
  for (const chest of line.inputChests) {
    const chestChips = chipsOf(pipesAt(line, [chest]), bench ? 'broadcaster' : 'extractor');
    for (const key of fromOutside.filter((k) => !chestChips.some((c) => passes(c.filter, k)))) {
      const how = chestChips.length === 0 ? `no ${chestChip} is on the interface pipe of ${where(chest)}`
        : `the ${chestChip} on ${where(chest)} ${bench ? 'does not list it' : extractorFault(chestChips)}`;
      raise('feed_starved', `${n.label} never gets ${nameOf(key)}: ${how}`, key);
    }
  }
  // R6: what it makes, each taken somewhere else by a Responder, Terminator, Overflow Responder or Stock Keeper
  const own = new Set(ownBlocks(n));
  const others = line.pipes.filter((p) => !p.targets.some((t) => own.has(t)));
  const takenBy = (c: RoutedChipSpec, key: StuffKey): boolean => ((c.kind === 'responder' || c.kind === 'terminator') && passes(c.filter, key))
    || c.kind === 'overflow' || (c.kind === 'stock_keeper' && (c.stock ?? []).some((st) => st.key === key));
  const strays = makes.filter((k) => !items.some((f) => f.from === s.id && f.key === k));
  for (const key of sorted([...items.filter((f) => f.from === s.id).map((f) => f.key), ...strays])) {
    if (others.some((p) => p.chips.some((c) => takenBy(c, key)))) continue;
    const to = items.find((f) => f.from === s.id && f.key === key && !laid.has(f.to) && plan.steps.some((x) => x.id === f.to));
    const toStep = to === undefined ? undefined : plan.steps.find((x) => x.id === to.to);
    raise('feed_no_route', `Nothing on the routed network takes ${nameOf(key)} from ${n.label}: no Item Responder Chip lists it`
      + `${toStep === undefined ? '' : ` (it goes to ${stepName(line, toStep)}, which has no machine)`}`, key);
  }
  // R7: a Broadcaster offers what its filter passes, so anything but a whitelist of the machine's outputs offers its inputs too
  for (const c of chipsOf(outPipes, 'broadcaster')) {
    if (c.filter?.mode === 'whitelist' && c.filter.keys.every((k) => makes.includes(k))) continue;
    raise('feed_starved', `The Item Broadcaster Chip on ${n.label} offers its inputs too: an order for one of them fails and is dropped`);
  }
}

/** R8, R9, R12: the patterns of the ME interfaces that serve a machine, their blocking mode, and what else they touch. */
function ae2Rules(line: Line, n: Node, raise: Raise): void {
  const { pack, nameOf } = line;
  // what the machine holds for every step it runs (a shared machine's steps hold the same: their sharing key holds them)
  const held = sorted(n.steps.flatMap((s) => stepOneOffs(pack, s).map((h) => h.key)));
  const unencodable = (key: StuffKey, text: string): void => raise('feed_pattern_unencodable', `The pattern for ${n.label} ${text}`, key);
  for (const iface of line.interfaces.filter((i) => i.targets.some((t) => nodeOf(line, t) === n))) {
    const name = where(iface.block);
    // R8: a pattern holds the items one run uses up, in whole numbers
    for (const p of iface.spec.patterns) {
      for (const { key, amount } of p.inputs) {
        if (isFluidKey(key)) unencodable(key, `lists ${nameOf(key)}, a fluid the line pipes: ME never holds it, so AE2 cannot plan with it`);
        else if (!Number.isInteger(amount)) unencodable(key, `holds ${amountText(amount)}× ${nameOf(key)}: a pattern holds whole items`);
        else if (held.includes(key) || parseItemKey(key).id === PROGRAMMED_CIRCUIT_ITEM) unencodable(key, `lists ${nameOf(key)}, which ${n.label} keeps and does not use up`);
      }
      for (const { key, amount } of p.outputs) {
        if (isFluidKey(key)) unencodable(key, `makes ${nameOf(key)}, which the line pipes away: it never comes back to ME`);
        else if (!Number.isInteger(amount)) unencodable(key, `holds ${amountText(amount)}× ${nameOf(key)}: a pattern holds whole items`);
      }
      if (iface.spec.dual === true) continue;
      for (const { key } of p.inputs.filter((i) => isFluidKey(i.key))) {
        raise('feed_fluid_packet', `${name} turns ${nameOf(key)} into a Fluid Packet item, which ${n.label} can take into an input slot for good`, key);
      }
    }
    // R9: blocking mode waits for ever on a held item it does not ignore, and on an Auto Workbench, whose ghost crafting
    // grid GT counts as items (research machine-feeding §1.3.6, controller ruling 204 (1))
    if (iface.spec.blocking) {
      for (const key of sorted(held.filter((k) => !ignoredByBlocking(pack, k)))) {
        raise('feed_starved', `${name} has blocking mode on and ${n.label} holds ${nameOf(key)}, which blocking mode does not ignore: it never pushes into it`, key);
      }
      if (isAutoWorkbench(n.machine)) {
        raise('feed_starved', `${name} has blocking mode on toward ${n.label}, an Auto Workbench: blocking mode counts the items of its crafting grid, so `
          + 'it never pushes into it');
      }
    }
    // R12: a full-block interface pushes into every inventory beside it (a machine's buses count as the machine), said
    // once, on the first machine it serves
    const touched = iface.targets.filter((t, i) => nodeOf(line, t) === undefined || iface.targets.findIndex((u) => nodeOf(line, u) === nodeOf(line, t)) === i)
      .sort((a, b) => comparePos(a.pos, b.pos));
    if (touched.length >= 2 && touched.map((t) => nodeOf(line, t)).find((x) => x !== undefined) === n) {
      raise('feed_leak', `${name} pushes into ${fmtInt(touched.length)} inventories (${joinNames(touched.map((t) => nodeOf(line, t)?.label ?? where(t)))}): `
        + "its pattern's items can reach the wrong one");
    }
  }
}

/**
 * The static feeding rules' warnings for `layout` (none for machine-to-machine lines), per machine of a placed step in
 * block order: R1 its kinds against its free input slots; R2 Multi Stack Input left unset or On on a machine fed two or
 * more kinds by a line that pushes (routed, EnderIO); R3 an input bus fed two or more kinds without Limiting mode; R4 two
 * or more input buses with Input Separation on (set, or a new controller's that has the setting: `hasInputSeparation`;
 * a controller without it reads all its buses together); on routed lines R5a an item it makes that no Extractor Chip takes out,
 * R5b an item it takes that its Extractor lists, R5c an Extractor on an input bus, R5d an item it takes from outside the
 * line that the input chest's Extractor keeps in, R6 an item it makes that nothing on the network takes, R7 a
 * Broadcaster that offers more than its outputs; on AE2 lines R8 a pattern AE2 cannot encode (a fluid, a fraction, a
 * held item), R9 blocking mode toward a held item blocking mode does not ignore or toward an Auto Workbench, and R12 an
 * interface beside two inventories. A shared machine (plan 12, `LayoutBlock.stepIds`) is read with every step it runs;
 * an Auto Workbench's ingredients leave their makers and the input chest through Broadcaster Chips, which R5a and R5d
 * take as their way out.
 */
export function feedingWarnings(input: FeedRulesInput): PlanWarning[] {
  const { pack, plan, layout } = input;
  if (layout.mode === 'direct') return [];
  const live = layout.blocks.filter((b) => b.role !== 'ghost' && b.hookup === undefined);
  const byPos = new Map(live.map((b) => [posKey(b.pos), b]));
  const nodes = lineNodes(pack, plan, live);
  const linked = (b: LayoutBlock) => (side: number): boolean => ((b.connections ?? 0) & (1 << side)) !== 0;
  const line: Line = {
    pack, plan, nameOf: (k) => plan.names?.[k] ?? pack.nameOf(k), nodes, laid: new Set(nodes.flatMap((n) => n.steps.map((s) => s.id))),
    items: plan.flows.filter((f) => !isFluidKey(f.key)),
    pipes: layout.mode !== 'routed' ? [] : live.filter((b) => b.role === 'chip_pipe' && b.feed?.chips !== undefined)
      .map((b) => ({ block: b, chips: b.feed!.chips!, targets: inventoriesBeside(b, byPos, linked(b)) })),
    interfaces: layout.mode !== 'ae2' ? [] : live.filter((b) => b.role === 'interface' && b.feed?.interface !== undefined)
      .map((b) => ({ block: b, spec: b.feed!.interface!, targets: inventoriesBeside(b, byPos, () => true) })),
    inputChests: live.filter((b) => b.tail?.side === 'input'),
  };
  const warnings: PlanWarning[] = [];
  for (const n of nodes) {
    const raise: Raise = (code, text, key) => warnings.push({ code, stepId: n.step.id, text, ...(key === undefined ? {} : { key }) });
    slotRules(line, n, layout.mode === 'routed' || layout.mode === 'enderio', raise);
    if (layout.mode === 'routed') routedRules(line, n, raise);
    if (layout.mode === 'ae2') ae2Rules(line, n, raise);
  }
  return warnings;
}
