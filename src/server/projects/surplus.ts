// Surplus across projects (add-on 17; design spec §3.11, architecture §11.45 (4)): what each project's latest plan makes
// and does not use and what it needs from outside, published in the database for the group's other projects to read —
// never to compute —; a line's read of them (offers of another project's surplus, served oldest project first, and in
// best multi-output the needs its byproducts may be credited to), with the walk of the draws that keeps two projects from
// feeding each other in a circle; one read, plan and publish at a time per app; and whom a changed summary reaches,
// damped so that plans that keep changing each other stop within one round.

import { createHash } from 'node:crypto';
import type { AppContext } from '../app.ts';
import type { Db } from '../db/db.ts';
import { formatRate } from '../../shared/format.ts';
import { isFluidKey, type StuffKey } from '../../shared/keys.ts';
import { joinNames } from '../../shared/layout/format.ts';
import type { Plan, PlanSettings, PlanWarning, RawInput } from '../../shared/types/plan.ts';
import type { Project } from '../../shared/types/project.ts';
import { objectiveOf, type Need, type Offer } from '../planner/objective.ts';
import { sig9 } from '../planner/round.ts';

/** The `meta` keys the summaries are stored under: `surplus:<project id>`. */
export const SUMMARY_PREFIX = 'surplus:';
/** How long a project a fan-out reached stays in that round (`SurplusBoard.fanOut`, data flow step 7). */
export const FANOUT_ROUND_SECONDS = 60;

/** A rate this small or below (per second) is none, as the solver's threshold is. */
const TINY = 1e-9;
/** An offer a plan takes all of but this share counts as taken in full (`sharedWarnings`). */
const IN_FULL = 1e-6;

/**
 * What a project's latest plan (rate mode) tells the group's other projects, every rate per second to 9 significant
 * digits (ruling S11): what it makes and does not use itself — its byproducts, those credited to another project
 * included —, what it needs from outside — the raw goods it buys (cost above 0, a farm's tool wear aside) and the goods
 * it takes from other projects —, both per key and by key, and what it takes from whom, its "from <project>" inputs, by
 * project, then key. `rev` and `at` are the project's rev and the time it was published; `createdAt` the project's own
 * (ruling R16: several readers of one producer are served oldest project first).
 */
export interface PublishedSummary {
  projectId: string; name: string; exportId: string; rev: number; at: string;
  surplus: Array<{ key: StuffKey; perSecond: number }>;
  needs: Array<{ key: StuffKey; perSecond: number }>;
  draws: Array<{ from: string; key: StuffKey; perSecond: number }>;
  createdAt: string;
}

/** A line's read of the board: its offers and needs (objective.ts), and the hash of both ('' when nothing was read). */
export interface CrossRead { offers: Offer[]; needs: Need[]; hash: string }

/**
 * What a publish or removal changed: the goods whose surplus entry and whose need entry changed (all of them when its
 * name or export changed or it was removed), whether its draws changed, and the producers its old and new draws name
 * (ruling R16: their lists of who takes their surplus change), when its draws or its name changed.
 */
export interface BoardChange { surplus: StuffKey[]; needs: StuffKey[]; draws: boolean; drawsFrom: string[] }

/** What a line reads of the board: the goods it takes offers of and those whose needs it may be credited for. */
export interface BoardReads { offers: ReadonlySet<StuffKey>; needs: ReadonlySet<StuffKey> }

const NO_READS: BoardReads = { offers: new Set(), needs: new Set() };

function byString(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0;
}

/** Older projects first (ruling R16): by `createdAt`, then by id. */
function byAge(a: { createdAt: string; projectId: string }, b: { createdAt: string; projectId: string }): number {
  return byString(a.createdAt, b.createdAt) || byString(a.projectId, b.projectId);
}

const byKey = (a: { key: StuffKey }, b: { key: StuffKey }): number => byString(a.key, b.key);

/** `entries` summed per key, at 9 significant digits, by key; nothing of 0. */
function perKey(entries: ReadonlyArray<readonly [StuffKey, number]>): Array<{ key: StuffKey; perSecond: number }> {
  const sums = new Map<StuffKey, number>();
  for (const [key, amount] of entries) sums.set(key, (sums.get(key) ?? 0) + amount);
  return [...sums].map(([key, sum]) => ({ key, perSecond: sig9(sum) })).filter((e) => e.perSecond > 0).sort(byKey);
}

/** A raw input the line needs from outside (`PublishedSummary.needs`): bought (cost above 0, not upkeep) or another project's. */
function needed(r: RawInput): boolean {
  return r.from === undefined ? r.cost > 0 && r.upkeep !== true : r.from.kind === 'project';
}

