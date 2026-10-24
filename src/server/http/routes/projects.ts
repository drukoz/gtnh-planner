// Shared projects (architecture §7, §8): list, create and read them, change them only through ops applied in arrival
// order, one event stream per open tab that starts with the project and then carries every applied op, and the
// project's plan, cached per settings, export, scan and base, with a `plan` event whenever it may have changed.
// Anyone may delete a project; it waits in "Recently deleted" until restored or purged (§11.24, spec §3.11).
// Add-on 17 (§11.45 (4)): a plan reads what the group's other projects published of their surplus and needs, keyed by
// what it read, and publishes its own, which tells the projects that read it to plan again; and (§11.45 (5)) the Compare
// card's three planning modes of a project, with a `compare` event when the modes still planning at its answer are done.

import type { IncomingMessage } from 'node:http';
import type { AppContext } from '../../app.ts';
import { COMPARE_TIME_LIMIT_SECONDS, compareModes, compareRunnerFor, modeSettings } from '../../planner/compare.ts';
import { objectiveOf } from '../../planner/objective.ts';
import { emptyContext, planCacheKey, planLine, PlanCache, settingsHash } from '../../planner/plan.ts';
import { linePricing } from '../../planner/pricing.ts';
import { OpError, type ProjectStore } from '../../projects/store.ts';
import {
  crossRead, drawsOn, loopWarning, readGoods, readsBoard, sharedWarnings, summaryOf, surplusBoardFor, type BoardChange, type CrossRead,
  type SurplusBoard,
} from '../../projects/surplus.ts';
import { HttpError, readJson, sendJson, type RequestContext, type Route } from '../router.ts';
import { validateOp } from '../../../shared/project/apply-op.ts';
import type { StuffKey } from '../../../shared/keys.ts';
import type {
  CompareEvent, CompareMode, CompareResult, CreateProjectBody, DeletedEvent, DeletedProjectSummary, OpEvent, OpsResult, PlanEvent,
  ProjectListEntry,
} from '../../../shared/types/api.ts';
import type { Pack } from '../../../shared/types/pack.ts';
import type { Plan, PlanContext, PlanObjective, PlanSettings } from '../../../shared/types/plan.ts';
import type { Project, ProjectOp } from '../../../shared/types/project.ts';

const MAX_OPS_PER_REQUEST = 100;
/**
 * Ops after which the plan may differ: settings and world change it (architecture §11.8); placement changes only
 * Plan 5's finished plan and layout, so those batches hit the cache but still tell the tabs (§11.16).
 */
const REPLAN_OPS: ReadonlySet<ProjectOp['op']> = new Set(['settings', 'world', 'placement', 'clearPlacement']);

const isRecord = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);

/** Who is acting: nothing is created or changed without a display name. */
function requireName(ctx: RequestContext): string {
  if (ctx.me === null) throw new HttpError(400, 'name-required', 'Tell us your name first');
  return ctx.me;
}

function notFound(id: string): HttpError {
  return new HttpError(404, 'not-found', `No project ${id}`);
}

/** `?deleted=1`: the list of recently deleted projects instead of the live ones. */
function wantsDeleted(req: IncomingMessage): boolean {
  const url = req.url ?? '';
  const i = url.indexOf('?');
  return new URLSearchParams(i < 0 ? '' : url.slice(i + 1)).get('deleted') === '1';
}

/** The create body after its checks: the name as a rename op would take it, the settings as a settings op would. */
function createBody(body: unknown): CreateProjectBody {
  if (!isRecord(body)) throw new HttpError(400, 'bad-request', 'Send {"name": "…"}');
  const nameProblem = validateOp({ op: 'rename', name: body.name });
  if (nameProblem !== null) throw new HttpError(400, 'bad-request', nameProblem);
  if (body.settings !== undefined) {
    const settingsProblem = validateOp({ op: 'settings', patch: body.settings });
    if (settingsProblem !== null) throw new HttpError(400, 'bad-request', settingsProblem);
  }
  return body as unknown as CreateProjectBody;
}

/** The ops of an ops body: 1 to 100 of them; each op is checked by the store, which reports its index. */
function opsOf(body: unknown): ProjectOp[] {
  const ops = isRecord(body) ? body.ops : undefined;
  if (!Array.isArray(ops) || ops.length < 1 || ops.length > MAX_OPS_PER_REQUEST) {
    throw new HttpError(400, 'bad-request', `Send {"ops": [...]} with 1 to ${MAX_OPS_PER_REQUEST} ops`);
  }
  return ops as ProjectOp[];
}

