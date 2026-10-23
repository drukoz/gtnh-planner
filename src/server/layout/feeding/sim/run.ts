// One scenario run of the feeding simulation (plan `docs/superpowers/plans/2026-10-20-21-feeding-checker.md` Tasks 4–10):
// `runScenario` builds the entities of a model for a scenario — one per node (GT basic machines and chests; a multiblock's
// controller and each of its buses, Task 5; an Auto Workbench and its energy, Task 6), the networks' entities from
// `NETWORK_MODELS` (EnderIO's, Task 7; Project Red's, Task 8; AE2's, Task 9; GT item pipes', Task 10) and a test's extra
// ones — runs them tick by tick and turns what they recorded into findings (`detect`).
// - Every node kind and every network kind has its model; a network kind without one would be left out, with the unknown
//   `not_simulated`.
// - `env.push(from, side)` is what a GT transfer out of that side meets: the receiver a network registered at the
//   neighbouring cell for that side, else the inventory of the node (or bus) there, else nothing (a routed pipe too: it is
//   no inventory).
// - What a scenario changes in a run (`scenarioParams`, Task 11 rule 3): `fast_supplier` runs the makers of each 2+ kind
//   machine's first kind ten times faster, `late_input` holds each such machine's last kind back for `LATE_TICKS`;
//   `multistack_on` reads a Multi Stack Input the layout leaves unset as On (the machine models read the scenario), and
//   `restart` loads the line's chunk again (below).
// - In `restart` the line's chunk loads again at the start of tick `restartAt` (rule 3a): every tile's timer and the
//   covers' counter start again from there, every multiblock controller looks for a recipe (its load-time check), and every
//   bench's and every network's `restart()` runs.
// - A bench's crafts are the runs of its first recipe's step, the one its grid is laid from (`SimStats.benchCrafted`).
// - The run's unknowns: the stack sizes, an input chest of too many kinds and each network kind without a model, then the
//   items dropped into the world, then what each network's model could not know (Project Red's lost send queues and
//   wanderers, AE2's steam machines emptied by hand), each in the order first met.
// - What reached the line's output chests or ME (`out`): the output chests' arrivals and what each network's model says
//   entered ME.
// Pure TypeScript: nothing from node:* may be imported here.

import { isFluidKey, type StuffKey } from '../../../../shared/keys.ts';
import { fmtInt, NETWORK_NAMES } from '../../../../shared/layout/format.ts';
import { OPPOSITE, posKey, step, type Vec3 } from '../../../../shared/layout/geometry.ts';
import { LATE_TICKS, SLOW_TOLERANCE, type FeedFinding, type FeedUnknown, type ScenarioName } from '../contract.ts';
import { CHEST_SLOTS, PART_KEYS } from '../facts.ts';
import { localOf } from '../frame.ts';
import type { FeedModel, FeedNetwork, FeedNode, NodeId } from '../model.ts';
import { ae2Model } from './ae2.ts';
import { bench } from './bench.ts';
import { FluidPools, KeyTable, Sim, type Preloadable, type PushTarget, type SimEntity, type SimInv } from './core.ts';
import { detect, SimStats, type Explain } from './detect.ts';
import { enderioModel } from './enderio.ts';
import { gtPipeModel } from './gtpipe.ts';
import { basicMachine, type SimEnv } from './machine.ts';
import { multiblock } from './multi.ts';
import { routedModel } from './routed.ts';
import { inputChest, outputChest } from './storage.ts';

/**
 * What a network kind's model gives a run: its entities, its reasons, the push targets it registers at cells, what a restart
 * resets, what the run left it unable to know, and what entered ME, by item (both read once the run is over).
 */
export interface NetworkModel {
  entities: SimEntity[]; explain: Explain; receivers: Array<{ at: NodeId; side: number; target: PushTarget }>; restart?: () => void;
  unknowns?: () => FeedUnknown[];
  out?: () => Array<[StuffKey, number]>;
}

type NetworkModels = { [K in FeedNetwork['kind']]?: (net: Extract<FeedNetwork, { kind: K }>, env: SimEnv) => NetworkModel };

/** The network models by kind: EnderIO's (Task 7), Project Red's (Task 8), AE2's (Task 9) and GT item pipes' (Task 10). */
export const NETWORK_MODELS: NetworkModels = { enderio: enderioModel, routed: routedModel, ae2: ae2Model, gtpipe: gtPipeModel };

