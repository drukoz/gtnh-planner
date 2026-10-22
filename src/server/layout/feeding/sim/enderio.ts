// EnderIO item conduits in the feeding simulation (plan `docs/superpowers/plans/2026-10-20-21-feeding-checker.md` Task 7;
// E5; research §2.1): each network moves items as EnderIO 2.10.46's `NetworkedInventory` does. It is one entity of the
// `conduits` phase, whose faces act in face order (the line's local order) each tick.
// - A face extracts while its tick deficit is 0 or less, if it extracts (Extract or In / Out) and its redstone mode needs
//   no signal (Ignore, or Off: the line gives none). Each tick its deficit drops by one, and below −1 it becomes 20: a
//   face that found nothing on two ticks running sleeps 20 ticks.
// - An extraction looks at up to 64 of the slots its inventory shows the face, starting after the slot it last moved
//   from. Of the first stack its extract filter passes and the inventory lets out, it offers up to its most (4, plus 4
//   per speed upgrade) to its targets. What they take leaves the slot, the next extraction starts at that same slot, and
//   the face waits round(n × 10 / most) ticks (`eioDeficit`, in Java's float arithmetic). When they take none of it, the
//   face looks at the next slot.
// - Its targets are the network's other faces (its own too with self feed) whose insert side has its extract side's
//   channel colour: sticky filters first, then priority, highest first, then conduit hops, fewest first, then face order.
//   It tries them in that order until the offer is used up. With round robin each try moves one target on from the last
//   one tried, so the next offer starts after the target that used one up. A target takes what its insert filter passes,
//   merged onto its stacks and the rest into its first empty slot (EnderCore's `ItemUtil.doInsertItem`); behind a Limited
//   Item Filter, at most the filter's limit for the item less what the target holds of it, its grid cells included.
// - A GT transfer into a conduit (a cover, auto-output, an output bus, a bench's back) goes in only through a face that
//   extracts and whose extract filter passes the item, and that face offers it to its targets at once; what they do not
//   take stays where it was. Every other side of a conduit takes nothing: the conduit is a block that refuses the item,
//   not an empty cell a transfer would drop it into.
// - Filters are whitelists or blacklists of items. One that ignores NBT compares items without their NBT, one that
//   ignores meta compares ids only, and one that matches by ore dictionary is read as its exact items (the reader says so:
//   `eio_oredict`). An empty whitelist passes nothing.
// - When its chunk loads again (`restart`), EnderIO builds the network anew: every face's deficit is 0, and its start slot
//   and its round robin index are back at the first.
// - A face whose side has no inventory of the run moves nothing; nor does a face without targets, which therefore never acts.
// Pure TypeScript: nothing from node:* may be imported here.

import type { StuffKey } from '../../../../shared/keys.ts';
import type { RedstoneMode } from '../../../../shared/types/layout.ts';
import type { FeedConduitFilter } from '../contract.ts';
import { EIO, eioDeficit, PART_KEYS } from '../facts.ts';
import { compareLocal, localOf } from '../frame.ts';
import type { EioFace, EioNet, FeedModel, NodeId } from '../model.ts';
import { listText } from '../text.ts';
import { insertOneEmpty, NEVER, PHASE, type KeyTable, type PushTarget, type SimEntity, type SimInv } from './core.ts';
import type { Explain } from './detect.ts';
import type { SimEnv } from './machine.ts';
import type { NetworkModel } from './run.ts';

/** The redstone modes in which a face extracts on a line that gives it no signal (rule 1). */
const NO_SIGNAL_NEEDED: ReadonlySet<RedstoneMode> = new Set(['ignore', 'off']);

/** The hops to a conduit the network's hops do not reach (none, in a network read from a layout): the last. */
const FAR = Number.MAX_SAFE_INTEGER;

/** What a side of a conduit that does not extract makes of a push: nothing goes in. */
const REFUSE: PushTarget = { accept: () => 0 };

/** `key` as a filter compares it (rule 4): its id alone when the filter ignores meta, else without its NBT when it ignores NBT. */
function matchForm(key: StuffKey, meta: boolean, nbt: boolean): string {
  const at = key.lastIndexOf('@');
  if (at < 1) return key;
  if (!meta) return key.slice(0, at);
  if (nbt) return key;
  const hash = key.indexOf('#', at);
  return hash < 0 ? key : key.slice(0, hash);
}

