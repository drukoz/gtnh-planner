// The feeding checker's static rules (plan `docs/superpowers/plans/2026-10-20-21-feeding-checker.md` Task 3, rules R1–R12):
// what a `FeedModel` shows is wrong before a single tick runs — too many kinds for a machine's input slots, Multi Stack
// Input and Limiting mode left to chance, Input Separation with two buses, Project Red chips that move nothing or pull the
// inputs back out, AE2 patterns that cannot be encoded, blocking mode toward a machine it can never push into, a bench
// without its mode's cap, wrongly faced or wrongly connected, a machine shared by two steps, an interface touching two
// inventories. fix/feeding turns each finding into a layout warning with the same `feed_*` code and text.
// - A finding is `certain` (it will happen) or `risk` (it can, under a schedule or a setting the layout does not fix).
// - Findings come ordered by node (the model's local order), then rule (R1 … R12, a rule's parts in the table's order), then
//   item key (code-unit order). Each rule raises a finding once per node and item (and once per bus, interface or side where
//   its text names one): main lays a responder and an extractor on both bus ports of a multiblock, and a machine fed by
//   two pipes must not double. The rule table, not the Codes table (a summary), says which rule raises which code and
//   certainty.
// - R1 applies to a basic node whose slots the slot table or the export gives (`basicSlots`): slots taken from its recipes
//   are no measure of what it has.
// Pure TypeScript: nothing from node:* may be imported here.

import { isFluidKey, type StuffKey } from '../../../shared/keys.ts';
import { fmtInt } from '../../../shared/layout/format.ts';
import type { Pack } from '../../../shared/types/pack.ts';
import type { LogisticsMode } from '../../../shared/types/plan.ts';
import { FEED_KINDS, type ChipKind, type FeedCode, type FeedFinding, type ItemFilterSpec, type RoutedChipSpec } from './contract.ts';
import { basicSlots, ignoredByBlocking, PART_KEYS, stackLimit } from './facts.ts';
import type { Ae2Iface, BasicNode, BenchNode, ChestNode, EioFace, FeedModel, FeedNode, MultiNode, NodeId, RoutedNet, RoutedPipe } from './model.ts';
import { amountText, listText, slotWord } from './text.ts';

// ---- Words and constants ----

/** The modes whose logistics push into a machine whatever it already holds (R2, R11). */
const PUSH_MODES: ReadonlySet<LogisticsMode> = new Set<LogisticsMode>(['direct', 'routed', 'enderio']);

/** A push mode as R11 names it. */
const MODE_NAMES: Readonly<Record<string, string>> = { direct: 'machine-to-machine', routed: 'Project Red', enderio: 'EnderIO' };

const EMPTY_WHITELIST = 'has an empty whitelist (a new chip extracts nothing)';

/** EnderIO's item filters by the item in a conduit side's filter slot (`src/server/layout/parts.ts`; R10a's names). */
const FILTER_NAMES: Readonly<Record<StuffKey, string>> = {
  'EnderIO:itemBasicFilterUpgrade@0': 'Basic Item Filter', 'EnderIO:itemBasicFilterUpgrade@1': 'Advanced Item Filter',
  'EnderIO:itemBigFilterUpgrade@0': 'Big Item Filter', [PART_KEYS.limitedFilter]: 'Limited Item Filter',
};

/** How many input slots a bench's stock may fill: slot 8 must stay empty, or a failed craft throws its stack out (research §1.3.8, §3.6). */
const BENCH_STOCK_SLOTS = 8;

/**
 * For a bench whose front is side `front` (ForgeDirection 2–5), the side on the left of a player who stands in front of it and
 * faces it: a bench facing north has the player look south, with east on the left; facing south, west; west, north; east, south.
 * (The bench's own left, looking out of its front, is the other side.)
 */
const LEFT_OF: Readonly<Record<number, number>> = { 2: 5, 3: 4, 4: 2, 5: 3 };

/** The rules in the order their findings come in a node's list (R10c's parts and the others' in the table's order). */
const RULES = ['R1', 'R2', 'R3', 'R4', 'R5a', 'R5b', 'R5c', 'R5d', 'R6', 'R7', 'R8a', 'R8b', 'R8c', 'R8d', 'R9', 'R10a', 'R10b',
  'R10c-back', 'R10c-power', 'R10c-fluid', 'R10c-tool', 'R10c-pipe', 'R11', 'R12'] as const;
type RuleId = (typeof RULES)[number];

type Certainty = FeedFinding['certainty'];
type MachineNode = BasicNode | MultiNode | BenchNode;

function compareText(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0;
}

/** Each key once, sorted (code-unit order). */
function distinct(keys: Iterable<StuffKey>): StuffKey[] {
  return [...new Set(keys)].sort(compareText);
}

/** An item key's id: the text before its last '@'. */
function itemId(key: StuffKey): string {
  const at = key.lastIndexOf('@');
  return at < 1 ? key : key.slice(0, at);
}

/** A name with its article: "a Basic Item Filter", "an Advanced Item Filter". */
function withArticle(name: string): string {
  return `${/^[AEIOU]/.test(name) ? 'an' : 'a'} ${name}`;
}