/**
 * The summary `plan`, `project`'s latest plan, publishes (data flow step 4; `at`: the time it is published); null
 * unless the plan is `ok` in rate mode (a Make N batch has no steady surplus).
 */
export function summaryOf(project: Project, plan: Plan, at: string): PublishedSummary | null {
  if ((plan.status ?? 'ok') !== 'ok' || project.settings.mode !== 'rate' || plan.makeN !== undefined) return null;
  const draws = new Map<string, { from: string; key: StuffKey; perSecond: number }>();
  for (const r of plan.rawInputs) {
    if (r.from?.kind !== 'project') continue;
    const id = JSON.stringify([r.from.id, r.key]);
    const draw = draws.get(id);
    if (draw === undefined) draws.set(id, { from: r.from.id, key: r.key, perSecond: r.perSecond });
    else draw.perSecond += r.perSecond;
  }
  return {
    projectId: project.id, name: project.name, exportId: plan.exportId, rev: project.rev, at,
    surplus: perKey(plan.byproducts.map((p) => [p.key, p.amount * p.chance] as const)),
    needs: perKey(plan.rawInputs.filter(needed).map((r) => [r.key, r.perSecond] as const)),
    draws: [...draws.values()].map((d) => ({ ...d, perSecond: sig9(d.perSecond) })).filter((d) => d.perSecond > 0)
      .sort((a, b) => byString(a.from, b.from) || byKey(a, b)),
    createdAt: project.createdAt,
  };
}

/** A list of rates as stored: an array of objects with a string `key`, a finite `perSecond` and, for draws, a string `from`. */
function isRates(v: unknown, withFrom: boolean): boolean {
  return Array.isArray(v) && v.every((e: unknown) => {
    if (typeof e !== 'object' || e === null) return false;
    const r = e as Record<string, unknown>;
    return typeof r.key === 'string' && typeof r.perSecond === 'number' && Number.isFinite(r.perSecond) && (!withFrom || typeof r.from === 'string');
  });
}

/** The summary stored under `surplus:<id>`, or null when its value is not one (not JSON, or not shaped as a summary of `id`). */
function storedSummary(id: string, value: string): PublishedSummary | null {
  let v: unknown;
  try {
    v = JSON.parse(value);
  } catch {
    return null;
  }
  if (typeof v !== 'object' || v === null) return null;
  const s = v as Record<string, unknown>;
  const texts = ['projectId', 'name', 'exportId', 'at', 'createdAt'].every((field) => typeof s[field] === 'string');
  const shaped = texts && typeof s.rev === 'number' && isRates(s.surplus, false) && isRates(s.needs, false) && isRates(s.draws, true);
  return shaped && s.projectId === id ? (v as PublishedSummary) : null;
}

/** The keys of `entries`, once each, sorted. */
function keysOf(...lists: ReadonlyArray<ReadonlyArray<{ key: StuffKey }>>): StuffKey[] {
  return [...new Set(lists.flatMap((list) => list.map((e) => e.key)))].sort(byString);
}

/** The keys whose entry differs between `before` and `after` (added, gone, or another rate), sorted. */
function changedKeys(before: PublishedSummary['surplus'], after: PublishedSummary['surplus']): StuffKey[] {
  const was = new Map(before.map((e) => [e.key, e.perSecond]));
  const is = new Map(after.map((e) => [e.key, e.perSecond]));
  return keysOf(before, after).filter((key) => was.get(key) !== is.get(key));
}

/** The producers `draws` name, once each, sorted. */
function producersOf(draws: PublishedSummary['draws']): string[] {
  return [...new Set(draws.map((d) => d.from))].sort(byString);
}

/** `draws` in one order, as text: two lists of the same draws compare equal. */
function drawsText(draws: PublishedSummary['draws']): string {
  const sorted = [...draws].sort((a, b) => byString(a.from, b.from) || byKey(a, b) || a.perSecond - b.perSecond);
  return JSON.stringify(sorted.map((d) => [d.from, d.key, d.perSecond]));
}

/** What publishing `after` over `before` (the stored summary, if any) changed (`BoardChange`). */
function changeOf(before: PublishedSummary | undefined, after: PublishedSummary): BoardChange {
  if (before === undefined) {
    return { surplus: keysOf(after.surplus), needs: keysOf(after.needs), draws: after.draws.length > 0, drawsFrom: producersOf(after.draws) };
  }
  const renamed = before.name !== after.name;
  // A summary of another export is read by other projects, so for every reader all of it is new or gone.
  const moved = before.exportId !== after.exportId;
  const whole = renamed || moved;
  const draws = moved ? before.draws.length + after.draws.length > 0 : drawsText(before.draws) !== drawsText(after.draws);
  return {
    surplus: whole ? keysOf(before.surplus, after.surplus) : changedKeys(before.surplus, after.surplus),
    needs: whole ? keysOf(before.needs, after.needs) : changedKeys(before.needs, after.needs),
    draws,
    drawsFrom: draws || renamed ? producersOf([...before.draws, ...after.draws]) : [],
  };
}