/** A face's filter over the run's key ids: whether it passes each item, and a Limited Item Filter's limit for each (else null). */
interface CompiledFilter { pass: Uint8Array; limits: Float64Array | null }

/**
 * Rule 4: `filter` (null: none, which passes everything) for every key of the run. A Limited Item Filter's limit for an
 * item is the sum of the counts of its slots that match it (`limits[i]` is the count of the slot that holds `keys[i]`), so
 * an item it does not list has none.
 */
function compile(filter: FeedConduitFilter | null, keys: KeyTable): CompiledFilter {
  const pass = new Uint8Array(keys.size);
  if (filter === null) return { pass: pass.fill(1), limits: null };
  const meta = filter.matchMeta !== false, nbt = filter.matchNbt !== false;
  const forms = filter.keys.map((k) => matchForm(k, meta, nbt));
  const listed = new Set(forms);
  const counts = filter.item === PART_KEYS.limitedFilter && filter.limits !== undefined ? filter.limits : null;
  const limits = counts === null ? null : new Float64Array(keys.size);
  for (let id = 0; id < keys.size; id++) {
    const form = matchForm(keys.key(id), meta, nbt);
    pass[id] = listed.has(form) === filter.whitelist ? 1 : 0;
    if (counts !== null && limits !== null) for (let i = 0; i < forms.length; i++) if (forms[i] === form) limits[id]! += counts[i] ?? 0;
  }
  return { pass, limits };
}

/** What a filter that refuses an item lists (rule 7): "blacklists Ex"; for a whitelist "lists Alpha and Beta", or "lists nothing". */
function refusal(filter: FeedConduitFilter | null, refused: string, nameOf: (key: StuffKey) => string): string {
  if (filter !== null && !filter.whitelist) return `blacklists ${refused}`;
  const names = [...new Set((filter?.keys ?? []).map(nameOf))];
  return `lists ${names.length === 0 ? 'nothing' : listText(names)}`;
}

/** The rank of `face` among every EnderIO face of the line, by its conduit's local cell and then its side: its network's `order`. */
function faceRank(model: FeedModel, face: EioFace): number {
  const at = localOf(face.conduit);
  let rank = 0;
  for (const net of model.networks) {
    if (net.kind !== 'enderio') continue;
    for (const f of net.faces) if ((compareLocal(localOf(f.conduit), at) || f.side - face.side) < 0) rank++;
  }
  return rank;
}

/** A face of the network as the run moves items through it. */
interface Face {
  readonly spec: EioFace;
  /** Its inventory, that inventory's own side toward the conduit, and the slots it shows that side. */
  readonly inv: SimInv; readonly side: number; readonly slots: readonly number[];
  /** Its extract side: the filter, the most it moves at a time, round robin, and whether its redstone mode lets it extract. */
  readonly extract: { pass: Uint8Array; max: number; roundRobin: boolean; acts: boolean } | null;
  /** Its insert side: the filter (a Limited Item Filter's limits too), whether that filter is sticky, and the side's priority. */
  readonly insert: (CompiledFilter & { sticky: boolean; priority: number }) | null;
  /** Rule 3: the faces its extract side sends to, in the order it tries them. */
  targets: Face[];
  /** Its tick deficit as it stands at the start of tick `at` (it drops by one a tick until the face's next try). */
  deficit: number; at: number;
  /** The index (in `slots`) of the slot it looked at last (EnderIO's `nextSlot`), and its round robin index; −1 at first. */
  last: number; robin: number;
}

/** The tick of face `f`'s next try: the tick its deficit is down to 0. */
function dueAt(f: Face): number {
  return f.at + Math.max(0, f.deficit);
}

/**
 * The model of EnderIO item network `net` in this run (`NETWORK_MODELS.enderio`): one entity of the `conduits` phase (its
 * order its first face's), the network's reasons why an item does not arrive or leave, a push target at every extracting
 * face (and one that takes nothing at every other side of its conduits), and its restart.
 */
