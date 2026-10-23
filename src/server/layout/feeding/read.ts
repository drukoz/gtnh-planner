// `readLine` (plan `docs/superpowers/plans/2026-10-20-21-feeding-checker.md` Task 2): a laid-out line, its plan and its
// pack as the feeding checker's model — machines (GT basic and steam machines, multiblocks with their buses, Auto
// Workbenches), tail chests, each machine's recipes, slots, faces and settings, what comes into the line and what
// leaves it, the plan's rates per machine, one network model per network the line lays (read-networks.ts) and its GT
// covers. It reads the structured config where a block has it (`LayoutBlock.feed` and the flat `config` settings, which
// main's lines carry since fix/feeding, architecture §11 entry 51) and the text of older layouts and the plan
// otherwise, and lists what it could not know as unknowns, at most once per code and block. Everything is in the line's
// local frame (frame.ts): the same line reads the same in every rotation and wherever it was dragged (Review Focus 1);
// a block the plan has no step for is skipped (Review Focus 2); a machine without slot data takes its slots from its
// recipes (Review Focus 3).
// Pure TypeScript: nothing from node:* may be imported here, and from the server only what the plan's Global
// Constraints allow (`stepItemInputs`, `stepItemOutputs`, `stepDepths`, `busSlots`, `manualReasonOf`).

import { isFluidKey, type StuffKey } from '../../../shared/keys.ts';
import { joinNames } from '../../../shared/layout/format.ts';
import { manhattan, OPPOSITE, step, type Vec3 } from '../../../shared/layout/geometry.ts';
import { FACES, type Face } from '../../../shared/types/assets.ts';
import type { Layout } from '../../../shared/types/layout.ts';
import type { Machine, Pack } from '../../../shared/types/pack.ts';
import type { Plan, PlanStep } from '../../../shared/types/plan.ts';
import { stepDepths } from '../arrange.ts';
import { stepItemInputs, stepItemOutputs } from '../modes/mode.ts';
import { manualReasonOf } from '../multiblock-rules.ts';
import { busSlots } from '../parts.ts';
import { CONFIG_KEYS, type FeedBlock, type FeedUnknown } from './contract.ts';
import { basicSlots, BENCH_CLASS, ignoredByBlocking, INPUT_SEPARATION_DEFAULT, PART_KEYS } from './facts.ts';
import { compareLocal, fromWorld, localConnections, localSide, nodeId } from './frame.ts';
import type {
  BasicNode, BenchNode, BusNode, ChestNode, FeedModel, FeedNetwork, FeedNode, InvRef, MachineSettings, MultiNode, NodeId, OutBusNode, SimRecipe,
} from './model.ts';
import { readAe2, readCovers, readEnderio, readGtPipes, readRouted, type Cell, type ReadContext } from './read-networks.ts';

// ---- Small helpers ----

const SIDES: readonly number[] = [0, 1, 2, 3, 4, 5];
const INPUT_BUS_CLASS = 'MTEHatchInputBus', OUTPUT_BUS_CLASS = 'MTEHatchOutputBus';
const GRID_CELLS = 9, GRID_WIDTH = 3;

function compareText(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0;
}

/** Each key once, sorted (code-unit order). */
function distinct(keys: Iterable<StuffKey>): StuffKey[] {
  return [...new Set(keys)].sort(compareText);
}

/** "x y z" of a world cell, as labels write it. */
function where(p: Vec3): string {
  return `${p[0]} ${p[1]} ${p[2]}`;
}

/**
 * A class's simple name, the text after its last '.' (architecture entry 19), computed here: the module imports from the server
 * only what the plan's Global Constraints allow, and `simpleClassName` (`src/server/world/facts.ts`) is not among it.
 */
function simpleName(cls: string): string {
  return cls.slice(cls.lastIndexOf('.') + 1);
}

/** An item key's id: the text before its last '@'. */
function itemId(key: StuffKey): string {
  const at = key.lastIndexOf('@');
  return at < 1 ? key : key.slice(0, at);
}

/** `n` within 1e-9 of a whole number taken as that number, as main writes amounts. */
function tidy(n: number): number {
  return Math.round(n * 1e9) / 1e9;
}

/** A whole number with thousands separators, anything else with up to two decimals. */
function amountWords(n: number): string {
  return Number.isInteger(n) ? n.toLocaleString('en-US') : n.toLocaleString('en-US', { maximumFractionDigits: 2 });
}

/** "1 input slot", "3 output slots". */
function slotCount(n: number, word: string): string {
  return `${n} ${word} ${n === 1 ? 'slot' : 'slots'}`;
}

function isSide(n: number | undefined): n is number {
  return n !== undefined && Number.isInteger(n) && n >= 0 && n <= 5;
}

