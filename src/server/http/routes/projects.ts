// Shared projects (architecture §7, §8): list, create and read them, change them only through ops applied in arrival
// order, one event stream per open tab that starts with the project and then carries every applied op, and the
// project's plan, cached per settings, export, scan and base, with a `plan` event whenever it may have changed.

import type { AppContext } from '../../app.ts';
import { emptyContext, planCacheKey, planLine, PlanCache, settingsHash } from '../../planner/plan.ts';
import { OpError, type ProjectStore } from '../../projects/store.ts';
import { HttpError, readJson, sendJson, type RequestContext, type Route } from '../router.ts';
import { validateOp } from '../../../shared/project/apply-op.ts';
import type { CreateProjectBody, OpEvent, OpsResult, PlanEvent, ProjectListEntry } from '../../../shared/types/api.ts';
import type { Plan } from '../../../shared/types/plan.ts';
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

/**
 * The project's plan as the planner makes it, before `planFinish` (architecture §11.16), from the app's plan cache:
 * keyed by export, scan, base and settings hash, and computed on a miss in the world context the
 * `app.services.planContext` hook gives (read at that moment; `emptyContext()` without one). The plan names the
 * project's scan when it has one. `HttpError(503, 'no-export')` when no recipe export is active.
 */
export async function planForProject(app: AppContext, project: Project): Promise<Plan> {
  const pack = await app.pack();
  const { scanId, baseId } = project.world;
  const key = planCacheKey(settingsHash(project.settings), pack.manifest.exportId, scanId, baseId);
  const plan = await planCacheFor(app).get(key, async () => {
    const hook = app.services.planContext;
    const ctx = typeof hook === 'function' ? await hook(project) : emptyContext();
    return planLine(pack, project.settings, ctx);
  });
  return scanId === null ? plan : { ...plan, scanId };
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

export function projectRoutes(app: AppContext): Route[] {
  return [
    {
      method: 'GET', path: '/api/projects',
      handler: async (_req, res) => {
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
      method: 'GET', path: '/api/projects/:id',
      handler: async (_req, res, params) => {
        const project = app.projects.get(params.id!);
        if (project === null) throw notFound(params.id!);
        sendJson(res, 200, project);
      },
    },
    {
      method: 'POST', path: '/api/projects/:id/ops',
      handler: async (req, res, params, ctx) => {
        const id = params.id!;
        const by = requireName(ctx);
        const result = applyOps(app, id, opsOf(await readJson<unknown>(req)), by);
        if (result === null) throw notFound(id);
        // The store applies a batch synchronously, so the events of concurrent batches reach every tab in rev order.
        for (const a of result.applied) {
          const event: OpEvent = { rev: a.rev, op: a.op, by: a.by, at: a.at };
          app.sse.send(id, 'op', event, a.rev);
        }
        if (result.applied.some((a) => REPLAN_OPS.has(a.op.op))) replanInBackground(app, result.project);
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
  ];
}