export interface ScenarioOptions {
  ticks: number; restartAt: number; exhaustive?: boolean; ae2Coprocessors?: number; ae2FluidStock?: boolean; slowTolerance?: number;
  /** Test entities (feeders, takers), built once the run's entities are. */
  extra?: (env: SimEnv) => SimEntity[];
  /** Tests only: inventory contents at tick 0, by node (or bus) id. */
  initial?: Record<NodeId, Array<[slot: number, key: StuffKey, count: number]>>;
}

/** One scenario's result; its `unknowns` in the order first met, which `checkFeeding` merges over the scenarios (Task 11 rule 6). */
export interface ScenarioRun {
  name: ScenarioName; ticks: number; findings: FeedFinding[]; stats: SimStats; runs: Record<string, number>; out: Record<StuffKey, number>;
  unknowns: FeedUnknown[];
}

/**
 * The unknown every report gives once (Global Constraints): the export carries no stack sizes, so the checker takes 64 for
 * every item but a Fluid Packet and a GT tool (1 each; `stackLimit`). Each scenario run raises it first, and `checkFeeding`
 * raises it itself when no scenario ran, as the static rules (R1, R10b) read stack sizes too.
 */
export function stackSizesUnknown(): FeedUnknown {
  return { code: 'stack_sizes', text: 'The recipe export carries no stack sizes: every item is taken to stack to 64, a Fluid Packet and a GT tool to 1' };
}

/** Every item and fluid key the model names, and those of the test's contents. */
function modelKeys(model: FeedModel, initial: ScenarioOptions['initial']): StuffKey[] {
  const keys: StuffKey[] = [...model.supply, ...model.sinks, ...Object.keys(model.makers), ...Object.values(model.fed).flat(), ...Object.values(model.made).flat()];
  for (const rates of Object.values(model.planned)) keys.push(...Object.keys(rates));
  for (const f of model.itemFlows) keys.push(f.key);
  for (const node of model.nodes) {
    if (node.kind === 'chest') {
      keys.push(...node.keys);
      continue;
    }
    keys.push(...node.kinds);
    for (const r of node.recipes) {
      keys.push(...r.inputs.map((i) => i.key), ...r.held, ...r.outputs.map((o) => o.key), ...r.fluidsIn.map((f) => f.key), ...r.fluidsOut.map((f) => f.key));
    }
    if (node.kind === 'bench') {
      keys.push(...node.grid.filter((k): k is StuffKey => k !== null), node.result.key, ...Object.keys(node.containers), ...Object.values(node.containers));
    }
    if (node.kind === 'multi') for (const b of node.outBuses) if (b.lock !== null) keys.push(b.lock);
  }
  for (const c of model.covers) keys.push(...(c.filter?.keys ?? []));
  for (const net of model.networks) {
    switch (net.kind) {
      case 'enderio':
        for (const f of net.faces) {
          for (const filter of [f.extract?.filter, f.insert?.filter]) {
            if (filter === null || filter === undefined) continue;
            keys.push(...filter.keys);
          }
        }
        break;
      case 'routed':
        for (const p of net.pipes) for (const chip of p.chips) keys.push(...(chip.filter?.keys ?? []), ...(chip.stock ?? []).map((s) => s.key));
        break;
      case 'ae2':
        for (const i of net.interfaces) {
          for (const p of i.spec.patterns) {
            keys.push(...p.inputs.map((x) => x.key), ...p.outputs.map((x) => x.key));
            // a plain interface pushes a pattern's fluid as a Fluid Packet item
            if (p.inputs.some((x) => isFluidKey(x.key))) keys.push(PART_KEYS.fluidPacket);
          }
        }
        for (const b of net.exportBuses) keys.push(...b.keys);
        break;
      default:
        break;
    }
  }
  for (const contents of Object.values(initial ?? {})) for (const [, key] of contents) keys.push(key);
  return keys.filter((k) => k !== '');
}

function isPreloadable(inv: SimInv): inv is SimInv & Preloadable {
  return typeof (inv as Partial<Preloadable>).preload === 'function';
}

/** What a scenario changes in a run (Task 11 rule 3): the steps whose runs are fast, the items held back, and until when. */
export interface ScenarioParams { fastSteps: Set<string>; heldBack: Set<StuffKey>; heldUntil: number }