/** A `config` setting the checker reads (`CONFIG_KEYS`): the layout's boolean, else null. */
function flag(config: FeedBlock['config'], key: string): boolean | null {
  const v = config?.[key];
  return typeof v === 'boolean' ? v : null;
}

function settingsOf(config: FeedBlock['config']): MachineSettings {
  return {
    multiStack: flag(config, CONFIG_KEYS.multiStack), inputFilter: flag(config, CONFIG_KEYS.inputFilter),
    inputFromOutputSide: flag(config, CONFIG_KEYS.inputFromOutputSide), autoOutput: flag(config, CONFIG_KEYS.autoOutput),
  };
}

function copyRecipe(r: SimRecipe): SimRecipe {
  return {
    stepId: r.stepId, ticks: r.ticks, inputs: r.inputs.map((i) => ({ ...i })), held: [...r.held], outputs: r.outputs.map((o) => ({ ...o })),
    fluidsIn: r.fluidsIn.map((f) => ({ ...f })), fluidsOut: r.fluidsOut.map((f) => ({ ...f })),
  };
}

/** The distinct item keys `recipes` consume, sorted: what "takes 2+ item kinds" counts (rule 5). */
function kindsOf(recipes: readonly SimRecipe[]): StuffKey[] {
  return distinct(recipes.flatMap((r) => r.inputs.map((i) => i.key)));
}

/**
 * `text` (a list as main's `joinNames` writes it: "A", "A and B", "A, B and C") back into its names. A name the plan
 * knows may hold ", " or " and " itself, so the list is first cut into names the plan knows, the last after " and " and
 * the others after ", "; when no such cut exists, at every ", " and the last " and ".
 */
function splitNames(text: string, known: (name: string) => boolean): string[] {
  const t = text.trim();
  if (t === '' || known(t)) return t === '' ? [] : [t];
  const parts = t.split(/(, | and )/);                                                 // words at even indices, separators between
  const n = (parts.length + 1) / 2;
  const join = (i: number, j: number) => parts.slice(2 * i, 2 * j + 1).join('');      // words i..j with their separators
  const sep = (i: number) => parts[2 * i + 1];                                         // the separator after word i
  for (let last = n - 1; last >= 1; last--) {
    if (sep(last - 1) !== ' and ' || !known(join(last, n - 1))) continue;
    // the words before it as names the plan knows, each after ", "
    const from: Array<number | null> = Array.from({ length: last + 1 }, () => null);   // from[k]: where the name ending before word k starts
    from[0] = 0;
    for (let k = 1; k <= last; k++) {
      for (let i = 0; i < k && from[k] === null; i++) if (from[i] !== null && (i === 0 || sep(i - 1) === ', ') && known(join(i, k - 1))) from[k] = i;
    }
    if (from[last] === null) continue;
    const names = [join(last, n - 1)];
    for (let k = last; k > 0; k = from[k]!) names.unshift(join(from[k]!, k - 1));
    return names;
  }
  const commas = t.split(', ');
  const tail = commas.pop()!;
  const and = tail.lastIndexOf(' and ');
  return [...commas, ...(and === -1 ? [tail] : [tail.slice(0, and), tail.slice(and + ' and '.length)])];
}

// ---- readLine ----

/** Why main runs a multiblock by hand (`manualReasonOf`), in words. */
const HAND_RUN_WHY: Readonly<Record<NonNullable<ReturnType<typeof manualReasonOf>>, string>> = {
  no_automation: 'GregTech lets nothing automated move items in or out of it',
  own_hatch: 'GregTech lets items into it only through its own Coke Oven Hatch, which the layout does not place',
};

/**
 * The line `layout` of `plan` as the feeding checker's model (Task 2 rules 1–16). Ghost blocks and the hookups' blocks
 * are not read: the base's own network is outside the line.
 */
