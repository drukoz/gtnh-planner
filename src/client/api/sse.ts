// The live event stream of one open project (architecture §8): exactly one EventSource per open project, because a
// browser allows only six connections per origin across all its tabs (web-stack §4.4). The stream starts with a
// `snapshot` of the project after every (re)connect, then carries each applied `op` and a `plan` event whenever the plan
// may have changed. The browser reconnects by itself after a network failure (the server sends `retry: 2000`). A
// `deleted` event (§11.24) ends it for good, as does finding the project gone when it tries to reopen.

import type { DeletedEvent, OpEvent, PlanEvent } from '../../shared/types/api.ts';
import type { Project } from '../../shared/types/project.ts';
import { ApiError, apiGet } from './client.ts';

export interface ProjectEventHandlers {
  snapshot(p: Project): void;
  op(e: OpEvent): void;
  plan(e: PlanEvent): void;
  /** true once the stream is open, false while it is down and being retried. */
  connected(ok: boolean): void;
  /** The project was deleted (its `deleted` event), or null: it was gone when the stream tried to reopen. Nothing follows. */
  deleted(e: DeletedEvent | null): void;
}

/** The answer for a project that is not there (deleted, purged, or never was). */
export function isProjectGone(err: unknown): boolean {
  return err instanceof ApiError && err.status === 404 && err.code === 'not-found';
}

/** How long to wait before trying again after the browser gave up on the stream. */
const REOPEN_MS = 5000;

function dataOf<T>(e: Event): T {
  return JSON.parse((e as MessageEvent<string>).data) as T;
}

/** Opens the project's event stream; the returned function closes it for good. */
export function openProjectEvents(id: string, on: ProjectEventHandlers): () => void {
  const path = `/api/projects/${encodeURIComponent(id)}`;
  let source: EventSource | null = null;
  let timer: ReturnType<typeof setTimeout> | null = null;
  let closed = false;

  const stop = (): void => {
    closed = true;
    if (timer !== null) clearTimeout(timer);
    source?.close();
  };

  const open = (): void => {
    const es = new EventSource(`${path}/events`);
    es.addEventListener('open', () => on.connected(true));
    es.addEventListener('snapshot', (e) => on.snapshot(dataOf<Project>(e)));
    es.addEventListener('op', (e) => on.op(dataOf<OpEvent>(e)));
    es.addEventListener('plan', (e) => on.plan(dataOf<PlanEvent>(e)));
    es.addEventListener('deleted', (e) => {
      stop();   // before the server ends the stream, so the browser never reconnects into a 404
      on.deleted(dataOf<DeletedEvent>(e));
    });
    es.addEventListener('error', () => {
      if (closed) return;
      on.connected(false);
      if (es.readyState === EventSource.CLOSED) reopenLater();
    });
    source = es;
  };

  // The browser stops retrying when the server answers with an HTTP error (a lost session, a proxy's 502). Ask with a
  // plain request first, which sends a lost session to the login page, and reopen once the project answers again.
  const reopenLater = (): void => {
    if (closed || timer !== null) return;
    timer = setTimeout(() => {
      apiGet<Project>(path).then(
        () => {
          timer = null;
          if (!closed) open();
        },
        (err: unknown) => {
          timer = null;
          if (closed) return;
          if (isProjectGone(err)) {
            stop();   // deleted while this tab missed the event (asleep, offline): stop asking
            on.deleted(null);
          } else {
            reopenLater();
          }
        },
      );
    }, REOPEN_MS);
  };

  open();
  return stop;
}
