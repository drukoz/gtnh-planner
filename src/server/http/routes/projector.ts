// The projector's HTTP side (spec §3.13, architecture §11.22–§11.23): the token routes the project page uses (they need
// the session cookie), the one route the in-game mod reads with its token (`bearer: true`), and the token check the HTTP
// core runs for `Authorization: Bearer` (`app.services.verifyToken`). Errors are `HttpError`s: an unknown or deleted
// project is a 404 (§11.24), an `HttpError` from the layout (503 without an export) passes through, and any other
// failure to lay the line out is a 500 `layout-failed`.

import type { AppContext } from '../../app.ts';
import { layoutService } from '../../layout/service.ts';
import { projectorPayload } from '../../projector/payload.ts';
import { TokenLimitError, TokenStore } from '../../projector/tokens.ts';
import { HttpError, readJson, sendJson, type RequestContext, type Route, type TokenVerifier } from '../router.ts';
import { planForProject } from './projects.ts';
import type { Project } from '../../../shared/types/project.ts';
import type { CreateTokenResult, ProjectorPayload } from '../../../shared/types/projector.ts';

const isRecord = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);

function messageOf(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

/** The app's one token store, kept in `app.services.tokens` (created on first use, as the layout service is). */
export function tokenStore(app: AppContext): TokenStore {
  const existing = app.services.tokens as TokenStore | undefined;
  if (existing !== undefined) return existing;
  const store = new TokenStore(app.db);
  app.services.tokens = store;
  return store;
}

/** Who is acting: no token is made without a display name. */
function requireName(ctx: RequestContext): string {
  if (ctx.me === null) throw new HttpError(400, 'name-required', 'Tell us your name first');
  return ctx.me;
}

/** Project `id`, as long as it exists and is not deleted; the store answers null for a deleted one. */
function liveProject(app: AppContext, id: string): Project {
  const project = app.projects.get(id);
  if (project === null) throw new HttpError(404, 'not-found', `No project ${id}`);
  return project;
}

/**
 * Registers the token check (`app.services.verifyToken`, which the HTTP core reads on every request) and returns the
 * routes. Only the projector route takes a token; the token routes need the session cookie.
 */
export function projectorRoutes(app: AppContext): Route[] {
  app.services.verifyToken = ((token, projectId) => {
    const info = tokenStore(app).verify(token, projectId);
    return info === null ? null : { tokenId: info.tokenId };
  }) satisfies TokenVerifier;
  return [
    {
      method: 'POST', path: '/api/projects/:id/tokens',
      handler: async (req, res, params, ctx) => {
        const by = requireName(ctx);
        const body = await readJson<unknown>(req);
        const project = liveProject(app, params.id!);
        let made: CreateTokenResult;
        try {
          made = tokenStore(app).create(project.id, isRecord(body) ? body.label : undefined, by);
        } catch (err) {
          if (err instanceof TokenLimitError) throw new HttpError(409, 'too-many-tokens', err.message);
          throw err;
        }
        sendJson(res, 201, made);
      },
    },
    {
      method: 'GET', path: '/api/projects/:id/tokens',
      handler: async (_req, res, params) => {
        sendJson(res, 200, tokenStore(app).list(liveProject(app, params.id!).id));
      },
    },
    {
      method: 'DELETE', path: '/api/projects/:id/tokens/:tokenId',
      handler: async (_req, res, params) => {
        const project = liveProject(app, params.id!);
        const tokenId = params.tokenId!;
        if (!tokenStore(app).revoke(project.id, tokenId)) throw new HttpError(404, 'not-found', `No token ${tokenId} in project ${project.id}`);
        res.writeHead(204, { 'Cache-Control': 'no-store' });
        res.end();
      },
    },
    {
      method: 'GET', path: '/api/projects/:id/projector', bearer: true,
      handler: async (_req, res, params) => {
        const project = liveProject(app, params.id!);
        let payload: ProjectorPayload;
        try {
          const pack = await app.pack();
          // the plan this request serves, planned once and then laid out: its own steps, which the checklist shows
          // merged with its layout's, so the mod numbers the steps as the Steps view does (planning again could read
          // other projects' summaries another publish changed in between, add-on 17, and number another line's steps)
          const plan = await planForProject(app, project);
          // looked up per request, so a layout service registered or replaced after start is the one used
          const layout = await layoutService(app).layoutFor(project, plan);
          payload = projectorPayload(project, layout, pack, plan.buildSteps);
        } catch (err) {
          if (err instanceof HttpError) throw err;
          console.error(`Building the projector payload of project ${project.id} failed:`, err);
          throw new HttpError(500, 'layout-failed', `The line layout failed: ${messageOf(err)}`);
        }
        sendJson(res, 200, payload);
      },
    },
  ];
}