/** "1 kind of item", "2 kinds of item". */
function kindsWord(k: number): string {
  return `${k} ${k === 1 ? 'kind' : 'kinds'} of item`;
}

/** An amount within 1e-9 of a whole number counts as whole, as the reader counts it. */
function isWhole(n: number): boolean {
  return Math.abs(n - Math.round(n)) <= 1e-9;
}

// ---- Chips ----

/** A chip's filter; a chip that carries none is a new one: an empty whitelist, a broadcaster's an empty blacklist (research §2.2). */
function filterOf(chip: RoutedChipSpec): ItemFilterSpec {
  return chip.filter ?? { mode: chip.kind === 'broadcaster' ? 'blacklist' : 'whitelist', keys: [] };
}

/** Whether the chip's filter passes `key`. */
function passes(chip: RoutedChipSpec, key: StuffKey): boolean {
  const f = filterOf(chip);
  return f.keys.includes(key) === (f.mode === 'whitelist');
}

function isEmptyWhitelist(chip: RoutedChipSpec): boolean {
  const f = filterOf(chip);
  return f.mode === 'whitelist' && f.keys.length === 0;
}

/** Why none of `chips` passes `key`: all are empty whitelists, one blacklists it, or none lists it. */
function whyNotPassed(chips: readonly RoutedChipSpec[]): string {
  if (chips.every(isEmptyWhitelist)) return EMPTY_WHITELIST;
  return chips.some((chip) => filterOf(chip).mode === 'blacklist') ? 'blacklists it' : 'does not list it';
}

function chipsOf(pipes: readonly RoutedPipe[], kind: ChipKind): RoutedChipSpec[] {
  return pipes.flatMap((p) => p.chips.filter((chip) => chip.kind === kind));
}

/** Whether `chip`, on pipe `pipe`, takes `key` away from the machine `maker` (R6): an answer to a request for it, or a stock of it. */
function takesFrom(chip: RoutedChipSpec, pipe: RoutedPipe, key: StuffKey, maker: NodeId): boolean {
  if (pipe.target === null) return false;
  switch (chip.kind) {
    case 'responder':
    case 'terminator': return pipe.target.node !== maker && passes(chip, key);
    case 'overflow': return pipe.target.node !== maker;
    case 'stock_keeper': return chip.stock?.some((s) => s.key === key) === true;
    default: return false;
  }
}

// ---- The context the rules share ----

interface Pending { at: number; rule: number; key: string; seq: number; finding: FeedFinding }

interface Ctx {
  readonly model: FeedModel; readonly pack: Pack;
  /** Machine nodes (basic, multiblock, bench) and chests, in the model's local order. */
  readonly machines: readonly MachineNode[]; readonly chests: readonly ChestNode[];
  readonly nodeById: ReadonlyMap<NodeId, FeedNode>;
  /** Routed pipes by the inventory they touch: `${node}\n${bus}` (no bus: the node's own). */
  readonly pipes: ReadonlyMap<string, readonly RoutedPipe[]>;
  readonly routedNets: readonly RoutedNet[];
  /** EnderIO faces by the node they touch. */
  readonly faces: ReadonlyMap<NodeId, readonly EioFace[]>;
  /** Every AE2 interface in net order, and by the node each pushes into. */
  readonly ifaces: readonly Ae2Iface[]; readonly ifacesAt: ReadonlyMap<NodeId, readonly Ae2Iface[]>;
  readonly at: ReadonlyMap<NodeId, number>;
  readonly found: Pending[]; readonly seen: Set<string>;
  nameOf(key: StuffKey): string;
}

function pushTo<K, V>(map: Map<K, V[]>, key: K, value: V): void {
  const list = map.get(key);
  if (list === undefined) map.set(key, [value]);
  else list.push(value);
}

function context(model: FeedModel, pack: Pack): Ctx {
  const pipes = new Map<string, RoutedPipe[]>();
  const faces = new Map<NodeId, EioFace[]>();
  const ifaces: Ae2Iface[] = [];
  const ifacesAt = new Map<NodeId, Ae2Iface[]>();
  const routedNets: RoutedNet[] = [];
  for (const net of model.networks) {
    switch (net.kind) {
      case 'routed':
        routedNets.push(net);
        for (const p of net.pipes) if (p.target !== null) pushTo(pipes, `${p.target.node}\n${p.target.bus ?? ''}`, p);
        break;
      case 'enderio':
        for (const f of net.faces) if (f.target !== null) pushTo(faces, f.target.node, f);
        break;
      case 'ae2':
        for (const iface of net.interfaces) {
          ifaces.push(iface);
          for (const id of new Set(iface.targets.map((t) => t.node))) pushTo(ifacesAt, id, iface);
        }
        break;
      default: break;
    }
  }
  return {
    model, pack,
    machines: model.nodes.filter((n): n is MachineNode => n.kind !== 'chest'), chests: model.nodes.filter((n): n is ChestNode => n.kind === 'chest'),
    nodeById: new Map(model.nodes.map((n) => [n.id, n])), at: new Map(model.nodes.map((n, i) => [n.id, i])),
    pipes, routedNets, faces, ifaces, ifacesAt, found: [], seen: new Set(), nameOf: (key) => model.nameOf(key),
  };
}