export function readLine(input: { pack: Pack; plan: Plan; layout: Layout }): FeedModel {
  const { pack, plan, layout } = input;
  const rotation = layout.rotation;
  const nameOf = (key: StuffKey): string => plan.names?.[key] ?? pack.nameOf(key);
  const steps = new Map(plan.steps.map((s) => [s.id, s]));

  // rule 1: the readable blocks, by local cell (one block per cell, the first)
  const cellMap = new Map<string, Cell>();
  for (const block of layout.blocks as readonly FeedBlock[]) {
    if (block.role === 'ghost' || block.hookup !== undefined) continue;
    const local = fromWorld(block.pos, layout);
    const id = nodeId(local);
    if (cellMap.has(id)) continue;
    const machine = block.block.mteId === undefined ? undefined : pack.machines.get(block.block.mteId);
    cellMap.set(id, { block, id, local, pos: [...block.pos], label: `${block.label} at ${where(block.pos)}`, machine });
  }
  const cells = [...cellMap.values()].sort((a, b) => compareLocal(a.local, b.local));
  const cellAt = (local: Vec3): Cell | undefined => cellMap.get(nodeId(local));
  const sideOf = (face: Face): number => localSide(FACES.indexOf(face), rotation);
  const links = (cell: Cell): number => localConnections(cell.block.connections ?? 0, rotation);

  const unknowns: FeedUnknown[] = [];
  const raised = new Set<string>();
  const unknown = (code: string, text: string, at?: Cell, stepId?: string): void => {
    const id = at === undefined ? `${code}\nstep ${stepId ?? ''}` : `${code}\n${at.id}`;
    if (raised.has(id)) return;
    raised.add(id);
    unknowns.push({ code, text, ...(at === undefined ? {} : { pos: [...at.pos] }), ...(stepId === undefined ? {} : { stepId }) });
  };

  // rule 12's names: every item key of the plan's steps and flows, by its name
  const byName = new Map<string, Set<StuffKey>>();
  const addName = (key: StuffKey): void => {
    if (isFluidKey(key)) return;
    const name = nameOf(key);
    const keys = byName.get(name) ?? new Set<StuffKey>();
    keys.add(key);
    byName.set(name, keys);
  };
  for (const s of plan.steps) for (const p of [...s.inputs, ...s.outputs]) addName(p.key);
  for (const f of plan.flows) addName(f.key);
  const readNames = (text: string): { keys: StuffKey[]; unread: string[] } => {
    const keys: StuffKey[] = [];
    const unread: string[] = [];
    for (const name of splitNames(text, (n) => byName.has(n))) {
      const found = byName.get(name);
      if (found === undefined || found.size !== 1) unread.push(name);
      else if (!keys.includes([...found][0]!)) keys.push([...found][0]!);
    }
    return { keys, unread };
  };

  // rule 6: each step's recipe, read once (its unknowns at the step's first machine)
  const recipes = new Map<string, SimRecipe>();
  const recipeFor = (s: PlanStep, at: Cell): SimRecipe => {
    let r = recipes.get(s.id);
    if (r === undefined) {
      r = readRecipe(pack, s, nameOf, (code, text) => unknown(code, text, at, s.id));
      recipes.set(s.id, r);
    }
    return copyRecipe(r);
  };

  // rules 2–5, 7: machines
  const machines: Array<BasicNode | MultiNode | BenchNode> = [];
  const multiMaps = new Map<NodeId, string[]>();
  for (const cell of cells) {
    const { block } = cell;
    if (block.role !== 'machine' || block.stepId === undefined) continue;
    const stepIds = block.stepIds !== undefined && block.stepIds.length > 0 ? [...block.stepIds] : [block.stepId];
    const missing = stepIds.find((id) => !steps.has(id));
    if (missing !== undefined) {
      unknown('step_missing', `${cell.label} is laid for step ${missing}, which the plan does not have: it is not checked`, cell, missing);
      continue;
    }
    const machine = cell.machine;
    if (machine === undefined) {
      unknown('machine_unknown', `${cell.label}: its machine (#${block.block.mteId ?? '?'}) is not in this recipe export, so it is not checked`, cell, stepIds[0]);
      continue;
    }
    const cls = simpleName(machine.cls);
    const manual = cls === BENCH_CLASS ? null : manualReasonOf(machine);
    if (manual !== null) {
      unknown('hand_run', `${machine.name} at ${where(cell.pos)} is run by hand (${manual}: ${HAND_RUN_WHY[manual]}): the checker leaves it out, `
        + 'and what it makes reaches the line through its input chest', cell, stepIds[0]);
      continue;
    }
    const base = {
      id: cell.id, pos: [...cell.pos] as Vec3, local: [...cell.local] as Vec3, name: machine.name, label: `${machine.name} at ${where(cell.pos)}`,
      stepIds, recipes: stepIds.map((id) => recipeFor(steps.get(id)!, cell)),
    };
    const kinds = kindsOf(base.recipes);
    const tier = machine.tier ?? steps.get(stepIds[0]!)!.machine.tier;
    if (cls === BENCH_CLASS) {
      machines.push(readBench({ ...base, kinds }, cell, machine, tier, steps.get(stepIds[0]!)!));
    } else if (machine.kind === 'multiblock') {
      machines.push({
        ...base, kinds, kind: 'multi', mteId: machine.mteId, inBuses: [], outBuses: [],
        inputSeparation: flag(block.config, CONFIG_KEYS.inputSeparation), separationDefault: INPUT_SEPARATION_DEFAULT.has(cls),
      });
      multiMaps.set(cell.id, [...machine.maps]);
    } else {
      machines.push(readBasic({ ...base, kinds }, cell, machine, tier));
    }
  }

  /** Rules 3–5: a GT basic machine, or a steam machine (pack kind `steam`, E17: GT's basic-machine slot rules). */
  function readBasic(base: Omit<BasicNode, 'kind' | 'mteId' | 'tier' | 'inSlots' | 'outSlots' | 'outputSide' | 'front' | 'maps' | 'settings' | 'steam'>,
    cell: Cell, machine: Machine, tier: number): BasicNode {
    const { block } = cell;
    const slots = basicSlots(machine);
    const inSlots = slots?.in ?? Math.max(0, ...base.recipes.map((r) => new Set(r.inputs.map((i) => i.key)).size + r.held.length));
    const outSlots = slots?.out ?? Math.max(0, ...base.recipes.map((r) => r.outputs.length));
    if (slots === null) {
      unknown('slots_unknown', `${base.label}: its slots are not known (no slot table row or exported counts for ${machine.metaName}), so they `
        + `come from its recipes: ${slotCount(inSlots, 'input')} and ${slotCount(outSlots, 'output')}`, cell, base.stepIds[0]);
    }
    const outputSide = isSide(block.facing) ? localSide(block.facing, rotation) : -1;
    if (outputSide === -1) unknown('output_side_unknown', `${base.label}: the layout does not say which side is its output side`, cell, base.stepIds[0]);
    const front = isSide(block.mainFacing) ? localSide(block.mainFacing, rotation) : -1;
    if (front === -1) unknown('front_unknown', `${base.label}: the layout does not say where its front is`, cell, base.stepIds[0]);
    const settings = settingsOf(block.config);
    if (base.kinds.length >= 2 && settings.multiStack === null) {
      unknown('multistack_unset', `${base.label} takes ${base.kinds.length} kinds of item and the layout does not set its Multi Stack Input: `
        + "a placed machine has its placer's setting", cell, base.stepIds[0]);
    }
    return {
      ...base, kind: 'basic', mteId: machine.mteId, tier, inSlots, outSlots, outputSide, front, maps: [...machine.maps], settings, steam: machine.kind === 'steam',
    };
  }

  /** Rules 4 and 7: an Auto Workbench, its grid from `feed.bench` or its crafting recipe, and the sides whose neighbour connects toward it. */
  function readBench(base: Omit<BenchNode, 'kind' | 'mteId' | 'tier' | 'front' | 'back' | 'grid' | 'result' | 'containers' | 'throughput' | 'fluidSides'
    | 'powerSides' | 'itemPipeSides'>, cell: Cell, machine: Machine, tier: number, first: PlanStep): BenchNode {
    const { block } = cell;
    const front = isSide(block.facing) ? localSide(block.facing, rotation) : -1;
    if (front === -1) unknown('front_unknown', `${base.label}: the layout does not say where its front is`, cell, base.stepIds[0]);
    const given = block.feed?.bench;
    let grid: Array<StuffKey | null>;
    if (given !== undefined) {
      grid = Array.from({ length: GRID_CELLS }, (_, i) => given.grid[i] ?? null);
    } else {
      grid = derivedGrid(pack, first, base.recipes[0]);
      unknown('bench_grid_derived', `${base.label}: the layout does not say what its crafting grid holds, so it is laid from the recipe`, cell, base.stepIds[0]);
      unknown('bench_mode_unset', `${base.label}: the layout does not set its mode and throughput, so it is read as mode 0 (normal) with throughput 0`,
        cell, base.stepIds[0]);
    }
    const made = base.recipes[0]?.outputs[0];
    const containers: Record<StuffKey, StuffKey> = {};
    for (const key of distinct(grid.filter((k): k is StuffKey => k !== null))) {
      const empty = pack.fluidContainers?.find((c) => c.container === key && c.empty !== null)?.empty;
      if (empty !== undefined && empty !== null) containers[key] = empty;
    }
    // GT cables and pipes connect GT6-style (E17): a side counts only when its neighbour's link points at the bench
    const fluidSides: number[] = [], powerSides: number[] = [], itemPipeSides: number[] = [];
    for (const side of SIDES) {
      const n = cellAt(step(cell.local, side));
      if (n === undefined) continue;
      const toward = OPPOSITE[side]!;
      const linked = (links(n) & (1 << toward)) !== 0;
      if (n.block.role === 'cable' && linked) powerSides.push(side);
      const fluidConduit = n.block.conduits?.some((c) => c.kind !== 'item' && c.faces.some((f) => f.mode !== 'disabled' && sideOf(f.face) === toward)) === true;
      if ((n.machine?.kind === 'fluid_pipe' && linked) || fluidConduit) fluidSides.push(side);
      if (n.machine?.kind === 'item_pipe' && linked) itemPipeSides.push(side);
    }
    return {
      ...base, kind: 'bench', mteId: machine.mteId, tier, front, back: front === -1 ? -1 : OPPOSITE[front]!, grid,
      result: made === undefined ? { key: '', amount: 0 } : { key: made.key, amount: made.amount }, containers, throughput: given?.throughput ?? 0,
      fluidSides, powerSides, itemPipeSides,
    };
  }

  // rule 2: each input and output bus of a multiblock step, at the nearest controller of its step (Manhattan distance in local
  // cells, a tie to the controller earlier in local order): a hatch block names its step but no unit, and a step of two
  // machines lays two controllers
  const multis = machines.filter((m): m is MultiNode => m.kind === 'multi');
  const busOwner = new Map<NodeId, MultiNode>();
  for (const cell of cells) {
    const { block } = cell;
    if (block.role !== 'hatch' || block.stepId === undefined || cell.machine === undefined) continue;
    const cls = simpleName(cell.machine.cls);
    if (cls !== INPUT_BUS_CLASS && cls !== OUTPUT_BUS_CLASS) continue;
    let owner: MultiNode | undefined;
    for (const m of multis) {
      if (!m.stepIds.includes(block.stepId)) continue;
      if (owner === undefined || manhattan(m.local, cell.local) < manhattan(owner.local, cell.local)) owner = m;
    }
    if (owner === undefined) continue;
    const tier = cell.machine.tier;
    if (tier === undefined) unknown('slots_unknown', `${cell.label}: its tier, and so its slots, are not known: read as 1 slot`, cell, block.stepId);
    const slots = busSlots(tier ?? 0);
    const front = isSide(block.facing) ? localSide(block.facing, rotation) : -1;
    if (front === -1) unknown('front_unknown', `${cell.label}: the layout does not say where its front is`, cell, block.stepId);
    const common = { id: cell.id, pos: [...cell.pos] as Vec3, local: [...cell.local] as Vec3, label: cell.label, front, slots };
    if (cls === INPUT_BUS_CLASS) {
      const bus: BusNode = {
        ...common, limited: flag(block.config, CONFIG_KEYS.limited), inputFilter: flag(block.config, CONFIG_KEYS.inputFilter), maps: [...multiMaps.get(owner.id)!],
      };
      if (owner.kinds.length >= 2 && bus.limited === null) {
        unknown('limited_unset', `${cell.label} of ${owner.label} takes ${owner.kinds.length} kinds of item and the layout does not set its Limiting mode`,
          cell, block.stepId);
      }
      owner.inBuses.push(bus);
    } else {
      const out: OutBusNode = { ...common, lock: busLock(cell) };
      owner.outBuses.push(out);
    }
    busOwner.set(cell.id, owner);
  }
  for (const m of multis) {
    if (m.inBuses.length < 2 || m.inputSeparation !== null) continue;
    const at = cellAt(m.local)!;
    unknown('separation_unset', `${m.label} has ${m.inBuses.length} input buses and the layout does not set its Input Separation: a new one starts `
      + `${m.separationDefault ? 'with it on' : 'with it off'}`, at, m.stepIds[0]);
  }

  /**
   * An output bus's `config.lock`: the item it names; a blank one (a cleared lock field) is no lock. A name that resolves to
   * no item of the plan, or to two, is kept as the text itself, which holds no '@' and so matches no item key: the plan asks
   * for a lock no output of the line matches and gives no value for it, and the unknown says the text was not read.
   */
  function busLock(cell: Cell): StuffKey | null {
    const text = cell.block.config?.[CONFIG_KEYS.lock];
    if (text === undefined || (typeof text === 'string' && text.trim() === '')) return null;
    const read = typeof text === 'string' ? readNames(text) : { keys: [], unread: [String(text)] };
    if (read.unread.length === 0 && read.keys.length === 1) return read.keys[0]!;
    unknown('text_unread', `${cell.label}: its lock "${String(text)}" names no single item of the plan, so it is read as a lock no output of the line matches`,
      cell, cell.block.stepId);
    return String(text);
  }

  // rule 8: the tail chests
  const chests: ChestNode[] = [];
  for (const cell of cells) {
    if (cell.block.role !== 'chest') continue;
    const side = cell.block.tail?.side;
    if (side === undefined) unknown('chest_side_unknown', `${cell.label}: the layout does not say whether it is an input or an output chest: read as an output chest`, cell);
    chests.push({ kind: 'chest', id: cell.id, pos: [...cell.pos], local: [...cell.local], label: cell.label, side: side ?? 'output', keys: [] });
  }
  const nodes: FeedNode[] = [...machines, ...chests].sort((a, b) => compareLocal(a.local, b.local));
  const nodeMap = new Map<NodeId, FeedNode>(nodes.map((n) => [n.id, n]));
  const invRef = (from: Vec3, side: number): InvRef | null => {
    const id = nodeId(step(from, side));
    const owner = busOwner.get(id);
    if (owner !== undefined) return { node: owner.id, bus: id, side: OPPOSITE[side]! };
    return nodeMap.has(id) ? { node: id, side: OPPOSITE[side]! } : null;
  };

  // rules 9–10: what comes into the line and leaves it, and the plan's rates
  const laidSet = new Set(machines.flatMap((m) => m.stepIds));
  const laid = plan.steps.map((s) => s.id).filter((id) => laidSet.has(id));
  const itemFlows = plan.flows.filter((f) => !isFluidKey(f.key)).map((f) => ({ ...f }));
  const supply = distinct(itemFlows.filter((f) => laidSet.has(f.to) && (f.from === 'raw' || !laidSet.has(f.from))).map((f) => f.key));
  const carried = new Set(itemFlows.map((f) => f.key));
  const strays = laid.flatMap((id) => recipes.get(id)?.outputs.map((o) => o.key) ?? []).filter((k) => !carried.has(k));
  const sinks = distinct([
    ...itemFlows.filter((f) => laidSet.has(f.from) && (f.to === 'out' || f.to === 'sink' || !laidSet.has(f.to))).map((f) => f.key), ...strays,
  ]);
  // what each machine of a laid step takes (`planned`) and gives (`plannedOut`) per second, by the plan's item flows
  const perMachine = (id: string, way: 'to' | 'from'): Record<StuffKey, number> | null => {
    const sums = new Map<StuffKey, number>();
    for (const f of itemFlows) if (f[way] === id) sums.set(f.key, (sums.get(f.key) ?? 0) + f.perSecond);
    if (sums.size === 0) return null;
    const count = Math.max(1, steps.get(id)!.count);
    return Object.fromEntries([...sums].sort((a, b) => compareText(a[0], b[0])).map(([key, perSecond]) => [key, perSecond / count]));
  };
  const planned: Record<string, Record<StuffKey, number>> = {};
  const plannedOut: Record<string, Record<StuffKey, number>> = {};
  for (const id of laid) {
    const takes = perMachine(id, 'to');
    if (takes !== null) planned[id] = takes;
    const gives = perMachine(id, 'from');
    if (gives !== null) plannedOut[id] = gives;
  }
  const makerSteps = new Map<StuffKey, Set<string>>();
  for (const f of plan.flows) {
    if (!laidSet.has(f.from)) continue;
    const set = makerSteps.get(f.key) ?? new Set<string>();
    set.add(f.from);
    makerSteps.set(f.key, set);
  }
  const makers: Record<StuffKey, string[]> = Object.fromEntries([...makerSteps].sort((a, b) => compareText(a[0], b[0]))
    .map(([key, ids]) => [key, laid.filter((id) => ids.has(id))]));

  // rules 8–9: an input chest stocks the supply its tail lists; supply no input chest lists goes in the first one
  const inputChests = chests.filter((c) => c.side === 'input').sort((a, b) => compareLocal(a.local, b.local));
  const tailKeys = (c: ChestNode): StuffKey[] => cellAt(c.local)?.block.tail?.keys ?? [];
  for (const c of inputChests) c.keys = distinct(tailKeys(c).filter((k) => supply.includes(k)));
  const listed = new Set(inputChests.flatMap(tailKeys));
  const unlisted = supply.filter((k) => !listed.has(k));
  const firstInput = inputChests[0];
  if (firstInput !== undefined && unlisted.length > 0) {
    firstInput.keys = distinct([...firstInput.keys, ...unlisted]);
    unknown('supply_not_listed', `${joinNames(unlisted.map(nameOf))} ${unlisted.length === 1 ? 'comes' : 'come'} into the line but no input chest lists `
      + `${unlisted.length === 1 ? 'it' : 'them'}: the checker stocks ${unlisted.length === 1 ? 'it' : 'them'} in ${firstInput.label}`, cellAt(firstInput.local));
  }

  // rules 11–15: networks and covers
  const ctx: ReadContext = {
    pack, plan, rotation, cells, nodes: nodeMap, cellAt, invRef, sideOf, links, readNames, nameOf, step: (id) => steps.get(id), unknown,
  };
  const networks: FeedNetwork[] = [...readGtPipes(ctx), ...readRouted(ctx), ...readAe2(ctx), ...readEnderio(ctx)]
    .map((net, i) => ({ net, i, at: firstMember(net) }))
    .sort((a, b) => (a.at === null || b.at === null ? 0 : compareLocal(a.at, b.at)) || a.i - b.i)
    .map(({ net }) => net);
  const covers = readCovers(ctx);

  // rule 16: recipe-map lookups, memoized per map and key
  const takes = new Map<string, boolean>();
  const pairs = new Map<string, boolean>();
  const circuits = new Map<StuffKey, boolean>();
  const mapTakes = (map: string, key: StuffKey): boolean => {
    const memo = `${map}\n${key}`;
    let v = takes.get(memo);
    if (v === undefined) {
      v = (pack.consumers.get(key) ?? []).some((i) => pack.recipes[i]?.maps.includes(map) === true);
      takes.set(memo, v);
    }
    return v;
  };
  const mapPair = (map: string, a: StuffKey, b: StuffKey): boolean => {
    const [x, y] = compareText(a, b) <= 0 ? [a, b] : [b, a];
    const memo = `${map}\n${x}\n${y}`;
    let v = pairs.get(memo);
    if (v === undefined) {
      v = (pack.consumers.get(x) ?? []).some((i) => {
        const r = pack.recipes[i];
        return r !== undefined && r.maps.includes(map) && r.inputs.some((ing) => ing.options.some((o) => o.key === y));
      });
      pairs.set(memo, v);
    }
    return v;
  };
  const circuitOre = (key: StuffKey): boolean => {
    let v = circuits.get(key);
    if (v === undefined) {
      v = pack.items.get(key)?.oreDict.some((name) => name.startsWith('circuit')) === true;
      circuits.set(key, v);
    }
    return v;
  };
  // AE2's blocking-ignore test over the pack (E12: GT's lenses by their prefix), memoized per key: AE2 blocking mode asks it on every CPU update
  const ignored = new Map<StuffKey, boolean>();
  const blockingIgnores = (key: StuffKey): boolean => {
    let v = ignored.get(key);
    if (v === undefined) {
      v = ignoredByBlocking(pack, key);
      ignored.set(key, v);
    }
    return v;
  };

  // every list in local order: the unknowns by their block (those tied to no block first), each block's in the order raised
  const located = unknowns.map((u, i) => ({ u, i, local: u.pos === undefined ? null : fromWorld(u.pos, layout) }));
  located.sort((a, b) => (a.local === null ? (b.local === null ? 0 : -1) : b.local === null ? 1 : compareLocal(a.local, b.local)) || a.i - b.i);

  return {
    mode: layout.mode, nodes, networks, covers, supply, sinks, planned, plannedOut, makers, laid,
    fed: Object.fromEntries(plan.steps.map((s) => [s.id, stepItemInputs(plan, s.id)])),
    made: Object.fromEntries(plan.steps.map((s) => [s.id, stepItemOutputs(plan, s.id)])),
    itemFlows, depths: Object.fromEntries(stepDepths(plan)), unknowns: located.map(({ u }) => u),
    nameOf,
    stepName: (stepId: string): string => {
      const s = steps.get(stepId);
      if (s === undefined) return stepId;
      return s.mainOutput === undefined ? s.machine.name : nameOf(s.mainOutput);
    },
    mapTakes, mapPair, circuitOre, ignoredByBlocking: blockingIgnores,
  };
}