/**
 * What `scenario` changes in a run of `model` (Task 11 rule 3, research §7). The "2+ kind machines" are the machine nodes
 * whose recipes take two or more item kinds (`node.kinds`, Task 2 rule 5: the recipes, not the plan's flows).
 * - `fast_supplier`: `fastSteps` are the steps that make each such machine's first kind (`kinds[0]`, key order;
 *   `model.makers`): their runs last `⌈ticks / FAST_FACTOR⌉`.
 * - `late_input`: `heldBack` holds each such machine's last kind (key order) that is not also the first kind of another;
 *   supplies (input chests, ME storage) hold none of them before `heldUntil` (`LATE_TICKS`), and a machine whose step
 *   makes one starts no run before it.
 * - `steady`, `restart` and `multistack_on` change none of these.
 */
export function scenarioParams(model: FeedModel, scenario: ScenarioName): ScenarioParams {
  const fastSteps = new Set<string>(), heldBack = new Set<StuffKey>();
  const kinds = model.nodes.flatMap((n) => (n.kind !== 'chest' && n.kinds.length >= 2 ? [n.kinds] : []));
  if (scenario === 'fast_supplier') for (const k of kinds) for (const stepId of model.makers[k[0]!] ?? []) fastSteps.add(stepId);
  if (scenario === 'late_input') {
    const firsts = new Set(kinds.map((k) => k[0]!));
    for (const k of kinds) if (!firsts.has(k.at(-1)!)) heldBack.add(k.at(-1)!);
  }
  return { fastSteps, heldBack, heldUntil: scenario === 'late_input' ? LATE_TICKS : 0 };
}

/**
 * Runs `model` in `scenario` for `opts.ticks` ticks and reports what it found. `exhaustive` runs every entity on every
 * tick instead of waking each when it is due; the result must be the same.
 */