/**
 * Records a finding on `node`. A rule raises one finding per node and `key`, and one per `more.id` where its text names a bus,
 * an interface or a side; a second with the same rule, node, key and id is dropped.
 */
function emit(c: Ctx, node: FeedNode, rule: RuleId, code: FeedCode, certainty: Certainty, text: string,
  more: { key?: StuffKey; stepId?: string; id?: string } = {}): void {
  const once = `${rule}\n${node.id}\n${more.key ?? ''}\n${more.id ?? ''}`;
  if (c.seen.has(once)) return;
  c.seen.add(once);
  const stepId = more.stepId ?? ('stepIds' in node ? node.stepIds[0] : undefined);
  const finding: FeedFinding = {
    code, kind: FEED_KINDS[code], phase: 'static', certainty, ...(stepId === undefined ? {} : { stepId }),
    machine: node.label, pos: [node.pos[0], node.pos[1], node.pos[2]], ...(more.key === undefined ? {} : { key: more.key }), text,
  };
  c.found.push({ at: c.at.get(node.id) ?? 0, rule: RULES.indexOf(rule), key: more.key ?? '', seq: c.found.length, finding });
}

/** The routed pipes whose chips act on a basic machine's or a bench's own inventory, or on a multiblock's output (`'out'`) or input (`'in'`) buses. */
function pipesOf(c: Ctx, node: MachineNode, side: 'own' | 'out' | 'in' = 'own'): readonly RoutedPipe[] {
  if (node.kind !== 'multi') return side === 'own' ? c.pipes.get(`${node.id}\n`) ?? [] : [];
  const buses = side === 'out' ? node.outBuses : side === 'in' ? node.inBuses : [];
  return buses.flatMap((b) => c.pipes.get(`${node.id}\n${b.id}`) ?? []);
}

/** The distinct item keys a machine node's recipes make. */
function madeKeys(node: MachineNode): StuffKey[] {
  return distinct(node.recipes.flatMap((r) => r.outputs.map((o) => o.key)));
}

/** The distinct item keys that sit in a machine node's input slots: what its recipes consume and what they hold. */
function takenKeys(node: MachineNode): StuffKey[] {
  return distinct(node.recipes.flatMap((r) => [...r.inputs.map((i) => i.key), ...r.held]));
}

/** The first step of `node` whose recipe makes `key` (`outputs`) or has it in an input slot (`inputs`). */
function stepWith(node: MachineNode, key: StuffKey, side: 'outputs' | 'inputs'): string | undefined {
  const recipe = node.recipes.find((r) => (side === 'outputs' ? r.outputs.some((o) => o.key === key) : r.inputs.some((i) => i.key === key) || r.held.includes(key)));
  return recipe?.stepId;
}

/**
 * What a text calls a step: its main output's name. `model.stepName` falls back to the machine's name when the plan names no
 * main output, which a step without a machine hardly has: then the first item the step makes names it.
 */
function stepLabel(model: FeedModel, stepId: string): string {
  const made = model.made[stepId] ?? [];
  const name = model.stepName(stepId);
  return made.length === 0 || made.some((k) => model.nameOf(k) === name) ? name : model.nameOf(made[0]!);
}

// ---- R1–R4: slots, Multi Stack Input, Limiting mode, Input Separation ----

/**
 * R1, `feed_crowded` certain: a basic machine takes more kinds of item in one recipe (k, the most any recipe consumes) than it has input
 * slots left after the items it holds (h, the most any recipe holds: a mold or a lens stays in its slot whichever recipe runs), so one
 * kind always waits.
 */
function r1(c: Ctx): void {
  for (const node of c.machines) {
    if (node.kind !== 'basic') continue;
    const machine = c.pack.machines.get(node.mteId);
    if (machine === undefined || basicSlots(machine) === null) continue;
    let kinds = 0;
    let held: readonly StuffKey[] = [];
    for (const recipe of node.recipes) {
      kinds = Math.max(kinds, new Set(recipe.inputs.map((i) => i.key)).size);
      if (recipe.held.length > held.length) held = recipe.held;
    }
    if (kinds <= node.inSlots - held.length) continue;
    emit(c, node, 'R1', 'feed_crowded', 'certain',
      `${node.label} takes ${kindsWord(kinds)} but has ${slotWord(Math.max(0, node.inSlots - held.length))} free`
      + `${held.length > 0 ? ` (${held.length} held: ${listText([...new Set(held)].map((k) => c.nameOf(k)))})` : ''}: one kind always waits`);
  }
}

/**
 * R2, `feed_crowded`: a basic machine in a push mode that takes two or more kinds of item and whose Multi Stack Input is not
 * set Off. With it On the first kind to arrive fills every free input slot: certain when the layout sets it On, a risk when it
 * leaves it to its placer's preference.
 */
function r2(c: Ctx): void {
  if (!PUSH_MODES.has(c.model.mode)) return;
  for (const node of c.machines) {
    if (node.kind !== 'basic' || node.kinds.length < 2 || node.settings.multiStack === false) continue;
    if (node.settings.multiStack === true) {
      emit(c, node, 'R2', 'feed_crowded', 'certain',
        `${node.label} has Multi Stack Input On and takes ${kindsWord(node.kinds.length)}: the first kind to arrive fills every free input slot`);
    } else {
      emit(c, node, 'R2', 'feed_crowded', 'risk',
        `${node.label} takes ${kindsWord(node.kinds.length)} and the layout does not set Multi Stack Input Off: with it On, the first kind to arrive fills every free input slot`);
    }
  }
}