/** The local cell of a network's first member (pipe, face or interface; an export bus when it has no interface). */
function firstMember(net: FeedNetwork): Vec3 | null {
  const id = net.kind === 'enderio' ? net.faces[0]?.conduit : net.kind === 'ae2' ? (net.interfaces[0] ?? net.exportBuses[0])?.id : net.pipes[0]?.id;
  return id === undefined ? null : (id.split(',').map(Number) as Vec3);
}

// ---- Recipes (rule 6) ----

/**
 * A step's recipe as a machine runs it: the pack recipe `step.recipeId` — per item ingredient, the option the step's
 * inputs list (else the first); consumed ones with their chance (chance-1 ones of one key summed), the others held in
 * an input slot unless it is the programmed circuit; fluids apart; item outputs in order with their chances. Without
 * the recipe (`recipe_missing`): the plan step's expected per-run amounts, an input rounded up (`amount_fraction` when
 * not whole), an output `a` as `{ ⌈a⌉, a / ⌈a⌉ }`.
 */
function readRecipe(pack: Pack, s: PlanStep, nameOf: (key: StuffKey) => string, raise: (code: string, text: string) => void): SimRecipe {
  const ticks = Math.max(1, s.durationTicks);
  const recipe = pack.recipeById.get(s.recipeId);
  if (recipe === undefined) return planRecipe(s, ticks, nameOf, raise);
  const listed = new Set(s.inputs.map((p) => p.key));
  const inputs: SimRecipe['inputs'] = [];
  const held: StuffKey[] = [];
  const fluidsIn: SimRecipe['fluidsIn'] = [];
  for (const ing of recipe.inputs) {
    const option = ing.options.find((o) => listed.has(o.key)) ?? ing.options[0];
    if (option === undefined) continue;
    if (isFluidKey(option.key)) {
      if (ing.consumed) fluidsIn.push({ key: option.key, amount: option.amount });
    } else if (!ing.consumed) {
      if (itemId(option.key) !== PART_KEYS.circuitId) held.push(option.key);
    } else {
      const same = ing.chance === 1 ? inputs.find((i) => i.key === option.key && i.chance === 1) : undefined;
      if (same !== undefined) same.amount += option.amount;
      else inputs.push({ key: option.key, amount: option.amount, chance: ing.chance });
    }
  }
  return {
    stepId: s.id, ticks, inputs, held,
    outputs: recipe.outputs.filter((p) => !isFluidKey(p.key)).map((p) => ({ key: p.key, amount: p.amount, chance: p.chance })),
    fluidsIn, fluidsOut: recipe.outputs.filter((p) => isFluidKey(p.key)).map((p) => ({ key: p.key, amount: p.amount })),
  };
}

