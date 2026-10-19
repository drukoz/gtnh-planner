// The layout route (Plan 5 Task 12; architecture §7, §11.16; spec §3.6–§3.8, Review Focus 1): the project's line
// layout, also before anyone picked a scan (a layout at the default origin that says to pick one). It sets the one
// Plan 2 hook this plan owns, `app.services.planFinish`, so the plan route sends the plan with the layout merged in.
// Errors are `HttpError`s: an unknown project is a 404, an `HttpError` from below (503 without an export) passes
// through, and any other failure is a 500 `layout-failed`.

import type { AppContext } from '../../app.ts';
import { layoutService } from '../../layout/service.ts';
import { HttpError, sendJson, type Route } from '../router.ts';
import type { Layout } from '../../../shared/types/layout.ts';

function messageOf(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

export function layoutRoutes(app: AppContext): Route[] {
  const service = layoutService(app);
  app.services.planFinish = (plan, project) => service.finishPlan(plan, project);
  return [
    {
      method: 'GET', path: '/api/projects/:id/layout',
      handler: async (_req, res, params) => {
        const project = app.projects.get(params.id!);
        if (project === null) throw new HttpError(404, 'not-found', `No project ${params.id!}`);
        let layout: Layout;
        try {
          layout = await service.layoutFor(project);
        } catch (err) {
          if (err instanceof HttpError) throw err;
          console.error(`Laying out project ${project.id} failed:`, err);
          throw new HttpError(500, 'layout-failed', `The line layout failed: ${messageOf(err)}`);
        }
        sendJson(res, 200, layout);
      },
    },
  ];
}