/** R3, `feed_overfill` risk: an input bus whose controller takes two or more kinds of item, without Limiting mode, can be filled by one kind. */
function r3(c: Ctx): void {
  for (const node of c.machines) {
    if (node.kind !== 'multi' || node.kinds.length < 2) continue;
    for (const bus of node.inBuses) {
      if (bus.limited === true) continue;
      emit(c, node, 'R3', 'feed_overfill', 'risk',
        `${bus.label} of ${node.label} takes ${kindsWord(node.kinds.length)} without Limiting mode: one kind can fill every slot of the bus`, { id: bus.id });
    }
  }
}

/** R4, `feed_crowded` risk: a multiblock with two or more input buses and Input Separation on checks each bus alone. */
function r4(c: Ctx): void {
  for (const node of c.machines) {
    if (node.kind !== 'multi' || node.inBuses.length < 2 || !(node.inputSeparation ?? node.separationDefault)) continue;
    emit(c, node, 'R4', 'feed_crowded', 'risk',
      `${node.label} has ${node.inBuses.length} input buses with Input Separation on: each bus is checked alone, so a recipe whose items arrive on different buses never starts`);
  }
}

// ---- R5–R7: Project Red chips ----

/**
 * R5a, `feed_no_route` certain: a machine's Item Extractor Chips do not pass an item it makes, so nothing takes it out. A
 * multiblock's outputs leave through its output buses, so only the chips on their pipes count (an Item Extractor Chip on an
 * input bus's pipe is R5c's). A machine with no
 * extractor chip at all has none to blame: the simulation reports its blocked output. Nor is the extractor why an item stays
 * when an Item Broadcaster Chip beside it passes the item and an Item Stock Keeper Chip on its network keeps it: the
 * broadcaster sends it on the stock keeper's orders (research §2.2), as main lays a supplier of an Auto Workbench.
 */
function r5a(c: Ctx): void {
  for (const node of c.machines) {
    const pipes = node.kind === 'multi' ? pipesOf(c, node, 'out') : pipesOf(c, node);
    const extractors = chipsOf(pipes, 'extractor');
    if (extractors.length === 0) continue;
    const broadcasters = chipsOf(pipes, 'broadcaster');
    for (const key of madeKeys(node)) {
      if (extractors.some((chip) => passes(chip, key))) continue;
      if (broadcasters.some((chip) => passes(chip, key)) && stockedOn(c, node, key)) continue;
      emit(c, node, 'R5a', 'feed_no_route', 'certain', `Nothing takes ${c.nameOf(key)} out of ${node.label}: its Item Extractor Chip ${whyNotPassed(extractors)}`,
        { key, stepId: stepWith(node, key, 'outputs') });
    }
  }
}

/**
 * R5b, `feed_starved` risk: an Item Extractor Chip that passes an item its machine holds in an input slot. GT lets no input out,
 * so each time the chip tries it first, the extraction fails and the chip gives up the whole update (research §2.2).
 */
function r5b(c: Ctx): void {
  for (const node of c.machines) {
    if (node.kind === 'multi') continue;
    const extractors = chipsOf(pipesOf(c, node), 'extractor');
    for (const key of takenKeys(node)) {
      if (!extractors.some((chip) => passes(chip, key))) continue;
      emit(c, node, 'R5b', 'feed_starved', 'risk',
        `The Item Extractor Chip on ${node.label} also lists ${c.nameOf(key)}, which it cannot take back out: each time it tries it first, it gives up the whole update`,
        { key, stepId: stepWith(node, key, 'inputs') });
    }
  }
}

/** R5c, `feed_churn` certain: an Item Extractor Chip on an input bus's pipe takes the inputs back out of the bus (an input bus lets items out). */
function r5c(c: Ctx): void {
  for (const node of c.machines) {
    if (node.kind !== 'multi') continue;
    for (const bus of node.inBuses) {
      if (chipsOf(c.pipes.get(`${node.id}\n${bus.id}`) ?? [], 'extractor').length === 0) continue;
      emit(c, node, 'R5c', 'feed_churn', 'certain', `The Item Extractor Chip on ${bus.label} pulls ${node.label}'s inputs back out of its input bus`, { id: bus.id });
    }
  }
}

/**
 * R5d, `feed_starved` certain: a supply item that an input chest stocks, which none of the chips on that chest's pipes lets out,
 * never reaches the machines that take it. An Item Extractor Chip lets it out when its filter passes it; so does an Item
 * Broadcaster Chip whose filter passes it when an Item Stock Keeper Chip on the chest's network keeps it, as the broadcaster
 * sends it on the stock keeper's orders (research §2.2): main lays what only Auto Workbenches take that way, beside the
 * extractor of the other supply items, as R5a reads a supplier's broadcaster. Only when neither lets it out is the
 * extractor to blame; a chest without an extractor chip is left out, as the text names the chip.
 */