function planRecipe(s: PlanStep, ticks: number, nameOf: (key: StuffKey) => string, raise: (code: string, text: string) => void): SimRecipe {
  const label = `${s.machine.name} (step ${s.id})`;
  raise('recipe_missing', `The recipe of ${label} is not in this recipe export: its amounts are the plan step's expected amounts per run`);
  const inputs: SimRecipe['inputs'] = [];
  const fluidsIn: SimRecipe['fluidsIn'] = [];
  const fractions: string[] = [];
  for (const p of s.inputs) {
    const a = tidy(p.amount);
    if (a <= 0) continue;
    if (isFluidKey(p.key)) {
      fluidsIn.push({ key: p.key, amount: a });
      continue;
    }
    if (!Number.isInteger(a)) fractions.push(`${amountWords(a)}× ${nameOf(p.key)}`);
    inputs.push({ key: p.key, amount: Math.ceil(a), chance: 1 });
  }
  if (fractions.length > 0) {
    raise('amount_fraction', `${label} takes ${joinNames(fractions)} a run, which ${fractions.length === 1 ? 'is' : 'are'} not whole: read as whole items, rounded up`);
  }
  const outputs: SimRecipe['outputs'] = [];
  const fluidsOut: SimRecipe['fluidsOut'] = [];
  for (const p of s.outputs) {
    const a = tidy(p.amount);
    if (a <= 0) continue;
    if (isFluidKey(p.key)) fluidsOut.push({ key: p.key, amount: a });
    else outputs.push(Number.isInteger(a) ? { key: p.key, amount: a, chance: 1 } : { key: p.key, amount: Math.ceil(a), chance: a / Math.ceil(a) });
  }
  return { stepId: s.id, ticks, inputs, held: [], outputs, fluidsIn, fluidsOut };
}