/**
 * The published summaries of one app's projects (`surplusBoardFor`), kept in the database's `meta` table under
 * `surplus:<id>`, so they survive a restart; what each project's plan read of them (in memory: whom a change reaches);
 * and the rounds of the fan-outs, on the board's clock.
 */
export class SurplusBoard {
  readonly #db: Db;
  readonly #now: () => number;
  readonly #summaries = new Map<string, PublishedSummary>();
  readonly #reads = new Map<string, BoardReads>();
  /** Per project a fan-out reached: the projects whose changes led there, and until when (ms) that round lasts. */
  readonly #rounds = new Map<string, { members: ReadonlySet<string>; until: number }>();
  /** Settles when the last `exclusive` call's `fn` has settled. */
  #last: Promise<void> = Promise.resolve();

  /** Loads every stored summary (`listMeta(SUMMARY_PREFIX)`); a value that is not a summary is skipped. */
  constructor(db: Db, now: () => number = Date.now) {
    this.#db = db;
    this.#now = now;
    for (const { key, value } of db.listMeta(SUMMARY_PREFIX)) {
      const summary = storedSummary(key.slice(SUMMARY_PREFIX.length), value);
      if (summary !== null) this.#summaries.set(summary.projectId, summary);
    }
  }

  get(id: string): PublishedSummary | null {
    return this.#summaries.get(id) ?? null;
  }

  /** Every summary, by project id. */
  all(): PublishedSummary[] {
    return [...this.#summaries.values()].sort((a, b) => byString(a.projectId, b.projectId));
  }

  /** Runs `fn` once every earlier call's `fn` has settled: one read, plan and publish at a time per app. */
  exclusive<T>(fn: () => Promise<T>): Promise<T> {
    const run = this.#last.then(fn);
    this.#last = run.then(() => undefined, () => undefined);
    return run;
  }

  /** Stores `s` as its project's summary and says what that changed against the stored one (`BoardChange`). */
  publish(s: PublishedSummary): BoardChange {
    const before = this.#summaries.get(s.projectId);
    this.#db.setMeta(`${SUMMARY_PREFIX}${s.projectId}`, JSON.stringify(s));
    this.#summaries.set(s.projectId, s);
    return changeOf(before, s);
  }

  /** Withdraws the summary of project `id`: every good of it and its draws changed; nothing changed when it has none. */
  remove(id: string): BoardChange {
    const before = this.#summaries.get(id);
    if (before === undefined) return { surplus: [], needs: [], draws: false, drawsFrom: [] };
    this.#db.deleteMeta(`${SUMMARY_PREFIX}${id}`);
    this.#summaries.delete(id);
    return { surplus: keysOf(before.surplus), needs: keysOf(before.needs), draws: true, drawsFrom: producersOf(before.draws) };
  }

  /**
   * In memory: the goods that project's plan read offers of (none with "Use other projects' surplus" off) and needs of
   * (none unless best multi-output), `readGoods`; a project that reads neither is forgotten. The sets are kept as given.
   */
  noteRead(projectId: string, read: BoardReads): void {
    if (read.offers.size === 0 && read.needs.size === 0) this.#reads.delete(projectId);
    else this.#reads.set(projectId, read);
  }

  /**
   * A change the group makes to project `id` itself (an op that renames or replans it, its deletion) starts a new round
   * for it: the round a fan-out reached it in no longer keeps that change from the projects of that round.
   */
  newRound(id: string): void {
    this.#rounds.delete(id);
  }

  /**
   * Whom `from`'s change reaches, sorted: the projects whose noted offer goods meet `change.surplus` or whose noted need
   * goods meet `change.needs`, with `change.draws` every project that read offers (its circle checks walk the draws), and
   * the producers of `change.drawsFrom` — less `from` and the projects of the round that led to `from` (data flow step
   * 7). Each project it reaches is given that round, those projects and `from`, for `FANOUT_ROUND_SECONDS`. `skipped`:
   * the ones left out for the round that read a changed good (one reached only through the draws is left out silently).
   */
  fanOut(from: string, change: BoardChange): { to: string[]; skipped: string[] } {
    const now = this.#now();
    const round = this.#roundOf(from, now);
    const byGoods = new Set<string>();
    const byDraws = new Set<string>();
    for (const [id, read] of this.#reads) {
      if (id === from) continue;
      if (change.surplus.some((key) => read.offers.has(key)) || change.needs.some((key) => read.needs.has(key))) byGoods.add(id);
      else if (change.draws && read.offers.size > 0) byDraws.add(id);
    }
    for (const id of change.drawsFrom) if (id !== from && !byGoods.has(id)) byDraws.add(id);
    const to = [...byGoods, ...byDraws].filter((id) => !round.has(id)).sort(byString);
    const skipped = [...byGoods].filter((id) => round.has(id)).sort(byString);
    if (to.length > 0) {
      const members: ReadonlySet<string> = new Set([...round, from]);
      const until = now + FANOUT_ROUND_SECONDS * 1000;
      for (const id of to) this.#rounds.set(id, { members, until });
    }
    return { to, skipped };
  }

  /** The projects of the round a fan-out reached `id` in, while it lasts; none otherwise. */
  #roundOf(id: string, now: number): ReadonlySet<string> {
    const round = this.#rounds.get(id);
    if (round === undefined) return new Set();
    if (now < round.until) return round.members;
    this.#rounds.delete(id);
    return new Set();
  }
}