function r5d(c: Ctx): void {
  const stuck = new Map<StuffKey, string>();
  for (const key of c.model.supply) {
    const stocking = c.chests.filter((chest) => chest.side === 'input' && chest.keys.includes(key));
    const chips = stocking.map((chest) => {
      const pipes = c.pipes.get(`${chest.id}\n`) ?? [];
      return { chest, extractors: chipsOf(pipes, 'extractor'), broadcasters: chipsOf(pipes, 'broadcaster') };
    });
    if (chips.some(({ extractors }) => extractors.some((chip) => passes(chip, key)))) continue;
    if (chips.some(({ chest, broadcasters }) => broadcasters.some((chip) => passes(chip, key)) && stockedOn(c, chest, key))) continue;
    const blamed = chips.find(({ extractors }) => extractors.length > 0);
    if (blamed !== undefined) stuck.set(key, `the Item Extractor Chip on ${blamed.chest.label} ${whyNotPassed(blamed.extractors)}`);
  }
  if (stuck.size === 0) return;
  for (const node of c.machines) {
    for (const key of node.kinds) {
      const why = stuck.get(key);
      if (why === undefined) continue;
      emit(c, node, 'R5d', 'feed_starved', 'certain', `${node.label} never gets ${c.nameOf(key)}: ${why}`, { key, stepId: stepWith(node, key, 'inputs') });
    }
  }
}

/** The routed networks `node` (a machine or a chest) is on: those with a pipe that touches it, else all of them. */
function netsOf(c: Ctx, node: FeedNode): readonly RoutedNet[] {
  const own = c.routedNets.filter((net) => net.pipes.some((p) => p.target?.node === node.id));
  return own.length > 0 ? own : c.routedNets;
}

/** Whether an Item Stock Keeper Chip on a routed network `node` is on keeps `key`: it orders it from the network's broadcasters. */
function stockedOn(c: Ctx, node: FeedNode, key: StuffKey): boolean {
  return netsOf(c, node).some((net) => net.pipes.some((pipe) => pipe.chips.some((chip) => chip.kind === 'stock_keeper' && chip.stock?.some((s) => s.key === key) === true)));
}

/**
 * R6, `feed_no_route` certain: an item a laid step makes, with a flow out of it, which no Item Responder, Item Terminator or Item
 * Overflow Responder Chip of the network answers for (one on another machine's pipe) and no Item Stock Keeper Chip keeps.
 */
function r6(c: Ctx): void {
  const { model } = c;
  for (const node of c.machines) {
    const nets = netsOf(c, node);
    for (const recipe of node.recipes) {
      for (const key of distinct(recipe.outputs.map((o) => o.key))) {
        const flows = model.itemFlows.filter((f) => f.from === recipe.stepId && f.key === key);
        if (flows.length === 0) continue;
        if (nets.some((net) => net.pipes.some((pipe) => pipe.chips.some((chip) => takesFrom(chip, pipe, key, node.id))))) continue;
        const unlaid = [...new Set(flows.map((f) => f.to))].filter((to) => Object.hasOwn(model.made, to) && !model.laid.includes(to));
        const names = listText(unlaid.map((to) => stepLabel(model, to)));
        const where = unlaid.length === 0 ? '' : ` (it goes to ${names}, which ${unlaid.length === 1 ? 'has' : 'have'} no machine)`;
        emit(c, node, 'R6', 'feed_no_route', 'certain',
          `Nothing on the routed network takes ${c.nameOf(key)} from ${node.label}: no Item Responder Chip lists it${where}`, { key, stepId: recipe.stepId });
      }
    }
  }
}

/**
 * R7, `feed_starved` risk: an Item Broadcaster Chip that offers an item its machine holds in an input slot (a new chip is a blacklist
 * that offers everything): an order for it fails to extract and is dropped (research §2.2).
 */
function r7(c: Ctx): void {
  for (const node of c.machines) {
    if (node.kind === 'multi') continue;
    const taken = takenKeys(node);
    if (!chipsOf(pipesOf(c, node), 'broadcaster').some((chip) => taken.some((key) => passes(chip, key)))) continue;
    emit(c, node, 'R7', 'feed_starved', 'risk', `The Item Broadcaster Chip on ${node.label} offers its inputs too: an order for one of them fails and is dropped`);
  }
}

// ---- R8, R9, R11, R12: AE2 ----

/** The machines (not chests) an interface pushes into, each once, in target order. */
function ifaceMachines(c: Ctx, iface: Ae2Iface): MachineNode[] {
  const nodes: MachineNode[] = [];
  for (const t of iface.targets) {
    const node = c.nodeById.get(t.node);
    if (node !== undefined && node.kind !== 'chest' && !nodes.includes(node)) nodes.push(node);
  }
  return nodes;
}

/**
 * R8, the patterns of an interface, for each machine it pushes into: a fluid (a), an amount that is not whole (b), or a held item or a
 * programmed circuit (c) makes the pattern unencodable, and a fluid in a plain interface's pattern becomes a Fluid Packet item (d).
 */