/**
 * A bench's grid from its step's crafting recipe (rule 7): a shaped recipe's slot s at row ⌊s / width⌋, column
 * s mod width; a shapeless one's ingredients in cells 0… in slot order; each cell's option as rule 6 picks it. Without
 * a crafting recipe, the recipe's consumed items in cells 0…, one per item.
 */
function derivedGrid(pack: Pack, s: PlanStep, recipe: SimRecipe | undefined): Array<StuffKey | null> {
  const grid: Array<StuffKey | null> = Array.from({ length: GRID_CELLS }, () => null);
  const crafting = pack.recipeById.get(s.recipeId);
  if (crafting === undefined || crafting.source !== 'crafting') {
    const items = (recipe?.inputs ?? []).flatMap((i) => Array.from({ length: Math.max(0, Math.ceil(i.amount)) }, () => i.key));
    items.slice(0, GRID_CELLS).forEach((key, i) => { grid[i] = key; });
    return grid;
  }
  const listed = new Set(s.inputs.map((p) => p.key));
  const optionOf = (options: ReadonlyArray<{ key: StuffKey }>): StuffKey | null => (options.find((o) => listed.has(o.key)) ?? options[0])?.key ?? null;
  const ingredients = [...crafting.inputs].sort((a, b) => a.slot - b.slot);
  if (crafting.flags.shaped === true) {
    const width = typeof crafting.meta.width === 'number' && crafting.meta.width > 0 ? crafting.meta.width : GRID_WIDTH;
    for (const ing of ingredients) {
      const cell = Math.floor(ing.slot / width) * GRID_WIDTH + (ing.slot % width);
      if (cell >= 0 && cell < GRID_CELLS) grid[cell] = optionOf(ing.options);
    }
  } else {
    ingredients.slice(0, GRID_CELLS).forEach((ing, i) => { grid[i] = optionOf(ing.options); });
  }
  return grid;
}