const BOARDS = new WeakMap<AppContext, SurplusBoard>();

/** The surplus board of one app (one per `AppContext`, like `planCacheFor`), loaded from its database on first use. */
export function surplusBoardFor(app: AppContext): SurplusBoard {
  let board = BOARDS.get(app);
  if (board === undefined) {
    board = new SurplusBoard(app.db);
    BOARDS.set(app, board);
  }
  return board;
}

/**
 * Whether a line of `settings` reads the board at all: in rate mode, with "Use other projects' surplus" on (offers) or
 * in best multi-output (needs). Make N projects neither publish nor read.
 */
export function readsBoard(settings: PlanSettings): boolean {
  return settings.mode === 'rate' && (settings.useSurplus !== false || objectiveOf(settings) === 'multi-output');
}

/**
 * The goods a line of `settings` whose candidate graph has `goods` reads of the board (`noteRead`, `crossRead`): offers
 * of all of them but its target (taking its own target from another project would plan an empty line), with "Use other
 * projects' surplus" on, and in best multi-output the needs of all of them; nothing outside rate mode.
 */
export function readGoods(settings: PlanSettings, goods: ReadonlySet<StuffKey>): BoardReads {
  if (!readsBoard(settings)) return NO_READS;
  return {
    offers: settings.useSurplus === false ? new Set() : new Set([...goods].filter((key) => key !== settings.target)),
    needs: objectiveOf(settings) === 'multi-output' ? goods : new Set(),
  };
}

/** Whether the draws of `byId`'s summaries, walked from project `from`, reach project `to`. */
function drawsReach(byId: ReadonlyMap<string, PublishedSummary>, from: string, to: string): boolean {
  const seen = new Set([from]);
  const walk = [from];
  for (let id = walk.pop(); id !== undefined; id = walk.pop()) {
    for (const d of byId.get(id)?.draws ?? []) {
      if (d.from === to) return true;
      if (seen.has(d.from)) continue;
      seen.add(d.from);
      walk.push(d.from);
    }
  }
  return false;
}

/**
 * The offer of `entry` of `producer`'s surplus to a reader whose older live projects are `older` (ruling R16): the
 * surplus less what they draw of it from that producer, at least 0, with `shared` (the whole surplus, and the names of
 * those that draw some, oldest first) when they draw any.
 */
function offerOf(producer: PublishedSummary, entry: PublishedSummary['surplus'][number], older: readonly PublishedSummary[]): Offer {
  let taken = 0;
  const takenBy: string[] = [];
  for (const o of older) {
    let drawn = 0;
    for (const d of o.draws) if (d.from === producer.projectId && d.key === entry.key) drawn += d.perSecond;
    if (drawn > 0) {
      taken += drawn;
      takenBy.push(o.name);
    }
  }
  const left = entry.perSecond - taken;
  const offer: Offer = { from: producer.projectId, name: producer.name, key: entry.key, perSecond: left > TINY ? sig9(left) : 0 };
  if (takenBy.length > 0) offer.shared = { surplus: entry.perSecond, takenBy };
  return offer;
}