function r8(c: Ctx): void {
  for (const iface of c.ifaces) {
    for (const node of ifaceMachines(c, iface)) {
      const held = new Set(node.recipes.flatMap((r) => r.held));
      iface.spec.patterns.forEach((pattern, k) => {
        const stepId = node.stepIds[k] ?? node.stepIds[0];
        for (const [side, list] of [['in', pattern.inputs], ['out', pattern.outputs]] as const) {
          for (const { key, amount } of list) {
            const name = c.nameOf(key);
            if (isFluidKey(key)) {
              emit(c, node, 'R8a', 'feed_pattern_unencodable', 'certain', side === 'in'
                ? `The pattern for ${node.label} lists ${name}, a fluid the line pipes: ME never holds it, so AE2 cannot plan with it`
                : `The pattern for ${node.label} makes ${name}, which the line pipes away: it never comes back to ME`, { key, stepId, id: side });
              if (side === 'in' && iface.spec.dual !== true) {
                emit(c, node, 'R8d', 'feed_fluid_packet', 'risk',
                  `${iface.label} turns ${name} into a Fluid Packet item, which ${node.label} can take into an input slot for good`, { key, stepId, id: iface.id });
              }
              continue;
            }
            if (!isWhole(amount)) {
              emit(c, node, 'R8b', 'feed_pattern_unencodable', 'certain',
                `The pattern for ${node.label} holds ${amountText(amount)}× ${name}: a pattern holds whole items`, { key, stepId });
            }
            if (side === 'in' && (held.has(key) || itemId(key) === PART_KEYS.circuitId)) {
              emit(c, node, 'R8c', 'feed_pattern_unencodable', 'certain',
                `The pattern for ${node.label} lists ${name}, which ${node.label} keeps and does not use up`, { key, stepId });
            }
          }
        }
      });
    }
  }
}

/**
 * R9, `feed_starved` certain: an interface with blocking mode on never pushes into a basic machine that holds an item AE2's blocking
 * mode does not ignore, nor into a bench, whose crafting grid counts as items (research §1.3.6, §2.3).
 */
function r9(c: Ctx): void {
  for (const iface of c.ifaces) {
    if (iface.spec.blocking !== true) continue;
    for (const node of ifaceMachines(c, iface)) {
      if (node.kind === 'bench') {
        emit(c, node, 'R9', 'feed_starved', 'certain',
          `${iface.label} has blocking mode on and ${node.label}'s crafting grid counts as items: it never pushes into it`, { id: iface.id });
      } else if (node.kind === 'basic') {
        for (const key of distinct(node.recipes.flatMap((r) => r.held))) {
          if (ignoredByBlocking(c.pack, key)) continue;
          emit(c, node, 'R9', 'feed_starved', 'certain',
            `${iface.label} has blocking mode on and ${node.label} holds ${c.nameOf(key)}, which blocking mode does not ignore: it never pushes into it`,
            { key, stepId: stepWith(node, key, 'inputs'), id: iface.id });
        }
      }
    }
  }
}

/**
 * R11, `feed_pool_starve`: a node of two or more steps. In a push mode it reruns its last recipe while that recipe's output waits, so
 * the others can starve (certain). In AE2 an interface toward it with blocking off mixes the recipes' sets (a risk), when it holds a
 * pattern at all.
 */
function r11(c: Ctx): void {
  const { model } = c;
  for (const node of c.machines) {
    if (node.stepIds.length < 2) continue;
    if (PUSH_MODES.has(model.mode)) {
      emit(c, node, 'R11', 'feed_pool_starve', 'certain',
        `${node.label} runs ${node.stepIds.length} recipes in ${MODE_NAMES[model.mode] ?? model.mode}: it reruns its last recipe while that recipe's output waits, `
        + `so ${listText(node.stepIds.slice(1).map((id) => stepLabel(model, id)))} can starve`);
    } else if (model.mode === 'ae2') {
      for (const iface of c.ifacesAt.get(node.id) ?? []) {
        // an interface that holds no pattern is never pushed into: it mixes nothing (main lays one on a second input bus)
        if (iface.spec.blocking === true || iface.spec.patterns.length === 0) continue;
        emit(c, node, 'R11', 'feed_pool_starve', 'risk',
          `${node.label} runs ${node.stepIds.length} recipes and ${iface.label} has blocking mode off: it mixes the recipes' sets`, { id: iface.id });
      }
    }
  }
}

/** R12, `feed_leak` risk: an interface that pushes into two or more inventories can put its pattern's items into the wrong one. */
function r12(c: Ctx): void {
  for (const iface of c.ifaces) {
    if (iface.targets.length < 2) continue;
    const owner = ifaceMachines(c, iface)[0] ?? c.nodeById.get(iface.targets[0]!.node);
    if (owner === undefined) continue;
    const names = iface.targets.map((t) => {
      const node = c.nodeById.get(t.node);
      if (node === undefined) return t.node;
      return node.kind === 'multi' && t.bus !== undefined ? [...node.inBuses, ...node.outBuses].find((b) => b.id === t.bus)?.label ?? node.label : node.label;
    });
    emit(c, owner, 'R12', 'feed_leak', 'risk',
      `${iface.label} pushes into ${iface.targets.length} inventories (${listText(names)}): its pattern's items can reach the wrong one`, { id: iface.id });
  }
}

// ---- R10: the Auto Workbench ----

/** How many grid cells hold each item: the items a craft takes. */
function gridCells(bench: BenchNode): Map<StuffKey, number> {
  const cells = new Map<StuffKey, number>();
  for (const key of bench.grid) if (key !== null) cells.set(key, (cells.get(key) ?? 0) + 1);
  return cells;
}