/**
 * Whether a projector token may send `ops` (architecture §11.23): every op is `{ op: 'mark' }` on a build step's row
 * ("step:…"). The ops are not validated yet, so anything else in the array, even a non-object, makes it false.
 */
export function tokenMayApply(ops: readonly ProjectOp[]): boolean {
  return ops.every((op: unknown) => isRecord(op) && op.op === 'mark' && typeof op.row === 'string' && op.row.startsWith('step:'));
}

/** The store's apply, with a rejected op answered as 400 `bad-op` "op <index>: <reason>"; null for an unknown project. */
function applyOps(app: AppContext, id: string, ops: ProjectOp[], by: string): ReturnType<ProjectStore['apply']> {
  try {
    return app.projects.apply(id, ops, by);
  } catch (err) {
    if (err instanceof OpError) throw new HttpError(400, 'bad-op', `op ${err.index}: ${err.message}`);
    throw err;
  }
}

function messageOf(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

const PLAN_CACHES = new WeakMap<AppContext, PlanCache>();

/** The plan cache of one app (one per `AppContext`). */
export function planCacheFor(app: AppContext): PlanCache {
  let cache = PLAN_CACHES.get(app);
  if (cache === undefined) {
    cache = new PlanCache();
    PLAN_CACHES.set(app, cache);
  }
  return cache;
}

/** The lines' goods kept per app (`lineGoods`), as many as the plan cache keeps plans. */
const LINE_GOODS_SIZE = 32;
const LINE_GOODS = new WeakMap<AppContext, Map<string, Promise<ReadonlySet<StuffKey>>>>();
const NO_GOODS: ReadonlySet<StuffKey> = new Set();

/**
 * The goods of the line of plan key `key` (add-on 17, data flow step 1): those of its candidate graph, which never reads
 * other projects, so they hold for every read of the board. Worked out by `compute` once per key and app, at most
 * LINE_GOODS_SIZE kept, the least recently used dropped first; callers asking while it is worked out share that work,
 * and one that fails is not kept.
 */
function lineGoods(app: AppContext, key: string, compute: () => Promise<ReadonlySet<StuffKey>>): Promise<ReadonlySet<StuffKey>> {
  let memo = LINE_GOODS.get(app);
  if (memo === undefined) {
    memo = new Map();
    LINE_GOODS.set(app, memo);
  }
  const hit = memo.get(key);
  if (hit !== undefined) {
    memo.delete(key);
    memo.set(key, hit);
    return hit;
  }
  const goods = compute();
  memo.set(key, goods);
  if (memo.size > LINE_GOODS_SIZE) memo.delete(memo.keys().next().value as string);
  const kept = memo;
  goods.catch(() => {
    if (kept.get(key) === goods) kept.delete(key);
  });
  return goods;
}

/** The world context `project` is planned in: the `app.services.planContext` hook's, read at that moment, or an empty one. */
async function contextFor(app: AppContext, project: Project): Promise<PlanContext> {
  const hook = app.services.planContext;
  return typeof hook === 'function' ? hook(project) : emptyContext();
}

/**
 * Sends `event: plan` to every live project that `from`'s change on the board reaches (`SurplusBoard.fanOut`), so its
 * tabs fetch their plan again and read the new summary; returns the live projects the fan-out left out for its round.
 */
function tellReaders(app: AppContext, board: SurplusBoard, from: string, change: BoardChange): Project[] {
  const { to, skipped } = board.fanOut(from, change);
  for (const id of to) {
    const reader = app.projects.get(id);
    if (reader === null) continue;
    const event: PlanEvent = { rev: reader.rev };
    app.sse.send(id, 'plan', event);
  }
  return skipped.map((id) => app.projects.get(id)).filter((p): p is Project => p !== null);
}

/**
 * Publishes `plan`, `project`'s plan made on what it read, as its summary under its name of now (data flow step 4), or
 * withdraws its summary when the plan has none (a failed plan, Make N); tells the projects that change reaches; and
 * returns the plan as served (not cached): with every live project's draw on it (`Plan.drawnBy`, ruling R16) and, when
 * the fan-out left someone out for its round, `surplus-loop`. A project deleted while it was planned publishes nothing:
 * its deletion withdraws its summary.
 */
function published(app: AppContext, board: SurplusBoard, project: Project, plan: Plan, live: ReadonlySet<string>): Plan {
  const current = app.projects.get(project.id);
  if (current === null) return plan;
  const summary = summaryOf({ ...project, name: current.name }, plan, new Date().toISOString());
  const left = tellReaders(app, board, project.id, summary === null ? board.remove(project.id) : board.publish(summary));
  const drawnBy = drawsOn(board, project.id, live, plan.exportId);
  const served = drawnBy.length === 0 ? plan : { ...plan, drawnBy };
  return left.length === 0 ? served : { ...served, warnings: [...served.warnings, loopWarning(left.map((p) => p.name))] };
}

/**
 * `planned`, made on `read`, as the plan cache keeps it: with the hash of what it read (`Plan.crossHash`, absent when it
 * read nothing) and a `surplus-shared` warning for each offer older projects cut that it takes in full (ruling R16).
 */
function withRead(pack: Pack, settings: PlanSettings, planned: Plan, read: CrossRead): Plan {
  const shared = sharedWarnings(planned, read.offers, settings.per, (key) => pack.nameOf(key));
  return {
    ...planned,
    ...(shared.length === 0 ? {} : { warnings: [...planned.warnings, ...shared] }),
    ...(read.hash === '' ? {} : { crossHash: read.hash }),
  };
}

/**
 * The project's plan as the planner makes it, before `planFinish` (architecture §11.16), from the app's plan cache:
 * keyed by export, scan, base and settings hash, and computed on a miss in the world context the
 * `app.services.planContext` hook gives (read at that moment; `emptyContext()` without one). The plan names the
 * project's scan when it has one. `HttpError(503, 'no-export')` when no recipe export is active.
 *
 * Add-on 17 (architecture §11.45 (4), the data flow of Task 6): `opts.settings` plans those settings instead of the
 * project's (the Compare card's modes). In rate mode the plan reads the summaries the group's other live projects
 * published on this export (`crossRead`) — never planning or changing another project — over the goods of its line
 * (`lineGoods`), and the cache key gains `|x:<hash of what it read>`, so the plan is made again exactly when what it
 * reads changed. With `opts.publish` (the default) the read, the plan and its publication run one at a time per app
 * (`SurplusBoard.exclusive`; nothing inside calls this again, so the lock cannot deadlock), the read is noted for the
 * fan-out, and the plan, cache hit or miss, is published (`published`); without it the plan only reads.
 */
export async function planForProject(app: AppContext, project: Project, opts: { settings?: PlanSettings; publish?: boolean } = {}): Promise<Plan> {
  const settings = opts.settings ?? project.settings;
  const pack = await app.pack();
  const exportId = pack.manifest.exportId;
  const { scanId, baseId } = project.world;
  const planKey = planCacheKey(settingsHash(settings), exportId, scanId, baseId);
  let context: Promise<PlanContext> | undefined;
  const contextOf = (): Promise<PlanContext> => (context ??= contextFor(app, project));
  const goods = !readsBoard(settings) ? NO_GOODS : await lineGoods(app, planKey, async () => {
    const pricing = linePricing(pack, settings, await contextOf());
    return pricing === null ? NO_GOODS : new Set((await pricing).graph.goods.keys());
  });
  const board = surplusBoardFor(app);
  const publish = opts.publish ?? true;
  const flow = async (): Promise<Plan> => {
    const live = new Set(app.projects.list().map((p) => p.id));
    const read = crossRead(board, project, settings, live, goods, exportId);
    if (publish) board.noteRead(project.id, readGoods(settings, goods));
    const key = read.hash === '' ? planKey : `${planKey}|x:${read.hash}`;
    const plan = await planCacheFor(app).get(key, async () =>
      withRead(pack, settings, await planLine(pack, settings, await contextOf(), { offers: read.offers, needs: read.needs }), read));
    return publish ? published(app, board, project, plan, live) : plan;
  };
  const plan = publish ? await board.exclusive(flow) : await flow();
  return scanId === null ? plan : { ...plan, scanId };
}

/**
 * Republishes the summary of project `id` under its new name (data flow step 5), one at a time with the plans that
 * publish, so the readers of all its goods follow it ("from <project>"); nothing when it has none or the name is the same.
 */
function republishName(app: AppContext, id: string): void {
  const board = surplusBoardFor(app);
  void board.exclusive(async () => {
    const project = app.projects.get(id);
    const stored = board.get(id);
    if (project === null || stored === null || stored.name === project.name) return;
    const renamed = { ...stored, name: project.name, rev: project.rev, at: new Date().toISOString() };
    tellReaders(app, board, id, board.publish(renamed));
  }).catch((err: unknown) => console.error(`Publishing the new name of project ${id} failed:`, err));
}

/**
 * Withdraws the summary of the deleted project `id` (data flow step 5), one at a time with the plans that publish, so
 * the projects that took from it plan without it; its deletion starts a new round, as a change the group made to it.
 */
function withdrawSummary(app: AppContext, id: string): void {
  const board = surplusBoardFor(app);
  void board.exclusive(async () => {
    board.newRound(id);
    tellReaders(app, board, id, board.remove(id));
  }).catch((err: unknown) => console.error(`Withdrawing the surplus of deleted project ${id} failed:`, err));
}

/** `plan` after the `app.services.planFinish` hook, if one is set; when it fails, `plan` with a `layout-failed` warning. */
async function finishedPlan(app: AppContext, plan: Plan, project: Project): Promise<Plan> {
  const finish = app.services.planFinish;
  if (typeof finish !== 'function') return plan;
  try {
    return await finish(plan, project);
  } catch (err) {
    return { ...plan, warnings: [...plan.warnings, { code: 'layout-failed', text: `The line layout failed: ${messageOf(err)}` }] };
  }
}

/** Per app and project: the newest project state waiting for the replan in flight to end (null: none waits). */
const REPLANS = new WeakMap<AppContext, Map<string, { next: Project | null }>>();

/**
 * Plans `project` (as an ops batch left it) in the background, then sends its tabs `event: plan` with that rev — also
 * when planning fails, so they refetch and show the error. One replan runs per project at a time: a batch that lands
 * while one is in flight only records its project state, and when the replan ends it runs once more for the newest
 * state that waited (ledger 200: amounts typed digit by digit, quick clicks in Settings). A real-pack plan takes about
 * a second of mostly synchronous work, so a burst would otherwise queue one full solve per rev on the one Node thread
 * while friends tick and stream during play; the tabs only ever fetch the newest plan anyway.
 */
function replanInBackground(app: AppContext, project: Project): void {
  let perApp = REPLANS.get(app);
  if (perApp === undefined) {
    perApp = new Map();
    REPLANS.set(app, perApp);
  }
  const waiting = perApp.get(project.id);
  if (waiting !== undefined) {
    if (waiting.next === null || project.rev >= waiting.next.rev) waiting.next = project;
    return;
  }
  const entry: { next: Project | null } = { next: null };
  perApp.set(project.id, entry);
  const run = (p: Project): void => {
    const event: PlanEvent = { rev: p.rev };
    void planForProject(app, p)
      .catch(() => {})   // the plan route reports the failure when the tabs refetch
      .then(() => {
        app.sse.send(p.id, 'plan', event);
        const next = entry.next;
        entry.next = null;
        if (next !== null) run(next);
        else perApp.delete(p.id);
      });
  };
  run(project);
}

/**
 * The Compare card's modes of `project` (add-on 17, architecture §11.45 (5)): its three planning modes, each planned with
 * its own settings (`modeSettings`) from the plan cache without publishing (`publish: false`: the board keeps the
 * summary of the mode the project plans in) and without `planFinish` (the card needs no layout), the current mode first,
 * within `COMPARE_TIME_LIMIT_SECONDS`; the modes still planning then finish in the background and send the project's tabs
 * `event: compare`. One compare per project at a time (`compareRunnerFor`), keyed by what its plans read of the project:
 * its settings and its world (scan and base, as the plan cache key), so a compare of the project's earlier settings or
 * world is never served for its current ones.
 */
function compareProject(app: AppContext, project: Project): Promise<CompareMode[]> {
  const { scanId, baseId } = project.world;
  const key = `${settingsHash(project.settings)}|${scanId ?? '-'}|${baseId ?? '-'}`;
  const planMode = async (objective: PlanObjective): Promise<Plan> => {
    try {
      return await planForProject(app, project, { settings: modeSettings(project.settings, objective), publish: false });
    } catch (err) {
      if (!(err instanceof HttpError)) console.error(`Planning project ${project.id} in mode ${objective} failed:`, err);
      throw err;
    }
  };
  const onLate = (): void => {
    const event: CompareEvent = { rev: project.rev };
    app.sse.send(project.id, 'compare', event);
  };
  return compareRunnerFor(app).run(project.id, key, (stale, planning) => compareModes(planMode, {
    current: objectiveOf(project.settings), limitSeconds: COMPARE_TIME_LIMIT_SECONDS, onLate, stale, planning,
  }));
}

export function projectRoutes(app: AppContext): Route[] {
  return [
    {
      method: 'GET', path: '/api/projects',
      handler: async (req, res) => {
        if (wantsDeleted(req)) {
          const deleted: DeletedProjectSummary[] = app.projects.listDeleted();
          sendJson(res, 200, deleted);
          return;
        }
        const list: ProjectListEntry[] = app.projects.list();
        sendJson(res, 200, list);
      },
    },
    {
      method: 'POST', path: '/api/projects',
      handler: async (req, res, _params, ctx) => {
        const by = requireName(ctx);
        const { name, settings } = createBody(await readJson<unknown>(req));
        sendJson(res, 201, app.projects.create(name, by, settings));
      },
    },
    {
      method: 'GET', path: '/api/projects/:id', bearer: true,
      handler: async (_req, res, params) => {
        const project = app.projects.get(params.id!);
        if (project === null) throw notFound(params.id!);
        sendJson(res, 200, project);
      },
    },
    {
      method: 'DELETE', path: '/api/projects/:id',
      handler: async (_req, res, params, ctx) => {
        const id = params.id!;
        const by = requireName(ctx);
        const deleted = app.projects.delete(id, by);
        if (deleted === null) throw notFound(id);
        // No await since the store marked it: no stream can join the channel between the mark and its end.
        const event: DeletedEvent = { id, by, at: deleted.deletedAt };
        app.sse.end(id, { event: 'deleted', data: event });
        withdrawSummary(app, id);
        res.writeHead(204, { 'Cache-Control': 'no-store' });
        res.end();
      },
    },
    {
      method: 'POST', path: '/api/projects/:id/restore',
      handler: async (_req, res, params) => {
        const id = params.id!;
        const restored = app.projects.restore(id);
        if (restored === null) throw notFound(id);
        if (restored === 'not-deleted') throw new HttpError(409, 'not-deleted', `Project ${id} is not deleted`);
        sendJson(res, 200, restored);
      },
    },
    {
      method: 'POST', path: '/api/projects/:id/ops', bearer: true,
      handler: async (req, res, params, ctx) => {
        const id = params.id!;
        const by = requireName(ctx);
        const ops = opsOf(await readJson<unknown>(req));
        if (ctx.bearer !== undefined && !tokenMayApply(ops)) {
          throw new HttpError(403, 'token-scope', 'A projector token can only tick build steps');
        }
        const result = applyOps(app, id, ops, by);
        if (result === null) throw notFound(id);
        // The store applies a batch synchronously, so the events of concurrent batches reach every tab in rev order.
        for (const a of result.applied) {
          const event: OpEvent = { rev: a.rev, op: a.op, by: a.by, at: a.at };
          app.sse.send(id, 'op', event, a.rev);
        }
        const replans = result.applied.some((a) => REPLAN_OPS.has(a.op.op));
        const renamed = result.applied.some((a) => a.op.op === 'rename');
        // Add-on 17: a change the group makes to the project starts a new round of the surplus fan-out for it.
        if (replans || renamed) surplusBoardFor(app).newRound(id);
        if (replans) replanInBackground(app, result.project);
        if (renamed) republishName(app, id);
        const answer: OpsResult = { rev: result.project.rev };
        sendJson(res, 200, answer);
      },
    },
    {
      method: 'GET', path: '/api/projects/:id/events',
      handler: async (req, res, params) => {
        // No await between reading the project and joining its channel, so no op can fall between snapshot and stream.
        const project = app.projects.get(params.id!);
        if (project === null) throw notFound(params.id!);
        app.sse.open(project.id, req, res, { event: 'snapshot', data: project, id: project.rev });
      },
    },
    {
      method: 'GET', path: '/api/projects/:id/plan',
      handler: async (_req, res, params) => {
        const project = app.projects.get(params.id!);
        if (project === null) throw notFound(params.id!);
        let plan: Plan;
        try {
          plan = await planForProject(app, project);
        } catch (err) {
          if (err instanceof HttpError) throw err;
          console.error(`Planning project ${project.id} failed:`, err);
          throw new HttpError(500, 'plan-failed', `The planner failed: ${messageOf(err)}`);
        }
        sendJson(res, 200, await finishedPlan(app, plan, project));
      },
    },
    {
      method: 'GET', path: '/api/projects/:id/compare',
      handler: async (_req, res, params) => {
        const project = app.projects.get(params.id!);
        if (project === null) throw notFound(params.id!);
        const modes = await compareProject(app, project);
        const result: CompareResult = { rev: project.rev, current: objectiveOf(project.settings), modes };
        sendJson(res, 200, result);
      },
    },
  ];
}