/**
 * `project`'s read of the board in `settings` (rate mode only; data flow steps 2 and 6), over the summaries of the other
 * live projects (`live`) on export `exportId` — the board as it is now —, oldest project first, then by key (ruling R16).
 * Offers, with "Use other projects' surplus" on: each surplus entry whose key is in `goods` and is not the line's target,
 * unless a walk of the board's draws from that project reaches this one (a draw that would close a circle), less what
 * older readers draw of it (`offerOf`). Needs, in best multi-output only: each need entry whose key is in `goods`.
 * `hash`: the first 16 hex digits of the SHA-1 of both as JSON, '' when both are empty.
 */
export function crossRead(
  board: SurplusBoard, project: Project, settings: PlanSettings, live: ReadonlySet<string>, goods: ReadonlySet<StuffKey>, exportId: string,
): CrossRead {
  const reads = readGoods(settings, goods);
  const offers: Offer[] = [];
  const needs: Need[] = [];
  if (reads.offers.size > 0 || reads.needs.size > 0) {
    const view = board.all().filter((s) => live.has(s.projectId) && s.exportId === exportId);
    const byId = new Map(view.map((s) => [s.projectId, s]));
    const others = view.filter((s) => s.projectId !== project.id).sort(byAge);
    const self = { createdAt: project.createdAt, projectId: project.id };
    const older = others.filter((s) => byAge(s, self) < 0);
    for (const s of others) {
      if (reads.offers.size > 0 && !drawsReach(byId, s.projectId, project.id)) {
        for (const entry of [...s.surplus].sort(byKey)) if (reads.offers.has(entry.key)) offers.push(offerOf(s, entry, older));
      }
      for (const entry of [...s.needs].sort(byKey)) {
        if (reads.needs.has(entry.key)) needs.push({ by: s.projectId, name: s.name, key: entry.key, perSecond: entry.perSecond });
      }
    }
  }
  const hash = offers.length === 0 && needs.length === 0 ? '' : createHash('sha1').update(JSON.stringify({ offers, needs })).digest('hex').slice(0, 16);
  return { offers, needs, hash };
}

/**
 * Who takes the surplus of `producer` (`Plan.drawnBy`, ruling R16): each draw on it of the other live projects (`live`)
 * whose summaries are on export `exportId`, oldest project first, then by key.
 */
export function drawsOn(board: SurplusBoard, producer: string, live: ReadonlySet<string>, exportId: string): NonNullable<Plan['drawnBy']> {
  const readers = board.all().filter((s) => s.projectId !== producer && live.has(s.projectId) && s.exportId === exportId).sort(byAge);
  return readers.flatMap((s) => [...s.draws].sort(byKey).filter((d) => d.from === producer)
    .map((d) => ({ by: s.projectId, name: s.name, key: d.key, perSecond: d.perSecond })));
}

/**
 * The `surplus-shared` warnings of `plan`, planned on `offers` (ruling R16): one for each offer older projects reduced
 * (`Offer.shared`) that the plan takes in full while it still buys, makes or draws more of that good. Rates per the
 * project's unit (`per`), goods by `nameOf`.
 */
export function sharedWarnings(plan: Plan, offers: readonly Offer[], per: PlanSettings['per'], nameOf: (key: StuffKey) => string): PlanWarning[] {
  const warnings: PlanWarning[] = [];
  for (const o of offers) {
    if (o.shared === undefined) continue;
    let taken = 0;
    let elsewhere = 0;
    for (const r of plan.rawInputs) {
      if (r.key !== o.key) continue;
      if (r.from?.kind === 'project' && r.from.id === o.from) taken += r.perSecond;
      else elsewhere += r.perSecond;
    }
    // made by a step of the line for another step
    for (const f of plan.flows) if (f.key === o.key && f.from !== 'raw' && f.to !== 'out' && f.to !== 'sink') elsewhere += f.perSecond;
    if (taken < o.perSecond * (1 - IN_FULL) || !(elsewhere > TINY)) continue;
    const rate = (perSecond: number): string => formatRate(perSecond, per, { fluid: isFluidKey(o.key) });
    warnings.push({
      code: 'surplus-shared', key: o.key,
      text: `${o.name} spares ${rate(o.shared.surplus)} of ${nameOf(o.key)}; older projects take ${rate(o.shared.surplus - o.perSecond)} of it first `
        + `(${joinNames(o.shared.takenBy)}), so this line takes ${rate(o.perSecond)} and makes or buys the rest`,
    });
  }
  return warnings;
}

/** The warning of a plan whose fan-out left `names` out for the round (data flow step 7): served, never cached. */
export function loopWarning(names: readonly string[]): PlanWarning {
  const who = joinNames(names);
  return {
    code: 'surplus-loop',
    text: `This plan and ${who} keep changing what each other can use; ${who} are not planned again for it now, only the next time they change`,
  };
}