/** The name of a conduit side's filter for R10a: a known EnderIO filter, else the item's name, else "face with no item filter". */
function filterName(c: Ctx, filter: { item?: StuffKey } | null): string {
  if (filter?.item === undefined) return 'face with no item filter';
  return Object.hasOwn(FILTER_NAMES, filter.item) ? FILTER_NAMES[filter.item]! : c.nameOf(filter.item);
}

/**
 * The bench's stock of each grid item as its mode's part sets it (research §3.6): EnderIO, the Limited Item Filter's count minus the
 * item's grid cells (the ghost grid counts in the target); routed, the Item Stock Keeper Chip's count. Several parts: the largest.
 */
function benchStock(c: Ctx, bench: BenchNode, cells: ReadonlyMap<StuffKey, number>): Map<StuffKey, number> {
  const stock = new Map<StuffKey, number>();
  const keep = (key: StuffKey, s: number): void => {
    if (s > (stock.get(key) ?? -1)) stock.set(key, s);
  };
  if (c.model.mode === 'enderio') {
    for (const face of c.faces.get(bench.id) ?? []) {
      const filter = face.insert?.filter;
      if (filter?.item !== PART_KEYS.limitedFilter || filter.limits === undefined) continue;
      // `limits[i]` is the count of the slot that holds `keys[i]`: an item in several slots counts their sum
      const limits = new Map<StuffKey, number>();
      for (let i = 0; i < filter.keys.length; i++) {
        const key = filter.keys[i]!;
        limits.set(key, (limits.get(key) ?? 0) + (filter.limits[i] ?? 0));
      }
      for (const [key, limit] of limits) keep(key, Math.max(0, limit - (cells.get(key) ?? 0)));
    }
  } else if (c.model.mode === 'routed') {
    for (const chip of chipsOf(pipesOf(c, bench), 'stock_keeper')) for (const s of chip.stock ?? []) keep(s.key, s.count);
  }
  return stock;
}

/**
 * R10a, `feed_overfill`: the bench's insert side is not capped for its mode. EnderIO: a face without a Limited Item Filter that has
 * counts lets one ingredient fill all nine input slots (certain); a Limited filter that lacks a grid item caps the others and keeps that
 * one out, a starved input for the simulation, not an overfill. Routed: an Item Responder Chip answers with the room of all nine
 * (certain); a bench with no Stock Keeper and no responder is fed by nothing, which the simulation reports. AE2: an interface without a
 * Locking Card on "Until crafting result is returned" pushes the whole job in (a risk).
 */
function r10a(c: Ctx, bench: BenchNode): void {
  switch (c.model.mode) {
    case 'enderio': {
      const uncapped = (f: EioFace): boolean => f.insert !== undefined && (f.insert.filter?.item !== PART_KEYS.limitedFilter || f.insert.filter.limits === undefined);
      const open = (c.faces.get(bench.id) ?? []).find(uncapped);
      if (open?.insert === undefined) return;
      emit(c, bench, 'R10a', 'feed_overfill', 'certain',
        `${bench.label} takes its ingredients through ${withArticle(filterName(c, open.insert.filter))}, `
        + 'which does not cap amounts: one ingredient can fill all nine input slots');
      return;
    }
    case 'routed':
      if (chipsOf(pipesOf(c, bench), 'responder').length > 0) {
        emit(c, bench, 'R10a', 'feed_overfill', 'certain', `${bench.label} is fed by an Item Responder Chip, which answers with the room of all nine input slots`);
      }
      return;
    case 'ae2':
      for (const iface of c.ifacesAt.get(bench.id) ?? []) {
        if (iface.spec.lock === 'until_result') continue;
        emit(c, bench, 'R10a', 'feed_overfill', 'risk',
          `${iface.label} has no Locking Card: a pattern that differs from ${bench.label}'s grid pushes the whole job into it`, { id: iface.id });
      }
      return;
    default: return;
  }
}

/**
 * R10b, `feed_overfill` risk: a stock out of research §3.6's bounds. For each grid item the bench's part gives a stock s of, with a
 * craft taking a of it: s < a (less than one craft), s above a stack, and Σ ⌈s / stack⌉ over the items above 8 input slots (slot 8
 * must stay empty, or a failed craft throws out its last input slot).
 */
function r10b(c: Ctx, bench: BenchNode): void {
  const cells = gridCells(bench);
  const stock = benchStock(c, bench, cells);
  let slots = 0;
  const wording: Array<{ key: StuffKey; s: number; a: number; total: number }> = [];
  for (const key of [...stock.keys()].filter((k) => cells.has(k)).sort(compareText)) {
    const s = stock.get(key)!;
    const a = cells.get(key)!;
    slots += Math.ceil(s / stackLimit(key));
    wording.push({ key, s, a, total: slots });
    const keeps = `${bench.label} keeps ${fmtInt(s)}× ${c.nameOf(key)} for ${fmtInt(a)} a craft`;
    if (s < a) emit(c, bench, 'R10b', 'feed_overfill', 'risk', `${keeps}: less than one craft`, { key, id: 'low' });
    else if (s > stackLimit(key)) emit(c, bench, 'R10b', 'feed_overfill', 'risk', `${keeps}: more than a stack`, { key, id: 'high' });
  }
  if (slots <= BENCH_STOCK_SLOTS) return;
  // the item whose stock takes the stock past 8 slots
  const tip = wording.find((w) => w.total > BENCH_STOCK_SLOTS)!;
  emit(c, bench, 'R10b', 'feed_overfill', 'risk',
    `${bench.label} keeps ${fmtInt(tip.s)}× ${c.nameOf(tip.key)} for ${fmtInt(tip.a)} a craft: its stock needs ${fmtInt(slots)} input slots, more than 8, `
    + 'so a failed craft throws out its last input slot', { key: tip.key, id: 'slots' });
}

