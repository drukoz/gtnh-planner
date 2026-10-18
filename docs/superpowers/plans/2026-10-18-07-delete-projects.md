# Delete Projects Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let anyone in the group delete a project (confirming by typing its name), restore it within 7 days, and purge it for good after that.

**Architecture:** Soft delete in Plan 2's project store (a `deleted_at`/`deleted_by` pair on the `project` row), three routes on the existing projects route module, one new SSE event, and two client affordances (Delete with typed confirmation; a "Recently deleted" section with Restore). Purge runs at startup and daily next to the existing daily backup.

**Tech Stack:** Node 24 + node:sqlite (`src/server/db/db.ts`), node:http routes (`src/server/http/routes/projects.ts`), SSE hub (`src/server/http/sse.ts`), React 19 client, vitest, Playwright.

**Spec:** `docs/superpowers/specs/2026-10-17-gtnh-planner-design.md` §3.11 ("Projects can be deleted…"); architecture `docs/superpowers/plans/2026-10-17-00-architecture.md` §11.24.

## Global Constraints

- `DELETE /api/projects/:id` → 204; the project disappears from `GET /api/projects`; every other route for that id answers 404 `{error:'not-found'}` (including SSE connect, ops, plan, layout once it exists).
- `GET /api/projects?deleted=1` → `Array<{ id, name, rev, target, updatedAt, deletedAt, deletedBy }>` of soft-deleted projects, newest deletion first.
- `POST /api/projects/:id/restore` → 200 `Project` (clears `deleted_at`/`deleted_by`); 404 if unknown or already purged; restoring a live project → 409 `{error:'not-deleted'}`.
- Purge: projects with `deleted_at` older than 7 days (`PURGE_AFTER_MS = 7 * 24 * 3600 * 1000`) are removed with their `project_op` rows, at startup and once a day (same timer as the daily backup). Any table that references a project (e.g. a later `project_token`) must be removed with it — use `ON DELETE CASCADE` or explicit deletes in one transaction.
- SSE: on delete, every open stream of that project receives `event: deleted` `data: {"id":…,"by":…,"at":…}` and is then closed.
- Deleting needs the `X-Planner-Name` header (400 `bad-name` without it), like ops. `by` = that name.
- Database schema change goes through the existing schema-version mechanism in `db.ts` (bump the version, migrate in place, keep existing rows).
- Client: on the project page a "Delete project" button opens an inline confirmation (no `window.confirm`/`alert`) that enables the final Delete only when the typed text equals the project name exactly; after deleting, and when an open tab receives `deleted`, the client goes to the project list and shows "<name> was deleted by <by>" once. The project list shows a "Recently deleted" section (only when non-empty) with each project's name, who deleted it, when, and a Restore button.
- Commit messages end with `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`. No new dependencies.

## Review Focus

1. A deleted project's id used on any route (ops, events, plan, project GET) → 404, never a half-working project.
2. Two tabs open on a project, one deletes → the other tab leaves the project page within 2 s.
3. Restore after delete brings back settings, notes and marks unchanged (same rev).
4. Purge never touches projects deleted less than 7 days ago or live projects.
5. A typed name that differs only by case or trailing space does not enable Delete.

---

### Task 1: Soft delete, restore and purge (server, client, tests)

**Files:**
- Modify: `src/server/db/db.ts` (schema version + `deleted_at TEXT NULL`, `deleted_by TEXT NULL` columns on `project`; methods `softDeleteProject(id, by, at)`, `restoreProject(id)`, `listDeletedProjects()`, `purgeDeletedProjects(now: Date, olderThanMs: number): number`)
- Modify: `src/server/projects/store.ts` (expose `delete(id, by)`, `restore(id)`, `listDeleted()`; `get`/`list`/op application treat soft-deleted as missing)
- Modify: `src/server/http/routes/projects.ts` (the three routes), `src/server/http/sse.ts` (send `deleted` and close the project's streams), `src/server/main.ts` (purge at startup and daily)
- Modify: `src/shared/types/api.ts` (append `DeletedProjectSummary`), client files: project page, project list, `src/client/api/client.ts` (add `apiDelete(path)` if missing), project store (handle `deleted` event)
- Test: `tests/unit/db/delete.test.ts`, `tests/unit/http/projects-delete.test.ts`, `tests/client/delete-project.test.tsx`, `tests/e2e/delete.spec.ts`

**Interfaces:**
- Consumes: Plan 2's `Db`, `ProjectStore`, `SseHub`, `Route`, `sendJson`, `HttpError`, `displayName`, `apiGet/apiPost`, project store.
- Produces: `DELETE /api/projects/:id`, `GET /api/projects?deleted=1`, `POST /api/projects/:id/restore`, SSE `deleted`, `PURGE_AFTER_MS`, `DeletedProjectSummary { id: string; name: string; rev: number; target: StuffKey | null; updatedAt: string; deletedAt: string; deletedBy: string }`.

- [ ] **Step 1: Write the failing tests**

`tests/unit/db/delete.test.ts`: create two projects; `softDeleteProject(a)`; `list()` has only b; `listDeletedProjects()` has a with deletedBy; `restoreProject(a)` returns it with the same rev, notes and marks; `purgeDeletedProjects(now, PURGE_AFTER_MS)` with `deleted_at` = now − 8 days removes it and its `project_op` rows and returns 1, with now − 6 days returns 0; a live project is never purged; opening a database file created by the previous schema version migrates it and keeps its projects.

`tests/unit/http/projects-delete.test.ts` (real server on port 0, like the existing route tests): DELETE without `X-Planner-Name` → 400 `bad-name`; DELETE → 204; then GET project, POST ops, GET plan and GET events → 404 `not-found`; `GET /api/projects` lacks it; `GET /api/projects?deleted=1` lists it with `deletedBy` = the header name; an open SSE stream receives `event: deleted` with `{id, by}` and then ends; restore → 200 with the same rev; restore again → 409 `not-deleted`; restore unknown id → 404.

`tests/client/delete-project.test.tsx`: the Delete confirm button stays disabled for `"mv circuits"`, `"MV circuits "` when the name is `"MV circuits"`, enabled for the exact name; receiving `deleted` navigates to the list and shows `MV circuits was deleted by Sam` once; "Recently deleted" renders only when the deleted list is non-empty and Restore calls `POST /api/projects/<id>/restore`.

`tests/e2e/delete.spec.ts`: two browser contexts open the same project; context A deletes it (typing the name); context B is back on the list within 2 s with the notice; A restores it from "Recently deleted"; it is back in the list with its notes.

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx vitest run tests/unit/db/delete.test.ts tests/unit/http/projects-delete.test.ts tests/client/delete-project.test.tsx`
Expected: FAIL (missing methods/routes/components).

- [ ] **Step 3: Implement** the db methods + migration, store methods, routes, SSE `deleted`, purge at startup and on the daily timer, the client pieces, exactly per Global Constraints.

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npm run typecheck && npx vitest run && npm run e2e`
Expected: all pass (GTNH_LOCAL tests skipped).

- [ ] **Step 5: Commit**

```bash
git add -A src tests docs/superpowers/plans/2026-10-18-07-delete-projects.md
git commit -m "feat: delete projects with typed confirmation, 7-day restore and purge

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```
