// Shared projects (architecture §7, §8): list, create and read them, change them only through ops applied in arrival
// order, and one event stream per open tab that starts with the project and then carries every applied op.

import type { AppContext } from '../../app.ts';
import { OpError, type ProjectStore } from '../../projects/store.ts';
import { HttpError, readJson, sendJson, type RequestContext, type Route } from '../router.ts';
import { validateOp } from '../../../shared/project/apply-op.ts';
import type { CreateProjectBody, OpEvent, OpsResult, ProjectListEntry } from '../../../shared/types/api.ts';
import type { ProjectOp } from '../../../shared/types/project.ts';

const MAX_OPS_PER_REQUEST = 100;

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
  ];
}