/** The sides of `nodeId` (its own, ForgeDirection 0–5) that any network member touches: a conduit face, a routed pipe, an interface, an export bus, a GT pipe. */
function touchedSides(c: Ctx, nodeId: NodeId): Set<number> {
  const sides = new Set<number>();
  const add = (t: { node: NodeId; side: number } | null): void => {
    if (t !== null && t.node === nodeId) sides.add(t.side);
  };
  for (const net of c.model.networks) {
    switch (net.kind) {
      case 'routed': for (const p of net.pipes) add(p.target); break;
      case 'enderio': for (const f of net.faces) add(f.target); break;
      case 'ae2':
        for (const i of net.interfaces) for (const t of i.targets) add(t);
        for (const b of net.exportBuses) add(b.target);
        break;
      case 'gtpipe': for (const p of net.pipes) for (const s of p.sides) add(s.target); break;
    }
  }
  return sides;
}

/**
 * A side of a bench as a player who faces its front sees it, whatever way the line is turned: front, back, top, bottom, and
 * the left and right sides as they are on that player's left and right (the words say so, as the bench's own left is the
 * player's right). Without a front along the ground, a side is just a side.
 */
function benchSide(bench: BenchNode, side: number): string {
  if (side === 1) return 'top';
  if (side === 0) return 'bottom';
  if (bench.front < 2) return 'side';
  if (side === bench.front) return 'front';
  if (side === bench.back) return 'back';
  return `${side === LEFT_OF[bench.front] ? 'left' : 'right'} side as you face its front`;
}

/**
 * R10c, a bench's faces and grid: its back touches none of the line's logistics (`feed_bench_stuck` certain); its only connected power
 * cable is on its back, which takes no EU (`feed_starved` certain); a fluid pipe or conduit touches it (`feed_overfill` risk); its grid
 * holds a GT tool (`feed_bench_stuck` certain); a GT item pipe touches it (`feed_overfill` certain).
 */
function r10c(c: Ctx, bench: BenchNode): void {
  const { back } = bench;
  if (back !== -1 && !touchedSides(c, bench.id).has(back)) {
    emit(c, bench, 'R10c-back', 'feed_bench_stuck', 'certain', `${bench.label}'s back, where it puts out its result, does not touch the line's logistics`);
  }
  if (back !== -1 && bench.powerSides.length === 1 && bench.powerSides[0] === back) {
    emit(c, bench, 'R10c-power', 'feed_starved', 'certain', `${bench.label}'s only power cable touches its back, which takes no EU`);
  }
  for (const side of bench.fluidSides) {
    emit(c, bench, 'R10c-fluid', 'feed_overfill', 'risk',
      `${bench.label} has a fluid ${c.model.mode === 'enderio' ? 'conduit' : 'pipe'} on its ${benchSide(bench, side)}: its tank takes any fluid and fills containers into its input slots`,
      { id: String(side) });
  }
  for (const key of distinct(bench.grid.filter((k): k is StuffKey => k !== null && itemId(k) === PART_KEYS.gtToolId))) {
    emit(c, bench, 'R10c-tool', 'feed_bench_stuck', 'certain',
      `${bench.label}'s grid holds ${c.nameOf(key)}: a GT tool wears with each craft and stops matching the grid after one (use a single-use tool)`, { key });
  }
  if (bench.itemPipeSides.length > 0) {
    emit(c, bench, 'R10c-pipe', 'feed_overfill', 'certain', `A GT item pipe touches ${bench.label}: it fills all nine input slots with whatever it carries`);
  }
}

// ---- precheckFeeding ----

/**
 * The static findings on `model`, every one `phase: 'static'` with the `kind` of its code, `machine` the node's label and `pos` its world
 * cell, ordered by node, then rule, then item key. See the header for what each rule finds.
 */
export function precheckFeeding(model: FeedModel, pack: Pack): FeedFinding[] {
  const c = context(model, pack);
  r1(c); r2(c); r3(c); r4(c);
  if (model.mode === 'routed') { r5a(c); r5b(c); r5c(c); r5d(c); r6(c); r7(c); }
  if (model.mode === 'ae2') { r8(c); r9(c); }
  for (const node of c.machines) if (node.kind === 'bench') { r10a(c, node); r10b(c, node); r10c(c, node); }
  r11(c);
  if (model.mode === 'ae2') r12(c);
  return c.found
    .sort((a, b) => a.at - b.at || a.rule - b.rule || compareText(a.key, b.key) || a.seq - b.seq)
    .map((p) => p.finding);
}