export function runScenario(model: FeedModel, scenario: ScenarioName, opts: ScenarioOptions): ScenarioRun {
  const keys = new KeyTable(modelKeys(model, opts.initial));
  const stats = new SimStats(keys);
  const sim = new Sim(opts.ticks, opts.exhaustive === true);
  const invs = new Map<NodeId, SimInv>();
  const receivers = new Map<string, PushTarget>();
  const reached = new Map<string, PushTarget | SimInv | null>();
  // rule 7a: one pool per fluid a laid step makes
  const pooled = Object.keys(model.makers).filter((k) => isFluidKey(k) && (model.makers[k]?.length ?? 0) > 0).map((k) => keys.id(k));
  const { fastSteps, heldBack, heldUntil } = scenarioParams(model, scenario);
  const env: SimEnv = {
    sim, keys, stats, scenario, model,
    push(from, side) {
      const memo = `${from}|${side}`;
      let found = reached.get(memo);
      if (found === undefined) {
        const to = posKey(step(localOf(from), side));
        found = receivers.get(`${to}|${OPPOSITE[side]}`) ?? invs.get(to) ?? null;
        reached.set(memo, found);
      }
      return found;
    },
    inv: (id) => invs.get(id) ?? null,
    fastSteps, heldBack, heldUntil, loadedAt: 0,
    fluids: new FluidPools(pooled),
    opts: {
      ticks: opts.ticks, restartAt: opts.restartAt, ae2Coprocessors: opts.ae2Coprocessors ?? 0, ae2FluidStock: opts.ae2FluidStock === true,
      slowTolerance: opts.slowTolerance ?? SLOW_TOLERANCE,
    },
    byHand: null,
  };
  const unknowns: FeedUnknown[] = [stackSizesUnknown()];
  const at = (node: FeedNode) => ({ pos: [node.pos[0], node.pos[1], node.pos[2]] as Vec3, ...(node.kind === 'chest' ? {} : { stepId: node.stepIds[0]! }) });

  // one entity per node (two for a bench: its energy too)
  const entities: SimEntity[] = [];
  const restarts: Array<() => void> = [];
  for (const node of model.nodes) {
    let inv: (SimInv & SimEntity) | null = null;
    switch (node.kind) {
      case 'basic':
        inv = basicMachine(node, env);
        break;
      case 'multi': {
        // the controller has no inventory the line uses; its buses are inventories, each at its own cell
        const parts = multiblock(node, env);
        for (const bus of [...parts.buses, ...parts.outBuses]) {
          invs.set(bus.id, bus);
          entities.push(bus);
        }
        entities.push(parts.controller);
        break;
      }
      case 'bench': {
        const b = bench(node, env);
        inv = b;
        entities.push(b.power);
        restarts.push(() => b.restart());
        break;
      }
      case 'chest':
        inv = node.side === 'input' ? inputChest(node, env) : outputChest(node, env);
        if (node.side === 'input' && node.keys.length > CHEST_SLOTS) {
          unknowns.push({ code: 'input_chest_full', text: `${node.label} is to stock ${node.keys.length} kinds of item but holds ${CHEST_SLOTS} stacks: `
            + `the checker stocks the first ${CHEST_SLOTS} in key order`, ...at(node) });
        }
        break;
      default: {
        const otherKind: never = node;                        // every node kind has its model
        void otherKind;
      }
    }
    if (inv === null) continue;
    invs.set(node.id, inv);
    entities.push(inv);
  }

  // the networks
  const explains: Explain[] = [];
  const models: NetworkModel[] = [];
  const unmodelled = new Set<FeedNetwork['kind']>();
  for (const net of model.networks) {
    const make = NETWORK_MODELS[net.kind] as ((n: FeedNetwork, e: SimEnv) => NetworkModel) | undefined;
    if (make === undefined) {
      if (!unmodelled.has(net.kind)) {
        unmodelled.add(net.kind);
        unknowns.push({ code: 'not_simulated', text: `The line's ${NETWORK_NAMES[net.kind]} network is not simulated: the checker has no model of it yet, so nothing moves through it` });
      }
      continue;
    }
    const m = make(net, env);
    models.push(m);
    entities.push(...m.entities);
    explains.push(m.explain);
    for (const r of m.receivers) receivers.set(`${r.at}|${r.side}`, r.target);
    if (m.restart !== undefined) restarts.push(m.restart);
  }
  reached.clear();

  // a test's contents at tick 0, and its entities
  for (const [id, contents] of Object.entries(opts.initial ?? {})) {
    const inv = invs.get(id);
    if (inv === undefined || !isPreloadable(inv)) throw new Error(`The run has no inventory ${id} to fill`);
    for (const [slot, key, count] of contents) inv.preload(slot, keys.id(key), count);
  }
  entities.push(...(opts.extra?.(env) ?? []));
  for (const e of entities) sim.add(e, 0);

  // the run; a restart is the end of the tick before `restartAt`
  const restartAt = scenario === 'restart' && opts.restartAt > 0 && opts.restartAt < opts.ticks ? opts.restartAt : -1;
  sim.run((t) => {
    if (t + 1 !== restartAt) return;
    env.loadedAt = restartAt;
    for (const r of restarts) r();
    for (const e of entities) sim.wake(e, null);
  });

  // what is left, what ran, what reached the output chests or ME
  for (const inv of invs.values()) stats.snapshot(inv);
  const runs: Record<string, number> = {};
  const out = new Map<StuffKey, number>();
  for (const node of model.nodes) {
    if (!stats.isSimulated(node.id)) continue;
    if (node.kind === 'chest') {
      if (node.side === 'output') for (const [, key, n] of stats.arrivals(node.id)) out.set(key, (out.get(key) ?? 0) + n);
      continue;
    }
    const counts = stats.runsOf(node.id);
    node.recipes.forEach((r, i) => { runs[r.stepId] = (runs[r.stepId] ?? 0) + (counts[i] ?? 0); });
  }
  for (const m of models) for (const [key, n] of m.out?.() ?? []) out.set(key, (out.get(key) ?? 0) + n);
  const explain: Explain = (kind, node, key) => {
    for (const ex of explains) {
      const why = ex(kind, node, key);
      if (why !== null) return why;
    }
    return null;
  };
  const findings = detect(model, stats, { scenario, ticks: opts.ticks, explain, slowTolerance: env.opts.slowTolerance });
  const byId = new Map(model.nodes.map((n) => [n.id, n]));
  for (const [id, key, n] of stats.spillsInOrder()) {
    const node = byId.get(id);
    const label = node?.label ?? id;
    unknowns.push({ code: 'items_dropped', text: `${label} dropped ${fmtInt(n)} ${model.nameOf(key)} into the world: nothing at the side it pushes them out of `
      + 'takes them, so they are lost to the line', key, ...(node === undefined ? {} : at(node)) });
  }
  for (const m of models) unknowns.push(...(m.unknowns?.() ?? []));
  return {
    name: scenario, ticks: opts.ticks, findings, stats, runs,
    out: Object.fromEntries([...out].sort((a, b) => (a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : 0))), unknowns,
  };
}