export function enderioModel(net: EioNet, env: SimEnv): NetworkModel {
  const { keys, stats, sim, model } = env;
  const faces: Face[] = [];
  for (const spec of net.faces) {
    const ref = spec.target;
    const inv = ref === null ? null : env.inv(ref.bus ?? ref.node);
    if (ref === null || inv === null) continue;
    const ex = spec.extract, ins = spec.insert;
    faces.push({
      spec, inv, side: ref.side, slots: inv.sideSlots(ref.side),
      extract: ex === undefined ? null : { pass: compile(ex.filter, keys).pass, max: ex.max, roundRobin: ex.roundRobin, acts: NO_SIGNAL_NEEDED.has(ex.redstone) },
      insert: ins === undefined ? null : { ...compile(ins.filter, keys), sticky: ins.filter?.sticky === true, priority: ins.priority },
      targets: [], deficit: 0, at: 0, last: -1, robin: -1,
    });
  }

  // rule 3: each face's targets, sorted once (a stable sort: face order breaks the last ties)
  for (const f of faces) {
    const ex = f.spec.extract;
    if (f.extract === null || ex === undefined) continue;
    const hops = net.hops[f.spec.conduit] ?? {};
    const far = (g: Face): number => hops[g.spec.conduit] ?? FAR;
    f.targets = faces.filter((g) => g.insert !== null && g.spec.insert!.color === ex.color && (g !== f || ex.selfFeed))
      .sort((a, b) => Number(b.insert!.sticky) - Number(a.insert!.sticky) || b.insert!.priority - a.insert!.priority || far(a) - far(b));
  }

  /** What target `to` takes of `n` of `key` (rule 3): what its insert filter passes, up to a Limited Item Filter's room, merged and then into its first empty slot. */
  const give = (to: Face, key: number, n: number, by: SimEntity | null): number => {
    const ins = to.insert!;
    if (ins.pass[key] !== 1) return 0;
    let m = n;
    if (ins.limits !== null) {
      const room = ins.limits[key]! - to.inv.countAll(key);
      if (room <= 0) return 0;
      m = Math.min(m, room);
    }
    const got = insertOneEmpty(to.inv, key, m, to.side, by);
    if (got > 0) stats.delivered(to.inv.id, key, got, sim.t);
    return got;
  };

  /** Face `from` offers `n` of `key` to its targets (rule 3); returns what they took. */
  const offer = (from: Face, key: number, n: number, by: SimEntity | null): number => {
    const targets = from.targets;
    const count = targets.length;
    let left = n;
    if (from.extract!.roundRobin) {
      // EnderCore's `RoundRobinIterator`: each try one target on; the index stays where the offer is used up
      for (let i = 0; i < count && left > 0; i++) {
        from.robin = from.robin + 1 >= count ? 0 : from.robin + 1;
        left -= give(targets[from.robin]!, key, left, by);
      }
    } else {
      for (let i = 0; i < count && left > 0; i++) left -= give(targets[i]!, key, left, by);
    }
    return n - left;
  };

  /** Rule 2: one extraction by face `f`; returns the items its targets took. */
  const extractFrom = (f: Face, by: SimEntity): number => {
    const ex = f.extract!;
    const { inv, slots, side } = f;
    const n = slots.length;
    for (let i = 0, checks = Math.min(n, EIO.maxSlotChecks); i < checks; i++) {
      // EnderIO's `nextSlot`: one on from the slot looked at last, back to the first past the end
      f.last = f.last + 1 >= n ? 0 : f.last + 1;
      const slot = slots[f.last]!;
      const s = inv.stack(slot);
      if (s === null || s.count <= 0 || ex.pass[s.key] !== 1 || !inv.canExtract(slot, s.key, side)) continue;
      const key = s.key;
      const took = offer(f, key, Math.min(ex.max, s.count), by);
      if (took <= 0) continue;
      inv.extract(slot, took, by);
      // `setNextStartingSlot`: the next extraction starts at this slot again (EnderIO sets its index from the slot's number,
      // the same thing here, as every inventory shows its slots 0, 1, … in order on every side)
      f.last = slot - 1;
      return took;
    }
    return 0;
  };

  // rule 1: the faces that act (an extract side whose redstone mode needs no signal, with somewhere to send)
  const acting = faces.filter((f) => f.extract !== null && f.extract.acts && f.targets.length > 0);
  const first = net.faces[0];
  const self: SimEntity = {
    phase: PHASE.conduits,
    order: first === undefined ? 0 : faceRank(model, first),
    tick(t: number): number {
      let due = NEVER;
      for (const f of acting) {
        if (dueAt(f) <= t) {
          // its deficit is down to 0 or below: it tries; then its deficit drops by one, and below −1 it sleeps
          const moved = extractFrom(f, self);
          const d = (moved > 0 ? eioDeficit(moved, f.extract!.max) : f.deficit - (t - f.at)) - 1;
          f.deficit = d < -1 ? EIO.sleepTicks : d;
          f.at = t + 1;
        }
        due = Math.min(due, dueAt(f));
      }
      return due;
    },
  };

  // rule 5: a push into a conduit goes in through a face that extracts, offered to that face's targets at once
  const receivers: NetworkModel['receivers'] = [];
  const open = new Set<string>();
  for (const f of faces) {
    const ex = f.extract;
    if (ex === null) continue;
    receivers.push({ at: f.spec.conduit, side: f.spec.side, target: { accept: (key, n, _side, by) => (ex.pass[key] === 1 ? offer(f, key, n, by) : 0) } });
    open.add(`${f.spec.conduit}|${f.spec.side}`);
  }
  // and nowhere else: every other side of the network's conduits refuses it
  for (const cell of new Set([...Object.keys(net.hops), ...net.faces.map((f) => f.conduit)])) {
    for (let side = 0; side < 6; side++) if (!open.has(`${cell}|${side}`)) receivers.push({ at: cell, side, target: REFUSE });
  }

  // rule 7: why an item does not reach a node (`in`) or leave it (`out`); a multiblock's input buses for one, its output buses for the other
  const busWay = new Map<NodeId, 'in' | 'out'>();
  for (const n of model.nodes) {
    if (n.kind !== 'multi') continue;
    for (const b of n.inBuses) busWay.set(b.id, 'in');
    for (const b of n.outBuses) busWay.set(b.id, 'out');
  }
  const nameOf = (key: StuffKey): string => model.nameOf(key);
  const explain: Explain = (kind, node, key) => {
    const toward = faces.filter((f) => f.spec.target!.node === node && (f.spec.target!.bus === undefined || busWay.get(f.spec.target!.bus) === kind));
    if (toward.length === 0) return null;
    const k = keys.id(key);
    const name = nameOf(key);
    const elsewhere = faces.filter((f) => !toward.includes(f));
    if (kind === 'in') {
      const inserting = toward.filter((f) => f.insert !== null);
      if (inserting.length === 0) return 'no conduit face toward it inserts';
      if (inserting.every((f) => f.insert!.pass[k] !== 1)) return `its conduit face's Insert filter ${refusal(inserting[0]!.spec.insert!.filter, name, nameOf)}`;
      if (elsewhere.every((f) => f.extract === null || f.extract.pass[k] !== 1)) return `no conduit face extracts ${name} anywhere on the line`;
      return null;
    }
    const extracting = toward.filter((f) => f.extract !== null);
    if (extracting.length === 0) return 'no conduit face toward it extracts';
    const passing = extracting.filter((f) => f.extract!.pass[k] === 1);
    if (passing.length === 0) return `its conduit face's Extract filter ${refusal(extracting[0]!.spec.extract!.filter, name, nameOf)}`;
    const takenBy = (f: Face): boolean => elsewhere.some((g) => g.insert !== null && g.spec.insert!.color === f.spec.extract!.color && g.insert.pass[k] === 1);
    return passing.some(takenBy) ? null : `no conduit face on the line inserts ${name}`;
  };

  // rule 6: the network is built anew when its chunk loads
  const restart = (): void => {
    for (const f of faces) {
      f.deficit = 0;
      f.at = env.loadedAt;
      f.last = -1;
      f.robin = -1;
    }
  };

  return { entities: [self], explain, receivers, restart };
}
